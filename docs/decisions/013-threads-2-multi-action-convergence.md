# ADR-013: Threads 2.0 — Multi-Action Convergence, Summary, Participants

**Date:** 2026-04-18
**Status:** Accepted (Phase 1 shipped)
**Threads:** thread-112 (original design, 2026-04-17, 5 rounds), thread-117 (refinement review, 2026-04-18, 4 rounds)
**Proposal:** prop-30 (approved 2026-04-17)
**Supersedes:** the singular `Thread.convergenceAction` shape from Mission-11 (hub mission-13) — retired in clean cutover.
**Complements:** ADR-005 (persist-first notifications), ADR-011 (`TransitionRejected` sentinel, CAS primitives), ADR-012 (Architect error-surfacing and context-economy).
**Mission:** Mission-21 (hub `mission-22`, external "Mission-21").

---

## Decision

Every thread convergence now requires **two explicit artifacts** attached to the converging party's reply (or accumulated across rounds by either party):

1. **At least one committed `convergenceAction`** — a machine-readable instruction from the thread's closed vocabulary (Phase 1: `close_no_action` only; Phase 2: full vocabulary).
2. **A non-empty `summary`** — a negotiated narrative of what the actors agreed, authored in prose.

The Hub's policy layer **rejects `converged: true` via `ThreadConvergenceGateError`** when either is absent, with a domain-specific message explaining what to add. The forcing function eliminates the "prose-promise" bug class where an Agent signalled convergence in text without a machine-readable artifact, and promised tool calls silently evaporated.

Thread participants are tracked openly as `{role, agentId, joinedAt, lastActiveAt}` entries — every reply upserts the caller's `{role, agentId}` if new, updates `lastActiveAt` otherwise. No pinning in Phase 1: any role-matching Agent can reply to any thread under its label selector. `ParticipantRole` enum reserves `"director"` for idea-84 activation even though Phase 1 populates only `"engineer"` and `"architect"`.

`ConvergenceReport` exists as Hub-internal per-action execution telemetry (array of `{actionId, status, entityId?, error?}`) — **distinct from `Thread.summary`**. The summary is the actors' narrative; the report is the Hub's mechanical trace. The `thread_convergence_completed` SSE event carries the report on cascade completion.

---

## Context

### The prose-promise bug class

Pre-2.0, `Thread.convergenceAction` was a **single optional field** of shape `{type: "create_task" | "create_proposal", templateData: {title, description}}`. `converged: true` was permitted with `convergenceAction: null` — the thread transitioned to `status: "converged"` silently, and the Architect's autonomous `thread_converged` handler (Path B) was supposed to decide what happened next by reading the prose.

That handler was brittle. Four observed reproductions within 27 hours:

- **thread-111** (2026-04-17, storage brainstorm) — Architect converged with `intent: "implementation_ready"`, no action, prose promise (*"next step for you in the appropriate mission will be…"*). Promised follow-up never appeared.
- **thread-112-r3** (2026-04-17, the *design thread for this very fix*) — Architect converged with no action mid-design. Meta-reproduction.
- **thread-117-r3 and thread-117-r5** (2026-04-18, entity-registry coordination) — Architect promised a four-tool sequence in prose across two converging replies; zero tools ran. Director drove the four calls via `architect-chat.sh` instead.

Adjacent case **thread-113** (2026-04-18) converged with a `create_task` action attached (spawned task-233 correctly) but the Architect's prose also promised five `update_idea(status="dismissed")` calls. Those weren't in the singular convergenceAction shape. 24 hours later those five ideas were still `open`. Driven through chat.sh in the same session that logged this ADR.

The root cause is **Agent's-Word ≠ Hub's-Deed**: the conversation record was a narrative layer; the state record was a separate machine layer; the two could diverge without the system noticing.

### Why the gate lives in policy, not schema

The gate is implemented as a `ThreadConvergenceGateError` thrown from inside the `replyToThread` CAS transform — atomic with the other state transitions, rolled back on failure, domain-specific message surfaced verbatim to the caller. Placing it at the Zod schema layer was considered and rejected: a generic "Invalid Input" carries no Tele-aware guidance. A policy-layer throw can say *"Thread convergence rejected: summary is empty (narrate the agreed outcome)."* That specificity is feedback the Architect's LLM can act on to self-correct.

### Why `summary` is a first-class field, not just a message

Before this ADR the brainstorm converged on a `ConvergenceReport`-as-first-class-narrative design. The Director reframed: *"Is this effectively an agreed summary of the thread between actors?"* That reframe surfaced a clean separation:

- **`summary`**: negotiated narrative, authored by the actors, captured on the Thread entity. Durable, surfaces in `get_thread`, readable by any future observer as "what did this thread produce". Revisable across rounds; the converging party commits the latest version.
- **`ConvergenceReport`**: Hub-internal telemetry — what the cascade tried to do and whether each action succeeded. Emitted with `thread_convergence_completed`. Not a narrative; a trace.

Both are required for Threads 2.0 semantics: the summary captures intent, the report captures execution.

### Why participants track openly, not with pinning

Engineer-to-Engineer collaboration is in scope per the Director's 2026-04-18 direction. Label-matching ensures M19 isolation at the role level, but a thread may legitimately receive replies from multiple Engineers under matching labels (e.g., handoff when one disconnects). Open tracking records every distinct `{role, agentId}` that has contributed; pinning is a Phase-2-or-later decision once real multi-Agent patterns are observed.

### Why clean cutover, not back-compat

The Director explicitly rejected carrying legacy code. `Thread.convergenceAction` is deleted, not hidden; `setConvergenceAction` is deleted, not deprecated; the old singular cascade path is deleted, not forked. All pre-cutover threads in non-terminal states (`active`, `round_limit`) were admin-closed via `gsutil` before the Hub redeploy that introduced this ADR, ensuring no live thread ever encountered the schema transition.

---

## Schema changes

**Removed:**
- `Thread.convergenceAction: ConvergenceAction | null`
- `ConvergenceAction` and `ConvergenceActionType` types
- `IThreadStore.setConvergenceAction(threadId, action)` and both store implementations
- The `thread_converged_with_action` internal event's singular-action payload (replaced with `actions: StagedAction[]`)

**Added:**
- `Thread.convergenceActions: StagedAction[]` — array, primary
- `Thread.summary: string` — negotiated narrative, empty until first set
- `Thread.participants: ThreadParticipant[]`
- `ThreadMessage.authorAgentId: string | null` — Agent.engineerId attribution per message
- `StagedAction { id, type, status, proposer, timestamp, payload, revisionOf? }` with lifecycle `staged | revised | retracted | committed | executed | failed`
- `StagedActionOp` discriminated union: `{kind: "stage", type, payload} | {kind: "revise", id, payload} | {kind: "retract", id}`
- `ParticipantRole = "engineer" | "architect" | "director"` (director reserved for idea-84)
- `ReplyToThreadOptions` — options bag consolidating `converged / intent / semanticIntent / stagedActions / summary / authorAgentId`
- `ThreadConvergenceGateError` — domain-specific exception for policy-layer gate rejection
- `applyStagedActionOps(thread, ops, proposer, now)` — shared helper used by both store implementations
- `upsertParticipant(participants, role, agentId, now)` — shared helper

**Tool surface:**
- `create_thread_reply` schema gains optional `stagedActions: StagedActionOp[]` (discriminated union with full Zod validation) and optional `summary: string`
- Reply response echoes current post-op `convergenceActions[]`, `participants[]`, and `summary` (Architect review addition #2 from thread-117)

---

## Phase 1 scope — what shipped

- **Vocabulary:** `StagedActionType = "close_no_action"` only, payload `{reason: string}`. Phase 2 widens to `create_task`, `create_proposal`, `create_idea`, `create_mission`, `update_mission`, `update_idea`.
- **Cascade:** committed actions iterated in array order. `close_no_action` writes an audit entry with the reason and closes the thread. Other types unreachable under Phase 1 (guarded with a `failed` report entry for Phase 2 safety).
- **Gate enforcement:** both conditions (≥1 committed action AND non-empty summary) required or `ThreadConvergenceGateError` on converge.
- **Atomicity:** mutations applied to a thread clone in `MemoryThreadStore.replyToThread`, committed only on success. `GcsThreadStore` inherits atomicity from the CAS transform contract (ADR-011).
- **Symmetric staging:** either party can `stage / revise / retract` in any reply; the converging party commits.
- **Participant tracking:** open upsert on every reply; no pinning.
- **Tests:** 10 new tests in `wave3b-policies.test.ts` covering gate, staging lifecycle, participants, atomicity. Full suite 290/290 passing; 10 pre-existing tests skipped pending Phase 2 rewrite.

---

## Phase 2 (deferred)

- **Action vocabulary expansion** — `create_task`, `create_proposal`, `create_idea`, `create_mission`, `update_mission`, `update_idea`. Each gets its own payload shape and cascade handler.
- **Best-effort cascade semantics** — continue executing actions after partial failure; record per-action success in the report. Architect review addition #1: `warning` flag on the `thread_convergence_completed` event when any action fails.
- **Idempotency keys** per cascade action (Architect review addition #3) — `{threadId}:{actionId}` scoped keys to make retries safe under transient failures.
- **Action-ID ↔ entity-ID back-linking** (Architect review addition #4) — audit entries for each executed action cite the generated entity's ID, giving durable lineage from thread decision → entity creation.
- **Test rewrites** — `e2e-convergence-spawn.test.ts`, `mission-19/labels.test.ts` thread-spawn block, `e2e-remediation.test.ts` convergence-backup block are currently `describe.skip` pending Phase 2.

## Phase 3 (deferred)

- **Path B removal** — the autonomous-LLM convergence handler in `agents/vertex-cloudrun/src/notifications.ts` remains as a fallback until Phase 1+2 prove the Path A vocabulary covers every legitimate outcome. Phase 3 deletes Path B; `thread_converged` becomes informational only.
- **Observability** — metric `thread.convergence.no_action_count` (invariant: stays at 0 post-Phase-3); metric `thread.convergence.action_failure_rate`; per-action audit entries.

---

## Consequences

### Positive

- **Architect's Word ≡ Hub's Deed.** Every converged thread produces durable, machine-auditable artefacts. The bug class that produced four observed reproductions in 27 hours is structurally eliminated.
- **Actionable error messages.** `ThreadConvergenceGateError` tells the caller *why* the convergence was rejected with specificity a Gemini prompt can self-correct on.
- **Participant observability.** Multi-Agent threads become first-class; Engineer-to-Engineer collaboration is traceable; future Director participation maps cleanly to the existing `ParticipantRole` enum.
- **Clean cutover.** No legacy code to reason about. Schema evolution is a single diff, not a forked implementation.

### Negative

- **Breaking change.** Threads opened before Phase 1 were admin-closed pre-cutover. The `architect-chat.sh` prompt vocabulary shifts for converging replies — the Architect's `buildAutonomousContext` should be updated to reference the new shape.
- **Gate verbosity.** Every legitimate thread closure now requires a `close_no_action` stage + a summary, even when the outcome is genuinely "we talked, no further work". Intentional friction: forces explicit closure rather than implicit drift.
- **Cascade coupling at Phase 1.** The cascade handler closes the thread as part of the convergence transaction. Tests that expected "converged threads surface in get_pending_actions" no longer apply — the thread is closed by the time the poll runs. Acceptable because `thread_convergence_completed` is the primary surfacing mechanism; `get_pending_actions` was a backup for the singular-action world that no longer has the failure mode it was guarding against.

### Neutral

- **Phase 2 workload is well-scoped.** Each deferred item has concrete acceptance criteria from thread-117 and prop-30.
- **`director` role is reserved but unpopulated.** Deployment works identically; only the enum widens. Idea-84 activates it without a further schema change.
- **The distinction between `summary` (narrative) and `ConvergenceReport` (telemetry) will need restating in entity-registry docs and in the collaboration doc.** Phase 1 and Phase 2 should keep the two concepts clearly separate.

---

## Implementation

- Schema: `hub/src/state.ts` — types + helpers + error class
- MemoryThreadStore: `hub/src/state.ts` — transactional `replyToThread` using `cloneThread` and commit-on-success
- GcsThreadStore: `hub/src/gcs-state.ts` — CAS transform gates + message-per-file writes unchanged from M20
- Policy: `hub/src/policy/thread-policy.ts` — schema + handlers for reply / cascade
- Tests: `hub/test/wave3b-policies.test.ts` — 10 new Phase 1 tests
- Phase-2-skipped tests: `e2e-convergence-spawn.test.ts`, `mission-19/labels.test.ts` (thread-spawn block), `e2e-remediation.test.ts` (converged-threads polling block). Comments cite this ADR for the rewrite contract.
- Pre-deploy admin closures: handled manually via `gsutil` on `active` + `round_limit` threads before the Hub cutover.
- Related ADRs: ADR-011 (CAS primitives, `TransitionRejected` sentinel pattern reused here), ADR-012 (chat error surfacing mirrors the domain-specific-error-message approach this ADR uses for gate rejection).
