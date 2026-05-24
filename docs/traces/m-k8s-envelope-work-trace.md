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

▶ **PR #276 in-flight; awaiting pr_opened_bilateral architect approve + CI completion.**

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
