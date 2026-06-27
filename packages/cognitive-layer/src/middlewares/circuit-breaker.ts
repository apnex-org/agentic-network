/**
 * CircuitBreaker middleware (ADR-018).
 *
 * Fails fast during Hub incidents to prevent LLM tool-round exhaustion
 * from cascading retries. Trips when the transport returns repeated
 * faults within a rolling observation window.
 *
 * State machine per scope key (default: sessionId):
 *
 *   ┌──────────┐   N consecutive transport faults    ┌──────┐
 *   │  CLOSED  │ ──────────────────────────────────▶ │ OPEN │
 *   └────┬─────┘                                      └──┬───┘
 *        ▲                                               │ cooldown elapsed
 *        │ probe succeeded                               ▼
 *        │                                         ┌───────────┐
 *        └───────────────────────────────────────── │ HALF_OPEN │
 *                                                   └─────┬─────┘
 *                                                          │ probe failed
 *                                                          ▼
 *                                                       (OPEN)
 *
 * Invariants (ADR-018 INV-COG-6):
 *   - OPEN fails fast with `HubUnavailableError` — non-retryable. The
 *     LLM sees the error in its tool-result surface and STOPS retrying,
 *     preserving round budget.
 *   - HALF_OPEN admits exactly one probe; subsequent calls fail-fast
 *     until the probe settles.
 *   - Scope is per-session by default (Hub-level fault isolation
 *     without cross-session blast radius).
 *   - Only transport-layer faults count toward the threshold; Zod /
 *     unknown-tool / application errors pass through unchanged.
 *   - State transitions emit to an optional `onStateChange` sink
 *     (shim wires this to CognitiveTelemetry).
 */

import type {
  CognitiveMiddleware,
  ToolCallContext,
} from "../contract.js";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitStateChange {
  /** Scope key (typically sessionId). */
  readonly scope: string;
  readonly from: CircuitState;
  readonly to: CircuitState;
  readonly reason: string;
  readonly timestamp: number;
}

export interface CircuitBreakerConfig {
  /** Consecutive transport faults before tripping. Default: 3. */
  failureThreshold?: number;
  /** Rolling window for fault counting (ms). Default: 30_000. */
  observationWindowMs?: number;
  /** OPEN → HALF_OPEN probe delay (ms). Default: 30_000. */
  cooldownMs?: number;
  /**
   * Predicate for classifying transport-layer faults. Default: matches
   * common 5xx / network-error / timeout message patterns. Return
   * `false` for application-level errors (Zod, unknown tool, etc.) so
   * they don't count toward the threshold.
   */
  isTransportFault?: (err: unknown) => boolean;
  /**
   * Invoked synchronously on every state transition. Shim typically
   * wires this to CognitiveTelemetry for observability.
   */
  onStateChange?: (change: CircuitStateChange) => void;
  /**
   * Key derivation for scope. Default: `ctx.sessionId`. Override for
   * e.g. per-hub scoping across sessions.
   */
  scopeKey?: (ctx: ToolCallContext) => string;
  /** Clock override for tests. */
  now?: () => number;
}

/**
 * Error thrown by the circuit breaker when a call is rejected
 * pre-transport. Subclassed from Error so shim-level catch-all
 * handling works naturally.
 */
export class HubUnavailableError extends Error {
  readonly name = "HubUnavailableError";
  readonly retryAfterMs: number;
  readonly scope: string;

  constructor(scope: string, retryAfterMs: number) {
    const secs = Math.ceil(retryAfterMs / 1000);
    super(`HubUnavailable: circuit breaker tripped for ${scope}, retry after ~${secs}s`);
    this.scope = scope;
    this.retryAfterMs = retryAfterMs;
  }
}

interface PerScopeState {
  status: CircuitState;
  /** Rolling list of fault timestamps within the observation window. */
  recentFailureTimestamps: number[];
  /** Absolute `now()` value at which OPEN → HALF_OPEN becomes eligible. */
  openedUntil: number;
  /** `true` while a HALF_OPEN probe is executing; blocks concurrent probes. */
  probeInFlight: boolean;
}

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_OBSERVATION_WINDOW_MS = 30_000;
const DEFAULT_COOLDOWN_MS = 30_000;

function defaultIsTransportFault(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // HTTP 5xx — any three-digit 5xx in the message
  if (/\b5\d\d\b/.test(msg)) return true;
  // Explicit transport markers
  const markers = [
    "timeout",
    "timed out",
    "econnrefused",
    "econnreset",
    "enotfound",
    "fetch failed",
    "network error",
    "service unavailable",
    "service_unavailable",
    "hub unavailable",
    // bug-171: a dropped MCP wire surfaces as "Connection closed" / JSON-RPC
    // -32000. Counting it as a transport fault lets the breaker trip into
    // fail-fast HubUnavailableError after a burst-induced drop — clean
    // backpressure that preserves the LLM round budget instead of hammering
    // through reconnect backoff.
    "connection closed",
    "-32000",
  ];
  return markers.some((m) => msg.includes(m));
}

export class CircuitBreaker implements CognitiveMiddleware {
  readonly name = "CircuitBreaker";

  private readonly scopes = new Map<string, PerScopeState>();
  private readonly failureThreshold: number;
  private readonly observationWindowMs: number;
  private readonly cooldownMs: number;
  private readonly isTransportFault: (err: unknown) => boolean;
  private readonly onStateChange?: (change: CircuitStateChange) => void;
  private readonly scopeKey: (ctx: ToolCallContext) => string;
  private readonly now: () => number;

  constructor(config: CircuitBreakerConfig = {}) {
    this.failureThreshold = config.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.observationWindowMs = config.observationWindowMs ?? DEFAULT_OBSERVATION_WINDOW_MS;
    this.cooldownMs = config.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.isTransportFault = config.isTransportFault ?? defaultIsTransportFault;
    this.onStateChange = config.onStateChange;
    this.scopeKey = config.scopeKey ?? ((ctx) => ctx.sessionId);
    this.now = config.now ?? Date.now;
  }

  async onToolCall(
    ctx: ToolCallContext,
    next: (ctx: ToolCallContext) => Promise<unknown>,
  ): Promise<unknown> {
    const scope = this.scopeKey(ctx);
    const state = this.getOrCreateScope(scope);
    const now = this.now();

    // Fast-fail OPEN state if still within cooldown
    if (state.status === "OPEN") {
      if (now < state.openedUntil) {
        ctx.tags.circuitBreaker = "fast_fail_open";
        throw new HubUnavailableError(scope, state.openedUntil - now);
      }
      // Cooldown elapsed → eligible for probe
      this.transition(state, scope, "HALF_OPEN", "cooldown_elapsed", now);
    }

    // HALF_OPEN: admit exactly one probe; reject concurrent callers
    if (state.status === "HALF_OPEN" && state.probeInFlight) {
      ctx.tags.circuitBreaker = "fast_fail_half_open";
      throw new HubUnavailableError(scope, this.cooldownMs);
    }

    const wasHalfOpen = state.status === "HALF_OPEN";
    if (wasHalfOpen) {
      state.probeInFlight = true;
      ctx.tags.circuitBreaker = "probe";
    }

    try {
      const result = await next(ctx);
      this.recordSuccess(state, scope, now);
      return result;
    } catch (err) {
      this.recordFailure(state, scope, err, now);
      throw err;
    } finally {
      state.probeInFlight = false;
    }
  }

  /** Current state for diagnostics + tests. */
  getScopeStatus(scope: string): CircuitState | null {
    const s = this.scopes.get(scope);
    return s ? s.status : null;
  }

  private getOrCreateScope(scope: string): PerScopeState {
    let s = this.scopes.get(scope);
    if (!s) {
      s = {
        status: "CLOSED",
        recentFailureTimestamps: [],
        openedUntil: 0,
        probeInFlight: false,
      };
      this.scopes.set(scope, s);
    }
    return s;
  }

  private recordSuccess(state: PerScopeState, scope: string, now: number): void {
    if (state.status === "HALF_OPEN") {
      this.transition(state, scope, "CLOSED", "probe_succeeded", now);
      state.recentFailureTimestamps = [];
    }
    // CLOSED success: no state change; do not mutate failure list (only
    // fault events prune it via the rolling window).
  }

  private recordFailure(
    state: PerScopeState,
    scope: string,
    err: unknown,
    now: number,
  ): void {
    // Non-transport faults don't count toward the threshold — pass
    // through without state change.
    if (!this.isTransportFault(err)) return;

    if (state.status === "HALF_OPEN") {
      // Probe failed → re-open with fresh cooldown
      state.openedUntil = now + this.cooldownMs;
      this.transition(state, scope, "OPEN", "probe_failed", now);
      return;
    }

    // CLOSED: accumulate within rolling window
    const windowStart = now - this.observationWindowMs;
    state.recentFailureTimestamps = state.recentFailureTimestamps.filter(
      (t) => t >= windowStart,
    );
    state.recentFailureTimestamps.push(now);

    if (state.recentFailureTimestamps.length >= this.failureThreshold) {
      state.openedUntil = now + this.cooldownMs;
      this.transition(
        state,
        scope,
        "OPEN",
        `threshold_${this.failureThreshold}_within_${this.observationWindowMs}ms`,
        now,
      );
      state.recentFailureTimestamps = [];
    }
  }

  private transition(
    state: PerScopeState,
    scope: string,
    to: CircuitState,
    reason: string,
    now: number,
  ): void {
    const from = state.status;
    if (from === to) return;
    state.status = to;
    if (this.onStateChange) {
      try {
        this.onStateChange({ scope, from, to, reason, timestamp: now });
      } catch {
        /* sink failure swallowed */
      }
    }
  }
}
