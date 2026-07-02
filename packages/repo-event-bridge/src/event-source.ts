/**
 * EventSource — sovereign-package contract for repo-event ingestion.
 *
 * Mission-52 T1; coupled to inline-sink delivery at work-44/bug-190 (A).
 * The contract is lifecycle controls (`start`/`stop`) plus an operator
 * self-service `health()` probe. `start()` begins upstream observation
 * AND inline delivery to the injected `MessageSink` — the poll loop IS
 * the delivery loop, with the cursor advancing only after delivery (no
 * separate drainer, no queue between source and sink, so a delivery
 * failure can't be silently dropped). `stop()` halts it; `health()`
 * reports poll + delivery state.
 *
 * Capability flags advertise the source's transport posture so the Hub
 * can pick a source per environment (poll for dev/CI; webhook for
 * prod) and so operators can reason about latency + dedupe guarantees
 * without inspecting impl internals.
 *
 * Translator output is a `RepoEvent`; a source emits these to its sink
 * inside the poll cycle. The translator itself lives in `./translator.ts`.
 */

// ── Capabilities ─────────────────────────────────────────────────────

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

// ── Health ────────────────────────────────────────────────────────────

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
  /** work-44/bug-190 (d): ISO-8601 of the most recent fully-DELIVERED poll cycle (every fresh
   *  event emitted to the sink). The DELIVERY half of health — distinct from `lastSuccessfulPoll`
   *  (observing upstream) — so a poll-healthy-but-delivery-failing bridge is no longer dark. */
  readonly lastSuccessfulDelivery?: string;
  /** work-44/bug-190 (d): true when sink delivery is PERSISTENTLY failing (a fresh event could not
   *  be emitted after the bounded retry; the cursor was left un-advanced for auto-recovery). The
   *  loud signal `/health` surfaces so an operator intervenes BEFORE the GH event window ages out.
   *  Cleared on the next fully-delivered cycle. */
  readonly deliveryFailing?: boolean;
}

// ── Repo event ────────────────────────────────────────────────────────

/**
 * The unit a source emits to its sink. Translator-shaped: a
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

// ── EventSource contract ──────────────────────────────────────────────

/**
 * The contract every event source implements. `start()` enables upstream observation (begin
 * polling) AND inline delivery to the injected sink — the poll loop IS the delivery loop
 * (work-44/bug-190 (A): the separate drainer + bounded queue are eliminated by construction, so a
 * delivery failure can no longer be silently dropped between two loops). `stop()` halts it.
 * `health()` reports poll + delivery state.
 *
 * Lifecycle:
 *   - Construction MUST NOT begin upstream observation.
 *   - `start()` MUST be idempotent (safe to call when already started).
 *   - `stop()` MUST be idempotent and MUST halt the poll/deliver loops cleanly.
 *   - `health()` MAY be called at any lifecycle stage, including before `start()` and after `stop()`.
 */
export interface EventSource {
  readonly capabilities: EventSourceCapabilities;
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): EventSourceHealth;
}
