# ADR-017: Persist-first pending-actions queue + liveness FSM for agent↔agent comms

**Date:** 2026-04-19
**Status:** Proposed (Director approved shape; architect review deferred — cannot review self-diagnosing ADR while bug-10 in play)
**Builds on:** ADR-005 (persist-first notifications), ADR-014 (thread cascade), ADR-016 (thread dispatch agentId-first)
**Addresses:** bug-10 (architect non-response class); five observed instances on thread-135; thread-137 silent stuck

---

## Decision

**Principle:** *SSE is a delivery hint. The persisted pending-actions queue is the authoritative source of owed work. The Hub enforces agent liveness against the queue, not against sockets. No silent drops — ever.*

Six changes land as one architecture:

1. **Durable per-agent pending-actions queue.** Every Hub-emitted event that owes a specific agent a response enqueues a `PendingActionItem` on that agent's queue **before** SSE dispatches. The queue is GCS-backed, idempotent via natural key `{targetAgentId, entityRef, dispatchType}`.

2. **Two-stage ACK lifecycle.** Every queue item transitions `enqueued → receipt_acked → completion_acked` with explicit deadlines on each transition. Receipt ACK (liveness proof) fires when the agent calls `drain_pending_actions`. Completion ACK (work-landed proof) fires implicitly when the settling action (e.g., `create_thread_reply`, `auto_review`) references the queue item's ID.

3. **Hub-side watchdog with deterministic escalation ladder.** A stateless watchdog (state derived from queue-item deadlines) enforces SLAs. Escalation: re-dispatch SSE + durable wake → demote liveness state → escalate to Director notification. Every step is auditable.

4. **Liveness FSM replaces boolean `online`.** States: `online | degraded | unresponsive | offline`. Driven by heartbeat + queue-drain progress, not socket state. Eliminates the "online with 3h-stale lastSeenAt" class of lie observed today.

5. **Durable cold-start wake for scaled-to-zero agents.** Agents register an optional `wakeEndpoint` at `register_role` time. Watchdog makes authenticated outbound HTTP POST to this URL on deadline miss, waking scaled-to-zero Cloud Run (or equivalent) instances. Work is preserved across any instance lifecycle — zero job loss guarantee.

6. **Hub-native `DirectorNotification` entity.** Escalation-terminal surface. Hub persists escalation events into a first-class notification store; the Director-chat layer consumes from this store when it lands (decoupled from this ADR; no dependency on idea-86 / ACP redesign).

---

## Context

### What we observed

Bug-10 surfaced in thread-137 (a real architect-review request that never got processed). Audit trail analysis revealed a recurring class:

- **thread-137** (2026-04-19 02:25 UTC): architect currentTurn holder, no audit entry, no participant upsert, no reply. Architect status `online` but `lastSeenAt` 3+ hours stale.
- **thread-135** (2026-04-18 22:37–22:43 UTC): five `auto_thread_reply_failed` entries ("exceeded tool-call rounds without converging") before a successful retry.
- **Director chat** (concurrent with thread-137): "I reached the maximum number of tool-calling rounds" — confirming architect runtime hit a cognitive ceiling on a separate invocation.

Three distinct failure modes, all converging on the same symptom: **agent owes a response, Hub has no way to know whether it arrived, user finds out by asking "why is X still open?"**.

### Why SSE-alone is insufficient

SSE was designed as a **delivery mechanism**, not a **reliability mechanism**. The current Hub emits SSE on dispatch and treats successful emission as "the work has been delegated". This conflates three things:

1. **Network delivery** — did the bytes reach the agent process?
2. **Agent receipt** — did the agent runtime actually ingest and queue the event?
3. **Agent action** — did the agent do the work?

SSE only answers (1), and even that is best-effort. There is no ACK. Cloud Run scale-to-zero means SSE connections drop on idle. Restart means in-flight events vanish. Tool-round exhaustion silently kills reply-handlers mid-flight. None of these are caught.

### Why the queue wins

A durable queue separates these three concerns:
- **Enqueue** is the dispatch-of-record. It is synchronous, transactional, survives any downstream failure.
- **Receipt ACK** is an independent proof of agent liveness, observable at the Hub.
- **Completion ACK** is proof of work landing, observable via the settling action's `sourceQueueItemId` reference.

The queue also makes the watchdog trivial to implement correctly: every deadline is stored alongside the item; the watchdog is a stateless scanner, tolerant to Hub restart, with no in-memory timer state to lose.

### Why "impossible by design"

Every observed failure mode maps to a recoverable signal in this design:

| Observed mode | Today's symptom | New design's response |
|---------------|-----------------|-----------------------|
| SSE never received | Silent drop | Queue still has the item. Next drain recovers. |
| Architect process dead | Stale `online` flag; silent drop | Receipt-ACK deadline fires → durable wake → demote on repeat → escalate |
| Reply-path error swallowed | Silent drop | Completion ACK missing; watchdog surfaces it. |
| Tool-round exhaustion | 5× silent retries audit-only | Receipt ACK fires (alive) + Completion ACK misses → diagnostic escalation. Root fix still needs ACP (idea-86) but symptom is contained. |
| Stale-online liveness | `online` + 3h-stale lastSeenAt | Heartbeat FSM demotes automatically. No lies. |

---

## Schema

### `PendingActionItem`

```ts
interface PendingActionItem {
  id: string;                      // e.g., "pa-2026-04-19T02-25-08-abc123"
  targetAgentId: string;           // canonical agent to act
  dispatchType:                    // what kind of event
    | "thread_message"
    | "thread_convergence_finalized"
    | "task_issued"
    | "proposal_submitted"
    | "report_created"
    | "review_requested";
  entityRef: string;               // threadId | taskId | proposalId | reportId
  naturalKey: string;              // `${targetAgentId}:${entityRef}:${dispatchType}` — idempotency key
  payload: Record<string, unknown>; // full event payload for drain return
  enqueuedAt: string;              // timestamp
  receiptDeadline: string;         // enqueuedAt + receiptSla (default 30s)
  completionDeadline: string;      // enqueuedAt + completionSla (policy-per-type)
  receiptAckedAt: string | null;
  completionAckedAt: string | null;
  attemptCount: number;            // wake attempts so far
  lastAttemptAt: string | null;
  state:
    | "enqueued"
    | "receipt_acked"
    | "completion_acked"         // terminal (success)
    | "escalated"                 // terminal (handed to Director)
    | "errored";                  // terminal (non-recoverable)
  escalationReason?: string;
}
```

### `Agent` — additions

```ts
interface Agent {
  // ... existing fields ...
  wakeEndpoint?: string;           // optional: HTTP URL Hub POSTs to on deadline miss
  livenessState:                   // replaces boolean `online`
    | "online"                     // heartbeat fresh + queue drain progressing
    | "degraded"                   // stale heartbeat OR stuck queue items
    | "unresponsive"               // missed 2+ receipt deadlines
    | "offline";                   // explicit disconnect or >M min unresponsive
  lastHeartbeatAt: string;         // every drain_pending_actions updates this
}
```

### `DirectorNotification`

```ts
interface DirectorNotification {
  id: string;                      // e.g., "dn-2026-04-19-001"
  severity: "info" | "warning" | "critical";
  source:                          // what generated it
    | "queue_item_escalated"
    | "agent_unresponsive"
    | "cascade_failed"
    | "manual";
  sourceRef?: string;              // e.g., queue item id, agent id, thread id
  title: string;
  details: string;                 // markdown; full diagnostic
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;   // agentId of acknowledger (typically director-*)
}
```

### `register_role` extension

```ts
// Add to existing payload:
wakeEndpoint?: string;             // agent-supplied Cloud Run URL or equivalent
receiptSla?: number;               // milliseconds; default 30000
completionSla?: Record<DispatchType, number>; // per-type overrides
```

---

## Mechanics

### §M1 — Enqueue (producer side; Hub)

Every dispatch path that owes a specific agent a response follows the same pattern:

```ts
// Before SSE fires:
const item = await pendingActionStore.enqueue({
  targetAgentId,
  dispatchType: "thread_message",
  entityRef: threadId,
  payload: { threadId, message, ... },
});
// Then emit SSE as a hint:
dispatch(event, data, selector);
```

Enqueue is transactional with the originating state change (thread mutation, task creation, etc.) — either both land or neither does. Natural-key idempotency prevents duplicates if retry logic re-fires enqueue.

### §M2 — Drain protocol (consumer side; Agent)

Agents call `drain_pending_actions` as the first step of every wake cycle. The tool:

1. Returns all queue items for `targetAgentId == callerAgentId` in state `enqueued`.
2. Flips each returned item's state to `receipt_acked` with `receiptAckedAt = now`.
3. Updates the caller's `lastHeartbeatAt` + bumps `livenessState` toward `online` if currently `degraded`/`unresponsive`.

The agent then processes each item. Each settling action (e.g., `create_thread_reply`) accepts an optional `sourceQueueItemId` parameter. When present, the Hub flips the item to `completion_acked` atomically with the action's commit.

### §M3 — Watchdog (Hub-side enforcement)

Background scanner runs on fixed interval (e.g., every 5s). On each tick:

```
for item in queue where state in {enqueued, receipt_acked}:
  if state == enqueued and now > receiptDeadline:
    // Stage 1: re-dispatch
    if item.attemptCount == 0:
      re-fire SSE
      POST to agent.wakeEndpoint (if set)
      increment attemptCount
    elif item.attemptCount == 1:
      // Stage 2: demote + retry
      agent.livenessState = "degraded"
      POST to agent.wakeEndpoint
      increment attemptCount
    else:
      // Stage 3: escalate
      item.state = "escalated"
      agent.livenessState = "unresponsive"
      DirectorNotification.create({source: "queue_item_escalated", ...})

  elif state == receipt_acked and now > completionDeadline:
    // Alive but stuck — different failure mode
    DirectorNotification.create({source: "agent_stuck", ...})
    item.state = "escalated"
```

Stateless — watchdog owns no in-memory timers. Hub restart resumes seamlessly from queue state.

### §M4 — Durable wake for scaled-to-zero

On Stage 1 re-dispatch, Hub makes an authenticated POST to `agent.wakeEndpoint`. For architect on Cloud Run, this cold-starts a new instance. The instance boots, calls `drain_pending_actions`, processes, acks. When idle, Cloud Run scales back to zero. Next deadline miss wakes again. Work survives any number of scale-to-zero cycles.

Wake authentication: Hub signs a short-lived JWT identifying itself as the caller, with scope `agent-wake-only`. Cloud Run service validates the signature before processing (no public wake endpoint).

### §M5 — Liveness FSM transitions

```
  online ─── no heartbeat in 2× receiptSla ───▶ degraded
  degraded ─── drain on next wake ───▶ online
  degraded ─── 2nd deadline miss ───▶ unresponsive
  unresponsive ─── drain on next wake ───▶ online (optimistic recovery)
  unresponsive ─── >5 min still unresponsive ───▶ offline
  offline ─── explicit register_role ───▶ online
```

`get_available_peers` filters `livenessState in {online, degraded}` by default — unresponsive + offline agents are invisible to routing.

### §M6 — Director notifications as the terminal escalation surface

On Stage 3 escalation, the Hub persists a `DirectorNotification`. This is the terminal surface in this ADR — no chat rendering, no push to an external system. The Director-chat redesign (idea-86) will later consume from this store via whatever ACP or polling surface emerges.

---

## Invariants (added to `docs/specs/workflow-registry.md` §1.4 "Comms Reliability Layer")

- **INV-COMMS-L01** — Every dispatched event that owes a specific agent a response MUST be durably enqueued on that agent's pending-actions queue **before** SSE fires. Enqueue is transactional with the originating state change.
- **INV-COMMS-L02** — Every queue item has both `receiptDeadline` and `completionDeadline`. Watchdog MUST enforce both. No infinite-deadline items.
- **INV-COMMS-L03** — Agent `livenessState == "online"` requires `now - lastHeartbeatAt ≤ 2× receiptSla`. The Hub MUST NOT report `online` for agents failing this check; the FSM transitions automatically.
- **INV-COMMS-L04** — Every queue item reaches a terminal state (`completion_acked` | `escalated` | `errored`). No item may remain non-terminal beyond `completionDeadline + maxWatchdogWindow`.
- **INV-COMMS-L05** — Escalation ladder is deterministic and auditable: re-dispatch → demote → Director notification. Every stage writes an audit entry.

---

## Migration

### Rollout phases

**Phase 1 — Hub infrastructure** (this ADR's scope):
- `PendingActionStore` + GCS backing.
- `drain_pending_actions` + ACK plumbing.
- Watchdog daemon.
- Liveness FSM (`Agent.livenessState`).
- `DirectorNotificationStore` + tools.
- Architect-first: only `thread_message` + `thread_convergence_finalized` + `review_requested` dispatch paths enqueue.
- Dual-write: SSE still fires; queue is added alongside. No breaking change to architect adapter yet.

**Phase 2 — Architect adapter opts in**:
- Architect runtime calls `drain_pending_actions` on every wake (SSE-triggered or periodic).
- Architect settling-actions carry `sourceQueueItemId`.
- Watchdog + escalation active.
- At this point bug-10's class is closed for architect-bound events.

**Phase 3 — Extend to engineers** (follow-up mission):
- Engineer-owed dispatches (`task_issued`) also enqueue.
- Engineer adapters (claude-plugin, etc.) opt into drain protocol.
- `wakeEndpoint` optional for engineers (interactive CLI); escalation skips re-dispatch and goes straight to Director notification.

**Phase 4 — Universal** (follow-up):
- All dispatch paths enqueue unconditionally.
- SSE becomes purely a hint; authoritative delivery is 100% queue-based.
- Watchdog enforces across all agent types.

### Backward compatibility

- Existing agents that don't call `drain_pending_actions` simply accumulate stuck items. Watchdog escalates on their behalf. No breaking change.
- Legacy `status: "online" | "offline"` fields stay in API projections during Phase 1–2; deprecated in Phase 3; removed in Phase 4.

---

## Consequences

### Positive

- **Zero job loss across Cloud Run lifecycle.** Scale-to-zero, cold-start, crash-and-restart — work survives.
- **Deterministic escalation.** No silent drops. Every queue item reaches a terminal state. Director always sees unrecoverable failures.
- **Honest liveness.** FSM reflects actual state, not stale socket truth.
- **Universal primitive.** Architect today; any adapter type tomorrow by registering `wakeEndpoint` + opting into drain.
- **Diagnostic wealth.** Every failure mode produces an audit trail. Triage becomes measurement, not guesswork.

### Negative

- **Queue storage cost.** GCS writes per-dispatch (already do GCS writes for entity mutations; marginal).
- **Architect-adapter change required for Phase 2.** Can't just extend with opt-in; drain-on-wake must be wired. Tracked as its own mission.
- **Watchdog load.** Fixed-interval scan; starts small but needs pagination/sharding if queue grows large. Out of scope for v1; logged as a future-concern.
- **ACK correlation complexity.** Agents must pass `sourceQueueItemId` on settling actions. Missing ID → Hub tries natural-key inference → if ambiguous, watchdog eventually escalates. Handled but not free.

### Neutral

- **Tool-round exhaustion (root cause) unchanged.** Agent-runtime-side cognitive ceiling still exists. This ADR contains the symptom (escalates visibly) but doesn't fix it. Root fix depends on ACP redesign (idea-86).
- **Director chat surface deferred.** DirectorNotifications persist but no notification consumer yet. Director queries via `list_director_notifications` tool in v1; richer surface lands with chat redesign.

---

## Implementation pointers

- `hub/src/entities/pending-action.ts` — new entity + store (memory + GCS impls).
- `hub/src/entities/director-notification.ts` — new entity + store.
- `hub/src/policy/pending-action-policy.ts` — `drain_pending_actions` tool + ACK tools.
- `hub/src/policy/watchdog.ts` — watchdog daemon + escalation logic.
- `hub/src/state.ts` — `Agent.livenessState` + `Agent.wakeEndpoint` fields.
- `hub/src/dispatch-helpers.ts` — enqueue-before-SSE at every owed-response dispatch site.
- Architect-adapter changes — tracked as separate mission (follow-up ADR).
- Failing reproduction test — `hub/test/e2e/comms-reliability.test.ts` (pins bug-10 class; fails pre-implementation).

---

## Appendix: failing reproduction test design

```ts
describe("INV-COMMS-L04 — agent silence escalates, never drops silently", () => {
  it("thread_message to unresponsive architect escalates within SLA", async () => {
    // Setup: mock architect that ignores all SSE and never calls drain_pending_actions
    const mockArchitect = registerMockAgent({role: "architect", ignoreSSE: true});

    // Open unicast thread targeting the silent architect
    const { threadId } = await openThread({
      routingMode: "unicast",
      recipientAgentId: mockArchitect.agentId,
    });

    // Wait through the full escalation ladder
    await advanceTime(receiptSla * 3 + watchdogInterval * 2);

    // Assert — post-fix:
    const notifications = await listDirectorNotifications();
    expect(notifications).toContainItem({
      source: "queue_item_escalated",
      sourceRef: expect.stringMatching(/^pa-/),
    });
    const agent = await getAgent(mockArchitect.agentId);
    expect(agent.livenessState).toBe("unresponsive");
    const thread = await getThread(threadId);
    expect(thread.status).toBe("active"); // thread itself unchanged; escalation is agent-scoped
    const item = await getPendingActionItem(/* natural key lookup */);
    expect(item.state).toBe("escalated");
  });
});
```

Pre-implementation: test hangs indefinitely (current behavior — bug-10). Post-implementation: passes within `~3× receiptSla + slack`.
