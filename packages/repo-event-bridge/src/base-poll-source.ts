/**
 * BasePollSource — the shared poll EventSource engine (work-44 / bug-190 PR-1).
 *
 * PollSource (/events, ETag-conditional) and WorkflowRunPollSource (/actions/runs,
 * timestamp-window + pagination + LRU) are STRATEGY-different but share the entire
 * lifecycle: scope-validated start, per-repo poll loops with the same auth/rate/transient
 * backoff classification, the bounded async-iterator queue, health, budget logging, and the
 * pollOnce SKELETON (fetch → classify → mark-success → dedupe → EMIT → COMMIT).
 *
 * This base extracts that shared ~240 lines as a template method. The source-specific parts
 * are abstract hooks: `fetchEvents` (the GH call + empty-semantics + a per-source commit
 * closure), `idOf`, `translate`, `hydrateCursor`, `createState`. The EMIT-loop + the
 * COMMIT-ORDER (emit fresh, THEN commit the cursor) live HERE in the base — so the bug-190
 * (A) coupling (PR-2: emit-via-sink-inline + advance-cursor-only-on-delivery) lands in ONE
 * place instead of both sources.
 *
 * PR-1 is BEHAVIOR-PRESERVING: the two sources keep the current two-loop (push-to-queue +
 * external drainer) model unchanged; the existing source test-suites stay green = the gate.
 */

import {
  GhApiClient,
  GhApiAuthError,
  GhApiRateLimitError,
  GhApiTransientError,
  PatScopeError,
  REQUIRED_PAT_SCOPES,
} from "./gh-api-client.js";
import {
  CursorStore,
  type CursorStoreOptions,
  type RepoCursor,
} from "./cursor-store.js";
import type {
  EventSource,
  EventSourceCapabilities,
  EventSourceHealth,
  RepoEvent,
} from "./event-source.js";

// ── Shared constants ──────────────────────────────────────────────────

/** Authenticated GH PAT primary rate limit (req/hr). */
export const GH_PAT_RATE_LIMIT_PER_HOUR = 5000;
/** Default cadence per repo (seconds). */
export const DEFAULT_CADENCE_SECONDS = 30;
/** Default fraction of GH rate-limit available to this source. */
export const DEFAULT_BUDGET_FRACTION = 0.8;
/** Backoff schedule (seconds) for generic transient failures. */
const TRANSIENT_BACKOFF_S = [1, 2, 5, 10, 30] as const;

// ── Shared types ──────────────────────────────────────────────────────

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export type PollOutcome =
  | "ok"
  | "not-modified"
  | "rate-limit"
  | "transient"
  | "auth-failure";

/** Per-repo state shared by every poll source. Subclasses extend with the
 *  source-specific cursor field (cursorEtag / cursorIsoTime). */
export interface BaseRepoState {
  cursorToken: string | null;
  dedupeToken: string | null;
  /** Most recent transient-backoff index. Reset on success. */
  transientBackoffIndex: number;
}

/**
 * The discriminated result of a source's fetch hook.
 *  - `no-events`: nothing to emit (PollSource 304 → "not-modified"; WorkflowRunPollSource
 *    empty-runs → "ok"). FAITHFUL: a `no-events` result does NOT run filterUnseen (matches
 *    each source's early-return), so the dedupe token is untouched.
 *  - `events`: candidates to dedupe + emit, plus a `commit` closure that captures the fetch
 *    result and performs the source-specific markSeen + cursor-write AFTER emit (the order the
 *    (A) coupling will gate on delivery in PR-2).
 */
export type FetchResult<TRaw> =
  | { kind: "no-events"; outcome: "not-modified" | "ok" }
  | { kind: "events"; candidates: TRaw[]; commit: (fresh: TRaw[]) => Promise<void> };

export interface BasePollSourceConfig {
  readonly repos: readonly string[];
  readonly token: string;
  readonly cadenceSeconds?: number;
  readonly budgetFraction?: number;
  readonly baseUrl?: string;
  readonly storage: CursorStoreOptions["storage"];
  readonly dedupeCapacity?: number;
  readonly requiredScopes?: readonly string[];
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly now?: () => number;
  readonly logger?: Logger;
  /** Distinct CursorStore path-prefix (WorkflowRunPollSource namespaces its cursors away
   *  from the /events PollSource). Defaults to the CursorStore default. */
  readonly cursorPathPrefix?: string;
}

// ── BasePollSource ────────────────────────────────────────────────────

export abstract class BasePollSource<TRaw, TState extends BaseRepoState>
  implements EventSource
{
  readonly capabilities: EventSourceCapabilities = Object.freeze({
    transport: "poll",
    latency: "periodic",
    mode: "pull",
    dedupe: true,
    persistedCursor: true,
  });

  protected readonly repos: readonly string[];
  protected readonly cadenceMs: number;
  private readonly budgetFraction: number;
  protected readonly client: GhApiClient;
  protected readonly cursorStore: CursorStore;
  private readonly requiredScopes: readonly string[];
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  protected readonly now: () => number;
  protected readonly logger: Logger;

  protected readonly state = new Map<string, TState>();
  private readonly queue: RepoEvent[] = [];
  private readonly waiters: Array<(value: IteratorResult<RepoEvent>) => void> = [];

  private started = false;
  protected stopped = false;
  private abort?: AbortController;
  private loops: Promise<void>[] = [];

  private healthSnapshot: EventSourceHealth = {
    paused: false,
    lastSuccessfulPoll: new Date(0).toISOString(),
  };

  constructor(config: BasePollSourceConfig) {
    this.repos = [...config.repos];
    this.cadenceMs = (config.cadenceSeconds ?? DEFAULT_CADENCE_SECONDS) * 1000;
    this.budgetFraction = config.budgetFraction ?? DEFAULT_BUDGET_FRACTION;
    this.requiredScopes = config.requiredScopes ?? REQUIRED_PAT_SCOPES;
    this.sleep = config.sleep ?? defaultSleep;
    this.now = config.now ?? Date.now;
    this.logger = config.logger ?? defaultLogger();

    this.client = new GhApiClient({
      token: config.token,
      baseUrl: config.baseUrl,
      fetch: config.fetch,
    });
    this.cursorStore = new CursorStore({
      storage: config.storage,
      dedupeCapacity: config.dedupeCapacity,
      ...(config.cursorPathPrefix !== undefined
        ? { pathPrefix: config.cursorPathPrefix }
        : {}),
    });

    for (const repoId of this.repos) {
      this.state.set(repoId, this.createState());
    }
  }

  // ── Source-specific hooks ──────────────────────────────────────

  /** Short source name for error messages (e.g. "PollSource"). */
  protected abstract get sourceName(): string;
  /** Log-line prefix (e.g. "[repo-event-bridge]"). */
  protected abstract get logPrefix(): string;
  /** Fresh per-repo state (subclass sets its source-specific cursor field). */
  protected abstract createState(): TState;
  /** Apply a hydrated cursor's source-specific value to the state (cursorToken is set by the
   *  base; this sets cursorEtag / cursorIsoTime). */
  protected abstract hydrateCursor(state: TState, value: RepoCursor | null): void;
  /** Do the source's GH fetch and classify the outcome. THROWS GhApi* errors (the base
   *  classifies them uniformly). Returns no-events or events+commit. */
  protected abstract fetchEvents(repoId: string, state: TState): Promise<FetchResult<TRaw>>;
  /** Dedupe identity for a raw event (event.id / String(run.id)). */
  protected abstract idOf(raw: TRaw): string;
  /** Translate a raw event into the RepoEvent emitted downstream. */
  protected abstract translate(raw: TRaw, repoId: string): RepoEvent;

  // ── EventSource lifecycle ──────────────────────────────────────

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.abort = new AbortController();

    // Validate scopes (fail loud per directive). PatScopeError / GhApiAuthError propagate
    // to the caller — start() is the gate.
    try {
      await this.client.validateScopes(this.requiredScopes);
    } catch (err) {
      if (err instanceof PatScopeError || err instanceof GhApiAuthError) {
        this.setHealth({ paused: true, pausedReason: "auth-failure" });
      }
      this.started = false;
      throw err;
    }

    this.logBudget();

    // Hydrate per-repo cursor/dedupe tokens from storage so the first poll's putIfMatch
    // lands cleanly.
    for (const repoId of this.repos) {
      const cursor = await this.cursorStore.readCursor(repoId);
      const state = this.state.get(repoId)!;
      state.cursorToken = cursor.token;
      this.hydrateCursor(state, cursor.value);
    }

    this.loops = this.repos.map((repoId) => this.runLoop(repoId));
  }

  async stop(): Promise<void> {
    if (!this.started || this.stopped) return;
    this.stopped = true;
    this.abort?.abort();
    await Promise.allSettled(this.loops);
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.({ value: undefined as never, done: true });
    }
  }

  health(): EventSourceHealth {
    return this.healthSnapshot;
  }

  [Symbol.asyncIterator](): AsyncIterator<RepoEvent> {
    return {
      next: (): Promise<IteratorResult<RepoEvent>> => {
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        if (this.stopped) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise((resolve) => {
          this.waiters.push(resolve);
        });
      },
      return: (): Promise<IteratorResult<RepoEvent>> => {
        return Promise.resolve({ value: undefined as never, done: true });
      },
    };
  }

  // ── Template poll cycle (shared skeleton; hooks for the strategy bits) ──

  /**
   * Run exactly one poll cycle for the given repo. Returns the count of emitted (post-dedupe,
   * translated) events. Throws on unknown errors; auth/rate/transient surface via the outcome
   * + the health snapshot. Exposed primarily for deterministic unit testing.
   */
  async pollOnce(
    repoId: string,
  ): Promise<{ emitted: number; outcome: PollOutcome; resumeAtMs?: number }> {
    const state = this.state.get(repoId);
    if (!state) throw new Error(`${this.sourceName}: unknown repoId=${repoId}`);

    let fetched: FetchResult<TRaw>;
    try {
      fetched = await this.fetchEvents(repoId, state);
    } catch (err) {
      return this.classifyPollError(err);
    }

    this.markPollSuccess(state);

    if (fetched.kind === "no-events") {
      return { emitted: 0, outcome: fetched.outcome };
    }

    const candidateIds = fetched.candidates.map((c) => this.idOf(c));
    const { unseen, token: dedupeToken } = await this.cursorStore.filterUnseen(
      repoId,
      candidateIds,
    );
    state.dedupeToken = dedupeToken;

    const unseenSet = new Set(unseen);
    const fresh = fetched.candidates.filter((c) => unseenSet.has(this.idOf(c)));

    let emitted = 0;
    for (const raw of fresh) {
      this.push(this.translate(raw, repoId));
      emitted++;
    }

    // COMMIT-ORDER: emit THEN advance the cursor (the order bug-190 (A) gates on delivery).
    await fetched.commit(fresh);

    return { emitted, outcome: "ok" };
  }

  /** Uniform auth/rate/transient classification shared by both sources' fetch hooks. */
  protected classifyPollError(err: unknown): {
    emitted: number;
    outcome: PollOutcome;
    resumeAtMs?: number;
  } {
    if (err instanceof GhApiAuthError) {
      this.setHealth({ paused: true, pausedReason: "auth-failure" });
      return { emitted: 0, outcome: "auth-failure" };
    }
    if (err instanceof GhApiRateLimitError) {
      this.setHealth({ paused: true, pausedReason: "rate-limit" });
      return { emitted: 0, outcome: "rate-limit", resumeAtMs: err.resumeAtMs };
    }
    if (err instanceof GhApiTransientError) {
      // Health flag flips when backoff breaches 30s threshold; single-call doesn't sleep —
      // the loop decides.
      return { emitted: 0, outcome: "transient" };
    }
    throw err;
  }

  protected markPollSuccess(state: TState): void {
    state.transientBackoffIndex = 0;
    this.setHealth({
      paused: false,
      lastSuccessfulPoll: new Date(this.now()).toISOString(),
    });
  }

  /** markSeen the freshly-emitted ids (bounded LRU), tolerating a write race. Shared by both
   *  sources' commit closures. */
  protected async markFreshSeen(
    repoId: string,
    state: TState,
    ids: string[],
  ): Promise<void> {
    if (ids.length === 0) return;
    try {
      state.dedupeToken = await this.cursorStore.markSeen(repoId, ids, state.dedupeToken);
    } catch {
      // Conflict: another writer raced us. Reload on the next poll; the events are already
      // emitted (downstream sink has its own idempotency for repeat protection).
      state.dedupeToken = null;
    }
  }

  // ── Internals ──────────────────────────────────────────────────

  private async runLoop(repoId: string): Promise<void> {
    while (!this.stopped) {
      const state = this.state.get(repoId)!;

      try {
        const { outcome, resumeAtMs } = await this.pollOnce(repoId);
        if (outcome === "auth-failure") {
          // Terminal — stop polling this source. Operator action required (rotate token).
          this.logger.error(
            `${this.logPrefix} PAT auth-failure on ${repoId}; halting source`,
          );
          return;
        }
        if (outcome === "rate-limit") {
          const waitMs = Math.max(0, (resumeAtMs ?? this.now() + 60_000) - this.now());
          this.logger.warn(
            `${this.logPrefix} rate-limited on ${repoId}; pausing ${Math.ceil(waitMs / 1000)}s`,
          );
          await this.sleepUnlessStopped(waitMs);
          continue;
        }
        if (outcome === "transient") {
          state.transientBackoffIndex = Math.min(
            state.transientBackoffIndex + 1,
            TRANSIENT_BACKOFF_S.length - 1,
          );
          const backoff = TRANSIENT_BACKOFF_S[state.transientBackoffIndex];
          if (backoff > 30) {
            this.setHealth({ paused: true, pausedReason: "network" });
          }
          await this.sleepUnlessStopped(backoff * 1000);
          continue;
        }
      } catch (err) {
        // Defensive: pollOnce should classify all known error paths; surface unknowns.
        this.logger.error(
          `${this.logPrefix} poll error on ${repoId}: ${(err as Error)?.message ?? String(err)}`,
        );
      }

      await this.sleepUnlessStopped(this.cadenceMs);
    }
  }

  protected push(event: RepoEvent): void {
    if (this.stopped) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }

  protected setHealth(next: Partial<EventSourceHealth>): void {
    this.healthSnapshot = { ...this.healthSnapshot, ...next };
  }

  private async sleepUnlessStopped(ms: number): Promise<void> {
    if (this.stopped) return;
    await this.sleep(ms, this.abort?.signal);
  }

  private logBudget(): void {
    const cadenceS = this.cadenceMs / 1000;
    const requestsPerHour = (this.repos.length * 3600) / cadenceS;
    const budgetCap = Math.floor(GH_PAT_RATE_LIMIT_PER_HOUR * this.budgetFraction);
    const headroomPct =
      budgetCap > 0
        ? Math.max(0, Math.round((1 - requestsPerHour / budgetCap) * 100))
        : 0;
    const line =
      `${this.logPrefix} Polling ${this.repos.length} repos × ${cadenceS}s ` +
      `cadence = ${Math.round(requestsPerHour)} req/hr ` +
      `(budget cap: ${budgetCap} req/hr; ${headroomPct}% headroom)`;
    if (requestsPerHour > budgetCap) {
      this.logger.warn(`${line} — OVER BUDGET; reduce repos or increase cadence`);
    } else {
      this.logger.info(line);
    }
  }
}

// ── Default helpers ───────────────────────────────────────────────────

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export function defaultLogger(): Logger {
  return {
    info: (msg) => console.log(msg),
    warn: (msg) => console.warn(msg),
    error: (msg) => console.error(msg),
  };
}
