# Mission-43 Kickoff Decisions

**Mission:** M-Tele-Retirement-Primitive (mission-43)
**Brief:** `docs/reviews/2026-04-phase-4-briefs/m-tele-retirement-primitive.md`
**Preflight:** `docs/missions/mission-43-preflight.md`
**Ratified:** 2026-04-23 by Director
**Path:** preflight YELLOW → ratify decisions → preflight GREEN → mission stays `proposed` pending Director release-gate signal

---

## Purpose

Capture the 3 engineer-flagged scope decisions from mission-43's brief plus the new Decision 4 surfaced by preflight Category C (zombie-cleanup scope obsolescence). Decisions are frozen into this artifact so that when Director later issues the release-gate signal, activation is immediate. Mission remains in `proposed` status until Director explicitly releases.

---

## Decision 1 — Successor-mapping authority

**Decision:** **Moot.** No supersession mapping needed under Decision 4 Option B (verification-only pass). Original brief scope assumed 5 pre-rewrite zombies needed architect-identified successor mapping; Category C finding established that no zombies exist in the current `list_tele` (13 clean teles all carrying ratified-2026-04-21 provenance).

**If a future tele-audit ever produces zombies, the same protocol applies:** architect identifies supersession pairs at that point; engineer applies mechanically via the new `supersede_tele` tool. This is the exact pattern this mission's tools enable for future operations.

---

## Decision 2 — Status enum extension approval

**Decision:** **Ratified.** Tele entity gains:
- `status: "active" | "superseded" | "retired"` — defaults to `"active"` for existing + new teles (idempotent on-read; no backfill job required)
- `supersededBy?: teleId` — optional; set by `supersede_tele` when invoked
- `retiredAt?: ISO-8601` — optional; set by `retire_tele` when invoked

**Rationale:** Completes the Manifest-as-Master (§2.4) lifecycle CRUD — `create_tele` + `supersede_tele` + `retire_tele` close the lifecycle surface. Minor entity-shape change; additive only; no breaking-schema impact on existing callers.

**Authority:** architect field-ownership on Concept-grounding (Manifest-as-Master completeness) per Phase 4 retrospective §Delta 4; ratified by Director.

---

## Decision 3 — Backward-compat default

**Decision:** **Ratified.** `list_tele` gains an optional filter:
- `list_tele({includeSuperseded: false})` default — preserves current behavior (returns only `status: "active"` teles)
- `list_tele({includeSuperseded: true})` — audit path (returns `active` + `superseded`; `retired` always excluded unless explicitly requested)

Existing callers experience zero behavioral change. Audit/lineage queries gain opt-in access to supersession history.

**Rationale:** Default-exclude preserves all existing callers; opt-in-include gives audit-trail access without polluting normal list-flow.

**Authority:** engineer field-ownership on API surface; ratified by Director.

---

## Decision 4 — Zombie-cleanup scope reshape *(surfaced by preflight Category C)*

**Decision:** **Option B — verification-only pass.**

**What changed since brief authoring:** Preflight Category C finding established that the 5 pre-rewrite zombies cited in the brief no longer exist in the current tele set. They were wiped via `scripts/reset-teles.ts` direct-write (the very workaround this mission exists to replace). The brief's "5-zombie mechanical cleanup via supersede_tele" scope item is therefore obsolete as originally specified.

**Ratified scope reshape:**
- Architect audits the current tele set (`list_tele`); confirms no zombies exist
- Documents the verification finding in the mission closing audit
- **Zero `supersede_tele` calls expected** during mission-43 execution
- The new `supersede_tele` + `retire_tele` tools are still shipped — they enable *future* tele-audit operations; this mission establishes the primitive, not a retroactive cleanup

**Effort impact:** None — S-class remains S. The verification pass replaces the mechanical cleanup with a brief audit-confirmation; same time budget.

**Why Option B vs A (scope out entirely) or C (retroactive audit-trail ghost entries):**
- Option A (scope out) leaves the bug-24 narrative ("Retired teles live as zombies") hanging — Option B closes the loop with an explicit "no zombies found; lifecycle primitive now prevents recurrence" artifact
- Option C (ghost supersede_tele entries for entities that no longer exist) contradicts "tele-lineage queryable forever" — if the underlying entities are gone, superseding a ghost is ceremony without substance
- Option B is the honest-scoping pattern established across mission-41 tasks (report what was actually done, not what was originally briefed)

**Authority:** Director ratified 2026-04-23 on architect recommendation.

---

## Downstream effects on brief interpretation

- **Success criterion #1 (tools live):** unchanged — `supersede_tele` + `retire_tele` still ship
- **Success criterion #2 (schema extension):** unchanged — per Decision 2
- **Success criterion #3 (5-zombie cleanup):** **revised to verification-only pass** — per Decision 4. Success measure becomes "architect confirms no zombies exist + documents in closing audit", not "5 supersede_tele calls applied."
- **Success criterion #4 (list filter backward-compat):** unchanged — per Decision 3
- **Success criterion #5 (idea-149 rerun-clean):** retained as a forward-looking criterion — the tools must support a hypothetical rerun without needing direct-write workarounds
- **Success criterion #6 (audit trail preserved):** unchanged — tools emit audit entries
- **Success criterion #7 (bug-24 flipped):** unchanged — bug-24 closure remains the primary outcome
- **Success criterion #8 (Hub deploy live):** unchanged — redeploy still required
- **Success criterion #9 (spec updated):** unchanged — `docs/specs/teles.md` §Tele Lifecycle + `docs/specs/entities.md` audit matrix updates still required

**Mission effort class:** S remains S (~2-3 engineer-days). Category E execution readiness unchanged.

---

## Filing metadata

- **Authority:** Director ratification via chat signal, 2026-04-23
- **Preflight updated:** `docs/missions/mission-43-preflight.md` verdict YELLOW → GREEN
- **Mission status:** remains `proposed` pending Director release-gate signal (`update_mission(status="active")`)
- **Activation trigger:** Director decides when engineer bandwidth supports mission-43 execution; currently no blocking dependencies (standalone mission per brief)
- **Archive:** this document is immutable post-ratification; any subsequent scope changes require a new mission-scoped decision document

---

*Kickoff decisions ratified and filed. Mission-43 stays `proposed` — release-gate signal independent; activation is a Director call on operational readiness.*
