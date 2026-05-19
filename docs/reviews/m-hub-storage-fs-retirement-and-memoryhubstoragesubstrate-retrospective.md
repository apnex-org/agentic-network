# Mission-84 M-Hub-Storage-FS-Retirement-And-MemoryHubStorageSubstrate — Architect Retrospective

**Status:** Phase 9 Close executed 2026-05-18 (`mission-84.status=completed`; pulses auto-suspended). All 6 PRs of ratified ~6-PR cadence merged to main; substrate-only-everywhere posture achieved.
**Mode:** Summary-review per Director-direct 2026-05-18 + `feedback_retrospective_modes`. Architect-prepared full doc; Director engages on §7 Closing Summary (~5-10min).
**Authored:** 2026-05-18 / lily (architect; agent-40903c59).
**Scope:** architect's reflection on mission-84 shipping outcomes, methodology calibration validations, ledger-filing candidates, and forward-architecture observations. Companion to (and not duplicating) the W6+W7 ship-PR description at PR #214.

---

## §1 What shipped (one-paragraph)

mission-84 closed mission-83's W6-narrowed deferred-scope: full retirement of the FS-version-repository pattern + LocalFsStorageProvider + StorageBackedCounter + STORAGE_BACKEND env-var ceremony; introduction of MemoryHubStorageSubstrate as the canonical test backend + abstract SubstrateConformanceSuite (PORT-then-EXTEND from existing mission-47 conformance.ts); architectural closure of cluster #23 (repo-event-bridge ephemeral-persistence via MemoryStorageProvider-sentinel-in-substrate-mode); restoration of Document MCP tools retired during mission-83 W6 narrowed-deletion-cascade (PolicyRouter tool count 68 → 71); revert of PR #203 sweeper-tick throttle band-aid (substrate-cutover structurally eliminated the FS-walk pressure that motivated it). 6 PRs over ~7-8 hours of architect+engineer bilateral execution under Director-direct **full-autonomous-driving mandate** (binding for full Phase 8 wave-cascade + architect-owns-engineer-health validation). SchemaDef inventory: 20 → 22 kinds (RepoEventBridgeCursor + RepoEventBridgeDedupe with `watchable: false`). Net code-delta: ~+1700 inserted / ~-6000 deleted (substantial substrate-cleanup-wave class signature).

---

## §2 What worked (architectural + methodology wins)

### §2.1 Director-correction at Phase 4 was load-bearing (B1-B7 architect-side blind-spots caught)

Director-correction 2026-05-18 ("design phase must be a critique review with Greg; architect responsibility to drive") landed mid-Phase 4 when architect had attempted "resume design unilaterally" path with engineer-idle. Architect-side self-audit (v0.1 → v0.2) had caught 1 architectural-defect (F5 Variant ii implementability) but Director-correction forced bilateral engineer-engagement.

Engineer round-1 audit on thread-577 then caught **6 additional architect-side blind-spots (B1-B6)** that v0.2 self-audit missed:
- B1: SubstrateConformanceSuite ALREADY EXISTS as port-target (v0.2 said "NEW WORK not port")
- B2: SchemaDef field is `watchable: boolean` REQUIRED (not optional `notify` default-true)
- B3: Counter SchemaDef ALREADY EXISTS at `all-schemas.ts:91-100`
- B4: SubstrateCounter ALREADY EXISTS at `hub/src/entities/substrate-counter.ts`
- B5: Reconciler manages INDEXES only NOT tables (v0.2 "counters-table mechanism" was architectural-pathology)
- B6: W2 blast-radius `~22 files` was stale mission-83 W6 estimate (actual = 49 of 82 .test.ts files at HEAD)

Then engineer W0 spike caught B7 (cross-package type-boundary forced Variant ii adapter to hub-side, NOT Design v1.0 §2.3 prescribed `packages/repo-event-bridge/src/substrate-adapter.ts`).

**7 architect-side blind-spots in total caught by engineer-perspective.** Validates `feedback_architect_drives_engineer_engagement_when_idle` (filed mid-Phase-4 directly from this Director-correction): bilateral critique-review IS non-substitutable for Phase 4 ratify; architect-side self-audit substituting for engineer-audit shipped 6 errors into v0.2 that would have propagated into W0+ implementation.

### §2.2 Full-autonomous-driving mandate validated as substrate-mission-execution-pattern

Director-direct 2026-05-18 mandate ("full autonomous driving by the Architect for this mission, until final wave completion; engineer-health is architect-responsibility") tested the architect-side driving discipline:
- 8 threads opened (thread-577 through thread-584); 34/63 total rounds used (54% efficiency; well within budget)
- 3 force_fire_pulse interventions to resume engineer session post wake-work-idle harness cycle (engineer cognitive_ttl=0 events handled architect-autonomously per mandate; ZERO Director-escalation for engineer-health)
- 4 architect-Director-bilateral surfaces (mandate-conforming): Phase 7 release-gate; cluster #23 ledger update (calibration #77); W5 pre-ship Out-of-scope-risks; Phase 10 mode-pick
- Architect drove full W0 → W7 cycle (~7-8 hours wall-clock)

Validates the binding mandate pattern as repeatable for similar substrate-mission classes. Filed as `feedback_architect_full_autonomous_until_final_wave` memory.

### §2.3 Coordinated-upgrade-discipline applied in spirit (W4 atomic deletion-cascade)

§3.1.1 coordinated-upgrade-discipline (typically scoped to substrate-introduction-class) APPLIED IN SPIRIT to W4 substrate-cleanup-wave deletion: 12 FS-version repo files + counter.ts + StorageBackedCounter + Counters interface + CounterField type + LocalFsStorageProvider + hub/src/index.ts dispatch-branches ALL atomic in single PR #212 (net -5219 lines deleted; +135 added). Per Finding B coordinated-upgrade-discipline pre-activation fold; engineer SHRINK disposition for packages/storage-provider/ retained contract.ts + memory.ts + test/conformance.ts (repo-event-bridge runtime dep) via import-graph survey.

W4 atomic ship validates: cleanup-class missions can use the same coordinated-atomic discipline as substrate-introduction; the principle ("ALL consumer upgrades alongside Hub-side substrate changes") generalizes to deletion-cascades.

### §2.4 Cluster #23 closure via dispositive integration test

cluster #23 defect (repo-event-bridge cursor + dedupe ephemeral via MemoryStorageProvider sentinel) surfaced at Survey §calibration via Director-Round-2-clarifying-question grep-walk 2026-05-17 ("help me understand repo-event-bridge dependency on storage"). Closure at W3 (PR #211 merged `ef36b79c`):
- 2 minimal-SchemaDefs registered (RepoEventBridgeCursor + RepoEventBridgeDedupe; `watchable: false`)
- RepoEventBridgeSubstrateAdapter wraps PostgresHubStorageSubstrate via §2.3 primitive-mapping
- hub/src/index.ts:840 wire-up swap (sentinel → adapter)
- Dispositive evidence: `cluster-23-cursor-restart-safety.test.ts` (191 lines; 4/4 PASS in 5.26s; in-process Hub-restart-simulation primary path)

Calibration #77 filed per Director-direct "Update ledger" 2026-05-18; ledger entry captures the 23rd-cluster-member-of-substrate-currency-failure-pattern lineage continuation from mission-83 retro.

### §2.5 Wake-work-idle harness cycle architecturally absorbed

Greg's engineer session followed a consistent wake-work-idle pattern: session activates → does substantial work (commits + push) → cognitive_ttl drops to 0 → architect force_fire_pulse → resume cycle. Observed 3× during mission-84 (W0 dispatch idle, W1 dispatch idle, W2 dispatch idle). Pattern matched engineer-runtime harness expectations; force_fire_pulse mechanism reliably resumed each time. ZERO mission-blocking engineer-unavailability events; ZERO Director-escalation for engineer-health.

`feedback_architect_drives_engineer_engagement_when_idle` discipline confirmed operationally — architect responsibility includes pulse-driven resumption, not just dispatch coord.

### §2.6 ~6-PR cadence ratify worked (engineer Q-A6 refinement)

Engineer Q-A6 refinement at Phase 4 round-1 ("per-wave PR for SUBSTANTIVE waves + folded mini-PRs for trivial; ~5 PRs total" — later refined to ~6 when W2 surfaced own-PR scope at 50-file blast-radius) shipped exactly as designed:
- PR 1: W0+W1 (conformance + spike) at `0e316ca`
- PR 2: W2 own-PR (test-utils migration + 28-file cascade) at `e9fbbabe`
- PR 3: W3 (cluster #23 + repo-event-bridge) at `ef36b79c`
- PR 4: W4 (Counter + FS-repo + storage-provider + dispatch-branch retirement) at `649938fb`
- PR 5: W5 (STORAGE_BACKEND env-var retirement) at `a78ecd3d`
- PR 6: W6+W7 (Document MCP + PR #203 revert + ship) at `71aa8e22`

Each PR architect-cross-approved + rebase-merged with `--delete-branch`. No admin-merges needed (cross-approval + required-CI-green sufficient). Calibration #67-B.4 (gh CLI false-error on local-branch delete) re-confirmed 4× across mission cycle.

### §2.7 vitest hub flakiness contained (calibration #75 instance)

PR #209 W0+W1 initial vitest (hub) FAILED with substrate-counter.race.test.ts unhandled exception (postgres connection-teardown race; code 57P01 / pg_terminate_backend-class). Calibration #75 (orphan-daemon-accumulation pattern) instance. `substrate-proven-dont-dig` discipline applied: rerun via `gh run rerun --failed` → SUCCESS confirmed flakiness; merge proceeded clean. Pattern did NOT recur at PR #210-214 (5 consecutive first-try-pass).

Engineer hypothesis (thread-579 round 10 §2): W1 adds 3rd testcontainers postgres → vitest parallel pool spins 5+ containers → kernel resource pressure → 57P01 teardown-race amplification. **Not validated at W2-W7 scale** (single-instance occurrence; not persistent pressure). Architect-disposition: monitor; mitigation (vitest singleFork on conformance / shared singleton container / serial tag) deferred to operational-need surface.

---

## §3 What was hard (friction surfaces; calibration material)

### §3.1 Architect-side spec-vs-code drift class (B1-B7 cluster)

7 architect-side blind-spots in v0.1+v0.2 design represented spec-level recall of substrate API surfaces that didn't match code-reality:
- conformance.ts existence (B1)
- watchable vs notify field semantic (B2)
- Counter SchemaDef pre-existence (B3)
- SubstrateCounter pre-existence (B4)
- reconciler primitive surface scope (B5)
- W2 blast-radius stale estimate (B6)
- Cross-package type-boundary constraint (B7)

Pattern: architect-spec-authorship-without-code-verify ships drift; engineer code-grep round-1 (per `feedback_substrate_currency_audit_rubric.md` ARCHITECT-SIDE EXTENSION) catches it. Each round caught more drift than the previous; B7 was found at W0 spike-execution (1 wave INTO Phase 8), suggesting drift persists past Design ratify.

**Calibration candidate (Phase 10 retro):** `architect-spec-vs-substrate-API-drift-class` formal entry. Composes with calibration #66 (architect-spec-level-recall) + `feedback_architect_drives_engineer_engagement_when_idle`.

### §3.2 architectPulse backlog-replay pattern (Hub clock-skew artifact)

mission-84 activation triggered ~50+ scheduled-pulse-fires worth of backlog replay (Hub's pulse scheduler had accumulated unfired pulses with scheduled-times offset ~17h from wall-clock). Backlog replayed at ~1/minute real-time cadence rather than 20-min canonical cadence (config: intervalSeconds=1200). All pulses acked individually via `ack_message`; each consumed ~600 tokens architect context. ~55 architectPulses acked across mission lifecycle.

Pattern is Hub-side artifact (clock-skew between scheduled-times + wall-clock at activation-time); not engineer- or architect-fault. **Calibration candidate (Phase 10 retro):** `architectPulse-backlog-replay-on-activation-clock-skew` — surface for Hub-side maintenance investigation (pulse-scheduler initialization may benefit from clock-anchoring at mission-activation).

### §3.3 Engineer session wake-work-idle cycle (harness pattern adaptation)

Greg's engineer session went `cognitive_ttl=0` after each round-2-class reply on each W0-W5 dispatch thread. Architect-side force_fire_pulse was reliably needed to wake engineer for the work-arc of each wave. Worked-as-designed per harness expectations BUT consumed architect attention budget on resumption-driving (3 force_fires plus monitoring across 5 waves).

**Composes with calibration #75** (orphan-daemon-class). The wake-work-idle cycle is engineer-harness intentional behavior; architect-side driving compensates per the full-autonomous-mandate. No defect; just architecturally-known cost.

### §3.4 Calibration ledger #77 mid-mission filing required Director-direct authorization

Per `feedback_calibration_ledger_discipline`: calibration filings are Director-direct or architect-Director-bilateral, never LLM-autonomous. Cluster #23 closure at W3 (PR #211 merged `ef36b79c`) required architect-Director-bilateral surface for ledger #77 filing. Director-direct "Update ledger" 2026-05-18 ratified architect-side YAML-edit + commit at `b099416`.

**Validates discipline:** the architect-Director-bilateral path works for atomic calibration-ledger maintenance during mission cycle (not just at Phase 10 retro batch); architect surfaces dispositive evidence; Director ratifies + architect commits.

---

## §4 Methodology validations + evolutions

### §4.1 Validations (existing discipline confirmed by this mission)

- `feedback_architect_drives_engineer_engagement_when_idle` (filed mid-Phase-4 from Director-correction): confirmed binding for full-autonomous-mandate class; force_fire_pulse playbook validated
- `feedback_substrate_currency_audit_rubric.md` ARCHITECT-SIDE EXTENSION: engineer round-1 audit caught 6 architect-spec-vs-code-drift instances (B1-B6)
- `feedback_bilateral_audit_round_budget_discipline`: skip-ack-only-courtesy-round discipline observed across all 8 threads; 34/63 total rounds used (54%; engineer + architect mutual respect of budget)
- `feedback_substrate_proven_dont_dig_test_harness`: vitest hub flakiness rerun-and-ship discipline at PR #209 validated; no deep-dive into test-harness during ship-cycle
- `feedback_director_direct_mid_cycle_override`: Director-direct dispositions at Phase 4 correction + Phase 7 ratify + W5 pre-ship + cluster #23 ledger update + Phase 10 mode-pick all superseded architect-spec defaults
- `feedback_test_caught_substrate_gap_default_disposition` (engineer W2 §7.4): substrate-strictness surfaced listEntries signature test-bug; pattern continued from prior missions
- `feedback_design_audit_survey_anchor` (engineer thread-578 sweep B): Survey-fidelity audit + lifecycle-adherence sweep applied at preflight + W3 ratify-criterion; pattern continued
- Calibration #67-B.4 (gh CLI false-error on local-branch delete): re-confirmed 4× across PR merges

### §4.2 Evolution candidates (new patterns / refinements for Phase 10 retro filing)

1. **`feedback_architect_full_autonomous_until_final_wave`** (FILED mid-mission): Director-direct binding mandate for substrate-mission-class; architect drives end-to-end + owns engineer-health
2. **B7-class architect-spec-vs-cross-package-boundary drift**: cross-package type-boundary constraints surface only at code-execution; spec-level review can't anticipate. Sibling to B1-B6 spec-recall class but rooted in workspace-package structure not API-shape. Worth distinct calibration entry.
3. **architectPulse backlog-replay-on-activation-clock-skew**: Hub pulse-scheduler clock-anchoring opportunity at mission-activation-time
4. **Coordinated-upgrade-discipline applied to substrate-cleanup-wave class** (not just substrate-introduction): §3.1.1 principle generalizes to deletion-cascades; W4 atomic ship validates
5. **W2 substrate-vs-FS-version semantic-differences captured during cascade** (greg W2 §7.4): Counter MAX_CAS_RETRIES=50 ceiling + audit/v2/ path-prefix removed + listEntries signature strictness — pattern of test-cascade surfacing legacy-pattern-vs-substrate-semantic-divergence
6. **Director-Round-2-clarifying-question-as-substrate-currency-audit-surface** (Survey §calibration): positive-pattern; Director's Q4 "help me understand X" prompted architect grep-walk yielding cluster #23 defect. Worth methodology-evolution entry (codify Survey-side defensive grep-walk discipline triggered by clarifying-questions).
7. **Engineer-Q-A6-refinement-during-Phase-4-audit-as-PR-cadence-disposition**: greg's refinement of architect's "~5 PRs single-PR-per-mission" recommendation into "~5-6 PRs per-wave-substantive + folded-mini-PRs trivial" was load-bearing for execution shape; engineer-disposition-on-process-mechanics pattern
8. **Cross-thread architect-Director-bilateral calibration filing**: cluster #77 filing executed via architect-Director-bilateral mid-mission (not Phase 10 batch); demonstrates per-ship-gate filing pattern works alongside Phase 10 batch

---

## §5 Calibration candidates for Phase 10 ledger filing

Per `feedback_calibration_ledger_discipline` — calibration filings need architect-Director-bilateral. Surfacing batch here for Director-batch-disposition (vs per-item architect-Director-bilateral):

| # | Candidate | Class | Brief |
|---|---|---|---|
| 1 | architect-spec-vs-substrate-API-drift-class | methodology | B1-B6 spec-recall pattern; composes with #66 |
| 2 | architect-spec-vs-cross-package-boundary-drift (B7-class) | methodology | Distinct from API-drift; rooted in workspace structure |
| 3 | architectPulse-backlog-replay-on-activation | substrate | Hub pulse-scheduler clock-anchoring opportunity |
| 4 | coordinated-upgrade-discipline-applied-to-substrate-cleanup-wave | methodology | §3.1.1 generalization to deletion-cascades |
| 5 | W2-substrate-vs-FS-version-semantic-differences-pattern | methodology | Cascade-surface legacy-vs-substrate semantic divergences |
| 6 | Director-Round-2-clarifying-question-as-substrate-currency-audit-surface | methodology | Positive-pattern from Survey §calibration |
| 7 | engineer-Q-A-refinement-during-Phase-4-audit-as-PR-cadence-disposition | methodology | Engineer-process-mechanics-disposition pattern |
| 8 | per-ship-gate-calibration-ledger-filing-alongside-Phase-10-batch | methodology | Cluster #77 mid-mission filing validation |
| 9 | full-autonomous-mandate-as-substrate-mission-execution-pattern | methodology | Already filed as feedback memory; ledger formalization |
| (filed) | cluster #23 closure | substrate | **#77 — already filed mid-mission per Director-direct 2026-05-18** |

Director-disposition mode at Phase 10 batch:
- **Ratify all 9 with numbered IDs 78-86** (single bulk file; architect commits)
- **Pick subset** (architect commits only ratified entries)
- **Defer** (calibration material persists in this retro doc; no ledger update)

---

## §6 Cross-references

- **Design v1.1 RATIFIED:** `docs/designs/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate-design.md` (commit `a15f7ac` v1.1; v1.0 ratified at `f6486cf` 2026-05-18 via thread-577)
- **Survey envelope:** `docs/surveys/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate-survey.md`
- **Preflight artifact:** `docs/missions/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate-preflight.md` (commit `1f0bdcd`; Verdict GREEN)
- **Work-trace:** `docs/traces/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate-work-trace.md` (full architect-side session-log)
- **Engineer work-trace:** `docs/traces/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate-engineer-work-trace.md`
- **Source idea:** idea-300 (incorporated to mission-84)
- **Phase 4 thread:** thread-577 (2 rounds; greg round-1 caught B1-B6; v0.3 fold + greg round-2 CONCUR + v1.0 RATIFIED)
- **Phase 6 thread:** thread-578 (3 rounds; lifecycle-adherence audit + Finding B fold)
- **Phase 8 wave threads:** thread-579 (W0+W1; 10/10 round limit), thread-580 (W2; 3/10), thread-581 (W3; 3/10), thread-582 (W4; 5/10), thread-583 (W5; 3/10), thread-584 (W6+W7; 3/10)
- **PRs merged:** #209 (W0+W1; `0e316ca`), #210 (W2; `e9fbbabe`), #211 (W3; `ef36b79c`), #212 (W4; `649938fb`), #213 (W5; `a78ecd3d`), #214 (W6+W7; `71aa8e22`)
- **Calibration filed mid-mission:** #77 (cluster #23 closed-structurally per Director-direct "Update ledger" 2026-05-18; commit `b099416`)
- **Upstream missions:** mission-83 (M-Hub-Storage-Substrate; W6-narrowed retired the production-prod path; this mission completed the test-architecture migration); mission-47 (StorageProvider conformance suite — PORT-base for SubstrateConformanceSuite)
- **Downstream missions:** idea-298 (M-Hub-Storage-Cloud-Deploy; strict-after per Q3a; inherits clean substrate baseline + conformance-suite-certified MemoryHubStorageSubstrate + PostgresHubStorageSubstrate)
- **Sequence-independent follow-ons:** idea-295/296/297/299 (resource-version + audit-history + FK-enforcement + blob-body-substrate); idea-301 (M-Trait-Substrate; engineer-modeling layer)
- **Methodology refs:**
  - `docs/methodology/mission-lifecycle.md` v1.2 (Phase 4-9 RACI + §3.1.1 coordinated-upgrade-discipline applied to substrate-cleanup-wave per §4.2 evolution candidate 4)
  - `docs/methodology/mission-preflight.md` v1.0 (6-category audit; B4-pulses-vs-canonical-defaults sub-check methodology-evolution candidate from Phase 6 lifecycle-adherence review)
  - `docs/methodology/multi-agent-pr-workflow.md` (PR cross-approval + rebase-merge cadence)
  - `docs/methodology/idea-survey.md` v1.0 (Survey §calibration codified the Director-Round-2-clarifying-question pattern)
- **Memories filed mid-mission:** `feedback_architect_drives_engineer_engagement_when_idle.md` (Phase 4 Director-correction); `feedback_architect_full_autonomous_until_final_wave.md` (Phase 7 binding mandate)

---

## §7 Closing Summary (Director-engagement scope per Summary-review mode)

**mission-84 shipped substrate-only-everywhere posture in 6 PRs over ~7-8 hours of architect+engineer bilateral execution under Director-direct full-autonomous-driving mandate.** Production-Hub bootstrap unconditionally PostgresHubStorageSubstrate; no STORAGE_BACKEND env-var ceremony; FS-version-repo pattern + LocalFsStorageProvider + StorageBackedCounter fully retired; cluster #23 architecturally closed via calibration #77; Document MCP tools restored; sweeper-tick defaults at substrate-native cadence (PR #203 revert architecturally moot). idea-300 closed at mission-completion.

**Methodology validations:** Director-correction at Phase 4 was load-bearing (caught 6 architect-side blind-spots that v0.2 self-audit missed); full-autonomous-driving mandate validated as repeatable substrate-mission-class pattern; coordinated-upgrade-discipline generalized to substrate-cleanup-wave atomic deletion; per-ship-gate calibration ledger filing demonstrated alongside Phase 10 batch.

**8 calibration candidates surfaced** for Phase 10 ledger filing (architect-spec-drift class refinements + architectPulse backlog-replay + Director-Round-2-clarifying-question positive-pattern + engineer-Q-A-refinement pattern + etc.) plus 1 already-filed (#77 cluster #23). Director-disposition mode at Phase 10 batch: ratify-all-9 / pick-subset / defer-to-retro-doc-only.

**Forward-architecture readiness:** idea-298 (M-Hub-Storage-Cloud-Deploy) inherits clean substrate baseline + conformance-suite-certified MemoryHubStorageSubstrate + PostgresHubStorageSubstrate; idea-295/296/297/299 + idea-301 sequence-independent.

**Bilateral efficiency:** 34/63 total rounds across 8 threads (54% budget utilization); 4 architect-Director-bilateral surfaces mandate-conforming (Phase 7 + cluster #23 + W5 pre-ship + Phase 10 mode-pick); zero Director-escalation for engineer-health (architect drove 3 force_fire_pulse resumptions per wake-work-idle harness cycle).

**Architect-side follow-on pending:** architect-branch PR-cleanup-mission cycle (per mission-83 precedent) to land Design v1.0/v1.1 + Preflight + work-trace + calibration #77 + this retrospective to main via separate PR.

---

— Architect: lily / 2026-05-18 / **mission-84 SHIPPED; substrate-only-everywhere posture locked.**
