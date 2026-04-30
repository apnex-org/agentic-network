# M-Mission-Pulse-Primitive — Director-intent Survey (pre-Design input)

**Status:** Ratified 2026-04-26
**Methodology:** First canonical execution of `feedback_director_intent_survey_process.md` — Director-intent Survey precedes Design phase
**Source idea:** idea-206 M-Mission-Pulse-Primitive (Hub-stored; concept-level)

---

## Survey methodology recap

Per Director ratification 2026-04-26 post-mission-56 retrospective close, **Idea→Design transition gains a Survey step**. Architect asks Director 3+3 short orthogonal pick-list questions; Director picks pre-determined answers (single or multi-pick); output anchors pre-Design intent. Design phase then proceeds primarily architect+engineer (Director re-engages at preflight + release-gate + retrospective).

Director re-ratified post-this-execution: *"That was a good process for refining director intent. We will use (and refine this) process as a first class methodology for triaging raw ideas ready for technical design."*

This Survey was the **first canonical execution**. Director time-cost: ~3-5 minutes across 2 picking rounds.

---

## Round 1 — Guide intent space

### Q1 — Primary outcome priority for pulse

**Director pick: A + C (multi-pick)**

- ✅ **(a) Coordination latency reduction** — faster architect-engineer cycle times; replace residual ping discipline; compose with push pipeline
- ❌ (b) Director observability — derivative outcome, not primary
- ✅ **(c) Stuck-mission prevention** — regular check-ins prevent silent stalls; engineer/architect missed-response surfaces as Hub state
- ❌ (d) All of the above (comprehensive; equal weight) — explicitly NOT chosen; outcome priority is focused

### Q2 — Who should pulse target

**Director pick: B + D (multi-pick)**

- ❌ (a) Engineer only
- ✅ **(b) Engineer + architect** — both on-mission roles get role-appropriate pulses
- ❌ (c) Engineer + architect + Director-watchdog — **Director-watchdog OUT** for this mission
- ✅ **(d) Configurable per mission** — mission entity declares pulse-targets; defaults exist but mission can override

### Q3 — How should pulse cadence be determined

**Director pick: C (single)**

- ❌ (a) Per-role static defaults (Hub-coded)
- ❌ (b) Per-mission-class adaptive
- ✅ **(c) Per-mission declared** — mission entity carries pulse config; architect declares at Design time; Hub honours
- ❌ (d) Hub-derived adaptive

---

## Round 2 — Refine architect interpretation

### Q4 — Pulse response shape

**Director pick: D (single)**

- ❌ (a) Ack-only
- ❌ (b) Short status
- ❌ (c) Full status
- ✅ **(d) Configurable per mission** — some pulses ack-only; others require structured status; mission entity declares per-pulse-shape

### Q5 — Missed-pulse-response handling

**Director pick: B (single)**

- ❌ (a) Silent retry
- ✅ **(b) Architect-side escalation** — after 2-3 missed pulses, architect surfaces "engineer is silent" to Director per categorised-concerns table
- ❌ (c) Hub-state-only (no auto-escalation)
- ❌ (d) Configurable per mission (different escalation thresholds per mission class)

### Q6 — Per-mission pulse config persistence location

**Director pick: D (single)**

- ❌ (a) Mission entity only (= same as d, just emphasized)
- ❌ (b) Design document only
- ❌ (c) Both — mission entity + Design doc
- ✅ **(d) Mission entity ONLY** — Design doc references but doesn't duplicate; runtime config canonical at mission entity

---

## Composite intent envelope (anchored)

**Mission entity is the single canonical declarative surface for ALL pulse config** — targets + cadence + per-pulse response shape + missed-response thresholds. Hub honours; engineer + architect adapters consume; Design doc documents WHY without duplicating runtime config.

**Pulse drives BOTH outcomes:**
- **Coordination latency reduction** (interactive responses for active phase via push-immediate Message delivery)
- **Stuck-mission prevention** (missed-response detection + architect-side escalation after 2-3 missed pulses)

**Director-watchdog OUT** for this mission. Director observability is derivative — achievable by querying mission state, but pulse isn't routed to Director.

**Stuck-detection routes via architect → Director** per categorised-concerns table; preserves mediation invariant.

**Per-mission flexibility everywhere** (Q2D + Q3C + Q4D + Q6D) — no baked-in defaults at Hub level. Per-mission-class default templates emerge as conventions in `mission-lifecycle.md` v1.0, NOT as Hub primitives.

---

## Survey calibration data point (first canonical execution)

| Metric | Mission-56 Design phase (no Survey) | idea-206 Survey (this execution) |
|---|---|---|
| Director time-cost | ~3 hours (section-by-section walkthrough) | ~3-5 minutes (6 pick-list answers) |
| Architect-interpretation discipline | Free-form intent extraction | Forced enumeration of 18 distinct option-points pre-Director-surface |
| Multi-pick handling | Not applicable | Supported naturally (Q1+Q2 had two-answer picks) |
| Director-as-watchdog risk | Higher (long arc; many touchpoints) | Lower (concentrated at Idea phase; Director out of Design mechanics) |

**Refinement folded back into methodology:** multi-pick option (Director picked A+C, B+D rather than single answers) worked naturally; methodology doc updated to formally allow multi-pick when answers are non-mutually-exclusive.

---

## Cross-references

- **`feedback_director_intent_survey_process.md`** (architect memory) — methodology doctrine; first-class binding per Director ratification
- **idea-206 M-Mission-Pulse-Primitive** (Hub Idea entity) — concept-level scope this Survey anchors
- **`docs/designs/m-mission-pulse-primitive-design.md`** (Design v0.1+) — Design phase output; consumes this Survey envelope
- **mission-56 retrospective §4.1.1** — mechanise+declare doctrine; Survey realizes it for intent capture
- **mission-56 retrospective §7.5** — forward tele-9 advance; pulse primitive realizes
- **mission-56 retrospective §5.4.1** — mission-class taxonomy; consumed by mission-lifecycle.md v1.0 default-cadence-per-class table

— Architect: lily / 2026-04-26
