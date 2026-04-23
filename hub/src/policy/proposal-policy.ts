/**
 * Proposal Policy — Full lifecycle proposal management with Auto-Scaffolding.
 *
 * Tools: create_proposal, list_proposals, create_proposal_review,
 *        get_proposal, close_proposal
 * FSM: submitted → approved/rejected/changes_requested → implemented
 *
 * Auto-Scaffolding (Tele-2): When a proposal with a `proposedExecutionPlan`
 * is approved, the Hub automatically creates all missions and tasks defined
 * in the plan, resolving local reference IDs to generated entity IDs.
 */

import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import { LIST_PAGINATION_SCHEMA, paginate } from "./list-filters.js";
import type { ProposedExecutionPlan, ScaffoldResult } from "../state.js";
import { callerLabels } from "./labels.js";
import { resolveCreatedBy } from "./caller-identity.js";
import { dispatchProposalSubmitted } from "./dispatch-helpers.js";

// ── Scaffolding ─────────────────────────────────────────────────────

interface ScaffoldContext {
  ctx: IPolicyContext;
  proposalId: string;
  resolutionMap: Map<string, string>;  // idRef → generated ID
  createdMissionIds: string[];
  createdTaskIds: string[];
}

/**
 * Validate the execution plan before creating any entities.
 * Returns an array of error messages, or empty if valid.
 */
function validatePlan(plan: ProposedExecutionPlan): string[] {
  const errors: string[] = [];
  const missionRefs = new Set<string>();
  const taskRefs = new Set<string>();

  // Validate mission idRefs are unique
  for (const m of plan.missions || []) {
    if (!m.idRef || !m.title || !m.description) {
      errors.push(`Mission missing required fields: idRef=${m.idRef}, title=${m.title}`);
    }
    if (missionRefs.has(m.idRef)) {
      errors.push(`Duplicate mission idRef: ${m.idRef}`);
    }
    missionRefs.add(m.idRef);
  }

  // Validate task idRefs are unique and missionRefs resolve
  for (const t of plan.tasks || []) {
    if (!t.idRef || !t.title || !t.description) {
      errors.push(`Task missing required fields: idRef=${t.idRef}, title=${t.title}`);
    }
    if (taskRefs.has(t.idRef)) {
      errors.push(`Duplicate task idRef: ${t.idRef}`);
    }
    taskRefs.add(t.idRef);

    if (t.missionRef && !missionRefs.has(t.missionRef)) {
      errors.push(`Task ${t.idRef} references non-existent mission: ${t.missionRef}`);
    }

    // Validate dependsOn references (local refs must exist in plan)
    for (const dep of t.dependsOn || []) {
      // Local refs must match a task idRef in the plan
      // External refs (e.g., "task-123") are allowed and not validated here
      if (!dep.startsWith("task-") && !taskRefs.has(dep)) {
        // Check if it's a forward reference (task defined later in the array)
        const allTaskRefs = new Set((plan.tasks || []).map(t => t.idRef));
        if (!allTaskRefs.has(dep)) {
          errors.push(`Task ${t.idRef} depends on unknown reference: ${dep}`);
        }
      }
    }
  }

  return errors;
}

/**
 * Execute the scaffolding plan: create all missions and tasks.
 * Returns the scaffold result with resolution map.
 * On failure, rolls back all created entities.
 */
async function scaffoldPlan(
  plan: ProposedExecutionPlan,
  proposalId: string,
  ctx: IPolicyContext
): Promise<{ result: ScaffoldResult; errors: string[] }> {
  const sc: ScaffoldContext = {
    ctx,
    proposalId,
    resolutionMap: new Map(),
    createdMissionIds: [],
    createdTaskIds: [],
  };

  // Mission-19: scaffolded tasks inherit labels from the parent proposal
  // (authoritative source) rather than the approver's caller-labels.
  const parent = await ctx.stores.proposal.getProposal(proposalId);
  const inheritedLabels = parent?.labels ?? {};

  try {
    // Phase 1: Create missions
    for (const m of plan.missions || []) {
      const mission = await ctx.stores.mission.createMission(m.title, m.description);
      sc.resolutionMap.set(m.idRef, mission.id);
      sc.createdMissionIds.push(mission.id);

      // Set correlationId to proposalId (lineage rule)
      await ctx.stores.mission.updateMission(mission.id, { correlationId: proposalId } as any);

      console.log(`[Scaffold] Created mission ${mission.id} (idRef: ${m.idRef})`);
    }

    // Phase 2: Create tasks (after missions, so missionRefs can resolve)
    for (const t of plan.tasks || []) {
      // Resolve correlationId based on lineage rules
      let correlationId: string;
      if (t.missionRef) {
        const missionId = sc.resolutionMap.get(t.missionRef);
        if (!missionId) {
          throw new Error(`Cannot resolve missionRef: ${t.missionRef}`);
        }
        correlationId = missionId;
      } else {
        correlationId = proposalId;
      }

      // Resolve dependsOn: swap local idRefs for generated IDs
      const resolvedDeps: string[] = [];
      for (const dep of t.dependsOn || []) {
        const resolved = sc.resolutionMap.get(dep);
        if (resolved) {
          resolvedDeps.push(resolved);
        } else {
          // Assume external ID (e.g., "task-123")
          resolvedDeps.push(dep);
        }
      }

      const taskId = await ctx.stores.task.submitDirective(
        t.description,
        correlationId,
        undefined, // no idempotency key
        t.title,
        t.description,
        resolvedDeps.length > 0 ? resolvedDeps : undefined,
        inheritedLabels,
      );

      sc.resolutionMap.set(t.idRef, taskId);
      sc.createdTaskIds.push(taskId);

      // Mission linkage is a virtual view over the task store keyed by
      // `correlationId` (see entities/mission.ts). Passing `correlationId`
      // above is sufficient — no explicit link step.

      console.log(`[Scaffold] Created task ${taskId} (idRef: ${t.idRef}, correlationId: ${correlationId})`);
    }

    // Build result
    const result: ScaffoldResult = {
      missions: (plan.missions || []).map(m => ({
        idRef: m.idRef,
        generatedId: sc.resolutionMap.get(m.idRef)!,
      })),
      tasks: (plan.tasks || []).map(t => ({
        idRef: t.idRef,
        generatedId: sc.resolutionMap.get(t.idRef)!,
      })),
    };

    return { result, errors: [] };

  } catch (err) {
    console.error(`[Scaffold] FAILED: ${err}. Rolling back ${sc.createdMissionIds.length} missions, ${sc.createdTaskIds.length} tasks`);

    // Rollback: delete created entities (best-effort)
    const rollbackErrors: string[] = [];
    for (const taskId of sc.createdTaskIds) {
      try {
        await ctx.stores.task.cancelTask(taskId);
      } catch (rollbackErr) {
        rollbackErrors.push(`Failed to rollback task ${taskId}: ${rollbackErr}`);
      }
    }
    // Note: missions don't have a delete/cancel — log orphans for manual cleanup
    if (sc.createdMissionIds.length > 0) {
      rollbackErrors.push(`Orphaned missions (no delete API): ${sc.createdMissionIds.join(", ")}`);
    }

    // Log orphaned entities to audit if rollback fails
    if (rollbackErrors.length > 0) {
      try {
        await ctx.stores.audit.logEntry("hub", "scaffold_rollback_partial", 
          `Scaffold failed for ${proposalId}. Rollback issues: ${rollbackErrors.join("; ")}`,
          proposalId
        );
      } catch {
        // Best-effort audit logging
      }
    }

    return { result: { missions: [], tasks: [] }, errors: [`Scaffold failed: ${err}`, ...rollbackErrors] };
  }
}

// ── Handlers ────────────────────────────────────────────────────────

async function createProposal(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const title = args.title as string;
  const summary = args.summary as string;
  const body = args.body as string;
  const correlationId = args.correlationId as string | undefined;
  const executionPlan = args.proposedExecutionPlan as ProposedExecutionPlan | undefined;

  // Validate execution plan if provided
  if (executionPlan) {
    const planErrors = validatePlan(executionPlan);
    if (planErrors.length > 0) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "Invalid execution plan", details: planErrors }) }],
        isError: true,
      };
    }
  }

  // Mission-19: propagate caller's Agent labels onto the new Proposal.
  const labels = await callerLabels(ctx);
  const createdBy = await resolveCreatedBy(ctx);
  const proposal = await ctx.stores.proposal.submitProposal(title, summary, body, correlationId, executionPlan, labels, undefined, createdBy);

  // Uses the shared helper so the cascade path (cascade-actions/
  // create-proposal.ts) fires an identically-shaped event.
  await dispatchProposalSubmitted(ctx, proposal, labels, !!executionPlan);

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        proposalId: proposal.id,
        title: proposal.title,
        summary: proposal.summary,
        proposalRef: proposal.proposalRef,
        status: proposal.status,
        hasExecutionPlan: !!executionPlan,
      }),
    }],
  };
}

async function listProposals(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const status = args.status as string | undefined;
  const hasFilter = status != null;
  // Fetch full collection so `_ois_query_unmatched` can compare pre- vs
  // post-filter counts. CP2 C5 (task-307).
  const all = await ctx.stores.proposal.getProposals();
  const totalPreFilter = all.length;
  const filtered = hasFilter ? all.filter((p) => p.status === status) : all;
  const page = paginate(filtered, args);
  const queryUnmatched = hasFilter && page.count === 0 && totalPreFilter > 0;
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        proposals: page.items,
        count: page.count,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        ...(queryUnmatched ? { _ois_query_unmatched: true } : {}),
      }, null, 2),
    }],
  };
}

async function createProposalReview(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const proposalId = args.proposalId as string;
  const decision = args.decision as string;
  const feedback = args.feedback as string;

  // Get the proposal to check for execution plan
  const proposal = await ctx.stores.proposal.getProposal(proposalId);
  if (!proposal) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `Proposal ${proposalId} not found` }) }],
      isError: true,
    };
  }

  // INV-P2 (workflow-registry §7.2): only `submitted` proposals are
  // reviewable. Pre-mission-41 this guard was missing (spec-runtime
  // divergence surfaced by the T2 `assertInvP2` gap-surfacing ratchet).
  // Mission-41 Wave 2 T3 (task-331) bundled fix + test.
  if (proposal.status !== "submitted") {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          success: false,
          error: `Invalid state transition: cannot review proposal in '${proposal.status}' state (must be 'submitted')`,
        }),
      }],
      isError: true,
    };
  }

  const success = await ctx.stores.proposal.reviewProposal(proposalId, decision as any, feedback);
  if (!success) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `Proposal ${proposalId} review failed` }) }],
      isError: true,
    };
  }

  // Auto-Scaffolding: if approved and has execution plan, scaffold it
  let scaffoldData: ScaffoldResult | null = null;
  let scaffoldErrors: string[] = [];

  if (decision === "approved" && proposal.executionPlan) {
    console.log(`[ProposalPolicy] Auto-scaffolding execution plan for ${proposalId}`);
    const scaffoldOutcome = await scaffoldPlan(proposal.executionPlan, proposalId, ctx);
    scaffoldData = scaffoldOutcome.result;
    scaffoldErrors = scaffoldOutcome.errors;

    if (scaffoldErrors.length > 0) {
      // Scaffolding failed — revert the approval
      await ctx.stores.proposal.reviewProposal(proposalId, "submitted" as any, 
        `Auto-scaffold failed. Original feedback: ${feedback}. Errors: ${scaffoldErrors.join("; ")}`
      );

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: "Proposal approved but auto-scaffolding failed. Proposal reverted to submitted.",
            scaffoldErrors,
          }),
        }],
        isError: true,
      };
    }

    // Store the scaffold result on the proposal
    await ctx.stores.proposal.setScaffoldResult(proposalId, scaffoldData);

    // Emit task_issued for each created task that is pending (not blocked)
    for (const t of scaffoldData.tasks) {
      const task = await ctx.stores.task.getTask(t.generatedId);
      if (task && task.status === "pending") {
        await ctx.dispatch("task_issued", {
          taskId: t.generatedId,
          directive: (task.description || task.title || "").substring(0, 200),
          correlationId: task.correlationId,
        }, { roles: ["engineer"], matchLabels: task.labels });
      }
    }
  }

  await ctx.dispatch("proposal_decided", {
    proposalId,
    decision,
    feedback: feedback.substring(0, 200),
    scaffolded: !!scaffoldData,
    scaffoldedMissions: scaffoldData?.missions.length || 0,
    scaffoldedTasks: scaffoldData?.tasks.length || 0,
  }, { roles: ["engineer"], matchLabels: proposal.labels });

  const response: Record<string, unknown> = {
    success: true,
    proposalId,
    decision,
    feedback,
  };

  if (scaffoldData) {
    response.scaffolded = true;
    response.scaffoldResult = scaffoldData;
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify(response) }],
  };
}

async function getProposal(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const proposalId = args.proposalId as string;

  const proposal = await ctx.stores.proposal.getProposal(proposalId);
  if (!proposal) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: `Proposal ${proposalId} not found` }) }],
      isError: true,
    };
  }

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        proposalId: proposal.id,
        title: proposal.title,
        status: proposal.status,
        decision: proposal.decision,
        feedback: proposal.feedback,
        proposalRef: proposal.proposalRef,
        hasExecutionPlan: !!proposal.executionPlan,
        scaffoldResult: proposal.scaffoldResult,
      }),
    }],
  };
}

async function closeProposal(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const proposalId = args.proposalId as string;

  const success = await ctx.stores.proposal.closeProposal(proposalId);
  if (!success) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `Proposal ${proposalId} not found or not in a reviewable state` }) }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ success: true, proposalId, status: "implemented" }) }],
  };
}

// ── Zod Schemas ─────────────────────────────────────────────────────

const executionPlanMissionSchema = z.object({
  idRef: z.string().describe("Local reference ID for this mission (e.g., 'm1')"),
  title: z.string().describe("Mission title"),
  description: z.string().describe("Mission description"),
});

const executionPlanTaskSchema = z.object({
  idRef: z.string().describe("Local reference ID for this task (e.g., 't1')"),
  missionRef: z.string().optional().describe("Local reference to a mission in this plan (e.g., 'm1')"),
  title: z.string().describe("Task title"),
  description: z.string().describe("Task description"),
  dependsOn: z.array(z.string()).optional().describe("Dependencies: local idRefs (e.g., 't1') or external task IDs (e.g., 'task-123')"),
});

const executionPlanSchema = z.object({
  missions: z.array(executionPlanMissionSchema).optional().describe("Missions to create"),
  tasks: z.array(executionPlanTaskSchema).optional().describe("Tasks to create"),
}).optional().describe("Optional structured execution plan. If provided, entities are automatically created when the proposal is approved.");

// ── Registration ────────────────────────────────────────────────────

export function registerProposalPolicy(router: PolicyRouter): void {
  router.register(
    "create_proposal",
    "[Engineer] Submit a proposal for the Architect to review. Returns the proposal ID and reference path. The Architect will be notified via webhook.",
    {
      title: z.string().describe("Short title for the proposal"),
      summary: z.string().describe("1-2 sentence summary of what is being proposed"),
      body: z.string().describe("Full proposal text (Markdown supported)"),
      correlationId: z.string().optional().describe("Optional correlation ID to link this proposal to related tasks/threads"),
      proposedExecutionPlan: executionPlanSchema,
    },
    createProposal,
  );

  router.register(
    "list_proposals",
    "[Any] List proposals with optional status filter and pagination.",
    {
      status: z.enum(["submitted", "approved", "rejected", "changes_requested", "implemented"]).optional().describe("Filter proposals by status (optional)"),
      ...LIST_PAGINATION_SCHEMA,
    },
    listProposals,
  );

  router.register(
    "create_proposal_review",
    "[Architect] Review a proposal and provide a decision. Called by the Architect. If the proposal has a proposedExecutionPlan and the decision is 'approved', the Hub automatically scaffolds all missions and tasks.",
    {
      proposalId: z.string().describe("The proposal ID to review"),
      decision: z.enum(["approved", "rejected", "changes_requested"]).describe("The review decision"),
      feedback: z.string().describe("Feedback or rationale for the decision"),
    },
    createProposalReview,
  );

  router.register(
    "get_proposal",
    "[Engineer] Check the Architect's decision on a specific proposal. Returns the proposal status, decision, and feedback.",
    {
      proposalId: z.string().describe("The proposal ID to check"),
    },
    getProposal,
  );

  router.register(
    "close_proposal",
    "[Engineer] Mark a proposal as implemented/closed after acting on the Architect's decision.",
    {
      proposalId: z.string().describe("The proposal ID to close"),
    },
    closeProposal,
  );
}
