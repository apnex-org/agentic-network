# Mission Activation Preflight — Methodology

**Status:** v1.0 (2026-04-23). Treat as engineered component — version, critique, evolve.
**Scope:** reusable pre-activation audit for any Mission in `proposed` state before Director flips to `active`.

## Purpose

A **preflight check** is the gate between a ratified mission brief and engineer claim-eligibility. It verifies that the brief's claims are still true *right now* (not merely when the brief was authored), that pre-kickoff decisions are resolved, and that the mission is coherent with current system priorities. It produces a per-mission preflight artifact that Director uses to decide whether to issue the `update_mission(status="active")` release-gate signal per `strategic-review.md` §Mission Filing Protocol (§10.6).

Preflight applies to **every mission** regardless of how it reached `proposed` — review-filed, proposal-cascaded, or thread-converged. A mission brief captures intent at filing time; preflight confirms the brief is still load-bearing at activation time.

## When to use

- Director is considering flipping a mission from `proposed` to `active`
- Mission was filed >7 days ago and activation is imminent (state-drift likely)
- A prerequisite mission just completed and downstream missions become eligible
- Parent review's retrospective identified new anti-goals or priority shifts (re-preflight pending missions)

## When NOT to use

- Mid-execution mission replanning (use mission design iteration, not preflight)
- Proposed mission that won't activate for weeks (defer preflight until closer to activation — stale preflight is waste)
- Tactical bug-fix tasks scaffolded directly without a mission brief (no surface to audit)

## Roles

| Role | Responsibility |
|---|---|
| **Architect** | Runs the preflight. Has Hub read + brief context. Authors the preflight artifact. Flags RED/YELLOW verdicts for Director. |
| **Engineer** | Co-runs when mission is in their claim lane. Verifies execution-readiness checks (Category E) — they're the one who must scaffold day-1 work. |
| **Director** | Consumes preflight verdict. Ratifies Category D decisions on YELLOW verdicts. Issues `update_mission(status="active")` on GREEN or post-kickoff YELLOW. |

## Procedure

### Step 1 — Load context

- Read the mission brief at `mission.documentRef`
- Fetch the mission entity via `get_mission(missionId)` — confirm current Hub state
- Identify all ideas/bugs/threads/missions the brief references by ID

### Step 2 — Run the 6 check categories

Execute each category. Record PASS / FAIL / N/A per item in the preflight artifact.

#### A. Documentation integrity

| # | Check | Fail mode |
|---|---|---|
| A1 | Brief file exists at `mission.documentRef` path and is committed | File missing, uncommitted edits, or path mismatch |
| A2 | Local branch in sync with `origin` (no unpushed commits affecting the brief) | Brief has local-only edits that peers can't see |
| A3 | Cross-referenced artifacts (sibling briefs, observations files, audit docs) exist | Missing dependency documents |

#### B. Hub filing integrity

| # | Check | Fail mode |
|---|---|---|
| B1 | Mission entity has correct `id`, `status=proposed`, `documentRef` populated | Mis-filing; status already flipped; documentRef missing |
| B2 | `title` + `description` are a faithful summary of the brief | Filing-time summary drift from brief content |
| B3 | `tasks[]` + `ideas[]` are empty (unexpected for `proposed`) | Pre-scaffolded tasks indicate policy violation or legacy data |

#### C. Referenced-artifact currency

The "memory may be stale" check. Every claim in the brief must still be true *now*.

| # | Check | Fail mode |
|---|---|---|
| C1 | Every file path cited in the brief exists (spec docs, test paths, audit docs) | Path renamed, deleted, or moved since brief authoring |
| C2 | Every numeric claim verified against current state (invariant counts, test coverage %, bug IDs) | Claim-vs-reality divergence (e.g., brief says "28 invariants" but current count is 23) |
| C3 | Every idea/bug/thread cited by ID still in the assumed state | Idea status flipped (`open → incorporated`), bug resolved, thread closed |
| C4 | Every dependency prerequisite in the stated state | Upstream mission regressed, prior bug reopened, "shipped" item unshipped |

#### D. Scope-decision gating

The "Engineer-flagged for Director" section of the brief must be resolved before activation.

| # | Check | Fail mode |
|---|---|---|
| D1 | Every engineer-flagged scope decision has a ratified answer | Decision still open; will surface mid-mission as blocker |
| D2 | Director + architect aligned on any mid-brief ambiguous decision point | Latent disagreement; will cause re-litigation |
| D3 | Out-of-scope boundaries confirmed | Scope-creep intent at kickoff |

#### E. Execution readiness

Engineer-facing checks — can work start cleanly on day 1?

| # | Check | Fail mode |
|---|---|---|
| E1 | First task/wave sequence clear; engineer can scaffold day-1 work without re-reading brief | Ambiguous starting point; kickoff stalls |
| E2 | Deploy-gate dependencies explicit (Hub redeploy? Adapter Cloud Run redeploy? When?) | Discovered mid-mission per mission-38 deploy-gap pattern |
| E3 | Success-criteria metrics measurable from current baseline | Can't prove ≥X% improvement if baseline not in telemetry |

#### F. Coherence with current priorities

The "is this still the right mission?" check.

| # | Check | Fail mode |
|---|---|---|
| F1 | Anti-goals from parent review (if any) still hold | Anti-goal flipped; mission scope may need update |
| F2 | No newer missions filed that supersede or overlap this one | Duplicate work; consolidate or defer |
| F3 | No recent bugs/ideas that materially change the scoping | Brief needs refresh to incorporate |

### Step 3 — Assign verdict

| Verdict | Criteria | Next step |
|---|---|---|
| **GREEN** | All checks pass | Director may flip `proposed → active` immediately |
| **YELLOW** | Category D (scope decisions) unresolved; all other categories pass | Short kickoff meeting (Director + architect + engineer) ratifies decisions; re-verdict to GREEN; flip |
| **RED** | Any blocker in A/B/C/E/F: brief outdated, dependency regressed, scope superseded, undeployable | Back to architect for brief-refresh OR mission abandonment. Re-file or `update_mission(status="abandoned")`. |

### Step 4 — File the preflight artifact

Commit the preflight to `docs/missions/<mission-id>-preflight.md` (mission-scoped location — each mission owns its preflight artifact). Architect pushes to branch; Director reads the committed version for the activation decision.

### Step 5 — Director verdict action

- **GREEN:** `update_mission(missionId, status="active")` — engineer claim eligible.
- **YELLOW:** schedule kickoff; on convergence, architect updates preflight artifact to GREEN; flip.
- **RED:** architect files brief-refresh task OR `update_mission(missionId, status="abandoned")` with reason.

## Stale-preflight trigger

A preflight artifact has a **30-day freshness window**. If `update_mission(status="active")` does not fire within 30 days of preflight filing, re-run preflight before activation — the Hub state has likely drifted (new bugs, absorbed ideas, shipped dependencies).

Mark stale preflights at the top: `**STALE** — refresh required before activation`. Do not delete; the history is informative for retrospective.

## Artifact shape

Preflight artifact at `docs/missions/<mission-id>-preflight.md`:

```markdown
# Mission-N Preflight Check

**Mission:** <name>
**Brief:** <mission.documentRef>
**Preflight author:** <architect-id>
**Date:** YYYY-MM-DD
**Verdict:** GREEN | YELLOW | RED
**Freshness:** current (until YYYY-MM-DD) | STALE

## Category A — Documentation integrity
- A1. <check name>: PASS | FAIL — <notes>
- A2. <check name>: PASS | FAIL — <notes>
- A3. <check name>: PASS | FAIL — <notes>

## Category B — Hub filing integrity
...

## Category C — Referenced-artifact currency
...

## Category D — Scope-decision gating
...

## Category E — Execution readiness
...

## Category F — Coherence with current priorities
...

## Verdict summary
<2-3 sentences: overall verdict, any YELLOW/RED items requiring action, activation recommendation>

## Pre-kickoff decisions required (if YELLOW)
1. <decision needed>
2. <decision needed>
```

## Relationship to other methodology documents

- **`docs/methodology/strategic-review.md` §Mission Filing Protocol (§10.6)** — filing default is `proposed`; preflight is the gate between `proposed` and Director release-gate signal. Preflight procedure is load-bearing for §10.6's separation between ratified-but-not-released and operationally-active.
- **Mission Design + Manifest docs** (per the target Concept→Idea→Design→Manifest→Mission chain) — preflight audits the Mission brief; prior Design + Manifest artifacts are inputs the brief cites. Preflight does not re-audit the Design.
- **Retrospective (formal)** — preflight false-negatives (went GREEN but mission blocked) and false-positives (went RED but was actually viable) feed back into preflight methodology refinement at retrospective time.

## Anti-patterns (do not do)

- **Preflight-as-rubber-stamp** — running through the checks without actually verifying claims against current state. The whole value is the "brief claim vs current reality" check.
- **Preflight during mid-execution** — preflight is pre-activation only; once a mission is `active`, use mission design iteration, not preflight.
- **Skipping Category D on YELLOW** — flipping to `active` with unresolved scope decisions guarantees mid-mission re-litigation. The short kickoff meeting cost is always less than the mid-mission cost.
- **Single-artifact preflight for a mission-set** — each mission preflights independently. Even tightly-coupled missions (like Phase 4's 4 winners) get separate preflight artifacts because each can independently be GREEN/YELLOW/RED.
- **Skipping stale re-preflight** — relying on a >30-day-old preflight is exactly the drift the procedure exists to catch.

## Success criteria for the preflight itself

A preflight is successful if:

1. The verdict accurately predicts mission activation viability (measured at retrospective)
2. No mid-mission blockers surface that a preflight check would have caught
3. Category D decisions resolved at kickoff are stable through mission completion (no re-litigation)
4. The preflight artifact is concise enough to author in ~1 architect-hour (not a mini-review)

## Methodology evolution

As with `strategic-review.md`, treat this procedure as an engineered component. Retrospectives feed deltas back into this document (versioned). Candidate v1.1 additions on observed execution:

- Automated preflight runner (tool-callable check harness for Categories A/B/C)
- Preflight-pack templates per mission class (L/M/S effort classes weight checks differently)
- Cross-mission preflight coordination when activating a mission-set simultaneously

---

*Methodology v1.0 authored 2026-04-23 alongside mission-41 worked example. Formalizes the ad-hoc preflight pattern validated on 2026-04 review Phase 4 winners.*
