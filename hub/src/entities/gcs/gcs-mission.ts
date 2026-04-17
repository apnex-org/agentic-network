/**
 * GCS-backed Mission Store.
 *
 * `tasks` and `ideas` are computed as a virtual view on every read —
 * see `hub/src/entities/mission.ts` for the rationale (prior stored-array
 * implementation lost writes under concurrent auto-linkage).
 */

import { readJson, writeJson, listFiles, getAndIncrementCounter } from "../../gcs-state.js";
import type { Mission, MissionStatus, IMissionStore } from "../mission.js";
import type { ITaskStore } from "../../state.js";
import type { IIdeaStore } from "../idea.js";

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
    documentRef?: string
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
      createdAt: now,
      updatedAt: now,
    };

    await writeJson(this.bucket, `missions/${id}.json`, mission);
    console.log(`[GcsMissionStore] Mission created: ${id} — ${title}`);
    return this.hydrate(mission);
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
    const mission = await readJson<Mission>(this.bucket, path);
    if (!mission) return null;

    if (updates.status) mission.status = updates.status;
    if (updates.description !== undefined) mission.description = updates.description;
    if (updates.documentRef !== undefined) mission.documentRef = updates.documentRef;
    mission.updatedAt = new Date().toISOString();

    await writeJson(this.bucket, path, mission);
    console.log(`[GcsMissionStore] Mission updated: ${missionId} → status=${mission.status}`);
    return this.hydrate(mission);
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
