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
  WorkItemPhase,
  StateDurations,
  WorkItemType,
  WorkItemPriority,
  WorkItemLease,
  WorkItemBlockedOn,
  EvidenceRequirement,
  EvidenceItem,
  EvidenceKind,
  WorkItemReference,
  ReadyEmptyReason,
  StintProjection,
  StintChild,
  LegalMoves,
  LegalMove,
  WorkItemVerb,
  IWorkItemStore,
  Attestation,
  AttestationVerdict,
  AttestationVerification,
  AttestationEvidenceRef,
} from "./work-item.js";
import { DEFAULT_STATE_DURATIONS, evaluateCompletionGate } from "./work-item.js";
import { SubstrateCounter } from "./substrate-counter.js";
import { withAdvisoryLock, LOCK_CLASS } from "../storage-substrate/advisory-lock.js";
import { decodeEnvelopeToFlat } from "./shape-helpers.js";

const KIND = "WorkItem";
const LIST_CAP = 500;
/** The substrate hard-clamps list() to 500 rows; the ready-scan uses it as the cap and
 *  flags truncation when hit (list_ready_work is truncation-HONEST, audit-4070 #3). */
const READY_SCAN_CAP = 500;
const MAX_CAS_RETRIES = 50;

/** The lease TTL (claim sets expiresAt = claimedAt + this; renewLease re-extends).
 *  A tunable knob — the sub-PR-4 lease-expiry sweeper re-queues past expiresAt.
 *  15 min default; flagged to architect for confirmation against the sweeper design. */
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
 *   #5 no-double-count (structural: one entry names one requirementId)
 *   #6 empty-req floor (>=1 freeform evidence; no silent zero-evidence close)
 */
function evaluateEvidence(
  requirements: EvidenceRequirement[],
  evidence: EvidenceItem[],
  lease: WorkItemLease | null,
  isVerifierGate: boolean,
  priorKeys: ReadonlySet<string>,
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
      req.allowPreClaim || priorKeys.has(evidenceKey(e)) || (claimedAt != null && producedAtOnOrAfter(e.producedAt, claimedAt)));
    if (fresh.length === 0) {
      throw new EvidencePredicateFailed(`requirement '${req.id}' evidence failed freshness (producedAt before lease.claimedAt=${claimedAt}; only the requirement author can waive this via the requirement-level allowPreClaim flag)`);
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

export class WorkItemRepositorySubstrate implements IWorkItemStore {
  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly counter: SubstrateCounter,
  ) {}

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
    createdBy?: EntityProvenance;
  }): Promise<WorkItem> {
    const num = await this.counter.next("workItemCounter");
    const id = `work-${num}`;
    const now = new Date().toISOString();
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
      status: "ready",
      lease: null,
      evidence: [],
      blockedOn: null,
      leaseExpiryCount: 0,
      // work-98 (idea-384 Part A): birth-stamp the timer — entered `ready` at createdAt, zero buckets.
      enteredCurrentStateAt: now,
      stateDurations: { ...DEFAULT_STATE_DURATIONS },
      // SEAL (idea-444): birth-empty the attestation subtree + executor history.
      attestationHistory: [],
      attestations: {},
      executorHistory: [],
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
   *    - dependsOn appends only while ready (re-gating is the intended
   *      effect); completionDependsOn appends until done (arc accretion);
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
    const setKeys = Object.keys(mutation.set ?? {});
    const hasAppends = (mutation.appendDependsOn?.length ?? 0) + (mutation.appendCompletionDependsOn?.length ?? 0) + (mutation.appendReferences?.length ?? 0) > 0;
    if (setKeys.length === 0 && !hasAppends) {
      throw new TransitionRejected("update rejected: empty mutation (no set fields, no appends) — a no-op update is a caller bug");
    }
    const existing = await this.substrate.getWithRevision<WorkItem>(KIND, workId);
    if (!existing) throw new TransitionRejected(`update rejected: WorkItem ${workId} does not resolve`);
    const before = cloneWorkItem(existing.entity);
    // Authority: author or architect (the ratified model — no lease-holder writes in v1).
    if (before.createdBy?.agentId !== actor.agentId && actor.role !== "architect") {
      throw new TransitionRejected(`update rejected: ${actor.role}/${actor.agentId} is neither the item's author (${before.createdBy?.agentId}) nor an architect — the ratified authority model is author+architect`);
    }
    if (before.status === "done" || before.status === "abandoned") {
      throw new TransitionRejected(`update rejected: ${workId} is terminal (${before.status}) — terminal items reject all mutation`);
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
    next.updatedAt = new Date().toISOString();
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
    createdBy?: EntityProvenance;
  }): Promise<{ item: WorkItem; created: boolean }> {
    const now = new Date().toISOString();
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
      status: "ready",
      lease: null,
      evidence: [],
      blockedOn: null,
      leaseExpiryCount: 0,
      // work-98 (idea-384 Part A): birth-stamp the timer — entered `ready` at createdAt, zero buckets.
      enteredCurrentStateAt: now,
      stateDurations: { ...DEFAULT_STATE_DURATIONS },
      // SEAL (idea-444): birth-empty the attestation subtree + executor history.
      attestationHistory: [],
      attestations: {},
      executorHistory: [],
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
    await this.substrate.delete(KIND, workId);
  }

  async getWorkItem(workId: string): Promise<WorkItem | null> {
    const w = await this.substrate.get<WorkItem>(KIND, workId);
    return w ? cloneWorkItem(w) : null;
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
      const child = await this.substrate.get<WorkItem>(KIND, childId);
      if (!child || cloneWorkItem(child).status !== "done") pending.push(childId);
    }
    return { done: completionDependsOn.length - pending.length, total: completionDependsOn.length, pending };
  }

  /** The opt-in get_work projection (FR — feeds the cold-start get_current_stint). Reads
   *  the arc fresh, then projects its completion-gate progress. null if the arc is gone. */
  async getCompletionProgress(workId: string): Promise<{ done: number; total: number; pending: string[] } | null> {
    const w = await this.getWorkItem(workId);
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
  async getStintProjection(workId: string): Promise<StintProjection | null> {
    const arc = await this.getWorkItem(workId);
    if (!arc) return null;
    const children: StintChild[] = [];
    for (const childId of arc.completionDependsOn) {
      const child = await this.substrate.get<WorkItem>(KIND, childId);
      if (!child) {
        children.push({ id: childId, status: "missing", leaseHolder: null, stateDurations: { ...DEFAULT_STATE_DURATIONS } });
      } else {
        const flat = cloneWorkItem(child);
        children.push({ id: childId, status: flat.status, leaseHolder: flat.lease?.holder ?? null, stateDurations: flat.stateDurations });
      }
    }
    const countOf = (s: string) => children.filter((c) => c.status === s).length;
    const total = children.length;
    const done = countOf("done");
    const statusCounts: Record<string, number> = {
      ready: countOf("ready"), claimed: countOf("claimed"), in_progress: countOf("in_progress"),
      blocked: countOf("blocked"), review: countOf("review"), done, abandoned: countOf("abandoned"),
      missing: countOf("missing"),
    };
    // work-99 (idea-384 Part B): the recursive SUBTREE rollup (leaves-only, DAG-deduped) + the
    // arc's OWN active span + the parallelism factor. ownActiveMs EXCLUDES ready (queue-wait) so
    // parallelism measures concurrency vs the ACTIVE span, not vs total-elapsed; null when there
    // is no active span (no div-by-zero — honest null).
    const rolledUpDurations = await this.rollupLeafDurations(arc.id);
    const ownActiveMs = arc.stateDurations.claimed + arc.stateDurations.in_progress + arc.stateDurations.blocked + arc.stateDurations.review;
    const parallelism = ownActiveMs > 0 ? rolledUpDurations.in_progress / ownActiveMs : null;
    return {
      arcId: arc.id,
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
    };
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
      const node = await this.substrate.get<WorkItem>(KIND, id);
      if (!node) return; // vanished — skip; never silently mis-attribute
      const flat = cloneWorkItem(node);
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
    const w = await this.getWorkItem(workId);
    if (!w) return null;
    const status = w.status;
    const isHolder = !!w.lease && w.lease.holder === caller.agentId;
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

    return { workId: w.id, status, isHolder, gateMet, moves };
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
    const { items } = await this.substrate.list<WorkItem>(KIND, { filter: { status: "ready" }, limit: READY_SCAN_CAP });
    const truncated = items.length >= READY_SCAN_CAP;
    const ready = items.map(cloneWorkItem);
    const eligible = role
      ? ready.filter((w) => w.roleEligibility.length === 0 || w.roleEligibility.includes(role))
      : ready;
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
          if (w.status !== "ready") throw new TransitionRejected(`claim requires ready, was ${w.status}`);
          assertRoleEligible(w, role); // (a) role ∈ roleEligibility (empty = any-role)
          if (depsNotDone.length > 0) { // (b) all dependsOn must be phase=done
            throw new ClaimRejected(`dependencies not done: ${depsNotDone.join(", ")}`);
          }
          const now = new Date();
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
      const nowISO = new Date().toISOString();
      return { ...w, status: "in_progress", ...accrueExitingState(w, nowISO), updatedAt: nowISO };
    });
  }

  async blockWork(workId: string, agentId: string, leaseToken: string, blockedOn: WorkItemBlockedOn): Promise<WorkItem | null> {
    return this.tryCasUpdate(workId, (w) => {
      this.assertLease(w, agentId, leaseToken, "block");
      if (w.status !== "in_progress") throw new TransitionRejected(`block requires in_progress, was ${w.status}`);
      const nowISO = new Date().toISOString();
      return { ...w, status: "blocked", blockedOn, ...accrueExitingState(w, nowISO), updatedAt: nowISO };
    });
  }

  async resumeWork(workId: string, agentId: string, leaseToken: string): Promise<WorkItem | null> {
    return this.tryCasUpdate(workId, (w) => {
      this.assertLease(w, agentId, leaseToken, "resume");
      if (w.status !== "blocked") throw new TransitionRejected(`resume requires blocked, was ${w.status}`);
      const nowISO = new Date().toISOString();
      return { ...w, status: "in_progress", blockedOn: null, ...accrueExitingState(w, nowISO), updatedAt: nowISO };
    });
  }

  /** Heartbeat-extend the lease without changing phase (crash-gap vs slow-progress
   *  stays orthogonal to state). Legal in any lease-held phase. */
  async renewLease(workId: string, agentId: string, leaseToken: string): Promise<WorkItem | null> {
    const renewed = await this.tryCasUpdate(workId, (w) => {
      this.assertLease(w, agentId, leaseToken, "renew");
      if (!LEASE_HELD_PHASES.includes(w.status)) throw new TransitionRejected(`renew requires a held lease, was ${w.status}`);
      const now = new Date();
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
    const pre = await this.getWorkItem(arcId);
    if (!pre?.lease) return; // nothing held to keep alive
    if (pre.lease.expiresAt < new Date().toISOString()) return; // already-expired → sweeper's; never resurrect
    await this.tryCasUpdate(arcId, (w) => {
      const now = new Date();
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
      const nowISO = new Date().toISOString();
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
      if (w.status !== "blocked") {
        throw new TransitionRejected(`systemUnblock requires blocked, was ${w.status}`);
      }
      if (!w.blockedOn?.blockerIds?.includes(decisionRef)) {
        throw new TransitionRejected(`systemUnblock rejected: ${workId} is not blocked on ${decisionRef} (blockers: [${w.blockedOn?.blockerIds?.join(", ") ?? ""}]) — a decision only unblocks what waits on it`);
      }
      const nowISO = new Date().toISOString();
      return { ...w, status: "in_progress", blockedOn: null, ...accrueExitingState(w, nowISO), updatedAt: nowISO };
    });
  }

  async abandonWork(workId: string, agentId: string, opts?: { reason?: string; leaseToken?: string }): Promise<WorkItem | null> {
    return this.tryCasUpdate(workId, (w) => {
      const isHolderWithToken = w.lease?.holder === agentId && w.lease?.token === opts?.leaseToken;
      const isCreator = w.createdBy?.agentId === agentId;
      if (!isHolderWithToken && !isCreator) {
        throw new TransitionRejected(`abandon requires the lease-holder (with matching token) or the creator, not ${agentId}`);
      }
      if (!RELEASABLE_PHASES.includes(w.status) && !(w.status === "ready" && isCreator)) {
        throw new TransitionRejected(`abandon requires an active claim (or the creator from ready), was ${w.status}`);
      }
      const nowISO = new Date().toISOString();
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
  async completeWork(workId: string, agentId: string, leaseToken: string, evidence: EvidenceItem[]): Promise<WorkItem | null> {
    const pre = await this.substrate.get<WorkItem>(KIND, workId);
    if (!pre) return null;
    const item = cloneWorkItem(pre);
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
    const plan = evaluateEvidence(item.evidenceRequirements, mergeEvidence(item.evidence, evidence), item.lease, isVerifierGate, new Set(item.evidence.map(evidenceKey)));
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
    // then store the merged evidence + transition atomically.
    return this.tryCasUpdate(workId, (w) => {
      this.assertLease(w, agentId, leaseToken, "complete");
      if (!COMPLETABLE_PHASES.includes(w.status)) throw new TransitionRejected(`complete requires in_progress or review, was ${w.status}`);
      const merged = mergeEvidence(w.evidence, evidence);
      const { nextPhase: evidencePhase } = evaluateEvidence(w.evidenceRequirements, merged, w.lease, w.type === "verifier-gate", new Set(w.evidence.map(evidenceKey)));
      // SEAL (idea-444) dual-edge, edge #1 (complete_work): combine the executor-evidence phase
      // with the attestation gate. A pending verifier-attestation requirement parks the item in
      // `review` until a verifier attests pass — the attest_evidence tail (edge #2) then advances
      // review→done, level-triggered. Only both-satisfied reaches done.
      const gate = evaluateCompletionGate(w);
      const nextPhase: WorkItemPhase = evidencePhase === "done" && gate.attestationReqsSatisfied ? "done" : "review";
      const nowISO = new Date().toISOString();
      return { ...w, status: nextPhase, evidence: merged, ...accrueExitingState(w, nowISO), updatedAt: nowISO };
    });
  }

  // ── SEAL (idea-444) — attest_evidence + verify_attestation ────────────────
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
      map.set(r.ref, (await this.substrate.get<Record<string, unknown>>(kind, id)) ?? null);
    }
    return map;
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
        const isTargetRef = !!item.targetRef && kind === item.targetRef.kind && id === item.targetRef.id;
        const ek = kind.toLowerCase();
        const related = isTargetRef
          || (ek === "audit" && this.refRelatesToWork("audit", ent, item))
          || ((ek === "workitem" || ek === "review") && this.refRelatesToWork("review", ent, item));
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
    // (a) SHAPE validation (sync): non-empty, well-formed typed refs.
    if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
      throw new AttestationRejected("evidenceRefs must be non-empty (criterion #3: no trust-by-prose verdict)");
    }
    for (const r of evidenceRefs) {
      if (!r || typeof r.ref !== "string" || r.ref.trim() === "" || !["evidence", "entity", "external"].includes(r.kind)) {
        throw new AttestationRejected(`malformed evidenceRef ${JSON.stringify(r)} — each is { kind: 'evidence'|'entity'|'external', ref: <non-empty> }`);
      }
    }
    const pre = await this.substrate.get<WorkItem>(KIND, workId);
    if (!pre) throw new AttestationRejected(`work item ${workId} not found`);
    // (b) async ENTITY existence resolution (monotonic — safe pre-CAS; relatedness runs on fresh w).
    const resolved = await this.resolveEntityRefs(evidenceRefs);
    // (c) CAS: derive requirement/hashes/HISTORY/ref-validation ALL from the FRESH w (steve
    //     audit-11832 #1: closes the first-attestation relocation TOCTOU — an attestation built
    //     from a stale pre-read must never be merged onto a moved row / auto-advance).
    const written = await this.tryCasUpdate(workId, (w) => {
      const req = w.evidenceRequirements.find((r) => r.id === requirementId);
      if (!req) throw new AttestationRejected(`requirement '${requirementId}' not found on ${workId}`);
      if (req.evidenceAuthority !== "verifier-attestation") {
        throw new AttestationRejected(`requirement '${requirementId}' is evidenceAuthority=${req.evidenceAuthority ?? "executor-evidence"} — attest_evidence only applies to verifier-attestation requirements`);
      }
      // fold 2 HISTORY exclusion — executorHistory ∪ {creator, current holder}, from the fresh w.
      const excluded = new Set<string>(w.executorHistory);
      if (w.createdBy?.agentId) excluded.add(w.createdBy.agentId);
      if (w.lease?.holder) excluded.add(w.lease.holder);
      if (excluded.has(verifierId)) {
        throw new AttestationRejected(`verifier ${verifierId} is in the executor/holder/creator history of ${workId} — self-attestation rejected (fold 2)`);
      }
      // typed-ref validation against the fresh w (steve audit-11839): every ref validated, ≥1 load-bearing.
      const { reasons } = this.classifyEvidenceRefs(evidenceRefs, w, resolved);
      if (reasons.length > 0) throw new AttestationRejected(`evidenceRefs invalid: ${reasons.join("; ")}`);
      // relocation anchor guard (belt): a prior attestation stamped for a different targetRef.
      const anchor = w.attestationHistory[0];
      if (anchor && anchor.targetRefHash !== hashTargetRef(w.targetRef)) {
        throw new AttestationRejected(`targetRef of ${workId} changed after an attestation exists — relocation rejected (point-at-A-then-move-to-B laundering)`);
      }
      // Build the attestation FROM THE FRESH w (hashes, targetRef snapshot, supersedes).
      const producedAt = new Date().toISOString();
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
        ...(prior ? { supersedes: `${prior.requirementId}:${prior.verifierId}:${prior.producedAt}` } : {}),
      };
      // preserve-not-inject: MERGE into the CURRENT map/history (never overwrite the subtree).
      const attestationHistory = [...w.attestationHistory, attestation];
      const attestations = { ...w.attestations, [requirementId]: attestation };
      // dual-edge edge #2: LEAF-only auto-advance (a gated ARC completes only via complete_work,
      // which re-checks completionDependsOn — steve/architect: no gated-arc auto-advance until a
      // fresh-row completionDependsOn reconciler exists).
      if (w.status === "review") {
        const gate = evaluateCompletionGate({ evidenceRequirements: w.evidenceRequirements, attestations });
        let executorDone = false;
        try {
          executorDone = evaluateEvidence(w.evidenceRequirements, w.evidence, w.lease, w.type === "verifier-gate", new Set(w.evidence.map(evidenceKey))).nextPhase === "done";
        } catch {
          executorDone = false;
        }
        const isLeaf = w.completionDependsOn.length === 0;
        if (gate.attestationReqsSatisfied && executorDone && isLeaf) {
          const nowISO = new Date().toISOString();
          return { ...w, attestationHistory, attestations, status: "done" as const, ...accrueExitingState(w, nowISO), updatedAt: nowISO };
        }
      }
      return { ...w, attestationHistory, attestations, updatedAt: new Date().toISOString() };
    });
    return { item: written!, attestation: written!.attestations[requirementId] };
  }

  async verifyAttestation(workId: string, requirementId: string): Promise<AttestationVerification> {
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
      // self-attestation set = executorHistory ∪ {creator, current holder} (steve audit-11832 #3: include holder).
      const excluded = new Set<string>(item.executorHistory);
      if (item.createdBy?.agentId) excluded.add(item.createdBy.agentId);
      if (item.lease?.holder) excluded.add(item.lease.holder);
      if (excluded.has(active.verifierId)) invalidReasons.push(`verifier ${active.verifierId} is in the executor/holder/creator history (self-attestation)`);
      // RECOMPUTE the exact same typed-ref validation as attest_evidence (drift → invalid).
      const resolved = await this.resolveEntityRefs(active.evidenceRefs);
      invalidReasons.push(...this.classifyEvidenceRefs(active.evidenceRefs, item, resolved).reasons);
    }
    return { workId, requirementId, valid: invalidReasons.length === 0, invalidReasons, active, history, legacyReviewEvidencePresent };
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
    const { items } = await this.substrate.list<WorkItem>(KIND, {
      filter: { status: { $in: [...LEASE_HELD_PHASES] }, "status.lease.expiresAt": { $lt: nowISO } },
      limit,
    });
    return items.map(cloneWorkItem);
  }

  /**
   * Expire ONE item's lease under CAS (sub-PR-4a). Re-checks expiry on the FRESH row,
   * so the renew-vs-sweeper race is a CAS one-winner: a renew that bumped expiresAt (or a
   * release/complete that changed phase) between the list and this CAS → "skipped", never
   * a double-action. Otherwise increments the per-ITEM poison counter and either re-queues
   * to ready (leaseExpiryCount < poisonCap) or POISON-ABANDONS (>= poisonCap). The lease
   * is cleared either way (a re-claim mints a fresh token → the old holder is token-fenced).
   */
  async expireLease(workId: string, nowISO: string, poisonCap: number): Promise<"requeued" | "abandoned" | "skipped"> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<WorkItem>(KIND, workId);
      if (!existing) return "skipped";
      const w = cloneWorkItem(existing.entity);
      // race-safe re-check: only sweep an item that is STILL lease-held AND still expired.
      if (!LEASE_HELD_PHASES.includes(w.status) || !w.lease || w.lease.expiresAt >= nowISO) {
        return "skipped";
      }
      // audit-4103 #3: only claimed/in_progress lapses accrue item-poison. review/blocked
      // re-queue WITHOUT incrementing → never terminal-abandon (evidence preserved on
      // re-queue, so a parked review item that loses its holder is recoverable, not lost).
      const poisonEligible = POISON_ELIGIBLE_PHASES.includes(w.status);
      const nextCount = poisonEligible ? w.leaseExpiryCount + 1 : w.leaseExpiryCount;
      const poisoned = poisonEligible && nextCount >= poisonCap;
      // work-98 (idea-384 Part A): accrue the EXITING lease-held state's dwell before the sweep.
      // On requeue→ready the node re-enters ready (re-stamped here), so its next ready-dwell
      // RE-ACCUMULATES onto the prior ready total — a thrashing node shows its time in `ready`.
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
    const { items } = await this.substrate.list<WorkItem>(KIND, {
      filter: { status: { $in: [...WIP_PHASES] }, "status.lease.holder": agentId },
      limit: cap,
    });
    return items.length;
  }

  /** Resolve each dependency's phase; return the ids NOT in phase=done (audit-4085 #1).
   *  An ABSENT dep counts as unmet (fail-CLOSED). done is terminal so the result is
   *  stable across the subsequent CAS. */
  private async unmetDependencies(depIds: string[]): Promise<string[]> {
    const unmet: string[] = [];
    for (const depId of depIds) {
      const dep = await this.substrate.get<WorkItem>(KIND, depId);
      if (!dep || cloneWorkItem(dep).status !== "done") unmet.push(depId);
    }
    return unmet;
  }

  /** Holder + token guard for lease-bound verbs (audit-4082 #1/#4). A non-holder OR a
   *  stale token (after a lease-expiry-requeue or a fresh re-claim) REJECTS — even for
   *  the SAME agentId — fencing a zombie old-process. Fail-CLOSED, row unchanged. */
  private assertLease(w: WorkItem, agentId: string, leaseToken: string, verb: string): void {
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
  private async tryCasUpdate(
    workId: string,
    transform: (current: WorkItem) => WorkItem,
  ): Promise<WorkItem | null> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<WorkItem>(KIND, workId);
      if (!existing) return null;
      const next = transform(cloneWorkItem(existing.entity));
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
