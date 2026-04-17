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

  await ctx.emit("idea_submitted", {
    ideaId: idea.id,
    text: text.substring(0, 200),
    author: role,
  }, ["architect", "engineer"]);

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ ideaId: idea.id, status: idea.status }) }],
  };
}

async function listIdeas(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const status = args.status as IdeaStatus | undefined;
  const ideas = await ctx.stores.idea.listIdeas(status);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ ideas, count: ideas.length }, null, 2) }],
  };
}

async function updateIdea(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const ideaId = args.ideaId as string;
  const status = args.status as IdeaStatus | undefined;
  const missionId = args.missionId as string | undefined;
  const tags = args.tags as string[] | undefined;

  const updates: { status?: IdeaStatus; missionId?: string; tags?: string[] } = {};
  if (status) updates.status = status;
  if (missionId) {
    updates.missionId = missionId;
    if (!status) updates.status = "incorporated";
  }
  if (tags) updates.tags = tags;

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
    "[Any] List all ideas, optionally filtered by status.",
    {
      status: z.enum(["open", "triaged", "dismissed", "incorporated"]).optional().describe("Filter by status"),
    },
    listIdeas,
  );

  router.register(
    "update_idea",
    "[Architect] Update an idea's status, link to a mission, or modify tags.",
    {
      ideaId: z.string().describe("The idea ID to update"),
      status: z.enum(["open", "triaged", "dismissed", "incorporated"]).optional().describe("New status"),
      missionId: z.string().optional().describe("Link to a mission (sets status to 'incorporated' if not already)"),
      tags: z.array(z.string()).optional().describe("Replace tags"),
    },
    updateIdea,
  );
}
