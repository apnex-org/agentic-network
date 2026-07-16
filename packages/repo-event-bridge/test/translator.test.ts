/**
 * Translator unit tests — mission-52 T1.
 *
 * Per-subkind dispatch + unknown-fallback graceful degrade. Conformance
 * tests (fixture replay) live in `test/conformance/`.
 */

import { describe, it, expect } from "vitest";
import {
  translateGhEvent,
  dispatchSubkind,
  normalizeGhEvent,
  REPO_EVENT_SUBKINDS,
} from "../src/translator.js";

describe("translateGhEvent — envelope shape", () => {
  it("always returns kind='repo-event'", () => {
    expect(translateGhEvent({ type: "PullRequestEvent", payload: { action: "opened" } }).kind).toBe(
      "repo-event",
    );
    expect(translateGhEvent(null).kind).toBe("repo-event");
    expect(translateGhEvent({ type: "TotallyUnrecognized" }).kind).toBe("repo-event");
  });

  it("returns subkind from REPO_EVENT_SUBKINDS taxonomy", () => {
    const event = translateGhEvent({ type: "PullRequestEvent", payload: { action: "opened" } });
    expect(REPO_EVENT_SUBKINDS).toContain(event.subkind);
  });

  it("preserves a payload object", () => {
    const event = translateGhEvent({
      type: "PullRequestEvent",
      payload: { action: "opened", pull_request: { number: 7 } },
    });
    expect(typeof event.payload).toBe("object");
    expect(event.payload).not.toBeNull();
  });
});

describe("dispatchSubkind — pull request lifecycle", () => {
  it("opened → pr-opened", () => {
    expect(
      dispatchSubkind({
        type: "PullRequestEvent",
        payload: { action: "opened", pull_request: { number: 1 } },
      }),
    ).toBe("pr-opened");
  });

  it("closed without merge → pr-closed", () => {
    expect(
      dispatchSubkind({
        type: "PullRequestEvent",
        payload: { action: "closed", pull_request: { merged: false } },
      }),
    ).toBe("pr-closed");
  });

  it("closed with merge=true → pr-merged", () => {
    expect(
      dispatchSubkind({
        type: "PullRequestEvent",
        payload: { action: "closed", pull_request: { merged: true } },
      }),
    ).toBe("pr-merged");
  });

  // bug-39: GH Events API emits action="merged" directly (no nested
  // pull_request.merged). Earlier translator only handled the webhook shape
  // (action="closed" + pull_request.merged=true) and dispatched live
  // events-API merge events to "unknown".
  it("merged action (events-API shape) → pr-merged", () => {
    expect(
      dispatchSubkind({
        type: "PullRequestEvent",
        payload: { action: "merged", pull_request: { number: 1 } },
      }),
    ).toBe("pr-merged");
  });

  it("merged action without pull_request still → pr-merged", () => {
    // Defensive: even if the events-API drops pull_request, the action alone
    // discriminates correctly.
    expect(
      dispatchSubkind({
        type: "PullRequestEvent",
        payload: { action: "merged" },
      }),
    ).toBe("pr-merged");
  });

  it("reopened action → pr-opened (alias for opens)", () => {
    expect(
      dispatchSubkind({
        type: "PullRequestEvent",
        payload: { action: "reopened", pull_request: { number: 1 } },
      }),
    ).toBe("pr-opened");
  });

  it("review_requested action → pr-review-requested", () => {
    expect(
      dispatchSubkind({
        type: "PullRequestEvent",
        payload: { action: "review_requested", pull_request: { number: 1 } },
      }),
    ).toBe("pr-review-requested");
  });

  it("review_request_removed action → pr-review-request-removed", () => {
    expect(
      dispatchSubkind({
        type: "PullRequestEvent",
        payload: { action: "review_request_removed", pull_request: { number: 1 } },
      }),
    ).toBe("pr-review-request-removed");
  });

  it("unrecognized PR action → unknown", () => {
    expect(
      dispatchSubkind({
        type: "PullRequestEvent",
        payload: { action: "edited", pull_request: { number: 1 } },
      }),
    ).toBe("unknown");
  });
});

describe("dispatchSubkind — review lifecycle", () => {
  it("submitted state=approved → pr-review-approved", () => {
    expect(
      dispatchSubkind({
        type: "PullRequestReviewEvent",
        payload: { action: "submitted", review: { state: "approved" } },
      }),
    ).toBe("pr-review-approved");
  });

  it("submitted state=commented → pr-review-comment", () => {
    expect(
      dispatchSubkind({
        type: "PullRequestReviewEvent",
        payload: { action: "submitted", review: { state: "commented" } },
      }),
    ).toBe("pr-review-comment");
  });

  it("submitted state=changes_requested → pr-review-submitted", () => {
    expect(
      dispatchSubkind({
        type: "PullRequestReviewEvent",
        payload: { action: "submitted", review: { state: "changes_requested" } },
      }),
    ).toBe("pr-review-submitted");
  });

  it("PullRequestReviewCommentEvent → pr-review-comment", () => {
    expect(
      dispatchSubkind({
        type: "PullRequestReviewCommentEvent",
        payload: { action: "created", comment: { body: "nit" } },
      }),
    ).toBe("pr-review-comment");
  });

  it("review action != submitted → unknown", () => {
    expect(
      dispatchSubkind({
        type: "PullRequestReviewEvent",
        payload: { action: "dismissed", review: { state: "approved" } },
      }),
    ).toBe("unknown");
  });

  // mission-76 W1 (bug-46 closure substrate-investigation finding):
  // Events API uses action="created" for new review submissions; webhook
  // delivery uses action="submitted". Both are equivalent — same shape
  // as bug-44's PushEvent pusher-vs-actor API-vs-webhook mismatch.
  it("Events API: created state=approved → pr-review-approved (bug-46 mission-76)", () => {
    expect(
      dispatchSubkind({
        type: "PullRequestReviewEvent",
        payload: { action: "created", review: { state: "approved" } },
      }),
    ).toBe("pr-review-approved");
  });

  it("Events API: created state=commented → pr-review-comment (bug-46 mission-76)", () => {
    expect(
      dispatchSubkind({
        type: "PullRequestReviewEvent",
        payload: { action: "created", review: { state: "commented" } },
      }),
    ).toBe("pr-review-comment");
  });

  it("Events API: created state=changes_requested → pr-review-submitted (bug-46 mission-76)", () => {
    expect(
      dispatchSubkind({
        type: "PullRequestReviewEvent",
        payload: { action: "created", review: { state: "changes_requested" } },
      }),
    ).toBe("pr-review-submitted");
  });

  it("Events API: created state=dismissed → pr-review-submitted (catch-all for non-{approved,commented} states)", () => {
    // bug-46 mission-76: state "dismissed" on a created review event is
    // unusual but the catch-all rule (any state other than approved/commented)
    // routes to pr-review-submitted. Distinct from action="dismissed" which
    // routes to "unknown" per the next test.
    expect(
      dispatchSubkind({
        type: "PullRequestReviewEvent",
        payload: { action: "created", review: { state: "dismissed" } },
      }),
    ).toBe("pr-review-submitted");
  });

  it("review action=updated → unknown (review-edit; not new-review-event; mission-76 architect-judgement)", () => {
    expect(
      dispatchSubkind({
        type: "PullRequestReviewEvent",
        payload: { action: "updated", review: { state: "approved" } },
      }),
    ).toBe("unknown");
  });

  it("review action=dismissed → unknown (review-withdrawn-after-the-fact; would be operator noise; mission-76 architect-judgement)", () => {
    // Already covered by "review action != submitted → unknown" above; this
    // test is the explicit positive assertion for the architect-judgement
    // documented in translator.ts mission-76 comment.
    expect(
      dispatchSubkind({
        type: "PullRequestReviewEvent",
        payload: { action: "dismissed", review: { state: "approved" } },
      }),
    ).toBe("unknown");
  });
});

describe("dispatchSubkind — push events", () => {
  it("PushEvent → commit-pushed", () => {
    expect(
      dispatchSubkind({
        type: "PushEvent",
        payload: { ref: "refs/heads/main", commits: [] },
      }),
    ).toBe("commit-pushed");
  });
});

describe("dispatchSubkind — unknown-fallback graceful degrade", () => {
  it("unrecognized event type → unknown", () => {
    expect(dispatchSubkind({ type: "GollumEvent", payload: {} })).toBe("unknown");
  });

  it("missing type → unknown", () => {
    expect(dispatchSubkind({ payload: {} })).toBe("unknown");
  });

  it("non-object input → unknown", () => {
    expect(dispatchSubkind(null)).toBe("unknown");
    expect(dispatchSubkind(undefined)).toBe("unknown");
    expect(dispatchSubkind("not an event")).toBe("unknown");
    expect(dispatchSubkind(42)).toBe("unknown");
    expect(dispatchSubkind([])).toBe("unknown");
  });

  it("never throws on malformed input", () => {
    expect(() => dispatchSubkind({ type: "PullRequestEvent" })).not.toThrow();
    expect(() => dispatchSubkind({ type: "PullRequestReviewEvent", payload: null })).not.toThrow();
    expect(() => dispatchSubkind({ type: "PushEvent", payload: { ref: 1234 } })).not.toThrow();
  });
});

describe("normalizeGhEvent — pr-opened payload", () => {
  it("extracts number, title, url, author, base/head refs", () => {
    const ghEvent = {
      type: "PullRequestEvent",
      repo: { name: "owner/repo" },
      payload: {
        action: "opened",
        pull_request: {
          number: 42,
          title: "Add widget",
          html_url: "https://github.com/owner/repo/pull/42",
          user: { login: "alice" },
          merged: false,
          base: { ref: "main", sha: "aaa" },
          head: { ref: "feature/widget", sha: "bbb" },
        },
      },
    };
    const out = normalizeGhEvent(ghEvent, "pr-opened");
    expect(out.repo).toBe("owner/repo");
    expect(out.number).toBe(42);
    expect(out.title).toBe("Add widget");
    expect(out.url).toBe("https://github.com/owner/repo/pull/42");
    expect(out.author).toBe("alice");
    expect(out.merged).toBe(false);
    expect(out.base).toEqual({ ref: "main", sha: "aaa" });
    expect(out.head).toEqual({ ref: "feature/widget", sha: "bbb" });
  });
});

describe("normalizeGhEvent — pr-merged payload", () => {
  it("flags merged=true", () => {
    const ghEvent = {
      type: "PullRequestEvent",
      repo: { name: "owner/repo" },
      payload: {
        action: "closed",
        pull_request: { number: 9, merged: true, user: { login: "bob" } },
      },
    };
    const out = normalizeGhEvent(ghEvent, "pr-merged");
    expect(out.merged).toBe(true);
    expect(out.number).toBe(9);
    expect(out.author).toBe("bob");
  });
});

describe("normalizeGhEvent — PR review request payload", () => {
  it("normalizes user reviewer request fields", () => {
    const ghEvent = {
      type: "PullRequestEvent",
      repo: { name: "owner/repo" },
      payload: {
        action: "review_requested",
        pull_request: {
          number: 12,
          title: "Add review request event",
          html_url: "https://github.com/owner/repo/pull/12",
          user: { login: "apnex-greg" },
          base: { ref: "main", sha: "aaa" },
          head: { ref: "feature/review-request", sha: "bbb" },
        },
        requested_reviewer: { login: "apnex-lily" },
      },
    };
    const out = normalizeGhEvent(ghEvent, "pr-review-requested");
    expect(out.repo).toBe("owner/repo");
    expect(out.action).toBe("review_requested");
    expect(out.number).toBe(12);
    expect(out.title).toBe("Add review request event");
    expect(out.url).toBe("https://github.com/owner/repo/pull/12");
    expect(out.author).toBe("apnex-greg");
    expect(out.requestedReviewerLogin).toBe("apnex-lily");
    expect(out.requestedTeamSlug).toBeUndefined();
    expect(out.base).toEqual({ ref: "main", sha: "aaa" });
    expect(out.head).toEqual({ ref: "feature/review-request", sha: "bbb" });
  });

  it("normalizes team reviewer request fields", () => {
    const ghEvent = {
      type: "PullRequestEvent",
      repo: { name: "owner/repo" },
      payload: {
        action: "review_requested",
        pull_request: {
          number: 13,
          title: "Team request",
          html_url: "https://github.com/owner/repo/pull/13",
          user: { login: "apnex-greg" },
        },
        requested_team: { slug: "platform-reviewers", name: "Platform Reviewers" },
      },
    };
    const out = normalizeGhEvent(ghEvent, "pr-review-requested");
    expect(out.number).toBe(13);
    expect(out.requestedReviewerLogin).toBeUndefined();
    expect(out.requestedTeamSlug).toBe("platform-reviewers");
    expect(out.requestedTeamName).toBe("Platform Reviewers");
  });

  it("normalizes removal events with the same requested-user metadata", () => {
    const ghEvent = {
      type: "PullRequestEvent",
      actor: { login: "apnex-greg" },
      repo: { name: "owner/repo" },
      payload: {
        action: "review_request_removed",
        pull_request: {
          number: 14,
          title: null,
          html_url: null,
          url: "https://api.github.com/repos/owner/repo/pulls/14",
          user: null,
        },
        requested_reviewer: { login: "apnex-lily" },
      },
    };
    const out = normalizeGhEvent(ghEvent, "pr-review-request-removed");
    expect(out.action).toBe("review_request_removed");
    expect(out.number).toBe(14);
    expect(out.title).toBe("");
    expect(out.url).toBe("https://github.com/owner/repo/pull/14");
    expect(out.author).toBe("apnex-greg");
    expect(out.requestedReviewerLogin).toBe("apnex-lily");
  });
});

describe("normalizeGhEvent — Events-API shape (bug-49 fix)", () => {
  // bug-49: GH Events API consistently null on pr.user / review.user /
  // comment.user; webhook delivery populates them. normalize-* functions
  // fall back to event-level actor when nested user is null. Same pattern
  // as bug-44's PushEvent pusher-vs-actor fallback chain. 3rd canonical
  // instance of webhook-vs-Events-API-shape-mismatch (idea-249 driver).

  it("pr-opened: pr.user null → falls back to event-level actor", () => {
    const ghEvent = {
      type: "PullRequestEvent",
      actor: { login: "apnex-greg", id: 12345 },
      repo: { name: "owner/repo" },
      payload: {
        action: "opened",
        pull_request: {
          number: 42,
          title: "Add widget",
          html_url: "https://github.com/owner/repo/pull/42",
          user: null, // ← Events API shape: nested user is null
          merged: false,
          base: { ref: "main", sha: "aaa" },
          head: { ref: "feature/widget", sha: "bbb" },
        },
      },
    };
    const out = normalizeGhEvent(ghEvent, "pr-opened");
    expect(out.author).toBe("apnex-greg"); // ← falls back to actor.login
    expect(out.number).toBe(42);
  });

  it("pr-merged: pr.user null → falls back to event-level actor", () => {
    const ghEvent = {
      type: "PullRequestEvent",
      actor: { login: "apnex-lily" },
      repo: { name: "owner/repo" },
      payload: {
        action: "merged",
        pull_request: { number: 9, merged: true, user: null },
      },
    };
    const out = normalizeGhEvent(ghEvent, "pr-merged");
    expect(out.author).toBe("apnex-lily");
    expect(out.merged).toBe(true);
  });

  it("pr-review-approved: review.user null → falls back to event-level actor", () => {
    const ghEvent = {
      type: "PullRequestReviewEvent",
      actor: { login: "apnex-lily" },
      repo: { name: "owner/repo" },
      payload: {
        action: "created",
        pull_request: { number: 7 },
        review: {
          state: "approved",
          user: null, // ← Events API shape: nested user is null
          body: "LGTM",
          html_url: "https://github.com/owner/repo/pull/7#review-1",
        },
      },
    };
    const out = normalizeGhEvent(ghEvent, "pr-review-approved");
    expect(out.reviewer).toBe("apnex-lily");
    expect(out.state).toBe("approved");
  });

  it("pr-review-comment: comment.user null → falls back to event-level actor", () => {
    const ghEvent = {
      type: "PullRequestReviewCommentEvent",
      actor: { login: "apnex-greg" },
      repo: { name: "owner/repo" },
      payload: {
        action: "created",
        pull_request: { number: 11 },
        comment: {
          user: null, // ← Events API shape: nested user is null
          body: "nit: rename",
          html_url: "https://github.com/owner/repo/pull/11#discussion_r1",
        },
      },
    };
    const out = normalizeGhEvent(ghEvent, "pr-review-comment");
    expect(out.commenter).toBe("apnex-greg");
  });

  it("pr-opened: webhook shape with pr.user populated → uses pr.user (preserves existing behavior)", () => {
    const ghEvent = {
      type: "PullRequestEvent",
      actor: { login: "apnex-lily" }, // ← would be fallback
      payload: {
        action: "opened",
        pull_request: {
          number: 42,
          user: { login: "alice" }, // ← but pr.user takes precedence
        },
      },
    };
    const out = normalizeGhEvent(ghEvent, "pr-opened");
    expect(out.author).toBe("alice"); // ← webhook shape; pr.user wins
  });

  it("pr-opened: both pr.user null AND actor missing → author null", () => {
    const ghEvent = {
      type: "PullRequestEvent",
      // no actor field
      payload: {
        action: "opened",
        pull_request: { number: 42, user: null },
      },
    };
    const out = normalizeGhEvent(ghEvent, "pr-opened");
    expect(out.author).toBeUndefined();
  });
});

describe("normalizeGhEvent — pr-review-approved payload", () => {
  it("extracts reviewer, state, prNumber", () => {
    const ghEvent = {
      type: "PullRequestReviewEvent",
      repo: { name: "owner/repo" },
      payload: {
        action: "submitted",
        review: {
          user: { login: "carol" },
          state: "approved",
          body: "lgtm",
          html_url: "https://github.com/owner/repo/pull/3#review-1",
        },
        pull_request: { number: 3 },
      },
    };
    const out = normalizeGhEvent(ghEvent, "pr-review-approved");
    expect(out.reviewer).toBe("carol");
    expect(out.state).toBe("approved");
    expect(out.prNumber).toBe(3);
    expect(out.body).toBe("lgtm");
  });
});

describe("normalizeGhEvent — commit-pushed payload", () => {
  it("extracts ref, pusher, commits (webhook shape — payload.pusher.login)", () => {
    const ghEvent = {
      type: "PushEvent",
      repo: { name: "owner/repo" },
      payload: {
        ref: "refs/heads/main",
        pusher: { login: "dave" },
        commits: [
          { sha: "111", message: "fix", author: { name: "dave" } },
          { sha: "222", message: "test", author: { name: "dave" } },
        ],
      },
    };
    const out = normalizeGhEvent(ghEvent, "commit-pushed");
    expect(out.ref).toBe("refs/heads/main");
    expect(out.pusher).toBe("dave");
    expect(out.commitCount).toBe(2);
    expect(Array.isArray(out.commits)).toBe(true);
  });

  // bug-44: GH Events API places the user at ghEvent.actor.login (event-level)
  // and does NOT populate payload.pusher / payload.sender. Translator must fall
  // back to actor extraction so the bridge's polled events route correctly to
  // the COMMIT_PUSHED_HANDLER.
  it("extracts pusher from ghEvent.actor.login when payload.pusher absent (Events API shape)", () => {
    const ghEvent = {
      type: "PushEvent",
      actor: { id: 12345, login: "apnex-greg", display_login: "apnex-greg" },
      repo: { name: "owner/repo" },
      payload: {
        push_id: 999,
        size: 1,
        distinct_size: 1,
        ref: "refs/heads/feature-branch",
        head: "abc123",
        before: "def456",
        commits: [{ sha: "abc123", message: "trivial fix", author: { name: "apnex-greg" } }],
      },
    };
    const out = normalizeGhEvent(ghEvent, "commit-pushed");
    expect(out.ref).toBe("refs/heads/feature-branch");
    expect(out.pusher).toBe("apnex-greg");
    expect(out.commitCount).toBe(1);
  });

  it("returns undefined pusher when neither payload.pusher nor ghEvent.actor present", () => {
    const ghEvent = {
      type: "PushEvent",
      repo: { name: "owner/repo" },
      payload: { ref: "refs/heads/orphan", commits: [] },
    };
    const out = normalizeGhEvent(ghEvent, "commit-pushed");
    expect(out.pusher).toBeUndefined();
  });
});

describe("normalizeGhEvent — unknown payload preserves raw", () => {
  it("preserves the original input verbatim", () => {
    const ghEvent = { type: "GollumEvent", payload: { pages: [] } };
    const out = normalizeGhEvent(ghEvent, "unknown");
    expect(out.raw).toEqual(ghEvent);
  });

  it("preserves non-object input", () => {
    const out = normalizeGhEvent("garbage", "unknown");
    expect(out.raw).toBe("garbage");
  });
});

describe("normalizeGhEvent — webhook delivery shape (repository.full_name)", () => {
  it("extracts repo from payload.repository.full_name when top-level repo absent", () => {
    const ghEvent = {
      type: "PullRequestEvent",
      payload: {
        action: "opened",
        pull_request: { number: 1 },
        repository: { full_name: "owner/repo" },
      },
    };
    const out = normalizeGhEvent(ghEvent, "pr-opened");
    expect(out.repo).toBe("owner/repo");
  });
});
