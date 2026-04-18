/**
 * Cascade handler: create_idea (M24-T5, ADR-014).
 *
 * Spawns an Idea with cascade back-link metadata. Idempotent via the
 * {sourceThreadId, sourceActionId} natural key.
 *
 * Payload shape: { title, description, tags? }
 *   - Idea store takes `text` + `author` + optional tags. We compose
 *     `text` from `<title>\n\n<description>` so the idea lists well in
 *     list_ideas without losing the short title as a separate field.
 */

import { registerCascadeHandler, cascadeIdempotencyKey } from "../cascade.js";

registerCascadeHandler("create_idea", async ({ ctx, thread, action, sourceThreadSummary }) => {
  if (action.type !== "create_idea") {
    return { status: "failed", error: `expected create_idea, got ${action.type}` };
  }
  const payload = action.payload;
  const key = cascadeIdempotencyKey(thread, action);

  const existing = await ctx.stores.idea.findByCascadeKey(key);
  if (existing) {
    await ctx.stores.audit.logEntry(
      "hub",
      "action_already_executed",
      `Cascade create_idea skipped for ${thread.id}/${action.id}: idea ${existing.id} already spawned from this pair.`,
      thread.id,
    );
    return { status: "skipped_idempotent", entityId: existing.id };
  }

  const text = `${payload.title}\n\n${payload.description}`;
  // Attribute the idea to the proposer agent where available so
  // list_ideas "author" filters resolve to a real agent rather than
  // a generic "hub" actor.
  const author = action.proposer.agentId ?? action.proposer.role;
  const idea = await ctx.stores.idea.submitIdea(
    text,
    author,
    thread.id,
    payload.tags,
    { sourceThreadId: key.sourceThreadId, sourceActionId: key.sourceActionId, sourceThreadSummary },
  );

  await ctx.stores.audit.logEntry(
    "hub",
    "thread_create_idea",
    `Idea ${idea.id} spawned from thread ${thread.id}/${action.id}. Title: ${payload.title}. Summary: ${sourceThreadSummary}.`,
    idea.id,
  );

  return { status: "executed", entityId: idea.id };
});
