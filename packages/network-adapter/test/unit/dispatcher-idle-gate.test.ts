/**
 * idea-353 adapter infra — the dispatcher idle-gate counter + the work-verb
 * tool-call observer the wake/stall reconciler depends on.
 *
 *   - isIdle()/getActiveCallCount() track host-driven CallTool in-flight count
 *     (the AC4 idle-gate input); decremented even when the tool call throws.
 *   - onToolCallResult surfaces (method, args, result) after a CallTool returns
 *     (the W2 lease-observation feed).
 */

import { describe, it, expect, vi } from "vitest";
import {
  createSharedDispatcher,
  type McpAgentClient,
  type SharedDispatcherOptions,
} from "../../src/index.js";

function fakeAgent(callImpl?: (m: string, a: unknown) => Promise<unknown>): McpAgentClient {
  return {
    call: vi.fn(callImpl ?? (async () => "ok")),
    listTools: vi.fn().mockResolvedValue([]),
    setCallbacks: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    isConnected: true,
  } as unknown as McpAgentClient;
}

function callToolHandler(opts: SharedDispatcherOptions) {
  const dispatcher = createSharedDispatcher({ callToolGateTimeoutMs: 0, ...opts });
  const server = dispatcher.createMcpServer();
  const handlers = (server as unknown as {
    _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
  })._requestHandlers;
  const handler = handlers.get("tools/call");
  if (!handler) throw new Error("tools/call handler not registered");
  return { handler, dispatcher };
}

describe("dispatcher idle-gate + tool-call observer — idea-353 infra", () => {
  it("isIdle() is true at rest with getActiveCallCount()===0", () => {
    const { dispatcher } = callToolHandler({ getAgent: () => fakeAgent(), proxyVersion: "t" });
    expect(dispatcher.isIdle()).toBe(true);
    expect(dispatcher.getActiveCallCount()).toBe(0);
  });

  it("a host CallTool flips isIdle() false in flight, back to true after it returns", async () => {
    let resolveCall!: (v: unknown) => void;
    const agent = fakeAgent(
      (method) =>
        // resolve the signal_working_* fire-and-forget calls immediately; keep the
        // real tool call pending so we can observe the in-flight window.
        method.startsWith("signal_")
          ? Promise.resolve("ok")
          : new Promise((r) => {
              resolveCall = r;
            }),
    );
    const { handler, dispatcher } = callToolHandler({
      getAgent: () => agent,
      proxyVersion: "t",
      callToolGate: Promise.resolve(),
    });

    expect(dispatcher.isIdle()).toBe(true);
    const inflight = handler({ method: "tools/call", params: { name: "list_ready_work", arguments: {} } });
    await Promise.resolve(); // let the handler progress past the gate to agent.call
    expect(dispatcher.isIdle()).toBe(false);
    expect(dispatcher.getActiveCallCount()).toBe(1);

    resolveCall("ok");
    await inflight;
    expect(dispatcher.isIdle()).toBe(true);
    expect(dispatcher.getActiveCallCount()).toBe(0);
  });

  it("onToolCallResult observes (method, args, result) after a CallTool returns", async () => {
    const observed: Array<{ method: string; args: unknown; result: unknown }> = [];
    const claimResult = { workItem: { id: "work-1", lease: { expiresAt: "2026-06-27T05:00:00.000Z" } } };
    const agent = fakeAgent(async (method) => (method.startsWith("signal_") ? "ok" : claimResult));
    const { handler } = callToolHandler({
      getAgent: () => agent,
      proxyVersion: "t",
      callToolGate: Promise.resolve(),
      onToolCallResult: (method, args, result) => observed.push({ method, args, result }),
    });

    await handler({ method: "tools/call", params: { name: "claim_work", arguments: { workId: "work-1" } } });

    expect(observed.length).toBe(1);
    expect(observed[0].method).toBe("claim_work");
    expect(observed[0].args).toEqual({ workId: "work-1" });
    expect(observed[0].result).toEqual(claimResult);
  });

  it("the idle-counter is decremented even when the tool call throws", async () => {
    const agent = fakeAgent(async (method) => {
      if (method.startsWith("signal_")) return "ok";
      throw new Error("boom");
    });
    const { handler, dispatcher } = callToolHandler({
      getAgent: () => agent,
      proxyVersion: "t",
      callToolGate: Promise.resolve(),
    });

    await handler({ method: "tools/call", params: { name: "x", arguments: {} } });
    expect(dispatcher.isIdle()).toBe(true); // finally decremented despite the throw
  });

  it("a throwing onToolCallResult hook never breaks the tool-call return", async () => {
    const agent = fakeAgent(async (method) => (method.startsWith("signal_") ? "ok" : { ok: true }));
    const { handler } = callToolHandler({
      getAgent: () => agent,
      proxyVersion: "t",
      callToolGate: Promise.resolve(),
      onToolCallResult: () => {
        throw new Error("observer boom");
      },
    });

    const res = (await handler({ method: "tools/call", params: { name: "y", arguments: {} } })) as {
      isError?: boolean;
    };
    expect(res.isError).toBeUndefined(); // hook throw swallowed; normal result returned
  });
});
