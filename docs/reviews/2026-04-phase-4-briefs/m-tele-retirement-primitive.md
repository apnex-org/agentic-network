# Mission: M-Tele-Retirement-Primitive

**Status:** Pass 4 FINAL — architect-engineer sealed per plan §Phase 4 co-authoring cadence. Architect fields (Name / Tele / Concept-grounding / Goal / Dependencies / Related Concepts-Defects) at `agent/lily:6625c24`; engineer fields (Scope single-task with 5-zombie cleanup / Success criteria refinement / Engineer-flagged scope decisions) folded from `agent/greg:4ff0f6b`. Files as `proposed` on Director final ratification per Phase 4 §10.6.
**Phase 4 pick:** #3 of 4 (S-class; quick-win).

---

## Name

**M-Tele-Retirement-Primitive** (resolves bug-24)

---

## Tele served

| Tele | Role | Why |
|---|---|---|
| tele-2 Isomorphic Specification | primary | Spec includes tele-lifecycle; retirement primitive completes the tele-entity API surface |
| tele-10 Autopoietic Evolution | secondary | Tele set becomes self-refining; future audits can cleanly retire superseded teles |

**Tele-leverage score: 2.**

---

## Concept-grounding (Phase 3 register)

- **Manifest-as-Master (§2.4)** — completes the tele-entity-lifecycle API; without retirement the tele surface has an incomplete CRUD (create-only, no supersede/retire). Post-mission, tele-lifecycle is isomorphic with other entity FSMs.

---

## Goal

Close bug-24 by adding lifecycle primitives (`supersede_tele`, `retire_tele`) to the tele-entity API surface, and clean up the 5 pre-rewrite zombie teles that idea-149's tele-audit left behind. Current state: `create_tele` is the only ratified lifecycle tool; there is no supersession or retirement mechanism. Phase 1 tele-rewrite (idea-149) required `scripts/reset-teles.ts` direct-write workaround which cannot be the general pattern for ongoing tele-audit operations.

**Quick-win rationale:** S-class effort, bounded scope, unblocks idea-149-class future audits, eliminates the Phase 1 Direct-Write Backstop dependency for tele-set evolution, and formally cleans up the 5 zombies while the primitive is fresh.

---

## Scope

Mission ships as a **single-task mission** (engineer-authored):

### Task — Tele lifecycle primitive + 5-zombie cleanup (engineer-S, ~2-3 days)

- **New MCP tool `supersede_tele(superseded_id, successor_id, reason)`** — marks `teleId` as superseded; links to successor tele (if rename/split); `reason` documents rationale. Architect-role only (tele-set modification is Director/architect scope).
- **New MCP tool `retire_tele(teleId, reason)`** — marks `teleId` as retired (no successor); for teles genuinely obsolete without replacement. Architect-role only.
- **Tele entity schema extension** — new field `status: "active" | "superseded" | "retired"`, defaulting to `"active"` for existing + new teles; `supersededBy?: teleId` optional for supersession lineage; `retiredAt?: ISO-8601` optional for retirement timestamp.
- **Hub-side implementation** — `ITeleStore.supersede(payload)` + `ITeleStore.retire(payload)` on Memory + GCS impls
- **`list_tele` filter extension** — `{includeSuperseded: false}` default + opt-in include; preserves backward-compat for existing callers
- **Audit trail preservation** — both tools emit audit entries (`tele_superseded`, `tele_retired`); superseded/retired teles persist in GCS with status-field update, not deletion (tele-lineage queryable forever)
- **5-zombie cleanup** — architect identifies supersession map (5 pre-rewrite teles → current tele-0..tele-10); engineer applies `supersede_tele` mechanically
- **Hub deploy + version bump** — new tools require Hub container redeploy
- **Spec document update** — `docs/specs/teles.md` gains §Tele Lifecycle section documenting the API + the active/superseded/retired state model; §Provenance updated with formal supersession map

### Out of scope

- `update_tele(teleId, fields)` general update tool — out of scope; teles are intentionally immutable except via the lifecycle verbs defined in this mission
- Director-only vs architect-only gate policy beyond what other tele-surface tools already enforce (architect-role default; Director can invoke any architect-scope tool)
- Cross-workspace tele-lifecycle coordination (multi-Hub federation; not an active concern)
- Backfill-migration tooling beyond the 5-zombie cleanup (not needed — other teles are already active)

---

## Success criteria

1. **Tools live:** `supersede_tele` + `retire_tele` exposed on Hub via MCP, callable from architect role, audit-traced; tested via unit tests + integration test against in-memory Hub
2. **Schema extension:** Tele entity has `status`, optional `supersededBy`, optional `retiredAt` fields; existing 13 teles default to `status: "active"` (idempotent migration — no backfill job, defensive on-read)
3. **5-zombie cleanup complete:** all 5 pre-rewrite teles in `gs://ois-relay-hub-state/tele/` carry `status: superseded` + reference their successor (architect-supplied mapping applied)
4. **List filter preserves backward-compat:** `list_tele()` default returns 13 (current active set); `list_tele({includeSuperseded: true})` returns 18 (includes 5 zombies)
5. **idea-149 rerun-clean:** hypothetical rerun of Phase 1 tele-audit produces no zombie entries (retirement primitive replaces the direct-write workaround)
6. **Audit trail preserved:** `tele_superseded` + `tele_retired` audit actions emit on every transition; GCS tele records survive (no deletion)
7. **bug-24 flipped:** `open → resolved` with `fixCommits` populated + `fixRevision: mission-N`
8. **Hub deploy live:** new tools reachable in production adapter namespace
9. **Spec updated:** `docs/specs/teles.md` gains §Tele Lifecycle section; `docs/specs/entities.md` audit matrix updated for Tele entity's new fields; idea-149 cartography reference updated

---

## Dependencies

| Prerequisite | Status | Notes |
|---|---|---|
| none | — | Standalone mission; no upstream Phase 4 dependency; smallest-scope mission of the 4 — could ship first |

### Enables (downstream)

| Post-review work | How |
|---|---|
| Future tele-audit operations | Retirement/supersession becomes a primitive call, not a direct-write workaround |
| Any future tele methodology refactor | Zombies formally retired; tele-set integrity restored |
| idea-155 AuditEntry typed payload (post-review backlog) | Audit-schema precedent for `tele_superseded`/`tele_retired` typed entries |

---

## Engineer-flagged scope decisions (for Director)

1. **Successor-mapping authority** — architect identifies the 5 supersession pairs (architectural call on which pre-rewrite tele maps to which current tele); engineer applies mechanically
2. **Status enum extension** — Tele entity gains a `status` field; minor entity-shape change; architect should approve via Manifest-as-Master concept-grounding (in scope per architect's §Concept-grounding)
3. **Backward-compat default** — existing `list_tele()` callers expect current active-set; `{includeSuperseded: false}` default + opt-in include preserves current behavior cleanly

---

## Effort class

**S** (engineer-authoritative per Phase 4 §10.1).

Rationale: two new tools (near-mechanical — existing tele-policy handlers as template) + schema additive field + audit actions + 5-entity mechanical cleanup + Hub deploy. Expected 2-3 engineer-days.

---

## Related Concepts / Defects

### Concepts advanced

- §2.4 Manifest-as-Master — completes tele-lifecycle in the Manifest layer

### Defects resolved

- sym-A-024 bug-24 (no retirement primitive for teles; major severity; currently-unaddressed)
- Snowflake Entropy (§3.3 Drift cluster) — partial (tele-lifecycle drift between docs spec and runtime behavior closes)
- Doc-Code Drift (§3.3) — partial (spec `Tele Lifecycle` section becomes isomorphic with runtime API)
- Direct-Write Backstop pattern — eliminated for tele-set evolution path

---

## Filing metadata

- **Status at file:** `proposed` (Mission FSM default; Director release-gate per Phase 4 §10.6)
- **Document ref:** `docs/reviews/2026-04-phase-4-briefs/m-tele-retirement-primitive.md`
- **Director activation:** requires explicit Director "ready to release" signal per-mission; no architect auto-flip to `active`
- **Correlation:** Phase 4 winner #3; resolves bug-24

---

*End of M-Tele-Retirement-Primitive final brief (architect-engineer sealed Pass 4). Awaits Director final ratification → architect files via create_mission.*
