/**
 * Cascade handler: create_proposal (M24-T5, ADR-014).
 *
 * Spawns a Proposal with cascade back-link metadata. Idempotent via
 * the {sourceThreadId, sourceActionId} natural key.
 *
 * Payload shape: { title, description, correlationId? }
 *   - Proposal store splits `title` / `summary` / `body`. We use the
 *     payload's `description` as both the summary (listing UI) and
 *     the body (full text); if future needs diverge, split the payload
 *     into {summary, body} in a schema amendment.
 */

import { registerCascadeHandler, cascadeIdempotencyKey } from "../cascade.js";
import { dispatchProposalSubmitted } from "../dispatch-helpers.js";

registerCascadeHandler("create_proposal", async ({ ctx, thread, action, sourceThreadSummary }) => {
  if (action.type !== "create_proposal") {
    return { status: "failed", error: `expected create_proposal, got ${action.type}` };
  }
  const payload = action.payload;
  const key = cascadeIdempotencyKey(thread, action);

  const existing = await ctx.stores.proposal.findByCascadeKey(key);
  if (existing) {
    await ctx.stores.audit.logEntry(
      "hub",
      "action_already_executed",
      `Cascade create_proposal skipped for ${thread.id}/${action.id}: proposal ${existing.id} already spawned from this pair.`,
      thread.id,
    );
    return { status: "skipped_idempotent", entityId: existing.id };
  }

  const proposal = await ctx.stores.proposal.submitProposal(
    payload.title,
    payload.description, // summary
    payload.description, // body
    payload.correlationId ?? undefined,
    undefined, // executionPlan
    thread.labels,
    { sourceThreadId: key.sourceThreadId, sourceActionId: key.sourceActionId, sourceThreadSummary },
  );

  await ctx.stores.audit.logEntry(
    "hub",
    "thread_create_proposal",
    `Proposal ${proposal.id} spawned from thread ${thread.id}/${action.id}. Title: ${payload.title}. Summary: ${sourceThreadSummary}.`,
    proposal.id,
  );

  // Same proposal_submitted event the direct tool fires — architects
  // in matching label scope get the push, not just the audit trail.
  await dispatchProposalSubmitted(ctx, proposal, thread.labels, false);

  return { status: "executed", entityId: proposal.id };
});
