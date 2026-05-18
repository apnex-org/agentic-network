/**
 * mission-83 W4.x.9 — TeleRepositorySubstrate
 *
 * Substrate-API version of TeleRepository (mission-47 W1 origin). Per Design v1.3
 * §5.1 Option Y disposition (B) sibling-pattern. Implements ITeleStore interface
 * UNCHANGED (handler call-sites unchanged).
 *
 * Per-entity logic preserved:
 *   - ID allocation via SubstrateCounter.next("teleCounter") ("tele-N" shape)
 *   - normalizeTele read-side normalization (mission-43 zero-backfill discipline)
 *   - defineTele → substrate.createOnly (conflict-on-existing)
 *   - supersedeTele/retireTele — CAS retry via Design v1.4 getWithRevision +
 *     putIfMatch (proper substrate-boundary CAS replacing legacy provider.putIfMatch)
 *   - supersedeTele successor-existence pre-check (avoids partial-state)
 *
 * W4.x.9 — tenth-slice of W4.x sweep after W4.x.8 TaskRepositorySubstrate.
 */

import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import type { EntityProvenance } from "../state.js";
import type { ITeleStore, Tele } from "./tele.js";
import { normalizeTele } from "./tele.js";
import { SubstrateCounter } from "./substrate-counter.js";

const KIND = "Tele";
const MAX_CAS_RETRIES = 50;

export class TeleRepositorySubstrate implements ITeleStore {
  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly counter: SubstrateCounter,
  ) {}

  async defineTele(
    name: string,
    description: string,
    successCriteria: string,
    createdBy?: EntityProvenance,
  ): Promise<Tele> {
    const num = await this.counter.next("teleCounter");
    const id = `tele-${num}`;
    const now = new Date().toISOString();
    const tele: Tele = {
      id,
      name,
      description,
      successCriteria,
      status: "active",
      createdBy,
      createdAt: now,
    };
    const result = await this.substrate.createOnly(KIND, tele);
    if (!result.ok) {
      throw new Error(
        `[TeleRepositorySubstrate] defineTele: counter issued existing ID ${id}; refusing to clobber`,
      );
    }
    console.log(`[TeleRepositorySubstrate] Tele defined: ${id} — ${name}`);
    return { ...tele };
  }

  async getTele(teleId: string): Promise<Tele | null> {
    const raw = await this.substrate.get<Tele>(KIND, teleId);
    if (!raw) return null;
    return normalizeTele(raw);
  }

  async listTele(): Promise<Tele[]> {
    const { items } = await this.substrate.list<Tele>(KIND, { limit: 500 });
    return items.map(normalizeTele);
  }

  async supersedeTele(teleId: string, successorId: string): Promise<Tele> {
    // Verify successor exists before mutating source — avoids partial state.
    const successor = await this.getTele(successorId);
    if (!successor) {
      throw new Error(`Successor tele not found: ${successorId}`);
    }
    return this.casUpdate(teleId, (tele) => {
      if (tele.status === "retired") {
        throw new Error(`Tele ${teleId} is retired; cannot be superseded`);
      }
      return { ...tele, status: "superseded", supersededBy: successorId };
    }, `supersede ${teleId} → ${successorId}`);
  }

  async retireTele(teleId: string): Promise<Tele> {
    return this.casUpdate(teleId, (tele) => ({
      ...tele,
      status: "retired",
      retiredAt: new Date().toISOString(),
    }), `retire ${teleId}`);
  }

  // ── Internal ─────────────────────────────────────────────────────

  /**
   * Read → transform → putIfMatch with retry via Design v1.4 getWithRevision.
   */
  private async casUpdate(
    teleId: string,
    transform: (current: Tele) => Tele,
    description: string,
  ): Promise<Tele> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<Tele>(KIND, teleId);
      if (!existing) throw new Error(`Tele not found: ${teleId}`);
      const current = normalizeTele(existing.entity);
      const next = transform(current);
      const result = await this.substrate.putIfMatch(KIND, next, existing.resourceVersion);
      if (result.ok) {
        console.log(`[TeleRepositorySubstrate] ${description}`);
        return next;
      }
      // revision-mismatch → retry from re-read
    }
    throw new Error(
      `[TeleRepositorySubstrate] casUpdate exhausted ${MAX_CAS_RETRIES} retries on ${teleId}`,
    );
  }
}
