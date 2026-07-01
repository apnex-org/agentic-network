# M-Tool-Manager-Internal-Sovereign-Module — Design v0.2 (boundary-corrected)

**Status:** v0.2 — DRAFT. **CORRECTED from v0.1's package-carve-out framing.**
Director-applied the standalone-utility test: a sovereign npm PACKAGE is earned
only when the code has genuine standalone utility for a consumer OUTSIDE this
adapter. The tool-dispatch code FAILS that test today — its dispatch body is
saturated with OIS-Hub-specific verb semantics (`signal_working_*`,
`claim_message`/`ack_message`, `create_thread_reply`+`sourceQueueItemId`,
`list_ready_work`/`claimable`/`work_lease`). No non-OIS consumer would want it.
**Decision: Option B — internal sovereign MODULE (own directory + contract +
lint-enforced air-gap) inside `@apnex/network-adapter`, NOT a published package.**
The module is a strict subset of a future package: if a generic consumer ever
appears, lift it to `@apnex/tool-manager` then (earned-boundary rule). This doc
also surfaces a distinct architectural debt (§8) — the adapter hardcodes Hub
work-protocol semantics — flagged for a SEPARATE future revisit.
**Mission name:** M-Tool-Manager-Internal-Sovereign-Module (working title)
**Mission class:** internal boundary refactor (NOT a package carve-out)
**Source:** Director directive — "I want a sovereign Tool Manager system that is
shared and agnostic for all shims, then any MCP wrapping can be last mile." +
(v0.2 correction) the standalone-utility test: package-hood is earned by external
utility, which this code lacks today → internal module, not package.
**Authors:** engineer (v0.1–v0.2 draft)
**Lifecycle phase:** 4 Design (draft)
**Axioms in force:** A3 Sovereign Composition (primary), A11 Cognitive Minimalism,
A2 Isomorphic Specification, A0 (umbrella).

---

## §1 Goal + intent

**Goal:** decouple the tool-catalog + tool-dispatch concern inside
`@apnex/network-adapter` into an **internal sovereign module** (own directory +
declared contract + lint-enforced air-gap) whose surface is **host- and
transport-agnostic**. MCP becomes **one last-mile binding** onto it, not the
substrate the behavior is trapped inside. It is NOT a published npm package
(§1.0) — but it is structured as a strict subset of one, so a future package
carve-out is a clean lift if external utility ever materializes.

### 1.0 Package-vs-module decision (RATIFIED — the standalone-utility test)

> A sovereign npm PACKAGE is earned only when the code has **genuine standalone
> utility for a consumer OUTSIDE this adapter**. A sovereign CONCERN (A3) earns a
> clean internal boundary; only demonstrated external utility earns a publish
> boundary.

The tool-dispatch code **fails** the test today. Its dispatch body hardcodes
OIS-Hub verb semantics by name (grep evidence): `signal_working_started/completed`
(×8), `claim_message`/`ack_message`, `create_thread_reply`+`sourceQueueItemId`,
`list_ready_work`+`scopeToCaller`+`claimable` (×14), `work_lease`,
`register_role`/`claim_session`/`drain_pending_actions`. An outside consumer
installing `@apnex/tool-manager` would get a dispatcher that fires
`signal_working_started` at THEIR server — the OIS work-protocol wearing a generic
name. No non-OIS consumer wants this. **→ internal module, not package.**

The distinction between the GENERIC mechanism (catalog projection + a middleware
chain — which WOULD have external utility) and the OIS-specific POLICY (the
verb-semantic behaviors above) is real and is exactly the god-object's "and also"
fault. But splitting mechanism-from-policy into a publishable generic core is only
earned when a real external consumer appears (§8 debt is the deeper form of this).
For now: one clean internal module; the policy stays adapter-side.

**Architectural framing (charter-isomorphic):** *"One tool-dispatch authority,
many host bindings."* This is the adapter-layer instance of the ratified
Control-Plane Charter pattern (`docs/specs/ois-control-plane-charter.md`): the
Hub already separates ONE authority (`router.handle()`) from MANY thin bindings
(MCP, REST). We apply the identical shape one layer out, at the adapter:

- **Authority:** `ToolManager` — owns the catalog (what tools exist, schemas,
  tier) and dispatch (the per-call behavior wrapper). One concern (A3 Law of One).
- **Bindings:** thin, policy-free projections onto `toolManager.dispatch()`:
  - **MCP binding** (`bindToolManagerToMcp`) — the `Server` ListTools/CallTool
    handlers. Consumed by claude + opencode.
  - **Native binding** (pi) — `pi.registerTool()` + `execute() → dispatch()`.
  - future: ACP, raw-CLI, websocket.

**pi is the reference consumer that forces the design honest.** pi is the first
binding that is NOT MCP, so any MCP-shaped leak in the `ToolManager` contract
fails to compile / manifest against the native binding. Per Director: pi defines
the design; claude + opencode re-graft their `CallTool` handlers onto
`bindToolManagerToMcp` with zero functional change.

### 1.1 Why this is axiomatically mandated (not merely nice)

| Axiom | Bearing |
|---|---|
| **A3 Law of One** | tool-manager does exactly one thing. Today it is fused into the MCP `Server` `CallTool` handler — "and also speaks MCP" is the violation. |
| **A3 Air-Gap** | bindings interact with the authority ONLY through a declared contract; no binding reaches the dispatch internals. |
| **A3 "transport swapped without logic noticing"** | the literal definition of "MCP as one last-mile binding." Websocket/ACP become binding leaves. |
| **A11 Deterministic Primitives** | signal-FSM-wrap, queueItemId-injection, idle-gate, lease-observe, dedup are recurring deterministic primitives — must live once, never re-derived per shim (pi re-deriving them in `execute()` = Substrate Leakage fault). |
| **A11 Hydration-as-Offload** | the scoped, tier-filtered, cognitively-enriched catalog is pre-computed for the LLM — the catalog projection is exactly this. |
| **A2 derive-don't-hand-list** | the exposed surface is DERIVED from one catalog walk; no binding hand-lists a tool table (charter §2.3 isomorphism, adapter-level). |

### 1.2 Non-goals

- **NO behavior change** to what claude/opencode do. Pure structural carve-out +
  dependency inversion. Regression parity is the gate.
- **NO new tool semantics.** Same signal-wrap, same queueItemId rules, same
  tier filter. (A3 Composable-by-default: assemble, don't modify.)
- **NO absorbing message-router / poll-backstop / cognitive-layer.** They stay
  sovereign peers; tool-manager composes them via contracts, not by swallowing.

---

## §2 The authority — `ToolManager` contract (agnostic core)

The sovereign surface. Minimal by construction (storage-retro rule: *"contract
minimalism is earned — start minimal, resist additions until a real consumer
demands it"*). Two responsibilities, one package:

```typescript
// The agnostic agent surface the ToolManager needs. Depends on an INTERFACE,
// never on McpAgentClient (A3 Air-Gap — breaks the circular dep, §4).
export interface IToolDispatchAgent {
  readonly state: string;                 // "streaming" | ...
  readonly isConnected: boolean;
  call(method: string, params: Record<string, unknown>, opts?: { internal?: boolean }): Promise<unknown>;
  listTools(): Promise<ToolDescriptor[]>; // already tier-filtered + cognitively enriched
  getMetrics?(): { agentId?: string };
}

// Neutral tool descriptor — MCP-shaped fields but NOT an MCP type
// (name/description/JSON-Schema). This is the bit-perfect interface (A3
// Semantic Bit-Masking) every binding materializes from.
export interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;   // JSON-Schema
}

export interface IToolManager {
  /** Catalog authority — the derive-from-one-walk surface (A2). */
  listTools(agent: IToolDispatchAgent): Promise<ToolDescriptor[]>;

  /**
   * Dispatch authority — the per-call behavior wrapper. This is the code
   * currently TRAPPED in the MCP CallTool handler body. Every binding
   * terminates here (charter binding-invariant #1).
   *
   * Owns: signal_working_* FSM wrap, injectQueueItemId, activeCallCount
   * idle-gate bookkeeping, workLeases.observe, onToolCallResult, error
   * normalization, TOOL_CALL_SIGNAL_SKIP.
   */
  dispatch(
    agent: IToolDispatchAgent,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolDispatchResult>;

  /** idle-gate reads (idea-353 wake/stall reconciler consumes these). */
  getActiveCallCount(): number;
  isIdle(): boolean;
}

// Neutral result — bindings format this into their host shape (MCP content
// array / pi ToolResult). NOT an MCP CallToolResult.
export interface ToolDispatchResult {
  value: unknown;          // raw dispatch return (string or JSON)
  isError: boolean;
  errorMessage?: string;
}
```

**What is NOT in the contract** (earned-minimalism; deferred until a consumer
demands): tool-surface reconciler triggers, poll-backstop, notification hooks —
those are separate sovereign concerns (message-router, kernel) that COMPOSE with
tool-manager, not part of its authority.

---

## §3 The bindings — thin projections (last-mile)

Binding invariant (charter-isomorphic, enforced by review + the pi compile-fence):
1. **Every binding terminates in `toolManager.dispatch()`.** No binding calls
   `agent.call()` directly for LLM-driven tool calls.
2. **No binding re-implements dispatch behavior.** No signal-wrap, no
   queueItemId, no idle-gate in a binding.
3. **No binding hand-lists a tool table.** Surface derived from `listTools()`.

### 3.1 MCP binding — `bindToolManagerToMcp` (claude + opencode)

Owns the `@modelcontextprotocol/sdk` import (moved OUT of the sovereign core).
The `Server` ListTools handler → `toolManager.listTools()` → MCP `{ tools }`.
The `Server` CallTool handler → `toolManager.dispatch()` → format the neutral
`ToolDispatchResult` into MCP `{ content: [...], isError }`. Probe-safe
cache-fallback + retry budget stay in this binding (they are MCP-host quirks:
`claude mcp list` probe, Claude Code initialize timeout — not agnostic
concerns). claude/opencode keep calling `createMcpServer()`; **zero functional
change** — the handler body just moved behind `dispatch()`.

### 3.2 Native binding — pi (`bindToolManagerToPi` or inline in shim)

For each `ToolDescriptor` from `listTools()`:
`pi.registerTool({ name, description, parameters: jsonSchemaToTypebox(inputSchema),
execute: (id, params) => format(await toolManager.dispatch(agent, name, params)) })`.
The JSON-Schema→typebox walk is pi-flavored (typebox is a pi dep) → lives in the
pi shim, NOT the sovereign core (keeps core dependency-neutral). Promote to a
shared helper only if a 2nd native host appears.

---

## §4 Carve-out mechanics — severing the coupling (the real work)

Current `src/tool-manager/*.ts` imports UPWARD into the kernel, which would make
a naive package extraction **circular** (network-adapter → tool-manager →
network-adapter/kernel). Observed upward imports to sever:

- `../kernel/mcp-agent-client.js`, `../kernel/agent-client.js` → replace with
  `IToolDispatchAgent` (interface owned by tool-manager; `McpAgentClient`
  *implements* it structurally — no import needed either direction).
- `../kernel/poll-backstop.js`, `../kernel/state-sync.js` → these belong to the
  **dispatcher-orchestration** concern (PollBackstop wiring, DrainedPendingAction
  routing) which is NOT tool-manager authority. Decision: the current
  `createSharedDispatcher` **super-object splits** — its tool-catalog+dispatch
  half moves to `@apnex/tool-manager`; its poll-backstop/wake-stall/notification
  half stays in `@apnex/network-adapter` (it composes message-router + poll-
  backstop + the ToolManager). This split is itself an A3 Law-of-One correction:
  `createSharedDispatcher` today is a mild god-object ("dispatcher" doing tools
  AND polling AND wake/stall AND notification routing).
- `@apnex/message-router` → stays a **peerDependency** (same pattern message-router
  uses toward network-adapter). Only the notification/routing half needs it, which
  stays in network-adapter — so tool-manager may end up NOT depending on
  message-router at all (cleaner). Confirm in code phase.
- `@modelcontextprotocol/sdk` → moves to the MCP binding (§3.1), OUT of core.

**Package shape (mirror `@apnex/message-router`):**
```
packages/tool-manager/
├── package.json         # @apnex/tool-manager; peerDeps as earned (maybe none)
├── src/
│   ├── index.ts
│   ├── tool-manager.ts       # IToolManager impl — catalog + dispatch authority
│   ├── dispatch.ts           # the extracted CallTool-body behavior wrapper
│   ├── tool-catalog-cache.ts # (moved) — but see §4.1: is cache agnostic?
│   ├── claimable-digest-tracker.ts  # (moved — pure, no MCP)
│   ├── work-lease-tracker.ts        # (moved — pure, no MCP)
│   └── contracts.ts          # IToolDispatchAgent, ToolDescriptor, ToolDispatchResult
├── test/
└── tsconfig.json
```

### 4.1 Open carve-line questions (resolve in code phase)

1. **tool-catalog-cache** — is it agnostic (pure revision-keyed cache) or
   MCP-host-specific (claude on-disk probe cache)? If host-specific, it stays in
   the MCP binding, not the sovereign core.
2. **claimable-digest / work-lease trackers** — pure primitives (A11) → move to
   core cleanly. Confirm no kernel imports.
3. **`createSharedDispatcher` split** — exact seam between "tool authority" (→
   package) and "notification+poll orchestration" (stays). Draft the two new
   surfaces before moving code.
4. **`agent.listTools()` ownership** — it currently lives on `McpAgentClient`
   (does tier-filter + cognitive enrich). Does it stay there (kernel) and
   tool-manager consume it via `IToolDispatchAgent.listTools()`? **Yes** —
   tier-filter is a Hub-annotation concern the agent already owns; tool-manager
   consumes the already-filtered descriptor. Keeps the carve-line clean.

---

## §5 Sequencing (critical path for pi)

1. **Slice A — contracts + interface inversion** (no move): introduce
   `IToolDispatchAgent`, `ToolDescriptor`, `ToolDispatchResult`; make
   `McpAgentClient` satisfy the interface. Zero behavior change.
2. **Slice B — extract dispatch authority**: pull the CallTool-handler body into
   `dispatch()`; rewrite the MCP CallTool handler as a thin caller. Regression
   parity on claude + opencode (all 227 core tests + shim tests green). Still
   in-package.
3. **Slice C — carve to `@apnex/tool-manager`**: move `dispatch.ts`,
   `tool-manager.ts`, the pure trackers, contracts. `bindToolManagerToMcp` lands
   (may live in network-adapter or the shims — decide). network-adapter depends
   on the new package. Regression parity again.
4. **Slice D — pi native binding** (this is M-Pi-Plugin-Adapter): pi shim
   consumes `@apnex/tool-manager` directly.

Slices A+B are reviewable with **zero risk** to shipped hosts (pure refactor).
Slice C is the package boundary. Slice D is the payoff.

---

## §6 Success signals (A3 §Success + charter)

1. `@apnex/tool-manager` has **no** `@modelcontextprotocol/sdk` dependency.
2. pi + opencode + claude all obtain their tool surface from ONE
   `toolManager.listTools()`; no binding hand-lists tools.
3. Every LLM-driven tool call across all three hosts terminates in
   `toolManager.dispatch()`; grep finds no direct `agent.call()` for LLM tools
   in any binding.
4. The package is understandable/testable in isolation from its contract alone
   (A3 Local Reasoning) — unit tests with a fake `IToolDispatchAgent`, no MCP,
   no live Hub.
5. claude/opencode regression suites unchanged and green (non-goal §1.2 held).
6. A future websocket/ACP host needs only a new binding, zero core change.

---

## §7 Dedup observations (Director-flagged byproduct)

- **The god-object**: `createSharedDispatcher` conflates tool-authority +
  poll-orchestration + wake-stall + notification-routing. The carve-out splits
  the first out; the rest is a candidate for further A3 tidy later.
- **MCP-coupling-by-accident**: the entire per-call behavior wrapper was
  MCP-coupled only because history put it in a `CallTool` handler. It was always
  agnostic logic. (A3 Logic Leakage, latent.)
- **Interface-not-class**: depending on `IToolDispatchAgent` rather than
  `McpAgentClient` is the reusable inversion; message-router used peer-dep, this
  goes cleaner with a contract. Worth back-porting the pattern if message-router
  ever needs to drop its network-adapter peer-dep.
- **The standalone-utility test as a boundary tool** (Director, this dialogue):
  the test that a *package* requires demonstrated EXTERNAL utility — not merely a
  clean concern — is what correctly downgraded this from package (C) to internal
  module (B). Record it as a reusable decision heuristic for future carve-outs:
  *sovereign concern earns a boundary; sovereign package earns a publish line.*

---

## §8 FLAGGED ARCHITECTURAL DEBT — Hub work-protocol semantics hardcoded in the adapter (SEPARATE future revisit)

**Out of scope for this mission AND for pi.** Recorded here because this dialogue
surfaced it and A4 Zero-Loss-Knowledge says capture it now.

**The concern (Director-flagged "concerning"):** the adapter — nominally a
transport/binding layer that should move *opaque* tool calls — has grown intimate,
**hardcoded knowledge of specific Hub work-protocol mechanisms**, addressed by
verb name in the dispatch path:

- **thread/queue correlation** — `create_thread_reply` auto-injecting
  `sourceQueueItemId` from a `pendingActionMap` keyed on `thread_message`↔
  `queueItemId` (ADR-017). The adapter knows the thread-reply settlement protocol.
- **activity FSM** — `signal_working_started`/`signal_working_completed` wrapping
  every tool call (mission-62). The adapter knows the Hub's agent-activity states.
- **message lifecycle** — `claim_message`/`ack_message` post-render (mission-56).
- **autonomy loop** — `list_ready_work`/`scopeToCaller`/`claimable`/`work_lease`
  digest + stall-prompt (idea-353).

**Why it's debt (not just style):**
- **Layering violation** — a binding/transport layer encoding server-side
  state-machine semantics is client-side knowledge of a server-side protocol. The
  Hub is the sovereign authority for its own FSMs (Control-Plane Charter §1); the
  adapter re-implementing transition triggers is a fork-of-authority risk.
- **A2 Isomorphic Specification tension** — these behaviors ARE Hub
  state-transitions expressed imperatively in the adapter rather than declared
  by/enforced at the Hub. Doc-code drift + phantom-state risk lives here.
- **The reason tool-manager can't be a generic package** (§1.0) — this debt IS
  the "OIS policy fused into generic mechanism" fault, seen from the other side.

**Candidate future directions (NOT decided — for a dedicated revisit):**
1. **Relocate toward the Hub** — let the Hub drive these transitions server-side
   (e.g. auto-derive activity state from tool-call arrival; settle thread replies
   Hub-side) so the adapter moves opaque calls. Most A2-aligned; largest.
2. **Isolate behind an explicit "OIS work-protocol policy" seam** — keep it
   client-side but as named, swappable middleware registered by the adapter, so
   the generic dispatch mechanism stays clean (and a generic `@apnex/tool-manager`
   package becomes earnable). Middle path; unlocks C later.
3. **Status quo** — accept the coupling; document it. Cheapest; debt persists.

**This mission does #none** — it only draws the internal boundary so the debt is
ISOLATED and visible, not resolved. Resolving it is a separate, larger,
cross-cutting mission touching Hub + adapter. File as an idea for the workgraph
when the pi adapter is live enough to drive it.

---

## §9 Implementation status & deferred roadmap (as-built, 2026-07-01)

Reconciles the §5 *plan* against what actually **shipped**. A4 Zero-Loss-Knowledge:
every deferral discovered *during* implementation is captured here so it lives in
a durable artifact, not only in commit messages or code comments.

### 9.1 What shipped (Slices A–C, all gated at 272/272 green)

| Slice | Commit | Landed | Notes / deviation from §5 |
|---|---|---|---|
| Cleanups | `55ee2ea` | drop vestigial `message-router` peer-dep; add root topo `build`/`build:packages` | prerequisite hygiene, not in original §5 |
| **A** | `4255c34` | `contracts.ts` (`IToolDispatchAgent`, `ToolDescriptor`, `ToolDispatchResult`, `IToolManager`, `ToolDispatchCallOptions`) + compile-time conformance guard | additive; `McpAgentClient` satisfied the interface with **zero class change** (A3 validated) |
| **B** | `1208622` | `runToolDispatch()` in `dispatch/dispatch.ts` = the extracted `CallTool` body; MCP handler is now a thin caller; OIS policy moved to `dispatch/tool-call-policy.ts` | faithful extract, **mechanically proven zero-logic-diff** (105 lines each side) |
| **C** | `9f094e7` | relocate into concern-grouped tree (`dispatch/`, `catalog/`, `work-protocol/`, `orchestrator/`) via git renames | **DEVIATION**: §5 said "carve to `@apnex/tool-manager` package"; downgraded to **internal-module dir-moves** per §1.0 standalone-utility test. No package published. |

### 9.2 Deviation of record: Slice C is NOT a package carve

§5 step 3 described publishing `@apnex/tool-manager`. That was superseded by the
§1.0 ratified decision (internal module B, not package C). Slice C therefore did
**directory relocation inside `network-adapter`**, not a workspace-package split.
Success-signal §6.1 ("no `@modelcontextprotocol/sdk` dependency") is met at the
*module* level (`contracts.ts` + `dispatch/` import no SDK); it is NOT enforced by
a separate package boundary. Re-earning the package requires the §8 debt to be
resolved first (see §9.4 item 5).

### 9.3 Deferred — carried debt introduced/retained by A–C (tracked, non-blocking)

1. **`orchestrator/dispatcher.ts` is still an 880-LOC god-object.** Slice C
   *named* it honestly (`orchestrator/`) but did **not** crack it open.
   `createSharedDispatcher` still conflates: tool-authority assembly +
   poll-orchestration (PollBackstop) + wake/stall reconcile + notification
   routing + the MCP `Server` wiring. **Deferred split** → `orchestrator/` (loop
   assembly) vs `bindings/mcp/` (the `Server`/handler wiring). Ref §7 "the rest
   is a candidate for further A3 tidy later." Gated, mechanical once desired.
2. **`return dispatchResult as any` at the MCP binding boundary** (`orchestrator/
   dispatcher.ts`, CallTool handler). Slice-B placeholder: `runToolDispatch`
   returns the faithful narrow `McpToolCallResult`; the SDK result type is
   broader. **Dissolves** when the binding formats a neutral `ToolDispatchResult`
   into MCP shape (see item 3). Not a permanent scar; documented at call site.
3. **`IToolManager` interface is declared but NOT implemented.** Slice B shipped
   the authority as a *function* (`runToolDispatch`), not the interface's
   `dispatch()`/`listTools()` **class**. `ToolDispatchResult` (neutral return)
   exists but is unused — dispatch still returns MCP-shaped `McpToolCallResult`.
   **Deferred**: assemble a concrete `ToolManager` implementing `IToolManager`,
   returning neutral `ToolDispatchResult`; bindings format to host shape. This is
   what retires item 2 and makes success-signal §6.3 grep-clean.
4. **Success-signal §6.2/§6.3 not yet fully realized.** Only the MCP binding
   routes through the extracted authority today; claude/opencode still consume via
   `createSharedDispatcher`. Full realization ("all three hosts terminate in ONE
   dispatch/listTools") lands with Slice D (pi) + the fold-in of claude/opencode.

### 9.4 Deferred — larger, out of the A–D critical path

5. **§8 Hub work-protocol coupling** — unresolved by design (this mission only
   ISOLATED it in `dispatch/tool-call-policy.ts`). Resolving it (options §8.1–3)
   is the precondition for a genuinely generic, publishable `@apnex/tool-manager`.
   Separate cross-cutting Hub+adapter mission; file to workgraph once pi is live.
6. **Fold claude + opencode onto the new design** — deferred per mission scope
   ("focus is pi now"). Cheap fold-in path: point both shims' bindings at the
   extracted authority. Do after Slice D proves the shape end-to-end.
7. **Drop the `as any` / narrow `ToolDescriptor`** — `ToolDescriptor.inputSchema`
   is permissive (`unknown` + index sig) to mirror the kernel `Tool` so
   `McpAgentClient` conforms unchanged. Revisit only if the contract should become
   *stricter* than the kernel surface (would require narrowing at the kernel).
8. **Back-port `IToolDispatchAgent` inversion to message-router** (§7) — if
   message-router ever needs to shed a network-adapter peer-dep, the
   interface-not-class pattern applies. Speculative; no current demand.

### 9.5 Doc hygiene deferred
- Filename is still `m-sovereign-tool-manager-design.md` though the title is
  "M-Tool-Manager-Internal-Sovereign-Module". Rename pending (low priority; would
  break any external links).
- §5 sequencing text still describes the old package-carve plan; §9.2 is the
  authoritative correction. Left in place as design-history (A4), not rewritten.

### 9.6 Next active step
**Slice D — pi native binding** (`adapters/pi-plugin/`): the payoff. Consumes the
transport-neutral `runToolDispatch` authority directly (pi has no MCP client), via
`tool-bridge.ts` (native `pi.registerTool` → dispatch) + `wake.ts` (wake/stall
render). Facade-only imports. Tracked in `m-pi-plugin-adapter-design.md`.
