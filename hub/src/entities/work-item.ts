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
import type { PulseConfig } from "./mission.js";

/**
 * W1 (idea-446 / work-181): node-native backstop config. The anti-idle pulse,
 * carried on the arc-node itself instead of the (deprecated) Mission entity —
 * the deferred S1b of the S1 v0.3 build spec. `pulse` is the SAME shape as the
 * Mission `PulseConfig` (authored config + sweeper-managed bookkeeping); the
 * type's canonical home moves here as the Mission is retired. Additive per
 * v0.3 §3.1 — the Mission-pulse path is preserved (dual-run-safe).
 */
export interface NodeConfig {
  pulse?: PulseConfig;
}

export type WorkItemType = "task" | "bug" | "review" | "verifier-gate" | "freeform";
export type WorkItemPriority = "critical" | "high" | "normal" | "low";
export type WorkItemPhase =
  | "ready" | "claimed" | "in_progress" | "blocked" | "paused" | "review" | "done" | "abandoned";

/** work-94 (cold-start spine, non-dark digest): WHY a caller-scoped claimable digest is
 *  empty — never a DARK (silent) zero. `wip_capped` + `no_claimable_ready` are repo-set
 *  (listReadyForRole knows which); `quarantined` is policy-set (its own claim gate). */
export type ReadyEmptyReason = "wip_capped" | "no_claimable_ready" | "quarantined";

/** work-94 (cold-start spine, get_current_stint): the "where are we" projection over any
 *  arc-node's DIRECT completionDependsOn subtree (the stint arc-node is the first consumer).
 *  k/N completion-gate progress + per-child status + in-flight/blocked rollups + gate-open
 *  (would complete_work pass). DIRECT children only (F-B; recursion is a follow-on). A
 *  vanished child id surfaces as `missing`, never hidden. */
export interface StintChild {
  id: string;
  status: WorkItemPhase | "missing";
  leaseHolder: string | null;
  /** idea-384 Part A (work-98): per-state wall-clock (ms) for this child — the per-node
   *  duration surface on get_current_stint. Zeroed for a `missing` child. (PART B's
   *  recursive subtree rollup is Arc-A slice 2.) */
  stateDurations: StateDurations;
}
export interface FrictionRollup {
  total: number;
  observed: number;
  missingLegacy: number;
  categories: Record<string, number>;
}

export interface StintProjection {
  arcId: string;
  arcStatus: WorkItemPhase;
  completion: { done: number; total: number; pending: string[] };
  /** tracks the ARC completion-gate (children>0): `total>0 && done===total` — complete_work would
   *  pass it (the one-enforced-close surface). A LEAF (children=0) has NO completion-gate (completes
   *  freely), so gateOpen:false there means "no arc-gate to be open", NOT "blocked". */
  gateOpen: boolean;
  /** children actively held (claimed + in_progress + review). */
  inFlight: number;
  /** children blocked. */
  blocked: number;
  /** counts per WorkItemPhase (+ `missing`). */
  statusCounts: Record<string, number>;
  children: StintChild[];
  /** idea-384 Part B (work-99): the arc SUBTREE effort profile — per-state ms summed over the
   *  UNIQUE reachable LEAVES of the completionDependsOn DAG. Leaves-only-BY-CONSTRUCTION (an
   *  intermediate's own span is NEVER added; rollup(node)=isLeaf? own : SUM(children.rollup));
   *  a DAG-shared leaf is counted ONCE (visited-set dedup). SEPARATE from the arc's own span. */
  rolledUpDurations: StateDurations;
  /** idea-384 Part B: the arc's OWN active wall-clock (ms) = its own claimed+in_progress+blocked+
   *  review buckets (EXCLUDES ready queue-wait). Derived from the arc's own stateDurations — robust
   *  to the lease (claimedAt) being cleared on terminal transitions; kept SEPARATE from the rollup. */
  ownActiveMs: number;
  /** idea-384 Part B: parallelism/utilization = rolledUpDurations.in_progress / ownActiveMs.
   *  >1 ⇒ subtree concurrency achieved; <1 ⇒ serial/idle gaps. null when ownActiveMs=0. */
  parallelism: number | null;
  /** A10 primitive-1: subtree friction-reflection rollup over reachable leaves. */
  friction: FrictionRollup;
}

/** W2 (idea-451 / work-182): the graph-projected NEXT ACTION for an arc-node — the
 *  HIGHEST-PRIORITY READY completionDependsOn child, per the FULL claim gate (deps +
 *  roleEligibility [+ WIP/quarantine when agentId given]). Corrects the last stint's
 *  scope-inversion: "what next" is READ FROM THE GRAPH, not chosen from memory. A
 *  lower-priority pick over a ready higher-priority one is UNREPRESENTABLE (the projection
 *  orders by priority + returns the head). Feeds W3's reconciler + cold-start "what next". */
export interface NextActionProjection {
  arcId: string;
  /** the highest-priority READY child claimable by the (role, agentId); null when none. */
  nextAction: WorkItem | null;
  /** count of READY candidate children (the arc's RAW claimable scope — child-local, never
   *  capped by a global ready-scan window; the W3 reconciler's fail-loud signal). */
  readyCandidates: number;
  /** false when the arc has no completionDependsOn children (a leaf, not an arc-node). */
  hasChildren: boolean;
  /** NON-DARK caller-gate reason when nextAction is null despite raw scope: the caller is
   *  WIP-capped (substrate) or claim-thrash quarantined (policy). Absent on the role-only
   *  projection (no caller) and when nextAction is non-null. `readyCandidates` still reports
   *  the RAW scope, so the reconciler can tell "you are gated" from "scope is exhausted". */
  emptyReason?: "wip_capped" | "quarantined";
}

/** work-94 (cold-start spine, sub-slice 3): the legal FSM transition verbs for an item given
 *  its state/lease/gates, FROM THE CALLER'S seat — the cold-agent "what can I do from here"
 *  surface. Each verb carries `legal` + (when illegal) a non-dark `reason`, so a process-naive
 *  agent learns the affordances AND why the others are unavailable. Caller-aware (holder vs not)
 *  + gate-aware (an arc with an unmet completion-gate → complete is NOT legal; a leaf → it is). */
export type WorkItemVerb =
  | "claim" | "start" | "block" | "resume" | "complete" | "release" | "abandon" | "renew"
  | "pause" | "unpause";
export interface LegalMove {
  verb: WorkItemVerb;
  legal: boolean;
  /** present when legal:false — WHY this verb is unavailable from the caller's seat. */
  reason?: string;
}
export interface LegalMoves {
  workId: string;
  status: WorkItemPhase;
  /** the caller holds this item's lease (gates the lease-bound verbs). */
  isHolder: boolean;
  /** for a COMPLETABLE arc: are all completionDependsOn children done (the completion-gate met)? true for a leaf. */
  gateMet: boolean;
  moves: LegalMove[];
}

/** Evidence kind taxonomy (shared by requirement + supplied evidence). OIS-INTERNAL
 *  kinds (audit/review) are existence-checked when refResolvable; external kinds
 *  (commit/pr/test-run/doc) are format-validated only, never existence-checked. */
export type EvidenceKind = "commit" | "pr" | "audit" | "review" | "test-run" | "doc" | "freeform";

/** Evidence-requirement descriptor (spec). The anti-gameability contract (audit-4082
 *  evidence predicate): complete_work binds supplied evidence to each requirement by
 *  `id`, kind-matches, and (unless `allowPreClaim`) requires freshness vs the lease
 *  claim — except evidence ALREADY persisted on the item, which is grandfathered
 *  (bug-222: it was freshness-validated when bound under the prior lease; a reaped
 *  review/blocked item must stay re-completable after re-claim). `refResolvable`
 *  additionally existence-checks an OIS-INTERNAL ref. */
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
  /** SEAL (idea-444) — the AUTHORITY axis (not a style): who may satisfy this requirement.
   *  `"verifier-attestation"` = satisfiable ONLY by a verifier's server-stamped `attest_evidence`
   *  verdict (NOT by executor-supplied evidence, even if `producedBy` names a verifier — the hard
   *  fence). ABSENT ⇒ `"executor-evidence"` (back-compat: every existing requirement keeps its
   *  current executor-evidence behavior; only a requirement that explicitly opts into
   *  `verifier-attestation` gets the SEAL gate). */
  evidenceAuthority?: EvidenceAuthority;
}

/** SEAL authority axis (idea-444). Absent on a requirement ⇒ `"executor-evidence"`. */
export type EvidenceAuthority = "executor-evidence" | "verifier-attestation";

/** SEAL verdict (idea-444) — the load-bearing pass/fail a verifier records via `attest_evidence`. */
export type AttestationVerdict = "pass" | "fail";

/** SEAL (idea-444) — a TYPED, per-ref-classified evidence reference bound to an attestation
 *  (steve audit-11832 #2: a bare `string[]` with "≥1 relates" is not a sufficient authority gate).
 *  Every ref is validated by its `kind` — and ≥1 must be LOAD-BEARING (an `evidence` entry or a
 *  resolving non-self `entity`), never prose or the item's own id:
 *    - `"evidence"`: `ref` MUST equal a concrete `evidence[].ref` already submitted on the item.
 *    - `"entity"`:   `ref` is `Kind/id` (e.g. `bug/bug-9`); existence-resolved via the substrate;
 *                    the item's OWN id does not count as load-bearing.
 *    - `"external"`: `ref` is a non-empty locator (PR url / commit sha); format-only, honestly
 *                    unresolvable server-side, NEVER load-bearing on its own. */
export interface AttestationEvidenceRef {
  kind: "evidence" | "entity" | "external";
  ref: string;
}

/** SEAL attestation (idea-444) — a verifier's server-stamped, load-bearing verdict against a
 *  `verifier-attestation` requirement. Append-only in `status.attestationHistory[]`; the active
 *  (latest, non-superseded) attestation per requirement is projected into `status.attestations`.
 *  Every field except `supersedes` is stamped by the Hub at `attest_evidence` time — the caller
 *  cannot forge `verifierId` (server-derived from the authenticated session) nor the hashes. */
export interface Attestation {
  /** The evidenceRequirement.id this attestation binds to. */
  requirementId: string;
  /** Server-stamped verifier agentId (from the authenticated session; caller-supplied id ignored).
   *  The no-owner/executor-write invariant rejects an attestation whose verifierId is the current
   *  or ANY prior holder/executor — or the item creator — of this WorkItem (A2 HISTORY check). */
  verifierId: string;
  /** The load-bearing verdict. `pass` satisfies the requirement's gate; `fail` parks it in review. */
  verdict: AttestationVerdict;
  producedAt: string;
  /** ≥1 TYPED evidence ref; ≥1 must be load-bearing (an `evidence` entry / resolving non-self
   *  `entity`). A bare pass/fail with no resolvable referent is the trust-by-prose verdict SEAL kills. */
  evidenceRefs: AttestationEvidenceRef[];
  /** Relocation guard (A2): a hash of the requirement descriptor at attest time — the validator
   *  recomputes and rejects if the requirement mutated out from under the attestation. */
  requirementHash: string;
  /** Relocation guard (A2): the item's targetRef snapshot + hash at attest time. targetRef mutation
   *  after any attestation exists is rejected — closes the point-at-A-then-move-to-B laundering path. */
  targetRefSnapshot: { kind: string; id: string } | null;
  targetRefHash: string;
  /** Relocation guard (A2): a hash over the bound evidence set at attest time. */
  evidenceSetHash: string;
  /** Supersession (A2): when a later attestation replaces this one, the new record names the
   *  superseded attestation's identity here; the active projection repoints to the latest. */
  supersedes?: string;
}

/** SEAL (idea-444) — `verify_attestation` output: the active attestation + full per-requirement
 *  history + the RECOMPUTED validity (not a passive read — the validator re-derives the hashes,
 *  re-resolves the verifier role + refs, and re-checks the no-self-attestation history), plus the
 *  concrete `invalidReasons` when it does not hold. `legacyReviewEvidencePresent` flags executor
 *  review/audit evidence bound to the requirement as NOT-SEAL-grade (never satisfies attestation). */
export interface AttestationVerification {
  workId: string;
  requirementId: string;
  valid: boolean;
  invalidReasons: string[];
  active: Attestation | null;
  history: Attestation[];
  legacyReviewEvidencePresent: boolean;
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

export type FrictionCategory =
  | "tool_affordance"
  | "runbook_confusion"
  | "evidence_pain"
  | "coordination_drag"
  | "lease_or_liveness"
  | "authority_or_seal"
  | "stale_context"
  | "manual_step"
  | "scope_drift"
  | "other";

export interface FrictionSuggestedFollowUp {
  kind: "none" | "idea" | "bug" | "work" | "skill_update" | "doc_update";
  text?: string;
}

export interface FrictionReflectionInput {
  observed: boolean;
  summary?: string;
  categories?: FrictionCategory[];
  suggestedFollowUp?: FrictionSuggestedFollowUp;
}

export interface FrictionReflectionRecord {
  producedAt: string;
  producedBy: string;
  sourceVerb: "complete_work";
  observed: boolean;
  summary: string;
  categories: FrictionCategory[];
  suggestedFollowUp?: FrictionSuggestedFollowUp;
  compatibility: "explicit" | "missing_legacy_client";
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

/** idea-384 Part A (work-98) — per-FSM-state wall-clock accumulation. One bucket per
 *  NON-TERMINAL dwell state (terminal done/abandoned never dwell, so no bucket — cal #101
 *  the bucket-set covers every dwell state, incl `review` = verifier-wait latency). Units =
 *  MILLISECONDS accumulated across the node's whole life (requeues RE-ACCUMULATE). The
 *  sum-identity holds for a node born under the timer: sum(buckets) === createdAt→completedAt. */
export interface StateDurations {
  ready: number;
  claimed: number;
  in_progress: number;
  blocked: number;
  /** S3 (idea-454): dwell in the `paused` dormancy state (resumable→ready). A non-terminal
   *  dwell bucket so sum(buckets) === createdAt→completedAt still holds across a pause/resume. */
  paused: number;
  review: number;
}
export const DEFAULT_STATE_DURATIONS: StateDurations = Object.freeze({
  ready: 0, claimed: 0, in_progress: 0, blocked: 0, paused: 0, review: 0,
});

export interface WorkItem {
  id: string;
  // spec (intent)
  type: WorkItemType;
  priority: WorkItemPriority;
  roleEligibility: string[];
  dependsOn: string[];
  /** work-88 (idea-380): the COMPLETION-gate edge (parent→child). complete_work is rejected
   *  until every completionDependsOn WorkItem is `done` — the mechanized "claim now, complete
   *  only when the subtree is finalised" arc-node. Sibling to dependsOn (the CLAIM-gate,
   *  child→parent). [] for a leaf (today's behavior); populated for an arc/umbrella node.
   *  Spec-partitioned + GIN-indexed for the reverse-ancestor lookup (the transitive heartbeat).
   *  Targets are immutable + must pre-exist at create (forward-refs live in work-87's expander). */
  completionDependsOn: string[];
  evidenceRequirements: EvidenceRequirement[];
  /** idea-380 / work-86 — the node-contract: a cold-start `runbook` (the just-in-time
   *  instruction the claimant executes) + typed `references` it consumes. Both are SPEC
   *  (intent), default-partitioned to spec in the envelope (no renameMap entry). */
  runbook?: string;
  references?: WorkItemReference[];
  /** work-164 (idea-395): optional node-type-aware lease window in ms. When set, the
   *  claim/renew lease grant uses this instead of the flat default LEASE_TTL_MS — the
   *  architect marks known long-hold / design-first nodes 'extended' at create_work so
   *  a heavy cognitive turn is not reaped on the standard 15-min window. Absent = the
   *  default. Spec (intent), default-partitioned to spec in the envelope. */
  leaseWindowMs?: number;
  targetRef: { kind: string; id: string } | null;
  payload?: unknown;
  /** work-87 (seed_blueprint): the deterministic run-key stamped on every node a
   *  seed_blueprint invocation materialized. Provenance/lineage of the blueprint expansion
   *  (which run produced this node) + the basis for the idempotent re-run: the node's id is
   *  derived as `work-bp-{blueprintRunId}-{localId}`, so createOnly dedups a re-run by id.
   *  Absent on ad-hoc create_work nodes. Spec (intent), default-partitioned. Not filterable
   *  in work-87 (idempotency rides the deterministic id, not a query) — cleanup-by-runId
   *  query is a deferred follow-on. */
  blueprintRunId?: string;
  // status (lifecycle)
  status: WorkItemPhase;
  lease: WorkItemLease | null;
  evidence: EvidenceItem[];
  /** A10 primitive-1: append-only friction reflections captured on accepted complete_work transitions. */
  frictionReflections: FrictionReflectionRecord[];
  blockedOn: WorkItemBlockedOn | null;
  /** Per-ITEM poison counter — incremented on each lease-expiry re-queue; at the
   *  cap the sweeper terminal-abandons the item (distinct from per-AGENT thrash). */
  leaseExpiryCount: number;
  /** idea-384 Part A (work-98): the timestamp this item ENTERED its current `status` —
   *  re-stamped on every FSM transition. status-partitioned. The accrual basis: on exit,
   *  (now - enteredCurrentStateAt) accumulates into the EXITING state's stateDurations bucket. */
  enteredCurrentStateAt: string;
  /** idea-384 Part A (work-98): accumulated wall-clock MS per dwell state (cumulative across
   *  the node's life incl requeues). status-partitioned. Non-filterable. */
  stateDurations: StateDurations;
  /** SEAL (idea-444): APPEND-ONLY log of every attestation ever recorded against this item
   *  (never mutated/erased; supersession appends a new record). status-partitioned, non-filterable.
   *  Birth-empty. The disjoint authority subtree — no owner/executor write path admits it. */
  attestationHistory: Attestation[];
  /** SEAL (idea-444): the ACTIVE (latest, non-superseded) attestation per requirementId — a
   *  projection over attestationHistory[]. The map↔history consistency invariant holds by
   *  construction (attest_evidence appends to history + repoints this projection atomically under
   *  CAS). status-partitioned, non-filterable. Birth-empty. */
  attestations: Record<string, Attestation>;
  /** SEAL (idea-444) fold 2 — the append-only set of distinct agentIds that have EVER held the
   *  lease (executed) this item. Appended server-side on each claim. Backs the no-owner/executor-
   *  write HISTORY check: `attest_evidence` rejects a verifierId ∈ executorHistory ∪ {createdBy}
   *  — so an executor cannot release/role-switch then attest their own work. status-partitioned,
   *  non-filterable, birth-empty. */
  executorHistory: string[];
  /** W1 (idea-446 / work-181): the node-native anti-idle backstop. The pulse CONFIG
   *  (interval/message/threshold) is authored at create/seed_blueprint; the BOOKKEEPING
   *  (lastFiredAt/lastResponseAt/missedCount/lastEscalatedAt) is sweeper-written — so, like
   *  the Mission pulse, the whole subtree is STATUS-partitioned: owner-path writes
   *  (claim/complete/...) preserve-not-inject it, and a spec placement would hit the
   *  envelope resurrection trap (SEAL idea-444 lesson). Absent on ordinary nodes.
   *  Additive per v0.3 §3.1 — the Mission-pulse path stays (dual-run-safe). */
  nodeConfig?: NodeConfig;
  // metadata / provenance
  createdBy?: EntityProvenance;
  createdAt: string;
  updatedAt: string;
}

/**
 * SEAL (idea-444) — the pure, LEVEL-TRIGGERED completion gate over the ATTESTATION dimension.
 * Reads the item's STATE (never a verb-event): for every requirement whose `evidenceAuthority` is
 * `verifier-attestation`, that requirement is satisfied iff its ACTIVE attestation is `pass`. A
 * missing or `fail` active attestation leaves it pending (→ park in review). Requirements with
 * `executor-evidence` authority (the default when absent) are NOT decided here — they stay the
 * evidence-predicate's domain (`evaluateEvidence`). PURE: no I/O; reads only `item`.
 *
 * A1 lays + unit-tests this seam. A2 wires it DUAL-EDGE — called at BOTH `complete_work` AND the
 * `attest_evidence` tail (attest advances review→done when the gate flips true, no re-poke) — and
 * adds the hard fence (executor evidence cannot satisfy a `verifier-attestation` requirement).
 */
export function evaluateCompletionGate(
  item: Pick<WorkItem, "evidenceRequirements" | "attestations">,
): { attestationReqsSatisfied: boolean; pendingAttestationReqs: string[] } {
  const pending: string[] = [];
  for (const req of item.evidenceRequirements) {
    // executor-evidence (or absent default) requirements are not this gate's domain.
    if (req.evidenceAuthority !== "verifier-attestation") continue;
    const active = item.attestations[req.id];
    if (!active || active.verdict !== "pass") pending.push(req.id);
  }
  return { attestationReqsSatisfied: pending.length === 0, pendingAttestationReqs: pending };
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
    completionDependsOn?: string[];
    evidenceRequirements?: EvidenceRequirement[];
    runbook?: string;
    references?: WorkItemReference[];
    leaseWindowMs?: number;
    targetRef?: { kind: string; id: string } | null;
    payload?: unknown;
    /** W1 (idea-446 / work-181): optional node-native backstop config at create. */
    nodeConfig?: NodeConfig;
    createdBy?: EntityProvenance;
  }): Promise<WorkItem>;

  /** work-136 (idea-419, ratified contract v1.0 / decision-11): mutate a
   *  WorkItem per the field-mutability table. Caller-side validation
   *  (dangling/cycle/reference checks) happens in the policy layer; THIS
   *  method owns authority (author|architect, Hub-derived actor), phase
   *  rules, empty-mutation + terminal rejection, and the single-shot CAS
   *  (stale write → reject with the current version; caller re-reads).
   *  Returns {before, after} for the mutation audit. */
  updateWorkItem(
    workId: string,
    actor: { agentId: string; role: string },
    mutation: {
      set?: { priority?: WorkItemPriority; targetRef?: { kind: string; id: string } | null; runbook?: string; payload?: unknown; roleEligibility?: string[] };
      appendDependsOn?: string[];
      appendCompletionDependsOn?: string[];
      appendReferences?: WorkItemReference[];
    },
  ): Promise<{ before: WorkItem; after: WorkItem }>;

  /** work-87 (seed_blueprint): create ONE blueprint node at a DETERMINISTIC id (the run-key
   *  derivation `work-bp-{blueprintRunId}-{localId}`) via createOnly — the idempotency
   *  primitive. Returns `{item, created}`: created:true when this invocation minted it;
   *  created:false when a PRIOR run of the same blueprintRunId already created it (createOnly
   *  conflict → the existing node is fetched + reused, NO double-create). dependsOn/
   *  completionDependsOn arrive pre-translated to real work-ids. No counter, no advisory lock
   *  (the deterministic id IS the dedup key). */
  createBlueprintNode(input: {
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
    /** W1 (idea-446 / work-181): born-native backstop — the blueprint declares the node's pulse. */
    nodeConfig?: NodeConfig;
    createdBy?: EntityProvenance;
  }): Promise<{ item: WorkItem; created: boolean }>;

  /** work-87 (seed_blueprint): hard-delete a WorkItem by id. INTERNAL — the
   *  seed_blueprint expander's compensating-delete (F1a best-effort rollback) of items it
   *  JUST minted when a mid-expansion infra-failure breaks all-or-nothing; NOT an MCP verb.
   *  Idempotent: deleting an absent id is a no-op (so a partial rollback can be retried). */
  deleteWorkItem(workId: string): Promise<void>;

  getWorkItem(workId: string): Promise<WorkItem | null>;

  /** SEAL (idea-444) — record a verifier's server-stamped, load-bearing attestation against a
   *  `verifier-attestation` requirement. `verifierId` is the Hub-derived caller (the policy layer
   *  passes the spoof-proof session agentId; the verifier ROLE gate is enforced at the router).
   *  Rejects (AttestationRejected): non-verifier-attestation requirement, empty evidenceRefs,
   *  refs that don't relate to the work, or a verifierId in the executor/holder/creator HISTORY
   *  (self-attestation). Appends to attestationHistory + repoints the active projection under CAS
   *  (preserve-not-inject MERGE). Dual-edge: if the item is parked in review and the gate now
   *  clears, advances review→done in the same write. */
  attestEvidence(
    workId: string,
    requirementId: string,
    verifierId: string,
    verdict: AttestationVerdict,
    evidenceRefs: AttestationEvidenceRef[],
    note?: string,
  ): Promise<{ item: WorkItem; attestation: Attestation }>;

  /** SEAL (idea-444) — the cheap independent validator: recompute an attestation's validity
   *  (requirement exists + is verifier-attestation, hashes match, verifier resolves to a verifier
   *  role + is NOT in the executor/creator history, evidenceRefs resolve/relate) + return
   *  invalid-reasons. Reports legacy executor review/audit evidence as NOT-SEAL-grade. */
  verifyAttestation(workId: string, requirementId: string): Promise<AttestationVerification>;

  /** work-88 (arc-node): the k/N COMPLETION-gate progress projection over a node's DIRECT
   *  completionDependsOn children — `{done, total, pending}` (done = children at phase=done;
   *  pending = the not-yet-done ids; a vanished/abandoned child counts pending, fail-closed).
   *  Reuses the SAME envelope-safe per-child read the complete_work gate enforces with (one
   *  source of truth). Opt-in surface for get_work (feeds the cold-start get_current_stint).
   *  Returns null if the work-item itself does not exist. */
  getCompletionProgress(workId: string): Promise<{ done: number; total: number; pending: string[] } | null>;

  /** work-94 (cold-start spine): project an arc-node's DIRECT subtree — the "where are we"
   *  surface. k/N completion progress + per-child status + in-flight/blocked rollups + the
   *  gate-open flag, over ANY arc-node. Returns null if the arc id does not exist. */
  getStintProjection(workId: string): Promise<StintProjection | null>;

  /** W2 (idea-451 / work-182): the graph-projected NEXT ACTION for an arc-node — the
   *  highest-priority READY completionDependsOn child claimable by (role, agentId), per
   *  the full claim gate (assembles the completion-gate children ∩ listReadyForRole).
   *  null if the arc doesn't exist. */
  getNextAction(arcId: string, role?: string, agentId?: string): Promise<NextActionProjection | null>;

  /** work-94 (cold-start spine): the legal FSM transition verbs for the caller given the
   *  item's state/lease/gates — the "what can I do from here" surface. Caller-aware (holder
   *  vs not) + gate-aware (an arc with an unmet completion-gate → complete is not legal).
   *  Returns null if the item id does not exist. */
  getLegalMoves(workId: string, caller: { agentId: string; role?: string }): Promise<LegalMoves | null>;

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

  /** W1 (idea-446 / work-181): sweeper-only direct write of the node-native pulse
   *  bookkeeping — mirrors the Mission `updatePulseBookkeeping`. CAS-safe (preserves
   *  the rest of the node), NOT authz-gated (the system PulseSweeper is the writer).
   *  No-op if the node carries no `nodeConfig.pulse`. */
  updateNodePulseBookkeeping(
    nodeId: string,
    delta: { lastFiredAt?: string; lastResponseAt?: string | null; missedCount?: number; lastEscalatedAt?: string | null },
  ): Promise<void>;

  /** The list_ready_work projection: ready items claimable by `role` (empty
   *  roleEligibility = any-role, OR'd in). truncation-HONEST — `truncated` flags a
   *  capped scan (never a silent cap). `role` undefined = all ready items.
   *  idea-353 WI-2.1 (AC5 parity): when `agentId` is supplied (the agent-scoped
   *  caller-claimable projection), also applies the per-agent WIP-cap so a maxed
   *  caller's projection is empty — count == claim_work's predicate. `agentId`
   *  omitted = the unchanged non-agent-scoped role view (D-1 R1 no-touch seam). */
  listReadyForRole(role: string | undefined, limit: number, agentId?: string): Promise<{ items: WorkItem[]; truncated: boolean; emptyReason?: ReadyEmptyReason }>;

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
  /** mission-102 P3-B5: blocked → in_progress WITHOUT holder credentials, legal
   *  ONLY when the item is blocked ON the given decision (blockedOn.blockerIds
   *  includes decisionRef) — the resolution IS the blocker resolving (the
   *  dependency-unblock principle). Lease preserved; never forges the holder. */
  systemUnblock(workId: string, decisionRef: string): Promise<WorkItem | null>;
  /** {claimed|in_progress|blocked} → abandoned, terminal. The lease-holder (with a
   *  matching token) OR the creator (no token — override authority) may abandon; the
   *  creator may also abandon from `ready` (bug-219 fix (c): closes items whose
   *  roleEligibility has no registered seat). */
  abandonWork(workId: string, agentId: string, opts?: { reason?: string; leaseToken?: string }): Promise<WorkItem | null>;

  /** S3 (idea-454): `ready` → `paused` — a dormancy state (unclaimable, NO lease, resumable). READY-ONLY
   *  (a claimed item has a holder+lease; pausing would zombie the claimant — use abandon/release for
   *  leased work). AUTHZ: CREATOR-only (server-stamped createdBy) OR Director override. `paused` is a
   *  non-terminal dwell state excluded from listReadyForRole + the claimable digest. NOTE: the
   *  paused→ready reverse is `unpauseWork` — NOT `resumeWork` (which is the distinct blocked→in_progress
   *  lease-holder verb; the council's 'resume_work' name collides with it, so this pair is pause/unpause). */
  pauseWork(workId: string, actor: { agentId: string; role: string }, reason?: string): Promise<WorkItem | null>;

  /** S3 (idea-454): `paused` → `ready` — reactivate a paused item back into the normal claim gate.
   *  Start-gates are NOT bypassed: deps + roleEligibility are re-validated at the subsequent claim
   *  (claimWorkItem's fail-closed authority). AUTHZ: CREATOR-only OR Director override. */
  unpauseWork(workId: string, actor: { agentId: string; role: string }): Promise<WorkItem | null>;

  /** {in_progress|review} → review|done. Appends + dedups the supplied evidence, then
   *  validates the anti-gameability predicate (coverage-by-binding + kind-match +
   *  freshness + refResolvable + no-double-count + empty-req floor). Throws
   *  EvidencePredicateFailed (fail-loud, specific reason) on any unmet condition; the
   *  row is unchanged. Parks in `review` when a review requirement is present + unmet;
   *  reaches `done` once all requirements are covered. NEVER requires a passing verdict
   *  (review evidence satisfies by EXISTING). Holder + matching token. */
  completeWork(workId: string, agentId: string, leaseToken: string, evidence: EvidenceItem[], frictionReflection?: FrictionReflectionInput): Promise<WorkItem | null>;
}
