/**
 * PollSource conformance suite — mission-52 T2 (updated work-44/bug-190 PR-2).
 *
 * Replays the canonical W1 GH-event fixture through a real PollSource against a mock-fetch GH
 * server, asserting the resulting RepoEvent stream matches the per-subkind + per-payload
 * expectations in the W1 fixture file.
 *
 * bug-190 (A): delivery is now INLINE to the sink (the async-iterator is gone) — so the suite
 * collects the emitted stream from a recording sink instead of draining an iterator. Each test
 * drives pollOnce directly (no start()) so the background poll loop can't race the sink and
 * double-deliver.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { MemoryStorageProvider } from "@apnex/storage-provider";
import { PollSource } from "../../src/poll-source.js";
import type { RepoEventSubkind } from "../../src/translator.js";
import type { RepoEvent } from "../../src/event-source.js";
import type { MessageSink } from "../../src/sink.js";

interface FixtureEntry {
  name: string;
  input: { type: string; repo?: { name: string }; payload: unknown };
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

/** Mock GH server: /user scope-validation + /repos/.../events polling (each fixture event gets a
 *  synthetic `id` so per-event-id dedupe engages on the second poll). */
function makeMockGhFetch(): { fetch: typeof fetch } {
  const handler: typeof fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/user")) {
      return new Response(JSON.stringify({ login: "engineer-greg" }), {
        status: 200,
        headers: { "x-oauth-scopes": "repo, read:org, read:user" },
      }) as unknown as Response;
    }
    if (url.includes(`/repos/${REPO}/events`)) {
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
  return { fetch: handler };
}

/** A recording sink — captures the inline-delivered RepoEvent stream (in order). */
function recordingSink(): { sink: MessageSink; emitted: RepoEvent[] } {
  const emitted: RepoEvent[] = [];
  return { sink: { async emit(e: RepoEvent) { emitted.push(e); } }, emitted };
}

function newSource(storage: MemoryStorageProvider, sink: MessageSink): PollSource {
  return new PollSource({
    repos: [REPO],
    token: "ghp_conformance_test",
    storage,
    fetch: makeMockGhFetch().fetch,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    sink,
  });
}

describe("PollSource conformance — fixture replay end-to-end", () => {
  it("delivers one RepoEvent per fixture entry; subkind matches the expected", async () => {
    const rec = recordingSink();
    const source = newSource(new MemoryStorageProvider(), rec.sink);
    // Drive pollOnce directly (no start → no background loop racing the sink).
    const result = await source.pollOnce(REPO);
    expect(result.outcome).toBe("ok");
    expect(result.emitted).toBe(fixture.events.length);
    expect(rec.emitted).toHaveLength(fixture.events.length);
    for (let i = 0; i < fixture.events.length; i++) {
      expect(rec.emitted[i].kind).toBe("repo-event");
      expect(rec.emitted[i].subkind).toBe(fixture.events[i].expectedSubkind);
    }
  });

  it("per-entry payload satisfies fixture expectations", async () => {
    const rec = recordingSink();
    const source = newSource(new MemoryStorageProvider(), rec.sink);
    await source.pollOnce(REPO);
    expect(rec.emitted).toHaveLength(fixture.events.length);
    for (let i = 0; i < fixture.events.length; i++) {
      const entry = fixture.events[i];
      const actual = rec.emitted[i].payload as Record<string, unknown>;
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

  it("second poll dedupes the entire fixture (no re-delivery)", async () => {
    const rec = recordingSink();
    const source = newSource(new MemoryStorageProvider(), rec.sink);
    const first = await source.pollOnce(REPO);
    expect(first.emitted).toBe(fixture.events.length);
    const second = await source.pollOnce(REPO);
    expect(second.emitted).toBe(0);
    // The sink saw each fixture event exactly ONCE across both polls.
    expect(rec.emitted).toHaveLength(fixture.events.length);
  });

  it("Hub-restart: second PollSource over same storage delivers zero on first poll", async () => {
    const storage = new MemoryStorageProvider();
    const r1 = await newSource(storage, recordingSink().sink).pollOnce(REPO);
    expect(r1.emitted).toBe(fixture.events.length);
    // Second lifecycle, same storage — the dedupe set persisted, so nothing re-delivers.
    const rec2 = recordingSink();
    const r2 = await newSource(storage, rec2.sink).pollOnce(REPO);
    expect(r2.emitted).toBe(0);
    expect(rec2.emitted).toHaveLength(0);
  });
});
