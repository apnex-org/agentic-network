/**
 * Full-loopback E2E — real dispatcher + real Hub, zero network, no Bun.
 *
 * Wiring (parallels claude-plugin's shim.e2e.test.ts):
 *
 *   Mock MCP Client (stands in for OpenCode)
 *        ↕ MCP SDK InMemoryTransport pair
 *   dispatcher.createMcpServer() (real opencode-plugin MCP Server — the
 *                                  same Server the fetchHandler would
 *                                  instantiate on a real Initialize
 *                                  request; exercising it directly via
 *                                  InMemoryTransport lets us bypass Bun
 *                                  and the HTTP routing while testing
 *                                  identical business logic)
 *        ↓ agent.call()
 *   McpAgentClient
 *        ↕ LoopbackTransport
 *   PolicyLoopbackHub (real Hub: PolicyRouter + all 13 policies +
 *                      in-memory stores + ADR-017 stores)
 *
 * Plus a second McpAgentClient acting as the architect, connected
 * through its own LoopbackTransport to the SAME hub.
 *
 * Why this matters: opencode-plugin had ZERO test coverage before
 * idea-104b. This suite pins the same invariants we pinned for
 * claude-plugin in 104a: the thread-138 SSE-vs-drain race regression,
 * end-to-end completion-ack, and the tool-surface passthrough. Any
 * future regression of the ADR-017 Phase 1.1 fix in opencode will
 * red-light CI by construction.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  McpAgentClient,
  CognitivePipeline,
  CognitiveTelemetry,
  CircuitBreaker,
  HubUnavailableError,
  type TelemetryEvent,
} from "@ois/network-adapter";
import { LoopbackTransport } from "../../../packages/network-adapter/test/helpers/loopback-transport.js";
import { PolicyLoopbackHub } from "../../../packages/network-adapter/test/helpers/policy-loopback.js";
import { createDispatcher, pendingKey } from "../src/dispatcher.js";

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5));
  }
  if (!cond()) throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

function parseResult<T = any>(res: unknown): T {
  if (typeof res === "string") return JSON.parse(res);
  if (res && typeof res === "object") return res as T;
  throw new Error(`Unparseable tool result: ${typeof res}`);
}

interface EngineerHarness {
  agent: McpAgentClient;
  transport: LoopbackTransport;
  engineerId: string;
  dispatcher: ReturnType<typeof createDispatcher>;
  mcpClient: Client;
}

async function createArchitect(hub: PolicyLoopbackHub): Promise<{
  agent: McpAgentClient;
  transport: LoopbackTransport;
  engineerId: string;
}> {
  const transport = new LoopbackTransport(hub);
  const agent = new McpAgentClient(
    {
      role: "architect",
      handshake: {
        globalInstanceId: `arch-${randomUUID()}`,
        proxyName: "opencode-shim-e2e-architect",
        proxyVersion: "0.0.0",
        transport: "loopback",
        sdkVersion: "0.0.0",
        getClientInfo: () => ({ name: "opencode-shim-e2e-architect", version: "0.0.0" }),
      },
    },
    { transport },
  );
  agent.setCallbacks({ onActionableEvent: () => {}, onInformationalEvent: () => {} });
  await agent.start();
  await waitFor(() => agent.isConnected, 5_000);
  const sid = transport.getSessionId();
  if (!sid) throw new Error("architect transport did not bind a session");
  const engineerId = await hub.engineerIdForSession(sid);
  if (!engineerId) throw new Error("architect Agent was not created");
  return { agent, transport, engineerId };
}

async function createEngineerWithShim(
  hub: PolicyLoopbackHub,
  opts: { cognitive?: CognitivePipeline; transportOverride?: LoopbackTransport } = {},
): Promise<EngineerHarness> {
  const transport = opts.transportOverride ?? new LoopbackTransport(hub);

  // Late-binding ref for the dispatcher's getAgent() callback.
  let agentRef: McpAgentClient | null = null;
  const dispatcher = createDispatcher({
    getAgent: () => agentRef,
    proxyVersion: "opencode-e2e-1.0.0",
  });

  const pendingActionItemHandler = dispatcher.makePendingActionItemHandler();

  const agent = new McpAgentClient(
    {
      role: "engineer",
      handshake: {
        globalInstanceId: `eng-${randomUUID()}`,
        proxyName: "@ois/opencode-plugin",
        proxyVersion: "opencode-e2e-1.0.0",
        transport: "bun-serve-proxy",
        sdkVersion: "0.0.0",
        getClientInfo: () => ({ name: "opencode", version: "0.0.0" }),
        onPendingActionItem: (item) => pendingActionItemHandler(item),
      },
    },
    { transport, cognitive: opts.cognitive },
  );
  agentRef = agent;

  // Shim would also compose in OpenCode-specific notification handlers
  // (buildPluginCallbacks) here; we wire the queueMap-population
  // partial directly. That's exactly the subset we need to validate —
  // the shim's toast/prompt layer is OpenCode-runtime-dependent and is
  // orthogonal to the ADR-017 invariants pinned by this suite.
  agent.setCallbacks({
    onActionableEvent: (event) => {
      dispatcher.queueMapCallbacks.onActionableEvent?.(event);
    },
    onInformationalEvent: () => {},
  });

  await agent.start();
  await waitFor(() => agent.isConnected, 5_000);
  const sid = transport.getSessionId();
  if (!sid) throw new Error("engineer transport did not bind a session");
  const engineerId = await hub.engineerIdForSession(sid);
  if (!engineerId) throw new Error("engineer Agent was not created");

  // Wire MCP InMemoryTransport pair. The dispatcher's createMcpServer()
  // is the same factory the fetchHandler uses for every new Initialize;
  // driving it via InMemoryTransport gives us identical business-logic
  // coverage without Bun or HTTP.
  const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
  const mcpServer = dispatcher.createMcpServer();
  await mcpServer.connect(serverTx);
  const mcpClient = new Client(
    { name: "mock-opencode", version: "1.0.0" },
    { capabilities: {} },
  );
  await mcpClient.connect(clientTx);

  return { agent, transport, engineerId, dispatcher, mcpClient };
}

describe("opencode-plugin shim — full-loopback E2E", () => {
  let hub: PolicyLoopbackHub;
  let arch: Awaited<ReturnType<typeof createArchitect>>;
  let eng: EngineerHarness;

  beforeEach(async () => {
    hub = new PolicyLoopbackHub();
    arch = await createArchitect(hub);
    eng = await createEngineerWithShim(hub);
  });

  afterEach(async () => {
    try { await eng.mcpClient.close(); } catch { /* ignore */ }
    try { await eng.agent.stop(); } catch { /* ignore */ }
    try { await arch.agent.stop(); } catch { /* ignore */ }
  });

  // ── Phase 1.1 regression: SSE-inline queueItemId ────────────────────

  it("SSE thread_message with inline queueItemId populates pendingActionMap (thread-138 regression)", async () => {
    const openRaw = await arch.agent.call("create_thread", {
      title: "review",
      message: "please review",
      routingMode: "unicast",
      recipientAgentId: eng.engineerId,
    });
    const threadId = parseResult<{ threadId: string }>(openRaw).threadId;

    await waitFor(() => eng.dispatcher.pendingActionMap.size > 0, 2_000);
    const stored = eng.dispatcher.pendingActionMap.get(pendingKey("thread_message", threadId));
    expect(stored).toBeDefined();
    expect(stored!).toMatch(/^pa-/);
  });

  // ── Happy path: MCP tool call → dispatcher → Hub → completion-ack ──

  it("create_thread_reply via MCP client injects sourceQueueItemId and Hub completion-acks", async () => {
    const openRaw = await arch.agent.call("create_thread", {
      title: "review",
      message: "please review",
      routingMode: "unicast",
      recipientAgentId: eng.engineerId,
    });
    const threadId = parseResult<{ threadId: string }>(openRaw).threadId;

    await waitFor(() => eng.dispatcher.pendingActionMap.size > 0, 2_000);
    const capturedQueueItem = eng.dispatcher.pendingActionMap.get(
      pendingKey("thread_message", threadId),
    );
    expect(capturedQueueItem).toBeDefined();

    const result = await eng.mcpClient.callTool({
      name: "create_thread_reply",
      arguments: { threadId, message: "looks good" },
    });
    expect((result as any).isError).toBeFalsy();

    expect(eng.dispatcher.pendingActionMap.has(pendingKey("thread_message", threadId))).toBe(
      false,
    );

    const replyCalls = hub.getToolCalls("create_thread_reply");
    const finalCall = replyCalls[replyCalls.length - 1];
    expect(finalCall.args.sourceQueueItemId).toBe(capturedQueueItem);

    const items = await hub.stores.pendingAction.listForAgent(eng.engineerId);
    expect(items).toHaveLength(1);
    expect(items[0].state).toBe("completion_acked");
  });

  // ── Explicit sourceQueueItemId precedence ─────────────────────────

  it("explicit sourceQueueItemId from caller wins; dispatcher does not overwrite", async () => {
    const openRaw = await arch.agent.call("create_thread", {
      title: "explicit",
      message: "open",
      routingMode: "unicast",
      recipientAgentId: eng.engineerId,
    });
    const threadId = parseResult<{ threadId: string }>(openRaw).threadId;

    await waitFor(() => eng.dispatcher.pendingActionMap.size > 0, 2_000);
    const mapped = eng.dispatcher.pendingActionMap.get(pendingKey("thread_message", threadId));

    const result = await eng.mcpClient.callTool({
      name: "create_thread_reply",
      arguments: {
        threadId,
        message: "explicit id",
        sourceQueueItemId: "pa-caller-supplied",
      },
    });

    const hubArgs = hub.getToolCalls("create_thread_reply").slice(-1)[0].args;
    expect(hubArgs.sourceQueueItemId).toBe("pa-caller-supplied");

    expect(eng.dispatcher.pendingActionMap.get(pendingKey("thread_message", threadId))).toBe(
      mapped,
    );
    expect(result).toBeDefined();
  });

  // ── tools/list proxies through to Hub tool surface ──────────────────

  it("tools/list via MCP returns the Hub's registered tools through the dispatcher", async () => {
    const result = await eng.mcpClient.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("create_thread");
    expect(names).toContain("create_thread_reply");
    expect(names).toContain("get_thread");
    expect(names).toContain("register_role");
    expect(names.length).toBeGreaterThan(10);
  });

  // ── Unknown tool surfaces error via content block ──────────────────

  it("unknown tool surfaces as an error-text content block (no crash, no silent success)", async () => {
    const result = await eng.mcpClient.callTool({
      name: "nonexistent_tool_xyz",
      arguments: {},
    });
    const content = (result as { content: Array<{ type: string; text: string }> }).content;
    expect(content).toBeDefined();
    expect(content.length).toBeGreaterThan(0);
    const combined = content.map((c) => c.text ?? "").join(" ");
    expect(combined).toMatch(/Unknown tool/i);
    expect(combined).toContain("nonexistent_tool_xyz");
  });

  // ── Hub-not-connected path ──────────────────────────────────────────

  it("CallTool with disconnected hub surfaces 'Hub not connected' (no crash)", async () => {
    // Stop the agent to simulate pre-connection / post-disconnect state.
    await eng.agent.stop();

    const result = await eng.mcpClient.callTool({
      name: "get_thread",
      arguments: { threadId: "anything" },
    });
    const content = (result as { content: Array<{ text: string }> }).content;
    const combined = content.map((c) => c.text ?? "").join(" ");
    expect(combined).toMatch(/Hub not connected/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Cognitive-layer shim-level coverage (M-Cognitive-Hypervisor Phase 1)
// ─────────────────────────────────────────────────────────────────────

describe("opencode-plugin shim — cognitive layer integration", () => {
  let hub: PolicyLoopbackHub;
  let arch: Awaited<ReturnType<typeof createArchitect>>;

  beforeEach(async () => {
    hub = new PolicyLoopbackHub();
    arch = await createArchitect(hub);
  });

  afterEach(async () => {
    try { await arch.agent.stop(); } catch { /* ignore */ }
  });

  it("CognitiveTelemetry captures tool_call events across dispatcher → agent.call", async () => {
    const events: TelemetryEvent[] = [];
    const pipeline = new CognitivePipeline().use(
      new CognitiveTelemetry({ sink: (e) => events.push(e) }),
    );
    const eng = await createEngineerWithShim(hub, { cognitive: pipeline });

    const openRaw = await arch.agent.call("create_thread", {
      title: "cog-telemetry",
      message: "test",
      routingMode: "unicast",
      recipientAgentId: eng.engineerId,
    });
    const threadId = parseResult<{ threadId: string }>(openRaw).threadId;

    await waitFor(() => eng.dispatcher.pendingActionMap.size > 0, 2_000);

    await eng.mcpClient.callTool({
      name: "create_thread_reply",
      arguments: { threadId, message: "cog roundtrip" },
    });

    await new Promise((r) => setTimeout(r, 20));

    const replyCall = events.find(
      (e) => e.kind === "tool_call" && e.tool === "create_thread_reply",
    );
    expect(replyCall).toBeDefined();
    expect(replyCall!.sessionId).toBe(eng.transport.getSessionId());
    expect(typeof replyCall!.durationMs).toBe("number");

    try { await eng.mcpClient.close(); } catch { /* ignore */ }
    try { await eng.agent.stop(); } catch { /* ignore */ }
  });

  it("CircuitBreaker fails fast on induced transport faults", async () => {
    const realTransport = new LoopbackTransport(hub);
    const origRequest = realTransport.request.bind(realTransport);
    let faultNext = 0;
    realTransport.request = async (method, params) => {
      if (faultNext > 0 && method !== "register_role") {
        faultNext--;
        throw new Error("503 Service Unavailable");
      }
      return origRequest(method, params);
    };

    const stateChanges: string[] = [];
    const pipeline = new CognitivePipeline().use(
      new CircuitBreaker({
        failureThreshold: 2,
        cooldownMs: 60_000,
        onStateChange: (c) => stateChanges.push(`${c.from}->${c.to}`),
      }),
    );

    const eng = await createEngineerWithShim(hub, {
      cognitive: pipeline,
      transportOverride: realTransport,
    });

    faultNext = 2;
    await expect(eng.agent.call("list_tele", {})).rejects.toThrow("503");
    await expect(eng.agent.call("list_tele", {})).rejects.toThrow("503");

    faultNext = 0;
    const result = await eng.mcpClient.callTool({
      name: "list_tele",
      arguments: {},
    });
    const content = (result as { content: Array<{ text: string }> }).content;
    const combined = content.map((c) => c.text ?? "").join(" ");
    expect(combined).toContain("circuit breaker tripped");
    expect(stateChanges).toContain("CLOSED->OPEN");

    try { await eng.mcpClient.close(); } catch { /* ignore */ }
    try { await eng.agent.stop(); } catch { /* ignore */ }
  });

  it("standard pipeline composes both middlewares; telemetry observes CircuitBreaker fast-fail", async () => {
    const events: TelemetryEvent[] = [];
    const realTransport = new LoopbackTransport(hub);
    const origRequest = realTransport.request.bind(realTransport);
    let faultNext = 0;
    realTransport.request = async (method, params) => {
      if (faultNext > 0 && method !== "register_role") {
        faultNext--;
        throw new Error("ECONNRESET");
      }
      return origRequest(method, params);
    };

    const pipeline = CognitivePipeline.standard({
      telemetry: { sink: (e) => events.push(e) },
      circuitBreaker: { failureThreshold: 2, cooldownMs: 60_000 },
    });

    const eng = await createEngineerWithShim(hub, {
      cognitive: pipeline,
      transportOverride: realTransport,
    });

    faultNext = 2;
    await expect(eng.agent.call("list_tele", {})).rejects.toThrow();
    await expect(eng.agent.call("list_tele", {})).rejects.toThrow();
    await expect(eng.agent.call("list_tele", {})).rejects.toBeInstanceOf(
      HubUnavailableError,
    );

    await new Promise((r) => setTimeout(r, 20));

    const fastFail = events.find(
      (e) => e.kind === "tool_error" && e.tags?.circuitBreaker === "fast_fail_open",
    );
    expect(fastFail).toBeDefined();

    try { await eng.mcpClient.close(); } catch { /* ignore */ }
    try { await eng.agent.stop(); } catch { /* ignore */ }
  });
});
