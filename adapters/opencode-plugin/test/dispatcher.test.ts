/**
 * Shared dispatcher unit tests via opencode-plugin lens.
 *
 * Parallels adapters/claude-plugin/test/dispatcher.test.ts — both
 * exercise the same @apnex/network-adapter MCP-boundary dispatcher.
 *
 * Key invariants pinned here:
 *   - ADR-017 Phase 1.1: SSE thread_message with inline queueItemId
 *     populates pendingActionMap (the thread-138 regression pin).
 *   - sourceQueueItemId injection on create_thread_reply.
 *   - Explicit sourceQueueItemId wins over the map.
 *   - Drain-path handler populates map symmetrically with SSE path.
 *   - Late-binding getAgent() — dispatcher tolerates "not connected yet".
 */

import { describe, it, expect, vi } from "vitest";
import {
  createSharedDispatcher,
  injectQueueItemId,
  pendingKey,
  type McpAgentClient,
} from "@apnex/network-adapter";

function fakeAgent(overrides: Partial<McpAgentClient> = {}): McpAgentClient {
  return {
    call: vi.fn().mockResolvedValue("ok"),
    listTools: vi.fn().mockResolvedValue([]),
    getTransport: vi.fn().mockReturnValue({ listToolsRaw: vi.fn().mockResolvedValue([]) }),
    setCallbacks: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    isConnected: true,
    ...overrides,
  } as unknown as McpAgentClient;
}

// ── injectQueueItemId — pure helper ─────────────────────────────────

describe("injectQueueItemId", () => {
  it("injects sourceQueueItemId for create_thread_reply when map has a match", () => {
    const map = new Map([[pendingKey("thread_message", "thread-X"), "pa-123"]]);
    const out = injectQueueItemId("create_thread_reply", { threadId: "thread-X" }, map);
    expect(out).toEqual({ threadId: "thread-X", sourceQueueItemId: "pa-123" });
    expect(map.has(pendingKey("thread_message", "thread-X"))).toBe(false);
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
    expect(map.get(pendingKey("thread_message", "thread-X"))).toBe("pa-123");
  });

  it("only rewrites create_thread_reply — other tool names pass through", () => {
    const map = new Map([[pendingKey("thread_message", "thread-X"), "pa-123"]]);
    const args = { threadId: "thread-X" };
    const out = injectQueueItemId("get_thread", args, map);
    expect(out).toBe(args);
    expect(map.has(pendingKey("thread_message", "thread-X"))).toBe(true);
  });

  it("missing threadId is a no-op (defensive)", () => {
    const map = new Map([[pendingKey("thread_message", "thread-X"), "pa-123"]]);
    const args: Record<string, unknown> = { message: "no thread id here" };
    const out = injectQueueItemId("create_thread_reply", args, map);
    expect(out).toBe(args);
  });
});

// ── callbacks — SSE path ────────────────────────────────────────────

describe("dispatcher.callbacks", () => {
  it("onActionableEvent with thread_message + queueItemId populates pendingActionMap (INV-COMMS-L04 / thread-138 regression)", () => {
    const d = createSharedDispatcher({
      getAgent: () => fakeAgent(),
      proxyVersion: "test-1.0.0",
    });

    d.callbacks.onActionableEvent?.({
      event: "thread_message",
      data: {
        threadId: "thread-Y",
        queueItemId: "pa-456",
        currentTurn: "engineer",
      },
    });

    expect(d.pendingActionMap.get(pendingKey("thread_message", "thread-Y"))).toBe("pa-456");
  });

  it("onActionableEvent without queueItemId does NOT populate map", () => {
    const d = createSharedDispatcher({
      getAgent: () => fakeAgent(),
      proxyVersion: "test-1.0.0",
    });

    d.callbacks.onActionableEvent?.({
      event: "thread_message",
      data: { threadId: "thread-Z", currentTurn: "engineer" },
    });

    expect(d.pendingActionMap.size).toBe(0);
  });

  it("onActionableEvent for non-thread_message does not touch map", () => {
    const d = createSharedDispatcher({
      getAgent: () => fakeAgent(),
      proxyVersion: "test-1.0.0",
    });

    d.callbacks.onActionableEvent?.({
      event: "task_issued",
      data: { taskId: "task-1", queueItemId: "pa-should-not-stick" },
    });

    expect(d.pendingActionMap.size).toBe(0);
  });
});

// ── Drain-path handler ──────────────────────────────────────────────

describe("dispatcher.makePendingActionItemHandler", () => {
  it("populates pendingActionMap symmetrically with the SSE path", () => {
    const d = createSharedDispatcher({
      getAgent: () => fakeAgent(),
      proxyVersion: "test-1.0.0",
    });
    const handler = d.makePendingActionItemHandler();

    handler({
      id: "pa-789",
      dispatchType: "thread_message",
      entityRef: "thread-W",
      payload: {},
    });

    expect(d.pendingActionMap.get(pendingKey("thread_message", "thread-W"))).toBe("pa-789");
  });

  it("SSE path and drain path converge on the same key — last-write-wins", () => {
    const d = createSharedDispatcher({
      getAgent: () => fakeAgent(),
      proxyVersion: "test-1.0.0",
    });
    const drain = d.makePendingActionItemHandler();

    drain({
      id: "pa-from-drain",
      dispatchType: "thread_message",
      entityRef: "thread-R",
      payload: {},
    });
    expect(d.pendingActionMap.get(pendingKey("thread_message", "thread-R"))).toBe(
      "pa-from-drain",
    );

    d.callbacks.onActionableEvent?.({
      event: "thread_message",
      data: { threadId: "thread-R", queueItemId: "pa-from-sse", currentTurn: "engineer" },
    });
    expect(d.pendingActionMap.get(pendingKey("thread_message", "thread-R"))).toBe(
      "pa-from-sse",
    );
  });
});

// ── Late-binding getAgent() ─────────────────────────────────────────

describe("dispatcher late-binding", () => {
  it("pendingActionMap is a fresh instance per dispatcher (no cross-test bleed)", () => {
    const d1 = createSharedDispatcher({ getAgent: () => null, proxyVersion: "a" });
    const d2 = createSharedDispatcher({ getAgent: () => null, proxyVersion: "b" });
    d1.pendingActionMap.set("k1", "v1");
    expect(d2.pendingActionMap.has("k1")).toBe(false);
  });
});
