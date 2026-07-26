import type { WorkItem, IWorkItemStore } from "../entities/work-item.js";
import type { PendingRecallIntentV4, RecallHistoryEntryV4 } from "../entities/work-item-contract-v4.js";
import type { IPolicyContext } from "./types.js";
import { emitAndPush } from "./message-policy.js";

export type RecallProjectorTraceEntry =
  | { step: "after_intent_read"; workId: string; intentId: string }
  | { step: "before_message_persist"; workId: string; intentId: string }
  | { step: "after_message_persist"; workId: string; intentId: string; messageId: string }
  | { step: "before_intent_mark"; workId: string; intentId: string; messageId: string }
  | { step: "after_intent_mark"; workId: string; intentId: string; messageId: string };

export interface RecallProjectorOptions {
  workId?: string;
  failpoint?: (entry: RecallProjectorTraceEntry) => void | Promise<void>;
}

export interface RecallProjectorResult {
  candidates: number;
  projected: number;
  alreadyProjected: number;
  errors: Array<{ workId: string; intentId: string; error: string }>;
}

function pendingIntents(item: WorkItem): PendingRecallIntentV4[] {
  return (item.pendingRecallIntents ?? []).filter((intent) => !intent.projectedMessageId);
}

function historyFor(item: WorkItem, intent: PendingRecallIntentV4): RecallHistoryEntryV4 {
  // 🔴 work-540: MATCHES ON operationId + beforeStateHash, NOT ON holderNoticeIntentId.
  //
  // The old linkage was `candidate.holderNoticeIntentId === intent.intentId`, and a history entry
  // records exactly ONE such id — the holder's. That made the whole notice mechanism STRUCTURALLY
  // SINGLE-RECIPIENT: an author intent matched no history entry, threw "no exact before-state
  // history", and was never delivered. The intents existed and looked correct in the row; only the
  // messages were missing. Found by a test that asserts on MESSAGES ACTUALLY DELIVERED rather than
  // on the intent array — asserting the array alone would have passed while nobody was notified.
  //
  // THE EXACTNESS GUARANTEE IS UNCHANGED. `operationId` identifies the pause and `beforeStateHash`
  // pins the exact row state it was taken against; both must match, and a mismatch still throws.
  // What is dropped is the assumption that one pause produces one notice — which was never a
  // property of the pause, only of the code that read it.
  const entry = (item.recallHistory ?? []).find((candidate) =>
    candidate.operationId === intent.operationId && candidate.beforeStateHash === intent.beforeStateHash);
  if (!entry) {
    throw new Error(`recall intent ${intent.intentId} has no exact before-state history`);
  }
  return entry;
}

function payload(item: WorkItem, intent: PendingRecallIntentV4, history: RecallHistoryEntryV4): Record<string, unknown> {
  return {
    kind: "workitem_recalled",
    workId: item.id,
    logicalId: history.before.logicalId,
    revision: history.before.revision,
    operationId: intent.operationId,
    reason: history.reason,
    recalledAt: history.recalledAt,
    recalledBy: history.actor,
    before: {
      phase: history.before.phase,
      topologyGeneration: history.before.topologyGeneration,
      resourceVersion: history.before.resourceVersion,
      stateHash: history.before.stateHash,
      blockedOn: history.before.blockedOn,
      lease: history.before.lease && {
        holder: history.before.lease.holder,
        claimedAt: history.before.lease.claimedAt,
        expiresAt: history.before.lease.expiresAt,
        heartbeatAt: history.before.lease.heartbeatAt,
        tokenFingerprint: history.before.lease.tokenFingerprint,
      },
    },
    recallDisposition: "paused",
    observedCurrentPhase: item.status,
    obsoleteToken: true,
    holderAuthority: "none",
    nextStep: item.status === "paused" ? "await-authorized-revision-or-unpause" : "observe-current-workgraph-authority",
  };
}

/** Persisted WorkItem intent is authority; Message is an idempotent exact-holder projection. */
export async function projectPendingRecallNotices(
  ctx: IPolicyContext,
  store: IWorkItemStore,
  options: RecallProjectorOptions = {},
): Promise<RecallProjectorResult> {
  let candidates: WorkItem[];
  let truncated = false;
  if (options.workId) {
    const item = await store.getWorkItem(options.workId);
    candidates = item && pendingIntents(item).length > 0 ? [item] : [];
  } else {
    const listed = await store.listPendingRecallNoticeItems();
    candidates = listed.items;
    truncated = listed.truncated;
  }
  const result: RecallProjectorResult = { candidates: 0, projected: 0, alreadyProjected: 0, errors: [] };
  for (const item of candidates) {
    for (const intent of pendingIntents(item)) {
      result.candidates += 1;
      try {
        await options.failpoint?.({ step: "after_intent_read", workId: item.id, intentId: intent.intentId });
        const history = historyFor(item, intent);
        let message = await ctx.stores.message.findByMigrationSourceId(intent.intentId);
        if (!message) {
          await options.failpoint?.({ step: "before_message_persist", workId: item.id, intentId: intent.intentId });
          message = await emitAndPush(ctx, {
            kind: "external-injection",
            authorRole: "system",
            authorAgentId: "workitem-recall-projector",
            target: { agentId: intent.exactHolderAgentId },
            payload: payload(item, intent, history),
            delivery: "push-immediate",
            migrationSourceId: intent.intentId,
          });
          result.projected += 1;
        } else {
          if (message.target?.agentId !== intent.exactHolderAgentId || message.target?.role !== undefined) {
            throw new Error(`recall notice ${intent.intentId} resolved to non-holder target`);
          }
          result.alreadyProjected += 1;
        }
        await options.failpoint?.({ step: "after_message_persist", workId: item.id, intentId: intent.intentId, messageId: message.id });
        await options.failpoint?.({ step: "before_intent_mark", workId: item.id, intentId: intent.intentId, messageId: message.id });
        await store.markRecallNoticeProjected(item.id, intent.intentId, message.id);
        await options.failpoint?.({ step: "after_intent_mark", workId: item.id, intentId: intent.intentId, messageId: message.id });
      } catch (error) {
        result.errors.push({ workId: item.id, intentId: intent.intentId, error: (error as Error)?.message ?? String(error) });
      }
    }
  }
  if (truncated) throw new Error("[recall-notice-projector] pending outbox scan hit its cap; refusing silent truncation");
  return result;
}
