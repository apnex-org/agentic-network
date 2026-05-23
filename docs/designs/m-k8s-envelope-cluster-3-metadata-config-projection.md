# M-K8s-Envelope — Cluster 3 Metadata/Config/Projection Partition (Design Working Draft)

**Status:** v0.1 — architect-fronted; awaiting engineer review
**Mission:** idea-126 (M-K8s-Envelope)
**Phase:** Phase 4 Design — cluster-3 partition pass (3 of 5 clusters per substrate-grounded decomposition)
**Coordination:** per-PR review (per `feedback_pr_opened_notification_is_review_signal` v2 scope-refinement — initial PR-open IS the signal; v0.2 fold-in pushes get explicit `create_message` ping until M-PR-Synchronize-Handler / idea-315 lands)
**Date:** 2026-05-23 AEST
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

**Partition rationale (Agent):**
- **`name` → `metadata.name`** — handle-classified per §1.5 cluster-2; Agent.name IS identity (sourced from `OIS_AGENT_NAME`; drives fingerprint + agentId derivation). Second cluster-3 kind to use `metadata.name` (after cluster-2 Turn).
- **`fingerprint` → metadata** — identity-derived; immutable. Cleaner in metadata as identity-shape.
- **`archived` → metadata** — append-only deletion marker; identity-disposition shape.
- **`role` → spec** — declared identity; immutable post-creation; carries declared-intent semantic ("this agent declares its role").
- **`labels` → spec.labels** (Mission-19) — **OQ1 below**. v0.1 picks spec because labels are declared-routing-affinity (K8s PodSpec precedent), not content-classification (cluster-1 pattern). **Engineer disposition welcome.**
- **`receiptSla`/`wakeEndpoint`/`livenessConfig`/`pulseConfig`/`clientMetadata` → spec** — declared at handshake; declared-with-controlled-mutation class (handshake refresh per CP3 C5 / bug-16). K8s precedent: PodSpec carries scheduling parameters.
- **`status` (online/offline primary FSM) → `status.phase`** — 1:1 rename per K8s convention.
- **All FSM/observed/telemetry fields → status** — sessionEpoch, currentSessionId, livenessState, lastHeartbeatAt, activityState, all *Since/quotaBlockedUntil, cognitive/transport TTL/State, adapterVersion (handshake-observed), ipAddress (Hub-derived), advisoryTags (Hub-projected), restartCount/restartHistoryMs/recentErrors.
- **`firstSeenAt` → `metadata.createdAt`** (uniformity rename per cluster-2 PendingAction pattern).
- **`lastSeenAt` → `metadata.updatedAt`** (uniformity rename).

**Field renames visible post-cutover (Agent):**
- `Agent.status` (online/offline FSM) → `Agent.status.phase`
- `Agent.name` → `Agent.metadata.name` (handle-classified)
- `Agent.labels` → `Agent.spec.labels` (path move; same map shape; **see OQ1**)
- `Agent.firstSeenAt` → `Agent.metadata.createdAt`
- `Agent.lastSeenAt` → `Agent.metadata.updatedAt`
- All other top-level → status.* or spec.* per partition above

**Open questions (Agent) — engineer audit:**
- **OQ1**: `Agent.labels` placement — `spec.labels` (declared-routing-affinity; PodSpec precedent) vs `metadata.labels` (cluster-1 content-classification pattern). v0.1 picks spec per K8s precedent + Mission-19 semantic ("agent declares routing surface at handshake"). Engineer disposition welcome.
- **OQ2**: `archived` placement — currently `metadata.archived` (identity-disposition). Alternative: `status.archived` (observable state). K8s precedent: `metadata.deletionTimestamp` lives in metadata (sibling of `archived`). v0.1 picks metadata; engineer audit.
- **OQ3**: `clientMetadata` size — full M18 handshake payload (~10 fields). Stays in spec as opaque sub-object OR partition further? v0.1 picks opaque-in-spec (sibling of cluster-2 PendingAction opaque-payload disposition).
- **OQ4**: `advisoryTags` — mission-66 build-identity projections. Currently Hub-computed from clientMetadata; clearer fit in status (Hub-derived) vs spec (declared). v0.1 picks status (Hub-projected, observed).
- **OQ5**: Component-TTL fields (`cognitiveTTL`/`transportTTL`/`cognitiveState`/`transportState`) — mission-75 added; orthogonal to composite livenessState. All four in status (correct partition). v0.1 confirmed.

---

### §2.2 Tele — partition (v0.1; full at v0.2 per engineer dispositions)

**Existing flat shape** (per `hub/src/entities/tele.ts`):
- `id`, `name`, `description`, `successCriteria` (markdown)
- `status` (FSM: `active | superseded | retired`)
- `supersededBy?` (when status=superseded; successor tele id)
- `retiredAt?` (when status=retired; ISO timestamp)
- `createdBy?`, `createdAt`

**Stub partition (v0.1 — engineer-confirm at v0.2):**

| Field | Section | Rationale |
|---|---|---|
| `id`, `createdAt`, `createdBy` | metadata | identity + provenance |
| `name` | **metadata.name** | handle-classified per §1.5 cluster-2 (Tele names are short handles like "T1-Strategic-Clarity"; substantive content is `description` + `successCriteria`) |
| `description`, `successCriteria` | spec | declared substantive content; immutable post-creation per Mission-43 ("content remains immutable; only lifecycle fields mutate") |
| `phase` (renamed from `status`) | status | 3-state lifecycle FSM (`active → superseded → retired`) |
| `supersededBy` | status | populated at superseded transition; observed lineage pointer |
| `retiredAt` | status | populated at retired transition; FSM-transition timestamp |

**Open questions (Tele) — engineer audit:**
- **OQ6**: `name` placement (`metadata.name`) — Tele follows the handle-classified pattern (cluster-2 §1.5). Substantive content lives in `spec.description` + `spec.successCriteria`. v0.1 picks metadata.name; engineer confirm.
- **OQ7**: `successCriteria` placement — markdown-body shape. Sibling of cluster-2 Turn.spec.scope (Mission.goal / Proposal.body cluster-1 pattern). v0.1 picks spec.
- **OQ8**: `supersededBy` is a FK pointer to successor Tele id. idea-151 Relationship-kind candidate (`{from: tele-A, to: tele-B, edgeType: "superseded_by"}`)? v0.1 picks status.supersededBy inline at cluster-3 cutover; idea-151 follow-on Mission carves out if applicable. Same disposition as Task.dependsOn / Turn.tele[].
- **OQ9**: Tele content-immutability discipline (per Mission-43 Decision 2; zero-backfill) — preserved post-envelope? Yes — spec immutability is a write-boundary policy, not envelope-shape concern. v0.1 confirmed.

**Composition checkpoints:**
- CAS retry on supersede/retire (per `tele-repository.ts:157`) preserves under envelope (substrate-level putIfMatch per Design v1.4 §2.1).
- idea-151 Relationship-kind extraction for `supersededBy` lineage post-cutover.

---

### §2.3 SchemaDef — partition (v0.1; full at v0.2 per engineer dispositions)

**Existing flat shape** (per `hub/src/storage-substrate/types.ts:14-25` — NEW per mission-83 W2):
- `kind` (string — entity kind this defines, e.g., "Message")
- `version` (integer — bump on shape change)
- `fields[]` (FieldDef[] — declared field schema; validation-only)
- `indexes[]` (IndexDef[] — hot fields with per-kind expression indexes)
- `watchable` (boolean — wire NOTIFY trigger; substrate-internal-events excluded)

**Stub partition (v0.1 — engineer-confirm at v0.2):**

| Field | Section | Rationale |
|---|---|---|
| `id` (= `kind`-name as PK per entity-kinds.json) | metadata.id | substrate uses kind-name as the PK (single SchemaDef per kind; latest-version-wins) |
| `kind` | metadata.name | the entity kind this defines (Idea / Bug / Message / etc.); name semantically identifies the SchemaDef instance |
| `version` | **spec.version** | declared schema-version; bumped on shape change |
| `fields[]` | spec.fields | declared field schema |
| `indexes[]` | spec.indexes | declared expression-index list |
| `watchable` | spec.watchable | declared NOTIFY-trigger preference |

**Status partition:** SchemaDef has **NO observed-state component**. The substrate reconciler reads SchemaDef + emits DDL; reconciliation success/failure is logged externally but not stored on SchemaDef itself. v0.1 picks **empty status block** (only `status.phase` required by uniformity convention — could enum on `"applied" | "pending"` if reconciliation state needs surfacing). **OQ10.**

**Open questions (SchemaDef) — engineer audit:**
- **OQ10**: SchemaDef status partition — empty `status` OR `status.phase: "applied" | "pending" | "failed"` for reconciliation state surfacing? v0.1 picks empty status (reconciliation log is external); engineer audit whether SchemaDef envelope should carry reconciliation state.
- **OQ11**: SchemaDef bootstrap-self-referential discipline — at cutover, SchemaDef-for-SchemaDef must be written FIRST (the meta-meta entity). Migration script orders writes accordingly. v0.1 confirms substrate-bootstrap discipline is preserved.
- **OQ12**: `apiVersion` for SchemaDef itself — `core.ois/v1` (per cluster-wide minimal taxonomy)? Or distinct `apiextensions.ois.io/v1` per K8s CRD precedent (where CustomResourceDefinition has its own apiVersion)? v0.1 picks `core.ois/v1` for uniformity; engineer audit.
- **OQ13**: `name` placement (`metadata.name = <kind-name>`)? Per K8s CRD precedent (`metadata.name = "tasks.batch.k8s.io"` for the Task CRD). v0.1 picks metadata.name = `<kind-name>` (e.g., "Idea", "Bug"). Handle-classified pattern applies.

**Composition checkpoints:**
- Bootstrap-self-referential: at substrate-init, SchemaDef-for-SchemaDef must be the first row written (kill-9-between-bootstrap-steps test per mission-83 Design v1.1 §2.3 M4 fold).
- Reconciler reads SchemaDef + emits DDL per Design §2.3.
- 22-kind inventory locked at mission-83 W1.1 (per entity-kinds.json v1.1).

---

### §2.4 Counter — partition (v0.1; substantive open question)

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

**Architect lean (v0.1):** **(a)** — envelope with embedded-map in status. Minimal migration cost; preserves SubstrateCounter contract via path-rewrite (current `data.taskCounter` → `data.status.counters.taskCounter` is a single read+write path); per-counter-domain queryability isn't a known requirement (Counter is bookkeeping-only; per all-schemas.ts `watchable: false`). **(b)** is technically cleaner but cost/benefit doesn't justify the migration churn for a write-only-by-substrate kind. **(c)** is architecturally compromised. Engineer disposition welcome.

**Stub partition (option a; v0.1):**

| Field | Section | Rationale |
|---|---|---|
| `id` (= "counter" fixed) | metadata.id | special pattern preserved |
| `kind` (= "Counter") | metadata.kind | uniform |
| `apiVersion` | metadata.apiVersion | uniform |
| `createdAt`, `updatedAt` | metadata | uniform |
| `phase` (always "active") | status.phase | uniformity convention (no real FSM; bookkeeping kind) |
| `counters: Record<string, number>` (embedded map) | status.counters | preserves current shape; SubstrateCounter path-rewrites read+write |

**Open questions (Counter) — engineer audit:**
- **OQ14**: Option (a) / (b) / (c) partition — see above; architect-lean (a) v0.1.
- **OQ15**: `name` for Counter — there's only one Counter instance (id="counter" fixed). `metadata.name` either OMITTED (cluster-1 content-classified pattern; but Counter isn't content-classified) OR `"counter"` (degenerate single-instance handle). v0.1 picks OMITTED (Counter is a singleton bookkeeping-meta-entity; doesn't fit either §1.5 class cleanly). **Engineer disposition welcome.**

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

## §5 Cluster-2 cumulative-pattern reuse note

Cluster-3 introduces no NEW envelope-methodology patterns. All five patterns surfaced at cluster-2 apply:
1. `metadata.name` for handle-classified kinds (extended use: cluster-3 Agent + Tele + SchemaDef all use `metadata.name`)
2. Declared-with-controlled-mutation pattern (Agent.spec.receiptSla / clientMetadata / labels OQ1)
3. Derived-scalar-field discipline (not used in cluster-3 — no derived scalars per kind)
4. Default-to-status for FSM-mutated fields (Agent ✓ Tele ✓)
5. Virtual-view envelope-exclusion (not used in cluster-3 — no virtual views per kind)

Cluster-3-specific surfaces:
- **Multi-FSM in status** (Agent has 4 orthogonal FSMs — primary status.phase + livenessState + activityState + cognitiveState/transportState component pair). Methodology-consistent with cluster-1 partition (each FSM in status as independent observable).
- **Bookkeeping-only kind special-case** (Counter §2.4) — substantive OQ14 disposition pending engineer review.

---

## §6 Status

**v0.1** — architect-fronted; awaiting engineer review.

**Coordination plan:**
- PR opens; greg engages via `pr_opened_bilateral` notification + posts review on GitHub PR directly (per refined memory scope)
- **v0.2 fold-in commit** (post engineer review) will be preceded by explicit `create_message` ping to greg per memory rule scope-refinement (W2 gap; pending idea-315)
- v0.2 approval converges cluster-3 Design; cluster-4 opens fresh PR

**Outstanding open questions** (engineer disposition expected — 15 OQs):
- OQ1: Agent.labels — spec (declared-routing-affinity) vs metadata.labels (cluster-1 content-classification pattern)
- OQ2: Agent.archived — metadata (identity-disposition) vs status (observable)
- OQ3: Agent.clientMetadata opaque-in-spec confirmation
- OQ4: Agent.advisoryTags — status (Hub-projected) confirmation
- OQ5: Agent component-TTL fields in status confirmation
- OQ6: Tele.name — metadata.name handle-classified confirmation
- OQ7: Tele.successCriteria markdown-body in spec
- OQ8: Tele.supersededBy inline at cluster-3 / idea-151 follow-on
- OQ9: Tele content-immutability discipline preserved
- OQ10: SchemaDef status partition — empty vs `status.phase: applied/pending/failed`
- OQ11: SchemaDef bootstrap-self-referential discipline confirmed
- OQ12: SchemaDef apiVersion — `core.ois/v1` uniformity vs `apiextensions.ois.io/v1` K8s CRD precedent
- OQ13: SchemaDef metadata.name = `<kind-name>` (K8s CRD precedent)
- OQ14: **SUBSTANTIVE — Counter partition strategy** — option (a) embedded-map / (b) per-domain rows / (c) envelope carve-out; architect-lean (a)
- OQ15: Counter.metadata.name OMITTED vs "counter"

**Next architect action post-approval:** cluster-4 Design (Message / Audit / Notification / RepoEventBridgeCursor / RepoEventBridgeDedupe per cluster-2 §6 ratified).
