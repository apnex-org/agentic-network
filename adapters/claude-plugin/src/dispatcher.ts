/**
 * dispatcher.ts — MCP tool-call dispatcher for Claude Code ↔ Hub.
 *
 * Host-independent. Wraps the MCP Server setup (Initialize, ListTools,
 * CallTool handlers) and the AgentClientCallbacks that bridge Hub events
 * back through MCP channel notifications.
 *
 * Separated from shim.ts so tests can drive the dispatcher directly with
 * a mock or loopback McpAgentClient, without spinning up stdio.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  InitializeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  McpAgentClient,
  McpTransport,
  appendNotification,
  getActionText,
  buildPromptText,
  type AgentClientCallbacks,
  type AgentEvent,
  type SessionState,
  type SessionReconnectReason,
  type DrainedPendingAction,
} from "@ois/network-adapter";

export interface ClientInfo {
  name: string;
  version: string;
}

export interface NotificationOptions {
  logPath: string;
  mirror?: (block: string) => void;
}

export interface DispatcherOptions {
  agent: McpAgentClient;
  proxyVersion: string;
  log?: (msg: string) => void;
  notification?: NotificationOptions;
}

export interface Dispatcher {
  server: Server;
  callbacks: AgentClientCallbacks;
  getClientInfo: () => ClientInfo;
  pendingActionMap: Map<string, string>;
}

export function pendingKey(dispatchType: string, entityRef: string): string {
  return `${dispatchType}:${entityRef}`;
}

/**
 * Pure helper: consults pendingActionMap for a queueItemId to inject
 * into a settling tool call's arguments. Exported for focused unit
 * testing and reuse by the opencode-plugin dispatcher.
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

export function createDispatcher(opts: DispatcherOptions): Dispatcher {
  const log = opts.log ?? (() => {});
  const { agent, proxyVersion } = opts;

  // ADR-017: local map from `${dispatchType}:${entityRef}` → queueItemId.
  // Populated by onPendingActionItem on every drain AND by Phase 1.1's
  // inline-queueItemId SSE event; consumed by CallToolRequestSchema to
  // inject sourceQueueItemId into settling tool calls (currently
  // create_thread_reply). Entry removed on successful forward; Hub
  // completion-ack is idempotent.
  const pendingActionMap = new Map<string, string>();

  let capturedClientInfo: ClientInfo = { name: "unknown", version: "0.0.0" };
  const getClientInfo = (): ClientInfo => capturedClientInfo;

  const server = new Server(
    { name: "proxy", version: proxyVersion },
    {
      capabilities: {
        tools: {},
        experimental: { "claude/channel": {} },
      },
    },
  );

  function pushChannelNotification(
    event: AgentEvent,
    level: "actionable" | "informational",
  ): void {
    const content = buildPromptText(event.event, event.data, {
      toolPrefix: "mcp__plugin_agent-adapter_proxy__",
    });
    const meta: Record<string, unknown> = { event: event.event, source: "hub", level };
    if (event.data.taskId) meta.taskId = event.data.taskId;
    if (event.data.threadId) meta.threadId = event.data.threadId;
    if (event.data.proposalId) meta.proposalId = event.data.proposalId;

    server
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .notification({
        method: "notifications/claude/channel",
        params: { content, meta },
      } as any)
      .then(() => log(`[Channel] Pushed ${event.event} (${level})`))
      .catch((err: unknown) => log(`[Channel] Push failed for ${event.event}: ${err}`));
  }

  const notifWrite = opts.notification
    ? (ev: { event: string; data: Record<string, unknown>; action: string }) =>
        appendNotification(ev, {
          logPath: opts.notification!.logPath,
          mirror: opts.notification!.mirror,
        })
    : () => {};

  const callbacks: AgentClientCallbacks = {
    onActionableEvent: (event) => {
      // ADR-017 Phase 1.1: SSE events carry queueItemId inline. Capture
      // into pendingActionMap so the CallToolRequestSchema handler can
      // inject sourceQueueItemId on the subsequent settling call — even
      // if the map was never populated by a drain. Eliminates the
      // SSE-vs-drain race that caused false-positive escalations on
      // thread-138.
      if (event.event === "thread_message") {
        const qid = (event.data as Record<string, unknown>).queueItemId;
        const threadId = (event.data as Record<string, unknown>).threadId;
        if (typeof qid === "string" && typeof threadId === "string") {
          pendingActionMap.set(pendingKey("thread_message", threadId), qid);
        }
      }
      const action = getActionText(event.event, event.data);
      notifWrite({ event: event.event, data: event.data, action });
      pushChannelNotification(event, "actionable");
    },
    onInformationalEvent: (event) => {
      const action = getActionText(event.event, event.data);
      notifWrite({ event: event.event, data: event.data, action: `[INFO] ${action}` });
      // Informational events logged but NOT pushed — would otherwise wake the LLM.
    },
    onStateChange: (
      state: SessionState,
      prev: SessionState,
      reason?: SessionReconnectReason,
    ) => {
      log(`Connection: ${prev} → ${state}${reason ? ` (${reason})` : ""}`);
    },
  };

  server.setRequestHandler(InitializeRequestSchema, async (request) => {
    try {
      const ci = (request.params as { clientInfo?: ClientInfo }).clientInfo;
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
      serverInfo: { name: "proxy", version: proxyVersion },
    };
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const transport = agent.getTransport() as McpTransport;
    const tools = await transport.listToolsRaw();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { tools: tools as any[] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const outgoingArgs = injectQueueItemId(
      name,
      (args ?? {}) as Record<string, unknown>,
      pendingActionMap,
    );
    try {
      const result = await agent.call(name, outgoingArgs);
      return {
        content: [
          {
            type: "text" as const,
            text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          },
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

  return {
    server,
    callbacks,
    getClientInfo,
    pendingActionMap,
  };
}

/**
 * Helper for building the onPendingActionItem handshake callback that
 * populates a dispatcher's pendingActionMap. Keeps the handshake-config
 * wiring in the shim thin while the dispatcher owns the state.
 */
export function makePendingActionItemHandler(
  dispatcher: Dispatcher,
  notification?: NotificationOptions,
): (item: DrainedPendingAction) => void {
  return (item: DrainedPendingAction) => {
    dispatcher.pendingActionMap.set(
      pendingKey(item.dispatchType, item.entityRef),
      item.id,
    );
    if (notification) {
      const actionHint =
        item.dispatchType === "thread_message"
          ? `Reply with create_thread_reply to thread ${item.entityRef}`
          : `Owed: ${item.dispatchType} on ${item.entityRef}`;
      appendNotification(
        { event: item.dispatchType, data: item.payload, action: actionHint },
        { logPath: notification.logPath, mirror: notification.mirror },
      );
    }
  };
}
