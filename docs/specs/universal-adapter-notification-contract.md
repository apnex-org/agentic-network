# Universal Adapter Notification Contract — Canonical Specification

**Status:** Draft v1.0 (engineer-authored 2026-04-26; mission-55 PR 2 — D6 deliverable). Architect-pool review pending.
**Source:** Design v1.2 §"M-Pre-Push-Adapter-Cleanup" deliverable #6.
**Co-authored from:** mission-55 PR 1 cleanup (commit `983e926`) which shipped the contract surface (`SharedDispatcher.callbacks` + `notificationHooks` callback bag).
**Methodology:** First formal spec under Design v1.2's Universal Adapter framing (`@ois/network-adapter` IS the Universal Adapter; per-host shims implement this contract).

---

## Purpose

This document specifies the **Universal Adapter notification contract** — the generic, shim-agnostic interface through which the `@ois/network-adapter` Layer-1c MCP-boundary dispatcher emits notification events into per-host (Layer-3) shims. The contract is the single integration surface every current and future host shim implements; it is host-binding-mechanism-free by construction.

The spec is **descriptive of what landed in mission-55 PR 1** + **prescriptive for what future hosts adopt**. It exists so:

- Future host shims (e.g., `terminal-direct`, ACP-protocol consumers) have a single integration target instead of reverse-engineering per-host shim code
- The future Message-router (sovereign-package #6, M-Push-Foundation W4) can extend this contract additively without semantic ambiguity
- Reviewers can spot host-binding leaks at the Layer-1/Layer-3 boundary by comparing source against this spec

## Architectural placement

```
[Layer 1 — @ois/network-adapter (Universal Adapter)]
    ▲
    │ EMITS notifications (this contract)
    │
    ├─ src/wire/        — TCP/SSE conn lifecycle; reconnect; backoff
    ├─ src/kernel/      — handshake; session FSM; agent identity
    └─ src/tool-manager/ — Initialize/ListTools/CallTool factory;
                          pendingActionMap; tool-catalog cache
                          ← exposes SharedDispatcher.callbacks
                            + SharedDispatcherOptions.notificationHooks

[Layer 3 — adapters/<host>-plugin/src/shim.ts]
    │ IMPLEMENTS notifications (this contract)
    ▼
    Host-binding: stdio + `<channel>` (claude) / Bun-HTTP + promptAsync (opencode)
                  / future: terminal-stdout / ACP-host / ...
```

**Layer 2 (Message-router; sovereign-package #6, `@ois/message-router`) lands in M-Push-Foundation W4. This spec covers Layer-1c → Layer-3 emission only. Layer-2 will extend this contract additively (kind/subkind routing) without re-shaping the Layer-3-facing surface.**

## Event taxonomy

Notifications partition into **four kinds**, exposed as four hooks on the `notificationHooks` bag:

| Kind | Hook | Source | Wakes LLM? |
|---|---|---|---|
| **Actionable event** | `onActionableEvent(event)` | Hub SSE / push delivery; `event.event` ∈ {thread_message, task_issued, ...} | Yes (host-binding renders to surface that elicits LLM action) |
| **Informational event** | `onInformationalEvent(event)` | Hub SSE / push delivery; `event.event` ∈ {info_event, status_update, ...} | No (host-binding logs/contexts only; never prompts) |
| **State change** | `onStateChange(state, previous, reason?)` | Layer-1b session FSM transitions (disconnected ↔ connecting ↔ synchronizing ↔ streaming ↔ reconnecting) | No (diagnostic; logged) |
| **Pending-action dispatch** | `onPendingActionItem(item)` | Layer-1b drain of `drain_pending_actions` (ADR-017) on handshake / reconnect | Indirectly (host-binding logs hint; LLM picks up via standard backlog flush) |

**Subkind extension (informational, future):** within `onActionableEvent` / `onInformationalEvent`, the `event.event` string field is the subkind discriminator. Hosts route on subkind to host-binding-specific render decisions (e.g., claude `<channel>` source-attribute taxonomy). The Message-router (Layer 2; M-Push-Foundation W4) will codify subkind → render-surface routing as a sovereign-package boundary; this spec captures the v1.0 hook surface only.

## Payload shapes

### `AgentEvent` (actionable + informational)

Imported from `@ois/network-adapter` (Layer 1b `agent-client.ts`; re-exported at the package root):

```typescript
interface AgentEvent {
  event: string;              // subkind discriminator (e.g., "thread_message", "task_issued")
  data: Record<string, unknown>;  // payload — shape defined per event kind by Hub
}
```

**Common payload fields** (presence depends on event kind; Layer-3 shim accesses defensively):

- `taskId?: string` — present on task-related events
- `threadId?: string` — present on thread-related events
- `proposalId?: string` — present on proposal-related events
- `queueItemId?: string` — present on actionable events that settle via a tool call (ADR-017 Phase 1.1)
- `currentTurn?: string` — present on thread events
- (event-kind-specific extensions as Hub schema evolves)

**Hub-side schema is authoritative.** The Universal Adapter does not validate; shims access fields defensively (`typeof check`).

### `SessionState` + `SessionReconnectReason` (state change)

```typescript
type SessionState =
  | "disconnected"
  | "connecting"
  | "synchronizing"
  | "streaming"
  | "reconnecting";

type SessionReconnectReason =
  | "wire_death"
  | "session_invalid"
  | "explicit_reset"
  | "heartbeat_failed"
  | "sse_watchdog";
```

The reason is supplied on transitions **into** `reconnecting`; omitted on other transitions.

### `DrainedPendingAction` (pending-action dispatch)

Imported from `@ois/network-adapter` (Layer 1b `state-sync.ts`):

```typescript
interface DrainedPendingAction {
  id: string;                 // queue item ID; settle via sourceQueueItemId
  dispatchType: string;       // e.g. "thread_message"
  entityRef: string;          // e.g. "thread-318"
  payload: Record<string, unknown>;  // event payload at dispatch time
  // (additional ADR-017 saga fields elided; see state-sync.ts)
}
```

## Lifecycle

### Fire

The Layer-1c dispatcher fires notifications **synchronously** from inside `agent.setCallbacks(dispatcher.callbacks)` callbacks:

1. Transport receives SSE event / state change / drain item.
2. Layer-1b classifies + dedups + (for actionable events) populates `pendingActionMap` via `dispatcher.callbacks.onActionableEvent` capture.
3. Layer-1b invokes the corresponding `notificationHooks` callback supplied by the Layer-3 shim.
4. Layer-3 shim performs host-binding work (render to host surface, log, queue, etc.).

**Synchronous semantics:** the dispatcher does not await Layer-3 hook completion. Hooks return `void`; long-running host work (e.g., HTTP `promptAsync`) MUST be fire-and-forget on the host side. Errors thrown from hooks are isolated by Layer-1b try/catch (existing FSM resilience) and do not propagate back to the wire.

### Deliver

Layer-3 implementations of each hook decide the host-binding mechanism:

- **Actionable events** are typically *rendered to a wake-the-LLM surface* (claude `<channel>` injection; opencode `client.session.promptAsync()` push-to-LLM). The render mechanism is host-specific and not mandated by this spec.
- **Informational events** are typically *logged or context-injected without waking the LLM* (claude appends to notification log; opencode `injectContext` system prompt with `noReply: true`).
- **State changes** are typically *logged for diagnostics* (no LLM-visible side effect).
- **Pending-action dispatches** are typically *appended to a notification log + buffered for the next backlog flush* (the LLM picks them up via standard tool-call retrieval; the dispatch hook is the operational hint).

### Ack

**v1.0 contract: ack is at-least-once delivery + idempotent consumption.**

- The Universal Adapter (Layer 1) does NOT track per-shim consumption. Layer-3 shims are responsible for idempotency (e.g., the existing `<channel>` source-attribute + meta deduplication on the host side).
- For **pending-action dispatches**, ack is mediated by the `sourceQueueItemId` MCP tool-call argument injected by the Layer-1c MCP-boundary dispatcher (`injectQueueItemId`). The settling tool call (`create_thread_reply` etc.) carries the queue item ID; Hub-side completion-ack closes the saga. The notification hook itself does NOT ack; it informs the LLM that an action is owed.
- Future hosts implementing this contract MUST tolerate at-least-once redelivery on reconnect (the Layer-1b drain replays pending-action items + the Layer-1a wire reconnect may replay SSE events via Last-Event-ID; pending-action dispatch is keyed by queue-item ID, so render dedup is the shim's responsibility).

**v1.1 (M-Push-Foundation) extends ack** to the two-step `new → received → acked` semantics (`claimMessage` + `ackMessage`). This v1.0 spec is forward-compatible: the additive claim/ack semantics layer on top of the kind-keyed hook surface without re-shaping it.

## Hooks contract

The contract surface is `SharedDispatcherOptions.notificationHooks` on the `createSharedDispatcher` factory:

```typescript
import {
  createSharedDispatcher,
  type AgentEvent,
  type DrainedPendingAction,
  type SessionState,
  type SessionReconnectReason,
} from "@ois/network-adapter";

const dispatcher = createSharedDispatcher({
  getAgent: () => agent,
  proxyVersion: "1.0.0",
  notificationHooks: {
    onActionableEvent: (event: AgentEvent) => {
      // Wake-the-LLM render path
    },
    onInformationalEvent: (event: AgentEvent) => {
      // Log / context-inject path
    },
    onStateChange: (
      state: SessionState,
      previous: SessionState,
      reason?: SessionReconnectReason,
    ) => {
      // Diagnostic log path
    },
    onPendingActionItem: (item: DrainedPendingAction) => {
      // Backlog notification path
    },
  },
});
```

**All four hooks are optional.** Omitting a hook silently disables that path; the dispatcher's queueItemId capture + state-FSM logging continue regardless (those are dispatcher-internal, not shim-injected).

**Drain-path symmetric handler** — the dispatcher exposes a helper for shims that want the drain path to populate `pendingActionMap` symmetrically with the SSE inline-queueItemId path:

```typescript
const handler = dispatcher.makePendingActionItemHandler({
  onPendingActionItem: appendPendingActionLog,  // shim-specific log path
});
// Wire into the McpAgentClient handshake config as onPendingActionItem
```

The handler populates `pendingActionMap` (drain-path parity) AND forwards to the supplied hook. Both paths converge on the same key (last-write-wins).

## Render-surface semantics (worked examples)

This spec **does not mandate** how Layer-3 shims render notifications. The mechanism is host-specific. Two existing-host worked examples demonstrate the contract's neutrality.

### Worked example — claude shim (`adapters/claude-plugin/src/shim.ts`)

**Mechanism: MCP `notifications/claude/channel` injection.**

```typescript
function pushChannelNotification(
  server: Server | null,
  event: AgentEvent,
  level: "actionable" | "informational",
): void {
  const content = buildPromptText(event.event, event.data, {
    toolPrefix: "mcp__plugin_agent-adapter_proxy__",
  });
  const meta = {
    event: event.event,
    source: "hub",
    level,
    /* threadId / taskId / proposalId per event */
  };
  server.notification({
    method: "notifications/claude/channel",
    params: { content, meta },
  });
}
```

**Source-attribute taxonomy** (per Design v1.2 §4 — the worked-claude-shim anchor for kind/subkind disambiguation):

- `source="plugin:agent-adapter:repo-event"` for repo-event subkinds (PR-merge, PR-review, etc.)
- `source="plugin:agent-adapter:directive"` for director-notification successors
- `source="plugin:agent-adapter:notification"` for general notification successors
- `source="plugin:agent-adapter:proxy"` for legacy / pre-taxonomy fallback

Per-subkind source attribution is the **shim's contract obligation** for distinguishability; the dispatcher emits the raw `AgentEvent` and the shim composes the source attribute from `event.event` + (future) Layer-2 routing input.

**Wake semantics:**
- Actionable: `<channel>` push wakes the LLM via Claude Code's channel surface
- Informational: appended to notification log only; no `<channel>` push (would otherwise wake the LLM unnecessarily)
- State change: stderr log only
- Pending-action dispatch: appended to notification log; rendered into the next standard backlog query

### Worked example — opencode shim (`adapters/opencode-plugin/src/shim.ts`)

**Mechanism: OpenCode SDK `client.session.promptAsync()` push-to-LLM with rate-limit + backlog.**

```typescript
async function processNotification(n: QueuedNotification): Promise<void> {
  await showToast(n.message);
  if (n.level === "actionable") {
    if (isRateLimited()) {
      deferredBacklog.push(n);  // queue for next idle
    } else {
      const backlog = drainBacklog();
      await promptLLM(n.promptText + backlog);  // wake LLM
    }
  } else {
    await injectContext(n.promptText);  // system prompt; no reply
  }
}
```

**Wake semantics:**
- Actionable: `promptLLM` push (via `session.promptAsync` with `parts:[{type:"text",text}]`) wakes the LLM, with 30s rate-limit + deferred backlog if rate-limited
- Informational: `injectContext` (via `session.promptAsync` with `noReply:true, system:true`) — context-only; no LLM reply
- State change: diag log only; tool-discovery sync fires on `streaming` transition
- Pending-action dispatch: appended to notification log; rendered into the next promptLLM backlog drain

### Future-host extension points

The contract supports hosts whose render-surface is fundamentally different from MCP `<channel>` or OpenCode SDK promptAsync — for example:

- **`terminal-direct`** — direct stdio output to a terminal-attached LLM session; render = printf-formatted text block to stdout
- **ACP-protocol consumer** — Agent Communication Protocol envelope per the ACP spec; render = ACP message dispatch
- **Slack/Discord bot host** — render = chat-channel post via host's webhook API
- **Web dashboard host** — render = SSE push to a browser client

Future host implementations:
1. Implement the four hooks per their host-binding mechanism
2. Pass them as `notificationHooks` to `createSharedDispatcher`
3. Document the host-specific render semantics (rate-limit / wake / dedup) in the per-host shim's module header

The Universal Adapter does not need source modification to onboard a new host.

## Anti-goals (BINDING)

- **NOT host-specific mechanism mandate.** This spec does not mandate `<channel>` vs `promptAsync` vs terminal-stdout vs ACP. Per-shim implementation freedom is the load-bearing design intent.
- **NOT per-host code in `@ois/network-adapter`.** Host-specific transport plumbing (stdio / HTTP / future) lives in the shim, not the Universal Adapter. Recon §1 documents this for the v1.0 cleanup state.
- **NOT a Message-router replacement.** This contract is the Layer-1c → Layer-3 emission surface. The Layer-2 Message-router (sovereign-package #6, M-Push-Foundation W4) will extend it with kind/subkind routing as a peer concern; future spec revisions will document the Layer-1c + Layer-2 → Layer-3 composed shape.
- **NOT host-side ack tracking inside the Universal Adapter.** Layer-1 does not maintain per-shim consumption state. Idempotency + dedup are shim-level concerns. Hub-side completion-ack (via `sourceQueueItemId`) is the only ack mechanism in v1.0.
- **NOT npm-publish ready.** Distribution-readiness (`@ois/*` → `@apnex/*` migration) is M-Adapter-Distribution Tier 2 future scope. This spec describes the in-repo file:-ref state.

## Out of scope (for future revisions)

- v1.1 — claim/ack two-step Message lifecycle (M-Push-Foundation W6 commitment #6)
- v1.1 — render-surface seen-id LRU cache for push+poll dedup (M-Push-Foundation commitment #4)
- v1.1 — `<channel>` source-attribute kind/subkind taxonomy formalization beyond the v1.0 worked example
- v1.2 — Layer-2 Message-router routing contract extension
- v2.0 — Universal Adapter as `@apnex/*` published package (M-Adapter-Distribution Tier 2)

## Cross-references

- `@ois/network-adapter` (Layer 1) — `packages/network-adapter/src/{wire,kernel,tool-manager}/`; `tool-manager/dispatcher.ts` exposes `SharedDispatcherOptions.notificationHooks`
- `adapters/claude-plugin/src/shim.ts` — Layer-3 worked example (stdio + `<channel>`)
- `adapters/opencode-plugin/src/shim.ts` — Layer-3 worked example (Bun-HTTP + promptAsync)
- `docs/designs/m-push-foundation-design.md` v1.2 §"M-Pre-Push-Adapter-Cleanup" — Universal Adapter framing (Director-confirmed); Layer-1 sub-organization (1a/1b/1c)
- `docs/designs/m-push-foundational-adapter-recon.md` — recon §6+§7+§8 surfaced the `notificationHooks` callback bag pattern
- ADR-008 — L4/L7 split (`McpTransport` / `McpAgentClient`); foundation Layer 1 sits on
- ADR-017 — pending-action saga (`drain_pending_actions` + `sourceQueueItemId`); v1.0 ack mechanism
- methodology calibration #20 — `dist/` committed for file:-ref packages (orthogonal to this spec; relevant only for cross-package install order)

## Provenance

- **Source:** Design v1.2 §"M-Pre-Push-Adapter-Cleanup" deliverable #6 (architect-authored 2026-04-26; ratified by greg engineer-pool ✓ + Director autonomous-arc directive)
- **Co-authored from:** mission-55 PR 1 cleanup (commit `983e926`; merged 2026-04-26 02:33:58Z) which shipped the contract surface (`SharedDispatcher.callbacks` + `notificationHooks` callback bag)
- **Engineer-authored:** greg / 2026-04-26
- **Review pending:** architect-pool (lily) per `multi-agent-pr-workflow.md` §approval-routing for `docs/specs/` architect-content paths

— greg / engineer / 2026-04-26
