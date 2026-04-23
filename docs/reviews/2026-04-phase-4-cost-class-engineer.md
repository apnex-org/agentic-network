# Phase 4 Investment Prioritization — Engineer Cost-Class Estimation

**Status:** Engineer parallel-pass output for Phase 4 co-authoring. Lily simultaneously authors Tele-leverage + unblocking-power + dependency map + groupings on `agent/lily`. Reconciliation on thread-254 next.
**Author:** greg (engineer, eng-0d2c690e7dd5), 2026-04-22 AEST.
**Cadence:** Phase 4 plan §Phase 4 Work — engineer cost-class estimation (S/M/L/XL) per candidate "based on scope of code change, number of entities touched, number of ratified ideas consumed".
**Source thread:** thread-254.

---

## 1. Cost-class estimates per Phase 2 §9 candidate (8 total)

| # | Candidate | Cost class | Scope notes |
|---|---|---|---|
| 1 | Workflow Test Harness | **L** | All FSMs + 28 INV "Tested By: NONE" invariants; cross-entity (Task, Mission, Thread, Cascade, Agent FSMs all in scope); consumes idea-104 (mock harness) + observability ideas |
| 2 | Role-Scoping Discipline | **L** | 4 distinct mechanisms (triage SLA, dismissal permission, scope-discovery-upfront, Operational-Friction Filing); cross-entity (Idea, Mission, Bug, possibly new "Operational-Friction" entity-class); architect-elevated concept §2.8 Role Purity is structural |
| 3 | bug-24 Tele Retirement Primitive | **S** | One new MCP tool (`supersede_tele` or `retire_tele`); single entity (Tele); bounded scope; quick-win |
| 4 | bug-25 Adapter Size-Guard | **S** | Adapter-side size-check + structured rejection; no new entity; idea-152 Smart NIC is the structural superseder; this is short-term mitigation only |
| 5 | idea-132 Promotion (Cognitive-layer silence) | **M** | Idea already triaged with mitigation scope captured; cross-entity (cognitive layer + adapter); pattern is mission-38-style multi-task; bug-11 verdict-pending may inform sub-scope |
| 6 | Cascade Correctness Hardening | **M** | 4 distinct cascade-execution drift fixes (bug-22, bug-23, bug-27, bug-28); single subsystem (Hub cascade); collectively cohesive; modest task-count |
| 7 | idea-144 Promotion (Workflow advancement) | **M** (Path A) / **L** (Path B) | Path A = adapter-side post-review handler (M); Path B = Hub-side stateful mission sequencer (L). Director's pick for path determines cost. Engineer recommends Path A first for speed. |
| 8 | idea-150 Environment Deployer | **L** | Full deployment automation (Cloud Build orchestration, multi-env, redeploy gating, ADC handling); CI workflow infrastructure; significant new tooling; absorbs sym-C-003 + sym-C-004 (the latter shipped) |

---

## 2. Cost-class summary

| Class | Count | Candidates |
|---|---|---|
| S | 2 | bug-24 Tele Retirement, bug-25 Adapter Size-Guard |
| M | 3 | idea-132 Promotion, Cascade Correctness Hardening, idea-144 Path A |
| L | 3 | Workflow Test Harness, Role-Scoping Discipline, idea-150 Environment Deployer |
| XL | 0 | (idea-152 Smart NIC would be XL but is scope-reserved per Phase 2 §9 anti-goals) |

**Distribution observation:** 2 quick-wins (S) + 3 medium + 3 large. Director's 3-5 winner selection has multiple natural shapes:
- **All-quick-wins shape** (2-3 winners): bug-24 + bug-25 + maybe Cascade Correctness — ships in days, low-risk, addresses concentrated unaddressed gaps
- **One-large-multiple-medium shape** (3-4 winners): Workflow Test Harness OR Role-Scoping Discipline as the structural anchor + 2-3 M/S to round out
- **Heavy-structural shape** (3-5 winners): Workflow Test Harness + Role-Scoping Discipline + 1-2 quick-wins to ship visible progress alongside

---

## 3. Engineer-suggested additions to candidate pool

**Engineer-flagged consideration:** Per architect's default (1) restricted-pool, no additions proposed. The 8 Phase 2 §9 candidates cover the full unaddressed-symptom surface. Two notes:

- **sym-C-011 engineer-permission gap** (added in Phase 2 critique) is a Mechanism within candidate #2 (Role-Scoping Discipline §2.8 Mechanics list explicitly addresses dismissal permission). No standalone mission needed.
- **Mission-numbering chaos** (Phase 1 cartography §4.2; deferred per anti-goal §6) — not added; review anti-goal still applies.
- **idea-152 Smart NIC as XL** — explicitly scope-reserved per Phase 2 §9 anti-goals; not in candidate list; bug-25 Adapter Size-Guard is the short-term substitute. Confirmed.

No additions. Restricted pool of 8 stands.

---

## 4. Cost-class methodology (for reconciliation reference)

S = single-entity scope, days to deploy, well-understood mechanism, ≤2 ideas consumed
M = single-subsystem scope, weeks to deploy, multi-task within subsystem, 2-5 ideas consumed
L = cross-entity / cross-subsystem scope, weeks-to-month, multi-task across boundaries, 5-10 ideas consumed
XL = systemic scope, months, redefines a layer (e.g., idea-152 Smart NIC absorbing identity + transport), 10+ ideas consumed

Engineer judgment-call signals to flag for reconciliation:
- **Workflow Test Harness L vs XL:** depends on coverage scope decision. If Director picks "all 28 INV invariants" it's XL; "high-value subset" is L. Conservatively L.
- **Role-Scoping Discipline L:** could be split into 2 missions (Triage SLA + Permission Refactor) reducing each to M. Director's call.
- **idea-144 Path A vs Path B:** my recommendation is Path A first (M, ships quickly) then Path B as follow-up. Lily may have a different sequencing view.
- **Workflow Test Harness vs Cascade Correctness:** these overlap on test-coverage scope; both could expand to consume more invariants. Director should explicitly separate.

---

## 5. Coordination notes

- Architect parallel-pass produces Tele-leverage + unblocking-power scores + dependency map + groupings (blockers / quick-wins / structural / velocity-multipliers)
- Reconciliation on thread-254: any cost-class disputes; any Director-shape-sensitive splits/folds
- Architect-authored unified candidate list folds engineer cost + architect leverage + dependency view into a single Director-reviewable document
- Director ranks → 3-5 winners selected → both agents revise into full mission briefs (Name / Tele served / Goal / Scope / Success criteria / Dependencies / Effort class / Related Concepts-Defects)

---

*End of engineer cost-class estimation. Awaiting architect parallel-pass output for reconciliation. Standing by on thread-254.*
