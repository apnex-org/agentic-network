/**
 * mission-102 P3-B1 — Decision KindMigrationModule (the WRITE-side envelope
 * authority, peer to the all-schemas Decision SchemaDef renameMap which is the
 * READ-side filter-translate authority; the W1 sentinel-probe oracle asserts
 * the two agree).
 *
 * Partition: spec = the immutable raise-time contract (title/context/options/
 * contextRefs/raisedBy/parentRef/class/executionPlan — class is filterable via
 * spec.class); status = the FSM lifecycle (phase via the rename; transition-
 * stamped actors; route; resolution; exit fields; the per-state dwell timers).
 * No preTransform: no array→map or summary transforms; options/contextRefs stay
 * arrays in spec. No lease anywhere — the Decision has no liveness (design §1.1).
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "Decision";

export function createDecisionMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      status: "status.phase",
    },
    partition: {
      metadata: ["createdAt", "updatedAt"],
      // spec = declared at raise (immutable thereafter except class refinement at
      // curation, which rewrites the spec leaf under the same CAS as the transition).
      spec: ["schemaVersion", "parentRef", "class", "title", "context", "contextRefs", "options", "freeAnswerPolicy", "raisedBy", "executionPlan"],
      // status = lifecycle: transition-stamped actors + route + resolution + the
      // exit fields + the per-FSM-state wall-clock timers (the WorkItem pattern).
      status: ["curatedBy", "curationRecordRef", "routedTo", "routedBy", "resolution", "mergedInto", "disposedReason", "executorBinding", "enteredCurrentStateAt", "stateDurations"],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[Decision.migrateOne] input must be object, got ${typeof legacy}`);
      }
      return encodeEnvelope(legacy as Record<string, unknown>, schemaRef);
    },
  };
}
