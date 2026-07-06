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
import type { CreateMcpServerFn, NotifyEventFn, DispatchEventFn, HubNetworkingConfig } from "../../../../hub/src/hub-networking.js";
// bug-109 — TestHub repaired against the post-mission-83 substrate. The
// Memory*Store classes this harness used were removed by the substrate
// migration; it is rebuilt on createMemoryStorageSubstrate + the
// *RepositorySubstrate repositories — the same AllStores construction
// hub/src/policy/test-utils.ts and the PR-4b PolicyLoopbackHub repair use.
// Imported from the memory-substrate leaf, NOT the storage-substrate barrel:
// the barrel statically re-exports the postgres path (→ `pg`, a hub-only dep
// absent from the non-hub CI cells' scoped install). A memory-only consumer
// importing the leaf is the correct import.
import { createMemoryStorageSubstrate } from "../../../../hub/src/storage-substrate/memory-substrate.js";
import { SubstrateCounter } from "../../../../hub/src/entities/substrate-counter.js";
import { AgentRepositorySubstrate } from "../../../../hub/src/entities/agent-repository-substrate.js";
import { TaskRepositorySubstrate } from "../../../../hub/src/entities/task-repository-substrate.js";
import { ProposalRepositorySubstrate } from "../../../../hub/src/entities/proposal-repository-substrate.js";
import { ThreadRepositorySubstrate } from "../../../../hub/src/entities/thread-repository-substrate.js";
import { IdeaRepositorySubstrate } from "../../../../hub/src/entities/idea-repository-substrate.js";
import { MissionRepositorySubstrate } from "../../../../hub/src/entities/mission-repository-substrate.js";
import { TurnRepositorySubstrate } from "../../../../hub/src/entities/turn-repository-substrate.js";
import { AuditRepositorySubstrate } from "../../../../hub/src/entities/audit-repository-substrate.js";
import { BugRepositorySubstrate } from "../../../../hub/src/entities/bug-repository-substrate.js";
import { MessageRepositorySubstrate } from "../../../../hub/src/entities/message-repository-substrate.js";
import { PendingActionRepositorySubstrate } from "../../../../hub/src/entities/pending-action-repository-substrate.js";
import { PolicyRouter } from "../../../../hub/src/policy/router.js";
import { registerSessionPolicy } from "../../../../hub/src/policy/session-policy.js";
import type { IPolicyContext, AllStores } from "../../../../hub/src/policy/types.js";
import { createMetricsCounter } from "../../../../hub/src/observability/metrics.js";

export type PolicyRegistrationFn = (router: PolicyRouter) => void;

export interface TestHubOptions {
  port?: number;
  keepaliveInterval?: number;
  sessionTtl?: number;
  reaperInterval?: number;
  orphanTtl?: number;
  autoStartTimers?: boolean;
  quiet?: boolean;
  /**
   * Bind address for the HTTP listener. Default 127.0.0.1 (test-local). The P1e-2
   * standalone test-Hub passes 0.0.0.0 so a docker container can reach it on the VM.
   */
  bindAddress?: string;
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
  dispatchEvent: DispatchEventFn,
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
      // Mission-19 selector-dispatch — HubNetworking threads a dispatchEvent
      // fn into the server factory (CreateMcpServerFn 4th arg).
      dispatch: async (event, data, selector) => {
        await dispatchEvent(event, data, selector);
      },
      sessionId,
      clientIp: getClientIp(),
      role: stores.engineerRegistry.getRole(sessionId),
      internalEvents: [],
      metrics: createMetricsCounter(),
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
      name: z.string().optional(),
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
      if (!path.startsWith("docs/")) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: "Path must start with 'docs/'" }),
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
  private stores: AllStores;
  public documentStore: MemoryDocumentStore;
  private toolCallLog: ToolCall[] = [];
  private errorQueue: ToolErrorInjection[] = [];

  constructor(options: TestHubOptions = {}) {
    this.documentStore = new MemoryDocumentStore();

    // Substrate-version repositories over a fresh MemoryHubStorageSubstrate +
    // SubstrateCounter — mirrors hub/src/policy/test-utils.ts createTestContext.
    const substrate = createMemoryStorageSubstrate();
    const counter = new SubstrateCounter(substrate);
    const task = new TaskRepositorySubstrate(substrate, counter);
    const idea = new IdeaRepositorySubstrate(substrate, counter);
    const mission = new MissionRepositorySubstrate(substrate, counter, task, idea);
    const engineerRegistry = new AgentRepositorySubstrate(substrate);
    const audit = new AuditRepositorySubstrate(substrate, counter);
    const message = new MessageRepositorySubstrate(substrate);
    this.stores = {
      task,
      engineerRegistry,
      proposal: new ProposalRepositorySubstrate(substrate, counter),
      thread: new ThreadRepositorySubstrate(substrate, counter),
      audit,
      idea,
      mission,
      turn: new TurnRepositorySubstrate(substrate, counter, mission, task),
      bug: new BugRepositorySubstrate(substrate, counter),
      pendingAction: new PendingActionRepositorySubstrate(substrate, counter),
      message,
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
    const createServer: CreateMcpServerFn = (getSessionId, getClientIp, notifyEvent, dispatchEvent) => {
      return createMcpServer(
        getSessionId,
        getClientIp,
        notifyEvent,
        dispatchEvent,
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
      bindAddress: options.bindAddress ?? "127.0.0.1",
    };

    // HubNetworking signature (mission-56 W5): the legacy notificationStore
    // 2nd arg was removed (the push pipeline flows through the Message
    // store); auditStore + messageStore are now required tail args.
    this.hub = new HubNetworking(
      engineerRegistry,
      createServer,
      config,
      audit,
      message,
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

  /**
   * P1e-2 SILENT wedge — evict ALL sessions from the REAL HubNetworking `transports` map
   * WITHOUT closing the SSE. The adapter's next session-requiring POST (get_task) then 400s
   * (`transports.has(sessionId)` is false at hub-networking.ts:930) so its watchdog probe
   * REJECTS, WHILE `sendKeepalive` keeps flowing (it iterates `servers` + `sseActive`, which
   * we leave intact) — the keepalives-flowing-but-session-dead wedge that escalates via L1.5,
   * NOT L1. (destroySession is WRONG here: it `await transport.close()`s -> the adapter's L1
   * transport-watchdog detects the drop, testing the wrong layer.) Reaches a private field —
   * TEST-only; p1e2-wedge-inject.test.ts asserts the eviction so a `transports` rename fails
   * loudly. Returns the count evicted.
   */
  evictAllTransports(): number {
    const transports = (this.hub as unknown as { transports: Map<string, unknown> }).transports;
    const n = transports.size;
    transports.clear();
    return n;
  }
}
