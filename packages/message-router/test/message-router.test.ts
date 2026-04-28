import { describe, expect, it, vi } from "vitest";

import type {
  AgentEvent,
  DrainedPendingAction,
  SessionReconnectReason,
  SessionState,
} from "@apnex/network-adapter";

import { MessageRouter, type NotificationHooks } from "../src/message-router.js";

function makeHooks(): {
  hooks: Required<NotificationHooks>;
  spies: {
    actionable: ReturnType<typeof vi.fn>;
    informational: ReturnType<typeof vi.fn>;
    state: ReturnType<typeof vi.fn>;
    pending: ReturnType<typeof vi.fn>;
  };
} {
  const actionable = vi.fn();
  const informational = vi.fn();
  const state = vi.fn();
  const pending = vi.fn();
  return {
    hooks: {
      onActionableEvent: actionable,
      onInformationalEvent: informational,
      onStateChange: state,
      onPendingActionItem: pending,
    },
    spies: { actionable, informational, state, pending },
  };
}

function event(id: string | number, name = "thread_message"): AgentEvent {
  return { id, event: name, data: { threadId: "thread-1" } };
}

function pendingItem(id: string): DrainedPendingAction {
  return {
    id,
    dispatchType: "thread_message",
    entityRef: "thread-1",
    payload: {},
  };
}

describe("MessageRouter — per-kind dispatch", () => {
  it("routes actionable notifications to onActionableEvent", () => {
    const { hooks, spies } = makeHooks();
    const router = new MessageRouter({ hooks });

    expect(
      router.route({ kind: "notification.actionable", event: event("m-1") }),
    ).toBe(true);

    expect(spies.actionable).toHaveBeenCalledOnce();
    expect(spies.actionable).toHaveBeenCalledWith(event("m-1"));
    expect(spies.informational).not.toHaveBeenCalled();
    expect(spies.state).not.toHaveBeenCalled();
    expect(spies.pending).not.toHaveBeenCalled();
  });

  it("routes informational notifications to onInformationalEvent", () => {
    const { hooks, spies } = makeHooks();
    const router = new MessageRouter({ hooks });

    expect(
      router.route({
        kind: "notification.informational",
        event: event("m-2", "info_event"),
      }),
    ).toBe(true);

    expect(spies.informational).toHaveBeenCalledOnce();
    expect(spies.actionable).not.toHaveBeenCalled();
  });

  it("routes state.change to onStateChange with all positional args", () => {
    const { hooks, spies } = makeHooks();
    const router = new MessageRouter({ hooks });

    const state: SessionState = "reconnecting";
    const previous: SessionState = "streaming";
    const reason: SessionReconnectReason = "sse_watchdog";

    expect(
      router.route({ kind: "state.change", state, previous, reason }),
    ).toBe(true);

    expect(spies.state).toHaveBeenCalledOnce();
    expect(spies.state).toHaveBeenCalledWith(state, previous, reason);
  });

  it("forwards omitted reason as undefined on state.change", () => {
    const { hooks, spies } = makeHooks();
    const router = new MessageRouter({ hooks });

    router.route({
      kind: "state.change",
      state: "streaming",
      previous: "synchronizing",
    });

    expect(spies.state).toHaveBeenCalledWith("streaming", "synchronizing", undefined);
  });

  it("routes pending-action.dispatch to onPendingActionItem", () => {
    const { hooks, spies } = makeHooks();
    const router = new MessageRouter({ hooks });

    const item = pendingItem("pa-1");

    expect(
      router.route({ kind: "pending-action.dispatch", item }),
    ).toBe(true);

    expect(spies.pending).toHaveBeenCalledOnce();
    expect(spies.pending).toHaveBeenCalledWith(item);
  });

  it("routes repo-event onto the actionable wake-the-LLM hook (mission-52 bridge)", () => {
    const { hooks, spies } = makeHooks();
    const router = new MessageRouter({ hooks });

    const repoEvent = event("repo-7", "pr-merged");

    expect(
      router.route({ kind: "repo-event", event: repoEvent }),
    ).toBe(true);

    expect(spies.actionable).toHaveBeenCalledOnce();
    expect(spies.actionable).toHaveBeenCalledWith(repoEvent);
    expect(spies.informational).not.toHaveBeenCalled();
  });

  it("returns false when the relevant hook is not implemented (silent disable)", () => {
    const router = new MessageRouter({ hooks: {} });

    expect(
      router.route({ kind: "notification.actionable", event: event("m-1") }),
    ).toBe(false);
    expect(
      router.route({
        kind: "notification.informational",
        event: event("m-2"),
      }),
    ).toBe(false);
    expect(
      router.route({
        kind: "state.change",
        state: "streaming",
        previous: "synchronizing",
      }),
    ).toBe(false);
    expect(
      router.route({
        kind: "pending-action.dispatch",
        item: pendingItem("pa-1"),
      }),
    ).toBe(false);
  });
});

describe("MessageRouter — seen-id LRU dedup", () => {
  it("dedups duplicate Message ID delivery on the actionable path", () => {
    const { hooks, spies } = makeHooks();
    const router = new MessageRouter({ hooks });

    const msg = { kind: "notification.actionable" as const, event: event("m-7") };

    expect(router.route(msg)).toBe(true);
    expect(router.route(msg)).toBe(false);
    expect(spies.actionable).toHaveBeenCalledOnce();
  });

  it("dedups duplicate Message ID delivery on the informational path", () => {
    const { hooks, spies } = makeHooks();
    const router = new MessageRouter({ hooks });

    const msg = {
      kind: "notification.informational" as const,
      event: event("m-8", "info_event"),
    };

    expect(router.route(msg)).toBe(true);
    expect(router.route(msg)).toBe(false);
    expect(spies.informational).toHaveBeenCalledOnce();
  });

  it("dedups duplicate Message ID delivery on the repo-event path", () => {
    const { hooks, spies } = makeHooks();
    const router = new MessageRouter({ hooks });

    const msg = {
      kind: "repo-event" as const,
      event: event("repo-9", "pr-merged"),
    };

    expect(router.route(msg)).toBe(true);
    expect(router.route(msg)).toBe(false);
    expect(spies.actionable).toHaveBeenCalledOnce();
  });

  it("dedups duplicate pending-action queue-item IDs (replay on reconnect)", () => {
    const { hooks, spies } = makeHooks();
    const router = new MessageRouter({ hooks });

    const msg = {
      kind: "pending-action.dispatch" as const,
      item: pendingItem("pa-42"),
    };

    expect(router.route(msg)).toBe(true);
    expect(router.route(msg)).toBe(false);
    expect(spies.pending).toHaveBeenCalledOnce();
  });

  it("does not dedup state.change — FSM transitions have no Message identity", () => {
    const { hooks, spies } = makeHooks();
    const router = new MessageRouter({ hooks });

    const msg = {
      kind: "state.change" as const,
      state: "streaming" as SessionState,
      previous: "synchronizing" as SessionState,
    };

    expect(router.route(msg)).toBe(true);
    expect(router.route(msg)).toBe(true);
    expect(spies.state).toHaveBeenCalledTimes(2);
  });

  it("dispatches AgentEvents that lack an id (no dedup key) every time", () => {
    const { hooks, spies } = makeHooks();
    const router = new MessageRouter({ hooks });

    const idless: AgentEvent = { event: "thread_message", data: {} };
    const msg = { kind: "notification.actionable" as const, event: idless };

    expect(router.route(msg)).toBe(true);
    expect(router.route(msg)).toBe(true);
    expect(spies.actionable).toHaveBeenCalledTimes(2);
  });

  it("respects bounded LRU capacity (eviction frees an id for re-dispatch)", () => {
    const { hooks, spies } = makeHooks();
    const router = new MessageRouter({ hooks, cacheOptions: { capacity: 2 } });

    router.route({ kind: "notification.actionable", event: event("a") }); // [a]
    router.route({ kind: "notification.actionable", event: event("b") }); // [a, b]
    // pushing "c" evicts the LRU entry "a" → [b, c]
    router.route({ kind: "notification.actionable", event: event("c") });

    // "a" is gone — re-routes fresh
    expect(
      router.route({ kind: "notification.actionable", event: event("a") }),
    ).toBe(true);

    expect(spies.actionable).toHaveBeenCalledTimes(4);
  });

  it("integer AgentEvent ids hash the same as their string form", () => {
    const { hooks, spies } = makeHooks();
    const router = new MessageRouter({ hooks });

    expect(
      router.route({ kind: "notification.actionable", event: event(42) }),
    ).toBe(true);
    expect(
      router.route({ kind: "notification.actionable", event: event("42") }),
    ).toBe(false);
    expect(spies.actionable).toHaveBeenCalledOnce();
  });
});
