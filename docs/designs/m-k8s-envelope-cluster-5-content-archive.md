# M-K8s-Envelope — Cluster 5 Content-Archive Partition (Design Working Draft)

**Status:** v0.3 — substrate-truth ratified · ready for migration consumption · **FINAL CLUSTER**
**Mission:** mission-88 (M-K8s-Envelope; idea-126 anchor)
**Phase:** Phase 4 Design — cluster-5 partition pass (**5 of 5 clusters — FINAL**); Phase 8 W5 implementation
**Coordination:** `thread-647` (W5 Design-pass; converged at R3 — FINAL cluster Design-pass closed)
**Date:** 2026-05-24 AEST (v0.3: W5 substrate-currency-ratification per thread-647 R2)

**v0.1 → v0.2 changelog (engineer PR #272 v0.1 review integration):**

**Substantive deviation accepted:**
- **OQ2 — Document.category → `metadata.labels.category`** (engineer DEVIATE from v0.1 spec.category lean). Reasoning per engineer: Document.category IS content-classification per cluster-3 §5 6th cumulative-pattern axis; aligns with K8s precedent (Pod.metadata.labels for category/role/version); composes with future extensibility (additional categories without bumping apiVersion). Architecturally-cleaner; axis-uniformity wins.

**16 OQ concurs integrated:**
- §2.1 Document — OQ1 (name migration populate-from-id) + OQ3 ("active" constant) + OQ4 (mutable update-policy)
- §2.2 ArchitectDecision — full JSON Schema; OQ5-7 concur (name OMITTED; phase "logged"; migration preserved)
- §2.3 DirectorHistoryEntry — full JSON Schema; OQ8-10 concur (spec.role; name OMITTED; text in spec)
- §2.4 ReviewHistoryEntry — full JSON Schema; OQ11-13 concur (metadata.taskId; name OMITTED; idea-151 inline at cluster-5)
- §2.5 ThreadHistoryEntry — full JSON Schema; OQ14-17 concur (spec.title; name OMITTED; substrate-currency 50 prod entries; idea-151 inline)

**Methodology arc-reflection added (§6.1):**
- Engineer cross-cutting observation #3 — 5-cluster Phase 4 Design arc summary (50 partition decisions; 6 cumulative patterns + 4 sub-disciplines; multiple K8s precedents; 22→21 kind re-lock; 3 v2.1 candidates surfaced P+Q+R; zero substrate regressions)
- Methodology stabilized — cluster-5 zero-new-patterns IS the convergence signal
**Sibling Designs:**
- Cluster 1 — substantive-content (5 kinds) — ✓ MERGED at `d8ea695`
- Cluster 2 — queue/FSM-active (3 kinds) — ✓ MERGED at `59c3a70`
- Cluster 3 — metadata/config/projection (4 kinds) — ✓ MERGED at `ddf7bb1`
- Cluster 4 — system-emit/bookkeeping (4 kinds; Notification dropped at v0.2) — ✓ MERGED at `3b1819a`
- **Cluster 5 ← this Design (5 kinds; FINAL)** — completes idea-126 Phase 4 Design

**Survey input:** `docs/reviews/2026-05-23-survey-idea-126.md` (Director-ratified R1 A/A/A + R2 A/A/A). Same Survey applies to all clusters.

**Cluster-1 + 2 + 3 + 4 patterns inherited (final cumulative set):**
- Strict K8s `metadata`/`spec`/`status` partition; no top-level fields beyond `{id, name, kind, apiVersion, metadata, spec, status}`
- `metadata.labels` for content-classification; `spec.labels` for declared-routing-intent (§5 cluster-3 6th cumulative-pattern axis)
- `metadata.annotations["ois.io/..."]` for free-form vendor extension
- `metadata.name` USED for handle-classified kinds; OMITTED for content-classified
- `<Kind>.status` (flat FSM) → `<Kind>.status.phase` (primary FSM)
- Multi-FSM-in-status per cluster-3 §1.6 (NOT used in cluster-5 — content-archive kinds have no FSM)
- `FilterableField.path` per-kind; nested-path via dot-notation
- Virtual-view fields ENVELOPE-EXCLUDED (NOT used in cluster-5)
- Derived-scalar fields via SchemaDef `"derived": true` flag (NOT used in cluster-5)
- Append-only-constant `status.phase: "logged"` pattern (cluster-3 Counter / cluster-4 Audit precedent)
- Field-name collision rename per §1.7 cluster-4 (NOT used — no cluster-5 kinds have `kind` top-level collision)
- `apiVersion: "core.ois/v1"` (minimal 2-group taxonomy)
- Substrate strict K8s; LLM-ergonomic flat projection deferred to idea-121

---

## §1 Cluster-5 design scope — content-archive kinds

**5 NEW kinds per mission-83 W1.1 OQ7 4-kind decomposition + Document architect-VERIFIED:**

| Kind | Mediation | Current shape (production substrate-verified) | Notes |
|---|---|---|---|
| Document | IDocumentStore (NEW) | `{id, name, category, content}` — markdown content; 5 instances in prod | engineer-VERIFIED entity-semantic content; markdown body in `data.content`; documents/{architecture,planning,specs}/ before cutover |
| ArchitectDecision | IArchitectDecisionStore (NEW) | `{id: "ad-N", context, decision, timestamp}` — 28 instances in prod | append-only structured log; decisions.json before cutover |
| DirectorHistoryEntry | IDirectorHistoryEntryStore (NEW) | `{id: "dh-N", role, text, timestamp}` — 200 instances in prod | append-only Director-chat archive; role enum: `user | model`; director-history.json before cutover |
| ReviewHistoryEntry | IReviewHistoryEntryStore (NEW) | `{id: "rh-N", taskId, timestamp, assessment}` — 50 instances in prod | append-only task-review log; review-history.json before cutover |
| ThreadHistoryEntry | IThreadHistoryEntryStore (NEW) | `{id: "th-N", title, outcome, threadId, timestamp}` — 50 instances in prod | append-only thread-archive log; thread-history.json before cutover; NEW per architect W1.1 finding (not in v1.0 inventory) |

**Shared property:** all cluster-5 kinds are **append-only content-archive** — entries are immutable post-create; no FSM transitions; no mutation paths. Partition pattern is **content-spec-heavy** (substantive content in spec) with **constant `status.phase: "logged"`** (sibling of cluster-4 Audit). Content lives in spec; provenance + identity in metadata; status is uniformity-only.

**Cluster-5 specific note: 21-kind substrate inventory completes here.** Post-cluster-5 cutover, all 21 substrate-mediated kinds carry K8s envelope shape uniformly.

---

## §2 Per-kind partitions

### §2.1 Document — canonical reference

**Existing flat shape** (verified via production psql query at 2026-05-23):
- `id` (free-form; e.g., `"policy-network-v1-draft"`)
- `name` (currently null in production; entity-kinds.json v1.1 notes say "name-derived from `<name>.md`" — disposition needed)
- `category` (enum: `architecture | planning | specs`)
- `content` (markdown body; substantive content)
- (no timestamp field — Document is mostly-static; not append-only-log shape)

**Partition (v0.1):**

```json
{
  "name": "Document",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "type": "object",
      "required": ["id", "kind", "apiVersion", "createdAt", "name"],
      "properties": {
        "id":         {
          "type": "string",
          "description": "Free-form identifier; typically name-derived (e.g., 'policy-network-v1-draft'). NOT a counter-allocated pattern; sourced from the original markdown filename (`<name>.md`) per mission-83 W1.1 architect-verify."
        },
        "kind":       { "const": "Document" },
        "apiVersion": { "const": "core.ois/v1" },
        "createdAt":  { "type": "string", "format": "date-time" },
        "updatedAt":  { "type": "string", "format": "date-time" },
        "name":       {
          "type": "string",
          "description": "Engineer OQ1 concur — handle-classified per §1.5 cluster-2. Migration populates from id at cutover (file-stem; e.g., 'policy-network-v1-draft'). For the 5 production entries, id and name carry the same value post-migration (id IS substrate-PK; name IS K8s-handle convention)."
        },
        "labels": {
          "type": "object",
          "additionalProperties": { "type": "string" },
          "description": "Engineer OQ2 substantive deviation: K8s-map for content-classification (declared-content-classification axis per cluster-3 §5 6th cumulative-pattern). Includes well-known `category` key (architecture/planning/specs) + future free-form classification tags. K8s precedent: Pod.metadata.labels for category/role/version classification."
        }
      }
    },
    "spec-schema": {
      "type": "object",
      "required": ["content"],
      "properties": {
        "content":  {
          "type": "string",
          "description": "Markdown body; substantive declared content. Matches cluster-2 Turn.spec.scope + cluster-1 Mission.spec.goal markdown-body pattern."
        }
      }
    },
    "status-schema": {
      "type": "object",
      "required": ["phase"],
      "properties": {
        "phase": {
          "const": "active",
          "description": "Document has no FSM; constant uniformity-convention. Cluster-3 Counter precedent (`status.phase: 'active'` constant for non-FSM kinds)."
        }
      }
    },
    "filterable-fields": [
      { "shorthand": "phase",    "path": "status.phase" },
      { "shorthand": "name",     "path": "metadata.name" },
      { "shorthand": "label",    "path": "metadata.labels", "selector": "k8s-map" },
      { "shorthand": "category", "path": "metadata.labels.category" }
    ]
  }
}
```

**Partition rationale (Document) — v0.2 with engineer dispositions:**
- **`id` → metadata.id** — free-form name-derived identifier; substrate-id-as-PK preserved.
- **`name` → `metadata.name`** (engineer OQ1 concur — handle-classified per §1.5; populated from id at cutover for the 5 prod entries; new entries write name explicitly).
- **`category` → `metadata.labels.category`** (engineer OQ2 SUBSTANTIVE DEVIATION ACCEPTED — content-classification per cluster-3 §5 6th cumulative-pattern axis; K8s Pod.metadata.labels precedent; composes with future extensibility without apiVersion bumps). v0.1 spec.category lean superseded.
- **`content` → spec** — markdown body; substantive declared content; sibling of cluster-2 Turn.spec.scope / cluster-1 Mission.spec.goal.
- **`status.phase: "active"` constant** (engineer OQ3 concur — Document NOT append-only-log shape; cluster-3 Counter precedent). Switches to "logged" if OQ4 disposition flips to append-only.
- **`createdAt`/`updatedAt` → metadata** — uniformity (cluster-1 §3.1 pattern); Document mutable post-create (engineer OQ4 concur — markdown docs evolve).
- **`name` USED** — Document is handle-classified per §1.5; **Document is the ONLY cluster-5 kind with name USED** (others are content-classified).

**Field renames visible post-cutover (Document):**
- `Document.id` → `Document.metadata.id` (preserved)
- `Document.name` → `Document.metadata.name` (populated from id where currently null — OQ1 migration TODO)
- `Document.category` → `Document.metadata.labels.category` (OQ2 deviation; was v0.1 spec.category)
- `Document.content` → `Document.spec.content`
- NEW: `Document.status.phase: "active"` constant

**Document IS the cluster-5 demonstration of the cluster-3 §5 6th cumulative-pattern axis** — content-classification (metadata.labels) for the category enum. Forward signal: future kinds with declared-content-classification fields follow this pattern.

**Composition checkpoints:**
- **wisdom/ static-asset carve-out** per mission-83 v1.1 §3.4.4 — `local-state/architect-context/wisdom/` markdown reference docs are NOT Hub-runtime state; they're 4th out-of-substrate location. Distinct from Document (which IS Hub-runtime state in substrate).
- **mission-83 W1.1 architect-VERIFIED** — Document entity-semantic content distinguished from static-asset carve-out.

---

### §2.2 ArchitectDecision — partition (v0.2 fill per engineer concur on OQ5-7)

**Existing flat shape** (verified via production psql at 2026-05-23):
- `id` (pattern: `ad-N`; counter-allocated; 28 entries in prod)
- `context` (string — substantive content)
- `decision` (string — substantive content)
- `timestamp` (ISO-8601)

**Partition:**

```json
{
  "name": "ArchitectDecision",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "type": "object",
      "required": ["id", "kind", "apiVersion", "createdAt"],
      "properties": {
        "id":         { "type": "string", "pattern": "^ad-[0-9]+$" },
        "kind":       { "const": "ArchitectDecision" },
        "apiVersion": { "const": "core.ois/v1" },
        "createdAt":  { "type": "string", "format": "date-time", "description": "Migrates from existing `timestamp` field; uniformity rename per cluster-4 Audit precedent." }
      }
    },
    "spec-schema": {
      "type": "object",
      "required": ["decision", "context"],
      "properties": {
        "decision": { "type": "string", "description": "Declared substantive content; the decision body." },
        "context":  { "type": "string", "description": "Declared substantive content; what informed the decision." }
      }
    },
    "status-schema": {
      "type": "object",
      "required": ["phase"],
      "properties": {
        "phase": { "const": "logged", "description": "Append-only-log uniformity per cluster-4 Audit precedent (engineer OQ6 concur)." }
      }
    },
    "filterable-fields": [
      { "shorthand": "phase", "path": "status.phase" }
    ]
  }
}
```

**Partition rationale (ArchitectDecision):**
- All 3 OQ5-7 dispositions concur with v0.1.
- `name` OMITTED (content-classified per §1.5; substantive in spec.decision).
- `decision`/`context` → spec.
- `timestamp` → `metadata.createdAt` (uniformity rename).
- `status.phase: "logged"` constant (cluster-4 Audit precedent; append-only).
- Migration preserves `ad-N` id pattern + timestamp ordering for 28 prod entries (no new substrate work).

---

### §2.3 DirectorHistoryEntry — partition (v0.2 fill per engineer concur on OQ8-10)

**Existing flat shape** (verified via production psql at 2026-05-23):
- `id` (pattern: `dh-N`; counter-allocated; 200 entries in prod)
- `role` (enum: `user | model` — LLM chat archive shape)
- `text` (string — substantive content; Director chat message body)
- `timestamp` (ISO-8601)

**Partition:**

```json
{
  "name": "DirectorHistoryEntry",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "type": "object",
      "required": ["id", "kind", "apiVersion", "createdAt"],
      "properties": {
        "id":         { "type": "string", "pattern": "^dh-[0-9]+$" },
        "kind":       { "const": "DirectorHistoryEntry" },
        "apiVersion": { "const": "core.ois/v1" },
        "createdAt":  { "type": "string", "format": "date-time" }
      }
    },
    "spec-schema": {
      "type": "object",
      "required": ["role", "text"],
      "properties": {
        "role": {
          "enum": ["user", "model"],
          "description": "Engineer OQ8 concur: declared LLM-conversation role at log-time; semantically distinct from agent identity role (which would be metadata.createdBy.role). spec.role captures chat-conversation role."
        },
        "text": {
          "type": "string",
          "description": "Declared substantive content; Director chat message body. Sibling of cluster-4 Audit.spec.details / cluster-2 Turn.spec.scope."
        }
      }
    },
    "status-schema": {
      "type": "object",
      "required": ["phase"],
      "properties": {
        "phase": { "const": "logged" }
      }
    },
    "filterable-fields": [
      { "shorthand": "phase", "path": "status.phase" },
      { "shorthand": "role",  "path": "spec.role" }
    ]
  }
}
```

**Partition rationale (DirectorHistoryEntry):**
- All 3 OQ8-10 dispositions concur with v0.1.
- `role` → spec.role (engineer OQ8 concur — declared LLM-conversation role; distinct from agent identity role).
- `name` OMITTED (engineer OQ9 concur — content-classified).
- `text` → spec (engineer OQ10 concur — substantive content matches Audit.spec.details pattern).
- 200 prod entries migration preserves dh-N id pattern.

---

### §2.4 ReviewHistoryEntry — partition (v0.2 fill per engineer concur on OQ11-13)

**Existing flat shape** (verified via production psql at 2026-05-23):
- `id` (pattern: `rh-N`; counter-allocated; 50 entries in prod)
- `taskId` (FK ref to Task)
- `timestamp` (ISO-8601)
- `assessment` (string — substantive content; review assessment body)

**Partition:**

```json
{
  "name": "ReviewHistoryEntry",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "type": "object",
      "required": ["id", "kind", "apiVersion", "createdAt", "taskId"],
      "properties": {
        "id":         { "type": "string", "pattern": "^rh-[0-9]+$" },
        "kind":       { "const": "ReviewHistoryEntry" },
        "apiVersion": { "const": "core.ois/v1" },
        "createdAt":  { "type": "string", "format": "date-time" },
        "taskId":     {
          "type": "string",
          "pattern": "^task-[0-9]+$",
          "description": "Engineer OQ11 concur: FK pointer identity-shape; sibling of cluster-2 Task.metadata.turnId precedent. idea-151 Relationship-kind extraction candidate post-cutover (`{from: rh-N, to: task-M, edgeType: \"reviews\"}`)."
        }
      }
    },
    "spec-schema": {
      "type": "object",
      "required": ["assessment"],
      "properties": {
        "assessment": { "type": "string", "description": "Declared substantive content; review assessment body." }
      }
    },
    "status-schema": {
      "type": "object",
      "required": ["phase"],
      "properties": {
        "phase": { "const": "logged" }
      }
    },
    "filterable-fields": [
      { "shorthand": "phase",  "path": "status.phase" },
      { "shorthand": "taskId", "path": "metadata.taskId" }
    ]
  }
}
```

**Partition rationale (ReviewHistoryEntry):**
- All 3 OQ11-13 dispositions concur with v0.1.
- `taskId` → metadata (engineer OQ11 concur — FK-pointer identity-shape; cluster-2 turnId precedent).
- `name` OMITTED (engineer OQ12 concur — content-classified; substantive in spec.assessment).
- `assessment` → spec.
- idea-151 inline FK preserved at cluster-5 cutover; follow-on Mission extracts to Relationship-kind edges (engineer OQ13 concur).
- 50 prod entries migration preserves rh-N id pattern.

---

### §2.5 ThreadHistoryEntry — partition (v0.2 fill per engineer concur on OQ14-17)

**Existing flat shape** (verified via production psql at 2026-05-23):
- `id` (pattern: `th-N`; counter-allocated; 50 entries in prod)
- `title` (string — thread title at archive time; FROZEN at archive moment)
- `outcome` (string — substantive content; thread outcome summary)
- `threadId` (FK ref to original Thread; immutable substrate-pointer)
- `timestamp` (ISO-8601)

**Partition:**

```json
{
  "name": "ThreadHistoryEntry",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "type": "object",
      "required": ["id", "kind", "apiVersion", "createdAt", "threadId"],
      "properties": {
        "id":         { "type": "string", "pattern": "^th-[0-9]+$" },
        "kind":       { "const": "ThreadHistoryEntry" },
        "apiVersion": { "const": "core.ois/v1" },
        "createdAt":  { "type": "string", "format": "date-time" },
        "threadId":   {
          "type": "string",
          "pattern": "^thread-[0-9]+$",
          "description": "Engineer OQ17 disposition: identity-shape FK pointer; sibling of ReviewHistoryEntry.taskId. idea-151 Relationship-kind extraction candidate (`{from: th-N, to: thread-M, edgeType: \"archives\"}`)."
        }
      }
    },
    "spec-schema": {
      "type": "object",
      "required": ["title", "outcome"],
      "properties": {
        "title": {
          "type": "string",
          "description": "Engineer OQ14 concur: title FROZEN at archive moment (sibling of cluster-1 §3.1 sourceThreadSummary cascade-backlink pattern; preserves declared-at-write semantic). cluster-1 Thread used spec.title for live entity; ThreadHistoryEntry inherits symmetry."
        },
        "outcome": {
          "type": "string",
          "description": "Declared substantive content; thread outcome summary; markdown body."
        }
      }
    },
    "status-schema": {
      "type": "object",
      "required": ["phase"],
      "properties": {
        "phase": { "const": "logged" }
      }
    },
    "filterable-fields": [
      { "shorthand": "phase",    "path": "status.phase" },
      { "shorthand": "threadId", "path": "metadata.threadId" }
    ]
  }
}
```

**Partition rationale (ThreadHistoryEntry):**
- All 4 OQ14-17 dispositions concur with v0.1.
- `title` → spec (engineer OQ14 concur — FROZEN at archive-time; preserves cluster-1 Thread.spec.title symmetry; sibling of sourceThreadSummary cascade-backlink frozen-narrative pattern).
- `name` OMITTED (engineer OQ15 concur — Thread parent-kind used spec.title not metadata.name; symmetry preserves content-classified disposition).
- `outcome` → spec (declared substantive content).
- `threadId` → metadata (FK-pointer identity-shape; sibling of ReviewHistoryEntry.taskId).
- W1.1 NEW kind substrate-currency confirmed (engineer OQ16 — 50 prod entries via psql is dispositive evidence post-W4.x cutover).
- idea-151 inline FK preserved at cluster-5 cutover (engineer OQ17 concur).

---

## §3 Composition checkpoints

### §3.1 mission-83 W1.1 OQ7 4-kind decomposition + Document architect-VERIFIED

All 5 cluster-5 kinds are substrate-mediated post mission-83 W4.x cutover (NEW kinds added at W2/W4 per Design v1.1). Cluster-5 envelope partition adds K8s envelope shape; substrate write-boundaries unchanged. Document distinguished from `wisdom/` static-asset carve-out (per Design v1.1 §3.4.4).

### §3.2 idea-200 (M-Thread-Substrate-Carve-Out) — NOT applicable to cluster-5

Cluster-5 kinds don't carry inline arrays of child entities; idea-200 W2 carve-out targets only cluster-1 Thread.status.messages. No composition impact.

### §3.3 idea-121 (M-API-v2.0) — `get_resource_shape` consumer

Cluster-5 SchemaDef partition feeds idea-121 projection layer (same pattern as clusters 1-4).

### §3.4 idea-151 (M-Graph-Relationships) — FK pointers preserved inline

`ReviewHistoryEntry.metadata.taskId` + `ThreadHistoryEntry.metadata.threadId` are inline FK pointers; idea-151 Relationship-kind extraction post-cutover. Same disposition as cluster-2 Task.dependsOn / cluster-3 Tele.supersededBy.

### §3.5 idea-315 (M-PR-Synchronize-Handler) — coordination methodology

Cluster-5 v0.2 push will continue to exercise the refined memory rule (explicit `create_message` ping post-push) until idea-315 substrate-fix lands.

### §3.6 bug-118 (substrate-wide bug-lineage gap) — not applicable

Cluster-5 kinds are not cascade-spawn-shaped (these are append-only logs; not entities filed via thread-convergence). No cascade-backlink metadata fields per current cluster.

### §3.7 idea-126 Phase 4 Design completion

**Cluster-5 cutover completes idea-126 Phase 4 Design.** Post-cluster-5 merge, all 21 substrate-mediated kinds carry K8s envelope shape uniformly. Phase 5 Manifest + Phase 6 Implementation + Phase 7 Release-gate sequence for idea-126 substrate-cutover work follows post Phase 4 completion.

---

## §4 Acceptance criteria (cluster-5-specific)

- All 5 cluster-5 kinds carry valid envelope structure post-cutover (verified via psql JSON-shape inspection per kind)
- Each kind's `apiVersion: "core.ois/v1"`
- Strict K8s partition (no top-level fields beyond `{id, name, kind, apiVersion, metadata, spec, status}`; `name` per-kind per OQ-dispositions)
- `FilterableField.path` declarations per-kind enable shorthand-filter translation at `list_*` runtime
- **All append-only semantic preserved** — no update paths required for ArchitectDecision / DirectorHistoryEntry / ReviewHistoryEntry / ThreadHistoryEntry; Document may support content updates (engineer OQ4)
- **Field path moves preserved 1:1** in migration:
  - `timestamp` → `metadata.createdAt` (uniformity)
  - FK pointers (taskId, threadId) → metadata.*
  - Substantive content (decision/context/text/assessment/outcome/content) → spec.*
  - All kinds get `status.phase` constant (`"logged"` for append-only or `"active"` for Document per OQ3)
- **Document.name migration** populated from id where currently null (engineer OQ1 migration TODO)
- **No new methodology patterns introduced** — cluster-5 is pure pattern-consolidation (all six cumulative patterns + four sub-disciplines reused; cluster-5 introduces zero new envelope-shape concepts)
- **idea-126 Phase 4 Design completes at cluster-5 merge** — 21 substrate-mediated kinds carry K8s envelope shape uniformly

---

## §5 Cumulative-pattern reuse + cluster-5 conclusion

Cluster-5 inherits all six cumulative patterns + four sub-disciplines:

| Pattern | Cluster-5 use |
|---|---|
| 1. metadata.name (handle vs content) | Document USED (handle-classified); ArchitectDecision / DirectorHistoryEntry / ReviewHistoryEntry / ThreadHistoryEntry OMIT (content-classified) |
| 2. Declared-with-controlled-mutation | NOT used (cluster-5 kinds have no controlled-mutation spec fields) |
| 3. Derived-scalar-field | NOT used (no derived scalars per kind) |
| 4. Default-to-status for FSM-mutated | NOT used (no FSMs; constant `status.phase`) |
| 5. Virtual-view exclusion | NOT used (no virtual views per kind) |
| **6. Routing-intent (spec.labels) vs content-classification (metadata.labels) axis** | **✓ USED — Document.metadata.labels.category per engineer OQ2 substantive deviation. First cluster-5 use; demonstrates the axis for content-classification (Pod.metadata.labels K8s precedent).** |
| §1.5 handle vs content sub-discipline | ✓ used (Document handle; 4 others content) |
| §1.6 multi-FSM-in-status sub-discipline | NOT used (no FSMs) |
| §1.7 field-name collision rename | NOT used (no collisions) |
| Append-only-constant `status.phase` (cluster-3 Counter + cluster-4 Audit precedent) | ✓ used (5 of 5 kinds; Document `"active"` non-append-only; 4 *HistoryEntry kinds `"logged"` append-only) |

**Cluster-5 introduces ZERO new envelope-methodology patterns.** Final cluster is pure pattern-consolidation; all envelope shape uses pre-established patterns. **This is the methodology-stability signal that idea-126 envelope shape is converged.**

**v2.1 methodology candidates from cluster-5:** none introduced at v0.1; engineer review surfaced no NEW candidates at v0.2 (substantive arc reflection added at §6.1 but doesn't generate new v2.1 candidates — total stays A-R = 18 candidates carried from cluster-4 final state).

---

## §6 Status

**v0.3** — substrate-truth ratified per thread-647 bilateral convergence (2026-05-24). §0-§5 partition tables consumed by W5 KindMigrationModule modules. **Cluster-5 ratification gate cleared. ALL 5 OF 5 CLUSTER WAVES IMPLEMENTED.**

**v0.2 → v0.3 substrate-currency-ratification record:**

Engineer-proactive Q2 verify-before-bake applied UPFRONT at thread-647 R1 (**5 clusters in a row self-prompting**: cluster-2 + cluster-3 + cluster-4 + cluster-5 zero-drift on Design v0.2 vs substrate-current truth). Code-grepped `hub/src/storage-substrate/new-repositories.ts` (consolidated 6-kind repository stubs incl. all 5 cluster-5 kinds) + production-substrate-verified per Design §3.1 (28 ad-N + 200 dh-N + 50 rh-N + 50 th-N + Document entries inspected via psql at Phase 4 closure 2026-05-23).

**ZERO drift across all 5 kinds.** Substrate hasn't shifted since v0.2 authoring; v0.3 ratification is a §6 status flip + record.

**Discipline-maturity capstone (architect framing thread-647 R2):** "5 clusters in a row self-prompting at engineer-proactive R1 verify-before-bake. Discipline mature across ALL 5 cluster-Designs. Calibration cluster fully matured — pattern reliably catches drift + ratifies no-drift + catches architect-spec-recall-drift-at-dispatch (7th catch at W4)."

**Q3 Document.category → metadata.labels.category CONTENT-classification axis FIRST-instance (cluster-3 §5 6th cumulative-pattern materially bilateral):**
- Pre-W5: Agent.spec.labels (Mission-19 routing labels per PodSpec.nodeSelector precedent) was routing-intent FIRST-instance
- Post-W5: Document.metadata.labels.category (K8s ConfigMap metadata.labels precedent) is content-classification FIRST-instance
- **Both sides of the axis articulated + load-bearing across cluster-3 + cluster-5.** Pattern is fully realized per A1 architect-ratified note.

**Q9 bug-118 coverage CLOSED FINAL at 8 kinds across all 5 cluster waves.** ThreadHistoryEntry.threadId is forensic-pointer-to-source-Thread (substrate-pointer for cross-entity lookup) NOT cascade-spawn-provenance (sourceThreadId). Same semantic distinction as cluster-2 Turn.missionIds (virtual-view child-pointer) vs PendingAction.spec.entityRef (declared-target pointer). bug-118 closure is about cascade-spawn provenance specifically. Cluster-5 contributes ZERO new kinds; IN-clause stays at 8 (W1 5 + W2 3). **Coverage closed.**

**Q10 7th cumulative pattern (atomic-primitive-rewrite-with-wave-migration) NOT APPLICABLE for W5.** Engineer-verified per substrate-grep: Document write-path direct `substrate.put("Document", doc)` at `hub/src/storage-substrate/new-repositories.ts:54` (no Counter/RepoEventBridge-style primitive intermediary). All 5 cluster-5 kinds same shape. **Pattern stays at 2 instances** (W3 SubstrateCounter + W4 RepoEventBridge adapter). 7th cumulative pattern is fully articulated; pattern set complete.

**A2 Document.name = legacy.id (file-stem convention):** pre-transform `legacy.name = legacy.id`; for the 5 prod entries id and name carry the same value post-migration (id IS substrate-PK; name IS K8s-handle convention).

**A3 M-SchemaDef-Reconciler-Status-Write-Patch Idea filing (cluster-3 A2 deferred):** architect-disposition at W5 ship-close (composes with W6 cutover + Phase 10 retrospective context). Filing-shape: single Idea (substrate-extension class); composes with idea-317 (M-Multi-Agent-Persistence-Context-Engineering Initiative — also post-mission-88 substrate extension).

**v0.2 history-of-record** — engineer PR #272 v0.1 review integrated. 16 OQ concurs + 1 substantive deviation accepted (OQ2 Document.category → metadata.labels.category per cluster-3 §5 6th cumulative-pattern axis); §2.2/§2.3/§2.4/§2.5 stubs filled to full JSON Schema; §5 matrix updated for OQ2 deviation; §6.1 NEW arc reflection.

**Substantive cluster-5 contributions:**
1. **Final cluster — completes idea-126 Phase 4 Design** at cluster-5 merge (all 21 substrate-mediated kinds carry K8s envelope shape uniformly)
2. **Pure pattern-consolidation** — zero new methodology surfaces; convergence-signal that envelope methodology has stabilized
3. **Substrate-currency grounded at v0.1** — all 5 kind partitions verified against production substrate (28 ArchitectDecision + 200 DirectorHistoryEntry + 50 ReviewHistoryEntry + 50 ThreadHistoryEntry + 5 Document entries inspected via psql). v2.1 candidate R substrate-currency discipline applied PRE-emptively at v0.1 (vs cluster-4 post-hoc correction).
4. **Document is the cluster-5 demonstration of cluster-3 §5 6th cumulative-pattern axis** (content-classification → metadata.labels) per OQ2 substantive deviation accepted from engineer.

---

## §6.1 idea-126 Phase 4 Design — 5-cluster arc reflection (per engineer cross-cutting observation #3)

**What shipped methodologically across clusters 1-5:**

| Surface | Origin cluster | Substance |
|---|---|---|
| 6 cumulative envelope patterns | clusters 1-3 | (1) metadata.name handle vs content · (2) declared-with-controlled-mutation · (3) derived-scalar-field · (4) default-to-status for FSM-mutated · (5) virtual-view envelope-exclusion · (6) routing-intent vs content-classification axis |
| 4 K8s-convention sub-disciplines | clusters 2-4 | §1.5 handle-classified vs content-classified · §1.6 multi-FSM-in-status · §1.7 field-name collision with envelope `kind` · append-only-constant `status.phase` |
| K8s precedent anchors (load-bearing) | clusters 2-5 | PodSpec.nodeName · LeaseSpec.acquireTime · ConfigMap.data · CustomResourceDefinition.status.conditions · metadata.deletionTimestamp · Pod.metadata.labels · CRD.metadata.name (kind-name) · Pod.status.conditions[] (multi-FSM) |
| Substrate-inventory shift | cluster-4 | 22 → 21 kinds (Notification removed per engineer code-trace evidence; substrate-currency catch) |
| v2.1 methodology candidates surfaced | clusters 1-4 | P (memory rule scope-refinement for W2 PR-push gap) · Q (lift cluster-3 §5 6th pattern to top-level rule) · R (substrate-currency discipline on inventory-locked SSOT) |

**Statistics:**
- 5 clusters × ~10 OQs each = **~50 substantive partition decisions** disposed bilaterally
- **Zero substrate regressions** — all production-substrate-shapes verified pre-partition (cluster-5 applied at v0.1; clusters 1-4 verified by engineer code-trace at review)
- **All 6 PRs cluster-1-thru-cluster-5 used PR-direct review flow** — no coord threads opened; refined memory rule exercised end-to-end (clusters 3/4/5 v0.2 explicit `create_message` ping pattern)

**Convergence-signal:** cluster-5 introduces ZERO new envelope-methodology patterns. The 6 cumulative patterns + 4 sub-disciplines from clusters 1-4 sufficed for cluster-5 partition (Document.metadata.labels.category exercises pattern #6 first-use; all other cluster-5 partitions use established patterns). This is the methodology-stability signal that **idea-126 envelope shape is well-formed**.

**Phase 5+ carry-forward:**
- SchemaDef cluster-1-thru-5 declarations feed idea-121 projection layer
- idea-151 Relationship-kind extraction targets: Task.dependsOn / Turn.tele / Tele.supersededBy / ReviewHistoryEntry.taskId / ThreadHistoryEntry.threadId (5 inline FK patterns flagged across clusters)
- idea-200 W2 Thread.status.messages carve-out: cluster-4 Message envelope IS the substrate target
- idea-315 substrate-build (M-PR-Synchronize-Handler): closes W2 PR-push gap; methodology-bridge in place until idea-315 lands

---

**Coordination plan:**
- v0.2 push includes explicit `create_message` ping per refined memory rule (cluster-5 continues to exercise post-push surfacing)
- v0.2 approval converges cluster-5 Design; merge completes idea-126 Phase 4 Design

**v0.1 → v0.2 disposition summary:**
- OQ1 ✓ Document.name populate-from-id at cutover
- **OQ2 — substantive deviation accepted: Document.category → metadata.labels.category** (cluster-3 §5 6th cumulative-pattern axis; K8s Pod.metadata.labels precedent)
- OQ3 ✓ Document.status.phase "active" constant
- OQ4 ✓ Document mutable post-create
- OQ5-7 ✓ ArchitectDecision dispositions
- OQ8-10 ✓ DirectorHistoryEntry dispositions
- OQ11-13 ✓ ReviewHistoryEntry dispositions
- OQ14-17 ✓ ThreadHistoryEntry dispositions

**Next architect action post-approval:** Phase 5 Manifest for idea-126 substrate-cutover work — translates 5-cluster Design partition into per-kind migration scripts + SchemaDef writes + acceptance test scenarios. **idea-126 Phase 4 Design CLOSES at cluster-5 merge.**
