/**
 * mission-83 W2.4 — 6 new repository stubs.
 *
 * Per Design v1.3 §5.1 Option Y composition shape: repositories preserve their
 * I*Store boundaries; internally compose HubStorageSubstrate. These 6 stubs
 * are minimal CRUD facades — full Option Y refactor (per-entity logic; sequence
 * allocation; CAS retry loops; etc.) happens at W4 per architect-dispatch.
 *
 * Single-file consolidated form for spike-quality + ease of bilateral
 * inspection; W4 refactor may split per-file alongside existing
 * hub/src/entities/*-repository.ts files.
 *
 * Kinds:
 *   - IDocumentStore + DocumentRepository
 *   - INotificationStore + NotificationRepository (closes mission-56 W5 partial-
 *     completion; absorbs hub-networking.ts direct-write paths at W4)
 *   - IArchitectDecisionStore + ArchitectDecisionRepository (OQ7 decomposition)
 *   - IDirectorHistoryEntryStore + DirectorHistoryEntryRepository (OQ7)
 *   - IReviewHistoryEntryStore + ReviewHistoryEntryRepository (OQ7)
 *   - IThreadHistoryEntryStore + ThreadHistoryEntryRepository (OQ7)
 */

import type { HubStorageSubstrate } from "./types.js";

// ─── Common entity-shape primitives ─────────────────────────────────────────

interface BaseEntity {
  id: string;
  createdAt?: string;
  updatedAt?: string;
}

// ─── Document ──────────────────────────────────────────────────────────────

export interface Document extends BaseEntity {
  category?: string;
  content: string;  // markdown body
}

export interface IDocumentStore {
  get(id: string): Promise<Document | null>;
  put(doc: Document): Promise<{ id: string; resourceVersion: string }>;
  delete(id: string): Promise<void>;
  list(opts?: { category?: string }): Promise<Document[]>;
}

export class DocumentRepository implements IDocumentStore {
  constructor(private readonly substrate: HubStorageSubstrate) {}

  async get(id: string): Promise<Document | null> {
    return this.substrate.get<Document>("Document", id);
  }

  async put(doc: Document): Promise<{ id: string; resourceVersion: string }> {
    return this.substrate.put("Document", doc);
  }

  async delete(id: string): Promise<void> {
    return this.substrate.delete("Document", id);
  }

  async list(opts: { category?: string } = {}): Promise<Document[]> {
    const filter = opts.category ? { category: opts.category } : undefined;
    const { items } = await this.substrate.list<Document>("Document", filter ? { filter } : undefined);
    return items;
  }
}

// ─── Notification (re-introduction per OQ8) ─────────────────────────────────

export interface Notification extends BaseEntity {
  event?: string;
  recipientRole?: string;
  recipientAgentId?: string;
  payload?: Record<string, unknown>;
}

export interface INotificationStore {
  get(id: string): Promise<Notification | null>;
  put(n: Notification): Promise<{ id: string; resourceVersion: string }>;
  delete(id: string): Promise<void>;
  list(opts?: { recipientAgentId?: string }): Promise<Notification[]>;
}

export class NotificationRepository implements INotificationStore {
  constructor(private readonly substrate: HubStorageSubstrate) {}

  async get(id: string): Promise<Notification | null> {
    return this.substrate.get<Notification>("Notification", id);
  }

  async put(n: Notification): Promise<{ id: string; resourceVersion: string }> {
    return this.substrate.put("Notification", n);
  }

  async delete(id: string): Promise<void> {
    return this.substrate.delete("Notification", id);
  }

  async list(opts: { recipientAgentId?: string } = {}): Promise<Notification[]> {
    const filter = opts.recipientAgentId ? { recipientAgentId: opts.recipientAgentId } : undefined;
    const { items } = await this.substrate.list<Notification>("Notification", filter ? { filter } : undefined);
    return items;
  }
}

// ─── ArchitectDecision (OQ7 decomposition) ──────────────────────────────────

export interface ArchitectDecision extends BaseEntity {
  decision?: string;
  context?: string;
  timestamp?: string;
}

export interface IArchitectDecisionStore {
  get(id: string): Promise<ArchitectDecision | null>;
  put(d: ArchitectDecision): Promise<{ id: string; resourceVersion: string }>;
  delete(id: string): Promise<void>;
  list(): Promise<ArchitectDecision[]>;
}

export class ArchitectDecisionRepository implements IArchitectDecisionStore {
  constructor(private readonly substrate: HubStorageSubstrate) {}

  async get(id: string): Promise<ArchitectDecision | null> {
    return this.substrate.get<ArchitectDecision>("ArchitectDecision", id);
  }

  async put(d: ArchitectDecision): Promise<{ id: string; resourceVersion: string }> {
    return this.substrate.put("ArchitectDecision", d);
  }

  async delete(id: string): Promise<void> {
    return this.substrate.delete("ArchitectDecision", id);
  }

  async list(): Promise<ArchitectDecision[]> {
    const { items } = await this.substrate.list<ArchitectDecision>("ArchitectDecision");
    return items;
  }
}

// ─── DirectorHistoryEntry (OQ7 decomposition) ───────────────────────────────

export interface DirectorHistoryEntry extends BaseEntity {
  role?: string;
  text?: string;
}

export interface IDirectorHistoryEntryStore {
  get(id: string): Promise<DirectorHistoryEntry | null>;
  put(e: DirectorHistoryEntry): Promise<{ id: string; resourceVersion: string }>;
  delete(id: string): Promise<void>;
  list(): Promise<DirectorHistoryEntry[]>;
}

export class DirectorHistoryEntryRepository implements IDirectorHistoryEntryStore {
  constructor(private readonly substrate: HubStorageSubstrate) {}

  async get(id: string): Promise<DirectorHistoryEntry | null> {
    return this.substrate.get<DirectorHistoryEntry>("DirectorHistoryEntry", id);
  }

  async put(e: DirectorHistoryEntry): Promise<{ id: string; resourceVersion: string }> {
    return this.substrate.put("DirectorHistoryEntry", e);
  }

  async delete(id: string): Promise<void> {
    return this.substrate.delete("DirectorHistoryEntry", id);
  }

  async list(): Promise<DirectorHistoryEntry[]> {
    const { items } = await this.substrate.list<DirectorHistoryEntry>("DirectorHistoryEntry");
    return items;
  }
}

// ─── ReviewHistoryEntry (OQ7 decomposition) ─────────────────────────────────

export interface ReviewHistoryEntry extends BaseEntity {
  taskId?: string;
  assessment?: string;
}

export interface IReviewHistoryEntryStore {
  get(id: string): Promise<ReviewHistoryEntry | null>;
  put(e: ReviewHistoryEntry): Promise<{ id: string; resourceVersion: string }>;
  delete(id: string): Promise<void>;
  list(opts?: { taskId?: string }): Promise<ReviewHistoryEntry[]>;
}

export class ReviewHistoryEntryRepository implements IReviewHistoryEntryStore {
  constructor(private readonly substrate: HubStorageSubstrate) {}

  async get(id: string): Promise<ReviewHistoryEntry | null> {
    return this.substrate.get<ReviewHistoryEntry>("ReviewHistoryEntry", id);
  }

  async put(e: ReviewHistoryEntry): Promise<{ id: string; resourceVersion: string }> {
    return this.substrate.put("ReviewHistoryEntry", e);
  }

  async delete(id: string): Promise<void> {
    return this.substrate.delete("ReviewHistoryEntry", id);
  }

  async list(opts: { taskId?: string } = {}): Promise<ReviewHistoryEntry[]> {
    const filter = opts.taskId ? { taskId: opts.taskId } : undefined;
    const { items } = await this.substrate.list<ReviewHistoryEntry>("ReviewHistoryEntry", filter ? { filter } : undefined);
    return items;
  }
}

// ─── ThreadHistoryEntry (OQ7 decomposition; W1.1 NEW finding) ───────────────

export interface ThreadHistoryEntry extends BaseEntity {
  threadId?: string;
  title?: string;
  outcome?: string;
  timestamp?: string;
}

export interface IThreadHistoryEntryStore {
  get(id: string): Promise<ThreadHistoryEntry | null>;
  put(e: ThreadHistoryEntry): Promise<{ id: string; resourceVersion: string }>;
  delete(id: string): Promise<void>;
  list(opts?: { threadId?: string }): Promise<ThreadHistoryEntry[]>;
}

export class ThreadHistoryEntryRepository implements IThreadHistoryEntryStore {
  constructor(private readonly substrate: HubStorageSubstrate) {}

  async get(id: string): Promise<ThreadHistoryEntry | null> {
    return this.substrate.get<ThreadHistoryEntry>("ThreadHistoryEntry", id);
  }

  async put(e: ThreadHistoryEntry): Promise<{ id: string; resourceVersion: string }> {
    return this.substrate.put("ThreadHistoryEntry", e);
  }

  async delete(id: string): Promise<void> {
    return this.substrate.delete("ThreadHistoryEntry", id);
  }

  async list(opts: { threadId?: string } = {}): Promise<ThreadHistoryEntry[]> {
    const filter = opts.threadId ? { threadId: opts.threadId } : undefined;
    const { items } = await this.substrate.list<ThreadHistoryEntry>("ThreadHistoryEntry", filter ? { filter } : undefined);
    return items;
  }
}
