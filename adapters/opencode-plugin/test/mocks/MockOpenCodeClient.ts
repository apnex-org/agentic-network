/**
 * MockOpenCodeClient — Mission-41 Wave 1 T4
 *
 * Reusable test harness that exercises the REAL
 * `adapters/opencode-plugin` dispatcher + shim code against a full
 * in-memory Hub over `LoopbackTransport`. Mirror of T3's
 * `MockClaudeClient` for the opencode backend. No network, no Bun, no
 * OpenCode runtime — fully deterministic and reproducible.
 *
 * Wiring diagram (matches `test/shim.e2e.test.ts` proof-of-concept):
 *
 *   opencode-simulating MCP Client ← InMemoryTransport pair →  real dispatcher.createMcpServer()
 *                                                                    ↓ agent.call()
 *                                                              real McpAgentClient
 *                                                                    ↕ LoopbackTransport
 *                                                              real PolicyLoopbackHub
 *                                                                    ↑ LoopbackTransport
 *                                                              real architect McpAgentClient
 *
 * Tape-step vocabulary is intentionally aligned with MockClaudeClient —
 * same `architect` / `waitFor` / `assert` kinds; the host-specific step
 * is `opencode` (mirrors T3's `claude`). This honors the T4 exit
 * criterion "shared with T3 format if feasible — one spec, two
 * backends". The tape-runner implementation is per-backend inline
 * (duplicate of T3's ~80 LOC); an upstream refactor into
 * `packages/network-adapter/test/helpers/mock-tape.ts` is a reasonable
 * future follow-up when a third backend appears, but deferred now to
 * keep T4 scope tight and T3 untouched.
 *
 * Surface:
 * - `architect` — `ActorHandle` with `.call(tool, args)` for Hub tool calls.
 * - `engineer` — `EngineerActorHandle`: agent + dispatcher + mcpClient + queueMap access.
 * - `opencode` — the MCP Client simulating OpenCode's plugin runtime;
 *   `.callTool` issues tool invocations the dispatcher routes to Hub.
 * - `hub` — the `PolicyLoopbackHub` (shared stores, tool-call log).
 * - `waitFor(cond, timeoutMs?)` — polls until the predicate is truthy.
 * - `playTape(steps)` — declarative scripted-scenario runner.
 * - `stop()` — idempotent teardown (MCP client → engineer agent → architect agent).
 *
 * Designed to be driven by Mission-41 T2 `assertInv*` helpers for
 * cross-shim parity verification (Wave 2 bonus) and for Wave 2 INV-TH18
 * / INV-TH19 graduation.
 */

import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpAgentClient, CognitivePipeline } from "@apnex/network-adapter";
import { LoopbackTransport } from "../../../../packages/network-adapter/test/helpers/loopback-transport.js";
import { PolicyLoopbackHub } from "../../../../packages/network-adapter/test/helpers/policy-loopback.js";
import { createSharedDispatcher, pendingKey } from "@apnex/network-adapter";

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
  readonly dispatcher: ReturnType<typeof createSharedDispatcher>;
  readonly mcpClient: Client;
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
  /** Override the engineer's global instance id. Default = random. */
  engineerGlobalInstanceId?: string;
  /** Override the architect's global instance id. Default = random. */
  architectGlobalInstanceId?: string;
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
 * Build a fully-wired MockOpenCodeHarness backed by real dispatcher/shim code.
 * Cleanup via `harness.stop()`.
 */
export async function createMockOpenCodeClient(
  opts: MockOpenCodeClientOpts = {},
): Promise<MockOpenCodeHarness> {
  const hub = new PolicyLoopbackHub();
  const architect = await buildArchitect(hub, opts.architectGlobalInstanceId);
  const engineer = await buildEngineerWithShim(
    hub,
    opts.cognitive,
    opts.engineerGlobalInstanceId,
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

async function buildEngineerWithShim(
  hub: PolicyLoopbackHub,
  cognitive: CognitivePipeline | undefined,
  globalInstanceId: string | undefined,
): Promise<EngineerActorHandle> {
  const transport = new LoopbackTransport(hub);

  // opencode-plugin uses late-binding getAgent() — dispatcher is created
  // first, then agent, then agentRef is set so dispatcher can reach it.
  // This mirrors production shim.ts wiring.
  let agentRef: McpAgentClient | null = null;
  const dispatcher = createSharedDispatcher({
    getAgent: () => agentRef,
    proxyVersion: "mock-opencode-client-1.0.0",
    serverName: "hub-proxy",
    serverCapabilities: { tools: {}, logging: {} },
  });

  const pendingActionItemHandler = dispatcher.makePendingActionItemHandler();

  const agent = new McpAgentClient(
    {
      role: "engineer",
      handshake: {
        globalInstanceId: globalInstanceId ?? `eng-${randomUUID()}`,
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
  agentRef = agent;

  // Compose the queueMap callback subset — matches test/shim.e2e.test.ts
  // (shim would also compose buildPluginCallbacks for OpenCode-runtime
  // notifications; those are runtime-dependent and orthogonal to the
  // ADR-017 + workflow-invariant surface this mock targets).
  agent.setCallbacks({
    onActionableEvent: (event) => {
      dispatcher.callbacks.onActionableEvent?.(event);
    },
    onInformationalEvent: () => {},
  });

  await agent.start();
  await waitForImpl(() => agent.isConnected, 5_000);
  const sid = transport.getSessionId();
  if (!sid) throw new Error("MockOpenCodeClient: engineer transport did not bind a session");
  const agentId = await hub.agentIdForSession(sid);
  if (!agentId) throw new Error("MockOpenCodeClient: engineer Agent was not created");

  // opencode dispatcher exposes createMcpServer() — the same factory the
  // production fetchHandler uses per Initialize. Wiring it via
  // InMemoryTransport gives identical business-logic coverage without Bun.
  const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
  const mcpServer = dispatcher.createMcpServer();
  await mcpServer.connect(serverTx);
  const mcpClient = new Client(
    { name: "mock-opencode", version: "1.0.0" },
    { capabilities: {} },
  );
  await mcpClient.connect(clientTx);

  return {
    role: "engineer",
    agent,
    transport,
    agentId,
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
