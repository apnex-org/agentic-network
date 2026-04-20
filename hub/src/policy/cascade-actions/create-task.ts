/**
 * Cascade ActionSpec: create_task.
 *
 * Spawns a Task with cascade back-link metadata. Idempotent via the
 * {sourceThreadId, sourceActionId} natural key — re-execution returns
 * the prior-spawned Task's id and runner reports skipped_idempotent.
 *
 * Payload: { title, description, correlationId? }
 */

import { registerActionSpec } from "../cascade-spec.js";
import { CreateTaskActionPayloadSchema } from "../staged-action-payloads.js";
import { dispatchTaskSpawned } from "../dispatch-helpers.js";
import type { Task, EntityProvenance } from "../../state.js";

registerActionSpec({
  type: "create_task",
  kind: "spawn",
  payloadSchema: CreateTaskActionPayloadSchema,
  auditAction: "thread_create_task",
  findByCascadeKey: (ctx, key) => ctx.stores.task.findByCascadeKey(key),
  execute: async (ctx, payload, action, thread, backlink): Promise<Task | null> => {
    const p = payload as { title: string; description: string; correlationId?: string };
    const createdBy: EntityProvenance = {
      role: action.proposer.role,
      agentId: action.proposer.agentId ?? `anonymous-${action.proposer.role}`,
    };
    const taskId = await ctx.stores.task.submitDirective(
      p.description,
      p.correlationId ?? undefined,
      undefined,
      p.title,
      p.description,
      undefined,
      thread.labels,
      backlink,
      createdBy,
    );
    return (await ctx.stores.task.getTask(taskId)) ?? null;
  },
  auditDetails: (entity, action, thread, summary) => {
    const p = action.payload as { title: string };
    return `Task ${(entity as Task | null)?.id} spawned from thread ${thread.id}/${action.id}. Title: ${p.title}. Summary: ${summary}.`;
  },
  dispatch: (ctx, entity, thread) => dispatchTaskSpawned(ctx, entity as Task, thread.labels),
});
