/**
 * bare-envelope-escalation.test.ts — C3-R4b piece 2, the shared isolation-catch
 * escalation. Verifies: a BareEnvelopeError escalates (ERROR + queryable audit +
 * metric, returns true); any other error is inert (returns false → caller keeps
 * its transient path); audit-write failure is non-fatal.
 */
import { describe, it, expect, vi } from "vitest";
import {
  escalateBareEnvelope,
  BARE_ENVELOPE_AUDIT_ACTION,
  BARE_ENVELOPE_METRIC_BUCKET,
} from "../bare-envelope-escalation.js";
import { BareEnvelopeError } from "../../storage-substrate/bare-envelope-error.js";

function deps() {
  const audit = { logEntry: vi.fn(async () => ({}) as never) };
  const metrics = { increment: vi.fn() };
  const logger = { error: vi.fn(), warn: vi.fn() };
  return { audit, metrics, logger };
}

describe("escalateBareEnvelope", () => {
  it("escalates a BareEnvelopeError: ERROR + queryable audit + metric, returns true", async () => {
    const d = deps();
    const escalated = await escalateBareEnvelope(
      new BareEnvelopeError("Idea", "idea-7"),
      { sweeper: "cascade-replay", entityRef: "thread-9" },
      d,
    );
    expect(escalated).toBe(true);
    expect(d.logger.error).toHaveBeenCalledTimes(1);
    expect(d.metrics.increment).toHaveBeenCalledWith(
      BARE_ENVELOPE_METRIC_BUCKET,
      expect.objectContaining({ sweeper: "cascade-replay", kind: "Idea", entityId: "idea-7" }),
    );
    expect(d.audit.logEntry).toHaveBeenCalledWith(
      "hub",
      BARE_ENVELOPE_AUDIT_ACTION,
      expect.stringContaining("0-bare-violation"),
      "idea-7", // entityId is the audit relatedEntity (falls back to entityRef)
    );
  });

  it("is inert for a non-BareEnvelopeError: returns false, no audit/metric/error", async () => {
    const d = deps();
    const escalated = await escalateBareEnvelope(
      new Error("transient db blip"),
      { sweeper: "cascade-replay", entityRef: "thread-9" },
      d,
    );
    expect(escalated).toBe(false);
    expect(d.logger.error).not.toHaveBeenCalled();
    expect(d.metrics.increment).not.toHaveBeenCalled();
    expect(d.audit.logEntry).not.toHaveBeenCalled();
  });

  it("audit-write failure is non-fatal: still returns true + emits the audit_failed metric", async () => {
    const d = deps();
    d.audit.logEntry = vi.fn(async () => {
      throw new Error("audit store down");
    });
    const escalated = await escalateBareEnvelope(
      new BareEnvelopeError("Thread"),
      { sweeper: "message-projection", entityRef: "thread-3" },
      d,
    );
    expect(escalated).toBe(true);
    expect(d.metrics.increment).toHaveBeenCalledWith(
      `${BARE_ENVELOPE_METRIC_BUCKET}.audit_failed`,
      expect.objectContaining({ sweeper: "message-projection" }),
    );
  });

  it("falls back to warn when the logger has no error method", async () => {
    const audit = { logEntry: vi.fn(async () => ({}) as never) };
    const metrics = { increment: vi.fn() };
    const logger = { warn: vi.fn() }; // no .error
    const escalated = await escalateBareEnvelope(
      new BareEnvelopeError("Bug", "bug-2"),
      { sweeper: "scheduled-message", entityRef: "msg-1" },
      { audit, metrics, logger },
    );
    expect(escalated).toBe(true);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
