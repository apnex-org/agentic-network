# M-Pi-Plugin-Adapter — Design v0.3 (boundary-ratified)

**Status:** v0.3 — DRAFT, boundary-ratified in Director dialogue. v0.2 surfaced the
core-vs-shim finding (§3.2); v0.3 folds in the ratified boundary decisions:
(1) the sovereign `@apnex/tool-manager` carve-out is a **hard dependency** of this
mission (own design doc: `m-sovereign-tool-manager-design.md`); (2) the **facade
boundary rule** (§1.2) — shims import `@apnex/network-adapter` ONLY; (3) pi is the
**reference implementation** of the corrected architecture, and claude/opencode
get an explicit **fold-in path** (§11). Not yet reviewed.
**Mission name:** M-Pi-Plugin-Adapter (working title)
**Mission class:** structural-addition (new host shim; peer to `adapters/claude-plugin` + `adapters/opencode-plugin`)
**Source:** Director request — add pi (the pi coding-agent harness) as a third network-adapter host.
**Authors:** engineer (v0.1–v0.3 draft)
**Lifecycle phase:** 4 Design (draft)
**Axioms in force:** A3 Sovereign Composition (primary), A11 Cognitive Minimalism, A2, A0.
**Depends on:** M-Tool-Manager-Internal-Sovereign-Module (internal boundary
refactor, NOT a package — standalone-utility test failed; see that doc §1.0) —
critical path.

> **As-built note (2026-07-01):** the dependency refactor has SHIPPED Slices A–C
> (272/272 green). Any remaining mention of a published `@apnex/tool-manager`
> package below is superseded — it landed as an **internal module** (dir tree
> under `packages/network-adapter/src/tool-manager/`), and the transport-neutral
> dispatch authority this shim consumes is `runToolDispatch` in
> `tool-manager/dispatch/dispatch.ts`. Authoritative status + deferred roadmap:
> `m-sovereign-tool-manager-design.md` §9. This doc's design body is preserved as
> v0.3 draft history (A4); Slice D is the next active step.

---

## §1 Goal + intent

**Goal:** ship `@apnex/pi-plugin` — a network-adapter host shim for the **pi**
coding-agent harness, so a pi session can join the agentic network (hub /
workgraph / missionhub) exactly as a claude or opencode session does, with an
**identical observable outcome**: same tool surface, same wake/notification
behavior, same identity + resilience guarantees.

**Architectural framing:** *"pi is the first host where the host-facing surface
is pure native API — no local MCP server."* The upstream wire to the Hub is
still MCP-over-HTTP+SSE (the `@apnex/network-adapter` L4/L7 stack, unchanged).
The **downstream** surface to the host collapses entirely to pi's native
primitives (`pi.registerTool`, `pi.sendUserMessage`, `ctx.ui.notify`). pi is
therefore expected to be the **thinnest** of the three shims, because pi's
native primitives absorb the two necessities that forced MCP into the other
two hosts.

**The load-bearing invariant (acceptance criterion):**
> Whatever tool surface claude/opencode advertise via their MCP proxies, pi
> must advertise the **same set** via `pi.registerTool()` — same names, same
> schemas, same `adapter-internal`-tier filtering, same `list_changed` refresh.
> The *mechanism* differs; the *observable tool surface to the LLM* is identical.

### 1.2 The facade boundary rule (RATIFIED — A3 Air-Gap)

**A shim imports `@apnex/network-adapter` and NOTHING else in the `@apnex/*`
graph.** Everything a shim legitimately needs — `CognitivePipeline`, the
notification `NotificationCoalescer`, the `@apnex/tool-manager` contracts +
native binding, the MCP binding — is **re-exported through the facade**
(`network-adapter/src/index.ts`). A shim `import from "@apnex/tool-manager"` /
`"@apnex/message-router"` / `"@apnex/cognitive-layer"` is a boundary violation.

Why this is load-bearing:
- **The facade IS the composition root.** `@apnex/network-adapter` is the
  orchestrator that composes the sovereign peers; its whole reason to exist is to
  give shims ONE dependency + ONE version to track. A shim reaching past it makes
  the facade decorative.
- **It decouples the shim contract from package topology.** Whether the tool
  authority is a package (C) or an internal directory (B), the shim's import line
  is identical (`from "@apnex/network-adapter"`). So the shim never knows — and a
  future B→C migration touches ZERO shim imports.

Current drift (to fix in this mission — behavior-neutral): opencode imports
`@apnex/message-router` directly (`NotificationCoalescer`); both shims import
`@apnex/cognitive-layer` directly. The facade already re-exports both (the
`index.ts` comment: *"re-exported here so consumers importing them from
@apnex/network-adapter are unaffected"*) — so this is drift, not design. Re-route
those imports through the facade + add a `no-restricted-imports` lint in
`adapters/*` forbidding `@apnex/*` except `@apnex/network-adapter`.

### 1.3 Non-goals (this mission)

- **NO websocket transport.** One transport (MCP-over-HTTP+SSE via `McpTransport`)
  for now. A future websocket transport is a pure L4 leaf swap behind `ITransport`
  and must NOT be pre-designed here. The pi shim MUST NOT assume MCP anywhere on
  the host-facing side — this keeps the swap a leaf change.
- **NO pi-side MCP server.** pi has no native MCP client; we deliberately bypass
  MCP on the host boundary rather than build one. (We *could* build one; we
  explicitly choose not to — it would re-introduce the exact indirection pi lets
  us delete.)
- **NO adapter behavior in the shim.** Per goal #1 (Modular) of
  `docs/network/00-network-adapter-architecture.md`. Anything reusable lands in
  `@apnex/network-adapter`, not here.

---

## §2 Harness capability survey — why pi differs

MCP in the other two hosts was never the goal; it was the transport of
convenience for two **host-imposed necessities**:

- **claude** — needed MCP+SSE because that was its only inbound push channel
  for notifications (waking the LLM).
- **opencode** — needed the MCP proxy because that was its only way to expose
  Hub tools to the host.

pi has first-class native primitives for **both**:

| Concern | claude | opencode | **pi** |
|---|---|---|---|
| **Tool exposure** | host is MCP client; stdio MCP proxy re-advertises Hub tools | host is MCP client; `Bun.serve` HTTP MCP proxy | **`pi.registerTool()`** — register each Hub tool natively; no proxy |
| **Wake / push** | MCP+SSE → `<channel>` injection | `promptAsync` (over the MCP-registered proxy) | **`pi.sendUserMessage()` / `pi.sendMessage()`** with `deliverAs: steer\|followUp\|nextTurn` |
| **Idle gating** | n/a (host manages) | session-active queue (NotificationCoalescer) | **`ctx.isIdle()`** native |
| **Toast / status** | source-attribute channel | `sdkClient.tui.showToast` | **`ctx.ui.notify` / `setStatus` / `setWidget`** |
| **Lifecycle** | plugin-load + stdio | plugin-load + `setTimeout` bg-init | **event bus**: `session_start` / `session_shutdown` (docs mandate: no bg resources in factory) |
| **Config / cwd** | `.ois/` + env | `.ois/` + `ctx.directory` | `.ois/` + `ctx.cwd` (+ `CONFIG_DIR_NAME`) |
| **Distribution** | npm + install.sh + `.claude-plugin` manifest | esbuild self-contained bundle | **pi package** (`pi install` npm/git) or `.pi/extensions/` |

**Consequence:** the pi shim deletes, relative to opencode, the entire
`Bun.serve` proxy, the `WebStandardStreamableHTTPServerTransport` per-session
plumbing, the `makeOpenCodeFetchHandler`, and the `activeProxyServers` fan-out.
It keeps only: connect, callbacks→wake, and catalog→`registerTool`.

**Source:** pi docs — `docs/extensions.md` (events, `registerTool`,
`sendUserMessage`, `ctx.ui`, `session_start`/`session_shutdown`),
`docs/usage.md` ("intentionally does not include built-in MCP").

---

## §3 Core-vs-shim boundary — the crux

Design principle (restated from arch doc §2 + the notification contract):

> **Core computes; shim renders.** The Hub→tool-surface computation (what tools
> exist, their schemas, their tier, when the surface changed) is shared core and
> MUST NOT be re-derived in a shim (M18 drift scar). The *rendering* of that
> computed surface onto the host is shim.

Applying that to every pi-specific mechanism:

| Mechanism | Core or Shim? | Rationale |
|---|---|---|
| Wire (L4 `McpTransport`) | **Core** (unchanged) | Portable; websocket-swap seam. |
| Session FSM, handshake, state-sync, event routing, dedup, reconnect | **Core** (unchanged) | The whole reason the Universal Adapter exists. |
| Tool catalog fetch (`listToolsRaw()`) + tier filtering + `ToolSurfaceReconciler` | **Core** (unchanged) | Already shared; both existing shims drive it. |
| **MCP JSON-Schema → native tool-def normalization** | **Core (proposed — see §3.1)** | Reusable by any future native-tool host (ACP, raw CLI). Evaluate impact on other shims. |
| **`pi.registerTool()` call itself** | **Shim** | Last-mile host binding — pi-specific API. |
| Wake rendering (hooks → `sendUserMessage`/`notify`) | **Shim** | Last-mile host binding — pi-specific API. |
| Idle gating decision (`when` to flush) | **Core-ish (evaluate)** | opencode's `NotificationCoalescer` already owns pacing; pi may reuse it feeding `ctx.isIdle()`. See §5. |
| Identity/config bootstrap (`loadConfig`, `readRequiredAgentName`, `loadOrCreateGlobalInstanceId`) | **Core** (existing helpers) | Already hoisted; shim injects host-specific paths via `ctx.cwd`. |

### 3.1 The typebox / schema-conversion question (OPEN — needs code eval)

The Hub advertises ~71 tools with MCP JSON-Schema `inputSchema`. pi wants each
as a `pi.registerTool({ parameters: <typebox schema>, ... })`. So pi needs a
**JSON-Schema → typebox** conversion the other two shims never needed (they pass
MCP schemas straight through to their MCP proxies).

**Observation (candidate dedup / reuse):** "given Hub tool schemas, produce
native host tool definitions" is a generic capability. A future ACP host or a
raw-CLI host would need the identical conversion. That argues for placing the
**schema normalization** in `@apnex/network-adapter` (e.g.
`tool-manager/native-tool-projection.ts`) and leaving only the `pi.registerTool`
call in the shim.

**BUT** — gate on impact:
- The converter output is typebox-shaped, which today only pi consumes. Putting
  a typebox dependency in core would leak a pi-flavored type into a package the
  other two shims share. **Mitigation:** core emits a *neutral* normalized
  descriptor (name, description, JSON-Schema params, tier); the typebox
  materialization stays in the pi shim. This keeps core dependency-neutral and
  still de-dupes the *hard* part (catalog→descriptor) while the *trivial* part
  (descriptor→typebox) is shim.
- **Decision to confirm in code phase:** does `McpTransport.listToolsRaw()`
  already return a clean enough descriptor that the "normalization" is near-nil?
  If so, the shim converts directly and we add nothing to core. If there's real
  massaging (tier filtering, name-prefixing, dedup), that massaging is core.

**RESOLVED (v0.2).** `McpAgentClient.listTools()` already returns a clean
`CognitiveTool[]` (MCP `{ name, description, inputSchema }` shape) **with the
`adapter-internal` tier already filtered off** (mcp-agent-client.ts:341 — strips
`[tier:adapter-internal]`-marked tools) **and** the cognitive pipeline's
`ToolDescriptionEnricher` already applied. So the pi shim gets the exact same
LLM-facing catalog the opencode/claude MCP proxies serve, from one call.

Decision:
- **Core stays dependency-neutral.** `listTools()` already emits the neutral
  descriptor (name/description/JSON-Schema inputSchema). Adding nothing to core.
- **The descriptor→typebox materialization is a pi-shim concern** (`tool-bridge.ts`),
  because typebox is pi-flavored and no other host needs it. The conversion is a
  thin JSON-Schema→`Type.Object` walk; if a *second* native-tool host ever
  appears, promote the walk to a neutral shared helper then — not now (YAGNI; the
  arch doc's own "2nd such host" deferral discipline).
- **Net:** zero core change for schema conversion. The real reuse question is NOT
  the schema — it's the per-call *behavior wrapper*. See §3.2.

### 3.2 MAJOR FINDING — the per-call behavior wrapper is trapped inside the MCP `CallTool` handler

Reading `dispatcher.ts` surfaced the load-bearing risk for pi. The
`createSharedDispatcher` `CallTool` handler is **not** a thin passthrough to
`agent.call()`. On **every** tool call it also does:

- `signal_working_started` / `signal_working_completed` FSM wrapping (mission-62)
  — how routing peers see this agent's working state.
- `injectQueueItemId()` — ADR-017 auto-injection of `sourceQueueItemId` on
  settling calls (`create_thread_reply`).
- `activeCallCount++/--` — the idea-353 **idle-gate** bookkeeping that the
  wake/stall reconciler reads to avoid interrupting a mid-task agent.
- `workLeases.observe(name, args, result)` — lease tracking that feeds the
  outbound stall-prompt.
- `onToolCallResult` host hook.
- error-envelope normalization + `TOOL_CALL_SIGNAL_SKIP` guard.

The other two shims get ALL of this for free because their host tool calls flow
*through* this handler (host is an MCP client → proxy `CallTool` → `agent.call`).
**pi calls `agent.call()` directly from `pi.registerTool().execute()`, bypassing
the entire handler** — and therefore bypassing every behavior above. If pi
re-implements them in `execute()`, that is textbook M18 drift (goal #1 violation).

**Decision (the highest-value dedup of this exercise):**
> Extract the `CallTool` handler **body** into a transport-neutral core function
> — `dispatchToolCall(agent, name, args, ctx)` on the `SharedDispatcher` — that
> owns signal-wrapping, queueItemId injection, activeCallCount, lease observe,
> and error normalization. The MCP `Server`'s `CallTool` handler becomes a thin
> wrapper that calls `dispatchToolCall` and formats the MCP response. pi's
> `execute()` calls the SAME `dispatchToolCall` and formats a pi ToolResult.
> **Same core dispatch; two last-mile response formatters.**

Impact on the other two shims: **none functionally** — opencode/claude keep
calling `createMcpServer()`; the handler body just moves behind a function they
now call. This is a pure refactor of core with an added public method. It is a
prerequisite for pi and a latent debt-payoff for the whole adapter (the behavior
was MCP-coupled only by accident of history).

**This refactor is the critical-path work item for the pi mission.** It should be
its own reviewed slice (core change + regression tests on opencode/claude) BEFORE
the pi shim is written on top of it.

---

## §4 Tool-surface strategy

1. **Seed:** on session reaching `streaming` (L1 `identityReady` — same trigger
   opencode uses), fetch the catalog via the shared tool-manager, filter
   `adapter-internal` tier off the LLM surface, and `pi.registerTool()` each
   `llm-callable` tool. `execute(id, params) => agent.call(toolName, params)`.
2. **Refresh:** drive the shared `ToolSurfaceReconciler` off the same two
   triggers (L1 identityReady + L2 heartbeat tick). On drift, re-register
   changed tools and use `pi.setActiveTools()` to enable/disable. pi supports
   runtime `registerTool` + `setActiveTools` (docs confirm — no `/reload` needed).
3. **`readServedRevision`:** like opencode, pi has no persistent tool-catalog
   cache → `() => null` (seed baselines from live, no spurious first
   `list_changed`; L2 heartbeat catches mid-session redeploys). This is the
   documented SHIM-BOUNDARY divergence, not drift.
4. **Naming:** match the other hosts' tool-prefix convention
   (`architect-hub_` prompt prefix seen in opencode) so cross-host transcripts
   stay comparable. Confirm exact prefix in code phase.

---

## §5 Wake / notification strategy

Implement the 4-hook Universal Adapter notification contract
(`docs/specs/universal-adapter-notification-contract.md`):

| Hook | pi rendering |
|---|---|
| `onActionableEvent` | wake the LLM. Idle → `pi.sendUserMessage(text, { triggerTurn })`. Streaming → `deliverAs: "steer"` or `"followUp"` (choice TBD — steer interrupts, followUp waits; likely followUp to match opencode's non-interrupting queue). |
| `onInformationalEvent` | **log-only** (matches both existing shims post-idea-331; must NOT wake). |
| `onStateChange` | diagnostic — `ctx.ui.setStatus` / file log. |
| `onPendingActionItem` | drain-path wake (bug-108 parity) — same reconstruction helper (`reconstructDrainedAction`), rendered via the same wake path. |

**Idle gating:** opencode built a `NotificationCoalescer` (in `@apnex/message-router`)
because opencode had to track session-active itself. pi has native `ctx.isIdle()`.
Two options — evaluate in code phase:
- **(a) Reuse `NotificationCoalescer`**, feeding it pi's idle signal → maximum
  dedup with opencode, proven pacing/bounded-flush logic.
- **(b) Native pi gating** — simpler, thinner shim, but re-implements pacing
  that already exists in core.
Lean **(a)** if the coalescer's session-activity input is cleanly injectable;
this is the "thin shim" payoff *and* the dedup payoff simultaneously.

---

## §6 Lifecycle mapping

pi's docs are explicit: **do not start background resources in the extension
factory.** Defer to `session_start`; clean up in `session_shutdown`.

| pi event | shim action |
|---|---|
| factory (default export) | register tools-placeholder? NO — register commands/flags only; NO connect, NO timers. |
| `session_start` | `loadConfig` (via `ctx.cwd`), resolve identity, `agent.start()` (connect + handshake), seed tool surface. |
| `session_shutdown` | `agent.stop()`, close reconciler/backstop timers (idempotent). |
| `model_select` | update handshake `llmModel` if the Hub tracks it live (evaluate — may need a re-handshake or a light metadata update). |
| `agent_end` / idle | feed idle signal to coalescer (§5). |

**Role:** configurable via config/env (`OIS_HUB_ROLE`), **default `architect`**
for this mission (other shims default `engineer`; pi starts as the architect
host — aligns with hooking the Director/pi into missionhub/workgraph driving).

---

## §7 Identity, config, resilience, observability

- **Identity:** reuse `readRequiredAgentName` / `loadOrCreateGlobalInstanceId`
  (idea-251 D-prime: name IS identity). Persist under `~/.ois/pi-instance.json`
  (host-appropriate path per arch doc §9 checklist).
- **Config:** reuse kernel `loadConfig`; inject pi host specifics (hubUrl default,
  `ctx.cwd`, `CONFIG_DIR_NAME` for project-local `.pi/`). pi can't hard-abort
  the TUI on missing creds → surface via handshake-fail path (opencode pattern).
- **Handshake:** full enriched M18 payload — `proxyName: "@apnex/pi-plugin"`,
  `transport: "pi-native"` (new transport tag), `sdkVersion`, build-identity
  (commit sha / dirty), `getClientInfo` → pi name+version, optional `labels`.
- **Fatal halt:** pi CAN request graceful shutdown via `ctx.shutdown()` (unlike
  opencode) — so `onFatalHalt` can actually exit cleanly. Evaluate vs. inert-plugin.
- **Resilience:** inherited G1–G5 from core. Nothing new at the shim.
- **Observability:** file logger (`createFileLogger`), telemetry sink
  (`CognitivePipeline.standard`), `ctx.ui.setStatus` surface for live wire state.

---

## §8 Distribution + repo shape

Peer to existing adapters. New package `@apnex/pi-plugin` at
`adapters/pi-plugin/`:

```
adapters/pi-plugin/
├── package.json          # @apnex/pi-plugin, peer deps on @apnex/network-adapter etc.
├── src/
│   ├── index.ts          # pi ExtensionAPI default export (factory)
│   ├── shim.ts           # connect + callbacks + lifecycle (last-mile)
│   ├── tool-bridge.ts    # catalog descriptor → pi.registerTool (+ typebox materialization)
│   └── wake.ts           # notification hooks → sendUserMessage/notify
├── test/
└── tsconfig.json
```

- Installable via `pi install` (npm `@apnex/pi-plugin` or git) per pi
  `packages.md`; runtime deps in `dependencies` (pi uses `--omit=dev`).
- Follow the claude/opencode `prebuild: write-build-info.js` + `tsc` pattern.
- Dependency-neutral core preserved: if §3.1 lands a converter in core, it emits
  a neutral descriptor; typebox stays a pi-shim dep only.

---

## §9 Open questions to resolve in the code phase

1. **§3.1** — does `listToolsRaw()` already emit a clean descriptor? How much
   (if any) normalization is genuinely reusable → core vs shim?
2. **§5** — is `NotificationCoalescer`'s session-activity input cleanly
   injectable from pi's `ctx.isIdle()` / `agent_end`? (dedup vs thin-shim.)
3. **§5** — steer vs followUp for the streaming-wake path (host-UX call).
4. **§6** — does the Hub track `llmModel` live enough to warrant reacting to
   pi's `model_select`, or is handshake-time capture sufficient?
5. **§7** — `ctx.shutdown()` on fatal halt vs inert-plugin — which is safer for
   a pi TUI session?
6. **Tool count / active-set** — 71 tools registered natively: does pi's
   `setActiveTools` / prompt-snippet surface stay sane at that volume, or do we
   need a role-scoped active subset? (architect-role may need a different active
   set than engineer.)

---

## §10 Dedup observations log (byproduct — Director-flagged as valuable)

*(to be filled during code phase)*

- [ ] Catalog→descriptor normalization — reusable? (§3.1)
- [ ] NotificationCoalescer session-activity seam — generalizable across hosts? (§5)
- [ ] Any host-binding leak currently in opencode/claude that pi exposes by contrast.
- [ ] `transport` tag taxonomy — is `pi-native` a first-class transport enum in core?

---

## §11 Fold-in path for claude + opencode (pi as reference implementation)

pi is NOT merely a third shim — it is the **reference implementation of the
corrected architecture** (sovereign tool-manager + one-authority/many-bindings +
facade boundary rule). claude and opencode become **migration targets** that fold
onto the same design later, as a SEPARATE mission (Director-scoped: focus is pi
now; larger existing-plugin cleanups deferred). This section exists so pi's design
leaves a clean fold-in path — not a redesign — for the other two.

**What pi establishes that the other two later adopt:**

| Corrected element | pi (now) | claude/opencode fold-in (later) |
|---|---|---|
| Tool authority | consumes `@apnex/tool-manager` via facade | re-graft `createSharedDispatcher`'s CallTool body onto `toolManager.dispatch()` |
| Host binding | **native** binding (`bindToolManagerToPi`) | **MCP** binding (`bindToolManagerToMcp`) — the SAME `dispatch()`, MCP response formatter |
| Facade rule | facade-only imports from day one | re-route the drifting `message-router`/`cognitive-layer` imports (done in THIS mission, §1.2) |
| Notification pacing | reuse `NotificationCoalescer` via facade (§5) | already used by opencode; claude adopts if it wants pacing |
| God-object | never inherits it | decompose `createSharedDispatcher` into the orchestrator layers |

**Why the fold-in stays cheap (not a rewrite):**
- The tool-manager carve-out (its own mission) already rewrites the MCP path to go
  through `bindToolManagerToMcp` → `dispatch()` with **regression parity** as the
  gate. So by the time pi ships, claude/opencode are ALREADY on the sovereign
  dispatch — they just haven't adopted the facade-only rule or any further tidy.
- The facade rule (§1.2) makes the package topology invisible to shims, so no
  shim import changes when boundaries move.
- pi proves the non-MCP binding compiles against the agnostic contract — which is
  the guarantee that the MCP binding is not secretly the only shape that works.

**Sequencing (cross-mission):**
1. M-Sovereign-Tool-Manager Slices A–C — carve `@apnex/tool-manager`; claude +
   opencode re-graft onto `bindToolManagerToMcp` (regression parity). *This is
   where the existing two hosts move onto the new dispatch — the unavoidable
   shared prerequisite.*
2. **THIS mission** — pi native binding + facade-drift fix + facade lint. pi is
   the reference native consumer.
3. **Deferred mission(s)** — larger claude/opencode cleanups (god-object
   decomposition adoption, any behavior corrections) fold onto the design pi
   proved. Out of scope here; enabled by here.
