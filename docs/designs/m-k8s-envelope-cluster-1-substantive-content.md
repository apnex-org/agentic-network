# M-K8s-Envelope — Cluster 1 Substantive-Content Partition (Design Working Draft)

**Status:** v0.3 — substrate-truth ratified · ready for migration consumption
**Mission:** mission-88 (M-K8s-Envelope; idea-126 anchor)
**Phase:** Phase 4 Design — cluster-1 partition pass (1 of 5 clusters; Phase 8 W1 implementation)
**Coordination root:** `thread-634` (Design Round 1; closed) · `thread-643` (W1 drift-resolution; closed)
**Date:** 2026-05-24 AEST (v0.3: W1 substrate-currency drift-resolution per thread-643 ratification)
**Sibling Designs (forthcoming):**
- Cluster 2 — queue/FSM-active (Task / PendingActionItem / DirectorNotification / Turn / Clarification)
- Cluster 3 — metadata/config/projection (Tele / Counter / Agent / Session)
- Cluster 4 — audit/event (Message / Audit / RepoEvent)

**Survey input:** `docs/reviews/2026-05-23-survey-idea-126.md` (Director-ratified R1 A/A/A + R2 A/A/A — substrate-wide all-at-once + strict K8s + minimal 2-group taxonomy + big-bang cutover)

**v0.2 → v0.3 changelog (W1 substrate-currency drift-resolution per thread-643):**
- §3.0 NEW — v0.3 ratified per-kind partition (substrate-truth tables; consumed by W1 KindMigrationModule)
- §3.1 Idea: drop `revisionCount` (doesn't exist in substrate); add `updatedAt` → metadata
- §3.2 Bug: add `updatedAt` → metadata; FSM enum confirmed (no drift)
- §3.3 Thread: FSM enum corrected — `expired` REMOVED; `round_limit` + `cascade_failed` ADDED (substrate-truth); cascade-pending bookkeeping (`cascadePending` + `cascadePendingActionCount` + `cascadePendingStartedAt` + `cascadeCompletedAt`) → status
- §3.4 Mission: drop `goal` / `sourceIdeaId` / `sourceProposalId` / `issuedTaskIds[]`-synthetic / `sliceTracking` (none exist in substrate); ADD `documentRef` (spec) / `correlationId` (metadata) / `turnId` (status) / `missionClass` (spec) / `pulses` (status MONOLITHIC); FSM enum corrected `cancelled` → `abandoned`; `tasks` + `ideas` virtual-hydrated DO NOT MIGRATE (envelope omits)
- §3.4 NEW OPEN-ENDED note — Mission.pulses partition deferred-split: monolithic `status.pulses` for mission-88 W1 (substrate-extension-minimum-disruption preserves MissionPulses interface); split to `spec.pulses` (config) + `status.pulseTracking` (bookkeeping) is OPEN-ENDED candidate for idea-200/idea-129 follow-on substrate-refactor cycle
- §3.5 Proposal: drop `body` / `linkedIdeaId` / `linkedMissionId` / `reviewCount` (none exist in substrate; W4.x.7 dropped body-storage); ADD `summary` (spec) / `proposalRef` (metadata vestigial) / `decision` + `feedback` + `scaffoldResult` (status) / `executionPlan` (spec) / `labels` + `sourceThread*` (metadata); FSM enum REPLACED `draft/under-review/ratified/closed` → `submitted/approved/rejected/changes_requested/implemented` (substrate-truth)
- §6 NEW — drift-table-resolution-record (per-kind v0.2 → v0.3 audit trail)

**v0.1 → v0.2 changelog (engineer Round 7 review integration):**
- §3.1 Idea: `tags → metadata.labels` (K8s-convention map shape; migration translates array → map with empty values); `sourceThreadSummary → metadata.annotations["ois.io/sourceThreadSummary"]` (K8s-convention vendor-namespaced annotation); `dismissedReason` migration TODO added; `name` omitted for Idea (content-classified kind); nested-path filter semantics pinned with example
- §3.2-3.5: stubs filled per engineer dispositions
- §5: acceptance criteria expanded with cross-Mission dependency surface row (Thread.status.messages staged; Proposal stays; sourceThreadSummary → annotations)

---

## §1 Design scope — cluster 1 substantive-content kinds

| Kind | Mediation | Notes |
|---|---|---|
| Thread | IThreadStore | bilateral discussion thread; rich state (rounds, convergence, participants) |
| Idea | IIdeaStore | proposed unit of work; lightweight |
| Bug | IBugStore | observed defect; FSM (open/investigating/resolved/wontfix) |
| Mission | IMissionStore | execution unit; complex (plannedTasks, slices, status) |
| Proposal | IProposalStore | engineered solution Design phase output |

All 5 share the "human-readable substantive content surface" property — they have title/description/body cognitive surfaces + workflow status.

## §2 Methodology — strict K8s partition (per Survey Q1-A R2)

Each kind's existing flat fields partition into one of three sections:

| Section | Semantic | Examples |
|---|---|---|
| `metadata` | identity + bookkeeping (created when, by whom; provenance lineage; labels; correlation) | `id`, `kind`, `apiVersion`, `createdAt`, `createdBy`, `sourceThreadId`, `sourceActionId`, `labels`, `annotations`, `revisionCount`, `correlationId` |
| `spec` | declared intent (what the author wanted; immutable except via explicit update) | per-kind cognitive content + configuration |
| `status` | observed/runtime state (what's happened to/with the entity; mutates via FSM transitions + system updates) | per-kind lifecycle phase + computed counts + completion markers |

**K8s-convention sub-discipline (per v0.2 engineer refinement):**
- `metadata.labels`: map shape `{key: value}`; queryable classification (K8s precedent: `kubectl --selector=key=value`). For OIS, content-tag arrays migrate to labels map with empty-string values: `["umbrella", "methodology"]` → `{"umbrella": "", "methodology": ""}`.
- `metadata.annotations`: map shape `{key: value}`; free-form non-identifying string data; K8s key convention uses `<vendor>/<name>` (e.g., `"ois.io/sourceThreadSummary"`).
- `metadata.name`: optional human-friendly handle; OMITTED for content-classified kinds where the substantive content lives in `spec` (Idea, Bug). Reserved for kinds with separate handle semantics.

**Strict discipline:** no per-kind discretion on partition (Survey Q1-A R2 rejected the "author-judgment" option C). When a field is ambiguous between intent/observed, default to intent (`spec`) unless the field clearly mutates from FSM/system action post-creation.

**`apiVersion`:** all cluster-1 kinds carry `apiVersion: "core.ois/v1"` (per Survey Q2-A R2 minimal 2-group taxonomy + Q3-A R1 K8s `{group}/{version}` style).

**FilterableField.path:** per-kind in SchemaDef v2.0; filter-shorthand → envelope-path translation. Supports nested-path filters via dot-notation (e.g., `{shorthand: "createdBy.role", path: "metadata.createdBy.role"}`). Map-type filter shorthand follows K8s-selector semantics for labels/annotations. Composes with idea-121 Phase A `list_*` tools that consult SchemaDef at runtime (per thread-634 Q7).

**Cognitive-surface ergonomic (per thread-634 Q8):** the substrate is strict K8s. LLM-ergonomic flat projection (e.g., `Thread.title → spec.title` rendered as flat `title`) is **NOT** in this Mission's scope — that's idea-121's `get_resource({view: "flat"|"full"})` projection layer.

---

## §3 Per-kind partitions

### §3.0 v0.3 ratified partition (substrate-truth; W1 migration-module consumption)

This section supersedes §3.1-§3.5 v0.2 partition JSON-schemas for IMPLEMENTATION CONSUMPTION (the v0.2 JSON blocks are preserved below as Design-history-of-record). The §3.0 tables below are the ground-truth field-lists per-kind that mission-88 W1 KindMigrationModule modules at `hub/src/storage-substrate/migrations/v2-envelope/kinds/{Idea,Bug,Thread,Mission,Proposal}.ts` implement.

**Common across all 5 kinds (envelope top-level):**
- `id` — preserved; substrate primary-key
- `name` — defaults to `id` (omitted-name semantics for content-classified kinds per Survey §2)
- `kind` — set to `Idea` / `Bug` / `Thread` / `Mission` / `Proposal`
- `apiVersion` — `core.ois/v1`

**Common rename across all 5 kinds:** `status` (FSM enum at top-level) → `status.phase` (K8s-convention nested FSM).

#### Idea (substrate-truth)

| Partition | Fields | Notes |
|---|---|---|
| `metadata` | `createdAt`, `createdBy`, `updatedAt`, `sourceThreadId`, `sourceActionId`, `labels`, `annotations` | `labels` populated from legacy `tags[]` (array → map; empty-string values); `annotations["ois.io/sourceThreadSummary"]` populated from legacy `sourceThreadSummary` |
| `spec` | `text` | Declared content |
| `status` | `phase`, `missionId` | FSM phase ∈ `open` / `triaged` / `incorporated` / `dismissed` |

**Drops** (v0.2 listed; substrate has none): `revisionCount`.

#### Bug (substrate-truth)

| Partition | Fields | Notes |
|---|---|---|
| `metadata` | `createdAt`, `createdBy`, `updatedAt`, `sourceThreadId`, `sourceActionId`, `sourceIdeaId`, `surfacedBy`, `labels`, `annotations` | `labels` ← `tags[]`; `annotations` ← `sourceThreadSummary` |
| `spec` | `title`, `description`, `severity`, `class` | Declared content + classification |
| `status` | `phase`, `fixCommits`, `fixRevision`, `linkedTaskIds`, `linkedMissionId` | FSM phase ∈ `open` / `investigating` / `resolved` / `wontfix` |

#### Thread (substrate-truth)

| Partition | Fields | Notes |
|---|---|---|
| `metadata` | `createdAt`, `createdBy`, `updatedAt`, `correlationId`, `labels` | Thread already has `labels: Record<string,string>` (no `tags[]` transform); no `sourceThreadSummary` |
| `spec` | `title`, `routingMode`, `recipientAgentId`, `maxRounds`, `semanticIntent`, `context`, `idleExpiryMs` | Declared at thread open |
| `status` | `phase`, `roundCount`, `currentTurn`, `currentTurnAgentId`, `currentSemanticIntent`, `lastMessageConverged`, `lastMessageProjectedAt`, `outstandingIntent`, `summary`, `convergenceActions`, `participants`, `messages`, `cascadePending`, `cascadePendingActionCount`, `cascadePendingStartedAt`, `cascadeCompletedAt` | FSM phase ∈ `active` / `converged` / `round_limit` / `closed` / `abandoned` / `cascade_failed` (substrate-truth corrects v0.2's `expired`); cascade-pending bookkeeping → status (Q2 drift); `messages[]` staged-inside-envelope (idea-200 W2 carves out post-cutover per §3.3 v0.2) |

#### Mission (substrate-truth) ⚠ OPEN-ENDED on pulses partition

| Partition | Fields | Notes |
|---|---|---|
| `metadata` | `createdAt`, `createdBy`, `updatedAt`, `sourceThreadId`, `sourceActionId`, `correlationId`, `annotations` | `annotations` ← `sourceThreadSummary`; no `labels` field in substrate |
| `spec` | `title`, `description`, `documentRef`, `missionClass`, `plannedTasks` | Declared at Mission creation; `plannedTasks[].issuedTaskId` is INTRINSIC per-slot tracking |
| `status` | `phase`, `turnId`, `pulses` | FSM phase ∈ `proposed` / `active` / `completed` / `abandoned` (substrate-truth corrects v0.2's `cancelled`); `pulses` MONOLITHIC per architect-ratified disposition |

**Drops** (v0.2 listed; substrate has none): `goal`, `sourceIdeaId`, `sourceProposalId`, synthetic `issuedTaskIds[]`, `sliceTracking`.

**Virtual-hydrated DO NOT MIGRATE:** `tasks`, `ideas` — repository.hydrate() recomputes at read-time; envelope OMITS.

**OPEN-ENDED — Mission.pulses partition deferred-split.** Mission-88 W1 commits monolithic `status.pulses` (preserves MissionPulses interface + handler call-sites unchanged; cluster-3 §1.6 multi-FSM-in-status pattern is precedent for tightly-coupled status fields). Split to `spec.pulses` (engineerPulse/architectPulse config: intervalSeconds + message + responseShape + missedThreshold + firstFireDelaySeconds) + `status.pulseTracking` (lastFiredAt + lastResponseAt + missedCount + lastEscalatedAt per pulse-kind) is K8s-purer but expands W1 scope to substrate refactor (MissionPulses interface change + pulse-sweeper change). Deferred to **idea-200 / idea-129 follow-on substrate-refactor cycle** when those Missions land. Document the intent here so it isn't lost.

#### Proposal (substrate-truth)

| Partition | Fields | Notes |
|---|---|---|
| `metadata` | `createdAt`, `createdBy`, `updatedAt`, `sourceThreadId`, `sourceActionId`, `correlationId`, `proposalRef`, `labels`, `annotations` | `proposalRef` is vestigial pointer (W4.x.7 dropped MD-file storage); `annotations` ← `sourceThreadSummary` |
| `spec` | `title`, `summary`, `executionPlan` | Substrate has only `summary` (NOT `body`); `executionPlan` may mutate via reviewProposal |
| `status` | `phase`, `decision`, `feedback`, `scaffoldResult` | FSM phase ∈ `submitted` / `approved` / `rejected` / `changes_requested` / `implemented` (substrate-truth REPLACES Design v0.2's `draft`/`under-review`/`ratified`/`closed`) |

**Drops** (v0.2 listed; substrate has none): `body`, `linkedIdeaId`, `linkedMissionId`, `reviewCount`.

---

### §3.1 Idea — canonical reference

**Existing flat shape** (per `hub/src/entities/idea.ts`):
- `id`, `text`, `tags`, `status` (FSM: open/triaged/incorporated/dismissed), `missionId`, `createdAt`, `createdBy`, `sourceThreadId`, `sourceActionId`, `sourceThreadSummary`, `revisionCount`

**Partition (v0.2 with engineer refinements):**

```json
{
  "name": "Idea",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "type": "object",
      "required": ["id", "kind", "apiVersion", "createdAt"],
      "properties": {
        "id":          { "type": "string", "pattern": "^idea-[0-9]+$" },
        "kind":        { "const": "Idea" },
        "apiVersion":  { "const": "core.ois/v1" },
        "createdAt":   { "type": "string", "format": "date-time" },
        "createdBy":   { "$ref": "#/definitions/Author" },
        "sourceThreadId":  { "type": ["string", "null"] },
        "sourceActionId":  { "type": ["string", "null"] },
        "revisionCount":   { "type": "integer", "minimum": 0 },
        "labels":      {
          "type": "object",
          "additionalProperties": { "type": "string" },
          "description": "K8s-convention map; queryable classification. Migrates from existing tags array (per-tag key with empty-string value)."
        },
        "annotations": {
          "type": "object",
          "additionalProperties": { "type": "string" },
          "description": "K8s-convention map; free-form non-identifying. Used for sourceThreadSummary + future LLM-friendly extensions."
        }
      }
    },
    "spec-schema": {
      "type": "object",
      "required": ["text"],
      "properties": {
        "text":  { "type": "string", "description": "the idea content (declared intent)" }
      }
    },
    "status-schema": {
      "type": "object",
      "required": ["phase"],
      "properties": {
        "phase":           { "enum": ["open", "triaged", "incorporated", "dismissed"] },
        "missionId":       { "type": ["string", "null"], "description": "incorporated-into; populated when phase advances" },
        "dismissedReason": { "type": ["string", "null"], "description": "free-form reason; optional on FSM dismissal transition" }
      }
    },
    "filterable-fields": [
      { "shorthand": "phase",              "path": "status.phase" },
      { "shorthand": "missionId",          "path": "status.missionId" },
      { "shorthand": "label",              "path": "metadata.labels",            "selector": "k8s-map" },
      { "shorthand": "sourceThreadId",     "path": "metadata.sourceThreadId" },
      { "shorthand": "createdBy.role",     "path": "metadata.createdBy.role" },
      { "shorthand": "createdBy.agentId",  "path": "metadata.createdBy.agentId" }
    ]
  }
}
```

**Partition rationale (Idea):**

| Field (current flat) | Envelope position | Why |
|---|---|---|
| `id`, `kind`, `apiVersion`, `createdAt`, `createdBy` | `metadata` | identity + bookkeeping; K8s-standard |
| `sourceThreadId`, `sourceActionId` | `metadata` | provenance lineage; bug-118 fix-site |
| `sourceThreadSummary` | `metadata.annotations["ois.io/sourceThreadSummary"]` | K8s-convention: free-form non-identifying string data |
| `revisionCount` | `metadata` | system-tracked bookkeeping |
| `tags` (array) | `metadata.labels` (map) | K8s-convention; migration translates `["a","b"]` → `{"a":"","b":""}` |
| `text` | `spec` | declared intent at idea-creation |
| `status` (FSM) → `phase` | `status.phase` | observed lifecycle; K8s `status.phase` convention; field rename: `Idea.status` → `Idea.status.phase` |
| `missionId` | `status` | observed (populated when incorporated); not author-declared at creation |
| `dismissedReason` (NEW) | `status` | optional FSM-transition payload; defaults `null` for pre-cutover entities |

**Field renames / new fields:**
- `Idea.status` (current flat FSM enum) → `Idea.status.phase` (envelope shape; K8s convention)
- `Idea.tags` (current flat array) → `Idea.metadata.labels` (envelope map; per-tag key with empty-string value)
- `Idea.sourceThreadSummary` (current flat string) → `Idea.metadata.annotations["ois.io/sourceThreadSummary"]` (K8s vendor-namespaced annotation)
- **NEW field**: `Idea.status.dismissedReason` (string, nullable); defaults `null` for pre-cutover dismissed entities; optional on FSM dismissal transition.

**Migration TODO (engineer-side migration script):**
- `tags` array → `metadata.labels` map: each string in tags becomes key with empty-string value; preserves uniqueness invariant.
- `sourceThreadSummary` → `metadata.annotations` map: populate `"ois.io/sourceThreadSummary"` key with current value.
- Pre-cutover dismissed entities: `status.dismissedReason: null` (no historical reason data).
- `Idea.metadata.name`: OMITTED (content-classified kind; `spec.text` is the human-readable content).

**Composition with bug-118:** `metadata.sourceThreadId` becomes a first-class envelope field. Forward-looking-only capture (per Survey + thread-632 anti-goal); no historical backfill.

---

### §3.2 Bug — partition (v0.2 fill per engineer Round 7 dispositions)

**Existing flat shape** (per `hub/src/entities/bug.ts`):
- `id`, `title`, `description`, `severity`, `class`, `tags`, `status` (FSM: open/investigating/resolved/wontfix), `createdAt`, `createdBy`, `surfacedBy`, `fixCommits`, `fixRevision`, `sourceIdeaId`, `sourceThreadId`, `sourceActionId`, `sourceThreadSummary`, `linkedTaskIds`, `linkedMissionId`

**Partition:**

```json
{
  "name": "Bug",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "type": "object",
      "required": ["id", "kind", "apiVersion", "createdAt"],
      "properties": {
        "id":              { "type": "string", "pattern": "^bug-[0-9]+$" },
        "kind":            { "const": "Bug" },
        "apiVersion":      { "const": "core.ois/v1" },
        "createdAt":       { "type": "string", "format": "date-time" },
        "createdBy":       { "$ref": "#/definitions/Author" },
        "sourceThreadId":  { "type": ["string", "null"] },
        "sourceActionId":  { "type": ["string", "null"] },
        "sourceIdeaId":    { "type": ["string", "null"], "description": "provenance lineage; sibling of sourceThreadId" },
        "surfacedBy":      { "enum": ["integration-test", "prod-audit", "code-review", "llm-self-review", null] },
        "labels":          { "type": "object", "additionalProperties": { "type": "string" } },
        "annotations":     { "type": "object", "additionalProperties": { "type": "string" } }
      }
    },
    "spec-schema": {
      "type": "object",
      "required": ["title", "severity"],
      "properties": {
        "title":       { "type": "string" },
        "description": { "type": "string" },
        "severity":    { "enum": ["minor", "major", "critical"] },
        "class":       { "type": ["string", "null"], "description": "free-form taxonomy at filing" }
      }
    },
    "status-schema": {
      "type": "object",
      "required": ["phase"],
      "properties": {
        "phase":           { "enum": ["open", "investigating", "resolved", "wontfix"] },
        "fixCommits":      { "type": "array", "items": { "type": "string" } },
        "fixRevision":     { "type": ["string", "null"] },
        "linkedTaskIds":   { "type": "array", "items": { "type": "string" } },
        "linkedMissionId": { "type": ["string", "null"] }
      }
    },
    "filterable-fields": [
      { "shorthand": "phase",          "path": "status.phase" },
      { "shorthand": "severity",       "path": "spec.severity" },
      { "shorthand": "class",          "path": "spec.class" },
      { "shorthand": "surfacedBy",     "path": "metadata.surfacedBy" },
      { "shorthand": "sourceThreadId", "path": "metadata.sourceThreadId" },
      { "shorthand": "sourceIdeaId",   "path": "metadata.sourceIdeaId" },
      { "shorthand": "linkedMissionId","path": "status.linkedMissionId" },
      { "shorthand": "label",          "path": "metadata.labels",          "selector": "k8s-map" }
    ]
  }
}
```

**Partition rationale (Bug):**
- `surfacedBy` → metadata: identifies origin context; not author-declared content (engineer Round 7 disposition).
- `linkedTaskIds` / `linkedMissionId` → status: observed linking discovered post-filing.
- `fixCommits` / `fixRevision` → status: observed; populated when bug is resolved.
- `sourceIdeaId` → metadata: provenance lineage; sibling of `sourceThreadId`.
- `tags` (array) → `metadata.labels` (map) per A.1 K8s-convention.
- `sourceThreadSummary` → `metadata.annotations["ois.io/sourceThreadSummary"]` per A.2.
- `name` OMITTED (Bug is content-classified; `spec.title` is the substantive content).
- **Bug FSM extension out-of-scope** (Survey scope is envelope-only; v2.1 candidate N tracks `triaged` status separately).
- `Bug.status` (current flat FSM enum) → `Bug.status.phase` (envelope; same K8s rename pattern as Idea).

---

### §3.3 Thread — partition (v0.2 fill per engineer Round 7 dispositions)

**Existing flat shape** (per `hub/src/entities/thread.ts`):
- `id`, `title`, `labels`, `status`, `context`, `summary`, `messages[]`, `createdAt`, `createdBy`, `maxRounds`, `updatedAt`, `roundCount`, `currentTurn`, `routingMode`, `idleExpiryMs`, `participants[]`, `correlationId`, `recipientAgentId`, `outstandingIntent`, `convergenceActions[]`, `currentTurnAgentId`, `lastMessageConverged`, `currentSemanticIntent`, `lastMessageProjectedAt`, `semanticIntent`

**Partition:**

```json
{
  "name": "Thread",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "type": "object",
      "required": ["id", "kind", "apiVersion", "createdAt"],
      "properties": {
        "id":              { "type": "string", "pattern": "^thread-[0-9]+$" },
        "kind":            { "const": "Thread" },
        "apiVersion":      { "const": "core.ois/v1" },
        "createdAt":       { "type": "string", "format": "date-time" },
        "createdBy":       { "$ref": "#/definitions/Author" },
        "updatedAt":       { "type": "string", "format": "date-time" },
        "correlationId":   { "type": ["string", "null"] },
        "labels":          { "type": "object", "additionalProperties": { "type": "string" } },
        "annotations":     { "type": "object", "additionalProperties": { "type": "string" } }
      }
    },
    "spec-schema": {
      "type": "object",
      "required": ["routingMode"],
      "properties": {
        "title":            { "type": ["string", "null"] },
        "routingMode":      { "enum": ["unicast", "broadcast", "multicast"] },
        "recipientAgentId": { "type": ["string", "null"] },
        "maxRounds":        { "type": "integer", "minimum": 1 },
        "semanticIntent":   { "type": ["string", "null"] },
        "context":          { "type": ["object", "null"], "description": "multicast bound-entity (entityType + entityId); declared at thread open" },
        "idleExpiryMs":     { "type": ["integer", "null"] }
      }
    },
    "status-schema": {
      "type": "object",
      "required": ["phase"],
      "properties": {
        "phase":                  { "enum": ["active", "converged", "closed", "expired", "abandoned"] },
        "roundCount":             { "type": "integer", "minimum": 0 },
        "currentTurn":            { "enum": ["architect", "engineer", null] },
        "currentTurnAgentId":     { "type": ["string", "null"] },
        "currentSemanticIntent":  { "type": ["string", "null"] },
        "lastMessageConverged":   { "type": "boolean" },
        "lastMessageProjectedAt": { "type": ["string", "null"], "format": "date-time" },
        "outstandingIntent":      { "type": ["string", "null"] },
        "summary":                { "type": "string" },
        "convergenceActions":     { "type": "array", "items": { "$ref": "#/definitions/ConvergenceAction" } },
        "participants":           { "type": "array", "items": { "$ref": "#/definitions/Participant" } },
        "messages":               {
          "type": "array",
          "items": { "$ref": "#/definitions/Message" },
          "description": "STAGED-INSIDE-ENVELOPE per v0.2 disposition; idea-200 W2 carves out to Message-store post-this-cutover. See §5 acceptance criteria."
        }
      }
    },
    "filterable-fields": [
      { "shorthand": "phase",              "path": "status.phase" },
      { "shorthand": "routingMode",        "path": "spec.routingMode" },
      { "shorthand": "recipientAgentId",   "path": "spec.recipientAgentId" },
      { "shorthand": "currentTurn",        "path": "status.currentTurn" },
      { "shorthand": "currentTurnAgentId", "path": "status.currentTurnAgentId" },
      { "shorthand": "lastMessageConverged","path": "status.lastMessageConverged" },
      { "shorthand": "correlationId",      "path": "metadata.correlationId" },
      { "shorthand": "label",              "path": "metadata.labels",          "selector": "k8s-map" }
    ]
  }
}
```

**Partition rationale (Thread):**
- `messages[]` → `status.messages[]` STAGED-INSIDE-ENVELOPE for now; idea-200 W2 carves out to Message-store post-this-cutover. See §5 acceptance criteria — this is a known cross-Mission dependency surface.
- `participants[]` → status (mutates with multicast joins; not declared at open).
- `phase` enum (NEW): derive from current flat `status` + `lastMessageConverged` + `convergenceActions[].status`. Migration script handles the derivation per:
  - `status: "active"` + lastMessageConverged: false → `status.phase: "active"`
  - `status: "active"` + lastMessageConverged: true → `status.phase: "converged"`
  - `status: "closed"` + last convergence had committed actions → `status.phase: "closed"`
  - (etc; full migration logic in migration script)
- `convergenceActions[]` → status (mutates with thread rounds).
- `summary` → status (system-projected at convergence).
- `context` → spec (declared at thread open; identifies multicast membership source).
- `Thread.status` (current flat FSM enum) → `Thread.status.phase` (envelope; same K8s rename as Idea/Bug).
- `name` OMITTED (Thread.spec.title is the substantive content; not a separate handle).

---

### §3.4 Mission — partition (v0.2 fill per engineer Round 7 dispositions)

**Existing flat shape** (per `hub/src/entities/mission.ts`):
- `id`, `title`, `description`, `goal`, `status` (FSM), `plannedTasks[]`, `createdAt`, `createdBy`, `sourceIdeaId`, `sourceThreadId`, `sourceActionId`, `sourceProposalId`, ... (engineer to confirm full enum + slice tracking fields at v0.3)

**Partition:**

```json
{
  "name": "Mission",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "type": "object",
      "required": ["id", "kind", "apiVersion", "createdAt"],
      "properties": {
        "id":              { "type": "string", "pattern": "^mission-[0-9]+$" },
        "kind":            { "const": "Mission" },
        "apiVersion":      { "const": "core.ois/v1" },
        "createdAt":       { "type": "string", "format": "date-time" },
        "createdBy":       { "$ref": "#/definitions/Author" },
        "sourceThreadId":  { "type": ["string", "null"] },
        "sourceActionId":  { "type": ["string", "null"] },
        "sourceIdeaId":    { "type": ["string", "null"] },
        "sourceProposalId":{ "type": ["string", "null"] },
        "labels":          { "type": "object", "additionalProperties": { "type": "string" } },
        "annotations":     { "type": "object", "additionalProperties": { "type": "string" } }
      }
    },
    "spec-schema": {
      "type": "object",
      "required": ["title"],
      "properties": {
        "title":         { "type": "string" },
        "description":   { "type": "string" },
        "goal":          { "type": "string", "description": "declared intent at Mission creation" },
        "plannedTasks":  {
          "type": "array",
          "items": { "$ref": "#/definitions/PlannedTask" },
          "description": "declared desired-state per K8s precedent; spec partition. Task-issuance tracking lives in status.issuedTaskIds."
        }
      }
    },
    "status-schema": {
      "type": "object",
      "required": ["phase"],
      "properties": {
        "phase":          { "enum": ["proposed", "active", "completed", "cancelled"], "description": "TODO v0.3: engineer to confirm full enum from hub/src/entities/mission.ts" },
        "startedAt":      { "type": ["string", "null"], "format": "date-time" },
        "completedAt":    { "type": ["string", "null"], "format": "date-time" },
        "issuedTaskIds":  {
          "type": "array",
          "items": { "type": "string" },
          "description": "observed: which plannedTasks have been issued (cascade from create_task)"
        },
        "sliceTracking":  { "type": ["object", "null"], "description": "TODO v0.3: engineer to spec slice-tracking shape from current mission code" }
      }
    },
    "filterable-fields": [
      { "shorthand": "phase",          "path": "status.phase" },
      { "shorthand": "sourceIdeaId",   "path": "metadata.sourceIdeaId" },
      { "shorthand": "sourceProposalId","path": "metadata.sourceProposalId" },
      { "shorthand": "label",          "path": "metadata.labels",            "selector": "k8s-map" }
    ]
  }
}
```

**Partition rationale (Mission):**
- `plannedTasks[]` → spec (declared intent at Manifest; desired-state per K8s precedent — `kubectl apply` declares spec, status observes).
- `issuedTaskIds` → status (observed: which plannedTasks the engineer has issued via `create_task` cascade).
- `goal` → spec (declared intent at Mission creation).
- Mission FSM phases (proposed/active/completed/cancelled): engineer-confirm at v0.3 against `hub/src/entities/mission.ts`.
- `sliceTracking` shape: engineer-spec at v0.3.
- `Mission.status` (current flat FSM enum) → `Mission.status.phase` (same K8s rename).
- `name` OMITTED (Mission.spec.title is the substantive content).

**v0.3 TODOs (engineer-confirm):**
- Mission FSM phase enum complete set
- sliceTracking object shape from current mission code

---

### §3.5 Proposal — partition (v0.2 fill per engineer Round 7 dispositions)

**Existing flat shape** (per `hub/src/entities/proposal.ts`):
- `id`, `title`, `body`, `status`, `createdAt`, `createdBy`, `linkedIdeaId`, `linkedMissionId`, `reviewCount`, ... (engineer to confirm at v0.3)

**Partition:**

```json
{
  "name": "Proposal",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "type": "object",
      "required": ["id", "kind", "apiVersion", "createdAt"],
      "properties": {
        "id":             { "type": "string", "pattern": "^proposal-[0-9]+$" },
        "kind":           { "const": "Proposal" },
        "apiVersion":     { "const": "core.ois/v1" },
        "createdAt":      { "type": "string", "format": "date-time" },
        "createdBy":      { "$ref": "#/definitions/Author" },
        "sourceThreadId": { "type": ["string", "null"] },
        "sourceActionId": { "type": ["string", "null"] },
        "linkedIdeaId":   { "type": ["string", "null"], "description": "provenance lineage" },
        "labels":         { "type": "object", "additionalProperties": { "type": "string" } },
        "annotations":    { "type": "object", "additionalProperties": { "type": "string" } }
      }
    },
    "spec-schema": {
      "type": "object",
      "required": ["title", "body"],
      "properties": {
        "title": { "type": "string" },
        "body":  { "type": "string", "description": "engineered solution declared content" }
      }
    },
    "status-schema": {
      "type": "object",
      "required": ["phase"],
      "properties": {
        "phase":           { "enum": ["draft", "under-review", "ratified", "closed"] },
        "linkedMissionId": { "type": ["string", "null"], "description": "observed; populated when Mission filed from this Proposal" },
        "reviewCount":     { "type": "integer", "minimum": 0 }
      }
    },
    "filterable-fields": [
      { "shorthand": "phase",           "path": "status.phase" },
      { "shorthand": "linkedIdeaId",    "path": "metadata.linkedIdeaId" },
      { "shorthand": "linkedMissionId", "path": "status.linkedMissionId" },
      { "shorthand": "sourceThreadId",  "path": "metadata.sourceThreadId" },
      { "shorthand": "label",           "path": "metadata.labels",            "selector": "k8s-map" }
    ]
  }
}
```

**Partition rationale (Proposal):**
- Stays as `Proposal` kind (Survey additive-only); idea-129 rename to `Design` is a follow-on Mission.
- `body` → spec (engineered solution declared content).
- `linkedIdeaId` → metadata (provenance lineage).
- `linkedMissionId` → status (observed; populated when Mission is filed from this Proposal).
- `reviewCount` → status (system-tracked mutations).
- `Proposal.status` (current flat FSM enum) → `Proposal.status.phase` (same K8s rename).
- `name` OMITTED (Proposal.spec.title is the substantive content).

---

## §4 Composition checkpoints

### §4.1 idea-121 (M-API-v2.0) — `get_resource_shape` consumer

idea-121's `get_resource_shape({entity})` MCP tool consumes the SchemaDef v2.0 envelope to derive:
- Flat-shape mapping (per thread-634 Q8 architect counter-proposal — `view: "flat"` projection)
- FilterableField.path resolution (per Q7) for `list_*` filter translation
- Per-kind `spec.verbs` declaration (Survey 2 Q2-D deferral) — pending Mission idea-121 Design

### §4.2 bug-118 (substrate-wide bug-lineage gap)

`metadata.sourceThreadId` / `sourceActionId` becomes envelope-level provenance. Hub-side write boundary captures session-context at write-time per `shared/provenance.ts` (Round 1 engineer architecture). Forward-looking only; historical backfill out of scope.

### §4.3 idea-151 (M-Graph-Relationships)

Relationship (kind 21) inherits this envelope post-cutover. Relationship.spec contains `{fromId, toId, edgeType}`; Relationship.status contains validation state + system-emit flags. Sequenced post idea-126 cutover.

### §4.4 idea-314 (M-Class-Tier-Promotion)

Initiative + Concept + Defect entities inherit envelope on creation. Class-Tier-Promotion sequences behind idea-121 + idea-126.

### §4.5 idea-200 (M-Thread-Substrate-Carve-Out, W2)

Thread.status.messages[] is staged-inside-envelope at this cutover (per §3.3 disposition). idea-200 W2 follow-on Mission carves out `messages[]` to Message-store; Thread.status.messages[] becomes a projection-reference rather than inline storage. **Acceptance criterion preserved**: Thread envelope shape is coherent at idea-126 cutover; idea-200 W2 is a separate Mission scope.

### §4.6 idea-129 (Design entity rename)

Proposal kind name stays as `Proposal` at this Mission's cutover (Survey additive-only). idea-129's follow-on Mission renames Proposal → Design + handles SchemaDef kind-name migration separately.

---

## §5 Acceptance criteria (cluster-1-specific)

- All 5 cluster-1 kinds carry valid envelope structure post-cutover (verified via psql JSON shape inspection per kind)
- Each kind's `apiVersion: "core.ois/v1"`
- Field partition follows strict K8s convention (no top-level cognitive-surface fields beyond `{id, name, kind, apiVersion, metadata, spec, status}` — `name` omitted for content-classified kinds Idea/Bug/Thread/Mission/Proposal)
- `FilterableField.path` declarations per kind enable shorthand-filter translation at `list_*` runtime (composes with idea-121); nested-path filters via dot-notation; map-type selectors for `metadata.labels` / `metadata.annotations`
- `metadata.sourceThreadId` populated for new writes via calling-session context (bug-118 fix integration)
- v1.1 → v2.0 SchemaDef migration script handlers cover all 5 kinds (unit tests per `feedback_substrate_extension_wire_flow_integration_test`)
- **Cross-Mission dependency surfaces (per v0.2):**
  - `Thread.status.messages[]` is staged-inside-envelope at cutover; idea-200 W2 carves out to Message-store post-this-cutover (separate Mission scope; acceptance criterion is envelope-coherence-at-cutover, not message-store-extraction)
  - `Proposal` stays as kind name at cutover; idea-129 rename to `Design` is a follow-on Mission
  - `metadata.annotations["ois.io/sourceThreadSummary"]` migration: existing flat `sourceThreadSummary` → annotations map; preserve string content
  - `metadata.labels` migration from `tags` array: each tag becomes key with empty-string value; preserve set semantics

---

## §6 Status

**v0.3** — substrate-truth ratified per thread-643 bilateral convergence (2026-05-24). §3.0 partition tables consumed by W1 KindMigrationModule modules. Cluster-1 ratification gate cleared.

**v0.2 → v0.3 drift-table-resolution-record:**

| Kind | v0.2 said | substrate-truth | v0.3 resolution |
|---|---|---|---|
| Idea | `revisionCount` in metadata | doesn't exist | dropped |
| Idea | no `updatedAt` | exists | added → metadata |
| Bug | no `updatedAt` | exists | added → metadata |
| Thread | phase enum `expired` | substrate has no `expired` | dropped from enum |
| Thread | phase enum missing `round_limit` / `cascade_failed` | substrate has both | added to enum |
| Thread | no `cascadePending*` / `cascadeCompletedAt` | exist (cascade bookkeeping) | added → status |
| Mission | `goal` in spec | doesn't exist | dropped |
| Mission | `sourceIdeaId` in metadata | doesn't exist | dropped |
| Mission | `sourceProposalId` in metadata | doesn't exist | dropped |
| Mission | no `documentRef` | exists | added → spec |
| Mission | no `correlationId` | exists | added → metadata |
| Mission | no `turnId` | exists | added → status |
| Mission | no `missionClass` | exists | added → spec |
| Mission | no `pulses` | exists | added → status MONOLITHIC (deferred-split OPEN-ENDED per §3.0) |
| Mission | `tasks` + `ideas` not addressed | virtual-hydrated (NOT persisted) | OMITTED from envelope |
| Mission | phase enum `cancelled` | substrate has `abandoned` | corrected |
| Mission | synthetic `issuedTaskIds[]` in status | doesn't exist | dropped (per-slot `plannedTasks[].issuedTaskId` is intrinsic) |
| Mission | `sliceTracking` v0.3 TODO | doesn't exist | dropped (no substrate counterpart) |
| Proposal | `body` in spec | doesn't exist (W4.x.7 dropped body-storage) | dropped |
| Proposal | `linkedIdeaId` in metadata | doesn't exist | dropped |
| Proposal | `linkedMissionId` in status | doesn't exist | dropped |
| Proposal | `reviewCount` in status | doesn't exist | dropped |
| Proposal | phase enum `draft/under-review/ratified/closed` | substrate has `submitted/approved/rejected/changes_requested/implemented` | REPLACED entirely |
| Proposal | no `summary` / `proposalRef` / `executionPlan` / `decision` / `feedback` / `scaffoldResult` / `labels` | all exist | added to partition tables |

**Calibration cluster:** v0.3 ratification is the 6th substrate-currency catch on mission-88 (engineer-proactive at Q2 verify-before-bake; thread-643 R1). Pattern: substrate-currency-discipline cuts both ways consistently; **engineer-proactive verify-before-bake at Q-class disposition is LOAD-BEARING** to prevent Design-stale drift from amplifying into migration-code defects.

**v0.2 history-of-record** — engineer Round 7 review integrated. (A) refinements applied to §3.1; (B) dispositions applied to §3.2-§3.5; (6) acceptance criteria expanded with cross-Mission dependency surfaces.

**Next mission-88 wave:** W2 cluster-2 (Task / PendingAction / Turn) — fresh coord-thread post-W1 acceptance close.
