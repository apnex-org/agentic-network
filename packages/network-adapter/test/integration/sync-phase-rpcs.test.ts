/**
 * Invariant #10 — State sync issues get_task + get_pending_actions during
 * the synchronizing phase, strictly after the enriched register_role, and
 * strictly before the state transitions to `streaming`.
 *
 * Ordering matters: the Hub uses the enriched register_role to bind the
 * session to an engineerId + sessionEpoch. The sync RPCs then fetch the
 * directive and pending actions scoped to *that* engineer. If sync ran
 * before the enriched handshake, the Hub wouldn't know which engineer to
 * sync; if sync ran after streaming started, live events would race the
 * initial state fetch.
 *
 * Post-Phase-6: runSynchronizingPhase lives in `McpAgentClient`. It must
 * continue to issue both RPCs between the enriched handshake and
 * completeSync().
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

describe("Invariant #10 — sync phase RPCs", () => {
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

  it("get_task and get_pending_actions fire during synchronizing, after enriched register_role, before streaming", async () => {
    const ticks: StateTick[] = [];
    const callbacks: AgentClientCallbacks = {
      onStateChange: (state, prev, reason) => {
        ticks.push({ state, prev, reason, at: Date.now() });
      },
    };

    agent = new McpAgentClient(
      {
        role: "engineer",
        logger: log.logger,
        handshake: {
          globalInstanceId: "test-instance-uuid-10",
          proxyName: "@ois/test",
          proxyVersion: "1.0.0",
          transport: "test-mcp",
          sdkVersion: "@ois/network-adapter@test",
          getClientInfo: () => ({ name: "test-client", version: "0.0.1" }),
          llmModel: "test-model",
        },
      },
      { transport: new LoopbackTransport(hub) }
    );
    agent.setCallbacks(callbacks);

    await agent.start();

    // Wait until both sync RPCs have landed on the Hub.
    await waitFor(
      () =>
        hub.getToolCalls("get_task").length >= 1 &&
        hub.getToolCalls("get_pending_actions").length >= 1,
      10_000
    );

    // Also wait until we observe the streaming transition — this is the
    // upper bound against which we check ordering.
    await waitFor(() => ticks.some((t) => t.state === "streaming"), 10_000);

    const streamingAt = ticks.find((t) => t.state === "streaming")!.at;

    const registerRoleCalls = hub.getToolCalls("register_role");
    const getTaskCalls = hub.getToolCalls("get_task");
    const getPendingCalls = hub.getToolCalls("get_pending_actions");

    // Enriched register_role is the second call (first is the plain
    // bootstrap call from McpAgentClient.runHandshake).
    expect(registerRoleCalls.length).toBeGreaterThanOrEqual(2);
    const enrichedRegister = registerRoleCalls[1];
    expect(enrichedRegister.args.globalInstanceId).toBe("test-instance-uuid-10");

    expect(getTaskCalls.length).toBeGreaterThanOrEqual(1);
    expect(getPendingCalls.length).toBeGreaterThanOrEqual(1);

    // Ordering: sync RPCs happen strictly after enriched register_role.
    expect(getTaskCalls[0].at).toBeGreaterThanOrEqual(enrichedRegister.at);
    expect(getPendingCalls[0].at).toBeGreaterThanOrEqual(enrichedRegister.at);

    // Ordering: sync RPCs happen strictly before streaming.
    expect(getTaskCalls[0].at).toBeLessThanOrEqual(streamingAt);
    expect(getPendingCalls[0].at).toBeLessThanOrEqual(streamingAt);

    // Cross-check via the Hub's full tool-call log — enriched register_role
    // must appear before both sync RPCs.
    const fullLog = hub.getToolCallLog();
    const enrichedIdx = fullLog.findIndex(
      (c) => c.tool === "register_role" && c.args.globalInstanceId === "test-instance-uuid-10"
    );
    const getTaskIdx = fullLog.findIndex((c) => c.tool === "get_task");
    const getPendingIdx = fullLog.findIndex((c) => c.tool === "get_pending_actions");

    expect(enrichedIdx).toBeGreaterThanOrEqual(0);
    expect(getTaskIdx).toBeGreaterThan(enrichedIdx);
    expect(getPendingIdx).toBeGreaterThan(enrichedIdx);

    // Sync RPCs run on the same session as the enriched register_role.
    expect(getTaskCalls[0].sessionId).toBe(enrichedRegister.sessionId);
    expect(getPendingCalls[0].sessionId).toBe(enrichedRegister.sessionId);
  }, 20_000);
});
