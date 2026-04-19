/**
 * Bug Policy — defect tracking lifecycle (M-Cascade-Perfection Phase 2,
 * ADR-015, idea-16 closure).
 *
 * Tools: create_bug, list_bugs, get_bug, update_bug
 * FSM:   open → investigating → resolved | wontfix
 *        resolved / wontfix are terminal (re-open via new Bug record
 *        with sourceBugId — out of scope for v1)
 */

import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult, FsmTransitionTable } from "./types.js";
import { isValidTransition } from "./types.js";
import type { BugStatus, BugSeverity } from "../entities/bug.js";
import { LIST_PAGINATION_SCHEMA, paginate } from "./list-filters.js";
import { dispatchBugReported, dispatchBugStatusChanged } from "./dispatch-helpers.js";

// ── FSM ─────────────────────────────────────────────────────────────

export const BUG_FSM: FsmTransitionTable = [
  { from: "open", to: "investigating" },
  { from: "open", to: "resolved" },
  { from: "open", to: "wontfix" },
  { from: "investigating", to: "resolved" },
  { from: "investigating", to: "wontfix" },
  { from: "investigating", to: "open" }, // allow walk-back if diagnosis discovers re-open conditions
];

// ── Handlers ────────────────────────────────────────────────────────

async function createBug(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const title = args.title as string;
  const description = args.description as string;
  const severity = (args.severity as BugSeverity | undefined) ?? "minor";
  const classHint = args.class as string | undefined;
  const tags = args.tags as string[] | undefined;
  const surfacedBy = args.surfacedBy as string | undefined;
  const sourceIdeaId = args.sourceIdeaId as string | undefined;

  const bug = await ctx.stores.bug.createBug(title, description, severity, {
    classHint,
    tags,
    sourceIdeaId,
    surfacedBy,
  });

  // Uses the shared helper so the cascade path (cascade-actions/
  // create-bug.ts) fires an identically-shaped event.
  await dispatchBugReported(ctx, bug);

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        bugId: bug.id,
        status: bug.status,
        severity: bug.severity,
      }),
    }],
  };
}

async function listBugs(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const status = args.status as BugStatus | undefined;
  const severity = args.severity as BugSeverity | undefined;
  const classFilter = args.class as string | undefined;
  const tags = args.tags as string[] | undefined;
  const bugs = await ctx.stores.bug.listBugs({ status, severity, class: classFilter, tags });
  const page = paginate(bugs, args);
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ bugs: page.items, count: page.count, total: page.total, offset: page.offset, limit: page.limit }, null, 2),
    }],
  };
}

async function getBug(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const bugId = args.bugId as string;
  const bug = await ctx.stores.bug.getBug(bugId);
  if (!bug) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: `Bug not found: ${bugId}` }) }],
      isError: true,
    };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(bug, null, 2) }],
  };
}

async function updateBug(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const bugId = args.bugId as string;
  const status = args.status as BugStatus | undefined;
  const severity = args.severity as BugSeverity | undefined;
  const classHint = args.class;
  const tags = args.tags as string[] | undefined;
  const description = args.description as string | undefined;
  const linkedTaskIds = args.linkedTaskIds as string[] | undefined;
  const linkedMissionId = args.linkedMissionId as string | null | undefined;
  const fixCommits = args.fixCommits as string[] | undefined;
  const fixRevision = args.fixRevision as string | null | undefined;

  // FSM guard on status transitions
  if (status !== undefined) {
    const current = await ctx.stores.bug.getBug(bugId);
    if (!current) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: `Bug not found: ${bugId}` }) }],
        isError: true,
      };
    }
    if (current.status !== status && !isValidTransition(BUG_FSM, current.status, status)) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: `Invalid state transition: cannot move bug from '${current.status}' to '${status}'` }) }],
        isError: true,
      };
    }
  }

  const updates: Record<string, unknown> = {};
  if (status !== undefined) updates.status = status;
  if (severity !== undefined) updates.severity = severity;
  if (classHint !== undefined) updates.class = classHint;
  if (tags !== undefined) updates.tags = tags;
  if (description !== undefined) updates.description = description;
  if (linkedTaskIds !== undefined) updates.linkedTaskIds = linkedTaskIds;
  if (linkedMissionId !== undefined) updates.linkedMissionId = linkedMissionId;
  if (fixCommits !== undefined) updates.fixCommits = fixCommits;
  if (fixRevision !== undefined) updates.fixRevision = fixRevision;

  const bug = await ctx.stores.bug.updateBug(bugId, updates);
  if (!bug) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: `Bug not found: ${bugId}` }) }],
      isError: true,
    };
  }

  // Fire status-change event on meaningful transitions (not on
  // metadata-only updates like adding fixCommits).
  if (status !== undefined) {
    await dispatchBugStatusChanged(ctx, bug);
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ bugId: bug.id, status: bug.status, severity: bug.severity }) }],
  };
}

// ── Registration ────────────────────────────────────────────────────

export function registerBugPolicy(router: PolicyRouter): void {
  router.register(
    "create_bug",
    "[Any] Report a new Bug — defect, regression, or resilience issue distinct from Idea (feature/enhancement). Lifecycle: open → investigating → resolved | wontfix. Severity: critical | major | minor. `class` is a free-text root-cause taxonomy (drift | race | cognitive | identity-resolution | dedup | schema-validation-gap | missing-feature | ...); `tags` are open-ended (component/subsystem/mission/discovery-channel). M-Cascade-Perfection Phase 2 / ADR-015.",
    {
      title: z.string().describe("Short title for the bug"),
      description: z.string().describe("Full description including reproduction steps"),
      severity: z.enum(["critical", "major", "minor"]).optional().describe("Severity (default: minor)"),
      class: z.string().optional().describe("Free-text root-cause class (e.g., drift, race, cognitive)"),
      tags: z.array(z.string()).optional().describe("Open-ended categorization tags"),
      surfacedBy: z.string().optional().describe("Discovery channel: itw-smoke | unit-test | prod-audit | integration-test | code-review | llm-self-review"),
      sourceIdeaId: z.string().optional().describe("For bugs migrated from bug-tagged Ideas — links back to the source idea"),
    },
    createBug,
  );

  router.register(
    "list_bugs",
    "[Any] List bugs with optional filters (status, severity, class, tags match-any) + pagination.",
    {
      status: z.enum(["open", "investigating", "resolved", "wontfix"]).optional(),
      severity: z.enum(["critical", "major", "minor"]).optional(),
      class: z.string().optional().describe("Filter by exact class match"),
      tags: z.array(z.string()).optional().describe("Match-any tag filter"),
      ...LIST_PAGINATION_SCHEMA,
    },
    listBugs,
  );

  router.register(
    "get_bug",
    "[Any] Retrieve a bug by id.",
    { bugId: z.string().describe("The bug ID to retrieve") },
    getBug,
  );

  router.register(
    "update_bug",
    "[Any] Update a bug. Status transitions enforced by BUG_FSM (open → investigating → resolved | wontfix; walk-back investigating → open permitted). Other fields (severity, class, tags, description, linkedTaskIds, linkedMissionId, fixCommits, fixRevision) are freely editable.",
    {
      bugId: z.string().describe("The bug ID to update"),
      status: z.enum(["open", "investigating", "resolved", "wontfix"]).optional(),
      severity: z.enum(["critical", "major", "minor"]).optional(),
      class: z.string().nullable().optional(),
      tags: z.array(z.string()).optional(),
      description: z.string().optional(),
      linkedTaskIds: z.array(z.string()).optional().describe("Task IDs that track fix work"),
      linkedMissionId: z.string().nullable().optional().describe("Parent mission if applicable"),
      fixCommits: z.array(z.string()).optional().describe("Commit SHAs that closed this bug"),
      fixRevision: z.string().nullable().optional().describe("Deployment revision where the fix landed"),
    },
    updateBug,
  );
}
