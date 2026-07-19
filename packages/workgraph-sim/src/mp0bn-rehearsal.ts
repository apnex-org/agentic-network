/**
 * mp0bn-rehearsal.ts — the idea-449 Phase B / B3 mp0bn dress-rehearsal.
 *
 * Faithfully reconstructs the mp0bn arc from the committed blueprint fixture (Hub doc
 * runId=mp0bn, 30 nodes) and dress-rehearses it through the whole-arc sim BEFORE it seeds —
 * over a fixture, never the live Hub arc (zero risk). The structure: the idea-449 keystone
 * sub-arc (design→A_build→clock→A_gate→B_build→B_gate), 11 closer→_vg pairs (each closer's
 * completionDependsOn is its verifier-gate), a backstop, and the arc_driver (completionDependsOn
 * every leaf — completes LAST).
 *
 * Per the 449_B_gate acceptance, the rehearsal is explicit about BOTH verifier-gate paths —
 * it never silently skips the gate-close constraint:
 *   - SINGLE-VERIFIER path (faithful, blueprint role=verifier): the -vg executor IS the attester.
 *     Post-#616 (bug-249 / idea-528) the self-attestation fence is TARGET-WORK-scoped — the verifier
 *     did not author the gated target work, so the fence permits the attest, the gates close, and the
 *     whole arc drives to all-done. (Pre-#616 this deadlocked; that was the bug-249 bug, and #616 is
 *     the fix — so the reconstructed arc now completes on both drive paths.)
 *   - RESHAPE path (role=architect): the architect drives the -vg to review and a DISTINCT
 *     verifier attests → the whole arc drives to all-done.
 */
import { SimHarness } from "./harness.js";
import { WholeArcSim, type ArcScenario, type ArcNode, type ArcRole } from "./arc.js";
import { VirtualClock } from "hub/dist/entities/clock.js";
import type { OracleResult } from "./oracles.js";

/** The 11 parallel closers (each a task whose completionDependsOn is its verifier-gate). */
const CLOSERS = ["c509", "c493", "c510", "c511", "c512", "c515", "c521", "b259", "c454", "c519", "b261"];

/**
 * The mp0bn arc, reconstructed to match the blueprint fixture's dependency + gate structure.
 * `vgRole` selects how the verifier-gates are driven: "verifier" = the faithful single-verifier
 * TRAP; "architect" = the reshape (architect drives to review, a distinct verifier attests).
 */
export function mp0bnArc(vgRole: ArcRole): ArcScenario {
  const nodes: ArcNode[] = [
    { id: "449_design", role: "architect" },
    { id: "449_A_build", role: "engineer", dependsOn: ["449_design"] },
    { id: "449_clock", role: "engineer", dependsOn: ["449_A_build"] },
    { id: "449_A_gate", role: vgRole, gate: true, dependsOn: ["449_clock"] },
    { id: "449_B_build", role: "engineer", dependsOn: ["449_A_gate"] },
    { id: "449_B_gate", role: vgRole, gate: true, dependsOn: ["449_B_build"] },
    { id: "backstop", role: "engineer" },
  ];
  for (const c of CLOSERS) {
    nodes.push({ id: c, role: "engineer", completionDependsOn: [`${c}_vg`] });
    nodes.push({ id: `${c}_vg`, role: vgRole, gate: true });
  }
  // arc_driver completes LAST — its completionDependsOn is every other node.
  const leaves = nodes.map((n) => n.id);
  nodes.push({ id: "arc_driver", role: "architect", completionDependsOn: leaves });
  return { nodes };
}

const freshHarness = (): SimHarness => new SimHarness({ clock: new VirtualClock(1_700_000_000_000) });

/** RESHAPE path: architect-driven -vg + a distinct verifier attest → the whole mp0bn arc reaches all-done. */
export async function rehearseMp0bnReshape(): Promise<OracleResult> {
  const r = await new WholeArcSim(freshHarness()).run(mp0bnArc("architect"));
  const allDone = r.deadlock === false && r.stuck.length === 0 && r.done.includes("arc_driver");
  return {
    name: "B3:mp0bn-dress-rehearsal/RESHAPE-path-drives-to-all-done",
    pass: allDone,
    detail: allDone ? undefined : `deadlock=${r.deadlock} stuck=${r.stuck.slice(0, 8)}`,
  };
}

/** SINGLE-VERIFIER path: one verifier drives the -vg AND attests. Post-#616 (bug-249 / idea-528) the
 * self-attestation fence is TARGET-WORK-scoped, not gate-scoped: the verifier did not author the gated
 * target work (engineers did), so the fence permits the attest, the -vg gates close, and the whole arc
 * drives to all-done. (Pre-#616 this DEADLOCKED — that WAS the bug-249 bug; #616 is the fix. The
 * self-authored case the fence still rejects is covered by hub's seal-a2-attest suite.) */
export async function rehearseMp0bnTrap(): Promise<OracleResult> {
  const r = await new WholeArcSim(freshHarness()).run(mp0bnArc("verifier"));
  const allDone = r.deadlock === false && r.stuck.length === 0 && r.done.includes("arc_driver");
  return {
    name: "B3:mp0bn-dress-rehearsal/single-verifier-drives-to-all-done-post-bug-249",
    pass: allDone,
    detail: allDone ? undefined : `expected all-done (bug-249 fixed by #616); deadlock=${r.deadlock} stuck=${r.stuck.slice(0, 8)}`,
  };
}

/** The B3 dress-rehearsal — both the reshape (distinct-verifier) and single-verifier (bug-249-fixed) paths, stated explicitly. */
export async function runDressRehearsal(): Promise<OracleResult[]> {
  return [await rehearseMp0bnReshape(), await rehearseMp0bnTrap()];
}
