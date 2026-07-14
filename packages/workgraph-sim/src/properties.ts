/**
 * properties.ts — the idea-449 Phase B / B2 property battery (P1-P9).
 *
 * Each property is checked on the REAL engine (green) AND paired with a SEEDED-FAULT
 * mutant that MUST red-light it (the non-vacuity bar: a property that stays green under
 * its own mutant proves nothing and is deleted). So every P below returns TWO results:
 * the invariant holds on a good scenario, and the invariant CATCHES a fault scenario.
 *
 * This first B2 increment lands the three properties with the highest lock value:
 *   P3 no-deadlock · P8 state-timer sum-identity (open-span) · P9 bug-249 single-verifier.
 * P1/P2/P4/P5/P6/P7 follow on the same branch.
 */
import { SimHarness } from "./harness.js";
import { SimClient } from "./clients.js";
import { WholeArcSim } from "./arc.js";
import { VirtualClock } from "hub/dist/entities/clock.js";
import type { OracleResult } from "./oracles.js";

const START = 1_700_000_000_000;
const freshHarness = (): SimHarness => new SimHarness({ clock: new VirtualClock(START) });
const flatId = (data: unknown): string => {
  const d = data as Record<string, unknown>;
  return (((d.workItem as Record<string, unknown>) ?? d).id as string);
};

/**
 * P3 — no-deadlock. A well-formed DAG arc reaches all-done; a dependency cycle is
 * caught as deadlock (never a hang). Mutant: the cyclic arc must red-light.
 */
export async function p3NoDeadlock(): Promise<OracleResult[]> {
  const good = await new WholeArcSim(freshHarness()).run({
    nodes: [{ id: "a" }, { id: "b", dependsOn: ["a"] }, { id: "c", dependsOn: ["b"] }],
  });
  const mutant = await new WholeArcSim(freshHarness()).run({
    nodes: [{ id: "x", dependsOn: ["y"] }, { id: "y", dependsOn: ["x"] }],
  });
  return [
    {
      name: "P3:no-deadlock/well-formed-arc-completes",
      pass: good.deadlock === false && good.stuck.length === 0,
      detail: good.deadlock ? `unexpected deadlock: stuck=${good.stuck}` : undefined,
    },
    {
      name: "P3:MUTANT/cyclic-arc-red-lights",
      pass: mutant.deadlock === true,
      detail: mutant.deadlock ? undefined : "cyclic arc did NOT red-light as deadlock — property is vacuous",
    },
  ];
}

/**
 * P8 — state-timer sum-identity, counting the OPEN span at read-time (lily's refinement,
 * locking the ownActiveMs frozen-span bug). For a node currently in a state, the sum of
 * its accrued (closed) state-durations PLUS its current open span (now − enteredCurrentStateAt)
 * must equal total elapsed (now − createdAt). Mutant: the frozen-open-span reader (closed
 * spans only) must NOT match elapsed — proving the open span is load-bearing.
 */
export async function p8StateTimerSumIdentity(): Promise<OracleResult[]> {
  const clock = new VirtualClock(START);
  const h = new SimHarness({ clock });
  const arch = await SimClient.create(h, "a", "architect", "a");
  const eng = await SimClient.create(h, "e", "engineer", "e");
  const c = await arch.createWork({
    type: "task",
    roleEligibility: ["engineer"],
    evidenceRequirements: [{ id: "commit", kind: "commit", description: "x" }],
  });
  const wid = flatId(c.data);
  clock.advance(1_000);
  await eng.claim(wid); // ready-span (1000) accrues; enter claimed
  clock.advance(2_000);
  await eng.start(wid); // claimed-span (2000) accrues; enter in_progress
  clock.advance(5_000); // 5s OPEN in in_progress (not yet accrued)

  const read = (await arch.call("get_work", { workId: wid })).data as Record<string, unknown>;
  const item = ((read.workItem as Record<string, unknown>) ?? read) as Record<string, unknown>;
  const nowMs = clock.nowMs();
  const createdMs = Date.parse(item.createdAt as string);
  const enteredMs = Date.parse(item.enteredCurrentStateAt as string);
  const sumClosed = Object.values(item.stateDurations as Record<string, number>).reduce((s, v) => s + v, 0);
  const openSpan = nowMs - enteredMs;
  const elapsed = nowMs - createdMs;

  const identityHolds = sumClosed + openSpan === elapsed;
  const frozenReaderMatchesElapsed = sumClosed === elapsed; // the buggy (open-span-blind) reader
  return [
    {
      name: "P8:sum-identity-counts-open-span",
      pass: identityHolds,
      detail: identityHolds ? undefined : `sumClosed(${sumClosed}) + open(${openSpan}) != elapsed(${elapsed})`,
    },
    {
      name: "P8:MUTANT/frozen-open-span-reader-red-lights",
      pass: openSpan > 0 && frozenReaderMatchesElapsed === false,
      detail:
        openSpan <= 0
          ? "no open span to miss — mutant is vacuous (advance the clock in-state)"
          : frozenReaderMatchesElapsed
            ? "closed-spans-only reader matched elapsed — the open span is not load-bearing (property vacuous)"
            : undefined,
    },
  ];
}

/**
 * P9 — bug-249 single-verifier deadlock (lily's hook). A verifier-gate closes when a
 * DISTINCT verifier attests it. Mutant: when the executor IS the verifier (gate role =
 * verifier, so the same agent claims/completes AND attests), attestEvidence's fold-2
 * self-attestation fence rejects the verdict → the gate cannot close → in-sim DEADLOCK.
 * work-220 (the bug-249 fix) later flips this mutant green; until then it MUST be red.
 */
export async function p9SingleVerifierDeadlock(): Promise<OracleResult[]> {
  const good = await new WholeArcSim(freshHarness()).run({ nodes: [{ id: "g", gate: true, role: "engineer" }] });
  const mutant = await new WholeArcSim(freshHarness()).run({ nodes: [{ id: "g", gate: true, role: "verifier" }] });
  return [
    {
      name: "P9:distinct-verifier-gate-closes",
      pass: good.deadlock === false && good.done.includes("g"),
      detail: good.deadlock ? `distinct-verifier gate did not close: stuck=${good.stuck}` : undefined,
    },
    {
      name: "P9:MUTANT/single-verifier-self-attest-deadlocks",
      pass: mutant.deadlock === true && mutant.stuck.includes("g"),
      detail: mutant.deadlock
        ? undefined
        : "single-verifier gate CLOSED — the bug-249 self-attestation fence was bypassed (FALSE-GREEN)",
    },
  ];
}

/** The B2 property battery (this increment). Each P contributes its positive + mutant result. */
export async function runPropertyBattery(): Promise<OracleResult[]> {
  return [
    ...(await p3NoDeadlock()),
    ...(await p8StateTimerSumIdentity()),
    ...(await p9SingleVerifierDeadlock()),
  ];
}
