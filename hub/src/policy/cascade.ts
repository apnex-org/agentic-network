/**
 * Mission M-Cascade-Perfection Phase 1 (ADR-015): runCascade runner.
 *
 * Post-refactor shape: runner reads ActionSpecs from cascade-spec.ts
 * and composes the cross-cutting pipeline (idempotency → execute →
 * audit → dispatch) around each committed action. Handlers live in
 * cascade-actions/*.ts as ActionSpec objects — they declare WHAT
 * they produce; the runner knows HOW.
 *
 * The public surface (runCascade, cascadeIdempotencyKey, report
 * shapes) is preserved byte-for-byte with the ADR-014 runner — this
 * refactor is invisible to thread-policy.ts:handleThreadConvergedWithAction
 * and to every test that asserts against the ConvergenceReport.
 *
 * New (INV-TH25): MAX_CASCADE_DEPTH bound on recursive cascades.
 * New (INV-TH26): audit write failures are logged but don't block
 * dispatch or corrupt entity state — audit is declared recoverable.
 */

import type { StagedAction, StagedActionType, Thread, CascadeBacklink } from "../state.js";
import type { IPolicyContext } from "./types.js";
import {
  cascadeIdempotencyKey as specCascadeKey,
  getActionSpec,
  registerActionSpec,
  type ActionSpec,
  type CascadeIdempotencyKey,
} from "./cascade-spec.js";
import { logShadowInvariantBreach } from "../observability/shadow-invariants.js";

// Re-export for callers that import from cascade.ts (preserve API).
export { cascadeIdempotencyKey } from "./cascade-spec.js";
export type { CascadeIdempotencyKey } from "./cascade-spec.js";
export { registerActionSpec, getActionSpec } from "./cascade-spec.js";
export type { ActionSpec, ActionSpecKind } from "./cascade-spec.js";

// ── Report shape (preserved from ADR-014) ────────────────────────────

export type CascadeExecuteStatus = "executed" | "failed" | "skipped_idempotent";

export interface ConvergenceReportEntry {
  actionId: string;
  type: StagedActionType;
  status: CascadeExecuteStatus;
  entityId?: string | null;
  error?: string;
}

export interface CascadeRunResult {
  report: ConvergenceReportEntry[];
  executedCount: number;
  failedCount: number;
  skippedCount: number;
  anyFailure: boolean;
}

// ── Depth guard (INV-TH25) ──────────────────────────────────────────

/** Maximum depth for recursive cascade inlining. Beyond this, actions
 *  are reported as deferred (synthesized failed entry) so the finalized
 *  event still fires with a warning + cascade_failed terminal. Future:
 *  a deferred-execution queue polled by a reaper, matching INV-TH21's
 *  thread-reaper pattern. */
export const MAX_CASCADE_DEPTH = 3;

// ── Runner ──────────────────────────────────────────────────────────

/**
 * Execute committed staged actions end-to-end. Preserves ADR-014's
 * "per-action failure is isolated" contract — one handler failure
 * doesn't abort the remaining actions. Each action gets its attempt;
 * the aggregate anyFailure flag controls the thread terminal
 * (cascade_failed vs closed) at the thread-policy layer.
 */
export async function runCascade(
  ctx: IPolicyContext,
  thread: Thread,
  committed: StagedAction[],
  sourceThreadSummary: string,
  depth: number = 0,
): Promise<CascadeRunResult> {
  if (depth >= MAX_CASCADE_DEPTH) {
    logShadowInvariantBreach(
      "INV-TH25",
      `MAX_CASCADE_DEPTH (${MAX_CASCADE_DEPTH}) reached — ${committed.length} action(s) deferred`,
      ctx,
      { relatedEntity: thread.id, extra: { depth, max: MAX_CASCADE_DEPTH, deferredCount: committed.length } },
    );
    ctx.metrics.increment("cascade_fail.depth_exhausted", {
      threadId: thread.id, depth, max: MAX_CASCADE_DEPTH, deferredCount: committed.length,
    });
    console.warn(
      `[runCascade] MAX_CASCADE_DEPTH (${MAX_CASCADE_DEPTH}) reached for thread ${thread.id}; ${committed.length} action(s) reported as failed (depth-exhausted)`,
    );
    const report: ConvergenceReportEntry[] = committed.map((a) => ({
      actionId: a.id,
      type: a.type,
      status: "failed",
      error: `cascade depth ${depth} ≥ MAX_CASCADE_DEPTH (${MAX_CASCADE_DEPTH}); action deferred`,
    }));
    return { report, executedCount: 0, failedCount: report.length, skippedCount: 0, anyFailure: true };
  }
  if (depth >= MAX_CASCADE_DEPTH - 1) {
    logShadowInvariantBreach(
      "INV-TH25",
      `cascade depth ${depth} approaching MAX_CASCADE_DEPTH (${MAX_CASCADE_DEPTH})`,
      ctx,
      { kind: "near_miss", relatedEntity: thread.id, extra: { depth, max: MAX_CASCADE_DEPTH } },
    );
  }

  const report: ConvergenceReportEntry[] = [];
  for (const action of committed) {
    report.push(await executeAction(ctx, thread, action, sourceThreadSummary));
  }
  const executedCount = report.filter((r) => r.status === "executed").length;
  const failedCount = report.filter((r) => r.status === "failed").length;
  const skippedCount = report.filter((r) => r.status === "skipped_idempotent").length;
  return { report, executedCount, failedCount, skippedCount, anyFailure: failedCount > 0 };
}

/**
 * Pipeline for a single committed action. Five stages:
 *   1. Resolve spec — missing = synthesized failure (class C eliminated).
 *   2. Idempotency (kind="spawn" only) — spec.findByCascadeKey;
 *      on hit: audit action_already_executed + skipped_idempotent.
 *   3. Execute — spec.execute; throws caught and reported as failed.
 *   4. Audit — spec.auditAction + spec.auditDetails; failure logged
 *      but continues (INV-TH26 recoverability).
 *   5. Dispatch — spec.dispatch; failure logged but continues
 *      (SSE is best-effort, subscribers catch up via poll).
 */
async function executeAction(
  ctx: IPolicyContext,
  thread: Thread,
  action: StagedAction,
  sourceThreadSummary: string,
): Promise<ConvergenceReportEntry> {
  const spec = getActionSpec(action.type);
  if (!spec) {
    ctx.metrics.increment("cascade_fail.unknown_spec", {
      threadId: thread.id, actionId: action.id, type: action.type,
    });
    return {
      actionId: action.id,
      type: action.type,
      status: "failed",
      error: `no ActionSpec registered for action type "${action.type}"`,
    };
  }

  const key: CascadeIdempotencyKey = specCascadeKey(thread, action);
  const backlink: CascadeBacklink = {
    sourceThreadId: thread.id,
    sourceActionId: action.id,
    sourceThreadSummary,
  };

  try {
    // Stage 2: idempotency (spawn only)
    if (spec.kind === "spawn" && spec.findByCascadeKey) {
      const existing = await spec.findByCascadeKey(ctx, key);
      if (existing) {
        const existingId = (existing as { id?: string }).id ?? null;
        await safeAudit(ctx, "action_already_executed",
          `Cascade ${action.type} skipped for ${thread.id}/${action.id}: entity ${existingId ?? "(unknown)"} already spawned from this pair.`,
          thread.id,
        );
        ctx.metrics.increment("cascade.idempotent_skip", {
          threadId: thread.id, actionId: action.id, type: action.type, entityId: existingId,
        });
        return { actionId: action.id, type: action.type, status: "skipped_idempotent", entityId: existingId };
      }
    }

    // Stage 3: execute (build + persist atomic inside the spec).
    // Cast payload — the runtime shape is verified by the gate's
    // validateStagedActions (INV-TH19); the TS union here is too narrow
    // for the generic spec signature.
    const entity = await spec.execute(ctx, action.payload as unknown as Record<string, unknown>, action, thread, backlink);

    // Update-kind null entity = no-op idempotent update.
    if (spec.kind === "update" && entity === null) {
      await safeAudit(ctx, "action_already_executed",
        `Cascade ${action.type} skipped for ${thread.id}/${action.id}: target already at desired state.`,
        thread.id,
      );
      ctx.metrics.increment("cascade.idempotent_update_skip", {
        threadId: thread.id, actionId: action.id, type: action.type,
      });
      return { actionId: action.id, type: action.type, status: "skipped_idempotent", entityId: null };
    }

    // Stage 4: audit (recoverable per INV-TH26)
    if (spec.auditAction) {
      const details = spec.auditDetails
        ? spec.auditDetails(entity, action, thread, sourceThreadSummary)
        : `Cascade ${action.type} executed for ${thread.id}/${action.id}.`;
      await safeAudit(ctx, spec.auditAction, details, (entity as { id?: string } | null)?.id ?? thread.id);
    }

    // Stage 5: dispatch (best-effort; non-blocking)
    if (spec.dispatch && entity) {
      try {
        await spec.dispatch(ctx, entity as object, thread);
      } catch (err) {
        ctx.metrics.increment("cascade_fail.dispatch_failed", {
          threadId: thread.id, actionId: action.id, type: action.type,
          error: (err as Error)?.message ?? String(err),
        });
        console.error(
          `[runCascade] dispatch failed for ${action.type}/${action.id}; subscribers will recover via poll:`,
          err,
        );
      }
    }

    return {
      actionId: action.id,
      type: action.type,
      status: "executed",
      entityId: (entity as { id?: string } | null)?.id ?? null,
    };
  } catch (err: any) {
    ctx.metrics.increment("cascade_fail.execute_threw", {
      threadId: thread.id, actionId: action.id, type: action.type,
      error: err?.message ?? String(err),
    });
    return {
      actionId: action.id,
      type: action.type,
      status: "failed",
      error: err?.message ?? String(err),
    };
  }
}

/**
 * Audit writes log-and-continue on failure (INV-TH26): the entity has
 * already been persisted, and blocking dispatch on an audit write
 * would trade a recoverable audit-gap for a bigger consumer-facing
 * gap. Future work: persist failures to an audit-replay queue.
 */
async function safeAudit(
  ctx: IPolicyContext,
  action: string,
  details: string,
  relatedEntity: string,
): Promise<void> {
  try {
    await ctx.stores.audit.logEntry("hub", action, details, relatedEntity);
  } catch (err) {
    ctx.metrics.increment("cascade_fail.audit_failed", {
      action, relatedEntity,
      error: (err as Error)?.message ?? String(err),
    });
    console.error(`[runCascade] audit write failed (action=${action}, related=${relatedEntity}):`, err);
  }
}

// The legacy CascadeHandler API (registerCascadeHandler, CascadeHandler
// type, CascadeExecuteContext, CascadeExecuteOutcome) is deleted —
// ActionSpec is the sole handler registration path. Tests that
// previously simulated cascade_failed via a failing handler now use
// registerActionSpec directly with a minimal spec whose execute throws.
// See wave3b-policies.test.ts INV-TH19 execute-failure test for the
// canonical pattern.
