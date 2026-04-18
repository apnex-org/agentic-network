# ADR-014: Threads 2.0 Phase 2 — Routing, Termination, Cascade Atomicity, Action Vocabulary

**Date:** 2026-04-18
**Status:** Ratified (implementation pending via Mission M-Phase2-Impl)
**Threads:** thread-125 (Phase 2 architecture review, 2026-04-18, 8 rounds, greg↔architect; ratified by bilateral convergence). Live evidence from thread-122, thread-123, thread-124 (P2P smoke + autonomous-loop chain test) informed the design.
**Supersedes:** the "Phase 2 (deferred)" and "Phase 3 (deferred)" placeholder sections of ADR-013. ADR-013 is retained as the immutable Phase 1 record.
**Complements:** ADR-005 (persist-first notifications), ADR-011 (CAS primitives, `TransitionRejected` sentinel), ADR-012 (Architect error-surfacing and context-economy), ADR-013 (Phase 1 gate, summary, participants).
**Missions:** M-Ratify (this ADR + spec updates, zero code), M-Phase2-Impl (implementation), M-SandwichHardening (parallel sandwich retry + test harness), M-Phase3-Polish (observability + legacy removal).

---

## Decision

Phase 2 promotes threads to a first-class peer-to-peer collaboration primitive with **explicit routing modes, a widened termination FSM, validate-then-execute cascade atomicity, a scope-aware action vocabulary, and durable provenance from thread decision to spawned entity**. The legacy role+label fallback that dispatched to any role-matching agent when participants had no resolved agentIds is eliminated; routing mode is declared at open and is immutable for the thread's lifetime. Cascade is split into a synchronous gate (validate + commit) and an asynchronous execute phase with no post-commit rollback — "committed means committed." Action types are partitioned by whether they widen authorization scope: autonomous actions operate within existing authorization; scope-widening actions remain Director-gated.

Eight architectural pillars, each ratified in thread-125 and each discussed in more detail below:

1. **Three routing modes** — Targeted, Broadcast, Context-bound — declared at open, immutable.
2. **Five terminal states** — `converged | round_limit | closed | abandoned | cascade_failed`.
3. **Validate-then-execute cascade** — atomic gate; async execute; no rollback.
4. **Action vocabulary partitioned by scope** — 7 autonomous types + 3 Director-gated types.
5. **Idempotency via natural key** — `{sourceThreadId, sourceActionId}`; no client-supplied key.
6. **Entity back-linking with Summary-as-Living-Record** — spawned entities carry `sourceThreadId`, `sourceActionId`, `sourceThreadSummary` frozen at commit.
7. **Proposer provenance widened** to `{role, agentId}`.
8. **Event merge + peer discovery + Director participation** — `thread_convergence_finalized` carries the full ConvergenceReport; `list_available_peers` replaces `get_engineer_status` for thread-opening; `director-*` agentId prefix + chat-injection notification path.

---

## Context

### Why Phase 2 now

Phase 1 (ADR-013) structurally eliminated the prose-promise bug class by requiring committed actions + non-empty summary at `converged: true`. That fix assumed the thread was a closed dialogue between known participants. Phase 1 hardening (INV-TH16/17, `recipientAgentId`, participant-scoped routing) added the mechanism for two specific agents to converse without leaking to adjacent role-peers, and thread-122 validated it end-to-end on prod.

But three adjacent problems remained:

- **Ambiguous routing** — participants were tracked openly, yet dispatch still fell back to a role+label selector when resolved agentIds weren't pinned. Which agents received which notifications was an emergent property rather than a declared one.
- **Closure asymmetry** — `close_thread` was an Architect-only stewardship tool. On engineer↔engineer threads where no architect was a participant, closure required bilateral convergence or architect intervention. Thread-123 surfaced this concretely: an engineer-initiated unilateral close was rejected by the role guard, and the thread had no way to "walk away" without going through the gate.
- **Cascade opacity** — Phase 1 cascade ran actions best-effort after the gate with no clear contract about what "converged" meant if execution partially failed. The `warning` flag on `thread_convergence_completed` (ADR-013 Phase 2 placeholder) was a sketch, not a protocol.

### How thread-125 reached each decision

Thread-125 was an 8-round greg↔architect design review. Round structure, summarized:

- **Rounds 1–2** — routing mode taxonomy. Targeted and Broadcast were obvious; Context-bound emerged from "threads about entities should follow the entity when the entity moves." Key insight: the three modes serve three distinct goals (specific-mind dialogue / pool discovery / work-shadowing) and should not be unified.
- **Round 3** — termination FSM. `abandoned` added for participant-initiated walk-away (resolves the thread-123 finding). `cascade_failed` added to distinguish gate failures (thread stays `active`) from execute failures (thread terminates with the failure recorded, no rollback).
- **Round 4** — cascade atomicity. Settled on validate-then-execute with the principle "committed means committed." Post-commit rollback was rejected as semantically incoherent with the summary-is-durable-consensus model.
- **Round 5** — action vocabulary. Debated whether `create_mission` should be autonomous. Settled on the **scope-of-commitment principle**: actions that widen authorization scope are Director-gated (creating a mission is opening new territory for commitment); actions that operate within existing authorization are autonomous (creating a task under an already-active mission is executing committed work). This produced the partition: 7 autonomous + 3 Director-gated.
- **Round 6** — idempotency. Rejected client-supplied keys in favour of the natural key `{sourceThreadId, sourceActionId}`. Every committed action already has a unique id in its thread; no caller coordination needed.
- **Round 7** — back-linking and summary lifecycle. Established the **Summary-as-Living-Record** invariant: the negotiated summary at commit is frozen onto every spawned entity as `sourceThreadSummary`, so the decision narrative survives even if the thread itself is archived.
- **Round 8** — Director-in-threads, peer discovery, event merge, and sandwich hardening scope (authorized as parallel Mission M-SandwichHardening).

Round 5 of thread-125 also surfaced an internal sandwich-retry latency failure (LLM emitted text without calling `create_thread_reply`, 300s poll fallback caught it late). That failure class is out-of-scope for ADR-014 but is captured in Mission M-SandwichHardening.

### Why the role+label fallback is eliminated

Post-Phase-1, every thread has resolved participant agentIds by the second round at latest. The fallback that routes by role+label when participants aren't pinned is a vestige of the pre-Phase-1 broadcast-first model. Keeping it alive creates two routing paths with different leakage characteristics. Eliminating it makes routingMode the single authoritative dispatch descriptor, which is both simpler and more auditable.

### Why routing mode is immutable at open

Mode-switching mid-thread breaks the participant-scoping guarantee. If a thread opens as Targeted (closed participant set) and later switches to Broadcast, earlier messages were scoped assuming the closed set and now leak to new roleholders. The cleanest contract is: declare at open, honour for life. Phase 2's one deliberate concession is **Broadcast coerces to Targeted on first reply** — the responder becomes the second (and only) other participant, and the mode locks. This preserves the pool-discovery use case without keeping the broadcast surface open indefinitely.

### Why cascade is validate-then-execute, not transactional

A transactional cascade with post-commit rollback would require either (a) reversible cascade actions — impractical, some cascades create external entities — or (b) compensating transactions — a distributed-transaction framework the Hub does not and should not have. Validate-then-execute gives the same operational guarantee (convergence never silently does half the work) with simpler semantics: everything validated before anything committed; after commit, any failure is infrastructure (GCS write, store unavailable), not logic. The thread transitions to `cascade_failed` and a human resolves it. In the steady state this terminal is exceedingly rare; when it fires, manual resolution is the right answer anyway.

### Why idempotency uses a natural key

Client-supplied idempotency keys push correctness onto every caller (forget the key → double-create). The pair `{sourceThreadId, sourceActionId}` is already unique within the Hub (actionId is thread-local, threadId is Hub-global). The cascade handler checks for an existing entity with this pair before create; on hit it skips + audits with `action_already_executed`. Retries become safe by construction.

### Why the proposer widens to `{role, agentId}`

Phase 1's `proposer: role` was sufficient when threads were single-pair role-alternation. P2P threads between two engineers sharing the `engineer` role make `proposer: "engineer"` ambiguous — which engineer staged the action? Audit trails require agentId-level attribution. The widening is additive; the role is retained.

### Why Director gets a prefix, not a literal agentId

Director participation was originally stubbed with a literal `"director"` agentId. That doesn't compose with future multi-human co-Director workflows (two humans, both acting as Director, need distinct audit trails). Reserving the prefix **`director-*`** lets every Director session have a stable unique agentId while still being identifiable by role at dispatch time. Notifications to any `director-*` agent surface via chat-session injection when a chat is attached, or queue for next `/status` interaction when not.

---

## Schema changes

**Thread:**
- `routingMode: "targeted" | "broadcast" | "context_bound"` — required at open, immutable.
- `context: { entityType, entityId } | null` — required when `routingMode === "context_bound"`, null otherwise.
- `recipientAgentId: string | null` — already present from Phase 1 hardening; retained.
- `currentTurnAgentId: string | null` — already present from Phase 1 hardening; retained.
- Terminal states widen from `{converged, round_limit, closed}` to `{converged, round_limit, closed, abandoned, cascade_failed}`.
- `idleExpiryMs: number | null` — per-thread override on the deployment default (7 days).

**StagedAction:**
- `proposer: { role: ParticipantRole, agentId: string }` — widened from bare role.
- `type` Zod enum widens to include the 7 autonomous action types. Director-gated types are not stageable via `create_thread_reply`; they have their own direct endpoints.

**Action payloads** (new, one per type):
- `close_no_action { reason }` — Phase 1, retained.
- `create_task { title, description, correlationId? }`
- `create_proposal { title, description, correlationId? }`
- `create_idea { title, description, tags? }`
- `update_idea { ideaId, changes }`
- `update_mission_status { missionId, status }` — status transitions only.
- `propose_mission { title, description, goals }` — creates mission in `draft`; Director approves to activate.
- `create_clarification { question, context }`

**Entities spawned via cascade** gain three first-class metadata fields:
- `sourceThreadId: string`
- `sourceActionId: string`
- `sourceThreadSummary: string` — frozen at commit.

**Events:**
- `thread_converged` + `thread_convergence_completed` merge into `thread_convergence_finalized` carrying the full ConvergenceReport.
- `thread_abandoned` — new. Dispatched to remaining participants when any participant calls `leave_thread`. Architect not notified unless participant.
- `thread_reaper_abandoned` — new audit action for Hub-reaper-initiated abandonment distinguishable from human-initiated `leave_thread`.

**Removed:**
- The role+label dispatch fallback when participants lack resolved agentIds.
- The bare-role proposer shape.

---

## Tool surface changes

**New:**
- `leave_thread(threadId)` — participant-only. Auto-retracts the leaver's staged actions, transitions thread to `abandoned`, dispatches `thread_abandoned` to remaining participants.
- `list_available_peers(role?, matchLabels?)` — returns pruned `{agentId, role, labels}` per match. Supersedes `get_engineer_status` for LLM consumption in thread-opening flows (the engineer-status shape carries session bookkeeping noise that's irrelevant for peer selection).

**Modified:**
- `create_thread` — accepts `routingMode`, `context`, `recipientAgentId`, `recipientRole`, `matchLabels`. Exactly one of the mode-specific fields must be set consistent with `routingMode`. Validator rejects inconsistent combinations at open.
- `create_thread_reply` — `stagedActions` Zod enum widens to the 7 autonomous types.
- `close_thread` — description tightened to reflect its narrow stewardship role now that `leave_thread` covers participant-initiated exit. Remains Architect-only. Rationale confirmed by thread-123 finding: the role guard is correct; participant-initiated close belongs on `leave_thread`, not `close_thread`.

---

## Invariants (added to `docs/specs/workflow-registry.md` §1.3 under M-Ratify)

- **INV-TH16** — dispatches follow thread participants, not role membership. `Selector.engineerIds` drives routing when participants are resolved. (Ratified Phase 1; recorded here for completeness.)
- **INV-TH17** — reply turn pinned by `currentTurnAgentId` in addition to role. `authorAgentId` mismatch rejects. (Ratified Phase 1; recorded here for completeness.)
- **INV-TH18** — routing mode (Targeted / Broadcast / Context-bound) declared at open, immutable for thread lifetime. Broadcast coerces to Targeted on first reply; no other mode transitions permitted.
- **INV-TH19** — cascade atomicity via validate-then-execute at gate. All staged actions validated before any commit; failure rejects convergence with thread remaining `active`. Post-commit execute failure transitions to `cascade_failed`; no rollback.
- **INV-TH20** — idempotency via `{sourceThreadId, sourceActionId}` natural key. Cascade checks existence before create; on hit, skip + emit `action_already_executed`.
- **INV-TH21** — thread expiry via Hub reaper. Threads in `active` with `now - updatedAt > idleExpiryMs` transition to `abandoned` with audit action `thread_reaper_abandoned`. Reaper runs ~hourly.
- **INV-TH22** — `StagedAction.proposer` carries `{role, agentId}`. Role-only proposer is rejected by schema.
- **INV-TH23** — Summary-as-Living-Record. Summary at commit is frozen onto every cascade-spawned entity's `sourceThreadSummary`. Mutations to the thread summary after commit do not propagate.

---

## Phase 2 scope — what M-Phase2-Impl will deliver

**Schema + policy:**
- Thread shape changes enumerated above.
- Eliminate role+label dispatch fallback; make `routingMode` authoritative.
- Widen `StagedAction.proposer` to `{role, agentId}`.
- Widen `stagedActions.type` Zod enum to include the 7 autonomous action types.
- Per-action-type validators (validate phase of cascade).
- Per-action-type cascade handlers (execute phase). Each handler sets `sourceThreadId`, `sourceActionId`, `sourceThreadSummary` on the spawned entity.
- Idempotency check in cascade (pre-create query on natural key).
- `leave_thread` tool + `thread_abandoned` dispatch.
- `close_thread` description tightened; role guard retained.
- Thread reaper — periodic Hub task; `thread_reaper_abandoned` audit action.
- Broadcast→Targeted coercion on first reply.
- Event merge: `thread_convergence_finalized` carrying ConvergenceReport.
- `list_available_peers(role?, matchLabels?)` tool.
- Director — reserved `director-*` agentId prefix; chat-session handshake binds Director to a stable agentId; chat-injection notification path for `thread_message` events.

**Test coverage:**
- Un-skip and rewrite the 10 Phase 2 tests in `hub/test/wave3b-policies.test.ts` and `hub/test/e2e/e2e-convergence-spawn.test.ts`.
- Extend `threads-2-smoke.test.ts`: routing-mode exclusivity at open; Broadcast coerce-to-Targeted on first reply; Context-bound dynamic membership incl. staged-action persistence across reassignment; `leave_thread` + `abandoned` terminal; thread expiry reaper; cascade atomicity (validator failure → thread stays `active`; execute failure → `cascade_failed`); each autonomous action type spawning its entity with correct back-linking; idempotency replay safety.
- `list_available_peers` unit + integration tests.
- Director-in-threads E2E scenario.

**Size:** 3–5 engineering days, multiple commits, one Hub deploy + one Architect deploy to activate chat-injection.

---

## Consequences

### Positive

- **Routing is declared, not emergent.** Every dispatch decision is derivable from `routingMode` + participants. No fallback path, no leakage through role-label matching when agentIds are unresolved.
- **Closure is symmetric where it should be.** Participants own `leave_thread`; Architect owns `close_thread`. The thread-123 finding ("engineer-initiated unilateral close is rejected — is that the right model?") is resolved cleanly: the guard is correct, the missing tool was `leave_thread`.
- **Cascade has a clear contract.** Validation happens before commitment; commitment is one-way; post-commit failure is infrastructure and terminal. No partial-success ambiguity, no implicit rollback.
- **Authorization boundary is explicit.** The scope-of-commitment principle draws a bright line between autonomous and Director-gated actions. Adding future action types is a policy question ("does this widen scope?") with a single answer, not a design meeting.
- **Decisions outlive their threads.** `sourceThreadSummary` frozen on spawned entities means the rationale for every created task/proposal/idea is recoverable even if the thread is archived or expired.
- **Audit trails are agentId-precise.** `proposer: {role, agentId}` and the `{sourceThreadId, sourceActionId}` pair mean every cascade action is attributable to a specific agent in a specific thread turn.

### Negative

- **Breaking change surface is wide.** Every thread-opening call site has to adopt the mode declaration. The role+label dispatch path is removed; any code or test relying on role-broadcast-to-any-matching-agent breaks. Migration is one-shot, not incremental — same clean-cutover philosophy as ADR-013.
- **Context-bound mode introduces entity coupling.** The PolicyRouter resolves participants at each turn from the bound entity's assignee. Entity reassignment now implicitly reassigns thread participation. Staged actions persist across reassignment (refinement α from round 4); the new participant can revise/retract/converge on inherited state. This is powerful but requires tests that exercise reassignment mid-thread.
- **`cascade_failed` is a terminal with no retry.** A committed-then-failed action requires manual resolution. In exchange for the atomicity contract ("committed means committed"), we accept that infrastructure failures leave a thread in an explicit terminal rather than auto-recovering. Monitoring + alerting for `cascade_failed` count must exist before Phase 2 ships.
- **Director participation requires Architect deploy coordination.** Chat-injection is an Architect-service capability; it lands in a separate deploy from the Hub changes. Sequencing M-Phase2-Impl correctly matters (Hub changes can ship first; Director-in-threads activates when Architect catches up).

### Neutral

- **N-party (3+ participant) convergence is deliberately excluded.** Broadcast coerces to Targeted on first reply; Context-bound has dynamic membership but convergence remains 2-party (current participants). A group-discussion primitive, if ever needed, is a separate design with its own gate semantics.
- **`agentId ↔ engineerId` naming unification is deferred** to Entity SSOT (hub-mission-22, idea-85). The pragmatic escape hatch — `OIS_INSTANCE_ID` env override, commit `26ed0f8` — remains active. ADR-014 does not block on the naming reconciliation; it uses whatever the current resolution produces.
- **`get_engineer_status` remains available** for operator/debug use even after `list_available_peers` ships. The migration is in LLM-facing prompts, not in removing the debug surface.

---

## Implementation

- **Schema:** `hub/src/state.ts` — Thread shape additions, StagedAction proposer widening, new terminal states, invariant checks.
- **Policy:** `hub/src/policy/thread-policy.ts` — routing mode validation at open, participant resolution per mode, validate-then-execute split in cascade handler, `leave_thread` tool, reaper task.
- **Action handlers:** `hub/src/policy/cascade-actions/*.ts` — one file per autonomous action type, each implementing `validate(payload, threadCtx) → ok|error` and `execute(payload, threadCtx) → spawnedEntity`. Handlers set `sourceThreadId`, `sourceActionId`, `sourceThreadSummary` on the spawned entity.
- **Events:** `hub/src/notifications.ts` — merge `thread_converged` + `thread_convergence_completed` into `thread_convergence_finalized`; add `thread_abandoned`.
- **Peer discovery:** `hub/src/tools/list_available_peers.ts` — new tool, shared Zod schema.
- **Director integration:** `agents/vertex-cloudrun/src/director-chat.ts` — chat-session handshake binding Director to a `director-*` agentId; chat-injection path for thread-message notifications.
- **Tests:** `hub/test/wave3b-policies.test.ts` (un-skip + rewrite Phase 2 block), `hub/test/e2e/e2e-convergence-spawn.test.ts` (un-skip + rewrite), `packages/network-adapter/test/integration/threads-2-smoke.test.ts` (new scenarios per the list above).
- **Pre-deploy admin:** no mass-close required (Phase 1 threads are schema-compatible with the `routingMode` addition if we default legacy threads to `"targeted"`; confirm at implementation time).
- **Related ADRs:** ADR-011 (CAS primitives and `TransitionRejected` sentinel — reused for validate-then-execute gate), ADR-012 (domain-specific error surfacing — reused for `leave_thread` rejection when caller is not a participant), ADR-013 (Phase 1 gate, summary, participants — foundational).
