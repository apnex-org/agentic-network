/**
 * Cognitive-layer integration tests — McpAgentClient + CognitivePipeline.
 *
 * Exercises the opt-in `cognitive` config on `McpAgentClient` against a
 * real `PolicyLoopbackHub` (ADR-017 stores wired). Validates:
 *   - Pipeline is inert when not configured (zero cost)
 *   - CognitiveTelemetry captures every call with correct sessionId
 *   - CircuitBreaker trips on induced transport faults + fails-fast
 *     subsequent calls with HubUnavailableError
 *   - Standard pipeline ordering (Telemetry outer, CircuitBreaker inner)
 *     observed end-to-end — Telemetry sees the fast-fail error
 *   - ctx.tags propagate from middleware-annotation through to telemetry
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  CognitivePipeline,
  CognitiveTelemetry,
  CircuitBreaker,
  HubUnavailableError,
  ErrorNormalizer,
  NormalizedError,
  HubReturnedError,
  McpAgentClient,
  type TelemetryEvent,
} from "../../src/index.js";
import { LoopbackTransport } from "../helpers/loopback-transport.js";
import { PolicyLoopbackHub } from "../helpers/policy-loopback.js";

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5));
  }
  if (!cond()) throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

async function flushMicrotasks(iterations = 3): Promise<void> {
  for (let i = 0; i < iterations; i++) await Promise.resolve();
}

async function createAgent(
  hub: PolicyLoopbackHub,
  cognitive?: CognitivePipeline,
): Promise<{
  agent: McpAgentClient;
  transport: LoopbackTransport;
  agentId: string;
}> {
  const transport = new LoopbackTransport(hub);
  const agent = new McpAgentClient(
    {
      role: "engineer",
      handshake: {
        globalInstanceId: `cog-int-${randomUUID()}`,
        proxyName: "cognitive-integration-test",
        proxyVersion: "0.0.0",
        transport: "loopback",
        sdkVersion: "0.0.0",
        getClientInfo: () => ({ name: "cog-test", version: "0.0.0" }),
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
  if (!agentId) throw new Error("Agent entity not created");
  return { agent, transport, agentId };
}

describe("McpAgentClient cognitive integration", () => {
  let hub: PolicyLoopbackHub;

  beforeEach(() => {
    hub = new PolicyLoopbackHub();
  });

  it("no cognitive config → legacy behavior, no pipeline state observed", async () => {
    const { agent } = await createAgent(hub); // no cognitive
    // Call should succeed end-to-end with raw transport.
    const result = await agent.call("list_tele", {});
    expect(result).toBeDefined();
    await agent.stop();
  });

  it("CognitiveTelemetry sink receives tool_call events with sessionId", async () => {
    const events: TelemetryEvent[] = [];
    const pipeline = new CognitivePipeline().use(
      new CognitiveTelemetry({ sink: (e) => events.push(e) }),
    );
    const { agent, transport } = await createAgent(hub, pipeline);
    const sid = transport.getSessionId();

    await agent.call("list_tele", {});
    await agent.call("list_ideas", {});

    await flushMicrotasks(5);

    // Two tool_call events captured (handshake register_role calls
    // ran BEFORE cognitive was active on the call path since the
    // handshake goes through internal transport.request, not agent.call;
    // so only post-handshake calls are observed). One or two events
    // depending on timing; assert at least 2.
    const toolCalls = events.filter((e) => e.kind === "tool_call");
    expect(toolCalls.length).toBeGreaterThanOrEqual(2);
    const listTele = toolCalls.find((e) => e.tool === "list_tele");
    const listIdeas = toolCalls.find((e) => e.tool === "list_ideas");
    expect(listTele).toBeDefined();
    expect(listIdeas).toBeDefined();
    expect(listTele!.sessionId).toBe(sid);
    expect(typeof listTele!.durationMs).toBe("number");

    await agent.stop();
  });

  it("CircuitBreaker trips on transport 5xx stream and fails fast with HubUnavailableError", async () => {
    // Wire a custom transport that induces 5xx on demand. Wrap the real
    // LoopbackTransport's request so we can selectively fault.
    const realTransport = new LoopbackTransport(hub);
    let faultNextN = 0;
    const origRequest = realTransport.request.bind(realTransport);
    realTransport.request = async (method: string, params: Record<string, unknown>) => {
      if (faultNextN > 0) {
        faultNextN--;
        throw new Error("503 Service Unavailable");
      }
      return origRequest(method, params);
    };

    const pipeline = new CognitivePipeline().use(
      new CircuitBreaker({
        failureThreshold: 2,
        cooldownMs: 60_000,
        observationWindowMs: 60_000,
      }),
    );

    const agent = new McpAgentClient(
      {
        role: "engineer",
        handshake: {
          globalInstanceId: `cb-${randomUUID()}`,
          proxyName: "cb-test",
          proxyVersion: "0.0.0",
          transport: "loopback",
          sdkVersion: "0.0.0",
          getClientInfo: () => ({ name: "cb-test", version: "0.0.0" }),
        },
      },
      { transport: realTransport, cognitive: pipeline },
    );
    agent.setCallbacks({ onActionableEvent: () => {}, onInformationalEvent: () => {} });
    await agent.start();
    await waitFor(() => agent.isConnected, 5_000);

    // Induce 2 transport faults → breaker trips
    faultNextN = 2;
    await expect(agent.call("list_tele", {})).rejects.toThrow("503");
    await expect(agent.call("list_tele", {})).rejects.toThrow("503");

    // Next call: no fault intended, but breaker should fail-fast
    faultNextN = 0;
    await expect(agent.call("list_tele", {})).rejects.toBeInstanceOf(HubUnavailableError);

    await agent.stop();
  });

  it("standard pipeline ordering: Telemetry observes CircuitBreaker fast-fail events", async () => {
    const events: TelemetryEvent[] = [];
    const stateChanges: string[] = [];

    const realTransport = new LoopbackTransport(hub);
    const origRequest = realTransport.request.bind(realTransport);
    let faultNextN = 0;
    realTransport.request = async (method: string, params: Record<string, unknown>) => {
      if (faultNextN > 0) {
        faultNextN--;
        throw new Error("ECONNREFUSED");
      }
      return origRequest(method, params);
    };

    const pipeline = CognitivePipeline.standard({
      telemetry: { sink: (e) => events.push(e) },
      circuitBreaker: {
        failureThreshold: 2,
        cooldownMs: 60_000,
        onStateChange: (c) => stateChanges.push(`${c.from}->${c.to}`),
      },
    });

    const agent = new McpAgentClient(
      {
        role: "engineer",
        handshake: {
          globalInstanceId: `std-${randomUUID()}`,
          proxyName: "std-pipeline-test",
          proxyVersion: "0.0.0",
          transport: "loopback",
          sdkVersion: "0.0.0",
          getClientInfo: () => ({ name: "std", version: "0.0.0" }),
        },
      },
      { transport: realTransport, cognitive: pipeline },
    );
    agent.setCallbacks({ onActionableEvent: () => {}, onInformationalEvent: () => {} });
    await agent.start();
    await waitFor(() => agent.isConnected, 5_000);

    // 2 induced faults trip the breaker.
    faultNextN = 2;
    await expect(agent.call("list_tele", {})).rejects.toThrow();
    await expect(agent.call("list_tele", {})).rejects.toThrow();

    // 3rd call fails-fast via breaker.
    await expect(agent.call("list_tele", {})).rejects.toBeInstanceOf(HubUnavailableError);

    await flushMicrotasks(5);

    // Telemetry (outermost) must have recorded the fast-fail error
    // with the circuitBreaker tag populated by the breaker.
    const errorEvents = events.filter((e) => e.kind === "tool_error");
    const fastFail = errorEvents.find(
      (e) => e.tags?.circuitBreaker === "fast_fail_open",
    );
    expect(fastFail).toBeDefined();
    expect(fastFail!.errorMessage).toContain("circuit breaker tripped");

    // State-change sink fired.
    expect(stateChanges).toContain("CLOSED->OPEN");

    await agent.stop();
  });

  it("onToolError phase routes errors through middlewares (recovery pattern)", async () => {
    // Custom middleware that recovers application errors into a structured
    // response — simulates what ErrorNormalizer will do for cascade-drift.
    const recoverer = {
      name: "test-recoverer",
      async onToolError(ctx: unknown, next: (c: unknown) => Promise<unknown>) {
        const e = ctx as { error: unknown };
        if (e.error instanceof Error && e.error.message.includes("recover-me")) {
          return { recovered: true, original: e.error.message };
        }
        return next(ctx);
      },
    };

    const realTransport = new LoopbackTransport(hub);
    const origRequest = realTransport.request.bind(realTransport);
    realTransport.request = async (method: string, _params: Record<string, unknown>) => {
      if (method === "provoke_error") throw new Error("recover-me: fake error");
      return origRequest(method, _params);
    };

    const pipeline = new CognitivePipeline().use(recoverer);
    const agent = new McpAgentClient(
      {
        role: "engineer",
        handshake: {
          globalInstanceId: `err-${randomUUID()}`,
          proxyName: "err-test",
          proxyVersion: "0.0.0",
          transport: "loopback",
          sdkVersion: "0.0.0",
          getClientInfo: () => ({ name: "err", version: "0.0.0" }),
        },
      },
      { transport: realTransport, cognitive: pipeline },
    );
    agent.setCallbacks({ onActionableEvent: () => {}, onInformationalEvent: () => {} });
    await agent.start();
    await waitFor(() => agent.isConnected, 5_000);

    const result = await agent.call("provoke_error", {});
    expect(result).toEqual({ recovered: true, original: "recover-me: fake error" });

    await agent.stop();
  });

  // ── Envelope-aware ErrorNormalizer (Phase 1.1) ────────────────────

  it("cognitive path converts Hub isError envelope → throw so ErrorNormalizer sees it", async () => {
    // Unknown tool on a real Hub → PolicyLoopbackHub returns
    // { isError:true, content:[{text:'{"error":"Unknown tool: foo"}'}] }.
    // Without envelope-detection, the cognitive path would see that as
    // a returned value and never invoke ErrorNormalizer. With the
    // Phase 1.1 fix, agent.call throws HubReturnedError, runToolError
    // runs, and ErrorNormalizer's unknown-tool rule fires.

    const pipeline = new CognitivePipeline().use(
      new ErrorNormalizer({
        knownTools: ["list_tele", "list_ideas", "get_thread", "create_thread"],
      }),
    );
    const { agent } = await createAgent(hub, pipeline);

    try {
      // "list_idaes" — one-letter typo, edit distance 1 from list_ideas
      await agent.call("list_idaes", {});
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NormalizedError);
      const ne = err as NormalizedError;
      expect(ne.rule).toBe("unknown-tool");
      expect(ne.message).toContain("list_idaes");
      expect(ne.message).toContain("Did you mean 'list_ideas'");
      // Raw error is a HubReturnedError wrapping the envelope.
      expect(ne.rawError).toBeInstanceOf(HubReturnedError);
    }

    await agent.stop();
  });

  it("cognitive path: legacy non-cognitive agent.call() preserves envelope-as-return contract", async () => {
    // Sanity: without a cognitive pipeline, Hub isError envelopes come
    // back as return values — existing consumers unbroken.
    const { agent } = await createAgent(hub); // no cognitive
    const result = await agent.call("list_idaes", {});
    expect(result).toBeDefined();
    // The loopback hub wraps error content; legacy contract returns
    // the envelope verbatim.
    expect((result as { isError?: boolean }).isError).toBe(true);
    await agent.stop();
  });
});
