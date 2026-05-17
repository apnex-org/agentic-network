/**
 * mission-83 W4.x.11 — TurnRepositorySubstrate
 *
 * Substrate-API version of TurnRepository (mission-47 W7 origin). Per Design v1.3
 * §5.1 Option Y disposition (B) sibling-pattern. Implements ITurnStore interface
 * UNCHANGED (handler call-sites unchanged).
 *
 * Per-entity logic preserved:
 *   - ID allocation via SubstrateCounter.next("turnCounter") ("turn-N" shape)
 *   - createTurn → substrate.createOnly (conflict-on-existing)
 *   - updateTurn → CAS retry via Design v1.4 getWithRevision + putIfMatch
 *   - hydrate — virtual-view composition (missionIds + taskIds filtered by
 *     turnId from injected missionStore + taskStore; same pattern as
 *     MissionRepositorySubstrate.hydrate)
 *
 * W4.x.11 — twelfth-slice of W4.x sweep after W4.x.10 ThreadRepositorySubstrate.
 * COMPLETES 11/11 existing-sibling repository ports (W4.x.1-11).
 */

import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import type { ITaskStore, EntityProvenance } from "../state.js";
import type { IMissionStore } from "./mission.js";
import type { ITurnStore, Turn, TurnStatus } from "./turn.js";
import { SubstrateCounter } from "./substrate-counter.js";

const KIND = "Turn";
const MAX_CAS_RETRIES = 50;

export class TurnRepositorySubstrate implements ITurnStore {
  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly counter: SubstrateCounter,
    private readonly missionStore: IMissionStore,
    private readonly taskStore: ITaskStore,
  ) {}

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

    const result = await this.substrate.createOnly(KIND, turn);
    if (!result.ok) {
      throw new Error(
        `[TurnRepositorySubstrate] createTurn: counter issued existing ID ${id}; refusing to clobber`,
      );
    }
    console.log(`[TurnRepositorySubstrate] Turn created: ${id} — ${title}`);
    return this.hydrate(turn);
  }

  async getTurn(turnId: string): Promise<Turn | null> {
    const turn = await this.substrate.get<Turn>(KIND, turnId);
    return turn ? this.hydrate(turn) : null;
  }

  async listTurns(statusFilter?: TurnStatus): Promise<Turn[]> {
    const substrateFilter: Record<string, string> = {};
    if (statusFilter) substrateFilter.status = statusFilter;
    const { items } = await this.substrate.list<Turn>(KIND, {
      filter: Object.keys(substrateFilter).length > 0 ? substrateFilter : undefined,
      limit: 500,
    });
    return Promise.all(items.map((t) => this.hydrate(t)));
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
      console.log(`[TurnRepositorySubstrate] Turn updated: ${turnId} → status=${updated.status}`);
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

  /**
   * Design v1.4 getWithRevision + putIfMatch CAS retry loop. Proper
   * substrate-boundary CAS.
   */
  private async casUpdate(
    turnId: string,
    transform: (current: Turn) => Turn,
  ): Promise<Turn> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<Turn>(KIND, turnId);
      if (!existing) throw new Error(`Turn not found: ${turnId}`);
      const next = transform({ ...existing.entity });
      const result = await this.substrate.putIfMatch(KIND, next, existing.resourceVersion);
      if (result.ok) return next;
      // revision-mismatch → retry from re-read
    }
    throw new Error(
      `[TurnRepositorySubstrate] casUpdate exhausted ${MAX_CAS_RETRIES} retries on ${turnId}`,
    );
  }
}
