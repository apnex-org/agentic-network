import type { EvidenceRequirement, IWorkItemStore, WorkItemReference } from "../entities/work-item.js";
import type { PrWorkGraphBindingProof } from "./pr-review-workitem-event-contract.js";
import type { PrReviewObligationDraft, PrReviewRequestRuleResult } from "./pr-review-request-static-rule.js";

export type PrReviewProjectionAction =
  | "create_review_workitem"
  | "reuse_existing_review_workitem"
  | "fallback_only";

export interface ExistingPrReviewProjection {
  projectionKey: string;
  workId: string;
  status: string;
}

export interface PrReviewWorkItemCreateSpec {
  projectionKey: string;
  type: "review";
  priority: "normal";
  roleEligibility: string[];
  targetRef: { kind: "pull_request"; id: string };
  payload: PrReviewObligationDraft["payload"] & {
    projectionKey: string;
    obligationKind: "github_pr_review_request";
  };
  runbook: string;
  evidenceRequirements: PrReviewObligationDraft["evidenceRequirements"];
}

export type PrReviewProjectionResult =
  | {
      action: "create_review_workitem";
      projectionKey: string;
      createSpec: PrReviewWorkItemCreateSpec;
    }
  | {
      action: "reuse_existing_review_workitem";
      projectionKey: string;
      existingWorkId: string;
      existingStatus: string;
    }
  | {
      action: "fallback_only";
      projectionKey: string | null;
      reason: string;
    };

export function toReviewWorkItemCreateSpec(args: {
  projectionKey: string;
  draft: PrReviewObligationDraft;
}): PrReviewWorkItemCreateSpec {
  return {
    projectionKey: args.projectionKey,
    type: args.draft.type,
    priority: args.draft.priority,
    roleEligibility: args.draft.roleEligibility,
    targetRef: args.draft.targetRef,
    payload: {
      ...args.draft.payload,
      projectionKey: args.projectionKey,
      obligationKind: "github_pr_review_request",
    },
    runbook: args.draft.runbook,
    evidenceRequirements: args.draft.evidenceRequirements,
  };
}

function reviewWorkId(projectionKey: string): string {
  return `work-prrev-${projectionKey.slice(0, 24)}`;
}

function projectionReferences(args: {
  sourceMessageId: string;
  binding: PrWorkGraphBindingProof;
  prUrl: string;
}): WorkItemReference[] {
  return [
    { kind: "message", ref: args.sourceMessageId, storage: "entity", mode: "read", required: false },
    { kind: "workitem", ref: args.binding.targetWorkId, storage: "entity", mode: "read", required: true },
    { kind: "pr", ref: args.prUrl || `${args.binding.repo}#${args.binding.prNumber}`, storage: "inline", mode: "read", required: true },
    { kind: "pr-binding", ref: args.binding.id, storage: "inline", mode: "read", required: true },
  ];
}

export interface PrReviewProjectionReconcileResult {
  materialized: boolean;
  created?: boolean;
  workId?: string;
  relation?: "appendDependsOn" | "reused_existing";
  compensated?: boolean;
  fallbackReason?: string;
}

export async function reconcilePrReviewProjection(args: {
  store?: IWorkItemStore;
  projection: PrReviewProjectionResult;
  binding?: PrWorkGraphBindingProof | null;
  sourceMessageId: string;
}): Promise<PrReviewProjectionReconcileResult> {
  const { store, projection, binding } = args;
  if (!store || !binding || projection.action === "fallback_only") {
    return { materialized: false, fallbackReason: projection.action === "fallback_only" ? projection.reason : "missing_store_or_binding" };
  }
  if (projection.action === "reuse_existing_review_workitem") {
    return { materialized: true, created: false, workId: projection.existingWorkId, relation: "reused_existing" };
  }

  const spec = projection.createSpec;
  const created = await store.createBlueprintNode({
    id: reviewWorkId(projection.projectionKey),
    blueprintRunId: "pr_review_workitem0_projection",
    type: spec.type,
    priority: spec.priority,
    roleEligibility: spec.roleEligibility,
    targetRef: spec.targetRef,
    payload: spec.payload,
    runbook: spec.runbook,
    references: projectionReferences({ sourceMessageId: args.sourceMessageId, binding, prUrl: spec.payload.prUrl }),
    evidenceRequirements: spec.evidenceRequirements as EvidenceRequirement[],
    createdBy: { role: "architect", agentId: "system-pr-review-rule" },
  });

  try {
    await store.updateWorkItem(
      binding.targetWorkId,
      { role: "architect", agentId: "system-pr-review-rule" },
      { appendDependsOn: [created.item.id] },
    );
    return { materialized: true, created: created.created, workId: created.item.id, relation: "appendDependsOn" };
  } catch (err) {
    if (created.created) await store.deleteWorkItem(created.item.id);
    return {
      materialized: false,
      created: created.created,
      workId: created.item.id,
      compensated: created.created,
      fallbackReason: `relation_failed:${(err as Error)?.message ?? String(err)}`,
    };
  }
}

export function projectPrReviewWorkItem(args: {
  ruleResult: PrReviewRequestRuleResult;
  existingProjection?: ExistingPrReviewProjection | null;
}): PrReviewProjectionResult {
  if (args.ruleResult.action !== "materialize_review_obligation" || !args.ruleResult.obligationDraft) {
    return {
      action: "fallback_only",
      projectionKey: args.ruleResult.bindingDecision.ok ? args.ruleResult.bindingDecision.projectionKey : null,
      reason: args.ruleResult.fallback.reason,
    };
  }

  const projectionKey = args.ruleResult.bindingDecision.ok
    ? args.ruleResult.bindingDecision.projectionKey
    : null;
  if (!projectionKey) {
    return { action: "fallback_only", projectionKey: null, reason: "missing_projection_key" };
  }

  if (args.existingProjection?.projectionKey === projectionKey) {
    return {
      action: "reuse_existing_review_workitem",
      projectionKey,
      existingWorkId: args.existingProjection.workId,
      existingStatus: args.existingProjection.status,
    };
  }

  return {
    action: "create_review_workitem",
    projectionKey,
    createSpec: toReviewWorkItemCreateSpec({ projectionKey, draft: args.ruleResult.obligationDraft }),
  };
}
