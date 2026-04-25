# ADR-025 — Message Primitive: Sovereign Workflow Entity

**Status:** Accepted — 2026-04-25. Ratified via mission-51 (M-Message-Primitive); landed across PRs #44 (W1) / #45 (W2) / #46 (W3) / #47 (W4) / #48 (W5) / [W6 PR — this PR]. Authored during design round thread-311 (architect lily + engineer greg) per Position A scope expansion.

**Context window:** mission-51 — the second sovereign-entity ADR after ADR-024 (StorageProvider). ADR-024 ratified the storage substrate; ADR-025 ratifies the workflow-entity primitive that runs on top. Together the two ADRs establish the sovereign-architectural-surface pattern: code-declared registries, single-entity atomic primitives composing into higher-level workflow shapes, no leakage between layers.

---

## 1. Context

Pre-mission-51, the Hub's workflow surfaces were fragmented across multiple specialized entity types:

- **Thread** carried inline `messages[]` as part of its scalar blob (per-file-split in mission-49 W9, but conceptually a thread-local array).
- **Notification** (mission-49 W9 NotificationStore) handled durable SSE-fanout events with a separate ULID namespace.
- **PendingActionItem** (ADR-017) handled the dispatch-ack lifecycle with its own FSM (`enqueued → receipt_acked → completion_acked`).
- **DirectorNotification** handled Director-specific dispatches.
- **ScheduledEvent**: did not exist as a primitive; scheduled-message semantics were ad-hoc.

Each entity had its own repository, its own audit shape, its own dispatch path, and its own backward-compat surface. The state-transition mechanism that should fire typed events on entity status changes (per `docs/methodology/mission-lifecycle.md` §5.1: idea-192) was completely missing — engineer/architect had to poll for state changes manually. mission-48 retrospective surfaced this as recurring friction across mission-48 + mission-50 + the upcoming mission-51 W6 cutover.

Director (2026-04-25) ratified Position A at thread-311 round-3: a single sovereign **Message** entity becomes the universal workflow primitive. Thread, Notification, PendingActionItem, DirectorNotification, and ScheduledEvent become projection views over Message. State-transition triggers fire Messages on declared transitions. Scheduled-message semantics emerge naturally from the Message primitive's `delivery: 'scheduled'` + `fireAt` + `precondition` fields.

This ADR captures the design that mission-51 ratified across thread-311 (6 rounds) and W0-W6 (7 waves of mechanical implementation).

---

## 2. Decision

### 2.1 Single sovereign workflow entity

The **Message** entity becomes the universal communication primitive in the Hub. Every cross-agent or cross-Hub event is a Message:

- Thread replies project as `kind=reply` Messages (W1+W2 migration shim).
- Notifications, PendingActionItems, DirectorNotifications, scheduled events: future projection views over Message (deferred to follow-on cleanup; W6 ships the registry surface).
- State-transition triggers (W3) emit Messages with appropriate kinds.
- Scheduled events live as `delivery: 'scheduled'` Messages with `fireAt` + optional `precondition`.

### 2.2 Three-axis kind taxonomy with no per-message override

Each `MessageKind` declares three orthogonal axes in a code-declared registry (`KIND_AXES` in `hub/src/entities/message.ts`):

- **`requires_turn`**: the caller must hold the turn on the relevant thread to author this kind.
- **`shifts_turn`**: posting this kind rotates the thread's turn counter.
- **`authorized_authors`**: which roles may author — `"any" | "director-only" | "self-only"`.

**Footgun mitigation per Position A:** no per-message override on these axes. Adding a new kind requires a PR with explicit axis declarations. Runtime cannot mutate. This eliminates the LLM-author abuse vector where a clever caller could bypass turn discipline or escalate authorization by setting flags on individual messages.

Initial 5 kinds (W1):
- `reply` — thread reply (requires turn; shifts turn; any author).
- `note` — informational (no turn; any).
- `external-injection` — Hub-emitted system event (no turn; any).
- `amendment` — caller amends their own prior message (no turn; self-only).
- `urgency-flag` — Director-only urgent signal (shifts turn; director-only).

Future kinds (e.g., `pending-action`, `notification`, `cascade-replay-pending`) added via PR review.

### 2.3 Multi-membership pattern

A single Message belongs to thread + inbox + outbox simultaneously via derived queries (W1):

- `list_messages({ threadId: X })` → thread view, ordered by `sequenceInThread`.
- `list_messages({ targetRole, targetAgentId })` → inbox view.
- `list_messages({ authorAgentId })` → outbox view.

The Message blob is the source of truth; views are computed from indexed fields. No separate inbox/outbox storage; no synchronization gymnastics.

### 2.4 Code-declared registries

Five registries land in mission-51 W3+W4+W6, all PR-reviewable, all locked at code-time:

1. **`KIND_AXES`** (`hub/src/entities/message.ts`) — kind → axis matrix.
2. **`TRIGGERS`** (`hub/src/policy/triggers.ts`) — entity-state-transition → Message-emission declarations.
3. **`DOWNSTREAM_ACTORS`** (`hub/src/policy/downstream-actors.ts`) — kind → consumer-payload-predicate gate (skip-list honored implicitly by absence-of-actor).
4. **`PRECONDITIONS`** (`hub/src/policy/preconditions.ts`) — scheduled-message fire-precondition predicates by name (Strategy A; runtime cannot evaluate arbitrary expressions).
5. (W6 future) **`KIND_PROJECTIONS`** — for projecting legacy entities (Notification, PendingActionItem, etc.) as Messages of specific kinds.

PR review locks registry shapes. Runtime mutation is not supported. Adding a new entry requires PR + tests + axis declarations (for kinds) or predicate declarations (for preconditions).

### 2.5 Saga pattern with cascade-replay

Mission-51 W5 closes bug-31 by formalizing the existing M-Cascade-Perfection Phase 1 (ADR-015) idempotency-keyed-saga pattern with two extensions:

1. **`cascadePending` marker on parent Thread** — set before `runCascade`, cleared after. Single-entity atomic via existing `putIfMatch`. Optional schema fields for forward compat.
2. **Hub-startup `CascadeReplaySweeper.fullSweep()`** — lists threads with marker, re-runs `runCascade`. Per-action `findByCascadeKey` short-circuit prevents duplication on replay.

The marker is OPTIMIZATION-not-correctness: per-action cascade-key idempotency is the load-bearing recovery mechanism. The marker only tells the sweeper which threads to scan.

### 2.6 Bounded async-shadow projection

Mission-51 W2 implements the W0-spike-ratified async-shadow projector + bounded sweeper backstop pattern for thread-message normalization:

- **In-process projector** (W1+W2 shim) fires synchronously on each thread-reply commit. Bounded shadow-lag ~ms in steady state.
- **Polling sweeper backstop** (5s interval) closes any gaps from missed projections (process-death between legacy thread-message persist and message-store write). Idempotent via `findByMigrationSourceId` short-circuit.

Bounded shadow-lag AC ≤ 5s verified empirically.

### 2.7 Failed-trigger retry interlock (W3 + W4)

W4's `retryFailedTrigger` helper closes the W3 emission-failure path. When `runTriggers` fails to `createMessage` for the original emission, the retry-helper enqueues a scheduled-message-retry with backoff (30s → 5min → give up at 3 retries). All thresholds env-configurable. Catastrophic failure (retry-enqueue itself fails) is logged + swallowed; no infinite recursion.

### 2.8 ADR-024 boundary preserved

Mission-51 uses ONLY existing single-entity atomic primitives from the StorageProvider contract (`createOnly`, `putIfMatch`, `getWithToken`). No new contract surface. The 6-primitive contract from ADR-024 §2 is unchanged.

This is by design: per W0 spike's path-pick, the application-layer saga + idempotency-key composition is sufficient for cross-entity workflow semantics. Adding a multi-entity transactional primitive at the StorageProvider layer would re-introduce backend-specific divergence (some backends support it natively, others would emulate poorly) and violate ADR-024's no-leakage discipline.

---

## 3. Companion to ADR-024

ADR-024 ratifies the storage substrate (single-entity atomic CAS). ADR-025 ratifies the workflow primitive that runs on top (multi-membership Message + saga + triggers + scheduled-message + retry interlock). The two ADRs are companion sovereign surfaces.

| ADR | Surface | Single-source-of-truth |
|---|---|---|
| ADR-024 | StorageProvider 6-primitive contract | `packages/storage-provider/src/contract.ts` |
| ADR-025 | Message + workflow primitives + registries | `hub/src/entities/message.ts` + `hub/src/policy/{triggers, downstream-actors, preconditions, scheduled-message-sweeper, cascade-replay-sweeper, message-projection-sweeper, message-helpers, message-policy}.ts` |

Mission-51 W0 spike characterized the existing cascade-runner as "already 80% saga-shaped" and ratified that the remaining 20% (marker + replay) composes from existing single-entity primitives. ADR-025 formalizes that architecture.

---

## 4. Consequences

### 4.1 Sunset path for legacy entity stores (post-W6 cleanup)

W6 ships the new MCP verbs (`list_messages` + `create_message`) + ADR ratification. Follow-on cleanup (separate PRs, post-mission-51) will:

1. Remove `Thread.messages[]` inline storage; all callers read via `list_messages({threadId})`.
2. Migrate `INotificationStore` to project from message store (preserves backward-compat MCP response shapes).
3. Migrate `IPendingActionStore` to project from message store with `kind=pending-action` (preserves ADR-017 FSM semantics in payload).
4. Migrate `IDirectorNotificationStore` similarly (`kind=director-notification`).

Each cleanup is a touch-everything refactor; W6 explicitly defers them to dedicated post-mission PRs (smaller blast radius; easier to review).

### 4.2 bug-31 bypass technique sunsets

W5 closes bug-31 (cascade-bookkeeping) by adding the marker + replay sweeper. The bypass technique (skip-plannedTasks on missions) sunsets post-W6 merge. plannedTasks can be safely set on missions again. Methodology v1.x update + mission-51 retrospective document this transition.

### 4.3 Idea-191 (M-Repo-Event-Bridge) unblocked

idea-191 was sequenced after mission-51 W1 milestone (per thread-312 design-round convergence). With W1 + W2 + W3 + W4 + W5 + W6 all merged, the M-Message-Primitive substrate is stable. idea-191 / mission-52 (when activated) can plug into Message via `kind=repo-event` per its design-round-ratified shape.

### 4.4 Future kind expansion

The kind taxonomy expands via PR review per the registry-shape:
- `pending-action` (W7+ projection)
- `notification` (W7+ projection)
- `director-notification` (W7+ projection)
- `cascade-replay-pending` (W4+ defense-in-depth retry; deferred per engineer-call)
- `repo-event` (mission-52 / idea-191)
- Future kinds as workflow surfaces emerge

### 4.5 Test surface

Mission-51 lands +159 tests across 7 waves (760 → 919 baseline). Per-axis enforcement, per-trigger payload-shape, per-precondition predicate, per-sweeper happy-path + error-isolation, per-MCP-verb authorization + scheduled-delivery validation. ADR-025 is empirically grounded.

---

## 5. Provenance

- **Director ratification:** thread-311 round-3 (Position A scope expansion; 2026-04-25).
- **Design round:** thread-311 (6 rounds; architect lily + engineer greg).
- **W0 spike:** PR #42 / `29b26c2` — backend characterization + path picks.
- **W1 entity:** PR #44 / `de66c57` — Message entity + repository + migration shim.
- **W2 read-path:** PR #45 / `a16d4ec` — bounded sweeper.
- **W3 triggers:** PR #46 / `490e874` — TRIGGERS + DOWNSTREAM_ACTORS.
- **W4 scheduled:** PR #47 / `ca5d9be` — sweeper + PRECONDITIONS + retry interlock.
- **W5 cascade-replay:** PR #48 / `6e8754a` — marker + Hub-startup replay; closes bug-31.
- **W6 (this ADR + closing audit):** [W6 PR — this PR].
- **Companion ADR:** ADR-024 (StorageProvider).
- **Closing audit:** `docs/audits/m-message-primitive-closing-report.md`.
- **Methodology lifecycle audit:** `docs/methodology/mission-lifecycle.md` §5.1 (idea-192 closure list — 7 of 11 🔴 transitions mechanizable via the trigger primitive).

---

## 6. Decision authors

- **Architect:** lily (eng-40903c59d19f) — thread-311 design round opener; W0-W6 directives.
- **Engineer:** greg (eng-0d2c690e7dd5) — thread-311 round-2 audit; W0-W6 implementation; this ADR draft.
- **Director:** ratified Position A 2026-04-25 ~19:35Z; activation gate cleared.
