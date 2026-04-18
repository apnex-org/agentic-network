/**
 * Cascade handler: create_task (M24-T5, ADR-014).
 *
 * Spawns a Task with cascade back-link metadata. Idempotent via the
 * {sourceThreadId, sourceActionId} natural key — re-execution returns
 * skipped_idempotent referencing the prior-spawned task's ID.
 *
 * Payload shape: { title, description, correlationId? }
 *   - `directive` on the Task is filled from `description` (the LLM's
 *     verbose spec) so engineers see the full intent in get_task;
 *     `title` and `description` are also persisted as separate fields
 *     so list_tasks UIs can render a short header.
 */

import { registerCascadeHandler, cascadeIdempotencyKey } from "../cascade.js";

registerCascadeHandler("create_task", async ({ ctx, thread, action, sourceThreadSummary }) => {
  if (action.type !== "create_task") {
    return { status: "failed", error: `expected create_task, got ${action.type}` };
  }
  const payload = action.payload;
  const key = cascadeIdempotencyKey(thread, action);

  // INV-TH20: idempotency pre-check. If a Task already exists for this
  // thread+action pair, return the prior ID instead of double-spawning.
  const existing = await ctx.stores.task.findByCascadeKey(key);
  if (existing) {
    await ctx.stores.audit.logEntry(
      "hub",
      "action_already_executed",
      `Cascade create_task skipped for ${thread.id}/${action.id}: task ${existing.id} already spawned from this pair.`,
      thread.id,
    );
    return { status: "skipped_idempotent", entityId: existing.id };
  }

  // Spawn. `directive` carries the description so engineers get the
  // full brief on get_task; correlationId propagates through if set.
  const taskId = await ctx.stores.task.submitDirective(
    payload.description,
    payload.correlationId ?? undefined,
    undefined, // idempotencyKey — distinct from cascade natural key
    payload.title,
    payload.description,
    undefined, // dependsOn
    thread.labels,
    { sourceThreadId: key.sourceThreadId, sourceActionId: key.sourceActionId, sourceThreadSummary },
  );

  await ctx.stores.audit.logEntry(
    "hub",
    "thread_create_task",
    `Task ${taskId} spawned from thread ${thread.id}/${action.id}. Title: ${payload.title}. Summary: ${sourceThreadSummary}.`,
    taskId,
  );

  return { status: "executed", entityId: taskId };
});
