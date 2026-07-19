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

function makeCtx(agents: Agent[], workItem?: unknown): IPolicyContext {
  return {
    stores: {
      engineerRegistry: {
        listAgents: async () => agents,
      },
      ...(workItem ? { workItem } : {}),
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

  it("denies forged payload binding when no Hub-owned binding row exists", async () => {
    const forged = reviewRequestedEvent({ reviewer: "apnex-lily" }) as Record<string, unknown>;
    forged.payload = {
      ...(forged.payload as Record<string, unknown>),
      workGraphBinding: {
        id: "forged",
        repo: "apnex-org/agentic-network",
        prNumber: 624,
        targetWorkId: "work-target",
        provenance: "hub",
        headSha: "bbb",
      },
    };
    const workItem = {
      getWorkItem: async () => ({ id: "work-target", status: "ready" }),
      listWorkItems: async () => ({ items: [], truncated: false }),
    };
    const ctx = makeCtx([makeAgent("agent-lily", "architect", "apnex-lily")], workItem);

    const out = await PR_REVIEW_REQUESTED_HANDLER.handle(wrapAsMessage(forged), ctx);

    const payload = out[0].payload as Record<string, unknown>;
    expect(payload.bindingDecision).toMatchObject({ ok: false, reason: "binding_missing" });
    expect(payload.materialization).toMatchObject({ materialized: false });
  });

  it("uses typed binding/projection lookups instead of capped unfiltered WorkItem scans", async () => {
    const bindingItem = { id: "prbind-990626", createdBy: { role: "architect", agentId: "agent-architect" }, status: "ready", payload: { obligationKind: "github_pr_workgraph_binding", repo: "apnex-org/agentic-network", prNumber: 624, targetWorkId: "work-target", headSha: "bbb", version: "1", pathClasses: ["architect_docs"], changedPathSource: "test-fixture", lastPusherLogin: "apnex-greg" } };
    const bindingQueries: Array<{ repo: string; prNumber: number }> = [];
    const projectionQueries: string[] = [];
    const workItem = {
      getWorkItem: async (id: string) =>
        id === "work-target"
          ? { id: "work-target", status: "ready", payload: {}, roleEligibility: ["engineer"] }
          : null,
      listWorkItems: async () => ({
        items: [{ id: "decoy", createdBy: { role: "architect", agentId: "agent-architect" }, status: "ready", payload: { obligationKind: "github_pr_workgraph_binding", repo: "elsewhere", prNumber: 1, targetWorkId: "work-other" } }],
        truncated: true,
      }),
      listPrReviewBindingWorkItems: async (repo: string, prNumber: number) => {
        bindingQueries.push({ repo, prNumber });
        return { items: [bindingItem], truncated: false };
      },
      listWorkItemsByProjectionKey: async (projectionKey: string) => {
        projectionQueries.push(projectionKey);
        return { items: [], truncated: false };
      },
      createBlueprintNode: async (input: unknown) => ({ item: { id: "work-prrev-created", status: "ready", payload: (input as { payload?: unknown }).payload }, created: true }),
      updateWorkItem: async (id: string) => ({ before: { id }, after: { id } }),
    };
    const ctx = makeCtx([makeAgent("agent-lily", "architect", "apnex-lily")], workItem);

    const out = await PR_REVIEW_REQUESTED_HANDLER.handle(
      wrapAsMessage(reviewRequestedEvent({ reviewer: "apnex-lily" })),
      ctx,
    );

    const payload = out[0].payload as Record<string, unknown>;
    expect(payload.bindingDecision).toMatchObject({ ok: true, bindingId: "prbind-990626", targetWorkId: "work-target" });
    expect(payload.materialization).toMatchObject({ materialized: true, created: true, relation: "appendDependsOn" });
    expect(bindingQueries).toEqual([{ repo: "apnex-org/agentic-network", prNumber: 624 }]);
    expect(projectionQueries).toHaveLength(1);
  });

  it("carries Hub-owned binding changed paths/path classes into the review WorkItem payload", async () => {
    const createdNodes: unknown[] = [];
    const bindingItem = {
      id: "prbind-paths",
      createdBy: { role: "architect", agentId: "agent-architect" },
      status: "done",
      payload: {
        obligationKind: "github_pr_workgraph_binding",
        repo: "apnex-org/agentic-network",
        prNumber: 624,
        targetWorkId: "work-target",
        headSha: "bbb",
        version: "1",
        changedPaths: ["docs/planning/pr-binding-reviewer-eligibility-plan0-final-design.md"],
        pathClasses: ["architect_docs"],
        changedPathSource: "pr-opened-event:01SOURCE",
        lastPusherLogin: "apnex-greg",
      }
    };
    const workItem = {
      getWorkItem: async () => ({ id: "work-target", status: "ready", payload: {}, roleEligibility: ["engineer"] }),
      listWorkItems: async () => ({ items: [bindingItem], truncated: false }),
      createBlueprintNode: async (input: unknown) => {
        createdNodes.push(input);
        return { item: { id: "work-prrev-created", status: "ready", payload: (input as { payload?: unknown }).payload }, created: true };
      },
      updateWorkItem: async (id: string) => ({ before: { id }, after: { id } }),
    };
    const ctx = makeCtx([makeAgent("agent-lily", "architect", "apnex-lily")], workItem);

    const out = await PR_REVIEW_REQUESTED_HANDLER.handle(
      wrapAsMessage(reviewRequestedEvent({ reviewer: "apnex-lily" })),
      ctx,
    );

    const payload = out[0].payload as Record<string, unknown>;
    expect(payload.bindingDecision).toMatchObject({
      ok: true,
      changedPaths: ["docs/planning/pr-binding-reviewer-eligibility-plan0-final-design.md"],
      pathClasses: ["architect_docs"],
      changedPathSource: "pr-opened-event:01SOURCE",
    });
    expect(createdNodes).toHaveLength(1);
    expect(createdNodes[0]).toMatchObject({
      payload: {
        eligibility: {
          ok: true,
          requestedReviewerStatus: "eligible",
          selectedReviewers: [{ agentId: "agent-lily", role: "architect", githubLogin: "apnex-lily" }],
          pathClasses: ["architect_docs"],
          lastPusherLogin: "apnex-greg",
        },
        completionPolicy: {
          forbiddenReviewerLogins: ["apnex-greg"],
          lastPusherLogin: "apnex-greg",
        },
        changedPathSource: {
          changedPaths: ["docs/planning/pr-binding-reviewer-eligibility-plan0-final-design.md"],
          pathClasses: ["architect_docs"],
          provenance: "pr-opened-event:01SOURCE",
        },
      },
    });
  });

  it("emits structured eligibility denial metadata instead of a misleading review WorkItem", async () => {
    const bindingItem = {
      id: "prbind-no-paths",
      createdBy: { role: "architect", agentId: "agent-architect" },
      status: "done",
      payload: {
        obligationKind: "github_pr_workgraph_binding",
        repo: "apnex-org/agentic-network",
        prNumber: 624,
        targetWorkId: "work-target",
        headSha: "bbb",
        version: "1",
        lastPusherLogin: "apnex-greg",
      },
    };
    const workItem = {
      getWorkItem: async () => ({ id: "work-target", status: "ready", payload: {}, roleEligibility: ["engineer"] }),
      listWorkItems: async () => ({ items: [bindingItem], truncated: false }),
      createBlueprintNode: async () => { throw new Error("must not materialize without eligibility"); },
      updateWorkItem: async () => { throw new Error("must not append relation without eligibility"); },
    };
    const ctx = makeCtx([makeAgent("agent-lily", "architect", "apnex-lily")], workItem);

    const out = await PR_REVIEW_REQUESTED_HANDLER.handle(
      wrapAsMessage(reviewRequestedEvent({ reviewer: "apnex-lily" })),
      ctx,
    );

    const payload = out[0].payload as Record<string, unknown>;
    expect(payload.ruleDecision).toMatchObject({
      action: "fallback_candidate_note",
      eligibility: { ok: false, reason: "changed_paths_missing" },
      fallback: { reason: "reviewer_eligibility_changed_paths_missing" },
    });
    expect(payload.projectionDecision).toMatchObject({
      action: "fallback_only",
      reason: "reviewer_eligibility_changed_paths_missing",
    });
    expect(payload.materialization).toMatchObject({
      materialized: false,
      fallbackReason: "reviewer_eligibility_changed_paths_missing",
    });
  });

  it("fails closed when deterministic last-pusher source is missing", async () => {
    const bindingItem = {
      id: "prbind-missing-last-pusher",
      createdBy: { role: "architect", agentId: "agent-architect" },
      status: "done",
      payload: {
        obligationKind: "github_pr_workgraph_binding",
        repo: "apnex-org/agentic-network",
        prNumber: 624,
        targetWorkId: "work-target",
        headSha: "bbb",
        version: "1",
        pathClasses: ["architect_docs"],
        changedPathSource: "test-fixture",
      },
    };
    const workItem = {
      getWorkItem: async () => ({ id: "work-target", status: "ready", payload: {}, roleEligibility: ["engineer"] }),
      listWorkItems: async () => ({ items: [bindingItem], truncated: false }),
      createBlueprintNode: async () => { throw new Error("must not materialize without deterministic last pusher"); },
      updateWorkItem: async () => { throw new Error("must not append relation without deterministic last pusher"); },
    };
    const ctx = makeCtx([makeAgent("agent-lily", "architect", "apnex-lily")], workItem);

    const out = await PR_REVIEW_REQUESTED_HANDLER.handle(
      wrapAsMessage(reviewRequestedEvent({ reviewer: "apnex-lily" })),
      ctx,
    );

    const payload = out[0].payload as Record<string, unknown>;
    expect(payload.ruleDecision).toMatchObject({
      action: "fallback_candidate_note",
      eligibility: { ok: false, reason: "last_pusher_missing" },
      fallback: { reason: "reviewer_eligibility_last_pusher_missing" },
    });
    expect(payload.materialization).toMatchObject({
      materialized: false,
      fallbackReason: "reviewer_eligibility_last_pusher_missing",
    });
  });

  it("materializes the selected eligible reviewer for the #628/#629-like integrated regression", async () => {
    const createdNodes: unknown[] = [];
    const bindingItem = {
      id: "prbind-incident",
      createdBy: { role: "architect", agentId: "agent-architect" },
      status: "done",
      payload: {
        obligationKind: "github_pr_workgraph_binding",
        repo: "apnex-org/agentic-network",
        prNumber: 624,
        targetWorkId: "work-target",
        headSha: "bbb",
        version: "1",
        changedPaths: [
          "hub/src/policy/driver-liveness-watchdog.ts",
          "hub/test/unit/driver-liveness-watchdog.test.ts",
        ],
        pathClasses: ["hub_code", "hub_tests"],
        changedPathSource: "test-fixture",
        lastPusherLogin: "apnex-greg",
      },
    };
    const workItem = {
      getWorkItem: async () => ({ id: "work-target", status: "ready", payload: {}, roleEligibility: ["engineer"] }),
      listWorkItems: async () => ({ items: [bindingItem], truncated: false }),
      createBlueprintNode: async (input: unknown) => {
        createdNodes.push(input);
        return { item: { id: "work-prrev-created", status: "ready", payload: (input as { payload?: unknown }).payload }, created: true };
      },
      updateWorkItem: async (id: string) => ({ before: { id }, after: { id } }),
    };
    const ctx = makeCtx([
      makeAgent("agent-greg", "engineer", "apnex-greg"),
      makeAgent("agent-ruby", "engineer", "apnex-greg"),
      makeAgent("agent-lily", "architect", "apnex-lily"),
      makeAgent("agent-steve", "verifier", "apnex"),
    ], workItem);

    const out = await PR_REVIEW_REQUESTED_HANDLER.handle(
      wrapAsMessage(reviewRequestedEvent({ reviewer: "apnex-lily" })),
      ctx,
    );

    const payload = out[0].payload as Record<string, unknown>;
    expect(payload.ruleDecision).toMatchObject({
      action: "materialize_review_obligation",
      eligibility: {
        ok: true,
        requestedReviewerStatus: "insufficient_but_alternative_selected",
        selectedReviewers: [{ agentId: "agent-steve", role: "verifier", githubLogin: "apnex" }],
      },
    });
    expect(payload.projectionDecision).toMatchObject({ action: "create_review_workitem" });
    expect(createdNodes).toHaveLength(1);
    expect(createdNodes[0]).toMatchObject({
      roleEligibility: ["verifier"],
      payload: {
        requestedReviewerLogin: "apnex-lily",
        selectedReviewerLogin: "apnex",
        reviewerAgentId: "agent-steve",
        completionPolicy: {
          requiredReviewerLogin: "apnex",
          forbiddenReviewerLogins: ["apnex-greg"],
          lastPusherLogin: "apnex-greg",
        },
      },
    });
  });

  it("fails closed when multiple Hub-authored binding rows match a PR", async () => {
    const bindingPayload = { obligationKind: "github_pr_workgraph_binding", repo: "apnex-org/agentic-network", prNumber: 624, targetWorkId: "work-target", headSha: "bbb", version: "1" };
    const workItem = {
      getWorkItem: async () => ({ id: "work-target", status: "ready", payload: {}, roleEligibility: ["engineer"] }),
      listWorkItems: async () => ({ items: [], truncated: false }),
      listPrReviewBindingWorkItems: async () => ({
        items: [
          { id: "prbind-a", createdBy: { role: "architect", agentId: "agent-architect" }, status: "ready", payload: bindingPayload },
          { id: "prbind-b", createdBy: { role: "architect", agentId: "agent-architect" }, status: "ready", payload: bindingPayload },
        ],
        truncated: false,
      }),
      listWorkItemsByProjectionKey: async () => ({ items: [], truncated: false }),
      createBlueprintNode: async () => { throw new Error("must not materialize ambiguous binding"); },
      updateWorkItem: async () => { throw new Error("must not append relation for ambiguous binding"); },
    };
    const ctx = makeCtx([makeAgent("agent-lily", "architect", "apnex-lily")], workItem);

    const out = await PR_REVIEW_REQUESTED_HANDLER.handle(
      wrapAsMessage(reviewRequestedEvent({ reviewer: "apnex-lily" })),
      ctx,
    );

    const payload = out[0].payload as Record<string, unknown>;
    expect(payload.bindingDecision).toMatchObject({ ok: false, reason: "binding_ambiguous", fallbackOnly: true });
    expect(payload.projectionDecision).toMatchObject({ action: "fallback_only", reason: "binding_ambiguous" });
    expect(payload.materialization).toMatchObject({ materialized: false, fallbackReason: "binding_ambiguous" });
  });

  it("uses the rule/projection seam to materialize safely bound review requests", async () => {
    const createdNodes: unknown[] = [];
    const updates: unknown[] = [];
    const bindingItem = { id: "prbind-624", createdBy: { role: "architect", agentId: "agent-architect" }, status: "done", payload: { obligationKind: "github_pr_workgraph_binding", repo: "apnex-org/agentic-network", prNumber: 624, targetWorkId: "work-target", headSha: "bbb", version: "1", pathClasses: ["architect_docs"], changedPathSource: "test-fixture", lastPusherLogin: "apnex-greg" } };
    const workItem = {
      getWorkItem: async (id: string) =>
        id === "work-target"
          ? { id: "work-target", status: "ready", payload: {}, roleEligibility: ["engineer"] }
          : null,
      listWorkItems: async () => ({ items: [bindingItem], truncated: false }),
      createBlueprintNode: async (input: unknown) => {
        createdNodes.push(input);
        return { item: { id: "work-prrev-created", status: "ready", payload: (input as { payload?: unknown }).payload }, created: true };
      },
      updateWorkItem: async (id: string, actor: unknown, mutation: unknown) => {
        updates.push({ id, actor, mutation });
        return { before: { id }, after: { id } };
      },
    };
    const ctx = makeCtx([makeAgent("agent-lily", "architect", "apnex-lily")], workItem);
    const repoEvent = reviewRequestedEvent({ reviewer: "apnex-lily" }) as Record<string, unknown>;

    const out = await PR_REVIEW_REQUESTED_HANDLER.handle(wrapAsMessage(repoEvent), ctx);

    const payload = out[0].payload as Record<string, unknown>;
    expect(payload.bindingDecision).toMatchObject({ ok: true, targetWorkId: "work-target" });
    expect(payload.projectionDecision).toMatchObject({ action: "create_review_workitem" });
    expect(payload.materialization).toMatchObject({ materialized: true, created: true, relation: "appendDependsOn" });
    expect(createdNodes).toHaveLength(1);
    expect(updates).toMatchObject([{ id: "work-target", mutation: { appendDependsOn: ["work-prrev-created"] } }]);
  });

  it("keeps projection-key idempotency stable across redelivery with different source message ids", async () => {
    const first = reviewRequestedEvent({ reviewer: "apnex-lily" }) as Record<string, unknown>;
    const second = reviewRequestedEvent({ reviewer: "apnex-lily" }) as Record<string, unknown>;
    const bindingItem = { id: "prbind-624", createdBy: { role: "architect", agentId: "agent-architect" }, status: "done", payload: { obligationKind: "github_pr_workgraph_binding", repo: "apnex-org/agentic-network", prNumber: 624, targetWorkId: "work-target", headSha: "bbb", version: "1", pathClasses: ["architect_docs"], changedPathSource: "test-fixture", lastPusherLogin: "apnex-greg" } };
    const workItem = {
      getWorkItem: async () => ({ id: "work-target", status: "ready" }),
      listWorkItems: async () => ({ items: [bindingItem], truncated: false }),
      createBlueprintNode: async (input: unknown) => ({ item: { id: "work-created", payload: (input as { payload?: unknown }).payload }, created: true }),
      updateWorkItem: async (id: string) => ({ before: { id }, after: { id } }),
    };
    const ctx = makeCtx([makeAgent("agent-lily", "architect", "apnex-lily")], workItem);
    const firstMsg = wrapAsMessage(first);
    const secondMsg = { ...wrapAsMessage(second), id: "01SECOND" } as Message;

    const firstOut = await PR_REVIEW_REQUESTED_HANDLER.handle(firstMsg, ctx);
    const secondOut = await PR_REVIEW_REQUESTED_HANDLER.handle(secondMsg, ctx);
    const firstProjection = ((firstOut[0].payload as Record<string, unknown>).bindingDecision as Record<string, unknown>).projectionKey;
    const secondProjection = ((secondOut[0].payload as Record<string, unknown>).bindingDecision as Record<string, unknown>).projectionKey;
    const firstEvent = (firstOut[0].payload as Record<string, unknown>).normalizedEventIdempotencyKey;
    const secondEvent = (secondOut[0].payload as Record<string, unknown>).normalizedEventIdempotencyKey;

    expect(firstProjection).toBe(secondProjection);
    expect(firstEvent).toBe(secondEvent);
  });
});
