/**
 * hcap-reconciler-retry.test.ts — idea-465 regression: a failed refresh RETRIES.
 *
 * Wires the REAL ToolSurfaceReconciler (consumerOwnedLevel) + the REAL HubSpecSource
 * over a fake control plane + scripted fetches — NO Hub, NO pi runtime. Proves the
 * consumer-owned-level fix: on a Hub-revision drift the reconciler emits → the
 * consumer refreshes; if that refresh FAILS (catalog blip / poison-guard), the
 * consumer's applied-revision latch is NOT advanced, so the NEXT reconcile RE-EMITS
 * (retry) and converges once the refresh succeeds.
 *
 * The pre-idea-465 bug advanced the emit-only latch to `live` ON EMIT (before the
 * async refresh resolved) → a failed refresh masked the stale surface as converged
 * until the next Hub revision bump (pi's PRIMARY redeploy-propagation path).
 */
import { describe, it, expect } from "vitest";
import { ToolSurfaceReconciler } from "@apnex/network-adapter";
import type { ToolDescriptor } from "@apnex/network-adapter";
import { HubSpecSource } from "../src/hcap/tools/hub-spec-source.js";
import type { ToolSpec } from "../src/hcap/tools/contracts.js";

describe("idea-465 — a failed refresh does NOT advance the applied latch → retry → converge", () => {
  it("blip on the drift refresh → latch stays behind → next reconcile re-emits → converges", async () => {
    // Fake control plane: just records the declared spec.
    let declared: readonly ToolSpec[] = [];
    const controlPlane = {
      applyConfig: (spec: readonly ToolSpec[]) => {
        declared = spec;
      },
      listDeclaredConfig: () => declared,
    };

    // Scripted catalog: bootstrap ok → the FIRST drift-refresh throws (blip) → then
    // ok with a NEW tool (b) so a real surface delta rides the retry.
    const catalogByCall: Array<() => Promise<ToolDescriptor[]>> = [
      async () => [{ name: "a" }], // bootstrap
      async () => {
        throw new Error("listTools blip");
      }, // drift refresh #1 — FAILS
      async () => [{ name: "a" }, { name: "b" }], // drift refresh #2 — succeeds
    ];
    let call = 0;
    const state = { live: "revA" }; // the /health revision cursor

    const source = new HubSpecSource({
      fetchCatalog: () =>
        catalogByCall[Math.min(call++, catalogByCall.length - 1)]!(),
      fetchLiveRevision: async () => state.live,
      controlPlane,
    });

    // The reconciler's emit triggers the consumer refresh (mirrors the shim onDrift).
    let pending: Promise<void> = Promise.resolve();
    let emits = 0;
    const reconciler = new ToolSurfaceReconciler({
      fetchLiveRevision: async () => state.live,
      readServedRevision: () => source.getLastAppliedRevision(),
      consumerOwnedLevel: true,
      emitListChanged: () => {
        emits++;
        pending = source.refreshFromHub();
      },
    });

    // Bootstrap: ingest revA's surface + record the applied revision.
    await source.refreshFromHub();
    expect(source.getLastAppliedRevision()).toBe("revA");
    expect(declared.map((s) => s.name)).toEqual(["a"]);

    // identityReady: served == live == revA → converged, no emit.
    const seed = await reconciler.reconcile("identityReady");
    expect(seed.converged).toBe(true);
    expect(emits).toBe(0);

    // Redeploy: /health now reports revB.
    state.live = "revB";

    // Drift pass #1: emit → refresh BLIPS → latch NOT advanced.
    const d1 = await reconciler.reconcile("heartbeat");
    await pending;
    expect(d1.emitted).toBe(true);
    expect(emits).toBe(1);
    expect(source.getLastAppliedRevision()).toBe("revA"); // ← idea-465: NOT advanced on a failed refresh
    expect(declared.map((s) => s.name)).toEqual(["a"]); // surface still old (blip kept prior)

    // Drift pass #2: STILL drifted (served revA != live revB) → RE-EMIT (retry) → refresh succeeds.
    const d2 = await reconciler.reconcile("heartbeat");
    await pending;
    expect(d2.emitted).toBe(true);
    expect(emits).toBe(2); // ← the RETRY (pre-idea-465: latch already at revB → no re-emit → stale forever)
    expect(source.getLastAppliedRevision()).toBe("revB"); // advanced only after success
    expect(declared.map((s) => s.name)).toEqual(["a", "b"]); // converged to the new surface

    // Steady state: served == live == revB → converged, no further emit.
    const s3 = await reconciler.reconcile("heartbeat");
    expect(s3.converged).toBe(true);
    expect(emits).toBe(2);
  });
});
