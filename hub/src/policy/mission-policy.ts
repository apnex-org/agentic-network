/**
 * Mission Policy — Arc-of-work management.
 *
 * Tools: create_mission, update_mission, get_mission, list_missions
 * Emits: mission_created, mission_activated
 */

import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import { isValidTransition } from "./types.js";
import type { FsmTransitionTable } from "./types.js";
import type { MissionStatus } from "../entities/index.js";
import { LIST_PAGINATION_SCHEMA, paginate } from "./list-filters.js";

// ── FSM Declaration ─────────────────────────────────────────────────

export const MISSION_FSM: FsmTransitionTable = [
  { from: "proposed", to: "active" },
  { from: "proposed", to: "abandoned" },
  { from: "active", to: "completed" },
  { from: "active", to: "abandoned" },
];

// ── Handlers ────────────────────────────────────────────────────────

async function createMission(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const title = args.title as string;
  const description = args.description as string;
  const documentRef = args.documentRef as string | undefined;

  const mission = await ctx.stores.mission.createMission(title, description, documentRef);

  await ctx.emit("mission_created", {
    missionId: mission.id,
    title,
  }, ["architect", "engineer"]);

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ missionId: mission.id, status: mission.status, correlationId: mission.correlationId }) }],
  };
}

async function updateMission(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const missionId = args.missionId as string;
  const status = args.status as MissionStatus | undefined;
  const description = args.description as string | undefined;
  const documentRef = args.documentRef as string | undefined;

  const updates: { status?: MissionStatus; description?: string; documentRef?: string } = {};
  if (status) updates.status = status;
  if (description !== undefined) updates.description = description;
  if (documentRef !== undefined) updates.documentRef = documentRef;

  // FSM guard: validate status transition if status is changing
  if (status) {
    const current = await ctx.stores.mission.getMission(missionId);
    if (!current) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Mission not found: ${missionId}` }) }], isError: true };
    }
    if (current.status !== status && !isValidTransition(MISSION_FSM, current.status, status)) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: `Invalid state transition: cannot move mission from '${current.status}' to '${status}'` }) }],
        isError: true,
      };
    }
  }

  const mission = await ctx.stores.mission.updateMission(missionId, updates);
  if (!mission) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Mission not found: ${missionId}` }) }], isError: true };
  }

  if (status === "active") {
    await ctx.emit("mission_activated", { missionId, title: mission.title }, ["architect", "engineer"]);
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ missionId: mission.id, status: mission.status, tasks: mission.tasks, ideas: mission.ideas }) }],
  };
}

async function getMission(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const missionId = args.missionId as string;
  const mission = await ctx.stores.mission.getMission(missionId);
  if (!mission) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Mission not found: ${missionId}` }) }], isError: true };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(mission, null, 2) }],
  };
}

async function listMissions(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const status = args.status as MissionStatus | undefined;
  const missions = await ctx.stores.mission.listMissions(status);
  const page = paginate(missions, args);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ missions: page.items, count: page.count, total: page.total, offset: page.offset, limit: page.limit }, null, 2) }],
  };
}

// ── Registration ────────────────────────────────────────────────────

export function registerMissionPolicy(router: PolicyRouter): void {
  router.register(
    "create_mission",
    "[Architect] Create a new mission — a committed arc of work grouping related tasks.",
    {
      title: z.string().describe("Mission title"),
      description: z.string().describe("Brief description of the mission objectives"),
      documentRef: z.string().optional().describe("GCS document path for the full brief (e.g., 'documents/missions/brief.md')"),
    },
    createMission,
  );

  router.register(
    "update_mission",
    "[Architect] Update a mission's status, description, or document reference.",
    {
      missionId: z.string().describe("The mission ID to update"),
      status: z.enum(["proposed", "active", "completed", "abandoned"]).optional().describe("New status"),
      description: z.string().optional().describe("Updated description"),
      documentRef: z.string().optional().describe("Updated document reference"),
    },
    updateMission,
  );

  router.register(
    "get_mission",
    "[Any] Read a specific mission with all linked tasks and ideas.",
    { missionId: z.string().describe("The mission ID") },
    getMission,
  );

  router.register(
    "list_missions",
    "[Any] List missions with optional status filter and pagination.",
    {
      status: z.enum(["proposed", "active", "completed", "abandoned"]).optional().describe("Filter by status"),
      ...LIST_PAGINATION_SCHEMA,
    },
    listMissions,
  );
}
