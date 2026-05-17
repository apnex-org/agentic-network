# Mission-83 M-Hub-Storage-Substrate — Architect Retrospective

**Status:** Phase 7 Director-ratified 2026-05-18 (`mission-83.status=completed`). Substrate live in production for ~24h+. All Phase 1-7 phases delivered; Phase 8 monitoring waived per Director-direct (substrate stability already validated under sustained traffic).
**Authored:** 2026-05-18 / lily (architect; agent-40903c59).
**Scope of this doc:** architect's reflection on what shipped, what worked, what broke, what to discuss with Director, calibration candidates for ledger filing. Companion to (and not duplicating) the Phase 7 release-gate document at `docs/missions/m-hub-storage-substrate-phase-7-release-gate.md` (which holds wave-by-wave delivery + acceptance criteria + operational handoff inventory).

---

## 1. What shipped (one-paragraph)

The Hub's storage substrate replaced — from a custom FS+GCS+Memory-pluggable layer underneath 12 per-kind repositories, to a single postgres-backed `HubStorageSubstrate` modeled on Kubernetes architecture: one generic `entities` table + JSONB body + per-kind expression indexes + SchemaDef-and-reconciler bootstrap + LISTEN/NOTIFY watch + CAS primitives (createOnly + putIfMatch + getWithRevision). 15,691 entities migrated in 3.21s. Hub CPU dropped from sustained 74% → sustained 0% (bug-93 STRUCTURAL CLOSURE — the originating idea-294 symptom). 7 waves W0-W7 shipped over ~3 days of architect+engineer bilateral coordination. Full wave-by-wave delivery + acceptance criteria evidence at `docs/missions/m-hub-storage-substrate-phase-7-release-gate.md` (commit `70a1f0f`).

---

## 2. What worked (architectural wins)

### 2.1 bug-93 STRUCTURAL CLOSURE proved the architectural-rather-than-symptomatic approach

PR #203 30s tick-throttle (the pre-mission band-aid; commit `ada6d74`) reduced CPU-per-second 30× but preserved O(N) FS-walks per tick. Symptom-relief; would re-pressure as message store grew.

Mission-83 changed the *shape*: O(N) FS-walks → indexed postgres-scans + LISTEN/NOTIFY event-driven model. Per-tick cost is now scale-independent. CPU went from sustained 74% → sustained 0% (with bursts only during actual work like repo-event-bridge processing commits).

This is the cleanest possible argument for substrate-introduction over patch-the-symptom. The mission's primary outcome is dispositively measurable + cannot regress without architectural reversal.

### 2.2 Spike-validation discipline paid off (W0 spike vs production cutover)

W0 (commit `11767c1`) spike-validated: postgres container compose + synthetic-state migration of 10k entities in 1.83s + testcontainers boot-time baseline. Director Q5=d hard-cut Survey pick + Q6=a local-only became defensible because W0 gave architect+engineer empirical-grounded picks rather than spec-projection guesses.

W5 cutover then completed in 3.21s wall-clock against 15,691 real entities — within the 58.17s headroom of the original 60s downtime budget per Design v1.4 §3.5. The W0 spike measured the substrate's behavioral floor; the W5 cutover honored the floor under realistic load.

### 2.3 SubstrateCounter race-fix shipped same-cycle (bug-97)

bug-97 surfaced from REAL production traffic within ~60 seconds of substrate-mode Hub startup. The defect (concurrent counter-allocation races dropping audit writes) was not caught by W4's 73 testcontainers tests — only emerged under cold-pickup contention between architect + engineer simultaneous reconnect.

Engineer-side fixed at commit `7870d74` (Design v1.4 getWithRevision + putIfMatch CAS retry pattern) within ~minutes. Production-deployed; verified ZERO collisions under repeated cold-pickup testing within the same session. **Defect-surface to fix-deployed cycle: ~15 minutes.** That's the substrate-extension-feedback-loop working as intended.

Architectural significance: the chosen fix-shape was *substrate-level* (SubstrateCounter itself uses CAS), not per-repository retry. One fix-site closes the defect for all 11 kinds that share the Counter abstraction. Architecturally cleaner; consistency with W4.x.1-11 CAS pattern preserved.

### 2.4 W6 narrowing — mission-scope discipline under engineer-surfaced overrun

W6 dispatch said "delete 12 FS-version repositories + LocalFsStorageProvider + gcs-state.ts + gcs-document.ts". Engineer attempted strict spec, surfaced ~171 test failures (hub/test/* depends on FS-version repos via test-utils.ts), reverted cleanly, surfaced 4 disposition options with engineer-lean = (d) defer entirely.

Architect-call: option (e) = (c) narrowed-scope + follow-on framing. **Production substrate-only is ALREADY gated** at W5.4-Hub-bootstrap-flip; FS-version repos function architecturally as test-fixtures, not production code-path. Drop the GCS-specific code (-1,445 LoC) + preserve FS-repos as test affordance + file `idea-300` for full FS-retirement + MemoryHubStorageSubstrate test-architecture mission.

W6-narrowed shipped clean (`6bcdb5d`) with 1332 tests still green; idea-300 captures the test-architecture migration as a coherent follow-on rather than a rushed W6 sub-wave.

**What this validated:** the mission-lifecycle methodology can absorb scope-discovery mid-mission without either (a) abandoning the mission or (b) forcing the over-broad spec through. Narrowing-with-follow-on-framing is a load-bearing pattern.

### 2.5 Engineer-side surface-discipline at W6 was exemplary

Per `feedback_verification_defect_surface_dont_dig.md`: when engineer hit the test-failure cliff, they STOPPED iterating, REVERTED clean, and SURFACED 4 disposition options with a stated engineer-lean + rationale. They did not try to dig (e.g., monkey-patch test-utils.ts to avoid the FS-repo dependency, or argue down the spec). They surfaced for architect-judgment.

This made the rescope FAST — architect synthesized + dispatched option (e) within minutes. Engineer executed the narrowed scope without ego-friction over the partial-revert. **Bilateral-trust earned-and-spent correctly.**

### 2.6 Cloud-deploy pre-readiness shipped early (portable backup/restore scripts)

Director surfaced 2026-05-17 that idea-298 should target container-postgres-on-CR-or-GCE (NOT managed Cloud SQL) + scripts must be portable across deployment targets. Architect surfaced "pre-ship the script-portability refactor now vs defer to idea-298 execution?" + Director directed "Ship now."

Scripts shipped at commit `45b4967`: dual-mode dispatch via `HUB_PG_CONNECTION_STRING` env (portable) + `HUB_USE_DOCKER_EXEC` (legacy local-dev). Works against local-docker / CR+PD / GCE+PD identically. Pre-shipping de-risks idea-298 by giving months of local-dev hardening time on the portable interface before cloud-cutover stress.

This is the right pattern: when Director surfaces a requirement that's ~40 LoC of forward-prep, ship it pre-emptively rather than queue it.

### 2.7 Operator-DX surface delivery at W7 (psql cookbook + CLI scripts)

`docs/operator/psql-cookbook.md` (~280 LoC) + `scripts/local/get-entities.sh` (daily-driver CLI) + `scripts/local/hub-snapshot.sh` (snapshot/restore) + `docs/operator/hub-storage-cutover-runbook.md` (v1.0) cover the operational substrate-mode workflow. State-inspection patterns moved from "grep local-state/" to "docker exec postgres psql + named query templates."

W7 also folded in the W5.4 actual-cutover learnings (image-pre-build pattern for <60s effective downtime + docker-seccomp-workaround for kernels-with-default-seccomp-issues) — the runbook is grounded in real cutover experience, not Design-phase projection.

---

## 3. What broke (process + workflow failures)

### 3.1 22-instance bilateral substrate-currency-failure cluster (THE big calibration outcome)

The dominant Phase 10 calibration material from this mission. Pattern: **spec-recall drifts vs ground-truth code+state; bilateral cycles spent on currency-corrections.**

**Architect-side (16 instances):**
- 14 SchemaDef shape-mismatches caught at W4.x audit (Audit + Idea + Mission + Tele + Turn + Thread + Proposal + PendingAction + Bug + Counter etc.) — architect's broader spec-scope makes spec-recall-vs-code-grep gap larger than engineer's
- 1 getWithRevision API gap (caught at W4 spike-first-slice; Design v1.4 fold-in)
- 1 getWithRevision spec-without-ship-coordination (architect spec'd new API in same slice greg was already shipping)
- 1 W5.2 NotificationRepository stale-data (architect added DirectorNotification to inventory based on filesystem inspection; engineer code-verified mission-56 W5 had retired it; architect conflated file-presence with active-write-path)
- 1 W4.x-implied-bootstrap-flip not-shipped (W5.4-Hub-bootstrap-flip surface — architect missed that the W4 repo-instantiation work didn't include the STORAGE_BACKEND=substrate dispatch branch)

**Engineer-side (6 instances):**
- 18: entity-kinds.json drift (Agent prefix `engineers/` vs actual `agents/`)
- 19: recursive-walk implicit-FS-layout assumption (W5.4-fix; migration script bug)
- 21: W4 spike-quality SubstrateCounter scope-deferral (bug-97 at production-load)
- 22: W6.0 audit-incomplete cross-directory grep (missed `hub/test/*` in deletion-audit)

The 16+6 pattern is dispositive evidence that **substrate-extension missions need bilateral grep-before-claim discipline as a first-class rubric**, not just an architect-side or engineer-side discipline. `feedback_substrate_currency_audit_rubric.md` formalized the architect-side rule (grep committed spec OR code BEFORE claiming a fact). Engineer-side discipline (cross-directory grep for deletion-class changes; CAS-first for shared substrate primitives) emerged this mission.

Calibration: `substrate-currency-verification-failure` is a real calibration class deserving #62-class ledger entry. Sibling pattern to existing #62 (`deferred-runtime-gate-becomes-silent-defect-surface`).

### 3.2 Hub-side bug cluster filed during routine coordination

Four major-class bugs filed against the Hub itself during mission-83 routine coord:
- **bug-94:** `create_task` MCP tool surface lacks `assignedEngineerId` parameter; workaround = thread-content directive
- **bug-95:** `get_thread` pagination caps at 10 messages, no offset parameter; workaround = postgres-direct-query (now canonical post-substrate-cutover)
- **bug-96:** `create_thread_reply` antml-prefix-parameter trap; 9+ instances cross-session; discipline-fix demonstrably fails under load
- **bug-97:** AuditRepositorySubstrate counter-collision under concurrent createOnly writes (W5.4-surfaced; **fixed same-cycle at `7870d74`**)

Of these, only bug-97 was direct-substrate-defect (and was fixed). The other three are pre-existing Hub-side rough edges that became visible because mission-83 stressed the coord surface (high thread-spawn rate + many tool invocations + cross-session continuity). They're now filed for engineer-team backlog prioritization.

### 3.3 W5.4 cutover downtime missed the <60s Design §3.5 budget

Cutover wall-clock: ~10 minutes effective (image-rebuild on host = ~5 minutes due to docker-seccomp workaround + container swap + bootstrap-validate).

**Root cause:** in-cutover-window image-rebuild was forced because cutover happened on the laptop where image had to be built locally. The Design §3.5 budget assumed image was pre-built. Mitigation documented in W7 runbook: pre-build image at W5-prep window → cutover-only time = stop+run+verify (<30s achievable).

This is NOT a substrate-architecture issue (substrate cutover itself ran in 3.21s well within budget). It's a build/deploy logistics gap. Cloud-deploy mission (idea-298) will inherit the pre-build pattern naturally (image pushed to registry; cutover pulls).

### 3.4 Docker-seccomp-on-old-kernel operational gap (surfaced + worked around)

Linux kernel 5.8.18-100.fc31 + docker default seccomp profile causes node:22 (and node:20) to abort at libuv `uv_thread_create` on startup. Workaround: `--security-opt seccomp=unconfined` at `docker run` time. Build-side: in-container `npm install` hits same wall; pivoted to host-build + prebuilt-artifact Dockerfile pattern.

This was a one-off discovery during mission-83 cutover-execution but the workarounds + diagnostic captured at `reference_docker_seccomp_old_kernel.md` (memory) + folded into W7 operator runbook. Worth noting because: **operator-environment gaps surface during cutover-execution, not Design-phase**. The cutover-runbook should explicitly call out the host-environment prerequisites.

### 3.5 W5.4 thread-572 round-cap forced thread-spawn cascade

Coordination thread evolution this mission: thread-562 → 566 → 567 → 569 → 571 → 572 → 573. Each thread-spawn happened on round-cap (max 10 or 15 rounds depending on thread-config). Six round-caps in 3 days = high coord surface.

Per `bug-95` (get_thread 10-message pagination cap), the thread-spawn cascade was amplified by inability to disk-read past the first 10 messages of any thread (forced architect to spawn fresh threads when continuing context exceeded 10 messages).

**Calibration:** per-wave-thread + repaste-on-pagination-block coord pattern is now codified. For substrate-introduction missions with high coord-density, expect 1-2 thread-spawns per wave + plan repaste/state-carry-forward as default not exception.

### 3.6 Document MCP tools deleted as W6-narrowed side-effect (deferred to idea-299)

`document-policy.ts` had `gcs-document.ts` as sole consumer; W6.1 deletion of gcs-document.ts orphaned document-policy.ts → architect-call to delete document-policy.ts too. Side-effect: PolicyRouter tool-count went 71 → 68 (`get_document` + `create_document` + `list_documents` removed).

Engineer flagged this at W6 ship surface; architect filed `idea-299` (M-Hub-Storage-BlobBody-Substrate) to restore document MCP tools via substrate-backed DocumentRepository. The deletion was scope-correct (GCS-bound document storage is dead post-cutover) but architect should have explicitly carved-out the document-MCP-tools-retirement decision rather than letting it cascade from gcs-document.ts deletion.

**Calibration:** deletion-cascade audit must explicitly call out user-facing MCP tool surface changes (PolicyRouter tool removals) as architect-visible items, not bury them in the "removed dead code" line-item.

---

## 4. Calibration candidates for Director-bilateral filing

Per CLAUDE.md: calibration filings + ID assignments are architect-Director-bilateral, never LLM-autonomous. The following 7 candidates emerged from this mission; each warrants Director bilateral review for filing decision:

| # | Candidate | Severity | Pattern shape |
|---|---|---|---|
| 1 | **architect-side substrate-currency-verification-failure** (16 instances; sibling to existing #62) | major | architect-spec-recall drifts vs ground-truth committed-state; bilateral cycles wasted on correction; cost ~5-30s per claim if architect grep-verifies first vs many-minute correction-cycles otherwise. Architect-side rule formalized at `feedback_substrate_currency_audit_rubric.md` ARCHITECT-SIDE EXTENSION. |
| 2 | **counter-collision substrate-defect pattern** (bug-97 class) | major | Substrate Counter abstraction's issue-then-createOnly isn't atomic across concurrent callers; createOnly defends data integrity but calling-repository drops conflicted write. Affects all 11 Counter-using kinds. Documented at `feedback_counter_collision_substrate_defect_pattern.md`. |
| 3 | **docker-seccomp-on-old-kernel cutover-operational** | minor | node:22-slim aborts under default docker seccomp on Linux 5.8.x; remediation via `--security-opt seccomp=unconfined` + host-build prebuilt-Dockerfile pattern. Documented at `reference_docker_seccomp_old_kernel.md`. |
| 4 | **per-wave-thread + repaste-on-pagination-block coord pattern** | minor | Substrate-introduction missions with high coord-density expect 1-2 thread-spawns per wave; bug-95 pagination cap compounds; plan state-carry-forward as default. |
| 5 | **mission-scope-narrowing-with-follow-on-framing** | minor (positive pattern) | W6 rescope exemplar: scope-overrun surfaced + scope-narrowed + follow-on-mission-filed; preserves primary outcomes + cleanly defers test-architecture work; bilateral-trust honored without ego-friction. |
| 6 | **bilateral-trust-when-engineer-surfaces-scope-overrun** | minor (positive pattern) | Engineer surface-discipline at W6 was load-bearing for fast rescope; architect synthesized + dispatched without re-litigating engineer's revert call. `feedback_verification_defect_surface_dont_dig.md` applied correctly + amplified by architect-side adoption. |
| 7 | **deletion-cascade audit must explicitly surface MCP tool-surface changes** | minor | W6-narrowed document-policy.ts deletion silently removed 3 user-facing MCP tools; should have been architect-visible item, not buried in "removed dead code". |

Calibrations #1 + #2 are the architecturally-most-significant. Candidates #5 + #6 are positive-pattern calibrations worth ledger-filing (formal "do more of this" entries).

---

## 5. Follow-on missions filed (6 ideas)

| Idea | Title | Origin | Status |
|---|---|---|---|
| **idea-295** | M-Hub-Storage-ResourceVersion | F4 PROBE pre-mission | open |
| **idea-296** | M-Hub-Storage-Audit-History | F4 PROBE pre-mission | open |
| **idea-297** | M-Hub-Storage-FK-Enforcement | F4 PROBE pre-mission | open |
| **idea-298** | M-Hub-Storage-Cloud-Deploy | Survey Q6=a carve-out; SCOPE-PINNED 2026-05-17 (container-postgres on Cloud Run+PD OR GCE+PD; scripts pre-shipped at `45b4967`) | open |
| **idea-299** | M-Hub-Storage-BlobBody-Substrate (Proposal/Task body-storage + Document MCP tool re-introduction) | W6 deletion-cascade fold-in | open |
| **idea-300** | M-Hub-Storage-FS-Retirement-And-MemoryHubStorageSubstrate | W6 scope-narrowing follow-on (Director-direct architectural decision) | open |

Director-side prioritization at next Strategic Review will sequence these. **Architect-recommendation:**
- **idea-300** first (closes mission-83's W6 deferred scope; reduces dual-pattern code-debt; smaller scope)
- **idea-298** second (cloud-deploy; portable scripts already-pre-shipped reduces risk)
- **idea-295/296/297** later (substrate-architecture extensions; can wait until cloud-deploy stable)
- **idea-299** ad-hoc (small; could be picked up between bigger missions)

---

## 6. Cross-cutting learnings

### 6.1 Spike → Design → Mission methodology vindicated for substrate-class work

The W0 spike (commit `11767c1`) was a small upfront cost (~hours) that paid off enormously at Design-ladder authoring + W5 cutover-time. The 1.83s synthetic-migration measurement directly grounded Design §3.5 60s downtime budget. The W0-entity-kinds.json enumeration drove W2 SchemaDef inventory.

For future substrate-class missions: budget for W0-spike-and-measure as load-bearing, not optional.

### 6.2 Director's Q1=abcd (all-4-tele primary) + Q2=d (max scope) Survey picks set the right ambition

Director ratified maximum-scope substrate-introduction (vs incremental). At wave-execution time this paid off: W4's repository internal-composition refactor + W2's reconciler + W3's sweeper-substrate-adoption all reinforce each other. Smaller scopes would have left architectural gaps that would have required another mission to close.

The cost was 7-wave mission length + 22-instance substrate-currency-failure cluster — both manageable.

### 6.3 Architectural integrity check: substrate-only at production-runtime, FS-version code lives as test-fixtures

W6-narrowed disposition: production substrate-only is gated at W5.4-Hub-bootstrap-flip; FS-version-repos preserved in source tree as test-fixtures + test/dev affordances. This is a clean architectural posture — operator NEVER selects FS-mode at production-prod; engineer can use STORAGE_BACKEND=local-fs for laptop-dev-without-postgres-spinup.

**The architectural integrity is at the BOOTSTRAP-FLIP not at the DELETION boundary.** This is correct + worth codifying in architect-discipline.

### 6.4 Same-cycle bug-fix-and-deploy is sustainable when substrate-layer-correctness is at stake

bug-97 went from production-defect-observation to production-deployed-fix in ~15 minutes (engineer fix + architect deploy). The container-swap mechanic (rename old → run new) made the deploy itself low-friction.

For substrate-extension missions, this is the right pace — long deploy-cycles would amplify substrate-defect-impact. The architectural prerequisite: pre-built deploy image + scriptable container-swap.

### 6.5 Pre-shipping forward-prep when Director surfaces a requirement is high-leverage

The portable backup/restore script refactor (commit `45b4967`) was triggered by Director's "Ship now" directional. ~40 LoC ship-cost; eliminated a Design-phase deliverable from idea-298; gives months of local-dev hardening time on the portable interface before cloud-cutover.

When Director surfaces ~40 LoC of forward-prep that's already locally-validatable, ship it pre-emptively.

---

## 7. Notable Director-engagement moments

The mission had 3 substantive Director engagement points beyond the lifecycle-formal Phase 3 + Phase 7:

### 7.1 Director "Approved to proceed full rebuild" at W5.4 cutover-trigger

Architect surfaced 4-option Hub-restart fork (different restart strategies); Director chose Option 1 (architect attempts rebuild + container-restart). This was the dispositive go-signal for substrate-cutover. Without explicit Director "Authorised. Proceed" the architect would have remained in standby — substrate-cutover is high-impact + needs explicit Director-direct authorization.

### 7.2 Director scope-pin on idea-298 (cloud-deploy)

Multi-turn shaping: "ensure 298 covers postgres in Cloud Run rather than native services" → "target will either be CR with PD or GCE with PD option; postgres is a container in either case; backup/import/export needs to be portable target postgres" → "Ship now" (script generalization).

This pinned idea-298 scope tightly + removed managed-service path from consideration + drove the pre-ship of portable scripts. **Director used follow-on-idea-shaping as a forward-architecture-design surface during mission close.** That's a high-value engagement pattern worth recognizing.

### 7.3 Director "no need for monitoring; let's draft retro" at mission close

Director compressed Phase 8 (post-ship monitoring) by judgment-call (substrate stability already validated under sustained traffic) + accelerated Phase 10 retrospective dispatch. This is appropriate compression — Phase 8 monitoring is methodology-default but skippable when stability evidence is already in-hand.

**Calibration:** Phase 8 monitoring is rebooted as conditional-on-stability-evidence rather than always-on. Mission-83 sets the precedent.

---

## 8. What to discuss with Director (next bilateral)

Per CLAUDE.md mission RACI: Director engages at gate-points. Phase 10 retrospective is the next-gate. Suggested discussion items:

1. **Calibration candidate #1 + #2** (architect-side substrate-currency-verification-failure + counter-collision substrate-defect) — ledger filing decisions; ID assignment
2. **Follow-on idea prioritization** — sequence for idea-295/296/297/298/299/300; architect-recommendation captured in §5; Director ratifies
3. **Phase 8 monitoring policy** — was waiving correct? Should methodology codify "Phase 8 conditional-on-stability-evidence" as default for substrate-extension missions?
4. **PR #203 revert** (architect-side cleanup) — bug-93 STRUCTURAL CLOSURE makes the 30s tick-throttle band-aid obsolete; revert candidate. Small architect-side mission OR fold into idea-300?
5. **Compressed-lifecycle pattern** — Director compressed Phase 8; mission-83 also had compressed Phase 6 (preflight verdict GREEN single-pass); is the pattern "for substrate-extension missions, compressed-lifecycle is default-permitted when evidence supports it"?

---

## 9. Operational state at close (reference, not duplication)

Full operational handoff inventory at `docs/missions/m-hub-storage-substrate-phase-7-release-gate.md` §"Operational handoff inventory". Headline items:

- **Production Hub:** `ois-hub-local-prod` running `ois-hub:local-substrate` (built from `af922e9`); substrate-mode authoritative since 2026-05-17 ~05:14 UTC
- **Postgres:** `hub-substrate-postgres` container (postgres:15-alpine); `hub-substrate-data` named volume
- **Rollback chain:** FS-mode container `ois-hub-local-prod-fs-backup` preserved + `ois-hub:local`+`local-backup` images; pre-cutover snapshot at `/home/apnex/taceng/cutover-snapshots/pre-cutover-20260517T043004Z.tar.gz`
- **Operator-DX:** `hub-backup` + `hub-restore` portable scripts (symlinked in `~/bin/`); `get-entities.sh` daily-driver; `psql-cookbook.md` for forensic queries; `hub-storage-cutover-runbook.md` v1.0
- **CI status:** Local 1478 tests green at HEAD; CI signal pending PR-to-main merge (calibration #77; architect-side follow-on after Director ratify)
- **Branches:** `agent-greg/m-hub-storage-substrate` (engineer; HEAD `af922e9`) + `agent-lily/m-hub-storage-substrate` (architect; HEAD `45b4967`) — neither merged to main yet

---

— Lily (architect; agent-40903c59) | mission-83 (M-Hub-Storage-Substrate) closing reflection
