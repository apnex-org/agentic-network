/**
 * bare-envelope-escalation.ts — C3-R4b piece 2 (cal-84 closure), the
 * isolation-catch escalation shared by the three startup/periodic sweepers
 * (cascade-replay, scheduled-message, message-projection).
 *
 * cal-84 was the SILENT-degrade class: a sweeper's per-item try/catch swallowed
 * an envelope-decode crash to a WARN + a throwaway metric + preserve-the-marker,
 * so a PERMANENT defect (a bare envelope above the membrane) degrade-then-poll-
 * recovered FOREVER, invisible to prod monitoring. Piece-2's decode boundary now
 * throws a typed BareEnvelopeError for that defect; this helper makes the
 * isolation catches treat it as the STRUCTURAL/permanent class it is:
 *
 *   - ERROR (not WARN) — it is a code defect, not a transient blip.
 *   - A first-class QUERYABLE signal: a Hub AUDIT ENTRY (action
 *     `bare_envelope_violation`, queryable via list_audit_entries) — the durable
 *     record cal-84 demanded, since the per-process metrics counter is throwaway
 *     and not query-aggregated. A metric is ALSO emitted (best-effort, consistent
 *     with the existing sweeper instrumentation).
 *
 * The CALLER does the terminal-quarantine (bug-22 pattern: permanent failure →
 * terminal state, NOT preserve-for-retry) where the offending marker is writable,
 * then CONTINUES the sweep for the other valid items (no whole-Hub fail-fast, no
 * starved valid work). Returns true when `err` was a BareEnvelopeError (escalated
 * — caller quarantines + continues), false otherwise (caller falls back to its
 * existing transient per-item isolation).
 */
import { BareEnvelopeError } from "../storage-substrate/bare-envelope-error.js";
import type { IAuditStore } from "../state.js";

export interface BareEnvelopeEscalationDeps {
  /** Durable queryable signal sink (list_audit_entries). The primary record.
   *  Only logEntry is needed — narrowed for interface segregation + easy mocking. */
  audit?: Pick<IAuditStore, "logEntry">;
  /** Best-effort metric counter (per-process; not globally aggregated). */
  metrics?: { increment: (bucket: string, details?: Record<string, unknown>) => void };
  /** ERROR-capable logger; falls back to warn if no error method. */
  logger?: { error?: (msg: string, err?: unknown) => void; warn?: (msg: string, err?: unknown) => void };
}

/** Audit action + metric bucket for the 0-bare violation (queryable handles). */
export const BARE_ENVELOPE_AUDIT_ACTION = "bare_envelope_violation";
export const BARE_ENVELOPE_METRIC_BUCKET = "substrate.bare_envelope_violation";

/**
 * Escalate a structural BareEnvelopeError caught in a sweeper isolation catch.
 * No-op + returns false for any other error (caller keeps its transient path).
 * Never throws (audit-write failures are swallowed AFTER the metric + ERROR log
 * already fired — the loud signal does not itself depend on the audit succeeding).
 */
export async function escalateBareEnvelope(
  err: unknown,
  context: { sweeper: string; entityRef: string },
  deps: BareEnvelopeEscalationDeps,
): Promise<boolean> {
  if (!(err instanceof BareEnvelopeError)) return false;
  const detail =
    `0-bare-violation in ${context.sweeper}: a structural (permanent) bare-envelope ` +
    `decode defect — quarantined, NOT retried (cal-84). ${err.message} ` +
    `[entityRef=${context.entityRef}]`;
  const logError = deps.logger?.error ?? deps.logger?.warn;
  logError?.(`[ERROR][0-bare-violation] ${detail}`, err);
  deps.metrics?.increment(BARE_ENVELOPE_METRIC_BUCKET, {
    sweeper: context.sweeper,
    kind: err.kind,
    entityId: err.entityId ?? "(unknown)",
    entityRef: context.entityRef,
  });
  if (deps.audit) {
    try {
      await deps.audit.logEntry(
        "hub",
        BARE_ENVELOPE_AUDIT_ACTION,
        detail,
        err.entityId ?? context.entityRef,
      );
    } catch {
      // Audit-write failure is non-fatal: the ERROR log + metric already fired.
      deps.metrics?.increment(`${BARE_ENVELOPE_METRIC_BUCKET}.audit_failed`, {
        sweeper: context.sweeper,
        entityRef: context.entityRef,
      });
    }
  }
  return true;
}
