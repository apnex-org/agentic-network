/**
 * GCS-backed Turn Store.
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

export class GcsTurnStore implements ITurnStore {
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
    console.log(`[GcsTurnStore] Using bucket: gs://${bucket}`);
  }

  async createTurn(
    title: string,
    scope: string,
    tele?: string[]
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
      createdAt: now,
      updatedAt: now,
    };

    await createOnly<Turn>(this.bucket, `turns/${id}.json`, turn);
    console.log(`[GcsTurnStore] Turn created: ${id} — ${title}`);
    return { ...turn, missionIds: [...turn.missionIds], taskIds: [...turn.taskIds], tele: [...turn.tele] };
  }

  async getTurn(turnId: string): Promise<Turn | null> {
    return await readJson<Turn>(this.bucket, `turns/${turnId}.json`);
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
    return turns;
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
      return { ...turn, missionIds: [...turn.missionIds], taskIds: [...turn.taskIds], tele: [...turn.tele] };
    } catch (err) {
      if (err instanceof GcsPathNotFound) return null;
      throw err;
    }
  }

  async linkMission(turnId: string, missionId: string): Promise<void> {
    const path = `turns/${turnId}.json`;
    try {
      await updateExisting<Turn>(this.bucket, path, (turn) => {
        if (!turn.missionIds.includes(missionId)) {
          turn.missionIds.push(missionId);
          turn.updatedAt = new Date().toISOString();
          console.log(`[GcsTurnStore] Linked mission ${missionId} to ${turnId}`);
        }
        return turn;
      });
    } catch (err) {
      if (err instanceof GcsPathNotFound) throw new Error(`Turn not found: ${turnId}`);
      throw err;
    }
  }

  async linkTask(turnId: string, taskId: string): Promise<void> {
    const path = `turns/${turnId}.json`;
    try {
      await updateExisting<Turn>(this.bucket, path, (turn) => {
        if (!turn.taskIds.includes(taskId)) {
          turn.taskIds.push(taskId);
          turn.updatedAt = new Date().toISOString();
          console.log(`[GcsTurnStore] Linked task ${taskId} to ${turnId}`);
        }
        return turn;
      });
    } catch (err) {
      if (err instanceof GcsPathNotFound) throw new Error(`Turn not found: ${turnId}`);
      throw err;
    }
  }
}
