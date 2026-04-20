/**
 * Cascade ActionSpec: create_proposal.
 *
 * Spawns a Proposal with cascade back-link metadata. Idempotent via
 * {sourceThreadId, sourceActionId}. Payload: { title, description,
 * correlationId? } — description serves as both summary and body
 * until the schema splits them.
 */

import { registerActionSpec } from "../cascade-spec.js";
import { CreateProposalActionPayloadSchema } from "../staged-action-payloads.js";
import { dispatchProposalSubmitted } from "../dispatch-helpers.js";
import type { Proposal, EntityProvenance } from "../../state.js";

registerActionSpec({
  type: "create_proposal",
  kind: "spawn",
  payloadSchema: CreateProposalActionPayloadSchema,
  auditAction: "thread_create_proposal",
  findByCascadeKey: (ctx, key) => ctx.stores.proposal.findByCascadeKey(key),
  execute: async (ctx, payload, action, thread, backlink): Promise<Proposal> => {
    const p = payload as { title: string; description: string; correlationId?: string };
    const createdBy: EntityProvenance = {
      role: action.proposer.role,
      agentId: action.proposer.agentId ?? `anonymous-${action.proposer.role}`,
    };
    return ctx.stores.proposal.submitProposal(
      p.title,
      p.description,
      p.description,
      p.correlationId ?? undefined,
      undefined,
      thread.labels,
      backlink,
      createdBy,
    );
  },
  auditDetails: (entity, action, thread, summary) => {
    const p = action.payload as { title: string };
    return `Proposal ${(entity as Proposal).id} spawned from thread ${thread.id}/${action.id}. Title: ${p.title}. Summary: ${summary}.`;
  },
  dispatch: (ctx, entity, thread) => dispatchProposalSubmitted(ctx, entity as Proposal, thread.labels, false),
});
