/**
 * tool-bridge.ts — pi native tool binding (last-mile).
 *
 * The pi-specific half of the "one authority, many bindings" architecture. Core
 * owns tool CATALOG (`agent.listTools()`) and tool DISPATCH (`runToolDispatch`);
 * this file renders both into pi's native surface:
 *
 *   catalog descriptor  →  pi.registerTool({ parameters: <typebox>, execute })
 *   execute(...)         →  runToolDispatch(ctx, name, args)  →  AgentToolResult
 *
 * Boundary discipline (A3 facade + A11):
 *   - imports `@apnex/network-adapter` ONLY from the @apnex graph (facade rule).
 *   - contains NO adapter behavior — the per-call wrapper (signal-FSM, queueItemId,
 *     idle-gate, lease observe, error normalization) lives in `runToolDispatch`.
 *     This file is a pure descriptor→typebox render + result→AgentToolResult
 *     render. If any dispatch policy appears here, that is M18 drift.
 *   - the descriptor→typebox conversion is deliberately shim-side (typebox is
 *     pi-flavored; no other host needs it — design §3.1). If a 2nd native-tool
 *     host appears, promote the walk to a neutral core helper THEN (YAGNI).
 *
 * Design: docs/designs/m-pi-plugin-adapter-design.md §3.1, §3.2, §4
 */

import { Type } from "typebox";
import type { TSchema } from "typebox";
import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  ToolDescriptor,
  ToolDispatchContext,
} from "@apnex/network-adapter";
import { runToolDispatch } from "@apnex/network-adapter";

/**
 * Wrap a Hub tool's JSON-Schema `inputSchema` as a typebox `TSchema`.
 *
 * The Hub already advertises MCP JSON-Schema (`{ type:"object", properties, … }`)
 * and typebox schemas ARE JSON-Schema, so `Type.Unsafe` adopts the schema
 * verbatim — the thinnest faithful conversion (no lossy re-walk). Falls back to
 * an open object when a descriptor has no/!object inputSchema so the LLM can
 * still call the tool with arbitrary args (the Hub validates server-side).
 */
export function toTypeboxParameters(descriptor: ToolDescriptor): TSchema {
  const schema = descriptor.inputSchema;
  if (
    schema &&
    typeof schema === "object" &&
    (schema as { type?: unknown }).type === "object"
  ) {
    // Adopt the Hub's JSON-Schema as-is (name/description/required/properties
    // all pass through). typebox validates params against this before execute.
    return Type.Unsafe<Record<string, unknown>>(schema as Record<string, unknown>);
  }
  // No usable object schema — accept any object (server-side validation is the
  // authority; we do not fabricate a stricter contract than the Hub declares).
  return Type.Object({}, { additionalProperties: true });
}

/**
 * Build a pi ToolDefinition for one Hub tool descriptor. `execute` routes every
 * call through the shared dispatch authority — the SAME wrapper the MCP CallTool
 * handler uses — so pi tool calls get signal-FSM wrapping, queueItemId injection,
 * idle-gate bookkeeping, and lease observation for free, with zero re-impl.
 */
export function buildPiToolDefinition(
  descriptor: ToolDescriptor,
  dispatchCtx: ToolDispatchContext,
): ToolDefinition {
  const name = descriptor.name;
  return {
    name,
    label: name,
    description: descriptor.description ?? name,
    parameters: toTypeboxParameters(descriptor),
    async execute(_toolCallId, params) {
      // runToolDispatch owns ALL per-call behavior + error normalization; it
      // returns the neutral MCP-shaped { content, isError }. We render that into
      // pi's AgentToolResult (content passthrough + required `details`). pi's
      // convention is throw-on-failure, but the dispatch authority already
      // normalizes Hub errors INTO content text (with isError) — surfacing that
      // text to the LLM is the honest mapping (the model sees the error), so we
      // pass content through rather than throwing and losing the envelope.
      const result = await runToolDispatch(
        dispatchCtx,
        name,
        (params ?? {}) as Record<string, unknown>,
      );
      return {
        content: result.content,
        details: { isError: result.isError ?? false },
      };
    },
  };
}

/**
 * Register (or refresh) the full LLM-facing tool surface with pi.
 *
 * `descriptors` is the finished, tier-filtered, cognitively-enriched catalog
 * from `agent.listTools()` (core already stripped `[tier:adapter-internal]` and
 * ran the ToolDescriptionEnricher — mcp-agent-client.ts). This function does NOT
 * re-derive the surface; it renders it (A11 Hydration-as-Offload: pi reads a
 * pre-computed catalog).
 *
 * Returns the registered tool names so the caller can `pi.setActiveTools(...)`
 * to enable them alongside pi's built-ins.
 */
export function registerHubTools(
  pi: ExtensionAPI,
  descriptors: ToolDescriptor[],
  dispatchCtx: ToolDispatchContext,
): string[] {
  const names: string[] = [];
  for (const descriptor of descriptors) {
    // registerTool is idempotent-by-name in pi (re-registering refreshes the
    // definition in-session, no /reload), so this doubles as the refresh path.
    pi.registerTool(buildPiToolDefinition(descriptor, dispatchCtx));
    names.push(descriptor.name);
  }
  return names;
}
