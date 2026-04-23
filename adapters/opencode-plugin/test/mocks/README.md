# MockOpenCodeClient — opencode-shim test harness

**Mission:** mission-41 Wave 1 T4 (task-327).
**Scope:** absorbs the opencode-shim portion of idea-104 ("Mock Harness"); sibling to T3's `MockClaudeClient`.

A reusable test harness that drives the REAL
`adapters/opencode-plugin` dispatcher + shim code against a full
in-memory Hub over `LoopbackTransport`. No network, no Bun, no
OpenCode runtime, no LLM calls — fully deterministic and reproducible.

## When to use this

- **Cross-shim parity verification** — prove behaviors claude-plugin
  and opencode-plugin must share (ADR-017 queueItemId capture, SSE →
  dispatcher → Hub ack round-trip) run identically across both backends.
- **Wave 2 workflow-invariant verification** — pairs with T3's
  `MockClaudeClient` to graduate INV-TH18/TH19 in Wave 2.
- **Regression harness for opencode-layer bugs** — see opencode's
  `shim.e2e.test.ts` for the reference pattern.

Do NOT use this for:
- Testing OpenCode's prompt/toast notification surface (that's
  runtime-dependent and orthogonal to the ADR-017 invariants).
- Bun.serve routing tests (use `fetch-handler.test.ts` directly).
- Hub-only policy tests (use `hub/test/e2e/orchestrator.ts`).

## Architecture

```
  opencode-simulating MCP Client                ← InMemoryTransport pair →  real dispatcher.createMcpServer()
   (issues scripted tool calls)                                                 ↓ agent.call()
                                                                         real McpAgentClient
                                                                                ↕ LoopbackTransport
                                                                         real PolicyLoopbackHub
                                                                                ↑ LoopbackTransport
                                                                         real architect McpAgentClient
```

Everything except the outermost MCP Client (which simulates OpenCode's
plugin runtime) and the outermost `LoopbackTransport` (which
substitutes for HTTP) is real production code. Specifically: the real
opencode `createMcpServer()` factory — the same factory the production
`fetchHandler` uses per Initialize — is wired via `InMemoryTransport`,
exercising identical business logic without Bun.

## Quickstart

```ts
import { createMockOpenCodeClient } from "./mocks/MockOpenCodeClient.js";

it("architect → OpenCode → Hub round-trip", async () => {
  const mock = await createMockOpenCodeClient();
  try {
    const openRaw = await mock.architect.call("create_thread", {
      title: "review",
      message: "please review",
      routingMode: "unicast",
      recipientAgentId: mock.engineer.engineerId,
    });
    const { threadId } = JSON.parse(openRaw as string);

    await mock.waitFor((h) => h.engineer.dispatcher.pendingActionMap.size > 0);

    const reply = await mock.opencode.callTool("create_thread_reply", {
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

Tape vocabulary is **aligned with MockClaudeClient** — same `architect`,
`waitFor`, `assert` step kinds, same `${capture.path}` interpolation.
The host-specific step is `opencode` (mirrors T3's `claude`):

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
    kind: "opencode",
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
| `architect` | Architect calls a Hub tool via `McpAgentClient`. Result JSON-parsed; stored at `captures[capture]` if set. |
| `opencode` | Simulated OpenCode plugin-runtime issues an MCP tool call, which the real dispatcher routes to Hub. |
| `waitFor` | Polls `until(h)` every 5 ms; throws on timeout (default 5 s). |
| `assert` | Synchronous or async inline assertion; receives `(harness, captures)`. |

### Shared-format rationale

MockOpenCodeClient and MockClaudeClient share tape spec (step
vocabulary + interpolation semantics) so Wave 2 authors writing
cross-shim parity tests can port scenarios between backends with only
the host-step-kind name changing (`claude` ↔ `opencode`). Runner
implementations are per-backend (~80 LOC each) because extracting a
shared runner would require touching T3; deferred as a future
consolidation candidate if a third backend appears.

## API surface

| Member | Type | Purpose |
|---|---|---|
| `mock.hub` | `PolicyLoopbackHub` | Full in-memory Hub. Inspect `hub.getToolCalls(tool)` for the call log. |
| `mock.architect` | `ActorHandle` | `role`, `agent`, `transport`, `engineerId`, `call(tool, args)` |
| `mock.engineer` | `EngineerActorHandle` | All of `ActorHandle` + `dispatcher` + `mcpClient` |
| `mock.opencode.callTool(name, args)` | MCP passthrough | Sugar for `mock.engineer.mcpClient.callTool({name, arguments: args})` |
| `mock.waitFor(cond, timeoutMs?)` | `Promise<void>` | Polls `cond(harness)` every 5 ms; throws on timeout. |
| `mock.playTape(steps)` | `Promise<TapeResult>` | Runs a scripted scenario; returns `{ captures }`. |
| `mock.stop()` | `Promise<void>` | Idempotent teardown: MCP client → engineer agent → architect agent. |

## Relationship to `shim.e2e.test.ts`

opencode's `shim.e2e.test.ts` was the proof-of-concept (internal
helpers `createArchitect` + `createEngineerWithShim`). This module
extracts them into a public reusable API and adds the `playTape`
abstraction. The existing test file continues to pass unchanged —
its inline helpers mirror this module. Future consumers should import
from here.

## Provenance

- **Task:** task-327 (mission-41 Wave 1 T4)
- **Thread source:** thread-258 (T3 approval + T4 green-light)
- **Idea absorbed:** idea-104 (Mock Harness; opencode-shim portion)
- **Brief:** `docs/reviews/2026-04-phase-4-briefs/m-workflow-test-harness.md` §Scope Wave 1 bullet 1
- **Kickoff-decision:** `docs/missions/mission-41-kickoff-decisions.md` §Decision 2
- **Sibling:** `adapters/claude-plugin/test/mocks/MockClaudeClient.ts` (T3)
