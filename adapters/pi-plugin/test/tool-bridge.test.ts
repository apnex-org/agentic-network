/**
 * tool-bridge.test.ts — pi native tool binding unit tests.
 *
 * Proves (A3 Local Reasoning — no live Hub, no pi runtime, a fake agent):
 *   1. descriptor.inputSchema (JSON-Schema) is adopted verbatim as typebox.
 *   2. a missing/non-object schema falls back to an open object.
 *   3. execute() routes through runToolDispatch → the SAME dispatch authority
 *      the MCP path uses, so the native binding inherits signal-FSM wrapping,
 *      queueItemId injection, and lease observation for free (the M18 anti-drift
 *      guarantee — the whole reason the shim is thin).
 *   4. the tool result is rendered into pi's AgentToolResult shape.
 */

import { describe, it, expect, vi } from "vitest";
import {
  WorkLeaseTracker,
  type ToolDescriptor,
  type ToolDispatchContext,
  type IToolDispatchAgent,
} from "@apnex/network-adapter";
import {
  toTypeboxParameters,
  buildPiToolDefinition,
  registerHubTools,
} from "../src/tool-bridge.js";

function fakeAgent(
  calls: Array<{ method: string; params: unknown }>,
): IToolDispatchAgent {
  return {
    state: "streaming",
    isConnected: true,
    async call(method, params) {
      calls.push({ method, params });
      if (method === "echo") return { ok: true, echoed: params };
      return { ok: true };
    },
    async listTools() {
      return [];
    },
  };
}

function makeCtx(agent: IToolDispatchAgent): ToolDispatchContext {
  return {
    getAgent: () => agent,
    pendingActionMap: new Map(),
    workLeases: new WorkLeaseTracker(),
    onCallStart: () => {},
    onCallEnd: () => {},
    log: () => {},
  };
}

describe("toTypeboxParameters", () => {
  it("adopts an object JSON-Schema verbatim", () => {
    const descriptor: ToolDescriptor = {
      name: "echo",
      inputSchema: {
        type: "object",
        properties: { msg: { type: "string" } },
        required: ["msg"],
      },
    };
    const schema = toTypeboxParameters(descriptor) as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect((schema.properties as Record<string, unknown>).msg).toEqual({
      type: "string",
    });
    expect(schema.required).toEqual(["msg"]);
  });

  it("falls back to an open object when there is no usable schema", () => {
    const schema = toTypeboxParameters({ name: "x" }) as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(true);
  });
});

describe("buildPiToolDefinition — MCP display classification (bug-239/216)", () => {
  // The exact predicate pi-tool-display's isMcpToolCandidate() check #2 uses on
  // label OR description. Before the fix Hub tools had label:name → matched nothing
  // → rendered as raw verbose JSON instead of being summarized.
  const MCP_PATTERN = /\bmcp\b/i;

  it("decorates the label so the upstream isMcpToolCandidate() detects the tool", () => {
    const def = buildPiToolDefinition(
      { name: "list_ready_work", description: "List claimable work." },
      makeCtx(fakeAgent([])),
    );
    expect(MCP_PATTERN.test(def.label)).toBe(true);
    expect(def.label).toBe("list_ready_work [mcp]");
  });

  it("leaves the LLM-facing surface (name + description) UNCHANGED — no tool-selection regression", () => {
    const descriptor: ToolDescriptor = { name: "get_work", description: "Read a WorkItem by id." };
    const def = buildPiToolDefinition(descriptor, makeCtx(fakeAgent([])));
    // pi SDK ToolDefinition: `name` is "used in LLM tool calls", `description` is
    // "Description for LLM". Both must be byte-identical to the Hub descriptor; the
    // `mcp` token lives ONLY in the UI-only label.
    expect(def.name).toBe("get_work");
    expect(def.description).toBe("Read a WorkItem by id.");
    expect(MCP_PATTERN.test(def.description)).toBe(false);
  });

  it("classifies every bridged tool deterministically (the bug was ALL Hub tools failing)", () => {
    for (const name of ["get_work", "create_message", "list_ready_work", "attest_evidence"]) {
      const def = buildPiToolDefinition({ name }, makeCtx(fakeAgent([])));
      expect(MCP_PATTERN.test(def.label), `${name} label must classify as MCP`).toBe(true);
    }
  });
});

describe("buildPiToolDefinition.execute", () => {
  it("routes through the shared dispatch authority (fake agent records the call)", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const agent = fakeAgent(calls);
    const def = buildPiToolDefinition({ name: "echo" }, makeCtx(agent));

    const result = await def.execute(
      "call-1",
      { msg: "hi" } as never,
      undefined,
      undefined,
      {} as never,
    );

    // The actual work verb reached the agent...
    expect(calls.some((c) => c.method === "echo")).toBe(true);
    // ...AND the dispatch authority wrapped it with the signal-FSM RPCs
    // (mission-62) — the behavior the native binding gets for free.
    expect(calls.some((c) => c.method === "signal_working_started")).toBe(true);
    expect(calls.some((c) => c.method === "signal_working_completed")).toBe(true);

    // Rendered into pi's AgentToolResult shape.
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(result.details).toMatchObject({ isError: false });
  });

  it("does NOT signal-wrap skip-listed lifecycle tools", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const agent = fakeAgent(calls);
    const def = buildPiToolDefinition({ name: "claim_session" }, makeCtx(agent));
    await def.execute("c", {} as never, undefined, undefined, {} as never);
    expect(calls.some((c) => c.method === "signal_working_started")).toBe(false);
    expect(calls.some((c) => c.method === "claim_session")).toBe(true);
  });
});

describe("registerHubTools", () => {
  it("registers each descriptor and returns their names", () => {
    const registered: string[] = [];
    const pi = {
      registerTool: (def: { name: string }) => registered.push(def.name),
    } as never;
    const calls: Array<{ method: string; params: unknown }> = [];
    const names = registerHubTools(
      pi,
      [{ name: "a" }, { name: "b" }],
      makeCtx(fakeAgent(calls)),
    );
    expect(names).toEqual(["a", "b"]);
    expect(registered).toEqual(["a", "b"]);
  });
});
