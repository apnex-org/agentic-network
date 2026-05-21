/**
 * bug-108 regression — lossless reconnect notification delivery.
 *
 * On reconnect, `performStateSync` drains pending actions and fires
 * `onPendingActionItem` per item. Before bug-108 the claude-plugin shim
 * wired that hook to the diagnostic log only — a notification dispatched
 * while the wire was down was recovered into the queue but never surfaced
 * to the session. This test proves the fix: a reconnect-drained item is
 * surfaced as an actionable `notifications/claude/channel` wake.
 *
 * Wiring (real except the Hub's drain *response*, which is stubbed):
 *
 *   Mock MCP Client (Claude Code stand-in)
 *        ↕ MCP SDK InMemoryTransport pair
 *   real claude-plugin dispatcher + real surfacePendingActionItem
 *        ↕ LoopbackTransport — real reconnect (_simulateWireReconnect)
 *   LoopbackHub (self-contained; drain_pending_actions stubbed)
 *
 * Uses the lightweight `LoopbackHub` rather than `PolicyLoopbackHub` —
 * the latter's harness (`policy-loopback.ts`) is broken on `main`
 * (mission-83 substrate migration removed the stores it imports).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  McpAgentClient,
  createSharedDispatcher,
  pendingKey,
} from "@apnex/network-adapter";
import {
  LoopbackHub,
  LoopbackTransport,
} from "../../../packages/network-adapter/test/helpers/loopback-transport.js";
import { surfacePendingActionItem } from "../src/notification-surface.js";

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5));
  }
  if (!cond()) throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

describe("bug-108 — reconnect-drained pending action surfaces as a wake", () => {
  let hub: LoopbackHub;
  let transport: LoopbackTransport;
  let agent: McpAgentClient;
  let mcpClient: Client;
  // The Hub's drain_pending_actions response — mutated per-test to arm
  // what the next reconnect's performStateSync will recover.
  let drainItems: Array<Record<string, unknown>>;

  beforeEach(async () => {
    hub = new LoopbackHub();
    drainItems = [];
    // Stub the drain RPC: real RPC roundtrip, test-controlled payload.
    hub.setHandler("drain_pending_actions", () => ({ items: drainItems }));
    transport = new LoopbackTransport(hub);

    let dispatcherRef: ReturnType<typeof createSharedDispatcher> | null = null;
    let dispatcherServerRef: Server | null = null;

    agent = new McpAgentClient(
      {
        role: "engineer",
        handshake: {
          globalInstanceId: `eng-${randomUUID()}`,
          proxyName: "@apnex/claude-plugin",
          proxyVersion: "bug108-test",
          transport: "stdio-mcp-proxy",
          sdkVersion: "0.0.0",
          getClientInfo: () =>
            dispatcherRef?.getClientInfo() ?? { name: "unknown", version: "0.0.0" },
          // Mirrors the production claude-plugin shim post-bug-108:
          // makePendingActionItemHandler populates pendingActionMap AND
          // routes the drained item through the real surfacePendingActionItem.
          onPendingActionItem: (item) => {
            if (dispatcherRef) {
              dispatcherRef.makePendingActionItemHandler({
                onPendingActionItem: (drained) =>
                  surfacePendingActionItem(
                    {
                      server: dispatcherServerRef,
                      logPath: join(tmpdir(), "bug-108-test-notifications.log"),
                      log: () => {},
                    },
                    drained,
                  ),
              })(item);
            }
          },
        },
      },
      { transport },
    );

    const dispatcher = createSharedDispatcher({
      getAgent: () => agent,
      proxyVersion: "bug108-test",
    });
    dispatcherRef = dispatcher;
    agent.setCallbacks(dispatcher.callbacks);

    await agent.start();
    await waitFor(() => agent.isConnected, 5_000);

    // Wire the MCP InMemoryTransport pair — the mock client stands in for
    // Claude Code; the dispatcher's MCP Server is the real proxy.
    const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
    const dispatcherServer = dispatcher.createMcpServer();
    dispatcherServerRef = dispatcherServer;
    await dispatcherServer.connect(serverTx);
    mcpClient = new Client(
      { name: "mock-claude-code", version: "1.0.0" },
      { capabilities: {} },
    );
    await mcpClient.connect(clientTx);
  });

  afterEach(async () => {
    try { await mcpClient.close(); } catch { /* ignore */ }
    try { await agent.stop(); } catch { /* ignore */ }
  });

  it("a reconnect-drained thread_message surfaces as a notifications/claude/channel wake", async () => {
    // Capture <channel> notifications at the mock MCP client.
    const channelPushes: Array<{ method: string; params?: any }> = [];
    mcpClient.fallbackNotificationHandler = async (n: any) => {
      if (n?.method === "notifications/claude/channel") channelPushes.push(n);
    };

    // A push that landed while the wire was down — recovered by the next
    // reconnect's drain, never live-delivered.
    const threadId = `thread-bug108-${randomUUID().slice(0, 8)}`;
    drainItems = [
      {
        id: "pa-bug108-1",
        dispatchType: "thread_message",
        entityRef: threadId,
        payload: {
          threadId,
          text: "this reply must survive a reconnect",
          fromRole: "architect",
        },
      },
    ];

    // Pre-condition: nothing surfaced yet (initial sync drained nothing).
    expect(channelPushes).toHaveLength(0);

    // Force a reconnect — sse_watchdog is bug-108's actual cause. The
    // AgentClient re-enters synchronizing → performStateSync →
    // drain_pending_actions → onPendingActionItem → surfacePendingActionItem.
    transport._simulateWireReconnect("sse_watchdog");

    // The drained item MUST reach the session as an actionable <channel>
    // wake — not merely a log line. This is the bug-108 invariant.
    await waitFor(() => channelPushes.length > 0, 5_000);

    const push = channelPushes.find(
      (p) => p.params?.meta?.event === "thread_message",
    );
    expect(
      push,
      "drained thread_message must surface as a notifications/claude/channel wake",
    ).toBeDefined();
    expect(push!.params.meta.threadId).toBe(threadId);
    expect(push!.params.meta.level).toBe("actionable");
    expect(typeof push!.params.content).toBe("string");
    expect((push!.params.content as string).length).toBeGreaterThan(0);
  });
});
