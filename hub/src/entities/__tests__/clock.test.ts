import { describe, it, expect } from "vitest";
import { VirtualClock, systemClock } from "../clock.js";

/**
 * clock.test.ts — the idea-449 VirtualClock unit (the substrate injection + the get_now
 * read-verb are exercised end-to-end, with a VirtualClock, by the @apnex/workgraph-sim
 * determinism oracle). Here we prove the clock primitive itself: system time advances,
 * virtual time is frozen + reproducible.
 */
describe("Clock (idea-449 VirtualClock + idea-525)", () => {
  it("systemClock returns real wall time (non-decreasing across reads)", async () => {
    const a = systemClock.now().getTime();
    await new Promise((r) => setTimeout(r, 2));
    expect(systemClock.now().getTime()).toBeGreaterThanOrEqual(a);
  });

  it("VirtualClock is frozen until advanced/set — repeated reads are identical", () => {
    const c = new VirtualClock(1_000);
    expect(c.now().getTime()).toBe(1_000);
    expect(c.nowMs()).toBe(1_000);
    // Time never moves on its own: two reads with no mutation are byte-identical.
    expect(c.now().toISOString()).toBe(c.now().toISOString());
  });

  it("advance + set move the virtual clock deterministically", () => {
    const c = new VirtualClock(1_000);
    c.advance(500);
    expect(c.nowMs()).toBe(1_500);
    c.advance(500);
    expect(c.nowMs()).toBe(2_000);
    c.set(9_000);
    expect(c.now().getTime()).toBe(9_000);
  });

  it("two VirtualClocks at the same start yield byte-identical timestamps", () => {
    const a = new VirtualClock(1_700_000_000_000);
    const b = new VirtualClock(1_700_000_000_000);
    expect(a.now().toISOString()).toBe(b.now().toISOString());
    a.advance(1234);
    b.advance(1234);
    expect(a.now().toISOString()).toBe(b.now().toISOString());
  });

  it("VirtualClock default start is the epoch", () => {
    expect(new VirtualClock().now().toISOString()).toBe("1970-01-01T00:00:00.000Z");
  });
});
