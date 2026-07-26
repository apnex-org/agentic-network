/**
 * C1-R2 (mission-94) — WorkItemRepositorySubstrate (storage CRUD).
 *
 * The substrate-backed store for the reference-only WorkItem work-queue kind. This
 * is the sub-PR-2 STORAGE surface (create/get/list/CAS); the claim/lease/FSM VERBS
 * (claim_work / list_ready_work / start / block / resume / renew / release /
 * abandon / complete) land in sub-PR-3 on top of this. The claim authority is
 * `lease` (set atomically under a per-agent advisory lock at claim-time, sub-PR-3).
 *
 * Decode-to-flat at the read + CAS boundary (cloneWorkItem) per the envelope
 * substrate contract; the kind is born under the live C3-R4 governor (renameMap is
 * the single read-side field-path authority; write-encode via kinds/WorkItem.ts).
 */

import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import type { Filter } from "../storage-substrate/types.js";
import type { EntityProvenance } from "../state.js";
import { randomUUID, createHash } from "node:crypto";
import type {
  WorkItem,
  NodeConfig,
  WorkItemPhase,
  StateDurations,
  WorkItemType,
  WorkItemPriority,
  WorkItemLease,
  WorkItemBlockedOn,
  EvidenceRequirement,
  EvidenceItem,
  CompleteWorkResult,
  FrictionReflectionInput,
  FrictionReflectionRecord,
  FrictionRollup,
  EvidenceKind,
  WorkItemReference,
  ReadyEmptyReason,
  StintProjection,
  NextActionProjection,
  StintChild,
  LegalMoves,
  LegalMove,
  WorkItemVerb,
  IWorkItemStore,
  Attestation,
  AttestationVerdict,
  AttestationVerification,
  AttestationEvidenceRef,
  FailedGatePreClearReceiptV2,
  FailedGateSealV2,
  PendingFailedSealNotice,
  PauseWorkRequestV4,
  UnpauseWorkRequestV4,
  ReviseWorkRequestV4,
  ReviseWorkResultV4,
  CurrentWorkProjectionV4,
} from "./work-item.js";
import { DEFAULT_STATE_DURATIONS, evaluateCompletionGate } from "./work-item.js";
import { SubstrateCounter } from "./substrate-counter.js";
import { withAdvisoryLock, LOCK_CLASS } from "../storage-substrate/advisory-lock.js";
import { decodeEnvelopeToFlat } from "./shape-helpers.js";
import { type Clock, systemClock } from "./clock.js";
import {
  NODE_CONTRACT_HASH_VERSION,
  NODE_TOPOLOGY_HASH_VERSION,
  ENTITY_STATE_HASH_VERSION,
  bindWorkItemReferencesV4,
  canonicalJson,
  deriveLocalExecutionIdentityV4,
  deriveNodeContractV4,
  deriveNodeTopologyV4,
  hashCanonicalDomain,
  type FrozenRecallAuthorityV4,
  type PendingRecallIntentV4,
  type RecallBeforeStateV4,
  type RecallHistoryEntryV4,
  type AuthoritativeReferenceResolutionV4,
  type BoundWorkItemReferenceV4,
  type TargetBindingV4,
} from "./work-item-contract-v4.js";
import {
  WorkGraphCurrentnessFenceV4,
  WorkGraphCurrentnessRejected,
  type WorkGraphPinV4,
} from "./workgraph-currentness-fence-v4.js";
import {
  WORK_GRAPH_HEAD_ID,
  WORK_REVISION_KINDS,
  WorkRevisionStorageRepositoryV4,
  WorkRevisionStorageError,
  buildWorkRevisionStorageV4,
  type WorkGraphRevisionOperationV4,
  type WorkRevisionFamilyRowV4,
} from "./work-revision-storage-v4.js";

const KIND = "WorkItem";
const ENTITY_REFERENCE_SCHEMA: Readonly<Record<string, string>> = Object.freeze({
  workitem: "WorkItem", work: "WorkItem", bug: "Bug", idea: "Idea", mission: "Mission",
  decision: "Decision", review: "WorkItem", incident: "Bug", calibration: "Document", skill: "Document",
});
const entityReferenceSchemaKind = (semanticKind: string): string => ENTITY_REFERENCE_SCHEMA[semanticKind.toLowerCase()] ?? semanticKind;
const LIST_CAP = 500;

/**
 * bug-371 migration paging. Deliberately NOT `LIST_CAP`: the migration's traversal is a different
 * concern from the read-API's response cap, and tying them would make a later tuning of one
 * silently change the other.
 *
 * MIGRATION_MAX_SCAN is a RUNAWAY BACKSTOP, not a coverage limit — it exists so a substrate that
 * kept returning full pages could not spin forever. Reaching it sets `truncated`, which the
 * entrypoint treats as a FATAL incomplete run. It is set far above any plausible corpus precisely
 * so that hitting it means something is wrong rather than something is big.
 */
const MIGRATION_PAGE_SIZE = 500;
const MIGRATION_MAX_SCAN = 100_000;

/**
 * 🔴 THE SUBSTRATE SILENTLY CLAMPS `limit` TO 500 — `Math.min(limit ?? 100, 500)`, in BOTH the
 * postgres and memory implementations. MEASURED, not read from a doc.
 *
 * That clamp is a trap for the paging loop below, because the loop terminates on a SHORT PAGE.
 * Raise `MIGRATION_PAGE_SIZE` above the clamp and every page comes back at 500 — fewer than
 * requested — so the loop stops after ONE page and silently reproduces exactly the truncation
 * defect this change exists to fix. The failure would look like a clean, complete, one-page run.
 *
 * So the relationship is asserted rather than commented. This is the PER-PAGE invariant: the page
 * size we ask for must be one the substrate will actually honour.
 */
const SUBSTRATE_LIST_CLAMP = 500;
if (MIGRATION_PAGE_SIZE > SUBSTRATE_LIST_CLAMP) {
  throw new Error(
    `[bug-371 migration] MIGRATION_PAGE_SIZE ${MIGRATION_PAGE_SIZE} exceeds the substrate's silent ` +
    `list clamp of ${SUBSTRATE_LIST_CLAMP}; every page would return short and the paged scan would ` +
    `terminate after one page, re-introducing the truncation defect it exists to fix.`,
  );
}
/** The substrate hard-clamps list() to 500 rows; the ready-scan uses it as the cap and
 *  flags truncation when hit (list_ready_work is truncation-HONEST, audit-4070 #3). */
const READY_SCAN_CAP = 500;
const MAX_CAS_RETRIES = 50;

/** The lease TTL. **`claim` sets `expiresAt = NOW + this`, NOT `claimedAt + this`** (see the claim
 *  site: `new Date(now.getTime() + leaseTtlMsFor(w))`); `renewLease` re-extends from now likewise.
 *
 *  Today those two readings coincide, because a fresh claim also sets `claimedAt = now` — so the
 *  old wording ("expiresAt = claimedAt + this") was true only BY COINCIDENCE. bug-384 breaks the
 *  coincidence: a same-holder re-claim now PRESERVES an older `claimedAt` while still granting a
 *  full fresh window. Deriving `expiresAt` from that preserved `claimedAt` would mint a lease that
 *  is ALREADY EXPIRED at the moment of claim — which the sweeper immediately reaps, incrementing
 *  the claim-thrash counter toward the lockout of bug-382, the bug this work partly relieves.
 *
 *  The two fields serve different purposes and must be derived differently: **`expiresAt` is the
 *  lease clock (from now); `claimedAt` is the evidence-freshness baseline (from the holder's first
 *  claim).** A tunable knob — the lease-expiry sweeper re-queues past `expiresAt`. 15 min default. */
const LEASE_TTL_MS = 15 * 60 * 1000;

/** work-164 (idea-395): the effective lease window for an item — its author-set
 *  node-type-aware `leaseWindowMs` when present (a positive finite number), else the
 *  flat default. The declarative belt-and-suspenders behind the adapter auto-heartbeat:
 *  a known long-hold / design-first node gets an extended floor so it survives even a
 *  quiet stretch. The sweeper reads expiresAt, so no sweeper change is needed. */
export function leaseTtlMsFor(w: { leaseWindowMs?: number }): number {
  const win = w.leaseWindowMs;
  return typeof win === "number" && Number.isFinite(win) && win > 0 ? win : LEASE_TTL_MS;
}

/** Max wall-time waiting for the per-agent WIP advisory lock. On timeout the claim
 *  is REJECTED (fail-CLOSED, LockAcquisitionTimeoutError) — never proceeds unlocked. */
const CLAIM_LOCK_TIMEOUT_MS = 5000;

/** Phases that count toward an agent's WIP cap (the in-flight count at claim-time).
 *  audit-4082 #2: ALL non-terminal phases that still HOLD a lease — claimed +
 *  in_progress + blocked + review. blocked/review do NOT release the lease (the agent
 *  still owns the work), so excluding them would let an agent hoard blocked/review
 *  items and claim past the cap. (Supersedes the construction-design §3.2 narrower
 *  claimed+in_progress draft — Steve's threat-model resolved the question.) */
const WIP_PHASES: readonly WorkItemPhase[] = ["claimed", "in_progress", "blocked", "review"];

/** Phases in which the agent holds an active lease (lease object non-null; renew /
 *  heartbeat legal). Mirrors WIP_PHASES — the lease is held until a terminal/ready edge. */
const LEASE_HELD_PHASES: readonly WorkItemPhase[] = ["claimed", "in_progress", "blocked", "review"];

/** Phases from which release_work / abandon_work are legal (FSM §3.1). review is
 *  excluded — a review item advances only via complete_work or the lease-expiry
 *  sweeper (sub-PR-4); review-edge finalization lands with complete_work (3a-ii). */
const RELEASABLE_PHASES: readonly WorkItemPhase[] = ["claimed", "in_progress", "blocked"];

/** Phases whose lease-expiry accrues per-ITEM poison (audit-4103 #3): ONLY the
 *  claim-and-crash phases. A review/blocked item that lapses (e.g. a parked, evidenced
 *  review item waiting on a slow verifier) re-queues WITHOUT incrementing leaseExpiryCount
 *  — it must never terminal-abandon + lose real work. */
const POISON_ELIGIBLE_PHASES: readonly WorkItemPhase[] = ["claimed", "in_progress"];

/** Default per-agent WIP cap. Per-role override map is construction-design open-Q #3
 *  (pending architect); until then every role gets the default. */
const DEFAULT_WIP_CAP = 3;
const WIP_CAP_BY_ROLE: Readonly<Record<string, number>> = {};
function wipCap(role?: string): number {
  return (role && WIP_CAP_BY_ROLE[role]) || DEFAULT_WIP_CAP;
}

/** work-94 (cold-start spine, non-dark digest): the reason for an empty post-WIP-cap ready
 *  scan — `no_claimable_ready` (nothing ready+role-eligible+deps-met) when none survived, else
 *  none. Extracted PURE so the constant is value-pinned by a unit test (the shared-testcontainer
 *  sibling-leak makes the integration path not deterministically empty — work-94 sub-2 nit). */
export function readyScanEmptyReason(claimableCount: number): ReadyEmptyReason | undefined {
  return claimableCount === 0 ? "no_claimable_ready" : undefined;
}

/** FSM-gate rejection (per-repo-local sentinel; the established repo pattern). Thrown
 *  inside a tryCasUpdate transform on an illegal source phase or a non-holder actor;
 *  propagates out so the policy layer maps it to a 409-style rejection. */
export class TransitionRejected extends Error {
  constructor(reason: string) {
    super(`transition rejected: ${reason}`);
    this.name = "TransitionRejected";
  }
}

/** Thrown by claimWorkItem when the agent is already at its WIP cap. */
export class WipCapExceeded extends Error {
  constructor(
    public readonly agentId: string,
    public readonly inFlight: number,
    public readonly cap: number,
  ) {
    super(`WIP cap exceeded: agent ${agentId} holds ${inFlight} in-flight item(s) (cap ${cap})`);
    this.name = "WipCapExceeded";
  }
}

/** Thrown by completeWork when the anti-gameability evidence predicate fails. Carries
 *  a SPECIFIC reason (which requirement uncovered / which evidence failed freshness or
 *  resolve) — never a silent close (audit-4082 evidence contract). */
export class EvidencePredicateFailed extends Error {
  constructor(reason: string) {
    super(`evidence predicate failed: ${reason}`);
    this.name = "EvidencePredicateFailed";
  }
}

/** work-88 (arc-node): thrown by completeWork when a node's COMPLETION-gate is unmet —
 *  i.e. some WorkItem in its completionDependsOn is not yet `done`. Carries the k/N
 *  progress + the pending child ids so the policy layer surfaces a precise
 *  "completion gate: k/N downstream done" (GATE ONLY — the arc-holder still completes;
 *  this is never an auto-complete). Distinct from EvidencePredicateFailed: it gates the
 *  subtree-finalised precondition, which is checked BEFORE the evidence predicate. */
export class CompletionGateRejected extends Error {
  constructor(
    public readonly done: number,
    public readonly total: number,
    public readonly pending: string[],
    reason: string,
  ) {
    super(`completion gate rejected: ${reason}`);
    this.name = "CompletionGateRejected";
  }
}

/** Thrown by claimWorkItem when the agent is role-INELIGIBLE for the item, or the item's
 *  dependencies are not all done (audit-4085 #1). Distinct from TransitionRejected (a
 *  phase-conflict) — this is a claim PRECONDITION failure (role / dependency), so the
 *  policy layer can surface it distinctly (403/424-class vs 409). */
export class ClaimRejected extends Error {
  constructor(reason: string) {
    super(`claim rejected: ${reason}`);
    this.name = "ClaimRejected";
  }
}

/** Role-eligibility guard (audit-4085 #1). An EMPTY roleEligibility means any role; a
 *  non-empty one requires a matching `role` — fail-CLOSED if `role` is absent/unmatched.
 *  claim_work is the AUTHORITY (a direct claim-by-ID bypasses the list_ready_work
 *  projection), so it re-enforces eligibility itself. */
function assertRoleEligible(w: WorkItem, role?: string): void {
  if (w.roleEligibility.length === 0) return; // empty = any-role
  if (!role || !w.roleEligibility.includes(role)) {
    throw new ClaimRejected(`agent role ${role ?? "(none)"} is not in roleEligibility [${w.roleEligibility.join(", ")}]`);
  }
}

/** Phases from which complete_work is legal (FSM §3.1). */
const COMPLETABLE_PHASES: readonly WorkItemPhase[] = ["in_progress", "review"];

/** OIS-INTERNAL evidence kinds whose ref is EXISTENCE-checked (substrate-get) when the
 *  requirement is refResolvable. audit→Audit; review→WorkItem (the verifier-gate
 *  work-item, design §3.4 linkage — there is no standalone Review entity kind, and
 *  create_review is DEPRECATED per audit-9429). A REVIEW-kind requirement is therefore
 *  also satisfiable by a verifier-authored AUDIT binding (bug-220 (b) — resolved by this
 *  map's audit row, since the map is keyed by the EVIDENCE kind, not the requirement's). */
const OIS_INTERNAL_EVIDENCE_KINDS: Partial<Record<EvidenceKind, string>> = {
  audit: "Audit",
  review: "WorkItem",
};

/** A ref the completeWork predicate must existence-check AND relevance-check (audit-4103
 *  #1) async (outside the CAS). `evidenceKind` selects the relevance rule; `reqKind` lets
 *  the resolve phase apply the verifier-author anchor when an audit satisfies a REVIEW
 *  requirement on a normal item (bug-220 (b)). */
interface RefToResolve { requirementId: string; kind: string; id: string; evidenceKind: EvidenceKind; reqKind: EvidenceKind }

/** A review-requirement binding whose producedBy must resolve to a verifier (audit-4103 #2). */
interface VerifierCheck { requirementId: string; producedBy?: string }

/** ISO-8601 chronological compare (parse-based — tolerates timezone/format variance;
 *  a malformed timestamp is treated as NOT-fresh, fail-closed). */
function producedAtOnOrAfter(producedAt: string, claimedAt: string): boolean {
  const p = Date.parse(producedAt);
  const c = Date.parse(claimedAt);
  if (!Number.isFinite(p) || !Number.isFinite(c)) return false;
  return p >= c;
}

/** Evidence identity (requirementId|kind|ref|producedAt) — the mergeEvidence dedup key
 *  AND the bug-222 grandfather key (evidence already persisted on the item is exempt
 *  from freshness re-validation; it could only have been persisted by a prior
 *  completeWork that enforced the predicate at bind time). */
function evidenceKey(e: EvidenceItem): string {
  return `${e.requirementId}|${e.kind}|${e.ref ?? ""}|${e.producedAt}`;
}

/** Append supplied evidence to the existing set, DEDUPED by identity
 *  (requirementId|kind|ref|producedAt) — so a network-retry can't double-append
 *  (audit-4082 #3 idempotency). */
function mergeEvidence(existing: EvidenceItem[], supplied: EvidenceItem[]): EvidenceItem[] {
  const seen = new Set<string>();
  const out: EvidenceItem[] = [];
  for (const e of [...existing, ...supplied]) {
    const key = evidenceKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function normalizeFrictionReflection(input: FrictionReflectionInput, agentId: string, producedAt: string): FrictionReflectionRecord {
  if (input.observed === true && (!input.summary || input.summary.trim() === "")) {
    throw new EvidencePredicateFailed("frictionReflection.summary is required when observed=true");
  }
  const summary = input.summary?.trim() || (input.observed ? "" : "no friction observed");
  return {
    producedAt,
    producedBy: agentId,
    sourceVerb: "complete_work",
    observed: input.observed,
    summary,
    categories: input.categories?.length ? input.categories : [],
    ...(input.suggestedFollowUp ? { suggestedFollowUp: input.suggestedFollowUp } : {}),
    compatibility: "explicit",
  };
}

function emptyFrictionRollup(): FrictionRollup {
  return { total: 0, observed: 0, missingLegacy: 0, categories: {} };
}

function addFrictionToRollup(acc: FrictionRollup, reflections: readonly FrictionReflectionRecord[] | undefined): void {
  for (const r of reflections ?? []) {
    acc.total += 1;
    if (r.observed) acc.observed += 1;
    if (r.compatibility === "missing_legacy_client") acc.missingLegacy += 1;
    for (const c of r.categories ?? []) acc.categories[c] = (acc.categories[c] ?? 0) + 1;
  }
}

/**
 * The anti-gameability evidence predicate (audit-4082 evidence contract). PURE +
 * synchronous (so it runs inside the CAS transform); OIS-internal ref existence-checks
 * are returned as `refsToResolve` for the async caller. Throws EvidencePredicateFailed
 * with a specific reason on any unmet condition, EXCEPT an uncovered review requirement
 * (which legitimately PARKS the item in `review` awaiting the verifier).
 *
 *   #1 coverage-by-BINDING (evidence names the requirement id, not just kind)
 *   #2 kind-match  #3 freshness (producedAt >= lease.claimedAt unless the requirement
 *      sets allowPreClaim OR the entry is ALREADY PERSISTED on the item — bug-222: a
 *      review/blocked item reaped to ready preserves its evidence by design; on re-claim
 *      that evidence predates the NEW lease, but it was freshness-validated when bound
 *      under the prior lease, so re-validating it would make the reap's evidence-
 *      preservation guarantee hollow. `priorKeys` is server-side state (w.evidence),
 *      never caller input — a completer cannot smuggle stale evidence through it.)
 *
 *      bug-384 EXTENDS that same intent to evidence PRODUCED under a prior lease of the
 *      SAME holder but never BOUND. The clause above keys on evidence having been bound,
 *      and evidence never binds if completion keeps being refused — so A RELIEF VALVE THAT
 *      ONLY OPENS FOR EVIDENCE THAT ALREADY GOT THROUGH IS CLOSED TO EXACTLY THE CASE THAT
 *      NEEDS IT. `priorHolderFloor` is likewise server-side (derived from recallHistory),
 *      never caller input.
 *   #5 no-double-count (structural: one entry names one requirementId)
 *   #6 empty-req floor (>=1 freeform evidence; no silent zero-evidence close)
 */
/**
 * bug-384 — the freshness floor contributed by a PRIOR lease of the row's CURRENT holder.
 *
 * MECHANICS: scans `recallHistory` for entries whose frozen `before.lease.holder` is the current
 * holder, and returns the EARLIEST such `claimedAt`. Null when there is none.
 *
 * RATIONALE: bug-222 already ruled that a re-claim must not invalidate a holder's legitimate
 * evidence; it just keyed on evidence having been BOUND, which never happens if completion keeps
 * being refused. This restores the intended guarantee for evidence that was merely PRODUCED.
 *
 * CONSEQUENCE / SCOPE, stated because it is a real limit rather than an oversight: this can only
 * see leases that were RECORDED. A lease ended by `expireLease` before the same-commit fix below
 * left no record at all, so rows whose only prior lease died to the timer BEFORE this shipped
 * cannot be rescued — the datum was destroyed, not hidden. Those need a dispositioned successor.
 *
 * SERVER-SIDE ONLY: derived from persisted state, never from completer input, exactly as
 * `priorKeys` is. A caller cannot widen their own freshness window.
 */
function priorLeaseFloorFor(item: Pick<WorkItem, "lease" | "recallHistory">): string | null {
  const holder = item.lease?.holder;
  if (!holder) return null;
  let earliest: string | null = null;
  for (const entry of item.recallHistory ?? []) {
    const prior = entry.before?.lease;
    if (!prior || prior.holder !== holder) continue;
    if (earliest === null || prior.claimedAt < earliest) earliest = prior.claimedAt;
  }
  return earliest;
}

function evaluateEvidence(
  requirements: EvidenceRequirement[],
  evidence: EvidenceItem[],
  lease: WorkItemLease | null,
  isVerifierGate: boolean,
  priorKeys: ReadonlySet<string>,
  /** bug-384: REQUIRED, not optional-with-default. A defaulted parameter lets a call site
   *  silently keep the old behaviour — the one-rule-two-call-sites failure this codebase
   *  keeps producing. Required makes an omission a COMPILE ERROR at all three call sites. */
  priorHolderFloor: string | null,
): { nextPhase: WorkItemPhase; refsToResolve: RefToResolve[]; verifierChecks: VerifierCheck[] } {
  const claimedAt = lease?.claimedAt ?? null;
  const refsToResolve: RefToResolve[] = [];
  const verifierChecks: VerifierCheck[] = [];

  // #6 EMPTY-REQ FLOOR
  if (requirements.length === 0) {
    if (!evidence.some((e) => e.kind === "freeform")) {
      throw new EvidencePredicateFailed("no evidence requirements declared, but complete_work still requires >=1 freeform evidence (no silent zero-evidence close)");
    }
    return { nextPhase: "done", refsToResolve, verifierChecks };
  }

  let reviewDeferred = false;
  for (const req of requirements) {
    // #1 coverage-by-binding: evidence entries that NAME this requirement's id.
    const boundById = evidence.filter((e) => e.requirementId === req.id);
    // SEAL (idea-444) HARD FENCE: a verifier-attestation requirement is NEVER satisfiable by
    // executor-supplied evidence — its satisfaction is the attestation gate's domain
    // (evaluateCompletionGate). Executor evidence bound to it (even with producedBy naming a
    // verifier — that field is caller-forgeable) is a laundering attempt → reject loudly.
    if (req.evidenceAuthority === "verifier-attestation") {
      if (boundById.length > 0) {
        throw new EvidencePredicateFailed(`requirement '${req.id}' is evidenceAuthority=verifier-attestation — executor-supplied evidence cannot satisfy it (only a verifier's attest_evidence verdict can); remove the bound evidence`);
      }
      continue; // satisfied via the attestation gate, not the executor predicate
    }
    if (boundById.length === 0) {
      // an uncovered REVIEW requirement parks the item in `review` (verifier not yet);
      // any other uncovered requirement is a hard fail (the agent's evidence is short).
      if (req.kind === "review") { reviewDeferred = true; continue; }
      throw new EvidencePredicateFailed(`requirement '${req.id}' (${req.kind}) has no bound evidence`);
    }
    // #2 kind-match. bug-204/audit-5093: a verifier-gate's pass-evidence is the verifier's
    // durable verdict = a kind:audit ref. (SEAL-C/idea-444: create_audit_entry is RETIRED — this
    // is now the LEGACY path; new verifier verdicts use attest_evidence. create_review is DEPRECATED
    // per audit-9429 — there is NO verifier-mintable Review entity.) So on a verifier-gate, an audit
    // binding ALSO satisfies ANY requirement — including an already-seeded kind:review one
    // (back-compat for live blueprints). bug-220 (b) widens this ONE notch: an audit binding
    // also satisfies a REVIEW-kind refResolvable requirement on EVERY item (otherwise such
    // requirements are unsatisfiable by construction — no role can mint the gate WorkItem the
    // ref path expects). refResolvable-ONLY (audit-9443 verifier finding #1): the audit
    // author-anchor + relate guards run in the ref-resolution phase, which only refResolvable
    // requirements reach — widening the non-refResolvable case would let a caller-supplied
    // audit bypass those guards onto the spoofable producedBy fallback. A non-refResolvable
    // review requirement keeps the existing review-kind/producedBy path unchanged. Still
    // guarded narrow: commit/pr/test-run/doc requirements stay strict exact-kind-match
    // everywhere — a worker can't audit-bind a normal code requirement.
    const auditSatisfies = isVerifierGate || (req.kind === "review" && req.refResolvable === true);
    const kindMatched = boundById.filter((e) => e.kind === req.kind || (auditSatisfies && e.kind === "audit"));
    if (kindMatched.length === 0) {
      throw new EvidencePredicateFailed(`requirement '${req.id}' evidence kind mismatch (expected ${req.kind}${auditSatisfies ? " or audit (verifier verdict)" : ""}, bound entries: ${boundById.map((e) => e.kind).join(", ")})`);
    }
    // #3 freshness (already-persisted evidence is grandfathered — bug-222)
    const fresh = kindMatched.filter((e) =>
      req.allowPreClaim || priorKeys.has(evidenceKey(e)) || (claimedAt != null && producedAtOnOrAfter(e.producedAt, claimedAt))
      // bug-384: admitted under a PRIOR lease of the SAME holder (server-side, see above).
      || (priorHolderFloor != null && producedAtOnOrAfter(e.producedAt, priorHolderFloor)));
    if (fresh.length === 0) {
      // bug-384 MESSAGE FIX. The old text told the caller that "only the requirement author can
      // waive this via the requirement-level allowPreClaim flag" — MECHANICS that are true and a
      // REMEDY that is unreachable: allowPreClaim lives inside evidenceRequirements, which is
      // immutable, so even the requirement author cannot set it on an existing row. AN ERROR
      // NAMING AN INAPPLICABLE REMEDY IS WORSE THAN ONE NAMING NONE — it sends the reader to
      // spend time on a door that does not open. State what is true, and what actually works.
      throw new EvidencePredicateFailed(
        `requirement '${req.id}' evidence failed freshness: producedAt is before this lease's claimedAt=${claimedAt}` +
        (priorHolderFloor != null ? ` and before your earliest recorded prior lease (claimedAt=${priorHolderFloor})` : "") +
        `. MECHANICS: evidence must be produced under a lease you hold — CLAIM FIRST, THEN PRODUCE. ` +
        `RATIONALE: it stops evidence made for other work being recycled into this claim. ` +
        `CONSEQUENCE: an artifact that cannot be re-produced (a merge commit, a merged PR) is not admissible under a later lease ` +
        `unless a prior lease of YOURS is recorded on this row. NOTE: allowPreClaim can only be set when the requirement is ` +
        `AUTHORED — it lives inside immutable evidenceRequirements, so it is NOT settable on this row now; a successor node ` +
        `authored with it is the sanctioned path. DO NOT restamp producedAt: the timestamp is the artifact's, not the claim's.`,
      );
    }
    const e = fresh[0]; // the binding evidence
    // #4 refResolvable: OIS-internal → existence + RELEVANCE check (queued, audit-4103 #1);
    // external → format-only.
    if (req.refResolvable) {
      const internalKind = OIS_INTERNAL_EVIDENCE_KINDS[e.kind];
      if (internalKind) {
        if (!e.ref || e.ref.trim() === "") throw new EvidencePredicateFailed(`requirement '${req.id}' refResolvable evidence has no ref`);
        refsToResolve.push({ requirementId: req.id, kind: internalKind, id: e.ref, evidenceKind: e.kind, reqKind: req.kind });
      } else if (!e.ref || e.ref.trim() === "") {
        throw new EvidencePredicateFailed(`requirement '${req.id}' refResolvable evidence has a malformed (empty) ref`);
      }
    }
    // #2 (audit-4103/4120): review-kind provenance. A refResolvable review resolves the
    // gate WorkItem + checks ITS Hub-stamped createdBy=verifier (non-spoofable; done in the
    // async refsToResolve phase). A NON-refResolvable review has no gate → fall back to the
    // caller's producedBy claim (spoofable v1 residual, idea-347).
    if (req.kind === "review" && !req.refResolvable) {
      verifierChecks.push({ requirementId: req.id, producedBy: e.producedBy });
    }
  }
  return { nextPhase: reviewDeferred ? "review" : "done", refsToResolve, verifierChecks };
}

/** Decode envelope→flat + normalize the array/object fields to their empty
 *  defaults (a freshly-decoded row may omit absent collections). Used at the read
 *  boundary AND the CAS path (so the flat shape round-trips through the encoder). */
function cloneWorkItem(w: WorkItem): WorkItem {
  const flat = decodeEnvelopeToFlat(w as unknown as Record<string, unknown>, "WorkItem") as Record<string, unknown>;
  flat.roleEligibility = (flat.roleEligibility as string[] | undefined) ?? [];
  flat.dependsOn = (flat.dependsOn as string[] | undefined) ?? [];
  flat.completionDependsOn = (flat.completionDependsOn as string[] | undefined) ?? [];  // work-88: the COMPLETION-gate edge, spec-partitioned, decoded by decodeEnvelopeToFlat
  flat.evidenceRequirements = (flat.evidenceRequirements as EvidenceRequirement[] | undefined) ?? [];
  flat.references = (flat.references as unknown[] | undefined) ?? [];  // work-86: spec-partitioned, decoded by decodeEnvelopeToFlat
  flat.evidence = (flat.evidence as unknown[] | undefined) ?? [];
  flat.frictionReflections = (flat.frictionReflections as unknown[] | undefined) ?? [];
  flat.lease = flat.lease ?? null;
  flat.targetRef = flat.targetRef ?? null;
  flat.blockedOn = flat.blockedOn ?? null;
  flat.leaseExpiryCount = (flat.leaseExpiryCount as number | undefined) ?? 0;
  // work-98 (idea-384 Part A): per-state timers. Migration-default enteredCurrentStateAt to
  // updatedAt (the last-transition stamp = the best proxy for when a pre-existing item entered
  // its current state); buckets default to zero (pre-timer historical dwell is not retro-captured,
  // so the sum-identity is asserted only on nodes born under the timer).
  flat.enteredCurrentStateAt = (flat.enteredCurrentStateAt as string | undefined) ?? (flat.updatedAt as string);
  flat.stateDurations = (flat.stateDurations as StateDurations | undefined) ?? { ...DEFAULT_STATE_DURATIONS };
  // SEAL (idea-444): birth-empty the attestation subtree — a freshly-decoded / pre-SEAL row omits
  // these; default them here so the flat shape round-trips through the encoder with the subtree
  // intact (the preserve-not-inject read boundary; A2's attest_evidence is the only writer).
  flat.attestationHistory = (flat.attestationHistory as unknown[] | undefined) ?? [];
  flat.attestations = (flat.attestations as Record<string, unknown> | undefined) ?? {};
  flat.executorHistory = (flat.executorHistory as string[] | undefined) ?? [];
  // Mission-140 revision storage: append-only recall/outbox fields are
  // preserve-not-inject status state. Legacy rows project empty without a
  // write-on-read; later semantic writers alone append.
  flat.recallHistory = (flat.recallHistory as unknown[] | undefined) ?? [];
  flat.pendingRecallIntents = (flat.pendingRecallIntents as unknown[] | undefined) ?? [];
  flat.recallNoticePending = flat.recallNoticePending ?? (flat.pendingRecallIntents as Array<{ projectedMessageId?: string | null }>).some((intent) => !intent.projectedMessageId);
  // failed-gate-seal-v2: legacy rows default without a write-on-read. Effective
  // terminality is DERIVED before every claim/sweep projection so a pre-v2 active
  // verifier FAIL can never re-enter the ready queue while awaiting reconciliation.
  flat.failedGateSeal = flat.failedGateSeal ?? null;
  flat.pendingFailedSealNotices = (flat.pendingFailedSealNotices as unknown[] | undefined) ?? [];
  flat.failedSealNoticePending = (flat.pendingFailedSealNotices as PendingFailedSealNotice[])
    .some((notice) => notice.projectedMessageId === null);
  const decoded = flat as unknown as WorkItem;
  flat.effectiveDisposition = isFailedGateSealed(decoded) ? "failed_sealed" : null;
  return flat as unknown as WorkItem;
}

/**
 * idea-384 Part A (work-98) — the SINGLE shared state-timer accrual. Computes the wall-clock
 * spent in the EXITING state (w.status, since w.enteredCurrentStateAt) and accumulates it into
 * that state's bucket, then re-stamps enteredCurrentStateAt = nowISO. EVERY FSM transition spreads
 * this (claim/start/block/resume/complete/release/abandon + the sweeper requeue) so no site can
 * drift (cal #96 — ONE symbol, not 10 copies; the verify drops it from a single site to red one
 * bucket's test). Terminal exits (→done/abandoned) still accrue the final dwell so the sum-identity
 * closes (sum(buckets) === createdAt→completedAt). Clamps negative elapsed (clock skew) to 0.
 * Requeues RE-ACCUMULATE: a node re-entering ready ADDS the new ready-dwell onto the prior total.
 */
export function accrueExitingState(
  w: Pick<WorkItem, "status" | "enteredCurrentStateAt" | "stateDurations" | "updatedAt">,
  nowISO: string,
): { stateDurations: StateDurations; enteredCurrentStateAt: string } {
  const enteredMs = Date.parse(w.enteredCurrentStateAt ?? w.updatedAt);
  const elapsed = Math.max(0, Date.parse(nowISO) - enteredMs);
  const durations: StateDurations = { ...DEFAULT_STATE_DURATIONS, ...w.stateDurations };
  // The exiting status is always a non-terminal DWELL state (a transition only leaves a dwell
  // state; terminal done/abandoned are never the FROM-state). Guard defensively so a non-bucket
  // status is a no-op accrual, never a throw mid-CAS.
  if (Object.prototype.hasOwnProperty.call(durations, w.status)) {
    (durations as unknown as Record<string, number>)[w.status] += elapsed;
  }
  return { stateDurations: durations, enteredCurrentStateAt: nowISO };
}

/** SEAL (idea-444) — attest_evidence rejection (authority / history / relocation / ref failures). */
export class AttestationRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttestationRejected";
  }
}

/** Stable sha256 over a canonical JSON encoding (object keys sorted recursively) — the
 *  relocation-guard hash basis (requirementHash / targetRefHash / evidenceSetHash). Deterministic
 *  so verify_attestation can RECOMPUTE + compare, not trust the stored value. */
function sha256Canonical(value: unknown): string {
  const canon = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(canon);
    return Object.keys(v as Record<string, unknown>)
      .sort()
      .reduce((acc, k) => {
        acc[k] = canon((v as Record<string, unknown>)[k]);
        return acc;
      }, {} as Record<string, unknown>);
  };
  return createHash("sha256").update(JSON.stringify(canon(value))).digest("hex");
}
const hashRequirement = (req: EvidenceRequirement): string => sha256Canonical(req);
const hashTargetRef = (tr: { kind: string; id: string } | null): string => sha256Canonical(tr);
const hashEvidenceSet = (refs: AttestationEvidenceRef[]): string =>
  sha256Canonical([...refs].map((r) => `${r.kind}:${r.ref}`).sort());

/** Active verifier FAIL derivation for legacy (pre-v2-receipt) rows. */
export function hasActiveVerifierFail(item: WorkItem): boolean {
  return item.evidenceRequirements.some((req) =>
    req.evidenceAuthority === "verifier-attestation" && item.attestations?.[req.id]?.verdict === "fail");
}

/** Effective failed-sealed classification is authoritative before ANY raw phase check. */


/**
 * 🔴 bug-371's DEFECT, STATED EXACTLY: **a sealed row whose STORED phase is `ready` misrepresents
 * itself as claimable.** Nothing else does.
 *
 * Still the MIGRATION's match predicate. The transitional read-path projection that also consumed
 * it was removed in mission-141 once production was migrated — but the rule itself is unchanged,
 * and it stays defined once so the migration and any future consumer cannot drift apart.
 *
 * WHY NOT SIMPLY `isFailedGateSealed`, which is what originally shipped and was wrong: that
 * matches EVERY sealed row regardless of stored phase — a strictly larger and partly DESTRUCTIVE
 * claim. Measured against production: 24 sealed rows, not the 12 we believed, because we had
 * counted them through `list_work(status="ready")`, THE VERY FILTER bug-371 EXISTS TO FIX. Of
 * those, 8 stored `abandoned` (rewriting collapses a PERSON'S DECISION into a VERDICT) and 4
 * stored `paused` (converting reversible dormancy to terminal is a LIFECYCLE mutation). Neither
 * group is claimable and neither presents as `ready`, so neither exhibits the defect.
 *
 * The seal itself is untouched and still governs every guard: `isFailedGateSealed` remains the
 * CAPABILITY predicate and consults no phase.
 */
export function misrepresentsAsClaimable(item: WorkItem): boolean {
  return item.status === "ready" && isFailedGateSealed(item);
}

export function isFailedGateSealed(item: WorkItem): boolean {
  return item.effectiveDisposition === "failed_sealed" || item.failedGateSeal != null || hasActiveVerifierFail(item);
}

/** Exported for exact-receipt/failpoint tests: complete persisted domain row, no substrate RV. */
export function failedGateStateHash(item: WorkItem): string {
  // JSON persistence omits undefined optional properties. Normalize to that exact
  // domain before invoking foundation-v4's strict canonical hasher.
  const persistedDomain = JSON.parse(JSON.stringify(item)) as unknown;
  return hashCanonicalDomain("failed-gate-preclear-state-v2", persistedDomain);
}

/** Exact persisted pre-recall domain hash. The raw token affects the hash but is never exposed. */
export function recallStateHash(item: WorkItem): string {
  return hashCanonicalDomain("workitem-recall-before-state-v4", JSON.parse(JSON.stringify(item)) as unknown);
}

function recallTokenFingerprint(token: string): string {
  return hashCanonicalDomain("workitem-recall-token-v4", { token });
}

function failedGateOperationId(
  workId: string,
  requirementId: string,
  verifierId: string,
  verdict: AttestationVerdict,
  evidenceRefs: AttestationEvidenceRef[],
): string {
  return hashCanonicalDomain("failed-gate-operation-v2", {
    workId, requirementId, verifierId, verdict, evidenceSetHash: hashEvidenceSet(evidenceRefs),
  });
}

function tokenFingerprint(token: string | undefined): string | null {
  return token ? hashCanonicalDomain("failed-gate-token-v2", { token }) : null;
}

function legacyRevisionIdentity(item: WorkItem): { logicalId: string; revision: number; topologyGeneration: number } {
  const maybe = item as WorkItem & { logicalId?: string; revision?: number; topologyGeneration?: number };
  return {
    logicalId: maybe.logicalId ?? item.id,
    revision: maybe.revision ?? 1,
    topologyGeneration: maybe.topologyGeneration ?? 0,
  };
}

function attestationIdentity(attestation: Attestation): string {
  return `${attestation.requirementId}:${attestation.verifierId}:${attestation.producedAt}`;
}

function buildFailedGateSeal(input: {
  item: WorkItem;
  resourceVersion: string;
  attestation: Attestation;
  attestationHistoryIndex: number;
  operationId: string;
  sealedAt: string;
}): { seal: FailedGateSealV2; notice: PendingFailedSealNotice | null } {
  const { item, resourceVersion, attestation, attestationHistoryIndex, operationId, sealedAt } = input;
  const identity = legacyRevisionIdentity(item);
  const receipt: FailedGatePreClearReceiptV2 = {
    workId: item.id,
    ...identity,
    requirementId: attestation.requirementId,
    verifierId: attestation.verifierId,
    verdict: "fail",
    producedAt: attestation.producedAt,
    operationId,
    before: {
      phase: item.status,
      holder: item.lease?.holder ?? null,
      claimedAt: item.lease?.claimedAt ?? null,
      expiresAt: item.lease?.expiresAt ?? null,
      heartbeatAt: item.lease?.heartbeatAt ?? null,
      tokenFingerprint: tokenFingerprint(item.lease?.token),
      blockedOn: item.blockedOn ? structuredClone(item.blockedOn) : null,
      stateHash: failedGateStateHash(item),
      evidenceSetHash: hashCanonicalDomain("failed-gate-work-evidence-set-v2", item.evidence),
      activeAttestationProjectionHash: hashCanonicalDomain("failed-gate-active-attestation-projection-v2", item.attestations),
      resourceVersion,
    },
    after: {
      phase: "review",
      effectiveDisposition: "failed_sealed",
      leaseCleared: true,
      blockedOnCleared: true,
    },
    attestationHistoryIndex,
    attestationId: attestationIdentity(attestation),
    requirementHash: attestation.requirementHash,
    targetRefHash: attestation.targetRefHash,
    attestationEvidenceSetHash: attestation.evidenceSetHash,
    sealedAt,
  };
  const sealHash = hashCanonicalDomain("failed-gate-seal-v2", receipt);
  const holder = item.lease?.holder ?? null;
  const holderNoticeIntentId = holder
    ? hashCanonicalDomain("failed-seal-holder-notice-v2", { workId: item.id, sealHash, holder })
    : null;
  const seal: FailedGateSealV2 = { version: 2, operationId, sealHash, receipt, holderNoticeIntentId };
  const notice: PendingFailedSealNotice | null = holder && holderNoticeIntentId
    ? {
        intentId: holderNoticeIntentId,
        sealHash,
        workId: item.id,
        requirementId: attestation.requirementId,
        verifierId: attestation.verifierId,
        verdict: "fail",
        producedAt: attestation.producedAt,
        exactHolderAgentId: holder,
        createdAt: sealedAt,
        projectedMessageId: null,
        projectedAt: null,
      }
    : null;
  return { seal, notice };
}

export class FailedGateSealedRejected extends TransitionRejected {
  constructor(workId: string) {
    super(`${workId} has effectiveDisposition=failed_sealed; same-row replay/claim/attestation is forbidden — create a distinct repair/revision`);
    this.name = "FailedGateSealedRejected";
  }
}

class IdempotentFailedSeal extends Error {
  constructor(public readonly item: WorkItem) {
    super("idempotent failed-gate seal replay");
  }
}

class IdempotentRecall extends Error {
  constructor(public readonly item: WorkItem) {
    super("idempotent pause/recall replay");
  }
}

const PAUSE_OPERATION_REPLAY = Symbol("workitem.pause-operation-replay");
export function isPauseOperationReplay(item: WorkItem): boolean {
  return (item as WorkItem & { [PAUSE_OPERATION_REPLAY]?: boolean })[PAUSE_OPERATION_REPLAY] === true;
}

export class WorkItemRepositorySubstrate implements IWorkItemStore {
  private readonly currentness: WorkGraphCurrentnessFenceV4;
  private readonly revisionStorage: WorkRevisionStorageRepositoryV4;

  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly counter: SubstrateCounter,
    // idea-449 VirtualClock: every timestamp this repository writes routes through
    // the injected clock; defaults to real wall time so production is unchanged.
    private readonly clock: Clock = systemClock,
  ) {
    this.currentness = new WorkGraphCurrentnessFenceV4(substrate);
    this.revisionStorage = new WorkRevisionStorageRepositoryV4(substrate);
  }

  private async withWriterFence<T>(fn: (pin: WorkGraphPinV4) => Promise<T>): Promise<T> {
    return this.currentness.withWriterFence(fn);
  }

  private async withReadPin<T>(fn: (pin: WorkGraphPinV4) => Promise<T>): Promise<T> {
    return this.currentness.withReadPin(fn);
  }

  private observe(item: WorkItem, pin: WorkGraphPinV4): WorkItem {
    return pin.mode === "generation"
      ? { ...item, observedTopologyGeneration: pin.head.generation, observedTopologyHash: pin.head.topologyHash }
      : item;
  }

  private async getCurrentProjectionItem(locator: string): Promise<WorkItem | null> {
    const pin = this.currentness.currentPin();
    if (!pin || pin.mode === "legacy") return this.getWorkItem(locator);
    // Graph projections consume stable logical IDs. A legacy physical ID that
    // is also the family's logical ID follows the current binding here; exact
    // historical getWorkItem(physicalId) remains non-redirecting.
    const binding = pin.generation.bindings[locator]
      ?? Object.values(pin.generation.bindings).find((candidate) => candidate.physicalId === locator);
    if (!binding) return null;
    const item = await this.getWorkItem(binding.physicalId);
    if (!item) throw new WorkGraphCurrentnessRejected(
      "workgraph.currentness.integrity",
      `current physical WorkItem ${binding.physicalId} is missing for locator ${locator}`,
    );
    try { this.currentness.assertCurrent(item, pin); return this.observe(item, pin); } catch (error) {
      if (error instanceof WorkGraphCurrentnessRejected) return null;
      throw error;
    }
  }

  private async currentGenerationItems(pin: WorkGraphPinV4): Promise<WorkItem[] | null> {
    if (pin.mode === "legacy") return null;
    const items: WorkItem[] = [];
    for (const binding of Object.values(pin.generation.bindings)) {
      const row = await this.getWorkItem(binding.physicalId);
      if (!row) throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", `current physical WorkItem ${binding.physicalId} is missing`);
      this.currentness.assertCurrent(row, pin);
      items.push(this.observe(row, pin));
    }
    return items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }

  async createWorkItem(input: {
    type: WorkItemType;
    priority?: WorkItemPriority;
    roleEligibility: string[];
    dependsOn?: string[];
    completionDependsOn?: string[];
    evidenceRequirements?: EvidenceRequirement[];
    runbook?: string;
    references?: WorkItemReference[];
    leaseWindowMs?: number;
    targetRef?: { kind: string; id: string } | null;
    payload?: unknown;
    /** W1 (idea-446): create_work parity for the node-native backstop pulse. */
    nodeConfig?: NodeConfig;
    createdBy?: EntityProvenance;
  }): Promise<WorkItem> {
    const activePin = this.currentness.currentPin();
    if (!activePin) return this.withWriterFence((pin) => { this.currentness.assertCreateAllowed(pin); return this.createWorkItem(input); });
    this.currentness.assertCreateAllowed(activePin);
    const num = await this.counter.next("workItemCounter");
    const id = `work-${num}`;
    const now = this.clock.now().toISOString();
    const w: WorkItem = {
      id,
      type: input.type,
      priority: input.priority ?? "normal",
      roleEligibility: input.roleEligibility,
      dependsOn: input.dependsOn ?? [],
      completionDependsOn: input.completionDependsOn ?? [],
      evidenceRequirements: input.evidenceRequirements ?? [],
      runbook: input.runbook,
      references: input.references ?? [],
      leaseWindowMs: input.leaseWindowMs,
      targetRef: input.targetRef ?? null,
      payload: input.payload,
      ...(input.nodeConfig ? { nodeConfig: input.nodeConfig } : {}),
      status: "ready",
      lease: null,
      evidence: [],
      frictionReflections: [],
      blockedOn: null,
      leaseExpiryCount: 0,
      // work-98 (idea-384 Part A): birth-stamp the timer — entered `ready` at createdAt, zero buckets.
      enteredCurrentStateAt: now,
      stateDurations: { ...DEFAULT_STATE_DURATIONS },
      // SEAL (idea-444): birth-empty the attestation subtree + executor history.
      attestationHistory: [],
      attestations: {},
      executorHistory: [],
      failedGateSeal: null,
      pendingFailedSealNotices: [],
      failedSealNoticePending: false,
      effectiveDisposition: null,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.substrate.createOnly(KIND, w);
    if (!result.ok) {
      throw new Error(`[WorkItemRepositorySubstrate] createWorkItem: counter issued existing ID ${id}; refusing to clobber`);
    }
    console.log(`[WorkItemRepositorySubstrate] WorkItem created: ${id} (type=${input.type}, roles=[${input.roleEligibility.join(",")}])`);
    return cloneWorkItem(w);
  }


  /** work-136 (idea-419 ratified contract v1.0 / decision-11): the WorkItem
   *  mutation verb's authority + phase + CAS core. The policy layer validates
   *  graph edges (dangling/cycle) and references BEFORE calling; this method
   *  is the last word on WHO may mutate WHAT WHEN:
   *    - author (createdBy.agentId) or architect role, Hub-derived actor;
   *    - terminal items reject everything;
   *    - runbook/payload/references/roleEligibility mutate PRE-CLAIM only
   *      (status === "ready": the claimant's contract freezes at claim; a
   *      reaped item back in ready has no current claimant, so the next
   *      claimant claims the CURRENT definition);
   *    - legacy dependsOn appends only while ready; legacy completionDependsOn
   *      appends until done; paused or active-generation claimant/edge changes
   *      reject with revision_required and must use semantic revision;
   *    - empty mutations reject (a no-op call is a caller bug, not a write);
   *    - SINGLE-SHOT CAS: a stale write rejects with the current version —
   *      the caller re-reads and re-decides (the contract's concurrency rule;
   *      deliberately NOT a retry loop, because the validation the policy ran
   *      was against the row the caller saw). */
  async updateWorkItem(
    workId: string,
    actor: { agentId: string; role: string },
    mutation: {
      set?: { priority?: WorkItemPriority; targetRef?: { kind: string; id: string } | null; runbook?: string; payload?: unknown; roleEligibility?: string[] };
      appendDependsOn?: string[];
      appendCompletionDependsOn?: string[];
      appendReferences?: WorkItemReference[];
    },
  ): Promise<{ before: WorkItem; after: WorkItem }> {
    const activePin = this.currentness.currentPin();
    if (!activePin) return this.withWriterFence(() => this.updateWorkItem(workId, actor, mutation));
    const setKeys = Object.keys(mutation.set ?? {});
    const hasAppends = (mutation.appendDependsOn?.length ?? 0) + (mutation.appendCompletionDependsOn?.length ?? 0) + (mutation.appendReferences?.length ?? 0) > 0;
    if (setKeys.length === 0 && !hasAppends) {
      throw new TransitionRejected("update rejected: empty mutation (no set fields, no appends) — a no-op update is a caller bug");
    }
    const existing = await this.substrate.getWithRevision<WorkItem>(KIND, workId);
    if (!existing) throw new TransitionRejected(`update rejected: WorkItem ${workId} does not resolve`);
    const before = cloneWorkItem(existing.entity);
    this.assertNotFailedSealed(before);
    this.currentness.assertCurrent(before, activePin);
    // Authority: author or architect (the ratified model — no lease-holder writes in v1).
    if (before.createdBy?.agentId !== actor.agentId && actor.role !== "architect") {
      throw new TransitionRejected(`update rejected: ${actor.role}/${actor.agentId} is neither the item's author (${before.createdBy?.agentId}) nor an architect — the ratified authority model is author+architect`);
    }
    if (before.status === "done" || before.status === "abandoned") {
      throw new TransitionRejected(`update rejected: ${workId} is terminal (${before.status}) — terminal items reject all mutation`);
    }
    const changesClaimantAuthority = setKeys.some((key) => ["targetRef", "runbook", "payload", "roleEligibility"].includes(key))
      || (mutation.appendDependsOn?.length ?? 0) > 0
      || (mutation.appendCompletionDependsOn?.length ?? 0) > 0
      || (mutation.appendReferences?.length ?? 0) > 0;
    // Mission-140 repair2: once a topology generation is active, claimant-contract and
    // edge edits are revisions, never scalar owner amendments. Paused rows retain the
    // same freeze even in legacy/shadow mode so no alias of update_work can launder a
    // changed row through creator unpause. updateWorkItem is the common repository seam
    // behind the public tool and internal policy aliases; priority remains a scalar.
    if (changesClaimantAuthority && (activePin.mode === "generation" || before.status === "paused")) {
      throw new WorkGraphCurrentnessRejected(
        "workgraph.currentness.revision_required",
        `update rejected: ${workId} claimant contract/topology is frozen ${before.status === "paused" ? "while paused" : `by active generation ${activePin.mode === "generation" ? activePin.head.generation : "unknown"}`}; create a semantic revision`,
      );
    }
    const preClaim = before.status === "ready";
    const next: WorkItem = { ...before };
    const set = mutation.set ?? {};
    if (set.priority !== undefined) next.priority = set.priority;
    if (set.targetRef !== undefined) {
      // SEAL (idea-444) relocation guard: freeze targetRef once ANY attestation exists — a
      // relocation would launder a pass verdict onto a different deliverable. (attest_evidence +
      // verify_attestation also recompute targetRefHash; this rejects the mutation at the source.)
      if (before.attestationHistory.length > 0 && hashTargetRef(set.targetRef) !== hashTargetRef(before.targetRef)) {
        throw new TransitionRejected(`update rejected: ${workId} has attestations — targetRef is frozen (a relocation would launder the verdict onto a different target)`);
      }
      next.targetRef = set.targetRef;
    }
    if (set.runbook !== undefined) {
      if (!preClaim) throw new TransitionRejected(`update rejected: runbook is pre-claim-only (status=${before.status}) — the claimant's contract froze at claim`);
      next.runbook = set.runbook;
    }
    if (set.payload !== undefined) {
      if (!preClaim) throw new TransitionRejected(`update rejected: payload is pre-claim-only (status=${before.status})`);
      next.payload = set.payload as WorkItem["payload"];
    }
    if (set.roleEligibility !== undefined) {
      if (!preClaim) throw new TransitionRejected(`update rejected: roleEligibility is pre-claim-only (status=${before.status})`);
      next.roleEligibility = set.roleEligibility;
    }
    if (mutation.appendDependsOn?.length) {
      if (!preClaim) throw new TransitionRejected(`update rejected: dependsOn appends only while ready (status=${before.status}) — re-gating a claimed item would yank a claimant's floor`);
      next.dependsOn = [...new Set([...before.dependsOn, ...mutation.appendDependsOn])];
    }
    if (mutation.appendCompletionDependsOn?.length) {
      next.completionDependsOn = [...new Set([...before.completionDependsOn, ...mutation.appendCompletionDependsOn])];
    }
    if (mutation.appendReferences?.length) {
      if (!preClaim) throw new TransitionRejected(`update rejected: references append pre-claim only (status=${before.status})`);
      next.references = [...(before.references ?? []), ...mutation.appendReferences];
    }
    next.updatedAt = this.clock.now().toISOString();
    const result = await this.substrate.putIfMatch(KIND, next, existing.resourceVersion);
    if (!result.ok) {
      throw new TransitionRejected(`update rejected: stale write on ${workId} (the row changed under you) — re-read and re-decide`);
    }
    console.log(`[WorkItemRepositorySubstrate] update_work ${workId} by ${actor.role}/${actor.agentId}: set=[${setKeys.join(",")}] +deps=${mutation.appendDependsOn?.length ?? 0} +cdeps=${mutation.appendCompletionDependsOn?.length ?? 0} +refs=${mutation.appendReferences?.length ?? 0}`);
    return { before, after: cloneWorkItem(next) };
  }

  async createBlueprintNode(input: {
    id: string;
    blueprintRunId: string;
    type: WorkItemType;
    priority?: WorkItemPriority;
    roleEligibility: string[];
    dependsOn?: string[];
    completionDependsOn?: string[];
    evidenceRequirements?: EvidenceRequirement[];
    runbook?: string;
    references?: WorkItemReference[];
    targetRef?: { kind: string; id: string } | null;
    payload?: unknown;
    /** W1 (idea-446): born-native backstop — the activation-blueprint declares the
     *  node's pulse so a charter is node-native at birth (proof-1 anti-skip). */
    nodeConfig?: NodeConfig;
    createdBy?: EntityProvenance;
  }): Promise<{ item: WorkItem; created: boolean }> {
    const activePin = this.currentness.currentPin();
    if (!activePin) return this.withWriterFence((pin) => { this.currentness.assertCreateAllowed(pin); return this.createBlueprintNode(input); });
    this.currentness.assertCreateAllowed(activePin);
    const now = this.clock.now().toISOString();
    const w: WorkItem = {
      id: input.id,
      type: input.type,
      priority: input.priority ?? "normal",
      roleEligibility: input.roleEligibility,
      dependsOn: input.dependsOn ?? [],
      completionDependsOn: input.completionDependsOn ?? [],
      evidenceRequirements: input.evidenceRequirements ?? [],
      runbook: input.runbook,
      references: input.references ?? [],
      targetRef: input.targetRef ?? null,
      payload: input.payload,
      blueprintRunId: input.blueprintRunId,
      ...(input.nodeConfig ? { nodeConfig: input.nodeConfig } : {}),
      status: "ready",
      lease: null,
      evidence: [],
      frictionReflections: [],
      blockedOn: null,
      leaseExpiryCount: 0,
      // work-98 (idea-384 Part A): birth-stamp the timer — entered `ready` at createdAt, zero buckets.
      enteredCurrentStateAt: now,
      stateDurations: { ...DEFAULT_STATE_DURATIONS },
      // SEAL (idea-444): birth-empty the attestation subtree + executor history.
      attestationHistory: [],
      attestations: {},
      executorHistory: [],
      failedGateSeal: null,
      pendingFailedSealNotices: [],
      failedSealNoticePending: false,
      effectiveDisposition: null,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    // The DETERMINISTIC-id createOnly IS the idempotency primitive (kubectl-apply semantics):
    // a re-run of the same blueprintRunId hits the same ids → createOnly conflicts → we reuse
    // the existing node instead of double-creating. No counter, no advisory lock.
    const result = await this.substrate.createOnly(KIND, w);
    if (result.ok) {
      console.log(`[WorkItemRepositorySubstrate] blueprint node created: ${input.id} (run=${input.blueprintRunId})`);
      return { item: cloneWorkItem(w), created: true };
    }
    // conflict: "existing" — a prior invocation of this runId already minted this node.
    // Fetch + reuse it (created:false) so the expander wires the SAME id, no double-create.
    const existing = await this.getWorkItem(input.id);
    if (!existing) {
      // createOnly said "existing" yet get() is null — a delete raced in between; surface as a
      // transient fault (the expander's all-or-nothing + idempotent re-run recovers).
      throw new Error(`[WorkItemRepositorySubstrate] createBlueprintNode: createOnly conflict on ${input.id} but get() returned null (raced delete?)`);
    }
    return { item: existing, created: false };
  }

  /** work-87 (seed_blueprint): hard-delete by id (substrate.delete is idempotent — a missing
   *  id is a no-op). INTERNAL: the expander's compensating-delete of freshly-minted items on a
   *  mid-expansion infra-failure. Not MCP-exposed; only called on ids the expander just minted
   *  (status=ready, unleased, unknown to any other caller), so no claim/lease race. */
  async deleteWorkItem(workId: string): Promise<void> {
    const activePin = this.currentness.currentPin();
    if (!activePin) return this.withWriterFence(() => this.deleteWorkItem(workId));
    if (activePin.mode === "generation") {
      throw new WorkGraphCurrentnessRejected("workgraph.currentness.revision_required", `direct WorkItem deletion is disabled after topology activation; revise the generation instead`);
    }
    await this.substrate.delete(KIND, workId);
  }

  async getWorkItem(workId: string): Promise<WorkItem | null> {
    const w = await this.substrate.get<WorkItem>(KIND, workId);
    return w ? cloneWorkItem(w) : null;
  }

  /**
   * bug-370 / B-prerequisite (1) — classify an UNBOUND row and project a draft DISTINGUISHABLY.
   * Returns null when the row is not a draft, so the caller falls through to legacyProjection.
   *
   * THE DISCRIMINATOR IS POSITIVE, NOT AN ABSENCE. `topologyGeneration` names the generation a
   * row was prepared for. MEASURED, stage by stage: a genuine legacy row carries none
   * (`undefined`); a published row carries one <= the active head; a prepared-but-unactivated
   * draft carries one STRICTLY GREATER than the head, because its generation was persisted and
   * never activated. Comparing against the head is what makes this a positive test — the defect
   * being repaired came from treating a lookup MISS as "not published", and replacing that with
   * another absence-inference would repeat it one layer along.
   *
   * The draft projects `topologyHash: "draft"` and the generation it is AWAITING, so a reader can
   * tell "prepared, not published, for generation N" from "never in any generation" at a glance.
   * It is deliberately NOT hidden: hiding it would restore the old `null` and re-create the
   * original ambiguity, where absence had to be interpreted rather than read.
   */
  private async draftProjection(logicalId: string, headGeneration: number): Promise<CurrentWorkProjectionV4 | null> {
    const item = await this.getWorkItem(logicalId);
    if (!item) return null;
    const preparedFor = (item as { topologyGeneration?: number }).topologyGeneration;
    if (typeof preparedFor !== "number" || preparedFor <= headGeneration) return null;
    return {
      logicalId,
      physicalId: item.id,
      revision: item.revision ?? 1,
      generation: preparedFor,
      topologyHash: "draft",
      predecessorPhysicalId: item.predecessorPhysicalId ?? null,
      localExecutionIdentity: item.localExecutionIdentity ?? "draft",
      workItem: item,
    };
  }

  /**
   * idea-633 Part 1 — the V2 §2.1 legacy projection, extracted so the globally-legacy branch and
   * the per-row unbound fallback CANNOT DRIFT APART. Two copies of this shape would be two
   * chances for the fallback to disagree with the thing it is supposed to be a fallback to.
   * `generation: 0` and `topologyHash: "legacy"` are the projection's stated legacy contract, not
   * a stand-in for a value read from storage (storage holds null; see fence:102).
   */
  private async legacyProjection(logicalId: string): Promise<CurrentWorkProjectionV4 | null> {
    const item = await this.getWorkItem(logicalId);
    if (!item) return null;
    return {
      logicalId,
      physicalId: item.id,
      revision: item.revision ?? 1,
      generation: 0,
      topologyHash: "legacy",
      predecessorPhysicalId: item.predecessorPhysicalId ?? null,
      localExecutionIdentity: item.localExecutionIdentity ?? "legacy",
      workItem: item,
    };
  }

  async getCurrentWork(logicalId: string): Promise<CurrentWorkProjectionV4 | null> {
    if (!this.currentness.currentPin()) return this.withReadPin(() => this.getCurrentWork(logicalId));
    const pin = this.currentness.currentPin()!;
    if (pin.mode === "legacy") return this.legacyProjection(logicalId);
    // bug-370 / B-prerequisite (1): a PREPARED-BUT-UNACTIVATED draft must not masquerade as a
    // legacy row. Both are unbound, so idea-633 Part 1's fallback projected them identically —
    // `generation: 0, topologyHash: "legacy"` — and a crashed partial batch became
    // indistinguishable from a genuine legacy row. Under step B (complete shadow generation)
    // that ambiguity would cover the entire shadow population, because preparing without
    // activating IS B's normal operating mode rather than a risk it runs.
    // MEASURED discriminator, no new field required: a draft carries `topologyGeneration`
    // GREATER THAN the active head (it names the generation it was prepared for), a published
    // row carries one <= head, and a genuine legacy row carries none at all. That is a POSITIVE
    // comparison against the head, NOT an inference from absence — the thing that broke here was
    // relying on a lookup MISS to mean "not published", and this must not repeat it.
    const draft = await this.draftProjection(logicalId, pin.head.generation);
    if (draft) return draft;
    // idea-633 Part 1 — V2 §2.1 is UNCONDITIONAL about projection: "Legacy rows project
    // logicalId=physicalId, revision 1, and a deterministic v4 contract without write-on-read."
    // It does not say "while no head exists". The implementation made legacy projection
    // conditional on the GLOBAL pin (fence:102 keys only on head existence), so the FIRST head
    // to be activated would make every row absent from that generation return null here —
    // silently, since this site returns rather than throws. Measured: an unbound row went
    // RESOLVES gen=0 -> NULL the moment a partial generation was activated.
    //
    // BINDING WINS, ALWAYS. The fallback is reached ONLY when the logicalId is absent from the
    // generation, never as an alternative to a binding that exists — otherwise a revision's
    // successor could be shadowed by its own legacy predecessor, which would be silent and
    // green. Unbound is unambiguous: §2.2 a generation carries a COMPLETE bindings map (not a
    // delta) and §1 invariant 4 publishes the entire new generation, so a logicalId cannot enter
    // a generation and later be absent from one. UNBOUND <=> NEVER ENTERED.
    const binding = pin.generation.bindings[logicalId];
    if (!binding) return this.legacyProjection(logicalId);
    const item = await this.getWorkItem(binding.physicalId);
    if (!item) throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", `current binding ${logicalId} points at missing ${binding.physicalId}`);
    const current = this.currentness.assertCurrent(item, pin)!;
    return {
      logicalId,
      physicalId: binding.physicalId,
      revision: binding.revision,
      generation: pin.head.generation,
      topologyHash: pin.head.topologyHash,
      predecessorPhysicalId: item.predecessorPhysicalId ?? null,
      localExecutionIdentity: current.localExecutionIdentity,
      workItem: this.observe(item, pin),
    };
  }

  private async resolveReferenceBindings(references: Readonly<NonNullable<WorkItem["references"]>>, snapshotToken: string): Promise<BoundWorkItemReferenceV4[]> {
    const resolutions: AuthoritativeReferenceResolutionV4[] = [];
    for (const reference of references) {
      if (reference.storage === "inline") {
        resolutions.push({ storage: "inline" });
      } else if (reference.storage === "hub-doc") {
        const row = await this.substrate.getWithRevision<Record<string, unknown>>("Document", reference.ref);
        if (!row) throw new WorkGraphCurrentnessRejected("workgraph.currentness.identity_mismatch", `document ${reference.ref} does not resolve`);
        const document = decodeEnvelopeToFlat(row.entity);
        if (typeof document.content !== "string") throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", `document ${reference.ref} has no string content`);
        resolutions.push({ storage: "hub-doc", path: reference.ref, resourceVersion: row.resourceVersion, content: document.content, snapshotToken });
      } else if (reference.storage === "entity") {
        const row = await this.substrate.getWithRevision<Record<string, unknown>>(entityReferenceSchemaKind(reference.kind), reference.ref);
        if (!row) throw new WorkGraphCurrentnessRejected("workgraph.currentness.identity_mismatch", `entity ${reference.kind}/${reference.ref} does not resolve`);
        resolutions.push({ storage: "entity", kind: reference.kind, id: reference.ref, resourceVersion: row.resourceVersion, state: decodeEnvelopeToFlat(row.entity), snapshotToken });
      } else {
        // Git locators are immutable only when pinned, but deriving blobSha256
        // requires authoritative repository bytes. The Hub repository layer is
        // intentionally git-less; never accept a caller-asserted blob digest.
        throw new WorkGraphCurrentnessRejected("workgraph.currentness.revision_required", `changed git reference ${reference.ref} requires authoritative blob resolution before revise_work`);
      }
    }
    return bindWorkItemReferencesV4(references, resolutions, snapshotToken);
  }

  private async assertBoundReferencesFresh(item: WorkItem): Promise<void> {
    const references = item.references ?? [];
    const bound = item.boundReferences ?? [];
    if (references.length !== bound.length) {
      throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", `${item.id} reference binding coverage changed`);
    }
    for (let index = 0; index < references.length; index += 1) {
      const reference = references[index]!;
      const identity = bound[index]!;
      const descriptor = { kind: reference.kind, storage: reference.storage, mode: reference.mode, required: reference.required, locator: reference.ref };
      const boundDescriptor = { kind: identity.kind, storage: identity.storage, mode: identity.mode, required: identity.required, locator: identity.locator };
      if (canonicalJson(boundDescriptor) !== canonicalJson(descriptor)) throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", `${item.id} reference ${index} locator changed`);
      if (reference.storage === "inline") {
        const candidate = bindWorkItemReferencesV4([reference], [{ storage: "inline" }], "inline-currentness")[0]!;
        if (canonicalJson(candidate.contentIdentity) !== canonicalJson(identity.contentIdentity)) {
          throw new WorkGraphCurrentnessRejected("workgraph.currentness.identity_mismatch", `${item.id} inline reference ${index} changed`);
        }
      } else if (reference.storage === "hub-doc") {
        const row = await this.substrate.getWithRevision<Record<string, unknown>>("Document", reference.ref);
        if (!row) throw new WorkGraphCurrentnessRejected("workgraph.currentness.identity_mismatch", `${item.id} document ${reference.ref} vanished`);
        const document = decodeEnvelopeToFlat(row.entity);
        const content = typeof document.content === "string" ? document.content : "";
        const actual = {
          path: reference.ref,
          resourceVersion: row.resourceVersion,
          utf8Bytes: Buffer.byteLength(content, "utf8"),
          sha256: createHash("sha256").update(content, "utf8").digest("hex"),
        };
        if (canonicalJson(actual) !== canonicalJson(identity.contentIdentity)) {
          throw new WorkGraphCurrentnessRejected("workgraph.currentness.identity_mismatch", `${item.id} document ${reference.ref} moved`);
        }
      } else if (reference.storage === "entity") {
        const boundEntity = identity.contentIdentity as { kind?: string; id?: string };
        const kind = reference.kind;
        const id = reference.ref;
        if (boundEntity.kind !== kind || boundEntity.id !== id) throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", `${item.id} malformed entity binding ${kind}/${id}`);
        const row = await this.substrate.getWithRevision<Record<string, unknown>>(entityReferenceSchemaKind(kind), id);
        if (!row) throw new WorkGraphCurrentnessRejected("workgraph.currentness.identity_mismatch", `${item.id} entity ${kind}/${id} vanished`);
        const state = decodeEnvelopeToFlat(row.entity);
        const actual = { kind, id, resourceVersion: row.resourceVersion, stateHash: hashCanonicalDomain(ENTITY_STATE_HASH_VERSION, state) };
        if (canonicalJson(actual) !== canonicalJson(identity.contentIdentity)) {
          throw new WorkGraphCurrentnessRejected("workgraph.currentness.identity_mismatch", `${item.id} entity ${reference.ref} moved`);
        }
      } else if (reference.storage === "git") {
        const gitIdentity = identity.contentIdentity as { full40CommitSha?: string };
        if (!/^[0-9a-f]{40}$/i.test(gitIdentity.full40CommitSha ?? "")) {
          throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", `${item.id} git reference ${reference.ref} is not pinned`);
        }
      }
    }
  }

  private async revisionResult(
    operation: WorkGraphRevisionOperationV4,
    rootLogicalId: string,
    replay: boolean,
  ): Promise<ReviseWorkResultV4> {
    const generation = await this.revisionStorage.getGeneration(operation.generation);
    if (!generation) throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", `operation ${operation.id} generation is missing`);
    const affectedSet = [...(operation.recommitSet.length > 0 ? operation.recommitSet : operation.recommittedSet ?? [])].sort();
    const current = await Promise.all(affectedSet.map(async (logicalId) => {
      const binding = generation.bindings[logicalId]!;
      const item = await this.getWorkItem(binding.physicalId);
      if (!item?.localExecutionIdentity) throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", `successor ${binding.physicalId} has no local identity`);
      return { logicalId, physicalId: binding.physicalId, revision: binding.revision, localExecutionIdentity: item.localExecutionIdentity };
    }));
    return {
      operationId: operation.operationId,
      requestHash: operation.requestHash,
      generation: operation.generation,
      previousGeneration: operation.previousGeneration,
      topologyHash: operation.topologyHash,
      rootLogicalId,
      affectedSet,
      recommitSet: [...operation.recommitSet],
      current,
      operationReplay: replay,
    };
  }

  async reviseWork(request: ReviseWorkRequestV4, actor: { agentId: string; role: string }): Promise<ReviseWorkResultV4> {
    // The same global writer fence used by lifecycle CAS and head publication:
    // claim-vs-revise, pause-vs-revise, and two revise operations serialize from
    // first current read through the one topology-head visibility CAS.
    return withAdvisoryLock(this.substrate, LOCK_CLASS.workGraphGlobal, WORK_GRAPH_HEAD_ID, () =>
      this.reviseWorkUnderFence(request, actor));
  }

  private async reviseWorkUnderFence(request: ReviseWorkRequestV4, actor: { agentId: string; role: string }): Promise<ReviseWorkResultV4> {
    const hasWorkId = typeof request.workId === "string" && request.workId.length > 0;
    const hasLogicalId = typeof request.logicalId === "string" && request.logicalId.length > 0;
    if (hasWorkId === hasLogicalId) throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", "revise_work requires exactly one workId or logicalId");
    if (!request.operationId?.trim() || !request.reason?.trim()) throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", "revise_work requires operationId and reason");
    const hasSemanticPatch = (request.set && Object.keys(request.set).length > 0)
      || request.dependsOn !== undefined || request.completionDependsOn !== undefined || request.references !== undefined;
    if (!hasSemanticPatch) throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", "revise_work rejects an empty semantic mutation");

    const normalizedRequest = JSON.parse(JSON.stringify({ ...request, actor })) as Record<string, unknown>;
    const requestHash = hashCanonicalDomain("workgraph-revise-request-v4", normalizedRequest);
    const existingOperation = await this.revisionStorage.getOperation(request.operationId);
    if (existingOperation) {
      if (existingOperation.requestHash !== requestHash) throw new WorkRevisionStorageError("storage.operation_conflict", `operation ${request.operationId} was reused with different bytes`);
      let rootLogicalId = request.logicalId;
      if (!rootLogicalId) {
        const previous = existingOperation.previousGeneration > 0
          ? await this.revisionStorage.getGeneration(existingOperation.previousGeneration)
          : null;
        rootLogicalId = previous
          ? Object.entries(previous.bindings).find(([, binding]) => binding.physicalId === request.workId)?.[0]
          : request.workId;
      }
      if (!rootLogicalId) throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", "replayed operation root cannot be resolved");
      if (existingOperation.state === "prepared") {
        const candidate = await this.revisionStorage.getGeneration(existingOperation.generation);
        if (!candidate) throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", `prepared operation ${existingOperation.operationId} lost its generation`);
        for (const binding of Object.values(candidate.bindings)) {
          const item = await this.getWorkItem(binding.physicalId);
          if (!item) throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", `prepared successor ${binding.physicalId} vanished`);
          await this.assertBoundReferencesFresh(item);
        }
        await this.revisionStorage.activateGeneration(existingOperation.generation, existingOperation.operationId, this.clock.now().toISOString());
      }
      const refreshed = (await this.revisionStorage.getOperation(request.operationId))!;
      return this.revisionResult(refreshed, rootLogicalId, true);
    }

    const head = await this.revisionStorage.getHead();
    if (!head || head.head.generation !== request.expectedGeneration) {
      // idea-633 Part 1 — "absent" was wrong and cost two probes plus a false hypothesis. ONE
      // condition currently carries THREE names: storage holds null (fence:102), the reader
      // prints a hardcoded 0 (getCurrentWork's legacy branch), and this writer said "absent".
      // The replacement is true for the reader's 0 and honest about the internal null, so a
      // caller comparing this message against what get_current_work told them sees the same
      // number rather than two vocabularies for one state.
      const currentDesc = head ? String(head.head.generation) : "0 (legacy: no generation head)";
      throw new WorkGraphCurrentnessRejected("revision.currentness_mismatch", `expected generation ${request.expectedGeneration}; current is ${currentDesc}`);
    }
    const activeHead = head.head;
    const generation = await this.revisionStorage.getGeneration(activeHead.generation);
    if (!generation || generation.topologyHash !== activeHead.topologyHash) throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", "active generation is missing or mismatched");
    const rootBinding = hasLogicalId
      ? generation.bindings[request.logicalId!]
      : Object.values(generation.bindings).find((binding) => binding.physicalId === request.workId);
    if (!rootBinding) throw new WorkGraphCurrentnessRejected("revision.currentness_mismatch", "revision root is not current");
    const rootLogicalId = hasLogicalId
      ? request.logicalId!
      : Object.entries(generation.bindings).find(([, binding]) => binding.physicalId === request.workId)![0];

    const edges = await this.revisionStorage.loadEdgesComplete(generation.generation);
    const reverse = new Map<string, string[]>();
    for (const edge of edges) {
      const list = reverse.get(edge.targetLogicalId) ?? [];
      list.push(edge.sourceLogicalId);
      reverse.set(edge.targetLogicalId, list);
    }
    const affected = new Set<string>([rootLogicalId]);
    const queue = [rootLogicalId];
    while (queue.length > 0) {
      for (const source of reverse.get(queue.shift()!) ?? []) if (!affected.has(source)) { affected.add(source); queue.push(source); }
    }
    const affectedSet = [...affected].sort();
    const expectedAffected = request.expectedAffectedSet ? [...request.expectedAffectedSet].sort() : undefined;
    if (expectedAffected && canonicalJson(expectedAffected) !== canonicalJson(affectedSet)) {
      throw new WorkGraphCurrentnessRejected("revision.affected_set_mismatch", `affected closure changed; expected ${expectedAffected.join(",")}, got ${affectedSet.join(",")}`);
    }

    const itemsByLogical = new Map<string, WorkItem>();
    const familiesByLogical = new Map<string, WorkRevisionFamilyRowV4>();
    for (const binding of Object.values(generation.bindings)) {
      const item = await this.getWorkItem(binding.physicalId);
      const [logicalId] = Object.entries(generation.bindings).find(([, candidate]) => candidate === binding)!;
      const family = await this.revisionStorage.getFamily(logicalId);
      if (!item || !family) throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", `binding ${logicalId} has missing row/family`);
      this.currentness.assertCurrent(item, { mode: "generation", head: activeHead, generation, headResourceVersion: head.resourceVersion });
      await this.assertBoundReferencesFresh(item);
      itemsByLogical.set(logicalId, item);
      familiesByLogical.set(logicalId, family);
    }
    for (const logicalId of affectedSet) {
      const item = itemsByLogical.get(logicalId)!;
      if (item.failedGateSeal) {
        throw new WorkGraphCurrentnessRejected("revision.failed_gate_sealed", `affected ${logicalId} has an immutable failed-gate seal`);
      }
      if (!(["ready", "paused"] as string[]).includes(item.status) || item.lease || item.evidence.length > 0 || item.attestationHistory?.length) {
        throw new WorkGraphCurrentnessRejected("revision.affected_state_forbidden", `affected ${logicalId} is not quiescent and evidence-free`);
      }
    }
    const root = itemsByLogical.get(rootLogicalId)!;
    const family = familiesByLogical.get(rootLogicalId)!;
    const isArchitect = actor.role === "architect";
    const isDirector = actor.role === "director";
    const isOriginalCreator = actor.agentId === family.originalCreatedBy.agentId
      && actor.role === family.originalCreatedBy.role;
    if (!isArchitect && !isDirector && !isOriginalCreator) {
      const holderOnly = affectedSet.some((logicalId) => {
        const item = itemsByLogical.get(logicalId)!;
        return item.lease?.holder === actor.agentId || item.executorHistory.includes(actor.agentId);
      });
      // The immutable creator stamp is anchored on agentId. An actor who merely shares the
      // creator's ROLE is unrelated to the family, not a partial owner match, so classifying
      // them as family_owner_mismatch overstates the relationship. Keying on agentId alone
      // keeps same-agentId/wrong-role as family_owner_mismatch and sends every unrelated
      // agentId to actor_forbidden. Both branches still throw: the denial is unchanged and
      // no authority is widened — only the emitted CODE becomes precise.
      const creatorIdentityMismatch = actor.agentId === family.originalCreatedBy.agentId;
      const denialCode = holderOnly
        ? "revision.holder_has_no_authority"
        : creatorIdentityMismatch
          ? "revision.family_owner_mismatch"
          : "revision.actor_forbidden";
      throw new WorkGraphCurrentnessRejected(
        denialCode,
        holderOnly
          ? `lease-holder history grants no revision authority for family ${family.id}`
          : creatorIdentityMismatch
            ? `actor does not match the immutable creator stamp for family ${family.id}`
            : `actor lacks server-derived authority for family ${family.id}`,
      );
    }
    if (isOriginalCreator && !isArchitect && !isDirector && family.familyScope.kind !== "standalone") {
      throw new WorkGraphCurrentnessRejected("revision.architect_required", `creator revision is limited to standalone families; ${family.id} is ${family.familyScope.kind}/${family.familyScope.id}`);
    }
    if (isArchitect || isDirector) {
      const scopes = affectedSet.map((logicalId) => familiesByLogical.get(logicalId)!.familyScope);
      if (scopes.length > 1) {
        const missionId = scopes[0]?.kind === "mission" ? scopes[0].id : null;
        if (!missionId || scopes.some((scope) => scope.kind !== "mission" || scope.id !== missionId)) {
          throw new WorkGraphCurrentnessRejected("revision.cross_scope_forbidden", "cross-family revision requires every affected family to share one mission scope");
        }
      }
    }

    const normalizeEdges = (values: string[] | undefined, fallback: string[]): string[] => {
      if (values === undefined) return [...fallback];
      if (new Set(values).size !== values.length) throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", "revision edge list contains duplicates");
      for (const value of values) if (!generation.bindings[value]) throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", `revision edge target ${value} is not in the current generation`);
      return [...values].sort();
    };
    const nextDependsOn = normalizeEdges(request.dependsOn, root.dependsOn);
    const nextCompletionDependsOn = normalizeEdges(request.completionDependsOn, root.completionDependsOn);
    let nextReferences = root.references;
    let nextBoundReferences = root.boundReferences;
    if (request.references !== undefined) {
      nextReferences = request.references;
      if (canonicalJson(nextReferences) !== canonicalJson(root.references)) {
        nextBoundReferences = await this.resolveReferenceBindings(nextReferences, `revision:${request.operationId}`);
      }
    }
    const preview = cloneWorkItem(root);
    if (request.set) {
      if (Object.prototype.hasOwnProperty.call(request.set, "runbook")) preview.runbook = request.set.runbook;
      if (Object.prototype.hasOwnProperty.call(request.set, "payload")) preview.payload = request.set.payload;
      if (Object.prototype.hasOwnProperty.call(request.set, "targetRef")) preview.targetRef = request.set.targetRef ?? null;
      if (Object.prototype.hasOwnProperty.call(request.set, "roleEligibility")) preview.roleEligibility = [...(request.set.roleEligibility ?? [])];
      if (Object.prototype.hasOwnProperty.call(request.set, "leaseWindowMs")) preview.leaseWindowMs = request.set.leaseWindowMs ?? undefined;
      if (Object.prototype.hasOwnProperty.call(request.set, "nodeConfig")) preview.nodeConfig = request.set.nodeConfig ?? undefined;
    }
    preview.references = [...(nextReferences ?? [])];

    // D3 authority is checked over the server-derived actor, the complete affected
    // closure, and the fully normalized proposed contract before allocating even
    // one successor revision. Creator compatibility is deliberately narrow: one
    // standalone family, no topology or target change, and no authority weakening
    // or lease/pulse escalation.
    if (isOriginalCreator && !isArchitect && !isDirector) {
      if (affectedSet.length !== 1) {
        throw new WorkGraphCurrentnessRejected("revision.architect_required", "original creator cannot revise a reverse-dependent closure");
      }
      if (canonicalJson(nextDependsOn) !== canonicalJson(root.dependsOn)
          || canonicalJson(nextCompletionDependsOn) !== canonicalJson(root.completionDependsOn)) {
        throw new WorkGraphCurrentnessRejected("revision.architect_required", "original creator cannot replace topology edges");
      }
      const nextRoles = preview.roleEligibility;
      const allowedRoles = new Set([...root.roleEligibility, actor.role]);
      if (nextRoles.some((role) => !allowedRoles.has(role))) {
        throw new WorkGraphCurrentnessRejected("revision.authority_expansion_forbidden", "original creator cannot expand role eligibility");
      }
      if (canonicalJson(preview.targetRef) !== canonicalJson(root.targetRef)) {
        throw new WorkGraphCurrentnessRejected("revision.authority_expansion_forbidden", "original creator cannot change target scope");
      }
      const requiredReferenceKeys = new Set((root.references ?? [])
        .filter((reference) => reference.required)
        .map((reference) => canonicalJson({ kind: reference.kind, ref: reference.ref, storage: reference.storage, mode: reference.mode })));
      const retainedRequiredKeys = new Set((preview.references ?? [])
        .filter((reference) => reference.required)
        .map((reference) => canonicalJson({ kind: reference.kind, ref: reference.ref, storage: reference.storage, mode: reference.mode })));
      if ([...requiredReferenceKeys].some((key) => !retainedRequiredKeys.has(key))) {
        throw new WorkGraphCurrentnessRejected("revision.authority_expansion_forbidden", "original creator cannot remove or weaken a required reference");
      }
      const oldLeaseWindow = root.leaseWindowMs;
      const nextLeaseWindow = preview.leaseWindowMs;
      if ((oldLeaseWindow === undefined && nextLeaseWindow !== undefined)
          || (oldLeaseWindow !== undefined && nextLeaseWindow !== undefined && nextLeaseWindow > oldLeaseWindow)) {
        throw new WorkGraphCurrentnessRejected("revision.authority_expansion_forbidden", "original creator cannot escalate the lease window");
      }
      if (canonicalJson(preview.nodeConfig ?? null) !== canonicalJson(root.nodeConfig ?? null)) {
        throw new WorkGraphCurrentnessRejected("revision.authority_expansion_forbidden", "original creator cannot change pulse authority");
      }
    }

    const proposedTarget = preview.targetRef;
    if (family.familyScope.kind === "mission"
        && proposedTarget?.kind === "mission"
        && proposedTarget.id !== family.familyScope.id) {
      throw new WorkGraphCurrentnessRejected("revision.cross_scope_forbidden", "targetRef would cross the family's mission scope");
    }
    if (family.familyScope.kind === "standalone" && proposedTarget?.kind === "mission") {
      throw new WorkGraphCurrentnessRejected("revision.cross_scope_forbidden", "standalone family cannot expand into mission scope");
    }

    const contractView = (item: WorkItem) => ({
      type: item.type,
      roleEligibility: item.roleEligibility,
      ...(item.runbook !== undefined ? { runbook: item.runbook } : {}),
      ...(Object.prototype.hasOwnProperty.call(item, "payload") ? { payload: item.payload } : {}),
      targetRef: item.targetRef,
      evidenceRequirements: item.evidenceRequirements,
      references: item.references,
      ...(item.leaseWindowMs !== undefined ? { leaseWindowMs: item.leaseWindowMs } : {}),
      ...(item.nodeConfig !== undefined ? { nodeConfig: item.nodeConfig } : {}),
    });
    const beforeContract = deriveNodeContractV4(contractView(root), root.boundReferences ?? []).hash;
    const afterContract = deriveNodeContractV4(contractView(preview), nextBoundReferences ?? []).hash;
    if (beforeContract === afterContract
        && canonicalJson(root.dependsOn) === canonicalJson(nextDependsOn)
        && canonicalJson(root.completionDependsOn) === canonicalJson(nextCompletionDependsOn)) {
      throw new WorkGraphCurrentnessRejected("revision.currentness_mismatch", "revise_work semantic bytes are unchanged");
    }

    const revisions = new Map<string, number>();
    for (const logicalId of affectedSet) {
      const currentFamily = familiesByLogical.get(logicalId)!;
      const allocation = await this.revisionStorage.allocateNextRevision({
        logicalId,
        originPhysicalId: currentFamily.originPhysicalId,
        originalCreatedBy: currentFamily.originalCreatedBy,
        familyScope: currentFamily.familyScope,
        createdAt: currentFamily.createdAt,
      });
      familiesByLogical.set(logicalId, allocation.family);
      revisions.set(logicalId, allocation.revision);
    }
    const now = this.clock.now().toISOString();
    const successorByLogical = new Map<string, WorkItem>();
    for (const logicalId of affectedSet) {
      const old = itemsByLogical.get(logicalId)!;
      const revision = revisions.get(logicalId)!;
      const successor = cloneWorkItem(old);
      successor.id = `work-rev-${createHash("sha256").update(`${logicalId}\0${revision}`).digest("hex").slice(0, 32)}`;
      successor.revision = revision;
      successor.predecessorPhysicalId = old.id;
      successor.revisedBy = { role: actor.role, agentId: actor.agentId };
      successor.revisionReason = request.reason;
      successor.revisionGeneration = activeHead.generation + 1;
      successor.status = "paused";
      successor.lease = null;
      successor.blockedOn = null;
      successor.evidence = [];
      successor.attestations = {};
      successor.attestationHistory = [];
      successor.executorHistory = [];
      successor.frictionReflections = [];
      successor.recallHistory = [];
      successor.pendingRecallIntents = [];
      successor.recallNoticePending = false;
      successor.failedGateSeal = null;
      successor.pendingFailedSealNotices = [];
      successor.failedSealNoticePending = false;
      successor.effectiveDisposition = null;
      if (successor.nodeConfig?.pulse) {
        const pulse = successor.nodeConfig.pulse;
        successor.nodeConfig = { pulse: {
          intervalSeconds: pulse.intervalSeconds,
          message: pulse.message,
          responseShape: pulse.responseShape,
          missedThreshold: pulse.missedThreshold,
          ...(pulse.firstFireDelaySeconds !== undefined ? { firstFireDelaySeconds: pulse.firstFireDelaySeconds } : {}),
        } };
      }
      successor.enteredCurrentStateAt = now;
      successor.stateDurations = { ready: 0, claimed: 0, in_progress: 0, blocked: 0, review: 0, paused: 0 };
      successor.leaseExpiryCount = 0;
      successor.createdAt = now;
      successor.updatedAt = now;
      successor.createdBy = { role: actor.role, agentId: actor.agentId };
      successor.dependsOn = logicalId === rootLogicalId ? nextDependsOn : [...old.dependsOn];
      successor.completionDependsOn = logicalId === rootLogicalId ? nextCompletionDependsOn : [...old.completionDependsOn];
      if (logicalId === rootLogicalId) {
        if (request.set) {
          if (Object.prototype.hasOwnProperty.call(request.set, "runbook")) successor.runbook = request.set.runbook;
          if (Object.prototype.hasOwnProperty.call(request.set, "payload")) successor.payload = request.set.payload;
          if (Object.prototype.hasOwnProperty.call(request.set, "targetRef")) successor.targetRef = request.set.targetRef ?? null;
          if (Object.prototype.hasOwnProperty.call(request.set, "roleEligibility")) successor.roleEligibility = [...(request.set.roleEligibility ?? [])];
          if (Object.prototype.hasOwnProperty.call(request.set, "leaseWindowMs")) successor.leaseWindowMs = request.set.leaseWindowMs ?? undefined;
          if (Object.prototype.hasOwnProperty.call(request.set, "nodeConfig")) successor.nodeConfig = request.set.nodeConfig ?? undefined;
        }
        successor.references = [...(nextReferences ?? [])];
        successor.boundReferences = [...(nextBoundReferences ?? [])];
      }
      if (successor.nodeConfig?.pulse) {
        const pulse = successor.nodeConfig.pulse;
        successor.nodeConfig = { pulse: {
          intervalSeconds: pulse.intervalSeconds,
          message: pulse.message,
          responseShape: pulse.responseShape,
          missedThreshold: pulse.missedThreshold,
          ...(pulse.firstFireDelaySeconds !== undefined ? { firstFireDelaySeconds: pulse.firstFireDelaySeconds } : {}),
        } };
      }
      delete successor.nodeContractHashVersion;
      delete successor.nodeContractHash;
      delete successor.nodeTopologyHashVersion;
      delete successor.nodeTopologyHash;
      delete successor.localExecutionIdentity;
      delete successor.topologyGeneration;
      delete successor.observedTopologyGeneration;
      delete successor.observedTopologyHash;
      successorByLogical.set(logicalId, successor);
    }

    const candidateItems = Object.keys(generation.bindings).sort().map((logicalId) => successorByLogical.get(logicalId) ?? itemsByLogical.get(logicalId)!);
    const boundReferencesByPhysicalId: Record<string, readonly BoundWorkItemReferenceV4[]> = {};
    const familyScopesByPhysicalId: Record<string, { kind: "mission" | "standalone"; id: string }> = {};
    for (const item of candidateItems) {
      boundReferencesByPhysicalId[item.id] = item.boundReferences ?? [];
      const logicalId = item.logicalId ?? item.id;
      familyScopesByPhysicalId[item.id] = familiesByLogical.get(logicalId)!.familyScope;
    }
    const prepared = buildWorkRevisionStorageV4({
      operationId: request.operationId,
      requestHash,
      previousGeneration: activeHead.generation,
      generation: activeHead.generation + 1,
      createdAt: now,
      workItems: candidateItems,
      existingFamiliesByLogicalId: Object.fromEntries(familiesByLogical),
      boundReferencesByPhysicalId,
      familyScopesByPhysicalId,
      recommitSet: affectedSet,
    });
    // Materialize every new physical successor atomically BEFORE publishing
    // the prepared operation lookup. A crash before the lookup leaves harmless
    // unreachable drafts; a visible prepared operation is always recoverable.
    await this.revisionStorage.persistProjectedWorkItems(prepared);
    await this.revisionStorage.persistPrepared(prepared);
    // Re-resolve every mutable binding immediately before the one visibility CAS.
    for (const item of candidateItems) await this.assertBoundReferencesFresh(item);
    await this.revisionStorage.activateGeneration(prepared.generation.generation, request.operationId, now);
    const committed = (await this.revisionStorage.getOperation(request.operationId))!;
    return this.revisionResult(committed, rootLogicalId, false);
  }

  /** Compose event/watchdog/PR integrations under one immutable topology observation. */
  async withTopologyReadPin<T>(fn: () => Promise<T>): Promise<T> {
    return this.withReadPin(() => fn());
  }

  /**
   * work-88 (arc-node): the k/N COMPLETION-gate progress over a node's DIRECT
   * completionDependsOn children. `done` = children at phase=done; `pending` = the
   * not-yet-done ids; a VANISHED or non-`done` (incl. abandoned) child counts pending
   * (fail-CLOSED — the same posture the gate enforces). Per-child point-gets: the
   * envelope-safe canonical read (an id-`$in` batch over the JSONB `data->>'id'` path is
   * unverified on envelope rows — cal #90 silent-miss risk — so deferred as a perf
   * follow-up; the direct-children fan-out is small). ONE source of truth — the
   * complete_work gate AND the get_work projection both call this.
   */
  private async computeCompletionProgress(completionDependsOn: string[]): Promise<{ done: number; total: number; pending: string[] }> {
    const pending: string[] = [];
    for (const childId of completionDependsOn) {
      const child = await this.getCurrentProjectionItem(childId);
      if (!child || child.status !== "done") pending.push(childId);
    }
    return { done: completionDependsOn.length - pending.length, total: completionDependsOn.length, pending };
  }

  /** The opt-in get_work projection (FR — feeds the cold-start get_current_stint). Reads
   *  the arc fresh, then projects its completion-gate progress. null if the arc is gone. */
  async getCompletionProgress(workId: string): Promise<{ done: number; total: number; pending: string[] } | null> {
    if (!this.currentness.currentPin()) return this.withReadPin(() => this.getCompletionProgress(workId));
    const w = await this.getCurrentProjectionItem(workId);
    if (!w) return null;
    return this.computeCompletionProgress(w.completionDependsOn);
  }

  /**
   * work-94 (cold-start spine, get_current_stint): the "where are we" projection over an
   * arc-node's DIRECT completionDependsOn subtree. Per-child point-gets (the same envelope-safe
   * read computeCompletionProgress uses; a vanished child surfaces as `missing`, never hidden),
   * rolled up into k/N + status-counts + in-flight/blocked + the gate-open flag. DIRECT children
   * only (F-B; whole-subtree recursion is a follow-on). Works for ANY arc-node. null if the arc
   * id does not exist.
   */
  /** W2 (idea-451 / work-182): the graph-projected NEXT ACTION for an arc-node — the
   *  highest-priority READY completionDependsOn child.
   *
   *  CHILD-LOCAL claimability (steve #546): the candidates are computed by evaluating THIS
   *  arc's completionDependsOn children DIRECTLY against the claim predicate (per-child
   *  point-get → ready-status + roleEligibility + start-gate/dependency-readiness), NOT by
   *  intersecting the arc's children with a capped GLOBAL ready-scan. The prior assembly
   *  (`children ∩ listReadyForRole(role, 500)`) silently dropped an arc child ranked beyond
   *  the 500-row global window — projection-empty while raw scope held a ready child, the
   *  exact dark-miss the W3 reconciler seam forbids. Child-local, the scan is bounded by the
   *  arc's OWN fan-out, so `readyCandidates` is the true RAW claimable scope, never capped.
   *
   *  Priority-ordered (critical<high<normal<low) with a deterministic id tiebreak →
   *  scope-inversion is unrepresentable. blocked/paused/done/claimed children are excluded by
   *  the ready-status check. The agent-scoped WIP-cap short-circuits FIRST (a maxed caller can
   *  claim nothing → non-dark `wip_capped`); quarantine is the policy layer's caller gate. */
  async getNextAction(arcId: string, role?: string, agentId?: string): Promise<NextActionProjection | null> {
    if (!this.currentness.currentPin()) return this.withReadPin(() => this.getNextAction(arcId, role, agentId));
    const arc = await this.getCurrentProjectionItem(arcId);
    if (!arc) return null;
    const pin = this.currentness.currentPin()!;
    const observation = pin.mode === "generation" ? { observedTopologyGeneration: pin.head.generation, observedTopologyHash: pin.head.topologyHash } : {};
    const childIds = arc.completionDependsOn ?? [];
    const hasChildren = childIds.length > 0;
    // Agent-scoped WIP-cap: a maxed caller can claim NOTHING — mirror listReadyForRole's
    // short-circuit so a caller-scoped projection never over-reports a nextAction claim_work
    // would reject. Non-dark (wip_capped). The role-only projection (agentId omitted, W3's
    // path) skips this — it reports the arc's raw claimable scope regardless of any caller.
    if (agentId !== undefined) {
      const cap = wipCap(role);
      if ((await this.inFlightCount(agentId, cap)) >= cap) {
        return { arcId, ...observation, nextAction: null, readyCandidates: 0, hasChildren, emptyReason: "wip_capped" };
      }
    }
    // Per-child point-get + claim predicate. Mirrors claimWorkItem's authority checks:
    // ready phase, roleEligibility (empty = any-role, OR'd in), dependency-readiness
    // (dependsOn all done). A vanished child is simply not claimable (skipped, never hidden).
    const readyChildren: WorkItem[] = [];
    for (const childId of childIds) {
      const child = await this.getCurrentProjectionItem(childId);
      if (!child || isFailedGateSealed(child) || child.status !== "ready") continue;
      if (role && child.roleEligibility.length > 0 && !child.roleEligibility.includes(role)) continue;
      if (child.dependsOn.length > 0 && (await this.unmetDependencies(child.dependsOn)).length > 0) continue;
      readyChildren.push(child);
    }
    const RANK: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
    readyChildren.sort((a, b) => {
      const pr = (RANK[a.priority] ?? 9) - (RANK[b.priority] ?? 9);
      return pr !== 0 ? pr : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return { arcId, ...observation, nextAction: readyChildren[0] ?? null, readyCandidates: readyChildren.length, hasChildren };
  }

  async getStintProjection(workId: string): Promise<StintProjection | null> {
    if (!this.currentness.currentPin()) return this.withReadPin(() => this.getStintProjection(workId));
    const arc = await this.getCurrentProjectionItem(workId);
    if (!arc) return null;
    const pin = this.currentness.currentPin()!;
    const observation = pin.mode === "generation" ? { observedTopologyGeneration: pin.head.generation, observedTopologyHash: pin.head.topologyHash } : {};
    const children: StintChild[] = [];
    for (const childId of arc.completionDependsOn) {
      const child = await this.getCurrentProjectionItem(childId);
      if (!child) {
        children.push({ id: childId, status: "missing", leaseHolder: null, stateDurations: { ...DEFAULT_STATE_DURATIONS } });
      } else {
        children.push({ id: childId, status: child.status, leaseHolder: child.lease?.holder ?? null, stateDurations: child.stateDurations });
      }
    }
    const countOf = (s: string) => children.filter((c) => c.status === s).length;
    const total = children.length;
    const done = countOf("done");
    const statusCounts: Record<string, number> = {
      ready: countOf("ready"), claimed: countOf("claimed"), in_progress: countOf("in_progress"),
      blocked: countOf("blocked"), paused: countOf("paused"), review: countOf("review"), done, abandoned: countOf("abandoned"),
      missing: countOf("missing"),
    };
    // work-99 (idea-384 Part B): the recursive SUBTREE rollup (leaves-only, DAG-deduped) + the
    // arc's OWN active span + the parallelism factor. ownActiveMs EXCLUDES ready (queue-wait) so
    // parallelism measures concurrency vs the ACTIVE span, not vs total-elapsed; null when there
    // is no active span (no div-by-zero — honest null).
    const rolledUpDurations = await this.rollupLeafDurations(arc.id);
    const friction = await this.rollupLeafFriction(arc.id);
    const ownActiveMs = arc.stateDurations.claimed + arc.stateDurations.in_progress + arc.stateDurations.blocked + arc.stateDurations.review;
    const parallelism = ownActiveMs > 0 ? rolledUpDurations.in_progress / ownActiveMs : null;
    return {
      arcId: arc.id,
      ...observation,
      arcStatus: arc.status,
      // pending = NOT done. This k/N is PARALLEL-COMPUTED from the per-child read above (NOT a
      // call to computeCompletionProgress) — it is PARITY-ASSERTED against the gate by a test
      // (getStintProjection.completion deepEquals getCompletionProgress), which reds if the two
      // parallel definitions ever drift (work-94 sub-3; the agreement-pin calibration).
      completion: { done, total, pending: children.filter((c) => c.status !== "done").map((c) => c.id) },
      // tracks the ARC completion-gate (children>0): would complete_work pass it. A LEAF (children=0)
      // has NO completion-gate — it completes freely — so gateOpen:false there means "no arc-gate",
      // NOT "blocked". gateOpen:true ⇒ a completable arc whose subtree is finalised (one-enforced-close).
      gateOpen: total > 0 && done === total,
      inFlight: statusCounts.claimed + statusCounts.in_progress + statusCounts.review,
      blocked: statusCounts.blocked,
      statusCounts,
      children,
      rolledUpDurations,
      ownActiveMs,
      parallelism,
      friction,
    };
  }

  /**
   * A10 primitive-1: app-side recursive rollup of leaf friction reflections. Mirrors
   * rollupLeafDurations: leaves-only + DAG-deduped, so an arc's friction denominator matches
   * the work that actually completed under the subtree and never double-counts shared leaves.
   */
  private async rollupLeafFriction(arcId: string): Promise<FrictionRollup> {
    const acc = emptyFrictionRollup();
    const visited = new Set<string>();
    const walk = async (id: string): Promise<void> => {
      if (visited.has(id)) return;
      visited.add(id);
      const flat = await this.getCurrentProjectionItem(id);
      if (!flat) return;
      if (flat.completionDependsOn.length === 0) {
        addFrictionToRollup(acc, flat.frictionReflections);
      } else {
        for (const childId of flat.completionDependsOn) await walk(childId);
      }
    };
    await walk(arcId);
    return acc;
  }

  /**
   * work-99 (idea-384 Part B): app-side recursive rollup of the completionDependsOn SUBTREE's
   * per-state timers, summed over the UNIQUE reachable LEAVES (empty completionDependsOn).
   * Option-B app-side walk (NOT a raw CTE — the substrate exposes no raw-query seam, and a raw
   * CTE reading status.stateDurations/spec.completionDependsOn from JSONB would bypass the
   * envelope decode-to-flat membrane = the bug-137/138 class; cal #85 — idea-384's prose said
   * WITH RECURSIVE but ground-truth has no such seam). Envelope-SAFE via cloneWorkItem. The
   * memoized visited-set gives DAG-dedup (a leaf shared across parents counted ONCE) AND
   * termination (work-87's whole-graph acyclic guarantee + the visited guard). LEAVES-ONLY
   * BY CONSTRUCTION: an intermediate recurses into its children and NEVER adds its own span;
   * only a leaf contributes its ownStateDurations. A vanished node is skipped (never mis-summed).
   * On-read, bounded by the subtree size (a stint ~6 children) — the getStintProjection
   * parallel-computed discipline (not a maintained rollup → no write-amp/drift).
   */
  private async rollupLeafDurations(arcId: string): Promise<StateDurations> {
    const acc: StateDurations = { ...DEFAULT_STATE_DURATIONS };
    const keys = Object.keys(DEFAULT_STATE_DURATIONS) as (keyof StateDurations)[];
    const visited = new Set<string>();
    const walk = async (id: string): Promise<void> => {
      if (visited.has(id)) return; // DAG-dedup + cycle-guard (an already-summed node is idempotent)
      visited.add(id);
      const flat = await this.getCurrentProjectionItem(id);
      if (!flat) return; // vanished/old/draft — skip; never silently mis-attribute
      if (flat.completionDependsOn.length === 0) {
        for (const k of keys) acc[k] += flat.stateDurations[k]; // LEAF — contribute its own span
      } else {
        for (const childId of flat.completionDependsOn) await walk(childId); // intermediate — recurse; own span NOT added
      }
    };
    await walk(arcId);
    return acc;
  }

  /**
   * work-94 (cold-start spine): the legal FSM transition verbs for the caller given the item's
   * state/lease/gates — the "what can I do from here" surface. Each verb carries legal + (when
   * illegal) a NON-DARK reason. Caller-aware: the lease-bound verbs (start/block/resume/complete/
   * release/abandon/renew) require the caller to be the holder (abandon also allows the creator).
   * Gate-aware: complete on a COMPLETABLE arc is legal only when the completion-gate is met (all
   * completionDependsOn children done); a leaf has no gate (gateMet=true). The phase/holder/gate
   * predicates MIRROR the repo's own transition guards (single source of truth — the same
   * COMPLETABLE/RELEASABLE/LEASE_HELD phase sets the verbs enforce). null if the id is absent.
   */
  async getLegalMoves(workId: string, caller: { agentId: string; role?: string }): Promise<LegalMoves | null> {
    if (!this.currentness.currentPin()) return this.withReadPin(() => this.getLegalMoves(workId, caller));
    const w = await this.getWorkItem(workId);
    if (!w) return null;
    const status = w.status;
    const isHolder = !!w.lease && w.lease.holder === caller.agentId;
    const pin = this.currentness.currentPin()!;
    const observation = pin.mode === "generation" ? { observedTopologyGeneration: pin.head.generation, observedTopologyHash: pin.head.topologyHash } : {};
    if (pin.mode === "generation") {
      try { this.currentness.assertCurrent(w, pin); } catch (error) {
        if (!(error instanceof WorkGraphCurrentnessRejected)) throw error;
        const current = error.current
          ? `; current=${error.current.physicalId}@${error.current.revision} generation=${error.current.generation}`
          : `; no current binding in generation ${pin.head.generation}`;
        const reason = `${error.code}: exact physical ${workId} is historical/draft and cannot mutate${current}`;
        const verbs: WorkItemVerb[] = ["claim", "start", "block", "resume", "renew", "release", "abandon", "complete", "pause", "unpause"];
        return { workId: w.id, ...observation, status, isHolder, gateMet: false, moves: verbs.map((verb) => ({ verb, legal: false, reason })) };
      }
    }
    if (isFailedGateSealed(w)) {
      const reason = "effectiveDisposition=failed_sealed; no same-row lifecycle verb is legal — create a distinct repair/revision";
      const verbs: WorkItemVerb[] = ["claim", "start", "block", "resume", "renew", "release", "abandon", "complete", "pause", "unpause"];
      return { workId: w.id, ...observation, status, isHolder, gateMet: false, moves: verbs.map((verb) => ({ verb, legal: false, reason })) };
    }
    const isCreator = w.createdBy?.agentId === caller.agentId;
    const notHolder = "the caller is not the lease-holder";

    // Gate-aware complete: a COMPLETABLE arc needs all completionDependsOn children done; a leaf
    // (no children) has no completion-gate → gateMet true (the same predicate the gate enforces).
    let gateMet = true;
    if (COMPLETABLE_PHASES.includes(status) && w.completionDependsOn.length > 0) {
      gateMet = (await this.computeCompletionProgress(w.completionDependsOn)).pending.length === 0;
    }

    const moves: LegalMove[] = [];
    const add = (verb: WorkItemVerb, legal: boolean, reason?: string) =>
      moves.push(legal ? { verb, legal } : { verb, legal, reason: reason ?? "" });

    // claim: ready + role-eligible + dependency-met + NOT at the per-agent WIP cap. work-96:
    // the WIP-cap is now MODELED (legal_moves has the caller agentId, so an inFlightCount keeps
    // claim.legal from being optimistic for a maxed caller — the same predicate claimWorkItem
    // enforces under the advisory lock). DISCLOSED residual: QUARANTINE is the ONE claim gate
    // legal_moves does NOT reflect — it lives in the policy-layer engineerRegistry the repo store
    // cannot see; a quarantined caller would see claim.legal=true but claim_work rejects. Low
    // blast: quarantine is a rare admin-set state + the policy's list_ready_work(scopeToCaller)
    // discovery path already excludes a quarantined caller, so legal_moves is rarely reached for a
    // claimable item by one (a future policy-layer overlay could fold quarantine in).
    if (status !== "ready") {
      add("claim", false, `claim requires ready, was ${status}`);
    } else {
      const roleOk = w.roleEligibility.length === 0 || (!!caller.role && w.roleEligibility.includes(caller.role));
      if (!roleOk) {
        add("claim", false, `role ${caller.role ?? "(none)"} is not in roleEligibility [${w.roleEligibility.join(", ")}]`);
      } else {
        const unmet = await this.unmetDependencies(w.dependsOn);
        if (unmet.length > 0) {
          add("claim", false, `dependencies not done: ${unmet.join(", ")}`);
        } else {
          const cap = wipCap(caller.role);
          if ((await this.inFlightCount(caller.agentId, cap)) >= cap) {
            add("claim", false, `you hold the maximum in-flight items (WIP cap ${cap}) — complete_work or release_work on one to free a claim slot`);
          } else {
            add("claim", true);
          }
        }
      }
    }

    // lease-bound verbs (holder-gated; phase sets mirror the verb guards).
    add("start", isHolder && status === "claimed", !isHolder ? notHolder : `start requires claimed, was ${status}`);
    add("block", isHolder && status === "in_progress", !isHolder ? notHolder : `block requires in_progress, was ${status}`);
    add("resume", isHolder && status === "blocked", !isHolder ? notHolder : `resume requires blocked, was ${status}`);
    // renew. DISCLOSED divergence (work-96): legal_moves reports renew.legal=true for a holder in
    // a lease-held phase even when the lease has ALREADY EXPIRED (expiresAt < now) but not yet been
    // swept — whereas renewLease throws on an already-expired lease (audit-4103, it's the sweeper's
    // to re-queue). A narrow race (the window between expiry and the sweeper tick); legal_moves
    // intentionally does NOT do the time-comparison here (it would couple the affordance to a clock
    // read), so a cold agent may try renew and get the "already expired" reject. Acceptable + now disclosed.
    add("renew", isHolder && LEASE_HELD_PHASES.includes(status), !isHolder ? notHolder : `renew requires a held lease, was ${status}`);
    add("release", isHolder && RELEASABLE_PHASES.includes(status), !isHolder ? notHolder : `release requires an active claim, was ${status}`);
    // abandon: the holder OR the creator (override authority), from a RELEASABLE phase; the
    // CREATOR alone also from `ready` (bug-219 fix (c) — mirrors the abandonWork guard).
    add("abandon", (isHolder || isCreator) && (RELEASABLE_PHASES.includes(status) || (status === "ready" && isCreator)),
      !(isHolder || isCreator) ? "the caller is neither the lease-holder nor the creator" : `abandon requires an active claim (or the creator from ready), was ${status}`);
    // complete: holder + COMPLETABLE + the completion-gate met.
    add("complete", isHolder && COMPLETABLE_PHASES.includes(status) && gateMet,
      !isHolder ? notHolder : !COMPLETABLE_PHASES.includes(status) ? `complete requires in_progress or review, was ${status}` : "completion-gate unmet — downstream completionDependsOn children are not all done");
    // Mission-140 pause/recall authority. Resolve immutable family creator rather than
    // trusting successor createdBy/revisedBy; holder status alone grants neither verb.
    const isOriginalCreator = await this.originalCreatorAgentId(w) === caller.agentId;
    const isSteward = caller.role === "architect" || caller.role === "director";
    const pausePhase = ["ready", "claimed", "in_progress", "blocked"].includes(status);
    const canPause = status === "ready" ? (isOriginalCreator || isSteward) : isSteward;
    add("pause", canPause && pausePhase,
      !canPause ? "pause requires original creator/architect/Director at ready or architect/Director for active recall" : `pause requires ready|claimed|in_progress|blocked, was ${status}`);
    const lastRecall = (w.recallHistory ?? []).at(-1);
    const canCreatorUnpause = isOriginalCreator && !w.predecessorPhysicalId && lastRecall?.actor.agentId === caller.agentId;
    const canUnpause = isSteward || canCreatorUnpause;
    add("unpause", canUnpause && status === "paused",
      !canUnpause ? "unpause requires the original creator who paused this unchanged row, architect, or Director" : `unpause requires paused, was ${status}`);

    return { workId: w.id, ...observation, status, isHolder, gateMet, moves };
  }

  // work-86 (idea-380): generic substrate existence check for a storage=entity reference.
  // `kind` is the SchemaDef kind (the policy normalizes the semantic ref-kind first). The
  // store holds the substrate handle; the policy layer has no raw substrate access. This
  // generalizes the WorkItem-only dangling-dependsOn existence check.
  async entityExists(kind: string, id: string): Promise<boolean> {
    return (await this.substrate.get(kind, id)) !== null;
  }

  /**
   * List work-items, optionally filtered by phase, role-eligibility, and/or current
   * lease-holder. The role filter is `$contains` array-membership over
   * spec.roleEligibility (the C1-R2 operator + GIN index); the holder filter is
   * equality on the indexed envelope path `status.lease.holder` (the same path +
   * GIN index inFlightCount/listExpiredLeaseItems use). Filter built inline (local
   * var) with literal keys so the C3-R4 call-site scanner resolves them directly —
   * no helper/spread → no dynamic-site annotation.
   *
   * This is BOTH the storage read the list_ready_work projection sits on AND the
   * backing read for the list_work org-state-snapshot verb (stint-4 R1, idea-357-pt3):
   * it returns FLAT items (lease decoded by cloneWorkItem = the first-class lease
   * column) UNFILTERED by claim-readiness — list_work is the observability surface
   * (shows ALL matching items incl. dependency-blocked); the deps/WIP readiness gate
   * is list_ready_work's job only. truncation-HONEST (tele-4): `truncated` flags a
   * scan that hit LIST_CAP — the repo owns LIST_CAP so the honesty signal is sourced
   * here, never inferred at the policy layer from a coincidental length==cap.
   */
  async listWorkItems(filter?: { status?: WorkItemPhase; role?: string; holder?: string }): Promise<{ items: WorkItem[]; truncated: boolean }> {
    if (!this.currentness.currentPin()) return this.withReadPin(() => this.listWorkItems(filter));
    const current = await this.currentGenerationItems(this.currentness.currentPin()!);
    if (current) {
      const matched = current.filter((item) =>
        (!filter?.status || item.status === filter.status) &&
        (!filter?.role || item.roleEligibility.includes(filter.role)) &&
        (!filter?.holder || item.lease?.holder === filter.holder));
      return { items: matched.slice(0, LIST_CAP), truncated: matched.length > LIST_CAP };
    }
    const substrateFilter: Filter = {};
    if (filter?.status) substrateFilter.status = filter.status;
    if (filter?.role) substrateFilter.roleEligibility = { $contains: filter.role };
    if (filter?.holder) substrateFilter["status.lease.holder"] = filter.holder;
    const { items } = await this.substrate.list<WorkItem>(KIND, {
      filter: Object.keys(substrateFilter).length > 0 ? substrateFilter : undefined,
      limit: LIST_CAP,
    });
    return { items: items.map(cloneWorkItem), truncated: items.length >= LIST_CAP };
  }

  /**
   * Narrow payload-key lookup for PR-review binding authority rows. The substrate stores
   * WorkItem intent under spec.payload, so these filters bind explicit spec.payload.*
   * paths rather than relying on a capped unfiltered scan.
   */
  async listPrReviewBindingWorkItems(repo: string, prNumber: number): Promise<{ items: WorkItem[]; truncated: boolean }> {
    if (!this.currentness.currentPin()) return this.withReadPin(() => this.listPrReviewBindingWorkItems(repo, prNumber));
    const current = await this.currentGenerationItems(this.currentness.currentPin()!);
    if (current) {
      const matched = current.filter((item) => {
        const payload = item.payload as Record<string, unknown> | undefined;
        return payload?.obligationKind === "github_pr_workgraph_binding" && payload.repo === repo && payload.prNumber === prNumber;
      });
      return { items: matched.slice(0, LIST_CAP), truncated: matched.length > LIST_CAP };
    }
    const { items } = await this.substrate.list<WorkItem>(KIND, {
      filter: {
        "spec.payload.obligationKind": "github_pr_workgraph_binding",
        "spec.payload.repo": repo,
        "spec.payload.prNumber": prNumber,
      },
      limit: LIST_CAP,
    });
    return { items: items.map(cloneWorkItem), truncated: items.length >= LIST_CAP };
  }

  /** Narrow payload-key lookup for existing PR-review projections. */
  async listWorkItemsByProjectionKey(projectionKey: string): Promise<{ items: WorkItem[]; truncated: boolean }> {
    if (!this.currentness.currentPin()) return this.withReadPin(() => this.listWorkItemsByProjectionKey(projectionKey));
    const current = await this.currentGenerationItems(this.currentness.currentPin()!);
    if (current) {
      const matched = current.filter((item) => (item.payload as Record<string, unknown> | undefined)?.projectionKey === projectionKey);
      return { items: matched.slice(0, LIST_CAP), truncated: matched.length > LIST_CAP };
    }
    const { items } = await this.substrate.list<WorkItem>(KIND, {
      filter: { "spec.payload.projectionKey": projectionKey },
      limit: LIST_CAP,
    });
    return { items: items.map(cloneWorkItem), truncated: items.length >= LIST_CAP };
  }

  /**
   * The list_ready_work projection (sub-PR-3b): ready items a `role` may claim, with
   * the empty-role OR-in (audit-4085 — an empty roleEligibility = any-role, claimable,
   * therefore listable for EVERY role). The substrate can't express "$contains role OR
   * roleEligibility is empty" ($or forbidden + no is-empty operator), so the OR-in is
   * applied in-memory over the ready scan. TRUNCATION-HONEST (audit-4070 #3): if the
   * scan hits READY_SCAN_CAP, `truncated` is set — NEVER a silent cap (the caller must
   * refine by role, or read it as a backlog-pressure signal; tele-4).
   *
   * NOTE (follow-on): the in-memory OR-in scans up to the cap before role-filtering, so a
   * very large ready backlog (>cap) can hide eligible items beyond the scan — `truncated`
   * surfaces that. A complete server-side role projection (a role-index or an is-empty
   * operator) is a later optimization; the loud flag keeps v1 honest.
   */
  async listReadyForRole(role: string | undefined, limit: number, agentId?: string): Promise<{ items: WorkItem[]; truncated: boolean; emptyReason?: ReadyEmptyReason }> {
    if (!this.currentness.currentPin()) return this.withReadPin(() => this.listReadyForRole(role, limit, agentId));
    // idea-353 WI-2.1 (AC5 strict parity / audit-4265): the AGENT-SCOPED projection
    // (agentId supplied — used by the claimable digest) must count only what THIS
    // caller can actually claim, so it mirrors claim_work's per-agent WIP-cap. A
    // maxed caller can claim NOTHING → short-circuit to empty (count 0) BEFORE the
    // scan, so count == claim_work's full predicate. (Quarantine is the policy
    // layer's parity gate, where claim_work checks it too.) The non-agent-scoped
    // path (agentId omitted) is unchanged — the stable role view + D-1 R1 no-touch seam.
    if (agentId !== undefined) {
      const cap = wipCap(role);
      if ((await this.inFlightCount(agentId, cap)) >= cap) {
        // work-94 (cold-start spine, non-dark digest): an empty digest is never DARK — the
        // caller is maxed, so tell them WHY (free a slot), not a silent zero.
        return { items: [], truncated: false, emptyReason: "wip_capped" };
      }
    }
    const current = await this.currentGenerationItems(this.currentness.currentPin()!);
    const listed = current
      ? current.filter((item) => item.status === "ready")
      : (await this.substrate.list<WorkItem>(KIND, { filter: { status: "ready" }, limit: READY_SCAN_CAP })).items.map(cloneWorkItem);
    const truncated = !current && listed.length >= READY_SCAN_CAP;
    const ready = listed;
    const nonFailed = ready.filter((w) => !isFailedGateSealed(w));
    const eligible = role
      ? nonFailed.filter((w) => w.roleEligibility.length === 0 || w.roleEligibility.includes(role))
      : nonFailed;
    // bug-181 (idea-353 fold): the `ready` phase + role-eligibility alone is NOT
    // claimability. claimWorkItem is the AUTHORITY and re-checks dependency-readiness
    // fail-CLOSED (lines ~392-401): an item whose dependsOn are not all `done` rejects
    // at claim. The projection MUST apply the SAME deps gate or it LIES — an
    // eligible-role item with unmet deps lists as `ready`, then a claim hits
    // ClaimRejected (the bug-181 eligible-role-deps-unmet leak; manufactures the exact
    // silent-friction idea-353 exists to kill, tele-7). Single source of truth = the
    // unmetDependencies check claimWorkItem uses. Async per-item (mirrors the in-memory
    // OR-in cost note above); only items WITH deps pay the resolve, and we stop once
    // `limit` claimable items are collected so the scan cost stays bounded.
    const claimable: WorkItem[] = [];
    const cap = Math.max(0, limit);
    for (const w of eligible) {
      if (claimable.length >= cap) break;
      if (w.dependsOn.length === 0 || (await this.unmetDependencies(w.dependsOn)).length === 0) {
        claimable.push(w);
      }
    }
    // work-94 (non-dark digest): an empty scan is NOT dark — distinguish "nothing claimable
    // for your role right now" from the wip_capped short-circuit above. (A finer split —
    // ready-but-deps-unmet vs none-ready-at-all — is a deferred refinement.)
    return { items: claimable, truncated, emptyReason: readyScanEmptyReason(claimable.length) };
  }

  // ── Claim / lease / FSM verbs (C1-R2 sub-PR-3a) ───────────────────────────

  /**
   * ready → claimed. The WIP cap is a HARD integrity invariant, not a TOCTOU
   * soft-cap: the in-flight count AND the ready→claimed CAS both run INSIDE a
   * per-agent advisory lock (keyed on agentId), so an agent cannot race ITSELF
   * past the cap. Two DIFFERENT agents racing the same item are arbitrated by the
   * per-row CAS (putIfMatch) — the loser re-reads status=claimed → TransitionRejected.
   * Lock-acquire timeout REJECTS the claim (fail-CLOSED), never proceeds unlocked.
   */
  async claimWorkItem(workId: string, agentId: string, role?: string): Promise<WorkItem | null> {
    if (!this.currentness.currentPin()) return this.withWriterFence(() => this.claimWorkItem(workId, agentId, role));
    return withAdvisoryLock(
      this.substrate,
      LOCK_CLASS.workItemWip,
      agentId,
      async () => {
        const cap = wipCap(role);
        // Count this agent's in-flight items under the lock (single-sourced via
        // inFlightCount, shared with the agent-scoped listReadyForRole projection so
        // the claimable digest's count == this exact WIP-cap predicate — idea-353
        // WI-2.1 / audit-4265). limit=cap suffices to detect >=cap (boundary, not total).
        const inFlight = await this.inFlightCount(agentId, cap);
        if (inFlight >= cap) throw new WipCapExceeded(agentId, inFlight, cap);

        // audit-4085 #1: claim_work is the AUTHORITY — re-enforce role-eligibility +
        // dependency-readiness fail-closed (a direct claim-by-ID bypasses list_ready_work;
        // the `ready` phase alone is NOT trusted — a reconciler/stale state could set it).
        // dependsOn phases resolve async here (done is terminal → the snapshot is stable
        // across the CAS); dependsOn + roleEligibility are immutable spec, so the CAS
        // transform re-asserts both synchronously against the resolved snapshot.
        const pre = await this.substrate.get<WorkItem>(KIND, workId);
        if (!pre) return null;
        const depsNotDone = await this.unmetDependencies(cloneWorkItem(pre).dependsOn);

        return this.tryCasUpdate(workId, (w) => {
          this.assertNotFailedSealed(w);
          if (w.status !== "ready") throw new TransitionRejected(`claim requires ready, was ${w.status}`);
          assertRoleEligible(w, role); // (a) role ∈ roleEligibility (empty = any-role)
          if (depsNotDone.length > 0) { // (b) all dependsOn must be phase=done
            throw new ClaimRejected(`dependencies not done: ${depsNotDone.join(", ")}`);
          }
          const now = this.clock.now();
          const nowISO = now.toISOString();
          const lease: WorkItemLease = {
            holder: agentId,
            token: randomUUID(), // audit-4082 #1: fences a stale zombie-process re-read
            claimedAt: nowISO,
            expiresAt: new Date(now.getTime() + leaseTtlMsFor(w)).toISOString(),
            heartbeatAt: nowISO,
          };
          // SEAL (idea-444) fold 2: record this holder in the append-only executor history
          // (distinct) — backs the no-owner/executor-write HISTORY check in attest_evidence.
          const executorHistory = w.executorHistory.includes(agentId) ? w.executorHistory : [...w.executorHistory, agentId];
          return { ...w, status: "claimed", lease, executorHistory, ...accrueExitingState(w, nowISO), updatedAt: nowISO };
        });
      },
      { timeoutMs: CLAIM_LOCK_TIMEOUT_MS },
    );
  }

  async startWork(workId: string, agentId: string, leaseToken: string): Promise<WorkItem | null> {
    return this.tryCasUpdate(workId, (w) => {
      this.assertLease(w, agentId, leaseToken, "start");
      if (w.status !== "claimed") throw new TransitionRejected(`start requires claimed, was ${w.status}`);
      const nowISO = this.clock.now().toISOString();
      return { ...w, status: "in_progress", ...accrueExitingState(w, nowISO), updatedAt: nowISO };
    });
  }

  async blockWork(workId: string, agentId: string, leaseToken: string, blockedOn: WorkItemBlockedOn): Promise<WorkItem | null> {
    return this.tryCasUpdate(workId, (w) => {
      this.assertLease(w, agentId, leaseToken, "block");
      if (w.status !== "in_progress") throw new TransitionRejected(`block requires in_progress, was ${w.status}`);
      const nowISO = this.clock.now().toISOString();
      return { ...w, status: "blocked", blockedOn, ...accrueExitingState(w, nowISO), updatedAt: nowISO };
    });
  }

  async resumeWork(workId: string, agentId: string, leaseToken: string): Promise<WorkItem | null> {
    return this.tryCasUpdate(workId, (w) => {
      this.assertLease(w, agentId, leaseToken, "resume");
      if (w.status !== "blocked") throw new TransitionRejected(`resume requires blocked, was ${w.status}`);
      const nowISO = this.clock.now().toISOString();
      return { ...w, status: "in_progress", blockedOn: null, ...accrueExitingState(w, nowISO), updatedAt: nowISO };
    });
  }

  // ── Mission-140 pause/recall + scalar recommit ────────────────────────────
  private async resolvePauseLocator(request: { workId?: string; logicalId?: string }): Promise<string> {
    const hasPhysical = typeof request.workId === "string" && request.workId.length > 0;
    const hasLogical = typeof request.logicalId === "string" && request.logicalId.length > 0;
    if (hasPhysical === hasLogical) throw new TransitionRejected("exactly one of workId or logicalId is required");
    if (hasPhysical) return request.workId!; // exact historical IDs never follow successors
    const logicalId = request.logicalId!;
    const pin = this.currentness.currentPin();
    if (pin?.mode === "generation") {
      const binding = pin.generation.bindings[logicalId];
      if (!binding) throw new TransitionRejected(`logical WorkItem ${logicalId} has no current binding in generation ${pin.head.generation}`);
      return binding.physicalId;
    }
    return logicalId; // deterministic legacy projection
  }

  private async originalCreatorAgentId(item: WorkItem): Promise<string | undefined> {
    const pin = this.currentness.currentPin();
    if (pin?.mode !== "generation") return item.createdBy?.agentId;
    const logicalId = item.logicalId ?? item.id;
    const raw = await this.substrate.get<Record<string, unknown>>("WorkRevisionFamily", logicalId);
    if (!raw) throw new TransitionRejected(`revision family ${logicalId} is missing; original-creator authority cannot be resolved`);
    const family = decodeEnvelopeToFlat(raw, "WorkRevisionFamily") as unknown as { originalCreatedBy?: { agentId?: string } };
    const creator = family.originalCreatedBy?.agentId;
    if (!creator) throw new TransitionRejected(`revision family ${logicalId} has no server-derived original creator`);
    return creator;
  }

  private assertPauseExpectations(item: WorkItem, request: { expectedRevision?: number; expectedGeneration?: number }): void {
    const pin = this.currentness.currentPin();
    const revision = item.revision ?? 1;
    const generation = pin?.mode === "generation" ? pin.head.generation : 0;
    if (request.expectedRevision !== undefined && request.expectedRevision !== revision) {
      throw new TransitionRejected(`pause currentness mismatch: expected revision ${request.expectedRevision}, current ${revision}`);
    }
    if (request.expectedGeneration !== undefined && request.expectedGeneration !== generation) {
      throw new TransitionRejected(`pause currentness mismatch: expected generation ${request.expectedGeneration}, current ${generation}`);
    }
  }

  /** Recompute claimant and edge authority from the persisted row plus the pinned
   *  immutable generation. Stored node* hashes are outputs to cross-check, never
   *  inputs trusted as proof. This is invoked at BOTH pause and unpause. */
  private deriveFrozenRecallAuthority(item: WorkItem): FrozenRecallAuthorityV4 {
    const pin = this.currentness.currentPin();
    if (!pin) throw new TransitionRejected("pause authority requires a pinned WorkGraph snapshot");
    const logicalId = item.logicalId ?? item.id;
    const revision = item.revision ?? 1;
    let nodeContractHash: string;
    let dependsOnLogicalIds: string[];
    let completionDependsOnLogicalIds: string[];
    let localExecutionIdentity: string | null = null;

    if (pin.mode === "generation") {
      const binding = pin.generation.bindings[logicalId];
      if (!binding || binding.physicalId !== item.id || binding.revision !== revision) {
        throw new WorkGraphCurrentnessRejected(
          "workgraph.currentness.old_or_draft",
          `persisted row ${item.id} is not the active binding for ${logicalId}@${revision}`,
        );
      }
      const physicalToLogical = new Map(Object.entries(pin.generation.bindings)
        .map(([id, target]) => [target.physicalId, id] as const));
      const resolveEdge = (locator: string): string => {
        if (pin.generation.bindings[locator]) return locator;
        const resolved = physicalToLogical.get(locator);
        if (!resolved) {
          throw new WorkGraphCurrentnessRejected(
            "workgraph.currentness.integrity",
            `persisted row ${item.id} carries an edge to non-generation target ${locator}`,
          );
        }
        return resolved;
      };
      dependsOnLogicalIds = (item.dependsOn ?? []).map(resolveEdge).sort();
      completionDependsOnLogicalIds = (item.completionDependsOn ?? []).map(resolveEdge).sort();
      if (new Set(dependsOnLogicalIds).size !== dependsOnLogicalIds.length ||
          new Set(completionDependsOnLogicalIds).size !== completionDependsOnLogicalIds.length) {
        throw new WorkGraphCurrentnessRejected(
          "workgraph.currentness.identity_mismatch",
          `persisted row ${item.id} carries duplicate topology edges`,
        );
      }
      const expectedDependsOn = [...(pin.generation.dependsOn[logicalId] ?? [])].sort();
      const expectedCompletion = [...(pin.generation.completionDependsOn[logicalId] ?? [])].sort();
      if (JSON.stringify(dependsOnLogicalIds) !== JSON.stringify(expectedDependsOn) ||
          JSON.stringify(completionDependsOnLogicalIds) !== JSON.stringify(expectedCompletion)) {
        throw new WorkGraphCurrentnessRejected(
          "workgraph.currentness.revision_required",
          `persisted row ${item.id} edges changed outside active generation ${pin.head.generation}; semantic revision required`,
        );
      }
      try {
        const contract = deriveNodeContractV4({
          type: item.type,
          roleEligibility: item.roleEligibility ?? [],
          ...(item.runbook !== undefined ? { runbook: item.runbook } : {}),
          ...(item.payload !== undefined ? { payload: item.payload } : {}),
          targetRef: item.targetRef ?? null,
          evidenceRequirements: item.evidenceRequirements ?? [],
          references: item.references ?? [],
          ...(item.leaseWindowMs !== undefined ? { leaseWindowMs: item.leaseWindowMs } : {}),
          ...(item.nodeConfig !== undefined ? { nodeConfig: item.nodeConfig } : {}),
        }, item.boundReferences ?? []);
        nodeContractHash = contract.hash;
      } catch (error) {
        throw new WorkGraphCurrentnessRejected(
          "workgraph.currentness.identity_mismatch",
          `persisted row ${item.id} claimant contract cannot be exactly recomputed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (nodeContractHash !== binding.nodeContractHash || item.nodeContractHashVersion !== NODE_CONTRACT_HASH_VERSION ||
          item.nodeContractHash !== binding.nodeContractHash) {
        throw new WorkGraphCurrentnessRejected(
          "workgraph.currentness.revision_required",
          `persisted row ${item.id} claimant contract changed outside active generation ${pin.head.generation}; semantic revision required`,
        );
      }
      const topology = deriveNodeTopologyV4(logicalId, dependsOnLogicalIds, completionDependsOnLogicalIds);
      if (topology.hash !== binding.nodeTopologyHash || item.nodeTopologyHashVersion !== NODE_TOPOLOGY_HASH_VERSION ||
          item.nodeTopologyHash !== binding.nodeTopologyHash) {
        throw new WorkGraphCurrentnessRejected(
          "workgraph.currentness.revision_required",
          `persisted row ${item.id} topology changed outside active generation ${pin.head.generation}; semantic revision required`,
        );
      }
      const outgoing: TargetBindingV4[] = [
        ...dependsOnLogicalIds.map((targetLogicalId) => ({ edgeClass: "dependsOn" as const, targetLogicalId })),
        ...completionDependsOnLogicalIds.map((targetLogicalId) => ({ edgeClass: "completionDependsOn" as const, targetLogicalId })),
      ].map(({ edgeClass, targetLogicalId }) => {
        const target = pin.generation.bindings[targetLogicalId]!;
        return {
          edgeClass,
          targetLogicalId,
          targetPhysicalId: target.physicalId,
          targetRevision: target.revision,
          targetNodeContractHashVersion: target.nodeContractHashVersion,
          targetNodeContractHash: target.nodeContractHash,
        };
      });
      localExecutionIdentity = deriveLocalExecutionIdentityV4({
        logicalId,
        physicalId: item.id,
        revision,
        nodeContractHashVersion: NODE_CONTRACT_HASH_VERSION,
        nodeContractHash,
        nodeTopologyHashVersion: NODE_TOPOLOGY_HASH_VERSION,
        nodeTopologyHash: topology.hash,
        outgoingTargetBindings: outgoing,
      });
      if (item.localExecutionIdentity !== localExecutionIdentity) {
        throw new WorkGraphCurrentnessRejected(
          "workgraph.currentness.revision_required",
          `persisted row ${item.id} local execution identity changed outside active generation ${pin.head.generation}; semantic revision required`,
        );
      }
    } else {
      // Legacy/shadow has no immutable generation to bind content identities against.
      // Freeze the exact persisted claimant projection so a paused row still cannot
      // be mutated and laundered through creator scalar unpause.
      const claimantProjection = JSON.parse(JSON.stringify({
        type: item.type,
        roleEligibility: item.roleEligibility ?? [],
        runbook: item.runbook,
        payload: item.payload,
        targetRef: item.targetRef ?? null,
        evidenceRequirements: item.evidenceRequirements ?? [],
        references: item.references ?? [],
        boundReferences: item.boundReferences ?? [],
        leaseWindowMs: item.leaseWindowMs,
        nodeConfig: item.nodeConfig ? {
          pulse: item.nodeConfig.pulse ? {
            intervalSeconds: item.nodeConfig.pulse.intervalSeconds,
            message: item.nodeConfig.pulse.message,
            responseShape: item.nodeConfig.pulse.responseShape,
            missedThreshold: item.nodeConfig.pulse.missedThreshold,
            firstFireDelaySeconds: item.nodeConfig.pulse.firstFireDelaySeconds,
          } : null,
        } : undefined,
      })) as unknown;
      nodeContractHash = hashCanonicalDomain("legacy-frozen-claimant-contract-v4", claimantProjection);
      dependsOnLogicalIds = [...(item.dependsOn ?? [])].sort();
      completionDependsOnLogicalIds = [...(item.completionDependsOn ?? [])].sort();
    }

    const topology = deriveNodeTopologyV4(logicalId, dependsOnLogicalIds, completionDependsOnLogicalIds);
    const authority = {
      version: "frozen-recall-authority-v4" as const,
      mode: pin.mode,
      logicalId,
      physicalId: item.id,
      revision,
      generation: pin.mode === "generation" ? pin.head.generation : null,
      nodeContractHash,
      nodeTopologyHash: topology.hash,
      dependsOnLogicalIds,
      completionDependsOnLogicalIds,
      localExecutionIdentity,
    };
    return {
      ...authority,
      authorityHash: hashCanonicalDomain("frozen-recall-authority-v4", authority),
    };
  }

  private assertFrozenRecallAuthorityUnchanged(
    frozen: FrozenRecallAuthorityV4 | undefined,
    current: FrozenRecallAuthorityV4,
    workId: string,
  ): void {
    if (!frozen) {
      throw new WorkGraphCurrentnessRejected(
        "workgraph.currentness.revision_required",
        `unpause rejected: ${workId} has no frozen paused-row authority; create a semantic revision`,
      );
    }
    const { authorityHash: storedHash, ...storedPayload } = frozen;
    if (hashCanonicalDomain("frozen-recall-authority-v4", storedPayload) !== storedHash ||
        storedHash !== current.authorityHash) {
      throw new WorkGraphCurrentnessRejected(
        "workgraph.currentness.revision_required",
        `unpause rejected: ${workId} claimant row or generation edges changed while paused; create a semantic revision`,
      );
    }
  }

  async pauseWork(request: PauseWorkRequestV4, actor: { agentId: string; role: string }): Promise<WorkItem | null> {
    if (!this.currentness.currentPin()) return this.withWriterFence(() => this.pauseWork(request, actor));
    if (!request.operationId?.trim()) throw new TransitionRejected("pause operationId is required");
    if (!request.reason?.trim()) throw new TransitionRejected("pause reason is required");
    const workId = await this.resolvePauseLocator(request);
    const requestHash = hashCanonicalDomain("workitem-pause-request-v4", {
      workId, operationId: request.operationId, reason: request.reason,
      expectedRevision: request.expectedRevision ?? null,
      expectedGeneration: request.expectedGeneration ?? null,
      actor,
    });
    try {
      return await this.tryCasUpdate(workId, async (w, resourceVersion) => {
        const replay = (w.recallHistory ?? []).find((entry) => entry.operationId === request.operationId);
        if (replay) {
          if (replay.requestHash !== requestHash) throw new TransitionRejected(`pause operation ${request.operationId} was already used with different bytes`);
          throw new IdempotentRecall(w);
        }
        this.assertNotFailedSealed(w);
        this.assertPauseExpectations(w, request);
        if (!["ready", "claimed", "in_progress", "blocked"].includes(w.status)) {
          throw new TransitionRejected(`pause requires ready|claimed|in_progress|blocked, was ${w.status}`);
        }
        if (w.status === "ready" && w.lease) throw new TransitionRejected(`pause rejected corrupt ready row ${w.id}: unexpected live lease`);
        if (w.status !== "ready" && !w.lease) throw new TransitionRejected(`pause rejected corrupt active row ${w.id}: exact holder lease is missing`);
        if (w.status === "blocked" && !w.blockedOn) throw new TransitionRejected(`pause rejected corrupt blocked row ${w.id}: blocker projection is missing`);
        const isCreator = await this.originalCreatorAgentId(w) === actor.agentId;
        const isSteward = actor.role === "architect" || actor.role === "director";
        if (w.status === "ready" ? (!isCreator && !isSteward) : !isSteward) {
          const requirement = w.status === "ready" ? "original creator, architect, or Director" : "architect or Director for active recall";
          throw new TransitionRejected(`pause requires ${requirement}, not ${actor.role}/${actor.agentId}`);
        }

        const nowISO = this.clock.now().toISOString();
        const identity = legacyRevisionIdentity(w);
        const frozenAuthority = this.deriveFrozenRecallAuthority(w);
        const stateHash = recallStateHash(w);
        const before: RecallBeforeStateV4 = {
          physicalId: w.id,
          logicalId: identity.logicalId,
          revision: identity.revision,
          topologyGeneration: w.topologyGeneration ?? null,
          phase: w.status as RecallBeforeStateV4["phase"],
          resourceVersion,
          stateHash,
          blockedOn: w.blockedOn ? {
            blockerKind: w.blockedOn.blockerKind,
            blockerIds: [...(w.blockedOn.blockerIds ?? [])],
            reason: w.blockedOn.reason,
          } : null,
          lease: w.lease ? {
            holder: w.lease.holder,
            claimedAt: w.lease.claimedAt,
            expiresAt: w.lease.expiresAt,
            heartbeatAt: w.lease.heartbeatAt,
            tokenFingerprint: recallTokenFingerprint(w.lease.token),
          } : null,
        };
        const holderNoticeIntentId = w.lease
          ? hashCanonicalDomain("workitem-recall-notice-v4", {
              physicalId: w.id, operationId: request.operationId,
              exactHolder: w.lease.holder, beforeStateHash: stateHash,
            })
          : null;
        const history: RecallHistoryEntryV4 = {
          operationId: request.operationId,
          requestHash,
          actor: { role: actor.role, agentId: actor.agentId },
          reason: request.reason,
          recalledAt: nowISO,
          beforeStateHash: stateHash,
          before,
          frozenAuthority,
          holderNoticeIntentId,
        };
        const notice: PendingRecallIntentV4 | null = w.lease ? {
          intentId: holderNoticeIntentId!,
          operationId: request.operationId,
          exactHolderAgentId: w.lease.holder,
          beforeStateHash: stateHash,
          createdAt: nowISO,
          projectedMessageId: null,
          projectedAt: null,
        } : null;
        return {
          ...w,
          status: "paused" as const,
          lease: null,
          blockedOn: null,
          recallHistory: [...(w.recallHistory ?? []), history],
          pendingRecallIntents: notice ? [...(w.pendingRecallIntents ?? []), notice] : (w.pendingRecallIntents ?? []),
          recallNoticePending: notice ? true : (w.recallNoticePending ?? false),
          ...accrueExitingState(w, nowISO),
          updatedAt: nowISO,
        };
      });
    } catch (error) {
      if (error instanceof IdempotentRecall) {
        Object.defineProperty(error.item, PAUSE_OPERATION_REPLAY, { value: true, enumerable: false });
        return error.item;
      }
      throw error;
    }
  }

  async recommitRevisionSet(
    request: UnpauseWorkRequestV4,
    actor: { agentId: string; role: string },
  ): Promise<{ workItems: WorkItem[]; operationReplay: boolean }> {
    if (actor.role !== "architect" && actor.role !== "director") {
      throw new WorkGraphCurrentnessRejected("revision.director_or_architect_required", "revision-set recommit requires architect or Director");
    }
    const logicalIds = [...(request.logicalIds ?? [])].sort();
    if (logicalIds.length === 0 || new Set(logicalIds).size !== logicalIds.length || !request.operationId?.trim() || !request.reason?.trim()) {
      throw new TransitionRejected("revision-set recommit requires unique logicalIds, operationId, and reason");
    }
    if (request.expectedGeneration === undefined || !request.expectedRevisions) throw new TransitionRejected("revision-set recommit requires expectedGeneration and expectedRevisions");
    const expectedRevisions = request.expectedRevisions;
    if (canonicalJson(Object.keys(expectedRevisions).sort()) !== canonicalJson(logicalIds)) throw new TransitionRejected("expectedRevisions must exactly cover logicalIds");
    const requestHash = hashCanonicalDomain("workgraph-recommit-request-v4", JSON.parse(JSON.stringify({
      logicalIds, expectedRevisions, expectedGeneration: request.expectedGeneration,
      operationId: request.operationId, reason: request.reason, actor,
    })));

    return this.currentness.withWriterFence(async (pin) => {
      if (pin.mode !== "generation" || pin.head.generation !== request.expectedGeneration) throw new WorkGraphCurrentnessRejected("revision.currentness_mismatch", "recommit generation changed");
      const operationRow = await this.substrate.getWithRevision<WorkGraphRevisionOperationV4>(WORK_REVISION_KINDS.operation, pin.generation.operationId);
      if (!operationRow) throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", "active revision operation is missing");
      const operation = decodeEnvelopeToFlat(operationRow.entity);
      if (operation.recommitSet.length === 0) {
        if (operation.recommitOperationId !== request.operationId || operation.recommitRequestHash !== requestHash) throw new WorkGraphCurrentnessRejected("workgraph.currentness.revision_required", "no matching pending recommit set");
        const workItems: WorkItem[] = [];
        for (const logicalId of logicalIds) {
          const binding = pin.generation.bindings[logicalId];
          const item = binding ? await this.getWorkItem(binding.physicalId) : null;
          if (!item || item.status !== "ready") throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", `recommitted ${logicalId} is not ready`);
          workItems.push(this.observe(item, pin));
        }
        return { workItems, operationReplay: true };
      }
      if (canonicalJson([...operation.recommitSet].sort()) !== canonicalJson(logicalIds)) throw new WorkGraphCurrentnessRejected("workgraph.currentness.revision_required", "recommit set is not exact");
      const rows: Array<{ item: WorkItem; resourceVersion: string }> = [];
      for (const logicalId of logicalIds) {
        const binding = pin.generation.bindings[logicalId];
        if (!binding || binding.revision !== expectedRevisions[logicalId]) throw new WorkGraphCurrentnessRejected("revision.currentness_mismatch", `recommit revision mismatch for ${logicalId}`);
        const row = await this.substrate.getWithRevision<WorkItem>(KIND, binding.physicalId);
        if (!row) throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", `recommit row ${binding.physicalId} missing`);
        const item = cloneWorkItem(row.entity);
        this.currentness.assertCurrent(item, pin);
        if (item.status !== "paused" || item.lease) throw new WorkGraphCurrentnessRejected("workgraph.currentness.revision_required", `recommit ${logicalId} is not paused and unleased`);
        rows.push({ item, resourceVersion: row.resourceVersion });
      }
      const nowISO = this.clock.now().toISOString();
      const nextRows = rows.map(({ item, resourceVersion }) => ({ next: { ...item, status: "ready" as const, ...accrueExitingState(item, nowISO), updatedAt: nowISO }, resourceVersion }));
      const nextOperation: WorkGraphRevisionOperationV4 = { ...operation, recommittedSet: [...operation.recommitSet], recommitSet: [], recommitOperationId: request.operationId, recommitRequestHash: requestHash, recommittedAt: nowISO };
      const batch = await this.substrate.putBatchIfMatch([
        ...nextRows.map((row) => ({ kind: KIND, entity: row.next, expectedRevision: row.resourceVersion })),
        { kind: WORK_REVISION_KINDS.operation, entity: nextOperation, expectedRevision: operationRow.resourceVersion },
      ]);
      if (!batch.ok) throw new WorkGraphCurrentnessRejected("workgraph.currentness.head_changed", `atomic recommit CAS conflict: ${batch.conflicts.map((entry) => `${entry.kind}/${entry.id}`).join(",")}`);
      return { workItems: nextRows.map((row) => this.observe(row.next, pin)), operationReplay: false };
    });
  }

  async unpauseWork(request: UnpauseWorkRequestV4, actor: { agentId: string; role: string }): Promise<WorkItem | null> {
    if (request.logicalIds !== undefined) throw new TransitionRejected("batch unpause must use recommitRevisionSet");
    if (!this.currentness.currentPin()) return this.withWriterFence(() => this.unpauseWork(request, actor));
    const workId = await this.resolvePauseLocator(request);
    return this.tryCasUpdate(workId, async (w) => {
      this.assertNotFailedSealed(w);
      this.assertPauseExpectations(w, request);
      if (w.status !== "paused") throw new TransitionRejected(`unpause requires paused, was ${w.status}`);
      const lastRecall = (w.recallHistory ?? []).at(-1);
      const currentAuthority = this.deriveFrozenRecallAuthority(w);
      this.assertFrozenRecallAuthorityUnchanged(lastRecall?.frozenAuthority, currentAuthority, w.id);
      const isCreator = await this.originalCreatorAgentId(w) === actor.agentId;
      const creatorCompatibility = isCreator
        && !w.predecessorPhysicalId
        && lastRecall?.actor.agentId === actor.agentId;
      const isSteward = actor.role === "architect" || actor.role === "director";
      if (!creatorCompatibility && !isSteward) {
        const originalCreator = await this.originalCreatorAgentId(w);
        const holderOnly = w.lease?.holder === actor.agentId || w.executorHistory.includes(actor.agentId);
        const code = holderOnly
          ? "revision.holder_has_no_authority"
          : originalCreator === actor.agentId
            ? "revision.architect_required"
            : "revision.actor_forbidden";
        throw new WorkGraphCurrentnessRejected(code, "unpause requires the original creator who paused this unchanged row, architect, or Director; holder/reviser status grants no authority");
      }
      const nowISO = this.clock.now().toISOString();
      return { ...w, status: "ready" as const, ...accrueExitingState(w, nowISO), updatedAt: nowISO };
    });
  }

  async listPendingRecallNoticeItems(limit = LIST_CAP): Promise<{ items: WorkItem[]; truncated: boolean }> {
    if (!this.currentness.currentPin()) return this.withReadPin(() => this.listPendingRecallNoticeItems(limit));
    const cap = Math.min(Math.max(1, limit), LIST_CAP);
    const { items } = await this.substrate.list<WorkItem>(KIND, {
      filter: { "status.recallNoticePending": true },
      limit: cap,
    });
    const pending = items.map(cloneWorkItem).filter((item) =>
      (item.pendingRecallIntents ?? []).some((intent) => !intent.projectedMessageId));
    return { items: pending, truncated: items.length >= cap };
  }

  async markRecallNoticeProjected(workId: string, intentId: string, messageId: string): Promise<WorkItem | null> {
    return this.withWriterFence(async () => {
      for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
        const env = await this.substrate.getWithRevision<WorkItem>(KIND, workId);
        if (!env) return null;
        const item = cloneWorkItem(env.entity);
        const intents = item.pendingRecallIntents ?? [];
        const index = intents.findIndex((intent) => intent.intentId === intentId);
        if (index < 0) throw new TransitionRejected(`recall notice intent ${intentId} not found on ${workId}`);
        const existing = intents[index];
        if (existing.projectedMessageId) {
          if (existing.projectedMessageId !== messageId) {
            throw new TransitionRejected(`recall notice intent ${intentId} already projected as ${existing.projectedMessageId}`);
          }
          return item;
        }
        const nowISO = this.clock.now().toISOString();
        const updatedIntents = intents.map((intent, i) => i === index
          ? { ...intent, projectedMessageId: messageId, projectedAt: nowISO }
          : intent);
        const updated: WorkItem = {
          ...item,
          pendingRecallIntents: updatedIntents,
          recallNoticePending: updatedIntents.some((intent) => !intent.projectedMessageId),
          updatedAt: nowISO,
        };
        const saved = await this.substrate.putIfMatch(KIND, updated, env.resourceVersion);
        if (saved.ok) return cloneWorkItem(updated);
      }
      throw new Error(`CAS retry limit exceeded marking recall notice ${intentId}`);
    });
  }

  /** Heartbeat-extend the lease without changing phase (crash-gap vs slow-progress
   *  stays orthogonal to state). Legal in any lease-held phase. */
  async renewLease(workId: string, agentId: string, leaseToken: string): Promise<WorkItem | null> {
    if (!this.currentness.currentPin()) return this.withWriterFence(() => this.renewLease(workId, agentId, leaseToken));
    const renewed = await this.tryCasUpdate(workId, (w) => {
      this.assertLease(w, agentId, leaseToken, "renew");
      if (!LEASE_HELD_PHASES.includes(w.status)) throw new TransitionRejected(`renew requires a held lease, was ${w.status}`);
      const now = this.clock.now();
      const nowISO = now.toISOString();
      // audit-4103 (LOW): cannot renew an ALREADY-EXPIRED lease — it's the sweeper's to
      // re-queue; renewing a dead lease would race the sweeper. Fail-loud (ISO-8601
      // lexicographic compare = chronological for same-format UTC-Z timestamps).
      if (w.lease && w.lease.expiresAt < nowISO) {
        throw new TransitionRejected(`renew rejected: lease already expired (expiresAt=${w.lease.expiresAt} < now=${nowISO})`);
      }
      const lease: WorkItemLease = {
        ...(w.lease as WorkItemLease),
        heartbeatAt: nowISO,
        expiresAt: new Date(now.getTime() + leaseTtlMsFor(w)).toISOString(),
      };
      return { ...w, lease, updatedAt: nowISO };
    });
    // work-88 (arc-node): the subtree-coupled transitive-heartbeat. A renew is an
    // "active descendant" signal — propagate it UP every ancestor arc that brackets this
    // node (lists it, transitively, in completionDependsOn), keeping their leases fresh so
    // the unchanged sweeper + stall-warning naturally skip an arc whose subtree is active
    // (F3: the bump IS the relaxation — no sweeper change). Best-effort + isolated (F2): a
    // propagation failure NEVER fails the renew. Only runs after the node actually renewed.
    if (renewed) await this.propagateHeartbeatToAncestors(workId);
    return renewed;
  }

  /**
   * work-88 (arc-node): walk UP the reverse-completionDependsOn edges from `startId`,
   * bumping every ancestor arc's heartbeat so its lease does not tick while the subtree is
   * active. Transitive: child → parent arc → grand-arc → … The traversal continues through
   * EVERY ancestor found (even an unheld/ready intermediate relays the active-subtree
   * signal up to a held grand-arc); only HELD + not-already-expired nodes are actually
   * bumped (tryBumpAncestorHeartbeat). A `visited` set bounds it (the union graph is
   * acyclic-by-construction — work-87's expander validates the whole-graph DFS — but the
   * belt is cheap). Best-effort (F2): a failed reverse-lookup or bump is logged + skipped,
   * never propagated to the caller's renew.
   */
  private async propagateHeartbeatToAncestors(startId: string): Promise<void> {
    const visited = new Set<string>([startId]);
    let frontier = [startId];
    while (frontier.length > 0) {
      const nextFrontier: string[] = [];
      for (const nodeId of frontier) {
        let parents: WorkItem[];
        try {
          parents = await this.parentsAwaitingCompletion(nodeId);
        } catch (e) {
          console.warn(`[WorkItemRepositorySubstrate] heartbeat-propagation: reverse-ancestor lookup failed for ${nodeId}: ${String(e)}`);
          continue; // F2 best-effort — a lookup gap must not fail the renew
        }
        for (const parent of parents) {
          if (visited.has(parent.id)) continue; // acyclic-by-construction belt
          visited.add(parent.id);
          nextFrontier.push(parent.id); // relay the signal up regardless of whether we bump THIS node
          try {
            await this.tryBumpAncestorHeartbeat(parent.id);
          } catch (e) {
            console.warn(`[WorkItemRepositorySubstrate] heartbeat-propagation: ancestor bump failed for ${parent.id}: ${String(e)}`);
            // F2 best-effort — keep propagating to the rest of the chain
          }
        }
      }
      frontier = nextFrontier;
    }
  }

  /**
   * work-88 (arc-node): the GIN-backed reverse-ancestor lookup — WorkItems that list
   * `childId` in their completionDependsOn (the arc-nodes bracketing this child). $contains
   * (@>) over spec.completionDependsOn, index-backed (workitem_spec_completiondependson_gin_idx)
   * — NOT an in-memory scan over a list (cal #90 silent-miss past the 500-cap). One node is
   * realistically in ≤1 arc's completionDependsOn, so the cap is never approached; the
   * truncation log is a pure honesty belt (tele-4).
   */
  private async parentsAwaitingCompletion(childId: string): Promise<WorkItem[]> {
    const pin = this.currentness.currentPin();
    if (pin?.mode === "generation") {
      const child = await this.getCurrentProjectionItem(childId);
      if (!child?.logicalId) return [];
      const parentLogicalIds = pin.generation.reverseCompletionDependsOn[child.logicalId] ?? [];
      const parents: WorkItem[] = [];
      for (const logicalId of parentLogicalIds) {
        // idea-633 Part 1 deliberately does NOT add an unbound->legacy fallback here. It was
        // implemented, measured, and reverted: a generation cannot carry an edge whose target is
        // unbound (buildWorkRevisionStorageV4 rejects it as storage.dangling_edge), so
        // reverseCompletionDependsOn can only name BOUND ids and this `!binding` throw is
        // unreachable while the generation is internally consistent. A guard that cannot execute
        // is not defence in depth — it is a claim that something is handled.
        // The REAL defect here is the opposite one and is filed as bug-370: a legacy completion
        // parent is INVISIBLE to this branch (reverseCompletionDependsOn simply omits it), so it
        // is never bumped, silently — where the legacy substrate scan below would have found it.
        const binding = pin.generation.bindings[logicalId];
        if (!binding) throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", `reverse completion edge names absent binding ${logicalId}`);
        const parent = await this.getCurrentProjectionItem(binding.physicalId);
        if (!parent) throw new WorkGraphCurrentnessRejected("workgraph.currentness.integrity", `current reverse-completion parent ${binding.physicalId} is missing`);
        parents.push(parent);
      }
      return parents;
    }
    const { items } = await this.substrate.list<WorkItem>(KIND, {
      filter: { completionDependsOn: { $contains: childId } },
      limit: READY_SCAN_CAP,
    });
    if (items.length >= READY_SCAN_CAP) {
      console.warn(`[WorkItemRepositorySubstrate] heartbeat-propagation: reverse-ancestor scan for ${childId} hit the ${READY_SCAN_CAP} cap — ancestors beyond it were NOT bumped (implausible fan-out; surfaced rather than silently dropped)`);
    }
    return items.map(cloneWorkItem);
  }

  /**
   * work-88 (arc-node): bump ONE ancestor arc's heartbeat (the subtree-active signal),
   * extending expiresAt/heartbeatAt WITHOUT changing phase or holder. THE airtight
   * invariant (mirrors renewLease's own audit-4103 guard): NEVER bump an ALREADY-EXPIRED
   * lease — that would resurrect a dead arc the sweeper is about to reap, breaking
   * expireLease as the SOLE expiry authority (F3). A node with no lease (ready/unclaimed
   * intermediate) is skipped too. A cheap pre-read avoids a no-op CAS write in the common
   * skip case; the guard is RE-CHECKED on the fresh row inside the CAS (TOCTOU-safe — a
   * lease that lapses between the pre-read and the CAS is still not resurrected).
   */
  private async tryBumpAncestorHeartbeat(arcId: string): Promise<void> {
    const pre = await this.getCurrentProjectionItem(arcId);
    if (!pre?.lease) return; // nothing held to keep alive
    if (pre.lease.expiresAt < this.clock.now().toISOString()) return; // already-expired → sweeper's; never resurrect
    await this.tryCasUpdate(arcId, (w) => {
      const now = this.clock.now();
      const nowISO = now.toISOString();
      // Re-check on the FRESH row — the airtight already-expired guard (a lease that lapsed
      // between the pre-read and here must NOT be bumped); return unchanged to skip.
      if (!w.lease || w.lease.expiresAt < nowISO) return w;
      const lease: WorkItemLease = {
        ...w.lease,
        heartbeatAt: nowISO,
        expiresAt: new Date(now.getTime() + leaseTtlMsFor(w)).toISOString(),
      };
      return { ...w, lease, updatedAt: nowISO };
    });
  }

  /** Voluntary un-claim back to ready (holder + matching token). Preserves
   *  leaseExpiryCount (a voluntary release is not a poison-expiry; only the sweeper
   *  increments it). */
  async releaseWork(workId: string, agentId: string, leaseToken: string): Promise<WorkItem | null> {
    return this.tryCasUpdate(workId, (w) => {
      this.assertLease(w, agentId, leaseToken, "release");
      if (!RELEASABLE_PHASES.includes(w.status)) throw new TransitionRejected(`release requires an active claim, was ${w.status}`);
      const nowISO = this.clock.now().toISOString();
      return { ...w, status: "ready", lease: null, blockedOn: null, ...accrueExitingState(w, nowISO), updatedAt: nowISO };
    });
  }

  /**
   * Terminal abandon. The lease-holder (presenting a matching token) OR the creator
   * (override authority — no token; lets a creator reclaim a stuck item from its
   * holder) may abandon. The CREATOR may additionally abandon from `ready` (bug-219
   * fix (c): a role-gated ready item with no registered seat — e.g. director-gated —
   * is otherwise permanently unclaimable and un-closeable; ready holds no lease, so
   * only the creator-override identity path can reach it). The reason is recorded by
   * the policy/audit layer (sub-PR-3b).
   */
  async systemUnblock(workId: string, decisionRef: string): Promise<WorkItem | null> {
    return this.tryCasUpdate(workId, (w) => {
      this.assertNotFailedSealed(w);
      if (w.status !== "blocked") {
        throw new TransitionRejected(`systemUnblock requires blocked, was ${w.status}`);
      }
      if (!w.blockedOn?.blockerIds?.includes(decisionRef)) {
        throw new TransitionRejected(`systemUnblock rejected: ${workId} is not blocked on ${decisionRef} (blockers: [${w.blockedOn?.blockerIds?.join(", ") ?? ""}]) — a decision only unblocks what waits on it`);
      }
      const nowISO = this.clock.now().toISOString();
      return { ...w, status: "in_progress", blockedOn: null, ...accrueExitingState(w, nowISO), updatedAt: nowISO };
    });
  }

  async abandonWork(workId: string, agentId: string, opts?: { reason?: string; leaseToken?: string }): Promise<WorkItem | null> {
    return this.tryCasUpdate(workId, (w) => {
      this.assertNotFailedSealed(w);
      const isHolderWithToken = w.lease?.holder === agentId && w.lease?.token === opts?.leaseToken;
      const isCreator = w.createdBy?.agentId === agentId;
      if (!isHolderWithToken && !isCreator) {
        throw new TransitionRejected(`abandon requires the lease-holder (with matching token) or the creator, not ${agentId}`);
      }
      if (!RELEASABLE_PHASES.includes(w.status) && !(w.status === "ready" && isCreator)) {
        throw new TransitionRejected(`abandon requires an active claim (or the creator from ready), was ${w.status}`);
      }
      const nowISO = this.clock.now().toISOString();
      return { ...w, status: "abandoned", lease: null, blockedOn: null, ...accrueExitingState(w, nowISO), updatedAt: nowISO };
    });
  }

  /**
   * {in_progress|review} → review|done, gated by the anti-gameability evidence
   * predicate (audit-4082 contract; see evaluateEvidence). Appends + dedups the
   * supplied evidence, validates coverage/kind/freshness/refResolvable/floor, and
   * transitions: `review` while a review requirement is unmet, `done` once all are
   * covered. Throws EvidencePredicateFailed (specific reason) on any unmet condition —
   * row UNCHANGED (atomic: evidence is stored only on a passing predicate). NEVER
   * requires a passing verdict.
   *
   * The OIS-internal ref existence-check (#4) is async, so it runs on a PRE-READ before
   * the synchronous CAS; requirements are immutable (spec), so the resolution is stable
   * across the CAS re-read. The CAS re-runs the sync predicate on the fresh row.
   */
  async completeWork(workId: string, agentId: string, leaseToken: string, evidence: EvidenceItem[], frictionReflection?: FrictionReflectionInput): Promise<CompleteWorkResult | null> {
    if (!this.currentness.currentPin()) return this.withWriterFence(() => this.completeWork(workId, agentId, leaseToken, evidence, frictionReflection));
    const pre = await this.substrate.get<WorkItem>(KIND, workId);
    if (!pre) return null;
    const item = cloneWorkItem(pre);
    this.currentness.assertCurrent(item, this.currentness.currentPin()!);
    // fail-fast auth + phase (re-checked authoritatively inside the CAS)
    this.assertLease(item, agentId, leaseToken, "complete");
    if (!COMPLETABLE_PHASES.includes(item.status)) {
      throw new TransitionRejected(`complete requires in_progress or review, was ${item.status}`);
    }
    // work-88 (arc-node): the COMPLETION-gate. An arc/umbrella node (completionDependsOn
    // non-empty) is completable ONLY once EVERY downstream child is `done`. GATE ONLY — the
    // arc-holder still does + submits the close-out; we never auto-complete the arc. Runs
    // BEFORE the evidence predicate (a half-finished subtree shouldn't even reach evidence
    // eval). Only DIRECT children are checked: transitivity emerges from each child's OWN
    // gate (B can't be `done` until C is), so the recursion brackets the whole subtree.
    // This pre-read verdict is stable across the CAS: completionDependsOn is immutable spec
    // and `done` is TERMINAL (monotonic) — a child can only move toward done, never back —
    // so no TOCTOU admits a premature close (the only race re-runs as a retryable reject).
    // A vanished child can never reach `done` → fail-CLOSED (blocks). `abandoned` ≠ `done`
    // → an abandoned child also blocks (an arc must not close over unfinished work — the
    // A8 one-enforced-close integrity posture; the arc-holder re-queues it to proceed).
    if (item.completionDependsOn.length > 0) {
      const prog = await this.computeCompletionProgress(item.completionDependsOn);
      if (prog.pending.length > 0) {
        throw new CompletionGateRejected(
          prog.done,
          prog.total,
          prog.pending,
          `${prog.done}/${prog.total} downstream done — not completable until all are done (pending: ${prog.pending.join(", ")})`,
        );
      }
    }
    // bug-204/audit-5093: a verifier-gate is SELF-ANCHORED (it carries targetRef:null) — its
    // pass-evidence is the verifier's own verdict-audit, not a targetRef-related artifact. The
    // flag narrows the kind-relaxation (above) + the relate-waiver (below) to verifier-gates ONLY.
    const isVerifierGate = item.type === "verifier-gate";
    // fail-fast the sync predicate + collect the async checks. priorKeys = the evidence
    // ALREADY persisted on the item (bound by a prior predicate-enforced complete) —
    // grandfathered through freshness (bug-222), never caller-suppliable.
    const plan = evaluateEvidence(item.evidenceRequirements, mergeEvidence(item.evidence, evidence), item.lease, isVerifierGate, new Set(item.evidence.map(evidenceKey)), priorLeaseFloorFor(item));
    // #4 + audit-4103 #1: each OIS-internal ref must RESOLVE *and* RELATE to this work-item
    // or its targetRef (existence-AND-relevance — closes the existence-theatre where any
    // org-wide entity, incl. the item's own id, satisfied existence-only).
    for (const r of plan.refsToResolve) {
      const e = await this.substrate.get<Record<string, unknown>>(r.kind, r.id);
      if (!e) {
        throw new EvidencePredicateFailed(`requirement '${r.requirementId}' refResolvable evidence ref ${r.kind}/${r.id} does not resolve`);
      }
      // relate check UNCHANGED — existence-theatre stays closed (audit-4103 #1). For an audit ref
      // refRelatesToWork requires relatedEntity ∈ {workId, targetRef.id}; a verifier-gate carries
      // targetRef:null, so its verdict-audit must have relatedEntity === the GATE id — i.e. be
      // specifically ABOUT this gate, NOT merely any org-wide verifier audit. (lily spec-validation
      // refinement, audit-5093: do NOT blanket-waive relate for verifier-gates — waive + actor-only
      // would let any verifier audit satisfy any gate, reopening exactly what audit-4103 #1 closed.)
      if (!this.refRelatesToWork(r.evidenceKind, e, item)) {
        throw new EvidencePredicateFailed(`requirement '${r.requirementId}' evidence ref ${r.kind}/${r.id} does not RELATE to this work-item (${item.id}) or its targetRef — existence alone is insufficient`);
      }
      // bug-204/audit-5093 net-new AUTHOR-ANCHOR: a verdict-audit must ALSO be VERIFIER-
      // authored. relate (above) proves the audit is ABOUT this item; this proves a VERIFIER
      // issued it. Trust the Audit's Hub-stamped actor (metadata.actor, derived server-side
      // from the registered session role, audit-policy.ts — a worker can't forge it;
      // producedBy is caller-supplied/forgeable + AuditEntry carries no producedBy field). A
      // worker self-closing with its own audit (actor=engineer) is rejected here. Applies on
      // a verifier-gate (every requirement, bug-204) AND wherever an audit satisfies a
      // REVIEW-kind requirement on a normal item (bug-220 (b) — the audit IS the verdict, so
      // the author-anchor travels with the kind-relaxation). Together: the verdict must be
      // verifier-authored AND specifically about THIS item.
      if (r.evidenceKind === "audit" && (isVerifierGate || r.reqKind === "review")) {
        const auditActor = (e.metadata as { actor?: string } | undefined)?.actor;
        if (auditActor !== "verifier") {
          throw new EvidencePredicateFailed(`requirement '${r.requirementId}' verdict-evidence audit ${r.id} was not authored by a verifier (actor=${auditActor ?? "unknown"}) — only a verifier-authored verdict audit can satisfy a review requirement or close a verifier-gate`);
        }
      }
      // audit-4120 #2 (non-spoofable v1): a refResolvable REVIEW gate must be VERIFIER-
      // CREATED — trust the gate WorkItem's Hub-stamped createdBy, NEVER the caller's
      // producedBy (a worker can forge that). The producedBy claim is only the residual
      // fallback for a NON-refResolvable review (idea-347 — verifier-direct-attach class).
      if (r.evidenceKind === "review") {
        const gateRole = cloneWorkItem(e as unknown as WorkItem).createdBy?.role;
        if (gateRole !== "verifier") {
          throw new EvidencePredicateFailed(`requirement '${r.requirementId}' review gate ${r.id} was not created by a verifier (createdBy.role=${gateRole ?? "unknown"}) — a worker-created gate is not a verifier review`);
        }
      }
    }
    // audit-4103 #2: review-kind evidence must be authored by a real verifier (a verifier
    // genuinely looked) before review→done — never a passing verdict, just provenance.
    for (const v of plan.verifierChecks) {
      if (!v.producedBy) {
        throw new EvidencePredicateFailed(`requirement '${v.requirementId}' review evidence has no producedBy (a verifier must author it)`);
      }
      const role = await this.resolveAgentRole(v.producedBy);
      if (role !== "verifier") {
        throw new EvidencePredicateFailed(`requirement '${v.requirementId}' review evidence producedBy ${v.producedBy} is not a verifier (role=${role ?? "unknown"}) — self-authored review is not a verifier review`);
      }
    }
    // Authoritative CAS: re-check auth + phase + re-run the predicate on the FRESH row,
    // then store the merged evidence + either block without advancing (missing friction)
    // or transition atomically (explicit friction).
    const updated = await this.tryCasUpdate(workId, (w) => {
      this.assertLease(w, agentId, leaseToken, "complete");
      if (!COMPLETABLE_PHASES.includes(w.status)) throw new TransitionRejected(`complete requires in_progress or review, was ${w.status}`);
      const nowISO = this.clock.now().toISOString();
      const merged = mergeEvidence(w.evidence, evidence);
      const { nextPhase: evidencePhase } = evaluateEvidence(w.evidenceRequirements, merged, w.lease, w.type === "verifier-gate", new Set(w.evidence.map(evidenceKey)), priorLeaseFloorFor(w));
      if (!frictionReflection) {
        return { ...w, evidence: merged, updatedAt: nowISO };
      }
      const frictionRecord = normalizeFrictionReflection(frictionReflection, agentId, nowISO);
      // SEAL (idea-444) dual-edge, edge #1 (complete_work): combine the executor-evidence phase
      // with the attestation gate. A pending verifier-attestation requirement parks the item in
      // `review` until a verifier attests pass — the attest_evidence tail (edge #2) then advances
      // review→done, level-triggered. Only both-satisfied reaches done.
      const gate = evaluateCompletionGate(w);
      const nextPhase: WorkItemPhase = evidencePhase === "done" && gate.attestationReqsSatisfied ? "done" : "review";
      return { ...w, status: nextPhase, evidence: merged, frictionReflections: [...w.frictionReflections, frictionRecord], ...accrueExitingState(w, nowISO), updatedAt: nowISO };
    });
    if (!updated) return null;
    if (!frictionReflection) {
      return {
        ...updated,
        workItem: updated,
        completionBlocked: "friction_reflection_required",
        message: "complete_work accepted valid evidence but did not advance the FSM because frictionReflection is required",
      };
    }
    return { ...updated, workItem: updated };
  }

  // ── SEAL (idea-444) — attest_evidence + verify_attestation ────────────────
  /** SEAL entity-kind normalization (bug-290): entity refs and WorkItem targetRefs may carry
   *  either legacy lowercase kind labels (`bug`) or substrate canonical labels (`Bug`). Existence
   *  resolution and relatedness MUST use the same normalization, otherwise a verifier can resolve
   *  `Bug/bug-N` but fail the targetRef relation against `{kind:"bug", id:"bug-N"}`. Keep this
   *  narrow to entity-ref lookup/comparison; the attestation targetRef hash still snapshots the
   *  exact row value for relocation protection. */
  private canonicalEntityKind(kind: string): string {
    const k = kind.trim().toLowerCase();
    if (k === "bug") return "Bug";
    if (k === "idea") return "Idea";
    if (k === "mission") return "Mission";
    if (k === "workitem" || k === "work-item" || k === "work_item" || k === "review") return "WorkItem";
    if (k === "audit") return "Audit";
    return kind;
  }

  private sameEntityKind(a: string | undefined, b: string | undefined): boolean {
    return !!a && !!b && this.canonicalEntityKind(a) === this.canonicalEntityKind(b);
  }

  /** SEAL (idea-444, steve audit-11832/11839) — pre-fetch each `entity`-kind ref's entity for
   *  existence + relatedness classification. Existence is monotonic, so this async fetch is safe
   *  pre-CAS; the RELATEDNESS decision runs on the fresh `w` inside classifyEvidenceRefs. */
  private async resolveEntityRefs(refs: AttestationEvidenceRef[]): Promise<Map<string, Record<string, unknown> | null>> {
    const map = new Map<string, Record<string, unknown> | null>();
    for (const r of refs) {
      if (r.kind !== "entity") continue;
      const slash = r.ref.indexOf("/");
      if (slash <= 0 || slash === r.ref.length - 1) { map.set(r.ref, null); continue; }
      const kind = r.ref.slice(0, slash);
      const id = r.ref.slice(slash + 1);
      const canonical = this.canonicalEntityKind(kind);
      let ent = await this.substrate.get<Record<string, unknown>>(kind, id);
      if (!ent && canonical !== kind) ent = await this.substrate.get<Record<string, unknown>>(canonical, id);
      map.set(r.ref, ent ?? null);
    }
    return map;
  }

  private async addRevisionAuthorExclusions(item: WorkItem, excluded: Set<string>): Promise<void> {
    if (item.revisedBy?.agentId) excluded.add(item.revisedBy.agentId);
    const logicalId = item.logicalId;
    if (!logicalId) return;
    const family = await this.revisionStorage.getFamily(logicalId);
    if (family?.originalCreatedBy.agentId) excluded.add(family.originalCreatedBy.agentId);
  }

  /** idea-528 / bug-249: resolve the SELF-attestation exclusion set for a verifier-attestation
   *  gate. The laundering risk is the verifier authoring the VERIFIED WORK, not merely driving the
   *  verifier-gate node. Prefer target-work history: an explicit WorkItem targetRef and/or the
   *  parent work item(s) whose completionDependsOn includes this gate. If no target work resolves,
   *  fail safe to the historical gate-node history check. */
  private async selfAttestationExclusionFor(gate: WorkItem): Promise<{ excluded: Set<string>; basis: "target-work" | "gate-node"; targetIds: string[] }> {
    const targets = new Map<string, WorkItem>();
    const targetRefKind = gate.targetRef?.kind.toLowerCase();
    const pin = this.currentness.currentPin();
    const gateIsCurrent = !pin || pin.mode === "legacy" || this.currentness.isCurrent(gate, pin);
    if (gate.targetRef && (targetRefKind === "workitem" || targetRefKind === "work-item" || targetRefKind === "work")) {
      const target = gateIsCurrent
        ? await this.getCurrentProjectionItem(gate.targetRef.id)
        : await this.getWorkItem(gate.targetRef.id); // historical attestation verification stays exact
      if (target) targets.set(gate.targetRef.id, target);
    }
    const parents = gateIsCurrent
      ? await this.parentsAwaitingCompletion(gate.id)
      : (await this.substrate.list<WorkItem>(KIND, {
          filter: { completionDependsOn: { $contains: gate.id } },
          limit: READY_SCAN_CAP,
        })).items.map(cloneWorkItem);
    for (const parent of parents) {
      if (parent.id !== gate.id) targets.set(parent.id, parent);
    }

    const excluded = new Set<string>();
    if (targets.size > 0) {
      for (const target of targets.values()) {
        for (const agentId of target.executorHistory) excluded.add(agentId);
        if (target.createdBy?.agentId) excluded.add(target.createdBy.agentId);
        await this.addRevisionAuthorExclusions(target, excluded);
        if (target.lease?.holder) excluded.add(target.lease.holder);
      }
      return { excluded, basis: "target-work", targetIds: [...targets.keys()].sort() };
    }

    for (const agentId of gate.executorHistory) excluded.add(agentId);
    if (gate.createdBy?.agentId) excluded.add(gate.createdBy.agentId);
    await this.addRevisionAuthorExclusions(gate, excluded);
    if (gate.lease?.holder) excluded.add(gate.lease.holder);
    return { excluded, basis: "gate-node", targetIds: [] };
  }

  /** SEAL — the SINGLE typed-ref validator (steve audit-11839): classify EVERY ref + count the
   *  LOAD-BEARING ones, against the FRESH `item`. Used identically by attest_evidence (throws on
   *  any reason) and verify_attestation (collects reasons) so the two can never drift.
   *   - `evidence`: `ref` must match a concrete submitted `evidence[].ref` (load-bearing).
   *   - `entity` (`Kind/id`): must existence-resolve (pre-fetched in `resolved`) AND be RELATED to
   *     this work — the item's targetRef, or a `refRelatesToWork` audit/review relation — NEVER the
   *     item's own id, NEVER a bare existing entity (that would re-open existence-theatre).
   *   - `external`: non-empty locator; honestly unresolvable server-side; NEVER load-bearing.
   *  Rule: ≥1 load-bearing ref required; every non-passing typed ref is a reason. */
  private classifyEvidenceRefs(
    refs: AttestationEvidenceRef[],
    item: WorkItem,
    resolved: Map<string, Record<string, unknown> | null>,
  ): { reasons: string[]; loadBearing: number } {
    const reasons: string[] = [];
    const evidenceRefSet = new Set<string>(item.evidence.map((e) => e.ref).filter((r): r is string => !!r));
    let loadBearing = 0;
    for (const r of refs) {
      if (r.kind === "evidence") {
        if (evidenceRefSet.has(r.ref)) loadBearing++;
        else reasons.push(`evidence ref '${r.ref}' matches no submitted evidence entry on ${item.id}`);
      } else if (r.kind === "entity") {
        const slash = r.ref.indexOf("/");
        if (slash <= 0 || slash === r.ref.length - 1) { reasons.push(`entity ref '${r.ref}' must be 'Kind/id'`); continue; }
        const kind = r.ref.slice(0, slash);
        const id = r.ref.slice(slash + 1);
        if (id === item.id) { reasons.push(`entity ref '${r.ref}' is the item itself — not load-bearing`); continue; }
        const ent = resolved.get(r.ref) ?? null;
        if (!ent) { reasons.push(`entity ref '${r.ref}' does not resolve`); continue; }
        const isTargetRef = !!item.targetRef && this.sameEntityKind(kind, item.targetRef.kind) && id === item.targetRef.id;
        const canonicalKind = this.canonicalEntityKind(kind);
        const related = isTargetRef
          || (canonicalKind === "Audit" && this.refRelatesToWork("audit", ent, item))
          || (canonicalKind === "WorkItem" && this.refRelatesToWork("review", ent, item));
        if (related) loadBearing++;
        else reasons.push(`entity ref '${r.ref}' resolves but is not related to ${item.id} or its target — existence alone is insufficient (existence-theatre)`);
      }
      // 'external': non-load-bearing, honestly unresolvable; shape already validated by the caller.
    }
    if (loadBearing === 0) reasons.push(`no LOAD-BEARING evidenceRef — need >=1 'evidence' entry match or a related non-self 'entity' ref ('external' refs are never load-bearing)`);
    return { reasons, loadBearing };
  }

  async attestEvidence(
    workId: string,
    requirementId: string,
    verifierId: string,
    verdict: AttestationVerdict,
    evidenceRefs: AttestationEvidenceRef[],
    _note?: string,
  ): Promise<{ item: WorkItem; attestation: Attestation }> {
    if (!this.currentness.currentPin()) {
      return this.withWriterFence(() => this.attestEvidence(workId, requirementId, verifierId, verdict, evidenceRefs, _note));
    }
    // (a) SHAPE validation (sync): non-empty, well-formed typed refs.
    if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
      throw new AttestationRejected("evidenceRefs must be non-empty (criterion #3: no trust-by-prose verdict)");
    }
    for (const r of evidenceRefs) {
      if (!r || typeof r.ref !== "string" || r.ref.trim() === "" || !["evidence", "entity", "external"].includes(r.kind)) {
        throw new AttestationRejected(`malformed evidenceRef ${JSON.stringify(r)} — each is { kind: 'evidence'|'entity'|'external', ref: <non-empty> }`);
      }
    }
    const operationId = failedGateOperationId(workId, requirementId, verifierId, verdict, evidenceRefs);
    const pre = await this.substrate.get<WorkItem>(KIND, workId);
    if (!pre) throw new AttestationRejected(`work item ${workId} not found`);
    const preItem = cloneWorkItem(pre);
    this.currentness.assertCurrent(preItem, this.currentness.currentPin()!);
    // A v2 FAIL is immutable. The exact same operation is a read-only replay; every
    // later same-row attestation (PASS or a different FAIL) is rejected. A legacy
    // active FAIL is already effectively sealed and must be reconciled, not superseded.
    if (preItem.failedGateSeal) {
      if (verdict === "fail" && preItem.failedGateSeal.operationId === operationId) {
        return { item: preItem, attestation: preItem.attestations[requirementId] };
      }
      throw new FailedGateSealedRejected(workId);
    }
    if (hasActiveVerifierFail(preItem)) throw new FailedGateSealedRejected(workId);

    // (b) async ENTITY existence resolution (monotonic — safe pre-CAS; relatedness runs on fresh w).
    const resolved = await this.resolveEntityRefs(evidenceRefs);
    try {
      // (c) ONE CAS: FAIL authority + exact pre-clear receipt + active projection + lease/blocker
      // clear + persist-first exact-holder notice intent are indivisible on the WorkItem row.
      const written = await this.tryCasUpdate(workId, async (w, resourceVersion) => {
        if (w.failedGateSeal) {
          if (verdict === "fail" && w.failedGateSeal.operationId === operationId) throw new IdempotentFailedSeal(w);
          throw new FailedGateSealedRejected(workId);
        }
        if (hasActiveVerifierFail(w)) throw new FailedGateSealedRejected(workId);
        const req = w.evidenceRequirements.find((r) => r.id === requirementId);
        if (!req) throw new AttestationRejected(`requirement '${requirementId}' not found on ${workId}`);
        if (req.evidenceAuthority !== "verifier-attestation") {
          throw new AttestationRejected(`requirement '${requirementId}' is evidenceAuthority=${req.evidenceAuthority ?? "executor-evidence"} — attest_evidence only applies to verifier-attestation requirements`);
        }
        if (verdict === "fail" && w.status !== "review") {
          throw new AttestationRejected(`failed-gate-seal-v2 requires raw phase=review, was ${w.status}`);
        }
        // fold 2 HISTORY exclusion (idea-528): reject only when the verifier authored the VERIFIED
        // work. If no verified work can be resolved, fail safe to the historical gate-node check.
        const selfExclusion = await this.selfAttestationExclusionFor(w);
        if (selfExclusion.excluded.has(verifierId)) {
          const targetSuffix = selfExclusion.basis === "target-work" ? `target work ${selfExclusion.targetIds.join(",")}` : workId;
          throw new AttestationRejected(`verifier ${verifierId} is in the executor/holder/creator history of ${targetSuffix} — self-attestation rejected (fold 2)`);
        }
        const { reasons } = this.classifyEvidenceRefs(evidenceRefs, w, resolved);
        if (reasons.length > 0) throw new AttestationRejected(`evidenceRefs invalid: ${reasons.join("; ")}`);
        const anchor = w.attestationHistory[0];
        if (anchor && anchor.targetRefHash !== hashTargetRef(w.targetRef)) {
          throw new AttestationRejected(`targetRef of ${workId} changed after an attestation exists — relocation rejected (point-at-A-then-move-to-B laundering)`);
        }
        const producedAt = this.clock.now().toISOString();
        const prior = w.attestations[requirementId];
        const attestation: Attestation = {
          requirementId,
          verifierId,
          verdict,
          producedAt,
          evidenceRefs: evidenceRefs.map((r) => ({ ...r })),
          requirementHash: hashRequirement(req),
          targetRefSnapshot: w.targetRef,
          targetRefHash: hashTargetRef(w.targetRef),
          evidenceSetHash: hashEvidenceSet(evidenceRefs),
          ...(prior ? { supersedes: attestationIdentity(prior) } : {}),
        };
        const attestationHistory = [...w.attestationHistory, attestation];
        const attestations = { ...w.attestations, [requirementId]: attestation };

        if (verdict === "fail") {
          const { seal, notice } = buildFailedGateSeal({
            item: w,
            resourceVersion,
            attestation,
            attestationHistoryIndex: w.attestationHistory.length,
            operationId,
            sealedAt: producedAt,
          });
          return {
            ...w,
            // bug-371: the seal is TERMINAL, so store the terminal phase rather than leaving the
            // row at `review` and relying on effectiveDisposition to contradict it later.
            status: "failed_sealed" as const,
            attestationHistory,
            attestations,
            failedGateSeal: seal,
            effectiveDisposition: "failed_sealed" as const,
            pendingFailedSealNotices: notice ? [...(w.pendingFailedSealNotices ?? []), notice] : (w.pendingFailedSealNotices ?? []),
            failedSealNoticePending: notice !== null,
            lease: null,
            blockedOn: null,
            ...accrueExitingState(w, producedAt),
            updatedAt: producedAt,
          };
        }

        // PASS dual-edge: LEAF-only auto-advance. A gated ARC completes only through
        // complete_work, which independently re-checks completionDependsOn.
        if (w.status === "review") {
          // bug-377: `payload` is load-bearing here — the PR-review carve-out keys on it. Passing a
          // narrowed literal without it would silently disable the carve-out on THIS edge only,
          // which is the one-rule-two-call-sites failure this codebase keeps producing.
          const gate = evaluateCompletionGate({ evidenceRequirements: w.evidenceRequirements, attestations, payload: w.payload });
          let executorDone = false;
          try {
            executorDone = evaluateEvidence(w.evidenceRequirements, w.evidence, w.lease, w.type === "verifier-gate", new Set(w.evidence.map(evidenceKey)), priorLeaseFloorFor(w)).nextPhase === "done";
          } catch {
            executorDone = false;
          }
          if (gate.attestationReqsSatisfied && executorDone && w.completionDependsOn.length === 0) {
            return { ...w, attestationHistory, attestations, status: "done" as const, ...accrueExitingState(w, producedAt), updatedAt: producedAt };
          }
        }
        return { ...w, attestationHistory, attestations, updatedAt: producedAt };
      });
      return { item: written!, attestation: written!.attestations[requirementId] };
    } catch (err) {
      if (err instanceof IdempotentFailedSeal) {
        return { item: err.item, attestation: err.item.attestations[requirementId] };
      }
      throw err;
    }
  }

  async verifyAttestation(workId: string, requirementId: string): Promise<AttestationVerification> {
    if (!this.currentness.currentPin()) return this.withReadPin(() => this.verifyAttestation(workId, requirementId));
    const pre = await this.substrate.get<WorkItem>(KIND, workId);
    if (!pre) {
      return { workId, requirementId, valid: false, invalidReasons: [`work item ${workId} not found`], active: null, history: [], legacyReviewEvidencePresent: false };
    }
    const item = cloneWorkItem(pre);
    const req = item.evidenceRequirements.find((r) => r.id === requirementId);
    const active = item.attestations[requirementId] ?? null;
    const history = item.attestationHistory.filter((a) => a.requirementId === requirementId);
    // legacy executor review/audit evidence bound here is NOT-SEAL-grade (never satisfies attestation).
    const legacyReviewEvidencePresent = item.evidence.some((e) => e.requirementId === requirementId && (e.kind === "review" || e.kind === "audit"));
    const invalidReasons: string[] = [];
    if (!req) invalidReasons.push(`requirement '${requirementId}' does not exist`);
    else if (req.evidenceAuthority !== "verifier-attestation") invalidReasons.push(`requirement '${requirementId}' is not evidenceAuthority=verifier-attestation (is ${req.evidenceAuthority ?? "executor-evidence"})`);
    if (!active) invalidReasons.push("no active attestation for this requirement");
    if (active && req) {
      // RECOMPUTE the relocation-guard hashes — never trust the stored values.
      if (active.requirementHash !== hashRequirement(req)) invalidReasons.push("requirementHash mismatch — the requirement descriptor changed after attestation");
      if (active.targetRefHash !== hashTargetRef(item.targetRef)) invalidReasons.push("targetRefHash mismatch — the item's targetRef changed after attestation (relocation)");
      if (active.evidenceSetHash !== hashEvidenceSet(active.evidenceRefs)) invalidReasons.push("evidenceSetHash mismatch — the recorded evidence set is inconsistent");
      const role = await this.resolveAgentRole(active.verifierId);
      if (role !== "verifier") invalidReasons.push(`verifier ${active.verifierId} does not resolve to a verifier role (role=${role ?? "unknown"})`);
      // self-attestation set mirrors attest_evidence: target-work history when resolvable,
      // otherwise fail-safe gate-node history.
      const selfExclusion = await this.selfAttestationExclusionFor(item);
      if (selfExclusion.excluded.has(active.verifierId)) {
        const targetSuffix = selfExclusion.basis === "target-work" ? `target work ${selfExclusion.targetIds.join(",")}` : "gate-node";
        invalidReasons.push(`verifier ${active.verifierId} is in the executor/holder/creator history of ${targetSuffix} (self-attestation)`);
      }
      // RECOMPUTE the exact same typed-ref validation as attest_evidence (drift → invalid).
      const resolved = await this.resolveEntityRefs(active.evidenceRefs);
      invalidReasons.push(...this.classifyEvidenceRefs(active.evidenceRefs, item, resolved).reasons);
    }
    return { workId, requirementId, valid: invalidReasons.length === 0, invalidReasons, active, history, legacyReviewEvidencePresent };
  }

  /** Restart-safe outbox scan. The filter is status-partitioned/index-governed;
   *  exact pending-intent filtering is in memory because JSON-array predicates are
   *  intentionally not added to the substrate query language. Truncation is loud. */
  async listPendingFailedSealNoticeItems(limit = LIST_CAP): Promise<{ items: WorkItem[]; truncated: boolean }> {
    if (!this.currentness.currentPin()) return this.withReadPin(() => this.listPendingFailedSealNoticeItems(limit));
    const cap = Math.min(Math.max(1, limit), LIST_CAP);
    const { items } = await this.substrate.list<WorkItem>(KIND, {
      filter: { "status.failedSealNoticePending": true },
      limit: cap,
    });
    // Persist-first exact-holder intent is historical authority, not current
    // lifecycle authority. A successor must not erase an unprojected notice.
    const pending = items.map(cloneWorkItem).filter((item) =>
      (item.pendingFailedSealNotices ?? []).some((notice) => notice.projectedMessageId === null));
    return { items: pending, truncated: items.length >= cap };
  }

  async markFailedSealNoticeProjected(workId: string, intentId: string, messageId: string): Promise<WorkItem | null> {
    if (!this.currentness.currentPin()) return this.withWriterFence(() => this.markFailedSealNoticeProjected(workId, intentId, messageId));
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt += 1) {
      const row = await this.substrate.getWithRevision<WorkItem>(KIND, workId);
      if (!row) return null;
      const w = cloneWorkItem(row.entity);
      if (!isFailedGateSealed(w)) throw new TransitionRejected(`failed-seal notice projection requires failed-sealed authority on ${workId}`);
      const notices = w.pendingFailedSealNotices ?? [];
      const index = notices.findIndex((notice) => notice.intentId === intentId);
      if (index < 0) throw new TransitionRejected(`failed-seal notice intent ${intentId} does not exist on ${workId}`);
      const current = notices[index];
      if (current.projectedMessageId !== null) {
        if (current.projectedMessageId !== messageId) {
          throw new TransitionRejected(`failed-seal notice intent ${intentId} already projects to ${current.projectedMessageId}, not ${messageId}`);
        }
        return w;
      }
      const next = [...notices];
      const nowISO = this.clock.now().toISOString();
      next[index] = { ...current, projectedMessageId: messageId, projectedAt: nowISO };
      const updated = {
        ...w,
        pendingFailedSealNotices: next,
        failedSealNoticePending: next.some((notice) => notice.projectedMessageId === null),
        updatedAt: nowISO,
      };
      const cas = await this.substrate.putIfMatch(KIND, updated, row.resourceVersion);
      if (cas.ok) return cloneWorkItem(updated);
    }
    throw new Error(`[WorkItemRepositorySubstrate] failed-seal notice projection exhausted ${MAX_CAS_RETRIES} retries on ${workId}`);
  }

  // ── Lease-expiry sweep surface (sub-PR-4a) ────────────────────────────────

  /**
   * List lease-held items whose lease has EXPIRED (status.lease.expiresAt < nowISO).
   * The bucket-prefixed dotted path is an ISO-8601 lexicographic range — text-compare
   * is chronological for same-format UTC-Z timestamps (safe; NOT the bug-174 numeric
   * class). Decodes via cloneWorkItem, so a bare row throws BareEnvelopeError here (the
   * sweeper's cal-84 belt catches + escalates).
   */
  async listExpiredLeaseItems(nowISO: string, limit: number): Promise<WorkItem[]> {
    if (!this.currentness.currentPin()) return this.withReadPin(() => this.listExpiredLeaseItems(nowISO, limit));
    const current = await this.currentGenerationItems(this.currentness.currentPin()!);
    if (current) {
      return current.filter((item) => LEASE_HELD_PHASES.includes(item.status) && !!item.lease && item.lease.expiresAt < nowISO).slice(0, limit);
    }
    const { items } = await this.substrate.list<WorkItem>(KIND, {
      filter: { status: { $in: [...LEASE_HELD_PHASES] }, "status.lease.expiresAt": { $lt: nowISO } },
      limit,
    });
    return this.currentness.filterCurrent(items.map(cloneWorkItem), this.currentness.currentPin()!);
  }

  /**
   * Expire ONE item's lease under CAS (sub-PR-4a). Re-checks expiry on the FRESH row,
   * so the renew-vs-sweeper race is a CAS one-winner: a renew that bumped expiresAt (or a
   * release/complete that changed phase) between the list and this CAS → "skipped", never
   * a double-action. Otherwise increments the per-ITEM poison counter and either re-queues
   * to ready (leaseExpiryCount < poisonCap) or POISON-ABANDONS (>= poisonCap). The lease
   * is cleared either way (a re-claim mints a fresh token → the old holder is token-fenced).
   */
  async expireLease(workId: string, nowISO: string, poisonCap: number): Promise<"requeued" | "abandoned" | "failed_sealed" | "skipped"> {
    if (!this.currentness.currentPin()) return this.withWriterFence(() => this.expireLease(workId, nowISO, poisonCap));
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<WorkItem>(KIND, workId);
      if (!existing) return "skipped";
      const w = cloneWorkItem(existing.entity);
      this.currentness.assertCurrent(w, this.currentness.currentPin()!);
      // race-safe re-check: only sweep an item that is STILL lease-held AND still expired.
      if (!LEASE_HELD_PHASES.includes(w.status) || !w.lease || w.lease.expiresAt >= nowISO) {
        return "skipped";
      }

      // failed-gate-seal-v2 LEGACY RECONCILIATION RUNS BEFORE raw-phase sweep logic.
      // An active verifier FAIL is effective terminality even without a v2 receipt; it
      // can never fall through to review→ready. The same CAS backfills the receipt,
      // clears the obsolete lease/blocker, and persists the exact-holder outbox intent.
      if (hasActiveVerifierFail(w)) {
        if (w.failedGateSeal) return "skipped"; // born-native seals clear the lease; defensive only
        const requirementId = w.evidenceRequirements
          .filter((req) => req.evidenceAuthority === "verifier-attestation" && w.attestations[req.id]?.verdict === "fail")
          .map((req) => req.id)
          .sort()[0];
        const attestation = w.attestations[requirementId];
        const historyIndex = w.attestationHistory.findIndex((candidate) => attestationIdentity(candidate) === attestationIdentity(attestation));
        if (historyIndex < 0) {
          throw new Error(`[WorkItemRepositorySubstrate] legacy active FAIL projection ${workId}/${requirementId} has no append-only history row; refusing sweep`);
        }
        const operationId = hashCanonicalDomain("failed-gate-legacy-reconcile-v2", {
          workId, attestationId: attestationIdentity(attestation),
        });
        const { seal, notice } = buildFailedGateSeal({
          item: w,
          resourceVersion: existing.resourceVersion,
          attestation,
          attestationHistoryIndex: historyIndex,
          operationId,
          sealedAt: nowISO,
        });
        const next: WorkItem = {
          ...w,
          // bug-371: terminal phase stored at seal time — see the sibling seal path above.
          status: "failed_sealed",
          failedGateSeal: seal,
          effectiveDisposition: "failed_sealed",
          pendingFailedSealNotices: notice ? [...(w.pendingFailedSealNotices ?? []), notice] : (w.pendingFailedSealNotices ?? []),
          failedSealNoticePending: notice !== null,
          lease: null,
          blockedOn: null,
          ...accrueExitingState(w, nowISO),
          updatedAt: nowISO,
        };
        const result = await this.substrate.putIfMatch(KIND, next, existing.resourceVersion);
        if (result.ok) return "failed_sealed";
        continue;
      }

      // audit-4103 #3: only claimed/in_progress lapses accrue item-poison. review/blocked
      // re-queue WITHOUT incrementing → never terminal-abandon (evidence preserved on
      // re-queue, so a parked review item that loses its holder is recoverable, not lost).
      const poisonEligible = POISON_ELIGIBLE_PHASES.includes(w.status);
      const nextCount = poisonEligible ? w.leaseExpiryCount + 1 : w.leaseExpiryCount;
      const poisoned = poisonEligible && nextCount >= poisonCap;
      const accrued = accrueExitingState(w, nowISO);
      const next: WorkItem = poisoned
        ? { ...w, status: "abandoned", lease: null, blockedOn: null, leaseExpiryCount: nextCount, ...accrued, updatedAt: nowISO }
        : { ...w, status: "ready", lease: null, blockedOn: null, leaseExpiryCount: nextCount, ...accrued, updatedAt: nowISO };
      const result = await this.substrate.putIfMatch(KIND, next, existing.resourceVersion);
      if (result.ok) return poisoned ? "abandoned" : "requeued";
      // revision-mismatch → re-read + re-check (a concurrent renew may now make it not-expired)
    }
    throw new Error(`[WorkItemRepositorySubstrate] expireLease exhausted ${MAX_CAS_RETRIES} retries on ${workId}`);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Evidence-relevance (audit-4103 #1): does the resolved OIS-internal entity RELATE to
   * this work-item or its targetRef (not merely exist)?
   *   - audit→Audit: Audit.relatedEntity (spec.relatedEntity, governed) ∈ {workId, targetRef.id}
   *     (an audit can legitimately be about the work OR its target).
   *   - review→WorkItem: the verifier-gate's targetRef.id === workId STRICTLY (the gate
   *     reviews THIS work, not its target — `=== workId`, not the {workId,targetRef} set,
   *     which would let the item's own id self-satisfy) AND the gate is phase=done (the
   *     review actually completed; audit-4103 #2-optional).
   */
  private refRelatesToWork(evidenceKind: EvidenceKind, resolved: Record<string, unknown>, item: WorkItem): boolean {
    const targetId = item.targetRef?.id;
    if (evidenceKind === "audit") {
      const related = (resolved.spec as { relatedEntity?: unknown } | undefined)?.relatedEntity;
      return related === item.id || (targetId != null && related === targetId);
    }
    if (evidenceKind === "review") {
      const gate = cloneWorkItem(resolved as unknown as WorkItem);
      return gate.targetRef?.id === item.id && gate.status === "done";
    }
    return false;
  }

  /** Resolve an Agent's role from the substrate (audit-4103 #2). Reads the governed
   *  Agent envelope path spec.role (Agent.role → spec.role). null if absent. */
  private async resolveAgentRole(agentId: string): Promise<string | null> {
    const a = await this.substrate.get<Record<string, unknown>>("Agent", agentId);
    if (!a) return null;
    return ((a.spec as { role?: string } | undefined)?.role) ?? null;
  }

  /** Count this agent's in-flight (lease-held WIP-phase) items, scanning at most
   *  `cap` rows — we only need the >=cap boundary, not the full total. The single
   *  source of the WIP-cap predicate, shared by claimWorkItem (the claim authority)
   *  and the agent-scoped listReadyForRole projection (idea-353 WI-2.1 / audit-4265),
   *  so the claimable digest cannot over-report relative to claim_work. */
  private async inFlightCount(agentId: string, cap: number): Promise<number> {
    const pin = this.currentness.currentPin();
    if (pin?.mode === "generation") {
      const current = await this.currentGenerationItems(pin) ?? [];
      return current.filter((item) => WIP_PHASES.includes(item.status) && item.lease?.holder === agentId && !isFailedGateSealed(item)).slice(0, cap).length;
    }
    const { items } = await this.substrate.list<WorkItem>(KIND, {
      filter: { status: { $in: [...WIP_PHASES] }, "status.lease.holder": agentId },
      // A legacy active FAIL may still carry an obsolete lease until reconciliation;
      // scan broadly enough to exclude that effective-terminal row without consuming WIP.
      limit: LIST_CAP,
    });
    return items.map(cloneWorkItem).filter((item) => !isFailedGateSealed(item)).slice(0, cap).length;
  }

  /** Resolve each dependency's phase; return the ids NOT in phase=done (audit-4085 #1).
   *  An ABSENT dep counts as unmet (fail-CLOSED). done is terminal so the result is
   *  stable across the subsequent CAS. */
  private async unmetDependencies(depIds: string[]): Promise<string[]> {
    const unmet: string[] = [];
    for (const depId of depIds) {
      const dep = await this.getCurrentProjectionItem(depId);
      if (!dep || dep.status !== "done") unmet.push(depId);
    }
    return unmet;
  }

  /** Holder + token guard for lease-bound verbs (audit-4082 #1/#4). A non-holder OR a
   *  stale token (after a lease-expiry-requeue or a fresh re-claim) REJECTS — even for
   *  the SAME agentId — fencing a zombie old-process. Fail-CLOSED, row unchanged. */
  private assertNotFailedSealed(w: WorkItem): void {
    if (isFailedGateSealed(w)) throw new FailedGateSealedRejected(w.id);
  }

  private assertLease(w: WorkItem, agentId: string, leaseToken: string, verb: string): void {
    this.assertNotFailedSealed(w);
    if (w.lease?.holder !== agentId) {
      throw new TransitionRejected(`${verb} requires the lease-holder (${w.lease?.holder ?? "none"}), not ${agentId}`);
    }
    if (w.lease?.token !== leaseToken) {
      throw new TransitionRejected(`${verb} rejected: stale lease token (held by ${agentId} but token does not match the current lease)`);
    }
  }

  /**
   * True per-row CAS (Design v1.4 getWithRevision + putIfMatch). Decode→transform→
   * putIfMatch(expectedRevision); on revision-mismatch refetch + retry. Returns the
   * updated (re-decoded) WorkItem on success, null if absent. A TransitionRejected /
   * WipCapExceeded thrown by the transform propagates (the policy layer maps it).
   */
  /** W1 (idea-446 / work-181): sweeper-only direct write of the node-native pulse
   *  bookkeeping. Mirrors the Mission `updatePulseBookkeeping` — CAS-safe (the
   *  transform preserves everything else; the pulse subtree is status-partitioned
   *  so decodeEnvelopeToFlat round-trips it), no authz gate (the system sweeper is
   *  the writer). No-op when the node carries no `nodeConfig.pulse`. */
  async updateNodePulseBookkeeping(
    nodeId: string,
    delta: { lastFiredAt?: string; lastResponseAt?: string | null; missedCount?: number; lastEscalatedAt?: string | null },
  ): Promise<void> {
    await this.tryCasUpdate(nodeId, (w) => {
      const pulse = w.nodeConfig?.pulse;
      if (!pulse) return w; // no node pulse → CAS no-op
      return {
        ...w,
        nodeConfig: {
          ...w.nodeConfig,
          pulse: {
            ...pulse,
            lastFiredAt: delta.lastFiredAt ?? pulse.lastFiredAt,
            lastResponseAt: delta.lastResponseAt !== undefined ? delta.lastResponseAt : pulse.lastResponseAt,
            missedCount: delta.missedCount !== undefined ? delta.missedCount : pulse.missedCount,
            lastEscalatedAt: delta.lastEscalatedAt !== undefined ? delta.lastEscalatedAt : pulse.lastEscalatedAt,
          },
        },
      };
    });
  }

  /**
   * bug-371 — MIGRATION: give every seal-failed row the real terminal phase.
   *
   * WHY A MIGRATION AT ALL, and it is not a preference: list filters are pushed DOWN to
   * `substrate.list` and evaluated against the STORED phase before decode runs. A derived field
   * (`effectiveDisposition`, or work-505's `projectSealedStatus`) can therefore fix a DISPLAY and
   * never a FILTER. Making filter and display agree means writing the rows.
   *
   * AUTHORITY (architect ruling 2026-07-25, verifier-measured): the retained-FAIL constraint
   * protects the VERDICT — attestations, attestationHistory, failedGateSeal, evidence — not the
   * lifecycle field. The verifier's baseline hashes exactly those four; `status` is not in the
   * hashed object, so this write leaves his baseline byte-identical. The transform below touches
   * `status` ALONE and is written so that is checkable by reading it.
   *
   * IDEMPOTENT and re-runnable: a row already at the terminal phase is skipped, so a retried
   * rollout is a no-op rather than a second rewrite. `matched` and `written` are reported
   * SEPARATELY — a migration that reports only "done" cannot tell a retry from a first run.
   *
   * REFUSES LOUDLY rather than skipping quietly: a row that reads as sealed but carries neither a
   * `failedGateSeal` nor an active verifier FAIL is not a shape this migration understands, and
   * silently passing over it would hide exactly the case worth seeing.
   */
  async migrateSealedRowsToFailedPhase(opts: { dryRun?: boolean } = {}): Promise<{
    scanned: number;
    matched: number;
    migrated: Array<{ id: string; before: WorkItemPhase; after: WorkItemPhase }>;
    skipped: string[];
    truncated: boolean;
    dryRun: boolean;
  }> {
    const dryRun = opts.dryRun === true;
    // 🔴 THE SCAN POPULATION IS THE WHOLE WorkItem TABLE, NOT THE ROWS WE INTEND TO CHANGE.
    // The first version called `listWorkItems()` once — a single LIST_CAP-limited read — and I
    // waved it through as "inert at n=12". n=12 IS THE MATCH COUNT. The corpus is 500+ and capped,
    // the target rows sort beyond the cap, and the production dry run scanned 500 rows, matched
    // ZERO and reported `truncated: true`. It never reached them.
    //
    // NO TARGETED QUERY IS POSSIBLE, MEASURED: `effectiveDisposition` is assigned during DECODE
    // (see decodeWorkItem) and is NOT stored, while `substrate.list` filters are evaluated in the
    // storage layer BEFORE decode. `failedGateSeal` IS stored but is null on the pre-v2 population
    // this migration exists for, and `status.phase` only becomes terminal AFTER this runs — the one
    // stored marker that would select them is the value being written. So the scan must be
    // EXHAUSTIVE, and exhaustiveness has to come from paging rather than from a predicate.
    const items: WorkItem[] = [];
    let truncated = false;
    for (let offset = 0; ; offset += MIGRATION_PAGE_SIZE) {
      const page = await this.substrate.list<WorkItem>(KIND, { limit: MIGRATION_PAGE_SIZE, offset });
      items.push(...page.items.map(cloneWorkItem));
      // A SHORT PAGE IS THE ONLY CORRECT TERMINATION SIGNAL — a full page tells you nothing about
      // whether more rows exist. Guard the pathological case where the substrate keeps returning
      // full pages forever rather than looping unbounded.
      if (page.items.length < MIGRATION_PAGE_SIZE) break;
      if (items.length >= MIGRATION_MAX_SCAN) { truncated = true; break; }
    }
    const migrated: Array<{ id: string; before: WorkItemPhase; after: WorkItemPhase }> = [];
    const skipped: string[] = [];
    let matched = 0;
    for (const item of items) {
      // THE SAME PREDICATE THE READ PATH USES — one definition, two call sites. It matches only a
      // sealed row whose STORED phase is `ready`, which is precisely bug-371's defect. Sealed rows
      // stored `abandoned` or `paused` are deliberately NOT matched and NOT written: they do not
      // misrepresent themselves, and rewriting them would destroy provenance (abandoned) or mutate
      // a lifecycle (paused). An already-migrated row stores `failed_sealed`, so it fails this too
      // and the migration stays idempotent without needing a separate check.
      if (!misrepresentsAsClaimable(item)) { skipped.push(item.id); continue; }
      matched += 1;
      // loud refusal on an unrecognised sealed shape — see the doc comment
      if (item.failedGateSeal == null && !hasActiveVerifierFail(item)) {
        throw new Error(
          `[bug-371 migration] ${item.id} reads as sealed but carries neither failedGateSeal nor an ` +
          `active verifier FAIL — unrecognised shape, refusing to write. Investigate before re-running.`,
        );
      }
      const before = item.status;
      if (dryRun) {
        // COLLECT-MODE: report exactly what a real run would write, with zero effects. The loud
        // shape-refusal above still fires, so a dry run surfaces an unrecognised row BEFORE the
        // deploy rather than during it.
        migrated.push({ id: item.id, before, after: "failed_sealed" });
        continue;
      }
      // status ALONE. Every other field, including all four protected ones, is carried by spread.
      const updated = await this.tryCasUpdate(item.id, (w) => ({ ...w, status: "failed_sealed" as const }));
      if (updated) migrated.push({ id: item.id, before, after: updated.status });
    }
    return { scanned: items.length, matched, migrated, skipped, truncated, dryRun };
  }

  private async tryCasUpdate(
    workId: string,
    transform: (current: WorkItem, resourceVersion: string) => WorkItem | Promise<WorkItem>,
  ): Promise<WorkItem | null> {
    if (!this.currentness.currentPin()) return this.withWriterFence(() => this.tryCasUpdate(workId, transform));
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<WorkItem>(KIND, workId);
      if (!existing) return null;
      const current = cloneWorkItem(existing.entity);
      this.currentness.assertCurrent(current, this.currentness.currentPin()!);
      const next = await transform(current, existing.resourceVersion);
      const result = await this.substrate.putIfMatch(KIND, next, existing.resourceVersion);
      if (result.ok) {
        console.log(`[WorkItemRepositorySubstrate] WorkItem ${workId} → ${next.status}`);
        return cloneWorkItem(next);
      }
      // revision-mismatch → another writer won; refetch + retry
    }
    throw new Error(`[WorkItemRepositorySubstrate] tryCasUpdate exhausted ${MAX_CAS_RETRIES} retries on ${workId}`);
  }
}
