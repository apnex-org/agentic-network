# M-K8s-Envelope — Work Trace (live state)

**Mission scope.** Substrate-wide all-at-once envelope upgrade per Survey 1 (`docs/reviews/2026-05-23-survey-idea-126.md`, Director-ratified A/A/A both rounds). All 20 SchemaDef kinds get `{id, name, kind, apiVersion, metadata, spec, status}` envelope; per-kind JSON Schemas declared upfront; minimal `core.ois/v1` + `ext.ois`-reserved namespacing; big-bang cutover via mission-83 W5 pattern; bug-118 fix absorbed.

**Mission anchor:** idea-126 (now `triaged` → `incorporated` post-Mission entity-spawn).
**SR/cartography context:** v3 W1 wire-substrate anchor per cartography v1.1 §6 + SR §7 critical-path.
**How to read + update:** see `docs/methodology/trace-management.md` for live-trace discipline.

**Status legend:** ▶ in-flight  ✅ done this session  ○ queued / filed  ⏸ deferred

---

## Resumption pointer (cold-session brief)

If you're picking up cold, read in this order:

1. **This file.**
2. **Survey-of-record:** `docs/reviews/2026-05-23-survey-idea-126.md` (PR #264; Director-ratified A/A/A).
3. **Cartography + SR context:** `docs/reviews/2026-05-23-threads-v3-cartography.md` v1.1 (§6 W1 wire-substrate) + `docs/reviews/2026-05-23-sr-threads-v3.md` v1.1 (§7 critical-path).
4. **Bilateral Design thread:** thread-634 (architect-engineer Phase 4 Design; correlationId=design-idea-126).
5. **Anti-goals carried forward:** Survey §6 (10 anti-goals) + Design Round 1 additions (5 engineer-side: no historical backfill / no cognitive-surface depth without ergonomic check / additive-only at metadata/spec/status partition until apiVersion bump / no IaC-runtime / operator-DX preserved through cutover). DO NOT re-litigate without explicit Director surface.
6. **Composition surfaces:**
   - bug-118 fix (substrate-wide bug-lineage `metadata.sourceThreadId` capture) — **IN SCOPE** as part of this Mission.
   - idea-121 (M-API-v2.0; `get_resource_shape` interface) — composes at Phase B; this Mission commits to SchemaDef shape only.
   - idea-151 (M-Graph-Relationships) — parallel-trackable W4 work; orthogonal substrate layer.
7. **Current cadence:** Phase 4 Design bilateral; round 1 landed; awaiting architect Round 2 integration of engineer-side dispositions on Q2/Q4/Q5 + 5 additional Design dimensions.

---

## In-flight

▶ **Phase 4 Design — bilateral round in flight.**
- thread-634 round 1 landed (engineer reply 2026-05-23 ~09:00 AEST).
- Engineer dispositions queued for architect integration:
  - **Q1 (per-kind partition strategy):** concur one-pass + batched-review at kinds 5/10/15/20; recommend grouping by structural similarity (substantive-content / queue-FSM / metadata-config / audit-event clusters).
  - **Q2 (migration-script architecture; engineer-fronts):** per-kind modules under `hub/src/storage-substrate/migrations/v2-envelope/kinds/*.ts` with central registry runner + shared utilities (`metadata-extract`, `provenance`) extracted to `shared/` for unit-test surface.
  - **Q3 (rollback strategy):** (a) forward-only + image-tag-pin rollback + **mandatory pre-cutover dry-run validation** against read-only postgres snapshot.
  - **Q4 (test architecture):** 3-layer (per-kind unit + integration wire-flow + cutover rehearsal e2e); CI-gate blocking.
  - **Q5 (bug-118 composition):** clean fit; `shared/provenance.ts` extracts session-context at write-time; forward-looking only (anti-goal: no historical backfill).
- Engineer-surfaced additional Design dimensions (Q6–Q10):
  - **Q6:** `apiVersion` evolution discipline (additive-only at partition level → preserve v1; bump v2 only for non-additive).
  - **Q7:** Filter-path-naming convention for `list_*` post-cutover (`FilterableField.path` declaration in per-kind SchemaDef).
  - **Q8:** Cognitive-surface fields top-level vs spec (engineer-recommend top-level for ergonomic; per-kind decision at partition pass).
  - **Q9:** `get_resource_shape` interface contract deferred to idea-121 Design; this Mission commits SchemaDef shape only.
  - **Q10:** Operator-DX migration aids (`get-entities.sh` + `psql-cookbook.md` updates) included in cutover scope.

---

## Queued / filed (mission scope)

- ○ **Mission entity spawn** — architect to file Mission entity post-Design-ratification per `mission-lifecycle.md` Phase 5.
- ○ **idea-126 entity transition** — flip `triaged` → `incorporated` with `missionId` set, post-Mission spawn.
- ○ **SchemaDef extension v1.1 → v2.0** (architect-fronts) — `hub/scripts/entity-kinds.json` per-kind partitioning into `metadata` / `spec` / `status` JSON Schemas. All 20 kinds.
- ○ **Migration script** (engineer-fronts) — postgres in-place data migration; per-kind modules + registry; rollback strategy per Q3.
- ○ **Code-path migration** (engineer-fronts) — `hub/src/entities/*-repository-substrate.ts` updated for envelope read/write.
- ○ **Pre-cutover dry-run** (bilateral) — read-only postgres snapshot; envelope-schema validation per kind.
- ○ **3-layer test suite** (engineer-fronts) — per-kind unit + wire-flow integration + cutover rehearsal e2e.
- ○ **Composition checkpoints** (bilateral) — `get_resource_shape` contract w/ idea-121 + `metadata.sourceThreadId` capture w/ bug-118.
- ○ **Cutover plan** (bilateral) — image pre-build window + Hub redeploy + <30s downtime acceptance.
- ○ **Operator-DX updates** (engineer-fronts) — `scripts/local/get-entities.sh` envelope-shape support + `docs/operator/psql-cookbook.md` envelope query examples.

---

## Anti-goals (canonical; carried forward across Design rounds)

**Survey §6 (10 anti-goals):**
1. No K8s controller-runtime / etcd-watch / IaC-runtime machinery; conventions only.
2. No dual-write transition window; big-bang cutover.
3. No group-taxonomy proliferation; `core.ois/v1` + `ext.ois`-reserved minimal namespace.
4. No author-discretion on spec/status partition; convention strictly enforced.
5. No pulling forward beyond Mission scope; ships post-Design-ratification.
6. No K8s-isms beyond shape (no Pod/Deployment/CRD semantics imported).
7. No tool-surface modernization in this Mission (defers to idea-121).
8. No first-class graph relationships in this Mission (defers to idea-151).
9. No automated entity-data validation enforcement at write-boundary beyond schema-shape check.
10. **Bug-118 fix IS in scope** — substrate-wide bug-lineage capture via `metadata.sourceThreadId` envelope field is this Mission's responsibility; not a separate Mission.

**Design Round 1 additions (engineer-side; 5):**
11. No historical entity backfill (forward-looking only per bug-118 / thread-632 anti-goal).
12. No cognitive-surface field depth without ergonomic check (title/description stay top-level on envelope for kinds with substantive cognitive surface).
13. Additive-only changes preserve `core.ois/v1` apiVersion; non-additive changes bump to `core.ois/v2` (apiVersion evolution discipline).
14. No `get_resource_shape` MCP tool in this Mission's scope (defers to idea-121 Design); this Mission commits SchemaDef shape only.
15. Operator-DX (`get-entities.sh` + cookbook) updates IN scope (small additional scope; preserves daily-driver from breaking mid-cutover).

---

## Done this session

✅ **Phase 4 Design Round 1 engineer reply landed** (thread-634, 2026-05-23 ~09:00 AEST). Substantive engagement on architect's 5 starter questions + 5 additional engineer-side dimensions surfaced. Awaiting architect Round 2.

✅ **Work-trace spawned** (this file).

---

## Provenance

- **Mission origin:** idea-126 (Director-proposed 2026-04-21; triaged 2026-05-23 via thread-628 / SR run).
- **Survey 1:** `docs/reviews/2026-05-23-survey-idea-126.md` — Director-ratified A/A/A both rounds; archived via PR #264 (architect-authored).
- **Design dispatch:** thread-634 (correlationId=design-idea-126; architect-spawned 2026-05-23 ~08:58 AEST).
- **SR + cartography lineage:**
  - PR #256 — Threads v3 cartography v1.0 (`0d22d84`)
  - PR #257 — Engineer enrichment companion v1.0 (`c644838`)
  - PR #258 — Substrate-DX A.2 / get-entities.sh remote-mode (`2858d0f`)
  - PR #259 — Engineer enrichment companion v1.1 (`ae44ba3`)
  - PR #260 — Cartography v1.1 in-place fold (merged)
  - PR #261 — strategic-review.md v2.0 (merged)
  - PR #262 — SR v2.0 first Standard-mode run (Threads v3) v1.1 (merged)
  - PR #263 — SR §6 cross-kind generality patch (merged)
  - PR #264 — Survey 1 archive (architect-authored; open)
- **Anchor:** idea-312 (M-Threads-v3 umbrella; W1 wire-substrate program).
