/**
 * McpAgentClient — Layer-7 `IAgentClient` implementation built on top
 * of `McpTransport`.
 *
 * Phase 3 of the L4/L7 refactor. This class owns everything that
 * `McpConnectionManager` + `UniversalClientAdapter` together own today:
 *
 *   - The session FSM (disconnected → connecting → synchronizing →
 *     streaming → reconnecting).
 *   - Role registration. Plain `register_role` when `handshake` is omitted;
 *     the full enriched handshake via `performHandshake` when `handshake`
 *     is supplied.
 *   - State sync on entry to `synchronizing` (`get_task` +
 *     `get_pending_actions` via `performStateSync`).
 *   - `session_invalid` retry-once on `call()`: close the wire, reopen,
 *     re-handshake, retry the failed call exactly once on the fresh
 *     session.
 *   - Hub-event dedup, classification (actionable / informational /
 *     unhandled), and routing into the shim callbacks.
 *   - SyncBuffer: hub-events that arrive while the session is
 *     `synchronizing` or `reconnecting` are buffered and flushed on
 *     entry to `streaming`, so shims never observe events from a
 *     half-bound session.
 *
 * It is NOT responsible for wire framing, SSE watchdogs, heartbeat
 * POSTs, or HTTP retries. Those live in the `McpTransport` below, which
 * this class either constructs (if a `TransportConfig` is passed) or
 * accepts by injection (so tests can swap in a fake transport).
 *
 * Runtime note: no existing consumer uses this class yet. Phase 4 will
 * swap `UniversalClientAdapter` over to this surface and delete the
 * `McpConnectionManager` path. Until then, `McpConnectionManager` stays
 * intact and this class lives alongside it.
 */

import type {
  IAgentClient,
  AgentClientConfig,
  AgentClientCallbacks,
  AgentClientMetrics,
  AgentEvent,
  SessionState,
  SessionReconnectReason,
} from "./agent-client.js";
import type {
  ITransport,
  TransportConfig,
  WireEvent,
  WireReconnectCause,
} from "./transport.js";
import type { ILogger } from "./logger.js";

import { McpTransport } from "./mcp-transport.js";
import { normalizeToILogger } from "./logger.js";
import {
  parseHubEvent,
  classifyEvent,
  createDedupFilter,
} from "./event-router.js";
import { performHandshake } from "./handshake.js";
import { performStateSync } from "./state-sync.js";

// Same list as McpConnectionManager. Matched case-insensitively.
const SESSION_INVALID_PATTERNS = [
  "No valid session ID",
  "Bad Request",
  "Session not found",
  "invalid session",
];

function isSessionInvalidError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return SESSION_INVALID_PATTERNS.some((p) => msg.includes(p.toLowerCase()));
}

export interface McpAgentClientOptions {
  /**
   * Explicit transport instance. Caller retains ownership — `stop()`
   * will NOT close a transport passed this way, to keep injection
   * ergonomic for tests. Mutually exclusive with `transportConfig`.
   *
   * Typed as `ITransport` so test harnesses can plug in a loopback
   * transport (or any future non-MCP wire) without touching this class.
   */
  transport?: ITransport;
  /**
   * Transport config. When set, the AgentClient constructs its own
   * `McpTransport` and closes it on `stop()`.
   */
  transportConfig?: TransportConfig;
  /** Dedup cache size. Default 100, matching `UniversalClientAdapter`. */
  dedupCacheSize?: number;
  /**
   * Legacy-compatible mode: when true, `runSynchronizingPhase` performs
   * the handshake(s) but does NOT run `performStateSync` or advance the
   * FSM out of `synchronizing`. The caller must drive `completeSync()`
   * manually — used by shims that own their own state-sync pipeline.
   *
   * Default false: full auto-sync (handshake → state sync → streaming).
   */
  manualSync?: boolean;
}

export class McpAgentClient implements IAgentClient {
  private readonly cfg: AgentClientConfig;
  private readonly log: ILogger;
  private readonly transport: ITransport;
  private readonly ownsTransport: boolean;
  private readonly manualSync: boolean;
  private readonly dedup: ReturnType<typeof createDedupFilter>;

  private _state: SessionState = "disconnected";
  private callbacks: AgentClientCallbacks = {};

  // Events buffered during non-streaming states so shims don't see
  // traffic from a half-bound session.
  private syncBuffer: AgentEvent[] = [];

  // Re-entrancy guard on the synchronizing phase — the transport can
  // emit `reconnected` mid-handshake in pathological cases and we must
  // not double-run.
  private synchronizingInFlight = false;

  // True while `reconnectSession()` is manually cycling the wire for a
  // session_invalid retry. Suppresses the `closed` wire event from
  // flipping the session FSM to `disconnected` — we handle FSM
  // transitions ourselves in that path.
  private sessionReconnecting = false;

  // True once `stop()` is called. Suppresses handleWireEvent work.
  private stopped = false;

  // Session identity + metrics.
  private _engineerId?: string;
  private _sessionEpoch?: number;
  private _lastEpoch = 0;

  private totalHandshakes = 0;
  private totalSessionInvalidRetries = 0;
  private dedupDropCount = 0;

  constructor(config: AgentClientConfig, options: McpAgentClientOptions = {}) {
    this.cfg = config;
    this.log = normalizeToILogger(config.logger, "McpAgentClient");
    this.manualSync = options.manualSync ?? false;
    this.dedup = createDedupFilter(options.dedupCacheSize ?? 100);

    if (options.transport && options.transportConfig) {
      throw new Error(
        "McpAgentClient: pass `transport` OR `transportConfig`, not both"
      );
    }
    if (options.transport) {
      this.transport = options.transport;
      this.ownsTransport = false;
    } else if (options.transportConfig) {
      this.transport = new McpTransport({
        ...options.transportConfig,
        logger: config.logger ?? options.transportConfig.logger,
      });
      this.ownsTransport = true;
    } else {
      throw new Error(
        "McpAgentClient: either `transport` or `transportConfig` is required"
      );
    }

    this.transport.onWireEvent((e) => this.handleWireEvent(e));
  }

  // ── IAgentClient: public surface ────────────────────────────────────

  get state(): SessionState {
    return this._state;
  }

  get isConnected(): boolean {
    return this._state === "streaming";
  }

  async start(): Promise<void> {
    if (this._state !== "disconnected") {
      this.log.log(
        "agent.start.ignored",
        { state: this._state },
        `start() ignored in state=${this._state}`
      );
      return;
    }
    this.stopped = false;
    this.transition("connecting");
    try {
      await this.transport.connect();
    } catch (err) {
      this.log.log(
        "agent.start.failed",
        { error: String(err) },
        `start: transport.connect failed: ${err}`
      );
      this.transition("disconnected");
      throw err;
    }
    // Wire is up. Now run the session bring-up. Rethrow on first-boot
    // so a non-retriable handshake failure (e.g. 401) propagates out
    // of `start()` instead of best-efforting into streaming on a
    // broken session. Wire-reconnect re-entry keeps the best-effort
    // path because a transient reconnect failure should not tear
    // the shim down.
    await this.runSynchronizingPhase({ rethrowOnFailure: true });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.syncBuffer.length = 0;
    if (this.ownsTransport) {
      await this.transport.close();
    }
    this.transition("disconnected");
    this.dedup.clear();
  }

  async call(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    if (this._state !== "streaming" && this._state !== "synchronizing") {
      throw new Error(`McpAgentClient.call: session state=${this._state}`);
    }
    try {
      return await this.transport.request(method, params);
    } catch (err) {
      if (!isSessionInvalidError(err)) throw err;
      this.totalSessionInvalidRetries++;
      this.log.log(
        "agent.session.invalid_retry",
        { method },
        `call(${method}): session_invalid — cycling session`
      );
      await this.reconnectSession("session_invalid");
      // Retry exactly once on the fresh session.
      return await this.transport.request(method, params);
    }
  }

  async listMethods(): Promise<string[]> {
    return this.transport.listMethods();
  }

  setCallbacks(callbacks: AgentClientCallbacks): void {
    this.callbacks = callbacks;
  }

  getSessionId(): string | undefined {
    return this.transport.getSessionId();
  }

  getMetrics(): AgentClientMetrics {
    return {
      sessionState: this._state,
      engineerId: this._engineerId,
      sessionEpoch: this._sessionEpoch,
      totalHandshakes: this.totalHandshakes,
      totalSessionInvalidRetries: this.totalSessionInvalidRetries,
      dedupDropCount: this.dedupDropCount,
    };
  }

  getTransport(): ITransport {
    return this.transport;
  }

  // ── Internal: FSM and wire-event glue ───────────────────────────────

  private transition(to: SessionState, reason?: SessionReconnectReason): void {
    if (this._state === to) return;
    const from = this._state;
    this._state = to;
    this.log.log(
      "agent.session.state",
      { from, to, reason },
      `session ${from} → ${to}${reason ? ` (${reason})` : ""}`
    );
    try {
      this.callbacks.onStateChange?.(to, from, reason);
    } catch (err) {
      this.log.log(
        "agent.state.handler_error",
        { error: String(err) },
        `onStateChange handler error: ${err}`
      );
    }
  }

  private handleWireEvent(event: WireEvent): void {
    if (this.stopped) return;
    switch (event.type) {
      case "push":
        if (event.method === "hub-event") this.handleHubEvent(event.payload);
        return;
      case "reconnecting":
        // Map wire cause to session reconnect reason with the same
        // vocabulary the legacy manager used. `peer_closed` and
        // `wire_error` both fall under the "sse_watchdog" bucket
        // because the session-level FSM doesn't distinguish them.
        this.transition("reconnecting", this.mapWireCause(event.cause));
        return;
      case "reconnected":
        // Transport brought up a fresh wire. Re-run the session
        // bring-up on it.
        void this.runSynchronizingPhase();
        return;
      case "closed":
        if (this.sessionReconnecting) return;
        this.transition("disconnected");
        return;
    }
  }

  private mapWireCause(cause: WireReconnectCause): SessionReconnectReason {
    switch (cause) {
      case "heartbeat_failed":
        return "heartbeat_failed";
      case "sse_never_opened":
        return "sse_never_opened";
      case "sse_watchdog":
      case "peer_closed":
      case "wire_error":
      default:
        return "sse_watchdog";
    }
  }

  // ── Internal: session bring-up (handshake + sync) ───────────────────

  private async runSynchronizingPhase(
    opts: { rethrowOnFailure?: boolean } = {}
  ): Promise<void> {
    if (this.synchronizingInFlight) {
      this.log.log(
        "agent.sync.in_flight",
        undefined,
        "runSynchronizingPhase: already in flight — skipping"
      );
      return;
    }
    this.synchronizingInFlight = true;
    try {
      this.transition("synchronizing");

      await this.runHandshake();

      if (this.manualSync) {
        // Caller owns sync. Stay in synchronizing until completeSync().
        return;
      }

      // State sync. `performStateSync` calls `completeSync` on success
      // AND on the failure path, so we always exit synchronizing.
      await performStateSync({
        executeTool: (n, a) => this.transport.request(n, a),
        completeSync: () => this.completeSyncInternal(),
        log: this.log,
        onPendingTask: this.cfg.handshake?.onPendingTask,
      });
    } catch (err) {
      this.log.log(
        "agent.sync.failed",
        { error: String(err) },
        `runSynchronizingPhase failed: ${err}`
      );
      if (opts.rethrowOnFailure) {
        // First-boot path: propagate to `start()`. Leave the session
        // in `disconnected` so the shim sees a clean failure surface.
        this.transition("disconnected");
        throw err;
      }
      if (!this.manualSync) {
        // Best-effort: flush buffer and move to streaming anyway so the
        // shim isn't stuck. A subsequent wire death will re-drive this.
        this.completeSyncInternal();
      }
    } finally {
      this.synchronizingInFlight = false;
    }
  }

  /**
   * Public sync-completion hook. Only meaningful when the client was
   * constructed with `manualSync: true`: the caller drives the
   * synchronizing → streaming transition after its own state sync is
   * done. Called automatically under `manualSync: false`.
   */
  completeSync(): void {
    this.completeSyncInternal();
  }

  private async runHandshake(): Promise<void> {
    const handshake = this.cfg.handshake;

    // Bare `register_role` first — proves the wire is alive and the
    // session is bound before spending round-trips on the enriched
    // payload. This ordering is invariant: the enriched handshake below
    // re-registers on the same session to stamp its semantics onto it.
    //
    // Labels are intentionally NOT forwarded here: the Hub's legacy
    // bare-path handler drops them silently (it doesn't create an Agent
    // entity). Labels must ride the enriched payload below so they
    // persist on the Agent and subsequent task.labels / dispatch
    // selectors pick them up.
    await this.transport.request("register_role", { role: this.cfg.role });
    this.totalHandshakes++;
    this.log.log(
      "agent.handshake.plain_ok",
      { role: this.cfg.role },
      `registered as ${this.cfg.role} (plain)`
    );

    if (!handshake) return;

    const result = await performHandshake({
      executeTool: (n, a) => this.transport.request(n, a),
      config: {
        role: this.cfg.role,
        globalInstanceId: handshake.globalInstanceId,
        clientInfo: handshake.getClientInfo(),
        proxyName: handshake.proxyName,
        proxyVersion: handshake.proxyVersion,
        transport: handshake.transport,
        sdkVersion: handshake.sdkVersion,
        llmModel: handshake.llmModel,
        labels: this.cfg.labels,
      },
      previousEpoch: this._lastEpoch,
      log: this.log,
      onFatalHalt: handshake.onFatalHalt,
    });

    this.totalHandshakes++;
    if (result.response) {
      this._lastEpoch = result.epoch;
      this._sessionEpoch = result.response.sessionEpoch;
      this._engineerId = result.response.engineerId;
      if (handshake.onHandshakeComplete) {
        try {
          handshake.onHandshakeComplete(result.response);
        } catch (err) {
          this.log.log(
            "agent.handshake.handler_error",
            { error: String(err) },
            `onHandshakeComplete handler error: ${err}`
          );
        }
      }
    }
  }

  private completeSyncInternal(): void {
    if (this._state !== "synchronizing") return;
    const buffered = this.syncBuffer.splice(0);
    this.transition("streaming");
    if (buffered.length > 0) {
      this.log.log(
        "agent.sync.flush",
        { count: buffered.length },
        `flushing ${buffered.length} buffered event(s)`
      );
      for (const ev of buffered) this.routeEvent(ev);
    }
  }

  // ── Internal: session-invalid reconnect ─────────────────────────────

  private async reconnectSession(
    reason: SessionReconnectReason
  ): Promise<void> {
    this.sessionReconnecting = true;
    try {
      this.transition("reconnecting", reason);
      await this.transport.close();
      await this.transport.connect();
    } finally {
      this.sessionReconnecting = false;
    }
    // Synchronously (well, awaited) run the bring-up before returning
    // so the retry-in-call() sees a bound session.
    await this.runSynchronizingPhase();
  }

  // ── Internal: hub-event intake ──────────────────────────────────────

  private handleHubEvent(payload: unknown): void {
    if (!payload || typeof payload !== "object") return;
    const parsed = parseHubEvent(payload as Record<string, unknown>);
    if (this.dedup.isDuplicate(parsed)) {
      this.dedupDropCount++;
      return;
    }

    const event: AgentEvent = {
      id: parsed.id,
      event: parsed.event,
      data: parsed.data,
      timestamp: parsed.timestamp,
    };

    // Buffer during any non-streaming state so shims don't see events
    // from a half-bound (or torn-down) session.
    if (this._state !== "streaming") {
      this.syncBuffer.push(event);
      return;
    }

    this.routeEvent(event);
  }

  private routeEvent(event: AgentEvent): void {
    const disposition = classifyEvent(
      event.event,
      this.cfg.role as "engineer" | "architect"
    );
    try {
      switch (disposition) {
        case "actionable":
          this.callbacks.onActionableEvent?.(event);
          return;
        case "informational":
          this.callbacks.onInformationalEvent?.(event);
          return;
        case "unhandled":
          this.log.log(
            "agent.event.unhandled",
            { event: event.event },
            `unhandled event: ${event.event}`
          );
          return;
      }
    } catch (err) {
      this.log.log(
        "agent.route.handler_error",
        { error: String(err) },
        `route handler error: ${err}`
      );
    }
  }
}
