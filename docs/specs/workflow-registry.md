# Workflow Registry — Sovereign Specification

> **Authority:** This document is the absolute source of truth for system behavior.
> When the code disagrees with this Registry, the code is buggy.
> When the tests disagree with this Registry, the tests are invalid.
> Changes to system behavior begin here. Code and tests follow.

**Version:** 2.1.0
**Last Updated:** 2026-04-17
**Status:** RATIFIED (v2.1.0 — Mission-19 Label/Selector Routing)

---

## Table of Contents

1. [Entity FSM Declarations](#1-entity-fsm-declarations)
2. [Multi-Actor Workflow Declarations](#2-multi-actor-workflow-declarations)
3. [Cross-Domain Interaction Map](#3-cross-domain-interaction-map)
4. [SSE Event Catalogue](#4-sse-event-catalogue)
5. [System Invariants](#5-system-invariants)
6. [Label/Selector Routing](#6-labelselector-routing)
7. [Gap Analysis](#7-gap-analysis)

---

## 1. Entity FSM Declarations

### 1.1 Task

```
Entity: Task
States: pending, blocked, working, input_required, in_review, completed, failed, escalated, cancelled
Initial: pending (no dependencies) | blocked (with dependsOn)
Terminal: completed, failed, escalated, cancelled
Additional fields:
  revisionCount      — integer, default 0
  assignedEngineerId — engineerId of the Agent that claimed the Task via get_task; null until claimed
  labels             — Record<string, string>; Mission-19 routing metadata inherited from the creator's Agent at submit-time
```

#### Transitions

| From             | To              | Trigger                                                    | Actor     |
| ---------------- | --------------- | ---------------------------------------------------------- | --------- |
| (initial)        | pending         | `create_task` (no dependsOn)                               | Architect |
| (initial)        | blocked         | `create_task` (with dependsOn)                             | Architect |
| pending          | working         | `get_task` (atomic assignment)                             | Engineer  |
| pending          | cancelled       | `cancel_task`                                              | Architect |
| blocked          | pending         | All dependencies review-approved (cascade)                 | System    |
| blocked          | cancelled       | Any dependency cancelled (cascade)                         | System    |
| working          | in_review       | `create_report`                                            | Engineer  |
| working          | input_required  | `create_clarification`                                     | Engineer  |
| input_required   | working         | `resolve_clarification`                                    | Architect |
| in_review        | completed       | `create_review(decision: "approved")` — triggers DAG cascade | Architect |
| in_review        | working         | `create_review(decision: "rejected")` — increments revisionCount | Architect |
| in_review        | escalated       | `create_review(decision: "rejected")` when revisionCount >= 3 | System |

**Note:** The `working → completed` and `working → failed` transitions from v1.0.0 are removed. Reports now transition to `in_review`, and only an approved review transitions to `completed`. DAG cascades (`unblockDependents`) trigger on `completed`, not on `in_review`.

#### Report Versioning

Reports and reviews use versioned naming based on `revisionCount`:
- First report: `reports/{taskId}-v1-report.md`
- After rejection and re-report: `reports/{taskId}-v2-report.md`
- Formula: `v{revisionCount + 1}`

#### Invariants

| ID      | Invariant                                                                        | Tested By                          |
| ------- | -------------------------------------------------------------------------------- | ---------------------------------- |
| INV-T1  | A task can only be picked up by one engineer (atomic `getNextDirective`)          | `e2e-chaos.test.ts` "only one engineer" |
| INV-T2  | A blocked task is never returned by `get_task`                                   | `e2e-workflows.test.ts` "completing parent unblocks" |
| INV-T3  | Only pending tasks can be cancelled via `cancel_task`                            | `policy-router.test.ts` "cancelTask cancels" |
| INV-T4  | completed, failed, escalated, cancelled are terminal — no outbound transitions   | `e2e-fsm-enforcement.test.ts` "completed is terminal" |
| INV-T5  | Idempotency keys prevent duplicate task creation                                 | `e2e-chaos.test.ts` "duplicate idempotency" |
| INV-T6  | `dependsOn` references must point to existing tasks                              | `policy-router.test.ts` "validates dependsOn" |
| INV-T7  | A task with `dependsOn` starts in `blocked`, not `pending`                       | `e2e-workflows.test.ts` "completing parent" |
| INV-T8  | Only `working` tasks can receive reports (`create_report`)                        | `e2e-fsm-enforcement.test.ts` "rejects report on pending" |
| INV-T9  | DAG cascade (unblockDependents) triggers on review approval, not report submission | NONE |
| INV-T10 | `in_review → working` (rejected) increments `revisionCount`                      | NONE |
| INV-T11 | `revisionCount >= 3` on rejection triggers `escalated` (circuit breaker)         | NONE |
| INV-T12 | `escalated` is locked — `create_report` is rejected from this state              | NONE |
| INV-T13 | A Task's `labels` are set at `create_task` from the caller Agent's labels and are immutable for the life of the Task | `test/mission-19/labels.test.ts` "task inherits creator labels" |
| INV-T14 | `get_task` only returns a Task when `taskClaimableBy(task.labels, claimant.labels)` holds — the claimant's labels must cover every key/value in the Task's labels | `test/mission-19/claim.test.ts` "claim rejected when labels missing" |
| INV-T15 | On successful claim, `get_task` records `task.assignedEngineerId = claimant.engineerId`                     | `test/mission-19/claim.test.ts` "claim persists assignedEngineerId" |
| INV-T16 | Tasks scaffolded from a Proposal inherit the parent Proposal's labels (not the approver's labels)           | `test/mission-19/labels.test.ts` "scaffold inherits proposal labels" |
| INV-T17 | Tasks spawned from a converged Thread's `convergenceAction` inherit the Thread's labels                     | `test/mission-19/labels.test.ts` "thread-spawn inherits thread labels" |

**Resolved gaps:**
- ~~GAP-1~~: `isValidTransition()` is now called in all Task, Idea, Mission, Turn policy handlers (resolved in task-107).
- ~~GAP-9~~: Terminal states are now enforced via FSM guards (resolved in task-107).

---

### 1.2 Proposal

```
Entity: Proposal
States: submitted, approved, rejected, changes_requested, implemented
Initial: submitted
Terminal: implemented
Additional fields:
  labels — Record<string, string>; Mission-19 routing metadata inherited from the creator's Agent at submit-time
```

#### Transitions

| From               | To                  | Trigger                    | Actor     |
| ------------------ | ------------------- | -------------------------- | --------- |
| (initial)          | submitted           | `create_proposal`          | Engineer  |
| submitted          | approved            | `create_proposal_review`   | Architect |
| submitted          | rejected            | `create_proposal_review`   | Architect |
| submitted          | changes_requested   | `create_proposal_review`   | Architect |
| approved           | implemented         | `close_proposal`           | Engineer  |
| rejected           | implemented         | `close_proposal`           | Engineer  |
| changes_requested  | implemented         | `close_proposal`           | Engineer  |

#### Invariants

| ID       | Invariant                                                                       | Tested By                              |
| -------- | ------------------------------------------------------------------------------- | -------------------------------------- |
| INV-P1   | Only the Architect can review proposals                                         | `e2e-remediation.test.ts` "RBAC enforcement" |
| INV-P2   | Only submitted proposals can be reviewed                                        | NONE (no status guard on `reviewProposal`) |
| INV-P3   | `close_proposal` requires status in {approved, rejected, changes_requested}     | `wave3b-policies.test.ts` "close_proposal fails" |
| INV-P4   | implemented is terminal — no outbound transitions                               | NONE                                   |
| INV-P5   | A Proposal's `labels` are set at `create_proposal` from the caller Agent's labels and are immutable | `test/mission-19/labels.test.ts` "proposal inherits creator labels" |
| INV-P6   | Scaffolded child Tasks use the Proposal's `labels`, never the approver's — so a Director-role approver cannot redirect the pool | `test/mission-19/labels.test.ts` "scaffold inherits proposal labels" |

~~**Gap: `under_review` phantom state — RESOLVED (task-107): removed from enum.**~~

**Gap (GAP-5):** `reviewProposal` in the store has no status guard — a proposal could theoretically be reviewed multiple times, overwriting previous decisions. The Registry specifies that only `submitted` proposals should be reviewable.

---

### 1.3 Thread

```
Entity: Thread
States: active, converged, round_limit, closed
Initial: active
Terminal: closed
Additional fields:
  labels — Record<string, string>; Mission-19 routing metadata inherited from the opener Agent at create-time
```

#### Transitions

| From         | To           | Trigger                                              | Actor     |
| ------------ | ------------ | ---------------------------------------------------- | --------- |
| (initial)    | active       | `create_thread`                                      | Any       |
| active       | active       | `create_thread_reply` (normal reply, turn flips)     | Any       |
| active       | converged    | `create_thread_reply` (both parties signalled converged) | Any    |
| active       | round_limit  | `create_thread_reply` (roundCount >= maxRounds)      | System    |
| active       | closed       | `close_thread`                                       | Architect |
| converged    | closed       | `close_thread`                                       | Architect |
| escalated    | closed       | `close_thread`                                       | Architect |
| round_limit  | closed       | `close_thread`                                       | Architect |
| any          | closed       | `create_task` with sourceThreadId (auto-close)       | Architect |

#### Invariants

| ID       | Invariant                                                                       | Tested By                                |
| -------- | ------------------------------------------------------------------------------- | ---------------------------------------- |
| INV-TH1  | Only the current turn holder can reply                                          | `e2e-chaos.test.ts` "reply when not your turn" |
| INV-TH2  | Turn alternates between architect and engineer after each reply                 | `e2e-foundation.test.ts` "thread tracks turn" |
| INV-TH3  | Convergence requires both parties to signal `converged: true`                   | `e2e-foundation.test.ts` "both parties converge" |
| INV-TH4  | `thread_message` targets the opposite role from the author                      | `e2e-foundation.test.ts` "thread convergence" |
| INV-TH5  | `thread_converged` targets architect (for follow-through)                       | `e2e-foundation.test.ts` "thread convergence" |
| INV-TH6  | Replies to non-active threads are rejected                                      | NONE                                     |
| INV-TH7  | `close_thread` can close a thread in any state                                  | NONE (no status guard in store)          |
| INV-TH8  | `escalated` state is set when round_limit is reached                            | NONE (code uses `round_limit`, `escalated` may be unused) |
| INV-TH9  | A Thread's `labels` are set at `create_thread` from the opener Agent's labels and are immutable | `test/mission-19/labels.test.ts` "thread inherits opener labels" |
| INV-TH10 | Entities auto-spawned by a Thread's `convergenceAction` (Task or Proposal) inherit the Thread's `labels` — a Director mediating the conversation cannot rewrite the downstream routing domain | `test/mission-19/labels.test.ts` "thread-spawn inherits thread labels" |

**Gap: The `escalated` state exists in the enum but it's unclear when it's set vs `round_limit`. The store appears to use `round_limit` when maxRounds is reached. `escalated` may be a phantom state or intended for future Director intervention.**

---

### 1.4 Idea

```
Entity: Idea
States: open, triaged, dismissed, incorporated
Initial: open
Terminal: (none — ideas can be re-opened in principle)
```

#### Transitions

| From   | To            | Trigger                                          | Actor     |
| ------ | ------------- | ------------------------------------------------ | --------- |
| (any)  | (any)         | `update_idea` (no FSM guard)                     | Architect |
| (any)  | incorporated  | `update_idea` with missionId (auto-sets status)  | Architect |

#### Invariants

| ID       | Invariant                                                              | Tested By                              |
| -------- | ---------------------------------------------------------------------- | -------------------------------------- |
| INV-I1   | Incorporating an idea into a mission auto-links it                     | `e2e-workflows.test.ts` "auto-link"   |
| INV-I2   | Auto-linkage failure is non-fatal (idea still updated)                 | NONE                                   |

**Gap: No FSM enforcement. Any status can transition to any other status. The Registry recommends adding guards: `dismissed` should be terminal (or require explicit re-opening), `incorporated` should only be reachable when `missionId` is set.**

---

### 1.5 Mission

```
Entity: Mission
States: proposed, active, completed, abandoned
Initial: proposed
Terminal: completed, abandoned
```

#### Transitions

| From      | To         | Trigger                             | Actor     |
| --------- | ---------- | ----------------------------------- | --------- |
| (initial) | proposed   | `create_mission`                    | Architect |
| proposed  | active     | `update_mission` (status="active")  | Architect |
| active    | completed  | `update_mission` (status="completed") | Architect |
| active    | abandoned  | `update_mission` (status="abandoned") | Architect |

#### Invariants

| ID       | Invariant                                                              | Tested By                              |
| -------- | ---------------------------------------------------------------------- | -------------------------------------- |
| INV-M1   | Tasks auto-link to mission when `correlationId` matches `mission-\d+`  | `e2e-workflows.test.ts` "auto-link"   |
| INV-M2   | Ideas auto-link to mission via `update_idea` with missionId            | `e2e-workflows.test.ts` "auto-link"   |
| INV-M3   | Auto-linkage failure is non-fatal (task/idea still created)            | `e2e-chaos.test.ts` "non-existent mission" |
| INV-M4   | completed and abandoned are terminal                                   | NONE                                   |

**Gap: No FSM enforcement. `update_mission` sets status directly. A completed mission could be reverted to proposed. The Registry specifies that terminal states must be enforced.**

---

### 1.6 Turn

```
Entity: Turn
States: planning, active, completed
Initial: planning
Terminal: completed
```

#### Transitions

| From      | To         | Trigger                            | Actor     |
| --------- | ---------- | ---------------------------------- | --------- |
| (initial) | planning   | `create_turn`                      | Architect |
| planning  | active     | `update_turn` (status="active")    | Architect |
| active    | completed  | `update_turn` (status="completed") | Architect |

#### Invariants

| ID       | Invariant                                      | Tested By |
| -------- | ---------------------------------------------- | --------- |
| INV-TN1  | completed is terminal                          | NONE      |

**Gap: Same as Mission — no FSM enforcement on transitions.**

---

### 1.7 Tele (Immutable)

```
Entity: Tele
States: (none — immutable once created)
Mutability: IMMUTABLE — no update or delete operations exist
```

#### Invariants

| ID       | Invariant                                        | Tested By                           |
| -------- | ------------------------------------------------ | ----------------------------------- |
| INV-TE1  | Tele cannot be modified after creation           | NONE (enforced by absence of API)   |
| INV-TE2  | Tele cannot be deleted                           | NONE (enforced by absence of API)   |

---

### 1.8 Audit Entry (Immutable, Append-Only)

```
Entity: Audit Entry
States: (none — append-only log)
Mutability: APPEND-ONLY — entries cannot be modified or deleted
```

#### Invariants

| ID       | Invariant                                          | Tested By                          |
| -------- | -------------------------------------------------- | ---------------------------------- |
| INV-A1   | Audit entries are immutable once created            | NONE (enforced by absence of API)  |
| INV-A2   | Actor field is derived from session role (not hardcoded)       | `e2e-remediation.test.ts` "actor derived from session" |

~~**Gap (GAP-6): RESOLVED (task-108)** — actor is now derived from `ctx.stores.engineerRegistry.getRole(ctx.sessionId)`.~~

---

### 1.9 Document (Stateless)

```
Entity: Document
States: (none — stateless CRUD on GCS)
Mutability: Overwritable (create_document overwrites existing)
```

#### Invariants

| ID       | Invariant                                                           | Tested By |
| -------- | ------------------------------------------------------------------- | --------- |
| INV-D1   | `create_document` path must start with `documents/`                 | NONE      |
| INV-D2   | Document operations require GCS storage backend                     | NONE      |

---

### 1.10 Agent (M18 + Mission-19)

```
Entity: Agent
States: online, offline
Initial: online (on first register_role handshake)
Terminal: (none — archival via `archived` flag, not deletion)
Identity: engineerId (Hub-issued) — stable across reconnects
          fingerprint = sha256(globalInstanceId) — carried by the proxy
          sessionEpoch — monotonic; incremented on each displacement
          currentSessionId — ephemeral, set per SSE connection
Routing fields:
  role    — "engineer" | "architect" | "director"
  labels  — Record<string, string>; Kubernetes-style routing metadata, IMMUTABLE post-create in v1
```

Agents are the first-class routing targets in Mission-19. Every dispatched event resolves a `Selector` (roles ∧ matchLabels ∧ optional engineerId pin) against the live Agent registry — there are no role-wide broadcasts once labels are in use.

#### Reserved Label Keys

| Key                 | Semantics                                                                 |
| ------------------- | ------------------------------------------------------------------------- |
| `ois.io/namespace`  | Reserved for a future strict-isolation tenant boundary. No special v1 behavior — stored verbatim; treated like any other label. |

Keys prefixed with `ois.io/` are reserved for future Hub-defined routing semantics. Caller-supplied labels under this prefix are currently accepted and stored but may acquire special handling in later missions.

#### Invariants

| ID       | Invariant                                                                                                    | Tested By                                      |
| -------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| INV-AG1  | An Agent's `labels` are set at first `register_role` and cannot be changed by later handshakes (displacing calls preserve the original set) | `test/mission-19/registry.test.ts` "labels preserved on displacement" |
| INV-AG2  | Agent identity is `engineerId` (Hub-issued, stable). `currentSessionId` is ephemeral and MUST NOT be used for P2P routing | `test/mission-19/registry.test.ts` "P2P via engineerId" |
| INV-AG3  | An Agent with empty `labels = {}` matches any Selector whose `matchLabels` is also empty or absent; it does NOT match a Selector that requires specific labels | `test/mission-19/selector.test.ts` "empty labels match empty selectors" |
| INV-AG4  | A pre-Mission-19 Agent persisted without a `labels` field is defensively migrated to `labels = {}` on read | `test/mission-19/registry.test.ts` "legacy agents default to empty labels" |
| INV-AG5  | `register_role` may optionally declare `labels`. On first create, they persist. On displacement, the persisted labels are preserved verbatim (ignore incoming) | `test/mission-19/registry.test.ts` "displacement ignores incoming labels" |

---

## 2. Multi-Actor Workflow Declarations

### WF-001 Task Happy Path

```
Actors: Architect, Engineer
Precondition: None
```

| Step | Actor     | Action                                          | State After  | Dispatch Selector                                                  |
| ---- | --------- | ----------------------------------------------- | ------------ | ------------------------------------------------------------------ |
| 1    | Architect | `create_task(title, description)`               | pending      | `task_issued` → { roles: [engineer], matchLabels: task.labels } |
| 2    | Engineer  | `get_task()`                                    | working      | `directive_acknowledged` → { roles: [architect], matchLabels: task.labels } |
| 3    | Engineer  | `create_report(taskId, ...)`                    | in_review    | `report_submitted` → { roles: [architect], matchLabels: task.labels } |
| 4    | Architect | `create_review(taskId, ..., decision: "approved")` | completed  | `review_completed` → { engineerId: task.assignedEngineerId } (P2P; label-scoped pool fallback if null) |

Step 1: `task.labels` are inherited from the caller Architect's Agent at submit-time (INV-T13). All downstream dispatches filter to Agents whose `labels` cover those keys (INV-AG3).
Step 2: `get_task` applies claim enforcement — only Agents whose `labels` are a superset of `task.labels` see the Task (INV-T14). `task.assignedEngineerId` is recorded (INV-T15).
Step 3 transitions to `in_review` (not `completed`). No DAG cascade fires at this point.
Step 4 transitions to `completed` and triggers DAG cascade (`unblockDependents`) if dependents exist. `review_completed` routes P2P to the original claimant via `assignedEngineerId` so the same Engineer instance that did the work sees the approval — even if other Agents share the label scope.

**Agent behavior:** Step 4 is automated — the Architect's `sandwichReviewReport` handler fires on `report_submitted`, reads the report from GCS, uses LLM to evaluate, and calls `create_review` with `decision: "approved"`.

**Tested By:** NONE (existing tests use old semantics — will be updated in Mission-6 T5)

---

### WF-001a Task Revision Loop

```
Actors: Architect, Engineer
Precondition: Task in working state
```

| Step | Actor     | Action                                           | State After  | Dispatch Selector                                          |
| ---- | --------- | ------------------------------------------------ | ------------ | ---------------------------------------------------------- |
| 1    | Engineer  | `create_report(taskId, ...)`                     | in_review    | `report_submitted` → { roles: [architect], matchLabels: task.labels } |
| 2    | Architect | `create_review(taskId, ..., decision: "rejected")` | working    | `revision_required` → { engineerId: task.assignedEngineerId } (P2P; label-scoped pool fallback) |
| 3    | Engineer  | Reads feedback, revises work                     | working      | (none)                                                    |
| 4    | Engineer  | `create_report(taskId, ...)`                     | in_review    | `report_submitted` → { roles: [architect], matchLabels: task.labels } |
| 5    | Architect | `create_review(taskId, ..., decision: "approved")` | completed  | `review_completed` → { engineerId: task.assignedEngineerId } (P2P; label-scoped pool fallback) |

Step 2 increments `revisionCount` and emits `revision_required` with `previousReportRef` and `reviewRef`.
Step 4 generates a versioned report name: `reports/{taskId}-v{revisionCount+1}-report.md`.

**Agent behavior:** Step 2 is automated — `sandwichReviewReport` evaluates the report and may reject with specific feedback. Step 3 requires the Engineer Plugin to surface the `revision_required` event as an actionable prompt.

**Tested By:** NONE (new workflow — will be tested in Mission-6 T5)

---

### WF-001b Task Escalation (Circuit Breaker)

```
Actors: Architect, Engineer, System
Precondition: Task has been rejected 3+ times (revisionCount >= 3)
```

| Step | Actor     | Action                                           | State After  | Dispatch Selector                                         |
| ---- | --------- | ------------------------------------------------ | ------------ | --------------------------------------------------------- |
| 1    | Engineer  | `create_report(taskId, ...)`                     | in_review    | `report_submitted` → { roles: [architect], matchLabels: task.labels } |
| 2    | Architect | `create_review(taskId, ..., decision: "rejected")` | escalated  | `director_attention_required` → { roles: [architect], matchLabels: task.labels } |

Step 2: when `revisionCount >= 3`, the system transitions to `escalated` instead of `working`. The `escalated` state is locked — no outbound transitions. The Engineer cannot submit further reports. Requires future Director intervention (e.g., `reset_task` tool).

**Tested By:** NONE (new workflow — will be tested in Mission-6 T5)

---

### WF-002 Task with Clarification

```
Actors: Architect, Engineer
Precondition: Task exists in working state
```

| Step | Actor     | Action                              | State After     | Dispatch Selector                                                                            |
| ---- | --------- | ----------------------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| 1    | Engineer  | `create_clarification(taskId, q)`   | input_required  | `clarification_requested` → { roles: [architect], matchLabels: task.labels }                 |
| 2    | Architect | `resolve_clarification(taskId, a)`  | working         | `clarification_answered` → { engineerId: task.assignedEngineerId } (P2P; label-scoped pool fallback) |
| 3    | Engineer  | `get_clarification(taskId)`         | working         | (none)                                                                                       |

**Agent behavior:** Step 2 is automated — the Architect's `sandwichClarification` handler fires on `clarification_requested`, uses LLM to answer, and calls `resolve_clarification`.

**Tested By:** `e2e-foundation.test.ts` "working → input_required → working state transitions"

---

### WF-003 Task DAG — Dependency Unblocking

```
Actors: Architect, Engineer, System
Precondition: Two or more tasks with dependency relationships
```

| Step | Actor     | Action                                              | State After  | Dispatch Selector                                      |
| ---- | --------- | --------------------------------------------------- | ------------ | ------------------------------------------------------ |
| 1    | Architect | `create_task("A", ...)`                             | A: pending   | `task_issued` → { roles: [engineer], matchLabels: A.labels } |
| 2    | Architect | `create_task("B", ..., dependsOn: ["A"])`           | B: blocked   | `task_blocked` → { roles: [architect], matchLabels: B.labels } |
| 3    | Engineer  | `get_task()` → picks up A                           | A: working   | `directive_acknowledged` → { roles: [architect], matchLabels: A.labels } |
| 4    | Engineer  | `create_report("A", ...)`                           | A: in_review | `report_submitted` → { roles: [architect], matchLabels: A.labels } |
| 5    | Architect | `create_review("A", ..., decision: "approved")`     | A: completed | `review_completed` → { engineerId: A.assignedEngineerId } (P2P) |
| 6    | System    | Cascade: unblockDependents(A)                       | B: pending   | `task_issued` → { roles: [engineer], matchLabels: B.labels } |
| 7    | Engineer  | `get_task()` → picks up B                           | B: working   | `directive_acknowledged` → { roles: [architect], matchLabels: B.labels } |

**Key change (v2.0.0):** Cascade unblocking now happens at Step 6 (after review approval), not at Step 4 (after report). This prevents unblocking dependents before the Architect has verified the work.

**Tested By:** NONE (existing tests use old semantics — will be updated in Mission-6 T5)

---

### WF-003a Task DAG — Cancel Cascade

```
Actors: Architect, System
Precondition: Parent task with blocked dependents
```

| Step | Actor     | Action                                        | State After   | Dispatch Selector                                         |
| ---- | --------- | --------------------------------------------- | ------------- | --------------------------------------------------------- |
| 1    | Architect | `cancel_task("A")`                            | A: cancelled  | `task_cancelled` → { roles: [architect], matchLabels: A.labels } |
| 2    | System    | Cascade: cancelDependents(A)                  | B: cancelled  | `task_cancelled` → { roles: [architect], matchLabels: B.labels } |

**Tested By:** `e2e-workflows.test.ts` "cancelling parent cascades cancellation"

---

### WF-004 Proposal Happy Path

```
Actors: Architect, Engineer
Precondition: None
```

| Step | Actor     | Action                                     | State After       | Dispatch Selector                                                |
| ---- | --------- | ------------------------------------------ | ----------------- | ---------------------------------------------------------------- |
| 1    | Engineer  | `create_proposal(title, summary, body)`    | submitted         | `proposal_submitted` → { roles: [architect], matchLabels: proposal.labels } |
| 2    | Architect | `create_proposal_review(id, decision, fb)` | approved          | `proposal_decided` → { roles: [engineer], matchLabels: proposal.labels } |
| 3    | Engineer  | `close_proposal(id)`                       | implemented       | (none)                                                           |

**Agent behavior:** Step 2 is automated — the Architect's `sandwichReviewProposal` handler fires on `proposal_submitted`.
**Label inheritance:** When the review scaffolds child Tasks (via `ProposedExecutionPlan`), each scaffolded Task is created with `proposal.labels`, not the approver's labels (INV-P6, INV-T16). A Director-role approver outside the original label scope cannot accidentally redirect implementation to a different pool.

**Tested By:** `e2e-workflows.test.ts` "create → changes_requested → resubmit → approve → close"

---

### WF-004a Proposal with Changes Requested

```
Actors: Architect, Engineer
Precondition: None
```

| Step | Actor     | Action                                           | State After         | Event Emitted                       |
| ---- | --------- | ------------------------------------------------ | ------------------- | ----------------------------------- |
| 1    | Engineer  | `create_proposal(title, summary, body)`          | submitted           | `proposal_submitted` → [architect]  |
| 2    | Architect | `create_proposal_review(id, "changes_requested", fb)` | changes_requested | `proposal_decided` → [engineer]  |
| 3    | Engineer  | `create_proposal(title_v2, summary_v2, body_v2)` | new: submitted      | `proposal_submitted` → [architect]  |
| 4    | Architect | `create_proposal_review(id_v2, "approved", fb)`  | new: approved       | `proposal_decided` → [engineer]     |
| 5    | Engineer  | `close_proposal(id_v2)`                          | new: implemented    | (none)                              |

**Note:** There is no "update proposal" operation. The Engineer creates a new proposal. The original remains in `changes_requested` state permanently.

**Tested By:** `e2e-workflows.test.ts` "create → changes_requested → resubmit → approve → close"

---

### WF-004b Proposal Rejection

```
Actors: Architect, Engineer
Precondition: Submitted proposal
```

| Step | Actor     | Action                                       | State After  | Event Emitted                       |
| ---- | --------- | -------------------------------------------- | ------------ | ----------------------------------- |
| 1    | Engineer  | `create_proposal(title, summary, body)`      | submitted    | `proposal_submitted` → [architect]  |
| 2    | Architect | `create_proposal_review(id, "rejected", fb)` | rejected     | `proposal_decided` → [engineer]     |

**Tested By:** `e2e-workflows.test.ts` "proposal rejection flow"

---

### WF-005 Thread Happy Path — Convergence

```
Actors: Architect, Engineer
Precondition: None
```

| Step | Actor     | Action                                                        | State After | Dispatch Selector                                                  |
| ---- | --------- | ------------------------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| 1    | Any       | `create_thread(title, message)`                               | active      | `thread_message` → { roles: [other role], matchLabels: thread.labels } |
| 2    | Other     | `create_thread_reply(id, msg, converged: true)`               | active      | `thread_message` → { roles: [initiator role], matchLabels: thread.labels } |
| 3    | Initiator | `create_thread_reply(id, msg, converged: true)`               | converged   | `thread_converged` → { roles: [architect], matchLabels: thread.labels } |

**Agent behavior:** Step 3's `thread_converged` event triggers one of two mutually exclusive paths:

- **Path A (WF-005b):** If a `convergenceAction` was attached to the thread, the Hub cascade handles it deterministically — no Architect LLM involvement.
- **Path B (WF-005a):** If no `convergenceAction` exists, the Architect LLM receives the `thread_converged` event (with `hasAction: false`) and autonomously decides what action to take.

The `hasAction` flag in the `thread_converged` event payload prevents both paths from firing simultaneously (see INV-SYS-018).

**Tested By:** `e2e-foundation.test.ts` "both parties converge → thread status = converged"

---

### WF-005a Thread — Convergence to Auto-Directive (Architect LLM Path)

```
Actors: Architect (automated), Engineer
Precondition: Thread converged WITHOUT a convergenceAction (hasAction = false)
```

| Step | Actor           | Action                                               | State After          | Event Emitted                     |
| ---- | --------------- | ---------------------------------------------------- | -------------------- | --------------------------------- |
| 1    | System          | `thread_converged` event fires (hasAction: false)    | thread: converged    | `thread_converged` → [architect]  |
| 2    | Architect (LLM) | `sandwichThreadConverged` reads thread, LLM reasons  | —                    | —                                 |
| 3    | Architect (LLM) | If `implementation_ready`: `create_task(title, desc, sourceThreadId)` | task: pending | `task_issued` → [engineer] |
| 4    | System          | Thread auto-closed by sourceThreadId (XD-005)        | thread: closed       | —                                 |

**Guard:** `sandwichThreadConverged` checks thread status before acting — if the thread is already `closed` (e.g. Hub cascade beat the event loop), it skips processing.

**Tested By:** NONE (requires LLM integration — not testable in-memory)

**Note:** This is the only workflow where the Architect autonomously creates tasks without Director instruction.

---

### WF-005b Thread — Convergence via Hub Cascade (convergenceAction Path)

```
Actors: System (Hub policy engine)
Precondition: Thread converged WITH a convergenceAction attached
```

| Step | Actor  | Action                                                                      | State After       | Dispatch Selector                                             |
| ---- | ------ | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------- |
| 1    | Any    | `create_thread_reply(converged: true, convergenceAction: {type, template})` | converged         | internal: `thread_converged_with_action`                      |
| 2    | Hub    | `handleThreadConvergedWithAction` reads action type                         | —                 | —                                                             |
| 3a   | Hub    | If `create_task`: `submitDirective(description, labels: thread.labels)`     | task: pending     | `task_issued` → { roles: [engineer], matchLabels: thread.labels } |
| 3b   | Hub    | If `create_proposal`: `submitProposal(title, description, labels: thread.labels)` | proposal: submitted | `proposal_submitted` → { roles: [architect], matchLabels: thread.labels } |
| 4    | Hub    | `closeThread(threadId)`                                                     | thread: closed    | —                                                             |
| 5    | System | `thread_converged` SSE emitted (hasAction: true)                            | —                 | `thread_converged` → { roles: [architect], matchLabels: thread.labels } |

**Label inheritance:** The spawned Task or Proposal inherits the Thread's labels — NOT the converging party's labels (INV-T17, INV-TH10). This lets a Director-role Agent mediate a conversation between two domain-scoped Engineers/Architects without rewriting the downstream routing scope.

**Dedup:** Step 5 emits the SSE event with `hasAction: true`. The Architect's notification handler skips `sandwichThreadConverged` when this flag is set, preventing duplicate task/proposal creation. The event-loop polling backup is also guarded — `sandwichThreadConverged` re-reads the thread and skips if status is already `closed`.

**Key difference from WF-005a:** This path is deterministic and Hub-driven. The action is pre-declared via `convergenceAction` (late-binding) — no LLM reasoning required. The converging party specifies exactly what should happen on convergence.

**Tested By:** NONE (requires integration test with convergenceAction)

---

### WF-006 Mission Lifecycle

```
Actors: Architect
Precondition: None
```

| Step | Actor     | Action                                           | State After | Event Emitted                               |
| ---- | --------- | ------------------------------------------------ | ----------- | ------------------------------------------- |
| 1    | Architect | `create_mission(title, description)`             | proposed    | `mission_created` → [architect, engineer]   |
| 2    | Architect | `update_mission(id, status: "active")`           | active      | `mission_activated` → [architect, engineer] |
| 3    | Architect | `update_mission(id, status: "completed")`        | completed   | (none — no event for completion)            |

**Tested By:** NONE (individual operations tested in `wave2-policies.test.ts` but not as a workflow)

---

### WF-007 Idea to Mission Incorporation

```
Actors: Architect, Engineer
Precondition: Mission exists
```

| Step | Actor     | Action                                           | State After   | Event Emitted                              |
| ---- | --------- | ------------------------------------------------ | ------------- | ------------------------------------------ |
| 1    | Any       | `create_idea(text)`                              | open          | `idea_submitted` → [architect, engineer]   |
| 2    | Architect | `update_idea(id, missionId: "mission-1")`        | incorporated  | (none)                                     |

**Cross-domain effect:** `mission.ideas` view includes this ideaId on next read (computed from `idea.missionId`).

**Tested By:** `e2e-workflows.test.ts` "tasks and ideas auto-link to mission"

---

### WF-008 Event Loop Catch-Up (Agent-Side)

```
Actors: Architect (automated)
Trigger: 300s periodic timer OR state sync on reconnect
Precondition: Architect connected to Hub
```

| Step | Actor           | Action                                    | Effect                                    |
| ---- | --------------- | ----------------------------------------- | ----------------------------------------- |
| 1    | Architect       | `get_pending_actions()`                   | Discovers all outstanding work            |
| 2    | Architect (LLM) | Process `unreviewedTasks`                 | Calls `sandwichReviewReport` per task     |
| 3    | Architect (LLM) | Process `pendingProposals`                | Calls `sandwichReviewProposal` per proposal |
| 4    | Architect (LLM) | Process `threadsAwaitingReply`            | Calls `sandwichThreadReply` per thread    |
| 5    | Architect (LLM) | Process `clarificationsPending`           | Calls `sandwichClarification` per task    |
| 6    | Architect (LLM) | Process `convergedThreads`                | Calls `sandwichThreadConverged` per thread (guarded — skips if thread already closed by Hub cascade) |

**Dedup note:** Step 6 is a polling backup for `thread_converged` SSE events. The `sandwichThreadConverged` handler re-reads the thread and skips if status is `closed`, preventing duplicates when the Hub cascade (WF-005b) already handled the convergence.

**Tested By:** NONE (agent-side, requires LLM)

---

## 3. Cross-Domain Interaction Map

### XD-001 Task → Mission Linkage (Virtual View)

| Field       | Value                                                                 |
| ----------- | --------------------------------------------------------------------- |
| Trigger     | `create_task` with `correlationId` matching `/^mission-\d+$/`         |
| Mechanism   | `task.correlationId` stored on the Task; `mission.tasks` computed on read from the task store filtered by that field. |
| Failure     | None — no link step to fail. Setting `correlationId` is atomic with task creation. |
| Tested By   | `mission-integrity.test.ts` (concurrent create_task) + `e2e-workflows.test.ts` |

### XD-002 Idea → Mission Linkage (Virtual View)

| Field       | Value                                                                 |
| ----------- | --------------------------------------------------------------------- |
| Trigger     | `update_idea` with `missionId` set, resulting status = `incorporated` |
| Mechanism   | `idea.missionId` stored on the Idea; `mission.ideas` computed on read from the idea store filtered by that field. |
| Failure     | None — no link step to fail. Setting `missionId` is atomic with the idea update. |
| Tested By   | `mission-integrity.test.ts` (concurrent update_idea) + `e2e-workflows.test.ts` |

### XD-003 Task Review Approval → DAG Cascade

| Field       | Value                                                                 |
| ----------- | --------------------------------------------------------------------- |
| Trigger     | `create_review(decision: "approved")` approves a task with blocked dependents |
| Mechanism   | Internal event `task_completed` → `handleTaskCompleted` cascade       |
| Effect      | `task.unblockDependents(taskId)` — transitions each dependent blocked→pending |
| Events      | `task_issued` → [engineer] per unblocked task                    |
| Failure     | Non-fatal to primary op — `cascade_failure` → [architect]            |
| Tested By   | NONE (existing tests use old trigger — will be updated in Mission-6 T5) |

**Key change (v2.0.0):** Trigger moved from `create_report` to `create_review(approved)`. This ensures dependents are only unblocked after the Architect has verified the prerequisite work.

### XD-004 Task Cancellation → DAG Cascade

| Field       | Value                                                                 |
| ----------- | --------------------------------------------------------------------- |
| Trigger     | `cancel_task` cancels a task that has blocked dependents              |
| Mechanism   | Internal event `task_cancelled` → `handleTaskCancelled` cascade       |
| Effect      | `task.cancelDependents(taskId)` — transitions each dependent blocked→cancelled |
| Events      | `task_cancelled` → [architect] per cancelled dependent                |
| Failure     | Non-fatal to primary op — `cascade_failure` → [architect]            |
| Tested By   | `e2e-workflows.test.ts` "cancelling parent cascades"                 |

### XD-005 Task Creation → Thread Auto-Close

| Field       | Value                                                                 |
| ----------- | --------------------------------------------------------------------- |
| Trigger     | `create_task` with `sourceThreadId` set                               |
| Effect      | `thread.closeThread(sourceThreadId)` — closes the originating thread  |
| Failure     | Non-fatal — task is created, close failure logged                     |
| Tested By   | `policy-router.test.ts` "createTask auto-closes source thread"       |

### XD-006a Thread Convergence → Auto-Action (Hub Cascade)

| Field       | Value                                                                 |
| ----------- | --------------------------------------------------------------------- |
| Trigger     | `create_thread_reply` detects convergence AND `convergenceAction` is present |
| Effect      | Hub spawns task or proposal from `convergenceAction.templateData`, closes thread |
| Cascade     | `task_issued` → [engineer] or `proposal_submitted` → [architect] |
| Dedup       | `thread_converged` SSE emitted with `hasAction: true` — Architect skips (INV-SYS-018) |
| Failure     | Non-fatal — convergence detected but action malformed, logged         |
| Tested By   | NONE (requires integration test with convergenceAction)              |

### XD-006b Thread Convergence → Auto-Directive (Architect LLM)

| Field       | Value                                                                 |
| ----------- | --------------------------------------------------------------------- |
| Trigger     | `thread_converged` SSE event with `hasAction: false` and `intent: "implementation_ready"` |
| Effect      | Architect LLM generates directive, calls `create_task` with `sourceThreadId` |
| Cascade     | Task creation triggers XD-005 (thread auto-close)                    |
| Guard       | `sandwichThreadConverged` skips if thread status is already `closed`  |
| Failure     | LLM failure — no task created, logged via `create_audit_entry`       |
| Tested By   | NONE (requires LLM)                                                  |

---

## 4. SSE Event Catalogue

Since Mission-19 (v2.1.0), all events in this catalogue are delivered via `ctx.dispatch(event, data, selector)` — the Hub resolves the Selector against the live Agent registry and SSE-pushes to every matching Agent. The "Target" column below is shorthand for the Selector: `[role]` means `{ roles: [role], matchLabels: <entity>.labels }` where `<entity>` is the Task/Proposal/Thread whose lifecycle event this is. Entries marked **P2P** pin to a specific `engineerId` (with a label-scoped pool fallback when the pin is unavailable). See §6 for the routing model.

### 4.1 Task Domain Events

| Event                    | Emitter                         | Target          | Payload                                         | Purpose                               |
| ------------------------ | ------------------------------- | --------------- | ------------------------------------------------ | ------------------------------------- |
| `task_issued`       | TaskPolicy.createTask           | [engineer] ∧ task.labels | taskId, directive, correlationId, sourceThreadId  | New task available for pickup within the Task's label scope |
| `task_issued`       | TaskPolicy.handleTaskCompleted  | [engineer] ∧ task.labels | taskId, directive, correlationId                  | Blocked task unblocked by cascade     |
| `task_blocked`           | TaskPolicy.createTask           | [architect] ∧ task.labels | taskId, directive, correlationId, dependsOn       | Task created but waiting on deps      |
| `directive_acknowledged` | TaskPolicy.getTask              | [architect] ∧ task.labels | taskId, engineerId, directive                     | Engineer picked up task               |
| `report_submitted`       | TaskPolicy.createReport         | [architect] ∧ task.labels | taskId, summary, reportRef                        | Engineer completed work               |
| `task_cancelled`         | TaskPolicy.handleTaskCancelled  | [architect] ∧ task.labels | taskId, reason                                    | Dependent task cascade-cancelled      |

### 4.2 Clarification Events

| Event                      | Emitter                                   | Target                                  | Payload            | Purpose                           |
| -------------------------- | ----------------------------------------- | --------------------------------------- | ------------------ | --------------------------------- |
| `clarification_requested`  | ClarificationPolicy.createClarification   | [architect] ∧ task.labels               | taskId, question   | Engineer needs guidance           |
| `clarification_answered`   | ClarificationPolicy.resolveClarification  | **P2P** task.assignedEngineerId (fallback: [engineer] ∧ task.labels) | taskId, answer     | Architect responded — routes back to the exact Agent instance that asked |

### 4.3 Review Events

| Event                        | Emitter                   | Target                                                 | Payload                                              | Purpose                              |
| ---------------------------- | ------------------------- | ------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------- |
| `review_completed`           | ReviewPolicy.createReview | **P2P** task.assignedEngineerId (fallback: [engineer] ∧ task.labels) | taskId, reviewRef, assessment, decision               | Architect approved report — routes to the original claimant |
| `revision_required`          | ReviewPolicy.createReview | **P2P** task.assignedEngineerId (fallback: [engineer] ∧ task.labels) | taskId, assessment, previousReportRef, reviewRef, revisionCount | Report rejected — revision needed by the original claimant |
| `director_attention_required`| ReviewPolicy.createReview | [architect] ∧ task.labels                              | taskId, revisionCount, assessment                     | Circuit breaker: task escalated after 3+ rejections |

### 4.4 Proposal Events

| Event                | Emitter                                  | Target                           | Payload                                    | Purpose                    |
| -------------------- | ---------------------------------------- | -------------------------------- | ------------------------------------------ | -------------------------- |
| `proposal_submitted` | ProposalPolicy.createProposal            | [architect] ∧ proposal.labels    | proposalId, title, summary, proposalRef    | New proposal for review    |
| `proposal_decided`   | ProposalPolicy.createProposalReview      | [engineer] ∧ proposal.labels     | proposalId, decision, feedback             | Architect made a decision  |

### 4.5 Thread Events

| Event              | Emitter                              | Target                                       | Payload                                       | Purpose                     |
| ------------------ | ------------------------------------ | -------------------------------------------- | --------------------------------------------- | --------------------------- |
| `thread_message`   | ThreadPolicy.createThread            | [opposite role] ∧ thread.labels              | threadId, title, author, message, currentTurn  | New thread opened           |
| `thread_message`   | ThreadPolicy.createThreadReply       | [opposite role] ∧ thread.labels              | threadId, title, author, message, currentTurn  | Reply posted (if still active) |
| `thread_converged` | ThreadPolicy.createThreadReply       | [architect] ∧ thread.labels                  | threadId, title, intent, hasAction              | Both parties converged. `hasAction: true` signals Hub cascade handled it — Architect must skip LLM processing |

### 4.6 Planning Domain Events

| Event               | Emitter                      | Target                 | Payload          | Purpose              |
| ------------------- | ---------------------------- | ---------------------- | ---------------- | -------------------- |
| `idea_submitted`    | IdeaPolicy.createIdea        | [architect, engineer]  | ideaId, text, author | New idea in backlog |
| `mission_created`   | MissionPolicy.createMission  | [architect, engineer]  | missionId, title | New mission          |
| `mission_activated` | MissionPolicy.updateMission  | [architect, engineer]  | missionId, title | Mission now active   |
| `turn_created`      | TurnPolicy.createTurn        | [architect, engineer]  | turnId, title    | New execution cycle  |
| `turn_updated`      | TurnPolicy.updateTurn        | [architect, engineer]  | turnId, title, status | Turn status changed |
| `tele_defined`      | TelePolicy.createTele        | [architect, engineer]  | teleId, name     | New teleological goal |

### 4.7 System Events

| Event             | Emitter                          | Target      | Payload                           | Purpose                       |
| ----------------- | -------------------------------- | ----------- | --------------------------------- | ----------------------------- |
| `cascade_failure` | PolicyRouter (cascade error)     | [architect] | originalTool, failedEvent, error  | Cascade handler threw         |

### 4.8 Event Count Summary

| Category      | Events | Unique Names |
| ------------- | ------ | ------------ |
| Task          | 6      | 5 (task_issued emitted by 2 sources) |
| Clarification | 2      | 2            |
| Review        | 3      | 3 (review_completed, revision_required, director_attention_required) |
| Proposal      | 2      | 2            |
| Thread        | 3      | 2 (thread_message emitted by 2 sources) |
| Planning      | 5      | 5            |
| System        | 1      | 1            |
| **Total**     | **22** | **20**       |

---

## 5. System Invariants

### Operational Invariants

| ID          | Invariant                                                                          | Tested By                                      |
| ----------- | ---------------------------------------------------------------------------------- | ---------------------------------------------- |
| INV-SYS-001 | Primary operations never fail due to cascade errors                               | `e2e-chaos.test.ts` "primary operation succeeds" |
| INV-SYS-002 | `cascade_failure` notification targets architect only                             | `e2e-chaos.test.ts` "targets architect only"   |
| INV-SYS-003 | Terminal states are irreversible — no outbound transitions                         | `e2e-fsm-enforcement.test.ts` "completed is terminal" |
| INV-SYS-004 | Cross-domain linkage failures are non-fatal to the primary operation              | `e2e-chaos.test.ts` "non-existent mission"     |
| INV-SYS-005 | Idempotency keys prevent duplicate task creation                                  | `e2e-chaos.test.ts` "duplicate idempotency"    |
| INV-SYS-006 | `get_task` is atomic — exactly one engineer picks up a given task                 | `e2e-chaos.test.ts` "only one engineer"        |
| INV-SYS-007 | Empty result sets are returned as success (not errors)                            | `e2e-chaos.test.ts` "no tasks available"       |

### Delivery Invariants

| ID          | Invariant                                                                          | Tested By                                      |
| ----------- | ---------------------------------------------------------------------------------- | ---------------------------------------------- |
| INV-SYS-008 | Events target the correct role — engineer events never reach architect directly    | `e2e-foundation.test.ts` "events target correct roles" |
| INV-SYS-009 | `thread_message` always targets the opposite role from the author                 | `e2e-foundation.test.ts` "thread convergence"  |
| INV-SYS-010 | SSE delivery is at-least-once; clients must handle idempotency                    | NONE (transport-level, not policy-level)        |

### Agent Behavior Invariants

| ID          | Invariant                                                                          | Tested By                                      |
| ----------- | ---------------------------------------------------------------------------------- | ---------------------------------------------- |
| INV-SYS-011 | Architect auto-reviews all completed reports via `sandwichReviewReport`            | NONE (requires LLM)                            |
| INV-SYS-012 | Architect auto-reviews all submitted proposals via `sandwichReviewProposal`        | NONE (requires LLM)                            |
| INV-SYS-013 | Architect auto-replies to threads when it is their turn                            | NONE (requires LLM)                            |
| INV-SYS-014 | Architect auto-answers clarifications via `sandwichClarification`                  | NONE (requires LLM)                            |
| INV-SYS-015 | `thread_converged` with `implementation_ready` triggers auto-directive creation    | NONE (requires LLM)                            |
| INV-SYS-016 | Event loop polls `get_pending_actions` every 300s as SSE backup                   | NONE (requires transport)                      |
| INV-SYS-017 | `thread_converged` has polling backup via `get_pending_actions.convergedThreads`   | `e2e-remediation.test.ts` "surfaces converged threads" |
| INV-SYS-018 | Thread convergence dedup: Hub cascade (WF-005b) and Architect LLM (WF-005a) never both fire for the same thread. `hasAction` flag gates the SSE path; thread status `closed` gates the polling path | NONE (requires integration test) |

### Label/Selector Invariants (Mission-19)

| ID          | Invariant                                                                                                    | Tested By                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| INV-SYS-L01 | Every dispatch resolves a `Selector` — there are no unscoped, role-only broadcasts in policy handlers        | `test/mission-19/selector.test.ts` "no role-only broadcasts" |
| INV-SYS-L02 | `labelsMatch(agent.labels, selector.matchLabels)` is AND-equality: every `(k, v)` in `matchLabels` must appear verbatim in `agent.labels`; a missing key on the Agent is a miss | `test/mission-19/selector.test.ts` "matchLabels is AND-equality" |
| INV-SYS-L03 | `selector.roles` is OR-across-roles but ANDs with `matchLabels` (an Agent must match the role set AND the label set) | `test/mission-19/selector.test.ts` "roles OR, combined with matchLabels AND" |
| INV-SYS-L04 | `selector.engineerId`, when set, pins dispatch to that specific Agent regardless of other filters            | `test/mission-19/selector.test.ts` "engineerId pin overrides pool" |
| INV-SYS-L05 | P2P dispatch with a stale or offline `engineerId` delivers to zero Agents — callers MUST provide a label-scoped fallback for availability | `test/mission-19/p2p.test.ts` "stale engineerId falls through to fallback" |
| INV-SYS-L06 | Entity labels are write-once: set at create-time from the caller Agent's labels (or inherited from parent entity) and never mutated by later operations on the entity | `test/mission-19/labels.test.ts` "entity labels immutable" |
| INV-SYS-L07 | An Agent registered without labels (`labels = {}`) CAN claim unlabeled Tasks but CANNOT claim any Task with non-empty labels | `test/mission-19/claim.test.ts` "unlabeled agent blocked from labeled tasks" |
| INV-SYS-L08 | Label inheritance is authoritative — scaffolded children read labels from the parent entity's record, not from the approver/converging Agent's session | `test/mission-19/labels.test.ts` "scaffold + thread-spawn inherit parent labels" |
| INV-SYS-L09 | If zero Agents match a selector, dispatch is a no-op for SSE — the webhook fallback (when configured) is the only at-least-once delivery path | `test/mission-19/dispatch.test.ts` "empty match → webhook fallback" |
| INV-SYS-L10 | Persisted notifications retain the flattened `targetRoles` field for backward compatibility with the catch-up polling endpoint; selectors are NOT replayed | N/A (transport compatibility, not behavioral) |

---

## 6. Label/Selector Routing

Mission-19 added a Kubernetes-style label/selector model for routing events and claim work across heterogeneous Agent populations. This section is authoritative for all routing semantics.

### 6.1 Model

An **Agent** is registered with:
- `role` — one of `engineer`, `architect`, `director` (used for authorization; also usable in selectors)
- `labels` — a flat `Record<string, string>` of routing metadata

A **Selector** is an object `{ engineerId?, roles?, matchLabels? }`:

```ts
interface Selector {
  engineerId?: string;                   // pin to one Agent
  roles?: ("engineer"|"architect"|"director")[]; // OR across roles
  matchLabels?: Record<string, string>;  // AND-equality subset check on agent.labels
}
```

An Agent `a` matches selector `s` iff **all** of the following hold:
- `s.engineerId === undefined` OR `a.engineerId === s.engineerId`
- `s.roles === undefined` OR `a.role ∈ s.roles`
- For every `(k, v) ∈ (s.matchLabels ?? {})`, `a.labels[k] === v`

Empty / missing fields are *no-ops* — an absent filter does not restrict. An empty selector `{}` matches every online Agent.

### 6.2 Dispatch Surface

Policy handlers call `ctx.dispatch(event, data, selector)`. The Hub:

1. Persists the notification with the flattened `targetRoles` for catch-up (INV-SYS-L10).
2. Resolves `selector` against the live Agent registry (`selectAgents(selector)`).
3. Sends the SSE frame to every matched Agent's `currentSessionId`.
4. If zero matches AND a webhook URL is configured, fires the webhook as fallback (INV-SYS-L09).

Policy handlers MUST NOT reach into the registry directly — they must go through `ctx.dispatch`.

### 6.3 Label Inheritance Chains

| Source                                         | Destination                         | Rule                                                              |
| ---------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------- |
| Caller Agent's labels                          | `Task.labels` at `create_task`      | Set at submit-time (INV-T13)                                      |
| Caller Agent's labels                          | `Proposal.labels` at `create_proposal` | Set at submit-time (INV-P5)                                    |
| Opener Agent's labels                          | `Thread.labels` at `create_thread`  | Set at create-time (INV-TH9)                                      |
| `Proposal.labels`                              | Child `Task.labels` on scaffold     | Read from parent Proposal, NOT the approver (INV-P6, INV-T16)     |
| `Thread.labels`                                | Spawned `Task.labels` or `Proposal.labels` on convergence | Read from source Thread, NOT the converging party (INV-T17, INV-TH10) |

### 6.4 Claim Enforcement (`get_task`)

A Task's labels are a *claim gate*, not just a routing hint. `taskClaimableBy(taskLabels, claimantLabels)`:

```
taskKeys = keys(taskLabels)
if taskKeys is empty: return true               // unlabeled Task is open to anyone
if claimantLabels is undefined: return false    // unlabeled Agent cannot claim labeled work
for each (k, v) in taskLabels:
    if claimantLabels[k] !== v: return false
return true
```

`get_task` walks the pending queue and returns the first Task for which `taskClaimableBy(task.labels, claimant.labels)` holds. On a successful claim, `task.assignedEngineerId = claimant.engineerId` is persisted (INV-T15) — this enables P2P routing for subsequent events.

### 6.5 P2P Routing Pattern

Events tied to a specific Agent's work (review outcomes, clarification answers) use a two-tier dispatch:

```ts
await ctx.dispatch(event, data,
  task.assignedEngineerId
    ? { engineerId: task.assignedEngineerId }
    : { roles: [...], matchLabels: task.labels }
);
```

When `assignedEngineerId` is set, the Hub pins to that Agent. If the pin is stale (offline, session expired, agent archived), the selector matches zero Agents and delivery falls through to the webhook (INV-SYS-L05, INV-SYS-L09). Callers requiring at-least-once-to-some-Agent must omit the pin and use `matchLabels` on its own.

### 6.6 Defensive Migration

Entities persisted before v2.1.0 did not carry a `labels` field. Every read path normalizes a missing `labels` to `{}` (empty map). Consequences:
- Legacy Agents match only empty selectors and zero-label Tasks.
- Legacy Tasks are claimable by any Agent (taskKeys is empty → returns true).
- Legacy Proposals/Threads dispatch with `matchLabels: {}` — which imposes no label constraint, so behavior reverts to pre-Mission-19 role-scoped broadcast.

Migration is read-through: no backfill job runs. Newly-created entities always carry labels.

### 6.7 Reserved Keys

| Key                 | Status v2.1.0                         | Future semantics                                   |
| ------------------- | ------------------------------------- | -------------------------------------------------- |
| `ois.io/namespace`  | Stored as-is; no special behavior     | Strict tenant isolation boundary (no cross-namespace dispatch) |
| `ois.io/*` (other)  | Reserved prefix; stored as-is         | Hub-defined routing semantics in later missions    |

Caller-supplied labels under `ois.io/` are accepted but callers are warned (via this spec) that later Hub versions may reinterpret these keys.

---

## 7. Gap Analysis

### 6.1 Specification vs Implementation Gaps

| ID     | Gap                                                                                     | Severity | Status                                              |
| ------ | --------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------- |
| GAP-1  | `TASK_FSM` declared but `isValidTransition()` never called                              | Medium   | **RESOLVED** (task-107) — FSM enforced in all policies |
| GAP-2  | Proposal `under_review` phantom state                                                   | Low      | **RESOLVED** (task-107) — removed from enum          |
| GAP-3  | Thread `escalated` phantom state                                                        | Low      | **RESOLVED** (task-107) — removed from enum          |
| GAP-4  | Idea, Mission, Turn have no FSM guards                                                  | Medium   | **RESOLVED** (task-107) — FSM tables added + enforced |
| GAP-5  | `reviewProposal` has no status guard                                                    | Medium   | Open — only `submitted` proposals should be reviewable |
| GAP-6  | `create_audit_entry` hardcodes actor to "architect"                                     | Low      | **RESOLVED** (task-108) — derived from session role  |
| GAP-7  | `thread_converged` has no event loop polling backup                                     | Medium   | **RESOLVED** (task-108) — added to `pollAndProcess`  |
| GAP-8  | No RBAC enforcement                                                                     | Medium   | **RESOLVED** (task-108) — PolicyRouter enforces role tags |
| GAP-9  | Terminal state irreversibility not enforced                                              | Medium   | **RESOLVED** (task-107) — FSM guards prevent outbound transitions |
| GAP-10 | `create_report` transitions to `completed` instead of `in_review`                       | High     | Open — **Mission-6 T2/T3** will implement `in_review` state |
| GAP-11 | DAG cascade triggers on report, not review approval                                     | High     | Open — **Mission-6 T3** will move cascade to `createReview(approved)` |
| GAP-12 | `create_review` has no `decision` field                                                 | High     | Open — **Mission-6 T3** will add `approved\|rejected\|revision_needed` |
| GAP-13 | No revision loop (`in_review → working`) or `revisionCount` tracking                   | Medium   | Open — **Mission-6 T3** will implement |
| GAP-14 | No circuit breaker for infinite revision loops                                          | Medium   | Open — **Mission-6 T4** will implement `escalated` state |
| GAP-15 | Thread convergence dual-execution: Hub cascade and Architect LLM both fire for same thread | High     | **RESOLVED** (idea-57) — `hasAction` flag gates SSE path, status guard gates polling path |
| GAP-16 | No routing model beyond `role` — all `architect` or all `engineer` agents receive every broadcast | High | **RESOLVED** (Mission-19, task-195/196/197) — Kubernetes-style label selectors on every dispatch; claim enforcement on `get_task`; P2P routing via `assignedEngineerId` |
| GAP-17 | No way to pin a reply to the specific Agent instance that produced the work — stale reviews could reach any engineer in the pool | High | **RESOLVED** (Mission-19, t5) — review/clarification events pin to `task.assignedEngineerId` with label-scoped fallback |
| GAP-18 | Entities created at thread convergence or proposal scaffold ignored the parent's routing intent — child was dispatched to the approver/converger's scope | Medium | **RESOLVED** (Mission-19, t3) — authoritative label inheritance reads from parent entity record |

### 6.2 Test Coverage Gaps

Items marked `Tested By: NONE` in this registry:

| Section          | Count | Items                                                            |
| ---------------- | ----- | ---------------------------------------------------------------- |
| Entity Invariants | 14    | INV-T4, INV-P1, INV-P2, INV-P4, INV-TH6, INV-TH7, INV-TH8, INV-I2, INV-M4, INV-TN1, INV-TE1, INV-TE2, INV-A1, INV-A2, INV-D1, INV-D2 |
| System Invariants | 8     | INV-SYS-003, INV-SYS-010 through INV-SYS-017                   |
| Workflows         | 4     | WF-005a, WF-005b, WF-006, WF-008                                |
| Cross-Domain      | 2     | XD-006a, XD-006b                                                 |
| **Total gaps**    | **28** | —                                                               |

### 6.3 Recommendations

1. **Immediate (next task):** Write E2E tests for all 14 entity invariant gaps. These are pure policy tests — no LLM or transport needed.
2. **Short-term:** Implement FSM guards (GAP-1, GAP-4, GAP-5, GAP-9) to enforce the Registry's declared transitions.
3. **Medium-term:** Write integration tests for convergence dedup (INV-SYS-018) covering both WF-005a and WF-005b paths.
4. **Deferred:** Agent behavior invariants (INV-SYS-011 through INV-SYS-017) require LLM integration testing — scope for a separate mission.
