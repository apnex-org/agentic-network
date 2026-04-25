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
import { type CursorStoreOptions } from "./cursor-store.js";
import type { EventSource, EventSourceCapabilities, EventSourceHealth, RepoEvent } from "./event-source.js";
/** Authenticated GH PAT primary rate limit (req/hr). */
export declare const GH_PAT_RATE_LIMIT_PER_HOUR = 5000;
/** Default cadence per repo (seconds). */
export declare const DEFAULT_CADENCE_SECONDS = 30;
/** Default fraction of GH rate-limit available to this source. */
export declare const DEFAULT_BUDGET_FRACTION = 0.8;
export interface Logger {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
}
export interface PollSourceOptions {
    /** Repo identifiers in `owner/name` form. */
    readonly repos: readonly string[];
    /** GitHub PAT. */
    readonly token: string;
    /** Cadence per repo (seconds). Default 30s. */
    readonly cadenceSeconds?: number;
    /** Budget fraction of GH PAT rate limit. Default 0.8. */
    readonly budgetFraction?: number;
    /** GitHub API base URL (override for testing / GH Enterprise). */
    readonly baseUrl?: string;
    /** Storage backend for cursor + dedupe state. */
    readonly storage: CursorStoreOptions["storage"];
    /** Bounded LRU capacity for the dedupe set. Default 1000. */
    readonly dedupeCapacity?: number;
    /** Required PAT scopes. Defaults to `["repo", "read:org", "read:user"]`. */
    readonly requiredScopes?: readonly string[];
    /** Override fetch (for tests). */
    readonly fetch?: typeof fetch;
    /** Override sleep (for tests). Default `setTimeout`. */
    readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    /** Override clock (for tests). Default `Date.now`. */
    readonly now?: () => number;
    /** Logger. Defaults to console. */
    readonly logger?: Logger;
}
export declare class PollSource implements EventSource {
    readonly capabilities: EventSourceCapabilities;
    private readonly repos;
    private readonly cadenceMs;
    private readonly budgetFraction;
    private readonly client;
    private readonly cursorStore;
    private readonly requiredScopes;
    private readonly sleep;
    private readonly now;
    private readonly logger;
    private readonly state;
    private readonly queue;
    private readonly waiters;
    private started;
    private stopped;
    private abort?;
    private loops;
    private healthSnapshot;
    constructor(options: PollSourceOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    health(): EventSourceHealth;
    [Symbol.asyncIterator](): AsyncIterator<RepoEvent>;
    /**
     * Run exactly one poll cycle for the given repo. Returns the
     * count of emitted (post-dedupe, translated) events. Throws on
     * auth failure; signals rate-limit / transient via the health
     * snapshot for caller introspection. Exposed primarily for
     * deterministic unit testing.
     */
    pollOnce(repoId: string): Promise<{
        emitted: number;
        outcome: PollOutcome;
        resumeAtMs?: number;
    }>;
    private runLoop;
    private push;
    private setHealth;
    private sleepUnlessStopped;
    private logBudget;
}
export type PollOutcome = "ok" | "not-modified" | "rate-limit" | "transient" | "auth-failure";
