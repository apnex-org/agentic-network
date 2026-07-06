/**
 * idea-353 W2 — WorkLeaseTracker (outbound approaching-lease-expiry stall-prompt).
 *
 * Pins AC2: a held lease that crosses ~60% of its window without a renew is
 * surfaced as due for a renew/block/abandon prompt BEFORE the sweeper's hard
 * reap; a renew reopens the window + clears the latch; completing/abandoning/
 * releasing/blocking drops the lease entirely. Time is injected (no real clock).
 */

import { describe, it, expect } from "vitest";
import { WorkLeaseTracker } from "../../src/index.js";

const T0 = 1_700_000_000_000; // fixed epoch base (ms)
const TTL = 15 * 60_000; // 15-minute lease window

/** A claim/renew/start result envelope carrying a Hub-authored lease expiry. */
function leaseResult(workId: string, expiresAtMs: number) {
  return {
    workItem: {
      id: workId,
      lease: { holder: "agent-x", token: "tok", expiresAt: new Date(expiresAtMs).toISOString() },
    },
  };
}

describe("WorkLeaseTracker — idea-353 W2 outbound stall-prompt", () => {
  it("AC2: a held lease past ~60% of its window is due for a stall-prompt (before expiry)", () => {
    const t = new WorkLeaseTracker();
    t.observe("claim_work", { workId: "work-1" }, leaseResult("work-1", T0 + TTL), T0);
    expect(t.size()).toBe(1);
    // 50% through → not yet due.
    expect(t.dueForStallPrompt(T0 + 0.5 * TTL)).toEqual([]);
    // 65% through → due, with positive time-to-expiry.
    const due = t.dueForStallPrompt(T0 + 0.65 * TTL);
    expect(due.map((d) => d.workId)).toEqual(["work-1"]);
    expect(due[0].msUntilExpiry).toBeGreaterThan(0);
  });

  it("AC2: prompts at most once per window — markPrompted latches it", () => {
    const t = new WorkLeaseTracker();
    t.observe("claim_work", { workId: "work-1" }, leaseResult("work-1", T0 + TTL), T0);
    expect(t.dueForStallPrompt(T0 + 0.7 * TTL).length).toBe(1);
    t.markPrompted("work-1");
    expect(t.dueForStallPrompt(T0 + 0.8 * TTL)).toEqual([]); // latched for this window
  });

  it("AC2: a renew reopens the window + clears the latch (a renewing holder is not re-pestered)", () => {
    const t = new WorkLeaseTracker();
    t.observe("claim_work", { workId: "work-1" }, leaseResult("work-1", T0 + TTL), T0);
    t.markPrompted("work-1");
    // Renew at 70% → fresh window [renewAt, renewAt+TTL]; latch cleared.
    const renewAt = T0 + 0.7 * TTL;
    t.observe("renew_lease", { workId: "work-1" }, leaseResult("work-1", renewAt + TTL), renewAt);
    // Just after the renew → not due (fresh window).
    expect(t.dueForStallPrompt(renewAt + 0.1 * TTL)).toEqual([]);
    // 65% into the NEW window → due again.
    expect(t.dueForStallPrompt(renewAt + 0.65 * TTL).map((d) => d.workId)).toEqual(["work-1"]);
  });

  it("AC2: completing / abandoning / releasing / blocking the item drops it (no further prompt)", () => {
    for (const verb of ["complete_work", "abandon_work", "release_work", "block_work"]) {
      const t = new WorkLeaseTracker();
      t.observe("claim_work", { workId: "work-1" }, leaseResult("work-1", T0 + TTL), T0);
      expect(t.size()).toBe(1);
      t.observe(verb, { workId: "work-1" }, { workItem: { id: "work-1" } }, T0 + 60_000);
      expect(t.size()).toBe(0);
      expect(t.dueForStallPrompt(T0 + 0.8 * TTL)).toEqual([]);
    }
  });

  it("does not prompt once the lease has already expired (the gentle rung is BEFORE the reap)", () => {
    const t = new WorkLeaseTracker();
    t.observe("claim_work", { workId: "work-1" }, leaseResult("work-1", T0 + TTL), T0);
    expect(t.dueForStallPrompt(T0 + TTL + 1)).toEqual([]); // sweeper owns it past expiry
  });

  it("start_work refreshes the known expiry without resetting the window or the latch", () => {
    const t = new WorkLeaseTracker();
    t.observe("claim_work", { workId: "work-1" }, leaseResult("work-1", T0 + TTL), T0);
    t.markPrompted("work-1");
    // start_work observed mid-window — keeps windowStart=T0 + latch, so still suppressed.
    t.observe("start_work", { workId: "work-1" }, leaseResult("work-1", T0 + TTL), T0 + 0.3 * TTL);
    expect(t.dueForStallPrompt(T0 + 0.8 * TTL)).toEqual([]); // latch survived (not a renew)
  });

  it("ignores unparseable / non-lease tool results (best-effort)", () => {
    const t = new WorkLeaseTracker();
    t.observe("claim_work", { workId: "work-1" }, { error: "nope" }, T0); // no workItem.lease
    t.observe("list_ready_work", {}, { items: [] }, T0); // not a lease verb
    expect(t.size()).toBe(0);
  });
});

describe("WorkLeaseTracker — work-165 (idea-358) prune of expired leases", () => {
  it("prune() drops leases past expiry and returns the count", () => {
    const t = new WorkLeaseTracker();
    t.observe("claim_work", { workId: "work-1" }, leaseResult("work-1", T0 + TTL), T0);
    t.observe("claim_work", { workId: "work-2" }, leaseResult("work-2", T0 + 2 * TTL), T0);
    expect(t.size()).toBe(2);
    // At T0 + 1.5·TTL, work-1 (expiry T0+TTL) is past; work-2 (T0+2·TTL) is live.
    expect(t.prune(T0 + 1.5 * TTL)).toBe(1);
    expect(t.size()).toBe(1);
    expect(t.snapshot().map((l) => l.workId)).toEqual(["work-2"]);
  });

  it("observe() self-prunes: a reaped-but-unclosed lease never lingers to mis-report size()/snapshot()", () => {
    const t = new WorkLeaseTracker();
    t.observe("claim_work", { workId: "work-1" }, leaseResult("work-1", T0 + TTL), T0);
    // A later observation for a DIFFERENT item, after work-1 already expired, prunes work-1
    // (the holder never issued a close verb — the exact silent-reap this arc fixes).
    t.observe("claim_work", { workId: "work-2" }, leaseResult("work-2", T0 + 3 * TTL), T0 + 2 * TTL);
    expect(t.size()).toBe(1); // would have been 2 (stale "holding") without the prune
    expect(t.snapshot().map((l) => l.workId)).toEqual(["work-2"]);
  });

  it("prune() is a no-op when all leases are live", () => {
    const t = new WorkLeaseTracker();
    t.observe("claim_work", { workId: "work-1" }, leaseResult("work-1", T0 + TTL), T0);
    expect(t.prune(T0 + 0.5 * TTL)).toBe(0);
    expect(t.size()).toBe(1);
  });
});

describe("WorkLeaseTracker — work-164 (idea-395) auto-heartbeat renew candidates", () => {
  it("dueForRenew: a lease past the renew threshold surfaces WITH its token", () => {
    const t = new WorkLeaseTracker();
    t.observe("claim_work", { workId: "work-1" }, leaseResult("work-1", T0 + TTL), T0);
    // 40% through → not yet due (default threshold 0.5).
    expect(t.dueForRenew(T0 + 0.4 * TTL)).toEqual([]);
    // 55% through → due, carrying the Hub token for the host to renew with.
    const due = t.dueForRenew(T0 + 0.55 * TTL);
    expect(due.map((d) => d.workId)).toEqual(["work-1"]);
    expect(due[0].token).toBe("tok");
    expect(due[0].msUntilExpiry).toBeGreaterThan(0);
  });

  it("dueForRenew: a renew observe resets the window, so it's not due again until the next crossing", () => {
    const t = new WorkLeaseTracker();
    t.observe("claim_work", { workId: "work-1" }, leaseResult("work-1", T0 + TTL), T0);
    expect(t.dueForRenew(T0 + 0.6 * TTL).length).toBe(1); // due
    // Host auto-renewed → the fresh lease result flows back in, reopening the window at 0.6·TTL.
    t.observe("renew_lease", { workId: "work-1" }, leaseResult("work-1", T0 + 0.6 * TTL + TTL), T0 + 0.6 * TTL);
    expect(t.dueForRenew(T0 + 0.7 * TTL)).toEqual([]); // only 0.1·TTL into the new window → not due
    // ...and due again once the NEW window crosses the threshold.
    expect(t.dueForRenew(T0 + 0.6 * TTL + 0.6 * TTL).length).toBe(1);
  });

  it("dueForRenew: a lease with NO token is never a renew candidate (can't renew without it)", () => {
    const t = new WorkLeaseTracker();
    // A lease result carrying an expiry but no token.
    const noTokenResult = { workItem: { id: "work-1", lease: { holder: "a", expiresAt: new Date(T0 + TTL).toISOString() } } };
    t.observe("claim_work", { workId: "work-1" }, noTokenResult, T0);
    expect(t.size()).toBe(1); // still tracked (for the stall-prompt path)
    expect(t.dueForRenew(T0 + 0.9 * TTL)).toEqual([]); // but never auto-renewed
  });
});
