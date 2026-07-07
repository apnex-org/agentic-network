import { afterEach, describe, expect, it, vi } from "vitest";

import type { Message } from "../../entities/message.js";
import type { Agent } from "../../state.js";
import type { IPolicyContext } from "../types.js";
import { PR_MERGED_HANDLER } from "../repo-event-pr-merged-handler.js";
import { GITHUB_LOGIN_LABEL } from "../repo-event-author-lookup.js";

function agent(id: string, role: Agent["role"], ghLogin: string): Agent {
  return {
    id,
    name: id,
    role,
    labels: { [GITHUB_LOGIN_LABEL]: ghLogin },
  } as unknown as Agent;
}

function ctxWithAgents(agents: Agent[]): IPolicyContext {
  return {
    stores: {
      engineerRegistry: {
        listAgents: async () => agents,
      },
    },
    emit: async () => {},
    dispatch: async () => {},
    sessionId: "test-session",
    clientIp: "127.0.0.1",
    role: "system",
    internalEvents: [],
    metrics: { inc: () => {} },
  } as unknown as IPolicyContext;
}

function inbound(payload: Record<string, unknown>): Message {
  return {
    id: "msg-repo-1",
    kind: "external-injection",
    authorRole: "system",
    authorAgentId: "hub",
    target: null,
    delivery: "push-immediate",
    status: "new",
    payload: { payload },
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
  };
}

function prPayload(author: string): Record<string, unknown> {
  return {
    author,
    number: 552,
    title: "idea-465: refresh retry",
    url: "https://github.com/apnex/agentic-network/pull/552",
    base: { ref: "main", sha: "base-sha" },
    head: { ref: "greg/idea-465", sha: "head-sha" },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PR_MERGED_HANDLER — direct author notification", () => {
  it("mapped engineer author emits existing architect peer note and direct author-agent note", async () => {
    const dispatches = await PR_MERGED_HANDLER.handle(
      inbound(prPayload("greg-gh")),
      ctxWithAgents([agent("agent-greg", "engineer", "greg-gh")]),
    );

    expect(dispatches).toHaveLength(2);

    const peer = dispatches.find((d) => d.intent === "pr-merged-notification");
    expect(peer).toMatchObject({
      kind: "note",
      target: { role: "architect" },
      delivery: "push-immediate",
    });
    expect(peer?.payload).toMatchObject({
      body: "Engineer merged PR #552: idea-465: refresh retry",
      prNumber: 552,
      prTitle: "idea-465: refresh retry",
      prAuthor: "greg-gh",
      prUrl: "https://github.com/apnex/agentic-network/pull/552",
      prBaseRef: "main",
      prHeadRef: "greg/idea-465",
      sourceMessageId: "msg-repo-1",
    });

    const direct = dispatches.find((d) => d.intent === "pr-merged-author-notification");
    expect(direct).toMatchObject({
      kind: "note",
      target: { agentId: "agent-greg" },
      delivery: "push-immediate",
    });
    expect(direct?.payload).toMatchObject({
      body: "Engineer merged PR #552: idea-465: refresh retry",
      prNumber: 552,
      prTitle: "idea-465: refresh retry",
      prAuthor: "greg-gh",
      prUrl: "https://github.com/apnex/agentic-network/pull/552",
      prBaseRef: "main",
      prHeadRef: "greg/idea-465",
      sourceMessageId: "msg-repo-1",
      routingReason: "pr-author-direct",
      authorAgentId: "agent-greg",
    });
  });

  it("mapped architect author emits existing engineer peer note and direct author-agent note", async () => {
    const dispatches = await PR_MERGED_HANDLER.handle(
      inbound(prPayload("lily-gh")),
      ctxWithAgents([agent("agent-lily", "architect", "lily-gh")]),
    );

    expect(dispatches).toHaveLength(2);
    expect(dispatches.find((d) => d.intent === "pr-merged-notification")).toMatchObject({
      target: { role: "engineer" },
      payload: { body: "Architect merged PR #552: idea-465: refresh retry" },
    });
    expect(dispatches.find((d) => d.intent === "pr-merged-author-notification")).toMatchObject({
      target: { agentId: "agent-lily" },
      payload: {
        body: "Architect merged PR #552: idea-465: refresh retry",
        routingReason: "pr-author-direct",
        authorAgentId: "agent-lily",
      },
    });
  });

  it("duplicate GitHub-login matches preserve peer behavior but skip direct author-agent routing", async () => {
    const dispatches = await PR_MERGED_HANDLER.handle(
      inbound(prPayload("shared-gh")),
      ctxWithAgents([
        agent("agent-greg", "engineer", "shared-gh"),
        agent("agent-other", "engineer", "shared-gh"),
      ]),
    );

    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({
      intent: "pr-merged-notification",
      target: { role: "architect" },
    });
    expect(dispatches.some((d) => d.intent === "pr-merged-author-notification")).toBe(false);
  });

  it("unmapped author preserves the expected skip path and emits no direct note", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});

    const dispatches = await PR_MERGED_HANDLER.handle(
      inbound(prPayload("unknown-gh")),
      ctxWithAgents([]),
    );

    expect(dispatches).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("malformed payload remains warn-and-skip with no direct route", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const dispatches = await PR_MERGED_HANDLER.handle(
      inbound({ author: "greg-gh", title: "missing number" }),
      ctxWithAgents([agent("agent-greg", "engineer", "greg-gh")]),
    );

    expect(dispatches).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("payload extraction failed");
  });

  it("missing author remains warn-and-skip with no direct route", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const dispatches = await PR_MERGED_HANDLER.handle(
      inbound({ number: 552, title: "missing author" }),
      ctxWithAgents([agent("agent-greg", "engineer", "greg-gh")]),
    );

    expect(dispatches).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("missing author login");
  });
});
