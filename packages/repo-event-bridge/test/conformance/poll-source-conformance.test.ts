/**
 * PollSource conformance suite — mission-52 T2.
 *
 * Replays the canonical W1 GH-event fixture through a real
 * PollSource instance against a mock-fetch GH server. Asserts the
 * resulting RepoEvent stream matches the same per-subkind +
 * per-payload expectations declared in the W1 fixture file (the
 * full PollSource-against-fixture parity invariant per thread-312
 * round-2 ratification).
 *
 * The mock-fetch handler:
 *   - Serves the scopes-validation `/user` GET
 *   - Returns the canonical fixture as the response body for the
 *     events poll
 *   - Includes a stable etag so the second poll demonstrates dedupe
 *
 * This is the "PollSource produces the expected message stream"
 * invariant the W1 fixture commitment promised would be enforced
 * once T2 lands.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { MemoryStorageProvider } from "@apnex/storage-provider";
import { PollSource } from "../../src/poll-source.js";
import type { RepoEventSubkind } from "../../src/translator.js";
import type { RepoEvent } from "../../src/event-source.js";

interface FixtureEntry {
  name: string;
  input: {
    type: string;
    repo?: { name: string };
    payload: unknown;
  };
  expectedSubkind: RepoEventSubkind;
  expectedPayload: Record<string, unknown>;
}

interface Fixture {
  description: string;
  events: FixtureEntry[];
}

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, "gh-events.fixture.json"), "utf-8");
const fixture: Fixture = JSON.parse(raw);

const REPO = "apnex-org/agentic-network";

/**
 * Mock GH server: serves /user scope-validation + /repos/.../events
 * polling. Each fixture event is given a synthetic `id` (entry.name)
 * so PollSource's per-event-id dedupe can engage on the second poll.
 */
function makeMockGhFetch(): { fetch: typeof fetch; pollCount: number; reset: () => void } {
  let polls = 0;
  const handler: typeof fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/user")) {
      return new Response(JSON.stringify({ login: "engineer-greg" }), {
        status: 200,
        headers: { "x-oauth-scopes": "repo, read:org, read:user" },
      }) as unknown as Response;
    }
    if (url.includes(`/repos/${REPO}/events`)) {
      polls++;
      const events = fixture.events.map((entry, idx) => ({
        id: entry.name,
        type: entry.input.type,
        repo: entry.input.repo,
        payload: entry.input.payload,
        created_at: new Date(1700000000_000 + idx).toISOString(),
      }));
      return new Response(JSON.stringify(events), {
        status: 200,
        headers: {
          etag: 'W/"fixture-v1"',
          "x-ratelimit-remaining": "4999",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
        },
      }) as unknown as Response;
    }
    return new Response("not found", { status: 404 }) as unknown as Response;
  };
  return {
    fetch: handler,
    get pollCount() {
      return polls;
    },
    reset: () => {
      polls = 0;
    },
  };
}

function blockingSleep(_ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    signal?.addEventListener("abort", () => resolve(), { once: true });
  });
}

async function drainEvents(
  source: PollSource,
  count: number,
  timeoutMs = 5000,
): Promise<RepoEvent[]> {
  const it = source[Symbol.asyncIterator]();
  const drained: RepoEvent[] = [];
  const deadline = Date.now() + timeoutMs;
  while (drained.length < count) {
    if (Date.now() > deadline) {
      throw new Error(
        `drainEvents timeout: got ${drained.length}/${count}`,
      );
    }
    const next = await it.next();
    if (next.done) break;
    drained.push(next.value);
  }
  return drained;
}

describe("PollSource conformance — fixture replay end-to-end", () => {
  it("emits one RepoEvent per fixture entry; subkind matches the expected", async () => {
    const mock = makeMockGhFetch();
    const storage = new MemoryStorageProvider();
    const source = new PollSource({
      repos: [REPO],
      token: "ghp_conformance_test",
      storage,
      sleep: blockingSleep,
      fetch: mock.fetch,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });

    await source.start();
    const result = await source.pollOnce(REPO);
    expect(result.outcome).toBe("ok");
    expect(result.emitted).toBe(fixture.events.length);

    const emitted = await drainEvents(source, fixture.events.length);
    await source.stop();

    expect(emitted).toHaveLength(fixture.events.length);

    // Per-entry subkind correctness (PollSource preserves order).
    for (let i = 0; i < fixture.events.length; i++) {
      const entry = fixture.events[i];
      const event = emitted[i];
      expect(event.kind).toBe("repo-event");
      expect(event.subkind).toBe(entry.expectedSubkind);
    }
  });

  it("per-entry payload satisfies fixture expectations", async () => {
    const mock = makeMockGhFetch();
    const storage = new MemoryStorageProvider();
    const source = new PollSource({
      repos: [REPO],
      token: "ghp_conformance_test",
      storage,
      sleep: blockingSleep,
      fetch: mock.fetch,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });

    await source.start();
    await source.pollOnce(REPO);
    const emitted = await drainEvents(source, fixture.events.length);
    await source.stop();

    for (let i = 0; i < fixture.events.length; i++) {
      const entry = fixture.events[i];
      const actual = emitted[i].payload as Record<string, unknown>;
      // For the unknown-subkind fallback we only assert that `raw`
      // exists; the GH events-API envelope adds `id` + `created_at`
      // that diverge from the fixture's translator-only expected raw
      // shape (W1 conformance still asserts raw-equality directly).
      if (entry.expectedSubkind === "unknown") {
        expect(actual).toHaveProperty("raw");
        continue;
      }
      for (const [key, expected] of Object.entries(entry.expectedPayload)) {
        expect(actual).toHaveProperty(key);
        expect(actual[key]).toEqual(expected);
      }
    }
  });

  it("second poll dedupes the entire fixture (no re-emission)", async () => {
    const mock = makeMockGhFetch();
    const storage = new MemoryStorageProvider();
    const source = new PollSource({
      repos: [REPO],
      token: "ghp_conformance_test",
      storage,
      sleep: blockingSleep,
      fetch: mock.fetch,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });

    await source.start();
    const first = await source.pollOnce(REPO);
    expect(first.emitted).toBe(fixture.events.length);

    const second = await source.pollOnce(REPO);
    expect(second.emitted).toBe(0);

    await source.stop();
  });

  it("Hub-restart: second PollSource over same storage emits zero events on first poll", async () => {
    const mock = makeMockGhFetch();
    const storage = new MemoryStorageProvider();

    // First lifecycle.
    const first = new PollSource({
      repos: [REPO],
      token: "ghp_conformance_test",
      storage,
      sleep: blockingSleep,
      fetch: mock.fetch,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
    await first.start();
    const r1 = await first.pollOnce(REPO);
    expect(r1.emitted).toBe(fixture.events.length);
    await first.stop();

    // Second lifecycle, same storage backing.
    const second = new PollSource({
      repos: [REPO],
      token: "ghp_conformance_test",
      storage,
      sleep: blockingSleep,
      fetch: mock.fetch,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
    await second.start();
    const r2 = await second.pollOnce(REPO);
    expect(r2.emitted).toBe(0);
    await second.stop();
  });
});
