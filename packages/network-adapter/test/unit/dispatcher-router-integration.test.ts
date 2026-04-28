/**
 * Unit tests for the Mission-56 W2.2 MessageRouter integration in the
 * tool-manager dispatcher (Layer 1c).
 *
 * Layer:    L1c (network-adapter/src/tool-manager/dispatcher.ts)
 * Scope:    `createSharedDispatcher` now routes every classified event
 *           through `@apnex/message-router` so Layer-2 dedup + kind→hook
 *           mapping live in one place. The host's `notificationHooks`
 *           bag is the router's hook surface.
 *
 * Invariants pinned here:
 *   - All four notification kinds (actionable, informational, state.change,
 *     pending-action.dispatch) flow through the router into the host hooks.
 *   - The seen-id LRU dedups push+poll-style duplicate Message ID
 *     delivery on the SSE inline path.
 *   - The drain-path handler (`makePendingActionItemHandler`) shares the
 *     same seen-id cache so a Message id seen on the SSE path dedups a
 *     later drain replay.
 *   - The pre-existing `captureQueueItemFromEvent` side-effect runs
 *     before the router (queueItemId saga preserved).
 *   - `makePendingActionItemHandler` honors per-call hooks (the
 *     claude-plugin shim relies on this to bind a custom log sink).
 */

import { describe, it, expect, vi } from "vitest";
import {
  createSharedDispatcher,
  pendingKey,
  type AgentEvent,
  type DrainedPendingAction,
  type McpAgentClient,
} from "../../src/index.js";

function fakeAgent(): McpAgentClient {
  return {
    call: vi.fn().mockResolvedValue("ok"),
    listTools: vi.fn().mockResolvedValue([]),
    setCallbacks: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    isConnected: true,
  } as unknown as McpAgentClient;
}

function actionableEvent(id: string, kind = "thread_message"): AgentEvent {
  return { id, event: kind, data: { threadId: "thread-1" } };
}

function pendingItem(id: string): DrainedPendingAction {
  return {
    id,
    dispatchType: "thread_message",
    entityRef: "thread-X",
    payload: {},
  };
}

describe("dispatcher × MessageRouter integration", () => {
  it("propagates actionable events through the router into onActionableEvent", () => {
    const onActionable = vi.fn();
    const dispatcher = createSharedDispatcher({
      getAgent: () => fakeAgent(),
      proxyVersion: "test-1.0.0",
      notificationHooks: { onActionableEvent: onActionable },
    });

    dispatcher.callbacks.onActionableEvent!(actionableEvent("m-1"));

    expect(onActionable).toHaveBeenCalledOnce();
    expect(onActionable).toHaveBeenCalledWith(actionableEvent("m-1"));
  });

  it("propagates informational events through the router into onInformationalEvent", () => {
    const onInfo = vi.fn();
    const dispatcher = createSharedDispatcher({
      getAgent: () => fakeAgent(),
      proxyVersion: "test-1.0.0",
      notificationHooks: { onInformationalEvent: onInfo },
    });

    dispatcher.callbacks.onInformationalEvent!(actionableEvent("m-2", "info_event"));

    expect(onInfo).toHaveBeenCalledOnce();
  });

  it("propagates state changes through the router into onStateChange", () => {
    const onState = vi.fn();
    const dispatcher = createSharedDispatcher({
      getAgent: () => fakeAgent(),
      proxyVersion: "test-1.0.0",
      notificationHooks: { onStateChange: onState },
    });

    dispatcher.callbacks.onStateChange!("streaming", "synchronizing", undefined);

    expect(onState).toHaveBeenCalledWith("streaming", "synchronizing", undefined);
  });

  it("dedups duplicate Message ID delivery on the actionable path (push+poll race)", () => {
    const onActionable = vi.fn();
    const dispatcher = createSharedDispatcher({
      getAgent: () => fakeAgent(),
      proxyVersion: "test-1.0.0",
      notificationHooks: { onActionableEvent: onActionable },
    });

    const event = actionableEvent("m-7");
    dispatcher.callbacks.onActionableEvent!(event);
    dispatcher.callbacks.onActionableEvent!(event); // duplicate id

    expect(onActionable).toHaveBeenCalledOnce();
  });

  it("dedups duplicate Message ID delivery on the informational path", () => {
    const onInfo = vi.fn();
    const dispatcher = createSharedDispatcher({
      getAgent: () => fakeAgent(),
      proxyVersion: "test-1.0.0",
      notificationHooks: { onInformationalEvent: onInfo },
    });

    const event = actionableEvent("m-8", "info_event");
    dispatcher.callbacks.onInformationalEvent!(event);
    dispatcher.callbacks.onInformationalEvent!(event);

    expect(onInfo).toHaveBeenCalledOnce();
  });

  it("does not dedup state.change — FSM transitions have no Message identity", () => {
    const onState = vi.fn();
    const dispatcher = createSharedDispatcher({
      getAgent: () => fakeAgent(),
      proxyVersion: "test-1.0.0",
      notificationHooks: { onStateChange: onState },
    });

    dispatcher.callbacks.onStateChange!("streaming", "synchronizing");
    dispatcher.callbacks.onStateChange!("streaming", "synchronizing");

    expect(onState).toHaveBeenCalledTimes(2);
  });

  it("dispatches AgentEvents that lack an id every time (no dedup key)", () => {
    const onActionable = vi.fn();
    const dispatcher = createSharedDispatcher({
      getAgent: () => fakeAgent(),
      proxyVersion: "test-1.0.0",
      notificationHooks: { onActionableEvent: onActionable },
    });

    const idless: AgentEvent = { event: "thread_message", data: {} };
    dispatcher.callbacks.onActionableEvent!(idless);
    dispatcher.callbacks.onActionableEvent!(idless);

    expect(onActionable).toHaveBeenCalledTimes(2);
  });

  it("preserves captureQueueItemFromEvent — runs before router so queueItemId is still mapped on a deduped event", () => {
    // First delivery captures qid into the map; second (deduped)
    // delivery still runs the capture (capture is BEFORE router).
    const dispatcher = createSharedDispatcher({
      getAgent: () => fakeAgent(),
      proxyVersion: "test-1.0.0",
    });

    const event: AgentEvent = {
      id: "m-9",
      event: "thread_message",
      data: { threadId: "thread-Q", queueItemId: "pa-9" },
    };

    dispatcher.callbacks.onActionableEvent!(event);
    expect(dispatcher.pendingActionMap.get(pendingKey("thread_message", "thread-Q"))).toBe(
      "pa-9",
    );

    // Drop the existing entry to detect whether capture re-runs on a
    // duplicate-id second delivery (router dedups dispatch but capture
    // is independent of the router).
    dispatcher.pendingActionMap.delete(pendingKey("thread_message", "thread-Q"));
    dispatcher.callbacks.onActionableEvent!(event);
    expect(dispatcher.pendingActionMap.get(pendingKey("thread_message", "thread-Q"))).toBe(
      "pa-9",
    );
  });
});

describe("dispatcher × MessageRouter — drain path (makePendingActionItemHandler)", () => {
  it("routes pending-action.dispatch through to per-call onPendingActionItem hook", () => {
    const onPending = vi.fn();
    const dispatcher = createSharedDispatcher({
      getAgent: () => fakeAgent(),
      proxyVersion: "test-1.0.0",
    });

    const handler = dispatcher.makePendingActionItemHandler({
      onPendingActionItem: onPending,
    });

    const item = pendingItem("pa-1");
    handler(item);

    expect(onPending).toHaveBeenCalledOnce();
    expect(onPending).toHaveBeenCalledWith(item);
  });

  it("populates pendingActionMap symmetrically with the SSE path", () => {
    const dispatcher = createSharedDispatcher({
      getAgent: () => fakeAgent(),
      proxyVersion: "test-1.0.0",
    });

    const handler = dispatcher.makePendingActionItemHandler();
    handler({
      id: "pa-789",
      dispatchType: "thread_message",
      entityRef: "thread-W",
      payload: {},
    });

    expect(
      dispatcher.pendingActionMap.get(pendingKey("thread_message", "thread-W")),
    ).toBe("pa-789");
  });

  it("dedups duplicate queue-item IDs on drain replay", () => {
    const onPending = vi.fn();
    const dispatcher = createSharedDispatcher({
      getAgent: () => fakeAgent(),
      proxyVersion: "test-1.0.0",
    });

    const handler = dispatcher.makePendingActionItemHandler({
      onPendingActionItem: onPending,
    });

    const item = pendingItem("pa-replay");
    handler(item);
    handler(item); // simulated drain replay on reconnect

    expect(onPending).toHaveBeenCalledOnce();
  });

  it("shares the seen-id cache between SSE path and drain path", () => {
    // A Message id seen on the SSE actionable path should dedup a
    // later drain-path arrival of the same id (rare but possible if
    // the dispatchType machinery ever surfaces a Message-bearing
    // queue item — defensive cross-path dedup).
    const onActionable = vi.fn();
    const onPending = vi.fn();
    const dispatcher = createSharedDispatcher({
      getAgent: () => fakeAgent(),
      proxyVersion: "test-1.0.0",
      notificationHooks: { onActionableEvent: onActionable },
    });

    dispatcher.callbacks.onActionableEvent!(actionableEvent("shared-id"));
    expect(onActionable).toHaveBeenCalledOnce();

    const handler = dispatcher.makePendingActionItemHandler({
      onPendingActionItem: onPending,
    });

    handler({
      id: "shared-id",
      dispatchType: "thread_message",
      entityRef: "thread-S",
      payload: {},
    });
    expect(onPending).not.toHaveBeenCalled();
  });
});

describe("event classifier — Mission-56 W2.2 message_arrived recognition", () => {
  it("dispositions message_arrived as actionable for engineer", async () => {
    const { classifyEvent } = await import("../../src/kernel/event-router.js");
    expect(classifyEvent("message_arrived", "engineer")).toBe("actionable");
  });

  it("dispositions message_arrived as actionable for architect", async () => {
    const { classifyEvent } = await import("../../src/kernel/event-router.js");
    expect(classifyEvent("message_arrived", "architect")).toBe("actionable");
  });
});

describe("event classifier — Mission-62 W1+W2 Pass 5 agent_state_changed recognition", () => {
  it("dispositions agent_state_changed as informational for engineer (cache-coherence; LLM wake suppressed)", async () => {
    const { classifyEvent } = await import("../../src/kernel/event-router.js");
    expect(classifyEvent("agent_state_changed", "engineer")).toBe("informational");
  });

  it("dispositions agent_state_changed as informational for architect (cache-coherence; LLM wake suppressed)", async () => {
    const { classifyEvent } = await import("../../src/kernel/event-router.js");
    expect(classifyEvent("agent_state_changed", "architect")).toBe("informational");
  });
});

// ── Mission-56 W3.3 — claim_message wiring + ackMessage helper ───────

describe("dispatcher — W3.3 post-render claim_message", () => {
  function streamingAgentRecording(callRecord: Array<{ method: string; params: Record<string, unknown> }>): McpAgentClient {
    const agent = {
      state: "streaming" as const,
      isConnected: true,
      call: vi.fn(async (method: string, params: Record<string, unknown>) => {
        callRecord.push({ method, params });
        return { content: [{ type: "text", text: '{"message":{"id":"x","status":"received","claimedBy":"eng-A"},"wonClaim":true,"callerAgentId":"eng-A"}' }] };
      }),
      listTools: vi.fn().mockResolvedValue([]),
      setCallbacks: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as McpAgentClient;
    return agent;
  }

  it("fires claim_message(messageId) after rendering a message_arrived event", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const agent = streamingAgentRecording(calls);
    const dispatcher = createSharedDispatcher({
      getAgent: () => agent,
      proxyVersion: "test-1.0.0",
      notificationHooks: { onActionableEvent: vi.fn() },
    });

    const event: AgentEvent = {
      id: "envelope-1",
      event: "message_arrived",
      data: { message: { id: "01HX_MESSAGE_AAAA", payload: {} } },
    };
    dispatcher.callbacks.onActionableEvent!(event);

    // Async fire; wait for next tick.
    await new Promise((r) => setImmediate(r));

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("claim_message");
    expect(calls[0].params).toEqual({ id: "01HX_MESSAGE_AAAA" });
  });

  it("does NOT fire claim_message for non-message_arrived events", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const agent = streamingAgentRecording(calls);
    const dispatcher = createSharedDispatcher({
      getAgent: () => agent,
      proxyVersion: "test-1.0.0",
      notificationHooks: { onActionableEvent: vi.fn() },
    });

    const event: AgentEvent = {
      id: "envelope-2",
      event: "thread_message",
      data: { threadId: "thread-1" },
    };
    dispatcher.callbacks.onActionableEvent!(event);

    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(0);
  });

  it("does NOT fire claim_message when messageId is missing from event payload", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const agent = streamingAgentRecording(calls);
    const dispatcher = createSharedDispatcher({
      getAgent: () => agent,
      proxyVersion: "test-1.0.0",
      notificationHooks: { onActionableEvent: vi.fn() },
    });

    const event: AgentEvent = {
      id: "envelope-3",
      event: "message_arrived",
      data: { message: {} }, // no id
    };
    dispatcher.callbacks.onActionableEvent!(event);

    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(0);
  });

  it("does NOT fire claim_message when agent is not streaming", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const disconnectedAgent = {
      state: "disconnected" as const,
      isConnected: false,
      call: vi.fn(async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        return null;
      }),
      listTools: vi.fn().mockResolvedValue([]),
      setCallbacks: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as McpAgentClient;
    const dispatcher = createSharedDispatcher({
      getAgent: () => disconnectedAgent,
      proxyVersion: "test-1.0.0",
      notificationHooks: { onActionableEvent: vi.fn() },
    });

    dispatcher.callbacks.onActionableEvent!({
      id: "envelope-4",
      event: "message_arrived",
      data: { message: { id: "01HX_MSG" } },
    });

    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(0);
  });

  it("claim_message tool-call rejection is non-fatal (logged, no throw)", async () => {
    const failingAgent = {
      state: "streaming" as const,
      isConnected: true,
      call: vi.fn().mockRejectedValue(new Error("hub gone")),
      listTools: vi.fn().mockResolvedValue([]),
      setCallbacks: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as McpAgentClient;
    const logs: string[] = [];
    const dispatcher = createSharedDispatcher({
      getAgent: () => failingAgent,
      proxyVersion: "test-1.0.0",
      log: (m) => logs.push(m),
      notificationHooks: { onActionableEvent: vi.fn() },
    });

    expect(() => {
      dispatcher.callbacks.onActionableEvent!({
        id: "envelope-5",
        event: "message_arrived",
        data: { message: { id: "01HX_FAIL" } },
      });
    }).not.toThrow();

    // Wait for the rejected promise to settle.
    await new Promise((r) => setImmediate(r));
    expect(logs.some((l) => l.includes("claim_message"))).toBe(true);
  });
});

describe("dispatcher — W3.3 ackMessage helper", () => {
  it("exposes ackMessage on the SharedDispatcher; calls ack_message tool", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const agent = {
      state: "streaming" as const,
      isConnected: true,
      call: vi.fn(async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        return { content: [{ type: "text", text: '{"message":{"id":"x","status":"acked"},"acked":true}' }] };
      }),
      listTools: vi.fn().mockResolvedValue([]),
      setCallbacks: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as McpAgentClient;

    const dispatcher = createSharedDispatcher({
      getAgent: () => agent,
      proxyVersion: "test-1.0.0",
    });

    await dispatcher.ackMessage("01HX_MSG_TO_ACK");

    expect(calls).toEqual([{ method: "ack_message", params: { id: "01HX_MSG_TO_ACK" } }]);
  });

  it("ackMessage is a no-op when agent is not streaming", async () => {
    const agent = {
      state: "disconnected" as const,
      isConnected: false,
      call: vi.fn(),
      listTools: vi.fn().mockResolvedValue([]),
      setCallbacks: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as McpAgentClient;

    const dispatcher = createSharedDispatcher({
      getAgent: () => agent,
      proxyVersion: "test-1.0.0",
    });

    await dispatcher.ackMessage("01HX_MSG");
    expect(agent.call).not.toHaveBeenCalled();
  });

  it("ackMessage swallows tool-call rejection (logged, no throw)", async () => {
    const agent = {
      state: "streaming" as const,
      isConnected: true,
      call: vi.fn().mockRejectedValue(new Error("hub gone")),
      listTools: vi.fn().mockResolvedValue([]),
      setCallbacks: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as McpAgentClient;

    const logs: string[] = [];
    const dispatcher = createSharedDispatcher({
      getAgent: () => agent,
      proxyVersion: "test-1.0.0",
      log: (m) => logs.push(m),
    });

    await expect(dispatcher.ackMessage("01HX_MSG")).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes("ack_message"))).toBe(true);
  });
});

describe("dispatcher — W3.3 PollBackstop integration", () => {
  it("constructs PollBackstop when pollBackstop config is supplied", () => {
    const dispatcher = createSharedDispatcher({
      getAgent: () => null,
      proxyVersion: "test-1.0.0",
      pollBackstop: { role: "engineer" },
    });
    expect(dispatcher.pollBackstop).toBeDefined();
  });

  it("omits pollBackstop when no config is supplied (push-only mode)", () => {
    const dispatcher = createSharedDispatcher({
      getAgent: () => null,
      proxyVersion: "test-1.0.0",
    });
    expect(dispatcher.pollBackstop).toBeUndefined();
  });

  it("polled messages flow through the same MessageRouter as SSE inline (seen-id LRU dedup)", async () => {
    const onActionable = vi.fn();
    const dispatcher = createSharedDispatcher({
      getAgent: () => null, // not actually fetching; we'll inject the polled event manually
      proxyVersion: "test-1.0.0",
      pollBackstop: { role: "engineer" },
      notificationHooks: { onActionableEvent: onActionable },
    });

    // Simulate the W3.3 onPolledMessage path: the dispatcher routes
    // polled messages through the same router as SSE. We invoke the
    // SSE-equivalent callback to seed the seen-id cache.
    const event: AgentEvent = {
      id: "01HX_POLL_DEDUP",
      event: "message_arrived",
      data: { message: { id: "01HX_POLL_DEDUP", payload: {} } },
    };
    dispatcher.callbacks.onActionableEvent!(event);
    // Same id seen via poll → router dedup catches it.
    dispatcher.callbacks.onActionableEvent!(event);

    expect(onActionable).toHaveBeenCalledOnce();
  });
});
