/**
 * contracts.ts — the agnostic Tool-Manager contract (Slice A).
 *
 * The internal-sovereign-module boundary for tool catalog + dispatch. These
 * interfaces are host- AND transport-agnostic BY CONSTRUCTION: nothing here
 * imports `@modelcontextprotocol/sdk`, `McpAgentClient`, or any binding. A
 * consumer (the MCP binding, pi's native binding, a future ACP binding) depends
 * ONLY on these types — never on the concrete kernel classes (A3 Air-Gap).
 *
 * Design: docs/designs/m-sovereign-tool-manager-design.md
 * Axioms:  A3 Sovereign Composition (Law of One, Air-Gap, Semantic Bit-Masking,
 *          Earned Exposure — this is an INTERNAL module, not a published package).
 *
 * SLICE A INVARIANT: purely additive. `McpAgentClient` (via `IAgentClient`)
 * structurally satisfies `IToolDispatchAgent` today with zero changes — this
 * file only NAMES the subset the tool-manager actually needs, so the dispatch
 * authority (Slice B) can depend on the interface instead of the class.
 */

/**
 * Neutral tool descriptor — MCP-shaped fields (name / description / JSON-Schema
 * inputSchema) but NOT an MCP SDK type. Every binding materializes its own host
 * representation from this (MCP `Tool`, pi typebox `parameters`, …). This is the
 * bit-perfect interface both sides agree on (A3 Semantic Bit-Masking).
 *
 * Structurally identical to `@apnex/cognitive-layer`'s `Tool`, deliberately
 * re-declared here so the contract owns its own shape and carries no dependency
 * on the cognitive layer.
 */
export interface ToolDescriptor {
  name: string;
  description?: string;
  // `unknown` + index signature to be bit-perfect with the kernel/cognitive
  // `Tool` shape (`inputSchema?: unknown; [key: string]: unknown`) so
  // `McpAgentClient.listTools()` structurally satisfies `IToolDispatchAgent`
  // WITHOUT the class changing (A3 Semantic Bit-Masking — the contract mirrors
  // the existing surface, it does not impose a stricter one). Bindings that
  // need a concrete JSON-Schema narrow the field at their own boundary.
  inputSchema?: unknown;
  [key: string]: unknown;
}

/**
 * Options forwarded to a dispatch-time agent call. Mirrors the kernel's
 * `AgentCallOptions` subset the tool-manager relies on.
 */
export interface ToolDispatchCallOptions {
  /** Mark this call internal-machinery — skip LLM-facing result transforms. */
  internal?: boolean;
}

/**
 * The minimal agent surface the Tool-Manager needs. `McpAgentClient` /
 * `IAgentClient` satisfy this structurally — the tool-manager imports THIS,
 * never the class, which is what keeps the module carve-able and breaks the
 * would-be circular dependency (tool-manager → kernel).
 *
 * `listTools()` already returns the tier-filtered, cognitively-enriched surface
 * (the kernel owns that filtering) — the tool-manager consumes the finished
 * descriptor and does not re-derive it.
 */
export interface IToolDispatchAgent {
  readonly state: string;
  readonly isConnected: boolean;
  call(
    method: string,
    params: Record<string, unknown>,
    opts?: ToolDispatchCallOptions,
  ): Promise<unknown>;
  listTools(): Promise<ToolDescriptor[]>;
  getMetrics?(): { agentId?: string };
}

/**
 * Neutral dispatch result. Bindings format this into their host shape (MCP
 * `content[]` + `isError`, pi `ToolResult`, …). NOT an MCP `CallToolResult`.
 */
export interface ToolDispatchResult {
  /** Raw dispatch return — a string, or a JSON-serializable value. */
  value: unknown;
  isError: boolean;
  /** Present when `isError` — the normalized failure message. */
  errorMessage?: string;
}

/**
 * The Tool-Manager authority (Slice B fills the impl). Owns exactly two
 * concerns (A3 Law of One): the tool CATALOG (what tools exist, projected for a
 * host) and tool DISPATCH (the per-call behavior wrapper currently trapped in
 * the MCP `CallTool` handler body). Every binding terminates in `dispatch()`.
 */
export interface IToolManager {
  /** Catalog authority — the derive-from-one-walk surface (A2). */
  listTools(agent: IToolDispatchAgent): Promise<ToolDescriptor[]>;

  /**
   * Dispatch authority — the per-call behavior wrapper. Owns signal-FSM
   * wrapping, queueItemId injection, active-call idle-gate bookkeeping, work-
   * lease observation, and error normalization. (Slice B.)
   */
  dispatch(
    agent: IToolDispatchAgent,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolDispatchResult>;

  /** idle-gate reads (the wake/stall reconciler consumes these). */
  getActiveCallCount(): number;
  isIdle(): boolean;
}
