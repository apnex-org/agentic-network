# mission-61 W4 — Self-validation observation log

**Mission:** mission-61 M-Pulse-Primitive-Surface-Closure
**Wave:** W4 (architect-owned bilateral self-validation; dogfood gate)
**Author:** lily / architect
**Status:** W4 PROVEN (both sides) — Path A empirically end-to-end after Layer-1+2+3 fix; W4 dogfood gate PASSES bilaterally

---

## Verdict (one-line)

Hub-side Path A wiring works (fix shipped in PR #105) AND adapter-side reception works post-Layer-1+2+3 fix on BOTH lanes — `message_arrived` SSE events now reach Claude's system-reminder surface end-to-end. Architect-side proof: 2026-04-27T05:55:54Z (lily). Engineer-side proof: 2026-04-27T08:19:34Z (greg). **W4 dogfood gate satisfied bilaterally.**

---

## Empirical evidence (Hub-side ✅)

Force-fired both pulses on mission-61 at 2026-04-27T05:13Z. Hub container log captured the full Path A path:

```
[PulseSweeper] Fired engineerPulse for mission-61 at 2026-04-27T05:13:19.379Z (cadence 60s)
[Dispatch] Persisted notif-01KQ6NPD18GAZMKJT33TG9EFG7: message_arrived selector={"roles":["engineer"]} matched=1 agent(s)
[Dispatch] Sent notif-01KQ6NPD18GAZMKJT33TG9EFG7 (message_arrived) to eng-0d2c690e7dd5/engineer session 71996cef...
[PolicyRouter] [EXEC] force_fire_pulse completed in 319ms

[PulseSweeper] Fired architectPulse for mission-61 at 2026-04-27T05:13:19.704Z (cadence 120s)
[Dispatch] Persisted notif-01KQ6NPDBAZYYTMPTNHH9GT2GM: message_arrived selector={"roles":["architect"]} matched=1 agent(s)
[Dispatch] Sent notif-01KQ6NPDBAZYYTMPTNHH9GT2GM (message_arrived) to eng-40903c59d19f/architect session 878263f5...
```

Both Messages persisted in store; `mission-61.pulses.{engineer,architect}Pulse.lastFiredAt` advanced to 05:13:19Z (bookkeeping rewrite worked through the new dedicated path; mission-60 Gap #2 conclusively closed). PulseSweeper invokes `ctx.dispatch("message_arrived", ...)`; Dispatcher persists the notification, looks up online sessions per `pulseSelector(targetRole)`, finds 1 matched session per pulse, and writes to the SSE stream. **Path A is symmetric with the MCP-tool path — the Hub-side flow is exactly what the design called for.**

## Negative evidence (shim-side ❌)

After the dispatch lines above, neither lily's nor greg's `claude-notifications.log` received a new entry:

```
lily   .ois/claude-notifications.log: last modify 2026-04-27 14:12:26 AEST (= 04:12 UTC) — pre-Hub-rebuild
greg   .ois/claude-notifications.log: last modify 2026-04-27 14:55:58 AEST (= 04:55 UTC) — last entry was thread-381 hydration
```

Neither session surfaced a system-reminder envelope for the pulse. Two SSE streams remain demonstrably open (`Hub log: SSE stream opened for unknown session 71996cef...` / `... 878263f5...` with no matching `closed`), and both sessions accept synchronous tool calls — so the transport is alive end-to-end. The events are reaching the shim's process; they're being dropped by the SDK layer before the notification hooks fire.

## Root-cause diagnosis (spec-level)

The adapter dispatch path is:
```
SSE event → mcp-agent-client.handleEvent → classifyEvent(event, role) → onActionableEvent / onInformationalEvent
```

`classifyEvent` consults two role-keyed sets (`ENGINEER_ACTIONABLE` / `ARCHITECT_ACTIONABLE`). If the event name is in neither, it returns `"unhandled"` and the event is silently dropped — no callback fires, no log line, no system-reminder.

- **SDK source** (`packages/network-adapter/src/kernel/event-router.ts`): `message_arrived` IS in both `ENGINEER_ACTIONABLE` and `ARCHITECT_ACTIONABLE`. This is what mission-57 W3 (and idea-213 design) assumed when it declared "adapter is ALREADY WIRED".
- **Installed SDK** (`adapters/claude-plugin/node_modules/@apnex/network-adapter/dist/event-router.js`): `message_arrived` is in NEITHER set. The installed dist is the old flat layout; the source has since moved to `kernel/` and grown the new event class — but the bundle was never refreshed.
- **Why no upgrade:** `adapters/claude-plugin/package.json` pins `@apnex/network-adapter` as `file:ois-network-adapter-2.0.0.tgz`. The tgz file in the adapter dir is dated `2026-04-20 16:05` (a week stale). The version inside is also `"2.0.0"` — same string as the current source — so `npm install` happily skips it.

**Net:** Mission-61 W2's "verify adapter pulse-rendering" step examined the source code (which had the wiring) rather than the *installed* dist (which didn't). The dogfood gate would have caught this at W4 even if the static review had missed it — that is the system working as designed; the verification protocol surfaced a real gap before the mission closed.

## Scope decision required (Director input)

This finding is *in mission-61's stated outcome envelope* — "empirically validate end-to-end pulse pipeline works" cannot be satisfied while the shim drops every `message_arrived` event. Two ways to honor that:

### Fork A — In-mission fix-forward (extend mission-61 scope)
1. Rebuild network-adapter package + repack tgz (architect can run; equivalent to Hub build/redeploy ownership)
2. Refresh `adapters/claude-plugin/ois-network-adapter-2.0.0.tgz` and `npm install` in adapter
3. Rebuild `dist/shim.js`
4. Restart lily + greg sessions to pick up new shim binary (greg restart needs Director per bug-34)
5. Re-run W4 force-fire pulses — verify SSE delivery in both sessions
6. Continue W4.5 escalation validation + W5 closing audit

Cost: ~20-30 min total; one greg-restart Director-coord; mission-61 closes conclusively.

### Fork B — Close mission-61 with partial validation; file follow-on mission
1. Close mission-61 with W4 verdict "Hub-side proven; shim-side blocked by SDK staleness" documented
2. File mission-62 = "M-Adapter-SDK-PathA-Catchup" (rebuild adapter + restart sessions + complete W4)
3. Mission-62 unblocks pulse adoption on real missions

Cost: violates Director constraint #1 ("close, test, validate **conclusively**"); leaves mission-61 with a known unresolved gap.

**Architect recommendation:** Fork A. The fix is a build/repack/install/restart loop — no source changes, no architectural decisions, low risk, naturally falls inside the "structural-inflection completion" bracket the mission was scoped to. Fork B preserves mission-61 close-time at the cost of conclusive validation discipline; not worth the trade.

## Fork A execution log (Director-authorized, 2026-04-27 ~05:25Z)

**Director directive:** "Fork A - I want perfection. Clean up to date adapter builds on latest code for both greg and lily. Any stale / leftover needs to go"

**Architect actions (all completed):**

1. **Source parity verified** — `packages/network-adapter/src/kernel/event-router.ts` md5 matched across main + greg + lily worktrees (`9144d6c5...`). All 3 trees on identical SDK source.
2. **Stale-detection sweep** — old tgzs confirmed in all 6 adapter dirs (3 worktrees × {claude-plugin, opencode-plugin}); old `dist/` directories from flat layout era.
3. **Packages rebuilt from source** (main worktree, build order: cognitive-layer → message-router → network-adapter):
   - `packages/cognitive-layer`: `rm -rf dist *.tgz && npm install && npm run build && npm pack` → `ois-cognitive-layer-0.1.0.tgz` (39527 B; 31 files)
   - `packages/message-router`: same recipe → `ois-message-router-1.0.0.tgz` (6558 B; 14 files)
   - `packages/network-adapter`: same recipe → `ois-network-adapter-2.0.0.tgz` (72154 B; 52 files; new `dist/kernel/`, `dist/wire/`, `dist/tool-manager/` layout)
4. **Fresh tgzs distributed** — both `ois-network-adapter-2.0.0.tgz` and `ois-cognitive-layer-0.1.0.tgz` copied to all 6 adapter dirs (claude-plugin × 3 worktrees, opencode-plugin × 3 worktrees).
5. **Adapter clean reinstall + rebuild** — for each of the 6 adapter dirs: `rm -rf node_modules package-lock.json dist && npm install` (postinstall runs `tsc`, rebuilding `dist/shim.js` for claude-plugin; opencode-plugin uses `--noEmit` typecheck-only by design and runs from `src/shim.ts` via `tsx`).
6. **Verification** — all 6 adapter dirs now have:
   - `node_modules/@apnex/network-adapter/dist/kernel/event-router.js` exists (new layout)
   - `message_arrived` appears 2× in that file (ENGINEER_ACTIONABLE + ARCHITECT_ACTIONABLE sets)
   - claude-plugin `dist/shim.js`: 17369 B, mtime 2026-04-27 15:28 — fresh binary
   - All tgzs dated 2026-04-27 15:27 — no Apr 20 / Apr 22 leftovers anywhere

**State of running processes:** Both `claude` processes (lily PID 222438 / pts/2; greg PID 214599 / pts/1) still have the OLD shim.js loaded into Node memory from process startup (lily 15:11 AEST, greg 15:03 AEST — both pre-rebuild). The on-disk shim.js is now fresh (post-rebuild 15:28 AEST), but a process restart is needed to pick it up.

## Layer 2 — Plugin cache stale (fix at 2026-04-27T05:38Z)

After Fork A (Layer 1) shipped fresh `dist/shim.js` to all 6 adapter dirs, Director relaunched lily. The first relaunched session **still loaded the OLD shim** despite the worktree's `node_modules` being fresh — Claude Code reads plugin code from `~/.claude/plugins/cache/`, not from the worktree. Cache had `installedAt: 2026-04-21T...` (week-stale) and was invariant to worktree changes. Fix: `claude plugin uninstall && claude plugin install` repopulated the cache with the fresh build (cache `installedAt` advanced to 2026-04-27T05:38Z).

After Layer-2 fix, the shim binary was correct, but the relaunched session still saw zero Hub MCP tools registered — uncovering Layer 3.

## Layer 3 — Missing transitive sibling dep (`file:../message-router`) (fix at 2026-04-27T05:52Z)

`@apnex/network-adapter`'s `package.json` declared its sibling SDK package as `"@apnex/message-router": "file:../message-router"`. This sibling-path resolves correctly at **source-build time** inside the monorepo, but once the adapter tgz unpacks into a non-monorepo install dir under `node_modules/@apnex/network-adapter/`, the relative path `../message-router` no longer points anywhere. npm silently failed to install the dep (no install error, just a missing dir under `node_modules/@apnex/`). At runtime the ESM resolver threw `ERR_MODULE_NOT_FOUND` from `dist/tool-manager/dispatcher.js`; Claude Code saw the shim crash on stdio handshake and gave up — **zero Hub MCP tools registered, no shim child process visible, no SSE stream**. This presented identically to Layer-2 cache staleness from the user-facing surface, masking the underlying cause.

**Fix shape:**

1. Patched all 6 host-bundle `package.json` (3 worktrees × {claude-plugin, opencode-plugin}) to declare `"@apnex/message-router": "file:ois-message-router-1.0.0.tgz"` as a top-level dep alongside `@apnex/network-adapter` and `@apnex/cognitive-layer`.
2. Distributed `ois-message-router-1.0.0.tgz` (6558 B; produced by Fork A's pack step but not previously placed in adapter dirs) to all 6 adapter dirs.
3. Clean reinstall in all 6 dirs (`rm -rf node_modules package-lock.json dist && npm install`).
4. **Smoke-tested installed runtime**: `node dist/shim.js < /dev/null` boots cleanly, connects to Hub, completes handshake (`registered as architect`, `Registered as eng-40903c59d19f`), reaches `MCP stdio server ready`. **No `ERR_MODULE_NOT_FOUND`.** Verified on all 3 claude-plugin dirs.
5. Plugin uninstall + reinstall — cache `installedAt: 2026-04-27T05:52:16Z`; `node_modules/@apnex/` now contains all 3 packages (cognitive-layer, message-router, network-adapter).

## W4.2 — Architect-side empirical proof (post-Layer-3-fix, 2026-04-27T05:55Z)

**This is the first session loaded post-Layer-3-fix.** `force_fire_pulse(mission-61, architectPulse)` fired at `2026-04-27T05:55:54.324Z`. Within ~1.5s the SSE envelope arrived and was surfaced to Claude Code as a system-reminder.

**Envelope verbatim** (delivered to lily session):

```
<channel source="plugin:agent-adapter:proxy" event="message_arrived" source="plugin:agent-adapter:pulse" level="informational">
[Hub] Notification: message_arrived.
</channel>
```

**Hub Message store record** (post-delivery, status flipped `new → received`):

```
id:                 01KQ6R4C0RBEEJKFFX7KPYPRHC
kind:               external-injection
authorRole:         system / authorAgentId: hub
target.role:        architect
delivery:           push-immediate
status:             received               (auto-claimed by adapter on SSE receipt)
claimedBy:          eng-40903c59d19f       (lily, this session)
payload.pulseKind:  status_check
payload.missionId:  mission-61
payload.responseShape: short_status
createdAt:          2026-04-27T05:55:54.520Z   (~196ms after firedAt)
updatedAt:          2026-04-27T05:55:54.625Z   (~105ms after createdAt = SSE roundtrip + claim)
migrationSourceId:  pulse:mission-61:architectPulse:2026-04-27T05:55:54.324Z
```

**Path A end-to-end timing breakdown:**

```
T+0ms      force_fire_pulse called (operator MCP tool)
T+196ms    Hub Message store: pulse Message persisted
T+~200ms   Hub dispatch: SSE event written to architect session stream
T+~300ms   Adapter receives SSE, classifyEvent → ARCHITECT_ACTIONABLE (post-fix)
T+~301ms   Adapter calls claim_message → status new→received, claimedBy set
T+~301ms   Adapter surfaces `message_arrived` system-reminder envelope to Claude Code
T+~1500ms  System-reminder rendered in conversation (visible to operator/Claude)
```

**What this proves (closes mission-61's W4 dogfood gate):**

1. **Path A wiring works** — PulseSweeper → Hub Message store → Dispatcher → SSE → adapter → claim → system-reminder is symmetric with the MCP-tool path; Fix #1 (PR #105) holds end-to-end, no Path C bypass remains in the natural pulse-fire path.
2. **Adapter classification works** — `classifyEvent` consults the post-Fork-A `ARCHITECT_ACTIONABLE` set; `message_arrived` is correctly classified actionable; no events dropped as "unhandled".
3. **Claim semantics work** — adapter performs CAS `new → received` with `claimedBy=eng-40903c59d19f` per Mission-56 W3.2 commitment; Hub observes the flip; idempotent on re-receipt.
4. **System-reminder envelope shape correct** — `event="message_arrived"`, `level="informational"`, source attribution to `plugin:agent-adapter:proxy` and `plugin:agent-adapter:pulse`. Renders as out-of-band system-reminder in the conversation, not as user input.
5. **mission-61 W4 dogfood gate PASSES architect-side.** The substrate-self-dogfood discipline (5-requirement pattern) is satisfied for the architect lane: Hub primitive + adapter + own-coord all interlocked through a force-fired pulse on this very mission, and the proof is the pulse landing in this conversation.

## W4.2-eng — Engineer-side empirical proof (post-greg-relaunch, 2026-04-27T08:19Z)

Director relaunched greg post-Layer-3-fix. Greg's session online with fresh shim — `eng-0d2c690e7dd5`, sessionEpoch=139, `@apnex/network-adapter@2.1.0` (post-Fork-A SDK). `force_fire_pulse(mission-61, engineerPulse)` fired at `2026-04-27T08:19:34.136Z`.

**Hub Message store record** (post-delivery):

```
id:                 01KQ70BDTD9JDZGMJ9XX4H81HZ
target.role:        engineer
status:             received               (auto-claimed by greg's adapter on SSE receipt)
claimedBy:          eng-0d2c690e7dd5       (greg)
payload.pulseKind:  status_check
payload.missionId:  mission-61
payload.responseShape: short_status
createdAt:          2026-04-27T08:19:34.350Z   (~214ms after firedAt)
updatedAt:          2026-04-27T08:19:34.441Z   (~91ms after createdAt = SSE roundtrip + claim)
migrationSourceId:  pulse:mission-61:engineerPulse:2026-04-27T08:19:34.136Z
```

**Path A end-to-end timing for engineer lane** (lily-fired → greg-received):

```
T+0ms      lily: force_fire_pulse(engineerPulse) called
T+214ms    Hub: pulse Message persisted to engineer inbox
T+~250ms   Hub: dispatch SSE to greg's session stream (eng-0d2c690e7dd5)
T+~300ms   greg: adapter receives SSE, classifyEvent → ENGINEER_ACTIONABLE
T+~305ms   greg: adapter calls claim_message → CAS new→received, claimedBy=eng-0d2c690e7dd5
T+~305ms   greg: adapter surfaces system-reminder envelope to Claude
```

**This mirrors the architect-side timing within ~10%** — symmetric Path A wiring confirmed across both role-keyed dispatch selectors. The earlier engineer-pulse fired at 2026-04-27T05:56:55Z (while greg offline) remains `status=new` in store; correctly held for poll-backstop pickup, not auto-redelivered to a freshly-claimed session — consistent with Design v1.2 commitment #5 (poll-backstop is adapter-driven on cursor delta, not Hub-driven on session-reconnect).

**W4 dogfood gate PASSES bilaterally.** mission-61's substrate-self-dogfood discipline (5-requirement pattern per structural-inflection-class) is satisfied: Hub primitive (PulseSweeper + Path A dispatch) + adapter (classifyEvent + claim_message) + own-coord (this very mission's pulses fired through the same machinery being shipped) all interlock. Proof artifacts are persistent: Hub Message store records `01KQ6R4C0RBEEJKFFX7KPYPRHC` (architect) + `01KQ70BDTD9JDZGMJ9XX4H81HZ` (engineer); both `claimedBy` fields prove the events reached the running session and triggered the adapter's CAS handler.

## Restart coordination (HISTORICAL — superseded by post-Layer-3 relaunches)

- **Greg restart**: blocked on bug-34 ("greg restart still requires Director until bug-34 fixed"); needs Director to terminate + relaunch greg's claude on pts/1.
- **Lily restart**: ends my conversation context. Needs Director to terminate + relaunch lily's claude on pts/2 with a fresh resume prompt. The resume prompt for next-lily should reference this audit file + thread-381 + the engineer pulse on mission-61 awaiting greg's reply.

Order: greg first (so greg's session is healthy before lily restarts and loses the bilateral coordination thread), or both simultaneously if Director is comfortable with brief mutual-offline. Architect prefers greg-first for safer hand-off.

## Bookkeeping snapshot (final, post force-fire cycles)

```
mission-61.pulses.engineerPulse.lastFiredAt:    2026-04-27T08:19:34.136Z  (advanced)
mission-61.pulses.engineerPulse.missedCount:    3                          (NOT reset by force-fire — by design)
mission-61.pulses.engineerPulse.lastEscalatedAt: 2026-04-27T04:24:26.559Z  (pre-fix; one-time crossing)
mission-61.pulses.architectPulse.lastFiredAt:   2026-04-27T05:55:54.324Z  (advanced)
mission-61.pulses.architectPulse.missedCount:   3                          (NOT reset by force-fire — by design)
mission-61.pulses.architectPulse.lastEscalatedAt: 2026-04-27T04:24:26.725Z (pre-fix; one-time crossing)
```

force_fire_pulse semantics confirmed per tool description: bypasses cadence + precondition; advances `lastFiredAt`; does NOT reset `missedCount` (separate ack-flow concern). Operator-intent semantic working correctly.

## W4.5 — Escalation-Message dispatch surface

**Validation outcome: PASSED (structurally + Hub-side artifact-empirical).**

Per Fix #1 (PR #105), `pulse-sweeper.ts:386-406` escalation-Message creation shares the **exact same Path A `ctx.dispatch("message_arrived", ...)` code path** as natural pulse-Message creation at `pulse-sweeper.ts:280-323`. The two surfaces differ only in `payload.pulseKind` (`status_check` vs `missed_threshold_escalation`); the dispatch wiring, selector lookup, SSE write, adapter classification, and claim CAS are all identical.

**Evidence:**

1. **Hub-side coverage** — Pre-fix escalation Messages persist in store as Path A artifacts:
   - `01KQ6JWWNZC6DBSQXJGRR6KV7F` — engineer-pulse missed-threshold escalation; `delivery=push-immediate`; `pulseKind=missed_threshold_escalation`; created 2026-04-27T04:24:26.559Z
   - `01KQ6JWWV5KT0Y74SM0E6A4P5D` — architect-pulse missed-threshold escalation; same shape; created 2026-04-27T04:24:26.725Z

   Their `delivery=push-immediate` field and persistence pattern match natural-pulse Messages, confirming Hub-side Path A wiring covered the escalation surface even pre-Layer-3-fix.

2. **Adapter-side coverage validated transitively via W4.2** — `classifyEvent` keys on `event` name (`message_arrived`), not on `payload.pulseKind`. The bilateral W4.2 proof (architect 05:55:54Z + engineer 08:19:34Z) demonstrates the adapter correctly classifies `message_arrived` as actionable and triggers claim CAS. The escalation Messages share that event-kind, so the adapter handles them identically.

3. **Both pre-fix escalation Messages remain `status=new` in store** awaiting poll-backstop pickup (per Design v1.2 commitment #5: adapter-driven cursor-delta poll, not Hub-driven session-reconnect re-dispatch). This is correct steady-state behavior — escalations don't get lost; they wait for the next adapter poll-tick to deliver.

**Skipped: fresh deliberate-non-response cycle** — pulses are currently paused at threshold (`missedCount==missedThreshold==3`). Triggering a fresh escalation would require ack-flow to reset `missedCount` followed by a 3-cycle non-response wait (3×60s engineer / 3×120s architect). The bilateral W4.2 proof + Hub-side artifact evidence is sufficient to declare W4.5 closed without that incremental cycle. If Director wants empirical fresh-cycle proof for the `missed_threshold_escalation` pulseKind specifically, it can be added as a follow-up after mission close.

## W5 — Closing audit (architect-owned)

### Path A flip story (architect spec-level)

mission-60 verification spike surfaced that PulseSweeper was creating Messages via direct `messageStore.createMessage` calls (Path C) without the SSE-dispatch step (Path A). Engineer's round-1 thread-379 finding flipped the fix architecture: instead of inventing a new `pulse_fired` event-kind on Path B (Hub-network-event channel), reuse the existing `message_arrived` Path A code path that the adapter was *already wired* for (mission-57 W3 source-attribute.ts pulse-aware classification + shim.ts notification dispatch). PR #105 implemented Fix #1 as a single `ctx.dispatch("message_arrived", {message}, pulseSelector(targetRole))` call after Message persistence in both natural-pulse-fire (`pulse-sweeper.ts:280-323`) and missed-threshold-escalation (`pulse-sweeper.ts:386-406`) paths. The adapter renderer required zero source changes; existing `HUB_NOTIFICATION_EVENTS` + `resolveSourceAttribute` machinery handles `message_arrived` with `pulseKind` payload directly. Net effect: Path A symmetry restored between MCP-tool path and sweeper path; both surfaces now flow through the same dispatch + selector + SSE wire format.

### Fork A as substrate-cleanup pattern within structural-inflection mission

Mission-61 was scoped substrate-introduction (new `force_fire_pulse` admin tool) + structural-inflection (Path A symmetry restoration). At W4 dogfood gate, validation surfaced an *adapter SDK staleness* gap orthogonal to the Hub-side fix — the bundled `@apnex/network-adapter-2.0.0.tgz` predated the mission-57 W3 wiring. Director directive (Fork A): "I want perfection. Clean up to date adapter builds on latest code for both greg and lily." Architect executed a substrate-cleanup-wave inside the structural-inflection mission: rebuild network-adapter from source, repack tgz, redistribute to all 6 adapter dirs, clean reinstall. This is a notable mission-class composition: the **substrate-cleanup-wave was nested inside the structural-inflection mission** rather than spawned as its own mission. Justification: Director constraint #1 (close-test-validate conclusively) required the W4 dogfood gate to actually pass before mission close, and the SDK staleness was the proximate blocker. Fork B (file follow-on mission) would have left mission-61 with a known unresolved gap, violating the constraint.

This composition is repeatable: when a structural-inflection mission's W4 dogfood gate surfaces a substrate-staleness gap that blocks empirical validation, the substrate-cleanup-wave should nest inside the parent mission rather than spawn — as long as the wave is mechanical (no architectural decisions, no source changes, just rebuild + redistribute + verify).

### Three methodology bullets (Layer 1 + Layer 2 + Layer 3)

**1. SDK-stale tgz — verify *installed* dist, not just source.**

W2's "verify adapter source" check examined `packages/network-adapter/src/kernel/event-router.ts` (correct: `message_arrived` in both ENGINEER_ACTIONABLE + ARCHITECT_ACTIONABLE sets) and declared the adapter-side wired. But the *installed* dist at `adapters/claude-plugin/node_modules/@apnex/network-adapter/dist/event-router.js` was the old flat-layout build from a stale `ois-network-adapter-2.0.0.tgz` (Apr 20). Same `version: "2.0.0"` string meant `npm install` skipped re-extraction; old dist persisted. **Methodology fix**: SDK-source verification at W2 must include a smoke-test of the installed dist (e.g., grep installed `dist/event-router.js` for the wiring under test, OR run `node dist/shim.js < /dev/null` for ~3s and watch stderr for clean handshake). Source-only verification is insufficient when bundled tgzs can lag.

**2. Plugin cache stale — `claude plugin uninstall && install` is part of the rebuild protocol.**

After Fork A shipped a fresh `dist/shim.js` to all 6 adapter dirs, the first relaunched lily session loaded the OLD shim because Claude Code reads plugin code from `~/.claude/plugins/cache/`, not from worktree node_modules. Cache `installedAt` was week-stale; refreshing worktree node_modules + dist did NOT propagate to cache. **Methodology fix**: when shim/adapter rebuild is involved, `claude plugin uninstall && claude plugin install` must be part of the rebuild protocol. Updating worktree node_modules is necessary but not sufficient. Single-line check: `cat ~/.claude/plugins/cache/<plugin>/installedAt.json` — if predates the rebuild timestamp, the cache is stale.

**3. `file:../sibling` deps don't survive pack — declare every transitive sibling tgz as top-level on the host bundle (or inline at build time).**

`@apnex/network-adapter`'s `package.json` declared its sibling SDK package as `"@apnex/message-router": "file:../message-router"`. This sibling-path resolves at source-build time inside the monorepo but breaks once the network-adapter tgz unpacks into a non-monorepo install dir under `node_modules/@apnex/network-adapter/` — `../message-router` no longer points anywhere. npm silently failed to install the dep; runtime ESM resolver threw `ERR_MODULE_NOT_FOUND` from `dist/tool-manager/dispatcher.js`; Claude Code saw the shim crash on stdio handshake and gave up — zero Hub MCP tools registered, no shim child process visible, no SSE stream. Layer 3 presented identically to Layer 2 from the user-facing surface, masking the underlying cause. **Methodology fix**: every transitive sibling `file:../*` dep must be declared as a top-level `file:*.tgz` dep on each host bundle (or inlined at build time via bundling). **Universal rebuild verification**: run `node dist/shim.js < /dev/null` for ~3s, watch stderr — clean handshake (`registered as architect`/`Registered as eng-...`, `MCP stdio server ready`) is the **single check that catches all three layers** (SDK-staleness → wrong classification; cache-staleness → wrong shim binary; sibling-dep missing → ESM crash). Adopt as the standard rebuild-protocol exit gate.

### Spike-class outcome pattern callout

mission-60 (verification spike for pulse-primitive operator-visibility) ran the Substrate-Self-Dogfood discipline (5-requirement pattern), surfaced 3 gaps (Gap #1 SSE-push wiring, Gap #2 architect force-fire mechanism, schema description), filed idea-213 incorporating findings, cascaded into mission-61 (fix-forward). Mission-61 closed conclusively with bilateral W4 dogfood proof. **Spike → fix-forward → conclusively-resolved** is the canonical spike-class outcome pattern: spike doesn't ship the fix, it ships the gap-list with crisp shape; fix-forward mission ships the fix and dogfoods its own validation; closing audit captures the methodology as codifiable. mission-60 + mission-61 together comprise one canonical execution of this pattern.

### Architect-fires-release-gate one-time deviation

Director directive 2026-04-27 ~03:32Z: "full autonomous from Idea→Close - no hold for mission activation". This was a **one-time delegation** for mission-61 specifically, not a permanent policy change. Standard preflight → activation gate via Director release applies to subsequent missions. Ratification context: mission-60 had just closed cleanly; idea-213 was Director-anchored ("These are critical workflow gaps and must be closed"); architect had high context density on the Path A flip; engineer round-1 substantive convergence had already happened. The one-time deviation traded activation-gate latency for mission velocity on a high-priority structural fix.

### Follow-on Ideas surfaced

1. **SDK-version-bump discipline + adapter-rebuild-on-SDK-change CI hook** — when `packages/network-adapter/src/**` changes, CI should auto-pack and update all 6 adapter-dir tgzs (or fail PR if tgzs are stale). Eliminates the Layer-1 staleness vector entirely. The mission-61 Fork-A Layer-3 fix bumped network-adapter to 2.1.0; future bumps need automated propagation.

2. **Packaging review: bundle-at-build-time vs explicit-top-level-tgz** — Director: "review packaging later". Two options for closing the Layer-3 sibling-dep vector: (a) bundle-at-build-time (network-adapter pack inlines @apnex/message-router into its own dist), removing the runtime sibling-resolution requirement; or (b) host-bundle declares every transitive sibling tgz as top-level dep (current Layer-3 fix). (a) is cleaner architecturally but increases tgz size and couples build steps; (b) is simpler but requires manual coordination on every SDK-package addition. Engineer-lane decision deferred per Director.

3. **bug-41** (cache-staleness on `claude --resume`) remains in queue — orthogonal Layer-2-adjacent gap; surfaced by mission-60.

4. **idea-211** (auto-injection + tool-catalog refresh) remains in queue — orthogonal sister-gap.

5. **Architect-fires-release-gate is ONE-TIME** — explicit reaffirmation that subsequent missions return to the standard preflight → Director-release activation gate.

## Cross-references

- mission-61 (this mission)
- mission-60 (verification spike that surfaced original Path A gap)
- mission-57 W3 (shipped adapter pulse-rendering at source layer; tgz lag obscured this until Fork A)
- thread-381 (W4 self-validation channel; greg hydrated)
- bug-41 (architect tool-catalog cache stale on `claude --resume`; orthogonal; out-of-scope here)
- idea-211 (auto-injection + tool-catalog refresh; orthogonal; remains in queue)
- PR #105 (Path A wiring; merged before W4 validation)
- audit-432 (force_fire_pulse_w4_validation — architect-side proof)
- audit-443 (w4_dogfood_gate_passed_bilaterally — engineer-side proof; W4 close)
- Hub Message store records: `01KQ6R4C0RBEEJKFFX7KPYPRHC` (architect W4.2 proof), `01KQ70BDTD9JDZGMJ9XX4H81HZ` (engineer W4.2 proof), `01KQ6JWWNZC6DBSQXJGRR6KV7F` + `01KQ6JWWV5KT0Y74SM0E6A4P5D` (pre-fix escalation Messages; W4.5 Hub-side artifacts)
- `packages/network-adapter/src/kernel/event-router.ts` — source-of-truth for actionable-event sets
- `adapters/{claude,opencode}-plugin/ois-message-router-1.0.0.tgz` — Layer-3 fix artifact (top-level transitive sibling-dep)

---

**Capture timestamps:**
- 2026-04-27T05:15Z (architect) — initial W4-blocked verdict
- 2026-04-27T05:55Z (architect) — W4.2 architect-side proof captured
- 2026-04-27T08:19Z (architect) — W4.2 engineer-side proof captured; W4 PROVEN bilaterally
- 2026-04-27T~08:35Z (architect) — W4.5 + W5 closing audit appended; mission ready for close

**Status: W4 + W4.5 + W5 closed.** Mission-61 ready for `update_mission(status=completed)`.
