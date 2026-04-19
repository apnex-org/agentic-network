/**
 * Cascade ActionSpec: create_bug (M-Cascade-Perfection Phase 2, ADR-015).
 *
 * The validation case for the Phase 1 ActionSpec registry: adding a
 * new cascade action type = one ActionSpec object + one import line
 * in cascade-actions/index.ts. No runner changes, no dispatch-helper
 * boilerplate beyond what the spec declares.
 *
 * Spawns a Bug with cascade back-link metadata. Idempotent via
 * {sourceThreadId, sourceActionId}. Payload: { title, description,
 * severity?, class?, tags?, surfacedBy? }.
 */

import { registerActionSpec } from "../cascade-spec.js";
import { CreateBugActionPayloadSchema } from "../staged-action-payloads.js";
import { dispatchBugReported } from "../dispatch-helpers.js";
import type { Bug, BugSeverity } from "../../entities/bug.js";

registerActionSpec({
  type: "create_bug",
  kind: "spawn",
  payloadSchema: CreateBugActionPayloadSchema,
  auditAction: "thread_create_bug",
  findByCascadeKey: (ctx, key) => ctx.stores.bug.findByCascadeKey(key),
  execute: async (ctx, payload, _action, _thread, backlink): Promise<Bug> => {
    const p = payload as {
      title: string;
      description: string;
      severity?: BugSeverity;
      class?: string;
      tags?: string[];
      surfacedBy?: string;
    };
    return ctx.stores.bug.createBug(
      p.title,
      p.description,
      p.severity ?? "minor",
      {
        classHint: p.class,
        tags: p.tags,
        surfacedBy: p.surfacedBy,
        backlink,
      },
    );
  },
  auditDetails: (entity, action, thread, summary) => {
    const bug = entity as Bug;
    const p = action.payload as { title: string; severity?: BugSeverity; class?: string };
    return `Bug ${bug.id} reported from thread ${thread.id}/${action.id}. Title: ${p.title}. Severity: ${bug.severity}. Class: ${p.class ?? "(unclassified)"}. Summary: ${summary}.`;
  },
  dispatch: (ctx, entity, _thread) => dispatchBugReported(ctx, entity as Bug),
});
