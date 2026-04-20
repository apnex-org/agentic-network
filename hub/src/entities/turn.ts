/**
 * Turn Entity — A high-level execution cycle (like a sprint).
 *
 * State machine:
 *   planning → active → completed
 *
 * Groups Missions and Tasks. References Tele (teleological goals)
 * as guiding axioms for the cycle.
 *
 * `missionIds` and `taskIds` are returned on every read as a virtual
 * view — missions and tasks whose `turnId === turn.id`. They are never
 * stored on the Turn object. Mirrors the `Mission.tasks` / `Mission.ideas`
 * virtual-view pattern introduced for the task-223 lost-update fix
 * (see `docs/decisions/011-gcs-concurrency-model.md`).
 */

import type { ITaskStore, EntityProvenance } from "../state.js";
import type { IMissionStore } from "./mission.js";

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
  tele: string[];       // Tele IDs — teleological goals for this turn
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
    tele?: string[]
  ): Promise<Turn>;

  getTurn(turnId: string): Promise<Turn | null>;

  listTurns(statusFilter?: TurnStatus): Promise<Turn[]>;

  updateTurn(
    turnId: string,
    updates: { status?: TurnStatus; scope?: string; tele?: string[] }
  ): Promise<Turn | null>;
}

// ── Memory Implementation ────────────────────────────────────────────

export class MemoryTurnStore implements ITurnStore {
  private turns = new Map<string, Turn>();
  private counter = 0;

  constructor(
    private readonly missionStore: IMissionStore,
    private readonly taskStore: ITaskStore,
  ) {}

  async createTurn(
    title: string,
    scope: string,
    tele?: string[]
  ): Promise<Turn> {
    this.counter++;
    const id = `turn-${this.counter}`;
    const now = new Date().toISOString();

    const turn: Turn = {
      id,
      title,
      scope,
      status: "planning",
      missionIds: [],
      taskIds: [],
      tele: tele || [],
      correlationId: id,
      createdAt: now,
      updatedAt: now,
    };

    this.turns.set(id, turn);
    console.log(`[MemoryTurnStore] Turn created: ${id} — ${title}`);
    return this.hydrate(turn);
  }

  async getTurn(turnId: string): Promise<Turn | null> {
    const turn = this.turns.get(turnId);
    return turn ? this.hydrate(turn) : null;
  }

  async listTurns(statusFilter?: TurnStatus): Promise<Turn[]> {
    const all = Array.from(this.turns.values());
    const filtered = statusFilter
      ? all.filter((t) => t.status === statusFilter)
      : all;
    return Promise.all(filtered.map((t) => this.hydrate(t)));
  }

  async updateTurn(
    turnId: string,
    updates: { status?: TurnStatus; scope?: string; tele?: string[] }
  ): Promise<Turn | null> {
    const turn = this.turns.get(turnId);
    if (!turn) return null;

    if (updates.status) turn.status = updates.status;
    if (updates.scope !== undefined) turn.scope = updates.scope;
    if (updates.tele) turn.tele = updates.tele;
    turn.updatedAt = new Date().toISOString();

    console.log(`[MemoryTurnStore] Turn updated: ${turnId} → status=${turn.status}`);
    return this.hydrate(turn);
  }

  private async hydrate(stored: Turn): Promise<Turn> {
    const [missions, tasks] = await Promise.all([
      this.missionStore.listMissions(),
      this.taskStore.listTasks(),
    ]);
    return {
      ...stored,
      missionIds: missions.filter((m) => m.turnId === stored.id).map((m) => m.id),
      taskIds: tasks.filter((t) => t.turnId === stored.id).map((t) => t.id),
      tele: [...stored.tele],
    };
  }
}
