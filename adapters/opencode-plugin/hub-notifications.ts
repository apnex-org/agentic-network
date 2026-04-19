/**
 * Universal MCP Network Adapter — OpenCode Plugin Shim
 *
 * Last-mile shim for OpenCode. All protocol, identity, state-sync, and
 * observability lives in @ois/network-adapter. This file exists only to
 * bridge the shared adapter to OpenCode-specific concerns:
 *   - Bun.serve local MCP proxy (OpenCode consumes MCP over HTTP, not stdio)
 *   - OpenCode SDK integration (promptAsync, showToast, session events)
 *   - Rate-limited prompt queue + deferred backlog (promptAsync is expensive)
 *   - Tool discovery sync (tools/list_changed after Hub reconnect)
 *
 * Configuration: .ois/hub-config.json (env vars override)
 */

import type { Plugin } from "@opencode-ai/plugin"
import {
  McpAgentClient,
  McpTransport,
  loadOrCreateGlobalInstanceId,
  appendNotification,
  getActionText,
  buildPromptText,
  buildToastMessage,
  type AgentClientCallbacks,
  type AgentEvent,
  type SessionState,
  type SessionReconnectReason,
  type HandshakeFatalError,
  type DrainedPendingAction,
} from "@ois/network-adapter"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { readFileSync, appendFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"

// ── Module state ─────────────────────────────────────────────────────

const PROXY_VERSION = "4.1.0"
const SDK_VERSION = "@ois/network-adapter@2.0.0"
const RATE_LIMIT_MS = 30_000

let diagLogPath = ""
let notificationLogPath = ""
let hubAdapter: McpAgentClient | null = null

/**
 * ADR-017: local map from `${dispatchType}:${entityRef}` → queueItemId.
 * Populated by onPendingActionItem on every drain; consumed by the
 * CallToolRequestSchema handler to inject sourceQueueItemId into
 * settling tool calls (currently create_thread_reply).
 */
const pendingActionMap = new Map<string, string>()

function pendingKey(dispatchType: string, entityRef: string): string {
  return `${dispatchType}:${entityRef}`
}
let proxyPort = 0
let sdkClient: any = null
let currentSessionId: string | null = null
let sessionActive = false
let config: HubConfig
let lastPromptTime = 0
let lastToolHash = ""
const activeProxyServers: Server[] = []

// ── Diagnostic logger (stderr-safe, writes to hub-plugin.log) ───────

function initLogger(directory: string): void {
  diagLogPath = join(directory, ".ois", "hub-plugin.log")
  notificationLogPath = join(directory, ".ois", "hub-plugin-notifications.log")
  try {
    mkdirSync(dirname(diagLogPath), { recursive: true })
  } catch {
    /* directory exists */
  }
}

function log(msg: string): void {
  if (!diagLogPath) return
  const line = `${new Date().toISOString()} ${msg}\n`
  try {
    appendFileSync(diagLogPath, line)
  } catch {
    /* silently fail — don't pollute TUI */
  }
}

// ── Configuration ────────────────────────────────────────────────────

interface HubConfig {
  hubUrl: string
  hubToken: string
  autoPrompt: boolean
  role: string
  /**
   * Mission-19 routing labels. Stamped onto the Agent entity via the
   * enriched register_role handshake; scoped dispatches filter by these.
   * From hub-config.json `labels` field or OIS_HUB_LABELS env var (JSON).
   */
  labels?: Record<string, string>
}

function parseLabels(raw: string | undefined, source: string): Record<string, string> | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") out[k] = v
      }
      return Object.keys(out).length > 0 ? out : undefined
    }
  } catch (err) {
    log(`WARNING: Failed to parse labels from ${source}: ${err}`)
  }
  return undefined
}

function loadConfig(directory: string): HubConfig {
  let cfg: HubConfig = {
    hubUrl: "https://mcp-relay-hub-5muxctm3ta-ts.a.run.app/mcp",
    hubToken: "",
    autoPrompt: true,
    role: "engineer",
  }
  try {
    const configPath = join(directory, ".ois", "hub-config.json")
    const raw = readFileSync(configPath, "utf-8")
    cfg = { ...cfg, ...JSON.parse(raw) }
  } catch {
    /* no config file — use defaults */
  }
  if (process.env.OIS_HUB_URL) cfg.hubUrl = process.env.OIS_HUB_URL
  if (process.env.OIS_HUB_TOKEN) cfg.hubToken = process.env.OIS_HUB_TOKEN
  if (process.env.OIS_HUB_ROLE) cfg.role = process.env.OIS_HUB_ROLE
  if (process.env.HUB_PLUGIN_AUTO_PROMPT)
    cfg.autoPrompt = process.env.HUB_PLUGIN_AUTO_PROMPT.toLowerCase() !== "false"
  const envLabels = parseLabels(process.env.OIS_HUB_LABELS, "OIS_HUB_LABELS env var")
  if (envLabels) cfg.labels = envLabels
  return cfg
}

// ── Rate-limited prompt queue ────────────────────────────────────────

interface QueuedNotification {
  level: "actionable" | "informational"
  message: string
  promptText: string
}

const notificationQueue: QueuedNotification[] = []
const deferredBacklog: QueuedNotification[] = []

function isRateLimited(): boolean {
  return Date.now() - lastPromptTime < RATE_LIMIT_MS
}

function buildBacklogSuffix(): string {
  if (deferredBacklog.length === 0) return ""
  const lines = [
    "",
    `--- Deferred Backlog (${deferredBacklog.length} event${deferredBacklog.length > 1 ? "s" : ""}) ---`,
    "The following actionable events arrived while you were busy and were deferred.",
    "Please review and address them after your current task:",
  ]
  for (let i = 0; i < deferredBacklog.length; i++) {
    lines.push(`${i + 1}. ${deferredBacklog[i].promptText}`)
  }
  return lines.join("\n")
}

function drainBacklog(): string {
  const suffix = buildBacklogSuffix()
  deferredBacklog.length = 0
  return suffix
}

async function flushBacklog(): Promise<void> {
  if (deferredBacklog.length === 0) return
  if (!config.autoPrompt) {
    deferredBacklog.length = 0
    return
  }
  const lines = ["You have deferred Hub events that need attention:"]
  for (let i = 0; i < deferredBacklog.length; i++) {
    lines.push(`${i + 1}. ${deferredBacklog[i].promptText}`)
  }
  lines.push("\nPlease review and address these items.")
  deferredBacklog.length = 0

  if (!isRateLimited()) {
    await promptLLM(lines.join("\n"))
  } else {
    await injectContext(lines.join("\n"))
  }
}

// ── OpenCode SDK integration ─────────────────────────────────────────

async function showToast(message: string, variant: string = "info"): Promise<void> {
  if (!sdkClient) return
  try {
    await sdkClient.tui.showToast({ body: { message, variant } })
  } catch {
    /* TUI may not be ready */
  }
}

async function promptLLM(text: string): Promise<void> {
  if (!sdkClient || !currentSessionId) return
  try {
    lastPromptTime = Date.now()
    await sdkClient.session.promptAsync({
      path: { id: currentSessionId },
      body: { parts: [{ type: "text", text }] },
    })
  } catch (err) {
    log(`Prompt failed: ${err}`)
  }
}

async function injectContext(text: string): Promise<void> {
  if (!sdkClient || !currentSessionId) return
  try {
    await sdkClient.session.promptAsync({
      path: { id: currentSessionId },
      body: {
        noReply: true,
        system: true,
        parts: [{ type: "text", text: `[Hub Notification] ${text}` }],
      },
    })
  } catch (err) {
    log(`Context injection failed: ${err}`)
  }
}

async function processNotification(n: QueuedNotification): Promise<void> {
  await showToast(n.message)
  if (!config.autoPrompt) return

  if (n.level === "actionable") {
    if (isRateLimited()) {
      deferredBacklog.push(n)
      await showToast("Rate limited: queued for follow-up", "warning")
    } else {
      const backlog = drainBacklog()
      await promptLLM(n.promptText + backlog)
    }
  } else {
    await injectContext(n.promptText)
  }
}

async function flushQueue(): Promise<void> {
  if (notificationQueue.length === 0) return
  const items = notificationQueue.splice(0)
  if (items.length === 1) {
    await processNotification(items[0])
    return
  }
  for (const item of items) await showToast(item.message)
  if (!config.autoPrompt) return

  const lines = ["While you were working, the following Hub events occurred:"]
  for (let i = 0; i < items.length; i++) {
    lines.push(`${i + 1}. ${items[i].promptText}`)
  }
  const hasActionable = items.some((i) => i.level === "actionable")
  if (hasActionable) {
    lines.push("\nPlease address the actionable items above.")
    if (!isRateLimited()) {
      const backlog = drainBacklog()
      await promptLLM(lines.join("\n") + backlog)
    } else {
      for (const item of items) {
        if (item.level === "actionable") deferredBacklog.push(item)
      }
      await showToast("Rate limited: queued for follow-up", "warning")
    }
  } else {
    await injectContext(lines.join("\n"))
  }
}

// ── Tool discovery sync ──────────────────────────────────────────────

function computeToolHash(tools: unknown[]): string {
  const sorted = [...tools].sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""))
  const canonical = sorted.map((t: any) => `${t.name}:${JSON.stringify(t.inputSchema || {})}`).join("|")
  let hash = 0
  for (let i = 0; i < canonical.length; i++) {
    hash = ((hash << 5) - hash + canonical.charCodeAt(i)) | 0
  }
  return hash.toString(36)
}

async function syncTools(): Promise<void> {
  if (!hubAdapter) return
  const s = hubAdapter.state
  if (s !== "streaming" && s !== "synchronizing") return

  try {
    const transport = hubAdapter.getTransport() as McpTransport
    const tools = await transport.listToolsRaw()
    const newHash = computeToolHash(tools)
    const isFirstSync = lastToolHash === ""

    if (isFirstSync) {
      lastToolHash = newHash
      log(`[ToolSync] Initial tool hash: ${newHash} (${tools.length} tools)`)
    } else if (newHash === lastToolHash) {
      log(`[ToolSync] Tools unchanged (hash: ${newHash})`)
      return
    } else {
      log(`[ToolSync] Tools changed! Old: ${lastToolHash}, New: ${newHash} (${tools.length} tools)`)
      lastToolHash = newHash
    }

    for (const server of activeProxyServers) {
      try {
        await server.sendToolListChanged()
        log(`[ToolSync] Sent tools/list_changed to proxy server`)
      } catch (err) {
        log(`[ToolSync] Failed to send tools/list_changed: ${err}`)
      }
    }

    await showToast(isFirstSync ? "Hub connected — tools available" : "Hub tools updated following reconnection", "success")
    log(`[ToolSync] Tool sync complete — OpenCode notified`)
  } catch (err) {
    log(`[ToolSync] Failed to sync tools: ${err}`)
  }
}

// ── Plugin Callbacks ─────────────────────────────────────────────────

function buildPluginCallbacks(): AgentClientCallbacks {
  return {
    onActionableEvent: (event: AgentEvent) => {
      const action = getActionText(event.event, event.data)
      appendNotification(
        { event: event.event, data: event.data, action },
        { logPath: notificationLogPath }
      )
      const message = buildToastMessage(event.event, event.data)
      const promptText = buildPromptText(event.event, event.data, { toolPrefix: "architect-hub_" })
      const notification: QueuedNotification = { level: "actionable", message, promptText }
      if (sessionActive) {
        notificationQueue.push(notification)
      } else {
        processNotification(notification)
      }
    },
    onInformationalEvent: (event: AgentEvent) => {
      const action = getActionText(event.event, event.data)
      appendNotification(
        { event: event.event, data: event.data, action: `[INFO] ${action}` },
        { logPath: notificationLogPath }
      )
      const message = buildToastMessage(event.event, event.data)
      const promptText = buildPromptText(event.event, event.data, { toolPrefix: "architect-hub_" })
      const notification: QueuedNotification = { level: "informational", message, promptText }
      if (sessionActive) {
        notificationQueue.push(notification)
      } else {
        processNotification(notification)
      }
    },
    onStateChange: (state: SessionState, prev: SessionState, reason?: SessionReconnectReason) => {
      log(`Connection: ${prev} → ${state}${reason ? ` (${reason})` : ""}`)
      if (state === "streaming") {
        syncTools()
      }
    },
  }
}

// ── Local MCP proxy server (Bun.serve) ───────────────────────────────

const proxyTransports = new Map<string, WebStandardStreamableHTTPServerTransport>()

function createProxyServer(): Server {
  const server = new Server(
    { name: "hub-proxy", version: PROXY_VERSION },
    { capabilities: { tools: {}, logging: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (!hubAdapter || !hubAdapter.isConnected) return { tools: [] }
    const transport = hubAdapter.getTransport() as McpTransport
    const tools = await transport.listToolsRaw()
    return { tools }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (!hubAdapter || !hubAdapter.isConnected) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ error: "Hub not connected", message: "The Hub adapter is not currently connected." }),
        }],
      }
    }
    // ADR-017: inject sourceQueueItemId on settling tool calls. Thread
    // replies look up the pending-action queue-item id by threadId. If
    // the caller already supplied the id explicitly, that wins. Entry
    // is removed on successful forward (Hub completion-ack is idempotent).
    const { name } = request.params
    let outgoingArgs: Record<string, unknown> = (request.params.arguments ?? {}) as Record<string, unknown>
    if (name === "create_thread_reply") {
      const threadId = outgoingArgs.threadId
      if (typeof threadId === "string" && !("sourceQueueItemId" in outgoingArgs)) {
        const queueItemId = pendingActionMap.get(pendingKey("thread_message", threadId))
        if (queueItemId) {
          outgoingArgs = { ...outgoingArgs, sourceQueueItemId: queueItemId }
          pendingActionMap.delete(pendingKey("thread_message", threadId))
        }
      }
    }
    try {
      const result = await hubAdapter.call(name, outgoingArgs)
      return {
        content: [{
          type: "text" as const,
          text: typeof result === "string" ? result : JSON.stringify(result),
        }],
      }
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: err.message || String(err) }) }],
      }
    }
  })

  return server
}

async function startProxyServer(): Promise<number> {
  const httpServer = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)
      if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 })

      const sessionId = req.headers.get("mcp-session-id")
      if (sessionId && proxyTransports.has(sessionId)) {
        return proxyTransports.get(sessionId)!.handleRequest(req)
      }

      if (req.method === "POST") {
        const body = await req.json()
        if (isInitializeRequest(body)) {
          const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (sid) => { proxyTransports.set(sid, transport) },
          })
          transport.onclose = () => {
            if (transport.sessionId) proxyTransports.delete(transport.sessionId)
          }
          const server = createProxyServer()
          activeProxyServers.push(server)
          await server.connect(transport)
          return transport.handleRequest(req, { parsedBody: body })
        }
      }

      return new Response(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request" }, id: null }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      )
    },
  })

  const port = httpServer.port
  log(`Local proxy server listening on 127.0.0.1:${port}`)
  return port
}

// ── Connect to Hub ───────────────────────────────────────────────────

async function connectToHub(globalInstanceId: string): Promise<void> {
  const onFatalHalt = (err: HandshakeFatalError): void => {
    log(`[FATAL:${err.code}] ${err.message}`)
    showToast(`Hub fatal: ${err.code}`, "error")
    // OpenCode has no clean process-exit path from a plugin — the best we can
    // do is log loudly, surface to the user, and let the adapter stop
    // reconnecting. The plugin will remain loaded but inert until OpenCode
    // restarts. Do NOT call process.exit — that would kill the whole TUI.
  }

  if (config.labels) {
    log(`Labels: ${JSON.stringify(config.labels)}`)
  }

  hubAdapter = new McpAgentClient(
    {
      role: config.role,
      labels: config.labels,
      logger: log,
      handshake: {
        globalInstanceId,
        proxyName: "@ois/opencode-plugin",
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
            { logPath: notificationLogPath }
          )
        },
        onPendingActionItem: (item: DrainedPendingAction) => {
          // ADR-017: stash queue-item id keyed by {dispatchType, entityRef}.
          // The CallToolRequestSchema handler injects sourceQueueItemId on
          // the settling tool call (e.g., create_thread_reply).
          pendingActionMap.set(pendingKey(item.dispatchType, item.entityRef), item.id)
          const actionHint = item.dispatchType === "thread_message"
            ? `Reply with create_thread_reply to thread ${item.entityRef}`
            : `Owed: ${item.dispatchType} on ${item.entityRef}`
          appendNotification(
            { event: item.dispatchType, data: item.payload, action: actionHint },
            { logPath: notificationLogPath }
          )
        },
      },
    },
    {
      transportConfig: { url: config.hubUrl, token: config.hubToken },
    },
  )
  hubAdapter.setCallbacks(buildPluginCallbacks())

  await hubAdapter.start()
  log("Connected to remote Hub via McpAgentClient")
}

// ── Plugin Export ────────────────────────────────────────────────────
// CRITICAL: No awaits during init. Everything deferred to background.

export const HubPlugin: Plugin = async (ctx) => {
  initLogger(ctx.directory)
  log(`Phase 15 — Shared-adapter refactor (${SDK_VERSION})`)

  config = loadConfig(ctx.directory)
  log(`Auto-prompt: ${config.autoPrompt ? "enabled" : "DISABLED"}`)

  sdkClient = ctx.client

  setTimeout(async () => {
    try {
      // 1. Capture current session ID
      try {
        const sessions = await sdkClient.session.list()
        if (sessions.data && sessions.data.length > 0) {
          const sorted = [...sessions.data].sort(
            (a: any, b: any) =>
              new Date(b.updatedAt || b.createdAt).getTime() -
              new Date(a.updatedAt || a.createdAt).getTime(),
          )
          currentSessionId = sorted[0].id
          log(`Tracking session: ${currentSessionId?.substring(0, 8)}...`)
        }
      } catch (err) {
        log(`Session list failed: ${err}`)
      }

      // 2. globalInstanceId bootstrap
      const globalInstanceId = loadOrCreateGlobalInstanceId({ log })
      log(`[Handshake] globalInstanceId=${globalInstanceId}`)

      // 3. Connect to remote Hub
      try {
        await connectToHub(globalInstanceId)
      } catch (err) {
        log(`Hub connection failed: ${err}`)
        return
      }

      // 4. Start local MCP proxy server
      try {
        proxyPort = await startProxyServer()
      } catch (err) {
        log(`Proxy server failed: ${err}`)
        return
      }

      // 5. Register proxy with OpenCode
      try {
        await sdkClient.mcp.add({
          body: {
            name: "architect-hub",
            config: { type: "remote" as const, url: `http://127.0.0.1:${proxyPort}/mcp` },
          },
        })
        log("Registered proxy as 'architect-hub' MCP server")
      } catch (err) {
        log(`MCP registration failed: ${err}`)
      }

      log("Fully initialized")
      await showToast("Hub connected", "success")
    } catch (err) {
      log(`Background init failed: ${err}`)
    }
  }, 3000)

  return {
    event: async ({ event }: { event: any }) => {
      switch (event.type) {
        case "session.created":
          currentSessionId = event.properties?.id || currentSessionId
          break
        case "session.updated":
          if (event.properties?.id) currentSessionId = event.properties.id
          break
        case "session.status": {
          const status = event.properties?.status
          if (status === "idle" || status === "completed") {
            sessionActive = false
            if (notificationQueue.length > 0) await flushQueue()
            else if (deferredBacklog.length > 0) await flushBacklog()
          } else if (status === "running" || status === "pending" || status === "streaming") {
            sessionActive = true
          }
          break
        }
        case "session.idle":
          sessionActive = false
          if (notificationQueue.length > 0) await flushQueue()
          else if (deferredBacklog.length > 0) await flushBacklog()
          if (hubAdapter && !hubAdapter.isConnected) {
            try {
              await hubAdapter.start()
            } catch {
              /* will retry on next idle */
            }
          }
          break
      }
    },
  }
}
