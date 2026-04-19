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
   *  integration-test | code-review | llm-self-review. Free text v1. */
  surfacedBy: string | null;
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

// ── Memory Implementation ────────────────────────────────────────────

export class MemoryBugStore implements IBugStore {
  private bugs = new Map<string, Bug>();
  private counter = 0;

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
    } = {}
  ): Promise<Bug> {
    this.counter++;
    const id = `bug-${this.counter}`;
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
      createdAt: now,
      updatedAt: now,
    };
    this.bugs.set(id, bug);
    console.log(`[MemoryBugStore] Bug reported: ${id} — ${title} (severity=${severity}${options.backlink ? `, cascade from ${options.backlink.sourceThreadId}/${options.backlink.sourceActionId}` : ""})`);
    return { ...bug, tags: [...bug.tags], linkedTaskIds: [...bug.linkedTaskIds], fixCommits: [...bug.fixCommits] };
  }

  async getBug(bugId: string): Promise<Bug | null> {
    const b = this.bugs.get(bugId);
    if (!b) return null;
    return { ...b, tags: [...b.tags], linkedTaskIds: [...b.linkedTaskIds], fixCommits: [...b.fixCommits] };
  }

  async listBugs(filter?: {
    status?: BugStatus;
    severity?: BugSeverity;
    class?: string;
    tags?: string[];
  }): Promise<Bug[]> {
    let out = Array.from(this.bugs.values());
    if (filter?.status) out = out.filter((b) => b.status === filter.status);
    if (filter?.severity) out = out.filter((b) => b.severity === filter.severity);
    if (filter?.class !== undefined) out = out.filter((b) => b.class === filter.class);
    if (filter?.tags && filter.tags.length > 0) {
      const match = new Set(filter.tags);
      out = out.filter((b) => b.tags.some((t) => match.has(t)));
    }
    return out.map((b) => ({ ...b, tags: [...b.tags], linkedTaskIds: [...b.linkedTaskIds], fixCommits: [...b.fixCommits] }));
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
    const bug = this.bugs.get(bugId);
    if (!bug) return null;
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
    console.log(`[MemoryBugStore] Bug updated: ${bugId} → status=${bug.status}`);
    return { ...bug, tags: [...bug.tags], linkedTaskIds: [...bug.linkedTaskIds], fixCommits: [...bug.fixCommits] };
  }

  async findByCascadeKey(key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">): Promise<Bug | null> {
    for (const b of this.bugs.values()) {
      if (b.sourceThreadId === key.sourceThreadId && b.sourceActionId === key.sourceActionId) {
        return { ...b, tags: [...b.tags], linkedTaskIds: [...b.linkedTaskIds], fixCommits: [...b.fixCommits] };
      }
    }
    return null;
  }

  async findBySourceIdeaId(sourceIdeaId: string): Promise<Bug | null> {
    for (const b of this.bugs.values()) {
      if (b.sourceIdeaId === sourceIdeaId) {
        return { ...b, tags: [...b.tags], linkedTaskIds: [...b.linkedTaskIds], fixCommits: [...b.fixCommits] };
      }
    }
    return null;
  }
}
