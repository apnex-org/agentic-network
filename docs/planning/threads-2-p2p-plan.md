# Threads 2.0 — direct P2P plan

**Status:** archived planning artefact · Ratified Phase 2 Architecture section promoted to [ADR-014](../decisions/014-threads-2-phase-2-architecture.md) on 2026-04-18. Retained for mission-phasing, working log, and held/out-of-scope context; decisions are authoritative in ADR-014.
**Owner:** Director · **Started:** 2026-04-18 · **Architecture ratified:** 2026-04-18 via thread-125 · **Promoted to ADR-014:** 2026-04-18

## Goal

Direct, private, autonomous peer-to-peer threads between any pairs of roles. Concretely: two local Claude Code engineers (or an architect and an engineer, or Director↔Architect, or future Director↔Director) open a thread with each other, converge on an outcome, and optionally spawn entities — without any third agent observing the conversation or participating in convergence. Goal standard: frictionless perfection.

## Current state (2026-04-18)

### Production

- Hub revision `hub-00008-8tx` — participant-scoped routing (INV-TH16/17) + `recipientAgentId` live.
- Architect revision `architect-agent-00023-7s5` — tool-driven sandwich reply, cascade guard, 60s director-chat TTL.
- Engineer plugins carry Threads 2.0 discipline in `adapters/opencode-plugin/AGENTS.md` Ideation Threads section and the per-notification prompt text (`packages/network-adapter/src/prompt-format.ts`).

### Commits on `main` (chronological)

| SHA | Summary |
|-----|---------|
| `4cb52e7` | M21 Phase 1 core — staged actions, summary, participants, gate |
| `9d951f5` | M21 Phase 1 hardening — architect prompt + digest wiring |
| `f2f3799` | M21 Phase 1 hardening — tool-driven thread replies + cascade guard |
| `fc7f8d3` | M21 Phase 1 hardening — participant-scoped routing + 3-agent smoke |
| `2076ead` | M21 Phase 1 hardening — engineer-plugin Threads 2.0 discipline + P2P plan |
| `0f83106` | Deflake WF-TH-08 (same-ms timestamp race) |
| `26ed0f8` | `OIS_INSTANCE_ID` env override on globalInstanceId |
| `dd90882` | `start-claude.sh` requires `<name>` argument |
| `5b4e4fb` | Docs — record Tier 1 T4 PASS (greg↔kate live P2P smoke) |
| `f66ecc3` | Docs — Tier 1 T4 extended (autonomous-loop chain + `close_thread` role guard finding) |

### Test state

- Hub 299 + network-adapter 84 passing.
- `packages/network-adapter/test/integration/threads-2-smoke.test.ts` — 11 scenarios covering turn alternation, gate rejection, cascade, stage/revise/retract lineage, round limit, participant upsert, authorAgentId, summary refinement, and the two isolation cases (arch↔eng silent to eng-2; eng↔eng silent to architect; non-participants rejected).

### Live evidence on prod

Four P2P threads validated end-to-end with zero architect audit entries on any of them:

| Thread | Shape | Outcome |
|---|---|---|
| `thread-122` | greg↔kate basic | bilateral close_no_action; isolation confirmed |
| `thread-123` | greg→kate chain-test | bilateral close after `close_thread` role-guard finding |
| `thread-124` | kate→greg reply chain | bilateral close; autonomous multi-step loop validated |
| `thread-125` | greg↔architect design review (8 rounds) | ratified the full Phase 2 architecture below |

---

## Ratified Phase 2 architecture (thread-125, 2026-04-18)

This section is the authoritative architectural record until it is promoted to ADR-014. Every decision below was agreed in rounds 1–9 of thread-125 between greg (engineer) and architect-agent.

### Routing — three modes, declared at open, never auto-switched

1. **Targeted** — caller passes `recipientAgentId`. Dispatch pins to that specific agentId via `Selector.engineerIds`. Participant set is **closed** at open to `[opener, recipient]` — no late joiners, no reply-injection. Serves ideation-between-minds.
2. **Broadcast** — caller passes `recipientRole` (+ optional `matchLabels`). Dispatch uses `{roles, matchLabels}` selector until first reply. On first reply the thread **coerces to Targeted** with the responder as the second (and only) other participant. Serves pool-discovery ("send to whichever engineer has the frontend label").
3. **Context-bound** — caller passes `context: {entityType, entityId}` (task / mission / etc). Dispatch uses **dynamic membership** — `PolicyRouter` resolves the participant set at each turn from the bound entity's current assignee(s). Serves discussion-about-work — thread follows the work when the work changes hands. Staged actions **persist** across reassignment (refinement α); the new participant can revise/retract/converge on inherited staged actions.

The legacy role+label fallback when participants have no resolved agentIds is **eliminated**. Mode is declared at open, immutable for the thread's lifetime.

### Termination — FSM widened

```
active → { converged | round_limit | closed | abandoned | cascade_failed }
```

Five terminal states, each with distinct audit-entry action names and metrics paths.

- **`converged`** — bilateral agreement via the gate; cascade fires.
- **`round_limit`** — `roundCount >= maxRounds` reached without convergence.
- **`closed`** — Architect-only `close_thread` stewardship tool. For administrative cleanup. Architect does not need to be a participant.
- **`abandoned`** — new. Any participant calls `leave_thread`. Auto-retracts the leaver's staged actions. Remaining participants receive `thread_abandoned` notification. Architect NOT notified unless a participant. Hub audit actor = leaver's agentId.
- **`cascade_failed`** — new. Post-gate infrastructure failure during execute phase. High-priority alert to Architect + Director. No automatic retry; manual resolution.

**Thread Expiry Invariant**: any thread in `active` status with `now - updatedAt > thread.idleExpiryMs` (default 7 days, deployment-configurable) is transitioned by a Hub reaper to `abandoned`. Audit action name `thread_reaper_abandoned` distinguishes from human `leave_thread`. Reaper runs periodically (~1h) for deterministic behaviour.

### Cascade atomicity — validate-then-execute

Two phases, no rollback.

**Gate (synchronous at `converged: true` + staged actions + summary):**
1. VALIDATE every staged action (schema-valid args, referenced entities exist, target states are permissible).
2. If ANY validator fails → reject convergence with consolidated error. Thread stays `active`. No staged→committed promotion. Caller fixes and retries.
3. If ALL validators pass → promote staged→committed atomically, transition to `converged`, dispatch cascade.

**Execute (async post-gate):**
- Runs committed actions. By construction of validators, execution is near-certain to succeed.
- Any failure here is infrastructure (GCS write failed, store unavailable). Thread transitions to `cascade_failed` terminal. Audit entry records which action(s) failed. No thread-revert, no auto-retry.

"Committed means committed." The gate is the one-way transition; post-gate failure is an infrastructure fault, not a logical rollback.

### Phase 2 action vocabulary

**Autonomous (convergence-spawnable):**
- `close_no_action` — Phase 1 type, retained.
- `create_task`
- `create_proposal`
- `create_idea`
- `update_idea`
- `update_mission_status` — status transitions only (e.g. `active → paused`)
- `propose_mission` — creates Mission in `draft`, Director approves to activate
- `create_clarification`

**Director-gated (scope-widening, NOT autonomous):**
- `create_mission` — Director sovereign
- `update_mission_scope` — goal/description edits
- `cancel_task` — un-authorizes existing work

**Principle:** actions that *widen authorization scope* require Director. Actions that *operate within existing authorization* are autonomous.

### Idempotency

Natural key: `{sourceThreadId, sourceActionId}`. Cascade handler checks for existing entity with this pair before create. If found: skip, emit `action_already_executed` audit entry, mark in ConvergenceReport. No client-supplied idempotency key needed.

### Entity back-linking

Every entity spawned via cascade carries three first-class metadata fields:

```ts
{
  sourceThreadId: "thread-N",
  sourceActionId: "action-M",
  sourceThreadSummary: "<negotiated summary, frozen at commit>"
}
```

`sourceThreadSummary` is the **Summary-as-Living-Record** invariant — the consensus narrative is preserved immutably on the spawned entity even if the thread itself is later archived.

### Proposer provenance

`StagedAction.proposer` widens from `role` to `{role, agentId}`. Critical for P2P audit trails where multiple agents share a role.

### Events

`thread_converged` and `thread_convergence_completed` merge into a single `thread_convergence_finalized` event carrying the full ConvergenceReport. Participant-scoped dispatch (INV-TH16) applies.

### Peer discovery

New tool: **`list_available_peers(role?, matchLabels?)`** returning pruned `{agentId, role, labels}` per match. Supersedes `get_engineer_status` for LLM consumption in thread-opening scenarios.

### Director in threads

- Reserved agentId prefix **`director-*`** (not literal `"director"` — future-proofing for multi-human co-Director workflows).
- Notification surface: **chat-session injection** — when a `thread_message` targets the Director's agentId, it appears as a high-priority prompt in the active chat session.
- When no chat session is attached: queues and surfaces at next `/status` interaction.
- Director opens and replies via `create_thread` / `create_thread_reply` from the chat session's tool-use loop — no special-case path.

### New invariants for `workflow-registry.md` §1.3

To be added during mission M-Ratify (below):

- **INV-TH16** — dispatches follow thread participants, not role membership. Selector.engineerIds drives routing when participants are resolved.
- **INV-TH17** — reply turn pinned by `currentTurnAgentId` in addition to role. authorAgentId mismatch rejects.
- **INV-TH18** — routing mode (Targeted / Broadcast / Context-bound) declared at open, immutable for thread lifetime.
- **INV-TH19** — cascade atomicity via validate-then-execute at gate; no post-commit rollback.
- **INV-TH20** — idempotency via `{sourceThreadId, sourceActionId}` natural key; cascade checks existence before create.
- **INV-TH21** — thread expiry via Hub reaper on idle > `thread.idleExpiryMs`.
- **INV-TH22** — StagedAction proposer carries `{role, agentId}`.
- **INV-TH23** — summary frozen at commit is preserved on every cascade-spawned entity (Summary-as-Living-Record).

---

## Mission phasing — execution order

Four missions emerge. Sequence them as follows.

### Mission 0 — M-Ratify (persistence of decisions, zero code)

Capture the Ratified Architecture section above into permanent specification docs. No behaviour change.

- [ ] **ADR-014** drafted — full Phase 2 architecture; supersedes the Phase 2 placeholder sections of ADR-013; ADR-013 retained as the Phase 1 record.
- [ ] **`docs/specs/workflow-registry.md` §1.3** amended — ratify INV-TH16/17 with thread-125 as provenance; add INV-TH18–23.
- [ ] Planning doc (this file) marked "promoted to ADR-014" when complete.

Size: ~0.5 day. Outcome: all architectural decisions persist in spec regardless of whether thread-125 is ever archived.

### Mission 1 — M-Phase2-Impl (the main implementation mission)

Execute the Phase 2 architecture. Depends on M-Ratify (so the spec is already written before we implement).

Schema + policy changes:
- [ ] Thread schema — add `routingMode` enum, `context` field, `currentTurnAgentId`, `recipientAgentId` (already present), new terminal states (`abandoned`, `cascade_failed`).
- [ ] Selector — keep `engineerIds` pool (from Phase 1 hardening).
- [ ] Eliminate the role+label fallback when participants lack resolved agentIds. Make routingMode authoritative.
- [ ] Widen `StagedAction.proposer` to `{role, agentId}`.
- [ ] Widen `stagedActions.type` Zod enum to include the 8 autonomous action types.
- [ ] Per-action-type validators implementing validate-then-execute.
- [ ] Per-action-type cascade handlers. Each handler sets `sourceThreadId`, `sourceActionId`, `sourceThreadSummary` on the spawned entity.
- [ ] Idempotency check in cascade — before create, query for existing entity with matching `{sourceThreadId, sourceActionId}`. Skip + audit if found.
- [ ] `leave_thread` tool — participant-only; auto-retract leaver's staged actions; dispatch `thread_abandoned` to remaining participants.
- [ ] `close_thread` — retained as Architect-only stewardship. Description tightened to reflect the new `leave_thread` boundary.
- [ ] Thread reaper — periodic hub task; transitions idle threads to `abandoned` with `thread_reaper_abandoned` audit action.
- [ ] Broadcast-coerces-to-Targeted on first reply logic.
- [ ] Event merge — `thread_converged` + `thread_convergence_completed` → `thread_convergence_finalized` carrying full ConvergenceReport.
- [ ] `list_available_peers(role?, matchLabels?)` tool; prune return shape.
- [ ] Director participation — reserved `director-*` agentId prefix; chat-session handshake binds Director to a stable agentId; chat-injection notification path.

Test coverage:
- [ ] Un-skip and rewrite the 10 Phase 2 tests in `hub/test/wave3b-policies.test.ts` / `hub/test/e2e/e2e-convergence-spawn.test.ts`.
- [ ] Extend `threads-2-smoke.test.ts` with: routing-mode exclusivity, Broadcast-coerce-to-Targeted, Context-bound dynamic membership (including staged-action persistence across reassignment), `leave_thread` + `abandoned` terminal, thread expiry reaper, cascade atomicity (validator failure + infrastructure failure paths), each Phase 2 action type spawning its entity with correct back-linking, idempotency replay safety.
- [ ] `list_available_peers` unit + integration tests.
- [ ] Director-in-threads E2E scenario.

Size: substantial — probably 3–5 days of engineering work, multiple commits, one Hub deploy + one Architect deploy to activate chat-injection.

### Mission 2 — M-SandwichHardening (parallel with M-Phase2-Impl)

Authorized by architect in thread-125 round 8. Addresses the failure mode observed on thread-125 round 5 itself — sandwich LLM emitted text without calling `create_thread_reply`, fallback 300s poll caught it but with 5+ minute latency.

- [ ] Immediate-retry topology — on sandwich failure (LLM-tool-call-miss, transient 4xx/5xx), enqueue one immediate retry with jittered backoff before the 300s poll fallback.
- [ ] Thread-prompt context pruning — don't re-prefetch static docs on every round; support progressive thread-history summarization so long threads don't monotonically grow the prompt.
- [ ] Sandwich unit-test harness — mock `HubAdapter` + `ContextStore`; cover all five sandwiches (thread reply, thread converged, review report, review proposal, clarification). Locks in the tool-driven contract so the prose-promise failure class cannot silently regress.

Size: 1–2 days. Can run parallel to M-Phase2-Impl; mostly touches the Architect service.

### Mission 3 — M-Phase3-Polish (after both above land)

- [ ] Legacy code removal — any remaining single-`convergenceAction` scaffolding from pre-Phase-1 that survived the cutover.
- [ ] Observability metrics — gate-rejection counters by reason; per-action-type exec success/fail; participant-count histogram; round-at-convergence histogram; cascade-latency percentiles.
- [ ] Director digest integration — surface `thread_convergence_finalized` summaries in `/status`.

Size: 1 day.

---

## Held / out-of-scope

- **agentId ↔ engineerId naming unification** — idea-85. Blocked on Entity SSOT mission (hub-mission-22). A pragmatic escape hatch shipped in commit `26ed0f8` (the `OIS_INSTANCE_ID` env override) to unblock multi-Claude co-location; the proper design lives with the naming mission.
- **N-party convergence (3+ participants)** — deliberately excluded. Broadcast coerces to Targeted on first reply; Context-bound has dynamic membership but convergence remains 2-party (current participants). A group-discussion primitive, if ever needed, is a separate design with its own gate semantics.

---

## Working log

- 2026-04-18 — Doc created. Tier 1 starting.
- 2026-04-18 — T1 (Hub deploy) + T2 (engineer instructions) shipped. T4 two-engineer smoke PASSED: greg↔kate thread-122 with zero architect audit entries. INV-TH16 + INV-TH17 validated live on prod.
- 2026-04-18 — `OIS_INSTANCE_ID` env override + `start-claude.sh <name>` argument shipped. Extended T4 with autonomous-loop chain test (thread-123 + thread-124). Kate's Claude Code parsed a multi-step ask, attempted both actions, reported faithfully on the blocked step, and chained cleanup to bilateral convergence on both threads.
- 2026-04-18 — Finding: `close_thread` is role-guarded at the plugin/proxy layer, not advisory. Raised to Architect review thread.
- 2026-04-18 — **thread-125 Architect review** — 8 rounds, greg↔architect. Full Phase 2 architecture ratified: three routing modes, termination FSM, validate-then-execute atomicity, action vocabulary with scope-of-commitment principle, idempotency via natural key, entity back-linking with summary-as-living-record, proposer provenance widening, event merge, peer discovery tool, Director integration with `director-*` prefix, thread expiry reaper. All decisions frozen in thread-125's summary per the Summary-as-Living-Record invariant. Sandwich retry latency surfaced as separate hardening mission and authorized.
- 2026-04-18 — This file updated with the ratified architecture and mission phasing. Next: draft ADR-014 and amend `workflow-registry.md` (M-Ratify).
- 2026-04-18 — **M-Ratify task A complete.** Ratified Phase 2 Architecture section promoted to [`docs/decisions/014-threads-2-phase-2-architecture.md`](../decisions/014-threads-2-phase-2-architecture.md). ADR-014 supersedes the "Phase 2 (deferred)" and "Phase 3 (deferred)" placeholder sections of ADR-013; ADR-013 retained as the immutable Phase 1 record. This planning doc is now an archived artefact — ADR-014 is authoritative for the architecture; mission phasing, held items, and working log remain here for provenance.
