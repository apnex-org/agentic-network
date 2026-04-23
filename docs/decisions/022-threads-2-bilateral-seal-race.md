# ADR-022: Threads 2.0 — Bilateral Seal Race Resolution (bug-23 H1)

**Date:** 2026-04-23
**Status:** **Accepted** (ratified 2026-04-23 by Director; implementation gated on mission-42 release-gate signal)
**Bug:** bug-23 (thread bilateral-seal race — `investigating`, H1 strongly supported)
**Mission:** mission-42 (M-Cascade-Correctness-Hardening) Task 4
**Kickoff-decisions authority:** `docs/missions/mission-42-kickoff-decisions.md` §Decision 2
**Threads:** thread-241 (original observation), thread-242 (H1 controlled-comparison verification), thread-255 (architect-observed mitigated variant 2026-04-23)
**Related ADRs:** ADR-013 (Threads 2.0 multi-action convergence), ADR-014 (Threads 2.0 Phase 2 architecture)
**Complements:** ADR-015 (Cascade Perfection)

---

## Decision

**Ratified 2026-04-23 by Director.** This ADR ratifies two tightly-coupled fixes, both shipped as mission-42 Task 4:

### Primary: Option A — new `awaiting_bilateral_seal` FSM state

Threads transition `active → awaiting_bilateral_seal` when one party converges with a cascade-spawning committed stagedAction. Terminal closure deferred until:
- **Bilateral path:** counterparty seals with their own `converged=true` + stagedAction → `converged`
- **Unilateral-fallback path:** bilateral-seal window (default **60 seconds**) elapses without counterparty seal → reaper transitions to `closed` with audit entry noting the unilateral fallback

### Secondary: error-surface discrimination

The undifferentiated `"Thread X not found, not active, or not your turn"` error class splits into three discriminated sub-errors, each with structured response shape for machine-parsability:
- `"Thread X not found"` — thread ID does not exist
- `"Thread X is {closed | converged | abandoned | cascade_failed}"` — terminal; surface the actual terminal state
- `"Thread X turn belongs to {role}:{agentId}, not {role}:{agentId}"` — turn-pin mismatch; surface both expected and actual

### Ratified parameters

| Parameter | Value |
|---|---|
| Bilateral-seal window | **60 seconds** (default; env-configurable via `config.bilateralSealWindowMs`) |
| Error-discrimination scope | Bundled with Option A in same Task 4 (not split) |
| New invariant | **INV-TH24** — "Threads enter `awaiting_bilateral_seal` when one party converges with a cascade-spawning committed stagedAction; terminal transition deferred until the counterparty seals or the bilateral-seal window elapses." |
| Mission-42 release-gate | On hold — ratification does not activate mission-42; Director release-gate signal remains a separate call |

---

## Context

### bug-23 observation (2026-04-21)

Thread-241 exhibited a bilateral-seal failure: architect replied with `converged=true` plus a **cascade-spawning** `create_task` stagedAction; engineer's immediate bilateral-seal reply was rejected with `"Thread thread-241 not found, not active, or not your turn"`. Post-mortem `get_thread` showed `status: "closed"` (not `"converged"`), `currentTurn: "engineer"` (incoherent with terminal state), action-1 still `staged` (not `committed`) despite task-316 being spawned.

Three inconsistencies named in the bug:
1. **Terminal state + engineer-turn together** — mutually exclusive
2. **Staged action yet cascade executed** — contract violation (cascade is meant to fire on *commit*)
3. **Undifferentiated error message** — "not found / not active / not your turn" is three disjoint failures folded into one string; engineer cannot determine remediation

### H1 verification (2026-04-21 09:50Z)

Controlled comparison via thread-242 (isomorphic structure to thread-241 but with architect's stagedAction = `close_no_action`, non-cascade-spawning) landed in `status=converged` with both actions `committed`. The cascade-spawning variable is the only flip. H1 strongly supported:

> *task-316 issuance cascade completed BEFORE engineer reply landed; Hub transitioned the thread to `closed` as a side-effect of the cascade, pre-empting engineer's bilateral seal window.*

| Thread | Architect's stagedAction | Cascade-spawning? | Engineer seal | Final status | Action-1 status |
|---|---|---|---|---|---|
| thread-240 | `close_no_action` | No | Success | `converged` | `committed` |
| thread-241 | `close_no_action` → cascade to task-316 | **Yes** | **Rejected** | `closed` | `staged` |
| thread-242 | `close_no_action` | No | Success | `converged` | `committed` |

### Second empirical reproduction (2026-04-23, thread-255)

During mission-41 activation, the architect's bilateral-seal reply timed out; retry hit `"Thread thread-255 not found, not active, or not your turn"`. In this instance, H1's race didn't apply (the first reply had processed successfully; retry was correctly late), but the **undifferentiated error-message class surfaced again**. This reinforced bug-23 §Inconsistencies #3 as a live, recurring operator-friction issue independent of the cascade-race.

The implication: the error-surface fix is separately needed and should ship in the same Task 4 scope as the race fix.

### Why an ADR

Mission-42's brief originally scoped Task 4 as *investigate H1*; H1 was verified post-brief, making the real decision **fix-shape**. The fix touches Threads 2.0 FSM surface (ADR-013/014 contract), which is architectural real-estate. Per mission-42 kickoff-decisions §Decision 2b, this ADR precedes implementation.

---

## Options compared

### Option A — New FSM state `awaiting_bilateral_seal`

Add an intermediate state between cascade-fire and terminal-closure. When an architect's `converged=true` reply triggers a cascade-spawning action, the thread transitions `active → awaiting_bilateral_seal` (NOT directly to `closed`). This state:

- **Permits engineer reply** with `converged=true` plus complementary seal
- **Cascade fires immediately** (not deferred — the architect's action is already committed)
- **Transitions to `converged`** on engineer's bilateral seal (or `closed` on reaper timeout if engineer never seals)
- **Has explicit idle timeout** (e.g., 60s) — engineer seal window; unsealed after timeout → `closed` terminal

#### Schema changes
- New `Thread.status` enum value: `awaiting_bilateral_seal`
- New FSM transitions: `active → awaiting_bilateral_seal` (on cascade-spawning stagedAction commit), `awaiting_bilateral_seal → converged` (on engineer bilateral seal), `awaiting_bilateral_seal → closed` (on reaper timeout)
- New invariant `INV-TH24` (proposed): *"Threads enter `awaiting_bilateral_seal` when one party converges with a cascade-spawning committed stagedAction; terminal transition deferred until the counterparty seals or the bilateral-seal window elapses."*
- Optional new field `Thread.bilateralSealDeadline: ISO-8601 | null` — engineer-seal window start + configurable TTL

#### Pros
- **Clean semantics** — state name explicitly says "waiting for the other party's seal"
- **Explicit guarantee** — FSM forces the bilateral-seal window; can't regress via future changes that forget about the window
- **Observable** — `get_thread` during the window returns `status: "awaiting_bilateral_seal"` with an unambiguous meaning
- **Reaper integration clean** — idle-expiry is already a Threads 2.0 pattern (INV-TH21 for `abandoned`); same mechanism applies

#### Cons
- **Larger implementation surface** — every thread-status read/write in Hub + adapter code must handle the new state
- **FSM graph grows** — one more state; +2 transitions. Not massive but accretes
- **Spec surface expands** — ADR-013/014 need amendment; workflow-registry §Thread FSM table grows

### Option B — Idempotent engineer-seal post-close

Relax the `create_thread_reply` gate to accept engineer seals for a brief window *after* the thread has transitioned `closed` via cascade. Effectively: `closed` becomes "soft-closed" for N seconds; engineer seal lands idempotently; after window elapses, `closed` becomes hard-terminal.

#### Schema changes
- No new FSM states
- `ThreadStore.replyToThread` relaxes the "thread must be `active`" precondition: also accepts replies on threads that are `status=closed` AND `closedAt` is within the bilateral-seal window
- On successful post-close engineer seal: action transitions `staged → committed`; thread summary updates; **thread status stays `closed`** (already terminal)
- Timestamp comparison at reply time; no new field needed

#### Pros
- **Smaller implementation surface** — single gate relaxation; no FSM state mutation
- **No spec amendment** — existing ADR-013/014 hold; only the gate precondition changes
- **Faster to ship** — engineer-time is a lookup + comparison, not a state-machine extension

#### Cons
- **Looser semantics** — "closed" no longer unambiguously means "no more activity possible"; operators/tools reading thread state during the window see `closed` but the thread is still accepting writes
- **Edge cases around observability** — what if `get_thread` is called during the window? What about SSE broadcasts? Each read-path needs to know about the soft-close window
- **Weaker guarantee** — silently relaxing a terminal-state gate is exactly the pattern that Threads 2.0 was built to prevent (see ADR-013 §*"Agent's-Word ≠ Hub's-Deed"*). The gate's job is to be a forcing function; softening it erodes that

### Comparison matrix

| Dimension | Option A | Option B |
|---|---|---|
| Guarantee strength | Explicit FSM state — strong | Time-window relaxation — weak |
| Semantic clarity | `awaiting_bilateral_seal` = "waiting for counterparty" — unambiguous | `closed` with soft-window = overloaded | 
| Implementation surface | Medium (new state, ~5-8 touch points) | Small (gate relaxation, ~2-3 touch points) |
| Spec impact | ADR-013/014 amended; INV-TH24 added | Minimal (gate precondition note) |
| Regression resistance | High (FSM enforced) | Low (can be accidentally tightened) |
| Observability | Clean (`get_thread` shows exact state) | Muddy (status=closed lies transiently) |
| Adapter code impact | Status enum widens; all callers need to handle | Minimal (callers still see `active` or `closed`) |
| Reaper integration | Existing idle-expiry pattern applies | New inline timestamp-comparison logic |

---

## Recommendation

**Option A — new `awaiting_bilateral_seal` FSM state.**

Primary reasons:
1. **Threads 2.0 discipline** — ADR-013 is built around the *forcing-function* principle (the gate is strict; agents self-correct on rejection). Option B erodes that principle by making `closed` semantically softer. Option A preserves it by adding a new state rather than relaxing an existing one.
2. **Guarantee strength matters here** — bug-23's class is "cascade-race leaks through and engineer's ratification is lost." Option A makes the engineer seal window an explicit FSM invariant that future code cannot accidentally bypass. Option B makes it a timestamp comparison that a future gate-tightening could accidentally remove.
3. **Operational observability** — engineers and operators reading `get_thread` during the bilateral-seal window should see an unambiguous "what is this thread doing right now" answer. `awaiting_bilateral_seal` tells them. `closed` with an implicit "but also accepting one more reply for 30 more seconds" does not.

Option B's implementation-surface advantage is real but modest — a state addition is 1-2 days of engineer work vs maybe 0.5 day for the gate relaxation. The cost delta does not justify the looser semantic. Threads 2.0 was an explicit re-ratification *away* from implicit behaviors; this choice should honor that.

## Error-surface discrimination (second decision, same Task 4)

Independent of A-vs-B, the `"Thread X not found, not active, or not your turn"` error class must be split into three discriminated errors:

- `"Thread X not found"` — thread ID does not exist
- `"Thread X is {closed | converged | abandoned | cascade_failed}"` — terminal; give the actual terminal state
- `"Thread X turn belongs to {role}:{agentId}, not {role}:{agentId}"` — turn-pin mismatch; give both the expected and actual

**Rationale:** engineer and LLM self-correction depend on actionable error messages (ADR-012 context economy principle; bug-23 §Inconsistencies #3; mission-41 thread-255 reproduction). Three disjoint conditions must discriminate.

**Implementation:** extend the existing `ThreadConvergenceGateError` pattern (ADR-013) with sub-codes. Each sub-code maps to a structured response shape for machine-parsability. Engineer adapter can log the discriminated form.

---

## Task 4 implementation sketch (post-ratification)

Engineer scope under Option A ratification:

### Phase 1 — Schema + FSM extension (~2-3 days)
- Add `awaiting_bilateral_seal` to `Thread.status` enum + Zod schemas
- Add FSM transitions in `ThreadStore.replyToThread` CAS transform
- Add `Thread.bilateralSealDeadline` field (ISO-8601 or derived from `closedAt + config.bilateralSealWindowMs`)
- Add `INV-TH24` to workflow-registry §Thread FSM invariants
- Amend ADR-013 / ADR-014 with the new state description

### Phase 2 — Cascade-firing behavior (~1-2 days)
- On architect reply with `converged=true` + cascade-spawning stagedAction: commit action, fire cascade, transition thread to `awaiting_bilateral_seal` (not `closed`)
- On engineer bilateral seal: transition to `converged` (bilateral successful path)
- On reaper timeout (no engineer seal): transition to `closed` (unilateral-cascade-complete path — audit-logged as "engineer did not bilateral-seal within window")

### Phase 3 — Error discrimination (~1 day)
- Split `"not found, not active, or not your turn"` into 3 sub-errors per §Error-surface above
- Update adapter-side log sites to surface discriminated forms

### Phase 4 — Tests (~1-2 days)
- Use mission-41 Wave 1 harness (if available at implementation time per mission-42 kickoff-decisions §Decision 3 discretionary upgrade):
  - **assertInvTH24** (new Wave 2 candidate): `awaiting_bilateral_seal` transitions correctly on cascade-spawn
  - Deterministic race reproduction: architect cascade fires → thread in `awaiting_bilateral_seal` → engineer reply lands (not rejected) → thread `converged`
  - Timeout path: architect cascade fires → no engineer reply → reaper transitions to `closed` after window
  - Error discrimination: 3 error cases each produce their specific sub-error
- Mission-internal tests if harness not yet available

**Total Task 4 effort:** ~5-8 engineer-days (revised from original brief's ~1 week investigation; re-scope reflects implementation scope rather than investigation).

---

## Success criteria (Task 4 completion)

1. Deterministic reproduction of H1 race (simulate architect cascade-spawning reply; confirm engineer bilateral seal succeeds in `awaiting_bilateral_seal`)
2. bug-23 flipped `investigating → resolved` with fixCommits + `fixRevision: mission-42`
3. Post-deploy observation: zero recurrence of `"not found, not active, or not your turn"` undifferentiated error in 7-day window (replaced by discriminated variants)
4. Zero regression on existing Threads 2.0 `converged` bilateral-seal path (thread-240-style flows still land in `converged`)
5. Workflow-registry + ADR-013 amendments committed
6. If harness available: `assertInvTH24` self-test passes

---

## Tele alignment

- **tele-6 Deterministic Invincibility** (primary) — cascade-race resolution removes a silent failure mode; FSM enforces the bilateral-seal window
- **tele-7 Resilient Agentic Operations** (primary) — error-surface discrimination is a direct tele-7 criterion-5 compliance fix (actionable error messages)
- **tele-2 Isomorphic Specification** (secondary) — `awaiting_bilateral_seal` state surfaces explicitly in workflow-registry; runtime isomorphic with spec

---

## Anti-goals (out of scope for this ADR)

1. **Multicast routing bilateral-seal semantics** — this ADR scopes to unicast routing (the observed bug class). Multicast sealing semantics under cascade-race is a separate question; defer to a future mission if the pattern emerges there.
2. **Retroactive thread state migration** — pre-existing `closed` threads from the bug-23 window are not back-migrated to `awaiting_bilateral_seal → closed`; they remain as-is. Only post-deploy threads benefit.
3. **Cascade-ordering changes** — the cascade still fires *before* the engineer seal (architect's action is committed first). Option A just defers terminal-closure. Cascade-deferral to *after* engineer seal is a different architectural change with broader implications (would affect all cascade semantics, not just the bilateral-seal case).
4. **Threads 2.0 Phase 3 work** — this ADR does not open Phase 3 scope; it's a targeted Phase 2 hardening.

---

## Director ratification questions (historical — answered 2026-04-23)

| # | Question | Ratified answer |
|---|---|---|
| 1 | Primary decision: Option A or B? | **Option A** (new FSM state) |
| 2 | Bilateral-seal window length? | **60 seconds** default (env-configurable) |
| 3 | Error-discrimination scope? | **Same Task 4** — bundled with Option A |
| 4 | INV-TH24 naming + semantics? | **Proposed wording accepted** as-is |

Preserved for historical record; canonical ratified decisions live in §Decision above.

---

## Filing metadata

- **Status:** Accepted (ratified 2026-04-23 by Director)
- **Implementation gate:** mission-42 release-gate signal (Director-issued, separate from this ratification; currently on hold per Director direction 2026-04-23)
- **Implementation authority:** engineer claims mission-42 Task 4 per mission-42 kickoff-decisions §Decision 1 sequencing (bug-27 → bug-28 → bug-22 → bug-23)
- **Spec amendments pending Task 4 implementation:** ADR-013 amendment, ADR-014 amendment, workflow-registry §Thread FSM table (new state + INV-TH24 row), Thread schema (new status enum + optional `bilateralSealDeadline` field)

---

*ADR v1.0 drafted + ratified 2026-04-23 per mission-42 kickoff-decisions §Decision 2b ADR-first protocol. Drafted in parallel with engineer mission-41 Wave 1 execution; ratified same day. Implementation awaits mission-42 release-gate.*
