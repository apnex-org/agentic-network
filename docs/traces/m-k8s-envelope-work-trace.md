# M-K8s-Envelope — Work Trace (live state)

**Mission scope.** Substrate-wide all-at-once envelope upgrade per Survey 1 (`docs/reviews/2026-05-23-survey-idea-126.md`, Director-ratified A/A/A both rounds). All 20 SchemaDef kinds get `{id, name, kind, apiVersion, metadata, spec, status}` envelope; per-kind JSON Schemas declared upfront; minimal `core.ois/v1` + `ext.ois`-reserved namespacing; big-bang cutover via mission-83 W5 pattern; bug-118 fix absorbed.

**Mission anchor:** idea-126 (now `triaged` → `incorporated` post-Mission entity-spawn).
**SR/cartography context:** v3 W1 wire-substrate anchor per cartography v1.1 §6 + SR §7 critical-path.
**How to read + update:** see `docs/methodology/trace-management.md` for live-trace discipline.

**Status legend:** ▶ in-flight  ✅ done this session  ○ queued / filed  ⏸ deferred

---

## Resumption pointer (cold-session brief)

If you're picking up cold, read in this order:

1. **This file.**
2. **Survey-of-record:** `docs/reviews/2026-05-23-survey-idea-126.md` (PR #264; Director-ratified A/A/A).
3. **Cartography + SR context:** `docs/reviews/2026-05-23-threads-v3-cartography.md` v1.1 (§6 W1 wire-substrate) + `docs/reviews/2026-05-23-sr-threads-v3.md` v1.1 (§7 critical-path).
4. **Bilateral Design threads:** thread-634 (Phase 4 Design Round 1; closed) + thread-635 (Phase 5 Manifest bilateral; active).
5. **Phase 4 Design artefacts (5 cluster docs; merged to main):**
   - cluster-1 substantive-content (Idea/Bug/Thread/Mission/Proposal) — d8ea695 / PR #267
   - cluster-2 queue/FSM-active (Task/PendingAction/Turn) — 59c3a70 / PR #268
   - cluster-3 metadata/config/projection (Agent/Tele/SchemaDef/Counter) — ddf7bb1 / PR #270
   - cluster-4 system-emit/bookkeeping (Message/Audit/RepoEventBridgeCursor/RepoEventBridgeDedupe; Notification DROPPED at v0.2) — 3b1819a / PR #271
   - cluster-5 content-archive (Document/ArchitectDecision/DirectorHistoryEntry/ReviewHistoryEntry/ThreadHistoryEntry) — 71690de / PR #272
6. **Anti-goals carried forward:** Survey §6 (10 anti-goals) + Design Round 1 additions (5 engineer-side: no historical backfill / no cognitive-surface depth without ergonomic check / additive-only at metadata/spec/status partition until apiVersion bump / no IaC-runtime / operator-DX preserved through cutover). DO NOT re-litigate without explicit Director surface.
7. **Composition surfaces:**
   - bug-118 fix (substrate-wide bug-lineage `metadata.sourceThreadId` capture) — **IN SCOPE**; covered by cluster-1 + cluster-2 via `shared/provenance.ts`.
   - idea-121 (M-API-v2.0; `get_resource_shape` interface) — composes at Phase B; this Mission commits to SchemaDef shape only.
   - idea-151 (M-Graph-Relationships) — parallel-trackable W4 work; orthogonal substrate layer.
   - bug-97 (Counter-collision substrate-defect; mission-83 W5.4 open) — engineer-side **RECOMMEND** separate-and-prior to W3 per OQ6 disposition; awaiting architect Round-2 ratification.
8. **Current cadence:** Phase 5 Manifest bilateral active (thread-635). Engineer Round-1 reply landed 2026-05-24 ~09:56 AEST covering 13 OQs + 5 additional surfacings. Awaiting architect Round 2 integration.

---

## In-flight

✅ **Phase 5 Manifest CLOSED on bilateral convergence (thread-635; status=converged).**
- Architect dispatched v0.1 wave plan + 13 OQs 2026-05-24 ~09:51 AEST.
- Engineer R1 reply landed 2026-05-24 ~09:56 AEST (verified all 5 cluster Designs via origin/main read).
- Architect R2 disposed all R1 refinements 2026-05-24 ~09:59 AEST; v0.2 wave plan published with deltas. A5 substrate-currency catch returned the other direction (worktree-stale; entity-kinds.json IS v1.3 / 21 kinds at origin/main HEAD).
- Engineer R3 reply landed 2026-05-24 ~10:02 AEST (v0.2 ratified; A5 acknowledged; `propose_mission` cascade shape resolved via code-grep — payload is `{title, description, goals}` only, architect-converged-only, Mission spawns at `draft`).
- Architect R4 cascade close landed 2026-05-24 ~10:04 AEST: `propose_mission` action-1 staged with title=M-K8s-Envelope + full v0.2 wave plan in description + 8 goals (Pre-W0 + W0-W6); converged=true + summary populated.
- Engineer R5 bilateral converge handshake landed 2026-05-24 ~10:06 AEST: converged=true, no stage operations (action-1 commits via handshake). **action-1 status: staged → committed; thread status → converged.**

✅ **Mission cascade landed (architect-orchestrated):**
1. propose_mission cascade fired → mission-88 spawned 2026-05-24T00:06:19Z with back-link metadata intact (sourceThreadId=thread-635 / sourceActionId=action-1 / sourceThreadSummary populated).
2. Architect bridged to `proposed` status + `missionClass=substrate-introduction` + pulses configured (1800s × architect + engineer / missedThreshold=2 / firstFireDelaySeconds=1800; await activation).
3. idea-126 status flipped `triaged` → `incorporated` with `missionId=mission-88`.

✅ **Phase 6 Preflight CLOSED — verdict YELLOW.**
- Architect authored preflight artifact `docs/missions/m-k8s-envelope-preflight.md` at PR #273; opened 2026-05-24.
- Engineer reviewed + approved 2026-05-24 ~10:46 AEST (verifications: mission-88 entity state + 21 kinds entity-kinds.json v1.3 + 5 cluster Design merge currency + E2 YELLOW framing + bounded Director-options).
- PR #273 merged 2026-05-24T00:46:17Z (squash commit 6a95bbb2).
- 6-category audit all PASS except E2 (deploy-gate dependencies; YELLOW reflects deliberate deferral of 2 operational decisions to Director-engagement at Phase 7).

✅ **Phase 7 Release-gate Director-ratified 2026-05-24** ("Agreed with recommendation. Approved for launch"). Combined recommendation (i)(b) + (ii)(a) approved without revision.
- `update_mission(mission-88, status="active")` executed; mission live; pulses active-mode at 1800s cadence.
- Preflight v0.2 GREEN PR #274 (architect-authored 2026-05-24 ~10:58 AEST); engineer reviewed + approved 2026-05-24 ~11:02 AEST; merged squash 59782a4381 at 2026-05-24T01:02:45Z.
- bug-97 fix slice dispatched at thread-637.
- Mission-88 engineer pulse fired at ~00:57Z (capture-time race with active-flip at ~00:55Z; pulses-active-mode going forward); thread-636 pulse-cycle informational close_no_action committed.

✅ **bug-97 substrate-currency catch resolved at disposition (α). Thread-637 CONVERGED.**
- Architect-side R3 (2026-05-24 ~11:03 AEST) independently verified all engineer code-trace evidence; acknowledged architect-side dispatch-premise-currency-failure.
- Architect executed `update_bug(bug-97, status=resolved, fixCommits=[e109000], fixRevision="mission-83 W5.5 2026-05-17", linkedMissionId=mission-83)`.
- Phase 7 (ii)(a) ratification was effectively no-op (Director ratified architect-framing; architect-framing was stale).
- Engineer R4 (2026-05-24 ~11:05 AEST) close_no_action handshake commit; thread converged.
- **Third substrate-currency catch on mission-88** — calibration-cluster ratified: (1) thread-635 R1 cluster-4 v0.2 Notification drop / (2) thread-635 R2 A5 worktree-stale / (3) thread-637 R1 bug-97 stale-open. Pattern: substrate-currency-discipline cuts both ways at all 4 surfaces (code-trace + entity-state + fix-commit + retired-file).
- New methodology candidate U filed by architect: `feedback_architect_dispatch_premise_currency_check.md` (v2.1; mirror of engineer-side `feedback_substrate_currency_audit_rubric.md`).

✅ **W0 Design-pass converged at thread-639 R3** (2026-05-24 ~11:14 AEST).
- Architect picked Design-pass over inline-pulse-thread for substrate-extension class Q1-Q5 (thread-638 R2 disposition (b)).
- thread-639 R1 engineer surface: Q1-Q5 with bounded options (A/B/C) + engineer-leans uniformly (A).
- thread-639 R2 architect: all 5 engineer-leans CONCUR + 2 precision-pins: (i) Q1 schemaRef carries per-kind rename-mapping (cluster-4 §1.7 Message.kind → metadata.messageKind canonical); (ii) Q2 doc-side framing "SchemaDef reconciler tolerance" → "write-validation envelope tolerance" — **4th substrate-currency catch on mission-88**.
- thread-639 R3 engineer ack + close_no_action handshake commit; W0 scaffolding begins.

✅ **W0 substrate-prep PR #275 SHIPPED** (2026-05-24 ~11:25 AEST; commit 8c02203 on agent-greg/m-k8s-envelope-w0-substrate-prep).
- 10 files (8 new + 2 modified); +1195 / -3 lines.
- Deliverables: `shared/envelope.ts` (Q1 library) · `kinds/_contract.ts` (Q4 contract) · `migration-runner.ts` (Q4 runner) · `entities/migration-cursor-repository.ts` (Q3 wrapper) · MigrationCursor SchemaDef in all-schemas.ts (23rd entry) · `SUBSTRATE_ENVELOPE_TOLERANT` env-var in index.ts · `__tests__/{envelope,migration-cursor,wire-flow}.test.ts` + `__tests__/harness/fixtures.ts`.
- Ship-verify 3-layer (per `feedback_ship_verify_3_layer_discipline`): tsc-strict 0 errors / vitest W0 suite 27/27 pass (3.4s incl. testcontainers) / hub-bootstrap-substrate 2/2 pass after npm run build (initial flake was local-test-masking-via-cached-state — dist/ rebuild resolved).
- PR test plan includes Hub-rebuild dependency per Q5 disposition (build-hub.sh + start-hub.sh per `feedback_adapter_restart_protocol_hub_container`).

✅ **W0 PR #275 MERGED at e665de3** (2026-05-24 ~11:30 AEST per architect pulse-response). W0 substrate-prep primitives live on main: shared/envelope.ts + kinds/_contract.ts + migration-runner.ts + entities/migration-cursor-repository.ts + 23-entry SchemaDef seed + 27/27 tests + Q5 Hub-rebuild test plan.
- Architect cross-approval + admin-merge cycle executed; pulse-cycle missed-threshold artifact of pulse-firing-during-active-architect-work (informational only; no escalation surface).

✅ **W1 Design-pass converged at thread-640 R3** (2026-05-24 ~11:58 AEST). All 7 Q1-Q7 dispositions sealed:
- Q1 single-bundle PR; Q2 inline draft + substrate-current shape verify (5th proactive substrate-currency-discipline application); Q3 per-kind unit test re-encodes envelope-shape → asserts reference-equality; Q4 extend W0 wire-flow.test.ts (single canonical wire-flow file); Q5 substrate-wide bug-118 coverage query in PR test plan (forward-only per anti-goal 11); Q6 W1 = migration-path + cascade-handler pass-through (NO shared/provenance.ts; write-site audit = idea-312 W1 wire-substrate scope); Q7 same-W1-PR if scope-narrow per A4 "last per-wave sub-step".
- close_no_action action-1 committed via R3 handshake; W1 scaffolding next.

✅ **Engineer fresh-session handoff requested at thread-641 (2026-05-24 ~12:04 AEST); architect-accepted Option 1.**
- Trigger: engineer-side context-runway management (no realtime context-window readout per engineer memory `feedback_no_realtime_context_awareness_implications`; estimated substantive portion of context consumed across mission-88 lifecycle in this session including PR #275 ~1000-line scaffold + 27 tests + multi-thread bilateral engagement + Hub state queries).
- W1 scope: ~1000+ lines (5 KindMigrationModule + per-kind tests + W0 wire-flow.test.ts extension + operator-DX touch) — warrants fresh runway.
- Architect Option 2 REJECTED (reduced-scope Idea+Bug only would muddle cluster-1 acceptance-gate per OQ8 requiring all 5 kinds).
- thread-641 close_no_action action-1 committed via bilateral handshake.

▶ **W1 implementation DEFERRED to fresh engineer session.**

✅ **Fresh-session pickup 2026-05-24 ~12:42 AEST.** Architect dispatched W1 scaffold via thread-642 (informational; no reply required). Engineer:
- Verified W0 base at `e665de3` on origin/main.
- Created branch `agent-greg/m-k8s-envelope-w1-cluster-1` from origin/main.
- Read cluster-1 Design v0.2 (commit `d8ea695`) + W0 envelope library + W0 `_contract.ts`.
- Q2 substrate-current shape verify: code-grepped `hub/src/entities/{idea,bug,thread,mission,proposal}-repository-substrate.ts` + FSM enum definitions in `hub/src/{entities/idea.ts,entities/bug.ts,entities/mission.ts,state.ts}`.

▶ **Q2 application surfaced SUBSTANTIAL substrate-currency drift at thread-643 (2026-05-24 ~12:42 AEST). 6th catch on mission-88; pattern continues.**
- Idea drift: minor (revisionCount field doesn't exist in substrate; add updatedAt to metadata).
- Bug drift: minor (add updatedAt to metadata).
- Thread drift: phase enum substantial (active/converged/closed/expired/abandoned → active/converged/round_limit/closed/abandoned/cascade_failed) + cascade-pending bookkeeping fields not in Design.
- **Mission drift SUBSTANTIAL**: `goal`/`sourceIdeaId`/`sourceProposalId` don't exist; `documentRef`/`correlationId`/`turnId`/`missionClass`/`pulses` need partition; `tasks`/`ideas` are virtual-hydrated NOT persisted; phase enum `cancelled` → `abandoned`; `issuedTaskIds` synthetic vs PlannedTask.issuedTaskId-per-slot; `sliceTracking` no substrate counterpart.
- **Proposal drift SUBSTANTIAL**: `body`/`linkedIdeaId`/`linkedMissionId`/`reviewCount` don't exist (W4.x.7 dropped body-storage); `summary`/`proposalRef`/`decision`/`feedback`/`correlationId`/`executionPlan`/`scaffoldResult`/`labels` need partition; phase enum entire 4-state set replaced by 5-state substrate-truth.
- Engineer-proposed dispositions covered: trivial-resolves (apply substrate-truth) + 3 substantive-decisions for architect (Mission.pulses monolithic vs split partition; Proposal.summary/body confirmation; Mission v0.3 TODOs drop).
- Acceptance shape: cluster-1 Design v0.3 update folded into W1 PR; KindMigrationModule consumes ratified partition rules.

✅ **thread-643 architect-ratified R2 (2026-05-24 ~12:48 AEST). All dispositions CONCUR.**
- Trivial-resolves CONCUR (FSM enum corrections; drop non-existent Design fields; add updatedAt; Mission tasks/ideas virtual-hydrated OMIT; Thread cascade-pending bookkeeping → status).
- 3 substantive-decisions CONCUR engineer-leans: (1) Mission.pulses monolithic `status.pulses` (substrate-extension-minimum-disruption; cluster-3 §1.6 multi-FSM-in-status precedent; split-to-spec/status defer to idea-200/idea-129 follow-on cycle); (2) Proposal.summary IS declared content (no spec.body; substrate-truth); (3) Mission v0.3 TODOs drops (sliceTracking + synthetic issuedTaskIds[]).
- Architect added §3.4 OPEN-ENDED note for Mission.pulses deferred-split intent — engineer fold into Design v0.3.
- Architect-staged action-1 close_no_action; thread converged at R3 engineer handshake (2026-05-24 ~12:49 AEST). Cascade-handshake committed action-1.
- **Calibration-surface affirmation:** architect explicitly noted "engineer-proactive verify-before-bake at Q-class disposition is LOAD-BEARING discipline" — worth lifting to methodology rule (v2.1 candidate).

✅ **W1 cluster-1 PR #276 SHIPPED** (2026-05-24 ~13:13 AEST; commit `471cd2d` on branch `agent-greg/m-k8s-envelope-w1-cluster-1`).
- 15 files; +1457 / -25 lines.
- 5 KindMigrationModule (`kinds/{Idea,Bug,Thread,Mission,Proposal}.ts`) consuming v0.3-ratified partition rules.
- 5 per-kind unit tests (50 assertions; idempotency reference-equality per Q3); 3 batch wire-flow integration tests (5-kind migration; cursor isolation; idempotent re-run).
- Cluster-1 Design v0.3 update (§3.0 ratified partition tables + §3.4 OPEN-ENDED pulses note + §6 drift-table-resolution-record).
- Operator-DX (Q7 same-PR): get-entities.sh dotted-path filter (`status.phase=open`); psql-cookbook envelope-shape section (bug-118 closure verification query + per-kind navigation + labels/annotations).
- vitest.config.ts NEW (excludes dist/ — local-DX flake fix per `feedback_local_test_masking_via_cached_state`).
- Ship-verify 3-layer: tsc-strict 0 errors / vitest from hub/ 126 test files / 1599 tests pass (1 skipped) / commit-message-claims accurate.
- Hub-rebuild dependency: NOT required for W1 (additive code; no Hub bootstrap touch).

✅ **PR #276 MERGED at `f84de18`** (2026-05-24T03:23:23Z; squash-merge via architect approve + auto-merge).
- All 9/9 CI checks green pre-merge.
- Architect cross-approval landed via `pr_review_approved_bilateral` event; merge auto-fired.
- Engineer attempted admin-merge confirmed PR-already-merged; benign delete-branch error due to lily worktree main-checkout (per `feedback_pr_opened_notification_is_review_signal`).
- W1 cluster-1 envelope migration modules + cluster-1 Design v0.3 + operator-DX touch + vitest.config.ts now on main.

✅ **W2 cluster-2 Design-pass converged at thread-644 R3** (2026-05-24 ~13:34 AEST). All Q1-Q8 + A1-A3 CONCUR engineer-leans; A4 deferred to W3 dispatch.
- **Engineer-proactive verify-before-bake applied UPFRONT at R1** (not retroactively as W1 thread-643 was) — code-grepped 3 cluster-2 substrate repositories + cluster-2 Design v0.2 §2.1-§2.3 BEFORE drafting Q dispositions.
- **ZERO substrate-currency drift** found — cluster-2 Design v0.2 was substrate-accurate at authoring (2026-05-23 post-W4.x.10 timing). The 7th anticipated catch did NOT materialize — positive-surprise outcome.
- **Architect framing affirmation:** "Discipline working both directions — catches drift AND ratifies no-drift outcomes equally; calibration cluster maturing self-prompting at engineer side."
- Q-dispositions: Q1 single-bundle PR / Q2 v0.3 = v0.2 + §6 substrate-truth-ratified record / Q3 single-FSM monolithic per W1 precedent (cluster-2 has NO multi-FSM kind; multi-FSM is forward-looking cluster-3 Agent) / Q4(a) env-var flag MIGRATION_IN_PROGRESS_<KIND>; (β)/(γ) defer distributed-Hub refactor / Q4(b) Turn TOLERANT-shape dual-row test / Q4(c) Task WRITE-FREEZE via env-var + MigrationInProgressError marker / Q5 concurrent migration / Q6 wire-flow extension / Q7 operator-DX same-PR / Q8 bug-118 coverage expand 5→8 kinds.
- A-surfacings: A1 enqueuedAt → metadata.createdAt rename via renameMap / A2 naturalKey path-move + SchemaDef v2.0 derived-field forward-looking note / A3 4-class axis cross-cluster envelope-methodology pattern (declared-immutable / declared-with-controlled-mutation / observed-FSM-mutated / virtual-view) / A4 cluster-3 Agent multi-FSM per-FSM-as-top-level-status-fields (K8s PodSpec siblings precedent) DEFER to W3.

✅ **W2 cluster-2 PR #277 SHIPPED** (2026-05-24 ~13:45 AEST; commit `785185f` on branch `agent-greg/m-k8s-envelope-w2-cluster-2`).
- 12 files; +1700+ lines.
- 3 KindMigrationModule (`kinds/{Task,PendingAction,Turn}.ts`) consuming v0.3-ratified partition rules.
- 3 per-kind unit tests (38 assertions; idempotency reference-equality + partition shape + FSM rename + Turn handle-classified envelope.name+metadata.name pattern + PendingAction enqueuedAt rename).
- in-flight-dispositions.test.ts NEW (env-var flag mechanism per-kind isolation + MigrationInProgressError marker + simulated writer/sweeper consumer patterns + dual-shape tolerant-read via module-level idempotency).
- wire-flow.test.ts cluster-2 batch extension: 5 new tests (3-kind concurrent migration + cursor isolation + idempotent re-run + Q4(a)+(c) runner flag-set-on-runKind + flag-clear-on-error).
- shared/migration-flag.ts NEW (Q4(a) env-var helper + MigrationInProgressError marker).
- migration-runner.ts EXTENDED (setMigrationFlag/clearMigrationFlag at runKind try/finally boundary).
- Cluster-2 Design v0.2 → v0.3 update (§7 status flip + drift-resolution-record + A3 4-class axis cross-cluster pattern + A4 forward-looking cluster-3 note + Q4(a) env-var rationale).
- Operator-DX (Q7 same-PR): psql-cookbook bug-118 closure expanded 5→8 kinds + Turn handle-classified `metadata.name` lookup + PendingAction sweeper-queue envelope-shape (enqueuedAt→metadata.createdAt) + Task envelope-shape FSM query + in-flight migration flag operator inspection.
- Ship-verify 3-layer: tsc-strict 0 errors / vitest from hub/ 130 test files / 1644 tests pass (1 skipped) / commit-message-claims accurate.

✅ **PR #277 MERGED at `5eca435`** (2026-05-24 ~13:23 AEST per W3 dispatch preamble). W2 cluster-2 envelope migration on main.

✅ **W3 cluster-3 Design-pass converged at thread-645 R3** (2026-05-24 ~13:57 AEST). All Q1-Q9 + A1+A2 CONCUR engineer-leans + A4 documentation pin.
- **Engineer-proactive verify-before-bake applied UPFRONT at R1** (cluster-2 + cluster-3 = 2 clusters in a row self-prompting; 3rd if W1 thread-643 retroactive included).
- **MOSTLY ZERO substrate-currency drift** + 2 deliberate-extensions Design v0.2 EXPLICITLY carried (Counter structural-transform + SchemaDef OQ10 status-fields). Engineer correctly distinguished "Design explicitly adds new shape post-substrate" vs "Design drifted from substrate" — load-bearing nuance per `feedback_engineer_proactive_verify_before_bake_at_q_class`.
- Q-dispositions: Q1 single-bundle PR / Q2 v0.3 = v0.2 + §6 substrate-truth-ratified record / Q3 Agent per-FSM-as-top-level (5 distinct status fields per K8s Pod.status precedent) / Q4 SchemaDef kill-9 mock-substrate-throw mid-migration (vitest scope appropriate) / Q5 Counter Option (a) embedded-map-in-status (K8s ConfigMap precedent) / Q6 concurrent migration / Q7 wire-flow extension / Q8 operator-DX same-PR / Q9 bug-118 cluster-3 contributes ZERO new kinds (no sourceThreadId in Agent/Tele/SchemaDef/Counter; IN-clause stays at 8).
- A-decisions: A1 SubstrateCounter atomic rewrite IN W3 PR (substrate-correctness; race-clobber prevention; +~30 lines bounded scope) / A2 SchemaDef reconciler-side WRITES DEFER to follow-on PR (M-SchemaDef-Reconciler-Status-Write-Patch Idea filing at W3 ship-close) / A4 Tele `updatedAt`-omission precedent for immutable-content kinds.

✅ **W3 cluster-3 PR #278 SHIPPED** (2026-05-24 ~14:08 AEST; commit `80bcef7` on branch `agent-greg/m-k8s-envelope-w3-cluster-3`).
- 13 files; +1900+ lines.
- 4 KindMigrationModule (`kinds/{Agent,Tele,SchemaDef,Counter}.ts`) consuming v0.3-ratified partition rules.
- 4 per-kind unit tests (44 assertions; idempotency reference-equality + partition shape + FSM rename + Agent 5-distinct-status-fields + Tele NO updatedAt + SchemaDef OQ10 status injection + Counter structural transform).
- wire-flow.test.ts cluster-3 batch extension: 6 new tests (4-kind concurrent migration + Counter structural verify + Agent per-FSM observability + Tele NO updatedAt + SchemaDef OQ10 status + Q4 SchemaDef kill-9-simulated restart-safety via mock-substrate-throw + reset-cursor clean-recovery pattern).
- **SubstrateCounter atomic rewrite per A1**: `substrate-counter.ts` reads tolerant-dual-shape (envelope OR legacy-flat backward-compat); writes envelope-shape always; preserves bug-97 W5.5 CAS mechanism. Extended `substrate-counter.race.test.ts` with 4 envelope-shape race assertions.
- Cluster-3 Design v0.2 → v0.3 update (§6 status flip + substrate-currency-ratification record + A1+A2+A4 dispositions + maturity signal: 3 clusters self-prompting).
- Operator-DX (Q8 same-PR): psql-cookbook NEW sections (Agent per-FSM-status query showing 5 status fields observability; Tele lifecycle phase query; SchemaDef reconciliation-status query per OQ10 deviation; Counter envelope-shape inspection).
- Ship-verify 3-layer: tsc-strict 0 errors / vitest from hub/ 134 test files / 1694 tests pass (1 skipped) / commit-message-claims accurate.
- Hub-rebuild dependency REQUIRED for W3 dev-cycle verification (SubstrateCounter feeds 11 existing-substrate-version repositories for ID allocation).

✅ **PR #278 MERGED at `6b07ee2`** (2026-05-24 ~14:17 AEST per W4 dispatch preamble). W3 cluster-3 envelope migration on main.

✅ **W4 cluster-4 Design-pass converged at thread-646 R3** (2026-05-24 ~14:21 AEST). All Q1-Q9 + A1+A2+A3 CONCUR engineer-leans.
- **Engineer-proactive verify-before-bake applied UPFRONT at R1** (4 clusters in a row self-prompting: cluster-2 + cluster-3 + cluster-4 zero-drift).
- **ZERO substrate-currency drift** across all 4 cluster-4 kinds; cluster-4 Design v0.2 substrate-accurate at authoring (2026-05-23 alongside cluster-3; same recency).
- **7th substrate-currency catch on mission-88 calibration cluster** — engineer code-trace caught architect Q9 spec-recall drift (architect dispatch said "Message has sourceThreadId per substrate — cluster-4 likely expands IN-clause 8→9 kinds"; engineer verified Message has threadId/authorAgentId/authorRole NOT sourceThreadId; cluster-4 §3.9 had correct answer). **Even at "discipline-mature 4-clusters-in-a-row" stage, architect dispatch CAN drift from prior Design framing.**
- Q-dispositions: Q1 single-bundle PR / Q2 v0.3 = v0.2 + §6 substrate-truth-ratified record / Q3 Message.kind → metadata.messageKind CANONICAL renameMap (FIRST cross-cluster use of envelope library renameMap for true field-name-collision; W0 primitive design-driver case finally first-used) / Q4 Audit append-only "logged" constant + timestamp→metadata.createdAt rename / Q5 RepoEventBridge* envelope-with-opaque-body in status (renameMap body→status.cursor/dedupe; K8s bookkeeping CRD precedent) / Q6 concurrent migration / Q7 wire-flow extension / Q8 operator-DX same-PR / Q9 CORRECTION CONCUR engineer code-trace — bug-118 IN-clause stays at 8 kinds.
- A-decisions: A1 RepoEventBridgeSubstrateAdapter atomic rewrite IN W4 PR (substrate-correctness; parallels W3 A1 SubstrateCounter; race-clobber prevention; +~20 lines bounded) / A2 Q9 framing-correction acknowledged as 7th substrate-currency catch / A3 entity-kinds.json v1.3 consistency NO ACTION.
- **NEW 7th cumulative envelope-methodology pattern (architect framing thread-646 R2):** atomic-primitive-rewrite-with-wave-migration — when wave structural-transformation requires substrate primitive to know about envelope-shape, primitive rewrite ships atomically (W3 SubstrateCounter + W4 RepoEventBridge adapter instances).

✅ **W4 cluster-4 PR #279 SHIPPED** (2026-05-24 ~14:31 AEST; commit `293ee32` on branch `agent-greg/m-k8s-envelope-w4-cluster-4`).
- 13 files; +1500+ lines.
- 4 KindMigrationModule (`kinds/{Message,Audit,RepoEventBridgeCursor,RepoEventBridgeDedupe}.ts`) consuming v0.3-ratified partition rules.
- 4 per-kind unit tests (36 assertions; idempotency + partition shape + Message CANONICAL renameMap envelope.kind="Message"+metadata.messageKind=legacy.kind + multi-FSM status + 5 messageKind enums + Audit "logged" constant + RepoEventBridge body→status.cursor/dedupe sibling separation).
- wire-flow.test.ts cluster-4 batch extension: 5 new tests (4-kind concurrent + Message CANONICAL renameMap end-to-end + Audit "logged" envelope verify + RepoEventBridge* opaque-body preservation + idempotent re-run).
- **RepoEventBridgeSubstrateAdapter atomic rewrite per A1**: `repo-event-bridge-adapter.ts` reads tolerant-dual-shape (envelope OR legacy-flat); writes envelope-shape always (status.cursor for Cursor / status.dedupe for Dedupe; bodyStatusField helper + buildEnvelopeWrite + readBody). Race-clobber risk eliminated; cursor-store opaque JSON contract preserved through adapter seam. Adapter tests updated (22/22 pass with envelope-shape assertions).
- Cluster-4 Design v0.2 → v0.3 update (§6 substrate-currency-ratification record + A1 atomic adapter rewrite documented + 7th substrate-currency catch + Q3 Message renameMap CANONICAL first-use + bug-118 IN-clause stays at 8 kinds + 7th cumulative envelope-methodology pattern atomic-primitive-rewrite-with-wave-migration folded into §5).
- Operator-DX (Q8 same-PR): psql-cookbook NEW sections (Message envelope-shape query CANONICAL field-name-collision rename; Audit envelope-shape forensic timestamp→createdAt rename "logged" constant; RepoEventBridge* opaque-body inspection status.cursor/status.dedupe navigation).
- Ship-verify 3-layer: tsc-strict 0 errors / vitest from hub/ 138 test files / 1736 tests pass (1 skipped) / commit-message-claims accurate.
- Hub-rebuild dependency REQUIRED for W4 dev-cycle verification (RepoEventBridgeSubstrateAdapter feeds bridge runtime at Hub startup).

✅ **PR #279 MERGED at `2099e08`** (2026-05-24 ~14:37 AEST per W5 dispatch preamble). W4 cluster-4 envelope migration on main.

✅ **W5 cluster-5 Design-pass converged at thread-647 R3** (2026-05-24 ~14:41 AEST). **FINAL CLUSTER.** All Q1-Q10 + A1+A2 CONCUR + A3 architect-disposition.
- **Engineer-proactive verify-before-bake applied UPFRONT at R1** (5 clusters in a row self-prompting — discipline-maturity capstone reached).
- **ZERO substrate-currency drift** across all 5 cluster-5 kinds; cluster-5 Design v0.2 production-substrate-verified at Phase 4 closure 2026-05-23 via psql.
- Q-dispositions: Q1 single-bundle PR / Q2 v0.3 = v0.2 + §6 substrate-truth-ratified record / Q3 Document.category → metadata.labels.category CONTENT-classification axis FIRST-instance (cluster-3 §5 6th cumulative-pattern materially bilateral; Agent.spec.labels was routing-intent first; Document.metadata.labels is content-classification first) / Q4 "logged" constant for 4 append-only kinds + Document "active" constant (mostly-static) / Q5 updatedAt-omission for 4 append-only HistoryEntry + ArchitectDecision + Document MAY have updatedAt forward-compat / Q6 concurrent migration / Q7 wire-flow extension / Q8 operator-DX same-PR / **Q9 bug-118 coverage CLOSED FINAL at 8 kinds** (ThreadHistoryEntry.threadId is forensic-pointer NOT cascade-provenance per Q9 engineer code-trace + Design §3.6 framing; cluster-5 contributes ZERO new kinds) / **Q10 7th cumulative pattern NOT APPLICABLE for W5** (Document write-path direct substrate.put; no primitive-coupling; pattern stays at 2 instances W3 SubstrateCounter + W4 RepoEventBridge adapter — **pattern set complete**).
- A-decisions: A1 Document.metadata.labels content-classification FIRST-instance documented in cluster-5 v0.3 §5 / A2 Document.name = legacy.id file-stem convention / A3 M-SchemaDef-Reconciler-Status-Write-Patch Idea filing architect-disposition at W5 ship-close (composes with W6 cutover + Phase 10 retrospective context).

✅ **W5 cluster-5 PR #280 SHIPPED — FINAL CLUSTER** (2026-05-24 ~14:50 AEST; commit `194be02` on branch `agent-greg/m-k8s-envelope-w5-cluster-5`).
- 12 files; +1500+ lines.
- 5 KindMigrationModule (`kinds/{Document,ArchitectDecision,DirectorHistoryEntry,ReviewHistoryEntry,ThreadHistoryEntry}.ts`) consuming v0.3-ratified partition rules.
- 5 per-kind unit tests (41 assertions; Document content-classification axis first-use + name file-stem + "active" constant + category enum preservation + labels-omission on null; ArchitectDecision/DirectorHistory/ReviewHistory/ThreadHistory append-only "logged" + timestamp→createdAt + NO updatedAt + FK pointers + Q9 ThreadHistory threadId NOT sourceThreadId framing distinction).
- wire-flow.test.ts cluster-5 batch extension: 4 new tests (5-kind concurrent + Document CONTENT-classification axis verification + 4-kind "logged" + Q5 updatedAt-omission for 4 append-only + Q9 FK pointer verification rh-N taskId / th-N threadId NOT sourceThreadId + idempotent re-run).
- Cluster-5 Design v0.2 → v0.3 update (§6 substrate-truth-ratified record + discipline-maturity capstone framing + Q3 Document CONTENT-classification axis FIRST-instance + Q9 bug-118 CLOSED FINAL at 8 kinds + Q10 7th cumulative pattern stays at 2 instances [pattern set complete] + A2 Document.name file-stem + A3 architect-disposition Idea filing).
- Operator-DX (Q8 same-PR): psql-cookbook NEW sections (Document envelope-shape CONTENT-classification query metadata.labels.category navigation FIRST-instance; 4 append-only HistoryEntry forensic queries all carrying status.phase="logged" constant + timestamp→metadata.createdAt rename + FK pointer navigation; ThreadHistory threadId forensic-pointer Q9 distinction documented).
- Ship-verify 3-layer: tsc-strict 0 errors / vitest from hub/ 143 test files / 1781 tests pass (1 skipped) / commit-message-claims accurate.
- Hub-rebuild dependency: NOT required for W5 (additive code; Document/HistoryEntry write-paths direct substrate.put; no primitive-coupling per Q10).

✅ **PR #280 MERGED at `b36cda4`** (2026-05-24 ~14:57 AEST per W6 dispatch preamble). W5 cluster-5 envelope migration on main. **idea-126 Phase 4 Design fully realized.**

✅ **W6 PRODUCTION CUTOVER + CLOSE Design-pass converged at thread-648 R3** (2026-05-24 ~15:01 AEST). **FINAL mission-88 wave bilateral closes here.** All Q1-Q9 + A1+A2+A3 CONCUR engineer-leans.
- **Methodology refinement absorbed:** "runbook-shape should match operation-shape" (architect framing thread-648 R2) — bootstrap=prose (mission-83 W5.4); data-migration=script (mission-88 W6); cutover=script-with-gates. Engineer-correct divergence from prose-runbook precedent when operation-shape differs. Saved as engineer memory `feedback_runbook_shape_matches_operation_shape`.
- Q-dispositions: Q1 Immediate cutover timing (autonomous-arc per RACI) / Q2 SINGLE automated `scripts/operator/m-k8s-envelope-cutover.sh` (runbook-as-code; reuses W0-W5 tested codepaths via MigrationRunner; dev-cyclable against testcontainers) / Q3 targeted smoke ~10s (per-kind shape probe 21 kinds + bug-118 closure query + per-cluster write smoke 5 writes) / Q4 image-tag-pin rollback + 4 specific triggers / Q5 closing audit architect-author + engineer-review / Q6 ADR 032-k8s-envelope-cutover architect-author / Q7 entity-kinds.json v1.3 → v2.0 envelope-marker bump (3 new fields) / Q8 Mission close sequencing (update_mission(completed) → pulses auto-suspend → Phase 9 → Phase 10 trigger) / Q9 Phase 10 Walkthrough mode architect-lean (substrate-introduction class warrants Director-time investment proportionate).
- A-decisions: A1 migration runtime <60s within mission-83 W5.4 budget / A2 bug-118 closure query reuses psql-cookbook verbatim / A3 work-trace finalization post-Mission.status=completed.

✅ **W6 PR #281 SHIPPED — FINAL mission-88 wave** (2026-05-24 ~15:07 AEST; commit `f45e227` on branch `agent-greg/m-k8s-envelope-w6-cutover-close`).
- 4 files; +~700 lines.
- `scripts/operator/m-k8s-envelope-cutover.sh` NEW — automated cutover-script with 6 steps + 4 rollback-triggers (pre-flight DB / MigrationRunner across 21 kinds / SchemaDef strict-mode flip / per-kind shape probe / bug-118 closure query / per-cluster write smoke); DRY_RUN mode for dev-cycle verification; runbook-as-code matches data-migration operation-shape; reuses W0-W5 tested codepaths.
- `hub/scripts/entity-kinds.json` v1.3 → v2.0 envelope-marker bump (3 new fields: $cutover-completed-at + $envelope-marker="k8s-envelope-v1" + $generation-source v2.0 update; 21 kinds remain locked).
- `docs/audits/m-k8s-envelope-closing-audit.md` STUB for architect-fill post-cutover (§1 Phase 8 ship metrics table + §2 bug-118 closure + §3 7 substrate-currency catches + §4 7 cumulative envelope-methodology patterns + §5 post-mission Idea filings + §6 calibration capstone).
- `docs/decisions/032-k8s-envelope-cutover.md` STUB for architect-fill (next ADR per existing convention; 031-shim-observability was most recent).
- Ship-verify 3-layer: tsc-strict 0 errors / vitest from hub/ 143 test files / 1781 tests pass (1 skipped) / commit-message-claims accurate. No test impact from W6 (operator-script + docs + JSON metadata).

✅ **PR #281 MERGED at `4085d63`** (2026-05-24T05:10:08Z; architect approve + auto-merge per W2-W5 precedent pattern).

**🎯 ALL 6 mission-88 SHIP PRS MERGED ON MAIN.** idea-126 Phase 4 Design FULLY REALIZED across all 21 substrate-mediated entity kinds.

Sequential merge state on origin/main:
- e665de3 W0 substrate-prep
- f84de18 W1 cluster-1 substantive-content
- 5eca435 W2 cluster-2 queue/FSM-active
- 6b07ee2 W3 cluster-3 metadata/config/projection
- 2099e08 W4 cluster-4 system-emit/bookkeeping
- b36cda4 W5 cluster-5 content-archive (FINAL CLUSTER)
- 4085d63 W6 production cutover + close (FINAL WAVE)

⚠ **W6.1 hotfix surfaced 2026-05-24 ~15:35 AEST — bug-119 cutover-blocker** caught at architect-side cutover-execution dogfood (PRE-execution wire-flow check vs production). MigrationRunner had ZERO production invocation paths: W0 scaffolded primitive + W1-W5 built 21 KindMigrationModule but no wave specced operative invocation wiring. Deploying W6 Hub image + restarting would NOT have migrated any data; strict-mode flip post-deploy would reject all reads. **Director-ratified W6.1 hotfix slice 2026-05-24.**

✅ **W6.1 Design-pass converged at thread-649 R3** (2026-05-24 ~15:38 AEST). All Q1-Q6 + A1-A3 CONCUR engineer-leans; Q3 --json flag YES + A2 npm-script YES + A3 closing-audit fold deferred to architect-fill.
- **Bilateral catch-pair (closing-audit §3 8th methodology refinement framing):** Engineer-side wire-flow-verify-at-ship gap (W6 cutover-script Step 2 hand-waved over wiring-gap without verifying it exists) + architect-side own-spec-mechanism-presumption (no wave specced operative invocation; per-cluster acceptance gates verified per-kind correctness but cross-wave wire-flow not verified end-to-end at any wave). Pattern: "end-to-end-wire-flow dogfood as wave-acceptance-gate (not just per-layer-test)" — the missing acceptance gate that bug-119 catches.

✅ **W6.1 hotfix PR #282 SHIPPED** (2026-05-24 ~15:43 AEST; commit `1b64963` on branch `agent-greg/m-k8s-envelope-w6.1-migration-cli`).
- 4 files; +533 / -10 lines.
- `hub/scripts/run-envelope-migration.ts` NEW — standalone CLI entry-point; imports + registers all 21 KindMigrationModule + invokes runKind per-kind concurrently per W0 design; structured-text default output + --json opt-in flag + --dry-run flag + distinct exit-codes (0/1/2/3/4 per architect R2).
- `hub/package.json` MODIFIED — adds `envelope-migrate` npm-script (operator-DX win).
- `scripts/operator/m-k8s-envelope-cutover.sh` MODIFIED — Step 2 replaces placeholder echoes with explicit `cd hub && npm run envelope-migrate [-- --dry-run]` invocation + halt-on-non-zero-exit (rollback-trigger 1).
- `hub/src/__tests__/run-envelope-migration.cli.test.ts` NEW — 8 tests (3 unit + 4 integration + 1 sanity); subprocess-invokes CLI against testcontainer postgres; re-uses harness/fixtures.ts per Q5.
- Ship-verify 3-layer: tsc-strict 0 errors / vitest from hub/ 144 test files / 1789 tests pass (1 skipped) / commit-message-claims accurate.
- Hub-rebuild dependency REQUIRED for production-cutover (CLI compiled to dist/scripts/run-envelope-migration.js); local dev-cycle tests use tsx subprocess invocation.

✅ **Engineer-side calibration filed at W6.1 ship:** `feedback_engineer_proactive_wire_flow_verify_at_ship` — inward-facing engineer-runtime discipline (grep caller-sites + bootstrap-wiring + CLI/npm-script presence before ship; per-layer tests can pass while production has no invocation path). Sibling of `feedback_engineer_proactive_verify_before_bake_at_q_class` (substrate-shape-verify) + `feedback_apply_directional_diagnostic_to_own_spec_authorship` (architect-side mechanism-presumption mirror).

▶ **PR #282 in-flight; awaiting `pr_opened_bilateral` architect approve + CI completion.**

▶ **Post-W6.1 ship:** architect-side re-executes W6 cutover (build Hub image with W6 + W6.1 code from main; deploy; CLI invocation; verify; strict-flip; smoke). Then mission-close arc per W6 Q5+Q6+Q7+Q8 (closing artifacts + Mission.status=completed + Phase 10 Retrospective dispatch).

▶ **Post-merge architect-side execution arc (final mission-88 close-out):**
1. Execute `scripts/operator/m-k8s-envelope-cutover.sh` against production hub-vm
2. Verify smoke + bug-118 closure (cutover-script Step 4-5 outputs)
3. Author closing audit doc (architect-fills `docs/audits/m-k8s-envelope-closing-audit.md` stub per A3)
4. Author ADR 032 (architect-fills `docs/decisions/032-k8s-envelope-cutover.md` stub)
5. Final entity-kinds.json bump with `$cutover-completed-at` ISO timestamp
6. `update_mission(mission-88, status="completed")` → Phase 8 → Phase 9 Close → pulses auto-suspend
7. Phase 10 Retrospective dispatch surface to Director (architect-lean Walkthrough mode per Q9)

▶ **Director gate-engagement (Phase 10):** retrospective mode pick + retrospective execution per chosen mode.

▶ **Engineer-side post-Mission.status=completed:**
- Work-trace finalization commit (final mission-state-of-affairs entry; Phase 9 Close timestamp; Phase 10 Retrospective dispatch pointer when architect engages)
- Work-trace branch (`agent-greg/m-k8s-envelope-work-trace`) retention through retrospective per A3

▶ **Post-mission Idea filings (architect-side):**
- **M-SchemaDef-Reconciler-Status-Write-Patch** Idea — substrate-extension class; cluster-3 A2 OQ10 deferred reconciler-side WRITES (architect-disposition at W5 or W6 ship-close)
- **idea-200 M-Thread-Substrate-Carve-Out** — Thread.status.messages → cluster-4 Message store carve-out (composition checkpoint per cluster-1 §3.3 + cluster-4 §3.1)
- **idea-151 M-Graph-Relationships** — FK pointer edge-extraction across multiple clusters

**6 of 6 mission-88 waves implemented (W0-W6).** idea-126 Phase 4 Design fully realized. mission-88 cluster-work phase complete; W6 finalizes via production cutover + close + Phase 10 Retrospective trigger.

**5 of 5 cluster waves implemented.** **idea-126 Phase 4 Design completes at PR #280 merge.** All 21 substrate-mediated kinds carry K8s envelope shape uniformly post-merge.

**mission-88 calibration cluster maturity FINAL:** 7 substrate-currency catches + 7 cumulative envelope-methodology patterns articulated (pattern set complete) + 5 clusters in a row self-prompting at engineer-proactive R1 verify-before-bake + bug-118 IN-clause CLOSED at 8 kinds across all 5 cluster waves. Discipline working both directions reliably; engineer-proactive verify-before-bake at Q-class disposition is LOAD-BEARING self-prompting at engineer side. cluster-3 §5 6th cumulative-pattern axis materially bilateral with W5 Document.metadata.labels first-instance. Pattern is fully realized.

---

### Cold-pickup pointers for next engineer session

1. **Read this trace first.** Mission-88 state through W0 merge (PR #275, e665de3) + W1 Design-pass converged (thread-640 sealed; thread-641 handoff accepted).
2. **Read `get_thread(thread-640)`** for the full W1 Q1-Q7 disposition table.
3. **W1 deliverables shape (single bundle PR):**
   - 5 KindMigrationModule at `hub/src/storage-substrate/migrations/v2-envelope/kinds/{Idea,Bug,Thread,Mission,Proposal}.ts` (each: schemaRef + migrateOne over `encodeEnvelope` with per-kind partition rules from cluster-1 §3.1-§3.5)
   - 5 per-kind unit tests at `__tests__/kinds/{Idea,Bug,Thread,Mission,Proposal}.test.ts` (encode legacy → re-invoke migrateOne(envelope) → assert reference-equality for idempotency)
   - Extension to W0 `__tests__/wire-flow.test.ts` with cluster-1 batch-migration synthetic test case (seeds 1-2 rows per kind across all 5; runs MigrationRunner; asserts cursor per-kind isolation)
   - Operator-DX touch: `scripts/local/get-entities.sh` envelope-shape support + `docs/operator/psql-cookbook.md` envelope-shape example queries (same PR if scope-narrow ~50 lines bash + 1-2 markdown sections; spin separate PR if scope expands)
4. **Substrate-current shape verify BEFORE baking partition rules** (Q2 disposition): code-grep on `hub/src/entities/{idea,bug,thread,mission,proposal}-repository-substrate.ts` for actual write-time field-list; optional psql `SELECT jsonb_object_keys(data) FROM entities WHERE kind = 'X' LIMIT 1` per kind for live-substrate confirmation. Cross-reference cluster-1 Design (commit `d8ea695`) partition rules; surface any drift as Q-class addition to architect.
5. **Branch convention:** `agent-greg/m-k8s-envelope-w1-cluster-1` (new branch from origin/main).
6. **Ship-verify 3-layer per `feedback_ship_verify_3_layer_discipline`:** tsc-strict + vitest + commit-message-claims accurate. Hub-rebuild dependency (build-hub.sh + start-hub.sh) in PR test plan per Q5 disposition + `feedback_adapter_restart_protocol_hub_container`.
7. **PR flow per W0 precedent (#275):** open via `gh pr create`; architect cross-approves on pr_opened_bilateral notification; engineer admin-merge via `gh pr merge --squash --delete-branch` (delete-branch may error on lily worktree checkout — benign, lily's concern).
8. **Bug-118 envelope-shape closure verification at W1 acceptance gate:** PR test plan includes `SELECT COUNT(*) FILTER (WHERE data->'metadata'->>'sourceThreadId' IS NOT NULL), COUNT(*) FROM entities WHERE kind IN ('Idea','Bug','Thread','Mission','Proposal')` smoke query (post-merge dev-cycle).

### mission-88 calibration cluster (5 substrate-currency catches; pattern inherits)

| # | Surface | Direction | Substrate-truth |
|---|---------|-----------|-----------------|
| 1 | thread-635 R1 | architect → engineer | cluster-4 v0.2 Notification drop (engineer spec-recall stale) |
| 2 | thread-635 R2 | engineer → architect | A5 entity-kinds.json v1.2/20 → v1.3/21 (engineer worktree stale) |
| 3 | thread-637 R1 | engineer → architect | bug-97 STALE-OPEN (architect dispatch-premise stale; fix landed at e109000) |
| 4 | thread-639 R2 precision-pin (ii) | bilateral | Q2 "SchemaDef reconciler tolerance" → "write-validation envelope tolerance" doc-side framing |
| 5 | thread-640 R2 Q2 | engineer proactive | substrate-current shape verify BEFORE baking W1 partition rules (5th = proactive, not reactive) |
| 6 | thread-643 R1 W1 | engineer proactive | cluster-1 Design v0.2 partition rules SUBSTANTIAL drift vs substrate-current truth (Mission goal/sourceIdeaId/tasks-virtual/phase=abandoned; Proposal body/linked*/reviewCount; Thread phase enum; minor adds across all 5 kinds); Design v0.3 update folded into W1 PR |

Pattern: **substrate-currency-discipline cuts both ways at all 4 surfaces (code-trace + entity-state + fix-commit + retired-file)**. Next engineer session should expect to apply this proactively at Q2 substrate-shape verification step.

### Pulse cadence

W1 = 30min default per OQ13. `missedThreshold=2` may fire benignly during the handoff window before next engineer engagement; informational only, no escalation surface needed.
- Engineer dispositions (concur unless flagged):
  - **OQ1 (wave shape):** CONCUR cluster-mirrored W1→W5 + W6.
  - **OQ2 (missionClass):** CONCUR `substrate-introduction`.
  - **OQ3 (cutover-window):** CONCUR tolerant-dual-shape W0-W5 + strict-flip at W6.
  - **OQ4 (migration approach):** CONCUR in-place SQL JSONB (per-kind modules under `hub/src/storage-substrate/migrations/v2-envelope/kinds/*.ts`).
  - **OQ5 (SchemaDef self-migration):** CONCUR W3; flag restart-during-migration test at W3 acceptance gate.
  - **OQ6 (Counter / bug-97):** **RECOMMEND SEPARATE-AND-PRIOR** to W3 (engineer-side substrate-defect-scope discipline; not fold-in).
  - **OQ7 (reader-side parse):** CONCUR tolerant W0-W5 + strict at W6 (natural OQ3 pairing).
  - **OQ8 (per-wave acceptance gate):** CONCUR full read/write/wire-flow per wave (calibration #62 territory).
  - **OQ9 (entity-ID prefix retention):** CONCUR `metadata.name` preservation (operator-DX hard requirement).
  - **OQ10 (production cutover timing):** CONCUR single W6 Hub-redeploy; flag pre-prod-substrate-mirror dependency at Phase 6 Preflight.
  - **OQ11 (in-flight items):** **RECOMMEND hybrid** drain (PendingAction-sweeper) + tolerant-shape (Turn) + write-freeze (Task) — sub-OQ11 per-kind disposition.
  - **OQ12 (bug-117 / bug-118):** bug-118 ALREADY in scope (cluster-1 + cluster-2 via `shared/provenance.ts`); **bug-117 needs clarification** (not found in docs/bugs/).
  - **OQ13 (pulse cadence):** CONCUR ~30min default; recommend per-wave relaxation (W0/W5 ~60min; W6 tighten to ~15min during redeploy).
- Engineer additional surfacings (5):
  - **A1:** bug-117 clarification (architect-side).
  - **A2:** Migration script idempotency + checkpoint-resume per-kind.
  - **A3:** Pre-prod substrate-mirror availability (Phase 6 Preflight gate).
  - **A4:** Operator-DX cutover continuity (`get-entities.sh` + `psql-cookbook.md` per-wave).
  - **A5:** entity-kinds.json v1.3 update timing (W0 substrate-prep; ThreadHistoryEntry add).

---

## Queued / filed (mission scope)

- ▶ **Mission entity spawn** — propose_mission cascade fires post thread-635 convergence (engineer R5 commit handshake 2026-05-24 ~10:06 AEST). Awaiting Mission ID assignment + draft → proposed status transition by architect.
- ▶ **idea-126 entity transition** — flip `triaged` → `incorporated` with `missionId` set, post-Mission spawn (architect `update_idea` cascade).
- ○ **SchemaDef extension v1.1 → v2.0** (architect-fronts) — `hub/scripts/entity-kinds.json` per-kind partitioning into `metadata` / `spec` / `status` JSON Schemas. All 20 kinds.
- ○ **Migration script** (engineer-fronts) — postgres in-place data migration; per-kind modules + registry; rollback strategy per Q3.
- ○ **Code-path migration** (engineer-fronts) — `hub/src/entities/*-repository-substrate.ts` updated for envelope read/write.
- ○ **Pre-cutover dry-run** (bilateral) — read-only postgres snapshot; envelope-schema validation per kind.
- ○ **3-layer test suite** (engineer-fronts) — per-kind unit + wire-flow integration + cutover rehearsal e2e.
- ○ **Composition checkpoints** (bilateral) — `get_resource_shape` contract w/ idea-121 + `metadata.sourceThreadId` capture w/ bug-118.
- ○ **Cutover plan** (bilateral) — image pre-build window + Hub redeploy + <30s downtime acceptance.
- ○ **Operator-DX updates** (engineer-fronts) — `scripts/local/get-entities.sh` envelope-shape support + `docs/operator/psql-cookbook.md` envelope query examples.

---

## Anti-goals (canonical; carried forward across Design rounds)

**Survey §6 (10 anti-goals):**
1. No K8s controller-runtime / etcd-watch / IaC-runtime machinery; conventions only.
2. No dual-write transition window; big-bang cutover.
3. No group-taxonomy proliferation; `core.ois/v1` + `ext.ois`-reserved minimal namespace.
4. No author-discretion on spec/status partition; convention strictly enforced.
5. No pulling forward beyond Mission scope; ships post-Design-ratification.
6. No K8s-isms beyond shape (no Pod/Deployment/CRD semantics imported).
7. No tool-surface modernization in this Mission (defers to idea-121).
8. No first-class graph relationships in this Mission (defers to idea-151).
9. No automated entity-data validation enforcement at write-boundary beyond schema-shape check.
10. **Bug-118 fix IS in scope** — substrate-wide bug-lineage capture via `metadata.sourceThreadId` envelope field is this Mission's responsibility; not a separate Mission.

**Design Round 1 additions (engineer-side; 5):**
11. No historical entity backfill (forward-looking only per bug-118 / thread-632 anti-goal).
12. No cognitive-surface field depth without ergonomic check (title/description stay top-level on envelope for kinds with substantive cognitive surface).
13. Additive-only changes preserve `core.ois/v1` apiVersion; non-additive changes bump to `core.ois/v2` (apiVersion evolution discipline).
14. No `get_resource_shape` MCP tool in this Mission's scope (defers to idea-121 Design); this Mission commits SchemaDef shape only.
15. Operator-DX (`get-entities.sh` + cookbook) updates IN scope (small additional scope; preserves daily-driver from breaking mid-cutover).

---

## Done this session

✅ **Phase 4 Design Round 1 engineer reply landed** (thread-634, 2026-05-23 ~09:00 AEST). Substantive engagement on architect's 5 starter questions + 5 additional engineer-side dimensions surfaced.

✅ **Phase 4 Design CLOSED by architect** with 5 cluster Design docs merged to main (PRs #267-#272 / commits d8ea695, 59c3a70, ddf7bb1, 3b1819a, 71690de). 21 substrate-mediated kinds per entity-kinds.json v1.3 (Notification dropped at cluster-4 v0.2 per engineer substrate-currency catch).

✅ **Phase 5 Manifest Round-1 engineer reply landed** (thread-635, 2026-05-24 ~09:56 AEST). 13 OQs + 5 additional surfacings (A1-A5). All 5 cluster Designs read in full to ground responses.

✅ **Architect R2 dispositions integrated** (thread-635, 2026-05-24 ~09:59 AEST). All R1 engineer-side refinements accepted. v0.2 wave plan published with: pre-W0 bug-97 prerequisite slice / W0 + migration-cursor primitive + per-kind idempotency / W2 + per-kind in-flight disposition tests / W3 + kill-9-restart-safety test / per-wave operator-DX last sub-step / Phase 6 Preflight pre-prod-mirror flag / pulse cadence W0+W5 ~60min / W1-W4 ~30min / W6 ~15min active. A5 ground-truth corrected: entity-kinds.json IS at v1.3 / 21 kinds on origin/main HEAD; engineer worktree was stale.

✅ **Phase 5 Manifest Round-3 engineer reply landed** (thread-635, 2026-05-24 ~10:02 AEST). v0.2 ratified; A5 substrate-currency catch acknowledged via `git show origin/main:hub/scripts/entity-kinds.json` verification (v1.3 / 21 kinds / Notification carved out at PR #271 / `3b1819a`). Architect's sanity-ask on cascade shape resolved via code-grep: `propose_mission` payload is `{title, description, goals}` only (NO `plannedTasks[]`); Mission spawns at `draft`; architect-converged-only per Hub policy gate. Path A recommended for R4 close (architect-staged propose_mission cascade preserves back-link metadata).

✅ **Work-trace spawned** (this file).

---

## Provenance

- **Mission origin:** idea-126 (Director-proposed 2026-04-21; triaged 2026-05-23 via thread-628 / SR run).
- **Survey 1:** `docs/reviews/2026-05-23-survey-idea-126.md` — Director-ratified A/A/A both rounds; archived via PR #264 (architect-authored).
- **Design dispatch:** thread-634 (correlationId=design-idea-126; architect-spawned 2026-05-23 ~08:58 AEST).
- **SR + cartography lineage:**
  - PR #256 — Threads v3 cartography v1.0 (`0d22d84`)
  - PR #257 — Engineer enrichment companion v1.0 (`c644838`)
  - PR #258 — Substrate-DX A.2 / get-entities.sh remote-mode (`2858d0f`)
  - PR #259 — Engineer enrichment companion v1.1 (`ae44ba3`)
  - PR #260 — Cartography v1.1 in-place fold (merged)
  - PR #261 — strategic-review.md v2.0 (merged)
  - PR #262 — SR v2.0 first Standard-mode run (Threads v3) v1.1 (merged)
  - PR #263 — SR §6 cross-kind generality patch (merged)
  - PR #264 — Survey 1 archive (architect-authored; open)
- **Anchor:** idea-312 (M-Threads-v3 umbrella; W1 wire-substrate program).
