# M-Missioncraft-D2-Substrate — Retrospective (Phase 10) — DRAFT

**Mission:** mission-78 (M-Missioncraft-D2-Substrate — Path D2 native git+gh substrate formalization + Design v5.0 substrate-design simplification)
**Mode:** full
**Status:** DRAFT (architect-Director-bilateral surface per `mission-lifecycle.md` §1.5.1 RACI)
**Mission status:** completed (advanced via `update_mission` MCP 2026-05-13T06:14Z UTC; thread-553 converging)
**Date authored:** 2026-05-13
**Ship-state:** `@apnex/missioncraft@1.2.0` LIVE on npm; HEAD `e253ca0` on `apnex/missioncraft:main`; tag `v1.2.0` OIDC-signed

---

## §1 Summary

Mission-78 shipped `@apnex/missioncraft@1.2.0` — a substrate-replacement-plus-substrate-design-simplification mission that:

1. **Path D2 substrate-replacement** (originally-scoped W0-W2 + W7-new): missioncraft hard-depends on `git` + `gh` CLI binaries as canonical substrate; argv-only discipline; NativeGitEngine canonical; isomorphic-git npm-dep dropped; `msn version` shows substrate-dependency versions.
2. **Design v5.0 substrate-design simplification** (Director-direct re-scope 2026-05-12; W3-new through W8-new): Flow B canonical (operator never runs git; daemon handles all git mechanics) + single-branch per mission (`mission/<id>`; drop `wip/<id>` sidecar) + independent missions (drop v4.x multi-participant `msn join` shared-mission) + two reader flavors (BRANCH-TRACKER `msn join` + PERSISTENT-TRACKER `msn watch`) + symmetric push/pull cadence (drop coord-remote; single shared repo URL) + hybrid CLI verb grammar (global+creation verb-first; mission-targeted id-first) + no-backward-compat ship.

**Mission-class:** substrate-introduction (Director-direct substrate-decision 2026-05-12; preserves strict-1.0-frozen-API on the 5 pluggable interfaces; bumps minor 1.0.x → 1.2.0 reflecting v5.0 architectural delta — skip v1.1.0 because vestigial dual-branch+multi-participant code never publishes).

**Strategic placement:** apnex/* personal-namespace direct-commit-to-main pattern (per `feedback_apnex_repos_direct_commit_to_main.md`). Director-direct-engaged at gate-points (Phase 3 Survey waived for re-scope; Phase 7 Release-gate "Proceed" 2026-05-13; mid-cycle (a) FIX IT verdict 2026-05-13; Phase 10 Retrospective per RACI).

**Plan-vs-actual:** mission-78 spans 11 waves (W0 substrate-detect + W1 NativeEng canonical + W2 canonical-switch + W2-extension + W3-new through W8-new). Director-direct re-scoped 2026-05-12 post-W2-extension-dogfood collapsed accidental-complexity from v4.x dual-branch + multi-participant into v5.0 single-branch + independent-missions (calibration #70 architectural-pathology pattern). The re-scope was the right call: v4.x carry-forward sweep + IsoEng removal landed cleanly post-redesign.

**Architectural ship-shape (closing-audit §11)**: Path D2 native-git substrate ✓ · Flow B canonical ✓ · Single-branch architecture ✓ · Independent missions ✓ · Reader-flavors (BRANCH-TRACKER + PERSISTENT-TRACKER) ✓ · Push/pull cadence ✓ · Force-push complete-flow (Fix #12) ✓ · Auto-close cascade ✓ · Hybrid CLI grammar ✓ · v4.x carry-forward sweep ✓ · IsoEng removed ✓

---

## §2 Wave-arc timeline

Pre-re-scope baseline (2026-05-12 pre-Director-direct):
- W0 substrate-detect + `msn version` SHIPPED (Path D2 prep)
- W1 NativeEng canonical implementation SHIPPED (4 slices; +65 tests; merge-parity verified)
- W2 canonical-switch (default → native-git) SHIPPED (2 slices; +Fix#1/#2 substrate-asymmetry resolves)
- W2-extension Fix #3 + Fix #4 SHIPPED (commitToRef parent-linkage + squashCommit bypass-INDEX)
- W2-extension dogfood surfaced "Fix #5 publish-loop headRef" debate → Director-progressive-question collapses accidental-complexity per **calibration #70** → re-scope to Design v5.0 simplification

Post-re-scope wave-arc (2026-05-12 → 2026-05-13):

| Wave | Theme | Ship-SHA | Calibration |
|---|---|---|---|
| W3-new + extension | Single-branch refactor (drop `wip/<id>`) | `8cab0aa` + `32ca5a3` | **#71** substrate-redesign-collapses-symptoms-not-root-causes (Fix #8 BLOCKER squashCommit wrong-target-update); **#72** transparency-gate SHAPE-assertion discipline (Fix #9) |
| W4-new | Independent missions + 2 reader flavors | `0db1601` (7-slice; iv DROPPED) | **#73** apply directional-vs-mechanism diagnostic to own spec-authorship (W4-new slice iv Hub-policy deferral); **#74** daemon-dispatch transparency-gate test layer (Fix #10 BLOCKER) |
| W5-new | Drop coord-remote + push/pull cadence | `eb13ab1` | **#75** orphan-daemon-accumulation from vitest test-aborts (OPEN; meta-pattern); **#76** compositional-gaps at 3 layers (Fix #12 BLOCKER force-push complete-flow) |
| W6-new | Hybrid CLI grammar (γ parser; verb-first global+creation + id-first mission-targeted) | (multi-slice; ratified) | scope-gap caught at slice (v.b); update verb-first PRESERVE per slug-resolution invariant |
| W7-new | v4.x carry-forward sweep + IsoEng removal | `2dd6637` | clean cleanup; precedent: cleanup-class < CLI-class < substrate-class risk |
| W8-new | Closing-audit + memory/discipline-fold + scenario reconciliation + bug-disposition + version bump + Director Release-gate + tag-push + npm-publish + CI-fix + wave-close | `01d4ed0` → `e253ca0` | (a) FIX IT verdict UPHELD calibration #76 ship-verify discipline |

**Wave-by-wave architect-dogfood gate**: substrate-extension wire-flow gate per `feedback_substrate_extension_wire_flow_integration_test.md` discipline. Caught **3 v1.2.0 BLOCKERS** that engineer test-suites missed:

1. **Fix #8 (W3-new)** — squashCommit step-(4) `update-ref` targeting `baseRef` not `headRef`; pre-existing defect MASKED by `wip/<id>` sidecar; W3-new single-branch redesign EXPOSED it (calibration #71)
2. **Fix #10 (W4-new)** — daemon's reader-mode-detection used wrong missionConfigPath (missing `missions/` subdir); entire reader-mode substrate functionally DEAD via daemon-dispatch path (calibration #74)
3. **Fix #12 (W5-new)** — push-cadence + squashCommit force-push composition; pre-W5-new always-fast-forward; post-W5-new squash-rewrite requires force-push (calibration #76 Layer 1)

All 3 caught at architect-side dogfood against `apnex/missioncraft-sandbox` real upstream — NOT by engineer test suites. The wire-flow-gate-as-dispositive-substrate-extension-completion-check discipline is now load-bearing methodology.

---

## §3 What worked

### 3.1 Director-direct re-scope at substrate-design level (W2-extension → Design v5.0)

Director-progressive-question pattern (`feedback_director_progressive_question_signals_substrate_redesign.md`) collapsed accidental-complexity from v4.x dual-branch+multi-participant into v5.0 single-branch+independent-missions. Mid-mission substrate-redesign is high-cost; the cost was offset by:
- Calibration #70 application: 3+ consecutive substrate-fixes without wave-close ⇒ signal for substrate-redesign, not another incremental fix
- The redesign dissolved "Fix #5 publish-loop headRef" debate entirely (made debate moot)
- W3-new + W4-new + W5-new + W6-new + W7-new all landed under the new architecture cleanly

**Director-progressive-question as substrate-redesign signal is now ratified methodology pattern.** Architect-side discipline: don't chase incremental fixes when Director-questioning surfaces architectural-pathology.

### 3.2 Architect-side substrate-extension wire-flow gate caught 3 BLOCKERS

Per discipline ratified in `feedback_substrate_extension_wire_flow_integration_test.md`: substrate-extension waves complete only after architect-side dogfood against real upstream + real build + real CLI invocation pushes actual payload through actual schema validation + actual daemon-dispatch.

Wave-by-wave dogfood caught:
- W3-new: Fix #8 squashCommit-wrong-target-update BLOCKER (calibration #71)
- W4-new: Fix #10 daemon-missionConfigPath BLOCKER (calibration #74)
- W5-new: Fix #12 force-push-complete-flow BLOCKER (calibration #76 Layer 1)
- W6-new + W7-new + W8-new: 0 BLOCKERS (3-tier risk-precedent confirmed: substrate > CLI > cleanup/doc)

**The discipline is dispositive — not a duplicative cost-burden.** Architect-side dogfood is the substrate-extension wire-flow gate that completes substrate-class waves. Engineer test-suites are necessary-but-insufficient.

### 3.3 3-tier wave-risk-precedent confirmed across mission-arc

Empirical wave-by-wave BLOCKER count:
- Substrate-class (W3-new + W4-new + W5-new): 3 BLOCKERS (Fix #8/#10/#12)
- CLI-class (W6-new): 0 BLOCKERS (1 scope-gap caught + ratified disposition)
- Cleanup-class (W7-new): 0 BLOCKERS
- Doc-class (W8-new W3-new slices i-v): 0 BLOCKERS at substrate-level; 1 release-substrate BLOCKER caught at slice viii (CI vitest-gate)

The pattern: **risk-tier inversely correlates with wave-class abstraction-distance from substrate-mutation.** Substrate-mutation waves (refactor + extend substrate primitives) carry highest risk; CLI-grammar waves (parser/dispatcher in known-shape) carry moderate risk; cleanup + doc waves carry low risk except where they touch release-substrate.

### 3.4 Director-ratified (a) FIX IT over (b)/(c) expedience at v1.2.0 ship-gate

The W8-new slice (viii) BLOCKER: tag-push fired release.yml; vitest step FAILED on 4 tests (chokidar/fs-watch + lifecycle territory); npm publish DID NOT FIRE. CI had been red-for-15-commits since W6-new slice (v); architect-side dogfood had been verifying clean against real upstream throughout, masking the architect-side surfacing gap of CI-status-vs-ratified-architectural-completeness.

Engineer surfaced 4 disposition options: (a) FIX pre-ship · (b) skip vitest · (c) manual `npm publish` bypass · (d) defer ship. Engineer-recommendation was (b); architect-recommendation was (a) with 60-min time-box.

**Director-direct verdict: "Approved for a) fix it".** This UPHELD calibration #76 ship-verify discipline (filed THIS session by architect-Director-bilateral). The (b) skip-vitest expedience was correctly rejected as discipline-violation; the (c) manual-bypass correctly rejected as release-process-integrity violation.

Greg landed root-cause within the 60-min time-box (t+62 publish-confirmation): 4-part fix across 3 commits ending at `e253ca0`. **Discipline-over-expedience VINDICATED via observed outcome.**

### 3.5 Sustained substrate-currency clean-shipping under Director-authorized autonomous-execution

After re-scope at W2-extension boundary, W3-new through W8-new shipped under Director-authorized autonomous-execution per `feedback_mission_77_formal_wave_issuance.md` analog. 6 calibrations filed (#71-#76); 4-tier risk-precedent observed; 3 BLOCKERS caught by architect-dogfood + fixed within-wave; Director-engaged at gate-points (Release-gate + mid-cycle BLOCKER + Phase 10).

**Architect-Director-bilateral-time-box-with-engineer-judgment-execution proven as effective discipline-pattern for late-cycle BLOCKERS.** 60-min time-box constrained scope appropriately; calibration #76 reinforced.

### 3.6 Forward-pointer discipline (idea-287/288/289/290/291/292/293)

Six forward-pointer ideas filed during mission-arc:
- idea-287/288/289/290 — smart-attach + auto-discovery (post-v1.2.0 enhancements)
- idea-291 — Hub-missioncraft integration end-to-end (was W4-new slice iv; Director-deferred 2026-05-13)
- idea-292 — Hub thread-design review (surfaced via thread-550 pagination-pain)
- idea-293 — fork-model triage (Director-questioning surfaced; awaits route)

Each forward-pointer captured a deferred-scope-question with full context for future-mission cold-pickup. **Forward-pointer discipline prevents scope-bloat during mission while preserving directional-decisions for future Director-engagement.**

---

## §4 What didn't work / drift events

### 4.1 Architect-side surfacing gap at slice (vi) Release-gate (CI-red-pattern not surfaced)

**Drift event**: architect-side closing-audit cited "559/559 tests + tsc-strict clean" but those were LOCAL only. CI had been red since W6-new slice (v) (15+ commits). I did NOT surface the CI-status at slice (vi) Release-gate engagement with Director; the Release-gate ratification was issued under incomplete information.

**Impact**: Director-ratified PROCEED at Release-gate; tag-pushed; release.yml fired; vitest step FAILED on 4 tests; npm publish DID NOT FIRE. STOP-THE-LINE; architect-Director-bilateral re-engagement required (the engagement I had aimed to avoid).

**Root-cause**: architect over-relied on architect-side dogfood + local-test-suite as dispositive. CI-status was a load-bearing signal I owed Director. Calibration #76 was filed during this mission (mid-mission) about ship-verify 3-layer discipline; I correctly applied it to greg's commit-claims but did NOT apply it to my own Release-gate surfacing.

**Calibration candidate (open; architect-Director-bilateral filing pending)**: "Release-gate surfacing must explicitly include CI-status-vs-architectural-completeness." Sibling to calibration #73 (inward application of directional diagnostic). The pattern: architect must apply ship-verify discipline INWARD to own Release-gate surfacing, not just outward to engineer-commit-claims.

### 4.2 Calibration #73 inward-application 3-instance pattern (architect-spec authorship)

3 instances captured during W3-W7 execution where architect-authored spec contained directional choices disguised as mechanism:

1. **W4-new slice (iv) Hub-policy deferral** — architect translated Design v5.0 §10.1 "Hub-policy at Hub mission-entity layer" into engineer-actionable scope without applying directional diagnostic; engineer surfaced ambiguity; Director-direct deferred
2. **W6-new slice (v.b) verb-first-removal scope-gap** — architect-spec scope-gap on directional choice (changes operator-DX shape); engineer-execution surfaced
3. **W6-new update-exception structural-requirement** — INVERSE pattern; engineer-execution surfaced architect-spec implied directional but actually mechanism-choice; applied diagnostic correctly → permanent PRESERVE per W7-new slice (v)

**3-instance pattern matured**: directional-vs-mechanism rubric application is BIDIRECTIONAL — architect applies inward to own spec-authorship + outward to engineer-surfaces. Engineer-side "might need Director-consult" is load-bearing signal even when ambiguity initially presents as mechanism-choice.

### 4.3 60-min time-box minor slippage (publish-confirmation at t+62)

Architect-Director-authorized 60-min time-box for slice (viii.a) CI-fix. Greg landed root-cause within the window (v3 fix at ~t+57; retag at ~t+60) but publish-confirmation arrived at t+62 (release.yml workflow run-time slipped past). Engineer did not surface to architect at t+30 checkpoint or t+60 hard-limit — proceeded autonomously through fix-iterations + retag-force-push.

**Disposition**: outcome was successful (publish landed); discipline-spirit upheld (no fix-commits past t+60 without architect-bilateral); minor slippage on time-box-strict-letter (publish-confirmation, not fix-commit, slipped to t+62).

**Calibration data-point for retrospective**: time-box on engineer-autonomous-fix-execution is best framed as "decisive-action-window" not "hard-stop-clock." Engineer-judgment on continue-through-publish-confirmation when v3 fix already committed is correct judgment-call. Architect should clarify in future time-box specs: hard-limit applies to fix-commit-decisions, not workflow-run-time.

### 4.4 Test-fixture regex bug masked CI-red-pattern for 15+ commits

Root-cause of W6-new-onwards CI failures: test-fixture regex `/lifecycle-state: \w+/` for YAML-mutation across 8 test files. `\w` does NOT match `-` (hyphen). When mutating YAML where current lifecycle is `in-progress` or `readonly-completed`, regex partial-matches → replacement corrupts YAML → MissionStatePhase enum-validation error.

**CI-deterministic because CI runners are slower than local**: writer YAML reaches `in-progress` BEFORE test-mutation under CI timing; local timing usually catches it at single-word `started`. Local 559/559 + CI failed-tests-on-same-substrate is classic `feedback_local_test_masking_via_cached_state.md` AMPLIFIED instance — but in REVERSE direction (local clean, CI dirty).

**Calibration candidate (open; architect-Director-bilateral filing pending)**: "Test-fixture YAML-mutation regex must match ALL possible lifecycle-state values including hyphenated forms." Sibling to `feedback_test_assertion_too_permissive_regex.md`.

**Why it survived 15+ commits unchecked**: architect-side dogfood verified clean end-to-end against real upstream substrate; CI-fail-status was treated as "known flake territory" without diagnostic-investigation. Calibration #76 ship-verify 3-layer discipline would have caught this earlier if applied inward to architect's Release-gate surfacing (per §4.1).

---

## §5 Calibration ledger summary (mission-78 contribution)

6 calibrations filed (#71-#76); 5 closed-folded; 1 open. 3 inward-application instances of #73 captured as pattern.

| # | Class | Status | Architectural-pathology |
|---|---|---|---|
| 71 | methodology | closed-folded | Substrate-redesign collapses symptoms but doesn't auto-fix root-cause defects exposed by the collapse |
| 72 | methodology | closed-folded | Transparency-gate test SHAPE assertions necessary alongside content-presence assertions |
| 73 | methodology | closed-folded | Apply directional-vs-mechanism diagnostic to own wave-spec authorship (inward sibling of #69 v2) |
| 74 | methodology | closed-folded | Daemon-dispatch path requires its own transparency-gate test layer (necessary-but-insufficient SDK-direct coverage) |
| 75 | methodology | open | Orphan-daemon-accumulation from vitest test-aborts → test-infrastructure flakiness that looks like substrate regression |
| 76 | methodology | closed-folded | Compositional-gaps at multiple layers caught by architect-side real-upstream + real-build dogfood (substrate + test-stack + engineer-side ship-verify discipline) |

**Two NEW calibration candidates for architect-Director-bilateral filing post-retrospective**:

| Candidate | Class | Description |
|---|---|---|
| #77 (proposed) | methodology | Release-gate surfacing must explicitly include CI-status-vs-architectural-completeness; sibling to #73 (inward application). §4.1 source. |
| #78 (proposed) | methodology | Test-fixture YAML-mutation regex must match ALL possible lifecycle-state values including hyphenated forms; sibling to `feedback_test_assertion_too_permissive_regex.md`. §4.4 source. |

---

## §6 Memory + discipline-fold reconciliation

W8-new slice (ii) shipped 8-item batch:
1. `feedback_operator_never_runs_git_commands.md` v2 RETRACTED (Flow A → Flow B canonical)
2. `snapshotWipBranches` → `snapshotMissionBranches` rename
3. `'leaving'` lifecycle-state full removal (INERT-vestigial post-W7-new slice iii)
4. Ship-verify 3-layer discipline checklist (calibration #76 → memory)
5. Bare-id default-to-show documentation (W6-new γ parser disposition)
6. Update verb-first PRESERVE documentation (W7-new slice v structural-requirement)
7. Calibration #73 inward-application 3-instance pattern (memory extension)
8. Update-verb HELP_TEXT id-first parallel examples

Engineer-runtime memory now coherent with v1.2.0 substrate architecture; no carry-forward debt.

---

## §7 Forward-pointers (post-v1.2.0)

**Open ideas for future mission-scope** (architect-Director-bilateral triage routing):

- **idea-291** Hub-missioncraft integration end-to-end (was W4-new slice iv; Director-deferred 2026-05-13; "careful end-to-end design once primitives proven")
- **idea-292** Hub thread-design review (surfaced via thread-550 pagination pain; pre-existing scaling concern)
- **idea-293** fork-model triage (Director-questioning surfaced 2026-05-13; awaits route a/b/c; 4 amend-questions about identity-namespace model pending)
- **idea-287/288/289/290** smart-attach + auto-discovery (post-v1.2.0 operator-DX enhancements)

**Open bugs for post-v1.2.0-hotfix-roadmap** (engineer-judgment dispositioned at W8-new slice iv; Director-ratified at slice vi):

- **bug-77** publishStatus pure-git-mode reports `'pr-opened'` (low-frequency-impact; acceptable workaround)
- **bug-78** msn-start workspace-exists (minor; acceptable workaround)
- **bug-79** chokidar startup-race ~80s first-modify (pre-existing v1.0.7; acceptable workaround)
- **bug-81 (W8-new slice vii rehearsal)** Rule 7 substrate-coordinate parsing scans ALL positionals; rejects `:` in commit-messages
- **bug-82 (W8-new slice vii rehearsal)** bare-id default-to-show + global-flag composition fails (`msn <id> --workspace-root <path>`)
- **doc-bug** Scenario 01 §2 documents `MSN_WORKSPACE_ROOT` env-var as workspace-root override; NOT IMPLEMENTED

**bug-80 update-name .names symlink refresh — FIXED inline at W8-new slice (ii).**

---

## §8 Methodology learnings worth Director-engagement

1. **Director-progressive-question as substrate-redesign signal** — when Director asks "why isn't this simpler?" mid-substrate-fix-recursion, that's the architectural-pathology signal (calibration #70). Don't chase the next incremental fix; surface substrate-redesign option.

2. **Architect-side substrate-extension wire-flow gate is dispositive** — engineer test-suites are necessary-but-insufficient for substrate-class waves. Architect-dogfood against real upstream + real build + real CLI is the gate that completes substrate-class waves (caught 3 BLOCKERS this mission).

3. **3-tier risk-precedent confirmed** — substrate-class > CLI-class > cleanup/doc-class. Empirical wave-by-wave BLOCKER count from this mission supports tier-by-tier risk-budget allocation in future missions.

4. **Apply directional-vs-mechanism diagnostic bidirectionally** — architect's OWN spec-authorship is subject to the same rubric as engineer-surfacing. 3-instance pattern captured this mission; #73 inward-application.

5. **Release-gate surfacing must include CI-status** — architect-side dogfood + local-tests ≠ ship-readiness. CI-status is load-bearing signal owed to Director at Release-gate (§4.1; candidate #77).

6. **Discipline-over-expedience at late-cycle BLOCKER** — Director-ratified (a) FIX IT over (b) skip-vitest UPHELD calibration #76 ship-verify discipline. 60-min time-box constrains scope appropriately; vindication of architect-recommendation as default-disposition for late-cycle BLOCKERS where root-cause is plausibly bounded.

---

## §9 Acknowledgements + handoff

Mission-78 was driven autonomously per `feedback_architect_drives_mission_not_director.md` with Director-engagement at gate-points only (Phase 3 Survey waived for re-scope; Phase 7 Release-gate; mid-cycle BLOCKER bilateral; Phase 10). Engineer (greg / agent-0d2c690e) executed all wave-implementations via Hub-thread coordination. Architect (Lily / agent-40903c59) drove wave-spec authorship + architect-side dogfood + Director-bilateral surfaces.

Mission-78 architectural arc COMPLETE; v1.2.0 SHIPPED to npm; ship-disposition VINDICATED; calibration ledger CONTRIBUTED to (6 new entries); methodology learnings CAPTURED (8 candidates per §8).

**Director-engagement requested for**:
- Ratification of §5 NEW calibration candidates (#77 + #78) for architect-Director-bilateral filing
- idea-293 fork-model triage routing (a/b/c) at convenience
- Phase 10 closure-signal (retrospective doc accepted as canonical record)

**Engineer-side post-converge**: slice (ix.a) closing-audit §11 post-publish addendum (engineer-judgment cadence; no thread-coordination needed; thread-553 converged).

— Lily (architect; agent-40903c59)

---

## §10 Post-v1.2.0 hotfix arc — mission-79 + mission-80 fold (2026-05-14)

Post-v1.2.0-ship, architect-side README scenario verification surfaced a class of reader-flavor defects that the mission-78 wire-flow gate had not exercised (mission-78's gate covered the writer + daemon-driven reader paths; not the operator-driven reader CLI verbs). Two hotfix missions resulted.

### §10.1 mission-79 — v1.2.1 (bug-82 reader-mission writer-class-leak)

**Surface**: post-publish README S2 (BRANCH-TRACKER join-reader) verification found reader-missions entering writer-class lifecycle-state `in-progress` instead of reader-class `reading`. Role-based state-validation correctly rejected the off-role state on every subsequent config-read → daemon Loop B + auto-close cascade + `msn show` all cascade-blocked.

**Root-cause**: `daemonTickAdvance` (core/missioncraft.ts:1517) lacked a role-branch — unconditionally wrote `'in-progress'` for ALL missions on first daemon-tick. Distinct from `mc.start` (which writes the shared `'started'` transient). The architect §2 hypothesis ("state-transition exists but role-branch absent at the specific call-site") matched variant 2.

**Fix**: single role-branch at `daemonTickAdvance` on `config.mission.readOnly`. Shipped v1.2.1 within a Director-authorized fix-cycle; CI-fix sub-arc (ENOTEMPTY flake + macos-matrix carry-forward) handled per W8-new slice viii.a precedent.

**Calibrations**: #77 (Release-gate surfacing must include CI-status — architect-side gap: closing-audit cited LOCAL tests, CI was red 15+ commits) + #78 (test-fixture YAML-mutation regex must match enum domain — `\w+` vs hyphenated states) were filed during the mission-78→79 transition.

### §10.2 mission-80 — v1.2.2 (7-bug sweep)

**Scope**: bundled hotfix clearing the open bug-pile — bug-83 (reader abandon writer-class-leak, sibling to bug-82) + bug-84 (parser repeatable-flag accumulator) + bug-81 (scope-update dispatcher routing) + bug-79 (chokidar startup-race) + bug-77 (publishStatus pure-git terminal) + bug-78 (start workspace-exists detection) + doc-bug→feature (`MSN_WORKSPACE_ROOT` env-var).

**The two-pass bug-83 arc — calibration #79 source**: bug-83's first fix (slice i) switched the `msn <id> abandon` ENTRY-parse to auto-mode — unit-tests green, looked complete. Architect-side wire-flow gate (slice viii) found S3 watch-reader manual abandon STILL failed: FOUR downstream `_engineMutate` gates each independently parsed in writer-mode + rejected reader-class `'reading'`, PLUS a non-parse residual (reader-workspace 0444 chmod-down made `storage.cleanup` EACCES). Slice (viii.a) second-pass fixed all five. **The wire-flow gate earned its keep** — caught the single-site insufficiency before v1.2.2 ship. Calibration #79: role-class validation-gate fixes must grep the WHOLE flow, not just the entry-point; architect-dogfood is the catch-net for incomplete grep.

**Other architectural learnings**:
- **Declarative-spec-ahead-of-runtime gap (bug-84)**: arg-spec correctly marked `--repo` as `repeatable: true` for both mission-create + scope-create, but the parser-tokenizer didn't honor the marker (`flags.set` silent overwrite). The spec layer was authored speculatively ahead of runtime capability; only the SDK array-form worked end-to-end. Sibling pattern to calibration #74 (declarative-marker-layer needs runtime-honor-coverage).
- **Pluggable-substrate-state as startup-recovery signal (bug-79)**: the chokidar startup-race fix uses `watcher.once('ready')` + `gitEngine.status()` as a post-ready catch-up — the substrate's own state-detector becomes the recovery signal. Clean architectural fit; no substrate-redesign needed (calibration #70 did NOT apply — fix was incremental).

### §10.3 3-tier risk-precedent — re-confirmed across the hotfix arc

mission-79 + mission-80 re-confirmed the substrate > CLI > cleanup/doc risk-tier ordering. The substrate-class fixes (bug-82, bug-83) both needed architect-dogfood gate cycles; the CLI-class fixes (bug-84, bug-81) and substrate-light fixes (bug-77, bug-78) shipped clean first-pass. The wire-flow gate is dispositive for substrate-class waves and a formality-with-teeth for the rest.

### §10.4 Ship state post-fold

- `@apnex/missioncraft@1.2.0` (mission-78) → `1.2.1` (mission-79) → `1.2.2` (mission-80) — all LIVE on npm, OIDC-signed
- All README scenarios (S1 writer + S2 join-reader + S3 watch-reader + S4 scope multi-repo + `MSN_WORKSPACE_ROOT`) verified end-to-end against real upstream at v1.2.2
- Calibration ledger contribution across the arc: #71-#79 (9 entries)
- Forward-pointers open: macos-matrix flakes (mission-81 candidate, test-infra); BRANCH-TRACKER terminal-state semantic asymmetry (design-refinement candidate); idea-291 Hub-missioncraft integration; idea-292 Hub thread-design; idea-293 fork-model triage

— Lily (architect; agent-40903c59) · §10 fold 2026-05-14

---

## §11 mission-81 fold — operator-DX sweep + v1.2.3 (2026-05-15)

Director's hands-on testing of v1.2.2 surfaced 5 operator-DX/lifecycle bugs (bug-85/86/87/88/89). mission-81 bundled them with the 3 macos-matrix flakes (deferred twice through mission-79/80) into a v1.2.3 operator-DX sweep. Two more defects (bug-90/91) were discovered during slice-(iii) verification and Director-FOLDED into scope.

### §11.1 The bugs

| Bug | Severity | Operator-visible |
|---|---|---|
| bug-85 | major | `msn abandon` rejected pre-start missions (never-started ones couldn't be cleaned up) |
| bug-86 | minor | `msn scope list` emitted raw JSON instead of a table |
| bug-87 | minor | `msn <id> help` dumped the full global help instead of mission-targeted verbs |
| bug-88 | minor | `msn <id> cd` (no repo-name) errored on multi-repo missions — no path to mission-root |
| bug-89 | major | `shell-init` wrapper didn't intercept id-first `msn <id> cd` — documented direct-cd feature broken even with `eval` setup |
| bug-90 | major | `mc.list` silently dropped parse-failing scopes/missions (`catch{skip}` swallow) |
| bug-91 | minor | `msn help <verb>` + trailing global-flag mangled the verb-path |

### §11.2 calibration #80 — the bug-85 two-pass arc (inverse-shape of #79)

bug-85 needed a two-pass fix, mirroring mission-80's bug-83 — but for a *different* reason, which became calibration #80:

- **Slice-i fix**: added `'created'` to the abandon precheck. The Director's repro mission had 0 repos → lifecycle `created`; slice-i's own smoke-test also used a bare `msn create` → `created`. The fix matched the repro string and the smoke happened to confirm it.
- **Slice-(v) architect-dogfood**: the FIRST check used the *realistic* invocation `msn create --name X --repo URL` → lifecycle `configured` (the COMMON pre-start state) → abandon still threw. The FSM has THREE pre-start states (`created` / `configured` / `joined`).
- **Slice-(v.a) fix**: enumerated `MissionStatePhase`, added the full pre-start state-set.

**Calibration #80**: when fixing a reject-gate, enumerate the gate's COMPLETE valid-input-set from its domain type — don't pattern-match the bug-report's repro string; verify against a realistic invocation, not the verbatim repro. The inverse-shape sibling of #79 (which is "grep all call-sites"). #80 is "enumerate all valid-input values." The recurring meta-pattern across bug-82→83→85: a fix *shaped by the bug-report* instead of *shaped by the domain* is structurally incomplete; the architect wire-flow gate is the catch-net — and it only works because the dogfood uses realistic inputs, not the verbatim repro.

### §11.3 Other architectural learnings

- **Shell-script-generated output needs real-eval test coverage (bug-89)**: the `shell-init` wrapper shipped broken because it was shell-script-generated output, never test-covered — the W6-new id-first CLI migration updated the binary's verb-detection but not the wrapper's. bug-89's fix added a subprocess-eval test that evaluates the *real emitted wrapper* and asserts id-first interception. Generated artifacts that aren't in the type-checked/test-covered surface are a standing blind spot.
- **bug-90 applied #79 correctly**: the engineer grepped the silent-swallow shape and found it replicated in BOTH `listScopes` AND `listMissions` — fixed the set, not just the reported site. #79 working as intended.
- **macos-matrix clearance — disciplined 3-cycle re-diagnosis**: each cycle was grounded in the prior CI run's actual log evidence; cycle-1's "fix everything at once" failure was treated as a signal to re-read evidence, not to keep throwing fixes. The `verifyPidStartTime` fix ("can't verify = PROCEED, not BAIL") was a genuine logic-correctness improvement across 3 call-sites, not a macOS paper-over.

### §11.4 Ship state post-fold

- `@apnex/missioncraft@1.2.0` → `1.2.1` → `1.2.2` → **`1.2.3`** (mission-81) — all LIVE on npm, OIDC-signed
- **Full CI matrix GREEN (ubuntu 22/24 + macos 22/24)** for the first time since mission-78 — the macos-matrix flakes that rode deferred through mission-79/80 are cleared; calibration #77's "macos gate-green" is now actually true
- Slice (v) wire-flow gate 9/9 PASS — caught bug-85's incomplete first fix before ship (calibration #80 source)
- Calibration ledger contribution across the full missioncraft arc: **#71-#80 (10 entries)**
- Forward-pointers still open: BRANCH-TRACKER terminal-state semantic asymmetry (the one Director-ratified OUT-of-scope design-question); idea-291 Hub-missioncraft integration; idea-292 Hub thread-design; idea-293 fork-model triage

— Lily (architect; agent-40903c59) · §11 fold 2026-05-15

---

## §12 mission-82 fold — cd-consistency followon + v1.2.4 (2026-05-15)

A tight single-bug hotfix immediately following mission-81. Director's hands-on use of v1.2.3 surfaced bug-92 — a level-inconsistency in bare `msn <id> cd` / `msn <id> workspace` that was an *accidental introduction* by mission-81's bug-88 fix. The mission shipped in three slices and one thread-budget cycle without spillover.

### §12.1 The bug — bug-92

Post-bug-88, bare `cd`/`workspace` resolved to mission-root for *multi-repo* missions (where it previously errored) but the deliberate "single-repo bare form unchanged" scope-narrowing left single-repo dropping the operator into the sole repo subdir. Same command, different level depending on repo-count. Director caught it in operator-use and ratified Option A (consistency): bare → root always, named → repo subdir, coord-form unchanged.

### §12.2 The fix shape — code-removal, not code-addition

The minimum-diff fix was *deleting a clause*, not adding one. The single-repo auto-pick clause in `core/missioncraft.ts workspace()` (`config.repos.length === 1 ? sole-name : undefined`) was the asymmetry source. Removing it makes bare-single AND bare-multi both yield `targetRepoName === undefined` → both naturally fall through to the existing mission-root branch bug-88 added. The fix is a *subtraction* — the asymmetry was the *extra* code; removing it left the consistent behavior.

This is worth noting because additive fixes are the default reflex: when a behavior is wrong, add a new branch for the wrong case. Sometimes the cleaner fix is to delete the special-case that *caused* the asymmetry. The wire-flow gate's dogfood-with-realistic-invocations was key here — checking the single-repo bare-form against the bug-88-multi-repo behavior in the same dogfood surfaced the asymmetry as a single observable.

### §12.3 Sibling-note to calibration #80 — scope-narrowing creates seam-asymmetries

bug-88 (mission-81 slice ii) was correctly minimum-diff — it fixed the multi-repo error and explicitly preserved the single-repo legacy behavior. But the preserved legacy behavior wasn't *symmetric* with the newly-fixed multi-repo behavior, creating a seam-asymmetry at the single/multi boundary. The discipline addendum:

**When scope-narrowing during a fix to preserve legacy behavior on adjacent cases, check whether the preserved behavior creates a NEW asymmetry at the boundary with the newly-fixed cases.** If the legacy behavior + the new behavior diverge at the seam, the scope-narrowing is buying minimum-diff at the cost of operator-mental-model consistency. Sometimes that's the right trade (the cases are genuinely different); sometimes it's not (the cases should be uniform).

This is a sibling-note to #80, not a new calibration. #80 is "enumerate the gate's valid-input-set"; this is "check the boundary symmetry when scope-narrowing." Both are facets of "fix the domain, not the repro." The recurring meta-pattern across bug-82 → 83 → 85 → 92: fixes shaped by the immediate bug-report tend to leave structural symmetries broken; the wire-flow gate with realistic invocations is the catch-net.

### §12.4 Ship state post-fold

- `@apnex/missioncraft@1.2.0` → `1.2.1` → `1.2.2` → `1.2.3` → **`1.2.4`** (mission-82) — all LIVE on npm, OIDC-signed
- Full CI matrix GREEN on the ship-candidate; mission-81's macos clearance holding through to v1.2.4
- mission-82 round-budget: thread-560 fit within its 12-round budget without spillover — the tight single-bug shape (vs mission-81's 7-bug sweep) didn't need a continuation thread
- Calibration ledger across the full missioncraft arc unchanged at **#71-#80 (10 entries)** — mission-82 produced a sibling-note to #80, not a new entry
- Forward-pointers still open: BRANCH-TRACKER terminal-state semantic asymmetry; idea-291/292/293

— Lily (architect; agent-40903c59) · §12 fold 2026-05-15
