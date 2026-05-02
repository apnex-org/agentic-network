# M-Claude-Plugin-Install-Bootstrap-Skills — Architect-side work-trace (mission-71)

**Mission:** mission-71 (status: active → pending mission-flip post-PR-merge)
**Engineer-side trace:** N/A — architect-Responsible execution per Phase 6 preflight §B3 (no plannedTasks; outside cascade per mission-68 §4.3 + mission-69 + mission-70 precedent); engineer cross-approves at Phase 8 PR-open per standard bilateral-PR-review pattern
**Architect-side trace:** this doc; covers Phase 8 implementation + Phase 9 closing audit + Phase 10 retrospective per mission-69 + mission-70 compressed-lifecycle precedent
**Author:** lily (architect)

---

## Purpose

Sovereign work-trace for compressed-lifecycle architect-Responsible substrate-introduction mission. Captures Phase 8 implementation log + verification + Phase 9 closing audit + Phase 10 retrospective in single artifact.

---

## Phase 8 — Implementation execution

Per Design v1.0 §3 + §4 + §6 + §7 content map. Sequential delivery in order: claude-plugin lib extraction → orchestrator wire-up → skill retrofit → tests → integration smoke-test.

### Δ8.1 — Architecture refinement during implementation: lib/ extraction

**Original Design §3.1**: bootstrap_skills() + merge_skill_permissions() + emit_snippet_fallback() defined inline in install.sh after main flow.

**Implementation-time refinement:** extracted the 3 functions into `adapters/claude-plugin/lib/bootstrap-skills.sh` (~190 lines). install.sh sources the lib via `source "$PLUGIN_DIR/lib/bootstrap-skills.sh"` (~7 lines added).

**Reason:** unit testing required isolated function-level invocation. Sourcing install.sh in tests triggers the full main flow (npm build, claude CLI calls). Extracting to lib makes the bootstrap surface unit-testable without depending on `claude` CLI presence or npm tooling.

**Architectural improvement, not regression:** matches conventional bash project structure (orchestrator script + library file). install.sh stays small + focused on top-level orchestration; lib carries the Skill bootstrap mechanism.

**μ-finding:** Design v1.0 §3.1 pseudocode showed inline definitions; lib extraction emerged at implementation-time. Round-1+2 audits didn't flag this — both reviewed the inline approach. **For substrate-introduction missions involving bash function-level testing, lib-extraction should be considered at Design-phase for testability.** Methodology-fold candidate (parking).

### Δ8.2 — C1 helper-extraction implementation

Extracted `detect_repo_root()` + `detect_context()` from inline blocks at install.sh lines 24-35 into named functions. **Per Design §3.1.a "actual extraction preserves current behavior verbatim":** kept the existing `[ -d "$PLUGIN_DIR/../../packages/network-adapter" ]` detection test, NOT the package.json walk-up sketched in pseudocode (which was shape-only).

Verified by `bash -n install.sh` syntax-check + integration test running source-tree mode end-to-end.

### Δ8.3 — bootstrap_skills() orchestrator + merge_skill_permissions() + emit_snippet_fallback()

All 3 functions implemented per Design §3.1.b + §3.4 + §3.4.fallback specs. Folds applied:
- M5 fold: `shopt -s nullglob` at function entry (avoids literal-glob expansion under `set -e`)
- m3 fold: skills_dirs array form (zero-cost future-proof per AG-7)
- C2+C3 fold: `--target=user` invocation (user-global symmetry; resolves npm-installed REPO_ROOT bug)
- M1 fold: schema-version major-version-compat (`^1\.` regex match)
- M2 fold: exact-string-match dedup (limitation documented; AG-8 forward-pointer)
- M4 fold: step 2.5 ensures `permissions.allow` exists if `permissions` does but key absent
- M7 fold: emit_snippet_fallback() lives at claude-plugin level, synthesizes from in-memory fragment data
- N1 fold (round-2): npm-installed `pkg_root = PLUGIN_DIR` (no `/..`); restored from v0.2 regression
- n1 fold (round-2): process substitution `< <(jq ...)` preserves outer-scope `first` mutation across iterations

**Bug caught at integration smoke-test (NEW; not in either audit round):** function returns trailing `[ ${#failed[@]} -gt 0 ] && printf ...` evaluates as last command; if condition false (empty array), function returns exit code 1. Caused `set -euo pipefail` callers to fail on success. **Fix:** explicit `return 0` at end of `bootstrap_skills()`. **μ-finding:** bash-function-trailing-conditional-chain pattern is a `set -e` correctness hazard; should be added to round-1 audit checklist for substrate-introduction missions involving bash. Single-instance carry-as-awareness.

### Δ8.4 — skills/survey/ retrofit (per AG-5)

3 changes per Design §4:
1. **Added** `skills/survey/.skill-permissions.json` (9 lines; v1.0 schema with 2 patterns covering project-relative + symlink-resolved invocation paths per existing v1.1 SKILL.md guidance; M2 limitation documented inline)
2. **Modified** `skills/survey/install.sh`:
   - Added `--silent` flag + `say()` helper
   - Removed manual-snippet-print logic (lines 119-128 of v1.1)
   - Added new bare success message "[install] Permissions: handled by claude-plugin bootstrap..."
   - Updated top-of-file comment to reflect mission-71 ship + AG-7 pure-bash compliance preserved
   - **M3 fold preservation:** kept existing refuse-and-exit on stale/different-source symlink (lines 96-106 of v1.1; safer than auto-remove)
3. **Bumped** `skills/survey/SKILL.md`:
   - Frontmatter `version: v1.1 → v1.2` + NEW `permissions-fragment: .skill-permissions.json` field
   - Replaced §Install (interim; pre-idea-230 automation) with new §Install referencing claude-plugin bootstrap as primary path + standalone path as fallback
   - NEW §Customization section (per F4 fold)
   - Added v1.1 → v1.2 migration note (per greg's surface check)
   - Updated §Cross-references: idea-230 marked shipped via mission-71; mission-71 added as cross-ref

### Δ8.5 — Test deliverables

**μ-finding caught at preflight (already documented in §F3 of preflight):** `adapters/claude-plugin/install.test.sh` referenced as "(existing): extend" in Design §6.1 + greg's round-1 audit but did NOT exist in working tree. Both audits assumed it existed. CREATED from scratch in Phase 8 modeled on `skills/survey/install.test.sh` pattern.

Tests delivered:
- `adapters/claude-plugin/install.test.sh` (NEW; 12 cases covering bootstrap_skills + merge_skill_permissions + emit_snippet_fallback) — **24 assertions / 24 PASS**
- `skills/survey/install.test.sh` (extended with 3 new test sections + 5 new assertions for `--silent` flag + M6 retrofit verification + --help listing) — **18 assertions / 18 PASS** (was 13)
- `scripts/local/test-skill-bootstrap.sh` (NEW; integration smoke-test against live repo) — **9 verification-gate assertions / 9 PASS**

**Total: 51/51 test assertions PASS** across 3 test suites.

### Δ8.6 — Verification gates per Design §6.3

| Gate | Result |
|---|---|
| §6.1 + §6.2 all pass on PR branch | ✅ 51/51 PASS |
| `git grep -c "settings.local.json" skills/survey/install.sh` → 0 (M6 fold) | ✅ 0 |
| `cat skills/survey/SKILL.md \| grep -c "v1.2"` → ≥1 | ✅ 2 (frontmatter + migration note) |
| `jq . skills/survey/.skill-permissions.json` exits 0 | ✅ 0 |
| `jq -e '.["schema-version"]' ... \| grep -E '^"1\\.'` returns 0 | ✅ matches "1.0" |

All gates GREEN.

---

## Phase 9 — Closing audit (architect-direct)

Compressed inline per mission-69 + mission-70 precedent.

| # | Check | Result | Notes |
|---|---|---|---|
| F1 | Design §3 implementation completeness | ✅ PASS | All 3-mechanism functions delivered (bootstrap_skills + merge_skill_permissions + emit_snippet_fallback); lib-extraction architectural improvement noted; helpers extracted per C1; all 17 audit-folds preserved correctly |
| F2 | §4 retrofit completeness | ✅ PASS | .skill-permissions.json shipped + install.sh modified per AG-5 + SKILL.md bumped v1.1 → v1.2 + §Customization NEW + v1.1 migration note added per greg's surface check |
| F3 | Test coverage adequacy | ✅ PASS | 12 cases in claude-plugin install.test.sh covers all CRITICAL/MEDIUM/MINOR fold-class regressions; integration test verifies real-skill end-to-end; 51/51 PASS |
| F4 | Verification gates §6.3 | ✅ PASS | All 5 gates GREEN |
| F5 | Anti-goals respected | ✅ PASS | AG-1 schema locked to permissions.* / AG-2 no continuous-sync added / AG-3 detect_context preserved verbatim / AG-4 no per-RACI install filtering / AG-5 retrofit (NOT deprecate) / AG-6 sovereign-Skill methodology NOT codified / AG-7 single skills_dir source-array form / AG-8 NEW exact-match v1 floor (no permission-pattern-normalization) |
| F6 | Cross-references stable | ✅ PASS | idea-230 incorporated → mission-71 active; thread-465 sealed converged; SKILL.md cross-refs updated; idea-228+229 unchanged; calibration #59 closure mechanism (a) 4th-canonical (push pre-bilateral round-1 audit; verified) |
| F7 | μ-findings caught at execution-time | ✅ DOCUMENTED | 4 μ-findings surfaced post-Design-ratify: (μ7-impl1) lib-extraction at Design-phase for testability; (μ7-impl2) bash-function-trailing-conditional-chain `set -e` hazard; (μ7-impl3) preflight should verify referenced-existing files actually exist (the install.test.sh gap); plus carry-forward of μ5 (refactor-introduces-regression) from round-2 audit. All parked for Phase 10 retrospective + memory consideration |

**Verdict: GREEN-with-μ-findings.** All deliverables shipped + tested; substantive μ-findings parked for retrospective consumption.

---

## Phase 10 — Retrospective (compressed; embedded)

**Mode pick:** Summary-review per `mission-lifecycle.md` §Phase 10 three-mode taxonomy. Rationale: substrate-introduction class with first-canonical sub-class (consumer-install layer for sovereign-Skill pattern); ~2-3hr architect-side; substantive bilateral-cycle execution + μ-findings worth surfacing.

**Mission outcomes:**
- ✅ Director-intent envelope satisfied: 6 picks across 2 Survey rounds → 3-mechanism composition delivered exactly as specified
- ✅ Bilateral-cycle discipline tested + extended: 3-round audit cycle (15 round-1 + 2 round-2 NEW = 17/17 folds); round-2 verify caught C1-refactor-introduced regression that single-pass would have missed
- ✅ 1st-canonical "consumer-install layer" precedent established for sovereign-Skill umbrella (idea-229)
- ✅ Survey Skill v1.1 → v1.2 retrofit clean; backward-compat preserved for v1.1 manually-pasted permission entries

**μ-findings consolidated for future mission consumption:**

- **μ7-impl1 (Design phase):** for substrate-introduction missions involving bash function-level testing, lib-extraction should be considered at Design-phase. Round-1+2 audits didn't catch the testability concern; emerged at Phase 8 implementation. Methodology-fold candidate: add "testability" as Design §X dimension.
- **μ7-impl2 (bash safety):** bash-function-trailing-conditional-chain (`[ cond ] && action`) returns 1 when condition false; `set -euo pipefail` callers fail spuriously. Add to round-1 audit checklist for any bash-substrate mission. Single-instance carry-as-awareness; calibration-class candidate if 2nd-canonical surfaces.
- **μ7-impl3 (preflight discipline):** Design §6.1 + greg's round-1 audit + my round-2 verify ALL referenced `adapters/claude-plugin/install.test.sh` as "(existing): extend"; the file did NOT exist. Caught at preflight §F3 + folded to CREATE-not-extend. **Pattern: verify referenced-existing files actually exist at Design-ratify time.** Composes with `feedback_compressed_lifecycle_preflight_currency_checks.md` — both are "what bilateral-audit-cycle catches that compression bypasses, OR doesn't catch even with bilateral".
- **μ7-impl4 (carry-forward):** μ5 from thread-465 round-2 (refactor-introduces-regression-during-fold) confirmed by Phase 8 implementation experience — the C1 helper-extraction REFACTOR introduced N1 regression in v0.2 that round-2 caught. Strengthens the `feedback_refactor_introduces_regression_during_fold.md` memory entry. Still single-instance for the catch; needs 2nd-canonical for calibration filing.

**Methodology-fold candidates (parking; carry-forward to architect strategic-review):**

1. Design-phase testability dimension (μ7-impl1) — could be folded into `mission-lifecycle.md` Phase 4 Design template if 2nd-canonical surfaces
2. Bash-substrate audit checklist (μ7-impl2) — single-instance; awareness-only
3. Preflight referenced-file existence verification (μ7-impl3) — composes with existing memory `feedback_compressed_lifecycle_preflight_currency_checks.md`; consider adding sub-row to that entry's "Class N" enumeration

**No methodology-doc edits in mission-71 (per AG-6 + AG-9 carve-out from mission-69).** All μ-findings parked for separate strategic-review-driven methodology-fold mission.

---

## Cross-references

- **Mission entity:** mission-71 (status: active → completed pending mission-flip post-merge)
- **Source idea:** idea-230 (status: incorporated; missionId=mission-71)
- **Companion ideas:** idea-228 (1st-canonical Skill instance via mission-69) + idea-229 (parked umbrella; this mission = 1st-canonical consumer-install layer)
- **Design v1.0 RATIFIED:** `docs/designs/m-claude-plugin-install-bootstrap-skills-design.md` (commit `0a23add`)
- **Phase 6 preflight (verdict: GREEN):** `docs/missions/m-claude-plugin-install-bootstrap-skills-preflight.md`
- **Survey envelope:** `docs/surveys/m-claude-plugin-install-bootstrap-skills-survey.md` (commit `b6f3c5b`)
- **Bilateral thread:** thread-465 (sealed converged 2026-05-02; 3 rounds; 2 close_no_action committed; bilateral seal)
- **Phase 8 deliverables (this PR):**
  - `adapters/claude-plugin/install.sh` (modified; +helpers extraction +source-lib-bootstrap +invocation; -inline-detection-block)
  - `adapters/claude-plugin/lib/bootstrap-skills.sh` (NEW; ~190 lines)
  - `adapters/claude-plugin/install.test.sh` (NEW per μ7-impl3; 12 cases / 24 assertions / 24 PASS)
  - `skills/survey/.skill-permissions.json` (NEW; 9 lines; v1.0 schema)
  - `skills/survey/install.sh` (modified; +--silent flag +say helper; -manual-snippet-print)
  - `skills/survey/install.test.sh` (extended; +3 test sections / +5 assertions; 18 PASS total)
  - `skills/survey/SKILL.md` (bumped v1.1 → v1.2; new §Customization; updated §Install + §Cross-references)
  - `scripts/local/test-skill-bootstrap.sh` (NEW; integration smoke-test; 9 verification gates / 9 PASS)
  - `docs/designs/m-claude-plugin-install-bootstrap-skills-design.md` (v0.1 → v0.2 → v1.0 RATIFIED)
  - `docs/missions/m-claude-plugin-install-bootstrap-skills-preflight.md` (NEW)
  - `docs/surveys/m-claude-plugin-install-bootstrap-skills-survey.md` (NEW)
  - This work-trace (NEW)
- **Calibration ledger:** `docs/calibrations.yaml` (closures-applied: []; candidates-surfaced: refactor-introduces-regression-during-fold class — single-instance + reinforced by Phase 8 experience; bash-function-trailing-conditional-chain `set -e` hazard — single-instance)
- **Compressed-lifecycle precedent:** mission-67/68/69 (substrate-introduction sub-class; sovereign-doc-substrate) + mission-70 (governance-doc-reconcile sub-class) + mission-71 (substrate-introduction sub-sub-class: consumer-install layer for sovereign-Skill umbrella; 1st-canonical)

---

— Architect: lily / 2026-05-02 (mission-71 architect-side trace; Phase 8/9/10 single-doc compressed-lifecycle artifact per mission-69 + mission-70 precedent)
