/**
 * mission-83 W4.x.3 — IdeaRepositorySubstrate
 *
 * Substrate-API version of IdeaRepository (mission-47 W2 origin). Per Design v1.3
 * §5.1 Option Y disposition (B) sibling-pattern. Implements IIdeaStore interface
 * UNCHANGED (handler call-sites unchanged).
 *
 * Per-entity logic preserved:
 *   - ID allocation via SubstrateCounter.next("ideaCounter") ("idea-N" shape)
 *   - submitIdea → substrate.createOnly (conflict-on-existing; refuses to clobber)
 *   - updateIdea → CAS retry loop via getWithRevision + putIfMatch (Design v1.4
 *     proper substrate-boundary CAS, vs BugRepositorySubstrate spike-quality
 *     simple-put pattern)
 *   - findByCascadeKey → substrate.list with cascade-key filter (idea_cascade_idx
 *     hot-path per Idea SchemaDef v2)
 *
 * W4.x.3 — fourth-slice of W4.x sweep after W4.x.2 AuditRepositorySubstrate.
 */

import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import type { EntityProvenance } from "../state.js";
import type {
  Idea,
  IdeaStatus,
  IIdeaStore,
  CascadeBacklink,
} from "./idea.js";
import { SubstrateCounter } from "./substrate-counter.js";
import { tagsFromEntity } from "./shape-helpers.js";

const KIND = "Idea";
const MAX_CAS_RETRIES = 50;

function cloneIdea(idea: Idea): Idea {
  return {
    ...idea,
    tags: tagsFromEntity(idea),
  };
}

export class IdeaRepositorySubstrate implements IIdeaStore {
  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly counter: SubstrateCounter,
  ) {}

  async submitIdea(
    text: string,
    createdBy: EntityProvenance,
    sourceThreadId?: string,
    tags?: string[],
    backlink?: CascadeBacklink,
  ): Promise<Idea> {
    const num = await this.counter.next("ideaCounter");
    const id = `idea-${num}`;
    const now = new Date().toISOString();
    const idea: Idea = {
      id,
      text,
      createdBy,
      status: "open",
      missionId: null,
      sourceThreadId: backlink?.sourceThreadId ?? sourceThreadId ?? null,
      sourceActionId: backlink?.sourceActionId ?? null,
      sourceThreadSummary: backlink?.sourceThreadSummary ?? null,
      tags: tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.substrate.createOnly(KIND, idea);
    if (!result.ok) {
      throw new Error(
        `[IdeaRepositorySubstrate] submitIdea: counter issued existing ID ${id}; refusing to clobber`,
      );
    }
    console.log(
      `[IdeaRepositorySubstrate] Idea submitted: ${id}` +
        (backlink ? ` (cascade from ${backlink.sourceThreadId}/${backlink.sourceActionId})` : ""),
    );
    return cloneIdea(idea);
  }

  async getIdea(ideaId: string): Promise<Idea | null> {
    const idea = await this.substrate.get<Idea>(KIND, ideaId);
    return idea ? cloneIdea(idea) : null;
  }

  async listIdeas(statusFilter?: IdeaStatus): Promise<Idea[]> {
    const substrateFilter: Record<string, string> = {};
    if (statusFilter) substrateFilter.status = statusFilter;
    const { items } = await this.substrate.list<Idea>(KIND, {
      filter: Object.keys(substrateFilter).length > 0 ? substrateFilter : undefined,
      limit: 500,
    });
    return items.map(cloneIdea);
  }

  async updateIdea(
    ideaId: string,
    updates: { status?: IdeaStatus; missionId?: string; tags?: string[]; text?: string },
  ): Promise<Idea | null> {
    try {
      return await this.casUpdate(ideaId, (idea) => {
        if (updates.status) idea.status = updates.status;
        if (updates.missionId !== undefined) idea.missionId = updates.missionId;
        if (updates.tags) idea.tags = updates.tags;
        if (updates.text !== undefined) idea.text = updates.text;
        idea.updatedAt = new Date().toISOString();
        return idea;
      });
    } catch (err) {
      if (err instanceof Error && err.message === `Idea not found: ${ideaId}`) {
        return null;
      }
      throw err;
    }
  }

  async findByCascadeKey(
    key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">,
  ): Promise<Idea | null> {
    // Substrate-API list with idea_cascade_idx (SchemaDef v2 indexed). mission-
    // 89 Phase 4 (bug-138 systemic): envelope-first + legacy fallback dual-lookup.
    const envelopeResult = await this.substrate.list<Idea>(KIND, {
      filter: {
        "metadata.sourceThreadId": key.sourceThreadId,
        "metadata.sourceActionId": key.sourceActionId,
      },
      limit: 1,
    });
    if (envelopeResult.items[0]) return cloneIdea(envelopeResult.items[0]);
    // mission-90 W4: KEEP this bare fallback — cascade-keys are NOT chokepoint-
    // translated (W1 null-pin), so it's the SOLE straddle mechanism (unlike the
    // listMissions status branch which is chokepoint-redundant). Removing it pre-W6
    // would risk a bug-147-class duplicate-on-missed-dedup for bare stragglers.
    // DELETE at W8 with all dual-shape tolerance, after W6 proves zero bare rows
    // (architect-ruled 2026-06-19; W8 carry-set).
    const legacyResult = await this.substrate.list<Idea>(KIND, {
      filter: {
        sourceThreadId: key.sourceThreadId,
        sourceActionId: key.sourceActionId,
      },
      limit: 1,
    });
    return legacyResult.items[0] ? cloneIdea(legacyResult.items[0]) : null;
  }

  // ── Internal CAS retry loop (Design v1.4 getWithRevision + putIfMatch) ─────

  private async casUpdate(
    ideaId: string,
    transform: (current: Idea) => Idea,
  ): Promise<Idea> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<Idea>(KIND, ideaId);
      if (!existing) throw new Error(`Idea not found: ${ideaId}`);

      const next = transform({ ...existing.entity });
      const result = await this.substrate.putIfMatch(KIND, next, existing.resourceVersion);
      if (result.ok) {
        console.log(`[IdeaRepositorySubstrate] Idea updated: ${ideaId} → status=${next.status}`);
        return cloneIdea(next);
      }
      // revision-mismatch → retry from re-read
    }
    throw new Error(
      `[IdeaRepositorySubstrate] casUpdate exhausted ${MAX_CAS_RETRIES} retries on ${ideaId}`,
    );
  }
}
