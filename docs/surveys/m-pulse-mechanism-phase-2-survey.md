# M-Pulse-Mechanism-Phase-2 — Director-intent Survey (pre-Design input)

**Status:** Ratified 2026-04-30 (Round 1 + Round 2 Director picks complete)
**Methodology:** `docs/methodology/idea-survey.md` v1.0 — first-class binding Idea→Design triage methodology
**Source idea:** idea-224 M-Pulse-Mechanism-Phase-2 (Hub-stored; Director-originated; status=triaged)
**Triage route:** route-(a) skip-direct per `strategic-review.md` §Idea Triage Protocol (Director-originated + scope concrete + no contest + tele-aligned + single-mission-shape)
**Survey execution:** Round 1 paused mid-session for mission-67 sidebar; resumed + completed post-mission-67 close

---

## §1 Survey methodology recap

Per `idea-survey.md` v1.0: 3+3 Director-pick session across two rounds; architect interprets per multi-dim-context (original idea + tele mapping + aggregate Director response surface); composite intent envelope bounds Phase 4 Design scope.

**Director time-cost:** ~5 minutes across 2 picking rounds (post-pause resumption).

**Calibration data-point sources** (from M66 + M67 history; this Survey-set composes their closure):
- `#50` mission-wide-vs-per-agent precondition gap
- `#51` interval defaults miscalibrated for L-class W1+W2 atomic
- `#52` phase-aware pulse content gap
- `#53` cross-pulse coordination gap
- `#54` commit-push visibility gap
- `#55` engineer-cadence-discipline anti-pattern (silent between-commit pause)
- `#56` pulse defaults too complex; simpler + shorter + unified preferred

---

## §2 Round 1 — Guide intent space

### Q1 — Primary closure target (WHY axis)

**Director pick: d (primary) + a + c (multi-pick; priority-ordered)**

- ✅ **(a) Simplification-first** — close #56 unifying frame
- ❌ (b) Per-agent-idle accuracy — close #50; **explicitly NOT picked** (deferred to idea-225 TTL Liveliness)
- ✅ **(c) Faster missed-detection** — close #51 + #53; shorter pulse + cross-pulse coord
- ✅ **(d-primary) Engineer-cadence-discipline mechanization** — close #55; thread-heartbeat + retire silent-between-commit-pause anti-pattern

### Q2 — Mission-class taxonomy fate (HOW-structure axis)

**Director pick: a (single)**

- ✅ **(a) Eliminate class-based defaults entirely** — missions declare cadence explicitly OR get unified-per-role defaults
- ❌ (b) Reduce to 2 templates (active-phase / closing-phase)
- ❌ (c) Keep class taxonomy; just shorten + simplify defaults
- ❌ (d) Per-wave templates inside class

### Q3 — Precondition layer fate (HOW-mechanism axis)

**Director pick: a (single)**

- ✅ **(a) Remove precondition layer entirely** — fixed-interval fires unconditionally; precondition becomes vestigial
- ❌ (b) Replace mission-wide with per-agent-idle predicate
- ❌ (c) Keep both predicates; fixed-interval default but precondition opt-in
- ❌ (d) Remove from default; keep registry available for explicit opt-in

**Director rationale (Q3a):** "we should tackle TTL conditions before tweaking" — explicit **tele-8 Gated Recursive Integrity** sequencing rationale: don't build per-agent-idle predicate (Layer N+1) before TTL liveliness substrate (Layer N) exists per idea-225.

---

## §3 Round 1 — Architect interpretation (per-question multi-dim context)

### §3.1 Q1 (d primary + a + c) — engineer-cadence-discipline as load-bearing axis

**Original Idea grounding:** idea-224 text states "standardise the pulse mechanism and move to shorter times - i.e 10 mins for engineer, and 20 for architect" — Q1 picks confirm + extend: WHY this hardening is engineer-cadence-discipline-driven, not just cadence-tuning.

**Tele mapping for Q1:**
- (d) Engineer-cadence-discipline mechanization → **tele-2** Isomorphic Specification (mechanize methodology) + **tele-7** Resilient Agentic Operations (silent-stop class closure)
- (a) Simplification-first → **tele-3** Sovereign Composition (one concern per module) + **tele-11** Cognitive Minimalism (less LLM-context overhead per pulse)
- (c) Faster missed-detection → **tele-7** Resilient Agentic Operations (faster actionable feedback)

**Aggregate-context interpretation:** Director's pick-order (d > a > c) signals build-for-#55-closure-first (engineer-cadence-discipline). Closing #55 (engineer-stop discipline) restores bilateral coordination integrity that was the ROOT pain in mission-66 W1+W2 atomic execution. Q2(a) eliminate-class-defaults + Q3(a) remove-precondition compose with simplification-first naturally — together they strip 2 layers of complexity (per-class defaults + precondition predicate registry) while preserving the pulse-fire core. Engineer-cadence-discipline mechanization is the methodology-fold layer ON TOP of the simplified mechanism.

### §3.2 Q2 (a) — eliminate class-based defaults entirely

**Original Idea grounding:** Director's pre-Survey scope direction said "10 mins for engineer, and 20 for architect" — unified per-role defaults; pre-pre-supposed Q2(a)-style elimination of per-class taxonomy.

**Tele mapping:**
- (a) Eliminate → **tele-3** Sovereign Composition (no taxonomy clutter; pulse mechanism owns one concern: fire-on-schedule) + **tele-2** Isomorphic Specification (declarative-explicit > convention-implicit) + **tele-11** Cognitive Minimalism (simpler mental model)

**Aggregate-context interpretation:** the 8-class taxonomy in `mission-lifecycle.md` §4.1 driving pulse defaults dies. `missionClass` field continues existing for retrospective + portfolio-balance scoring, but no longer drives pulse cadence — clean separation of concerns. Missions either declare `pulses` config explicitly OR get unified-per-role defaults (Q5(a) refines specifics: 10/20). Q1(a) simplification-first reinforces; Q3(a) precondition-removal compounds simplicity. Together: pulse mechanism = "fires on schedule unless mission opts out". No precondition predicates; no per-class defaults; just intervals + messages + responseShapes.

### §3.3 Q3 (a) — remove precondition layer entirely

**Original Idea grounding:** Director's pre-Survey direction said "default to be a fixed interval, rather than adaptive with idle times" — confirmed by Q3(a) elimination of precondition predicate entirely.

**Tele mapping:**
- (a) Remove → **tele-3** Sovereign Composition (one concern: fire-on-schedule) + **tele-2** Isomorphic Specification (single canonical behavior) + Director-flagged sequencing → **tele-8** Gated Recursive Integrity (Layer N+1 not built before Layer N substrate exists)

**Director's "tackle TTL conditions before tweaking" rationale = tele-8 in action.** Don't build per-agent-idle predicate (Layer N+1) on top of mission-wide-idle predicate (Layer N) when the proper substrate (TTL liveliness signals from adapter healthcheck + cognitive activity-tracking) hasn't been designed yet (idea-225 territory). Tele-8 sequencing-decision elevates idea-225 from companion-parked to substrate-prerequisite for any future per-agent-idle predicate work.

**Aggregate-context interpretation:** `mission_idle_for_at_least` predicate goes away; `precondition` field on PulseConfig schema removed (or marked vestigial). Pulse fires on schedule unconditionally. Per-agent-idle work composes via idea-225 TTL Liveliness AFTER substrate exists.

**Cross-question coherence check (Round 1):** ✓ All 3 picks compose into clean simplification-with-mechanization mission. No internal contradictions.

---

## §4 Round 2 — Drill into HOW

### Q4 — Engineer-cadence-discipline mechanization scope

**Director pick: d (single)**

- ❌ (a) Methodology-doc fold only
- ❌ (b) Methodology fold + adapter-side commit-push hook
- ❌ (c) Methodology fold + Hub-side commit-push event consumption
- ✅ **(d) All 3 layers (a + b + c) — full mechanization stack**
- ❌ (e) Defer mechanization layers to idea-227

### Q5 — Cadence default values

**Director pick: a (single)**

- ✅ **(a) 10min engineer / 20min architect** per pre-Survey idea-224 scope (unified per-role defaults)
- ❌ (b) Single unified interval for both roles
- ❌ (c) No defaults — missions MUST declare `pulses` explicitly
- ❌ (d) Different defaults per role; values TBD

### Q6 — Cross-pulse coordination (#53 closure scope)

**Director pick: d (single)**

- ❌ (a) In-scope this mission — Hub-side cross-pulse evaluation
- ❌ (b) Methodology-fold only
- ❌ (c) Defer to idea-227 hook design
- ✅ **(d) Out-of-scope; #53 superseded by Q3a + Q1c** — claim: removal-of-precondition + faster-missed-detection structurally address same friction at substrate level

---

## §5 Round 2 — Architect interpretation (per-question multi-dim context)

### §5.1 Q4 (d) — all 3 mechanization layers

**Tele mapping:**
- (a) methodology fold → **tele-2** Isomorphic Specification (spec-as-system) + **tele-4** Zero-Loss Knowledge (load-bearing context)
- (b) adapter-side hook → **tele-11** Cognitive Minimalism (mechanize deterministic git-push detection)
- (c) Hub-side commit-push event → **tele-1** Sovereign State Transparency (Hub sees GH events) + **tele-7** Resilient Agentic Operations (actionable feedback)

**Aggregate-context interpretation:** Director picking (d) over (e/defer) signals high-conviction on full-stack engineer-cadence-discipline mechanization. Maps tightly to Q1(d) primary outcome — mechanizing #55 closure requires substrate at all 3 layers (methodology declaration + adapter-detection + Hub-side event consumption). Defer-to-idea-227 (option e) was rejected — Director wants this mission to ship the mechanization, not just the doc-substrate.

**⚠️ Architect-flag for Phase 4 Design (sequencing surface — RESOLVED post-Survey):** Q4(c) "Hub-side commit-push event consumption" was initially flagged as implying dependency on **idea-191 repo-event-bridge** (per `mission-lifecycle.md` §A 5.3 — forward primitive). Three paths considered (Path A: idea-191 first / Path B: absorb / Path C: interim hook).

**Reality check (architect-discovered post-initial-Survey-publish):** **idea-191 substrate ALREADY SHIPPED via mission-52.** The `@apnex/repo-event-bridge` package exists at `packages/repo-event-bridge/` (1599 LoC across 7 src files; T1 contract + T2 PollSource + T3 Hub integration). Crucially: `REPO_EVENT_SUBKINDS` includes `commit-pushed` (exactly the subkind idea-224 Q4(c) needs); `hub/src/policy/repo-event-handler.ts` wires PollSource → CreateMessageSink → in-process Hub create_message dispatch; activation via env vars (`OIS_GH_API_TOKEN` + `OIS_REPO_EVENT_BRIDGE_REPOS`).

**Sequencing decision REVISED:** Path A dissolves — substrate exists; idea-224 Phase 4 Design proceeds DIRECTLY (no HOLD). Q4(c) implementation = subscribe to existing `commit-pushed` events from `RepoEventBridge` + emit pulse-related notifications/actions.

**Methodology data-point captured (`normative-doc-divergence` second-canonical instance):** Hub Idea entity idea-191 was status=open + missionId=null even though mission-52 shipped the substrate (README explicit: "Mission-52 deliverable; design ratified at thread-312 round 2 2026-04-25"). Three normative sources disagreed: (1) Hub entity = open; (2) `mission-lifecycle.md` §A 5.3 = forward primitive; (3) packages/repo-event-bridge/ + Hub integration = shipped. Ledger-vs-shipped-reality variant of calibration #58. Closure: idea-191 flipped to status=incorporated + missionId=mission-52 (architect-Responsibility per Idea entity FSM authority).

### §5.2 Q5 (a) — 10min engineer / 20min architect per-role defaults

**Tele mapping:** **tele-3** + **tele-2**.

**Aggregate-context interpretation:** Confirms pre-Survey idea-224 scope direction. Unified per-role defaults; no per-class taxonomy. Default-injection at `create_mission` validation; **architect-flag for Phase 4 Design (backward-compat surface):** Q5(a) creates ambiguity vs ADR-027 §6 backward-compat row (legacy missions without `missionClass` = NO auto-pulses). Three interpretations:
- **NEW missions only (architect-recommended)** — preserve legacy-no-pulses for active/proposed at-flip-time; opt-in via mission-update for those that want it
- **All missions retroactive** — every mission post-this-mission gets 10/20 defaults unless explicit override (significant behavior change for active missions)
- **Opt-in flag** — explicit field on `create_mission` enables defaults

Phase 4 Design ratifies. Architect-recommendation: **NEW missions only**.

### §5.3 Q6 (d) — #53 out-of-scope; structurally superseded

**Tele mapping:** **tele-3** Sovereign Composition (one-concern; pulse mechanism stays simple) + **tele-8** Gated Recursive Integrity (Director-flagged structural-substitution > feature-add).

**Aggregate-context interpretation:** Director's claim — Q3(a) (remove precondition) + Q1(c) (faster intervals) substitute for cross-pulse coord. Logic:
- No precondition → pulses fire on schedule (no skipping due to mission-wide-active state)
- 10min eng + 20min arch + missedThreshold=3 → 30min engineer-pulse to escalate; 60min architect-pulse to escalate
- Director observes engineer-silent state via mission-state inspection (e.g., `get_agents` CLI showing engineer activityState)

**⚠️ Architect-flag for Phase 4 Design (missedThreshold default surface):** `missedThreshold` default value (currently 3 per ADR-027) not explicitly addressed in Round 2. Reducing to 1 or 2 closes #53 friction further (cuts time-to-detection in half). Phase 4 Design candidate for refinement; architect-recommendation: reduce to **2** (balance: faster detection vs spurious-escalation tolerance).

**Cross-question coherence check (Round 1 + Round 2):** ✓ All 6 picks compose coherently. Q1(d) primary + Q4(d) full-stack mechanization = high-conviction on engineer-cadence-discipline as load-bearing. Q1(a) + Q2(a) + Q3(a) = consistent simplification. Q1(c) + Q5(a) 10/20 + Q6(d) structural-supersession = faster-missed-detection via cadence rather than cross-pulse coord. Q3(a) tele-8 sequencing + Q6(d) structural-supersession = both apply tele-8 (build minimum-substrate; defer feature additions).

---

## §6 Composite intent envelope (the "solved matrix")

Bounds Phase 4 Design scope:

| Axis | Director-ratified bound |
|---|---|
| **Mission scope** | (1) Strip class-based defaults from pulse substrate; (2) Strip precondition predicate layer; (3) Mechanize engineer-cadence-discipline via 3-layer stack (methodology + adapter-hook + Hub-side commit-push event); (4) Default 10/20min unified per-role |
| **Mission class** | `substrate-introduction` (revised post-Round-2; Q4d 3-layer stack is substrate-grade) |
| **Primary outcome** | Engineer-cadence-discipline mechanization (#55 closure; Q1d primary) — restore bilateral coordination integrity |
| **Secondary outcomes** | Simplification (#56 closure via Q1a + Q2a + Q3a); faster missed-detection (#51 + #53 closure via Q1c + Q5a 10/20 cadence) |
| **Tele alignment (primary)** | tele-2 Isomorphic Specification + tele-7 Resilient Agentic Operations + tele-11 Cognitive Minimalism + tele-3 Sovereign Composition |
| **Tele alignment (secondary)** | tele-1 Sovereign State Transparency + tele-4 Zero-Loss Knowledge + tele-8 Gated Recursive Integrity (Director-flagged sequencing) |

---

## §7 Anti-goals (explicit out-of-scope)

| # | Anti-goal | Reviewer-test | Composes with |
|---|---|---|---|
| AG-1 | NOT per-agent-idle predicate work | Future-PR adds `agent_idle_for_at_least` predicate or any per-agent-idle gating → flag scope-creep | idea-225 M-TTL-Liveliness-Design (substrate prerequisite for per-agent-idle) |
| AG-2 | NOT phase-aware pulse content (#52) | Future-PR adds W0/W1+W2/W3/W4 pulse-content variation → flag scope-creep | Phase-N revisit (open future-mission OR retrospective-fold) |
| AG-3 | NOT cross-pulse coordination mechanization (#53) | Future-PR adds architect-pulse-checks-engineer-pulse-state logic → flag scope-creep | #53 superseded structurally by Q3a + Q1c; reopen if structural-supersession proves insufficient post-ship |
| AG-4 | NOT idea-191 repo-event-bridge scope inflation | Future-PR absorbs full idea-191 event-bridge primitive into this mission scope → flag scope-creep | Path A sequencing — idea-191 separate prerequisite mission |
| AG-5 | NOT tool-surface scope | Future-PR introduces new tool verbs / envelope shapes → flag scope-creep | idea-121 (API v2.0) |
| AG-6 | NOT pulse-primitive substrate replacement | Future-PR replaces ADR-027 PulseSweeper / Mission entity pulses[] schema → flag scope-creep | This mission EXTENDS / SIMPLIFIES the existing substrate; doesn't replace it |

---

## §8 Phase-N revisit-axes (preserved for forward composition)

| Axis | Phase-N venue |
|---|---|
| Per-agent-idle predicate | idea-225 M-TTL-Liveliness-Design (composes; tele-8 sequencing dependency) |
| Phase-aware pulse content (#52) | Open future-mission OR Phase 10 retrospective-fold |
| Cross-pulse coordination (#53) | Reopen IF Q3a + Q1c structural-supersession proves insufficient post-ship |
| Hub-side commit-push event consumption | idea-191 repo-event-bridge (Path A prerequisite) |
| Pulse cadence per-context refinement | Future-mission if 10/20 defaults prove suboptimal across mission classes |

---

## §9 Architect-flags batched for Phase 4 Design (3 ratification surfaces)

To resolve at Phase 4 Design (bilateral architect-engineer):

1. **Q4(c) sequencing decision** — Path A (idea-191 first) **vs** Path B (absorb) **vs** Path C (interim hook). **Director-ratified post-Survey: Path A.** Phase 4 Design HOLDS pending idea-191 readiness.
2. **Q5(a) backward-compat scope** — NEW missions only **vs** all missions retroactive **vs** opt-in flag. Architect-recommendation: NEW missions only.
3. **Q6(d) missedThreshold default** — preserve at 3 **vs** reduce to 1-2. Architect-recommendation: reduce to 2.

---

## §10 Mission sequencing decision (REVISED post-Survey-amendment 2026-04-30)

**Initial Director directive 2026-04-30 ("Agree that we surface idea 191 as pre-requisite. Can hold on 224 design until ready") superseded by architect-discovered substrate-already-shipped state.**

**Revised sequencing:**

- **idea-224 Phase 4 Design proceeds DIRECTLY** — no HOLD; substrate (mission-52 repo-event-bridge) already exists; Q4(c) implementation subscribes to existing `commit-pushed` events
- **idea-191 status flipped** to `incorporated` + missionId=mission-52 (architect-direct ratification per Idea entity FSM authority; closes ledger-vs-shipped-reality divergence)
- **Forward composition:** idea-224 Phase 4 Design + Phase 5 Manifest + Phase 6 Preflight + Phase 7 Release-gate + Phase 8 Execution + Phase 9 Close

**Revised mission cluster sequencing:**

1. **idea-224** M-Pulse-Mechanism-Phase-2 (THIS mission; ready for Phase 4 Design when Director go-signals; substrate = mission-52 repo-event-bridge)
2. **idea-225** M-TTL-Liveliness-Design (composes per-agent-idle work post-224)
3. **idea-227** M-Hook-Design-End-to-End (parked; consumes 224 substrate + complements idea-228)
4. **idea-228** M-Survey-Process-as-Skill (filed; runtime-mechanization sister; independent)

**Methodology lesson captured:** `normative-doc-divergence` second-canonical instance (ledger-vs-shipped-reality variant). Closure-mechanism candidate (b) "cross-reference audit at retrospective gates" applied — architect should verify ledger-vs-shipped state via grep `packages/`/`hub/` BEFORE assuming forward-architecture references in `mission-lifecycle.md` §A reflect current state. Composes with calibration #58 closure-mechanism for forward-mechanization (idea-227 hook scope).

---

## §11 Cross-references

- **`docs/methodology/idea-survey.md`** v1.0 — Survey methodology canonical reference
- **`docs/methodology/mission-lifecycle.md`** v1.2 — Phase 4 Design RACI + §4 Pulse coordination spec + §A Lifecycle audit (idea-191 + idea-192 forward primitives)
- **`docs/methodology/strategic-review.md`** §Idea Triage Protocol — route-(a) skip-direct used for this mission's triage
- **`docs/decisions/027-pulse-primitive-and-pulsesweeper.md`** — existing pulse substrate (ADR-027); this mission EXTENDS + SIMPLIFIES (NOT replaces)
- **idea-224** Hub Idea entity (status=triaged) — concept-level scope this Survey anchors
- **idea-191** repo-event-bridge — prerequisite per Path A sequencing (Director-ratified)
- **idea-225** M-TTL-Liveliness-Design — companion (per-agent-idle work composes here per tele-8 sequencing)
- **idea-227** M-Hook-Design-End-to-End — forward composition (consumes 191+224 substrates)
- **Calibrations #50-#56** — closure-target set for this mission (per §6 composite envelope)
- **Calibration #59 `bilateral-audit-content-access-gap`** — closure mechanism applied: Survey artifact branch-pushed BEFORE Phase 4 bilateral round-1 audit (anticipatory; not yet Phase 4 since holding)

---

— Architect: lily / 2026-04-30
