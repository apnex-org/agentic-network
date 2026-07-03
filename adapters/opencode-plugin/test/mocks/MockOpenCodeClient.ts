/**
 * MockOpenCodeClient — Mission-41 Wave 1 T4; Mission-101 W5 fidelity upgrade.
 *
 * Reusable no-network OpenCode harness backed by the REAL
 * `createOpenCodeRuntime(...)` seam. The mock no longer creates its own
 * dispatcher or MCP server directly: it consumes the runtime-owned dispatcher
 * and the runtime's OpenCode HTTP fetch-handler factory, then drives that
 * handler in-process through the MCP SDK Streamable HTTP client transport.
 *
 * Wiring diagram:
 *
 *   opencode-simulating MCP Client ← in-process fetch → runtime.makeOpenCodeFetchHandler()
 *                                                             ↓ runtime-owned dispatcher
 *                                                       real McpAgentClient
 *                                                             ↕ LoopbackTransport
 *                                                       real PolicyLoopbackHub
 *                                                             ↑ LoopbackTransport
 *                                                       real architect McpAgentClient
 *
 * Unavoidable host-specific simulation boundary: production connectToHub()
 * reads config and constructs a remote transport, while this mock constructs
 * the engineer McpAgentClient against LoopbackTransport so tests stay offline
 * and deterministic. The production-owned pieces that caused false-green risk
 * — dispatcher construction, notification hooks, pending-action map, and
 * OpenCode MCP fetch bridging — are supplied by createOpenCodeRuntime().
 *
 * Tape-step vocabulary is intentionally aligned with MockClaudeClient — same
 * `architect` / `waitFor` / `assert` kinds; the host-specific step is
 * `opencode` (mirrors T3's `claude`).
 */

import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpAgentClient, CognitivePipeline } from "@apnex/network-adapter";
import { LoopbackTransport } from "../../../../packages/network-adapter/test/helpers/loopback-transport.js";
import { PolicyLoopbackHub } from "../../../../packages/network-adapter/test/helpers/policy-loopback.js";
import { createOpenCodeRuntime, type OpenCodeRuntime } from "../../src/runtime.js";

// ── Public types ────────────────────────────────────────────────────

export interface ActorHandle {
  readonly role: "architect" | "engineer";
  readonly agent: McpAgentClient;
  readonly transport: LoopbackTransport;
  readonly agentId: string;
  call(tool: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface EngineerActorHandle extends ActorHandle {
  readonly role: "engineer";
  /** Runtime instance that owns dispatcher/fetch-handler state for this mock. */
  readonly runtime: OpenCodeRuntime;
  /** Convenience alias for `runtime.testOnly.dispatcher`. */
  readonly dispatcher: OpenCodeRuntime["testOnly"]["dispatcher"];
  readonly mcpClient: Client;
  /** Temp OpenCode workdir used to initialize runtime config/log paths. */
  readonly workDir: string;
}

export interface MockOpenCodeHarness {
  readonly hub: PolicyLoopbackHub;
  readonly architect: ActorHandle;
  readonly engineer: EngineerActorHandle;
  /** Shorthand for `engineer.mcpClient.callTool` — simulates OpenCode's plugin-runtime tool use. */
  readonly opencode: {
    callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  };
  waitFor(condition: (h: MockOpenCodeHarness) => boolean, timeoutMs?: number): Promise<void>;
  playTape(steps: TapeStep[]): Promise<TapeResult>;
  stop(): Promise<void>;
}

export interface MockOpenCodeClientOpts {
  /** Optional cognitive pipeline override for the engineer's McpAgentClient. */
  cognitive?: CognitivePipeline;
  /** Override the engineer's agent name. Default = random. */
  engineerName?: string;
  /** Override the architect's agent name. Default = random. */
  architectName?: string;
}

export type TapeStep =
  | { kind: "architect"; tool: string; args: Record<string, unknown>; capture?: string }
  | { kind: "opencode"; tool: string; args: Record<string, unknown>; capture?: string }
  | { kind: "waitFor"; until: (h: MockOpenCodeHarness) => boolean; timeoutMs?: number; description?: string }
  | { kind: "assert"; fn: (h: MockOpenCodeHarness, captures: Record<string, unknown>) => void | Promise<void> };

export interface TapeResult {
  readonly captures: Readonly<Record<string, unknown>>;
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Build a fully-wired MockOpenCodeHarness backed by the OpenCode runtime seam.
 * Cleanup via `harness.stop()`.
 */
export async function createMockOpenCodeClient(
  opts: MockOpenCodeClientOpts = {},
): Promise<MockOpenCodeHarness> {
  const hub = new PolicyLoopbackHub();
  const architect = await buildArchitect(hub, opts.architectName);
  const engineer = await buildEngineerWithRuntime(
    hub,
    opts.cognitive,
    opts.engineerName,
  );

  const harness: MockOpenCodeHarness = {
    hub,
    architect,
    engineer,
    opencode: {
      callTool: (name, args) => engineer.mcpClient.callTool({ name, arguments: args }),
    },
    waitFor: (cond, timeoutMs = 5_000) => waitForImpl(() => cond(harness), timeoutMs),
    playTape: (steps) => playTapeImpl(harness, steps),
    async stop() {
      try { await engineer.mcpClient.close(); } catch { /* ignore */ }
      try { await engineer.agent.stop(); } catch { /* ignore */ }
      try { engineer.runtime.testOnly.setHubAdapter(null); } catch { /* ignore */ }
      try { engineer.runtime.testOnly.clearProxyServers(); } catch { /* ignore */ }
      try { rmSync(engineer.workDir, { recursive: true, force: true }); } catch { /* ignore */ }
      try { await architect.agent.stop(); } catch { /* ignore */ }
    },
  };
  return harness;
}

// ── Internal: actor factories ────────────────────────────────────────

async function buildArchitect(
  hub: PolicyLoopbackHub,
  name?: string,
): Promise<ActorHandle> {
  const transport = new LoopbackTransport(hub);
  const agent = new McpAgentClient(
    {
      role: "architect",
      handshake: {
        // idea-251: name IS identity (globalInstanceId retired); slice the
        // UUID to clear the Hub's register_role [1,32] name-length limit.
        name: name ?? `arch-${randomUUID().slice(0, 8)}`,
        proxyName: "mock-opencode-client-architect",
        proxyVersion: "0.0.0",
        transport: "loopback",
        sdkVersion: "0.0.0",
        getClientInfo: () => ({ name: "mock-opencode-client-architect", version: "0.0.0" }),
      },
    },
    { transport },
  );
  agent.setCallbacks({ onActionableEvent: () => {}, onInformationalEvent: () => {} });
  await agent.start();
  await waitForImpl(() => agent.isConnected, 5_000);
  const sid = transport.getSessionId();
  if (!sid) throw new Error("MockOpenCodeClient: architect transport did not bind a session");
  const agentId = await hub.agentIdForSession(sid);
  if (!agentId) throw new Error("MockOpenCodeClient: architect Agent was not created");
  return {
    role: "architect",
    agent,
    transport,
    agentId,
    call: (tool, args) => agent.call(tool, args),
  };
}

async function buildEngineerWithRuntime(
  hub: PolicyLoopbackHub,
  cognitive: CognitivePipeline | undefined,
  name: string | undefined,
): Promise<EngineerActorHandle> {
  const transport = new LoopbackTransport(hub);
  const workDir = mkdtempSync(join(tmpdir(), "mock-opencode-client-"));
  const runtime = createOpenCodeRuntime({
    initialRole: "engineer",
    startupDelayMs: 0,
    // Initialize config/sdk/log paths through HubPlugin without firing the
    // live OpenCode startup side effects (connectToHub/Bun.serve/mcp.add).
    setTimeoutFn: ((() => 0) as unknown as typeof setTimeout),
  });
  const pluginInput = {
    directory: workDir,
    client: fakeOpenCodeClient(),
  } as Parameters<OpenCodeRuntime["plugin"]>[0];
  await runtime.plugin(pluginInput);
  const dispatcher = runtime.testOnly.dispatcher;
  const pendingActionItemHandler = dispatcher.makePendingActionItemHandler();

  const agent = new McpAgentClient(
    {
      role: "engineer",
      handshake: {
        // idea-251: name IS identity (globalInstanceId retired); slice the
        // UUID to clear the Hub's register_role [1,32] name-length limit.
        name: name ?? `eng-${randomUUID().slice(0, 8)}`,
        proxyName: "@apnex/opencode-plugin",
        proxyVersion: "mock-opencode-client-1.0.0",
        transport: "bun-serve-proxy",
        sdkVersion: "0.0.0",
        getClientInfo: () => ({ name: "mock-opencode", version: "0.0.0" }),
        onPendingActionItem: (item) => pendingActionItemHandler(item),
      },
    },
    { transport, cognitive },
  );

  // Mirror production connectToHub(): the runtime owns the hubAdapter ref and
  // the agent callbacks are the runtime-owned dispatcher's callbacks.
  runtime.testOnly.setHubAdapter(agent);
  agent.setCallbacks(dispatcher.callbacks);

  await agent.start();
  await waitForImpl(() => agent.isConnected, 5_000);
  const sid = transport.getSessionId();
  if (!sid) throw new Error("MockOpenCodeClient: engineer transport did not bind a session");
  const agentId = await hub.agentIdForSession(sid);
  if (!agentId) throw new Error("MockOpenCodeClient: engineer Agent was not created");

  // Drive the production OpenCode MCP fetch bridge in-process. The MCP SDK's
  // Streamable HTTP client accepts an injectable fetch implementation, so this
  // remains no-network/no-Bun while covering runtime.makeOpenCodeFetchHandler().
  const fetchHandler = runtime.makeOpenCodeFetchHandler();
  const httpTransport = new StreamableHTTPClientTransport(
    new URL("http://mock-opencode.local/mcp"),
    { fetch: makeInProcessFetch(fetchHandler) },
  );
  const mcpClient = new Client(
    { name: "mock-opencode", version: "1.0.0" },
    { capabilities: {} },
  );
  await mcpClient.connect(httpTransport);

  return {
    role: "engineer",
    agent,
    transport,
    agentId,
    runtime,
    dispatcher,
    mcpClient,
    workDir,
    call: (tool, args) => agent.call(tool, args),
  };
}

function fakeOpenCodeClient() {
  return {
    session: {
      list: async () => ({ data: [] }),
      promptAsync: async () => {},
    },
    tui: { showToast: async () => {} },
    mcp: { add: async () => {} },
  };
}

function makeInProcessFetch(
  fetchHandler: (req: Request) => Promise<Response>,
): typeof fetch {
  return async (input, init) => {
    const req = input instanceof Request
      ? (init ? new Request(input, init) : input)
      : new Request(input, init);
    return fetchHandler(req);
  };
}

// ── Internal: wait helper ────────────────────────────────────────────

async function waitForImpl(cond: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5));
  }
  if (!cond()) throw new Error(`MockOpenCodeClient.waitFor: condition not met within ${timeoutMs}ms`);
}

// ── Internal: tape interpreter ───────────────────────────────────────
// Shape-aligned with T3's MockClaudeClient.playTape — same step
// vocabulary, same `${capture.path}` interpolation semantics. Runner
// is duplicated (~80 LOC) rather than extracted to a shared helper, to
// keep T4 scope tight and T3 untouched. Future consolidation candidate.

const PLACEHOLDER_RE = /\$\{([a-zA-Z0-9_.]+)\}/g;

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
  harness: MockOpenCodeHarness,
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
        case "opencode": {
          const args = interpolate(step.args, captures) as Record<string, unknown>;
          const raw = await harness.opencode.callTool(step.tool, args);
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
          throw new Error(`MockOpenCodeClient.playTape: unknown step kind at ${label}`);
        }
      }
    } catch (err) {
      throw new Error(
        `MockOpenCodeClient.playTape: ${label} (kind=${step.kind}${step.kind === "architect" || step.kind === "opencode" ? `, tool=${step.tool}` : ""}) failed: ${(err as Error).message ?? err}`,
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
