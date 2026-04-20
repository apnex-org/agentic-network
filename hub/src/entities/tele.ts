/**
 * Tele Entity — A declaration of perfection / qualitative asymptote.
 *
 * Static registry entry representing an end-state or guiding axiom.
 * No lifecycle — active once defined. Immutable after creation.
 *
 * Examples:
 *   "Absolute State Fidelity"
 *   "Zero Notification Loss"
 *   "Indestructible SSE Resilience"
 */

// ── Types ────────────────────────────────────────────────────────────

import type { EntityProvenance } from "../state.js";

export interface Tele {
  id: string;
  name: string;
  description: string;
  successCriteria: string; // Markdown describing the measurable target
  /** Mission-24 idea-120: uniform direct-create provenance (task-305). */
  createdBy?: EntityProvenance;
  createdAt: string;
}

// ── Interface ────────────────────────────────────────────────────────

export interface ITeleStore {
  defineTele(
    name: string,
    description: string,
    successCriteria: string,
    createdBy?: EntityProvenance
  ): Promise<Tele>;

  getTele(teleId: string): Promise<Tele | null>;

  listTele(): Promise<Tele[]>;
}

// ── Memory Implementation ────────────────────────────────────────────

export class MemoryTeleStore implements ITeleStore {
  private entries = new Map<string, Tele>();
  private counter = 0;

  async defineTele(
    name: string,
    description: string,
    successCriteria: string,
    createdBy?: EntityProvenance
  ): Promise<Tele> {
    this.counter++;
    const id = `tele-${this.counter}`;
    const now = new Date().toISOString();

    const tele: Tele = {
      id,
      name,
      description,
      successCriteria,
      createdBy,
      createdAt: now,
    };

    this.entries.set(id, tele);
    console.log(`[MemoryTeleStore] Tele defined: ${id} — ${name}`);
    return { ...tele };
  }

  async getTele(teleId: string): Promise<Tele | null> {
    const tele = this.entries.get(teleId);
    return tele ? { ...tele } : null;
  }

  async listTele(): Promise<Tele[]> {
    return Array.from(this.entries.values()).map((t) => ({ ...t }));
  }
}
