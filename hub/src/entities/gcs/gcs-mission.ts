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
import type { Mission, MissionStatus, IMissionStore } from "../mission.js";
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
    createdBy?: EntityProvenance
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
      createdAt: now,
      updatedAt: now,
    };

    await createOnly<Mission>(this.bucket, `missions/${id}.json`, mission);
    console.log(`[GcsMissionStore] Mission created: ${id} — ${title}${backlink ? ` (cascade from ${backlink.sourceThreadId}/${backlink.sourceActionId})` : ""}`);
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
    updates: { status?: MissionStatus; description?: string; documentRef?: string }
  ): Promise<Mission | null> {
    const path = `missions/${missionId}.json`;
    try {
      const mission = await updateExisting<Mission>(this.bucket, path, (m) => {
        if (updates.status) m.status = updates.status;
        if (updates.description !== undefined) m.description = updates.description;
        if (updates.documentRef !== undefined) m.documentRef = updates.documentRef;
        m.updatedAt = new Date().toISOString();
        return m;
      });
      console.log(`[GcsMissionStore] Mission updated: ${missionId} → status=${mission.status}`);
      return this.hydrate(mission);
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
