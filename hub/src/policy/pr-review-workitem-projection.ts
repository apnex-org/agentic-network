import { createHash } from "node:crypto";
import type { EvidenceRequirement, IWorkItemStore, WorkItem, WorkItemReference } from "../entities/work-item.js";
import {
  PR_EVIDENCE_REVIEW_GATE_RULE_ID,
  PR_EVIDENCE_REVIEW_REQUIRED_EVENT_TYPE,
  type PrWorkGraphBindingProof,
} from "./pr-review-workitem-event-contract.js";
import type { PrEvidenceLocator } from "./pr-evidence-admission-contract.js";
import type { ReviewerEligibilityProjectionSummary } from "./pr-reviewer-eligibility.js";
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

export type PrReviewProjectionRelation = "appendDependsOn" | "appendCompletionDependsOn";

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

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function reviewWorkId(projectionKey: string): string {
  return `work-prrev-${projectionKey.slice(0, 24)}`;
}

function prLocator(binding: Pick<PrWorkGraphBindingProof, "repo" | "prNumber">): string {
  return `${binding.repo}#${binding.prNumber}`;
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

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function buildPrEvidenceReviewProjectionKey(args: {
  binding: PrWorkGraphBindingProof;
  reviewerAgentId: string;
  reviewerGithubLogin: string;
  policyVersion?: string;
  policySourceRef?: string;
}): string {
  return sha256(
    [
      "pr-evidence-review-workitem-v0",
      args.binding.repo,
      args.binding.prNumber,
      args.binding.id,
      args.binding.targetWorkId,
      args.binding.version ?? "v0",
      args.binding.headSha ?? "",
      args.binding.baseSha ?? "",
      args.reviewerAgentId,
      args.reviewerGithubLogin,
      args.policyVersion ?? "",
      args.policySourceRef ?? "",
    ].join("\u001f"),
  );
}

function toPrEvidenceReviewObligationDraft(args: {
  projectionKey: string;
  binding: PrWorkGraphBindingProof;
  locator: PrEvidenceLocator;
  sourceMessageId: string;
  eligibility: ReviewerEligibilityProjectionSummary;
}): PrReviewObligationDraft {
  const selectedReviewer = args.eligibility.selectedReviewers[0];
  return {
    type: "review",
    priority: "normal",
    roleEligibility: [selectedReviewer.role],
    targetRef: { kind: "pull_request", id: prLocator(args.binding) },
    payload: {
      ruleId: PR_EVIDENCE_REVIEW_GATE_RULE_ID,
      eventType: PR_EVIDENCE_REVIEW_REQUIRED_EVENT_TYPE,
      eventIdempotencyKey: args.projectionKey,
      sourceMessageId: args.sourceMessageId,
      bindingId: args.binding.id,
      boundTargetWorkId: args.binding.targetWorkId,
      repo: args.binding.repo,
      prNumber: args.binding.prNumber,
      prUrl: args.locator.url ?? `https://github.com/${args.binding.repo}/pull/${args.binding.prNumber}`,
      requestedReviewerLogin: "",
      selectedReviewerLogin: selectedReviewer.githubLogin,
      reviewerAgentId: selectedReviewer.agentId,
      projectionKey: args.projectionKey,
      eligibility: args.eligibility,
      changedPathSource: args.binding.changedPaths || args.binding.pathClasses || args.binding.changedPathSource
        ? {
            changedPaths: args.binding.changedPaths,
            pathClasses: args.binding.pathClasses,
            provenance: args.binding.changedPathSource,
          }
        : undefined,
      completionPolicy: {
        requiredReviewerLogin: selectedReviewer.githubLogin,
        requiredHeadSha: args.binding.headSha ?? "",
        forbiddenReviewerLogins: unique([args.binding.authorLogin ?? "", args.binding.lastPusherLogin ?? ""]),
        lastPusherLogin: args.binding.lastPusherLogin,
        verifierAuthorityRequired: true,
      },
    },
    runbook:
      "Review the bound PR created from admitted PR evidence. Complete with explicit GitHub review evidence. Do not merge or enqueue unless separately authorized.",
    evidenceRequirements: [
      {
        id: "github_review_artifact",
        kind: "freeform",
        description:
          "Executor-submitted GitHub PR review artifact URL/id for the selected reviewer and bound head. This artifact is load-bearing input for verifier attestation but does not complete the review obligation alone.",
      },
      {
        id: "independent_pr_review_validation",
        kind: "review",
        evidenceAuthority: "verifier-attestation",
        description:
          "Verifier attestation that the submitted GitHub review artifact matches the selected reviewer, bound PR head, and independence policy. External-only refs are not load-bearing; cite the submitted evidence ref.",
      },
    ],
  };
}

export function projectPrEvidenceReviewWorkItem(args: {
  binding: PrWorkGraphBindingProof;
  locator: PrEvidenceLocator;
  sourceMessageId: string;
  eligibility: ReviewerEligibilityProjectionSummary;
  existingProjection?: ExistingPrReviewProjection | null;
}): PrReviewProjectionResult {
  const selectedReviewer = args.eligibility.selectedReviewers[0];
  if (!args.eligibility.ok || !selectedReviewer) {
    return {
      action: "fallback_only",
      projectionKey: null,
      reason: `reviewer_eligibility_${args.eligibility.reason ?? args.eligibility.requestedReviewerStatus}`,
    };
  }

  const projectionKey = buildPrEvidenceReviewProjectionKey({
    binding: args.binding,
    reviewerAgentId: selectedReviewer.agentId,
    reviewerGithubLogin: selectedReviewer.githubLogin,
    policyVersion: args.eligibility.policyVersion,
    policySourceRef: args.eligibility.policySourceRef,
  });

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
    createSpec: toReviewWorkItemCreateSpec({
      projectionKey,
      draft: toPrEvidenceReviewObligationDraft({
        projectionKey,
        binding: args.binding,
        locator: args.locator,
        sourceMessageId: args.sourceMessageId,
        eligibility: args.eligibility,
      }),
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function findExistingPrReviewProjection(
  store: Pick<IWorkItemStore, "listWorkItems" | "listWorkItemsByProjectionKey"> | undefined,
  projectionKey: string | null,
): Promise<ExistingPrReviewProjection | null> {
  if (!projectionKey || !store) return null;
  const listed = typeof store.listWorkItemsByProjectionKey === "function"
    ? await store.listWorkItemsByProjectionKey(projectionKey)
    : await store.listWorkItems();
  const found = (listed?.items ?? []).find((item) => {
    const payload = item.payload;
    return isRecord(payload) && payload.projectionKey === projectionKey;
  });
  return found ? { projectionKey, workId: found.id, status: found.status } : null;
}

export interface PrReviewProjectionReconcileResult {
  materialized: boolean;
  created?: boolean;
  workId?: string;
  relation?: PrReviewProjectionRelation | "reused_existing";
  compensated?: boolean;
  fallbackReason?: string;
}

async function appendRelation(args: {
  store: IWorkItemStore;
  binding: PrWorkGraphBindingProof;
  reviewWorkId: string;
  relation: PrReviewProjectionRelation;
}): Promise<void> {
  await args.store.updateWorkItem(
    args.binding.targetWorkId,
    { role: "architect", agentId: "system-pr-review-rule" },
    args.relation === "appendCompletionDependsOn"
      ? { appendCompletionDependsOn: [args.reviewWorkId] }
      : { appendDependsOn: [args.reviewWorkId] },
  );
}

export async function reconcilePrReviewProjection(args: {
  store?: IWorkItemStore;
  projection: PrReviewProjectionResult;
  binding?: PrWorkGraphBindingProof | null;
  sourceMessageId: string;
  relation?: PrReviewProjectionRelation;
}): Promise<PrReviewProjectionReconcileResult> {
  const { store, projection, binding } = args;
  const relation = args.relation ?? "appendDependsOn";
  if (!store || !binding || projection.action === "fallback_only") {
    return { materialized: false, fallbackReason: projection.action === "fallback_only" ? projection.reason : "missing_store_or_binding" };
  }
  if (projection.action === "reuse_existing_review_workitem") {
    if (relation === "appendCompletionDependsOn") {
      try {
        await appendRelation({ store, binding, reviewWorkId: projection.existingWorkId, relation });
        return { materialized: true, created: false, workId: projection.existingWorkId, relation };
      } catch (err) {
        return {
          materialized: false,
          created: false,
          workId: projection.existingWorkId,
          fallbackReason: `relation_failed:${(err as Error)?.message ?? String(err)}`,
        };
      }
    }
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
    await appendRelation({ store, binding, reviewWorkId: created.item.id, relation });
    return { materialized: true, created: created.created, workId: created.item.id, relation };
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
