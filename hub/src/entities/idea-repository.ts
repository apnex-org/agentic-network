/**
 * IdeaRepository — StorageProvider-backed Idea persistence.
 *
 * Mission-47 W2. Replaces the legacy `MemoryIdeaStore` + `GcsIdeaStore`
 * pair. Implements the `IIdeaStore` interface unchanged — policy-layer
 * callers (`hub/src/policy/idea-policy.ts`) continue to use
 * `ctx.stores.idea.submitIdea(...)` without edits.
 *
 * Layout matches the historical GCS object keyspace:
 *   ideas/<ideaId>.json   — per-idea blob
 *   meta/counter.json     — shared counter blob (ideaCounter field)
 *
 * Historical note on the migrate-on-read shim: `GcsIdeaStore` previously
 * synthesised `createdBy` from a legacy `author` field during the
 * mission-24 entity-provenance cutover. The shim was removed after
 * the 2026-04-21 prod backfill + architect-specified soak; every
 * Idea on disk now has `createdBy` directly. IdeaRepository assumes
 * the backfilled state and does not re-introduce the shim.
 */

import type { StorageProvider } from "@ois/storage-provider";
import {
  hasGetWithToken,
  StoragePathNotFoundError,
} from "@ois/storage-provider";

import type { EntityProvenance } from "../state.js";
import type {
  Idea,
  IdeaStatus,
  IIdeaStore,
  CascadeBacklink,
} from "./idea.js";
import { StorageBackedCounter } from "./counter.js";

const MAX_CAS_RETRIES = 50;

function ideaPath(ideaId: string): string {
  return `ideas/${ideaId}.json`;
}

function encodeIdea(idea: Idea): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(idea, null, 2));
}

function decodeIdea(bytes: Uint8Array): Idea {
  return JSON.parse(new TextDecoder().decode(bytes)) as Idea;
}

export class IdeaRepository implements IIdeaStore {
  constructor(
    private readonly provider: StorageProvider,
    private readonly counter: StorageBackedCounter,
  ) {
    if (!hasGetWithToken(provider)) {
      throw new Error(
        "IdeaRepository requires a StorageProvider with atomic read-with-token support",
      );
    }
  }

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
    const result = await this.provider.createOnly(ideaPath(id), encodeIdea(idea));
    if (!result.ok) {
      throw new Error(
        `[IdeaRepository] submitIdea: counter issued existing ID ${id}; refusing to clobber`,
      );
    }
    console.log(
      `[IdeaRepository] Idea submitted: ${id}` +
        (backlink ? ` (cascade from ${backlink.sourceThreadId}/${backlink.sourceActionId})` : ""),
    );
    return { ...idea };
  }

  async getIdea(ideaId: string): Promise<Idea | null> {
    const raw = await this.provider.get(ideaPath(ideaId));
    return raw ? decodeIdea(raw) : null;
  }

  async listIdeas(statusFilter?: IdeaStatus): Promise<Idea[]> {
    const keys = await this.provider.list("ideas/");
    const out: Idea[] = [];
    for (const key of keys) {
      if (!key.endsWith(".json")) continue;
      const raw = await this.provider.get(key);
      if (!raw) continue;
      const idea = decodeIdea(raw);
      if (statusFilter && idea.status !== statusFilter) continue;
      out.push(idea);
    }
    return out;
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
      // Match the legacy contract: missing idea returns null rather
      // than throwing. Other errors propagate.
      if (err instanceof Error && err.message === `Idea not found: ${ideaId}`) {
        return null;
      }
      throw err;
    }
  }

  async findByCascadeKey(
    key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">,
  ): Promise<Idea | null> {
    const keys = await this.provider.list("ideas/");
    for (const path of keys) {
      if (!path.endsWith(".json")) continue;
      const raw = await this.provider.get(path);
      if (!raw) continue;
      const idea = decodeIdea(raw);
      if (idea.sourceThreadId === key.sourceThreadId && idea.sourceActionId === key.sourceActionId) {
        return idea;
      }
    }
    return null;
  }

  // ── Internal ─────────────────────────────────────────────────────

  private async casUpdate(
    ideaId: string,
    transform: (current: Idea) => Idea,
  ): Promise<Idea> {
    const path = ideaPath(ideaId);
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const read = await (this.provider as unknown as {
        getWithToken(path: string): Promise<{ data: Uint8Array; token: string } | null>;
      }).getWithToken(path);
      if (read === null) throw new Error(`Idea not found: ${ideaId}`);
      const next = transform(decodeIdea(read.data));
      try {
        const result = await this.provider.putIfMatch(
          path,
          encodeIdea(next),
          read.token,
        );
        if (result.ok) {
          console.log(`[IdeaRepository] Idea updated: ${ideaId} → status=${next.status}`);
          return next;
        }
      } catch (err) {
        if (err instanceof StoragePathNotFoundError) {
          throw new Error(`Idea not found: ${ideaId}`);
        }
        throw err;
      }
    }
    throw new Error(
      `[IdeaRepository] casUpdate exhausted ${MAX_CAS_RETRIES} retries on ${ideaId}`,
    );
  }
}
