/**
 * Cascade handler: update_mission_status (M24-T9, ADR-014).
 *
 * Status-only transitions per ADR-014 scope-of-commitment principle:
 * scope edits (description, goal amendments) widen authorization and
 * remain Director-gated. Autonomous cascade only flips the FSM.
 *
 * Valid transitions (enforced here) — proposed → active | abandoned;
 * active → completed | abandoned; completed/abandoned are terminal.
 *
 * Payload shape: { missionId, status }
 */

import { registerCascadeHandler } from "../cascade.js";
import { dispatchMissionActivated } from "../dispatch-helpers.js";
import type { MissionStatus } from "../../entities/mission.js";

const VALID_MISSION_STATUSES: ReadonlySet<string> = new Set<MissionStatus>(["proposed", "active", "completed", "abandoned"]);

/** Allowed FSM transitions. Terminal states ("completed", "abandoned")
 * have no outgoing edges — re-issuing the same terminal is a no-op the
 * handler rejects so the caller knows the action wasn't applied. */
const ALLOWED_TRANSITIONS: Record<MissionStatus, ReadonlySet<MissionStatus>> = {
  proposed: new Set<MissionStatus>(["active", "abandoned"]),
  active: new Set<MissionStatus>(["completed", "abandoned"]),
  completed: new Set<MissionStatus>(),
  abandoned: new Set<MissionStatus>(),
};

registerCascadeHandler("update_mission_status", async ({ ctx, thread, action, sourceThreadSummary }) => {
  if (action.type !== "update_mission_status") {
    return { status: "failed", error: `expected update_mission_status, got ${action.type}` };
  }
  const payload = action.payload;
  const missionId = payload.missionId;
  const targetStatus = payload.status as MissionStatus;

  if (!VALID_MISSION_STATUSES.has(targetStatus)) {
    return { status: "failed", error: `invalid mission status "${targetStatus}" — expected one of: ${Array.from(VALID_MISSION_STATUSES).join(", ")}` };
  }

  const mission = await ctx.stores.mission.getMission(missionId);
  if (!mission) {
    return { status: "failed", error: `mission ${missionId} not found` };
  }

  // Idempotent on a match — already at target status; treat as skipped
  // so consumers know nothing changed but nothing went wrong.
  if (mission.status === targetStatus) {
    await ctx.stores.audit.logEntry(
      "hub",
      "action_already_executed",
      `Cascade update_mission_status skipped for ${thread.id}/${action.id}: mission ${missionId} already at status ${targetStatus}.`,
      missionId,
    );
    return { status: "skipped_idempotent", entityId: missionId };
  }

  const allowedFrom = ALLOWED_TRANSITIONS[mission.status] ?? new Set();
  if (!allowedFrom.has(targetStatus)) {
    return { status: "failed", error: `invalid transition: mission ${missionId} is ${mission.status}; cannot move to ${targetStatus}` };
  }

  const updated = await ctx.stores.mission.updateMission(missionId, { status: targetStatus });
  if (!updated) {
    return { status: "failed", error: `mission ${missionId} updateMission returned null` };
  }

  await ctx.stores.audit.logEntry(
    "hub",
    "thread_update_mission_status",
    `Mission ${missionId} status ${mission.status} → ${targetStatus} from thread ${thread.id}/${action.id}. Summary: ${sourceThreadSummary}.`,
    missionId,
  );

  // Same mission_activated event the direct updateMission fires on
  // the proposed → active edge. Other transitions stay silent —
  // matches direct-path behaviour; revisit if listeners emerge.
  if (targetStatus === "active") {
    await dispatchMissionActivated(ctx, updated);
  }

  return { status: "executed", entityId: missionId };
});
