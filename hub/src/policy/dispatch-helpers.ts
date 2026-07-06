/**
 * Shared policy-layer dispatch helpers (Mission-24 cascade-parity).
 *
 * Both the direct-tool handlers (task-policy.ts, proposal-policy.ts,
 * idea-policy.ts, mission-policy.ts) and the cascade handlers
 * (policy/cascade-actions/*.ts) need to fire the same SSE event when
 * they spawn or transition an entity. Placing the dispatch inline in
 * each handler led to drift — the Phase 2 cascade-action handlers in
 * M24-T5/T9 correctly persisted the entity but silently skipped the
 * ctx.dispatch call the direct-tool handler fires, so subscribers
 * missed every cascade-spawned entity notification (surfaced 2026-04-18
 * when an engineer had to poll get_task for a cascade-spawned task).
 *
 * These helpers centralise the dispatch shape per entity so both
 * paths emit identical events. Direct and cascade handlers both
 * invoke the helper; the store call itself stays untouched (stores
 * are infrastructure and have no dispatch channel).
 */

import type { IPolicyContext } from "./types.js";
import type { Proposal } from "../state.js";
import type { Idea } from "../entities/idea.js";
import type { Mission } from "../entities/mission.js";
import type { Bug } from "../entities/bug.js";

/**
 * Fire `proposal_submitted` to architects matching the proposal's
 * label scope. Mirrors the dispatch at proposal-policy.ts:submitProposal.
 */
export async function dispatchProposalSubmitted(
  ctx: IPolicyContext,
  proposal: Proposal,
  labels: Record<string, string>,
  hasExecutionPlan: boolean = false,
): Promise<void> {
  await ctx.dispatch("proposal_submitted", {
    proposalId: proposal.id,
    title: proposal.title,
    summary: proposal.summary,
    proposalRef: proposal.proposalRef,
    hasExecutionPlan,
  }, { roles: ["architect"], matchLabels: labels });
}

/**
 * Fire `idea_submitted` to both roles. Matches the legacy emit shape
 * in idea-policy.ts:createIdea (role-list based, not label-scoped).
 */
export async function dispatchIdeaSubmitted(
  ctx: IPolicyContext,
  idea: Idea,
  authorRole: string,
): Promise<void> {
  await ctx.emit("idea_submitted", {
    ideaId: idea.id,
    text: idea.text.substring(0, 200),
    author: authorRole,
  }, ["architect", "engineer"]);
}

/**
 * Fire `mission_created` to both roles. Matches mission-policy.ts:createMission.
 */
export async function dispatchMissionCreated(
  ctx: IPolicyContext,
  mission: Mission,
): Promise<void> {
  await ctx.emit("mission_created", {
    missionId: mission.id,
    title: mission.title,
  }, ["architect", "engineer"]);
}

/**
 * Fire `mission_activated` when a mission transitions to `active`.
 * Matches mission-policy.ts:updateMission — only the proposed→active
 * edge fires; other transitions (active→completed, etc.) are silent
 * today (follow-up if listeners for those transitions emerge).
 */
export async function dispatchMissionActivated(
  ctx: IPolicyContext,
  mission: Mission,
): Promise<void> {
  await ctx.emit("mission_activated", {
    missionId: mission.id,
    title: mission.title,
  }, ["architect", "engineer"]);
}

/**
 * Fire `bug_reported` to both roles on new Bug creation.
 * M-Cascade-Perfection Phase 2 / ADR-015.
 */
export async function dispatchBugReported(
  ctx: IPolicyContext,
  bug: Bug,
): Promise<void> {
  await ctx.emit("bug_reported", {
    bugId: bug.id,
    title: bug.title,
    severity: bug.severity,
    class: bug.class,
  }, ["architect", "engineer"]);
}

/**
 * Fire `bug_status_changed` on Bug FSM transitions. Consumers that
 * need finer grain (e.g., only on "resolved") can filter by `status`.
 */
export async function dispatchBugStatusChanged(
  ctx: IPolicyContext,
  bug: Bug,
): Promise<void> {
  await ctx.emit("bug_status_changed", {
    bugId: bug.id,
    title: bug.title,
    status: bug.status,
    severity: bug.severity,
  }, ["architect", "engineer"]);
}
