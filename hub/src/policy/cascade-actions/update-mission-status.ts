/**
 * Cascade ActionSpec: update_mission_status.
 *
 * Status-only transitions per ADR-014 §21 scope-of-commitment
 * principle — scope edits (description, goals) remain Director-gated.
 * Kind "update" — null return from execute = no-op idempotent skip
 * (already at target status).
 *
 * Allowed FSM: proposed → {active, abandoned}; active → {completed, abandoned};
 * completed / abandoned terminal. Invalid transitions throw → failed.
 *
 * Dispatch: mission_activated fires only on proposed → active.
 */

import { registerActionSpec } from "../cascade-spec.js";
import { UpdateMissionStatusActionPayloadSchema } from "../staged-action-payloads.js";
import { dispatchMissionActivated } from "../dispatch-helpers.js";
import type { Mission, MissionStatus } from "../../entities/mission.js";
import { phaseFromEntity } from "../../entities/shape-helpers.js";

const VALID_MISSION_STATUSES: ReadonlySet<string> = new Set<MissionStatus>(["proposed", "active", "completed", "abandoned"]);

const ALLOWED_TRANSITIONS: Record<MissionStatus, ReadonlySet<MissionStatus>> = {
  proposed: new Set<MissionStatus>(["active", "abandoned"]),
  active: new Set<MissionStatus>(["completed", "abandoned"]),
  completed: new Set<MissionStatus>(),
  abandoned: new Set<MissionStatus>(),
};

// Sidecar — remember the target status decided in execute so dispatch
// can fire mission_activated conditionally on the proposed → active edge.
const lastTarget = new Map<string, MissionStatus>();

registerActionSpec({
  type: "update_mission_status",
  kind: "update",
  payloadSchema: UpdateMissionStatusActionPayloadSchema,
  auditAction: "thread_update_mission_status",
  execute: async (ctx, payload, _action, _thread, _backlink): Promise<Mission | null> => {
    const p = payload as { missionId: string; status: MissionStatus };
    if (!VALID_MISSION_STATUSES.has(p.status)) {
      throw new Error(`invalid mission status "${p.status}" — expected one of: ${Array.from(VALID_MISSION_STATUSES).join(", ")}`);
    }
    const mission = await ctx.stores.mission.getMission(p.missionId);
    if (!mission) throw new Error(`mission ${p.missionId} not found`);
    if (mission.status === p.status) return null; // no-op idempotent skip

    const allowedFrom = ALLOWED_TRANSITIONS[mission.status] ?? new Set();
    if (!allowedFrom.has(p.status)) {
      throw new Error(`invalid transition: mission ${p.missionId} is ${mission.status}; cannot move to ${p.status}`);
    }

    const updated = await ctx.stores.mission.updateMission(p.missionId, { status: p.status });
    if (!updated) throw new Error(`mission ${p.missionId} updateMission returned null`);
    lastTarget.set(p.missionId, p.status);
    return updated;
  },
  auditDetails: (entity, action, thread, summary) => {
    const p = action.payload as { missionId: string; status: string };
    const mission = entity as Mission | null;
    // mission-89 Phase 4 (bug-137): envelope-aware status read.
    const priorPhase = mission ? (lastTarget.get(p.missionId) ?? phaseFromEntity(mission)) : "(unknown)";
    return `Mission ${p.missionId} status transitioned to ${p.status} from thread ${thread.id}/${action.id}. Prior resolved target: ${priorPhase ?? "(unknown)"}. Summary: ${summary}.`;
  },
  dispatch: async (ctx, entity, _thread) => {
    const mission = entity as Mission;
    // mission-89 Phase 4 (bug-137): envelope-aware status read.
    if (phaseFromEntity(mission) === "active" && lastTarget.get(mission.id) === "active") {
      await dispatchMissionActivated(ctx, mission);
      lastTarget.delete(mission.id);
    }
  },
});
