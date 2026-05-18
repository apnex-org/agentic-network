# M-Hub-Storage-Substrate (mission-83) — architect work-trace

**Mission:** mission-83 (M-Hub-Storage-Substrate; idea-294 lineage)
**Architect:** lily (agent-40903c59)
**Engineer:** greg (agent-0d2c690e)
**Status:** mission-83 CLOSED (Director-ratified Phase 7 release-gate 2026-05-18; status=completed). Phase 8 waived per Director-direct. Phase 10 retrospective draft shipped. 3 follow-on Surveys complete (idea-300 + idea-301 + idea-298 scope-pinned). Standing by for Phase 4 Design entry (idea-300 architect-recommended first per Q3a strict-sequencing).
**Branch:** `agent-greg/m-hub-storage-substrate` (engineer-side); `agent-lily/m-hub-storage-substrate` (architect-side)
**Mission lineage:** Phase 1 Concept → Phase 2 Idea (idea-294) → Phase 3 Survey (Director-ratified 6 picks) → Phase 4 Design (v0.1 → v1.4 ladder) → Phase 5 Manifest → Phase 6 Preflight (GREEN) → Phase 7 Implementation (W0-W7) → Phase 10 Retrospective (pending)
**Wave state @ trace-init:** W5.4 cutover-executed; W5.5 smoke matrix dispatched (thread-573)

> **Trace-init disclaimer:** This trace was created at W5.4 cutover-completion (2026-05-17 15:17 AEST) — late vs canonical mission-start trace-creation per `feedback_per_mission_work_trace_obligation.md`. No backfill attempted (per memory rule); session-log captures forward only. Prior session detail lives in conversation transcript at `/home/apnex/.claude/projects/-home-apnex-taceng-agentic-network-lily/593dcc08-e120-4fce-83b6-b15d79179336.jsonl`.

---

## Session log

### 2026-05-17 15:17 AEST — W5.4 CUTOVER COMPLETE; bug-93 STRUCTURAL CLOSURE confirmed

**Trigger:** Director "Approved to proceed full rebuild" authorization (Option 1: architect-attempts the docker rebuild + container-restart with verification gates).

**Cutover orchestration sequence executed:**

1. **Pre-cutover snapshot** — `/home/apnex/taceng/cutover-snapshots/pre-cutover-20260517T043004Z.tar.gz` (12MB tar.gz of local-state/) — retained for rollback per Design §3.2
2. **Migration (script production-ized at `hub/scripts/migrate-fs-to-substrate.ts` per greg's 03c6ce2 + W5.4-fix 77218cf)** — 15,691 entities across 19 kinds populated in postgres; 3.21s wall-clock
3. **Docker image rebuild** — encountered docker default seccomp blocking in-container `npm install` (node fails at libuv `uv_thread_create` on kernel 5.8.18-100.fc31); pivoted to host-build (npm install + tsc) + prebuilt-artifact Dockerfile pattern; new image `ois-hub:local-substrate` (559MB) built from greg's 8018b36 HEAD
4. **Container swap** — `docker stop ois-hub-local-prod` (FS-mode; renamed `-fs-backup`) → `docker run -d --name ois-hub-local-prod --security-opt seccomp=unconfined --network w0_default` + STORAGE_BACKEND=substrate + POSTGRES_CONNECTION_STRING=postgres://hub:***@postgres:5432/hub + all other env-vars preserved
5. **Bootstrap-flip success** — Hub logs confirm: `substrate-mode active`, 20 SchemaDefs reconciler-applied, 12 substrate-versioned repositories instantiated, PolicyRouter 71 tools, MCP listening, repo-event-bridge processing GitHub events

**bug-93 STRUCTURAL CLOSURE evidence:**
- FS-mode 22h baseline: ~74% Hub CPU pressure (originating idea-294 symptom)
- substrate-mode current: **0.00% Hub CPU / 162MiB RSS** (sustained — substrate-watch primitive eliminates sweeper poll-loop CPU pressure per Design v1.4 §2.4)
- bug-93 PR #203 30s-throttle band-aid now obsolete (substrate-watch model supersedes; revert candidate post-W7 ship)

**Production-traffic validation (live within minutes of startup):**
- repo-event-bridge processing commits via substrate (create_message in 4-21ms)
- Both architect + engineer register_role + claim_session against new Hub: 1-57ms
- AuditRepositorySubstrate writes confirmed live (`hub/agent_identity_asserted` audits visible in postgres)
- get_pending_actions / drain_pending_actions / claim_session / get_task / list_threads all completing within ms

**DEFECT surfaced → bug-97 (major; race-class; non-blocking):**

`AuditRepositorySubstrate.logEntry: counter issued existing ID audit-1739; refusing to clobber` — 3 instances in first ~60s of substrate-mode uptime.

Root cause: concurrent register_role flows race on Counter.nextAuditId(); both callers receive same N value; both attempt createOnly(audit-N); one wins, **OTHER IS DROPPED (no retry-with-next-counter)**. Substrate's createOnly correctly defends data integrity (no corruption); calling repository drops conflicted write rather than retrying.

**Scope concern:** Counter abstraction shared by 11 kinds (Audit / Thread / Mission / Idea / Task / Bug / Notification / Proposal / Tele / Turn / PendingAction). All may have same defect surface. Under concurrent cold-pickup or load, entity-creation writes could be similarly dropped.

3 fix-shape options proposed in bug-97 description:
- (A) AuditRepositorySubstrate.logEntry retries with next counter-issued ID on createOnly conflict (bounded retries)
- (B) Counter primitive uses postgres advisory lock around increment+issue (atomic next-id)
- (C) Move counter-id-allocation from Counter abstraction to postgres serial/sequence (concurrency-safe by construction)

(C) cleanest architecturally; (A) minimal-scope; (B) substrate-level fix protects all Counter-using repositories. Architect-recommendation: bug-97 fix is W5.5 acceptance criteria — should resolve BEFORE W6 retirement (otherwise FS-version code deletion closes rollback hatch on substrate-with-known-concurrency-defect).

**W5.5 dispatch — thread-573 (active):**

- Cutover-evidence + bug-93 elimination + bug-97 surface communicated to engineer
- Engineer-side: pick up bug-97 fix + smoke matrix per Design v1.4 §4 W5 acceptance criteria
- Surface bug-97 fix-commit + smoke matrix results back on thread-573
- W6 dispatch pre-staged at `docs/missions/m-hub-storage-substrate-w6-dispatch-draft.md` (fires on W5.5 ratify)
- W7 dispatch pre-staged at `docs/missions/m-hub-storage-substrate-w7-dispatch-draft.md` (fires on W6 ratify; includes Phase 7 release-gate)

**Coordination state:**
- Active threads: thread-573 (W5.5 dispatch — engineer turn) + thread-572/571/569 (W5.4-cutover-coord; converged/exhausted) + thread-561 (PR #203 unrelated)
- Greg agent state: online_idle, sessionEpoch=38, restartCount=6, lastSeenAt=05:15:03 UTC (~minutes ago); will pick up thread-573 on next cog-cycle

**Hub-side bugs filed this mission cluster (Phase 10 retrospective material):**
- bug-94 (major): create_task missing assignedEngineerId parameter; thread-content directive workaround active
- bug-95 (major): get_thread pagination caps at 10 messages, no offset parameter; disk-read workaround active (but cutover deleted FS state for messages — postgres-direct-query workaround now canonical)
- bug-96 (major): create_thread_reply antml-prefix-parameter trap; 9+ instances cross-session; discipline-fix demonstrably fails under load
- bug-97 (major): AuditRepositorySubstrate counter-collision under concurrent createOnly writes (W5.4 cutover-surfaced; affects 11 kinds)

**Architect-side substrate-currency-failure cluster — now at 20+ instances (Phase 10 calibration candidate):**

Documented at `feedback_substrate_currency_audit_rubric.md` ARCHITECT-SIDE EXTENSION; 3 confirmed instances upgraded to 20+ over mission course. Architect-side rule: grep-verify before claim. Cost ~5-30s per claim; trivial vs correction-cycle.

**New operational learnings this cutover:**

1. **Docker-seccomp-on-old-kernel:** node:22-slim fails libuv `uv_thread_create` under default docker seccomp profile on Linux 5.8.18; remediation = `--security-opt seccomp=unconfined` at `docker run`. Build-side workaround = host-build + prebuilt-artifact Dockerfile (bypass in-container npm install). Cloud Build path (build-hub.sh) avoids local kernel issue but adds 5-10min + gcloud auth dependency.

2. **Counter-collision substrate-defect class:** Counter abstraction's increment-then-issue isn't atomic across concurrent callers. createOnly defends data integrity but calling-repository drops conflicted write. Pattern affects all Counter-using repositories (11 kinds). Mission-83 bug-97; broader architectural pattern.

3. **Post-cutover authoritative-state inspection via psql:** Hub state now lives in postgres `entities` table; `local-state/threads/*` etc. is frozen pre-cutover snapshot. Replace disk-grep diagnostic patterns with `docker exec hub-substrate-postgres psql -U hub -d hub -c "SELECT ... FROM entities WHERE kind='X'"`. This becomes the canonical operator-DX pattern for substrate-mode Hub.

4. **Cutover orchestration empirical timeline:** Pre-cutover snapshot (~30s) + Hub-stop (~5s) + migration (~3s) + Hub-image-rebuild (~5min on this kernel due to host-build path; ~5-10min via Cloud Build) + Hub-restart + bootstrap-validate (~10s). **Effective downtime ~10min including image-rebuild;** could be reduced to <60s target per Design §3.5 if image is pre-built (e.g., engineer ships pre-built image as part of W5 deliverables; cutover then = stop + run + verify only).

---

### 2026-05-17 15:48 AEST — W5.5 RATIFIED; W6-narrowed RATIFIED; W7 SHIPPED; bug-93 STRUCTURAL CLOSURE recorded; Phase 7 release-gate surfaced

**W5.5 progression (thread-573 rounds 3-5):**
- bug-97 fix deployed to running Hub (image rebuilt from greg's `7870d74`; container swap with new image; old image preserved as `ois-hub:local-substrate-pre-bug97`)
- ZERO `counter issued existing ID` errors post-deploy under repeated cold-pickup contention (was 3 in pre-fix 60s window)
- CPU profile: sustained 0% idle + value-producing bursts only (30s repo-event-bridge poll cycle processing actual commits)
- W5.5 RATIFIED with all Design v1.4 §4 acceptance criteria green (except <60s downtime gate — image-rebuild logistics issue, NOT substrate-architecture; mitigation documented for W7 runbook)

**W6 scope-overrun + rescope (thread-573 rounds 6-7):**
- Engineer-side W6 strict-spec deletion attempted; broke 171 tests via `hub/test/*` → `hub/src/policy/test-utils.ts` → 12 FS-version-repository dependency chain
- Engineer-side surface-discipline excellent (applied `feedback_verification_defect_surface_dont_dig.md`: reverted clean, presented 4 disposition options + engineer-lean)
- **Cluster-22 entry filed:** engineer-side cross-directory-grep miss (audit only `hub/src/`; missed `hub/test/`)
- **Architect-call: option (e) NARROWED W6** = GCS-only deletion + FS-version-repos preserved as test-fixtures + idea-300 follow-on filed
- Rationale: production substrate-only ALREADY gated by W5.4-Hub-bootstrap-flip (FS-version repos function architecturally as test-fixtures + test/dev affordances; not production code-path)

**W6-narrowed ship (thread-573 round 8; commit `6bcdb5d`):**
- -1,445 LoC: `gcs-state.ts` (535) + `gcs-document.ts` (102) + `gcs.ts` package + `document-policy.ts` + `STORAGE_BACKEND=gcs` branch + orphan tests
- 1332 hub tests + 146 repo-event-bridge tests green (no production regression; -3 from deleted gcs-occ-primitives test as expected)
- tsc clean; CODEOWNERS updated for `hub/src/storage-substrate/`
- Document MCP tools (`get_document` / `create_document` / `list_documents`) removed from PolicyRouter (71 → 68 tools post-deploy); idea-300 includes substrate-backed re-introduction

**W7 ship (thread-573 round 9; commit `af922e9`):**
- Engineer-side 5/5: cutover runbook v1.0 + local-dev cookbook v1.0 + psql forensic cookbook (~280 LoC new) + CLI scripts (`get-entities.sh` + `hub-snapshot.sh`) + CLAUDE.md v1.2
- Architect-side W7.4 bug-93 STRUCTURAL CLOSURE: `update_bug` shipped with structural-closure narrative + fixCommits=[ada6d74, 8018b36, 7870d74] + fixRevision=`substrate-mode (mission-83 W5 cutover)` + linkedMissionId=mission-83
- Architect-side deploy: `af922e9` image built + container-swap (current container `ois-hub-local-prod` runs `ois-hub:local-substrate` from `af922e9`; pre-W7 container preserved as `ois-hub-local-prod-pre-w7`)
- Architect-side W7.6 Phase 7 release-gate document: `docs/missions/m-hub-storage-substrate-phase-7-release-gate.md`

**Mission-83 cumulative state:**
- All 7 waves shipped (W0+W1+W2+W3+W4+W5+W6-narrowed+W7)
- 1478 tests green at HEAD (no regressions)
- bug-93 STRUCTURAL CLOSURE confirmed; production-Hub running substrate-mode
- 4 Hub-side bugs filed during mission (bug-94/95/96/97; bug-97 fixed same-cycle)
- 6 follow-on ideas filed (idea-295/296/297/298/299/300)
- 22-instance bilateral substrate-currency-failure cluster (Phase 10 retrospective material)
- 3 backup containers + 4 backup images preserved (rollback affordances)
- Pre-cutover snapshot retained at `/home/apnex/taceng/cutover-snapshots/pre-cutover-20260517T043004Z.tar.gz`

---

### 2026-05-18 — Phase 7 ratify + Phase 8 waiver + Phase 10 retro draft + 3 follow-on Surveys + cross-mission deliverables

**Director engagement summary (this session):** Director ratified mission-83 closure + waived Phase 8 monitoring (substrate stability evidence in-hand) + accelerated Phase 10 retrospective dispatch + scope-shaped 2 follow-on ideas via Survey + introduced novel methodology-validation primitive (Mode-A-vs-Mode-B Delta-analysis on idea-301 Q6).

**Lifecycle moves:**
- **Phase 7 release-gate** ratified by Director (`update_mission(mission-83, status=completed)`); 4 threads tidied (closed thread-569/571/572/561 — superseded by thread-573 convergence + obsolete PR #203 review)
- **Phase 8 monitoring** waived per Director-direct ("no need for monitoring"); substrate stability validated across ~24h+ uptime window (sustained 0% idle CPU; bug-93 ELIMINATED stable)
- **Phase 10 retrospective** DRAFT shipped at `docs/reviews/m-hub-storage-substrate-retrospective.md` (commit `091d720`); 9 sections / 254 lines / 7 architectural wins + 6 process gaps + 7 calibration candidates + 6 follow-on ideas + 5 cross-cutting learnings + 3 Director-engagement moments + 5 Director-bilateral discussion items

**Follow-on shaping (3 missions advanced):**
- **idea-298** (M-Hub-Storage-Cloud-Deploy) — Director multi-turn scope-pin: managed-services-NO → CR+PD-or-GCE+PD container-postgres → portable backup/restore scripts required → "Ship now" pre-ship directive. Iterated through 3 idea-text rewrites; final form lock at v1.2 with sizing descope M-L → M. Awaits Phase 3 Survey
- **idea-300** (M-Hub-Storage-FS-Retirement) — Phase 3 Survey COMPLETE (commit `e2afc92`); 6 Director picks (Q1ac + Q2c + Q3a + Q4a + Q5b + Q6d); validator PASS per §15 schema. Surfaced **substrate-currency-failure cluster #23** as Survey side-effect (repo-event-bridge ephemeral-persistence in substrate-mode; Q4a migration architecturally closes). Mission-class `pre-substrate-cleanup`; 8-wave decomposition sketched; 4 architect-flags batched for Phase 4 (1 CRITICAL: F1 repo-event-bridge cluster #23 closure)
- **idea-301** (M-Trait-Substrate) — NEW idea filed + Phase 3 Survey COMPLETE (commit `6d5bc62`); 6 Director picks (Q1cab + Q2b + Q3b + Q4b + Q5c+d contradictory-constraint + Q6d + Director-extension). Mission-class `substrate-introduction`; 5-wave decomposition sketched; 5 architect-flags (2 CRITICAL). **Standout: Director-extension on Q6** — Mode-A-vs-Mode-B interpretation Delta-analysis methodology-validation primitive; generalizes beyond Trait substrate to ANY architectural-extension validation; positive-pattern calibration candidate

**Cross-mission architectural deliverables:**
- **hub-backup + hub-restore portable scripts** shipped at `scripts/local/hub-backup.sh` + `scripts/local/hub-restore.sh` (commit `45b4967`; symlinked at `~/bin/`). Pre-ships idea-298's portability requirement (~40 LoC of forward-prep) → idea-298 sizing dropped M-L → M; gives local-dev hardening of portable interface before cloud-cutover stress. Dual-mode dispatch via `HUB_PG_CONNECTION_STRING` env (portable, works against local-docker / CR+PD / GCE+PD identically) + `HUB_USE_DOCKER_EXEC` (legacy local-dev fallback). pg client tool resolution: host pg_dump if available → ephemeral docker postgres:15-alpine fallback (no install required). Target shapes supported: local file + `gs://...` (gsutil pipe)
- **3 Director-trait memories filed** as foundational Trait-substrate bootstrap content: `feedback_director_strategic_maximalism_discipline_defended` + `feedback_director_clarifying_question_as_audit_surface` + `feedback_director_mission_close_as_forward_architecture`. Triangulated from mission-83 observations + idea-300/301 Survey observations; ready to seed as trait-001/002/003 at idea-301 mission-W0

**Operational maintenance:**
- **Disk cleanup completed** — `/` partition 100% used (564M free) → 39% used (40G free); 9.2GB total reclaim. Tier 1: docker dangling-image prune (3.5GB). Tier 2+3: substrate-rollback chain trim (1.1GB) + other-project images (~3GB). Tier 4: `/var/cache/PackageKit/{31,32,33}` wipe (~32GB stale Fedora cache). Docker substrate stack untouched (production Hub + postgres running)

**Operational state (production):**
- **Production Hub** running `ois-hub:local-substrate` image (W7 ship; commit `af922e9`); container `ois-hub-local-prod` uptime ~12h+ stable; CPU sustained 0% idle (bug-93 ELIMINATED holds)
- **Postgres substrate** `hub-substrate-postgres` (postgres:15-alpine; vanilla upstream image; only customization is `command:` flags); `hub-substrate-data` volume preserved (15,931 entities)
- **Rollback chain** preserved: `ois-hub-local-prod-fs-backup` (FS-mode container; stopped) + `ois-hub:local-substrate` image (current) + `ois-hub:local-backup` (FS-mode image) + pre-cutover snapshot at `/home/apnex/taceng/cutover-snapshots/pre-cutover-20260517T043004Z.tar.gz`
- **Active threads:** zero mission-83 threads (all tidied); thread-554 (mission-79 slice (i); separate mission; engineer-turn; stale since 2026-05-14)
- **Greg engineer** online_idle; sessionEpoch=41; standing-by for Director-direct or new mission Phase 6 Preflight

**Memory updates (durable across session-handover):**
- Index entries added to MEMORY.md for 3 Director-trait memories
- `project_mission_83_state.md` refreshed to reflect Phase 7 closed + follow-on landscape (this update)

---

## Forward queue (architect-side; current standby state)

**Immediate next-action (awaits Director-direct):**

- [ ] **Phase 4 Design entry for idea-300** OR idea-301 OR Survey for idea-298 first — Director sequences
  - Architect-recommendation: idea-300 first (Q3a strict-sequencing locked; idea-300 → idea-298 dependency)
  - Setup before Design v0.1 drafting: create branch `agent-lily/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate` + work-trace per per-mission-work-trace-obligation
  - Engineer-greg notification can be informal at Phase 4; formal at Phase 6 Preflight

**Standing-deferred items:**

- [ ] Phase 10 retrospective Director-bilateral — calibration filings via `docs/calibrations.yaml` per CLAUDE.md ledger discipline (architect-Director-bilateral, never LLM-autonomous); 7 candidates queued in retro §4
- [ ] PR #203 revert (band-aid obsolete; could fold into idea-300 W7 OR small standalone architect-side mission)
- [ ] PR-to-main merge for mission-83 + Surveys + scripts → CI-status verification at merge time per calibration #77
- [ ] Hub-snapshot.sh vs hub-backup.sh operator-DX reconciliation — operator-DX cleanup follow-on
- [ ] idea-298 Phase 3 Survey when sequenced (post idea-300 ship per locked-sequence)
- [ ] idea-295/296/297/299 Strategic Review triage when prioritized
- [ ] mission-79 thread-554 re-engagement OR close-as-stale (separate mission; engineer-turn)
