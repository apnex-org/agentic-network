# Entity Mechanics — per-entity FSM + status transitions + cascade behaviors

**Status:** v1.0 (architect-authored 2026-04-26 post mission-57 close + Director-ratified housekeeping discussion). Companion to `mission-lifecycle.md` v1.1; v1.1 covers macro-mechanics (lifecycle phases + RACI + sub-execution overview); this doc covers micro-mechanics (per-entity FSM + transitions + cascade behaviors).

**Position:** internal-mechanics reference for architect + engineer + future-collaborators. Director-engagement minimal (this is sub-execution detail; per `mission-lifecycle.md` §1.5 RACI matrix, Director is `I` for sub-execution mechanics).

**Source-of-truth boundary:**
- **`mission-lifecycle.md`** — macro-mechanics (lifecycle phases / who-does-what / Survey-then-Design / mission-class / pulse / autonomous-arc-driving / substrate-self-dogfood)
- **This doc** — micro-mechanics (per-entity FSM / status transitions / cascade behaviors / Hub-side primitive reference)

---

## §1 Entity catalog

| Entity | Purpose | Status field | Hub primitive |
|---|---|---|---|
| **Mission** | Committed arc of work; groups related tasks | `proposed` → `active` → `completed` (or `abandoned`) | create_mission / update_mission / get_mission / list_missions |
| **Idea** | Backlog artifact; concept-level; matures to Mission via Design phase | `open` → `triaged` → (`incorporated` / `dismissed`) | create_idea / update_idea / get_idea / list_ideas |
| **Task** | Per-task directive; spawned by architect via create_task or via mission plannedTasks cascade | `pending` → `working` → `needs_review` → `completed` (or `abandoned`; revision via `working`) | create_task / get_task / list_tasks |
| **Bug** | Bug filing; orthogonal to mission | `open` → `resolved` | create_bug / get_bug / update_bug / list_bugs |
| **Clarification** | Engineer-raised question blocking task progress | `pending` → `resolved` | create_clarification / get_clarification / resolve_clarification |
| **Thread** | Bilateral ideation discussion; Threads 2.0 (ADR-013/014) | `active` → (`converged` / `round_limit` / `closed` / `abandoned` / `cascade_failed`) | create_thread / create_thread_reply / get_thread / list_threads / leave_thread / close_thread / force_close_thread |
| **Proposal** | Architect-authored proposal entity | `open` → (`accepted` / `rejected`) | create_proposal / close_proposal / get_proposal / list_proposals / create_proposal_review |
| **Report** | Engineer-authored task report | Implicit (attached to parent task; status lives on parent) | create_report / get_report |
| **Review** | Instantaneous review entity; triggers downstream cascades | Instantaneous (no status field; `verdict ∈ {approved, revision_required}`) | create_review / get_review |
| **Turn** | Work-traced unit of agent activity; orthogonal to mission lifecycle | `planning` → `active` → `completed` | create_turn / get_turn / update_turn / list_turns |
| **Message** | Unified communication primitive (mission-51 ADR-025); push pipeline (mission-56 ADR-026) | `new` → `received` → `acked` (mission-56 W3.2 FSM) | create_message / claim_message / ack_message / list_messages |
| **PendingActionItem** (saga) | Saga FSM; queue dispatch to agent (ADR-017) | `enqueued` → `receipt_acked` → `completion_acked` (or `escalated` / `errored` / `continuation_required`) | get_pending_actions / drain_pending_actions / cancel_task / save_continuation / prune_stuck_queue_items |
| **Notification** (LEGACY) | Append-only notification record; SUNSET in mission-56 W4.2 | RETIRED (W4.2 sunset; `kind: "external-injection"` Message replaces) | (legacy emit retired) |
| **DirectorNotification** (LEGACY) | Director-routed escalation notification; SUNSET in mission-56 W4.1 | RETIRED (W4.1 sunset; `kind: "note"` + `target.role: "director"` Message replaces) | (legacy emit retired; helper preserves backward-compat MCP surface) |
| **ScheduledMessage** | One-off Hub-scheduled-Message primitive (mission-51 W4) | Implicit (`fireAt` timestamp; fires once) | create_message with `delivery: "scheduled"` + `fire_at` |
| **Pulse** (sub-entity of Mission) | Recurring agent coordination pulse (mission-57; per `mission-lifecycle.md` §4) | Embedded in Mission entity (`mission.pulses.{engineerPulse, architectPulse}`); sweeper-managed bookkeeping | (no dedicated tool; configured via update_mission; PulseSweeper drives) |
| **Audit-log** | Audit trail entry | Immutable (no status; append-only) | create_audit_entry / list_audit_entries |

---

## §2 Mission entity

### §2.1 Status FSM

```
proposed → active → completed
       ↓
    abandoned (rare; from any non-completed state)
```

### §2.2 Phase mapping (per `mission-lifecycle.md` §1)

- `proposed` ← Phase 5 Manifest (architect calls create_mission)
- `proposed → active` ← Phase 7 Release-gate (architect-flips per autonomous-arc-driving authority post-Director ratification)
- `active → completed` ← Phase 9 Close (architect-flips post-final-wave-merge)
- `* → abandoned` ← rare; mission scope-flex / structural failure

### §2.3 Schema fields

| Field | Type | Notes |
|---|---|---|
| `id` | string | mission-N |
| `title` | string | M-Mission-Name |
| `description` | string | comprehensive structured brief |
| `status` | enum | proposed / active / completed / abandoned |
| `correlationId` | string | typically `mission-N` |
| `tasks` | string[] | virtual-view computed from Task entities (read-only) |
| `ideas` | string[] | linked Ideas (e.g., source Idea via update_idea(missionId)) |
| `plannedTasks` | object[] | wave plan; cascade auto-issues on review-approval (idea-144 Path A) |
| `missionClass` | enum (optional) | per `mission-lifecycle.md` §3 taxonomy (mission-57 W1 added; PR #87) |
| `pulses` | object (optional) | per `mission-lifecycle.md` §4 pulse coordination (mission-57 W1+W2 added) |
| `documentRef` | string (optional) | external doc reference (rarely used; in-entity-brief preferred) |

### §2.4 Cascade behaviors

- `plannedTasks` cascade — on approved Review of issued Task, advance next-unissued plannedTask to issued (idea-144 Path A; task-316 cascade implementation)
- Pulse coordination cascade — PulseSweeper iterates active missions with `pulses.*` config; fires pulse Messages per cadence (per `mission-lifecycle.md` §4 + ADR-027)
- Mission-status flip cascades — pulse auto-suspend on `completed` / `abandoned` (per `mission-lifecycle.md` §4.3)

### §2.5 Cross-entity dependencies

- Source `Idea.missionId` field links Mission to originating Idea (Phase 5 Manifest)
- Tasks are Mission-scoped via `correlationId`
- Threads with `correlationId: mission-N` are mission-scoped
- Bugs may be Mission-scoped via `correlationId`

---

## §3 Task entity

### §3.1 Status FSM

```
pending → working → needs_review → completed
              ↑           ↓
              └─ revision_required ┘
                       ↓
                   abandoned
```

### §3.2 Cascade behaviors (canonical mission-execution path)

- `pending → working` ← engineer claim via `get_task` (next-pending-for-engineer)
- `working → needs_review` ← engineer creates Report via `create_report`
- `needs_review → completed` ← architect creates approved Review via `create_review` (`verdict: "approved"`)
- `needs_review → working` ← architect creates revision_required Review via `create_review` (`verdict: "revision_required"`); revision loop
- `* → abandoned` ← architect or engineer-decision; rare

### §3.3 Cross-entity dependencies

- Task is dispatched by architect (`create_task`) OR cascade-issued from `Mission.plannedTasks` (idea-144 Path A)
- Task's parent Mission is via `correlationId: mission-N`
- Task may have `dependsOn: [task-id]` for DAG behavior
- Task spawns Report on completion; Review on review

### §3.4 Anti-patterns

Per `feedback_plannedtasks_manual_create_mismatch.md` (bug-31): missions with plannedTasks should NOT manual-create Task entities (cascade-binding mismatch; cascade duplicates slot since manual task isn't bound). Use thread-dispatch instead OR ensure Task is created with proper plannedTasks-binding metadata.

mission-56 + mission-57 used **thread-dispatch pattern** (no formal Task entities; engineer claims via thread engagement; PR review = review-equivalent; architect admin-merge = approval-equivalent) — sidesteps task-316 cascade entirely. plannedTasks remain `unissued` throughout.

---

## §4 Cascade catalog

### §4.1 Thread convergence cascade (Threads 2.0)

When `create_thread_reply(converged=true)` is called with `stagedActions[]` + non-empty `summary`:

1. Hub validates stagedActions schema (per cascade-handler validation gate)
2. Hub commits all staged actions atomically
3. Each committed action invokes its registered cascade handler:
   - `close_no_action` — no entity spawn (purely-ideation thread; close)
   - `create_task` — spawns Task entity with `sourceThreadId` + `sourceActionId` + `sourceThreadSummary` back-link
   - `create_proposal` — spawns Proposal entity with back-links
   - `create_idea` — spawns Idea entity with back-links
   - `update_idea` — updates Idea entity (status / text / tags)
   - `update_mission_status` — updates Mission entity status
   - `propose_mission` — spawns Mission entity at status=proposed
   - `create_clarification` — spawns Clarification entity
   - `create_bug` — spawns Bug entity
4. Thread status flips `active → converged`
5. Hub fires `thread_convergence_finalized` event

Reference: ADR-013 + ADR-014 + mission-24 Phase 2 cascade-handler set.

### §4.2 PR-merge cascade (mission-56 W2.x push pipeline)

When PR merges to main:
1. GitHub webhook fires (mission-56 W2.x adapter SSE handler)
2. Architect adapter receives notification via push pipeline
3. Architect proceeds to next mission-coordination action (e.g., dispatch next wave thread)

mission-56 W2.x adapter SSE handler closes bug-34 (calibration #4 manual ping discipline) structurally.

### §4.3 plannedTasks cascade (mission entity; idea-144 Path A; task-316 implementation)

When approved Review of an issued plannedTask Task entity is created:
1. Hub looks up parent Mission's plannedTasks
2. Identifies next-unissued plannedTask in sequence order
3. Auto-spawns Task entity with plannedTask description + correlationId
4. Updates plannedTask status → issued; sets issuedTaskId

Mission-56 + mission-57 used thread-dispatch instead of plannedTasks cascade (per §3.4 anti-pattern note).

### §4.4 Pulse-fire cascade (mission-57 ADR-027)

PulseSweeper ticks every 60s:
1. Iterates active Missions with `pulses.*` config
2. Per pulse, evaluates fire-due + missed-threshold + precondition + 3-condition missed-count guard (E2)
3. Fires pulse Message via `create_message` with deterministic migrationSourceId (Item-1) + `target.role: "engineer" | "architect"` + `kind: "external-injection"` + `payload.pulseKind: "status_check"`
4. Updates `pulses.<role>.lastFiredAt` bookkeeping
5. On missed-threshold breach: emits architect-routed escalation Message (E1 mediation-invariant fix; Option C no-migrationSourceId on escalation)

Reference: ADR-027 + `mission-lifecycle.md` §4 + Design v1.0 m-mission-pulse-primitive §4.

### §4.5 ack_message webhook (mission-57 W2 Item-2)

When `ack_message(messageId)` flips Message status to `acked`:
1. message-policy.ts ackMessage handler post-status-flip checks `payload.pulseKind === "status_check"`
2. If yes: invoke `pulseSweeper.onPulseAcked(message)` webhook
3. PulseSweeper resets `pulses.<role>.missedCount` + updates `lastResponseAt`

Reference: mission-57 W2 PR #88 message-policy.ts extension.

### §4.6 Message-status-FSM cascade (mission-56 W3.2)

Message status FSM `new → received → acked`:
- `new → received` ← consumer adapter calls `claim_message(messageId, agentId)` (winner-takes-all CAS via `putIfMatch`)
- `received → acked` ← consumer adapter calls `ack_message(messageId)` post-action

Multi-agent claim race: winner sets `claimedBy: agentId`; losers observe + drop. Hybrid push+poll backstop (mission-56 W3.3) ensures at-least-once delivery via cursor-replay + 5min poll cadence.

---

## §5 Hub-side primitives reference

### §5.1 Storage primitives (ADR-024)

- `createOnly(entityType, id, blob)` — create new entity; fails if exists
- `putIfMatch(entityType, id, blob, etag)` — atomic update with CAS via etag
- `getWithToken(entityType, id)` — read entity + return etag

All entity persistence uses these primitives. No separate per-entity storage layer.

### §5.2 Message primitive (ADR-025; mission-51)

- `create_message({kind, target, delivery, payload, migrationSourceId?})` — emit Message
- `list_messages({target?, status?, kind?, since?})` — query Messages
- `claim_message(id, agentId)` — winner-takes-all CAS for actionable Messages
- `ack_message(id)` — mark consumer-action complete

### §5.3 Push pipeline (ADR-026; mission-56)

- Hub-side push-on-Message-create — SSE event fires synchronously after Message commit
- Last-Event-ID protocol — cold-start replay with soft-cap synthetic event (~1000)
- @ois/message-router — Layer-2 router; seen-id LRU N=1000; kind/subkind routing
- Adapter Layer-3 shims — claude-plugin + opencode-plugin source-attribute taxonomy

### §5.4 Scheduled-Message primitive (mission-51 W4)

- `create_message({delivery: "scheduled", fire_at: timestamp, ...})` — fires once at specified time
- ScheduledMessage sweeper iterates pending; fires due Messages
- One-off only; non-recurring (recurring case handled by PulseSweeper per ADR-027)

### §5.5 Pulse primitive (ADR-027; mission-57)

- Mission entity gains `pulses.{engineerPulse, architectPulse}` declarative config (mission-57 W1)
- PulseSweeper drives at 60s tick (mission-57 W2)
- Per-class default cadences emerge as `mission-lifecycle.md` §4 conventions (NOT Hub primitives)
- Composes with Message primitive + push pipeline + W3.2 claim/ack FSM via webhook

### §5.6 Director-notification primitive (post mission-56 W4.1 sunset)

- `list_director_notifications` MCP tool surface preserved (backward-compat)
- `acknowledge_director_notification` MCP tool surface preserved
- Under-the-hood: routes through `messageStore.createMessage` with `kind: "note"` + `target.role: "director"` + `payload.{severity, source, sourceRef, title, details}` (per mission-56 W4.1 helper)

### §5.7 Audit-log primitive

- `create_audit_entry({entityRef, action, payload, ...})` — append-only audit trail
- `list_audit_entries({entityRef?, action?, since?, limit?})` — query audit trail

---

## §6 Cross-references

- **`mission-lifecycle.md` v1.1** — companion macro-mechanics doc (lifecycle phases / RACI / Survey / mission-class / pulse / autonomous-arc-driving / substrate-self-dogfood)
- **`multi-agent-pr-workflow.md`** — PR cross-approval mechanics
- **`mission-preflight.md`** — Phase 6 preflight audit checklist
- **`idea-survey.md` v1.0** — Phase 3 Survey methodology
- **`calibration-23-formal-design-phase.md`** — Phase 4 formal Design phase per Idea
- **`strategic-review.md`** — backlog triage cadence
- **`reference_idea_to_mission_workflow.md`** (architect memory) — workflow chain reference
- **ADR-013 + ADR-014** — Threads 2.0 (cascade handlers)
- **ADR-017** — pending-action saga
- **ADR-024** — StorageProvider boundary
- **ADR-025** — Message primitive
- **ADR-026** — Push pipeline + Layer-2 router (mission-56)
- **ADR-027** — Pulse primitive + PulseSweeper (mission-57)
- **`feedback_plannedtasks_manual_create_mismatch.md`** — bug-31 anti-pattern note
- **`feedback_substrate_self_dogfood_discipline.md`** — substrate-vs-enrichment refinement
- **`feedback_retrospective_modes.md`** — 3-mode retrospective taxonomy

---

*Entity Mechanics v1.0; ratified 2026-04-26 by Director (post mission-57 close + housekeeping discussion). Companion to `mission-lifecycle.md` v1.1. Architect: lily.*
