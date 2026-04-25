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
  it("extracts ref, pusher, commits", () => {
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
