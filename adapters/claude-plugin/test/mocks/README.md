# MockClaudeClient — shim-side test harness

**Mission:** mission-41 Wave 1 T3 (task-326).
**Scope:** absorbs the shim-side portion of idea-104 ("Mock Harness").

A reusable test harness that drives the REAL `adapters/claude-plugin`
dispatcher + shim code against a full in-memory Hub over
`LoopbackTransport`. No network, no subprocesses, no LLM calls — fully
deterministic and reproducible.

## When to use this

- **Wave 2 workflow-invariant verification** — the T2 `assertInv*`
  helpers (see `hub/test/e2e/invariant-helpers.ts`) need a multi-agent
  harness to exercise INV-TH18/TH19 (workflow-cascade invariants). This
  module is the source of that harness.
- **Cross-shim adapter tests** — verify dispatcher ↔ Hub contracts
  without standing up Cloud Run or real stdio pipes.
- **Regression harness for adapter-layer bugs** — see `shim.e2e.test.ts`
  for the reference pattern (bug-10 / thread-138 regression).

Do NOT use this for:
- Testing Claude's tool-calling logic itself (the MCP client is a stub).
- Testing Vertex/Gemini architect LLM behavior (separate harness scope;
  intentionally excluded per kickoff-decisions §Decision 3).
- Hub-only policy tests (use `hub/test/e2e/orchestrator.ts` + its
  `ActorFacade` instead — lighter, no dispatcher overhead).

## Architecture

```
  claude-simulating MCP Client                ← InMemoryTransport pair →  real dispatcher.server
   (issues scripted tool calls)                                                 ↓ agent.call()
                                                                         real McpAgentClient
                                                                                ↕ LoopbackTransport
                                                                         real PolicyLoopbackHub
                                                                                ↑ LoopbackTransport
                                                                         real architect McpAgentClient
```

Everything except the outermost MCP Client (which simulates Claude Code)
and the outermost `LoopbackTransport` (which substitutes for HTTP/SSE)
is real production code.

## Quickstart

```ts
import { createMockClaudeClient } from "./mocks/MockClaudeClient.js";

it("architect → Claude → Hub round-trip", async () => {
  const mock = await createMockClaudeClient();
  try {
    const openRaw = await mock.architect.call("create_thread", {
      title: "review",
      message: "please review",
      routingMode: "unicast",
      recipientAgentId: mock.engineer.engineerId,
    });
    const { threadId } = JSON.parse(openRaw as string);

    await mock.waitFor((h) => h.engineer.dispatcher.pendingActionMap.size > 0);

    const reply = await mock.claude.callTool("create_thread_reply", {
      threadId,
      message: "looks good",
    });
    expect(reply).toBeDefined();
  } finally {
    await mock.stop();
  }
});
```

## Scripted tapes (declarative scenarios)

For scenarios that read better as ordered steps than as imperative code,
use `playTape`:

```ts
const { captures } = await mock.playTape([
  {
    kind: "architect",
    tool: "create_thread",
    args: { title: "...", routingMode: "unicast", recipientAgentId: mock.engineer.engineerId },
    capture: "opened",
  },
  {
    kind: "waitFor",
    until: (h) => h.engineer.dispatcher.pendingActionMap.size > 0,
    timeoutMs: 2_000,
  },
  {
    kind: "claude",
    tool: "create_thread_reply",
    args: { threadId: "${opened.threadId}", message: "ok" },
  },
  {
    kind: "assert",
    fn: (h, caps) => expect(h.hub.getToolCalls("create_thread_reply")).toHaveLength(1),
  },
]);
```

### Tape step kinds

| kind | behavior |
|---|---|
| `architect` | Architect calls a Hub tool via `McpAgentClient`. Result JSON-parsed; stored at `captures[capture]` if `capture` is set. |
| `claude` | Simulated Claude Code issues an MCP tool call, which the real dispatcher routes through to Hub. Raw result stored at `captures[capture]`. |
| `waitFor` | Polls `until(h)` every 5ms; throws on timeout (default 5 s). |
| `assert` | Synchronous or async inline assertion; receives `(harness, captures)`. |

### `${...}` placeholder interpolation

String values inside `args` are templated against `captures` via
`${capture.path}` substitution — walks dotted paths. Non-string values
pass through unchanged. Missing paths resolve to empty string (failure
is surfaced at the tool-call level, not at interpolation).

## API surface

| Member | Type | Purpose |
|---|---|---|
| `mock.hub` | `PolicyLoopbackHub` | Full in-memory Hub. Inspect `hub.getToolCalls(tool)` for the call log. |
| `mock.architect` | `ActorHandle` | `role`, `agent`, `transport`, `engineerId`, `call(tool, args)` |
| `mock.engineer` | `EngineerActorHandle` | All of `ActorHandle` + `dispatcher` + `mcpClient` |
| `mock.claude.callTool(name, args)` | MCP passthrough | Sugar for `mock.engineer.mcpClient.callTool({name, arguments: args})` |
| `mock.waitFor(cond, timeoutMs?)` | `Promise<void>` | Polls `cond(harness)` every 5 ms; throws on timeout. |
| `mock.playTape(steps)` | `Promise<TapeResult>` | Runs a scripted scenario; returns `{ captures }`. |
| `mock.stop()` | `Promise<void>` | Idempotent teardown: MCP client → engineer agent → architect agent. |

## Relationship to Wave 2

After T4 lands (MockOpenCodeClient — the mirror for opencode-plugin),
the T2 stub helpers `assertInvTH18` and `assertInvTH19` graduate by
consuming these mocks. The graduation PR will import
`createMockClaudeClient` here (and `createMockOpenCodeClient` from T4)
to drive multi-agent cascade scenarios deterministically.

## Relationship to `shim.e2e.test.ts`

`shim.e2e.test.ts` was the proof-of-concept (internal helpers
`createArchitect` + `createEngineerWithShim`). This module extracts
those into a public reusable API and adds the `playTape` abstraction.
The existing test file continues to pass unchanged — it uses its own
inline helpers, which happen to mirror this module. Future consumers
should import from here instead of hand-rolling.

## Provenance

- **Task:** task-326 (mission-41 Wave 1 T3)
- **Thread source:** thread-257 (T2 approval + T3/T4 parallel-ready)
- **Idea absorbed:** idea-104 (Mock Harness; shim-side portion)
- **Brief:** `docs/reviews/2026-04-phase-4-briefs/m-workflow-test-harness.md` §Scope Wave 1 bullet 1
- **Kickoff-decision:** `docs/missions/mission-41-kickoff-decisions.md` §Decision 2
