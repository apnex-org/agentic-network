/**
 * Thread-prompt context pruning (M25-SH-T2).
 *
 * The sandwich thread-reply path feeds the LLM a prompt that concatenates
 * every message on a thread. Long threads (high roundCount, verbose
 * messages) blow the token budget. This module provides a pure prune
 * function the sandwich uses to stay within budget while keeping the
 * signal-dense parts of the conversation.
 *
 * Strategy:
 *   1. Always retain the opener — it sets the topic and the rest of the
 *      thread is incomprehensible without it.
 *   2. Cap any single message at `perMessageCapChars` so one runaway
 *      reply can't monopolise the budget.
 *   3. From the end, include the most recent messages verbatim until
 *      adding the next would exceed the remaining budget.
 *   4. Replace the middle (opener..recent) gap with a one-line marker
 *      `[N earlier message(s) omitted for context budget]` so the LLM
 *      knows state was dropped rather than never existed.
 *
 * The function is pure, deterministic, and has no I/O — it operates on
 * the already-fetched thread.messages[] shape the sandwich produces.
 */

export interface ThreadMessageLike {
  author: string;
  text: string;
}

export interface PruneResult {
  /** Formatted text ready to substitute into the prompt's history section. */
  text: string;
  /** How many messages ended up represented verbatim (opener + recent). */
  retainedCount: number;
  /** How many messages were replaced by the omitted-marker. */
  omittedCount: number;
  /** Did any single message get truncated by `perMessageCapChars`? */
  anyTruncated: boolean;
}

export interface PruneOptions {
  /** Upper bound on total output characters. Defaults to 40_000. */
  budgetChars?: number;
  /** Per-message upper bound before individual truncation. Defaults to 8_000. */
  perMessageCapChars?: number;
}

const DEFAULT_BUDGET_CHARS = 40_000;
const DEFAULT_PER_MESSAGE_CAP_CHARS = 8_000;
const TRUNCATED_SUFFIX = "… [truncated]";

/** `\n[author]: text\n` — matches the original sandwich format. */
function formatMessage(m: ThreadMessageLike): string {
  return `\n[${m.author}]: ${m.text}\n`;
}

/** Produce an omitted-marker line for N dropped messages. */
function omittedMarker(n: number): string {
  return `\n[${n} earlier message(s) omitted for context budget]\n`;
}

/**
 * Prune a thread's messages to fit within a character budget while
 * retaining the opener and as many recent messages as will fit.
 */
export function pruneThreadMessages(
  messages: ThreadMessageLike[],
  options: PruneOptions = {},
): PruneResult {
  const budget = options.budgetChars ?? DEFAULT_BUDGET_CHARS;
  const perMsgCap = options.perMessageCapChars ?? DEFAULT_PER_MESSAGE_CAP_CHARS;

  if (messages.length === 0) {
    return { text: "", retainedCount: 0, omittedCount: 0, anyTruncated: false };
  }

  let anyTruncated = false;
  const capped: ThreadMessageLike[] = messages.map((m) => {
    if (m.text.length > perMsgCap) {
      anyTruncated = true;
      return {
        author: m.author,
        text: m.text.substring(0, perMsgCap - TRUNCATED_SUFFIX.length) + TRUNCATED_SUFFIX,
      };
    }
    return m;
  });

  const totalLen = capped.reduce((sum, m) => sum + formatMessage(m).length, 0);
  if (totalLen <= budget) {
    return {
      text: capped.map(formatMessage).join(""),
      retainedCount: capped.length,
      omittedCount: 0,
      anyTruncated,
    };
  }

  // Over budget: opener + marker + recent tail.
  const opener = capped[0];
  const openerText = formatMessage(opener);
  // Reserve enough room for a plausible omitted-marker (size varies with
  // the omitted count but a 3-digit number is a safe upper bound).
  const markerReserve = omittedMarker(999).length;
  let remaining = budget - openerText.length - markerReserve;

  const recent: ThreadMessageLike[] = [];
  for (let i = capped.length - 1; i >= 1; i--) {
    const mText = formatMessage(capped[i]);
    if (mText.length > remaining) break;
    recent.unshift(capped[i]);
    remaining -= mText.length;
  }

  const omittedCount = capped.length - 1 - recent.length;
  const marker = omittedCount > 0 ? omittedMarker(omittedCount) : "";
  const text = openerText + marker + recent.map(formatMessage).join("");

  return {
    text,
    retainedCount: 1 + recent.length,
    omittedCount,
    anyTruncated,
  };
}
