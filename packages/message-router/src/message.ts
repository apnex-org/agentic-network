/**
 * Layer-2 Message envelope — the routable unit consumed by `MessageRouter`.
 *
 * The `kind` discriminator partitions messages across the five v1.0
 * dispatch buckets defined in the Universal Adapter notification
 * contract spec (`docs/specs/universal-adapter-notification-contract.md`)
 * plus the mission-52 `repo-event` bridge.
 *
 * Subkind discrimination (e.g., `event.event` for AgentEvent payloads)
 * remains forward-compat extension scope (W3+); v1.0 routing is
 * kind-only per Design v1.2 §"Architectural commitments #4".
 */

import type {
  AgentEvent,
  DrainedPendingAction,
  SessionState,
  SessionReconnectReason,
} from "@apnex/network-adapter";

export type MessageKind =
  | "notification.actionable"
  | "notification.informational"
  | "state.change"
  | "pending-action.dispatch"
  | "repo-event";

export interface ActionableMessage {
  kind: "notification.actionable";
  event: AgentEvent;
}

export interface InformationalMessage {
  kind: "notification.informational";
  event: AgentEvent;
}

export interface StateChangeMessage {
  kind: "state.change";
  state: SessionState;
  previous: SessionState;
  reason?: SessionReconnectReason;
}

export interface PendingActionMessage {
  kind: "pending-action.dispatch";
  item: DrainedPendingAction;
}

/**
 * Mission-52 `@apnex/repo-event-bridge` translator output. Routed onto
 * the actionable wake-the-LLM path — the bridge already classifies
 * subkinds (`pr-merged`, `pr-review-approved`, etc.); host shims map
 * those onto host-specific source-attribute taxonomies (W2.3 / future).
 */
export interface RepoEventMessage {
  kind: "repo-event";
  event: AgentEvent;
}

export type Message =
  | ActionableMessage
  | InformationalMessage
  | StateChangeMessage
  | PendingActionMessage
  | RepoEventMessage;
