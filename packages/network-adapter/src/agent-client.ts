/**
 * IAgentClient — Layer-7 session surface for the network-adapter package.
 *
 * Phase 1: types only. Zero runtime change. The implementation that
 * satisfies this interface is the current `UniversalClientAdapter`,
 * which will be refactored in Phase 3 to own the session FSM itself
 * (currently delegated down to McpConnectionManager).
 *
 * ## Responsibility boundary
 *
 * An AgentClient sits between a shim (the application-side adapter for
 * Claude Code, OpenCode, etc.) and an `ITransport`. It owns:
 *
 *   1. The session FSM (disconnected → connecting → synchronizing →
 *      streaming → reconnecting). Phase 3 moves this out of
 *      `McpConnectionManager` and into the AgentClient implementation.
 *   2. Role registration and the enriched handshake that binds a session
 *      to an engineerId + sessionEpoch.
 *   3. State sync on entry to `synchronizing` (get_task,
 *      get_pending_actions, state reconciliation).
 *   4. Session-level reconnect policy on top of the wire: retry-once on
 *      `session_invalid`, drive the FSM across wire bounces, coordinate
 *      displacement checks (wasCreated / sessionEpoch monotonicity).
 *   5. Event classification, dedup, and routing into the shim's
 *      actionable/informational/state callbacks.
 *   6. Discovery translation — turn `ITransport.listMethods()` into the
 *      typed tool surface the shim consumes.
 *
 * It is NOT responsible for:
 *
 *   - Wire framing, SSE keepalive watchdogs, HTTP retries. All of that
 *     lives in the Transport below.
 *   - Shim-specific UX or side effects (toast formatting, prompt
 *     injection, persistence). Those live in the shim above.
 *
 * ## Shim-facing surface
 *
 * A shim is handed an `IAgentClient` and sees only `call(method, ...)`,
 * the session-state stream, and the classified-event callbacks. It
 * does not see `ITransport` and must not. Phase 6 renames the existing
 * `IClientShim` consumers onto `IAgentClient` to make this explicit.
 */

import type { ILogger, LegacyStringLogger } from "./logger.js";
import type { ITransport } from "./transport.js";
import type { HandshakeFatalError, HandshakeResponse } from "./handshake.js";

/**
 * Session FSM state exposed to shims.
 *
 *   disconnected → connecting → synchronizing → streaming
 *                                    ↑                ↓
 *                               reconnecting ← (wire death)
 *
 * Guarantees (when state === "streaming"):
 *   G1: SSE stream is proven alive (at least one keepalive received)
 *   G2: If SSE never opens, detected within firstKeepaliveDeadline
 *   G3: If SSE dies mid-stream, detected within sseKeepaliveTimeout
 *   G4: Consecutive SSE failures trigger exponential backoff
 *   G5: All reconnections carry a classified SessionReconnectReason
 */
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
 * Classified hub event delivered to the shim. Mirrors the existing
 * `HubEvent` shape from `event-router.ts` but re-declared here so the
 * AgentClient surface can be consumed without importing the router.
 * Phase 3+ will unify these back to one source of truth.
 */
export interface AgentEvent {
  readonly id?: number | string;
  readonly event: string;
  readonly data: Record<string, unknown>;
  readonly timestamp?: string;
  readonly targetRoles?: readonly string[];
}

/**
 * What a shim plugs into an AgentClient. All callbacks are optional —
 * a shim that doesn't care about, say, informational events can omit
 * the handler entirely and the AgentClient will drop them silently.
 */
export interface AgentClientCallbacks {
  onActionableEvent?: (event: AgentEvent) => void;
  onInformationalEvent?: (event: AgentEvent) => void;
  onStateChange?: (
    state: SessionState,
    previous: SessionState,
    reason?: SessionReconnectReason
  ) => void;
}

/**
 * Enriched handshake configuration. Optional — an AgentClient can run in
 * "plain" mode with only a role, in which case handshake semantics
 * collapse to the bare register_role call.
 */
export interface AgentHandshakeConfig {
  globalInstanceId: string;
  proxyName: string;
  proxyVersion: string;
  transport: string;
  sdkVersion: string;
  getClientInfo: () => { name: string; version: string };
  llmModel?: string;
  /** Fatal-code halt (agent_thrashing_detected / role_mismatch). */
  onFatalHalt?: (err: HandshakeFatalError) => void;
  /** Successful handshake callback — useful for shim state tracking. */
  onHandshakeComplete?: (response: HandshakeResponse) => void;
  /** Optional hook invoked by state-sync when a pending task is discovered. */
  onPendingTask?: (task: Record<string, unknown>) => void;
}

export interface AgentClientConfig {
  /** Role the session registers as (e.g. "engineer", "architect"). */
  role: string;
  /**
   * Mission-19 routing labels. Persisted on first-create and immutable
   * thereafter (INV-AG1). Only take effect when an enriched `handshake`
   * config is also supplied — the Hub's bare register_role handler
   * drops labels silently because it doesn't create an Agent entity.
   */
  labels?: Record<string, string>;
  /** Optional full enriched handshake. When omitted, plain register_role. */
  handshake?: AgentHandshakeConfig;
  /** Structured logger. Legacy string logger accepted during migration. */
  logger?: ILogger | LegacyStringLogger;
}

/**
 * Pull-style telemetry on an AgentClient. Separate from
 * `TransportMetrics` because the session layer has its own counters
 * (session_invalid retries, handshakes, dedup hits) that the wire
 * below has no visibility into.
 */
export interface AgentClientMetrics {
  readonly sessionState: SessionState;
  readonly engineerId?: string;
  readonly sessionEpoch?: number;
  readonly totalHandshakes: number;
  readonly totalSessionInvalidRetries: number;
  readonly dedupDropCount: number;
}

export interface IAgentClient {
  /** Current session FSM state. */
  readonly state: SessionState;

  /** True when `state === "streaming"`. Convenience alias. */
  readonly isConnected: boolean;

  /**
   * Drive the session through connecting → synchronizing → streaming.
   * Idempotent: a second start on an already-started client is a no-op.
   */
  start(): Promise<void>;

  /** Gracefully tear down the session and close the underlying wire. */
  stop(): Promise<void>;

  /**
   * Generic string-keyed call. Phase 2+: this routes through the
   * underlying `ITransport.request` for MCP-style transports, but a
   * future loopback or gRPC transport would translate here.
   *
   * On `session_invalid` classification, the AgentClient reconnects
   * and retries exactly once on the fresh session before surfacing
   * the error.
   */
  call(method: string, params: Record<string, unknown>): Promise<unknown>;

  /**
   * List the method surface currently advertised by the peer. The
   * AgentClient delegates to `ITransport.listMethods()` and may cache
   * the result; callers should treat this as a snapshot.
   */
  listMethods(): Promise<string[]>;

  /** Register shim callbacks. Replaces any previously registered set. */
  setCallbacks(callbacks: AgentClientCallbacks): void;

  /** Current session id, if any. Undefined before first connect. */
  getSessionId(): string | undefined;

  /** Point-in-time session-layer metrics. */
  getMetrics(): AgentClientMetrics;

  /**
   * Escape hatch for test harnesses and advanced shims that need to
   * observe wire-level state or metrics. Implementations MAY return
   * undefined if they're running on an in-memory / loopback transport
   * without a meaningful wire surface.
   */
  getTransport(): ITransport | undefined;
}
