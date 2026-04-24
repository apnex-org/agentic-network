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
   * Mission-24 idea-120: uniform direct-create provenance (task-305).
   * Required. Populated by handlers via `resolveCreatedBy(ctx)` on
   * direct creates and from `action.proposer` on cascade creates.
   * Legacy entities predating task-305 are backfilled either (a) from
   * the legacy `author` field present in pre-migration GCS JSON via
   * the migrate-on-read shim in `GcsIdeaStore`, or (b) from the
   * one-shot backfill script walking the audit log for the entity id.
   */
  createdBy: EntityProvenance;
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
    createdBy: EntityProvenance,
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

// Mission-47 W2: `MemoryIdeaStore` deleted. `IdeaRepository` in
// `idea-repository.ts` composes any `StorageProvider` (including
// `MemoryStorageProvider` for tests) via the IIdeaStore interface.
