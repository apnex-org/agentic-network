/**
 * pr-merged handler — mission-76 W1 (bug-46 closure) + bug-50 fix.
 *
 * Per Design v1.0 §3.1 + §3.4 symmetric routing — closes the PR-merged
 * notification gap. Bilateral (engineer-merges → architect; architect-
 * merges → engineer); differs from commit-pushed AG-7. Distinct from
 * pr-closed (which is carved out per §3.1.1 + AG-2 — author-abandon-or-
 * decline; low peer-coord signal value).
 *
 * Thin wrapper around `synthesizePrNotification` per §3.1 P1 DRY concur:
 * shares pr-opened's `PrLifecyclePayload` shape (translator routes both
 * pr-opened + pr-merged through the same `normalizePullRequest` normalizer);
 * intentValue `pr-merged-notification` per §3.5 m1 fold. Body-template drops
 * trailing colon when title empty per bug-50 Class B.
 */

import type { Message } from "../entities/index.js";
import type { IPolicyContext } from "./types.js";
import type { MessageDispatch, RepoEventHandler } from "./repo-event-handlers.js";
import { lookupUniqueAgentByGhLogin } from "./repo-event-author-lookup.js";
import {
  synthesizePrNotification,
  extractRefField,
  type PrLifecyclePayload,
  type PrNotificationOpts,
} from "./repo-event-pr-handler-helpers.js";

const PR_MERGED_OPTS: PrNotificationOpts<PrLifecyclePayload> = {
  subkind: "pr-merged",
  intentValue: "pr-merged-notification",
  extractPayload(raw) {
    if (typeof raw.number !== "number") return null;
    return {
      author: typeof raw.author === "string" ? raw.author : "",
      number: raw.number,
      title: typeof raw.title === "string" ? raw.title : "",
      url: typeof raw.url === "string" ? raw.url : "",
      base: extractRefField(raw.base),
      head: extractRefField(raw.head),
    };
  },
  extractAuthorLogin(p) {
    return p.author || null;
  },
  bodyTemplate(authorRole, p) {
    const subject = authorRole === "engineer" ? "Engineer" : "Architect";
    // bug-50 Class B: drop trailing colon when title empty.
    return p.title
      ? `${subject} merged PR #${p.number}: ${p.title}`
      : `${subject} merged PR #${p.number}`;
  },
  buildPayloadFields(p) {
    return {
      prNumber: p.number,
      prTitle: p.title,
      prAuthor: p.author,
      prUrl: p.url,
      prBaseRef: p.base?.ref ?? "",
      prHeadRef: p.head?.ref ?? "",
    };
  },
};

function extractPrMergedPayloadSilently(inbound: Message): PrLifecyclePayload | null {
  const repoEvent = inbound.payload as { payload?: unknown } | undefined;
  const inner = repoEvent?.payload;
  if (!inner || typeof inner !== "object" || Array.isArray(inner)) return null;
  return PR_MERGED_OPTS.extractPayload(inner as Record<string, unknown>);
}

async function buildDirectAuthorNotification(
  inbound: Message,
  ctx: IPolicyContext,
): Promise<MessageDispatch | null> {
  const payload = extractPrMergedPayloadSilently(inbound);
  if (!payload) return null;

  const authorLogin = PR_MERGED_OPTS.extractAuthorLogin(payload);
  if (!authorLogin) return null;

  const author = await lookupUniqueAgentByGhLogin(authorLogin, ctx);
  if (!author) return null;

  // Slice 0 direct author routing is for production engineer/architect actors
  // only, and only when the GitHub-login→agent mapping is unique. Director,
  // verifier, unregistered, and duplicate-login authors preserve the existing
  // skip semantics from the bilateral peer notification path.
  if (author.role !== "engineer" && author.role !== "architect") return null;

  return {
    kind: "note",
    target: { agentId: author.agentId },
    delivery: "push-immediate",
    intent: "pr-merged-author-notification",
    payload: {
      body: PR_MERGED_OPTS.bodyTemplate(author.role, payload),
      ...PR_MERGED_OPTS.buildPayloadFields(payload),
      sourceMessageId: inbound.id,
      routingReason: "pr-author-direct",
      authorAgentId: author.agentId,
    },
  };
}

async function handlePrMerged(
  inbound: Message,
  ctx: IPolicyContext,
): Promise<MessageDispatch[]> {
  const dispatches = await synthesizePrNotification(inbound, ctx, PR_MERGED_OPTS);
  const directAuthor = await buildDirectAuthorNotification(inbound, ctx);
  return directAuthor ? [...dispatches, directAuthor] : dispatches;
}

export const PR_MERGED_HANDLER: RepoEventHandler = {
  subkind: "pr-merged",
  name: "pr_merged_bilateral",
  handle: handlePrMerged,
};
