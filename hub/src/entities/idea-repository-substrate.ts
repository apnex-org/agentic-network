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
import { decodeEnvelopeToFlat } from "./shape-helpers.js";

const KIND = "Idea";
const MAX_CAS_RETRIES = 50;

function cloneIdea(idea: Idea): Idea {
  // mission-90 W8: decode envelope→flat (idea-327); derive `tags` from the
  // metadata.labels map (cluster-1 array↔map asymmetry the generic decode can't
  // reverse) and drop the raw labels artifact. Used at both the read boundary AND
  // the CAS path, so the legacy-flat `tags` array round-trips through the write-encoder.
  const flat = decodeEnvelopeToFlat(idea as unknown as Record<string, unknown>) as Record<string, unknown>;
  // tags: from the envelope metadata.labels map (flattened to flat.labels), OR an
  // existing top-level tags array (a legacy-flat in-memory build, e.g. submitIdea's
  // return). Drop the raw labels artifact.
  if (flat.labels && typeof flat.labels === "object") {
    flat.tags = Object.keys(flat.labels as Record<string, string>);
    delete flat.labels;
  } else if (!Array.isArray(flat.tags)) {
    flat.tags = [];
  }
  return flat as unknown as Idea;
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
    // Substrate-API list with idea_cascade_idx (metadata JSONB index). C3-R4b
    // (dual-path collapse): filter by the FLAT cascade key — the substrate
    // translates it via renameMap (sourceThreadId→metadata.sourceThreadId,
    // sourceActionId→metadata.sourceActionId), retiring the dotted special-casing
    // so renameMap is the single field-path authority. (mission-90 W8 already
    // retired the legacy bare-row fallback: 0 bare rows live; all writes envelope.)
    const envelopeResult = await this.substrate.list<Idea>(KIND, {
      filter: {
        sourceThreadId: key.sourceThreadId,
        sourceActionId: key.sourceActionId,
      },
      limit: 1,
    });
    return envelopeResult.items[0] ? cloneIdea(envelopeResult.items[0]) : null;
  }

  // ── Internal CAS retry loop (Design v1.4 getWithRevision + putIfMatch) ─────

  private async casUpdate(
    ideaId: string,
    transform: (current: Idea) => Idea,
  ): Promise<Idea> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<Idea>(KIND, ideaId);
      if (!existing) throw new Error(`Idea not found: ${ideaId}`);

      const next = transform(cloneIdea(existing.entity)); // mission-90 W8: flat CAS
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
