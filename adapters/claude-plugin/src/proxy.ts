/**
 * proxy.ts — Pass-Through Proxy for Claude Code ↔ MCP Relay Hub.
 *
 * Last-mile shim. All protocol, identity, state-sync, and observability
 * code lives in @ois/network-adapter. This file exists only to bridge:
 *   - stdio MCP Server (Claude Code <=> proxy)
 *   - clientInfo capture via InitializeRequestSchema override
 *   - claude/channel push notifications (research preview feature)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  InitializeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  McpAgentClient,
  McpTransport,
  loadOrCreateGlobalInstanceId,
  appendNotification,
  getActionText,
  buildPromptText,
  makeStdioFatalHalt,
  type AgentClientCallbacks,
  type AgentEvent,
  type SessionState,
  type SessionReconnectReason,
  type HandshakeResponse,
} from "@ois/network-adapter";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

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
    parseLabels(process.env.OIS_HUB_LABELS, "OIS_HUB_LABELS env var") ??
    fileConfig.labels;

  if (!hubUrl || !hubToken) {
    console.error("ERROR: Hub credentials not found. Checked .ois/hub-config.json and OIS_HUB_URL/OIS_HUB_TOKEN env vars");
    process.exit(1);
  }

  return { hubUrl, hubToken, role, labels };
}

const config = loadConfig();
const WORK_DIR = process.env.WORK_DIR || process.cwd();
const LOG_FILE = join(WORK_DIR, ".ois", "claude-notifications.log");
const SHUTDOWN_TIMEOUT_MS = 3000;
const PROXY_VERSION = "1.1.0";
const SDK_VERSION = "@ois/network-adapter@2.0.0";

// ── Logging (stderr + shared structured log) ────────────────────────

function log(msg: string): void {
  const ts = new Date().toISOString().replace("T", " ").replace("Z", "");
  process.stderr.write(`[${ts}] ${msg}\n`);
}

// ── clientInfo capture ──────────────────────────────────────────────

let capturedClientInfo = { name: "unknown", version: "0.0.0" };

// ── Channel push (research preview feature) ─────────────────────────

let mcpServer: Server | null = null;

function pushChannelNotification(event: AgentEvent, level: "actionable" | "informational"): void {
  if (!mcpServer) {
    log("[Channel] server not set — cannot push notification");
    return;
  }
  const content = buildPromptText(event.event, event.data, { toolPrefix: "mcp__plugin_agent-adapter_proxy__" });
  const meta: Record<string, unknown> = { event: event.event, source: "hub", level };
  if (event.data.taskId) meta.taskId = event.data.taskId;
  if (event.data.threadId) meta.threadId = event.data.threadId;
  if (event.data.proposalId) meta.proposalId = event.data.proposalId;

  mcpServer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .notification({
      method: "notifications/claude/channel",
      params: { content, meta },
    } as any)
    .then(() => log(`[Channel] Pushed ${event.event} (${level})`))
    .catch((err: unknown) => log(`[Channel] Push failed for ${event.event}: ${err}`));
}

function buildCallbacks(): AgentClientCallbacks {
  return {
    onActionableEvent: (event) => {
      const action = getActionText(event.event, event.data);
      appendNotification({ event: event.event, data: event.data, action }, {
        logPath: LOG_FILE,
        mirror: (block) => process.stderr.write(block),
      });
      pushChannelNotification(event, "actionable");
    },
    onInformationalEvent: (event) => {
      const action = getActionText(event.event, event.data);
      appendNotification(
        { event: event.event, data: event.data, action: `[INFO] ${action}` },
        { logPath: LOG_FILE, mirror: (block) => process.stderr.write(block) }
      );
      // Informational events are logged but NOT pushed — they would otherwise
      // wake the LLM for no reason.
    },
    onStateChange: (
      state: SessionState,
      prev: SessionState,
      reason?: SessionReconnectReason
    ) => {
      log(`Connection: ${prev} → ${state}${reason ? ` (${reason})` : ""}`);
    },
  };
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
        getClientInfo: () => capturedClientInfo,
        llmModel: process.env.HUB_LLM_MODEL,
        onFatalHalt: fatalHalt,
        onHandshakeComplete: (r: HandshakeResponse) => {
          log(`[Handshake] complete: ${r.engineerId} epoch=${r.sessionEpoch}`);
        },
        onPendingTask: (task) => {
          appendNotification(
            { event: "directive_issued", data: task, action: "Pick up with get_task" },
            { logPath: LOG_FILE, mirror: (block) => process.stderr.write(block) }
          );
        },
      },
    },
    {
      transportConfig: {
        url: config.hubUrl,
        token: config.hubToken,
      },
    }
  );
  agent.setCallbacks(buildCallbacks());

  await agent.start();
  log("Hub connection established");

  const server = new Server(
    { name: "proxy", version: PROXY_VERSION },
    {
      capabilities: {
        tools: {},
        experimental: { "claude/channel": {} },
      },
    }
  );
  mcpServer = server;

  server.setRequestHandler(InitializeRequestSchema, async (request) => {
    try {
      const ci = (request.params as { clientInfo?: { name: string; version: string } }).clientInfo;
      if (ci && typeof ci.name === "string" && typeof ci.version === "string") {
        capturedClientInfo = { name: ci.name, version: ci.version };
        log(`[Handshake] Captured clientInfo: ${ci.name}@${ci.version}`);
      }
    } catch (err) {
      log(`[Handshake] clientInfo capture failed (non-fatal): ${err}`);
    }
    return {
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {}, experimental: { "claude/channel": {} } },
      serverInfo: { name: "proxy", version: PROXY_VERSION },
    };
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const transport = agent!.getTransport() as McpTransport;
    const tools = await transport.listToolsRaw();
    return { tools: tools as any[] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await agent!.call(name, args ?? {});
      return {
        content: [
          { type: "text" as const, text: typeof result === "string" ? result : JSON.stringify(result, null, 2) },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  transport.onclose = () => { shutdown(); };
  await server.connect(transport);
  log("MCP stdio server ready — Claude Code can now call Hub tools");

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
