/**
 * dispatcher.ts — MCP tool-call dispatcher for OpenCode ↔ Hub.
 *
 * Host-independent. Owns:
 *   - pendingActionMap (ADR-017 queueItemId cache)
 *   - MCP Server factory (per-session; OpenCode's plugin runtime opens
 *     a fresh MCP session per Initialize request via WebStandardStreamable
 *     HTTPServerTransport)
 *   - fetch() handler that routes HTTP requests to the right session's
 *     transport (the Bun.serve wiring in shim.ts delegates to this)
 *   - AgentClientCallbacks builder for the SSE→pendingActionMap path
 *
 * Separated from shim.ts so tests can drive the dispatcher directly with
 * a mock or loopback McpAgentClient, without spinning up Bun, OpenCode
 * runtime, or any listening socket — tests feed `Request` objects
 * straight to `makeFetchHandler()` and observe the response.
 *
 * Mirrors the claude-plugin dispatcher.ts structure for parity.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type {
  McpAgentClient,
  McpTransport,
  AgentClientCallbacks,
  AgentEvent,
  DrainedPendingAction,
} from "@ois/network-adapter";

export function pendingKey(dispatchType: string, entityRef: string): string {
  return `${dispatchType}:${entityRef}`;
}

/**
 * Pure helper: consults pendingActionMap for a queueItemId to inject
 * into a settling tool call's arguments. Exported for focused unit
 * testing. Mirrors claude-plugin's injectQueueItemId — same behavior,
 * same signature; eventual candidate for dedup into the shared
 * network-adapter package once opencode + claude converge.
 *
 * Returns the (possibly-rewritten) arguments. Side-effect: deletes the
 * map entry on successful injection. Explicit sourceQueueItemId in the
 * args wins over the map (no rewrite in that case).
 */
export function injectQueueItemId(
  name: string,
  args: Record<string, unknown>,
  pendingActionMap: Map<string, string>,
): Record<string, unknown> {
  if (name !== "create_thread_reply") return args;
  const threadId = args.threadId;
  if (typeof threadId !== "string") return args;
  if ("sourceQueueItemId" in args) return args;
  const queueItemId = pendingActionMap.get(pendingKey("thread_message", threadId));
  if (!queueItemId) return args;
  pendingActionMap.delete(pendingKey("thread_message", threadId));
  return { ...args, sourceQueueItemId: queueItemId };
}

export interface DispatcherOptions {
  /**
   * Late-binding agent accessor. OpenCode's plugin init runs before the
   * Hub connection is established, so the Server must look up the agent
   * lazily on each request. Returning `null` means "not connected yet"
   * — the dispatcher surfaces a "Hub not connected" content block.
   */
  getAgent: () => McpAgentClient | null;
  proxyVersion: string;
  log?: (msg: string) => void;
  /**
   * Optional ref to the list of active Server instances. Populated
   * inside makeFetchHandler on each Initialize request. The shim uses
   * this to fire `sendToolListChanged` after Hub reconnect.
   */
  activeServers?: Server[];
}

export interface OpenCodeDispatcher {
  pendingActionMap: Map<string, string>;
  createMcpServer: () => Server;
  makeFetchHandler: () => (req: Request) => Promise<Response>;
  queueMapCallbacks: Partial<AgentClientCallbacks>;
  makePendingActionItemHandler: () => (item: DrainedPendingAction) => void;
}

export function createDispatcher(opts: DispatcherOptions): OpenCodeDispatcher {
  const log = opts.log ?? (() => {});
  const pendingActionMap = new Map<string, string>();

  const createMcpServer = (): Server => {
    const server = new Server(
      { name: "hub-proxy", version: opts.proxyVersion },
      { capabilities: { tools: {}, logging: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const agent = opts.getAgent();
      if (!agent || !agent.isConnected) return { tools: [] };
      const transport = agent.getTransport() as McpTransport;
      const tools = await transport.listToolsRaw();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { tools: tools as any };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const agent = opts.getAgent();
      if (!agent || !agent.isConnected) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "Hub not connected",
                message: "The Hub adapter is not currently connected.",
              }),
            },
          ],
        };
      }
      const { name } = request.params;
      const incomingArgs = (request.params.arguments ?? {}) as Record<string, unknown>;
      const outgoingArgs = injectQueueItemId(name, incomingArgs, pendingActionMap);

      try {
        const result = await agent.call(name, outgoingArgs);
        return {
          content: [
            {
              type: "text" as const,
              text: typeof result === "string" ? result : JSON.stringify(result),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        };
      }
    });

    return server;
  };

  // Per-session-id transport registry. Lives within the fetchHandler
  // closure so tests get a fresh map per dispatcher instance.
  const makeFetchHandler = (): ((req: Request) => Promise<Response>) => {
    const proxyTransports = new Map<string, WebStandardStreamableHTTPServerTransport>();

    return async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      if (url.pathname !== "/mcp") {
        return new Response("Not found", { status: 404 });
      }

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
          transport.onclose = () => {
            if (transport.sessionId) proxyTransports.delete(transport.sessionId);
          };
          const server = createMcpServer();
          if (opts.activeServers) opts.activeServers.push(server);
          await server.connect(transport);
          log(`[Dispatcher] new MCP session initialized`);
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
  };

  // ADR-017 Phase 1.1: SSE events carry queueItemId inline. The shim
  // composes this partial callback with its own OpenCode-specific
  // notification logic (toast/prompt/queue).
  const queueMapCallbacks: Partial<AgentClientCallbacks> = {
    onActionableEvent: (event: AgentEvent) => {
      if (event.event === "thread_message") {
        const qid = (event.data as Record<string, unknown>).queueItemId;
        const threadId = (event.data as Record<string, unknown>).threadId;
        if (typeof qid === "string" && typeof threadId === "string") {
          pendingActionMap.set(pendingKey("thread_message", threadId), qid);
        }
      }
    },
  };

  // Drain-path parity: onPendingActionItem populates the same map
  // after a reconnect/drain. Shim registers this via handshake config.
  const makePendingActionItemHandler = () => (item: DrainedPendingAction) => {
    pendingActionMap.set(pendingKey(item.dispatchType, item.entityRef), item.id);
  };

  return {
    pendingActionMap,
    createMcpServer,
    makeFetchHandler,
    queueMapCallbacks,
    makePendingActionItemHandler,
  };
}
