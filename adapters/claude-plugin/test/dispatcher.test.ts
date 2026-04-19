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
