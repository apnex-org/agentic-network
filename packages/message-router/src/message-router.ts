/**
 * Layer-2 MessageRouter — sovereign-package #6 dispatch core.
 *
 * Routes a `Message` to the matching host-injected hook on a
 * `notificationHooks` callback bag (the Universal Adapter notification
 * contract surface; v1.0 spec at `docs/specs/universal-adapter-notification-contract.md`).
 *
 * Mission-56 W2.1 (Design v1.2 §"Architectural commitments #4"):
 *   1. Per-kind dispatch map (5 kinds; subkind extension is W3+).
 *   2. Seen-id LRU dedup for push+poll race (Layer 2 owned).
 *   3. Hooks-pattern host-injection — Layer 3 supplies the bag; no
 *      per-host code in Layer 2.
 *
 * Anti-goal binding: this module does NOT subscribe to a transport,
 * does NOT render to a host surface, and does NOT implement claim/ack.
 * Those are W2.2 (adapter integration) / W2.3 (claude render) / W3
 * (claim/ack). Layer 2 is a pure routing core.
 */

import type {
  AgentEvent,
  DrainedPendingAction,
  SessionState,
  SessionReconnectReason,
} from "@apnex/network-adapter";

import type { Message } from "./message.js";
import { SeenIdCache, type SeenIdCacheOptions } from "./seen-id-cache.js";

/**
 * Host-injected callback bag. Mirrors `SharedDispatcherOptions.notificationHooks`
 * in `@apnex/network-adapter` so a Layer-3 shim can pass the same bag
 * through Layer 2 without any shape adapters.
 *
 * All hooks are optional — omitting one silently disables that
 * dispatch path (preserves the spec's "All four hooks are optional"
 * contract).
 */
export interface NotificationHooks {
  onActionableEvent?: (event: AgentEvent) => void;
  onInformationalEvent?: (event: AgentEvent) => void;
  onStateChange?: (
    state: SessionState,
    previous: SessionState,
    reason?: SessionReconnectReason,
  ) => void;
  onPendingActionItem?: (item: DrainedPendingAction) => void;
}

export interface MessageRouterOptions {
  /** Required. The host-supplied callback bag. */
  hooks: NotificationHooks;
  /**
   * Optional. Pre-constructed SeenIdCache (sharing across routers, tests).
   * If omitted, the router constructs its own using `cacheOptions`.
   */
  seenIdCache?: SeenIdCache;
  /** Optional. Forwarded to a freshly-constructed cache when one isn't supplied. */
  cacheOptions?: SeenIdCacheOptions;
}

export class MessageRouter {
  private readonly hooks: NotificationHooks;
  private readonly seenIds: SeenIdCache;

  constructor(options: MessageRouterOptions) {
    this.hooks = options.hooks;
    this.seenIds = options.seenIdCache ?? new SeenIdCache(options.cacheOptions);
  }

  /**
   * Route a message to its bound hook. Returns `true` if the message
   * was dispatched, `false` if it was deduped (LRU short-circuit) or
   * the relevant hook is not implemented.
   *
   * State changes never dedup — they are FSM transitions, not
   * Hub Messages, and have no stable identity on the wire.
   */
  route(message: Message): boolean {
    switch (message.kind) {
      case "notification.actionable":
      case "repo-event":
        if (!this.shouldDispatch(message.event)) return false;
        return this.invoke(this.hooks.onActionableEvent, message.event);

      case "notification.informational":
        if (!this.shouldDispatch(message.event)) return false;
        return this.invoke(this.hooks.onInformationalEvent, message.event);

      case "pending-action.dispatch":
        if (!this.seenIds.markSeen(message.item.id)) return false;
        return this.invoke(this.hooks.onPendingActionItem, message.item);

      case "state.change": {
        const hook = this.hooks.onStateChange;
        if (!hook) return false;
        hook(message.state, message.previous, message.reason);
        return true;
      }
    }
  }

  /** Visibility for diagnostics + tests. */
  cacheSize(): number {
    return this.seenIds.size();
  }

  private shouldDispatch(event: AgentEvent): boolean {
    if (event.id === undefined) return true;
    return this.seenIds.markSeen(String(event.id));
  }

  private invoke<T>(hook: ((arg: T) => void) | undefined, arg: T): boolean {
    if (!hook) return false;
    hook(arg);
    return true;
  }
}
