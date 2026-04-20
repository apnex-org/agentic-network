/**
 * GCS-backed Turn Store.
 *
 * `missionIds` and `taskIds` are computed as a virtual view on every
 * read — see `hub/src/entities/turn.ts` for the rationale (mirrors the
 * Mission.tasks / Mission.ideas pattern; there are no legacy writers
 * to coordinate with, so this is the cheapest P1 migration per
 * `docs/history/mission-20-phase1-audit.md §2.1`).
 */

import {
  readJson,
  listFiles,
  getAndIncrementCounter,
  createOnly,
  updateExisting,
  GcsPathNotFound,
} from "../../gcs-state.js";
import type { Turn, TurnStatus, ITurnStore } from "../turn.js";
import type { ITaskStore, EntityProvenance } from "../../state.js";
import type { IMissionStore } from "../mission.js";

export class GcsTurnStore implements ITurnStore {
  private bucket: string;

  constructor(
    bucket: string,
    private readonly missionStore: IMissionStore,
    private readonly taskStore: ITaskStore,
  ) {
    this.bucket = bucket;
    console.log(`[GcsTurnStore] Using bucket: gs://${bucket}`);
  }

  async createTurn(
    title: string,
    scope: string,
    tele?: string[],
    createdBy?: EntityProvenance
  ): Promise<Turn> {
    const num = await getAndIncrementCounter(this.bucket, "turnCounter");
    const id = `turn-${num}`;
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
      createdBy,
      createdAt: now,
      updatedAt: now,
    };

    await createOnly<Turn>(this.bucket, `turns/${id}.json`, turn);
    console.log(`[GcsTurnStore] Turn created: ${id} — ${title}`);
    return this.hydrate(turn);
  }

  async getTurn(turnId: string): Promise<Turn | null> {
    const turn = await readJson<Turn>(this.bucket, `turns/${turnId}.json`);
    return turn ? this.hydrate(turn) : null;
  }

  async listTurns(statusFilter?: TurnStatus): Promise<Turn[]> {
    const files = await listFiles(this.bucket, "turns/");
    const turns: Turn[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const t = await readJson<Turn>(this.bucket, file);
      if (t) {
        if (statusFilter && t.status !== statusFilter) continue;
        turns.push(t);
      }
    }
    return Promise.all(turns.map((t) => this.hydrate(t)));
  }

  async updateTurn(
    turnId: string,
    updates: { status?: TurnStatus; scope?: string; tele?: string[] }
  ): Promise<Turn | null> {
    const path = `turns/${turnId}.json`;
    try {
      const turn = await updateExisting<Turn>(this.bucket, path, (t) => {
        if (updates.status) t.status = updates.status;
        if (updates.scope !== undefined) t.scope = updates.scope;
        if (updates.tele) t.tele = updates.tele;
        t.updatedAt = new Date().toISOString();
        return t;
      });
      console.log(`[GcsTurnStore] Turn updated: ${turnId} → status=${turn.status}`);
      return this.hydrate(turn);
    } catch (err) {
      if (err instanceof GcsPathNotFound) return null;
      throw err;
    }
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
