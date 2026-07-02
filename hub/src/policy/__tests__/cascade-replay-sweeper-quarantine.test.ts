/**
 * cascade-replay-sweeper-quarantine.test.ts — C3-R4b piece 2, the DECISIVE
 * cal-84 fix. A structural bare-envelope thrown anywhere inside a per-thread
 * replay must:
 *   - escalate loud + queryable (a bare_envelope_violation audit entry),
 *   - TERMINAL-QUARANTINE the thread (markCascadeFailed → status cascade_failed,
 *     which listCascadePending excludes) — NOT preserve-the-marker-and-retry,
 *   - CONTINUE the sweep so the other valid threads still replay.
 * A TRANSIENT (non-bare) error keeps the existing isolation (preserve marker).
 *
 * The BareEnvelopeError is injected via a thread-store decode op the replay
 * awaits (markCascadeCompleted on the no-committed-actions path) — a faithful
 * stand-in for "a decode threw during replay", store-controlled so the test does
 * not depend on runCascade internals or ESM module-mock binding.
 */
import { describe, it, expect, vi } from "vitest";
import {
  CascadeReplaySweeper,
  type CascadeReplayContextProvider,
} from "../cascade-replay-sweeper.js";
import { BareEnvelopeError } from "../../storage-substrate/bare-envelope-error.js";
import type { IThreadStore, IAuditStore } from "../../state.js";
import type { IPolicyContext } from "../types.js";

// Empty convergenceActions → replayThread takes the "no actions to replay" path
// and awaits markCascadeCompleted(thread.id), our injection point.
function makeThread(id: string) {
  return { id, convergenceActions: [], summary: "test summary" };
}

const ctxProvider: CascadeReplayContextProvider = {
  forSweeper: () => ({ metrics: { increment: () => {} } }) as unknown as IPolicyContext,
};

const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };

describe("CascadeReplaySweeper — structural 0-bare quarantine (cal-84)", () => {
  it("quarantines the bare thread (markCascadeFailed + audit) and CONTINUES the healthy one", async () => {
    const markCascadeFailed = vi.fn(async () => true);
    const markCascadeCompleted = vi.fn(async (id: string) => {
      if (id === "thread-bad") throw new BareEnvelopeError("Idea", "idea-99");
      return true;
    });
    const store = {
      markCascadeFailed,
      markCascadeCompleted,
      listCascadePending: vi.fn(async () => [makeThread("thread-bad"), makeThread("thread-good")]),
    };
    const audit = { logEntry: vi.fn(async () => ({}) as never) };

    const sweeper = new CascadeReplaySweeper(
      store as unknown as IThreadStore,
      ctxProvider,
      { audit: audit as unknown as IAuditStore, logger: silentLogger },
    );

    const result = await sweeper.fullSweep();

    expect(result.scanned).toBe(2);
    expect(result.quarantined).toBe(1);
    expect(result.replayed).toBe(1);
    expect(result.errors).toBe(0);
    // The bare thread is TERMINAL-quarantined, NOT preserve-for-retry.
    expect(markCascadeFailed).toHaveBeenCalledWith("thread-bad");
    expect(markCascadeFailed).not.toHaveBeenCalledWith("thread-good");
    // The healthy thread still replayed (continue-sweep).
    expect(markCascadeCompleted).toHaveBeenCalledWith("thread-good");
    // First-class queryable signal fired for the violation.
    expect(audit.logEntry).toHaveBeenCalledWith(
      "hub",
      "bare_envelope_violation",
      expect.any(String),
      "idea-99",
    );
  });

  it("a TRANSIENT (non-bare) replay error preserves the marker — no quarantine", async () => {
    const markCascadeFailed = vi.fn(async () => true);
    const markCascadeCompleted = vi.fn(async () => {
      throw new Error("transient db blip");
    });
    const store = {
      markCascadeFailed,
      markCascadeCompleted,
      listCascadePending: vi.fn(async () => [makeThread("thread-x")]),
    };

    const sweeper = new CascadeReplaySweeper(store as unknown as IThreadStore, ctxProvider, {
      logger: silentLogger,
    });

    const result = await sweeper.fullSweep();

    expect(result.errors).toBe(1);
    expect(result.quarantined).toBe(0);
    // Marker preserved (NOT quarantined) — next Hub-startup retries the transient.
    expect(markCascadeFailed).not.toHaveBeenCalled();
  });

  it("escalates a structural bare-envelope thrown by the listCascadePending decode (skip-cycle)", async () => {
    const store = {
      markCascadeFailed: vi.fn(async () => true),
      markCascadeCompleted: vi.fn(async () => true),
      listCascadePending: vi.fn(async () => {
        throw new BareEnvelopeError("Thread", "thread-bare");
      }),
    };
    const audit = { logEntry: vi.fn(async () => ({}) as never) };

    const sweeper = new CascadeReplaySweeper(
      store as unknown as IThreadStore,
      ctxProvider,
      { audit: audit as unknown as IAuditStore, logger: silentLogger },
    );

    const result = await sweeper.fullSweep();

    expect(result.quarantined).toBe(1);
    expect(result.scanned).toBe(0);
    expect(audit.logEntry).toHaveBeenCalledWith(
      "hub",
      "bare_envelope_violation",
      expect.any(String),
      "thread-bare",
    );
  });
});
