/**
 * Shared Event Router — Classification, dedup, and parsing for Hub SSE events.
 *
 * Extracts the common event handling logic that was duplicated between
 * the Engineer Plugin and the Architect Agent. Both consumers import
 * from this module and only implement their own dispatch mechanisms
 * (Push-to-LLM for the Plugin, Sandwich pattern for the Architect).
 */

// Type-only import (erased at runtime → no value-level circular dep;
// state-sync.ts does not import event-router). Used by reconstructDrainedAction.
import type { DrainedPendingAction } from "./state-sync.js";

// ── Event Types ──────────────────────────────────────────────────────

/** All known Hub event types */
export type HubEventType =
  | "task_issued"
  | "directive_acknowledged"
  | "report_submitted"
  | "review_completed"
  | "revision_required"
  | "proposal_submitted"
  | "proposal_decided"
  | "clarification_requested"
  | "clarification_answered"
  | "thread_opened"
  | "thread_message"
  // Mission-24 Phase 2 (M24-T3, ADR-014): merged from the legacy
  // thread_converged + thread_convergence_completed pair. Fires once,
  // after cascade, carrying the full ConvergenceReport.
  | "thread_convergence_finalized"
  | "thread_abandoned"
  | "idea_submitted"
  | "mission_created"
  | "mission_activated"
  | "turn_created"
  | "turn_updated"
  | "tele_defined"
  | "director_attention_required"
  | "cascade_failure"
  // Mission-56 W1a: push-on-Message-create. Hub fires this when a
  // Message with delivery="push-immediate" lands a target the
  // subscriber matches. Payload is an inline Message envelope. Layer
  // 2 (`@apnex/message-router`) routes Message kind/subkind onto host
  // hooks; classification at Layer 1 dispositions all engineer +
  // architect deliveries as actionable so the wake-the-LLM path fires.
  | "message_arrived"
  // Mission-62 W1+W2 Pass 5 (M-Agent-Entity-Revisit): cache-coherence
  // notification for the Agent population. Fires on every activity FSM
  // transition (signal_working_started/completed, signal_quota_blocked/
  // recovered) and on field changes that affect routing. Adapters
  // maintain a local agent-population cache refreshed on these events
  // (W3 cache wiring). Classified as informational at Layer 1 — peer
  // routing is the primary consumer; the LLM is not woken on every
  // transition (broadcast volume).
  | "agent_state_changed";

/** Parsed, typed event envelope */
export interface HubEvent {
  event: HubEventType | string;
  data: Record<string, unknown>;
  timestamp?: string;
  id?: number | string;
}

/** Classification result */
export type EventDisposition = "actionable" | "informational" | "unhandled";

// ── Event Classification ─────────────────────────────────────────────

/** Engineer events that require the LLM to respond */
const ENGINEER_ACTIONABLE: ReadonlySet<string> = new Set([
  "thread_message",
  "clarification_answered",
  "task_issued",
  // Mission-24 Phase 2 (M24-T3): thread_converged merged into
  // thread_convergence_finalized.
  "thread_convergence_finalized",
  "revision_required",
  // Mission-56 W2.2: Hub-side push-on-Message-create. Layer-2
  // `@apnex/message-router` does kind/subkind-aware Message routing;
  // Layer-1 dispositioning treats every push as wake-the-LLM since
  // delivery="push-immediate" is itself the actionable signal.
  "message_arrived",
]);

/** Engineer events that are FYI (context injection, no response) */
const ENGINEER_INFORMATIONAL: ReadonlySet<string> = new Set([
  "review_completed",
  "proposal_decided",
  "mission_created",
  "mission_activated",
  "idea_submitted",
  "turn_created",
  "turn_updated",
  "tele_defined",
  // Mission-62 W1+W2 Pass 5: agent population cache-coherence updates.
  // Adapter maintains a local cache (W3 wiring); LLM wake suppressed.
  "agent_state_changed",
]);

/** Architect events that require a sandwich handler response */
const ARCHITECT_ACTIONABLE: ReadonlySet<string> = new Set([
  "report_submitted",
  "proposal_submitted",
  "clarification_requested",
  "thread_message",
  // Mission-24 Phase 2 (M24-T3): thread_converged merged into
  // thread_convergence_finalized.
  "thread_convergence_finalized",
  // Mission-56 W2.2: same dispositioning as engineer — push delivery
  // is itself the wake-the-LLM signal.
  "message_arrived",
]);

/** Architect events that are FYI */
const ARCHITECT_INFORMATIONAL: ReadonlySet<string> = new Set([
  "directive_acknowledged",
  "idea_submitted",
  "turn_created",
  "turn_updated",
  "tele_defined",
  "director_attention_required",
  "cascade_failure",
  // Mission-62 W1+W2 Pass 5: agent population cache-coherence updates.
  "agent_state_changed",
]);

/**
 * Classify an event for a given role.
 *
 * Returns "actionable" if the event requires the agent to respond,
 * "informational" if it's FYI only, or "unhandled" if the event
 * is not recognized for this role.
 */
export function classifyEvent(
  event: string,
  role: "engineer" | "architect" | "verifier"
): EventDisposition {
  if (role === "engineer") {
    if (ENGINEER_ACTIONABLE.has(event)) return "actionable";
    if (ENGINEER_INFORMATIONAL.has(event)) return "informational";
    return "unhandled";
  }
  // architect + verifier (mission-93): the verifier's directed-wake surface
  // ≈ the architect's (thread_message / review_requested / pulse / directed
  // notifications per verifier-role.md §2.1), so it shares the architect
  // classification set rather than mis-falling through an engineer path.
  if (ARCHITECT_ACTIONABLE.has(event)) return "actionable";
  if (ARCHITECT_INFORMATIONAL.has(event)) return "informational";
  return "unhandled";
}

// ── Pulse detection (M-OpenCode-Shim-Sovereign-Dedup, idea-331) ──────
//
// Hoisted to core from the two shims (claude-plugin/src/source-attribute.ts
// + the opencode shim's inlined mirror — its own comment admitted the dup).
// Sibling to classifyEvent: both shims call isPulseEvent to downgrade a
// pulse Message's notification level from "actionable" to "informational"
// (Mission-57 W3 / Design v1.0 §4 — S3 noise reduction during high-activity
// sub-PR cascades). `eventData` is OPTIONAL (Claude's signature) so the one
// core impl serves both shims behavior-preservingly.

/** Pulse-kind discriminators that route to informational level (Mission-57 W3). */
export const PULSE_KINDS: ReadonlySet<string> = new Set([
  "status_check",
  "missed_threshold_escalation",
]);

/**
 * Detect whether an event is a pulse Message (status_check or
 * missed_threshold_escalation): a `message_arrived` event whose
 * `data.message.payload.pulseKind` ∈ PULSE_KINDS.
 */
export function isPulseEvent(
  eventType: string,
  eventData?: Record<string, unknown>,
): boolean {
  if (eventType !== "message_arrived" || !eventData) return false;
  const message = eventData.message as { payload?: unknown } | undefined;
  const payload = message?.payload as { pulseKind?: unknown } | undefined;
  return typeof payload?.pulseKind === "string" && PULSE_KINDS.has(payload.pulseKind);
}

// ── bug-108 reconnect-drained reconstruction (M-Sovereign-Dedup, idea-331) ──
//
// Hoisted to core from both shims (claude-plugin surfacePendingActionItem +
// the opencode shim's onPendingActionItem). RECONSTRUCTION ONLY — the WAKE
// stays host-specific (claude → pushChannelNotification; opencode → the
// QueuedNotification queue/processNotification). A drained pending action is a
// notification that arrived while the wire was down; its `payload` IS the
// original dispatchPayload (hub thread-policy.ts enqueues `payload:
// dispatchPayload`), so {event: dispatchType, data: payload} reconstructs the
// live SSE AgentEvent. The returned `agentEvent` is a plain {event,data} —
// structurally an AgentEvent (optional fields omitted) — so this stays a
// type-only dependency on DrainedPendingAction and avoids a value-level
// event-router↔agent-client circular import.

export interface DrainedActionReconstruction {
  /** {event,data} — structurally an AgentEvent for the host wake to consume. */
  agentEvent: { event: string; data: Record<string, unknown> };
  /** Diagnostic-log action hint (identical across both shims). */
  actionHint: string;
  /** Notification level — pulse Messages downgrade to informational. */
  level: "actionable" | "informational";
}

export function reconstructDrainedAction(item: DrainedPendingAction): DrainedActionReconstruction {
  const agentEvent = { event: item.dispatchType, data: item.payload };
  const actionHint =
    item.dispatchType === "thread_message"
      ? `Reply with create_thread_reply to thread ${item.entityRef}`
      : `Owed: ${item.dispatchType} on ${item.entityRef}`;
  const level: "actionable" | "informational" = isPulseEvent(agentEvent.event, agentEvent.data)
    ? "informational"
    : "actionable";
  return { agentEvent, actionHint, level };
}

// ── Event Parsing ────────────────────────────────────────────────────

/**
 * Parse raw eventData from the ConnectionManager into a typed HubEvent.
 */
export function parseHubEvent(
  eventData: Record<string, unknown>
): HubEvent {
  return {
    event: (eventData.event as string) || "unknown",
    data: (eventData.data as Record<string, unknown>) || {},
    timestamp: eventData.timestamp as string | undefined,
    id: eventData.id as number | string | undefined,
  };
}

// ── Dedup Filter ─────────────────────────────────────────────────────

/**
 * Creates a dedup filter that tracks processed events by content hash.
 * Prevents duplicate processing from notification replay or concurrent streams.
 *
 * The hash is computed from event type + entity ID + timestamp.
 * Cache is LRU-style with a configurable max size.
 */
export function createDedupFilter(maxCache: number = 100) {
  const processed = new Set<string>();

  function computeHash(event: HubEvent): string {
    const entity =
      (event.data.taskId as string) ||
      (event.data.proposalId as string) ||
      (event.data.threadId as string) ||
      "unknown";
    // Prefer the application-level timestamp from the event data
    // (which represents the logical event identity) over the
    // delivery-level timestamp set by the Hub on each send.
    const ts =
      (event.data.timestamp as string) ||
      event.timestamp ||
      "";
    return `${event.event}:${entity}:${ts}`;
  }

  return {
    /**
     * Returns true if this event has already been processed.
     * If not a duplicate, marks it as processed.
     */
    isDuplicate(event: HubEvent): boolean {
      const hash = computeHash(event);
      if (processed.has(hash)) return true;

      processed.add(hash);

      // Evict oldest entries if cache exceeds max
      if (processed.size > maxCache) {
        const first = processed.values().next().value;
        if (first) processed.delete(first);
      }

      return false;
    },

    /** Clear the dedup cache */
    clear(): void {
      processed.clear();
    },

    /** Current cache size */
    get size(): number {
      return processed.size;
    },
  };
}
