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

/** idea-641 — the ONE spelling of the binding marker. Callers never supply it; the constructor
 *  stamps it. That single property closes both faces: a caller can neither OMIT it (idea-641) nor
 *  FORGE a different one (bug-383's shape). */
export const PR_WORKGRAPH_BINDING_OBLIGATION_KIND = "github_pr_workgraph_binding";
const PR_WORKGRAPH_BINDING_VERSION = "1";
const FULL_SHA = /^[0-9a-f]{40}$/;

export interface PrWorkGraphBindingPayloadInput {
  repo: string;
  prNumber: number;
  targetWorkId: string;
  headSha: string;
  baseSha: string;
  changedPaths: string[];
  prUrl?: string;
  mergeCommit?: string;
  mergedAt?: string;
  authorLogin?: string;
  lastPusherLogin?: string;
  changedPathSource?: string;
}

/** Thrown by the binding-payload constructor. Carries EVERY problem at once, not the first. */
export class PrBindingPayloadInvalid extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(
      `PR binding payload REFUSED at write time — ${problems.length} problem(s): ${problems.join("; ")}.\n` +
      `MECHANICS: a binding row is only a lookup candidate if its payload is an OBJECT carrying ` +
      `obligationKind="${PR_WORKGRAPH_BINDING_OBLIGATION_KIND}", repo, prNumber and targetWorkId; ` +
      `reviewer eligibility additionally needs changedPaths; and sha fields are compared as STRINGS, ` +
      `so an abbreviated sha never equals the full one GitHub reports.\n` +
      `RATIONALE: every one of these was previously accepted silently and surfaced LATER as a ` +
      `different, misleading refusal at a different gate — binding_missing with an EMPTY candidate ` +
      `list, or reviewer_eligibility_changed_paths_missing, or binding_base_mismatch — none of which ` +
      `name the field that is actually wrong. Three such rows were authored in one evening, by an ` +
      `author who had a correct row open to copy.\n` +
      `CONSEQUENCE: the row is not written. Fix the fields named above and retry; you cannot reach ` +
      `a later gate with a payload this constructor rejects.`,
    );
    this.name = "PrBindingPayloadInvalid";
    this.problems = problems;
  }
}

/**
 * idea-641 — mint a PR↔WorkGraph binding payload, or REFUSE AT WRITE TIME.
 *
 * `obligationKind` and `version` are SUPPLIED HERE, never accepted from the caller: omission was
 * one of the three observed failures, and accepting it would re-open the forge-a-marker shape.
 * `provenance` is deliberately ABSENT from the input type — `prWorkGraphBindingProofFromWorkItem`
 * honours a payload-declared `provenance` over the authorship check (bug-376, still OPEN and NOT
 * addressed here), so this constructor simply refuses to be the thing that writes one.
 */
export function buildPrWorkGraphBindingPayload(input: PrWorkGraphBindingPayloadInput): Record<string, unknown> {
  const problems: string[] = [];
  if (typeof input.repo !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(input.repo)) {
    problems.push(`repo must be "owner/name" (got ${JSON.stringify(input.repo)})`);
  }
  if (!Number.isInteger(input.prNumber) || input.prNumber <= 0) {
    problems.push(`prNumber must be a positive integer (got ${JSON.stringify(input.prNumber)})`);
  }
  if (typeof input.targetWorkId !== "string" || input.targetWorkId.length === 0) {
    problems.push("targetWorkId is required — without it the row is not even a lookup candidate");
  }
  for (const [field, value] of [["headSha", input.headSha], ["baseSha", input.baseSha]] as const) {
    if (typeof value !== "string" || !FULL_SHA.test(value)) {
      problems.push(`${field} must be a FULL 40-char lowercase hex sha (got ${JSON.stringify(value)}) — shas are compared as strings, so a prefix silently mismatches`);
    }
  }
  if (input.mergeCommit !== undefined && !FULL_SHA.test(input.mergeCommit)) {
    problems.push(`mergeCommit, when present, must be a FULL 40-char lowercase hex sha (got ${JSON.stringify(input.mergeCommit)})`);
  }
  if (!Array.isArray(input.changedPaths) || input.changedPaths.length === 0 || input.changedPaths.some((p) => typeof p !== "string" || p.length === 0)) {
    problems.push("changedPaths must be a non-empty array of non-empty strings — reviewer eligibility refuses without it, and that refusal names neither this field nor this row");
  }
  if (problems.length) throw new PrBindingPayloadInvalid(problems);

  return {
    obligationKind: PR_WORKGRAPH_BINDING_OBLIGATION_KIND,
    version: PR_WORKGRAPH_BINDING_VERSION,
    repo: input.repo,
    prNumber: input.prNumber,
    targetWorkId: input.targetWorkId,
    headSha: input.headSha,
    baseSha: input.baseSha,
    changedPaths: [...input.changedPaths],
    ...(input.prUrl !== undefined ? { prUrl: input.prUrl } : {}),
    ...(input.mergeCommit !== undefined ? { mergeCommit: input.mergeCommit } : {}),
    ...(input.mergedAt !== undefined ? { mergedAt: input.mergedAt } : {}),
    ...(input.authorLogin !== undefined ? { authorLogin: input.authorLogin } : {}),
    ...(input.lastPusherLogin !== undefined ? { lastPusherLogin: input.lastPusherLogin } : {}),
    ...(input.changedPathSource !== undefined ? { changedPathSource: input.changedPathSource } : {}),
  };
}

/**
 * idea-641 write-time gate for `create_work` / `update_work`. Returns a refusal message, or null.
 *
 * TWO shapes are caught, because the three observed failures were not all the same shape:
 *  (1) a JSON-STRING payload that decodes to a binding — the decoder opens with `isRecord`, so a
 *      string is invisible to it AND to the store filter. The row looks perfect and matches nothing.
 *  (2) an OBJECT payload that DECLARES the binding kind but is missing/malformed — validated in
 *      full, so the caller learns every wrong field now instead of one misleading gate later.
 *
 * A payload that does not claim to be a binding is not this gate's business and passes untouched.
 */
export function prBindingPayloadWriteRefusal(payload: unknown): string | null {
  if (typeof payload === "string") {
    let decoded: unknown;
    try { decoded = JSON.parse(payload); } catch { return null; }
    if (!isRecord(decoded) || decoded.obligationKind !== PR_WORKGRAPH_BINDING_OBLIGATION_KIND) return null;
    return (
      `payload REFUSED: it is a JSON STRING that decodes to a PR binding, and it must be an OBJECT.\n` +
      `MECHANICS: the store filter matches nested paths (spec.payload.obligationKind) and the decoder ` +
      `opens with an isRecord() check — a string satisfies NEITHER, so the row is invisible to both.\n` +
      `RATIONALE: such a row is well-formed, readable, and prints almost identically to a correct one. ` +
      `It was diagnosed once as a repo-name mismatch because every field WAS right; only the container ` +
      `was wrong. create_message accepts a JSON-string payload (bug-102 tolerance), so callers have been ` +
      `correctly taught that "payload" tolerates a string — the contract differs between verbs.\n` +
      `CONSEQUENCE: pass the object itself, not JSON.stringify(object).`
    );
  }
  if (!isRecord(payload)) return null;
  if (payload.obligationKind !== PR_WORKGRAPH_BINDING_OBLIGATION_KIND) return null;
  try {
    buildPrWorkGraphBindingPayload({
      repo: payload.repo as string,
      prNumber: payload.prNumber as number,
      targetWorkId: payload.targetWorkId as string,
      headSha: payload.headSha as string,
      baseSha: payload.baseSha as string,
      changedPaths: payload.changedPaths as string[],
      mergeCommit: payload.mergeCommit as string | undefined,
    });
    return null;
  } catch (e) {
    if (e instanceof PrBindingPayloadInvalid) return e.message;
    throw e;
  }
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
