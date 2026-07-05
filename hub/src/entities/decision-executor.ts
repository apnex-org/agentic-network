/**
 * decision-executor.ts — mission-102 P3-B5: the v1 action registry + the
 * atomic resolve+execute orchestration (design §3, RATIFIED at G2).
 *
 * Registry: EXACTLY two actions — unblock(workId) + approve(proposalRef) —
 * thin wrappers over shipped verbs. Everything else is post-v1 (the CL-1
 * concession made law: mint_work / record_scope_change / retire deferred).
 *
 * Atomicity contract (contract test 11): the FULL proof chain (authority
 * proof → grant proof → plan-hash match → plan-target validation) runs BEFORE
 * any effect — any failure is a whole-transition REJECT with ZERO effects
 * (the decision stays routed; no target is touched). Effects fire between the
 * resolved and executed commits; an effect failure parks the decision in
 * `resolved` with an explicit executorBinding recording the failure — VISIBLE
 * to the aging sweep, never silent (the async-park path doubles as the
 * failure-park path).
 *
 * unblock semantics (tight authority): a decision may only unblock a WorkItem
 * that is blocked ON IT (blockedOn.blockerIds includes the decision id) — the
 * resolution IS the blocker resolving, the same principle as the work-54
 * dependency-unblock. It cannot resume arbitrary blocked items and it never
 * forges holder credentials (the lease is preserved; the holder's session
 * continues where it parked).
 */
import type { Decision, DecisionPlanAction } from "./decision.js";
import type { IWorkItemStore } from "./work-item.js";
import type { IProposalStore } from "../state.js";
import { DecisionTransitionRejected } from "./decision-repository-substrate.js";

/** The enumerated v1 registry — the ONLY actions a plan may carry (schema-
 *  enforced at route; re-checked here fail-closed for defense in depth). */
export const V1_ACTION_REGISTRY: readonly DecisionPlanAction["action"][] = ["unblock", "approve"];

export interface ExecutionTargets {
  workItem?: Pick<IWorkItemStore, "getWorkItem" | "systemUnblock">;
  proposal?: Pick<IProposalStore, "getProposal" | "reviewProposal">;
}

/** Pre-effect validation (part of the contract-11 proof chain): every action
 *  in-registry AND every target resolves AND unblock targets are blocked ON
 *  this decision. Throws on any failure — BEFORE any effect anywhere. */
export async function validatePlan(decision: Decision, targets: ExecutionTargets): Promise<void> {
  for (const step of decision.executionPlan ?? []) {
    if (!V1_ACTION_REGISTRY.includes(step.action)) {
      throw new DecisionTransitionRejected(`plan rejected: action '${step.action}' is not in the v1 registry [${V1_ACTION_REGISTRY.join(", ")}] (fail-closed)`);
    }
    if (step.action === "unblock") {
      if (!targets.workItem) throw new DecisionTransitionRejected("plan rejected: unblock requires the WorkItem store");
      const w = await targets.workItem.getWorkItem(step.targetRef);
      if (!w) throw new DecisionTransitionRejected(`plan rejected: unblock target ${step.targetRef} does not resolve`);
      if (w.status !== "blocked" || !w.blockedOn?.blockerIds?.includes(decision.id)) {
        throw new DecisionTransitionRejected(`plan rejected: ${step.targetRef} is not blocked ON this decision (status=${w.status}, blockers=[${w.blockedOn?.blockerIds?.join(", ") ?? ""}]) — a resolution only unblocks what waits on it`);
      }
    }
    if (step.action === "approve") {
      if (!targets.proposal) throw new DecisionTransitionRejected("plan rejected: approve requires the Proposal store");
      const p = await targets.proposal.getProposal(step.targetRef);
      if (!p) throw new DecisionTransitionRejected(`plan rejected: approve target ${step.targetRef} does not resolve`);
    }
  }
}

/** Fire the plan (called ONLY after the decision CAS committed `resolved`).
 *  Returns per-step outcomes; the caller marks `executed` iff all succeeded,
 *  else records the failure in the executorBinding and leaves the decision
 *  parked in `resolved` (visible to aging). */
export async function executePlan(decision: Decision, targets: ExecutionTargets): Promise<{ ok: boolean; results: Array<{ action: string; targetRef: string; ok: boolean; detail: string }> }> {
  const results: Array<{ action: string; targetRef: string; ok: boolean; detail: string }> = [];
  for (const step of decision.executionPlan ?? []) {
    try {
      if (step.action === "unblock") {
        const w = await targets.workItem!.systemUnblock(step.targetRef, decision.id);
        results.push({ action: step.action, targetRef: step.targetRef, ok: !!w, detail: w ? `unblocked → ${w.status}` : "target vanished mid-execution" });
      } else if (step.action === "approve") {
        const approved = await targets.proposal!.reviewProposal(step.targetRef, "approved", `Approved by decision ${decision.id} (${decision.resolution?.authorityMode}; ref ${decision.resolution?.authorityRef})`);
        results.push({ action: step.action, targetRef: step.targetRef, ok: approved, detail: approved ? "approved" : "reviewProposal returned false" });
      }
    } catch (e) {
      results.push({ action: step.action, targetRef: step.targetRef, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}
