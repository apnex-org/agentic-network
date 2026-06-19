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
    { name: "role", type: "string", required: true, enum: ["engineer", "architect", "director", "unknown"] },
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
  renameMap: { status: "status.phase", firstSeenAt: "metadata.createdAt", lastSeenAt: "metadata.updatedAt", fingerprint: "metadata.fingerprint" },
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
    { name: "actor", type: "string", required: true, enum: ["architect", "engineer", "hub"] },
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
  renameMap: { status: "status.phase", severity: "spec.severity", class: "spec.class" },
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
  renameMap: { status: "status.phase", missionId: "status.missionId" },
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
  renameMap: { status: "status.phase" },
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
  renameMap: { status: "status.phase" },
};

const Task: SchemaDef = {
  kind: "Task",
  // v1→v2 (mission-87 W3 / idea-302): completes the mission-62
  // agent-identifier rename for the Task entity — the legacy
  // claimant field is now `assignedAgentId`. The index is RENAMED
  // task_assigned_agent_idx → task_agent_idx (not fields-only-changed):
  // the reconciler's `CREATE INDEX … IF NOT EXISTS <name>` keys on the
  // name, so a fields-only change under an unchanged name silently
  // no-ops, leaving the index bound to the dead old expression. The
  // data-key rename for existing substrate rows + the orphaned-index
  // drop are hub/scripts/migrate-task-engineerid-to-agentid.ts.
  version: 2,
  fields: [
    { name: "id", type: "string", required: true },
    { name: "directive", type: "string", required: false },
    { name: "status", type: "string", required: false, enum: ["pending", "working", "blocked", "input_required", "in_review", "completed", "failed", "escalated", "cancelled"] },
    { name: "assignedAgentId", type: "string", required: false },
    { name: "turnId", type: "string", required: false },
    // NOTE: clarification is INLINE FIELD on task (clarificationQuestion +
    // clarificationAnswer per task-repository.ts grep) — NOT separate kind
  ],
  indexes: [
    { name: "task_status_phase_idx", fields: ["status.phase"] },
    // assignedAgentId moved to spec partition per cluster-2 Task.ts.
    { name: "task_spec_agent_idx", fields: ["spec.assignedAgentId"] },
  ],
  watchable: true,
  indexOwnershipPattern: "^task_",
  // W2 finding-A / bug-147 (CRITICAL): idempotencyKey is a LIVE single-path filter
  // (findByIdempotencyKey, task-repo:177) with NO repo dual-path — bare → null on
  // envelope rows post-W6 → idempotency dedup silently breaks → duplicate task
  // creation. Relocates to metadata.idempotencyKey. (Cascade-keys excluded — see oracle.)
  renameMap: { status: "status.phase", idempotencyKey: "metadata.idempotencyKey", createdAt: "metadata.createdAt", createdBy: "metadata.createdBy", updatedAt: "metadata.updatedAt" },
};

const Tele: SchemaDef = {
  kind: "Tele",
  version: 2,
  // W4.x.9 architect-blind-correction (architect proactive audit thread-569
  // round 5 confirmed 4 issues): v1 had FOUR fabricated fields — 'class' /
  // 'outcomes' / 'supersedesId' DON'T EXIST on Tele entity (largest single-
  // SchemaDef fabrication-density of mission-83); actual fields per
  // hub/src/entities/tele.ts:18 are name/description/successCriteria/status/
  // supersededBy/retiredAt/createdBy/createdAt. v2 corrected. 12th-instance
  // substrate-currency-failure pattern (most-fabricated v1 SchemaDef in mission).
  fields: [
    { name: "id", type: "string", required: true },
    { name: "name", type: "string", required: true },
    { name: "status", type: "string", required: true, enum: ["active", "superseded", "retired"] },
    { name: "supersededBy", type: "string", required: false },
    { name: "retiredAt", type: "string", required: false },
  ],
  indexes: [
    { name: "tele_status_phase_idx", fields: ["status.phase"] },
    // supersededBy in status partition per cluster-3 Tele.ts FSM-mutated fields.
    { name: "tele_status_supersededby_idx", fields: ["status.supersededBy"] },
  ],
  watchable: true,
  indexOwnershipPattern: "^tele_",
  renameMap: { status: "status.phase", name: "metadata.name" },
};

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
  renameMap: { status: "status.phase", cascadePending: "status.cascadePending", currentTurnAgentId: "status.currentTurnAgentId" },
};

const Turn: SchemaDef = {
  kind: "Turn",
  version: 2,
  // W4.x.11 architect-blind-correction (architect proactive audit thread-569
  // round 5 flagged 'essentially-fabricated; needs total rewrite'): v1 had
  // 'agentId' (DOESN'T EXIST on Turn entity — likely confused with Agent
  // entity), 'missionId' scalar (actual is missionIds[] array), missing 'status'
  // (TurnStatus enum [planning/active/completed]). Actual fields per
  // hub/src/entities/turn.ts: id/title/scope/status/missionIds[]/taskIds[]/
  // tele[]/correlationId/createdBy/createdAt/updatedAt. v2 corrected — full
  // rewrite. 14th-instance substrate-currency-failure pattern (most-fabricated
  // SchemaDef tied with Tele v1 at 3+ fabricated fields).
  fields: [
    { name: "id", type: "string", required: true },
    { name: "title", type: "string", required: true },
    { name: "status", type: "string", required: true, enum: ["planning", "active", "completed"] },
    { name: "correlationId", type: "string", required: false },
  ],
  indexes: [
    // turn_agent_idx + turn_mission_idx (v1) DROPPED — fields don't exist on Turn.
    // Virtual-view hydration of missionIds/taskIds happens via
    // missionStore.listMissions() + taskStore.listTasks() filter by turnId
    // (Mission/Task entities carry turnId field; lookup uses those indexes).
    { name: "turn_status_phase_idx", fields: ["status.phase"] },
  ],
  watchable: true,
  indexOwnershipPattern: "^turn_",
  renameMap: { status: "status.phase", title: "metadata.name" },
};

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
  Task,
  Tele,
  Thread,
  Turn,

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
];
