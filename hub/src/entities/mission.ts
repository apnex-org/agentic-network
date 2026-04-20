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

import type { ITaskStore, EntityProvenance } from "../state.js";
import type { IIdeaStore, CascadeBacklink } from "./idea.js";

// ── Types ────────────────────────────────────────────────────────────

export type MissionStatus = "proposed" | "active" | "completed" | "abandoned";

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
  createdAt: string;
  updatedAt: string;
}

// ── Interface ────────────────────────────────────────────────────────

export interface IMissionStore {
  createMission(
    title: string,
    description: string,
    documentRef?: string,
    backlink?: CascadeBacklink
  ): Promise<Mission>;

  getMission(missionId: string): Promise<Mission | null>;

  listMissions(statusFilter?: MissionStatus): Promise<Mission[]>;

  updateMission(
    missionId: string,
    updates: { status?: MissionStatus; description?: string; documentRef?: string }
  ): Promise<Mission | null>;

  /** Mission-24 Phase 2 (ADR-014, INV-TH20): look up by natural key. */
  findByCascadeKey(key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">): Promise<Mission | null>;
}

// ── Memory Implementation ────────────────────────────────────────────

export class MemoryMissionStore implements IMissionStore {
  private missions = new Map<string, Mission>();
  private counter = 0;

  constructor(
    private readonly taskStore: ITaskStore,
    private readonly ideaStore: IIdeaStore,
  ) {}

  async createMission(
    title: string,
    description: string,
    documentRef?: string,
    backlink?: CascadeBacklink
  ): Promise<Mission> {
    this.counter++;
    const id = `mission-${this.counter}`;
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
      createdAt: now,
      updatedAt: now,
    };

    this.missions.set(id, mission);
    console.log(`[MemoryMissionStore] Mission created: ${id} — ${title}${backlink ? ` (cascade from ${backlink.sourceThreadId}/${backlink.sourceActionId})` : ""}`);
    return this.hydrate(mission);
  }

  async findByCascadeKey(key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">): Promise<Mission | null> {
    for (const m of this.missions.values()) {
      if (m.sourceThreadId === key.sourceThreadId && m.sourceActionId === key.sourceActionId) {
        return this.hydrate(m);
      }
    }
    return null;
  }

  async getMission(missionId: string): Promise<Mission | null> {
    const mission = this.missions.get(missionId);
    return mission ? this.hydrate(mission) : null;
  }

  async listMissions(statusFilter?: MissionStatus): Promise<Mission[]> {
    const all = Array.from(this.missions.values());
    const filtered = statusFilter
      ? all.filter((m) => m.status === statusFilter)
      : all;
    return Promise.all(filtered.map((m) => this.hydrate(m)));
  }

  async updateMission(
    missionId: string,
    updates: { status?: MissionStatus; description?: string; documentRef?: string }
  ): Promise<Mission | null> {
    const mission = this.missions.get(missionId);
    if (!mission) return null;

    if (updates.status) mission.status = updates.status;
    if (updates.description !== undefined) mission.description = updates.description;
    if (updates.documentRef !== undefined) mission.documentRef = updates.documentRef;
    mission.updatedAt = new Date().toISOString();

    console.log(`[MemoryMissionStore] Mission updated: ${missionId} → status=${mission.status}`);
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
