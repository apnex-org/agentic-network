import { describe, expect, it } from "vitest";
import {
  computeReconnectSyncJitter,
  performStateSync,
} from "../../src/kernel/state-sync.js";
import { LogCapture } from "../helpers/test-utils.js";

describe("bug-343 reconnect state-sync admission", () => {
  it("computes stable bounded per-agent jitter with fleet spread", () => {
    const max = 1000;
    const names = ["alex", "blair", "casey", "drew", "greg", "ruby", "steve"];
    const values = names.map((name) => computeReconnectSyncJitter(name, max));
    expect(values.every((v) => v >= 0 && v <= max)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(4);
    expect(computeReconnectSyncJitter("drew", max)).toBe(computeReconnectSyncJitter("drew", max));
    expect(computeReconnectSyncJitter("drew", 0)).toBe(0);
  });

  it("waits once and admits state-sync RPCs sequentially", async () => {
    const log = new LogCapture();
    const calls: string[] = [];
    const sleeps: number[] = [];
    let active = 0;
    let maxActive = 0;
    let completed = false;

    await performStateSync({
      role: "architect",
      log: log.logger,
      admissionDelayMs: 37,
      sleep: async (ms) => { sleeps.push(ms); },
      completeSync: () => { completed = true; },
      executeTool: async (name) => {
        active++;
        maxActive = Math.max(maxActive, active);
        calls.push(name);
        await Promise.resolve();
        active--;
        if (name === "get_pending_actions") return { totalPending: 0 };
        if (name === "drain_pending_actions") return { items: [] };
        return { now: "1970-01-01T00:00:00.000Z", epochMs: 0 };
      },
    });

    expect(sleeps).toEqual([37]);
    expect(calls).toEqual(["get_now", "get_pending_actions", "drain_pending_actions"]);
    expect(maxActive).toBe(1);
    expect(completed).toBe(true);
  });

  it("logs an incomplete aggregate loudly instead of coercing null totalPending to zero", async () => {
    const log = new LogCapture();

    await performStateSync({
      role: "architect",
      log: log.logger,
      completeSync: () => {},
      executeTool: async (name) => {
        if (name === "get_pending_actions") {
          return {
            totalPending: null,
            visiblePending: null,
            truncated: true,
            retrieval: {
              complete: false,
              truncated: true,
              reason: "aggregate_snapshot_retry_exhausted",
            },
          };
        }
        if (name === "drain_pending_actions") return { items: [] };
        return { now: "1970-01-01T00:00:00.000Z", epochMs: 0 };
      },
    });

    expect(log.has("INCOMPLETE — visible=unknown; reason=aggregate_snapshot_retry_exhausted")).toBe(true);
    expect(log.has("Pending actions: 0")).toBe(false);
  });
});
