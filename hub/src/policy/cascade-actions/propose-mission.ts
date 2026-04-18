/**
 * Cascade handler: propose_mission (M24-T9, ADR-014).
 *
 * Spawns a Mission in `proposed` status. Distinct from the Director-
 * gated `create_mission` which bypasses the proposal stage; per
 * ADR-014 §21, autonomous actions cannot widen authorization scope —
 * proposing a mission still requires Director activation to become
 * `active`, preserving the scope boundary.
 *
 * Payload shape: { title, description, goals }
 *   - `goals` is serialised into the Mission's `description` field as
 *     a Markdown-formatted list. Mission schema doesn't yet carry a
 *     first-class `goals: string[]` field; when it does, handler
 *     flips to pass goals through separately (no behaviour change for
 *     consumers of createdMission.description).
 */

import { registerCascadeHandler, cascadeIdempotencyKey } from "../cascade.js";
import { dispatchMissionCreated } from "../dispatch-helpers.js";

registerCascadeHandler("propose_mission", async ({ ctx, thread, action, sourceThreadSummary }) => {
  if (action.type !== "propose_mission") {
    return { status: "failed", error: `expected propose_mission, got ${action.type}` };
  }
  const payload = action.payload;
  const key = cascadeIdempotencyKey(thread, action);

  const existing = await ctx.stores.mission.findByCascadeKey(key);
  if (existing) {
    await ctx.stores.audit.logEntry(
      "hub",
      "action_already_executed",
      `Cascade propose_mission skipped for ${thread.id}/${action.id}: mission ${existing.id} already spawned from this pair.`,
      thread.id,
    );
    return { status: "skipped_idempotent", entityId: existing.id };
  }

  const goalsBlock = payload.goals.length > 0
    ? `\n\nGoals:\n${payload.goals.map((g) => `- ${g}`).join("\n")}`
    : "";
  const composed = `${payload.description}${goalsBlock}`;

  const mission = await ctx.stores.mission.createMission(
    payload.title,
    composed,
    undefined, // documentRef
    { sourceThreadId: key.sourceThreadId, sourceActionId: key.sourceActionId, sourceThreadSummary },
  );

  await ctx.stores.audit.logEntry(
    "hub",
    "thread_propose_mission",
    `Mission ${mission.id} proposed from thread ${thread.id}/${action.id}. Title: ${payload.title}. Goals: ${payload.goals.length}. Summary: ${sourceThreadSummary}.`,
    mission.id,
  );

  // Same mission_created event the direct tool fires. The mission
  // lands in `proposed` status — Director still activates separately
  // (scope-of-commitment boundary per ADR-014 §21).
  await dispatchMissionCreated(ctx, mission);

  return { status: "executed", entityId: mission.id };
});
