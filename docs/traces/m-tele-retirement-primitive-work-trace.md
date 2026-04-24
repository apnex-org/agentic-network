# M-Tele-Retirement-Primitive — Work Trace (live state)

**Mission scope.** Tracks all in-flight, queued, and recently-completed work under mission-43 (M-Tele-Retirement-Primitive). Goal: close bug-24 by shipping `supersede_tele` + `retire_tele` lifecycle primitives on the Tele entity + adding `list_tele` filter + spec §Tele Lifecycle + closing hygiene on `scripts/reset-teles.ts` direct-write workaround. S-class; single-task mission decomposed by engineer into 3 bounded tasks.

**Mission brief:** `docs/reviews/2026-04-phase-4-briefs/m-tele-retirement-primitive.md`.
**Kickoff decisions (ratified 2026-04-23):** `docs/missions/mission-43-kickoff-decisions.md`.
**Preflight (GREEN):** `docs/missions/mission-43-preflight.md`.
**Architect coordination thread:** thread-279 (quick-win pick, converged 2026-04-24) + thread-280 (release signal, sealed 2026-04-24).
**Kickoff clarifications (architect-resolved at thread-279 convergence):**
- `list_tele` → two flags: `includeSuperseded: false` + `includeRetired: false` (symmetrical)
- GCS read-path defaults missing `status` → `"active"`, NO write-back (zero backfill)
- Audit → simple `ctx.emit("tele_superseded"|"tele_retired", …)` (no idea-155 typed-payload)
- Role-gating stays advisory (inherits existing `create_tele` posture); enforcement deferred to idea-121
- `scripts/reset-teles.ts` delete folded into closing hygiene
**How to read + update this file:** `docs/traces/trace-management.md`.

**Status legend:** ▶ in-flight · ✅ done this session · ○ queued / filed · ⏸ deferred

---

## Resumption pointer (cold-session brief)

If you're picking up cold:

1. **Read this file first**, then the brief, kickoff decisions, and preflight (all on `agent/greg`).
2. **Hub mission id:** mission-43 (status=active as of 2026-04-24 AEST per Director release-gate; correlationId="mission-43").
3. **Current in-flight:** T3 (specs + verification + hygiene + Hub redeploy) — in progress. T1 (schema) + T2 (tools + filter + tests) shipped locally; awaiting commit + Hub deploy step.
4. **Ratified scope inputs (do NOT re-litigate):** the 5 architect-resolved clarifications above; Decision 4 Option B (verification-only zombie pass, no supersede_tele calls during this mission).
5. **Anti-goals (hold firm):** no idea-155 typed-payload adoption here; no role-gate enforcement (idea-121 territory); no cross-mission coupling; no scope creep into `seed-new-teles.ts` cleanup (not in architect scope).
6. **Deploy gate:** Hub ships via **local Docker container** (`ois-hub:local`), NOT via Cloud Run. The Cloud Run `hub` service was intentionally destroyed 2026-04-24 during this mission after an exploratory push — local Docker is the delivery target. Architect Cloud Run redeploy NOT required. `deploy/build-hub.sh` + `deploy/deploy-hub.sh` are tracked for the rare prod-push case but NOT part of normal mission flow.

---

## In-flight

- ▶ **T3 — Specs + verification audit + hygiene + local Docker rebuild.** Spec edits to `docs/specs/teles.md` (§Tele Lifecycle) + `docs/specs/entities.md` (audit matrix row) complete. `scripts/reset-teles.ts` + backup dir deleted. Code committed (`e75db98`). Deploy-tooling additions `deploy/build-hub.sh` + `deploy/deploy-hub.sh` committed (`47957eb`, `95a4ea6`) — useful tracked assets even though Cloud Run is not the normal target. Pending: architect-side verification-only zombie pass (per Decision 4 Option B); local Docker rebuild via `scripts/local/build-hub.sh` to materialize new tools for the running `ois-hub:local`; closing report; PR open; bug-24 flip.

**Cloud Run status note (2026-04-24):** an exploratory Cloud Run push + roll completed successfully during this mission (build `2f95e631`, image `hub:mission-43-20260424-015414`, revision `hub-00001-8bt` at 100% traffic); Director then confirmed local Docker is the delivery target and the Cloud Run `hub` service was destroyed the same day. Artifact Registry image retained (cheap; not load-bearing).

---

## Queued / filed

- ○ **Mission closing audit** — `docs/audits/m-tele-retirement-primitive-closing-report.md` — to author after T3 ships. Single-artifact-per-mission per mission-41 Option-1 precedent. Cover: deliverable scorecard, success-criteria status, tele-alignment retrospective, zombie-verification finding (expected: no zombies, primitive shipped for future operations), bug-24 resolution, `reset-teles.ts` cleanup, spec updates, Hub-deploy verification.
- ○ **bug-24 status flip** — `update_bug({bugId: "bug-24", status: "resolved", fixCommits: [...], linkedMissionId: "mission-43"})` — author post-deploy once tools are live in prod Hub. Filing will require at least one fixCommit on `agent/greg` containing the tele-policy + tele + gcs-tele changes.
- ○ **Hub tasks (retroactive)** — architect mentioned "task decomposition is yours"; engineer opted for 3 local tasks rather than Hub-filed task entities for an S-class mission. Decision: keep local-only for now; file retroactive Hub task(s) at closing for archival if the architect wants the Hub-side task trail. Light scope; not load-bearing.

---

## Done this session

- ✅ **thread-279 convergence (quick-win pick)** — architect surveyed Phase 4 staged queue 2026-04-24 01:17Z; engineer replied with feasibility + 5 kickoff-clarifications + in-flight conflict check 01:20Z; bilateral convergence at 01:22Z with `close_no_action` staged. Architect took recommendation to Director.
- ✅ **thread-280 convergence (release signal + activation)** — architect delivered Director approval 2026-04-24 01:26Z with 5 clarifications restated; engineer acknowledged + proposed 3-task decomposition + converged at 01:27Z. Bilateral seal at 01:27Z; `close_no_action` committed; execution unblocked.
- ✅ **T1 — Tele schema extension + store parity.** `hub/src/entities/tele.ts`: added `TeleStatus` union + `status` / `supersededBy?` / `retiredAt?` fields to `Tele`; new `ITeleStore` methods `supersedeTele(teleId, successorId)` + `retireTele(teleId)`; `normalizeTele` pure read-side helper defaulting missing `status` → `"active"`; `MemoryTeleStore` implements new methods with `"retired" → supersede_tele rejected"` guard + successor-existence check. `hub/src/entities/gcs/gcs-tele.ts`: read-path (`getTele` + `listTele`) runs normalizer; write-path uses `updateExisting` OCC-safe transform; GcsPathNotFound → user-facing `Tele not found` error. Reviewer-visible comment at read sites calls out zero-backfill discipline. `tsc --noEmit` clean.
- ✅ **T2 — Lifecycle write tools + list filter + audit emits.** `hub/src/policy/tele-policy.ts`: added `supersedeTele` + `retireTele` handlers mirroring `createTele` shape + simple `ctx.emit("tele_superseded"|"tele_retired", …)` broadcasts to `["architect", "engineer"]`; `list_tele` grew `includeSuperseded` + `includeRetired` optional booleans (default false; exclude both); two new `router.register(...)` entries with `[Architect]` advisory prefix. Role-gate stays advisory (idea-121 territory). Test additions at `hub/test/wave1-policies.test.ts`: registration-count flip 3 → 5; 7 new behavior tests covering create-writes-active, supersede-flip + audit, missing-successor rejection, retire-flip + audit, retired-cannot-be-superseded, default-exclude + opt-in-include for both flags. Tool-count assertion at `hub/test/e2e/e2e-foundation.test.ts` flipped 49 → 51. **Full hub suite: 725/730 pass** (was 719/724; +7 new; zero regressions). `tsc --noEmit` clean.
- ✅ **T3 partial — spec edits + hygiene.** `docs/specs/teles.md`: added ~70-line `## Tele Lifecycle` section with state table, tool surface, role-gate note, schema, backward-compat discipline, audit emissions, bug-24 resolution narrative. Hub-state-parity table gained a Status column; bug-24 row flipped to "Resolved by mission-43 (2026-04-24)". Coordination-artifacts `reset-teles.ts` entry annotated with deletion note. `docs/specs/entities.md`: Tele audit-matrix row updated — mutability "immutable" → "content-immutable; status-mutable via supersede_tele / retire_tele (mission-43)"; FSM-section-ref points at teles.md §Tele Lifecycle. **Closing hygiene:** deleted `scripts/reset-teles.ts` (485 lines) + its backup dir (16 tele-*.json files). Files were never tracked in git (engineer-local one-shot); spec note captures the cleanup.

---

## Edges (dependency chains)

- T1 → T2 → T3 (strict serial; T2 tests consume T1 schema; T3 docs describe T2 surface)
- T3 → Closing audit → bug-24 flip → mission-flip (architect-gated)
- Hub redeploy sits between T3 spec-commit and the bug-24 status flip — the flip should name a commit that's live in prod Hub, not just on branch

---

## Session log (append-only)

- **2026-04-24 01:17Z (AEST ~11:17)** — Architect opened thread-279 surveying Phase 4 staged missions for Director's quick-win ask. Engineer was mid-investigation of engineer-table pagination; pivoted to notification per "act on Hub notifications immediately" rule.
- **2026-04-24 01:20Z** — Engineer replied on thread-279: code-level sanity check of `tele.ts` + `tele-policy.ts` (83 lines) + `gcs-tele.ts`; confirmed mission-43 surface is compact + additive; flagged 3 kickoff-clarifications (filter semantics, idempotent-on-read discipline, audit-event shape) + adjacent role-gating observation; confirmed no branch conflicts post-mission-45 close; declined bug-27 carve-out from mission-42.
- **2026-04-24 01:22Z** — Architect converged thread-279 with `close_no_action` + load-bearing summary; all 3 clarifications resolved architect-side.
- **2026-04-24 01:26Z** — Architect delivered Director release signal on thread-280; clarifications restated; task decomposition explicitly handed to engineer.
- **2026-04-24 01:27Z** — Engineer replied on thread-280 with 3-task decomposition (T1 schema ~0.5d, T2 tools+filter+tests ~1d, T3 specs+hygiene+deploy ~0.5-1d) + converged. Bilateral seal.
- **2026-04-24 01:30-01:40Z approx** — T1 + T2 shipped locally. Test suite confirmed green (725/730). Tsc clean.
- **2026-04-24 01:40-01:50Z approx** — T3 spec edits + closing hygiene executed. Reset script + backup deleted.
- **2026-04-24 01:50-02:00Z approx** — Code committed as `e75db98`. Branched `agent-greg/mission-43-tele-lifecycle` off main per ADR-023 trunk-based workflow.
- **2026-04-24 02:05Z** — Director requested Cloud Build wrapper as tracked deploy tooling. Promoted local `scripts/local/build-hub.sh` pattern to tracked `deploy/build-hub.sh` (commit `47957eb`). Paired with `deploy/deploy-hub.sh` for Cloud Run roll (commit `95a4ea6`). Director approved build; `deploy/build-hub.sh --tag mission-43-20260424-015414` succeeded in 1m27s (build `2f95e631`). `deploy/deploy-hub.sh --image ...` rolled Cloud Run revision `hub-00001-8bt`.
- **2026-04-24 02:10Z** — Director clarified: local Docker is the delivery target, not Cloud Run. Cloud Run `hub` service destroyed. Memory updated (`project_local_docker_testing.md`). Mission trace updated to reflect local-Docker-as-target.

---

## Canonical references

- **Mission entity:** `mission-43` (get_mission for live state)
- **Primary bug:** `bug-24` (status flip post-deploy)
- **Brief:** `docs/reviews/2026-04-phase-4-briefs/m-tele-retirement-primitive.md`
- **Preflight:** `docs/missions/mission-43-preflight.md`
- **Kickoff decisions:** `docs/missions/mission-43-kickoff-decisions.md`
- **Spec (new §):** `docs/specs/teles.md §Tele Lifecycle`
- **Code surface (touched):**
  - `hub/src/entities/tele.ts` — schema + memory store
  - `hub/src/entities/gcs/gcs-tele.ts` — GCS store + read-normalization
  - `hub/src/policy/tele-policy.ts` — handlers + registration
  - `hub/test/wave1-policies.test.ts` — behavior tests
  - `hub/test/e2e/e2e-foundation.test.ts` — tool-count assertion
- **Deleted:**
  - `scripts/reset-teles.ts`
  - `scripts/reset-teles-backup-2026-04-21T23-35-09-585Z/` (16 JSON files)
- **Architect threads:** `thread-279`, `thread-280`
