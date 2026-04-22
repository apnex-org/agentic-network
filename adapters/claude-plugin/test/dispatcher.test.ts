/**
 * Dispatcher unit tests — host-independent.
 *
 * Covers the core claude-plugin shim behaviors that previously had
 * ZERO test coverage. Each test exercises real dispatcher code with a
 * minimal stub McpAgentClient; no stdio, no Hub, no MCP wire.
 *
 * Key invariants pinned here:
 *   - ADR-017 Phase 1.1: SSE thread_message with inline queueItemId
 *     populates pendingActionMap (the thread-138 regression pin).
 *   - sourceQueueItemId injection on create_thread_reply uses the map.
 *   - Explicit sourceQueueItemId wins over the map (no silent override).
 *   - InitializeRequest captures clientInfo for the handshake.
 *   - Drain-path handler (makePendingActionItemHandler) populates map
 *     symmetrically with the SSE-path handler.
 */

import { describe, it, expect, vi } from "vitest";
import type { McpAgentClient } from "@ois/network-adapter";
import {
  createDispatcher,
  injectQueueItemId,
  makePendingActionItemHandler,
  pendingKey,
} from "../src/dispatcher.js";

// ── Fake agent ──────────────────────────────────────────────────────

function fakeAgent(): McpAgentClient {
  return {
    call: vi.fn().mockResolvedValue("ok"),
    getTransport: vi.fn().mockReturnValue({ listToolsRaw: vi.fn().mockResolvedValue([]) }),
    setCallbacks: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  } as unknown as McpAgentClient;
}

function makeDispatcher() {
  const agent = fakeAgent();
  const dispatcher = createDispatcher({
    agent,
    proxyVersion: "test-1.0.0",
  });
  return { agent, dispatcher };
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

    dispatcher.callbacks.onActionableEvent({
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

    dispatcher.callbacks.onActionableEvent({
      event: "thread_message",
      data: { threadId: "thread-Z", currentTurn: "architect" },
    });

    expect(dispatcher.pendingActionMap.size).toBe(0);
  });

  it("onActionableEvent for non-thread_message does not touch map", () => {
    const { dispatcher } = makeDispatcher();

    dispatcher.callbacks.onActionableEvent({
      event: "task_issued",
      data: { taskId: "task-1", queueItemId: "pa-should-not-stick" },
    });

    expect(dispatcher.pendingActionMap.size).toBe(0);
  });

  it("onStateChange fires the logger (no throw)", () => {
    const log = vi.fn();
    const agent = fakeAgent();
    const d = createDispatcher({ agent, proxyVersion: "t", log });
    d.callbacks.onStateChange!("connected", "disconnected");
    expect(log).toHaveBeenCalled();
  });
});

// ── Drain-path handler ──────────────────────────────────────────────

describe("makePendingActionItemHandler", () => {
  it("populates pendingActionMap symmetrically with the SSE path", () => {
    const { dispatcher } = makeDispatcher();
    const handler = makePendingActionItemHandler(dispatcher);

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

  it("SSE path and drain path converge on the same key — last-write-wins", () => {
    const { dispatcher } = makeDispatcher();
    const drain = makePendingActionItemHandler(dispatcher);

    // Drain arrives first with one id.
    drain({
      id: "pa-from-drain",
      dispatchType: "thread_message",
      entityRef: "thread-R",
      payload: {},
    });
    expect(dispatcher.pendingActionMap.get(pendingKey("thread_message", "thread-R"))).toBe(
      "pa-from-drain",
    );

    // SSE arrives later with a fresher id (the canonical one).
    dispatcher.callbacks.onActionableEvent({
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

// ── agentReady gating — pins the bug-candidate-adapter-startup-race fix ──
//
// Contract: the dispatcher must NOT block MCP `initialize` on the Hub
// handshake (Claude Code's initialize timeout is tighter than the 600–
// 1200ms handshake — the deterministic startup-failure mode that
// motivated this gate). Tool-dispatch handlers (listTools, callTool)
// MUST wait for the handshake so a race-window call doesn't throw
// `session state=connecting`. See docs/reviews/bug-candidate-adapter-
// startup-race.md.

describe("dispatcher.agentReady gating", () => {
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

  it("ListTools waits for agentReady before invoking agent.listTools()", async () => {
    const deferred = makeDeferred();
    const agent = fakeAgent();
    // Spy on the underlying transport call (agent.listTools internally
    // calls transport.listToolsRaw). Reach into the same fake the agent
    // factory wires so we can observe call-time precisely.
    const listToolsRaw = vi.fn().mockResolvedValue([]);
    (agent.getTransport as any).mockReturnValue({ listToolsRaw });
    // Override agent.listTools to call the spy directly (since the real
    // McpAgentClient.listTools wraps cognitive middleware we don't
    // exercise here).
    (agent as any).listTools = vi.fn(async () => {
      const tools = await listToolsRaw();
      return tools;
    });

    const dispatcher = createDispatcher({
      agent,
      proxyVersion: "test-1.0.0",
      agentReady: deferred.promise,
    });

    // Drive a request through the server's handler map by accessing the
    // registered handler directly. Server stores handlers internally; we
    // cast to any to reach the protected `_requestHandlers` map.
    const handlers = (dispatcher.server as any)._requestHandlers as Map<
      string,
      (req: unknown) => Promise<unknown>
    >;
    const listToolsHandler = handlers.get("tools/list");
    expect(listToolsHandler).toBeTruthy();

    const requestPromise = listToolsHandler!({
      method: "tools/list",
      params: {},
    });

    // Yield the microtask queue. agent.listTools must NOT have been
    // called yet — handler is parked on agentReady.
    await Promise.resolve();
    await Promise.resolve();
    expect((agent as any).listTools).not.toHaveBeenCalled();

    // Resolve the gate; handler should now invoke listTools.
    deferred.resolve();
    const result = await requestPromise;
    expect((agent as any).listTools).toHaveBeenCalledOnce();
    expect(result).toEqual({ tools: [] });
  });

  it("CallTool waits for agentReady before invoking agent.call()", async () => {
    const deferred = makeDeferred();
    const agent = fakeAgent();

    const dispatcher = createDispatcher({
      agent,
      proxyVersion: "test-1.0.0",
      agentReady: deferred.promise,
    });

    const handlers = (dispatcher.server as any)._requestHandlers as Map<
      string,
      (req: unknown) => Promise<unknown>
    >;
    const callToolHandler = handlers.get("tools/call");
    expect(callToolHandler).toBeTruthy();

    const requestPromise = callToolHandler!({
      method: "tools/call",
      params: { name: "list_tele", arguments: {} },
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(agent.call).not.toHaveBeenCalled();

    deferred.resolve();
    await requestPromise;
    expect(agent.call).toHaveBeenCalledOnce();
    expect(agent.call).toHaveBeenCalledWith("list_tele", {});
  });

  it("Initialize is NOT gated on agentReady — MUST ack while handshake in flight", async () => {
    const deferred = makeDeferred(); // never resolved
    const agent = fakeAgent();

    const dispatcher = createDispatcher({
      agent,
      proxyVersion: "test-1.0.0",
      agentReady: deferred.promise,
    });

    const handlers = (dispatcher.server as any)._requestHandlers as Map<
      string,
      (req: unknown) => Promise<unknown>
    >;
    const initHandler = handlers.get("initialize");
    expect(initHandler).toBeTruthy();

    // Initialize must resolve immediately, even with agentReady pending.
    const result = (await initHandler!({
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-host", version: "9.9.9" },
      },
    })) as { protocolVersion: string; serverInfo: { name: string; version: string } };

    expect(result.protocolVersion).toBe("2024-11-05");
    expect(result.serverInfo).toEqual({ name: "proxy", version: "test-1.0.0" });
    // clientInfo capture side-effect — verifies handler ran fully.
    expect(dispatcher.getClientInfo()).toEqual({ name: "test-host", version: "9.9.9" });
  });

  it("CallTool surfaces agentReady rejection as MCP error (not a hang)", async () => {
    const deferred = makeDeferred();
    const agent = fakeAgent();

    const dispatcher = createDispatcher({
      agent,
      proxyVersion: "test-1.0.0",
      agentReady: deferred.promise,
    });

    const handlers = (dispatcher.server as any)._requestHandlers as Map<
      string,
      (req: unknown) => Promise<unknown>
    >;
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
    // agent.call must never have been invoked when the gate rejected.
    expect(agent.call).not.toHaveBeenCalled();
  });

  it("Omitted agentReady = no gating (preserves legacy / test-rig wiring)", async () => {
    const agent = fakeAgent();
    const dispatcher = createDispatcher({
      agent,
      proxyVersion: "test-1.0.0",
      // agentReady deliberately omitted
    });

    const handlers = (dispatcher.server as any)._requestHandlers as Map<
      string,
      (req: unknown) => Promise<unknown>
    >;
    const callToolHandler = handlers.get("tools/call")!;

    const result = await callToolHandler({
      method: "tools/call",
      params: { name: "list_tele", arguments: {} },
    });
    expect(agent.call).toHaveBeenCalledOnce();
    expect(result).toBeDefined();
  });
});
