# Entity Registry — Sovereign Specification

> **Authority:** This document is the absolute source of truth for the **schema and persistence model** of every first-class entity in the OIS platform.
> For **state-machine transitions**, see the sibling [Workflow Registry](./workflow-registry.md) — this document cross-references but does not duplicate FSMs.
> When the code disagrees with this Registry, the code is buggy. When the tests disagree with this Registry, the tests are invalid.

**Version:** 1.0.0
**Last Updated:** 2026-04-18
**Status:** INITIAL DRAFT — Task and Agent defined; remaining 8 entities enumerated in the Audit Matrix (§4).
**Converged from:** thread-116 (Architect ↔ Engineer brainstorm, 2026-04-18).

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [BaseEntity](#2-baseentity)
3. [Entity Catalog](#3-entity-catalog)
   - 3.1 [Task](#31-task)
   - 3.2 [Agent](#32-agent)
4. [Audit Matrix](#4-audit-matrix)
5. [Known Inconsistencies — Wall of Shame](#5-known-inconsistencies--wall-of-shame)
6. [Machine-Parseability Contract](#6-machine-parseability-contract)

---

## 1. Introduction

The OIS platform today has **10 first-class entities** (Task, Mission, Idea, Thread, Proposal, Turn, Tele, Audit, Document, Agent) defined implicitly across `hub/src/state.ts`, `hub/src/entities/*.ts`, and `hub/src/gcs-state.ts`. Their schemas are declared in TypeScript and enforced at compile time. Their **semantics, ownership, mutability, and cross-entity contracts are not documented in any single place** — they must be inferred by reading the type definitions, the owning policy file, and the handshake / event emission code.

This registry exists to:

1. **Catalogue** every first-class entity with a rigorous, machine-parseable schema.
2. **Define a `BaseEntity` interface** every entity implements — the common fields that belong on all of them.
3. **Make ownership explicit** — which policy file governs each entity's transitions, which store persists it, which storage key pattern it uses.
4. **Surface inconsistencies** between entities in a single "Wall of Shame" so a future "Great Normalization" refactor (Mission-22 or later) has a concrete work list.
5. **Enable automated validation** — YAML frontmatter blocks make it trivial to write a future validator script that diffs this spec against the TypeScript interfaces and fails CI on drift.

**Relationship to other sovereign docs:**

- [`docs/specs/workflow-registry.md`](./workflow-registry.md) — FSM transitions, cross-domain workflows, SSE event catalogue, system invariants. **Authoritative for state machines.** This Registry is authoritative for **schemas**.
- [`docs/decisions/*.md`](../decisions/) — ADRs document architectural decisions. Schema decisions (e.g., ADR-011 GCS concurrency model, ADR-012 Architect error-surfacing) are cross-referenced from individual entity sections but not duplicated here.

**Out of scope for v1.0:**

- Promoting this document to a Hub-native `EntityDefinition` store. Decided against in thread-116 until a concrete consumer emerges (runtime schema validation, dynamic entity types, auto-generated UIs).
- Normalizing the inconsistencies enumerated in §5 — that is a follow-on mission.
- Filling the 8 remaining entity rows in the Audit Matrix — follow-up tasks per the thread-116 convergence.

---

## 2. BaseEntity

Every first-class entity in the OIS platform MUST implement `BaseEntity`. Fields that are absent from the current code on specific entities (`turnId`, `labels`, `correlationId`) are flagged in §5 as inconsistencies to normalize in a future refactor.

```yaml
# YAML frontmatter — machine-parseable
entity: BaseEntity
kind: interface
fields:
  id:
    type: string
    mutability: create-only
    description: Unique identifier. Format per-entity — see §5 (ID generation strategy).
  entityType:
    type: "\"task\" | \"mission\" | \"idea\" | \"thread\" | \"proposal\" | \"turn\" | \"tele\" | \"audit\" | \"document\" | \"agent\""
    mutability: create-only
    description: Discriminator for the entity kind. NOT currently present in code — proposed addition for dispatch / polymorphic handling.
  createdAt:
    type: string
    format: ISO-8601
    mutability: create-only
    description: UTC timestamp of first persistence.
  updatedAt:
    type: string
    format: ISO-8601
    mutability: free-form
    description: UTC timestamp of the most recent persisted mutation.
  labels:
    type: Record<string, string>
    mutability: create-only
    description: Mission-19 routing metadata. Immutable post-create (INV-AG1). Empty map == legacy broadcast semantics.
  correlationId:
    type: string | null
    mutability: create-only
    description: Lineage pointer to the originating entity. Overloaded semantics per-entity — see §5.
  turnId:
    type: string | null
    mutability: create-only
    description: Owning Turn for virtual-view composition (Mission-20 Phase 3). Currently only on Task and Mission — normalization candidate.
```

### Narrative

- **`id`** — entity-specific generation strategy (see §5 item 6). Most entities use a human-readable counter (`task-244`, `mission-17`); some tools accept opaque strings where scaffolding demands ULID-style ordering.
- **`entityType`** — proposed. Not yet in code. Adding it unlocks polymorphic dispatch (e.g., a generic `get_entity(id)` tool). Flagged as a candidate for the Great Normalization mission.
- **`labels`** — Mission-19 routing. Immutable once set (INV-AG1 in workflow-registry.md §5). Selector semantics in workflow-registry.md §6.
- **`correlationId`** — the single most overloaded field. Current usages:
  - **Task.correlationId** — typically the Proposal ID or Mission ID that scaffolded the task.
  - **Mission.correlationId** — self-referential (equals `id`) on Mission, vestigial.
  - **Thread.correlationId** — optional link to a related Task or Proposal the thread discusses.
  - **Proposal.correlationId** — similar to Thread; optional upstream pointer.
  Every usage is valid but the field's contract differs. §5 catalogues the ambiguity.
- **`turnId`** — introduced in Mission-20 Phase 3 for virtual-view composition of `Turn.missionIds` / `Turn.taskIds`. Only Task and Mission carry it today. Promoting to BaseEntity would make every entity ownable by a Turn — which the Turn virtual-view would then compose from. Flagged in §5.

---

## 3. Entity Catalog

**Storage backend (post-mission-49 close 2026-04-25):** All 12 first-class entity stores compose any `StorageProvider` (`@apnex/storage-provider`) via the `*Repository` pattern — single class per entity, no `Memory*Store` / `Gcs*Store` divergence. Mission-47 W1-W7 migrated tele / bug+idea / director-notification / mission / task+proposal / thread / turn+pending-action+agent (10 stores); mission-49 W8-W9 migrated audit + notification (final 2). The 6-primitive contract (`get` / `getWithToken` / `list` / `delete` / `put` / `createOnly` / `putIfMatch`) held throughout — see ADR-024 §6 Amendments for the local-fs reclassification (mission-48). Legacy `hub/src/entities/gcs/` directory + `Memory*Store` / `Gcs*Store` class pairs deleted across the wave sequence; tombstone comments at the original file locations carry the mission-N-W reference.



### 3.1 Task

```yaml
entity: Task
kind: first-class
owner_policy: hub/src/policy/task-policy.ts
owner_store:
  repository: hub/src/entities/task-repository.ts (TaskRepository over StorageProvider — mission-47 W5)
storage_key_pattern: tasks/{taskId}.json
fsm_link: docs/specs/workflow-registry.md §1.1
id_strategy: human-readable counter (task-{N}) — repository-layer issued via StorageBackedCounter ("taskCounter" field on meta/counter.json)

fields:
  id:
    type: string
    mutability: create-only
    description: Format task-{N}, monotonically increasing.
  title:
    type: string | null
    mutability: create-only
    description: Short human-readable title.
  description:
    type: string | null
    mutability: create-only
    description: Detailed directive for the Engineer.
  directive:
    type: string
    mutability: create-only
    description: Legacy alias — resolved to description at handler level.
  status:
    type: TaskStatus
    mutability: transition-only
    description: See workflow-registry.md §1.1 for allowed transitions.
    enum: [pending, working, blocked, input_required, in_review, completed, failed, escalated, cancelled]
  assignedEngineerId:
    type: string | null
    mutability: transition-only
    description: Claimed by an Engineer via get_task; null until claimed. Mission-19 routes subsequent events P2P via this field.
  correlationId:
    type: string | null
    mutability: create-only
    description: Usually the upstream Mission or Proposal ID that scaffolded this task.
  idempotencyKey:
    type: string | null
    mutability: create-only
    description: Deduplication key for Architect retries; enforced in create_task.
  dependsOn:
    type: string[]
    mutability: create-only
    description: Task IDs that must reach completed before this task can transition blocked → pending.
  revisionCount:
    type: number
    mutability: transition-only
    description: Incremented on rejected review; triggers escalation at >= 3.
  report:
    type: string | null
    mutability: transition-only
    description: Full report body submitted by the Engineer.
  reportSummary:
    type: string | null
    mutability: transition-only
    description: 1-2 sentence Engineer summary surfaced in list views.
  reportRef:
    type: string | null
    mutability: transition-only
    description: GCS path to the full report document when summary exceeds the embedded limit.
  verification:
    type: string | null
    mutability: transition-only
    description: Test / build output captured at report-submit time.
  reviewAssessment:
    type: string | null
    mutability: transition-only
    description: Architect's assessment text on review.
  reviewRef:
    type: string | null
    mutability: transition-only
    description: GCS path to the full review document.
  clarificationQuestion:
    type: string | null
    mutability: transition-only
    description: Engineer's question when moving working → input_required.
  clarificationAnswer:
    type: string | null
    mutability: transition-only
    description: Architect's reply when moving input_required → working.
  labels:
    type: Record<string, string>
    mutability: create-only
    description: Inherited from the creator's Agent at submit-time (Mission-19). Used for claim eligibility via taskClaimableBy().
  turnId:
    type: string | null
    mutability: create-only
    description: Owning Turn (Mission-20 Phase 3 virtual-view composition).
  createdAt:
    type: string
    format: ISO-8601
    mutability: create-only
  updatedAt:
    type: string
    format: ISO-8601
    mutability: free-form

emit_events:
  - name: task_issued
    when: status transitions to pending (create_task without blocking deps)
    target: roles=[engineer], matchLabels=task.labels
  - name: task_blocked
    when: create_task with dependsOn (status = blocked)
    target: roles=[architect], matchLabels=task.labels
  - name: directive_acknowledged
    when: get_task claims the task (pending → working)
    target: roles=[architect], matchLabels=task.labels
  - name: report_submitted
    when: create_report (working → in_review)
    target: roles=[architect], matchLabels=task.labels
  - name: review_completed
    when: create_review with decision=approved (in_review → completed)
    target: roles=[engineer, architect], matchLabels=task.labels

correlation_roles:
  - as_subject:
      Mission:       "virtual view — mission.tasks filters tasks by correlationId == mission.id OR task.turnId == mission.turnId"
      Proposal:      "scaffolding — proposal's executionPlan generates tasks with correlationId = proposal.id"
      Thread:        "convergence cascade — a converged thread with convergenceAction.type='create_task' spawns a task with sourceThreadId"
      Turn:          "virtual view — turn.taskIds filters tasks by turnId"
  - as_reference:
      Task:          "dependsOn[] — DAG parent pointers; enforced by FSM on claim"
      Audit:         "relatedEntity on create_audit_entry can point to a task ID"
```

**Narrative:** Task is the richest and most-connected entity in the platform. It is the atomic unit of Engineer work. Its FSM is the most elaborate, and its correlation role spans every lineage path (Mission, Proposal, Thread, Turn, Audit). The `revisionCount` field is load-bearing for the `in_review → escalated` transition (v2.1.0 of the workflow registry, circuit breaker at 3).

---

### 3.2 Agent

```yaml
entity: Agent
kind: first-class
owner_policy: hub/src/hub-networking.ts (handshake flow)
owner_store:
  repository: hub/src/entities/agent-repository.ts (AgentRepository over StorageProvider — mission-47 W7b; implements IEngineerRegistry)
storage_key_pattern:
  primary: agents/{engineerId}.json
  index:   agents/by-fingerprint/{fp}.json
fsm_link: "no FSM — Agent is append-only; transitions are archived=true and sessionEpoch++"
id_strategy: "fingerprint-derived prefixed (eng-{shortHash(fingerprint)}) on first handshake — no counter; engineerIds are deterministic from M18 enriched-handshake fingerprint"
persistence_model: "persistent record via StorageProvider (GCS / local-fs / memory per STORAGE_BACKEND); epoch increments on each handshake that displaces a prior session. In-memory bookkeeping (sessionRoles, displacementHistory, lastTouchAt) preserved as repo-instance Maps — same as pre-mission-47-W7b behavior; wiped on Hub restart, repopulated on next session-claim."

fields:
  engineerId:
    type: string
    mutability: create-only
    description: Hub-issued stable identity (eng-{random}). Persists across reconnects.
  fingerprint:
    type: string
    mutability: create-only
    description: sha256(globalInstanceId) — NOT the token. Deterministic per client install; enables reconnection to the same Agent record.
  role:
    type: AgentRole
    mutability: create-only
    description: engineer | architect | director. Immutable; mismatched handshake payload fails with code=role_mismatch.
    enum: [engineer, architect, director]
  status:
    type: AgentStatus
    mutability: transition-only
    description: online while streaming; offline on graceful disconnect or watchdog timeout.
    enum: [online, offline]
  archived:
    type: boolean
    mutability: transition-only
    description: Replaces deletion. Archived agents do not appear in routing selectors.
  sessionEpoch:
    type: number
    mutability: transition-only
    description: Monotonic counter incremented on each displacement. Used to expire stale SSE streams.
  currentSessionId:
    type: string | null
    mutability: free-form
    description: Ephemeral — the MCP session ID of the current SSE connection. Null when offline.
  clientMetadata:
    type: AgentClientMetadata
    mutability: create-only
    description: "MCP initialize info: clientName, clientVersion, proxyName, proxyVersion, transport, sdkVersion, hostname, platform, pid."
  advisoryTags:
    type: AgentAdvisoryTags
    mutability: free-form
    description: "Best-effort launch-time tags (llmModel, etc). Subject to drift. DO NOT build routing logic on these."
  labels:
    type: AgentLabels
    mutability: create-only
    description: "Mission-19 routing metadata. IMMUTABLE after first registration (INV-AG1). Reserved key `ois.io/namespace` for future strict-isolation semantics."
  firstSeenAt:
    type: string
    format: ISO-8601
    mutability: create-only
  lastSeenAt:
    type: string
    format: ISO-8601
    mutability: free-form
    description: Updated on every touch. Used by offline detection and displacement rate-limiting (in-memory history, not persisted).

invariants:
  - ref: INV-AG1
    description: "Labels are IMMUTABLE after first registration. A displacing handshake whose payload.labels differs from the persisted set is silently ignored — the persisted labels win."
  - ref: INV-AG2
    description: "Each handshake whose payload differs from the persisted agent on role triggers failure code=role_mismatch — no silent override."
  - ref: INV-AG3
    description: "Agents are append-only. Deletion is modelled as archived=true; the GCS record persists indefinitely."

emit_events:
  - name: agent_registered
    when: first successful handshake for a new engineerId
    target: roles=[architect]
  - name: agent_displaced
    when: handshake displaces a previous session (sessionEpoch++)
    target: roles=[architect]

correlation_roles:
  - as_subject:
      Task:          "assignedEngineerId references Agent.engineerId after claim"
      EngineerStatus: "projected view returned by get_engineer_status tool"
  - as_reference:
      labels:        "matchLabels selectors in workflow-registry.md §6 filter to agents whose labels contain every (k, v) pair"
```

**Narrative:** Agent is the **only entity in the platform that is persisted but effectively append-only with FSM-less semantics**. Its "transitions" are expressed via `sessionEpoch` monotonic increments (displacement) and `archived` / `status` flips, none of which go through a gated transition matrix. Identity is decoupled across three layers:

1. **`globalInstanceId`** (client-provided) — stable per install; hashed to `fingerprint`.
2. **`fingerprint`** — Hub-derived, used to reconnect a client to its same Agent record across restarts.
3. **`engineerId`** — Hub-issued on first handshake. The stable identity every other entity references.

This layering lets a client rotate its token (authentication) or bounce its session without changing its logical identity (engineerId). Mission-18 introduced this layering explicitly; Mission-19 added labels on top of it for routing.

**Persistence model decision (converged in thread-116):** Agent is a **persistent GCS record**, not a dynamic discovery entity. The `agents/{engineerId}.json` file survives Hub restarts and client reconnects. This is in contrast to the ephemeral SSE session state (`currentSessionId`), which is recreated on every connection.

---

## 4. Audit Matrix

| Entity | Fields | Mutability | Ownership | Storage Key | FSM Link | Correlation Role |
|---|---|---|---|---|---|---|
| **Task** | see §3.1 | mixed (see §3.1) | `hub/src/policy/task-policy.ts` | `tasks/{taskId}.json` | workflow-registry §1.1 | Mission, Proposal, Thread, Turn, Audit |
| **Agent** | see §3.2 | append-only (epoch++) | `hub/src/hub-networking.ts` + `GcsEngineerRegistry` | `agents/{engineerId}.json` + `agents/by-fingerprint/{fp}.json` | — (no FSM) | Task (via assignedEngineerId) |
| **Mission** | _TBD_ | _TBD_ | `hub/src/policy/mission-policy.ts` | `missions/{missionId}.json` | workflow-registry §1.X | Task (virtual view), Idea, Turn |
| **Idea** | _TBD_ | free-form (text + tags + status) | `hub/src/policy/idea-policy.ts` | `ideas/{ideaId}.json` | workflow-registry §1.X | Mission (via missionId link) |
| **Thread** | Threads 2.0 — see ADR-013. Scalar: `{id, title, status, initiatedBy, currentTurn, roundCount, maxRounds, outstandingIntent, currentSemanticIntent, correlationId, convergenceActions[], summary, participants[], labels, lastMessageConverged, createdAt, updatedAt}`. Per-message: `{author, authorAgentId, text, timestamp, converged, intent, semanticIntent}`. | scalar create-only for identity, transition-only for status / currentTurn / roundCount / convergenceActions lifecycle / summary, free-form for updatedAt / lastMessageConverged; messages append-only | `hub/src/policy/thread-policy.ts` | `threads/{threadId}.json` + `threads/{threadId}/messages/{seq}.json` | `workflow-registry.md §1.3` (now with INV-TH11..TH15 from ADR-013) | Task / Proposal (auto-spawn via Phase 2 cascade actions); Audit (relatedEntity); Agent (via authorAgentId on messages and participants[] entries) |
| **Proposal** | _TBD_ | transition-only | `hub/src/policy/proposal-policy.ts` | `proposals/{proposalId}.json` | workflow-registry §1.X | Mission (scaffolding), Task (scaffolding) |
| **Turn** | _TBD_ | virtual-view scalar | `hub/src/policy/turn-policy.ts` | `turns/{turnId}.json` | workflow-registry §1.X | Mission, Task (virtual view via turnId) |
| **Tele** | _TBD_ | content-immutable; status-mutable via supersede_tele / retire_tele (mission-43) | `hub/src/policy/tele-policy.ts` | `tele/{teleId}.json` | `docs/specs/teles.md §Tele Lifecycle` | Turn (tele[]) |
| **Audit** | _TBD_ | immutable append | `hub/src/policy/audit-policy.ts` | `audit/{auditId}.json` | — (no FSM) | any entity (relatedEntity) |
| **Document** | _TBD_ | free-form, create-or-overwrite | `hub/src/policy/document-policy.ts` | `docs/**` | — (no FSM) | referenced by reportRef, proposalRef, documentRef |

**_TBD_ rows** are placeholders. A follow-up task (to be created after thread-116 review of this draft) will fill them in parallel — each entity's fill-in is mechanical: read `hub/src/entities/<name>.ts` (or `state.ts`), the owning policy file, and the corresponding workflow-registry FSM section.

**Thread** was filled in partially as a side-effect of Mission-21 Phase 1 (ADR-013 — Threads 2.0). The full YAML frontmatter block for Thread matching the Task / Agent style in §3 is still pending; the audit matrix row above is the short-form summary for now.

---

## 5. Known Inconsistencies — Wall of Shame

The list below enumerates inconsistencies discovered during the v1.0 draft. Each entry SHOULD be promoted to its own Idea in the Hub (tagged `great-normalization`) unless covered by an existing Idea; filing is a follow-up task.

### 5.1 `tags: string[]` vs `labels: Record<string, string>`

- **Where:** `tags` lives on Idea only (free-form categorisation). `labels` lives on Task, Thread, Mission, Proposal (Mission-19 routing selectors).
- **Why it matters:** The two are semantically distinct — tags are flat, labels are K8s-style equality selectors with routing semantics in workflow-registry.md §6. But the distinction is nowhere documented, and several Hub tools conflate them in their descriptions.
- **Resolution direction:** Keep both, but define the contract explicitly here (tags for categorisation, labels for routing) and ensure tool descriptions use the right term. Idea filing: promote to its own Idea unless idea-32 ("Standardized entity metadata") already covers it — check on follow-up.

### 5.2 `correlationId` overloading

- **Where:** Task, Mission, Thread, Proposal all carry `correlationId: string | null`.
- **Why it matters:** Each entity uses it differently:
  - Task.correlationId → Proposal or Mission (scaffolding lineage)
  - Mission.correlationId → self (vestigial)
  - Thread.correlationId → optional Task or Proposal being discussed
  - Proposal.correlationId → optional upstream Thread or Task
  A reader cannot tell what a `correlationId` points to without knowing the entity type and context.
- **Resolution direction:** Either split into typed fields (`missionRef`, `proposalRef`, `threadRef`) or enforce a tagged format (`"mission:m-12"`). The typed-field approach aligns better with entityType-discriminated dispatch. Idea filing: new idea, tagged `great-normalization`, `correlation`, `schema`.

### 5.3 `turnId` partial coverage

- **Where:** `turnId: string | null` exists on Task and Mission only (added in Mission-20 Phase 3 for virtual-view composition of Turn.missionIds / Turn.taskIds).
- **Why it matters:** Promoting `turnId` to BaseEntity would make every first-class entity ownable by a Turn — which the Turn virtual-view would then compose from automatically. Currently Thread / Proposal / Idea cannot be "owned by" a Turn.
- **Resolution direction:** Promote to BaseEntity; add the field to every entity's store + type; update Turn virtual-view to aggregate across more entity types. Mission-20 Phase 3 closeout (`docs/history/mission-20-phase3-closeout.md §4.1`) already flags this as the `BaseEntityFields` refactor. Idea filing: consolidate with that deferred work.

### 5.4 `assignedEngineerId` on Task only

- **Where:** Task carries `assignedEngineerId: string | null`. No other entity does.
- **Why it matters:** idea-73 ("Generalised Task Routing — Origin + Target") proposes promoting this to a first-class `target: {role, agentId, labelSelector}` structure. Once generalised, similar concepts could apply to Proposal (which engineer owns the implementation), Thread (which engineers participate), etc.
- **Resolution direction:** Wait for idea-73 to converge; this section will update when it does. Idea filing: already covered by idea-73.

### 5.5 `status` vs `state` terminology

- **Where:** Every entity with an FSM uses a field literally named `status` (Task.status, Thread.status, Mission.status, etc.). Internal code occasionally refers to this as "state" (e.g., `isValidTransition`, `TASK_FSM states`).
- **Why it matters:** External-facing docs and wire formats should use one term consistently. Mixing both in doc prose creates confusion, especially for LLMs.
- **Resolution direction:** **`status`** is the external field name (user-facing, API-surface). **`state`** is reserved for internal FSM implementation references. Codify in this registry and enforce in doc reviews. Idea filing: low priority — mostly a documentation concern.

### 5.6 Identity generation strategy

- **Where:** IDs vary across entities.
- **Current state:**
  - Task, Mission, Idea, Thread, Proposal, Turn, Tele: **human-readable counter** (`task-{N}`, `mission-{N}`, etc.) via `getAndIncrementCounter` in `gcs-state.ts`.
  - Audit: **ULID-style** for chronological sort (inferred from `audit/{id}.json` sorted/reversed behaviour).
  - Agent: **Hub-issued prefixed random** (`eng-{random}`) — not a monotonic counter; stable across reconnects via fingerprint.
  - Document: **path-based** (`docs/<arbitrary>/<path>.md`) — no ID per se.
- **Why it matters:** Counter-based IDs require centralised coordination (getAndIncrementCounter is currently P3-safe only under `max-instances=1` per ADR-009). Scale-out without migrating off counters means duplicate IDs become possible. ULID or UUID per-entity would remove the coordination dependency.
- **Resolution direction:** Document in this registry (already done above per-entity). The migration to ULID is a downstream mission when scale-out forces the issue. Cross-reference ADR-011 which already flags this. Idea filing: low priority; covered by the ADR.

### 5.7 `metadata` bucket

- **Where:** No entity currently has a generic `metadata: Record<string, unknown>` field. All non-indexed properties live in specific typed fields.
- **Why it matters:** For future extensibility, BaseEntity could include `metadata` so new cross-cutting data can land without a schema migration. On the other hand, a `metadata` bucket is a magnet for shape drift — everyone dumps things in there, no one reads them systematically.
- **Resolution direction:** **Do NOT add `metadata` to BaseEntity in v1.0.** Typed fields are the preferred approach. Revisit only if a concrete extensibility pain forces it. Idea filing: explicit non-decision recorded here.

---

## 6. Machine-Parseability Contract

Every entity section in §3 MUST include a YAML frontmatter block (demarcated by triple-backtick `yaml` fences) with at least these keys:

- `entity` — the entity name (matches `entityType` discriminator)
- `kind` — `first-class` | `interface` | `derived`
- `owner_policy` — path to the policy file that governs it
- `owner_store` — repository file path (post-mission-49 close 2026-04-25: all 12 entity stores migrated to `*Repository` over `StorageProvider`; ADR-024 + §6.1 amendment). Legacy form (pre-mission-47): `memory` + `gcs` store paths — superseded.
- `storage_key_pattern` — GCS key template
- `fsm_link` — pointer to workflow-registry.md section, or "— (no FSM)"
- `id_strategy` — one of `counter`, `ulid`, `random-prefixed`, `path-based`
- `fields` — map of field name → `{type, mutability, description, format?, enum?}`
- `emit_events` — list of `{name, when, target}` (optional; entities with no emissions omit)
- `correlation_roles` — subject/reference map (optional)
- `invariants` — list of `{ref, description}` (optional; typically cross-referenced from workflow-registry.md)

**Mutability vocabulary** (strict — a validator script SHOULD enforce):
- `create-only` — set at entity creation, never mutated after.
- `transition-only` — mutated only via FSM transitions declared in workflow-registry.md.
- `free-form` — mutated at will (e.g., `updatedAt`, `lastSeenAt`).

**Future validator contract:** a script under `scripts/validate-entity-registry.ts` (TBD) will:

1. Parse every YAML block in `docs/specs/entities.md`.
2. For each entity, locate the TypeScript interface in `hub/src/entities/*.ts` (or `state.ts`) and compare field names and types.
3. Fail CI on drift — a field added to the TS type without this doc is a violation, and vice versa.

Writing that script is a follow-up task, not in scope for v1.0. The YAML blocks above are valid for it.

---

*Follow-up tasks expected after thread-116 review of this draft:*

1. *Fill the 8 `_TBD_` rows in the Audit Matrix (§4) — one task per entity or a single task covering all, depending on Architect preference.*
2. *File ideas for each inconsistency in §5 (tagged `great-normalization`) unless already covered.*
3. *Implement `scripts/validate-entity-registry.ts` (§6 future validator contract).*
4. *Decide whether to promote `turnId` to BaseEntity and execute the `BaseEntityFields` refactor deferred from Mission-20 Phase 3.*
