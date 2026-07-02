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
import { phaseFromEntity } from "./shape-helpers.js";
import { assertDecodedFlat } from "../storage-substrate/bare-envelope-error.js";

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

/** Full envelope→legacy-flat DECODE + fill default `status: "active"`.
 *
 * mission-90 W4 (bug-152 / idea-320): Tele relocates description/successCriteria
 * → spec, supersededBy/retiredAt → status, name → metadata.name, and renames
 * status → status.phase (Tele.ts partition + renameMap). The prior `if
 * (raw.status) return raw` returned the ENVELOPE OBJECT unchanged on migrated
 * rows → the supersede/retire FSM gates (`current.status === "retired"`) compared
 * an object and never fired, and get_tele/list_tele returned the raw envelope.
 * Decode here (the only Tele read-normalizer; casUpdate normalizes BEFORE the
 * transform, so the gates read this output): flatten the buckets — every relocated
 * field keeps its leaf name, only status→phase is a leaf-rename — derive status via
 * phaseFromEntity (legacy default "active" preserved for docs lacking the field),
 * and STRIP the envelope artifacts so the CAS put-back re-encodes a CLEAN legacy-
 * flat row (leftover metadata/spec objects would re-partition into garbage). Bare
 * rows: buckets absent → already legacy-flat.
 *
 * Pure read-side transform on READ paths (getTele/listTele) — those callers do
 * NOT write back (zero-backfill discipline per mission-43 Decision 2); the
 * supersede/retire paths legitimately mutate + write (not a backfill). */
export function normalizeTele(raw: Tele): Tele {
  const r = raw as unknown as Record<string, unknown>;
  const asObj = (v: unknown): Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const flat: Record<string, unknown> = {
    ...r,
    ...asObj(r.metadata),
    ...asObj(r.spec),
    ...asObj(r.status),
  };
  delete flat.metadata;
  delete flat.spec;
  delete flat.status;
  delete flat.phase;
  delete flat.apiVersion;
  delete flat.kind;
  return assertDecodedFlat({ ...flat, status: phaseFromEntity(raw) ?? "active" } as unknown as Tele, "Tele");
}

// Mission-47 W1: `MemoryTeleStore` deleted. `TeleRepository` in
// `tele-repository.ts` composes any `StorageProvider` (including
// `MemoryStorageProvider` for tests) via the ITeleStore interface.
