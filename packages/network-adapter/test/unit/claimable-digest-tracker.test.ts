/**
 * idea-353 W1 — ClaimableDigestTracker (inbound idle-wake, level-triggered).
 *
 * Pins the storm-proof + idle-gate decision contract that makes the queue's
 * idle-wake digest safe to ride the heartbeat tick:
 *   - AC1 inbound wake: a 0→N (or new-item) edge while idle emits.
 *   - AC3 idempotent / no-storm: steady N, re-tick, and a Hub-restart replay
 *     do NOT re-emit; only an upward edge fires (id-keyed, not count-keyed).
 *   - AC4 no-mid-task-interrupt: never emits while busy, and does not advance
 *     the baseline (so the first idle tick surfaces what appeared while busy).
 */

import { describe, it, expect } from "vitest";
import { ClaimableDigestTracker } from "../../src/index.js";

describe("ClaimableDigestTracker — idea-353 W1 inbound wake", () => {
  it("AC1: a 0→N edge while idle emits a digest wake", () => {
    const t = new ClaimableDigestTracker();
    const d = t.reconcile({ claimableIds: ["work-1", "work-2"], isIdle: true });
    expect(d.emit).toBe(true);
    expect(d.count).toBe(2);
    expect(d.newCount).toBe(2);
  });

  it("does not emit on an empty queue (no claimable work)", () => {
    const t = new ClaimableDigestTracker();
    const d = t.reconcile({ claimableIds: [], isIdle: true });
    expect(d.emit).toBe(false);
    expect(d.count).toBe(0);
  });

  it("AC3: a steady N>0 and a re-tick do NOT re-emit (idempotent / storm-proof)", () => {
    const t = new ClaimableDigestTracker();
    expect(t.reconcile({ claimableIds: ["work-1"], isIdle: true }).emit).toBe(true); // 0→N edge
    expect(t.reconcile({ claimableIds: ["work-1"], isIdle: true }).emit).toBe(false); // steady N
    expect(t.reconcile({ claimableIds: ["work-1"], isIdle: true }).emit).toBe(false); // re-tick
  });

  it("AC3: a Hub-restart replay (in-memory baseline survives, same set re-fed) does NOT re-emit", () => {
    const t = new ClaimableDigestTracker();
    expect(t.reconcile({ claimableIds: ["work-1", "work-2"], isIdle: true }).emit).toBe(true);
    // The adapter process (and this tracker) survive a Hub restart; the next
    // successful list_ready_work returns the same set → no replay wake.
    const replay = t.reconcile({ claimableIds: ["work-1", "work-2"], isIdle: true });
    expect(replay.emit).toBe(false);
    expect(replay.newCount).toBe(0);
  });

  it("re-emits only on a genuinely-new item (upward edge), not when items are claimed away", () => {
    const t = new ClaimableDigestTracker();
    expect(t.reconcile({ claimableIds: ["work-1"], isIdle: true }).emit).toBe(true);
    // work-1 claimed away → empty: no emit; baseline converges down.
    expect(t.reconcile({ claimableIds: [], isIdle: true }).emit).toBe(false);
    // a NEW item appears → upward edge → emit.
    const d = t.reconcile({ claimableIds: ["work-9"], isIdle: true });
    expect(d.emit).toBe(true);
    expect(d.newCount).toBe(1);
  });

  it("AC3: emits on a new id even when the COUNT is unchanged (id-keyed, not count-keyed)", () => {
    const t = new ClaimableDigestTracker();
    expect(t.reconcile({ claimableIds: ["work-1"], isIdle: true }).emit).toBe(true);
    // work-1 claimed, work-2 appears — same count of 1, but a new id → still edges.
    const d = t.reconcile({ claimableIds: ["work-2"], isIdle: true });
    expect(d.emit).toBe(true);
    expect(d.newCount).toBe(1);
  });

  it("AC4: never emits while the agent is mid-task, and does NOT advance the baseline", () => {
    const t = new ClaimableDigestTracker();
    // Items appear while busy → no interrupt; baseline untouched.
    const busy = t.reconcile({ claimableIds: ["work-1", "work-2"], isIdle: false });
    expect(busy.emit).toBe(false);
    expect(t.getSurfacedCount()).toBe(0);
    // The first idle tick then surfaces exactly what appeared during the busy window.
    const idle = t.reconcile({ claimableIds: ["work-1", "work-2"], isIdle: true });
    expect(idle.emit).toBe(true);
    expect(idle.newCount).toBe(2);
  });
});
