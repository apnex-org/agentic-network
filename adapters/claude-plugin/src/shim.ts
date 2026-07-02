/**
 * shim.ts — Claude Code ↔ Hub last-mile shim (platform entry).
 *
 * Claude-specific wiring only: stdio transport, config loading, process
 * lifecycle, and `<channel>` render-surface. The MCP-boundary handler
 * factory + pendingActionMap + tool-catalog cache + session-claim
 * helpers all live in `@apnex/network-adapter` (Layer 1c per Design v1.2).
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  McpAgentClient,
  appendNotification,
  buildPendingTaskNotification,
  readRequiredAgentName,
  loadConfig,
  readPackageVersion,
  readBuildInfo,
  UNKNOWN_BUILD_INFO,
  buildPromptText,
  makeStdioFatalHalt,
  createSharedDispatcher,
  assertHostWiringComplete,
  isCacheValid,
  readCache,
  writeCache,
  ToolSurfaceReconciler,
  makeFetchLiveToolSurfaceRevision,
  isEagerWarmupEnabled,
  parseClaimSessionResponse,
  formatSessionClaimedLogLine,
  LivenessWatchdog,
  emitLivenessLostSignal,
  loadHarnessManifest,
  serverCapabilitiesFromManifest,
  type AgentEvent,
  type DrainedPendingAction,
  type HandshakeResponse,
  type SharedDispatcher,
  type TelemetryEvent,
  type ILogger,
  type LogFields,
} from "@apnex/network-adapter";
import { CognitivePipeline } from "@apnex/cognitive-layer";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { isPulseEvent } from "./source-attribute.js";
import {
  pushChannelNotification,
  surfacePendingActionItem,
} from "./notification-surface.js";

// ── Configuration ───────────────────────────────────────────────────

// idea-355 SLICE-1 single-home: HubConfig + parseLabels + loadConfig hoisted to
// the kernel (@apnex/network-adapter). The shim injects its host specifics (the
// WORK_DIR/cwd directory + the console.error warn sink) and keeps only the
// last-mile credential abort (claude can process.exit; opencode can't).
const config = loadConfig({
  directory: process.env.WORK_DIR || process.cwd(),
  warn: (m) => console.error(m),
});
if (!config.hubUrl || !config.hubToken) {
  console.error(
    "ERROR: Hub credentials not found. Checked .ois/adapter-config.json and OIS_HUB_URL/OIS_HUB_TOKEN env vars",
  );
  process.exit(1);
}
const WORK_DIR = process.env.WORK_DIR || process.cwd();
const LOG_FILE = join(WORK_DIR, ".ois", "claude-notifications.log");
const SHUTDOWN_TIMEOUT_MS = 3000;

// mission-66 #40 closure: version-source-of-truth consolidation.
// PROXY_VERSION reads claude-plugin/package.json; SDK_VERSION reads
// @apnex/network-adapter/package.json. Pre-mission-66 these were
// hardcoded ("1.2.0" + "@apnex/network-adapter@2.1.0") and drifted
// from the npm package.json values (0.1.4 + 0.1.2 respectively).
// Hub-side canonical projection (deriveAdvisoryTags) surfaces these via
// advisoryTags.sdkVersion (kernel) + shimVersion (this plugin) to all
// consumers (idea-355 SLICE-4 retired the old mislabeled adapterVersion key).
const __shimDir = dirname(fileURLToPath(import.meta.url));
const __require = createRequire(import.meta.url);

// readPackageVersion / readBuildInfo / BuildInfo hoisted to the kernel
// (@apnex/network-adapter) in idea-355 SLICE-1. The shim keeps only its
// host-specific path resolution + the derived version/build-info constants.
const CLAUDE_PLUGIN_PKG_VERSION = readPackageVersion(
  resolve(__shimDir, "..", "package.json"),
  "unknown",
);
const NETWORK_ADAPTER_PKG_VERSION = (() => {
  try {
    return readPackageVersion(__require.resolve("@apnex/network-adapter/package.json"), "unknown");
  } catch {
    return "unknown";
  }
})();
const PROXY_VERSION = CLAUDE_PLUGIN_PKG_VERSION;
const SDK_VERSION = `@apnex/network-adapter@${NETWORK_ADAPTER_PKG_VERSION}`;

// M-Adapter-Modernization P1b: the per-harness STANDARD config (proxyName /
// transport / serverName / tool-prefix / injection-mechanism / the 3-valued
// capability-matrix / auth-order / env-template) is single-homed as a schema-
// validated, versioned JSON manifest at the plugin root. Loaded fail-closed —
// a missing/malformed manifest must NOT boot a mis-shaped adapter. Per-agent
// INSTANCE values stay in ENV (the manifest carries only var NAMES, so it can
// never hold a raw secret).
const MANIFEST = loadHarnessManifest(resolve(__shimDir, "..", "agent-adapter.manifest.json"));

// M-Build-Identity-AdvisoryTag (idea-256): code-identity source-of-truth.
// Each package's prepack hook (scripts/build/write-build-info.js) writes
// dist/build-info.json at pack-time; shim reads both at startup and emits
// via the existing mission-66 #40 wire-pattern (clientMetadata propagation
// → Hub deriveAdvisoryTags projection → AgentAdvisoryTags). Surfaces in
// get-agents as SHIM_COMMIT + ADAPTER_COMMIT columns.
const PROXY_BUILD_INFO = readBuildInfo(resolve(__shimDir, "build-info.json"));
const SDK_BUILD_INFO = (() => {
  try {
    return readBuildInfo(
      __require.resolve("@apnex/network-adapter/dist/build-info.json"),
    );
  } catch {
    return UNKNOWN_BUILD_INFO;
  }
})();

// OIS_COGNITIVE_BYPASS=1 → pass cognitive=undefined to McpAgentClient.
// Operator-facing kill-switch for the cognitive pipeline; mcp-agent-client
// takes the legacy passthrough (rawCall directly) when cognitive is unset.
// Diagnostic surface for cognitive-layer triage; per-middleware opt-out
// follow-on tracked separately.
const COGNITIVE_BYPASS = process.env.OIS_COGNITIVE_BYPASS === "1";

// ── Telemetry sinks (stderr + file + ndjson events) ─────────────────
//
// P0 triage 2026-04-28 — shim observability gap surfaced during mission-62
// W4 dogfood. Phase 1 implementation: durable file sinks for the existing
// stderr-only log path + structured ILogger emissions to NDJSON. Formal
// observability contract + rotation policy + level filter follow in Phase 2
// (idea-219). Per Director-approved architect-direct exception until greg
// online.
const SHIM_LOG_FILE = process.env.OIS_SHIM_LOG_FILE || join(WORK_DIR, ".ois", "shim.log");
const SHIM_EVENTS_FILE = process.env.OIS_SHIM_EVENTS_FILE || join(WORK_DIR, ".ois", "shim-events.ndjson");
const SHIM_LOG_ROTATE_BYTES = Number(process.env.OIS_SHIM_LOG_ROTATE_BYTES) || 10 * 1024 * 1024;

// mission-66 commit 4: redaction + log-level helpers extracted for unit-test
// tractability (shim.ts module init has a process.exit(1) side effect via
// loadConfig()). idea-355 SLICE-1: the file-backed logger (NDJSON + text +
// stderr fan-out, rotation, redaction, level-filter) is hoisted to the kernel
// `createFileLogger`. The shim injects only its file paths + format choices.
import { parseLogLevel, createFileLogger, type LogLevel } from "@apnex/network-adapter";
const SHIM_LOG_LEVEL: LogLevel = parseLogLevel(process.env.OIS_SHIM_LOG_LEVEL);

const __fileLog = createFileLogger({
  textFile: SHIM_LOG_FILE,
  eventsFile: SHIM_EVENTS_FILE,
  rotateBytes: SHIM_LOG_ROTATE_BYTES,
  mirrorToStderr: true,
  logLevel: SHIM_LOG_LEVEL,
  pid: process.pid,
  bound: { pid: process.pid, role: config.role },
});

// Standalone text + structured-event sinks. Function declarations (not const)
// preserve hoisting for the many call sites that precede this definition.
function log(msg: string): void {
  __fileLog.log(msg);
}
function appendEvent(event: string, fields: LogFields, message?: string): void {
  __fileLog.appendEvent(event, fields, message);
}
const eventsLogger: ILogger = __fileLog.logger;

// ── Render-surface: Claude `<channel>` notification injection ───────
//
// `pushChannelNotification` + `surfacePendingActionItem` moved to
// `./notification-surface.ts` (bug-108) so the surfacing is importable +
// test-drivable. `appendActionableLog` is the live-path diagnostic log
// mirror — kept here alongside its `onActionableEvent` call sites.

function appendActionableLog(event: AgentEvent, action: string): void {
  appendNotification(
    { event: event.event, data: event.data, action },
    { logPath: LOG_FILE, mirror: (block) => process.stderr.write(block) },
  );
}

// ── Graceful Shutdown ───────────────────────────────────────────────

let agent: McpAgentClient | null = null;
// bug-53: module-scoped pollBackstop reference so shutdown() can stop the
// timers cleanly (the inner main() dispatcherRef is function-scoped and
// not visible here).
let shutdownPollBackstop: (() => void) | null = null;
// L1.5 liveness watchdog stop-callback (set in main() when the watchdog is
// enabled; called by shutdown() to release its probe timer cleanly).
let shutdownLivenessWatchdog: (() => void) | null = null;
let shuttingDown = false;

async function shutdown(reason?: "signal_term" | "signal_int" | "internal_error"): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log("Shutting down...");
  // mission-66 commit 4: canonical shim.lifecycle.shim_stopping event
  // per ADR-031 §1 + spec §4.7. Pid + reason (optional enum).
  appendEvent("shim.lifecycle.shim_stopping", {
    pid: process.pid,
    ...(reason ? { reason } : {}),
  });
  const timeout = setTimeout(() => {
    log("Shutdown timeout — force exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  try {
    // bug-53: stop pollBackstop timers before tearing down the agent so
    // tickHeartbeat doesn't race with agent.stop() / try to call against
    // a torn-down stream.
    shutdownPollBackstop?.();
    shutdownLivenessWatchdog?.();
    if (agent) await agent.stop();
  } catch (err) {
    log(`Shutdown error: ${err}`);
  }
  clearTimeout(timeout);
  log("Clean shutdown complete");
  process.exit(0);
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log("=== Claude Plugin Agent Adapter starting ===");
  log(`Hub: ${config.hubUrl}`);
  log(`Role: ${config.role}`);
  log(`Notifications log: ${LOG_FILE}`);
  log(`Shim text log: ${SHIM_LOG_FILE}`);
  log(`Shim events log: ${SHIM_EVENTS_FILE}`);
  log(`Cognitive: ${COGNITIVE_BYPASS ? "BYPASS (OIS_COGNITIVE_BYPASS=1; legacy passthrough)" : "ON (standard pipeline)"}`);
  // mission-66 commit 4: canonical event taxonomy v1 (ADR-031 §1; per
  // docs/specs/shim-observability-events.md §4.6 shim.lifecycle.shim_started).
  // Renames Phase 1 ad-hoc `shim.startup` to canonical name; required fields
  // per §4.6: pid + proxyVersion + nodeVersion. Operational fields
  // (hubUrl, role, cognitiveBypass, eagerWarmup, sdkVersion) ride along
  // as optional context — permissive in v1 namespace per §6.1.
  appendEvent("shim.lifecycle.shim_started", {
    pid: process.pid,
    proxyVersion: PROXY_VERSION,
    nodeVersion: process.versions.node,
    sdkVersion: SDK_VERSION,
    hubUrl: config.hubUrl,
    role: config.role,
    cognitiveBypass: COGNITIVE_BYPASS,
    eagerWarmup: isEagerWarmupEnabled(process.env),
    // M-Build-Identity-AdvisoryTag (idea-256): build-identity in startup tele
    proxyCommitSha: PROXY_BUILD_INFO.commitSha,
    proxyDirty: PROXY_BUILD_INFO.dirty,
    proxyBuildTime: PROXY_BUILD_INFO.buildTime,
    proxyBranch: PROXY_BUILD_INFO.branch,
    sdkCommitSha: SDK_BUILD_INFO.commitSha,
    sdkDirty: SDK_BUILD_INFO.dirty,
    sdkBuildTime: SDK_BUILD_INFO.buildTime,
    sdkBranch: SDK_BUILD_INFO.branch,
  });

  // idea-251 D-prime Phase 2 identity (hoisted to the kernel in idea-355
  // SLICE-1). The shim keeps only its host-specific abort: claude can
  // process.exit on misconfiguration.
  const agentName = readRequiredAgentName(log);
  if (!agentName) process.exit(2);

  const fatalHalt = makeStdioFatalHalt(log);

  if (config.labels) {
    log(`Labels: ${JSON.stringify(config.labels)}`);
  }

  // Dispatcher-first wiring: the shared dispatcher owns the MCP server
  // factory + captured clientInfo + pendingActionMap. The agent receives
  // dispatcher.getClientInfo as its handshake callback so clientInfo
  // flows through whenever it's captured from Claude Code.
  let dispatcherRef: SharedDispatcher | null = null;
  let mcpServer: Server | null = null;
  // bug-180 — tool-surface live-refresh reconciler. Assigned once mcpServer
  // exists (post-createMcpServer); referenced lazily by the identityReady (L1)
  // trigger + the PollBackstop heartbeat (L2) closure.
  let reconciler: ToolSurfaceReconciler | null = null;
  // idea-355 §4.3 — the queue wake/stall reconcile (trackers + reconcile body +
  // the W2 observer) is now kernel-internal in the dispatcher; the shim wires
  // none of it. This shim keeps only its host-coupled bug-180 live-refresh.
  const getClientInfo = () =>
    dispatcherRef ? dispatcherRef.getClientInfo() : { name: "unknown", version: "0.0.0" };

  const eagerWarmup = isEagerWarmupEnabled(process.env);
  log(
    `[Handshake] Eager-warmup: ${eagerWarmup ? "ON (OIS_EAGER_SESSION_CLAIM=1)" : "OFF (lazy mode; Hub will auto-claim on first SSE / first tools/call)"}`,
  );

  // Three-phase ready signal.
  //
  //   identityReady — resolves when register_role returns (transport
  //     connected + identity asserted). ~500ms typical. Sync-readable
  //     via identityReadyResolved flag; consumed by dispatcher's
  //     probe-safe cache fallback to skip the early-return path once
  //     identity has resolved.
  //
  //   sessionReady — resolves when:
  //     (a) eager mode: claim_session MCP tool returns
  //     (b) lazy mode: identityReady resolves (Hub auto-claims server-side
  //         when first SSE-subscribe or first-tools/call fires)
  //     Gates CallTool so tool dispatch waits until the session is
  //     either explicitly claimed or known-claim-eligible.
  //
  //   syncReady — resolves when full agent.start() returns (handshake +
  //     runSynchronizingPhase + initial drain). Multi-second for
  //     architects with non-empty pending-action queues. Gates ListTools
  //     (bug-141 pass-2 fix 2026-05-28): the prior `listToolsGate:
  //     identityReady` wiring opened the gate before the McpAgentClient
  //     reached `streaming` state (agent.isConnected=true), so the
  //     dispatcher's `isUsableAgent` check inside the bootstrap-path
  //     retry loop kept failing for ~1.3s — exhausting the 4×200ms
  //     retry budget and surfacing structured McpError to the host
  //     instead of returning the catalog. Gating on syncReady ensures
  //     the agent is fully usable before ListTools fires; on probe-
  //     path (`!identityReady`) the cache fallback still serves
  //     instantly without waiting on syncReady.

  let resolveIdentityReady!: () => void;
  let rejectIdentityReady!: (err: unknown) => void;
  const identityReady = new Promise<void>((resolve, reject) => {
    resolveIdentityReady = resolve;
    rejectIdentityReady = reject;
  });
  identityReady.catch(() => { /* observed by ListTools; main()'s catch handles fatal */ });

  let resolveSessionReady!: () => void;
  let rejectSessionReady!: (err: unknown) => void;
  const sessionReady = new Promise<void>((resolve, reject) => {
    resolveSessionReady = resolve;
    rejectSessionReady = reject;
  });
  sessionReady.catch(() => { /* observed by CallTool; main()'s catch handles fatal */ });

  let resolveSyncReady!: () => void;
  let rejectSyncReady!: (err: unknown) => void;
  const syncReady = new Promise<void>((resolve, reject) => {
    resolveSyncReady = resolve;
    rejectSyncReady = reject;
  });
  syncReady.catch(() => { /* informational; not currently used to gate */ });

  // identityReady-resolved flag (sync-readable for the dispatcher's
  // cache fallback to peek without awaiting). Set on the same microtask
  // as identityReady resolves — no spinning, no race.
  let identityReadyResolved = false;
  identityReady.then(() => { identityReadyResolved = true; }).catch(() => { /* observed by gate */ });

  // bug-114 — tool-catalog cache invalidation source. Fetch /health once
  // at startup in the background; cache the Hub's tool-surface revision
  // (an opaque ETag) in-memory. Probes that fire before the fetch
  // completes get `null` and trust the cache (probe-friendly default per
  // tool-catalog-cache.isCacheValid). The `version` field is logged as a
  // diagnostic only — no longer load-bearing for cache correctness.
  let cachedToolSurfaceRevision: string | null = null;

  // bug-114 + bug-180 — resolve the Hub's live tool-surface revision from
  // /health. The network mechanism (URL derivation + fetch + field extraction)
  // is single-homed in the kernel `makeFetchLiveToolSurfaceRevision` (idea-355
  // SLICE-1T); this shim wrapper keeps ONLY its host side-effect: updating the
  // in-memory `cachedToolSurfaceRevision` (the probe-path invalidation key
  // consumed by getCurrentToolSurfaceRevision + persistCatalog) on a non-null
  // result. Returns the live revision, or null when the fetch fails or the Hub
  // doesn't report the field — the bug-180 reconciler treats null as "unknown,
  // trust the cache" and never emits a spurious list_changed.
  const __fetchLiveRev = makeFetchLiveToolSurfaceRevision({
    hubUrl: config.hubUrl,
    log,
  });
  const fetchLiveToolSurfaceRevision = async (): Promise<string | null> => {
    const rev = await __fetchLiveRev();
    if (rev !== null) cachedToolSurfaceRevision = rev;
    return rev;
  };

  // Warm the probe-path invalidation key once at startup in the background;
  // the reconciler awaits a definitive fetch at its own L1/L2 trigger points.
  void fetchLiveToolSurfaceRevision();

  agent = new McpAgentClient(
    {
      role: config.role,
      labels: config.labels,
      logger: eventsLogger,
      handshake: {
        // idea-251 D-prime Phase 2: name IS identity (was globalInstanceId).
        // agentName loaded + validated at top of bootstrap; never undefined here.
        name: agentName,
        proxyName: MANIFEST.proxyName,
        proxyVersion: PROXY_VERSION,
        transport: MANIFEST.transport,
        sdkVersion: SDK_VERSION,
        // M-Build-Identity-AdvisoryTag (idea-256): build-identity flows
        // via clientMetadata → Hub deriveAdvisoryTags → AgentAdvisoryTags.
        proxyCommitSha: PROXY_BUILD_INFO.commitSha,
        proxyDirty: PROXY_BUILD_INFO.dirty,
        sdkCommitSha: SDK_BUILD_INFO.commitSha,
        sdkDirty: SDK_BUILD_INFO.dirty,
        getClientInfo,
        llmModel: process.env.HUB_LLM_MODEL,
        onFatalHalt: fatalHalt,
        onHandshakeComplete: (r: HandshakeResponse) => {
          log(`[Handshake] Identity asserted: ${r.agentId}`);
          resolveIdentityReady();
          // Lazy-claim semantics: lazy mode resolves sessionReady
          // immediately (Hub-side auto-claim handles the actual claim);
          // eager mode kicks off claim_session synchronously and
          // resolves sessionReady only on success.
          if (eagerWarmup) {
            const a = agent;
            if (!a) {
              log("[Handshake] Eager claim_session aborted — agent reference null (should be impossible)");
              rejectSessionReady(new Error("eager claim_session: agent reference null"));
              return;
            }
            a.call("claim_session", {})
              .then((wrapper) => {
                const parsed = parseClaimSessionResponse(wrapper);
                log(formatSessionClaimedLogLine(parsed));
                resolveSessionReady();
              })
              .catch((err) => {
                log(`[Handshake] Eager claim_session failed: ${err}`);
                rejectSessionReady(err);
              });
          } else {
            log("[Handshake] Session claim deferred (lazy mode; Hub auto-claim on first SSE-subscribe / first-tools/call)");
            resolveSessionReady();
          }
        },
        onPendingTask: (task) => {
          appendNotification(buildPendingTaskNotification(task), {
            logPath: LOG_FILE,
            mirror: (block) => process.stderr.write(block),
          });
        },
        onPendingActionItem: (item) => {
          if (dispatcherRef) {
            dispatcherRef.makePendingActionItemHandler({
              // bug-108: a reconnect-drained pending action arrived while
              // the wire was down — it MUST wake the session, not just hit
              // the diagnostic log. surfacePendingActionItem mirrors the
              // live onActionableEvent path: diagnostic log + the
              // notifications/claude/channel actionable wake.
              onPendingActionItem: (drained) =>
                surfacePendingActionItem(
                  {
                    server: mcpServer,
                    logPath: LOG_FILE,
                    log,
                    mirror: (block) => process.stderr.write(block),
                  },
                  drained,
                ),
            })(item);
          }
        },
      },
    },
    {
      transportConfig: {
        url: config.hubUrl,
        token: config.hubToken,
      },
      cognitive: COGNITIVE_BYPASS
        ? undefined
        : CognitivePipeline.standard({
            telemetry: {
              sink: (event: TelemetryEvent) => {
                try {
                  // Mirror to text log (existing behaviour) + structured
                  // events file (Phase 1 obs; richer than the rendered
                  // string for downstream telemetry pipelines).
                  log(`[ClaudePluginTelemetry] ${JSON.stringify(event)}`);
                  appendEvent(
                    "cognitive.telemetry",
                    event as unknown as LogFields,
                  );
                } catch {
                  /* never disturb the tool-call loop */
                }
              },
            },
          }),
    },
  );

  const dispatcher = createSharedDispatcher({
    getAgent: () => agent,
    proxyVersion: PROXY_VERSION,
    serverName: MANIFEST.serverName,
    serverCapabilities: serverCapabilitiesFromManifest(MANIFEST),
    log,
    listToolsGate: syncReady,
    callToolGate: sessionReady,
    getCachedCatalog: () => readCache(WORK_DIR, log),
    getIsIdentityReady: () => identityReadyResolved,
    getCurrentToolSurfaceRevision: () => cachedToolSurfaceRevision,
    isCacheValid,
    persistCatalog: (catalog) => {
      // Best-effort persist. Skip if we don't yet have a tool-surface
      // revision to tag — better to let the next live-fetch (with the
      // revision known) populate the cache than write a revision-less
      // entry.
      if (cachedToolSurfaceRevision === null) {
        log("[Cache] Skipping persistCatalog — tool-surface revision not yet resolved");
        return;
      }
      writeCache(WORK_DIR, catalog, cachedToolSurfaceRevision, log);
    },
    notificationHooks: {
      onActionableEvent: (event) => {
        appendActionableLog(event, buildPromptText(event.event, event.data, { toolPrefix: MANIFEST.toolPrefix }));
        // Mission-57 W3: pulse Messages downgrade level from "actionable"
        // to "informational" (S3 mitigation per Design v1.0 §4 — pulse-
        // noise reduction during high-activity sub-PR cascades).
        // Detection: eventType `message_arrived` + payload.pulseKind ∈
        // {status_check, missed_threshold_escalation}.
        const level = isPulseEvent(event.event, event.data) ? "informational" : "actionable";
        pushChannelNotification(mcpServer, event, level, log);
      },
      onInformationalEvent: (event) => {
        // Informational events log only — `<channel>` push would otherwise
        // wake the LLM. Diagnostic-only routing.
        appendActionableLog(event, `[INFO] ${buildPromptText(event.event, event.data, { toolPrefix: MANIFEST.toolPrefix })}`);
      },
    },
    // bug-53: opt into pollBackstop heartbeat-second-timer so transport_heartbeat
    // fires periodically (mission-75 §3.3 substrate). Env vars
    // (TRANSPORT_HEARTBEAT_INTERVAL_MS / _ENABLED) plumbed through PollBackstop's
    // constructor.
    // bug-103: firstTimerEnabled re-enabled — the list_messages Pull-mode
    // first-timer is the catch-up path that recovers role-targeted kind:note
    // notifications missed while the adapter was disconnected. SSE inline
    // delivers only to a connected recipient; offline → the note is lost
    // without this poll. `role` (config.role) is the poll's targetRole filter.
    // idea-355 §4.3 — the idea-353 W2 lease observer is now kernel-internal in
    // the dispatcher (onToolCallResult site), so this shim no longer wires it.
    pollBackstop: {
      role: config.role,
      firstTimerEnabled: true,
      log,
      // bug-180 L2 — tool-surface revision-poll backstop on the heartbeat
      // cadence. The kernel drives this host hook off the tick (idea-355 §4.3,
      // isolated in its own try/catch) ALONGSIDE the now-kernel-internal queue
      // wake/stall reconcile — so the shim provides only the host-coupled
      // live-refresh (mcpServer.sendToolListChanged), not the wake/stall wiring.
      // Lazy `reconciler` ref (assigned once mcpServer exists, below); the first
      // tick fires ≥1 interval after start() so it is always populated.
      onHeartbeatTick: async () => {
        await reconciler?.reconcile("heartbeat");
      },
    },
  });
  dispatcherRef = dispatcher;

  agent.setCallbacks(dispatcher.callbacks);

  // Open stdio FIRST so the host's MCP `initialize` request is ACKed
  // within its timeout, then run the Hub handshake.
  const transport = new StdioServerTransport();
  transport.onclose = () => {
    shutdown();
  };
  mcpServer = dispatcher.createMcpServer();
  await mcpServer.connect(transport);
  log("MCP stdio server ready — Claude Code can call initialize/listTools/callTool");

  // bug-180 — tool-surface live-refresh reconciler. Now that mcpServer exists
  // we can emit notifications/tools/list_changed on drift. The reconciler
  // baselines off the on-disk cache (what the pre-identity probe served) and
  // emits when the live /health revision diverges from it.
  const liveReconciler = new ToolSurfaceReconciler({
    fetchLiveRevision: fetchLiveToolSurfaceRevision,
    readServedRevision: () => readCache(WORK_DIR, log)?.toolSurfaceRevision ?? null,
    emitListChanged: () => {
      void mcpServer?.sendToolListChanged();
      log("[ToolSurface] notifications/tools/list_changed emitted — host will re-enumerate");
    },
    log,
  });
  reconciler = liveReconciler;

  // idea-355 §4.3 — the queue wake/stall reconcile (W1 inbound digest + W2
  // outbound stall-prompt + W3 status seam) + its trackers + the W2 lease
  // observer are now kernel-internal in the dispatcher, driven off the same
  // heartbeat tick as the bug-180 live-refresh below. The shim wires none of it;
  // the kernel emits through notificationHooks.onActionableEvent → this shim's
  // pushChannelNotification, so the surface is unchanged.

  // bug-180 L1 (primary) — reconcile on identityReady. Once identity resolves
  // the live revision is fetchable + the dispatcher serves the live surface
  // (probe-cache path is skipped), so re-enumeration after the emit lands the
  // current tool set. Covers the redeploy-then-reconnect case that caused
  // bug-180 — no manual cache-delete, no restart. identityReadyResolved is set
  // on an earlier-registered .then, so the dispatcher already serves live by
  // the time the host re-calls tools/list.
  identityReady
    .then(() => liveReconciler.reconcile("identityReady"))
    .catch(() => { /* identityReady rejection handled by main()'s catch */ });

  try {
    await agent.start();
    resolveSyncReady();
    log("Hub connection established (full sync done)");

    // bug-53: §6.4-equivalent gate — fail-fast at boot if pollBackstop wiring
    // is missing (would otherwise silently freeze lastHeartbeatAt at adapter-
    // startup, taking ~96 minutes to surface clinically per the original
    // bug-53 evidence). TRANSPORT_HEARTBEAT_ENABLED=false is the explicit
    // opt-out path.
    assertHostWiringComplete(dispatcher, log);

    // bug-53: now that handshake completed and agent is in 'streaming' state,
    // start the pollBackstop heartbeat timer (and first-timer if opted in).
    // Idempotent — duplicate start() calls are no-ops.
    dispatcher.pollBackstop?.start(() => agent);
    // bug-53: register stop-callback so shutdown() can clean up timers.
    shutdownPollBackstop = () => dispatcher.pollBackstop?.stop();

    // ── L1.5 liveness self-watchdog (M-Adapter-Modernization P1c, Design §4) ──
    //
    // Closes the keepalives-flowing-but-session-dead wedge: a PROACTIVE periodic
    // session-validity probe (a real session-requiring call, INDEPENDENT of the
    // transport keepalive). The probe surfaces an otherwise-idle dead session ->
    // L1's session_invalid->reconnect heals it when recoverable; only on a bounded
    // budget of SUSTAINED failures (L1 could not recover) does the watchdog emit the
    // wedged-restart sentinel + self-exit -> P1e's PID-1 supervisor consumes the
    // sentinel -> container-exit -> docker-L2 restart -> fresh re-handshake/re-claim.
    //
    // DEFAULT-OFF (opt-in OIS_LIVENESS_WATCHDOG_ENABLED=1). RATIONALE (fail-safe): a
    // self-exit WITHOUT P1e's supervisor would kill the adapter with NO container
    // restart — worse than the wedge (a wedged adapter at least holds its session).
    // Enable only once P1e's supervisor + container can consume the sentinel.
    if (process.env.OIS_LIVENESS_WATCHDOG_ENABLED === "1") {
      const probeIntervalMs = Number(process.env.OIS_LIVENESS_PROBE_INTERVAL_MS) || 60_000;
      const failureBudget = Number(process.env.OIS_LIVENESS_FAILURE_BUDGET) || 3;
      const probeMethod = process.env.OIS_LIVENESS_PROBE_METHOD || "get_agents";
      const watchdog = new LivenessWatchdog({
        probeIntervalMs,
        failureBudget,
        log,
        probe: async () => {
          const a = agent;
          if (!a) return false;
          try {
            await a.call(probeMethod, {});
            return true;
          } catch {
            return false;
          }
        },
        onLivenessLost: (info) => {
          emitLivenessLostSignal({
            consecutiveFailures: info.consecutiveFailures,
            lastError: info.lastError,
            log,
          });
          log("[LivenessWatchdog] session wedged + unrecoverable — self-exiting; PID-1 supervisor restarts the container");
          // The shim's exit code is swallowed by the CLI (grandchild); the sentinel
          // is the out-of-band signal P1e's supervisor consumes. Exit to die so the
          // supervisor's restart fires.
          process.exit(1);
        },
      });
      watchdog.start();
      shutdownLivenessWatchdog = () => watchdog.stop();
      log(`[LivenessWatchdog] ENABLED — probe '${probeMethod}' every ${probeIntervalMs}ms, budget ${failureBudget}`);
    } else {
      log("[LivenessWatchdog] disabled (default; set OIS_LIVENESS_WATCHDOG_ENABLED=1 once the P1e PID-1 supervisor is in place)");
    }
  } catch (err) {
    rejectIdentityReady(err);
    rejectSessionReady(err);
    rejectSyncReady(err);
    throw err;
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      log(`Received ${signal}`);
      shutdown(signal === "SIGINT" ? "signal_int" : "signal_term");
    });
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err}`);
  process.exit(1);
});
