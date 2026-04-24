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

// Mission-47 W1: `MemoryTeleStore` deleted. `TeleRepository` in
// `tele-repository.ts` composes any `StorageProvider` (including
// `MemoryStorageProvider` for tests) via the ITeleStore interface.
