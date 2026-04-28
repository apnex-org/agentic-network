# M-Push-Foundational-Adapter-Recon — Recon Report

**Mission:** mission-54 (M-Push-Foundational-Adapter-Recon)
**Author:** greg / engineer
**Date:** 2026-04-26
**Status:** Draft v1.0 (engineer-authored; architect-pool review pending)
**Anti-goals:** spec-level only; no code-merge plan; no line-by-line review; no adoption decisions; no cherry-picking; no tele-evaluation (architect-side); no PRs from foreign engineer.

## Provenance

- **Foreign-code directory:** `/home/apnex/taceng/codex/agentic-network` — Director-shared 2026-04-26 ~13:45 AEST. Clone of agentic-network at branch `main` HEAD `f29635d` (mission-50 T4 era; pre-mission-51/52 Message primitive + GH-event bridge consumer).
- **Foreign-tree state:** substantial uncommitted-local changes; foreign engineer not onboarded; no PRs (per binding anti-goal).
- **Reference architecture:** Design v1.1 at `docs/designs/m-push-foundation-design.md` (PR #60, branch `agent-lily/m-push-foundation-doc-bundle`; not-yet-merged). Decisions log at top is the binding architectural-commitment surface this recon compares against.
- **Foreign-tree framing:** `ARCHITECTURE.md` (foreign) describes the L4/L7 split + 5-state session FSM + per-plugin shim+dispatcher shape — NOT updated to reflect the hoist work-in-progress (still references per-plugin `dispatcher.ts` at the foreign tree's line 129). `CLAUDE.md` (foreign) is the same commit-policy + companion-docs index as ours; no foreign-engineer-authored architectural intent doc found alongside the source. **Design intent reverse-engineered from code shape alone.**

---

## §1 — Foreign code architectural overview

### Diff scope (uncommitted-local)

```
packages/network-adapter/src/index.ts        |  +33  (re-exports for new shared modules)
packages/network-adapter/src/dispatcher.ts   |  +218 (NEW — shared MCP-boundary)
packages/network-adapter/src/session-claim.ts|  +39  (NEW — distilled from eager-claim)
packages/network-adapter/src/tool-catalog-cache.ts | +77 (NEW — distilled from per-plugin)
adapters/claude-plugin/src/shim.ts           |  +63 / -39
adapters/claude-plugin/src/dispatcher.ts     |  -371 (DELETED — hoisted)
adapters/claude-plugin/src/eager-claim.ts    |  -79  (DELETED — hoisted as session-claim)
adapters/claude-plugin/src/tool-catalog-cache.ts | -157 (DELETED — hoisted)
adapters/opencode-plugin/src/shim.ts         |  +66 / -17
adapters/opencode-plugin/src/dispatcher.ts   |  -228 (DELETED — hoisted)
test rewiring (4 files, mocks)               |   ~80 lines net
```

Net: **+375 / −1012 = ~637 net deletions**. Per-plugin duplication of ~835 lines collapsed into ~334 lines shared + ~129 lines added per-shim glue (net dedup savings ~500 lines).

### Logical layering after hoist

The hoist establishes a **2-layer** decomposition:

```
[Shared adapter — @apnex/network-adapter sovereign-package]
  - Wire/transport (mcp-transport.ts, transport.ts) — UNCHANGED
  - Session/agent client (mcp-agent-client.ts, agent-client.ts) — UNCHANGED
  - Handshake / state-sync / event-router / instance — UNCHANGED
  - MCP-boundary dispatcher (dispatcher.ts, NEW) — Initialize/ListTools/CallTool, pendingActionMap, queueItemId injection, cache fallback
  - Tool-catalog cache (tool-catalog-cache.ts, NEW) — disk-persisted catalog
  - Session-claim helpers (session-claim.ts, NEW) — eager-warmup parse + log helpers
     │
     ▼
[Per-host shim — adapters/<host>-plugin/src/shim.ts]
  - Host-specific transport plumbing (stdio for claude; Bun.serve+HTTP for opencode)
  - Host-specific render-surface (claude `notifications/claude/channel`; opencode `client.session.promptAsync` push-to-LLM)
  - Notification-log writes
  - Process lifecycle (signals, config loading, pid-file)
  - HTTP fetch handler stays per-host (opencode `makeOpenCodeFetchHandler` in shim.ts)
```

### What was NOT touched

`packages/network-adapter/src/{mcp-transport,mcp-agent-client,agent-client,handshake,state-sync,event-router,instance,transport,prompt-format,notification-log,logger,hub-error}.ts` — the L4 wire FSM, L7 session FSM, register_role handshake, SSE watchdog, heartbeat POST, atomic-teardown, dedup filter, instance identity — all **unchanged** by this hoist.

The foreign engineer's work is **MCP-boundary refactor**, not session/transport/wire-layer change.

### What was NOT in scope

Foreign tree predates mission-51 (W6 Message primitive) and mission-52 (GH-event bridge). The hoist does not touch:
- Message store / Message primitive
- SSE push-on-Message-create
- Last-Event-ID Message-store-backed replay
- claim/ack two-step semantics (`new → received → acked`)
- Legacy entity sunset (Notification / PendingActionItem / DirectorNotification)
- Render-surface seen-id LRU cache
- Hybrid push+poll backstop
- `<channel>` source-attribute kind/subkind taxonomy
- GH-event bridge consumer-side adoption

These are Design v1.1 commitments (#1–#7) for M-Push-Foundation; **no foreign-engineer work product addresses them.**

---

## §2 — Dedupe approach

**Critical framing:** The foreign engineer's "dedupe" is **code-path deduplication** (consolidating duplicated dispatcher code across the two plugins into a single shared module). It is NOT event-level deduplication (push+poll seen-id cache as Design v1.1 commitment #4 envisions). Naming alignment ("dedupe") may invite a false equivalence; surfaced explicitly in §6 + §8.

### Mechanism

- `createDispatcher()` (per-plugin; 371 + 228 lines) → `createSharedDispatcher()` (shared; 218 lines) in `@apnex/network-adapter/src/dispatcher.ts`
- Pure helpers `pendingKey(dispatchType, entityRef)` and `injectQueueItemId(name, args, map)` lifted verbatim into the shared module; previously duplicated across plugins
- The pre-existing TODO comment at our HEAD `adapters/opencode-plugin/src/dispatcher.ts:47-48` ("Mirrors claude-plugin's injectQueueItemId — same behavior, same signature; eventual candidate for dedup into the shared network-adapter package once opencode + claude converge") was directly executed

### `pendingActionMap` properties

- **Bounded?** No explicit eviction. It's a `Map<string, string>` keyed by `${dispatchType}:${entityRef}`. Entries are deleted on `injectQueueItemId` consumption (settling tool-call lifecycle) — bounded-by-queueing-semantics in the typical case; pathologically unbounded if events arrive but no settling tool call ever consumes them.
- **TTL?** None.
- **Cache-eviction policy?** N/A (consume-on-use; no LRU; no time-based prune).
- **Dedupe-by?** Id-keyed string composition (`pendingKey`). Not payload-hash; not content-equality.

### What was NOT added

No render-surface seen-id LRU cache. No idempotency dedup on Message replay. No push-vs-poll event-level dedup. The dispatcher's pendingActionMap is for **queueItemId tracking** (so settling tool calls can auto-inject `sourceQueueItemId`) — a different concern from event-arrival dedup.

---

## §3 — Hardening techniques

### Hardening preserved + hoisted (not new)

- **`isUsableAgent()` guard** — early-return empty `tools[]` (ListTools) or `"Hub not connected"` JSON-error envelope (CallTool) when agent is null/disconnected
- **CallTool try/catch** → JSON-error envelope on failure (preserves existing per-plugin pattern)
- **Cache-fallback ListTools path** — when identity not ready, serve cached catalog if `isCacheValid(cached, currentHubVersion)`; on stale-or-missing, fall through to live fetch
- **Atomic cache write** — `tmp + rename` pattern; cleanup-on-failure (`unlink` tmp); preserved from per-plugin source
- **Schema-version cache read** — `null` returned on shape mismatch or parse error; non-fatal log; preserved
- **clientInfo capture in Initialize** — try/catch tolerant of malformed `clientInfo` shape; non-fatal log; preserved
- **null-tolerant `isCacheValid`** — `currentHubVersion` null/empty/undefined → treat as valid (offline / no-info-from-Hub case)

### Hardening NOT added

The foreign engineer did **not**:
- Modify reconnect backoff schedules (those live in `mcp-transport.ts` / unchanged)
- Modify SSE watchdog / heartbeat (unchanged)
- Modify register_role handshake retry-once (unchanged)
- Add new failure-mode handling beyond existing per-plugin patterns
- Add error-isolation between concerns beyond what per-plugin already had

Summary: hardening here is **preservation-during-hoist**. The MCP-transport L4 + agent-client L7 already had the resilience features (reconnect/SSE-watchdog/heartbeat/handshake-retry/atomic-teardown); foreign engineer left them untouched.

---

## §4 — Naming + structure conventions

### Renames during hoist

| Before (per-plugin) | After (shared) | Rationale (inferred) |
|---|---|---|
| `eager-claim.ts` | `session-claim.ts` | Module owns claim-session helpers regardless of eager-mode; rename reflects broader use |
| `createDispatcher()` | `createSharedDispatcher()` | Distinct symbol from per-plugin variants during transition |
| `Dispatcher` interface | `SharedDispatcher` | "" |
| `DispatcherOptions` | `SharedDispatcherOptions` | "" |
| `ClientInfo` | `DispatcherClientInfo` | Avoid name collision with other `ClientInfo`-typed surfaces |
| `DispatcherOptions.handshakeComplete` | `SharedDispatcherOptions.listToolsGate` | Names what is gated, not what is complete |
| `DispatcherOptions.agentReady` | `SharedDispatcherOptions.callToolGate` | "" |
| `dispatcher.server` (eager `Server` property) | `dispatcher.createMcpServer()` (factory) | Lazy: shim controls instance lifecycle (opencode constructs per HTTP-session) |

### Structural conventions

- **Single shared module per concern** in `@apnex/network-adapter/src/`: `dispatcher.ts`, `session-claim.ts`, `tool-catalog-cache.ts`. No inter-module deep-coupling.
- **Pure-functional where possible** — `pendingKey`, `injectQueueItemId`, `parseClaimSessionResponse`, `formatSessionClaimedLogLine`, `cachePathFor`, `isCacheValid` are all stateless top-level functions, exported and individually testable.
- **Closure-factory for stateful pieces** — `createSharedDispatcher` captures `pendingActionMap` + `capturedClientInfo` as private state; exposes `pendingActionMap`, `createMcpServer`, `callbacks`, `getClientInfo`, `makePendingActionItemHandler`.
- **Hooks-pattern for host-specific behavior** — `SharedDispatcherOptions.notificationHooks: { onActionableEvent, onInformationalEvent, onStateChange, onPendingActionItem }` lets the shim inject host-specific behavior (channel-push, push-to-LLM, notification-log writes) without the dispatcher knowing about hosts.
- **Shim layer split**:
  - Transport plumbing: stdio (claude) vs Bun.serve+HTTP (opencode); `makeOpenCodeFetchHandler(dispatcher, servers)` lives in opencode shim, not shared
  - Render-surface: `pushChannelNotification(server, event, level)` for claude (writes `notifications/claude/channel`); `client.session.promptAsync()` for opencode
  - Lifecycle wiring: shim calls `createSharedDispatcher(...)` then `dispatcher.createMcpServer()` to get a Server instance to connect to its host transport
- **Test parity** — `dispatcher.test.ts` + `fetch-handler.test.ts` imports rewired from `../src/dispatcher.js` → `@apnex/network-adapter`. Test surface preserved; mocks (MockClaudeClient, MockOpenCodeClient) updated for new types. Test pass/fail status from foreign machine unknown to us (uncommitted-local).
- **Re-exports** in `packages/network-adapter/src/index.ts`: shared dispatcher, session-claim helpers, and tool-catalog-cache helpers are exported alongside existing wire/transport/handshake exports — single import surface for shim consumers.

---

## §5 — Differences from our current `@apnex/network-adapter` + `adapters/claude-plugin`

Our HEAD reference: `agent-greg/m52-bridge-translator-bug-39` = `main` post-mission-50/51/52 + bug-39 hotfix. Concrete deltas:

| Area | Our HEAD (main) | Foreign tree (uncommitted-local) |
|---|---|---|
| Dispatcher location | Per-plugin: `adapters/claude-plugin/src/dispatcher.ts` (371) + `adapters/opencode-plugin/src/dispatcher.ts` (228) — duplicated | Shared: `packages/network-adapter/src/dispatcher.ts` (218) — single source |
| Session-claim helpers | Per-plugin: `adapters/claude-plugin/src/eager-claim.ts` (79) — claude only | Shared: `packages/network-adapter/src/session-claim.ts` (39) — both plugins consume |
| Tool-catalog cache | Per-plugin: `adapters/claude-plugin/src/tool-catalog-cache.ts` (157) — claude only | Shared: `packages/network-adapter/src/tool-catalog-cache.ts` (77) — both plugins consume |
| Channel notification | In `adapters/claude-plugin/src/dispatcher.ts` | Moved to `adapters/claude-plugin/src/shim.ts` (host-specific render-surface) |
| HTTP fetch handler | In `adapters/opencode-plugin/src/dispatcher.ts` (`makeFetchHandler()`) | Moved to `adapters/opencode-plugin/src/shim.ts` (`makeOpenCodeFetchHandler()`) |
| Server lifecycle | Eager: dispatcher constructs `Server` once at creation; shim accesses `dispatcher.server` | Lazy: dispatcher exposes `createMcpServer()` factory; shim instantiates per-need |
| Gate naming | `handshakeComplete`, `agentReady` | `listToolsGate`, `callToolGate` |
| Hook surface | Per-plugin dispatcher knows about notification-log path + claude `<channel>` mechanics | Generic `notificationHooks` callback bag; shim injects host-specific behavior |
| Wire/transport/session FSM | mcp-transport.ts, mcp-agent-client.ts, agent-client.ts, handshake.ts, event-router.ts, state-sync.ts | UNCHANGED — foreign engineer didn't touch these |
| Code size | ~835 lines duplicated across two plugins | ~334 lines shared + thin shim glue (~129 lines net per shim) — net ~500 lines deleted |
| Mission-51 W6 Message primitive | Present in our HEAD | NOT present (foreign tree predates) |
| Mission-52 GH-event bridge consumer-side | Present in our HEAD | NOT present (foreign tree predates) |
| Bug-39 translator hotfix (commit `0190913` / PR #59) | Present in our HEAD | NOT present (foreign tree predates) |

**Wire-layer parity confirmed**: foreign engineer's hoist preserves the L4 `McpTransport` (`mcp-transport.ts` 558 lines) + L7 `McpAgentClient` (`mcp-agent-client.ts` 652 lines) verbatim. The wire FSM, SSE watchdog, heartbeat POST, atomic teardown, reconnect classification, register_role retry-once, dedup filter, instance identity — all untouched.

---

## §6 — Tele-naive observations

The foreign engineer worked **without our tele framework**. ARCHITECTURE.md was not updated to reflect the hoist; CLAUDE.md is the unchanged commit-policy file; no decisions log; no commit messages (uncommitted). What they optimized for must be reverse-engineered from code shape.

### What the foreign engineer optimized for

1. **Per-plugin code-size shrink** — ~500 net lines deleted via dedup
2. **Test-rewiring discipline** — `dispatcher.test.ts` + `fetch-handler.test.ts` + mocks all updated for new imports; test surface preserved
3. **Atomic-replace fidelity** — channel-push lifted to claude shim with claude-specific helper; opencode HTTP fetch handler lifted to opencode shim with opencode-specific helper; no abstraction-leak from one host into the other
4. **Per-plugin parity** — both plugins consume the same shared abstraction; opencode + claude no longer drift in dispatcher behavior

### What's implicit-vs-explicit

- **Implicit:** 2-layer architectural commitment (shared adapter + per-host shim). Never stated; emergent from the hoist shape.
- **Implicit:** hooks-pattern as host-injection contract. Not named; derivable from option signatures only.
- **Implicit:** lazy server-factory pattern (vs eager construction). Not called out; necessary for opencode's per-session HTTP model.
- **Explicit:** code-comment in our HEAD `adapters/opencode-plugin/src/dispatcher.ts:47-48` predicted exactly this dedup as "eventual candidate for dedup into the shared network-adapter package once opencode + claude converge". Foreign engineer executed the prediction.

### Tele-naive pattern interpretations

- The foreign engineer's choice to put the dispatcher into `@apnex/network-adapter` (vs a new sovereign-package) reads as **simplicity-over-decomposition**. Single sovereign-package houses transport + dispatcher; dispatcher is just a module inside the same package, not a peer package.
- This **DIVERGES** from Design v1.1 commitment #4 which calls for `@apnex/message-dispatcher` as **sovereign-package #6** (3-layer: network-adapter / dispatcher / shim with explicit package boundaries). Foreign engineer chose 2-package physical decomposition (network-adapter / shim).
- **Naming role-overload risk:** the foreign engineer's "dispatcher" is the **MCP-boundary handler factory** (Initialize/ListTools/CallTool, pendingActionMap). Design v1.1's "dispatcher" is the **Message kind/subkind routing layer** ("which host-surface mechanism for this Message?"). Same word; different role; different layer of abstraction. Adopting either pattern as-inspiration risks the name colliding in shared vocabulary.

### Tele-misalignment flags (engineer-spec-level; architect tele-evaluates)

- **NOT push-foundation work.** Foreign engineer's framing language ("host-independent and testable", "shared host dispatcher") is platform-decomposition, not message-delivery. The work is structurally adjacent to Design v1.1's adapter scope, not central to it.
- **NOT message-primitive-aware.** Foreign tree predates mission-51 W6; no Message-store interaction patterns exist in the hoist. The Design v1.1 push-foundation patterns (push-on-create, Last-Event-ID replay, claim/ack two-step) need to be authored from scratch regardless of recon adoption decisions.
- **NOT tele-checked.** Foreign engineer's structural choices (2-layer vs 3-layer, no separate `@apnex/message-dispatcher`) were made without our tele-3 / tele-9 / tele-2 framework. Architect tele-evaluation must independently verify alignment of any pattern adopted as-inspiration.

---

## §7 — Reusability assessment (informational; architect tele-checks before adoption)

### Patterns that could inform Design v1.1 commitments

1. **Code-dedup pattern (as inspiration).** The hoist demonstrates a clean way to consolidate duplicated dispatcher code while keeping host-binding (channel/HTTP/stdio/render-surface) in the shim. If Design v1.1 ships 3-layer (with `@apnex/message-dispatcher` as sovereign-package #6), the per-host shim layer can apply the same hooks-pattern to inject host-specific behavior without the dispatcher knowing about hosts. **Pattern reusable; structural decomposition choice (2- vs 3-package) is a separate decision.**

2. **`notificationHooks` callback bag.** Clean shim-injection extension point. Could shape how Design v1.1's Dispatcher exposes "which host-surface mechanism for this Message?" — `route(Message) → handler` where the handler is supplied by the shim layer via a similar hooks-bag (per kind/subkind family). **Reusable as host-injection contract shape.**

3. **Lazy server-factory pattern.** `createMcpServer()` factory (vs eager `dispatcher.server`) is a straightforward improvement for any future per-session needs. **Reusable independent of push-foundation work** — could be folded into our HEAD as a small clarity win even before push-foundation lands.

4. **Tool-catalog cache distillation** (157 → 77 lines). Schema-version + atomic write + null-tolerant `isCacheValid` are the load-bearing pieces; everything else was incidental. **Reusable as inspiration** if Design v1.1 needs adapter-side caching for any new contract (e.g., disk-persisted seen-id state). Note: seen-id LRU cache likely wants different properties (bounded N=1000 + LRU eviction vs schema-versioned-on-disk) — pattern doesn't transfer wholesale.

5. **Naming refinement** (`handshakeComplete` → `listToolsGate`, `agentReady` → `callToolGate`). Names what's gated, not what's complete. Small clarity win; reusable in our HEAD even without the hoist itself.

### Patterns NOT reusable (because not present)

- No render-surface seen-id LRU cache → Design v1.1 commitment #4 needs to be authored from scratch
- No claim/ack two-step semantics (`new → received → acked`) → Design v1.1 commitment #6 from scratch
- No SSE Last-Event-ID Message-store-backed replay wiring → Design v1.1 commitment #2 from scratch
- No `<channel>` source-attribute kind/subkind taxonomy (`plugin:agent-adapter:repo-event` / `:directive` / `:notification`) → Design v1.1 commitment #4 from scratch
- No legacy entity sunset path → Design v1.1 commitment #7 from scratch
- No hybrid push+poll backstop with since-cursor → Design v1.1 commitment #5 from scratch
- No `<channel>` per-kind/subkind injection → Design v1.1 commitment #4 from scratch

### Provenance reminder

Per binding mission anti-goals: no direct code adoption; recon-as-inspiration only; if patterns adopted, **we author in our own commits with foreign work as inspiration only.** Foreign engineer is not onboarded; no PRs from foreign engineer (not onboarded).

---

## §8 — Open questions for architect tele-evaluation

The following questions surface architectural choices the foreign work makes (or doesn't make) that the architect should tele-evaluate before Design v1.2.

1. **2-layer vs 3-layer commitment.** Foreign engineer's structural shape is 2-layer (`@apnex/network-adapter` shared + per-host shim). Design v1.1 commitment #4 commits to 3-layer (`@apnex/network-adapter` / `@apnex/message-dispatcher` (NEW sovereign-package #6) / shim). Does the recon prompt a Design v1.2 revision to 2-layer (one fewer sovereign-package; tele-3 simpler), or does the architect tele-evaluate that 3-layer is still warranted (Message-routing deserves its own sovereign-package boundary distinct from MCP-transport)?

2. **Naming role-overload risk.** Foreign engineer's "dispatcher" = MCP-boundary handler factory. Design v1.1's "dispatcher" = Message kind/subkind router. Same word, different role. Does the architect want to disambiguate (e.g., "MCP-boundary" vs "Message-router") in Design v1.2 to avoid future engineer confusion? If 3-layer is kept, the package name `@apnex/message-dispatcher` already disambiguates — but the in-code "dispatcher" symbol may still collide.

3. **`notificationHooks` callback bag pattern.** Foreign engineer's hook bag (`onActionableEvent`, `onInformationalEvent`, `onStateChange`, `onPendingActionItem`) is a clean host-injection contract. Does the architect want Design v1.1's Message-router (or its 2-layer equivalent) to expose a similar hooks shape (per Message kind/subkind family), or is a richer route-table contract warranted once kind/subkind routing + render-surface taxonomy are in scope?

4. **Lazy server-factory pattern adoption.** `createMcpServer()` factory (vs eager `dispatcher.server`) supports per-session lifecycle. Independent of the 2-vs-3-layer choice, does the architect want this pattern adopted in our HEAD as a small clarity/correctness win even before push-foundation lands?

5. **Gate naming.** `listToolsGate` / `callToolGate` (vs `handshakeComplete` / `agentReady`) — names what's gated, not what's complete. Worth adopting in our HEAD as a clarity win even before push-foundation lands?

6. **Foreign tree predates mission-51/52.** Foreign engineer worked from `f29635d` (mission-50 T4 era). Their hoist NEVER touches Message primitive (mission-51 W6) or GH-event bridge consumer (mission-52). Architect tele-evaluation should account for: any push-foundation patterns adopted as-inspiration must be re-grounded against current main + Message primitive — not against the foreign engineer's pre-Message worldview. **Risk to flag:** patterns that look reasonable on the pre-Message tree may not compose with mission-51 W6 Message-store semantics.

7. **`pendingActionMap` unboundedness.** Foreign engineer preserved the Map without TTL/eviction. Today bounded by queueing semantics (consume-on-use); long-run could be unbounded if events arrive but never settle. Does the architect want this flagged for a follow-up bug, or is it acceptable as-is given current semantics? (Likely acceptable; flagging for visibility only.)

8. **Tool-catalog-cache vs render-surface seen-id-cache shape divergence.** Foreign engineer's distilled cache is disk-persisted, schema-versioned, null-tolerant — properties suited to tool-catalog. Design v1.1's seen-id cache (commitment #4) likely wants in-memory LRU with bounded N=1000, no disk persistence, no schema-version. Pattern doesn't transfer wholesale; architect should explicitly decide cache-shape per concern in Design v1.2.

9. **Test rewiring fidelity unknown.** Foreign engineer rewired `dispatcher.test.ts` + `fetch-handler.test.ts` imports + mocks. Tests are uncommitted-local; pass/fail status from the foreign machine unknown. **Anti-goal binding:** if Design v1.2 adopts any pattern, our authored version must have its own tests written from scratch (no copy-paste of foreign tests).

10. **Adapter-layer-clean-FIRST sequencing.** Director's directive 2026-04-26 ~10:00Z committed to "adapter-layer-clean FIRST sequencing" before push-foundation. Foreign engineer's hoist IS adapter-layer-clean work — but executed on pre-Message primitives. Does the architect want:
    - (a) a **separate "pre-push adapter cleanup" mission** echoing the foreign-engineer-as-inspiration (hoist into `@apnex/network-adapter`, naming refinements, lazy server-factory) before M-Push-Foundation's W3+W4 waves, OR
    - (b) **fold the cleanup into M-Push-Foundation's W3+W4 themselves** (cleaner one-pass; bigger PRs), OR
    - (c) **defer cleanup entirely** (M-Push-Foundation lands push-foundation first; cleanup follows in its own mission post-merge)?

    Sequencing choice affects M-Push-Foundation's wave shape (8-wave granular vs 6-wave bundled — engineer-decision pending audit-round-2 per Design v1.1).

---

## Appendix — Files inspected

Foreign tree at `/home/apnex/taceng/codex/agentic-network`:

- `ARCHITECTURE.md` (204 lines; foreign engineer didn't update)
- `CLAUDE.md` (25 lines; unchanged from ours; commit-policy + companion-docs index only)
- `packages/network-adapter/src/index.ts` (170 lines; +33 modified for re-exports)
- `packages/network-adapter/src/dispatcher.ts` (218 lines; new)
- `packages/network-adapter/src/session-claim.ts` (39 lines; new)
- `packages/network-adapter/src/tool-catalog-cache.ts` (77 lines; new)
- `adapters/claude-plugin/src/shim.ts` (493 lines; +63/−39 modified)
- `adapters/opencode-plugin/src/shim.ts` (680 lines; +66/−17 modified)
- `git diff HEAD` (24 files; +375/−1012 net)

Reference:

- `docs/designs/m-push-foundation-design.md` v1.1 (locked snapshot; via `git show origin/agent-lily/m-push-foundation-doc-bundle`)
- Mission-54 brief (via `get_mission(mission-54)`)

Per architect's spec-level guidance (`feedback_architect_abstraction_level.md`): not every file deep-read; §1 (architectural overview) + §4 (naming/structure) carry the load; §6 (tele-naive observations) + §8 (open questions) are the highest-leverage outputs for downstream tele-evaluation.

— greg / engineer / 2026-04-26
