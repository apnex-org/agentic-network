/**
 * idea-355 §4.3 — the kernel-internal queue wake/stall reconcile (tick-drive
 * contract). The reconcile + its trackers + the W2 lease observer are hoisted
 * into the dispatcher and driven off the PollBackstop heartbeat tick, so EVERY
 * host gets wake/stall with ZERO shim wiring.
 *
 * Acceptance (architect-specified): a dispatcher that wires NONE of the
 * wake/stall seams (no onToolCallResult, no onHeartbeatTick) still emits
 * work_claimable_digest / work_lease_stall via notificationHooks on a simulated
 * kernel tick. These tests also lock the 5 build-invariants:
 *   #1 in-flight latch released on error (a thrown reconcile doesn't wedge),
 *   #2 reconcile gated on identityReady (agentId present),
 *   #3 the W2 observer is wired kernel-side (claim_work CallTool → stall prompt),
 *   #4 trackers persist across ticks (level-triggered dedup survives),
 *   #5 the host live-refresh hook and the wake/stall reconcile are isolated.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createSharedDispatcher,
  type McpAgentClient,
  type SharedDispatcherOptions,
  type AgentEvent,
} from "../../src/index.js";

type CallImpl = (method: string, args: unknown) => Promise<unknown>;

function streamingAgent(callImpl: CallImpl, opts?: { agentId?: string | null; state?: string }): McpAgentClient {
  return {
    call: vi.fn(callImpl),
    listTools: vi.fn().mockResolvedValue([]),
    setCallbacks: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    isConnected: true,
    state: opts?.state ?? "streaming",
    getMetrics: () => ({
      sessionState: "streaming",
      agentId: opts?.agentId === undefined ? "agent-test" : opts.agentId,
    }),
  } as unknown as McpAgentClient;
}

/** A call impl that answers the tick's own internal calls + returns a fixed
 *  list_ready_work item set. */
function ticking(readyIds: string[], extra?: CallImpl): CallImpl {
  return async (method, args) => {
    if (method === "list_ready_work") {
      return { items: readyIds.map((id) => ({ id })) };
    }
    if (method === "transport_heartbeat" || method.startsWith("signal_")) return "ok";
    if (extra) return extra(method, args);
    return "ok";
  };
}

function build(opts: Partial<SharedDispatcherOptions> & { getAgent: () => McpAgentClient | null }) {
  const onActionable = vi.fn();
  const dispatcher = createSharedDispatcher({
    proxyVersion: "test",
    callToolGateTimeoutMs: 0,
    notificationHooks: { onActionableEvent: onActionable },
    pollBackstop: { role: "engineer" },
    ...opts,
  });
  return { dispatcher, onActionable };
}

function emittedEvents(onActionable: ReturnType<typeof vi.fn>): string[] {
  return onActionable.mock.calls.map((c) => (c[0] as AgentEvent).event);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("idea-355 §4.3 — kernel wake/stall on a zero-shim-wiring tick", () => {
  it("emits work_claimable_digest via notificationHooks with NO shim wake/stall wiring", async () => {
    const agent = streamingAgent(ticking(["work-1", "work-2"]));
    const { dispatcher, onActionable } = build({ getAgent: () => agent });

    await dispatcher.pollBackstop!.tickHeartbeat(() => agent);

    const events = emittedEvents(onActionable);
    expect(events).toContain("work_claimable_digest");
    const digest = onActionable.mock.calls
      .map((c) => c[0] as AgentEvent)
      .find((e) => e.event === "work_claimable_digest")!;
    expect(digest.data).toMatchObject({ role: "engineer", count: 2, newCount: 2 });
  });

  it("invariant #4 — trackers persist across ticks: an unchanged claimable set does NOT re-emit", async () => {
    const agent = streamingAgent(ticking(["work-1", "work-2"]));
    const { dispatcher, onActionable } = build({ getAgent: () => agent });

    await dispatcher.pollBackstop!.tickHeartbeat(() => agent); // emits (0→2)
    await dispatcher.pollBackstop!.tickHeartbeat(() => agent); // same set → no re-emit

    const digests = emittedEvents(onActionable).filter((e) => e === "work_claimable_digest");
    expect(digests).toHaveLength(1);
  });

  it("invariant #2 — gated on identityReady: no agentId yet → no emit", async () => {
    const agent = streamingAgent(ticking(["work-1"]), { agentId: null });
    const { dispatcher, onActionable } = build({ getAgent: () => agent });

    await dispatcher.pollBackstop!.tickHeartbeat(() => agent);

    expect(onActionable).not.toHaveBeenCalled();
  });

  it("gated on a streaming agent: non-streaming → no emit", async () => {
    const agent = streamingAgent(ticking(["work-1"]), { state: "reconnecting" });
    const { dispatcher, onActionable } = build({ getAgent: () => agent });

    await dispatcher.pollBackstop!.tickHeartbeat(() => agent);

    expect(onActionable).not.toHaveBeenCalled();
  });

  it("AC3 + invariant #1 — a failed list_ready_work read emits nothing, doesn't throw, and does NOT wedge the latch", async () => {
    // The read throws on the first tick, succeeds on the second (stateful agent;
    // the dispatcher's getAgent ref is fixed at construction).
    let readN = 0;
    const agent = streamingAgent(async (method) => {
      if (method === "list_ready_work") {
        readN += 1;
        if (readN === 1) throw new Error("hub round-trip failed");
        return { items: [{ id: "work-9" }] };
      }
      if (method === "transport_heartbeat" || method.startsWith("signal_")) return "ok";
      return "ok";
    });
    const { dispatcher, onActionable } = build({ getAgent: () => agent });

    // Tick 1: read fails → no emit, tracker skipped (no false 0→N), no reject.
    await expect(dispatcher.pollBackstop!.tickHeartbeat(() => agent)).resolves.toBeUndefined();
    expect(emittedEvents(onActionable)).not.toContain("work_claimable_digest");

    // Tick 2: read succeeds → emits. If the latch had wedged on the failed tick,
    // this would early-return and emit nothing.
    await dispatcher.pollBackstop!.tickHeartbeat(() => agent);
    expect(emittedEvents(onActionable)).toContain("work_claimable_digest");
  });

  it("invariant #5 — a throwing host live-refresh hook does NOT block the wake/stall emit", async () => {
    const agent = streamingAgent(ticking(["work-1"]));
    const { dispatcher, onActionable } = build({
      getAgent: () => agent,
      pollBackstop: {
        role: "engineer",
        onHeartbeatTick: async () => {
          throw new Error("live-refresh boom");
        },
      },
    });

    await dispatcher.pollBackstop!.tickHeartbeat(() => agent);

    // The host hook threw, but the kernel wake/stall still ran + emitted.
    expect(emittedEvents(onActionable)).toContain("work_claimable_digest");
  });
});

describe("idea-355 §4.3 — invariant #3: the W2 lease observer is wired kernel-side", () => {
  it("a claim_work CallTool feeds the lease tracker → a later tick emits work_lease_stall", async () => {
    const T0 = 1_000_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(T0);

    const agent = streamingAgent(
      ticking([], async (method) => {
        if (method === "claim_work") {
          return {
            workItem: {
              id: "work-77",
              lease: { expiresAt: new Date(T0 + 1000).toISOString() },
            },
          };
        }
        return "ok";
      }),
    );
    const { dispatcher, onActionable } = build({ getAgent: () => agent });

    // Drive a claim_work CallTool through the real handler — the kernel observer
    // at the onToolCallResult site feeds the lease tracker. NO shim wiring.
    const server = dispatcher.createMcpServer();
    const handlers = (server as unknown as {
      _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
    })._requestHandlers;
    const callTool = handlers.get("tools/call")!;
    await callTool({ method: "tools/call", params: { name: "claim_work", arguments: { workId: "work-77" } } });

    // Advance to 70% of the 1000ms lease window (past the 60% threshold, before
    // expiry) and tick. The reconcile reads Date.now() for both observe-time and
    // the threshold check, so fake timers make this deterministic.
    vi.setSystemTime(T0 + 700);
    await dispatcher.pollBackstop!.tickHeartbeat(() => agent);

    const stall = onActionable.mock.calls
      .map((c) => c[0] as AgentEvent)
      .find((e) => e.event === "work_lease_stall");
    expect(stall).toBeDefined();
    expect(stall!.data).toMatchObject({ workId: "work-77" });
  });
});
