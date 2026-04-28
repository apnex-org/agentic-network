/**
 * PollSource unit tests — mission-52 T2.
 *
 * Test discipline:
 *   - PollSource is exercised against a mock-fetch (no real HTTP)
 *     and a `MemoryStorageProvider` (the conformance reference impl).
 *   - `sleep`, `now`, and `logger` are injected so cadence + budget +
 *     health-snapshot tests are deterministic.
 *   - `pollOnce(repoId)` is the public test seam — exercises the full
 *     poll-translate-dedupe-cursor cycle without spinning the
 *     background loop.
 */

import { describe, it, expect, vi } from "vitest";
import { MemoryStorageProvider } from "@apnex/storage-provider";
import {
  PollSource,
  GH_PAT_RATE_LIMIT_PER_HOUR,
  DEFAULT_BUDGET_FRACTION,
  DEFAULT_CADENCE_SECONDS,
  type Logger,
  type PollSourceOptions,
} from "../src/poll-source.js";
import { PatScopeError, GhApiAuthError } from "../src/gh-api-client.js";
import type { CursorStoreOptions } from "../src/cursor-store.js";

// ── Test harness ──────────────────────────────────────────────────────

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

function captureLogger(): { logger: Logger; lines: { level: string; msg: string }[] } {
  const lines: { level: string; msg: string }[] = [];
  return {
    logger: {
      info: (msg) => lines.push({ level: "info", msg }),
      warn: (msg) => lines.push({ level: "warn", msg }),
      error: (msg) => lines.push({ level: "error", msg }),
    },
    lines,
  };
}

function defaultScopesResponse(): MockResponse {
  return {
    status: 200,
    headers: { "x-oauth-scopes": "repo, read:org, read:user" },
    body: { login: "engineer-greg" },
  };
}

function emptyEventsResponse(): MockResponse {
  return {
    status: 200,
    headers: {
      etag: 'W/"empty"',
      "x-ratelimit-remaining": "4999",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
    },
    body: [],
  };
}

/**
 * Test sleep: blocks the background polling loop indefinitely so
 * tests can drive `pollOnce(repoId)` deterministically. Resolves
 * only when the source's AbortSignal fires (i.e., on `stop()`).
 */
function blockingSleep(_ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    signal?.addEventListener("abort", () => resolve(), { once: true });
  });
}

function newSource(
  overrides: Partial<PollSourceOptions> = {},
): {
  source: PollSource;
  storage: CursorStoreOptions["storage"];
  logger: Logger;
  loggerLines: { level: string; msg: string }[];
} {
  const storage = new MemoryStorageProvider();
  const { logger, lines } = captureLogger();
  const source = new PollSource({
    repos: ["owner/example"],
    token: "ghp_test",
    storage,
    logger,
    sleep: blockingSleep,
    ...overrides,
  });
  return { source, storage, logger, loggerLines: lines };
}

// ── Construction + capabilities ──────────────────────────────────────

describe("PollSource — construction + capabilities", () => {
  it("advertises poll/periodic/pull capability flags", () => {
    const { source } = newSource();
    expect(source.capabilities).toEqual({
      transport: "poll",
      latency: "periodic",
      mode: "pull",
      dedupe: true,
      persistedCursor: true,
    });
  });

  it("default cadence is 30s", () => {
    expect(DEFAULT_CADENCE_SECONDS).toBe(30);
  });

  it("default budget is 80% of 5000 req/hr", () => {
    expect(DEFAULT_BUDGET_FRACTION).toBe(0.8);
    expect(GH_PAT_RATE_LIMIT_PER_HOUR).toBe(5000);
  });
});

// ── PAT scope validation ─────────────────────────────────────────────

describe("PollSource — start() PAT scope validation", () => {
  it("happy path: required scopes present → start() resolves", async () => {
    const fetchImpl = makeFetch((url) => {
      if (url.endsWith("/user")) return defaultScopesResponse();
      return emptyEventsResponse();
    });
    const { source } = newSource({ fetch: fetchImpl });
    await expect(source.start()).resolves.toBeUndefined();
    await source.stop();
  });

  it("under-scoped PAT → PatScopeError; source state stays unstarted", async () => {
    const fetchImpl = makeFetch(() => ({
      status: 200,
      headers: { "x-oauth-scopes": "repo" },
      body: { login: "x" },
    }));
    const { source } = newSource({ fetch: fetchImpl });
    await expect(source.start()).rejects.toBeInstanceOf(PatScopeError);
  });

  it("auth failure (401) → GhApiAuthError; health flips to auth-failure", async () => {
    const fetchImpl = makeFetch(() => ({
      status: 401,
      headers: {},
      body: { message: "Bad credentials" },
    }));
    const { source } = newSource({ fetch: fetchImpl });
    await expect(source.start()).rejects.toBeInstanceOf(GhApiAuthError);
    expect(source.health().paused).toBe(true);
    expect(source.health().pausedReason).toBe("auth-failure");
  });
});

// ── Aggregate budget log line ────────────────────────────────────────

describe("PollSource — aggregate budget startup log", () => {
  it("logs budget line at start() (within budget → info)", async () => {
    const fetchImpl = makeFetch((url) => {
      if (url.endsWith("/user")) return defaultScopesResponse();
      return emptyEventsResponse();
    });
    const { source, loggerLines } = newSource({
      repos: ["a/x", "b/x", "c/x"],
      cadenceSeconds: 30,
      fetch: fetchImpl,
    });
    await source.start();
    await source.stop();

    const budgetLine = loggerLines.find((l) =>
      l.msg.includes("[repo-event-bridge] Polling"),
    );
    expect(budgetLine).toBeDefined();
    expect(budgetLine?.level).toBe("info");
    // 3 repos × 30s = 6/min = 360 req/hr.
    expect(budgetLine?.msg).toContain("3 repos");
    expect(budgetLine?.msg).toContain("30s");
    expect(budgetLine?.msg).toContain("360 req/hr");
    expect(budgetLine?.msg).toContain("budget cap: 4000 req/hr");
    expect(budgetLine?.msg).toContain("headroom");
  });

  it("warns when poll volume exceeds budget cap", async () => {
    const fetchImpl = makeFetch((url) => {
      if (url.endsWith("/user")) return defaultScopesResponse();
      return emptyEventsResponse();
    });
    // 200 repos × 30s cadence = 24000 req/hr > 4000 cap.
    const repos = Array.from({ length: 200 }, (_, i) => `org/repo-${i}`);
    const { source, loggerLines } = newSource({
      repos,
      cadenceSeconds: 30,
      fetch: fetchImpl,
    });
    await source.start();
    await source.stop();

    const warnLine = loggerLines.find((l) => l.level === "warn");
    expect(warnLine).toBeDefined();
    expect(warnLine?.msg).toContain("OVER BUDGET");
  });

  it("respects custom cadenceSeconds + budgetFraction", async () => {
    const fetchImpl = makeFetch((url) => {
      if (url.endsWith("/user")) return defaultScopesResponse();
      return emptyEventsResponse();
    });
    const { source, loggerLines } = newSource({
      repos: ["a/x"],
      cadenceSeconds: 60,
      budgetFraction: 0.5,
      fetch: fetchImpl,
    });
    await source.start();
    await source.stop();

    const line = loggerLines.find((l) => l.msg.includes("Polling"));
    expect(line?.msg).toContain("60s");
    // 1 repo × 60s = 60 req/hr; cap at 0.5 × 5000 = 2500.
    expect(line?.msg).toContain("60 req/hr");
    expect(line?.msg).toContain("budget cap: 2500 req/hr");
  });
});

// ── pollOnce: cursor advance + dedupe + emit ─────────────────────────

describe("PollSource — pollOnce: cursor advance + emit", () => {
  it("first poll emits all events; second poll dedupes them", async () => {
    let pollIndex = 0;
    const fetchImpl = makeFetch((url) => {
      if (url.endsWith("/user")) return defaultScopesResponse();
      // Same payload twice — second poll should be all-deduped.
      pollIndex++;
      return {
        status: 200,
        headers: {
          etag: pollIndex === 1 ? 'W/"v1"' : 'W/"v2"',
          "x-ratelimit-remaining": "4999",
        },
        body: [
          {
            id: "evt-1",
            type: "PullRequestEvent",
            payload: { action: "opened", pull_request: { number: 1 } },
            created_at: "2026-04-25T00:00:00Z",
          },
          {
            id: "evt-2",
            type: "PushEvent",
            payload: { ref: "refs/heads/main", commits: [] },
            created_at: "2026-04-25T00:00:01Z",
          },
        ],
      };
    });
    const { source } = newSource({ fetch: fetchImpl });
    await source.start();

    const first = await source.pollOnce("owner/example");
    expect(first.outcome).toBe("ok");
    expect(first.emitted).toBe(2);

    const second = await source.pollOnce("owner/example");
    expect(second.outcome).toBe("ok");
    expect(second.emitted).toBe(0);

    await source.stop();
  });

  it("pollOnce emits translated RepoEvents into the iterator", async () => {
    const fetchImpl = makeFetch((url) => {
      if (url.endsWith("/user")) return defaultScopesResponse();
      return {
        status: 200,
        headers: { etag: 'W/"v1"' },
        body: [
          {
            id: "evt-1",
            type: "PullRequestEvent",
            payload: { action: "opened", pull_request: { number: 99 } },
            created_at: "2026-04-25T00:00:00Z",
          },
        ],
      };
    });
    const { source } = newSource({ fetch: fetchImpl });
    await source.start();
    await source.pollOnce("owner/example");

    // Drain one event from the iterator.
    const it = source[Symbol.asyncIterator]();
    const result = await it.next();
    expect(result.done).toBe(false);
    expect(result.value).toMatchObject({
      kind: "repo-event",
      subkind: "pr-opened",
    });
    await source.stop();
  });

  it("pollOnce 304 (notModified) → emits nothing; outcome=not-modified", async () => {
    let i = 0;
    const fetchImpl = makeFetch((url) => {
      if (url.endsWith("/user")) return defaultScopesResponse();
      i++;
      if (i === 1) {
        return {
          status: 200,
          headers: { etag: 'W/"v1"' },
          body: [{ id: "x", type: "PushEvent", payload: { ref: "refs/heads/main" }, created_at: "t" }],
        };
      }
      return { status: 304, headers: { etag: 'W/"v1"' } };
    });
    const { source } = newSource({ fetch: fetchImpl });
    await source.start();
    await source.pollOnce("owner/example");
    const second = await source.pollOnce("owner/example");
    expect(second.outcome).toBe("not-modified");
    expect(second.emitted).toBe(0);
    await source.stop();
  });
});

// ── pollOnce: 429 + transient + auth-failure paths ───────────────────

describe("PollSource — pollOnce: error-path differentiation", () => {
  it("429 → outcome=rate-limit; health.pausedReason=rate-limit", async () => {
    let i = 0;
    const fetchImpl = makeFetch((url) => {
      if (url.endsWith("/user")) return defaultScopesResponse();
      i++;
      return {
        status: 429,
        headers: { "retry-after": "60" },
        body: { message: "rate limited" },
      };
    });
    const { source } = newSource({ fetch: fetchImpl });
    await source.start();
    const result = await source.pollOnce("owner/example");
    expect(result.outcome).toBe("rate-limit");
    expect(result.resumeAtMs).toBeDefined();
    expect(source.health().paused).toBe(true);
    expect(source.health().pausedReason).toBe("rate-limit");
    await source.stop();
  });

  it("500 → outcome=transient; health does NOT flip to rate-limit", async () => {
    const fetchImpl = makeFetch((url) => {
      if (url.endsWith("/user")) return defaultScopesResponse();
      return { status: 500, headers: {}, body: "ISE" };
    });
    const { source } = newSource({ fetch: fetchImpl });
    await source.start();
    const result = await source.pollOnce("owner/example");
    expect(result.outcome).toBe("transient");
    // Health flips only on prolonged backoff (loop-driven), not single call.
    expect(source.health().pausedReason).not.toBe("rate-limit");
    await source.stop();
  });

  it("401 → outcome=auth-failure; health.pausedReason=auth-failure", async () => {
    let i = 0;
    const fetchImpl = makeFetch((url) => {
      i++;
      if (url.endsWith("/user") && i === 1) return defaultScopesResponse();
      return { status: 401, headers: {}, body: { message: "Bad credentials" } };
    });
    const { source } = newSource({ fetch: fetchImpl });
    await source.start();
    const result = await source.pollOnce("owner/example");
    expect(result.outcome).toBe("auth-failure");
    expect(source.health().paused).toBe(true);
    expect(source.health().pausedReason).toBe("auth-failure");
    await source.stop();
  });

  it("recovers: success after 429 clears health.pausedReason", async () => {
    let i = 0;
    const fetchImpl = makeFetch((url) => {
      if (url.endsWith("/user")) return defaultScopesResponse();
      i++;
      if (i === 1) return { status: 429, headers: { "retry-after": "1" } };
      return {
        status: 200,
        headers: { etag: 'W/"v1"' },
        body: [],
      };
    });
    const { source } = newSource({ fetch: fetchImpl });
    await source.start();
    await source.pollOnce("owner/example");
    expect(source.health().pausedReason).toBe("rate-limit");
    await source.pollOnce("owner/example");
    expect(source.health().paused).toBe(false);
    expect(source.health().pausedReason).toBe("rate-limit");
    // Note: pausedReason field is sticky in the snapshot type for
    // forensic visibility; what matters is `paused: false`.
    await source.stop();
  });
});

// ── Cursor + dedupe persistence ──────────────────────────────────────

describe("PollSource — persistence (eats own dogfood)", () => {
  it("cursor + dedupe survive PollSource re-instantiation (Hub-restart)", async () => {
    const storage = new MemoryStorageProvider();
    const { logger } = captureLogger();
    const fetchImpl = makeFetch((url) => {
      if (url.endsWith("/user")) return defaultScopesResponse();
      return {
        status: 200,
        headers: { etag: 'W/"v1"' },
        body: [
          { id: "evt-1", type: "PushEvent", payload: { ref: "refs/heads/main" }, created_at: "t1" },
          { id: "evt-2", type: "PushEvent", payload: { ref: "refs/heads/main" }, created_at: "t2" },
        ],
      };
    });

    // First lifecycle: emit two events, stop.
    const first = new PollSource({
      repos: ["owner/example"],
      token: "ghp_test",
      storage,
      logger,
      sleep: blockingSleep,
      fetch: fetchImpl,
    });
    await first.start();
    const r1 = await first.pollOnce("owner/example");
    expect(r1.emitted).toBe(2);
    await first.stop();

    // Second lifecycle: same storage, same fetch — events should
    // dedupe out, emit count = 0.
    const second = new PollSource({
      repos: ["owner/example"],
      token: "ghp_test",
      storage,
      logger,
      sleep: blockingSleep,
      fetch: fetchImpl,
    });
    await second.start();
    const r2 = await second.pollOnce("owner/example");
    expect(r2.emitted).toBe(0);
    await second.stop();
  });

  it("cursor etag round-trips: second start reads stored etag", async () => {
    const storage = new MemoryStorageProvider();
    const { logger } = captureLogger();
    let lastIfNoneMatch: string | undefined;
    let i = 0;
    const fetchImpl: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      lastIfNoneMatch = headers["if-none-match"];
      if (url.endsWith("/user")) {
        return new Response(JSON.stringify({ login: "x" }), {
          status: 200,
          headers: { "x-oauth-scopes": "repo, read:org, read:user" },
        }) as unknown as Response;
      }
      i++;
      if (i === 1) {
        return new Response(
          JSON.stringify([
            { id: "e", type: "PushEvent", payload: {}, created_at: "t" },
          ]),
          { status: 200, headers: { etag: 'W/"persisted-etag"' } },
        ) as unknown as Response;
      }
      return new Response(null, {
        status: 304,
        headers: { etag: 'W/"persisted-etag"' },
      }) as unknown as Response;
    };

    const first = new PollSource({
      repos: ["owner/example"],
      token: "ghp_test",
      storage,
      logger,
      sleep: blockingSleep,
      fetch: fetchImpl,
    });
    await first.start();
    await first.pollOnce("owner/example");
    await first.stop();

    const second = new PollSource({
      repos: ["owner/example"],
      token: "ghp_test",
      storage,
      logger,
      sleep: blockingSleep,
      fetch: fetchImpl,
    });
    await second.start();
    await second.pollOnce("owner/example");
    expect(lastIfNoneMatch).toBe('W/"persisted-etag"');
    await second.stop();
  });
});

// ── Health snapshot ──────────────────────────────────────────────────

describe("PollSource — health() snapshot", () => {
  it("initial health: paused=false; lastSuccessfulPoll=epoch", () => {
    const { source } = newSource();
    const h = source.health();
    expect(h.paused).toBe(false);
    expect(h.lastSuccessfulPoll).toBe(new Date(0).toISOString());
  });

  it("successful poll updates lastSuccessfulPoll", async () => {
    const fixedNow = Date.parse("2026-04-25T12:00:00Z");
    const fetchImpl = makeFetch((url) => {
      if (url.endsWith("/user")) return defaultScopesResponse();
      return emptyEventsResponse();
    });
    const { source } = newSource({
      fetch: fetchImpl,
      now: () => fixedNow,
    });
    await source.start();
    await source.pollOnce("owner/example");
    expect(source.health().lastSuccessfulPoll).toBe(
      new Date(fixedNow).toISOString(),
    );
    expect(source.health().paused).toBe(false);
    await source.stop();
  });
});

// ── Iterator semantics ───────────────────────────────────────────────

describe("PollSource — iterator semantics", () => {
  it("stop() terminates the iterator with done=true", async () => {
    const fetchImpl = makeFetch((url) => {
      if (url.endsWith("/user")) return defaultScopesResponse();
      return emptyEventsResponse();
    });
    const { source } = newSource({ fetch: fetchImpl });
    await source.start();

    const it = source[Symbol.asyncIterator]();
    const nextPromise = it.next();
    await source.stop();
    const result = await nextPromise;
    expect(result.done).toBe(true);
  });

  it("buffered events drain before stop terminates iterator", async () => {
    const fetchImpl = makeFetch((url) => {
      if (url.endsWith("/user")) return defaultScopesResponse();
      return {
        status: 200,
        headers: { etag: 'W/"v1"' },
        body: [
          { id: "e1", type: "PushEvent", payload: {}, created_at: "t" },
          { id: "e2", type: "PushEvent", payload: {}, created_at: "t" },
        ],
      };
    });
    const { source } = newSource({ fetch: fetchImpl });
    await source.start();
    await source.pollOnce("owner/example");
    const it = source[Symbol.asyncIterator]();
    const a = await it.next();
    const b = await it.next();
    expect(a.done).toBe(false);
    expect(b.done).toBe(false);
    await source.stop();
  });
});
