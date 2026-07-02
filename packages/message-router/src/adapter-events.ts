/**
 * adapter-events.ts — the Message-union payload contract.
 *
 * bug-160: these four types are the payloads the L2 MessageRouter routes (they
 * appear directly in the `Message` union + the router callbacks). They were
 * originally declared in @apnex/network-adapter (the L4 kernel), but the router
 * (`message.ts` / `message-router.ts`) imported them back — a circular SOURCE
 * dependency (L2 ↔ L4) that esbuild tolerates for the bundle but standalone tsc
 * cannot emit `.d.ts` for. Relocating the contract DOWN to the message layer
 * makes the dependency acyclic (only L4 → L2 remains) and gives a single source
 * of truth — the unification the `AgentEvent` doc-comment anticipated.
 *
 * @apnex/network-adapter re-exports these from its index, so existing consumers
 * importing them from the adapter are unaffected.
 */

/** Lifecycle phases of an agent session (transport/kernel-driven). */
export type SessionState =
  | "disconnected"
  | "connecting"
  | "synchronizing"
  | "streaming"
  | "reconnecting";

/** Classifies why a session re-entered `reconnecting`. */
export type SessionReconnectReason =
  | "heartbeat_failed"   // heartbeat POST failed
  | "sse_watchdog"       // no keepalive received within threshold
  | "sse_never_opened"   // first keepalive never arrived after connect
  | "session_invalid";   // Hub rejected session (redeploy, expiry)

/**
 * Classified hub event delivered to the shim. Mirrors the `HubEvent` shape from
 * the adapter's event-router; kept as a distinct surface so the AgentClient /
 * router contract can be consumed without importing the router internals.
 */
export interface AgentEvent {
  readonly id?: number | string;
  readonly event: string;
  readonly data: Record<string, unknown>;
  readonly timestamp?: string;
  readonly targetRoles?: readonly string[];
}

/**
 * A pending action drained from the Hub (ADR-017 drain-on-wake). `id` is the
 * queue item's surrogate ID which MUST be threaded back as `sourceQueueItemId`
 * on the settling tool call (e.g. create_thread_reply) for completion-ACK.
 */
export interface DrainedPendingAction {
  id: string;
  dispatchType: string;             // e.g. "thread_message"
  entityRef: string;                // e.g. "thread-137"
  payload: Record<string, unknown>; // original dispatch payload
}
