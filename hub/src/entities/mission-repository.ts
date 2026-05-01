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

import type { StorageProvider } from "@apnex/storage-provider";
import { hasGetWithToken, StoragePathNotFoundError } from "@apnex/storage-provider";

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
  PulseKey,
} from "./mission.js";
import { PULSE_KEYS } from "./mission.js";
import { StorageBackedCounter } from "./counter.js";

const MAX_CAS_RETRIES = 50;

function missionPath(missionId: string): string {
  return `missions/${missionId}.json`;
}

/**
 * Mission-57 W1: merge incoming pulse updates with existing on-disk
 * sweeper-managed bookkeeping (lastFiredAt / lastResponseAt / missedCount /
 * lastEscalatedAt). Used by `updateMission` so callers replacing
 * engineer-authored config don't accidentally clobber sweeper bookkeeping.
 *
 * Per Design v1.0 §3 default-injection semantics: sweeper-managed fields
 * are read-only via MCP tools (stripped at `mission-policy.ts:update_mission`
 * boundary). They reach this repository only via direct PulseSweeper
 * updates. So a typical MCP-driven `updateMission` call has incoming
 * pulses with NO bookkeeping fields; existing on-disk bookkeeping must be
 * preserved.
 *
 * Merge rules per pulse-key:
 *   - Both sides absent → result absent
 *   - Only existing-side present → preserve it
 *   - Only incoming present → take incoming verbatim (no existing bookkeeping)
 *   - Both present → take incoming engineer-authored fields; preserve
 *     existing sweeper bookkeeping ONLY when incoming bookkeeping fields
 *     are explicitly undefined (the MCP-stripping case)
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
    // Both present — take incoming engineer-authored; preserve existing
    // sweeper bookkeeping when incoming bookkeeping fields are undefined.
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
          // Mission-57 W1: pulses replacement is wholesale per pulse-key.
          // Sweeper-managed bookkeeping fields (lastFiredAt / lastResponseAt /
          // missedCount / lastEscalatedAt) are stripped at the MCP-tool
          // boundary in `mission-policy.ts:update_mission` before calling
          // here — only PulseSweeper writes those via direct repository
          // updates that bypass the MCP surface. Preserve any
          // sweeper-managed bookkeeping that already exists when callers
          // update only engineer-authored fields.
          m.pulses = mergePulsesPreservingBookkeeping(m.pulses, updates.pulses);
        }
        m.updatedAt = new Date().toISOString();
        return m;
      });
      console.log(
        `[MissionRepository] Mission updated: ${missionId} → status=${updated.status}` +
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
