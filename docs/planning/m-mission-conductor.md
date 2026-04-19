# Mission: M-Mission-Conductor

**Status:** Proposed
**Proposed:** 2026-04-19
**Owner:** Engineer (autonomous lead)
**Collaborator:** Architect (ADR review)
**Governance:** Director approves mission kickoff; Architect ratifies ADR; single-phase delivery.

---

## The framing

The Hub today has two work-delivery mechanisms:
- **Tasks** — pulled via `get_task` (queue-pop semantics).
- **Threads** — pushed via `thread_message` SSE (event-driven).

**Missions have neither.** A Mission entity holds state (ideas[], tasks[], correlationId) but does not actively drive work to the executing agent. When a wave converges during a long-running mission, the agent has no "what's next" signal — no SSE event, no queued directive, no guidance.

The Hub's job is to guide agents. Today it abdicates that job at the mission layer. This mission fixes that.

---

## Motivation

M-Ideas-Audit (2026-04-19) surfaced this gap concretely:

- After wave-4 thread-149 converged, no event fired to direct the engineer to open wave-5. Engineer (me) ended turn by default.
- Director had to manually prompt "We are idle?" to resume.
- Same pattern recurred at wave-6.
- Out of 5 Director interventions required to complete the mission, **2 (40%) were attributable to this missing primitive**.

Director framing (2026-04-19):
> "Once the thread converged it would have triggered an SSE push to you to move on to the next wave — is this not correct? ... The hub is there to guide agents, yourself included."

This is a missing Hub primitive, not an engineer behavior gap. Engineer discipline is the last-line fallback (see idea-112); the primary guardrail must be Hub-side.

---

## Goals

1. **Hub actively drives work** to agents during long-running missions. Zero implicit "check state yourself" idle windows.
2. **Mission-kind-agnostic** primitive — works for audits, chores (idea-25), multi-task plans, cross-agent handoffs.
3. **Leverages ADR-017 queue infrastructure** — no new SSE event class; reuses PendingActionItem semantics + watchdog.
4. **Backward-compatible** — existing missions without pendingWorkItems behave as today.
5. **Test-protected** — E2E test proves "mission → converge → next work drives" without Director involvement.

## Non-goals

- Not a mission-execution engine (no DAG, no dependency resolution). Scope is the drive primitive.
- Not a scheduler. Mission-conductor is reactive (on convergence); recurring work is a separate idea (idea-25).
- Not replacing task/thread delivery — augmenting them at the mission layer.

---

## Proposal

### Mechanism (queue-based, single-phase)

Leverage existing ADR-017 PendingActionItem infrastructure.

1. **Mission FSM extension.** Mission entity gains:
   - `pendingWorkItems: WorkItem[]` — ordered list of next-actions for the mission.
   - `currentWorkItem: WorkItem | null` — active work item (the one the agent is in).
   - WorkItem shape: `{id, kind, description, targetAgentRole, referenceId?}` where kind ∈ {`open_thread`, `create_task`, `propose_mission`, `run_cascade`, `custom`}.

2. **Convergence trigger.** On thread_convergence_finalized or task_completed cascade, Hub policy layer:
   - Checks if source thread/task is owned by a mission.
   - If mission has more pendingWorkItems, pops the next one, marks it `currentWorkItem`.
   - Enqueues a PendingActionItem of dispatchType `mission_directive`, payload = WorkItem + missionId context.
   - Targeted at agent whose role matches `targetAgentRole` (mission-owner by default).

3. **Agent drain loop.** Existing drain-on-wake / drain-on-handshake picks up `mission_directive` items.
   - Adapter calls into a new sandwich handler: `sandwichMissionDirective(missionId, workItem)`.
   - LLM sees clear directive: "Mission X is in progress. Last wave converged. Your next work: {description}. Begin now."
   - Work proceeds as normal (create_thread / create_task / etc.).
   - On completion of the WorkItem, sandwich-handler completion-ACKs the queue item → mission advances.

4. **Mission completion.** Mission transitions to `completed` when `pendingWorkItems` empty + `currentWorkItem` completion-acked.

5. **Watchdog integration.** mission_directive queue items participate in the existing ADR-017 watchdog ladder. Agent stalled mid-mission escalates like any other queue item.

### Producer API — how missions declare pendingWorkItems

Option A — explicit at mission creation:
```ts
create_mission({
  title: "M-Ideas-Audit",
  pendingWorkItems: [
    { kind: "open_thread", description: "Wave 1 — ADR-017 followups", ... },
    { kind: "open_thread", description: "Wave 2 — strategic architecture", ... },
    ...
  ]
})
```

Option B — progressive population:
Mission starts without workItems; each converging wave cascades an `add_mission_work_item` action. Allows dynamic scoping.

Option C — both. Recommended: support both; let mission-authoring pattern dictate.

---

## Implementation sketch

**Hub-side:**
- Mission entity extension (`hub/src/entities/mission.ts`): add pendingWorkItems, currentWorkItem.
- Cascade handler: `mission_advance` — fires on convergence-of-thread-owned-by-mission.
- New cascade action: `add_mission_work_item` for progressive population.
- New tool (optional): `mission_directive_complete` for agents that don't use sandwich auto-completion.
- Tests: E2E `mission-conductor.test.ts` — multi-wave mission converges without agent polling.

**Adapter-side:**
- `agents/vertex-cloudrun/src/sandwich.ts` — add `sandwichMissionDirective` handler.
- `adapters/claude-plugin/src/shim.ts` — dispatch mission_directive from drain queue (via dispatcher.ts wiring).
- `adapters/opencode-plugin/hub-notifications.ts` — same.

**Effort:**
- Hub changes: ~2 days.
- Adapter changes: ~1 day.
- Tests: ~half day.
- ADR-021 (mission-driven work dispatch): ~half day.
- **Total: ~4 engineer days.**

---

## Consolidated ideas

| Idea | Role |
|------|------|
| **idea-108** | This mission — umbrella |
| idea-112 (engineer autonomous-mission protocol doctrine) | Companion — codifies agent-side contract with conductor |
| idea-25 (Chore/Routine) | Future consumer — emits mission_directive on schedule |
| idea-47 (Hub-owned event loop, superseded by ADR-017) | Spiritual ancestor |

## Related but orthogonal

- **M-Cognitive-Hypervisor Phase 2** depends on this mission for "budget-exhaustion grace" (save state → conductor resumes later).
- **idea-110 (structural audit-action invariant)** — enforces mission-kind policies; conductor carries mission-context into cascade validation.

---

## Tele alignment

**Primary:** tele-2 (Frictionless Agentic Collaboration) — Hub drives; agents don't idle.
**Secondary:** tele-4 (Resilient Operations).

## Effort / Value / Urgency

- **Effort:** M (~4 engineer days).
- **Value:** L — eliminates 40% of Director-intervention causes; enables future recurring/scheduled mission classes.
- **Urgency:** high — blocks clean execution of any multi-wave autonomous mission.
- **Actionability:** ready. Leverages existing ADR-017 queue; additive change.

## Success criteria

1. M-Ideas-Audit replay using conductor: zero Director prompts needed for wave transitions.
2. E2E test: 3-wave mission converges end-to-end via conductor, no agent-side polling.
3. Watchdog correctly escalates a stuck mission_directive (no silent stalls).
4. ADR-021 committed + architect-ratified.

## Dependencies

None blocking. Ships standalone.

## Sequencing recommendation

- **Before M-Cognitive-Hypervisor Phase 2** — Hypervisor's budget-exhaustion grace needs conductor to resume saved state.
- **After idea-105 (watchdog SLA retune)** — clean watchdog baseline before adding mission_directive to the ladder.
- **Parallel with idea-104 (mock harness)** — test infrastructure benefits both.

---

## Autonomous-operation rules

1. No Director pings except at mission start + completion.
2. Architect ratifies ADR-021 mid-mission (one thread).
3. Fail-loud on invariant violations.

---

## Appendix: observed baseline (2026-04-19)

From M-Ideas-Audit:

| Director prompt # | Root cause |
|---|---|
| 1 | Architect cold-start (pre-min_instances=1). Mitigated by infra fix. |
| 2 | **Wave-4 convergence — no conductor signal.** ← this mission |
| 3 | **Wave-6 convergence — no conductor signal.** ← this mission |
| 4 | Tool-round exhaustion mid-reply. Addressed by M-Cognitive-Hypervisor Phase 1. |
| 5 | Architect stuck on a schema-error loop. Addressed by M-Cognitive-Hypervisor Phase 2. |

2/5 directly attributable to missing conductor. This mission reduces intervention rate by 40% on multi-wave missions.
