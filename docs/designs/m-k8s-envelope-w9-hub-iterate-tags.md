# m-k8s-envelope-w9-hub-iterate-tags-design

**Mission:** mission-88 M-K8s-Envelope Wave W9 — substrate-hardening pre-W11-re-cutover
**Status:** v0.1 WORKING DRAFT
**Anchor:** bug-125 (Hub list-handler tags-iteration crash; major)
**Author:** architect (lily) driving via PR-direct (thread-reply blocked per bug-126/127)
**Director-ratification:** (D) TOLERANT-bridge + W7-W10 + W11 clean re-cutover (ratified 2026-05-24)

---

## 1. Problem

Post mission-88 W6 cutover Phase B, Hub-side list-handlers crash with `idea.tags is not iterable` / `bug.tags is not iterable` errors when iterating mixed-shape entity sets.

**Symptom-impact during incident response (2026-05-24):**
- `list_missions` → `'idea.tags is not iterable'` (transitive via list_missions's downstream Idea hydration)
- `list_ideas` → `'idea.tags is not iterable'`
- `list_bugs` → `'bug.tags is not iterable'`
- `get_pending_actions` → `'bug.tags is not iterable'` (transitive)
- `get_thread`, `get_bug`, `list_threads` work (single-entity reads where the queried entity has valid tags)

This wedged the architect's entity-read tool surface during the most critical incident-response window. Architect had to fall back to direct MCP curl bypass for read-tools — and even that couldn't be used for write-tools per bug-126 + bug-127 composition.

## 2. Root cause (grep-verified)

Exactly 4 call-sites in Hub source assume `entity.tags` is present and array-shaped:

| file:line | code | risk |
|---|---|---|
| `hub/src/entities/idea-repository-substrate.ts:36` | `tags: [...idea.tags],` | spread crashes when undefined |
| `hub/src/entities/idea-repository-substrate.ts:105` | `if (updates.tags) idea.tags = updates.tags;` | guard pattern — safe |
| `hub/src/entities/bug-repository-substrate.ts:43` | `tags: [...bug.tags],` | spread crashes when undefined |
| `hub/src/entities/bug-repository-substrate.ts:138` | `if (!bug.tags.some(t => tagSet.has(t))) return false;` | `.some()` on undefined → TypeError |

**Why `entity.tags` is undefined post-cutover:** the cluster-1 Idea/Bug envelope migration transforms `tags[] → metadata.labels{}` (see `hub/src/storage-substrate/migrations/v2-envelope/kinds/Idea.ts:6` + `hub/src/storage-substrate/migrations/v2-envelope/kinds/Bug.ts:6` — K8s-convention array-to-map transformation).

Post-migration:
- envelope-Idea: `metadata.labels = { "mission-83": "", "schema-validation-gap": "" }` (the tags became K8s-style label keys)
- envelope-Idea: NO `tags` field at top-level

But the repository code at `idea-repository-substrate.ts:36` still reads `idea.tags` from the entity-as-it-leaves-the-substrate. The TOLERANT-mode read-layer evidently DOES NOT reconstruct `tags[]` from `metadata.labels{}` when serving envelope-shape rows back through the legacy-shape repository interface.

**This is the gap:** TOLERANT mode tolerates writes in either shape but the READ-path normalization is incomplete — the repository layer was built against legacy shape and doesn't see the migrated entities.

## 3. Architectural decision

### (α) Add shape-defensive coercion at the 4 call-sites (immediate fix)

Replace:
```typescript
tags: [...idea.tags]
```
with:
```typescript
tags: tagsFromEntity(idea)
```

Where:
```typescript
// hub/src/entities/shape-helpers.ts
export function tagsFromEntity(entity: any): string[] {
  // legacy-shape: tags at top-level
  if (Array.isArray(entity.tags)) return [...entity.tags];
  // envelope-shape: tags moved to metadata.labels keys
  if (entity.metadata?.labels && typeof entity.metadata.labels === 'object') {
    return Object.keys(entity.metadata.labels);
  }
  // missing: default to empty (was historically present-but-empty array)
  return [];
}
```

**Pros:** surgical; preserves repository interface; handles both shapes; no breaking changes downstream.

**Cons:** lossy round-trip (labels-map → tags-array drops the value side; labels {"foo":"bar"} → tags ["foo"] forgets "bar"). Acceptable because pre-cluster-1 tags-as-array model didn't have values either.

### (β) Repository layer envelope-native rewrite (long-term correct)

Rewrite Idea/Bug/Task/etc. repositories to read envelope-shape natively (read `metadata.labels` directly, no array reconstruction).

**Pros:** removes legacy-shape-coupling from repository code; aligns with target end-state post-mission-88 (pure envelope; W11 strict-flip).

**Cons:** substantial scope (each repository file rewrite; all callers updated to use map-shape instead of array-shape); breaks API for any external consumers of Idea/Bug shape; out of W7-W10 timebox.

### (γ) Substrate-layer TOLERANT-mode read normalization

Extend the substrate's TOLERANT-mode read-path to reconstruct legacy-shape from envelope-shape on read. I.e., when SUBSTRATE_ENVELOPE_TOLERANT=true and reader expects legacy, normalize envelope-shape rows to legacy-shape before serving.

**Pros:** centralized fix; all repositories benefit; pattern composes with W7 index migration.

**Cons:** more complex than per-call-site fix; risks lossy normalization at substrate boundary (where it's hardest to debug); requires per-kind normalization rules (not just tags — every cluster-1 transform that moved fields).

### Recommendation: (α) for W7-W10 timebox; (β) as post-mission-88 idea; (γ) as alternative

(α) is the **minimum required to unblock architect comms** during the W7-W10 window AND through W11 cutover (when production is still mid-migration even if mostly envelope).

(β) is the **correct end-state** but doesn't fit the timebox; file as M-Repository-Envelope-Native-Rewrite idea post-W11.

(γ) trades implementation complexity for centralization — Phase 4 Design-pass may surface preference for (γ) over (α) if engineer audit shows the substrate-layer is the cleaner intervention point. Lean (α) for speed-to-comms-restoration.

## 4. Audit for further `*.tags` access patterns

The grep surfaces only 4 call-sites. But the bug surfaced 4 visible-error endpoints (list_missions, list_ideas, list_bugs, get_pending_actions). list_missions and get_pending_actions don't directly access `.tags` — they hydrate Idea/Bug rows downstream, triggering the bug at line 36/43.

**Engineer-side audit:** grep all consumers of `IdeaRepositorySubstrate.list()` / `BugRepositorySubstrate.list()` / `find()` / `get()` to enumerate the visible-impact surface. Confirm the (α) fix covers them all.

**Cross-kind extension:** are there sibling `*.tags` patterns for Mission/Task/Document/Tele/Audit/Notification kinds? grep for `kind-name.tags` (lowercase) in repository files:

```bash
grep -rn '\(idea\|bug\|mission\|task\|document\|tele\|audit\|notification\|proposal\|thread\|turn\|agent\)\.tags' hub/src
```

Each affected kind needs the same `tagsFromEntity()` coercion at its repository spread/iterate sites.

## 5. Test plan

### 5.1 Unit tests (per kind)

For each affected kind (Idea, Bug, then audit-surfaced others):
- `tagsFromEntity(legacyShape)` returns the legacy tags array
- `tagsFromEntity(envelopeShape)` returns Object.keys(metadata.labels) array
- `tagsFromEntity({})` returns [] (missing both → safe default)
- Spread + `.some()` test: `[...tagsFromEntity(envelopeShape)].length` matches expected
- `tagsFromEntity({metadata: {labels: null}})` returns [] (null-labels defensive)

### 5.2 Integration test (list-handler smoke)

With seeded mixed-shape DB (487 legacy-Idea + 813 envelope-Idea sample):
- `list_ideas()` returns 1300 rows without crash
- All 1300 have correctly-coerced tags arrays
- `list_bugs()` same
- `list_missions()` (transitive) same
- `get_pending_actions()` same

### 5.3 Regression-guard

Lock the contract: tagsFromEntity must never throw on any input (defensive at boundary). Property-based test with arbitrary entity shapes.

### 5.4 End-to-end repro

The exact failure repro from 2026-05-24 incident:
```bash
# pre-fix: this crashes via curl bypass
curl ... '{"method":"tools/call","params":{"name":"list_ideas","arguments":{}}}'
# Expected pre-fix: {"isError":true, "content":[{"text":"idea.tags is not iterable"}]}

# post-fix: this returns 318 Ideas successfully
# Expected post-fix: {"isError":false, "content":[{"text":"{\"ideas\":[...318 rows...]}"}]}
```

## 6. Architect-asks (Design-pass round)

1. **(α) vs (γ) preference** — engineer-side judgment on whether substrate-layer normalization (γ) is the cleaner intervention point. If yes, (γ) becomes W9 scope; (α) becomes an interim hot-fix while (γ) lands.

2. **Lossy round-trip acceptability** — `tags["foo","bar"] → labels{foo:"", bar:""} → tags["foo","bar"]` works. But `labels{foo:"v1", bar:"v2"}` (post-cluster-1, labels-as-K8s-map-with-values) → `tags["foo","bar"]` drops the values. Confirm acceptable for the (α) fast-path; if not, (β) repository rewrite becomes mandatory not optional.

3. **Cross-kind audit timing** — does engineer want to surface cross-kind grep results as TBD-bugs (sibling to bug-125) or fold into single W9 scope? Lean: fold into single W9 PR for atomicity.

4. **TOLERANT-mode interaction** — when W11 strict-flip lands (SUBSTRATE_ENVELOPE_TOLERANT=false), the (α) fix's legacy-shape branch becomes dead code. Add dead-code-cleanup as post-W11 Idea, or strip in W11 PR itself?

## 7. Composition

- **W7 (bug-123)** — Notification of fix lands together; W9 doesn't need W7 sequencing, but they both touch substrate-storage code path. Coordinate via shared PR-review for SchemaDef-reconciler diff overlap.
- **W8 (bug-124)** — Notification has no `tags` field in production shape; W9 grep extension covers Notification trivially.
- **W10 (bug-126)** — W10 is adapter-side; W9 is Hub-side. Independent fixes, independent verification, but BOTH must land before W11 for architect comms to work end-to-end (W9 fixes the "list returns crash" Hub-side; W10 fixes the "shim hangs on the crash response" adapter-side).
- **W10-ext (bug-127)** — W10-ext is Hub-side M18 OCC; orthogonal to W9.

## 8. Acceptance criteria

- 4 known call-sites coerced via `tagsFromEntity()` helper
- Cross-kind audit grep surfaces zero additional bugs (or files them as sibling bugs)
- All 4 visible-failure endpoints (`list_ideas`, `list_bugs`, `list_missions`, `get_pending_actions`) return 200 on mixed-shape state
- Unit + integration + regression tests all green
- Architect smoke-test: `curl ... list_bugs` post-fix returns the 127 anchor bugs without crash

## 9. Out of scope (deferred)

- (β) Repository envelope-native rewrite — file as M-Repository-Envelope-Native-Rewrite idea post-W11
- (γ) Substrate-layer TOLERANT-mode read normalization — Phase 4 Design-pass may upgrade scope, otherwise defer with (β)
- Dead-code cleanup of legacy-shape branch post-strict-flip — file as post-W11 cleanup task

## 10. Links

- **bug-125** (major; architect-comms-blocker; mission-88 W9 anchor)
- **mission-88** (active)
- Sibling waves: W7 #284, W8 #285, W10 pending, W10-ext pending
- File references: `hub/src/entities/idea-repository-substrate.ts:36`, `hub/src/entities/bug-repository-substrate.ts:43`, `hub/src/entities/bug-repository-substrate.ts:138`, `hub/src/entities/idea-repository-substrate.ts:105` (guard-pattern, no fix needed)
- Migration source-of-truth: `hub/src/storage-substrate/migrations/v2-envelope/kinds/Idea.ts:6` + `Bug.ts:6` (documents the `tags[] → metadata.labels{}` transformation)
