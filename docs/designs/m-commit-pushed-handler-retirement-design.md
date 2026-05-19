# M-Commit-Pushed-Handler-Retirement — Design

**Version:** v0.1 (architect draft 2026-05-19 — pending engineer round-1 bilateral audit)
**Mission:** TBD (Phase 5 Manifest pending; idea-303 source)
**Class:** substrate-cleanup-wave / subsystem-retirement (Low-class, bounded)
**Source-ratify:** Director-direct W approval 2026-05-19 thread-587
**Survey:** SKIPPED per `feedback_idea_triage_protocol_skip_criteria` 5-criteria (idea-303 triage note)

---

## §1 Statement of Intent

Retire the **commit-pushed-handler** architect-notification subsystem (mission-68 W1; CLAUDE.md §1.5.1.1 Layer (c)) entirely. The subsystem's design premise — mapping `PushEvent.actor.login` (GitHub credential-identity) → individual agent role (Hub-context role-identity) — was architectural overreach. The retirement preserves single-credential operational reality (the correct architectural shape) and relies on engineer-thread-explicit-surface (already operational across mission-84) for architect-side PR-review-readiness signal.

## §2 Architectural Rationale

### §2.1 Identity-layer analysis

Four identity-systems are in play in the current substrate:

| # | System | Layer | Multiplicity | Aligned? |
|---|---|---|---|---|
| 1 | Hub agent label `ois.io/github/login` | Hub-context | per-agent | ✅ individual |
| 2 | Git config `user.name` + `user.email` | Operator-worktree | per-worktree | ✅ individual |
| 3 | GitHub credential (SSH/PAT) | Operator-machine | per-operator (`apnex` org-credential currently) | ❌ singular at machine layer |
| 4 | Missioncraft principal-id (per `principal-resolution.ts` 4-step) | Missioncraft-mission | per-mission (defaults to git config user.email) | ✅ individual |

3 of 4 systems are correctly individually-attributed. System 3 (GitHub credential) is necessarily singular at the operator-machine layer — both lily and greg sibling sessions share the same machine and same `gh auth`. **The architectural error was attempting to extract role-identity (Hub-context layer) from credential-identity (operator-machine layer) via PushEvent.actor.login.** Layer-inverted attribution; cannot be cleanly resolved at the handler layer.

### §2.2 Why no fix-option preserves the original intent

| Option | Disposition | Problem |
|---|---|---|
| X (commit-author parse from /events) | Non-functional | GitHub /events API PushEvent returns `commits[]=0 items` — commits are not in the summarized response; only via webhook delivery or per-SHA /commits/{sha} API call. Verified empirically at thread-587 round-6. |
| Y (per-identity credentials per agent) | Complexity-additive | Forces System 3 into multi-identity shape; requires per-agent SSH-key + per-agent gh-auth-status management at operator machine. Sibling-session sharing pattern (lily + greg on same PC) becomes operationally complex. |
| Z (architect target.agentId resolution) | Symptomatic; downstream | Fix 2 in PR #215 is code-sound but downstream of Fix 1; unreachable if Fix 1 cannot resolve role. |

### §2.3 Missioncraft v5 architectural intent

Missioncraft (per `src/missioncraft-sdk/core/principal-resolution.ts` 4-step precedence chain + `mission-types.ts` writer/reader participant model) intentionally **inherits operator's existing git/gh credentials**. Per-mission credential-management is explicitly out-of-scope. Changing missioncraft to per-mission-credentials would violate its simplicity intent + create duplicated identity-handling — wrong direction per Director-direct simplicity principle.

### §2.4 The architecturally honest framing

Retire the subsystem. Acknowledge that:
- Single-credential at operator-machine layer is the correct architectural shape (matches missioncraft intent; matches sibling-session sharing reality)
- Role-identity belongs at Hub-context layer where it already is (System 1 + System 4)
- Architect-side PR-review-readiness signal is operational via **engineer-thread-explicit-surface** on coord-thread (proven across all 6 PRs of mission-84 + all PRs of bug-99/100/101 cycle)
- Layer (a) methodology + Layer (b) adapter-side hook preserved as engineer-side discipline; Layer (c) Hub-side handler retracted

## §3 Retirement Scope

### §3.1 Code deletions

| # | File | Change |
|---|---|---|
| 1 | `hub/src/policy/repo-event-commit-pushed-handler.ts` | DELETE entire file |
| 2 | `hub/src/policy/repo-event-handlers.ts` | Remove `COMMIT_PUSHED_HANDLER` import + remove from handler-registration list |
| 3 | `hub/src/policy/__tests__/repo-event-commit-pushed-handler.test.ts` (if exists) | DELETE if present |
| 4 | Hub container rebuild via `scripts/local/build-hub.sh` + restart via `scripts/local/start-hub.sh` | Validate handler absent from policy-router state |

### §3.2 Documentation revision

| # | File | Change |
|---|---|---|
| 1 | `CLAUDE.md §1.5.1.1` | **Retract Layer (c) Hub-side handler.** Preserve Layer (a) methodology guidance + Layer (b) adapter-side hook (engineer-side discipline). Add retirement note pointing to this Design + bug-98 wontfix. |
| 2 | `docs/methodology/architect-runtime.md` (if §1.5.1.1 referenced) | Update cross-reference to point to retired-Layer-(c) note |

### §3.3 Bug-entity dispositions

| # | Entity | Action |
|---|---|---|
| 1 | bug-98 | wontfix (already updated 2026-05-19 step 1) — architectural-overreach |
| 2 | PR #215 commits at 65124632 (Fix 1 + Fix 2) | Code retires via §3.1 deletion; no separate revert needed |

### §3.4 Phase 10 retro calibration entry

Architectural-overreach pattern — identity-layer conflation. Pattern signature:
- Mechanism design conflates two layers of attribution (credential vs role)
- Symptom: fix-iterations cannot resolve via mechanism tuning; only via mechanism retirement
- Diagnostic test: "does the data-shape required by the fix exist in the upstream API response?" (X non-functional → no) + "does the alternative require duplicating already-aligned identity systems?" (Y complexity-additive → yes)
- Disposition rubric: retire mechanism; preserve operational alternative (engineer-thread-explicit-surface)

## §4 Acceptance Criteria

| AG-N | Criterion | Verifier |
|---|---|---|
| AG-1 | `hub/src/policy/repo-event-commit-pushed-handler.ts` does not exist | `ls hub/src/policy/ | grep commit-pushed` returns empty |
| AG-2 | COMMIT_PUSHED_HANDLER absent from `repo-event-handlers.ts` | `grep -c COMMIT_PUSHED_HANDLER hub/src/policy/repo-event-handlers.ts` returns 0 |
| AG-3 | Hub builds clean (no broken imports) | `scripts/local/build-hub.sh` exits 0 |
| AG-4 | Hub starts clean + handler absent from policy-router state | Hub log shows policy-router handler list without commit-pushed entry |
| AG-5 | `npm test` green for hub package | `cd hub && npm test` exits 0 |
| AG-6 | CLAUDE.md §1.5.1.1 reflects retirement | grep `§1.5.1.1` for retraction note + bug-98 reference |
| AG-7 | bug-98 status = wontfix | `get_bug bug-98` returns status=wontfix |
| AG-8 | PR opens + cross-approved + admin-merged to main | gh pr view shows MERGED status |
| AG-9 | Mission status flips to completed at Phase 9 close | `get_mission mission-N` returns status=completed |
| AG-10 | Phase 10 calibration entry filed via Director-bilateral | `docs/calibrations.yaml` updated; calibration-ID assigned |

## §5 Open Questions (engineer-side bilateral audit invites)

| Q-N | Question | Architect-current-view |
|---|---|---|
| Q-1 | Are there any other consumers of COMMIT_PUSHED_HANDLER beyond `repo-event-handlers.ts`? | Architect-grep needed; expect none (engineer round-1 to verify) |
| Q-2 | Does retirement require schema-migration (e.g., deleting any persisted state-rows from older commit-pushed-handler runs)? | Architect-view: no — handler is event-consumer with no persistent state; engineer to confirm via code-grep |
| Q-3 | Should adapter-side Layer (b) hook also retire, or remain operational? | Architect-view: Layer (b) PRESERVED as engineer-side discipline (`feedback_adapter_restart_protocol_hub_container` style); only Hub-side Layer (c) retires |
| Q-4 | Single PR or split into 2 (code-delete + CLAUDE.md edit)? | Architect-view: SINGLE PR — bounded scope; atomic-revert simpler if needed |
| Q-5 | Phase 6 Preflight required, or skip-to-Phase-7? | Architect-view: lightweight Preflight (6-category bounded audit; ~10 min) — preserves discipline without ceremony |

## §6 References

- bug-98 (wontfix; carries full reasoning chain; updated 2026-05-19)
- bug-99 + bug-100 (RESOLVED via PR #216 at 0ce7cf0; substrate-correctness; persist regardless of this retirement)
- bug-101 (production-Hub bootstrap migration-apply; OPEN; INDEPENDENT)
- PR #215 at 65124632 (now-retiring Fix 1 + Fix 2; folded into this mission's retirement scope)
- thread-587 (full triage thread; rounds 1-10)
- idea-303 (source idea; triaged 2026-05-19 with skip-Survey disposition)
- `src/missioncraft-sdk/core/principal-resolution.ts` (4-step precedence chain; architectural reference)
- `src/missioncraft-sdk/core/mission-types.ts` (writer/reader participant model; architectural reference)
- mission-68 (origin of commit-pushed-handler subsystem)
- mission-84 (6-PR cycle empirically demonstrating engineer-thread-explicit-surface operational sufficiency)
- `feedback_idea_triage_protocol_skip_criteria` (5-criteria check applied to idea-303)
- `feedback_calibration_ledger_discipline` (architect-Director-bilateral disposition for Phase 10 calibration entry)
- `feedback_architect_drives_engineer_engagement_when_idle` (engineer round-1 bilateral audit IS the methodology-canonical Design phase)

## §7 Audit ratify-criteria (round-1 engineer-fold targets)

| RC-N | Criterion | Status |
|---|---|---|
| RC-1 | All 3 code-deletion scope items grep-verified (no stray COMMIT_PUSHED_HANDLER references beyond the 2 named files) | pending engineer round-1 |
| RC-2 | CLAUDE.md §1.5.1.1 revision-text drafted + reviewed | pending engineer round-1 (architect to draft inline at v0.2 if engineer requests) |
| RC-3 | All 5 Q-N open-questions resolved or marked deferred-with-rationale | pending engineer round-1 |
| RC-4 | All 10 AG-N acceptance criteria verifier-ready (executable check) | pending engineer round-1 |
| RC-5 | Anti-goals confirmed: no alternative attribution mechanism introduced; missioncraft design unchanged; Hub agent label unchanged | pending engineer round-1 |
| RC-6 | Phase 10 calibration-entry signature drafted (pattern + diagnostic test + disposition-rubric) | done in §3.4 (v0.1); engineer-fold may refine |
