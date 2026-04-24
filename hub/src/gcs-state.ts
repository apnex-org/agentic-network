/**
 * GCS Bucket implementation of ITaskStore and IEngineerRegistry.
 *
 * Stores tasks as JSON files, reports as Markdown files, and engineer
 * registry entries as JSON files in a GCS bucket.
 *
 * Bucket layout:
 *   gs://{bucket}/tasks/task-001.json
 *   gs://{bucket}/reports/task-001-report.md
 *   gs://{bucket}/engineers/eng-1.json
 *   gs://{bucket}/meta/counter.json
 */

import { Storage } from "@google-cloud/storage";
import type {
  Task,
  TaskStatus,
  Proposal,
  ProposalStatus,
  Thread,
  ThreadMessage,
  ThreadStatus,
  ThreadAuthor,
  ThreadIntent,
  SemanticIntent,
  AuditEntry,
  Notification,
  EngineerStatusEntry,
  SessionRole,
  ITaskStore,
  IProposalStore,
  IThreadStore,
  IAuditStore,
  INotificationStore,
  IEngineerRegistry,
  Agent,
  AgentLivenessState,
  AgentRole,
  RegisterAgentPayload,
  RegisterAgentResult,
  AssertIdentityPayload,
  AssertIdentityResult,
  ClaimSessionResult,
  ClaimSessionTrigger,
  Selector,
  ReplyToThreadOptions,
  OpenThreadOptions,
  ReapedThread,
  ParticipantRole,
  CascadeBacklink,
  EntityProvenance,
} from "./state.js";
import {
  computeFingerprint,
  shortHash,
  recordDisplacementAndCheck,
  labelsMatch,
  shallowEqualLabels,
  taskClaimableBy,
  applyStagedActionOps,
  upsertParticipant,
  ThreadConvergenceGateError,
  CONVERGENCE_GATE_REMEDIATION,
  truncateClosedThreadMessages,
  THRASHING_THRESHOLD,
  THRASHING_WINDOW_MS,
  AGENT_TOUCH_MIN_INTERVAL_MS,
  DEFAULT_AGENT_RECEIPT_SLA_MS,
} from "./state.js";
import type { ConvergenceGateSubtype } from "./state.js";
import { validateStagedActions } from "./policy/staged-action-payloads.js";

// ── Simple async lock ────────────────────────────────────────────────
// Prevents concurrent GCS read-modify-write races within a single
// Node.js process (Cloud Run max-instances=1).

class AsyncLock {
  private locked = false;
  private queue: (() => void)[] = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }
}

// ── GCS Helpers ──────────────────────────────────────────────────────

const storage = new Storage();

export async function readJson<T>(bucket: string, path: string): Promise<T | null> {
  try {
    const [content] = await storage.bucket(bucket).file(path).download();
    return JSON.parse(content.toString("utf-8")) as T;
  } catch (error: any) {
    if (error.code === 404) return null;
    throw error;
  }
}

// Module-internal — NOT exported. External callers must use one of the
// three concurrency-aware primitives (createOnly / updateExisting /
// upsert) declared below. See ADR-011 for the invariant.
async function writeJson(bucket: string, path: string, data: unknown): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  await storage.bucket(bucket).file(path).save(content, {
    contentType: "application/json",
  });
}

// ── GCS Optimistic Concurrency Control helpers ──────────────────────
// Uses `ifGenerationMatch` to implement compare-and-swap semantics on
// GCS-backed JSON objects. A `generation` of 0 means "must not exist yet"
// (create-only); any other value matches the expected object version.

export async function readJsonWithGeneration<T>(
  bucket: string,
  path: string,
): Promise<{ data: T; generation: number } | null> {
  try {
    const file = storage.bucket(bucket).file(path);
    const [content] = await file.download();
    const [metadata] = await file.getMetadata();
    return {
      data: JSON.parse(content.toString("utf-8")) as T,
      generation: Number(metadata.generation ?? 0),
    };
  } catch (error: any) {
    if (error.code === 404) return null;
    throw error;
  }
}

/** Thrown when `ifGenerationMatch` fails — another writer won the race. */
export class GcsOccPreconditionFailed extends Error {
  constructor(path: string) {
    super(`GCS OCC precondition failed for ${path}`);
    this.name = "GcsOccPreconditionFailed";
  }
}

/** Thrown by `updateExisting` when the target path does not exist. */
export class GcsPathNotFound extends Error {
  constructor(path: string) {
    super(`GCS path not found: ${path}`);
    this.name = "GcsPathNotFound";
  }
}

/** Thrown by `updateExisting` / `upsert` when the CAS retry budget is exhausted. */
export class GcsOccRetryExhausted extends Error {
  constructor(path: string, public readonly attempts: number) {
    super(`GCS OCC retry budget exhausted for ${path} after ${attempts} attempts`);
    this.name = "GcsOccRetryExhausted";
  }
}

export async function writeJsonWithPrecondition(
  bucket: string,
  path: string,
  data: unknown,
  ifGenerationMatch: number,
): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  try {
    await storage.bucket(bucket).file(path).save(content, {
      contentType: "application/json",
      preconditionOpts: { ifGenerationMatch },
    });
  } catch (error: any) {
    // GCS returns 412 Precondition Failed when generation mismatches.
    if (error.code === 412) throw new GcsOccPreconditionFailed(path);
    throw error;
  }
}

// ── Phase 2 concurrency-aware primitives (ADR-011) ──────────────────
// These are the ONLY public write surface for GCS-backed entity stores.
// The plain `writeJson` is module-internal — new call sites must pick
// one of the three intent-bearing primitives below.

const OCC_RETRY_MAX_ATTEMPTS = 5;
const OCC_RETRY_INITIAL_BACKOFF_MS = 20;

// Module-internal sentinel. Gated state transitions (e.g., "cancel only
// when pending") throw this from inside an `updateExisting` transform to
// signal the gate failed on a fresh read. Not retried — the transform's
// business check is authoritative. Caller catches and maps to its
// existing false/null contract.
class TransitionRejected extends Error {
  constructor(reason: string) {
    super(`transition rejected: ${reason}`);
    this.name = "TransitionRejected";
  }
}

/**
 * Exposed for unit testing only. Drives the CAS retry loop with injected
 * reader/writer so we can exercise the retry + backoff logic without a
 * live GCS bucket. Not for application use — application code should
 * call `createOnly` / `updateExisting` / `upsert`.
 */
export async function __casRetryForTest<T>(
  reader: () => Promise<{ data: T | null; generation: number }>,
  writer: (next: T, gen: number) => Promise<void>,
  transform: (current: T | null) => T | Promise<T>,
  opts: { allowMissing: boolean; path: string; sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; attempt < OCC_RETRY_MAX_ATTEMPTS; attempt++) {
    const { data, generation } = await reader();
    if (data === null && !opts.allowMissing) throw new GcsPathNotFound(opts.path);
    const next = await transform(data);
    try {
      await writer(next, generation);
      return next;
    } catch (err) {
      if (err instanceof GcsOccPreconditionFailed) {
        if (attempt + 1 >= OCC_RETRY_MAX_ATTEMPTS) {
          throw new GcsOccRetryExhausted(opts.path, attempt + 1);
        }
        const base = OCC_RETRY_INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        const jitter = Math.floor(Math.random() * base);
        await sleep(base + jitter);
        continue;
      }
      throw err;
    }
  }
  throw new GcsOccRetryExhausted(opts.path, OCC_RETRY_MAX_ATTEMPTS);
}

/**
 * Create a new JSON object at `path`. Fails with `GcsOccPreconditionFailed`
 * if the object already exists. Use for initial-creation paths where the
 * ID is freshly allocated and nothing else should be writing there.
 */
export async function createOnly<T>(
  bucket: string,
  path: string,
  data: T,
): Promise<void> {
  await writeJsonWithPrecondition(bucket, path, data, 0);
}

/**
 * OCC-safe update of an existing JSON object. Reads the current state
 * with its GCS generation, applies `transform`, and writes with
 * `ifGenerationMatch`. On precondition failure, re-reads and retries
 * with jittered exponential backoff up to `OCC_RETRY_MAX_ATTEMPTS`.
 *
 * Throws:
 *   - `GcsPathNotFound` if the object does not exist.
 *   - `GcsOccRetryExhausted` if concurrent writers beat us repeatedly.
 *   - Any other error from `transform` (not retried — business-level
 *     gating belongs inside the transform and bubbles up).
 *
 * Returns the final written state.
 */
export async function updateExisting<T>(
  bucket: string,
  path: string,
  transform: (current: T) => T | Promise<T>,
): Promise<T> {
  return __casRetryForTest<T>(
    async () => {
      const r = await readJsonWithGeneration<T>(bucket, path);
      return { data: r?.data ?? null, generation: r?.generation ?? 0 };
    },
    (next, gen) => writeJsonWithPrecondition(bucket, path, next, gen),
    (cur) => transform(cur as T),
    { allowMissing: false, path },
  );
}

/**
 * OCC-safe either-create-or-update. Reads the current state (may be
 * null), applies `transform(current | null)`, writes with
 * `ifGenerationMatch = generation` (0 if absent). Retries on precondition
 * failure with the same backoff as `updateExisting`.
 */
export async function upsert<T>(
  bucket: string,
  path: string,
  transform: (current: T | null) => T | Promise<T>,
): Promise<T> {
  return __casRetryForTest<T>(
    async () => {
      const r = await readJsonWithGeneration<T>(bucket, path);
      return { data: r?.data ?? null, generation: r?.generation ?? 0 };
    },
    (next, gen) => writeJsonWithPrecondition(bucket, path, next, gen),
    transform,
    { allowMissing: true, path },
  );
}

async function writeMarkdown(bucket: string, path: string, content: string): Promise<void> {
  await storage.bucket(bucket).file(path).save(content, {
    contentType: "text/markdown",
  });
}

async function deleteFile(bucket: string, path: string): Promise<void> {
  try {
    await storage.bucket(bucket).file(path).delete();
  } catch (error: any) {
    if (error.code !== 404) throw error;
  }
}

export async function listFiles(bucket: string, prefix: string): Promise<string[]> {
  const [files] = await storage.bucket(bucket).getFiles({ prefix });
  return files.map((f) => f.name);
}

// ── Counter Management ───────────────────────────────────────────────

interface Counters {
  taskCounter: number;
  proposalCounter: number;
  engineerCounter: number;
  threadCounter: number;
  notificationCounter: number;
  ideaCounter: number;
  missionCounter: number;
  turnCounter: number;
  teleCounter: number;
  bugCounter: number;
  // Phase 2x P0-1 — GCS persistence for ADR-017 pending-action queue
  // and Director-escalation notifications.
  pendingActionCounter: number;
  directorNotificationCounter: number;
}

const counterLock = new AsyncLock();

/**
 * Safe number parser — returns 0 for any non-finite value (NaN, undefined, null, Infinity).
 */
function safeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

export async function getAndIncrementCounter(
  bucket: string,
  field: keyof Counters
): Promise<number> {
  await counterLock.acquire();
  try {
    const raw = (await readJson<Counters>(bucket, "meta/counter.json")) || {
      taskCounter: 0,
      proposalCounter: 0,
      engineerCounter: 0,
      threadCounter: 0,
      notificationCounter: 0,
      ideaCounter: 0,
      missionCounter: 0,
      turnCounter: 0,
      teleCounter: 0,
      bugCounter: 0,
      pendingActionCounter: 0,
      directorNotificationCounter: 0,
    };
    // Ensure all counters are valid finite numbers (handles NaN, null, undefined)
    const counters: Counters = {
      taskCounter: safeInt(raw.taskCounter),
      proposalCounter: safeInt(raw.proposalCounter),
      engineerCounter: safeInt(raw.engineerCounter),
      threadCounter: safeInt(raw.threadCounter),
      notificationCounter: safeInt(raw.notificationCounter),
      ideaCounter: safeInt(raw.ideaCounter),
      missionCounter: safeInt(raw.missionCounter),
      turnCounter: safeInt(raw.turnCounter),
      teleCounter: safeInt(raw.teleCounter),
      bugCounter: safeInt(raw.bugCounter),
      pendingActionCounter: safeInt(raw.pendingActionCounter),
      directorNotificationCounter: safeInt(raw.directorNotificationCounter),
    };
    counters[field]++;
    await writeJson(bucket, "meta/counter.json", counters);
    return counters[field];
  } finally {
    counterLock.release();
  }
}

/**
 * Counter reconciliation — scans existing entities and ensures counters
 * are at least as high as the highest existing ID. Prevents ID collisions
 * after counter corruption (e.g., the thread-NaN bug).
 */
async function reconcileCounters(bucket: string): Promise<void> {
  await counterLock.acquire();
  try {
    const raw = (await readJson<Counters>(bucket, "meta/counter.json")) || {
      taskCounter: 0,
      proposalCounter: 0,
      engineerCounter: 0,
      threadCounter: 0,
      notificationCounter: 0,
      ideaCounter: 0,
      missionCounter: 0,
      turnCounter: 0,
      teleCounter: 0,
      bugCounter: 0,
      pendingActionCounter: 0,
      directorNotificationCounter: 0,
    };
    const counters: Counters = {
      taskCounter: safeInt(raw.taskCounter),
      proposalCounter: safeInt(raw.proposalCounter),
      engineerCounter: safeInt(raw.engineerCounter),
      threadCounter: safeInt(raw.threadCounter),
      notificationCounter: safeInt(raw.notificationCounter),
      ideaCounter: safeInt(raw.ideaCounter),
      missionCounter: safeInt(raw.missionCounter),
      turnCounter: safeInt(raw.turnCounter),
      teleCounter: safeInt(raw.teleCounter),
      bugCounter: safeInt(raw.bugCounter),
      pendingActionCounter: safeInt(raw.pendingActionCounter),
      directorNotificationCounter: safeInt(raw.directorNotificationCounter),
    };

    // Scan each entity type and find the highest existing numeric ID
    const prefixes: { prefix: string; pattern: RegExp; field: keyof Counters }[] = [
      { prefix: "tasks/", pattern: /task-(\d+)\.json$/, field: "taskCounter" },
      { prefix: "proposals/", pattern: /prop-(\d+)\.json$/, field: "proposalCounter" },
      { prefix: "engineers/", pattern: /eng-(\d+)\.json$/, field: "engineerCounter" },
      { prefix: "threads/", pattern: /thread-(\d+)\.json$/, field: "threadCounter" },
      { prefix: "notifications/", pattern: /notif-(\d+)\.json$/, field: "notificationCounter" },
      { prefix: "ideas/", pattern: /idea-(\d+)\.json$/, field: "ideaCounter" },
      { prefix: "missions/", pattern: /mission-(\d+)\.json$/, field: "missionCounter" },
      { prefix: "turns/", pattern: /turn-(\d+)\.json$/, field: "turnCounter" },
      { prefix: "tele/", pattern: /tele-(\d+)\.json$/, field: "teleCounter" },
      { prefix: "bugs/", pattern: /bug-(\d+)\.json$/, field: "bugCounter" },
    ];

    let reconciled = false;
    for (const { prefix, pattern, field } of prefixes) {
      const files = await listFiles(bucket, prefix);
      let maxId = 0;
      for (const file of files) {
        const match = file.match(pattern);
        if (match) {
          const num = parseInt(match[1], 10);
          if (Number.isFinite(num) && num > maxId) maxId = num;
        }
      }
      if (maxId > counters[field]) {
        console.log(`[Reconcile] ${field}: ${counters[field]} → ${maxId} (found higher existing ID)`);
        counters[field] = maxId;
        reconciled = true;
      }
    }

    if (reconciled) {
      await writeJson(bucket, "meta/counter.json", counters);
      console.log(`[Reconcile] Counters reconciled: ${JSON.stringify(counters)}`);
    } else {
      console.log(`[Reconcile] Counters OK: ${JSON.stringify(counters)}`);
    }
  } finally {
    counterLock.release();
  }
}

// Clean up orphaned NaN files from counter corruption bugs
async function cleanupOrphanedFiles(bucket: string): Promise<void> {
  const prefixes = ["tasks/", "proposals/", "engineers/", "threads/"];
  for (const prefix of prefixes) {
    const files = await listFiles(bucket, prefix);
    for (const file of files) {
      if (file.includes("NaN")) {
        console.log(`[Cleanup] Deleting orphaned file: ${file}`);
        await deleteFile(bucket, file);
      }
    }
  }
}

// Export reconciliation utilities for startup use
export { reconcileCounters, cleanupOrphanedFiles };

// Mission-47 W5: GcsTaskStore removed — TaskRepository in
// hub/src/entities/task-repository.ts composes StorageProvider
// (including GcsStorageProvider) via the ITaskStore interface.


// Mission-47 W7b: GcsEngineerRegistry + normalizeAgentShape removed —
// AgentRepository in hub/src/entities/agent-repository.ts composes
// StorageProvider (including GcsStorageProvider) via the
// IEngineerRegistry interface. normalizeAgentShape helper ported
// into the repository module.


// Mission-47 W5: GcsProposalStore removed — ProposalRepository in
// hub/src/entities/proposal-repository.ts composes StorageProvider
// (including GcsStorageProvider) via the IProposalStore interface.


// Mission-47 W6: GcsThreadStore removed — ThreadRepository in
// hub/src/entities/thread-repository.ts composes StorageProvider
// (including GcsStorageProvider) via the IThreadStore interface.
// normalizeThreadShape/normalizeRoutingMode/isThreadContext/
// normalizeStagedActionShape helpers moved into the repository
// (they were GcsThreadStore-internal read-side normalisation).


// ── GCS Audit Store ──────────────────────────────────────────────────

export class GcsAuditStore implements IAuditStore {
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
    console.log(`[GcsAuditStore] Using bucket: gs://${bucket}`);
  }

  async logEntry(actor: AuditEntry["actor"], action: string, details: string, relatedEntity?: string): Promise<AuditEntry> {
    const now = new Date();
    // Use timestamp-based ID for natural chronological ordering in GCS
    const ts = now.toISOString().replace(/[:.]/g, "-");
    const id = `audit-${ts}`;

    const entry: AuditEntry = {
      id,
      timestamp: now.toISOString(),
      actor,
      action,
      details,
      relatedEntity: relatedEntity || null,
    };

    await createOnly<AuditEntry>(this.bucket, `audit/${id}.json`, entry);
    console.log(`[GcsAuditStore] ${actor}/${action}: ${details.substring(0, 80)}`);
    return { ...entry };
  }

  async listEntries(limit = 50, actor?: AuditEntry["actor"]): Promise<AuditEntry[]> {
    const files = await listFiles(this.bucket, "audit/");
    const entries: AuditEntry[] = [];
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort().reverse();

    for (const file of jsonFiles) {
      if (entries.length >= limit) break;
      const entry = await readJson<AuditEntry>(this.bucket, file);
      if (entry) {
        if (actor && entry.actor !== actor) continue;
        entries.push(entry);
      }
    }
    return entries;
  }
}

// ── GCS Notification Store ───────────────────────────────────────────

export class GcsNotificationStore implements INotificationStore {
  private bucket: string;
  private ulidGen: (() => string) | null = null;

  // AMP namespace cutover: new ULID notifications go to v2/, legacy stays frozen
  private static readonly V2_PREFIX = "notifications/v2/";

  constructor(bucket: string) {
    this.bucket = bucket;
    console.log(`[GcsNotificationStore] Using bucket: gs://${bucket} (v2 namespace: ${GcsNotificationStore.V2_PREFIX})`);
  }

  async persist(
    event: string,
    data: Record<string, unknown>,
    targetRoles: string[]
  ): Promise<Notification> {
    const { monotonicFactory } = await import("ulidx");
    if (!this.ulidGen) this.ulidGen = monotonicFactory();
    const id = this.ulidGen();

    const notification: Notification = {
      id,
      event,
      targetRoles,
      data,
      timestamp: new Date().toISOString(),
    };

    // Write to v2/ namespace — ULIDs are lexicographically sortable
    await createOnly<Notification>(this.bucket, `${GcsNotificationStore.V2_PREFIX}${id}.json`, notification);

    console.log(`[GcsNotificationStore] Persisted ${id}: ${event} → [${targetRoles.join(",")}]`);
    return notification;
  }

  async listSince(afterId: number | string, role?: string): Promise<Notification[]> {
    const afterStr = String(afterId);

    // Only read from v2/ namespace — legacy integer notifications are frozen
    const files = await listFiles(this.bucket, GcsNotificationStore.V2_PREFIX);
    const jsonFiles = files
      .filter((f) => f.endsWith(".json"))
      .sort(); // Lexicographic sort — natural for ULIDs

    const notifications: Notification[] = [];
    for (const file of jsonFiles) {
      const notification = await readJson<Notification>(this.bucket, file);
      if (!notification) continue;
      // ULID string comparison — all v2 notifications have ULID IDs
      const nStr = String(notification.id);
      if (afterStr && nStr <= afterStr) continue;
      if (role && !notification.targetRoles.includes(role)) continue;
      notifications.push(notification);
    }

    return notifications;
  }

  async cleanup(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    // Clean up from v2/ namespace only
    const files = await listFiles(this.bucket, GcsNotificationStore.V2_PREFIX);
    let deleted = 0;

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const notification = await readJson<Notification>(this.bucket, file);
      if (!notification) continue;

      if (new Date(notification.timestamp).getTime() < cutoff) {
        await deleteFile(this.bucket, file);
        deleted++;
      }
    }

    if (deleted > 0) {
      console.log(`[GcsNotificationStore] Cleaned up ${deleted} expired notifications`);
    }
    return deleted;
  }
}
