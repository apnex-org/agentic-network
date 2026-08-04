/**
 * shim.ts — pi ↔ Hub last-mile shim (lifecycle + connect + config).
 *
 * pi-specific wiring only. The reusable adapter behavior (session FSM, handshake,
 * state-sync, dedup, reconnect, tool CATALOG, tool DISPATCH, wake ROUTING) lives
 * in `@apnex/network-adapter` and is consumed through the facade — this file is
 * the thin harness binding.
 *
 * Architectural divergence from the MCP hosts (claude/opencode): pi has NO MCP
 * client, so there is NO local MCP proxy server. Tools are registered NATIVELY via
 * the HCAP declarative tool-control-plane (mission-107): `HubSpecSource` fetches the
 * live catalog into the declared spec and `SpecReconcileLoop` converges it onto pi
 * through the sole `PiToolActuator`, which renders each descriptor via
 * `tool-bridge.buildPiToolDefinition` and calls `pi.registerTool`. Each tool's
 * `execute` routes through the shared `runToolDispatch` authority via a
 * `ToolDispatchContext` built from the dispatcher's shared state. pi's native
 * `ctx.isIdle()` feeds the dispatcher's wake/stall idle-gate (`externalIdle`), and
 * the dispatcher's shared `workLeases` feeds the dispatch context so lease
 * observations reach the stall-prompt path. "One dispatch authority; a native
 * binding instead of MCP."
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
  DEFAULT_TRANSIENT_DROP_RETRY,
  assertHostWiringComplete,
  ToolSurfaceReconciler,
  makeFetchLiveToolSurfaceRevision,
  loadConfig,
  loadHarnessManifest,
  readRequiredAgentName,
  readPackageVersion,
  readBuildInfo,
  createFileLogger,
  appendNotification,
  buildPendingTaskNotification,
  createStandardCognitivePipeline,
  LivenessWatchdog,
  emitLivenessLostSignal,
  isEagerWarmupEnabled,
  parseClaimSessionResponse,
  formatSessionClaimedLogLine,
  UNKNOWN_BUILD_INFO,
  type HubConfig,
  type FileLogger,
  type SharedDispatcher,
  type ToolDispatchContext,
  type HandshakeFatalError,
  type HandshakeResponse,
  type TelemetryEvent,
  type BuildInfo,
} from "@apnex/network-adapter";
import { buildPiNotificationHooks } from "./wake.js";
import { installFooter, type FooterController } from "./footer-install.js";
import { runSwarmPoll } from "./footer-poll.js";
import { SpecStore, ReconcileLoop } from "@apnex/network-adapter";
import { PiToolActuator } from "./hcap/tools/pi-tool-actuator.js";
import { HubSpecSource } from "./hcap/tools/hub-spec-source.js";
import { PiToolControlPlane } from "./hcap/tools/tool-control-plane.js";
import {
  CatalogHydrationController,
  type CatalogHydrationIdentity,
} from "./hcap/tools/catalog-hydration.js";
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

// ── Harness manifest (bug-266) ───────────────────────────────────────
// Per-harness config as schema-validated DATA (not hardcoded inline), loaded once
// fail-closed — mirrors the claude shim. toolPrefix "" = pi registers Hub tools RAW,
// so wake prompts name the bare tool (get_task, not architect-hub_get_task); the
// stale architect-hub prefix is retired here.
const MANIFEST = loadHarnessManifest(
  resolve(__shimDir, "..", "agent-adapter.manifest.json"),
);

// ── Module state ─────────────────────────────────────────────────────
let __fileLog: FileLogger | null = null;
let notificationLogPath = "";
let hubAdapter: McpAgentClient | null = null;
let config: HubConfig;
let reconciler: ToolSurfaceReconciler | null = null;
// L1.5 session-validity watchdog (default-off opt-in; OIS_LIVENESS_WATCHDOG_ENABLED=1).
// Constructed in connectAndSeed (its wedged-exit path needs `ctx`), stopped in
// shutdownSession. Null until enabled + connected.
let livenessWatchdog: LivenessWatchdog | null = null;
// HCAP tool-control-plane (mission-107). The reconciler above CLEAVES: it remains the
// Hub-revision DRIFT DETECTOR (its onDrift refreshes the spec + converges); the
// actuation / converge half is the HCAP stack below. `controlPlane.sync` converges the
// held declared spec (U1) onto pi's running active-set (U5); `hubSpecSource` refreshes
// the declared spec from the live Hub catalog. Both null until connect.
let controlPlane: PiToolControlPlane | null = null;
let hubSpecSource: HubSpecSource | null = null;
let catalogHydration: CatalogHydrationController | null = null;
// Set only by a successful synchronous claim_session on the exact current wire.
let claimedCatalogIdentity: CatalogHydrationIdentity | null = null;
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
    // Dynamic: returns false again on every reconnect/identity change. Existing
    // registered Hub definitions then fail loud instead of dispatching through a
    // stale or identity-less catalog.
    getReadiness: () => catalogHydration?.getReadiness() ?? {
      ready: false,
      reason: "catalog hydration controller is not initialized",
    },
    log,
  };
}

function getCurrentCatalogIdentity(): CatalogHydrationIdentity | null {
  const adapter = hubAdapter;
  const claimed = claimedCatalogIdentity;
  if (!adapter?.isConnected || !claimed) return null;
  const metrics = adapter.getMetrics();
  if (
    metrics.agentId !== claimed.agentId
    || metrics.wireGeneration !== claimed.wireGeneration
    || adapter.getSessionId() !== claimed.sessionId
  ) {
    return null;
  }
  return claimed;
}

function buildToolSurfaceReconciler(
  fetchLiveRevision: () => Promise<string | null>,
  readServedRevision: () => string | null,
  onDrift: () => void,
): ToolSurfaceReconciler {
  return new ToolSurfaceReconciler({
    fetchLiveRevision,
    // idea-465: pi has NO on-disk cache — the LEVEL is the CONSUMER's (HubSpecSource)
    // last-successfully-applied Hub revision, advanced only after a refresh SUCCEEDS.
    // A pure trigger: live !== served ⇒ re-emit ⇒ retry, so a failed refresh cannot
    // mask a stale surface as converged (the reconciler's emit-only branch).
    readServedRevision,
    consumerOwnedLevel: true,
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
    toolPrefix: MANIFEST.toolPrefix,
    ctx,
    footer,
  });

  const d = createSharedDispatcher({
    getAgent: () => hubAdapter,
    // bug-252: auto-retry a transient Hub-wire drop at the CallTool not-connected
    // pre-check (idempotency-safe; production opt-in — tests stay default-off).
    transientDropRetry: DEFAULT_TRANSIENT_DROP_RETRY,
    proxyVersion: PROXY_VERSION,
    serverName: MANIFEST.serverName,
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
        const catalogReady = catalogHydration?.getReadiness().ready === true;
        if (!catalogReady) {
          // A failed bootstrap/reconnect hydration remains level-triggered even
          // when the Hub revision did not change: retry against the current
          // claimed identity+wire generation until a nonempty catalog installs.
          await catalogHydration?.rehydrateCurrent("heartbeat-retry");
        } else {
          await reconciler?.reconcile("heartbeat");
          controlPlane?.sync("heartbeat");
        }
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

  // ── Claimed-session authority (bug-340 P0) ───────────────────────────
  // Pi's native catalog must never hydrate from an asserted-but-unclaimed identity.
  // The handshake callback below therefore claims synchronously on every wire
  // generation. OIS_EAGER_SESSION_CLAIM remains diagnostic; lazy mode is overridden
  // at this authority boundary rather than permitting identity-less list_tools.
  const eagerWarmup = isEagerWarmupEnabled(process.env);
  log(
    `[Handshake] Eager-warmup: ${eagerWarmup ? "ON (OIS_EAGER_SESSION_CLAIM=1)" : "OFF (lazy mode; Hub auto-claim on first SSE / first tools/call)"}`,
  );

  hubAdapter = new McpAgentClient(
    {
      role: config.role,
      labels: config.labels,
      logger: log,
      handshake: {
        name: agentName,
        proxyName: MANIFEST.proxyName,
        proxyVersion: PROXY_VERSION,
        transport: MANIFEST.transport,
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
        onHandshakeComplete: async (r: HandshakeResponse): Promise<void> => {
          // Every handshake invalidates prior catalog authority immediately. This
          // callback is awaited by McpAgentClient before state-sync (bug-340 P0).
          claimedCatalogIdentity = null;
          catalogHydration?.invalidate("handshake asserted a new identity/wire generation");
          log(`[Handshake] Identity asserted: ${r.agentId}`);

          const a = hubAdapter;
          if (!a) {
            throw new Error("claim_session aborted — hubAdapter null");
          }
          const before = a.getMetrics();
          const sessionId = a.getSessionId() ?? "";
          if (!sessionId || before.wireGeneration <= 0 || before.agentId !== r.agentId) {
            throw new Error(
              `claim_session refused for identity-less/currentness-mismatched wire (agent=${before.agentId ?? ""}, expected=${r.agentId}, sessionId=${sessionId}, wireGeneration=${before.wireGeneration})`,
            );
          }
          if (!eagerWarmup) {
            log("[Handshake] Lazy claim mode overridden for pi catalog authority — claiming current identity synchronously");
          }

          const wrapper = await a.call("claim_session", {}, { internal: true });
          const parsed = parseClaimSessionResponse(wrapper);
          log(formatSessionClaimedLogLine(parsed));
          const after = a.getMetrics();
          if (
            parsed.sessionClaimed !== true
            || parsed.agentId !== r.agentId
            || !Number.isInteger(parsed.sessionEpoch)
            || (parsed.sessionEpoch ?? 0) <= 0
            || after.wireGeneration !== before.wireGeneration
            || a.getSessionId() !== sessionId
            || after.agentId !== r.agentId
          ) {
            throw new Error(
              `claim_session did not establish current authority (claimed=${String(parsed.sessionClaimed)}, parsedAgent=${parsed.agentId ?? ""}, expectedAgent=${r.agentId}, epoch=${parsed.sessionEpoch ?? ""}, wireBefore=${before.wireGeneration}, wireAfter=${after.wireGeneration}, sessionCurrent=${a.getSessionId() ?? ""})`,
            );
          }
          claimedCatalogIdentity = {
            agentId: r.agentId,
            sessionId,
            sessionEpoch: parsed.sessionEpoch!,
            wireGeneration: before.wireGeneration,
          };
          log(
            `[Handshake] Catalog authority bound: agent=${r.agentId} epoch=${parsed.sessionEpoch} wireGeneration=${before.wireGeneration} sessionId=${sessionId}`,
          );
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
      // truthretr0: the kernel owns the middleware set AND the bypass.
      // This adapter supplies a telemetry sink and nothing else.
      cognitive: createStandardCognitivePipeline((event: TelemetryEvent) => {
        try {
          log(`[PiPluginTelemetry] ${JSON.stringify(event)}`);
        } catch {
          /* never disturb the tool-call loop */
        }
      }),
    },
  );

  // ── HCAP tool-control-plane (mission-107) ────────────────────────────
  // The 6-unit converge stack. U5 (the port) is the SOLE ExtensionAPI crossing;
  // U1-U4 + U6 are pi-neutral. The additive `seedToolSurface` UNION is GONE:
  // converge = registerTool(ALL declared, KF2) + setActiveTools(EXACT enabled subset
  // ∪ preserved built-ins) — one authoritative REPLACE that both ADDS and REMOVES
  // (removal = set-subtraction; pi has no deregister). One store instance is shared
  // by the loop (reads it) and the facade (writes it).
  // idea-465: one /health revision fetcher, shared by the reconciler (its live-level)
  // and HubSpecSource (its applied-revision latch, advanced only on refresh-success).
  const fetchLiveRevision = makeFetchLiveToolSurfaceRevision({
    hubUrl: config.hubUrl,
    log,
  });
  const actuatorPort = new PiToolActuator(pi, dispatchCtx);
  const store = new SpecStore();
  const specLoop = new ReconcileLoop({ store, actuator: actuatorPort }, { log });
  const plane = new PiToolControlPlane({ store, loop: specLoop, port: actuatorPort });
  const source = new HubSpecSource({
    // U6 fetches the live LLM-facing catalog (core-hydrated); the KF1(b) zero-tool
    // poison guard lives inside refreshFromHub, not here.
    fetchCatalog: async () => (hubAdapter ? hubAdapter.listTools() : []),
    // idea-465: the same /health revision fetcher feeds the applied-revision latch,
    // advanced only after a successful applyConfig inside refreshFromHub.
    fetchLiveRevision,
    controlPlane: plane,
    log,
  });
  const hydration = new CatalogHydrationController({
    getCurrentIdentity: getCurrentCatalogIdentity,
    source,
    controlPlane: plane,
    log,
  });
  controlPlane = plane;
  hubSpecSource = source;
  catalogHydration = hydration;

  // Preserve all shared dispatcher callbacks, adding the catalog authority
  // lifecycle. Any non-streaming transition makes readiness false immediately;
  // streaming triggers an exact current-identity/current-wire rehydrate.
  const baseCallbacks = d.callbacks;
  hubAdapter.setCallbacks({
    ...baseCallbacks,
    onStateChange: (state, previous, reason) => {
      baseCallbacks.onStateChange?.(state, previous, reason);
      if (state === "streaming") {
        void hydration.rehydrateCurrent(previous === "connecting" ? "initial-streaming" : "reconnect-streaming")
          .then((ready) => {
            if (!ready) {
              try {
                ctx.ui.notify("Hub connected, but native tool catalog is NOT READY — automatic retry active", "error");
              } catch {
                /* UI not ready */
              }
            }
          })
          .catch((err) => log(`[catalog-hydration] streaming refresh failed: ${err}`));
      } else {
        claimedCatalogIdentity = null;
        hydration.invalidate(`session ${previous} → ${state}${reason ? ` (${reason})` : ""}`);
      }
    },
  });

  // Reconciler drift (L3) uses the SAME identity-keyed single-flight as reconnect.
  // A failed refresh leaves source.lastAppliedRevision behind and readiness false,
  // so the heartbeat retries even if the live revision later remains constant.
  reconciler = buildToolSurfaceReconciler(
    fetchLiveRevision,
    () => source.getLastAppliedRevision(),
    () => {
      void hydration
        .rehydrateCurrent("revision-drift")
        .catch((err) => log(`[hcap] drift hydration failed (non-fatal, retry armed): ${err}`));
      try {
        ctx.ui.notify("Hub tools updated — authoritative rehydrate in progress", "info");
      } catch {
        /* UI not ready */
      }
    },
  );

  await hubAdapter.start();
  log("Connected to remote Hub via McpAgentClient (pi native binding)");

  assertHostWiringComplete(d, log);
  d.pollBackstop?.start(() => hubAdapter);

  // ── L1.5 liveness self-watchdog (M-Adapter-Modernization P1c; opt-in) ──
  // DEFAULT-OFF (OIS_LIVENESS_WATCHDOG_ENABLED=1). A proactive session-validity probe;
  // on a bounded budget of SUSTAINED probe failures it emits the wedged-restart sentinel
  // then requests pi's OWN graceful exit via ctx.shutdown() — NOT process.exit(1). pi runs
  // the plugin IN-PROCESS (unlike claude's grandchild shim, whose exit code the CLI
  // swallows), so ctx.shutdown() is the correct wedged-exit, mirroring onFatalHalt. The
  // full container-supervisor watchdog redesign is DEFERRED (backport_synthesis).
  if (process.env.OIS_LIVENESS_WATCHDOG_ENABLED === "1") {
    const probeIntervalMs = Number(process.env.OIS_LIVENESS_PROBE_INTERVAL_MS) || 60_000;
    const failureBudget = Number(process.env.OIS_LIVENESS_FAILURE_BUDGET) || 3;
    const probeMethod = process.env.OIS_LIVENESS_PROBE_METHOD || "get_agents";
    const watchdog = new LivenessWatchdog({
      probeIntervalMs,
      failureBudget,
      log,
      probe: async () => {
        const a = hubAdapter;
        if (!a) return false;
        try {
          await a.call(probeMethod, {}, { internal: true, probe: true });
          return true;
        } catch {
          return false;
        }
      },
      onLivenessLost: (info) => {
        // Emit the durable wedge sentinel FIRST (best-effort, never throws out), THEN
        // exit — the sentinel must be on disk before the process goes away.
        emitLivenessLostSignal({
          consecutiveFailures: info.consecutiveFailures,
          lastError: info.lastError,
          log,
        });
        log("[LivenessWatchdog] session wedged + unrecoverable — requesting pi graceful shutdown");
        try {
          ctx.ui.notify("Hub session wedged — restarting", "error");
        } catch {
          /* UI not ready */
        }
        ctx.shutdown();
      },
    });
    watchdog.start();
    livenessWatchdog = watchdog;
    log(`[LivenessWatchdog] ENABLED — probe '${probeMethod}' every ${probeIntervalMs}ms, budget ${failureBudget}`);
  } else {
    log("[LivenessWatchdog] disabled (default; set OIS_LIVENESS_WATCHDOG_ENABLED=1 once a supervisor is in place)");
  }

  // Initial state transition may already have started hydration. Join that exact
  // identity+wire single-flight; never perform a free-floating list_tools call.
  const catalogReady = await hydration.rehydrateCurrent("bootstrap-join");
  if (!catalogReady) {
    log("[pi-plugin] Hub session streaming but native catalog NOT READY — no empty/identity-less catalog published; heartbeat retry armed");
  } else {
    // Baseline the revision detector only after a nonempty authoritative install.
    await reconciler.reconcile("identityReady");
  }
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
  claimedCatalogIdentity = null;
  catalogHydration?.invalidate("session shutdown");
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
    livenessWatchdog?.stop();
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
  controlPlane = null;
  hubSpecSource = null;
  catalogHydration = null;
  dispatcher = null;
  livenessWatchdog = null;
  started = false;
}

// Test-only surface.
export const _testOnly = {
  isLlmErrorMessageEnd,
  getHubAdapter: () => hubAdapter,
  getDispatcher: () => dispatcher,
  getCatalogReadiness: () => catalogHydration?.getReadiness() ?? null,
  getClaimedCatalogIdentity: () => claimedCatalogIdentity,
  buildDispatchContext,
  buildToolSurfaceReconciler,
  setHubAdapter: (a: McpAgentClient | null) => {
    hubAdapter = a;
  },
};
