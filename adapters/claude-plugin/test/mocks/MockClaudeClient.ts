/**
 * MockClaudeClient — Mission-41 Wave 1 T3
 *
 * Reusable test harness that exercises the REAL `adapters/claude-plugin`
 * dispatcher + shim code against a full in-memory Hub over
 * `LoopbackTransport`. No network, no subprocesses, deterministic.
 *
 * Wiring diagram (matches `test/shim.e2e.test.ts` proof-of-concept):
 *
 *   claude-simulating MCP Client  ← InMemoryTransport pair →  real dispatcher.server
 *                                                                    ↓ agent.call()
 *                                                              real McpAgentClient
 *                                                                    ↕ LoopbackTransport
 *                                                              real PolicyLoopbackHub
 *                                                                    ↑ LoopbackTransport
 *                                                              real architect McpAgentClient
 *
 * Surface:
 * - `architect` — an `ActorHandle` with `.call(tool, args)` for Hub
 *   tool calls as the architect role.
 * - `engineer` — handle to the engineer-side agent + dispatcher +
 *   dispatcher's pendingActionMap for test-time inspection.
 * - `claude` — the MCP Client simulating Claude Code; `.callTool` issues
 *   tool invocations that the dispatcher routes through to Hub.
 * - `hub` — the `PolicyLoopbackHub` instance (shared stores, Tool-call log).
 * - `waitFor(condition, timeoutMs?)` — polls until the predicate returns
 *   truthy. Matches the in-file helper shim.e2e.test.ts uses.
 * - `playTape(steps)` — sugar for declarative scripted scenarios; each
 *   step is one of the `TapeStep` shapes.
 * - `stop()` — tear down in reverse-creation order; idempotent.
 *
 * Idempotent tape steps (script format) pattern:
 *
 *   await mock.playTape([
 *     { kind: "architect", tool: "create_thread", args: {...}, capture: "t" },
 *     { kind: "waitFor", until: (h) => h.engineer.dispatcher.pendingActionMap.size > 0 },
 *     { kind: "claude",   tool: "create_thread_reply", args: { threadId: "${t.threadId}", message: "ok" } },
 *     { kind: "assert",   fn: (h, captures) => { ... } },
 *   ]);
 *
 * Consumers who want more control skip `playTape` and call the actor
 * handles directly.
 *
 * Designed to be driven by Mission-41 T2 `assertInv*` helpers for Wave 2
 * workflow-invariant verification (TH18/TH19 graduation).
 */

import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpAgentClient, CognitivePipeline } from "@ois/network-adapter";
import { LoopbackTransport } from "../../../../packages/network-adapter/test/helpers/loopback-transport.js";
import { PolicyLoopbackHub } from "../../../../packages/network-adapter/test/helpers/policy-loopback.js";
import { createDispatcher, pendingKey } from "../../src/dispatcher.js";

// ── Public types ────────────────────────────────────────────────────

export interface ActorHandle {
  readonly role: "architect" | "engineer";
  readonly agent: McpAgentClient;
  readonly transport: LoopbackTransport;
  readonly engineerId: string;
  call(tool: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface EngineerActorHandle extends ActorHandle {
  readonly role: "engineer";
  readonly dispatcher: ReturnType<typeof createDispatcher>;
  readonly mcpClient: Client;
}

export interface MockClaudeHarness {
  readonly hub: PolicyLoopbackHub;
  readonly architect: ActorHandle;
  readonly engineer: EngineerActorHandle;
  /** Shorthand for `engineer.mcpClient.callTool` — simulates Claude Code's tool use. */
  readonly claude: {
    callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  };
  waitFor(condition: (h: MockClaudeHarness) => boolean, timeoutMs?: number): Promise<void>;
  playTape(steps: TapeStep[]): Promise<TapeResult>;
  stop(): Promise<void>;
}

export interface MockClaudeClientOpts {
  /** Optional cognitive pipeline override for the engineer's McpAgentClient. */
  cognitive?: CognitivePipeline;
  /** Override the engineer's global instance id. Default = random. */
  engineerGlobalInstanceId?: string;
  /** Override the architect's global instance id. Default = random. */
  architectGlobalInstanceId?: string;
}

export type TapeStep =
  | { kind: "architect"; tool: string; args: Record<string, unknown>; capture?: string }
  | { kind: "claude"; tool: string; args: Record<string, unknown>; capture?: string }
  | { kind: "waitFor"; until: (h: MockClaudeHarness) => boolean; timeoutMs?: number; description?: string }
  | { kind: "assert"; fn: (h: MockClaudeHarness, captures: Record<string, unknown>) => void | Promise<void> };

export interface TapeResult {
  readonly captures: Readonly<Record<string, unknown>>;
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Build a fully-wired MockClaudeHarness backed by real proxy/dispatcher code.
 * Cleanup via `harness.stop()`.
 */
export async function createMockClaudeClient(
  opts: MockClaudeClientOpts = {},
): Promise<MockClaudeHarness> {
  const hub = new PolicyLoopbackHub();
  const architect = await buildArchitect(hub, opts.architectGlobalInstanceId);
  const engineer = await buildEngineerWithShim(
    hub,
    opts.cognitive,
    opts.engineerGlobalInstanceId,
  );

  const harness: MockClaudeHarness = {
    hub,
    architect,
    engineer,
    claude: {
      callTool: (name, args) => engineer.mcpClient.callTool({ name, arguments: args }),
    },
    waitFor: (cond, timeoutMs = 5_000) => waitForImpl(() => cond(harness), timeoutMs),
    playTape: (steps) => playTapeImpl(harness, steps),
    async stop() {
      try { await engineer.mcpClient.close(); } catch { /* ignore */ }
      try { await engineer.agent.stop(); } catch { /* ignore */ }
      try { await architect.agent.stop(); } catch { /* ignore */ }
    },
  };
  return harness;
}

// ── Internal: actor factories ────────────────────────────────────────

async function buildArchitect(
  hub: PolicyLoopbackHub,
  globalInstanceId?: string,
): Promise<ActorHandle> {
  const transport = new LoopbackTransport(hub);
  const agent = new McpAgentClient(
    {
      role: "architect",
      handshake: {
        globalInstanceId: globalInstanceId ?? `arch-${randomUUID()}`,
        proxyName: "mock-claude-client-architect",
        proxyVersion: "0.0.0",
        transport: "loopback",
        sdkVersion: "0.0.0",
        getClientInfo: () => ({ name: "mock-claude-client-architect", version: "0.0.0" }),
      },
    },
    { transport },
  );
  agent.setCallbacks({ onActionableEvent: () => {}, onInformationalEvent: () => {} });
  await agent.start();
  await waitForImpl(() => agent.isConnected, 5_000);
  const sid = transport.getSessionId();
  if (!sid) throw new Error("MockClaudeClient: architect transport did not bind a session");
  const engineerId = await hub.engineerIdForSession(sid);
  if (!engineerId) throw new Error("MockClaudeClient: architect Agent was not created");
  return {
    role: "architect",
    agent,
    transport,
    engineerId,
    call: (tool, args) => agent.call(tool, args),
  };
}

async function buildEngineerWithShim(
  hub: PolicyLoopbackHub,
  cognitive: CognitivePipeline | undefined,
  globalInstanceId: string | undefined,
): Promise<EngineerActorHandle> {
  const transport = new LoopbackTransport(hub);

  // Forward-reference wiring (mirrors production shim.ts):
  // agent needs dispatcher's callbacks + getClientInfo + onPendingActionItem;
  // dispatcher needs the agent. Same pattern as shim.e2e.test.ts.
  let dispatcherRef: ReturnType<typeof createDispatcher> | null = null;

  const agent = new McpAgentClient(
    {
      role: "engineer",
      handshake: {
        globalInstanceId: globalInstanceId ?? `eng-${randomUUID()}`,
        proxyName: "@ois/claude-plugin",
        proxyVersion: "mock-claude-client-1.0.0",
        transport: "stdio-mcp-proxy",
        sdkVersion: "0.0.0",
        getClientInfo: () =>
          dispatcherRef?.getClientInfo() ?? { name: "mock-claude-client", version: "0.0.0" },
        onPendingActionItem: (item) => {
          if (dispatcherRef) {
            dispatcherRef.pendingActionMap.set(
              pendingKey(item.dispatchType, item.entityRef),
              item.id,
            );
          }
        },
      },
    },
    { transport, cognitive },
  );

  const dispatcher = createDispatcher({ agent, proxyVersion: "mock-claude-client-1.0.0" });
  dispatcherRef = dispatcher;
  agent.setCallbacks(dispatcher.callbacks);

  await agent.start();
  await waitForImpl(() => agent.isConnected, 5_000);
  const sid = transport.getSessionId();
  if (!sid) throw new Error("MockClaudeClient: engineer transport did not bind a session");
  const engineerId = await hub.engineerIdForSession(sid);
  if (!engineerId) throw new Error("MockClaudeClient: engineer Agent was not created");

  // Wire MCP InMemoryTransport pair — the client simulates Claude Code.
  const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
  await dispatcher.server.connect(serverTx);
  const mcpClient = new Client(
    { name: "mock-claude-code", version: "1.0.0" },
    { capabilities: {} },
  );
  await mcpClient.connect(clientTx);

  return {
    role: "engineer",
    agent,
    transport,
    engineerId,
    dispatcher,
    mcpClient,
    call: (tool, args) => agent.call(tool, args),
  };
}

// ── Internal: wait helper ────────────────────────────────────────────

async function waitForImpl(cond: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5));
  }
  if (!cond()) throw new Error(`MockClaudeClient.waitFor: condition not met within ${timeoutMs}ms`);
}

// ── Internal: tape interpreter ───────────────────────────────────────

const PLACEHOLDER_RE = /\$\{([a-zA-Z0-9_.]+)\}/g;

/**
 * Minimal `${captureName.path}` substitution — walks the captures object
 * via dotted path. Only applies to string values inside args; other types
 * pass through. Keeps the tape format simple without pulling in a template
 * engine.
 */
function interpolate(
  value: unknown,
  captures: Record<string, unknown>,
): unknown {
  if (typeof value === "string") {
    return value.replace(PLACEHOLDER_RE, (_, path: string) => {
      const parts = path.split(".");
      let cur: unknown = captures;
      for (const p of parts) {
        if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[p];
        } else {
          return "";
        }
      }
      return cur == null ? "" : String(cur);
    });
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, captures));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolate(v, captures);
    }
    return out;
  }
  return value;
}

async function playTapeImpl(
  harness: MockClaudeHarness,
  steps: TapeStep[],
): Promise<TapeResult> {
  const captures: Record<string, unknown> = {};
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const label = `step[${i}]`;
    try {
      switch (step.kind) {
        case "architect": {
          const args = interpolate(step.args, captures) as Record<string, unknown>;
          const raw = await harness.architect.call(step.tool, args);
          const parsed = parseToolResult(raw);
          if (step.capture) captures[step.capture] = parsed;
          break;
        }
        case "claude": {
          const args = interpolate(step.args, captures) as Record<string, unknown>;
          const raw = await harness.claude.callTool(step.tool, args);
          if (step.capture) captures[step.capture] = raw;
          break;
        }
        case "waitFor": {
          await harness.waitFor(step.until, step.timeoutMs ?? 5_000);
          break;
        }
        case "assert": {
          await step.fn(harness, captures);
          break;
        }
        default: {
          const _exhaustive: never = step;
          void _exhaustive;
          throw new Error(`MockClaudeClient.playTape: unknown step kind at ${label}`);
        }
      }
    } catch (err) {
      throw new Error(
        `MockClaudeClient.playTape: ${label} (kind=${step.kind}${step.kind === "architect" || step.kind === "claude" ? `, tool=${step.tool}` : ""}) failed: ${(err as Error).message ?? err}`,
      );
    }
  }
  return { captures };
}

function parseToolResult(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}
