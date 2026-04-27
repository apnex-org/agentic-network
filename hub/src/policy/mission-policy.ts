/**
 * Mission Policy — Arc-of-work management.
 *
 * Tools: create_mission, update_mission, get_mission, list_missions
 * Emits: mission_created, mission_activated
 */

import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import { isValidTransition } from "./types.js";
import type { FsmTransitionTable } from "./types.js";
import type {
  Mission,
  MissionStatus,
  PlannedTask,
  MissionClass,
  MissionPulses,
  PulseConfig,
  PulseKey,
} from "../entities/index.js";
import {
  MISSION_CLASSES,
  PULSE_KEYS,
  PULSE_RESPONSE_SHAPES,
  PULSE_INTERVAL_FLOOR_SECONDS,
  DEFAULT_MISSED_THRESHOLD,
} from "../entities/index.js";
import {
  LIST_PAGINATION_SCHEMA,
  paginate,
  buildQueryFilterSchema,
  buildQuerySortSchema,
  applyQueryFilter,
  applyQuerySort,
  type QueryableFieldSpec,
  type FieldAccessors,
} from "./list-filters.js";
import { dispatchMissionCreated, dispatchMissionActivated } from "./dispatch-helpers.js";
import { resolveCreatedBy } from "./caller-identity.js";
import { runTriggers } from "./triggers.js";

// ── Mission-57 W1: pulse-config validation + auto-injection ──────────

/**
 * Mission-57 W1: strip sweeper-managed bookkeeping fields from incoming
 * pulse config at the MCP-tool boundary. Per Design v1.0 §3 default-
 * injection semantics: lastFiredAt / lastResponseAt / missedCount /
 * lastEscalatedAt are read-only via MCP tools; only PulseSweeper writes
 * them via direct repository updates. External callers that include
 * these fields in `update_mission` / `create_mission` args have them
 * stripped here before forwarding to the repository.
 */
function stripSweeperManagedFields(input: PulseConfig): PulseConfig {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { lastFiredAt, lastResponseAt, missedCount, lastEscalatedAt, ...engineerAuthored } = input;
  return engineerAuthored as PulseConfig;
}

/**
 * Mission-57 W1: auto-inject defaults per Design v1.0 §3 "Default-injection
 * semantics" for engineer-authored fields:
 *   - precondition: auto-injected `mission_idle_for_at_least` w/ args
 *     `{seconds: <intervalSeconds>}` when undefined; explicit `null` disables
 *   - firstFireDelaySeconds: equals intervalSeconds when undefined
 *   - missedThreshold: `DEFAULT_MISSED_THRESHOLD` (3) when undefined
 *   - responseShape: required (no default; validated separately)
 *
 * Auto-injection happens once at write-time + persisted on the mission
 * entity. Reading the entity returns the injected values explicitly;
 * no implicit defaults at read-time.
 */
function autoInjectPulseDefaults(input: PulseConfig): PulseConfig {
  const stripped = stripSweeperManagedFields(input);
  const result: PulseConfig = { ...stripped };

  if (result.firstFireDelaySeconds === undefined) {
    result.firstFireDelaySeconds = result.intervalSeconds;
  }
  if (result.missedThreshold === undefined) {
    result.missedThreshold = DEFAULT_MISSED_THRESHOLD;
  }
  if (result.precondition === undefined) {
    // Inject default `mission_idle_for_at_least` precondition; reduces
    // pulse-noise during high-activity sub-PR cascades.
    result.precondition = {
      fn: "mission_idle_for_at_least",
      args: { seconds: result.intervalSeconds },
    };
  }
  // Note: `precondition: null` (explicit disable) is preserved — null
  // bypasses the auto-inject branch above (since `null !== undefined`).

  return result;
}

/**
 * Mission-57 W1: validate engineer-authored pulse config. Returns null
 * if valid; error string if invalid. Caller maps error string into
 * MCP-tool response.
 */
function validatePulseConfig(input: PulseConfig, pulseKey: PulseKey): string | null {
  if (typeof input.intervalSeconds !== "number" || !Number.isFinite(input.intervalSeconds)) {
    return `${pulseKey}.intervalSeconds must be a finite number`;
  }
  if (input.intervalSeconds < PULSE_INTERVAL_FLOOR_SECONDS) {
    return `${pulseKey}.intervalSeconds must be ≥ ${PULSE_INTERVAL_FLOOR_SECONDS}s (sub-minute cadences are anti-pattern; ≥300s recommended)`;
  }
  if (typeof input.message !== "string" || input.message.length === 0) {
    return `${pulseKey}.message must be a non-empty string`;
  }
  if (!PULSE_RESPONSE_SHAPES.includes(input.responseShape as never)) {
    return `${pulseKey}.responseShape must be one of: ${PULSE_RESPONSE_SHAPES.join(", ")}`;
  }
  return null;
}

/**
 * Mission-57 W1: prepare the `pulses` field for storage at the MCP-tool
 * boundary. Strips sweeper-managed bookkeeping; auto-injects defaults
 * for optional fields; validates engineer-authored fields. Returns
 * `{value, error}` shape — error is non-null on validation failure.
 */
function preparePulsesForStorage(
  input: MissionPulses,
): { value: MissionPulses; error: string | null } {
  const result: MissionPulses = {};
  for (const key of PULSE_KEYS) {
    const pulse = input[key];
    if (!pulse) continue;
    const error = validatePulseConfig(pulse, key);
    if (error) {
      return { value: result, error };
    }
    result[key] = autoInjectPulseDefaults(pulse);
  }
  return { value: result, error: null };
}

// ── FSM Declaration ─────────────────────────────────────────────────

export const MISSION_FSM: FsmTransitionTable = [
  { from: "proposed", to: "active" },
  { from: "proposed", to: "abandoned" },
  { from: "active", to: "completed" },
  { from: "active", to: "abandoned" },
];

// ── Handlers ────────────────────────────────────────────────────────

async function createMission(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const title = args.title as string;
  const description = args.description as string;
  const documentRef = args.documentRef as string | undefined;
  const plannedTasks = args.plannedTasks as PlannedTask[] | undefined;
  const missionClass = args.missionClass as MissionClass | undefined;
  const pulses = args.pulses as MissionPulses | undefined;

  // task-316 / idea-144 Path A: normalize plannedTasks input — fresh
  // plannedTasks always start as `unissued` with no bound taskId.
  // Callers can omit status/issuedTaskId; we clamp to the canonical
  // initial state.
  const normalizedPlans = plannedTasks
    ? plannedTasks.map((p) => ({
        sequence: p.sequence,
        title: p.title,
        description: p.description,
        status: "unissued" as const,
        issuedTaskId: null,
      }))
    : undefined;

  // Mission-57 W1: validate missionClass enum + prepare pulses (strip
  // sweeper-managed bookkeeping; auto-inject defaults; validate
  // engineer-authored fields). Per Design v1.0 §3 default-injection
  // semantics + §6 (unset)/legacy NO-PULSE backward-compat.
  if (missionClass !== undefined && !MISSION_CLASSES.includes(missionClass)) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: `missionClass must be one of: ${MISSION_CLASSES.join(", ")}` }) }],
      isError: true,
    };
  }
  let preparedPulses: MissionPulses | undefined;
  if (pulses !== undefined) {
    const { value, error } = preparePulsesForStorage(pulses);
    if (error) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error }) }],
        isError: true,
      };
    }
    preparedPulses = value;
  }

  const createdBy = await resolveCreatedBy(ctx);
  const mission = await ctx.stores.mission.createMission(
    title,
    description,
    documentRef,
    undefined,
    createdBy,
    normalizedPlans,
    missionClass,
    preparedPulses,
  );

  // Uses the shared helper so the cascade path (cascade-actions/
  // propose-mission.ts) fires an identically-shaped event.
  await dispatchMissionCreated(ctx, mission);

  return {
    content: [{ type: "text" as const, text: JSON.stringify({
      missionId: mission.id,
      status: mission.status,
      correlationId: mission.correlationId,
      plannedTasks: mission.plannedTasks,
      missionClass: mission.missionClass,
      pulses: mission.pulses,
    }) }],
  };
}

async function updateMission(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const missionId = args.missionId as string;
  const status = args.status as MissionStatus | undefined;
  const description = args.description as string | undefined;
  const documentRef = args.documentRef as string | undefined;
  const plannedTasks = args.plannedTasks as PlannedTask[] | undefined;
  const missionClass = args.missionClass as MissionClass | undefined;
  const pulses = args.pulses as MissionPulses | undefined;

  const updates: {
    status?: MissionStatus;
    description?: string;
    documentRef?: string;
    plannedTasks?: PlannedTask[];
    missionClass?: MissionClass;
    pulses?: MissionPulses;
  } = {};
  if (status) updates.status = status;
  if (description !== undefined) updates.description = description;
  if (documentRef !== undefined) updates.documentRef = documentRef;
  if (plannedTasks !== undefined) {
    // task-316 / idea-144 Path A: incoming plannedTasks on update are
    // also normalized to initial state. Callers revising an existing
    // mission's plan are replacing the plan wholesale; advancement
    // bookkeeping (issued/completed) belongs to the cascade handler,
    // not direct update paths.
    updates.plannedTasks = plannedTasks.map((p) => ({
      sequence: p.sequence,
      title: p.title,
      description: p.description,
      status: p.status ?? ("unissued" as const),
      issuedTaskId: p.issuedTaskId ?? null,
    }));
  }
  // Mission-57 W1: validate missionClass enum + prepare pulses (strip
  // sweeper-managed bookkeeping; auto-inject defaults; validate
  // engineer-authored fields). Per Design v1.0 §3 default-injection
  // semantics; sweeper-managed bookkeeping preserved by repository
  // merge logic when only engineer-authored fields are updated.
  if (missionClass !== undefined) {
    if (!MISSION_CLASSES.includes(missionClass)) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: `missionClass must be one of: ${MISSION_CLASSES.join(", ")}` }) }],
        isError: true,
      };
    }
    updates.missionClass = missionClass;
  }
  if (pulses !== undefined) {
    const { value, error } = preparePulsesForStorage(pulses);
    if (error) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error }) }],
        isError: true,
      };
    }
    updates.pulses = value;
  }

  // FSM guard: validate status transition if status is changing
  let priorStatus: string | null = null;
  if (status) {
    const current = await ctx.stores.mission.getMission(missionId);
    if (!current) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Mission not found: ${missionId}` }) }], isError: true };
    }
    priorStatus = current.status;
    if (current.status !== status && !isValidTransition(MISSION_FSM, current.status, status)) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: `Invalid state transition: cannot move mission from '${current.status}' to '${status}'` }) }],
        isError: true,
      };
    }
  }

  const mission = await ctx.stores.mission.updateMission(missionId, updates);
  if (!mission) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Mission not found: ${missionId}` }) }], isError: true };
  }

  if (status === "active") {
    // Uses the shared helper so the cascade path (cascade-actions/
    // update-mission-status.ts) fires an identically-shaped event.
    await dispatchMissionActivated(ctx, mission);
  }

  // Mission-51 W3: state-transition triggers. Best-effort emission of
  // a Message on the (priorStatus → status) transition; failures are
  // logged + metric'd + non-fatal (entity update is the source of
  // truth). See `hub/src/policy/triggers.ts` for the registry.
  if (status && priorStatus && priorStatus !== status) {
    try {
      await runTriggers("mission", priorStatus, status, mission as unknown as Record<string, unknown>, ctx);
    } catch (err) {
      ctx.metrics.increment("trigger.runner_error", {
        entityType: "mission",
        fromStatus: priorStatus,
        toStatus: status,
        error: (err as Error)?.message ?? String(err),
      });
      console.warn(`[MissionPolicy] runTriggers failed for mission ${mission.id}; entity update succeeded:`, err);
    }
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify({
      missionId: mission.id,
      status: mission.status,
      tasks: mission.tasks,
      ideas: mission.ideas,
      plannedTasks: mission.plannedTasks,
      missionClass: mission.missionClass,
      pulses: mission.pulses,
    }) }],
  };
}

async function getMission(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const missionId = args.missionId as string;
  const mission = await ctx.stores.mission.getMission(missionId);
  if (!mission) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Mission not found: ${missionId}` }) }], isError: true };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(mission, null, 2) }],
  };
}

// ── Mission-61 W1 Fix #2: force_fire_pulse admin tool ────────────────

/**
 * Mission-61 W1 Fix #2: architect-callable force-fire admin tool.
 * Closes mission-60 Gap #2 (architect-fallback force-fire mechanism
 * missing — sweeper-managed bookkeeping fields stripped at the policy
 * boundary so `update_mission(pulses.lastFiredAt=<old>)` is structurally
 * a no-op).
 *
 * Operator-intent semantics: architect explicitly intervening; bypass
 * cadence + precondition checks; fire NOW. Delegates to
 * PulseSweeper.forceFire which handles bookkeeping advance + SSE
 * dispatch via the same Path A wiring as natural fires (Fix #1).
 */
async function forceFirePulse(
  args: Record<string, unknown>,
  ctx: IPolicyContext,
): Promise<PolicyResult> {
  const missionId = args.missionId as string;
  const pulseKey = args.pulseKey as PulseKey;
  if (!PULSE_KEYS.includes(pulseKey)) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        error: `force_fire_pulse: pulseKey must be one of: ${PULSE_KEYS.join(", ")}`,
      }) }],
      isError: true,
    };
  }
  const sweeper = ctx.stores.pulseSweeper;
  if (!sweeper) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        error: "force_fire_pulse: PulseSweeper not wired into this Hub instance",
      }) }],
      isError: true,
    };
  }
  try {
    const firedAt = await sweeper.forceFire(missionId, pulseKey);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        missionId,
        pulseKey,
        firedAt,
        message: `Force-fired ${pulseKey} on ${missionId} at ${firedAt}; cadence + precondition bypassed (operator-intent)`,
      }) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        error: `force_fire_pulse failed: ${(err as Error)?.message ?? String(err)}`,
      }) }],
      isError: true,
    };
  }
}

// ── M-QueryShape Phase C (idea-119, task-306) ──────────────────────
// Mission-entity field descriptors + accessors. Mirrors list_tasks /
// list_ideas / list_threads pattern; createdBy.id is computed
// `${role}:${agentId}` per architect-ratified virtual-field intent.

const MISSION_FILTERABLE_FIELDS: QueryableFieldSpec = {
  status: { type: "enum", values: ["proposed", "active", "completed", "abandoned"] },
  correlationId: { type: "string" },
  turnId: { type: "string" },
  sourceThreadId: { type: "string" },
  sourceActionId: { type: "string" },
  createdAt: { type: "date" },
  updatedAt: { type: "date" },
  "createdBy.role": { type: "string" },
  "createdBy.agentId": { type: "string" },
  "createdBy.id": { type: "string" },
};

const MISSION_SORTABLE_FIELDS = [
  "id",
  "status",
  "createdAt",
  "updatedAt",
  "correlationId",
  "turnId",
  "sourceThreadId",
  "sourceActionId",
  "createdBy.role",
  "createdBy.agentId",
  "createdBy.id",
] as const;

const MISSION_ACCESSORS: FieldAccessors<Mission> = {
  id: (m) => m.id,
  status: (m) => m.status,
  correlationId: (m) => m.correlationId,
  turnId: (m) => m.turnId,
  sourceThreadId: (m) => m.sourceThreadId,
  sourceActionId: (m) => m.sourceActionId,
  createdAt: (m) => m.createdAt,
  updatedAt: (m) => m.updatedAt,
  "createdBy.role": (m) => m.createdBy?.role ?? null,
  "createdBy.agentId": (m) => m.createdBy?.agentId ?? null,
  "createdBy.id": (m) => (m.createdBy ? `${m.createdBy.role}:${m.createdBy.agentId}` : null),
};

const MISSION_FILTER_SCHEMA = buildQueryFilterSchema(MISSION_FILTERABLE_FIELDS);
const MISSION_SORT_SCHEMA = buildQuerySortSchema(MISSION_SORTABLE_FIELDS);

async function listMissions(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  let missions = await ctx.stores.mission.listMissions();
  const totalPreFilter = missions.length;

  // Backwards-compat: legacy scalar `status` arg subsumed by the new
  // `filter.status` field. filter.status wins when both are present.
  const legacyStatus = typeof args.status === "string" ? (args.status as MissionStatus) : undefined;
  const filterArgRaw = args.filter as Record<string, unknown> | undefined;
  const effectiveFilter: Record<string, unknown> = { ...(filterArgRaw ?? {}) };
  if (legacyStatus && effectiveFilter.status === undefined) {
    effectiveFilter.status = legacyStatus;
  }
  const hasFilter = Object.keys(effectiveFilter).length > 0;

  if (hasFilter) {
    missions = applyQueryFilter(missions, effectiveFilter, MISSION_ACCESSORS);
  }

  const sortArg = args.sort as ReadonlyArray<{ field: string; order: "asc" | "desc" }> | undefined;
  missions = applyQuerySort(missions, sortArg, MISSION_ACCESSORS);

  const postFilterCount = missions.length;
  const page = paginate(missions, args);

  const queryUnmatched = hasFilter && postFilterCount === 0 && totalPreFilter > 0;

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        missions: page.items,
        count: page.count,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        ...(queryUnmatched ? { _ois_query_unmatched: true } : {}),
      }, null, 2),
    }],
  };
}

// task-316 / idea-144 Path A — plannedTasks input schema. Normalized
// server-side: status defaults to "unissued", issuedTaskId to null.
// Callers supplying status/issuedTaskId on create/update are ignored
// for non-`unissued` values — the advancement cascade owns the
// bookkeeping transitions.
const PLANNED_TASK_INPUT_SCHEMA = z.object({
  sequence: z.number().describe("Ordinal position in the mission's execution plan"),
  title: z.string().describe("Short title for the spawned Task"),
  description: z.string().describe("Directive body that becomes the spawned Task's description"),
  status: z.enum(["unissued", "issued", "completed"]).optional().describe("Lifecycle state; defaults to 'unissued' on fresh input"),
  issuedTaskId: z.string().nullable().optional().describe("ID of the spawned Task once issued (managed by advancement cascade; callers should leave null)"),
});

// Mission-57 W1: PulseConfig + MissionPulses input schemas. Sweeper-managed
// bookkeeping fields (lastFiredAt / lastResponseAt / missedCount /
// lastEscalatedAt) are stripped at MCP-tool boundary in the handler;
// not part of the input schema. Engineers declare engineer-authored
// fields only.
const PRECONDITION_INPUT_SCHEMA = z.object({
  fn: z.string().describe("Predicate name (must exist in `hub/src/policy/preconditions.ts` registry)"),
  args: z.record(z.string(), z.unknown()).describe("Arguments passed to the predicate evaluator"),
});

const PULSE_CONFIG_INPUT_SCHEMA = z.object({
  intervalSeconds: z.number().describe("Pulse cadence in seconds; ≥60s enforced (sub-minute is anti-pattern); ≥300s recommended"),
  message: z.string().describe("Payload prompt rendered at adapter when pulse fires"),
  responseShape: z.enum(["ack", "short_status", "full_status"]).describe("Pulse-response-shape hint to the adapter renderer; required (no default per pulse-semantics-domain)"),
  missedThreshold: z.number().optional().describe("Architect-side escalation threshold; auto-injected default 3 if omitted (matches W3.2 ADR-017 receipt-deadline-missed-3x precedent)"),
  precondition: PRECONDITION_INPUT_SCHEMA.nullable().optional().describe("Optional W4-precondition-registry fn-by-name + args. Auto-injected default `mission_idle_for_at_least` if omitted; explicit `null` to disable"),
  firstFireDelaySeconds: z.number().optional().describe("Optional first-fire delay; auto-injected to intervalSeconds if omitted"),
});

const MISSION_PULSES_INPUT_SCHEMA = z.object({
  engineerPulse: PULSE_CONFIG_INPUT_SCHEMA.optional().describe("Pulse targeting the engineer agent; named-field schema per Design v1.0 §3"),
  architectPulse: PULSE_CONFIG_INPUT_SCHEMA.optional().describe("Pulse targeting the architect agent; named-field schema per Design v1.0 §3"),
});

const MISSION_CLASS_INPUT_SCHEMA = z.enum(MISSION_CLASSES).describe(
  "Mission-class taxonomy per mission-56 retrospective §5.4.1; drives per-class default pulse cadence template lookup at the mission-lifecycle.md v1.0 layer (NOT Hub primitives — Survey Q3+Q4+Q6 anti-goal). " +
  "Optional; legacy missions without `missionClass` get NO automatic pulses per Design v1.0 §6 (unset)/legacy backward-compat row.",
);

// ── Registration ────────────────────────────────────────────────────

export function registerMissionPolicy(router: PolicyRouter): void {
  router.register(
    "create_mission",
    "[Architect] Create a new mission — a committed arc of work grouping related tasks. " +
    "task-316 / idea-144 Path A: `plannedTasks` is an optional execution plan. " +
    "When present, the post-review advancement cascade auto-issues the next unissued plannedTask on each approved review, eliminating the nudge-per-review pattern observed in mission-38 (5 nudge threads for 5 tasks). " +
    "Missions without plannedTasks behave exactly as before — no auto-advancement. " +
    "Mission-57 W1: optional `missionClass` + `pulses` declarative coordination config; sweeper-managed bookkeeping fields stripped at MCP-tool boundary; engineer-authored field defaults auto-injected per Design v1.0 §3.",
    {
      title: z.string().describe("Mission title"),
      description: z.string().describe("Brief description of the mission objectives"),
      documentRef: z.string().optional().describe("GCS document path for the full brief (e.g., 'docs/missions/brief.md')"),
      plannedTasks: z.array(PLANNED_TASK_INPUT_SCHEMA).optional().describe("Optional execution plan. Ordered task templates auto-issued by the advancement cascade on approved reviews. See thread-241/thread-242 for cascade shape + revision-loop FSMs."),
      missionClass: MISSION_CLASS_INPUT_SCHEMA.optional(),
      pulses: MISSION_PULSES_INPUT_SCHEMA.optional().describe("Optional declarative pulse configuration (mission-57 W1). PulseSweeper consumes; engineer + architect pulses with cadence + response-shape + missed-threshold. See Design v1.0 §3 for schema; §6 for per-class default cadence templates (codified in mission-lifecycle.md v1.0)."),
    },
    createMission,
  );

  router.register(
    "update_mission",
    "[Architect] Update a mission's status, description, document reference, plannedTasks, missionClass, or pulses. " +
    "task-316: updating `plannedTasks` replaces the existing plan wholesale; advancement bookkeeping (issued/completed) is driven by the cascade handler, not direct updates. " +
    "Mission-57 W1: pulses-update preserves sweeper-managed bookkeeping (lastFiredAt / lastResponseAt / missedCount / lastEscalatedAt); only PulseSweeper writes those via direct repository updates that bypass this MCP surface.",
    {
      missionId: z.string().describe("The mission ID to update"),
      status: z.enum(["proposed", "active", "completed", "abandoned"]).optional().describe("New status"),
      description: z.string().optional().describe("Updated description"),
      documentRef: z.string().optional().describe("Updated document reference"),
      plannedTasks: z.array(PLANNED_TASK_INPUT_SCHEMA).optional().describe("Replace the mission's plannedTasks plan. Normalized to initial state on input."),
      missionClass: MISSION_CLASS_INPUT_SCHEMA.optional(),
      pulses: MISSION_PULSES_INPUT_SCHEMA.optional().describe("Replace the mission's pulses config. Sweeper-managed bookkeeping is preserved across replacements; engineer-authored fields validated + defaults auto-injected per Design v1.0 §3."),
    },
    updateMission,
  );

  router.register(
    "get_mission",
    "[Any] Read a specific mission with all linked tasks and ideas.",
    { missionId: z.string().describe("The mission ID") },
    getMission,
  );

  router.register(
    "force_fire_pulse",
    "[Architect] Force-fire a configured pulse on a mission immediately, " +
    "bypassing cadence + precondition checks. Operator-intent semantic: " +
    "architect is explicitly intervening (e.g., recovering from missed-threshold " +
    "pause, validating pulse delivery, or unblocking a stuck idle precondition) " +
    "and wants the pulse to fire NOW rather than waiting for the next sweeper " +
    "tick. " +
    "Mission-61 W1 Fix #2 (closes mission-60 Gap #2): sweeper-managed bookkeeping " +
    "fields are stripped at the `update_mission(pulses=...)` policy boundary, so " +
    "rewriting `lastFiredAt` is structurally a no-op. This is the dedicated " +
    "architect path. lastFiredAt advances to fire-time post-execution; missedCount " +
    "is NOT reset (separate concern; ack flow drives reset). " +
    "Idempotency: migrationSourceId uses now-timestamp; sub-second collision rare " +
    "and acceptable. SSE delivery flows through the same Path A wiring as natural " +
    "fires (Fix #1) — operator session receives `message_arrived` event with " +
    "`payload.pulseKind=status_check`.",
    {
      missionId: z.string().describe("The mission ID whose pulse should fire"),
      pulseKey: z
        .enum(PULSE_KEYS)
        .describe("Which pulse to fire: 'engineerPulse' or 'architectPulse'"),
    },
    forceFirePulse,
  );

  router.register(
    "list_missions",
    "[Any] List missions with filter + sort + pagination. " +
    "`filter` accepts a Mongo-ish object with implicit AND across fields: " +
    "`{status: 'active'}` for eq, `{status: {$in: ['proposed','active']}}` for set membership, " +
    "`{createdAt: {$lt: '2026-04-01T00:00:00Z'}}` for range. " +
    "Filterable fields: status, correlationId, turnId, sourceThreadId, sourceActionId, createdAt, updatedAt, " +
    "'createdBy.role', 'createdBy.agentId', 'createdBy.id' (computed `${role}:${agentId}`). " +
    "Range operators ($gt/$lt/$gte/$lte) apply only to dates + numbers. " +
    "Forbidden operators ($regex, $where, $expr, $or, $and, $not) are rejected with an error naming the permitted set. " +
    "`sort` accepts an ordered tuple `[{field, order}]` on: id, status, createdAt, updatedAt, correlationId, turnId, sourceThreadId, sourceActionId, 'createdBy.role', 'createdBy.agentId', 'createdBy.id'. " +
    "Implicit id:asc tie-breaker is appended for deterministic pagination. " +
    "Returns `_ois_query_unmatched: true` when the filter yields zero matches but the collection is non-empty. " +
    "Legacy scalar `status:` arg preserved for backwards compat; `filter.status` wins when both present.",
    {
      filter: MISSION_FILTER_SCHEMA.optional()
        .describe("Mongo-ish filter object; see tool description for permitted fields + operators"),
      sort: MISSION_SORT_SCHEMA
        .describe("Ordered-tuple sort; see tool description for permitted fields"),
      status: z.enum(["proposed", "active", "completed", "abandoned"]).optional()
        .describe("DEPRECATED: use `filter: { status: ... }`. Preserved for backwards compat; `filter.status` wins when both present."),
      ...LIST_PAGINATION_SCHEMA,
    },
    listMissions,
  );
}
