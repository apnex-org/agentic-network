# Threads 2.0 — Design Document

**Status:** Functionally complete (Phase 1 + Phase 2 + Cascade-Perfection + IP-routing rename all shipped)
**Last updated:** 2026-04-19
**Scope:** The complete Threads 2.0 subsystem — lifecycle, routing, convergence, cascade, dispatch, participants, audit.
**Audience:** Architects, engineers, and Director-tier readers who need a cohesive mental model of how threads work today without reading four ADRs in sequence.

---

## §0 — Reading guide

This document is the **living specification** for the Threads 2.0 subsystem. Four ADRs drove us here; they remain authoritative for their individual decisions but are frozen-in-time and scattered. This doc consolidates them into a single narrative.

- **ADR-013** (Phase 1) — Forcing-function gate: summary + ≥1 convergence action required at convergence.
- **ADR-014** (Phase 2) — Cascade architecture: routing modes, validate-then-execute, action vocabulary, back-linking.
- **ADR-015** (Cascade-Perfection) — ActionSpec registry refactor + Bug as first-class entity.
- **ADR-016** (IP routing) — Rename to unicast/broadcast/multicast + hard removal of role+label dispatch fallback.

When this document disagrees with an ADR, **this document wins** (it reflects current state). Cite this doc in new work; cite the ADRs for historical "why".

Related docs:
- `docs/specs/workflow-registry.md` §1.3 — full invariant registry (INV-TH*)
- `docs/specs/entities.md` — Thread entity schema canonicalized alongside siblings
- `docs/architecture/policy-network-v1.md` — surrounding policy-layer context

---

## §1 — What is a thread?

A **thread** is a bounded, turn-based conversation between two or more Agents in the Hub that exists to reach a **decision** and produce **actions** out the other side. Unlike a chat log, a thread is a policy-enforced workflow with:

1. A declared **routing mode** that fixes who sees messages (§3).
2. A **turn protocol** preventing cross-talk (§4).
3. A **convergence gate** that forces the thread to produce structured output before it can close (§5).
4. A **cascade pipeline** that atomically spawns downstream entities (tasks, proposals, ideas, bugs, clarifications) from the convergence outcome (§6).
5. **Back-links** from every spawned entity to the originating thread + summary, so provenance survives (§9).

Threads are the Hub's answer to: *"Two agents disagree; how do we let them hash it out without losing the decision?"* The answer is a forcing function — they can talk freely inside the thread, but cannot **close** it until they've committed to concrete follow-up actions plus a narrative summary.

### Anti-patterns

- **Chat-log threads** (pre-Phase-1): a thread could "converge" with nothing attached — just two agents saying "agreed". Phase 1 closed this by requiring at least one convergence action.
- **Ambient role broadcast** (pre-ADR-016): opening a unicast thread without a pinned recipient silently fanned the opener to every agent matching the counterparty's role+labels. This leaked in the kate↔greg two-engineer session. Phase 2 + ADR-016 closed this by making `unicast` require `recipientAgentId` at the validator.

---

## §2 — Thread entity

### 2.1 — Status FSM

```
          ┌───────────────┐
          │    active     │  ──── reaper (idleExpiryMs, default 7d) ──▶  abandoned
          └───────┬───────┘
                  │ converged=true + validator passes
                  ▼
          ┌───────────────┐
          │   converged   │  ←── terminal (happy path)
          └───────────────┘
                  │
                  │ cascade post-commit execution fails
                  ▼
          ┌───────────────┐
          │ cascade_failed│  ←── terminal (manual recovery; idea-96)
          └───────────────┘

     other terminal transitions from active:
          active  ──  Architect close_thread  ──▶  closed
          active  ──  round limit reached     ──▶  round_limit
```

**Terminal states:** `converged`, `closed`, `abandoned`, `round_limit`, `cascade_failed`. No transitions out of terminal states.

### 2.2 — Participant model

A participant is a `{role, agentId, joinedAt, lastActiveAt}` tuple. Participants accumulate as agents reply; there is no explicit "join" step (INV-TH14). Participants track both coordinates:

- **`role`** — `"engineer" | "architect" | "director"`. Determines turn alternation eligibility and dispatch semantics.
- **`agentId`** — the M18 globalInstanceId-fingerprinted Agent identity (`eng-*`, `director-*`, etc.). This is the unambiguous "who". Post-M18, every thread dispatches by agentId, not by role (INV-TH27).

**Roles in a thread:**
- **Opener** — creates the thread; labels come from opener's Agent record (INV-TH9).
- **Recipient** (unicast only) — the pinned counterparty agent (`recipientAgentId`).
- **Converger** — any participant who submits `converged: true`; Architect and Engineer peers both must converge (INV-TH3).
- **Steward** — Architect; uniquely permitted to call `close_thread` on non-own threads (INV-TH7).

### 2.3 — Message model

```ts
ThreadMessage = {
  author: ParticipantRole,         // "engineer" | "architect" | "director"
  authorAgentId: string,           // M18 agentId; null only for pre-M18 legacy
  text: string,
  timestamp: string,
  converged: boolean,              // does this reply signal convergence?
  intent?: ThreadIntent,           // coarse: decision_needed, agreement_pending, ...
  semanticIntent?: SemanticIntent, // fine: seek_rigorous_critique, collaborative_brainstorm, ...
}
```

Messages are append-only. `converged=true` on a reply is a **claim** that the thread should converge — it is validated against the forcing-function gate (§5) before the thread status flips.

---

## §3 — Routing modes

Threads declare exactly one routing mode at open-time. The mode is **immutable** (INV-TH18) and determines dispatch semantics throughout the thread's life.

### 3.1 — The three modes

| Mode | `recipientAgentId` | `context` | Opener dispatch | Semantics |
|------|-------------------|-----------|-----------------|-----------|
| **unicast** | **required** | must be null | `{engineerIds: [recipientAgentId], matchLabels}` | One-to-one. Pinned counterparty. Default. |
| **broadcast** | must be null | must be null | `{roles: [counterparty-role], matchLabels}` | One-to-pool at open; coerces to unicast on first reply. |
| **multicast** | must be null | required `{entityType, entityId}` | no open-time dispatch | One-to-dynamic-group bound to an entity context. Members resolve on reply. |

### 3.2 — Why IP-routing terminology

ADR-016 renamed from ADR-014's `targeted`/`broadcast`/`context_bound`:
- `targeted` was ambiguous (pin vs. pool). `unicast` is unambiguous one-to-one.
- `context_bound` was wordy. `multicast` is decades-old shorthand for dynamic-membership.
- `broadcast` was already IP-flavored; kept.

The IP-routing vocabulary also leaves room for a future **`anycast`** mode (pick-one-from-pool and pin) if use cases emerge; current `broadcast` has anycast-ish semantics (coerces to unicast on first reply) which `anycast` would formalize.

### 3.3 — Validator contract (INV-TH28)

`unicast` **requires** `recipientAgentId`. A bare `create_thread({title, message})` now rejects at the Zod validator with a remediation hint: either pin a `recipientAgentId` or explicitly set `routingMode: "broadcast"`. This is the single most important safety rail: it eliminates the kate↔greg leakage class at the validator — the error surface is Zod, not silent multi-agent notification.

### 3.4 — Legacy normalization

Threads stored pre-ADR-016 with `routingMode: "targeted"` or `"context_bound"` normalize on GCS read:
- `"targeted"` → `"unicast"`
- `"context_bound"` → `"multicast"`
- missing → `"unicast"` (Phase-1 default)

No GCS rewrite; readers see the new names.

---

## §4 — Turn protocol

Only the current turn holder can reply (INV-TH1). After each reply, the turn flips by `{role, agentId}` — not just role (INV-TH2, INV-TH17). This prevents:

- Out-of-turn replies (agent A replies, then A replies again before B).
- Cross-agent turn theft in broadcast/multicast threads (after agent B1 first-replies to a broadcast, B2 cannot subsequently reply; the thread coerces to unicast B1↔opener).

`currentTurnAgentId` is the authoritative pin. Mismatches reject at the policy layer.

---

## §5 — Convergence — the forcing-function gate

The central Phase 1 innovation: a thread cannot converge with nothing attached. Two independent artifacts are required (ADR-013):

### 5.1 — Required artifacts

1. **≥1 staged convergence action** (INV-TH11). A `StagedAction` is a structured declaration that a downstream entity should be spawned or mutated. Nine action types are currently registered; see §7.
2. **Non-empty summary** (INV-TH12). A narrative explanation of the thread's outcome, frozen onto every spawned entity's `sourceThreadSummary` so provenance survives (INV-TH23).

Either artifact missing → `ThreadConvergenceGateError`. The thread stays `active`.

### 5.2 — Both parties must converge (INV-TH3)

Each participant submits `converged: true` on a reply. The thread status flips to `converged` only when both (for unicast) or all active (for broadcast-coerced/multicast) participants have signaled.

### 5.3 — Atomic commit (INV-TH13)

When the gate passes and convergence triggers, all `staged` actions flip to `committed` in the **same CAS transaction** as `thread.status = "converged"`. Either all land or none; no split state.

Post-commit, cascade execution runs (§6). Execution failures do **not** revert commitment — they transition to `cascade_failed` (§2.1). The decision-to-act is frozen; action execution is a separate lifecycle.

---

## §6 — Cascade — validate-then-execute

The cascade pipeline is the mechanism that turns a thread's committed actions into actual downstream entities. It is the most complex subsystem in threads and the one that ADR-014 Phase 2 and ADR-015 Cascade-Perfection together landed.

### 6.1 — Two-phase pipeline (INV-TH19)

```
  committed actions + summary + thread
                │
                ▼
  ┌────────────────────────────┐
  │   PHASE A: VALIDATE        │   atomic; gates convergence
  │   • spec.validate(payload) │   • failure → reject converged=true;
  │   • idempotency pre-check  │     thread stays active
  │   • depth-guard check      │   • no partial side effects
  └──────────┬─────────────────┘
             │ (all pass)
             ▼
  ┌────────────────────────────┐
  │   PHASE B: EXECUTE         │   post-commit; entity creation
  │   • spec.spawn(payload)    │   • failure → cascade_failed
  │   • spec.audit(entity)     │   • idempotency natural-key guard
  │   • spec.dispatch(entity)  │   • audit is replayable (INV-TH26)
  └────────────────────────────┘
```

Phase A is the **gate**. Phase B is the **work**. The split means: if any action would fail validation, convergence itself is rejected — the thread stays `active` and the author can revise (no partial spawn). But once we've committed the decision, execution problems don't unwind the decision — they surface as `cascade_failed` requiring manual inspection (idea-96).

### 6.2 — ActionSpec registry (ADR-015)

Pre-Cascade-Perfection, each action type was a hand-rolled handler threading idempotency, audit, and dispatch concerns through procedural code. ADR-015 flipped this to a **declarative registry** (INV-TH24):

```ts
interface ActionSpec<T> {
  kind: "spawn" | "update" | "audit_only";
  payloadSchema: ZodSchema<T>;
  idempotencyKey?: (ctx, payload) => string;  // natural key lookup
  validate?: (ctx, payload) => Promise<void>;
  spawn?: (ctx, payload) => Promise<Entity>;
  update?: (ctx, payload) => Promise<Entity>;
  audit: (ctx, entity) => Promise<AuditEntry>;
  dispatch?: (ctx, entity) => Promise<void>;
}
```

Each handler declares **what to spawn**. The runner owns all **cross-cutting concerns** (idempotency, audit, dispatch, depth-guard, error surfacing). Missing fields fail TypeScript at registration; unregistered types fail Zod at the thread-policy validator.

### 6.3 — Idempotency (INV-TH20)

Every spawned entity carries a **CascadeBacklink** natural key:

```ts
cascadeBacklink: { sourceThreadId: string, sourceActionId: string }
```

Before spawn, the runner checks if an entity already exists with this key. If yes, the existing entity is returned (no duplicate). This makes cascade **replay-safe** — a retry after partial failure doesn't double-spawn.

### 6.4 — Depth-bound re-entrancy (INV-TH25)

A spawned entity (e.g., a create_task cascade) might itself trigger further cascades (task → thread → new task). `runCascade` is bounded at **MAX_CASCADE_DEPTH=3**; beyond that, further cascades **defer to an async queue** (idea-93) rather than inline-recurse. This prevents stack explosion and gives visibility into long cascade chains.

### 6.5 — Replayable audit (INV-TH26)

Audit emission is **not blocking**. If the audit store write fails post-spawn, the entity is not blocked — the audit enqueues onto a replay queue (idea-94) and retries asynchronously. Rationale: entity correctness matters more than audit promptness; audit can catch up.

---

## §7 — Action vocabulary

Nine registered action types, partitioned by **autonomy scope**:

### 7.1 — Autonomous (7)

Actions the cascade can commit without Director approval:

| Type | Kind | Spawns | Notes |
|------|------|--------|-------|
| `close_no_action` | audit_only | — | Phase 1 "we talked, nothing to do". Leaves audit trail. |
| `create_task` | spawn | Task | Architect→Engineer work assignment from thread consensus. |
| `create_proposal` | spawn | Proposal | Engineer-authored proposal surfaced to Architect queue. |
| `create_idea` | spawn | Idea | Emergent insight / future-work bucket. |
| `update_idea` | update | Idea | Status/tag mutation (e.g., "triage this open idea"). |
| `update_mission_status` | update | Mission | Thread resolves a mission gate question. |
| `create_clarification` | audit_only | Clarification | Surface ambiguity for Director. |

### 7.2 — Director-gated (2)

Actions requiring Director approval (ADR-014 reserves slots; current implementation wiring still in progress for some):

| Type | Kind | Spawns | Notes |
|------|------|--------|-------|
| `propose_mission` | spawn | Mission | Requires Director approval before active. |
| `create_bug` | spawn | Bug | Added in ADR-015 Phase 2. First-class bug entity; see bug FSM. |

### 7.3 — Adding a new action type

1. Create `hub/src/policy/cascade-actions/<type>.ts` implementing `ActionSpec<T>`.
2. Register via side-effect import in `cascade-actions/index.ts`.
3. Add the type to the Zod discriminated union in `thread-policy.ts`.
4. Add an invariant entry if the action has unique semantics.
5. Add tests exercising validate + spawn + idempotency.

---

## §8 — Participant resolution & dispatch

Post-M18, dispatch is **agentId-first, role-as-filter**. This is a consequence of ADR-016's hard-removal of the role+label fallback.

### 8.1 — Dispatch sites

Three sites dispatch thread events over SSE:
- **Open-time** (`createThread`) — dispatches `thread_message` to the counterparty or pool.
- **Reply-time** (`createThreadReply`) — dispatches `thread_message` to `otherParticipantIds`.
- **Finalized-time** (`handleThreadConvergedWithAction`) — dispatches `thread_convergence_finalized`.

### 8.2 — Selector shape

```ts
Selector = {
  engineerIds?: string[],        // authoritative: specific agentIds to target
  roles?: ParticipantRole[],     // filter within engineerIds (or pool if engineerIds absent)
  matchLabels?: Record<string, string>,  // label filter (e.g., team=platform)
}
```

For threads, `engineerIds` is always the authoritative primary. `matchLabels` inherits from the thread's frozen labels (INV-TH9 — from opener's Agent).

### 8.3 — No role-fallback (INV-TH27)

**Pre-ADR-016:** if `otherParticipantIds` came out empty (e.g., pre-M18 participant upsert hadn't resolved agentIds), dispatch **fell back** to role+label broadcast. This fallback was the kate↔greg leakage vector — a unicast-intent thread could silently become a pool broadcast.

**Post-ADR-016:** empty `otherParticipantIds` at reply or finalized dispatch is a **Phase-1 invariant violation**. The code throws `INV-TH27 violation` with a diagnostic message. The thread cannot progress. Rationale: the bug is in the participant-upsert chain, not this dispatch — surface it loudly rather than silently mis-route.

---

## §9 — Audit & back-linking

### 9.1 — Summary-as-Living-Record (INV-TH23)

At cascade commit, the thread's `summary` string is **frozen onto every spawned entity** as `sourceThreadSummary`. This means: a task spawned from a thread carries the thread's narrative *at decision time*, even if the thread is later reaped, archived, or its messages are redacted.

### 9.2 — CascadeBacklink (INV-TH20)

Every spawned entity carries `cascadeBacklink: {sourceThreadId, sourceActionId}`. This is both the idempotency natural key (§6.3) and the provenance pointer — given any task/proposal/idea/bug/clarification, you can walk back to the exact thread + action that produced it.

### 9.3 — Audit replay queue

Audit emission is decoupled from entity creation (§6.5). Failed audits enqueue for async retry. This protects entity creation from audit-store transient failures while preserving eventual audit consistency.

---

## §10 — Invariant catalog

Full registry in `docs/specs/workflow-registry.md` §1.3. This table is the cross-reference for readers navigating from this doc to the registry.

| ID | Description | Source |
|----|-------------|--------|
| INV-TH1 | Only current turn holder can reply | Foundation |
| INV-TH2 | Turn alternates by `{role, agentId}` after each reply | Foundation |
| INV-TH3 | Convergence requires both parties signal `converged=true` | Foundation |
| INV-TH4 | `thread_message` targets participants, not opposite role | Foundation |
| INV-TH5 | Convergence dispatch targets participants (P2 merges events) | Foundation |
| INV-TH6 | Replies to non-active threads rejected | Foundation |
| INV-TH7 | `close_thread` Architect-only; participants use `leave_thread` | Foundation |
| INV-TH9 | Thread `labels` frozen at create from opener; immutable | M19 |
| INV-TH11 | `converged=true` rejected unless ≥1 staged convergenceAction | ADR-013 |
| INV-TH12 | `converged=true` rejected unless `summary` non-empty | ADR-013 |
| INV-TH13 | Convergence: staged→committed atomic with status=converged | ADR-013 |
| INV-TH14 | Participant upsert symmetric; append new, update existing | ADR-013 |
| INV-TH15 | `authorAgentId` from replying Agent's engineerId | ADR-013 |
| INV-TH16 | Dispatch participant-scoped via `Selector.engineerIds` | ADR-013/M21 |
| INV-TH17 | Reply turn pinned by `currentTurnAgentId`; mismatch rejects | ADR-013/M21 |
| INV-TH18 | Routing mode immutable; broadcast coerces to unicast on first reply | ADR-014 |
| INV-TH19 | Cascade validate-then-execute atomicity | ADR-014 |
| INV-TH20 | Idempotency via `{sourceThreadId, sourceActionId}` natural key | ADR-014 |
| INV-TH21 | Thread reaper abandons `active` after idleExpiryMs (7d) | ADR-014 |
| INV-TH22 | `StagedAction.proposer = {role, agentId}` | ADR-014 |
| INV-TH23 | Summary frozen onto spawned entities' `sourceThreadSummary` | ADR-014 |
| INV-TH24 | Every ActionSpec declares typed interface | ADR-015 |
| INV-TH25 | runCascade bounded at MAX_CASCADE_DEPTH=3 | ADR-015 |
| INV-TH26 | Audit replayable; entity not blocked on audit failure | ADR-015 |
| INV-TH27 | Dispatches target resolved agentIds only; empty set throws | ADR-016 |
| INV-TH28 | `unicast` requires `recipientAgentId` | ADR-016 |

(INV-TH8, TH10 are reserved/retired slots.)

---

## §11 — Known limitations & deferred work

The following are logged as first-class Ideas for future unlocks. All deferred-not-blocking; Threads 2.0 is functionally complete without them.

| Idea | Area | Summary |
|------|------|---------|
| idea-86 | Director integration | Parts 2+3 of Director thread participation (chat injection + universal-adapter alignment). Pending ACP chat redesign. |
| idea-90 | Anycast mode | Formalize broadcast's coerce-to-unicast-on-first-reply as a named `anycast` routing mode. |
| idea-91 | Multicast dynamic membership | Resolve multicast participant set from bound entity context on each reply. |
| idea-92 | Multicast open-time dispatch | Currently no open-time dispatch for multicast (ADR-014 §189 deferred); first-reply discovery only. |
| idea-93 | Deferred-cascade queue | Complete INV-TH25's beyond-depth deferral (runner currently hard-errors at depth 3+). |
| idea-94 | Audit replay queue | Complete INV-TH26's replay path (failed audits currently logged, not re-enqueued). |
| idea-95 | Cross-action dependencies | ADR-015 Class I — e.g., one cascade action's output feeds another's input. |
| idea-96 | cascade_failed recovery | Transient/permanent classification + retry queue for cascade_failed threads. |

---

## §12 — Appendix

### 12.1 — ADR trail

| ADR | Date | Topic | Outcome |
|-----|------|-------|---------|
| 013 | 2026-04-17 | Multi-action convergence (Phase 1) | Forcing-function gate (summary + ≥1 action). Shipped. |
| 014 | 2026-04-18 | Phase 2 cascade architecture | Routing modes, validate-then-execute, action vocabulary. Shipped. |
| 015 | 2026-04-18 | Cascade-Perfection | ActionSpec registry; Bug as first-class entity. Shipped. |
| 016 | 2026-04-19 | IP-routing terminology + fallback hard-remove | unicast/broadcast/multicast; INV-TH27/28. Shipped. |

### 12.2 — Code surface pointers

For readers needing to trace from spec to implementation:

- `hub/src/state.ts` — type definitions (Thread, StagedAction, ThreadParticipant, routing modes).
- `hub/src/policy/thread-policy.ts` — MCP tool handlers + Zod schemas + dispatch.
- `hub/src/policy/cascade.ts` — `runCascade` orchestrator + ActionSpec registry.
- `hub/src/policy/cascade-actions/*.ts` — per-type ActionSpec implementations.
- `hub/src/gcs-state.ts` — `normalizeThreadShape` + `normalizeRoutingMode` (legacy read).
- `hub/test/` — test suite; patterns documented in `hub/test/README.md`.

### 12.3 — Related reading

- `docs/specs/workflow-registry.md` — full invariant registry (INV-TH* and siblings).
- `docs/specs/entities.md` — Thread entity in the canonical entity catalog.
- `docs/architecture/policy-network-v1.md` — surrounding policy-network context.
- `docs/architect-engineer-collaboration.md` — cross-role workflow catalog.
