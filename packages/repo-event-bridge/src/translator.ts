/**
 * GH-event → message-shape translator.
 *
 * Mission-52 T1. Pure, transport-agnostic. Inputs are GitHub event
 * envelopes (the shape returned by GitHub's Events API: `{type, payload}`,
 * also produced by the Webhooks delivery shape with the `X-GitHub-Event`
 * header value as `type`); outputs are sink-ready `RepoEvent` envelopes
 * with `kind: "repo-event"`, a normalized `subkind`, and a v1 payload.
 *
 * Subkind taxonomy (v1; see README for evolution policy):
 *   - `pr-opened` / `pr-closed` / `pr-merged`
 *       Pull-request lifecycle. `pr-merged` distinguishes merge vs.
 *       plain close (closed-without-merge → `pr-closed`).
 *   - `pr-review-submitted` / `pr-review-approved` / `pr-review-comment`
 *       Review lifecycle. `pr-review-approved` is split out so
 *       merge-gate consumers can dispatch cheaply; `pr-review-comment`
 *       covers in-line review comments; `pr-review-submitted` covers
 *       the residual "changes_requested" / generic-comment review
 *       state.
 *   - `pr-review-requested` / `pr-review-request-removed`
 *       Review request assignment lifecycle. These are GitHub
 *       `pull_request` actions (`review_requested` / `review_request_removed`),
 *       not submitted review bodies and not branch-protection state.
 *   - `commit-pushed`
 *       Push event (one or more commits to a ref).
 *   - `unknown`
 *       Graceful-degrade fallback for unrecognized event types or
 *       malformed shapes. The original payload is preserved verbatim
 *       in `payload.raw` so the Hub can log + alert on rising
 *       unknown-rate without losing forensics.
 *
 * Architectural rationale (per thread-312 round-2): keeping `kind`
 * fixed at `"repo-event"` and pushing per-type semantics into `subkind`
 * keeps the sink-side routing surface clean — sinks dispatch on `kind`
 * (one router entry per envelope shape), while per-type business
 * logic dispatches on `subkind` (extensible without touching the
 * router). The `unknown` subkind is the load-bearing fallback that
 * makes the surface forward-compatible: a new GH event type doesn't
 * break ingestion, it just lands as `unknown` until the translator is
 * extended.
 *
 * v1 payload normalization is deliberately minimal — enough to drive
 * the initial Hub-side dispatch (T3) without locking schemas
 * downstream. Translator-schema-evolution is a tracked future-mission
 * seed (per mission-52 T5 closing audit).
 */

import type { RepoEvent } from "./event-source.js";

// ── Subkind taxonomy ─────────────────────────────────────────────────

export const REPO_EVENT_SUBKINDS = [
  "pr-opened",
  "pr-closed",
  "pr-merged",
  "pr-review-submitted",
  "pr-review-approved",
  "pr-review-comment",
  "pr-review-requested",
  "pr-review-request-removed",
  "commit-pushed",
  // idea-255 / M-Workflow-Run-Events-Hub-Integration v1.0 (sibling translator
  // in `./workflow-run-translator.ts` produces these subkinds; per-conclusion
  // event-name split for filter-list granularity per Design v1.0 §1.2 F3 fold)
  "workflow-run-completed",
  "workflow-run-dispatched",
  "workflow-run-in-progress",
  "unknown",
] as const;

export type RepoEventSubkind = (typeof REPO_EVENT_SUBKINDS)[number];

// ── Public API ────────────────────────────────────────────────────────

/**
 * Translate a raw GH event envelope into the sink-ready `RepoEvent`
 * shape. Total function — never throws; unrecognized inputs become
 * `subkind: "unknown"` with the raw payload preserved.
 */
export function translateGhEvent(ghEvent: unknown): RepoEvent {
  const subkind = dispatchSubkind(ghEvent);
  return {
    kind: "repo-event",
    subkind,
    payload: normalizeGhEvent(ghEvent, subkind),
  };
}

/**
 * Inspect a GH event envelope and return the canonical subkind. Pure;
 * does not normalize payload. Exported so consumers (PollSource, sink
 * dispatchers, tests) can dispatch without re-running the full
 * translator.
 */
export function dispatchSubkind(ghEvent: unknown): RepoEventSubkind {
  if (!isRecord(ghEvent)) return "unknown";

  const type = typeof ghEvent.type === "string" ? ghEvent.type : undefined;
  const payload = isRecord(ghEvent.payload) ? ghEvent.payload : undefined;

  switch (type) {
    case "PullRequestEvent":
      return dispatchPullRequest(payload);
    case "PullRequestReviewEvent":
      return dispatchPullRequestReview(payload);
    case "PullRequestReviewCommentEvent":
      return "pr-review-comment";
    case "PushEvent":
      return "commit-pushed";
    default:
      return "unknown";
  }
}

/**
 * Extract a stable, sink-friendly v1 payload from a GH event. The
 * shape is per-subkind; consumers should switch on the parent
 * `RepoEvent.subkind` before reading fields. For `unknown`, the
 * original input is preserved under `raw` so downstream consumers
 * can still introspect / log / alert.
 */
export function normalizeGhEvent(
  ghEvent: unknown,
  subkind: RepoEventSubkind,
): Record<string, unknown> {
  if (!isRecord(ghEvent)) {
    return { raw: ghEvent };
  }
  const payload = isRecord(ghEvent.payload) ? ghEvent.payload : {};
  const repo = extractRepo(ghEvent);

  // bug-49 (3rd canonical instance of webhook-vs-Events-API-shape-mismatch
  // class per idea-249 methodology-fold): Events API consistently null on
  // nested user fields (pr.user / review.user / comment.user); user info
  // only available at event-level ghEvent.actor. Pass actor to ALL
  // normalize-*-with-author functions so they can fall back when nested
  // user is null. Same pattern as bug-44's PushEvent fix.
  const actor = isRecord(ghEvent.actor) ? ghEvent.actor : undefined;
  switch (subkind) {
    case "pr-opened":
    case "pr-closed":
    case "pr-merged":
      return normalizePullRequest(payload, repo, actor);
    case "pr-review-requested":
    case "pr-review-request-removed":
      return normalizePullRequestReviewRequest(payload, repo, actor);
    case "pr-review-submitted":
    case "pr-review-approved":
      return normalizePullRequestReview(payload, repo, actor);
    case "pr-review-comment":
      return normalizePullRequestReviewComment(payload, repo, ghEvent, actor);
    case "commit-pushed":
      // bug-44: GH Events API places the user at ghEvent.actor.login (event-level),
      // NOT in payload.pusher / payload.sender (those are webhook-only). Pass actor
      // so normalizePush can fall back to it when the webhook fields are absent.
      return normalizePush(payload, repo, actor);
    case "workflow-run-completed":
    case "workflow-run-dispatched":
    case "workflow-run-in-progress":
      // Defensive — these subkinds are produced by the sibling
      // `workflow-run-translator.ts`, not this /events-API path. If a
      // workflow-run subkind reaches this normalizer the input shape is
      // wrong; preserve raw for forensics.
      return { raw: ghEvent };
    case "unknown":
      return { raw: ghEvent };
  }
}

// ── Internal: per-type subkind dispatch ──────────────────────────────

function dispatchPullRequest(
  payload: Record<string, unknown> | undefined,
): RepoEventSubkind {
  if (!payload) return "unknown";
  const action = payload.action;
  if (action === "opened") return "pr-opened";
  // GH Events API emits action="merged" directly (no nested pull_request.merged
  // discriminator). Webhook delivery emits action="closed" + pull_request.merged
  // = true (handled below). Both shapes exist in the wild — bug-39 surfaced
  // when the live events-API path was dispatched to "unknown" by an earlier
  // version of this function that only handled the webhook shape.
  if (action === "merged") return "pr-merged";
  // Reopens are functionally equivalent to opens for downstream consumers
  // (PR is alive again; may need triage). Both events-API and webhook shapes
  // emit action="reopened".
  if (action === "reopened") return "pr-opened";
  if (action === "review_requested") return "pr-review-requested";
  if (action === "review_request_removed") return "pr-review-request-removed";
  if (action === "closed") {
    const pr = isRecord(payload.pull_request) ? payload.pull_request : undefined;
    return pr?.merged === true ? "pr-merged" : "pr-closed";
  }
  return "unknown";
}

function dispatchPullRequestReview(
  payload: Record<string, unknown> | undefined,
): RepoEventSubkind {
  if (!payload) return "unknown";
  // mission-76 W1 (bug-46 closure substrate-investigation finding):
  // Events API uses action="created" for new review submissions; webhook
  // delivery uses action="submitted". Both are equivalent — same shape
  // as bug-44's PushEvent pusher-vs-actor API-vs-webhook mismatch.
  // Action="dismissed" (review withdrawn after-the-fact) + action="updated"
  // (review-edit; not new-review-event) continue to route to `unknown`
  // per architect-judgement: dismissed-review notifications would be
  // noise (operator already saw original review); updated-review is
  // review-edit not new-review-event.
  if (payload.action !== "submitted" && payload.action !== "created") {
    return "unknown";
  }
  const review = isRecord(payload.review) ? payload.review : undefined;
  const state = review?.state;
  if (state === "approved") return "pr-review-approved";
  if (state === "commented") return "pr-review-comment";
  // `changes_requested` and any other submitted/created state.
  return "pr-review-submitted";
}

// ── Internal: per-subkind payload normalization ──────────────────────

function normalizePullRequest(
  payload: Record<string, unknown>,
  repo: string | undefined,
  actor?: Record<string, unknown>,
): Record<string, unknown> {
  const pr = isRecord(payload.pull_request) ? payload.pull_request : {};
  return {
    repo,
    action: payload.action,
    number: pr.number,
    // bug-50 Class B: GH Events API emits pr.title=null + pr.html_url=null;
    // only pr.url (API URL) is populated. Normalize title to "" at the v1
    // contract (defensive — handler-side fallback already converts null→"";
    // this is style-cleanup so the contract is "title is always a string").
    title: typeof pr.title === "string" ? pr.title : "",
    // bug-50 Class B: html_url preferred (webhook delivery); derive from
    // pr.url (API URL) when html_url is null (Events API). Scoped strictly to
    // PR URLs — review URL has different shape (#pullrequestreview-{R} fragment),
    // review-comment URL CANNOT be derived from comment.url alone (lacks PR
    // number); both deferred to a separate fix if/when null observed live.
    url:
      typeof pr.html_url === "string"
        ? pr.html_url
        : typeof pr.url === "string"
          ? deriveHtmlUrlFromApiUrl(pr.url)
          : "",
    // bug-49: GH Events API consistently null on pr.user; webhook delivery
    // populates pr.user. Fall back to event-level actor when pr.user absent.
    // Same pattern as bug-44's PushEvent pusher-vs-actor fallback chain.
    author: extractLogin(pr.user) ?? extractLogin(actor),
    merged: pr.merged === true,
    base: extractRef(pr.base),
    head: extractRef(pr.head),
  };
}

function normalizePullRequestReviewRequest(
  payload: Record<string, unknown>,
  repo: string | undefined,
  actor?: Record<string, unknown>,
): Record<string, unknown> {
  const base = normalizePullRequest(payload, repo, actor);
  const requestedReviewer = isRecord(payload.requested_reviewer)
    ? payload.requested_reviewer
    : undefined;
  const requestedTeam = isRecord(payload.requested_team) ? payload.requested_team : undefined;
  return {
    ...base,
    requestedReviewerLogin: extractLogin(requestedReviewer),
    requestedTeamSlug: typeof requestedTeam?.slug === "string" ? requestedTeam.slug : undefined,
    requestedTeamName: typeof requestedTeam?.name === "string" ? requestedTeam.name : undefined,
  };
}

function normalizePullRequestReview(
  payload: Record<string, unknown>,
  repo: string | undefined,
  actor?: Record<string, unknown>,
): Record<string, unknown> {
  const review = isRecord(payload.review) ? payload.review : {};
  const pr = isRecord(payload.pull_request) ? payload.pull_request : {};
  return {
    repo,
    prNumber: pr.number,
    // bug-49: GH Events API consistently null on review.user; webhook
    // delivery populates review.user. Fall back to event-level actor when
    // review.user absent. Same pattern as bug-44's PushEvent fallback.
    reviewer: extractLogin(review.user) ?? extractLogin(actor),
    state: review.state,
    body: review.body,
    url: review.html_url,
  };
}

function normalizePullRequestReviewComment(
  payload: Record<string, unknown>,
  repo: string | undefined,
  parent: Record<string, unknown>,
  actor?: Record<string, unknown>,
): Record<string, unknown> {
  // Comments may live on either the review-comment event payload or
  // (in 'submitted' state='commented' reviews) on the review payload
  // itself. Prefer payload.comment; fall back to payload.review.
  const comment = isRecord(payload.comment)
    ? payload.comment
    : isRecord(payload.review)
      ? payload.review
      : {};
  const pr = isRecord(payload.pull_request) ? payload.pull_request : {};
  return {
    repo,
    prNumber: pr.number,
    // bug-49: GH Events API consistently null on comment.user; webhook
    // delivery populates comment.user. Fall back to event-level actor when
    // comment.user absent. Same pattern as bug-44's PushEvent fallback.
    commenter: extractLogin(comment.user) ?? extractLogin(actor),
    body: comment.body,
    url: comment.html_url,
    sourceType: parent.type,
  };
}

function normalizePush(
  payload: Record<string, unknown>,
  repo: string | undefined,
  actor?: Record<string, unknown>,
): Record<string, unknown> {
  const commitsRaw = Array.isArray(payload.commits) ? payload.commits : [];
  const commits = commitsRaw.map((c) => {
    if (!isRecord(c)) return { raw: c };
    const author = isRecord(c.author) ? c.author : undefined;
    return {
      sha: c.sha ?? c.id,
      message: c.message,
      author: author?.name ?? author?.email,
    };
  });
  return {
    repo,
    ref: payload.ref,
    // bug-44: Events API has no pusher/sender in payload; falls back to actor
    // (extracted at event level by caller). Webhook deliveries continue to work
    // via the payload.pusher / payload.sender path.
    pusher:
      extractLogin(payload.pusher) ??
      extractLogin(payload.sender) ??
      extractLogin(actor),
    commitCount: commits.length,
    commits,
  };
}

// ── Internal: small extraction helpers ───────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extractLogin(user: unknown): string | undefined {
  if (!isRecord(user)) return undefined;
  if (typeof user.login === "string") return user.login;
  if (typeof user.name === "string") return user.name;
  return undefined;
}

function extractRef(ref: unknown): { ref?: string; sha?: string } | undefined {
  if (!isRecord(ref)) return undefined;
  return {
    ref: typeof ref.ref === "string" ? ref.ref : undefined,
    sha: typeof ref.sha === "string" ? ref.sha : undefined,
  };
}

// bug-50 Class B: GH Events API consistently null on pr.html_url; only
// pr.url (API URL) is populated. The transform is deterministic — no
// API call needed. Scoped strictly to PR URLs:
//   api.github.com/repos/{owner}/{repo}/pulls/{N}
//     → github.com/{owner}/{repo}/pull/{N}
// Review URL + review-comment URL transforms have different shapes and
// are deferred to a separate fix if/when null observed live.
function deriveHtmlUrlFromApiUrl(apiUrl: string): string {
  const m = apiUrl.match(
    /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/,
  );
  if (!m) {
    // Calibration log per bug-49 null-lookup-skip discipline — return
    // apiUrl as-is so downstream consumers have *something* (forks /
    // GH Enterprise / future shape changes won't silently emit "").
    console.info(
      `[translator] deriveHtmlUrlFromApiUrl: pr.url shape unrecognized (${apiUrl}); returning api-url as-is`,
    );
    return apiUrl;
  }
  return `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}`;
}

function extractRepo(ghEvent: Record<string, unknown>): string | undefined {
  // Events API places repo at top level: `{repo: {name: "owner/name"}}`.
  // Webhook delivery places it under `repository.full_name`.
  const topLevel = isRecord(ghEvent.repo) ? ghEvent.repo : undefined;
  if (topLevel && typeof topLevel.name === "string") return topLevel.name;
  const payload = isRecord(ghEvent.payload) ? ghEvent.payload : undefined;
  const repo = payload && isRecord(payload.repository) ? payload.repository : undefined;
  if (repo && typeof repo.full_name === "string") return repo.full_name;
  return undefined;
}
