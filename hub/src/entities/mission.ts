/**
 * Mission Entity — A committed arc of work grouping related tasks.
 *
 * Lightweight state machine:
 *   proposed → active → completed
 *                     → abandoned
 *
 * `tasks` and `ideas` are returned on every read as a virtual view
 * computed from the task store (filtered by `correlationId === mission.id`)
 * and the idea store (filtered by `missionId === mission.id`). They are
 * never stored or mutated in-place — previous implementations kept stored
 * arrays and used naked read-modify-write to append, which lost writes
 * under concurrent auto-linkage. See `hub/test/mission-integrity.test.ts`
 * for the regression pin.
 */

import type { EntityProvenance } from "../state.js";
import type { CascadeBacklink } from "./idea.js";

// ── Types ────────────────────────────────────────────────────────────

export type MissionStatus = "proposed" | "active" | "completed" | "abandoned";

/**
 * task-316 / idea-144 Path A — plannedTask template on a Mission.
 *
 * A structured slot in a Mission's execution plan. The post-review
 * cascade in `handleTaskCompleted` (task-policy.ts) consumes the
 * `unissued → issued → completed` progression to auto-advance to the
 * next task when the architect approves the prior review. Task-316
 * ratification thread-240/241.
 *
 * v1 is transitional; idea-134's Mission-wide Report + Trace migration
 * will supersede the Task-scoped advancement model. See
 * `docs/audits/task-316-*` for the per-cell cascade matrix this field
 * participates in.
 */
export type PlannedTaskStatus = "unissued" | "issued" | "completed";

export interface PlannedTask {
  /** Ordinal position in the mission's planned sequence. Monotonic; not reused. */
  sequence: number;
  /** Short title — becomes the spawned Task's title. */
  title: string;
  /** Directive body — becomes the spawned Task's description. */
  description: string;
  /** Lifecycle state. Starts as `unissued`; flips to `issued` when the
   *  advancement cascade spawns a Task; flips to `completed` when the
   *  architect approves that Task's review. */
  status: PlannedTaskStatus;
  /** ID of the spawned Task once `status` is `issued` or `completed`.
   *  Enables lineage queries (plannedTask → Task → Report → Review). */
  issuedTaskId?: string | null;
}

/** Terminal states — mission's FSM has no outbound edges from these. */
export const TERMINAL_MISSION_STATUSES: ReadonlySet<MissionStatus> = new Set(["completed", "abandoned"]);

/**
 * Mission-57 W1: mission-class taxonomy per mission-56 retrospective §5.4.1.
 * Used by `mission-lifecycle.md` v1.0 (co-shipped at W4 D5) to look up
 * per-class default pulse cadence templates. Optional on the entity;
 * legacy missions without `missionClass` get NO PULSE per Design v1.0 §6
 * `(unset)/legacy` row (backward-compat).
 */
export const MISSION_CLASSES = [
  "spike",
  "substrate-introduction",
  "pre-substrate-cleanup",
  "structural-inflection",
  "coordination-primitive-shipment",
  "saga-substrate-completion",
  "substrate-cleanup-wave",
  "distribution-packaging",
] as const;
export type MissionClass = (typeof MISSION_CLASSES)[number];

/**
 * Mission-57 W1: pulse response-shape declaration. Engineer-authored;
 * no default at Hub level (Survey Q4 anti-goal). Per Design v1.0 §6
 * mission-lifecycle.md conventions, both engineerPulse and architectPulse
 * default to `short_status` at the methodology-doc layer (NOT Hub primitives).
 */
export const PULSE_RESPONSE_SHAPES = ["ack", "short_status", "full_status"] as const;
export type PulseResponseShape = (typeof PULSE_RESPONSE_SHAPES)[number];

/**
 * Mission-57 W1 + mission-68 W1: per-pulse declarative configuration on a
 * Mission entity. Per Design v1.0 §3 (PulseConfig schema) + §5 (unified
 * 10/20 default cadence) + §8 (missedThreshold reduce-to-2).
 *
 * **Mission-68 amendment (Design v1.0 §4.2):** `precondition` field
 * REMOVED. Pulse fires on schedule unconditionally (modulo missedThreshold
 * pause logic). The W4 precondition registry continues to serve scheduled-
 * message consumers (`thread-still-active`, `task-not-completed`) but the
 * `mission_idle_for_at_least` predicate + auto-injection branch are gone
 * per engineer-audit C2 + Q3a Director-pick.
 *
 * Fields split into two classes:
 *
 * **Engineer-authored** (validated at MCP boundary; persisted on entity):
 *   - intervalSeconds: cadence (≥60s enforced; ≥300s recommended; sub-minute is anti-pattern per Survey Q5)
 *   - message: payload prompt rendered at adapter
 *   - responseShape: pulse-response-shape declaration
 *   - missedThreshold: architect-side escalation threshold (auto-injected default 2 per Design v1.0 §8 mission-68 fold; was 3 pre-mission-68)
 *   - firstFireDelaySeconds: optional first-fire delay (auto-injected to intervalSeconds)
 *
 * **Sweeper-managed bookkeeping** (read-only via MCP tools; only PulseSweeper
 * writes via direct repository update; stripped at MCP boundary in
 * `mission-policy.ts:update_mission`):
 *   - lastFiredAt: ISO-8601 timestamp of most recent pulse fire
 *   - lastResponseAt: ISO-8601 timestamp of most recent ack via webhook
 *   - missedCount: increments on missed-pulse detection (E2 3-condition guard PRESERVED INTACT per mission-68 C1 — orthogonal to precondition layer)
 *   - lastEscalatedAt: suppresses escalation-storm
 */
export interface PulseConfig {
  // Engineer-authored config
  intervalSeconds: number;
  message: string;
  responseShape: PulseResponseShape;
  missedThreshold: number;
  firstFireDelaySeconds?: number;

  // Sweeper-managed bookkeeping
  lastFiredAt?: string;
  lastResponseAt?: string | null;
  missedCount?: number;
  lastEscalatedAt?: string | null;
}

/**
 * Mission-57 W1: pulse keys. Per Survey Q2 envelope: engineer + architect
 * default; Director-watchdog OUT. Named fields (not keyed dict) per
 * Design v1.0 §3 + bilateral round-1 thread-349.
 */
export interface MissionPulses {
  engineerPulse?: PulseConfig;
  architectPulse?: PulseConfig;
}

/** Mission-57 W1: pulse keys enum-style for sweeper iteration. */
export const PULSE_KEYS = ["engineerPulse", "architectPulse"] as const;
export type PulseKey = (typeof PULSE_KEYS)[number];

/**
 * Mission-57 W1: floor on pulse cadence per Survey Q5 anti-pattern guard.
 * Sub-minute cadences cause pulse-storm + missedThreshold semantics
 * break down. 60s is the absolute minimum; ≥300s recommended.
 */
export const PULSE_INTERVAL_FLOOR_SECONDS = 60;

/**
 * Mission-68 W1 (Design v1.0 §8 reduce-to-2 fold): default `missedThreshold`
 * lowered from 3 → 2. Faster missed-detection per Q1c + Q5a compose. At the
 * unified 10/20 cadence (per §5), escalation latency is 20min engineer /
 * 40min architect (was 30/60 at threshold=3, 45/90 at v1.2 baseline 15/30).
 * Engineer-runtime overlay row surfaces this horizon for cold-pickup
 * awareness per M4 fold. Per-mission overridable.
 */
export const DEFAULT_MISSED_THRESHOLD = 2;

/**
 * Mission-68 W1 (Design v1.0 §5 unified 10/20 cadence default): per-role
 * default `intervalSeconds` for auto-injection when a mission is created
 * without explicit `pulses` config. Synchronous-active-arc class cluster
 * default; distribution-packaging class missions SHOULD declare `pulses`
 * explicitly to longer cadence (30/60 baseline preserved per C5 fold).
 *
 * Per-class taxonomy elimination (Q2a) + precondition layer removal (Q3a)
 * compose to make these the unified per-role defaults; missionClass field
 * stays on the Mission entity for retrospective + portfolio-balance scoring
 * but no longer drives pulse cadence.
 */
export const DEFAULT_ENGINEER_PULSE_INTERVAL_SECONDS = 600;
export const DEFAULT_ARCHITECT_PULSE_INTERVAL_SECONDS = 1200;

/**
 * Phase 2d CP2 C4 (task-307): "committable" convention per architect
 * brainstorm thread-232. A mission is committable when it's in a
 * non-terminal state — new tasks / ideas / status transitions can still
 * land against it. Used by action-validators to reject staged actions
 * that would target a mission which completed or was abandoned between
 * stage-time and convergence-time.
 */
export function isMissionCommittable(mission: Pick<Mission, "status">): boolean {
  return !TERMINAL_MISSION_STATUSES.has(mission.status);
}

export interface Mission {
  id: string;
  title: string;
  description: string;
  documentRef: string | null;
  status: MissionStatus;
  /** Virtual view — computed on read from `ITaskStore` by `correlationId`. */
  tasks: string[];
  /** Virtual view — computed on read from `IIdeaStore` by `missionId`. */
  ideas: string[];
  correlationId: string | null;
  /** Mission-20 Phase 3: owning Turn for virtual-view composition. */
  turnId: string | null;
  /** Mission-24 Phase 2 (ADR-014, INV-TH20/23): cascade-spawn back-links.
   * Populated when this Mission was spawned via `propose_mission`
   * cascade action. Null for Director-created or legacy missions. */
  sourceThreadId: string | null;
  sourceActionId: string | null;
  sourceThreadSummary: string | null;
  /** Mission-24 idea-120: uniform direct-create provenance (task-305). */
  createdBy?: EntityProvenance;
  /**
   * task-316 / idea-144 Path A — Mission execution plan. Ordered array
   * of task templates the architect commits to as the mission's scope.
   * The post-review cascade auto-advances through this array on each
   * `approved` review, issuing the next `unissued` template as a Task.
   * Undefined on pre-task-316 missions (migrate-on-read semantics —
   * missions without `plannedTasks` behave exactly as before: no
   * auto-advancement). See thread-241 / thread-242 for the sealed
   * cascade shape + revision-loop FSMs.
   */
  plannedTasks?: PlannedTask[];
  /**
   * Mission-57 W1: mission-class taxonomy per mission-56 retrospective
   * §5.4.1. Drives per-class default pulse cadence template lookup at the
   * mission-lifecycle.md v1.0 layer (co-shipped W4 D5). Optional;
   * `(unset)/legacy missionClass` = NO PULSE (Design v1.0 §6 backward-compat).
   */
  missionClass?: MissionClass;
  /**
   * Mission-57 W1: declarative per-mission pulse configuration. Drives
   * PulseSweeper (W2). Optional; missions without `pulses` field get no
   * automatic pulses. Per-pulse-key (engineerPulse / architectPulse)
   * named-field schema per bilateral round-1 thread-349.
   */
  pulses?: MissionPulses;
  createdAt: string;
  updatedAt: string;
}

// ── Interface ────────────────────────────────────────────────────────

export interface IMissionStore {
  createMission(
    title: string,
    description: string,
    documentRef?: string,
    backlink?: CascadeBacklink,
    createdBy?: EntityProvenance,
    plannedTasks?: PlannedTask[],
    missionClass?: MissionClass,
    pulses?: MissionPulses,
  ): Promise<Mission>;

  getMission(missionId: string): Promise<Mission | null>;

  listMissions(statusFilter?: MissionStatus): Promise<Mission[]>;

  updateMission(
    missionId: string,
    updates: {
      status?: MissionStatus;
      description?: string;
      documentRef?: string;
      plannedTasks?: PlannedTask[];
      missionClass?: MissionClass;
      pulses?: MissionPulses;
    }
  ): Promise<Mission | null>;

  /**
   * task-316 / idea-144 Path A — atomically transition the next
   * `unissued` plannedTask to `issued` and persist the spawned
   * Task id. Returns the transitioned PlannedTask or null if no
   * unissued slot exists (mission lacks plannedTasks, or all are
   * issued/completed). Idempotency: subsequent calls advance the
   * next slot; callers must not call this outside the advancement
   * cascade handler.
   */
  markPlannedTaskIssued(
    missionId: string,
    sequence: number,
    issuedTaskId: string,
  ): Promise<PlannedTask | null>;

  /**
   * task-316 — transition a plannedTask from `issued` to `completed`
   * when the architect approves its Task's review. Keyed on the
   * `issuedTaskId` so the cascade handler doesn't need to know the
   * plannedTask's sequence in advance. Null when the mission has no
   * plannedTask bound to the given taskId (standalone task, or not a
   * mission-linked plannedTask).
   */
  markPlannedTaskCompleted(
    missionId: string,
    issuedTaskId: string,
  ): Promise<PlannedTask | null>;

  /** Mission-24 Phase 2 (ADR-014, INV-TH20): look up by natural key. */
  findByCascadeKey(key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">): Promise<Mission | null>;
}

/**
 * task-316 / idea-144 Path A — find the next `unissued` plannedTask
 * on a mission, ordered by sequence. Returns null if the mission has
 * no plannedTasks or all are already issued/completed. Pure
 * computation — no store mutation.
 */
export function findNextUnissuedPlannedTask(
  plannedTasks: PlannedTask[] | undefined,
): PlannedTask | null {
  if (!plannedTasks || plannedTasks.length === 0) return null;
  const sorted = [...plannedTasks].sort((a, b) => a.sequence - b.sequence);
  return sorted.find((p) => p.status === "unissued") ?? null;
}

// Mission-47 W4: `MemoryMissionStore` deleted. `MissionRepository`
// in `mission-repository.ts` composes any `StorageProvider` (including
// `MemoryStorageProvider` for tests) via the IMissionStore interface.
