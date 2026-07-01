/**
 * tool-call-policy.ts — pure OIS-Hub tool-call policy helpers (Slice B).
 *
 * Extracted VERBATIM from `dispatcher.ts` so both the dispatch authority
 * (`dispatch.ts`) and the god-object shell can share them without a circular
 * import. Pure functions + one constant; no closure, no MCP, no kernel.
 *
 * These encode OIS-Hub-specific dispatch POLICY (the §8 debt in the design):
 * the thread/queue queueItemId settlement rule + the signal-FSM skip-list. They
 * live in the tool-manager module (isolated), NOT in a generic core — which is
 * exactly why the module is not a publishable package (Earned Exposure / the
 * standalone-utility test).
 */

/**
 * Mission-62 W3: tools that should NOT trigger signal_working_* wrapping. The
 * signal_* tools themselves would recurse infinitely; register_role +
 * claim_session + drain_pending_actions are lifecycle tools, not semantic
 * tool-call-work.
 */
export const TOOL_CALL_SIGNAL_SKIP: ReadonlySet<string> = new Set([
  "signal_working_started",
  "signal_working_completed",
  "signal_quota_blocked",
  "signal_quota_recovered",
  "register_role",
  "claim_session",
  "drain_pending_actions",
]);

/** Compose the pendingActionMap key. Pure helper; exported for tests. */
export function pendingKey(dispatchType: string, entityRef: string): string {
  return `${dispatchType}:${entityRef}`;
}

/**
 * Inject `sourceQueueItemId` into a settling tool call's arguments when a
 * pendingActionMap entry is registered for the call's target. Currently only
 * `create_thread_reply` settles a thread_message dispatch; extend this set as
 * new auto-injection rules are ratified.
 *
 * Side effect: deletes the consumed map entry. Explicit sourceQueueItemId in the
 * args wins over the map (no rewrite).
 */
export function injectQueueItemId(
  name: string,
  args: Record<string, unknown>,
  pendingActionMap: Map<string, string>,
): Record<string, unknown> {
  if (name !== "create_thread_reply") return args;
  const threadId = args.threadId;
  if (typeof threadId !== "string") return args;
  if ("sourceQueueItemId" in args) return args;
  const queueItemId = pendingActionMap.get(pendingKey("thread_message", threadId));
  if (!queueItemId) return args;
  pendingActionMap.delete(pendingKey("thread_message", threadId));
  return { ...args, sourceQueueItemId: queueItemId };
}
