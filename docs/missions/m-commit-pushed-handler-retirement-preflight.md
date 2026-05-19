# mission-85 M-Commit-Pushed-Handler-Retirement — Preflight Artifact

**Mission:** mission-85 (M-Commit-Pushed-Handler-Retirement)
**Mission-class:** substrate-cleanup-wave (Low-class, bounded subsystem-retirement)
**Brief:** `docs/designs/m-commit-pushed-handler-retirement-design.md` (commit `83cd7dd`; v1.0 RATIFIED 2026-05-19)
**Branch:** `agent-lily/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate` (architect-side; carries Design v0.1 + v1.0 + this Preflight; engineer ship-PR will branch from main)
**Preflight authored:** 2026-05-19 11:27 AEST / lily (architect)
**Verdict:** **GREEN** — Director may flip `proposed → active` immediately
**Methodology:** `docs/methodology/mission-preflight.md` v1.0 (6-category audit; lightweight per Design §5 Q-5 RESOLVED)

---

## §0 Context

Phase 6 lightweight preflight against mission-85 (M-Commit-Pushed-Handler-Retirement) at `proposed` status. Cycle context: bug-98 surfaced post-mission-84 (Director-direct Priority 0); architect-Director-engineer 10-round bilateral triage at thread-587 arrived at Option W (retire subsystem) 2026-05-19; idea-303 filed + triaged Survey-skip per `feedback_idea_triage_protocol_skip_criteria` 5-criteria; Design v0.1 → v1.0 RATIFIED via thread-588 single-round bilateral audit (greg round-1 surfaced 5 items; all folded; 2 B-class architect-spec drift instances noted for Phase 10 calibration batch); Phase 5 mission-entity creation 2026-05-19 (mission-85); idea-303 → `triaged`.

Preflight executed within minutes of Design + Phase 5 ship — no stale-preflight risk per `mission-preflight.md` "When NOT to use" carve-outs. Brief claims verified against Hub state + filesystem at preflight-execution time.

**Composing-with mission-84 (M-Hub-Storage-FS-Retirement; COMPLETED 2026-05-19):** mission-84 retired FS-mode storage pattern; mission-85 retires the commit-pushed-handler architect-notification pattern. Both are subsystem-retirement class. Independent code-paths; no sequencing constraint.

**Composing-with mission-78 (Missioncraft):** Design v1.0 §2.3 anchors on missioncraft v5 architectural intent (sibling-repo `/home/apnex/taceng/missioncraft/`); mission-78 is pre-v1.2.0 ship per `docs/surveys/m-hub-storage-substrate-survey.md`. No code-coupling; architectural-reasoning reference only.

---

## §1 Category A — Documentation integrity

| # | Check | Verdict | Evidence |
|---|---|---|---|
| A1 | Brief file exists at `mission.documentRef` path and is committed | **PASS** | `docs/designs/m-commit-pushed-handler-retirement-design.md` exists; committed at `83cd7dd` (Design v1.0 RATIFIED); 195 lines |
| A2 | Local branch in sync with `origin` (no unpushed commits affecting brief) | **PASS** | HEAD = upstream = `83cd7dd` (architect-side branch); push verified at v0.1 + v1.0 commits |
| A3 | Cross-referenced artifacts exist | **PASS** | bug-98 (wontfix; updated 2026-05-19); idea-303 (triaged); thread-587 (10 rounds; full triage); thread-588 (Phase 4 audit; converged); PR #215 (Fix 1+2 commits at 65124632; retiring in this mission); PR #216 (bug-99+100; UNAFFECTED); bug-101 (OPEN; INDEPENDENT) |
| A4 | All referenced calibration / memory / feedback entries exist | **PASS** | `feedback_idea_triage_protocol_skip_criteria` (skip-Survey decision); `feedback_calibration_ledger_discipline` (Phase 10 batch); `feedback_bilateral_audit_round_budget_discipline` (v1.0 ratify without round-2); `feedback_substrate_currency_audit_rubric` + `feedback_architect_review_doc_behavioral_claims_code_verify` (B-class catches in §8); `feedback_adapter_restart_protocol_hub_container` (Hub-rebuild discipline) |

## §2 Category B — Scope clarity

| # | Check | Verdict | Evidence |
|---|---|---|---|
| B1 | Acceptance criteria enumerated + verifier-ready | **PASS** | Design §4 — 13 AG-N; each with concrete verifier (`ls`, `grep`, `npm test`, `gh pr view`, `get_bug`, `get_mission`); AG-4 deterministic test-assertion verifier per greg round-1 §10 |
| B2 | Anti-goals enumerated | **PASS** | Design §3 + thread-588 §11 — 4 anti-goals: (1) no alternative attribution mechanism; (2) no missioncraft design change; (3) no Hub agent label change; (4) bug-101 out-of-scope |
| B3 | Open questions resolved | **PASS** | Design §5 — all 5 Q-N RESOLVED via greg round-1 audit |
| B4 | Bounded scope (single mission-shape) | **PASS** | 5-file code-edit + 2 methodology-doc revisions + 2 entity updates; single PR per §3.1 + greg §4 concur |

## §3 Category C — Mission lifecycle config

| # | Check | Verdict | Evidence |
|---|---|---|---|
| C1 | `missionClass` set + matches scope | **PASS** | `substrate-cleanup-wave` (Low-class subsystem-retirement) — matches Design §1 framing + bounded scope |
| C2 | `pulses` configured + canonical cadence | **PASS** | engineerPulse 600s / architectPulse 1200s / missedThreshold 2 — matches canonical-unified post-mission-68 baseline per `feedback_compressed_lifecycle_preflight_currency_checks` + memory project_mission_77_state pattern |
| C3 | `plannedTasks[]` populated with concrete description | **PASS** | 1 task (sequence=1; status=unissued); description enumerates all 7 file-edits + Hub-rebuild + 13 AG-N verification + admin-merge convention |
| C4 | Pulse-message references mission correctly | **PASS** | engineerPulse message names mission + asks Phase 8 ship-status; responseShape=short_status appropriate for cleanup-class |

## §4 Category D — Engineering readiness

| # | Check | Verdict | Evidence |
|---|---|---|---|
| D1 | Engineer has cognitive engagement OR can be roused | **PASS** | greg responded to thread-588 round-1 within ~90 seconds of dispatch (online_idle + cognitive_ttl=0 at dispatch-time per `scripts/local/get-agents.sh`; roused immediately on unicast thread queue-fire); ready for Phase 8 pickup on Director Release-gate ratify |
| D2 | Engineer-side branch / worktree state clean | **PASS** | greg working-tree `agent-greg/main` (per multi-mission convention); will branch fresh from main for ship-PR; no contamination risk per `feedback_long_lived_branch_dev_state_contamination` (architect-side mission-84 branch carries Design + Preflight; engineer ships from main) |
| D3 | All required tooling present | **PASS** | `scripts/local/build-hub.sh` + `scripts/local/start-hub.sh` exist; `gh` CLI authenticated; `git grep` + `npm test` operational |
| D4 | Hub container baseline known-good | **PASS** | Hub running on PR #216 ship-state (mission-83 W5 substrate path + bug-99+100 fixes); confirmed via `scripts/local/get-agents.sh` returning agents responding; bridge running per PR #216 multi-prefix fix |

## §5 Category E — Risk + reversibility

| # | Check | Verdict | Evidence |
|---|---|---|---|
| E1 | Reversal path defined if mission ships then needs revert | **PASS** | Single-PR atomic-revert via `git revert <merge-commit>` reintroduces handler + registration + tests + docstring + methodology-doc text; bug-98 status flip is single-call. Bounded scope makes revert mechanical. |
| E2 | Production-impact assessment | **PASS** | Hub runtime impact: REPO_EVENT_HANDLERS registry shrinks by 1 (COMMIT_PUSHED_HANDLER); commit-pushed events still consumed by other handlers if any (verified by Design §3.1.2 — only this handler consumed commit-pushed); MessageDispatch synthesized-notification path removed (operational replacement: engineer-thread-explicit-surface, already operational). No data-loss. No persisted-state migration (Design §5 Q-2 RESOLVED NO). |
| E3 | Cross-mission coupling assessment | **PASS** | mission-83 W5 substrate path UNAFFECTED (Hub-side substrate not touched). mission-84 FS-retirement path UNAFFECTED (different subsystem). bug-99 + bug-100 fixes UNAFFECTED (substrate-correctness; persist regardless). bug-101 UNAFFECTED (production-Hub bootstrap; independent). mission-78 missioncraft UNAFFECTED (sibling-repo only; this-repo design-doc reference only). |
| E4 | Calibration filing risk (Phase 10 ledger discipline) | **PASS** | Phase 10 calibration entry pattern-named **CROSS-LAYER IDENTITY EXTRACTION** per Design §3.4; Director-bilateral filing per `feedback_calibration_ledger_discipline` (never LLM-autonomous); pattern-signature + diagnostic-test + disposition-rubric drafted in Design §3.4 |

## §6 Category F — RACI clarity

| # | Check | Verdict | Evidence |
|---|---|---|---|
| F1 | Architect-Engineer-Director responsibilities clear | **PASS** | Architect: drives lifecycle + cross-approves PR + files Phase 10 calibration (bilateral with Director). Engineer: ships PR + Hub-rebuild + verifies 13 AG-N + thread-explicit-surface on review-readiness. Director: Phase 7 Release-gate ratify + Phase 10 calibration filing bilateral. Matches `CLAUDE.md §1.5` Mission RACI. |
| F2 | Director-engagement gate-points identified | **PASS** | Phase 7 Release-gate (proposed → active) + Phase 10 calibration filing. No mid-execution Director-engagement required (bounded scope; full-autonomous between gates). |
| F3 | Bilateral channel established | **PASS** | thread-588 (Phase 4 Design; converged); future ship-coord-thread engineer-driven on PR open per `feedback_apnex_repos_direct_commit_to_main` convention (apnex-org PR-flow) |

---

## §7 Verdict + activation request

**6 categories × all PASS → Verdict GREEN.**

Director may flip `mission-85.status: proposed → active` immediately. On activation:
- engineerPulse + architectPulse fire per canonical cadence
- plannedTasks[0] auto-issues (`unissued → issued`) per advancement cascade
- Engineer picks up at Phase 8 ship (branch from main; single PR; 5-file edits + 2 doc revisions; per-AG-N verification; Hub-rebuild via `build-hub.sh` + `start-hub.sh`; thread-explicit-surface on ship-PR open for cross-approval)
- Architect drives cross-approval + admin-merge + Hub-rebuild verify + Phase 9 close + Phase 10 calibration bilateral

**Bounded ETA:** ~1-2 hours engineer-side ship; ~30 min architect-side post-ship verification + Phase 9 close.

---

## §8 Surface-notes for Phase 10 retro batch

(For architect-Director bilateral calibration filing at Phase 10 close — captured here for memory-continuity, NOT filed autonomously per `feedback_calibration_ledger_discipline`.)

1. **CROSS-LAYER IDENTITY EXTRACTION pattern** (Design §3.4) — architectural-overreach diagnostic + retirement-disposition rubric
2. **Architect-spec-vs-code drift recurrence** (Design §8) — v0.1 had 2 B-class drift instances (missioncraft sibling-repo anchor not annotated; CLAUDE.md vs mission-lifecycle.md §1.5.1.1 mislocated); confirms bilateral audit-round structural-essentiality for architect-authored Design docs
3. **bug-98 architectural-overreach lineage** — Director Priority 0 → architect-Director-engineer 10-round triage → Option W ratify → mission-85 retirement. Pattern: when fix-iterations cannot resolve via mechanism tuning, retirement IS the correct disposition; engineer-thread-explicit-surface was operational replacement throughout.
4. **Missioncraft-aware architectural reasoning** — single-credential at operator-machine layer is the correct shape; per-mission-credentials would violate missioncraft v5 inheritance intent; load-bearing reasoning for Option W ratify
5. **Compressed-lifecycle quality** — Survey-skip + single-round Design audit + lightweight Preflight + single-PR ship + Director-bilateral Phase 10 calibration — ~3-4 hours total elapsed for full bounded subsystem-retirement mission; preserves bilateral-audit catch-net while shedding ceremony

These are surface-notes for Director-bilateral negotiation at Phase 10; final pattern-naming + calibration-IDs remain Director-authored per ledger discipline.
