/**
 * footer.ts — the swarm-aware footer renderer (mission-99 slice (a) spine).
 *
 * Design-of-record: docs/designs/m-swarm-footer/ratified-spec.md v2.1.
 *
 * A fixed-height 2-line "me + world" HUD:
 *   Line 1 (SELF):  identity │ ctx │ llm
 *   Line 2 (WORLD): work │ hub[FSM] │ peers │ ⟶ needs-you(S4)
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
import { llmErrorCount, isSwarmFresh, type FooterState, type PeerHealth } from "./footer-state.js";

/** Severity → theme color-key (spec §9 3-tier). */
export type Severity = "nominal" | "notice" | "alert";

// ── ANSI-safe width helpers (gate 2 width-safety) ────────────────────
//
// pi passes an available `width` to render(width) and requires each returned
// line's VISIBLE width to be ≤ width (docs/tui.md §Custom Footer). Color is
// applied via theme.fg (SGR escapes) and the footer uses wide glyphs
// (‹›·⟶⚠…), so we must measure + truncate on the VISIBLE display columns,
// never the raw byte/char length.
//
// A3 compose-by-default (architect steer, thread 01KWHGGKT0…): these are the
// HOST's own TUI primitives — @earendil-works/pi-tui EXPORTS visibleWidth +
// truncateToWidth(text, maxWidth, ellipsis?). pi-coding-agent itself depends on
// pi-tui@^0.80.3, so it is version-aligned; we DECLARE it as a pi-plugin
// peer+dev dep (matching the pi-coding-agent placement) and COMPOSE the shared
// helpers rather than re-implement a platform primitive. Bonus correctness:
// pi-tui's visibleWidth handles East-Asian / wide chars (get-east-asian-width),
// which a naive .length would miscount. Re-exported here so the render module
// keeps a single import surface.
export { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import { truncateToWidth as _truncateToWidth } from "@earendil-works/pi-tui";

/** The truncation ellipsis (§3 didn't pin one; matches pi-tui's conventional default). */
const ELLIPSIS = "\u2026";

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
 * peers cell — exception-biased swarm population (spec §8). Honesty cascade
 * (spec §7/§9):
 *  - hub not trusted OR pull stale/absent → `peers ?` (NEVER a fabricated dot
 *    census / "all healthy" on an untrusted-or-stale view).
 *  - trusted + fresh, all online → compact `◉◉◉` (one dot per healthy peer).
 *  - trouble → collapses to NAME the problem `[⚠ name down]` (red), exception-biased.
 *  - a stale-but-present pull (hub live, pull aged) → dot census + `(stale)` marker
 *    (spec §9: stale never red-alerts, never masquerades as fresh).
 * PULL-fed (get_agents env=prod, §6 pull path) — render reads only s.swarm.
 */
function peersCell(theme: FooterTheme, s: FooterState, trusted: boolean, nowMs: number): string {
  const label = theme.fg("dim", "peers");
  // Untrusted wire OR no pull yet → honest unknown (§7 cascade).
  if (!trusted || s.swarm === null) {
    return `${label} ${theme.fg("dim", "?")}`;
  }
  const fresh = isSwarmFresh(s, nowMs);
  const peers = s.swarm.peers;
  const down = peers.filter((p) => p.down);

  // Exception-biased: any down peer NAMES the problem (spec §8), red.
  if (down.length > 0) {
    const named = down.map((p) => `⚠ ${p.name} down`).join(", ");
    const cell = color(theme, "alert", `[${named}]`);
    return `${label} ${fresh ? cell : `${cell} ${theme.fg("dim", "(stale)")}`}`;
  }

  // All healthy → compact dot census (one ◉ per online peer). Zero peers = honest
  // dim `none` (never a fabricated dot).
  const dots = peers.length > 0 ? "◉".repeat(peers.length) : "none";
  const cell = peers.length > 0 ? theme.fg("dim", dots) : theme.fg("dim", "none");
  return `${label} ${fresh ? cell : `${cell} ${theme.fg("dim", "(stale)")}`}`;
}

/**
 * ⟶ needs-you (S4). Honesty cascade (spec §7/§9/§10) + authoritative-over-approx:
 *  - hub not trusted → `needs ?` (NEVER zeros / "all clear" on an untrusted wire).
 *  - AUTHORITATIVE (fresh pull, spec §10/§11) → exact `⟶ ✎N` (NO tilde — the
 *    approximation is retired) or dim `nothing needs you` at zero.
 *  - fallback (no fresh pull) → push-only ~approx `⟶ ~✎N` (tilde = APPROXIMATE,
 *    spec §10) or dim `nothing needs you` at approx-zero.
 * The authoritative count (slice b) supersedes the push-only approx whenever the
 * pull is fresh; the tilde reappears only if the pull goes stale (honest degrade).
 */
function needsCell(theme: FooterTheme, s: FooterState, trusted: boolean, nowMs: number): string {
  const label = theme.fg("dim", "needs");
  if (!trusted) {
    return `${label} ${theme.fg("dim", "?")}`;
  }
  // Authoritative role-scoped S4 (spec §10/§11/§12) — retires the tilde when fresh.
  if (isSwarmFresh(s, nowMs)) {
    const n = s.swarm!.s4Authoritative;
    if (n <= 0) return theme.fg("dim", "nothing needs you");
    return color(theme, "notice", `⟶ ✎${n}`);
  }
  // Fallback: push-only approximation (tilde-marked, spec §10).
  if (s.s4ApproxCount <= 0) {
    return theme.fg("dim", "nothing needs you");
  }
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
    peersCell(theme, state, trusted, nowMs),
    needsCell(theme, state, trusted, nowMs),
  ].join(SEP);

  if (width !== undefined && width > 0) {
    // pi-tui truncateToWidth guarantees visibleWidth(result) ≤ width at every
    // column, ANSI-safe, appending the ellipsis only when it actually truncates.
    return [
      _truncateToWidth(line1, width, ELLIPSIS),
      _truncateToWidth(line2, width, ELLIPSIS),
    ];
  }
  return [line1, line2];
}
