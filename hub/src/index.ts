/**
 * MCP Relay Hub — Entrypoint
 *
 * A lightweight MCP Server (Streamable HTTP transport) that routes
 * Directives and Reports between an Architect agent and an Engineer CLI.
 *
 * Deployed to Cloud Run as a containerized Express application.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MemoryTaskStore, MemoryEngineerRegistry, MemoryProposalStore, MemoryThreadStore, MemoryAuditStore, MemoryNotificationStore } from "./state.js";
import type { ITaskStore, IEngineerRegistry, IProposalStore, IThreadStore, IAuditStore, INotificationStore } from "./state.js";
import { GcsTaskStore, GcsEngineerRegistry, GcsProposalStore, GcsThreadStore, GcsAuditStore, GcsNotificationStore, reconcileCounters, cleanupOrphanedFiles } from "./gcs-state.js";
import {
  MemoryIdeaStore, MemoryMissionStore, MemoryTurnStore, MemoryTeleStore, MemoryBugStore,
  GcsIdeaStore, GcsMissionStore, GcsTurnStore, GcsTeleStore, GcsBugStore,
  MemoryPendingActionStore, MemoryDirectorNotificationStore,
  GcsPendingActionStore, GcsDirectorNotificationStore,
  type IIdeaStore, type IMissionStore, type ITurnStore, type ITeleStore, type IBugStore,
  type IPendingActionStore, type IDirectorNotificationStore,
} from "./entities/index.js";
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
import { registerBugPolicy } from "./policy/bug-policy.js";
import { registerPendingActionPolicy } from "./policy/pending-action-policy.js";
import { Watchdog } from "./policy/watchdog.js";
import { bindRouterToMcp } from "./policy/mcp-binding.js";
import type { AllStores } from "./policy/index.js";
import { createMetricsCounter } from "./observability/metrics.js";

// ── Global State ──────────────────────────────────────────────────────
const STORAGE_BACKEND = process.env.STORAGE_BACKEND || "memory";
const GCS_BUCKET = process.env.GCS_BUCKET || "ois-relay-hub-state";

let taskStore: ITaskStore;
let engineerRegistry: IEngineerRegistry;
let proposalStore: IProposalStore;
let threadStore: IThreadStore;
let auditStore: IAuditStore;
let notificationStore: INotificationStore;
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
let directorNotificationStore: IDirectorNotificationStore;

if (STORAGE_BACKEND === "gcs") {
  console.log(`[Hub] Using GCS storage backend: gs://${GCS_BUCKET}`);
  taskStore = new GcsTaskStore(GCS_BUCKET);
  engineerRegistry = new GcsEngineerRegistry(GCS_BUCKET);
  proposalStore = new GcsProposalStore(GCS_BUCKET);
  threadStore = new GcsThreadStore(GCS_BUCKET);
  auditStore = new GcsAuditStore(GCS_BUCKET);
  notificationStore = new GcsNotificationStore(GCS_BUCKET);
  // New entities — GCS-backed for persistence across restarts
  ideaStore = new GcsIdeaStore(GCS_BUCKET);
  missionStore = new GcsMissionStore(GCS_BUCKET, taskStore, ideaStore);
  turnStore = new GcsTurnStore(GCS_BUCKET, missionStore, taskStore);
  teleStore = new GcsTeleStore(GCS_BUCKET);
  bugStore = new GcsBugStore(GCS_BUCKET);
  pendingActionStore = new GcsPendingActionStore(GCS_BUCKET);
  directorNotificationStore = new GcsDirectorNotificationStore(GCS_BUCKET);
} else {
  if (process.env.NODE_ENV === "production") {
    console.error("[Hub] FATAL: STORAGE_BACKEND is 'memory' in production. Set STORAGE_BACKEND=gcs to prevent silent state loss.");
    process.exit(1);
  }
  console.log("[Hub] Using in-memory storage backend");
  taskStore = new MemoryTaskStore();
  engineerRegistry = new MemoryEngineerRegistry();
  proposalStore = new MemoryProposalStore();
  threadStore = new MemoryThreadStore();
  auditStore = new MemoryAuditStore();
  notificationStore = new MemoryNotificationStore();
  ideaStore = new MemoryIdeaStore();
  missionStore = new MemoryMissionStore(taskStore, ideaStore);
  turnStore = new MemoryTurnStore(missionStore, taskStore);
  teleStore = new MemoryTeleStore();
  bugStore = new MemoryBugStore();
  pendingActionStore = new MemoryPendingActionStore();
  directorNotificationStore = new MemoryDirectorNotificationStore();
}

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
  directorNotification: directorNotificationStore,
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
    config: { storageBackend: STORAGE_BACKEND, gcsBucket: GCS_BUCKET },
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
  notificationStore,
  createMcpServerFactory,
  {
    port: PORT,
    apiToken: HUB_API_TOKEN,
    webhookUrl: ARCHITECT_WEBHOOK_URL,
    keepaliveInterval: 30_000,
    sessionTtl: 180_000,
    reaperInterval: 60_000,
    orphanTtl: 60_000,
    notificationMaxAge: 24 * 60 * 60 * 1000,
    notificationCleanupInterval: 60 * 60 * 1000,
    autoStartTimers: true,
    quiet: false,
  }
);

// ── Start Server ─────────────────────────────────────────────────────

async function startupSequence(): Promise<void> {
  if (STORAGE_BACKEND === "gcs") {
    console.log("[Hub] Running GCS startup maintenance...");
    await cleanupOrphanedFiles(GCS_BUCKET);
    await reconcileCounters(GCS_BUCKET);
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

startupSequence().then(async () => {
  await hub.start();
  startThreadReaper();
  startAgentReaper();
  startContinuationSweep();
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
  console.log(`[Hub] MCP Relay Hub listening on port ${PORT} (with startup warning)`);
});

// ── Graceful Shutdown ────────────────────────────────────────────────
process.on("SIGINT", async () => {
  console.log("[Hub] Shutting down...");
  stopThreadReaper();
  stopAgentReaper();
  stopContinuationSweep();
  await hub.stop();
  process.exit(0);
});
