/**
 * Bug Entity (M-Cascade-Perfection Phase 2, ADR-015, idea-16 closure).
 *
 * First-class defect tracking entity — distinct from Idea (which is
 * reserved for features / enhancements / unrefined thoughts). Prior
 * practice tracked bugs as Ideas tagged `bug`, losing lifecycle
 * semantics (status, severity) and linkage to fixing tasks.
 *
 * Lifecycle:
 *   open → investigating → resolved | wontfix
 *   (terminal: resolved, wontfix)
 *
 * Class + tags are intentionally free-text v1. After ~20 bugs are
 * classified, `class` is a candidate for enum promotion. Tags remain
 * open-ended (same pattern as Idea.tags).
 */

// ── Types ────────────────────────────────────────────────────────────

import type { EntityProvenance } from "../state.js";

export type BugStatus = "open" | "investigating" | "resolved" | "wontfix";
export type BugSeverity = "critical" | "major" | "minor";

export interface Bug {
  id: string;
  title: string;
  description: string;
  status: BugStatus;
  severity: BugSeverity;
  /** Root-cause taxonomy — free text v1 (drift | race | cognitive |
   *  identity-resolution | dedup | schema-validation-gap |
   *  missing-feature | ...). Promoted to enum after migration + ~20
   *  bugs confirms the shape. Null until classified. */
  class: string | null;
  /** Open-ended categorization (component / subsystem / mission /
   *  discovery-channel / severity-modifier). Same pattern as Idea.tags. */
  tags: string[];
  // Migration + provenance
  /** For bugs migrated from `bug`-tagged Ideas. Null for bugs created
   *  natively via `create_bug`. */
  sourceIdeaId: string | null;
  /** Cascade back-link (INV-TH20). Populated when spawned via the
   *  `create_bug` cascade action. Null for direct-tool creates. */
  sourceThreadId: string | null;
  sourceActionId: string | null;
  /** INV-TH23 Summary-as-Living-Record — frozen at commit. */
  sourceThreadSummary: string | null;
  // Fix metadata
  linkedTaskIds: string[];
  linkedMissionId: string | null;
  fixCommits: string[];
  fixRevision: string | null;
  /** Discovery channel — itw-smoke | unit-test | prod-audit |
   *  integration-test | code-review | llm-self-review. Free text v1.
   *  Per thread-225 ratification, `surfacedBy` stays distinct from
   *  `createdBy`: this is the discovery mechanism, not the agent. */
  surfacedBy: string | null;
  /** Mission-24 idea-120: uniform direct-create provenance (task-305). */
  createdBy?: EntityProvenance;
  createdAt: string;
  updatedAt: string;
}

// Re-export CascadeBacklink shape for the store to accept the optional
// arg. Keeps the entity module free of state.ts runtime imports.
export interface CascadeBacklink {
  sourceThreadId: string;
  sourceActionId: string;
  sourceThreadSummary: string;
}

// ── Interface ────────────────────────────────────────────────────────

export interface IBugStore {
  /**
   * Create a new Bug. `sourceIdeaId` + `backlink` are mutually
   * exclusive provenance — migrated bugs have sourceIdeaId;
   * cascade-spawned bugs have backlink.
   */
  createBug(
    title: string,
    description: string,
    severity: BugSeverity,
    options?: {
      classHint?: string;
      tags?: string[];
      sourceIdeaId?: string;
      surfacedBy?: string;
      backlink?: CascadeBacklink;
      createdBy?: EntityProvenance;
    }
  ): Promise<Bug>;

  getBug(bugId: string): Promise<Bug | null>;

  listBugs(filter?: {
    status?: BugStatus;
    severity?: BugSeverity;
    class?: string;
    tags?: string[];
  }): Promise<Bug[]>;

  /**
   * Update a bug. Status transitions enforced by the policy layer
   * (BUG_FSM); store allows any valid status assignment.
   * Tags / class / description / linked metadata are freely editable.
   */
  updateBug(
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
  ): Promise<Bug | null>;

  /**
   * INV-TH20: look up by cascade natural key. Returns null when no bug
   * was spawned from the given {sourceThreadId, sourceActionId} pair.
   */
  findByCascadeKey(key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">): Promise<Bug | null>;

  /** Migration: look up a bug already created from a given source Idea. */
  findBySourceIdeaId(sourceIdeaId: string): Promise<Bug | null>;
}

// Mission-47 W2: `MemoryBugStore` deleted. `BugRepository` in
// `bug-repository.ts` composes any `StorageProvider` (including
// `MemoryStorageProvider` for tests) via the IBugStore interface.
