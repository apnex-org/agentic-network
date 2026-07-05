/**
 * mission-88 W3 cluster-3 — Agent KindMigrationModule.
 *
 * Per cluster-3 Design v0.3 §2.1 (substrate-currency-ratified at thread-645 R2;
 * ZERO drift). Substrate-truth partition rules:
 *   - status (online/offline; primary FSM) → status.phase (1:1 rename per K8s convention)
 *   - Per-FSM-as-top-level-status-fields per §1.6 multi-FSM discipline + Q3 ratified:
 *     status.{phase, livenessState, activityState, cognitiveState, transportState}
 *     5 distinct status fields = primary registration FSM + ADR-017 liveness composite
 *     + Mission-62 activity + Mission-75 component-TTL pair. K8s Pod.status precedent
 *     (phase + conditions[] as siblings; not nested).
 *   - name → metadata.name (handle-classified per §1.5; Agent.name IS identity)
 *   - fingerprint → metadata (identity-derived; immutable)
 *   - archived → metadata (K8s metadata.deletionTimestamp analog; identity-disposition)
 *   - role → spec (declared identity; immutable post-creation)
 *   - labels → spec.labels (Mission-19 routing labels; PodSpec scheduling-affinity
 *     precedent; routing-intent NOT content-classification per §5 6th cumulative-pattern)
 *   - receiptSla/wakeEndpoint/livenessConfig/pulseConfig/clientMetadata → spec
 *     (declared-with-controlled-mutation per CP3 C5 handshake refresh)
 *   - firstSeenAt → metadata.createdAt (envelope-uniformity rename)
 *   - lastSeenAt → metadata.updatedAt (envelope-uniformity rename)
 *   - sessionEpoch / currentSessionId / lastHeartbeatAt / sessionStartedAt /
 *     lastToolCallAt / lastToolCallName / idleSince / workingSince /
 *     quotaBlockedUntil / cognitiveTTL / transportTTL / adapterVersion /
 *     ipAddress / advisoryTags / restartCount / recentErrors /
 *     restartHistoryMs → status (FSM/observed/telemetry)
 *
 * Idempotency: isEnvelopeShape probe at entry.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "Agent";

export function createAgentMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
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
        // C1-R2 (mission-94): WorkItem claim-thrash quarantine (status bucket). MUST
        // stay byte-for-byte with agent-envelope-shape.ts AGENT_SCHEMA_REF.
        "thrashCount",
        "quarantined",
      ],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[Agent.migrateOne] input must be object, got ${typeof legacy}`);
      }
      return encodeEnvelope(legacy, schemaRef);
    },
  };
}
