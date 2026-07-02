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

  it("bug-100 — reconnect REPLAYS the gap: re-enters watch with sinceRevision=last-seen + a gap-written event is delivered post-reconnect", async () => {
    // The original gap (steve's work-33 finding): runtimeWatchSession re-entered
    // substrate.watch WITHOUT sinceRevision, so a reconnect live-tailed from
    // "now" — a SchemaDef change written during the prior-session-death →
    // new-LISTEN gap was silently missed. This drives a controlled reconnect and
    // proves the fix two ways: (1) the reconnect carries sinceRevision = the
    // last-seen rv (NOT undefined), and (2) the event written during the gap is
    // actually delivered + handled post-reconnect (not merely that resubscribe
    // happened). The mock stands in for the gap-free subscribe-before-replay
    // primitive (bug-187): given sinceRevision it replays the gap write.
    const sinceRevisions: (string | undefined)[] = [];
    let watchCalls = 0;
    const warn = vi.fn();

    const mockSubstrate = {
      watch: vi.fn((_kind: string, opts: { signal: AbortSignal; sinceRevision?: string }) => {
        watchCalls++;
        sinceRevisions.push(opts.sinceRevision);
        const attempt = watchCalls;
        return (async function* () {
          if (attempt === 1) {
            // Session 1 delivers a SchemaDef change (rv=5) → advances the
            // reconciler's cursor — then the LISTEN connection drops.
            yield { op: "delete" as const, kind: "SchemaDef", id: "schemadef-before-gap", resourceVersion: "5" };
            throw new Error("simulated 57P01 — terminating connection due to administrator command");
          }
          // Session 2 (reconnect): stands in for the gap-free primitive — given
          // sinceRevision=5 it REPLAYS the event written during the gap (rv=7).
          yield { op: "delete" as const, kind: "SchemaDef", id: "schemadef-gap-write", resourceVersion: "7" };
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
      warn,
    });

    await reconciler.start();

    await vi.waitFor(
      () => {
        // Reconnected (≥2 watch calls) AND the gap-written event was handled
        // post-reconnect (the delete handler warns with the event id).
        expect(watchCalls).toBeGreaterThanOrEqual(2);
        expect(warn.mock.calls.some((c) => String(c[0]).includes("schemadef-gap-write"))).toBe(true);
      },
      { timeout: 2000, interval: 10 },
    );

    // THE FIX: session 1 cold-tails (sinceRevision undefined); the RECONNECT
    // carries the cursor (= the last-seen rv "5"), so the primitive replays the
    // gap. Pre-fix this was undefined → live-tail from "now" → the rv=7 gap write
    // was missed until some later SchemaDef event happened to re-trigger.
    expect(sinceRevisions[0]).toBeUndefined();
    expect(sinceRevisions[1]).toBe("5");

    await reconciler.close();
  });

  it("bug-100 — boot-baseline: the FIRST session seeds sinceRevision from the high-water mark, so a reconnect BEFORE any event still replays from the baseline (not 'now')", async () => {
    // Closes the residual edge: the cursor was tracked from delivered events only,
    // so a reconnect before a session's first event live-tailed from "now". Boot
    // now seeds the cursor from substrate.list()'s snapshotRevision (substrate-wide
    // high-water mark), so EVERY session — the first and a reconnect-before-any-
    // event — carries a gap-free sinceRevision floor.
    const sinceRevisions: (string | undefined)[] = [];
    let watchCalls = 0;

    const mockSubstrate = {
      // The boot-baseline read — high-water mark rv=3.
      list: vi.fn(async () => ({ items: [], snapshotRevision: "3" })),
      watch: vi.fn((_kind: string, opts: { signal: AbortSignal; sinceRevision?: string }) => {
        watchCalls++;
        sinceRevisions.push(opts.sinceRevision);
        const attempt = watchCalls;
        return (async function* () {
          if (attempt === 1) {
            // Drop BEFORE delivering ANY event (the reconnect-before-first-event edge).
            throw new Error("simulated LISTEN drop before the first event");
          }
          // Session 2: deliver, then stay open until aborted.
          yield { op: "delete" as const, kind: "SchemaDef", id: "schemadef-y", resourceVersion: "9" };
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

    await vi.waitFor(
      () => { expect(watchCalls).toBeGreaterThanOrEqual(2); },
      { timeout: 2000, interval: 10 },
    );

    // Both the first session AND the reconnect-before-any-event carry the boot
    // baseline (rv=3) — NOT undefined (which would live-tail from "now" and miss a
    // write in the gap). This is the residual the boot-baseline seed closes.
    expect(sinceRevisions[0]).toBe("3");
    expect(sinceRevisions[1]).toBe("3");

    await reconciler.close();
  });

  it("work-41 (steve work-43): reconnects after a CLEAN (non-error, non-abort) iterator END — the generator RETURNS, not throws", async () => {
    // The other reconnect tests + the live-pg pg_terminate test all exercise the
    // THROW/error path (runtimeWatchSession's CATCH branch). But the work-41 fix's
    // PRIMARY path is a clean RETURN: the substrate watch's `ended` flag (set on a
    // non-abort LISTEN 'end' OR 'error') makes the generator `return`, NOT throw —
    // so the for-await ends WITHOUT throwing and runtimeWatchSession hits the
    // non-catch branch `return aborted ? "abort" : "reconnect"`. This pins that
    // branch directly at the reconciler level: a session whose generator CLEANLY
    // RETURNS (non-abort) must drive runtimeLoop to RECONNECT (not stop).
    let watchCalls = 0;
    const mockSubstrate = {
      list: vi.fn(async () => ({ items: [], snapshotRevision: "0" })),
      watch: vi.fn((_kind: string, opts: { signal: AbortSignal; sinceRevision?: string }) => {
        watchCalls++;
        const attempt = watchCalls;
        return (async function* () {
          if (attempt === 1) {
            // Deliver an event, then RETURN normally — NO throw, NO abort. This is
            // the clean non-abort iterator end (the work-41 ended-flag path).
            yield { op: "delete" as const, kind: "SchemaDef", id: "schemadef-clean-end", resourceVersion: "5" };
            return;
          }
          // Session 2 (the reconnect): stay open until aborted.
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

    // The clean iterator-END (attempt 1) must trigger a RECONNECT (attempt 2),
    // not a permanent stop. If runtimeWatchSession returned "abort" (or otherwise
    // failed to reconnect) on a clean non-abort end, watchCalls would stay 1 and
    // this waitFor would time out.
    await vi.waitFor(
      () => { expect(watchCalls).toBeGreaterThanOrEqual(2); },
      { timeout: 2000, interval: 10 },
    );

    await reconciler.close();
  });
});
