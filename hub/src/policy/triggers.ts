/**
 * State-transition trigger machinery — mission-51 W3.
 *
 * Mechanizes the entity-state-transition → Message-emission boundary.
 * Per `docs/methodology/mission-lifecycle.md` §5.1: every declared
 * status transition with a downstream actor fires a typed event. W3
 * implements the trigger primitive that emits Messages on those
 * transitions.
 *
 * Two-stage gate:
 *   1. TRIGGERS registry — code-declared (PR-reviewed; no runtime
 *      config drift). Each entry maps (entityType, fromStatus,
 *      toStatus) → (emitKind, payloadShape).
 *   2. DOWNSTREAM_ACTORS registry (in `downstream-actors.ts`) —
 *      "transition fires iff downstream actor exists." Absence of an
 *      actor short-circuits emission (no Message created; saves write
 *      + storage). Skip-list (ideas / audit-entry / tele) honored by
 *      absence of matching actor declarations.
 *
 * Per mission-51 brief: "Trigger registry ownership = code (declared
 * at entity-handler level; PR-reviewed; avoids runtime-config drift)."
 *
 * Per mission-51 brief: "Trigger backpressure: failed delivery
 * interlocks with W4 scheduled-messages (failed triggers schedule
 * retry)." W3 ships emission only — failures are logged + metric'd +
 * non-fatal. W4 will introduce retry-on-failure via the scheduled-
 * message sweeper.
 *
 * How to add a new trigger:
 *   1. Append a `TransitionTrigger` to TRIGGERS below with explicit
 *      (entityType, fromStatus, toStatus, emitKind, payloadShape).
 *   2. If the new trigger requires a downstream consumer that doesn't
 *      already match an existing DOWNSTREAM_ACTORS entry, add the
 *      actor declaration in `downstream-actors.ts`.
 *   3. Add a test in `hub/test/unit/triggers.test.ts` verifying
 *      fires-when-actor-matches + fires-with-correct-payload-shape.
 *   4. PR review locks the registry. Runtime cannot mutate.
 *
 * Initial set (W3) covers a subset of the 7 ratified 🔴 transitions
 * from mission-lifecycle.md §5.1 — see `docs/architecture/triggers.md`
 * for the full list + per-transition status (mechanized now vs
 * available-to-add-via-PR).
 */

import type { IPolicyContext } from "./types.js";
import type { MessageKind, MessageTarget } from "../entities/index.js";
import { shouldFireTrigger } from "./downstream-actors.js";

export interface TransitionTrigger {
  /** Which entity type this trigger watches. */
  readonly entityType:
    | "mission"
    | "task"
    | "thread"
    | "proposal"
    | "review"
    | "report"
    | "bug"
    | "turn";
  /**
   * Source status. Use `null` for entities that don't have a "from"
   * status semantic (e.g., `review` — submission is creation, not a
   * status transition).
   */
  readonly fromStatus: string | null;
  /** Target status. */
  readonly toStatus: string;
  /** Message kind to emit on match. */
  readonly emitKind: MessageKind;
  /**
   * Payload + audience shape. Pure function of (entity, context).
   * Returns null to skip emission (allows runtime predicates beyond
   * the simple from→to status match — e.g., "all tasks complete" is a
   * runtime check that the payload shape evaluates).
   */
  readonly emitShape: (
    entity: Record<string, unknown>,
    ctx: IPolicyContext,
  ) => { target: MessageTarget | null; payload: unknown } | null;
  /** Human-readable name for log/metric attribution. */
  readonly name: string;
}

/**
 * Initial trigger declarations. Each entry corresponds to a 🔴
 * transition from `docs/methodology/mission-lifecycle.md` §3 + closure
 * list in §5.1 (idea-192 = state-transition-trigger primitive).
 *
 * Other ratified 🔴 transitions (3.4 task-pending→dispatched, 4.5
 * task-needs-review, 5.4 all-tasks-complete, 6.3 report-submitted) are
 * available-to-add-via-PR per the trigger-add procedure documented
 * above. W3 ships the infrastructure + 3 representative declarations
 * to ratify the pattern.
 */
export const TRIGGERS: readonly TransitionTrigger[] = [
  // §3.2 mission.proposed → mission.active
  // Director ratified the activation; engineer needs to know to draft
  // the task plan or claim the first task. Inbox-item to mission.owner
  // (engineer role).
  {
    entityType: "mission",
    fromStatus: "proposed",
    toStatus: "active",
    emitKind: "note",
    name: "mission_activated",
    emitShape: (entity) => {
      const mission = entity as { id: string; title?: string };
      return {
        target: { role: "engineer" },
        payload: {
          missionId: mission.id,
          title: mission.title,
          transition: "proposed→active",
          directive:
            "mission active; draft task plan or claim first task",
        },
      };
    },
  },

  // §7.3 mission.active → mission.completed
  // Mission close; Director awareness. Today: Director must notice.
  // After this trigger: Director inbox-item fires automatically.
  {
    entityType: "mission",
    fromStatus: "active",
    toStatus: "completed",
    emitKind: "note",
    name: "mission_completed",
    emitShape: (entity) => {
      const mission = entity as { id: string; title?: string };
      return {
        target: { role: "director" },
        payload: {
          missionId: mission.id,
          title: mission.title,
          transition: "active→completed",
          directive: "mission closed; review retrospective + audit if pending",
        },
      };
    },
  },

  // §6.4 review/retrospective submitted → engineer notified
  // Greg's "goes into a black hole" gap: engineer authors a report,
  // architect reviews, engineer doesn't know review landed. Trigger
  // fires inbox-item to the original report author + Director.
  // `fromStatus: null` — review has no "before" status; submission is
  // creation. The handler passes `null` for fromStatus.
  {
    entityType: "review",
    fromStatus: null,
    toStatus: "submitted",
    emitKind: "note",
    name: "review_submitted",
    emitShape: (entity) => {
      const review = entity as {
        id: string;
        taskId?: string;
        decision?: string;
        reviewerAgentId?: string;
        reportAuthorAgentId?: string;
      };
      // Audience: the report author (engineer) is the primary
      // recipient. Without an authorAgentId on the review, fall back
      // to role-only fanout (engineer pool). Director gets a
      // secondary copy via a separate trigger declaration if/when
      // added; W3 keeps it tight to the primary actor.
      return {
        target: review.reportAuthorAgentId
          ? { role: "engineer", agentId: review.reportAuthorAgentId }
          : { role: "engineer" },
        payload: {
          reviewId: review.id,
          taskId: review.taskId,
          decision: review.decision,
          reviewerAgentId: review.reviewerAgentId,
          transition: "review_submitted",
          directive:
            review.decision === "revision_required"
              ? "review requires revision; address feedback"
              : "review landed; check decision + close task or revise",
        },
      };
    },
  },
];

// ── runTriggers ──────────────────────────────────────────────────────

export interface RunTriggersResult {
  readonly evaluated: number;
  readonly fired: number;
  readonly skippedByActor: number;
  readonly skippedByShape: number;
  readonly errors: number;
}

/**
 * Evaluate all TRIGGERS matching `(entityType, fromStatus, toStatus)`.
 * For each match: invoke `emitShape` to derive the payload (skip if
 * null), evaluate the `shouldFireTrigger` gate (skip if no downstream
 * actor matches), and emit a Message via `ctx.stores.message.createMessage`.
 *
 * Best-effort: per-trigger errors are logged + metric'd + don't abort
 * the remaining matches. Mirrors the cascade-runner's INV-TH26 audit-
 * recoverability stance — entity transition is the source of truth;
 * trigger emission is enhancement.
 *
 * Returns a tally for telemetry / test assertions.
 */
export async function runTriggers(
  entityType: TransitionTrigger["entityType"],
  fromStatus: string | null,
  toStatus: string,
  entity: Record<string, unknown>,
  ctx: IPolicyContext,
): Promise<RunTriggersResult> {
  const result = {
    evaluated: 0,
    fired: 0,
    skippedByActor: 0,
    skippedByShape: 0,
    errors: 0,
  };

  for (const trigger of TRIGGERS) {
    if (trigger.entityType !== entityType) continue;
    if (trigger.fromStatus !== fromStatus) continue;
    if (trigger.toStatus !== toStatus) continue;
    result.evaluated += 1;

    let shape: ReturnType<TransitionTrigger["emitShape"]>;
    try {
      shape = trigger.emitShape(entity, ctx);
    } catch (err) {
      result.errors += 1;
      ctx.metrics.increment("trigger.shape_error", {
        trigger: trigger.name,
        entityType,
        fromStatus: fromStatus ?? "(null)",
        toStatus,
        error: (err as Error)?.message ?? String(err),
      });
      console.warn(
        `[Triggers] ${trigger.name}: emitShape threw; skipping (other triggers continue):`,
        err,
      );
      continue;
    }
    if (shape === null) {
      result.skippedByShape += 1;
      continue;
    }

    // Gate: fire iff a downstream actor exists for the resulting kind.
    if (!shouldFireTrigger(trigger.emitKind, shape.payload)) {
      result.skippedByActor += 1;
      continue;
    }

    try {
      await ctx.stores.message.createMessage({
        kind: trigger.emitKind,
        // Author is the Hub itself for synthesized triggers; matches
        // the cascade-runner's "actor=hub" pattern for system audits.
        authorRole: "system",
        authorAgentId: "hub",
        target: shape.target,
        delivery: "push-immediate",
        payload: shape.payload,
        migrationSourceId: undefined, // not a migration-shim emission
      });
      result.fired += 1;
      ctx.metrics.increment("trigger.fired", {
        trigger: trigger.name,
        entityType,
        toStatus,
      });
    } catch (err) {
      result.errors += 1;
      ctx.metrics.increment("trigger.emit_failed", {
        trigger: trigger.name,
        entityType,
        toStatus,
        error: (err as Error)?.message ?? String(err),
      });
      console.warn(
        `[Triggers] ${trigger.name}: createMessage failed; scheduling W4 retry:`,
        err,
      );
      // Mission-51 W4: failed-trigger retry interlock. Schedule a
      // retry-message with backoff fireAt + retryCount metadata. The
      // scheduled-message sweeper picks it up at fireAt and re-attempts
      // the original emission. If THIS createMessage also fails, the
      // retry can't be enqueued — log + continue (no infinite recursion).
      try {
        await retryFailedTrigger(trigger, shape, ctx, 1);
      } catch (retryErr) {
        ctx.metrics.increment("trigger.retry_enqueue_failed", {
          trigger: trigger.name,
          error: (retryErr as Error)?.message ?? String(retryErr),
        });
        console.warn(
          `[Triggers] ${trigger.name}: retry-enqueue ALSO failed (storage unhealthy?); giving up:`,
          retryErr,
        );
      }
    }
  }

  return result;
}

// ── retryFailedTrigger (W4 interlock) ───────────────────────────────

/**
 * Mission-51 W4: failed-trigger retry interlock.
 *
 * Backoff schedule (configurable via env vars, with sensible defaults):
 *   attempt 1 → fireAt = now + RETRY_BACKOFF_MS_1 (default 30s)
 *   attempt 2 → fireAt = now + RETRY_BACKOFF_MS_2 (default 5min)
 *   attempt 3+ → max retries reached; give up (log + metric)
 *
 * The retry-message carries the original trigger's emit shape (kind,
 * target, payload) plus retry metadata (retryCount, maxRetries) so
 * the sweeper-side fire path can re-attempt the original emission with
 * those original parameters.
 */
const DEFAULT_MAX_RETRIES = parseInt(process.env.OIS_TRIGGER_MAX_RETRIES ?? "3", 10);
const DEFAULT_BACKOFF_MS_1 = parseInt(process.env.OIS_TRIGGER_RETRY_BACKOFF_1_MS ?? "30000", 10);
const DEFAULT_BACKOFF_MS_2 = parseInt(process.env.OIS_TRIGGER_RETRY_BACKOFF_2_MS ?? "300000", 10);

function backoffMsForAttempt(attempt: number): number {
  if (attempt <= 1) return DEFAULT_BACKOFF_MS_1;
  return DEFAULT_BACKOFF_MS_2;
}

export async function retryFailedTrigger(
  trigger: TransitionTrigger,
  shape: { target: import("../entities/index.js").MessageTarget | null; payload: unknown },
  ctx: IPolicyContext,
  attempt: number,
): Promise<void> {
  const maxRetries = DEFAULT_MAX_RETRIES;
  if (attempt > maxRetries) {
    ctx.metrics.increment("trigger.retry_exhausted", {
      trigger: trigger.name,
      attempts: attempt,
    });
    console.warn(
      `[Triggers] ${trigger.name}: retry exhausted after ${maxRetries} attempts; giving up`,
    );
    return;
  }

  const fireAt = new Date(Date.now() + backoffMsForAttempt(attempt)).toISOString();
  await ctx.stores.message.createMessage({
    kind: trigger.emitKind,
    authorRole: "system",
    authorAgentId: "hub",
    target: shape.target,
    delivery: "scheduled",
    payload: {
      ...((shape.payload && typeof shape.payload === "object")
        ? (shape.payload as Record<string, unknown>)
        : {}),
      _retryContext: {
        triggerName: trigger.name,
        retryCount: attempt,
        maxRetries,
      },
    },
    fireAt,
    retryCount: attempt,
    maxRetries,
  });
  ctx.metrics.increment("trigger.retry_scheduled", {
    trigger: trigger.name,
    attempt,
    fireAt,
  });
}
