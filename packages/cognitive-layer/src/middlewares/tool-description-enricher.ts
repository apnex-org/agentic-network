/**
 * ToolDescriptionEnricher middleware (ADR-018).
 *
 * Injects compact cognitive hints into tool descriptions returned from
 * `onListTools`. Teaches the LLM how to call without enforcement —
 * information-only mechanism.
 *
 * Closed hint vocabulary (INV-COG-9):
 *
 *   [C30s]  cached 30s — prefer reuse within turn
 *   [ID]    idempotent — safe to retry
 *   [PAR]   supports parallel invocation
 *   [W]     write — mutates state; no caching/dedup-replay
 *   [CB]    behind CircuitBreaker
 *
 * Hints append as ` [C30s][ID]` suffix to the existing description.
 * Worst-case token overhead: ~10 tokens per tool × ~40 tools ≈ 400
 * tokens total — well within budget for large-context models;
 * provides a `disabled` kill switch for small-context deployments.
 *
 * Middleware is passive on `onToolCall` — args/results are untouched;
 * only `onListTools` output is rewritten.
 */

import type {
  CognitiveMiddleware,
  ListToolsContext,
  Tool,
} from "../contract.js";

/**
 * Hints for a single tool. Each field maps to one vocabulary token.
 * Only fields with truthy/defined values emit a token.
 */
export interface ToolHints {
  /** Cached N ms — emits `[C{sec}s]` (rounded to whole seconds). */
  cachedMs?: number;
  /** Idempotent — emits `[ID]`. */
  idempotent?: boolean;
  /** Supports parallel invocation — emits `[PAR]`. */
  parallel?: boolean;
  /** Write — mutates state — emits `[W]`. */
  write?: boolean;
  /** Behind CircuitBreaker — emits `[CB]`. */
  circuitBreaker?: boolean;
}

export interface ToolDescriptionEnricherConfig {
  /**
   * Kill switch for low-context-budget deployments. When `false`,
   * `onListTools` passes through unchanged. Default: `true`.
   */
  enabled?: boolean;
  /**
   * Explicit hints per tool — overrides `inferHints`. Keys are tool
   * names (MCP method names).
   */
  hintMap?: Record<string, ToolHints>;
  /**
   * Fallback inference for tools absent from `hintMap`. Default:
   * `get_*` / `list_*` → cached+idempotent+parallel;
   * write-verb prefixes → `{ write: true }`. Return `null` for no
   * hints. Override for domain-specific tool surfaces.
   */
  inferHints?: (toolName: string) => ToolHints | null;
  /**
   * Format the hint set into a suffix string. Default emits tokens
   * in the canonical order `[C…s][ID][PAR][W][CB]` prefixed with a
   * space. Override to change vocabulary or structure (but the
   * closed-vocabulary invariant INV-COG-9 expects the stock
   * formatter).
   */
  formatHints?: (hints: ToolHints) => string;
}

function defaultInferHints(toolName: string): ToolHints | null {
  if (toolName.startsWith("get_") || toolName.startsWith("list_")) {
    return { cachedMs: 30_000, idempotent: true, parallel: true };
  }
  const writePrefixes = [
    "create_",
    "update_",
    "close_",
    "resolve_",
    "delete_",
    "register_",
    "acknowledge_",
    "migrate_",
    "propose_",
    "drain_",
    "leave_",
    "cancel_",
  ];
  if (writePrefixes.some((p) => toolName.startsWith(p))) {
    return { write: true };
  }
  return null;
}

function defaultFormatHints(h: ToolHints): string {
  const tokens: string[] = [];
  if (typeof h.cachedMs === "number" && h.cachedMs > 0) {
    const secs = Math.max(1, Math.round(h.cachedMs / 1000));
    tokens.push(`[C${secs}s]`);
  }
  if (h.idempotent) tokens.push("[ID]");
  if (h.parallel) tokens.push("[PAR]");
  if (h.write) tokens.push("[W]");
  if (h.circuitBreaker) tokens.push("[CB]");
  return tokens.length > 0 ? ` ${tokens.join("")}` : "";
}

export class ToolDescriptionEnricher implements CognitiveMiddleware {
  readonly name = "ToolDescriptionEnricher";

  private readonly enabled: boolean;
  private readonly hintMap: Record<string, ToolHints>;
  private readonly inferHints: (toolName: string) => ToolHints | null;
  private readonly formatHints: (h: ToolHints) => string;

  constructor(config: ToolDescriptionEnricherConfig = {}) {
    this.enabled = config.enabled ?? true;
    this.hintMap = { ...(config.hintMap ?? {}) };
    this.inferHints = config.inferHints ?? defaultInferHints;
    this.formatHints = config.formatHints ?? defaultFormatHints;
  }

  async onListTools(
    ctx: ListToolsContext,
    next: (ctx: ListToolsContext) => Promise<Tool[]>,
  ): Promise<Tool[]> {
    const tools = await next(ctx);
    if (!this.enabled) return tools;
    return tools.map((tool) => this.enrichOne(tool));
  }

  /** Public helper — exposed for diagnostics + tests. */
  enrichOne(tool: Tool): Tool {
    const explicit = this.hintMap[tool.name];
    const hints = explicit ?? this.inferHints(tool.name);
    if (!hints) return tool;
    const suffix = this.formatHints(hints);
    if (!suffix) return tool;
    return {
      ...tool,
      description: (tool.description ?? "") + suffix,
    };
  }
}
