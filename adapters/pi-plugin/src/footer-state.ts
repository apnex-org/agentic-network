/**
 * footer-state.ts — the swarm-aware footer's push-fed state store.
 *
 * mission-99 slice (a) — SHIP-FIRST push-only spine. Design-of-record:
 * docs/designs/m-swarm-footer/ratified-spec.md v2.1.
 *
 * WHY A SEPARATE STORE (the load-bearing architectural decision):
 * spec §14 gate 1 (pure-render contract) requires `render(width)` to make ZERO
 * Hub-client calls. So every cell that would otherwise need a Hub read is fed by
 * a PUSH event (onStateChange → hub FSM; onPendingActionItem → S4-approx;
 * message_end stopReason=error → llm tally) that writes into THIS store. The
 * footer's render() then reads ONLY this store (+ pi-native getContextUsage /
 * getGitBranch, which are local). No timers, no polls, no Hub calls in render.
 *
 * HARD READ-ONLY INVARIANT (spec §6, §14 gate 8): nothing in this module — or
 * the render path that consumes it — may call a mutating tool. This store is fed
 * by observation only.
 *
 * A11 discipline: this holds already-decided display state; it does not compose
 * prompts or reach into core.
 */

import type { SessionState } from "@apnex/network-adapter";

/** Rolling window for the coarse llm error tally (spec §5a: ~5 min, tunable). */
export const LLM_ERROR_WINDOW_MS = 5 * 60_000;

/**
 * Live footer state — mutated ONLY by push-event observers, read ONLY by render.
 * All fields have honest "unknown" defaults so a cold footer never fabricates.
 */
export interface FooterState {
  /** Agent identity — set once at connect (name·role). */
  name: string;
  role: string;

  /**
   * The adapter session FSM state (spec §7), fed by onStateChange. `null` before
   * the first transition = the honest cold-start unknown (renders `[conn…]`-ish
   * neutral, never a fabricated `[live]`).
   */
  hubState: SessionState | null;
  /** Epoch-ms the hub last transitioned INTO `streaming` — freshness anchor. */
  hubStreamingSinceMs: number | null;
  /** Epoch-ms of the last observed state change (any) — the freshness clock. */
  hubLastChangeMs: number | null;

  /**
   * S4-approx: the count of engineer-relevant actionable pending items observed
   * via onPendingActionItem push. APPROXIMATE by construction (spec §10) — the
   * render MUST mark it with a `~` tilde and NEVER present it as authoritative.
   * The authoritative role-scoped count is a fast-follow slice (b) that retires
   * the tilde.
   */
  s4ApproxCount: number;

  /**
   * Coarse llm-error timestamps (epoch-ms) within the rolling window. Fed by
   * message_end stopReason=error (spec §5a). Rolled off on read. NO retry-depth,
   * NO backoff, NO HTTP codes — none are feedable from the extension surface
   * today (spec §5a / catch #3).
   */
  llmErrorTimestamps: number[];
}

/** Fresh state with honest unknowns. */
export function createFooterState(name = "", role = ""): FooterState {
  return {
    name,
    role,
    hubState: null,
    hubStreamingSinceMs: null,
    hubLastChangeMs: null,
    s4ApproxCount: 0,
    llmErrorTimestamps: [],
  };
}

// ── Push-event observers (the ONLY writers) ──────────────────────────

/** onStateChange → record the hub FSM transition. */
export function observeHubState(
  s: FooterState,
  state: SessionState,
  nowMs: number,
): void {
  s.hubState = state;
  s.hubLastChangeMs = nowMs;
  if (state === "streaming") {
    // Anchor freshness at the moment we (re)entered the trusted state.
    s.hubStreamingSinceMs = nowMs;
  } else {
    // Leaving live: freshness is no longer trustworthy (spec §7 honesty cascade).
    s.hubStreamingSinceMs = null;
  }
}

/** onPendingActionItem → bump the S4-approx count (approximate, tilde-marked). */
export function observePendingActionItem(s: FooterState): void {
  s.s4ApproxCount += 1;
}

/**
 * The agent acted on / drained its actionable surface — reset the approx count.
 * Called when the agent takes a turn (the approx signal is "something arrived
 * since you last looked"); keeps S4-approx from monotonically growing. This is
 * an observation of the agent's OWN turn, not a Hub mutation.
 */
export function resetS4Approx(s: FooterState): void {
  s.s4ApproxCount = 0;
}

/** message_end stopReason=error → record one coarse llm error. */
export function observeLlmError(s: FooterState, nowMs: number): void {
  s.llmErrorTimestamps.push(nowMs);
  rollOffLlmErrors(s, nowMs);
}

/** Drop llm-error timestamps outside the rolling window (called on write + read). */
export function rollOffLlmErrors(s: FooterState, nowMs: number): void {
  const cutoff = nowMs - LLM_ERROR_WINDOW_MS;
  if (s.llmErrorTimestamps.length && s.llmErrorTimestamps[0] < cutoff) {
    s.llmErrorTimestamps = s.llmErrorTimestamps.filter((t) => t >= cutoff);
  }
}

/** Current in-window llm error count (rolls off first). */
export function llmErrorCount(s: FooterState, nowMs: number): number {
  rollOffLlmErrors(s, nowMs);
  return s.llmErrorTimestamps.length;
}
