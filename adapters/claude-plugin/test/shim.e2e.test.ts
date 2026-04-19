/**
 * Full-loopback E2E — real dispatcher + real Hub, zero network.
 *
 * Wiring:
 *
 *   Mock MCP Client (simulates Claude Code)
 *        ↕ MCP SDK InMemoryTransport pair
 *   dispatcher.server (real claude-plugin dispatcher under test)
 *        ↓ agent.call()
 *   McpAgentClient
 *        ↕ LoopbackTransport
 *   PolicyLoopbackHub (real Hub: PolicyRouter + all 13 policies +
 *                      in-memory stores including ADR-017 pendingAction
 *                      + directorNotification)
 *
 * Plus a second McpAgentClient acting as the architect, connected through
 * its own LoopbackTransport to the SAME hub — so architect-side events
 * (create_thread, cascade, etc.) route through real Hub logic to the
 * engineer's dispatcher-connected session.
 *
 * This is the regression harness for bug-10 / thread-138 (the SSE-vs-
 * drain race) — each test exercises the actual production code path
 * end-to-end, with the only substitutions being the transport layer
 * (loopback) and the tool consumer (MCP InMemoryTransport client).
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
        proxyName: "shim-e2e-architect",
        proxyVersion: "0.0.0",
        transport: "loopback",
        sdkVersion: "0.0.0",
        getClientInfo: () => ({ name: "shim-e2e-architect", version: "0.0.0" }),
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

  // Build dispatcher lazily — agent needs it for handshake.getClientInfo
  // and onPendingActionItem, but dispatcher needs agent. Mirrors the
  // production shim's forward-reference wiring.
  let dispatcherRef: ReturnType<typeof createDispatcher> | null = null;

  const agent = new McpAgentClient(
    {
      role: "engineer",
      handshake: {
        globalInstanceId: `eng-${randomUUID()}`,
        proxyName: "@ois/claude-plugin",
        proxyVersion: "e2e-1.0.0",
        transport: "stdio-mcp-proxy",
        sdkVersion: "0.0.0",
        getClientInfo: () =>
          dispatcherRef?.getClientInfo() ?? { name: "unknown", version: "0.0.0" },
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
    { transport, cognitive: opts.cognitive },
  );

  const dispatcher = createDispatcher({
    agent,
    proxyVersion: "e2e-1.0.0",
  });
  dispatcherRef = dispatcher;
  agent.setCallbacks(dispatcher.callbacks);

  await agent.start();
  await waitFor(() => agent.isConnected, 5_000);
  const sid = transport.getSessionId();
  if (!sid) throw new Error("engineer transport did not bind a session");
  const engineerId = await hub.engineerIdForSession(sid);
  if (!engineerId) throw new Error("engineer Agent was not created");

  // Wire MCP InMemoryTransport pair — the test-driven MCP client
  // stands in for Claude Code; dispatcher.server is the real proxy.
  const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
  await dispatcher.server.connect(serverTx);
  const mcpClient = new Client(
    { name: "mock-claude-code", version: "1.0.0" },
    { capabilities: {} },
  );
  await mcpClient.connect(clientTx);

  return { agent, transport, engineerId, dispatcher, mcpClient };
}

describe("claude-plugin shim — full-loopback E2E", () => {
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

    // Engineer's dispatcher should have captured queueItemId from the
    // SSE event without any drain having run. This is the precise bug
    // that caused dn-002 / thread-138 before Phase 1.1.
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

    // Simulate Claude Code issuing the settling tool call.
    const result = await eng.mcpClient.callTool({
      name: "create_thread_reply",
      arguments: { threadId, message: "looks good" },
    });
    expect((result as any).isError).toBeFalsy();

    // Dispatcher consumed the map entry.
    expect(eng.dispatcher.pendingActionMap.has(pendingKey("thread_message", threadId))).toBe(
      false,
    );

    // Hub saw the correct sourceQueueItemId.
    const replyCalls = hub.getToolCalls("create_thread_reply");
    const finalCall = replyCalls[replyCalls.length - 1];
    expect(finalCall.args.sourceQueueItemId).toBe(capturedQueueItem);

    // Pending action is terminal (completion_acked) — no watchdog escalation.
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

    // Caller supplies a different (fake) sourceQueueItemId — dispatcher
    // must pass it through unchanged and leave the map entry intact.
    const result = await eng.mcpClient.callTool({
      name: "create_thread_reply",
      arguments: {
        threadId,
        message: "explicit id",
        sourceQueueItemId: "pa-caller-supplied",
      },
    });
    // Hub will reject this (mismatched queue item). That's fine — the
    // contract under test is "dispatcher passes it through".
    const hubArgs = hub.getToolCalls("create_thread_reply").slice(-1)[0].args;
    expect(hubArgs.sourceQueueItemId).toBe("pa-caller-supplied");

    // Map entry remains because we never consumed it.
    expect(eng.dispatcher.pendingActionMap.get(pendingKey("thread_message", threadId))).toBe(
      mapped,
    );
    // Result payload returned; error state is a Hub concern not a dispatcher one.
    expect(result).toBeDefined();
  });

  // ── tools/list proxies the real Hub tool surface ───────────────────

  it("tools/list via MCP returns the Hub's registered tools through the dispatcher", async () => {
    const result = await eng.mcpClient.listTools();
    const names = result.tools.map((t) => t.name);
    // Every Hub tool the PolicyRouter registered should be visible to
    // the downstream MCP client via the dispatcher's re-advertisement.
    expect(names).toContain("create_thread");
    expect(names).toContain("create_thread_reply");
    expect(names).toContain("get_thread");
    expect(names).toContain("register_role");
    // Tool count matches what the Hub exposes (guards against silent
    // drops in the dispatcher → transport → hub chain).
    expect(names.length).toBeGreaterThan(10);
  });

  // ── Unknown-tool error propagation ─────────────────────────────────

  it("unknown tool surfaces as an error-text content block (no crash, no silent success)", async () => {
    const result = await eng.mcpClient.callTool({
      name: "nonexistent_tool_xyz",
      arguments: {},
    });
    const content = (result as { content: Array<{ type: string; text: string }> }).content;
    expect(content).toBeDefined();
    expect(content.length).toBeGreaterThan(0);
    // The dispatcher must surface the Hub's "Unknown tool" error payload
    // into the MCP response body so the downstream LLM sees it and can
    // self-correct. The exact wrapping shape differs between loopback
    // (preserves {isError, content} envelope) and production (strips to
    // parsed body), but the error message itself must reach the client.
    const combined = content.map((c) => c.text ?? "").join(" ");
    expect(combined).toMatch(/Unknown tool/i);
    expect(combined).toContain("nonexistent_tool_xyz");
  });

  // ── InitializeRequest → clientInfo flows into dispatcher ───────────

  it("dispatcher.getClientInfo() captures client info from MCP Initialize", async () => {
    // Initialize already ran during mcpClient.connect(); our client
    // advertised "mock-claude-code" / "1.0.0".
    expect(eng.dispatcher.getClientInfo()).toEqual({
      name: "mock-claude-code",
      version: "1.0.0",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Cognitive-layer shim-level coverage (M-Cognitive-Hypervisor Phase 1)
// ─────────────────────────────────────────────────────────────────────
// Same loopback topology as the tests above, but the engineer's
// McpAgentClient is constructed with a CognitivePipeline. Validates
// that the adapter-layer middlewares (telemetry, circuit breaker)
// operate correctly when driven through the real claude-plugin
// dispatcher and real Hub.

describe("claude-plugin shim — cognitive layer integration", () => {
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

    // Open a thread from architect → engineer so engineer can reply
    const openRaw = await arch.agent.call("create_thread", {
      title: "cog-telemetry",
      message: "test",
      routingMode: "unicast",
      recipientAgentId: eng.engineerId,
    });
    const threadId = parseResult<{ threadId: string }>(openRaw).threadId;

    await waitFor(() => eng.dispatcher.pendingActionMap.size > 0, 2_000);

    // Engineer's MCP client (stands in for Claude Code) calls a tool;
    // dispatcher forwards to agent.call; cognitive pipeline sees it.
    await eng.mcpClient.callTool({
      name: "create_thread_reply",
      arguments: { threadId, message: "cog roundtrip" },
    });

    await new Promise((r) => setTimeout(r, 20)); // let microtasks settle

    const replyCall = events.find(
      (e) => e.kind === "tool_call" && e.tool === "create_thread_reply",
    );
    expect(replyCall).toBeDefined();
    expect(replyCall!.sessionId).toBe(eng.transport.getSessionId());
    expect(typeof replyCall!.durationMs).toBe("number");

    await eng.mcpClient.close();
    await eng.agent.stop();
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

    // Induce two 5xx faults via agent.call directly
    faultNext = 2;
    await expect(eng.agent.call("list_tele", {})).rejects.toThrow("503");
    await expect(eng.agent.call("list_tele", {})).rejects.toThrow("503");

    // Circuit now OPEN. Next call from the MCP client (simulating
    // Claude Code) reaches the dispatcher → agent.call → cognitive
    // pipeline → fast-fail. dispatcher's catch turns the error into an
    // isError content block; the Hub is NOT reached.
    faultNext = 0;
    const result = await eng.mcpClient.callTool({
      name: "list_tele",
      arguments: {},
    });
    const content = (result as { content: Array<{ text: string }> }).content;
    const combined = content.map((c) => c.text ?? "").join(" ");
    expect(combined).toContain("circuit breaker tripped");

    expect(stateChanges).toContain("CLOSED->OPEN");

    await eng.mcpClient.close();
    await eng.agent.stop();
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
    expect(fastFail!.errorMessage).toContain("circuit breaker tripped");

    await eng.mcpClient.close();
    await eng.agent.stop();
  });
});
