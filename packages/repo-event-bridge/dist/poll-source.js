/**
 * PollSource — poll-based EventSource implementation.
 *
 * Mission-52 T2. Concrete implementation of the W1 EventSource
 * contract. Polls a configured set of GitHub repos on a constant
 * cadence; translates raw GH events into RepoEvents via the W1
 * translator; persists per-repo cursor + bounded recent-event-id
 * dedupe set via @ois/storage-provider (eats own dogfood per
 * audit-emerged commitment).
 *
 * Per thread-312 round-2 design ratification:
 *   - Constant cadence (default 30s/repo; operator-tunable). No
 *     adaptive cadence — explicit anti-goal.
 *   - Soft-limit aggregate budget (default 80% of GH PAT 5000 req/hr
 *     = 4000 req/hr). Logged at startup for operability — warns if
 *     repo-count × cadence overruns budget; doesn't enforce. Operator
 *     fixes repo-count or cadence.
 *   - 429 path is header-driven (Retry-After / X-RateLimit-Reset).
 *     SEPARATE from generic transient backoff — exp-backoff after
 *     429 either undershoots → 429 storm; or overshoots → cursor lag.
 *   - Generic transient (5xx, network): exp-backoff 1s → 2s → 5s →
 *     10s → 30s cap. `pausedReason: 'network'` set when backoff > 30s.
 *   - Auth-failure: terminal for the source. `pausedReason: 'auth-
 *     failure'`. Operator must rotate token + restart.
 *
 * Iterator semantics: async-iterator drains a bounded internal queue
 * fed by the per-repo polling loops. Consumer pulls; `stop()`
 * terminates the iterator after draining what's already buffered.
 *
 * Test discipline: `sleep`, `now`, `fetch`, `logger`, and the random-
 * jitter source are all injectable so unit tests can drive the poll
 * loop deterministically without standing up real HTTP / wall-clock.
 */
import { GhApiClient, GhApiAuthError, GhApiRateLimitError, GhApiTransientError, PatScopeError, REQUIRED_PAT_SCOPES, } from "./gh-api-client.js";
import { CursorStore } from "./cursor-store.js";
import { translateGhEvent } from "./translator.js";
// ── Constants ─────────────────────────────────────────────────────────
/** Authenticated GH PAT primary rate limit (req/hr). */
export const GH_PAT_RATE_LIMIT_PER_HOUR = 5000;
/** Default cadence per repo (seconds). */
export const DEFAULT_CADENCE_SECONDS = 30;
/** Default fraction of GH rate-limit available to this source. */
export const DEFAULT_BUDGET_FRACTION = 0.8;
/** Backoff schedule (seconds) for generic transient failures. */
const TRANSIENT_BACKOFF_S = [1, 2, 5, 10, 30];
// ── PollSource ────────────────────────────────────────────────────────
export class PollSource {
    capabilities = Object.freeze({
        transport: "poll",
        latency: "periodic",
        mode: "pull",
        dedupe: true,
        persistedCursor: true,
    });
    repos;
    cadenceMs;
    budgetFraction;
    client;
    cursorStore;
    requiredScopes;
    sleep;
    now;
    logger;
    state = new Map();
    queue = [];
    waiters = [];
    started = false;
    stopped = false;
    abort;
    loops = [];
    healthSnapshot = {
        paused: false,
        lastSuccessfulPoll: new Date(0).toISOString(),
    };
    constructor(options) {
        this.repos = [...options.repos];
        this.cadenceMs =
            (options.cadenceSeconds ?? DEFAULT_CADENCE_SECONDS) * 1000;
        this.budgetFraction = options.budgetFraction ?? DEFAULT_BUDGET_FRACTION;
        this.requiredScopes = options.requiredScopes ?? REQUIRED_PAT_SCOPES;
        this.sleep = options.sleep ?? defaultSleep;
        this.now = options.now ?? Date.now;
        this.logger = options.logger ?? defaultLogger();
        this.client = new GhApiClient({
            token: options.token,
            baseUrl: options.baseUrl,
            fetch: options.fetch,
        });
        this.cursorStore = new CursorStore({
            storage: options.storage,
            dedupeCapacity: options.dedupeCapacity,
        });
        for (const repoId of this.repos) {
            this.state.set(repoId, {
                cursorToken: null,
                dedupeToken: null,
                transientBackoffIndex: 0,
            });
        }
    }
    // ── EventSource lifecycle ──────────────────────────────────────
    async start() {
        if (this.started)
            return;
        this.started = true;
        this.stopped = false;
        this.abort = new AbortController();
        // Validate scopes (fail loud per directive). PatScopeError /
        // GhApiAuthError propagate to caller — start() is the gate.
        try {
            await this.client.validateScopes(this.requiredScopes);
        }
        catch (err) {
            if (err instanceof PatScopeError || err instanceof GhApiAuthError) {
                this.setHealth({
                    paused: true,
                    pausedReason: "auth-failure",
                });
            }
            this.started = false;
            throw err;
        }
        this.logBudget();
        // Hydrate per-repo cursor/dedupe tokens from storage so the
        // first poll's putIfMatch lands cleanly.
        for (const repoId of this.repos) {
            const cursor = await this.cursorStore.readCursor(repoId);
            const state = this.state.get(repoId);
            state.cursorToken = cursor.token;
            state.cursorEtag = cursor.value?.etag;
        }
        // Spawn one polling loop per repo.
        this.loops = this.repos.map((repoId) => this.runLoop(repoId));
    }
    async stop() {
        if (!this.started || this.stopped)
            return;
        this.stopped = true;
        this.abort?.abort();
        await Promise.allSettled(this.loops);
        // Drain pending iterator waiters so consumers don't hang.
        while (this.waiters.length > 0) {
            const waiter = this.waiters.shift();
            waiter?.({ value: undefined, done: true });
        }
    }
    health() {
        return this.healthSnapshot;
    }
    [Symbol.asyncIterator]() {
        return {
            next: () => {
                if (this.queue.length > 0) {
                    return Promise.resolve({ value: this.queue.shift(), done: false });
                }
                if (this.stopped) {
                    return Promise.resolve({ value: undefined, done: true });
                }
                return new Promise((resolve) => {
                    this.waiters.push(resolve);
                });
            },
            return: () => {
                return Promise.resolve({ value: undefined, done: true });
            },
        };
    }
    // ── Public test seam: single-poll cycle for one repo ───────────
    /**
     * Run exactly one poll cycle for the given repo. Returns the
     * count of emitted (post-dedupe, translated) events. Throws on
     * auth failure; signals rate-limit / transient via the health
     * snapshot for caller introspection. Exposed primarily for
     * deterministic unit testing.
     */
    async pollOnce(repoId) {
        const state = this.state.get(repoId);
        if (!state)
            throw new Error(`PollSource: unknown repoId=${repoId}`);
        let result;
        try {
            result = await this.client.pollRepoEvents(repoId, {
                etag: state.cursorEtag,
            });
        }
        catch (err) {
            if (err instanceof GhApiAuthError) {
                this.setHealth({ paused: true, pausedReason: "auth-failure" });
                return { emitted: 0, outcome: "auth-failure" };
            }
            if (err instanceof GhApiRateLimitError) {
                this.setHealth({ paused: true, pausedReason: "rate-limit" });
                return {
                    emitted: 0,
                    outcome: "rate-limit",
                    resumeAtMs: err.resumeAtMs,
                };
            }
            if (err instanceof GhApiTransientError) {
                // Health flag flips when backoff breaches 30s threshold;
                // single-call doesn't sleep — caller decides.
                return { emitted: 0, outcome: "transient" };
            }
            throw err;
        }
        state.transientBackoffIndex = 0;
        this.setHealth({
            paused: false,
            lastSuccessfulPoll: new Date(this.now()).toISOString(),
        });
        if (result.notModified) {
            return { emitted: 0, outcome: "not-modified" };
        }
        const candidateIds = result.events.map((e) => e.id);
        const { unseen, token: dedupeToken } = await this.cursorStore.filterUnseen(repoId, candidateIds);
        state.dedupeToken = dedupeToken;
        const unseenSet = new Set(unseen);
        const fresh = result.events.filter((e) => unseenSet.has(e.id));
        let emitted = 0;
        for (const ghEvent of fresh) {
            const repoEvent = translateGhEvent(ghEvent);
            this.push(repoEvent);
            emitted++;
        }
        if (fresh.length > 0) {
            try {
                state.dedupeToken = await this.cursorStore.markSeen(repoId, fresh.map((e) => e.id), state.dedupeToken);
            }
            catch {
                // Conflict: another writer raced us. Reload + the next poll
                // will re-attempt; meantime the events are emitted (downstream
                // sink should have its own idempotency for repeat protection).
                state.dedupeToken = null;
            }
        }
        if (result.etag && result.etag !== state.cursorEtag) {
            const nextCursor = {
                etag: result.etag,
                lastEventId: fresh[fresh.length - 1]?.id ?? candidateIds[candidateIds.length - 1],
                updatedAt: new Date(this.now()).toISOString(),
            };
            try {
                state.cursorToken = await this.cursorStore.writeCursor(repoId, nextCursor, state.cursorToken);
                state.cursorEtag = result.etag;
            }
            catch {
                // Reset cursor token; reload on next loop iteration.
                state.cursorToken = null;
            }
        }
        return { emitted, outcome: "ok" };
    }
    // ── Internals ──────────────────────────────────────────────────
    async runLoop(repoId) {
        while (!this.stopped) {
            const state = this.state.get(repoId);
            try {
                const { outcome, resumeAtMs } = await this.pollOnce(repoId);
                if (outcome === "auth-failure") {
                    // Terminal — stop polling this source. Operator action
                    // required (rotate token + restart).
                    this.logger.error(`[repo-event-bridge] PAT auth-failure on ${repoId}; halting source`);
                    return;
                }
                if (outcome === "rate-limit") {
                    // Header-driven wait per directive. Skip the regular
                    // cadence sleep — we've already paused for the rate-limit
                    // window.
                    const waitMs = Math.max(0, (resumeAtMs ?? this.now() + 60_000) - this.now());
                    this.logger.warn(`[repo-event-bridge] rate-limited on ${repoId}; pausing ` +
                        `${Math.ceil(waitMs / 1000)}s`);
                    await this.sleepUnlessStopped(waitMs);
                    // Health flag stays paused; next successful poll clears it.
                    continue;
                }
                if (outcome === "transient") {
                    state.transientBackoffIndex = Math.min(state.transientBackoffIndex + 1, TRANSIENT_BACKOFF_S.length - 1);
                    const backoff = TRANSIENT_BACKOFF_S[state.transientBackoffIndex];
                    if (backoff > 30) {
                        this.setHealth({ paused: true, pausedReason: "network" });
                    }
                    await this.sleepUnlessStopped(backoff * 1000);
                    continue;
                }
            }
            catch (err) {
                // Defensive: pollOnce should already classify all known
                // error paths; surface unknowns for visibility.
                this.logger.error(`[repo-event-bridge] poll error on ${repoId}: ${err?.message ?? String(err)}`);
            }
            await this.sleepUnlessStopped(this.cadenceMs);
        }
    }
    push(event) {
        if (this.stopped)
            return;
        const waiter = this.waiters.shift();
        if (waiter) {
            waiter({ value: event, done: false });
        }
        else {
            this.queue.push(event);
        }
    }
    setHealth(next) {
        this.healthSnapshot = {
            ...this.healthSnapshot,
            ...next,
        };
    }
    async sleepUnlessStopped(ms) {
        if (this.stopped)
            return;
        await this.sleep(ms, this.abort?.signal);
    }
    logBudget() {
        const cadenceS = this.cadenceMs / 1000;
        const requestsPerHour = (this.repos.length * 3600) / cadenceS;
        const budgetCap = Math.floor(GH_PAT_RATE_LIMIT_PER_HOUR * this.budgetFraction);
        const headroomPct = budgetCap > 0
            ? Math.max(0, Math.round((1 - requestsPerHour / budgetCap) * 100))
            : 0;
        const line = `[repo-event-bridge] Polling ${this.repos.length} repos × ${cadenceS}s ` +
            `cadence = ${Math.round(requestsPerHour)} req/hr ` +
            `(budget cap: ${budgetCap} req/hr; ${headroomPct}% headroom)`;
        if (requestsPerHour > budgetCap) {
            this.logger.warn(`${line} — OVER BUDGET; reduce repos or increase cadence`);
        }
        else {
            this.logger.info(line);
        }
    }
}
// ── Default helpers ───────────────────────────────────────────────────
function defaultSleep(ms, signal) {
    return new Promise((resolve) => {
        if (signal?.aborted) {
            resolve();
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
    });
}
function defaultLogger() {
    return {
        info: (msg) => console.log(msg),
        warn: (msg) => console.warn(msg),
        error: (msg) => console.error(msg),
    };
}
//# sourceMappingURL=poll-source.js.map