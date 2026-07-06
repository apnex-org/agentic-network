# B3 / work-166 / idea-362 — Ground-Truth Supersession Audit

**Node:** work-166 (mission-104, track B / slice B3 — GATED, DESIGN-FIRST)
**Source idea:** idea-362 (*M-Tele-7-Silent-Failure-Hardening* — from the work-40 audit, 2026-06-27)
**Engineer:** greg (agent-0d2c690e) · **Date:** 2026-07-06 · **Base:** `main`
**Verdict:** **SUPERSEDED — document-and-drop, zero residual code.** All load-bearing findings are already fixed *and* regression-guarded.

This is the A4 zero-loss record of *why* B3 was closed with no build: the durable mapping from each idea-362 finding to the work that already resolved it.

## Axiom re-frame (constitutional transition)
idea-362 was framed on **tele-7** (Resilient Operations / no-silent-failure) — a telemetry verb **retired in mission-103** (the tele→axiom cut). The finding-set is re-evaluated here against the **resilient-ops axiom** (durable operations / no-silent-failure) it maps onto. The axiom is upheld by the fixes below; no new work is required to satisfy it.

## Scope discipline
The work-166 runbook scoped B3 to **only the two load-bearing findings — #3 and #5** ("Do NOT build the whole idea as-written; COMMIT ONLY the load-bearing"). Both are ground-truthed against current `main` below and found superseded. The remaining findings are confirmed moot or explicitly out-of-scope.

## Load-bearing findings

### #3 — repo-event-drainer self-heal + durable health state → CLOSED by **bug-190**
The idea's concern: `repo-event-handler.ts` — `sink.emit` failures logged/dropped **and** the drainer can terminate without restart → the repo-event bridge can *silently stop* delivering the PR/CI events the org runs on while producers keep writing.

- **"drainer can terminate without restart"** — structurally eliminated. `hub/src/policy/repo-event-handler.ts:116`: the `CreateMessageSink` is passed *into* the `PollSource` — *"bug-190 (A): inline delivery — the poll loop IS the delivery loop."* There is no longer a separate drainer coroutine that can die independently; a stalled poll loop is a source-level failure surfaced through `health().paused`.
- **"surface a durable health/error state"** — delivered. `RepoEventBridge.health()` (`repo-event-handler.ts:179-207`) rolls up `deliveryFailing` + `lastSuccessfulDelivery` across both sources (*bug-190 (d)*), wired to `/health` so a poll-healthy-but-delivery-failing bridge is no longer dark.
- **Regression guard:** `hub/test/health-endpoint.test.ts:91` — *"EXPOSES repo-event-bridge delivery health on /health when the bridge is wired (bug-190 d)"* (asserts `deliveryFailing` / `lastSuccessfulDelivery` surface on `/health`).

### #5 — pending-action re-entry idempotency → CLOSED by **bug-191**
The idea's concern: `watchdog.ts` + `pending-action-repository-substrate.ts` — poll re-entry/overlap can double-process expired pending-actions around attempt increments → noisy/inconsistent queue escalation.

- **Vector is watchdog-local.** The *only* callers of `pendingAction.listExpired` and `incrementAttempt` are the watchdog's own tick (`hub/src/policy/watchdog.ts:97,106`) — there is no second concurrent processor; the double-process risk is entirely tick-overlap.
- **Closed by the in-flight latch.** `watchdog.ts:77-84` — *bug-191*: a single-flight latch skips a tick while the prior one is in flight. Its comment names finding #5's failure mode verbatim: *"two ticks process the SAME expired pending-action → attemptCount 0→1→2 in one window (the CAS serializes the writes but RE-APPLIES the increment — not idempotent) → premature agent demotion / spurious CRITICAL Director escalation / duplicate audits + wakes."* The `incrementAttempt` CAS (`pending-action-repository-substrate.ts:187-193`) is unchanged — the fix removes the *overlap* rather than making the increment idempotent, which fully closes the finding since the watchdog is the sole processor.
- **Regression guard:** `hub/test/unit/watchdog.test.ts` — dedicated bug-191 test; an overlapping tick is suppressed (`listExpiredCalls === 1`; pre-fix would be `5`), and the latch releases once the prior tick settles.

## Drop-set (moot / out-of-B3-scope — confirmed)
- **#1** fire-without-fallback (`scheduled-message-sweeper`): moot under pulse-retirement (bug-162), as idea-362 itself flagged.
- **#4a** replay-before-LISTEN gap: **bug-187 closed** (work-35 / #385).
- **#4b** fire-and-forget watch *termination*: a separate work-35 gate-scope track, not B3.
- **#2 / #6 / #7** (notification-delivery surfacing / default-on-missing author / webhook-fallback surfacing): explicitly **runbook-scoped-out** of B3.

## Conclusion
Every finding B3 was scoped to build is already fixed **and** carries a regression guard (bug-190 → #3, bug-191 → #5). Building anything here would be redundant work the arc-target validation gate exists to prevent — the same supersession pattern that held for A2, A3, and C3. **B3 closes as document-and-drop.** idea-362 is resolved/superseded; the resilient-ops axiom is upheld by the existing fixes and their guards.
