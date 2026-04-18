/**
 * Turn Policy — High-level execution cycle management.
 *
 * Tools: create_turn, update_turn, get_turn, list_turns
 * Emits: turn_created, turn_updated
 */

import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import { isValidTransition } from "./types.js";
import type { FsmTransitionTable } from "./types.js";
import type { TurnStatus } from "../entities/index.js";
import { LIST_PAGINATION_SCHEMA, paginate } from "./list-filters.js";

// ── FSM Declaration ─────────────────────────────────────────────────

export const TURN_FSM: FsmTransitionTable = [
  { from: "planning", to: "active" },
  { from: "active", to: "completed" },
];

// ── Handlers ────────────────────────────────────────────────────────

async function createTurn(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const title = args.title as string;
  const scope = args.scope as string;
  const tele = args.tele as string[] | undefined;

  const turn = await ctx.stores.turn.createTurn(title, scope, tele);

  await ctx.emit("turn_created", {
    turnId: turn.id,
    title,
  }, ["architect", "engineer"]);

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ turnId: turn.id, status: turn.status, correlationId: turn.correlationId }) }],
  };
}

async function updateTurn(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const turnId = args.turnId as string;
  const status = args.status as TurnStatus | undefined;
  const scope = args.scope as string | undefined;
  const tele = args.tele as string[] | undefined;

  const updates: { status?: TurnStatus; scope?: string; tele?: string[] } = {};
  if (status) updates.status = status;
  if (scope !== undefined) updates.scope = scope;
  if (tele) updates.tele = tele;

  // FSM guard: validate status transition if status is changing
  if (status) {
    const current = await ctx.stores.turn.getTurn(turnId);
    if (!current) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Turn not found: ${turnId}` }) }], isError: true };
    }
    if (current.status !== status && !isValidTransition(TURN_FSM, current.status, status)) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: `Invalid state transition: cannot move turn from '${current.status}' to '${status}'` }) }],
        isError: true,
      };
    }
  }

  const turn = await ctx.stores.turn.updateTurn(turnId, updates);
  if (!turn) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Turn not found: ${turnId}` }) }], isError: true };
  }

  if (status) {
    await ctx.emit("turn_updated", { turnId, title: turn.title, status }, ["architect", "engineer"]);
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ turnId: turn.id, status: turn.status, missionIds: turn.missionIds, taskIds: turn.taskIds }) }],
  };
}

async function getTurn(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const turnId = args.turnId as string;
  const turn = await ctx.stores.turn.getTurn(turnId);
  if (!turn) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Turn not found: ${turnId}` }) }], isError: true };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(turn, null, 2) }],
  };
}

async function listTurns(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const status = args.status as TurnStatus | undefined;
  const turns = await ctx.stores.turn.listTurns(status);
  const page = paginate(turns, args);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ turns: page.items, count: page.count, total: page.total, offset: page.offset, limit: page.limit }, null, 2) }],
  };
}

// ── Registration ────────────────────────────────────────────────────

export function registerTurnPolicy(router: PolicyRouter): void {
  router.register(
    "create_turn",
    "[Architect] Create a new Turn — a high-level execution cycle grouping missions and tasks.",
    {
      title: z.string().describe("Turn title"),
      scope: z.string().describe("Free-text markdown description of the Turn's objectives"),
      tele: z.array(z.string()).optional().describe("Tele IDs — teleological goals for this turn"),
    },
    createTurn,
  );

  router.register(
    "update_turn",
    "[Architect] Update a Turn's status, scope, or tele goals.",
    {
      turnId: z.string().describe("The turn ID to update"),
      status: z.enum(["planning", "active", "completed"]).optional().describe("New status"),
      scope: z.string().optional().describe("Updated scope"),
      tele: z.array(z.string()).optional().describe("Updated tele IDs"),
    },
    updateTurn,
  );

  router.register(
    "get_turn",
    "[Any] Read a specific Turn with all linked missions, tasks, and tele.",
    { turnId: z.string().describe("The turn ID") },
    getTurn,
  );

  router.register(
    "list_turns",
    "[Any] List turns with optional status filter and pagination.",
    {
      status: z.enum(["planning", "active", "completed"]).optional().describe("Filter by status"),
      ...LIST_PAGINATION_SCHEMA,
    },
    listTurns,
  );
}
