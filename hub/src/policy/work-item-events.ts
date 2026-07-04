/**
 * work-item-events.ts — work-54 (idea-357 parts 1-2): push-native WorkItem
 * FSM-transition events.
 *
 * Makes the work-queue PUSH-native: every WorkItem FSM transition (claim /
 * start / block / resume / release / abandon / complete / lease-expiry /
 * create) emits a broadcast `kind:"external-injection"` Message via
 * `emitAndPush` (the bug-192 canonical create+push path), so the controller +
 * agents see queue state-changes without polling. The idea-353 claimable
 * digest stays as the interval-wake FALLBACK by design — these events make
 * wake push-native, they don't replace the backstop.
 *
 * Event vocabulary (payload.notificationEvent — the workflow-run-handler
 * subscription-key convention):
 *   - `work-transition-notification` — one event for every FSM transition;
 *     `verb` + `from_status`/`to_status` carry the per-transition detail
 *     (peek-line filter/render key on these; routine claim/start/resume
 *     chatter is suppress-by-default in sse-peek-line-render).
 *   - `work-unblocked-notification` — the DERIVED keystone wake: when a
 *     complete→done clears the LAST unmet dependency of a ready item, the
 *     eligible roles are told the item is now claimable (payload carries
 *     `role_eligibility` so adapters/agents can filter).
 *
 * Emission is OBSERVABILITY, not authority: the entity transition is the
 * source of truth; every emitter here is best-effort + never-throws
 * (log + metric on failure), mirroring the mission-policy runTriggers
 * posture. The pre-transition status a caller supplies may be verb-derived
 * (the FSM fixes it) or a non-atomic pre-read (release/abandon/complete) —
 * worst-case a racing writer makes `from_status` stale on the event, never
 * on the entity.
 */
import type { IPolicyContext } from "./types.js";
import type { WorkItem, WorkItemPhase } from "../entities/work-item.js";
import { emitAndPush } from "./message-policy.js";

/** The FSM-transition event name (payload.notificationEvent). */
export const WORK_TRANSITION_EVENT = "work-transition-notification";
/** The derived dependency-unblock event name (payload.notificationEvent). */
export const WORK_UNBLOCKED_EVENT = "work-unblocked-notification";

/** Which verb produced the transition. `lease_expired` is the sweeper's
 *  requeue/poison-abandon path (no acting agent). */
export type WorkTransitionVerb =
  | "create_work"
  | "claim_work"
  | "start_work"
  | "block_work"
  | "resume_work"
  | "release_work"
  | "abandon_work"
  | "complete_work"
  | "lease_expired";

export interface WorkTransitionInput {
  /** The WorkItem row the emitter reads its fields off. Usually the
   *  post-transition row; the lease-sweeper passes the pre-expiry row it
   *  listed (plus an explicit `toStatus`) to avoid a re-read race. */
  item: WorkItem;
  verb: WorkTransitionVerb;
  /** Pre-transition status; null when the transition has no "from" semantic
   *  (create_work) or the caller genuinely can't know it. */
  fromStatus: WorkItemPhase | null;
  /** Override when `item` is a pre-transition row (sweeper). Defaults to
   *  `item.status`. */
  toStatus?: WorkItemPhase;
  /** The acting agent (spoof-proof session caller); absent for the sweeper. */
  actor?: { agentId: string; role: string };
}

/** Best-effort title off the freeform payload (`{title}` object or a JSON
 *  string carrying one — the create_work convention); null when opaque. */
function itemTitle(item: WorkItem): string | null {
  let payload = item.payload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (payload && typeof payload === "object") {
    const title = (payload as { title?: unknown }).title;
    if (typeof title === "string") return title;
  }
  return null;
}

/**
 * Emit one FSM-transition event. NEVER throws — the transition is already
 * committed; emission failure is logged + metric'd (the entity is the source
 * of truth, the event is enhancement).
 */
export async function emitWorkTransition(
  ctx: IPolicyContext,
  input: WorkTransitionInput,
): Promise<void> {
  try {
    const toStatus = input.toStatus ?? input.item.status;
    const title = itemTitle(input.item);
    const transition = `${input.fromStatus ?? "·"}→${toStatus}`;
    const by = input.actor
      ? ` by ${input.actor.role}/${input.actor.agentId}`
      : input.verb === "lease_expired"
        ? " by the lease-sweeper"
        : "";
    const titleSuffix = title ? ` — "${title}"` : "";
    const body = `${input.item.id} ${transition} (${input.verb})${by}${titleSuffix}`;

    await emitAndPush(ctx, {
      kind: "external-injection",
      authorRole: "system",
      authorAgentId: "hub",
      target: null, // broadcast — the workflow-run external-injection convention
      delivery: "push-immediate",
      intent: input.verb,
      payload: {
        body,
        work_id: input.item.id,
        verb: input.verb,
        from_status: input.fromStatus,
        to_status: toStatus,
        type: input.item.type,
        priority: input.item.priority,
        role_eligibility: input.item.roleEligibility,
        holder: input.item.lease?.holder ?? null,
        lease_expiry_count: input.item.leaseExpiryCount,
        target_ref: input.item.targetRef,
        title,
        actor_agent_id: input.actor?.agentId ?? null,
        actor_role: input.actor?.role ?? null,
        notificationEvent: WORK_TRANSITION_EVENT,
      },
    });
    ctx.metrics.increment("work_event.transition_emitted", {
      verb: input.verb,
      toStatus,
    });
  } catch (err) {
    try {
      ctx.metrics.increment("work_event.emit_failed", {
        verb: input.verb,
        workId: input.item.id,
        error: (err as Error)?.message ?? String(err),
      });
    } catch {
      /* metrics sink itself unavailable — the console line below still lands */
    }
    console.warn(
      `[work-item-events] transition emit failed for ${input.item.id} (${input.verb}); transition itself committed:`,
      err,
    );
  }
}

/**
 * The derived dependency-unblock wake (idea-357 pt-2 keystone): after a
 * complete→done, scan ready items that depended on the completed item and —
 * for each whose EVERY dependency is now done — emit
 * `work-unblocked-notification` so eligible agents are WOKEN push-natively
 * (vs the idea-353 interval digest, which stays as the fallback).
 *
 * Bounded by the listWorkItems ready-scan (500-row cap); a truncated scan can
 * only under-notify, never mis-notify — the claim-time dependency gate stays
 * authoritative. NEVER throws.
 */
export async function emitDependencyUnblocks(
  ctx: IPolicyContext,
  completed: WorkItem,
): Promise<void> {
  try {
    if (completed.status !== "done") return;
    const store = ctx.stores.workItem;
    if (!store) return;

    const { items } = await store.listWorkItems({ status: "ready" });
    const dependents = items.filter((d) => d.dependsOn.includes(completed.id));

    for (const dep of dependents) {
      let unblocked = true;
      for (const depId of dep.dependsOn) {
        if (depId === completed.id) continue;
        const other = await store.getWorkItem(depId);
        if (!other || other.status !== "done") {
          unblocked = false;
          break;
        }
      }
      if (!unblocked) continue;

      const title = itemTitle(dep);
      const roles = dep.roleEligibility.length > 0 ? dep.roleEligibility.join("/") : "any role";
      const titleSuffix = title ? ` — "${title}"` : "";
      await emitAndPush(ctx, {
        kind: "external-injection",
        authorRole: "system",
        authorAgentId: "hub",
        target: null,
        delivery: "push-immediate",
        intent: "work_unblocked",
        payload: {
          body: `${dep.id} is now claimable (${roles}) — its last unmet dependency ${completed.id} completed${titleSuffix}`,
          work_id: dep.id,
          unblocked_by: completed.id,
          type: dep.type,
          priority: dep.priority,
          role_eligibility: dep.roleEligibility,
          target_ref: dep.targetRef,
          title,
          notificationEvent: WORK_UNBLOCKED_EVENT,
        },
      });
      ctx.metrics.increment("work_event.unblocked_emitted", { workId: dep.id });
    }
  } catch (err) {
    try {
      ctx.metrics.increment("work_event.unblock_scan_failed", {
        completedId: completed.id,
        error: (err as Error)?.message ?? String(err),
      });
    } catch {
      /* metrics sink unavailable */
    }
    console.warn(
      `[work-item-events] dependency-unblock scan failed after ${completed.id} completed (non-fatal):`,
      err,
    );
  }
}
