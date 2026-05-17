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
    // Mediated by IEngineerRegistry; by-role queries hot for list_available_peers + status checks
    { name: "agent_role_idx", fields: ["role"] },
    // W4.x.1 — fingerprint is identity-lookup hot path (assertIdentity); replaces
    // FS-version agents/by-fingerprint/<fp>.json mirror (single canonical row per
    // agentId with fingerprint-indexed query supersedes dual-write mirror pattern).
    { name: "agent_fingerprint_idx", fields: ["fingerprint"] },
  ],
  watchable: true,
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
    // listEntries(actor) is the hot-path query (filter-by-actor at substrate boundary)
    { name: "audit_actor_idx", fields: ["actor"] },
  ],
  watchable: true,
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
    { name: "bug_status_idx", fields: ["status"] },
    { name: "bug_class_idx", fields: ["class"] },
  ],
  watchable: true,
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
    { name: "idea_status_idx", fields: ["status"] },
    // findByCascadeKey is hot-path query (Mission-24 Phase 2 INV-TH20 idempotency key)
    { name: "idea_cascade_idx", fields: ["sourceThreadId", "sourceActionId"] },
  ],
  watchable: true,
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
    // messages-thread-index/ secondary index from FS-substrate per Design §3.4.2)
    { name: "message_thread_idx", fields: ["threadId"] },
    // Author/recipient lookups for engineer-pulse + thread-replay
    { name: "message_author_idx", fields: ["authorAgentId"] },
  ],
  watchable: true,
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
    { name: "mission_status_idx", fields: ["status"] },
    // findByCascadeKey hot-path (Mission-24 Phase 2 INV-TH20 idempotency-key)
    { name: "mission_cascade_idx", fields: ["sourceThreadId", "sourceActionId"] },
  ],
  watchable: true,
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
    // Hot path: queue-drain by-target-agent
    { name: "pa_target_idx", fields: ["targetAgentId"] },
    // State queries for sweeper + admin
    { name: "pa_state_idx", fields: ["state"] },
    // INV-PA2 idempotency-key lookup (called on every enqueue)
    { name: "pa_natural_key_idx", fields: ["naturalKey"] },
  ],
  watchable: true,
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
    { name: "proposal_status_idx", fields: ["status"] },
    // findByCascadeKey hot-path (Mission-24 Phase 2 INV-TH20 idempotency-key)
    { name: "proposal_cascade_idx", fields: ["sourceThreadId", "sourceActionId"] },
  ],
  watchable: true,
};

const Task: SchemaDef = {
  kind: "Task",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
    { name: "directive", type: "string", required: false },
    { name: "status", type: "string", required: false, enum: ["pending", "working", "blocked", "input_required", "in_review", "completed", "failed", "escalated", "cancelled"] },
    { name: "assignedEngineerId", type: "string", required: false },
    { name: "turnId", type: "string", required: false },
    // NOTE: clarification is INLINE FIELD on task (clarificationQuestion +
    // clarificationAnswer per task-repository.ts grep) — NOT separate kind
  ],
  indexes: [
    { name: "task_status_idx", fields: ["status"] },
    { name: "task_engineer_idx", fields: ["assignedEngineerId"] },
  ],
  watchable: true,
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
    { name: "tele_status_idx", fields: ["status"] },
    // supersede-chain lookup (supersedeTele consumer)
    { name: "tele_supersededby_idx", fields: ["supersededBy"] },
  ],
  watchable: true,
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
    { name: "thread_status_idx", fields: ["status"] },
    // currentTurnAgentId lookup for unpinCurrentTurnAgent (agent-reaper hot-path)
    { name: "thread_turn_agent_idx", fields: ["currentTurnAgentId"] },
  ],
  watchable: true,
};

const Turn: SchemaDef = {
  kind: "Turn",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
    { name: "agentId", type: "string", required: true },
    { name: "missionId", type: "string", required: false },
  ],
  indexes: [
    { name: "turn_agent_idx", fields: ["agentId"] },
    { name: "turn_mission_idx", fields: ["missionId"] },
  ],
  watchable: true,
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
};

const Notification: SchemaDef = {
  // Re-introduction per OQ8 + Design v1.1 §3.4.1 (closes mission-56 partial-completion;
  // absorbs hub-networking.ts direct-write paths at W4 repository-composition)
  kind: "Notification",
  version: 1,
  fields: [
    { name: "id", type: "string", required: true },
    { name: "event", type: "string", required: false },
    { name: "recipientRole", type: "string", required: false },
    { name: "recipientAgentId", type: "string", required: false },
  ],
  indexes: [
    { name: "notification_recipient_idx", fields: ["recipientAgentId"] },
  ],
  watchable: true,
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
    { name: "document_category_idx", fields: ["category"] },
  ],
  watchable: true,
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
    { name: "review_task_idx", fields: ["taskId"] },
  ],
  watchable: true,
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
    { name: "threadhist_thread_idx", fields: ["threadId"] },
  ],
  watchable: true,
};

// ─── Export all 20 SchemaDef entries ───────────────────────────────────────

/**
 * All 20 substrate-mediated kinds per Design v1.3 §3.4.1 LOCKED inventory.
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
];
