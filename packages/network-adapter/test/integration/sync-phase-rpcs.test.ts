/**
 * bug-343 reconnect state-sync contract.
 *
 * The enriched register_role must bind identity before reconciliation. State
 * sync then issues a store-free get_now probe and the target-filtered queue
 * drain sequentially. Only architects call the architect-only aggregate.
 * list_missions is deliberately absent: using it as a liveness probe hydrated
 * Mission/Idea rows and amplified PostgreSQL scans during fleet reconnects.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LoopbackHub, LoopbackTransport } from "../helpers/loopback-transport.js";
import { LogCapture, waitFor } from "../helpers/test-utils.js";
import { McpAgentClient } from "../../src/kernel/mcp-agent-client.js";
import type {
  AgentClientCallbacks,
  SessionState,
  SessionReconnectReason,
} from "../../src/kernel/agent-client.js";

interface StateTick {
  state: SessionState;
  prev: SessionState;
  reason?: SessionReconnectReason;
  at: number;
}

describe("bug-343 — bounded sync phase RPCs", () => {
  let hub: LoopbackHub;
  let log: LogCapture;
  let agent: McpAgentClient | undefined;

  beforeEach(() => {
    hub = new LoopbackHub();
    log = new LogCapture();
    agent = undefined;
  });

  afterEach(async () => {
    try { if (agent) await agent.stop(); } catch { /* */ }
  });

  function build(role: "engineer" | "architect", name: string, ticks: StateTick[]): McpAgentClient {
    const callbacks: AgentClientCallbacks = {
      onStateChange: (state, prev, reason) => {
        ticks.push({ state, prev, reason, at: Date.now() });
      },
    };
    const client = new McpAgentClient(
      {
        role,
        logger: log.logger,
        handshake: {
          name,
          proxyName: "@apnex/test",
          proxyVersion: "1.0.0",
          transport: "test-mcp",
          sdkVersion: "@apnex/network-adapter@test",
          getClientInfo: () => ({ name: "test-client", version: "0.0.1" }),
          llmModel: "test-model",
        },
      },
      { transport: new LoopbackTransport(hub), reconnectSyncJitterMs: 0 },
    );
    client.setCallbacks(callbacks);
    return client;
  }

  it("engineer sync is register → get_now → drain, with no whole-mission or architect aggregate read", async () => {
    const ticks: StateTick[] = [];
    agent = build("engineer", "test-engineer-sync", ticks);
    await agent.start();

    await waitFor(
      () => hub.getToolCalls("get_now").length === 1 && hub.getToolCalls("drain_pending_actions").length === 1,
      10_000,
    );
    await waitFor(() => ticks.some((t) => t.state === "streaming"), 10_000);

    expect(hub.getToolCalls("list_missions")).toHaveLength(0);
    expect(hub.getToolCalls("get_pending_actions")).toHaveLength(0);

    const full = hub.getToolCallLog();
    const register = full.findIndex((c) => c.tool === "register_role" && c.args.name === "test-engineer-sync");
    const now = full.findIndex((c) => c.tool === "get_now");
    const drain = full.findIndex((c) => c.tool === "drain_pending_actions");
    expect(register).toBeGreaterThanOrEqual(0);
    expect(now).toBeGreaterThan(register);
    expect(drain).toBeGreaterThan(now);
  });

  it("architect sync adds the filtered aggregate sequentially before queue drain", async () => {
    const ticks: StateTick[] = [];
    agent = build("architect", "test-architect-sync", ticks);
    await agent.start();

    await waitFor(
      () => hub.getToolCalls("get_pending_actions").length === 1 && hub.getToolCalls("drain_pending_actions").length === 1,
      10_000,
    );
    await waitFor(() => ticks.some((t) => t.state === "streaming"), 10_000);

    expect(hub.getToolCalls("list_missions")).toHaveLength(0);
    const full = hub.getToolCallLog();
    const register = full.findIndex((c) => c.tool === "register_role" && c.args.name === "test-architect-sync");
    const now = full.findIndex((c) => c.tool === "get_now");
    const pending = full.findIndex((c) => c.tool === "get_pending_actions");
    const drain = full.findIndex((c) => c.tool === "drain_pending_actions");
    expect(now).toBeGreaterThan(register);
    expect(pending).toBeGreaterThan(now);
    expect(drain).toBeGreaterThan(pending);
  });
});
