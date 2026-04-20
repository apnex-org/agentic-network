/**
 * Idea Entity — Lightweight backlog item for unrefined thoughts.
 *
 * No complex state machine. Status transitions:
 *   open → triaged → incorporated (linked to Mission)
 *   open → dismissed
 */

// ── Types ────────────────────────────────────────────────────────────

import type { EntityProvenance } from "../state.js";

export type IdeaStatus = "open" | "triaged" | "dismissed" | "incorporated";

export interface Idea {
  id: string;
  text: string;
  /**
   * Legacy authorship field (role string OR agentId, per call site).
   * Superseded by `createdBy` (task-305) but retained during the C1→C4
   * atomic migration for dual-write safety. Removed in C4 once readers
   * all use `createdBy`.
   */
  author: string;
  /** Mission-24 idea-120: uniform direct-create provenance (task-305). */
  createdBy?: EntityProvenance;
  status: IdeaStatus;
  missionId: string | null;
  sourceThreadId: string | null;
  /** Mission-24 Phase 2 (ADR-014, INV-TH20/23): cascade-spawn back-links.
   * `sourceThreadId` predates Phase 2 but completes the natural
   * idempotency key with `sourceActionId`; `sourceThreadSummary`
   * preserves the decision narrative per INV-TH23. Null for
   * hand-submitted ideas and pre-Phase-2 cascade-spawned ideas. */
  sourceActionId: string | null;
  sourceThreadSummary: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// Re-export CascadeBacklink to avoid a state.ts import at the idea module
// level (keeps the dependency direction: state.ts → idea.ts).
export interface CascadeBacklink {
  sourceThreadId: string;
  sourceActionId: string;
  sourceThreadSummary: string;
}

// ── Interface ────────────────────────────────────────────────────────

export interface IIdeaStore {
  submitIdea(
    text: string,
    author: string,
    sourceThreadId?: string,
    tags?: string[],
    backlink?: CascadeBacklink
  ): Promise<Idea>;

  getIdea(ideaId: string): Promise<Idea | null>;

  listIdeas(statusFilter?: IdeaStatus): Promise<Idea[]>;

  updateIdea(
    ideaId: string,
    updates: { status?: IdeaStatus; missionId?: string; tags?: string[]; text?: string }
  ): Promise<Idea | null>;

  /**
   * Mission-24 Phase 2 (ADR-014, INV-TH20): look up an Idea by the natural
   * idempotency key {sourceThreadId, sourceActionId}. Returns null when
   * no Idea has been spawned from that thread+action pair.
   */
  findByCascadeKey(key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">): Promise<Idea | null>;
}

// ── Memory Implementation ────────────────────────────────────────────

export class MemoryIdeaStore implements IIdeaStore {
  private ideas = new Map<string, Idea>();
  private counter = 0;

  async submitIdea(
    text: string,
    author: string,
    sourceThreadId?: string,
    tags?: string[],
    backlink?: CascadeBacklink
  ): Promise<Idea> {
    this.counter++;
    const id = `idea-${this.counter}`;
    const now = new Date().toISOString();

    const idea: Idea = {
      id,
      text,
      author,
      status: "open",
      missionId: null,
      // Prefer backlink.sourceThreadId when both are present (cascade
      // handler is the authoritative source); fall back to the legacy
      // positional sourceThreadId for hand-submitted ideas linked to a
      // thread outside the cascade path.
      sourceThreadId: backlink?.sourceThreadId ?? sourceThreadId ?? null,
      sourceActionId: backlink?.sourceActionId ?? null,
      sourceThreadSummary: backlink?.sourceThreadSummary ?? null,
      tags: tags || [],
      createdAt: now,
      updatedAt: now,
    };

    this.ideas.set(id, idea);
    console.log(`[MemoryIdeaStore] Idea submitted: ${id}${backlink ? ` (cascade from ${backlink.sourceThreadId}/${backlink.sourceActionId})` : ""}`);
    return { ...idea };
  }

  async findByCascadeKey(key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">): Promise<Idea | null> {
    for (const idea of this.ideas.values()) {
      if (idea.sourceThreadId === key.sourceThreadId && idea.sourceActionId === key.sourceActionId) {
        return { ...idea };
      }
    }
    return null;
  }

  async getIdea(ideaId: string): Promise<Idea | null> {
    const idea = this.ideas.get(ideaId);
    return idea ? { ...idea } : null;
  }

  async listIdeas(statusFilter?: IdeaStatus): Promise<Idea[]> {
    const all = Array.from(this.ideas.values());
    const filtered = statusFilter
      ? all.filter((i) => i.status === statusFilter)
      : all;
    return filtered.map((i) => ({ ...i }));
  }

  async updateIdea(
    ideaId: string,
    updates: { status?: IdeaStatus; missionId?: string; tags?: string[]; text?: string }
  ): Promise<Idea | null> {
    const idea = this.ideas.get(ideaId);
    if (!idea) return null;

    if (updates.status) idea.status = updates.status;
    if (updates.missionId !== undefined) idea.missionId = updates.missionId;
    if (updates.tags) idea.tags = updates.tags;
    if (updates.text !== undefined) idea.text = updates.text;
    idea.updatedAt = new Date().toISOString();

    console.log(`[MemoryIdeaStore] Idea updated: ${ideaId} → status=${idea.status}`);
    return { ...idea };
  }
}
