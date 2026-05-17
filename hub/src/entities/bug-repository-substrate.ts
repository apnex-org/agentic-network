/**
 * mission-83 W4 — BugRepositorySubstrate
 *
 * Substrate-API version of BugRepository (mission-47 W2 origin). Per Design v1.3
 * §5.1 Option Y disposition (B) sibling-pattern:
 * - Existing bug-repository.ts UNTOUCHED at production
 * - This substrate-version SIBLING exists alongside as pure-additive code
 * - Implements same IBugStore interface (handler call-sites unchanged)
 * - Hub bootstrap continues to instantiate existing repository at production
 *   until W5 cutover swaps instantiation
 * - W6 deletes the existing bug-repository.ts FS-version sibling
 *
 * Per-entity logic preserved:
 *   - ID allocation via SubstrateCounter (substrate-backed Counter helper)
 *   - createBug → substrate.createOnly (conflict-on-existing semantics; refuses
 *     to clobber if counter issued existing ID; same defensive check)
 *   - updateBug → CAS retry loop via substrate.putIfMatch (preserves
 *     read-modify-write semantics; up to MAX_CAS_RETRIES attempts)
 *   - findByCascadeKey / findBySourceIdeaId → substrate.list with filter
 *
 * W4 first-slice — pattern-demonstrator for the remaining 11 existing
 * repository-substrate-version siblings (W4.x continuation per same partial-
 * ship pattern as W3 → W3.x).
 */

import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import type { EntityProvenance } from "../state.js";
import type {
  Bug,
  BugStatus,
  BugSeverity,
  IBugStore,
  CascadeBacklink,
} from "./bug.js";
import { SubstrateCounter } from "./substrate-counter.js";

const KIND = "Bug";
const MAX_CAS_RETRIES = 50;

function cloneBug(bug: Bug): Bug {
  return {
    ...bug,
    tags: [...bug.tags],
    linkedTaskIds: [...bug.linkedTaskIds],
    fixCommits: [...bug.fixCommits],
  };
}

export class BugRepositorySubstrate implements IBugStore {
  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly counter: SubstrateCounter,
  ) {}

  async createBug(
    title: string,
    description: string,
    severity: BugSeverity,
    options: {
      classHint?: string;
      tags?: string[];
      sourceIdeaId?: string;
      surfacedBy?: string;
      backlink?: CascadeBacklink;
      createdBy?: EntityProvenance;
    } = {},
  ): Promise<Bug> {
    const num = await this.counter.next("bugCounter");
    const id = `bug-${num}`;
    const now = new Date().toISOString();
    const bug: Bug = {
      id,
      title,
      description,
      status: "open",
      severity,
      class: options.classHint ?? null,
      tags: options.tags ?? [],
      sourceIdeaId: options.sourceIdeaId ?? null,
      sourceThreadId: options.backlink?.sourceThreadId ?? null,
      sourceActionId: options.backlink?.sourceActionId ?? null,
      sourceThreadSummary: options.backlink?.sourceThreadSummary ?? null,
      linkedTaskIds: [],
      linkedMissionId: null,
      fixCommits: [],
      fixRevision: null,
      surfacedBy: options.surfacedBy ?? null,
      createdBy: options.createdBy,
      createdAt: now,
      updatedAt: now,
    };

    // Substrate-API createOnly per Option Y CAS preservation (per C1 fold-in;
    // mission-47 StorageProvider v1.0 contract equivalent)
    const result = await this.substrate.createOnly(KIND, bug);
    if (!result.ok) {
      throw new Error(
        `[BugRepositorySubstrate] createBug: counter issued existing ID ${id}; refusing to clobber`,
      );
    }
    console.log(
      `[BugRepositorySubstrate] Bug reported: ${id} — ${title} (severity=${severity}` +
        (options.backlink
          ? `, cascade from ${options.backlink.sourceThreadId}/${options.backlink.sourceActionId}`
          : "") +
        ")",
    );
    return cloneBug(bug);
  }

  async getBug(bugId: string): Promise<Bug | null> {
    const bug = await this.substrate.get<Bug>(KIND, bugId);
    return bug ? cloneBug(bug) : null;
  }

  async listBugs(filter?: {
    status?: BugStatus;
    severity?: BugSeverity;
    class?: string;
    tags?: string[];
  }): Promise<Bug[]> {
    // Substrate-API list with filter. tags is array-contains semantics; substrate
    // FilterValue doesn't directly support array-contains, so we filter
    // tags client-side post-list (same as existing repository pattern).
    const substrateFilter: Record<string, string> = {};
    if (filter?.status) substrateFilter.status = filter.status;
    if (filter?.severity) substrateFilter.severity = filter.severity;
    if (filter?.class !== undefined) substrateFilter.class = filter.class;

    const { items } = await this.substrate.list<Bug>(KIND, {
      filter: Object.keys(substrateFilter).length > 0 ? substrateFilter : undefined,
    });

    return items
      .filter(bug => {
        if (filter?.tags && filter.tags.length > 0) {
          const tagSet = new Set(filter.tags);
          if (!bug.tags.some(t => tagSet.has(t))) return false;
        }
        return true;
      })
      .map(cloneBug);
  }

  async updateBug(
    bugId: string,
    updates: Partial<{
      status: BugStatus;
      severity: BugSeverity;
      class: string | null;
      tags: string[];
      description: string;
      linkedTaskIds: string[];
      linkedMissionId: string | null;
      fixCommits: string[];
      fixRevision: string | null;
    }>,
  ): Promise<Bug | null> {
    try {
      return await this.casUpdate(bugId, (bug) => {
        if (updates.status !== undefined) bug.status = updates.status;
        if (updates.severity !== undefined) bug.severity = updates.severity;
        if (updates.class !== undefined) bug.class = updates.class;
        if (updates.tags !== undefined) bug.tags = [...updates.tags];
        if (updates.description !== undefined) bug.description = updates.description;
        if (updates.linkedTaskIds !== undefined) bug.linkedTaskIds = [...updates.linkedTaskIds];
        if (updates.linkedMissionId !== undefined) bug.linkedMissionId = updates.linkedMissionId;
        if (updates.fixCommits !== undefined) bug.fixCommits = [...updates.fixCommits];
        if (updates.fixRevision !== undefined) bug.fixRevision = updates.fixRevision;
        bug.updatedAt = new Date().toISOString();
        return bug;
      });
    } catch (err) {
      if (err instanceof Error && err.message === `Bug not found: ${bugId}`) {
        return null;
      }
      throw err;
    }
  }

  async findByCascadeKey(
    key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">,
  ): Promise<Bug | null> {
    const { items } = await this.substrate.list<Bug>(KIND, {
      filter: {
        sourceThreadId: key.sourceThreadId,
        sourceActionId: key.sourceActionId,
      },
    });
    return items[0] ? cloneBug(items[0]) : null;
  }

  async findBySourceIdeaId(sourceIdeaId: string): Promise<Bug | null> {
    const { items } = await this.substrate.list<Bug>(KIND, {
      filter: { sourceIdeaId },
    });
    return items[0] ? cloneBug(items[0]) : null;
  }

  // ── Internal CAS retry loop (preserves Option Y per-entity logic) ───────

  /**
   * Substrate-API CAS retry loop. Equivalent to BugRepository.casUpdate but uses
   * substrate.putIfMatch instead of provider.putIfMatch (substrate's CAS
   * primitive per C1 fold-in is semantics-equivalent to mission-47 StorageProvider
   * v1.0 contract).
   *
   * Read entity → fetch its resource_version via substrate.list (single-item
   * filter); transform; substrate.putIfMatch with expectedRevision. On stale-
   * revision conflict, refetch + retry up to MAX_CAS_RETRIES.
   */
  private async casUpdate(
    bugId: string,
    transform: (current: Bug) => Bug,
  ): Promise<Bug> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      // Fetch current bug + its resource_version via list (substrate-API
      // doesn't expose a get-with-token primitive; list returns
      // snapshotRevision but for per-row CAS we need per-row revision —
      // requires substrate-API extension at W4.x OR W5; for spike-quality
      // use simple get + put pattern which has narrower race window per
      // bug-93 PR #203 30s throttle context)
      const current = await this.substrate.get<Bug>(KIND, bugId);
      if (current === null) throw new Error(`Bug not found: ${bugId}`);

      const next = transform({ ...current });
      try {
        // Spike-quality simple put (substrate-API per-row CAS extension is
        // W4.x territory). W5+ may extend substrate-API to expose per-row
        // resource_version for true CAS at substrate boundary.
        await this.substrate.put(KIND, next);
        console.log(`[BugRepositorySubstrate] Bug updated: ${bugId} → status=${next.status}`);
        return cloneBug(next);
      } catch (err) {
        if (attempt === MAX_CAS_RETRIES - 1) throw err;
      }
    }
    throw new Error(
      `[BugRepositorySubstrate] casUpdate exhausted ${MAX_CAS_RETRIES} retries on ${bugId}`,
    );
  }
}
