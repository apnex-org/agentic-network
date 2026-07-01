# M-Claude-OpenCode-Foldin — Design v0.1 (zero-knowledge handoff)

**Status:** v0.1 — DRAFT, ready to pick up. Written so a zero-knowledge agent can
execute it without prior context from the pi/tool-manager dialogue.
**Mission class:** structural-refactor (migrate two shipped shims onto the
corrected adapter architecture; regression-parity-gated).
**Depends on (all SHIPPED):** M-Tool-Manager-Internal-Sovereign-Module Slices A–C
(`m-sovereign-tool-manager-design.md`) + M-Pi-Plugin-Adapter Slice D
(`m-pi-plugin-adapter-design.md`). pi is the **reference implementation** this
mission folds the other two onto.
**Axioms in force:** A3 Sovereign Composition (facade rule, primary), A8 Gated
Recursive Integrity (green-gate every step), A11 Cognitive Minimalism, A4.
**Authoritative arch reference:** `docs/network/00-network-adapter-architecture.md`
(§8 shim inventory + facade-drift note; §9 "Adding a new shim" both-bindings).

---

## §0 TL;DR for the agent picking this up

Two shipped shims — `adapters/claude-plugin` and `adapters/opencode-plugin` — were
written BEFORE the adapter's architecture was corrected. They work, but they
**violate the facade boundary rule** and have not been verified against the new
agnostic dispatch contract. pi (`adapters/pi-plugin`) is the corrected reference.
Your job: fold the two onto pi's proven shape, **without changing their runtime
behavior** (regression parity is the gate), in small green-gated steps.

**The single most important rule:** every step must keep the baseline green:
```
npm test --workspace=@apnex/network-adapter   # must stay 272/272 (or higher)
npm test --workspace=@apnex/claude-plugin
npm test --workspace=@apnex/opencode-plugin
```
Do NOT batch. Each numbered step below is independently committable + gated.

---

## §1 Why this mission exists (context a zero-knowledge agent needs)

### 1.1 What "the corrected architecture" means
- **One dispatch authority, many bindings.** The per-tool-call behavior wrapper
  (signal-FSM `signal_working_*`, `sourceQueueItemId` injection, idle-gate,
  work-lease observe, error normalization) was historically TRAPPED inside the MCP
  `CallTool` handler. It was extracted (Slice B) into `runToolDispatch` in
  `packages/network-adapter/src/tool-manager/dispatch/dispatch.ts` — a
  transport-neutral function. The MCP `CallTool` handler is now a thin caller of
  it. A native host (pi) calls the SAME function directly.
- **The facade boundary rule (A3 Air-Gap).** A host shim depends on
  `@apnex/network-adapter` **ONLY** from the `@apnex/*` graph. That package
  re-exports everything a shim legitimately needs (`CognitivePipeline`, prompt/
  notification helpers, etc.). A shim importing `@apnex/cognitive-layer` or
  `@apnex/message-router` directly is **facade drift** — it couples the shim to
  the package topology, so moving a boundary breaks shims.

### 1.2 The concrete drift to fix (measured 2026-07-01)
| Shim | Drift | Location |
|---|---|---|
| claude | imports `CognitivePipeline` from `@apnex/cognitive-layer` | `src/shim.ts:45` |
| claude | `package.json` deps list `@apnex/cognitive-layer` + `@apnex/message-router` | `package.json` |
| opencode | imports `NotificationCoalescer` + `CoalescedNotification` from `@apnex/message-router` | `src/shim.ts:51-53` |
| opencode | imports `CognitivePipeline` from `@apnex/cognitive-layer` | `src/shim.ts:54` |
| opencode | `package.json` deps list `@apnex/cognitive-layer` + `@apnex/message-router` | `package.json` |

**Facade-export status (checked):**
- `CognitivePipeline` — ALREADY re-exported by the facade → claude's reroute is a
  pure import-path change.
- `NotificationCoalescer` + `CoalescedNotification` — **NOT yet** re-exported →
  **you must add them to the facade FIRST** (§4 step 1) before rerouting opencode.

---

## §2 Non-goals (scope discipline)

- **No behavior change.** This is a boundary/topology refactor, not a feature or
  bugfix mission. If you find a bug, file it separately; do not fold a fix in.
- **NOT the orchestrator god-object split.** `orchestrator/dispatcher.ts` is still
  880 LOC; cracking it into `orchestrator/` + `bindings/mcp/` is a SEPARATE
  committed-backlog item (tool-manager design §9.3 item 1). Out of scope here.
- **NOT the `IToolManager` class / neutral `ToolDispatchResult`.** Both shims (via
  the MCP CallTool handler) already route through `runToolDispatch`. Converting to
  the neutral result type + a `ToolManager` class is backlog items 2–3. Out of scope.
- **NOT vertex-cloudrun.** The Express shim (`agents/vertex-cloudrun`) is a
  distinct host with a preserved public class surface; leave it unless a follow-up
  scopes it in.

---

## §3 Key learnings + gotchas (from building pi — read before touching code)

These are the non-obvious things that cost time during Slice A–D. Internalize them.

1. **The conformance false-green (Slice A).** A compile-time guard that asserts
   `McpAgentClient` satisfies an interface via *direct assignment* can PASS while
   the real consumption shape (a `() => Agent | null` thunk, covariant) FAILS.
   `ToolDescriptor.inputSchema` had to be `unknown` + index signature to be
   bit-perfect with the kernel `Tool`. Lesson: assert the *thunk* shape too. If
   you touch the contract, keep both guards in
   `test/unit/tool-manager-contracts.test.ts` green.
2. **The MCP `as any` at the binding boundary.** `orchestrator/dispatcher.ts`'s
   CallTool handler ends with `return dispatchResult as any` because
   `runToolDispatch` returns a narrow `McpToolCallResult` and the SDK result type
   is broader. This is a KNOWN placeholder (backlog item 2). Do NOT "fix" it in
   this mission by inventing a conversion — that's a separate item. Leave it.
3. **Native vs MCP idle-gate (why the core seam exists).** The dispatcher's
   `activeCallCount` is bumped ONLY inside the MCP CallTool handler. A native host
   bypasses it, so pi supplies `createSharedDispatcher({ externalIdle })`. **This
   does not affect claude/opencode** — they leave `externalIdle` undefined and the
   internal counter stays authoritative. Do not add `externalIdle` to the MCP
   shims; it would be wrong (their calls DO flow through the handler).
4. **`makePendingActionItemHandler(hooks)` already forwards to the hooks.** When
   wiring the drain path, pass your notification hooks INTO
   `makePendingActionItemHandler(notificationHooks)` — it routes through a
   `MessageRouter` (with SeenIdCache dedup) and fires `onPendingActionItem`. Do
   NOT also call the hook manually (double-render, and it bypasses dedup). pi
   originally had this wart; it was cleaned. Don't reintroduce it.
5. **Facade re-export is the mechanism, not a workaround.** The facade
   deliberately re-exports cognitive-layer + message-router symbols so shims never
   import those packages. If a shim needs a symbol the facade lacks, ADD IT TO THE
   FACADE (`packages/network-adapter/src/index.ts`) — do not import through the
   back door.
6. **`readServedRevision` is a legitimate per-shim divergence, not drift.** claude
   reads its on-disk cache; opencode returns `() => null` (no cache). See arch doc
   §8.1. Preserve each shim's existing choice; do not "unify" it.
7. **Regression parity is the ONLY correctness signal here.** These shims have no
   live-Hub CI. The unit/integration suites + a faithful diff are your proof.
   Prefer minimal-diff reroutes over rewrites so the tests can actually catch drift
   (this is exactly how Slice B stayed provably faithful).

---

## §4 The plan — ordered, green-gated steps

### Step 1 — Facade-export the missing symbols (prerequisite for opencode)
`packages/network-adapter/src/index.ts`: re-export `NotificationCoalescer` (value)
and `CoalescedNotification` (type) from `@apnex/message-router`, alongside the
existing message-router re-exports. Build core; `npm test -w @apnex/network-adapter`
(272/272). Additive — zero behavior change.
> Verify: `grep -n "NotificationCoalescer" packages/network-adapter/src/index.ts`.

### Step 2 — Reroute claude imports through the facade
`adapters/claude-plugin/src/shim.ts:45`: change
`import { CognitivePipeline } from "@apnex/cognitive-layer"` →
`from "@apnex/network-adapter"`. Merge into the existing network-adapter import
block. Build + `npm test -w @apnex/claude-plugin` (parity).

### Step 3 — Drop claude's direct `@apnex/*` deps
`adapters/claude-plugin/package.json`: remove `@apnex/cognitive-layer` and
`@apnex/message-router` from `dependencies` (keep `@apnex/network-adapter`).
`npm install`; rebuild; retest. If the build now fails, a symbol is still imported
directly — find it and reroute (loop back to step 2 pattern) or facade-export it
(step 1 pattern). Do NOT re-add the dep to paper over it.

### Step 4 — Reroute opencode imports through the facade
`adapters/opencode-plugin/src/shim.ts:51-54`: change the `@apnex/message-router`
import (`NotificationCoalescer`, `CoalescedNotification`) and the
`@apnex/cognitive-layer` import (`CognitivePipeline`) to `@apnex/network-adapter`.
Merge into the existing network-adapter import block. Build + test (parity).

### Step 5 — Drop opencode's direct `@apnex/*` deps
`adapters/opencode-plugin/package.json`: remove the two direct deps. `npm install`;
rebuild (note opencode ALSO bundles via esbuild — run `npm run bundle` and confirm
the bundle still builds); retest. Same rule as step 3: build failure = a missed
direct import, not a reason to re-add the dep.

### Step 6 — Add the facade lint (make drift detectable by tooling — A3 signal 5)
Add an ESLint `no-restricted-imports` rule scoped to `adapters/*/src/**` banning
`@apnex/cognitive-layer` and `@apnex/message-router` (message: "shims import the
facade @apnex/network-adapter only; add the symbol to the facade if missing").
This mechanizes the rule so a future shim can't silently drift. Confirm it FAILS
on a deliberately-reintroduced bad import, then passes clean.

### Step 7 — Verify both shims against the agnostic path (success-signal §6.2/6.3)
Confirm both shims obtain their tool surface from ONE `agent.listTools()` and that
every LLM tool call terminates in `runToolDispatch` (via the MCP CallTool handler).
`grep` each shim's `src/` for any direct `agent.call(` on an LLM tool (there should
be NONE outside the dispatcher). Document the result. This closes the success
signals from the tool-manager design.

### Step 8 (OPTIONAL, only if scoped in) — adopt any pi-proven tidy
E.g. build-info runtime read pattern, or the notification-hook wiring cleanup.
Each is independently gated. Skip unless the Director scopes it in — the core
mission (steps 1–7) is the boundary correction.

---

## §5 Definition of done

- [ ] `NotificationCoalescer` + `CoalescedNotification` facade-exported (step 1).
- [ ] Neither claude nor opencode `src/**` imports any `@apnex/*` except
      `@apnex/network-adapter` (`grep` clean).
- [ ] Neither `package.json` lists `@apnex/cognitive-layer` or
      `@apnex/message-router` as a dependency.
- [ ] `no-restricted-imports` lint active on `adapters/*/src/**` and passing.
- [ ] All three test suites green; opencode bundle builds.
- [ ] Both shims verified to route tool calls through `runToolDispatch` and take
      their surface from one `listTools()` (success-signals §6.2/6.3 closed).
- [ ] Update arch doc §8: remove the facade-drift note (debt resolved); update the
      shim inventory if any wording changed.
- [ ] Update `m-sovereign-tool-manager-design.md` §9.3 item 4 + §9.4 item 6 to
      mark the fold-in SHIPPED.

---

## §6 Provenance

Written 2026-07-01 by the engineer who built pi (Slice D), at Director request for
a zero-knowledge handoff artifact (A4 Zero-Loss-Knowledge). The learnings in §3
are the actual cost-centers from the A–D arc. Sequenced so the risky part (finding
hidden direct imports) is caught by the build at each step, not at the end.
