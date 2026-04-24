/**
 * Tele Policy — Teleological goal definitions with lifecycle primitives.
 *
 * Tools: create_tele, get_tele, list_tele, supersede_tele, retire_tele
 *
 * Content remains immutable after creation. Mission-43 added supersede +
 * retire as dedicated lifecycle transitions (status field mutates; body
 * fields do not). Role labels are advisory — enforcement is idea-121
 * tool-surface v2.0 territory.
 */

import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import { LIST_PAGINATION_SCHEMA, paginate } from "./list-filters.js";
import { resolveCreatedBy } from "./caller-identity.js";

// ── Handlers ────────────────────────────────────────────────────────

async function createTele(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const name = args.name as string;
  const description = args.description as string;
  const successCriteria = args.successCriteria as string;

  const createdBy = await resolveCreatedBy(ctx);
  const tele = await ctx.stores.tele.defineTele(name, description, successCriteria, createdBy);

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
  const includeSuperseded = (args.includeSuperseded as boolean | undefined) ?? false;
  const includeRetired = (args.includeRetired as boolean | undefined) ?? false;

  const all = await ctx.stores.tele.listTele();
  const filtered = all.filter((t) => {
    if (t.status === "superseded") return includeSuperseded;
    if (t.status === "retired") return includeRetired;
    return true; // active
  });

  const page = paginate(filtered, args);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ tele: page.items, count: page.count, total: page.total, offset: page.offset, limit: page.limit }, null, 2) }],
  };
}

async function supersedeTele(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const teleId = args.teleId as string;
  const successorId = args.successorId as string;
  try {
    const tele = await ctx.stores.tele.supersedeTele(teleId, successorId);
    await ctx.emit("tele_superseded", {
      teleId,
      successorId,
    }, ["architect", "engineer"]);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ teleId: tele.id, status: tele.status, supersededBy: tele.supersededBy }) }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }], isError: true };
  }
}

async function retireTele(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const teleId = args.teleId as string;
  try {
    const tele = await ctx.stores.tele.retireTele(teleId);
    await ctx.emit("tele_retired", {
      teleId,
      retiredAt: tele.retiredAt,
    }, ["architect", "engineer"]);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ teleId: tele.id, status: tele.status, retiredAt: tele.retiredAt }) }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }], isError: true };
  }
}

// ── Registration ────────────────────────────────────────────────────

export function registerTelePolicy(router: PolicyRouter): void {
  router.register(
    "create_tele",
    "[Architect] Define a new Tele — a declaration of perfection / qualitative asymptote. Content immutable once created; lifecycle state mutates via supersede_tele / retire_tele.",
    {
      name: z.string().describe("Short name (e.g., 'Absolute State Fidelity')"),
      description: z.string().describe("What this tele represents"),
      successCriteria: z.string().describe("Markdown describing the measurable target for this teleological goal"),
    },
    createTele,
  );

  router.register(
    "get_tele",
    "[Any] Read a specific Tele definition (returns all lifecycle states; no status filter).",
    { teleId: z.string().describe("The tele ID") },
    getTele,
  );

  router.register(
    "list_tele",
    "[Any] List defined Tele with pagination. Default excludes `superseded` + `retired` — opt-in via `includeSuperseded: true` / `includeRetired: true` for audit / lineage queries.",
    {
      ...LIST_PAGINATION_SCHEMA,
      includeSuperseded: z.boolean().optional()
        .describe("Include `status: \"superseded\"` teles in results (default false)."),
      includeRetired: z.boolean().optional()
        .describe("Include `status: \"retired\"` teles in results (default false)."),
    },
    listTele,
  );

  router.register(
    "supersede_tele",
    "[Architect] Mark a tele as superseded by a successor tele. Preserves the superseded entity for lineage queries (opt-in via list_tele includeSuperseded). Successor must already exist. Retired teles cannot be superseded.",
    {
      teleId: z.string().describe("The tele ID to supersede"),
      successorId: z.string().describe("The successor tele ID — must already exist"),
    },
    supersedeTele,
  );

  router.register(
    "retire_tele",
    "[Architect] Mark a tele as retired. Terminal state — retired teles cannot be un-retired or subsequently superseded. Preserved for audit queries via list_tele includeRetired.",
    {
      teleId: z.string().describe("The tele ID to retire"),
    },
    retireTele,
  );
}
