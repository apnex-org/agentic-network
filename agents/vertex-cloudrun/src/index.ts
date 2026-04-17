/**
 * Architect Agent — Node.js/TypeScript entrypoint for Cloud Run.
 *
 * Phase 14: Complete rewrite from Python/ADK.
 * Express HTTP server + MCP Hub connection + Gemini 3.1 Pro.
 */

import express from "express";
import { HubAdapter } from "./hub-adapter.js";
import { ContextStore } from "./context.js";
import { handleHubEvent, handleWebhookEvent } from "./notifications.js";
import { startEventLoop, stopEventLoop, resetEventLoopTimer, triggerImmediatePoll } from "./event-loop.js";
import { createDirectorChatRouter } from "./director-chat.js";

// ── Configuration ────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "8080", 10);
const HUB_URL =
  process.env.MCP_HUB_URL ||
  "https://mcp-relay-hub-5muxctm3ta-ts.a.run.app/mcp";
const HUB_TOKEN = process.env.HUB_API_TOKEN || "";
const GCS_BUCKET = process.env.GCS_BUCKET || "ois-relay-hub-state";
const CONTEXT_PREFIX = process.env.CONTEXT_PREFIX || "architect-context/";
const EVENT_LOOP_ENABLED =
  (process.env.EVENT_LOOP_ENABLED || "true").toLowerCase() !== "false";
const GLOBAL_INSTANCE_ID = process.env.OIS_GLOBAL_INSTANCE_ID;
const SERVICE_NAME = process.env.K_SERVICE || "architect-cloudrun";
const PROXY_VERSION = process.env.K_REVISION || "0.0.0";

function parseLabels(raw: string | undefined): Record<string, string> | undefined {
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
    console.error(`WARNING: Failed to parse OIS_HUB_LABELS: ${err}`);
  }
  return undefined;
}

// ── Initialize Components ────────────────────────────────────────────

const hub = new HubAdapter(HUB_URL, HUB_TOKEN, "architect", {
  labels: parseLabels(process.env.OIS_HUB_LABELS),
  globalInstanceId: GLOBAL_INSTANCE_ID,
  serviceName: SERVICE_NAME,
  proxyVersion: PROXY_VERSION,
});
const context = new ContextStore({ bucket: GCS_BUCKET, prefix: CONTEXT_PREFIX });

// Wire SSE notifications to handlers
hub.onEvent = (eventData) => {
  handleHubEvent(eventData, hub, context);
};

// Wire State-Based Reconnect: on sync_required, immediately poll
// for pending actions, complete sync, and reset the 300s timer.
hub.onSync(async () => {
  console.log("[Architect] Sync required — polling for pending actions...");
  try {
    await triggerImmediatePoll(hub, context);
  } catch (err) {
    console.error("[Architect] Sync poll failed:", err);
  }
  try {
    hub.completeSync();
    console.log("[Architect] Sync complete — now streaming");
  } catch (err) {
    console.error("[Architect] completeSync() failed:", err);
  }
  resetEventLoopTimer(hub, context);
});

// ── Express App ──────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", version: "2.0.0", runtime: "node" });
});

// Event loop + Hub connection status
app.get("/event-loop/status", (_req, res) => {
  res.json({
    enabled: EVENT_LOOP_ENABLED,
    interval: parseInt(process.env.EVENT_LOOP_INTERVAL || "300", 10),
    hubConnected: hub.isConnected,
    sseListenerActive: hub.onEvent !== null,
  });
});

// Webhook fallback (same dispatch as SSE)
app.post("/webhook/hub-event", (req, res) => {
  const { event, ...data } = req.body as Record<string, unknown>;
  if (typeof event === "string") {
    handleWebhookEvent(event, data, hub, context);
    res.json({ status: "ok", event, action: "webhook_processed" });
  } else {
    res.status(400).json({ error: "Missing event field" });
  }
});

// Director chat API
const chatRouter = createDirectorChatRouter(hub, context);
app.use(chatRouter);

// ── Startup ──────────────────────────────────────────────────────────

async function startup(): Promise<void> {
  console.log("[Architect] Phase 14 — Node.js/TypeScript");
  console.log(`[Architect] Hub: ${HUB_URL}`);
  console.log(`[Architect] GCS: gs://${GCS_BUCKET}/${CONTEXT_PREFIX}`);

  // Connect to Hub (non-blocking — reconnects automatically)
  try {
    await hub.connect();
  } catch (err) {
    console.error("[Architect] Initial Hub connection failed:", err);
    // Will reconnect via adapter's reconnect loop
  }

  // Start event loop
  if (EVENT_LOOP_ENABLED) {
    startEventLoop(hub, context);
  }

  // Start Express
  const server = app.listen(PORT, () => {
    console.log(`[Architect] Listening on port ${PORT}`);
  });

  // ── Graceful Shutdown ────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    console.log(`[Architect] ${signal} received, shutting down...`);
    stopEventLoop();
    await hub.close();
    server.close(() => {
      console.log("[Architect] Shutdown complete");
      process.exit(0);
    });
    // Force exit after 10s
    setTimeout(() => process.exit(1), 10000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startup().catch((err) => {
  console.error("[Architect] Fatal startup error:", err);
  process.exit(1);
});
