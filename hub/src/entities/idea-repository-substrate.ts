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
  const flat = decodeEnvelopeToFlat(idea as unknown as Record<string, unknown>, "Idea") as Record<string, unknown>;
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

  // legible0 item 1 — ORDER THE SCAN. Architect ruling 2026-08-06: OPTION B.
  //
  // 🔴 THE MEASURED DEFECT: idea-727 (createdAt 12:36:17Z) EXISTS and reads fine via
  // get_idea, but list_ideas{filter:{createdAt:{$gt:"2026-08-01"}}} returned ONLY
  // idea-717 and idea-719 — ideas 720-727 were never inside the UNORDERED 500-row
  // window, so the in-memory filter never saw them. NOT a false zero: two rows came
  // back, so it read as a successful query. A false PARTIAL is strictly worse.
  //
  // ORDERING ALONE CLOSES IT: a createdAt-DESC window of 500 IS the newest 500, so
  // the freshest rows are the ones that survive the cap instead of the ones that
  // happen to. No filter push-down is required to make the acceptance query correct.
  //
  // 🔴 metadata.createdAt, NOT createdAt. Storage is ENVELOPE-ONLY (mission-90 W8;
  // SUBSTRATE_ENVELOPE_TOLERANT retired) and Idea's partition puts createdAt +
  // createdBy in `metadata`. A BARE `createdAt` is not in RESERVED_TOP_LEVEL and has
  // no renameMap entry, so translateKeyOrThrow THROWS on a partitioned kind — and
  // the partitioned-kind oracle ARMS ONLY IN PRODUCTION, so tests cannot see it.
  // A `metadata.` prefix is a BUCKET_PREFIX: isReservedOrBucketKey returns true and
  // the path passes through already-translated. That is the sanctioned mechanism.
  //
  // ⚠️ NOT a renameMap entry: applyRenameMap runs at ENCODE time (envelope.ts:117)
  // and createdAt is MOVED-not-RENAMED, so an entry would rewrite the key before
  // partitioning and corrupt new writes. The error string advises exactly that and
  // is wrong for this field.
  //
  // id DESC only breaks ties: ids are TEXT, so id-order is LEXICOGRAPHIC and
  // "idea-99" outranks "idea-727" (bug-13). It makes the window deterministic; it
  // must never be the primary key of the ordering.
  //
  // 🔴 NO BLANKET FILTER PUSH-DOWN. Attempted and REVERTED: it silently broke the
  // dotted-path filters (createdBy.role/.agentId/.id → 0 rows, measured), which
  // would have traded a false partial for a FALSE ZERO — the very defect this change
  // exists to remove. Pushing filters down correctly needs read-side translation
  // derived from the partition lists (the moved-but-not-renamed class, bug-138/170);
  // that is a separate arc and is NOT smuggled in here.
  async listIdeas(statusFilter?: IdeaStatus): Promise<Idea[]> {
    const substrateFilter: Record<string, string> = {};
    if (statusFilter) substrateFilter.status = statusFilter;
    const { items } = await this.substrate.list<Idea>(KIND, {
      filter: Object.keys(substrateFilter).length > 0 ? substrateFilter : undefined,
      sort: [{ field: "metadata.createdAt", order: "desc" }, { field: "id", order: "desc" }],
      limit: 500,
    });
    const decoded = items.map(cloneIdea);

    // 🔴 THE LOUD GUARD (architect-mandated). The ordering above is CORRECT ONLY IF
    // every row is envelope-shaped. That invariant is ASSERTED in three files and
    // ENFORCED IN NONE — BareEnvelopeError catches the OPPOSITE failure (an undecoded
    // envelope reaching a consumer); nothing detects a FLAT row at storage.
    //
    // A flat row would sort as NULL on metadata.createdAt and land at an arbitrary
    // end of the window — A SILENT MISS, reproducing inside the fix the exact class
    // the fix exists to kill. So it must be impossible for one to pass through quietly.
    // Non-fatal by design: this is a READ path, and taking list_ideas down over a
    // single malformed row would be a worse failure than the one being reported.
    const undated = decoded.filter((i) => !i.createdAt).length;
    if (undated > 0) {
      console.error(
        `[IdeaRepositorySubstrate] 🔴 INVARIANT BREACH: ${undated} of ${decoded.length} Idea rows ` +
          `have NO createdAt after decode. Storage is documented ENVELOPE-ONLY (mission-90 W8), and ` +
          `the newest-first scan order sorts on metadata.createdAt — so these rows sorted as NULL and ` +
          `their position in the 500-row window is ARBITRARY. Results may silently omit rows. ` +
          `This is the flat-row case the envelope invariant says cannot exist.`,
      );
    }
    return decoded;
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
