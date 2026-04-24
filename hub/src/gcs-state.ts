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


// ── GCS Engineer Registry ────────────────────────────────────────────

export class GcsEngineerRegistry implements IEngineerRegistry {
  private bucket: string;
  private sessionRoles: Map<string, SessionRole> = new Map();
  // M18 displacement rate-limit accounting (in-memory; resets on hub restart).
  private displacementHistory: Map<string, number[]> = new Map();
  // Session heartbeat bookkeeping (in-memory; resets on hub restart).
  private sessionToEngineerId: Map<string, string> = new Map();
  private lastTouchAt: Map<string, number> = new Map(); // engineerId -> ms

  constructor(bucket: string) {
    this.bucket = bucket;
    console.log(`[GcsEngineerRegistry] Using bucket: gs://${bucket}`);
  }

  setSessionRole(sessionId: string, role: SessionRole): void {
    this.sessionRoles.set(sessionId, role);
  }

  getRole(sessionId: string): SessionRole {
    return this.sessionRoles.get(sessionId) || "unknown";
  }

  async getStatusSummary() {
    const agents = await this.listAgents();
    const engineers: EngineerStatusEntry[] = agents
      .filter((a) => !a.archived)
      .map((a) => ({
        engineerId: a.engineerId,
        sessionId: a.currentSessionId,
        status: a.status,
        sessionEpoch: a.sessionEpoch,
        clientMetadata: a.clientMetadata,
        advisoryTags: a.advisoryTags,
        labels: a.labels ?? {},
        firstSeenAt: a.firstSeenAt,
        lastSeenAt: a.lastSeenAt,
      }));
    const connected = engineers.filter((e) => e.status === "online").length;
    return { connected, engineers };
  }

  // ── M18 Agent methods ──────────────────────────────────────────────

  /**
   * OCC-protected Agent registration / displacement.
   *
   * Flow:
   *   1. Compute fingerprint from globalInstanceId (token NOT mixed in).
   *   2. Read agents/by-fingerprint/<fp>.json with generation.
   *   3. If not found → create new Agent (write with ifGenerationMatch=0).
   *   4. If found:
   *      a. If role mismatch → 403 role_mismatch.
   *      b. If currently online → check thrashing rate limit.
   *      c. Increment sessionEpoch, rebind currentSessionId, update metadata.
   *      d. Write with ifGenerationMatch=<previous generation>.
   *      e. On precondition fail → caller retries; one-shot retry here.
   */
  async registerAgent(
    sessionId: string,
    tokenRole: AgentRole,
    payload: RegisterAgentPayload,
    address?: string,
  ): Promise<RegisterAgentResult> {
    // Mission-24 Phase 2 (ADR-014 §77): SessionRole now carries the
    // "director" literal directly rather than mapping to "unknown".
    this.sessionRoles.set(sessionId, tokenRole as SessionRole);

    // M-Session-Claim-Separation (mission-40) T1: split into the new
    // assertIdentity + claimSession helpers. Externally byte-identical
    // to pre-T1 — register_role still both creates/finds the Agent and
    // binds the session in one logical call. T2 cuts over.
    const identity = await this.assertIdentity(
      {
        globalInstanceId: payload.globalInstanceId,
        role: tokenRole,
        clientMetadata: payload.clientMetadata,
        advisoryTags: payload.advisoryTags,
        labels: payload.labels,
        receiptSla: payload.receiptSla,
        wakeEndpoint: payload.wakeEndpoint,
      },
      sessionId,
      address,
    );
    if (!identity.ok) {
      return identity;
    }
    const claim = await this.claimSession(identity.engineerId, sessionId, "sse_subscribe");
    if (!claim.ok) {
      if (claim.code === "unknown_engineer") {
        // Impossible by construction unless GCS lost the per-engineerId
        // file between the two writes, which would indicate corrupted
        // bucket state — surface as an internal error not a user-visible
        // RegisterAgentFailure code.
        throw new Error(
          `Internal invariant violation: assertIdentity wrote ${identity.engineerId} but claimSession could not read it`,
        );
      }
      return { ok: false, code: claim.code, message: claim.message };
    }
    return {
      ok: true,
      engineerId: claim.engineerId,
      sessionEpoch: claim.sessionEpoch,
      wasCreated: identity.wasCreated,
      clientMetadata: identity.clientMetadata,
      advisoryTags: identity.advisoryTags,
      labels: identity.labels,
      ...(identity.changedFields ? { changedFields: identity.changedFields } : {}),
      ...(identity.priorLabels ? { priorLabels: identity.priorLabels } : {}),
      ...(claim.displacedPriorSession ? { displacedPriorSession: claim.displacedPriorSession } : {}),
    };
  }

  // ── M-Session-Claim-Separation (mission-40) T1: split helpers ─────

  async assertIdentity(
    payload: AssertIdentityPayload,
    sessionId?: string,
    _address?: string,
  ): Promise<AssertIdentityResult> {
    const fingerprint = computeFingerprint(payload.globalInstanceId);
    const fpPath = `agents/by-fingerprint/${fingerprint}.json`;
    // Two attempts: one for the natural path, one to retry on OCC contention.
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await readJsonWithGeneration<Agent>(this.bucket, fpPath);
      const now = new Date().toISOString();

      if (!existing) {
        // First-contact create: NO session bound (claimSession's job).
        // sessionEpoch starts at 0; status/livenessState=offline until a
        // session claims. Mission-24 Phase 2 director-* prefix preserved.
        const agentIdPrefix = payload.role === "director" ? "director" : "eng";
        const engineerId = `${agentIdPrefix}-${shortHash(fingerprint)}`;
        const agent: Agent = {
          engineerId,
          fingerprint,
          role: payload.role,
          status: "offline",
          archived: false,
          sessionEpoch: 0,
          currentSessionId: null,
          clientMetadata: payload.clientMetadata,
          advisoryTags: payload.advisoryTags ?? {},
          labels: payload.labels ?? {},
          firstSeenAt: now,
          lastSeenAt: now,
          livenessState: "offline",
          lastHeartbeatAt: now,
          receiptSla: payload.receiptSla ?? DEFAULT_AGENT_RECEIPT_SLA_MS,
          wakeEndpoint: payload.wakeEndpoint ?? null,
        };
        try {
          await writeJsonWithPrecondition(this.bucket, fpPath, agent, 0);
          await writeJson(this.bucket, `agents/${engineerId}.json`, agent);
          // T2 EXTENSION: bind session→engineerId on first contact (without claim).
          if (sessionId) {
            this.sessionToEngineerId.set(sessionId, engineerId);
          }
          console.log(`[GcsEngineerRegistry] Agent identity asserted (created): ${engineerId}`);
          return {
            ok: true,
            engineerId,
            wasCreated: true,
            clientMetadata: agent.clientMetadata,
            advisoryTags: agent.advisoryTags,
            labels: agent.labels,
          };
        } catch (err) {
          if (err instanceof GcsOccPreconditionFailed) continue;
          throw err;
        }
      }

      const { data: agent, generation } = existing;

      // Role mismatch = hard security boundary.
      if (agent.role !== payload.role) {
        return {
          ok: false,
          code: "role_mismatch",
          message: `Token role '${payload.role}' does not match persisted agent role '${agent.role}' for engineerId=${agent.engineerId}`,
        };
      }

      // CP3 C5 (bug-16): labels refresh path — provided overwrites stored;
      // omitted preserves stored. INVARIANT (T1): same code path, no redefine.
      // Defensive migration: older Agents may lack the labels field entirely.
      const priorLabels = agent.labels ?? {};
      const nextLabels = payload.labels ?? priorLabels;
      const labelsChanged = !shallowEqualLabels(priorLabels, nextLabels);
      const updated: Agent = {
        ...agent,
        clientMetadata: payload.clientMetadata,
        advisoryTags: payload.advisoryTags ?? agent.advisoryTags ?? {},
        labels: nextLabels,
        lastSeenAt: now,
        // ADR-017 mutable config refresh on identity assertion.
        receiptSla: payload.receiptSla ?? agent.receiptSla ?? DEFAULT_AGENT_RECEIPT_SLA_MS,
        wakeEndpoint: payload.wakeEndpoint ?? agent.wakeEndpoint ?? null,
        // INVARIANT (T1): do NOT touch sessionEpoch, currentSessionId,
        // status, livenessState, lastHeartbeatAt. Identity assertion is
        // identity-only; session state belongs to claimSession.
      };

      try {
        await writeJsonWithPrecondition(this.bucket, fpPath, updated, generation);
        await writeJson(this.bucket, `agents/${updated.engineerId}.json`, updated);
        // T2 EXTENSION: bind session→engineerId on identity refresh too.
        if (sessionId) {
          this.sessionToEngineerId.set(sessionId, updated.engineerId);
        }
        const changedFields: ("labels" | "advisoryTags" | "clientMetadata")[] = [];
        if (labelsChanged) changedFields.push("labels");
        return {
          ok: true,
          engineerId: updated.engineerId,
          wasCreated: false,
          clientMetadata: updated.clientMetadata,
          advisoryTags: updated.advisoryTags,
          labels: updated.labels,
          ...(changedFields.length > 0 ? { changedFields } : {}),
          ...(labelsChanged ? { priorLabels } : {}),
        };
      } catch (err) {
        if (err instanceof GcsOccPreconditionFailed) continue;
        throw err;
      }
    }

    // Both attempts lost the OCC race — caller should retry.
    return {
      ok: false,
      code: "role_mismatch",
      message: `OCC contention exceeded retry budget on assertIdentity for fingerprint=${fingerprint}; likely concurrent registration storm.`,
    };
  }

  async claimSession(
    engineerId: string,
    sessionId: string,
    trigger: ClaimSessionTrigger,
  ): Promise<ClaimSessionResult> {
    // Two attempts to handle OCC contention with concurrent claims.
    for (let attempt = 0; attempt < 2; attempt++) {
      const path = `agents/${engineerId}.json`;
      const existing = await readJsonWithGeneration<Agent>(this.bucket, path);
      if (!existing) {
        return {
          ok: false,
          code: "unknown_engineer",
          message: `claimSession: engineerId=${engineerId} not found — call assertIdentity first`,
        };
      }
      const { data: agent, generation } = existing;
      // Thrashing rate-limit (only when displacing a live session).
      if (agent.status === "online") {
        const history = this.displacementHistory.get(agent.fingerprint) ?? [];
        const tripped = recordDisplacementAndCheck(history, Date.now());
        this.displacementHistory.set(agent.fingerprint, history);
        if (tripped) {
          return {
            ok: false,
            code: "agent_thrashing_detected",
            message: `Agent ${agent.engineerId} exceeded ${THRASHING_THRESHOLD} displacements in ${THRASHING_WINDOW_MS / 1000}s — halting to prevent fork-bomb. Check ~/.ois/instance.json for duplicate processes.`,
          };
        }
      }
      const now = new Date().toISOString();
      const displaced =
        agent.currentSessionId && agent.currentSessionId !== sessionId
          ? { sessionId: agent.currentSessionId, epoch: agent.sessionEpoch }
          : undefined;
      const updated: Agent = {
        ...agent,
        sessionEpoch: agent.sessionEpoch + 1,
        currentSessionId: sessionId,
        status: "online",
        lastSeenAt: now,
        // ADR-017 liveness reset on claim.
        livenessState: "online",
        lastHeartbeatAt: now,
      };
      try {
        // Claim writes the per-engineerId file; the by-fingerprint file
        // mirror is identity state (stable across claims) and is updated
        // by assertIdentity. We update both for atomicity at the read
        // boundary (selectAgents may read either path depending on call site).
        await writeJsonWithPrecondition(this.bucket, path, updated, generation);
        // Best-effort mirror update on by-fingerprint; OCC failure here
        // is non-fatal because the per-engineerId file is the source of
        // truth for session state.
        try {
          const fpPath = `agents/by-fingerprint/${agent.fingerprint}.json`;
          const fpExisting = await readJsonWithGeneration<Agent>(this.bucket, fpPath);
          if (fpExisting) {
            await writeJsonWithPrecondition(this.bucket, fpPath, updated, fpExisting.generation);
          }
        } catch (err) {
          if (!(err instanceof GcsOccPreconditionFailed)) throw err;
          // Fingerprint mirror lost a race; per-engineerId file already
          // has the new state; selectAgents will read the canonical path.
        }
        this.sessionToEngineerId.set(sessionId, updated.engineerId);
        this.lastTouchAt.set(updated.engineerId, Date.now());
        if (displaced) {
          console.log(
            `[GcsEngineerRegistry] Agent displaced: ${updated.engineerId} epoch=${updated.sessionEpoch} (trigger=${trigger}, prior sessionId=${displaced.sessionId} epoch=${displaced.epoch})`,
          );
        } else {
          console.log(
            `[GcsEngineerRegistry] Agent session claimed: ${updated.engineerId} epoch=${updated.sessionEpoch} (trigger=${trigger})`,
          );
        }
        return {
          ok: true,
          engineerId: updated.engineerId,
          sessionEpoch: updated.sessionEpoch,
          trigger,
          ...(displaced ? { displacedPriorSession: displaced } : {}),
        };
      } catch (err) {
        if (err instanceof GcsOccPreconditionFailed) continue;
        throw err;
      }
    }

    return {
      ok: false,
      code: "agent_thrashing_detected",
      message: `OCC contention exceeded retry budget on claimSession for engineerId=${engineerId}; likely concurrent claim storm.`,
    };
  }

  async getAgent(engineerId: string): Promise<Agent | null> {
    const a = await readJson<Agent>(this.bucket, `agents/${engineerId}.json`);
    return a ? normalizeAgentShape(a) : null;
  }

  async getAgentForSession(sessionId: string): Promise<Agent | null> {
    const engineerId = this.sessionToEngineerId.get(sessionId);
    if (!engineerId) return null;
    const a = await readJson<Agent>(this.bucket, `agents/${engineerId}.json`);
    return a ? normalizeAgentShape(a) : null;
  }

  async listAgents(): Promise<Agent[]> {
    const files = await listFiles(this.bucket, "agents/");
    const agents: Agent[] = [];
    for (const file of files) {
      // Only read the top-level per-engineerId file, not the by-fingerprint mirror.
      if (file.startsWith("agents/by-fingerprint/")) continue;
      const a = await readJson<Agent>(this.bucket, file);
      if (a) agents.push(normalizeAgentShape(a));
    }
    return agents;
  }

  async selectAgents(selector: Selector): Promise<Agent[]> {
    const engineerIdSet = selector.engineerIds && selector.engineerIds.length > 0
      ? new Set(selector.engineerIds)
      : null;
    // Fast path for engineerId pinpoint — skip full bucket scan.
    if (selector.engineerId) {
      const a = await this.getAgent(selector.engineerId);
      if (!a) return [];
      if (a.archived) return [];
      if (a.status !== "online") return [];
      if (engineerIdSet && !engineerIdSet.has(a.engineerId)) return [];
      if (selector.roles && !selector.roles.includes(a.role)) return [];
      if (!labelsMatch(a.labels ?? {}, selector.matchLabels)) return [];
      return [a];
    }
    // Fast path for engineerIds pinpoint — fetch each directly rather
    // than scanning every agent key in the bucket.
    if (engineerIdSet) {
      const out: Agent[] = [];
      for (const id of engineerIdSet) {
        const a = await this.getAgent(id);
        if (!a) continue;
        if (a.archived) continue;
        if (a.status !== "online") continue;
        if (selector.roles && !selector.roles.includes(a.role)) continue;
        if (!labelsMatch(a.labels ?? {}, selector.matchLabels)) continue;
        out.push(a);
      }
      return out;
    }
    const all = await this.listAgents();
    return all.filter((a) => {
      if (a.archived) return false;
      if (a.status !== "online") return false;
      if (selector.roles && !selector.roles.includes(a.role)) return false;
      if (!labelsMatch(a.labels ?? {}, selector.matchLabels)) return false;
      return true;
    });
  }

  /**
   * Heartbeat: bump lastSeenAt on the Agent bound to this session.
   * Rate-limited to AGENT_TOUCH_MIN_INTERVAL_MS per agent to avoid GCS thrash.
   * OCC-protected read-modify-write on agents/<eid>.json; on precondition failure
   * the competing write already carried a fresher lastSeenAt, so we silently skip.
   */
  async touchAgent(sessionId: string): Promise<void> {
    const engineerId = this.sessionToEngineerId.get(sessionId);
    if (!engineerId) return;
    const now = Date.now();
    const last = this.lastTouchAt.get(engineerId) ?? 0;
    if (now - last < AGENT_TOUCH_MIN_INTERVAL_MS) return;
    // Reserve the slot up front so concurrent touches collapse to one write.
    this.lastTouchAt.set(engineerId, now);

    const existing = await readJsonWithGeneration<Agent>(this.bucket, `agents/${engineerId}.json`);
    if (!existing) return;
    const { data: agent, generation } = existing;
    if (agent.currentSessionId !== sessionId) return; // session no longer owns this agent
    const updated: Agent = {
      ...agent,
      lastSeenAt: new Date(now).toISOString(),
      status: "online",
    };
    try {
      await writeJsonWithPrecondition(this.bucket, `agents/${engineerId}.json`, updated, generation);
      // Mirror: fingerprint-indexed copy (best-effort, no generation tracked here).
      await writeJson(this.bucket, `agents/by-fingerprint/${agent.fingerprint}.json`, updated);
    } catch (err) {
      if (err instanceof GcsOccPreconditionFailed) return; // racing writer won; nothing to do
      throw err;
    }
  }

  /** ADR-017: refresh heartbeat on drain. Not rate-limited — drains
   *  are infrequent, so a write every time is acceptable. Resets
   *  livenessState to online on the authoritative proof-of-life. */
  async refreshHeartbeat(engineerId: string): Promise<void> {
    const existing = await readJsonWithGeneration<Agent>(this.bucket, `agents/${engineerId}.json`);
    if (!existing) return;
    const { data: agent, generation } = existing;
    const updated: Agent = {
      ...normalizeAgentShape(agent),
      lastHeartbeatAt: new Date().toISOString(),
      livenessState: "online",
    };
    try {
      await writeJsonWithPrecondition(this.bucket, `agents/${engineerId}.json`, updated, generation);
      await writeJson(this.bucket, `agents/by-fingerprint/${agent.fingerprint}.json`, updated);
    } catch (err) {
      if (err instanceof GcsOccPreconditionFailed) return;
      throw err;
    }
  }

  async setLivenessState(engineerId: string, state: AgentLivenessState): Promise<void> {
    const existing = await readJsonWithGeneration<Agent>(this.bucket, `agents/${engineerId}.json`);
    if (!existing) return;
    const { data: agent, generation } = existing;
    const updated: Agent = { ...normalizeAgentShape(agent), livenessState: state };
    try {
      await writeJsonWithPrecondition(this.bucket, `agents/${engineerId}.json`, updated, generation);
      await writeJson(this.bucket, `agents/by-fingerprint/${agent.fingerprint}.json`, updated);
    } catch (err) {
      if (err instanceof GcsOccPreconditionFailed) return;
      throw err;
    }
  }

  /**
   * Mark the Agent bound to this session offline. Called on session teardown.
   * Only writes if the Agent's currentSessionId still matches — otherwise a
   * newer session has already taken over (displacement) and we must not clobber it.
   */
  async markAgentOffline(sessionId: string): Promise<void> {
    const engineerId = this.sessionToEngineerId.get(sessionId);
    this.sessionToEngineerId.delete(sessionId);
    if (!engineerId) return;

    const existing = await readJsonWithGeneration<Agent>(this.bucket, `agents/${engineerId}.json`);
    if (!existing) return;
    const { data: agent, generation } = existing;
    if (agent.currentSessionId !== sessionId) return; // a newer session owns the agent
    const updated: Agent = {
      ...normalizeAgentShape(agent),
      status: "offline",
      livenessState: "offline",
      lastSeenAt: new Date().toISOString(),
    };
    try {
      await writeJsonWithPrecondition(this.bucket, `agents/${engineerId}.json`, updated, generation);
      await writeJson(this.bucket, `agents/by-fingerprint/${agent.fingerprint}.json`, updated);
      console.log(`[GcsEngineerRegistry] Agent marked offline: ${engineerId}`);
    } catch (err) {
      if (err instanceof GcsOccPreconditionFailed) return; // displaced mid-cleanup
      throw err;
    }
  }

  /**
   * Move pending notifications from sourceEngineerId's queue into targetEngineerId's queue.
   * Used for "my laptop died, I have a new globalInstanceId" recovery. Does NOT delete the
   * source Agent — Agents are append-only (see thread-79).
   *
   * Note: The actual pending-notification queue layout depends on NotificationStore; this
   * implementation is a best-effort scan of notifications/ that targets the source engineer.
   * Integration coverage is deferred to OpenCode (see Handoff Notes).
   */
  async migrateAgentQueue(sourceEngineerId: string, targetEngineerId: string): Promise<{ moved: number }> {
    // Placeholder: hub-networking owns the engineerId-keyed queue. This method exposes the
    // migration *entry point* that the admin tool binds to, and logs. A future revision
    // rewires HubNetworking's ActionablePendingQueue to accept reassignment.
    console.log(`[GcsEngineerRegistry] migrate_agent_queue: ${sourceEngineerId} -> ${targetEngineerId} (stub; queue rewire pending)`);
    return { moved: 0 };
  }

  async listOfflineAgentsOlderThan(staleThresholdMs: number): Promise<Agent[]> {
    const agents = await this.listAgents();
    const nowMs = Date.now();
    const stale: Agent[] = [];
    for (const a of agents) {
      const isOffline = a.status === "offline" || a.livenessState === "offline";
      if (!isOffline) continue;
      const lastSeenMs = Date.parse(a.lastSeenAt);
      if (!Number.isFinite(lastSeenMs)) continue;
      if (nowMs - lastSeenMs <= staleThresholdMs) continue;
      stale.push(a);
    }
    return stale;
  }

  async deleteAgent(engineerId: string): Promise<boolean> {
    const agent = await readJson<Agent>(this.bucket, `agents/${engineerId}.json`);
    if (!agent) return false;
    // Delete the per-engineerId file first, then the by-fingerprint alias.
    // Order matters for crash-safety: the alias is the path readers race to
    // resolve an engineerId from a fingerprint; losing the main file first
    // means a concurrent registerAgent retry will create fresh state cleanly.
    await deleteFile(this.bucket, `agents/${engineerId}.json`);
    await deleteFile(this.bucket, `agents/by-fingerprint/${agent.fingerprint}.json`);
    this.displacementHistory.delete(agent.fingerprint);
    this.lastTouchAt.delete(engineerId);
    for (const [sid, eid] of this.sessionToEngineerId.entries()) {
      if (eid === engineerId) this.sessionToEngineerId.delete(sid);
    }
    console.log(`[GcsEngineerRegistry] Agent deleted: ${engineerId} (via reaper)`);
    return true;
  }

}

// Mission-47 W5: GcsProposalStore removed — ProposalRepository in
// hub/src/entities/proposal-repository.ts composes StorageProvider
// (including GcsStorageProvider) via the IProposalStore interface.


// Mission-47 W6: GcsThreadStore removed — ThreadRepository in
// hub/src/entities/thread-repository.ts composes StorageProvider
// (including GcsStorageProvider) via the IThreadStore interface.
// normalizeThreadShape/normalizeRoutingMode/isThreadContext/
// normalizeStagedActionShape helpers moved into the repository
// (they were GcsThreadStore-internal read-side normalisation).

/** ADR-017 defensive normalization — legacy Agent blobs lacking the
 *  liveness-layer fields get sane defaults on read. Writes always
 *  populate these fields; the helper protects against persisted data
 *  predating the ADR-017 schema addition. */
function normalizeAgentShape(a: any): Agent {
  if (!a) return a;
  const now = a.lastSeenAt ?? a.firstSeenAt ?? new Date(0).toISOString();
  return {
    ...a,
    labels: a.labels ?? {},
    livenessState: (a.livenessState as Agent["livenessState"]) ?? (a.status === "online" ? "online" : "offline"),
    lastHeartbeatAt: a.lastHeartbeatAt ?? now,
    receiptSla: typeof a.receiptSla === "number" ? a.receiptSla : DEFAULT_AGENT_RECEIPT_SLA_MS,
    wakeEndpoint: typeof a.wakeEndpoint === "string" ? a.wakeEndpoint : null,
  } as Agent;
}

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
