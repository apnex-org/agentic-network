/**
 * work-item.ts — C1-R2 (mission-94, M-Work-Queue-Substrate) the WorkItem domain
 * type + store interface.
 *
 * The reference-only claimable work-queue unit (design-of-record #355). A WorkItem
 * REFERENCES a Task/Bug/Review/verifier-gate via `targetRef`, or carries a
 * free-standing payload — it NEVER write-cascades a claim into Task.assignedAgentId
 * (the single-claim-authority is `lease`; dodges the bug-31 double-slot).
 *
 * Flat (above-membrane) domain shape; the substrate stores the K8s envelope and
 * the repo decodes (renameMap in all-schemas.ts). The two hot lease sub-fields
 * (holder, expiresAt) are filtered via the bucket-prefixed dotted envelope path
 * (option (c), thread-694) — NOT a renameMap alias — so `lease` stays a cohesive
 * object here.
 */
import type { EntityProvenance } from "../state.js";

export type WorkItemType = "task" | "bug" | "review" | "verifier-gate" | "freeform";
export type WorkItemPriority = "critical" | "high" | "normal" | "low";
export type WorkItemPhase =
  | "ready" | "claimed" | "in_progress" | "blocked" | "review" | "done" | "abandoned";

/** Evidence kind taxonomy (shared by requirement + supplied evidence). OIS-INTERNAL
 *  kinds (audit/review) are existence-checked when refResolvable; external kinds
 *  (commit/pr/test-run/doc) are format-validated only, never existence-checked. */
export type EvidenceKind = "commit" | "pr" | "audit" | "review" | "test-run" | "doc" | "freeform";

/** Evidence-requirement descriptor (spec). The anti-gameability contract (audit-4082
 *  evidence predicate): complete_work binds supplied evidence to each requirement by
 *  `id`, kind-matches, and (unless `allowPreClaim`) requires freshness vs the lease
 *  claim. `refResolvable` additionally existence-checks an OIS-INTERNAL ref. */
export interface EvidenceRequirement {
  id: string;
  kind: EvidenceKind;
  description?: string;
  /** OIS-INTERNAL bound evidence ref must resolve via substrate-get (audit/review);
   *  an external ref (commit/pr/...) is format-validated only (malformed rejects). */
  refResolvable?: boolean;
  /** When set, freshness (producedAt >= lease.claimedAt) is NOT required — permits a
   *  pre-claim artifact (e.g. a design doc authored before the work was claimed). */
  allowPreClaim?: boolean;
}

/** Supplied evidence (status). Binds to a requirement by `requirementId`. */
export interface EvidenceItem {
  requirementId: string;
  kind: EvidenceKind;
  ref?: string;
  producedAt: string;
  note?: string;
}

/** The claim lease (status). Cohesive object; `holder`/`expiresAt` are the hot
 *  filterable sub-fields (queried via the bucket-prefixed dotted path).
 *
 *  `token` (audit-4082 #1) is a nonce minted at claim_work. Every lease-bound verb
 *  requires the caller to present the MATCHING token, not merely be the holder
 *  agentId — this FENCES a zombie old-process (watchtower-roll) that re-reads the
 *  row, sees its own agentId as holder, and would otherwise proceed on a fresh
 *  resourceVersion and corrupt a new claimant's work. CAS-on-resourceVersion does
 *  NOT fence that; the token (old != current) does. This is the #355 split-brain fix. */
export interface WorkItemLease {
  holder: string;
  token: string;
  claimedAt: string;
  expiresAt: string;
  heartbeatAt: string;
}

/** Structured block descriptor (audit-4082 #6) — feeds R3's blockedOn emission
 *  (Steve's R3 matrix audit-4063). `blockerKind` categorizes the blocker; optional
 *  `blockerIds` reference the blocking entities; `reason` is human-readable. */
export interface WorkItemBlockedOn {
  blockerKind: string;
  blockerIds?: string[];
  reason: string;
}

export interface WorkItem {
  id: string;
  // spec (intent)
  type: WorkItemType;
  priority: WorkItemPriority;
  roleEligibility: string[];
  dependsOn: string[];
  evidenceRequirements: EvidenceRequirement[];
  targetRef: { kind: string; id: string } | null;
  payload?: unknown;
  // status (lifecycle)
  status: WorkItemPhase;
  lease: WorkItemLease | null;
  evidence: EvidenceItem[];
  blockedOn: WorkItemBlockedOn | null;
  /** Per-ITEM poison counter — incremented on each lease-expiry re-queue; at the
   *  cap the sweeper terminal-abandons the item (distinct from per-AGENT thrash). */
  leaseExpiryCount: number;
  // metadata / provenance
  createdBy?: EntityProvenance;
  createdAt: string;
  updatedAt: string;
}

/**
 * WorkItem store (storage CRUD; the claim/lease/FSM VERBS are sub-PR-3). The
 * claim authority is `lease`, set atomically under a per-agent advisory lock at
 * claim-time (sub-PR-3); this interface is the storage surface the verbs build on.
 */
export interface IWorkItemStore {
  createWorkItem(input: {
    type: WorkItemType;
    priority?: WorkItemPriority;
    roleEligibility: string[];
    dependsOn?: string[];
    evidenceRequirements?: EvidenceRequirement[];
    targetRef?: { kind: string; id: string } | null;
    payload?: unknown;
    createdBy?: EntityProvenance;
  }): Promise<WorkItem>;

  getWorkItem(workId: string): Promise<WorkItem | null>;

  /** List work-items, optionally filtered by phase and/or role-eligibility
   *  ($contains array-membership) — the storage read the list_ready_work verb
   *  (sub-PR-3) projects over. */
  listWorkItems(filter?: { status?: WorkItemPhase; role?: string }): Promise<WorkItem[]>;

  /** The list_ready_work projection: ready items claimable by `role` (empty
   *  roleEligibility = any-role, OR'd in). truncation-HONEST — `truncated` flags a
   *  capped scan (never a silent cap). `role` undefined = all ready items. */
  listReadyForRole(role: string | undefined, limit: number): Promise<{ items: WorkItem[]; truncated: boolean }>;

  // ── Claim / lease / FSM verbs (C1-R2 sub-PR-3) ────────────────────────────
  // Each returns the updated WorkItem on success, null if `workId` is absent.
  // FSM-illegal source phases throw TransitionRejected; a non-holder OR a stale
  // `leaseToken` throws TransitionRejected (audit-4082 #4, fail-closed, row
  // unchanged); an over-cap claim throws WipCapExceeded; a lock-acquire timeout
  // throws LockAcquisitionTimeoutError (claim fail-CLOSED, never unlocked).
  //
  // Every lease-bound verb takes the `leaseToken` minted at claim (returned in
  // lease.token). Presenting the holder agentId is NOT sufficient — the token must
  // match the CURRENT lease, fencing a zombie old-process (audit-4082 #1).

  /** ready → claimed. Mints lease.token. WIP-capped per-agent under an advisory lock
   *  (count-then-CAS is atomic; the per-row CAS arbitrates two agents racing one item). */
  claimWorkItem(workId: string, agentId: string, role?: string): Promise<WorkItem | null>;
  /** claimed → in_progress (holder + matching token). */
  startWork(workId: string, agentId: string, leaseToken: string): Promise<WorkItem | null>;
  /** in_progress → blocked (holder + matching token); records the structured blockedOn. */
  blockWork(workId: string, agentId: string, leaseToken: string, blockedOn: WorkItemBlockedOn): Promise<WorkItem | null>;
  /** blocked → in_progress (holder + matching token); clears blockedOn. */
  resumeWork(workId: string, agentId: string, leaseToken: string): Promise<WorkItem | null>;
  /** Heartbeat-extend the lease (holder + matching token); orthogonal to phase — stays
   *  valid in any lease-holding phase so crash-gap vs slow-progress stays clean. */
  renewLease(workId: string, agentId: string, leaseToken: string): Promise<WorkItem | null>;
  /** {claimed|in_progress|blocked} → ready (holder + matching token); clears the lease. */
  releaseWork(workId: string, agentId: string, leaseToken: string): Promise<WorkItem | null>;
  /** {claimed|in_progress|blocked} → abandoned, terminal. The lease-holder (with a
   *  matching token) OR the creator (no token — override authority) may abandon. */
  abandonWork(workId: string, agentId: string, opts?: { reason?: string; leaseToken?: string }): Promise<WorkItem | null>;

  /** {in_progress|review} → review|done. Appends + dedups the supplied evidence, then
   *  validates the anti-gameability predicate (coverage-by-binding + kind-match +
   *  freshness + refResolvable + no-double-count + empty-req floor). Throws
   *  EvidencePredicateFailed (fail-loud, specific reason) on any unmet condition; the
   *  row is unchanged. Parks in `review` when a review requirement is present + unmet;
   *  reaches `done` once all requirements are covered. NEVER requires a passing verdict
   *  (review evidence satisfies by EXISTING). Holder + matching token. */
  completeWork(workId: string, agentId: string, leaseToken: string, evidence: EvidenceItem[]): Promise<WorkItem | null>;
}
