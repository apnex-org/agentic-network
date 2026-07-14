/**
 * wake.ts — pi notification render (last-mile).
 *
 * Implements the Universal Adapter 4-hook notification contract for the pi host.
 * Core (event-router → DispatcherNotificationHooks) classifies + routes events
 * through the MessageRouter dedup; this file only RENDERS the already-decided
 * outcome into pi's surface (`sendUserMessage` / `ctx.ui`).
 *
 * A11 discipline (Hydration-as-Offload): the wake TEXT is computed in core by
 * `buildPromptText` — this file does NOT assemble work state or compose prompts.
 * It reads a pre-hydrated string and delivers it. If prompt composition appears
 * here, that is substrate leakage the wrong way.
 *
 * A3 facade: imports `@apnex/network-adapter` ONLY.
 *
 * Hook → pi rendering (design §5):
 *   onActionableEvent    → wake the LLM (sendUserMessage; idle→turn, streaming→followUp)
 *   onInformationalEvent → LOG ONLY (must NOT wake — idea-331 parity)
 *   onStateChange        → diagnostic (ctx.ui.setStatus + log)
 *   onPendingActionItem  → drain-path wake (bug-108 parity; same render path)
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  buildPromptText,
  getActionText,
  isPulseEvent,
  reconstructDrainedAction,
  appendNotification,
  type AgentEvent,
  type SessionState,
  type SessionReconnectReason,
  type DispatcherNotificationHooks,
  type DrainedPendingAction,
} from "@apnex/network-adapter";

export interface PiWakeDeps {
  pi: ExtensionAPI;
  /** Live idle probe (pi native). Idle → deliver a fresh turn; else queue followUp. */
  isIdle: () => boolean;
  /** Diagnostic log sink (file logger). */
  log: (msg: string) => void;
  /** Notification audit-log path (best-effort append). */
  notificationLogPath: string;
  /**
   * The host tool-prefix from the harness manifest (bug-266). pi registers Hub tools
   * RAW, so this is "" — wake prompts name the bare tool (`get_task`), NOT the stale
   * `architect-hub_get_task`. Threaded from MANIFEST.toolPrefix, never hardcoded.
   */
  toolPrefix: string;
  /** Live status surface (optional; TUI-only). */
  ctx?: ExtensionContext;
  /**
   * Swarm-aware footer push-feed (mission-99 slice (a)). Optional + null in
   * non-TUI mode (gate 0). onStateChange feeds the hub FSM cell;
   * onPendingActionItem feeds the S4-approx cell. Observation only — the footer
   * render is pure + read-only (gate 1/8).
   */
  footer?: {
    onHubState(state: SessionState): void;
    onPendingActionItem(): void;
  } | null;
}

/**
 * Deliver a wake prompt to pi. Idle → immediate turn; streaming → non-interrupting
 * followUp (matches opencode's non-interrupting queue; we do NOT steer/interrupt a
 * mid-task turn, honoring the idle-gate intent).
 */
function deliverWake(deps: PiWakeDeps, promptText: string): void {
  const { pi } = deps;
  try {
    if (deps.isIdle()) {
      // Not streaming: sendUserMessage triggers a fresh turn immediately.
      void pi.sendUserMessage(promptText);
    } else {
      // Streaming: queue until the agent finishes its current tool calls.
      void pi.sendUserMessage(promptText, { deliverAs: "followUp" });
    }
  } catch (err) {
    deps.log(`[wake] sendUserMessage failed (non-fatal): ${(err as Error)?.message ?? err}`);
  }
}

/**
 * Build the pi host's DispatcherNotificationHooks — the same seam opencode/claude
 * bind. Passed into `createSharedDispatcher({ notificationHooks })` so the wake
 * routes THROUGH router.route() (SeenIdCache dedup) before reaching these hooks.
 */
export function buildPiNotificationHooks(
  deps: PiWakeDeps,
): DispatcherNotificationHooks {
  return {
    onActionableEvent: (event: AgentEvent): void => {
      const isPulse = isPulseEvent(event.event, event.data);
      const action = getActionText(event.event, event.data);
      appendNotification(
        {
          event: event.event,
          data: event.data,
          action: isPulse ? `[PULSE] ${action}` : action,
        },
        { logPath: deps.notificationLogPath },
      );
      // Pulse events downgrade to log-only (S3 pulse-noise mitigation; do not
      // wake — matches opencode's informational disposition for pulses).
      if (isPulse) return;
      const promptText = buildPromptText(event.event, event.data, {
        toolPrefix: deps.toolPrefix,
      });
      deliverWake(deps, promptText);
    },

    onInformationalEvent: (event: AgentEvent): void => {
      // LOG ONLY — informational events must NOT wake/surface (idea-331 parity;
      // the flood-avoidance disposition both existing shims converged on).
      const action = getActionText(event.event, event.data);
      appendNotification(
        { event: event.event, data: event.data, action: `[INFO] ${action}` },
        { logPath: deps.notificationLogPath },
      );
    },

    onStateChange: (
      state: SessionState,
      prev: SessionState,
      reason?: SessionReconnectReason,
    ): void => {
      deps.log(`Connection: ${prev} → ${state}${reason ? ` (${reason})` : ""}`);
      // Live wire-state surface (TUI-only; no-op in print/json mode).
      try {
        deps.ctx?.ui.setStatus("hub", `hub: ${state}`);
      } catch {
        /* UI not ready */
      }
      // mission-99 slice (a): feed the swarm-footer hub-FSM cell (push, §6).
      try {
        deps.footer?.onHubState(state);
      } catch {
        /* footer not ready — non-fatal */
      }
    },

    onPendingActionItem: (item: DrainedPendingAction): void => {
      // Drain-path wake (bug-108 parity): reconstruct the event via the SAME
      // core helper the other shims use, then render through the SAME wake path.
      const { agentEvent, actionHint, level } = reconstructDrainedAction(item);
      appendNotification(
        { event: agentEvent.event, data: agentEvent.data, action: actionHint },
        { logPath: deps.notificationLogPath },
      );
      // mission-99 slice (a): feed the swarm-footer S4-approx cell (push, §6/§10).
      // Approximate by construction — the footer renders it tilde-marked, never
      // authoritative. Read-only observation (does NOT drain; gate 8).
      try {
        deps.footer?.onPendingActionItem();
      } catch {
        /* footer not ready — non-fatal */
      }
      if (level === "informational") return; // drained-but-informational: log only
      const promptText = buildPromptText(agentEvent.event, agentEvent.data, {
        toolPrefix: deps.toolPrefix,
      });
      deliverWake(deps, promptText);
    },
  };
}
