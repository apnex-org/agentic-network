import type { WorkItem, IWorkItemStore } from "../entities/work-item.js";
import type { PrWorkGraphBindingProof } from "./pr-review-workitem-event-contract.js";
import type { PrEvidenceLocator } from "./pr-evidence-admission-contract.js";

export type PrEvidenceBindingDenialReason =
  | "binding_lookup_unavailable"
  | "binding_missing"
  | "binding_ambiguous"
  | "binding_not_hub_authored"
  | "binding_repo_mismatch"
  | "binding_pr_mismatch"
  | "binding_target_mismatch"
  | "binding_head_mismatch"
  | "binding_base_mismatch";

export type PrEvidenceBindingValidationResult =
  | {
      ok: true;
      binding: PrWorkGraphBindingProof;
      bindingId: string;
      targetWorkId: string;
    }
  | {
      ok: false;
      reason: PrEvidenceBindingDenialReason;
      fallbackOnly: true;
      candidateBindingIds?: string[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArrayField(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : undefined;
}

function provenanceFromPayload(value: unknown): PrWorkGraphBindingProof["provenance"] | null {
  if (value === "hub" || value === "raw-body-marker" || value === "external") return value;
  return null;
}

/**
 * Decode a WorkItem row that claims to be a PR↔WorkGraph binding proof. This is
 * extraction only; callers must still validate the proof against the submitted
 * PR locator and target WorkItem before admitting evidence.
 */
export function prWorkGraphBindingProofFromWorkItem(
  item: WorkItem,
  locator: Pick<PrEvidenceLocator, "repo" | "prNumber">,
): PrWorkGraphBindingProof | null {
  const p = item.payload;
  if (!isRecord(p)) return null;
  if (p.obligationKind !== "github_pr_workgraph_binding") return null;
  if (typeof p.targetWorkId !== "string") return null;
  const repo = typeof p.repo === "string" ? p.repo : "";
  const prNumber = typeof p.prNumber === "number" ? p.prNumber : NaN;
  if (repo !== locator.repo || prNumber !== locator.prNumber) return null;

  const payloadProvenance = provenanceFromPayload(p.provenance);
  const createdByCanAuthorHubBinding = item.createdBy?.role === "architect" || item.createdBy?.role === "system";
  const provenance = payloadProvenance ?? (createdByCanAuthorHubBinding ? "hub" : "external");

  return {
    id: item.id,
    repo,
    prNumber,
    targetWorkId: p.targetWorkId,
    provenance,
    headSha: typeof p.headSha === "string" ? p.headSha : undefined,
    baseSha: typeof p.baseSha === "string" ? p.baseSha : undefined,
    version: typeof p.version === "string" ? p.version : undefined,
    changedPaths: stringArrayField(p.changedPaths),
    pathClasses: stringArrayField(p.pathClasses),
    changedPathSource: typeof p.changedPathSource === "string" ? p.changedPathSource : undefined,
    lastPusherLogin: typeof p.lastPusherLogin === "string" ? p.lastPusherLogin : undefined,
    authorLogin: typeof p.authorLogin === "string" ? p.authorLogin : undefined,
  };
}

export function validatePrEvidenceBinding(args: {
  locator: Pick<PrEvidenceLocator, "repo" | "prNumber">;
  binding?: PrWorkGraphBindingProof | null;
  targetWorkId: string;
  expectedHeadSha?: string;
  expectedBaseSha?: string;
}): PrEvidenceBindingValidationResult {
  const { binding, locator } = args;
  if (!binding) {
    return { ok: false, reason: "binding_missing", fallbackOnly: true };
  }
  if (binding.provenance !== "hub") {
    return { ok: false, reason: "binding_not_hub_authored", fallbackOnly: true, candidateBindingIds: [binding.id] };
  }
  if (binding.repo !== locator.repo) {
    return { ok: false, reason: "binding_repo_mismatch", fallbackOnly: true, candidateBindingIds: [binding.id] };
  }
  if (binding.prNumber !== locator.prNumber) {
    return { ok: false, reason: "binding_pr_mismatch", fallbackOnly: true, candidateBindingIds: [binding.id] };
  }
  if (binding.targetWorkId !== args.targetWorkId) {
    return { ok: false, reason: "binding_target_mismatch", fallbackOnly: true, candidateBindingIds: [binding.id] };
  }
  if (binding.headSha && args.expectedHeadSha && binding.headSha !== args.expectedHeadSha) {
    return { ok: false, reason: "binding_head_mismatch", fallbackOnly: true, candidateBindingIds: [binding.id] };
  }
  if (binding.baseSha && args.expectedBaseSha && binding.baseSha !== args.expectedBaseSha) {
    return { ok: false, reason: "binding_base_mismatch", fallbackOnly: true, candidateBindingIds: [binding.id] };
  }
  return { ok: true, binding, bindingId: binding.id, targetWorkId: binding.targetWorkId };
}

export async function resolvePrEvidenceBinding(args: {
  store?: Pick<IWorkItemStore, "listPrReviewBindingWorkItems"> | null;
  locator: Pick<PrEvidenceLocator, "repo" | "prNumber">;
  targetWorkId: string;
  expectedHeadSha?: string;
  expectedBaseSha?: string;
}): Promise<PrEvidenceBindingValidationResult> {
  const { store, locator } = args;
  if (!store || typeof store.listPrReviewBindingWorkItems !== "function") {
    return { ok: false, reason: "binding_lookup_unavailable", fallbackOnly: true };
  }
  const listed = await store.listPrReviewBindingWorkItems(locator.repo, locator.prNumber);
  const candidates = listed.items
    .map((item) => prWorkGraphBindingProofFromWorkItem(item, locator))
    .filter((binding): binding is PrWorkGraphBindingProof => binding !== null);
  if (candidates.length > 1) {
    return {
      ok: false,
      reason: "binding_ambiguous",
      fallbackOnly: true,
      candidateBindingIds: candidates.map((binding) => binding.id),
    };
  }
  return validatePrEvidenceBinding({
    locator,
    binding: candidates[0] ?? null,
    targetWorkId: args.targetWorkId,
    expectedHeadSha: args.expectedHeadSha,
    expectedBaseSha: args.expectedBaseSha,
  });
}
