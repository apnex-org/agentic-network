/**
 * mission-88 W5 cluster-5 — ThreadHistoryEntry KindMigrationModule.
 *
 * Per cluster-5 Design v0.3 §2.5 (substrate-currency-ratified at thread-647 R2;
 * ZERO drift; production-substrate-verified — 50 th-N entries; FK to Thread).
 * Substrate-truth partition rules:
 *   - id (th-N; counter-allocated) preserved
 *   - timestamp → metadata.createdAt (uniformity rename)
 *   - threadId → metadata.threadId (FK forensic-pointer to source Thread; NOT
 *     cascade-spawn provenance — Q9 framing distinction)
 *   - title (frozen at archive moment) + outcome → spec (declared content)
 *   - status.phase: "logged" constant
 *   - NO updatedAt (append-only)
 *   - name OMITTED
 *
 * Note: ThreadHistoryEntry.threadId does NOT contribute to bug-118 IN-clause
 * coverage — it's "this entry IS about that thread" forensic-pointer, NOT
 * "this entry was cascade-spawned from that thread" sourceThreadId provenance.
 * bug-118 IN-clause stays at 8 kinds across all 5 cluster waves.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "ThreadHistoryEntry";

export function createThreadHistoryEntryMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      timestamp: "metadata.createdAt",
    },
    partition: {
      metadata: ["threadId"],
      spec: ["title", "outcome"],
      status: [],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[ThreadHistoryEntry.migrateOne] input must be object, got ${typeof legacy}`);
      }
      const transformed = preTransform(legacy as Record<string, unknown>);
      return encodeEnvelope(transformed, schemaRef);
    },
  };
}

function preTransform(legacy: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...legacy };
  out["status.phase"] = "logged";
  return out;
}
