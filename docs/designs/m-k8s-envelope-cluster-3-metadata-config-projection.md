# M-K8s-Envelope — Cluster 3 Metadata/Config/Projection Partition (Design Working Draft)

**Status:** v0.2 — engineer review-integrated · awaiting approval
**Mission:** idea-126 (M-K8s-Envelope)
**Phase:** Phase 4 Design — cluster-3 partition pass (3 of 5 clusters per substrate-grounded decomposition)
**Coordination:** per-PR review (per `feedback_pr_opened_notification_is_review_signal` v2 scope-refinement — initial PR-open IS the signal; v0.2 fold-in pushes get explicit `create_message` ping until M-PR-Synchronize-Handler / idea-315 lands). **This v0.2 commit exercises the refined memory rule: explicit ping to greg post-push.**
**Date:** 2026-05-23 AEST (v0.2: engineer PR #270 v0.1 review integrated)

**v0.1 → v0.2 changelog (engineer PR #270 review integration):**
- §2.1 Agent — OQ1-OQ5 dispositions applied; all concur with v0.1 + K8s-precedent rationale notes added (PodSpec affinity for OQ1; metadata.deletionTimestamp for OQ2)
- §2.2 Tele — stub partition → full JSON Schema; OQ6-OQ9 applied (all concur)
- §2.3 SchemaDef — stub partition → full JSON Schema; OQ10-OQ13 applied. **OQ10 SUBSTANTIVE DEVIATION accepted**: SchemaDef gets `status.phase: "applied" | "pending" | "failed"` + `status.lastReconciledAt` per engineer's K8s CRD precedent (CustomResourceDefinition.status.conditions) + operator-DX queryability gain
- §2.4 Counter — stub partition → full JSON Schema option (a); OQ14 ratified (engineer concur with K8s ConfigMap precedent); OQ15 ratified (singleton-meta-entity → name OMITTED)
- §1.6 NEW — Multi-FSM-in-status sub-discipline (engineer observation #1)
- §5 NEW 6th cumulative-pattern: declared-routing-intent (spec.labels) vs declared-content-classification (metadata.labels) axis (engineer observation #3 — OQ1 surfaced this)
- §5 NEW singleton-meta-entity forward-question (engineer observation #2) — third class beyond §1.5 handle/content binary; formalize if clusters 4/5 surface more
**Sibling Designs:**
- Cluster 1 — substantive-content (Idea / Bug / Thread / Mission / Proposal) — **MERGED** at `d8ea695`
- Cluster 2 — queue/FSM-active (Task / PendingAction / Turn) — **MERGED** at `59c3a70`
- Cluster 4 — system-emit/bookkeeping (forthcoming; per cluster-2 §6 ratified)
- Cluster 5 — content-archive (forthcoming; per cluster-2 §6 ratified)

**Survey input:** `docs/reviews/2026-05-23-survey-idea-126.md` (Director-ratified R1 A/A/A + R2 A/A/A). Same Survey applies to all clusters.

**Cluster-1 + cluster-2 patterns inherited:**
- Strict K8s `metadata`/`spec`/`status` partition; no top-level fields beyond `{id, name, kind, apiVersion, metadata, spec, status}`
- `metadata.labels` (map) for queryable classification
- `metadata.annotations["ois.io/..."]` for free-form vendor extension
- `<Kind>.status` (flat FSM) → `<Kind>.status.phase` (K8s convention)
- `FilterableField.path` per-kind; nested-path via dot-notation; `selector: "k8s-map"` for map-types
- Virtual-view fields ENVELOPE-EXCLUDED (computed on read)
- `apiVersion: "core.ois/v1"` (minimal 2-group taxonomy)
- Substrate strict K8s; LLM-ergonomic flat projection deferred to idea-121 `get_resource({view})`
- **Handle-classified vs content-classified** (§1.5 cluster-2): `metadata.name` USED for handle-classified kinds; OMITTED for content-classified
- **Declared-with-controlled-mutation pattern** (cluster-2 §2.1/2.2): substrate-controlled-mutated declared fields stay in spec (PodSpec.nodeName / LeaseSpec.acquireTime precedents)
- **Derived-scalar-field discipline** (cluster-2 §2.2): SchemaDef `"derived": true` flag for computed fields

---

## §1 Cluster-3 design scope — metadata/config/projection kinds

| Kind | Mediation | Notes |
|---|---|---|
| Agent | IEngineerRegistry (sole non-I*Store-mediated kind) | **canonical worked example**; M18 identity + ADR-017 liveness + Mission-62 activity + Mission-75 component-TTL + Mission-19 routing labels; multi-FSM |
| Tele | ITeleStore | Mission-43 lifecycle (active → superseded → retired); CAS retry on supersede/retire |
| SchemaDef | substrate-native (NEW per mission-83 W2) | bootstrap-self-referential; meta-entity (defines other kinds' shape); the substrate uses it to validate + emit indexes |
| Counter | special-case (single-row meta-entity; no I*Store) | id="counter" fixed; embedded map of per-counter-domain values (taskCounter, ideaCounter, etc.); watchable: false |

**Shared property:** these kinds carry **metadata** + **configuration** + **system-projected state**. None are substantive-cognitive-content (cluster-1) or work-queue-FSM (cluster-2). The partition pattern is heterogeneous:
- Agent: **multi-FSM observed state** (cluster-2 pattern dominates: status heavy; M18/Mission-62/Mission-75 fields)
- Tele: **lifecycle-FSM with immutable content** (mixed: spec carries declared content; status carries lifecycle)
- SchemaDef: **meta-config declaration** (spec heavy; almost entirely declared schema; no FSM)
- Counter: **bookkeeping-only** (special-case; OQ on envelope-shape applicability)

**Methodology note (cluster-3-specific):** unlike cluster-1 (default-to-spec) and cluster-2 (default-to-status on FSM-mutated), cluster-3 partitions per-kind based on the kind's dominant pattern. Per-field partition follows strict K8s rules within each kind.

---

## §1.6 K8s-convention sub-discipline — multi-FSM in status

**Surfaced at v0.2 engineer review observation #1.** Cluster-3 Agent introduces the first kind with **multiple orthogonal FSMs** in its observed state — 4 distinct FSMs in `Agent.status`:

| FSM | Field | Domain |
|---|---|---|
| **Primary** | `status.phase` | `online \| offline` (registration FSM) |
| Liveness composite (ADR-017) | `status.livenessState` | `online \| unresponsive_cognitive \| unresponsive_transport \| offline` |
| Activity (Mission-62) | `status.activityState` | online_idle / online_working / online_quota_blocked / offline |
| Component-TTL pair (Mission-75) | `status.cognitiveState` + `status.transportState` | `alive \| unresponsive \| unknown` each |

**Methodology rule:** multi-FSM kinds carry **all FSMs in status as independent observables**. The K8s convention `status.phase` is reserved for the **primary FSM** (the kind's canonical lifecycle FSM — for Agent, it's the registration lifecycle online/offline). Additional FSMs use **semantically-named status fields** (livenessState / activityState / cognitiveState / transportState) — not nested under `status.phase` or extra-discriminated.

**K8s precedent:** Pod.status carries `status.phase` (Pending/Running/Succeeded/Failed) AS WELL AS `status.conditions[]` (PodScheduled / Ready / Initialized / ContainersReady) — same pattern: primary FSM at `status.phase`, additional state-observations as siblings.

**Forward signal for clusters 4/5:** if Notification / Message / RepoEventBridge* kinds surface multi-FSM patterns, follow Agent's precedent (primary at `status.phase`; additional FSMs as named status fields).

This sub-discipline composes with §1.5 (handle vs content classification axis) — both are envelope-methodology refinements articulated in cluster-3.

---

## §2 Per-kind partitions

### §2.1 Agent — canonical reference

**Existing flat shape** (per `hub/src/state.ts:301-380`):

Identity:
- `id` (e.g., `agent-abc123xyz` per M18; pattern `agent-{8-hex-of-sha256(name)}` per idea-251 D-prime Phase 2)
- `fingerprint` (sha256(globalInstanceId) — token NOT included)
- `name` (idea-251 D-prime: name IS identity; required at handshake; from `OIS_AGENT_NAME` env)
- `role` (AgentRole: engineer | architect | director)

Liveness FSM (ADR-017):
- `status` (online | offline)
- `archived` (boolean — replaces deletion; append-only)
- `sessionEpoch` (monotonic; increments on displacement)
- `currentSessionId` (ephemeral per SSE connection)
- `livenessState` (ADR-017 composite FSM 4-state)
- `lastHeartbeatAt`
- `receiptSla` (per-agent ms override)
- `wakeEndpoint` (durable-wake URL)

Activity FSM (Mission-62 orthogonal to liveness):
- `activityState` (auto-clamped offline when livenessState != online)
- `sessionStartedAt`
- `lastToolCallAt`, `lastToolCallName`
- `idleSince`, `workingSince`
- `quotaBlockedUntil`

Component TTLs (Mission-75; orthogonal to composite liveness):
- `cognitiveTTL` (seconds; bug-52)
- `transportTTL`
- `cognitiveState` (ComponentState: alive | unresponsive | unknown)
- `transportState`

Telemetry:
- `clientMetadata` (M18 handshake; clientName/clientVersion/proxyName/proxyVersion/etc.)
- `advisoryTags` (mission-66 build-identity projections)
- `labels` (Mission-19 routing; already-map shape)
- `adapterVersion` (handshake source-of-truth)
- `ipAddress` (Hub-side derived from SSE peer addr; NOT adapter-supplied)
- `restartCount`, `restartHistoryMs[]` (mission-62 rolling-window)
- `recentErrors[]` (mission-62 ring buffer; cap=10)

Lifecycle:
- `firstSeenAt`, `lastSeenAt`

Config (mission-75 Director Declarative-Primacy):
- `livenessConfig?` (sparse override)
- `pulseConfig?` (sparse override)

**Partition (v0.1):**

```json
{
  "name": "Agent",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "type": "object",
      "required": ["id", "kind", "apiVersion", "createdAt", "name"],
      "properties": {
        "id":             {
          "type": "string",
          "pattern": "^agent-[0-9a-f]{8}$",
          "description": "M18 derived: agent-{first-8-hex(sha256(name))} per idea-251 D-prime Phase 2."
        },
        "kind":           { "const": "Agent" },
        "apiVersion":     { "const": "core.ois/v1" },
        "createdAt":      { "type": "string", "format": "date-time", "description": "Migrates from existing firstSeenAt field; renamed to metadata.createdAt for envelope uniformity." },
        "updatedAt":      { "type": "string", "format": "date-time", "description": "Migrates from existing lastSeenAt; same uniformity rename." },
        "name":           {
          "type": "string",
          "description": "Engineer §1.5 cluster-2 handle-classified pattern: Agent name is the substantive handle (e.g., 'greg', 'lily', 'kate'); sourced from OIS_AGENT_NAME at handshake; immutable post-creation (different name → different fingerprint → different agentId)."
        },
        "fingerprint":    {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "description": "sha256(name) per idea-251 D-prime. Identity-derived; immutable post-creation."
        },
        "archived":       { "type": "boolean", "description": "Append-only deletion marker; sticks in metadata as identity-disposition." }
      }
    },
    "spec-schema": {
      "type": "object",
      "required": ["role"],
      "properties": {
        "role": {
          "enum": ["engineer", "architect", "director"],
          "description": "Declared identity role. Immutable post-creation (same name + different role = role_mismatch error)."
        },
        "labels": {
          "type": "object",
          "additionalProperties": { "type": "string" },
          "description": "Mission-19 routing labels. Already-map shape. Note placement: labels are mutable per handshake refresh (CP3 C5 / bug-16) BUT carry declared-intent semantic (the agent declares its routing surface at handshake). Argument for spec (declared-intent) vs metadata.labels (cluster-1 pattern for content-classification). v0.1 picks **spec.labels** — Mission-19 labels are routing-declarations, not content-classification. K8s precedent: PodSpec carries scheduling-affinity labels in spec. **OQ1.**"
        },
        "receiptSla":     {
          "type": ["integer", "null"],
          "description": "Per-agent ms override of DEFAULT_RECEIPT_SLA_MS. Declared-with-controlled-mutation (handshake refresh)."
        },
        "wakeEndpoint":   {
          "type": ["string", "null"],
          "description": "Durable-wake URL (Cloud Run, etc.). Declared at handshake."
        },
        "livenessConfig": {
          "type": ["object", "null"],
          "description": "mission-75 Director Declarative-Primacy sparse override."
        },
        "pulseConfig":    {
          "type": ["object", "null"],
          "description": "mission-75 per-agent pulse cadence override (60min default; STRICT suppression when on active mission per Design §3.4 M3)."
        },
        "clientMetadata": {
          "type": "object",
          "description": "M18 handshake payload (clientName/clientVersion/proxyName/proxyVersion/etc.). Mutable per handshake refresh (CP3 C5). Declared-with-controlled-mutation; same class as receiptSla."
        }
      }
    },
    "status-schema": {
      "type": "object",
      "required": ["phase"],
      "properties": {
        "phase": {
          "enum": ["online", "offline"],
          "description": "Renamed from current flat Agent.status. 2-state primary FSM; orthogonal to activityState + livenessState. K8s convention for status.phase."
        },
        "sessionEpoch":         { "type": "integer", "minimum": 0, "description": "Monotonic; bumped on displacement." },
        "currentSessionId":     { "type": ["string", "null"], "description": "Ephemeral per SSE connection." },
        "livenessState":        { "enum": ["online", "unresponsive_cognitive", "unresponsive_transport", "offline"], "description": "ADR-017 composite FSM 4-state. Observed; computed from lastHeartbeatAt + receiptSla." },
        "lastHeartbeatAt":      { "type": "string", "format": "date-time" },
        "activityState":        { "type": "string", "description": "Mission-62 orthogonal FSM; auto-clamped offline when livenessState != online." },
        "sessionStartedAt":     { "type": ["string", "null"], "format": "date-time" },
        "lastToolCallAt":       { "type": ["string", "null"], "format": "date-time", "description": "Mission-62 un-rate-limited telemetry." },
        "lastToolCallName":     { "type": ["string", "null"] },
        "idleSince":            { "type": ["string", "null"], "format": "date-time" },
        "workingSince":         { "type": ["string", "null"], "format": "date-time" },
        "quotaBlockedUntil":    { "type": ["string", "null"], "format": "date-time" },
        "cognitiveTTL":         { "type": ["integer", "null"], "description": "Mission-75 / bug-52: seconds remaining cognitive window." },
        "transportTTL":         { "type": ["integer", "null"] },
        "cognitiveState":       { "enum": ["alive", "unresponsive", "unknown"], "description": "Mission-75 ComponentState." },
        "transportState":       { "enum": ["alive", "unresponsive", "unknown"] },
        "adapterVersion":       { "type": "string", "description": "Handshake source-of-truth. Distinct from clientMetadata.sdkVersion (raw client-supplied). Observed at register-time." },
        "ipAddress":            { "type": ["string", "null"], "description": "Hub-side derived from SSE peer addr; NOT adapter-supplied (security)." },
        "advisoryTags":         { "type": "object", "description": "Mission-66 build-identity projections (proxyVersion, proxyCommitSha, sdkVersion, etc.)." },
        "restartCount":         { "type": "integer", "minimum": 0, "description": "Computed from restartHistoryMs filtered against AGENT_RESTART_WINDOW_MS." },
        "restartHistoryMs":     { "type": "array", "items": { "type": "integer" }, "description": "Internal ring; cap=AGENT_RESTART_HISTORY_CAP (50). FIFO eviction." },
        "recentErrors":         { "type": "array", "items": { "$ref": "#/definitions/AgentErrorRecord" }, "description": "Mission-62 ring; cap=AGENT_RECENT_ERRORS_CAP (10). FIFO eviction. Mutated by tool-error hook." }
      }
    },
    "filterable-fields": [
      { "shorthand": "phase",            "path": "status.phase" },
      { "shorthand": "role",             "path": "spec.role" },
      { "shorthand": "name",             "path": "metadata.name" },
      { "shorthand": "fingerprint",      "path": "metadata.fingerprint" },
      { "shorthand": "livenessState",    "path": "status.livenessState" },
      { "shorthand": "activityState",    "path": "status.activityState" },
      { "shorthand": "archived",         "path": "metadata.archived" },
      { "shorthand": "label",            "path": "spec.labels",       "selector": "k8s-map" }
    ]
  }
}
```

**Partition rationale (Agent) — v0.2 with engineer dispositions:**
- **`name` → `metadata.name`** — handle-classified per §1.5 cluster-2; Agent.name IS identity (sourced from `OIS_AGENT_NAME`; drives fingerprint + agentId derivation). First of three cluster-3 kinds to use `metadata.name` (Agent + Tele + SchemaDef all use it).
- **`fingerprint` → metadata** — identity-derived; immutable. Cleaner in metadata as identity-shape.
- **`archived` → metadata** (engineer OQ2 concur with K8s precedent: **`metadata.deletionTimestamp`** is the exact analog — deletion/archival markers live in metadata. Plus archived is append-only post-archive → identity-disposition shape, not observable mutating state).
- **`role` → spec** — declared identity; immutable post-creation; carries declared-intent semantic ("this agent declares its role").
- **`labels` → spec.labels** (engineer OQ1 concur with K8s **PodSpec** scheduling-affinity precedent — Mission-19 labels ARE declared-routing-affinity (the agent declares which routing surface it serves) — not content-classification (cluster-1 pattern)). **This OQ1 disposition surfaces a load-bearing axis: declared-routing-intent (spec.labels) vs declared-content-classification (metadata.labels). See §5 6th cumulative-pattern.**
- **`receiptSla`/`wakeEndpoint`/`livenessConfig`/`pulseConfig`/`clientMetadata` → spec** — declared at handshake; declared-with-controlled-mutation class (handshake refresh per CP3 C5 / bug-16). K8s precedent: PodSpec carries scheduling parameters.
- **`clientMetadata` opaque-in-spec** (engineer OQ3 concur — sibling of cluster-2 PendingAction.spec.payload opaque-payload disposition; M18 handshake payload is consumed as a whole at register-time; sub-partition would add complexity without queryability gain).
- **`status` (online/offline primary FSM) → `status.phase`** — 1:1 rename per K8s convention; primary FSM per §1.6 multi-FSM discipline.
- **All FSM/observed/telemetry fields → status** — sessionEpoch, currentSessionId, livenessState (composite ADR-017), activityState (Mission-62), cognitive/transport TTL/State (Mission-75 — engineer OQ5 concur — observed Hub-side per Design v1.0 §3.1 truth-table; same partition rationale as livenessState). Multi-FSM in status per §1.6.
- **`advisoryTags` → status** (engineer OQ4 concur — Hub-derived projection of declared-data at handshake; observed not declared; sibling of cluster-2 PendingAction.status.continuationState Hub-derived state).
- **`firstSeenAt` → `metadata.createdAt`** (uniformity rename per cluster-2 PendingAction pattern).
- **`lastSeenAt` → `metadata.updatedAt`** (uniformity rename).

**Field renames visible post-cutover (Agent):**
- `Agent.status` (online/offline FSM) → `Agent.status.phase`
- `Agent.name` → `Agent.metadata.name` (handle-classified)
- `Agent.labels` → `Agent.spec.labels` (path move; same map shape; **see OQ1**)
- `Agent.firstSeenAt` → `Agent.metadata.createdAt`
- `Agent.lastSeenAt` → `Agent.metadata.updatedAt`
- All other top-level → status.* or spec.* per partition above

---

### §2.2 Tele — partition (v0.2 fill per engineer dispositions)

**Existing flat shape** (per `hub/src/entities/tele.ts`):
- `id`, `name`, `description`, `successCriteria` (markdown)
- `status` (FSM: `active | superseded | retired`)
- `supersededBy?` (when status=superseded; successor tele id)
- `retiredAt?` (when status=retired; ISO timestamp)
- `createdBy?`, `createdAt`

**Partition:**

```json
{
  "name": "Tele",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "type": "object",
      "required": ["id", "kind", "apiVersion", "createdAt", "name"],
      "properties": {
        "id":         { "type": "string", "pattern": "^tele-[0-9]+$" },
        "kind":       { "const": "Tele" },
        "apiVersion": { "const": "core.ois/v1" },
        "createdAt":  { "type": "string", "format": "date-time" },
        "createdBy":  { "$ref": "#/definitions/Author" },
        "name":       {
          "type": "string",
          "description": "Engineer OQ6 concur: handle-classified per §1.5; short handles like 'T1-Strategic-Clarity'. Third kind in cluster-3 to use metadata.name (after Agent; SchemaDef also uses it)."
        }
      }
    },
    "spec-schema": {
      "type": "object",
      "required": ["description", "successCriteria"],
      "properties": {
        "description":     {
          "type": "string",
          "description": "Declared substantive content; immutable post-creation per Mission-43 zero-backfill discipline."
        },
        "successCriteria": {
          "type": "string",
          "description": "Engineer OQ7 concur: markdown-body shape; matches Mission.spec.goal / Proposal.spec.body / Turn.spec.scope pattern (declared substantive content in spec)."
        }
      }
    },
    "status-schema": {
      "type": "object",
      "required": ["phase"],
      "properties": {
        "phase": {
          "enum": ["active", "superseded", "retired"],
          "description": "3-state lifecycle FSM. Migrated 1:1 from current flat Tele.status field."
        },
        "supersededBy": {
          "type": ["string", "null"],
          "pattern": "^tele-[0-9]+$",
          "description": "Engineer OQ8 concur: populated at superseded transition; observed lineage pointer. Inline FK at cluster-3 cutover; idea-151 Relationship-kind extraction post-cutover (same disposition as Task.dependsOn / Turn.tele[])."
        },
        "retiredAt": {
          "type": ["string", "null"],
          "format": "date-time",
          "description": "Populated at retired transition; FSM-transition timestamp."
        }
      }
    },
    "filterable-fields": [
      { "shorthand": "phase",          "path": "status.phase" },
      { "shorthand": "name",           "path": "metadata.name" },
      { "shorthand": "supersededBy",   "path": "status.supersededBy" },
      { "shorthand": "createdBy.role", "path": "metadata.createdBy.role" }
    ]
  }
}
```

**Partition rationale (Tele) — v0.2 with engineer dispositions:**
- **`name` → `metadata.name`** (engineer OQ6 concur; handle-classified per §1.5 cluster-2).
- **`description`/`successCriteria` → spec** (engineer OQ7 concur; markdown-body shape; declared substantive content immutable per Mission-43).
- **`status` → `status.phase`** (1:1 rename; 3-state FSM preserved).
- **`supersededBy` → status** (engineer OQ8 concur; observed lineage pointer; inline at cluster-3 cutover; idea-151 follow-on extraction).
- **`retiredAt` → status** (FSM-transition timestamp).
- **`createdBy` → metadata** (cluster-1 §3.1 pattern).
- **Content-immutability discipline preserved** (engineer OQ9 confirm — write-boundary policy at `tele-repository.ts` putIfMatch CAS retry; not envelope-shape concern).

**Field renames visible post-cutover (Tele):**
- `Tele.status` (flat FSM) → `Tele.status.phase`
- `Tele.name` → `Tele.metadata.name`
- `Tele.description`/`successCriteria` → `Tele.spec.*`
- `Tele.supersededBy`/`retiredAt` → `Tele.status.*`

**Composition checkpoints:**
- CAS retry on supersede/retire (per `tele-repository.ts:157`) preserves under envelope (substrate-level putIfMatch per Design v1.4 §2.1).
- idea-151 Relationship-kind extraction for `supersededBy` lineage post-cutover.

---

### §2.3 SchemaDef — partition (v0.2 fill per engineer dispositions)

**Existing flat shape** (per `hub/src/storage-substrate/types.ts:14-25` — NEW per mission-83 W2):
- `kind` (string — entity kind this defines, e.g., "Message")
- `version` (integer — bump on shape change)
- `fields[]` (FieldDef[] — declared field schema; validation-only)
- `indexes[]` (IndexDef[] — hot fields with per-kind expression indexes)
- `watchable` (boolean — wire NOTIFY trigger; substrate-internal-events excluded)

**Partition:**

```json
{
  "name": "SchemaDef",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "type": "object",
      "required": ["id", "kind", "apiVersion", "createdAt", "name"],
      "properties": {
        "id":         {
          "type": "string",
          "description": "PK equals the kind-name this SchemaDef describes (per entity-kinds.json; single SchemaDef per kind; latest-version-wins via spec.version)."
        },
        "kind":       { "const": "SchemaDef" },
        "apiVersion": { "const": "core.ois/v1", "description": "Engineer OQ12 concur: uniform core.ois/v1 honors Survey Q2-A R2 minimal-2-group-taxonomy ratification, over K8s `apiextensions.ois.io/v1` analog (which is real but optional precedent)." },
        "createdAt":  { "type": "string", "format": "date-time" },
        "updatedAt":  { "type": "string", "format": "date-time" },
        "name":       {
          "type": "string",
          "description": "Engineer OQ13 concur: metadata.name = <kind-name> (e.g., 'Idea', 'Bug', 'Message') per K8s CRD precedent (CustomResourceDefinition.metadata.name = 'tasks.batch.k8s.io'). Handle-classified per §1.5."
        }
      }
    },
    "spec-schema": {
      "type": "object",
      "required": ["version", "fields", "indexes", "watchable"],
      "properties": {
        "version":   { "type": "integer", "minimum": 1, "description": "Declared schema version; bumped on shape change. Reconciler reads latest." },
        "fields":    {
          "type": "array",
          "items": { "$ref": "#/definitions/FieldDef" },
          "description": "Declared field schema (validation-only, not column-promote since Flavor A per Design v1.1 §2.3)."
        },
        "indexes":   {
          "type": "array",
          "items": { "$ref": "#/definitions/IndexDef" },
          "description": "Hot fields with per-kind expression indexes; reconciler emits DDL post-init."
        },
        "watchable": {
          "type": "boolean",
          "description": "Wire NOTIFY trigger for this kind (default true; substrate-internal-events excluded — e.g., Counter is false per cluster-3 §2.4 + bug-93 bookkeeping context)."
        }
      }
    },
    "status-schema": {
      "type": "object",
      "required": ["phase"],
      "properties": {
        "phase": {
          "enum": ["pending", "applied", "failed"],
          "description": "Engineer OQ10 SUBSTANTIVE DEVIATION ACCEPTED: SchemaDef gets reconciliation state on envelope per K8s CRD precedent (CustomResourceDefinition.status.conditions[] carries NamesAccepted / Established / etc.). pending = reconciler hasn't processed yet; applied = DDL emitted + indexes created successfully; failed = reconciler error (see status.reconcileError). Operator-DX queryability: `SELECT id FROM entities WHERE kind='SchemaDef' AND data->'status'->>'phase'='failed';`"
        },
        "lastReconciledAt": {
          "type": ["string", "null"],
          "format": "date-time",
          "description": "Reconciler timestamp; set on phase transition to applied / failed."
        },
        "reconcileError": {
          "type": ["string", "null"],
          "description": "Populated when phase=failed; carries error message from reconciler for operator-DX surface."
        },
        "appliedVersion": {
          "type": ["integer", "null"],
          "minimum": 0,
          "description": "Spec version that was successfully applied (may lag spec.version when reconciler is mid-flight or failed on a pending bump)."
        }
      }
    },
    "filterable-fields": [
      { "shorthand": "phase",           "path": "status.phase" },
      { "shorthand": "name",            "path": "metadata.name" },
      { "shorthand": "version",         "path": "spec.version" },
      { "shorthand": "appliedVersion",  "path": "status.appliedVersion" },
      { "shorthand": "watchable",       "path": "spec.watchable" }
    ]
  }
}
```

**Partition rationale (SchemaDef) — v0.2 with engineer dispositions:**
- **`id` = kind-name (PK)** — preserves entity-kinds.json substrate-mediated property (single SchemaDef per kind).
- **`name` → `metadata.name = <kind-name>`** (engineer OQ13 concur; K8s CRD precedent; handle-classified per §1.5).
- **`apiVersion: "core.ois/v1"`** (engineer OQ12 concur; Survey Q2-A R2 minimal-taxonomy ratification preserved over K8s CRD `apiextensions.*` analog).
- **`version`/`fields`/`indexes`/`watchable` → spec** (declared schema configuration; immutable except via explicit version bump).
- **`status.phase: "pending" | "applied" | "failed"`** (**engineer OQ10 SUBSTANTIVE DEVIATION ACCEPTED** — K8s CRD precedent carries reconciliation state on envelope; operator-DX queryability via standard `list_*` filter beats grepping reconciler logs. Substrate cost ~5 lines in reconciler).
- **`status.lastReconciledAt`/`reconcileError`/`appliedVersion`** — Hub-projected observed reconciliation state.
- **Bootstrap-self-referential discipline preserved** (engineer OQ11 confirm — SchemaDef-for-SchemaDef written FIRST at substrate-init; reconciler reads + emits DDL per Design §2.3; kill-9-between-bootstrap-steps test per mission-83 Design v1.1 §2.3 M4 fold).

**Field renames visible post-cutover (SchemaDef):**
- **NEW status fields** added at envelope cutover: `status.phase`, `status.lastReconciledAt`, `status.reconcileError`, `status.appliedVersion` (per OQ10 deviation)
- **NEW reconciler substrate work** post-cutover: write `status.phase = "applied" | "failed"` + `status.lastReconciledAt` + (on failure) `status.reconcileError` per reconcile cycle. Migration writes existing SchemaDefs as `status.phase = "applied"` (they're operational on production substrate per mission-83 W4.x cutover).

**Composition checkpoints:**
- Bootstrap-self-referential preserved per mission-83 Design v1.1 §2.3 M4 fold (engineer OQ11 confirm).
- Reconciler reads SchemaDef.spec + emits DDL per Design §2.3 (now ALSO writes back status per OQ10).
- 22-kind inventory locked at mission-83 W1.1 per entity-kinds.json v1.1.
- New operator-DX surface (post-cutover): `list_resources({kind: "SchemaDef", filter: {phase: "failed"}})` finds reconciliation failures.

---

### §2.4 Counter — partition (v0.2 fill; OQ14 ratified to option (a))

**Existing flat shape** (per `hub/src/entities/substrate-counter.ts` + `storage-substrate/schemas/all-schemas.ts:92`):
- **Single-row meta-entity**: id="counter" fixed
- Embedded map of per-counter-domain values: `{ taskCounter: N, ideaCounter: N, bugCounter: N, missionCounter: N, threadCounter: N, turnCounter: N, teleCounter: N, proposalCounter: N, ... }`
- `watchable: false` (bookkeeping; no consumer needs change-events)
- Field-shape is **open-ended per architect-judgment** (per all-schemas.ts line 96)
- CAS retry loop via SubstrateCounter (bug-97 W5.5 fix; substrate getWithRevision + putIfMatch)

**Substantive open question (OQ14):** how does the special-case Counter pattern fit the K8s envelope?

**Three options for v0.1:**

**Option (a) — Envelope with embedded-map in status:**
```json
{
  "metadata": { "id": "counter", "kind": "Counter", "apiVersion": "core.ois/v1", "createdAt": "..." },
  "spec": {},
  "status": {
    "phase": "active",
    "counters": {
      "taskCounter": 1234,
      "ideaCounter": 315,
      "bugCounter": 118,
      ...
    }
  }
}
```
Pros: K8s-uniformity preserved; single-row pattern unchanged
Cons: embedded-map in status is the same shape as today; envelope adds wrapper overhead without semantic gain

**Option (b) — Per-domain rows (10+ rows; one envelope per counter-domain):**
```json
{ "metadata": { "id": "task", "kind": "Counter", "name": "taskCounter" }, "spec": {}, "status": { "value": 1234 } }
{ "metadata": { "id": "idea", "kind": "Counter", "name": "ideaCounter" }, "spec": {}, "status": { "value": 315 } }
```
Pros: queryable per-domain via FilterableField; uniform per-row shape; matches K8s "one row per entity"
Cons: migration mutation (single row → 10+ rows); breaks existing SubstrateCounter contract (must rewrite as per-row getWithRevision + putIfMatch)

**Option (c) — Carve-out from envelope (special-case preserved):**
SchemaDef declares Counter as `envelope-applies: false`; substrate-write-boundary skips envelope validation; Counter stays as `{id: "counter", taskCounter: N, ...}` opaque blob with substrate-CAS semantics.
Pros: zero migration; preserves bug-97 W5.5 fix mechanism unchanged
Cons: introduces "envelope-doesn't-apply" precedent — violates cluster-3 §1 "K8s envelope applies to all substrate-mediated kinds" implicit contract; substrate-currency-discipline says "all kinds get envelope"

**Disposition (v0.2):** **(a) — RATIFIED** per engineer OQ14 concur. Engineer rationale carries the K8s ConfigMap precedent (single entity with `.data: {key: value}` embedded map; not per-key rows) — OIS Counter follows the same shape cleanly post-(a)-envelope. Engineer notes (b) "technically cleaner but migration churn isn't justified — Counter is bookkeeping-only (`watchable: false`); no known query pattern needs per-domain rows; bug-97 W5.5 fix mechanism would need rewrite"; (c) "architecturally compromised; introduces 'envelope-doesn't-apply' precedent that would propagate as anti-pattern across future singleton-meta-entities."

**Partition:**

```json
{
  "name": "Counter",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "type": "object",
      "required": ["id", "kind", "apiVersion", "createdAt"],
      "properties": {
        "id":         {
          "const": "counter",
          "description": "Special fixed pattern: single-row meta-entity (per memory-substrate.ts:364 + postgres-substrate.ts:349). Only one Counter instance ever exists."
        },
        "kind":       { "const": "Counter" },
        "apiVersion": { "const": "core.ois/v1" },
        "createdAt":  { "type": "string", "format": "date-time" },
        "updatedAt":  { "type": "string", "format": "date-time" }
      }
    },
    "spec-schema": {
      "type": "object",
      "description": "Counter has no declared-intent fields; spec is empty (uniformity convention; the entity is pure bookkeeping observed state).",
      "properties": {}
    },
    "status-schema": {
      "type": "object",
      "required": ["phase", "counters"],
      "properties": {
        "phase": {
          "const": "active",
          "description": "Uniformity convention; Counter has no real FSM. Constant 'active' for envelope-shape conformance."
        },
        "counters": {
          "type": "object",
          "additionalProperties": { "type": "integer", "minimum": 0 },
          "description": "K8s ConfigMap precedent (.data: {key: value} embedded map). Per-counter-domain values: taskCounter, ideaCounter, bugCounter, missionCounter, threadCounter, turnCounter, teleCounter, proposalCounter, etc. Open-ended additionalProperties per architect-judgment + engineer OQ14 ratification."
        }
      }
    },
    "filterable-fields": []
  }
}
```

**Partition rationale (Counter) — v0.2 with engineer dispositions:**
- **OQ14 RATIFIED option (a)** — embedded-map in `status.counters`; K8s ConfigMap precedent; SubstrateCounter CAS mechanism preserved via path-rewrite (`data.taskCounter` → `data.status.counters.taskCounter`).
- **`id` = `"counter"` constant** — preserves single-row meta-entity pattern.
- **`spec` empty object** — Counter has no declared-intent fields; uniformity convention for envelope-shape conformance.
- **`status.phase` constant `"active"`** — uniformity convention; no real FSM (Counter is pure bookkeeping). Could omit but uniformity wins.
- **`status.counters: Record<string, number>`** — K8s ConfigMap precedent.
- **`metadata.name` OMITTED** (engineer OQ15 concur — Counter is a **singleton-meta-entity**; only one instance; handle would be redundant. §1.5 binary axis (handle vs content) doesn't cleanly apply — Counter is informally a **third class**; see §5 forward-question on formalizing if clusters 4/5 surface additional singleton-meta-entities).
- **`filterable-fields: []`** — Counter has no query surface (read by id only at SubstrateCounter mechanism; `watchable: false` per Mission-83 §3.4.1).

**Field renames visible post-cutover (Counter):**
- Embedded-map `{taskCounter, ideaCounter, ...}` → `status.counters.{taskCounter, ideaCounter, ...}`
- SubstrateCounter path-rewrite at read+write boundary (single mechanism change; preserves bug-97 W5.5 CAS semantics)

**Composition checkpoints:**
- bug-97 W5.5 CAS preserved (engineer OQ14 ratification): getWithRevision + putIfMatch retry loop mechanism unchanged post-envelope.
- K8s ConfigMap precedent for singleton-with-embedded-map shape.

---

## §3 Composition checkpoints

### §3.1 mission-83 (Hub Storage Substrate) — SchemaDef bootstrap

SchemaDef is NEW per mission-83 W2; substrate-native bootstrap-self-referential. Cluster-3 cutover ratifies SchemaDef's own envelope shape (§2.3 above). Reconciler-driven index emission post-cutover uses substrate-native SchemaDef rows + emits DDL on substrate-init.

### §3.2 mission-66 (Build-Identity AdvisoryTag) — Agent telemetry

`Agent.status.advisoryTags` carries mission-66 build-identity projections (proxyCommitSha / proxyDirty / sdkCommitSha / sdkDirty). Cluster-3 envelope preserves the field; mission-66 dispatch unchanged.

### §3.3 mission-75 (TTL-Liveliness Design) — Agent component-state observability

`Agent.status.cognitiveTTL` / `transportTTL` / `cognitiveState` / `transportState` per mission-75 v1.0 §3.1 truth-table. Cluster-3 envelope preserves all four fields in status.

### §3.4 mission-43 (Tele Lifecycle) — supersede/retire primitives

`Tele.status.phase` (active → superseded → retired) preserves Mission-43 lifecycle semantics. CAS retry on supersede/retire (per tele-repository.ts:157) maps to substrate.putIfMatch unchanged.

### §3.5 idea-121 (M-API-v2.0) — `get_resource_shape` consumer

Cluster-3 SchemaDef partition feeds idea-121 projection layer (per cluster-1 §4.1 + cluster-2 §3.4 patterns).

### §3.6 idea-151 (M-Graph-Relationships) — Tele lineage edges

`Tele.status.supersededBy` is an inline FK pointer. idea-151 Relationship-kind candidate post-cutover (`{from: tele-A, to: tele-B, edgeType: "superseded_by"}`). Cluster-3 envelope preserves inline pointer; idea-151 follow-on Mission carves out. Same disposition as Task.dependsOn (cluster-2 §3.3).

### §3.7 idea-315 (M-PR-Synchronize-Handler) — coordination methodology

Surfaced this session during cluster-2 v0.2 push. Composes with cluster-3 development workflow: this PR (cluster-3 v0.1) gets initial review via `pr_opened_bilateral`; v0.2 fold-in commit will need explicit `create_message` ping to greg (per memory rule scope-refinement) until idea-315 lands.

### §3.8 bug-97 (Counter race) — SubstrateCounter CAS preserved

Cluster-3 Counter envelope option (a) preserves SubstrateCounter's bug-97 fix mechanism (getWithRevision + putIfMatch retry loop). Path-rewrite at substrate boundary: `data.taskCounter` → `data.status.counters.taskCounter`. No mechanism change.

### §3.9 bug-118 (substrate-wide bug-lineage gap)

Cluster-1 §4.2 pattern — `metadata.sourceThreadId`/`sourceActionId` envelope-level provenance. **Cluster-3 has limited applicability**: Agent/Tele/SchemaDef/Counter are not cascade-spawn-shaped (these are substrate-native or handshake-derived kinds). Cluster-3 envelope does NOT add cascade-backlink metadata fields per current cluster (composition note only).

---

## §4 Acceptance criteria (cluster-3-specific)

- All 4 cluster-3 kinds (Agent / Tele / SchemaDef / Counter) carry valid envelope structure post-cutover (verified via psql JSON-shape inspection per kind)
- Each kind's `apiVersion: "core.ois/v1"`
- Strict K8s partition (no top-level fields beyond `{id, name, kind, apiVersion, metadata, spec, status}`; `name` per-kind per OQ6/OQ13/OQ15)
- `FilterableField.path` declarations per-kind enable shorthand-filter translation at `list_*` runtime; composes with idea-121
- **FSM `phase` enum** preserves all current state semantics 1:1 (Agent 2-state primary + multiple orthogonal FSMs in status; Tele 3-state; SchemaDef no-FSM; Counter no-FSM)
- **Field path moves preserved 1:1** in migration (no data loss):
  - `Agent.status` (online/offline) → `Agent.status.phase`
  - `Agent.name` → `Agent.metadata.name`
  - `Agent.firstSeenAt/lastSeenAt` → `Agent.metadata.createdAt/updatedAt`
  - Tele `name` → `metadata.name`; `status` → `status.phase`; `description`/`successCriteria` → spec.*
  - SchemaDef field path under spec.{fields, indexes, watchable, version}
  - Counter embedded-map → status.counters (option (a))
- **Counter migration option** ratified at v0.2 per engineer OQ14 disposition; bug-97 SubstrateCounter CAS mechanism preserved (path-rewrite only)
- **SchemaDef bootstrap-self-referential** discipline preserved (write-order: SchemaDef-for-SchemaDef first)
- **Cross-Mission dependency surfaces (cluster-3):**
  - `Tele.status.supersededBy` stays inline at this cutover; idea-151 follow-on Mission extracts to Relationship-kind edges
  - `Counter` partition strategy ratified per engineer OQ14 (option (a)/(b)/(c)); no cross-Mission dependency beyond cluster-3

---

## §5 Cumulative-pattern reuse + cluster-3 additions

Cluster-3 inherits all five patterns surfaced at cluster-2:
1. `metadata.name` for handle-classified kinds (extended use: cluster-3 Agent + Tele + SchemaDef all use `metadata.name` — three more handle-classified kinds beyond cluster-2 Turn)
2. Declared-with-controlled-mutation pattern (Agent.spec.receiptSla / clientMetadata / wakeEndpoint)
3. Derived-scalar-field discipline (not used in cluster-3 — no derived scalars per kind)
4. Default-to-status for FSM-mutated fields (Agent ✓ Tele ✓)
5. Virtual-view envelope-exclusion (not used in cluster-3 — no virtual views per kind)

**Cluster-3 adds 1 NEW cumulative pattern + 1 NEW sub-discipline (§1.6) + 1 forward-question:**

### 6. Declared-routing-intent (spec.labels) vs declared-content-classification (metadata.labels) axis

**Surfaced at v0.2 engineer review observation #3 (OQ1 Agent.labels disposition).** Two structurally-distinct uses of label-maps:

| Class | Path | Semantic | Example | K8s precedent |
|---|---|---|---|---|
| **Declared-routing-intent** | `spec.labels` | Agent/dispatch declares which routing surface it serves; consumed at routing/matching time | Agent.spec.labels (Mission-19 routing); Task.metadata.labels carries same Mission-19 labels (inherited at submit-time) | PodSpec.nodeSelector / affinity / tolerations |
| **Declared-content-classification** | `metadata.labels` | Author classifies the entity's content for queryable discovery | Idea.metadata.labels (tags for triage queries); Bug.metadata.labels (severity-class / area tags) | Pod.metadata.labels (app=foo, tier=backend) |

**Methodology rule:** When a label-map carries **routing-intent / matching-affinity**, place at `spec.labels`. When a label-map carries **content-classification / discovery-tagging**, place at `metadata.labels`. Both are queryable via map-type filter (`selector: "k8s-map"`) — the partition difference reflects semantic, not technical capability.

**Special case (Mission-19 Task.labels inheritance):** Task.metadata.labels carries the same map-shape inherited from creator at submit-time, but the inheritance semantic is closer to content-classification (carrying scope/context tags) than routing-intent (which would be Agent-side declaration). Cluster-2 §2.1 picked metadata.labels for Task — engineer OQ1 disposition for Agent diverges (spec.labels for Agent's own routing-intent). The two-axis discipline articulates why both placements are correct.

### §1.6 multi-FSM in status (NEW sub-discipline)

Per §1.6 above — multi-FSM kinds (Agent: 4 orthogonal FSMs) carry all FSMs in status as independent observables; `status.phase` is the primary FSM; additional FSMs use semantically-named fields. K8s precedent: Pod.status.phase + status.conditions[].

### Forward-question — singleton-meta-entity as third class beyond §1.5 binary axis

**Engineer observation #2 (OQ15 Counter discussion):** the §1.5 binary axis (handle-classified vs content-classified) didn't cleanly apply to Counter — it's a **singleton-meta-entity** (only one instance ever; id="counter" fixed). Cluster-3 §2.4 handled this as a special-case: `metadata.name` OMITTED with the rationale "Counter is a third (informal) class."

**If clusters 4/5 surface additional singleton-meta-entities, formalize the third class.** RepoEventBridgeCursor / RepoEventBridgeDedupe are per-`<owner>__<repo>` id-keyed (not singleton) — likely don't qualify. Notification / Audit / Message are entity-keyed (id-N pattern; not singleton). Document / *HistoryEntry are content-archive (id-derived; not singleton).

**Lean:** Counter may be the only singleton-meta-entity in the substrate; the third class may not need formalization. Mark as Cluster-3 v0.2 forward-question; engineer audit at cluster-4 reviewing.

**v2.1 methodology candidate Q** (surfaced this session): articulate the cluster-3 6th cumulative-pattern (declared-routing-intent vs declared-content-classification axis) into a top-level methodology rule for future cluster Designs.

---

## §6 Status

**v0.2** — engineer PR #270 v0.1 review integrated. All 15 OQ dispositions applied; 3 cross-cutting engineer observations integrated (§1.6 multi-FSM sub-discipline + §5 6th cumulative-pattern + §5 singleton-meta-entity forward-question); §2.2/§2.3/§2.4 stubs filled to full JSON Schema.

**Substantive cluster-3 contributions to envelope methodology** (signal for clusters 4/5):

1. **§1.6 multi-FSM-in-status sub-discipline** — primary FSM at `status.phase`; additional FSMs use semantically-named status fields. K8s Pod.status.conditions[] precedent. Cluster-3 Agent demonstrates (4 orthogonal FSMs).
2. **§5 6th cumulative-pattern: declared-routing-intent vs declared-content-classification axis** — `spec.labels` for routing/matching affinity (K8s PodSpec.nodeSelector precedent); `metadata.labels` for content-tagging (K8s Pod.metadata.labels precedent). Both queryable via `selector: "k8s-map"`. Articulated post-engineer-OQ1.
3. **§2.3 SchemaDef envelope carries reconciliation state** (engineer OQ10 deviation accepted) — K8s CRD precedent (CustomResourceDefinition.status.conditions[]); operator-DX queryability gain. Substrate work: ~5 lines in reconciler to write `status.phase` + `status.lastReconciledAt`.
4. **§2.4 Counter as singleton-meta-entity** — K8s ConfigMap embedded-map precedent (`status.counters: {key: value}`); preserves bug-97 W5.5 SubstrateCounter CAS mechanism via path-rewrite.

**Engineer approval posture (v0.1 → v0.2 transition):**
- v0.1 approved by greg (PR #270 review APPROVED 2026-05-23T11:31Z at commit `4f33ced`)
- v0.2 integrates all dispositions + 3 cross-cutting observations; **architect-side explicit `create_message` ping to greg follows v0.2 push** per refined memory rule (post-push re-review surfacing pending idea-315 substrate-build)

**v2.1 methodology candidate Q** captured: lift §5 6th cumulative-pattern (declared-routing-intent vs declared-content-classification axis) into top-level methodology rule.

**Next architect action post-approval:** cluster-4 Design (Message / Audit / Notification / RepoEventBridgeCursor / RepoEventBridgeDedupe per cluster-2 §6 ratified scope).
