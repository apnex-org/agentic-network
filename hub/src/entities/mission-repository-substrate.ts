/**
 * mission-83 W4.x.5 — MissionRepositorySubstrate
 *
 * Substrate-API version of MissionRepository (mission-47 W4 origin). Per Design
 * v1.3 §5.1 Option Y disposition (B) sibling-pattern. Implements IMissionStore
 * interface UNCHANGED (handler call-sites unchanged).
 *
 * Absorbs PulseSweeper-via-IMissionStore facade per W3.x.2 disposition: PulseSweeper
 * existing consumption pattern (listMissions filter for active missions with pulses)
 * works against substrate-composed MissionRepository unchanged.
 *
 * Per-entity logic preserved:
 *   - ID allocation via SubstrateCounter.next("missionCounter") ("mission-N" shape)
 *   - createMission → substrate.createOnly (conflict-on-existing; refuses to clobber)
 *   - findByCascadeKey → substrate.list with cascade-key filter (mission_cascade_idx
 *     hot-path per Mission SchemaDef v2)
 *   - updateMission → CAS retry loop via Design v1.4 getWithRevision + putIfMatch
 *     + mergePulsesPreservingBookkeeping (Mission-57 W1 PulseSweeper bookkeeping
 *     preservation discipline)
 *   - markPlannedTaskIssued / markPlannedTaskCompleted — CAS retry for plannedTasks
 *     slot transitions (issued / completed)
 *   - hydrate — virtual-view composition (tasks + ideas filtered by correlationId/
 *     missionId from injected taskStore + ideaStore)
 *
 * W4.x.5 — sixth-slice of W4.x sweep after W4.x.4 MessageRepositorySubstrate.
 */

import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import type { ITaskStore, EntityProvenance } from "../state.js";
import type { IIdeaStore, CascadeBacklink } from "./idea.js";
import type {
  Mission,
  MissionStatus,
  IMissionStore,
  PlannedTask,
  MissionClass,
  MissionPulses,
  PulseConfig,
} from "./mission.js";
import { PULSE_KEYS } from "./mission.js";
import { SubstrateCounter } from "./substrate-counter.js";

const KIND = "Mission";
const MAX_CAS_RETRIES = 50;

/**
 * Mission-57 W1: merge incoming pulse updates with existing on-disk sweeper-
 * managed bookkeeping. Ported byte-for-byte from MissionRepository.
 */
function mergePulsesPreservingBookkeeping(
  existing: MissionPulses | undefined,
  incoming: MissionPulses,
): MissionPulses {
  const result: MissionPulses = {};
  for (const key of PULSE_KEYS) {
    const e = existing?.[key];
    const i = incoming[key];
    if (!e && !i) continue;
    if (!i) {
      result[key] = { ...e! };
      continue;
    }
    if (!e) {
      result[key] = { ...i };
      continue;
    }
    const merged: PulseConfig = {
      intervalSeconds: i.intervalSeconds,
      message: i.message,
      responseShape: i.responseShape,
      missedThreshold: i.missedThreshold,
      firstFireDelaySeconds: i.firstFireDelaySeconds,
      lastFiredAt: i.lastFiredAt ?? e.lastFiredAt,
      lastResponseAt: i.lastResponseAt ?? e.lastResponseAt,
      missedCount: i.missedCount ?? e.missedCount,
      lastEscalatedAt: i.lastEscalatedAt ?? e.lastEscalatedAt,
    };
    result[key] = merged;
  }
  return result;
}

export class MissionRepositorySubstrate implements IMissionStore {
  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly counter: SubstrateCounter,
    private readonly taskStore: ITaskStore,
    private readonly ideaStore: IIdeaStore,
  ) {}

  async createMission(
    title: string,
    description: string,
    documentRef?: string,
    backlink?: CascadeBacklink,
    createdBy?: EntityProvenance,
    plannedTasks?: PlannedTask[],
    missionClass?: MissionClass,
    pulses?: MissionPulses,
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
      missionClass,
      pulses: pulses
        ? {
            engineerPulse: pulses.engineerPulse ? { ...pulses.engineerPulse } : undefined,
            architectPulse: pulses.architectPulse ? { ...pulses.architectPulse } : undefined,
          }
        : undefined,
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.substrate.createOnly(KIND, mission);
    if (!result.ok) {
      throw new Error(
        `[MissionRepositorySubstrate] createMission: counter issued existing ID ${id}; refusing to clobber`,
      );
    }
    console.log(
      `[MissionRepositorySubstrate] Mission created: ${id} — ${title}` +
        (backlink ? ` (cascade from ${backlink.sourceThreadId}/${backlink.sourceActionId})` : "") +
        (plannedTasks?.length ? ` [plannedTasks=${plannedTasks.length}]` : ""),
    );
    return this.hydrate(mission);
  }

  async findByCascadeKey(
    key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">,
  ): Promise<Mission | null> {
    const { items } = await this.substrate.list<Mission>(KIND, {
      filter: {
        sourceThreadId: key.sourceThreadId,
        sourceActionId: key.sourceActionId,
      },
      limit: 1,
    });
    return items[0] ? this.hydrate(items[0]) : null;
  }

  async getMission(missionId: string): Promise<Mission | null> {
    const m = await this.substrate.get<Mission>(KIND, missionId);
    return m ? this.hydrate(m) : null;
  }

  async listMissions(statusFilter?: MissionStatus): Promise<Mission[]> {
    const substrateFilter: Record<string, string> = {};
    if (statusFilter) substrateFilter.status = statusFilter;
    const { items } = await this.substrate.list<Mission>(KIND, {
      filter: Object.keys(substrateFilter).length > 0 ? substrateFilter : undefined,
      limit: 500,
    });
    return Promise.all(items.map((m) => this.hydrate(m)));
  }

  async updateMission(
    missionId: string,
    updates: {
      status?: MissionStatus;
      description?: string;
      documentRef?: string;
      plannedTasks?: PlannedTask[];
      missionClass?: MissionClass;
      pulses?: MissionPulses;
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
        if (updates.missionClass !== undefined) {
          m.missionClass = updates.missionClass;
        }
        if (updates.pulses !== undefined) {
          m.pulses = mergePulsesPreservingBookkeeping(m.pulses, updates.pulses);
        }
        m.updatedAt = new Date().toISOString();
        return m;
      });
      console.log(
        `[MissionRepositorySubstrate] Mission updated: ${missionId} → status=${updated.status}` +
          (updates.plannedTasks ? ` [plannedTasks=${updates.plannedTasks.length}]` : "") +
          (updates.missionClass ? ` [missionClass=${updates.missionClass}]` : "") +
          (updates.pulses ? ` [pulses-updated]` : ""),
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
          `[MissionRepositorySubstrate] plannedTask issued: ${missionId} seq=${sequence} → ${issuedTaskId}`,
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
          `[MissionRepositorySubstrate] plannedTask completed: ${missionId} seq=${(result as PlannedTask).sequence} taskId=${issuedTaskId}`,
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

  /**
   * Design v1.4 getWithRevision + putIfMatch CAS retry loop. Proper
   * substrate-boundary CAS preservation per Option Y.
   */
  private async casUpdate(
    missionId: string,
    transform: (current: Mission) => Mission,
  ): Promise<Mission> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<Mission>(KIND, missionId);
      if (!existing) throw new Error(`Mission not found: ${missionId}`);
      const next = transform({ ...existing.entity });
      const result = await this.substrate.putIfMatch(KIND, next, existing.resourceVersion);
      if (result.ok) return next;
      // revision-mismatch → retry from re-read
    }
    throw new Error(
      `[MissionRepositorySubstrate] casUpdate exhausted ${MAX_CAS_RETRIES} retries on ${missionId}`,
    );
  }
}
