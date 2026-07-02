/**
 * poll-backstop-jitter.test.ts — mission-99 slice (c) / F2 anti-stampede jitter.
 *
 * Layer:  L1b (network-adapter/src/kernel/poll-backstop.ts)
 * Spec:   docs/designs/m-swarm-footer/ratified-spec.md §6 (anti-stampede) + §14 gate 7.
 *
 * Proves (A3 Local Reasoning — pure jitter fn + fake-clock timer behaviour, no
 * live Hub):
 *   - jitter() bounds: result ∈ [base·0.8, base·1.2), clamped ≥1ms.
 *   - jitter() re-rolls per call (a fresh factor each cycle, not frozen).
 *   - NO synchronized poll BURST: under a shared fake clock, N agents with
 *     distinct RNGs fire on DISTINCT ticks (desynchronized phases) — the whole
 *     point of the ±20% jitter (spec §6). A fixed setInterval would fire them all
 *     on the same tick (the stampede this slice removes).
 *   - Average cadence preserved: symmetric jitter keeps the mean at the base
 *     cadence (so the mission-75 TTL margin + anti-pattern guard still hold).
 *   - backoff-on-error preserved: the heartbeat's retry semantics are untouched.
 *   - stop() is a hard stop: no reschedule fires after stop() (the self-
 *     rescheduling setTimeout loop's stop-race guard).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { PollBackstop, jitter, JITTER_FRACTION } from "../../src/index.js";
import type { IAgentClient } from "../../src/index.js";

function fakeStreamingAgent(
  callImpl: (m: string, p: Record<string, unknown>) => unknown = () => ({ messages: [], count: 0 }),
): IAgentClient {
  return {
    state: "streaming" as const,
    isConnected: true,
    call: vi.fn(async (m: string, p: Record<string, unknown>) => callImpl(m, p)) as IAgentClient["call"],
    start: vi.fn(),
    stop: vi.fn(),
    setCallbacks: vi.fn(),
    listMethods: vi.fn().mockResolvedValue([]),
    getSessionId: () => "test-session",
    getMetrics: () => ({
      sessionState: "streaming",
      agentId: "eng-test",
      sessionEpoch: 1,
      totalHandshakes: 1,
      totalSessionInvalidRetries: 0,
      dedupDropCount: 0,
    }),
    getTransport: () => undefined,
  } as unknown as IAgentClient;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("jitter() — bounds + distribution (spec §6)", () => {
  it("stays within [base·(1-f), base·(1+f)) for the full RNG range", () => {
    const base = 30_000;
    // rand=0 → lower bound; rand→1 → approaches upper bound.
    expect(jitter(base, JITTER_FRACTION, () => 0)).toBe(Math.round(base * 0.8));
    expect(jitter(base, JITTER_FRACTION, () => 0.5)).toBe(base); // midpoint = base
    // Upper bound is inclusive after Math.round (0.999999·2-1 ≈ 1.2 → rounds to base·1.2).
    expect(jitter(base, JITTER_FRACTION, () => 0.999999)).toBeLessThanOrEqual(base * 1.2);
    expect(jitter(base, JITTER_FRACTION, () => 0.999999)).toBeGreaterThan(base * 1.19);
  });

  it("clamps to ≥1ms (never a zero/negative delay)", () => {
    expect(jitter(1, 0.99, () => 0)).toBeGreaterThanOrEqual(1);
    expect(jitter(0, 0.2, () => 0)).toBe(1);
  });

  it("re-rolls per call — a fresh factor each cycle (not frozen)", () => {
    const seq = [0.1, 0.9, 0.5, 0.0];
    let i = 0;
    const rand = () => seq[i++ % seq.length];
    const base = 30_000;
    const results = [jitter(base, JITTER_FRACTION, rand), jitter(base, JITTER_FRACTION, rand), jitter(base, JITTER_FRACTION, rand)];
    // Three distinct factors → three distinct delays (proves not frozen).
    expect(new Set(results).size).toBe(3);
  });

  it("average cadence preserved: symmetric jitter means ≈ base over many rolls", () => {
    const base = 30_000;
    let sum = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) sum += jitter(base, JITTER_FRACTION); // real Math.random
    const mean = sum / N;
    // Within 2% of base — the mean must not drift (TTL-margin safety).
    expect(Math.abs(mean - base) / base).toBeLessThan(0.02);
  });
});

describe("no synchronized poll BURST under a shared fake clock (gate 7)", () => {
  it("N agents with distinct RNGs fire their FIRST poll on DISTINCT ticks", () => {
    vi.useFakeTimers();
    const cadenceSeconds = 60; // 60s floor
    const baseMs = cadenceSeconds * 1000;

    // Three agents, each with a distinct deterministic RNG → distinct jitter →
    // distinct first-fire delay. (A fixed setInterval would fire all at baseMs.)
    const rngs = [() => 0.1, () => 0.5, () => 0.9];
    const fireTicks: number[] = [];
    const backstops = rngs.map((random, idx) => {
      const bs = new PollBackstop({
        role: "engineer",
        cadenceSeconds,
        firstTimerEnabled: true,
        heartbeatEnabled: false,
        random,
        onPolledMessage: () => {},
      });
      // Wrap tick to record WHEN (fake-clock ms) each agent polls.
      const orig = bs.tick.bind(bs);
      vi.spyOn(bs, "tick").mockImplementation(async (getAgent) => {
        fireTicks[idx] = Date.now();
        return orig(getAgent);
      });
      return bs;
    });

    const t0 = Date.now();
    const agent = fakeStreamingAgent();
    backstops.forEach((bs) => bs.start(() => agent));

    // Advance to just past the max jittered delay (baseMs·1.2).
    vi.advanceTimersByTime(baseMs * 1.25);
    backstops.forEach((bs) => bs.stop());

    // Each agent fired once, at its OWN jittered offset (all distinct).
    expect(fireTicks.filter((t) => t !== undefined)).toHaveLength(3);
    const offsets = fireTicks.map((t) => t - t0);
    // Distinct phases (desynchronized) — the anti-stampede property.
    expect(new Set(offsets).size).toBe(3);
    // Each within the ±20% window around base.
    for (const off of offsets) {
      expect(off).toBeGreaterThanOrEqual(baseMs * 0.8 - 1);
      expect(off).toBeLessThan(baseMs * 1.2 + 1);
    }
  });

  it("a lower-jitter and higher-jitter agent do NOT collide on the same tick", () => {
    vi.useFakeTimers();
    const cadenceSeconds = 60;
    const baseMs = cadenceSeconds * 1000;
    const early = new PollBackstop({ role: "engineer", cadenceSeconds, firstTimerEnabled: true, heartbeatEnabled: false, random: () => 0.0, onPolledMessage: () => {} });
    const late = new PollBackstop({ role: "engineer", cadenceSeconds, firstTimerEnabled: true, heartbeatEnabled: false, random: () => 0.999999, onPolledMessage: () => {} });
    const earlyTick = vi.spyOn(early, "tick").mockResolvedValue(undefined);
    const lateTick = vi.spyOn(late, "tick").mockResolvedValue(undefined);
    const agent = fakeStreamingAgent();
    early.start(() => agent);
    late.start(() => agent);

    // Advance only to the EARLY agent's fire window (base·0.8) + a hair.
    vi.advanceTimersByTime(baseMs * 0.8 + 5);
    expect(earlyTick).toHaveBeenCalledTimes(1);
    expect(lateTick).not.toHaveBeenCalled(); // late agent has NOT fired yet → no burst

    // Advance to the LATE agent's window.
    vi.advanceTimersByTime(baseMs * 0.4);
    expect(lateTick).toHaveBeenCalledTimes(1);
    early.stop();
    late.stop();
  });
});

describe("self-rescheduling loop lifecycle", () => {
  it("keeps polling on subsequent cycles (re-arms after each tick)", async () => {
    vi.useFakeTimers();
    const bs = new PollBackstop({ role: "engineer", cadenceSeconds: 60, firstTimerEnabled: true, heartbeatEnabled: false, random: () => 0.5, onPolledMessage: () => {} });
    const tickSpy = vi.spyOn(bs, "tick").mockResolvedValue(undefined);
    const agent = fakeStreamingAgent();
    bs.start(() => agent);
    await vi.advanceTimersByTimeAsync(60_000); // cycle 1 (midpoint jitter = base)
    await vi.advanceTimersByTimeAsync(60_000); // cycle 2
    await vi.advanceTimersByTimeAsync(60_000); // cycle 3
    expect(tickSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    bs.stop();
  });

  it("stop() is a HARD stop — no reschedule fires afterwards", async () => {
    vi.useFakeTimers();
    const bs = new PollBackstop({ role: "engineer", cadenceSeconds: 60, firstTimerEnabled: true, heartbeatEnabled: false, random: () => 0.5, onPolledMessage: () => {} });
    const tickSpy = vi.spyOn(bs, "tick").mockResolvedValue(undefined);
    const agent = fakeStreamingAgent();
    bs.start(() => agent);
    await vi.advanceTimersByTimeAsync(60_000);
    const countAtStop = tickSpy.mock.calls.length;
    bs.stop();
    await vi.advanceTimersByTimeAsync(60_000 * 5);
    expect(tickSpy.mock.calls.length).toBe(countAtStop); // no further ticks
  });

  it("start() is idempotent (double-start does not double-schedule)", async () => {
    vi.useFakeTimers();
    const bs = new PollBackstop({ role: "engineer", cadenceSeconds: 60, firstTimerEnabled: true, heartbeatEnabled: false, random: () => 0.5, onPolledMessage: () => {} });
    const tickSpy = vi.spyOn(bs, "tick").mockResolvedValue(undefined);
    const agent = fakeStreamingAgent();
    bs.start(() => agent);
    bs.start(() => agent); // second start — must be a no-op
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tickSpy).toHaveBeenCalledTimes(1); // NOT 2 (no duplicate loop)
    bs.stop();
  });
});

describe("backoff-on-error preserved (heartbeat retry semantics untouched)", () => {
  it("heartbeat retries once with backoff before skipping the cycle", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const agent = fakeStreamingAgent((method) => {
      if (method === "transport_heartbeat") {
        calls++;
        throw new Error("transient");
      }
      return { messages: [], count: 0 };
    });
    const bs = new PollBackstop({
      role: "engineer",
      firstTimerEnabled: false,
      heartbeatEnabled: true,
      heartbeatIntervalMs: 30_000,
      random: () => 0.5,
    });
    bs.start(() => agent);
    // First heartbeat fires at ~30s (jitter midpoint = base).
    await vi.advanceTimersByTimeAsync(30_000);
    // The 5s backoff retry then fires a SECOND attempt (retry preserved).
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toBe(2); // initial + one retry = the preserved backoff semantics
    bs.stop();
  });
});
