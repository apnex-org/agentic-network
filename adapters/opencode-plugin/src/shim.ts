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
import {
  McpAgentClient,
  McpTransport,
  appendNotification,
  buildPromptText,
  buildToastMessage,
  createSharedDispatcher,
  assertHostWiringComplete,
  getActionText,
  type AgentClientCallbacks,
  type AgentEvent,
  type SessionState,
  type SessionReconnectReason,
  type HandshakeFatalError,
  type SharedDispatcher,
  type TelemetryEvent,
} from "@apnex/network-adapter";
import { CognitivePipeline } from "@apnex/cognitive-layer";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { readFileSync, appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

// ── Module state ─────────────────────────────────────────────────────

const PROXY_VERSION = "4.3.0";
const SDK_VERSION = "@apnex/network-adapter@2.1.0";
const RATE_LIMIT_MS = 30_000;

let diagLogPath = "";
let notificationLogPath = "";
let hubAdapter: McpAgentClient | null = null;
let proxyPort = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sdkClient: any = null;
let currentSessionId: string | null = null;
let sessionActive = false;
let config: HubConfig;
let lastPromptTime = 0;
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
  try {
    mkdirSync(dirname(diagLogPath), { recursive: true });
  } catch {
    /* directory exists */
  }
}

function log(msg: string): void {
  if (!diagLogPath) return;
  const line = `${new Date().toISOString()} ${msg}\n`;
  try {
    appendFileSync(diagLogPath, line);
  } catch {
    /* silently fail — don't pollute TUI */
  }
}

// ── Configuration ───────────────────────────────────────────────────

interface HubConfig {
  hubUrl: string;
  hubToken: string;
  autoPrompt: boolean;
  role: string;
  /**
   * Mission-19 routing labels. Stamped onto the Agent entity via the
   * enriched register_role handshake; scoped dispatches filter by these.
   * From adapter-config.json `labels` field or OIS_HUB_LABELS env var (JSON).
   */
  labels?: Record<string, string>;
  /**
   * thread-671: extra Hub event types to suppress from the toast/inject
   * surface (presence/telemetry FYI). `agent_state_changed` is ALWAYS
   * suppressed (see DEFAULT_SURFACE_SUPPRESS); this list ADDS to that
   * default. From adapter-config.json `suppressEvents` or the
   * OIS_HUB_SUPPRESS_EVENTS env var (JSON array of event-type strings).
   */
  suppressEvents?: string[];
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
    log(`WARNING: Failed to parse labels from ${source}: ${err}`);
  }
  return undefined;
}

function parseStringArray(raw: string | undefined, source: string): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const out = parsed.filter((x): x is string => typeof x === "string");
      return out.length > 0 ? out : undefined;
    }
  } catch (err) {
    log(`WARNING: Failed to parse ${source}: ${err}`);
  }
  return undefined;
}

function loadConfig(directory: string): HubConfig {
  let cfg: HubConfig = {
    hubUrl: "https://mcp-relay-hub-5muxctm3ta-ts.a.run.app/mcp",
    hubToken: "",
    autoPrompt: true,
    role: "engineer",
  };
  try {
    const configPath = join(directory, ".ois", "adapter-config.json");
    const raw = readFileSync(configPath, "utf-8");
    cfg = { ...cfg, ...JSON.parse(raw) };
  } catch {
    /* no config file — use defaults */
  }
  if (process.env.OIS_HUB_URL) cfg.hubUrl = process.env.OIS_HUB_URL;
  if (process.env.OIS_HUB_TOKEN) cfg.hubToken = process.env.OIS_HUB_TOKEN;
  if (process.env.OIS_HUB_ROLE) cfg.role = process.env.OIS_HUB_ROLE;
  if (process.env.HUB_PLUGIN_AUTO_PROMPT)
    cfg.autoPrompt = process.env.HUB_PLUGIN_AUTO_PROMPT.toLowerCase() !== "false";
  const envLabels = parseLabels(process.env.OIS_HUB_LABELS, "OIS_HUB_LABELS env var");
  if (envLabels) cfg.labels = envLabels;
  const envSuppress = parseStringArray(
    process.env.OIS_HUB_SUPPRESS_EVENTS,
    "OIS_HUB_SUPPRESS_EVENTS env var",
  );
  if (envSuppress) cfg.suppressEvents = envSuppress;
  return cfg;
}

// ── Notification-surface suppression (thread-671) ────────────────────
//
// Presence/telemetry events are classified `informational` by event-router
// for agent-population cache-coherence (Mission-62), NOT to be shown to the
// user — and there is no cache CONSUMER of them in the adapter today, so
// dropping them from the surface costs nothing. Left unfiltered they flood
// the TUI with a wall of `state-changed` toasts AND inject every transition
// into the session, burning the context window (tele-12) for zero signal.
// Suppressed events are still written to the diagnostic notification log;
// only the toast + context-inject are skipped. Applied to the INFORMATIONAL
// path only — never to actionable events (suppressing those would silently
// drop work that needs a response).
const DEFAULT_SURFACE_SUPPRESS: ReadonlyArray<string> = ["agent_state_changed"];

/**
 * Pure predicate (exported for unit tests): is this event type suppressed from
 * the toast/inject surface? `extra` is the operator's `config.suppressEvents`,
 * which ADDS to the always-on `DEFAULT_SURFACE_SUPPRESS` set.
 */
export function isEventSuppressed(eventType: string, extra?: ReadonlyArray<string>): boolean {
  if (DEFAULT_SURFACE_SUPPRESS.includes(eventType)) return true;
  return extra?.includes(eventType) ?? false;
}

function isSurfaceSuppressed(eventType: string): boolean {
  return isEventSuppressed(eventType, config.suppressEvents);
}

// ── Rate-limited prompt queue ────────────────────────────────────────

interface QueuedNotification {
  level: "actionable" | "informational";
  message: string;
  promptText: string;
}

const notificationQueue: QueuedNotification[] = [];
const deferredBacklog: QueuedNotification[] = [];

function isRateLimited(): boolean {
  return Date.now() - lastPromptTime < RATE_LIMIT_MS;
}

function buildBacklogSuffix(): string {
  if (deferredBacklog.length === 0) return "";
  const lines = [
    "",
    `--- Deferred Backlog (${deferredBacklog.length} event${deferredBacklog.length > 1 ? "s" : ""}) ---`,
    "The following actionable events arrived while you were busy and were deferred.",
    "Please review and address them after your current task:",
  ];
  for (let i = 0; i < deferredBacklog.length; i++) {
    lines.push(`${i + 1}. ${deferredBacklog[i].promptText}`);
  }
  return lines.join("\n");
}

function drainBacklog(): string {
  const suffix = buildBacklogSuffix();
  deferredBacklog.length = 0;
  return suffix;
}

async function flushBacklog(): Promise<void> {
  if (deferredBacklog.length === 0) return;
  if (!config.autoPrompt) {
    deferredBacklog.length = 0;
    return;
  }
  const lines = ["You have deferred Hub events that need attention:"];
  for (let i = 0; i < deferredBacklog.length; i++) {
    lines.push(`${i + 1}. ${deferredBacklog[i].promptText}`);
  }
  lines.push("\nPlease review and address these items.");
  deferredBacklog.length = 0;

  if (!isRateLimited()) {
    await promptLLM(lines.join("\n"));
  } else {
    await injectContext(lines.join("\n"));
  }
}

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
    lastPromptTime = Date.now();
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

async function processNotification(n: QueuedNotification): Promise<void> {
  await showToast(n.message);
  if (!config.autoPrompt) return;

  if (n.level === "actionable") {
    if (isRateLimited()) {
      deferredBacklog.push(n);
      await showToast("Rate limited: queued for follow-up", "warning");
    } else {
      const backlog = drainBacklog();
      await promptLLM(n.promptText + backlog);
    }
  } else {
    await injectContext(n.promptText);
  }
}

async function flushQueue(): Promise<void> {
  if (notificationQueue.length === 0) return;
  const items = notificationQueue.splice(0);
  if (items.length === 1) {
    await processNotification(items[0]);
    return;
  }
  for (const item of items) await showToast(item.message);
  if (!config.autoPrompt) return;

  const lines = ["While you were working, the following Hub events occurred:"];
  for (let i = 0; i < items.length; i++) {
    lines.push(`${i + 1}. ${items[i].promptText}`);
  }
  const hasActionable = items.some((i) => i.level === "actionable");
  if (hasActionable) {
    lines.push("\nPlease address the actionable items above.");
    if (!isRateLimited()) {
      const backlog = drainBacklog();
      await promptLLM(lines.join("\n") + backlog);
    } else {
      for (const item of items) {
        if (item.level === "actionable") deferredBacklog.push(item);
      }
      await showToast("Rate limited: queued for follow-up", "warning");
    }
  } else {
    await injectContext(lines.join("\n"));
  }
}

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

// ── Mission-57 W3: pulse-event detection helper ─────────────────────
//
// Mirrors `claude-plugin/src/source-attribute.ts:isPulseEvent`. Inlined
// here (vs imported) because opencode-plugin doesn't share helpers with
// claude-plugin; the function is small + has no other dependencies.
// Pulse Messages arrive via `message_arrived` events with payload
// containing `pulseKind: "status_check" | "missed_threshold_escalation"`
// (per Hub-side PulseSweeper W2 wire format in Design v1.0 §4 + §5).
//
// Render-side effect: detected pulses downgrade level from "actionable"
// to "informational" (S3 noise mitigation per Design v1.0 §4) so they
// don't wake the LLM during high-activity sub-PR cascades.

const PULSE_KINDS_SET: ReadonlySet<string> = new Set([
  "status_check",
  "missed_threshold_escalation",
]);

function isPulseEvent(eventType: string, eventData: Record<string, unknown>): boolean {
  if (eventType !== "message_arrived" || !eventData) return false;
  const message = eventData.message as { payload?: unknown } | undefined;
  const payload = message?.payload as { pulseKind?: unknown } | undefined;
  return typeof payload?.pulseKind === "string" && PULSE_KINDS_SET.has(payload.pulseKind);
}

// ── Plugin Callbacks ─────────────────────────────────────────────────
//
// Composes the shared dispatcher's pendingActionMap-population callback
// with OpenCode-specific notification/prompt/toast handling. Exported
// for the shim.e2e test to drive synthetic events in isolation.

export function buildPluginCallbacks(): AgentClientCallbacks {
  return {
    onActionableEvent: (event: AgentEvent) => {
      // Shared dispatcher's pendingActionMap population (ADR-017 Phase 1.1).
      dispatcher.callbacks.onActionableEvent?.(event);

      const action = getActionText(event.event, event.data);
      // Mission-57 W3: pulse Messages downgrade level from "actionable"
      // to "informational" (S3 mitigation per Design v1.0 §4 — pulse-
      // noise reduction during high-activity sub-PR cascades). Mirrors
      // claude-plugin's `isPulseEvent` discrimination on
      // `event.event === "message_arrived"` + `payload.pulseKind ∈
      // {status_check, missed_threshold_escalation}`.
      const isPulse = isPulseEvent(event.event, event.data);
      const actionLabel = isPulse ? `[PULSE] ${action}` : action;
      appendNotification(
        { event: event.event, data: event.data, action: actionLabel },
        { logPath: notificationLogPath },
      );
      const message = buildToastMessage(event.event, event.data);
      const promptText = buildPromptText(event.event, event.data, { toolPrefix: "architect-hub_" });
      const notification: QueuedNotification = {
        level: isPulse ? "informational" : "actionable",
        message,
        promptText,
      };
      if (sessionActive) {
        notificationQueue.push(notification);
      } else {
        processNotification(notification);
      }
    },
    onInformationalEvent: (event: AgentEvent) => {
      const action = getActionText(event.event, event.data);
      appendNotification(
        { event: event.event, data: event.data, action: `[INFO] ${action}` },
        { logPath: notificationLogPath },
      );
      // thread-671: presence/telemetry (agent_state_changed) is cache-coherence
      // FYI — logged above, but must NOT toast or inject (TUI flood + context-
      // window burn, tele-12). Suppress AFTER the diagnostic log, before surface.
      if (isSurfaceSuppressed(event.event)) return;
      const message = buildToastMessage(event.event, event.data);
      const promptText = buildPromptText(event.event, event.data, { toolPrefix: "architect-hub_" });
      const notification: QueuedNotification = { level: "informational", message, promptText };
      if (sessionActive) {
        notificationQueue.push(notification);
      } else {
        processNotification(notification);
      }
    },
    onStateChange: (state: SessionState, prev: SessionState, reason?: SessionReconnectReason) => {
      log(`Connection: ${prev} → ${state}${reason ? ` (${reason})` : ""}`);
      if (state === "streaming") {
        syncTools();
      }
    },
  };
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
        getClientInfo: () => ({
          name: "opencode",
          version: process.env.OPENCODE_VERSION ?? "unknown",
        }),
        llmModel: process.env.HUB_LLM_MODEL,
        onFatalHalt,
        onPendingTask: (task) => {
          appendNotification(
            { event: "task_issued", data: task, action: "Pick up with get_task" },
            { logPath: notificationLogPath },
          );
        },
        onPendingActionItem: (item) => {
          pendingActionItemHandler(item);
          const actionHint =
            item.dispatchType === "thread_message"
              ? `Reply with create_thread_reply to thread ${item.entityRef}`
              : `Owed: ${item.dispatchType} on ${item.entityRef}`;
          appendNotification(
            { event: item.dispatchType, data: item.payload, action: actionHint },
            { logPath: notificationLogPath },
          );
          // bug-108: a reconnect-drained pending action arrived while the
          // wire was down — it must WAKE the session, not only log. Mirror
          // onActionableEvent's surface path: build a QueuedNotification and
          // route it through the same notificationQueue / processNotification
          // wake. The drained payload IS the original dispatchPayload (hub
          // thread-policy.ts enqueues `payload: dispatchPayload`), so
          // {event,data} reconstructs the live SSE AgentEvent.
          const isPulse = isPulseEvent(item.dispatchType, item.payload);
          const notification: QueuedNotification = {
            level: isPulse ? "informational" : "actionable",
            message: buildToastMessage(item.dispatchType, item.payload),
            promptText: buildPromptText(item.dispatchType, item.payload, {
              toolPrefix: "architect-hub_",
            }),
          };
          if (sessionActive) {
            notificationQueue.push(notification);
          } else {
            processNotification(notification);
          }
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
  hubAdapter.setCallbacks(buildPluginCallbacks());

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
  // module for buildPluginCallbacks don't require Bun.
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

  config = loadConfig(workDir);
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

      // 2. idea-251 D-prime Phase 2: identity from OIS_AGENT_NAME env. REQUIRED;
      // log + abort connect-flow if absent (OpenCode plugin can't process.exit;
      // operator sees the loud-error in plugin log).
      const agentName = process.env.OIS_AGENT_NAME?.trim();
      if (!agentName) {
        log("[Handshake] FATAL: OIS_AGENT_NAME env var required (idea-251 D-prime). Set in ~/.config/apnex-agents/{name}.env. Plugin inert until restart.");
        return;
      }
      log(`[Handshake] OIS_AGENT_NAME=${agentName}`);

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event: async ({ event }: { event: any }) => {
      switch (event.type) {
        // SDK drift (thread-669): v2 EventSessionCreated/Updated carry the session
        // at `properties.info` (a Session object), NOT `properties.id`. Reading the
        // old 0.4.x `properties.id` returns undefined → currentSessionId froze to the
        // boot-time session.list()[0], so injects landed in a session the TUI wasn't
        // showing (the "Steve replied but Director couldn't see it" root cause). Read
        // `info.id` first, tolerate the legacy flat `.id` as a fallback.
        case "session.created":
          currentSessionId =
            event.properties?.info?.id || event.properties?.id || currentSessionId;
          break;
        case "session.updated": {
          const updatedId = event.properties?.info?.id || event.properties?.id;
          if (updatedId) currentSessionId = updatedId;
          break;
        }
        case "session.status": {
          const status = event.properties?.status;
          if (status === "idle" || status === "completed") {
            sessionActive = false;
            if (notificationQueue.length > 0) await flushQueue();
            else if (deferredBacklog.length > 0) await flushBacklog();
          } else if (status === "running" || status === "pending" || status === "streaming") {
            sessionActive = true;
          }
          break;
        }
        case "session.idle":
          sessionActive = false;
          if (notificationQueue.length > 0) await flushQueue();
          else if (deferredBacklog.length > 0) await flushBacklog();
          if (hubAdapter && !hubAdapter.isConnected) {
            try {
              await hubAdapter.start();
            } catch {
              /* will retry on next idle */
            }
          }
          break;
      }
    },
  };
};

// Test-only exports — let tests validate production code paths
// without spinning up Bun or OpenCode runtime.
export const _testOnly = {
  dispatcher,
  makeOpenCodeFetchHandler,
  getHubAdapter: () => hubAdapter,
  setHubAdapter: (agent: McpAgentClient | null) => {
    hubAdapter = agent;
  },
};
