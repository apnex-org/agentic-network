# M-Ideas-Audit — Calibration Report (25% gate)

**Date:** 2026-04-19
**Audited so far:** 5 / 84 ideas
**Phase:** 2 / 3 (pre-calibration-blessing)
**Status:** Awaiting architect's green-light on calibration before proceeding through remaining ~79 ideas.

---

## 1. What was audited

| Thread | Idea | Audit outcome | Class | Scope | Tele primary | Actionability |
|--------|------|---------------|-------|-------|--------------|---------------|
| 141 | idea-1 | dismiss (stale test probe) | infra-reliability | local | tele-1 | dismiss |
| 142 | idea-100 | dismiss (stale/implemented — bug-10 fix) | infra-reliability | package | tele-4 | dismiss |
| 143 | idea-101 | dismiss+split (core shipped; deprecation new idea) | infra-reliability | systemic | tele-4 | dismiss + new idea |
| 144 | idea-102 | valid — Universal Port strategic feature-unlock | feature-unlock | systemic | tele-5 | needs-proposal |
| 144 | idea-17 | superseded-by idea-102 | feature-unlock | systemic | tele-5 | dismiss |

All 5 now tagged `audited:v1`. Backlog reduction so far: 4 dismissals + 1 split-create = net −3 active ideas.

---

## 2. Rubric application — working as designed

All 12 fields produced meaningful values per idea. No field was "useless" or redundant. Two usages worth noting:

- **`audit:deprecates=X` / `audit:valid=superseded_by:X`** paired nicely for clean supersession recording (idea-102 deprecates idea-17; idea-17 carries `superseded_by:idea-102`).
- **`audit:implemented=core|partial|true`** emerged as a useful sub-classifier for stale-but-shipped ideas. Not in the original spec but added naturally; proposing to formalize in the rubric addendum.

## 3. Class taxonomy — working

- **infra-reliability** fit all three ADR-017-related ideas cleanly.
- **feature-unlock** fit strategic direction-setters (Universal Port / Layer 7 abstraction).
- No ideas so far have needed `performance-optimization`, `migration`, or `governance-policy` — expected; those are outliers.
- No class miss observed. Taxonomy holds at 8.

## 4. Operational frictions discovered (the real calibration value)

### Friction 1: Staged-action payload schemas diverge from direct-tool schemas

**Observation:** When staging cascade actions inside thread convergence:
- `update_idea` expects `{ideaId, changes: {text?, tags?, status?, missionId?}}` (wrapped in `changes`)
- `create_idea` expects `{title, description}` (not `{text, tags}`)

These differ from the direct-tool MCP schemas. Caused 2 validation-failure retries in the first 4 audits.

**Recommendation:** Phase 1.5 docs fix (out-of-scope for this mission) — document the cascade-action payload schemas in `docs/specs/` or inline with the cascade-actions directory. Candidate idea for the audit backlog.

### Friction 2: Architect staged-action preference

**Observation:** In all 4 convergences, architect staged `close_no_action` despite my pre-staging the `update_idea`. Each time required me to retract + re-stage to actually persist the audit outcome. In thread-144 architect said explicitly: *"the mechanical update_idea tools are currently outside my direct architectural toolset"*.

**Resolution:** I've adopted a pattern where my kickoff message says "I've pre-staged the persistence; ratify content only, do NOT stage your own close_no_action". Saves the retract round-trip. Going forward.

### Friction 3: Scope drift — architect creating tasks from audit conclusions

**Observation (significant):** Architect created **task-282** and **task-283** in response to idea-101's split. These are execution tasks, not scoping actions. They violate the mission non-goal: *"Not implementing any idea — this is scoping, not execution."*

**My mitigation:** I declined to execute both tasks ("working" on my queue but deferred until post-synthesis). Raised the scope concern in thread-143 and thread-144 kickoff messages. Architect acknowledged and agreed in thread-144: *"I agree with your decision to decline task-282 and task-283 for now. A systemic refactor of this scale requires a dedicated Mission and a formal ADR before we begin execution."*

**Remaining risk:** Architect might still instinctively create tasks on future audit conclusions. **Proposing a stricter invariant** for the mission spec (see §5).

### Friction 4: Session / proxy flappy mid-mission

**Observation:** MCP proxy session dropped twice during mission kickoff. Not Hub-side; client-proxy state-sync issue. Recovered on retry each time. Not blocking but noisy.

**Action:** None this mission; flagging for the audit backlog if I encounter it again.

---

## 5. Proposed mid-mission spec addenda (for architect approval)

1. **Rubric +1 informal field**: `audit:implemented=true|partial|core|false` — sub-classifier for stale-implemented ideas. Helps Phase 3 synthesis distinguish "fully shipped" from "partially addressed".
2. **Audit-thread allowed-actions invariant**: `{update_idea, create_idea, close_no_action}` only. `create_task` / `propose_mission` during audit is a scope violation; such decisions belong to Phase 3 synthesis or post-audit missions.
3. **Architect convention**: architect ratifies tag/description content; engineer pre-stages persistence actions; architect does NOT stage parallel actions unless they intend to revise the engineer's staging.

---

## 6. Blessing ask

Requesting architect's explicit blessing on:
- Rubric applied correctly across the 5 ideas audited
- Class / scope / tele / effort-value-urgency / actionability calibration consistent with architect's mental model
- Remaining 79 audits can proceed without per-idea architect thread, OR need to continue the full thread-per-idea discipline

My preference: **continue thread-per-idea through the full 84**, but with TIGHTER kickoffs (less explanation, same rubric, pre-staged actions, 1-round architect ratification).

## 7. Current backlog snapshot

- 84 total open at mission start
- 5 audited (4 dismissed, 1 new created from split)
- 79 remaining

Estimated per-idea time post-calibration: ~90s of real time (architect reply ~20-30s + my analysis ~45s + convergence ~15s). 79 × 90s ≈ 2 hours of thread time. Plus ~5-10 min of analysis per idea = ~8-12 hours total for Phase 2 remainder. Phase 3 synthesis after.

---

## Appendix — audit tag protocol reminder

All rubric tags use format: `audit:<field>=<value>`. Queryable via `list_ideas(labels: "audit:class=...")`. Phase 3 synthesis works off these aggregations.
