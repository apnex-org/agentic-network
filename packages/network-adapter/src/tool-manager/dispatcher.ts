/**
 * dispatcher.ts — tool-manager handler factory (Layer 1c).
 *
 * Host-independent shared abstraction that owns the MCP server's
 * Initialize / ListTools / CallTool handlers and the supporting
 * pending-action-queueItemId tracking + tool-catalog cache fallback +
 * clientInfo capture + error-envelope normalization.
 *
 * Mounted by per-host shims (Layer 3) which add host-specific transport
 * plumbing (stdio / Bun-HTTP / future) and host-specific render-surface
 * via the `notificationHooks` callback bag (Universal Adapter
 * notification contract).
 *
 * This module is the "tool-manager" per Design v1.2 §4 naming discipline
 * (Director-ratified rename from "MCP-boundary dispatcher" 2026-04-26)
 * — distinct from the "Message-router" which is sovereign-package #6
 * (`@ois/message-router`) landing in M-Push-Foundation W4. Always
 * qualify ("tool-manager" or "Message-router") in new code; avoid bare
 * "dispatcher".
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  InitializeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { MessageRouter, SeenIdCache } from "@ois/message-router";
import type {
  AgentClientCallbacks,
  AgentEvent,
  SessionState,
  SessionReconnectReason,
} from "../kernel/agent-client.js";
import type { McpAgentClient } from "../kernel/mcp-agent-client.js";
import type { DrainedPendingAction } from "../kernel/state-sync.js";
import type { CachedCatalog } from "./tool-catalog-cache.js";

export interface DispatcherClientInfo {
  name: string;
  version: string;
}

/**
 * Universal Adapter notification contract — generic shim-injection
 * callback bag. Layer 3 (per-host shim) implements these to bind
 * dispatcher events into host-specific render-surfaces (claude
 * `<channel>` / opencode `promptAsync` / future hosts).
 *
 * Spec: docs/specs/universal-adapter-notification-contract.md
 */
export interface DispatcherNotificationHooks {
  onActionableEvent?: (event: AgentEvent) => void;
  onInformationalEvent?: (event: AgentEvent) => void;
  onStateChange?: (
    state: SessionState,
    previous: SessionState,
    reason?: SessionReconnectReason,
  ) => void;
  onPendingActionItem?: (item: DrainedPendingAction) => void;
}

export interface SharedDispatcherOptions {
  /**
   * Late-binding agent accessor. Some hosts (opencode) construct the
   * dispatcher before the McpAgentClient connection is established.
   * Returning `null` means "not connected yet" — the dispatcher
   * surfaces a "Hub not connected" error envelope on CallTool and an
   * empty tool-list on ListTools.
   */
  getAgent: () => McpAgentClient | null;

  /** Adapter version reported in MCP serverInfo. */
  proxyVersion: string;

  /** MCP server name. Default: "proxy". */
  serverName?: string;

  /**
   * MCP server capabilities advertised at Initialize. Default:
   * `{ tools: {}, logging: {} }`. Hosts with extra capabilities
   * (e.g. claude `experimental.claude/channel`) override.
   */
  serverCapabilities?: Record<string, unknown>;

  /** Diagnostic logger. No-op default. */
  log?: (msg: string) => void;

  /**
   * Resolves when the underlying McpAgentClient handshake completes
   * (transport connected + identity asserted). Gates the ListTools
   * handler so the host's catalog fetch doesn't block on the slow
   * full-sync phase. Omit when no gating is needed (tests).
   *
   * Was: `handshakeComplete` (per-plugin dispatchers). Renamed in
   * mission-55 cleanup per Design v1.2 Q5: name what is gated, not
   * what is complete.
   */
  listToolsGate?: Promise<void>;

  /**
   * Resolves when the McpAgentClient session is claim-eligible
   * (eager mode: claim_session returned; lazy mode: identity ready).
   * Gates the CallTool handler so tool dispatch waits until the
   * Hub will accept it. Omit when no gating is needed.
   *
   * Was: `agentReady` (per-plugin dispatchers). Renamed in mission-55
   * cleanup per Design v1.2 Q5.
   */
  callToolGate?: Promise<void>;

  // ── Tool-catalog cache hooks (probe-safe ListTools) ──
  //
  // When all four hooks are wired in, the dispatcher can serve
  // ListTools from a per-WORK_DIR persisted catalog without touching
  // the Hub — used by `claude mcp list` style probes that exit before
  // the full handshake completes.
  //
  // All four are optional; omit to disable cache-fallback (live-fetch
  // only).

  getCachedCatalog?: () => CachedCatalog | null;
  getIsIdentityReady?: () => boolean;
  getCurrentHubVersion?: () => string | null;
  persistCatalog?: (catalog: unknown[]) => void;

  /**
   * Optional cache-validity check. When omitted, cache-fallback
   * conservatively treats every cached entry as invalid (live-fetch
   * dominates). Wire `isCacheValid` from `./tool-catalog-cache.js`
   * to enable Hub-version-keyed validity.
   */
  isCacheValid?: (
    cached: CachedCatalog,
    currentHubVersion: string | null | undefined,
  ) => boolean;

  /**
   * Universal Adapter notification contract. Host shim attaches its
   * render-surface bindings here.
   */
  notificationHooks?: DispatcherNotificationHooks;
}

export interface SharedDispatcher {
  /** ADR-017 queueItemId tracking map. Keyed by `${dispatchType}:${entityRef}`. */
  pendingActionMap: Map<string, string>;
  /**
   * Lazy MCP server factory. Hosts call this to obtain a fresh Server
   * instance for each host transport (stdio: once at startup;
   * Bun-HTTP: once per HTTP session).
   */
  createMcpServer: () => Server;
  /**
   * AgentClientCallbacks suitable for `agent.setCallbacks(...)`. Wires
   * pendingActionMap-population + propagates to notificationHooks for
   * host-specific render-surface.
   */
  callbacks: AgentClientCallbacks;
  /** Returns last-captured Initialize-time clientInfo. */
  getClientInfo: () => DispatcherClientInfo;
  /**
   * Builds an `onPendingActionItem` handshake callback that populates
   * pendingActionMap (drain-path parity with the SSE inline-queueItemId
   * path) and forwards to the supplied hooks.
   */
  makePendingActionItemHandler: (
    hooks?: DispatcherNotificationHooks,
  ) => (item: DrainedPendingAction) => void;
}

/** Compose the pendingActionMap key. Pure helper; exported for tests. */
export function pendingKey(dispatchType: string, entityRef: string): string {
  return `${dispatchType}:${entityRef}`;
}

/**
 * Inject `sourceQueueItemId` into a settling tool call's arguments
 * when a pendingActionMap entry is registered for the call's target.
 * Currently only `create_thread_reply` settles a thread_message
 * dispatch; extend this set as new auto-injection rules are ratified.
 *
 * Side effect: deletes the consumed map entry. Explicit
 * sourceQueueItemId in the args wins over the map (no rewrite).
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

export function createSharedDispatcher(
  opts: SharedDispatcherOptions,
): SharedDispatcher {
  const log = opts.log ?? (() => {});
  const serverName = opts.serverName ?? "proxy";
  const serverCapabilities = opts.serverCapabilities ?? { tools: {}, logging: {} };

  const pendingActionMap = new Map<string, string>();

  let capturedClientInfo: DispatcherClientInfo = {
    name: "unknown",
    version: "0.0.0",
  };
  const getClientInfo = (): DispatcherClientInfo => capturedClientInfo;

  function isUsableAgent(agent: McpAgentClient | null): agent is McpAgentClient {
    return !!agent && agent.isConnected !== false;
  }

  // ADR-017 Phase 1.1: SSE thread_message events carry queueItemId
  // inline. Capture into pendingActionMap so the next settling
  // create_thread_reply can auto-inject sourceQueueItemId — even if
  // no drain ever populated the map. Eliminates the SSE-vs-drain race
  // that caused false-positive escalations on early thread tests.
  const captureQueueItemFromEvent = (event: AgentEvent): void => {
    if (event.event !== "thread_message") return;
    const data = event.data as Record<string, unknown>;
    const qid = data.queueItemId;
    const threadId = data.threadId;
    if (typeof qid === "string" && typeof threadId === "string") {
      pendingActionMap.set(pendingKey("thread_message", threadId), qid);
    }
  };

  // Mission-56 W2.2: Layer-2 routing. Every classified event goes
  // through `@ois/message-router` so Message-ID dedup (push+poll
  // race) + kind→hook mapping live in one place. The host's
  // `notificationHooks` bag is the router's hook surface — no
  // shape adapter needed (the router's NotificationHooks interface
  // mirrors DispatcherNotificationHooks exactly).
  //
  // The seen-id cache is shared across the construction-time router
  // and any per-call routers minted by `makePendingActionItemHandler`,
  // so a Message ID seen on the SSE inline path will dedup a later
  // drain-path replay (and vice-versa).
  const seenIdCache = new SeenIdCache();
  const router = new MessageRouter({
    hooks: opts.notificationHooks ?? {},
    seenIdCache,
  });

  const callbacks: AgentClientCallbacks = {
    onActionableEvent: (event) => {
      captureQueueItemFromEvent(event);
      router.route({ kind: "notification.actionable", event });
      // TODO(mission-56-W3): post-render `claimMessage(event.id)` for
      // event.event === "message_arrived" — flips Message new→received
      // in the two-step claim/ack semantics. Stubbed in W2.2.
    },
    onInformationalEvent: (event) => {
      router.route({ kind: "notification.informational", event });
    },
    onStateChange: (state, previous, reason) => {
      log(`Connection: ${previous} → ${state}${reason ? ` (${reason})` : ""}`);
      router.route({ kind: "state.change", state, previous, reason });
    },
  };

  const makePendingActionItemHandler =
    (hooks?: DispatcherNotificationHooks) => {
      // Per-call hooks override the construction-time bag for the
      // drain path (preserves the original makePendingActionItemHandler
      // contract — claude-plugin shim uses this to bind a custom log
      // sink). Share the seen-id cache so drain-path replays dedup
      // against SSE-path inline deliveries.
      const drainRouter = new MessageRouter({
        hooks: hooks ?? {},
        seenIdCache,
      });
      return (item: DrainedPendingAction): void => {
        pendingActionMap.set(pendingKey(item.dispatchType, item.entityRef), item.id);
        drainRouter.route({ kind: "pending-action.dispatch", item });
      };
    };

  function createMcpServer(): Server {
    const server = new Server(
      { name: serverName, version: opts.proxyVersion },
      { capabilities: serverCapabilities },
    );

    // Initialize handler is intentionally NOT gated — host MCP clients
    // (e.g. Claude Code) have a tight initialize timeout that's faster
    // than a full Hub handshake. The Initialize handler captures
    // clientInfo for downstream handshake passthrough.
    server.setRequestHandler(InitializeRequestSchema, async (request) => {
      try {
        const ci = (request.params as { clientInfo?: DispatcherClientInfo })
          .clientInfo;
        if (
          ci &&
          typeof ci.name === "string" &&
          typeof ci.version === "string"
        ) {
          capturedClientInfo = { name: ci.name, version: ci.version };
          log(`[Handshake] Captured clientInfo: ${ci.name}@${ci.version}`);
        }
      } catch (err) {
        log(`[Handshake] clientInfo capture failed (non-fatal): ${err}`);
      }
      return {
        protocolVersion: request.params.protocolVersion,
        capabilities: serverCapabilities,
        serverInfo: { name: serverName, version: opts.proxyVersion },
      };
    });

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      // Probe-safe cache fallback. When identity hasn't yet resolved
      // (e.g. `claude mcp list` spawned the adapter and will exit
      // before the handshake completes), serve the persisted catalog
      // if available + valid against the current Hub version. Probe
      // returns in <50ms with zero Hub round-trips.
      if (
        opts.getCachedCatalog &&
        opts.getIsIdentityReady &&
        !opts.getIsIdentityReady()
      ) {
        const cached = opts.getCachedCatalog();
        if (cached) {
          const currentVersion = opts.getCurrentHubVersion?.() ?? null;
          const valid = (opts.isCacheValid ?? (() => false))(
            cached,
            currentVersion,
          );
          if (valid) {
            log("[ListTools] served from cache");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return { tools: cached.catalog as any[] };
          }
          log(
            `[ListTools] cache stale (cached.hubVersion=${cached.hubVersion}, current=${currentVersion ?? "unknown"}) — bootstrapping`,
          );
        } else {
          log("[ListTools] no cache (bootstrapping cache from Hub)");
        }
      }

      if (opts.listToolsGate) await opts.listToolsGate;

      const agent = opts.getAgent();
      if (!isUsableAgent(agent)) return { tools: [] };

      // Route through agent.listTools() so any configured cognitive
      // pipeline's onListTools middleware (ToolDescriptionEnricher,
      // ResponseSummarizer, etc.) observes and modifies the surface.
      const tools = await agent.listTools();

      // Best-effort cache write-back. Failures log + continue; the
      // primary response is already on its way to the host.
      if (opts.persistCatalog) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          opts.persistCatalog(tools as any[]);
        } catch (err) {
          log(
            `[ListTools] persistCatalog hook threw (non-fatal): ${(err as Error).message ?? err}`,
          );
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { tools: tools as any[] };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        if (opts.callToolGate) await opts.callToolGate;
        const agent = opts.getAgent();
        if (!isUsableAgent(agent)) {
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
            isError: true,
          };
        }
        const { name } = request.params;
        const incomingArgs = (request.params.arguments ?? {}) as Record<
          string,
          unknown
        >;
        const outgoingArgs = injectQueueItemId(
          name,
          incomingArgs,
          pendingActionMap,
        );
        const result = await agent.call(name, outgoingArgs);
        return {
          content: [
            {
              type: "text" as const,
              text:
                typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ error: message }) },
          ],
          isError: true,
        };
      }
    });

    return server;
  }

  return {
    pendingActionMap,
    createMcpServer,
    callbacks,
    getClientInfo,
    makePendingActionItemHandler,
  };
}
