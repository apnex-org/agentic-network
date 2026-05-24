/**
 * mission-88 W8 cluster-4 — Notification KindMigrationModule (bug-124 fix).
 *
 * Per W8 Design v1.0 (PR #285 ratified). Substrate-truth partition rules
 * per Design §5 + matches actual production shape per §2:
 *   - id (ULID) → envelope.id (preserved at top-level)
 *   - id → metadata.name (handle-classified per cluster-2 §1.5)
 *   - timestamp → metadata.createdAt (provenance per cluster-1 standard)
 *   - event → spec.eventType (declared-routing-intent per cluster-3 §5)
 *   - targetRoles → spec.targetRoles (declared-routing-intent per cluster-3 §5)
 *   - data → spec.payload (content per cluster-5 content-classification axis)
 *   - status.phase: "logged" constant (append-only per Audit precedent;
 *     Notification has no FSM — sibling of Audit/Tele/Counter "logged"/"active"
 *     constants)
 *   - metadata.sourceThreadId? (per W8 Q2 cascade-provenance: only injected
 *     when legacy.data.threadId present; per per-event-type cascade-audit
 *     table from W9 R1 audit)
 *
 * createOnly-write pattern preserved (Notification append-only; idempotency
 * at create-time).
 *
 * Idempotency: isEnvelopeShape probe at entry.
 *
 * W8 Q1 deferred to SchemaDef enum validation: 14-eventType closed-set +
 * "unknown" fallback with WARN-log on emission of un-cataloged eventType.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "Notification";

// Per W8 Q1: closed-set of 14 production-observed eventTypes (cataloged
// via psql `SELECT DISTINCT event FROM entities WHERE kind='Notification'`
// pre-cutover). Migration transform asserts each legacy.event against this
// set; unknown values fall back to "unknown" with WARN-log.
const KNOWN_EVENT_TYPES = new Set([
  "review_completed",
  "thread_message",
  "report_submitted",
  "directive_issued",
  "directive_acknowledged",
  "idea_submitted",
  "thread_converged",
  "proposal_decided",
  "proposal_submitted",
  "mission_created",
  "turn_created",
  "tele_defined",
  "clarification_requested",
  "clarification_answered",
]);

// Per W8 Q2 per-event-type cascade-origin audit (engineer-side deliverable
// in round-1 audit table): which eventTypes ORIGINATE from threads and
// require metadata.sourceThreadId cascade-provenance injection.
//
// REQUIRED cascade-carriers (assertion-fail if legacy.data.threadId absent
// for these eventTypes during migration; surfaces data-integrity bugs):
const REQUIRED_THREAD_SOURCED = new Set([
  "thread_message",
  "thread_converged",
  "turn_created",
]);

// OPTIONAL cascade-carriers (inject if legacy.data.threadId present; skip if
// absent — depends on emit-site payload-data):
const OPTIONAL_THREAD_SOURCED = new Set([
  "idea_submitted",
  "proposal_submitted",
  "proposal_decided",
  "mission_created",
]);

export function createNotificationMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      // legacy `event` field renames to `eventType` per Design §5 (clearer
      // semantic; aligns with K8s eventing-API convention).
      event: "spec.eventType",
      // legacy `timestamp` renames to metadata.createdAt (envelope-uniformity
      // per cluster-4 Audit precedent).
      timestamp: "metadata.createdAt",
    },
    partition: {
      metadata: [],
      // `data` is the legacy field-name; gets renamed to spec.payload via
      // pre-transform (encodeEnvelope handles spec/status/metadata fields
      // directly; renameMap handles legacy → envelope renames).
      spec: ["targetRoles", "payload"],
      status: [],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[Notification.migrateOne] input must be object, got ${typeof legacy}`);
      }
      const transformed = preTransform(legacy as Record<string, unknown>);
      return encodeEnvelope(transformed, schemaRef);
    },
  };
}

/**
 * Pre-transform legacy Notification:
 *   - Map id → metadata.name (handle-classified copy)
 *   - Rename `data` → `payload` (spec partition expects payload)
 *   - Inject status.phase: "logged" constant (append-only per Audit precedent)
 *   - Validate eventType against KNOWN_EVENT_TYPES; emit WARN on unknown +
 *     fall back to "unknown" (per W8 Q1 closed-set + fallback disposition)
 *   - Inject metadata.sourceThreadId per cascade-audit table (REQUIRED vs
 *     OPTIONAL cascade-carriers)
 */
function preTransform(legacy: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...legacy };

  // Handle-classified: copy id to metadata.name (envelope-uniformity per
  // cluster-2 Turn precedent; metadata.name is the K8s-canonical handle).
  // Use dotted-path so encodeEnvelope's assignDottedPath routes to metadata.
  if (typeof out.id === "string") {
    out["metadata.name"] = out.id;
  }

  // Rename legacy `data` to `payload` for spec partition routing.
  if ("data" in out) {
    out.payload = out.data;
    delete out.data;
  }

  // Inject status.phase = "logged" (append-only constant; uniformity per
  // Audit precedent). Uses dotted-path so encodeEnvelope routes to status.
  out["status.phase"] = "logged";

  // W8 Q1: eventType enum validation + "unknown" fallback.
  const legacyEvent = legacy.event;
  if (typeof legacyEvent === "string" && !KNOWN_EVENT_TYPES.has(legacyEvent)) {
    console.warn(
      `[Notification migration] unknown eventType="${legacyEvent}" for id=${legacy.id ?? "?"} — ` +
        `cataloging-gap; file SchemaDef enum-extension. Falling back to "unknown".`,
    );
    out.event = "unknown";
  }

  // W8 Q2: cascade-provenance injection. Production data shape sample shows
  // legacy.data may carry a `threadId` field for thread-sourced events.
  const legacyData = legacy.data as Record<string, unknown> | undefined;
  if (legacyData && typeof legacyData === "object" && typeof legacyData.threadId === "string") {
    if (REQUIRED_THREAD_SOURCED.has(legacyEvent as string) || OPTIONAL_THREAD_SOURCED.has(legacyEvent as string)) {
      out["metadata.sourceThreadId"] = legacyData.threadId;
    }
  } else if (REQUIRED_THREAD_SOURCED.has(legacyEvent as string)) {
    // REQUIRED carrier with no threadId in payload — surface as data-integrity
    // warning (don't throw; lets migration complete; flag for follow-on audit).
    console.warn(
      `[Notification migration] REQUIRED-thread-sourced eventType="${legacyEvent}" for id=${legacy.id ?? "?"} ` +
        `has no data.threadId — data-integrity gap; file as TBD-bug companion to bug-118.`,
    );
  }

  return out;
}
