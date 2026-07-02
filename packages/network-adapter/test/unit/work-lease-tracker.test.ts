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
