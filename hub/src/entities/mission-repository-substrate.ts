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
import { decodeEnvelopeToFlat } from "./shape-helpers.js";
import type { EntityProvenance } from "../state.js";
import type { IIdeaStore, CascadeBacklink } from "./idea.js";
import type {
  Mission,
  MissionStatus,
  IMissionStore,
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
    private readonly ideaStore: IIdeaStore,
  ) {}

  async createMission(
    title: string,
    description: string,
    documentRef?: string,
    backlink?: CascadeBacklink,
    createdBy?: EntityProvenance,
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
      ideas: [],
      correlationId: id,
      sourceThreadId: backlink?.sourceThreadId ?? null,
      sourceActionId: backlink?.sourceActionId ?? null,
      sourceThreadSummary: backlink?.sourceThreadSummary ?? null,
      createdBy,
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
        (backlink ? ` (cascade from ${backlink.sourceThreadId}/${backlink.sourceActionId})` : ""),
    );
    return this.hydrate(mission);
  }

  async findByCascadeKey(
    key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">,
  ): Promise<Mission | null> {
    // C3-R4b (dual-path collapse): flat cascade key; substrate translates via
    // renameMap (sourceThreadId→metadata.sourceThreadId, sourceActionId→
    // metadata.sourceActionId) — renameMap is the single field-path authority.
    // (mission-90 W8 already retired the legacy bare-row fallback: 0 bare rows.)
    const envelopeResult = await this.substrate.list<Mission>(KIND, {
      filter: {
        sourceThreadId: key.sourceThreadId,
        sourceActionId: key.sourceActionId,
      },
      limit: 1,
    });
    return envelopeResult.items[0] ? this.hydrate(envelopeResult.items[0]) : null;
  }

  async getMission(missionId: string): Promise<Mission | null> {
    const m = await this.substrate.get<Mission>(KIND, missionId);
    return m ? this.hydrate(m) : null;
  }

  async listMissions(statusFilter?: MissionStatus): Promise<Mission[]> {
    // mission-90 W8: envelope-only (TOLERANT/dual-shape retirement). Query
    // status.phase directly; the legacy bare-`status` UNION + dedupe (the
    // dual-shape data window) is retired — W6 proved all rows envelope.
    const { items } = statusFilter
      ? await this.substrate.list<Mission>(KIND, { filter: { "status.phase": statusFilter }, limit: 500 })
      : await this.substrate.list<Mission>(KIND, { limit: 500 });
    return Promise.all(items.map((m) => this.hydrate(m)));
  }

  async updateMission(
    missionId: string,
    updates: {
      status?: MissionStatus;
      description?: string;
      documentRef?: string;
      missionClass?: MissionClass;
      pulses?: MissionPulses;
    },
  ): Promise<Mission | null> {
    try {
      const updated = await this.casUpdate(missionId, (m) => {
        if (updates.status) m.status = updates.status;
        if (updates.description !== undefined) m.description = updates.description;
        if (updates.documentRef !== undefined) m.documentRef = updates.documentRef;
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

  // ── Internal ─────────────────────────────────────────────────────

  private async hydrate(stored: Mission): Promise<Mission> {
    // work-162: Task retired — Mission's only remaining virtual view is `ideas`.
    const ideas = await this.ideaStore.listIdeas();
    // mission-90 W8: decode envelope→flat (idea-327) at the read boundary.
    return {
      ...decodeEnvelopeToFlat(stored, "Mission"),
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
      // mission-90 W8: decode → flat so the transform reads relocated fields
      // (plannedTasks@spec, pulses@spec, status) flat; the write-encoder re-envelopes.
      const next = transform(decodeEnvelopeToFlat(existing.entity, "Mission"));
      const result = await this.substrate.putIfMatch(KIND, next, existing.resourceVersion);
      if (result.ok) return next;
      // revision-mismatch → retry from re-read
    }
    throw new Error(
      `[MissionRepositorySubstrate] casUpdate exhausted ${MAX_CAS_RETRIES} retries on ${missionId}`,
    );
  }
}
