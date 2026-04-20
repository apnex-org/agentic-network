/**
 * GCS-backed Bug Store.
 */

import {
  readJson,
  listFiles,
  getAndIncrementCounter,
  createOnly,
  updateExisting,
  GcsPathNotFound,
} from "../../gcs-state.js";
import type { Bug, BugSeverity, BugStatus, IBugStore, CascadeBacklink } from "../bug.js";
import type { EntityProvenance } from "../../state.js";

export class GcsBugStore implements IBugStore {
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
    console.log(`[GcsBugStore] Using bucket: gs://${bucket}`);
  }

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
    } = {}
  ): Promise<Bug> {
    const num = await getAndIncrementCounter(this.bucket, "bugCounter");
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
    await createOnly<Bug>(this.bucket, `bugs/${id}.json`, bug);
    console.log(`[GcsBugStore] Bug reported: ${id} — ${title} (severity=${severity}${options.backlink ? `, cascade from ${options.backlink.sourceThreadId}/${options.backlink.sourceActionId}` : ""})`);
    return { ...bug };
  }

  async getBug(bugId: string): Promise<Bug | null> {
    return await readJson<Bug>(this.bucket, `bugs/${bugId}.json`);
  }

  async listBugs(filter?: {
    status?: BugStatus;
    severity?: BugSeverity;
    class?: string;
    tags?: string[];
  }): Promise<Bug[]> {
    const files = await listFiles(this.bucket, "bugs/");
    const out: Bug[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const b = await readJson<Bug>(this.bucket, file);
      if (!b) continue;
      if (filter?.status && b.status !== filter.status) continue;
      if (filter?.severity && b.severity !== filter.severity) continue;
      if (filter?.class !== undefined && b.class !== filter.class) continue;
      if (filter?.tags && filter.tags.length > 0) {
        const match = new Set(filter.tags);
        if (!b.tags.some((t) => match.has(t))) continue;
      }
      out.push(b);
    }
    return out;
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
    }>
  ): Promise<Bug | null> {
    try {
      const updated = await updateExisting<Bug>(this.bucket, `bugs/${bugId}.json`, (b) => {
        if (updates.status !== undefined) b.status = updates.status;
        if (updates.severity !== undefined) b.severity = updates.severity;
        if (updates.class !== undefined) b.class = updates.class;
        if (updates.tags !== undefined) b.tags = [...updates.tags];
        if (updates.description !== undefined) b.description = updates.description;
        if (updates.linkedTaskIds !== undefined) b.linkedTaskIds = [...updates.linkedTaskIds];
        if (updates.linkedMissionId !== undefined) b.linkedMissionId = updates.linkedMissionId;
        if (updates.fixCommits !== undefined) b.fixCommits = [...updates.fixCommits];
        if (updates.fixRevision !== undefined) b.fixRevision = updates.fixRevision;
        b.updatedAt = new Date().toISOString();
        return b;
      });
      console.log(`[GcsBugStore] Bug updated: ${bugId} → status=${updated.status}`);
      return updated;
    } catch (err) {
      if (err instanceof GcsPathNotFound) return null;
      throw err;
    }
  }

  async findByCascadeKey(key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">): Promise<Bug | null> {
    const files = await listFiles(this.bucket, "bugs/");
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const b = await readJson<Bug>(this.bucket, file);
      if (b && b.sourceThreadId === key.sourceThreadId && b.sourceActionId === key.sourceActionId) {
        return b;
      }
    }
    return null;
  }

  async findBySourceIdeaId(sourceIdeaId: string): Promise<Bug | null> {
    const files = await listFiles(this.bucket, "bugs/");
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const b = await readJson<Bug>(this.bucket, file);
      if (b && b.sourceIdeaId === sourceIdeaId) return b;
    }
    return null;
  }
}
