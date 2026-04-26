/**
 * McpTransport — first `ITransport` implementation, backed by the MCP
 * SDK's `Client` + `StreamableHTTPClientTransport`.
 *
 * Phase 2 of the L4/L7 refactor: extracted alongside the existing
 * `McpConnectionManager`, which stays intact for the rest of the
 * migration. Nothing in the current runtime uses this file yet — it
 * exists so the Phase-2 gap tests can exercise the L4 surface in
 * isolation and prove the split holds before Phase 3 relocates the
 * session FSM.
 *
 * ## What this class owns (L4)
 *
 *   - The MCP wire: SDK `Client` + `StreamableHTTPClientTransport`.
 *   - SSE liveness: first-keepalive deadline, mid-stream watchdog,
 *     heartbeat POST loop.
 *   - Wire-level reconnection: on SSE death or heartbeat failure it
 *     tears down the SDK client and rebuilds a fresh one. Callers see
 *     only `reconnecting` + `reconnected` wire events.
 *   - Untyped `request(method, params)` over MCP `callTool`.
 *   - `listMethods()` via MCP `listTools`.
 *
 * ## What this class deliberately does NOT own
 *
 *   - `register_role`. The bare register_role call that the legacy
 *     `McpConnectionManager` fires during `connect()` is a session
 *     concern — it binds the MCP session to an engineer role on the
 *     Hub. `McpTransport.connect()` returns once the MCP wire is
 *     initialized, *without* calling register_role. The caller
 *     (future `IAgentClient`) issues the role call via
 *     `transport.request("register_role", {role})` itself.
 *   - Session FSM. No synchronizing / streaming vocabulary, no
 *     sync buffer, no `completeSync()`.
 *   - `session_invalid` classification and retry. Callers see the
 *     raw error from `request()` and reconnect at the session layer.
 *
 * ## Hub-event push delivery
 *
 * SSE notifications land on the MCP client's `LoggingMessageNotification`
 * handler. This class splits them into two streams:
 *
 *   - `logger === "keepalive"` frames feed the SSE watchdog and are
 *     NOT forwarded to subscribers — they are wire noise.
 *   - `logger === "hub-event"` frames are emitted as
 *     `{ type: "push", method: "hub-event", payload }` via the
 *     `onWireEvent` stream. Classification, dedup, and routing happen
 *     above this layer.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

import type {
  ITransport,
  TransportConfig,
  TransportMetrics,
  WireState,
  WireReconnectCause,
  WireEvent,
  WireEventHandler,
} from "./transport.js";
import type { ILogger } from "../logger.js";
import { normalizeToILogger } from "../logger.js";

/**
 * Wire-level reconnect backoff curve. Pure function so the invariant
 * (start at `baseDelay`, double each consecutive failure, clamp at
 * `maxDelay`) is unit-testable without spinning a real wire.
 *
 * The cap on the exponent (`6`) matches the legacy manager: after six
 * consecutive failures we're pegged at 60s and further failures don't
 * push the delay higher — they just sit at the cap until a keepalive
 * arrives and resets `consecutiveReconnects` to zero.
 */
export function computeReconnectBackoff(
  consecutiveReconnects: number,
  baseDelay: number,
  maxDelay: number = 60_000
): number {
  const exp = Math.min(Math.max(consecutiveReconnects, 0), 6);
  return Math.min(baseDelay * Math.pow(2, exp), maxDelay);
}

interface ResolvedConfig {
  url: string;
  token?: string;
  heartbeatInterval: number;
  sseKeepaliveTimeout: number;
  firstKeepaliveDeadline: number;
  sseWatchdogInterval: number;
  reconnectDelay: number;
  getLastEventId?: () => string | undefined;
}

export class McpTransport implements ITransport {
  private readonly cfg: ResolvedConfig;
  private readonly log: ILogger;

  private client: Client | null = null;
  private sdkTransport: StreamableHTTPClientTransport | null = null;

  private _wireState: WireState = "disconnected";
  private handlers: WireEventHandler[] = [];

  // SSE liveness
  private lastKeepaliveAt = 0;
  private sseVerified = false;

  // Timers
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sseWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private firstKeepaliveTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Metrics
  private totalReconnects = 0;
  private consecutiveReconnects = 0;
  private lastReconnectCause?: WireReconnectCause;
  private requestsInFlight = 0;

  // Re-entrancy guard: prevents overlapping reconnects.
  private reconnecting = false;
  // True once `close()` was called — suppresses further reconnect attempts.
  private closed = false;

  constructor(config: TransportConfig) {
    this.cfg = {
      url: config.url,
      token: config.token,
      heartbeatInterval: config.heartbeatInterval ?? 30_000,
      sseKeepaliveTimeout: config.sseKeepaliveTimeout ?? 90_000,
      firstKeepaliveDeadline: config.firstKeepaliveDeadline ?? 60_000,
      sseWatchdogInterval: config.sseWatchdogInterval ?? 30_000,
      reconnectDelay: config.reconnectDelay ?? 5_000,
      getLastEventId: config.getLastEventId,
    };
    this.log = normalizeToILogger(config.logger, "McpTransport");
  }

  // ── ITransport: public surface ──────────────────────────────────────

  get wireState(): WireState {
    return this._wireState;
  }

  async connect(): Promise<void> {
    if (this._wireState === "connected" || this._wireState === "connecting") {
      this.log.log(
        "transport.connect.ignored",
        { wireState: this._wireState },
        `connect() ignored in wireState=${this._wireState}`
      );
      return;
    }
    this.closed = false;
    this.transition("connecting");
    try {
      await this.createWire();
      this.transition("connected");
      this.startHeartbeat();
      this.startSseWatchdog();
      this.startFirstKeepaliveDeadline();
    } catch (err) {
      this.log.log(
        "transport.connect.failed",
        { error: String(err) },
        `connect failed: ${err}`
      );
      this.transition("disconnected");
      throw err;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.cancelReconnectTimer();
    this.stopHeartbeat();
    this.stopSseWatchdog();
    this.cancelFirstKeepaliveDeadline();
    const wasConnected = this._wireState !== "disconnected";
    this.transition("disconnected");
    await this.teardownWire();
    if (wasConnected) {
      this.emit({ type: "closed", reason: "caller-closed" });
    }
  }

  async request(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    if (this._wireState !== "connected" || !this.client) {
      throw new Error(`McpTransport.request: wire is ${this._wireState}`);
    }
    this.requestsInFlight++;
    try {
      const result = await this.client.callTool({
        name: method,
        arguments: params,
      });
      const content = result.content as Array<{ type: string; text?: string }>;
      if (content?.[0]?.text) {
        try {
          return JSON.parse(content[0].text);
        } catch {
          return content[0].text;
        }
      }
      return null;
    } finally {
      this.requestsInFlight--;
    }
  }

  async listMethods(): Promise<string[]> {
    if (this._wireState !== "connected" || !this.client) return [];
    try {
      const { tools } = await this.client.listTools();
      return tools.map((t) => t.name);
    } catch {
      return [];
    }
  }

  /**
   * Escape hatch for shims that need full MCP tool definitions
   * (name + inputSchema + description), not just method names.
   * Consumed by proxy shims that re-advertise the Hub's tool surface
   * to another MCP client (e.g. Claude Code stdio proxy).
   */
  async listToolsRaw(): Promise<Array<Record<string, unknown>>> {
    if (this._wireState !== "connected" || !this.client) return [];
    try {
      const { tools } = await this.client.listTools();
      return tools as unknown as Array<Record<string, unknown>>;
    } catch {
      return [];
    }
  }

  onWireEvent(handler: WireEventHandler): void {
    this.handlers.push(handler);
  }

  getMetrics(): TransportMetrics {
    return {
      wireState: this._wireState,
      totalReconnects: this.totalReconnects,
      consecutiveReconnects: this.consecutiveReconnects,
      lastReconnectCause: this.lastReconnectCause,
      lastKeepaliveAt: this.lastKeepaliveAt || undefined,
      requestsInFlight: this.requestsInFlight,
    };
  }

  /**
   * Test-only helper. Session IDs are an MCP-specific concept exposed
   * here so Phase-2 integration tests can assert that a wire reconnect
   * rebuilds the session. Not part of `ITransport`.
   */
  getSessionId(): string | undefined {
    return this.sdkTransport?.sessionId ?? undefined;
  }

  // ── Internal: wire lifecycle ────────────────────────────────────────

  private async createWire(): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.cfg.token) {
      headers["Authorization"] = `Bearer ${this.cfg.token}`;
    }
    // Mission-56 W2.2: attach `Last-Event-ID` when the layer above
    // (McpAgentClient) has observed at least one Hub event. The Hub's
    // W1b wrapper backfills Messages with id > lastEventId before
    // resuming live emit. Cold-start (provider returns undefined or no
    // provider configured) falls through to the stream-all-with-soft-cap
    // path on the Hub side.
    const lastEventId = this.cfg.getLastEventId?.();
    if (lastEventId !== undefined && lastEventId !== "") {
      headers["Last-Event-ID"] = lastEventId;
    }

    // Same rationale as McpConnectionManager: disable the SDK's
    // internal SSE reconnection so our watchdog is the single authority
    // for liveness. A split-brain where the SDK reopens the stream
    // internally would leave our notification handler wired to the
    // dead one.
    this.sdkTransport = new StreamableHTTPClientTransport(
      new URL(this.cfg.url),
      {
        requestInit: { headers },
        reconnectionOptions: {
          initialReconnectionDelay: 1000,
          maxReconnectionDelay: 30_000,
          reconnectionDelayGrowFactor: 1.5,
          maxRetries: 0,
        },
      }
    );

    this.client = new Client(
      { name: "ois-mcp-transport", version: "1.0.0" },
      { capabilities: {} }
    );

    this.sseVerified = false;
    this.lastKeepaliveAt = 0;

    this.client.setNotificationHandler(
      LoggingMessageNotificationSchema,
      (notification) => {
        const params = notification.params;
        if (!params) return;

        if (params.logger === "keepalive") {
          this.lastKeepaliveAt = Date.now();
          if (!this.sseVerified) {
            this.sseVerified = true;
            this.cancelFirstKeepaliveDeadline();
            this.log.log(
              "transport.sse.verified",
              undefined,
              "SSE verified (first keepalive received)"
            );
          }
          return;
        }

        if (params.logger === "hub-event" && params.data) {
          this.emit({
            type: "push",
            method: "hub-event",
            payload: params.data,
          });
        }
      }
    );

    this.sdkTransport.onclose = () => {
      this.log.log(
        "transport.sdk.onclose",
        undefined,
        "SDK transport onclose fired"
      );
      if (this._wireState === "connected") {
        void this.reconnectWire("peer_closed");
      }
    };
    this.sdkTransport.onerror = (err: Error) => {
      this.log.log(
        "transport.sdk.onerror",
        { error: err?.message || String(err) },
        `SDK transport onerror: ${err?.message || err}`
      );
      if (this._wireState === "connected") {
        void this.reconnectWire("wire_error");
      }
    };
    this.client.onerror = (err: Error) => {
      this.log.log(
        "transport.client.onerror",
        { error: err?.message || String(err) },
        `SDK client onerror: ${err?.message || err}`
      );
    };

    await this.client.connect(this.sdkTransport);
    this.log.log("transport.wire.initialized", undefined, "MCP wire initialized");
  }

  private async teardownWire(): Promise<void> {
    const oldClient = this.client;
    this.client = null;
    this.sdkTransport = null;
    this.stopHeartbeat();
    this.stopSseWatchdog();
    this.cancelFirstKeepaliveDeadline();
    if (oldClient) {
      try {
        await oldClient.close();
      } catch {
        // expected on dead wires
      }
    }
    // Let any in-flight SSE callbacks settle before the next wire opens.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  /**
   * Wire-level reconnect loop. Entered on any wire-death signal
   * (SSE drop, heartbeat failure, transport error). Emits
   * `reconnecting` + (on success) `reconnected` wire events so the
   * AgentClient above can re-run its L7 handshake.
   */
  private async reconnectWire(cause: WireReconnectCause): Promise<void> {
    if (this.reconnecting || this.closed) return;
    this.reconnecting = true;

    this.totalReconnects++;
    this.consecutiveReconnects++;
    this.lastReconnectCause = cause;

    this.log.log(
      "transport.reconnect.start",
      { cause, consecutive: this.consecutiveReconnects },
      `reconnectWire: cause=${cause}, consecutive=${this.consecutiveReconnects}`
    );
    this.emit({ type: "reconnecting", cause });

    this.transition("connecting");
    await this.teardownWire();

    try {
      await this.createWire();
      if (this.closed) {
        // close() called mid-reconnect — bail out.
        await this.teardownWire();
        this.transition("disconnected");
        return;
      }
      this.transition("connected");
      this.startHeartbeat();
      this.startSseWatchdog();
      this.startFirstKeepaliveDeadline();
      this.emit({ type: "reconnected" });
    } catch (err) {
      this.log.log(
        "transport.reconnect.failed",
        { cause, error: String(err) },
        `reconnectWire failed: ${err}`
      );
      this.transition("disconnected");
      this.scheduleReconnectTimer(cause);
    } finally {
      this.reconnecting = false;
    }
  }

  private scheduleReconnectTimer(cause: WireReconnectCause): void {
    if (this.closed) return;
    this.cancelReconnectTimer();
    const backoff = computeReconnectBackoff(
      this.consecutiveReconnects,
      this.cfg.reconnectDelay
    );
    this.log.log(
      "transport.reconnect.retry_scheduled",
      { cause, backoffMs: backoff },
      `scheduling retry in ${backoff}ms`
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnectWire(cause);
    }, backoff);
  }

  private cancelReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ── Internal: liveness timers ───────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      if (this._wireState !== "connected" || !this.client) return;
      try {
        await this.client.listTools();
      } catch {
        this.log.log(
          "transport.heartbeat.failed",
          undefined,
          "heartbeat failed, triggering wire reconnect"
        );
        void this.reconnectWire("heartbeat_failed");
      }
    }, this.cfg.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private startSseWatchdog(): void {
    this.stopSseWatchdog();
    this.sseWatchdogTimer = setInterval(() => {
      if (this._wireState !== "connected") return;
      if (!this.sseVerified) return;
      const gap = Date.now() - this.lastKeepaliveAt;
      if (gap > this.cfg.sseKeepaliveTimeout) {
        this.log.log(
          "transport.sse.watchdog.fired",
          { gapMs: gap, thresholdMs: this.cfg.sseKeepaliveTimeout },
          `SSE watchdog: ${Math.round(gap / 1000)}s without keepalive (threshold ${this.cfg.sseKeepaliveTimeout / 1000}s)`
        );
        void this.reconnectWire("sse_watchdog");
      }
    }, this.cfg.sseWatchdogInterval);
  }

  private stopSseWatchdog(): void {
    if (this.sseWatchdogTimer) {
      clearInterval(this.sseWatchdogTimer);
      this.sseWatchdogTimer = null;
    }
  }

  private startFirstKeepaliveDeadline(): void {
    this.cancelFirstKeepaliveDeadline();
    this.firstKeepaliveTimer = setTimeout(() => {
      this.firstKeepaliveTimer = null;
      if (this._wireState !== "connected") return;
      if (this.sseVerified) return;
      this.log.log(
        "transport.sse.never_opened",
        { deadlineMs: this.cfg.firstKeepaliveDeadline },
        `first keepalive deadline: ${this.cfg.firstKeepaliveDeadline}ms elapsed without SSE`
      );
      void this.reconnectWire("sse_never_opened");
    }, this.cfg.firstKeepaliveDeadline);
  }

  private cancelFirstKeepaliveDeadline(): void {
    if (this.firstKeepaliveTimer) {
      clearTimeout(this.firstKeepaliveTimer);
      this.firstKeepaliveTimer = null;
    }
  }

  // ── Internal: state + event emission ────────────────────────────────

  private transition(to: WireState): void {
    if (this._wireState === to) return;
    const from = this._wireState;
    this._wireState = to;
    if (to === "connected") {
      this.consecutiveReconnects = 0;
    }
    this.log.log(
      "transport.wire.state",
      { from, to },
      `wire ${from} → ${to}`
    );
    this.emit({ type: "state", from, to });
  }

  private emit(event: WireEvent): void {
    for (const h of this.handlers) {
      try {
        h(event);
      } catch (err) {
        this.log.log(
          "transport.handler.error",
          { error: String(err) },
          `wire-event handler error: ${err}`
        );
      }
    }
  }
}
