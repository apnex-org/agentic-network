/**
 * TestHub — Layered test harness wrapping real HubNetworking.
 *
 * Uses real Hub networking (L4) with in-memory stores. Policy tools
 * are modular: real production policies can be progressively attached
 * via the `policies` option. Tools not covered by an attached policy
 * fall back to lightweight stubs.
 *
 * Default configuration attaches `registerSessionPolicy` (real M18
 * handshake, real role registration) so SSE role-filtering works
 * correctly. Stubs remain for get_task, get_pending_actions,
 * write_document, read_document.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HubNetworking } from "../../../../hub/src/hub-networking.js";
import type { CreateMcpServerFn, NotifyEventFn, HubNetworkingConfig } from "../../../../hub/src/hub-networking.js";
import { MemoryEngineerRegistry, MemoryNotificationStore, MemoryTaskStore, MemoryProposalStore, MemoryThreadStore, MemoryAuditStore } from "../../../../hub/src/state.js";
import { MemoryIdeaStore } from "../../../../hub/src/entities/idea.js";
import { MemoryMissionStore } from "../../../../hub/src/entities/mission.js";
import { MemoryTurnStore } from "../../../../hub/src/entities/turn.js";
import { MemoryTeleStore } from "../../../../hub/src/entities/tele.js";
import { PolicyRouter } from "../../../../hub/src/policy/router.js";
import { registerSessionPolicy } from "../../../../hub/src/policy/session-policy.js";
import type { IPolicyContext, AllStores } from "../../../../hub/src/policy/types.js";

export type PolicyRegistrationFn = (router: PolicyRouter) => void;

export interface TestHubOptions {
  port?: number;
  keepaliveInterval?: number;
  sessionTtl?: number;
  reaperInterval?: number;
  orphanTtl?: number;
  autoStartTimers?: boolean;
  quiet?: boolean;
  /** Production policies to attach. Default: [registerSessionPolicy]. */
  policies?: PolicyRegistrationFn[];
}

/**
 * Tool-call log entry — capture every tool invocation the TestHub receives.
 * Used by invariant tests #9 (plain vs enriched register_role) and #10
 * (state-sync RPC issuance).
 */
export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  sessionId: string;
  at: number;
}

/**
 * One-shot tool-error injection. When queued, the next invocation of `tool`
 * throws an error whose message matches one of McpConnectionManager's
 * `SESSION_INVALID_PATTERNS` — "Session not found" is the default trigger.
 * Used by invariant test #8 (session_invalid retry-once).
 */
export interface ToolErrorInjection {
  tool: string;
  errorMessage: string;
}

/** In-memory document store for testing write_document */
export class MemoryDocumentStore {
  private docs = new Map<string, { content: string; size: number; updatedAt: string }>();

  async write(path: string, content: string): Promise<{ path: string; size: number }> {
    if (path.includes("..") || path.startsWith("/")) {
      throw new Error(`Invalid path: ${path}`);
    }
    const size = Buffer.byteLength(content, "utf-8");
    this.docs.set(path, { content, size, updatedAt: new Date().toISOString() });
    return { path, size };
  }

  async read(path: string): Promise<{ content: string } | null> {
    const doc = this.docs.get(path);
    return doc ? { content: doc.content } : null;
  }

  async list(prefix: string): Promise<Array<{ path: string; size: number }>> {
    const results: Array<{ path: string; size: number }> = [];
    for (const [path, doc] of this.docs) {
      if (path.startsWith(prefix)) {
        results.push({ path, size: doc.size });
      }
    }
    return results;
  }

  clear(): void {
    this.docs.clear();
  }
}

/**
 * Creates an MCP server that dispatches through the PolicyRouter for
 * attached policies, and falls back to stubs for everything else.
 * Tool-call logging and error injection work across both layers.
 */
function createMcpServer(
  getSessionId: () => string,
  getClientIp: () => string,
  notifyEvent: NotifyEventFn,
  stores: AllStores,
  policyRouter: PolicyRouter,
  documentStore: MemoryDocumentStore,
  toolCallLog: ToolCall[],
  errorQueue: ToolErrorInjection[]
): McpServer {
  function consumeError(tool: string): ToolErrorInjection | undefined {
    const idx = errorQueue.findIndex((e) => e.tool === tool);
    if (idx === -1) return undefined;
    return errorQueue.splice(idx, 1)[0];
  }
  function record(tool: string, args: Record<string, unknown>): void {
    toolCallLog.push({ tool, args, sessionId: getSessionId(), at: Date.now() });
  }

  function buildPolicyContext(): IPolicyContext {
    const sessionId = getSessionId();
    return {
      stores,
      emit: async (event, data, targetRoles) => {
        await notifyEvent(event, data, targetRoles);
      },
      sessionId,
      clientIp: getClientIp(),
      role: stores.engineerRegistry.getRole(sessionId),
      internalEvents: [],
      config: { storageBackend: "memory", gcsBucket: "" },
    };
  }

  const server = new McpServer(
    { name: "test-hub", version: "1.0.0" },
    { capabilities: { logging: {} } }
  );

  // ── Real policy: register_role (dispatched through PolicyRouter) ───
  // The schema here accepts the full M18 payload shape. The actual
  // validation and handling is done by the production session policy.
  server.tool(
    "register_role",
    "Register this session's role",
    {
      role: z.enum(["engineer", "architect"]),
      globalInstanceId: z.string().optional(),
      clientMetadata: z.any().optional(),
      advisoryTags: z.any().optional(),
    },
    async (args) => {
      record("register_role", args as Record<string, unknown>);
      const inj = consumeError("register_role");
      if (inj) throw new Error(inj.errorMessage);

      const ctx = buildPolicyContext();
      const result = await policyRouter.handle("register_role", args as Record<string, unknown>, ctx);

      // Enrich with sessionEpoch for adapter displacement checks
      const parsed = JSON.parse(result.content[0].text);
      if (!parsed.sessionEpoch) {
        const sessionEpoch = toolCallLog.filter((c) => c.tool === "register_role").length;
        parsed.sessionEpoch = sessionEpoch;
        parsed.wasCreated = parsed.wasCreated ?? (sessionEpoch === 1);
        result.content[0].text = JSON.stringify(parsed);
      }

      return result;
    }
  );

  // ── Stubs: tools not covered by attached policies ─────────────────
  // These provide minimal responses sufficient for adapter-level tests.
  // To test these tools with real behaviour, attach their policies via
  // TestHubOptions.policies.

  server.tool(
    "get_task",
    "Fetch the pending directive for this engineer",
    {},
    async (args) => {
      record("get_task", args as Record<string, unknown>);
      const inj = consumeError("get_task");
      if (inj) throw new Error(inj.errorMessage);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ task: null }) }],
      };
    }
  );

  server.tool(
    "get_pending_actions",
    "Fetch pending actions awaiting this engineer",
    {},
    async (args) => {
      record("get_pending_actions", args as Record<string, unknown>);
      const inj = consumeError("get_pending_actions");
      if (inj) throw new Error(inj.errorMessage);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ totalPending: 0 }) }],
      };
    }
  );

  server.tool(
    "write_document",
    "Write a document to the Hub's state storage",
    {
      path: z.string(),
      content: z.string(),
    },
    async ({ path, content }) => {
      record("write_document", { path, content });
      const inj = consumeError("write_document");
      if (inj) throw new Error(inj.errorMessage);
      if (!path.startsWith("documents/")) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: "Path must start with 'documents/'" }),
          }],
          isError: true,
        };
      }
      try {
        const result = await documentStore.write(path, content);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ success: true, path: result.path, size: result.size }),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: `${err}` }),
          }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "read_document",
    "Read a document from the Hub's state storage",
    { path: z.string() },
    async ({ path }) => {
      record("read_document", { path });
      const inj = consumeError("read_document");
      if (inj) throw new Error(inj.errorMessage);
      const doc = await documentStore.read(path);
      if (!doc) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Not found: ${path}` }) }],
          isError: true,
        };
      }
      return { content: [{ type: "text" as const, text: doc.content }] };
    }
  );

  return server;
}

export class TestHub {
  private hub: HubNetworking;
  private engineerRegistry: MemoryEngineerRegistry;
  private notificationStore: MemoryNotificationStore;
  private stores: AllStores;
  public documentStore: MemoryDocumentStore;
  private toolCallLog: ToolCall[] = [];
  private errorQueue: ToolErrorInjection[] = [];

  constructor(options: TestHubOptions = {}) {
    this.engineerRegistry = new MemoryEngineerRegistry();
    this.notificationStore = new MemoryNotificationStore();
    this.documentStore = new MemoryDocumentStore();

    const task = new MemoryTaskStore();
    const idea = new MemoryIdeaStore();
    this.stores = {
      task,
      engineerRegistry: this.engineerRegistry,
      proposal: new MemoryProposalStore(),
      thread: new MemoryThreadStore(),
      audit: new MemoryAuditStore(),
      idea,
      mission: new MemoryMissionStore(task, idea),
      turn: new MemoryTurnStore(),
      tele: new MemoryTeleStore(),
    };

    // Build policy router with attached production policies
    const policyRouter = new PolicyRouter(() => {});
    const policies = options.policies ?? [registerSessionPolicy];
    for (const register of policies) {
      register(policyRouter);
    }

    const stores = this.stores;
    const docStore = this.documentStore;
    const toolCallLog = this.toolCallLog;
    const errorQueue = this.errorQueue;
    const createServer: CreateMcpServerFn = (getSessionId, getClientIp, notifyEvent) => {
      return createMcpServer(
        getSessionId,
        getClientIp,
        notifyEvent,
        stores,
        policyRouter,
        docStore,
        toolCallLog,
        errorQueue
      );
    };

    const config: HubNetworkingConfig = {
      port: options.port ?? 0,
      apiToken: "",
      keepaliveInterval: options.keepaliveInterval ?? 30_000,
      sessionTtl: options.sessionTtl ?? 180_000,
      reaperInterval: options.reaperInterval ?? 60_000,
      orphanTtl: options.orphanTtl ?? 60_000,
      autoStartTimers: options.autoStartTimers ?? false,
      quiet: options.quiet ?? true,
      bindAddress: "127.0.0.1",
    };

    this.hub = new HubNetworking(
      this.engineerRegistry,
      this.notificationStore,
      createServer,
      config
    );
  }

  // ── Delegate to real HubNetworking ─────────────────────────────────

  get port(): number { return this.hub.port; }
  get url(): string { return this.hub.url; }
  get sessionCount(): number { return this.hub.sessionCount; }
  get sseActiveCount(): number { return this.hub.sseActiveCount; }

  async start(): Promise<void> { return this.hub.start(); }
  async stop(): Promise<void> { return this.hub.stop(); }

  async sendKeepalive(): Promise<number> { return this.hub.sendKeepalive(); }
  async sendNotification(
    event: string,
    data: Record<string, unknown>,
    targetRoles: string[] = ["engineer"]
  ): Promise<void> {
    return this.hub.notifyEvent(event, data, targetRoles);
  }

  async runReaper(): Promise<number> { return this.hub.runReaper(); }
  async getSessionInfo() { return this.hub.getSessionInfo(); }

  startKeepalive(interval?: number): void { this.hub.startKeepalive(interval); }
  stopKeepalive(): void { this.hub.stopKeepalive(); }
  startSessionReaper(interval?: number): void { this.hub.startSessionReaper(interval); }
  stopSessionReaper(): void { this.hub.stopSessionReaper(); }

  closeAllSseStreams(): void { this.hub.closeAllSseStreams(); }
  closeSseStream(sessionId: string): void { this.hub.closeSseStream(sessionId); }
  async destroySession(sessionId: string): Promise<void> { return this.hub.destroySession(sessionId); }

  // ── Tool instrumentation (for invariant tests #8, #9, #10) ─────────

  /** Returns a copy of every tool call the TestHub has received. */
  getToolCallLog(): ToolCall[] {
    return [...this.toolCallLog];
  }

  /** Returns tool calls filtered by name. */
  getToolCalls(tool: string): ToolCall[] {
    return this.toolCallLog.filter((c) => c.tool === tool);
  }

  clearToolCallLog(): void {
    this.toolCallLog.length = 0;
  }

  /**
   * Queue a one-shot error for the next invocation of `tool`. The handler
   * throws `new Error(errorMessage)`, which propagates back to the client
   * as an MCP tool-call failure. Default message is one of the patterns
   * McpConnectionManager recognizes as `session_invalid`.
   */
  injectToolError(tool: string, errorMessage = "Session not found"): void {
    this.errorQueue.push({ tool, errorMessage });
  }

  clearToolErrors(): void {
    this.errorQueue.length = 0;
  }
}
