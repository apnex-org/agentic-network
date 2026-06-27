/**
 * SlotGate unit tests (bug-171).
 *
 * Pins the bounded-concurrency invariants the McpTransport relies on to pace a
 * parallel read burst:
 *   - acquire under cap resolves immediately + increments in-flight
 *   - beyond cap, callers park (queued) and NEVER push in-flight over the cap
 *   - parked callers resume FIFO on release (direct hand-off, count unchanged)
 *   - release with no waiters decrements; never goes below zero
 *   - a full drain returns to zero in-flight
 */

import { describe, it, expect } from "vitest";
import { SlotGate } from "../../src/wire/slot-gate.js";

/** Flush macrotasks so any (incorrectly) resolved parked acquire would settle. */
function macrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SlotGate — bounded concurrency (bug-171)", () => {
  it("acquire under cap resolves immediately and increments in-flight", async () => {
    const g = new SlotGate(2);
    expect(g.inFlight).toBe(0);
    await g.acquire();
    expect(g.inFlight).toBe(1);
    await g.acquire();
    expect(g.inFlight).toBe(2);
    expect(g.queued).toBe(0);
  });

  it("beyond cap, callers queue and in-flight never exceeds the cap; release hands off FIFO", async () => {
    const g = new SlotGate(2);
    await g.acquire();
    await g.acquire(); // cap reached: inFlight=2

    const order: number[] = [];
    const p3 = g.acquire().then(() => order.push(3));
    const p4 = g.acquire().then(() => order.push(4));
    const p5 = g.acquire().then(() => order.push(5));

    // The three excess acquires must stay parked — not resolve.
    await macrotask();
    expect(g.inFlight).toBe(2); // still capped
    expect(g.queued).toBe(3);
    expect(order).toEqual([]);

    // Each release hands the slot directly to the next parked caller (FIFO);
    // in-flight stays pinned at the cap until the queue drains.
    g.release();
    await p3;
    expect(g.inFlight).toBe(2);
    expect(g.queued).toBe(2);

    g.release();
    await p4;
    g.release();
    await p5;
    expect(order).toEqual([3, 4, 5]); // FIFO
    expect(g.inFlight).toBe(2);
    expect(g.queued).toBe(0);
  });

  it("release with no waiters decrements; never goes below zero", async () => {
    const g = new SlotGate(2);
    await g.acquire();
    expect(g.inFlight).toBe(1);
    g.release();
    expect(g.inFlight).toBe(0);
    g.release(); // no holders, no waiters — guarded no-op
    expect(g.inFlight).toBe(0);
  });

  it("a full burst drains back to zero in-flight (cap=1 serializes)", async () => {
    const g = new SlotGate(1);
    await g.acquire();
    const p2 = g.acquire();
    const p3 = g.acquire();
    expect(g.inFlight).toBe(1);
    expect(g.queued).toBe(2);

    g.release();
    await p2;
    expect(g.inFlight).toBe(1);
    expect(g.queued).toBe(1);

    g.release();
    await p3;
    expect(g.inFlight).toBe(1);
    expect(g.queued).toBe(0);

    g.release();
    expect(g.inFlight).toBe(0);
  });
});
