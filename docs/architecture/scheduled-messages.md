# Scheduled messages + precondition predicates (mission-51 W4)

**Purpose.** Mechanize the `delivery: 'scheduled'` lifecycle of the universal Message primitive — a Message with `fireAt: <timestamp>` + optional `precondition: <predicate>` sits at `scheduledState: 'pending'` until the sweeper picks it up at fireAt; it then evaluates the precondition and either fires (transition to `delivered`) or cancels (transition to `precondition-failed`; audit-entry retains forensics). Also closes the W3 failed-trigger retry interlock — failed trigger emissions re-enqueue as scheduled-message-retries with backoff fireAt + retryCount metadata.

**Source files.**
- `hub/src/policy/scheduled-message-sweeper.ts` — `ScheduledMessageSweeper` class.
- `hub/src/policy/preconditions.ts` — `Precondition` type + `PRECONDITIONS` registry + `evaluatePrecondition()` gate.
- `hub/src/policy/triggers.ts` — `retryFailedTrigger()` helper (W3 → W4 retry interlock).
- `hub/src/entities/message.ts` — `MessageScheduledState` type + `Message.scheduledState/retryCount/maxRetries` fields.

---

## Architecture

### Sweeper (1s polling)

`ScheduledMessageSweeper` runs every 1s by default (configurable via `OIS_SCHEDULED_MESSAGE_SWEEPER_INTERVAL_MS` env var; tighter than W2's 5s because timing-sensitivity is higher). Each tick:

1. Query `MessageRepository.listMessages({ delivery: 'scheduled', scheduledState: 'pending' })` — bounded input set.
2. Filter to messages whose `fireAt <= now` (don't fire early). Skip future fireAt.
3. For malformed messages (missing/invalid fireAt): cancel + audit-entry. Defensive cleanup so malformed messages don't sit forever.
4. For valid fireAt: call `evaluatePrecondition(message.precondition, ctx)`:
   - **`{ ok: true }`** → `markScheduledState(id, 'delivered')`. Metric `scheduled_message_sweeper.fired`.
   - **`{ ok: false }`** → `markScheduledState(id, 'precondition-failed')` + audit-entry with reason. Metric `scheduled_message_sweeper.cancelled`.
5. **Per-message error isolation.** Failures within a single message don't abort the remainder. Mirrors the cascade-runner's INV-TH26 stance.

### Hub-startup resumption

`fullSweep()` runs once before serving traffic on Hub startup (matches W2 + cascade-replay-sweeper pattern). Catches scheduled messages whose fireAt was reached while the previous Hub instance was down. Combined with the periodic-tick `start()`, the bound is approximately fireAt + `intervalMs`.

### Precondition predicate registry (Strategy A)

Per architect-ratified Strategy A: code-declared predicate-functions-by-name in `PRECONDITIONS`. Each entry:

```typescript
{
  fn: 'thread-still-active',
  description: '...',
  evaluate: async (args, ctx) => { ... }, // returns boolean
}
```

Message.precondition shape: `{ fn: string; args: Record<string, unknown> }`. Sweeper looks up `fn` in the registry and calls the predicate. PR review locks the registry. Runtime cannot mutate.

**Initial seed (W4):**
- `thread-still-active(threadId)` → `Thread.status === 'active'`. Used to gate scheduled messages whose relevance ends when the thread closes/converges.
- `task-not-completed(taskId)` → `Task.status !== 'completed'`. Used to gate reminders that are irrelevant once the task closes.

**Missing-predicate handling.** If `precondition.fn` is not in the registry: cancel (conservative — refuse to fire a scheduled message whose precondition is unevaluable). Reason captured in the audit entry.

**Absent precondition.** If `precondition` is undefined/null: fire unconditionally (default-true).

**Evaluator throws.** Caught + treated as cancel.

### W3 failed-trigger retry interlock

Per mission-51 brief: *"failed delivery interlocks with W4 scheduled-messages (failed triggers schedule retry)."*

When `runTriggers` encounters a `createMessage` failure on the original emission, it calls `retryFailedTrigger(trigger, shape, ctx, attempt=1)`. That helper:

1. Checks `attempt > DEFAULT_MAX_RETRIES` (default 3, configurable via `OIS_TRIGGER_MAX_RETRIES`). If exceeded → log + metric `trigger.retry_exhausted` + give up.
2. Computes backoff: attempt 1 → 30s (`OIS_TRIGGER_RETRY_BACKOFF_1_MS`); attempt 2+ → 5min (`OIS_TRIGGER_RETRY_BACKOFF_2_MS`).
3. Creates a scheduled-message via `createMessage` with: original kind/target/payload, `delivery: 'scheduled'`, `fireAt = now + backoff`, `retryCount: attempt`, `maxRetries`. Payload is augmented with `_retryContext: { triggerName, retryCount, maxRetries }` for telemetry.
4. If THIS createMessage call also fails (storage permanently unhealthy): log + metric `trigger.retry_enqueue_failed` + give up. **No infinite recursion.**

**Future:** the sweeper-side fire path could be enhanced to re-attempt the original emission and re-call `retryFailedTrigger(attempt=2)` on failure. W4 ships the enqueue path; the sweeper-side re-attempt is a follow-on if measured failure rates warrant it.

---

## Lifecycle states

```
                    sweeper @ fireAt
                  ┌──────────────────┐
                  ▼                  │
  pending ──────► delivered          │
     │                               │
     └──► precondition-failed ◄──────┘
          (audit-entry written)
```

- `pending` — initial state for `delivery: 'scheduled'` messages. Set by `createMessage` automatically.
- `delivered` — sweeper fired the message at fireAt; precondition was true/absent. Recipient-ack lifecycle (`status: 'new' | 'acked'`) takes over from here.
- `precondition-failed` — sweeper cancelled at fireAt; precondition false / unevaluable / malformed. Audit-entry retains the reason.

`scheduledState` is orthogonal to `status`. `status: 'new' | 'acked'` is the recipient-ack axis (always applicable post-delivery); `scheduledState` is the scheduling-decision axis (only set on scheduled messages).

---

## How to add a new predicate

1. **Append to `PRECONDITIONS`** in `hub/src/policy/preconditions.ts`:
   ```typescript
   {
     fn: 'mission-still-active',
     description: 'Returns true iff the named mission is in `active` status.',
     evaluate: async (args, ctx) => {
       const missionId = args.missionId;
       if (typeof missionId !== 'string') return false;
       const mission = await ctx.stores.mission.getMission(missionId);
       return mission?.status === 'active';
     },
   },
   ```
2. **Add tests** in `hub/test/unit/preconditions.test.ts` verifying:
   - True for the satisfied condition.
   - False for the unsatisfied condition.
   - False for missing/invalid args (e.g., empty missionId).
   - False for nonexistent entity (`getMission` returns null).
3. **PR review.** The PR reviewer verifies (a) the predicate is pure-ish (only reads from ctx.stores; no side effects), (b) the args contract is documented, (c) the description is operator-readable.

---

## What's intentionally NOT in scope

- **Subsecond-precision scheduled delivery.** ~1s precision adequate for MVP per directive. Tighter is post-MVP optimization.
- **Cron-style recurring schedules.** W4 ships fire-once semantics. Recurring requires re-creating the message at delivery time (which is straightforward but out of scope for W4).
- **Inline JSONLogic / serialized expressions.** Strategy B was considered + rejected per architect lean (security + type-safety wins for Strategy A).
- **Sweeper-side retry of the original emission.** W4 ships retry-enqueue (creating a scheduled-message-retry); the sweeper at fireAt currently only flips `scheduledState` to `delivered`. Re-attempting the original emission at fire-time is a future enhancement when warranted.
- **Cascade transactional boundary.** W5 wraps the scheduled-message lifecycle in cascade-replay (atomicity beyond per-message at-least-once).
- **Tool-surface migration.** W6 closes the user-facing API.

---

## Cross-references

- **Mission brief:** mission-51 ratified at thread-311 round-3 (Position A scope expansion).
- **W0 spike:** PR #42 / `29b26c2` — backend-capability characterization. Confirmed single-entity atomic primitives compose for this design.
- **W1 entity:** PR #44 / `de66c57` — Message entity + repository + migration shim. `fireAt` + `precondition` fields included as forward-compat.
- **W2 read-path:** PR #45 / `a16d4ec` — async-shadow projector + bounded sweeper. Pattern template for W4's sweeper.
- **W3 trigger machinery:** PR #46 / `490e874` — state-transition triggers + downstream-actor registry. W4 closes the failed-trigger retry interlock.
- **W4 (this):** scheduled-message sweeper + precondition predicate registry + retry interlock.
- **W5 forward-look:** cascade transactional boundary + Hub-startup cascade-replay sweeper. Consumes W4 machinery for failed-cascade replay.
- **Lifecycle audit:** `docs/methodology/mission-lifecycle.md` §5.1 (the 7 🔴 transitions + idea-192 closure path).
- **Triggers doc:** `docs/architecture/triggers.md` — W3 sibling architecture.
