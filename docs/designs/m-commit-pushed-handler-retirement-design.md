# M-Commit-Pushed-Handler-Retirement — Design

**Version:** v1.0 **RATIFIED** 2026-05-19 (v0.1 architect-draft → v1.0 post greg round-1 audit fold; 5 surface-items resolved)
**Mission:** TBD (Phase 5 Manifest pending; idea-303 source)
**Class:** substrate-cleanup-wave / subsystem-retirement (Low-class, bounded)
**Source-ratify:** Director-direct W approval 2026-05-19 thread-587
**Survey:** SKIPPED per `feedback_idea_triage_protocol_skip_criteria` 5-criteria (idea-303 triage note)
**Audit:** thread-588 round-1 engineer audit complete (5 surfaces folded; v1.0 ratified without round-2 per `feedback_bilateral_audit_round_budget_discipline`)

---

## §1 Statement of Intent

Retire the **commit-pushed-handler** architect-notification subsystem (mission-68 W1; `docs/methodology/mission-lifecycle.md §1.5.1.1` Layer (c)) entirely. The subsystem's design premise — mapping `PushEvent.actor.login` (GitHub credential-identity) → individual agent role (Hub-context role-identity) — was architectural overreach. The retirement preserves single-credential operational reality (the correct architectural shape) and relies on engineer-thread-explicit-surface (already operational across mission-84) for architect-side PR-review-readiness signal.

## §2 Architectural Rationale

### §2.1 Identity-layer analysis

Four identity-systems are in play in the current substrate:

| # | System | Layer | Multiplicity | Aligned? | Verification |
|---|---|---|---|---|---|
| 1 | Hub agent label `ois.io/github/login` | Hub-context | per-agent | ✅ individual | thread-588 labels field + multiple repo-grep hits |
| 2 | Git config `user.name` + `user.email` | Operator-worktree | per-worktree | ✅ individual | standard git invariant |
| 3 | GitHub credential (SSH/PAT) | Operator-machine | per-operator (`apnex` org-credential currently) | ❌ singular at machine layer | thread-587 round-9 empirical |
| 4 | Missioncraft principal-id (per sibling-repo `missioncraft/src/missioncraft-sdk/core/principal-resolution.ts` 4-step) | Missioncraft-mission | per-mission (defaults to git config user.email) | ✅ individual | sibling-repo at `/home/apnex/taceng/missioncraft/`; mission-78 deliverable (pre-v1.2.0 ship per `docs/surveys/m-hub-storage-substrate-survey.md`) |

3 of 4 systems are correctly individually-attributed. System 3 (GitHub credential) is necessarily singular at the operator-machine layer — both lily and greg sibling sessions share the same machine and same `gh auth`. **The architectural error was attempting to extract role-identity (Hub-context layer) from credential-identity (operator-machine layer) via PushEvent.actor.login.** Layer-inverted attribution; cannot be cleanly resolved at the handler layer.

### §2.2 Why no fix-option preserves the original intent

| Option | Disposition | Problem |
|---|---|---|
| X (commit-author parse from /events) | Non-functional | GitHub /events API PushEvent returns `commits[]=0 items` — commits are not in the summarized response; only via webhook delivery or per-SHA /commits/{sha} API call. Verified empirically at thread-587 round-9. |
| Y (per-identity credentials per agent) | Complexity-additive | Forces System 3 into multi-identity shape; violates missioncraft-credential-inheritance intent; requires per-agent SSH-key + per-agent gh-auth-status management at operator machine. Sibling-session sharing pattern (lily + greg on same PC) becomes operationally complex. |
| Z (architect target.agentId resolution) | Symptomatic; downstream | Fix 2 in PR #215 is code-sound but downstream of Fix 1; unreachable if Fix 1 cannot resolve role. |

### §2.3 Missioncraft v5 architectural intent

Missioncraft (sibling-repo at `/home/apnex/taceng/missioncraft/`; per `src/missioncraft-sdk/core/principal-resolution.ts` 4-step precedence chain + `mission-types.ts` writer/reader participant model; design at this-repo `docs/designs/m-missioncraft-d2-substrate-design.md`) intentionally **inherits operator's existing git/gh credentials**. Per-mission credential-management is explicitly out-of-scope. Changing missioncraft to per-mission-credentials would violate its simplicity intent + create duplicated identity-handling — wrong direction per Director-direct simplicity principle.

### §2.4 The architecturally honest framing

Retire the subsystem. Acknowledge that:
- Single-credential at operator-machine layer is the correct architectural shape (matches missioncraft intent; matches sibling-session sharing reality)
- Role-identity belongs at Hub-context layer where it already is (System 1 + System 4)
- Architect-side PR-review-readiness signal is operational via **engineer-thread-explicit-surface** on coord-thread (proven across all 6 PRs of mission-84 + all PRs of bug-99/100/101 cycle)
- Layer (a) methodology + Layer (b) adapter-side hook preserved as engineer-side discipline; Layer (c) Hub-side handler retracted

## §3 Retirement Scope

### §3.1 Code changes

| # | File | Change | Detail |
|---|---|---|---|
| §3.1.1 | `hub/src/policy/repo-event-commit-pushed-handler.ts` | DELETE whole file | Stateless event-consumer; no persisted-state |
| §3.1.2 | `hub/src/policy/repo-event-handlers.ts` | EDIT lines 48 + 116 | Remove import + remove from `REPO_EVENT_HANDLERS` registry |
| §3.1.3 | `hub/test/unit/repo-event-handlers.test.ts` | DELETE 2 describe blocks (~300 of 496 lines) | Delete `COMMIT_PUSHED_HANDLER` describe (lines 193-378) + `bug-98 fix` nested describe (lines 381-end); KEEP `REPO_EVENT_HANDLERS registry` (105-163 minus 3 commit-pushed lines) + `lookupRoleByGhLogin` + `WORKFLOW_RUN_HANDLER` describe blocks |
| §3.1.4 | `hub/src/policy/repo-event-workflow-run-handler.ts` | REWRITE comments at lines 11, 24 | 2 stale cross-references to `commit-pushed-handler` shape (F2 fold + broadcast-target convention); replace with historical-pattern annotation or self-contained explanation |
| §3.1.5 | `adapters/claude-plugin/src/commit-push-hook.ts` | REVISE docstring | 4 references to "Layer (c) Hub-side commit-pushed handler" in docstring; revise to remove Layer (c) references + add retirement-note pointing to this Design + bug-98 wontfix |
| §3.1.6 | Hub container rebuild via `scripts/local/build-hub.sh` + restart via `scripts/local/start-hub.sh` | Validate handler absent from policy-router state | See AG-4 verifier |

### §3.2 Documentation revision

| # | File | Change |
|---|---|---|
| §3.2.1 | `docs/methodology/mission-lifecycle.md §1.5.1.1` (lines 131-145+) | **Retract Layer (c) Hub-side handler.** Preserve Layer (a) methodology guidance + Layer (b) adapter-side hook (engineer-side discipline). Add retirement note pointing to this Design + bug-98 wontfix. Revise the "Failure-resilience hierarchy" — Layer (b) becomes load-bearing for adapter-side; Layer (a) methodology + engineer-thread-explicit-surface composes architect-visibility. |
| §3.2.2 | `docs/methodology/engineer-runtime.md` (row ~22 in runtime-concerns table) | Revise "Commit-push thread-heartbeat mechanization" row — remove `(c) Hub-side commit-pushed handler` reference; preserve `(a) methodology + (b) adapter hook` 2-layer description. |

`docs/methodology/architect-runtime.md`: ZERO matches; no edit needed (verified by audit).

### §3.3 Bug-entity dispositions

| # | Entity | Action |
|---|---|---|
| §3.3.1 | bug-98 | wontfix (already updated 2026-05-19) — architectural-overreach |
| §3.3.2 | PR #215 commits at 65124632 (Fix 1 + Fix 2) | Code retires via §3.1.1 + §3.1.3 deletion; no separate revert needed |

### §3.4 Phase 10 retro calibration entry

**Pattern name:** **CROSS-LAYER IDENTITY EXTRACTION** (sibling to `feedback_methodology_bypass_amplification_loop`-style explicit-naming).

Pattern signature:
- Mechanism design conflates two layers of attribution (credential-layer vs role-layer)
- Symptom: fix-iterations cannot resolve via mechanism tuning; only via mechanism retirement
- Diagnostic test:
  - Q1 "Does the data-shape required by the fix exist in the upstream API response?" (X non-functional → no)
  - Q2 "Does the alternative require duplicating already-aligned identity systems?" (Y complexity-additive → yes)
  - Q3 "Is there an existing operational pattern that bypasses the broken mechanism?" (engineer-thread-explicit-surface → yes)
- Disposition rubric: if Q1+Q2 fail + Q3 succeeds → retire mechanism; preserve operational alternative

## §4 Acceptance Criteria

| AG-N | Criterion | Verifier |
|---|---|---|
| AG-1 | `hub/src/policy/repo-event-commit-pushed-handler.ts` does not exist | `ls hub/src/policy/ \| grep commit-pushed` returns empty |
| AG-2 | COMMIT_PUSHED_HANDLER absent from `repo-event-handlers.ts` | `grep -c COMMIT_PUSHED_HANDLER hub/src/policy/repo-event-handlers.ts` returns 0 |
| AG-3 | Hub builds clean (no broken imports) | `scripts/local/build-hub.sh` exits 0 |
| AG-4 | `REPO_EVENT_HANDLERS` registry-seed test asserts COMMIT_PUSHED_HANDLER absent | `hub/test/unit/repo-event-handlers.test.ts` registry-seed describe asserts the registry does NOT contain COMMIT_PUSHED_HANDLER; `npm test --filter=repo-event-handlers` exits 0 (deterministic verifier per greg round-1 §10 refinement) |
| AG-5 | `npm test` green for hub package | `cd hub && npm test` exits 0 (regression catch-net per `feedback_substrate_extension_wire_flow_integration_test`) |
| AG-6 | `mission-lifecycle.md §1.5.1.1` reflects retirement | grep for retraction note + bug-98 reference; confirm Layer (a) + (b) preserved |
| AG-7 | `engineer-runtime.md` runtime-concerns row revised | grep for absence of `(c) Hub-side commit-pushed handler` reference in commit-push-thread-heartbeat row |
| AG-8 | `repo-event-workflow-run-handler.ts` comments do not stale-reference commit-pushed-handler | grep at lines 11, 24 for absence of `commit-pushed-handler` references; replacement annotation present |
| AG-9 | `commit-push-hook.ts` docstring does not reference Layer (c) | grep for absence of `Layer (c)` in adapter docstring; retirement-note present |
| AG-10 | bug-98 status = wontfix | `get_bug bug-98` returns status=wontfix |
| AG-11 | PR opens + cross-approved + admin-merged to main | `gh pr view` shows MERGED status |
| AG-12 | Mission status flips to completed at Phase 9 close | `get_mission mission-N` returns status=completed |
| AG-13 | Phase 10 calibration entry filed via Director-bilateral | `docs/calibrations.yaml` updated; calibration-ID assigned |

## §5 Resolved Open Questions

| Q-N | Question | Resolution |
|---|---|---|
| Q-1 | Other consumers of COMMIT_PUSHED_HANDLER beyond §3.1 scope? | **RESOLVED — greg round-1 §1.** Surfaced 3 ADDITIONAL: test file inline-blocks (§3.1.3) + workflow-run-handler stale comments (§3.1.4) + adapter docstring (§3.1.5). Folded into v1.0 scope. |
| Q-2 | Schema/state-migration required? | **RESOLVED NO — greg round-1 §2.** Code-grep returns zero `substrate.put/createOnly/putIfMatch/store./repo.put` writes. Stateless. |
| Q-3 | Layer (b) adapter-side preserve? | **RESOLVED YES — greg round-1 §3.** Adapter-side hook + NDJSON event-emission stays operational; only docstring revision needed per §3.1.5. |
| Q-4 | Single PR or split? | **RESOLVED SINGLE-PR — greg round-1 §4.** Bounded 5-file edit; atomic-revert simpler. |
| Q-5 | Lightweight Preflight vs skip? | **RESOLVED LIGHTWEIGHT — greg round-1 §5.** 6-category bounded audit ~10min. |

## §6 References

- bug-98 (wontfix; carries full reasoning chain; updated 2026-05-19)
- bug-99 + bug-100 (RESOLVED via PR #216 at 0ce7cf0; substrate-correctness; persist regardless of this retirement)
- bug-101 (production-Hub bootstrap migration-apply; OPEN; INDEPENDENT)
- PR #215 at 65124632 (now-retiring Fix 1 + Fix 2; folded into this mission's retirement scope)
- thread-587 (full triage thread; rounds 1-10)
- thread-588 (Phase 4 Design bilateral round-1; converged 2026-05-19 v0.1 → v1.0)
- idea-303 (source idea; triaged 2026-05-19 with skip-Survey disposition)
- `/home/apnex/taceng/missioncraft/src/missioncraft-sdk/core/principal-resolution.ts` (sibling-repo; 4-step precedence chain; architectural reference)
- `/home/apnex/taceng/missioncraft/src/missioncraft-sdk/core/mission-types.ts` (sibling-repo; writer/reader participant model; architectural reference)
- `docs/designs/m-missioncraft-d2-substrate-design.md` (this-repo missioncraft Design; v5 architectural intent reference)
- mission-68 (origin of commit-pushed-handler subsystem)
- mission-84 (6-PR cycle empirically demonstrating engineer-thread-explicit-surface operational sufficiency)
- `feedback_idea_triage_protocol_skip_criteria` (5-criteria check applied to idea-303)
- `feedback_calibration_ledger_discipline` (architect-Director-bilateral disposition for Phase 10 calibration entry)
- `feedback_bilateral_audit_round_budget_discipline` (v1.0 ratify without round-2 — greg round-1 audit comprehensive)

## §7 Audit ratify-criteria (round-1 engineer-fold satisfied)

| RC-N | Criterion | Status |
|---|---|---|
| RC-1 | All code-change scope items grep-verified | ✅ greg round-1 §1 (5 additional surfaces folded into v1.0 §3.1.3-§3.1.5) |
| RC-2 | `mission-lifecycle.md §1.5.1.1` revision-text drafted | ⏳ engineer-side at Phase 8 PR ship (architect-side revision-text guidance in §3.2.1) |
| RC-3 | All 5 Q-N open-questions resolved | ✅ §5 — all RESOLVED via greg round-1 audit |
| RC-4 | All 13 AG-N acceptance criteria verifier-ready | ✅ AG-4 refined to deterministic test-assertion verifier (greg round-1 §10) |
| RC-5 | Anti-goals confirmed: no alternative attribution mechanism; missioncraft design unchanged; Hub agent label unchanged | ✅ greg round-1 §11 |
| RC-6 | Phase 10 calibration-entry signature drafted (pattern name + diagnostic test + disposition-rubric) | ✅ §3.4 — pattern explicitly named **CROSS-LAYER IDENTITY EXTRACTION** (greg round-1 §9 refinement) |

## §8 Architect inward-calibration note (B-class drift instances in v0.1)

Two architect-spec-vs-code drift instances surfaced by greg round-1:
- §2.3 file-path references to missioncraft files not annotated as sibling-repo (greg correctly grep-confirmed absent from this-repo)
- §3.2 file-path `CLAUDE.md §1.5.1.1` was wrong — section lives at `docs/methodology/mission-lifecycle.md §1.5.1.1`; CLAUDE.md only references §1.5.1 outward

Pattern recurrence (per `feedback_substrate_currency_audit_rubric` + `feedback_architect_review_doc_behavioral_claims_code_verify`): architect-side spec-level recall produces file-path drift; engineer code-grep catches reliably. **Bilateral audit-round structurally essential for architect-authored Design docs.** Folded into v1.0 + noted for Phase 10 calibration batch.
