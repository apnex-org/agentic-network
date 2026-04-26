/**
 * session-claim.ts — explicit session-claim warmup helpers.
 *
 * Pure helpers for the eager-claim path: when a real adapter session
 * (vs probe spawn) starts, it sets `OIS_EAGER_SESSION_CLAIM=1` to
 * declare intent to claim a Hub session synchronously rather than
 * waiting for the lazy auto-claim path.
 *
 *   - isEagerWarmupEnabled(env): tests the env hint.
 *   - parseClaimSessionResponse(wrapper): defensively unwraps the MCP
 *     tool-call response for `claim_session`.
 *   - formatSessionClaimedLogLine(parsed): structured-parseable
 *     [Handshake] log line for diagnostic tooling.
 *
 * Renamed from `eager-claim.ts` in mission-55 cleanup — the module
 * owns claim-session helpers regardless of eager-mode usage; the
 * old name implied an eager-only scope that no longer fits.
 */

export interface ClaimSessionParsed {
  engineerId?: string;
  sessionEpoch?: number;
  sessionClaimed?: boolean;
  displacedPriorSession?: { sessionId: string; epoch: number };
}

/**
 * True iff `OIS_EAGER_SESSION_CLAIM` is set to the literal string
 * `"1"`. Any other value (unset, "0", "true", whitespace, etc.) is
 * lazy-mode. Strict on purpose — a typo doesn't accidentally land on
 * eager mode.
 */
export function isEagerWarmupEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean {
  return env.OIS_EAGER_SESSION_CLAIM === "1";
}

/**
 * Defensively parse the `claim_session` MCP tool-call response.
 * Handles the three wrapper shapes seen in the wild:
 *   - string (JSON-encoded payload)
 *   - { content: [{ text: JSON_STRING }] } (canonical MCP result)
 *   - already-parsed object
 * Returns an empty object on any parse failure (callers fall back
 * to "unknown" / "none" when emitting the [Handshake] log line).
 */
export function parseClaimSessionResponse(wrapper: unknown): ClaimSessionParsed {
  if (wrapper === null || wrapper === undefined) return {};
  try {
    if (typeof wrapper === "string") {
      const out = JSON.parse(wrapper);
      return typeof out === "object" && out !== null
        ? (out as ClaimSessionParsed)
        : {};
    }
    if (typeof wrapper === "object") {
      const w = wrapper as { content?: Array<{ text?: string }> };
      if (
        Array.isArray(w.content) &&
        w.content[0]?.text &&
        typeof w.content[0].text === "string"
      ) {
        const out = JSON.parse(w.content[0].text);
        return typeof out === "object" && out !== null
          ? (out as ClaimSessionParsed)
          : {};
      }
      // Already-parsed: trust the shape (may be a mock from a test rig).
      return wrapper as ClaimSessionParsed;
    }
  } catch {
    /* fall through to empty */
  }
  return {};
}

/**
 * Format the `[Handshake] Session claimed` log line in
 * structured-parseable form for dashboard / diagnostic tooling.
 *
 *   `[Handshake] Session claimed: epoch=<N> (displaced prior: <session-id|none>)`
 *
 * Used in eager mode after `claim_session` returns. Lazy mode does
 * not log this line — the Hub-side auto-claim happens server-side
 * and the adapter has no synchronous response to format.
 */
export function formatSessionClaimedLogLine(
  parsed: ClaimSessionParsed,
): string {
  const epoch = parsed.sessionEpoch ?? "unknown";
  const displacedPrior = parsed.displacedPriorSession?.sessionId ?? "none";
  return `[Handshake] Session claimed: epoch=${epoch} (displaced prior: ${displacedPrior})`;
}
