/**
 * Audit Policy — Append-only audit log.
 *
 * Tools: create_audit_entry, list_audit_entries
 * No FSM — entries are immutable once created.
 */

import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import { LIST_PAGINATION_SCHEMA, MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT, paginate } from "./list-filters.js";

// ── Handlers ────────────────────────────────────────────────────────

async function createAuditEntry(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const action = args.action as string;
  const details = args.details as string;
  const relatedEntity = args.relatedEntity as string | undefined;

  // Derive actor from session role — not hardcoded. mission-93: verifier
  // entries attribute to 'verifier' (NOT silently to 'architect') — the
  // audit-entry IS the verifier's verdict surface (verifier-role.md §2.3), so
  // mis-attributing it to architect would defeat the independent-verifier point.
  const role = ctx.stores.engineerRegistry.getRole(ctx.sessionId);
  const actor =
    role === "engineer" || role === "architect" || role === "verifier" ? role : "architect";
  const entry = await ctx.stores.audit.logEntry(actor, action, details, relatedEntity);
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        success: true,
        auditId: entry.id,
        timestamp: entry.timestamp,
      }),
    }],
  };
}

async function listAuditEntries(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  // Audit listing takes a store-level `limit` that caps the number of
  // entries loaded from GCS (default 50). The shared paginator then
  // applies offset/limit to the loaded slice. Request a larger store-
  // level cap when a caller wants to page deeper.
  const storeCap = Math.min(MAX_LIST_LIMIT, (args.limit as number) ?? DEFAULT_LIST_LIMIT);
  const actor = args.actor as string | undefined;
  const hasFilter = actor != null;
  // mission-93: 'verifier' is a first-class audit actor (the verifier's
  // verdicts are logged with actor='verifier') — so it must be a queryable
  // filter value, not just a writable one. (#338 widened the WRITE enums;
  // this is the sibling READ/filter site, caught by the verifier RBAC e2e.)
  const entries = await ctx.stores.audit.listEntries(storeCap, actor as "architect" | "engineer" | "verifier" | "hub" | undefined);
  // CP2 C5 (task-307): sentinel for "valid filter with zero matches".
  // When the filtered window is empty, probe the unfiltered window at
  // the same cap to distinguish from truly-empty.
  let totalPreFilter = entries.length;
  if (hasFilter && entries.length === 0) {
    totalPreFilter = (await ctx.stores.audit.listEntries(storeCap)).length;
  }
  const page = paginate(entries, args);
  const queryUnmatched = hasFilter && page.count === 0 && totalPreFilter > 0;
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        entries: page.items,
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

export function registerAuditPolicy(router: PolicyRouter): void {
  router.register(
    "create_audit_entry",
    "[Architect|Verifier] Log an audit entry recording an autonomous action taken by the Architect, OR an independent verification check by the Verifier (mission-93 — the verifier's durable verdict-record surface; advisory, not gating). Persisted for Director oversight. Every autonomous decision should be audited.",
    {
      action: z.string().describe("Short action name (e.g., 'auto_review', 'auto_clarification', 'task_issued')"),
      details: z.string().describe("Description of what was done and why"),
      relatedEntity: z.string().optional().describe("Related entity ID (e.g., 'task-24', 'prop-7', 'thread-3')"),
    },
    createAuditEntry,
  );

  router.register(
    "list_audit_entries",
    "[Any] List audit entries with optional actor filter and pagination. Returns most recent first.",
    {
      actor: z.enum(["architect", "engineer", "verifier", "hub"]).optional().describe("Filter by actor (optional). 'verifier' surfaces the verifier's logged verdicts (mission-93)."),
      ...LIST_PAGINATION_SCHEMA,
    },
    listAuditEntries,
  );
}
