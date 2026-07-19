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
const phaseOf = async (reader: SimClient, workId: string): Promise<string | undefined> => {
  const d = (await reader.call("get_work", { workId })).data as Record<string, unknown>;
  return (((d.workItem as Record<string, unknown>) ?? d).status as string | undefined);
};
const commitEvidence = (h: SimHarness): unknown[] => [
  { requirementId: "commit", kind: "commit", ref: "deadbeef", producedAt: h.clock.now().toISOString() },
];
const gateReqs = [
  { id: "commit", kind: "commit", description: "executor evidence" },
  { id: "seal", kind: "review", evidenceAuthority: "verifier-attestation", description: "verifier verdict" },
];
const taskReqs = [{ id: "commit", kind: "commit", description: "x" }];

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
 * P9 — bug-249 / idea-528 single-verifier gate close. A verifier may mechanically
 * claim/complete/attest a verifier-gate when the gate's VERIFIED WORK is authored by a
 * different agent. Mutant: if the verifier authored the verified work, the self-attest
 * fence still red-lights it — the fix is target-work-scoped, not a blanket bypass.
 */
export async function p9SingleVerifierDeadlock(): Promise<OracleResult[]> {
  const good = await new WholeArcSim(freshHarness()).run({
    nodes: [{ id: "driver", completionDependsOn: ["g"] }, { id: "g", gate: true, role: "verifier" }],
  });

  const h = freshHarness();
  const arch = await SimClient.create(h, "a", "architect", "a");
  const ver = await SimClient.create(h, "v", "verifier", "v");
  const gid = flatId((await arch.createWork({ type: "verifier-gate", roleEligibility: ["verifier"], runbook: "g", evidenceRequirements: gateReqs })).data);
  const driver = flatId((await arch.createWork({ type: "task", roleEligibility: ["verifier"], evidenceRequirements: taskReqs, completionDependsOn: [gid] })).data);
  await ver.claim(driver); await ver.start(driver); // verifier authors the VERIFIED work
  await ver.claim(gid); await ver.start(gid);
  await ver.complete(gid, commitEvidence(h)); // parks gate in review
  const rejected = await ver.call("attest_evidence", { workId: gid, requirementId: "seal", verdict: "pass", evidenceRefs: [{ kind: "evidence", ref: "deadbeef" }] });

  return [
    {
      name: "P9:single-verifier-gate-closes-when-target-work-not-self-authored",
      pass: good.deadlock === false && good.done.includes("g") && good.done.includes("driver"),
      detail: good.deadlock ? `single-verifier gate did not close: stuck=${good.stuck}` : undefined,
    },
    {
      name: "P9:MUTANT/target-work-self-attestation-rejected",
      pass: rejected.ok === false && (await phaseOf(arch, gid)) === "review",
      detail: rejected.ok ? "verifier attested their OWN target work — self-attestation fence bypassed" : undefined,
    },
  ];
}

/**
 * P1 — legal-only / zero-unhandled-transition. A well-formed arc completes entirely via
 * legal moves; an illegal move (start before claim) is REJECTED, not silently applied.
 */
export async function p1LegalOnly(): Promise<OracleResult[]> {
  const good = await new WholeArcSim(freshHarness()).run({ nodes: [{ id: "a" }, { id: "b", dependsOn: ["a"] }] });
  const h = freshHarness();
  const arch = await SimClient.create(h, "a", "architect", "a");
  const eng = await SimClient.create(h, "e", "engineer", "e");
  const wid = flatId((await arch.createWork({ type: "task", roleEligibility: ["engineer"], evidenceRequirements: taskReqs })).data);
  const illegal = await eng.start(wid); // start-before-claim — illegal
  return [
    { name: "P1:legal-only/well-formed-arc-all-legal", pass: good.deadlock === false && good.stuck.length === 0, detail: good.deadlock ? `unexpected deadlock: stuck=${good.stuck}` : undefined },
    { name: "P1:MUTANT/illegal-move-rejected", pass: illegal.ok === false, detail: illegal.ok ? "start-before-claim was ACCEPTED — an illegal transition slipped through" : undefined },
  ];
}

/**
 * P2 — gate-ordering + driver-LAST. In a closer→completionDependsOn→gate arc, the gate
 * reaches done and the driver (closer) completes LAST. Mutant: completing the closer
 * before its completion-gate is done is REJECTED.
 */
export async function p2GateOrderingDriverLast(): Promise<OracleResult[]> {
  const good = await new WholeArcSim(freshHarness()).run({ nodes: [{ id: "closer", completionDependsOn: ["gate"] }, { id: "gate", gate: true }] });
  const driverLast = good.done[good.done.length - 1] === "closer";
  const h = freshHarness();
  const arch = await SimClient.create(h, "a", "architect", "a");
  const eng = await SimClient.create(h, "e", "engineer", "e");
  const gid = flatId((await arch.createWork({ type: "verifier-gate", roleEligibility: ["engineer"], runbook: "g", evidenceRequirements: gateReqs })).data);
  const clid = flatId((await arch.createWork({ type: "task", roleEligibility: ["engineer"], evidenceRequirements: taskReqs, completionDependsOn: [gid] })).data);
  await eng.claim(clid); await eng.start(clid);
  const early = await eng.complete(clid, commitEvidence(h)); // gate not done → completion-gate rejects
  return [
    { name: "P2:gate-ordering/driver-completes-last", pass: good.deadlock === false && driverLast, detail: driverLast ? undefined : `driver not last: done order = ${good.done}` },
    { name: "P2:MUTANT/complete-before-gate-rejected", pass: early.ok === false, detail: early.ok ? "closer completed before its completion-gate — gate ordering bypassed" : undefined },
  ];
}

/**
 * P4 — evidence-satisfiable. A node with valid evidence completes; completing with the
 * required evidence MISSING is rejected (the evidence predicate is real, not decorative).
 */
export async function p4EvidenceSatisfiable(): Promise<OracleResult[]> {
  const h = freshHarness();
  const arch = await SimClient.create(h, "a", "architect", "a");
  const eng = await SimClient.create(h, "e", "engineer", "e");
  const mk = async (): Promise<string> => flatId((await arch.createWork({ type: "task", roleEligibility: ["engineer"], evidenceRequirements: taskReqs })).data);
  const w1 = await mk();
  await eng.claim(w1); await eng.start(w1);
  const okC = await eng.complete(w1, commitEvidence(h));
  const w2 = await mk();
  await eng.claim(w2); await eng.start(w2);
  const badC = await eng.complete(w2, []); // no evidence for the commit req
  const w3 = await mk();
  await eng.claim(w3); await eng.start(w3);
  const noFrictionC = await eng.call("complete_work", { workId: w3, evidence: commitEvidence(h) });
  return [
    { name: "P4:evidence-satisfiable/valid-evidence-completes", pass: okC.ok && (await phaseOf(arch, w1)) === "done", detail: okC.ok ? undefined : JSON.stringify(okC.data) },
    { name: "P4:MUTANT/missing-evidence-rejected", pass: badC.ok === false, detail: badC.ok ? "completed with NO evidence — the evidence predicate was bypassed" : undefined },
    { name: "P4:friction-required/missing-friction-blocks-fsm", pass: noFrictionC.ok && (noFrictionC.data as Record<string, unknown>).completionBlocked === "friction_reflection_required" && (await phaseOf(arch, w3)) === "in_progress", detail: noFrictionC.ok ? undefined : JSON.stringify(noFrictionC.data) },
  ];
}

/**
 * P5 — freshness / anti-gameability. Fresh evidence (producedAt ≥ claimedAt) is accepted;
 * stale evidence (producedAt well before the claim) is REJECTED — no self-backdating.
 */
export async function p5Freshness(): Promise<OracleResult[]> {
  const clock = new VirtualClock(START);
  const h = new SimHarness({ clock });
  const arch = await SimClient.create(h, "a", "architect", "a");
  const eng = await SimClient.create(h, "e", "engineer", "e");
  const mk = async (): Promise<string> => flatId((await arch.createWork({ type: "task", roleEligibility: ["engineer"], evidenceRequirements: taskReqs })).data);
  const w1 = await mk();
  await eng.claim(w1); await eng.start(w1); clock.advance(1_000);
  const freshC = await eng.complete(w1, commitEvidence(h)); // producedAt = now ≥ claimedAt
  const w2 = await mk();
  await eng.claim(w2); await eng.start(w2);
  const staleC = await eng.complete(w2, [{ requirementId: "commit", kind: "commit", ref: "deadbeef", producedAt: new Date(START - 100_000).toISOString() }]);
  return [
    { name: "P5:freshness/fresh-evidence-accepted", pass: freshC.ok, detail: freshC.ok ? undefined : JSON.stringify(freshC.data) },
    { name: "P5:MUTANT/stale-evidence-rejected", pass: staleC.ok === false, detail: staleC.ok ? "stale evidence (producedAt << claimedAt) was ACCEPTED — anti-gameability bypassed" : undefined },
  ];
}

/**
 * P6 — durable-park. A gate parked in review STAYS review (across a clock advance) until a
 * verifier attests — no spontaneous advance; and an attest DOES advance it (review is not a
 * dead-end). Both together prove the park is durable AND live.
 */
export async function p6DurablePark(): Promise<OracleResult[]> {
  const clock = new VirtualClock(START);
  const h = new SimHarness({ clock });
  const arch = await SimClient.create(h, "a", "architect", "a");
  const eng = await SimClient.create(h, "e", "engineer", "e");
  const ver = await SimClient.create(h, "v", "verifier", "v");
  const gid = flatId((await arch.createWork({ type: "verifier-gate", roleEligibility: ["engineer"], runbook: "g", evidenceRequirements: gateReqs })).data);
  await eng.claim(gid); await eng.start(gid);
  await eng.complete(gid, commitEvidence(h)); // → review
  const parked = await phaseOf(arch, gid);
  clock.advance(10_000);
  const stillParked = await phaseOf(arch, gid);
  await ver.call("attest_evidence", { workId: gid, requirementId: "seal", verdict: "pass", evidenceRefs: [{ kind: "evidence", ref: "deadbeef" }] });
  const advanced = await phaseOf(arch, gid);
  return [
    { name: "P6:durable-park/review-stays-until-attested", pass: parked === "review" && stillParked === "review", detail: parked === "review" && stillParked === "review" ? undefined : `parked=${parked} still=${stillParked} (spontaneous advance!)` },
    { name: "P6:MUTANT/attest-advances-review-to-done", pass: advanced === "done", detail: advanced === "done" ? undefined : `review did not advance on attest (dead-end): phase=${advanced}` },
  ];
}

/**
 * P7 — lease/poison chaos. A stolen-lease complete (a second agent wielding the holder's
 * token) is REJECTED (relocation-laundering fence); the real holder still completes.
 */
export async function p7LeasePoisonChaos(): Promise<OracleResult[]> {
  const h = freshHarness();
  const arch = await SimClient.create(h, "a", "architect", "a");
  const eng = await SimClient.create(h, "e", "engineer", "e");
  const thief = await SimClient.create(h, "t", "engineer", "t");
  const wid = flatId((await arch.createWork({ type: "task", roleEligibility: ["engineer"], evidenceRequirements: taskReqs })).data);
  await eng.claim(wid); await eng.start(wid);
  const stolen = await thief.misbehaveStolenLease("complete_work", wid, eng, { evidence: commitEvidence(h) });
  const real = await eng.complete(wid, commitEvidence(h));
  return [
    { name: "P7:lease-fencing/real-holder-completes", pass: real.ok && (await phaseOf(arch, wid)) === "done", detail: real.ok ? undefined : JSON.stringify(real.data) },
    { name: "P7:MUTANT/stolen-lease-rejected", pass: stolen.ok === false, detail: stolen.ok ? "stolen-lease complete was ACCEPTED — relocation-laundering" : undefined },
  ];
}

/** The full B2 property battery P1-P9. Each P contributes its positive + mutant result. */
export async function runPropertyBattery(): Promise<OracleResult[]> {
  return [
    ...(await p1LegalOnly()),
    ...(await p2GateOrderingDriverLast()),
    ...(await p3NoDeadlock()),
    ...(await p4EvidenceSatisfiable()),
    ...(await p5Freshness()),
    ...(await p6DurablePark()),
    ...(await p7LeasePoisonChaos()),
    ...(await p8StateTimerSumIdentity()),
    ...(await p9SingleVerifierDeadlock()),
  ];
}
