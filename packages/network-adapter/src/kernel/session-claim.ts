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

/**
 * Surface fields the adapter consumes from `claim_session` response.
 * mission-63 W3: flattened from the canonical wire envelope per Design
 * v1.0 §3.2 + ADR-028 (`{ok, agent: {id, ...}, session: {epoch, claimed,
 * trigger, displacedPriorSession?}, message?}`). Adapter doesn't carry
 * the full canonical nested shape — flatten at parse-time.
 */
export interface ClaimSessionParsed {
  agentId?: string;
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
 *
 * mission-63 W3: reads canonical envelope per Design §3.2 — `body.agent.id`
 * + `body.session.{epoch, claimed, trigger, displacedPriorSession?}`.
 * Flattens the nested shape into ClaimSessionParsed for adapter consumers
 * that don't need the full canonical nesting. Returns an empty object on
 * any parse failure (callers fall back to "unknown" / "none" when emitting
 * the [Handshake] log line).
 */
export function parseClaimSessionResponse(wrapper: unknown): ClaimSessionParsed {
  if (wrapper === null || wrapper === undefined) return {};
  try {
    let body: unknown;
    if (typeof wrapper === "string") {
      body = JSON.parse(wrapper);
    } else if (typeof wrapper === "object") {
      const w = wrapper as { content?: Array<{ text?: string }> };
      if (
        Array.isArray(w.content) &&
        w.content[0]?.text &&
        typeof w.content[0].text === "string"
      ) {
        body = JSON.parse(w.content[0].text);
      } else {
        body = wrapper;
      }
    } else {
      return {};
    }
    if (typeof body !== "object" || body === null) return {};
    const b = body as Record<string, unknown>;
    const agent = b.agent as Record<string, unknown> | undefined;
    const session = b.session as Record<string, unknown> | undefined;
    const out: ClaimSessionParsed = {};
    if (agent && typeof agent.id === "string") out.agentId = agent.id;
    if (session) {
      if (typeof session.epoch === "number") out.sessionEpoch = session.epoch;
      if (typeof session.claimed === "boolean") out.sessionClaimed = session.claimed;
      const dps = session.displacedPriorSession as
        | { sessionId?: string; epoch?: number }
        | undefined;
      if (
        dps &&
        typeof dps.sessionId === "string" &&
        typeof dps.epoch === "number"
      ) {
        out.displacedPriorSession = { sessionId: dps.sessionId, epoch: dps.epoch };
      }
    }
    return out;
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
