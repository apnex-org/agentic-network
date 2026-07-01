/**
 * tool-manager-contracts.test.ts — Slice A conformance guard.
 *
 * Proves (at COMPILE time) that the concrete kernel `McpAgentClient` structurally
 * satisfies the agnostic `IToolDispatchAgent` contract. This is the load-bearing
 * Slice A invariant: the dispatch authority (Slice B) will depend on the
 * INTERFACE, so if the class ever drifts from the contract, this file fails to
 * compile — the failure surfaces here, at the boundary, not deep in a binding.
 *
 * There is no runtime behavior to assert; the value is the type-check. A trivial
 * runtime test keeps vitest happy and documents intent.
 */

import { describe, it, expect } from "vitest";
import type { McpAgentClient } from "../../src/kernel/mcp-agent-client.js";
import type {
  IToolDispatchAgent,
  ToolDescriptor,
  ToolDispatchResult,
} from "../../src/tool-manager/contracts.js";

// ── Compile-time conformance (A3 Semantic Bit-Masking) ──────────────
// If McpAgentClient stops satisfying IToolDispatchAgent, this assignment
// fails to type-check and the build breaks. `satisfies`-style guard via a
// typed function parameter (no runtime instance needed).
function _assertMcpAgentClientIsToolDispatchAgent(
  agent: McpAgentClient,
): IToolDispatchAgent {
  return agent; // ← errors at compile time if the class drifts from the contract
}
// Reference the guard so unused-var lint stays quiet without changing behavior.
void _assertMcpAgentClientIsToolDispatchAgent;

// ── Shape sanity (documentation-as-test for the neutral descriptors) ──
describe("tool-manager contracts (Slice A)", () => {
  it("ToolDescriptor carries name + optional description + JSON-Schema inputSchema", () => {
    const d: ToolDescriptor = {
      name: "get_task",
      description: "fetch a task",
      inputSchema: { type: "object", properties: {} },
    };
    expect(d.name).toBe("get_task");
    expect(d.inputSchema).toBeTypeOf("object");
  });

  it("ToolDispatchResult is a neutral (non-MCP) value/isError envelope", () => {
    const ok: ToolDispatchResult = { value: { taskId: "t1" }, isError: false };
    const err: ToolDispatchResult = {
      value: null,
      isError: true,
      errorMessage: "Hub not connected",
    };
    expect(ok.isError).toBe(false);
    expect(err.errorMessage).toContain("Hub");
  });
});
