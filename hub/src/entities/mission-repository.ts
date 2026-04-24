/**
 * MissionRepository — StorageProvider-backed Mission persistence.
 *
 * Mission-47 W4. Replaces `MemoryMissionStore` + `GcsMissionStore`.
 * Implements `IMissionStore` unchanged — policy callers (mission-policy,
 * task-policy advancement cascade, proposal-policy scaffolder, thread
 * cascade handlers) keep working against the same surface.
 *
 * Virtual-view hydration (tasks + ideas filtered by correlationId /
 * missionId) preserved exactly — see mission.ts header for rationale.
 *
 * Layout matches the historical GCS object keyspace:
 *   missions/<missionId>.json   — per-mission blob
 *   meta/counter.json           — shared counter blob (missionCounter)
 */

import type { StorageProvider } from "@ois/storage-provider";
import { hasGetWithToken, StoragePathNotFoundError } from "@ois/storage-provider";

import type { ITaskStore, EntityProvenance } from "../state.js";
import type { IIdeaStore, CascadeBacklink } from "./idea.js";
import type {
  Mission,
  MissionStatus,
  IMissionStore,
  PlannedTask,
} from "./mission.js";
import { StorageBackedCounter } from "./counter.js";

const MAX_CAS_RETRIES = 50;

function missionPath(missionId: string): string {
  return `missions/${missionId}.json`;
}

function encode(m: Mission): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(m, null, 2));
}

function decode(bytes: Uint8Array): Mission {
  return JSON.parse(new TextDecoder().decode(bytes)) as Mission;
}

export class MissionRepository implements IMissionStore {
  constructor(
    private readonly provider: StorageProvider,
    private readonly counter: StorageBackedCounter,
    private readonly taskStore: ITaskStore,
    private readonly ideaStore: IIdeaStore,
  ) {
    if (!hasGetWithToken(provider)) {
      throw new Error(
        "MissionRepository requires a StorageProvider with atomic read-with-token support",
      );
    }
  }

  async createMission(
    title: string,
    description: string,
    documentRef?: string,
    backlink?: CascadeBacklink,
    createdBy?: EntityProvenance,
    plannedTasks?: PlannedTask[],
  ): Promise<Mission> {
    const num = await this.counter.next("missionCounter");
    const id = `mission-${num}`;
    const now = new Date().toISOString();

    const mission: Mission = {
      id,
      title,
      description,
      documentRef: documentRef || null,
      status: "proposed",
      tasks: [],
      ideas: [],
      correlationId: id,
      turnId: null,
      sourceThreadId: backlink?.sourceThreadId ?? null,
      sourceActionId: backlink?.sourceActionId ?? null,
      sourceThreadSummary: backlink?.sourceThreadSummary ?? null,
      createdBy,
      plannedTasks: plannedTasks ? plannedTasks.map((p) => ({ ...p })) : undefined,
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.provider.createOnly(missionPath(id), encode(mission));
    if (!result.ok) {
      throw new Error(
        `[MissionRepository] createMission: counter issued existing ID ${id}; refusing to clobber`,
      );
    }
    console.log(
      `[MissionRepository] Mission created: ${id} — ${title}` +
        (backlink ? ` (cascade from ${backlink.sourceThreadId}/${backlink.sourceActionId})` : "") +
        (plannedTasks?.length ? ` [plannedTasks=${plannedTasks.length}]` : ""),
    );
    return this.hydrate(mission);
  }

  async findByCascadeKey(
    key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">,
  ): Promise<Mission | null> {
    const keys = await this.provider.list("missions/");
    for (const path of keys) {
      if (!path.endsWith(".json")) continue;
      const raw = await this.provider.get(path);
      if (!raw) continue;
      const m = decode(raw);
      if (m.sourceThreadId === key.sourceThreadId && m.sourceActionId === key.sourceActionId) {
        return this.hydrate(m);
      }
    }
    return null;
  }

  async getMission(missionId: string): Promise<Mission | null> {
    const raw = await this.provider.get(missionPath(missionId));
    return raw ? this.hydrate(decode(raw)) : null;
  }

  async listMissions(statusFilter?: MissionStatus): Promise<Mission[]> {
    const keys = await this.provider.list("missions/");
    const missions: Mission[] = [];
    for (const key of keys) {
      if (!key.endsWith(".json")) continue;
      const raw = await this.provider.get(key);
      if (!raw) continue;
      const m = decode(raw);
      if (statusFilter && m.status !== statusFilter) continue;
      missions.push(m);
    }
    return Promise.all(missions.map((m) => this.hydrate(m)));
  }

  async updateMission(
    missionId: string,
    updates: {
      status?: MissionStatus;
      description?: string;
      documentRef?: string;
      plannedTasks?: PlannedTask[];
    },
  ): Promise<Mission | null> {
    try {
      const updated = await this.casUpdate(missionId, (m) => {
        if (updates.status) m.status = updates.status;
        if (updates.description !== undefined) m.description = updates.description;
        if (updates.documentRef !== undefined) m.documentRef = updates.documentRef;
        if (updates.plannedTasks !== undefined) {
          m.plannedTasks = updates.plannedTasks.map((p) => ({ ...p }));
        }
        m.updatedAt = new Date().toISOString();
        return m;
      });
      console.log(
        `[MissionRepository] Mission updated: ${missionId} → status=${updated.status}` +
          (updates.plannedTasks ? ` [plannedTasks=${updates.plannedTasks.length}]` : ""),
      );
      return this.hydrate(updated);
    } catch (err) {
      if (err instanceof Error && err.message === `Mission not found: ${missionId}`) {
        return null;
      }
      throw err;
    }
  }

  async markPlannedTaskIssued(
    missionId: string,
    sequence: number,
    issuedTaskId: string,
  ): Promise<PlannedTask | null> {
    let result: PlannedTask | null = null;
    try {
      await this.casUpdate(missionId, (m) => {
        if (!m.plannedTasks) {
          result = null;
          return m;
        }
        const slot = m.plannedTasks.find((p) => p.sequence === sequence);
        if (!slot || slot.status !== "unissued") {
          result = null;
          return m;
        }
        slot.status = "issued";
        slot.issuedTaskId = issuedTaskId;
        m.updatedAt = new Date().toISOString();
        result = { ...slot };
        return m;
      });
      if (result) {
        console.log(
          `[MissionRepository] plannedTask issued: ${missionId} seq=${sequence} → ${issuedTaskId}`,
        );
      }
      return result;
    } catch (err) {
      if (err instanceof Error && err.message === `Mission not found: ${missionId}`) {
        return null;
      }
      throw err;
    }
  }

  async markPlannedTaskCompleted(
    missionId: string,
    issuedTaskId: string,
  ): Promise<PlannedTask | null> {
    let result: PlannedTask | null = null;
    try {
      await this.casUpdate(missionId, (m) => {
        if (!m.plannedTasks) {
          result = null;
          return m;
        }
        const slot = m.plannedTasks.find((p) => p.issuedTaskId === issuedTaskId);
        if (!slot || slot.status !== "issued") {
          result = null;
          return m;
        }
        slot.status = "completed";
        m.updatedAt = new Date().toISOString();
        result = { ...slot };
        return m;
      });
      if (result) {
        console.log(
          `[MissionRepository] plannedTask completed: ${missionId} seq=${(result as PlannedTask).sequence} taskId=${issuedTaskId}`,
        );
      }
      return result;
    } catch (err) {
      if (err instanceof Error && err.message === `Mission not found: ${missionId}`) {
        return null;
      }
      throw err;
    }
  }

  // ── Internal ─────────────────────────────────────────────────────

  private async hydrate(stored: Mission): Promise<Mission> {
    const [tasks, ideas] = await Promise.all([
      this.taskStore.listTasks(),
      this.ideaStore.listIdeas(),
    ]);
    return {
      ...stored,
      tasks: tasks.filter((t) => t.correlationId === stored.id).map((t) => t.id),
      ideas: ideas.filter((i) => i.missionId === stored.id).map((i) => i.id),
    };
  }

  private async casUpdate(
    missionId: string,
    transform: (current: Mission) => Mission,
  ): Promise<Mission> {
    const path = missionPath(missionId);
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const read = await (this.provider as unknown as {
        getWithToken(path: string): Promise<{ data: Uint8Array; token: string } | null>;
      }).getWithToken(path);
      if (read === null) throw new Error(`Mission not found: ${missionId}`);
      const next = transform(decode(read.data));
      try {
        const result = await this.provider.putIfMatch(path, encode(next), read.token);
        if (result.ok) return next;
      } catch (err) {
        if (err instanceof StoragePathNotFoundError) {
          throw new Error(`Mission not found: ${missionId}`);
        }
        throw err;
      }
    }
    throw new Error(
      `[MissionRepository] casUpdate exhausted ${MAX_CAS_RETRIES} retries on ${missionId}`,
    );
  }
}
