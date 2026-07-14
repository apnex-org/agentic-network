/**
 * Cognitive Middleware Contract (ADR-018).
 *
 * Chain-of-responsibility interception surface for tool calls, list-tools
 * invocations, and errors. Middlewares compose via `next()`; short-circuit
 * by returning without calling `next()`.
 *
 * Errors propagate via standard throw. Middleware code paths are expected
 * not to throw spontaneously (`INV-COG-3`); errors from the transport or
 * from a wrapped downstream call flow through `onToolError` if a middleware
 * chooses to intercept them.
 */

export interface ToolCallContext {
  /** Tool name (MCP method). */
  readonly tool: string;
  /** Tool arguments (mutable across middlewares if they choose to rewrite). */
  args: Record<string, unknown>;
  /** Session identifier from the L7 adapter. */
  readonly sessionId: string;
  /** Optional: agent/engineer identifier (available post-handshake). */
  readonly agentId?: string;
  /** Monotonic start timestamp (ms). Stamped by the pipeline. */
  readonly startedAt: number;
  /**
   * Annotations middlewares can attach/read as context propagates down
   * the chain (e.g., `{ cacheHit: "false" }` set by ToolResultCache for
   * CognitiveTelemetry to observe). Pipeline does not interpret tags.
   */
  readonly tags: Record<string, string>;
}

/**
 * Tag key on `ToolCallContext.tags` marking an internal-machinery tool call
 * (poll-backstop catch-up, transport heartbeat) — as distinct from an
 * LLM-originated tool call. bug-106: middlewares that exist for the LLM's
 * context budget — notably `ResponseSummarizer` — MUST NOT transform an
 * internal call's result; machinery needs the raw, full payload.
 */
export const INTERNAL_CALL_TAG = "internal";

/** True when `tags` marks the call as internal-machinery (bug-106). */
export function isInternalCall(tags: Readonly<Record<string, string>>): boolean {
  return tags[INTERNAL_CALL_TAG] === "true";
}

/**
 * Tag key on `ToolCallContext.tags` marking a resilience/liveness PROBE call
 * (e.g. the L1.5 liveness-watchdog server-validity probe, the poll-backstop
 * transport heartbeat) — a call whose whole purpose is to prove a live Hub
 * round-trip. bug-206: the cognitive result caches MUST NOT return a cached
 * success for a probe — a cached-success would report the session healthy
 * WITHOUT a real round-trip, masking a server-side-dead session from the
 * watchdog. Both result-caching middlewares honor this: `ToolResultCache`
 * (never serve/never store) and `WriteCallDedup` (never replay), so the probe
 * call-class is structurally cache-exempt regardless of the probe method's
 * verb. Independent of (and composable with) INTERNAL_CALL_TAG — a call may be
 * both internal-machinery and a probe.
 */
export const PROBE_CALL_TAG = "probe";

/** True when `tags` marks the call as a resilience/liveness probe (bug-206). */
export function isProbeCall(tags: Readonly<Record<string, string>>): boolean {
  return tags[PROBE_CALL_TAG] === "true";
}

export interface ListToolsContext {
  readonly sessionId: string;
  readonly agentId?: string;
  readonly startedAt: number;
  readonly tags: Record<string, string>;
}

export interface ToolErrorContext {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly sessionId: string;
  readonly agentId?: string;
  /** Whatever threw from the inner chain. Middlewares may inspect/replace. */
  readonly error: unknown;
  readonly durationMs: number;
  readonly startedAt: number;
  readonly tags: Record<string, string>;
}

/**
 * Tool descriptor shape used by ListTools flow. Matches the MCP SDK
 * tool shape loosely; described here locally to avoid a compile-time
 * dependency on the SDK (keeps @apnex/cognitive-layer transport-agnostic).
 */
export interface Tool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  [key: string]: unknown;
}

export interface CognitiveMiddleware {
  /** Stable identifier for diagnostics + telemetry tagging. */
  readonly name: string;

  /**
   * Intercept an outbound tool call. Call `next(ctx)` to proceed down
   * the chain. Return without calling `next` to short-circuit (e.g.,
   * cache hit, circuit-open). Throw to propagate an error upward; the
   * pipeline will invoke `onToolError` handlers on the way back up.
   */
  onToolCall?(
    ctx: ToolCallContext,
    next: (ctx: ToolCallContext) => Promise<unknown>,
  ): Promise<unknown>;

  /**
   * Intercept a tool-list response (e.g., to enrich descriptions).
   */
  onListTools?(
    ctx: ListToolsContext,
    next: (ctx: ListToolsContext) => Promise<Tool[]>,
  ): Promise<Tool[]>;

  /**
   * Intercept errors surfaced by `onToolCall`. Can transform the error
   * (e.g., ErrorNormalizer rewriting Zod validation into a reasoning
   * hint) or recover by returning a result value. Call `next(ctx)` to
   * pass the error up the chain unchanged.
   */
  onToolError?(
    ctx: ToolErrorContext,
    next: (ctx: ToolErrorContext) => Promise<unknown>,
  ): Promise<unknown>;
}

/**
 * Terminal handler for each phase — supplied by the consumer
 * (network-adapter). Pipeline wraps terminals with all registered
 * middlewares.
 */
export type ToolCallTerminal = (ctx: ToolCallContext) => Promise<unknown>;
export type ListToolsTerminal = (ctx: ListToolsContext) => Promise<Tool[]>;
export type ToolErrorTerminal = (ctx: ToolErrorContext) => Promise<unknown>;
