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
  ClaimableDigestTracker,
  WorkLeaseTracker,
  isEagerWarmupEnabled,
  parseClaimSessionResponse,
  formatSessionClaimedLogLine,
  type AgentEvent,
  type DrainedPendingAction,
  type HandshakeResponse,
  type SharedDispatcher,
  type TelemetryEvent,
  type ILogger,
  type LogFields,
} from "@apnex/network-adapter";
import { CognitivePipeline } from "@apnex/cognitive-layer";
import { readFileSync, existsSync, appendFileSync, statSync, renameSync, mkdirSync } from "node:fs";
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
// Hub-side canonical projection (agent-repository.ts deriveAdvisoryTags)
// surfaces these via advisoryTags.adapterVersion to all consumers.
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

function ensureDir(path: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    /* best-effort */
  }
}

function rotateIfNeeded(file: string): void {
  try {
    const stat = statSync(file);
    if (stat.size > SHIM_LOG_ROTATE_BYTES) {
      const rotated = `${file}.${Date.now()}`;
      renameSync(file, rotated);
    }
  } catch {
    /* file doesn't exist yet, that's fine */
  }
}

ensureDir(SHIM_LOG_FILE);
ensureDir(SHIM_EVENTS_FILE);
rotateIfNeeded(SHIM_LOG_FILE);
rotateIfNeeded(SHIM_EVENTS_FILE);

function appendText(line: string): void {
  try {
    appendFileSync(SHIM_LOG_FILE, line);
  } catch {
    /* best-effort — never disturb the call loop */
  }
}

// mission-66 commit 4: redaction + log-level helpers extracted to
// `./observability.ts` for unit-test tractability (shim.ts module init
// has process.exit(1) side effect via loadConfig()).
// idea-355 SLICE-1: observability helpers hoisted to the kernel.
import { redactFields, parseLogLevel, shouldEmitLevel, type LogLevel } from "@apnex/network-adapter";
const SHIM_LOG_LEVEL: LogLevel = parseLogLevel(process.env.OIS_SHIM_LOG_LEVEL);

function appendEvent(event: string, fields: LogFields, message?: string): void {
  // mission-66 commit 4: OIS_SHIM_LOG_LEVEL filter (ADR-031 §3). Events
  // tagged with `fields.level` below the configured threshold are
  // suppressed (no-op). Events without `level` always emit (default INFO).
  if (!shouldEmitLevel(fields.level as string | undefined, SHIM_LOG_LEVEL)) {
    return;
  }
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    fields: redactFields(fields),
    message: message ?? null,
    pid: process.pid,
  }) + "\n";
  try {
    appendFileSync(SHIM_EVENTS_FILE, line);
  } catch {
    /* best-effort */
  }
}

// ── Logging (stderr + file) ─────────────────────────────────────────

function log(msg: string): void {
  const ts = new Date().toISOString().replace("T", " ").replace("Z", "");
  const line = `[${ts}] ${msg}\n`;
  process.stderr.write(line);
  appendText(line);
}

// FileBackedLogger — concrete ILogger that fans out to:
//   1. NDJSON events file (every .log call, structured fields preserved)
//   2. text log file + stderr (rendered friendly form)
// Bound fields apply to every emission via `child()` for scoped loggers
// (per-session, per-reconnect, etc.).
class FileBackedLogger implements ILogger {
  constructor(private readonly bound: LogFields = {}) {}

  log(event: string, fields?: LogFields, message?: string): void {
    const merged: LogFields = { ...this.bound, ...(fields ?? {}) };
    appendEvent(event, merged, message);
    if (message) {
      log(`[${event}] ${message}`);
    } else {
      const fieldsStr = renderFields(merged);
      log(fieldsStr ? `[${event}]${fieldsStr}` : `[${event}]`);
    }
  }

  child(fields: LogFields): ILogger {
    return new FileBackedLogger({ ...this.bound, ...fields });
  }
}

function renderFields(fields: LogFields): string {
  const parts: string[] = [];
  for (const k of Object.keys(fields)) {
    const v = fields[k];
    parts.push(` ${k}=${Array.isArray(v) ? `[${v.join(",")}]` : String(v)}`);
  }
  return parts.join("");
}

const eventsLogger: ILogger = new FileBackedLogger({ pid: process.pid, role: config.role });

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
  // idea-353 — queue wake/stall reconciliation state. The digest tracker holds
  // the W1 level-trigger/de-dup baseline; the lease tracker holds the W2 held-
  // lease map (fed by the dispatcher's onToolCallResult observer). Both assigned
  // once mcpServer exists; referenced lazily by the heartbeat tick + observer.
  let claimableDigest: ClaimableDigestTracker | null = null;
  let workLeases: WorkLeaseTracker | null = null;
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
  const healthUrl = config.hubUrl.replace(/\/mcp(\/.*)?$/, "/health");

  // bug-114 + bug-180 — resolve the Hub's live tool-surface revision from
  // /health. Side-effect: updates the in-memory `cachedToolSurfaceRevision`
  // (the probe-path invalidation key consumed by getCurrentToolSurfaceRevision
  // + persistCatalog). Returns the live revision, or null when the fetch fails
  // or the Hub doesn't report the field — the bug-180 reconciler treats null
  // as "unknown, trust the cache" and never emits a spurious list_changed.
  // Plain HTTP, independent of the Hub MCP transport.
  const fetchLiveToolSurfaceRevision = async (): Promise<string | null> => {
    try {
      const res = await fetch(healthUrl);
      if (!res.ok) {
        log(`[Cache] /health fetch returned status ${res.status} — cache invalidation will trust existing cache`);
        return null;
      }
      const json = (await res.json()) as {
        version?: unknown;
        toolSurfaceRevision?: unknown;
      };
      if (typeof json.version === "string") {
        log(`[Cache] Hub version: ${json.version}`);
      }
      if (
        typeof json.toolSurfaceRevision === "string" &&
        json.toolSurfaceRevision !== ""
      ) {
        cachedToolSurfaceRevision = json.toolSurfaceRevision;
        log(`[Cache] Tool-surface revision resolved: ${cachedToolSurfaceRevision}`);
        return cachedToolSurfaceRevision;
      }
      log(`[Cache] /health returned no toolSurfaceRevision field — cache invalidation will trust existing cache`);
      return null;
    } catch (err) {
      log(`[Cache] /health fetch failed (non-fatal): ${(err as Error).message ?? err}`);
      return null;
    }
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
        proxyName: "@apnex/claude-plugin",
        proxyVersion: PROXY_VERSION,
        transport: "stdio-mcp-proxy",
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
    serverName: "proxy",
    serverCapabilities: { tools: {}, experimental: { "claude/channel": {} } },
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
        appendActionableLog(event, buildPromptText(event.event, event.data, { toolPrefix: "mcp__plugin_agent-adapter_proxy__" }));
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
        appendActionableLog(event, `[INFO] ${buildPromptText(event.event, event.data, { toolPrefix: "mcp__plugin_agent-adapter_proxy__" })}`);
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
    // idea-353 W2 — observe this agent's own work-verb tool-call results so the
    // outbound stall-prompt can track held leases locally (no Hub round-trip).
    // Lazy `workLeases` ref (assigned once mcpServer exists, below).
    onToolCallResult: (method, args, result) => {
      workLeases?.observe(method, args, result, Date.now());
    },
    pollBackstop: {
      role: config.role,
      firstTimerEnabled: true,
      log,
      // bug-180 L2 — revision-poll backstop on the heartbeat cadence. Lazy
      // reference: `reconciler` is assigned once mcpServer exists (below);
      // the first heartbeat tick fires ≥1 interval after start(), so it is
      // always populated by the time this runs. Catches a redeploy WHILE the
      // session stays connected (no reconnect → no fresh identityReady).
      // idea-353 — the same tick also drives the queue wake/stall reconcile.
      onHeartbeatTick: async () => {
        await reconciler?.reconcile("heartbeat");
        await runWakeStallReconcile();
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

  // idea-353 — queue wake/stall reconciliation trackers. Created once mcpServer
  // exists so the heartbeat tick can emit notifications. The lease tracker is
  // fed by the dispatcher's onToolCallResult observer wired above.
  claimableDigest = new ClaimableDigestTracker();
  workLeases = new WorkLeaseTracker();

  // idea-353 — the heartbeat-cadence wake/stall reconcile (W1 inbound digest +
  // W2 outbound stall-prompt + W3 emit-only status seam). Hoisted; invoked from
  // the PollBackstop onHeartbeatTick wired above (alongside the bug-180 L2
  // revision reconcile). Gated on a live streaming agent + an existing mcpServer.
  async function runWakeStallReconcile(): Promise<void> {
    const a = agent;
    if (!a || a.state !== "streaming" || !mcpServer) return;
    const idle = dispatcherRef?.isIdle() ?? true;
    const nowMs = Date.now();
    let claimableCount = 0;

    // W1 — inbound claimable digest. Read the CALLER-CLAIMABLE set via the
    // stable list_ready_work contract with scopeToCaller (idea-353 WI-2.1 /
    // audit-4265: the Hub applies claim_work's FULL predicate — deps + role +
    // WIP-cap + quarantine — so the digest count never over-reports what this
    // agent can actually claim; AC5 strict parity). On a failed read, skip the
    // tracker entirely so a transient empty/aborted read cannot manufacture a
    // false 0→N replay (AC3).
    try {
      const raw = await a.call("list_ready_work", { role: config.role, scopeToCaller: true }, { internal: true });
      const items = (raw as { items?: Array<{ id?: unknown }> } | null)?.items;
      if (Array.isArray(items)) {
        const claimableIds = items
          .map((i) => i?.id)
          .filter((id): id is string => typeof id === "string");
        claimableCount = claimableIds.length;
        const decision = claimableDigest?.reconcile({ claimableIds, isIdle: idle });
        if (decision?.emit) {
          const event: AgentEvent = {
            event: "work_claimable_digest",
            data: { role: config.role, count: decision.count, newCount: decision.newCount },
          };
          pushChannelNotification(mcpServer, event, "actionable", log);
          log(`[idea-353] inbound digest emitted — ${decision.count} claimable (${decision.newCount} new) for ${config.role}`);
        }
      }
    } catch (err) {
      log(`[idea-353] list_ready_work tick failed (non-fatal): ${(err as Error)?.message ?? err}`);
    }

    // W2 — outbound stall-prompt. Idle-gated: never pester a visibly-progressing
    // holder (an in-flight CallTool = active progress). A held lease past ~60%
    // of its window without a renew gets ONE renew/block/abandon nudge.
    if (idle && workLeases) {
      for (const due of workLeases.dueForStallPrompt(nowMs)) {
        const event: AgentEvent = {
          event: "work_lease_stall",
          data: { workId: due.workId, msUntilExpiry: due.msUntilExpiry },
        };
        pushChannelNotification(mcpServer, event, "actionable", log);
        workLeases.markPrompted(due.workId);
        log(`[idea-353] outbound stall-prompt emitted — ${due.workId} (~${Math.round(due.msUntilExpiry / 60000)}m left)`);
      }
    }

    // W3 — emit-only Agent.status idle/stall telemetry seam. Thin + non-gating
    // (DEFER rich taxonomy + the D-3/C2 binding per DR-S2-027): a structured
    // status line a future D-3 gauge / C2 supervisor binds to.
    const heldLeases = workLeases?.size() ?? 0;
    const statusState = !idle ? "working" : heldLeases > 0 ? "holding" : "idle";
    log(`[idea-353][agent-status] state=${statusState} idle=${idle} claimable=${claimableCount} heldLeases=${heldLeases}`);
  }

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
