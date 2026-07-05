/**
 * mission-89 (A3) — Agent envelope ↔ legacy-flat shape coercion.
 *
 * Closes bug-138-class envelope-blind defect AT THE AGENT-REPOSITORY-SUBSTRATE
 * BOUNDARY: substrate stores envelope-shape rows (per mission-88 W11 cutover);
 * legacy-flat Agent type is the in-memory shape for all AgentRepositorySubstrate
 * methods (assertIdentity / claimSession / mark* / listAgents / etc.).
 *
 * Read path (envelope-row → legacy-flat Agent):
 *   substrate.{get,getWithRevision,list} → envelopeToAgent(maybeEnvelope) → Agent
 *
 * Write path (legacy-flat Agent → envelope-row):
 *   substrate.{put,createOnly,putIfMatch} ← agentToEnvelope(agent)
 *
 * Filter path (legacy-flat field name → envelope JSONB path):
 *   substrate.list({filter: {"metadata.fingerprint": value}}) — dotted-path
 *   handled by postgres-substrate.list's jsonbField helper natively.
 *
 * Partition + renameMap MUST match mission-88 W11 cutover's
 * `migrations/v2-envelope/kinds/Agent.ts` schemaRef byte-for-byte; production
 * envelope-shape rows depend on this contract.
 *
 * bug-138 (substrate.list filter envelope-blind) STAYS FILED — Phase 4 absorbs
 * the systemic substrate.list shape-aware refactor. This module is the Agent-
 * specific tactical fix per architect (A3) ratify.
 *
 * Roundtrip invariant: envelopeToAgent(agentToEnvelope(agent)) ≅ agent (modulo
 * field-default normalization at normalizeAgentShape; verified by unit test).
 */

import type { Agent } from "../state.js";
import { encodeEnvelope, isEnvelopeShape, type EnvelopeShape } from "../storage-substrate/migrations/v2-envelope/shared/envelope.js";
import type { MigrationSchemaRef } from "../storage-substrate/migrations/v2-envelope/kinds/_contract.js";
import type { Filter, SchemaDef } from "../storage-substrate/types.js";
import { assertDecodedFlat } from "../storage-substrate/bare-envelope-error.js";

// Minimal SchemaDef stub — encodeEnvelope only uses schema.kind from this.
const AGENT_SCHEMA_STUB: SchemaDef = {
  kind: "Agent",
  version: 2,
  fields: [],
  indexes: [],
  watchable: true,
};

// MUST match mission-88 W11 cutover Agent.ts module byte-for-byte (production-
// substrate envelope-shape rows depend on this rename + partition contract).
const AGENT_SCHEMA_REF: MigrationSchemaRef = {
  schema: AGENT_SCHEMA_STUB,
  renameMap: {
    status: "status.phase",
    firstSeenAt: "metadata.createdAt",
    lastSeenAt: "metadata.updatedAt",
  },
  partition: {
    metadata: ["fingerprint", "archived"],
    spec: [
      "role",
      "labels",
      "receiptSla",
      "wakeEndpoint",
      "livenessConfig",
      "pulseConfig",
      "clientMetadata",
    ],
    status: [
      "sessionEpoch",
      "currentSessionId",
      "registeredSessions",
      "livenessState",
      "lastHeartbeatAt",
      "activityState",
      "sessionStartedAt",
      "lastToolCallAt",
      "lastToolCallName",
      "idleSince",
      "workingSince",
      "quotaBlockedUntil",
      "cognitiveTTL",
      "transportTTL",
      "cognitiveState",
      "transportState",
      "adapterVersion",
      "ipAddress",
      "advisoryTags",
      "restartCount",
      "recentErrors",
      "restartHistoryMs",
      // C1-R2 (mission-94): WorkItem claim-thrash quarantine. MUST stay byte-for-byte
      // with migrations/v2-envelope/kinds/Agent.ts partition.status.
      "thrashCount",
      "quarantined",
    ],
  },
};

/**
 * Encode a legacy-flat Agent into envelope shape per W11 partition contract.
 * Idempotent: if `agent` is already envelope-shape, returns as-is via
 * encodeEnvelope's idempotency guard.
 */
export function agentToEnvelope(agent: Agent): EnvelopeShape {
  return encodeEnvelope(agent, AGENT_SCHEMA_REF);
}

/**
 * Decode an envelope-shape Agent row into legacy-flat Agent. READ-PATH
 * graceful-degrade for BAD DATA (mission-90 W8 lens-2): a non-envelope row
 * returns as-is rather than crashing the read — a single stray malformed row
 * must never take down an agent list/get. All Agent writes go through
 * agentToEnvelope, so this passthrough is dead in practice post-cutover.
 *
 * SUPERSEDED for the SKIPPED/BROKEN-DECODE case (C3-R4b piece 2; cal-84 +
 * thread-689 — REFINES, not flips, the W8 framing): both returns now run the
 * production-armed 0-bare integrity assert (assertDecodedFlat, "Agent"). The
 * passthrough is the real escape-hatch — if a row that isEnvelopeShape rejected
 * is nonetheless a fully-intact envelope (apiVersion + spec + status.phase), that
 * inconsistency is a code defect and throws BareEnvelopeError. Inert unless armed
 * (tests/standalone) and never trips on a genuinely malformed row (narrow
 * signature → bad data still passes through).
 *
 * Reverses W11 partition: hoists `metadata.fingerprint`/`metadata.archived`
 * → top-level; `spec.{role,labels,...}` → top-level; `status.phase` → top-
 * level `status`; rest of `status.*` → top-level. Reverses renameMap:
 * `metadata.createdAt` → `firstSeenAt`, `metadata.updatedAt` → `lastSeenAt`.
 */
export function envelopeToAgent(maybeEnvelope: unknown): Agent {
  if (!isEnvelopeShape(maybeEnvelope)) {
    // Read-path graceful-degrade for bad data — pass through. C3-R4b piece 2:
    // armed-only 0-bare assert catches a full envelope that isEnvelopeShape missed.
    return assertDecodedFlat(maybeEnvelope as Agent, "Agent");
  }
  const env = maybeEnvelope;
  const meta = env.metadata;
  const spec = env.spec;
  const status = env.status;

  const out: Record<string, unknown> = {
    // Envelope top-level reserved fields
    id: env.id,
    name: env.name,

    // Reverse renameMap
    status: status.phase,                     // status.phase → top-level status (legacy FSM string)
    firstSeenAt: meta.createdAt,              // metadata.createdAt → firstSeenAt
    lastSeenAt: meta.updatedAt,               // metadata.updatedAt → lastSeenAt

    // Hoist metadata partition
    fingerprint: meta.fingerprint,
    archived: meta.archived,

    // Hoist spec partition
    role: spec.role,
    labels: spec.labels,
    receiptSla: spec.receiptSla,
    wakeEndpoint: spec.wakeEndpoint,
    livenessConfig: spec.livenessConfig,
    pulseConfig: spec.pulseConfig,
    clientMetadata: spec.clientMetadata,

    // Hoist status partition (except `phase` which became top-level status above)
    sessionEpoch: status.sessionEpoch,
    currentSessionId: status.currentSessionId,
    registeredSessions: status.registeredSessions,  // bug-230 (work-137): persisted register bindings
    livenessState: status.livenessState,
    lastHeartbeatAt: status.lastHeartbeatAt,
    activityState: status.activityState,
    sessionStartedAt: status.sessionStartedAt,
    lastToolCallAt: status.lastToolCallAt,
    lastToolCallName: status.lastToolCallName,
    idleSince: status.idleSince,
    workingSince: status.workingSince,
    quotaBlockedUntil: status.quotaBlockedUntil,
    cognitiveTTL: status.cognitiveTTL,
    transportTTL: status.transportTTL,
    cognitiveState: status.cognitiveState,
    transportState: status.transportState,
    adapterVersion: status.adapterVersion,
    ipAddress: status.ipAddress,
    advisoryTags: status.advisoryTags,
    restartCount: status.restartCount,
    recentErrors: status.recentErrors,
    restartHistoryMs: status.restartHistoryMs,
    // C1-R2 (mission-94): WorkItem claim-thrash quarantine (status bucket → flat).
    thrashCount: status.thrashCount,
    quarantined: status.quarantined,
  };
  return assertDecodedFlat(out as unknown as Agent, "Agent");
}

/**
 * Translate a legacy-flat Agent filter-key to the envelope JSONB sub-path.
 * Used to convert substrate.list filters before they hit the envelope-shape
 * substrate. Filter keys not in the rename table pass through unchanged
 * (e.g., `id` stays at envelope top-level).
 */
const AGENT_FILTER_PATH_RENAMES: Record<string, string> = {
  fingerprint: "metadata.fingerprint",
  archived: "metadata.archived",
  role: "spec.role",
  status: "status.phase",
};

export function agentFilterKeyToEnvelopePath(legacyKey: string): string {
  return AGENT_FILTER_PATH_RENAMES[legacyKey] ?? legacyKey;
}

/**
 * Translate a legacy-flat filter object → envelope-aware filter object.
 * Pass through to substrate.list — postgres-substrate's `jsonbField` helper
 * handles dotted-path keys natively (`"metadata.fingerprint"` →
 * `data#>>'{metadata,fingerprint}'`).
 */
export function agentFilterToEnvelope(filter: Filter | undefined): Filter | undefined {
  if (!filter) return undefined;
  const out: Filter = {};
  for (const [key, value] of Object.entries(filter)) {
    out[agentFilterKeyToEnvelopePath(key)] = value;
  }
  return out;
}
