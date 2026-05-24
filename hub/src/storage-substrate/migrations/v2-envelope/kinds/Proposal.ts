/**
 * mission-88 W1 cluster-1 — Proposal KindMigrationModule.
 *
 * Per cluster-1 Design v0.3 §3.5 (post thread-643 ratification). Substrate-truth
 * partition rules (Q2 drift-table resolution):
 *   - Drops (don't exist in substrate): body, linkedIdeaId, linkedMissionId,
 *     reviewCount (W4.x.7 dropped body-storage; proposalRef is vestigial pointer)
 *   - sourceThreadSummary → metadata.annotations["ois.io/sourceThreadSummary"]
 *   - status (FSM) → status.phase (substrate-truth: submitted/approved/rejected/
 *     changes_requested/implemented; entire Design v0.2 4-state set replaced)
 *   - summary → spec (declared content at submission; substrate has only summary,
 *     not body)
 *   - proposalRef → metadata (vestigial provenance; W4.x.7 left it for backward-
 *     compat surface)
 *   - executionPlan → spec (declared intent; may mutate via reviewProposal)
 *   - decision + feedback + scaffoldResult → status (observed/runtime)
 *   - labels (Proposal already has labels:Record<string,string>; no tags-array
 *     transformation needed)
 *
 * Idempotency: isEnvelopeShape probe at entry.
 */

import type { KindMigrationModule, MigrationSchemaRef } from "./_contract.js";
import type { SchemaDef } from "../../../types.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";

const KIND = "Proposal";

export function createProposalMigrationModule(schema: SchemaDef): KindMigrationModule {
  const schemaRef: MigrationSchemaRef = {
    schema,
    renameMap: {
      status: "status.phase",
    },
    partition: {
      metadata: [
        "createdAt",
        "createdBy",
        "sourceThreadId",
        "sourceActionId",
        "correlationId",
        "proposalRef",
        "labels",
        "annotations",
        "updatedAt",
      ],
      spec: ["title", "summary", "executionPlan"],
      status: ["decision", "feedback", "scaffoldResult"],
    },
  };

  return {
    kind: KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;
      if (typeof legacy !== "object" || legacy === null) {
        throw new Error(`[Proposal.migrateOne] input must be object, got ${typeof legacy}`);
      }
      const transformed = preTransform(legacy as Record<string, unknown>);
      return encodeEnvelope(transformed, schemaRef);
    },
  };
}

function preTransform(legacy: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...legacy };

  if (typeof out.sourceThreadSummary === "string" && out.sourceThreadSummary.length > 0) {
    out.annotations = { "ois.io/sourceThreadSummary": out.sourceThreadSummary };
  }
  delete out.sourceThreadSummary;

  return out;
}
