/**
 * work-591 / bug-398 — THE ERROR ENVELOPE. General case.
 *
 * WHY THIS EXISTS. `router.ts` formats its OWN refusals as a JSON envelope
 * (unknown-tool, RBAC denial) but its outer catch logged and RETHREW, and
 * `mcp-binding.ts` returns `router.handle(...)` with no catch at all — so any
 * error class not enumerated in a policy's `mapVerbError` escaped to the SDK and
 * reached the client as PROSE where JSON was contracted.
 *
 * That is not a cosmetic defect. It is half of bug-398's root cause: a
 * `StorageAdmissionError` (Postgres list backpressure) reached the adapter
 * handshake as the plaintext `storage list admission ...`, the handshake's JSON
 * parse failed, the failure was treated as NON-FATAL, and the session bound its
 * role while never binding its agentId — so a live seat silently became
 * `anonymous-<role>`.
 *
 * ─── THE SIX PROPERTIES (idea-671) ────────────────────────────────────────────
 *   1 errorKind   machine-stable; branchable without string-matching prose
 *   2 mechanics   WHICH precondition failed, in the substrate's own vocabulary
 *   3 rationale   WHY the guard exists
 *   4 route       the way through — turns a wall into a turnstile
 *   5 atomicity   was anything changed by this call?
 *   6 transience  is retrying meaningful, and on what terms?
 *
 * ─── TWO HONESTY RULES THIS FILE ENFORCES, BOTH LEARNED THE HARD WAY ─────────
 *
 * 🔴 (1) NEVER ASSERT ATOMICITY THE ROUTER CANNOT VERIFY. For an arbitrary
 * unenumerated throw the router does NOT know whether the handler committed
 * before failing. Stamping "nothing has been changed by this call" would be a
 * FALSE atomicity claim, and a false claim is worse than an absent one — a
 * caller that trusts it may retry a partially-applied write. Unknown atomicity
 * is reported as unknown. A class that KNOWS it is side-effect-free may declare
 * it.
 *
 * 🔴 (2) `transience: "unknown"` IS A REAL ANSWER AND MUST BE SAID OUT LOUD.
 * bug-398's proximate cause is a caller MISCLASSIFYING a failure — the shim
 * treated a fatal condition as ignorable because nothing in the error told it
 * which it was. An honest "I cannot tell you" beats a caller guessing, and the
 * guess is what cost this org two seats.
 *
 * ─── COST, AND THE FINDING FOR idea-671 §6 ───────────────────────────────────
 * idea-671 notes it has no infrastructure-error exemplar and asks whether six
 * properties are too expensive on a hot path. THEY ARE NOT — but only because
 * of how they are supplied. The properties here are CLASS-LEVEL CONSTANTS read
 * off an error that is already being constructed; the expensive thing would be
 * COMPOSING PROSE per occurrence, which this does not do. The cost objection is
 * real and it is about prose, not structure.
 *
 * Note `StorageAdmissionError` already carried `code` and `retryAfterMs` —
 * properties 1 and 6 existed on the class and were destroyed by the
 * serialisation. Most of this contract was already paid for and thrown away.
 */

/** Is doing the SAME THING AGAIN sensible? Distinct from the route-through,
 *  which answers "what should I do differently". A caller can have a route and
 *  still not know whether to wait. */
export type Transience = "transient" | "permanent" | "unknown";

/** An error class MAY declare its own contract. Anything it does not declare is
 *  reported as unknown rather than guessed. */
export interface DeclaredErrorContract {
  errorKind?: string;
  mechanics?: string;
  rationale?: string;
  route?: string;
  /** Only set this when the class GUARANTEES it. Silence means unknown. */
  atomicity?: string;
  transience?: Transience;
  /** Meaningful only with transience "transient". */
  retryAfterMs?: number;
}

export interface ErrorEnvelope {
  error: string;
  errorKind: string;
  mechanics: string;
  rationale: string;
  route: string;
  atomicity: string;
  transience: Transience;
  retryAfterMs?: number;
}

const UNKNOWN_ATOMICITY =
  "UNKNOWN — this error was not enumerated by the policy layer, so whether any state was committed before it was raised has not been established. Do not assume a no-op.";

/**
 * Build the six-property envelope for ANY error, enumerated or not.
 *
 * Reads a declared contract off the error instance when present (duck-typed, so
 * a class in another module needs no import cycle to participate) and fills the
 * rest honestly rather than optimistically.
 */
export function toErrorEnvelope(err: unknown, toolName?: string): ErrorEnvelope {
  const e = (err ?? {}) as Partial<DeclaredErrorContract> & {
    name?: string;
    message?: string;
    code?: string;
  };
  const message = typeof e.message === "string" && e.message.length > 0
    ? e.message
    : String(err);
  const name = typeof e.name === "string" && e.name.length > 0 ? e.name : "Error";

  // 1 — machine-stable kind. Prefer an explicit contract, then a `code` (which
  // several substrate classes already carry), then the class name, and only
  // then a generic fallback. A caller must never have to match on prose.
  const errorKind = e.errorKind
    ?? (typeof e.code === "string" ? e.code : undefined)
    ?? (name !== "Error" ? name : "internal_error");

  const transience: Transience = e.transience ?? "unknown";

  return {
    error: message,
    errorKind,
    // 2 — what failed, in the substrate's vocabulary.
    mechanics: e.mechanics ?? `${name}${toolName ? ` raised by tool '${toolName}'` : ""}: ${message}`,
    // 3 — why. For an unenumerated class the honest rationale is that the policy
    // layer did not classify it, which tells the caller this is a gap rather
    // than a deliberate refusal aimed at them.
    rationale: e.rationale
      ?? "This error class is not enumerated by the policy layer, so no specific guard rationale applies — the failure is being reported rather than interpreted.",
    // 4 — the way through.
    route: e.route
      ?? (transience === "transient"
        ? "Retry on the terms given by `retryAfterMs`."
        : transience === "permanent"
          ? "Do not retry — the condition will not clear on its own. Escalate."
          : "Retry is of UNKNOWN value here. Prefer escalating over a blind retry loop."),
    // 5 — never claimed, only reported. See honesty rule (1).
    atomicity: e.atomicity ?? UNKNOWN_ATOMICITY,
    // 6 — see honesty rule (2).
    transience,
    ...(typeof e.retryAfterMs === "number" ? { retryAfterMs: e.retryAfterMs } : {}),
  };
}

/** Serialise to the router's established error shape — the SAME wire shape the
 *  router already uses for unknown-tool and RBAC denials, so the client parses
 *  one contract rather than two. */
export function errorEnvelopeResult(err: unknown, toolName?: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(toErrorEnvelope(err, toolName)) }],
    isError: true,
  };
}
