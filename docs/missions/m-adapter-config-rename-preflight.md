# M-Adapter-Config-Rename (mission-58) Preflight Check

**Mission:** M-Adapter-Config-Rename
**Brief:** mission entity description (in-entity-brief pattern; thread-365 bilateral exchange = Design v1.0 artifact per Survey-bypass + thread-as-Design-artifact extension)
**Preflight author:** lily / architect
**Date:** 2026-04-26
**Verdict:** **GREEN**
**Freshness:** current (until 2026-05-26)
**Activation status:** READY pending Director release-gate signal `update_mission(mission-58, status="active")`

---

## Category A — Documentation integrity

- **A1.** Brief location: PASS — entity description compactly summarizes mission; references thread-365 (bilateral Design v1.0) as binding scope source-of-truth. **Thread-as-Design-artifact pattern** (Survey-bypass extension) — substrate-cleanup-wave class with small scope (S/XS) doesn't warrant separate Design doc.
- **A2.** Branch sync: PASS — main HEAD `23abd14` (PR #94 T1+T2 housekeeping merge); methodology stack v1.1 + entity-mechanics + housekeeping all on main; mission-57 closed.
- **A3.** Cross-referenced artifacts exist: PASS —
  - thread-365 ✓ (sealed; first canonical Survey-bypass + thread-as-Design-artifact execution)
  - `docs/methodology/idea-survey.md` v1.0 §8 ✓ (Survey-bypass discipline this mission validates)
  - `docs/methodology/mission-lifecycle.md` v1.1 ✓ (lifecycle methodology)
  - `docs/methodology/entity-mechanics.md` v1.0 ✓ (entity mechanics reference)
  - `feedback_retrospective_modes.md` ✓ (substrate-cleanup-wave default = SKIP retrospective)
  - PR #94 (T1+T2 housekeeping; established engineer-frozen-historical-NOT-touched precedent; Surface A carve-out follows)

## Category B — Hub filing integrity

- **B1.** Entity correctly filed: PASS — id=mission-58, status=proposed, correlationId=mission-58, sourceThreadId=null, sourceActionId=null (architect-direct create_mission), createdBy.role=system/agentId=hub-system. idea-209 linked via update_idea(missionId=mission-58; status=incorporated).
- **B2.** Title + description faithful: PASS — title "M-Adapter-Config-Rename" matches Design v1.0 (thread-365); description is comprehensive structured brief with goal + scope + 3-wave decomposition + 4 anti-goals + 3 tele alignments + sizing + sequencing + cross-references + provenance.
- **B3.** tasks[] + ideas[] state: PASS — `tasks[]` empty at preflight time (cascade auto-issues plannedTasks on advancement OR architect direct dispatch); `ideas[]` will reflect linked idea-209 via update_idea side. 3 plannedTasks bound at create_mission call (W1+W2 bundled / W3 cut-over / W4 closing audit; all unissued).

## Category C — Referenced-artifact currency

- **C1.** File paths cited in brief: PASS — verified (thread-365, idea-survey.md v1.0 §8, mission-lifecycle.md v1.1, entity-mechanics.md v1.0, retrospective-modes feedback, PR #94 precedent — all on main).
- **C2.** Numeric claims: PASS — scope ~28 refs across 25 files (engineer round-1 re-grep verified; architect undercount caught at smoke-production.ts which is load-bearing); 4 live JSON file locations; sizing S (~½d) possibly XS (~2.5h); ~3h engineer + ~30min coordination. All design choices ratified at thread-365; not measurements requiring re-verification.
- **C3.** Cited ideas/bugs/threads/missions in assumed state:
  - mission-57 (M-Mission-Pulse-Primitive): completed ✓ (substrate stack + methodology stack + housekeeping all on main)
  - idea-209 (M-Adapter-Config-Rename): **incorporated** ✓ (linked to mission-58 via update_idea; idea status flipped triaged → incorporated; missionId set)
  - idea-207 (M-PAI-Saga-On-Messages): open ✓ (Tier 2; orthogonal; not blocking)
  - idea-208 (M-Dogfood-CI-Automation): open ✓ (Tier 2; orthogonal; could ship after mission-58)
  - thread-365 (Design phase): converged ✓ (bilateral; first canonical Survey-bypass + thread-as-Design-artifact)
- **C4.** Dependency prerequisites: PASS — all upstream missions completed; substrate stack on main; methodology stack v1.1 + entity-mechanics + housekeeping all on main; no pending downstream blockers.

## Category D — Scope-decision gating

- **D1.** Engineer-flagged scope decisions resolved: PASS — bilateral exchange thread-365 round-1 substantively answered all 5 architect Design questions + 5 engineer-surfaced surfaces resolved (Surface A historical-docs sweep-with-carve-out per architect-final + Surface B cross-worktree coord per role-allocation + Surface C dist regen + commit + Surface D smoke-production.ts manual re-run W3 + Surface E W0 absorbed into Design). One missed file caught at engineer round-1 re-grep (smoke-production.ts; load-bearing) + architect undercount corrected (~21 → ~28 refs).
- **D2.** Director + architect aligned: PASS — Director directive crystal clear ("full target state — no legacy compat — small scoped mission"); architect interpretation matches verbatim; Survey BYPASSED per `idea-survey.md` §8 sufficiently-scoped + Director-anchored intent. NO Design-mechanics surfaces required Director re-engagement during architect+engineer Design phase.
- **D3.** Out-of-scope boundaries confirmed: PASS — Design v1.0 + mission entity description 4 anti-goals lock scope (NO backward-compat shim / NO `hub-config.json` refs post-merge / NO breakage to active sessions during cut-over / NO scope creep into adjacent housekeeping). Tier 3 housekeeping (architecture vs methodology overlap; top-level docs; mission-N-preflight numeric vs slug) explicitly deferred per Director scope-pick at PR #93 housekeeping discussion.

## Category E — Execution readiness

- **E1.** First task clear: PASS — W1+W2 directive (per mission-58 plannedTasks[0]) is comprehensive: 7 deliverables enumerated (3 src files + dist regen + smoke-test fixture + 2 helper scripts + 2 start scripts + 13 doc files); engineer can scaffold day-1; cascade auto-issues OR architect-direct dispatch via fresh thread.
- **E2.** Deploy-gate dependencies: PASS with explicit gate — **Hub redeploy NOT required** for W1+W2 (config-file rename only; no Hub-side code change). **Adapter restart REQUIRED at W3** (post-merge coordinated cut-over per Q4 sequencing locked). **NOT substrate-self-dogfood class** per `feedback_substrate_self_dogfood_discipline.md` v2 substrate-vs-enrichment distinction (this is config-rename not substrate; no dogfood-gate).
- **E3.** Success-criteria measurable: PASS —
  - W1+W2 PR ships: `grep -rln hub-config.json` in active surfaces → empty (excluding carve-out files)
  - Build clean: `bun run build` in claude-plugin succeeds; typecheck + lint clean
  - W3 verification: `tests/smoke-production.ts` manual run passes from greg worktree post-cut-over; thread-message dispatch architect→engineer verifies push pipeline working post-rename
  - W4 closing audit ships at `docs/audits/m-adapter-config-rename-closing-audit.md`
  - Cross-package vitest baseline (bug-32) preserved (admin-merge per established 37-PR consecutive lineage)

## Category F — Coherence with current priorities

- **F1.** Anti-goals from prior missions hold: PASS — methodology stack (autonomous-arc-driving + mediation invariant + mechanise+declare + Survey-then-Design-with-bypass + mission-class taxonomy + substrate-self-dogfood discipline + complete-mission-scope-methodically + retrospective-modes + housekeeping-discipline-PR-#94-precedent) all binding for mission-58 execution. Substrate-cleanup-wave class signature (0-1 ops / 3+ retire / Low-Medium calibration) applies; calibration cadence forecast supports XS-to-S sizing.
- **F2.** No newer missions superseding: PASS — mission-58 IS the newest mission. idea-207 + idea-208 + M-Adapter-Distribution Tier 2 sister missions; orthogonal; not superseding.
- **F3.** Recent bugs/ideas changing scoping: PASS — bug-40 (Hub presence-projection drift; filed during mission-56) is orthogonal; not gating mission-58. No bugs/ideas filed since Design v1.0 ratification that materially shift scope.

## Verdict summary

**GREEN** — Brief is structurally sound; all 6 categories PASS; bilateral Design ratification at engineer-spec level (thread-365); Survey BYPASSED per discipline (first canonical execution); Director-anchored intent crystal clear; substrate stack + methodology stack all on main from mission-50/51/56/57 + housekeeping lineage.

This preflight is **a continuation of the cleanest-preflight-in-lineage trajectory** (mission-57 + mission-58 both have minimal upstream gates; only Director release-gate outstanding). Survey-bypass methodology + bilateral Design phase delivers tight pre-activation state for substrate-cleanup-wave class missions.

## Activation gates (Director-action prerequisites)

ONE structural gate remains:

1. **Director release-gate signal** — `update_mission(mission-58, status="active")` per `docs/methodology/mission-preflight.md`. Per autonomous-arc-driving pattern + Survey-bypass methodology, this is the architect's surface to Director (categorised: HOLD-point gate per categorised-concerns table). Director acknowledges preflight + signals release-gate → architect dispatches W1+W2.

Recommended sequence:
1. ✅ Survey BYPASSED + Design v1.0 ratified (thread-365)
2. ✅ Manifest cascade fired (mission-58 created at status=proposed; idea-209 incorporated → mission-58)
3. ✅ This preflight artifact authored
4. ⏳ Architect surfaces preflight + release-gate ratification ask to Director (this is the categorised surface)
5. ⏳ Director release-gate fires (`update_mission(mission-58, status="active")`)
6. ⏳ Architect dispatches W1+W2 directive to greg via fresh thread (cascade auto-issues OR architect-direct dispatch per mission-56/57 thread-dispatch pattern)
7. ⏳ Coordinated W3 cut-over post-merge (architect-Director coord moment)

## Pre-kickoff decisions required

None at the design level (Design v1.0 bilateral-ratified; all 5 questions + 5 surfaces resolved; smoke-production.ts caught + included in W1 scope). 

**One Director-coordination touchpoint at W3:** main worktree's `.ois/{greg,lily}/.ois/hub-config.json` renames (Director-owned environment) — architect can do via path manipulation OR Director can rename + restart per `feedback_architect_owns_hub_lifecycle.md` boundary preferences. Surface to Director at W3 dispatch moment.

## Side observations (non-blocking; capture for downstream)

- **First canonical execution of Survey-bypass discipline** — `idea-survey.md` v1.0 §8 bypass discipline executed for first time; calibration data point captured at thread-365 (bilateral Design phase ~5min architect-engineer coord vs full Survey ~5min Director time + ~10-15min architect interpretation; bypass saves the Survey-overhead but loses the per-question multi-dim-context discipline; appropriate for sufficiently-scoped + Director-anchored Idea)
- **First canonical execution of thread-as-Design-artifact** — substrate-cleanup-wave + small mission validates lighter Design-artifact pattern (vs full Design doc per mission-57 substantive work); thread-365 IS the Design v1.0 reference
- **Methodology calibration data point** — engineer round-1 re-grep caught architect undercount (smoke-production.ts; load-bearing) — validates re-grep discipline worth keeping for substrate-cleanup-wave class missions even with thread-as-Design pattern
- **Surface A carve-out reaffirms PR #94 precedent** — engineer-frozen-historical-artifacts-NOT-touched discipline applies cleanly to substrate-cleanup-wave class
- **W3 coordination touchpoint pre-flagged** — Director-owned main worktree environment renames + adapter restart; architect-Director coord at cut-over moment

---

*Preflight authored 2026-04-26 ~22:08Z (08:08 AEST 2026-04-27). Following methodology v1.0 mission-preflight.md procedure. Activation pending only Director release-gate signal — no upstream PR sequencing gates. Survey-bypass methodology + thread-as-Design-artifact delivers fastest pre-activation state in the mission lineage to date.*
