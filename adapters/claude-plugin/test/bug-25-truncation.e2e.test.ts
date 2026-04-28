/**
 * bug-25 truncation reproduction — failing-test-first investigation.
 *
 * Reproduces the symptom observed in thread-243: a ~18KB thread message
 * delivered through the full production code path is truncated somewhere
 * between Hub storage and the receiving LLM's MCP Client input.
 *
 * Wiring (both sides identical — engineer + architect each have full stack):
 *
 *   MockMCPClient ↕ MCP Transport ↕ dispatcher.server → McpAgentClient
 *        ↕ LoopbackTransport ↕ PolicyLoopbackHub
 *
 * Every component is real production code EXCEPT:
 *   (a) LoopbackTransport replaces StreamableHTTPClientTransport (Hub HTTP)
 *   (b) MCP transport variants: in-process stdio (createLinkedStdioPair)
 *       and InMemoryTransport (baseline control)
 *
 * Differential outcomes:
 *   - Both variants FAIL → bug is in Adapter/Hub/Policy layers (not transport)
 *   - Only stdio FAILS → bug is in NDJSON framing / ReadBuffer
 *   - Both variants PASS → bug is outside the harnessed path
 *       (real OS-pipe stdio, real HTTP Hub, or LLM API ingest)
 *
 * Fixture: docs/specs/teles.md — the actual ~18KB payload that truncated
 * in thread-243. Same bytes, same structure.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { McpAgentClient, CognitivePipeline } from "@apnex/network-adapter";
import { LoopbackTransport } from "../../../packages/network-adapter/test/helpers/loopback-transport.js";
import { PolicyLoopbackHub } from "../../../packages/network-adapter/test/helpers/policy-loopback.js";
import { createLinkedStdioPair } from "../../../packages/network-adapter/test/helpers/stdio-linked-transport.js";
import { createSharedDispatcher } from "@apnex/network-adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TELES_FIXTURE = readFileSync(
  join(__dirname, "../../../docs/specs/teles.md"),
  "utf-8",
);

if (TELES_FIXTURE.length < 15000) {
  throw new Error(
    `teles.md fixture smaller than expected (${TELES_FIXTURE.length} bytes) — ` +
      `bug-25 repro needs the full ratified spec to match thread-243's payload size.`,
  );
}

interface TransportPair {
  serverTransport: Transport;
  clientTransport: Transport;
  dispose?: () => void;
}

type CognitiveFactory = (() => CognitivePipeline) | null;

interface Variant {
  name: string;
  createPair: () => TransportPair;
  createCognitive: CognitiveFactory;
}

const TRANSPORTS: Array<{ name: string; createPair: () => TransportPair }> = [
  {
    name: "stdio-linked",
    createPair: () => {
      const pair = createLinkedStdioPair();
      return {
        serverTransport: pair.serverTransport,
        clientTransport: pair.clientTransport,
        dispose: pair.dispose,
      };
    },
  },
  {
    name: "inmemory",
    createPair: () => {
      const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
      return { serverTransport: serverTx, clientTransport: clientTx };
    },
  },
];

const COGNITIVE_VARIANTS: Array<{ name: string; createCognitive: CognitiveFactory }> = [
  { name: "no-cognitive", createCognitive: null },
  {
    name: "standard-cognitive",
    createCognitive: () => CognitivePipeline.standard({}),
  },
];

// Cartesian product: {stdio, inmemory} × {no-cognitive, standard-cognitive}
const VARIANTS: Variant[] = COGNITIVE_VARIANTS.flatMap((c) =>
  TRANSPORTS.map((t) => ({
    name: `${t.name} + ${c.name}`,
    createPair: t.createPair,
    createCognitive: c.createCognitive,
  })),
);

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5));
  }
  if (!cond()) throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

interface AgentHarness {
  role: "engineer" | "architect";
  agentId: string;
  agent: McpAgentClient;
  transport: LoopbackTransport;
  dispatcher: ReturnType<typeof createSharedDispatcher>;
  mcpClient: Client;
  mcpPair: TransportPair;
  capturedNotifications: unknown[];
}

async function createAgentWithMcpShim(
  hub: PolicyLoopbackHub,
  role: "engineer" | "architect",
  transportFactory: () => TransportPair,
  cognitiveFactory: CognitiveFactory,
): Promise<AgentHarness> {
  const transport = new LoopbackTransport(hub);
  let dispatcherRef: ReturnType<typeof createSharedDispatcher> | null = null;

  const agent = new McpAgentClient(
    {
      role,
      handshake: {
        globalInstanceId: `${role === "engineer" ? "eng" : "arch"}-${randomUUID()}`,
        proxyName: "bug-25-test",
        proxyVersion: "e2e-1.0.0",
        transport: "stdio-mcp-proxy",
        sdkVersion: "0.0.0",
        getClientInfo: () =>
          dispatcherRef?.getClientInfo() ?? {
            name: "bug-25-mock-client",
            version: "0.0.0",
          },
      },
    },
    {
      transport,
      ...(cognitiveFactory ? { cognitive: cognitiveFactory() } : {}),
    },
  );

  const dispatcher = createSharedDispatcher({
    getAgent: () => agent,
    proxyVersion: "e2e-1.0.0",
  });
  dispatcherRef = dispatcher;
  agent.setCallbacks(dispatcher.callbacks);

  await agent.start();
  await waitFor(() => agent.isConnected, 5_000);
  const sid = transport.getSessionId();
  if (!sid) throw new Error(`${role} transport did not bind a session`);
  const agentId = await hub.agentIdForSession(sid);
  if (!agentId) throw new Error(`${role} Agent was not created`);

  const mcpPair = transportFactory();
  const dispatcherServer = dispatcher.createMcpServer();
  await dispatcherServer.connect(mcpPair.serverTransport);
  const mcpClient = new Client(
    { name: `bug-25-${role}-client`, version: "1.0.0" },
    { capabilities: {} },
  );

  const capturedNotifications: unknown[] = [];
  (mcpClient as unknown as { fallbackNotificationHandler: (n: unknown) => Promise<void> }).fallbackNotificationHandler =
    async (notification) => {
      capturedNotifications.push(notification);
    };

  await mcpClient.connect(mcpPair.clientTransport);

  return {
    role,
    agentId,
    agent,
    transport,
    dispatcher,
    mcpClient,
    mcpPair,
    capturedNotifications,
  };
}

function extractToolResultText(toolResult: unknown): string {
  const content = (toolResult as { content: Array<{ type: string; text?: string }> }).content;
  if (!Array.isArray(content)) {
    throw new Error(`Tool result has no content array: ${JSON.stringify(toolResult).slice(0, 300)}`);
  }
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}

describe.each(VARIANTS)(
  "bug-25 — thread-message truncation reproduction ($name)",
  ({ createPair, createCognitive }) => {
    let hub: PolicyLoopbackHub;
    let sender: AgentHarness;
    let receiver: AgentHarness;

    beforeEach(async () => {
      hub = new PolicyLoopbackHub();
      sender = await createAgentWithMcpShim(hub, "engineer", createPair, createCognitive);
      receiver = await createAgentWithMcpShim(hub, "architect", createPair, createCognitive);
    });

    afterEach(async () => {
      try { await sender.mcpClient.close(); } catch { /* ignore */ }
      try { await receiver.mcpClient.close(); } catch { /* ignore */ }
      try { await sender.agent.stop(); } catch { /* ignore */ }
      try { await receiver.agent.stop(); } catch { /* ignore */ }
      sender.mcpPair.dispose?.();
      receiver.mcpPair.dispose?.();
    });

    it(`Hub storage preserves full ${TELES_FIXTURE.length}-byte body (Layer 3 rule-out)`, async () => {
      const openRaw = await sender.agent.call("create_thread", {
        title: "bug-25 Hub storage check",
        message: TELES_FIXTURE,
        routingMode: "unicast",
        recipientAgentId: receiver.agentId,
      });
      const openText = typeof openRaw === "string" ? openRaw : JSON.stringify(openRaw);
      const parsed = JSON.parse(openText);
      const threadId = parsed.threadId;
      expect(threadId).toBeTruthy();

      const stored = await hub.stores.thread.getThread(threadId);
      expect(stored).toBeTruthy();
      expect(stored!.messages[0].text.length).toBe(TELES_FIXTURE.length);
      expect(stored!.messages[0].text).toBe(TELES_FIXTURE);
    });

    it(`SEND path: create_thread via MCP tool-call preserves full ${TELES_FIXTURE.length}-byte body`, async () => {
      const openResult = await sender.mcpClient.callTool({
        name: "create_thread",
        arguments: {
          title: "bug-25 SEND path",
          message: TELES_FIXTURE,
          routingMode: "unicast",
          recipientAgentId: receiver.agentId,
        },
      });
      expect((openResult as { isError?: boolean }).isError).toBeFalsy();

      const openText = extractToolResultText(openResult);
      const parsed = JSON.parse(openText);
      const threadId = parsed.threadId;
      expect(threadId).toBeTruthy();

      // Hub-side check: did the full body survive the SEND path?
      const stored = await hub.stores.thread.getThread(threadId);
      expect(stored).toBeTruthy();
      expect(stored!.messages[0].text.length).toBe(TELES_FIXTURE.length);
      expect(stored!.messages[0].text).toBe(TELES_FIXTURE);
    });

    it(`RECEIVE path: get_thread via MCP tool-call preserves full ${TELES_FIXTURE.length}-byte body`, async () => {
      // Prime the thread directly via adapter.call (keeps SEND out of scope)
      const openRaw = await sender.agent.call("create_thread", {
        title: "bug-25 RECEIVE path",
        message: TELES_FIXTURE,
        routingMode: "unicast",
        recipientAgentId: receiver.agentId,
      });
      const openText = typeof openRaw === "string" ? openRaw : JSON.stringify(openRaw);
      const threadId = JSON.parse(openText).threadId;

      // Receiver's MCP client calls get_thread — full pipeline from Hub to
      // MCP tool result. This is the most likely truncation surface.
      const toolResult = await receiver.mcpClient.callTool({
        name: "get_thread",
        arguments: { threadId },
      });
      expect((toolResult as { isError?: boolean }).isError).toBeFalsy();

      const receivedText = extractToolResultText(toolResult);
      const receivedThread = JSON.parse(receivedText);
      expect(receivedThread.messages).toBeDefined();
      expect(receivedThread.messages.length).toBeGreaterThanOrEqual(1);

      const receivedMessageText = receivedThread.messages[0].text;
      // Canonical bug-25 assertion — fails if any byte dropped in the pipeline.
      expect(receivedMessageText.length).toBe(TELES_FIXTURE.length);
      expect(receivedMessageText).toBe(TELES_FIXTURE);
    });

    it(`ROUND-TRIP: sender creates + receiver reads both via MCP — full ${TELES_FIXTURE.length}-byte fidelity`, async () => {
      // Exercises SEND and RECEIVE through MCP back-to-back.
      const openResult = await sender.mcpClient.callTool({
        name: "create_thread",
        arguments: {
          title: "bug-25 round-trip",
          message: TELES_FIXTURE,
          routingMode: "unicast",
          recipientAgentId: receiver.agentId,
        },
      });
      const threadId = JSON.parse(extractToolResultText(openResult)).threadId;

      const toolResult = await receiver.mcpClient.callTool({
        name: "get_thread",
        arguments: { threadId },
      });
      const receivedMessageText = JSON.parse(extractToolResultText(toolResult)).messages[0].text;

      expect(receivedMessageText.length).toBe(TELES_FIXTURE.length);
      expect(receivedMessageText).toBe(TELES_FIXTURE);
    });
  },
);
