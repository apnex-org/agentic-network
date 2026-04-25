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
// ── Subkind taxonomy ─────────────────────────────────────────────────
export const REPO_EVENT_SUBKINDS = [
    "pr-opened",
    "pr-closed",
    "pr-merged",
    "pr-review-submitted",
    "pr-review-approved",
    "pr-review-comment",
    "commit-pushed",
    "unknown",
];
// ── Public API ────────────────────────────────────────────────────────
/**
 * Translate a raw GH event envelope into the sink-ready `RepoEvent`
 * shape. Total function — never throws; unrecognized inputs become
 * `subkind: "unknown"` with the raw payload preserved.
 */
export function translateGhEvent(ghEvent) {
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
export function dispatchSubkind(ghEvent) {
    if (!isRecord(ghEvent))
        return "unknown";
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
export function normalizeGhEvent(ghEvent, subkind) {
    if (!isRecord(ghEvent)) {
        return { raw: ghEvent };
    }
    const payload = isRecord(ghEvent.payload) ? ghEvent.payload : {};
    const repo = extractRepo(ghEvent);
    switch (subkind) {
        case "pr-opened":
        case "pr-closed":
        case "pr-merged":
            return normalizePullRequest(payload, repo);
        case "pr-review-submitted":
        case "pr-review-approved":
            return normalizePullRequestReview(payload, repo);
        case "pr-review-comment":
            return normalizePullRequestReviewComment(payload, repo, ghEvent);
        case "commit-pushed":
            return normalizePush(payload, repo);
        case "unknown":
            return { raw: ghEvent };
    }
}
// ── Internal: per-type subkind dispatch ──────────────────────────────
function dispatchPullRequest(payload) {
    if (!payload)
        return "unknown";
    const action = payload.action;
    if (action === "opened")
        return "pr-opened";
    if (action === "closed") {
        const pr = isRecord(payload.pull_request) ? payload.pull_request : undefined;
        return pr?.merged === true ? "pr-merged" : "pr-closed";
    }
    return "unknown";
}
function dispatchPullRequestReview(payload) {
    if (!payload)
        return "unknown";
    if (payload.action !== "submitted")
        return "unknown";
    const review = isRecord(payload.review) ? payload.review : undefined;
    const state = review?.state;
    if (state === "approved")
        return "pr-review-approved";
    if (state === "commented")
        return "pr-review-comment";
    // `changes_requested` and any other submitted state.
    return "pr-review-submitted";
}
// ── Internal: per-subkind payload normalization ──────────────────────
function normalizePullRequest(payload, repo) {
    const pr = isRecord(payload.pull_request) ? payload.pull_request : {};
    return {
        repo,
        action: payload.action,
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        author: extractLogin(pr.user),
        merged: pr.merged === true,
        base: extractRef(pr.base),
        head: extractRef(pr.head),
    };
}
function normalizePullRequestReview(payload, repo) {
    const review = isRecord(payload.review) ? payload.review : {};
    const pr = isRecord(payload.pull_request) ? payload.pull_request : {};
    return {
        repo,
        prNumber: pr.number,
        reviewer: extractLogin(review.user),
        state: review.state,
        body: review.body,
        url: review.html_url,
    };
}
function normalizePullRequestReviewComment(payload, repo, parent) {
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
        commenter: extractLogin(comment.user),
        body: comment.body,
        url: comment.html_url,
        sourceType: parent.type,
    };
}
function normalizePush(payload, repo) {
    const commitsRaw = Array.isArray(payload.commits) ? payload.commits : [];
    const commits = commitsRaw.map((c) => {
        if (!isRecord(c))
            return { raw: c };
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
        pusher: extractLogin(payload.pusher) ?? extractLogin(payload.sender),
        commitCount: commits.length,
        commits,
    };
}
// ── Internal: small extraction helpers ───────────────────────────────
function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function extractLogin(user) {
    if (!isRecord(user))
        return undefined;
    if (typeof user.login === "string")
        return user.login;
    if (typeof user.name === "string")
        return user.name;
    return undefined;
}
function extractRef(ref) {
    if (!isRecord(ref))
        return undefined;
    return {
        ref: typeof ref.ref === "string" ? ref.ref : undefined,
        sha: typeof ref.sha === "string" ? ref.sha : undefined,
    };
}
function extractRepo(ghEvent) {
    // Events API places repo at top level: `{repo: {name: "owner/name"}}`.
    // Webhook delivery places it under `repository.full_name`.
    const topLevel = isRecord(ghEvent.repo) ? ghEvent.repo : undefined;
    if (topLevel && typeof topLevel.name === "string")
        return topLevel.name;
    const payload = isRecord(ghEvent.payload) ? ghEvent.payload : undefined;
    const repo = payload && isRecord(payload.repository) ? payload.repository : undefined;
    if (repo && typeof repo.full_name === "string")
        return repo.full_name;
    return undefined;
}
//# sourceMappingURL=translator.js.map