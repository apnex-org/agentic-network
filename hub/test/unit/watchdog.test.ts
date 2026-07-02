/**
 * Watchdog — bug-191 in-flight latch (audit-4103 idiom).
 *
 * The watchdog's periodic tick was a fire-and-forget setInterval with NO
 * in-flight latch: a tick slower than the interval overlapped the next, so two
 * ticks processed the SAME expired pending-action → attemptCount 0→1→2 in one
 * window (the CAS serializes the writes but re-applies the increment, not
 * idempotent) → premature demotion / spurious critical Director escalation /
 * duplicate audits + wakes. This pins the latch: while a tick is in flight, the
 * next interval is SKIPPED; once it settles, a fresh tick runs.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { Watchdog } from "../../src/policy/watchdog.js";
import type { AllStores } from "../../src/policy/types.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("Watchdog — bug-191 in-flight latch", () => {
  it("skips an overlapping tick while a prior tick is in flight, then resumes once it settles", async () => {
    // A controllable gate keeps the first tick parked inside listExpired so the
    // next intervals fire WHILE it is still in flight.
    let releaseFirstTick!: (items: unknown[]) => void;
    const gate = new Promise<unknown[]>((resolve) => { releaseFirstTick = resolve; });
    let listExpiredCalls = 0;

    const stores = {
      pendingAction: {
        listExpired: vi.fn(() => {
          listExpiredCalls += 1;
          // First call parks on the gate; subsequent calls (post-release) return [].
          return listExpiredCalls === 1 ? gate : Promise.resolve([]);
        }),
      },
    } as unknown as AllStores;

    const wd = new Watchdog({
      stores,
      tickIntervalMs: 50,
      wakeClient: async () => {},
      log: () => {},
    });

    vi.useFakeTimers();
    wd.start();

    // Fire ~4 intervals while the FIRST tick is still parked on the gate. The
    // latch must admit only ONE tick — the rest are skipped.
    await vi.advanceTimersByTimeAsync(220);
    expect(listExpiredCalls).toBe(1); // overlap suppressed (pre-fix: 5)

    // Release the first tick → it settles → inFlight clears → the next interval
    // runs a FRESH tick.
    releaseFirstTick([]);
    await vi.advanceTimersByTimeAsync(50);
    expect(listExpiredCalls).toBe(2); // latch released; a new tick ran

    wd.stop();
  });
});
