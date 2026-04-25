/**
 * Read-path helpers — mission-51 W2.
 *
 * Wraps the sovereign Message store for callers migrating off
 * `Thread.messages[]` inline reads + Thread's stored
 * lastMessageConverged / outstandingIntent / currentSemanticIntent /
 * updatedAt fields.
 *
 * W2 ships READ-path normalization with WRITE-path still dual (legacy
 * thread-message append + Message-store write-through both happen on
 * each thread-reply). W6 will sunset the legacy WRITE path; until then,
 * callers can opt in to the new read path via these helpers and
 * fallback to Thread.* for code not yet migrated.
 *
 * Per W0 spike ratified path (PR #42 / 29b26c2): bounded shadow-lag
 * AC ≤ 5s. Callers must be prepared for the very small lag-window
 * where the W1 in-process projector hasn't yet written the latest
 * thread-reply (extremely rare since it's synchronous to the reply
 * commit). The sweeper backstop closes any gap within 5s. Test
 * coverage in message-helpers.test.ts verifies parity in steady state.
 */

import type { IMessageStore, Message } from "../entities/index.js";

/**
 * List all Message-store messages for a thread, ordered by
 * `sequenceInThread` ascending. Equivalent to the legacy
 * `Thread.messages[]` array post-W1 projection.
 *
 * Steady-state parity: in normal operation (no in-flight projection
 * gap), this returns the same set + order as `Thread.messages[]`.
 */
export async function listMessagesByThread(
  messageStore: IMessageStore,
  threadId: string,
): Promise<Message[]> {
  return messageStore.listMessages({ threadId });
}

/**
 * Derived thread fields computed from the latest Message-store entry
 * for the thread. Equivalent to Thread's stored fields in steady state;
 * preferred read path post-W2 (Thread's stored fields are kept in sync
 * by the W1 inline-append path until W6 sunsets that).
 *
 * `updatedAt` falls through to the latest message's `createdAt` (which
 * equals `updatedAt` for fresh messages); this matches Thread's
 * `updatedAt` semantic of "time of last activity on the thread."
 */
export interface DerivedThreadFields {
  /** Whether the latest message had `converged=true`. False for absent. */
  lastMessageConverged: boolean;
  /** Latest message's `intent` (from per-turn metadata). null if absent. */
  outstandingIntent: string | null;
  /** Latest message's `semanticIntent`. null if absent. */
  currentSemanticIntent: string | null;
  /**
   * ISO-8601 timestamp of the latest message. null when the thread
   * has no projected messages yet (very rare; transient during
   * thread-open before the in-process projector fires).
   */
  updatedAt: string | null;
}

export async function getDerivedThreadFields(
  messageStore: IMessageStore,
  threadId: string,
): Promise<DerivedThreadFields> {
  const messages = await messageStore.listMessages({ threadId });
  if (messages.length === 0) {
    return {
      lastMessageConverged: false,
      outstandingIntent: null,
      currentSemanticIntent: null,
      updatedAt: null,
    };
  }
  // listMessages with threadId returns ordered-by-sequenceInThread
  // ascending; the latest is the last element.
  const latest = messages[messages.length - 1];
  return {
    lastMessageConverged: latest.converged ?? false,
    outstandingIntent: latest.intent ?? null,
    currentSemanticIntent: latest.semanticIntent ?? null,
    updatedAt: latest.updatedAt ?? latest.createdAt,
  };
}
