# Strategic Review — Provenance Sidecar (SEALED) — 2026-06-29 — stint-6 (seal_candidates)

**Node:** `work-bp-stint6_strategic_review_20260629-seal_candidates` (engineer: greg / agent-0d2c690e)
**Purpose:** the SEALED de-blinding key (design §6.1 A2 / N1). Maps each neutral `candidate_*` label in the candidate slate to the standing prior (if any) it represents. **Invisible during deliberation; recoverable at audit only.** Seats rank each candidate on its evidence, NOT its authorship.

> **Soft-blinding honesty (N1):** there is no Hub primitive that hides this mapping — it relies on scoring agents NOT reading this sidecar during deliberation. The construction-level guards are the slate's symmetric schema + the no-anchor-slot rule; `deliberate_eng` re-scores tele-fit (D1) blind as the cross-check. Stated plainly: blinding here is a discipline, not a mechanical guarantee.

## De-blinding map (candidate_* → standing prior)

| slate label | standing prior | held by | design ref |
|---|---|---|---|
| **candidate_E** | the self-instrumentation / agent-telemetry / observability theme (tele-13 north-star), anchored on **idea-343** (D-3 first-class centralised agent telemetry); idea-357 push-events + the t13 cluster are members | **architect** (D-3 / observability standing prior) | design §6.1 A2 — "candidate_K" |

**Second referent folded into the same candidate (no separate peer):** idea-343 ALSO carries the **Director's survey-dogfood referent** (design §4.6 — feed the #1 summit's lead Idea to the stint-6 Survey). Because that referent is the same idea (idea-343) and lives inside candidate_E, blinding candidate_E covers it; per the architect it is a downstream OUTPUT-HOOK, **not** a theme-ranking lean, so it warrants no separate `candidate_*`.

## Known-prior set — completeness statement (architect-confirmed)

The prior-set was surfaced to the architect (the prior-holder + Director-contact) for completeness before the freeze. **Confirmed (architect, 2026-06-29):**

- **`candidate_E` is the single blinded standing prior** (the architect's D-3/observability prior, anchored on idea-343).
- **Director-held lean: NONE to blind.** The Director **deliberately abstained** from theme-selection for this run — that abstention is the integrity premise (the org self-determines the FOCUS; the Director is hands-off until GATE 2). His survey-dogfood priority is a downstream output-hook, not a theme-ranking lean.
- **Other-seat (verifier / engineer) standing prior: NONE known.**
- If a prior surfaces later that was NOT entered as a peer here, the seal's neutrality guarantee for that prior is void (an unblinded anchoring vector, FM-1) — the audit-recoverable failure signal.

## Audit note

The neutral slate labels (candidate_A..candidate_G) were assigned by **lowest-member-id ordering** (a reproducible rule uncorrelated with authorship or ranking), NOT by any priority. candidate_E's position (5th of 7) is an artifact of that neutral ordering (its lowest representative member is bug-162), carrying no significance.
