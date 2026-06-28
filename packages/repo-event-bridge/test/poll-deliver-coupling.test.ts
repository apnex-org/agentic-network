/**
 * work-44/bug-190 PR-2 — the poll+deliver COUPLING gate tests.
 *
 * The load-bearing proofs (steve's gate). Each is mutation-NON-VACUOUS — the comment names the
 * source mutation that turns it RED:
 *   FI-1  persistent sink failure -> cursor UN-advanced -> the event RE-DELIVERS on the next poll
 *         (mutation: advance-the-cursor-anyway -> next poll 304 -> event LOST -> reds).
 *   FI-2  the poll/deliver loop SURVIVES repeated delivery failures (it keeps polling — it does NOT
 *         die like the old fire-and-forget drainer) (mutation: return/throw-uncaught on failure ->
 *         loop dies -> the poll-count never reaches the target -> reds/hangs).
 *   FI-3  health reports deliveryFailing on persistent failure, cleared on a delivered cycle
 *         (mutation: drop markDeliveryFailing -> stays false -> reds).
 *   M4    PollSource ADVANCES the etag cursor on an all-deduped/empty-200 (the re-fetch-storm guard)
 *         (mutation: advance only when delivered.length>0 -> stale If-None-Match -> reds).
 *   M2    WorkflowRun-empty returns ok/0 (empty-path regression guard). DISCLOSED: this invariant is
 *         BEHAVIOURALLY BENIGN — filterUnseen([]) is a no-op + the empty path is side-effect-free, so
 *         routing empty through the events path stays green (no non-vacuous mutation exists); M4 is
 *         the load-bearing, non-vacuous empty-result invariant.
 */

import { describe, it, expect } from "vitest";
import { MemoryStorageProvider } from "@apnex/storage-provider";
import { PollSource } from "../src/poll-source.js";
import { WorkflowRunPollSource } from "../src/workflow-run-poll-source.js";
import type { MessageSink } from "../src/sink.js";
import type { RepoEvent } from "../src/event-source.js";
import type { Logger } from "../src/poll-source.js";

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const fastSleep = async (_ms: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) return; // immediate (abort-aware) — collapses cadence + emit-retry waits
};

/** Recording sink; `failTimes` makes the first N emit ATTEMPTS throw, then it succeeds. */
function recordingSink(failTimes = 0): {
  sink: MessageSink;
  emitted: RepoEvent[];
  attempts: () => number;
} {
  const emitted: RepoEvent[] = [];
  let attempts = 0;
  let remaining = failTimes;
  return {
    sink: {
      async emit(e: RepoEvent) {
        attempts++;
        if (remaining > 0) {
          remaining--;
          throw new Error("sink emit failed (injected)");
        }
        emitted.push(e);
      },
    },
    emitted,
    attempts: () => attempts,
  };
}

const SCOPES = {
  status: 200,
  headers: { "x-oauth-scopes": "repo, read:org, read:user" },
  body: { login: "x" },
};

/** Mock GH /events fetch that always returns the same single event with a per-poll etag, and
 *  records the last If-None-Match. */
function eventsFetch(
  mode: "stable-304" | "new-etag" = "stable-304",
): { fetch: typeof fetch; ifNoneMatch: () => string | undefined; polls: () => number } {
  let polls = 0;
  let lastInm: string | undefined;
  const fetchImpl: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (url.endsWith("/user")) {
      return new Response(JSON.stringify(SCOPES.body), { status: 200, headers: SCOPES.headers }) as unknown as Response;
    }
    lastInm = headers["if-none-match"];
    polls++;
    // stable-304: the events list is unchanged, so a MATCHING If-None-Match returns 304 (real GH).
    // This is what makes FI-1 non-vacuous: if the cursor wrongly advances on a failed delivery, the
    // next poll's If-None-Match matches -> 304 -> the undelivered event is LOST.
    if (mode === "stable-304" && lastInm === 'W/"v1"') {
      return new Response(null, { status: 304, headers: { etag: 'W/"v1"' } }) as unknown as Response;
    }
    const etag = mode === "stable-304" ? 'W/"v1"' : `W/"v${polls}"`;
    return new Response(
      JSON.stringify([{ id: "evt-1", type: "PushEvent", payload: { ref: "refs/heads/main" }, created_at: "t" }]),
      { status: 200, headers: { etag, "x-ratelimit-remaining": "4999" } },
    ) as unknown as Response;
  };
  return { fetch: fetchImpl, ifNoneMatch: () => lastInm, polls: () => polls };
}

function pollSource(opts: { fetch: typeof fetch; sink: MessageSink; storage?: MemoryStorageProvider }): PollSource {
  return new PollSource({
    repos: ["owner/example"],
    token: "ghp_test",
    storage: opts.storage ?? new MemoryStorageProvider(),
    logger: silent,
    sleep: fastSleep,
    fetch: opts.fetch,
    sink: opts.sink,
  });
}

describe("bug-190 PR-2 — poll+deliver coupling gate", () => {
  it("FI-1: persistent sink failure leaves the cursor un-advanced; the event RE-DELIVERS next poll", async () => {
    const f = eventsFetch();
    // Fail every attempt of poll-1's single delivery (deliver does emitRetries+1 = 4 attempts),
    // then succeed.
    const rec = recordingSink(4);
    const source = pollSource({ fetch: f.fetch, sink: rec.sink });

    const first = await source.pollOnce("owner/example");
    expect(first.emitted).toBe(0); // delivery failed -> nothing delivered
    expect(rec.emitted).toHaveLength(0);
    expect(source.health().deliveryFailing).toBe(true);

    // Next poll: cursor was NOT advanced, so the event re-fetches + (now) delivers.
    const second = await source.pollOnce("owner/example");
    expect(second.emitted).toBe(1);
    expect(rec.emitted).toHaveLength(1); // re-delivered exactly once — never lost
    expect(rec.emitted[0]).toMatchObject({ kind: "repo-event" });
    expect(source.health().deliveryFailing).toBe(false);
  });

  it("FI-2: the poll/deliver loop SURVIVES repeated delivery failures (keeps polling, does not die)", async () => {
    const f = eventsFetch();
    const TARGET = 3;
    let resolveReached!: () => void;
    const reached = new Promise<void>((r) => (resolveReached = r));
    const failingSink: MessageSink = {
      async emit() {
        throw new Error("sink always fails");
      },
    };
    // Wrap the fetch to resolve once the loop has polled TARGET times despite every delivery failing.
    const base = f.fetch;
    const countingFetch: typeof fetch = async (input, init) => {
      const res = await base(input, init);
      if (String(input).includes("/events") && f.polls() >= TARGET) resolveReached();
      return res;
    };
    const source = pollSource({ fetch: countingFetch, sink: failingSink });
    await source.start();
    await reached; // hangs (times out = fail) if the loop dies after the first delivery failure
    await source.stop();
    expect(f.polls()).toBeGreaterThanOrEqual(TARGET);
    expect(source.health().deliveryFailing).toBe(true);
  });

  it("FI-3: health.deliveryFailing flips true on persistent failure, false on a delivered cycle", async () => {
    const f = eventsFetch();
    const rec = recordingSink(4); // fail poll-1, succeed after
    const source = pollSource({ fetch: f.fetch, sink: rec.sink });

    await source.pollOnce("owner/example");
    expect(source.health().deliveryFailing).toBe(true);
    expect(source.health().lastSuccessfulDelivery).toBeUndefined();

    await source.pollOnce("owner/example"); // re-fetch + deliver OK
    expect(source.health().deliveryFailing).toBe(false);
    expect(source.health().lastSuccessfulDelivery).toBeDefined();
  });

  it("M4: PollSource advances the etag cursor on an all-deduped 200 (re-fetch-storm guard)", async () => {
    const f = eventsFetch("new-etag"); // resource etag changes each poll (v1,v2,v3) — never 304
    const rec = recordingSink(0); // always delivers
    const source = pollSource({ fetch: f.fetch, sink: rec.sink });

    await source.pollOnce("owner/example"); // poll 1: delivers evt-1, advances to v1
    await source.pollOnce("owner/example"); // poll 2: evt-1 deduped (fresh=[]), MUST still advance to v2
    await source.pollOnce("owner/example"); // poll 3: sends If-None-Match
    // The cursor advanced on the all-deduped poll-2 -> poll-3's If-None-Match is the LATEST etag,
    // not the stale v1 (which would cause a re-fetch storm). polls 1/2/3 -> etags v1/v2/v3.
    expect(f.ifNoneMatch()).toBe('W/"v2"');
    expect(rec.emitted).toHaveLength(1); // evt-1 delivered exactly once
  });

  it("M2 (empty-result invariant): WorkflowRun-empty returns ok/0 — the empty path is benign", async () => {
    // DISCLOSED to the gate: the original "WorkflowRun-empty SKIPS filterUnseen" detail is
    // BEHAVIOURALLY BENIGN — `filterUnseen([])` short-circuits (a no-op) and the empty path is
    // side-effect-free, so routing empty through the events path stays green (NO observable
    // difference to pin non-vacuously; verified by that mutation passing). M4 is the load-bearing,
    // non-vacuous empty-result invariant (the re-fetch-storm guard); this guards the OBSERVABLE
    // empty contract (ok / 0-emitted) as a plain regression check.
    const emptyRunsFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/user")) {
        return new Response(JSON.stringify({ login: "x" }), { status: 200, headers: SCOPES.headers }) as unknown as Response;
      }
      return new Response(JSON.stringify({ total_count: 0, workflow_runs: [] }), { status: 200 }) as unknown as Response;
    };
    const source = new WorkflowRunPollSource({
      repos: ["r/r"],
      token: "t",
      storage: new MemoryStorageProvider(),
      logger: silent,
      sleep: fastSleep,
      fetch: emptyRunsFetch,
      now: () => Date.parse("2026-05-08T00:35:00Z"),
      sink: recordingSink(0).sink,
    });
    const r = await source.pollOnce("r/r");
    expect(r.outcome).toBe("ok");
    expect(r.emitted).toBe(0);
  });
});
