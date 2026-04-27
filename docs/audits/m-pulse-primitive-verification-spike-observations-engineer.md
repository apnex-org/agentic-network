# M-Pulse-Primitive-Verification-Spike — Live Observation Log

**Mission:** mission-60
**Activated:** 2026-04-27 ~03:01Z
**Engineer:** greg / eng-0d2c690e7dd5
**Architect:** lily / eng-40903c59d19f
**Channel:** thread-378 (real-time observation reporting back to architect)

---

## W1 — Setup + first-fire baseline

### T+0 (~03:01Z) — Activation

Director fired release-gate via `update_mission(mission-60, status="active", pulses={...})`. Pulses populated correctly (verified at T+7min via `get_mission`):

```
engineerPulse: 300s / short_status / missedThreshold=3 / firstFireDelaySeconds=300 / precondition mission_idle_for_at_least(seconds=300)
architectPulse: 600s / short_status / missedThreshold=3 / firstFireDelaySeconds=600 / precondition mission_idle_for_at_least(seconds=600)
```

Activation occurred ahead of architect's preflight surface — Director fast-path; preflight became documentation rather than gate. Captured in preflight addendum.

### T+0 → T+9min (03:01Z → ~03:10Z) — Engineer in preflight authoring; thread-378 dispatch unprocessed

Architect dispatched W1 directive on thread-378 at 02:58:07Z (pre-activation; Hub queued for delivery). Engineer was authoring preflight throughout; **received zero SSE notifications during this window**. Drain at 03:07:52Z surfaced ONLY the thread-378 architect dispatch — no pulse-related queue items.

### T+8min (~03:08Z) — First get_mission state capture

```
engineerPulse.lastFiredAt = 2026-04-27T02:59:32.076Z   (= createdAt + firstFireDelaySeconds; FIRST FIRE bookkeeping-wise)
engineerPulse.missedCount = undefined
engineerPulse.lastResponseAt = undefined
architectPulse.lastFiredAt = undefined                  (NOT YET FIRED bookkeeping-wise)
```

### T+10min (~03:10Z) — First W1 reply on thread-378

Engineer replied to architect with W1 round-2 short_status reporting the bookkeeping-confirmed-but-SSE-not-surfaced reproduction. Path 1 vs Path 2 decision raised to architect (continue collecting data vs surface to Director immediately).

### T+12min (~03:11Z-03:13Z) — Second get_mission state capture

```
engineerPulse.lastFiredAt = 2026-04-27T03:04:32.076Z   (advanced +300s; PULSE #2 fired bookkeeping-wise)
engineerPulse.missedCount = 1                          (incremented; pulse #1 unacked past grace window)
engineerPulse.lastResponseAt = undefined               (still no ack from engineer side; SSE never surfaced for me to ack)
architectPulse.lastFiredAt = undefined                 (STILL not fired bookkeeping-wise; +7min past expected)
```

Drain returned empty for pulses (consistent with `delivery: push-immediate` SSE-only model).

---

## Findings — primary

### F1. Pulse-SSE-not-surfaced reproduction (PRIMARY mission-59 hypothesis verified)

`engineerPulse` fires at the Hub bookkeeping level on schedule (lastFiredAt advances per `intervalSeconds`), but **the SSE notification does NOT surface as a renderable notification in the engineer Claude Code session**. Two pulse fires (T+5min, T+10min from createdAt) have produced zero observable events in the operator session.

**Implication:** the operator-visibility path (per mission-57 Design v1.0 §5 wire format) is not closing the loop end-to-end. The Hub-side mechanism works; the operator-side delivery does not.

This is exactly mission-59's pulse-fire-never-observed symptom — empirically reproduced under controlled verification conditions with mission-60.

### F2. drain_pending_actions confirmed empty for pulses (mission-59 hypothesis verified)

Pulse Messages do NOT enqueue as pending-actions queue items. Confirmed across multiple drain calls during W1. Consistent with `pulse-sweeper.ts:307` (`delivery: "push-immediate"`) — pulses are SSE-only push, not queue-ack-flow.

### F3. missedCount auto-incrementing without operator action

Because pulses fire at Hub but never surface to the engineer, `lastResponseAt` never updates, the 3-condition guard at `pulse-sweeper.ts:332-348` triggers naturally:
- pulseFiredAtLeastOnce ✓
- noAckSinceLastFire ✓
- graceWindowElapsed ✓ (at lastFiredAt + intervalSeconds + graceMs = +330s)

**At missedCount=3, threshold-escalation will fire** an architect-routed Message per `pulse-sweeper.ts:386-406`. **W3 missed-detection scenario is happening unintentionally as part of W1** — this is itself a verification datum (the missed-detection mechanism works; the engineer-acknowledgment path is what's broken upstream).

Path: at current cadence, missedCount will hit 3 at approximately T+15-20min if no operator intervention.

### F4. lastFiredAt encodes scheduled-fire-time, NOT actual sweeper-tick time (discovery)

Per `pulse-sweeper.ts:286`: `const fireAt = new Date(baseFireMs).toISOString()`. So `lastFiredAt = createdAt + firstFireDelaySeconds` exactly (at first fire), not the actual moment the sweeper invoked firePulse. Useful for cadence reasoning; less useful for sweeper-latency-debugging. **W5 methodology note candidate.**

### F5. force_fire_pulse admin tool absent (Q3 reframe confirmed)

`grep -r 'force_fire' hub/src/` returns empty. Confirms architect's intervention lever is `update_mission(pulses={X: {..., lastFiredAt: <old-timestamp>}})` per Q3 ratification.

### F6. Architect pulse #1 NOT fired despite cadence window open

Expected first fire at `createdAt + firstFireDelaySeconds = 03:04:32Z`. At ~03:11Z (+7min past expected), `architectPulse.lastFiredAt` remains undefined.

**Hypothesis:** `mission_idle_for_at_least(seconds=600)` precondition keeps deferring because mission activity (thread-378 messages, get_mission calls) keeps bumping the idle clock. Last engineer reply at 03:10Z → next idle-met at 03:20Z. But this interpretation depends on what counts as "activity" in the precondition's idle definition (W1 sub-objective; needs `preconditions.ts` inspection to confirm precisely).

**Alternative hypothesis:** precondition logic differs between engineer vs architect pulse evaluation — would be a code path divergence worth surfacing.

### F7. Pulse-payload envelope NOT capturable from engineer side

W1 sub-objective "capture pulse-payload envelope verbatim" is BLOCKED — engineer cannot capture an envelope that never arrived in session. Code-side envelope shape (per `pulse-sweeper.ts:302-316`) is documented in preflight; runtime-rendered envelope shape is what's broken at the visibility boundary.

---

## Findings — secondary

- **Engineer-context-wait scaffold pattern:** Engineer authoring preflight (a calm, non-Hub-interactive task) for ~9min produced zero side-channel arrivals. The Threads 2.0 architect-dispatch DID surface (system reminder caught me); pulses did not. Differential: dispatch goes through queue + thread_message event; pulses go through SSE-direct push-immediate. Different delivery paths; only one is reaching the operator.
- **ScheduleWakeup not yet exercised:** Engineer plan was to ScheduleWakeup proactively at T+4/+5/+6 per Q2 ratified design. Pulse-not-surfacing rendered this scaffold moot for first pulse — engineer never had a baseline-success to schedule against. Architect-fallback (thread message keepalive) kept engineer engaged instead.

---

### T+13min (~03:14Z) — Architect-side Hub log captured

Architect dropped the Hub-side log telemetry into thread-378:

```
[Notify] idea_submitted delivered via SSE to 2 session(s)
[Notify] mission_created delivered via SSE to 2 session(s)
[Notify] mission_activated delivered via SSE to 2 session(s)
[PulseSweeper] Fired engineerPulse for mission-60 at 2026-04-27T02:59:32.076Z (cadence 300s)
[PulseSweeper] Missed engineerPulse on mission-60 (count=1/3)
[PulseSweeper] Fired engineerPulse for mission-60 at 2026-04-27T03:04:32.076Z (cadence 300s)
```

**Differential signal:** Other entity events log `[Notify] X delivered via SSE to N session(s)`. Pulses log only `[PulseSweeper] Fired ...` — NO equivalent SSE-delivery line. Hub-side substrate (sweeper + fire + bookkeeping + missed-count detection) all work; **the SSE delivery step is missing for pulse Messages specifically**.

### T+14min (~03:14Z) — Engineer code-side root-cause inspection

Per architect Path 1+ directive: inspected adapter + Hub source for SSE-push wiring. **Root cause identified.**

### T+19min (~03:20Z) — Force-fire test attempted from engineer; auth-denied

Per architect ratification of engineer Fix #1 lean + (a)-then-(b) directive: engineer attempted force-fire test via `update_mission(missionId="mission-60")` (no args; just probing).

**Result:**
```
{ "error": "Authorization denied: tool 'update_mission' requires role 'architect', but caller is 'engineer'" }
```

**Q3 verification finding:** the architect-fallback intervention mechanism (`update_mission(pulses={lastFiredAt:<old>}) IS the force-fire mechanism`) is **architect-role-gated at the MCP boundary**. Engineer cannot run force-fire — correctly so per role-boundary discipline. Architect must run the test.

**Schema-description gap (minor finding for W5):** `update_mission` schema description doesn't enumerate `pulses` — but the handler accepts pulses (Director's activation at ~03:01Z used `update_mission(status="active", pulses={...})` successfully). Worth a documentation/methodology note.

Test handed back to architect for execution at architect tier.

### T+20min (~03:21Z) — Architect-side force-fire test result: STRIPPED

Architect ran `update_mission(mission-60, pulses={engineerPulse: {..., lastFiredAt: "2026-04-27T01:00:00.000Z"}, architectPulse: {...}})` from architect tier:

```
SENT:    engineerPulse.lastFiredAt = "2026-04-27T01:00:00.000Z"  (force-old timestamp)
RECEIVED: engineerPulse.lastFiredAt = "2026-04-27T03:09:32.076Z"  (NEW value from sweeper)
         engineerPulse.missedCount = 2  (was 1; pulse #2 also went past grace)
```

**`lastFiredAt` STRIPPED at policy boundary.** Sweeper continued firing on its own cadence (03:04:32 → 03:09:32 = 5min interval honored independently). The architect's force-fire call had no observable effect on the sweeper-managed fields.

## Findings — root cause #2 (Gap #2)

### F11. NO architect-fallback mechanism exists (Q3 reframe verified WRONG)

Per `mission-policy.ts:508` source comment:
> pulses-update preserves sweeper-managed bookkeeping (lastFiredAt / lastResponseAt / missedCount / lastEscalatedAt); **only PulseSweeper writes those via direct repository updates that bypass this MCP surface.**

This is **intentional design** — sweeper-managed fields are protected from MCP-callers. The Q3 reframe ratified at thread-377 round-2 ("`update_mission(pulses={lastFiredAt:<old>}) IS the force-fire mechanism`") **does not work** — it's structurally blocked at the MCP-policy boundary.

**Implication:** there is NO MCP-tool path to force-fire a pulse. Architect cannot recover from:
- Missed-pulse escalation pause (after `missedCount >= missedThreshold`, pulse pauses; cannot be resumed)
- Cadence drift
- Sweeper-stuck conditions
- Bookkeeping inspection-and-repair scenarios

Combined with Gap #1 (SSE-delivery): **pulses are write-only from the operator perspective today.** Hub fires them; operators can't see them and can't intervene.

### F12. Sweeper-cadence honored independently of MCP traffic

Empirical data: lastFiredAt advanced 02:59:32 → 03:04:32 → 03:09:32. Three fires at 5min intervals. The sweeper continues to tick + fire bookkeeping-wise regardless of operator activity OR MCP-side update_mission attempts. **Cadence semantics are sound at the Hub-side substrate**; only the operator-visibility + force-fire layers are broken.

## Verification mission status — TWO architectural gaps

| Verification objective | Status |
|---|---|
| Pulse fires bookkeeping-wise on schedule | ✅ VERIFIED (3 fires at 300s cadence) |
| Operator-visibility SSE delivery | ❌ BROKEN — Gap #1 (PulseSweeper bypasses Path A + Path B) |
| Force-fire architect-fallback mechanism | ❌ BROKEN — Gap #2 (sweeper-managed fields stripped at policy boundary; NO admin tool exists) |
| Bookkeeping convention (scheduled-time, not tick-time) | ✅ DISCOVERED |
| force_fire_pulse admin tool exists | ✅ CONFIRMED ABSENT (greps empty) |
| update_mission(pulses.lastFiredAt=<old>) AS force-fire | ❌ FAILS — fields stripped (Q3 reframe at thread-377 was wrong) |
| drain_pending_actions empty for pulses | ✅ CONFIRMED |
| Missed-count increments past grace window | ✅ VERIFIED (0→1→2) |
| Cadence interval honored | ✅ VERIFIED (5min each fire, independent of activity) |
| Architect-role-gating on update_mission | ✅ VERIFIED (engineer denied) |
| Sweeper-managed-field-protection | ✅ VERIFIED (lastFiredAt strip-on-write) |
| Precondition deferral (idle-window) | ✅ VERIFIED indirectly (architect activity defers architectPulse) |
| Bilateral cross-channel mid-reply pulse fire | ⚠️  IRRELEVANT until SSE-delivery fixed |
| Hub-restart bookkeeping survival (W4) | ⏳ DEFERRED (orthogonal-to-fix-forward) |
| Mission-lifecycle-state interaction (W5) | ⏳ TO TEST AT MISSION-60 CLOSE |
| update_mission schema description | ⚠️ GAP — doesn't enumerate `pulses` field |

## Fix-forward scope expanded

**Original Idea:** M-Pulse-Message-SSE-Push-Wiring (Fix #1 only)
**Expanded:** **M-Pulse-Primitive-Surface-Closure** (architect's call):
- Fix #1 — wire SSE push from PulseSweeper.firePulse (Path B `notifyEvent` reuse OR Path A `dispatch` symmetric)
- Fix #2 — add force-fire admin tool OR allow architect to override sweeper-managed fields with explicit opt-in flag
- Fix #3 — adapter renderer `pulse_fired` event-kind handler (claude-plugin + opencode-plugin shims; dist-regen per PR #99 + idea-208)
- Fix #4 — schema description for `update_mission` to enumerate `pulses`

M-firm sizing (~1-2 eng-days). Architect to file at convergence.

---

## Findings — root cause

### F8. PulseSweeper bypasses BOTH SSE-push paths (ROOT CAUSE)

The Hub has **two distinct SSE-push paths**, and PulseSweeper invokes neither:

**Path A — `message-policy.ts:208-221`** — fires `ctx.dispatch("message_arrived", {message}, selector)` after createMessage commits a `delivery: "push-immediate"` Message. Triggered by the `create_message` MCP tool handler (LLM-authored Messages).

**Path B — `hub-networking.ts:316-334`** — `notifyEvent(event, data, targetRoles)` calls `emitLegacyNotification` (writes Message via direct store) THEN `notifyConnectedAgents` (does the SSE push). Triggered by entity events (idea_submitted, mission_created, mission_activated). Produces the `[Notify] X delivered via SSE` log line.

**Path C — `pulse-sweeper.ts:280-323` firePulse** — calls `messageStore.createMessage` direct. **No `ctx.dispatch` call** (PulseSweeper's stripped IPolicyContext per `pulse-sweeper.ts:65-70` excludes transport). **No `notifyEvent` call** (sweeper doesn't go through hub-networking). **Pulse Message persists; no SSE push fires.**

The boundary is documented explicitly in `notification-helpers.ts:35-43`:

> SSE delivery (no double-send): the W1a push-on-create path fires inside the `create_message` MCP **tool handler** (in `message-policy.ts`), NOT inside `messageStore.createMessage` itself. This helper invokes `messageStore.createMessage` directly (not via the policy router), so W1a does not auto-fire.

`emitLegacyNotification` consumers (Path B) compensate via separate `notifyConnectedAgents` call. **PulseSweeper has no equivalent compensation.**

### F9. Mission-57 W2 Design oversight

The pulse Message was designed with `delivery: "push-immediate"` (per `pulse-sweeper.ts:307`) on the assumption that this flag triggers SSE delivery. But push-immediate is just a Message-store flag — actual SSE push is performed by **Path A's `ctx.dispatch` call**, which lives at the MCP-tool layer that PulseSweeper bypasses. The flag-vs-action conflation is the design oversight.

### F10. Fix candidates

1. **Add `notifyEvent` call in PulseSweeper.firePulse** (engineer lean) — after createMessage + bookkeeping update, call `hub-networking.notifyEvent(event="pulse_fired", data={...}, targetRoles=[targetRole])`. Reuses Path B; one-line addition + sweeper-context provider must expose hub-networking.
2. **Move SSE-push side-effect into `messageStore.createMessage`** — centralizes for all callers; breaks the deliberate "no double-send" discipline.
3. **Add `dispatch` capability to `PulseSweeperContextProvider.forSweeper()`** — sweeper directly fires the same `ctx.dispatch("message_arrived", ...)` event as Path A. Symmetric with MCP-tool path.

Architecturally cleanest: #3. Lowest-friction: #1.

---

## Findings — secondary (T+14min addendum)

- **Bilateral-thread-as-observation-channel meta-property:** Every operator reply on the verification thread bumps `lastResponseAt`, deferring the next pulse via `mission_idle_for_at_least` precondition. The very act of observing the system reveals an idle-window deferral that prevents observation of subsequent pulses. **Methodology calibration #21 datum.**
- **architectPulse #1 still un-fired at T+14min** — architect's active diagnostic session keeps bumping idle clock; precondition continually deferred. **Bilateral-cross-channel test result before fix: architect-active-diagnostic-session inadvertently blocks own pulse fires.** Worth W5 audit annotation.

---

## Verification mission status

| Verification objective | Status |
|---|---|
| Pulse fires bookkeeping-wise on schedule | ✅ VERIFIED |
| Operator-visibility path delivers pulse via SSE | ❌ FAILS — root cause Path C bypass |
| Bookkeeping convention (scheduled-time, not tick-time) | ✅ DISCOVERED |
| force_fire_pulse admin tool absence | ✅ CONFIRMED ABSENT |
| update_mission(pulses.lastFiredAt=<old>) force-fire reframe | ✅ CONFIRMED (Q3 correct) |
| drain_pending_actions empty for pulses | ✅ CONFIRMED |
| Missed-count increments past grace window | ✅ VERIFIED (0→1) |
| Precondition deferral (idle-window) | ✅ VERIFIED indirectly (every reply defers) |
| Bilateral cross-channel (mid-reply pulse fire) | ⚠️  IRRELEVANT until SSE delivery fixed |
| Hub-restart bookkeeping survival (W4) | ⏳ DEFERRED (orthogonal-to-fix-forward) |
| Mission-lifecycle-state interaction (W5) | ⏳ DEFERRED |

**Director constraint #4 ("normal-pulse-success FIRST") provably not met** — architectural gap means baseline pulse success cannot be achieved without code fix. W4 + W5 become orthogonal until Path C SSE wiring is repaired.

---

## Observation log methodology notes

- **Live-stream cadence:** updates appended after each get_mission call + each thread reply
- **Format:** T+offset (absolute UTC) — event/finding shorthand — implication
- **Frozen at W5 close:** this log + closing audit at `m-pulse-primitive-verification-spike-audit.md` form the verification artifact

---

*Log started 2026-04-27 ~03:13Z. Root cause identified at ~03:14Z. Architect surfacing to Director in parallel; engineer holding for direction (force-fire empirical confirmation OR W5 close OR fix-forward dispatch).*
