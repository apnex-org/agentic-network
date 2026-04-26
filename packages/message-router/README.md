# @ois/message-router

Sovereign Layer-2 Message dispatch + dedup for the OIS Universal Adapter.

Sovereign-package #6, sibling to `@ois/network-adapter` (Layer 1), `@ois/cognitive-layer`, `@ois/storage-provider`, and `@ois/repo-event-bridge`. Mission-56 W2.1 deliverable; design ratified at thread-332 (Design v1.2 §"Architectural commitments #4").

## Architectural placement

```
[Layer 1 — @ois/network-adapter (Universal Adapter)]
  src/wire/         — TCP/SSE wire FSM
  src/kernel/       — handshake / session FSM / agent identity
  src/tool-manager/ — Initialize/ListTools/CallTool MCP-boundary handler
                      ↓ emits the v1.0 notification contract
[Layer 2 — @ois/message-router]    ← this package
  Per-kind dispatch; seen-id LRU dedup; hooks-pattern host-injection
                      ↓ invokes
[Layer 3 — Per-host shim (adapters/<host>-plugin)]
  Implements `notificationHooks`; renders to the host surface
```

The router is a **pure routing core**. It does not subscribe to a transport, render to a host surface, or implement claim/ack — those concerns live at Layers 1, 3, and Hub respectively. Layer 2's invariants are: (a) deliver the right Message to the right hook, (b) dedup duplicate Message ID delivery (push+poll race), (c) preserve the v1.0 notification contract additively.

## Surface

### Message envelope

The routable unit. Five v1.0 kinds:

| Kind | Hook called | Payload |
|---|---|---|
| `notification.actionable` | `onActionableEvent` | `AgentEvent` |
| `notification.informational` | `onInformationalEvent` | `AgentEvent` |
| `state.change` | `onStateChange` | `SessionState`, previous, optional `SessionReconnectReason` |
| `pending-action.dispatch` | `onPendingActionItem` | `DrainedPendingAction` |
| `repo-event` | `onActionableEvent` | `AgentEvent` (mission-52 bridge translator output) |

Subkind discrimination (e.g., `event.event` for `pr-merged` vs `pr-review-approved`) is forward-compat extension scope (W3+); v1.0 routing is kind-only.

### MessageRouter

```ts
import { MessageRouter, type NotificationHooks } from "@ois/message-router";

const hooks: NotificationHooks = {
  onActionableEvent: (event) => { /* wake the LLM */ },
  onInformationalEvent: (event) => { /* log / context inject */ },
  onStateChange: (state, previous, reason) => { /* diagnostic */ },
  onPendingActionItem: (item) => { /* backlog hint */ },
};

const router = new MessageRouter({ hooks });

router.route({ kind: "notification.actionable", event });
```

`route(message)` returns `true` if the message was dispatched to a hook, or `false` if it was deduped (LRU short-circuit) or the relevant hook is not implemented.

All four hooks are optional — omitting one silently disables that dispatch path, preserving the v1.0 notification contract semantics.

### Seen-id LRU dedup

Bounded LRU keyed by Message ID (`AgentEvent.id` → string-coerced) for the three event kinds, and queue-item ID for `pending-action.dispatch`. State changes never dedup — they are FSM transitions, not Hub Messages, and have no stable wire identity.

Default capacity: 1000. Override via the `OIS_ADAPTER_SEEN_ID_CACHE_N` env var (read at construction time):

```bash
OIS_ADAPTER_SEEN_ID_CACHE_N=4096 node my-adapter.mjs
```

For tests / advanced wiring, supply an explicit capacity that wins over the env var:

```ts
new MessageRouter({ hooks, cacheOptions: { capacity: 16 } });
```

Or share a pre-constructed cache across routers:

```ts
import { SeenIdCache } from "@ois/message-router";

const cache = new SeenIdCache({ capacity: 1024 });
const router = new MessageRouter({ hooks, seenIdCache: cache });
```

## Anti-goals (binding)

- **Not a transport.** Layer 1 (`@ois/network-adapter`) owns wire + kernel. Layer 2 receives already-classified messages.
- **Not a renderer.** Per-host render mechanisms (`<channel>` / `promptAsync` / future) live in Layer 3 shims. Layer 2 invokes the hook; the hook decides the render.
- **No claim/ack semantics.** v1.1 (M-Push-Foundation W3) extends ack to two-step `new → received → acked`; v1.0 routing is forward-compatible.
- **No subkind routing in v1.0.** Subkind dispatch (`<channel>` source-attribute taxonomy etc.) is a forward-compat extension that overlays additively on top of kind dispatch.
- **No npm-publish prep.** Distribution-readiness (`@ois/*` → `@apnex/*`) is M-Adapter-Distribution Tier 2.

## Cross-references

- `docs/specs/universal-adapter-notification-contract.md` — v1.0 hook surface + payload shapes (load-bearing for this package)
- `docs/designs/m-push-foundation-design.md` v1.2 §"Architectural commitments #4" — Layer-2 dedup invariant
- `packages/network-adapter/` — Layer 1 source; emits the contract this router consumes
- `packages/repo-event-bridge/` — sovereign-package precedent (layout, dist/-commit pattern)
- `methodology calibration #20` — committed `dist/` for file:-ref packages (cross-package install order)

## Provenance

- **Mission:** mission-56 W2.1 (M-Push-Foundation)
- **Design:** v1.2 (architect lily); ratified at thread-332 round-3
- **Engineer:** greg / 2026-04-26
- **Review:** architect-pool cross-approval per `docs/methodology/multi-agent-pr-workflow.md` calibration B
