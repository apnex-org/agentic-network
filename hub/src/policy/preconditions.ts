/**
 * Precondition predicate registry — mission-51 W4.
 *
 * Per architect-ratified Strategy A: scheduled-message preconditions
 * are predicate-functions-by-name, looked up in a code-declared
 * registry. Type-safe; PR-reviewable like the W3 trigger registry;
 * security boundary clean (no runtime expression evaluation).
 *
 * Precondition shape (Message.precondition field):
 *   {
 *     fn: string;              // predicate name (must exist in registry)
 *     args: Record<string, unknown>;  // arguments passed to predicate
 *   }
 *
 * The scheduled-message sweeper calls `evaluatePrecondition(precondition,
 * ctx)` at fireAt; if returns true → fire (transition to delivered);
 * false → cancel (transition to precondition-failed; audit-entry retains
 * forensics).
 *
 * Missing-predicate handling: if `precondition.fn` is not in the
 * registry, treat as false (cancel). This is conservative — refuses to
 * fire a scheduled message whose precondition we can't evaluate.
 *
 * Absent precondition: undefined → fire unconditionally (default-true).
 *
 * How to add a new predicate:
 *   1. Append a `Precondition` to PRECONDITIONS below with explicit
 *      `fn` name + async evaluator.
 *   2. The evaluator is `(args, ctx) => Promise<boolean>`. Pure-ish:
 *      may read entity stores via ctx.stores (no side effects). Errors
 *      thrown by the evaluator are caught + treated as false (cancel).
 *   3. Add a test in `hub/test/unit/preconditions.test.ts` verifying
 *      true-on-condition + false-on-anti-condition + missing-input.
 *   4. PR review locks the registry. Runtime cannot mutate.
 */

import type { IPolicyContext } from "./types.js";

export interface Precondition {
  /** Registry name. Used as the `fn` field on Message.precondition. */
  readonly fn: string;
  /**
   * Async evaluator. Returns true if the precondition is satisfied
   * (scheduled message should fire); false otherwise. Throwing is
   * treated as false by the gate (defensive).
   */
  readonly evaluate: (
    args: Record<string, unknown>,
    ctx: IPolicyContext,
  ) => Promise<boolean>;
  /** Human-readable description for log/metric attribution. */
  readonly description: string;
}

/**
 * Initial predicate seed (W4). Adding new predicates requires a PR
 * with explicit registry entry + tests.
 */
export const PRECONDITIONS: readonly Precondition[] = [
  {
    fn: "thread-still-active",
    description:
      "Returns true iff the named thread is in `active` status. Used to gate scheduled-messages whose relevance ends when the thread closes/converges.",
    evaluate: async (args, ctx) => {
      const threadId = args.threadId;
      if (typeof threadId !== "string" || threadId.length === 0) {
        return false;
      }
      const thread = await ctx.stores.thread.getThread(threadId);
      return thread?.status === "active";
    },
  },
  {
    fn: "task-not-completed",
    description:
      "Returns true iff the named task is NOT in `completed` status. Used to gate scheduled-messages (e.g., reminders) that are irrelevant once the task closes.",
    evaluate: async (args, ctx) => {
      const taskId = args.taskId;
      if (typeof taskId !== "string" || taskId.length === 0) {
        return false;
      }
      const task = await ctx.stores.task.getTask(taskId);
      // Predicate true iff task exists AND status is not "completed".
      // Missing task → false (conservative: don't fire if we can't
      // verify task state).
      return task !== null && task.status !== "completed";
    },
  },
];

/**
 * Look up + evaluate a precondition. Returns:
 *   - true  → fire (precondition satisfied OR absent)
 *   - false → cancel (predicate returned false, threw, or fn-not-found)
 *
 * Pure-ish: may read entity stores via ctx.stores. The sweeper calls
 * this at fireAt and acts on the boolean result.
 */
export async function evaluatePrecondition(
  precondition: unknown,
  ctx: IPolicyContext,
): Promise<{ ok: boolean; reason: string }> {
  // Absent precondition → default-true (fire unconditionally).
  if (precondition === undefined || precondition === null) {
    return { ok: true, reason: "no-precondition" };
  }

  // Shape check.
  const cast = precondition as { fn?: unknown; args?: unknown };
  if (typeof cast.fn !== "string") {
    return {
      ok: false,
      reason: "malformed precondition: missing or non-string `fn`",
    };
  }
  const args =
    typeof cast.args === "object" && cast.args !== null
      ? (cast.args as Record<string, unknown>)
      : {};

  // Registry lookup.
  const predicate = PRECONDITIONS.find((p) => p.fn === cast.fn);
  if (!predicate) {
    return {
      ok: false,
      reason: `precondition fn '${cast.fn}' not in registry; cancel`,
    };
  }

  // Evaluate; defensive against throws.
  try {
    const ok = await predicate.evaluate(args, ctx);
    return {
      ok,
      reason: ok
        ? `predicate '${predicate.fn}' returned true`
        : `predicate '${predicate.fn}' returned false`,
    };
  } catch (err) {
    return {
      ok: false,
      reason: `predicate '${predicate.fn}' threw: ${(err as Error)?.message ?? String(err)}`,
    };
  }
}
