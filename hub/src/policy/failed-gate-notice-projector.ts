/**
 * Mission-140 failed-gate-seal-v2 exact-holder outbox projector.
 *
 * Authority is committed on the WorkItem first. This projector is deliberately
 * downstream and retryable: PendingFailedSealNotice.intentId is the Message
 * migrationSourceId, so a crash after Message persistence but before marking the
 * intent can never mint a second Message. No role/broadcast fallback exists.
 */

import type { IWorkItemStore, PendingFailedSealNotice, WorkItem } from "../entities/work-item.js";
import type { IPolicyContext } from "./types.js";
import { emitAndPush } from "./message-policy.js";

export type FailedGateProjectorStage =
  | "after_intent_read"
  | "before_message_persist"
  | "after_message_persist"
  | "before_intent_mark"
  | "after_intent_mark";

export interface FailedGateProjectorTraceEntry {
  stage: FailedGateProjectorStage;
  workId: string;
  intentId: string;
  messageId?: string;
}

export interface FailedGateProjectorOptions {
  workId?: string;
  /** Test-only deterministic crash injection / exact-trace observer. */
  failpoint?: (entry: FailedGateProjectorTraceEntry) => void | Promise<void>;
}

export interface FailedGateProjectionResult {
  projected: number;
  alreadyProjected: number;
  candidates: number;
  truncated: boolean;
}

async function emitStage(
  failpoint: FailedGateProjectorOptions["failpoint"],
  stage: FailedGateProjectorStage,
  item: WorkItem,
  notice: PendingFailedSealNotice,
  messageId?: string,
): Promise<void> {
  await failpoint?.({ stage, workId: item.id, intentId: notice.intentId, ...(messageId ? { messageId } : {}) });
}

function noticePayload(item: WorkItem, notice: PendingFailedSealNotice): Record<string, unknown> {
  const seal = item.failedGateSeal;
  if (!seal || seal.sealHash !== notice.sealHash) {
    throw new Error(`[failed-gate-notice-projector] ${item.id}/${notice.intentId} has no matching immutable seal`);
  }
  const receipt = seal.receipt;
  return {
    body: `Verifier FAIL sealed ${item.id}/${notice.requirementId}. Your prior lease is obsolete; do not replay this row. Recovery requires a distinct repair/revision.`,
    event: "failed_gate_sealed",
    workId: item.id,
    logicalId: receipt.logicalId,
    revision: receipt.revision,
    topologyGeneration: receipt.topologyGeneration,
    requirementId: notice.requirementId,
    verifierId: notice.verifierId,
    verdict: "fail",
    producedAt: notice.producedAt,
    effectiveDisposition: "failed_sealed",
    sealHash: notice.sealHash,
    operationId: receipt.operationId,
    obsoleteHolder: notice.exactHolderAgentId,
    obsoleteLease: {
      claimedAt: receipt.before.claimedAt,
      expiresAt: receipt.before.expiresAt,
      heartbeatAt: receipt.before.heartbeatAt,
      tokenFingerprint: receipt.before.tokenFingerprint,
    },
    recovery: "distinct-repair-only",
  };
}

export async function projectPendingFailedSealNotices(
  ctx: IPolicyContext,
  store: IWorkItemStore,
  options: FailedGateProjectorOptions = {},
): Promise<FailedGateProjectionResult> {
  const listed = options.workId
    ? { items: [await store.getWorkItem(options.workId)].filter((item): item is WorkItem => item !== null), truncated: false }
    : await store.listPendingFailedSealNoticeItems();
  let projected = 0;
  let alreadyProjected = 0;
  let candidates = 0;

  for (const item of listed.items) {
    for (const notice of item.pendingFailedSealNotices ?? []) {
      if (notice.projectedMessageId !== null) continue;
      candidates++;
      await emitStage(options.failpoint, "after_intent_read", item, notice);

      // The find-before-create check prevents duplicate live push on restart. The
      // Message store's migrationSourceId uniqueness remains the final authority.
      let message = await ctx.stores.message.findByMigrationSourceId(notice.intentId);
      if (!message) {
        await emitStage(options.failpoint, "before_message_persist", item, notice);
        message = await emitAndPush(ctx, {
          kind: "external-injection",
          authorRole: "system",
          authorAgentId: "hub",
          target: { agentId: notice.exactHolderAgentId },
          delivery: "push-immediate",
          payload: noticePayload(item, notice),
          migrationSourceId: notice.intentId,
        });
        projected++;
      } else {
        alreadyProjected++;
      }
      await emitStage(options.failpoint, "after_message_persist", item, notice, message.id);
      await emitStage(options.failpoint, "before_intent_mark", item, notice, message.id);
      await store.markFailedSealNoticeProjected(item.id, notice.intentId, message.id);
      await emitStage(options.failpoint, "after_intent_mark", item, notice, message.id);
    }
  }

  if (listed.truncated) {
    throw new Error("[failed-gate-notice-projector] pending outbox scan hit its cap; refusing silent truncation");
  }
  return { projected, alreadyProjected, candidates, truncated: false };
}
