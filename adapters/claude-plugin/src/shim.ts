/**
 * shim.ts — Claude Code ↔ Hub last-mile shim (platform entry).
 *
 * Claude-specific wiring only: stdio transport, config loading, process
 * lifecycle, and `<channel>` render-surface. The MCP-boundary handler
 * factory + pendingActionMap + tool-catalog cache + session-claim
 * helpers all live in `@ois/network-adapter` (Layer 1c per Design v1.2).
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  McpAgentClient,
  loadOrCreateGlobalInstanceId,
  appendNotification,
  buildPromptText,
  makeStdioFatalHalt,
  createSharedDispatcher,
  isCacheValid,
  readCache,
  writeCache,
  isEagerWarmupEnabled,
  parseClaimSessionResponse,
  formatSessionClaimedLogLine,
  type AgentEvent,
  type DrainedPendingAction,
  type HandshakeResponse,
  type SharedDispatcher,
  type TelemetryEvent,
} from "@ois/network-adapter";
import { CognitivePipeline } from "@ois/cognitive-layer";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { resolveSourceAttribute, isPulseEvent } from "./source-attribute.js";

// ── Configuration ───────────────────────────────────────────────────

interface HubConfig {
  hubUrl: string;
  hubToken: string;
  role: string;
  /**
   * Mission-19 routing labels. Stamped onto the Agent entity via the
   * enriched register_role handshake; scoped dispatches (tasks, threads,
   * etc.) filter by these. Read from hub-config.json `labels` field or
   * the `OIS_HUB_LABELS` env var (JSON-encoded). Omit for broadcast.
   */
  labels?: Record<string, string>;
}

function parseLabels(raw: string | undefined, source: string): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") out[k] = v;
      }
      return Object.keys(out).length > 0 ? out : undefined;
    }
  } catch (err) {
    console.error(`WARNING: Failed to parse labels from ${source}: ${err}`);
  }
  return undefined;
}

function loadConfig(): HubConfig {
  const workDir = process.env.WORK_DIR || process.cwd();
  const configPath = resolve(workDir, ".ois", "hub-config.json");

  let fileConfig: Partial<HubConfig> = {};
  if (existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      fileConfig = {
        hubUrl: raw.hubUrl,
        hubToken: raw.hubToken,
        role: raw.role,
        labels: raw.labels,
      };
    } catch (err) {
      console.error(`WARNING: Failed to parse ${configPath}: ${err}`);
    }
  }

  const hubUrl = process.env.OIS_HUB_URL || fileConfig.hubUrl || "";
  const hubToken = process.env.OIS_HUB_TOKEN || fileConfig.hubToken || "";
  const role = process.env.OIS_HUB_ROLE || fileConfig.role || "engineer";
  const labels =
    parseLabels(process.env.OIS_HUB_LABELS, "OIS_HUB_LABELS env var") ?? fileConfig.labels;

  if (!hubUrl || !hubToken) {
    console.error(
      "ERROR: Hub credentials not found. Checked .ois/hub-config.json and OIS_HUB_URL/OIS_HUB_TOKEN env vars",
    );
    process.exit(1);
  }

  return { hubUrl, hubToken, role, labels };
}

const config = loadConfig();
const WORK_DIR = process.env.WORK_DIR || process.cwd();
const LOG_FILE = join(WORK_DIR, ".ois", "claude-notifications.log");
const SHUTDOWN_TIMEOUT_MS = 3000;
const PROXY_VERSION = "1.2.0";
const SDK_VERSION = "@ois/network-adapter@2.1.0";

// ── Logging (stderr) ────────────────────────────────────────────────

function log(msg: string): void {
  const ts = new Date().toISOString().replace("T", " ").replace("Z", "");
  process.stderr.write(`[${ts}] ${msg}\n`);
}

// ── Render-surface: Claude `<channel>` notification injection ───────
//
// Layer-3 host-specific binding (claude-plugin only). Implements one
// arm of the Universal Adapter notification contract — the actionable
// path renders through the MCP `notifications/claude/channel` method
// with the claude-specific source-attribute taxonomy.

function pushChannelNotification(
  server: Server | null,
  event: AgentEvent,
  level: "actionable" | "informational",
): void {
  if (!server) return;
  const content = buildPromptText(event.event, event.data, {
    toolPrefix: "mcp__plugin_agent-adapter_proxy__",
  });
  const meta: Record<string, unknown> = {
    event: event.event,
    // Mission-56 W2.3: kind-family-aware source attribution per Design
    // v1.2 §"Architectural commitments #4" + Universal Adapter
    // notification contract spec §"Render-surface semantics" worked
    // example. Replaces the flat "hub" fallback so consumers (LLM
    // prompts, dashboards) can disambiguate repo-events / directives /
    // general notifications without parsing the inner subkind.
    // Mission-57 W3: pulse detection takes precedence over the
    // mission-56 W2.3 4-kind taxonomy. Pulse Messages arrive via
    // `message_arrived` but render with pulse source-attribute family
    // (avoids cognitive noise during high-activity sub-PR cascades —
    // S3 mitigation per Design v1.0 §4).
    source: resolveSourceAttribute(event.event, event.data),
    level,
  };
  const data = event.data as Record<string, unknown>;
  if (data.taskId) meta.taskId = data.taskId;
  if (data.threadId) meta.threadId = data.threadId;
  if (data.proposalId) meta.proposalId = data.proposalId;

  server
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .notification({
      method: "notifications/claude/channel",
      params: { content, meta },
    } as any)
    .then(() => log(`[Channel] Pushed ${event.event} (${level})`))
    .catch((err: unknown) => log(`[Channel] Push failed for ${event.event}: ${err}`));
}

function appendActionableLog(event: AgentEvent, action: string): void {
  appendNotification(
    { event: event.event, data: event.data, action },
    { logPath: LOG_FILE, mirror: (block) => process.stderr.write(block) },
  );
}

function appendPendingActionLog(item: DrainedPendingAction): void {
  const actionHint =
    item.dispatchType === "thread_message"
      ? `Reply with create_thread_reply to thread ${item.entityRef}`
      : `Owed: ${item.dispatchType} on ${item.entityRef}`;
  appendNotification(
    { event: item.dispatchType, data: item.payload, action: actionHint },
    { logPath: LOG_FILE, mirror: (block) => process.stderr.write(block) },
  );
}

// ── Graceful Shutdown ───────────────────────────────────────────────

let agent: McpAgentClient | null = null;
let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log("Shutting down...");
  const timeout = setTimeout(() => {
    log("Shutdown timeout — force exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  try {
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
  log(`Log: ${LOG_FILE}`);

  const globalInstanceId = loadOrCreateGlobalInstanceId({ log });
  log(`[Handshake] globalInstanceId=${globalInstanceId}`);

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
  const getClientInfo = () =>
    dispatcherRef ? dispatcherRef.getClientInfo() : { name: "unknown", version: "0.0.0" };

  const eagerWarmup = isEagerWarmupEnabled(process.env);
  log(
    `[Handshake] Eager-warmup: ${eagerWarmup ? "ON (OIS_EAGER_SESSION_CLAIM=1)" : "OFF (lazy mode; Hub will auto-claim on first SSE / first tools/call)"}`,
  );

  // Three-phase ready signal.
  //
  //   identityReady — resolves when register_role returns (transport
  //     connected + identity asserted). ~500ms typical. Gates ListTools
  //     so the host's catalog fetch unblocks fast.
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
  //     architects with non-empty pending-action queues. Tracked for
  //     diagnostic logging only — CallTool gates on sessionReady.

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

  // Hub version source for cache invalidation. Fetch /health once at
  // startup in the background; cache the version in-memory. Probes that
  // fire before the fetch completes get `null` and trust the cache
  // (probe-friendly default per tool-catalog-cache.isCacheValid).
  let cachedHubVersion: string | null = null;
  const healthUrl = config.hubUrl.replace(/\/mcp(\/.*)?$/, "/health");
  (async () => {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) {
        const json = (await res.json()) as { version?: unknown };
        if (typeof json.version === "string") {
          cachedHubVersion = json.version;
          log(`[Cache] Hub version resolved: ${cachedHubVersion}`);
        } else {
          log(`[Cache] /health returned no version field — cache invalidation will trust existing cache`);
        }
      } else {
        log(`[Cache] /health fetch returned status ${res.status} — cache invalidation will trust existing cache`);
      }
    } catch (err) {
      log(`[Cache] /health fetch failed (non-fatal): ${(err as Error).message ?? err}`);
    }
  })();

  agent = new McpAgentClient(
    {
      role: config.role,
      labels: config.labels,
      logger: log,
      handshake: {
        globalInstanceId,
        proxyName: "@ois/claude-plugin",
        proxyVersion: PROXY_VERSION,
        transport: "stdio-mcp-proxy",
        sdkVersion: SDK_VERSION,
        getClientInfo,
        llmModel: process.env.HUB_LLM_MODEL,
        onFatalHalt: fatalHalt,
        onHandshakeComplete: (r: HandshakeResponse) => {
          log(`[Handshake] Identity asserted: ${r.engineerId}`);
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
          appendNotification(
            { event: "task_issued", data: task, action: "Pick up with get_task" },
            { logPath: LOG_FILE, mirror: (block) => process.stderr.write(block) },
          );
        },
        onPendingActionItem: (item) => {
          if (dispatcherRef) {
            dispatcherRef.makePendingActionItemHandler({
              onPendingActionItem: appendPendingActionLog,
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
      cognitive: CognitivePipeline.standard({
        telemetry: {
          sink: (event: TelemetryEvent) => {
            try {
              log(`[ClaudePluginTelemetry] ${JSON.stringify(event)}`);
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
    listToolsGate: identityReady,
    callToolGate: sessionReady,
    getCachedCatalog: () => readCache(WORK_DIR, log),
    getIsIdentityReady: () => identityReadyResolved,
    getCurrentHubVersion: () => cachedHubVersion,
    isCacheValid,
    persistCatalog: (catalog) => {
      // Best-effort persist. Skip if we don't yet have a Hub version to
      // tag — better to let the next live-fetch (with version known)
      // populate the cache than write a hubVersion-less entry.
      if (cachedHubVersion === null) {
        log("[Cache] Skipping persistCatalog — Hub version not yet resolved");
        return;
      }
      writeCache(WORK_DIR, catalog, cachedHubVersion, log);
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
        pushChannelNotification(mcpServer, event, level);
      },
      onInformationalEvent: (event) => {
        // Informational events log only — `<channel>` push would otherwise
        // wake the LLM. Diagnostic-only routing.
        appendActionableLog(event, `[INFO] ${buildPromptText(event.event, event.data, { toolPrefix: "mcp__plugin_agent-adapter_proxy__" })}`);
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

  try {
    await agent.start();
    resolveSyncReady();
    log("Hub connection established (full sync done)");
  } catch (err) {
    rejectIdentityReady(err);
    rejectSessionReady(err);
    rejectSyncReady(err);
    throw err;
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      log(`Received ${signal}`);
      shutdown();
    });
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err}`);
  process.exit(1);
});
