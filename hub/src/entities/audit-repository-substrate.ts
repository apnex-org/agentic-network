/**
 * mission-83 W4.x.2 — AuditRepositorySubstrate
 *
 * Substrate-API version of AuditRepository (mission-49 W8 origin). Per Design v1.3
 * §5.1 Option Y disposition (B) sibling-pattern:
 * - Existing audit-repository.ts UNTOUCHED at production
 * - This substrate-version SIBLING exists alongside as pure-additive code
 * - Implements same IAuditStore interface (handler call-sites UNCHANGED)
 * - W6 deletes the existing audit-repository.ts FS-version sibling
 *
 * Per-entity logic preserved:
 *   - ID allocation via SubstrateCounter.next("auditCounter") (`audit-${N}` shape
 *     per mission-49 thread-304 Point A)
 *   - logEntry → substrate.createOnly (conflict-on-existing semantics; refuses
 *     to clobber if counter issued existing ID — same defensive check; eliminates
 *     the same-ms collision class latent in legacy GcsAuditStore.logEntry)
 *   - listEntries → substrate.list with actor filter + client-side counter-sort
 *     (preserves legacy parseCounter desc ordering; substrate FilterValue doesn't
 *     express numeric sort over string id suffix)
 *
 * FS-layout → substrate-layout translation:
 *   audit/v2/<id>.json             → substrate(kind="Audit", id=auditId)
 *   provider.createOnly(path,...)  → substrate.createOnly("Audit", entry)
 *   provider.list("audit/v2/")     → substrate.list("Audit", {filter, limit:500})
 *
 * W4.x.2 — third-slice of W4.x sweep after W4.x.1 AgentRepositorySubstrate.
 */

import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import type { AuditEntry, IAuditStore } from "../state.js";
import { SubstrateCounter } from "./substrate-counter.js";

const KIND = "Audit";
// Cap pre-sort fetch to bound memory; well above legacy listEntries(limit=50) use cases.
const LIST_PREFETCH_CAP = 500;

/** Parse the counter suffix of an audit id for sort ordering.
 *  `audit-42` → 42. NaN-result entries sort to the end. */
function parseCounter(id: string): number {
  const m = id.match(/^audit-(\d+)$/);
  return m ? Number(m[1]) : NaN;
}

export class AuditRepositorySubstrate implements IAuditStore {
  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly counter: SubstrateCounter,
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
    const result = await this.substrate.createOnly(KIND, entry);
    if (!result.ok) {
      throw new Error(
        `[AuditRepositorySubstrate] logEntry: counter issued existing ID ${id}; refusing to clobber`,
      );
    }
    console.log(`[AuditRepositorySubstrate] ${actor}/${action}: ${details.substring(0, 80)}`);
    return { ...entry };
  }

  async listEntries(
    limit = 50,
    actor?: AuditEntry["actor"],
  ): Promise<AuditEntry[]> {
    // Substrate-side filter by actor (audit_actor_idx; v2 SchemaDef); client-
    // side counter-sort + slice preserves legacy parseCounter desc ordering.
    const substrateFilter: Record<string, string> = {};
    if (actor) substrateFilter.actor = actor;
    const { items } = await this.substrate.list<AuditEntry>(KIND, {
      filter: Object.keys(substrateFilter).length > 0 ? substrateFilter : undefined,
      limit: LIST_PREFETCH_CAP,
    });

    return items
      .sort((a, b) => parseCounter(b.id) - parseCounter(a.id))
      .slice(0, limit)
      .map(e => ({ ...e }));
  }
}
