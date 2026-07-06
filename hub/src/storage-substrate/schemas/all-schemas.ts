/**
 * mission-83 W2.3 — 20 SchemaDef entries per Design v1.3 §3.4.1 LOCKED inventory.
 *
 * Single-file consolidated form for spike-quality + ease of bilateral inspection.
 * W4 repository internal-composition refactor may split per-file if architect
 * prefers; current shape per architect-suggestion "per-file" was deferred to
 * single-file for spike-velocity (engineer-judgment; surface for review).
 *
 * Per Design v1.3 §2.3 SchemaDef shape:
 *   - kind: entity-kind name
 *   - version: shape-version (bump on field-shape change; start at 1)
 *   - fields[]: validation-only declared shape (Flavor A — no column-promote)
 *   - indexes[]: per-kind expression indexes (CREATE INDEX CONCURRENTLY at reconciler)
 *   - watchable: NOTIFY-trigger wired (default true for W2; consumer-opt-in later)
 *
 * Per-kind index choices documented inline. Indexes target known hot query
 * paths per repository code in `hub/src/entities/*.ts` + policy code patterns.
 */

import type { SchemaDef } from "../types.js";

// ─── 13 existing substrate-mediated kinds ──────────────────────────────────

const Agent: SchemaDef = {
  kind: "Agent",
  version: 2,
  fields: [
    { name: "id", type: "string", required: true },
    { name: "fingerprint", type: "string", required: true },
    { name: "role", type: "string", required: true, enum: ["engineer", "architect", "director", "verifier", "unknown"] },
    { name: "labels", type: "object", required: false },
    { name: "lastSeenAt", type: "string", required: false },
    { name: "lastHeartbeatAt", type: "string", required: false },
    { name: "sessionEpoch", type: "number", required: false },
  ],
  indexes: [
    // mission-88 W7 (bug-123): envelope-path indexes; renamed for clarity per
    // Q1. Legacy agent_role_idx + agent_fingerprint_idx auto-dropped by
    // reconciler via indexOwnershipPattern.
    { name: "agent_spec_role_idx", fields: ["spec.role"] },
    { name: "agent_metadata_fingerprint_idx", fields: ["metadata.fingerprint"] },
  ],
  watchable: true,
  indexOwnershipPattern: "^agent_",
  // mission-90 W1+W2 (Design §2.1/§2.6): runtime renameMap = the COMPLETE read-side
  // bare→envelope field-movement authority for substrate.list filter/sort
  // translation (renames AND partition-relocations). NOT a mirror of the migration
  // module's renameMap (which carries renames only; partition handles relocations at
  // write time) — instead every entry is validated against the encoder's ACTUAL
  // placement by the W1 sentinel-probe oracle (renamemap-contract-w1.test.ts). W2
  // added the partition-relocated FILTERABLE keys per the call-site sweep (finding A).
  // `fingerprint` (substrate-side assertIdentity lookup) → metadata.fingerprint.
  // C1-R2 (mission-94): thrashCount/quarantined relocate into status.* (claim-thrash
  // quarantine). NOT list-filtered, but declared here per the dual-source discipline
  // (idea-346) so the W1 sentinel-probe verifies their encoder placement (the
  // WorkItem-seeding-bug class) — mirrored in migrations/v2-envelope/kinds/Agent.ts.
  renameMap: { status: "status.phase", firstSeenAt: "metadata.createdAt", lastSeenAt: "metadata.updatedAt", fingerprint: "metadata.fingerprint", thrashCount: "status.thrashCount", quarantined: "status.quarantined" },
};

const Audit: SchemaDef = {
  kind: "Audit",
  version: 2,
  // W4.x.2 architect-blind-correction: v1 fields (entityKind/entityId/op/
  // actorRole/actorAgentId) didn't match actual AuditEntry shape used by 11
  // call-sites (hub/src/index.ts + hub-networking.ts + observability/shadow-
  // invariants.ts + policy/review-policy.ts). Actual shape per state.ts:1004:
  // { id, timestamp, actor: "architect"|"engineer"|"hub", action, details,
  //   relatedEntity: string|null }. v2 fields + indexes match actual shape;
  // surfaces as continuation of substrate-currency-failure pattern (4th-
  // instance per Design v1.4 §log; sibling to getWithRevision spec/impl gap
  // caught at W4.x.1).
  fields: [
    { name: "id", type: "string", required: true },
    { name: "timestamp", type: "string", required: true },
    { name: "actor", type: "string", required: true, enum: ["architect", "engineer", "verifier", "hub"] },
    { name: "action", type: "string", required: true },
    { name: "details", type: "string", required: true },
    { name: "relatedEntity", type: "string", required: false },
  ],
  indexes: [
    // mission-88 W7 (bug-123): envelope-path index; legacy audit_actor_idx
    // auto-dropped by reconciler via indexOwnershipPattern.
    { name: "audit_metadata_actor_idx", fields: ["metadata.actor"] },
  ],
  watchable: true,
  indexOwnershipPattern: "^audit_",
  // W2 finding-A: `actor` (substrate-side filter, audit-repo:84; indexed) relocates to metadata.actor.
  renameMap: { timestamp: "metadata.createdAt", actor: "metadata.actor" },
};

const Bug: SchemaDef = {
  kind: "Bug",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
    { name: "title", type: "string", required: false },
    { name: "class", type: "string", required: false },
    { name: "severity", type: "string", required: false, enum: ["minor", "major", "critical"] },
    { name: "status", type: "string", required: false, enum: ["open", "in-progress", "resolved", "closed"] },
  ],
  indexes: [
    // mission-88 W7 (bug-123): envelope-path + renamed per Q1.
    { name: "bug_status_phase_idx", fields: ["status.phase"] },
    { name: "bug_spec_class_idx", fields: ["spec.class"] },
  ],
  watchable: true,
  indexOwnershipPattern: "^bug_",
  // W2 finding-A: severity/class (substrate-side filters, bug-repo:128-129) relocate to spec.
  // (Cascade-keys sourceThreadId/sourceActionId/sourceIdeaId are DELIBERATELY excluded —
  // repo dual-path envelope-first dotted query + W1 null-pin; see oracle exclusion set.)
  // idea-364: `repo` (repo-scope slug for the ledger-reconciliation pass) relocates to spec.
  renameMap: { status: "status.phase", severity: "spec.severity", class: "spec.class", repo: "spec.repo", sourceThreadId: "metadata.sourceThreadId", sourceActionId: "metadata.sourceActionId", sourceIdeaId: "metadata.sourceIdeaId" },
};

const Counter: SchemaDef = {
  kind: "Counter",
  version: 1,
  fields: [
    // Special: single-row meta entity (id="counter"); embedded counter-domain keys
    // (taskCounter, proposalCounter, etc.). Field-shape is open-ended per architect-judgment.
  ],
  indexes: [],  // single row; PK (kind, id="counter") sufficient
  watchable: false,  // counter writes are bookkeeping; no consumer needs change-events
};

const Idea: SchemaDef = {
  kind: "Idea",
  version: 2,
  // W4.x.3 architect-blind-correction: v1 'title' field was a spec-recall miss
  // (actual Idea entity has 'text' field per state.ts/entities/idea.ts:15).
  // Also missing cascade-key fields (sourceThreadId/sourceActionId) load-bearing
  // for findByCascadeKey hot-path query. v2 corrects + adds idea_cascade_idx.
  // 7th-instance substrate-currency-failure pattern.
  fields: [
    { name: "id", type: "string", required: true },
    { name: "text", type: "string", required: true },
    { name: "status", type: "string", required: true, enum: ["open", "triaged", "dismissed", "incorporated"] },
    { name: "missionId", type: "string", required: false },
    { name: "sourceThreadId", type: "string", required: false },
    { name: "sourceActionId", type: "string", required: false },
  ],
  indexes: [
    // mission-88 W7 (bug-123): envelope-path + renamed per Q1.
    { name: "idea_status_phase_idx", fields: ["status.phase"] },
    // Cascade-provenance moved to metadata partition per cluster-1 Idea.ts.
    { name: "idea_metadata_cascade_idx", fields: ["metadata.sourceThreadId", "metadata.sourceActionId"] },
  ],
  watchable: true,
  indexOwnershipPattern: "^idea_",
  renameMap: { status: "status.phase", missionId: "status.missionId", sourceThreadId: "metadata.sourceThreadId", sourceActionId: "metadata.sourceActionId" },
};

const Message: SchemaDef = {
  kind: "Message",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
    { name: "kind", type: "string", required: true },  // note/task/report/review per usage
    { name: "authorRole", type: "string", required: true },
    { name: "authorAgentId", type: "string", required: true },
    { name: "threadId", type: "string", required: false },  // null for non-threaded messages
    { name: "target", type: "object", required: false },
    { name: "delivery", type: "string", required: false },
  ],
  indexes: [
    // bug-93 surfaced: per-thread message lookup is THE hot path (replaces DIY
    // mission-88 W7 (bug-123): envelope-path; threadId + authorAgentId moved to
    // metadata partition per cluster-4 Message.ts.
    { name: "message_metadata_thread_idx", fields: ["metadata.threadId"] },
    { name: "message_metadata_author_idx", fields: ["metadata.authorAgentId"] },
    // mission-90 W2 (bug-149 hot-path W6-deploy-gate): the scheduled-message
    // sweeper filters substrate-side on delivery + scheduledState every interval;
    // post-W2 these resolve to envelope paths, so they MUST be indexed before W2
    // reaches prod or bug-93 sweeper-poll-pressure recurs as JSONB full-scans.
    { name: "message_spec_delivery_idx", fields: ["spec.delivery"] },
    { name: "message_status_scheduledstate_idx", fields: ["status.scheduledState"] },
  ],
  watchable: true,
  indexOwnershipPattern: "^message_",
  // field-collision rename (cluster-4 §1.7 canonical): legacy Message.kind collides with envelope kind.
  // W2 finding-A: substrate-side filters threadId/migrationSourceId/authorAgentId→metadata.*,
  // delivery→spec.delivery, scheduledState→status.scheduledState (msg-repo + sweepers);
  // nested target.role/target.agentId→spec.target.* (read-side-only; target object relocates whole).
  renameMap: {
    kind: "metadata.messageKind",
    status: "status.phase",
    threadId: "metadata.threadId",
    migrationSourceId: "metadata.migrationSourceId",
    authorAgentId: "metadata.authorAgentId",
    delivery: "spec.delivery",
    scheduledState: "status.scheduledState",
    "target.role": "spec.target.role",
    "target.agentId": "spec.target.agentId",
  },
};

const Mission: SchemaDef = {
  kind: "Mission",
  version: 2,
  // W4.x.5 architect-blind-correction: v1 enum {proposed/active/shipped/
  // retrospective/closed} vs actual MissionStatus {proposed/active/completed/
  // abandoned}; v1 field 'class' vs actual 'missionClass'. v2 corrected +
  // cascade-key fields added for findByCascadeKey hot-path (Mission-24 Phase 2
  // INV-TH20 idempotency-key). 9th-instance substrate-currency-failure pattern.
  fields: [
    { name: "id", type: "string", required: true },
    { name: "title", type: "string", required: true },
    { name: "status", type: "string", required: true, enum: ["proposed", "active", "completed", "abandoned"] },
    { name: "missionClass", type: "string", required: false },
    { name: "correlationId", type: "string", required: false },
    { name: "sourceThreadId", type: "string", required: false },
    { name: "sourceActionId", type: "string", required: false },
  ],
  indexes: [
    { name: "mission_status_phase_idx", fields: ["status.phase"] },
    // Cascade-provenance moved to metadata partition per cluster-1 Mission.ts.
    { name: "mission_metadata_cascade_idx", fields: ["metadata.sourceThreadId", "metadata.sourceActionId"] },
  ],
  watchable: true,
  indexOwnershipPattern: "^mission_",
  renameMap: { status: "status.phase", sourceThreadId: "metadata.sourceThreadId", sourceActionId: "metadata.sourceActionId" },
};

const PendingAction: SchemaDef = {
  kind: "PendingAction",
  version: 2,
  // W4.x.6 architect-blind-correction (minor gaps per architect proactive audit
  // thread-569 round 5): v1 missing 'naturalKey' field which is INV-PA2
  // idempotency-key hot-path (every enqueue call scans for naturalKey collision);
  // entityRef tightened to required. 10th-instance substrate-currency-failure
  // (minor variant; not load-breaking).
  fields: [
    { name: "id", type: "string", required: true },
    { name: "targetAgentId", type: "string", required: true },
    { name: "dispatchType", type: "string", required: true },
    { name: "state", type: "string", required: true, enum: ["enqueued", "receipt_acked", "completion_acked", "errored", "escalated", "continuation_required"] },
    { name: "entityRef", type: "string", required: true },
    { name: "naturalKey", type: "string", required: true },
  ],
  indexes: [
    // mission-88 W7 (bug-123): envelope-path; targetAgentId+naturalKey in spec/
    // metadata; state renamed to status.phase per cluster-2 PendingAction.ts.
    { name: "pa_spec_target_idx", fields: ["spec.targetAgentId"] },
    { name: "pa_status_phase_idx", fields: ["status.phase"] },
    { name: "pa_metadata_natural_key_idx", fields: ["metadata.naturalKey"] },
  ],
  watchable: true,
  indexOwnershipPattern: "^pa_",
  // W2 finding-A: substrate-side filters naturalKey→metadata.naturalKey (indexed),
  // targetAgentId→spec.targetAgentId (indexed), dispatchType/entityRef→spec.* (pa-repo).
  renameMap: {
    state: "status.phase",
    enqueuedAt: "metadata.createdAt",
    naturalKey: "metadata.naturalKey",
    targetAgentId: "spec.targetAgentId",
    dispatchType: "spec.dispatchType",
    entityRef: "spec.entityRef",
  },
};

const Proposal: SchemaDef = {
  kind: "Proposal",
  version: 2,
  // W4.x.7 architect-blind-correction: v1 multi-mismatch — field 'state' should
  // be 'status' (verbatim spec-recall miss); enum [active/accepted/rejected/
  // closed] vs actual ProposalStatus [submitted/approved/rejected/changes_requested/
  // implemented] (only 'rejected' overlaps; 4 of 5 invalid). v2 corrected +
  // cascade-key fields added for findByCascadeKey hot-path. 11th-instance
  // substrate-currency-failure pattern.
  fields: [
    { name: "id", type: "string", required: true },
    { name: "title", type: "string", required: true },
    { name: "status", type: "string", required: true, enum: ["submitted", "approved", "rejected", "changes_requested", "implemented"] },
    { name: "correlationId", type: "string", required: false },
    { name: "sourceThreadId", type: "string", required: false },
    { name: "sourceActionId", type: "string", required: false },
  ],
  indexes: [
    { name: "proposal_status_phase_idx", fields: ["status.phase"] },
    { name: "proposal_metadata_cascade_idx", fields: ["metadata.sourceThreadId", "metadata.sourceActionId"] },
  ],
  watchable: true,
  indexOwnershipPattern: "^proposal_",
  renameMap: { status: "status.phase", sourceThreadId: "metadata.sourceThreadId", sourceActionId: "metadata.sourceActionId" },
};

// work-162 (A1): Task SchemaDef DELETED with the Task subsystem. Historical
// Task rows remain immutable in the substrate (A4 zero-loss) — no read path.

const Thread: SchemaDef = {
  kind: "Thread",
  version: 2,
  // W4.x.10 architect-blind-correction: v1 status enum [active/converged/
  // closed/force_closed] vs actual ThreadStatus [active/converged/round_limit/
  // closed/abandoned/cascade_failed] (6 values; 1 of 4 in v1 invalid 'force_closed';
  // 3 missing: round_limit/abandoned/cascade_failed). routingMode enum matches.
  // 13th-instance substrate-currency-failure pattern.
  fields: [
    { name: "id", type: "string", required: true },
    { name: "title", type: "string", required: false },
    { name: "status", type: "string", required: true, enum: ["active", "converged", "round_limit", "closed", "abandoned", "cascade_failed"] },
    { name: "routingMode", type: "string", required: false, enum: ["unicast", "multicast", "broadcast"] },
    { name: "currentTurnAgentId", type: "string", required: false },
    { name: "correlationId", type: "string", required: false },
  ],
  indexes: [
    // mission-88 W7 (bug-123): LOAD-BEARING — pre-W7 thread_status_idx was the
    // root-cause of 491 Thread row-write-failures at W6 Phase B Step 7 (envelope-
    // shape inflated indexed expression past 8191-byte btree limit). New
    // expression-path targets status.phase string (small) rather than entire
    // status object (large) — eliminates btree-overflow risk.
    { name: "thread_status_phase_idx", fields: ["status.phase"] },
    // currentTurnAgentId moved to status partition per cluster-1 Thread.ts.
    { name: "thread_status_turn_agent_idx", fields: ["status.currentTurnAgentId"] },
    // mission-90 W2 (bug-149 hot-path W6-deploy-gate): cascade-sweeper queries
    // cascadePending at Hub-startup; post-W2 it resolves to status.cascadePending,
    // so it must be indexed before W2 reaches prod (else startup JSONB full-scan).
    { name: "thread_status_cascadepending_idx", fields: ["status.cascadePending"] },
  ],
  watchable: true,
  // Negative-lookahead excludes ThreadHistoryEntry's `threadhist_` prefix
  // (sibling-kind name-collision risk) from Thread's ownership domain.
  indexOwnershipPattern: "^thread_(?!hist_)",
  // W2 finding-A: substrate-side filters cascadePending→status.cascadePending,
  // currentTurnAgentId→status.currentTurnAgentId (thread-repo + cascade-sweeper).
  // mission-93 bug-170: recipientAgentId→spec.recipientAgentId — the Thread.ts
  // partition relocates it to spec (Thread.test.ts:81) but the finding-A sweep
  // missed the renameMap entry, so substrate-side filter-translate mis-pathed it
  // to top-level → directed-thread discovery by recipientAgentId returned zero
  // (read still worked via normalizeThreadShape's flat-spread, masking the gap).
  renameMap: { status: "status.phase", cascadePending: "status.cascadePending", currentTurnAgentId: "status.currentTurnAgentId", recipientAgentId: "spec.recipientAgentId" },
};

// work-162 (A1): Turn SchemaDef DELETED with the Turn subsystem. Historical
// Turn rows remain immutable in the substrate (A4 zero-loss) — no read path.

// ─── 2 NEW kinds this mission ──────────────────────────────────────────────

const SchemaDefMeta: SchemaDef = {
  // Self-referential per §2.3 bootstrap-self-bootstrap: SchemaDef-for-SchemaDef
  // describes SchemaDef's own shape; reconciler reads this entry first to emit
  // SchemaDef's own indexes
  kind: "SchemaDef",
  version: 1,
  fields: [
    { name: "kind", type: "string", required: true },
    { name: "version", type: "number", required: true },
    { name: "fields", type: "array", required: false },
    { name: "indexes", type: "array", required: false },
    { name: "watchable", type: "boolean", required: false },
  ],
  indexes: [
    // SchemaDef lookup by entity-kind (PK kind+id already covers this since id=kind-name;
    // no separate index needed — engineer-judgment per architect "obvious cases just apply")
  ],
  watchable: true,
  // the SchemaDef-kind rename attaches HERE (the only const with kind="SchemaDef"; Design §2.6)
  renameMap: { kind: "metadata.name" },
};

const Notification: SchemaDef = {
  // mission-88 W8 bug-124 fix: v2 schema matches actual production shape per W8
  // Design v1.0 §2 audit. v1 fields (recipientRole/recipientAgentId) did NOT
  // match production — actual shape carries targetRoles[] (array) + data (object) +
  // timestamp. v1.3-cluster-4-correction removed Notification from kinds[] entirely
  // based on incomplete code-trace; W8 production-state psql audit found 555 rows.
  // Substrate-currency catch — sibling of W4.x.2 Audit-v2-correction pattern.
  kind: "Notification",
  version: 2,
  fields: [
    { name: "id", type: "string", required: true },
    { name: "event", type: "string", required: true },
    { name: "timestamp", type: "string", required: true },
    { name: "targetRoles", type: "array", required: true },
    { name: "data", type: "object", required: false },
  ],
  // Index expressions deferred to W7 cluster-4 retro-audit (Q4 retro-audit
  // timing concurred). targetRoles[] needs GIN-or-expression strategy.
  // notification_recipient_idx removed: recipientAgentId field never existed in
  // production shape (v1 inventory drift). mission-88 W7 ownership-pattern
  // drops any legacy notification_*_idx from production via reconciler.
  // GIN-or-expression strategy for spec.targetRoles[] deferred to post-mission-88
  // (W7 Q5 engineer-lean (c); composes with idea-151 M-Graph-Relationships).
  indexes: [],
  watchable: true,
  indexOwnershipPattern: "^notification_",
  renameMap: { event: "spec.eventType", timestamp: "metadata.createdAt" },
};

// ─── 5 W0-architect-VERIFIED kinds ─────────────────────────────────────────

const Document: SchemaDef = {
  kind: "Document",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
    { name: "category", type: "string", required: false },
    { name: "content", type: "string", required: true },  // markdown body
  ],
  indexes: [
    // mission-88 W7: category moved to metadata.labels.category per W5 Document
    // K8s-convention array-to-map transformation (Design v0.3 §2.4).
    { name: "document_metadata_labels_category_idx", fields: ["metadata.labels.category"] },
  ],
  watchable: true,
  indexOwnershipPattern: "^document_",
  // W2 finding-A: `category` (substrate-side filter, DocumentRepository.list, new-repos:63;
  // indexed) → metadata.labels.category. preTransform is scalar→map-ENTRY (labels={category:v}),
  // NOT array→map, so value-equality survives at the dotted path (probe-faithful). Document
  // therefore leaves the rename-free set (was rename-free pre-W2).
  renameMap: { category: "metadata.labels.category" },
};

const ArchitectDecision: SchemaDef = {
  // OQ7 decomposition; from architect-context/decisions.json {decision, context, timestamp} entries
  kind: "ArchitectDecision",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
    { name: "decision", type: "string", required: false },
    { name: "context", type: "string", required: false },
    { name: "timestamp", type: "string", required: false },
  ],
  indexes: [
    // Chronological — base entities_updated_at_idx covers; no per-kind index needed
    // unless mission-correlation queries surface (architect-judgment for v2+)
  ],
  watchable: true,
  renameMap: { timestamp: "metadata.createdAt" },
};

const DirectorHistoryEntry: SchemaDef = {
  // OQ7 decomposition; from architect-context/director-history.json {role, text, ...} entries
  kind: "DirectorHistoryEntry",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
    { name: "role", type: "string", required: false },
    { name: "text", type: "string", required: false },
  ],
  indexes: [
    // Chronological per base index
  ],
  watchable: true,
  renameMap: { timestamp: "metadata.createdAt" },
};

const ReviewHistoryEntry: SchemaDef = {
  // OQ7 decomposition; from architect-context/review-history.json {taskId, assessment, ...} entries
  kind: "ReviewHistoryEntry",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
    { name: "taskId", type: "string", required: false },
    { name: "assessment", type: "string", required: false },
  ],
  indexes: [
    // mission-88 W7: taskId moved to metadata partition per cluster-5 W5 Design.
    { name: "review_metadata_task_idx", fields: ["metadata.taskId"] },
  ],
  watchable: true,
  indexOwnershipPattern: "^review_",
  // W2 finding-A: taskId (substrate-side filter, new-repos:209; indexed) → metadata.taskId.
  // (Repo unwired in prod today; completes the authority for when it wires.)
  renameMap: { timestamp: "metadata.createdAt", taskId: "metadata.taskId" },
};

const ThreadHistoryEntry: SchemaDef = {
  // OQ7 decomposition (NEW finding architect W1.1); from architect-context/thread-history.json
  // {threadId, title, outcome, timestamp} entries (archived thread summaries)
  kind: "ThreadHistoryEntry",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
    { name: "threadId", type: "string", required: false },
    { name: "title", type: "string", required: false },
    { name: "outcome", type: "string", required: false },
    { name: "timestamp", type: "string", required: false },
  ],
  indexes: [
    // mission-88 W7: threadId moved to metadata partition per cluster-5 W5 Design.
    { name: "threadhist_metadata_thread_idx", fields: ["metadata.threadId"] },
  ],
  watchable: true,
  indexOwnershipPattern: "^threadhist_",
  // W2 finding-A: threadId (substrate-side filter, new-repos:247; indexed) → metadata.threadId.
  // (Repo unwired in prod today; completes the authority for when it wires.)
  renameMap: { timestamp: "metadata.createdAt", threadId: "metadata.threadId" },
};

// mission-84 W3: 2 new bookkeeping-only kinds for repo-event-bridge cursor +
// dedupe substrate-persistence (cluster #23 closure). Per Design v1.1 §2.3
// Variant (ii) minimal-SchemaDef: no hot fields (no per-kind expression
// indexes), opaque JSON body, watchable: false (bookkeeping writes; no
// consumer needs change-events; pre-resolves F5 future-target probe).
// Substrate body shape: { id: "<owner>__<repo>", body: <cursor-store-encoded-JSON> }
// (cursor-store.ts internal opaque blob preserved unchanged via the
// RepoEventBridgeSubstrateAdapter Uint8Array↔JSONB conversion seam).
const RepoEventBridgeCursor: SchemaDef = {
  kind: "RepoEventBridgeCursor",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
  ],
  indexes: [],
  watchable: false,
  renameMap: { body: "status.cursor" },
};

const RepoEventBridgeDedupe: SchemaDef = {
  kind: "RepoEventBridgeDedupe",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
  ],
  indexes: [],
  watchable: false,
  renameMap: { body: "status.dedupe" },
};

// ─── mission-88 W0 — MigrationCursor (per A2 thread-635 + Q3 thread-639) ───

/**
 * Per-kind migration progress checkpoint for the v2-envelope cutover.
 *
 * Counter-divergence rationale (per thread-639 R2 architect-note): Counter
 * is a single-row meta entity ({id: "counter", taskCounter, ideaCounter, ...})
 * because it's a tiny-write/high-frequency primitive where atomic CAS over
 * one row is cheap. MigrationCursor is per-kind low-frequency — each kind
 * gets its own row ({id: "cursor-<KindName>"}) to avoid CAS contention on
 * parallel-wave updates AND to align with the per-wave acceptance-gate
 * per-kind discipline + per-kind module idempotency contract.
 *
 * Single row per kind being migrated; substrate.get/put semantics with
 * putIfMatch CAS-safe on resume. Inspectable via get-entities.sh per A4
 * thread-635 disposition.
 */
const MigrationCursor: SchemaDef = {
  kind: "MigrationCursor",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
    { name: "lastMigratedId", type: "string", required: true },
    { name: "lastMigratedAt", type: "string", required: true },
    { name: "waveId", type: "string", required: false },
  ],
  indexes: [],  // low-volume; PK (kind, id="cursor-<kind>") sufficient
  watchable: false,  // bookkeeping-only; no consumer needs change-events
};

// ─── C1-R2 (mission-94): the WorkItem work-queue kind (kind #26) ─────────────
// Reference-only claimable work-item; born under the live C3-R4 governor.
const WorkItem: SchemaDef = {
  kind: "WorkItem",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
    { name: "type", type: "string", required: false, enum: ["task", "bug", "review", "verifier-gate", "freeform"] },
    { name: "priority", type: "string", required: false, enum: ["critical", "high", "normal", "low"] },
    { name: "status", type: "string", required: false, enum: ["ready", "claimed", "in_progress", "blocked", "paused", "review", "done", "abandoned"] },
  ],
  indexes: [
    { name: "workitem_status_phase_idx", fields: ["status.phase"] },
    { name: "workitem_status_lease_holder_idx", fields: ["status.lease.holder"] },
    { name: "workitem_status_lease_expiresat_idx", fields: ["status.lease.expiresAt"] },
    // C1-R2: GIN index backing the $contains (@>) array-membership on roleEligibility.
    { name: "workitem_spec_roleeligibility_gin_idx", fields: ["spec.roleEligibility"], type: "gin" },
    // work-88 (arc-node): GIN index backing the reverse-ancestor lookup over the
    // COMPLETION-gate edge — "which parents name <child> in completionDependsOn?".
    // An in-memory scan past the 500-cap is a silent-miss (cal #90); this $contains
    // (@>) membership stays index-backed instead.
    { name: "workitem_spec_completiondependson_gin_idx", fields: ["spec.completionDependsOn"], type: "gin" },
  ],
  watchable: true,
  indexOwnershipPattern: "^workitem_",
  // status→status.phase; the status sub-objects (lease/evidence/blockedOn/
  // leaseExpiryCount) route to status; the FILTERABLE spec fields (priority/type/
  // roleEligibility/completionDependsOn) route to spec. dependsOn/evidenceRequirements/
  // targetRef/payload are unfiltered → default-partition to spec (no entry needed). The
  // two HOT lease sub-fields (holder, expiresAt) filter via the bucket-prefixed dotted
  // path (status.lease.*) — NO renameMap alias (option (c), thread-694; governor-sanctioned).
  // work-88 (arc-node): completionDependsOn is FILTERABLE — the renewLease transitive-
  // heartbeat reverse-ancestor lookup ($contains over spec.completionDependsOn, backed by
  // workitem_spec_completiondependson_gin_idx) — so it needs the explicit spec alias (an
  // unmapped filter field is a loud FilterTranslationGapError on a partitioned kind).
  renameMap: {
    status: "status.phase",
    lease: "status.lease",
    evidence: "status.evidence",
    blockedOn: "status.blockedOn",
    leaseExpiryCount: "status.leaseExpiryCount",
    // idea-384 Part A (work-98): per-FSM-state wall-clock timers — status (lifecycle),
    // non-filterable (no index; surfaced on get_work/get_current_stint, not queried).
    enteredCurrentStateAt: "status.enteredCurrentStateAt",
    stateDurations: "status.stateDurations",
    // SEAL (idea-444): the attestation subtree — status (lifecycle), non-filterable
    // (surfaced on get_work, not queried). Mirrors the kinds/WorkItem.ts status partition
    // (the W1 renamemap-contract sentinel-probe asserts this agreement).
    attestationHistory: "status.attestationHistory",
    attestations: "status.attestations",
    executorHistory: "status.executorHistory",
    priority: "spec.priority",
    type: "spec.type",
    roleEligibility: "spec.roleEligibility",
    completionDependsOn: "spec.completionDependsOn",
  },
};

// ─── mission-102 P3-B1: the Decision authority-resolution kind ───────────────
// Sovereign authority node (design.md v1.0 §1.1, G2-ratified): no lease, no timer
// transitions, no WIP interaction. Filterable: status.phase (queue views), spec.class
// (ontology/grant queries), status.routedTo.target (the director arrival-surface pull).
const Decision: SchemaDef = {
  kind: "Decision",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
    { name: "class", type: "string", required: false },
    { name: "status", type: "string", required: false, enum: ["raised", "curated", "routed", "resolved", "executed", "merged", "disposed", "withdrawn"] },
  ],
  indexes: [
    { name: "decision_status_phase_idx", fields: ["status.phase"] },
    { name: "decision_spec_class_idx", fields: ["spec.class"] },
    { name: "decision_status_routedto_target_idx", fields: ["status.routedTo.target"] },
  ],
  watchable: true,
  indexOwnershipPattern: "^decision_",
  // status→status.phase; lifecycle sub-objects (actors stamped at transitions, route,
  // resolution, exits, dwell timers) route to status; the FILTERABLE spec field (class)
  // gets the explicit alias. Immutable-at-raise fields (title/context/options/
  // contextRefs/raisedBy/parentRef/executionPlan) default-partition to spec.
  renameMap: {
    status: "status.phase",
    class: "spec.class",
    curatedBy: "status.curatedBy",
    curationRecordRef: "status.curationRecordRef",
    routedTo: "status.routedTo",
    routedBy: "status.routedBy",
    resolution: "status.resolution",
    mergedInto: "status.mergedInto",
    disposedReason: "status.disposedReason",
    enteredCurrentStateAt: "status.enteredCurrentStateAt",
    stateDurations: "status.stateDurations",
  },
};

// ─── mission-102 P3-B4: the Director proof-path kinds ───────────────────────
// DirectorSignal: immutable Hub-stamped capture of Director intent at a registered
// ingress (design §1.3; the bug-224 fix's provenance object). Get-by-id only — no
// filtered queries, no renameMap, no indexes beyond PK.
const DirectorSignal: SchemaDef = {
  kind: "DirectorSignal",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
  ],
  indexes: [],
  watchable: false,
};

// DirectorConfirmation: Hub-minted prompt-render token, hash-bound, consumed
// exactly once under CAS (design §1.3). Get-by-id only (the resolve carries the id).
const DirectorConfirmation: SchemaDef = {
  kind: "DirectorConfirmation",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
  ],
  indexes: [],
  watchable: false,
};

// ─── mission-103 P3-S1: the constitutional serve-substrate kinds ─────────────
// ConstitutionSnapshot: the singleton read-serve mirror of the git-canonical
// axiom set (decision-17 design §1). Whole-corpus row — the CAS unit IS the
// atomicity unit (a reader can never observe a mixed-version constitution).
// Get-by-id only (`current` + `snap-<sha>` history); content opaque verbatim
// markdown (validation = sync-time parse gate, never a schema at rest).
const ConstitutionSnapshot: SchemaDef = {
  kind: "ConstitutionSnapshot",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
  ],
  indexes: [],
  watchable: false,
};

// OrgCharter: the Hub-native org layer (T1 two-layer stack) — versioned
// append-only rows; charter mutation exists ONLY as decision-rail registry
// actions (bind_axiom / amend_charter), so every row carries rail proof.
// Get-by-id + tiny full-kind scans.
const OrgCharter: SchemaDef = {
  kind: "OrgCharter",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
  ],
  indexes: [],
  watchable: false,
};

// ─── mission-102 P3-B3: the ClassGrant delegation kind ───────────────────────
// Typed-constraint delegation, row-per-version immutable (design §1.2). Filterable:
// status.state (active-grant lookups + drift audits), spec.class (per-class queries).
const ClassGrant: SchemaDef = {
  kind: "ClassGrant",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
    { name: "class", type: "string", required: false },
    { name: "state", type: "string", required: false, enum: ["active", "revoked", "superseded"] },
  ],
  indexes: [
    { name: "classgrant_status_state_idx", fields: ["status.state"] },
    { name: "classgrant_spec_class_idx", fields: ["spec.class"] },
  ],
  watchable: false,
  indexOwnershipPattern: "^classgrant_",
  renameMap: {
    state: "status.state",
    class: "spec.class",
    supersededBy: "status.supersededBy",
  },
};

// GrantRatification: the single-use ratification-consumption row (audit-9897) —
// PK = the ratificationRef; createOnly on this kind IS the atomicity primitive.
const GrantRatification: SchemaDef = {
  kind: "GrantRatification",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
  ],
  indexes: [],
  watchable: false,
};

// ─── mission-102 P3-B6: the arrival-surface delivery-accounting kinds ────────
// Presenter-side receipts, never authority state: ArrivalSnapshot (the server-
// side proof a render happened — DELIVERED=PRESENTED), NudgeReceipt (the aging
// path's emission/receipt chain), DirectorPresence (singleton). Get-by-id +
// small capped lists; no renameMaps.
const ArrivalSnapshot: SchemaDef = {
  kind: "ArrivalSnapshot",
  version: 1,
  fields: [{ name: "id", type: "string", required: true }],
  indexes: [],
  watchable: false,
};
const NudgeReceipt: SchemaDef = {
  kind: "NudgeReceipt",
  version: 1,
  fields: [{ name: "id", type: "string", required: true }],
  indexes: [],
  watchable: false,
};
const DirectorPresence: SchemaDef = {
  kind: "DirectorPresence",
  version: 1,
  fields: [{ name: "id", type: "string", required: true }],
  indexes: [],  // singleton row
  watchable: false,
};

// ─── mission-102 P3-B2: the append-only curation-trail kinds ─────────────────
// RawDecisionRaised (immutable raise capture) + CurationRecord (append-only
// curation acts). Both createOnly-only — no update path exists. Get + paged
// id-ordered scans; no renameMaps, no filtered queries.
const RawDecisionRaised: SchemaDef = {
  kind: "RawDecisionRaised",
  version: 1,
  fields: [{ name: "id", type: "string", required: true }],
  indexes: [],
  watchable: false,
};
const CurationRecord: SchemaDef = {
  kind: "CurationRecord",
  version: 1,
  fields: [{ name: "id", type: "string", required: true }],
  indexes: [],
  watchable: false,
};

// ─── Export all 23 SchemaDef entries ───────────────────────────────────────

/**
 * All 23 substrate-mediated kinds — mission-84 W3 extends mission-83's 20-kind
 * locked inventory with RepoEventBridgeCursor + RepoEventBridgeDedupe (cluster
 * #23 closure per Design v1.1 §2.3 Variant ii minimal-SchemaDef); mission-88
 * W0 adds MigrationCursor (per-kind migration-progress checkpoint for the
 * v2-envelope cutover per thread-639 Q3 disposition).
 *
 * Reconciler boot-time iterates this list + applies via substrate.put('SchemaDef', def).
 *
 * Order: SchemaDef FIRST (per §2.3 bootstrap-self-referential; reconciler reads
 * SchemaDef-for-SchemaDef before any other entries to emit SchemaDef's own indexes).
 */
export const ALL_SCHEMAS: SchemaDef[] = [
  SchemaDefMeta,  // self-referential bootstrap — MUST be first

  // 13 existing substrate-mediated
  Agent,
  Audit,
  Bug,
  Counter,
  Idea,
  Message,
  Mission,
  PendingAction,
  Proposal,
  Thread,

  // 1 NEW substrate (re-introduction)
  Notification,

  // 5 W0-architect-VERIFIED
  Document,
  ArchitectDecision,
  DirectorHistoryEntry,
  ReviewHistoryEntry,
  ThreadHistoryEntry,

  // 2 NEW mission-84 W3 (repo-event-bridge cursor + dedupe; cluster #23 closure)
  RepoEventBridgeCursor,
  RepoEventBridgeDedupe,

  // 1 NEW mission-88 W0 (migration-progress checkpoint for v2-envelope cutover)
  MigrationCursor,

  // 1 NEW C1-R2 mission-94 (the claimable work-queue keystone kind)
  WorkItem,

  // 1 NEW mission-102 P3-B1 (the Decision authority-resolution spine)
  Decision,

  // 2 NEW mission-102 P3-B4 (the Director proof-path objects)
  DirectorSignal,
  DirectorConfirmation,
  ConstitutionSnapshot,
  OrgCharter,

  // 2 NEW mission-102 P3-B3 (typed-constraint delegation + its single-use
  // ratification-consumption companion)
  ClassGrant,
  GrantRatification,

  // 3 NEW mission-102 P3-B6 (arrival-surface delivery accounting)
  ArrivalSnapshot,
  NudgeReceipt,
  DirectorPresence,

  // 2 NEW mission-102 P3-B2 (append-only curation trail)
  RawDecisionRaised,
  CurationRecord,
];
