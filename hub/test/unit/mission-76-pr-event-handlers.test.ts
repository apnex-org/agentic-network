/**
 * mission-76 W1 — PR-event handler tests (bug-46 closure) + bug-50 fix.
 *
 * Pins per Design v1.0 §6.1 + bug-50 test-discipline fold:
 *   - Helper: synthesizePrNotification — extract → resolve-role → emit
 *     across the 3 PR-event handlers via opts (subkind + intentValue +
 *     extractPayload + extractAuthorLogin + bodyTemplate +
 *     buildPayloadFields)
 *   - Per-handler: thin wrapper invokes helper with subkind-specific opts
 *   - §3.1 m2 fold director-skip + null-skip enumeration verified
 *   - §3.4 symmetric routing — engineer-author → architect peer; architect-
 *     author → engineer peer
 *   - §3.5 m1 fold per-subkind intents (pr-opened-notification /
 *     pr-merged-notification / pr-review-notification)
 *   - mission-76 γ fold — null-lookup-skip is EXPECTED behavior
 *     (console.info not console.warn) per bug-47 scenario-B reframing
 *   - bug-50 fold: per-subkind handler tests feed handlers via
 *     `translateGhEvent()` to eliminate mock/prod shape divergence at
 *     structural level. BOTH Events-API + webhook fixtures verified per
 *     subkind so the bug-49/bug-50 axis is covered in unit tests, not just
 *     E2E. Composes-with idea-249 methodology fold meta-cause.
 */

import { describe, expect, it } from "vitest";
import { translateGhEvent } from "@apnex/repo-event-bridge";
import type { Message } from "../../src/entities/index.js";
import type { IPolicyContext } from "../../src/policy/types.js";
import type { Agent, AgentRole } from "../../src/state.js";
import { GITHUB_LOGIN_LABEL } from "../../src/policy/repo-event-author-lookup.js";
import {
  synthesizePrNotification,
  type PrNotificationOpts,
} from "../../src/policy/repo-event-pr-handler-helpers.js";
import { PR_OPENED_HANDLER } from "../../src/policy/repo-event-pr-opened-handler.js";
import { PR_MERGED_HANDLER } from "../../src/policy/repo-event-pr-merged-handler.js";
import { PR_REVIEW_SUBMITTED_HANDLER } from "../../src/policy/repo-event-pr-review-submitted-handler.js";
import { PR_REVIEW_APPROVED_HANDLER } from "../../src/policy/repo-event-pr-review-approved-handler.js";
import { findRepoEventHandler } from "../../src/policy/repo-event-handlers.js";

// ── Helper: minimal IPolicyContext + agent fixtures ──────────────────

function makeAgent(id: string, role: AgentRole, ghLogin?: string): Agent {
  return {
    id,
    fingerprint: `fp-${id}`,
    role,
    status: "online",
    archived: false,
    sessionEpoch: 1,
    currentSessionId: null,
    clientMetadata: {
      clientName: "test",
      clientVersion: "0.0.0",
      proxyName: "test",
      proxyVersion: "0.0.0",
    },
    advisoryTags: {},
    labels: ghLogin ? { [GITHUB_LOGIN_LABEL]: ghLogin } : {},
    firstSeenAt: "2026-05-01T00:00:00Z",
    lastSeenAt: "2026-05-01T00:00:00Z",
    livenessState: "online",
    lastHeartbeatAt: "2026-05-01T00:00:00Z",
    receiptSla: 60_000,
    wakeEndpoint: null,
    name: id,
    activityState: "online_idle",
    sessionStartedAt: null,
    lastToolCallAt: null,
    lastToolCallName: null,
    idleSince: null,
    workingSince: null,
    quotaBlockedUntil: null,
    adapterVersion: "test@0.0.0",
    ipAddress: null,
    restartCount: 0,
    recentErrors: [],
    restartHistoryMs: [],
    cognitiveTTL: null,
    transportTTL: null,
    cognitiveState: "unknown",
    transportState: "unknown",
  };
}

function makeCtx(agents: Agent[]): IPolicyContext {
  return {
    stores: {
      engineerRegistry: {
        listAgents: async () => agents,
      },
    },
    metrics: { increment: () => {} },
    emit: async () => {},
    dispatch: async () => {},
    sessionId: "test",
    clientIp: "127.0.0.1",
    role: "system",
    internalEvents: [],
  } as unknown as IPolicyContext;
}

function makeRepoEventMessage(payload: unknown): Message {
  return {
    id: "01TESTMISSION76",
    kind: "external-injection",
    authorRole: "architect",
    authorAgentId: "anonymous-architect",
    target: null,
    delivery: "push-immediate",
    payload,
    status: "new",
    createdAt: "2026-05-01T00:00:00Z",
  } as unknown as Message;
}

// ── synthesizePrNotification helper tests (Design §6.1 P1 fold) ──────

describe("synthesizePrNotification helper (mission-76 W1 P1 DRY concur)", () => {
  // Minimal fixture opts for helper isolation tests
  interface FixturePayload {
    author: string;
    n: number;
  }
  const FIXTURE_OPTS: PrNotificationOpts<FixturePayload> = {
    subkind: "pr-opened",
    intentValue: "fixture-intent",
    extractPayload: (raw) => {
      if (typeof raw.author !== "string" || typeof raw.n !== "number") return null;
      return { author: raw.author, n: raw.n };
    },
    extractAuthorLogin: (p) => p.author || null,
    bodyTemplate: (role, p) => `${role} did thing #${p.n}`,
    buildPayloadFields: (p) => ({ n: p.n, author: p.author }),
  };

  it("emits 1 dispatch for engineer-author (target.role=architect; symmetric routing)", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const msg = makeRepoEventMessage({
      kind: "repo-event",
      subkind: "pr-opened",
      payload: { author: "apnex-greg", n: 42 },
    });
    const dispatches = await synthesizePrNotification(msg, ctx, FIXTURE_OPTS);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].target).toEqual({ role: "architect" });
    expect(dispatches[0].intent).toBe("fixture-intent");
    const payload = dispatches[0].payload as Record<string, unknown>;
    expect(payload.body).toBe("engineer did thing #42");
    expect(payload.n).toBe(42);
    expect(payload.author).toBe("apnex-greg");
    expect(payload.sourceMessageId).toBe("01TESTMISSION76");
  });

  it("emits 1 dispatch for architect-author (target.role=engineer; symmetric routing per §3.4)", async () => {
    const ctx = makeCtx([makeAgent("arch-A", "architect", "apnex-lily")]);
    const msg = makeRepoEventMessage({
      kind: "repo-event",
      subkind: "pr-opened",
      payload: { author: "apnex-lily", n: 7 },
    });
    const dispatches = await synthesizePrNotification(msg, ctx, FIXTURE_OPTS);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].target).toEqual({ role: "engineer" });
    const payload = dispatches[0].payload as Record<string, unknown>;
    expect(payload.body).toBe("architect did thing #7");
  });

  it("emits 0 dispatches for null-lookup (mission-76 γ — EXPECTED behavior)", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const msg = makeRepoEventMessage({
      kind: "repo-event",
      subkind: "pr-opened",
      payload: { author: "apnex", n: 1 }, // unregistered (Director's personal account per bug-47 scenario-B)
    });
    const dispatches = await synthesizePrNotification(msg, ctx, FIXTURE_OPTS);
    expect(dispatches).toHaveLength(0);
  });

  it("emits 0 dispatches for director-author (§3.1 m2 fold — no peer-role)", async () => {
    const ctx = makeCtx([
      makeAgent("eng-A", "engineer", "apnex-greg"),
      makeAgent("dir-A", "director", "director-bot"),
    ]);
    const msg = makeRepoEventMessage({
      kind: "repo-event",
      subkind: "pr-opened",
      payload: { author: "director-bot", n: 99 },
    });
    const dispatches = await synthesizePrNotification(msg, ctx, FIXTURE_OPTS);
    expect(dispatches).toHaveLength(0);
  });

  it("emits 0 dispatches for malformed payload.payload (defensive skip)", async () => {
    const ctx = makeCtx([]);
    const msg = makeRepoEventMessage({
      kind: "repo-event",
      subkind: "pr-opened",
      // payload nested missing
    });
    const dispatches = await synthesizePrNotification(msg, ctx, FIXTURE_OPTS);
    expect(dispatches).toHaveLength(0);
  });

  it("emits 0 dispatches when extractPayload returns null (malformed shape)", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const msg = makeRepoEventMessage({
      kind: "repo-event",
      subkind: "pr-opened",
      payload: { author: "apnex-greg" }, // missing `n`
    });
    const dispatches = await synthesizePrNotification(msg, ctx, FIXTURE_OPTS);
    expect(dispatches).toHaveLength(0);
  });

  it("emits 0 dispatches when extractAuthorLogin returns null (missing author)", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const msg = makeRepoEventMessage({
      kind: "repo-event",
      subkind: "pr-opened",
      payload: { author: "", n: 3 },
    });
    const dispatches = await synthesizePrNotification(msg, ctx, FIXTURE_OPTS);
    expect(dispatches).toHaveLength(0);
  });
});

// ── translator-truth fixture builders (bug-50 fold) ───────────────────
//
// All per-handler tests below feed handlers via `translateGhEvent()` —
// eliminates mock/prod shape divergence at structural level. Webhook +
// Events-API fixtures cover both shapes per subkind.

/**
 * Webhook-delivery shape (legacy/replay path; X-GitHub-Event header value
 * surfaced as `type`). pr.user populated; pr.html_url populated; pr.title
 * populated. base + head as full ref objects.
 */
function makePullRequestEventWebhookShape(opts: {
  action: string;
  authorLogin: string;
  prNumber: number;
  prTitle: string;
  prHtmlUrl: string;
  baseRef: string;
  headRef: string;
  merged?: boolean;
}): unknown {
  return {
    type: "PullRequestEvent",
    actor: { login: opts.authorLogin },
    repo: { name: "apnex-org/agentic-network" },
    payload: {
      action: opts.action,
      pull_request: {
        number: opts.prNumber,
        title: opts.prTitle,
        html_url: opts.prHtmlUrl,
        url: `https://api.github.com/repos/apnex-org/agentic-network/pulls/${opts.prNumber}`,
        user: { login: opts.authorLogin },
        merged: opts.merged === true,
        base: { ref: opts.baseRef, sha: "0000000000000000000000000000000000000000" },
        head: { ref: opts.headRef, sha: "1111111111111111111111111111111111111111" },
      },
    },
  };
}

/**
 * Events-API delivery shape (live GH polling path; bug-50 surface). pr.user
 * is null; pr.html_url is null; pr.title is null. Author falls back to
 * event-level actor.login (bug-49 fix); html_url derives from pr.url
 * (bug-50 Class B fix).
 */
function makePullRequestEventEventsApiShape(opts: {
  action: string;
  actorLogin: string;
  prNumber: number;
  baseRef: string;
  headRef: string;
  merged?: boolean;
}): unknown {
  return {
    type: "PullRequestEvent",
    actor: { login: opts.actorLogin },
    repo: { name: "apnex-org/agentic-network" },
    payload: {
      action: opts.action,
      pull_request: {
        number: opts.prNumber,
        title: null,
        html_url: null,
        url: `https://api.github.com/repos/apnex-org/agentic-network/pulls/${opts.prNumber}`,
        user: null,
        merged: opts.merged === true,
        base: { ref: opts.baseRef, sha: "0000000000000000000000000000000000000000" },
        head: { ref: opts.headRef, sha: "1111111111111111111111111111111111111111" },
      },
    },
  };
}

function makePullRequestReviewEventWebhookShape(opts: {
  action: string;
  reviewerLogin: string;
  prNumber: number;
  state: string;
  body: string;
}): unknown {
  return {
    type: "PullRequestReviewEvent",
    actor: { login: opts.reviewerLogin },
    repo: { name: "apnex-org/agentic-network" },
    payload: {
      action: opts.action,
      review: {
        state: opts.state,
        body: opts.body,
        html_url: `https://github.com/apnex-org/agentic-network/pull/${opts.prNumber}#pullrequestreview-1`,
        user: { login: opts.reviewerLogin },
      },
      pull_request: { number: opts.prNumber },
    },
  };
}

function makePullRequestReviewEventEventsApiShape(opts: {
  action: string;
  actorLogin: string;
  prNumber: number;
  state: string;
  body: string;
}): unknown {
  return {
    type: "PullRequestReviewEvent",
    actor: { login: opts.actorLogin },
    repo: { name: "apnex-org/agentic-network" },
    payload: {
      action: opts.action,
      review: {
        state: opts.state,
        body: opts.body,
        html_url: null,
        user: null,
      },
      pull_request: { number: opts.prNumber },
    },
  };
}

/** Wrap a translated RepoEvent in the inbound-Message envelope handlers
 *  expect (kind: "external-injection"; payload = the RepoEvent). */
function wrapAsInboundMessage(repoEvent: unknown): Message {
  return makeRepoEventMessage(repoEvent);
}

// ── PR_OPENED_HANDLER tests (Design §6.1 + bug-50 fold) ───────────────

describe("PR_OPENED_HANDLER (mission-76 W1 §3.1)", () => {
  it("webhook-shape: engineer-opens-PR → architect notification with full payload", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const repoEvent = translateGhEvent(
      makePullRequestEventWebhookShape({
        action: "opened",
        authorLogin: "apnex-greg",
        prNumber: 167,
        prTitle: "[mission-75] M-TTL-Liveliness-Design",
        prHtmlUrl: "https://github.com/apnex-org/agentic-network/pull/167",
        baseRef: "main",
        headRef: "agent-greg/m-ttl-liveliness-design",
      }),
    );
    const dispatches = await PR_OPENED_HANDLER.handle(wrapAsInboundMessage(repoEvent), ctx);
    expect(dispatches).toHaveLength(1);
    const d = dispatches[0];
    expect(d.kind).toBe("note");
    expect(d.target).toEqual({ role: "architect" });
    expect(d.intent).toBe("pr-opened-notification");
    const payload = d.payload as Record<string, unknown>;
    expect(payload.body).toBe("Engineer opened PR #167: [mission-75] M-TTL-Liveliness-Design");
    expect(payload.prNumber).toBe(167);
    expect(payload.prTitle).toBe("[mission-75] M-TTL-Liveliness-Design");
    expect(payload.prAuthor).toBe("apnex-greg");
    expect(payload.prUrl).toBe("https://github.com/apnex-org/agentic-network/pull/167");
    expect(payload.prBaseRef).toBe("main");
    expect(payload.prHeadRef).toBe("agent-greg/m-ttl-liveliness-design");
    expect(payload.sourceMessageId).toBe("01TESTMISSION76");
  });

  it("webhook-shape: architect-opens-PR → engineer notification (symmetric routing per §3.4)", async () => {
    const ctx = makeCtx([makeAgent("arch-A", "architect", "apnex-lily")]);
    const repoEvent = translateGhEvent(
      makePullRequestEventWebhookShape({
        action: "opened",
        authorLogin: "apnex-lily",
        prNumber: 167,
        prTitle: "[mission-75] M-TTL-Liveliness-Design",
        prHtmlUrl: "https://github.com/apnex-org/agentic-network/pull/167",
        baseRef: "main",
        headRef: "agent-lily/m-ttl-liveliness-design",
      }),
    );
    const dispatches = await PR_OPENED_HANDLER.handle(wrapAsInboundMessage(repoEvent), ctx);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].target).toEqual({ role: "engineer" });
    expect((dispatches[0].payload as Record<string, unknown>).body).toBe(
      "Architect opened PR #167: [mission-75] M-TTL-Liveliness-Design",
    );
  });

  it("Events-API-shape: architect-opens-PR → engineer notification (bug-49 author fallback + bug-50 url derivation + colon-dropped body)", async () => {
    const ctx = makeCtx([makeAgent("arch-A", "architect", "apnex-lily")]);
    const repoEvent = translateGhEvent(
      makePullRequestEventEventsApiShape({
        action: "opened",
        actorLogin: "apnex-lily",
        prNumber: 175,
        baseRef: "main",
        headRef: "agent-lily/m-something",
      }),
    );
    const dispatches = await PR_OPENED_HANDLER.handle(wrapAsInboundMessage(repoEvent), ctx);
    expect(dispatches).toHaveLength(1);
    const payload = dispatches[0].payload as Record<string, unknown>;
    // bug-50 Class B: title null → "" → trailing colon dropped from body
    expect(payload.body).toBe("Architect opened PR #175");
    expect(payload.prTitle).toBe("");
    // bug-49: author falls back from event-level actor.login when pr.user=null
    expect(payload.prAuthor).toBe("apnex-lily");
    // bug-50 Class B: html_url null → derive from pr.url (deterministic regex)
    expect(payload.prUrl).toBe("https://github.com/apnex-org/agentic-network/pull/175");
    // bug-50 Class A: base/head emitted as objects by translator; handler reads .ref
    expect(payload.prBaseRef).toBe("main");
    expect(payload.prHeadRef).toBe("agent-lily/m-something");
  });

  it("Events-API-shape: engineer-opens-PR → architect notification (symmetric)", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const repoEvent = translateGhEvent(
      makePullRequestEventEventsApiShape({
        action: "opened",
        actorLogin: "apnex-greg",
        prNumber: 200,
        baseRef: "main",
        headRef: "agent-greg/feature",
      }),
    );
    const dispatches = await PR_OPENED_HANDLER.handle(wrapAsInboundMessage(repoEvent), ctx);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].target).toEqual({ role: "architect" });
    expect((dispatches[0].payload as Record<string, unknown>).body).toBe(
      "Engineer opened PR #200",
    );
  });

  it("unknown-author → skip (lookup returns null; mission-76 γ)", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const repoEvent = translateGhEvent(
      makePullRequestEventWebhookShape({
        action: "opened",
        authorLogin: "apnex",
        prNumber: 167,
        prTitle: "test",
        prHtmlUrl: "https://github.com/x/y/pull/167",
        baseRef: "main",
        headRef: "feat/x",
      }),
    );
    const dispatches = await PR_OPENED_HANDLER.handle(wrapAsInboundMessage(repoEvent), ctx);
    expect(dispatches).toHaveLength(0);
  });

  it("director-author → skip (§3.1 m2 fold)", async () => {
    const ctx = makeCtx([makeAgent("dir-A", "director", "apnex-director")]);
    const repoEvent = translateGhEvent(
      makePullRequestEventWebhookShape({
        action: "opened",
        authorLogin: "apnex-director",
        prNumber: 167,
        prTitle: "test",
        prHtmlUrl: "https://github.com/x/y/pull/167",
        baseRef: "main",
        headRef: "feat/x",
      }),
    );
    const dispatches = await PR_OPENED_HANDLER.handle(wrapAsInboundMessage(repoEvent), ctx);
    expect(dispatches).toHaveLength(0);
  });

  it("missing payload.payload → skip (defensive)", async () => {
    const ctx = makeCtx([]);
    const msg = makeRepoEventMessage({ kind: "repo-event", subkind: "pr-opened" });
    const dispatches = await PR_OPENED_HANDLER.handle(msg, ctx);
    expect(dispatches).toHaveLength(0);
  });

  it("malformed base (empty object) → handler emits empty ref/sha strings (defensive coerce contract; bug-50 Class A)", async () => {
    // Hand-craft an inbound RepoEvent with malformed base: {} to pin the
    // extractRefField defensive-coerce contract — translator could in
    // principle emit {ref: undefined, sha: undefined} for malformed
    // upstream pr.base; handler must coerce to "" not "undefined".
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const malformedRepoEvent = {
      kind: "repo-event",
      subkind: "pr-opened",
      payload: {
        repo: "apnex-org/agentic-network",
        action: "opened",
        number: 999,
        title: "test",
        url: "https://github.com/apnex-org/agentic-network/pull/999",
        author: "apnex-greg",
        merged: false,
        base: {}, // malformed: no ref or sha
        head: {}, // malformed: no ref or sha
      },
    };
    const dispatches = await PR_OPENED_HANDLER.handle(
      wrapAsInboundMessage(malformedRepoEvent),
      ctx,
    );
    expect(dispatches).toHaveLength(1);
    const payload = dispatches[0].payload as Record<string, unknown>;
    expect(payload.prBaseRef).toBe(""); // NOT "undefined"
    expect(payload.prHeadRef).toBe(""); // NOT "undefined"
  });
});

// ── PR_MERGED_HANDLER tests (Design §6.1) ─────────────────────────────

describe("PR_MERGED_HANDLER (mission-76 W1 §3.1)", () => {
  it("webhook-shape: engineer-merges-PR → architect notification", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const repoEvent = translateGhEvent(
      makePullRequestEventWebhookShape({
        action: "closed",
        authorLogin: "apnex-greg",
        prNumber: 168,
        prTitle: "[mission-75] Phase 9 closing audit + Phase 10 retrospective",
        prHtmlUrl: "https://github.com/apnex-org/agentic-network/pull/168",
        baseRef: "main",
        headRef: "agent-greg/m-ttl-liveliness-design-phase9-10",
        merged: true,
      }),
    );
    const dispatches = await PR_MERGED_HANDLER.handle(wrapAsInboundMessage(repoEvent), ctx);
    expect(dispatches).toHaveLength(2);

    const peer = dispatches.find((d) => d.intent === "pr-merged-notification");
    expect(peer?.target).toEqual({ role: "architect" });
    const payload = peer?.payload as Record<string, unknown>;
    expect(payload.body).toBe(
      "Engineer merged PR #168: [mission-75] Phase 9 closing audit + Phase 10 retrospective",
    );
    expect(payload.prNumber).toBe(168);
    expect(payload.prBaseRef).toBe("main");

    const direct = dispatches.find((d) => d.intent === "pr-merged-author-notification");
    expect(direct).toMatchObject({
      target: { agentId: "eng-A" },
      payload: {
        body: "Engineer merged PR #168: [mission-75] Phase 9 closing audit + Phase 10 retrospective",
        routingReason: "pr-author-direct",
        authorAgentId: "eng-A",
      },
    });
  });

  it("webhook-shape: architect-merges-PR → engineer notification (symmetric per §3.4)", async () => {
    const ctx = makeCtx([makeAgent("arch-A", "architect", "apnex-lily")]);
    const repoEvent = translateGhEvent(
      makePullRequestEventWebhookShape({
        action: "closed",
        authorLogin: "apnex-lily",
        prNumber: 168,
        prTitle: "[mission-75] Phase 9 closing audit + Phase 10 retrospective",
        prHtmlUrl: "https://github.com/apnex-org/agentic-network/pull/168",
        baseRef: "main",
        headRef: "agent-lily/m-ttl-liveliness-design-phase9-10",
        merged: true,
      }),
    );
    const dispatches = await PR_MERGED_HANDLER.handle(wrapAsInboundMessage(repoEvent), ctx);
    expect(dispatches).toHaveLength(2);

    const peer = dispatches.find((d) => d.intent === "pr-merged-notification");
    expect(peer?.target).toEqual({ role: "engineer" });
    expect((peer?.payload as Record<string, unknown>).body).toBe(
      "Architect merged PR #168: [mission-75] Phase 9 closing audit + Phase 10 retrospective",
    );

    const direct = dispatches.find((d) => d.intent === "pr-merged-author-notification");
    expect(direct).toMatchObject({
      target: { agentId: "arch-A" },
      payload: {
        body: "Architect merged PR #168: [mission-75] Phase 9 closing audit + Phase 10 retrospective",
        routingReason: "pr-author-direct",
        authorAgentId: "arch-A",
      },
    });
  });

  it("Events-API-shape: action='merged' → engineer-merges PR (bug-50 Class A + B coverage)", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    // GH Events API uses action="merged" directly (no nested .merged
    // discriminator); webhook uses action="closed" + merged=true (covered above).
    const repoEvent = translateGhEvent(
      makePullRequestEventEventsApiShape({
        action: "merged",
        actorLogin: "apnex-greg",
        prNumber: 168,
        baseRef: "main",
        headRef: "agent-greg/feature",
        merged: true,
      }),
    );
    const dispatches = await PR_MERGED_HANDLER.handle(wrapAsInboundMessage(repoEvent), ctx);
    expect(dispatches).toHaveLength(2);
    const peer = dispatches.find((d) => d.intent === "pr-merged-notification");
    const payload = peer?.payload as Record<string, unknown>;
    expect(payload.body).toBe("Engineer merged PR #168"); // colon dropped (title null)
    expect(payload.prAuthor).toBe("apnex-greg"); // bug-49 actor fallback
    expect(payload.prUrl).toBe("https://github.com/apnex-org/agentic-network/pull/168"); // bug-50 derived
    expect(payload.prBaseRef).toBe("main"); // bug-50 Class A
    expect(payload.prHeadRef).toBe("agent-greg/feature");

    const direct = dispatches.find((d) => d.intent === "pr-merged-author-notification");
    expect(direct).toMatchObject({
      target: { agentId: "eng-A" },
      payload: {
        body: "Engineer merged PR #168",
        routingReason: "pr-author-direct",
        authorAgentId: "eng-A",
      },
    });
  });

  it("duplicate GitHub-login skips direct author route while preserving legacy peer notification", async () => {
    const ctx = makeCtx([
      makeAgent("eng-A", "engineer", "apnex-shared"),
      makeAgent("eng-B", "engineer", "apnex-shared"),
    ]);
    const repoEvent = translateGhEvent(
      makePullRequestEventWebhookShape({
        action: "closed",
        authorLogin: "apnex-shared",
        prNumber: 168,
        prTitle: "test",
        prHtmlUrl: "https://github.com/x/y/pull/168",
        baseRef: "main",
        headRef: "feat/x",
        merged: true,
      }),
    );
    const dispatches = await PR_MERGED_HANDLER.handle(wrapAsInboundMessage(repoEvent), ctx);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({
      intent: "pr-merged-notification",
      target: { role: "architect" },
    });
    expect(dispatches.some((d) => d.intent === "pr-merged-author-notification")).toBe(false);
  });

  it("unknown-author → skip", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const repoEvent = translateGhEvent(
      makePullRequestEventWebhookShape({
        action: "closed",
        authorLogin: "apnex",
        prNumber: 168,
        prTitle: "test",
        prHtmlUrl: "https://github.com/x/y/pull/168",
        baseRef: "main",
        headRef: "feat/x",
        merged: true,
      }),
    );
    const dispatches = await PR_MERGED_HANDLER.handle(wrapAsInboundMessage(repoEvent), ctx);
    expect(dispatches).toHaveLength(0);
  });
});

// ── PR_REVIEW_SUBMITTED_HANDLER tests (Design §6.1) ───────────────────

describe("PR_REVIEW_SUBMITTED_HANDLER (mission-76 W1 §3.1)", () => {
  it("webhook-shape: engineer-reviews-PR (changes_requested) → architect notification", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const repoEvent = translateGhEvent(
      makePullRequestReviewEventWebhookShape({
        action: "submitted",
        reviewerLogin: "apnex-greg",
        prNumber: 167,
        state: "changes_requested",
        body: "LGTM with one nit",
      }),
    );
    const dispatches = await PR_REVIEW_SUBMITTED_HANDLER.handle(
      wrapAsInboundMessage(repoEvent),
      ctx,
    );
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].target).toEqual({ role: "architect" });
    expect(dispatches[0].intent).toBe("pr-review-notification");
    const payload = dispatches[0].payload as Record<string, unknown>;
    expect(payload.body).toBe("Engineer reviewed PR #167 (changes_requested)");
    expect(payload.prNumber).toBe(167);
    expect(payload.reviewer).toBe("apnex-greg");
    expect(payload.reviewState).toBe("changes_requested");
    expect(payload.reviewBody).toBe("LGTM with one nit");
  });

  it("webhook-shape: architect-reviews-PR (changes_requested) → engineer notification (symmetric per §3.4)", async () => {
    // state="commented" routes to pr-review-comment subkind (carved out per
    // Design v1.0 §3.1.1); this handler covers changes_requested + non-
    // approved/non-commented residual states (translator.ts dispatchPullRequestReview).
    const ctx = makeCtx([makeAgent("arch-A", "architect", "apnex-lily")]);
    const repoEvent = translateGhEvent(
      makePullRequestReviewEventWebhookShape({
        action: "submitted",
        reviewerLogin: "apnex-lily",
        prNumber: 167,
        state: "changes_requested",
        body: "needs adjustment",
      }),
    );
    const dispatches = await PR_REVIEW_SUBMITTED_HANDLER.handle(
      wrapAsInboundMessage(repoEvent),
      ctx,
    );
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].target).toEqual({ role: "engineer" });
    expect((dispatches[0].payload as Record<string, unknown>).body).toBe(
      "Architect reviewed PR #167 (changes_requested)",
    );
  });

  it("Events-API-shape: action='created' + reviewer fallback (bug-49 + mission-76 W1 dispatch fix)", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    // GH Events API uses action="created" for new review submissions; webhook
    // uses action="submitted". Both equivalent — translator routes both.
    const repoEvent = translateGhEvent(
      makePullRequestReviewEventEventsApiShape({
        action: "created",
        actorLogin: "apnex-greg",
        prNumber: 200,
        state: "changes_requested",
        body: "live-events-api review",
      }),
    );
    const dispatches = await PR_REVIEW_SUBMITTED_HANDLER.handle(
      wrapAsInboundMessage(repoEvent),
      ctx,
    );
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].target).toEqual({ role: "architect" });
    const payload = dispatches[0].payload as Record<string, unknown>;
    expect(payload.body).toBe("Engineer reviewed PR #200 (changes_requested)");
    expect(payload.reviewer).toBe("apnex-greg"); // bug-49 actor fallback
  });

  it("review with empty state → omits state clause from body (defensive)", async () => {
    // Hand-crafted RepoEvent — translator emits state from review.state directly;
    // a translator-fed empty-state fixture is awkward to construct, so we feed
    // the handler directly to verify the body-template defensive path.
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const repoEvent = {
      kind: "repo-event",
      subkind: "pr-review-submitted",
      payload: {
        repo: "apnex-org/agentic-network",
        prNumber: 167,
        reviewer: "apnex-greg",
        state: "",
        body: "no state",
        url: "https://github.com/apnex-org/agentic-network/pull/167",
      },
    };
    const dispatches = await PR_REVIEW_SUBMITTED_HANDLER.handle(
      wrapAsInboundMessage(repoEvent),
      ctx,
    );
    expect(dispatches).toHaveLength(1);
    expect((dispatches[0].payload as Record<string, unknown>).body).toBe(
      "Engineer reviewed PR #167",
    );
  });

  it("unknown-reviewer → skip", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const repoEvent = translateGhEvent(
      makePullRequestReviewEventWebhookShape({
        action: "submitted",
        reviewerLogin: "apnex",
        prNumber: 167,
        state: "approved",
        body: "ok",
      }),
    );
    // Note: state="approved" routes to pr-review-approved subkind (carved out
    // per Design v1.0 §3.1.1); but the handler under test would still get
    // pr-review-submitted-shape if dispatched directly. We use changes_requested
    // here to keep the dispatch routing aligned.
    void repoEvent;
    const altRepoEvent = translateGhEvent(
      makePullRequestReviewEventWebhookShape({
        action: "submitted",
        reviewerLogin: "apnex",
        prNumber: 167,
        state: "changes_requested",
        body: "ok",
      }),
    );
    const dispatches = await PR_REVIEW_SUBMITTED_HANDLER.handle(
      wrapAsInboundMessage(altRepoEvent),
      ctx,
    );
    expect(dispatches).toHaveLength(0);
  });

  it("missing prNumber → skip (extractPayload null guard)", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const msg = makeRepoEventMessage({
      kind: "repo-event",
      subkind: "pr-review-submitted",
      payload: { reviewer: "apnex-greg", state: "approved" }, // missing prNumber
    });
    const dispatches = await PR_REVIEW_SUBMITTED_HANDLER.handle(msg, ctx);
    expect(dispatches).toHaveLength(0);
  });
});

// ── PR_REVIEW_APPROVED_HANDLER tests (bug-51 closure) ─────────────────

describe("PR_REVIEW_APPROVED_HANDLER (bug-51 closes design-rationale-incorrect carve-out)", () => {
  it("Events-API-shape: engineer-approves-PR (action='created', state='approved') → architect notification", async () => {
    // GH Events API: action="created" + state="approved" + review.user=null;
    // bug-49 fallback fills reviewer from event-level actor.login.
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const repoEvent = translateGhEvent(
      makePullRequestReviewEventEventsApiShape({
        action: "created",
        actorLogin: "apnex-greg",
        prNumber: 200,
        state: "approved",
        body: "LGTM",
      }),
    );
    const dispatches = await PR_REVIEW_APPROVED_HANDLER.handle(
      wrapAsInboundMessage(repoEvent),
      ctx,
    );
    expect(dispatches).toHaveLength(1);
    const d = dispatches[0];
    expect(d.kind).toBe("note");
    expect(d.target).toEqual({ role: "architect" });
    expect(d.intent).toBe("pr-review-approved-notification");
    const payload = d.payload as Record<string, unknown>;
    expect(payload.body).toBe("Engineer approved PR #200");
    expect(payload.prNumber).toBe(200);
    expect(payload.reviewer).toBe("apnex-greg"); // bug-49 actor fallback
    expect(payload.reviewState).toBe("approved"); // explicit shape parity with pr-review-submitted
    expect(payload.reviewBody).toBe("LGTM");
    // KNOWN LIMITATION (bug-50 deferral): Events-API review.html_url is null
    // → reviewUrl will be empty string. Operator navigates via prNumber.
    expect(payload.reviewUrl).toBe("");
  });

  it("webhook-shape: architect-approves-PR (action='submitted', state='approved') → engineer notification (symmetric per §3.4)", async () => {
    const ctx = makeCtx([makeAgent("arch-A", "architect", "apnex-lily")]);
    const repoEvent = translateGhEvent(
      makePullRequestReviewEventWebhookShape({
        action: "submitted",
        reviewerLogin: "apnex-lily",
        prNumber: 201,
        state: "approved",
        body: "approved per audit cycle 2026-05-05",
      }),
    );
    const dispatches = await PR_REVIEW_APPROVED_HANDLER.handle(
      wrapAsInboundMessage(repoEvent),
      ctx,
    );
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].target).toEqual({ role: "engineer" });
    const payload = dispatches[0].payload as Record<string, unknown>;
    expect(payload.body).toBe("Architect approved PR #201");
    expect(payload.reviewer).toBe("apnex-lily");
    expect(payload.reviewState).toBe("approved");
    expect(payload.reviewBody).toBe("approved per audit cycle 2026-05-05");
    // Webhook delivery: review.html_url is populated.
    expect(payload.reviewUrl).toBe(
      "https://github.com/apnex-org/agentic-network/pull/201#pullrequestreview-1",
    );
  });

  it("empty body (thumbs-up review) → notification still fires; reviewBody empty", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const repoEvent = translateGhEvent(
      makePullRequestReviewEventWebhookShape({
        action: "submitted",
        reviewerLogin: "apnex-greg",
        prNumber: 202,
        state: "approved",
        body: "",
      }),
    );
    const dispatches = await PR_REVIEW_APPROVED_HANDLER.handle(
      wrapAsInboundMessage(repoEvent),
      ctx,
    );
    expect(dispatches).toHaveLength(1);
    const payload = dispatches[0].payload as Record<string, unknown>;
    expect(payload.body).toBe("Engineer approved PR #202");
    expect(payload.reviewBody).toBe("");
  });

  it("director-author → skip (§3.1 m2 fold; no peer-role for engineer↔architect routing)", async () => {
    const ctx = makeCtx([makeAgent("dir-A", "director", "apnex-director")]);
    const repoEvent = translateGhEvent(
      makePullRequestReviewEventWebhookShape({
        action: "submitted",
        reviewerLogin: "apnex-director",
        prNumber: 203,
        state: "approved",
        body: "ok",
      }),
    );
    const dispatches = await PR_REVIEW_APPROVED_HANDLER.handle(
      wrapAsInboundMessage(repoEvent),
      ctx,
    );
    expect(dispatches).toHaveLength(0);
  });

  it("unknown-reviewer → skip (lookup returns null; mission-76 γ EXPECTED behavior for unregistered authors)", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const repoEvent = translateGhEvent(
      makePullRequestReviewEventWebhookShape({
        action: "submitted",
        reviewerLogin: "apnex",
        prNumber: 204,
        state: "approved",
        body: "ok",
      }),
    );
    const dispatches = await PR_REVIEW_APPROVED_HANDLER.handle(
      wrapAsInboundMessage(repoEvent),
      ctx,
    );
    expect(dispatches).toHaveLength(0);
  });

  it("missing prNumber → skip (extractPayload null guard)", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const msg = makeRepoEventMessage({
      kind: "repo-event",
      subkind: "pr-review-approved",
      payload: { reviewer: "apnex-greg", state: "approved" }, // missing prNumber
    });
    const dispatches = await PR_REVIEW_APPROVED_HANDLER.handle(msg, ctx);
    expect(dispatches).toHaveLength(0);
  });

  it("dispatch boundary: BOTH action='submitted' AND action='created' route to pr-review-approved subkind when state='approved'", () => {
    // bug-46 paired-closure dispatch test — translator routes both action
    // variants to the same subkind. This pin catches future translator
    // regressions at the handler-test boundary (without invoking the handler).
    const webhookEvent = translateGhEvent(
      makePullRequestReviewEventWebhookShape({
        action: "submitted",
        reviewerLogin: "apnex-greg",
        prNumber: 205,
        state: "approved",
        body: "",
      }),
    );
    const eventsApiEvent = translateGhEvent(
      makePullRequestReviewEventEventsApiShape({
        action: "created",
        actorLogin: "apnex-greg",
        prNumber: 205,
        state: "approved",
        body: "",
      }),
    );
    const webhookSubkind = (webhookEvent as { subkind: string }).subkind;
    const eventsApiSubkind = (eventsApiEvent as { subkind: string }).subkind;
    expect(webhookSubkind).toBe("pr-review-approved");
    expect(eventsApiSubkind).toBe("pr-review-approved");
    // And the registry resolves the handler for that subkind:
    expect(findRepoEventHandler("pr-review-approved")).not.toBeNull();
  });

  it("dispatch boundary: state='changes_requested' routes to pr-review-submitted (NOT pr-review-approved)", () => {
    // Confirms mutual exclusion at translator dispatch boundary — the
    // pr-review-submitted handler covers non-approved/non-commented states;
    // pr-review-approved is only invoked for state='approved'.
    const repoEvent = translateGhEvent(
      makePullRequestReviewEventWebhookShape({
        action: "submitted",
        reviewerLogin: "apnex-greg",
        prNumber: 206,
        state: "changes_requested",
        body: "",
      }),
    );
    const subkind = (repoEvent as { subkind: string }).subkind;
    expect(subkind).toBe("pr-review-submitted");
  });
});

// ── Handler-shape contract assertions ─────────────────────────────────

describe("PR-event handler RepoEventHandler-interface conformance (mission-76 W1 + bug-51)", () => {
  it("PR_OPENED_HANDLER conforms to {subkind, name, handle}", () => {
    expect(PR_OPENED_HANDLER.subkind).toBe("pr-opened");
    expect(PR_OPENED_HANDLER.name).toBe("pr_opened_bilateral");
    expect(typeof PR_OPENED_HANDLER.handle).toBe("function");
  });

  it("PR_MERGED_HANDLER conforms to {subkind, name, handle}", () => {
    expect(PR_MERGED_HANDLER.subkind).toBe("pr-merged");
    expect(PR_MERGED_HANDLER.name).toBe("pr_merged_bilateral");
    expect(typeof PR_MERGED_HANDLER.handle).toBe("function");
  });

  it("PR_REVIEW_SUBMITTED_HANDLER conforms to {subkind, name, handle}", () => {
    expect(PR_REVIEW_SUBMITTED_HANDLER.subkind).toBe("pr-review-submitted");
    expect(PR_REVIEW_SUBMITTED_HANDLER.name).toBe("pr_review_submitted_bilateral");
    expect(typeof PR_REVIEW_SUBMITTED_HANDLER.handle).toBe("function");
  });

  it("PR_REVIEW_APPROVED_HANDLER conforms to {subkind, name, handle} (bug-51)", () => {
    expect(PR_REVIEW_APPROVED_HANDLER.subkind).toBe("pr-review-approved");
    expect(PR_REVIEW_APPROVED_HANDLER.name).toBe("pr_review_approved_bilateral");
    expect(typeof PR_REVIEW_APPROVED_HANDLER.handle).toBe("function");
  });
});
