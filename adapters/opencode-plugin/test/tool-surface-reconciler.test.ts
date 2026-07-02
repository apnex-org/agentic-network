/**
 * tool-surface-reconciler.test.ts — idea-355 SLICE-1T.
 *
 * Pins that the kernel ToolSurfaceReconciler now OWNS opencode's tool-surface
 * delivery (replacing the deleted computeToolHash/syncTools local-hash loop).
 *
 * Two load-bearing invariants, exercised through the SAME production wiring the
 * shim builds at connect-time (buildToolSurfaceReconciler → the real
 * emitToolListChanged closure + readServedRevision=() => null), with only
 * fetchLiveRevision injected to drive seed-vs-drift deterministically:
 *
 *   1. SEED pass does NOT emit. With readServedRevision=() => null the first
 *      reconcile baselines appliedRevision from live and fires NO
 *      tools/list_changed — so the L1 identityReady seed never spurious-emits.
 *   2. DRIFT fans out over the LIVE activeProxyServers array. When the live
 *      /health revision later diverges, the emit calls sendToolListChanged on
 *      EVERY active proxy server (multi-server fan-out) + raises the toast.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { _testOnly } from "../src/shim.js";

interface FakeServer {
  sendToolListChanged: ReturnType<typeof vi.fn>;
}

function fakeServer(): FakeServer {
  return { sendToolListChanged: vi.fn(async () => {}) };
}

describe("opencode tool-surface — kernel ToolSurfaceReconciler ownership (idea-355 SLICE-1T)", () => {
  beforeEach(() => {
    _testOnly.clearProxyServers();
    _testOnly.setReconciler(null); // reset module reconciler between tests
    // Fake sdkClient so the toast path (showToast) is observable rather than a
    // no-op early-return — the fan-out over servers is the primary proof; the
    // toast is the host-unique shim UX layered on top.
    _testOnly.setSdkClient(null);
  });

  it("SEED pass (readServedRevision=null) baselines from live and does NOT emit", async () => {
    const s1 = fakeServer();
    const s2 = fakeServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _testOnly.pushProxyServer(s1 as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _testOnly.pushProxyServer(s2 as any);

    const fetchLiveRevision = vi.fn(async () => "rev-A");
    const reconciler = _testOnly.buildToolSurfaceReconciler("https://hub/mcp", fetchLiveRevision);

    const outcome = await reconciler.reconcile("identityReady");

    expect(outcome.emitted).toBe(false);
    expect(outcome.live).toBe("rev-A");
    expect(reconciler.getAppliedRevision()).toBe("rev-A");
    expect(s1.sendToolListChanged).not.toHaveBeenCalled();
    expect(s2.sendToolListChanged).not.toHaveBeenCalled();
  });

  it("DRIFT fans sendToolListChanged over EVERY active proxy server + raises the toast", async () => {
    const s1 = fakeServer();
    const s2 = fakeServer();
    const s3 = fakeServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _testOnly.pushProxyServer(s1 as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _testOnly.pushProxyServer(s2 as any);

    const showToast = vi.fn(async () => {});
    _testOnly.setSdkClient({ tui: { showToast } });

    // Live revision flips A → B between the seed pass and the drift pass.
    const fetchLiveRevision = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce("rev-A")
      .mockResolvedValueOnce("rev-B");
    const reconciler = _testOnly.buildToolSurfaceReconciler("https://hub/mcp", fetchLiveRevision);

    // Seed (no emit).
    await reconciler.reconcile("identityReady");
    expect(s1.sendToolListChanged).not.toHaveBeenCalled();

    // A proxy server that initializes AFTER the reconciler was built must still
    // be notified — the closure iterates the LIVE array, not a snapshot.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _testOnly.pushProxyServer(s3 as any);

    // Drift (rev-A → rev-B) emits.
    const outcome = await reconciler.reconcile("heartbeat");

    expect(outcome.emitted).toBe(true);
    expect(outcome.live).toBe("rev-B");
    expect(reconciler.getAppliedRevision()).toBe("rev-B");
    expect(s1.sendToolListChanged).toHaveBeenCalledTimes(1);
    expect(s2.sendToolListChanged).toHaveBeenCalledTimes(1);
    expect(s3.sendToolListChanged).toHaveBeenCalledTimes(1);
    // Toast raised (flush the showToast microtask first — emit fires it via void).
    await Promise.resolve();
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("PRODUCTION L2: the pollBackstop onHeartbeatTick drives the MODULE reconciler → emits on drift (pins the silently-disabled seam)", async () => {
    // F2 (review): the prior 3 tests call buildToolSurfaceReconciler().reconcile()
    // directly — they do NOT exercise the production TRIGGER wiring. This drives
    // the real dispatcher.pollBackstop heartbeat tick (the L2 backstop that fires
    // reconcile WITHOUT a reconnect), through the MODULE `reconciler` the shim's
    // onHeartbeatTick reads — so a silently-disabled heartbeat hook (which would
    // miss an in-life redeploy and waste steve's one-shot restart) fails here.
    const s1 = fakeServer();
    const s2 = fakeServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _testOnly.pushProxyServer(s1 as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _testOnly.pushProxyServer(s2 as any);

    let live = "rev-A";
    // Install the reconciler the PRODUCTION onHeartbeatTick will read (module ref).
    _testOnly.setReconciler(
      _testOnly.buildToolSurfaceReconciler("https://hub/mcp", async () => live),
    );

    // A streaming agent so the heartbeat tick runs (transport_heartbeat + the
    // kernel wake/stall list_ready_work both no-op benignly).
    const fakeAgent = {
      state: "streaming",
      getMetrics: () => ({ agentId: "agent-x" }),
      call: vi.fn(async (m: string) => (m === "list_ready_work" ? { items: [] } : "ok")),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    // Tick 1 through the PRODUCTION pollBackstop heartbeat → onHeartbeatTick →
    // reconcile("heartbeat") → SEED (appliedRevision=rev-A, no emit).
    await _testOnly.dispatcher.pollBackstop!.tickHeartbeat(() => fakeAgent);
    expect(s1.sendToolListChanged).not.toHaveBeenCalled();

    // Drift, then a second production heartbeat tick → reconcile → emit.
    live = "rev-B";
    await _testOnly.dispatcher.pollBackstop!.tickHeartbeat(() => fakeAgent);
    expect(s1.sendToolListChanged).toHaveBeenCalledTimes(1);
    expect(s2.sendToolListChanged).toHaveBeenCalledTimes(1);
  });

  it("fetch-failure (live=null) no-ops — never a spurious emit", async () => {
    const s1 = fakeServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _testOnly.pushProxyServer(s1 as any);

    const fetchLiveRevision = vi.fn(async () => null);
    const reconciler = _testOnly.buildToolSurfaceReconciler("https://hub/mcp", fetchLiveRevision);

    const outcome = await reconciler.reconcile("heartbeat");

    expect(outcome.emitted).toBe(false);
    expect(reconciler.getAppliedRevision()).toBeNull();
    expect(s1.sendToolListChanged).not.toHaveBeenCalled();
  });
});
