/**
 * Idea Policy — Backlog idea management.
 *
 * Tools: create_idea, list_ideas, update_idea
 * Cross-domain: auto-links ideas to missions on incorporation.
 */

import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import { isValidTransition } from "./types.js";
import type { FsmTransitionTable } from "./types.js";
import type { Idea, IdeaStatus } from "../entities/index.js";
import {
  LIST_PAGINATION_SCHEMA,
  LIST_TAGS_SCHEMA,
  applyTagFilter,
  paginate,
  buildQueryFilterSchema,
  buildQuerySortSchema,
  applyQueryFilter,
  applyQuerySort,
  type QueryableFieldSpec,
  type FieldAccessors,
} from "./list-filters.js";
import { dispatchIdeaSubmitted } from "./dispatch-helpers.js";
import { resolveCreatedBy } from "./caller-identity.js";

// ── FSM Declaration ─────────────────────────────────────────────────

export const IDEA_FSM: FsmTransitionTable = [
  { from: "open", to: "triaged" },
  { from: "open", to: "dismissed" },
  { from: "open", to: "incorporated" },
  { from: "triaged", to: "incorporated" },
  { from: "triaged", to: "dismissed" },
  { from: "dismissed", to: "open" },       // allow re-opening dismissed ideas
];

// ── Handlers ────────────────────────────────────────────────────────

async function createIdea(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const text = args.text as string;
  const sourceThreadId = args.sourceThreadId as string | undefined;
  const tags = args.tags as string[] | undefined;

  const createdBy = await resolveCreatedBy(ctx);
  const idea = await ctx.stores.idea.submitIdea(text, createdBy, sourceThreadId, tags);

  // Uses the shared helper so the cascade path (cascade-actions/
  // create-idea.ts) fires an identically-shaped event. SSE payload
  // shape preserved (external contract); internal sourcing updated.
  await dispatchIdeaSubmitted(ctx, idea, createdBy.role);

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ ideaId: idea.id, status: idea.status }) }],
  };
}

// ── M-QueryShape Phase C (idea-119, task-306) ──────────────────────
// Idea-entity field descriptors + accessors for the shared filter/sort
// primitives. Nested `createdBy.*` paths mirror list_tasks (Phase 1 + C).
// `createdBy.id` is a computed virtual field: `${role}:${agentId}`.

const IDEA_FILTERABLE_FIELDS: QueryableFieldSpec = {
  status: { type: "enum", values: ["open", "triaged", "dismissed", "incorporated"] },
  missionId: { type: "string" },
  sourceThreadId: { type: "string" },
  sourceActionId: { type: "string" },
  createdAt: { type: "date" },
  updatedAt: { type: "date" },
  "createdBy.role": { type: "string" },
  "createdBy.agentId": { type: "string" },
  "createdBy.id": { type: "string" },
};

const IDEA_SORTABLE_FIELDS = [
  "id",
  "status",
  "createdAt",
  "updatedAt",
  "missionId",
  "sourceThreadId",
  "sourceActionId",
  "createdBy.role",
  "createdBy.agentId",
  "createdBy.id",
] as const;

const IDEA_ACCESSORS: FieldAccessors<Idea> = {
  id: (i) => i.id,
  status: (i) => i.status,
  createdAt: (i) => i.createdAt,
  updatedAt: (i) => i.updatedAt,
  missionId: (i) => i.missionId,
  sourceThreadId: (i) => i.sourceThreadId,
  sourceActionId: (i) => i.sourceActionId,
  "createdBy.role": (i) => i.createdBy?.role ?? null,
  "createdBy.agentId": (i) => i.createdBy?.agentId ?? null,
  "createdBy.id": (i) => (i.createdBy ? `${i.createdBy.role}:${i.createdBy.agentId}` : null),
};

const IDEA_FILTER_SCHEMA = buildQueryFilterSchema(IDEA_FILTERABLE_FIELDS);
const IDEA_SORT_SCHEMA = buildQuerySortSchema(IDEA_SORTABLE_FIELDS);

async function listIdeas(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  let ideas = await ctx.stores.idea.listIdeas();
  const totalPreFilter = ideas.length;

  // Legacy tag match-any filter (pre-QueryShape; preserved).
  ideas = applyTagFilter(ideas, args.tags as string[] | undefined);

  // Backwards-compat: legacy scalar `status` arg subsumed by the new
  // `filter.status` field. filter.status wins when both are present.
  const legacyStatus = typeof args.status === "string" ? (args.status as IdeaStatus) : undefined;
  const filterArgRaw = args.filter as Record<string, unknown> | undefined;
  const effectiveFilter: Record<string, unknown> = { ...(filterArgRaw ?? {}) };
  if (legacyStatus && effectiveFilter.status === undefined) {
    effectiveFilter.status = legacyStatus;
  }
  const hasFilter = Object.keys(effectiveFilter).length > 0;

  if (hasFilter) {
    ideas = applyQueryFilter(ideas, effectiveFilter, IDEA_ACCESSORS);
  }

  const sortArg = args.sort as ReadonlyArray<{ field: string; order: "asc" | "desc" }> | undefined;
  ideas = applyQuerySort(ideas, sortArg, IDEA_ACCESSORS);

  const postFilterCount = ideas.length;
  const page = paginate(ideas, args);

  const queryUnmatched = hasFilter && postFilterCount === 0 && totalPreFilter > 0;

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        ideas: page.items,
        count: page.count,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        ...(queryUnmatched ? { _ois_query_unmatched: true } : {}),
      }, null, 2),
    }],
  };
}

async function updateIdea(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const ideaId = args.ideaId as string;
  const status = args.status as IdeaStatus | undefined;
  const missionId = args.missionId as string | undefined;
  const tags = args.tags as string[] | undefined;
  const text = args.text as string | undefined;

  // Engineer gate: tool is [Any] so Engineers can edit text / tags and
  // flip open ↔ triaged. Architect-only operations stay restricted —
  // mission linking is an architectural decision (idea-49), and
  // dismissal / incorporation are terminal states the Architect owns.
  const callerRole = ctx.stores.engineerRegistry.getRole(ctx.sessionId);
  if (callerRole === "engineer") {
    if (missionId !== undefined) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Authorization denied: only Architect may link an idea to a mission (missionId)" }) }],
        isError: true,
      };
    }
    if (status === "dismissed" || status === "incorporated") {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: `Authorization denied: only Architect may set idea status '${status}'` }) }],
        isError: true,
      };
    }
  }

  const updates: { status?: IdeaStatus; missionId?: string; tags?: string[]; text?: string } = {};
  if (status) updates.status = status;
  if (missionId) {
    updates.missionId = missionId;
    if (!status) updates.status = "incorporated";
  }
  if (tags) updates.tags = tags;
  if (text !== undefined) updates.text = text;

  // FSM guard: validate status transition if status is changing
  if (updates.status) {
    const current = await ctx.stores.idea.getIdea(ideaId);
    if (!current) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Idea not found: ${ideaId}` }) }], isError: true };
    }
    if (current.status !== updates.status && !isValidTransition(IDEA_FSM, current.status, updates.status)) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: `Invalid state transition: cannot move idea from '${current.status}' to '${updates.status}'` }) }],
        isError: true,
      };
    }
  }

  const idea = await ctx.stores.idea.updateIdea(ideaId, updates);
  if (!idea) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Idea not found: ${ideaId}` }) }], isError: true };
  }

  // Mission linkage is a virtual view over the idea store (see mission.ts).
  // `idea.missionId` is the single source of truth — no explicit link step.

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ ideaId: idea.id, status: idea.status, missionId: idea.missionId }) }],
  };
}

// ── get_idea (bug-45 / mission-69 W0): mirrors get_bug + get_task + get_mission etc.
//    surfaces the missing get_X tool for Idea entity (sister to all other entity-fetch tools)

async function getIdea(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const ideaId = args.ideaId as string;
  const idea = await ctx.stores.idea.getIdea(ideaId);
  if (!idea) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: `Idea not found: ${ideaId}` }) }],
      isError: true,
    };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(idea, null, 2) }],
  };
}

// ── Registration ────────────────────────────────────────────────────

export function registerIdeaPolicy(router: PolicyRouter): void {
  router.register(
    "create_idea",
    "[Any] Submit an idea to the backlog. Lightweight — for unrefined thoughts that may become missions or tasks.",
    {
      text: z.string().describe("The idea content"),
      sourceThreadId: z.string().optional().describe("Thread ID where this idea originated"),
      tags: z.array(z.string()).optional().describe("Optional categorization tags"),
    },
    createIdea,
  );

  router.register(
    "list_ideas",
    "[Any] List ideas with filter + sort + pagination. " +
    "`filter` accepts a Mongo-ish object with implicit AND across fields: " +
    "`{status: 'open'}` for eq, `{status: {$in: ['open','triaged']}}` for set membership, " +
    "`{createdAt: {$lt: '2026-04-01T00:00:00Z'}}` for range. " +
    "Filterable fields: status, missionId, sourceThreadId, sourceActionId, createdAt, updatedAt, " +
    "'createdBy.role', 'createdBy.agentId', 'createdBy.id' (computed `${role}:${agentId}`). " +
    "Range operators ($gt/$lt/$gte/$lte) apply only to dates + numbers. " +
    "Forbidden operators ($regex, $where, $expr, $or, $and, $not) are rejected with an error naming the permitted set. " +
    "`sort` accepts an ordered tuple `[{field, order}]` on: id, status, createdAt, updatedAt, missionId, sourceThreadId, sourceActionId, 'createdBy.role', 'createdBy.agentId', 'createdBy.id'. " +
    "Implicit id:asc tie-breaker is appended for deterministic pagination. " +
    "Returns `_ois_query_unmatched: true` when the filter yields zero matches but the collection is non-empty (distinct from tool error). " +
    "Legacy scalar `status:` arg and `tags:` match-any filter preserved for backwards compat; `filter.status` wins when both status shapes present.",
    {
      filter: IDEA_FILTER_SCHEMA.optional()
        .describe("Mongo-ish filter object; see tool description for permitted fields + operators"),
      sort: IDEA_SORT_SCHEMA
        .describe("Ordered-tuple sort; see tool description for permitted fields"),
      status: z.enum(["open", "triaged", "dismissed", "incorporated"]).optional()
        .describe("DEPRECATED: use `filter: { status: ... }`. Preserved for backwards compat; `filter.status` wins when both present."),
      ...LIST_TAGS_SCHEMA,
      ...LIST_PAGINATION_SCHEMA,
    },
    listIdeas,
  );

  router.register(
    "update_idea",
    "[Any] Update an idea. Any caller may edit text, tags, and transition status between 'open' and 'triaged'. Architect-only: setting status to 'dismissed' or 'incorporated', and linking to a mission (missionId).",
    {
      ideaId: z.string().describe("The idea ID to update"),
      status: z.enum(["open", "triaged", "dismissed", "incorporated"]).optional().describe("New status (Engineer limited to 'open' and 'triaged')"),
      missionId: z.string().optional().describe("Link to a mission (Architect-only; sets status to 'incorporated' if not already)"),
      tags: z.array(z.string()).optional().describe("Replace tags"),
      text: z.string().optional().describe("Replace idea text"),
    },
    updateIdea,
  );

  router.register(
    "get_idea",
    "[Any] Read a specific idea by ID. Returns the full Idea entity (text, status, missionId, tags, createdBy, sourceThreadId, sourceActionId, sourceThreadSummary, createdAt, updatedAt). Sister tool to get_bug, get_task, get_mission, etc. — fills the missing get_X surface for Idea entities (bug-45 / mission-69 W0).",
    {
      ideaId: z.string().describe("The idea ID to read"),
    },
    getIdea,
  );
}
