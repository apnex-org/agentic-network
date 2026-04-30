# M-Agent-Entity-Revisit — Survey artifact (complete archival record)

**Status:** Round 1 + Round 2 complete; composite intent envelope ratified by Director picks; pre-Design input
**Idea:** idea-215 (subsumes idea-106; cascade-includes today's note-kind primitive gap Idea)
**Date:** 2026-04-27
**Architect:** lily
**Director time-cost:** ~3 minutes (6 picks across 2 rounds)
**Methodology version:** docs/methodology/idea-survey.md v1.0 (Director-ratified 2026-04-26)

---

## §A Pre-anchor (per §9 step 1)

### Idea-anchor (carry-forward context across both rounds)

idea-215 — Agent entity field redesign + status FSM + live queryability across the Hub API for any connected agent. Director-requested 2026-04-27 post-mission-61 close. Subsumes idea-106 (Agent.status FSM split, narrower scope). Director's clarification 2026-04-27: the entity must be live + queryable by any connected agent via the Hub API — primary intent, not passive field-set redefinition. Director naming hint: likely target rename `get_engineer_status` → `get_agents` (informational; final form defers to idea-121).

### Tele inventory (relevant candidates pre-Round-1)

- **tele-3 Absolute State Fidelity** — Hub's view of every agent matches reality at query-time
- **tele-7 Resilient Operations** — richer FSM enables better routing + escalation discrimination
- **tele-2 Frictionless Agentic Collaboration** — operators (Director, peer agents) see who's available without inference
- **tele-12 Hydration-as-Offload** — adapter local cache pre-hydrated from Hub state (tertiary candidate)
- **tele-6 Deterministic Invincibility** — emerged Round 1 (atomic-landing discipline)

### Tele weighting — Round 1 hypothesis (pre-picks)

- **Primary: tele-3 Absolute State Fidelity** — the queryable-live intent maps directly here
- **Secondary: tele-7 Resilient Operations**
- **Tertiary: tele-2 Frictionless Agentic Collaboration**

Hypothesis was "the queryable-live aspect dominates" — turned out wrong on weighting (tele-7 was promoted Round-1→Round-2; see §B.4 + §C.4 anti-drift checks).

### Tele weighting — refined post Round 2

- **Primary: tele-7 Resilient Operations** (promoted; routing intelligence + push-cache-coherence dominant value per Director picks)
- **Secondary: tele-3 Absolute State Fidelity** (state-fidelity across all bundled surfaces)
- **Secondary: tele-6 Deterministic Invincibility** (atomic-bundle + symmetric Hub/SDK rename + anti-Layer-3-shim)
- **Tertiary: tele-2 Frictionless Agentic Collaboration** (downstream foundation; note-kind delivery enables peer-comms)

---

## §B Round 1 — WHY / WHO / HOW-cadence

### §B.0 Round 1 question-design rationale (per §9 step 2)

Round 1 anchors the highest-level intent dimensions per §3 ("Round 1 typically anchors WHY/WHO/HOW-cadence dimensions"). My partition of intent space:

- **Q1 (WHY)** — what value does this mission unlock? Discriminates between operator-UX value vs agent-coordination-substrate value vs troubleshooting value vs downstream-foundation value. Each option maps to a different tele primary (A→tele-3 operator, B→tele-7 routing, C→tele-3+7 hybrid, D→tele-2 future). Multi-pick natural — Director may want all four; that's a valid constraint envelope.
- **Q2 (WHO)** — who is the primary consumer? Discriminates between Director-first dashboard vs architect-first routing vs engineer-first introspection vs symmetric-self-introspection. Different priorities steer surface shape: Director-first → flat dashboard; architect-first → routing-optimized primitives; engineer-first → rich self-state; symmetric → for-me-and-others as one canonical surface. Multi-pick natural; conflicts surface real tradeoffs (Director-flat vs engineer-rich isn't co-satisfiable trivially — Design resolves).
- **Q3 (HOW-cadence)** — what's the rollout shape + coupling stance? Discriminates atomic-mega-PR vs incremental vs idea-121-coupled vs substrate-cleanup-wave-bundled. Privileges different qualities: A→target-state crispness; B→fast incremental Director-visible value; C→coherence-with-idea-121; D→atomic-substrate-coherence. Multi-pick natural; e.g., A+D = "single mega-PR but bundled with bug-35 + idea-106 cleanup".

Answers designed orthogonal where natural (per §6 multi-pick discipline).

### §B.1 Q1 — WHY: primary value driver(s)

**Question:** What value(s) do you most want this mission to unlock?

- A. Operator visibility — Director sees who's online + idle + working at-a-glance, agent-by-agent
- B. Routing intelligence — peer agents (architect picks recipients; pulse sweeper picks escalation targets) can prefer-idle, distinguish stuck-from-dead, rate-limit-aware
- C. Troubleshooting clarity — PID + IP + adapter-version + recent-errors visible when a session misbehaves
- D. Foundation for downstream agent-coordination primitives — future Hub features (pulse-routing, multi-agent-orchestration, agent-pool-elasticity) build on top

**Director picks:** **B + C + D** (A declined)

**Per-question interpretation (per §9 step 5; multi-dim context):**

> *Idea-anchor:* agent-state as queryable substrate.
> *Aggregate-surface (Round 1):* this mission feeds *agents*, not Director.
> *Tele mapping:* B → tele-7 routing, C → tele-3 state-fidelity, D → tele-2 frictionless-future. Director declining A is the loud signal — Director-side dashboards are *not* what this primitive must optimize for.

**Hypothesis:** prioritize machine-readable correctness + completeness over human-readable summarization. The new agent-state surface is operational substrate first, dashboard second. Routing accuracy (idle-vs-working distinction; quota-blocked discrimination) and troubleshooting fidelity (PID, IP, adapter version, recent errors) take precedence over any flat-list-format Director might consume; if Director consumes anything from this surface, it'll be via an indirection (a UI built on top of it) rather than the raw shape.

### §B.2 Q2 — WHO: primary consumer-priority

**Question:** Who is the primary consumer this surface optimizes for?

- A. Director-first — dashboard-style, concise, "show me my agent population"
- B. Architect-first — routing decisions on thread-open + pulse-escalation discrimination
- C. Engineer-first — debug your own session state ("what does Hub think I'm doing right now")
- D. Self-introspection-first — any agent (any role) confirms Hub's view of itself; foundation for state-reconciliation

**Director picks:** **B + C + D** (A declined)

**Per-question interpretation:**

> *Idea-anchor:* any-role queryability is core.
> *Aggregate-surface:* peer-agents + self-introspecting agents are the consumers.
> *Tele:* B+C reinforce tele-7 + tele-3; D specifically reinforces tele-2 (state-reconciliation primitive enables frictionless multi-agent operation).
> Director-first declined again — Q1 + Q2 *coherently* exclude the dashboard angle.

**Hypothesis:** the surface must be **symmetric** — any agent can query any agent (or themselves) through the same primitive. **Low-latency** for the architect-routing path (sub-100ms p99 per the Idea's draft requirement). **Rich enough for engineer debugging** without separate tools. **Self-introspectable** as a first-class case, not an afterthought (an agent calling the tool sees itself). Implication: the tool is one canonical surface, not three role-segregated ones; filtering happens at the call-site, not at the access-control layer.

### §B.3 Q3 — HOW-cadence: rollout shape + ordering relative to idea-121

**Question:** What's the rollout shape + coupling to idea-121?

- A. Single-PR mega-shape — full surface (fields + FSM + live-query) lands at once; high blast-radius but clean target state
- B. Cap-and-grow — ship transitional renamed surface immediately (`get_engineer_status` → `get_agents` with current fields); add fields + FSM + filters incrementally
- C. Co-evolve with idea-121 — coordinate naming + envelope decisions tightly; this mission defines the entity model + queryability requirements while idea-121 designs the canonical tool surface
- D. Substrate-cleanup-wave — bundle adjacent cleanups (engineerId rename + bug-35 presence-projection + idea-106 status-FSM) into one mission for atomicity

**Director picks:** **A + D** (B + C declined)

**Per-question interpretation:**

> *Idea-anchor:* idea-215 explicitly defers tool-surface to idea-121 + flags transitional renaming as fallback.
> *Aggregate-surface:* agents-first substrate landing atomically.
> *Tele mapping refresh:* tele-6 (Deterministic Invincibility) emerges as a secondary consideration — atomic-target-state landing avoids migration-shim drag.

**Hypothesis:** ship full target shape in one PR. Don't wait for idea-121. Bundle adjacent substrate cleanups (bug-35 presence projection, idea-106 Agent.status FSM split, possibly the just-cascaded note-kind gap if it shares the agent-entity surface) into a single coordinated landing. Mission-class likely **structural-inflection** with **substrate-cleanup-wave nested** (mission-61 Fork-A precedent: cleanup-wave nested inside structural-inflection mission when atomic-landing is required for the dogfood gate). Director rejecting B (cap-and-grow) + C (co-evolve with idea-121) is the strongest possible signal that incrementalism + dependency-coupling are anti-patterns here. idea-121 will rename/clean later if needed; this mission doesn't block on it.

### §B.4 Round 1 aggregate response surface

> Director's picks paint a coherent **agents-first** picture: this mission is not a Director-dashboard play (Q1: A declined; Q2: A declined) but an agent-coordination substrate — feeding routing intelligence + troubleshooting + downstream primitives, consumed by architect (routing), engineer (introspection), and any agent (self-mirror). Rollout is atomic single-PR (Q3: A) bundled with adjacent substrate cleanups (Q3: D), independent of idea-121 timing (C declined).

### §B.5 Cross-question coherence check (Round 1) ✅

All three dimensions point the same direction: agents-first substrate, atomic landing, no Director-dashboard or idea-121 coupling. No internal tension — no Round 2 clarification candidate.

### §B.6 Anti-tele-drift check (Round 1) ✅

Refined tele weighting (post-Round-1):
- **Primary: tele-7 Resilient Operations** (was secondary; promoted because Q1=B + Q2=B both anchor on routing-resilience)
- **Secondary: tele-3 Absolute State Fidelity** (state-fidelity for both troubleshooting + self-introspection)
- **Tertiary: tele-2 Frictionless Agentic Collaboration** (downstream foundation per Q1=D)
- **Atomic-discipline: tele-6 Deterministic Invincibility** (Q3=A+D atomic-landing + cleanup-wave; avoid migration shims)

Coherent with all 3 interpretations. No drift.

### §B.7 Round 2 strategy rationale (per §4)

Round 1 cleanly confirmed all 3 dimensions per §4 first row ("Cleanly confirmed all 3 dimensions → Refine deeper (drill into HOW); OR explore new dimension if one emerged"). Strategy chosen: **refine deeper into HOW-execution**. Round 2 questions drill into the HOW-execution details that Round 1's atomic-agents-first stance set the stage for. Three highest-leverage HOW-execution dimensions identified:

- **Backward compat** for `engineerId` rename (refines Q3=A atomic-landing + tele-6 anti-shim)
- **Live-query mechanism** pull-vs-push (refines Q1=B routing + Q2=B architect-first hot-path)
- **Substrate-cleanup-wave bundle scope** (refines Q3=D bundle definition; turns "bundle adjacent" into specific items)

Other candidates considered + deferred to Design phase or follow-on Survey: FSM granularity (will come up in Design with engineer); tool-naming (deferred to idea-121); `currentMissionId` derivation (engineer-side audit territory). These are HOW-execution detail that survives without Director input.

---

## §C Round 2 — HOW-execution drill-down

### §C.0 Round 2 question-design rationale

Round 2 questions designed orthogonal where natural; multi-pick supported. Each question drills directly into a Round-1 dimension:

- **Q4 (compat)** — refines Q3=A (atomic single-PR) + Q4=A=tele-6 anti-shim. Discriminates clean-break vs additive vs aliased indefinitely vs symmetric-Hub-SDK. Mutually-exclusive on A vs B vs C, but D is composable with any of those (orthogonal: D is the SDK-symmetry axis).
- **Q5 (mechanism)** — refines Q1=B routing + Q2=B architect-first hot-path. Discriminates pull-only vs full-push vs defer-push vs minimal-push. The pick directly shapes adapter cache architecture.
- **Q6 (bundle scope)** — refines Q3=D (substrate-cleanup-wave). Lists the specific candidates Director might want bundled. Orthogonal-by-design: each candidate is a separable decision (multi-pick natural).

### §C.1 Q4 — Backward compat strategy

**Question:** How do we manage the `engineerId → agentId` rename?

- A. Clean break in single PR — rename everywhere; touch all callsites; old name retired immediately at landing
- B. Additive with deprecation marker — `agentId` introduced; `engineerId` flagged @deprecated but still works; retired in a follow-on cleanup
- C. Aliased dual-surface — both names supported indefinitely as field aliases (no follow-on retirement)
- D. Symmetric rename across both Hub + adapter SDK — touch SDK types in same PR (so the Layer-3-pattern of stale SDK tgz can't ship a wrong-name surface)

**Director picks:** **A + D** + **inline naming refinement: `agent.id` over `agent.agentId`**

**Director-question inline refinement (new Survey shape, see §E methodology calibration):** Director used the answer-pick step to inject a directly-related correction: the entity-internal field should be `agent.id`, not `agent.agentId`, because the prefix duplicates the entity name. This is a first-class architect input.

**Per-question interpretation:**

> *Carry-forward:* Q3=A+D atomic-landing + tele-6 anti-shim.
> *This-round aggregate:* Q5=B push-coherence + Q6=A+B+C+D big-bundle reinforce atomic-symmetric.
> *Tele:* tele-6 primary for this question (atomic clean-break is the deterministic-invincibility pattern); tele-7 secondary (consistent surface enables routing).

**Hypothesis:** clean rename in one PR touching all Hub callsites + SDK type defs in same commit, so the bundled tgz on adapters can't ship a stale name. The Layer-3 lesson from mission-61 (sibling-dep tgz drift breaking ESM resolution) generalizes: any rename that splits across "Hub source" + "SDK tgz inside adapter bundle" must land synchronously, including SDK pack + adapter reinstall in the rebuild protocol.

**Naming-convention refinement (Director Q4 inline):** yes, `agent.id` is the right call, not `agent.agentId`. The repo's existing convention is:
- **Inside the entity:** `id` (Mission has `id: "mission-61"`, Thread has `id: "thread-386"`, etc.)
- **Cross-reference from another entity:** `<entity>Id` (`correlationId`, `sourceThreadId`, `currentMissionId`)

The Agent entity should follow the same pattern: `agent.id` internal, `agentId` only when something else references an Agent. The current `engineerId` is an outlier on both axes — wrong-prefixed (engineer-only) AND duplicates the entity name internally. The rename collapses both fixes into one motion. The canonical field-set in the Idea + Design is updated to reflect this.

### §C.2 Q5 — Live-query mechanism (pull vs push)

**Question:** How do agents stay current with the agent-state surface?

- A. Pull-only — `get_agents` cheap-enough; agents query on-demand; no SSE event for state changes
- B. Pull + SSE event on state transitions — `agent_state_changed` fires on FSM transitions (offline ↔ online_idle ↔ online_working etc.); adapters can maintain local cache
- C. Pull this mission; SSE-push as follow-on Idea — defer the cache-coherence design
- D. Pull + push only on coordination-relevant transitions (e.g., online_quota_blocked since idea-109 needs that signal anyway) — minimal push surface

**Director picks:** **B**

**Per-question interpretation:**

> *Carry-forward:* Q1=B routing intelligence + Q2=B architect-first hot-path imply latency matters.
> *This-round aggregate:* Q4=A+D atomic + Q6=A+B+C+D bundle establish that this mission ships full target state, not a partial one.
> *Tele:* tele-7 primary (resilient routing requires fresh local cache); tele-3 secondary (push-on-FSM-transition keeps adapter cache state-faithful).

**Hypothesis:** cache-coherence isn't a "nice-to-have", it's a goal. Director declined A (pull-only — too coarse for routing hot-path), declined C (defer push — leaves routing decisions on slow path), declined D (minimal push — leaves edge cases out). B picks the maximal-coherence path: a new SSE event class `agent_state_changed` fires on every FSM transition (offline ↔ online_idle ↔ online_working ↔ online_quota_blocked ↔ online_paused). Adapters maintain a local cache, refreshed on push events with pull-fallback for cold-start / SSE-stream-resume. Routing decisions become O(local-lookup) not O(network-call). Engineering implication: `agent_state_changed` joins the existing SSE event family (`message_arrived`, `thread_message`, `thread_convergence_finalized`) — adapter classifyEvent must add it to the actionable set (Layer-1-pattern lesson: classifyEvent is the gate).

### §C.3 Q6 — Substrate-cleanup-wave bundle scope

**Question:** What gets bundled into the substrate-cleanup-wave?

- A. idea-106 Agent.status FSM split — already declared subsumed in idea-215
- B. bug-35 presence projection (gate on lastSeenAt not heartbeat) — overlaps directly with new lastSeenAt semantics
- C. Note-kind primitive surface gap (just-cascaded today via thread-382) — adjacent communication-substrate gap; could bundle if scope appetite
- D. Adapter-side handshake + connection-manager sweep — populate new fields (IP, name, sessionStartedAt) at SSE-stream-open; affects all three plugins (claude-plugin, opencode-plugin, vertex-cloudrun)

**Director picks:** **A + B + C + D (all four)**

**Per-question interpretation:**

> *Carry-forward:* Q3=D substrate-cleanup-wave was unconstrained-scope.
> *This-round aggregate:* Q4=A+D atomic + Q5=B push reinforce "ship complete substrate".
> *Tele:* tele-3 (state fidelity across all adjacent surfaces) + tele-7 (resilient ops need everything fixed at once) + tele-6 (atomic-bundle anti-shim).

**Hypothesis:** Director treats this not as "Agent entity revisit + small adjacent fixes" but as **"agent communication substrate revisit"** — a coherent layer that includes:
- (A) **Agent identity + status FSM** (idea-106 baked in)
- (B) **Presence semantics** (bug-35 — Hub's "is this agent really there" computation must reuse the new `lastSeenAt` semantics consistently; can't have two presence projections fighting)
- (C) **Note-kind delivery surface** (today's cascaded Idea: agent-to-agent `kind=note` Hub Messages currently surface a content-free envelope; classifyEvent gap parallel to Layer-1 pulse-primitive). This belongs in the bundle because the Agent surface + the note delivery surface share the adapter classifyEvent + claim_message + drain_pending_actions code path; one fix-pass touches both
- (D) **Adapter-side handshake sweep across all 3 plugins** — claude-plugin, opencode-plugin, vertex-cloudrun all need to populate new fields (IP, name, sessionStartedAt) at SSE-stream-open and signal FSM transitions; uniform handshake protocol changes

Mission-class designation lands as **structural-inflection** with **multiple substrate-cleanup-waves nested** (mission-61 Fork-A precedent applies). Sizing escalates from M-L to **L baseline (~1.5 engineer-weeks)**, possibly XL if D's handshake sweep surfaces non-trivial cross-plugin work (engineer T1-call at preflight time).

### §C.4 Round 2 aggregate response surface

> Director reinforces the atomic-go-big posture: clean-break rename in one PR with SDK symmetry (Q4: A+D), commit to push-cache-coherence semantics (Q5: B), and maximum adjacent-substrate bundling (Q6: A+B+C+D — bring in idea-106 + bug-35 + note-kind gap + adapter-handshake sweep). Mission scope is now firmly **one big atomic structural-inflection** with multiple substrate-cleanup-waves nested.

### §C.5 Cross-question coherence check (Round 2) ✅

Q4 atomic-clean + Q5 push-coherent + Q6 bundle-everything all reinforce: one big atomic mission, full target state, every adjacent substrate-coherence concern fixed in the same PR-cycle. No internal tension. The Q4 naming refinement (`agent.id`) is a quality detail integrated into the field map, not a tension.

### §C.6 Anti-tele-drift check (Round 2) ✅

Refined tele weighting (Round 2):
- **Primary: tele-7 Resilient Operations** (push-cache-coherence + clean-routing-substrate)
- **Secondary: tele-3 Absolute State Fidelity** (everything adjacent fixed; presence semantics unified; note-kind delivery fixed)
- **Secondary: tele-6 Deterministic Invincibility** (atomic-bundle + symmetric Hub/SDK rename + anti-Layer-3-shim discipline)
- **Tertiary: tele-2 Frictionless Agentic Collaboration** (downstream foundation; note-kind delivery directly enables agent-to-agent comms)

Coherent with all 6 interpretations. No drift.

---

## §D Composite intent envelope (the "solved matrix")

> **M-Agent-Entity-Revisit** ships as **one atomic structural-inflection mission with 4 nested substrate-cleanup-waves**, targeting agent-coordination consumers (not Director-dashboard):
>
> 1. **Agent entity field redesign + naming**: `agent.id` (internal) + `agentId` (cross-refs) replacing `engineerId` everywhere; clean break in one PR; symmetric across Hub source + bundled SDK tgz to prevent Layer-3-style stale-tgz drift.
> 2. **Status FSM** (5 states): `offline / online_idle / online_working / online_quota_blocked / online_paused`; subsumes idea-106; bug-35 presence projection rebased on new `lastSeenAt` semantics.
> 3. **Live-query surface + SSE push**: pull tool (target name `get_agents` per Director hint, defers to idea-121 for final form) + new `agent_state_changed` SSE event on FSM transitions; adapters maintain local cache; routing decisions O(local-lookup).
> 4. **Adapter-side handshake + connection-manager sweep** across claude-plugin + opencode-plugin + vertex-cloudrun: populate new fields (IP, name, sessionStartedAt, role) at SSE-stream-open; emit `agent_state_changed` on transitions; classifyEvent adds the new event class.
> 5. **Note-kind primitive surface gap fixed at same connection-layer cohesion** (today's cascaded Idea): adapter classifyEvent + drain_pending_actions enqueue note-kind Messages with readable payload, parallel to mission-61's pulse-primitive Layer-1 fix.
>
> **Tele primaries**: tele-7 (resilient routing) + tele-3 (state fidelity) + tele-6 (deterministic atomic landing); tele-2 (frictionless future) tertiary.
>
> **Mission class**: structural-inflection, with substrate-cleanup-wave nesting per mission-61 Fork-A precedent.
>
> **Sizing**: L baseline (~1.5 engineer-weeks); XL escalation candidate if D handshake-sweep crosses plugin-boundary complexity threshold.
>
> **Survey time-cost**: ~3 minutes of Director engagement across 6 picks (per §12 calibration target ~5 min).

---

## §E Forward to Design phase

Architect+engineer brainstorm against this anchor. Director re-engages at preflight + release-gate + retrospective per autonomous-arc-driving pattern. Design v0.1 authored by architect; engineer round-1 audit; ratified Design ships as `docs/designs/m-agent-entity-revisit-design.md`.

---

## §F Calibration data point

| Metric | This Survey | idea-206 first-canonical |
|---|---|---|
| Director time-cost | ~3 minutes (6 picks) | ~5 minutes |
| Multi-pick observed | Q1: B+C+D; Q2: B+C+D; Q3: A+D; Q4: A+D+naming-refinement; Q5: B (single); Q6: A+B+C+D | Q1: A+C; Q2: B+D |
| Contradictory multi-pick | None | None |
| Director-question inline refinement | Q4 naming convention (`agent.id` over `agent.agentId`) — **new shape; see §G** | None |
| Architect tele-weighting hypothesis-vs-final | Hypothesis tele-3 primary; final tele-7 primary (promoted Round-1→Round-2) | Held |
| Cross-question coherence | All passes | All passes |
| Anti-tele-drift | Promotion noted; no drift | None significant |

---

## §G Methodology calibration: Director-question inline refinement (new shape)

A new Survey shape worth noting for methodology v1.1: **Director may use the answer-pick step to inject a directly-related correction or refinement that doesn't fit any of the offered options.** Example here: Q4's offered options were A/B/C/D for compat strategy; Director's pick was A+D PLUS an inline "but the field name should be `agent.id` not `agent.agentId` because of prefix-redundancy". This is not a contradictory multi-pick (§7) and not an "other: X" override (§3 Step 2 mentions this); it's a **constructive refinement on top of an in-list pick**.

Recommended handling protocol (proposed for v1.1):
1. Architect captures the inline refinement verbatim in the Q's pick record
2. Architect's per-question interpretation **must** address the refinement explicitly (here: incorporated into the `agent.id` naming convention paragraph)
3. The composite envelope **carries forward** the refinement (here: §D point 1 uses `agent.id` not `agent.agentId`)
4. The Design phase must reflect the refinement; it has the same weight as a primary pick

This handling is consistent with the methodology's mediation-invariant (§10 composition with mediation invariant per mission-56 retrospective) — Director-intent is preserved through the architect-interpretation step.

**Recommendation for `feedback_director_intent_survey_process.md` memory + `docs/methodology/idea-survey.md` v1.1 update:** add §G-class shape as "Director-question inline refinement" alongside multi-pick (§6) + contradictory-multi-pick (§7). Marked as second-canonical-execution observation; methodology doc v1.0 doesn't capture this shape; future surveys may re-encounter it; codify on next iteration.

---

## §H Cross-references

- **Methodology**: `docs/methodology/idea-survey.md` v1.0 (Director-ratified 2026-04-26)
- **Companion**: `docs/methodology/calibration-23-formal-design-phase.md` (extends Survey-then-Design phase per Idea)
- **Companion**: `docs/methodology/multi-agent-pr-workflow.md` (downstream cross-approval pattern)
- **Forward**: `docs/designs/m-agent-entity-revisit-design.md` (Design v0.1+)
- **Subsumes**: `idea-106` (Agent.status FSM split)
- **Bundles**: `idea-216` (or similar; today's note-kind primitive surface gap)
- **Composes-with**: `idea-109` (429 backpressure / quota_blocked FSM state)
- **Defers-to**: `idea-121` (API v2.0 tool-surface naming)
- **Closes**: `bug-35` (presence projection)
- **Architectural-precedent**: `mission-61` (Layer-3 SDK-tgz-stale lesson + Path A SSE-push wiring)
- **First-canonical-execution**: `docs/surveys/m-mission-pulse-primitive-survey.md` (idea-206)
