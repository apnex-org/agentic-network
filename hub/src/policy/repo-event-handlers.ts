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
 * Path C scope (Director-ratified 2026-04-30): substrate originally shipped
 * ONE handler (commit-pushed). Later missions promoted selected PR and
 * workflow-run subkinds into this registry; remaining unregistered subkinds
 * continue to log-and-skip non-fatally.
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
import { PR_OPENED_HANDLER } from "./repo-event-pr-opened-handler.js";
import { PR_MERGED_HANDLER } from "./repo-event-pr-merged-handler.js";
import { PR_REVIEW_SUBMITTED_HANDLER } from "./repo-event-pr-review-submitted-handler.js";
import { PR_REVIEW_APPROVED_HANDLER } from "./repo-event-pr-review-approved-handler.js";
import {
  PR_REVIEW_REQUESTED_HANDLER,
  PR_REVIEW_REQUEST_REMOVED_HANDLER,
} from "./repo-event-pr-review-requested-handler.js";
import {
  WORKFLOW_RUN_COMPLETED_HANDLER,
  WORKFLOW_RUN_DISPATCHED_HANDLER,
  WORKFLOW_RUN_IN_PROGRESS_HANDLER,
} from "./repo-event-workflow-run-handler.js";

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
 * Registered repo-event handlers. mission-76 W1 adds 3 PR-event handlers
 * per bug-46 closure (pr-opened, pr-merged, pr-review-submitted); bug-51
 * adds pr-review-approved (closes mission-76 §3.1.1 + §8 AG-2 carve-out —
 * original "redundant with pr-review-submitted" rationale was factually
 * incorrect; translator routes approved reviews to a separate subkind
 * that pr-review-submitted never sees, so approval was being silently
 * dropped).
 *
 * mission-85 retires COMMIT_PUSHED_HANDLER (mission-68 W1 origin) per
 * CROSS-LAYER IDENTITY EXTRACTION calibration; bug-98 wontfix. Replacement
 * for architect-side PR-review-readiness signal is engineer-thread-
 * explicit-surface on coord-thread (operational per mission-84 6-PR
 * cycle). See `docs/designs/m-commit-pushed-handler-retirement-design.md`.
 *
 * Net coverage: 6 PR-event handlers + 3 workflow-run handlers post
 * mission-85 retirement and pr_review_request_event0. commit-pushed events
 * still flow through bridge but dispatch to no registered handler (skip is
 * intentional per retirement). pr-closed + pr-review-comment remain carved
 * out per idea-250 with documented promotion triggers. unknown remains the
 * intentional fallback.
 */
export const REPO_EVENT_HANDLERS: readonly RepoEventHandler[] = [
  PR_OPENED_HANDLER,
  PR_MERGED_HANDLER,
  PR_REVIEW_SUBMITTED_HANDLER,
  PR_REVIEW_APPROVED_HANDLER,
  PR_REVIEW_REQUESTED_HANDLER,
  PR_REVIEW_REQUEST_REMOVED_HANDLER,
  // idea-255 / M-Workflow-Run-Events-Hub-Integration v1.0 §1.3 F2 fold:
  // 3 entries — one per workflow-run-* subkind for filter-list granularity
  WORKFLOW_RUN_COMPLETED_HANDLER,
  WORKFLOW_RUN_DISPATCHED_HANDLER,
  WORKFLOW_RUN_IN_PROGRESS_HANDLER,
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
