# M-K8s-Envelope — Cluster 5 Content-Archive Partition (Design Working Draft)

**Status:** v0.1 — architect-fronted; awaiting engineer review
**Mission:** idea-126 (M-K8s-Envelope)
**Phase:** Phase 4 Design — cluster-5 partition pass (**5 of 5 clusters — FINAL CLUSTER**)
**Coordination:** per-PR review (per refined `feedback_pr_opened_notification_is_review_signal` memory rule v2). v0.1 review via `pr_opened_bilateral`; v0.2 fold-in commit gets explicit `create_message` ping until idea-315 substrate-build lands.
**Date:** 2026-05-23 AEST
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
          "type": ["string", "null"],
          "description": "Engineer OQ1 — handle-classified per §1.5 cluster-2 — Document IS a handle-shaped kind (file-name is the natural handle). But production sample shows `name: null`; entity-kinds.json says 'name-derived from <name>.md'. v0.1 disposition: USE `metadata.name` = file-stem (e.g., 'policy-network-v1-draft'); migration script populates from id (since id IS the file-stem today). Engineer audit at v0.2."
        }
      }
    },
    "spec-schema": {
      "type": "object",
      "required": ["category", "content"],
      "properties": {
        "category": {
          "enum": ["architecture", "planning", "specs"],
          "description": "Declared categorization. K8s precedent: ConfigMap labels for category-axis classification (but Document.category is enum-typed; metadata.labels would be more open). v0.1 picks spec.category (declared categorization at write-time); engineer audit at OQ2."
        },
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
      { "shorthand": "category", "path": "spec.category" }
    ]
  }
}
```

**Partition rationale (Document) — v0.1:**
- **`id` → metadata.id** — free-form name-derived identifier; substrate-id-as-PK preserved.
- **`name` → `metadata.name`** — handle-classified per §1.5 cluster-2; Document IS file-name-shaped handle. **Migration TODO**: production `name: null`; populate from id at cutover (file-stem). Engineer OQ1 — confirm migration disposition.
- **`category` → spec** — declared categorization; immutable post-create. OQ2 — engineer audit metadata.labels (map; cross-kind uniformity) vs spec.category (declared enum; v0.1 lean).
- **`content` → spec** — markdown body; substantive declared content; sibling of cluster-2 Turn.spec.scope / cluster-1 Mission.spec.goal.
- **`status.phase: "active"` constant** — no FSM; uniformity convention sibling of cluster-3 Counter + cluster-4 Audit `"logged"` pattern. *Note: chose "active" over "logged" because Document is mostly-static content (not append-only-log shape); engineer audit at OQ3.*
- **`createdAt`/`updatedAt` → metadata** — uniformity (cluster-1 §3.1 pattern); Document MAY mutate post-create (content updates) unlike pure append-only logs.
- **`name` USED** — Document is handle-classified per §1.5 (file-name handle; substantive content in spec.content).

**Field renames visible post-cutover (Document):**
- `Document.id` → `Document.metadata.id` (preserved)
- `Document.name` → `Document.metadata.name` (populated from id where currently null — engineer OQ1 migration TODO)
- `Document.category` → `Document.spec.category`
- `Document.content` → `Document.spec.content`
- NEW: `Document.status.phase: "active"` constant

**Open questions (Document) — engineer audit:**
- **OQ1**: `metadata.name` migration — production sample has `name: null`. Disposition options: (a) populate from id at cutover (file-stem; e.g., "policy-network-v1-draft") — v0.1 lean; (b) leave null and depend on metadata.id for handle — but breaks §1.5 handle-classified discipline. v0.1 picks (a); engineer disposition welcome.
- **OQ2**: `category` placement — spec.category (declared enum) vs metadata.labels (map; cross-kind uniformity for content-tagging). K8s precedent for category-enum is mixed — Pod uses metadata.labels for everything; ConfigMap uses no separate category. v0.1 picks spec.category (small fixed enum; not free-form labels). Engineer audit.
- **OQ3**: `status.phase` constant value — `"active"` (Document mostly-static; may mutate post-create) vs `"logged"` (treats Document as append-only-log). v0.1 picks `"active"` (sibling of cluster-3 Counter); engineer disposition welcome. Affects whether Document is in "content-archive" class (logged) or "metadata/config" class (active).
- **OQ4**: Is Document append-only post-cutover, or does it support content updates? Production sample is 5 entries; reasonable to expect markdown content updates (architecture docs evolve). v0.1 assumes updatable (`status.phase: "active"`); engineer audit for write-boundary policy.

**Composition checkpoints:**
- **wisdom/ static-asset carve-out** per mission-83 v1.1 §3.4.4 — `local-state/architect-context/wisdom/` markdown reference docs are NOT Hub-runtime state; they're 4th out-of-substrate location. Distinct from Document (which IS Hub-runtime state in substrate).
- **mission-83 W1.1 architect-VERIFIED** — Document entity-semantic content distinguished from static-asset carve-out.

---

### §2.2 ArchitectDecision — stub (v0.1)

**Existing flat shape** (verified via production psql at 2026-05-23):
- `id` (pattern: `ad-N`; counter-allocated; 28 entries in prod)
- `context` (string — substantive content)
- `decision` (string — substantive content)
- `timestamp` (ISO-8601)

**Stub partition (v0.1):**

| Field | Section | Rationale |
|---|---|---|
| `id` (`ad-N`) | metadata.id | identity (counter-allocated; create-time idempotency) |
| `kind`, `apiVersion` | metadata | uniform |
| `timestamp` | metadata.createdAt | uniformity rename (sibling of cluster-4 Audit) — append-only entry; createdAt IS the timestamp |
| `decision` | spec.decision | declared substantive content (the decision itself) |
| `context` | spec.context | declared substantive content (what informed the decision) |
| `phase` (constant `"logged"`) | status.phase | append-only-log uniformity per cluster-4 Audit precedent |

**Open questions (ArchitectDecision) — engineer audit:**
- **OQ5**: `name` OMITTED for ArchitectDecision (content-classified per §1.5; substantive content in spec.decision; no separate handle). Confirm.
- **OQ6**: `status.phase: "logged"` constant per cluster-4 Audit precedent. Confirm (no FSM; immutable post-create).
- **OQ7**: Migration of historical entries — production has 28 entries; ensure migration preserves `ad-N` id pattern + timestamp ordering. No new substrate work needed (kind already substrate-mediated post mission-83 W4.x).

**Composition checkpoints:**
- mission-83 W1.1 OQ7 4-kind decomposition; ArchitectDecision already substrate-mediated; cluster-5 adds envelope shape.
- Append-only semantic preserved (no update paths in repository).

---

### §2.3 DirectorHistoryEntry — stub (v0.1)

**Existing flat shape** (verified via production psql at 2026-05-23):
- `id` (pattern: `dh-N`; counter-allocated; 200 entries in prod)
- `role` (enum: `user | model` — LLM chat archive shape)
- `text` (string — substantive content; Director chat message body)
- `timestamp` (ISO-8601)

**Stub partition (v0.1):**

| Field | Section | Rationale |
|---|---|---|
| `id` (`dh-N`) | metadata.id | identity |
| `kind`, `apiVersion` | metadata | uniform |
| `timestamp` | metadata.createdAt | uniformity rename |
| `role` | spec.role | declared LLM-conversation role; immutable post-create |
| `text` | spec.text | declared substantive content (chat message body) |
| `phase` (constant `"logged"`) | status.phase | append-only-log uniformity |

**Open questions (DirectorHistoryEntry) — engineer audit:**
- **OQ8**: `role` placement — `spec.role` (declared LLM-context role at log-time) vs `metadata.role` (identity-shape; sibling of `metadata.createdBy.role`). v0.1 picks spec.role (declared chat-conversation role; LLM Director-chat semantic; distinct from agent role). Engineer disposition welcome.
- **OQ9**: `name` OMITTED for DirectorHistoryEntry (content-classified). Confirm.
- **OQ10**: `text` placement matches cluster-4 Audit.spec.details / cluster-2 Turn.spec.scope pattern (declared markdown-or-substantive content in spec).

---

### §2.4 ReviewHistoryEntry — stub (v0.1)

**Existing flat shape** (verified via production psql at 2026-05-23):
- `id` (pattern: `rh-N`; counter-allocated; 50 entries in prod)
- `taskId` (FK ref to Task)
- `timestamp` (ISO-8601)
- `assessment` (string — substantive content; review assessment body)

**Stub partition (v0.1):**

| Field | Section | Rationale |
|---|---|---|
| `id` (`rh-N`) | metadata.id | identity |
| `kind`, `apiVersion` | metadata | uniform |
| `timestamp` | metadata.createdAt | uniformity rename |
| `taskId` | metadata.taskId | identity-shape FK pointer (cluster-2 Task.metadata.turnId precedent); declared at log-time; idea-151 Relationship-kind candidate post-cutover |
| `assessment` | spec.assessment | declared substantive content (review body) |
| `phase` (constant `"logged"`) | status.phase | append-only-log uniformity |

**Open questions (ReviewHistoryEntry) — engineer audit:**
- **OQ11**: `taskId` placement — metadata.taskId (FK pointer; identity-shape; sibling of cluster-2 Task.metadata.turnId) vs spec.taskId (declared review-target at log-time). v0.1 picks metadata.taskId (FK-pointer convention).
- **OQ12**: `name` OMITTED (content-classified). Confirm.
- **OQ13**: idea-151 Relationship-kind candidate — `{from: rh-N, to: task-M, edgeType: "reviews"}` post-cutover; cluster-5 envelope preserves inline FK. Same disposition as cluster-2 Task.dependsOn / cluster-3 Tele.supersededBy.

---

### §2.5 ThreadHistoryEntry — stub (v0.1)

**Existing flat shape** (verified via production psql at 2026-05-23):
- `id` (pattern: `th-N`; counter-allocated; 50 entries in prod)
- `title` (string — thread title at archive time)
- `outcome` (string — substantive content; thread outcome summary)
- `threadId` (FK ref to original Thread; immutable substrate-pointer)
- `timestamp` (ISO-8601)

**Stub partition (v0.1):**

| Field | Section | Rationale |
|---|---|---|
| `id` (`th-N`) | metadata.id | identity |
| `kind`, `apiVersion` | metadata | uniform |
| `timestamp` | metadata.createdAt | uniformity rename |
| `threadId` | metadata.threadId | identity-shape FK pointer (sibling of ReviewHistoryEntry.taskId) |
| `title` | spec.title | declared at archive-time (frozen at moment thread closed); not substantive cognitive content (substantive content is `outcome`) |
| `outcome` | spec.outcome | declared substantive content (thread outcome summary; markdown body) |
| `phase` (constant `"logged"`) | status.phase | append-only-log uniformity |

**Open questions (ThreadHistoryEntry) — engineer audit:**
- **OQ14**: `title` placement — Thread (cluster-1) put title in spec; ThreadHistoryEntry inherits that. **Note**: ThreadHistoryEntry.title is the FROZEN-at-archive-time title (sibling of `sourceThreadSummary` cascade-backlink pattern from cluster-1 §3.1) — substantively different from live Thread.spec.title. v0.1 picks spec.title (preserves declared-at-write semantic). Engineer audit.
- **OQ15**: `name` OMITTED for ThreadHistoryEntry (content-classified). ThreadHistoryEntry IS a handle-shaped kind in one sense (title is a handle) — but cluster-1 Thread used `spec.title` not `metadata.name` for the live entity, so symmetry argues for OMITTED here. Engineer audit at v0.2.
- **OQ16**: ThreadHistoryEntry is the W1.1 NEW kind (architect W1.1 finding; not in mission-83 v1.0 inventory). Verify substrate-currency: 50 prod entries confirms post-W4.x cutover already operational.
- **OQ17**: idea-151 Relationship-kind candidate — `{from: th-N, to: thread-M, edgeType: "archives"}` post-cutover; cluster-5 envelope preserves inline FK.

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
| 6. Routing-intent (spec.labels) vs content-classification (metadata.labels) axis | NOT used (no label-maps on these kinds) |
| §1.5 handle vs content sub-discipline | ✓ used (Document handle; 4 others content) |
| §1.6 multi-FSM-in-status sub-discipline | NOT used (no FSMs) |
| §1.7 field-name collision rename | NOT used (no collisions) |
| Append-only-constant `status.phase` (cluster-3 Counter + cluster-4 Audit precedent) | ✓ used (5 of 5 kinds; Document picks "active" or "logged" per OQ3) |

**Cluster-5 introduces ZERO new envelope-methodology patterns.** Final cluster is pure pattern-consolidation; all envelope shape uses pre-established patterns. This is the methodology-stability signal that idea-126 envelope shape is converged.

**v2.1 methodology candidates from cluster-5 (if any):** none surfaced at v0.1 draft. If engineer review surfaces cross-cutting observations, v0.2 captures them. Total v2.1 candidates after cluster-5: A-R = 18 (unchanged from cluster-4 final state).

---

## §6 Status

**v0.1** — architect-fronted; awaiting engineer review.

**Substantive cluster-5 contributions:**
1. **Final cluster — completes idea-126 Phase 4 Design** (all 21 substrate-mediated kinds carry K8s envelope shape uniformly post-merge)
2. **Pure pattern-consolidation** — zero new methodology surfaces; convergence-signal that envelope methodology has stabilized
3. **Substrate-currency grounded** — all 5 kind partitions verified against production substrate (28 ArchitectDecision + 200 DirectorHistoryEntry + 50 ReviewHistoryEntry + 50 ThreadHistoryEntry + 5 Document entries inspected via psql)

**Coordination plan:**
- PR opens; greg engages via `pr_opened_bilateral` notification + posts review on GitHub directly
- v0.2 fold-in commit preceded by explicit `create_message` ping per refined memory rule
- v0.2 approval converges cluster-5 Design; merge completes idea-126 Phase 4 Design

**Outstanding open questions** (17 OQs):
- OQ1 Document.name migration (populate from id where null)
- OQ2 Document.category placement (spec vs metadata.labels)
- OQ3 Document.status.phase constant value ("active" vs "logged")
- OQ4 Document update-policy (append-only vs mutable content)
- OQ5 ArchitectDecision name OMITTED confirm
- OQ6 ArchitectDecision status.phase "logged" confirm
- OQ7 ArchitectDecision migration preservation
- OQ8 DirectorHistoryEntry.role placement (spec vs metadata)
- OQ9 DirectorHistoryEntry name OMITTED confirm
- OQ10 DirectorHistoryEntry.text placement confirm
- OQ11 ReviewHistoryEntry.taskId placement (metadata FK-pointer)
- OQ12 ReviewHistoryEntry name OMITTED confirm
- OQ13 ReviewHistoryEntry idea-151 relationship-kind disposition
- OQ14 ThreadHistoryEntry.title placement (spec; frozen-at-archive-time)
- OQ15 ThreadHistoryEntry name OMITTED confirm
- OQ16 ThreadHistoryEntry substrate-currency (W1.1 NEW finding; 50 prod entries)
- OQ17 ThreadHistoryEntry idea-151 relationship-kind disposition

**Next architect action post-approval:** Phase 5 Manifest for idea-126 substrate-cutover work — translates 5-cluster Design partition into per-kind migration scripts + SchemaDef writes + acceptance test scenarios. **idea-126 Phase 4 Design CLOSES at cluster-5 merge.**
