---
mission: M-Hub-Storage-FS-Retirement-And-MemoryHubStorageSubstrate
source-idea: idea-300
mission-class: pre-substrate-cleanup
branch: agent-lily/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate
phase: 4-design
phase-entered-at: 2026-05-18 12:08 AEST
phase-entered-via: Director-direct "Enter Phase 4 on idea-300" 2026-05-18
survey-envelope: docs/surveys/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate-survey.md
prior-mission-anchor: mission-83 (M-Hub-Storage-Substrate; completed 2026-05-18)
sequencing-downstream: idea-298 (M-Hub-Storage-Cloud-Deploy; strict prerequisite locked via Q3a)
---

# M-Hub-Storage-FS-Retirement-And-MemoryHubStorageSubstrate — work-trace

Architect-side trace per `docs/methodology/engineer-runtime.md` work-trace discipline (architect carries equivalent obligation per [[per_mission_work_trace_obligation]] memory).

## Session-log

### 2026-05-18 12:08 AEST — Phase 4 entered (Director-direct)

**Trigger:** Director-direct one-message disposition "Enter Phase 4 on idea-300" post architect-recommendation surface (single-next-action analysis: idea-300 = sequencing-bottleneck unblocking idea-298 chain; bilateral architect↔Director active engagement window; greg-bandwidth idle; calibration-filing Phase 10 retro can wait without degrading).

**Survey envelope absorbed:**
- 5-pillar composite intent (Survey §3): substrate-only-everywhere + repo-event-bridge full migration + Standard conformance suite + discipline-not-mechanism enforcement + strict-sequencing-before-idea-298
- 4 architect-flags F1-F4 — all mechanism-level per #69 v2 / #73 directional-vs-mechanism rubric (no operator-DX / runtime / artifact / system-identity directional change) → autonomous architect-execution path; no mid-Design Director-consult expected
- Cluster #23 substrate-currency-failure surfaced as Survey side-effect (repo-event-bridge ephemeral-persistence in substrate-mode-production; W3 migration closes structurally)

**Phase 4 bootstrap actions:**
1. ✅ Mission branch created (`agent-lily/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate` off `origin/main` HEAD `c00944b8`)
2. ✅ Work-trace initialized (this file)
3. ⏳ Design v0.1 draft (next; autonomous architect-side work)
4. ⏳ Bilateral audit-thread to greg (engineer round-1 content-level audit; post Design v0.1 push)
5. ⏳ Audit converge → Design v1.0 ratify (architect↔engineer iteration; surface to Director at ratify)

**Director surface cadence:** next surface = Phase 4 ratify (Design v1.0 RATIFIED post-audit). Between now + then = autonomous architect-side draft + bilateral audit per [[architect_drives_mission_not_director]].

**Open mechanism-level design questions** (architect-decidable; surfaced for own resolution during Design draft, not Director-consult):
- F1: Cluster #23 closure integration-test shape (W3 deliverable)
- F2: SubstrateConformanceSuite porting from mission-47 StorageProvider precedent (test-case count + watch-event + restart-safety extensions)
- F3: Variant (ii) substrate-as-KV-backend rationale documentation (vs deferred Variant (i) per AG-5)
- F4: NOTIFY-trigger semantic probe for non-entity writes (Variant ii data-shape)

**Cross-mission state at Phase 4 entry:**
- Main HEAD: `c00944b8` (post-PR #208 calibrations 71-76 preservation)
- Open PRs: #207 (architect-side handover-doc; orthogonal to mission-300)
- Active threads: zero relevant to mission-300; thread-554 stale (mission-79; pre-mission-83)
- greg agent: `online_idle` (per memory state); standing by for bilateral audit-thread when Design v0.1 ready
