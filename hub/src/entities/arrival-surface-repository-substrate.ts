/**
 * arrival-surface-repository-substrate.ts — mission-102 P3-B6: the
 * ArrivalSnapshot / NudgeReceipt / DirectorPresence store (design §1.4).
 *
 * All three kinds are presenter-side delivery accounting — none of them is
 * authority state, none carries a lease, and NOTHING here transitions a
 * Decision (the B1 no-timer invariant extends: delivery accounting observes
 * the queue, never moves it).
 */
import type {
  ArrivalSnapshot,
  DirectorPresence,
  IArrivalSurfaceStore,
  NudgeLevel,
  NudgeReceipt,
  SnapshotEntry,
} from "./arrival-surface.js";
import type { DecisionActor } from "./decision.js";
import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import { SubstrateCounter } from "./substrate-counter.js";
import { decodeEnvelopeToFlat } from "./shape-helpers.js";

const SNAPSHOT_KIND = "ArrivalSnapshot";
const NUDGE_KIND = "NudgeReceipt";
const PRESENCE_KIND = "DirectorPresence";
const PRESENCE_ID = "director-presence";
const LIST_CAP = 500;
const MAX_CAS_RETRIES = 20;

function clone<T>(row: T, kind: string): T {
  return decodeEnvelopeToFlat(row as unknown as Record<string, unknown>, kind) as unknown as T;
}

export class ArrivalSurfaceRepositorySubstrate implements IArrivalSurfaceStore {
  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly counter: SubstrateCounter,
  ) {}

  async recordSnapshot(input: {
    surface: string;
    renderedFor: DecisionActor;
    sinceSnapshotId: string | null;
    entries: SnapshotEntry[];
    digest: ArrivalSnapshot["digest"];
  }): Promise<ArrivalSnapshot> {
    const num = await this.counter.next("arrivalSnapshotCounter");
    const id = `asnap-${num}`;
    const now = new Date().toISOString();
    const snap: ArrivalSnapshot = {
      id,
      surface: input.surface,
      renderedFor: input.renderedFor,
      sinceSnapshotId: input.sinceSnapshotId,
      entries: input.entries,
      digest: input.digest,
      ackDecisionIds: [],
      deferDecisionIds: [],
      renderedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.substrate.createOnly(SNAPSHOT_KIND, snap);
    if (!result.ok) throw new Error(`[ArrivalSurfaceRepository] recordSnapshot: counter issued existing ID ${id}`);
    console.log(`[ArrivalSurfaceRepository] ArrivalSnapshot ${id} (surface=${input.surface}, entries=${input.entries.length})`);
    return clone(snap, SNAPSHOT_KIND);
  }

  async getSnapshot(id: string): Promise<ArrivalSnapshot | null> {
    const s = await this.substrate.get<ArrivalSnapshot>(SNAPSHOT_KIND, id);
    return s ? clone(s, SNAPSHOT_KIND) : null;
  }

  async latestSnapshot(surface: string): Promise<ArrivalSnapshot | null> {
    // EXACT scan (audit-10122): paged through the WHOLE kind — a capped single
    // list could hide the true latest cursor once snapshots outgrow one page,
    // silently resetting the digest to cold-start. Ids are counter-monotonic,
    // so max-by-number over the full set is the latest.
    const all = await this.listAll<ArrivalSnapshot>(SNAPSHOT_KIND);
    const mine = all.filter((s) => s.surface === surface);
    if (mine.length === 0) return null;
    return mine.sort((a, b) => Number(b.id.slice(6)) - Number(a.id.slice(6)))[0];
  }

  async markSnapshot(id: string, marks: { ack?: string[]; defer?: string[] }): Promise<ArrivalSnapshot | null> {
    return this.cas<ArrivalSnapshot>(SNAPSHOT_KIND, id, (s) => ({
      ...s,
      ackDecisionIds: [...new Set([...s.ackDecisionIds, ...(marks.ack ?? [])])],
      deferDecisionIds: [...new Set([...s.deferDecisionIds, ...(marks.defer ?? [])])],
      updatedAt: new Date().toISOString(),
    }));
  }

  async mintNudgeReceipt(input: { decisionId: string; level: NudgeLevel; emittedRef: string | null }): Promise<NudgeReceipt> {
    const num = await this.counter.next("nudgeReceiptCounter");
    const id = `nudge-${num}`;
    const now = new Date().toISOString();
    const n: NudgeReceipt = {
      id,
      decisionId: input.decisionId,
      level: input.level,
      emittedRef: input.emittedRef,
      emittedAt: now,
      presentedInSnapshotId: null,
      retryCount: 0,
      escalatedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.substrate.createOnly(NUDGE_KIND, n);
    if (!result.ok) throw new Error(`[ArrivalSurfaceRepository] mintNudgeReceipt: counter issued existing ID ${id}`);
    return clone(n, NUDGE_KIND);
  }

  async openNudgeReceipts(): Promise<NudgeReceipt[]> {
    // EXACT scan (audit-10122): DELIVERED=PRESENTED and the once/retry bounds
    // both key off open receipts — a capped scan that hid one would re-nudge a
    // presented decision or lose a suppression from the digest. Page the kind.
    const all = await this.listAll<NudgeReceipt>(NUDGE_KIND);
    return all.filter((n) => n.presentedInSnapshotId === null);
  }

  async markNudgesPresented(decisionIds: string[], snapshotId: string): Promise<number> {
    const open = await this.openNudgeReceipts();
    const hits = open.filter((n) => decisionIds.includes(n.decisionId));
    for (const n of hits) {
      await this.cas<NudgeReceipt>(NUDGE_KIND, n.id, (row) => ({
        ...row, presentedInSnapshotId: snapshotId, updatedAt: new Date().toISOString(),
      }));
    }
    return hits.length;
  }

  async bumpNudge(id: string, update: { retryCount?: number; escalatedAt?: string }): Promise<NudgeReceipt | null> {
    return this.cas<NudgeReceipt>(NUDGE_KIND, id, (n) => ({
      ...n,
      retryCount: update.retryCount ?? n.retryCount,
      escalatedAt: update.escalatedAt ?? n.escalatedAt,
      updatedAt: new Date().toISOString(),
    }));
  }

  async getPresence(): Promise<DirectorPresence> {
    const p = await this.substrate.get<DirectorPresence>(PRESENCE_KIND, PRESENCE_ID);
    if (p) return clone(p, PRESENCE_KIND);
    const now = new Date().toISOString();
    const fresh: DirectorPresence = {
      id: PRESENCE_ID, state: "present", basis: "declared",
      declaredAt: now, expectedReturn: null, lastDirectorActivityAt: null,
      createdAt: now, updatedAt: now,
    };
    await this.substrate.createOnly(PRESENCE_KIND, fresh);
    return fresh;
  }

  async setPresence(state: "present" | "away", basis: "declared" | "inferred", expectedReturn?: string | null): Promise<DirectorPresence> {
    await this.getPresence(); // ensure the singleton exists
    const result = await this.cas<DirectorPresence>(PRESENCE_KIND, PRESENCE_ID, (p) => {
      // S3.1: inference only ever SUPPRESSES — an inferred transition may set
      // away, never flip a DECLARED away back to present, and never override a
      // declared state at all.
      if (basis === "inferred" && (p.basis === "declared" || state === "present")) return p;
      const now = new Date().toISOString();
      return { ...p, state, basis, declaredAt: now, expectedReturn: expectedReturn ?? null, updatedAt: now };
    });
    return result ?? this.getPresence();
  }

  async touchDirectorActivity(): Promise<DirectorPresence> {
    await this.getPresence();
    const result = await this.cas<DirectorPresence>(PRESENCE_KIND, PRESENCE_ID, (p) => {
      const now = new Date().toISOString();
      // First Director activity flips present INSTANTLY (S3.1), regardless of
      // how away was entered — activity is the strongest presence signal.
      return { ...p, state: "present", basis: "declared", lastDirectorActivityAt: now, updatedAt: now };
    });
    return result ?? this.getPresence();
  }

  /** Page the whole kind in LIST_CAP batches — exact, never truncates. Offset
   *  paging can skip/dup under concurrent writes; at presenter volume that is
   *  the same benign race any snapshot-read has (dup receipt-flips are
   *  idempotent; a just-created row lands next pull). */
  private async listAll<T>(kind: string): Promise<T[]> {
    const all: T[] = [];
    for (let offset = 0; ; offset += LIST_CAP) {
      const { items } = await this.substrate.list<T>(kind, { limit: LIST_CAP, offset });
      all.push(...items.map((r) => clone(r, kind)));
      if (items.length < LIST_CAP) return all;
    }
  }

  private async cas<T>(kind: string, id: string, transform: (row: T) => T): Promise<T | null> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<T>(kind, id);
      if (!existing) return null;
      const row = clone(existing.entity, kind);
      const next = transform(row);
      if (next === row) return next; // a transform returning its arg unchanged is a no-op (skip the write)
      const result = await this.substrate.putIfMatch(kind, next, existing.resourceVersion);
      if (result.ok) return clone(next, kind);
    }
    throw new Error(`[ArrivalSurfaceRepository] cas exhausted ${MAX_CAS_RETRIES} retries on ${kind}/${id}`);
  }
}
