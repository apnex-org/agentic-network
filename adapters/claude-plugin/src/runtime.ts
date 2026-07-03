/**
 * runtime.ts — importable Claude runtime wiring seam.
 *
 * Side-effect-free factory extracted from shim.ts for mission-100 W2. Production
 * shim.ts still owns process/config/bootstrap side effects; this module owns the
 * reusable runtime wiring that tests and MockClaudeClient can consume instead of
 * re-creating the dispatcher/server/reconciler shape by hand.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  buildPromptText,
  createSharedDispatcher,
  isCacheValid,
  readCache,
  writeCache,
  ToolSurfaceReconciler,
  serverCapabilitiesFromManifest,
  type AgentEvent,
  type McpAgentClient,
  type SharedDispatcher,
} from "@apnex/network-adapter";

import { isPulseEvent } from "./source-attribute.js";
import {
  pushChannelNotification,
  surfacePendingActionItem,
} from "./notification-surface.js";

export type ClaudeRuntimeManifest = Parameters<typeof serverCapabilitiesFromManifest>[0] & {
  serverName: string;
  toolPrefix: string;
};

export interface ClaudeRuntimeOptions {
  agent: McpAgentClient;
  mcpTransport: Transport;
  manifest: ClaudeRuntimeManifest;
  proxyVersion: string;
  workDir: string;
  role: "architect" | "engineer" | "director" | "verifier";
  log: (msg: string) => void;
  notificationLogPath: string;
  mirrorNotification?: (block: string) => void;
  listToolsGate: Promise<void>;
  callToolGate: Promise<void>;
  identityReady: Promise<void>;
  getIsIdentityReady: () => boolean;
  getCurrentToolSurfaceRevision: () => string | null;
  fetchLiveToolSurfaceRevision: () => Promise<string | null>;
  appendActionableLog: (event: AgentEvent, action: string) => void;
}

export interface ClaudeRuntime {
  dispatcher: SharedDispatcher;
  mcpServer: Server;
  reconciler: ToolSurfaceReconciler;
}

/**
 * Build and connect the real Claude MCP runtime.
 *
 * This is the production seam tests should import. It creates the same shared
 * dispatcher, MCP server, cache/list_changed reconciler, notification hooks, and
 * pollBackstop hook that shim.ts uses in production; callers supply host-specific
 * process/config dependencies and transports.
 */
export async function createClaudeRuntime(opts: ClaudeRuntimeOptions): Promise<ClaudeRuntime> {
  let reconciler: ToolSurfaceReconciler | null = null;
  let mcpServer: Server | null = null;

  const dispatcher = createSharedDispatcher({
    getAgent: () => opts.agent,
    proxyVersion: opts.proxyVersion,
    serverName: opts.manifest.serverName,
    serverCapabilities: serverCapabilitiesFromManifest(opts.manifest),
    log: opts.log,
    listToolsGate: opts.listToolsGate,
    callToolGate: opts.callToolGate,
    getCachedCatalog: () => readCache(opts.workDir, opts.log),
    getIsIdentityReady: opts.getIsIdentityReady,
    getCurrentToolSurfaceRevision: opts.getCurrentToolSurfaceRevision,
    isCacheValid,
    persistCatalog: (catalog) => {
      // Best-effort persist. Skip if we don't yet have a tool-surface revision to
      // tag — better to let the next live-fetch populate the cache than write a
      // revision-less entry.
      const revision = opts.getCurrentToolSurfaceRevision();
      if (revision === null) {
        opts.log("[Cache] Skipping persistCatalog — tool-surface revision not yet resolved");
        return;
      }
      writeCache(opts.workDir, catalog, revision, opts.log);
    },
    notificationHooks: {
      onActionableEvent: (event) => {
        opts.appendActionableLog(
          event,
          buildPromptText(event.event, event.data, { toolPrefix: opts.manifest.toolPrefix }),
        );
        // Mission-57 W3: pulse Messages downgrade level from "actionable" to
        // "informational" (S3 mitigation per Design v1.0 §4).
        const level = isPulseEvent(event.event, event.data) ? "informational" : "actionable";
        pushChannelNotification(mcpServer, event, level, opts.log);
      },
      onInformationalEvent: (event) => {
        // Informational events log only — `<channel>` push would otherwise wake
        // the LLM. Diagnostic-only routing.
        opts.appendActionableLog(
          event,
          `[INFO] ${buildPromptText(event.event, event.data, { toolPrefix: opts.manifest.toolPrefix })}`,
        );
      },
    },
    pollBackstop: {
      role: opts.role,
      firstTimerEnabled: true,
      log: opts.log,
      onHeartbeatTick: async () => {
        await reconciler?.reconcile("heartbeat");
      },
    },
  });

  opts.agent.setCallbacks(dispatcher.callbacks);

  mcpServer = dispatcher.createMcpServer();
  await mcpServer.connect(opts.mcpTransport);

  const liveReconciler = new ToolSurfaceReconciler({
    fetchLiveRevision: opts.fetchLiveToolSurfaceRevision,
    readServedRevision: () => readCache(opts.workDir, opts.log)?.toolSurfaceRevision ?? null,
    emitListChanged: () => {
      void mcpServer?.sendToolListChanged();
      opts.log("[ToolSurface] notifications/tools/list_changed emitted — host will re-enumerate");
    },
    log: opts.log,
  });
  reconciler = liveReconciler;

  opts.identityReady
    .then(() => liveReconciler.reconcile("identityReady"))
    .catch(() => { /* identityReady rejection handled by shim bootstrap */ });

  return { dispatcher, mcpServer, reconciler: liveReconciler };
}
