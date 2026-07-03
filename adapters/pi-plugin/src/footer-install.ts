/**
 * footer-install.ts — installs the swarm-aware footer into pi's TUI surface and
 * wires the push-event observers that feed it (mission-99 slice (a) spine).
 *
 * Design-of-record: docs/designs/m-swarm-footer/ratified-spec.md v2.1.
 *
 * RESPONSIBILITIES (kept OUT of the pure renderer):
 *  - gate 0 (TUI-only guard): install setFooter ONLY when ctx.mode === "tui";
 *    a NO-OP in print/json/rpc/headless. `installFooter` returns early otherwise.
 *  - reactive-not-busy (spec §6): push events mutate the shared FooterState and
 *    call tui.requestRender() — there is NO 1Hz loop and NO timer here. The live
 *    model-call timer lives at the PROMPT (spec §3), not this footer.
 *  - the setFooter factory's render() delegates to the PURE renderFooter(), which
 *    reads only local pi accessors (getContextUsage / getGitBranch / lease
 *    snapshot) + the FooterState — ZERO Hub calls (gate 1).
 *
 * The push hooks themselves are OBSERVERS wired by the shim onto the existing
 * notification hooks + pi event surface; this module exposes the observer
 * functions so the shim can compose them without this module importing the shim.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SessionState } from "@apnex/network-adapter";
import {
  createFooterState,
  observeHubState,
  observePendingActionItem,
  observeLlmError,
  observeSwarmPull,
  resetS4Approx,
  type FooterState,
  type PeerHealth,
} from "./footer-state.js";
import { renderFooter, type FooterTheme } from "./footer.js";

/** Minimal lease-snapshot source (the dispatcher's WorkLeaseTracker). */
export interface LeaseSnapshotSource {
  snapshot(): ReadonlyArray<{ workId: string; expiresAtMs: number }>;
}

/** A handle the shim uses to feed push events into the footer + trigger renders. */
export interface FooterController {
  readonly state: FooterState;
  /** onStateChange → hub FSM cell. */
  onHubState(state: SessionState): void;
  /** onPendingActionItem → S4-approx bump. */
  onPendingActionItem(): void;
  /** message_end stopReason=error → llm coarse tally. */
  onLlmError(): void;
  /**
   * Tier-C heartbeat poll → authoritative peers (§8) + role-scoped S4 (§10/§11).
   * Slice (b) PULL path; observation only (read tools), retires the ~tilde.
   */
  onSwarmPull(peers: PeerHealth[], s4Authoritative: number): void;
  /** the agent took a turn → reset the approx "since you last looked" count. */
  onAgentTurn(): void;
  /** Set identity once known (connect). */
  setIdentity(name: string, role: string): void;
  /** Tear down (restore built-in footer). Idempotent. */
  dispose(): void;
}

export interface InstallFooterOpts {
  ctx: ExtensionContext;
  /** Source of the agent's own client-side lease snapshot (spec §4 work cell). */
  leases: LeaseSnapshotSource;
  /** Injected clock (default Date.now) — testability. */
  now?: () => number;
  log?: (msg: string) => void;
}

/**
 * Install the footer. Returns a FooterController the shim feeds push events into,
 * or `null` when NOT in TUI mode (gate 0 — no install, no state, no activity).
 */
export function installFooter(opts: InstallFooterOpts): FooterController | null {
  const { ctx, leases } = opts;
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? (() => {});

  // ── gate 0: TUI-only guard ──────────────────────────────────────────
  if (ctx.mode !== "tui") {
    log(`[footer] not TUI mode (${ctx.mode}) — footer not installed (no-op)`);
    return null;
  }

  const state = createFooterState();
  let requestRender: (() => void) | null = null;
  let disposed = false;

  try {
    ctx.ui.setFooter((tui, theme) => {
      requestRender = () => {
        try {
          tui.requestRender();
        } catch {
          /* tui not ready */
        }
      };
      return {
        invalidate() {},
        // gate 2: pi passes the available terminal width; each returned line's
        // VISIBLE width MUST be ≤ width (docs/tui.md §Custom Footer). renderFooter
        // ANSI-safe truncates both lines to width, preserving fixed height.
        render(width: number): string[] {
          // PURE (gate 1): only local accessors + the pushed state. No Hub calls.
          const [line1, line2] = renderFooter(
            theme as FooterTheme,
            {
              state,
              contextUsage: ctx.getContextUsage(),
              gitBranch: null, // reserved (identity uses name·role; branch is fast-follow)
              model: ctx.model ? { id: ctx.model.id, provider: ctx.model.provider } : undefined,
              leases: leases.snapshot(),
              nowMs: now(),
            },
            width,
          );
          // Exactly 2 lines (fixed height, spec §3), each ≤ width (gate 2).
          return [line1, line2];
        },
      };
    });
  } catch (err) {
    log(`[footer] setFooter failed (non-fatal): ${(err as Error)?.message ?? err}`);
    return null;
  }

  const kick = (): void => {
    if (!disposed) requestRender?.();
  };

  return {
    state,
    onHubState(s: SessionState): void {
      observeHubState(state, s, now());
      kick();
    },
    onPendingActionItem(): void {
      observePendingActionItem(state);
      kick();
    },
    onLlmError(): void {
      observeLlmError(state, now());
      kick();
    },
    onSwarmPull(peers: PeerHealth[], s4Authoritative: number): void {
      observeSwarmPull(state, peers, s4Authoritative, now());
      kick();
    },
    onAgentTurn(): void {
      resetS4Approx(state);
      kick();
    },
    setIdentity(name: string, role: string): void {
      state.name = name;
      state.role = role;
      kick();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      try {
        ctx.ui.setFooter(undefined);
      } catch {
        /* already gone */
      }
    },
  };
}
