/**
 * cognitive.e2e.test.ts — pi cognitive-pipeline end-to-end coverage.
 *
 * pi wires `CognitivePipeline.standard(...)` into its McpAgentClient (shim.ts:344)
 * and dispatches every Hub tool through the NATIVE tool-bridge (`runToolDispatch`),
 * NOT an MCP CallTool handler. claude/opencode ship shim.e2e cognitive coverage; pi
 * had none. This drives a real McpAgentClient + CognitivePipeline against a
 * PolicyLoopbackHub THROUGH pi's native bridge, asserting the three cognitive
 * behaviors: ToolResultCache (read-caching + write-flush), WriteCallDedup (in-flight
 * collapse), and probe-tag exemption (a { probe: true } read always round-trips).
 *
 * Note on the bridge path: runToolDispatch signal-wraps each call with
 * signal_working_started/completed — those match no cache write-prefix (create_/…)
 * so they never flush the get_ cache, and they are counted under different verb
 * names, so the per-verb assertions below are unaffected (see tool-result-cache.ts
 * defaultIsWriteTool + tool-call-policy.ts TOOL_CALL_SIGNAL_SKIP).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  McpAgentClient,
  CognitivePipeline,
  ToolResultCache,
  WriteCallDedup,
  WorkLeaseTracker,
  type ToolDispatchContext,
} from "@apnex/network-adapter";
import { LoopbackTransport } from "../../../packages/network-adapter/test/helpers/loopback-transport.js";
import { PolicyLoopbackHub } from "../../../packages/network-adapter/test/helpers/policy-loopback.js";
import { buildPiToolDefinition } from "../src/tool-bridge.js";

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5));
  }
  if (!cond()) throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

// Minimal loopback-backed engineer agent WITH a cognitive pipeline — mirror of
// network-adapter cognitive-integration.test.ts createAgent, pi-flavored name.
async function createPiAgent(
  hub: PolicyLoopbackHub,
  cognitive: CognitivePipeline,
): Promise<{ agent: McpAgentClient; agentId: string }> {
  const transport = new LoopbackTransport(hub);
  const agent = new McpAgentClient(
    {
      role: "engineer",
      handshake: {
        name: `pi-cog-${randomUUID().slice(0, 8)}`,
        proxyName: "pi-cognitive-e2e",
        proxyVersion: "0.0.0",
        transport: "loopback",
        sdkVersion: "0.0.0",
        getClientInfo: () => ({ name: "pi-cog-test", version: "0.0.0" }),
      },
    },
    { transport, cognitive },
  );
  agent.setCallbacks({ onActionableEvent: () => {}, onInformationalEvent: () => {} });
  await agent.start();
  await waitFor(() => agent.isConnected, 5_000);
  const sid = transport.getSessionId();
  if (!sid) throw new Error("transport did not bind a session");
  const agentId = await hub.agentIdForSession(sid);
  if (!agentId) throw new Error("agent entity not created");
  return { agent, agentId };
}

// pi's native ToolDispatchContext (mirror tool-bridge.test.ts makeCtx) pointed at the
// real loopback-backed agent, so the cognitive pipeline inside McpAgentClient.call
// fires on the NATIVE dispatch path.
function makeCtx(agent: McpAgentClient): ToolDispatchContext {
  return {
    getAgent: () => agent,
    pendingActionMap: new Map(),
    workLeases: new WorkLeaseTracker(),
    onCallStart: () => {},
    onCallEnd: () => {},
    log: () => {},
  };
}

// pi's equivalent of claude's mcpClient.callTool — drive a Hub tool through the
// NATIVE bridge (runToolDispatch), the whole reason this coverage is pi-specific.
async function callViaBridge(
  agent: McpAgentClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const def = buildPiToolDefinition({ name }, makeCtx(agent));
  return def.execute("call-1", args as never, undefined, undefined, {} as never);
}

describe("pi-plugin — cognitive pipeline e2e (native tool-bridge)", () => {
  let hub: PolicyLoopbackHub;
  beforeEach(() => {
    hub = new PolicyLoopbackHub();
  });

  it("ToolResultCache: a repeated read is served from cache; a write flushes it (native bridge)", async () => {
    const { agent } = await createPiAgent(
      hub,
      new CognitivePipeline().use(new ToolResultCache({ ttlMs: 30_000 })),
    );
    hub.clearToolCallLog();

    await callViaBridge(agent, "get_agents", {});
    expect(hub.getToolCalls("get_agents")).toHaveLength(1); // cache miss → Hub
    await callViaBridge(agent, "get_agents", {});
    expect(hub.getToolCalls("get_agents")).toHaveLength(1); // cache hit → no Hub

    await callViaBridge(agent, "create_idea", { text: "pi-cache-flush" }); // write flushes cache
    await callViaBridge(agent, "get_agents", {});
    expect(hub.getToolCalls("get_agents")).toHaveLength(2); // miss again after flush

    await agent.stop();
  });

  it("WriteCallDedup: parallel duplicate writes collapse to ONE Hub call (native bridge)", async () => {
    const { agent } = await createPiAgent(
      hub,
      new CognitivePipeline().use(new WriteCallDedup({ windowMs: 10_000 })),
    );
    hub.clearToolCallLog();

    // A self-authored write needs no peer (unlike create_thread's recipient) — fire the
    // SAME create_idea twice in parallel; dedup must collapse to one Hub round-trip.
    const args = { text: "pi-dedup" };
    await Promise.all([
      callViaBridge(agent, "create_idea", args),
      callViaBridge(agent, "create_idea", args),
    ]);
    expect(hub.getToolCalls("create_idea")).toHaveLength(1);

    await agent.stop();
  });

  it("probe-tag: a { probe: true } read is cache-exempt end-to-end (always round-trips)", async () => {
    const { agent } = await createPiAgent(hub, CognitivePipeline.standard({}));
    hub.clearToolCallLog();

    await agent.call("get_agents", {}); // warm the cache (direct; standard includes ToolResultCache)
    expect(hub.getToolCalls("get_agents")).toHaveLength(1);
    await agent.call("get_agents", {}, { probe: true }); // probe → cache-exempt → round-trip
    await agent.call("get_agents", {}, { probe: true });
    expect(hub.getToolCalls("get_agents")).toHaveLength(3);

    await agent.stop();
  });
});
