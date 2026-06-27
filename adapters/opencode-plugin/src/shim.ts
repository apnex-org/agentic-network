/**
 * shim.ts — OpenCode ↔ Hub last-mile shim (platform entry).
 *
 * OpenCode-specific wiring only:
 *   - Bun.serve local MCP proxy (OpenCode consumes MCP over HTTP)
 *   - HTTP fetch handler routing /mcp requests to per-session transports
 *   - OpenCode SDK integration (promptAsync, showToast, session events)
 *   - Rate-limited prompt queue + deferred backlog
 *   - Tool discovery sync (tools/list_changed after Hub reconnect)
 *   - HubPlugin export
 *
 * The MCP-boundary handler factory + pendingActionMap + queueItemId
 * injection live in `@apnex/network-adapter` (Layer 1c per Design v1.2).
 */

import type { Plugin } from "@opencode-ai/plugin";
// Type-only (esbuild drops it → zero bundle impact; the SDK client is provided
// by the host at runtime). The v2 Event discriminated union types the plugin
// event handler so session-event property access is compile-checked (the fence
// that catches the 0.4.x-drift class — thread-669/bug-161).
import type { Event } from "@opencode-ai/sdk";
import {
  McpAgentClient,
  McpTransport,
  appendNotification,
  buildPendingTaskNotification,
  readRequiredAgentName,
  loadConfig,
  readPackageVersion,
  UNKNOWN_BUILD_INFO,
  type BuildInfo,
  createFileLogger,
  buildPromptText,
  buildToastMessage,
  createSharedDispatcher,
  assertHostWiringComplete,
  getActionText,
  isPulseEvent,
  reconstructDrainedAction,
  type HubConfig,
  type FileLogger,
  type AgentEvent,
  type SessionState,
  type SessionReconnectReason,
  type HandshakeFatalError,
  type SharedDispatcher,
  type TelemetryEvent,
} from "@apnex/network-adapter";
import {
  NotificationCoalescer,
  type CoalescedNotification,
} from "@apnex/message-router";
import { CognitivePipeline } from "@apnex/cognitive-layer";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

// ── Module state ─────────────────────────────────────────────────────

// idea-355 SLICE-0 / bug-183 reported-half: kill the hardcoded version phantom.
// Mirror the mission-66 #40 fix the claude shim already carries — read the REAL
// versions from package.json instead of the drifted "4.3.0" / "2.1.0" literals.
// PROXY_VERSION = opencode-plugin/package.json; SDK_VERSION = the @apnex/network-adapter
// package.json. SLICE-3 (fork 3) closed the bundle gap: in the esbuild
// self-contained bundle the kernel is inlined FROM SOURCE (no resolvable
// package.json on disk), so SDK_VERSION now falls back to the bundle's own
// version (ONE build) instead of the old "@apnex/network-adapter@unknown", and
// the precise build identity is the inlined git sha in {PROXY,SDK}_BUILD_INFO
// below. (claude ships node_modules so its resolve hits the real 0.1.4.)
const __shimDir = dirname(fileURLToPath(import.meta.url));
const __require = createRequire(import.meta.url);

// readPackageVersion hoisted to the kernel (@apnex/network-adapter) in idea-355
// SLICE-1. The shim keeps its host-specific path resolution + version constants.
const OPENCODE_PLUGIN_PKG_VERSION = readPackageVersion(
  resolve(__shimDir, "..", "package.json"),
  "unknown",
);
const NETWORK_ADAPTER_PKG_VERSION = (() => {
  try {
    return readPackageVersion(
      __require.resolve("@apnex/network-adapter/package.json"),
      OPENCODE_PLUGIN_PKG_VERSION,
    );
  } catch {
    // idea-355 SLICE-3 (fork 3): in the esbuild self-contained bundle the
    // kernel is inlined FROM SOURCE — there is no resolvable
    // @apnex/network-adapter/package.json on disk. It is ONE build, so the
    // bundle's own version IS the kernel's effective version (the inlined git
    // sha in SDK_BUILD_INFO carries the precise identity). Report the bundle
    // version instead of the old "@apnex/network-adapter@unknown" phantom.
    return OPENCODE_PLUGIN_PKG_VERSION;
  }
})();
const PROXY_VERSION = OPENCODE_PLUGIN_PKG_VERSION;
const SDK_VERSION = `@apnex/network-adapter@${NETWORK_ADAPTER_PKG_VERSION}`;

// idea-355 SLICE-3 (fork 3, single-sha): build-identity for the OpenCode
// bundle. Unlike the claude shim — which ships node_modules + an adjacent
// dist/build-info.json and reads them at runtime via readBuildInfo — opencode
// bundles via esbuild: the kernel is inlined FROM SOURCE, there is no
// node_modules and no adjacent build-info.json at runtime. So the build
// identity is INLINED at bundle time via esbuild `define`
// (__OPENCODE_BUILD_INFO__, see scripts/build/bundle-opencode.js), read here
// behind a typeof-guard that falls back to UNKNOWN_BUILD_INFO on the dev/test
// (tsx/vitest) paths where the define is absent. It is ONE build, so the SAME
// sha/dirty stamps BOTH the shim (PROXY) and the kernel (SDK) — honest, not a
// fidelity loss. NO runtime disk read.
declare const __OPENCODE_BUILD_INFO__: BuildInfo | undefined;
const BUNDLE_BUILD_INFO: BuildInfo =
  typeof __OPENCODE_BUILD_INFO__ !== "undefined" ? __OPENCODE_BUILD_INFO__ : UNKNOWN_BUILD_INFO;
const PROXY_BUILD_INFO = BUNDLE_BUILD_INFO;
const SDK_BUILD_INFO = BUNDLE_BUILD_INFO;

let diagLogPath = "";
let notificationLogPath = "";
// idea-355 SLICE-1: the file-backed text logger is hoisted to the kernel
// `createFileLogger`. null until initLogger() runs (preserves the pre-init
// no-op semantics); opencode keeps the TUI clean (no stderr mirror).
let __fileLog: FileLogger | null = null;
let hubAdapter: McpAgentClient | null = null;
let proxyPort = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sdkClient: any = null;
let currentSessionId: string | null = null;
let config: HubConfig;
let lastToolHash = "";
const activeProxyServers: Server[] = [];

// Shared MCP-boundary dispatcher. Layer-1c factory; see Design v1.2.
//
// bug-53: opt into pollBackstop heartbeat-second-timer so transport_heartbeat
// fires periodically (mission-75 §3.3 substrate).
// bug-103: firstTimerEnabled re-enabled — the list_messages Pull-mode first-timer
// is the catch-up path that recovers role-targeted kind:note notifications
// missed while the adapter was disconnected. `role` (the poll's targetRole
// filter) is resolved from OIS_HUB_ROLE at module-init — the config object
// loads later inside HubPlugin — so the env var is now load-bearing for the
// catch-up query, not just log lines.
const dispatcher = createSharedDispatcher({
  getAgent: () => hubAdapter,
  proxyVersion: PROXY_VERSION,
  serverName: "hub-proxy",
  serverCapabilities: { tools: {}, logging: {} },
  log: (m) => log(m),
  // M-OpenCode-Shim-Sovereign-Dedup Step-2 (idea-331): bind the OpenCode
  // host surface through the shared DispatcherNotificationHooks seam (the
  // same one Claude uses). This routes the wake THROUGH router.route(), so
  // the MessageRouter/SeenIdCache push+poll dedup gates it — closing the
  // prior bypass where buildPluginCallbacks surfaced OUTSIDE the router
  // (duplicate deliveries that compounded the flood). buildPluginCallbacks
  // is DELETED; the agent is wired via setCallbacks(dispatcher.callbacks).
  //
  // INVARIANT (path (b)): the dispatcher is constructed here at MODULE-INIT
  // (before config/sdkClient/sessionActive exist), but these hooks FIRE only
  // after connect — so they safely read module `let` state at invocation-time.
  // Do NOT construct the dispatcher, or fire any hook, before connect.
  // DEFER (2nd-OpenCode-class-host): Claude builds its dispatcher at RUNTIME
  // in main(); OpenCode's module-init construction is itself drift. Align the
  // construction lifecycle when a 2nd such host arrives — co-bucketed with the
  // rate-limit/prompt-queue coalescing generalization. Not silently accepted.
  notificationHooks: {
    onActionableEvent: surfaceActionableEvent,
    onInformationalEvent: surfaceInformationalEvent,
    onStateChange: handleConnectionStateChange,
  },
  pollBackstop: {
    role: process.env.OIS_HUB_ROLE ?? "engineer",
    firstTimerEnabled: true,
    log: (m) => log(m),
  },
});

// ── Diagnostic logger ───────────────────────────────────────────────

function initLogger(directory: string): void {
  diagLogPath = join(directory, ".ois", "hub-plugin.log");
  notificationLogPath = join(directory, ".ois", "hub-plugin-notifications.log");
  // Simple text-append (no NDJSON / no rotation / no stderr — the TUI must
  // stay clean); the kernel factory does the ensureDir + best-effort append.
  // Line format kept verbatim (`<raw ISO> <msg>`) so logs are byte-identical.
  __fileLog = createFileLogger({
    textFile: diagLogPath,
    formatLine: (m) => `${new Date().toISOString()} ${m}\n`,
  });
}

function log(msg: string): void {
  __fileLog?.log(msg);
}

// ── Configuration ───────────────────────────────────────────────────

// idea-355 SLICE-1 single-home: HubConfig + parseLabels + loadConfig hoisted to
// the kernel (@apnex/network-adapter). The shim injects its host specifics — the
// relay hubUrl default, autoPrompt:true, the log() warn sink, readAutoPrompt — at
// the loadConfig call site below. OpenCode keeps no credential abort (can't kill
// the TUI; it surfaces missing creds via the handshake-fail path).

// ── Notification coalescing (delivery pacing) ────────────────────────
//
// idea-355 SLICE-1 single-home: the rate-limit / prompt-queue / deferred-
// backlog machinery (bug-161 + R1 bounded-fallback) is hoisted to the L2
// `NotificationCoalescer` in @apnex/message-router. The shim keeps only its
// last-mile render bindings (promptLLM / injectContext / showToast, below) and
// feeds session-activity from its own session-event stream. The coalescer is
// constructed once those bindings are defined (see below).

// ── OpenCode SDK integration ─────────────────────────────────────────

async function showToast(message: string, variant: string = "info"): Promise<void> {
  if (!sdkClient) return;
  try {
    await sdkClient.tui.showToast({ body: { message, variant } });
  } catch {
    /* TUI may not be ready */
  }
}

async function promptLLM(text: string): Promise<void> {
  if (!sdkClient || !currentSessionId) return;
  try {
    // The rate-limit clock is stamped by the coalescer (which owns the pacing
    // decision); this binding is now purely the SDK promptAsync last mile.
    await sdkClient.session.promptAsync({
      path: { id: currentSessionId },
      body: { parts: [{ type: "text", text }] },
    });
  } catch (err) {
    log(`Prompt failed: ${err}`);
  }
}

async function injectContext(text: string): Promise<void> {
  if (!sdkClient || !currentSessionId) return;
  try {
    await sdkClient.session.promptAsync({
      path: { id: currentSessionId },
      body: {
        // SDK drift (thread-669): v2 SessionPromptData.system is a system-PROMPT
        // string, not a boolean "this is a system message" flag. The old `system: true`
        // was a type mismatch (boolean where string expected). `noReply: true` already
        // gives the silent/informational path (no assistant turn).
        noReply: true,
        // thread-671: buildPromptText already emits "[Hub] …"; only add the
        // "[Hub Notification]" wrapper when the text isn't already Hub-prefixed,
        // to avoid the "[Hub Notification] [Hub] …" double-prefix.
        parts: [
          { type: "text", text: text.startsWith("[Hub") ? text : `[Hub Notification] ${text}` },
        ],
      },
    });
  } catch (err) {
    log(`Context injection failed: ${err}`);
  }
}

// The L2 delivery pacer. Render bindings are the shim's last mile; session
// activity is fed from handleSessionEvent; `autoPrompt` is read live off the
// runtime config (assigned at plugin init, before any notification fires).
const coalescer = new NotificationCoalescer({
  io: {
    promptLLM,
    injectContext,
    showToast,
    autoPrompt: () => !!config.autoPrompt,
  },
});

// ── Tool discovery sync ──────────────────────────────────────────────

function computeToolHash(tools: unknown[]): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sorted = [...tools].sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const canonical = sorted.map((t: any) => `${t.name}:${JSON.stringify(t.inputSchema || {})}`).join("|");
  let hash = 0;
  for (let i = 0; i < canonical.length; i++) {
    hash = ((hash << 5) - hash + canonical.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

async function syncTools(): Promise<void> {
  if (!hubAdapter) return;
  const s = hubAdapter.state;
  if (s !== "streaming" && s !== "synchronizing") return;

  try {
    const transport = hubAdapter.getTransport() as McpTransport;
    const tools = await transport.listToolsRaw();
    const newHash = computeToolHash(tools);
    const isFirstSync = lastToolHash === "";

    if (isFirstSync) {
      lastToolHash = newHash;
      log(`[ToolSync] Initial tool hash: ${newHash} (${tools.length} tools)`);
    } else if (newHash === lastToolHash) {
      log(`[ToolSync] Tools unchanged (hash: ${newHash})`);
      return;
    } else {
      log(`[ToolSync] Tools changed! Old: ${lastToolHash}, New: ${newHash} (${tools.length} tools)`);
      lastToolHash = newHash;
    }

    for (const server of activeProxyServers) {
      try {
        await server.sendToolListChanged();
        log(`[ToolSync] Sent tools/list_changed to proxy server`);
      } catch (err) {
        log(`[ToolSync] Failed to send tools/list_changed: ${err}`);
      }
    }

    await showToast(
      isFirstSync ? "Hub connected — tools available" : "Hub tools updated following reconnection",
      "success",
    );
    log(`[ToolSync] Tool sync complete — OpenCode notified`);
  } catch (err) {
    log(`[ToolSync] Failed to sync tools: ${err}`);
  }
}

// Mission-57 W3 pulse detection: `isPulseEvent` is now imported from
// `@apnex/network-adapter` (event-router). M-OpenCode-Shim-Sovereign-Dedup
// (idea-331) hoisted it to core — it was a verbatim mirror of the claude
// shim's copy; both shims now share the one core impl. Detected pulses
// downgrade their notification level "actionable" → "informational".

// ── Notification surface hooks (OpenCode last-mile) ──────────────────
//
// M-OpenCode-Shim-Sovereign-Dedup Step-2 (idea-331): the OpenCode host's
// DispatcherNotificationHooks implementations, passed into createSharedDispatcher
// (above) so the wake routes THROUGH router.route() — the MessageRouter's
// SeenIdCache push+poll dedup gates it. This replaces the deleted
// buildPluginCallbacks, which surfaced OUTSIDE the router (the dedup bypass).
// The dispatcher's onActionableEvent does the pendingActionMap capture +
// router.route BEFORE invoking these hooks, so they do surfacing ONLY (no
// dispatcher.callbacks self-call). See the path-(b) invariant at the
// createSharedDispatcher call site: these fire post-connect and read module
// `let` state at invocation-time.

function surfaceActionableEvent(event: AgentEvent): void {
  const action = getActionText(event.event, event.data);
  // Mission-57 W3: pulse Messages downgrade level from "actionable"
  // to "informational" (S3 mitigation per Design v1.0 §4 — pulse-
  // noise reduction during high-activity sub-PR cascades).
  const isPulse = isPulseEvent(event.event, event.data);
  const actionLabel = isPulse ? `[PULSE] ${action}` : action;
  appendNotification(
    { event: event.event, data: event.data, action: actionLabel },
    { logPath: notificationLogPath },
  );
  const message = buildToastMessage(event.event, event.data);
  const promptText = buildPromptText(event.event, event.data, { toolPrefix: "architect-hub_" });
  const notification: CoalescedNotification = {
    level: isPulse ? "informational" : "actionable",
    message,
    promptText,
  };
  // Live SSE path: bounded-flush cap engaged (R1 — a never-idling session
  // can't wedge the queue).
  void coalescer.enqueue(notification);
}

function surfaceInformationalEvent(event: AgentEvent): void {
  // M-OpenCode-Shim-Sovereign-Dedup Step-1 (idea-331): informational events
  // are LOG-ONLY — matching the Claude shim's already-correct disposition
  // (claude shim.ts:672-676). The core (event-router) classifies these as
  // informational precisely so they DON'T wake/surface; the prior toast +
  // injectContext here was the OpenCode-only divergence that flooded the TUI
  // and burned the session context window (tele-12). Diagnostic log only —
  // no toast, no inject.
  const action = getActionText(event.event, event.data);
  appendNotification(
    { event: event.event, data: event.data, action: `[INFO] ${action}` },
    { logPath: notificationLogPath },
  );
}

function handleConnectionStateChange(
  state: SessionState,
  prev: SessionState,
  reason?: SessionReconnectReason,
): void {
  log(`Connection: ${prev} → ${state}${reason ? ` (${reason})` : ""}`);
  if (state === "streaming") {
    void syncTools();
  }
}

// ── Connect to Hub ───────────────────────────────────────────────────

async function connectToHub(agentName: string): Promise<void> {
  const onFatalHalt = (err: HandshakeFatalError): void => {
    log(`[FATAL:${err.code}] ${err.message}`);
    showToast(`Hub fatal: ${err.code}`, "error");
    // OpenCode has no clean process-exit path from a plugin. Log + toast +
    // stop reconnecting. Plugin stays loaded but inert until OpenCode
    // restarts. Do NOT call process.exit — would kill the whole TUI.
  };

  if (config.labels) {
    log(`Labels: ${JSON.stringify(config.labels)}`);
  }

  const pendingActionItemHandler = dispatcher.makePendingActionItemHandler();

  hubAdapter = new McpAgentClient(
    {
      role: config.role,
      labels: config.labels,
      logger: log,
      handshake: {
        // idea-251 D-prime Phase 2: name IS identity (was globalInstanceId).
        name: agentName,
        proxyName: "@apnex/opencode-plugin",
        proxyVersion: PROXY_VERSION,
        transport: "bun-serve-proxy",
        sdkVersion: SDK_VERSION,
        // idea-355 SLICE-3 (fork 3, single-sha): build-identity flows via
        // clientMetadata → Hub deriveAdvisoryTags → AgentAdvisoryTags (the same
        // wire-pattern the claude shim uses). It is ONE inlined bundle, so the
        // SAME sha/dirty stamps both PROXY and SDK. handshake.ts spreads these
        // ONLY when defined — set all four together.
        proxyCommitSha: PROXY_BUILD_INFO.commitSha,
        proxyDirty: PROXY_BUILD_INFO.dirty,
        sdkCommitSha: SDK_BUILD_INFO.commitSha,
        sdkDirty: SDK_BUILD_INFO.dirty,
        getClientInfo: () => ({
          name: "opencode",
          version: process.env.OPENCODE_VERSION ?? "unknown",
        }),
        llmModel: process.env.HUB_LLM_MODEL,
        onFatalHalt,
        onPendingTask: (task) => {
          appendNotification(buildPendingTaskNotification(task), {
            logPath: notificationLogPath,
          });
        },
        onPendingActionItem: (item) => {
          pendingActionItemHandler(item);
          // M-Sovereign-Dedup (idea-331): the reconstruction (event/data +
          // actionHint + pulse-aware level) is the core helper shared with the
          // claude shim; the WAKE below stays opencode-specific (route a
          // notification through the same coalescer the live SSE path uses —
          // the bug-108 fix). capFlush:false preserves this path's original
          // no-bounded-cap behavior (the drain is a finite batch, not a stream).
          const { agentEvent, actionHint, level } = reconstructDrainedAction(item);
          appendNotification(
            { event: agentEvent.event, data: agentEvent.data, action: actionHint },
            { logPath: notificationLogPath },
          );
          const notification: CoalescedNotification = {
            level,
            message: buildToastMessage(agentEvent.event, agentEvent.data),
            promptText: buildPromptText(agentEvent.event, agentEvent.data, {
              toolPrefix: "architect-hub_",
            }),
          };
          void coalescer.enqueue(notification, { capFlush: false });
        },
      },
    },
    {
      transportConfig: { url: config.hubUrl, token: config.hubToken },
      cognitive: CognitivePipeline.standard({
        telemetry: {
          sink: (event: TelemetryEvent) => {
            try {
              log(`[OpencodePluginTelemetry] ${JSON.stringify(event)}`);
            } catch {
              /* never disturb the tool-call loop */
            }
          },
        },
      }),
    },
  );
  // M-OpenCode-Shim-Sovereign-Dedup Step-2 (idea-331): wire the agent directly
  // to the dispatcher's callbacks (the Claude pattern, claude shim.ts:695). The
  // dispatcher routes events through router.route() → its SeenIdCache dedup →
  // the notificationHooks bag (surfaceActionableEvent / surfaceInformationalEvent
  // / handleConnectionStateChange) supplied at construction. Replaces the deleted
  // buildPluginCallbacks wrapper + its router-bypassing surface path.
  hubAdapter.setCallbacks(dispatcher.callbacks);

  await hubAdapter.start();
  log("Connected to remote Hub via McpAgentClient");

  // bug-53: §6.4-equivalent gate — fail-fast at boot if pollBackstop wiring
  // is missing (would otherwise silently freeze lastHeartbeatAt at adapter-
  // startup). TRANSPORT_HEARTBEAT_ENABLED=false is the explicit opt-out path.
  assertHostWiringComplete(dispatcher, log);

  // bug-53: now that handshake completed and hubAdapter is in 'streaming'
  // state, start the pollBackstop heartbeat timer. Idempotent — duplicate
  // start() calls are no-ops.
  dispatcher.pollBackstop?.start(() => hubAdapter);
}

// ── Local MCP proxy server (Bun.serve) + HTTP fetch handler ─────────
//
// Layer-3 host-specific HTTP plumbing. OpenCode's plugin runtime opens
// a fresh MCP session per Initialize request via
// WebStandardStreamableHTTPServerTransport — so the fetch handler
// constructs a new Server (via dispatcher.createMcpServer()) per
// session and routes subsequent requests by mcp-session-id header.

export function makeOpenCodeFetchHandler(
  sharedDispatcher: SharedDispatcher = dispatcher,
  servers: Server[] = activeProxyServers,
): (req: Request) => Promise<Response> {
  const proxyTransports = new Map<string, WebStandardStreamableHTTPServerTransport>();
  const proxyServers = new Map<string, Server>();

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });

    const sessionId = req.headers.get("mcp-session-id");
    if (sessionId && proxyTransports.has(sessionId)) {
      return proxyTransports.get(sessionId)!.handleRequest(req);
    }

    if (req.method === "POST") {
      const body = await req.json();
      if (isInitializeRequest(body)) {
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (sid) => {
            proxyTransports.set(sid, transport);
          },
        });
        const server = sharedDispatcher.createMcpServer();
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) {
            proxyTransports.delete(sid);
            proxyServers.delete(sid);
          }
          const idx = servers.indexOf(server);
          if (idx !== -1) servers.splice(idx, 1);
        };
        servers.push(server);
        await server.connect(transport);
        if (transport.sessionId) proxyServers.set(transport.sessionId, server);
        log("[OpenCodeHTTP] new MCP session initialized");
        return transport.handleRequest(req, { parsedBody: body });
      }
    }

    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request" },
        id: null,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  };
}

async function startProxyServer(): Promise<number> {
  const fetchHandler = makeOpenCodeFetchHandler();

  // Bun is only available inside the OpenCode runtime. Use a runtime
  // probe so TypeScript doesn't complain and so tests importing this
  // module (e.g. makeOpenCodeFetchHandler) don't require Bun.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bunRuntime = (globalThis as any).Bun;
  if (!bunRuntime) {
    throw new Error("Bun.serve not available — shim.ts is running outside OpenCode runtime");
  }

  const httpServer = bunRuntime.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    fetch: fetchHandler,
  });

  const port = httpServer.port;
  log(`Local proxy server listening on 127.0.0.1:${port}`);
  return port;
}

// ── Plugin Export ────────────────────────────────────────────────────
// CRITICAL: No awaits during init. Everything deferred to background.

// ── Session-event handling (de-any + bug-161) ───────────────────────
//
// Extracted from the HubPlugin event hook so it's unit-testable and typed
// against the v2 @opencode-ai/sdk Event discriminated union (dropping the old
// `event: any`). Typing it surfaced two 0.4.x drifts the cast had hidden:
//   • session.created/updated carry the session at `properties.info` (a Session
//     object); the old `|| properties.id` legacy fallback is invalid on the v2
//     type (and dead at runtime) — dropped (thread-669).
//   • bug-161: v2 `SessionStatus` is an OBJECT {type:"idle"|"retry"|"busy"}, not
//     a 0.4.x status string. The old `status === "idle"|"running"|"streaming"|…`
//     string compares were always-false in v2 → sessionActive NEVER went true →
//     the notificationQueue never engaged (notifications surfaced mid-stream).
//     Map status.type: "idle" → inactive (flush); "busy"/"retry" → active.
async function handleSessionEvent(event: Event): Promise<void> {
  switch (event.type) {
    case "session.created":
    case "session.updated":
      currentSessionId = event.properties.info.id;
      break;
    case "session.status": {
      // idle → inactive (the coalescer flushes its buffer); busy/retry → active.
      await coalescer.setSessionActive(event.properties.status.type !== "idle");
      break;
    }
    case "session.idle":
      await coalescer.setSessionActive(false);
      if (hubAdapter && !hubAdapter.isConnected) {
        try {
          await hubAdapter.start();
        } catch {
          /* will retry on next idle */
        }
      }
      break;
    case "session.error":
    case "session.deleted":
      // R1 (bug-161 completion): a session that ENDS via error/deletion (NOT a
      // clean idle) must still flush its buffered notifications — otherwise it
      // stays "active" and the queue is stranded (the exact gap that shipped
      // silently with bug-161). setSessionActive(false) mirrors the idle flush;
      // skip the idle-only reconnect (an errored/deleted session isn't a cue).
      await coalescer.setSessionActive(false);
      break;
  }
}

export const HubPlugin: Plugin = async (ctx) => {
  // SDK drift: @opencode-ai/plugin 1.3.x exposes `directory: string` directly on
  // PluginInput (preferred); 0.4.x exposed it via `app.path.cwd` (removed in 1.3.x).
  // Cast both optional shapes to any so the fallback type-builds clean against
  // EITHER SDK (1.3.x has no `app` on PluginInput → would error TS2339 otherwise).
  const workDir =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx as any).directory ?? (ctx as any).app?.path?.cwd ?? process.cwd();
  initLogger(workDir);
  log(`mission-55 cleanup — shared MCP-boundary dispatcher (${SDK_VERSION})`);

  config = loadConfig({
    directory: workDir,
    defaults: { hubUrl: "https://mcp-relay-hub-5muxctm3ta-ts.a.run.app/mcp", autoPrompt: true },
    warn: log,
    readAutoPrompt: true,
  });
  log(`Auto-prompt: ${config.autoPrompt ? "enabled" : "DISABLED"}`);

  sdkClient = ctx.client;

  setTimeout(async () => {
    try {
      // 1. Capture current session ID
      try {
        const sessions = await sdkClient.session.list();
        if (sessions.data && sessions.data.length > 0) {
          const sorted = [...sessions.data].sort(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (a: any, b: any) =>
              new Date(b.updatedAt || b.createdAt).getTime() -
              new Date(a.updatedAt || a.createdAt).getTime(),
          );
          currentSessionId = sorted[0].id;
          log(`Tracking session: ${currentSessionId?.substring(0, 8)}...`);
        }
      } catch (err) {
        log(`Session list failed: ${err}`);
      }

      // 2. idea-251 D-prime Phase 2 identity (hoisted to the kernel in idea-355
      // SLICE-1). The shim keeps only its host-specific abort: OpenCode can't
      // process.exit, so it returns — plugin inert until restart.
      const agentName = readRequiredAgentName(log);
      if (!agentName) return;

      // 3. Connect to remote Hub
      try {
        await connectToHub(agentName);
      } catch (err) {
        log(`Hub connection failed: ${err}`);
        return;
      }

      // 4. Start local MCP proxy server
      try {
        proxyPort = await startProxyServer();
      } catch (err) {
        log(`Proxy server failed: ${err}`);
        return;
      }

      // 5. Register proxy with OpenCode
      try {
        await sdkClient.mcp.add({
          body: {
            name: "architect-hub",
            config: { type: "remote" as const, url: `http://127.0.0.1:${proxyPort}/mcp` },
          },
        });
        log("Registered proxy as 'architect-hub' MCP server");
      } catch (err) {
        log(`MCP registration failed: ${err}`);
      }

      log("Fully initialized");
      await showToast("Hub connected", "success");
    } catch (err) {
      log(`Background init failed: ${err}`);
    }
  }, 3000);

  return {
    event: async ({ event }: { event: Event }) => {
      await handleSessionEvent(event);
    },
  };
};

// Test-only exports — let tests validate production code paths
// without spinning up Bun or OpenCode runtime.
export const _testOnly = {
  dispatcher,
  makeOpenCodeFetchHandler,
  handleSessionEvent,
  getSessionActive: () => coalescer.getSessionActive(),
  // Sync test-setup: the coalescer sets its session-active field synchronously
  // (before any flush await), so an empty-queue setup observes it immediately.
  setSessionActive: (v: boolean) => {
    void coalescer.setSessionActive(v);
  },
  getCurrentSessionId: () => currentSessionId,
  getHubAdapter: () => hubAdapter,
  setHubAdapter: (agent: McpAgentClient | null) => {
    hubAdapter = agent;
  },
};
