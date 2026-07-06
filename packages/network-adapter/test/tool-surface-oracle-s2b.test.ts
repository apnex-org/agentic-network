/**
 * tool-surface-oracle-s2b.test.ts — Arc-1 S2b (idea-456).
 *
 * THE two-victim reachability oracle: the end-to-end in-repo capital that
 * nothing exercised before. The pieces were unit-tested in isolation —
 * `computeToolSurfaceRevision` (hub/test) proves the ETag is drift-sensitive
 * with synthetic tools; `tool-surface-reconciler` (opencode-plugin/test) proves
 * seed/drift/emit with SYNTHETIC "rev-A"/"rev-B" strings. NEITHER wired the
 * REAL hub ETag to the reconciler against a REAL registration delta.
 *
 * This does: it drives the reconciler's `fetchLiveRevision` off the ACTUAL
 * `computeToolSurfaceRevision` of two real hub PolicyRouters that differ by the
 * real `registerWorkItemPolicy` registration — the redeploy that landed the
 * `[Any]` verbs update_work + pause_work. It proves the chain hub-ETag-bump →
 * reconciler-drift-detect → emit(→ host tools/list_changed) fires on that live
 * delta, and that BOTH victims cross the boundary (two independent verbs kill
 * the false-green a single-verb delta would pass).
 *
 * Layer coverage (see the S2b runbook / design-of-record):
 *   L1 (hub ETag)     — rev1 != rev2 because the real registration moved it.
 *   L2 (reconciler)   — drift(applied→live) → emit; seed does not; no re-emit storm.
 *   L3 (host boundary)— the emitListChanged dep (host `sendToolListChanged`) fires.
 *   force-emit        — the in-repo escape-hatch half: unstick a session with
 *                       NO drift (the session-vintage case passive reconcile
 *                       can't retroactively reach).
 *
 * The L4 host-re-enumeration half (Claude Code actually re-pulling tools/list)
 * is code we don't own → the staged Director-probe artifact, NOT asserted here.
 */

import { describe, it, expect, vi } from "vitest";
import { ToolSurfaceReconciler } from "../src/tool-manager/catalog/tool-surface-reconciler.js";
import { PolicyRouter } from "../../../hub/src/policy/router.js";
import { computeToolSurfaceRevision } from "../../../hub/src/policy/tool-surface-revision.js";
import { registerWorkItemPolicy } from "../../../hub/src/policy/work-item-policy.js";

const noop = () => {};
const VICTIMS = ["update_work", "pause_work"] as const;

/**
 * The real registration delta the incident turned on: a baseline hub surface
 * (no work-item verbs) vs the same surface after `registerWorkItemPolicy` — the
 * redeploy that registered the `[Any]` work verbs including both victims.
 */
function realRegistrationDelta() {
  const before = new PolicyRouter(noop);
  const after = new PolicyRouter(noop);
  registerWorkItemPolicy(after);

  const rev1 = computeToolSurfaceRevision(before);
  const rev2 = computeToolSurfaceRevision(after);
  return { before, after, rev1, rev2 };
}

/**
 * A reconciler wired to a REAL hub ETag as its live revision, with a mutable
 * `live` cursor standing in for "which surface /health currently reports"
 * (rev1 = stale/pre-redeploy, rev2 = live/post-redeploy) and a spy for the host
 * `sendToolListChanged` boundary.
 */
function wireReconciler(opts: { served: string | null; initialLive: string }) {
  const state = { live: opts.initialLive };
  const emitListChanged = vi.fn();
  const reconciler = new ToolSurfaceReconciler({
    fetchLiveRevision: async () => state.live,
    readServedRevision: () => opts.served,
    emitListChanged,
    log: noop,
  });
  return { reconciler, emitListChanged, state };
}

describe("S2b — two-victim tool-surface reachability oracle (real registration delta)", () => {
  it("L1: the REAL registration moves the hub ETag AND both victims cross the boundary", () => {
    const { before, after, rev1, rev2 } = realRegistrationDelta();
    expect(rev1).not.toBe(rev2); // the real delta moved R
    const beforeTools = new Set(before.getAllToolNames());
    const afterTools = new Set(after.getAllToolNames());
    for (const v of VICTIMS) {
      expect(beforeTools.has(v)).toBe(false);
      expect(afterTools.has(v)).toBe(true);
    }
  });

  it("STALE-AT-SEED (bug-180 core): host enumerated rev1, /health already rev2 → first reconcile emits", async () => {
    // The already-stale-at-connect case: the session's served surface (rev1)
    // predates a redeploy that already advanced live to rev2. The seed pass
    // baselines from the SERVED revision, sees live drift, and emits at once.
    const { rev1, rev2, after } = realRegistrationDelta();
    const { reconciler, emitListChanged } = wireReconciler({ served: rev1, initialLive: rev2 });

    const outcome = await reconciler.reconcile("identityReady");

    expect(outcome.emitted).toBe(true);
    expect(outcome.live).toBe(rev2);
    expect(reconciler.getAppliedRevision()).toBe(rev2);
    expect(emitListChanged).toHaveBeenCalledTimes(1);
    // the surface the host will re-enumerate to carries BOTH victims
    for (const v of VICTIMS) expect(after.getAllToolNames()).toContain(v);
  });

  it("DRIFT-WHILE-CONNECTED (L2 backstop): seed at rev1 no-emit, redeploy → rev2 on next reconcile emits", async () => {
    // The connected-across-redeploy case (no reconnect, so no fresh
    // identityReady): the heartbeat backstop catches the mid-session bump.
    const { rev1, rev2 } = realRegistrationDelta();
    const { reconciler, emitListChanged, state } = wireReconciler({ served: rev1, initialLive: rev1 });

    // Seed: served == live == rev1 → baseline, no emit.
    const seed = await reconciler.reconcile("identityReady");
    expect(seed.emitted).toBe(false);
    expect(emitListChanged).not.toHaveBeenCalled();

    // Redeploy lands: /health now reports rev2.
    state.live = rev2;
    const drift = await reconciler.reconcile("heartbeat");
    expect(drift.emitted).toBe(true);
    expect(drift.live).toBe(rev2);
    expect(emitListChanged).toHaveBeenCalledTimes(1);
  });

  it("NO STORM: once applied has advanced to rev2, a further reconcile at rev2 does NOT re-emit", async () => {
    const { rev1, rev2 } = realRegistrationDelta();
    const { reconciler, emitListChanged, state } = wireReconciler({ served: rev1, initialLive: rev1 });
    await reconciler.reconcile("identityReady"); // seed rev1
    state.live = rev2;
    await reconciler.reconcile("heartbeat"); // emit once
    await reconciler.reconcile("heartbeat"); // steady state — must not re-emit
    expect(emitListChanged).toHaveBeenCalledTimes(1);
  });

  it("FORCE-EMIT escape-hatch: unsticks a session with NO drift (the vintage case passive reconcile can't reach)", async () => {
    // Steady state: applied == live == rev2, so reconcile() is inert. This is
    // exactly the already-stale-vintage session's shape — a passive loop has
    // nothing to react to. forceEmit hands the host a re-enumeration trigger
    // ANYWAY, with no process restart.
    const { rev2 } = realRegistrationDelta();
    const { reconciler, emitListChanged, state } = wireReconciler({ served: rev2, initialLive: rev2 });

    const passive = await reconciler.reconcile("heartbeat"); // no drift
    expect(passive.emitted).toBe(false);
    expect(emitListChanged).not.toHaveBeenCalled();

    const forced = await reconciler.forceEmit("operator-unstick");
    expect(forced.emitted).toBe(true);
    expect(emitListChanged).toHaveBeenCalledTimes(1); // host told to re-enumerate on demand
    expect(reconciler.getAppliedRevision()).toBe(rev2);
  });

  it("FORCE-EMIT is a deterministic L3 trigger and never throws when the host-emit fails", async () => {
    // Drives the emit→host boundary without staging a /health flip; a throwing
    // sendToolListChanged (host mid-teardown) must not escape.
    const { rev2 } = realRegistrationDelta();
    const throwingEmit = vi.fn(() => { throw new Error("host transport closed"); });
    const reconciler = new ToolSurfaceReconciler({
      fetchLiveRevision: async () => rev2,
      readServedRevision: () => rev2,
      emitListChanged: throwingEmit,
      log: noop,
    });
    const forced = await reconciler.forceEmit("deterministic-trigger");
    expect(throwingEmit).toHaveBeenCalledTimes(1);
    expect(forced.emitted).toBe(true); // guard swallows the throw, entrypoint still reports emitted
  });

  it("FORCE-EMIT with unknown live does not clobber a good applied baseline", async () => {
    const { rev2 } = realRegistrationDelta();
    const reconciler = new ToolSurfaceReconciler({
      fetchLiveRevision: async () => null, // /health unreachable
      readServedRevision: () => rev2,
      emitListChanged: vi.fn(),
      log: noop,
    });
    // establish a baseline first
    reconciler["appliedRevision"] = rev2; // eslint-disable-line @typescript-eslint/dot-notation
    const forced = await reconciler.forceEmit("unstick-offline");
    expect(forced.live).toBeNull();
    expect(reconciler.getAppliedRevision()).toBe(rev2); // unchanged — no clobber
  });
});
