# M-Pulse-Primitive-Verification-Spike (mission-60) Closing Audit

**Mission:** mission-60 M-Pulse-Primitive-Verification-Spike
**Class:** Spike (verification)
**Author:** lily / architect
**Date:** 2026-04-27
**Status at close:** completed
**Outcome:** **VERIFICATION SUCCESS** — primary objectives met; **TWO architectural gaps identified** at architectural layer; fix-forward scope filed as new Idea
**Retrospective mode:** SKIP (Spike class default per `feedback_retrospective_modes.md`; calibration captured in this audit + observation log)

---

## Mission outcome

**Verification mission delivered its purpose.** Primary objectives met. Two architectural gaps identified with scoped fix paths. Director constraint #4 (Hub-restart test) intentionally not exercised — superseded by gap findings making W4 orthogonal-to-fix-forward.

This is the verification mission **succeeding**, not failing. The mission's job is to find gaps + scope fixes. Done.

## Lifecycle execution timeline

| Phase | Time | Artifact |
|---|---|---|
| Director directive (test mission pulse) | ~02:30Z | "Determine if we have an idea for this and commence mission preparation" |
| Idea filing | ~02:33Z | idea-212 |
| Design thread-377 (Survey-bypassed; 3rd canonical) | 02:48Z → 02:54Z | bilateral 3-round convergence |
| propose_mission cascade fired | 02:54:32Z | mission-60 created status=proposed |
| idea-212 → incorporated | ~02:55Z | linked to mission-60 |
| Director release-gate fired | 03:01-03:02Z | `update_mission(status="active", pulses={300s/600s, missedThreshold=3})` |
| W1 thread-378 dispatched | 03:02Z | full directive + verification scaffold |
| First engineerPulse fire (bookkeeping) | 02:59:32Z (baseline) | sweeper logged "Fired engineerPulse for mission-60 at 02:59:32.076Z (cadence 300s)" |
| Greg root-cause finding | 03:16Z | adapter/Hub-side code inspection identifies Path C bypass |
| Force-fire test (architect) | 03:21Z | confirms Gap #2 — sweeper-managed fields stripped at policy boundary |
| Closing audit + convergence | ~03:25Z | this document |
| Mission-60 → completed | ~03:25Z | status flip |

**Total mission span:** ~55 minutes idea-to-close (within S sizing target).

## Verification scorecard

### What WORKS ✅

| Capability | Evidence |
|---|---|
| PulseSweeper firing on schedule | 3 fires observed at clean 5min intervals: 02:59:32, 03:04:32, 03:09:32 |
| Cadence-interval honoring | lastFiredAt advances by exactly intervalSeconds (300s) |
| Bookkeeping persistence | lastFiredAt + missedCount survive across multiple fire cycles |
| Missed-detection mechanism | missedCount incremented 0→1→2 across un-acked fires |
| Mission-state filter | sweeper only iterates active missions per pulse-sweeper.ts:142 |
| Architect-role-gating on update_mission | engineer call returned `Authorization denied: tool 'update_mission' requires role 'architect'` |
| Sweeper-managed-field protection | architect's lastFiredAt input STRIPPED at policy boundary (intentional design per mission-policy.ts:508) |
| drain_pending_actions correctly EMPTY for pulses | confirms pulses are SSE-only, not queue-based |
| `mission_idle_for_at_least` precondition deferral | architectPulse never fired bookkeeping-wise due to architect activity continuously bumping idle clock |
| Bookkeeping convention | `lastFiredAt` records baseline due-time (`createdAt + firstFireDelaySeconds`), NOT wall-clock fire-time |

### What's BROKEN ❌

#### Gap #1 — Operator-visibility SSE delivery missing

**Symptom:** Both engineer and architect sessions received zero SSE notifications when pulses fired. Hub-side bookkeeping confirms 3 engineerPulse fires; neither operator session observed any pulse Message.

**Root cause:** PulseSweeper.firePulse bypasses both Hub SSE-push paths.

```
Path A — message-policy.ts:208-221 (MCP-tool boundary)
  await ctx.dispatch("message_arrived", { message }, selector);
  → fires SSE only when caller goes through create_message MCP tool
  
Path B — hub-networking.ts:316-334 (legacy entity-event)
  await this.notifyConnectedAgents(event, data, targetRoles, notification.id);
  → produces "[Notify] X delivered via SSE to N session(s)" log
  → fires for idea_submitted, mission_created, mission_activated
  
Path C — pulse-sweeper.ts:280-323 (PulseSweeper.firePulse)
  await this.messageStore.createMessage({ kind: "external-injection", delivery: "push-immediate", ... });
  → uses neither Path A (no MCP-tool boundary) nor Path B (no notifyEvent call)
  → pulse Message persists; NO SSE push occurs anywhere
```

**Documented at `notification-helpers.ts:35-43`:**
> SSE delivery (no double-send): the W1a push-on-create path fires inside the `create_message` MCP **tool handler** (in `message-policy.ts`), NOT inside `messageStore.createMessage` itself.

**Mission-57 W2 design oversight:** pulse Message envelope used `delivery: "push-immediate"` on the assumption that flag triggers SSE — but the flag is just a Message-store hint; SSE push fires from caller-side code that PulseSweeper bypasses.

#### Gap #2 — Architect-fallback force-fire mechanism missing

**Symptom:** Architect attempted `update_mission(mission-60, pulses={engineerPulse: {..., lastFiredAt: "2026-04-27T01:00:00.000Z"}})` to force pulse re-fire. Response showed lastFiredAt "2026-04-27T03:09:32.076Z" (sweeper's natural advancement), NOT the forced old timestamp. The lastFiredAt input was silently STRIPPED.

**Root cause:** Per `mission-policy.ts:508` description (intentional design):
> "pulses-update preserves sweeper-managed bookkeeping (lastFiredAt / lastResponseAt / missedCount / lastEscalatedAt); only PulseSweeper writes those via direct repository updates that bypass this MCP surface."

There is **NO MCP-tool path** to force-fire a pulse. Q3 reframe at thread-377 ("update_mission(pulses.lastFiredAt=<old>) IS the force-fire mechanism") was incorrect.

**Combined implication:** Pulses are **write-only from operator perspective today**. Hub fires pulses on schedule; operators can't see them (Gap #1) AND can't intervene if anything goes wrong (Gap #2). The architect cannot recover from missed pulses, escalation pause, or timing drift.

### Schema-description gap (minor)

`update_mission` MCP-tool description: *"update a mission's status, description, document reference, or plannedTasks"* — does NOT enumerate `pulses` field. Handler accepts pulses (Director's activation passed pulses through), but the description doesn't surface it. Discoverability gap. Captured in fix-forward scope as Fix #4.

## Director constraints — verification

| Director constraint | Status |
|---|---|
| #1 — Engineer awareness (engineer waits for pulse with mission context) | ✅ engineer maintained context-aware wait + reported observations + ScheduleWakeup proactive scaffold worked |
| #2 — Architect fallback (intervention path required) | ❌ verified ABSENT (Gap #2) — fix-forward required |
| #3 — Troubleshooting + logs + analysis | ✅ Hub log + bookkeeping inspection + adapter/Hub code inspection ALL produced actionable diagnostic data; root cause identified at architectural layer |
| #4 — Hub-restart test (after baseline success) | ⚠️ NOT EXERCISED — superseded by gap findings; baseline-success not achievable without Gap #1+#2 fixes |

## 4 anti-goals — preservation status

1. ✅ NO production substrate work — verification only
2. ✅ NO scope creep into idea-211 fixes — orthogonal gaps surfaced
3. ✅ NO breakage of other missions' pulses — single-mission scope held
4. ✅ NO destructive ops outside W4 — Hub-restart not executed
5. ✅ NO methodology-doc edits during W1-W4 — deferred to follow-on
6. ✅ NO false-positive successes — gaps surfaced cleanly + framed honestly

## Calibration data captured (calibration #21 + meta-observations)

### Bookkeeping convention (W5 methodology note candidate)

`lastFiredAt` encodes **scheduled** fire-time (`baseFireMs = mission.createdAt + firstFireDelaySeconds`), NOT actual sweeper-tick time. Per `pulse-sweeper.ts:286`. Useful for cadence reasoning; less useful for sweeper-latency-debugging. Worth documenting in pulse-primitive methodology doc.

### Bilateral-thread-as-observation-channel chicken-and-egg property

Every operator reply on the verification thread RESETS the `mission_idle_for_at_least` precondition clock. So observing pulses requires NOT-replying. But not-replying disconnects the bilateral coordination. **Methodology calibration:** verification missions of pulse-like primitives must use OOB observation channels (Hub logs, periodic bookkeeping snapshots, separate monitoring sessions), not the in-thread channel. architectPulse never fired bookkeeping-wise during the entire mission for this reason.

### "Verification SUCCESS" framing for find-the-gap missions

This is the **first canonical Spike-class mission** with the outcome "primary objectives met; gaps identified." The framing matters:
- Mission goal was VERIFY pulse primitive
- Verification revealed gaps
- That's verification SUCCESS, not failure
- Mission-completed status is correct
- Fix-forward becomes its own next mission

Worth codifying as Spike-class outcome pattern. Future Spike missions may end the same way.

### Pattern-replication discipline holds

Survey-bypass + thread-as-Design-artifact 3rd canonical execution clean — design phase took ~6min total (2 round-trips); engineer round-2 substantively converged + added 4 verification objectives + gave clean fix lean. Pattern continues to scale.

## Fix-forward scope (filed as new Idea)

**M-Pulse-Primitive-Surface-Closure** — 4 fixes scoped:

1. **Fix #1 — SSE-push wiring:** add `notifyEvent("pulse_fired", {message, missionId, pulseKey, ...}, [targetRole])` call in `PulseSweeper.firePulse` after `updatePulseBookkeeping`. Reuses Path B (legacy entity-event SSE; demonstrably works for `mission_activated` etc.). Lowest-friction; one-line addition + sweeper-context provider exposes hub-networking handle.
2. **Fix #2 — Force-fire admin tool OR architect-override:** add either a dedicated `force_fire_pulse(missionId, pulseKey)` admin tool, OR add an `_overrideSweeperFields: true` opt-in flag on `update_mission(pulses=...)` that allows architect-role to bypass the strip-on-write logic.
3. **Fix #3 — Adapter renderer:** add `pulse_fired` event-kind handler in claude-plugin + opencode-plugin shims to surface as system reminder (`<channel ... source="hub" ... pulseKind="status_check" ...>`). Includes dist-regen for both adapters.
4. **Fix #4 — Schema description:** update `update_mission` MCP-tool description to enumerate `pulses` field for discoverability.

**Sizing:** M-firm (~1-2 eng-days; substrate-cleanup-wave-adjacent class).

**Mission class:** Substrate-introduction (Fix #1+#2 add new SSE event + new admin path) + structural-inflection (Fix #2 changes architect intervention semantics).

## Cross-references

- thread-377 (Design v1.0)
- thread-378 (W1 dispatch + observation channel)
- idea-212 (incorporated → mission-60)
- mission-57 M-Mission-Pulse-Primitive (shipped the primitive — design oversight at W2)
- mission-59 M-Documents-Folder-Cleanup (1st pulse-adoption attempt; pulse-no-fire root cause now identified)
- idea-211 M-Pulse-Defaults-Auto-Injection + Tool-Catalog-Refresh (orthogonal gaps; auto-injection separate from this mission's findings)
- New Idea (filed at convergence): M-Pulse-Primitive-Surface-Closure
- mission-58 M-Adapter-Config-Rename + mission-59 M-Documents-Folder-Cleanup (Survey-bypass + thread-as-Design-artifact 1st + 2nd canonical executions; this mission is 3rd)
- `hub/src/policy/pulse-sweeper.ts` (PulseSweeper implementation)
- `hub/src/policy/mission-policy.ts:508` (sweeper-managed-field-protection design intent)
- `hub/src/hub-networking.ts:316-334` (notifyEvent / Path B)
- `hub/src/policy/message-policy.ts:208-221` (ctx.dispatch / Path A)
- `hub/src/policy/notification-helpers.ts:35-43` (SSE-no-double-send doc-comment)
- `feedback_substrate_self_dogfood_discipline.md` v2 + `feedback_retrospective_modes.md` (Spike class default = SKIP retrospective)
- `feedback_pattern_replication_sizing.md` (3rd canonical Spike-class execution)

## Live observation log reference

Full per-event observation log at `docs/audits/m-pulse-primitive-verification-spike-observations.md` — captures bookkeeping snapshots, Hub log excerpts, force-fire test envelope, and per-fire chronological data.

## Retrospective mode — SKIP per Spike class default

Per `feedback_retrospective_modes.md`. Calibration data captured in this audit (above) + memory notes. No separate retrospective doc.

---

*Closing audit authored 2026-04-27 ~03:25Z. Mission-60 status flips to completed via thread-378 convergence cascade. Verification mission DELIVERED its purpose: identified Gap #1 (SSE delivery) + Gap #2 (force-fire mechanism); scoped fix-forward as M-Pulse-Primitive-Surface-Closure. Tier-1 follow-on queue: M-Pulse-Primitive-Surface-Closure (high-priority; pulse adoption blocked until fixed). Tier-2 follow-on queue continues: idea-207 (PAI saga) + idea-208 (CI dogfood + dist-regen) + idea-211 (auto-injection + tool-catalog-refresh) + M-Adapter-Distribution.*
