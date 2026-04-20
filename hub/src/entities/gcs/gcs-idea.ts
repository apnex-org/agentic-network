/**
 * GCS-backed Idea Store.
 *
 * Historical note: a `migrateIdeaOnRead` shim lived here through task-305
 * (Mission-24 Phase A) to synthesize `createdBy` from the legacy `author`
 * field during the entity-provenance cutover. The prod backfill
 * (`scripts/backfill-created-by.ts --apply`) populated `createdBy` on
 * every Idea on 2026-04-21 AEST, and the shim was removed after the
 * architect-specified 48h soak. Every reader now sees `createdBy`
 * directly from the persisted JSON.
 */

import {
  readJson,
  listFiles,
  getAndIncrementCounter,
  createOnly,
  updateExisting,
  GcsPathNotFound,
} from "../../gcs-state.js";
import type { Idea, IdeaStatus, IIdeaStore, CascadeBacklink } from "../idea.js";
import type { EntityProvenance } from "../../state.js";

export class GcsIdeaStore implements IIdeaStore {
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
    console.log(`[GcsIdeaStore] Using bucket: gs://${bucket}`);
  }

  async submitIdea(
    text: string,
    createdBy: EntityProvenance,
    sourceThreadId?: string,
    tags?: string[],
    backlink?: CascadeBacklink
  ): Promise<Idea> {
    const num = await getAndIncrementCounter(this.bucket, "ideaCounter");
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
      tags: tags || [],
      createdAt: now,
      updatedAt: now,
    };

    await createOnly<Idea>(this.bucket, `ideas/${id}.json`, idea);
    console.log(`[GcsIdeaStore] Idea submitted: ${id}${backlink ? ` (cascade from ${backlink.sourceThreadId}/${backlink.sourceActionId})` : ""}`);
    return { ...idea };
  }

  async findByCascadeKey(key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">): Promise<Idea | null> {
    const files = await listFiles(this.bucket, "ideas/");
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const idea = await readJson<Idea>(this.bucket, file);
      if (idea && idea.sourceThreadId === key.sourceThreadId && idea.sourceActionId === key.sourceActionId) {
        return idea;
      }
    }
    return null;
  }

  async getIdea(ideaId: string): Promise<Idea | null> {
    return readJson<Idea>(this.bucket, `ideas/${ideaId}.json`);
  }

  async listIdeas(statusFilter?: IdeaStatus): Promise<Idea[]> {
    const files = await listFiles(this.bucket, "ideas/");
    const ideas: Idea[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const idea = await readJson<Idea>(this.bucket, file);
      if (idea) {
        if (statusFilter && idea.status !== statusFilter) continue;
        ideas.push(idea);
      }
    }
    return ideas;
  }

  async updateIdea(
    ideaId: string,
    updates: { status?: IdeaStatus; missionId?: string; tags?: string[]; text?: string }
  ): Promise<Idea | null> {
    const path = `ideas/${ideaId}.json`;
    try {
      const updated = await updateExisting<Idea>(this.bucket, path, (idea) => {
        if (updates.status) idea.status = updates.status;
        if (updates.missionId !== undefined) idea.missionId = updates.missionId;
        if (updates.tags) idea.tags = updates.tags;
        if (updates.text !== undefined) idea.text = updates.text;
        idea.updatedAt = new Date().toISOString();
        return idea;
      });
      console.log(`[GcsIdeaStore] Idea updated: ${ideaId} → status=${updated.status}`);
      return { ...updated };
    } catch (err) {
      if (err instanceof GcsPathNotFound) return null;
      throw err;
    }
  }
}
