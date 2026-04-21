/**
 * GCS-backed Mission Store.
 *
 * `tasks` and `ideas` are computed as a virtual view on every read —
 * see `hub/src/entities/mission.ts` for the rationale (prior stored-array
 * implementation lost writes under concurrent auto-linkage).
 */

import {
  readJson,
  listFiles,
  getAndIncrementCounter,
  createOnly,
  updateExisting,
  GcsPathNotFound,
} from "../../gcs-state.js";
import type { Mission, MissionStatus, IMissionStore, PlannedTask } from "../mission.js";
import type { ITaskStore, EntityProvenance } from "../../state.js";
import type { IIdeaStore, CascadeBacklink } from "../idea.js";

export class GcsMissionStore implements IMissionStore {
  private bucket: string;

  constructor(
    bucket: string,
    private readonly taskStore: ITaskStore,
    private readonly ideaStore: IIdeaStore,
  ) {
    this.bucket = bucket;
    console.log(`[GcsMissionStore] Using bucket: gs://${bucket}`);
  }

  async createMission(
    title: string,
    description: string,
    documentRef?: string,
    backlink?: CascadeBacklink,
    createdBy?: EntityProvenance,
    plannedTasks?: PlannedTask[],
  ): Promise<Mission> {
    const num = await getAndIncrementCounter(this.bucket, "missionCounter");
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

    await createOnly<Mission>(this.bucket, `missions/${id}.json`, mission);
    console.log(`[GcsMissionStore] Mission created: ${id} — ${title}${backlink ? ` (cascade from ${backlink.sourceThreadId}/${backlink.sourceActionId})` : ""}${plannedTasks?.length ? ` [plannedTasks=${plannedTasks.length}]` : ""}`);
    return this.hydrate(mission);
  }

  async findByCascadeKey(key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">): Promise<Mission | null> {
    const files = await listFiles(this.bucket, "missions/");
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const m = await readJson<Mission>(this.bucket, file);
      if (m && m.sourceThreadId === key.sourceThreadId && m.sourceActionId === key.sourceActionId) {
        return this.hydrate(m);
      }
    }
    return null;
  }

  async getMission(missionId: string): Promise<Mission | null> {
    const mission = await readJson<Mission>(this.bucket, `missions/${missionId}.json`);
    return mission ? this.hydrate(mission) : null;
  }

  async listMissions(statusFilter?: MissionStatus): Promise<Mission[]> {
    const files = await listFiles(this.bucket, "missions/");
    const missions: Mission[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const m = await readJson<Mission>(this.bucket, file);
      if (m) {
        if (statusFilter && m.status !== statusFilter) continue;
        missions.push(m);
      }
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
    }
  ): Promise<Mission | null> {
    const path = `missions/${missionId}.json`;
    try {
      const mission = await updateExisting<Mission>(this.bucket, path, (m) => {
        if (updates.status) m.status = updates.status;
        if (updates.description !== undefined) m.description = updates.description;
        if (updates.documentRef !== undefined) m.documentRef = updates.documentRef;
        if (updates.plannedTasks !== undefined) m.plannedTasks = updates.plannedTasks.map((p) => ({ ...p }));
        m.updatedAt = new Date().toISOString();
        return m;
      });
      console.log(`[GcsMissionStore] Mission updated: ${missionId} → status=${mission.status}${updates.plannedTasks ? ` [plannedTasks=${updates.plannedTasks.length}]` : ""}`);
      return this.hydrate(mission);
    } catch (err) {
      if (err instanceof GcsPathNotFound) return null;
      throw err;
    }
  }

  async markPlannedTaskIssued(
    missionId: string,
    sequence: number,
    issuedTaskId: string,
  ): Promise<PlannedTask | null> {
    const path = `missions/${missionId}.json`;
    let result: PlannedTask | null = null;
    try {
      await updateExisting<Mission>(this.bucket, path, (m) => {
        if (!m.plannedTasks) return m;
        const slot = m.plannedTasks.find((p) => p.sequence === sequence);
        if (!slot || slot.status !== "unissued") return m;
        slot.status = "issued";
        slot.issuedTaskId = issuedTaskId;
        m.updatedAt = new Date().toISOString();
        result = { ...slot };
        return m;
      });
      if (result) {
        console.log(`[GcsMissionStore] plannedTask issued: ${missionId} seq=${sequence} → ${issuedTaskId}`);
      }
      return result;
    } catch (err) {
      if (err instanceof GcsPathNotFound) return null;
      throw err;
    }
  }

  async markPlannedTaskCompleted(
    missionId: string,
    issuedTaskId: string,
  ): Promise<PlannedTask | null> {
    const path = `missions/${missionId}.json`;
    let result: PlannedTask | null = null;
    try {
      await updateExisting<Mission>(this.bucket, path, (m) => {
        if (!m.plannedTasks) return m;
        const slot = m.plannedTasks.find((p) => p.issuedTaskId === issuedTaskId);
        if (!slot || slot.status !== "issued") return m;
        slot.status = "completed";
        m.updatedAt = new Date().toISOString();
        result = { ...slot };
        return m;
      });
      if (result) {
        console.log(`[GcsMissionStore] plannedTask completed: ${missionId} seq=${(result as PlannedTask).sequence} taskId=${issuedTaskId}`);
      }
      return result;
    } catch (err) {
      if (err instanceof GcsPathNotFound) return null;
      throw err;
    }
  }

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
}
