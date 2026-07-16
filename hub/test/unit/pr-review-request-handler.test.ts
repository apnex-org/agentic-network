import { describe, expect, it } from "vitest";
import { translateGhEvent } from "@apnex/repo-event-bridge";
import type { Message } from "../../src/entities/index.js";
import type { IPolicyContext } from "../../src/policy/types.js";
import type { Agent, AgentRole } from "../../src/state.js";
import { GITHUB_LOGIN_LABEL } from "../../src/policy/repo-event-author-lookup.js";
import {
  PR_REVIEW_REQUESTED_HANDLER,
  PR_REVIEW_REQUEST_REMOVED_HANDLER,
} from "../../src/policy/repo-event-pr-review-requested-handler.js";

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

function wrapAsMessage(payload: unknown): Message {
  return {
    id: "01PRREVIEWREQUEST",
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

function reviewRequestedEvent(target: { reviewer?: string; teamSlug?: string; teamName?: string }) {
  return translateGhEvent({
    type: "PullRequestEvent",
    repo: { name: "apnex-org/agentic-network" },
    payload: {
      action: "review_requested",
      pull_request: {
        number: 624,
        title: "Pin manifest",
        html_url: "https://github.com/apnex-org/agentic-network/pull/624",
        user: { login: "apnex-greg" },
        base: { ref: "main", sha: "aaa" },
        head: { ref: "feature", sha: "bbb" },
      },
      ...(target.reviewer ? { requested_reviewer: { login: target.reviewer } } : {}),
      ...(target.teamSlug || target.teamName
        ? { requested_team: { slug: target.teamSlug, name: target.teamName } }
        : {}),
    },
  });
}

describe("PR review request handler", () => {
  it("routes unique requested reviewer login directly to target.agentId", async () => {
    const ctx = makeCtx([makeAgent("agent-lily", "architect", "apnex-lily")]);
    const out = await PR_REVIEW_REQUESTED_HANDLER.handle(
      wrapAsMessage(reviewRequestedEvent({ reviewer: "apnex-lily" })),
      ctx,
    );
    expect(out).toHaveLength(1);
    expect(out[0].target).toEqual({ agentId: "agent-lily" });
    expect(out[0].intent).toBe("pr-review-requested-notification");
    const payload = out[0].payload as Record<string, unknown>;
    expect(payload.targetResolutionStatus).toBe("unique");
    expect(payload.routingReason).toBe("requested_reviewer_unique");
    expect(payload.targetAgentId).toBe("agent-lily");
    expect(payload.sourceMessageId).toBe("01PRREVIEWREQUEST");
    expect(payload.normalizedEventType).toBe("github.pull_request.review_requested");
    expect(payload.ruleId).toBe("pr_review_request_to_workitem_v0");
    expect(payload.normalizedEventIdempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.bindingDecision).toMatchObject({ ok: false, reason: "binding_missing", fallbackOnly: true });
    expect(payload.requestedReviewerLogin).toBe("apnex-lily");
    expect(payload.prNumber).toBe(624);
  });

  it("falls back with ambiguity metadata for duplicate requested reviewer login", async () => {
    const ctx = makeCtx([
      makeAgent("agent-greg", "engineer", "apnex-greg"),
      makeAgent("agent-ruby", "engineer", "apnex-greg"),
    ]);
    const out = await PR_REVIEW_REQUESTED_HANDLER.handle(
      wrapAsMessage(reviewRequestedEvent({ reviewer: "apnex-greg" })),
      ctx,
    );
    expect(out).toHaveLength(1);
    expect(out[0].target).toEqual({ role: "architect" });
    const payload = out[0].payload as Record<string, unknown>;
    expect(payload.targetResolutionStatus).toBe("ambiguous");
    expect(payload.routingReason).toBe("requested_reviewer_ambiguous");
    expect(payload.matchedAgentIds).toEqual(["agent-greg", "agent-ruby"]);
  });

  it("falls back for unknown requested reviewer instead of silently skipping", async () => {
    const ctx = makeCtx([]);
    const out = await PR_REVIEW_REQUESTED_HANDLER.handle(
      wrapAsMessage(reviewRequestedEvent({ reviewer: "apnex-unknown" })),
      ctx,
    );
    expect(out).toHaveLength(1);
    expect(out[0].target).toEqual({ role: "architect" });
    const payload = out[0].payload as Record<string, unknown>;
    expect(payload.targetResolutionStatus).toBe("none");
    expect(payload.routingReason).toBe("requested_reviewer_unresolved");
    expect(payload.requestedReviewerLogin).toBe("apnex-unknown");
  });

  it("falls back for team request with team metadata", async () => {
    const ctx = makeCtx([]);
    const out = await PR_REVIEW_REQUESTED_HANDLER.handle(
      wrapAsMessage(reviewRequestedEvent({ teamSlug: "platform", teamName: "Platform" })),
      ctx,
    );
    expect(out).toHaveLength(1);
    expect(out[0].target).toEqual({ role: "architect" });
    const payload = out[0].payload as Record<string, unknown>;
    expect(payload.targetResolutionStatus).toBe("team");
    expect(payload.routingReason).toBe("team_request_unresolved");
    expect(payload.requestedTeamSlug).toBe("platform");
    expect(payload.requestedTeamName).toBe("Platform");
  });

  it("emits removal notification as cancellation metadata", async () => {
    const repoEvent = translateGhEvent({
      type: "PullRequestEvent",
      repo: { name: "apnex-org/agentic-network" },
      payload: {
        action: "review_request_removed",
        pull_request: { number: 625, user: { login: "apnex-greg" } },
        requested_reviewer: { login: "apnex-lily" },
      },
    });
    const ctx = makeCtx([makeAgent("agent-lily", "architect", "apnex-lily")]);
    const out = await PR_REVIEW_REQUEST_REMOVED_HANDLER.handle(wrapAsMessage(repoEvent), ctx);
    expect(out).toHaveLength(1);
    expect(out[0].target).toEqual({ agentId: "agent-lily" });
    expect(out[0].intent).toBe("pr-review-request-removed-notification");
    const payload = out[0].payload as Record<string, unknown>;
    expect(payload.reviewRequestAction).toBe("review_request_removed");
    expect(payload.subkind).toBe("pr-review-request-removed");
    expect(payload.normalizedEventType).toBe("github.pull_request.review_request_removed");
    expect(payload.bindingDecision).toMatchObject({ ok: false, reason: "removal_is_cancellation_only" });
    expect(String(payload.body)).toContain("review request removed");
  });
});
