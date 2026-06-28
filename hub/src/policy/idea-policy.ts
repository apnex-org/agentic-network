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
  LIST_COMPACT_SCHEMA,
  LIST_TAGS_SCHEMA,
  applyTagFilter,
  mergeTags,
  unsetIfEmpty,
  omitEmptyValues,
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
import { phaseFromEntity } from "../entities/shape-helpers.js";

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

// mission-90 W8 (idea-320, decode-to-flat): the idea repo decodes envelope→flat
// at every read boundary (cloneIdea), so listIdeas() hands these accessors
// GUARANTEED-FLAT Ideas — relocated fields (createdAt/updatedAt/missionId/
// source*/createdBy → top-level) read directly. status via phaseFromEntity — the
// decode-mechanism, reused here for a graceful status read (safe per ruling A).
// History: the W3 fix was the accessor body (matchField's bare-key lookup
// unchanged); W8 retires the W3-era dual-shape reader now reads are flat.
const ideaCreatedBy = (i: Idea) => i.createdBy;
const IDEA_ACCESSORS: FieldAccessors<Idea> = {
  id: (i) => i.id,
  status: (i) => phaseFromEntity(i),
  createdAt: (i) => i.createdAt,
  updatedAt: (i) => i.updatedAt,
  missionId: (i) => i.missionId,
  sourceThreadId: (i) => i.sourceThreadId,
  sourceActionId: (i) => i.sourceActionId,
  "createdBy.role": (i) => ideaCreatedBy(i)?.role ?? null,
  "createdBy.agentId": (i) => ideaCreatedBy(i)?.agentId ?? null,
  "createdBy.id": (i) => { const cb = ideaCreatedBy(i); return cb ? `${cb.role}:${cb.agentId}` : null; },
};

const IDEA_FILTER_SCHEMA = buildQueryFilterSchema(IDEA_FILTERABLE_FIELDS);
const IDEA_SORT_SCHEMA = buildQuerySortSchema(IDEA_SORTABLE_FIELDS);

/** bug-196: compact scannable projection. Idea has no `title` — `text` IS the body, so
 *  expose a truncated `textPreview` as the scannable label + OMIT the full text +
 *  sourceThreadSummary. */
function projectIdeaCompact(i: Idea) {
  const text = typeof i.text === "string" ? i.text : "";
  return {
    id: i.id,
    textPreview: text.length > 140 ? text.slice(0, 140) + "…" : text,
    status: i.status, missionId: i.missionId ?? null, tags: i.tags, updatedAt: i.updatedAt,
  };
}

async function listIdeas(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  let ideas = await ctx.stores.idea.listIdeas();
  const totalPreFilter = ideas.length;

  // Legacy tag match-any filter (pre-QueryShape; preserved).
  ideas = applyTagFilter(ideas, args.tags as string[] | undefined);

  // Backwards-compat: legacy scalar `status` arg subsumed by the new
  // `filter.status` field. filter.status wins when both are present.
  // bug-198: empty-string legacy status + any empty values in the `filter` object are
  // adapter-serialized UNSETs (opencode) — drop them, don't AND them to zero matches.
  const legacyStatus = unsetIfEmpty(typeof args.status === "string" ? args.status : undefined) as IdeaStatus | undefined;
  const filterArgRaw = args.filter as Record<string, unknown> | undefined;
  const effectiveFilter: Record<string, unknown> = omitEmptyValues({ ...(filterArgRaw ?? {}) });
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
        ideas: args.compact === true ? page.items.map(projectIdeaCompact) : page.items,
        count: page.count,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        ...(args.compact === true ? { compact: true } : {}),
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
  // idea-363 (work-59): additive-tag mode — union onto the existing tags instead
  // of clobbering them. The post-stint triage pass stamps audit:* tags on
  // already-tagged ideas, so a replace-only surface would wipe prior tags.
  const addTags = unsetIfEmpty(args.addTags as string[] | undefined) as string[] | undefined;
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
  if (addTags && addTags.length > 0) {
    // Read-merge-write: union addTags onto the current tags (or onto the
    // `tags` replacement if both are present). mergeTags dedupes + drops empties.
    const current = await ctx.stores.idea.getIdea(ideaId);
    if (!current) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Idea not found: ${ideaId}` }) }], isError: true };
    }
    updates.tags = mergeTags(updates.tags ?? current.tags, addTags);
  }
  if (text !== undefined) updates.text = text;

  // FSM guard: validate status transition if status is changing. mission-89
  // Phase 4 (bug-137 closure): envelope-shape Idea has status as {phase,...}
  // not string; use phaseFromEntity to coerce both shapes.
  if (updates.status) {
    const current = await ctx.stores.idea.getIdea(ideaId);
    if (!current) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Idea not found: ${ideaId}` }) }], isError: true };
    }
    const currentPhase = phaseFromEntity(current);
    if (currentPhase === null) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Idea ${ideaId} has no readable status; envelope shape may be malformed` }) }], isError: true };
    }
    if (currentPhase !== updates.status && !isValidTransition(IDEA_FSM, currentPhase as IdeaStatus, updates.status)) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: `Invalid state transition: cannot move idea from '${currentPhase}' to '${updates.status}'` }) }],
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

// ── get_backlog_health (idea-363 / work-59) ─────────────────────────
// Server-side incorporation-constraint readout over the FULL Idea collection.
// The org's binding constraint is INCORPORATION (generation outpaces it ~14:1
// per the stint-3 retro), so the gate-point question is "is the funnel clearing,
// and what's aging out?" — not "how many ideas exist". Computed server-side so
// the counts are accurate + the payload is tiny: a client-side list_ideas survey
// both caps at 500 per call AND ships fat objects (the 429 class, bug-196).
// IDEAS-ONLY by design — Bugs are reconcile.py's domain (don't duplicate →
// drift); Missions are a noted FUTURE extension.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

export interface BacklogHealthBuckets {
  open: Idea[];
  triaged: Idea[];
  dismissed: Idea[];
  incorporated: Idea[];
}

/** Pure incorporation-constraint computation (exported for direct unit test —
 *  the truncation + age-bucket logic is testable without 500 real ideas). */
export function computeBacklogHealth(
  buckets: BacklogHealthBuckets,
  opts: { asOfMs: number; staleWeeks: number; truncatedStatuses?: string[] },
) {
  const { asOfMs, staleWeeks } = opts;
  const truncatedStatuses = opts.truncatedStatuses ?? [];
  const ageMs = (i: Idea): number => {
    const t = i.createdAt ? Date.parse(i.createdAt) : NaN;
    return Number.isNaN(t) ? 0 : Math.max(0, asOfMs - t);
  };

  const funnel = {
    open: buckets.open.length,
    triaged: buckets.triaged.length,
    dismissed: buckets.dismissed.length,
    incorporated: buckets.incorporated.length,
    total: buckets.open.length + buckets.triaged.length + buckets.dismissed.length + buckets.incorporated.length,
  };

  // Age histogram over OPEN ideas (the "best arcs age out ~2.5mo" signal).
  const openAgeHistogram = { lt1w: 0, "1to4w": 0, "1to3mo": 0, gt3mo: 0 };
  let oldestOpenAgeDays = 0;
  for (const i of buckets.open) {
    const a = ageMs(i);
    oldestOpenAgeDays = Math.max(oldestOpenAgeDays, Math.floor(a / DAY_MS));
    if (a < WEEK_MS) openAgeHistogram.lt1w++;
    else if (a < 4 * WEEK_MS) openAgeHistogram["1to4w"]++;
    else if (a < 3 * MONTH_MS) openAgeHistogram["1to3mo"]++;
    else openAgeHistogram.gt3mo++;
  }

  // Stuck-in-triage: triaged + NOT linked to a mission + age > staleWeeks — the
  // "ready-but-unactioned" signal idea-363 names (default 3wk, param-overridable).
  const staleMs = staleWeeks * WEEK_MS;
  const stuckIdeas = buckets.triaged.filter((i) => !i.missionId && ageMs(i) > staleMs);

  // Incorporation-constraint readout: in-flight (open+triaged, awaiting
  // incorporation) vs incorporated. ratio > 1 = backlog outpacing incorporation.
  const inFlight = funnel.open + funnel.triaged;
  const incorporationRatio = funnel.incorporated > 0
    ? Number((inFlight / funnel.incorporated).toFixed(2))
    : null;

  return {
    funnel,
    openAgeHistogram,
    oldestOpenAgeDays,
    stuckInTriage: {
      count: stuckIdeas.length,
      staleWeeks,
      ideaIds: stuckIdeas.map((i) => i.id),
    },
    incorporation: {
      inFlight,
      incorporated: funnel.incorporated,
      ratio: incorporationRatio,
    },
    ...(truncatedStatuses.length > 0
      ? {
          truncated: true,
          truncatedStatuses,
          truncationNote: `status bucket(s) [${truncatedStatuses.join(", ")}] hit the 500-row scan cap; those counts are a floor, not exact.`,
        }
      : { truncated: false }),
  };
}

async function getBacklogHealth(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const asOfRaw = typeof args.asOf === "string" ? Date.parse(args.asOf) : NaN;
  const asOfMs = Number.isNaN(asOfRaw) ? Date.now() : asOfRaw;
  const staleWeeks = typeof args.staleWeeks === "number" && args.staleWeeks > 0 ? args.staleWeeks : 3;

  const [open, triaged, dismissed, incorporated] = await Promise.all([
    ctx.stores.idea.listIdeas("open"),
    ctx.stores.idea.listIdeas("triaged"),
    ctx.stores.idea.listIdeas("dismissed"),
    ctx.stores.idea.listIdeas("incorporated"),
  ]);

  // Truncation-honesty (the R2 lesson): listIdeas hard-caps at 500 per status;
  // a bucket returning exactly the cap may be truncated → flag it.
  const LIST_CAP = 500;
  const truncatedStatuses: string[] = [];
  if (open.length >= LIST_CAP) truncatedStatuses.push("open");
  if (triaged.length >= LIST_CAP) truncatedStatuses.push("triaged");
  if (dismissed.length >= LIST_CAP) truncatedStatuses.push("dismissed");
  if (incorporated.length >= LIST_CAP) truncatedStatuses.push("incorporated");

  const health = computeBacklogHealth(
    { open, triaged, dismissed, incorporated },
    { asOfMs, staleWeeks, truncatedStatuses },
  );

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ asOf: new Date(asOfMs).toISOString(), ...health }, null, 2),
    }],
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
      ...LIST_COMPACT_SCHEMA,
    },
    listIdeas,
  );

  router.register(
    "update_idea",
    "[Any] Update an idea. Any caller may edit text, tags, and transition status between 'open' and 'triaged'. Architect-only: setting status to 'dismissed' or 'incorporated', and linking to a mission (missionId). Use `addTags` for additive (union, no-clobber) tag stamping — e.g. a triage pass adding audit:* tags without wiping existing ones; `tags` replaces the whole set.",
    {
      ideaId: z.string().describe("The idea ID to update"),
      status: z.enum(["open", "triaged", "dismissed", "incorporated"]).optional().describe("New status (Engineer limited to 'open' and 'triaged')"),
      missionId: z.string().optional().describe("Link to a mission (Architect-only; sets status to 'incorporated' if not already)"),
      tags: z.array(z.string()).optional().describe("REPLACE the whole tag set. For incremental stamping use `addTags` instead (replace clobbers prior tags)."),
      addTags: z.array(z.string()).optional().describe("ADDITIVE (idea-363): union these tags onto the idea's existing tags (no clobber, deduped). The post-stint triage cadence stamps audit:value/effort/action/tele_primary via this. If both `tags` and `addTags` are given, tags replaces then addTags unions onto it."),
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

  router.register(
    "get_backlog_health",
    "[Any] Backlog-health readout (idea-363) — the incorporation-constraint metric, computed server-side over the FULL Idea collection (accurate counts + a tiny payload; NOT a fat list_ideas survey, which caps at 500/call and ships full objects). Returns: `funnel` (open/triaged/dismissed/incorporated/total counts); `openAgeHistogram` (lt1w / 1to4w / 1to3mo / gt3mo) + `oldestOpenAgeDays` (the 'best arcs age out' signal); `stuckInTriage` (triaged + unlinked-to-mission + age>staleWeeks — the ready-but-unactioned signal; staleWeeks default 3, param-overridable); `incorporation` (inFlight:incorporated ratio — >1 means the backlog is outpacing incorporation). Truncation-honest: per-status buckets that hit the 500-row scan cap are flagged. IDEAS-ONLY — Bugs are reconcile.py's domain; Missions are a noted future extension.",
    {
      staleWeeks: z.number().int().positive().optional()
        .describe("Stuck-in-triage age threshold in weeks (default 3): a triaged, mission-unlinked idea older than this counts as ready-but-unactioned."),
      asOf: z.string().optional()
        .describe("Compute health as-of this ISO instant (default: now). Enables gate-point-dated readouts + deterministic snapshots."),
    },
    getBacklogHealth,
  );
}
