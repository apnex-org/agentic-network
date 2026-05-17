# mission-83 (M-Hub-Storage-Substrate) — Phase 7 Release-Gate

**Authored:** 2026-05-17 / lily (architect; agent-40903c59)
**Surfaced to Director for:** `update_mission(missionId="mission-83", status="completed")` per RACI
**Branch:** `agent-greg/m-hub-storage-substrate` HEAD `af922e9`
**Production state:** Hub running `ois-hub:local-substrate` image (built from `af922e9`); substrate-mode LIVE since 2026-05-17 ~05:14 UTC

---

## Mission outcome — PRIMARY OBJECTIVES HIT

### bug-93 STRUCTURAL CLOSURE ✅

Originating concern (idea-294): ScheduledMessageSweeper + MessageProjectionSweeper held ~74% sustained Hub CPU pressure from O(N) FS-walks per tick (9,501 message files / 42MB local-state at peak).

**Architectural change delivered:** O(N) FS-walks → indexed postgres-scans + LISTEN/NOTIFY watch primitive (per Design v1.4 §2.4 + §2.2). Sweeper per-tick cost is now scale-independent (O(log N) or O(index-lookup)).

**Production evidence (sustained ~30+min post-cutover):**
- Pre-cutover (FS-mode, 22h baseline): **~74% sustained Hub CPU**
- Post-cutover (substrate-mode): **0.00% sustained idle CPU**; bursts only during actual work (repo-event-bridge processing GitHub commits)

bug-93 status flipped open → resolved with structural-closure narrative + commits `[ada6d74, 8018b36, 7870d74]` + fixRevision=`substrate-mode (mission-83 W5 cutover)` + linkedMissionId=mission-83.

### Substrate-introduction ✅

Postgres-backed `HubStorageSubstrate` operational:
- 20 SchemaDef-defined entity kinds; reconciler bootstrap pattern (CRD-equivalent)
- CRUD + CAS primitives: `createOnly` + `putIfMatch` + `getWithRevision` (Design v1.4)
- LISTEN/NOTIFY watch primitive
- JSONB body + per-kind expression indexes per Design v1.4 §2.2
- 12 substrate-versioned repositories operational (Agent / Audit / Bug / Idea / Message / Mission / PendingAction / Proposal / Task / Tele / Thread / Turn); Counter substrate-readied at W1.5
- Hard-cut migration: 15,691 entities × 19 kinds in 3.21s wall-clock
- Pre-cutover snapshot retained: `/home/apnex/taceng/cutover-snapshots/pre-cutover-20260517T043004Z.tar.gz` (12MB)
- Rollback containers preserved: `ois-hub-local-prod-fs-backup` (FS-mode) + `ois-hub-local-prod-pre-bug97` + `ois-hub-local-prod-pre-w7`

---

## Wave-by-wave delivery summary

| Wave | Delivery | Key commits |
|---|---|---|
| W0 spike | postgres-substrate + 1.83s synth-migration + entity-kinds.json | `11767c1` |
| W1 substrate-shell | CRUD + CAS + watch + R9 measurement + testcontainers + restart-safety | `e21a9f3` → `f18c8c5` |
| W2 reconciler | 20 SchemaDefs + reconciler + self-bootstrap + 6 new-repo stubs | `d694ba1` + `b1ed0af` |
| W3 sweepers | 4 substrate-versioned sweepers ratified | `28ae8d7` + `2d9555d` |
| W4 + W4.x | 17 slices (11 existing-sibling ports + 6 new-repo full-impl); 14 SchemaDef v2 bumps; getWithRevision substrate-API extension | `234c929` → `ab4fd44` |
| W5.1-3 + plumbing | Migration script production-ized + runbook draft + plumbing tests | `03c6ce2` |
| W5.4-fix | Migration script defects fix (recursive walk + Thread inline-messages + Agent dirSuffix) | `77218cf` |
| W5.4-Hub-bootstrap-flip | STORAGE_BACKEND=substrate dispatch + 12 substrate-repo wiring | `8018b36` |
| W5.5 bug-97 race-fix | SubstrateCounter CAS retry (concurrent allocation correctness) | `7870d74` |
| W6-narrowed | GCS-mode deletion (-1,445 LoC; FS-version repos preserved as test-fixtures) | `6bcdb5d` |
| W7 ship-quality | runbook v1.0 + local-dev cookbook v1.0 + psql forensic cookbook + CLI scripts + CLAUDE.md v1.2 | `af922e9` |

**Tests at HEAD:** 1332 hub + 146 repo-event-bridge = **1478 total green; no regressions across W0-W7**.

---

## Acceptance criteria — Design v1.4 full ratify

| Gate (Design v1.4 §) | Status |
|---|---|
| State-migration script production-class | ✅ `hub/scripts/migrate-fs-to-substrate.ts` |
| Operator runbook v1.0 ship-quality | ✅ `docs/operator/hub-storage-cutover-runbook.md` (W7) |
| Local-dev cookbook v1.0 ship-quality | ✅ `docs/operator/hub-storage-substrate-local-dev.md` (W7) |
| psql forensic cookbook | ✅ `docs/operator/psql-cookbook.md` (W7; ~280 LoC) |
| CLI: get-entities.sh + hub-snapshot.sh | ✅ `scripts/local/get-entities.sh` + `hub-snapshot.sh` (W7) |
| Cutover executed | ✅ (2026-05-17 ~05:14 UTC) |
| Pre-cutover snapshot retained | ✅ |
| Hub running on substrate at HEAD | ✅ (`af922e9` image deployed) |
| bug-93 sweeper-poll-pressure observed-eliminated | ✅ (0% sustained vs 74% baseline) |
| Per-kind sweeper-end-to-end | ✅ |
| Per-kind handler-end-to-end | ✅ (natural-traffic + 1478 unit-tests) |
| Full-API-surface per kind (CAS + watch) | ✅ (73 substrate testcontainers tests + production validation) |
| CLAUDE.md substrate notes | ✅ (W7) |
| CODEOWNERS updated | ✅ (W6-narrowed) |
| Bilateral surface reports | ✅ (per-wave on thread-562 → 566 → 567 → 568 → 569 → 571 → 572 → 573) |
| **bug-93 STRUCTURAL CLOSURE** | ✅ (architect-side update_bug) |

**Carve-outs:**
- **<60s TOTAL OBSERVED DOWNTIME (Design §3.5)** — NOT MET as currently structured (~10min on this host due to in-cutover-window image-rebuild). Mitigation documented in W7 runbook: pre-build image at W5-prep window → cutover-only time = stop+run+verify (<30s achievable). Substrate-architecture is NOT the bottleneck; build/deploy logistics are.
- **W6 STRICT-SPEC NOT MET** — W6 narrowed from "delete all FS-version repos + STORAGE_BACKEND=local-fs branch" to "GCS-mode deletion only; FS-version repos preserved as test-fixtures". Production substrate-only achieved via W5.4-Hub-bootstrap-flip gating; FS-version repos function architecturally as test-fixtures + test/dev affordances. **Full FS-retirement deferred to idea-300** (M-Hub-Storage-FS-Retirement-And-MemoryHubStorageSubstrate) with proper substantial-scope budget for MemoryHubStorageSubstrate impl + test-utils.ts migration + ~170 test-file migration.
- **CI-status:** CI runs only on push-to-main / PR-to-main per `.github/workflows/test.yml`; no CI signal available on feature-branch commits during mission execution. Binding signal: local 1478 tests green. **PR-to-main CI signal will be available at merge-to-main time** (architect-side follow-on after Director ratify; required per calibration #77).

---

## Phase 10 retrospective material — accumulated

### 22-instance bilateral substrate-currency-failure cluster

Engineer-side (cluster entries 18, 19, 21, 22):
- 18: entity-kinds.json drift (Agent prefix `engineers/` vs actual `agents/`)
- 19: recursive-walk implicit-FS-layout assumption (W5.4-fix)
- 21: W4 spike-quality SubstrateCounter scope-deferral (bug-97 surfaced at production-load)
- 22: W6.0 audit-incomplete cross-directory grep (missed `hub/test/*` in deletion-audit)

Architect-side (cluster entries 1-17, 20):
- 14 SchemaDef shape-mismatches caught at W4.x audit (Audit + Idea + Mission + Tele + Turn + Thread + Proposal + PendingAction + Bug + Counter etc.)
- 1 getWithRevision API gap (caught at W4 spike-first-slice; Design v1.4 fold-in)
- 1 getWithRevision spec-without-ship-coordination (same-slice race with greg's ship)
- 1 W5.2 NotificationRepository stale-data
- 1 W4.x-implied-bootstrap-flip not-shipped (W5.4-Hub-bootstrap-flip surface)

**Pattern:** architect-side spec-recall drift (16 instances) + engineer-side cross-directory-grep / FS-layout / spike-quality scope-deferral (4 instances) compose into bilateral substrate-currency-failure class. Architect-side rule formalized in `feedback_substrate_currency_audit_rubric.md` ARCHITECT-SIDE EXTENSION (mandatory grep-before-claim). Engineer-side discipline: cross-directory grep for deletion-class changes; CAS-first for shared substrate primitives.

### Hub-side bug cluster filed during mission execution

- **bug-94** (major): create_task missing assignedEngineerId parameter; thread-content directive workaround
- **bug-95** (major): get_thread pagination caps at 10 messages, no offset (postgres-direct-query workaround now canonical)
- **bug-96** (major): create_thread_reply antml-prefix-parameter trap; 9+ instances cross-session
- **bug-97** (major; W5.4-surfaced): AuditRepositorySubstrate counter-collision under concurrent createOnly writes; **fixed same-cycle at `7870d74`** (SubstrateCounter CAS retry; closes for 11-kind defect surface)

### 6 follow-on ideas filed during mission

- **idea-295** M-Hub-Storage-ResourceVersion (k8s-style optimistic concurrency)
- **idea-296** M-Hub-Storage-Audit-History
- **idea-297** M-Hub-Storage-FK-Enforcement
- **idea-298** M-Hub-Storage-Cloud-Deploy
- **idea-299** M-Hub-Storage-BlobBody-Substrate (Proposal/Task body-storage + Document MCP tools re-introduction)
- **idea-300** M-Hub-Storage-FS-Retirement-And-MemoryHubStorageSubstrate (W6 follow-on)

### Calibration candidates (Phase 10 ledger filings)

- **architect-side substrate-currency-verification-failure** (16 instances; sibling to existing #62)
- **counter-collision substrate-defect pattern** (bug-97; documented at `feedback_counter_collision_substrate_defect_pattern`)
- **docker-seccomp-on-old-kernel cutover-operational** (documented at `reference_docker_seccomp_old_kernel`)
- **per-wave-thread + repaste-on-pagination-block coord pattern** (thread-562 → 573 progression demonstrates)
- **W5.4 substrate-currency review-loop** (engineer-side cross-directory grep discipline; cluster-22)
- **mission-scope-narrowing-with-follow-on-framing** (W6 rescope demonstrates clean follow-on framing via idea-300)
- **bilateral-trust-when-engineer-surfaces-scope-overrun** (W6 surface = `feedback_verification_defect_surface_dont_dig` applied correctly + architect-rescope rather than persisting strict-spec)

---

## Coordination state

- **Active thread:** thread-573 (W5.5 + W6 + W7 coord; rounds 9/15; awaits convergence)
- **Engineer-side standby:** ready for Director-engagement at Phase 7 release-gate OR Phase 10 retrospective OR cross-mission engagement (idea-300 / other-mission)
- **Architect-side standby:** ready to drive Phase 10 retrospective + idea-300 → idea-295/296/297/298/299 prioritization

---

## Director RACI

**Director decision required:**
- `update_mission(missionId="mission-83", status="completed")` ratifies mission-83 substantive completion
- Phase 8 (post-ship monitoring) + Phase 9 (in-flight refinements) + Phase 10 (retrospective) follow Director ratify

**Architect-side awaiting Director ratify** before:
- Phase 10 retrospective dispatch
- idea-300 → Survey prioritization
- PR-to-main merge + CI-status verification (calibration #77)

---

## Operational handoff inventory

- **Production Hub:** `ois-hub-local-prod` (image `ois-hub:local-substrate` built from `af922e9`) — bind-mount + bridge network via w0_default; postgres at `hub-substrate-postgres` (network alias `postgres`)
- **Rollback affordances:** 3 backup containers + 4 backup images preserved; full rollback to FS-mode possible via `docker start ois-hub-local-prod-fs-backup` after stopping current
- **Pre-cutover snapshot:** `/home/apnex/taceng/cutover-snapshots/pre-cutover-20260517T043004Z.tar.gz` (12MB; tar.gz of local-state/)
- **Operator runbook:** `docs/operator/hub-storage-cutover-runbook.md` (v1.0; W7)
- **Local-dev cookbook:** `docs/operator/hub-storage-substrate-local-dev.md` (v1.0; W7)
- **psql forensic cookbook:** `docs/operator/psql-cookbook.md` (W7; new file)
- **Daily-driver CLI:** `scripts/local/get-entities.sh` (W7; new)
- **Snapshot/restore CLI:** `scripts/local/hub-snapshot.sh` (W7; new)
- **CLAUDE.md substrate notes:** v1.2 (W7; includes follow-on idea references)

---

— Lily (architect; agent-40903c59) | mission-83 (M-Hub-Storage-Substrate) Phase 7 release-gate surface
