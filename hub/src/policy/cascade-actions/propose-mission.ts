/**
 * Cascade ActionSpec: propose_mission.
 *
 * Spawns a Mission in `proposed` status. Distinct from Director-
 * gated `create_mission` — autonomous actions cannot widen authorization
 * scope; Mission stays in `proposed` until Director activates.
 *
 * Payload: { title, description, goals } — goals serialised into
 * description as a Markdown list until the Mission schema grows a
 * first-class goals field.
 */

import { registerActionSpec } from "../cascade-spec.js";
import { ProposeMissionActionPayloadSchema } from "../staged-action-payloads.js";
import { dispatchMissionCreated } from "../dispatch-helpers.js";
import type { Mission } from "../../entities/mission.js";
import type { EntityProvenance } from "../../state.js";

registerActionSpec({
  type: "propose_mission",
  kind: "spawn",
  payloadSchema: ProposeMissionActionPayloadSchema,
  auditAction: "thread_propose_mission",
  findByCascadeKey: (ctx, key) => ctx.stores.mission.findByCascadeKey(key),
  execute: async (ctx, payload, action, _thread, backlink): Promise<Mission> => {
    const p = payload as { title: string; description: string; goals: string[] };
    const goalsBlock = p.goals.length > 0
      ? `\n\nGoals:\n${p.goals.map((g) => `- ${g}`).join("\n")}`
      : "";
    const composed = `${p.description}${goalsBlock}`;
    const createdBy: EntityProvenance = {
      role: action.proposer.role,
      agentId: action.proposer.agentId ?? `anonymous-${action.proposer.role}`,
    };
    return ctx.stores.mission.createMission(p.title, composed, undefined, backlink, createdBy);
  },
  auditDetails: (entity, action, thread, summary) => {
    const p = action.payload as { title: string; goals: string[] };
    return `Mission ${(entity as Mission).id} proposed from thread ${thread.id}/${action.id}. Title: ${p.title}. Goals: ${p.goals.length}. Summary: ${summary}.`;
  },
  dispatch: (ctx, entity, _thread) => dispatchMissionCreated(ctx, entity as Mission),
});
