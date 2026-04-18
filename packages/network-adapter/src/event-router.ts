/**
 * Shared Event Router — Classification, dedup, and parsing for Hub SSE events.
 *
 * Extracts the common event handling logic that was duplicated between
 * the Engineer Plugin and the Architect Agent. Both consumers import
 * from this module and only implement their own dispatch mechanisms
 * (Push-to-LLM for the Plugin, Sandwich pattern for the Architect).
 */

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
  | "thread_converged"
  | "idea_submitted"
  | "mission_created"
  | "mission_activated"
  | "turn_created"
  | "turn_updated"
  | "tele_defined"
  | "director_attention_required"
  | "cascade_failure";

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
  "thread_converged",
  "revision_required",
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
]);

/** Architect events that require a sandwich handler response */
const ARCHITECT_ACTIONABLE: ReadonlySet<string> = new Set([
  "report_submitted",
  "proposal_submitted",
  "clarification_requested",
  "thread_message",
  "thread_converged",
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
  role: "engineer" | "architect"
): EventDisposition {
  if (role === "engineer") {
    if (ENGINEER_ACTIONABLE.has(event)) return "actionable";
    if (ENGINEER_INFORMATIONAL.has(event)) return "informational";
    return "unhandled";
  } else {
    if (ARCHITECT_ACTIONABLE.has(event)) return "actionable";
    if (ARCHITECT_INFORMATIONAL.has(event)) return "informational";
    return "unhandled";
  }
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
