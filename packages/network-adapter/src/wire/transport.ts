/**
 * ITransport — Layer-4 wire surface for the network-adapter package.
 *
 * Phase 1: types only. Zero runtime change. The real implementation
 * (`McpTransport`) lands in Phase 2, extracted out of the current
 * `McpConnectionManager`.
 *
 * ## Responsibility boundary
 *
 * A Transport owns exactly one logical wire to a Hub. It is responsible
 * for:
 *
 *   1. Opening and closing that wire.
 *   2. Shipping untyped request/response pairs over it (`request`).
 *   3. Enumerating what method names the remote peer advertises
 *      (`listMethods` — used by the adapter for discovery translation).
 *   4. Surfacing liveness: a coarse 3-value `wireState` and a stream of
 *      `WireEvent`s (connected, disconnected, peer-closed, etc.).
 *   5. Wire-level reconnect policy: it transparently reconnects the
 *      underlying socket/HTTP/SSE stream on transient failure. It does
 *      NOT know about sessions, roles, handshakes, or FSM.
 *
 * It is NOT responsible for:
 *
 *   - Session lifecycle (bind/rebind/teardown). That lives on the
 *     `IAgentClient` above it.
 *   - Authentication and handshake semantics (register_role, enriched handshake).
 *   - Event classification, dedup, or state sync.
 *   - Retry-on-session-invalid (that policy is above the wire).
 *
 * ## Why untyped `request(method, params)`
 *
 * The adapter and shim above must be transport-agnostic. By keeping the
 * request surface a plain string-keyed call, the same adapter code can
 * run against a future gRPC or QUIC transport without leaking protocol
 * detail. MCP-specific encodings (tool calls, list_tools, etc.) are
 * translated inside `McpTransport`, not exposed here.
 *
 * The trade-off: type safety on the wire is the transport's problem.
 * Callers (the adapter) validate response shapes at the L7 seam.
 */

import type { ILogger, LegacyStringLogger } from "../logger.js";

/**
 * Coarse-grained wire state.
 *
 * Deliberately only three values — the transport does NOT model a
 * session FSM. "connected" means "the wire is up right now"; anything
 * stronger (handshake done, session bound, streaming) lives on the
 * AgentClient layer.
 */
export type WireState = "disconnected" | "connecting" | "connected";

/**
 * Why the wire reconnected. A narrower vocabulary than
 * `SessionReconnectReason` (in `agent-client.ts`), because the
 * transport doesn't classify session-level failures.
 */
export type WireReconnectCause =
  | "sse_watchdog"       // mid-stream keepalive gap
  | "sse_never_opened"   // first keepalive missed after connect
  | "heartbeat_failed"   // heartbeat POST error
  | "peer_closed"        // remote ended the stream cleanly
  | "wire_error";        // transport-level unexpected error

/**
 * Stream of wire-level events the AgentClient subscribes to. The
 * transport emits these; the AgentClient uses them to drive its
 * session FSM. Intentionally narrow — this is the entire L4→L7 event
 * protocol.
 */
export type WireEvent =
  | { type: "state"; from: WireState; to: WireState }
  | { type: "reconnecting"; cause: WireReconnectCause }
  | { type: "reconnected" }
  | { type: "closed"; reason?: string }
  | {
      /**
       * Unsolicited inbound message from the remote (push notification,
       * server-sent event). The transport delivers the raw body and
       * the method name; the adapter decides what to do with it.
       */
      type: "push";
      method: string;
      payload: unknown;
    };

export type WireEventHandler = (event: WireEvent) => void;

/**
 * Transport configuration — minimal. Anything session- or role-related
 * belongs in `IAgentClient` config, not here.
 */
export interface TransportConfig {
  url: string;
  token?: string;

  // Wire-level timers. Defaults are transport-specific and documented
  // on the implementing class.
  heartbeatInterval?: number;
  sseKeepaliveTimeout?: number;
  firstKeepaliveDeadline?: number;
  sseWatchdogInterval?: number;
  reconnectDelay?: number;

  /**
   * Logger injection. Preferred is `ILogger`; the string variant is a
   * Phase-2 migration aid so existing string-logger call sites can
   * wire up a transport without being rewritten first.
   */
  logger?: ILogger | LegacyStringLogger;
}

/**
 * Pull-style telemetry on a Transport. Deliberately a point-in-time
 * snapshot — the log stream is the authoritative event record. These
 * counters exist so an AgentClient (or operator) can report
 * "how is this wire doing right now" without subscribing.
 */
export interface TransportMetrics {
  readonly wireState: WireState;
  readonly totalReconnects: number;
  readonly consecutiveReconnects: number;
  readonly lastReconnectCause?: WireReconnectCause;
  readonly lastKeepaliveAt?: number; // epoch ms
  readonly requestsInFlight: number;
}

export interface ITransport {
  /** Current coarse wire state. */
  readonly wireState: WireState;

  /**
   * Open the wire. Resolves when `wireState === "connected"`. Idempotent:
   * calling `connect()` on an already-connected transport is a no-op.
   */
  connect(): Promise<void>;

  /**
   * Close the wire cleanly. After this resolves, `wireState === "disconnected"`
   * and no further `WireEvent`s will be delivered except a final
   * `{type:"state", to:"disconnected"}` if one hasn't fired yet.
   */
  close(): Promise<void>;

  /**
   * Ship an untyped request/response pair over the wire.
   *
   * Protocol framing is the transport's problem. Session-invalid
   * classification is NOT — callers receive the raw error and decide
   * whether to reconnect at the session layer.
   */
  request(method: string, params: Record<string, unknown>): Promise<unknown>;

  /**
   * Enumerate the method names currently advertised by the remote peer.
   * Used by the AgentClient for discovery translation: it rewrites this
   * list into an `IAgentClient`-shaped descriptor set exposed to shims.
   *
   * The return shape is intentionally `string[]` rather than full
   * JSON-schema descriptors — richer discovery, if needed, is a
   * future extension via an optional second method. Keeping the minimum
   * here means every transport can satisfy it cheaply.
   */
  listMethods(): Promise<string[]>;

  /** Subscribe to the wire-event stream. Multiple subscribers allowed. */
  onWireEvent(handler: WireEventHandler): void;

  /** Point-in-time snapshot of wire-level telemetry. */
  getMetrics(): TransportMetrics;

  /**
   * Current wire-level session id, if any. For MCP this is the
   * StreamableHTTP session id issued by the server; for a loopback
   * transport it's a synthetic handle. Undefined before first `connect()`.
   */
  getSessionId(): string | undefined;
}
