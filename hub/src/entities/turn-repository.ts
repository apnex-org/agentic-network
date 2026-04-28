/**
 * TurnRepository — StorageProvider-backed Turn persistence.
 *
 * Mission-47 W7. Replaces `MemoryTurnStore` (turn.ts) + `GcsTurnStore`
 * (gcs/gcs-turn.ts). Implements `ITurnStore` unchanged.
 *
 * Virtual-view hydration preserved: `missionIds` + `taskIds` computed
 * on each read from the injected missionStore + taskStore by `turnId`
 * match (mirrors MissionRepository's tasks+ideas hydration).
 *
 * Layout matches historical GCS keyspace:
 *   turns/<turnId>.json   — per-turn blob
 *   meta/counter.json     — shared counter (turnCounter field)
 */

import type { StorageProvider } from "@apnex/storage-provider";
import { hasGetWithToken, StoragePathNotFoundError } from "@apnex/storage-provider";

import type { ITaskStore, EntityProvenance } from "../state.js";
import type { IMissionStore } from "./mission.js";
import type { ITurnStore, Turn, TurnStatus } from "./turn.js";
import { StorageBackedCounter } from "./counter.js";

const MAX_CAS_RETRIES = 50;

function turnPath(turnId: string): string {
  return `turns/${turnId}.json`;
}

function encode(t: Turn): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(t, null, 2));
}

function decode(bytes: Uint8Array): Turn {
  return JSON.parse(new TextDecoder().decode(bytes)) as Turn;
}

export class TurnRepository implements ITurnStore {
  constructor(
    private readonly provider: StorageProvider,
    private readonly counter: StorageBackedCounter,
    private readonly missionStore: IMissionStore,
    private readonly taskStore: ITaskStore,
  ) {
    if (!hasGetWithToken(provider)) {
      throw new Error(
        "TurnRepository requires a StorageProvider with atomic read-with-token support",
      );
    }
  }

  async createTurn(
    title: string,
    scope: string,
    tele?: string[],
    createdBy?: EntityProvenance,
  ): Promise<Turn> {
    const num = await this.counter.next("turnCounter");
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

    const result = await this.provider.createOnly(turnPath(id), encode(turn));
    if (!result.ok) {
      throw new Error(
        `[TurnRepository] createTurn: counter issued existing ID ${id}; refusing to clobber`,
      );
    }
    console.log(`[TurnRepository] Turn created: ${id} — ${title}`);
    return this.hydrate(turn);
  }

  async getTurn(turnId: string): Promise<Turn | null> {
    const raw = await this.provider.get(turnPath(turnId));
    return raw ? this.hydrate(decode(raw)) : null;
  }

  async listTurns(statusFilter?: TurnStatus): Promise<Turn[]> {
    const keys = await this.provider.list("turns/");
    const turns: Turn[] = [];
    for (const key of keys) {
      if (!key.endsWith(".json")) continue;
      const raw = await this.provider.get(key);
      if (!raw) continue;
      const t = decode(raw);
      if (statusFilter && t.status !== statusFilter) continue;
      turns.push(t);
    }
    return Promise.all(turns.map((t) => this.hydrate(t)));
  }

  async updateTurn(
    turnId: string,
    updates: { status?: TurnStatus; scope?: string; tele?: string[] },
  ): Promise<Turn | null> {
    try {
      const updated = await this.casUpdate(turnId, (t) => {
        if (updates.status) t.status = updates.status;
        if (updates.scope !== undefined) t.scope = updates.scope;
        if (updates.tele) t.tele = updates.tele;
        t.updatedAt = new Date().toISOString();
        return t;
      });
      console.log(`[TurnRepository] Turn updated: ${turnId} → status=${updated.status}`);
      return this.hydrate(updated);
    } catch (err) {
      if (err instanceof Error && err.message === `Turn not found: ${turnId}`) return null;
      throw err;
    }
  }

  // ── Internal ─────────────────────────────────────────────────────

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

  private async casUpdate(
    turnId: string,
    transform: (current: Turn) => Turn,
  ): Promise<Turn> {
    const path = turnPath(turnId);
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const read = await (this.provider as unknown as {
        getWithToken(path: string): Promise<{ data: Uint8Array; token: string } | null>;
      }).getWithToken(path);
      if (read === null) throw new Error(`Turn not found: ${turnId}`);
      const next = transform(decode(read.data));
      try {
        const result = await this.provider.putIfMatch(path, encode(next), read.token);
        if (result.ok) return next;
      } catch (err) {
        if (err instanceof StoragePathNotFoundError) {
          throw new Error(`Turn not found: ${turnId}`);
        }
        throw err;
      }
    }
    throw new Error(
      `[TurnRepository] casUpdate exhausted ${MAX_CAS_RETRIES} retries on ${turnId}`,
    );
  }
}
