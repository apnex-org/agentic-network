# M-K8s-Envelope — Cluster 2 Queue/FSM-Active Partition (Design Working Draft)

**Status:** v0.3 — substrate-truth ratified · ready for migration consumption
**Mission:** mission-88 (M-K8s-Envelope; idea-126 anchor)
**Phase:** Phase 4 Design — cluster-2 partition pass (2 of 5 clusters; Phase 8 W2 implementation)
**Coordination:** `thread-644` (W2 Design-pass; converged at R3)
**Date:** 2026-05-24 AEST (v0.3: W2 substrate-currency-ratification per thread-644 R2)
**Sibling Designs:**
- Cluster 1 — substantive-content (Idea / Bug / Thread / Mission / Proposal) — **MERGED** at `d8ea695`
- Cluster 3 — metadata/config/projection (forthcoming; scope ratified in §6)
- Cluster 4 — audit/event (forthcoming; scope ratified in §6)
- Cluster 5 — content-archive (forthcoming; scope ratified in §6)

**Survey input:** `docs/reviews/2026-05-23-survey-idea-126.md` (Director-ratified R1 A/A/A + R2 A/A/A — substrate-wide all-at-once + strict K8s + minimal 2-group taxonomy + big-bang cutover). Same Survey applies to all clusters.

**v0.2 → v0.3 changelog (W2 substrate-currency-ratification per thread-644 R2):**
- §6 NEW — v0.3 ratification record (ZERO drift vs substrate-current truth at engineer-proactive R1 verify-before-bake; 7th anticipated catch did NOT materialize — positive-surprise outcome; Design v0.2 was substrate-accurate at authoring time post-W4.x.10)
- §3.2 PendingAction `naturalKey`: A2 forward-looking note — SchemaDef v2.0 `"derived":true` framing is read-side-projection concern; W2 envelope-migration treats as regular metadata field (path-move only; no derived-computation logic)
- §6 NEW — declared-with-controlled-mutation 4-class axis (cross-cluster envelope-methodology pattern; A3 surfacing from thread-644 R1):
  - declared-immutable (Task.directive, Proposal.summary)
  - declared-with-controlled-mutation (Task.assignedAgentId, PendingAction.deadlines)
  - observed-FSM-mutated (status.*, ackedAt, attemptCount)
  - virtual-view (Mission.tasks, Turn.missionIds, Turn.taskIds)
- W2 OQ11 in-flight disposition mechanism: env-var flag (`MIGRATION_IN_PROGRESS_<KIND>=true`) per Q4(a) ratified at thread-644 R2; β substrate-pause-lock + γ LISTEN/NOTIFY events DEFERRED to distributed-Hub substrate-refactor cycle (idea-200/idea-129 follow-on)
- A4 forward-looking note for cluster-3 Agent partition: architect+engineer concur per-FSM-as-top-level-status-fields for multi-FSM kinds (K8s PodSpec siblings precedent; orthogonality is the point); deferred to W3 dispatch

**v0.1 → v0.2 changelog (engineer PR #268 review integration):**
- §1.5 NEW — `handle-classified vs content-classified` kinds methodology note (Turn introduces `metadata.name` use; engineer-surfaced signal for clusters 3/4/5)
- §2.1 Task: OQ1-OQ4 dispositions applied + K8s-precedent rationale notes added (PodSpec.nodeName for OQ2; engineer's `directive` immutability verify-note)
- §2.2 PendingAction: stub partition → full JSON Schema; OQ5-OQ8 dispositions applied + K8s-precedent note (LeaseSpec.acquireTime for OQ5); `naturalKey` declared as derived field
- §2.3 Turn: stub partition → full JSON Schema; OQ9-OQ12 dispositions applied — **first kind to USE `metadata.name`** per handle-classified pattern (§1.5)
- §3.8 NEW — idea-151 forward question on `Task.metadata.turnId` as K8s `ownerReferences` analog (engineer observation; not blocking cluster-2 cutover)
- §6 cluster decomposition revision RATIFIED — (c) 5+5 semantic split for clusters 4/5
- §7 OQ list cleared; v0.2 ready for approval

**Cluster-1 patterns inherited** (per merged Design):
- Strict K8s `metadata`/`spec`/`status` partition; no top-level fields beyond `{id, name, kind, apiVersion, metadata, spec, status}`
- `metadata.labels` (map) for queryable classification; tag arrays migrate to map with empty-string values
- `metadata.annotations["ois.io/..."]` for free-form vendor extension
- `name` omitted for content-classified kinds (cluster-2 ADDS distinct disposition for handle-classified kinds — see §1.5)
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

## §1.5 K8s-convention sub-discipline — handle-classified vs content-classified kinds

**Surfaced at v0.2 engineer review of OQ9 (Turn.title placement).** Cluster-1 introduced the omit-`metadata.name`-for-content-classified-kinds rule; cluster-2 introduces the **inverse** rule for handle-classified kinds.

| Class | Pattern | Examples | `metadata.name` |
|---|---|---|---|
| **Content-classified** | Substantive content lives in `spec` (description, body, text); no separate handle | Idea, Bug, Thread (title is summary), Mission (goal is content), Proposal (body is content), **Task** (directive is content) | **OMITTED** |
| **Handle-classified** | Has a separate short-handle identity; substantive content (if any) lives elsewhere | **Turn** (title is handle, scope is markdown body) | **USE** |

**Engineer's identifying rule** (per PR #268 review):
> *"Turn is a handle-classified kind — `title: 'Mission-83 W7'` is more handle than substantive content; the substantive content lives in `scope` (markdown body)."*

K8s precedent: Pod/Deployment/ConfigMap all use `metadata.name` as the cluster-scoped identifier handle.

**Forward signal for clusters 3/4/5:** kinds likely to follow Turn's pattern:
- **Agent** (handle = agent display name; substantive identity is `globalInstanceId` + role)
- **Tele** (handle = tele short name; substantive content is the teleological description)
- **ArchitectDecision** (timestamp-derived handle; substantive content is decision body) — cluster-5 candidate; engineer-confirm at cluster-3/5 Design

Kinds with content-shaped substantive surfaces continue cluster-1's omit pattern.

This sub-discipline composes with cluster-1 §2 K8s-convention note ("name OMITTED for content-classified kinds") — same axis, both poles now articulated.

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

**Partition rationale (Task) — v0.2 with engineer dispositions:**
- **`directive` → spec** (declared work intent; immutable post-submit; cognitive-surface field). **Engineer-verified at v0.2**: `updateTask()` substrate path does not accept `directive` as a mutation field (only status / report* / verification / reviewAssessment / clarification* / reviewRef) — immutability claim holds.
- **`title`/`description` → spec** (declared metadata at submit; not FSM-mutated).
- **`dependsOn[] → spec`** for v1 (engineer OQ3 concur with v0.1; stays inline; idea-151 Relationship-kind extraction is forward-looking Mission scope).
- **`assignedAgentId` → spec** (engineer OQ2 confirm with K8s precedent: **PodSpec.nodeName** has the exact same shape — set by scheduler post-Pod-creation; lives in spec as declared-target-after-scheduling. Mutation during `getNextDirective()` claim is substrate-controlled (not FSM-state-mutated); the mutation pattern matches the *declared-with-controlled-mutation class* — same class as PendingAction deadlines per OQ5).
- **`status` (current flat FSM) → `status.phase`** (1:1 rename, K8s convention; same pattern as cluster-1). Engineer OQ4: 9-state enum verified at `hub/src/state.ts:8` — `pending | working | blocked | input_required | in_review | completed | failed | escalated | cancelled`.
- **`report`/`reportSummary`/`reportRef`/`verification` → status** (observed; submitted at FSM transition working → completed/failed).
- **`reviewAssessment`/`reviewRef`/`reviewDecision` → status** (observed; submitted at submitReview()).
- **`clarificationQuestion`/`clarificationAnswer` → status** (FSM-mutated; transitions working ↔ input_required; per §0 these are INLINE on Task, not a separate Clarification kind).
- **`labels: Record<string,string>` → metadata.labels** (already-map shape; no array→map migration needed — just relocates).
- **`turnId` → metadata** (owning-Turn pointer; declared at submit; not FSM-mutated; cleaner in metadata for K8s-convention parent-pointer pattern). See §3.8 for engineer-surfaced idea-151 forward-question on `ownerReferences[]` shape.
- **`sourceThreadId`/`sourceActionId` → metadata** (cascade provenance; aligns with cluster-1 §3 disposition).
- **`sourceThreadSummary` → metadata.annotations["ois.io/sourceThreadSummary"]** (vendor-namespaced annotation; aligns with cluster-1 §3.1).
- **`createdBy` → metadata** (per cluster-1 §3.1).
- **`correlationId`/`idempotencyKey` → metadata** (identity-shape; not FSM-mutated).
- **`revisionCount` → metadata** (system-tracked counter; sibling of cluster-1 Idea/Bug/Mission pattern).
- **`Task.status.events[]`**: **OUT-OF-SCOPE for cluster-2** (engineer OQ1 concur). bug-94 task-issuance composition fix composes with **cluster-4 Message store** (`Message.kind: "task_issued"`) — system-emit pattern matches the DirectorNotification → Message migration precedent from mission-56 W4.1/W5. Envelope-shape doesn't need `status.events[]` to ship.
- **`name` OMITTED** — Task is content-classified per §1.5 (`spec.directive` is the substantive content). Cluster-1 pattern preserved.

**Field renames visible post-cutover (Task):**
- `Task.status` (flat FSM enum) → `Task.status.phase`
- `Task.sourceThreadSummary` → `Task.metadata.annotations["ois.io/sourceThreadSummary"]`
- `Task.labels` (already-map) → `Task.metadata.labels` (path move only; no shape translation)
- `Task.turnId` → `Task.metadata.turnId` (path move only)
- All `report*`/`review*`/`clarification*` fields → `Task.status.*` (path move only)

---

### §2.2 PendingAction — partition (v0.2 fill per engineer dispositions)

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

**Partition:**

```json
{
  "name": "PendingAction",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "type": "object",
      "required": ["id", "kind", "apiVersion", "createdAt", "naturalKey"],
      "properties": {
        "id":             {
          "type": "string",
          "pattern": "^pa-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]+Z-[A-Za-z0-9]+$",
          "description": "Pattern preserved: pa-YYYY-MM-DDTHH-MM-SS-msmsZ-NNN. Load-bearing for chronological-ordering-by-id property used by sweeper iteration; substrate-invariant per engineer OQ8 disposition."
        },
        "kind":           { "const": "PendingAction" },
        "apiVersion":     { "const": "core.ois/v1" },
        "createdAt":      { "type": "string", "format": "date-time", "description": "Migrates from existing enqueuedAt field; renamed to metadata.createdAt for envelope uniformity." },
        "createdBy":      { "$ref": "#/definitions/Author" },
        "naturalKey":     {
          "type": "string",
          "derived": true,
          "description": "Engineer observation v0.2: derived field — computed at substrate write-boundary from {spec.targetAgentId, spec.entityRef, spec.dispatchType}; read-only at envelope; not author-declared. Analog of virtual-view discipline but for scalar fields. INV-COMMS-L01 idempotency key."
        }
      }
    },
    "spec-schema": {
      "type": "object",
      "required": ["targetAgentId", "dispatchType", "entityRef", "receiptDeadline", "completionDeadline"],
      "properties": {
        "targetAgentId":      { "type": "string", "description": "Declared dispatch target; bug-60 multicast-routing-skips fix-site pins this as spec-side declared-target at write-boundary." },
        "dispatchType":       {
          "enum": ["thread_message", "thread_convergence_finalized", "task_issued", "proposal_submitted", "report_created", "review_requested"]
        },
        "entityRef":          { "type": "string", "description": "Reference to the entity this dispatch concerns (e.g., task-N, thread-N)." },
        "payload":            { "type": "object", "description": "Per-dispatchType payload shape; immutable post-enqueue." },
        "receiptDeadline":    {
          "type": "string",
          "format": "date-time",
          "description": "Engineer OQ5: declared-with-controlled-mutation pattern. K8s precedent — LeaseSpec.acquireTime: declared at lease-creation but mutable via lease-renewal mechanism without phase-state change. Watchdog rescheduleReceiptDeadline() is the controlled-mutation; FSM phase doesn't flip on extension."
        },
        "completionDeadline": { "type": "string", "format": "date-time", "description": "Declared at enqueue; same declared-with-controlled-mutation class as receiptDeadline." }
      }
    },
    "status-schema": {
      "type": "object",
      "required": ["phase"],
      "properties": {
        "phase": {
          "enum": ["enqueued", "receipt_acked", "completion_acked", "escalated", "errored", "continuation_required"],
          "description": "6-state FSM. Migrated 1:1 from current flat PendingAction.state field."
        },
        "receiptAckedAt":      { "type": ["string", "null"], "format": "date-time" },
        "completionAckedAt":   { "type": ["string", "null"], "format": "date-time" },
        "attemptCount":        { "type": "integer", "minimum": 0, "description": "Watchdog re-dispatch counter." },
        "lastAttemptAt":       { "type": ["string", "null"], "format": "date-time" },
        "escalationReason":    { "type": ["string", "null"], "description": "Populated at escalate() / abandon()." },
        "continuationState":   {
          "type": ["object", "null"],
          "description": "task-314 Graceful Exhaustion: caller-opaque JSON; engineer OQ6 disposition — stays as opaque Record<string, unknown> per task-314 design intent; sub-partitioning would violate caller-opaque contract."
        },
        "continuationSavedAt": { "type": ["string", "null"], "format": "date-time", "description": "task-314: most-recent save_continuation timestamp; used by re-dispatch sweep prioritisation (oldest-first)." }
      }
    },
    "filterable-fields": [
      { "shorthand": "phase",          "path": "status.phase" },
      { "shorthand": "targetAgentId",  "path": "spec.targetAgentId" },
      { "shorthand": "dispatchType",   "path": "spec.dispatchType" },
      { "shorthand": "entityRef",      "path": "spec.entityRef" },
      { "shorthand": "naturalKey",     "path": "metadata.naturalKey" },
      { "shorthand": "createdBy.role", "path": "metadata.createdBy.role" }
    ]
  }
}
```

**Partition rationale (PendingAction):**
- **`id` pattern preserved** (engineer OQ8): `pa-YYYY-MM-DDTHH-MM-SS-msmsZ-NNN` is load-bearing for chronological-ordering-by-id used by sweeper iteration order; changing would break substrate invariant.
- **`naturalKey` derived field** (engineer observation v0.2): declared `"derived": true` in SchemaDef; computed at substrate write-boundary from `{spec.targetAgentId, spec.entityRef, spec.dispatchType}`; not author-declared. Analog of virtual-view discipline but for scalar fields. Open question for SchemaDef v2.0 implementation: explicit `"derived": true` flag vs doc-comment-only convention.
- **`targetAgentId`/`dispatchType`/`entityRef`/`payload` → spec** (declared dispatch parameters; immutable post-enqueue).
- **`receiptDeadline`/`completionDeadline` → spec** (engineer OQ5: declared-with-controlled-mutation per K8s LeaseSpec.acquireTime precedent — watchdog `rescheduleReceiptDeadline()` is substrate-controlled deadline extension; not FSM-state-mutated). Same class as `Task.spec.assignedAgentId` (OQ2). Surfaces a third member of the *declared-with-controlled-mutation* pattern — useful axis for clusters 3/4/5.
- **`state` → `status.phase`** (1:1 rename per K8s convention; 6-state FSM).
- **`receiptAckedAt`/`completionAckedAt`/`attemptCount`/`lastAttemptAt`/`escalationReason` → status** (FSM-mutated observed state).
- **`continuationState`/`continuationSavedAt` → status** (task-314 graceful-exhaustion lifecycle observed state; opaque-JSON shape per OQ6).
- **`enqueuedAt` → `metadata.createdAt`** (rename for envelope uniformity; preserves chronological semantics).
- **`createdBy` → metadata** (per cluster-1 §3.1).
- **`name` OMITTED** (engineer OQ7 concur): PendingAction is pure queue-state per content-classified rule extended (`spec.dispatchType` + `spec.entityRef` together carry the identity; no human-facing handle). Different reason from cluster-1 (state-classified vs content-classified) but same disposition.

**Field renames visible post-cutover (PendingAction):**
- `PendingAction.state` → `PendingAction.status.phase`
- `PendingAction.enqueuedAt` → `PendingAction.metadata.createdAt`
- All `targetAgentId`/`dispatchType`/`entityRef`/`payload`/deadlines → `PendingAction.spec.*`
- All `*AckedAt`/`attemptCount`/`escalationReason`/`continuation*` → `PendingAction.status.*`

**Composition checkpoints:**
- bug-60 multicast-routing PendingAction skips — `spec.targetAgentId` discipline at write-boundary; envelope shape pins the field as spec-side declared-target.
- task-314 continuation-state is `status.continuationState`; v2.0 envelope provides the substrate shape for graceful-exhaustion lifecycle.

---

### §2.3 Turn — partition (v0.2 fill per engineer dispositions)

**Existing flat shape** (per `hub/src/entities/turn.ts:23-38`):
- `id`, `title`, `scope` (free-text markdown)
- `status` (FSM: `planning | active | completed` — 3 states)
- `missionIds: string[]` (VIRTUAL VIEW — computed on read from IMissionStore by turnId)
- `taskIds: string[]` (VIRTUAL VIEW — computed on read from ITaskStore by turnId)
- `tele: string[]` (Tele IDs — teleological references)
- `correlationId`, `createdBy?`, `createdAt`, `updatedAt`

**Partition:**

```json
{
  "name": "Turn",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "type": "object",
      "required": ["id", "kind", "apiVersion", "createdAt", "name"],
      "properties": {
        "id":            { "type": "string", "pattern": "^turn-[0-9]+$" },
        "kind":          { "const": "Turn" },
        "apiVersion":    { "const": "core.ois/v1" },
        "createdAt":     { "type": "string", "format": "date-time" },
        "updatedAt":     { "type": "string", "format": "date-time" },
        "createdBy":     { "$ref": "#/definitions/Author" },
        "correlationId": { "type": ["string", "null"] },
        "name":          {
          "type": "string",
          "description": "Engineer OQ9: handle-classified kind (per §1.5). Turn is the FIRST cluster-2 kind to USE metadata.name. Migrates from existing flat Turn.title field. Examples: 'Mission-83 W7', 'Q2 2026 Substrate Cutover'. Handle-shape (short identifier), not substantive content (which lives in spec.scope markdown body)."
        }
      }
    },
    "spec-schema": {
      "type": "object",
      "required": ["scope"],
      "properties": {
        "scope": {
          "type": "string",
          "description": "Free-text markdown objectives. Engineer OQ10: matches Mission.goal / Proposal.body pattern from cluster-1 (substantive cognitive-content lives in spec)."
        },
        "tele": {
          "type": "array",
          "items": { "type": "string", "pattern": "^tele-[0-9]+$" },
          "description": "Declared teleological references (Tele IDs). Engineer OQ12: stays inline at cluster-2 cutover; idea-151 Relationship-kind extraction is follow-on Mission scope (forward-only; no migration anticipation)."
        }
      }
    },
    "status-schema": {
      "type": "object",
      "required": ["phase"],
      "properties": {
        "phase": {
          "enum": ["planning", "active", "completed"],
          "description": "3-state FSM. Migrated 1:1 from current flat Turn.status field."
        }
      }
    },
    "filterable-fields": [
      { "shorthand": "phase",          "path": "status.phase" },
      { "shorthand": "name",           "path": "metadata.name" },
      { "shorthand": "correlationId",  "path": "metadata.correlationId" },
      { "shorthand": "createdBy.role", "path": "metadata.createdBy.role" }
    ],
    "virtual-view-fields": [
      {
        "name": "missionIds",
        "computed-from": "IMissionStore.list({filter: {turnId: <self.id>}})",
        "description": "Engineer OQ11: ENVELOPE-EXCLUDED. Computed on read; not stored. Same discipline as cluster-1 Mission.tasks/ideas (per cluster-1 engineer Round 10 catch). Substrate write-boundary does NOT serialize this field; SchemaDef declares it as virtual-view explicitly."
      },
      {
        "name": "taskIds",
        "computed-from": "ITaskStore.list({filter: {turnId: <self.id>}})",
        "description": "Engineer OQ11: ENVELOPE-EXCLUDED. Same discipline as missionIds above."
      }
    ]
  }
}
```

**Partition rationale (Turn):**
- **`title` → `metadata.name`** (engineer OQ9 — **DEVIATE FROM CLUSTER-1**): Turn is a *handle-classified* kind per §1.5; `title: "Mission-83 W7"` is a short handle, not substantive content. Substantive content lives in `spec.scope` (markdown body). K8s precedent: Pod/Deployment/ConfigMap all use `metadata.name` as identifier handle. **This is the FIRST cluster-2 kind to USE `metadata.name`** — signal for clusters 3/4/5 (likely candidates: Agent, Tele, possibly ArchitectDecision).
- **`scope` → spec** (engineer OQ10): declared free-text markdown objectives; substantive cognitive content; matches Mission.goal / Proposal.body cluster-1 pattern.
- **`tele[]` → spec** (engineer OQ12): declared teleological references; intent-shape (which goals this Turn pursues); stays inline at cluster-2 cutover; idea-151 forward-only Relationship-kind extraction.
- **`status` (current flat FSM) → `status.phase`** (1:1 rename per K8s convention; 3-state FSM).
- **`missionIds`/`taskIds` → ENVELOPE-EXCLUDED virtual views** (engineer OQ11): SchemaDef declares these as `virtual-view-fields[]` explicitly; substrate write-boundary does NOT serialize; read-projection computes via `IMissionStore.list({filter: {turnId}})` + `ITaskStore.list({filter: {turnId}})`. Same discipline as cluster-1 Mission `tasks`/`ideas` per engineer Round 10 cluster-1 review catch.
- **`id`/`createdAt`/`updatedAt`/`createdBy`/`correlationId` → metadata** (per cluster-1 §3.1).

**Field renames visible post-cutover (Turn):**
- `Turn.status` (flat FSM enum) → `Turn.status.phase`
- `Turn.title` → `Turn.metadata.name` (**NEW pattern** — first cluster-2 kind to use metadata.name)
- `Turn.scope` → `Turn.spec.scope`
- `Turn.tele` → `Turn.spec.tele`
- `Turn.missionIds`/`taskIds` → ENVELOPE-EXCLUDED (no path post-cutover; substrate-projection-only)

**Composition checkpoints:**
- Virtual-view discipline (cluster-1 engineer Round 10 catch): SchemaDef declares `missionIds`/`taskIds` as virtual-view-fields[]; substrate write-boundary doesn't serialize; read-projection computes via IMissionStore + ITaskStore filtered by turnId.
- idea-151 forward-question (engineer observation): `Turn.spec.tele[]` is a candidate for Relationship-kind edge extraction (`{from: turn-K, to: tele-N, edgeType: "guided_by"}`) — same disposition as `Task.spec.dependsOn[]` per OQ3.

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

### §3.8 idea-151 forward question — Task.metadata.turnId as K8s `ownerReferences` analog

**Surfaced at v0.2 engineer review.** `Task.metadata.turnId` (and analogously `Mission.metadata.turnId` from cluster-1, if added) is a strong-typed parent pointer to a Turn entity. K8s precedent: `metadata.ownerReferences[]` carries parent-pointers as a first-class envelope concept (array shape supporting multiple owners with cascade-delete semantics).

**Question for idea-151 Design:** should parent pointers migrate to:
- (a) `metadata.ownerReferences: [{kind: "Turn", id: turnId}]` shape (K8s-canonical; first-class composite)
- (b) Stay as typed scalar `metadata.turnId` field (current cluster-2 disposition; works for single-owner FK)

**Not blocking cluster-2 cutover.** Cluster-2 envelope shape preserves the scalar `metadata.turnId` per current substrate (1:1 path move from flat Task.turnId). idea-151 Design phase can dispose this surface independently — Relationship-kind edges may supersede scalar pointers entirely, OR `metadata.ownerReferences` may emerge as the canonical envelope-level concept for parent-pointers while Relationship-kind handles non-owner edge semantics. This is a Design-phase question for idea-151's Mission, not idea-126's.

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

**Cluster decomposition disposition (OQ13) — RATIFIED at v0.2:**

Engineer concur with architect-lean **(c)** — 5+5 semantic split. Reasoning: same as cluster-1's "group by structural similarity" — semantic cohesion matters more than count parity. (a) 3+7 would interleave system-emit semantics with content-archive semantics. (b) 10-kind cluster too large for coherent review. **(c) 5+5 splits cleanly**:

- **Cluster 4 (system-emit/bookkeeping):** Message + Audit + Notification + RepoEventBridgeCursor + RepoEventBridgeDedupe
- **Cluster 5 (content-archive append-only):** Document + ArchitectDecision + DirectorHistoryEntry + ReviewHistoryEntry + ThreadHistoryEntry

**Final 5-cluster decomposition:**

| Cluster | Kinds | Status |
|---|---|---|
| 1 | Bug, Idea, Mission, Proposal, Thread (5) | ✓ MERGED at `d8ea695` |
| 2 | Task, PendingAction, Turn (3) | **this Design (v0.2)** |
| 3 | Tele, Counter, Agent, SchemaDef (4) | forthcoming |
| 4 | Message, Audit, Notification, RepoEventBridgeCursor, RepoEventBridgeDedupe (5) | forthcoming |
| 5 | Document, ArchitectDecision, DirectorHistoryEntry, ReviewHistoryEntry, ThreadHistoryEntry (5) | forthcoming |

Total: **22 kinds across 5 clusters** (matches `entity-kinds.json` v1.1 inventory-locked count).

---

## §7 Status

**v0.3** — substrate-truth ratified per thread-644 bilateral convergence (2026-05-24). §0-§5 partition tables consumed by W2 KindMigrationModule modules. Cluster-2 ratification gate cleared.

**v0.2 → v0.3 substrate-currency-ratification record:**

Engineer-proactive Q2 verify-before-bake applied UPFRONT at thread-644 R1 (not retroactively as W1 thread-643 did). Code-grepped `hub/src/entities/{task,pending-action,turn}-repository-substrate.ts` + entity type files for substrate-current write/read shape per kind. **ZERO drift found** — Design v0.2 §2.1-§2.3 partitions match substrate-truth exactly. The 7th anticipated substrate-currency catch did NOT materialize; positive-surprise outcome documenting the discipline catches no-drift equally.

**Why no drift:** cluster-2 Design v0.2 was authored 2026-05-23 post-W4.x.10 (mission-83 W5 completion); substrate-accurate at authoring. Cluster-1 v0.2 drift was a timing artifact (earlier authoring with forward-looking speculation).

**Engineer-proactive verify-before-bake at Q-class disposition is LOAD-BEARING discipline** (per architect framing thread-643 R2 v1.2 candidate methodology rule). Discipline catches BOTH drift AND ratifies no-drift outcomes equally. Calibration cluster maturing self-prompting at engineer side.

**v0.3 cross-cluster envelope-methodology pattern (declared-with-controlled-mutation 4-class axis):**

| Class | Examples | Partition |
|---|---|---|
| Declared-immutable | Task.directive, Proposal.summary, Idea.text | spec (immutable post-create) |
| Declared-with-controlled-mutation | Task.assignedAgentId (PodSpec.nodeName), PendingAction.{receiptDeadline, completionDeadline} (LeaseSpec.acquireTime) | spec (mutable via substrate-controlled mechanism without FSM-phase flip) |
| Observed-FSM-mutated | status.phase, Task.report*/review*/clarification*, PendingAction.{receiptAckedAt, completionAckedAt, attemptCount} | status |
| Virtual-view | Mission.tasks/ideas, Turn.missionIds/taskIds | OMIT (computed at repository.hydrate() read-time) |

**W2 OQ11 in-flight disposition mechanism (Q4(a) ratified at thread-644 R2):**

Env-var flag `MIGRATION_IN_PROGRESS_<KIND>=true`. Set by MigrationRunner at `runKind()` entry (`shared/migration-flag.ts:setMigrationFlag`); cleared in `finally` block. Consumers (sweepers + writers) call `isMigrationInProgress(kind)` at tick-start / write-boundary. `MigrationInProgressError` marker class for writers to throw with `kind` property.

**Mechanism choice rationale:** scope-narrow for W2; matches W6 strict-flip env-var pattern + W0 `SUBSTRATE_ENVELOPE_TOLERANT` precedent; works for single-process Hub today. β substrate-pause-lock SchemaDef + γ LISTEN/NOTIFY events DEFERRED to distributed-Hub substrate-refactor cycle (idea-200/idea-129 follow-on; outside mission-88 scope per substrate-extension-minimum-disruption pattern from W1 Mission.pulses precedent).

**v0.2 history-of-record** — engineer PR #268 v0.1 review integrated. All 13 OQ dispositions applied; 3 engineer observations (directive-immutability-verified · turnId-as-ownerReferences-analog · naturalKey-derived-field) folded in; §2.2/§2.3 stubs filled to full JSON Schema; §1.5 handle-classified vs content-classified methodology note added; §6 cluster decomposition (c) 5+5 split RATIFIED.

**Substantive cluster-2 contributions to envelope methodology (signal for clusters 3/4/5):**

1. **`metadata.name` for handle-classified kinds** (§1.5 + §2.3) — Turn is the first kind to use it; Agent/Tele/ArchitectDecision are candidates.
2. **Declared-with-controlled-mutation pattern** (§2.1 Task.spec.assignedAgentId + §2.2 PendingAction.spec.deadlines) — K8s precedents PodSpec.nodeName + LeaseSpec.acquireTime. Substrate-controlled mutation lives in spec without FSM-phase flip.
3. **Derived-scalar-field discipline** (§2.2 PendingAction.metadata.naturalKey) — analog of virtual-view discipline for scalars; computed at substrate write-boundary; SchemaDef `"derived": true` flag.
4. **Default-to-status partition for FSM-mutated fields** (§1) — inverse of cluster-1's default-to-spec; FSM is the load-bearing surface for queue/FSM-active kinds.

**Engineer approval posture (v0.1 → v0.2 transition):**
- v0.1 approved by greg (PR #268 review APPROVED 2026-05-23T10:43Z; CI green at commit `212ed8e`)
- v0.2 integrates all dispositions per engineer review body; awaits v0.2 re-approval
- Post-v0.2-approval: merge cluster-2 PR; start cluster-3

**Next architect action post-approval:** cluster-3 Design (Tele / Counter / Agent / SchemaDef per §6 ratified scope).
