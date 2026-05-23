# M-K8s-Envelope — Cluster 2 Queue/FSM-Active Partition (Design Working Draft)

**Status:** v0.1 — architect-fronted; awaiting engineer review
**Mission:** idea-126 (M-K8s-Envelope)
**Phase:** Phase 4 Design — cluster-2 partition pass (2 of 4 clusters per Round 1 grouping, revised in §0)
**Coordination:** per-PR review (no separate Hub coord thread per `feedback_pr_opened_notification_is_review_signal`)
**Date:** 2026-05-23 AEST
**Sibling Designs:**
- Cluster 1 — substantive-content (Idea / Bug / Thread / Mission / Proposal) — **MERGED** at `d8ea695`
- Cluster 3 — metadata/config/projection (forthcoming; scope revised in §6)
- Cluster 4 — audit/event (forthcoming; scope revised in §6)

**Survey input:** `docs/reviews/2026-05-23-survey-idea-126.md` (Director-ratified R1 A/A/A + R2 A/A/A — substrate-wide all-at-once + strict K8s + minimal 2-group taxonomy + big-bang cutover). Same Survey applies to all clusters.

**Cluster-1 patterns inherited** (per merged Design):
- Strict K8s `metadata`/`spec`/`status` partition; no top-level fields beyond `{id, name, kind, apiVersion, metadata, spec, status}`
- `metadata.labels` (map) for queryable classification; tag arrays migrate to map with empty-string values
- `metadata.annotations["ois.io/..."]` for free-form vendor extension
- `name` omitted for content/state-classified kinds
- `<Kind>.status` (flat FSM) → `<Kind>.status.phase` (K8s convention)
- `FilterableField.path` per-kind; nested-path via dot-notation; `selector: "k8s-map"` for map-types
- Virtual-view fields envelope-excluded (computed on read)
- `apiVersion: "core.ois/v1"` (minimal 2-group taxonomy)
- Substrate strict K8s; LLM-ergonomic flat projection deferred to idea-121 `get_resource({view})`

---

## §0 Substrate-grounding correction — cluster scope revision

**Handover-proposed cluster-2 scope** (per cluster-1 §6 line 534 + Round 1 engineer-proposed): `Task / PendingActionItem / DirectorNotification / Turn / Clarification` — 5 kinds.

**Substrate ground-truth** (per `hub/scripts/entity-kinds.json` v1.1 — 22 kinds LOCKED at mission-83):

| Handover-named | Substrate reality | Disposition |
|---|---|---|
| Task | ✓ substrate-mediated kind `Task` | **IN-SCOPE** for cluster-2 |
| PendingActionItem | substrate-mediated kind `PendingAction` (interface type `PendingActionItem`; kind name `PendingAction`) | **IN-SCOPE** for cluster-2 |
| Turn | ✓ substrate-mediated kind `Turn` | **IN-SCOPE** for cluster-2 |
| DirectorNotification | **NOT a substrate kind** — fully migrated to `Message` (kind=note + target.role=director) in mission-56 W4.1/W5 (`policy/director-notification-helpers.ts`); legacy store deleted | **OUT-OF-SCOPE** for cluster-2 — partition under cluster-4 Message |
| Clarification | **NOT a substrate kind** — inline fields on `Task` (`task.clarificationQuestion` + `task.clarificationAnswer`); `create_clarification` cascade is `audit_only` (per `cascade-actions/create-clarification.ts:5`) | **OUT-OF-SCOPE** for cluster-2 — partition covered inside Task §3.1 |

**Revised cluster-2 scope: 3 substrate-mediated kinds** — Task, PendingAction, Turn.

This applies the cluster-1 v0.2 §1 substrate-currency discipline (engineer Round 7 catch on `Idea.dismissedReason`/`Mission.sliceTracking` misnomers per cluster-1 thread-634 Round 10 review): partition decisions are grounded in code (`entity-kinds.json` is the SSOT for "what is a substrate-mediated kind").

Cluster-decomposition revision for clusters 3/4 surfaced in §6.

---

## §1 Design scope — cluster-2 queue/FSM-active kinds

| Kind | Mediation | Notes |
|---|---|---|
| Task | ITaskStore | engineer-work entity; 9-state FSM; carries clarification inline; cascade-spawn backlinks; assigned-agent routing |
| PendingAction | IPendingActionStore | per-agent receipt/completion queue (ADR-017); 6-state FSM incl. graceful-exhaustion continuation; natural-key idempotency |
| Turn | ITurnStore | high-level execution cycle (Mission/Task grouping); 3-state FSM; virtual-view children |

**Shared property:** queue/FSM-active mutating state. `spec` is small (declared dispatch/work parameters); **`status` carries most of the load** (FSM phase, attempt counters, deadline tracking, completion markers, virtual-view children). This is the inverse of cluster-1's substantive-content kinds where `spec` carried the cognitive surface.

**Methodology note (cluster-2-specific):** when partitioning, default-to-`status` on FSM-mutated fields (vs cluster-1's default-to-`spec` on ambiguous-intent fields). The FSM is the load-bearing surface.

---

## §2 Per-kind partitions

### §2.1 Task — canonical reference

**Existing flat shape** (per `hub/src/state.ts:12-50`):
- `id`, `directive`, `report`, `reportSummary`, `reportRef`, `verification`, `reviewAssessment`, `reviewRef`
- `assignedAgentId`, `clarificationQuestion`, `clarificationAnswer`, `correlationId`, `idempotencyKey`
- `title`, `description`, `dependsOn[]`, `revisionCount`
- `status` (FSM: `pending | working | blocked | input_required | in_review | completed | failed | escalated | cancelled` — 9 states; `hub/src/state.ts:8`)
- `labels: Record<string, string>` (Mission-19 routing labels; already-map shape)
- `turnId` (Mission-20 owning Turn for virtual-view composition)
- `sourceThreadId`, `sourceActionId`, `sourceThreadSummary` (Mission-24 cascade-spawn back-links)
- `createdBy?` (EntityProvenance — Mission-24 idea-120 direct-create provenance)
- `createdAt`, `updatedAt`

**Partition (v0.1):**

```json
{
  "name": "Task",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "type": "object",
      "required": ["id", "kind", "apiVersion", "createdAt"],
      "properties": {
        "id":              { "type": "string", "pattern": "^task-[0-9]+$" },
        "kind":            { "const": "Task" },
        "apiVersion":      { "const": "core.ois/v1" },
        "createdAt":       { "type": "string", "format": "date-time" },
        "updatedAt":       { "type": "string", "format": "date-time" },
        "createdBy":       { "$ref": "#/definitions/Author" },
        "sourceThreadId":  { "type": ["string", "null"] },
        "sourceActionId":  { "type": ["string", "null"] },
        "correlationId":   { "type": ["string", "null"] },
        "idempotencyKey":  { "type": ["string", "null"] },
        "revisionCount":   { "type": "integer", "minimum": 0 },
        "turnId":          {
          "type": ["string", "null"],
          "description": "owning Turn — declared at submit; identifies Mission-20 grouping. Not an FSM-mutated field; stays in metadata."
        },
        "labels":          {
          "type": "object",
          "additionalProperties": { "type": "string" },
          "description": "Mission-19 routing labels. Already-map shape; relocates from top-level (no migration translation needed beyond path move)."
        },
        "annotations":     {
          "type": "object",
          "additionalProperties": { "type": "string" },
          "description": "K8s-convention free-form. Carries ois.io/sourceThreadSummary post-migration."
        }
      }
    },
    "spec-schema": {
      "type": "object",
      "required": ["directive"],
      "properties": {
        "directive":        { "type": "string", "description": "Declared work intent. Immutable post-submit (FSM transitions don't rewrite directive)." },
        "title":            { "type": ["string", "null"] },
        "description":     { "type": ["string", "null"] },
        "dependsOn":        {
          "type": "array",
          "items": { "type": "string" },
          "description": "Declared task-IDs that must complete first. Replaced by Relationship-kind edges post idea-151 cutover; see §3.3."
        },
        "assignedAgentId":  {
          "type": ["string", "null"],
          "description": "Set by getNextDirective() at claim-time per Mission-19. Spec-side because it's the declared-target-of-work post-claim (cf. Mission-19 — claimant.agentId is persisted as desired target)."
        }
      }
    },
    "status-schema": {
      "type": "object",
      "required": ["phase"],
      "properties": {
        "phase": {
          "enum": ["pending", "working", "blocked", "input_required", "in_review", "completed", "failed", "escalated", "cancelled"],
          "description": "9-state FSM. Migrated 1:1 from current flat Task.status."
        },
        "report":             { "type": ["string", "null"], "description": "Observed: submitted by assigned engineer at submitReport()." },
        "reportSummary":      { "type": ["string", "null"] },
        "reportRef":          { "type": ["string", "null"] },
        "verification":       { "type": ["string", "null"] },
        "reviewAssessment":   { "type": ["string", "null"] },
        "reviewRef":          { "type": ["string", "null"] },
        "reviewDecision":     { "type": ["string", "null"], "enum": ["approved", "rejected", null], "description": "Observed at submitReview()." },
        "clarificationQuestion": {
          "type": ["string", "null"],
          "description": "Set at requestClarification(); FSM transition working → input_required. INLINE per substrate-ground-truth (Clarification is not a separate kind; see §0)."
        },
        "clarificationAnswer": {
          "type": ["string", "null"],
          "description": "Set at respondToClarification(); FSM transition input_required → working."
        }
      }
    },
    "filterable-fields": [
      { "shorthand": "phase",            "path": "status.phase" },
      { "shorthand": "turnId",           "path": "metadata.turnId" },
      { "shorthand": "assignedAgentId",  "path": "spec.assignedAgentId" },
      { "shorthand": "idempotencyKey",   "path": "metadata.idempotencyKey" },
      { "shorthand": "correlationId",    "path": "metadata.correlationId" },
      { "shorthand": "sourceThreadId",   "path": "metadata.sourceThreadId" },
      { "shorthand": "createdBy.role",   "path": "metadata.createdBy.role" },
      { "shorthand": "createdBy.agentId","path": "metadata.createdBy.agentId" },
      { "shorthand": "label",            "path": "metadata.labels",       "selector": "k8s-map" }
    ]
  }
}
```

**Partition rationale (Task):**
- **`directive` → spec** (declared work intent; immutable post-submit; cognitive-surface field).
- **`title`/`description` → spec** (declared metadata at submit; not FSM-mutated).
- **`dependsOn[] → spec`** for v1; **idea-151 supersedes** with Relationship-kind edges post-cutover (see §3.3). Migration preserves array at envelope cutover; Relationship-kind extraction is a separate Mission.
- **`assignedAgentId` → spec** (subtle — Mission-19 sets it at `getNextDirective()` claim. **Engineer audit needed: status or spec?**). Argument for spec: post-claim it's the declared-target-of-work, and reading the comment at state.ts:1219 it's "persisted on the task as assignedAgentId for P2P routing of subsequent events" — declared-routing-target. Argument for status: it mutates after submit (claim is post-creation). **v0.1 disposition: spec; v0.2 reviser if engineer disposes status.**
- **`status` (current flat FSM) → `status.phase`** (1:1 rename, K8s convention; same pattern as cluster-1).
- **`report`/`reportSummary`/`reportRef`/`verification` → status** (observed; submitted at FSM transition working → completed/failed).
- **`reviewAssessment`/`reviewRef`/`reviewDecision` → status** (observed; submitted at submitReview()).
- **`clarificationQuestion`/`clarificationAnswer` → status** (FSM-mutated; transitions working ↔ input_required; per §0 these are INLINE on Task, not a separate Clarification kind).
- **`labels: Record<string,string>` → metadata.labels** (already-map shape; no array→map migration needed — just relocates).
- **`turnId` → metadata** (owning-Turn pointer; declared at submit; not FSM-mutated; cleaner in metadata for K8s-convention parent-pointer pattern).
- **`sourceThreadId`/`sourceActionId` → metadata** (cascade provenance; aligns with cluster-1 §3 disposition).
- **`sourceThreadSummary` → metadata.annotations["ois.io/sourceThreadSummary"]** (vendor-namespaced annotation; aligns with cluster-1 §3.1).
- **`createdBy` → metadata** (per cluster-1 §3.1).
- **`correlationId`/`idempotencyKey` → metadata** (identity-shape; not FSM-mutated).
- **`revisionCount` → metadata** (system-tracked counter; sibling of cluster-1 Idea/Bug/Mission pattern).
- **`Task.status.events[]`**: **NOT added in v0.1.** bug-94 task-issuance composition would benefit from a `status.events[]` audit trail (`task_issued`, `task_pulled`, `task_clarification_requested`, etc.), but that's a substrate addition beyond envelope-shape scope. **Open question §3.1 OQ1** — disposition: composes with cluster-4 Message store? Or separate `status.events[]` array? Engineer audit at v0.2.
- **`name` OMITTED** — Task is state-primary; `spec.directive` carries content. Same pattern as cluster-1 Idea/Bug.

**Field renames visible post-cutover (Task):**
- `Task.status` (flat FSM enum) → `Task.status.phase`
- `Task.sourceThreadSummary` → `Task.metadata.annotations["ois.io/sourceThreadSummary"]`
- `Task.labels` (already-map) → `Task.metadata.labels` (path move only; no shape translation)
- `Task.turnId` → `Task.metadata.turnId` (path move only)
- All `report*`/`review*`/`clarification*` fields → `Task.status.*` (path move only)

**Open questions (Task) — engineer audit:**
- **OQ1**: `Task.status.events[]` substrate addition (bug-94 composition)? Disposition: in-scope for this Mission OR follow-on?
- **OQ2**: `assignedAgentId` partition: spec (declared-target-post-claim) vs status (FSM-mutated-post-submit)? v0.1 picks spec; engineer disposition welcome.
- **OQ3**: `dependsOn[]` placement: stays in spec at this Mission, OR pre-emptive carve to a `Task.metadata.annotations["ois.io/depends-on"]` placeholder until idea-151 Relationship-kind extraction lands? v0.1 picks "stays in spec; Relationship-kind extraction is separate Mission scope."
- **OQ4**: Task FSM enum verification: full set is `pending | working | blocked | input_required | in_review | completed | failed | escalated | cancelled` (9 states per `state.ts:8`). Confirm no additional states discovered post-substrate-cutover.

---

### §2.2 PendingAction — stub (v0.1; full partition at v0.2 per engineer dispositions)

**Existing flat shape** (per `hub/src/entities/pending-action.ts:48-86`):
- `id` (pattern: `pa-YYYY-MM-DDTHH-MM-SS-msmsZ-NNN`), `targetAgentId`, `dispatchType` (6 enum values), `entityRef`
- `naturalKey` (composed: `{targetAgentId, entityRef, dispatchType}` — INV-COMMS-L01 idempotency)
- `payload: Record<string, unknown>` (per-dispatchType payload shape)
- `enqueuedAt`, `receiptDeadline`, `completionDeadline`, `receiptAckedAt`, `completionAckedAt`
- `attemptCount`, `lastAttemptAt`
- `state` (FSM: `enqueued | receipt_acked | completion_acked | escalated | errored | continuation_required` — 6 states)
- `escalationReason`
- `createdBy?` (provenance)
- `continuationState?` (task-314 graceful-exhaustion payload; caller-opaque JSON), `continuationSavedAt?`

**Stub partition (v0.1 — engineer-confirm at v0.2):**

| Field | Section | Rationale |
|---|---|---|
| `id`, `createdAt` (≈enqueuedAt), `createdBy`, `correlationId` | metadata | identity + provenance |
| `naturalKey` | metadata | system-derived from `{targetAgentId, entityRef, dispatchType}`; idempotency key (INV-COMMS-L01) |
| `targetAgentId`, `dispatchType`, `entityRef` | spec | declared dispatch parameters; immutable post-enqueue |
| `payload` | spec | declared per-dispatch-type payload; immutable post-enqueue |
| `receiptDeadline`, `completionDeadline` | spec | declared SLA bounds at enqueue (with watchdog-bumped via rescheduleReceiptDeadline) — **OQ: spec or status given watchdog mutation?** |
| `phase` (renamed from `state`) | status | 6-state FSM (`enqueued → receipt_acked → completion_acked → escalated → errored → continuation_required`) |
| `receiptAckedAt`, `completionAckedAt` | status | FSM-transition timestamps |
| `attemptCount`, `lastAttemptAt` | status | watchdog re-dispatch counters |
| `escalationReason` | status | populated at escalate() |
| `continuationState`, `continuationSavedAt` | status | task-314 graceful-exhaustion state (caller-opaque) |

**Open questions (PendingAction) — engineer audit:**
- **OQ5**: `receiptDeadline`/`completionDeadline` partition. Stub-default: spec (declared-at-enqueue). But watchdog `rescheduleReceiptDeadline()` mutates receiptDeadline post-creation. Disposition: keep in spec (declared-with-controlled-mutation pattern; like Mission-19 `spec.assignedAgentId` claim) OR move to status (mutates-via-system)?
- **OQ6**: `continuationState` is `Record<string, unknown>` (caller-opaque per task-314). Stays as opaque JSON in `status.continuationState` OR partition further? v0.1 picks opaque (matches task-314 design intent).
- **OQ7**: `name` OMITTED for PendingAction — confirm (it's pure queue-state; no human-facing handle).
- **OQ8**: `id` pattern (`pa-YYYY-MM-DDTHH-MM-SS-msmsZ-NNN`) — unusual pattern; preserves chronological-ordering-by-id property. Migration preserves; envelope `metadata.id` pattern field reflects existing shape.

**Composition flags:**
- bug-60 multicast-routing PendingAction skips — `spec.targetAgentId` discipline at write-boundary; envelope doesn't change that surface but pins the field as spec-side declared-target.
- task-314 continuation-state is `status.continuationState` per stub; v2.0 envelope provides the substrate shape for graceful-exhaustion lifecycle.

---

### §2.3 Turn — stub (v0.1; full partition at v0.2 per engineer dispositions)

**Existing flat shape** (per `hub/src/entities/turn.ts:23-38`):
- `id`, `title`, `scope` (free-text markdown)
- `status` (FSM: `planning | active | completed` — 3 states)
- `missionIds: string[]` (VIRTUAL VIEW — computed on read from IMissionStore by turnId)
- `taskIds: string[]` (VIRTUAL VIEW — computed on read from ITaskStore by turnId)
- `tele: string[]` (Tele IDs — teleological references)
- `correlationId`, `createdBy?`, `createdAt`, `updatedAt`

**Stub partition (v0.1 — engineer-confirm at v0.2):**

| Field | Section | Rationale |
|---|---|---|
| `id`, `createdAt`, `updatedAt`, `createdBy`, `correlationId` | metadata | identity + provenance |
| `title` | spec | declared handle (Turn IS a kind with a separate handle — possibly USE `metadata.name`?) — **OQ9** |
| `scope` | spec | declared free-text markdown objectives; cognitive content |
| `tele[]` | spec | declared teleological references (Tele IDs); intent-shape (which goals this Turn pursues) |
| `phase` (renamed from `status`) | status | 3-state FSM (`planning → active → completed`) |
| `missionIds`, `taskIds` | **ENVELOPE-EXCLUDED** | virtual views; computed on read; same pattern as cluster-1 Mission `tasks`/`ideas` (per engineer Round 10 cluster-1 review) |

**Open questions (Turn) — engineer audit:**
- **OQ9**: `title` placement: spec (substantive content like cluster-1 Mission.title) OR `metadata.name` (Turn has a small-handle quality — `title: "Mission-83 W7"` is more handle-like than substantive)? Cluster-1 chose `name OMITTED` for content-classified kinds; Turn may be different (handle-shape). v0.1 picks `spec.title` for cluster-1 consistency; engineer disposition welcome.
- **OQ10**: `scope` — markdown-body shape. Cluster-1 left such fields in spec (e.g., Mission.goal, Proposal.body). v0.1 picks `spec.scope`.
- **OQ11**: Virtual-view exclusion: `missionIds`/`taskIds` are NOT in envelope (computed on read). Confirm SchemaDef declares this explicitly (per cluster-1 engineer Round 10 catch on `Mission.tasks`/`Mission.ideas` virtual-views). v0.1 picks ENVELOPE-EXCLUDED with explicit doc comment.
- **OQ12**: `tele[]` — array of Tele IDs (foreign keys). idea-151 Relationship-kind candidate (Tele edges)? v0.1 picks `spec.tele[]` (stays inline at cluster-2 cutover; idea-151 follow-on Mission carves out if applicable).

**Composition flags:**
- Virtual-view discipline (cluster-1 engineer Round 10 catch): SchemaDef declares `missionIds`/`taskIds` as envelope-excluded virtual views; substrate write-boundary doesn't serialize them; read-projection computes via `IMissionStore.list({filter: {turnId}})`+`ITaskStore.list({filter: {turnId}})`.

---

## §3 Composition checkpoints

### §3.1 bug-94 (task-issuance gap)

bug-94 (open per substrate-grep) surfaces `task_issued` Hub-side emit-gap: the substrate doesn't reliably emit FSM-transition events at task issuance. **OQ1 above** raises whether `Task.status.events[]` should be a substrate addition at this Mission, OR whether it composes with cluster-4 Message store (`Message.kind: "task_issued"` shape).

**Architect lean (v0.1):** out-of-scope for cluster-2 envelope. Task envelope shape doesn't need `status.events[]` to ship; bug-94 fix can be a separate substrate-event-emit Mission (or composes with idea-151 Relationship-kind for task-event edges). Engineer disposition welcome.

### §3.2 bug-60 (multicast-routing skips PendingAction)

bug-60 surfaces multicast PendingAction enqueue-skip during routing. Envelope shape doesn't change that surface; the substrate write-boundary discipline for `spec.targetAgentId` (declared-target) is the relevant pin. Bug-60 fix composes with policy-router but doesn't change envelope.

### §3.3 idea-151 (M-Graph-Relationships)

Relationship (kind 21) post-cutover supersedes inline foreign-key fields:
- `Task.spec.dependsOn[]` → Relationship-kind edges (`{from: task-N, to: task-M, edgeType: "depends_on"}`)
- `Task.metadata.turnId` → Relationship-kind edges (`{from: task-N, to: turn-K, edgeType: "belongs_to"}`)?  **OQ:** turnId is a strong-typed parent pointer; idea-151 disposition may keep this inline (K8s-precedent `ownerReferences` pattern in `metadata`).
- `Turn.spec.tele[]` → Relationship-kind edges (`{from: turn-K, to: tele-N, edgeType: "guided_by"}`)?

**At cluster-2 cutover:** all FK arrays/scalars stay inline per §0 substrate-currency. idea-151 follow-on Mission extracts edges. Cluster-2 envelope shape doesn't depend on idea-151 cutover.

### §3.4 idea-121 (M-API-v2.0) — `get_resource_shape` consumer

Same as cluster-1 §4.1. SchemaDef v2.0 cluster-2 partition feeds idea-121 projection layer: flat-shape mapping for `view: "flat"`; FilterableField.path resolution; per-kind spec verbs (Survey 2 Q2-D deferral).

### §3.5 task-314 (M-Hypervisor-Adapter-Mitigations) — graceful exhaustion

`PendingAction.status.continuationState` + `continuationSavedAt` are the envelope-shape carrier for task-314's `save_continuation` lifecycle. v2.0 envelope provides the field shape; FSM transition rules (`enqueued → continuation_required → enqueued`) live in PendingActionRepository post-cutover unchanged.

### §3.6 idea-200 (M-Thread-Substrate-Carve-Out)

Cluster-1 §4.5 — Thread.status.messages staging. **Cluster-2 has NO equivalent** — Task/PendingAction/Turn do not contain inline arrays of child kinds. (Turn.missionIds/taskIds are virtual views, not stored arrays.)

### §3.7 bug-118 (substrate-wide bug-lineage gap)

Cluster-1 §4.2 — `metadata.sourceThreadId`/`sourceActionId` envelope-level provenance via `shared/provenance.ts`. Cluster-2 inherits the same pattern: Task carries cascade-spawn backlinks per Mission-24 Phase 2.

---

## §4 Acceptance criteria (cluster-2-specific)

- All 3 cluster-2 kinds (Task / PendingAction / Turn) carry valid envelope structure post-cutover (verified via psql JSON-shape inspection per kind)
- Each kind's `apiVersion: "core.ois/v1"`
- Strict K8s partition (no top-level fields beyond `{id, kind, apiVersion, metadata, spec, status}`; `name` per-kind disposition documented in OQ9)
- `FilterableField.path` declarations per-kind enable shorthand-filter translation at `list_*` runtime; composes with idea-121
- **FSM `phase` enum** preserves all current state semantics 1:1 (Task 9-state; PendingAction 6-state; Turn 3-state)
- **Virtual-view discipline:** Turn.missionIds/taskIds are envelope-EXCLUDED + computed on read (per cluster-1 engineer Round 10 catch on Mission.tasks/ideas); SchemaDef declares this property explicitly
- **Field path moves preserved 1:1** in migration (no data loss):
  - `Task.status` (string) → `Task.status.phase`
  - `Task.labels` (map) → `Task.metadata.labels` (path move; same shape)
  - `Task.turnId` → `Task.metadata.turnId`
  - `Task.sourceThreadSummary` → `Task.metadata.annotations["ois.io/sourceThreadSummary"]`
  - PendingAction `state` → `status.phase`
  - Turn `status` → `status.phase`
- **Cross-Mission dependency surfaces (cluster-2):**
  - `Task.spec.dependsOn[]` stays inline at this cutover; idea-151 follow-on Mission extracts to Relationship-kind edges (separate Mission scope; acceptance criterion is envelope-coherence-at-cutover, not edge-extraction)
  - `Turn.spec.tele[]` stays inline at this cutover; same idea-151 disposition

---

## §5 Cluster-1 dependencies + sequencing notes

**Cluster-1 v0.3 deferred TODOs** (per engineer Round 10 catches on PR #267) — Mission FSM enum (`abandoned` not `cancelled`), missing fields (documentRef, turnId, missionClass, pulses), sliceTracking misnomer — **do NOT affect cluster-2**. Those are field-level corrections to the cluster-1 Mission section + fold in at SchemaDef implementation work.

**Cluster-2 vs cluster-1 ordering:** parallel-OK at Design phase. Each cluster's SchemaDef partition is self-contained envelope-shape; the central migration registry (per Round 1 disposition D2) composes them at implementation.

---

## §6 Cluster decomposition revision (substrate-grounded)

**Original Round 1 engineer-proposed** (per cluster-1 §6 line 9-11):
- Cluster 2: queue/FSM-active (Task / PendingActionItem / DirectorNotification / Turn / Clarification)
- Cluster 3: metadata/config/projection (Tele / Counter / Agent / Session)
- Cluster 4: audit/event (Message / Audit / RepoEvent)

**Substrate-grounded revision** (per `entity-kinds.json` v1.1 — 22 kinds LOCKED; cluster-1 covered 5):

| Cluster | Kinds | Notes |
|---|---|---|
| 1 ✓ | Bug, Idea, Mission, Proposal, Thread (5) | substantive-content (**MERGED** at `d8ea695`) |
| **2** | **Task, PendingAction, Turn (3)** | queue/FSM-active (**this Design**) |
| 3 | Tele, Counter, Agent, SchemaDef (4) | metadata/config/projection (NEW: SchemaDef bootstrap-self-referential) |
| 4 | Message, Audit, Notification (3) | system-emit events + append-only audit |
| 5 | Document, ArchitectDecision, DirectorHistoryEntry, ReviewHistoryEntry, ThreadHistoryEntry, RepoEventBridgeCursor, RepoEventBridgeDedupe (7) | NEW per mission-83 W2/W4 — append-only structured logs + bookkeeping |

**Total: 22 kinds across 5 clusters** (matches `entity-kinds.json` v1.1 inventory-locked count).

**Phantom kinds removed** (per `entity-kinds.json` v1.1 "kinds-explicitly-not-included"):
- DirectorNotification (migrated to Message in mission-56 W4.1/W5)
- Clarification (inline fields on Task)
- Session (architect spec-level invention; zero refs)
- ThreadMessage (single Message kind with threadId field)
- Report (inline `task.reportRef` field)
- Review (inline field on mission/proposal/message)
- Continuation (state of PendingAction, not separate kind)
- ScheduledMessage / MessageProjection / AgentProjection (sweeper-internal types; not persisted)

**Open question (cluster decomposition):**
- **OQ13**: Cluster 5 size (7 kinds) is large vs cluster 4 (3 kinds). Disposition options:
  - (a) Keep clusters 4 + 5 separate (semantic split: system-events vs content-logs)
  - (b) Collapse into single cluster-4 of 10 kinds (volume parity isn't a deciding factor)
  - (c) Re-split: cluster 4 (Message, Audit, Notification, RepoEventBridge*) — 5 system-emit/bookkeeping; cluster 5 (Document, *HistoryEntry — 5 content-archive) — 5 each
  - v0.1 architect-lean: **(c)** — semantic split 5+5

Engineer disposition welcome; this affects only sibling-Design scoping, not cluster-2 envelope partition itself.

---

## §7 Status

**v0.1** — architect-fronted; awaiting engineer review.

**Round-budget plan (per `feedback_pr_opened_notification_is_review_signal`):**
- PR opens; greg engages via `pr_opened_bilateral` notification + posts review on GitHub PR directly OR opens cluster-2 coordination thread if substantive bilateral negotiation needed
- v0.2 architect commit integrates engineer (A) §3.1 Task refinements + (B) §3.2-3.3 stub fill per dispositions + (C) cluster decomposition §6 disposition
- v0.2 approval converges cluster-2 Design; cluster-3 opens fresh PR

**Outstanding open questions** (engineer disposition expected):
- OQ1: `Task.status.events[]` substrate addition (bug-94)
- OQ2: `Task.assignedAgentId` spec vs status
- OQ3: `Task.dependsOn[]` placement at cluster-2 cutover
- OQ4: Task FSM enum completeness verification
- OQ5: PendingAction `receiptDeadline`/`completionDeadline` spec vs status (watchdog-mutation tension)
- OQ6: PendingAction `continuationState` opaque-JSON shape
- OQ7: PendingAction `name` omitted confirmation
- OQ8: PendingAction `id` pattern preservation
- OQ9: Turn `title` partition (`spec.title` vs `metadata.name`)
- OQ10: Turn `scope` markdown-body
- OQ11: Turn virtual-view exclusion SchemaDef declaration
- OQ12: Turn `tele[]` placement at cluster-2 cutover
- OQ13: Cluster 4/5 decomposition (sibling-Design scoping)

**Next architect action post-approval:** cluster-3 Design (Tele / Counter / Agent / SchemaDef per §6 revision).
