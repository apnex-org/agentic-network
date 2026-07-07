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

/** The enumerated registry — the ONLY actions a plan may carry (schema-
 *  enforced at route; re-checked here fail-closed for defense in depth).
 *  v1: unblock | approve. mission-103 S1 (decision-17 §2): the charter pair
 *  bind_axiom | amend_charter — charter mutation exists ONLY here, so every
 *  charter change structurally carries {ratifiedBy: decision, proofRef}. */
export const V1_ACTION_REGISTRY: readonly DecisionPlanAction["action"][] = ["unblock", "approve", "bind_axiom", "amend_charter"];

const BINDING_STATUSES = ["bound", "superseded", "unbound"] as const;
const CHARTER_SECTIONS = ["vision", "directorProfile"] as const;

export interface ExecutionTargets {
  workItem?: Pick<IWorkItemStore, "getWorkItem" | "systemUnblock">;
  proposal?: Pick<IProposalStore, "getProposal">;
  /** PR #489 review (audit-9938) + proptool0: approve fires through the
   *  shipped INTERNAL Proposal approval bridge (submitted-only guard,
   *  auto-scaffold with revert-on-failure, proposal_decided dispatches) — the
   *  policy layer supplies this closure; the executor never touches the raw
   *  repository method and no public create_proposal_review tool is required. */
  approveViaPolicy?: (proposalRef: string, feedback: string) => Promise<{ ok: boolean; detail: string }>;
  /** mission-103 S1: the served constitution — bind_axiom targets must
   *  resolve in the CURRENT snapshot manifest (referential, fail-closed). */
  constitution?: { getCurrent(): Promise<{ manifest: Array<{ id: string }> } | null> };
  /** mission-103 S1: the charter append closures, supplied by the policy
   *  layer with the executing decision's {ratifiedBy, proofRef} already
   *  bound — the executor never fabricates authority fields. */
  bindAxiomViaPolicy?: (step: DecisionPlanAction) => Promise<{ ok: boolean; detail: string }>;
  amendCharterViaPolicy?: (step: DecisionPlanAction) => Promise<{ ok: boolean; detail: string }>;
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
      // audit-9938: INV-P2 travels into the plan chain — only a SUBMITTED proposal
      // is approvable; anything else is a pre-transition reject with zero effects
      // (an already-approved/rejected/implemented proposal is invalid cargo).
      if (p.status !== "submitted") {
        throw new DecisionTransitionRejected(`plan rejected: approve target ${step.targetRef} is '${p.status}', not 'submitted' (INV-P2) — a decision cannot re-decide a decided proposal`);
      }
    }
    if (step.action === "bind_axiom" || step.action === "amend_charter") {
      // Design §4 anti-gameability (the complete_work posture): a
      // CONSTITUTIONAL plan action executes only on a decision that CARRIES
      // required evidence — the S2 batch's required evidence is the verifier
      // fidelity audit, and an evidence-free charter mutation must reject
      // BEFORE any transition, not rely on raise-time discipline alone.
      if (!(decision.contextRefs ?? []).some((r) => r.required)) {
        throw new DecisionTransitionRejected(`plan rejected: ${step.action} requires the decision to carry required evidence (a required:true contextRef — design §4: the fidelity audit is the batch ratification's REQUIRED evidence); ${decision.id} carries none`);
      }
    }
    if (step.action === "bind_axiom") {
      // Referential, fail-closed: the axiom must exist in the SERVED
      // constitution — a binding to an unsynced/unknown axiom is invalid
      // cargo, rejected BEFORE the decision transitions (contract 11).
      if (!targets.constitution) throw new DecisionTransitionRejected("plan rejected: bind_axiom requires the Constitution store");
      const snapshot = await targets.constitution.getCurrent();
      if (!snapshot) throw new DecisionTransitionRejected("plan rejected: bind_axiom before the first constitution sync — the axiom set is not served yet (not_synced)");
      if (!snapshot.manifest.some((m) => m.id === step.targetRef)) {
        throw new DecisionTransitionRejected(`plan rejected: bind_axiom target '${step.targetRef}' is not in the served constitution (known: ${snapshot.manifest.map((m) => m.id).join(", ")})`);
      }
      const status = step.params?.status;
      if (status !== undefined && !BINDING_STATUSES.includes(status as typeof BINDING_STATUSES[number])) {
        throw new DecisionTransitionRejected(`plan rejected: bind_axiom status '${String(status)}' not in the domain [${BINDING_STATUSES.join(", ")}]`);
      }
      // Self-reference guard travels into the pre-effect chain too.
      if (step.params?.predecessor === step.targetRef || step.params?.supersedes === step.targetRef) {
        throw new DecisionTransitionRejected(`plan rejected: bind_axiom '${step.targetRef}' cannot reference itself as predecessor/supersedes (self-reference guard)`);
      }
    }
    if (step.action === "amend_charter") {
      if (!CHARTER_SECTIONS.includes(step.targetRef as typeof CHARTER_SECTIONS[number])) {
        throw new DecisionTransitionRejected(`plan rejected: amend_charter target '${step.targetRef}' not in the domain [${CHARTER_SECTIONS.join(", ")}]`);
      }
      const text = step.params?.text;
      if (typeof text !== "string" || text.trim().length === 0) {
        throw new DecisionTransitionRejected("plan rejected: amend_charter requires non-empty params.text (the amendment content IS the plan — hash-bound at confirmation)");
      }
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
        if (!targets.approveViaPolicy) throw new DecisionTransitionRejected("approve requires the policy-path closure (never the raw repository method)");
        const outcome = await targets.approveViaPolicy(step.targetRef, `Approved by decision ${decision.id} (${decision.resolution?.authorityMode}; ref ${decision.resolution?.authorityRef})`);
        results.push({ action: step.action, targetRef: step.targetRef, ok: outcome.ok, detail: outcome.detail });
      } else if (step.action === "bind_axiom") {
        if (!targets.bindAxiomViaPolicy) throw new DecisionTransitionRejected("bind_axiom requires the policy-path closure (the {ratifiedBy, proofRef} pair is bound there, never fabricated here)");
        const outcome = await targets.bindAxiomViaPolicy(step);
        results.push({ action: step.action, targetRef: step.targetRef, ok: outcome.ok, detail: outcome.detail });
      } else if (step.action === "amend_charter") {
        if (!targets.amendCharterViaPolicy) throw new DecisionTransitionRejected("amend_charter requires the policy-path closure (the {ratifiedBy, proofRef} pair is bound there, never fabricated here)");
        const outcome = await targets.amendCharterViaPolicy(step);
        results.push({ action: step.action, targetRef: step.targetRef, ok: outcome.ok, detail: outcome.detail });
      }
    } catch (e) {
      results.push({ action: step.action, targetRef: step.targetRef, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}
