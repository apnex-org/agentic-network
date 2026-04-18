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
import type { IdeaStatus } from "../entities/index.js";
import { LIST_PAGINATION_SCHEMA, LIST_TAGS_SCHEMA, applyTagFilter, paginate } from "./list-filters.js";
import { dispatchIdeaSubmitted } from "./dispatch-helpers.js";

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

  const role = ctx.stores.engineerRegistry.getRole(ctx.sessionId);
  const idea = await ctx.stores.idea.submitIdea(text, role, sourceThreadId, tags);

  // Uses the shared helper so the cascade path (cascade-actions/
  // create-idea.ts) fires an identically-shaped event.
  await dispatchIdeaSubmitted(ctx, idea, role);

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ ideaId: idea.id, status: idea.status }) }],
  };
}

async function listIdeas(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const status = args.status as IdeaStatus | undefined;
  let ideas = await ctx.stores.idea.listIdeas(status);
  ideas = applyTagFilter(ideas, args.tags as string[] | undefined);
  const page = paginate(ideas, args);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ ideas: page.items, count: page.count, total: page.total, offset: page.offset, limit: page.limit }, null, 2) }],
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
    "[Any] List ideas with optional status filter, tag match-any filter, and pagination.",
    {
      status: z.enum(["open", "triaged", "dismissed", "incorporated"]).optional().describe("Filter by status"),
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
}
