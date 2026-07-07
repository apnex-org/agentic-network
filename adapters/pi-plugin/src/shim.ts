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
  readBuildInfo,
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
import { buildPiNotificationHooks } from "./wake.js";
import { installFooter, type FooterController } from "./footer-install.js";
import { runSwarmPoll } from "./footer-poll.js";
import { SpecStore } from "./hcap/tools/spec-store.js";
import { DiffEngine } from "./hcap/tools/diff-engine.js";
import { ConvergenceActuator } from "./hcap/tools/convergence-actuator.js";
import { SpecReconcileLoop } from "./hcap/tools/reconcile-loop.js";
import { PiToolActuatorPort } from "./hcap/tools/pi-tool-actuator-port.js";
import { HubSpecSource } from "./hcap/tools/hub-spec-source.js";
import { PiToolControlPlane } from "./hcap/tools/tool-control-plane.js";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Version + build identity ─────────────────────────────────────────
const __shimDir = dirname(fileURLToPath(import.meta.url));
const PI_PLUGIN_PKG_VERSION = readPackageVersion(
  resolve(__shimDir, "..", "package.json"),
  "unknown",
);
let NETWORK_ADAPTER_PKG_VERSION = PI_PLUGIN_PKG_VERSION;
const { createRequire } = await import("node:module");
const __require = createRequire(import.meta.url);
try {
  NETWORK_ADAPTER_PKG_VERSION = readPackageVersion(
    __require.resolve("@apnex/network-adapter/package.json"),
    PI_PLUGIN_PKG_VERSION,
  );
} catch {
  /* dev/bundle path — fall back to shim version */
}
const PROXY_VERSION = PI_PLUGIN_PKG_VERSION;
const SDK_VERSION = `@apnex/network-adapter@${NETWORK_ADAPTER_PKG_VERSION}`;
// Build identity: write-build-info.js (prebuild) emits dist/build-info.json for
// BOTH this shim and @apnex/network-adapter. Read the shim's for proxy* and the
// resolvable kernel's for sdk* (mirrors the claude-plugin pattern). Falls back
// to UNKNOWN on the dev/tsx path where no dist/build-info.json exists — keeps the
// handshake honest (no phantom sha; bug-183 class). __shimDir = dist/ at runtime.
const PROXY_BUILD_INFO: BuildInfo = readBuildInfo(
  resolve(__shimDir, "build-info.json"),
);
const SDK_BUILD_INFO: BuildInfo = (() => {
  try {
    return readBuildInfo(
      __require.resolve("@apnex/network-adapter/dist/build-info.json"),
    );
  } catch {
    return UNKNOWN_BUILD_INFO;
  }
})();

// ── Module state ─────────────────────────────────────────────────────
let __fileLog: FileLogger | null = null;
let notificationLogPath = "";
let hubAdapter: McpAgentClient | null = null;
let config: HubConfig;
let reconciler: ToolSurfaceReconciler | null = null;
// HCAP tool-control-plane (mission-107). The reconciler above CLEAVES: it remains the
// Hub-revision DRIFT DETECTOR (its onDrift refreshes the spec + converges); the
// actuation / converge half is the HCAP stack below. `controlPlane.sync` converges the
// held declared spec (U1) onto pi's running active-set (U5); `hubSpecSource` refreshes
// the declared spec from the live Hub catalog. Both null until connect.
let controlPlane: PiToolControlPlane | null = null;
let hubSpecSource: HubSpecSource | null = null;
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

// The swarm-aware footer controller (mission-99 slice (a)). Null in non-TUI mode
// (gate 0) or before connect. Fed by push events; render is pure + read-only.
let footer: FooterController | null = null;

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

  // ── mission-99 slice (a): install the swarm-aware footer (TUI-only, gate 0) ──
  // Built BEFORE the notification hooks so onStateChange/onPendingActionItem can
  // push into it. The lease source lazily reads the dispatcher's shared
  // WorkLeaseTracker (populated by the agent's own claim/renew — client-side, no
  // Hub poll; spec §4). installFooter returns null in non-TUI mode (no activity).
  footer = installFooter({
    ctx,
    leases: { snapshot: () => dispatcher?.workLeases.snapshot() ?? [] },
    log,
  });
  footer?.setIdentity(agentName, config.role);

  // llm coarse-error tally (spec §5a): message_end with an error stopReason is
  // the ONLY extension-visible llm-health signal today (catch #3 / audit-6237 —
  // auto_retry_*/willRetry are NOT on the extension surface). agent_start resets
  // the S4-approx "since you last looked" count (the agent is taking its turn).
  // Both are no-ops when footer is null (non-TUI). Read-only observation.
  if (footer) {
    pi.on("message_end", (event) => {
      try {
        if (isLlmErrorMessageEnd(event)) footer?.onLlmError();
      } catch {
        /* never disturb the turn loop */
      }
    });
    pi.on("agent_start", () => {
      try {
        footer?.onAgentTurn();
      } catch {
        /* non-fatal */
      }
    });
  }

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
    footer,
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
        // L2 heartbeat: (1) the reconciler detects Hub-revision drift → onDrift
        // refreshes the declared spec; (2) sync converges the held spec onto pi's
        // running active-set every tick — repairing pi active-set drift even when the
        // Hub is unchanged (mission-106 F1 disk-repair loop, re-pointed at the spec).
        await reconciler?.reconcile("heartbeat");
        controlPlane?.sync("heartbeat");
        // mission-99 slice (b): Tier-C swarm PULL on the SAME heartbeat tick
        // (spec §6 — no new timer; rides the F2 ±20% jitter for anti-stampede).
        // READ-ONLY (get_agents + role-scoped S4 reads); pushes into the footer
        // store so render stays pure (gate 1). A throw = a failed refresh: the
        // store keeps its prior pull and render stale-marks it (§6 SLO). No-op
        // when footer is null (non-TUI) or the wire isn't up yet.
        if (footer && hubAdapter?.isConnected) {
          try {
            const selfAgentId = hubAdapter.getMetrics().agentId ?? null;
            const { peers, s4Authoritative } = await runSwarmPoll(
              hubAdapter,
              currentRole,
              selfAgentId,
            );
            footer.onSwarmPull(peers, s4Authoritative);
          } catch (err) {
            log(`[footer] swarm poll failed (non-fatal; will stale-mark): ${(err as Error)?.message ?? err}`);
          }
        }
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
        proxyCommitSha: PROXY_BUILD_INFO.commitSha,
        proxyDirty: PROXY_BUILD_INFO.dirty,
        sdkCommitSha: SDK_BUILD_INFO.commitSha,
        sdkDirty: SDK_BUILD_INFO.dirty,
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

  // ── HCAP tool-control-plane (mission-107) ────────────────────────────
  // The 6-unit converge stack. U5 (the port) is the SOLE ExtensionAPI crossing;
  // U1-U4 + U6 are pi-neutral. The additive `seedToolSurface` UNION is GONE:
  // converge = registerTool(ALL declared, KF2) + setActiveTools(EXACT enabled subset
  // ∪ preserved built-ins) — one authoritative REPLACE that both ADDS and REMOVES
  // (removal = set-subtraction; pi has no deregister). One store instance is shared
  // by the loop (reads it) and the facade (writes it).
  const actuatorPort = new PiToolActuatorPort(pi, dispatchCtx);
  const store = new SpecStore();
  const specLoop = new SpecReconcileLoop(
    {
      store,
      diff: new DiffEngine(),
      actuator: new ConvergenceActuator(actuatorPort),
      port: actuatorPort,
    },
    { log },
  );
  const plane = new PiToolControlPlane({ store, loop: specLoop, port: actuatorPort });
  const source = new HubSpecSource({
    // U6 fetches the live LLM-facing catalog (core-hydrated); the KF1(b) zero-tool
    // poison guard lives inside refreshFromHub, not here.
    fetchCatalog: async () => (hubAdapter ? hubAdapter.listTools() : []),
    controlPlane: plane,
    log,
  });
  controlPlane = plane;
  hubSpecSource = source;

  // Reconciler drift (L3) → refresh the declared spec from the Hub, then converge.
  reconciler = buildToolSurfaceReconciler(config.hubUrl, () => {
    void source
      .refreshFromHub()
      .then(() => plane.sync("drift"))
      .catch((err) => log(`[hcap] drift refresh failed (non-fatal): ${err}`));
    try {
      ctx.ui.notify("Hub tools updated — reconciling", "info");
    } catch {
      /* UI not ready */
    }
  });

  await hubAdapter.start();
  log("Connected to remote Hub via McpAgentClient (pi native binding)");

  assertHostWiringComplete(d, log);
  d.pollBackstop?.start(() => hubAdapter);

  // L1 bootstrap: refresh the declared spec from the live catalog, then converge
  // (registration + activation) in one authoritative pass.
  await source.refreshFromHub();
  plane.sync("bootstrap");
  // Baseline the reconciler's applied revision (seed pass: no emit).
  await reconciler.reconcile("identityReady");
}

// ── Lifecycle entrypoints (called from index.ts factory) ─────────────

/**
 * spec §5a: classify a pi `message_end` event as an llm ERROR for the footer's
 * coarse tally. DELIBERATELY NARROW — counts ONLY stopReason === "error".
 *
 * Non-error terminals (stop / toolUse / aborted / length / any other value) are
 * NOT errors and must NOT increment (steve gate: over-reporting non-error
 * states corrupts the llm-health signal). An `errorMessage` WITHOUT an error
 * stopReason is likewise NOT counted — the tally is a coarse error-STATE signal
 * keyed on the single extension-visible error discriminator (catch #3 /
 * audit-6237: the auto_retry / willRetry signals are not on the extension
 * surface).
 *
 * Pure + total (never throws) so the turn-loop hook can call it directly.
 */
export function isLlmErrorMessageEnd(event: unknown): boolean {
  const msg = (event as { message?: { stopReason?: unknown } } | null | undefined)?.message;
  return msg?.stopReason === "error";
}

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
    footer?.dispose();
  } catch {
    /* idempotent */
  }
  footer = null;
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
  isLlmErrorMessageEnd,
  getHubAdapter: () => hubAdapter,
  getDispatcher: () => dispatcher,
  buildDispatchContext,
  buildToolSurfaceReconciler,
  setHubAdapter: (a: McpAgentClient | null) => {
    hubAdapter = a;
  },
};
