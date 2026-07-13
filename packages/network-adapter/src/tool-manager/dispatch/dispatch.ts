/**
 * dispatch.ts — the tool DISPATCH authority (Slice B).
 *
 * This is the per-call behavior wrapper extracted VERBATIM from the MCP
 * `CallTool` handler body in `dispatcher.ts` (the god-object). It owns the
 * OIS-Hub dispatch policy that EVERY host binding must share:
 *   - idle-gate bookkeeping (activeCallCount) for the wake/stall reconciler
 *   - callToolGate wait + bug-126 timeout
 *   - "Hub not connected" pre-check
 *   - injectQueueItemId (ADR-017)
 *   - signal_working_* FSM wrapping (mission-62)
 *   - workLeases.observe (idea-353)
 *   - onToolCallResult host hook
 *   - error normalization + W10 terminal-log discipline
 *
 * SLICE B DISCIPLINE: this is a faithful EXTRACT-AND-DELEGATE. The logic, its
 * order, the log lines, and the return shape are preserved byte-for-byte from
 * the original handler so the 272-test regression suite certifies behavioral
 * identity. The MCP `CallTool` handler in `dispatcher.ts` now calls
 * `runToolDispatch(...)` and returns its result directly.
 *
 * Deliberately NOT done here (deferred to Slice C, per the two-phase rule):
 *   - converting the MCP-shaped return to the neutral `ToolDispatchResult`
 *   - relocating callToolGate / "Hub not connected" to the MCP binding
 *   - collapsing the closure / renaming
 * Faithful move first; structural cleanup when files move.
 *
 * Design: docs/designs/m-sovereign-tool-manager-design.md (Slice B)
 * Axioms: A3 (Air-Gap — depends on injected deps, not the closure), A8 (certify
 *         before ascending — regression parity is the gate).
 */

import type { IToolDispatchAgent } from "../contracts.js";
import { WorkLeaseTracker } from "../work-protocol/work-lease-tracker.js";
import { injectQueueItemId, TOOL_CALL_SIGNAL_SKIP } from "./tool-call-policy.js";

/**
 * The MCP-shaped result the CallTool handler returns today. Preserved verbatim
 * in Slice B (the neutral `ToolDispatchResult` conversion is a Slice-C concern).
 */
export interface McpToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/**
 * bug-252 — retry-with-backoff config for a TRANSIENT Hub-wire drop, applied ONLY at
 * the pre-dispatch not-connected gate (nothing has been sent to the Hub yet, so a
 * retry is idempotency-safe). `maxRetries <= 0` disables it (immediate error =
 * today's behavior). The dispatcher binding applies `DEFAULT_TRANSIENT_DROP_RETRY`
 * fleet-wide; a direct `runToolDispatch` caller opts in explicitly.
 */
export interface TransientDropRetryConfig {
  /** backoff retries after the initial check (0 = disabled). */
  maxRetries: number;
  /** first backoff delay (ms); doubles each retry, capped at `maxDelayMs`. */
  baseDelayMs: number;
  /** cap on the per-retry backoff (ms). */
  maxDelayMs: number;
}

/** Fleet default applied by the dispatcher binding: 500→1000→2000→4000ms ≈ 7.5s budget. */
export const DEFAULT_TRANSIENT_DROP_RETRY: TransientDropRetryConfig = {
  maxRetries: 4,
  baseDelayMs: 500,
  maxDelayMs: 4000,
};

/**
 * Explicit dependency context for a single tool dispatch. In the god-object
 * these were closure variables; making them injected params is the A3 Air-Gap
 * boundary being realized — `runToolDispatch` is now understandable and testable
 * from its inputs alone (A3 Local Reasoning), with no hidden closure state.
 */
export interface ToolDispatchContext {
  /** Late-bound agent accessor (null = not connected yet). */
  getAgent: () => IToolDispatchAgent | null;
  /** ADR-017 queueItemId tracking map (shared with the notification path). */
  pendingActionMap: Map<string, string>;
  /** idea-353 lease tracker (shared with the wake/stall reconciler). */
  workLeases: WorkLeaseTracker;
  /** Increment on dispatch entry (idle-gate); returns nothing. */
  onCallStart: () => void;
  /** Decrement on dispatch exit (idle-gate). */
  onCallEnd: () => void;
  /** Optional gate the dispatch awaits before touching the Hub. */
  callToolGate?: Promise<void>;
  /** bug-126 gate timeout (ms). Default 30000; 0 disables. */
  callToolGateTimeoutMs?: number;
  /** idea-353 W2 host observation hook (best-effort). */
  onToolCallResult?: (
    method: string,
    args: Record<string, unknown>,
    result: unknown,
  ) => void;
  /** Diagnostic logger. */
  log: (msg: string) => void;
  /**
   * bug-252: opt-in retry-with-backoff for a TRANSIENT Hub-wire drop at the
   * not-connected pre-check (idempotency-safe — nothing sent yet). Undefined ⇒ no
   * retry (today's immediate "Hub not connected" error). The dispatcher binding
   * defaults it on fleet-wide (`DEFAULT_TRANSIENT_DROP_RETRY`).
   */
  transientDropRetry?: TransientDropRetryConfig;
  /** injectable sleep (test seam); defaults to a setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
}

/** True when the agent is present and not explicitly disconnected. */
function isUsableAgent(
  agent: IToolDispatchAgent | null,
): agent is IToolDispatchAgent {
  return !!agent && agent.isConnected !== false;
}

/**
 * bug-252 — bounded retry-with-backoff waiting for a transiently-dropped Hub wire to
 * reconnect. Invoked ONLY at the pre-dispatch not-connected gate (nothing sent to the
 * Hub yet ⇒ idempotency-safe). Returns a usable agent as soon as one appears, or the
 * last (still-unusable) `getAgent()` after exhausting the budget. Surfaces the drop,
 * each retry, and the outcome as structured `transient-drop` log lines. A no-op when
 * `ctx.transientDropRetry` is undefined or `maxRetries <= 0` (today's behavior).
 */
async function awaitAgentRecovery(
  ctx: ToolDispatchContext,
  tool: string,
  startedAt: number,
): Promise<IToolDispatchAgent | null> {
  const cfg = ctx.transientDropRetry;
  if (!cfg || cfg.maxRetries <= 0) return ctx.getAgent();
  const sleep =
    ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
    const delay = Math.min(cfg.baseDelayMs * 2 ** (attempt - 1), cfg.maxDelayMs);
    ctx.log(
      `[CallTool] ${tool} transient-drop: Hub not connected — retry ${attempt}/${cfg.maxRetries} after ${delay}ms backoff`,
    );
    await sleep(delay);
    const agent = ctx.getAgent();
    if (isUsableAgent(agent)) {
      ctx.log(
        `[CallTool] ${tool} transient-drop RECOVERED — Hub reconnected on retry ${attempt}/${cfg.maxRetries} (+${Date.now() - startedAt}ms)`,
      );
      return agent;
    }
  }
  ctx.log(
    `[CallTool] ${tool} transient-drop UNRECOVERED — Hub still not connected after ${cfg.maxRetries} retries (+${Date.now() - startedAt}ms)`,
  );
  return ctx.getAgent();
}

/**
 * Execute one host-driven tool call through the full OIS dispatch policy.
 *
 * Extracted verbatim from the CallTool handler; `ctx` supplies what were closure
 * variables. Returns the same MCP-shaped result the handler returned.
 */
export async function runToolDispatch(
  ctx: ToolDispatchContext,
  requestedTool: string,
  incomingArgs: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const { log } = ctx;
  const callStartedAt = Date.now();
  log(`[CallTool] ${requestedTool} entered`);
  // idea-353 W1 idle-gate: mark the agent busy for the full lifespan of this
  // host CallTool (gate-wait included), cleared in the finally below.
  ctx.onCallStart();
  try {
    if (ctx.callToolGate) {
      log(`[CallTool] ${requestedTool} awaiting callToolGate`);
      // mission-88 W10 (bug-126 fix): timeout the gate await to prevent
      // indefinite hang on pending-forever sessionReady. Default 30s; set
      // callToolGateTimeoutMs=0 to disable (test-only). Structured
      // `gate-timeout` log emitted on timeout; isError response returned.
      const timeoutMs = ctx.callToolGateTimeoutMs ?? 30000;
      if (timeoutMs > 0) {
        let timeoutHandle: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<void>((_resolve, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`callToolGate timeout after ${timeoutMs}ms`));
          }, timeoutMs);
        });
        try {
          await Promise.race([ctx.callToolGate, timeoutPromise]);
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
        }
      } else {
        await ctx.callToolGate;
      }
      log(`[CallTool] ${requestedTool} gate passed (+${Date.now() - callStartedAt}ms)`);
    }
    let agent = ctx.getAgent();
    if (!isUsableAgent(agent)) {
      // bug-252: a transient wire drop (Hub adapter reconnecting) leaves the agent
      // momentarily unusable, then self-recovers. Nothing has been sent to the Hub at
      // THIS pre-check, so retry-with-backoff is idempotency-SAFE — wait for the
      // transport to restore the agent, then dispatch. Opt-in (undefined ⇒ no retry).
      // A mid-flight drop (the catch below) is deliberately NOT retried — the write
      // may have partially applied.
      agent = await awaitAgentRecovery(ctx, requestedTool, callStartedAt);
    }
    if (!isUsableAgent(agent)) {
      log(`[CallTool] ${requestedTool} aborted — Hub not connected`);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "Hub not connected",
              message: "The Hub adapter is not currently connected.",
            }),
          },
        ],
        isError: true,
      };
    }
    const name = requestedTool;
    const outgoingArgs = injectQueueItemId(
      name,
      incomingArgs,
      ctx.pendingActionMap,
    );
    // ── Mission-62 W3 — activity FSM signal wrapping ─────────────
    // Wrap each LLM-driven tool call with signal_working_started +
    // signal_working_completed RPCs (fire-and-forget). Skip-list prevents
    // recursion + handshake/lifecycle tools.
    const wrapWithSignal = !TOOL_CALL_SIGNAL_SKIP.has(name);
    if (wrapWithSignal) {
      agent.call("signal_working_started", { toolName: name }).catch((err: unknown) => {
        log(`[mission-62] signal_working_started fire-and-forget failed (non-fatal): ${(err as Error)?.message ?? err}`);
      });
    }
    let result: unknown;
    const agentCallStart = Date.now();
    log(`[CallTool] ${name} dispatching to agent.call (wrapWithSignal=${wrapWithSignal})`);
    try {
      result = await agent.call(name, outgoingArgs);
      log(`[CallTool] ${name} agent.call returned in ${Date.now() - agentCallStart}ms`);
      // idea-355 §4.3 (invariant #3) — kernel-side W2 observer. Feed this
      // agent's own work-verb results to the lease tracker so the heartbeat
      // tick's stall-prompt has a populated lease map. Best-effort.
      try {
        ctx.workLeases.observe(name, outgoingArgs, result, Date.now());
      } catch (obsErr) {
        log(`[idea-353] kernel lease observe threw (non-fatal): ${(obsErr as Error)?.message ?? obsErr}`);
      }
      // idea-353 W2: optional host hook for host-specific observation.
      if (ctx.onToolCallResult) {
        try {
          ctx.onToolCallResult(name, outgoingArgs, result);
        } catch (hookErr) {
          log(`[idea-353] onToolCallResult hook threw (non-fatal): ${(hookErr as Error)?.message ?? hookErr}`);
        }
      }
    } finally {
      if (wrapWithSignal) {
        agent.call("signal_working_completed", {}).catch((err: unknown) => {
          log(`[mission-62] signal_working_completed fire-and-forget failed (non-fatal): ${(err as Error)?.message ?? err}`);
        });
      }
    }
    log(`[CallTool] ${name} completed in ${Date.now() - callStartedAt}ms total`);
    return {
      content: [
        {
          type: "text" as const,
          text:
            typeof result === "string"
              ? result
              : JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // mission-88 W10 (bug-126 fix): post-condition logging discipline — every
    // CallTool entry MUST emit exactly one terminal log line.
    const outcome = message.startsWith("callToolGate timeout")
      ? "gate-timeout"
      : "error-response";
    log(
      `[CallTool] ${requestedTool} terminal: outcome=${outcome} elapsed=${Date.now() - callStartedAt}ms message="${message}"`,
    );
    return {
      content: [
        { type: "text" as const, text: JSON.stringify({ error: message, w10_outcome: outcome }) },
      ],
      isError: true,
    };
  } finally {
    // idea-353 W1 idle-gate: this CallTool is no longer in flight.
    ctx.onCallEnd();
  }
}
