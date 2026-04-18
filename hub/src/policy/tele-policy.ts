/**
 * Tele Policy — Teleological goal definitions (immutable).
 *
 * Tools: create_tele, get_tele, list_tele
 * No FSM — Tele are immutable once created.
 */

import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import { LIST_PAGINATION_SCHEMA, paginate } from "./list-filters.js";

// ── Handlers ────────────────────────────────────────────────────────

async function createTele(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const name = args.name as string;
  const description = args.description as string;
  const successCriteria = args.successCriteria as string;

  const tele = await ctx.stores.tele.defineTele(name, description, successCriteria);

  await ctx.emit("tele_defined", {
    teleId: tele.id,
    name,
  }, ["architect", "engineer"]);

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ teleId: tele.id, name: tele.name }) }],
  };
}

async function getTele(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const teleId = args.teleId as string;
  const tele = await ctx.stores.tele.getTele(teleId);
  if (!tele) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Tele not found: ${teleId}` }) }], isError: true };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(tele, null, 2) }],
  };
}

async function listTele(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const teles = await ctx.stores.tele.listTele();
  const page = paginate(teles, args);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ tele: page.items, count: page.count, total: page.total, offset: page.offset, limit: page.limit }, null, 2) }],
  };
}

// ── Registration ────────────────────────────────────────────────────

export function registerTelePolicy(router: PolicyRouter): void {
  router.register(
    "create_tele",
    "[Architect] Define a new Tele — a declaration of perfection / qualitative asymptote. Immutable once created.",
    {
      name: z.string().describe("Short name (e.g., 'Absolute State Fidelity')"),
      description: z.string().describe("What this tele represents"),
      successCriteria: z.string().describe("Markdown describing the measurable target for this teleological goal"),
    },
    createTele,
  );

  router.register(
    "get_tele",
    "[Any] Read a specific Tele definition.",
    { teleId: z.string().describe("The tele ID") },
    getTele,
  );

  router.register(
    "list_tele",
    "[Any] List all defined Tele (teleological goals) with pagination.",
    {
      ...LIST_PAGINATION_SCHEMA,
    },
    listTele,
  );
}
