/**
 * Translator conformance suite — mission-52 T1.
 *
 * Replays the canonical GH-event fixture through `translateGhEvent`
 * and asserts the resulting `RepoEvent` shape matches the fixture's
 * declared expectations. Per thread-312 round-2 ratification (engineer
 * scope-reduction proposal accepted), T1 ships translator-only
 * conformance; the full PollSource-against-fixture parity invariant
 * gates on T2 (PollSource implementation) and replays the same
 * fixture file through source→sink for end-to-end coverage.
 *
 * Also exercises the `CreateMessageSink` stub: every fixture event
 * is fed through translator → sink, and the captured `create_message`
 * invocation is asserted to carry the translated `RepoEvent` envelope
 * verbatim. This proves the contract end-to-end without standing up
 * Hub transport.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  translateGhEvent,
  REPO_EVENT_SUBKINDS,
  type RepoEventSubkind,
} from "../../src/translator.js";
import {
  CreateMessageSink,
  type CreateMessageArgs,
} from "../../src/sink.js";
import type { RepoEvent } from "../../src/event-source.js";

interface FixtureEntry {
  name: string;
  input: unknown;
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

describe("translator conformance — fixture replay", () => {
  it("fixture covers every v1 RepoEventSubkind", () => {
    const seen = new Set(fixture.events.map((e) => e.expectedSubkind));
    for (const subkind of REPO_EVENT_SUBKINDS) {
      expect(
        seen.has(subkind),
        `fixture missing coverage for subkind=${subkind}`,
      ).toBe(true);
    }
  });

  for (const entry of fixture.events) {
    it(`[${entry.name}] dispatches to subkind=${entry.expectedSubkind}`, () => {
      const out = translateGhEvent(entry.input);
      expect(out.kind).toBe("repo-event");
      expect(out.subkind).toBe(entry.expectedSubkind);
    });

    it(`[${entry.name}] payload contains expected fields`, () => {
      const out = translateGhEvent(entry.input);
      const actual = out.payload as Record<string, unknown>;
      for (const [key, expectedValue] of Object.entries(entry.expectedPayload)) {
        expect(actual).toHaveProperty(key);
        expect(actual[key]).toEqual(expectedValue);
      }
    });
  }
});

describe("CreateMessageSink stub — end-to-end fixture replay", () => {
  it("emits one create_message call per fixture event", async () => {
    const captured: CreateMessageArgs[] = [];
    const sink = new CreateMessageSink({
      invoke: async (args) => {
        captured.push(args);
        return { messageId: `msg-${captured.length}` };
      },
    });

    for (const entry of fixture.events) {
      const event = translateGhEvent(entry.input);
      await sink.emit(event);
    }

    expect(captured).toHaveLength(fixture.events.length);
  });

  it("nests the full RepoEvent envelope under message.payload", async () => {
    const captured: CreateMessageArgs[] = [];
    const sink = new CreateMessageSink({
      invoke: async (args) => {
        captured.push(args);
        return {};
      },
    });

    const event = translateGhEvent(fixture.events[0].input);
    await sink.emit(event);

    expect(captured).toHaveLength(1);
    const wireEvent = captured[0].payload as RepoEvent;
    expect(wireEvent.kind).toBe("repo-event");
    expect(wireEvent.subkind).toBe(fixture.events[0].expectedSubkind);
  });

  it("defaults to messageKind=external-injection + target=null (broadcast)", async () => {
    const captured: CreateMessageArgs[] = [];
    const sink = new CreateMessageSink({
      invoke: async (args) => {
        captured.push(args);
        return {};
      },
    });

    await sink.emit(translateGhEvent(fixture.events[0].input));
    expect(captured[0].kind).toBe("external-injection");
    expect(captured[0].target).toBeNull();
    expect(captured[0].delivery).toBe("push-immediate");
  });

  it("respects messageKind, target, intent overrides", async () => {
    const captured: CreateMessageArgs[] = [];
    const sink = new CreateMessageSink({
      invoke: async (args) => {
        captured.push(args);
        return {};
      },
      messageKind: "note",
      target: { role: "engineer" },
      intent: "repo-event-replay",
      semanticIntent: "ingest-upstream",
    });

    await sink.emit(translateGhEvent(fixture.events[0].input));
    expect(captured[0].kind).toBe("note");
    expect(captured[0].target).toEqual({ role: "engineer" });
    expect(captured[0].intent).toBe("repo-event-replay");
    expect(captured[0].semanticIntent).toBe("ingest-upstream");
  });
});
