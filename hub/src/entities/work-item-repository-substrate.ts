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
import { randomUUID } from "node:crypto";
import type {
  WorkItem,
  WorkItemPhase,
  WorkItemType,
  WorkItemPriority,
  WorkItemLease,
  WorkItemBlockedOn,
  EvidenceRequirement,
  EvidenceItem,
  EvidenceKind,
  WorkItemReference,
  ReadyEmptyReason,
  IWorkItemStore,
} from "./work-item.js";
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
 *  work-item, design §3.4 linkage — there is no standalone Review entity kind; flagged
 *  to architect). External kinds (commit/pr/test-run/doc) are format-validated only. */
const OIS_INTERNAL_EVIDENCE_KINDS: Partial<Record<EvidenceKind, string>> = {
  audit: "Audit",
  review: "WorkItem",
};

/** A ref the completeWork predicate must existence-check AND relevance-check (audit-4103
 *  #1) async (outside the CAS). `evidenceKind` selects the relevance rule. */
interface RefToResolve { requirementId: string; kind: string; id: string; evidenceKind: EvidenceKind }

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

/** Append supplied evidence to the existing set, DEDUPED by identity
 *  (requirementId|kind|ref|producedAt) — so a network-retry can't double-append
 *  (audit-4082 #3 idempotency). */
function mergeEvidence(existing: EvidenceItem[], supplied: EvidenceItem[]): EvidenceItem[] {
  const seen = new Set<string>();
  const out: EvidenceItem[] = [];
  for (const e of [...existing, ...supplied]) {
    const key = `${e.requirementId}|${e.kind}|${e.ref ?? ""}|${e.producedAt}`;
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
 *   #2 kind-match  #3 freshness (producedAt >= lease.claimedAt unless allowPreClaim)
 *   #5 no-double-count (structural: one entry names one requirementId)
 *   #6 empty-req floor (>=1 freeform evidence; no silent zero-evidence close)
 */
function evaluateEvidence(
  requirements: EvidenceRequirement[],
  evidence: EvidenceItem[],
  lease: WorkItemLease | null,
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
    if (boundById.length === 0) {
      // an uncovered REVIEW requirement parks the item in `review` (verifier not yet);
      // any other uncovered requirement is a hard fail (the agent's evidence is short).
      if (req.kind === "review") { reviewDeferred = true; continue; }
      throw new EvidencePredicateFailed(`requirement '${req.id}' (${req.kind}) has no bound evidence`);
    }
    // #2 kind-match
    const kindMatched = boundById.filter((e) => e.kind === req.kind);
    if (kindMatched.length === 0) {
      throw new EvidencePredicateFailed(`requirement '${req.id}' evidence kind mismatch (expected ${req.kind}, bound entries: ${boundById.map((e) => e.kind).join(", ")})`);
    }
    // #3 freshness
    const fresh = kindMatched.filter((e) => req.allowPreClaim || (claimedAt != null && producedAtOnOrAfter(e.producedAt, claimedAt)));
    if (fresh.length === 0) {
      throw new EvidencePredicateFailed(`requirement '${req.id}' evidence failed freshness (producedAt before lease.claimedAt=${claimedAt}; set allowPreClaim to permit a pre-claim artifact)`);
    }
    const e = fresh[0]; // the binding evidence
    // #4 refResolvable: OIS-internal → existence + RELEVANCE check (queued, audit-4103 #1);
    // external → format-only.
    if (req.refResolvable) {
      const internalKind = OIS_INTERNAL_EVIDENCE_KINDS[e.kind];
      if (internalKind) {
        if (!e.ref || e.ref.trim() === "") throw new EvidencePredicateFailed(`requirement '${req.id}' refResolvable evidence has no ref`);
        refsToResolve.push({ requirementId: req.id, kind: internalKind, id: e.ref, evidenceKind: e.kind });
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
  return flat as unknown as WorkItem;
}

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
      targetRef: input.targetRef ?? null,
      payload: input.payload,
      status: "ready",
      lease: null,
      evidence: [],
      blockedOn: null,
      leaseExpiryCount: 0,
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
    return { items: claimable, truncated, emptyReason: claimable.length === 0 ? "no_claimable_ready" : undefined };
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
            expiresAt: new Date(now.getTime() + LEASE_TTL_MS).toISOString(),
            heartbeatAt: nowISO,
          };
          return { ...w, status: "claimed", lease, updatedAt: nowISO };
        });
      },
      { timeoutMs: CLAIM_LOCK_TIMEOUT_MS },
    );
  }

  async startWork(workId: string, agentId: string, leaseToken: string): Promise<WorkItem | null> {
    return this.tryCasUpdate(workId, (w) => {
      this.assertLease(w, agentId, leaseToken, "start");
      if (w.status !== "claimed") throw new TransitionRejected(`start requires claimed, was ${w.status}`);
      return { ...w, status: "in_progress", updatedAt: new Date().toISOString() };
    });
  }

  async blockWork(workId: string, agentId: string, leaseToken: string, blockedOn: WorkItemBlockedOn): Promise<WorkItem | null> {
    return this.tryCasUpdate(workId, (w) => {
      this.assertLease(w, agentId, leaseToken, "block");
      if (w.status !== "in_progress") throw new TransitionRejected(`block requires in_progress, was ${w.status}`);
      return { ...w, status: "blocked", blockedOn, updatedAt: new Date().toISOString() };
    });
  }

  async resumeWork(workId: string, agentId: string, leaseToken: string): Promise<WorkItem | null> {
    return this.tryCasUpdate(workId, (w) => {
      this.assertLease(w, agentId, leaseToken, "resume");
      if (w.status !== "blocked") throw new TransitionRejected(`resume requires blocked, was ${w.status}`);
      return { ...w, status: "in_progress", blockedOn: null, updatedAt: new Date().toISOString() };
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
        expiresAt: new Date(now.getTime() + LEASE_TTL_MS).toISOString(),
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
        expiresAt: new Date(now.getTime() + LEASE_TTL_MS).toISOString(),
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
      return { ...w, status: "ready", lease: null, blockedOn: null, updatedAt: new Date().toISOString() };
    });
  }

  /**
   * Terminal abandon. The lease-holder (presenting a matching token) OR the creator
   * (override authority — no token; lets a creator reclaim a stuck item from its
   * holder) may abandon. The reason is recorded by the policy/audit layer (sub-PR-3b).
   */
  async abandonWork(workId: string, agentId: string, opts?: { reason?: string; leaseToken?: string }): Promise<WorkItem | null> {
    return this.tryCasUpdate(workId, (w) => {
      const isHolderWithToken = w.lease?.holder === agentId && w.lease?.token === opts?.leaseToken;
      const isCreator = w.createdBy?.agentId === agentId;
      if (!isHolderWithToken && !isCreator) {
        throw new TransitionRejected(`abandon requires the lease-holder (with matching token) or the creator, not ${agentId}`);
      }
      if (!RELEASABLE_PHASES.includes(w.status)) throw new TransitionRejected(`abandon requires an active claim, was ${w.status}`);
      return { ...w, status: "abandoned", lease: null, blockedOn: null, updatedAt: new Date().toISOString() };
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
    // fail-fast the sync predicate + collect the async checks.
    const plan = evaluateEvidence(item.evidenceRequirements, mergeEvidence(item.evidence, evidence), item.lease);
    // #4 + audit-4103 #1: each OIS-internal ref must RESOLVE *and* RELATE to this work-item
    // or its targetRef (existence-AND-relevance — closes the existence-theatre where any
    // org-wide entity, incl. the item's own id, satisfied existence-only).
    for (const r of plan.refsToResolve) {
      const e = await this.substrate.get<Record<string, unknown>>(r.kind, r.id);
      if (!e) {
        throw new EvidencePredicateFailed(`requirement '${r.requirementId}' refResolvable evidence ref ${r.kind}/${r.id} does not resolve`);
      }
      if (!this.refRelatesToWork(r.evidenceKind, e, item)) {
        throw new EvidencePredicateFailed(`requirement '${r.requirementId}' evidence ref ${r.kind}/${r.id} does not RELATE to this work-item (${item.id}) or its targetRef — existence alone is insufficient`);
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
      const { nextPhase } = evaluateEvidence(w.evidenceRequirements, merged, w.lease);
      return { ...w, status: nextPhase, evidence: merged, updatedAt: new Date().toISOString() };
    });
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
      const next: WorkItem = poisoned
        ? { ...w, status: "abandoned", lease: null, blockedOn: null, leaseExpiryCount: nextCount, updatedAt: nowISO }
        : { ...w, status: "ready", lease: null, blockedOn: null, leaseExpiryCount: nextCount, updatedAt: nowISO };
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
