/**
 * work-590 / bug-398 — AgentSessionBinding KindMigrationModule.
 *
 * Session→agent pointer row keyed by the SESSION ID, so identity resolution is
 * an UNGATED `substrate.get` rather than a GATED `list()` (work-587: the
 * list-admission gate is global and strict FIFO, so a two-row identity lookup
 * could queue behind an unrelated 500-row scan and be refused — which is how a
 * seat silently degrades to `anonymous-<role>`).
 *
 * Substrate-truth partition rules (mirrors the RepoEventBridgeCursor shape —
 * a small bookkeeping pointer kind, not an FSM entity):
 *   - id = the sessionId (natural key; the whole point of the kind)
 *   - agentId → status.agentId (renameMap)
 *   - spec: {} (no declared-intent fields)
 *   - status.phase: "active" constant (uniformity; bookkeeping kind, no FSM)
 *   - watchable: false
 *   - name OMITTED (bookkeeping pointer; not handle-classified)
 *
 * NO legacy rows exist for this kind — it is introduced by work-590, so
 * `migrateOne` only ever sees rows this code wrote. The envelope module is
 * still REQUIRED: without a registered module the write-encoder stores rows
 * FLAT and translated reads silently miss (new-kind checklist step 2).
 *
 * Idempotency: isEnvelopeShape probe at entry.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "AgentSessionBinding";

export function createAgentSessionBindingMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      agentId: "status.agentId",
    },
    partition: {
      metadata: [],
      spec: [],
      status: [],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[AgentSessionBinding.migrateOne] input must be object, got ${typeof legacy}`);
      }
      const transformed = preTransform(legacy as Record<string, unknown>);
      return encodeEnvelope(transformed, schemaRef);
    },
  };
}

function preTransform(legacy: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...legacy };
  // status.phase: "active" constant via dotted-path injection
  out["status.phase"] = "active";
  return out;
}
