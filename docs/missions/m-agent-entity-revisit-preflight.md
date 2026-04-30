# M-Agent-Entity-Revisit (mission-62) — Preflight Artifact

**Mission:** mission-62 M-Agent-Entity-Revisit
**Status:** `proposed` → activation pending Director release-gate signal
**Architect:** lily
**Engineer:** greg (Design v1.0 bilateral co-author; round-1+2 audit shipped on thread-387)
**Verdict:** **GREEN** — all 6 check categories pass; ready for `update_mission(status="active")`
**Date:** 2026-04-27
**Methodology:** `docs/methodology/mission-preflight.md` v1.0

---

## Summary

`mission-62 M-Agent-Entity-Revisit` is the second canonical execution of the full Survey → Design → Manifest → Preflight pipeline (idea-206 / mission-57 was first). Director-anchored Survey 2026-04-27 (3+3 picks across 2 rounds; composite intent envelope ratified); architect+engineer bilateral Design v1.0 ratified on thread-387 round-10; mission landed via direct `create_mission` (architect bypass — `propose_mission` cascade blocked on engineer-side role-gate per task-303 Phase 2a commit-authority gate; Director-2026-04-27 instruction to bypass).

Mission ships:
- **Agent entity restructure** with orthogonal liveness + activity FSMs (livenessState preserved per ADR-017 INV-AG6; activityState new per Design §3)
- **Symmetric Hub/SDK rename** of `engineerId → agentId` (Q4=A+D clean break; ~90-file mechanical-review diff)
- **`get_agents` pull primitive + `agent_state_changed` SSE-push** for cache-coherence (sub-100ms p99 routing-path target)
- **Adapter handshake + cache + `signal_working_*` RPCs** (claude-plugin + opencode-plugin parity; vertex-cloudrun stub-only)
- **Bundled substrate-cleanups**: bug-35 presence projection rebase + idea-106 Agent.status FSM subsumption + note-kind primitive surface gap fix at SDK kernel
- **Substrate-self-dogfood gate** (observation-only per round-2 ratify)
- **Closing audit** per multi-agent-pr-workflow + mission-61 audit pattern

**Sizing:** L baseline (~1.5-2 engineer-weeks); XL escalation realistic if vertex-cloudrun HTTP-transport gets wired (engineer T1-call surfaced below in §E).

**Mission class:** structural-inflection with substrate-cleanup-waves nested per mission-61 Fork-A precedent.

---

## A. Documentation integrity

| # | Check | Verdict | Note |
|---|---|---|---|
| A1 | Brief at `mission.documentRef = docs/designs/m-agent-entity-revisit-design.md` exists | ✅ PASS | Committed in this preflight PR (Survey + Design v1.0 + Preflight bundled) |
| A2 | Local branch in sync with origin (no unpushed commits affecting brief) | ✅ PASS | Branch `agent-lily/mission-62-design-and-preflight` from origin/main; brief committed here for first time |
| A3 | Cross-referenced artifacts exist | ✅ PASS | Survey at `docs/surveys/m-agent-entity-revisit-survey.md` (this PR); ADR-017 at `docs/decisions/017-comms-reliability.md` (extant); methodology at `docs/methodology/{mission-preflight,multi-agent-pr-workflow,idea-survey}.md` (extant) |

---

## B. Hub filing integrity

| # | Check | Verdict | Note |
|---|---|---|---|
| B1 | Mission entity has correct id, status=proposed, documentRef populated | ✅ PASS | mission-62; status=proposed; documentRef=docs/designs/m-agent-entity-revisit-design.md |
| B2 | title + description faithful summary of brief | ✅ PASS | Description carries Survey picks + Design v1.0 highlights + anti-goals + provenance; matches brief |
| B3 | tasks[] + ideas[] empty (unexpected for proposed) | ⚠️ ACCEPTABLE DEVIATION | tasks[] empty ✓. ideas[] = [idea-215] — intentional subsumption record (parent Idea linked via `update_idea(missionId)` per architect role; not pre-scaffolded execution; idea-215 status flipped to `incorporated` on linking). Per `feedback_plannedtasks_manual_create_mismatch.md`, manual task creation would be the violation; idea linkage is the correct cascade artifact |

---

## C. Referenced-artifact currency

| # | Check | Verdict | Note |
|---|---|---|---|
| C1 | Every file path cited in brief exists | ✅ PASS | Hub source paths verified by greg's round-1 audit code-read: `hub/src/state.ts:195` + `:1164-1175` (livenessState FSM) + `hub/src/policy/session-policy.ts:277-301` (list_available_peers) + `hub/src/entities/agent-repository.ts:529-557` (touchAgent) + `packages/network-adapter/src/kernel/event-router.ts:60-131` (classifyEvent + actionable sets) + `pending-action.ts:48-86` (PendingActionItem schema) + `hub/test/unit/agent-repository.test.ts` (idea-106 wakeEndpoint test target) — all present at audit time |
| C2 | Numeric claims verified | ✅ PASS | 5-state activity FSM ✓; 4-state liveness FSM ✓ (per ADR-017 INV-AG6 + computeLivenessState); ~90-file engineerId rename diff (engineer-estimated; mechanical-review territory); sub-100ms p99 routing latency target (in-memory projection assumption) |
| C3 | Every idea/bug/thread cited still in assumed state | ✅ PASS | idea-106 (open; subsumed-by-idea-215 tag set today; will close-by-incorporation when mission-62 lands); idea-109 (open; composes via `signal_quota_blocked` FSM transition); idea-121 (open; defers tool-surface naming); bug-35 (open; closes via `livenessState === "online"` projection rebase); thread-387 (round_limit; Design v1.0 ratified bilaterally); thread-382 (converged; note-kind gap Idea cascade) — all in assumed state |
| C4 | Dependency prerequisites in stated state | ✅ PASS | mission-40 (M-Session-Claim-Separation) completed — session-claim machinery consumed; mission-57 (M-Mission-Pulse-Primitive) completed — pulse primitive consumed; mission-61 (M-Pulse-Primitive-Surface-Closure) completed today — Layer-3 SDK-tgz-stale lesson + Path A SSE-push wiring is architectural precedent for §4.2 + §7.1 |

---

## D. Scope-decision gating

| # | Check | Verdict | Note |
|---|---|---|---|
| D1 | Every engineer-flagged scope decision has ratified answer | ✅ PASS | All 9 round-1 open questions answered + committed in Design §11; all 3 round-2 architect-ratify decisions ratified bilaterally (Shape A FSM-orthogonality; Option α atomic W1+W2; observation-only dogfood); naming counter accepted (livenessState preserved; activityState new) |
| D2 | Director + architect aligned on ambiguous decisions | ✅ PASS | Director Survey-anchored 6 picks (full intent envelope captured); architect interpreted + ratified per Survey §3.4 + §4 methodology; no open decision points; Director-question inline refinement on Q4 (`agent.id` vs `agent.agentId`) accepted as primary input |
| D3 | Out-of-scope boundaries confirmed | ✅ PASS | 13 anti-goals locked in Design §10 (10 original + 3 round-1 additions: vertex-cloudrun-stub-only; W4-routing-refactor-no-expansion; livenessState-NOT-renamed) |

---

## E. Execution readiness

| # | Check | Verdict | Note |
|---|---|---|---|
| E1 | First wave sequence clear; engineer can scaffold day-1 work | ✅ PASS | W1+W2 atomic plannedTask is fully scoped (11 sub-items in task description); engineer can begin with entity-schema rename in `hub/src/entities/agent-repository.ts` and SDK rename in `packages/network-adapter/src/` synchronously |
| E2 | Deploy-gate dependencies explicit | ✅ PASS | Hub redeploy required after W1+W2 merge (per `feedback_architect_owns_hub_lifecycle.md`); SDK tgz redistribute + adapter reinstall + smoke-test per Design §7.1 rebuild protocol; W3 strictly sequential after W2 SDK tgz installable; CI hook activates with W1+W2 to prevent regression |
| E3 | Success-criteria metrics measurable | ✅ PASS | W4 dogfood gate observable via Hub Message store records (envelope-verbatim per mission-61 audit pattern); FSM transitions observable via `agent_state_changed` SSE event delivery + cache-coherence at thread-open; note-kind round-trip observable via drain payload presence |

### E.4 — Engineer T1-call surfaced (vertex-cloudrun escalation)

Per Design §9.3 + greg's round-1 audit: **vertex-cloudrun HTTP-transport adapter is currently stub-only in this mission.** No `adapters/vertex-cloudrun/` dir in the tree. If Director wants vertex-cloudrun fully wired this mission, sizing tips from L → XL clearly. If stub-only is acceptable, mission stays L; full vertex-cloudrun wiring would file as follow-on Idea.

**Director input needed at activation:** stub-only OK (default; lower-risk; faster ship) OR wire vertex-cloudrun in W3 (XL escalation; engineer T1).

---

## F. Coherence with current priorities

| # | Check | Verdict | Note |
|---|---|---|---|
| F1 | Anti-goals from parent review still hold | ✅ PASS | 13 anti-goals in Design §10 are mission-internal (no parent review); locked bilaterally |
| F2 | No newer missions filed that supersede or overlap | ✅ PASS | Recent backlog: idea-204/205/207/208/202/203 cover distinct scopes (CI-pipeline, Hub-config, dogfood-CI, etc.); no agent-entity overlap. mission-44/42/39/37/35 (older proposed) cover unrelated scopes |
| F3 | No recent bugs/ideas materially change scoping | ✅ PASS | Today's note-kind primitive surface gap Idea is INCLUDED in scope (Q6=C bundle); bug-35 closes via §3.5 rebase; idea-106 subsumed; idea-109 composes via §3.6 — all adjacent items already absorbed |

---

## Director release-gate decision

**Verdict: GREEN.** All 6 check categories pass cleanly; one Engineer T1-call (E.4) surfaced for Director input on vertex-cloudrun scope (stub-only-OK is the default low-risk pick).

**Director's signal:** `update_mission(missionId="mission-62", status="active")` — engineer becomes claim-eligible for W1+W2 atomic PR.

If Director wants vertex-cloudrun wired in W3 (XL escalation), surface that decision before activation; architect updates Design §5.3 + §9.3 + this preflight to RE-VERDICT before Director flips to active.

---

## Notable methodology calibrations from this Survey + Design cycle

These will be captured in W5 closing audit; surfaced here for Director context:

1. **Director-question inline refinement** (Survey §G new shape) — Director's Q4 picks A+D PLUS inline "field name should be `agent.id` not `agent.agentId`". First-class architect input, not contradictory-multi-pick or "other:X" override. Methodology v1.1 candidate; codified in `feedback_director_intent_survey_process.md`.
2. **Survey artifact-completeness discipline** — Director caught a partial first-persistence; rewritten as complete archival record (architect self-justifications + tele weighting analysis trail + Round-2 strategy rationale all in doc, not chat). Memory updated.
3. **`propose_mission` cascade role-gate** (task-303 Phase 2a commit-authority) blocks engineer-side commit when staged-action is mission-creating. Architect direct-create bypass via `create_mission` is the workaround. **Methodology v1.1 candidate**: codify the bypass as legitimate operational shape (not a "workaround"); include in mission-lifecycle.md as a documented path. Engineer-flagged pre-emptively in thread-387 round-10.
4. **maxRounds=10 thread limit reached** — Survey + Design + bilateral-ratify cycle hit the round limit at exactly the convergence point. Future Surveys for L+ missions may benefit from larger maxRounds (15? 20?) at thread-open. Calibration data point.
5. **Architect-direct-create-mission bypass is ONE-TIME** (per Director-2026-04-27) — same shape as architect-fires-release-gate one-time deviation for mission-61. Subsequent missions return to `propose_mission` cascade flow once the role-gate is fixed (or the cascade is updated to support engineer-side commit when bilateral ratification is bilaterally signed).

---

## Cross-references

- **Survey artifact:** `docs/surveys/m-agent-entity-revisit-survey.md` (this PR)
- **Design v1.0:** `docs/designs/m-agent-entity-revisit-design.md` (this PR)
- **Methodology:** `docs/methodology/mission-preflight.md` v1.0; `docs/methodology/idea-survey.md` v1.0; `docs/methodology/multi-agent-pr-workflow.md` v1.0; `docs/methodology/calibration-23-formal-design-phase.md`
- **Anchor Idea:** idea-215 (`incorporated` → mission-62)
- **Subsumes:** idea-106 (closes-by-incorporation when mission-62 lands)
- **Composes-with:** idea-109 (`signal_quota_blocked` FSM transition); idea-121 (final tool-surface naming defers there)
- **Closes:** bug-35 (presence projection rebase via §3.5)
- **Architectural precedents:** mission-61 (Layer-3 SDK-tgz-stale lesson + Path A SSE-push wiring); mission-40 (session-claim consumed); mission-57 (pulse-primitive consumed)
- **Design ratification thread:** thread-387 (round_limit; Design v1.0 ratified bilaterally)
- **Note-kind gap parent thread:** thread-382 (cascade-spawned the bundled Idea)

---

*Architect-authored 2026-04-27; verdict GREEN; activation pending Director release-gate.*
