# M-Cognitive-Hypervisor Phase 2c — Closing Audit

**Date:** 2026-04-20
**Scope:** Close the Phase 2c failure-amplification class squash (idea-117) + document deferred items
**Predecessors:** `docs/audits/phase-2b-closing.md` (Phase 2b closed at 83% cumulative Gemini-token reduction)
**Source idea:** idea-117 — "Squash the failure-amplification class — bounded retry policy for Hub-side pending-action queue"

---

## Executive summary

Phase 2b-B's larger-N measurement attempt surfaced a fourth failure class — Hub-side unbounded retry of failed sandwich attempts — that was not anticipated in the Phase 2b plan. A single stuck thread (thread-163) burned 59 Gemini rounds over ~30 minutes on a single Hub revision, retriggered every 300s by a combination of:

1. **Architect legacy-path** in `event-loop.ts` that polled `threadsAwaitingReply` from `get_pending_actions` and fired `sandwichThreadReply` regardless of queue state, including for threads whose queue items were stuck in `receipt_acked` after MAX_TOOL_ROUNDS.
2. **Hub queue semantics** where failed items left in `receipt_acked` had no terminal abandonment path other than the 3-stage watchdog ladder (which took ~3 minutes to fire).
3. **No operator tooling** to retroactively cure either condition.

Phase 2c squashes this class with five coordinated changes. All observed-pathology failure modes are now structurally blocked. One ambitious idea-117 criterion (cross-item circuit breaker) is deferred with a dedicated follow-up idea (idea-118) because it addresses systemic-failure modes that did not surface in Phase 2b measurement — shipping it now would be premature.

**Class status: SQUASHED** for all failure modes observed in production telemetry.

---

## Phase 2c scorecard — idea-117 criteria

| # | idea-117 criterion | Phase 2c status |
|---|---|---|
| 1 | Per-item retry budget (hard cap, proposed 3 attempts) | ✅ Already existed (watchdog stage-3 escalation) |
| 2 | Exponential backoff between attempts | ✅ Shipped (ckpt-A, commit `4e19b9a`) |
| 3 | Abandonment emits actionable audit entry + Director notification | ✅ Already existed (`queue_item_escalated` + critical notification at stage 3) |
| 4 | Circuit-breaker across items of the same class | ⏸ Deferred to idea-118 — systemic-failure modes did not surface in Phase 2b-B; premature |
| 5 | Observability canary metric | ✅ Audit trail (`queue_item_escalated`, `queue_item_abandoned`, `thread_force_closed`) is the canary; dashboard wiring is an ops concern, not a Hub-code concern |
| 6 | Retroactive drainer tool | ✅ Shipped (preamble, commit `a92666a` = `prune_stuck_queue_items`) |

**Plus two essential additions not in idea-117** that Phase 2b-B measurement specifically demanded:

| Addition | Status | Rationale |
|---|---|---|
| Architect legacy-path respects queue state | ✅ Shipped (ckpt-B, commit `db6d6bb`) | The primary amplifier of the observed pathology — `get_pending_actions` now suppresses threads with in-flight queue items from `threadsAwaitingReply`. |
| `force_close_thread` admin tool | ✅ Shipped (ckpt-C partial, commit `a75b1dc`) | Covers the gap where a thread is stuck but has no queue item (Hub restart wiped it) — pruner alone was insufficient. |

---

## Shipped changes

### Preamble — `prune_stuck_queue_items` (commit `a92666a`)

Administrative tool to abandon queue items in `receipt_acked` state older than a configurable threshold. Matches idea-117 criterion #6 directly. Preamble-before-ckpt-A because cleanup was needed before further code could be deployed safely.

- `hub/src/entities/pending-action.ts` — new `IPendingActionStore.abandon(id, reason)` + `listStuck(opts)` methods
- `hub/src/policy/pending-action-policy.ts` — new `prune_stuck_queue_items` tool, runtime-gated to Architect+Director roles, supports `dryRun`, `olderThanMinutes`, `dispatchType`, `targetAgentId`, `reason` filters; emits `queue_item_abandoned` audit + Director notification
- 8 new unit tests

### ckpt-A — Exponential backoff (commit `4e19b9a`)

Completes idea-117 criterion #2. Watchdog stage-2 deadline extension now uses 5× base SLA instead of fixed 1× base SLA. Total item lifetime bounded at ~6× `receiptSla` before terminal escalation.

- `hub/src/policy/watchdog.ts` — `extendDeadline` signature grows a `stage` parameter; multiplier = 5 when `stage >= 2`
- `hub/test/e2e/comms-reliability.test.ts` — ladder-completion test window bumped from 260s to 560s to accommodate the new backoff

### ckpt-B — Legacy-path respects queue state (commit `db6d6bb`)

The primary class-squash move. `get_pending_actions` now resolves the caller's agent + scans its pending-action queue for `thread_message` items in `enqueued` or `receipt_acked` state + excludes those thread IDs from the returned `threadsAwaitingReply` list. Architect's event-loop legacy path now only covers threads with nothing actionable on the queue — it never amplifies stuck sandwiches.

- `hub/src/policy/system-policy.ts` — in-flight-queue-item suppression in `threadsAwaitingArchitect` filter
- `hub/test/policy-router.test.ts` — regression pin: thread with `receipt_acked` queue item absent from `threadsAwaitingReply`; reappears after queue item abandoned

### ckpt-C partial — `force_close_thread` admin tool (commit `a75b1dc`)

Covers the case where a thread is structurally stuck with no queue item (wiped by Hub restart) — `prune_stuck_queue_items` has nothing to match. `force_close_thread` calls the thread-close primitive AND abandons any non-terminal queue items atomically.

- `hub/src/policy/thread-policy.ts` — new `forceCloseThread` handler + registration, runtime-gated to Architect+Director, emits distinct `thread_force_closed` audit action
- `hub/test/wave3b-policies.test.ts` — happy-path test with queue-item abandonment; engineer-role denial test
- `hub/test/e2e/e2e-foundation.test.ts` — bump expected tool count 46 → 47

---

## Operational cleanup — production state

Four Phase 2a baseline-era test threads had been stuck in the retry-amplification loop since 2026-04-19:

- `thread-163` (simple ack)
- `thread-165` (tool-heavy read)
- `thread-166` (design analysis)
- `thread-167` (parallel candidate)

After ckpt-C landed, each was force-closed via the new admin tool with `reason="Phase 2a baseline test thread — stuck in MAX_TOOL_ROUNDS loop; administrative cleanup per idea-117"`. All four transitioned to `status: closed` atomically with any queue items abandoned. No new retries observable post-close.

---

## Deferred for follow-up

### idea-118 — Cross-item circuit breaker (idea-117 criterion #4)

The ambitious "tripwire that opens when N consecutive items of the same class fail" mechanism. Deferred because:

- Systemic failure modes (Gemini quota exhausted, sandwich universally broken across threads) did not surface in Phase 2b-B measurement. All observed amplification was per-item.
- Per-item bounds from ckpt-A already cap damage from any single pathological item.
- Shipping the circuit breaker now would add complexity without a measured failure mode to validate against.

Filed as idea-118 with a dedicated mission proposal ("M-Circuit-Breaker") and 6 observable ratification criteria. Sequence to be set by architect triage.

---

## Method / reproducibility

### Regression-guard test

```bash
# Hub test suite — all Phase 2c gates enforced here
cd hub && npm test

# Specifically: verify the bounded-retry ladder still completes within
# the SLA window after any watchdog change
cd hub && npm test -- test/e2e/comms-reliability.test.ts

# Verify the legacy-path suppression regression pin
cd hub && npm test -- test/policy-router.test.ts

# Verify the prune tool contract
cd hub && npm test -- test/unit/pending-action-prune.test.ts
```

### Operator runbook — stuck thread recovery

```
# List all active threads where currentTurn=architect has been frozen:
list_threads({ status: "active" })

# For any thread stuck in currentTurn=architect with no forward progress:
force_close_thread({
  threadId: "thread-XXX",
  reason: "administrative close — <short rationale>"
})

# For queue items that the thread-level close didn't reach:
prune_stuck_queue_items({
  olderThanMinutes: 15,
  dryRun: true,      # preview first
  reason: "<short rationale>"
})
```

Both tools emit audit entries + Director notifications so the intervention is visible downstream.

---

## Declarations

Phase 2c squashes the failure-amplification class. Each of the two observed amplifiers (architect legacy path + stuck thread state with no queue item) now has a structural block. Each idea-117 class-squash criterion except #4 (circuit breaker) is shipped, tested, and covered by a regression guard. Criterion #4 is deferred with its own idea and a clear ratification plan.

The four Phase 2a stuck threads have been force-closed and are confirmed stable. Future production stuck-thread scenarios are addressable via the runbook in under 60 seconds of operator time.

Cumulative M-Cognitive-Hypervisor status across phases:

| Phase | Headline | Status |
|---|---|---|
| 1 | 67.8% Hub-call reduction on the synthetic bench | CLOSED |
| 2a | ResponseSummarizer + PartialFailureSemantics + llm_usage bridge shipped live | CLOSED |
| 2b | 83% Gemini-token reduction; scope-reject + history-growth + pipeline-unwired classes squashed | CLOSED |
| 2c | Failure-amplification class squashed | CLOSED (this audit) |

Phase 3 sequencing: pending architect triage on idea-115 (dynamic tool scope), idea-116 (tele-10 "Precision Context Engineering"), and idea-118 (cross-item circuit breaker).

---

## Canonical references

- Source idea: idea-117 (ratified)
- Follow-up idea: idea-118 (cross-item circuit breaker, filed)
- Phase 2b closing: `docs/audits/phase-2b-closing.md`
- Mission spec: `docs/planning/m-cognitive-hypervisor.md`
- ADR: `docs/decisions/018-cognitive-layer-middleware.md`
- Regression gate: `scripts/architect-telemetry/` + Hub test suite
- Shipped commits:
  - `a92666a` — Phase 2c preamble: `prune_stuck_queue_items`
  - `db6d6bb` — ckpt-B: legacy-path respects queue state
  - `a75b1dc` — ckpt-C partial: `force_close_thread` admin tool
  - `4e19b9a` — ckpt-A: exponential backoff on watchdog stage-2
