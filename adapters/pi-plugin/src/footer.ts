/**
 * footer.ts — the swarm-aware footer renderer (mission-99 slice (a) spine).
 *
 * Design-of-record: docs/designs/m-swarm-footer/ratified-spec.md v2.1.
 *
 * A fixed-height 2-line "me + world" HUD:
 *   Line 1 (SELF):  identity │ ctx │ llm
 *   Line 2 (WORLD): work │ hub[FSM] │ ⟶ needs-you(S4-approx)
 *
 * INVARIANTS ENFORCED HERE:
 *  - gate 1 (pure render): render() reads ONLY the injected FooterInputs — a
 *    plain data snapshot + local pi accessors. ZERO Hub-client calls. No timers.
 *  - gate 3/9 (fixed-height + fail-quiet): ALWAYS returns exactly 2 lines.
 *  - gate 4 (FSM mirror): hub cell renders all 5 states; [live] is the ONLY
 *    nominal; freshness [Ns] shows ONLY in [live]; honesty cascade (§7) —
 *    non-[live] → peers/needs stale-marked or `?`, never fabricated.
 *  - gate 8 (read-only): this module imports NOTHING that mutates; it is a pure
 *    string producer.
 *  - tele-1 honesty: unknowns render `?` / dim, never masquerade as nominal;
 *    stale never red-alerts and never shows as fresh.
 *
 * Color: applied via the injected theme.fg accessor (spec §2 — color is an
 * ACCELERATOR; glyph + value + text carry severity on monochrome too).
 * Width-safety: the caller truncates to width with an ANSI-safe helper.
 */

import type { SessionState } from "@apnex/network-adapter";
import { llmErrorCount, type FooterState } from "./footer-state.js";

/** Severity → theme color-key (spec §9 3-tier). */
export type Severity = "nominal" | "notice" | "alert";

// ── ANSI-safe width helpers (gate 2 width-safety) ────────────────────
//
// pi passes an available `width` to render(width) and requires each returned
// line's VISIBLE width to be ≤ width (docs/tui.md §Custom Footer). Color is
// applied via theme.fg (SGR escapes), so we must measure + truncate on the
// VISIBLE columns, never the raw byte length. These are self-contained (no
// dep on @earendil-works/pi-tui, which is not a declared adapter dep) so the
// budgeting logic is directly unit-testable.

// Matches a CSI SGR escape sequence (\x1b[ ... m) — what theme.fg emits.
// eslint-disable-next-line no-control-regex
const ANSI_SGR = /\x1b\[[0-9;]*m/g;
const ANSI_RESET = "\x1b[0m";

/** Visible display width of a string, ignoring ANSI SGR escapes (spec §gate2). */
export function visibleWidth(s: string): number {
  return stripAnsi(s).length;
}

function stripAnsi(s: string): string {
  return s.replace(ANSI_SGR, "");
}

/**
 * ANSI-safe truncate: cap the VISIBLE width at `width`, preserving color runs
 * and always emitting a trailing reset so no SGR state leaks past the line.
 * When truncation occurs the last visible column is an ellipsis `…` (which
 * itself counts toward the budget, so the result is still ≤ width).
 *
 * width ≤ 0 → "" . A string already within budget is returned unchanged.
 */
export function truncateToWidth(s: string, width: number): string {
  if (width <= 0) return "";
  if (visibleWidth(s) <= width) return s;
  // Budget one column for the ellipsis.
  const budget = width - 1;
  let out = "";
  let vis = 0;
  let sawAnsi = false;
  for (let i = 0; i < s.length; ) {
    if (s[i] === "\x1b") {
      // Copy the whole escape sequence verbatim (zero visible width).
      ANSI_SGR.lastIndex = i;
      const m = ANSI_SGR.exec(s);
      if (m && m.index === i) {
        out += m[0];
        i += m[0].length;
        sawAnsi = true;
        continue;
      }
    }
    if (vis >= budget) break;
    out += s[i];
    vis += 1;
    i += 1;
  }
  out += "\u2026"; // ellipsis (1 visible col, within budget)
  if (sawAnsi) out += ANSI_RESET; // never leak SGR state past the line
  return out;
}

/** Minimal theme accessor the renderer needs (matches pi Theme.fg). */
export interface FooterTheme {
  fg(colorKey: string, s: string): string;
}

/** Local, non-Hub inputs the render reads (all cheap + synchronous). */
export interface FooterInputs {
  state: FooterState;
  /** pi-native context usage; undefined/null percent = honest unknown (spec §4). */
  contextUsage: { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
  /** pi-native git branch (or null). */
  gitBranch: string | null;
  /**
   * Read-only lease snapshot (client-side; spec §4 work cell). Most-recent first.
   * Empty = idle.
   */
  leases: ReadonlyArray<{ workId: string; expiresAtMs: number }>;
  /** Injected clock (testability + determinism). */
  nowMs: number;
}

/** Map a severity to a theme color-key. Monochrome terminals still get glyph+text. */
function color(theme: FooterTheme, sev: Severity, s: string): string {
  switch (sev) {
    case "alert":
      return theme.fg("error", s);
    case "notice":
      return theme.fg("warning", s);
    default:
      return theme.fg("dim", s);
  }
}

// ── Line 1 cells (SELF) ──────────────────────────────────────────────

function identityCell(theme: FooterTheme, s: FooterState): string {
  const name = s.name || "?";
  const role = s.role ? shortRole(s.role) : "?";
  return theme.fg("dim", `${name}·${role}`);
}

function shortRole(role: string): string {
  switch (role) {
    case "architect":
      return "arch";
    case "engineer":
      return "eng";
    case "verifier":
      return "ver";
    case "director":
      return "dir";
    default:
      return role;
  }
}

function ctxCell(theme: FooterTheme, u: FooterInputs["contextUsage"]): string {
  // Honest unknown: percent null (e.g. right after compaction, spec §4).
  if (!u || u.percent === null || u.tokens === null) {
    return `${theme.fg("dim", "ctx")} ${theme.fg("dim", "?")}`;
  }
  const pct = Math.round(u.percent);
  const sev: Severity = pct >= 90 ? "alert" : pct >= 70 ? "notice" : "nominal";
  const used = fmtTokens(u.tokens);
  const total = fmtTokens(u.contextWindow);
  const label = theme.fg("dim", "ctx");
  // pct leads (at-a-glance severity); absolute bracketed (spec §4).
  return `${label} ${color(theme, sev, `${pct}%`)} ${theme.fg("dim", `[${used}/${total}]`)}`;
}

function fmtTokens(n: number): string {
  return n < 1000 ? `${n}` : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
}

function llmCell(theme: FooterTheme, s: FooterState, nowMs: number): string {
  const errs = llmErrorCount(s, nowMs);
  const label = theme.fg("dim", "llm");
  if (errs === 0) {
    // Clean → dim 'ok' (spec §5a). Calm = absence of amber/red.
    return `${label} ${theme.fg("dim", "ok")}`;
  }
  // Errors → '⚠ err ×N' (rolling window; decays back to ok). NO retry/backoff/
  // codes — not feedable from the extension surface today (spec §5a).
  return `${label} ${color(theme, "notice", `⚠ err ×${errs}`)}`;
}

// ── Line 2 cells (WORLD) ─────────────────────────────────────────────

function workCell(theme: FooterTheme, inputs: FooterInputs): string {
  const label = theme.fg("dim", "work");
  const lease = inputs.leases[0];
  if (!lease) {
    return `${label} ${theme.fg("dim", "idle")}`;
  }
  const remainingMs = lease.expiresAtMs - inputs.nowMs;
  const remaining = fmtDuration(remainingMs);
  // Amber as it shrinks, red near-expiry (spec §4).
  const sev: Severity =
    remainingMs <= 60_000 ? "alert" : remainingMs <= 5 * 60_000 ? "notice" : "nominal";
  const id = shortWorkId(lease.workId);
  return `${label} ${theme.fg("dim", id)} ${color(theme, sev, `[${remaining}]`)}`;
}

function shortWorkId(workId: string): string {
  // Blueprint ids are long (work-bp-<run>-<local>); show the trailing local part.
  const m = workId.match(/^work-bp-[^-]+-(.+)$/);
  return m ? m[1] : workId;
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return m > 0 ? `${m}m${sec}s` : `${sec}s`;
}

/**
 * hub cell — the adapter FSM mirrored VERBATIM (spec §7). [live] is the ONLY
 * nominal; freshness [Ns] shows ONLY in [live]. Returns the cell + whether the
 * wire is trusted (drives the honesty cascade for downstream cells).
 */
function hubCell(
  theme: FooterTheme,
  s: FooterState,
  nowMs: number,
): { cell: string; trusted: boolean } {
  const label = theme.fg("dim", "hub");
  const state = s.hubState;
  // Cold start (no transition yet) — honest neutral, NOT a fabricated [live].
  if (state === null) {
    return { cell: `${label} ${color(theme, "notice", "[conn…]")}`, trusted: false };
  }
  const spec = HUB_CELL_SPEC[state];
  if (state === "streaming") {
    const freshness = s.hubStreamingSinceMs !== null
      ? ` ${theme.fg("dim", `[${fmtDuration(nowMs - s.hubStreamingSinceMs)}]`)}`
      : "";
    return {
      cell: `${label} ${color(theme, "nominal", "[live]")}${freshness}`,
      trusted: true,
    };
  }
  return { cell: `${label} ${color(theme, spec.sev, spec.text)}`, trusted: false };
}

const HUB_CELL_SPEC: Record<SessionState, { text: string; sev: Severity }> = {
  disconnected: { text: "[disc]", sev: "alert" },
  connecting: { text: "[conn…]", sev: "notice" },
  synchronizing: { text: "[sync]", sev: "notice" },
  streaming: { text: "[live]", sev: "nominal" }, // freshness appended in hubCell
  reconnecting: { text: "[recon]", sev: "notice" },
};

/**
 * ⟶ needs-you (S4-approx). Honesty cascade (spec §7/§10):
 *  - hub not trusted → `needs ?` (NEVER zeros / "all clear" on an untrusted wire).
 *  - trusted + zero → dim `nothing needs you` (fail-quiet, legal ONLY when live).
 *  - trusted + N   → `⟶ ~N` (tilde = APPROXIMATE; never authoritative — spec §10).
 */
function needsCell(theme: FooterTheme, s: FooterState, trusted: boolean): string {
  if (!trusted) {
    return `${theme.fg("dim", "needs")} ${theme.fg("dim", "?")}`;
  }
  if (s.s4ApproxCount <= 0) {
    return theme.fg("dim", "nothing needs you");
  }
  // Tilde marks approximation (fed only by onPendingActionItem push, spec §10).
  return color(theme, "notice", `⟶ ~✎${s.s4ApproxCount}`);
}

// ── The 2-line assembly (fixed height) ───────────────────────────────

const SEP = " │ ";

/**
 * Render the footer as EXACTLY 2 lines (never collapses/expands — spec §3).
 * Pure: reads only `inputs`. Installs only in TUI mode (gate 0, enforced by the
 * installer).
 *
 * gate 2 (width-safety): when `width` is provided (pi passes the terminal width
 * to render(width)), BOTH lines are ANSI-safe truncated so their VISIBLE width
 * is ≤ width — at every column in the 120/100/80/64/50 matrix. Fixed height is
 * preserved (always exactly 2 lines; truncation never drops a line). `width`
 * omitted/≤0 → no truncation (raw render, for content assertions in tests).
 */
export function renderFooter(
  theme: FooterTheme,
  inputs: FooterInputs,
  width?: number,
): [string, string] {
  const { state, nowMs } = inputs;

  const line1 = [
    identityCell(theme, state),
    ctxCell(theme, inputs.contextUsage),
    llmCell(theme, state, nowMs),
  ].join(SEP);

  const { cell: hub, trusted } = hubCell(theme, state, nowMs);
  const line2 = [
    workCell(theme, inputs),
    hub,
    needsCell(theme, state, trusted),
  ].join(SEP);

  if (width !== undefined && width > 0) {
    return [truncateToWidth(line1, width), truncateToWidth(line2, width)];
  }
  return [line1, line2];
}
