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
