# State-transition triggers (mission-51 W3)

**Purpose.** Mechanize the entity-state-transition → Message-emission boundary. Every ratified status transition with a downstream actor fires a typed Message. Closes 7 of 11 🔴 transitions catalogued in `docs/methodology/mission-lifecycle.md` §5.1 ("idea-192 = state-transition-trigger primitive").

**Source files.**
- `hub/src/policy/triggers.ts` — `TransitionTrigger` type + `TRIGGERS` registry + `runTriggers()` runner.
- `hub/src/policy/downstream-actors.ts` — `DownstreamActor` type + `DOWNSTREAM_ACTORS` registry + `shouldFireTrigger()` gate.

---

## Architecture

Two-stage gate. Order matters: the trigger is declared, the gate decides whether it fires.

### 1. TRIGGERS registry — code-declared

Per mission-51 brief: *"Trigger registry ownership = code (declared at entity-handler level; PR-reviewed; avoids runtime-config drift)."*

Each `TransitionTrigger` declares:
- `entityType` — `"mission" | "task" | "thread" | "proposal" | "review" | "report" | "bug" | "turn"`.
- `fromStatus`, `toStatus` — the transition this trigger watches. `fromStatus` is `null` for entities that don't have a "before" status semantic (e.g., `review` — submission is creation, not a status flip).
- `emitKind` — the `MessageKind` to emit on match.
- `emitShape(entity, ctx)` — pure function returning `{ target, payload } | null`. Returning null skips emission (allows runtime predicates beyond simple from→to match).
- `name` — human-readable identifier for log/metric attribution.

PR review locks the registry. Runtime cannot mutate. Adding a new transition requires a PR with explicit declaration.

### 2. DOWNSTREAM_ACTORS registry — gating

Per mission-51 brief: *"Rule: transition fires trigger iff downstream actor exists. Skip ideas / audit-entry / tele."*

Each `DownstreamActor` declares:
- `kind` — the `MessageKind` it consumes.
- `matches(payload)` — pure predicate returning true iff this actor handles the given payload shape.
- `name` — for log/metric attribution.

`shouldFireTrigger(kind, payload)` returns true iff at least one actor matches. If no actor matches → trigger short-circuits (no Message created). The skip-list (idea / audit-entry / tele transitions per brief) is honored IMPLICITLY by absence-of-matching-actor.

### 3. runTriggers() — runner

Entity-handlers call `runTriggers(entityType, fromStatus, toStatus, entity, ctx)` after the entity transition is committed. Per-trigger semantics:

1. Match `(entityType, fromStatus, toStatus)` against TRIGGERS. Skip non-matches.
2. Invoke `emitShape(entity, ctx)` to derive the payload + target.
3. If shape returns null → skip (`skippedByShape++`).
4. Evaluate `shouldFireTrigger(emitKind, payload)`. If no actor matches → skip (`skippedByActor++`).
5. Call `ctx.stores.message.createMessage` with `authorRole: "system"`, `authorAgentId: "hub"`, the trigger's kind, the shape's target + payload, `delivery: "push-immediate"`.
6. **Best-effort emission.** Per-trigger errors are logged + metric'd + counted; they do NOT abort remaining triggers and do NOT propagate to the caller. The entity transition is the source of truth; trigger emission is enhancement.

Returns a `RunTriggersResult` tally for telemetry / test assertions.

### Backpressure interlock with W4

Per mission-51 brief: *"Trigger backpressure: failed delivery interlocks with W4 scheduled-messages (failed triggers schedule retry)."*

W3 ships emission only — failures are logged + metric'd + non-fatal. **W3 scope: emission path. Retry-on-failure deferred to W4** (which introduces the scheduled-message sweeper; failed-trigger emission re-enqueues there).

---

## Initial trigger set (W3)

W3 ships infrastructure + 3 representative trigger declarations to ratify the pattern. The remaining 4 ratified 🔴 transitions are available-to-add-via-PR per the procedure below.

| Lifecycle § | Trigger name | Entity | Transition | Kind | Audience | W3 status |
|---|---|---|---|---|---|---|
| 3.2 | `mission_activated` | mission | `proposed → active` | note | engineer (role) | ✅ wired |
| 7.3 | `mission_completed` | mission | `active → completed` | note | director (role) | ✅ wired |
| 6.4 | `review_submitted` | review | `null → submitted` | note | engineer (role + reportAuthor agentId) | ✅ wired |
| 3.4 | _(task-pending-dispatched)_ | task | `pending → dispatched` | — | — | available-to-add (already partially handled by PendingActionItem ADR-017; trigger formalization optional) |
| 4.5 | _(task-needs-review)_ | task | `working → needs_review` | — | — | available-to-add |
| 5.4 | _(all-tasks-complete)_ | mission | runtime check (all tasks completed) | — | — | available-to-add (requires custom predicate in `emitShape`) |
| 6.3 | _(report-submitted)_ | report | `null → submitted` | — | — | available-to-add (depends on Hub-side report entity per §6.1) |

The 3 wired triggers ratify the registry-shape and demonstrate three flavors:
- **Status transition with role-only target** (`mission_activated` → engineer pool).
- **Status transition with role-and-agentId target** (none in W3 set; sample shape via `review_submitted` falling back to role-only when reportAuthor unknown).
- **Creation event** (`review_submitted` with `fromStatus: null`).

Plus a **skip-list invariant** (see `triggers.test.ts`): no `idea`, `audit_entry`, or `tele` triggers in the registry.

---

## How to add a new trigger

1. **Append to TRIGGERS** in `hub/src/policy/triggers.ts`:
   ```typescript
   {
     entityType: "task",
     fromStatus: "working",
     toStatus: "needs_review",
     emitKind: "note",
     name: "task_needs_review",
     emitShape: (entity, ctx) => {
       const task = entity as { id: string; assignedEngineerId?: string; missionId?: string };
       return {
         target: { role: "architect" },
         payload: {
           taskId: task.id,
           transition: "working→needs_review",
           directive: "review the task report at create_review",
         },
       };
     },
   },
   ```
2. **Add a matching DownstreamActor** in `hub/src/policy/downstream-actors.ts`:
   ```typescript
   {
     kind: "note",
     name: "task_needs_review_inbox",
     matches: (payload) => {
       const p = payload as { transition?: string; taskId?: string };
       return p?.transition === "working→needs_review" && typeof p?.taskId === "string";
     },
   },
   ```
3. **Wire `runTriggers` into the entity-handler.** Find the policy.ts file that owns the transition (e.g., `task-policy.ts` for the task-needs-review path); after the entity update is committed, call:
   ```typescript
   try {
     await runTriggers("task", "working", "needs_review", task, ctx);
   } catch (err) {
     // Best-effort: log + metric + continue.
     ctx.metrics.increment("trigger.runner_error", { entityType: "task", toStatus: "needs_review", error: ... });
     console.warn(...);
   }
   ```
4. **Add tests** in `hub/test/unit/triggers.test.ts` verifying:
   - The trigger appears in `TRIGGERS` registry.
   - `runTriggers(entityType, from, to, entity, ctx)` produces the expected `evaluated/fired` counts.
   - `shouldFireTrigger` returns true for the expected payload shape and false for unrelated payloads.
5. **PR review.** The PR reviewer verifies (a) the trigger's audience is correct, (b) the payload shape matches the actor's `matches` predicate, (c) the entity-handler call site is the right boundary (post-commit, before response).

---

## What's intentionally NOT in scope

- **Dynamic / runtime-config registry.** Per brief: "Trigger registry ownership = code." Adding triggers requires a PR; runtime cannot register.
- **Triggering on idea / audit-entry / tele transitions.** Per brief skip-list: those entities are admin-only (idea triage flow) or forensics-only (audit, tele) — they don't have downstream actors that need the trigger primitive.
- **Retry-on-emission-failure.** W3 ships emission only. W4 introduces the scheduled-message sweeper that picks up failed-trigger emission as scheduled retries.
- **Cascade transactional boundary.** W5 wraps the trigger-fire path in the cascade-replay sweeper for at-least-once-with-idempotency semantics across Hub crashes.
- **Tool-surface migration to `list_messages` / `create_message`.** W6 closes the user-facing API surface; until then, triggers populate the Message store but tool callers continue using the legacy fanout paths.

---

## Cross-references

- **Mission brief:** `docs/reviews/m-message-primitive-retrospective.md` (or equivalent; PR #41 architect retrospective).
- **Lifecycle audit:** `docs/methodology/mission-lifecycle.md` — §3 per-transition audit, §4 synthesis, §5.1 idea-192 closure list (the 7 🔴 transitions this primitive closes).
- **W0 spike:** PR #42 / `29b26c2` — backend-capability characterization + path picks.
- **W1 entity:** PR #44 / `de66c57` — Message entity + repository + migration shim.
- **W2 read-path:** PR #45 / `a16d4ec` — async-shadow projector + bounded sweeper.
- **W3 (this):** trigger machinery + downstream-actor gate.
- **W4 forward-look:** scheduled-message sweeper picks up failed-trigger retries.
