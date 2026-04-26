/**
 * @ois/message-router — sovereign Layer-2 Message dispatch + dedup.
 *
 * Mission-56 W2.1 (Design v1.2 §"Architectural commitments #4"). Routes
 * Layer-2 Messages onto the four-hook Universal Adapter notification
 * contract surface (`docs/specs/universal-adapter-notification-contract.md`)
 * with bounded seen-id LRU dedup for the push+poll race.
 */
export type { Message, MessageKind, ActionableMessage, InformationalMessage, StateChangeMessage, PendingActionMessage, RepoEventMessage, } from "./message.js";
export { MessageRouter, } from "./message-router.js";
export type { MessageRouterOptions, NotificationHooks, } from "./message-router.js";
export { SeenIdCache, } from "./seen-id-cache.js";
export type { SeenIdCacheOptions, } from "./seen-id-cache.js";
