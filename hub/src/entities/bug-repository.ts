/**
 * BugRepository — StorageProvider-backed Bug persistence.
 *
 * Mission-47 W2. Replaces the legacy `MemoryBugStore` + `GcsBugStore`
 * pair. Implements the `IBugStore` interface unchanged — policy-layer
 * callers (`hub/src/policy/bug-policy.ts`) continue to use
 * `ctx.stores.bug.createBug(...)` / `updateBug(...)` without edits.
 *
 * Layout matches the historical GCS object keyspace:
 *   bugs/<bugId>.json   — per-bug blob
 *   meta/counter.json   — shared counter blob (bugCounter field)
 */

import type { StorageProvider } from "@ois/storage-provider";
import {
  hasGetWithToken,
  StoragePathNotFoundError,
} from "@ois/storage-provider";

import type { EntityProvenance } from "../state.js";
import type {
  Bug,
  BugStatus,
  BugSeverity,
  IBugStore,
  CascadeBacklink,
} from "./bug.js";
import { StorageBackedCounter } from "./counter.js";

const MAX_CAS_RETRIES = 50;

function bugPath(bugId: string): string {
  return `bugs/${bugId}.json`;
}

function encodeBug(bug: Bug): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(bug, null, 2));
}

function decodeBug(bytes: Uint8Array): Bug {
  return JSON.parse(new TextDecoder().decode(bytes)) as Bug;
}

function cloneBug(bug: Bug): Bug {
  return {
    ...bug,
    tags: [...bug.tags],
    linkedTaskIds: [...bug.linkedTaskIds],
    fixCommits: [...bug.fixCommits],
  };
}

export class BugRepository implements IBugStore {
  constructor(
    private readonly provider: StorageProvider,
    private readonly counter: StorageBackedCounter,
  ) {
    if (!hasGetWithToken(provider)) {
      throw new Error(
        "BugRepository requires a StorageProvider with atomic read-with-token support",
      );
    }
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
    const result = await this.provider.createOnly(bugPath(id), encodeBug(bug));
    if (!result.ok) {
      throw new Error(
        `[BugRepository] createBug: counter issued existing ID ${id}; refusing to clobber`,
      );
    }
    console.log(
      `[BugRepository] Bug reported: ${id} — ${title} (severity=${severity}` +
        (options.backlink
          ? `, cascade from ${options.backlink.sourceThreadId}/${options.backlink.sourceActionId}`
          : "") +
        ")",
    );
    return cloneBug(bug);
  }

  async getBug(bugId: string): Promise<Bug | null> {
    const raw = await this.provider.get(bugPath(bugId));
    return raw ? cloneBug(decodeBug(raw)) : null;
  }

  async listBugs(filter?: {
    status?: BugStatus;
    severity?: BugSeverity;
    class?: string;
    tags?: string[];
  }): Promise<Bug[]> {
    const keys = await this.provider.list("bugs/");
    const out: Bug[] = [];
    for (const key of keys) {
      if (!key.endsWith(".json")) continue;
      const raw = await this.provider.get(key);
      if (!raw) continue;
      const bug = decodeBug(raw);
      if (filter?.status && bug.status !== filter.status) continue;
      if (filter?.severity && bug.severity !== filter.severity) continue;
      if (filter?.class !== undefined && bug.class !== filter.class) continue;
      if (filter?.tags && filter.tags.length > 0) {
        const tagSet = new Set(filter.tags);
        if (!bug.tags.some((t) => tagSet.has(t))) continue;
      }
      out.push(cloneBug(bug));
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
    const keys = await this.provider.list("bugs/");
    for (const path of keys) {
      if (!path.endsWith(".json")) continue;
      const raw = await this.provider.get(path);
      if (!raw) continue;
      const bug = decodeBug(raw);
      if (bug.sourceThreadId === key.sourceThreadId && bug.sourceActionId === key.sourceActionId) {
        return cloneBug(bug);
      }
    }
    return null;
  }

  async findBySourceIdeaId(sourceIdeaId: string): Promise<Bug | null> {
    const keys = await this.provider.list("bugs/");
    for (const path of keys) {
      if (!path.endsWith(".json")) continue;
      const raw = await this.provider.get(path);
      if (!raw) continue;
      const bug = decodeBug(raw);
      if (bug.sourceIdeaId === sourceIdeaId) return cloneBug(bug);
    }
    return null;
  }

  // ── Internal ─────────────────────────────────────────────────────

  private async casUpdate(
    bugId: string,
    transform: (current: Bug) => Bug,
  ): Promise<Bug> {
    const path = bugPath(bugId);
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const read = await (this.provider as unknown as {
        getWithToken(path: string): Promise<{ data: Uint8Array; token: string } | null>;
      }).getWithToken(path);
      if (read === null) throw new Error(`Bug not found: ${bugId}`);
      const next = transform(decodeBug(read.data));
      try {
        const result = await this.provider.putIfMatch(
          path,
          encodeBug(next),
          read.token,
        );
        if (result.ok) {
          console.log(`[BugRepository] Bug updated: ${bugId} → status=${next.status}`);
          return cloneBug(next);
        }
      } catch (err) {
        if (err instanceof StoragePathNotFoundError) {
          throw new Error(`Bug not found: ${bugId}`);
        }
        throw err;
      }
    }
    throw new Error(
      `[BugRepository] casUpdate exhausted ${MAX_CAS_RETRIES} retries on ${bugId}`,
    );
  }
}
