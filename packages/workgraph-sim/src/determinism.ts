/**
 * determinism.ts — the idea-449 VirtualClock re-seal (the 449-A-gate `delta=0` assertion).
 *
 * Proves the clock sub-slice does what it claims, driving the REAL substrate through the
 * harness:
 *   1. Under a VirtualClock, a fixed create→claim→start→complete lifecycle stamps
 *      BYTE-IDENTICAL timestamps across two independent runs (delta = 0).
 *   2. The oracle is NON-VACUOUS: the same lifecycle under the real system clock stamps
 *      DIFFERENT timestamps — so property 1 is a real consequence of the injected clock,
 *      not an artifact of a frozen fixture.
 *   3. The idea-525 `get_now` read-verb reports from that SAME injected clock, and tracks
 *      it when advanced.
 */
import { SimHarness } from "./harness.js";
import { SimClient } from "./clients.js";
import { VirtualClock } from "hub/dist/entities/clock.js";
import type { OracleResult } from "./oracles.js";

/** Every timestamp a create→claim→start→complete drive stamps onto the work item. */
interface Stamps {
  createdAt?: unknown;
  updatedAt?: unknown;
  enteredCurrentStateAt?: unknown;
  claimedAt?: unknown;
  expiresAt?: unknown;
  heartbeatAt?: unknown;
  evidenceProducedAt?: unknown;
}

const flat = (data: unknown): Record<string, unknown> => {
  const d = data as Record<string, unknown>;
  return ((d.workItem as Record<string, unknown>) ?? d) as Record<string, unknown>;
};

/**
 * Drive a fixed lifecycle under `clock` (advancing it a fixed amount at each step so the
 * timestamps genuinely move), then read the item back and capture every stamped time.
 * With no clock the harness uses real wall time.
 */
async function driveAndCapture(clock?: VirtualClock): Promise<Stamps> {
  const h = new SimHarness(clock ? { clock } : {});
  const arch = await SimClient.create(h, "arch", "architect", "arch");
  const eng = await SimClient.create(h, "eng", "engineer", "eng");
  const c = await arch.createWork({
    type: "task",
    roleEligibility: ["engineer"],
    evidenceRequirements: [{ id: "commit", kind: "commit", description: "x" }],
  });
  const workId = flat(c.data).id as string;
  clock?.advance(1_000);
  await eng.claim(workId);
  clock?.advance(1_000);
  await eng.start(workId);
  clock?.advance(1_000);
  await eng.complete(workId, [
    { requirementId: "commit", kind: "commit", ref: "deadbeef", producedAt: h.clock.now().toISOString() },
  ]);
  const w = flat((await arch.call("get_work", { workId })).data);
  const lease = w.lease as Record<string, unknown> | null;
  const ev = (w.evidence as Array<Record<string, unknown>> | undefined)?.[0];
  return {
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    enteredCurrentStateAt: w.enteredCurrentStateAt,
    claimedAt: lease?.claimedAt,
    expiresAt: lease?.expiresAt,
    heartbeatAt: lease?.heartbeatAt,
    evidenceProducedAt: ev?.producedAt,
  };
}

/** (1) Two runs under a VirtualClock at the same start produce byte-identical stamps. */
export async function oracleDeterministicUnderVirtualClock(): Promise<OracleResult> {
  const a = await driveAndCapture(new VirtualClock(1_700_000_000_000));
  const b = await driveAndCapture(new VirtualClock(1_700_000_000_000));
  const pass = JSON.stringify(a) === JSON.stringify(b);
  return {
    name: "determinism:virtual-clock-delta-zero",
    pass,
    detail: pass ? undefined : `runs diverged:\n A=${JSON.stringify(a)}\n B=${JSON.stringify(b)}`,
  };
}

/** (2) Non-vacuity: the same lifecycle under the REAL clock stamps DIFFERENT times. */
export async function oracleNonVacuousUnderSystemClock(): Promise<OracleResult> {
  const a = await driveAndCapture();
  await new Promise((r) => setTimeout(r, 5));
  const b = await driveAndCapture();
  const differ = JSON.stringify(a) !== JSON.stringify(b);
  return {
    name: "determinism:non-vacuous-under-system-clock",
    pass: differ,
    detail: differ ? undefined : "system-clock runs produced identical stamps — the determinism oracle is VACUOUS",
  };
}

/** (3) idea-525: get_now reports the injected clock's instant, and tracks it on advance. */
export async function oracleGetNowReadsInjectedClock(): Promise<OracleResult> {
  const clock = new VirtualClock(1_700_000_000_000);
  const h = new SimHarness({ clock });
  const eng = SimClient.roleOnly(h, "eng", "engineer");
  const t1 = (await eng.call("get_now", {})).data as Record<string, unknown>;
  clock.advance(60_000);
  const t2 = (await eng.call("get_now", {})).data as Record<string, unknown>;
  const want1 = new Date(1_700_000_000_000).toISOString();
  const want2 = new Date(1_700_000_060_000).toISOString();
  const pass = t1.now === want1 && t1.epochMs === 1_700_000_000_000 && t2.now === want2;
  return {
    name: "idea-525:get_now-reads-injected-clock",
    pass,
    detail: pass ? undefined : `t1=${JSON.stringify(t1)} (want ${want1}) t2=${JSON.stringify(t2)} (want ${want2})`,
  };
}

/** The determinism re-seal battery. */
export async function runDeterminismOracles(): Promise<OracleResult[]> {
  return [
    await oracleDeterministicUnderVirtualClock(),
    await oracleNonVacuousUnderSystemClock(),
    await oracleGetNowReadsInjectedClock(),
  ];
}
