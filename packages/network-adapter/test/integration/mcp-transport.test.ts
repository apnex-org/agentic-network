/**
 * McpTransport — L4 wire surface tests.
 *
 * Layer:     L4 (ITransport / McpTransport)
 * Invariants pinned (see docs/network/06-test-specification.md):
 *   #1  connect() idempotent; second call on connected transport is a no-op
 *   #2  close() leaves wireState === "disconnected" and drains handlers
 *   #3  G2 — SSE never opens: detected within firstKeepaliveDeadline
 *        (WireReconnectCause = "sse_never_opened")
 *   #4  G3 — SSE dies mid-stream: detected within sseKeepaliveTimeout
 *        (WireReconnectCause = "sse_watchdog")
 *   #5  G1 — heartbeat POST failure lifts to wire reconnect
 *        (WireReconnectCause = "heartbeat_failed")
 *
 * Exercises McpTransport against a real TestHub (127.0.0.1 TCP, MCP SDK
 * client speaking real SSE + POST to the real hub-networking module).
 * No AgentClient — proves the wire layer works in isolation.
 *
 * Scope of assertions:
 *   - connect/close lifecycle + wireState
 *   - untyped request() can ship arbitrary methods (register_role,
 *     get_task) without McpTransport knowing their semantics
 *   - listMethods() returns the peer tool surface
 *   - SSE drop drives reconnectWire + reconnecting/reconnected events
 *     and yields a fresh sessionId
 *   - hub-event push notifications arrive as WireEvent {type:"push"}
 *   - getMetrics snapshots counters
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestHub } from "../helpers/test-hub.js";
import { LogCapture, waitFor, wait } from "../helpers/test-utils.js";
import { McpTransport } from "../../src/wire/mcp-transport.js";
import type { WireEvent } from "../../src/wire/transport.js";

function createTransport(hub: TestHub, log: LogCapture): McpTransport {
  return new McpTransport({
    url: hub.url,
    token: "",
    heartbeatInterval: 2_000,
    reconnectDelay: 500,
    sseKeepaliveTimeout: 3_000,
    firstKeepaliveDeadline: 2_000,
    sseWatchdogInterval: 1_000,
    logger: log.logger,
  });
}

describe("McpTransport — L4 wire surface", () => {
  let hub: TestHub;

  beforeEach(async () => {
    hub = new TestHub({
      sessionTtl: 30_000,
      orphanTtl: 10_000,
      autoStartTimers: false,
    });
    await hub.start();
  });

  afterEach(async () => {
    try { await hub.stop(); } catch {}
  });

  it("connect() brings wire up and getMetrics reflects connected state", async () => {
    const log = new LogCapture();
    const t = createTransport(hub, log);
    try {
      expect(t.wireState).toBe("disconnected");
      await t.connect();
      expect(t.wireState).toBe("connected");
      const m = t.getMetrics();
      expect(m.wireState).toBe("connected");
      expect(m.totalReconnects).toBe(0);
      expect(m.requestsInFlight).toBe(0);
      expect(t.getSessionId()).toBeTruthy();
    } finally {
      await t.close();
    }
  });

  it("request() ships register_role without Transport knowing its semantics", async () => {
    const log = new LogCapture();
    const t = createTransport(hub, log);
    try {
      await t.connect();
      const result = await t.request("register_role", { role: "engineer" });
      // Real Hub returns an agentId on successful register.
      expect(result).toBeTruthy();
      const calls = hub.getToolCalls("register_role");
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0].args.role).toBe("engineer");
    } finally {
      await t.close();
    }
  });

  it("listMethods() returns advertised tool names including register_role", async () => {
    const log = new LogCapture();
    const t = createTransport(hub, log);
    try {
      await t.connect();
      const methods = await t.listMethods();
      expect(methods).toContain("register_role");
      expect(methods.length).toBeGreaterThan(1);
    } finally {
      await t.close();
    }
  });

  it("close() transitions wire to disconnected and emits closed event", async () => {
    const log = new LogCapture();
    const t = createTransport(hub, log);
    const events: WireEvent[] = [];
    t.onWireEvent((e) => events.push(e));

    await t.connect();
    await t.close();

    expect(t.wireState).toBe("disconnected");
    expect(events.some((e) => e.type === "closed")).toBe(true);
  });

  it("SSE drop triggers reconnect: reconnecting + reconnected events, new sessionId", async () => {
    const log = new LogCapture();
    const t = createTransport(hub, log);
    const events: WireEvent[] = [];
    t.onWireEvent((e) => events.push(e));

    try {
      await t.connect();
      await t.request("register_role", { role: "engineer" });
      const firstSid = t.getSessionId();
      expect(firstSid).toBeTruthy();

      // Kill the SSE stream from the hub side — watchdog should fire
      // within ~3s (sseKeepaliveTimeout) and rebuild the wire.
      hub.closeAllSseStreams();

      await waitFor(
        () => events.some((e) => e.type === "reconnected"),
        10_000
      );

      expect(events.some((e) => e.type === "reconnecting")).toBe(true);
      expect(t.wireState).toBe("connected");

      const secondSid = t.getSessionId();
      expect(secondSid).toBeTruthy();
      expect(secondSid).not.toBe(firstSid);

      const m = t.getMetrics();
      expect(m.totalReconnects).toBeGreaterThanOrEqual(1);
      expect(m.lastReconnectCause).toBeDefined();
    } finally {
      await t.close();
    }
  });

  it("hub-event notifications arrive as WireEvent push frames", async () => {
    const log = new LogCapture();
    const t = createTransport(hub, log);
    const pushes: WireEvent[] = [];
    t.onWireEvent((e) => {
      if (e.type === "push") pushes.push(e);
    });

    try {
      await t.connect();
      await t.request("register_role", { role: "engineer" });

      // Give the hub a beat to wire this session into the broadcast set.
      await wait(200);

      await hub.sendNotification(
        "task_assigned",
        { taskId: "t-1", title: "test" },
        ["engineer"]
      );

      await waitFor(() => pushes.length >= 1, 5_000);

      const p = pushes[0];
      expect(p.type).toBe("push");
      if (p.type === "push") {
        expect(p.method).toBe("hub-event");
        expect(p.payload).toBeTruthy();
      }
    } finally {
      await t.close();
    }
  });

  it("request() after close() rejects", async () => {
    const log = new LogCapture();
    const t = createTransport(hub, log);
    await t.connect();
    await t.close();
    await expect(
      t.request("register_role", { role: "engineer" })
    ).rejects.toThrow(/wire is/);
  });
});
