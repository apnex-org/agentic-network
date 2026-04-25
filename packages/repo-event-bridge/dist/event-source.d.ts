/**
 * EventSource — sovereign-package contract for repo-event ingestion.
 *
 * Mission-52 T1. Per thread-312 round-2 ratification, the contract is
 * an async-iterator pattern: implementations expose a `[Symbol.async-
 * Iterator]()` that yields `RepoEvent` values, plus lifecycle controls
 * (`start`/`stop`) and an operator self-service `health()` probe. This
 * shape composes naturally with backpressure (consumers pull at their
 * own rate) and with modern Node ergonomics (`for await...of`).
 *
 * Capability flags advertise the source's transport posture so the Hub
 * can pick a source per environment (poll for dev/CI; webhook for
 * prod) and so operators can reason about latency + dedupe guarantees
 * without inspecting impl internals.
 *
 * Translator output is a `RepoEvent`; sink consumers receive these via
 * the iterator. The translator itself lives in `./translator.ts`.
 */
/**
 * Transport-posture declaration. Advertised on every EventSource so the
 * Hub + operators can reason about delivery semantics without reading
 * impl source.
 *
 * Minimum-viable invariants (for a production source):
 *   - `dedupe: true`          — consumer never sees the same upstream
 *                                event twice
 *   - `persistedCursor: true` — restart-safe; in-flight events survive
 *                                process exit
 *
 * Dev/in-memory sources may opt out of `persistedCursor` (volatile
 * state is acceptable for tests). `dedupe: false` is not a supported
 * production posture.
 */
export interface EventSourceCapabilities {
    /** `'webhook'` = HTTP-receiver; `'poll'` = upstream-API poller. */
    readonly transport: "webhook" | "poll";
    /** `'realtime'` = sub-second; `'periodic'` = bounded by poll cadence. */
    readonly latency: "realtime" | "periodic";
    /** `'push'` = upstream initiates; `'pull'` = source initiates. */
    readonly mode: "push" | "pull";
    /** Consumer is guaranteed at-most-once delivery per upstream event. */
    readonly dedupe: boolean;
    /** Cursor survives process restart (e.g., StorageProvider-backed). */
    readonly persistedCursor: boolean;
}
/**
 * Snapshot of the source's runtime health for operator self-service
 * diagnostics. Returned synchronously — callers must not depend on
 * I/O. `lastSuccessfulPoll` is the most recent ISO-8601 timestamp at
 * which the source successfully observed upstream state (regardless
 * of whether new events were emitted).
 *
 * `pausedReason` is set iff `paused === true`. The taxonomy is
 * deliberately small — the value drives operator response, not
 * code-path branching:
 *
 *   - `'rate-limit'`   — upstream signaled throttling; source is
 *                         honoring backoff
 *   - `'network'`      — transient connectivity loss; source will
 *                         retry
 *   - `'auth-failure'` — credentials rejected; operator action
 *                         required (rotate token, etc.)
 */
export interface EventSourceHealth {
    readonly paused: boolean;
    readonly pausedReason?: "rate-limit" | "network" | "auth-failure";
    /** ISO-8601 of the most recent successful upstream observation. */
    readonly lastSuccessfulPoll: string;
}
/**
 * The unit yielded by an EventSource iterator. Translator-shaped: a
 * `kind`/`subkind`/`payload` envelope ready for sink consumption. See
 * `./translator.ts` for the canonical subkind taxonomy.
 *
 * `kind` is fixed at `"repo-event"` so sink-side dispatch can route
 * on `kind` cleanly; per-type semantics are subkind concerns.
 */
export interface RepoEvent {
    readonly kind: "repo-event";
    readonly subkind: string;
    readonly payload: unknown;
}
/**
 * The contract every event source implements. `start()` enables
 * upstream observation (begin polling, register webhook handler);
 * `stop()` halts it. The async-iterator yields `RepoEvent`s as they
 * arrive. The iterator MAY be infinite — consumers choose when to
 * stop iterating.
 *
 * Lifecycle:
 *   - Construction MUST NOT begin upstream observation.
 *   - `start()` MUST be idempotent (safe to call when already started).
 *   - `stop()` MUST be idempotent and MUST cause the active iterator
 *     to terminate cleanly.
 *   - `health()` MAY be called at any lifecycle stage, including
 *     before `start()` and after `stop()`.
 */
export interface EventSource {
    readonly capabilities: EventSourceCapabilities;
    start(): Promise<void>;
    stop(): Promise<void>;
    health(): EventSourceHealth;
    [Symbol.asyncIterator](): AsyncIterator<RepoEvent>;
}
