---
mission: M-Hub-Storage-FS-Retirement-And-MemoryHubStorageSubstrate
source-idea: idea-300
mission-class: pre-substrate-cleanup
branch: agent-lily/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate
phase: 4-design
phase-entered-at: 2026-05-18 12:08 AEST
phase-entered-via: Director-direct "Enter Phase 4 on idea-300" 2026-05-18
phase-hold-at: 2026-05-18 12:25 AEST
phase-hold-via: Director-direct "Hold on phase 4 for now" 2026-05-18
phase-resumed-at: 2026-05-18 12:32 AEST
phase-resumed-via: Director-direct "Resume Phase 4 for idea 300" 2026-05-18
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

### 2026-05-18 12:18 AEST — Design v0.1 DRAFT pushed; bilateral audit thread opened

- **Design v0.1 commit:** `1386340` (311 lines; pre-bilateral round-1 audit)
- **Bilateral audit thread:** thread-576 opened to greg (`maxRounds=8`; `semanticIntent=seek_rigorous_critique`; correlationId=`m-hub-storage-fs-retirement`)
- **Architect-flag dispositions:** F1-F4 architect-disposed at Design §5; engineer-challenge targets marked per flag
- **Open questions:** Q-A1 through Q-A6 at Design §7.2 for round-1 audit

### 2026-05-18 12:25 AEST — Phase 4 HOLD (Director-direct)

**Trigger:** Director-direct "Hold on phase 4 for now" — single-message disposition pausing Phase 4 work.

**Hold-state preservation:**
- Mission branch + Design v0.1 + work-trace stay on remote at `1386340`
- Thread-576 active (currentTurn=engineer); architect cannot inject hold-message mid-cycle per turn-state lockup ([[pattern_a_engineer_turn_discipline]])
- **Plan when greg engages round-1:** architect immediately replies with hold-signal + thread-converge; greg's round-1 audit content preserved as Phase-4-resume input if Director re-engages Phase 4
- **No code/test/substrate work in flight** — hold is clean; resumes from current state without rewind

**What hold means architecturally:** Director-direct pivot; reason TBD (Director may have other surface to engage; will surface back to Phase 4 when ready OR re-prioritize). Per [[director_direct_mid_cycle_override]] — Director-direct supersedes architect-spec for this slice.

**Architect standby surfaces** (available if Director re-engages on alternate path):
- Phase 10 retro Director-bilateral calibration filings (11 candidates accumulated from mission-83 retro + PR-cleanup-mission)
- idea-302 Strategic Review prioritization
- Strategic-Review-level sequencing tweaks (idea-298 / idea-295/296/297/299 / idea-301 prioritization)
- PR #207 cross-approval follow-up (orthogonal; greg-side)

### 2026-05-18 12:32 AEST — Phase 4 RESUMED (Director-direct)

**Trigger:** Director-direct "Resume Phase 4 for idea 300" — single-message disposition resuming Phase 4 work from hold-state.

**Resume-state verified:**
- Mission branch at `5089f33` (hold-marker commit); 3 commits ahead of main `c00944b` (unchanged since hold)
- Design v0.1 intact on remote (`1386340`)
- Thread-576 still active; greg NOT engaged during hold (currentTurn=engineer; original round-1 audit-ask still standing; preserved bandwidth as predicted)
- Tasks #27-#30 pending; no state change needed
- No mid-cycle artifact rewind required

**Action:** none on thread-576 (greg's original ask still valid; hold-message was never injected because greg didn't engage during the hold window). Architect-side standby restored; will mark task #27 in_progress when greg responds with round-1 audit content.

**Next surface to Director:** Phase 4 ratify (Design v1.0 RATIFIED post-audit-converge); same gate as pre-hold.

### 2026-05-18 12:40 AEST — Design v0.2 (architect-side self-audit refinement; Director-direct deferred-engineer-audit)

**Trigger:** Director-direct "Greg is idle. Re-initiate or resume design" → architect chose resume; verified greg cognitive_ttl=0 (`scripts/local/get-agents.sh`); architect-side unilateral resolution of Q-A2 + Q-A4 + F3 + F4 via code-read.

**Design v0.2 commit:** `c5a16f9` (78 insertions / 37 deletions vs v0.1).

**6 v0.1 → v0.2 refinements (per new §0 changelog):**
1. §2.2 SubstrateConformanceSuite is NEW WORK not port (verified packages/storage-provider/test/ has per-impl tests only)
2. §2.3 Variant (ii) refined "pure-KV" → "minimal-SchemaDef" (substrate `put(kind,entity)` requires kind; pure-KV non-implementable; register RepoEventBridgeCursor + RepoEventBridgeDedupe SchemaDefs)
3. §2.3 final ¶ F4 REVERSED — NOTIFY fires per-kind (SchemaDef.notify default=true verified; v0.1 architect-wrong-claim)
4. §2.3 NEW primitive-mapping table StorageProvider → HubStorageSubstrate (createOnly+putIfMatch+getWithRevision map 1:1)
5. §2.6 Counter — postgres-sequence requires reconciler extension; refined to counters-table mechanism (atomic UPDATE...RETURNING; reconciler-compatible)
6. NEW F5 (CRITICAL) — Variant (ii) implementability defect (v0.1 architect-side error); resolved via minimal-SchemaDef Variant

**SchemaDef inventory update:** 20 → 23 kinds at W4 (RepoEventBridgeCursor + RepoEventBridgeDedupe + Counter); `hub/scripts/entity-kinds.json` v1.1 → v1.2.

**Engineer-audit deferral:** per Director-direct + engineer-idle-state; bilateral round-1 audit deferred from pre-Design-ratify to W0+ PR-merge-gate (greg engages on code-bound delta vs Design §X.Y at code-review-time instead of spec-level pre-implementation).

**Calibration candidate (Phase 10 retro):** **architect-side-self-audit-as-engineer-audit-substitute-when-engineer-idle** — when engineer cognitive_ttl=0 OR thread unengaged for N hours, architect can autonomously self-audit Design via code-read for the architect-decidable subset of audit-questions; engineer-audit shifts to PR-merge-gate for code-bound dispositions. Pattern surfaced 2026-05-18 mission-300 Phase 4 v0.1→v0.2 cycle.

**Architect-side defect note (F5):** v0.1 § 2.3 "pure-KV" Variant (ii) was non-implementable; verified via substrate types.ts grep that surfaced 1:1 primitive mapping (favorable) + kind-requirement (constraint missed). This is a candidate for [[architect_bug_filing_needs_root_cause_verification]] sibling — architect-spec authorship should verify substrate API contract via code-read BEFORE asserting in Design doc. Self-audit caught it within 1 cycle; engineer-audit would have caught it round-1.

**Next surface to Director:** Design v0.2 architect-side-ratified; awaiting Director disposition on (a) ratify v1.0 + enter Phase 5 Manifest, (b) additional Design-phase architect-Director engagement, (c) restore bilateral engineer-audit (e.g., re-attempt greg activation), (d) hold + re-engage on alternate path.
