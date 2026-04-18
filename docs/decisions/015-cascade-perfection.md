# ADR-015: Cascade-Perfection — ActionSpec Registry, Runner-Owned Semantics, Bug as First-Class Entity

**Date:** 2026-04-19
**Status:** Proposed
**Complements:** ADR-014 (Phase 2 cascade + action vocabulary), ADR-013 (Phase 1 gate / summary / participants), ADR-011 (CAS + TransitionRejected), ADR-012 (Architect error-surfacing / context-economy)
**Threads:** (to be filled on acceptance — expected to converge a design thread between Director, Architect, and Engineer)
**Supersedes:** nothing. Refactors the `runCascade` internals introduced by ADR-014 §147–162 without changing the user-visible contract.
**Missions:** M-Cascade-Perfection (this ADR's implementation), spans two phases.

---

## Decision

The ADR-014 cascade runner is refactored from a handler-driven model (each `registerCascadeHandler` function owns persistence, audit, dispatch, and idempotency) into a **declarative `ActionSpec` registry model** where per-type handlers declare only **what to spawn**, and the runner owns **all** cross-cutting semantics: idempotency pre-check, per-stage commit boundaries, audit emission, SSE dispatch, and depth-bounded re-entrancy. In the same mission, `Bug` is introduced as a first-class entity to replace the current practice of tracking defects as tagged Ideas (7+ such Ideas already exist in backlog, including idea-88 from the M24-T15 ITW smoke), and `create_bug` becomes the 9th autonomous cascade action type — serving both as a feature in its own right and as the validation case for the new `ActionSpec` pattern.

---

## Context

### Bug classes the current runner leaves available

The ADR-014 cascade infrastructure shipped functionally correct but with the per-handler contract leaving several failure modes as latent possibilities. The M24-T15 ITW smoke exposed one of them in prod (idea-88): every cascade handler persisted its entity correctly but silently skipped the `ctx.dispatch(...)` call that the direct-tool equivalent fires. Subscribers missed every cascade-spawned SSE notification. The fix (commit c2db6a2, hub-00012-4nj) factored the dispatch shape into a shared `dispatch-helpers.ts` module, but the underlying pattern — **handlers can forget side-effects and neither the type system nor the test suite catches it in isolation** — persists wherever a handler author is expected to remember multiple orthogonal concerns.

Taxonomy of bug classes the ADR-014 cascade runner permits, with actual-or-near-miss examples:

| Class | Description | Example |
|-------|-------------|---------|
| A | Parallel-paths-drift | Direct-tool handler fires SSE; cascade handler forgets. *(idea-88, fixed)* |
| B | Schema drift between layers | Tool-Zod accepts a payload shape the gate re-rejects, or vice versa. *(commit 654cb5b, fixed)* |
| C | Silent partial function | Committed action whose type has no registered handler fails at run time, not stage time. |
| D | Idempotency inconsistency | Each handler calls `findByCascadeKey` independently; forgetting one = double-spawn on replay. |
| E | Transactional boundary | Handler persists entity, then audit or dispatch throws → partially-applied side-effects. |
| F | Cascade re-entrancy | Cascade spawns task → thread converges → cascade spawns another task. Bounded only by `router.ts` `safety < 100` cap. |
| G | Name drift | Action type, audit action name, and SSE event name are three strings that must agree. |
| H | Handler↔store signature drift | Store signature changes; handler compiles but produces wrong entity. |
| I | Cross-action dependencies | Action-2 depends on action-1's output; failure ordering undefined. |

### Why declarative specs over procedural handlers

The current `CascadeHandler` signature — `(CascadeExecuteContext) => Promise<CascadeExecuteOutcome>` — is procedural: the runner delegates the entire execution to the handler, including steps that have nothing to do with the handler's domain (idempotency check, audit emission, SSE dispatch). The handler has to remember to do each step, in the right order, with the right payload shape. Authoring a new handler type means re-proving correctness of seven orthogonal concerns.

A declarative `ActionSpec` inverts this: the spec declares **what kind of entity this action produces**, **how to build it from the payload**, and **which store to use**. The runner composes the cross-cutting concerns around the declared `spawn` function in a fixed, inspectable pipeline.

```
┌────────────────────────────────────────────────────────────────────┐
│ runCascade(thread, committed[], summary)                           │
│                                                                    │
│  for each committed action, resolve spec = registry.get(type) then:│
│                                                                    │
│  1. IDEMPOTENCY: query spec.store.findByCascadeKey(thread, action) │
│     → on hit: skipped_idempotent; skip remaining steps             │
│  2. BUILD:      entity_draft = spec.spawn(payload, backlink)       │
│  3. PERSIST:    entity = spec.store.create(entity_draft)           │
│  4. AUDIT:      auditStore.log(hub, spec.auditAction(action), ...) │
│     → on fail: enqueue audit-replay; continue (audit is recoverable)│
│  5. DISPATCH:   ctx.dispatch/emit per spec.event + spec.selector   │
│     → on fail: log; SSE is best-effort + reconnect-poll recovers   │
│  6. REPORT:     push {actionId, type, status, entityId}            │
│                                                                    │
│  Depth guard: if runCascade depth > MAX_DEPTH (3), defer to queue. │
└────────────────────────────────────────────────────────────────────┘
```

With this pipeline:
- **Class A** is dead: the runner always dispatches; a handler has no way to skip the step.
- **Class C** is dead at registration: missing spec = action not in the Zod vocabulary = can't be staged in the first place.
- **Class D** is dead: the runner owns idempotency; handlers can't forget it.
- **Class E** is confined: each stage has defined failure semantics (audit is recoverable; dispatch is best-effort; persistence is the single non-recoverable step).
- **Class F** is bounded: explicit depth tracking at `runCascade` entry; beyond max, defer to an async queue rather than recurse inline.
- **Class G** is dead: the audit action name is `spec.auditAction(action)`; the SSE event is `spec.event`; a single `ActionSpec<T>` value owns all three strings.

Classes B, H, I are partially addressed (payload schema + backlink typing; store method signatures derived from the spec) but fully solving them requires deeper type engineering that's out of scope for this ADR.

### Why Bug as the validation case

Adding a new entity is the clearest test of whether the refactor achieves its "frictionless" goal. A successful M-Cascade-Perfection Phase 1 means Phase 2 (Bug entity) is essentially one `ActionSpec<"create_bug">` object plus a store + policy + tests — no runner modifications, no dispatch-helper additions beyond the spec's own declarations.

Bug as a first-class entity is also a long-open architectural item (idea-16 opened 2026-04-12), and the existing bug-tagged Ideas backlog (9 items at time of writing, including the high-value idea-88 covering the very bug this refactor is partly motivated by) provides immediate migration material.

---

## Schema changes

### Bug (new entity)

```ts
export type BugStatus = "open" | "investigating" | "resolved" | "wontfix";
export type BugSeverity = "critical" | "major" | "minor";

export interface Bug {
  id: string;                              // bug-N
  title: string;
  description: string;                     // includes reproduction steps (free-form v1)
  status: BugStatus;
  severity: BugSeverity;
  /** Root-cause taxonomy. Free text v1; promoted to enum after migration
   *  + ~20 classified bugs confirms the shape. Draft values: drift, race,
   *  cognitive, identity-resolution, dedup, schema-validation-gap,
   *  missing-feature. */
  class: string | null;
  /** Open-ended categorization — same pattern as Idea.tags. For
   *  component/subsystem/mission/discovery-channel markers. */
  tags: string[];
  // Migration + provenance
  sourceIdeaId: string | null;             // for migrated bug-tagged Ideas
  sourceThreadId: string | null;           // cascade back-link (INV-TH20)
  sourceActionId: string | null;
  sourceThreadSummary: string | null;      // INV-TH23 Summary-as-Living-Record
  // Fix metadata
  linkedTaskIds: string[];                 // tasks tracking fix work
  linkedMissionId: string | null;          // parent mission if applicable
  fixCommits: string[];                    // commit SHAs that closed the bug
  fixRevision: string | null;              // deployment revision where fix landed
  /** How the bug was discovered. Free text v1:
   *  itw-smoke | unit-test | prod-audit | integration-test |
   *  code-review | llm-self-review. */
  surfacedBy: string | null;
  createdAt: string;
  updatedAt: string;
}
```

**Lifecycle**: `open → investigating → resolved | wontfix`. Terminal states are `resolved` and `wontfix`; re-opening is a new Bug record with `sourceIdeaId` pointing at the prior.

### StagedActionType widens

`"create_bug"` joins the 8 existing autonomous action types — 9 total. `create_bug` payload:

```ts
export interface CreateBugActionPayload {
  title: string;
  description: string;
  severity?: BugSeverity;                  // defaults to "minor"
  class?: string;
  tags?: string[];
  surfacedBy?: string;
}
```

### ActionSpec registry (new internal shape)

```ts
export interface ActionSpec<T extends StagedActionType, TEntity> {
  readonly type: T;
  readonly payloadSchema: ZodSchema;       // re-uses STAGED_ACTION_PAYLOAD_SCHEMAS entry
  readonly entityKind: EntityKind;         // "task" | "proposal" | "idea" | "mission" | "bug" | null
  /** Store-level adapter — runner calls this for idempotency + spawn. */
  findByCascadeKey(ctx: IPolicyContext, key: CascadeKey): Promise<TEntity | null>;
  spawn(ctx: IPolicyContext, payload: PayloadFor<T>, backlink: CascadeBacklink): Promise<TEntity>;
  /** Audit action name. Usually `thread_${type}`. */
  readonly auditAction: string;
  /** SSE dispatch — runner invokes after successful persistence + audit. */
  dispatch(ctx: IPolicyContext, entity: TEntity, thread: Thread): Promise<void>;
  /** Null-entity actions (close_no_action, create_clarification) set
   *  all three to no-op functions. The runner still owns the order
   *  and the "skip on null entity" short-circuit. */
}
```

Actions that don't spawn an entity (`close_no_action`, `create_clarification`) either return `null` from `spawn` and skip steps 1+3+5 (idempotency, persistence, dispatch), or get a dedicated `AuditOnlyActionSpec` variant. TBD at implementation — measure which is cleaner.

---

## Design changes

### Runner pipeline

See the ASCII diagram above. The `runCascade` function shrinks significantly — from ~50 lines today to ~20 lines of pipeline composition, with per-stage error handling factored into small helpers.

### Runner-owned idempotency

`findByCascadeKey` becomes part of the `ActionSpec` interface. Each entity store implements it once; handlers don't query it. On hit, the runner short-circuits with `skipped_idempotent` and logs `action_already_executed`. On miss, the runner proceeds to `spawn + persist + audit + dispatch`.

### Depth + cycle guard

```ts
const MAX_CASCADE_DEPTH = 3;

async function runCascade(ctx, thread, committed, summary, depth = 0) {
  if (depth >= MAX_CASCADE_DEPTH) {
    // Defer to async queue; return synthetic report with status: "deferred"
    // so the finalized event can fire correctly.
    for (const action of committed) {
      await deferredCascadeQueue.enqueue({ threadId: thread.id, actionId: action.id });
    }
    return { report: committed.map(a => ({ actionId: a.id, type: a.type, status: "deferred" })), ... };
  }
  // ... normal pipeline ...
}
```

The deferred queue is a simple GCS-backed append-only log polled by a reaper (similar to the thread reaper). Deferred actions execute with `depth = 0` on pickup. `cascade_failed` semantics unchanged for actual handler failures.

### Transactional stages — failure semantics

| Stage | Fails how | Recovery |
|-------|-----------|----------|
| idempotency query | Store read error | retry once, else propagate as "failed" in report |
| spawn+persist | Store write error / validation fail | `failed` in report; no audit, no dispatch |
| audit | Audit store write error | enqueue audit-replay; log; continue to dispatch (entity state is valid) |
| dispatch | SSE store/transport error | log; continue (SSE is best-effort; subscribers catch up via poll) |

No cross-stage transactions. Persistence is the single "line in the sand" — before it, nothing is visible; after it, downstream side-effects are recoverable or best-effort.

### Migration of existing cascade handlers

The 7 existing handlers (`create_task`, `create_proposal`, `create_idea`, `update_idea`, `update_mission_status`, `propose_mission`, `create_clarification`) migrate to `ActionSpec`s with the following adjustments:

- `close_no_action` becomes an `AuditOnlyActionSpec` (no entity, no idempotency, no dispatch).
- `create_clarification` same — audit-only.
- `update_idea`, `update_mission_status` become `UpdateActionSpec` variants — they don't use cascade idempotency (update is idempotent by nature when target status matches), and they dispatch only on meaningful transitions (e.g., `mission_activated` on `proposed → active`).

---

## Invariants (addition to workflow-registry.md §1.3)

- **INV-TH24** — every `ActionSpec<T>` registered in the cascade registry declares the four cross-cutting concerns (payloadSchema, findByCascadeKey, auditAction, dispatch) via a typed interface. Missing fields fail TypeScript compilation; unregistered types fail Zod staging.
- **INV-TH25** — `runCascade` is bounded by `MAX_CASCADE_DEPTH`. Beyond the bound, actions defer to an async queue rather than recurse. Hub never hits the `router.ts` `safety < 100` cascade guard.
- **INV-TH26** — audit is replayable. A failed audit write for a successfully-persisted entity enqueues an audit-replay; the entity's downstream behaviour is not blocked on audit success.

---

## Implementation — M-Cascade-Perfection

### Phase 1: ActionSpec registry + runner-owned semantics (no behaviour change)

1. Introduce `ActionSpec<T, TEntity>` interface + `AuditOnlyActionSpec` variant + registry map.
2. Refactor `runCascade` to read from the registry and compose the pipeline (idempotency → spawn → persist → audit → dispatch).
3. Migrate the 7 existing handlers to `ActionSpec`s. Each store implements `findByCascadeKey` per the interface (most already do from task-257/261).
4. Add depth-guard + deferred-cascade queue. Queue drain via a reaper task (Hub-side).
5. Migrate parity tests from wave3b to exercise the spec registry directly. Add tests for depth guard + audit-replay.
6. Hub redeploy. No behaviour change; all 390+ existing tests pass.

**Exit criteria**: 390/390 tests pass. runCascade function ≤30 LOC. ActionSpec registry has 7 entries. Deploy green.

### Phase 2: Bug entity + `create_bug` ActionSpec

1. `Bug` interface + `IBugStore` + `MemoryBugStore` + `GcsBugStore`.
2. `bug-policy.ts` with MCP tools: `create_bug`, `list_bugs`, `get_bug`, `update_bug`. FSM guards for `open → investigating → resolved | wontfix`.
3. Dispatch-helpers extension: `dispatchBugReported`, `dispatchBugStatusChanged`.
4. `CreateBugActionPayloadSchema` in `staged-action-payloads.ts`. Widen `AUTONOMOUS_STAGED_ACTION_TYPES` to include `"create_bug"`.
5. `cascade-actions/create-bug.ts`: single `ActionSpec<"create_bug", Bug>` object. If Phase 1 is correct, this is the frictionless test — ~50 LOC.
6. Migration script (`scripts/migrate-bug-ideas.ts`): reads Ideas tagged `bug`, creates Bug entities with `sourceIdeaId` linkage + best-effort `class` extraction from tags.
7. Backfill tests (wave1-style policy tests + cascade parity test for `create_bug`).
8. Hub redeploy + architect redeploy (if architect sandwich needs `create_bug` in its allow-list).

**Exit criteria**: Bug entity available via MCP tools. `create_bug` stageable via thread cascade. Existing bug-tagged Ideas migrated. Idea-16 closed. Idea-88 migrated to its Bug record.

### Effort estimate

- Phase 1: ~1 engineering day.
- Phase 2: ~1 engineering day.
- **Total: ~2 engineering days.**

---

## Consequences

### Positive

- **Bug classes A, C, D, F, G are eliminated by construction** at the runner level.
- **Adding new cascade action types is declarative**: one `ActionSpec` object, no runner modifications, no dispatch-helper additions beyond what the spec declares.
- **Idea-16 closes**, 6+ days after being logged as a structural ask.
- **9 existing bug-tagged Ideas migrate to tracked Bug entities** with severity + lifecycle + fix-commit linkage. Reliability backlog becomes legible.
- **Depth-bounded cascade** prevents the re-entrancy class of bugs that the current `router.ts safety < 100` cap only caught after 100 iterations.
- **Audit is recoverable**. Entity state is never held hostage by audit-store transient failures.

### Negative

- **Runner refactor is a blast-radius change**. 7 existing cascade handlers all migrate simultaneously. Mitigation: Phase 1 ships with all existing tests passing (390/390); behaviour is identical.
- **Bug schema may need revision after migration**. Free-text `class` is deliberately not an enum — the distribution after migrating 9 Ideas + ~20 new bugs will inform v2 field decisions.
- **Deferred-cascade queue is new infrastructure**. Parallels the thread reaper (INV-TH21) in shape — reuse the reaper's polling pattern to minimize new surface.
- **`create_bug` in the architect sandwich allow-list** — minor architect redeploy required for full Phase 2 coverage. Hub-only Phase 2 deploy keeps engineers able to create bugs directly; architect-to-engineer bug creation via thread needs the architect allow-list update.

### Neutral

- **Classes B and H are only partially addressed**. Full elimination would require propagating payload types through the store signature via phantom types or similar — worth revisiting after Phase 2 reveals whether the spec approach sufficiently constrains them in practice.
- **Class I (cross-action dependencies) remains unhandled**. Wait for an actual bug before designing this; current stage-order iteration is adequate for observed usage.
- **Audit-replay queue is a Hub-side concern**. Subscribers don't need changes; replay lands in the existing audit store with the same shape.

---

## Implementation pointers

- **Schema**: `hub/src/entities/bug.ts` (new) — `Bug` interface, `IBugStore`, `MemoryBugStore`. `hub/src/entities/gcs/gcs-bug.ts` for GCS impl.
- **Policy**: `hub/src/policy/bug-policy.ts` — MCP tools + dispatch-helpers.
- **Cascade refactor**: `hub/src/policy/cascade.ts` rewrites `runCascade` and introduces `ActionSpec`; `hub/src/policy/cascade-actions/*.ts` each becomes a `const spec: ActionSpec<T> = { ... }` default export. The aggregator `index.ts` remains.
- **Migration**: `scripts/migrate-bug-ideas.ts` (new) — one-shot idempotent script; safe to run multiple times (uses `sourceIdeaId` for dedup).
- **Tests**: extend `hub/test/wave3b-policies.test.ts` with `ActionSpec`-level tests. Add `hub/test/wave1-policies.test.ts` `BugPolicy` block. New `hub/test/e2e/bug-lifecycle.test.ts` for end-to-end via the TestOrchestrator.

---

## Related ADRs + Ideas

- **ADR-011** — CAS primitives + `TransitionRejected`. Reused for the per-stage boundary in the refactored runner.
- **ADR-012** — Architect error-surfacing + context-economy. Reused for `create_bug` failure surfacing.
- **ADR-013** — Phase 1 gate + summary + participants. Unchanged; foundational.
- **ADR-014** — Phase 2 cascade architecture. This ADR refines the runner internals without changing the user-visible contract.
- **idea-16** — "First-class Bug entity". Closed by Phase 2.
- **idea-88** — "Cascade handlers missed SSE dispatch". Migrated to a Bug record on Phase 2 migration pass.
- **idea-19 / 22 / 28 / 29 / 40 / 41 / 57** — Seven other bug-tagged Ideas eligible for migration.
