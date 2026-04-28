# mission-62 W4 — Self-validation observation log

**Mission:** mission-62 M-Agent-Entity-Revisit
**Wave:** W4 (architect-owned bilateral self-validation; dogfood gate per Design v1.0 §8 — observation-only)
**Author:** lily / architect
**Status:** W4 GREEN with 4 known follow-ons (calibrations #20–#23). Substrate validated end-to-end both sides post-P0-recovery.
**Audit thread:** thread-395 (architect↔engineer; converged with stagedActions=[close_no_action] at round-5 commit)

---

## Verdict (one-line)

Mission-62's substrate (Agent schema + activity FSM + signal_working_* wrap + Agent.name from globalInstanceId) validates GREEN end-to-end. PR #112's `buildPromptText` content-rendering fix landed for the pulse path (`event=message_arrived` + `pulseKind`) but the thread-message notification path (`event=thread_message`) still falls through to the generic envelope — the thread-382 ghost-envelope finding **reopens** for that event-type. Thread-message rendering is the cleanest reproducer for the architectural framing in idea-219 (canonical envelope unifies inline-rendering to O(1) instead of per-event-type if-ladder). Three additional calibrations surfaced from the dogfood thread (#21 engineer Agent-record read-surface gap; #22 pulse-template stale-content; #23 pulse-template not-role-aware).

---

## Pre-flight context — substrate post-P0-recovery

W4 dogfood ran 2026-04-28 ~10:55–11:05 AEST, AFTER an unplanned P0 substrate-recovery cycle that consumed the morning. Root cause of the P0 was Hub container deployment skew (image built ~8h before PR #112 merged; restarted on stale image after merge) compounded by un-migrated on-disk Agent records (PRs #112+#113 renamed code only, no state migration). 5 of 9 records had legacy `engineerId`; new Hub code read `agent.id` (= undefined); response builder dropped `agentId` field via JSON.stringify; adapter `parseHandshakeResponse` returned null; `onHandshakeComplete` skipped; `resolveSessionReady` never fired; CallTool gate stalled forever; LLM-driven MCP tool calls hung indefinitely. Recovery: rebuild Hub via `scripts/local/build-hub.sh` + state migration `engineerId → id` in primary key + by-fingerprint index files + salvage of `undefined.json` (lily's latest write under wrong filename) → handshake parses cleanly → gate opens.

P0 calibrations (#15–#19) captured separately in W5 closing audit. W4 dogfood resumed on the recovered substrate at ~10:55 AEST.

---

## Test plan executed

Per Design v1.0 §8 — observation-only scope (NOT routing-refactor expansion per anti-goal #12):

1. **Architect calls `get_agents`** at thread-open + confirms shape match (Agent.id internal; agentId cross-refs; livenessState 4-state + activityState 5-state; new fields)
2. **Thread-open architect↔engineer** during W4 → tests `agent_state_changed` SSE event delivery + content-rendering for `event=thread_message`
3. **Note-kind round-trip** — real architect→engineer + engineer→architect note pair; verify note body surfaces in drain (closes thread-382 morning ghost-envelope finding)
4. **Force-fire pulse test** — `force_fire_pulse(mission-62, engineerPulse/architectPulse)`; observe content rendering inline on both sides
5. **Post-deploy `get_agents({fields: "all"})`** field-shape verification

---

## Test scoreboard

| # | Test | lily | greg | Status | Calibration |
|---|---|---|---|---|---|
| 0 | Handshake parses cleanly (post-P0 recovery) | ✓ | ✓ | GREEN | — |
| 0a | LLM-driven `claim_session` | ✓ epoch=89 | ✓ epoch=151 | GREEN | — |
| 0b | Eager + cognitive (production posture) | n/a | ✓ claim_session 20ms via cognitive pipeline | GREEN | — |
| 0c | Cognitive write path (kind=note + create_thread_reply) | ✓ | ✓ | GREEN | — |
| 1 | Thread-message content rendering inline (`event=thread_message`) | ✗ generic fallthrough | ✗ generic fallthrough | **RED** | **#20** |
| 2 | `agentId` rename through read surfaces | ✓ via `list_available_peers` | ✓ via `list_available_peers`, `get_thread.*.agentId`, telemetry | partial GREEN | — |
| 2a | `get_agents({fields:"all"})` engineer-callable | n/a | ✗ not exposed in catalog | RED | **#21** |
| 4 | Pulse content rendering inline (`event=message_arrived` + `pulseKind`) | ✓ inline (architectPulse) | ✓ inline (engineerPulse) | GREEN | — |
| 4a | Convergence-finalized envelope rendering | ⚠ partial inline (truncated summary excerpt) | n/a | YELLOW | sub-finding under #20 |
| 4b | Pulse template freshness (W1+W2 text on a W4-era pulse) | n/a | ✗ stale | RED | **#22** |
| 4c | Pulse template role-awareness (suggests architect-only verb to engineer recipient) | n/a | ✗ | RED | **#23** |
| 5 | PR #114 signal_working_* adapter wrap visible | ✓ | ✓ (~19ms started + ~11ms completed bracketing get_thread) | GREEN | — |

---

## Verbatim envelope captures

### A. architectPulse → lily (test #4 GREEN, content rendered inline)

Force-fired by architect: `force_fire_pulse(mission-62, architectPulse)` at 2026-04-28T00:57:18.660Z. Envelope as received in lily's `<channel>`:

```
<channel source="plugin:agent-adapter:proxy" event="message_arrived" source="plugin:agent-adapter:pulse" level="informational">
[Hub] Pulse fired (status_check) for mission mission-62. mission-62 architect check-in — short_status: current architect-side activity | observation log update | any engineer-coord pending | any Director-surface needed Respond with shape "short_status" via the appropriate channel (typically mcp__plugin_agent-adapter_proxy__create_message kind=note OR a short status reply on the active coord-thread). Message ID: 01KQ8SEBAGMX70QR37ZWCPNMXD.
</channel>
```

**Body content rendered inline** ✓ — `mission-62 architect check-in — short_status: current architect-side activity | observation log update | any engineer-coord pending | any Director-surface needed`. PR #112's `buildPromptText` 4-branch payload discriminator handles `event=message_arrived` with `pulseKind=status_check`.

### B. engineerPulse → greg (test #4 GREEN, content rendered inline; symmetric)

Force-fired by architect: `force_fire_pulse(mission-62, engineerPulse)` at 2026-04-28T01:00:07.117Z. Envelope as captured by greg in their thread-395 round-3 reply (verbatim):

```
<channel source="plugin:agent-adapter:proxy" event="message_arrived" source="plugin:agent-adapter:pulse" level="informational">
[Hub] Pulse fired (status_check) for mission mission-62. mission-62 W1+W2 status check — short_status: current sub-item position (per task description's 11-item checklist) | bookkeeping snapshot | next-expected | any blockers requiring architect-coordination Respond with shape "short_status" via the appropriate channel (typically mcp__plugin_agent-adapter_proxy__create_message kind=note OR a short status reply on the active coord-thread). Message ID: 01KQ8SKFSEEEAEJZPBMYCH6PNY.
</channel>
```

**Body content rendered inline** ✓ — pulse path is symmetric. (Sub-finding: pulse text says "W1+W2 status check" though we're at W4 — calibration #22, pulse-template-as-stored-not-derived. Pulse-template instructs `mcp__plugin_agent-adapter_proxy__create_message kind=note` but greg's engineer catalog doesn't expose that verb — calibration #23, pulse-template-not-role-aware.)

### C. architect→engineer thread-reply → greg (test #1 RED, body NOT inlined)

Architect wrote to thread-395 round 1 (substantial multi-paragraph message). Envelope as captured by greg verbatim:

```
[Architect] Replied to thread "Mission-62 W4 dogfood — post-P0 substrate validation". It is your turn. Call mcp__plugin_agent-adapter_proxy__get_thread with threadId="thread-395" to read the full thread, then reply using mcp__plugin_agent-adapter_proxy__create_thread_reply. Threads 2.0 discipline: when you signal converged=true you MUST also populate `stagedActions` (for a purely-ideation thread: [{kind:"stage",type:"close_no_action",payload:{reason:"<short rationale>"}}]) AND a non-empty `summary` narrating the agreed outcome. The Hub gate rejects converged=true without both — read the error message and retry with the missing piece populated.
```

**Body absent** ✗ — generic fallthrough. Greg called `get_thread` to read the actual content. PR #112's discriminator does NOT cover `event=thread_message`.

### D. engineer→architect thread-reply → lily (test #1 RED, body NOT inlined; symmetric)

Greg wrote to thread-395 round 2 (substantial reply with calibration capture + handshake events). Envelope as received in lily's `<channel>`:

```
<channel source="plugin:agent-adapter:proxy" event="thread_message" source="plugin:agent-adapter:notification" level="actionable" threadId="thread-395">
[Engineer peer] Replied to thread "Mission-62 W4 dogfood — post-P0 substrate validation". It is your turn. Call mcp__plugin_agent-adapter_proxy__get_thread with threadId="thread-395" to read the full thread, then reply using mcp__plugin_agent-adapter_proxy__create_thread_reply. Threads 2.0 discipline: when you signal converged=true you MUST also populate `stagedActions` ...
</channel>
```

**Body absent** ✗ — same generic fallthrough, symmetric. Architect called `get_thread` to read.

### E. thread_convergence_finalized → lily (test #4a YELLOW, partial inline truncation)

Hub finalized convergence after greg's round-3 commit + lily's round-4 commit. Envelope as received in lily's `<channel>`:

```
<channel source="plugin:agent-adapter:proxy" event="thread_convergence_finalized" source="plugin:agent-adapter:notification" level="actionable" threadId="thread-395">
[Hub] Thread "Mission-62 W4 dogfood — post-P0 substrate validation" converged with intent: implementation_ready. Summary: Mission-62 W4 dogfood — post-P0 substrate validation COMPLETE.

**Substrate verdict**: GREEN with 4 known follow-ons captured as calibrations.

**Validated end-to-end (both lily + greg)**:
- Field-ren. Committed actions: 1 (executed=1, failed=0). Review the full ConvergenceReport in the event payload for any follow-up action.
</channel>
```

**Partial inline rendering with mid-word truncation** (`Field-ren. Committed actions:...`). Third distinct render-path behavior in this dogfood, captured as sub-finding under calibration #20 — same root architectural cause (per-event-type if-ladder in `buildPromptText`).

---

## Calibrations surfaced this thread (4 NEW)

### Calibration #20 — Thread-message envelope render-layer gap

**Symptom:** When the Hub dispatches a `thread_message` notification (peer reply on an active thread), the adapter renders the envelope using the generic shape `[<Author>] Replied to thread "<title>". It is your turn. Call mcp__plugin_agent-adapter_proxy__get_thread ...` — the actual reply body is NOT inlined. Recipient must call `get_thread` to read the message content.

**Reproduction:** symmetric on both sides this dogfood (architect→engineer captured by greg verbatim; engineer→architect captured by lily verbatim). Three different render-path behaviors observed across event types in the same session: pulses inline ✓, thread-message zero ✗, convergence-finalized partial-with-truncation ⚠. Same root architectural cause: per-event-type if-ladder in `packages/network-adapter/src/prompt-format.ts buildPromptText`.

**Why PR #112 didn't close this:** PR #112's "Pass 7 note/pulse content fix" added inline rendering to the `event=message_arrived` + `pulseKind` branch, but did not extend to the `event=thread_message` notification path that the Hub dispatcher emits for thread-reply notifications. Description-claim that thread-382 ghost-envelope was closed was overstated — closed for pulses, not thread-replies.

**Architectural framing:** This is the cleanest reproducer for idea-219's O(1)-vs-O(N) framing. Per-event-type if-ladders in `buildPromptText` accumulate as new event types ship; each new event type requires explicit branch addition or it falls through to the generic shape. A canonical envelope (`{event, agent: {...}, payload: {...}}`) would route inline rendering through a single pipeline that consumes the canonical shape regardless of event type.

**Fix-forward path:** Either (a) extend `buildPromptText` to handle `event=thread_message` (small follow-on PR ~30 LOC), OR (b) fold into idea-219 as part of the canonical envelope rework. Option (b) is the architectural choice; option (a) is the tactical bandaid. Director's "perfection-forward" preference points to (b).

**Tracking:** scoped under idea-219 (Wire-Entity Envelope Convergence + Schema-Migration Discipline).

### Calibration #21 — Engineer Agent-record read-surface gap

**Symptom:** Engineer cannot inspect full peer Agent records (livenessState, activityState, name) via any verb in their tool catalog. `list_available_peers` returns lean projection (`{agentId, role, labels}`) only; `get_agents` is not exposed in engineer catalog. `get_thread.participants[]` also has only lean fields (`role, agentId, joinedAt, lastActiveAt`).

**Reproduction:** greg searched their catalog for `get_agents` — only `migrate_agent_queue` matched. Confirmed via tool-search query during the dogfood thread.

**Why this matters:** Substrate-self-check workflows for engineer (e.g., "is my peer-architect online and idle? what's their current activity state?") have no first-class read path. The new Agent fields shipped in PR #111 (livenessState, activityState, name) are write-only from engineer's perspective via `signal_working_*` — they can BE the agent whose state is signaled, but they can't READ peer Agent state beyond the lean projection.

**Architectural framing:** This is part of the same family as #23 (template-vs-catalog drift). Either (a) `get_agents` should be exposed to engineer role with the same field-set as architect, OR (b) engineer-targeted templates/prompts should not assume access to Agent-record-reading verbs.

**Tracking:** scoped under idea-220 (Shim Observability — Phase 2 formalization includes "engineer-side equivalents" of architect-side surfaces).

### Calibration #22 — Pulse template stale-content

**Symptom:** Pulse Message body content is statically configured per mission (set at mission-create / activate time) rather than synthesized from current phase/state. Greg's engineerPulse received during W4 dogfood read `"mission-62 W1+W2 status check — short_status: current sub-item position (per task description's 11-item checklist) ..."` — text from the W1+W2 phase, leaked onto a W4-era pulse fire.

**Reproduction:** captured verbatim in greg's thread-395 round-3 reply.

**Why this matters:** Pulse content is operator-facing prompt text. Stale text degrades signal quality (engineer is asked about an 11-item checklist that no longer exists). Pulse-template-render hygiene gap.

**Architectural framing:** template = view of state; should be derived from current mission phase, not stored. Adjacent to idea-219's framing — same root issue (state-vs-derived-view conflation).

**Tracking:** scoped under idea-219.

### Calibration #23 — Pulse template not role-aware

**Symptom:** Pulse Message body suggests `mcp__plugin_agent-adapter_proxy__create_message kind=note` as a primary response channel, but `create_message` is not exposed in greg's engineer tool catalog. Pulse-template instruction text references a tool the recipient cannot call.

**Reproduction:** greg searched their catalog (`create_message`, `create_note`, `+message create kind note`) — no match. Pulse text suggested it anyway.

**Why this matters:** Either (a) the verb was renamed/removed without updating pulse-template text (template-vs-catalog drift), OR (b) `create_message` is intentionally architect-only and the template shouldn't suggest it for engineer-targeted pulses. Either way, the pulse-template content is not role-aware.

**Architectural framing:** Same family as #21 (engineer read-surface gap). Templates that reference tools should be constrained to tools available to the target role; or templates should be role-parameterized.

**Tracking:** scoped under idea-220 (template-vs-catalog drift adjacency to engineer Agent-record read-surface gap).

---

## Substrate-validation findings (GREEN)

Beyond the 4 calibrations, this dogfood substantively validated:

- **Field-rename migration** (PR #112 engineerId→agentId; PR #113 Agent.agentId→Agent.id) is clean across all read paths exercised: `list_available_peers`, `get_thread.recipientAgentId / currentTurnAgentId / participants[].agentId / createdBy.agentId`, `cognitive.telemetry` events. **Zero `engineerId` leakage** on the read paths touched.
- **Handshakes parse cleanly** on both sides post-Hub-rebuild + post-state-migration. No `parse_failed` events in `.ois/shim-events.ndjson` for the entire session.
- **Eager + cognitive production posture** validated end-to-end on greg: `claim_session` returned in 20ms through the cognitive pipeline. The defensive measures temporarily applied to lily during P0 triage (eager-disable + cognitive bypass) are diagnostic-only — not required for healthy substrate operation. (Lily's wrapper has been reverted; will pick up production posture on next restart.)
- **Cognitive write path** validated bilaterally: lily's `kind=note` post-pulse-ack landed cleanly (`messageId: 01KQ8SG94P8G23K785PTW6XK6G`); both sides' `create_thread_reply` calls landed with normal latencies; no stalls.
- **Pulse content rendering** is symmetric and inline ✓ — see envelope captures A + B above.
- **PR #114 signal_working_* adapter wrap** is visible bracketing tool calls. Greg captured `~19ms signal_working_started + ~11ms signal_working_completed` around their `get_thread` call.

---

## Architectural framing — pulse-vs-thread-message render asymmetry as the cleanest reproducer for idea-219

The single most informative finding from this W4 is the **clean contrast** between event types in the render layer:

| Event type | Inline rendering | `buildPromptText` branch |
|---|---|---|
| `event=message_arrived` + `pulseKind` | ✓ full inline (PR #112) | covered |
| `event=thread_message` | ✗ generic fallthrough | NOT covered (calibration #20) |
| `event=thread_convergence_finalized` | ⚠ partial inline + truncation | partial coverage; sub-finding under #20 |

Three event types, three different behaviors, all flowing through the same prompt-text builder. The if-ladder structure ensures every new event type either (a) gets a dedicated branch added in lockstep (O(N) discipline), (b) silently falls through to generic (zero-coverage), or (c) gets a partial branch that handles some payload shapes but truncates / drops others.

This is the architectural argument idea-219 captures: a canonical envelope (`{event, agent: {id,...}, payload: {...}}`) routes inline rendering through a single pipeline. New event types ride the existing pipeline by virtue of conforming to the canonical shape — no per-type branch addition needed. The render-layer responsibility moves from "match every event-type variant" to "consume the canonical envelope shape". O(N) → O(1).

This W4 dogfood produced the empirical evidence for that argument: not a hypothetical "what if we had three event types behaving differently?" — actual three event types observed behaving differently in a single session.

---

## What this means for mission-62 close

**Mission-62 W3 ship status: GREEN as scoped.** PR #114 (signal_working_* wrap + Agent.name from globalInstanceId) works as designed. PR #112 (Pass 6 rename + Pass 7 buildPromptText fix + Pass 9 CI hook + Pass 10 rebuild protocol) works for the pulse path it explicitly covered. The "thread-382 closed" claim in PR #112's description was overstated relative to the actual scope landed (closed for pulses, not thread-message), but that's a description-vs-scope precision issue, not a regression.

**No mission-62 follow-on PR required from W4 dogfood.** Calibrations #20–#23 roll up to existing/just-filed ideas (idea-219 + idea-220). The 4 known follow-ons are deferred work, not W4 blockers.

**Substrate verdict: GREEN with 4 known follow-ons.** Mission-62 plannedTasks W4 + W5 marked completed via `update_mission`; mission status → completed.

---

## Cross-references

- **thread-395** — Mission-62 W4 dogfood coordination thread (architect↔engineer; converged round-5)
- **mission-61 W4 audit** — `docs/audits/m-pulse-primitive-surface-closure-w4-validation.md` — adjacent precedent (pulse-primitive Path A SSE wiring), pattern source for this audit doc
- **idea-219** — Wire-Entity Envelope Convergence + Schema-Migration Discipline (covers calibrations #18, #19, #20, #22)
- **idea-220** — Shim Observability — Phase 2 (covers calibrations #15, #16, #21, #23)
- **W5 closing audit** — `docs/audits/m-agent-entity-revisit-w5-closing-audit.md` (calibration narrative + ideas + recovery actions)
- **PR #112** (53b55ea) — Pass 6 rename + Pass 7 buildPromptText fix (note/pulse path)
- **PR #114** (fddf6ca) — W3 adapter wrap + Agent.name
- **mission-62 design** — `docs/designs/m-agent-entity-revisit-design.md` v1.0 §8 (W4 scope) + §10 (anti-goals; observation-only)
- **bug-31** — plannedTasks cascade workaround applied throughout mission-62 (manual `update_mission(plannedTasks=[...completed])`)
