/**
 * Tele Entity — A declaration of perfection / qualitative asymptote.
 *
 * Static registry entry representing an end-state or guiding axiom.
 * Mission-43 adds lifecycle primitives (supersede / retire) so that
 * ratified tele-audits can evolve the registry without direct-write
 * workarounds. Content remains immutable after creation; only the
 * `status` / `supersededBy` / `retiredAt` fields mutate via dedicated
 * lifecycle tools.
 */

// ── Types ────────────────────────────────────────────────────────────

import type { EntityProvenance } from "../state.js";

export type TeleStatus = "active" | "superseded" | "retired";

export interface Tele {
  id: string;
  name: string;
  description: string;
  successCriteria: string; // Markdown describing the measurable target
  /** Mission-43: lifecycle state. Always present in returned objects —
   * stores normalize legacy docs without this field to `"active"` on
   * read (no write-back; zero-backfill discipline per mission-43 Dec 2). */
  status: TeleStatus;
  /** Mission-43: when status="superseded", id of the successor tele. */
  supersededBy?: string;
  /** Mission-43: when status="retired", ISO-8601 timestamp of retirement. */
  retiredAt?: string;
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

  /** Mission-43: mark `teleId` superseded by `successorId`. Throws if
   * tele not found or if it's already retired. No-op if already
   * superseded by the same successor (idempotent). */
  supersedeTele(teleId: string, successorId: string): Promise<Tele>;

  /** Mission-43: mark `teleId` retired. Throws if tele not found.
   * Retirement is terminal — a retired tele cannot be un-retired or
   * re-superseded. */
  retireTele(teleId: string): Promise<Tele>;
}

// ── Normalizer ───────────────────────────────────────────────────────

/** Fill default `status: "active"` for legacy docs that lack the field.
 * Pure read-side transform — callers must NOT write the normalized
 * object back to storage (zero-backfill discipline per mission-43
 * Decision 2). */
export function normalizeTele(raw: Tele): Tele {
  if (raw.status) return raw;
  return { ...raw, status: "active" };
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
      status: "active",
      createdBy,
      createdAt: now,
    };

    this.entries.set(id, tele);
    console.log(`[MemoryTeleStore] Tele defined: ${id} — ${name}`);
    return { ...tele };
  }

  async getTele(teleId: string): Promise<Tele | null> {
    const tele = this.entries.get(teleId);
    return tele ? normalizeTele({ ...tele }) : null;
  }

  async listTele(): Promise<Tele[]> {
    return Array.from(this.entries.values()).map((t) => normalizeTele({ ...t }));
  }

  async supersedeTele(teleId: string, successorId: string): Promise<Tele> {
    const current = this.entries.get(teleId);
    if (!current) throw new Error(`Tele not found: ${teleId}`);
    const normalized = normalizeTele(current);
    if (normalized.status === "retired") {
      throw new Error(`Tele ${teleId} is retired; cannot be superseded`);
    }
    const successor = this.entries.get(successorId);
    if (!successor) throw new Error(`Successor tele not found: ${successorId}`);
    const next: Tele = { ...normalized, status: "superseded", supersededBy: successorId };
    this.entries.set(teleId, next);
    console.log(`[MemoryTeleStore] Tele superseded: ${teleId} → ${successorId}`);
    return { ...next };
  }

  async retireTele(teleId: string): Promise<Tele> {
    const current = this.entries.get(teleId);
    if (!current) throw new Error(`Tele not found: ${teleId}`);
    const normalized = normalizeTele(current);
    const next: Tele = { ...normalized, status: "retired", retiredAt: new Date().toISOString() };
    this.entries.set(teleId, next);
    console.log(`[MemoryTeleStore] Tele retired: ${teleId}`);
    return { ...next };
  }
}
