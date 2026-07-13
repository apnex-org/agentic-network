/**
 * dispatch-transient-drop.test.ts — bug-252 regression: retry-with-backoff on a
 * TRANSIENT Hub-wire drop at the runToolDispatch not-connected pre-check. Proves the
 * self-recovering "Hub not connected"/"Connection closed" drops (git/PR side
 * unaffected, retry-after-wait lands clean) no longer surface as an immediate error —
 * while keeping the idempotency boundary (a MID-FLIGHT drop is NOT retried) and the
 * opt-out (undefined config = today's byte-identical behavior).
 */
import { describe, it, expect } from "vitest";
import {
  runToolDispatch,
  DEFAULT_TRANSIENT_DROP_RETRY,
  type ToolDispatchContext,
  type TransientDropRetryConfig,
} from "../../src/tool-manager/dispatch/dispatch.js";
import type { IToolDispatchAgent } from "../../src/tool-manager/contracts.js";
import { WorkLeaseTracker } from "../../src/tool-manager/work-protocol/work-lease-tracker.js";

/** getAgent() answers per successive call: true=usable, false=disconnected, null=absent. */
function harness(opts: {
  sequence: Array<true | false | null>;
  retry?: TransientDropRetryConfig;
  callImpl?: (method: string, args: Record<string, unknown>) => Promise<unknown>;
}) {
  const logs: string[] = [];
  const delays: number[] = [];
  const calls: string[] = [];
  let idx = 0;

  const makeAgent = (connected: boolean): IToolDispatchAgent => ({
    state: connected ? "streaming" : "disconnected",
    isConnected: connected,
    call: async (method, args) => {
      calls.push(method);
      if (opts.callImpl) return opts.callImpl(method, args);
      return { ok: true, method };
    },
    listTools: async () => [],
  });

  const getAgent = (): IToolDispatchAgent | null => {
    const v = opts.sequence[Math.min(idx, opts.sequence.length - 1)];
    idx++;
    if (v === true) return makeAgent(true);
    if (v === false) return makeAgent(false);
    return null;
  };

  const ctx: ToolDispatchContext = {
    getAgent,
    pendingActionMap: new Map(),
    workLeases: new WorkLeaseTracker(),
    onCallStart: () => {},
    onCallEnd: () => {},
    log: (m) => logs.push(m),
    sleep: async (ms) => {
      delays.push(ms);
    },
    transientDropRetry: opts.retry,
  };
  return { ctx, logs, delays, calls };
}

const FAST: TransientDropRetryConfig = { maxRetries: 4, baseDelayMs: 10, maxDelayMs: 40 };

describe("runToolDispatch — bug-252 transient-drop retry", () => {
  it("RECOVERS: retries with backoff while disconnected, then dispatches on reconnect", async () => {
    // pre-check null, retry-1 null, retry-2 usable → recovers on the 2nd retry.
    const h = harness({ sequence: [null, null, true], retry: FAST });
    const res = await runToolDispatch(h.ctx, "get_bug", { bugId: "b1" });

    expect(res.isError).toBeFalsy(); // dispatched, not the Hub-not-connected error
    expect(res.content[0].text).toContain('"ok": true');
    expect(h.calls).toContain("get_bug"); // the real dispatch happened
    expect(h.delays).toEqual([10, 20]); // exponential backoff, 2 retries
    expect(h.logs.some((l) => /transient-drop RECOVERED .* retry 2\/4/.test(l))).toBe(true);
  });

  it("EXHAUSTS fail-closed: still disconnected after the budget → Hub-not-connected + surfaced signal", async () => {
    const h = harness({ sequence: [null], retry: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 40 } });
    const res = await runToolDispatch(h.ctx, "get_bug", {});

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Hub not connected");
    expect(h.delays.length).toBe(3); // tried the full budget
    expect(h.calls).not.toContain("get_bug"); // never dispatched (nothing sent)
    expect(h.logs.some((l) => /transient-drop UNRECOVERED .* after 3 retries/.test(l))).toBe(true);
  });

  it("DISABLED (undefined config) = today's byte-identical immediate error, no backoff", async () => {
    const h = harness({ sequence: [null] }); // no retry config
    const res = await runToolDispatch(h.ctx, "get_bug", {});

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Hub not connected");
    expect(h.delays).toEqual([]); // never slept
    expect(h.logs.some((l) => l.includes("transient-drop"))).toBe(false); // no retry signal
  });

  it("maxRetries:0 also disables (explicit opt-out)", async () => {
    const h = harness({ sequence: [null], retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 40 } });
    const res = await runToolDispatch(h.ctx, "get_bug", {});
    expect(res.isError).toBe(true);
    expect(h.delays).toEqual([]);
  });

  it("IDEMPOTENCY BOUNDARY: a MID-FLIGHT drop (agent.call throws) is NOT retried", async () => {
    // Connected at the pre-check, but the wire drops mid-call. The write may have
    // partially applied → we must NOT retry it; surface the error, call exactly once.
    const h = harness({
      sequence: [true],
      retry: FAST,
      callImpl: async (method) => {
        if (method === "create_message") throw new Error("Connection closed");
        return { ok: true }; // signal_working_* succeed
      },
    });
    const res = await runToolDispatch(h.ctx, "create_message", { body: "x" });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Connection closed");
    // exactly ONE dispatch attempt of the mutating tool — no retry.
    expect(h.calls.filter((c) => c === "create_message").length).toBe(1);
    expect(h.delays).toEqual([]); // the retry path is pre-check-only, not the catch
  });

  it("DEFAULT_TRANSIENT_DROP_RETRY is a bounded fleet default", () => {
    expect(DEFAULT_TRANSIENT_DROP_RETRY.maxRetries).toBeGreaterThan(0);
    expect(DEFAULT_TRANSIENT_DROP_RETRY.baseDelayMs).toBeGreaterThan(0);
    expect(DEFAULT_TRANSIENT_DROP_RETRY.maxDelayMs).toBeGreaterThanOrEqual(
      DEFAULT_TRANSIENT_DROP_RETRY.baseDelayMs,
    );
  });
});
