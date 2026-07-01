/**
 * shim.ts — pi ↔ Hub last-mile shim (lifecycle + connect + config).
 *
 * pi-specific wiring only. The reusable adapter behavior (session FSM, handshake,
 * state-sync, dedup, reconnect, tool CATALOG, tool DISPATCH, wake ROUTING) lives
 * in `@apnex/network-adapter` and is consumed through the facade — this file is
 * the thin harness binding.
 *
 * Architectural divergence from the MCP hosts (claude/opencode): pi has NO MCP
 * client, so there is NO local MCP proxy server. Tools are registered NATIVELY
 * (`tool-bridge.registerHubTools`) and each `execute` routes through the shared
 * `runToolDispatch` authority via a `ToolDispatchContext` built from the
 * dispatcher's shared state. pi's native `ctx.isIdle()` feeds the dispatcher's
 * wake/stall idle-gate (`externalIdle`), and the dispatcher's shared
 * `workLeases` feeds the dispatch context so lease observations reach the
 * stall-prompt path. "One dispatch authority; a native binding instead of MCP."
 *
 * Boundary: imports `@apnex/network-adapter` ONLY from the @apnex graph.
 *
 * Design: docs/designs/m-pi-plugin-adapter-design.md §4, §5, §6, §7
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  McpAgentClient,
  createSharedDispatcher,
  assertHostWiringComplete,
  ToolSurfaceReconciler,
  makeFetchLiveToolSurfaceRevision,
  loadConfig,
  readRequiredAgentName,
  readPackageVersion,
  createFileLogger,
  appendNotification,
  buildPendingTaskNotification,
  CognitivePipeline,
  UNKNOWN_BUILD_INFO,
  type HubConfig,
  type FileLogger,
  type SharedDispatcher,
  type ToolDispatchContext,
  type HandshakeFatalError,
  type TelemetryEvent,
  type BuildInfo,
} from "@apnex/network-adapter";
import { registerHubTools } from "./tool-bridge.js";
import { buildPiNotificationHooks } from "./wake.js";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Version + build identity ─────────────────────────────────────────
const __shimDir = dirname(fileURLToPath(import.meta.url));
const PI_PLUGIN_PKG_VERSION = readPackageVersion(
  resolve(__shimDir, "..", "package.json"),
  "unknown",
);
let NETWORK_ADAPTER_PKG_VERSION = PI_PLUGIN_PKG_VERSION;
try {
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  NETWORK_ADAPTER_PKG_VERSION = readPackageVersion(
    req.resolve("@apnex/network-adapter/package.json"),
    PI_PLUGIN_PKG_VERSION,
  );
} catch {
  /* dev/bundle path — fall back to shim version */
}
const PROXY_VERSION = PI_PLUGIN_PKG_VERSION;
const SDK_VERSION = `@apnex/network-adapter@${NETWORK_ADAPTER_PKG_VERSION}`;
// pi ships node_modules-resolvable deps; build-identity via write-build-info.js
// (prebuild) if present, else UNKNOWN. Kept simple — no bundle inlining (pi is
// jiti/tsx-loaded from source or dist).
const BUILD_INFO: BuildInfo = UNKNOWN_BUILD_INFO;

// ── Module state ─────────────────────────────────────────────────────
let __fileLog: FileLogger | null = null;
let notificationLogPath = "";
let hubAdapter: McpAgentClient | null = null;
let config: HubConfig;
let reconciler: ToolSurfaceReconciler | null = null;
let currentRole = process.env.OIS_HUB_ROLE ?? "architect";
let started = false;

function log(msg: string): void {
  __fileLog?.log(msg);
}

function initLogger(directory: string): void {
  const diagLogPath = join(directory, ".ois", "pi-plugin.log");
  notificationLogPath = join(directory, ".ois", "pi-plugin-notifications.log");
  __fileLog = createFileLogger({
    textFile: diagLogPath,
    formatLine: (m) => `${new Date().toISOString()} ${m}\n`,
  });
}

// ── The shared dispatcher (native-binding configuration) ─────────────
//
// Built lazily in `startSession` once config + pi context exist (unlike
// opencode's module-init construction — pi's factory must not do work). Holds
// the pendingActionMap, callbacks, pollBackstop, notification routing, and the
// shared workLeases the native ToolDispatchContext writes to.
let dispatcher: SharedDispatcher | null = null;

/**
 * Build the ToolDispatchContext for pi's native tool binding. It shares the
 * dispatcher's pendingActionMap + workLeases so queueItemId injection and lease
 * observation behave identically to the MCP path. `onCallStart/End` are no-ops
 * here: pi's NATIVE idle signal (ctx.isIdle) is authoritative for the idle-gate
 * (wired via createSharedDispatcher's externalIdle), so we do not maintain a
 * separate counter that would double-count or drift.
 */
function buildDispatchContext(d: SharedDispatcher): ToolDispatchContext {
  return {
    getAgent: () => hubAdapter,
    pendingActionMap: d.pendingActionMap,
    workLeases: d.workLeases,
    onCallStart: () => {},
    onCallEnd: () => {},
    onToolCallResult: undefined,
    log,
  };
}

function buildToolSurfaceReconciler(
  hubUrl: string,
  onDrift: () => void,
): ToolSurfaceReconciler {
  return new ToolSurfaceReconciler({
    fetchLiveRevision: makeFetchLiveToolSurfaceRevision({ hubUrl, log }),
    // pi has NO persistent tool-catalog cache (like opencode): seed baselines
    // from live without emitting; the L2 heartbeat catches mid-session redeploys.
    readServedRevision: () => null,
    emitListChanged: onDrift,
    log,
  });
}

// ── Connect + seed ───────────────────────────────────────────────────

async function connectAndSeed(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  agentName: string,
): Promise<void> {
  currentRole = config.role;
  log(`[pi-plugin] role bound to config.role="${config.role}"`);

  // Build the dispatcher NOW (config known). Native-binding config: externalIdle
  // = pi's native idle probe (its tool calls bypass the MCP CallTool handler, so
  // the internal counter can't see them); the reconcile gates on THIS instead.
  // Build the pi notification hooks ONCE and reuse for both the dispatcher's
  // routed surface and the drain-path pending-action handler below.
  const notificationHooks = buildPiNotificationHooks({
    pi,
    isIdle: () => ctx.isIdle(),
    log,
    notificationLogPath,
    ctx,
  });

  const d = createSharedDispatcher({
    getAgent: () => hubAdapter,
    proxyVersion: PROXY_VERSION,
    serverName: "hub-proxy",
    serverCapabilities: { tools: {}, logging: {} },
    log,
    notificationHooks,
    externalIdle: () => ctx.isIdle(),
    pollBackstop: {
      role: () => currentRole,
      firstTimerEnabled: true,
      log,
      onHeartbeatTick: async () => {
        await reconciler?.reconcile("heartbeat");
      },
    },
  });
  dispatcher = d;
  const dispatchCtx = buildDispatchContext(d);

  // Drain-path handler: populates pendingActionMap (queueItemId parity) AND
  // forwards to the SAME notification hooks (bug-108 wake parity) in one call.
  const pendingActionItemHandler = d.makePendingActionItemHandler(notificationHooks);

  hubAdapter = new McpAgentClient(
    {
      role: config.role,
      labels: config.labels,
      logger: log,
      handshake: {
        name: agentName,
        proxyName: "@apnex/pi-plugin",
        proxyVersion: PROXY_VERSION,
        transport: "pi-native",
        sdkVersion: SDK_VERSION,
        proxyCommitSha: BUILD_INFO.commitSha,
        proxyDirty: BUILD_INFO.dirty,
        sdkCommitSha: BUILD_INFO.commitSha,
        sdkDirty: BUILD_INFO.dirty,
        getClientInfo: () => ({
          name: "pi",
          version: process.env.PI_VERSION ?? "unknown",
        }),
        llmModel: process.env.HUB_LLM_MODEL,
        onFatalHalt: (err: HandshakeFatalError): void => {
          log(`[FATAL:${err.code}] ${err.message}`);
          // pi CAN exit cleanly (unlike opencode) — request graceful shutdown.
          try {
            ctx.ui.notify(`Hub fatal: ${err.code}`, "error");
          } catch {
            /* UI not ready */
          }
          ctx.shutdown();
        },
        onPendingTask: (task) => {
          appendNotification(buildPendingTaskNotification(task), {
            logPath: notificationLogPath,
          });
        },
        // Drain-path parity: makePendingActionItemHandler already forwards to
        // notificationHooks.onPendingActionItem (wired above), so this is the
        // single drain entrypoint — no double-render.
        onPendingActionItem: pendingActionItemHandler,
      },
    },
    {
      transportConfig: { url: config.hubUrl, token: config.hubToken },
      cognitive: CognitivePipeline.standard({
        telemetry: {
          sink: (event: TelemetryEvent) => {
            try {
              log(`[PiPluginTelemetry] ${JSON.stringify(event)}`);
            } catch {
              /* never disturb the tool-call loop */
            }
          },
        },
      }),
    },
  );
  hubAdapter.setCallbacks(d.callbacks);

  // Reconciler drift → re-seed the native tool surface + toast.
  reconciler = buildToolSurfaceReconciler(config.hubUrl, () => {
    void seedToolSurface(pi, dispatchCtx).catch((err) =>
      log(`[ToolSurface] re-seed failed (non-fatal): ${err}`),
    );
    try {
      ctx.ui.notify("Hub tools updated — re-enumerating", "info");
    } catch {
      /* UI not ready */
    }
  });

  await hubAdapter.start();
  log("Connected to remote Hub via McpAgentClient (pi native binding)");

  assertHostWiringComplete(d, log);
  d.pollBackstop?.start(() => hubAdapter);

  // Seed the native tool surface from the live catalog.
  await seedToolSurface(pi, dispatchCtx);
  // Baseline the reconciler's applied revision (seed pass: no emit).
  await reconciler.reconcile("identityReady");
}

/**
 * Fetch the LLM-facing catalog and register each tool natively with pi. Core
 * already tier-filters + cognitively-enriches (agent.listTools), so this reads a
 * pre-hydrated catalog (A11) and renders it — no re-derivation.
 */
async function seedToolSurface(
  pi: ExtensionAPI,
  dispatchCtx: ToolDispatchContext,
): Promise<void> {
  if (!hubAdapter) return;
  const descriptors = await hubAdapter.listTools();
  const names = registerHubTools(pi, descriptors, dispatchCtx);
  // Enable the Hub tools alongside pi's existing active tools.
  const active = pi.getActiveTools();
  pi.setActiveTools([...new Set([...active, ...names])]);
  log(`[ToolSurface] seeded ${names.length} Hub tools`);
}

// ── Lifecycle entrypoints (called from index.ts factory) ─────────────

export async function startSession(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  if (started) return;
  started = true;
  initLogger(ctx.cwd);
  log(`[pi-plugin] session_start — ${SDK_VERSION}`);

  config = loadConfig({
    directory: ctx.cwd,
    defaults: {
      hubUrl:
        process.env.OIS_HUB_URL ??
        "https://mcp-relay-hub-5muxctm3ta-ts.a.run.app/mcp",
      autoPrompt: true,
    },
    warn: log,
    readAutoPrompt: true,
  });
  // Default role for the pi host is architect (design §6) unless config/env override.
  if (!config.role) config.role = "architect";

  const agentName = readRequiredAgentName(log);
  if (!agentName) {
    log("[pi-plugin] no agent name configured — plugin inert until set");
    return;
  }

  try {
    await connectAndSeed(pi, ctx, agentName);
    try {
      ctx.ui.notify("Hub connected", "info");
    } catch {
      /* UI not ready */
    }
  } catch (err) {
    log(`[pi-plugin] Hub connection failed: ${err}`);
  }
}

export async function shutdownSession(): Promise<void> {
  log("[pi-plugin] session_shutdown — tearing down");
  try {
    dispatcher?.pollBackstop?.stop();
  } catch {
    /* idempotent */
  }
  try {
    await hubAdapter?.stop();
  } catch {
    /* idempotent */
  }
  hubAdapter = null;
  reconciler = null;
  dispatcher = null;
  started = false;
}

// Test-only surface.
export const _testOnly = {
  getHubAdapter: () => hubAdapter,
  getDispatcher: () => dispatcher,
  buildDispatchContext,
  buildToolSurfaceReconciler,
  setHubAdapter: (a: McpAgentClient | null) => {
    hubAdapter = a;
  },
};
