# Mission Lifecycle — formal lifecycle methodology

**Status:** v1.2 (Director-ratified 2026-04-26 post mission-58 W1+W2 dispatch + cadence-recalibration discussion). v1.2 recalibrates §4.1 per-class default cadences anchored in empirical 10-15min active-arc baseline (was concept-memo aspirational 30-60min). v1.1 added RACI matrix + per-phase detail enrichment + sub-execution overview + 3-mode retrospective taxonomy reference + entity-mechanics.md companion doc cross-links.

**v1.1 → v1.2 delta** (2026-04-26 post mission-58 dispatch + Director cadence-recalibration):
| Section | Change |
|---|---|
| §4.1 Per-class default cadence | RECALIBRATED — defaults anchored in empirical 10-15min active-arc baseline (was concept-memo aspirational 30-60min). Per Director observation: pulse primitive replaces manual 10-15min loops from mission-56/57 active arcs. New defaults: most classes converge on 15min engineer / 30min architect; spike 10/20; distribution-packaging 30/60 (async work) |

**v1.0 → v1.1 delta:**
| Section | Change |
|---|---|
| §1 Phase descriptions | ENRICHED — Phase 5/7/8/9/10 prose detail expanded; Phase 10 references 3-mode retrospective taxonomy (`feedback_retrospective_modes.md`) |
| §1.5 RACI matrix | NEW — per-phase × per-role responsibilities (Director / Architect / Engineer; standard RACI semantics) |
| §7 Sub-execution mechanics | NEW — brief overview of Task entity FSM + Trace discipline + cascade behaviors; references `entity-mechanics.md` for per-entity detail |
| `entity-mechanics.md` (companion) | NEW companion doc — per-entity FSM + status transitions + cascade behaviors + Hub primitives reference |
| §6 Substrate-self-dogfood | Memory cross-link updated (`feedback_substrate_self_dogfood_discipline.md` v2 codifies substrate-vs-enrichment refinement) |

**v0.1 → v1.0 delta** (preserved for historical reference):
| Section | Change |
|---|---|
| §1 Lifecycle phases | NEW — formal phase enumeration (Concept → Idea → Survey → Design → Manifest → Preflight → Release-gate → Execution → Close → Retrospective) |
| §2 Survey-then-Design phase | NEW — references `docs/methodology/idea-survey.md` v1.0 (canonical) |
| §3 Mission-class taxonomy | NEW — per mission-56 retrospective §5.4.1 (8 classes); mission-entity `missionClass` field codified |
| §4 Pulse coordination | NEW — per-class default cadence template (NOT Hub primitives); override semantics; when-to-disable; ScheduleWakeup boundary |
| §5 Autonomous-arc-driving pattern | NEW — categorised-concerns table + architect→Director surface discipline |
| §6 Substrate-self-dogfood discipline | NEW — 5-requirement pattern + substrate-vs-enrichment refinement (mission-56 W2.2 substrate vs mission-57 W2 enrichment first canonical examples) |
| §A Lifecycle audit (legacy) | RETAINED — v0.1's per-transition audit table preserved as appendix |

---

## §1 Formal mission lifecycle phases

A mission moves through 10 macro-phases from Concept → Retrospective. Each phase has a defined entry condition + exit signal + binding artifact.

```
Phase 1  — Concept           Director / agent surfaces a workflow concept
Phase 2  — Idea              Filed via `create_idea`; status: open → triaged
Phase 3  — Survey            Architect 3+3 questions; Director picks; intent envelope ratified
Phase 4  — Design            Bilateral architect+engineer Design v0.1 → v1.0
Phase 5  — Manifest          Architect calls create_mission with plannedTasks; status: proposed
Phase 6  — Preflight         Architect authors preflight artifact; verdict GREEN/YELLOW/RED
Phase 7  — Release-gate      Director ratifies preflight; architect flips status: proposed → active
Phase 8  — Execution         W0-Wn wave cascade; per-wave PR + cross-approval + admin-merge
Phase 9  — Close             W5-equivalent closing wave; status: active → completed
Phase 10 — Retrospective     Architect-authored retrospective; Director-ratified mode (walkthrough/summary-review/skip per `feedback_retrospective_modes.md`)
```

### §1.x Per-phase detail (v1.1 enrichment)

**Phase 5 — Manifest:** Architect calls `create_mission` with `plannedTasks[]` array binding the W0-Wn wave plan + `missionClass` field per §3 taxonomy. Mission entity status flips to `proposed`. plannedTasks remain `unissued` until first wave dispatch (cascade auto-issuance OR architect-direct dispatch via thread per `multi-agent-pr-workflow.md` cross-approval pattern). Architect also flips source `Idea.status` → `incorporated` + sets `Idea.missionId` for traceability.

**Phase 7 — Release-gate:** Architect surfaces preflight verdict + release-gate ratification ask to Director (categorised: HOLD-point gate per §5 categorised-concerns table). Director ratifies (or redirects); architect calls `update_mission(status="active")` per autonomous-arc-driving authority (Director may also signal directly). Mission moves to `Phase 8 Execution`.

**Phase 8 — Execution:** W0-Wn wave cascade; per-wave architect dispatch via fresh thread → engineer claim + work + PR → cross-approval per `multi-agent-pr-workflow.md` (engineer-pool ✓ on architect-content; architect-pool ✓ on engineer-content) → admin-merge. Per-wave bilateral seal of dispatch thread. Cross-package vitest baseline (bug-32) admin-merge per established lineage. See §7 sub-execution mechanics + companion `entity-mechanics.md` for per-entity FSM detail.

**Phase 9 — Close:** Final wave (W5-equivalent / closing wave) per Design's wave plan; typically includes closing audit + ADR + methodology codifications (e.g., mission-56 W5; mission-57 W4). Architect flips `mission.status` → `completed`. Pulses auto-suspend on close (per §4.3 when-to-disable table).

**Phase 10 — Retrospective:** Mode determined by mission class per `feedback_retrospective_modes.md`:
- **Walkthrough** (Director-paced section-by-section; ~30-60min Director time) — for structural-inflection / substrate-introduction class missions; mission-56 first canonical
- **Summary-review** (architect-prepared full doc; Director reviews Closing summary; ~5-10min Director time) — for coordination-primitive-shipment / saga-substrate-completion / smaller-scope missions; mission-57 first canonical
- **Skip** (closing audit + mission-class signature suffices; no separate retrospective doc) — for spike / substrate-cleanup-wave / rare bug-fix-as-mission

Architect surfaces mode-pick options to Director at mission-close moment; Director picks; architect proceeds. Retrospective doc (when authored) lives at `docs/reviews/<mission>-retrospective.md`.

**Phase artifact summary:**

| Phase | Binding artifact | Stored at |
|---|---|---|
| 2 Idea | Idea entity | Hub |
| 3 Survey | Pre-Design intent envelope (in dispatch thread + Survey artifact doc) | thread + `docs/designs/<mission>-survey.md` |
| 4 Design | Design v1.0 doc (ratified) | `docs/designs/<mission>-design.md` |
| 5 Manifest | Mission entity + plannedTasks[] | Hub |
| 6 Preflight | Preflight artifact + verdict | `docs/missions/<mission>-preflight.md` |
| 8 Execution | Per-wave sub-PRs + closing audit | branches + `docs/audits/<mission>-closing-audit.md` |
| 9 Close | Status=completed; closing audit on main | Hub |
| 10 Retrospective | Retrospective doc | `docs/reviews/<mission>-retrospective.md` |

**Director-engagement points** (per autonomous-arc-driving pattern §5):
- Phase 3 Survey (~5min Director-time; 6 picks)
- Phase 7 Release-gate ratification (preflight verdict ratification)
- Phase 10 Retrospective ratification (mode-pick + ratification per chosen mode)

All other phases are architect+engineer scope.

---

## §1.5 RACI matrix (per-phase × per-role)

Standard RACI semantics: **R**esponsible (does the work) / **A**ccountable (final decision authority) / **C**onsulted (input solicited) / **I**nformed (notified of outcome). Per-phase per-role:

| Phase | Director | Architect | Engineer |
|---|---|---|---|
| **1 Concept** | A (originates concept; or accepts from agent) | C (shapes intent if architect-originated) | I |
| **2 Idea** | A (ratifies triage at Phase 3 entry) | R (files Idea entity; triages) | I |
| **3 Survey** | A (picks 6 answers across 2 rounds; ~5min) | R (designs questions; interprets responses per `idea-survey.md` v1.0) | I |
| **4 Design** | C (out of mechanics; intent ratified via Survey envelope at Phase 3) | R (drafts Design v0.1 → v1.0; bilateral with engineer) | R (round-1 + round-2 audit; bilateral ratifies v1.0) |
| **5 Manifest** | I | R (calls `create_mission`; updates Idea entity link) | I |
| **6 Preflight** | C (preflight ratification at Phase 7) | R (authors preflight artifact; runs 6-category audit) | I |
| **7 Release-gate** | A (ratifies preflight; signals/approves status=active) | R (architect-flips status per autonomous-arc authority) | I |
| **8 Execution** | C (categorised concerns only per §5.1; surface only when warranted) | R (per-wave dispatch + cross-approval + admin-merge; mission-coordination) | R (claim + work + PR + Trace + closing audit) |
| **9 Close** | I | R (flips status=completed; verifies mission-state) | R (closing audit doc; final state verification) |
| **10 Retrospective** | A (mode-picks; reviews retrospective per chosen mode; ratifies) | R (drafts retrospective per chosen mode) | C (cross-approve PR; engineer-spec input if relevant) |

**Notes:**
- **Mediation invariant** (§5.3) governs cross-role information flow: Director ↔ Engineer routes through Architect. RACI does not authorize direct Director↔Engineer mechanics surfaces.
- **Pulse-driven coordination** (§4) does NOT change RACI; pulses are structured-mediation channels, not role-shifts.
- **Bypass cases**: Survey bypass per `idea-survey.md` §8 still preserves RACI; spawned-Idea linkage MANDATORY for traceability.
- **First-canonical-execution missions** may have higher Director engagement (active-collaborator mode per §5.2); does not violate RACI as long as architect holds the gate on routine mechanics per §5.1 categorised-concerns table.

---

## §2 Survey phase (Idea → Design transition)

**Canonical reference:** `docs/methodology/idea-survey.md` v1.0 (Director-ratified 2026-04-26; PR #89 merged at `04b7544`).

The Survey phase is **mandatory for Idea→Design transitions**; first canonical execution at idea-206 → mission-57 (Director-engagement compressed ~36-50× vs mission-56 Director-paced Design walkthrough).

**Pattern summary** (full spec in `idea-survey.md` v1.0):
1. **Round 1** (architect proposes 3 orthogonal questions; Director picks; architect captures aggregate response surface; loops through each question for per-question interpretation)
2. **Round 2** (architect proposes 3 refinement questions building on Round 1; Director picks)
3. **Survey envelope** = composite of all 6 picks; bounds Design phase scope
4. Director then **OUT of Design mechanics** until Phase 7 Release-gate

**Bypass cases** (per `idea-survey.md` §2 scope table):
- Bug→Fix flow: skip Survey
- Spawned-from-current-Mission Idea: architect-judgment bypass IF sufficiently scoped

**Anti-pattern: open-ended Director ratification at Design time** is retired by Survey-then-Design. Director time-cost concentrates at Survey (~5min) instead of Design walkthrough (~3h+).

---

## §3 Mission-class taxonomy

Per mission-56 retrospective §5.4.1; mission entity gains optional `missionClass` field at mission-57 W1 (PR #87 merged `72f77ab`).

| Class | Characteristic | Operationalize/Retire signature | Calibration cadence |
|---|---|---|---|
| **spike** | Recon / discovery / scoping; produces analysis for downstream missions | 1-2 ops / 0 retire | Low (1-3) |
| **substrate-introduction** | Ships new primitive / sovereign-package; foundation for downstream | 1-2 ops / 0 retire | Medium (3-5) |
| **pre-substrate-cleanup** | Prepares baseline for substantive substrate; refactors / consolidates | 2-4 ops / 0-2 retire | Medium (3-5) |
| **structural-inflection** | Ships substrate that retires existing imperative patterns at structural level; mid-mission self-dogfood often present | 5+ ops / 3+ retire | High (6+) |
| **coordination-primitive-shipment** | Ships single coordination primitive; composable atop existing substrate | 1-2 ops / 1-2 retire | Medium (3-5) |
| **saga-substrate-completion** | Migrates existing saga primitive onto newer substrate | 1-2 ops / 1 retire | Medium (3-5) |
| **substrate-cleanup-wave** | Retires deprecated patterns / fixes accumulated technical debt | 0-1 ops / 3+ retire | Low-Medium (2-4) |
| **distribution-packaging** | Publishing / distribution / integration work | 1-2 ops / 0-1 retire | Low (1-3) |

**Use of taxonomy:**
1. **Mission preflight** — preflight checks `missionClass` declaration; mismatch with deliverable scope = scope-flex signal
2. **Mission retrospective** — realized operationalize/retire/calibration counts compared against declared-class signature; mismatch = misclassification or execution-discipline-gap
3. **Strategic-review prioritization** — Director-paced triage uses class to balance mission portfolio (avoid stacking 3 structural-inflection missions in series)

`(unset)/legacy missionClass` = NO automatic pulses (per §4 backward-compat row).

---

## §4 Pulse coordination

Per ADR-027; mission entity gains `pulses.{engineerPulse, architectPulse}` declarative config at mission-57 W1 (PR #87 merged `72f77ab`); PulseSweeper drives at mission-57 W2 (PR #88 merged `4f4b76f`).

### §4.1 Per-class default cadence template

**Conventions, NOT Hub primitives** (per Survey Q3+Q4+Q6 anti-goal). Mission entity always-canonical for runtime config; missions opt-in by declaring `pulses.*`.

**v1.2 recalibration note:** defaults below are anchored in empirical 10-15min active-arc baseline (mission-56/57 PRs shipped ~10-15min apart consistently; `feedback_wakeup_cadence_15min_max.md` 15min cap already primary default). Pulse primitive replaces manual 10-15min loops; cadence reflects the loop-replacement reality, not aspirational watchdog cadences.

| missionClass | engineerPulse default | architectPulse default | Notes |
|---|---|---|---|
| **(unset / legacy)** | **NO PULSE** | **NO PULSE** | Backward-compat: legacy missions without `missionClass` declaration get no auto-pulses; explicit opt-in via `pulses.*` declaration only |
| `spike` | 10min | 20min | Short missions; quick check-ins; firstFireDelay still protects against low-utility fires |
| `substrate-introduction` | 15min | 30min | Standard active-arc cadence; substrate work has natural sub-PR rhythm |
| `pre-substrate-cleanup` | 15min | 30min | Standard active-arc cadence |
| `structural-inflection` | 15min | 30min | Standard active-arc cadence (mission-56 evidence: ~10-15min sub-PRs → engineer pulse fires every ~1 PR; high cognitive load handled via responseShape design, not longer cadence) |
| `coordination-primitive-shipment` | 15min | 30min | Standard active-arc cadence (mission-57's class) |
| `saga-substrate-completion` | 15min | 30min | Standard active-arc cadence |
| `substrate-cleanup-wave` | 15min | 30min | Standard active-arc cadence (mission-58's class; smaller missions still benefit from tight cadence) |
| `distribution-packaging` | 30min | 60min | Async work; longer cadence acceptable (only class with >15min engineer default; reflects async-coord nature) |

**Default `missedThreshold`**: 3 across all classes (matches W3.2 ADR-017 receipt-deadline-missed-3x precedent).

**Default `responseShape`**: `short_status` for both engineerPulse + architectPulse (status-elicitor framing per concept memo intent).

**Default `firstFireDelaySeconds`**: equal to `intervalSeconds` (first pulse fires after one cadence; not immediately on activate — S2 noise-reduction).

**Default `precondition`**: `{fn: "mission_idle_for_at_least", args: {seconds: <intervalSeconds>}}` (auto-injected at mission-policy.ts validation; reduces noise during high-activity sub-PR cascades).

### §4.2 Override semantics

Mission `pulses.<role>Pulse.*` field declarations OVERRIDE per-class defaults. Architect declares at Design time (or at create_mission Manifest cascade); bilateral with engineer; engineer-final on cadence specifics. Per-pulse override fields:

- `intervalSeconds` (≥60s enforced; ≥300s recommended)
- `message` (non-empty)
- `responseShape` (required; no default)
- `missedThreshold` (default 3)
- `precondition` (default `mission_idle_for_at_least`; explicit `null` to disable)
- `firstFireDelaySeconds` (default `intervalSeconds`)

Sweeper-managed bookkeeping fields (`lastFiredAt` / `lastResponseAt` / `missedCount` / `lastEscalatedAt`) are read-only via MCP tools; only PulseSweeper writes via direct repository updates.

### §4.3 When to disable pulses

| Situation | Action |
|---|---|
| Architect retrospective HOLD post-mission-close | Set `mission.status = "completed"` (pulse auto-suspends) OR set `pulses: {}` |
| idea-208 CI-dogfood verification windows | Mission can declare `pulses.engineerPulse: null` to suppress |
| Active sub-PR cascade with high natural coord cadence | `precondition: { fn: "mission_idle_for_at_least", args: { seconds: <intervalSeconds> } }` (default) skips fires when activity recent |
| Mission stuck in escalation | Pulse auto-pauses (missedThreshold breached); no manual disable needed |
| Substrate-self-dogfood-defer (substrate-vs-enrichment per §6) | Don't declare pulses on the mission shipping the pulse substrate |

### §4.4 Pulse vs ScheduleWakeup boundary (S5)

| Use case | Mechanism |
|---|---|
| Recurring agent coordination during active mission | idea-206 pulse primitive (this lifecycle's recurring path) |
| One-off "wake at X to check Y" outside active mission | Local `ScheduleWakeup` (architect-side; retained) |
| Recurring architect proactive ping | idea-206 pulse primitive (architectPulse) — calibration #4 retired |
| Mission-status escalation watchdog | Pulse `missedThreshold` + architect-routed `escalateMissedThreshold` (NOT direct Director-pulse per Survey Q2) |

`feedback_wakeup_cadence_15min_max.md` 15min cap retired by pulse adoption for recurring case; cap holds until pulse declaration on a given mission.

### §4.5 Active-missions cap

Recommended cap: **3 active missions per engineer** at any time. Aggregate pulse-storm at this cap is acceptable (3 pulses per cadence per role). If exceeded, consider coalesce primitive in future mission (deferred S6).

---

## §5 Autonomous-arc-driving pattern

Per mission-56 retrospective §5.1.1 + pre-mission-arc retrospective §1.1. **First codified canonical execution example:** mission-56 (M-Push-Foundation; 3 architect→Director surfaces in ~3.5h; zero pattern violations).

### §5.1 Categorised-concerns table

Architect-side default-handle vs Director-surface concerns:

| Concern category | Default | Surface to Director? |
|---|---|---|
| Routine PR-merge / cross-approval / admin-merge | Architect-autonomous | NO |
| Sub-PR dispatch within ratified mission scope | Architect-autonomous | NO |
| Bilateral seal / threading-2.0 stagedActions | Architect-autonomous | NO |
| Mission status flip (active → completed) | Architect-autonomous | NO |
| **Out-of-scope risks** (deployment-affecting; substrate-shifting) | Architect surface | **YES** |
| **Strategic / scope-flex** (mid-mission scope reshape) | Architect surface | **YES** |
| **Bug discovery** (architect-observed) | Architect file Bug entity + surface | **YES** (filed; not surface-blocked) |
| **Methodology calibration** (architect-observed) | Architect file feedback memory + surface if binding | YES if binding |
| Mission-execution-discipline (don't-rush / scope-discipline) | Director-initiated correction | (Director engages proactively) |

### §5.2 Director-engagement modes

**Director-as-active-collaborator** (queries / ratifications / tele surfaces / operational support) is a feature, not a pattern violation. Pattern's success metric = **architect→Director surface frequency conditional on category-fit**, not raw engagement volume.

mission-56 empirical baseline: ~1 architect→Director surface per 70min during active mission execution (~3.5h window).

mission-57 empirical baseline: ~1 architect→Director surface per ~80min during active mission execution (Survey + W0-W4 cascade); Director-as-active-collaborator engagement higher post-mid-mission Survey codification.

### §5.3 Mediation invariant (Director ↔ Engineer through Architect)

**Binding structural design invariant.** Pulse missed-threshold escalation routes via architect (E1 fix per Design v1.0 §4); both-roles-silent degradation handled by Director operational-support pattern (mission-56 D3: "I will restart greg" precedent).

Zero direct Director↔Engineer surfaces required throughout mission-56 + mission-57 lineage.

---

## §6 Substrate-self-dogfood discipline

Per mission-56 retrospective §6.4 + mission-57 thread-355 r3 substrate-vs-enrichment refinement.

### §6.1 5-requirement pattern

For substrate missions where the mission's own coordination consumes its shipped artifact, the mission Design should explicitly include:

1. **Dogfood gate identification** — which sub-PR's merge unlocks the new coordination behavior?
2. **Pre-gate sub-PR sequencing** — ensure sub-PRs after the gate can use the new behavior; before-gate sub-PRs use legacy
3. **Adapter-restart / Hub-redeploy gating** — explicit step in the wave plan
4. **Verification protocol** — specific architect-engineer interaction post-gate that demonstrates the new behavior
5. **Hold-on-failure clause** — verification fails → downstream waves resume in legacy-mode + substrate change is investigated

### §6.2 Substrate vs enrichment distinction (mission-57 refinement)

**Substrate missions** (mission-56 W2.2 push pipeline canonical example):
- Substrate the mission's own coordination consumes
- Live dogfood high-leverage; closes architectural gaps structurally (mission-56 W2.2 closed bug-34)
- Dogfood-gate execution typically warranted

**Enrichment missions** (mission-57 W2 PulseSweeper canonical example):
- Substrate that enriches future missions' coordination (not foundational substrate)
- Live dogfood lower-pressure; verification via tests + integration sufficient pre-ship
- Dogfood-defer is engineering call when reasoned (per substrate-vs-enrichment evaluation)

### §6.3 Decision flow at dispatch time

For substrate-self-dogfood-applicable missions, the architect (with engineer input) evaluates at the dogfood-gate sub-PR dispatch:

1. Is this substrate that the mission's own coordination consumes? (substrate vs enrichment)
2. If substrate: live dogfood likely warranted; execute 5-requirement pattern fully
3. If enrichment: defer is acceptable; document substrate-vs-enrichment reasoning; verification via tests + integration; live dogfood deferred to a future mission OR reproducible-by-CI dogfood automation (idea-208)

mission-57's first canonical DEFERRED execution validates the pattern accommodates defer when reasoned.

**Memory:** `feedback_substrate_self_dogfood_discipline.md` v2 codifies the substrate-vs-enrichment refinement + cites mission-56 W2.2 (substrate canonical) + mission-57 W2 thread-355 r3 (enrichment-defer canonical) as the two execution examples.

---

## §7 Sub-execution mechanics (overview)

Phase 8 Execution is the heaviest phase by elapsed time + mechanics; this section is a brief overview of sub-execution mechanics. **Per-entity FSM + status transitions + cascade behaviors detail lives in `docs/methodology/entity-mechanics.md` (companion doc).**

### §7.1 Engineer-side execution loop (per-wave)

For each wave Wi within Phase 8:

```
architect dispatch (thread)
  → engineer claim (claim_session if needed; thread engagement)
  → engineer work (implementation; tests; commits on dedicated branch)
  → engineer opens PR (GitHub event; cross-package vitest baseline; bug-32 admin-merge baseline)
  → engineer thread-message PR-review thread to architect (engineer-pool ✓ ask context)
  → architect cross-approve (gh pr review --approve) + admin-merge (gh pr merge --squash --admin)
  → engineer ack on thread + bilateral seal of PR-review thread
  → architect dispatch next wave (or close mission if final wave)
```

### §7.2 Trace discipline (engineer-owned)

Engineer maintains work-trace at `docs/traces/<task-or-mission>-work-trace.md` per `reference_work_traces_dir.md`. Trace is engineer-owned; architect reads for context but does NOT patch. Trace shape is engineer-flexible (typically per-task progress notes + decision points + blockers).

Trace timestamps use AEST per `project_session_log_timezone.md` (~10h forward skew vs UTC).

### §7.3 Task entity FSM (canonical)

`pending` → `working` → `needs_review` → `completed` (or `abandoned`; revision loop via `working`).

Task entity is mostly orthogonal to mission-57's plannedTasks-based execution (which uses thread-dispatch instead of formal Task entities). Per `feedback_plannedtasks_manual_create_mismatch.md`: missions with plannedTasks should NOT manual-create Task entities (cascade-binding mismatch). Future cascade-execution missions may consume Task entity FSM directly when task-316 cascade is fully exercised.

**Per-entity FSM + cascade detail:** see `entity-mechanics.md` §3 Task entity section.

### §7.4 Cross-approval pattern (mission-execution-discipline)

Per `multi-agent-pr-workflow.md` v1.0:
- Architect-content PRs: engineer-pool ✓ on thread + GitHub-side
- Engineer-content PRs: architect-pool ✓ on thread + GitHub-side
- Repo last-pusher rule: any push after a review invalidates that review; re-approval needed
- Cross-package vitest fails per bug-32 baseline → admin-merge per established lineage (mission-54 + mission-55 + mission-56 + mission-57 = 35-PR consecutive at mission-57 close)

### §7.5 Per-wave bilateral seal discipline

Each dispatch thread + each PR-review thread is bilateral-sealed via `create_thread_reply(converged=true)` with `stagedActions: [{kind:"stage", type:"close_no_action", payload:{reason:...}}]` + non-empty `summary`. Threads 2.0 discipline; convergence finalization happens via Hub cascade.

### §7.6 Cascade-driven mechanics (overview)

Some sub-execution transitions are Hub-cascade-driven:
- Mission `plannedTasks` cascade auto-issues next-unissued task on review-approval (task-316 / idea-144 Path A) — applies when missions use formal Task entities (NOT mission-57's thread-dispatch pattern)
- Thread convergence cascade fires `close_no_action` / `update_mission_status` / `propose_mission` / `create_idea` / `create_task` / `create_proposal` actions per Threads 2.0 (ADR-013/014)
- Pulse-fire cascade on PulseSweeper tick (per §4)
- ack_message webhook on Message status flip to `acked` (mission-56 W3.2 + mission-57 W2 webhook composition)

**Per-cascade detail:** see `entity-mechanics.md` §4 Cascade catalog.

### §7.7 Anti-patterns retired

- **Manual-create Task on plannedTasks-bound mission** — per `feedback_plannedtasks_manual_create_mismatch.md` (bug-31); causes cascade duplication
- **Architect proactive ping for recurring case** — retired by pulse primitive (mission-57 substrate); recurring use → pulse, one-off → local ScheduleWakeup per §4.4
- **Director-led Design walkthrough section-by-section** — retired by Survey-then-Design (per §2 + idea-survey.md v1.0)
- **Architect aggregate-only Survey interpretation** — retired by per-question multi-dim-context interpretation loop (per idea-survey.md §9)

---

## §A Lifecycle audit (preserved from v0.1)

(Original v0.1 audit content preserved unchanged below; serves as forward-compat reference for transitions enumerated pre-v1.0 codification.)

# (v0.1 original content)

# Mission Lifecycle Audit — goal-for-primitives reference

**Status (v0.1):** v0.1 draft (2026-04-25, architect lily). Not a policy document — a map of today's mission lifecycle mechanics + the gaps that the workflow-primitive ideas (idea-191 repo-event-bridge, idea-192 hub-triggers-inbox) must close.

**Purpose.** Make the full multi-phasic mission collaboration workflow mechanically legible. Every state transition in a mission's lifecycle is either *driven by a Hub event* (mechanised) or *driven by a human/agent noticing something* (not mechanised). This doc enumerates every transition, classifies it, and names what primitive the Hub needs in order to mechanise each "not mechanised" step.

The Director bar this serves: *"For missions that are well shaped and planned, Lily+Greg must be able to coordinate end to end without intervention — unless that intervention warrants Director input."* This doc is the target that idea-191 + idea-192 must deliver against.

**Non-goals.** Not a workflow policy (policies live in `multi-agent-pr-workflow.md`, `mission-preflight.md`, `strategic-review.md`). Not a tool-surface redesign (tool/verb shapes defer to idea-121). Not a session-wake solution (session-wake remains deferred).

---

## 1. Entity lexicon (status fields that drive the lifecycle)

| Entity | Status field values | Notes |
|---|---|---|
| **Mission** | `proposed` → `active` → `completed` (or `abandoned`) | Architect-gated preflight gate for `proposed`→`active`; architect-gated close for `active`→`completed` |
| **Task** | `pending` → `working` → `needs_review` → `completed` (or `abandoned`, revision loop via `working`) | Per-task lifecycle; DAG cascade advances dependent tasks on completion |
| **Proposal** | `open` → `accepted` / `rejected` | |
| **Report** | attached to task; implicit submitted-on-create | Status lives on parent task (`needs_review`) |
| **Review** | instantaneous entity; `approved` / `revision_required` | Creation triggers downstream cascades (task status flip + DAG + mission advancement) |
| **Thread** | `active` → `converged` / `round_limit` / `closed` / `abandoned` / `cascade_failed` | Convergence actions fire cascade handlers (create_task, propose_mission, create_idea, update_mission_status, etc.) |
| **Turn** | `planning` → `active` → `completed` | Work-traced unit of agent activity; orthogonal to lifecycle |
| **Idea** | `open` → `triaged` / `dismissed` / `incorporated` | Backlog artifact; matures into mission via design round |
| **Bug** | `open` → `resolved` | |
| **Clarification** | `pending` → `resolved` | Engineer-raised question blocking task progress |
| **pending-action** (ADR-017) | `receipt_acked` → `completion_acked` (or `escalated`) | Queue item dispatched to an agent |
| **notification** | `new` → consumed (implicit) | Push to agent |
| **director-notification** | `new` → `acknowledged` | Push escalated to Director |

The agent-to-Hub surface today exposes three delivery primitives in parallel — `notification`, `pending-action`, `director-notification` — with overlapping semantics. See §5.

---

## 2. Lifecycle phase map

A mission moves through 7 macro-phases. Each is a cluster of transitions:

```
Phase 1 — Ideation           idea filed → triaged → design round opens
Phase 2 — Design             design thread → converged → mission proposed
Phase 3 — Activation         mission proposed → preflight → active → engineer assigned
Phase 4 — Execution          per-task cycle: dispatch → work → PR → review → merge
Phase 5 — Task completion    task completed → DAG cascade → next-task dispatch OR all-done
Phase 6 — Reporting          mission report written → architect review → retrospective
Phase 7 — Close              mission → completed → Director awareness
```

Phases 1-2 are *generative* (produce new work). Phases 3-7 are *executional* (drive work to completion). Today's friction concentrates in Phases 3, 4, and 6-7 — exactly where inbox/trigger mechanisation matters most.

---

## 3. Per-transition audit

Each row: source state → target state | today's trigger | gap | mechanised ideal | escalation policy.

Legend for "gap":
- 🟢 mechanised — Hub fires event / cascade today
- 🟡 partial — some mechanisation but requires agent-in-session
- 🔴 not mechanised — human or agent polling required

### Phase 1 — Ideation

| Transition | Today | Gap | Mechanised ideal | Escalation |
|---|---|---|---|---|
| `idea.open` → `idea.triaged` | Manual triage | 🟡 | Strategic-review cadence produces batch triage; inbox-item to architect for ideas past triage SLA | If idea open > N weeks → Director inbox |
| idea-triaged → design round | Manual thread create | 🟡 | Triage action "promote to design" fires cascade: open thread, notify architect+engineer | — |

### Phase 2 — Design

| Transition | Today | Gap | Mechanised ideal | Escalation |
|---|---|---|---|---|
| Thread opened | Cascade from idea triage | 🟢 | — | If thread opens addressed to offline agent → inbox-item drains on session-start |
| Thread reply | Turn-check + convergence staging | 🟢 | — | If other party silent >24h in-turn → architect/Director inbox |
| Thread `active` → `converged` | Bilateral convergence seal | 🟢 | — | — |
| Converged → mission proposed | `propose_mission` cascade handler | 🟢 | — | — |

*Phase 2 is well-mechanised today (Threads 2.0 / ADR-013/014).* Biggest risk is cold-thread-waiting-for-offline-participant (see Phase 4 routing-mismatch pattern — mission-47 §3.2).

### Phase 3 — Activation

| # | Transition | Today | Gap | Mechanised ideal | Escalation |
|---|---|---|---|---|---|
| 3.1 | `mission.proposed` → `mission.active` | Architect manually flips via `update_mission`; no preflight gate enforced | 🔴 | Preflight checklist encoded as cascade: status flip blocked until checklist items green (scope sealed, owner assigned, success criteria, tele alignment) | If mission sits in `proposed` > preflight-SLA → Director inbox |
| 3.2 | `mission.active` → engineer assignment | **No event. Engineer learns via out-of-band thread ping.** | 🔴 | On `mission.active`, fire inbox-item to mission.owner (engineer role) — directive: "mission active; draft task plan or claim first task" | If assignment unread > SLA → architect inbox |
| 3.3 | Task creation from mission plannedTasks | Cascade advances issued-task on mission-advancement path (ADR task-316) | 🟢 | — | — |
| 3.4 | `task.pending` → dispatched to engineer | Pending-action queue item | 🟡 (requires engineer session or drain) | Inbox-item push-immediate + queued for drain-on-session-start | If undrained > SLA → architect inbox |

### Phase 4 — Execution (per-task cycle)

The highest-friction phase. PR/review/merge events live in GitHub; Hub is blind to them today.

| # | Transition | Today | Gap | Mechanised ideal | Escalation |
|---|---|---|---|---|---|
| 4.1 | Engineer claims/starts task | Task status flips `pending` → `working` on get_task | 🟢 | — | — |
| 4.2 | Engineer opens PR | GitHub event; no Hub signal | 🔴 | **idea-191 repo-event-bridge:** GH event → Hub → inbox-item to CODEOWNER (architect) | If PR open + no review > 30min in-session or 4h out-of-session → architect/Director inbox |
| 4.3 | Architect reviews PR on GitHub | GitHub event; no Hub signal | 🔴 | **idea-191:** GH event → Hub → inbox-item to PR author | If revision_required + engineer silent > SLA → architect inbox |
| 4.4 | PR auto-merges on green + approved | GitHub auto-merge (proposed policy) | 🔴 | **idea-191:** GH merge event → Hub → task-completion trigger → DAG cascade | — |
| 4.5 | Engineer submits Hub-side task report | `create_review` path on task report entity | 🟡 (manual) | On `task.needs_review`, fire inbox-item to mission.architect | If report unread > SLA → architect inbox |
| 4.6 | Architect reviews report (`create_review`) | Cascade: task→completed; DAG advance; mission-advancement cascade | 🟢 | — | — |
| 4.7 | Review `revision_required` → engineer revises | Dispatch `address_feedback` intent; inbox-item to engineer | 🟡 (requires session or drain) | Same, with in-session push where possible | revisionCount ≥ 3 → architect pool escalation (exists today) |

**The headline gap: transitions 4.2, 4.3, 4.4 are 100% off-Hub today.** idea-191 closes all three with one primitive.

### Phase 5 — Task completion + DAG cascade

| # | Transition | Today | Gap | Mechanised ideal | Escalation |
|---|---|---|---|---|---|
| 5.1 | Task `needs_review` → `completed` on approved review | Cascade (task-316) | 🟢 | — | — |
| 5.2 | DAG unblocks dependent tasks | Cascade | 🟢 | — | — |
| 5.3 | Mission plannedTask advancement (issued → completed → next issued) | Cascade (task-316 / idea-144 Path A) | 🟢 | — | — |
| 5.4 | All tasks complete → ready-for-report | **No event.** Engineer must notice. | 🔴 | On all-tasks-complete for mission, fire inbox-item to mission.engineer: "write mission report" | If mission has zero open tasks + no report > SLA → engineer inbox |

### Phase 6 — Reporting

| # | Transition | Today | Gap | Mechanised ideal | Escalation |
|---|---|---|---|---|---|
| 6.1 | Engineer authors closing report | Manual disk write at `docs/audits/m-<slug>-closing-report.md` | 🟡 (convention, no enforcement) | Hub-side report entity with status field + inbox trigger | — |
| 6.2 | Architect authors retrospective | Manual disk write at `docs/reviews/mission-<N>-retrospective.md` | 🟡 (convention) | Hub-side retrospective entity paired with mission | — |
| 6.3 | **Report submitted → architect notified** | **No event. Architect must poll or be in session.** | 🔴 | Report-submit fires inbox-item to mission.architect | If unread > SLA → Director inbox |
| 6.4 | **Review/retrospective submitted → engineer notified** | **No event.** Greg's phrase: "goes into a black hole." | 🔴 | Review-submit fires inbox-items to author + Director | If unread > SLA → Director inbox |

### Phase 7 — Close

| # | Transition | Today | Gap | Mechanised ideal | Escalation |
|---|---|---|---|---|---|
| 7.1 | Architect approves close | Manual | 🟡 (architect-gated precedent) | Retrospective-submit can stage `update_mission_status` cascade action | — |
| 7.2 | `mission.active` → `mission.completed` | `update_mission` status flip | 🟢 | — | — |
| 7.3 | **Mission completed → Director awareness** | **No event.** Director must notice. | 🔴 | Mission-completed fires Director inbox-item | — |

---

## 4. Synthesis — transitions by mechanisation class

| Class | Count | Notes |
|---|---|---|
| 🟢 Fully mechanised | ~11 | Phase 2 design, Phase 5 cascade, review-triggered cascades — these work today |
| 🟡 Partial / session-dependent | ~8 | Requires agent-in-session or drain-on-session-start |
| 🔴 Not mechanised | ~11 | The gap. Agents or Director must notice + act. |

The 🔴 transitions cluster in Phase 3 (activation), Phase 4 (PR/review/merge), and Phases 6-7 (reporting + close) — exactly the friction the Director named.

---

## 5. Missing primitives

Four primitives, each addressing a transition cluster:

### 5.1 State-transition triggers (idea-192)

Today every entity's status field changes passively — no typed event emits. Required primitive: every declared status transition fires a typed event with `{sourceState, targetState, entityRef, routedRoles, escalationPolicy}`. The cascade system already does this for certain transitions (review→task, convergence→mission); the primitive generalises it to *every* entity status change that has a downstream actor.

Closes: 3.2, 3.4, 4.5, 5.4, 6.3, 6.4, 7.3 (7 of 11 🔴 transitions).

### 5.2 Hub-side scheduled events (idea-192)

Today agents do brittle while/wait loops in-session to poll for conditions ("has greg responded yet?"). Required primitive: Hub accepts scheduled-event declarations — "fire X at T+N if Y still true." Enables timeout-based escalations as first-class without agent token burn.

Closes: all escalation policy columns above. Without this, escalation remains notional.

### 5.3 External-event ingestion (idea-191 repo-event-bridge)

PR/review/merge events live in GitHub; Hub is blind to them today. Required primitive: a pluggable event-source contract with poller (laptop-Hub, outbound-only) + webhook (future cloud-Hub) implementations, translating external events into Hub state-transition triggers.

Closes: 4.2, 4.3, 4.4 (the Phase 4 GH-blind transitions).

### 5.4 Session-wake (deferred — idea-121 territory)

Today notifications only reach agents in active Claude Code sessions. Inbox-drain-on-session-start (D in the 2026-04-25 discussion) bridges the offline case acceptably. Full mechanisation would include Hub-triggered session spawn. Out of scope for idea-191 + idea-192; tracked separately.

---

## 6. Duplicate primitives — rationalisation

Current delivery primitives (agent-adapter MCP surface):

| Primitive | Purpose | Delivery semantics |
|---|---|---|
| `notification` | Push to specific agent | Push, in-session preferred |
| `pending-action` | Queue item a role draws from | Pull, via `drain_pending_actions` |
| `director-notification` | Escalation to Director | Push to Director role |
| `turn` | Work-traced activity unit | Not a delivery primitive (orthogonal) |
| `thread` | Conversation grouping | Not a delivery primitive (orthogonal) |
| `audit-entry` | Write-only side-effect log | Not a delivery primitive (orthogonal) |

**Rationalisation:** `notification` + `pending-action` + `director-notification` collapse into one concept — **inbox-item** — routed to a role/agent target with a delivery-policy field (`push-immediate` / `queued` / `scheduled`). Push vs pull is a delivery mechanism, not a model distinction; Director is a role target, not a special primitive. Tool-surface verbs/envelopes defer to idea-121.

`turn`, `thread`, and `audit-entry` are orthogonal layers (activity / conversation / write-only log) — keep as-is.

**Net:** 3 → 1 on the delivery surface; 3 orthogonal layers unchanged.

---

## 7. Perfection — the end-state walkthrough

A mission progresses without any agent having to *check* state. Each state transition fires a typed event; each event routes to a role's inbox; each inbox-item carries an escalation policy; agents drain inbox on session-start and react to in-session pushes. *No polling. No while/wait loops. No "did greg see my review yet?"* Director appears only where escalation policy explicitly routes to Director — by design, not by "agents don't know what to do."

Illustrative mission walkthrough with idea-191 + idea-192 delivered:

```
Director seals mission design round → thread cascade fires propose_mission
  → mission.proposed → preflight cascade checks scope/owner → mission.active
  → inbox-item to engineer ("claim first task")
Engineer drains inbox → starts T1 → opens PR
  → repo-event-bridge polls GH → inbox-item to architect ("review PR")
Architect drains inbox → reviews on GitHub → review-submit
  → repo-event-bridge polls GH → inbox-item to engineer ("revise" or "merge-ready")
Engineer sees auto-merge land → repo-event-bridge → task-completion trigger
  → DAG cascade → next plannedTask issued → inbox-item to engineer
  (...loop T2-Tn...)
All tasks complete → trigger → inbox-item to engineer ("write mission report")
Engineer submits report → trigger → inbox-item to architect ("review report")
Architect submits retrospective → trigger → inbox-items to engineer + Director
Director acks → trigger → mission.active → mission.completed
  → inbox-item to Director ("mission closed")
```

Director touchpoints: mission-active activation (preflight sign-off) + mission-completed close. Both are decision points; neither is unblocking. Everything between is mechanised.

Failure modes become visible via escalation policies: if any inbox-item sits undrained past its SLA, the escalation fires — so *silent drift* becomes *explicit Director notification*. That's the structural shift from today's "discipline drifts under cadence" pattern.

---

## 8. Delivery path

Per Director direction 2026-04-25:

1. **Next engineer mission:** idea-190 M-Local-FS-Cutover. No workflow-primitive dependency.
2. **After local-fs cutover ships:** design rounds for idea-191 (repo-event-bridge) + idea-192 (hub-triggers-inbox), informed by this audit doc. These are co-dependent: bridge fires *into* the inbox; can ship partial with stub sink, or sequence inbox primitive first.
3. **Session-wake (idea-121 territory):** remains deferred.

This doc is the sizing input for both idea-191 and idea-192 design rounds. Revise this doc as those design rounds surface refinements — treat it as the living primitive-requirement reference, not a one-shot ratified spec.

---

## 9. Open questions for next design rounds

For idea-192 (hub-triggers-inbox) design round:
- Escalation policy shape: attached to transition definition or attached to inbox-item? (Probably transition; agents shouldn't set policies.)
- Scheduled-event granularity + persistence model: per-event record or derived from entity state? (Leaning derived where possible; persist where conditional re-evaluation is non-trivial.)
- Inbox-item retention after drain: keep with acked status for audit? (Probably yes — eats existing pending-action ADR-017 `receipt_acked`/`completion_acked` pattern.)

For idea-191 (repo-event-bridge) design round:
- Polling cadence: constant vs adaptive (bursty around known activity)?
- Failure semantics: GH API rate-limit hit → queue vs drop?
- Authentication: PAT vs GitHub App — security/permissions trade-off.
- Cursor storage: per-repo or per-event-type?

For idea-197 (Hub auto-redeploy on main-merge) design round:
- Per-deployment-pattern policy: Cloud Run auto-deploys cleanly; laptop-Hub needs operator-confirmation per ADR-024 §6.1 single-writer-prod posture. Hybrid model.
- Notification path on build success/failure: Hub director-notification entity, Slack/email, or merge-PR-comment.
- Image-tagging discipline (SHA + branch + latest) for pin-to-build rollback path.
- Sequencing with bug-33 fix — auto-deploys would propagate the bug-33 trap class until that lands.

For idea-196 (Hub state backup cadence) design round:
- Source-of-truth framing: GCS as live mirror (any divergence is a problem) vs drift-tolerant archive (divergence is expected, sync is intentional). Load-bearing decision.
- Cadence model: on-mission-close, periodic, manual-only, event-driven. Each maps to different operator-experience tradeoffs.
- Retention: rolling-latest vs versioned/dated archives.
- Multi-machine coordination: state-sync.sh from a different worktree → divergence risk.

---

## 10. Mission-coordination patterns observed (mission-48 + mission-49 carry-forward)

### 10.1 Thread round-limit hits at maxRounds=10 in active per-PR coordination missions

Observed mission-48: thread-306 hit `round_limit` (auto-escalation) at PR #27 announce — mid-mission, blocking architect reply. Mission needed thread rotation (thread-306 → thread-307) to continue T3+T4 coordination.

**Heuristic for thread maxRounds at open time** (proportional to expected exchange volume):
- Design-round threads: 10 default — usually 2-4 rounds, 10 is safe
- Per-task PR-coordination threads: ~2× task count + 4 (for setup/seal); a 6-task mission needs `maxRounds=20`
- Default 10 is too low for >3-task PR-coordination missions

**Until tooling supports infinite-rounds or transparent-rotation:** set `maxRounds=20` at open-time for per-PR coordination threads in 4+ task missions, OR plan rotation at the halfway boundary explicitly.

**Idea-192 (Hub triggers + inbox) scope implication:** the workflow-primitive thread should not have a fixed round cap, OR rotation should be transparent. Capture as design-input.

### 10.2 ADR-amendment scope discipline

Mission-48 T1 amended ADR-024 with §6.1 reclassifying local-fs from dev-only to single-writer-laptop-prod-eligible. **The amendment was deployment-context reclassification, NOT a contract change.** The 6-primitive surface, capability flags, CAS semantics — all unchanged.

**Methodology rule (architect-voice clarification):** ADR amendments classified by *what they change*:
- Contract-change amendments require a new ADR (or numbered version-bump per project convention)
- Deployment-context amendments (where to use the contract, under what operational discipline) sit cleanly as in-place §Amendments sections on the existing ADR

The distinction matters because future architects auditing an ADR should be able to tell instantly: was the contract modified? Was deployment scope expanded? Both have different forward-compatibility implications.

### 10.3 Bug-31 cascade-bookkeeping bypass via skip-plannedTasks

Observed mission-49 (3 cascade duplicates fired with plannedTasks set) vs mission-48 (zero cascade duplicates with plannedTasks deliberately skipped). Demonstrated bypass technique: activate mission with no plannedTasks; manually create_task per task as prior approves. Mission entity description retains full task plan (already captured from propose_mission cascade) — plannedTasks visibility was redundant.

**Standing technique** until bug-31 lands a fix. Documented in `feedback_plannedtasks_manual_create_mismatch.md` memory.

---

## 11. Change log

| Date | Change |
|---|---|
| 2026-04-25 | v0.1 draft (architect lily). Follows Director discussion in mission-47 retrospective. Companion to ideas 190, 191, 192, 193. |
| 2026-04-25 | v0.2 amendment — added §10 mission-coordination patterns from mission-48 + mission-49 carry-forwards (thread round-limit, ADR-amendment scope, bug-31 bypass); added open-question rows for ideas 196 + 197. |
