/**
 * Canonical Agent wire projection — mission-63 M-Wire-Entity-Convergence
 * (Design v1.0 §2.1, ADR-028).
 *
 * `projectAgent` is the single point-of-truth that converts an internal
 * `Agent` entity to the canonical wire shape `AgentProjection`. All
 * Agent-state-bearing wire surfaces (register_role + claim_session
 * responses; get_agents return; agent_state_changed SSE event) go through
 * this helper so renames + field-additions propagate by construction.
 *
 * Internal/operational fields stay OFF the wire (Design §2.3): fingerprint,
 * currentSessionId, lastSeenAt, lastHeartbeatAt, firstSeenAt, archived,
 * recentErrors, restartCount, restartHistoryMs, sessionStartedAt,
 * lastToolCallAt, lastToolCallName, idleSince, workingSince,
 * quotaBlockedUntil, wakeEndpoint, receiptSla, adapterVersion, ipAddress.
 * Selective surfacing of operational fields is idea-220 Phase 2 territory
 * (calibration #21).
 */

import type {
  Agent,
  AgentRole,
  AgentClientMetadata,
  AgentAdvisoryTags,
  AgentLivenessState,
  ActivityState as ActivityStateType,
  ClaimSessionTrigger,
} from "../state.js";

/**
 * Canonical wire-projection of an Agent. `clientMetadata` and `advisoryTags`
 * are optional — legacy Agent records may have them missing or null
 * (Design §2.1 round-1 audit ask 7; new handshakes overwrite via register_role).
 */
export interface AgentProjection {
  id: string;
  name: string;
  role: AgentRole;
  livenessState: AgentLivenessState;
  activityState: ActivityStateType;
  labels: Record<string, string>;
  clientMetadata?: AgentClientMetadata;
  advisoryTags?: AgentAdvisoryTags;
}

/**
 * Session-binding state for handshake-bearing responses (register_role,
 * claim_session). Per Design §2.2, get_agents (pull-primitive) does NOT
 * include session-binding state per agent; it surfaces only via the
 * handshake-response envelopes that bound a specific session.
 */
export interface SessionBindingState {
  epoch: number;
  claimed: boolean;
  trigger?: ClaimSessionTrigger;
  displacedPriorSession?: { sessionId: string; epoch: number };
}

/**
 * Project an internal Agent record to the canonical wire shape. Internal
 * fields are dropped per Design §2.3 internal-fields-OFF-wire allowlist.
 *
 * `clientMetadata` and `advisoryTags` are emitted as absent (omitted from
 * JSON) when the underlying record has them missing or null. The W3
 * migration script (`scripts/migrate-canonical-envelope-state.ts`) defaults
 * missing fields to `{}` for legacy records; until that runs, projection
 * is defensive.
 */
export function projectAgent(agent: Agent): AgentProjection {
  const proj: AgentProjection = {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    livenessState: agent.livenessState,
    activityState: agent.activityState,
    labels: agent.labels ?? {},
  };
  if (agent.clientMetadata) {
    proj.clientMetadata = agent.clientMetadata;
  }
  if (agent.advisoryTags) {
    proj.advisoryTags = agent.advisoryTags;
  }
  return proj;
}
