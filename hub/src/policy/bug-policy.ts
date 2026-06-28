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
import type { BugStatus, BugSeverity, Bug } from "../entities/bug.js";
import { LIST_PAGINATION_SCHEMA, LIST_COMPACT_SCHEMA, paginate, unsetIfEmpty } from "./list-filters.js";
import { dispatchBugReported, dispatchBugStatusChanged } from "./dispatch-helpers.js";
import { resolveCreatedBy } from "./caller-identity.js";
import { phaseFromEntity } from "../entities/shape-helpers.js";

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
  // bug-118 — lineage: carry the thread/mission this bug was surfaced from so a
  // manually-reported bug isn't an orphan in the lineage graph (the cascade path
  // already carries this via a backlink; the create_bug tool path was blind).
  const sourceThreadId = args.sourceThreadId as string | undefined;
  const sourceMissionId = args.sourceMissionId as string | undefined;
  const repo = args.repo as string | undefined;

  const createdBy = await resolveCreatedBy(ctx);
  const bug = await ctx.stores.bug.createBug(title, description, severity, {
    classHint,
    tags,
    sourceIdeaId,
    surfacedBy,
    createdBy,
    sourceThreadId,
    sourceMissionId,
    repo,
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

/** bug-196: compact scannable projection — lily's fixed field-set; OMITS description /
 *  fixRevision / sourceThreadSummary / lineage so a bulk ledger survey is small. Optionals
 *  are coalesced to null (not undefined) so every compact row has a CONSISTENT key-set —
 *  JSON.stringify drops undefined, which would make rows shape-inconsistent for consumers
 *  (steve's #406 catch). class/repo are already string|null; ?? null is belt-and-suspenders. */
function projectBugCompact(b: Bug) {
  return {
    id: b.id, title: b.title, status: b.status, severity: b.severity,
    class: b.class ?? null, tags: b.tags, fixCommits: b.fixCommits, repo: b.repo ?? null, updatedAt: b.updatedAt,
  };
}

async function listBugs(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  // bug-198: treat adapter-serialized empty optionals ("" / []) as UNSET, not an
  // exact-empty filter that ANDs to zero (the get_bug-overrun root from opencode).
  const status = unsetIfEmpty(args.status as BugStatus | undefined);
  const severity = unsetIfEmpty(args.severity as BugSeverity | undefined);
  const classFilter = unsetIfEmpty(args.class as string | undefined);
  const tags = unsetIfEmpty(args.tags as string[] | undefined);
  const hasFilter = status != null || severity != null || classFilter != null || (tags != null && tags.length > 0);
  const filtered = await ctx.stores.bug.listBugs({ status, severity, class: classFilter, tags });
  // CP2 C5 (task-307): detect "valid filter with zero matches" to fire
  // the _ois_query_unmatched sentinel. Pre-filter count comes from an
  // unfiltered list call ONLY when the filtered result is empty — cheap
  // on the empty path, no cost on the happy path.
  let totalPreFilter = filtered.length;
  if (hasFilter && filtered.length === 0) {
    totalPreFilter = (await ctx.stores.bug.listBugs()).length;
  }
  const page = paginate(filtered, args);
  const queryUnmatched = hasFilter && page.count === 0 && totalPreFilter > 0;
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        bugs: args.compact === true ? page.items.map(projectBugCompact) : page.items,
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
  const repo = args.repo as string | null | undefined;

  // FSM guard on status transitions. mission-89 Phase 4 (bug-137 closure):
  // envelope-shape Bug entity has status as {phase, ...} not string; use
  // phaseFromEntity to coerce both legacy + envelope shapes uniformly.
  if (status !== undefined) {
    const current = await ctx.stores.bug.getBug(bugId);
    if (!current) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: `Bug not found: ${bugId}` }) }],
        isError: true,
      };
    }
    const currentPhase = phaseFromEntity(current);
    if (currentPhase === null) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: `Bug ${bugId} has no readable status; envelope shape may be malformed` }) }],
        isError: true,
      };
    }
    if (currentPhase !== status && !isValidTransition(BUG_FSM, currentPhase as BugStatus, status)) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: `Invalid state transition: cannot move bug from '${currentPhase}' to '${status}'` }) }],
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
  if (repo !== undefined) updates.repo = repo;

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
      sourceThreadId: z.string().optional().describe("Lineage (bug-118): the thread this bug was surfaced from — links the bug into the thread's lineage graph"),
      sourceMissionId: z.string().optional().describe("Lineage (bug-118): the mission this bug relates to — sets the bug's linkedMissionId"),
      repo: z.string().optional().describe("Repo-scope (idea-364): the repo slug this bug belongs to (e.g. apnex/missioncraft); omit = the home repo. Lets the ledger-reconciliation pass scope git-ancestry checks + separate external cross-repo bugs"),
    },
    createBug,
  );

  router.register(
    "list_bugs",
    "[Any] List bugs with optional filters (status, severity, class, tags match-any) + pagination. Pass compact:true for the scannable bulk-survey projection (omits description/fixRevision) — use it instead of many per-bug get_bug calls.",
    {
      status: z.enum(["open", "investigating", "resolved", "wontfix"]).optional(),
      severity: z.enum(["critical", "major", "minor"]).optional(),
      class: z.string().optional().describe("Filter by exact class match"),
      tags: z.array(z.string()).optional().describe("Match-any tag filter"),
      ...LIST_PAGINATION_SCHEMA,
      ...LIST_COMPACT_SCHEMA,
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
    "[Any] Update a bug. Status transitions enforced by BUG_FSM (open → investigating → resolved | wontfix; walk-back investigating → open permitted). Other fields (severity, class, tags, description, linkedTaskIds, linkedMissionId, fixCommits, fixRevision, repo) are freely editable.",
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
      repo: z.string().nullable().optional().describe("Repo-scope (idea-364): the repo slug this bug belongs to (e.g. apnex/missioncraft); null = the home repo. Reclassify cross-repo bugs so they stop accreting in the home-repo reconciliation"),
    },
    updateBug,
  );
}
