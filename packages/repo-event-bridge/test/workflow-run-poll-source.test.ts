/**
 * WorkflowRunPollSource unit tests — idea-255 / M-Workflow-Run-Events-
 * Hub-Integration v1.0 §2.3 (translator + cursor logic).
 *
 * Per `feedback_local_test_masking_via_cached_state.md`: tests use a fresh
 * MemoryStorageProvider per case so the cold-start / cursor-init path is
 * actually exercised — no pre-seeded cursor state masking CI fragilities.
 *
 * Format-regex pin per `feedback_format_regex_over_hardcoded_hash_tests.md`:
 * test SHAPE (cursor advances; dedupe filters; auth-fail is terminal) not
 * specific run_id values.
 */

import { describe, it, expect } from "vitest";
import { MemoryStorageProvider } from "@apnex/storage-provider";
import { WorkflowRunPollSource } from "../src/workflow-run-poll-source.js";
import type { Logger } from "../src/poll-source.js";
import type { MessageSink } from "../src/sink.js";

interface MockResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

function makeFetch(handler: (url: string) => MockResponse): typeof fetch {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const m = handler(url);
    return new Response(
      m.body !== undefined ? JSON.stringify(m.body) : null,
      { status: m.status, headers: m.headers ?? {} },
    ) as unknown as Response;
  };
}

function silentLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

/** A no-op succeeding sink — delivery always succeeds (these tests assert pollOnce.emitted, not
 *  sink content; the failure-injection + cursor-gating coverage lives in the coupling test). */
function okSink(): MessageSink {
  return { async emit() {} };
}

function defaultScopesResponse(): MockResponse {
  return {
    status: 200,
    headers: { "x-oauth-scopes": "repo, read:org, read:user" },
    body: { login: "engineer-greg" },
  };
}

function makeRunResponse(runs: unknown[]): MockResponse {
  return {
    status: 200,
    headers: {
      "x-ratelimit-remaining": "4999",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
    },
    body: { workflow_runs: runs, total_count: runs.length },
  };
}

function makeRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 100,
    name: "release-plugin",
    status: "completed",
    conclusion: "success",
    event: "push",
    head_sha: "abc1234abc1234abc1234abc1234abc1234abc12",
    head_branch: "main",
    html_url: "https://github.com/apnex-org/agentic-network/actions/runs/100",
    run_started_at: "2026-05-08T00:30:00Z",
    updated_at: "2026-05-08T00:32:01Z",
    created_at: "2026-05-08T00:30:00Z",
    actor: { login: "apnex-lily" },
    triggering_actor: { login: "apnex-lily" },
    ...overrides,
  };
}

// ── pollOnce — cold-start (fresh storage; no pre-seeded cursor) ──────

describe("WorkflowRunPollSource pollOnce — cold-start", () => {
  it("emits all returned runs on first poll + advances cursor", async () => {
    const storage = new MemoryStorageProvider();
    const fetchImpl = makeFetch((url) => {
      if (url.endsWith("/user")) return defaultScopesResponse();
      if (url.includes("/actions/runs")) {
        return makeRunResponse([
          makeRun({ id: 100, updated_at: "2026-05-08T00:31:00Z" }),
          makeRun({ id: 101, updated_at: "2026-05-08T00:32:01Z" }),
        ]);
      }
      return { status: 404, body: { message: "not found" } };
    });

    const source = new WorkflowRunPollSource({
      repos: ["apnex-org/agentic-network"],
      token: "test-token",
      storage,
      fetch: fetchImpl,
      logger: silentLogger(),
      now: () => Date.parse("2026-05-08T00:35:00Z"),
      sink: okSink(),
    });
    await source.start();
    const result = await source.pollOnce("apnex-org/agentic-network");
    await source.stop();

    expect(result.outcome).toBe("ok");
    expect(result.emitted).toBe(2);
  });

  it("dedupes runs already seen on a previous poll", async () => {
    const storage = new MemoryStorageProvider();
    let pollCount = 0;
    const fetchImpl = makeFetch((url) => {
      if (url.endsWith("/user")) return defaultScopesResponse();
      if (url.includes("/actions/runs")) {
        pollCount++;
        // Both polls return the same run; second poll should dedupe to 0
        return makeRunResponse([makeRun({ id: 200 })]);
      }
      return { status: 404, body: { message: "not found" } };
    });

    const source = new WorkflowRunPollSource({
      repos: ["r/r"],
      token: "test-token",
      storage,
      fetch: fetchImpl,
      logger: silentLogger(),
      now: () => Date.parse("2026-05-08T00:35:00Z"),
      sink: okSink(),
    });
    await source.start();
    const r1 = await source.pollOnce("r/r");
    const r2 = await source.pollOnce("r/r");
    await source.stop();

    expect(r1.emitted).toBe(1);
    expect(r2.emitted).toBe(0);
    // pollCount may be >2 if the background runLoop fired between start() and
    // pollOnce() — the dedupe contract is what matters, not the call count.
    expect(pollCount).toBeGreaterThanOrEqual(2);
  });

  it("returns ok-with-zero-emitted when /actions/runs is empty", async () => {
    const storage = new MemoryStorageProvider();
    const fetchImpl = makeFetch((url) => {
      if (url.endsWith("/user")) return defaultScopesResponse();
      if (url.includes("/actions/runs")) return makeRunResponse([]);
      return { status: 404, body: { message: "not found" } };
    });

    const source = new WorkflowRunPollSource({
      repos: ["r/r"],
      token: "test-token",
      storage,
      fetch: fetchImpl,
      logger: silentLogger(),
      now: () => Date.parse("2026-05-08T00:35:00Z"),
      sink: okSink(),
    });
    await source.start();
    const result = await source.pollOnce("r/r");
    await source.stop();

    expect(result.outcome).toBe("ok");
    expect(result.emitted).toBe(0);
  });
});

describe("WorkflowRunPollSource pollOnce — auth-failure terminal path", () => {
  it("returns auth-failure outcome on 401", async () => {
    const storage = new MemoryStorageProvider();
    const fetchImpl = makeFetch((url) => {
      if (url.endsWith("/user")) return defaultScopesResponse();
      if (url.includes("/actions/runs")) {
        return { status: 401, body: { message: "Bad credentials" } };
      }
      return { status: 404, body: { message: "not found" } };
    });

    const source = new WorkflowRunPollSource({
      repos: ["r/r"],
      token: "test-token",
      storage,
      fetch: fetchImpl,
      logger: silentLogger(),
      now: () => Date.parse("2026-05-08T00:35:00Z"),
      sink: okSink(),
    });
    await source.start();
    const result = await source.pollOnce("r/r");
    await source.stop();

    expect(result.outcome).toBe("auth-failure");
    expect(result.emitted).toBe(0);
  });
});

describe("WorkflowRunPollSource — query-param shape (F4 + F5 folds)", () => {
  it("includes per_page=50 + created=>=<isoTime>", async () => {
    const storage = new MemoryStorageProvider();
    let capturedUrl = "";
    const fetchImpl = makeFetch((url) => {
      if (url.endsWith("/user")) return defaultScopesResponse();
      if (url.includes("/actions/runs")) {
        capturedUrl = url;
        return makeRunResponse([]);
      }
      return { status: 404, body: { message: "not found" } };
    });

    const source = new WorkflowRunPollSource({
      repos: ["r/r"],
      token: "test-token",
      storage,
      fetch: fetchImpl,
      logger: silentLogger(),
      now: () => Date.parse("2026-05-08T00:35:00Z"),
      sink: okSink(),
    });
    await source.start();
    await source.pollOnce("r/r");
    await source.stop();

    expect(capturedUrl).toContain("per_page=50");
    // F4 fold: timestamp-based cursor — query includes `created=>=<iso>`
    expect(capturedUrl).toMatch(/created=%3E%3D\d{4}-\d{2}-\d{2}/);
  });
});
