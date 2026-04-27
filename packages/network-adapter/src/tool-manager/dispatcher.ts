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
import { PollBackstop, type PollBackstopOptions } from "../kernel/poll-backstop.js";
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

  /**
   * Mission-56 W3.3: opt-in adapter-side hybrid poll backstop. When
   * supplied, the dispatcher constructs a PollBackstop (Design v1.2
   * commitment #5) that periodically calls `list_messages` with a
   * `since` cursor + `status: "new"` filter and surfaces each delta
   * Message via the same MessageRouter as the SSE inline path
   * (preserving seen-id LRU dedup across both paths).
   *
   * Pass `{ role: "engineer" | "architect" }` minimum; cadence
   * defaults to 5min (`OIS_ADAPTER_POLL_BACKSTOP_S` env override).
   * Omit to disable polling (push-only mode).
   */
  pollBackstop?: Omit<PollBackstopOptions, "onPolledMessage">;
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

  /**
   * Mission-56 W3.3: PollBackstop instance, present iff `opts.pollBackstop`
   * was supplied. Hosts MAY call `pollBackstop.start(getAgent)` at the
   * appropriate lifecycle moment (typically post-handshake, when the
   * agent reaches `streaming`). Hosts MUST call `pollBackstop.stop()`
   * on shutdown to clear the timer. Omitted (`undefined`) when polling
   * is disabled (push-only mode).
   */
  pollBackstop?: PollBackstop;

  /**
   * Mission-56 W3.3: explicit-ack-on-action surface. Host shims call
   * this when the consumer (LLM) has acted on or actively-deferred a
   * Message that was previously claimed (per Option (i) ratified at
   * thread-325 round-2). Idempotent: re-acks on already-acked Messages
   * are no-ops. Errors swallowed (logged, non-fatal) — a missed ack
   * leaves the Message at status `received`, which the next poll-tick
   * naturally excludes from `status: "new"` so the consumer doesn't
   * re-render it.
   */
  ackMessage: (messageId: string) => Promise<void>;
}

/** Compose the pendingActionMap key. Pure helper; exported for tests. */
/**
 * Mission-62 W3: tools that should NOT trigger signal_working_*
 * wrapping. The signal_* tools themselves would recurse infinitely;
 * register_role + claim_session + drain_pending_actions are lifecycle
 * tools, not semantic tool-call-work.
 */
export const TOOL_CALL_SIGNAL_SKIP: ReadonlySet<string> = new Set([
  "signal_working_started",
  "signal_working_completed",
  "signal_quota_blocked",
  "signal_quota_recovered",
  "register_role",
  "claim_session",
  "drain_pending_actions",
]);

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

  // Mission-56 W3.3: post-render claim. Extracts the Message ID from
  // `message_arrived` events (W1a SSE shape: event.data.message.id)
  // and fires `claim_message(id)` against the Hub via the agent. Per
  // architect-issued W3 directive: claim happens AFTER the host hook
  // renders (the ordering matches "shim calls after successful render
  // to host" from Design v1.2 commitment #6). Errors are swallowed +
  // logged — claim failure is non-fatal (the SSE path still rendered;
  // the next poll-tick will pick up any unclaimed Message in the
  // status === "new" set if needed).
  //
  // Multi-agent same-role: the Hub-side CAS enforces winner-takes-all
  // (mission-56 W3.2). The wonClaim signal is informational; even if
  // we lost, the host has already rendered (claim is post-render), so
  // the loser still sees the Message — but only the winner's claim
  // flips status to `received`, gating subsequent ack to a single
  // canonical actor.
  function fireClaimMessage(event: AgentEvent): void {
    if (event.event !== "message_arrived") return;
    const data = event.data as Record<string, unknown> | undefined;
    const message = data?.message as { id?: string } | undefined;
    const messageId = message?.id;
    if (typeof messageId !== "string") return;

    const agent = opts.getAgent();
    if (!agent || agent.state !== "streaming") return;

    void agent
      .call("claim_message", { id: messageId })
      .catch((err: unknown) => {
        log(
          `[claim_message] non-fatal failure for ${messageId}: ${(err as Error)?.message ?? String(err)}`,
        );
      });
  }

  const callbacks: AgentClientCallbacks = {
    onActionableEvent: (event) => {
      captureQueueItemFromEvent(event);
      router.route({ kind: "notification.actionable", event });
      // Mission-56 W3.3: post-render claim (replaces W2.2 stub-claim TODO).
      fireClaimMessage(event);
    },
    onInformationalEvent: (event) => {
      router.route({ kind: "notification.informational", event });
    },
    onStateChange: (state, previous, reason) => {
      log(`Connection: ${previous} → ${state}${reason ? ` (${reason})` : ""}`);
      router.route({ kind: "state.change", state, previous, reason });
    },
  };

  // Mission-56 W3.3: PollBackstop construction (opt-in via opts.pollBackstop).
  // The backstop fires `list_messages({status:"new", since:<lastSeen>})`
  // periodically and routes each delta Message through the same
  // MessageRouter as the SSE inline path so seen-id LRU dedup catches
  // push+poll race overlap. Polled Messages also fire claim_message
  // (the router invocation goes through onActionableEvent which
  // already includes fireClaimMessage).
  const pollBackstop = opts.pollBackstop
    ? new PollBackstop({
        ...opts.pollBackstop,
        log: opts.pollBackstop.log ?? log,
        onPolledMessage: (event) => {
          router.route({ kind: "notification.actionable", event });
          fireClaimMessage(event);
        },
      })
    : undefined;

  // Mission-56 W3.3: explicit-ack-on-action helper. Host shims wire
  // this to fire when the LLM consumer has acted on (or actively
  // deferred) a Message — per Option (i) ratified at thread-325 round-2,
  // ack is tied to consumer-action, not auto-on-render.
  async function ackMessage(messageId: string): Promise<void> {
    const agent = opts.getAgent();
    if (!agent || agent.state !== "streaming") return;
    try {
      await agent.call("ack_message", { id: messageId });
    } catch (err) {
      log(
        `[ack_message] non-fatal failure for ${messageId}: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }

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
        // ── Mission-62 W3 — activity FSM signal wrapping ─────────────
        //
        // Wrap each LLM-driven tool call with signal_working_started +
        // signal_working_completed RPCs (fire-and-forget; eventual-
        // consistency on Hub-side activity FSM). Per Design v1.0 §5.2:
        // implicit-only inference infeasible (LLM-to-MCP-tool-call
        // path doesn't enqueue items per ADR-017 §M1-M2); explicit
        // signaling required for routing peers to see this agent's
        // working state.
        //
        // Skip-list prevents infinite recursion (signal_* calls would
        // wrap themselves) + handshake/lifecycle tools that are not
        // semantically tool-call-work (register_role, claim_session,
        // drain_pending_actions).
        const wrapWithSignal = !TOOL_CALL_SIGNAL_SKIP.has(name);
        if (wrapWithSignal) {
          // Fire-and-forget: don't await; Hub-side eventual-consistency
          // is acceptable for v1.0 routing-cache use case.
          agent.call("signal_working_started", { toolName: name }).catch((err: unknown) => {
            log(`[mission-62] signal_working_started fire-and-forget failed (non-fatal): ${(err as Error)?.message ?? err}`);
          });
        }
        let result: unknown;
        try {
          result = await agent.call(name, outgoingArgs);
        } finally {
          if (wrapWithSignal) {
            agent.call("signal_working_completed", {}).catch((err: unknown) => {
              log(`[mission-62] signal_working_completed fire-and-forget failed (non-fatal): ${(err as Error)?.message ?? err}`);
            });
          }
        }
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
    pollBackstop,
    ackMessage,
  };
}
