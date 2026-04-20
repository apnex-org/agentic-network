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
import type { Mission, MissionStatus } from "../entities/index.js";
import {
  LIST_PAGINATION_SCHEMA,
  paginate,
  buildQueryFilterSchema,
  buildQuerySortSchema,
  applyQueryFilter,
  applyQuerySort,
  type QueryableFieldSpec,
  type FieldAccessors,
} from "./list-filters.js";
import { dispatchMissionCreated, dispatchMissionActivated } from "./dispatch-helpers.js";
import { resolveCreatedBy } from "./caller-identity.js";

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

  const createdBy = await resolveCreatedBy(ctx);
  const mission = await ctx.stores.mission.createMission(title, description, documentRef, undefined, createdBy);

  // Uses the shared helper so the cascade path (cascade-actions/
  // propose-mission.ts) fires an identically-shaped event.
  await dispatchMissionCreated(ctx, mission);

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
    // Uses the shared helper so the cascade path (cascade-actions/
    // update-mission-status.ts) fires an identically-shaped event.
    await dispatchMissionActivated(ctx, mission);
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

// ── M-QueryShape Phase C (idea-119, task-306) ──────────────────────
// Mission-entity field descriptors + accessors. Mirrors list_tasks /
// list_ideas / list_threads pattern; createdBy.id is computed
// `${role}:${agentId}` per architect-ratified virtual-field intent.

const MISSION_FILTERABLE_FIELDS: QueryableFieldSpec = {
  status: { type: "enum", values: ["proposed", "active", "completed", "abandoned"] },
  correlationId: { type: "string" },
  turnId: { type: "string" },
  sourceThreadId: { type: "string" },
  sourceActionId: { type: "string" },
  createdAt: { type: "date" },
  updatedAt: { type: "date" },
  "createdBy.role": { type: "string" },
  "createdBy.agentId": { type: "string" },
  "createdBy.id": { type: "string" },
};

const MISSION_SORTABLE_FIELDS = [
  "id",
  "status",
  "createdAt",
  "updatedAt",
  "correlationId",
  "turnId",
  "sourceThreadId",
  "sourceActionId",
  "createdBy.role",
  "createdBy.agentId",
  "createdBy.id",
] as const;

const MISSION_ACCESSORS: FieldAccessors<Mission> = {
  id: (m) => m.id,
  status: (m) => m.status,
  correlationId: (m) => m.correlationId,
  turnId: (m) => m.turnId,
  sourceThreadId: (m) => m.sourceThreadId,
  sourceActionId: (m) => m.sourceActionId,
  createdAt: (m) => m.createdAt,
  updatedAt: (m) => m.updatedAt,
  "createdBy.role": (m) => m.createdBy?.role ?? null,
  "createdBy.agentId": (m) => m.createdBy?.agentId ?? null,
  "createdBy.id": (m) => (m.createdBy ? `${m.createdBy.role}:${m.createdBy.agentId}` : null),
};

const MISSION_FILTER_SCHEMA = buildQueryFilterSchema(MISSION_FILTERABLE_FIELDS);
const MISSION_SORT_SCHEMA = buildQuerySortSchema(MISSION_SORTABLE_FIELDS);

async function listMissions(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  let missions = await ctx.stores.mission.listMissions();
  const totalPreFilter = missions.length;

  // Backwards-compat: legacy scalar `status` arg subsumed by the new
  // `filter.status` field. filter.status wins when both are present.
  const legacyStatus = typeof args.status === "string" ? (args.status as MissionStatus) : undefined;
  const filterArgRaw = args.filter as Record<string, unknown> | undefined;
  const effectiveFilter: Record<string, unknown> = { ...(filterArgRaw ?? {}) };
  if (legacyStatus && effectiveFilter.status === undefined) {
    effectiveFilter.status = legacyStatus;
  }
  const hasFilter = Object.keys(effectiveFilter).length > 0;

  if (hasFilter) {
    missions = applyQueryFilter(missions, effectiveFilter, MISSION_ACCESSORS);
  }

  const sortArg = args.sort as ReadonlyArray<{ field: string; order: "asc" | "desc" }> | undefined;
  missions = applyQuerySort(missions, sortArg, MISSION_ACCESSORS);

  const postFilterCount = missions.length;
  const page = paginate(missions, args);

  const queryUnmatched = hasFilter && postFilterCount === 0 && totalPreFilter > 0;

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        missions: page.items,
        count: page.count,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        ...(queryUnmatched ? { _ois_query_unmatched: true } : {}),
      }, null, 2),
    }],
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
    "[Any] List missions with filter + sort + pagination. " +
    "`filter` accepts a Mongo-ish object with implicit AND across fields: " +
    "`{status: 'active'}` for eq, `{status: {$in: ['proposed','active']}}` for set membership, " +
    "`{createdAt: {$lt: '2026-04-01T00:00:00Z'}}` for range. " +
    "Filterable fields: status, correlationId, turnId, sourceThreadId, sourceActionId, createdAt, updatedAt, " +
    "'createdBy.role', 'createdBy.agentId', 'createdBy.id' (computed `${role}:${agentId}`). " +
    "Range operators ($gt/$lt/$gte/$lte) apply only to dates + numbers. " +
    "Forbidden operators ($regex, $where, $expr, $or, $and, $not) are rejected with an error naming the permitted set. " +
    "`sort` accepts an ordered tuple `[{field, order}]` on: id, status, createdAt, updatedAt, correlationId, turnId, sourceThreadId, sourceActionId, 'createdBy.role', 'createdBy.agentId', 'createdBy.id'. " +
    "Implicit id:asc tie-breaker is appended for deterministic pagination. " +
    "Returns `_ois_query_unmatched: true` when the filter yields zero matches but the collection is non-empty. " +
    "Legacy scalar `status:` arg preserved for backwards compat; `filter.status` wins when both present.",
    {
      filter: MISSION_FILTER_SCHEMA.optional()
        .describe("Mongo-ish filter object; see tool description for permitted fields + operators"),
      sort: MISSION_SORT_SCHEMA
        .describe("Ordered-tuple sort; see tool description for permitted fields"),
      status: z.enum(["proposed", "active", "completed", "abandoned"]).optional()
        .describe("DEPRECATED: use `filter: { status: ... }`. Preserved for backwards compat; `filter.status` wins when both present."),
      ...LIST_PAGINATION_SCHEMA,
    },
    listMissions,
  );
}
