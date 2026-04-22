/**
 * shim.ts — Claude Code ↔ Hub last-mile shim (platform entry).
 *
 * Claude-specific wiring only: stdio transport, config loading, process
 * lifecycle. All MCP tool dispatching + Hub event bridging lives in
 * dispatcher.ts (host-independent and testable).
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  McpAgentClient,
  loadOrCreateGlobalInstanceId,
  appendNotification,
  makeStdioFatalHalt,
  type HandshakeResponse,
  type TelemetryEvent,
} from "@ois/network-adapter";
import { CognitivePipeline } from "@ois/cognitive-layer";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createDispatcher, makePendingActionItemHandler } from "./dispatcher.js";

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
const PROXY_VERSION = "1.1.0";
const SDK_VERSION = "@ois/network-adapter@2.0.0";

// ── Logging (stderr + shared structured log) ────────────────────────

function log(msg: string): void {
  const ts = new Date().toISOString().replace("T", " ").replace("Z", "");
  process.stderr.write(`[${ts}] ${msg}\n`);
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

  // Dispatcher-first, agent-second wiring: the dispatcher owns the MCP
  // Server instance + captured clientInfo + pendingActionMap. The agent
  // receives dispatcher.getClientInfo as its handshake callback so
  // clientInfo flows through whenever it's captured from Claude Code.
  // We create a forward reference the agent can close over before it
  // exists.
  let dispatcherRef: ReturnType<typeof createDispatcher> | null = null;
  const getClientInfo = () => (dispatcherRef ? dispatcherRef.getClientInfo() : { name: "unknown", version: "0.0.0" });

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
          log(`[Handshake] complete: ${r.engineerId} epoch=${r.sessionEpoch}`);
        },
        onPendingTask: (task) => {
          appendNotification(
            { event: "task_issued", data: task, action: "Pick up with get_task" },
            { logPath: LOG_FILE, mirror: (block) => process.stderr.write(block) },
          );
        },
        onPendingActionItem: (item) => {
          if (dispatcherRef) {
            makePendingActionItemHandler(dispatcherRef, {
              logPath: LOG_FILE,
              mirror: (block) => process.stderr.write(block),
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
      // M-Cognitive-Hypervisor Phase 2x P1-5 — engineer-side pipeline
      // wiring. Mirrors the architect's ckpt-C change (commit 0d08a33):
      // ResponseSummarizer trims oversized Hub responses, ToolResultCache
      // collapses repeated reads within a conversation, WriteCallDedup
      // collapses concurrent duplicate writes, CircuitBreaker fast-fails
      // on repeated Hub failures. Telemetry events land on stderr via
      // the existing `log()` channel for observability parity with
      // other plugin-side diagnostics.
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

  // Hub handshake runs in parallel with stdio open (see below). The
  // dispatcher gates its tool-dispatch handlers on `agentReady` so a
  // listTools / callTool arriving in the race window waits rather than
  // failing with `session state=connecting`. The MCP `initialize` handler
  // is intentionally NOT gated — Claude Code's initialize timeout is
  // tighter than the 600–1200ms Hub handshake, and a missed initialize
  // ACK is a deterministic startup failure (the symptom that motivated
  // this ordering — see docs/reviews/bug-candidate-adapter-startup-race.md).
  let resolveAgentReady!: () => void;
  let rejectAgentReady!: (err: unknown) => void;
  const agentReady = new Promise<void>((resolve, reject) => {
    resolveAgentReady = resolve;
    rejectAgentReady = reject;
  });
  // Swallow unhandled rejection — main()'s catch handles fatal exit; the
  // promise reject path exists so any awaiting tool-dispatch handler
  // surfaces a real error instead of hanging.
  agentReady.catch(() => { /* observed by handlers; main() rethrows */ });

  const dispatcher = createDispatcher({
    agent,
    proxyVersion: PROXY_VERSION,
    log,
    notification: {
      logPath: LOG_FILE,
      mirror: (block) => process.stderr.write(block),
    },
    agentReady,
  });
  dispatcherRef = dispatcher;

  agent.setCallbacks(dispatcher.callbacks);

  // Open stdio FIRST so the host's MCP `initialize` request is ACKed
  // within its timeout, then run the Hub handshake. Tool-dispatch
  // handlers wait on `agentReady` if they fire before the handshake
  // resolves.
  const transport = new StdioServerTransport();
  transport.onclose = () => {
    shutdown();
  };
  await dispatcher.server.connect(transport);
  log("MCP stdio server ready — Claude Code can call initialize/listTools/callTool");

  try {
    await agent.start();
    resolveAgentReady();
    log("Hub connection established");
  } catch (err) {
    rejectAgentReady(err);
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
