import { describe, expect, it } from "vitest";
import { MemoryStorageProvider } from "@apnex/storage-provider";
import { RepoEventBridge } from "../../src/policy/repo-event-handler.js";

describe("RepoEventBridge review-request production source", () => {
  it("wires persisted issue-events into create_message with exact PR identity", async () => {
    const delivered: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/user")) {
        return new Response("{}", { status: 200, headers: { "x-oauth-scopes": "repo, read:org, read:user" } });
      }
      if (url.endsWith("/events")) return Response.json([], { headers: { etag: "\"repo-v1\"" } });
      if (url.includes("/actions/runs")) return Response.json({ workflow_runs: [], total_count: 0 });
      if (url.includes("/issues/events?")) {
        return Response.json([{
          id: 28315461370,
          event: "review_requested",
          created_at: "2026-07-22T08:41:55Z",
          issue: { number: 665, pull_request: { url: "https://api.github.com/repos/apnex-org/agentic-network/pulls/665" } },
          requested_reviewer: { login: "apnex" },
        }], { headers: { etag: "\"issues-v1\"" } });
      }
      if (url.endsWith("/pulls/665")) {
        return Response.json({
          number: 665,
          title: "Claude plugin 0.1.20",
          html_url: "https://github.com/apnex-org/agentic-network/pull/665",
          user: { login: "apnex-greg" },
          base: { ref: "main", sha: "base-exact" },
          head: { ref: "feature", sha: "head-exact" },
        });
      }
      return new Response("not found", { status: 404 });
    };
    const bridge = new RepoEventBridge({
      storage: new MemoryStorageProvider(),
      createMessageInvoke: async (args) => {
        delivered.push(args as unknown as Record<string, unknown>);
        return { messageId: `message-${delivered.length}` };
      },
      token: "ghp_test",
      repos: ["apnex-org/agentic-network"],
      cadenceSeconds: 3600,
      fetch: fetchImpl,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    await bridge.start();
    for (let i = 0; i < 20 && delivered.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await bridge.stop();

    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      kind: "external-injection",
      payload: {
        kind: "repo-event",
        subkind: "pr-review-requested",
        payload: {
          repo: "apnex-org/agentic-network",
          number: 665,
          requestedReviewerLogin: "apnex",
          base: { sha: "base-exact" },
          head: { sha: "head-exact" },
        },
      },
    });
    expect(bridge.health().lastSuccessfulDelivery).toBeDefined();
  });
});
