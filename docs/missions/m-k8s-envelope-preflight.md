# mission-88 Preflight Check

**Mission:** M-K8s-Envelope (mission-88)
**Brief:** `mission-88.description` (in-Hub; per bug-31 mitigation canonical — see A1 note)
**Source Idea:** idea-126 (status: `incorporated` 2026-05-24)
**Source Thread:** thread-635 (4-round bilateral; engineer-ratified v0.2 wave plan; converged R5)
**Source Action:** action-1 (propose_mission cascade)
**Preflight author:** lily (agent-40903c59)
**Date:** 2026-05-24
**Verdict:** **YELLOW**
**Freshness:** current (until 2026-06-23)

---

## Category A — Documentation integrity

- **A1.** Brief file at `mission.documentRef`: **PASS-with-caveat** — `mission-88.documentRef` is `null`. Per bug-31 mitigation (canonical until idea-192 lands per `multi-agent-pr-workflow.md:733`), missions activate WITHOUT separate documentRef; full brief is encoded in `mission.description` as prose. mission-88.description carries the complete v0.2 wave plan (Pre-W0 prerequisite + W0-W6 + per-wave acceptance criteria + Phase 6 hard-dependency notes + 8 goals). Preflight methodology v1.0 pre-dates bug-31 mitigation; this is a documented canonical exception, not a fail.
- **A2.** Local branch in sync with `origin`: **PASS** — preflight authored on `m-k8s-envelope-preflight` branch spawned from `origin/main` HEAD (`71690de`). Brief content lives in Hub (mission-88 entity), not git; no doc-side sync surface to verify.
- **A3.** Cross-referenced artifacts exist:
  - `docs/designs/m-k8s-envelope-cluster-1-substantive-content.md` (commit `d8ea695`): **PASS** ✓
  - `docs/designs/m-k8s-envelope-cluster-2-queue-fsm-active.md` (commit `59c3a70`): **PASS** ✓
  - `docs/designs/m-k8s-envelope-cluster-3-metadata-config-projection.md` (commit `ddf7bb1`): **PASS** ✓
  - `docs/designs/m-k8s-envelope-cluster-4-system-emit-bookkeeping.md` (commit `3b1819a`): **PASS** ✓
  - `docs/designs/m-k8s-envelope-cluster-5-content-archive.md` (commit `71690de`): **PASS** ✓

## Category B — Hub filing integrity

- **B1.** Mission entity correctness:
  - `id`: `mission-88` ✓
  - `status`: `proposed` ✓
  - `documentRef`: `null` (per bug-31 mitigation; see A1 caveat)
  - `missionClass`: `substrate-introduction` ✓
  - `pulses`: configured (architect 1800s + engineer 1800s `short_status`, missedThreshold=2; firstFireDelaySeconds=1800; await activation to fire) ✓
  - `correlationId`: `mission-88` (self) ✓
  - back-link: `sourceThreadId=thread-635` ✓ / `sourceActionId=action-1` ✓ / `sourceThreadSummary` populated ✓
  - **PASS** (documentRef-null per canonical exception noted)
- **B2.** `title` + `description` faithful summary: **PASS** — title `M-K8s-Envelope` matches Survey 1 archive (PR #264) + thread-634 cluster-1 root + thread-635 convergence. Description carries full v0.2 wave plan + 8 goals (Pre-W0 + W0-W6 + per-wave acceptance) per thread-635 R4 staged-action payload.
- **B3.** `tasks[]` + `ideas[]` empty: **PASS** — both `[]` per `list_missions` snapshot 2026-05-24T00:06:19Z. plannedTasks omitted per bug-31 mitigation; architect manually issues each wave-task as prior completes (per `multi-agent-pr-workflow.md` cross-approval pattern).

## Category C — Referenced-artifact currency

- **C1.** File paths cited in brief:
  - All 5 cluster Design doc paths verified at `docs/designs/m-k8s-envelope-cluster-*.md` ✓
  - `hub/src/storage-substrate/migrations/v2-envelope/shared/` — **future allocation** (not yet created; ships at W0 substrate-prep). Not a currency claim; PASS.
  - `docs/operator/psql-cookbook.md` (per A4 operator-DX disposition) — exists ✓
  - `scripts/local/get-entities.sh` (per A4 operator-DX disposition) — exists ✓
  - **PASS**
- **C2.** Numeric claims:
  - "21 substrate-mediated kinds" — verified against `hub/scripts/entity-kinds.json` v1.3 at HEAD: `summary.substrate-mediated-kinds-total-locked: 21` ✓
  - "5-cluster Phase 4 Design partition" — 5 cluster docs + 5 merged PRs (#267, #268, #270, #271, #272) ✓
  - "4 rounds bilateral negotiation" — thread-635 messages count: 4 substantive + R5 convergence-ack ✓
  - **PASS**
- **C3.** Idea/bug/thread citations in assumed state:
  - **idea-126**: status `incorporated` ✓ (post Phase 5 cascade; missionId=mission-88)
  - **thread-635**: sealed at convergence; cascade fired action-1 ✓
  - **thread-634**: closed (cluster-1 negotiation; cited as cadence precedent) ✓
  - **bug-118**: status `open` ✓ (envelope-shape capture in idea-126 scope per cluster-1 §3.1 + §4.2 + cluster-2 §2.1; wire-substrate audit in idea-312 W1 scope)
  - **bug-117**: status `open` ✓ (idea-312 W5 ResponseSummarizer cap; out of mission-88 scope per OQ12)
  - **bug-97**: status `open` ✓ (mission-83 W5.4 Counter-collision; pre-W0 prerequisite per OQ6) — **see E2 unresolved sequencing decision**
  - **PASS** for currency; sequencing-decision deferred to E2/D1
- **C4.** Dependency prerequisites in stated state:
  - mission-83 (HubStorageSubstrate cutover) — production cutover completed 2026-05-17 per `project_mission_83_state.md` memory ✓
  - SchemaDef reconciler infrastructure (cluster-3 §2.3 M4) — operational in production ✓
  - cluster-Design 5-partition foundation — merged + locked at v1.3 entity-kinds.json ✓
  - bug-97 — still open (consistent with OQ6 "separate-and-prior" disposition stating fix should ship before W0)
  - **PASS**

## Category D — Scope-decision gating

- **D1.** Engineer-flagged scope decisions resolved:
  - 13 OQs disposed in thread-635 (R2-R4 negotiation; all sealed at R5 convergence) ✓
  - 5 engineer surfacings A1-A5 disposed (R3 architect dispositions; R4 engineer concur) ✓
  - **TWO PRE-KICKOFF DECISIONS REQUIRED AT PHASE 7 RELEASE-GATE** (see "Pre-kickoff decisions required" below) — these were FLAGGED for Phase 6/7 by thread-635 (not unresolved scope decisions per se; deliberate deferral to Director-engagement gate)
  - **PASS-with-flag** — the 2 pre-kickoff decisions are not scope ambiguity; they are explicit Phase 7 Director-decisions per the bilateral disposition
- **D2.** Director + architect aligned: **PASS** — Director approved Phase 6 directly post-Phase-5-close ("Approved for preflight" 2026-05-24). No mid-brief ambiguity; alignment intact.
- **D3.** Out-of-scope boundaries confirmed:
  - bug-117 OUT of mission-88 (idea-312 W5) ✓
  - bug-118 wire-substrate audit OUT of mission-88 (idea-312 W1; envelope-shape portion IN via cluster-1+2 Design) ✓
  - mission-83 follow-on ideas 295-300 OUT (separate-mission scope) ✓
  - idea-296 / idea-297 / idea-298 (substrate-extension classes filed at mission-83) — independent scopes ✓
  - **PASS**

## Category E — Execution readiness

- **E1.** First task/wave sequence clear:
  - **Pre-W0**: bug-97 Counter-collision fix (separate slice; ships before W0 starts per OQ6 disposition) — engineer scaffold-ready post-Director sequencing decision (E2 below)
  - **W0**: SchemaDef reconciler tolerance mode + shared envelope library at `hub/src/storage-substrate/migrations/v2-envelope/shared/` + migration-cursor primitive + per-kind idempotency contract + acceptance test harness scaffolding
  - Wave-by-wave structure documented in brief; engineer can scaffold W0 day-1 without re-reading brief ✓
  - **PASS-conditional on E2**
- **E2.** Deploy-gate dependencies explicit: **YELLOW** — two unresolved sub-decisions:
  - **(i) Pre-prod substrate-mirror availability** (per thread-635 A3 disposition + OQ10 implication): no pre-prod environment currently mirrors production substrate. Three Director-options at Phase 7:
    - (a) Carve out a staging-env setup slice as Pre-W0 prerequisite (substantial scope expansion; ~1-2 weeks engineer time + GCE-VM cost; matches idea-310 fresh-env GCE-VM Hub runbook scope per handover deferred-list)
    - (b) Risk-accept production-only verification (acceptance gates run against production; rollback via image-tag-pin if regression; matches mission-83 W5.4 cutover-runbook pattern — image-pre-build + <30s effective downtime)
    - (c) Hybrid: local-dev environment with production-state snapshot loaded via `pg_dump` + `pg_restore` (lighter than full staging; medium fidelity; matches `scripts/local/hub-snapshot.sh` capability per `project_director_chat_acp_redesign.md` memory)
  - **(ii) bug-97 pre-W0 sequencing**: bug-97 still open since 2026-05-17 (no fixCommits). Three Director-options at Phase 7:
    - (a) Schedule bug-97 fix as pre-W0 prerequisite slice (engineer claim + ship before mission-88 W0 starts) — clean attribution per OQ6 disposition
    - (b) Risk-accept carry-over (bug-97 fix runs in parallel with mission-88 W0-W3; W3 acceptance gate is late-catch net for mixed-mode failures) — pre-disposed risk-accept at OQ6 architect note
    - (c) Fold bug-97 fix into W3 cluster-3 wave (mixed-concern wave-gate; OQ6 explicitly REJECTED this pre-thread)
  - Hub redeploy gating: single W6 production cutover ✓ (no per-wave production deploys; matches mission-83 W5.4 pattern)
  - **YELLOW** — Director decisions (i) + (ii) required at Phase 7 release-gate (pre-kickoff)
- **E3.** Success-criteria measurable from current baseline:
  - **Per-wave acceptance:** (a) all kinds in wave carry envelope shape — verifiable via SchemaDef strict-mode validation OR direct JSONB query; (b) SchemaDef validation passes — verifiable via reconciler logs; (c) read-after-migrate + write-after-migrate per kind — verifiable via per-kind test suite; (d) wire-flow round-trip — verifiable via end-to-end integration test (substrate-write → bridge → notification → adapter-read); (e) no production-regression (entity-IDs preserved as metadata.name; list-API consumers unbroken) — verifiable via diff-comparison of pre/post-migration entity exports + downstream consumer smoke
  - **Overall mission:** 21 substrate-mediated kinds carry K8s envelope shape uniformly at W6 close (verifiable: entity-kinds.json v1.3 → v2.0 envelope-marker bump + SchemaDef strict-mode flip) + bug-118 envelope-shape closed (verifiable: substrate-wide query `data->'metadata'->>'sourceThreadId' IS NOT NULL` coverage per cluster-1 §3.1)
  - **PASS**

## Category F — Coherence with current priorities

- **F1.** Anti-goals from parent Survey (idea-126 archive PR #264) still hold: **PASS** — Survey was 2026-05-23 (very recent; no anti-goal flip surfaced); 11 anti-goals per Survey archive remain load-bearing (no backwards-compat / no substrate-mediation change / no historical-backfill / 21-kind locked inventory / etc.)
- **F2.** No newer missions superseding/overlapping:
  - idea-315 (M-PR-Synchronize-Handler) — substrate-DX class; not overlapping (event-handler substrate gap; orthogonal to envelope shape)
  - idea-316 (M-Notification-Semantic-Separation) — substrate-extension class; not overlapping (semantic separation question; orthogonal to envelope uniformity)
  - mission-87 (in-flight; mission-83 follow-on; W3 deploy-coupled) — not overlapping (Hub runtime config; orthogonal to entity envelope shape)
  - **PASS**
- **F3.** No recent bugs/ideas materially changing scoping:
  - bug-97, bug-117, bug-118 already incorporated into wave plan + disposition table ✓
  - No bugs filed post-thread-635 convergence (2026-05-24T00:06Z) that materially affect mission-88 scope
  - **PASS**

---

## Verdict summary

**YELLOW** — all categories pass except E2 (deploy-gate dependencies) which surfaces two pre-kickoff Director decisions required at Phase 7 release-gate. Mission brief is faithful, currency-verified, scope-sealed via 4-round bilateral; the YELLOW reflects the bilateral's deliberate deferral of two operational decisions to Director-engagement (per thread-635 A3 disposition + OQ6 architect note). Both decisions are bounded with 3 Director-options each (no scope ambiguity); short Phase 7 kickoff ratifies + flips Mission status `proposed → active`.

**Activation recommendation:** schedule Phase 7 release-gate engagement with Director for the 2 pre-kickoff decisions; on Director ratification, re-verdict to GREEN + `update_mission(status="active")` + pulses begin firing.

---

## Pre-kickoff decisions required (Phase 7 release-gate)

**Decision (i) — Pre-prod substrate-mirror availability** (per thread-635 A3):
- (a) Carve staging-env slice as Pre-W0 prerequisite (substantial scope expansion; composes with idea-310)
- (b) Risk-accept production-only verification (matches mission-83 W5.4 pattern)
- (c) Hybrid: local-dev with production-state snapshot loaded (medium fidelity)
- **Architect-lean:** (b) — mission-83 W5.4 demonstrated viability of the risk-accept pattern with image-tag-pin rollback; staging-env carve-out (a) substantially extends mission timeline without proportional risk reduction; (c) hybrid adds value at low cost but doesn't eliminate need for (b) at W6 cutover

**Decision (ii) — bug-97 pre-W0 sequencing** (per thread-635 OQ6):
- (a) Schedule bug-97 fix as pre-W0 prerequisite slice (engineer ships before mission-88 W0 starts) — clean attribution; matches OQ6 architect+engineer disposition
- (b) Risk-accept carry-over (parallel with W0-W3; W3 acceptance gate is late-catch net)
- (c) Fold bug-97 into W3 cluster-3 wave (REJECTED at OQ6 — mixes two concerns; not a real option, listed for completeness)
- **Architect-lean:** (a) — clean attribution preserves W3 acceptance-gate clarity; bug-97 has been open since 2026-05-17 (7 days at preflight time; OK to slate now); engineer available + bug-97 scope-narrow (single-substrate Counter-fix; ~1-2 day estimate per fix-shape recommendation in bug-97 body)

**Combined recommendation:** (i)(b) + (ii)(a) — risk-accept production verification + bug-97 ships as pre-W0 prerequisite slice. Phase 7 kickoff agenda is 2 Director-ratifications, then `update_mission(status="active")` proceeds.
