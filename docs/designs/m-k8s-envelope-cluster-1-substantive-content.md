# M-K8s-Envelope — Cluster 1 Substantive-Content Partition (Design Working Draft)

**Status:** v0.1 — WORKING DRAFT · architect-fronts; awaiting engineer review on completeness
**Mission:** idea-126 (M-K8s-Envelope)
**Phase:** Phase 4 Design — cluster-1 partition pass (1 of 4 clusters per Round 1 grouping)
**Coordination root:** `thread-634` — Phase 4 Design coordination
**Date:** 2026-05-23 AEST
**Sibling Designs (forthcoming):**
- Cluster 2 — queue/FSM-active (Task / PendingActionItem / DirectorNotification / Turn / Clarification)
- Cluster 3 — metadata/config/projection (Tele / Counter / Agent / Session)
- Cluster 4 — audit/event (Message / Audit / RepoEvent)

**Survey input:** `docs/reviews/2026-05-23-survey-idea-126.md` (Director-ratified R1 A/A/A + R2 A/A/A — substrate-wide all-at-once + strict K8s + minimal 2-group taxonomy + big-bang cutover)

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
| `metadata` | identity + bookkeeping (created when, by whom; provenance lineage; labels; correlation) | `id`, `kind`, `apiVersion`, `createdAt`, `createdBy`, `sourceThreadId`, `sourceActionId`, `labels`, `revisionCount`, `correlationId` |
| `spec` | declared intent (what the author wanted; immutable except via explicit update) | per-kind cognitive content + configuration |
| `status` | observed/runtime state (what's happened to/with the entity; mutates via FSM transitions + system updates) | per-kind lifecycle phase + computed counts + completion markers |

**Strict discipline:** no per-kind discretion on partition (Survey Q1-A R2 rejected the "author-judgment" option C). When a field is ambiguous between intent/observed, default to intent (`spec`) unless the field clearly mutates from FSM/system action post-creation.

**`apiVersion`:** all cluster-1 kinds carry `apiVersion: "core.ois/v1"` (per Survey Q2-A R2 minimal 2-group taxonomy + Q3-A R1 K8s `{group}/{version}` style).

**FilterableField.path:** per-kind in SchemaDef v2.0; filter-shorthand → envelope-path translation (e.g., `sourceThreadId → metadata.sourceThreadId`). Composes with idea-121 Phase A `list_*` tools that consult SchemaDef at runtime (per thread-634 Q7).

**Cognitive-surface ergonomic (per thread-634 Q8):** the substrate is strict K8s. LLM-ergonomic flat projection (e.g., `Thread.title → spec.title` rendered as flat `title`) is **NOT** in this Mission's scope — that's idea-121's `get_resource({view: "flat"|"full"})` projection layer.

---

## §3 Per-kind partitions

### §3.1 Idea — worked example (canonical reference for the other 4)

**Existing flat shape** (per `hub/src/entities/idea.ts`):
- `id`, `text`, `tags`, `status` (FSM: open/triaged/incorporated/dismissed), `missionId`, `createdAt`, `createdBy`, `sourceThreadId`, `sourceActionId`, `sourceThreadSummary`, `revisionCount`

**Partition:**

```json
{
  "name": "Idea",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "type": "object",
      "required": ["id", "kind", "apiVersion", "createdAt"],
      "properties": {
        "id": { "type": "string", "pattern": "^idea-[0-9]+$" },
        "name": { "type": "string", "description": "optional human-friendly handle" },
        "kind": { "const": "Idea" },
        "apiVersion": { "const": "core.ois/v1" },
        "createdAt": { "type": "string", "format": "date-time" },
        "createdBy": { "$ref": "#/definitions/Author" },
        "sourceThreadId": { "type": ["string", "null"] },
        "sourceActionId": { "type": ["string", "null"] },
        "sourceThreadSummary": { "type": ["string", "null"] },
        "revisionCount": { "type": "integer", "minimum": 0 },
        "labels": { "type": "object", "additionalProperties": { "type": "string" } }
      }
    },
    "spec-schema": {
      "type": "object",
      "required": ["text"],
      "properties": {
        "text": { "type": "string", "description": "the idea content (declared intent)" },
        "tags": { "type": "array", "items": { "type": "string" } }
      }
    },
    "status-schema": {
      "type": "object",
      "required": ["phase"],
      "properties": {
        "phase": { "enum": ["open", "triaged", "incorporated", "dismissed"] },
        "missionId": { "type": ["string", "null"], "description": "incorporated-into; populated when phase advances" },
        "dismissedReason": { "type": ["string", "null"] }
      }
    },
    "filterable-fields": [
      { "shorthand": "phase",         "path": "status.phase" },
      { "shorthand": "missionId",     "path": "status.missionId" },
      { "shorthand": "tags",          "path": "spec.tags" },
      { "shorthand": "sourceThreadId","path": "metadata.sourceThreadId" },
      { "shorthand": "createdBy",     "path": "metadata.createdBy" }
    ]
  }
}
```

**Partition rationale (Idea):**

| Field | Section | Why |
|---|---|---|
| `id`, `kind`, `apiVersion`, `createdAt`, `createdBy` | `metadata` | identity + bookkeeping; K8s-standard |
| `sourceThreadId`, `sourceActionId`, `sourceThreadSummary` | `metadata` | provenance lineage; bug-118 fix-site |
| `revisionCount` | `metadata` | system-tracked bookkeeping |
| `text`, `tags` | `spec` | declared intent at idea-creation |
| `status` (FSM) → `phase` | `status` | observed lifecycle state; mutates via update_idea status transitions |
| `missionId` | `status` | observed (populated when idea is incorporated into a Mission); not author-declared at creation |

**Field rename:** `Idea.status` (current flat FSM enum field) → `Idea.status.phase` (envelope shape). The K8s convention names the lifecycle state `phase`; preserves the `status` section name + clarifies the field naming.

**Composition with bug-118:** `metadata.sourceThreadId` becomes a first-class envelope field. Forward-looking-only capture (per Survey + thread-632 anti-goal); no historical backfill.

---

### §3.2 Bug — stub (TODO architect; engineer audit pending)

**Existing flat shape** (per `hub/src/entities/bug.ts`):
- `id`, `title`, `description`, `severity`, `class`, `tags`, `status` (FSM: open/investigating/resolved/wontfix), `createdAt`, `createdBy`, `surfacedBy`, `fixCommits`, `fixRevision`, `sourceIdeaId`, `sourceThreadId`, `sourceActionId`, `sourceThreadSummary`, `linkedTaskIds`, `linkedMissionId`

**Proposed partition (TODO — architect to finalize):**

```json
{
  "name": "Bug",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "// TODO": "id, kind, apiVersion, createdAt, createdBy, sourceThreadId, sourceActionId, sourceThreadSummary, sourceIdeaId, surfacedBy, labels"
    },
    "spec-schema": {
      "// TODO": "title, description, severity, class, tags (declared at filing)"
    },
    "status-schema": {
      "// TODO": "phase (open/investigating/resolved/wontfix), fixCommits, fixRevision, linkedTaskIds, linkedMissionId"
    },
    "filterable-fields": [
      "// TODO: per architect partition pass + engineer audit"
    ]
  }
}
```

**Open questions for engineer review:**
- `surfacedBy` (categorical: integration-test / prod-audit / code-review / llm-self-review) — metadata or spec? Lean: metadata (identifies origin context).
- `linkedTaskIds` / `linkedMissionId` — status (observed linking through Mission lifecycle) vs spec (declared at filing if known)?
- v2.1 candidate N (Bug FSM lacks `triaged` status) — does Bug FSM extend in this Mission's scope, or stays separate? Survey scope says Bug FSM extension is out-of-scope for envelope migration; bug-117 + bug-118 use scope-pin-of-record on body as workaround. Confirm separation.

---

### §3.3 Thread — stub (TODO architect; engineer audit pending)

**Existing flat shape** (per `hub/src/entities/thread.ts`):
- `id`, `title`, `labels`, `status`, `context`, `summary`, `messages[]`, `createdAt`, `createdBy`, `maxRounds`, `updatedAt`, `roundCount`, `currentTurn`, `routingMode`, `idleExpiryMs`, `participants[]`, `correlationId`, `recipientAgentId`, `outstandingIntent`, `convergenceActions[]`, `currentTurnAgentId`, `lastMessageConverged`, `currentSemanticIntent`, `lastMessageProjectedAt`, `semanticIntent`

**Proposed partition (TODO — architect to finalize):**

```json
{
  "name": "Thread",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "// TODO": "id, kind, apiVersion, createdAt, createdBy, updatedAt, labels, correlationId"
    },
    "spec-schema": {
      "// TODO": "title, routingMode, recipientAgentId, maxRounds, semanticIntent, context, idleExpiryMs (declared at thread open)"
    },
    "status-schema": {
      "// TODO": "phase (active/converged/closed/expired), roundCount, currentTurn, currentTurnAgentId, currentSemanticIntent, lastMessageConverged, lastMessageProjectedAt, outstandingIntent, summary, convergenceActions[], participants[]"
    },
    "filterable-fields": [
      "// TODO: per architect partition pass + engineer audit"
    ]
  }
}
```

**Open questions for engineer review:**
- `messages[]` — out-of-envelope per idea-200 (substrate-carve-out W2)? OR included as `status.messages[]` for now + carved out later?
- `participants[]` — status (mutates with reply turns) or spec (declared at open)? Lean: status.
- Thread doesn't currently have explicit `phase` enum — derive from `status` + `convergenceActions[]` + `lastMessageConverged`?

---

### §3.4 Mission — stub (TODO architect; engineer audit pending)

**Existing flat shape** (per `hub/src/entities/mission.ts`):
- `id`, `title`, `description`, `status` (FSM), `plannedTasks[]`, `goal`, `createdAt`, `createdBy`, `sourceIdeaId`, `sourceThreadId`, `sourceActionId`, `sourceProposalId`, ... (engineer to confirm full field set)

**Proposed partition (TODO — architect to finalize):**

```json
{
  "name": "Mission",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "// TODO": "id, kind, apiVersion, createdAt, createdBy, sourceThreadId, sourceActionId, sourceIdeaId, sourceProposalId, labels"
    },
    "spec-schema": {
      "// TODO": "title, description, goal, plannedTasks[] declared at Manifest"
    },
    "status-schema": {
      "// TODO": "phase (proposed/active/completed/etc), startedAt, completedAt, slice tracking"
    },
    "filterable-fields": [
      "// TODO: per architect partition pass + engineer audit"
    ]
  }
}
```

**Open questions for engineer review:**
- `plannedTasks[]` — spec (declared at Manifest) or status (mutates as plannedTasks are issued/completed)? K8s precedent: spec is the desired state; plannedTasks IS the desired state at Mission creation. Lean: spec, with task-issuance tracked in status.
- Mission FSM phases — confirm full enum.

---

### §3.5 Proposal — stub (TODO architect; engineer audit pending)

**Existing flat shape** (per `hub/src/entities/proposal.ts`):
- `id`, `title`, `body`, `status`, `createdAt`, `createdBy`, `linkedIdeaId`, `linkedMissionId`, ... (engineer to confirm)

**Proposed partition (TODO — architect to finalize):**

```json
{
  "name": "Proposal",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "// TODO": "id, kind, apiVersion, createdAt, createdBy, linkedIdeaId, sourceThreadId, labels"
    },
    "spec-schema": {
      "// TODO": "title, body (the engineered solution declared content)"
    },
    "status-schema": {
      "// TODO": "phase (draft/under-review/ratified/closed), linkedMissionId, reviewCount"
    },
    "filterable-fields": [
      "// TODO: per architect partition pass + engineer audit"
    ]
  }
}
```

**Open questions for engineer review:**
- Proposal is being renamed to Design per idea-129 in the target lineage. Does this Mission rename? OR stay as Proposal until idea-129 ships separately? Survey scope says additive only — assume current name `Proposal` for now; idea-129 rename in a follow-on Mission.

---

## §4 Composition checkpoints

### §4.1 idea-121 (M-API-v2.0) — `get_resource_shape` consumer

idea-121's `get_resource_shape({entity})` MCP tool consumes the SchemaDef v2.0 envelope to derive:
- Flat-shape mapping (per thread-634 Q8 architect counter-proposal — view: "flat" projection)
- FilterableField.path resolution (per Q7) for `list_*` filter translation
- Per-kind `spec.verbs` declaration (Survey 2 Q2-D deferral) — pending Mission idea-121 Design

### §4.2 bug-118 (substrate-wide bug-lineage gap)

`metadata.sourceThreadId` / `sourceActionId` / `sourceSessionId` becomes envelope-level provenance. Hub-side write boundary captures session-context at write-time per `shared/provenance.ts` (Round 1 engineer architecture). Forward-looking only; historical backfill out of scope.

### §4.3 idea-151 (M-Graph-Relationships)

Relationship (kind 21) inherits this envelope post-cutover. Relationship.spec contains `{fromId, toId, edgeType}`; Relationship.status contains validation state + system-emit flags. Sequenced post idea-126 cutover.

### §4.4 idea-314 (M-Class-Tier-Promotion)

Initiative + Concept + Defect entities inherit envelope on creation. Class-Tier-Promotion sequences behind idea-121 + idea-126.

---

## §5 Acceptance criteria (cluster-1-specific)

- All 5 cluster-1 kinds carry valid envelope structure post-cutover (verified via psql JSON shape inspection per kind)
- Each kind's `apiVersion: "core.ois/v1"`
- Field partition follows strict K8s convention (no top-level cognitive-surface fields beyond `{id, name, kind, apiVersion, metadata, spec, status}`)
- `FilterableField.path` declarations per kind enable shorthand-filter translation at `list_*` runtime (composes with idea-121)
- `metadata.sourceThreadId` populated for new writes via calling-session context (bug-118 fix integration)
- v1.1 → v2.0 SchemaDef migration script handlers cover all 5 kinds (unit tests per `feedback_substrate_extension_wire_flow_integration_test`)

---

## §6 Status

**v0.1 DRAFT** — Architect-fronted skeleton. Idea worked example complete; Thread / Bug / Mission / Proposal stubbed with TODO markers + open questions.

**Next iteration (architect):** complete per-kind partition for Thread / Bug / Mission / Proposal per the same partition rationale pattern as Idea. Will surface as v0.2 in this same PR (additive commits) OR as a fresh PR per cluster.

**Engineer review surface:** Confirm strict-K8s partition discipline matches your engineering intuition for each kind. Surface field-naming concerns (e.g., `Idea.status` → `status.phase` rename — visible in Hub tool surfaces post-cutover; LLM-ergonomic concerns addressed at idea-121 projection layer per Q8 two-layer).

**Round-budget note:** thread-634 stays Design-coordination root; per-cluster review burn lives in the cross-approval thread on THIS PR (separate from thread-634). When this PR's review converges, we move to cluster-2 (queue/FSM-active) with the same pattern.
