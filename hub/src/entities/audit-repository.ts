/**
 * AuditRepository — StorageProvider-backed persistence for AuditEntry.
 *
 * Mission-49 W8 (continuation of mission-47's entity-store wave pattern).
 * Replaces `MemoryAuditStore` + `GcsAuditStore` with a single class that
 * composes any `StorageProvider`. Implements `IAuditStore` unchanged —
 * consumers in `hub/src/index.ts` and `hub-networking.ts` continue to
 * work without edits.
 *
 * GCS namespace cutover (thread-304 Point B): writes to `audit/v2/${id}.json`.
 * `listEntries` reads only from `audit/v2/`. Pre-migration entries at
 * `gs://$bucket/audit/${ts}.json` (legacy timestamp-ID format) freeze as
 * historical — grep-accessible but not Hub-API-visible. Mirrors the
 * `notifications/v2/` cutover discipline used by GcsNotificationStore.
 *
 * ID shape (thread-304 Point A): unpadded `audit-${N}` issued via the
 * shared StorageBackedCounter (`auditCounter` field on `meta/counter.json`).
 * Matches Hub entity keyspace pattern (`task-${N}`, `mission-${N}`, etc.).
 * Counter + `createOnly` together eliminate the same-ms collision class
 * latent in legacy `GcsAuditStore.logEntry` (`gcs-state.ts` line 550
 * await-without-checking-ok) — emergent correctness fix per the mission
 * brief.
 *
 * Read-side ordering: keys sort by parsed counter suffix descending so
 * `listEntries` streams the top-`limit` matches without materializing
 * every entry's body, preserving the legacy GcsAuditStore early-break.
 */

import type { StorageProvider } from "@apnex/storage-provider";

import type { AuditEntry, IAuditStore } from "../state.js";
import { StorageBackedCounter } from "./counter.js";

const NAMESPACE = "audit/v2/";

function entryPath(id: string): string {
  return `${NAMESPACE}${id}.json`;
}

function encode(entry: AuditEntry): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(entry, null, 2));
}

function decode(bytes: Uint8Array): AuditEntry {
  return JSON.parse(new TextDecoder().decode(bytes)) as AuditEntry;
}

/** Parse the counter suffix of an audit key for sort ordering.
 *  `audit/v2/audit-42.json` → 42. NaN-result entries sort to the end. */
function parseCounter(key: string): number {
  const m = key.match(/audit-(\d+)\.json$/);
  return m ? Number(m[1]) : NaN;
}

export class AuditRepository implements IAuditStore {
  constructor(
    private readonly provider: StorageProvider,
    private readonly counter: StorageBackedCounter,
  ) {}

  async logEntry(
    actor: AuditEntry["actor"],
    action: string,
    details: string,
    relatedEntity?: string,
  ): Promise<AuditEntry> {
    const num = await this.counter.next("auditCounter");
    const id = `audit-${num}`;
    const entry: AuditEntry = {
      id,
      timestamp: new Date().toISOString(),
      actor,
      action,
      details,
      relatedEntity: relatedEntity ?? null,
    };
    const result = await this.provider.createOnly(entryPath(id), encode(entry));
    if (!result.ok) {
      throw new Error(
        `[AuditRepository] logEntry: counter issued existing ID ${id}; refusing to clobber`,
      );
    }
    console.log(`[AuditRepository] ${actor}/${action}: ${details.substring(0, 80)}`);
    return { ...entry };
  }

  async listEntries(
    limit = 50,
    actor?: AuditEntry["actor"],
  ): Promise<AuditEntry[]> {
    const keys = await this.provider.list(NAMESPACE);
    const sortedKeys = keys
      .filter((k) => k.endsWith(".json"))
      .sort((a, b) => parseCounter(b) - parseCounter(a));
    const out: AuditEntry[] = [];
    for (const key of sortedKeys) {
      if (out.length >= limit) break;
      const raw = await this.provider.get(key);
      if (!raw) continue;
      const entry = decode(raw);
      if (actor && entry.actor !== actor) continue;
      out.push(entry);
    }
    return out;
  }
}
