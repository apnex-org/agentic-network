/**
 * Turn Entity — A high-level execution cycle (like a sprint).
 *
 * State machine:
 *   planning → active → completed
 *
 * Groups Missions and Tasks.
 * as guiding axioms for the cycle.
 *
 * `missionIds` and `taskIds` are returned on every read as a virtual
 * view — missions and tasks whose `turnId === turn.id`. They are never
 * stored on the Turn object. Mirrors the `Mission.tasks` / `Mission.ideas`
 * virtual-view pattern introduced for the task-223 lost-update fix
 * (see `docs/decisions/011-gcs-concurrency-model.md`).
 */

import type { EntityProvenance } from "../state.js";

// ── Types ────────────────────────────────────────────────────────────

export type TurnStatus = "planning" | "active" | "completed";

export interface Turn {
  id: string;
  title: string;
  scope: string;       // Free-text markdown description of objectives
  status: TurnStatus;
  /** Virtual view — computed on read from `IMissionStore` by `turnId`. */
  missionIds: string[];
  /** Virtual view — computed on read from `ITaskStore` by `turnId`. */
  taskIds: string[];
  correlationId: string | null;
  /** Mission-24 idea-120: uniform direct-create provenance (task-305). */
  createdBy?: EntityProvenance;
  createdAt: string;
  updatedAt: string;
}

// ── Interface ────────────────────────────────────────────────────────

export interface ITurnStore {
  createTurn(
    title: string,
    scope: string,
    createdBy?: EntityProvenance
  ): Promise<Turn>;

  getTurn(turnId: string): Promise<Turn | null>;

  listTurns(statusFilter?: TurnStatus): Promise<Turn[]>;

  updateTurn(
    turnId: string,
    updates: { status?: TurnStatus; scope?: string }
  ): Promise<Turn | null>;
}

// Mission-47 W7: `MemoryTurnStore` deleted. `TurnRepository` in
// entities/turn-repository.ts composes any `StorageProvider` via the
// ITurnStore interface.
