/**
 * Shared dispatcher unit tests — host-independent.
 *
 * Exercises the @apnex/network-adapter MCP-boundary dispatcher (Layer 1c
 * per Design v1.2) with a minimal stub McpAgentClient; no stdio, no
 * Hub, no MCP wire.
 *
 * Key invariants pinned here:
 *   - ADR-017 Phase 1.1: SSE thread_message with inline queueItemId
 *     populates pendingActionMap (the thread-138 regression pin).
 *   - sourceQueueItemId injection on create_thread_reply uses the map.
 *   - Explicit sourceQueueItemId wins over the map (no silent override).
 *   - InitializeRequest captures clientInfo for the handshake.
 *   - Drain-path handler (dispatcher.makePendingActionItemHandler())
 *     populates map symmetrically with the SSE-path handler.
 *   - listToolsGate / callToolGate decouple slow-sync from fast-handshake.
 *   - Initialize is NOT gated (host MCP timeouts are tighter than handshake).
 */

import { describe, it, expect, vi } from "vitest";
import {
  createSharedDispatcher,
  injectQueueItemId,
  pendingKey,
  type McpAgentClient,
} from "@apnex/network-adapter";

// ── Fake agent ──────────────────────────────────────────────────────

function fakeAgent(): McpAgentClient {
  return {
    call: vi.fn().mockResolvedValue("ok"),
    listTools: vi.fn().mockResolvedValue([]),
    getTransport: vi.fn().mockReturnValue({ listToolsRaw: vi.fn().mockResolvedValue([]) }),
    setCallbacks: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    isConnected: true,
  } as unknown as McpAgentClient;
}

function makeDispatcher(extraOpts: Record<string, unknown> = {}) {
  const agent = fakeAgent();
  const dispatcher = createSharedDispatcher({
    getAgent: () => agent,
    proxyVersion: "test-1.0.0",
    ...extraOpts,
  });
  return { agent, dispatcher };
}

function getHandlers(server: ReturnType<typeof createSharedDispatcher>["createMcpServer"] extends () => infer S ? S : never): Map<string, (req: unknown) => Promise<unknown>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (server as any)._requestHandlers as Map<string, (req: unknown) => Promise<unknown>>;
}

// ── injectQueueItemId — pure helper ─────────────────────────────────

describe("injectQueueItemId", () => {
  it("injects sourceQueueItemId for create_thread_reply when map has a match", () => {
    const map = new Map([[pendingKey("thread_message", "thread-X"), "pa-123"]]);
    const out = injectQueueItemId("create_thread_reply", { threadId: "thread-X" }, map);
    expect(out).toEqual({ threadId: "thread-X", sourceQueueItemId: "pa-123" });
    expect(map.has(pendingKey("thread_message", "thread-X"))).toBe(false); // consumed
  });

  it("leaves args untouched when map has no match", () => {
    const map = new Map<string, string>();
    const args = { threadId: "thread-Y", message: "hi" };
    const out = injectQueueItemId("create_thread_reply", args, map);
    expect(out).toEqual(args);
    expect(out).not.toHaveProperty("sourceQueueItemId");
  });

  it("explicit sourceQueueItemId wins over map (no silent override)", () => {
    const map = new Map([[pendingKey("thread_message", "thread-X"), "pa-123"]]);
    const args = { threadId: "thread-X", sourceQueueItemId: "pa-external" };
    const out = injectQueueItemId("create_thread_reply", args, map);
    expect(out.sourceQueueItemId).toBe("pa-external");
    // Map entry must remain — we did not consume it (the caller was explicit).
    expect(map.get(pendingKey("thread_message", "thread-X"))).toBe("pa-123");
  });

  it("only rewrites create_thread_reply — other tool names pass through", () => {
    const map = new Map([[pendingKey("thread_message", "thread-X"), "pa-123"]]);
    const args = { threadId: "thread-X" };
    const out = injectQueueItemId("get_thread", args, map);
    expect(out).toBe(args); // reference-equal; no rewrite
    expect(map.has(pendingKey("thread_message", "thread-X"))).toBe(true);
  });

  it("missing threadId is a no-op (defensive)", () => {
    const map = new Map([[pendingKey("thread_message", "thread-X"), "pa-123"]]);
    const args: Record<string, unknown> = { message: "no thread id here" };
    const out = injectQueueItemId("create_thread_reply", args, map);
    expect(out).toBe(args);
  });
});

// ── AgentClientCallbacks ────────────────────────────────────────────

describe("dispatcher.callbacks", () => {
  it("onActionableEvent with thread_message + queueItemId populates pendingActionMap (INV-COMMS-L04 / thread-138 regression)", () => {
    const { dispatcher } = makeDispatcher();

    dispatcher.callbacks.onActionableEvent!({
      event: "thread_message",
      data: {
        threadId: "thread-Y",
        queueItemId: "pa-456",
        currentTurn: "architect",
      },
    });

    expect(dispatcher.pendingActionMap.get(pendingKey("thread_message", "thread-Y"))).toBe(
      "pa-456",
    );
  });

  it("onActionableEvent without queueItemId does NOT populate map (legacy SSE tolerated)", () => {
    const { dispatcher } = makeDispatcher();

    dispatcher.callbacks.onActionableEvent!({
      event: "thread_message",
      data: { threadId: "thread-Z", currentTurn: "architect" },
    });

    expect(dispatcher.pendingActionMap.size).toBe(0);
  });

  it("onActionableEvent for non-thread_message does not touch map", () => {
    const { dispatcher } = makeDispatcher();

    dispatcher.callbacks.onActionableEvent!({
      event: "task_issued",
      data: { taskId: "task-1", queueItemId: "pa-should-not-stick" },
    });

    expect(dispatcher.pendingActionMap.size).toBe(0);
  });

  it("onStateChange fires the logger (no throw)", () => {
    const log = vi.fn();
    const { dispatcher } = makeDispatcher({ log });
    dispatcher.callbacks.onStateChange!("connected", "disconnected");
    expect(log).toHaveBeenCalled();
  });

  it("notificationHooks bag is invoked for actionable + informational + state-change", () => {
    const onActionable = vi.fn();
    const onInfo = vi.fn();
    const onState = vi.fn();
    const { dispatcher } = makeDispatcher({
      notificationHooks: {
        onActionableEvent: onActionable,
        onInformationalEvent: onInfo,
        onStateChange: onState,
      },
    });

    dispatcher.callbacks.onActionableEvent!({ event: "task_issued", data: { taskId: "t" } });
    dispatcher.callbacks.onInformationalEvent!({ event: "info_event", data: {} });
    dispatcher.callbacks.onStateChange!("connected", "disconnected");

    expect(onActionable).toHaveBeenCalledOnce();
    expect(onInfo).toHaveBeenCalledOnce();
    expect(onState).toHaveBeenCalledOnce();
  });
});

// ── Drain-path handler (dispatcher.makePendingActionItemHandler) ────

describe("dispatcher.makePendingActionItemHandler", () => {
  it("populates pendingActionMap symmetrically with the SSE path", () => {
    const { dispatcher } = makeDispatcher();
    const handler = dispatcher.makePendingActionItemHandler();

    handler({
      id: "pa-789",
      dispatchType: "thread_message",
      entityRef: "thread-W",
      payload: {},
    });

    expect(dispatcher.pendingActionMap.get(pendingKey("thread_message", "thread-W"))).toBe(
      "pa-789",
    );
  });

  it("forwards onPendingActionItem hook when supplied", () => {
    const { dispatcher } = makeDispatcher();
    const onPending = vi.fn();
    const handler = dispatcher.makePendingActionItemHandler({ onPendingActionItem: onPending });

    const item = {
      id: "pa-hook",
      dispatchType: "thread_message" as const,
      entityRef: "thread-H",
      payload: {},
    };
    handler(item);

    expect(onPending).toHaveBeenCalledWith(item);
  });

  it("SSE path and drain path converge on the same key — last-write-wins", () => {
    const { dispatcher } = makeDispatcher();
    const drain = dispatcher.makePendingActionItemHandler();

    drain({
      id: "pa-from-drain",
      dispatchType: "thread_message",
      entityRef: "thread-R",
      payload: {},
    });
    expect(dispatcher.pendingActionMap.get(pendingKey("thread_message", "thread-R"))).toBe(
      "pa-from-drain",
    );

    dispatcher.callbacks.onActionableEvent!({
      event: "thread_message",
      data: { threadId: "thread-R", queueItemId: "pa-from-sse", currentTurn: "architect" },
    });
    expect(dispatcher.pendingActionMap.get(pendingKey("thread_message", "thread-R"))).toBe(
      "pa-from-sse",
    );
  });
});

// ── getClientInfo default ───────────────────────────────────────────

describe("dispatcher.getClientInfo", () => {
  it("defaults to unknown/0.0.0 before Initialize is received", () => {
    const { dispatcher } = makeDispatcher();
    expect(dispatcher.getClientInfo()).toEqual({ name: "unknown", version: "0.0.0" });
  });
});

// ── listToolsGate / callToolGate gating ─────────────────────────────
//
// Pins the bug-candidate-adapter-startup-race fix: Initialize must NOT
// be gated (host MCP timeouts are tighter than the Hub handshake).
// ListTools waits on listToolsGate (fast-handshake); CallTool waits on
// callToolGate (full-sync). See docs/reviews/bug-candidate-adapter-
// startup-race.md.

describe("dispatcher gates", () => {
  function makeDeferred(): {
    promise: Promise<void>;
    resolve: () => void;
    reject: (err: unknown) => void;
  } {
    let resolve!: () => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise.catch(() => { /* prevent unhandled-rejection in negative tests */ });
    return { promise, resolve, reject };
  }

  it("ListTools waits on listToolsGate before invoking agent.listTools()", async () => {
    const deferred = makeDeferred();
    const { agent, dispatcher } = makeDispatcher({ listToolsGate: deferred.promise });
    const server = dispatcher.createMcpServer();
    const handlers = getHandlers(server);
    const listToolsHandler = handlers.get("tools/list")!;

    const requestPromise = listToolsHandler({ method: "tools/list", params: {} });

    // Yield microtasks; agent.listTools must NOT have been called yet.
    await Promise.resolve();
    await Promise.resolve();
    expect(agent.listTools).not.toHaveBeenCalled();

    deferred.resolve();
    const result = await requestPromise;
    expect(agent.listTools).toHaveBeenCalledOnce();
    expect(result).toEqual({ tools: [] });
  });

  it("CallTool waits on callToolGate before invoking agent.call()", async () => {
    const deferred = makeDeferred();
    const { agent, dispatcher } = makeDispatcher({ callToolGate: deferred.promise });
    const server = dispatcher.createMcpServer();
    const handlers = getHandlers(server);
    const callToolHandler = handlers.get("tools/call")!;

    const requestPromise = callToolHandler({
      method: "tools/call",
      params: { name: "list_tele", arguments: {} },
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(agent.call).not.toHaveBeenCalled();

    deferred.resolve();
    await requestPromise;
    // Filter to list_tele calls (excludes the signal_working_started +
    // signal_working_completed fire-and-forget wrap from PR #114 W3 — see
    // TOOL_CALL_SIGNAL_SKIP). The gate semantic is "list_tele invoked
    // exactly once after gate opened", independent of wrap mechanics.
    const listTeleCalls = (agent.call as ReturnType<typeof vi.fn>).mock.calls
      .filter(([name]) => name === "list_tele");
    expect(listTeleCalls).toHaveLength(1);
    expect(listTeleCalls[0]).toEqual(["list_tele", {}]);
  });

  it("Initialize is NOT gated — MUST ack while gates pending", async () => {
    const listGate = makeDeferred(); // never resolved
    const callGate = makeDeferred(); // never resolved
    const { dispatcher } = makeDispatcher({
      listToolsGate: listGate.promise,
      callToolGate: callGate.promise,
    });
    const server = dispatcher.createMcpServer();
    const handlers = getHandlers(server);
    const initHandler = handlers.get("initialize")!;

    const result = (await initHandler({
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-host", version: "9.9.9" },
      },
    })) as { protocolVersion: string; serverInfo: { name: string; version: string } };

    expect(result.protocolVersion).toBe("2024-11-05");
    expect(result.serverInfo).toEqual({ name: "proxy", version: "test-1.0.0" });
    expect(dispatcher.getClientInfo()).toEqual({ name: "test-host", version: "9.9.9" });
  });

  it("CallTool surfaces callToolGate rejection as MCP error (not a hang)", async () => {
    const deferred = makeDeferred();
    const { agent, dispatcher } = makeDispatcher({ callToolGate: deferred.promise });
    const server = dispatcher.createMcpServer();
    const handlers = getHandlers(server);
    const callToolHandler = handlers.get("tools/call")!;

    const requestPromise = callToolHandler({
      method: "tools/call",
      params: { name: "list_tele", arguments: {} },
    });

    deferred.reject(new Error("Hub handshake failed: 401 Unauthorized"));

    const result = (await requestPromise) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Hub handshake failed");
    expect(agent.call).not.toHaveBeenCalled();
  });

  it("Omitted gates = no gating (preserves test-rig wiring)", async () => {
    const { agent, dispatcher } = makeDispatcher();
    const server = dispatcher.createMcpServer();
    const handlers = getHandlers(server);
    const callToolHandler = handlers.get("tools/call")!;

    const result = await callToolHandler({
      method: "tools/call",
      params: { name: "list_tele", arguments: {} },
    });
    // Filter to list_tele calls (excludes the signal_working_started +
    // signal_working_completed wrap from PR #114 W3). Tests the gate-omitted
    // semantic: pass-through invokes list_tele exactly once, regardless of
    // wrap mechanics.
    const listTeleCalls = (agent.call as ReturnType<typeof vi.fn>).mock.calls
      .filter(([name]) => name === "list_tele");
    expect(listTeleCalls).toHaveLength(1);
    expect(result).toBeDefined();
  });

  it("ListTools gates independently from CallTool — fast-handshake decouples slow-sync", async () => {
    const listGate = makeDeferred();
    const callGate = makeDeferred(); // never resolved here
    const { agent, dispatcher } = makeDispatcher({
      listToolsGate: listGate.promise,
      callToolGate: callGate.promise,
    });
    const server = dispatcher.createMcpServer();
    const handlers = getHandlers(server);
    const listToolsHandler = handlers.get("tools/list")!;

    const requestPromise = listToolsHandler({ method: "tools/list", params: {} });
    await Promise.resolve();
    await Promise.resolve();
    expect(agent.listTools).not.toHaveBeenCalled();

    listGate.resolve();
    const result = await requestPromise;
    expect(agent.listTools).toHaveBeenCalledOnce();
    expect(result).toEqual({ tools: [] });
  });
});

// ── Hub-not-connected error envelope ────────────────────────────────

describe("Hub-not-connected handling", () => {
  it("ListTools returns empty tools[] when getAgent() returns null", async () => {
    const dispatcher = createSharedDispatcher({
      getAgent: () => null,
      proxyVersion: "test-1.0.0",
    });
    const server = dispatcher.createMcpServer();
    const handlers = getHandlers(server);
    const listToolsHandler = handlers.get("tools/list")!;

    const result = await listToolsHandler({ method: "tools/list", params: {} });
    expect(result).toEqual({ tools: [] });
  });

  it("CallTool returns Hub-not-connected error envelope when getAgent() returns null", async () => {
    const dispatcher = createSharedDispatcher({
      getAgent: () => null,
      proxyVersion: "test-1.0.0",
    });
    const server = dispatcher.createMcpServer();
    const handlers = getHandlers(server);
    const callToolHandler = handlers.get("tools/call")!;

    const result = (await callToolHandler({
      method: "tools/call",
      params: { name: "list_tele", arguments: {} },
    })) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Hub not connected");
  });
});
