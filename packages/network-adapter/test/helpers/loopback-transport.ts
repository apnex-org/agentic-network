/**
 * LoopbackTransport + LoopbackHub — in-memory test harness for L7.
 *
 * Purpose: exercise `McpAgentClient` without spinning up a real MCP
 * server over TCP+SSE. The transport implements `ITransport` and the
 * hub implements a dispatch table over a small set of tools
 * (`register_role`, `get_task`, `get_pending_actions`) plus a push
 * channel for hub-events.
 *
 * Why this exists:
 *   - Validates the L4/L7 seam. If L7 tests pass unchanged on a
 *     non-MCP transport, the split is load-bearing correct.
 *   - Speeds up L7 tests: no TCP, no SSE watchdog, no real timers.
 *   - Unblocks fake-clock gap tests (G1 SSE backoff, G2 replay) that
 *     fight the real MCP SDK.
 *
 * This file is test-only. It must NOT be imported from `src/`.
 *
 * Mirrors the subset of TestHub that L7 integration tests rely on:
 *   - `getToolCalls(tool)` / `getToolCallLog()` / `clearToolCallLog()`
 *   - `injectToolError(tool, message?)` for session_invalid simulation
 *   - `sendNotification(event, data, targetRoles?)` for hub-event push
 *   - `closeAllSseStreams()` for wire-death simulation
 */

import type {
  ITransport,
  TransportConfig,
  TransportMetrics,
  WireEvent,
  WireEventHandler,
  WireReconnectCause,
  WireState,
} from "../../src/wire/transport.js";

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  sessionId: string;
  at: number;
}

/**
 * Structural contract LoopbackTransport needs from its hub. Lets the
 * default `LoopbackHub` coexist with `PolicyLoopbackHub` (which plugs
 * the real Hub PolicyRouter into the same seam) without the transport
 * needing to know which flavor it's talking to.
 */
export interface ILoopbackHub {
  attach(transport: LoopbackTransport): string;
  detach(sessionId: string): void;
  dispatch(sessionId: string, method: string, args: Record<string, unknown>): Promise<unknown>;
  listMethods(): string[];
}

interface ToolErrorInjection {
  tool: string;
  errorMessage: string;
}

type ToolHandler = (
  args: Record<string, unknown>,
  ctx: { sessionId: string; hub: LoopbackHub }
) => unknown | Promise<unknown>;

export class LoopbackHub {
  private sessions = new Map<string, LoopbackTransport>();
  private toolCallLog: ToolCall[] = [];
  private errorQueue: ToolErrorInjection[] = [];
  private nextSessionId = 1;
  private nextEventId = 1;
  private engineerIds = new Map<string, string>(); // sessionId → engineerId
  private handlers: Map<string, ToolHandler> = new Map();

  constructor() {
    this.handlers.set("register_role", (args, { sessionId }) => {
      const role = args.role as string;
      this.sessions.get(sessionId)!.role = role;
      const registerCalls = this.toolCallLog.filter(
        (c) => c.tool === "register_role" && c.sessionId === sessionId
      ).length;
      const sessionEpoch = registerCalls; // includes this call
      let engineerId = this.engineerIds.get(sessionId);
      if (!engineerId) {
        engineerId = `eng-${sessionId.slice(0, 8)}`;
        this.engineerIds.set(sessionId, engineerId);
      }
      return {
        success: true,
        role,
        sessionId,
        engineerId,
        sessionEpoch,
        wasCreated: sessionEpoch === 1,
      };
    });
    this.handlers.set("get_task", () => ({ task: null }));
    this.handlers.set("get_pending_actions", () => ({ totalPending: 0 }));
  }

  /** Register a custom tool handler (test-only extension). */
  setHandler(tool: string, handler: ToolHandler): void {
    this.handlers.set(tool, handler);
  }

  attach(transport: LoopbackTransport): string {
    const sid = `loopback-${this.nextSessionId++}`;
    this.sessions.set(sid, transport);
    return sid;
  }

  detach(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.engineerIds.delete(sessionId);
  }

  async dispatch(
    sessionId: string,
    method: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    this.toolCallLog.push({ tool: method, args, sessionId, at: Date.now() });

    const injIdx = this.errorQueue.findIndex((e) => e.tool === method);
    if (injIdx !== -1) {
      const inj = this.errorQueue.splice(injIdx, 1)[0];
      throw new Error(inj.errorMessage);
    }

    const handler = this.handlers.get(method);
    if (!handler) {
      throw new Error(`LoopbackHub: no handler for method '${method}'`);
    }
    return handler(args, { sessionId, hub: this });
  }

  /** List advertised methods — matches `ITransport.listMethods()`. */
  listMethods(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Push a hub-event to every attached session whose role matches one
   * of `targetRoles`. Mirrors `TestHub.sendNotification()`.
   */
  sendNotification(
    event: string,
    data: Record<string, unknown>,
    targetRoles: string[] = ["engineer"]
  ): void {
    const payload = {
      id: this.nextEventId++,
      event,
      data,
      timestamp: new Date().toISOString(),
    };
    for (const transport of this.sessions.values()) {
      if (!transport.role) continue;
      if (!targetRoles.includes(transport.role)) continue;
      transport._deliverPush("hub-event", payload);
    }
  }

  /** Simulate wire death for every attached session. */
  closeAllSseStreams(): void {
    for (const transport of Array.from(this.sessions.values())) {
      transport._simulateWireReconnect("peer_closed");
    }
  }

  getToolCallLog(): ToolCall[] {
    return [...this.toolCallLog];
  }

  getToolCalls(tool: string): ToolCall[] {
    return this.toolCallLog.filter((c) => c.tool === tool);
  }

  clearToolCallLog(): void {
    this.toolCallLog.length = 0;
  }

  injectToolError(tool: string, errorMessage = "Session not found"): void {
    this.errorQueue.push({ tool, errorMessage });
  }

  clearToolErrors(): void {
    this.errorQueue.length = 0;
  }
}

export class LoopbackTransport implements ITransport {
  private _wireState: WireState = "disconnected";
  private _handlers: WireEventHandler[] = [];
  private _sessionId?: string;
  private totalReconnects = 0;
  private consecutiveReconnects = 0;
  private lastReconnectCause?: WireReconnectCause;
  private requestsInFlight = 0;

  /**
   * Role stamped by the hub's `register_role` handler. Used by
   * `sendNotification` to route pushes; not part of `ITransport`.
   */
  public role?: string;

  constructor(private readonly hub: ILoopbackHub) {}

  get wireState(): WireState {
    return this._wireState;
  }

  async connect(): Promise<void> {
    if (this._wireState === "connected") return;
    this.transitionWire("connecting");
    this._sessionId = this.hub.attach(this);
    this.transitionWire("connected");
  }

  async close(): Promise<void> {
    if (this._wireState === "disconnected") return;
    if (this._sessionId) this.hub.detach(this._sessionId);
    this._sessionId = undefined;
    this.role = undefined;
    this.transitionWire("disconnected");
    this.emit({ type: "closed" });
  }

  async request(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    if (this._wireState !== "connected" || !this._sessionId) {
      throw new Error(`LoopbackTransport.request: wireState=${this._wireState}`);
    }
    this.requestsInFlight++;
    try {
      return await this.hub.dispatch(this._sessionId, method, params);
    } finally {
      this.requestsInFlight--;
    }
  }

  async listMethods(): Promise<string[]> {
    return this.hub.listMethods();
  }

  /**
   * Mirrors `McpTransport.listToolsRaw()` — returns full tool descriptors
   * (name + inputSchema stub) so shim dispatchers that re-advertise the
   * Hub's tool surface to a downstream MCP client can exercise their
   * `ListToolsRequest` wiring through the loopback.
   *
   * Loopback fidelity: the Hub's real tool schemas live in the policy
   * registrations (Zod), not in a tool-discovery response. For this
   * harness we emit `{ type: "object" }` as a valid-but-permissive
   * inputSchema — sufficient to prove the dispatcher → transport →
   * hub → re-advertise plumbing works end-to-end. Tests that need
   * schema-level fidelity should drive real MCP against the Hub.
   */
  async listToolsRaw(): Promise<Array<Record<string, unknown>>> {
    return this.hub.listMethods().map((name) => ({
      name,
      inputSchema: { type: "object" as const },
    }));
  }

  onWireEvent(handler: WireEventHandler): void {
    this._handlers.push(handler);
  }

  getMetrics(): TransportMetrics {
    return {
      wireState: this._wireState,
      totalReconnects: this.totalReconnects,
      consecutiveReconnects: this.consecutiveReconnects,
      lastReconnectCause: this.lastReconnectCause,
      requestsInFlight: this.requestsInFlight,
    };
  }

  getSessionId(): string | undefined {
    return this._sessionId;
  }

  // ── Test-only helpers ────────────────────────────────────────────────

  /** Deliver a raw push frame to the subscribed AgentClient. */
  _deliverPush(method: string, payload: unknown): void {
    if (this._wireState !== "connected") return;
    this.emit({ type: "push", method, payload });
  }

  /**
   * Simulate a transparent wire reconnect: emit `reconnecting`, rebind
   * to a fresh session id, then emit `reconnected`. The AgentClient
   * drives its own bring-up in response.
   */
  _simulateWireReconnect(cause: WireReconnectCause): void {
    if (this._wireState !== "connected") return;
    this.totalReconnects++;
    this.consecutiveReconnects++;
    this.lastReconnectCause = cause;
    this.emit({ type: "reconnecting", cause });
    // Swap the session id — mirrors what MCP does on a fresh StreamableHTTP connection.
    if (this._sessionId) this.hub.detach(this._sessionId);
    this.role = undefined;
    this._sessionId = this.hub.attach(this);
    this.emit({ type: "reconnected" });
  }

  /** Simulate a hard wire death with no reconnect. */
  _simulateWireDeath(reason?: string): void {
    if (this._wireState === "disconnected") return;
    if (this._sessionId) this.hub.detach(this._sessionId);
    this._sessionId = undefined;
    this.role = undefined;
    this.transitionWire("disconnected");
    this.emit({ type: "closed", reason });
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private transitionWire(to: WireState): void {
    if (this._wireState === to) return;
    const from = this._wireState;
    this._wireState = to;
    this.emit({ type: "state", from, to });
  }

  private emit(event: WireEvent): void {
    for (const h of this._handlers) {
      try {
        h(event);
      } catch {
        /* swallow — tests should not depend on handler errors */
      }
    }
  }
}

/** Convenience: unused `TransportConfig` placeholder for signature parity. */
export type _Unused = TransportConfig;
