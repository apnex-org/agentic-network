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

/** create_bug { title, description, severity?, class?, tags?, surfacedBy? }
 *  — M-Cascade-Perfection Phase 2 / ADR-015. */
export const CreateBugActionPayloadSchema = z.object({
  title: z.string().describe("Short title for the bug"),
  description: z.string().describe("Full description including reproduction steps"),
  severity: z.enum(["critical", "major", "minor"]).optional().describe("Severity (default: minor)"),
  class: z.string().optional().describe("Free-text root-cause class"),
  tags: z.array(z.string()).optional().describe("Categorization tags"),
  surfacedBy: z.string().optional().describe("Discovery channel"),
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
  create_bug: CreateBugActionPayloadSchema,
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
  "create_bug",
] as const;

/**
 * Phase 2a (task-303, thread-223) — per-action commit authority.
 *
 * The converger's role must be ≥ the max-privilege of any staged
 * action in the thread. Architect holds directive authority for
 * task + mission + mission-status updates. Proposals are engineer-
 * authored per ADR-010. Everything else is symmetric — either
 * party can converge.
 *
 * Convergence gate in thread-policy.ts reads this map and rejects
 * converged=true with a reject-with-hint error when the caller's
 * role doesn't satisfy.
 */
export type ConvergerRoleRequirement = "architect" | "engineer" | "either";

export const REQUIRED_CONVERGER_ROLE: Record<
  typeof AUTONOMOUS_STAGED_ACTION_TYPES[number],
  ConvergerRoleRequirement
> = {
  close_no_action: "either",
  create_task: "architect",
  create_proposal: "engineer",
  create_idea: "either",
  update_idea: "either",
  update_mission_status: "architect",
  propose_mission: "architect",
  create_clarification: "either",
  create_bug: "either",
};

/**
 * Compute the effective commit-authority requirement for a set of
 * staged actions. Rule: architect > engineer > either. If any action
 * requires architect, the whole set requires architect. If any action
 * requires engineer (and none requires architect), the set requires
 * engineer. Otherwise either can converge.
 */
export function effectiveConvergerRequirement(
  actionTypes: readonly string[],
): ConvergerRoleRequirement {
  let requirement: ConvergerRoleRequirement = "either";
  for (const t of actionTypes) {
    const r = (REQUIRED_CONVERGER_ROLE as Record<string, ConvergerRoleRequirement | undefined>)[t];
    if (r === "architect") return "architect"; // max — no further escalation possible
    if (r === "engineer" && requirement === "either") requirement = "engineer";
  }
  return requirement;
}

/**
 * Check whether a caller's role satisfies the effective requirement.
 * Role hierarchy: architect has super-user privilege over engineer-
 * required actions (architect ≥ engineer ≥ director for Hub purposes).
 * But engineer/director CANNOT converge architect-required actions —
 * architect is the sole authority for directives (tasks, missions).
 *
 * Returns null on success; otherwise a human-readable error message
 * naming the violating action types + required role for the
 * reject-with-hint surface at the convergence gate.
 */
export function checkConvergerAuthority(
  callerRole: "architect" | "engineer" | "director" | "unknown",
  stagedActionTypes: readonly string[],
): string | null {
  const required = effectiveConvergerRequirement(stagedActionTypes);
  if (required === "either") return null;
  // Architect is super-user — can converge anything.
  if (callerRole === "architect") return null;
  // engineer / director roles satisfy only engineer-required.
  if (required === "engineer" && (callerRole === "engineer" || callerRole === "director")) return null;
  // All other combinations: architect-required + non-architect caller.
  const violating = stagedActionTypes.filter((t) => {
    const r = (REQUIRED_CONVERGER_ROLE as Record<string, ConvergerRoleRequirement | undefined>)[t];
    return r === required;
  });
  return (
    `Convergence denied: this thread stages ${violating.join(", ")} ` +
    `which requires converger role '${required}', but caller role is '${callerRole}'. ` +
    `Per-action commit authority (Phase 2a task-303): architect-only actions ` +
    `(create_task, update_mission_status, propose_mission) must be converged by the Architect.`
  );
}

// ── Validate phase (M24-T4, INV-TH19) ───────────────────────────────

/**
 * Shape the gate sees when it asks whether a set of staged actions is
 * fit to promote. Structural — `action` is described by `{id, type,
 * payload}` only, so this file stays independent of state.ts (avoids
 * the policy→state→policy cycle when state.ts calls the validator
 * from its gate).
 */
export interface StagedActionShape {
  id: string;
  type: string;
  status?: string;
  payload: Record<string, unknown> | unknown;
}

export interface CascadeValidationError {
  actionId: string;
  type: string;
  error: string;
}

export type CascadeValidationResult =
  | { ok: true }
  | { ok: false; errors: CascadeValidationError[] };

/**
 * Validate every `staged` action's payload against its registered Zod
 * schema. Returns `{ ok: true }` when all pass; otherwise a detailed
 * per-action error list so the caller (state.ts gate) can raise one
 * `ThreadConvergenceGateError` naming every culprit at once — LLM
 * callers self-correct in one revise op instead of guess-and-retry.
 *
 * Only actions with `status === "staged"` are inspected; already-
 * committed/retracted/revised entries are past the gate or out of
 * the promotion set.
 */
export function validateStagedActions(actions: ReadonlyArray<StagedActionShape>): CascadeValidationResult {
  const errors: CascadeValidationError[] = [];
  for (const a of actions) {
    if (a.status && a.status !== "staged") continue;
    const schema = (STAGED_ACTION_PAYLOAD_SCHEMAS as Record<string, z.ZodType>)[a.type];
    if (!schema) {
      errors.push({ actionId: a.id, type: a.type, error: `unknown autonomous action type "${a.type}"` });
      continue;
    }
    const parsed = schema.safeParse(a.payload);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      errors.push({ actionId: a.id, type: a.type, error: issues });
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
