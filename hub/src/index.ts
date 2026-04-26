/**
 * MCP Relay Hub — Entrypoint
 *
 * A lightweight MCP Server (Streamable HTTP transport) that routes
 * Directives and Reports between an Architect agent and an Engineer CLI.
 *
 * Deployed to Cloud Run as a containerized Express application.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cutoverSentinelPath, isCutoverComplete } from "./lib/cutover-sentinel.js";
import type { ITaskStore, IEngineerRegistry, IProposalStore, IThreadStore, IAuditStore } from "./state.js";
import { reconcileCounters, cleanupOrphanedFiles } from "./gcs-state.js";
import {
  TurnRepository,
  PendingActionRepository,
  TeleRepository, IdeaRepository, BugRepository,
  MissionRepository, TaskRepository, ProposalRepository, ThreadRepository,
  AgentRepository,
  AuditRepository,
  MessageRepository,
  StorageBackedCounter,
  type IIdeaStore, type IMissionStore, type ITurnStore, type ITeleStore, type IBugStore,
  type IPendingActionStore, type IMessageStore,
} from "./entities/index.js";
import { MemoryStorageProvider, GcsStorageProvider, LocalFsStorageProvider, type StorageProvider } from "@ois/storage-provider";
// Legacy registerAllTools REMOVED — all 43 tools now served by PolicyRouter
import { PolicyRouter, registerTaskPolicy } from "./policy/index.js";
import { registerSystemPolicy } from "./policy/system-policy.js";
import { registerTelePolicy } from "./policy/tele-policy.js";
import { registerAuditPolicy } from "./policy/audit-policy.js";
import { registerDocumentPolicy } from "./policy/document-policy.js";
import { registerSessionPolicy } from "./policy/session-policy.js";
import { registerIdeaPolicy } from "./policy/idea-policy.js";
import { registerMissionPolicy } from "./policy/mission-policy.js";
import { registerTurnPolicy } from "./policy/turn-policy.js";
import { registerClarificationPolicy } from "./policy/clarification-policy.js";
import { registerReviewPolicy } from "./policy/review-policy.js";
import { registerProposalPolicy } from "./policy/proposal-policy.js";
import { registerThreadPolicy } from "./policy/thread-policy.js";
import { registerMessagePolicy } from "./policy/message-policy.js";
import { registerBugPolicy } from "./policy/bug-policy.js";
import { registerPendingActionPolicy } from "./policy/pending-action-policy.js";
import { Watchdog } from "./policy/watchdog.js";
import { MessageProjectionSweeper } from "./policy/message-projection-sweeper.js";
import { ScheduledMessageSweeper } from "./policy/scheduled-message-sweeper.js";
import { CascadeReplaySweeper } from "./policy/cascade-replay-sweeper.js";
import { PulseSweeper } from "./policy/pulse-sweeper.js";
import {
  RepoEventBridge,
  createPolicyRouterInvoker,
  parseReposEnvVar,
} from "./policy/repo-event-handler.js";
import { bindRouterToMcp } from "./policy/mcp-binding.js";
import type { AllStores } from "./policy/index.js";
import { createMetricsCounter } from "./observability/metrics.js";

// ── Global State ──────────────────────────────────────────────────────
const STORAGE_BACKEND = process.env.STORAGE_BACKEND || "memory";
// Mission-46 T1: GCS_BUCKET hardcoded default stripped. Memory backend
// (used by tests + PolicyLoopbackHub) ignores this; gcs backend
// fail-fasts at top-level + inside the init block below if unset —
// surfaces config drift before silent wrong-bucket writes.
const GCS_BUCKET = process.env.GCS_BUCKET;
if (STORAGE_BACKEND === "gcs" && !GCS_BUCKET) {
  throw new Error(
    "[hub] GCS_BUCKET env var is required when STORAGE_BACKEND=gcs. " +
    "Set via deploy/cloudrun/env/<env>.tfvars or local env override.",
  );
}
// Mission-47 T3: local-fs backend writes to OIS_LOCAL_FS_ROOT (a directory
// path). Intended for dev — run hub against a gsutil-rsynced snapshot of
// prod state without touching GCS. Fail-fast if unset to avoid
// accidentally writing to CWD.
const OIS_LOCAL_FS_ROOT = process.env.OIS_LOCAL_FS_ROOT;
if (STORAGE_BACKEND === "local-fs" && !OIS_LOCAL_FS_ROOT) {
  throw new Error(
    "[hub] OIS_LOCAL_FS_ROOT env var is required when STORAGE_BACKEND=local-fs. " +
    "Point it at a directory (e.g., ./local-state/). Populate with scripts/state-sync.sh.",
  );
}

let taskStore: ITaskStore;
let engineerRegistry: IEngineerRegistry;
let proposalStore: IProposalStore;
let threadStore: IThreadStore;
let auditStore: IAuditStore;
let ideaStore: IIdeaStore;
let missionStore: IMissionStore;
let turnStore: ITurnStore;
let teleStore: ITeleStore;
let bugStore: IBugStore;
// ADR-017: comms reliability layer. GCS-backed in Phase 2x P0-1 (was
// memory-only in v1 — Hub restarts wiped the queue, observed twice
// during Phase 2b-B measurement). Queue state now survives restart
// identically to other entities.
let pendingActionStore: IPendingActionStore;
// Mission-51 W1: universal Message primitive store.
let messageStore: IMessageStore;

// Mission-47 W1: tele store is now `TeleRepository` composed over a
// `StorageProvider`. Provider is selected per STORAGE_BACKEND and
// shared with the counter helper. Future waves will migrate the
// other entities to the same pattern; during mission-47 in-flight
// period, legacy `*Store` classes continue to coexist with
// TeleRepository (both read/write the same GCS keyspace safely via
// CAS on shared meta/counter.json).
let storageProvider: StorageProvider;

if (STORAGE_BACKEND === "gcs") {
  // Top-level guard above ensures GCS_BUCKET is defined here.
  const bucket = GCS_BUCKET!;
  console.log(`[Hub] Using GCS storage backend: gs://${bucket}`);
  storageProvider = new GcsStorageProvider(bucket);
} else if (STORAGE_BACKEND === "local-fs") {
  // Mission-48 T1 (ADR-024 amendment 2026-04-25): local-fs is now
  // single-writer-laptop-prod-eligible. The single-writer assumption
  // (capabilities.concurrent=false) is enforced operationally by the
  // one-hub-at-a-time check in `scripts/local/start-hub.sh:148-161`.
  // Previously this branch fatal-exited under NODE_ENV=production; the
  // gate is now warn-and-allow so the laptop-Hub deploy pattern works
  // out of the box.
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[Hub] STORAGE_BACKEND='local-fs' under NODE_ENV='production' — laptop-Hub single-writer-prod profile. " +
      "Single-writer enforcement: scripts/local/start-hub.sh enforces one ois-hub-local-* container at a time. " +
      "DO NOT run multiple hubs against the same OIS_LOCAL_FS_ROOT — the local-fs provider is concurrent:false."
    );
  }
  const root = OIS_LOCAL_FS_ROOT!;

  // Mission-48 T1: writability assertion. Catches the bind-mount uid/gid
  // trap loudly rather than letting it surface as a generic putIfMatch
  // permission error mid-mission. Defense-in-depth alongside the shell-
  // layer pre-flight in scripts/local/start-hub.sh.
  try {
    fs.mkdirSync(root, { recursive: true });
    const probe = path.join(root, `.hub-writability-${process.pid}`);
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      console.error(
        `[Hub] FATAL: STORAGE_BACKEND='local-fs' but ${root} is not writable by container user uid=${process.getuid?.() ?? "?"}. ` +
        `Most likely cause: bind-mount uid/gid mismatch between host and container. ` +
        `Fix: 'docker run -u $(id -u):$(id -g) ...' (scripts/local/start-hub.sh handles this).`
      );
      process.exit(1);
    }
    throw err;
  }

  // Mission-48 T2b: bootstrap-required guard. The .cutover-complete
  // sentinel is written by scripts/state-sync.sh ONLY after the GCS→
  // local-fs post-copy set-equality invariant passes. Refuse to start
  // on a half-bootstrapped (or never-bootstrapped) state directory —
  // fail-fast keeps an unprepared cutover from silently running with
  // no entity state.
  if (!isCutoverComplete(root)) {
    console.error(
      `[Hub] FATAL: STORAGE_BACKEND='local-fs' but cutover sentinel missing at ${cutoverSentinelPath(root)}. ` +
      `The local-fs state directory has not been bootstrapped from GCS — Hub refuses to ` +
      `start without a validated cutover.\n` +
      `Fix: run scripts/state-sync.sh first (it writes the sentinel after the post-copy ` +
      `invariant passes). For an explicit fresh-start with no GCS data, run state-sync.sh ` +
      `against an empty bucket — the invariant trivially passes and the sentinel is written.`
    );
    process.exit(1);
  }

  console.log(`[Hub] Using local-fs storage backend at: ${root}`);
  storageProvider = new LocalFsStorageProvider(root);
} else {
  if (process.env.NODE_ENV === "production") {
    console.error("[Hub] FATAL: STORAGE_BACKEND is 'memory' in production. Set STORAGE_BACKEND=gcs to prevent silent state loss.");
    process.exit(1);
  }
  console.log("[Hub] Using in-memory storage backend");
  storageProvider = new MemoryStorageProvider();
}

// Mission-47 W1-W7 + Mission-49 W8-W9: instantiate StorageProvider-backed
// repositories. Counter is shared-by-design across all repositories —
// issues a monotonic ID sequence per entity-type field via a single
// meta/counter.json blob.
const storageCounter = new StorageBackedCounter(storageProvider);
auditStore = new AuditRepository(storageProvider, storageCounter);
taskStore = new TaskRepository(storageProvider, storageCounter);
proposalStore = new ProposalRepository(storageProvider, storageCounter);
ideaStore = new IdeaRepository(storageProvider, storageCounter);
bugStore = new BugRepository(storageProvider, storageCounter);
teleStore = new TeleRepository(storageProvider, storageCounter);
threadStore = new ThreadRepository(storageProvider, storageCounter);
pendingActionStore = new PendingActionRepository(storageProvider, storageCounter);
// Mission-51 W1: MessageRepository — sovereign Message primitive over StorageProvider.
messageStore = new MessageRepository(storageProvider);
// AgentRepository does not use counter — engineerIds are fingerprint-derived.
engineerRegistry = new AgentRepository(storageProvider);
// MissionRepository takes taskStore + ideaStore for virtual-view hydration.
missionStore = new MissionRepository(storageProvider, storageCounter, taskStore, ideaStore);
// TurnRepository takes missionStore + taskStore for virtual-view hydration.
turnStore = new TurnRepository(storageProvider, storageCounter, missionStore, taskStore);

// ── Aggregate Store Object ────────────────────────────────────────────
const allStores: AllStores = {
  task: taskStore,
  engineerRegistry,
  proposal: proposalStore,
  thread: threadStore,
  audit: auditStore,
  idea: ideaStore,
  mission: missionStore,
  turn: turnStore,
  tele: teleStore,
  bug: bugStore,
  pendingAction: pendingActionStore,
  message: messageStore,
};

// ── PolicyRouter Singleton ───────────────────────────────────────────
// The router is stateless — it holds only handler registrations.
// All mutable state lives in the stores (injected via IPolicyContext).
const policyRouter = new PolicyRouter();
registerTaskPolicy(policyRouter);
registerSystemPolicy(policyRouter);
registerTelePolicy(policyRouter);
registerAuditPolicy(policyRouter);
registerDocumentPolicy(policyRouter);
registerSessionPolicy(policyRouter);
registerIdeaPolicy(policyRouter);
registerMissionPolicy(policyRouter);
registerTurnPolicy(policyRouter);
registerClarificationPolicy(policyRouter);
registerReviewPolicy(policyRouter);
registerProposalPolicy(policyRouter);
registerThreadPolicy(policyRouter);
registerBugPolicy(policyRouter);
registerPendingActionPolicy(policyRouter);
// Mission-51 W6: list_messages + create_message MCP verbs.
registerMessagePolicy(policyRouter);
console.log(`[Hub] PolicyRouter initialized with ${policyRouter.size} tool(s): ${policyRouter.getRegisteredTools().join(", ")}`);

// ADR-017: start the comms-reliability watchdog. Stateless scanner over
// the pending-actions queue; enforces deadlines + escalation ladder. The
// injectable wake-client uses fetch (best-effort); failures are logged but
// never block watchdog progress — the queue is the truth.
//
// WATCHDOG_ENABLED feature flag (default true). Set to "false" during
// migration windows (e.g., rolling out adapter drain-on-wake) to pause the
// escalation ladder. Queue still enqueues + completion-acks still work;
// only re-dispatch + demotion + Director-notification are suspended.
const WATCHDOG_ENABLED = (process.env.WATCHDOG_ENABLED ?? "true").toLowerCase() !== "false";
const watchdog = new Watchdog({
  stores: allStores,
  log: (msg) => console.log(msg),
  wakeClient: async (wakeEndpoint, item) => {
    try {
      await fetch(wakeEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queueItemId: item.id, dispatchType: item.dispatchType, entityRef: item.entityRef }),
      });
    } catch (err: any) {
      console.log(`[Hub] Watchdog wake-POST failed for ${wakeEndpoint}: ${err?.message ?? err}`);
    }
  },
});
if (WATCHDOG_ENABLED) {
  watchdog.start();
  console.log("[Hub] ADR-017 comms-reliability watchdog started");
} else {
  console.log("[Hub] ADR-017 watchdog PAUSED (WATCHDOG_ENABLED=false) — queue still operational, escalation ladder suspended");
}

// ── MCP Server Factory ───────────────────────────────────────────────
// Each session gets its own McpServer instance connected to its transport.
// The PolicyRouter is shared; the ctxFactory provides per-connection context.

function createMcpServer(
  getSessionId: () => string,
  getClientIp: () => string,
  notifyEvent: (event: string, data: Record<string, unknown>, targetRoles?: string[]) => Promise<void>,
  dispatchEvent: (event: string, data: Record<string, unknown>, selector: import("./state.js").Selector) => Promise<void>,
): McpServer {
  const server = new McpServer(
    {
      name: "mcp-relay-hub",
      version: "1.0.0",
    },
    {
      capabilities: {
        logging: {},
      },
    }
  );

  // Layer 7: PolicyRouter-bound tools (Task + System domains)
  // Shared per-process metrics counter — all ctx instances share it so
  // counter state accumulates across requests (see Phase 2d CP1).
  const metrics = createMetricsCounter();
  const ctxFactory = () => ({
    stores: allStores,
    emit: notifyEvent,
    dispatch: dispatchEvent,
    sessionId: getSessionId(),
    clientIp: getClientIp(),
    role: "unknown", // resolved at handler level via engineerRegistry
    internalEvents: [],
    config: { storageBackend: STORAGE_BACKEND, gcsBucket: GCS_BUCKET ?? "" },
    metrics,
  });

  bindRouterToMcp(server, policyRouter, ctxFactory);

  // All 43 tools now served exclusively via PolicyRouter (Layer 7).
  // The Great Decoupling is complete.

  return server;
}

// ── Hub Networking (production instance) ─────────────────────────────
// All networking logic (session management, SSE, keepalive, reaper,
// notification broadcast) is handled by the extracted HubNetworking class.
// This ensures production and tests run the exact same networking code.

import { HubNetworking } from "./hub-networking.js";
import type { CreateMcpServerFn } from "./hub-networking.js";

const HUB_API_TOKEN = process.env.HUB_API_TOKEN || "";
const ARCHITECT_WEBHOOK_URL = process.env.ARCHITECT_WEBHOOK_URL || "";
const PORT = parseInt(process.env.PORT || "8080", 10);

// The createMcpServer factory adapts the production tool registration
// to the HubNetworking's CreateMcpServerFn interface.
const createMcpServerFactory: CreateMcpServerFn = (getSessionId, getClientIp, notifyEvent, dispatchEvent) => {
  return createMcpServer(getSessionId, getClientIp, notifyEvent, dispatchEvent);
};

const hub = new HubNetworking(
  engineerRegistry,
  createMcpServerFactory,
  {
    port: PORT,
    apiToken: HUB_API_TOKEN,
    webhookUrl: ARCHITECT_WEBHOOK_URL,
    keepaliveInterval: 30_000,
    sessionTtl: 180_000,
    reaperInterval: 60_000,
    orphanTtl: 60_000,
    autoStartTimers: true,
    quiet: false,
  },
  // M-Session-Claim-Separation (mission-40) T2: thread audit store through
  // for SSE-subscribe auto-claim hook to emit agent_session_implicit_claim
  // + agent_session_displaced audits.
  auditStore,
  // Mission-56 W1b: Message store for SSE Last-Event-ID + cold-start
  // replay paths. Hub-internal cursor query (replayFromCursor) emits
  // backfill via sendLoggingMessage before transport.handleRequest
  // takes over for live emit. Coexists with state-based-reconnect.
  messageStore,
);

// ── Start Server ─────────────────────────────────────────────────────

async function startupSequence(): Promise<void> {
  if (STORAGE_BACKEND === "gcs") {
    // Top-level guard ensures GCS_BUCKET defined here.
    console.log("[Hub] Running GCS startup maintenance...");
    await cleanupOrphanedFiles(GCS_BUCKET!);
    await reconcileCounters(GCS_BUCKET!);
    console.log("[Hub] GCS startup maintenance complete");
  }
}

// ── Thread Reaper (M24-T7, INV-TH21) ─────────────────────────────────
// Periodic task: scans active threads whose idle time exceeds
// `thread.idleExpiryMs` (or the deployment default), transitions them
// to `abandoned`, retracts any staged actions, audits with action
// `thread_reaper_abandoned`, and dispatches `thread_abandoned`
// participant-scoped to any remaining participants with resolved
// agentIds. Hourly cadence by default; configurable via env for tests
// and for deployments that want tighter/looser sweeping.

const THREAD_IDLE_EXPIRY_MS = parseInt(
  process.env.HUB_THREAD_IDLE_EXPIRY_MS || String(7 * 24 * 60 * 60 * 1000),
  10,
);
const THREAD_REAPER_INTERVAL_MS = parseInt(
  process.env.HUB_THREAD_REAPER_INTERVAL_MS || String(60 * 60 * 1000),
  10,
);

let threadReaperHandle: NodeJS.Timeout | null = null;

async function runThreadReaperTick(): Promise<void> {
  try {
    const reaped = await threadStore.reapIdleThreads(THREAD_IDLE_EXPIRY_MS);
    if (reaped.length === 0) return;
    console.log(`[Reaper] thread reaper: ${reaped.length} idle thread(s) transitioned to abandoned`);
    for (const t of reaped) {
      await auditStore.logEntry(
        "hub",
        "thread_reaper_abandoned",
        `Thread ${t.threadId} reaped after ${Math.round(t.idleMs / 1000)}s idle (threshold ${Math.round(THREAD_IDLE_EXPIRY_MS / 1000)}s). Title: ${t.title}.`,
        t.threadId,
      );
      if (t.participantAgentIds.length > 0) {
        await hub.dispatchEvent("thread_abandoned", {
          threadId: t.threadId,
          title: t.title,
          leaverAgentId: null,
          reason: "idle_expiry",
          idleMs: t.idleMs,
          retractedActionCount: 0, // counted in-store; keep payload tight
        }, {
          engineerIds: t.participantAgentIds,
          matchLabels: t.labels,
        });
      }

      // Phase 2d CP3 C1 — bidirectional integrity: abandon any
      // non-terminal queue items bound to this reaped thread so they
      // don't sit forever in receipt_acked waiting for a reply that
      // will never come. Per thread-224 consensus: the queue is truth,
      // but when the referenced thread goes away, the queue items
      // referencing it must also terminate (state: errored, reason
      // names the reap).
      try {
        const tied = await pendingActionStore.listNonTerminalByEntityRef(t.threadId);
        for (const item of tied) {
          const abandoned = await pendingActionStore.abandon(
            item.id,
            `thread_reaper_abandoned: thread ${t.threadId} reaped after ${Math.round(t.idleMs / 1000)}s idle`,
          );
          if (abandoned && abandoned.state === "errored") {
            await auditStore.logEntry(
              "hub",
              "queue_item_abandoned_via_thread_reaper",
              `Queue item ${item.id} abandoned because its parent thread ${t.threadId} was reaped (dispatchType=${item.dispatchType}, targetAgentId=${item.targetAgentId}).`,
              item.id,
            );
          }
        }
        if (tied.length > 0) {
          console.log(`[Reaper] thread ${t.threadId}: ${tied.length} tied queue item(s) abandoned via bidirectional wiring`);
        }
      } catch (queueErr) {
        console.error(`[Reaper] failed to abandon queue items for reaped thread ${t.threadId}:`, queueErr);
      }
    }
  } catch (err) {
    console.error("[Reaper] thread reaper tick failed:", err);
  }
}

function startThreadReaper(): void {
  if (threadReaperHandle) return;
  console.log(`[Hub] Starting thread reaper: interval=${THREAD_REAPER_INTERVAL_MS}ms, default-idle-expiry=${THREAD_IDLE_EXPIRY_MS}ms`);
  threadReaperHandle = setInterval(() => {
    void runThreadReaperTick();
  }, THREAD_REAPER_INTERVAL_MS);
  // Allow process exit even if interval is pending.
  threadReaperHandle.unref?.();
}

function stopThreadReaper(): void {
  if (threadReaperHandle) {
    clearInterval(threadReaperHandle);
    threadReaperHandle = null;
  }
}

// ── Agent Reaper (CP3 C4, bug-16 part 1) ─────────────────────────────
// Periodic background task symmetric to the thread reaper: scans
// offline Agent records and permanently deletes those whose lastSeenAt
// is older than HUB_AGENT_STALE_THRESHOLD_MS. Before each delete, any
// thread whose currentTurnAgentId pins to the victim is unpinned
// (cascade unpin per thread-234 architect direction) so the thread
// remains replyable by its other participants. Default threshold: 7
// days; default interval: 1 hour.
const HUB_AGENT_STALE_THRESHOLD_MS = parseInt(
  process.env.HUB_AGENT_STALE_THRESHOLD_MS || String(7 * 24 * 60 * 60 * 1000),
  10,
);
const HUB_AGENT_REAPER_INTERVAL_MS = parseInt(
  process.env.HUB_AGENT_REAPER_INTERVAL_MS || String(60 * 60 * 1000),
  10,
);

let agentReaperHandle: NodeJS.Timeout | null = null;

async function runAgentReaperTick(): Promise<void> {
  try {
    const stale = await engineerRegistry.listOfflineAgentsOlderThan(HUB_AGENT_STALE_THRESHOLD_MS);
    if (stale.length === 0) return;
    console.log(`[Reaper] agent reaper: ${stale.length} stale agent(s) to delete (threshold ${Math.round(HUB_AGENT_STALE_THRESHOLD_MS / 1000)}s)`);
    for (const agent of stale) {
      const staleMs = Date.now() - Date.parse(agent.lastSeenAt);
      // CP3 C4 cascade unpin — strip the stale agentId from any thread
      // that still pins them to its currentTurnAgentId. Audited per
      // thread so forensic readers can trace the transition.
      try {
        const unpinned = await threadStore.unpinCurrentTurnAgent(agent.engineerId);
        for (const threadId of unpinned) {
          await auditStore.logEntry(
            "hub",
            "thread_currentturn_unpinned_via_agent_reaper",
            `Thread ${threadId} currentTurnAgentId cleared because pinned agent ${agent.engineerId} (role=${agent.role}) was reaped after ${Math.round(staleMs / 1000)}s offline.`,
            threadId,
          );
        }
        if (unpinned.length > 0) {
          console.log(`[Reaper] agent ${agent.engineerId}: ${unpinned.length} thread(s) unpinned via cascade`);
        }
      } catch (unpinErr) {
        console.error(`[Reaper] cascade unpin failed for agent ${agent.engineerId}:`, unpinErr);
      }

      try {
        const deleted = await engineerRegistry.deleteAgent(agent.engineerId);
        if (deleted) {
          await auditStore.logEntry(
            "hub",
            "agent_reaper_deleted",
            `Agent ${agent.engineerId} (role=${agent.role}, fingerprint=${agent.fingerprint.slice(0, 12)}…) deleted after ${Math.round(staleMs / 1000)}s offline (threshold ${Math.round(HUB_AGENT_STALE_THRESHOLD_MS / 1000)}s). lastSeenAt=${agent.lastSeenAt}.`,
            agent.engineerId,
          );
        }
      } catch (deleteErr) {
        console.error(`[Reaper] deleteAgent failed for ${agent.engineerId}:`, deleteErr);
      }
    }
  } catch (err) {
    console.error("[Reaper] agent reaper tick failed:", err);
  }
}

function startAgentReaper(): void {
  if (agentReaperHandle) return;
  console.log(`[Hub] Starting agent reaper: interval=${HUB_AGENT_REAPER_INTERVAL_MS}ms, stale-threshold=${HUB_AGENT_STALE_THRESHOLD_MS}ms`);
  agentReaperHandle = setInterval(() => {
    void runAgentReaperTick();
  }, HUB_AGENT_REAPER_INTERVAL_MS);
  agentReaperHandle.unref?.();
}

function stopAgentReaper(): void {
  if (agentReaperHandle) {
    clearInterval(agentReaperHandle);
    agentReaperHandle = null;
  }
}

// ── Continuation Sweep (task-314, mission-38 Task 1b) ────────────────
// Periodic background task symmetric to the reapers. Picks queue items
// in `continuation_required` state (set by agents calling
// save_continuation when round-budget runs low), transitions them back
// to `enqueued` via IPendingActionStore.resumeContinuation, and re-
// dispatches them to the target agent with the saved continuationState
// embedded in the outbound payload. The adapter can then resume from
// the snapshot rather than restart from scratch. Default cadence: 15s
// (faster than the 1h reapers because continuation delivery is
// user-latency-sensitive).

const HUB_CONTINUATION_SWEEP_INTERVAL_MS = parseInt(
  process.env.HUB_CONTINUATION_SWEEP_INTERVAL_MS || String(15 * 1000),
  10,
);

let continuationSweepHandle: NodeJS.Timeout | null = null;

async function runContinuationSweepTick(): Promise<void> {
  try {
    const items = await pendingActionStore.listContinuationItems();
    if (items.length === 0) return;
    console.log(`[Sweep] continuation: ${items.length} item(s) to re-dispatch`);
    for (const item of items) {
      try {
        const resumed = await pendingActionStore.resumeContinuation(item.id);
        if (!resumed) continue; // Race: another sweep or admin action drained it first.
        const { item: refreshed, continuationState } = resumed;
        // Re-emit the original dispatchType with continuationState embedded
        // so the adapter routes via its existing event-router path.
        try {
          await hub.dispatchEvent(
            refreshed.dispatchType,
            {
              ...refreshed.payload,
              sourceQueueItemId: refreshed.id,
              continuationState,
            },
            { engineerIds: [refreshed.targetAgentId] },
          );
          await auditStore.logEntry(
            "hub",
            "queue_item_continuation_resumed",
            `Queue item ${refreshed.id} re-dispatched from continuation_required (kind=${typeof continuationState.kind === "string" ? continuationState.kind : "unspecified"}, target=${refreshed.targetAgentId}).`,
            refreshed.id,
          );
        } catch (dispatchErr) {
          console.error(
            `[Sweep] continuation re-dispatch failed for ${refreshed.id}:`,
            dispatchErr,
          );
        }
      } catch (err) {
        console.error(`[Sweep] continuation tick failed on item ${item.id}:`, err);
      }
    }
  } catch (err) {
    console.error("[Sweep] continuation tick failed:", err);
  }
}

function startContinuationSweep(): void {
  if (continuationSweepHandle) return;
  console.log(`[Hub] Starting continuation sweep: interval=${HUB_CONTINUATION_SWEEP_INTERVAL_MS}ms`);
  continuationSweepHandle = setInterval(() => {
    void runContinuationSweepTick();
  }, HUB_CONTINUATION_SWEEP_INTERVAL_MS);
  continuationSweepHandle.unref?.();
}

function stopContinuationSweep(): void {
  if (continuationSweepHandle) {
    clearInterval(continuationSweepHandle);
    continuationSweepHandle = null;
  }
}

// Mission-51 W2: bounded-shadow message-projection sweeper. Runs a
// full-sweep on Hub startup (catches anything orphaned mid-projection
// by the previous Hub instance dying), then ticks every 5s as a
// backstop to the in-process W1 migration shim. Idempotent via
// findByMigrationSourceId; safe under concurrent thread-reply commits.
const messageProjectionSweeper = new MessageProjectionSweeper(
  threadStore,
  messageStore,
  { intervalMs: 5000 },
);

// Mission-51 W4: scheduled-message sweeper. Polls every 1s for
// scheduled+pending messages whose fireAt has been reached; evaluates
// optional precondition; transitions scheduledState pending→delivered
// (fire) or pending→precondition-failed (cancel + audit-entry).
// Hub-startup full-sweep catches anything pending across restart.
const scheduledMessageSweeper = new ScheduledMessageSweeper(
  messageStore,
  auditStore,
  {
    forSweeper: () => ({
      stores: allStores,
      metrics: createMetricsCounter(),
      emit: async () => {},
      dispatch: async () => {},
      sessionId: "scheduled-message-sweeper",
      clientIp: "127.0.0.1",
      role: "system",
      internalEvents: [],
      config: {
        storageBackend: STORAGE_BACKEND,
        gcsBucket: GCS_BUCKET ?? "",
      },
    } as unknown as import("./policy/types.js").IPolicyContext),
  },
  { intervalMs: parseInt(process.env.OIS_SCHEDULED_MESSAGE_SWEEPER_INTERVAL_MS ?? "1000", 10) },
);

// Mission-51 W5: cascade-replay sweeper (closes bug-31). Runs once
// on Hub startup (before serving traffic). Lists threads with
// cascadePending=true; re-runs runCascade for each. Per-action
// idempotency (existing findByCascadeKey short-circuit) prevents
// duplication on replay. No periodic ticking — process death is the
// only way the marker stays set, and Hub-startup is the natural
// retry boundary.
const cascadeReplaySweeper = new CascadeReplaySweeper(
  threadStore,
  {
    forSweeper: () => ({
      stores: allStores,
      metrics: createMetricsCounter(),
      emit: async () => {},
      dispatch: async () => {},
      sessionId: "cascade-replay-sweeper",
      clientIp: "127.0.0.1",
      role: "system",
      internalEvents: [],
      config: {
        storageBackend: STORAGE_BACKEND,
        gcsBucket: GCS_BUCKET ?? "",
      },
    } as unknown as import("./policy/types.js").IPolicyContext),
  },
);

// Mission-57 W2: PulseSweeper — single-instance recurring sweeper that
// drives declarative per-mission pulse coordination. 60s tick; iterates
// active missions with `pulses.{engineerPulse, architectPulse}` config;
// per-pulse evaluates fire-due / missed-threshold / precondition; emits
// pulse Messages via the existing message-store; observes acks via the
// `message-policy.ts:ackMessage` webhook hook (Item-2 composition).
const pulseSweeper = new PulseSweeper(
  missionStore,
  messageStore,
  {
    forSweeper: () => ({
      stores: allStores,
      metrics: createMetricsCounter(),
      emit: async () => {},
      dispatch: async () => {},
      sessionId: "pulse-sweeper",
      clientIp: "127.0.0.1",
      role: "system",
      internalEvents: [],
      config: {
        storageBackend: STORAGE_BACKEND,
        gcsBucket: GCS_BUCKET ?? "",
      },
    } as unknown as import("./policy/types.js").IPolicyContext),
  },
  {
    intervalMs: parseInt(process.env.OIS_PULSE_SWEEPER_INTERVAL_MS ?? "60000", 10),
  },
);
allStores.pulseSweeper = pulseSweeper;

// Mission-52 T3: repo-event-bridge composition. Conditional on
// OIS_GH_API_TOKEN — absent → bridge skipped, Hub starts cleanly.
// PAT scope/auth failures are caught inside RepoEventBridge.start()
// (logged + bridge halts; Hub continues per directive).
const OIS_GH_API_TOKEN = process.env.OIS_GH_API_TOKEN;
const OIS_REPO_EVENT_BRIDGE_REPOS = parseReposEnvVar(
  process.env.OIS_REPO_EVENT_BRIDGE_REPOS,
);
const OIS_REPO_EVENT_BRIDGE_CADENCE_S = parseInt(
  process.env.OIS_REPO_EVENT_BRIDGE_CADENCE_S ?? "30",
  10,
);
const OIS_REPO_EVENT_BRIDGE_RATE_BUDGET_PCT = parseFloat(
  process.env.OIS_REPO_EVENT_BRIDGE_RATE_BUDGET_PCT ?? "0.8",
);

let repoEventBridge: RepoEventBridge | undefined;
if (OIS_GH_API_TOKEN && OIS_REPO_EVENT_BRIDGE_REPOS.length > 0) {
  repoEventBridge = new RepoEventBridge({
    storage: storageProvider,
    token: OIS_GH_API_TOKEN,
    repos: OIS_REPO_EVENT_BRIDGE_REPOS,
    cadenceSeconds: OIS_REPO_EVENT_BRIDGE_CADENCE_S,
    budgetFraction: OIS_REPO_EVENT_BRIDGE_RATE_BUDGET_PCT,
    createMessageInvoke: createPolicyRouterInvoker(policyRouter, () => ({
      stores: allStores,
      metrics: createMetricsCounter(),
      emit: async () => {},
      dispatch: async () => {},
      sessionId: "repo-event-bridge",
      clientIp: "127.0.0.1",
      role: "system",
      internalEvents: [],
      config: {
        storageBackend: STORAGE_BACKEND,
        gcsBucket: GCS_BUCKET ?? "",
      },
    } as unknown as import("./policy/types.js").IPolicyContext)),
  });
} else if (OIS_GH_API_TOKEN && OIS_REPO_EVENT_BRIDGE_REPOS.length === 0) {
  console.warn(
    "[Hub] OIS_GH_API_TOKEN set but OIS_REPO_EVENT_BRIDGE_REPOS empty/unset — repo-event-bridge skipped (configure repos to enable).",
  );
} else {
  console.log(
    "[Hub] OIS_GH_API_TOKEN not set — repo-event-bridge skipped (set token + OIS_REPO_EVENT_BRIDGE_REPOS to enable).",
  );
}

startupSequence().then(async () => {
  await hub.start();
  startThreadReaper();
  startAgentReaper();
  startContinuationSweep();
  // Mission-51 W2: full-sweep before announcing readiness so any
  // unprojected messages from the previous Hub instance are caught up
  // before traffic starts flowing.
  try {
    const swept = await messageProjectionSweeper.fullSweep();
    if (swept.messagesProjected > 0 || swept.errors > 0) {
      console.log(
        `[Hub] Startup message-projection sweep: scanned=${swept.threadsScanned} projected=${swept.threadsProjected} messages=${swept.messagesProjected} errors=${swept.errors}`,
      );
    }
  } catch (err) {
    console.warn("[Hub] Startup message-projection sweep failed; sweeper still starts:", err);
  }
  messageProjectionSweeper.start();
  // Mission-51 W4: full-sweep before announcing readiness so any
  // scheduled-pending messages that became due during the previous
  // Hub-down window fire promptly.
  try {
    const swept = await scheduledMessageSweeper.fullSweep();
    if (swept.fired > 0 || swept.cancelled > 0 || swept.errors > 0) {
      console.log(
        `[Hub] Startup scheduled-message sweep: scanned=${swept.scanned} fired=${swept.fired} cancelled=${swept.cancelled} errors=${swept.errors}`,
      );
    }
  } catch (err) {
    console.warn("[Hub] Startup scheduled-message sweep failed; sweeper still starts:", err);
  }
  scheduledMessageSweeper.start();
  // Mission-57 W2: PulseSweeper — drives declarative per-mission pulse
  // coordination. 60s tick (configurable via OIS_PULSE_SWEEPER_INTERVAL_MS).
  pulseSweeper.start();
  // Mission-51 W5: cascade-replay sweeper. Hub-startup full-sweep
  // catches threads orphaned mid-cascade by previous Hub instance
  // dying. Idempotent on already-completed actions (cascade-key
  // short-circuit). Hub-startup-only (no periodic ticking).
  try {
    const replayed = await cascadeReplaySweeper.fullSweep();
    if (replayed.scanned > 0 || replayed.errors > 0) {
      console.log(
        `[Hub] Startup cascade-replay sweep: scanned=${replayed.scanned} replayed=${replayed.replayed} errors=${replayed.errors}`,
      );
    }
  } catch (err) {
    console.warn("[Hub] Startup cascade-replay sweep failed; Hub still starts:", err);
  }
  // Mission-52 T3: start repo-event-bridge if configured. PAT failures
  // are caught inside .start() — Hub continues with bridge in `failed`
  // state per directive (no Hub-crash on under-scoped tokens).
  if (repoEventBridge) {
    await repoEventBridge.start();
  }
  console.log(`[Hub] MCP Relay Hub listening on port ${PORT}`);
  console.log(`[Hub] MCP endpoint: POST/GET/DELETE /mcp`);
  console.log(`[Hub] Health check: GET /health`);
}).catch(async (err) => {
  console.error("[Hub] Startup sequence error:", err);
  // Start anyway
  await hub.start();
  startThreadReaper();
  startAgentReaper();
  startContinuationSweep();
  messageProjectionSweeper.start();
  scheduledMessageSweeper.start();
  pulseSweeper.start();
  console.log(`[Hub] MCP Relay Hub listening on port ${PORT} (with startup warning)`);
});

// ── Graceful Shutdown ────────────────────────────────────────────────
process.on("SIGINT", async () => {
  console.log("[Hub] Shutting down...");
  stopThreadReaper();
  stopAgentReaper();
  stopContinuationSweep();
  messageProjectionSweeper.stop();
  scheduledMessageSweeper.stop();
  pulseSweeper.stop();
  // Mission-52 T3: stop the bridge before the Hub network so any
  // in-flight create_message dispatches land cleanly.
  if (repoEventBridge) {
    await repoEventBridge.stop();
  }
  await hub.stop();
  process.exit(0);
});
