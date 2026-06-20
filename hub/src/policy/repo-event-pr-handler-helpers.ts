/**
 * PR-event handler helpers — mission-76 W1 (M-RepoEventBridge-Handler-Completion).
 *
 * Per Design v1.0 §3.1 + P1 DRY concur: shared helper consolidating the
 * extract → resolve-role → emit logic across the 3 PR-event handlers
 * (pr-opened, pr-merged, pr-review-submitted). Each thin wrapper
 * supplies subkind-specific opts (extractPayload + extractAuthorLogin
 * + bodyTemplate + buildPayloadFields + intentValue).
 *
 * Per §3.1 m2 fold — explicit role-skip enumeration:
 *   - Skip if author-role is null (lookup miss; demoted to console.info
 *     per mission-76 γ fold — null-lookup is EXPECTED behavior for
 *     unregistered author identity per bug-47 scenario-B reframing)
 *   - Skip if author-role is "director" (no peer-role for
 *     engineer↔architect-targeted notifications)
 *   - Otherwise emit notification targeting the peer (engineer→architect
 *     OR architect→engineer; symmetric per §3.4; differs from
 *     commit-pushed AG-7)
 *
 * Per §3.5 — body shape uses #41 STRUCTURAL ANCHOR pattern: terse
 * `body: string` + structured payload sub-fields for adapter-side
 * `source-attribute.ts` rendering. Per-subkind intent values per
 * round-1 m1 fold: pr-opened-notification / pr-merged-notification /
 * pr-review-notification.
 */

import type { Message } from "../entities/index.js";
import type { IPolicyContext } from "./types.js";
import type { MessageDispatch } from "./repo-event-handlers.js";
import { lookupRoleByGhLogin } from "./repo-event-author-lookup.js";

/** PR-event subkinds in scope for this mission (4 of 6 PR-event subkinds
 *  post-bug-51; +1 from mission-76's original 3 since bug-51 closes the
 *  pr-review-approved carve-out — the original §3.1.1 + §8 AG-2 rationale
 *  was factually incorrect, see repo-event-pr-review-approved-handler.ts).
 *  pr-closed + pr-review-comment remain carved out per idea-250. */
export type PrEventSubkind =
  | "pr-opened"
  | "pr-merged"
  | "pr-review-submitted"
  | "pr-review-approved";

/**
 * Shared payload shape for pr-opened + pr-merged (byte-identical post bug-50
 * Class A fix). pr-review-submitted has a different shape (prNumber/reviewer/
 * state) — kept separate to avoid awkward optional-field unions.
 *
 * `base` + `head` are objects-or-undefined per translator-truth: the bridge's
 * `normalizePullRequest` returns `{ref?: string, sha?: string} | undefined`
 * (translator.ts `extractRef`). Handlers adapt to translator-emitted shape;
 * the v0 string-shape was a cross-package contract drift (bug-50 Class A).
 */
export interface PrLifecyclePayload {
  /** GH login of the PR author (from `pull_request.user.login` ?? `event.actor.login`; bug-49 fallback). */
  author: string;
  number: number;
  title: string;
  url: string;
  base: { ref: string; sha: string } | undefined;
  head: { ref: string; sha: string } | undefined;
}

/** Type guard for object-shape extraction at the handler boundary
 *  (mirrors translator's internal `isRecord`). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Defensive base/head extraction at the handler boundary — translator emits
 *  `{ref?: string, sha?: string} | undefined`; coerce to fully-populated
 *  `{ref: string, sha: string}` shape (empty strings for missing fields).
 *  Returns undefined when raw isn't an object (preserves translator's
 *  malformed-input contract). bug-50 Class A. */
export function extractRefField(
  raw: unknown,
): { ref: string; sha: string } | undefined {
  if (!isRecord(raw)) return undefined;
  return {
    ref: typeof raw.ref === "string" ? raw.ref : "",
    sha: typeof raw.sha === "string" ? raw.sha : "",
  };
}

/**
 * Per-subkind opts supplied by each thin handler wrapper.
 *
 * @template P typed payload returned by `extractPayload`. Per-subkind
 * shape: pr-opened/pr-merged use `normalizePullRequest` shape; pr-review-
 * submitted uses `normalizePullRequestReview` shape (per
 * `packages/repo-event-bridge/src/translator.ts:182-216`).
 */
export interface PrNotificationOpts<P> {
  /** Subkind label — used in log lines for cold-reader attribution. */
  readonly subkind: PrEventSubkind;
  /** Intent value per §3.5 m1 fold. */
  readonly intentValue: string;
  /**
   * Extract typed payload from `inbound.payload.payload` (the bridge's
   * normalized `RepoEvent.payload`). Return null when the payload is
   * malformed (handler skips with warn).
   */
  readonly extractPayload: (raw: Record<string, unknown>) => P | null;
  /**
   * Extract the GH author login from typed payload. Return null when
   * absent (handler skips with warn). Per-subkind: pr-opened/pr-merged
   * use `payload.author`; pr-review-submitted uses `payload.reviewer`.
   */
  readonly extractAuthorLogin: (payload: P) => string | null;
  /**
   * Render the `body: string` line. `authorRole` is the GH author's
   * resolved role (engineer or architect; never director per
   * director-skip discipline upstream). Body subject = author role.
   */
  readonly bodyTemplate: (authorRole: "engineer" | "architect", payload: P) => string;
  /**
   * Build the structured payload sub-fields surfaced to the adapter.
   * Caller's payload (body + sourceMessageId) overlays these — the
   * helper synthesizes `body` + `sourceMessageId` separately.
   */
  readonly buildPayloadFields: (payload: P) => Record<string, unknown>;
}

/**
 * Synthesize a PR-event notification per the §3.1 m2 fold logic +
 * §3.4 symmetric routing + §3.5 body shape. Returns 0 or 1 dispatch
 * entries — 0 when extraction fails, lookup misses, or author is
 * director; 1 when author is engineer or architect (notification
 * targets the peer).
 *
 * Logging discipline (mission-76 γ fold):
 *   - console.warn — malformed payload (operator-actionable)
 *   - console.info — null-lookup-skip (EXPECTED behavior for
 *     unregistered authors; not actionable; demoted from warn per
 *     bug-47 scenario-B reframing)
 *   - console.info — director-author skip (EXPECTED behavior per
 *     §3.1 m2; not actionable)
 */
export async function synthesizePrNotification<P>(
  inbound: Message,
  ctx: IPolicyContext,
  opts: PrNotificationOpts<P>,
): Promise<MessageDispatch[]> {
  const repoEvent = inbound.payload as { payload?: unknown } | undefined;
  const inner = repoEvent?.payload;
  if (!inner || typeof inner !== "object" || Array.isArray(inner)) {
    console.warn(
      `[repo-event-${opts.subkind}-handler] inbound message ${inbound.id} missing or malformed payload.payload; skipping`,
    );
    return [];
  }

  const payload = opts.extractPayload(inner as Record<string, unknown>);
  if (!payload) {
    console.warn(
      `[repo-event-${opts.subkind}-handler] inbound message ${inbound.id} payload extraction failed; skipping`,
    );
    return [];
  }

  const authorLogin = opts.extractAuthorLogin(payload);
  if (!authorLogin) {
    console.warn(
      `[repo-event-${opts.subkind}-handler] inbound message ${inbound.id} missing author login; skipping`,
    );
    return [];
  }

  const role = await lookupRoleByGhLogin(authorLogin, ctx);

  // mission-76 γ fold (bug-47 scenario-B reframing): null-lookup is EXPECTED
  // behavior for unregistered author identity (Director's personal GH account,
  // third-party contributors, etc.). Demoted from console.warn to console.info —
  // null-lookup-skip is NOT operator-actionable in steady state.
  if (role === null) {
    console.info(
      `[repo-event-${opts.subkind}-handler] no role mapping for gh-login=${authorLogin} (no agent has label ois.io/github/login=${authorLogin}); skipping (expected for unregistered authors)`,
    );
    return [];
  }

  // §3.1 m2 fold — director-author skip; no peer-role for
  // engineer↔architect-targeted notifications (Director-author PRs are
  // out of bilateral cross-approval scope).
  if (role === "director") {
    console.info(
      `[repo-event-${opts.subkind}-handler] director-author event for gh-login=${authorLogin}; no peer-role to route; skipping`,
    );
    return [];
  }

  // mission-93: verifier is refute-not-produce — it has no produce surface and
  // is not part of the bilateral engineer↔architect PR cross-approval routing;
  // skip like director (no peer-role to route).
  if (role === "verifier") {
    console.info(
      `[repo-event-${opts.subkind}-handler] verifier-author event for gh-login=${authorLogin}; no peer-role to route; skipping`,
    );
    return [];
  }

  // role is "engineer" or "architect" — emit symmetric notification.
  const peerRole = role === "engineer" ? "architect" : "engineer";
  const body = opts.bodyTemplate(role, payload);
  const structuredFields = opts.buildPayloadFields(payload);

  return [
    {
      kind: "note",
      target: { role: peerRole },
      delivery: "push-immediate",
      payload: {
        body,
        ...structuredFields,
        sourceMessageId: inbound.id,
      },
      intent: opts.intentValue,
    },
  ];
}
