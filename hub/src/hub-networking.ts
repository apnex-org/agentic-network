/**
 * Hub Networking Core — Extracted for testability.
 *
 * Contains all session management, SSE handling, keepalive,
 * notification broadcast, and session reaping logic.
 *
 * The 28 MCP tools are injected via createMcpServerFn, keeping
 * this module focused purely on transport and routing.
 */

import express, { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { IEngineerRegistry, Selector, IAuditStore } from "./state.js";
import { fireWebhook } from "./webhook.js";
import { emitLegacyNotification } from "./policy/notification-helpers.js";
import type { Server } from "http";

// Mission-56 W1b: soft-cap on SSE Last-Event-ID + cold-start replay.
// Symmetric with the adapter-side seen-id LRU N=1000 per round-2
// audit answer #4. On cap-hit, emit replay-truncated synthetic SSE
// event + close the connection; adapter reconnects with the last
// streamed Message.id as the next Last-Event-ID for the next batch.
const REPLAY_SOFT_CAP = 1000;

// ── Configuration ────────────────────────────────────────────────────

export interface HubNetworkingConfig {
  /** Port to listen on (default: 0 for random) */
  port?: number;
  /** Bearer token for auth. Empty string disables auth. */
  apiToken?: string;
  /** SSE keepalive interval in ms (default: 30000) */
  keepaliveInterval?: number;
  /** Session TTL in ms before reaper prunes (default: 180000) */
  sessionTtl?: number;
  /** Session reaper sweep interval in ms (default: 60000) */
  reaperInterval?: number;
  /** Orphan session TTL in ms (default: 60000) */
  orphanTtl?: number;
  /** Webhook URL for fallback when no SSE sessions (default: none) */
  webhookUrl?: string;
  /** Whether to start timers automatically (default: true). Set false for tests. */
  autoStartTimers?: boolean;
  /** Whether to suppress console.log output (default: false) */
  quiet?: boolean;
  /** Bind address (default: "0.0.0.0" for production, "127.0.0.1" for tests) */
  bindAddress?: string;
}

/** Factory function type for creating MCP servers with tools registered */
export type CreateMcpServerFn = (
  getSessionId: () => string,
  getClientIp: () => string,
  notifyEvent: NotifyEventFn,
  dispatchEvent: DispatchEventFn,
) => McpServer;

/** Function type for the persist-first notification pipeline (role-based, legacy) */
export type NotifyEventFn = (
  event: string,
  data: Record<string, unknown>,
  targetRoles?: string[]
) => Promise<void>;

/** Mission-19: selector-based dispatch. Role ∧ matchLabels equality. */
export type DispatchEventFn = (
  event: string,
  data: Record<string, unknown>,
  selector: Selector,
) => Promise<void>;

// ── Hub Networking Runtime ───────────────────────────────────────────

export class HubNetworking {
  private app = express();
  private httpServer: Server | null = null;
  private _port: number = 0;

  // Session management maps
  private transports = new Map<string, StreamableHTTPServerTransport>();
  private servers = new Map<string, McpServer>();
  private sseActive = new Map<string, boolean>();
  private activeSseResponses = new Map<string, Response>();
  private sseReplacingInProgress = new Set<string>();
  private sessionLastActivity = new Map<string, number>();

  // Timers
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  // Mission-56 W1b: SSE Last-Event-ID + cold-start replay soft-cap
  // (symmetric with seen-id LRU N=1000 per round-2 audit answer #4).
  // On cap-hit, emit synthetic replay-truncated SSE event + signal
  // adapter to reconnect with lastStreamedId as next Last-Event-ID.
  private reaperTimer: ReturnType<typeof setInterval> | null = null;

  // Shutdown signal for cancelling outstanding replay operations
  private _stopping = false;

  // Config with defaults
  private config: Required<HubNetworkingConfig>;

  private log: (msg: string) => void;

  constructor(
    private engineerRegistry: IEngineerRegistry,
    private createMcpServerFn: CreateMcpServerFn,
    config: HubNetworkingConfig = {},
    /**
     * M-Session-Claim-Separation (mission-40) T2: audit store for
     * emitting agent_session_implicit_claim + agent_session_displaced
     * audits from the SSE-subscribe auto-claim hook. Mission-56 W5:
     * required (was optional during M-Session-Claim-Separation rollout);
     * the W5 cleanup made messageStore required and the parameter list
     * tail must consistently be required to satisfy TS.
     */
    private auditStore: IAuditStore,
    /**
     * Mission-56 W1b: Message store for SSE Last-Event-ID replay +
     * cold-start stream-all paths. The SSE GET handler intercepts
     * Last-Event-ID before delegating to
     * StreamableHTTPServerTransport.handleRequest, emits replayed
     * Messages via mcpServer.server.sendLoggingMessage with Message ID
     * as the SSE event id, then continues with live emits.
     *
     * Mission-56 W5: required (was optional during W1b rollout); the
     * legacy `notificationStore` was removed in W5 cleanup, so the
     * push pipeline now flows exclusively through the Message store.
     */
    private messageStore: import("./entities/message.js").IMessageStore,
  ) {
    this.config = {
      port: config.port ?? 0,
      apiToken: config.apiToken ?? "",
      keepaliveInterval: config.keepaliveInterval ?? 30_000,
      sessionTtl: config.sessionTtl ?? 180_000,
      reaperInterval: config.reaperInterval ?? 60_000,
      orphanTtl: config.orphanTtl ?? 60_000,
      webhookUrl: config.webhookUrl ?? "",
      autoStartTimers: config.autoStartTimers ?? true,
      quiet: config.quiet ?? false,
      bindAddress: config.bindAddress ?? "0.0.0.0",
    };

    this.log = this.config.quiet
      ? () => {}
      : (msg: string) => console.log(msg);

    this.app.use(express.json());
    this.setupRoutes();
  }

  // ── Public API ─────────────────────────────────────────────────────

  get port(): number {
    return this._port;
  }

  get url(): string {
    return `http://127.0.0.1:${this._port}/mcp`;
  }

  get sessionCount(): number {
    return this.transports.size;
  }

  get sseActiveCount(): number {
    return [...this.sseActive.values()].filter(Boolean).length;
  }

  async start(): Promise<void> {
    this._stopping = false;

    return new Promise((resolve) => {
      this.httpServer = this.app.listen(this.config.port, this.config.bindAddress, () => {
        const addr = this.httpServer!.address();
        this._port = typeof addr === "object" && addr ? addr.port : 0;
        this.log(`[Hub] Listening on port ${this._port}`);

        if (this.config.autoStartTimers) {
          this.startKeepalive();
          this.startSessionReaper();
        }

        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this._stopping = true;
    this.stopKeepalive();
    this.stopSessionReaper();

    // Close all sessions (with per-transport timeout to avoid hangs)
    const closePromises = [];
    for (const [sessionId, transport] of this.transports) {
      const closeWithTimeout = Promise.race([
        transport.close().catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
      closePromises.push(closeWithTimeout);
    }
    await Promise.all(closePromises);

    this.transports.clear();
    this.servers.clear();
    this.sseActive.clear();
    this.activeSseResponses.clear();
    this.sessionLastActivity.clear();

    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  // ── Timer Controls (for testing) ───────────────────────────────────

  startKeepalive(intervalOverride?: number): void {
    this.stopKeepalive();
    const interval = intervalOverride ?? this.config.keepaliveInterval;
    this.keepaliveTimer = setInterval(async () => {
      await this.sendKeepalive();
    }, interval);
  }

  stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  startSessionReaper(intervalOverride?: number): void {
    this.stopSessionReaper();
    const interval = intervalOverride ?? this.config.reaperInterval;
    this.reaperTimer = setInterval(async () => {
      await this.runReaper();
    }, interval);
  }

  stopSessionReaper(): void {
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
  }

  // ── Manually callable operations (for testing) ─────────────────────

  /** Send keepalive to all SSE-active sessions.
   *  NOTE: Keepalive writes do NOT reset sessionLastActivity.
   *  Only inbound POST requests (tool calls, heartbeat pings) update the TTL.
   *  This prevents Cloud Run proxy-buffered outbound writes from keeping
   *  zombie sessions alive indefinitely (ADR-007: Orphan Storm fix).
   */
  async sendKeepalive(): Promise<number> {
    let sent = 0;
    for (const [sessionId, mcpServer] of this.servers) {
      if (!this.sseActive.get(sessionId)) continue;
      try {
        await mcpServer.server.sendLoggingMessage({
          level: "debug",
          logger: "keepalive",
          data: { type: "keepalive", timestamp: new Date().toISOString() },
        });
        // Do NOT update sessionLastActivity here — outbound SSE writes
        // succeed even for zombie connections behind Cloud Run's proxy.
        // Liveness is proven by inbound POST requests only.
        sent++;
      } catch {
        this.log(`[Keepalive] Session ${sessionId.substring(0, 8)}... dead`);
        this.sseActive.set(sessionId, false);
      }
    }
    return sent;
  }

  /** Run one reaper cycle */
  async runReaper(): Promise<number> {
    const now = Date.now();
    let pruned = 0;

    for (const [sessionId, lastActive] of this.sessionLastActivity) {
      const role = await this.engineerRegistry.getRole(sessionId);
      const isStale = now - lastActive > this.config.sessionTtl;
      const isOrphan = role === "unknown" && now - lastActive > this.config.orphanTtl;

      if (isStale || isOrphan) {
        this.log(
          `[Reaper] Pruning ${role} session ${sessionId.substring(0, 8)}... ` +
          `(inactive ${Math.round((now - lastActive) / 1000)}s)`
        );
        await this.cleanupSession(sessionId);
        pruned++;
      }
    }

    if (pruned > 0) {
      this.log(`[Reaper] Pruned ${pruned} session(s). Active: ${this.transports.size}`);
    }
    return pruned;
  }

  /** Send a hub-event notification via the persist-first pipeline.
   *  Mission-56 W4.2 cut over the persist-first write to the Message
   *  store; W5 removed the legacy notificationStore entirely. SSE event-
   *  id is the Message ULID — forward-compatible with the W1b Last-
   *  Event-ID protocol. */
  async notifyEvent(
    event: string,
    data: Record<string, unknown>,
    targetRoles: string[] = ["architect"]
  ): Promise<void> {
    // 1. PERSIST FIRST
    const notification = await emitLegacyNotification(this.messageStore, event, data, targetRoles);
    this.log(`[Notify] Persisted notif-${notification.id}: ${event}`);

    // 2. Attempt SSE delivery
    const notified = await this.notifyConnectedAgents(event, data, targetRoles, notification.id);

    if (notified > 0) {
      this.log(`[Notify] ${event} delivered via SSE to ${notified} session(s)`);
    } else if (this.config.webhookUrl) {
      this.log(`[Notify] No SSE sessions for ${event}, falling back to webhook`);
      await fireWebhook(event, data);
    }
  }

  /**
   * Mission-19: dispatch by selector (role ∧ matchLabels equality).
   * Persists the notification with `targetRoles` derived from selector.roles
   * (or all roles, for legacy listSince() compatibility when roles is unset),
   * then delivers only to Agents matching the full selector.
   */
  async dispatchEvent(
    event: string,
    data: Record<string, unknown>,
    selector: Selector,
  ): Promise<void> {
    const targetRoles = selector.roles && selector.roles.length > 0
      ? [...selector.roles]
      : ["architect", "engineer", "director"];
    // mission-56 W4.2 + W5: persist-first writes to the Message store.
    const notification = await emitLegacyNotification(this.messageStore, event, data, targetRoles);
    const matched = await this.engineerRegistry.selectAgents(selector);
    const selStr = JSON.stringify(selector);
    this.log(`[Dispatch] Persisted notif-${notification.id}: ${event} selector=${selStr} matched=${matched.length} agent(s)`);

    let notified = 0;
    for (const agent of matched) {
      const sessionId = agent.currentSessionId;
      if (!sessionId) continue;
      const mcpServer = this.servers.get(sessionId);
      if (!mcpServer) continue;
      if (!this.sseActive.get(sessionId)) continue;
      try {
        await mcpServer.server.sendLoggingMessage({
          level: "info",
          logger: "hub-event",
          data: {
            id: notification.id,
            event,
            data,
            timestamp: new Date().toISOString(),
            targetRoles,
            selector,
          },
        });
        notified++;
        this.log(`[Dispatch] Sent notif-${notification.id} (${event}) to ${agent.id}/${agent.role} session ${sessionId.substring(0, 8)}...`);
      } catch (err) {
        this.log(`[Dispatch] Failed to notify ${sessionId.substring(0, 8)}...: ${err}`);
        this.sseActive.set(sessionId, false);
      }
    }

    if (notified === 0 && this.config.webhookUrl) {
      this.log(`[Dispatch] No SSE recipients for ${event}, falling back to webhook`);
      await fireWebhook(event, data);
    }
  }

  /** Get session info for testing/monitoring */
  async getSessionInfo(): Promise<Array<{
    sessionId: string;
    role: string;
    sseActive: boolean;
    lastActivitySec: number;
  }>> {
    const sessions = [];
    for (const [sessionId] of this.transports) {
      const role = await this.engineerRegistry.getRole(sessionId);
      const lastActive = this.sessionLastActivity.get(sessionId) || 0;
      sessions.push({
        sessionId: sessionId.substring(0, 8) + "...",
        role,
        sseActive: this.sseActive.get(sessionId) || false,
        lastActivitySec: lastActive ? Math.round((Date.now() - lastActive) / 1000) : -1,
      });
    }
    return sessions;
  }

  /** Force-close an SSE stream for a session */
  closeSseStream(sessionId: string): void {
    // Find session by prefix match
    for (const [sid] of this.transports) {
      if (sid === sessionId || sid.startsWith(sessionId)) {
        const res = this.activeSseResponses.get(sid);
        if (res) {
          try { res.end(); } catch { /* already closed */ }
          this.sseActive.set(sid, false);
          this.activeSseResponses.delete(sid);
        }
        return;
      }
    }
  }

  /** Close all SSE streams (simulates SSE-only partition) */
  closeAllSseStreams(): void {
    for (const [sessionId, res] of this.activeSseResponses) {
      try { res.end(); } catch { /* already closed */ }
      this.sseActive.set(sessionId, false);
    }
    this.activeSseResponses.clear();
  }

  /** Destroy a session entirely */
  async destroySession(sessionId: string): Promise<void> {
    for (const [sid] of this.transports) {
      if (sid === sessionId || sid.startsWith(sessionId)) {
        await this.cleanupSession(sid);
        return;
      }
    }
  }

  // ── Tool Discovery ─────────────────────────────────────────────────

  /**
   * Broadcast MCP tools/list_changed notification to all connected sessions.
   * Used when tools are dynamically added or removed at runtime.
   */
  async broadcastToolsChanged(): Promise<void> {
    for (const [sessionId, mcpServer] of this.servers) {
      if (!this.sseActive.get(sessionId)) continue;
      try {
        await mcpServer.server.sendToolListChanged();
      } catch (err) {
        this.log(`[ToolsChanged] Failed to notify ${sessionId.substring(0, 8)}...: ${err}`);
      }
    }
    this.log(`[ToolsChanged] Broadcast tools/list_changed to all sessions`);
  }

  // ── Internal ───────────────────────────────────────────────────────

  /**
   * Mission-56 W1b: SSE Last-Event-ID + cold-start replay emit.
   *
   * Resolves subscriber identity → calls messageStore.replayFromCursor
   * for backfill window → emits each Message via sendLoggingMessage
   * with Message.id as the SSE event id (ULID-monotonic) → on soft-cap
   * emits synthetic replay-truncated event + signals truncation.
   *
   * Returns true if soft-cap was hit (caller closes response so adapter
   * reconnects with lastStreamedId as next Last-Event-ID).
   * Returns false if all matching Messages drained within the cap;
   * caller delegates to transport.handleRequest for live emits.
   *
   * Defensive: any thrown error is logged + treated as "no replay";
   * caller continues to transport.handleRequest. The Message store
   * being unavailable should never prevent SSE stream-up.
   */
  private async emitW1bReplay(
    sessionId: string,
    role: string,
    lastEventId: string | undefined,
  ): Promise<boolean> {
    if (!this.messageStore) return false;
    try {
      // Subscriber identity: role + (optional) agentId. The replay
      // filter is target.role match; target.agentId match further
      // narrows when supplied. State-based-reconnect adapters won't
      // send Last-Event-ID; the cold-start path applies (since=undefined).
      const agent = await this.engineerRegistry
        .getAgentForSession(sessionId)
        .catch(() => null);
      const agentId = agent?.id;

      // Filter: replay Messages whose target matches subscriber AND
      // status === "new" (acked/received Messages have already been
      // processed; no replay needed).
      // For role-only filter we omit targetAgentId (matches any agent
      // in that role); for fully-pinned target we use both. Broadcast
      // (target=null) Messages won't match this filter — they're not
      // replayed via Last-Event-ID since they have no specific target.
      // Engineer-final on broadcast handling: deferring to W2 adapter
      // dedup / W3 poll-backstop per Design v1.2.
      const replay = await this.messageStore.replayFromCursor({
        since: lastEventId,
        targetRole: role as import("./entities/message.js").MessageAuthorRole,
        targetAgentId: agentId,
        status: "new",
        limit: REPLAY_SOFT_CAP,
      });

      if (replay.length === 0) return false;

      const mcpServer = this.servers.get(sessionId);
      if (!mcpServer) return false;

      for (const msg of replay) {
        try {
          await mcpServer.server.sendLoggingMessage({
            level: "info",
            logger: "hub-event",
            data: {
              id: msg.id,
              event: "message_arrived",
              data: { message: msg },
              timestamp: new Date().toISOString(),
            },
          });
        } catch (err) {
          // Per-message emission failure is non-fatal; continue with
          // remaining replay batch. Adapter sees gap; poll-backstop
          // (W3) recovers.
          this.log(
            `[W1b-Replay] Per-message emit failed for ${msg.id} on session ${sessionId.substring(0, 8)}: ${(err as Error)?.message ?? err}`,
          );
        }
      }

      const truncated = replay.length === REPLAY_SOFT_CAP;
      if (truncated) {
        const lastStreamedId = replay[replay.length - 1].id;
        try {
          await mcpServer.server.sendLoggingMessage({
            level: "info",
            logger: "hub-event",
            data: {
              id: lastStreamedId,
              event: "replay-truncated",
              data: { lastStreamedId },
              timestamp: new Date().toISOString(),
            },
          });
        } catch (err) {
          this.log(
            `[W1b-Replay] replay-truncated emit failed on session ${sessionId.substring(0, 8)}: ${(err as Error)?.message ?? err}`,
          );
        }
        this.log(
          `[W1b-Replay] Soft-cap hit (${REPLAY_SOFT_CAP}); session ${sessionId.substring(0, 8)} closing for adapter reconnect with lastStreamedId=${lastStreamedId}`,
        );
        return true;
      }

      this.log(
        `[W1b-Replay] Replayed ${replay.length} Message(s) to ${role} session ${sessionId.substring(0, 8)}${lastEventId ? ` (since=${lastEventId})` : " (cold-start)"}`,
      );
      return false;
    } catch (err) {
      this.log(
        `[W1b-Replay] Replay failed on session ${sessionId.substring(0, 8)} (non-fatal): ${(err as Error)?.message ?? err}`,
      );
      return false;
    }
  }

  private async notifyConnectedAgents(
    event: string,
    data: Record<string, unknown>,
    targetRoles: string[],
    notificationId?: number | string
  ): Promise<number> {
    let notified = 0;

    for (const [sessionId, mcpServer] of this.servers) {
      const sse = this.sseActive.get(sessionId) || false;
      if (!sse) continue;

      const role = await this.engineerRegistry.getRole(sessionId);
      if (!targetRoles.includes(role)) continue;

      try {
        await mcpServer.server.sendLoggingMessage({
          level: "info",
          logger: "hub-event",
          data: {
            id: notificationId,
            event,
            data,
            timestamp: new Date().toISOString(),
            targetRoles,
          },
        });
        notified++;
        this.log(`[Notify] Sent notif-${notificationId} (${event}) to ${role} session ${sessionId.substring(0, 8)}...`);
      } catch (err) {
        this.log(`[Notify] Failed to notify ${sessionId.substring(0, 8)}...: ${err}`);
        this.sseActive.set(sessionId, false);
      }
    }

    return notified;
  }

  private cleaningUp = new Set<string>();

  private async cleanupSession(sessionId: string): Promise<void> {
    // Guard against re-entry: transport.close() fires onclose which calls cleanupSession
    if (this.cleaningUp.has(sessionId)) return;
    this.cleaningUp.add(sessionId);

    try {
      const transport = this.transports.get(sessionId);
      if (transport) {
        try { await transport.close(); } catch { /* force cleanup */ }
      }
      this.transports.delete(sessionId);
      this.servers.delete(sessionId);
      this.sseActive.delete(sessionId);
      this.activeSseResponses.delete(sessionId);
      this.sessionLastActivity.delete(sessionId);
      // M18: flip the bound Agent offline if we were the current owner.
      try {
        await this.engineerRegistry.markAgentOffline(sessionId);
      } catch (err) {
        this.log(`[Hub] markAgentOffline failed for ${sessionId.substring(0, 8)}...: ${err}`);
      }
    } finally {
      this.cleaningUp.delete(sessionId);
    }
  }

  // ── Auth Middleware ─────────────────────────────────────────────────

  private requireAuth = (req: Request, res: Response, next: () => void): void => {
    if (!this.config.apiToken) {
      next();
      return;
    }

    const authHeader = req.headers["authorization"];
    if (!authHeader) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: Missing Authorization header" },
        id: null,
      });
      return;
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer" || parts[1] !== this.config.apiToken) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: Invalid token" },
        id: null,
      });
      return;
    }

    next();
  };

  // ── Routes ─────────────────────────────────────────────────────────

  private setupRoutes(): void {
    // Health check
    this.app.get("/health", (_req, res) => {
      res.json({
        status: "ok",
        service: "mcp-relay-hub",
        version: "1.0.0",
        activeSessions: this.transports.size,
        sseStreams: this.sseActiveCount,
      });
    });

    // Session status
    this.app.get("/sessions/status", async (_req, res) => {
      const sessions = await this.getSessionInfo();
      res.json({
        totalSessions: this.transports.size,
        sseActiveSessions: this.sseActiveCount,
        sessions,
      });
    });

    // POST /mcp — Initialize or tool call
    this.app.post("/mcp", this.requireAuth, async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      try {
        // Case 1: Existing session
        if (sessionId && this.transports.has(sessionId)) {
          this.sessionLastActivity.set(sessionId, Date.now());
          // M18: heartbeat the bound Agent entity (rate-limited internally).
          this.engineerRegistry.touchAgent(sessionId).catch((err) => {
            this.log(`[Hub] touchAgent failed for ${sessionId.substring(0, 8)}...: ${err}`);
          });
          const transport = this.transports.get(sessionId)!;
          await transport.handleRequest(req, res, req.body);
          return;
        }

        // Case 2: New session (initialize)
        if (!sessionId && isInitializeRequest(req.body)) {
          let assignedSessionId: string | null = null;
          let server: McpServer;

          const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
            || req.socket.remoteAddress || "unknown";

          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newSessionId: string) => {
              assignedSessionId = newSessionId;
              this.log(`[Hub] New MCP session initialized: ${newSessionId}`);
              this.transports.set(newSessionId, transport);
              this.servers.set(newSessionId, server);
              this.sessionLastActivity.set(newSessionId, Date.now());
            },
          });

          transport.onclose = async () => {
            const sid = transport.sessionId;
            if (sid) {
              this.log(`[Hub] Session closed: ${sid}`);
              await this.cleanupSession(sid);
            }
          };

          // Create MCP server via the injected factory function
          const getSessionId = () => assignedSessionId || transport.sessionId || "unknown";
          const getClientIp = () => clientIp;
          server = this.createMcpServerFn(
            getSessionId,
            getClientIp,
            this.notifyEvent.bind(this),
            this.dispatchEvent.bind(this),
          );

          await server.connect(transport);
          await transport.handleRequest(req, res, req.body);
          return;
        }

        // Case 3: Invalid
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID provided" },
          id: null,
        });
      } catch (error) {
        this.log(`[Hub] Error handling MCP POST: ${error}`);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      }
    });

    // GET /mcp — SSE stream
    this.app.get("/mcp", this.requireAuth, async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !this.transports.has(sessionId)) {
        res.status(400).send("Invalid or missing session ID");
        return;
      }

      const role = await this.engineerRegistry.getRole(sessionId);

      // SSE Singleton Enforcement (Fix A)
      const existingRes = this.activeSseResponses.get(sessionId);
      if (existingRes) {
        this.log(`[Hub] Replacing stale SSE stream for ${role} session ${sessionId.substring(0, 8)}...`);
        this.sseReplacingInProgress.add(sessionId);
        try { existingRes.end(); } catch { /* best-effort */ }
        this.sseReplacingInProgress.delete(sessionId);
      }

      this.sseActive.set(sessionId, true);
      this.activeSseResponses.set(sessionId, res);
      this.log(`[Hub] SSE stream opened for ${role} session ${sessionId.substring(0, 8)}...`);

      // ── M-Session-Claim-Separation (mission-40) T2: SSE-subscribe auto-claim ──
      //
      // Back-compat hook for adapters that haven't migrated to the
      // explicit claim_session call. If the caller has asserted identity
      // (via register_role) but has not yet claimed a session, auto-claim
      // via the T1 single claimSession helper with trigger=sse_subscribe.
      // Best-effort: claim/audit failures do not block SSE stream open.
      try {
        const agent = await this.engineerRegistry.getAgentForSession(sessionId);
        if (agent && agent.currentSessionId !== sessionId) {
          const autoClaim = await this.engineerRegistry.claimSession(
            agent.id,
            sessionId,
            "sse_subscribe",
          );
          if (autoClaim.ok && this.auditStore) {
            try {
              await this.auditStore.logEntry(
                "hub",
                "agent_session_implicit_claim",
                `Agent ${autoClaim.agentId} session implicitly claimed (trigger=sse_subscribe, epoch=${autoClaim.sessionEpoch})`,
                autoClaim.agentId,
              );
            } catch (err) {
              this.log(`[T2] agent_session_implicit_claim audit write failed for ${autoClaim.agentId}: ${(err as Error).message ?? err}`);
            }
            if (autoClaim.displacedPriorSession) {
              try {
                await this.auditStore.logEntry(
                  "hub",
                  "agent_session_displaced",
                  `Agent ${autoClaim.agentId} session displaced (priorSessionId=${autoClaim.displacedPriorSession.sessionId}, priorEpoch=${autoClaim.displacedPriorSession.epoch}, newEpoch=${autoClaim.sessionEpoch}, trigger=sse_subscribe)`,
                  autoClaim.agentId,
                );
              } catch (err) {
                this.log(`[T2] agent_session_displaced audit write failed for ${autoClaim.agentId}: ${(err as Error).message ?? err}`);
              }
            }
          }
        }
      } catch (err) {
        this.log(`[T2] SSE-subscribe auto-claim hook failed for session ${sessionId.substring(0, 8)}: ${(err as Error).message ?? err}`);
      }

      res.on("close", () => {
        if (this.sseReplacingInProgress.has(sessionId)) return;
        this.sseActive.set(sessionId, false);
        this.activeSseResponses.delete(sessionId);
        this.log(`[Hub] SSE stream closed for session ${sessionId.substring(0, 8)}...`);
      });

      // State-Based Reconnect: No event replay. Clients call
      // get_pending_actions() + completeSync() after connecting.
      // See docs/network/07-agentic-messaging-protocol.md.
      //
      // Mission-56 W1b coexistence: when messageStore is wired AND the
      // request carries a Last-Event-ID header, OR when no Last-Event-ID
      // header is present (cold-start path), the wrapper below emits
      // replayed Messages via sendLoggingMessage BEFORE delegating to
      // transport.handleRequest. Both reconnect models coexist:
      // adapters that send Last-Event-ID consume the new replay path;
      // legacy adapters use the state-based path (no header → no
      // replay if messageStore unwired).

      // ── Mission-56 W1b: Last-Event-ID + cold-start replay wrapper ──
      //
      // Replay events MUST emit BEFORE transport.handleRequest takes
      // over for live emit, otherwise live events could fire mid-replay
      // creating duplicates/gaps (per Design v1.2 architectural
      // commitment + thread-330 round-5 ratification).
      //
      // sendLoggingMessage works against in-progress sessions whose
      // sseActive flag is true (line 683). The emit happens in the
      // current async tick before the await on transport.handleRequest
      // — so replay Messages land on the SSE stream first; transport
      // then takes over for live emits.
      //
      // Soft-cap: emit at most REPLAY_SOFT_CAP Messages per replay; on
      // cap-hit, emit synthetic replay-truncated event with
      // lastStreamedId payload + return early (skip transport.handleRequest;
      // adapter reconnects with that ID as the next Last-Event-ID).
      if (this.messageStore !== undefined) {
        const lastEventIdRaw = req.headers["last-event-id"];
        const lastEventId =
          typeof lastEventIdRaw === "string" ? lastEventIdRaw : undefined;
        const truncated = await this.emitW1bReplay(
          sessionId,
          role,
          lastEventId,
        );
        if (truncated) {
          // Soft-cap reached; adapter reconnects with last-streamed-id.
          // Do NOT delegate to transport.handleRequest for live emit on
          // this connection — close the response so adapter reconnects.
          try { res.end(); } catch { /* already closed */ }
          return;
        }
      }

      const transport = this.transports.get(sessionId)!;
      await transport.handleRequest(req, res);
    });

    // DELETE /mcp — Session teardown
    this.app.delete("/mcp", this.requireAuth, async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !this.transports.has(sessionId)) {
        res.status(400).send("Invalid or missing session ID");
        return;
      }

      const transport = this.transports.get(sessionId)!;
      await transport.handleRequest(req, res);
    });
  }
}
