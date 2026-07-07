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
 * (`@apnex/message-router`) landing in M-Push-Foundation W4. Always
 * qualify ("tool-manager" or "Message-router") in new code; avoid bare
 * "dispatcher".
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  InitializeRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { MessageRouter, SeenIdCache } from "@apnex/message-router";
import type {
  AgentClientCallbacks,
  AgentEvent,
  SessionState,
  SessionReconnectReason,
} from "../../kernel/agent-client.js";
import type { McpAgentClient } from "../../kernel/mcp-agent-client.js";
import { PollBackstop, resolveRole, type PollBackstopOptions } from "../../kernel/poll-backstop.js";
import type { DrainedPendingAction } from "../../kernel/state-sync.js";
import type { CachedCatalog } from "../catalog/tool-catalog-cache.js";
import { ClaimableDigestTracker } from "../work-protocol/claimable-digest-tracker.js";
import { WorkLeaseTracker } from "../work-protocol/work-lease-tracker.js";
import {
  TOOL_CALL_SIGNAL_SKIP,
  pendingKey,
  injectQueueItemId,
} from "../dispatch/tool-call-policy.js";
import { runToolDispatch, type ToolDispatchContext } from "../dispatch/dispatch.js";

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
   * surfaces a "Hub not connected" error envelope on CallTool and a
   * structured MCP error on ListTools after a bounded retry window
   * (bug-114 fallback-gap fix). Silent empty-tool-list response was
   * retired 2026-05-26 — host MCP clients (e.g. Claude Code) cached
   * the empty list as the authoritative surface, masking comms-loss.
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
   * Resolves when the underlying McpAgentClient is fully usable
   * (transport connected + identity asserted + streaming-state
   * reached, i.e. `agent.start()` returned). Gates the ListTools
   * handler's bootstrap path; on probe-path (`!identityReady`) the
   * cache fallback runs without awaiting this gate.
   *
   * bug-141 pass-2 (2026-05-28): docs updated from "handshake
   * completes" → "fully usable". The earlier wording prompted host
   * shims to gate on `identityReady`, which opened the gate ~1.3s
   * before `agent.isConnected` flipped true (during the synchronizing
   * → streaming transition) — surfacing the bug-141 race. Hosts MUST
   * gate on a Promise that resolves only after the agent is in
   * streaming state (claude-plugin: `syncReady`).
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

  /**
   * mission-88 W10 (bug-126 fix): timeout in ms for `await callToolGate`.
   * If the gate Promise neither resolves nor rejects within this budget,
   * the dispatcher emits a structured `gate-timeout` log line + returns
   * isError to host (instead of hanging indefinitely as the bug-126
   * incident exhibited). Default 30000ms; set to 0 to disable.
   *
   * Defense against pending-forever sessionReady Promises (W10 Design §3
   * H1+H3 hypotheses). The timeout is a fail-safe — production-correct
   * handshake flow should never hit it.
   */
  callToolGateTimeoutMs?: number;

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
  /**
   * bug-114 — current Hub tool-surface revision (`/health`
   * `toolSurfaceRevision`). The cache-validity key; `null` when the
   * /health fetch hasn't resolved yet (probe-friendly trust-cache).
   */
  getCurrentToolSurfaceRevision?: () => string | null;
  persistCatalog?: (catalog: unknown[]) => void;

  /**
   * Optional cache-validity check. When omitted, cache-fallback
   * conservatively treats every cached entry as invalid (live-fetch
   * dominates). Wire `isCacheValid` from `./tool-catalog-cache.js`
   * to enable tool-surface-revision-keyed validity.
   */
  isCacheValid?: (
    cached: CachedCatalog,
    currentRevision: string | null | undefined,
  ) => boolean;

  /**
   * mission-106 (D3) — kick an out-of-band reconcile when the serve path
   * serves a LABELED-STALE cache (isCacheValid false: unknown or mismatched
   * revision). Fire-and-forget: the serve path stays sub-50ms and NEVER awaits
   * this; correctness (a fresh disk for the next enumeration) comes from the
   * reconciler's disk repair, not from the serve path. Omit to disable the kick.
   */
  scheduleRepair?: () => void;

  /**
   * Universal Adapter notification contract. Host shim attaches its
   * render-surface bindings here.
   */
  notificationHooks?: DispatcherNotificationHooks;

  /**
   * idea-353 W2: observe each host-driven CallTool's (method, args, result)
   * after it returns. The host wires this to a WorkLeaseTracker so the
   * outbound stall-prompt can track this agent's own held leases locally
   * (claim/renew/complete/abandon) with no Hub round-trip. Best-effort —
   * a throw is caught + logged and never affects the tool-call return.
   */
  onToolCallResult?: (
    method: string,
    args: Record<string, unknown>,
    result: unknown,
  ) => void;

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

  /**
   * Slice D (pi native binding) — external idle probe. A NATIVE host (pi) drives
   * tool calls through `runToolDispatch` directly, NOT through this dispatcher's
   * MCP `CallTool` handler, so the internal `activeCallCount` never sees them.
   * Supply the host's own idle signal (e.g. pi's `ctx.isIdle()`) and the
   * wake/stall reconcile gates on THAT instead of the (always-zero) internal
   * counter. When omitted, the internal `activeCallCount` is authoritative
   * (MCP hosts — unchanged).
   */
  externalIdle?: () => boolean;

  /**
   * Slice D (pi native binding) — shared WorkLeaseTracker. A native host's
   * `ToolDispatchContext.workLeases` must be the SAME tracker the reconcile
   * reads for stall-prompts. Inject it here so the native binding's
   * `workLeases.observe(...)` populates the tracker the heartbeat tick consumes.
   * When omitted, the dispatcher constructs its own (MCP hosts — unchanged).
   */
  sharedWorkLeases?: WorkLeaseTracker;

  /**
   * work-164 (idea-395) — override the auto-heartbeat's active-work recency window
   * (ms). Defaults to RECENT_ACTIVITY_WINDOW_MS (env OIS_ADAPTER_ACTIVE_WORK_WINDOW_MS
   * or 5min). Primarily a test seam: a small value makes an agent read "stalled" soon
   * after its last tool call (exercising the stall-prompt + sweeper fallback), a large
   * one keeps it "active" (exercising the auto-renew). Prod leaves it default.
   */
  activeWorkWindowMs?: number;
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

  /**
   * idea-353 W1 idle-gate: number of host-driven CallTool requests currently
   * in flight. The wake/stall reconciler reads this on the heartbeat tick to
   * skip surfacing while the agent is mid-task (AC4). The tick's own internal
   * `agent.call`s do not pass through the CallTool handler, so they are not
   * counted (an idle poll never self-gates).
   */
  getActiveCallCount: () => number;
  /** idea-353 W1 idle-gate convenience: `getActiveCallCount() === 0`. */
  isIdle: () => boolean;

  /**
   * Slice D (pi native binding) — the WorkLeaseTracker the reconcile reads. A
   * native host builds its `ToolDispatchContext.workLeases` from THIS instance
   * so its `runToolDispatch` lease observations feed the stall-prompt path.
   * (Same object as `opts.sharedWorkLeases` when injected.)
   */
  workLeases: WorkLeaseTracker;
}

// M-Tool-Manager Slice B: the pure OIS tool-call policy helpers
// (TOOL_CALL_SIGNAL_SKIP / pendingKey / injectQueueItemId) moved to
// `./tool-call-policy.js` so the dispatch authority (`./dispatch.js`) and this
// god-object shell share them without a circular import. They are imported
// above (used internally) and RE-EXPORTED here so existing consumers
// (index.ts, tests) are unaffected.
export { TOOL_CALL_SIGNAL_SKIP, pendingKey, injectQueueItemId };

// idea-355 §4.3 (review fix) — tight timeout on the wake/stall reconcile's Hub
// read. The liveness heartbeat now runs concurrently with the reconcile (see
// PollBackstop.tickHeartbeat), but this still bounds how long the reconcile can
// hold the heartbeat cadence (heartbeatInFlight) and resource use. On timeout
// the read is treated as a failed read (AC3 — tracker skipped, no false replay).
const WAKE_STALL_READ_TIMEOUT_MS = 10_000;

// work-164 (idea-395): the auto-heartbeat's active-work recency window. An agent is
// treated as "genuinely working the node" if a tool-call boundary happened within
// this window (OR a call is in flight / the host reports non-idle). MUST be > the
// heartbeat tick interval (30s) AND > a plausible inter-tool REASONING gap (so a
// long mid-turn between tool calls does not read idle and get reaped — the case the
// architect flagged), yet < the lease TTL (15min) so a genuinely dead/silent holder
// falls out of "active" and is left to the stall-prompt + sweeper reap. 5 min sits in
// that band. Tunable via env for ops.
const RECENT_ACTIVITY_WINDOW_MS = Number(
  process.env.OIS_ADAPTER_ACTIVE_WORK_WINDOW_MS ?? 5 * 60_000,
);

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export function createSharedDispatcher(
  opts: SharedDispatcherOptions,
): SharedDispatcher {
  const log = opts.log ?? (() => {});
  const serverName = opts.serverName ?? "proxy";
  const serverCapabilities = opts.serverCapabilities ?? { tools: {}, logging: {} };

  const pendingActionMap = new Map<string, string>();

  // idea-353 W1 idle-gate: count of host-driven CallTool requests currently in
  // flight. The wake/stall reconciler reads this on the heartbeat tick to avoid
  // interrupting a mid-task agent (AC4). The tick's own internal `agent.call`s
  // (list_ready_work etc.) do NOT pass through this handler, so an idle poll
  // never self-gates.
  let activeCallCount = 0;
  // work-164 (idea-395): epoch-ms of the most recent host-driven tool-call boundary
  // (start OR end). The auto-heartbeat's active-work signal reads this so a claim
  // held by an agent that is mid-a-long-REASONING-turn (between tool calls at the
  // tick instant, so activeCallCount===0) is still recognised as genuinely working
  // and gets auto-renewed — the mid-turn survival case. Instantaneous
  // activeCallCount alone would read "idle" here and reap live work (the bug one
  // layer down). 0 until the first call.
  let lastToolActivityMs = 0;

  let capturedClientInfo: DispatcherClientInfo = {
    name: "unknown",
    version: "0.0.0",
  };
  const getClientInfo = (): DispatcherClientInfo => capturedClientInfo;

  function isUsableAgent(agent: McpAgentClient | null): agent is McpAgentClient {
    return !!agent && agent.isConnected !== false;
  }

  // bug-141 retry budget. Bootstrap-path ListTools races the Hub
  // handshake on cold-start; this retry window absorbs the gap before
  // raising a structured error. Worst-case latency:
  // (LIST_TOOLS_RETRY_ATTEMPTS - 1) × LIST_TOOLS_RETRY_DELAY_MS
  // (~2.8s) before the error surfaces. Probe path remains <50ms via
  // cached catalog.
  //
  // Pass-1 (2026-05-26, bug-141 initial fix) set 4 × 200ms = 600ms
  // budget. Pass-2 (2026-05-28) bumped to 15 × 200ms = 2.8s after
  // observing greg-side cold-starts where the McpAgentClient reached
  // `streaming` state (agent.isConnected=true) ~1.3s after
  // identityReady resolved — 4 attempts wasn't enough to bridge the
  // race. The architecturally-correct fix is for hosts to wire
  // listToolsGate to syncReady instead of identityReady (claude-
  // plugin shim does this); the wider retry budget defends opencode-
  // plugin + any host that doesn't wire the gate, and is a belt-and-
  // suspenders defense against future race-window widening.
  const LIST_TOOLS_RETRY_ATTEMPTS = 15;
  const LIST_TOOLS_RETRY_DELAY_MS = 200;

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
  // through `@apnex/message-router` so Message-ID dedup (push+poll
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

  // Phase-1.5 #1 (M-SSE-Filter-List-Adapter-Consumption Design v1.0
  // §1.3): when Hub has set `payload.suppress_peek_line: true` (per
  // §1.5 filter-list at sse-peek-line-render.ts), downgrade the event
  // to informational routing — the host's onInformationalEvent hook
  // logs but does NOT call pushChannelNotification (no LLM wake; no
  // peek-line surface). State-machine consumption preserved via the
  // log path. Operator-visible noise reduction for filter-listed
  // events. Back-compat: undefined / false → current Phase-1 flow
  // unchanged.
  function isSuppressed(event: AgentEvent): boolean {
    const data = event.data as { suppress_peek_line?: unknown } | undefined;
    return data?.suppress_peek_line === true;
  }

  const callbacks: AgentClientCallbacks = {
    onActionableEvent: (event) => {
      if (isSuppressed(event)) {
        // Filter-listed event: route as informational; skip
        // captureQueueItemFromEvent + fireClaimMessage (actionable-only
        // side effects). State-machine consumption preserved via the
        // informational hook's log path.
        router.route({ kind: "notification.informational", event });
        return;
      }
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
      // bug-103: on every transition into `streaming` (first connect AND every
      // reconnect), trigger an immediate poll-backstop catch-up tick — so
      // role-targeted kind:note notifications missed while the adapter was
      // disconnected are recovered promptly, not only on the next ≤cadence
      // interval tick. No-op when the first-timer is disabled or already
      // in-flight (tick() guards both).
      if (state === "streaming") void pollBackstop?.tick(opts.getAgent);
    },
  };

  // idea-355 §4.3 — kernel-internal queue wake/stall reconcile. Hoisted from the
  // claude shim so EVERY host gets it via the dispatcher heartbeat tick with ZERO
  // shim wiring (the shim that wires none of these seams still emits via
  // notificationHooks on a tick). The trackers are per-dispatcher-instance and
  // persist ACROSS ticks — the level-triggered, ID-keyed dedup state must survive
  // tick-to-tick or every tick re-emits (digest spam).
  const claimableDigest = new ClaimableDigestTracker();
  // Slice D: use the injected tracker when a native binding shares one (so its
  // runToolDispatch observations land where the reconcile reads); else own it.
  const workLeases = opts.sharedWorkLeases ?? new WorkLeaseTracker();
  let wakeStallInFlight = false;

  // The reconcile body. Drives W1 (inbound claimable digest), W2 (outbound
  // stall-prompt), W3 (emit-only status log). Invoked from the heartbeat tick
  // below (wrapped in its own try/catch alongside the host live-refresh hook).
  async function runWakeStallReconcile(): Promise<void> {
    // Invariant: in-flight latch so overlapping ticks don't double-emit. The
    // gates below run BEFORE the latch is taken, so an early return never needs
    // to release it.
    if (wakeStallInFlight) return;

    const agent = opts.getAgent();
    // Gate on a live streaming agent (the call path requires it anyway).
    if (!agent || agent.state !== "streaming") return;
    // Invariant: gate on identityReady — role + agentId come from the post-
    // handshake identity; a pre-handshake tick would read an undefined identity
    // and list_ready_work the wrong (or empty) set.
    const agentId = agent.getMetrics?.().agentId;
    if (!agentId) return;
    // bug-173 — resolve the role at USE-time (it may be a `() => string` thunk
    // for hosts whose dispatcher is constructed before config.role loads), so the
    // idea-353 wake/stall reconcile filters on the SAME configured role the
    // PollBackstop tick uses — not a frozen module-init env default.
    const roleOpt = opts.pollBackstop?.role;
    const role = roleOpt === undefined ? undefined : resolveRole(roleOpt);
    if (!role) return;

    wakeStallInFlight = true;
    try {
      // Slice D: a native host (pi) supplies its own idle probe because its tool
      // calls bypass this dispatcher's CallTool handler (so activeCallCount is
      // always 0 for it). MCP hosts leave externalIdle undefined → counter wins.
      const idle = opts.externalIdle ? opts.externalIdle() : activeCallCount === 0;
      const nowMs = Date.now();
      // work-165 (idea-358): drop expired leases up front, so both the W2 stall
      // scan and the W3 size()-based "holding" status below see only live leases
      // (a reaped-but-unclosed lease would otherwise linger + mis-report).
      workLeases.prune(nowMs);
      let claimableCount = 0;

      // W1 — inbound claimable digest. Read the CALLER-CLAIMABLE set via the
      // stable list_ready_work contract with scopeToCaller (idea-353 WI-2.1 /
      // audit-4265: the Hub applies claim_work's FULL predicate — deps + role +
      // WIP-cap + quarantine — so the digest never over-reports what this agent
      // can actually claim; AC5 strict parity). On a failed read, skip the
      // tracker entirely so a transient empty/aborted read cannot manufacture a
      // false 0→N replay (AC3).
      try {
        const raw = await withTimeout(
          agent.call(
            "list_ready_work",
            { role, scopeToCaller: true },
            { internal: true },
          ),
          WAKE_STALL_READ_TIMEOUT_MS,
          "list_ready_work wake/stall read",
        );
        // work-165 (idea-358): the read returned (didn't throw/timeout) — the wake
        // is alive, so clear any consecutive-failure streak + re-arm the degraded latch.
        claimableDigest.recordReadSuccess();
        const items = (raw as { items?: Array<{ id?: unknown }> } | null)?.items;
        if (Array.isArray(items)) {
          const claimableIds = items
            .map((i) => i?.id)
            .filter((id): id is string => typeof id === "string");
          claimableCount = claimableIds.length;
          const decision = claimableDigest.reconcile({ claimableIds, isIdle: idle });
          if (decision.emit) {
            router.route({
              kind: "notification.actionable",
              event: {
                event: "work_claimable_digest",
                data: { role, count: decision.count, newCount: decision.newCount, trigger: decision.trigger },
              },
            });
            log(
              `[idea-353] inbound digest emitted — ${decision.count} claimable (${decision.newCount} new, ${decision.trigger}-triggered) for ${role}`,
            );
          }
        }
      } catch (err) {
        // work-165 (idea-358): a failed read skips the tracker (AC3) — but a RUN of
        // failures silently kills the inbound wake (no reconcile ever runs). Count
        // them; once the streak crosses the threshold, emit ONE degraded-mode
        // notification so the dead wake is visible instead of silent.
        const rf = claimableDigest.recordReadFailure();
        log(
          `[idea-353] list_ready_work tick failed (non-fatal, ${rf.consecutiveFailures} consecutive): ${(err as Error)?.message ?? err}`,
        );
        if (rf.degraded) {
          router.route({
            kind: "notification.actionable",
            event: {
              event: "wake_degraded",
              data: { role, consecutiveFailures: rf.consecutiveFailures },
            },
          });
          log(
            `[idea-358] WAKE DEGRADED — ${rf.consecutiveFailures} consecutive list_ready_work read failures; the inbound claimable-digest wake is silently dead until reads recover (check the Hub connection / restart the stream)`,
          );
        }
      }

      // work-164 (idea-395) — the ACTIVE-WORK signal. NOT the instantaneous
      // activeCallCount: an agent mid-a-long reasoning turn sits BETWEEN tool calls
      // at the tick instant (activeCallCount===0) yet is genuinely working — reaping
      // it would be the same bug one layer down. So active = host reports non-idle
      // (a call is in flight now) OR a tool-call boundary happened within
      // RECENT_ACTIVITY_WINDOW_MS (covers the inter-tool reasoning gap).
      const activeWindowMs = opts.activeWorkWindowMs ?? RECENT_ACTIVITY_WINDOW_MS;
      const activeWork = !idle || nowMs - lastToolActivityMs < activeWindowMs;

      // W1.5 — AUTO-HEARTBEAT (idea-395 centerpiece / the work-155 incident). While
      // genuinely working, renew due leases on the holder's behalf so a long
      // cognitive turn is never silently reaped mid-work. Crash-safe by construction:
      // a stalled/dead holder (no activity within the window and not in a call) is
      // NOT active → skipped here and left to the stall-prompt + sweeper below, so
      // this never keeps a dead agent's lease alive.
      if (activeWork) {
        for (const due of workLeases.dueForRenew(nowMs)) {
          try {
            const renewResult = await withTimeout(
              agent.call(
                "renew_lease",
                { workId: due.workId, leaseToken: due.token },
                { internal: true },
              ),
              WAKE_STALL_READ_TIMEOUT_MS,
              "auto-heartbeat renew_lease",
            );
            // Feed the renew result back so the tracker resets the window (the
            // internal call bypasses the CallTool observe path in dispatch.ts).
            workLeases.observe(
              "renew_lease",
              { workId: due.workId },
              renewResult,
              Date.now(),
            );
            log(
              `[work-164] auto-heartbeat renewed ${due.workId} (was ~${Math.round(due.msUntilExpiry / 60000)}m to expiry; active work in progress)`,
            );
          } catch (err) {
            log(
              `[work-164] auto-heartbeat renew failed for ${due.workId} (non-fatal, retries next tick): ${(err as Error)?.message ?? err}`,
            );
          }
        }
      }

      // W2 — outbound stall-prompt. Fires only when NOT actively working (the
      // fallback for a genuinely stalled holder the auto-heartbeat left alone): a
      // held lease past ~60% of its window gets ONE gentle nudge before the sweeper.
      if (!activeWork) {
        for (const due of workLeases.dueForStallPrompt(nowMs)) {
          router.route({
            kind: "notification.actionable",
            event: {
              event: "work_lease_stall",
              data: { workId: due.workId, msUntilExpiry: due.msUntilExpiry },
            },
          });
          workLeases.markPrompted(due.workId);
          log(
            `[idea-353] outbound stall-prompt emitted — ${due.workId} (~${Math.round(due.msUntilExpiry / 60000)}m left)`,
          );
        }
      }

      // W3 — emit-only Agent.status idle/stall telemetry seam. Thin + non-gating.
      const heldLeases = workLeases.size();
      const statusState = !idle ? "working" : heldLeases > 0 ? "holding" : "idle";
      log(
        `[idea-353][agent-status] state=${statusState} idle=${idle} claimable=${claimableCount} heldLeases=${heldLeases}`,
      );
    } finally {
      // Invariant: release the latch on BOTH success and error — a thrown
      // reconcile must not wedge the latch (that would silently disable the
      // wake forever).
      wakeStallInFlight = false;
    }
  }

  // Mission-56 W3.3: PollBackstop construction (opt-in via opts.pollBackstop).
  // The backstop fires `list_messages({status:"new", since:<lastSeen>})`
  // periodically and routes each delta Message through the same
  // MessageRouter as the SSE inline path so seen-id LRU dedup catches
  // push+poll race overlap. Polled Messages also fire claim_message
  // (the router invocation goes through onActionableEvent which
  // already includes fireClaimMessage).
  // idea-355 §4.3 — the kernel owns the heartbeat tick. The host's optional
  // onHeartbeatTick (e.g. claude's bug-180 tool-surface live-refresh, which is
  // host-coupled via mcpServer.sendToolListChanged) and the kernel wake/stall
  // reconcile SHARE the tick; each runs in its OWN try/catch (invariant #5) so a
  // failing or slow one cannot break or block the other.
  const hostHeartbeatTick = opts.pollBackstop?.onHeartbeatTick;
  const pollBackstop = opts.pollBackstop
    ? new PollBackstop({
        ...opts.pollBackstop,
        log: opts.pollBackstop.log ?? log,
        onPolledMessage: (event) => {
          router.route({ kind: "notification.actionable", event });
          fireClaimMessage(event);
        },
        onHeartbeatTick: async () => {
          if (hostHeartbeatTick) {
            try {
              await hostHeartbeatTick();
            } catch (err) {
              log(
                `[tick] host heartbeat hook threw (non-fatal): ${(err as Error)?.message ?? err}`,
              );
            }
          }
          try {
            await runWakeStallReconcile();
          } catch (err) {
            log(
              `[tick] wake/stall reconcile threw (non-fatal): ${(err as Error)?.message ?? err}`,
            );
          }
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
          const currentRevision = opts.getCurrentToolSurfaceRevision?.() ?? null;
          const valid = (opts.isCacheValid ?? (() => false))(
            cached,
            currentRevision,
          );
          if (valid) {
            log(
              `[ListTools] served from cache (${cached.catalog.length} tools)`,
            );
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return { tools: cached.catalog as any[] };
          }
          // mission-106 (F4/D3) — NOT valid (unknown OR mismatched revision).
          // Preserve the probe-safe sub-50ms path: serve the warm cache as an
          // EXPLICIT labeled-stale fallback (never a silent "valid" serve —
          // clause 4) and fire-and-forget an out-of-band reconcile to repair the
          // on-disk cache (clause 1 / D3). We do NOT block-await /health and do
          // NOT bootstrap here — that would defeat the zero-round-trip probe path
          // (D2/D3). Correctness comes from the repaired disk being served on the
          // NEXT enumeration; the reconciler's L1/L2 triggers repair reliably even
          // if this kick no-ops (e.g. the agent isn't usable pre-identity yet).
          log(
            `[Cache] STALE served (rev ${cached.toolSurfaceRevision} != live ${currentRevision ?? "unknown"}) — repair scheduled`,
          );
          if (opts.scheduleRepair) {
            try {
              opts.scheduleRepair();
            } catch (err) {
              log(
                `[ListTools] scheduleRepair hook threw (non-fatal): ${(err as Error).message ?? err}`,
              );
            }
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return { tools: cached.catalog as any[] };
        } else {
          log("[ListTools] no cache (bootstrapping cache from Hub)");
        }
      }

      if (opts.listToolsGate) await opts.listToolsGate;

      // bug-114 fallback-gap fix (2026-05-26): on cold-start the
      // bootstrap path can race the Hub transport's connection
      // completion — `listToolsGate` is currently undefined in every
      // host shim, so the await above is a no-op. Pre-fix the
      // handler returned `{ tools: [] }` silently when
      // `isUsableAgent(agent)` was false, and host MCP clients
      // (Claude Code) cached the empty list as the authoritative
      // tool surface for the session — invisible comms-loss across
      // the agent population, especially after a
      // CATALOG_SCHEMA_VERSION bump invalidated all on-disk caches.
      //
      // Post-fix: short bounded retry (LIST_TOOLS_RETRY_ATTEMPTS ×
      // LIST_TOOLS_RETRY_DELAY_MS) to absorb the narrow handshake
      // race, then raise a structured MCP error (-32603 InternalError)
      // so the host surfaces an actionable failure instead of
      // caching `{ tools: [] }`. Bootstrap-completed telemetry emits
      // on every path exit so silent zero-returns are architecturally
      // impossible.
      let agent: McpAgentClient | null = null;
      for (let attempt = 1; attempt <= LIST_TOOLS_RETRY_ATTEMPTS; attempt++) {
        const candidate = opts.getAgent();
        if (isUsableAgent(candidate)) {
          agent = candidate;
          break;
        }
        if (attempt < LIST_TOOLS_RETRY_ATTEMPTS) {
          log(
            `[ListTools] adapter not ready (attempt ${attempt}/${LIST_TOOLS_RETRY_ATTEMPTS}) — retrying in ${LIST_TOOLS_RETRY_DELAY_MS}ms`,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, LIST_TOOLS_RETRY_DELAY_MS),
          );
        }
      }
      if (!agent) {
        log(
          `[ListTools] bootstrap failed: adapter not ready after ${LIST_TOOLS_RETRY_ATTEMPTS} attempts — raising structured error`,
        );
        throw new McpError(
          ErrorCode.InternalError,
          "Adapter not ready: Hub transport has not connected yet. Retry the request.",
        );
      }

      // Route through agent.listTools() so any configured cognitive
      // pipeline's onListTools middleware (ToolDescriptionEnricher,
      // ResponseSummarizer, etc.) observes and modifies the surface.
      const tools = await agent.listTools();

      // Best-effort cache write-back. Skip on empty results — never
      // poison the cache with a zero-tool catalog (bug-114 hardening).
      if (opts.persistCatalog && tools.length > 0) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          opts.persistCatalog(tools as any[]);
        } catch (err) {
          log(
            `[ListTools] persistCatalog hook threw (non-fatal): ${(err as Error).message ?? err}`,
          );
        }
      } else if (opts.persistCatalog && tools.length === 0) {
        log(
          "[ListTools] persistCatalog skipped (zero tools — refusing to poison cache)",
        );
      }
      log(`[ListTools] bootstrap completed: ${tools.length} tools surfaced`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { tools: tools as any[] };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      // M-Tool-Manager Slice B: the CallTool handler body is now the shared
      // dispatch authority (`runToolDispatch`). This MCP handler is a thin
      // caller that supplies the closure state as an explicit dispatch context
      // and returns the (Slice-B faithful, still MCP-shaped) result. The
      // per-call behavior — idle-gate, callToolGate+timeout, Hub-not-connected
      // precheck, queueItemId injection, signal-FSM wrap, lease observe,
      // onToolCallResult, error normalization — all lives in `dispatch.ts` and
      // is shared byte-for-byte with any future host binding (pi native, ACP).
      const dispatchCtx: ToolDispatchContext = {
        getAgent: opts.getAgent,
        pendingActionMap,
        workLeases,
        onCallStart: () => {
          activeCallCount++;
          lastToolActivityMs = Date.now(); // work-164: stamp active-work recency
        },
        onCallEnd: () => {
          activeCallCount--;
          lastToolActivityMs = Date.now(); // work-164: a just-completed call is recent activity
        },
        callToolGate: opts.callToolGate,
        callToolGateTimeoutMs: opts.callToolGateTimeoutMs,
        onToolCallResult: opts.onToolCallResult,
        log,
      };
      const incomingArgs = (request.params.arguments ?? {}) as Record<
        string,
        unknown
      >;
      // The dispatch authority returns the Slice-B-faithful MCP-shaped result
      // ({ content, isError }); the SDK's CallTool result type is broader
      // (optional task/_meta fields the original literal also omitted). Cast at
      // this MCP-binding boundary — MCP-shape concerns are the binding's job.
      const dispatchResult = await runToolDispatch(
        dispatchCtx,
        request.params.name,
        incomingArgs,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return dispatchResult as any;
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
    getActiveCallCount: () => activeCallCount,
    isIdle: () => activeCallCount === 0,
    workLeases,
  };
}

/**
 * bug-53 boot-time fail-fast: assert host adapter has opted into
 * pollBackstop wiring (transport_heartbeat periodic timer). Throws if
 * `dispatcher.pollBackstop === undefined` UNLESS `TRANSPORT_HEARTBEAT_ENABLED=false`
 * is set explicitly (opt-out path).
 *
 * Class: substrate-runtime-gap (sister to bug-49/50/51). Mission-75 §3.3
 * substrate (PollBackstop heartbeat-second-timer) shipped at thread-472 with
 * unit tests green, but the host integration was never written — both
 * adapters call `createSharedDispatcher({...})` without supplying
 * `opts.pollBackstop`, so the dispatcher's pollBackstop field stayed
 * `undefined` and neither the poll-timer nor the heartbeat-timer ever
 * scheduled. ZERO `transport_heartbeat` MCP tool calls fired in 96 minutes
 * post Hub-restart (5127-line shim.log + 1789-event ndjson confirmed).
 *
 * This assertion is a §6.4-equivalent gate: each host MUST call
 * `assertHostWiringComplete(dispatcher)` post-startup so the bug-53 class
 * cannot recur silently. Misconfiguration fails fast at boot, not invisibly
 * after 96 minutes of clinical observability degradation.
 */
export function assertHostWiringComplete(
  dispatcher: { pollBackstop?: PollBackstop },
  log: (msg: string) => void = (m) => console.error(m),
): void {
  if (dispatcher.pollBackstop !== undefined) {
    return; // wiring complete
  }
  if (process.env.TRANSPORT_HEARTBEAT_ENABLED === "false") {
    // Explicit opt-out path — log info-level so operators have forensics.
    log(
      "[adapter] pollBackstop intentionally disabled via TRANSPORT_HEARTBEAT_ENABLED=false",
    );
    return;
  }
  throw new Error(
    "[adapter] HOST WIRING ERROR: pollBackstop not configured in createSharedDispatcher opts. " +
      "Transport heartbeat will not fire (lastHeartbeatAt will stay frozen at adapter-startup). " +
      "Per mission-75 §3.3 + bug-53 closure, host adapters MUST opt in to pollBackstop. " +
      "Set TRANSPORT_HEARTBEAT_ENABLED=false to explicitly disable.",
  );
}
