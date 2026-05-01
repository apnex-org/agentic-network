/**
 * Repo-event handler registry — mission-68 W1.
 *
 * Substrate-grade message-content dispatch primitive. Consumes
 * `kind=external-injection + payload.kind=repo-event + payload.subkind=X`
 * messages emitted by `packages/repo-event-bridge/` (mission-52
 * substrate-already-shipped) and routes per-subkind to registered
 * handlers that synthesize cross-party notifications + downstream
 * Messages.
 *
 * Per Design v1.0 §2.1 (engineer P1 ratification): structurally
 * distinct from `triggers.ts` (entity-status-transition pattern); this
 * registry handles message-content semantics (no entity transition).
 * Conflating into triggers.ts would risk abstraction-debt — separate
 * registry preserves the boundary.
 *
 * Per Design v1.0 §2.4 two-message-intent rationale (M1 fold): the
 * bridge's `target: null` broadcast (`kind=external-injection`) and a
 * handler's synthesized note (`kind=note`) serve TWO consumer concerns
 * by-design — raw broadcast is substrate-grade event signal; synthesized
 * note is engineer-cadence-discipline-shaped derivative. Architect-role
 * subscribers receive both; this duplication is intentional.
 *
 * Registry shape (per engineer P1 probe-back):
 *   - The registry IS the actor list — registered handler ⟹ wants to
 *     fire. No DOWNSTREAM_ACTORS-equivalent gate (unlike triggers.ts).
 *   - Missing handler for a received subkind → log-warn at WARN level
 *     (non-fatal; substrate-grade isolation per `repo-event-handler.ts`
 *     failure-isolation contract).
 *
 * Path C scope (Director-ratified 2026-04-30): substrate ships ONE
 * handler this mission (commit-pushed); additional handlers
 * (pr-opened/closed/merged/review-requested/etc.) compose via idea-227
 * Hook Design or a dedicated cross-party-routing follow-on mission per
 * AG-4 anti-goal.
 *
 * How to add a new handler:
 *   1. Author handler module (e.g., `pr-opened-handler.ts`) exporting
 *      a `RepoEventHandler` constant.
 *   2. Append to `REPO_EVENT_HANDLERS` below.
 *   3. Add unit test in `hub/test/unit/repo-event-handlers.test.ts`.
 *   4. PR review locks the registry. Runtime cannot mutate.
 */

import type { Message } from "../entities/index.js";
import type { IPolicyContext } from "./types.js";
import type { RepoEventSubkind } from "@apnex/repo-event-bridge";
import { COMMIT_PUSHED_HANDLER } from "./repo-event-commit-pushed-handler.js";

/**
 * Shape of a downstream Message a handler emits. Mirrors the args
 * shape of `create_message` (kind + target + delivery + payload +
 * optional intent/semanticIntent). The dispatcher invokes
 * `ctx.stores.message.createMessage` with each entry; the cascade is
 * bounded by the createMessage post-create cascade-depth gating
 * (no infinite recursion: handlers emit `kind=note`, which doesn't
 * match the repo-event detection rule that triggers re-dispatch).
 */
export interface MessageDispatch {
  readonly kind: Message["kind"];
  readonly target: Message["target"];
  readonly delivery?: Message["delivery"];
  readonly payload: unknown;
  readonly intent?: string;
  readonly semanticIntent?: string;
}

/**
 * Per-subkind handler. Pure-ish: reads ctx.stores; emits MessageDispatch[]
 * (the dispatcher persists each via createMessage). Errors thrown propagate
 * to the dispatcher's try/catch + are logged + non-fatal.
 */
export interface RepoEventHandler {
  /** Repo-event subkind this handler matches. */
  readonly subkind: RepoEventSubkind;
  /**
   * Per-event handler. `inbound` is the external-injection Message that
   * carries the repo-event envelope at `inbound.payload`. Returns 0+
   * downstream MessageDispatch entries; empty array = no synthesized
   * notification (e.g., handler decided to skip per logic check).
   */
  readonly handle: (
    inbound: Message,
    ctx: IPolicyContext,
  ) => Promise<MessageDispatch[]>;
  /** Human-readable name for log/metric attribution. */
  readonly name: string;
}

/**
 * Registered repo-event handlers. Path C ships ONE handler; additional
 * handlers compose via idea-227 / future mission per AG-4 anti-goal.
 */
export const REPO_EVENT_HANDLERS: readonly RepoEventHandler[] = [
  COMMIT_PUSHED_HANDLER,
];

/**
 * Look up a handler by subkind. Returns null when none registered;
 * caller (dispatcher) decides treatment — current convention is
 * log-warn at WARN + skip (non-fatal).
 */
export function findRepoEventHandler(
  subkind: string,
): RepoEventHandler | null {
  return (
    REPO_EVENT_HANDLERS.find((h) => h.subkind === subkind) ?? null
  );
}
