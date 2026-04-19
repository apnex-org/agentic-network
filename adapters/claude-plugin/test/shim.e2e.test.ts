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
import { McpAgentClient } from "@ois/network-adapter";
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

async function createEngineerWithShim(hub: PolicyLoopbackHub): Promise<EngineerHarness> {
  const transport = new LoopbackTransport(hub);

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
    { transport },
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

  // Intentionally NOT covered here:
  //   • tools/list — dispatcher's ListToolsRequest handler delegates to
  //     `agent.getTransport().listToolsRaw()`, which is an McpTransport-
  //     specific API that LoopbackTransport doesn't implement. Exercised
  //     in production + dispatcher unit tests; no loopback coverage
  //     until we add a listToolsRaw stub to LoopbackTransport.
  //   • unknown-tool error propagation — depends on McpTransport's
  //     specific error-surfacing path (error JSON in response.content),
  //     which the loopback router doesn't model identically. Unit-test
  //     coverage of the dispatcher catch block exists; loopback fidelity
  //     would be cosmetic.

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
