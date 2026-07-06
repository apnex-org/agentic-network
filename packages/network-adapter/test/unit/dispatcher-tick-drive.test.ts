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

  it("AC3 — a failed list_ready_work read emits nothing, doesn't throw, and a later good tick recovers", async () => {
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
    // work-164: tiny active-work window so the agent reads STALLED by the tick
    // (700ms after its last tool call) → the W2 stall-prompt fires (this test's
    // concern). An active agent would instead auto-renew (covered separately).
    const { dispatcher, onActionable } = build({ getAgent: () => agent, activeWorkWindowMs: 100 });

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

  it("work-164: an ACTIVE claim auto-heartbeats (renew_lease with the tracked token) instead of stall-prompting", async () => {
    const T0 = 1_000_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(T0);

    const renewCalls: Array<Record<string, unknown>> = [];
    const agent = streamingAgent(
      ticking([], async (method, args) => {
        if (method === "claim_work") {
          return { workItem: { id: "work-88", lease: { token: "tok-88", expiresAt: new Date(T0 + 1000).toISOString() } } };
        }
        if (method === "renew_lease") {
          renewCalls.push(args as Record<string, unknown>);
          return { workItem: { id: "work-88", lease: { token: "tok-88", expiresAt: new Date(T0 + 700 + 1000).toISOString() } } };
        }
        return "ok";
      }),
    );
    // Default (5-min) active window → the agent is still ACTIVE 700ms after its claim,
    // so the auto-heartbeat renews rather than the stall-prompt firing.
    const { dispatcher, onActionable } = build({ getAgent: () => agent });
    const server = dispatcher.createMcpServer();
    const callTool = (server as unknown as {
      _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
    })._requestHandlers.get("tools/call")!;
    await callTool({ method: "tools/call", params: { name: "claim_work", arguments: { workId: "work-88" } } });

    vi.setSystemTime(T0 + 700); // 70% into the window, past the 0.5 renew threshold
    await dispatcher.pollBackstop!.tickHeartbeat(() => agent);

    // Renewed on the holder's behalf, carrying the tracked token; NO stall-prompt while active.
    expect(renewCalls).toEqual([{ workId: "work-88", leaseToken: "tok-88" }]);
    const stall = onActionable.mock.calls
      .map((c) => c[0] as AgentEvent)
      .find((e) => e.event === "work_lease_stall");
    expect(stall).toBeUndefined();
  });
});

describe("idea-355 §4.3 — invariant #1: the in-flight latch is released even when the reconcile THROWS", () => {
  it("a throw in the W2 emit path (outside the W1 catch) hits the finally → the next tick still emits", async () => {
    // This is the NON-vacuous latch test (review fix): the induced throw must
    // reach the latched `finally`, NOT the W1 inner catch. So we throw from the
    // W2 stall emit (a due-for-stall lease whose onActionableEvent throws on the
    // first emit). If the reset were moved out of `finally` into the success
    // path, tick 1's throw would skip it → the latch wedges → tick 2 early-
    // returns → no emit → this test fails (the mutation is caught).
    const T0 = 1_000_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(T0);

    let failNextStall = true;
    const recorded: AgentEvent[] = [];
    const onActionable = vi.fn((event: AgentEvent) => {
      if (event.event === "work_lease_stall" && failNextStall) {
        failNextStall = false;
        throw new Error("emit boom"); // OUTSIDE the W1 inner catch → reaches finally
      }
      recorded.push(event);
    });

    const agent = streamingAgent(
      ticking([], async (method) => {
        if (method === "claim_work") {
          return {
            workItem: {
              id: "work-55",
              lease: { expiresAt: new Date(T0 + 1000).toISOString() },
            },
          };
        }
        return "ok";
      }),
    );
    const dispatcher = createSharedDispatcher({
      proxyVersion: "test",
      callToolGateTimeoutMs: 0,
      notificationHooks: { onActionableEvent: onActionable },
      pollBackstop: { role: "engineer" },
      getAgent: () => agent,
      activeWorkWindowMs: 100, // work-164: read STALLED by the tick → W2 stall path (latch test)
    });

    // Track a lease via a real claim_work CallTool.
    const server = dispatcher.createMcpServer();
    const handlers = (server as unknown as {
      _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
    })._requestHandlers;
    const callTool = handlers.get("tools/call")!;
    await callTool({ method: "tools/call", params: { name: "claim_work", arguments: { workId: "work-55" } } });

    // 70% into the 1000ms window — due for a stall prompt.
    vi.setSystemTime(T0 + 700);

    // Tick 1: the W2 stall emit throws → the reconcile's finally must release the
    // latch (the throw is then caught by the dispatcher's per-concern try/catch).
    await dispatcher.pollBackstop!.tickHeartbeat(() => agent);
    // Tick 2: latch must be free → the still-due lease emits (markPrompted was
    // never reached on tick 1, so it is still due).
    await dispatcher.pollBackstop!.tickHeartbeat(() => agent);

    expect(recorded.some((e) => e.event === "work_lease_stall")).toBe(true);
  });
});

describe("bug-173 — the wake/stall reconcile resolves a `() => string` role at use-time", () => {
  it("a thunk role reaches list_ready_work's role filter AND the emitted digest", async () => {
    // The opencode shim builds the dispatcher at module-init (before config.role
    // loads) and passes `role: () => currentRole`. The reconcile must resolve it
    // at use-time so list_ready_work (and the digest) filter on the CONFIGURED
    // role — not a frozen module-init env default.
    const readyArgs: unknown[] = [];
    const agent = streamingAgent(async (method, args) => {
      if (method === "list_ready_work") {
        readyArgs.push(args);
        return { items: [{ id: "work-1" }, { id: "work-2" }] };
      }
      if (method === "transport_heartbeat" || method.startsWith("signal_")) return "ok";
      return "ok";
    });
    const { dispatcher, onActionable } = build({
      getAgent: () => agent,
      pollBackstop: { role: () => "verifier" },
    });

    await dispatcher.pollBackstop!.tickHeartbeat(() => agent);

    // The role filter on the Hub read carries the resolved "verifier".
    expect(readyArgs).toContainEqual({ role: "verifier", scopeToCaller: true });
    // And the surfaced digest is scoped to that same role.
    const digest = onActionable.mock.calls
      .map((c) => c[0] as AgentEvent)
      .find((e) => e.event === "work_claimable_digest")!;
    expect(digest.data).toMatchObject({ role: "verifier", count: 2 });
  });
});
