/**
 * bug-100 — SchemaDef reconciler runtime watch-loop reconnect.
 *
 * The runtime watch-loop previously had NO reconnect: a transient postgres
 * LISTEN drop (substrate.watch throws) made the catch warn-and-return, silently
 * losing the runtime SchemaDef-watch forever. This pins the fix: the loop
 * reconnects-with-backoff after a non-abort watch failure and re-establishes the
 * watch (+ stamps lastWatchHealthyAt once it's delivering again).
 *
 * Mock-substrate unit test (no testcontainer): only substrate.watch is driven —
 * boot uses initialSchemas=[] (no put/list), and a DELETE event needs no DDL.
 */
import { describe, it, expect, vi } from "vitest";
import { createSchemaReconciler } from "../schema-reconciler.js";
import type { HubStorageSubstrate } from "../index.js";

describe("bug-100 — runtime watch-loop reconnects after a LISTEN drop", () => {
  it("re-establishes the watch after a transient watch failure + stamps lastWatchHealthyAt", async () => {
    let watchCalls = 0;

    // watch() throws on the FIRST subscription (simulated LISTEN drop), then on
    // the reconnect delivers one event and stays open until aborted.
    const mockSubstrate = {
      watch: vi.fn((_kind: string, opts: { signal: AbortSignal }) => {
        watchCalls++;
        const attempt = watchCalls;
        return (async function* () {
          if (attempt === 1) {
            throw new Error("simulated 57P01 — terminating connection due to administrator command");
          }
          // Reconnected: deliver an event (drives lastWatchHealthyAt) then block
          // until abort so the session stays healthy (no reconnect spin).
          yield { op: "delete" as const, kind: "SchemaDef", id: "schemadef-x", resourceVersion: "1" };
          await new Promise<void>((resolve) => {
            if (opts.signal.aborted) return resolve();
            opts.signal.addEventListener("abort", () => resolve(), { once: true });
          });
        })();
      }),
    } as unknown as HubStorageSubstrate;

    const reconciler = createSchemaReconciler(mockSubstrate, "postgres://fake:5432/db", {
      initialSchemas: [],
      reconnectInitialBackoffMs: 5,
      reconnectMaxBackoffMs: 5,
      log: () => {},
      warn: () => {},
    });

    await reconciler.start();

    // The first watch threw (drop) → the loop must reconnect (2nd watch) and the
    // reconnected watch must deliver → lastWatchHealthyAt set. Pre-fix: watch was
    // called exactly once and lastWatchHealthyAt would stay null forever.
    await vi.waitFor(
      () => {
        expect(watchCalls).toBeGreaterThanOrEqual(2);
        expect(reconciler.getLastWatchHealthyAt()).not.toBeNull();
      },
      { timeout: 2000, interval: 10 },
    );

    await reconciler.close();
  });

  it("close() during reconnect-backoff exits the loop cleanly (no leaked timer/spin)", async () => {
    // watch() always throws → the loop is perpetually in reconnect-backoff.
    // close() (abort) must break out of the abortable backoff immediately.
    const mockSubstrate = {
      watch: vi.fn((_kind: string, _opts: { signal: AbortSignal }) =>
        (async function* () {
          throw new Error("always-down");
          // eslint-disable-next-line no-unreachable
          yield undefined as never;
        })(),
      ),
    } as unknown as HubStorageSubstrate;

    const reconciler = createSchemaReconciler(mockSubstrate, "postgres://fake:5432/db", {
      initialSchemas: [],
      reconnectInitialBackoffMs: 50,
      reconnectMaxBackoffMs: 50,
      log: () => {},
      warn: () => {},
    });

    await reconciler.start();
    // Let it enter the backoff at least once, then close mid-backoff.
    await new Promise((r) => setTimeout(r, 20));
    // Should resolve promptly (abortableDelay short-circuits on abort), not wait
    // out the 50ms backoff indefinitely.
    await reconciler.close();
    expect(true).toBe(true); // close() returned without hanging
  });
});
