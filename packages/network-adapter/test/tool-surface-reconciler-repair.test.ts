/**
 * tool-surface-reconciler-repair.test.ts — mission-106 build-gate (steve's
 * kernel-review conformance bar). The reconciler-side gates for the disk-level,
 * level-triggered repair loop. Gate 4/5 (dispatcher serve path) live in the
 * claude dispatcher-list-tools-cache suite; gate 7 (live-host no-restart T2) is
 * the throwaway-ois conformance node, not an in-process unit.
 *
 * Each test drives the reconciler against an in-memory "disk" (a mutable
 * served-revision/catalog pair) + controllable live fetches, proving:
 *   - the LEVEL is the disk (F1) — convergence is a real read, no optimistic latch;
 *   - repair = refetch + coherent revision (F3) + atomic write (D1);
 *   - repair failure stays visible + retries + metriced + escalates (F5);
 *   - list_changed is best-effort (clause 3) — disk repair does not depend on it.
 */
import { describe, it, expect } from "vitest";
import {
  ToolSurfaceReconciler,
  type RepairOutcome,
} from "../src/tool-manager/catalog/tool-surface-reconciler.js";

interface Disk {
  rev: string | null;
  catalog: unknown[] | null;
}

/** A reconciler wired to an in-memory disk with controllable live-side deps. */
function rig(opts: {
  disk: Disk;
  live: () => string | null; // successive live-revision resolves
  catalog?: () => unknown[]; // live catalog (may throw)
  writeOk?: () => boolean; // gate the atomic write success
  emit?: () => void; // may throw
}) {
  const outcomes: RepairOutcome[] = [];
  const logs: string[] = [];
  const writes: Array<{ rev: string }> = [];
  const reconciler = new ToolSurfaceReconciler({
    fetchLiveRevision: async () => opts.live(),
    readServedRevision: () => opts.disk.rev,
    fetchLiveCatalog: async () => (opts.catalog ? opts.catalog() : [{ name: "live_tool" }]),
    writeServedCatalog: (catalog, rev) => {
      const ok = opts.writeOk ? opts.writeOk() : true;
      if (!ok) return false;
      writes.push({ rev });
      opts.disk.rev = rev;
      opts.disk.catalog = catalog;
      return true;
    },
    onRepairOutcome: (o) => outcomes.push(o),
    emitListChanged: opts.emit ?? (() => {}),
    repairFailureBound: 3,
    log: (m) => logs.push(m),
  });
  return { reconciler, outcomes, logs, writes };
}

/** Feed a fixed sequence of live-revision values, repeating the last. */
function seq(values: (string | null)[]): () => string | null {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe("mission-106 build-gate — reconciler disk-repair loop", () => {
  it("gate-1: drift with a stale disk → refetch + atomic rewrite; disk now serves the live revision + catalog; next pass converges without repair", async () => {
    const disk: Disk = { rev: "old", catalog: [{ name: "old_tool" }] };
    const LIVE = [{ name: "new_tool" }];
    const { reconciler } = rig({ disk, live: () => "new", catalog: () => LIVE });

    const out = await reconciler.reconcile("gate1");
    expect(out.repaired).toBe(true);
    expect(out.converged).toBe(true);
    expect(disk.rev).toBe("new"); // atomic rewrite landed the live revision
    expect(disk.catalog).toEqual(LIVE); // and the live catalog

    const out2 = await reconciler.reconcile("gate1-again");
    expect(out2.converged).toBe(true); // served === live → converged (disk is the level)
    expect(out2.repaired).toBe(false); // nothing to repair
  });

  it("gate-2: repair WRITE failure → not converged, no optimistic advance, disk stays stale, onRepairOutcome fired; next tick retries + converges once the write succeeds", async () => {
    const disk: Disk = { rev: "old", catalog: [{ name: "old_tool" }] };
    let writeOk = false;
    const { reconciler, outcomes } = rig({
      disk,
      live: () => "new",
      catalog: () => [{ name: "new_tool" }],
      writeOk: () => writeOk,
    });

    const out = await reconciler.reconcile("gate2-fail");
    expect(out.repaired).toBe(false);
    expect(out.converged).toBe(false);
    expect(disk.rev).toBe("old"); // disk stays stale — no phantom convergence
    expect(reconciler.getAppliedRevision()).not.toBe("new"); // NO optimistic in-memory advance (F1)
    expect(outcomes.at(-1)).toMatchObject({ ok: false, klass: "write-failed" });
    expect(reconciler.getConsecutiveRepairFailures()).toBe(1);

    writeOk = true; // disk becomes writable
    const out2 = await reconciler.reconcile("gate2-retry"); // still sees drift (disk stale) → retries
    expect(out2.repaired).toBe(true);
    expect(out2.converged).toBe(true);
    expect(disk.rev).toBe("new");
    expect(reconciler.getConsecutiveRepairFailures()).toBe(0);
  });

  it("gate-2b: repair FETCH failure → not converged, metriced as fetch-failed, disk untouched", async () => {
    const disk: Disk = { rev: "old", catalog: [{ name: "old_tool" }] };
    const { reconciler, outcomes } = rig({
      disk,
      live: () => "new",
      catalog: () => { throw new Error("hub unreachable"); },
    });
    const out = await reconciler.reconcile("gate2b");
    expect(out.repaired).toBe(false);
    expect(disk.rev).toBe("old");
    expect(outcomes.at(-1)).toMatchObject({ ok: false, klass: "fetch-failed" });
  });

  it("gate-3: live revision moves mid-fetch → coherence gate skips the write (never persists catalog@oldRevision)", async () => {
    const disk: Disk = { rev: "old", catalog: [{ name: "old_tool" }] };
    // pass live = v1 (drift detected); post-fetch re-confirm = v2 (moved).
    const { reconciler, outcomes, writes } = rig({
      disk,
      live: seq(["v1", "v2"]),
      catalog: () => [{ name: "v1_tool" }],
    });
    const out = await reconciler.reconcile("gate3");
    expect(out.repaired).toBe(false);
    expect(out.converged).toBe(false);
    expect(writes).toHaveLength(0); // NO mismatched-pair write
    expect(disk.rev).toBe("old"); // disk untouched
    expect(outcomes.at(-1)).toMatchObject({ ok: false, klass: "revision-moved" });
  });

  it("gate-6: emitListChanged throws (host ignores / vintage transport) → disk repair STILL occurs + converges (emit is best-effort, clause 3)", async () => {
    const disk: Disk = { rev: "old", catalog: null };
    const LIVE = [{ name: "new_tool" }];
    const { reconciler } = rig({
      disk,
      live: () => "new",
      catalog: () => LIVE,
      emit: () => { throw new Error("host transport closed"); },
    });
    const out = await reconciler.reconcile("gate6");
    expect(out.repaired).toBe(true); // repair independent of the emit outcome
    expect(out.converged).toBe(true);
    expect(disk.rev).toBe("new"); // the NEXT enumeration gets the live catalog
    expect(disk.catalog).toEqual(LIVE);
  });

  it("guard: a zero-tool live catalog is NEVER written (no disk poisoning; D1/F3)", async () => {
    const disk: Disk = { rev: "old", catalog: [{ name: "old_tool" }] };
    const { reconciler, outcomes, writes } = rig({
      disk,
      live: () => "new",
      catalog: () => [], // empty — must not poison
    });
    const out = await reconciler.reconcile("zero-tool");
    expect(out.repaired).toBe(false);
    expect(writes).toHaveLength(0);
    expect(disk.catalog).toEqual([{ name: "old_tool" }]); // untouched
    expect(outcomes.at(-1)).toMatchObject({ ok: false, klass: "zero-tool" });
  });

  it("F5: after repairFailureBound consecutive failures, an ESCALATION line fires (does not fail silently)", async () => {
    const disk: Disk = { rev: "old", catalog: [{ name: "old_tool" }] };
    const { reconciler, logs } = rig({
      disk,
      live: () => "new",
      catalog: () => [{ name: "new_tool" }],
      writeOk: () => false, // never succeeds
    });
    for (let i = 0; i < 3; i++) await reconciler.reconcile(`fail-${i}`);
    expect(reconciler.getConsecutiveRepairFailures()).toBe(3);
    expect(logs.some((l) => l.includes("ESCALATION"))).toBe(true);
    expect(disk.rev).toBe("old"); // still visibly stale — never a healthy-looking non-convergence
  });

  it("fail-safe: an unknown live revision (fetch null) is a no-op — never repairs or emits against an unknown live", async () => {
    const disk: Disk = { rev: "old", catalog: [{ name: "old_tool" }] };
    const { reconciler, writes } = rig({ disk, live: () => null });
    const out = await reconciler.reconcile("unknown-live");
    expect(out).toMatchObject({ emitted: false, live: null, repaired: false, converged: false });
    expect(writes).toHaveLength(0);
    expect(disk.rev).toBe("old");
  });
});
