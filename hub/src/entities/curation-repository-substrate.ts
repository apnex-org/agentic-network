/**
 * curation-repository-substrate.ts — mission-102 P3-B2: the append-only
 * curation trail store (design §2).
 *
 * Both kinds are APPEND-ONLY by construction: createOnly writes, no update
 * path exists on this class at all. Scans are exact — paged with a
 * deterministic ORDER BY id ASC (the audit-10127 lesson: LIMIT/OFFSET without
 * a stable sort is undefined order on Postgres and pages may overlap/skip).
 */
import type { CurationRecord, ICurationStore, RawDecisionRaised } from "./curation.js";
import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import { SubstrateCounter } from "./substrate-counter.js";
import { decodeEnvelopeToFlat } from "./shape-helpers.js";

const RAW_KIND = "RawDecisionRaised";
const RECORD_KIND = "CurationRecord";
const LIST_CAP = 500;

function clone<T>(row: T, kind: string): T {
  return decodeEnvelopeToFlat(row as unknown as Record<string, unknown>, kind) as unknown as T;
}

export class CurationRepositorySubstrate implements ICurationStore {
  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly counter: SubstrateCounter,
  ) {}

  async mintRaw(input: Omit<RawDecisionRaised, "id" | "createdAt" | "updatedAt">): Promise<RawDecisionRaised> {
    const num = await this.counter.next("rawDecisionRaisedCounter");
    const id = `raw-${num}`;
    const now = new Date().toISOString();
    const raw: RawDecisionRaised = { ...input, id, createdAt: now, updatedAt: now };
    const result = await this.substrate.createOnly(RAW_KIND, raw);
    if (!result.ok) throw new Error(`[CurationRepository] mintRaw: counter issued existing ID ${id}`);
    console.log(`[CurationRepository] RawDecisionRaised ${id} (decision=${input.decisionId})`);
    return clone(raw, RAW_KIND);
  }

  async getRawForDecision(decisionId: string): Promise<RawDecisionRaised | null> {
    const all = await this.listAll<RawDecisionRaised>(RAW_KIND);
    return all.find((r) => r.decisionId === decisionId) ?? null;
  }

  async listRawInterval(fromISO: string, toISO: string): Promise<RawDecisionRaised[]> {
    // COMPLETE by construction (contract test 8): raw rows are immutable and
    // never deleted, so the interval scan sees every raise — including
    // decisions since disposed or merged. Exact paged scan, id-ordered.
    const all = await this.listAll<RawDecisionRaised>(RAW_KIND);
    return all.filter((r) => r.raisedAt >= fromISO && r.raisedAt <= toISO);
  }

  async record(input: Omit<CurationRecord, "id" | "createdAt" | "updatedAt">): Promise<CurationRecord> {
    if (input.act === "route-self-disposal" && !input.grantCitation) {
      throw new Error("[CurationRepository] route-self-disposal records REQUIRE a grantCitation (design §2)");
    }
    const num = await this.counter.next("curationRecordCounter");
    const id = `cur-${num}`;
    const now = new Date().toISOString();
    const rec: CurationRecord = { ...input, id, createdAt: now, updatedAt: now };
    const result = await this.substrate.createOnly(RECORD_KIND, rec);
    if (!result.ok) throw new Error(`[CurationRepository] record: counter issued existing ID ${id}`);
    return clone(rec, RECORD_KIND);
  }

  async listRecordsForDecision(decisionId: string): Promise<CurationRecord[]> {
    return (await this.listAll<CurationRecord>(RECORD_KIND)).filter((r) => r.decisionId === decisionId);
  }

  async listAllRecords(): Promise<CurationRecord[]> {
    return this.listAll<CurationRecord>(RECORD_KIND);
  }

  async listAllRaws(): Promise<RawDecisionRaised[]> {
    return this.listAll<RawDecisionRaised>(RAW_KIND);
  }

  /** Exact paged scan; deterministic id ASC ORDER BY is LOAD-BEARING (audit-10127). */
  private async listAll<T>(kind: string): Promise<T[]> {
    const all: T[] = [];
    for (let offset = 0; ; offset += LIST_CAP) {
      const { items } = await this.substrate.list<T>(kind, {
        limit: LIST_CAP, offset, sort: [{ field: "id", order: "asc" }],
      });
      all.push(...items.map((r) => clone(r, kind)));
      if (items.length < LIST_CAP) return all;
    }
  }
}
