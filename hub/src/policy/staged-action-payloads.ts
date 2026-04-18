/**
 * Mission-24 Phase 2 (ADR-014): Zod schemas for the 8 autonomous
 * StagedAction payload shapes.
 *
 * Usage:
 * - The per-action validators (M24-T2) import these to validate staged
 *   payloads at the cascade gate (INV-TH19 validate-then-execute).
 * - The per-action cascade handlers (M24-T3) import the corresponding
 *   TypeScript payload interfaces from `../state.js` for spawned-entity
 *   construction; the Zod schemas exist to assert the shape before the
 *   handler runs.
 * - The `create_thread_reply` tool surface in `thread-policy.ts` uses
 *   `STAGED_ACTION_STAGE_OP_SCHEMA` to validate stage ops from callers.
 *
 * Scope of this file: schema plumbing only. No handler logic; no
 * behaviour changes at the tool surface (the tool-surface enum in
 * thread-policy.ts stays Phase-1-restricted until the handler task
 * widens it together with the per-action handlers landing).
 */

import { z } from "zod";

// ── Per-action payload schemas ──────────────────────────────────────

/** close_no_action { reason } — Phase 1 retained. */
export const CloseNoActionPayloadSchema = z.object({
  reason: z.string().describe("Why the thread is concluding with no entity-creation action"),
});

/** create_task { title, description, correlationId? } */
export const CreateTaskActionPayloadSchema = z.object({
  title: z.string().describe("Short title for the spawned Task"),
  description: z.string().describe("Directive body"),
  correlationId: z.string().optional().describe("Optional correlation ID linking the task to related entities"),
});

/** create_proposal { title, description, correlationId? } */
export const CreateProposalActionPayloadSchema = z.object({
  title: z.string().describe("Short title for the Proposal"),
  description: z.string().describe("Proposal body"),
  correlationId: z.string().optional().describe("Optional correlation ID"),
});

/** create_idea { title, description, tags? } */
export const CreateIdeaActionPayloadSchema = z.object({
  title: z.string().describe("Short title for the Idea"),
  description: z.string().describe("Idea body"),
  tags: z.array(z.string()).optional().describe("Optional tags for categorization"),
});

/** update_idea { ideaId, changes } — changes kept permissive; tightened
 * in the validator task once the Idea schema's mutable-field set is
 * nailed down. */
export const UpdateIdeaActionPayloadSchema = z.object({
  ideaId: z.string().describe("Target Idea ID (e.g., 'idea-85')"),
  changes: z.record(z.string(), z.unknown()).describe("Partial update map over the Idea's mutable fields"),
});

/** update_mission_status { missionId, status } — status transitions
 * only (e.g. active→paused). Scope-widening edits (goal/description)
 * require Director via a separate Director-gated action (ADR-014). */
export const UpdateMissionStatusActionPayloadSchema = z.object({
  missionId: z.string().describe("Target Mission ID"),
  status: z.string().describe("Target status value — validated against MissionStatus enum in the validator task"),
});

/** propose_mission { title, description, goals } — creates Mission in
 * `draft`; Director approves to activate. Distinct from Director-gated
 * `create_mission` which bypasses draft. */
export const ProposeMissionActionPayloadSchema = z.object({
  title: z.string().describe("Short title for the proposed Mission"),
  description: z.string().describe("Mission description / scope"),
  goals: z.array(z.string()).describe("Ordered goal statements"),
});

/** create_clarification { question, context } */
export const CreateClarificationActionPayloadSchema = z.object({
  question: z.string().describe("Clarification question for the Director / Architect"),
  context: z.string().describe("Surrounding context the responder needs to answer"),
});

// ── Registry: type → payload schema ─────────────────────────────────

/**
 * Lookup table keyed on StagedActionType. Validators iterate
 * committed actions and resolve the schema here to run a
 * per-action safeParse before the cascade fires.
 */
export const STAGED_ACTION_PAYLOAD_SCHEMAS = {
  close_no_action: CloseNoActionPayloadSchema,
  create_task: CreateTaskActionPayloadSchema,
  create_proposal: CreateProposalActionPayloadSchema,
  create_idea: CreateIdeaActionPayloadSchema,
  update_idea: UpdateIdeaActionPayloadSchema,
  update_mission_status: UpdateMissionStatusActionPayloadSchema,
  propose_mission: ProposeMissionActionPayloadSchema,
  create_clarification: CreateClarificationActionPayloadSchema,
} as const;

// ── Discriminated-union schemas for stage ops ───────────────────────

/**
 * Full Phase 2 stage-op schema, discriminated on `type`. Pairs each
 * action type with its matched payload schema — the caller cannot
 * stage a mismatched (type, payload) combination.
 *
 * NOT wired into `create_thread_reply` yet. The tool surface there
 * still uses the Phase 1 narrow schema until the handler task
 * (M24-T-later) widens the tool vocabulary together with landing
 * per-type handlers. Exported here so the validator task can consume
 * it directly.
 */
export const STAGED_ACTION_STAGE_OP_SCHEMA = z.discriminatedUnion("type", [
  z.object({ kind: z.literal("stage"), type: z.literal("close_no_action"), payload: CloseNoActionPayloadSchema }),
  z.object({ kind: z.literal("stage"), type: z.literal("create_task"), payload: CreateTaskActionPayloadSchema }),
  z.object({ kind: z.literal("stage"), type: z.literal("create_proposal"), payload: CreateProposalActionPayloadSchema }),
  z.object({ kind: z.literal("stage"), type: z.literal("create_idea"), payload: CreateIdeaActionPayloadSchema }),
  z.object({ kind: z.literal("stage"), type: z.literal("update_idea"), payload: UpdateIdeaActionPayloadSchema }),
  z.object({ kind: z.literal("stage"), type: z.literal("update_mission_status"), payload: UpdateMissionStatusActionPayloadSchema }),
  z.object({ kind: z.literal("stage"), type: z.literal("propose_mission"), payload: ProposeMissionActionPayloadSchema }),
  z.object({ kind: z.literal("stage"), type: z.literal("create_clarification"), payload: CreateClarificationActionPayloadSchema }),
]);

/** Enum of all autonomous (convergence-spawnable) action types. */
export const AUTONOMOUS_STAGED_ACTION_TYPES = [
  "close_no_action",
  "create_task",
  "create_proposal",
  "create_idea",
  "update_idea",
  "update_mission_status",
  "propose_mission",
  "create_clarification",
] as const;
