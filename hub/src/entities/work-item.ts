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
  /** Authoring agent id (audit-4103 #2). REQUIRED for review-kind evidence + must resolve
   *  to a role=verifier Agent before review→done (a verifier genuinely looked) — never a
   *  passing verdict. Optional provenance for other kinds. */
  producedBy?: string;
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

/** A node REFERENCE (idea-380 / work-86) — a typed pointer the node CONSUMES at execution.
 *  The `references(consume)` leg of the node-contract: dependsOn(when) + references(consume)
 *  + evidenceRequirements(produce). The cold-start + triangulation foundation the
 *  seed_blueprint expander builds on. `storage` says where it lives + how create_work
 *  validates resolvability at seed-time:
 *    inline   — content carried in `ref` (self-contained; present == resolvable)
 *    git      — a PINNED immutable sha[:path]; the Hub is git-less so it cannot dereference,
 *               only REQUIRE a pinned ref (reject a mutable branch/tag) — FR-36 at the
 *               reference layer; actual git-resolution stays the agent's/CI's job
 *    hub-doc  — a Hub Document path (existence-checked via the Document store)
 *    entity   — a {kind} entity id (existence-checked via entityExists)
 *  `mode` = how the claimant uses it (read | triangulate-against). */
export type ReferenceStorage = "inline" | "git" | "hub-doc" | "entity";
export type ReferenceMode = "read" | "triangulate-against";
export interface WorkItemReference {
  kind: string;        // semantic kind: doc | bug | idea | mission | workitem | calibration | ...
  ref: string;         // the locator: inline content | pinned sha[:path] | doc path | entity id
  storage: ReferenceStorage;
  mode: ReferenceMode;
  required: boolean;   // required:true → create_work fail-closed-validates resolvability at seed-time
}

export interface WorkItem {
  id: string;
  // spec (intent)
  type: WorkItemType;
  priority: WorkItemPriority;
  roleEligibility: string[];
  dependsOn: string[];
  evidenceRequirements: EvidenceRequirement[];
  /** idea-380 / work-86 — the node-contract: a cold-start `runbook` (the just-in-time
   *  instruction the claimant executes) + typed `references` it consumes. Both are SPEC
   *  (intent), default-partitioned to spec in the envelope (no renameMap entry). */
  runbook?: string;
  references?: WorkItemReference[];
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
    runbook?: string;
    references?: WorkItemReference[];
    targetRef?: { kind: string; id: string } | null;
    payload?: unknown;
    createdBy?: EntityProvenance;
  }): Promise<WorkItem>;

  getWorkItem(workId: string): Promise<WorkItem | null>;

  /** work-86 (idea-380): generic substrate existence check for a storage=entity reference
   *  at create_work-time — generalizes the WorkItem-only dangling-dependsOn existence check
   *  (the store holds the substrate handle; the policy layer has no raw substrate access). */
  entityExists(kind: string, id: string): Promise<boolean>;

  /** List work-items, optionally filtered by phase and/or role-eligibility
   *  ($contains array-membership) and/or current lease-holder (agentId) — the
   *  storage read the list_ready_work verb (sub-PR-3) projects over AND the
   *  list_work org-state-snapshot verb (stint-4 R1, idea-357-pt3) queries. Returns
   *  flat items (lease decoded as a first-class column) + `truncated` — the
   *  500-row scan-cap honesty flag (tele-4: never a silent cap). UNFILTERED by
   *  claim-readiness: this is the observability surface (shows ALL matching items
   *  incl. dependency-blocked); the deps/WIP readiness gate is list_ready_work's job. */
  listWorkItems(filter?: { status?: WorkItemPhase; role?: string; holder?: string }): Promise<{ items: WorkItem[]; truncated: boolean }>;

  /** The list_ready_work projection: ready items claimable by `role` (empty
   *  roleEligibility = any-role, OR'd in). truncation-HONEST — `truncated` flags a
   *  capped scan (never a silent cap). `role` undefined = all ready items.
   *  idea-353 WI-2.1 (AC5 parity): when `agentId` is supplied (the agent-scoped
   *  caller-claimable projection), also applies the per-agent WIP-cap so a maxed
   *  caller's projection is empty — count == claim_work's predicate. `agentId`
   *  omitted = the unchanged non-agent-scoped role view (D-1 R1 no-touch seam). */
  listReadyForRole(role: string | undefined, limit: number, agentId?: string): Promise<{ items: WorkItem[]; truncated: boolean }>;

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
