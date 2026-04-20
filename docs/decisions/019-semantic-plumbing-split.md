# ADR-019 — Semantic/Plumbing Split: LLM expresses cognition; Hub handles correlation

**Status:** Accepted (director-articulated 2026-04-20 during bug-18 + bug-19 triage)
**Mission:** M-Cognitive-Hypervisor
**Supersedes:** none
**Related:** idea-123 (proposal), idea-121 (API v2.0), bug-19 (first concrete implementation), tele-10 / idea-116 (Precision Context Engineering)

---

## Context

Across the Hub's tool surface, LLM callers (Architect, Engineer, future agents) are routinely asked to supply fields that carry no cognitive meaning — mechanical correlation values the Hub could derive from request context, entity state, and caller identity. Each such field:

1. Adds cognitive load — the LLM must remember and thread the value across reasoning steps
2. Introduces silent-failure modes — omitting the field succeeds at the tool-call level but leaves downstream state stuck
3. Consumes context tokens the LLM could spend on reasoning
4. Creates API-ergonomic friction for every caller

The `sourceQueueItemId` field on `create_thread_reply` was the forcing case: kate's repro (2026-04-20) showed that forgetting it leaves a `pending-action` queue item stuck in `receipt_acked`, visible only via `drain_pending_actions`. The failure mode is silent and compounds across replies.

Director articulated the underlying principle during bug-19 triage:

> "Routing/labeling should be an automatic mirror (persistent labels/session). A responder to a unicast thread correctly addressed to them should only have a simple response."

This ADR formalizes that principle as design discipline for all present and future Hub tools.

---

## Decision

Every Hub tool surface MUST distinguish **semantic fields** (LLM expresses cognition) from **plumbing fields** (Hub auto-derives). The distinction governs both existing tools (retrofit as bugs surface) and new tools (design-time constraint).

### Semantic fields — stay on the LLM

A field is semantic when it encodes the caller's decision, intent, or content that cannot be inferred from context. These fields are required or optional at the LLM's discretion. They express the cognitive output.

**Examples on `create_thread_reply`:**

| Field | Why it's semantic |
|---|---|
| `message` | The actual reply content — unambiguously the LLM's output |
| `converged: boolean` | The LLM's decision to finalize the thread |
| `intent` | What response the LLM is awaiting (decision_needed, agreement_pending, implementation_ready, director_input) |
| `semanticIntent` | How the recipient should frame response (seek_rigorous_critique, seek_consensus, inform, etc.) |
| `stagedActions[]` | What to commit at convergence (required when converged=true, enforced by INV-TH19) |
| `summary` | Negotiated narrative of the agreed outcome (required non-empty at converged=true, enforced by INV-TH19 + INV-TH23 Summary-as-Living-Record) |

### Plumbing fields — Hub auto-derives

A field is plumbing when it can be inferred from:
1. **Request context** — caller's session id, agent id, role
2. **Entity state** — thread participants, labels, routing mode, current turn
3. **Correlation indexes** — natural keys on queue items, idempotency keys, sibling entities

**Examples on `create_thread_reply`:**

| Field | How the Hub derives it |
|---|---|
| `sourceQueueItemId` | Natural-key lookup `{targetAgentId: callerAgentId, entityRef: threadId, dispatchType: thread_message}` via `findOpenByNaturalKey` — bug-19 |
| Target addressing | Resolved from `thread.participants[]` at reply time |
| Routing mode | Immutable per thread; enforced by INV-TH18 |
| SSE subscriber binding | Derived from caller's current agent session (Agent.currentSessionId) |
| authorAgentId | Resolved via `engineerRegistry.getAgentForSession(ctx.sessionId)` |
| Labels on the reply event | Inherited from thread (or resolved from Agent SSOT per pending idea-124) |

The Hub MUST derive plumbing fields silently. When a caller explicitly provides a plumbing field, the explicit value wins (edge cases with ambiguity); otherwise auto-derivation applies.

### Design rule

**For every new tool, for every existing tool field:**

> Can this field be derived from request context + entity state + correlation indexes?
>
> Yes → it's plumbing. Auto-derive. Accept explicit override only as an edge-case escape hatch.
>
> No → it's semantic. Stays on the LLM.

The burden of proof is on the designer to justify keeping a field in the LLM-facing API. When in doubt, treat as plumbing.

---

## Concrete implementation (bug-19)

The first concrete implementation landed as **commit `fd0710b`** (2026-04-20):

**Before (plumbing on LLM):**
```ts
// LLM must remember and pass sourceQueueItemId from the dispatch event
await create_thread_reply({
  threadId,
  message: "reply content",
  sourceQueueItemId: "pa-2026-04-20T09-56-...",   // ← plumbing leak
});
```

**After (plumbing in Hub):**
```ts
// LLM just replies. Hub auto-matches the queue item by natural key.
await create_thread_reply({
  threadId,
  message: "reply content",
});
```

Implementation in `hub/src/policy/thread-policy.ts:createThreadReply`:

```ts
let queueItemToAck: string | null = sourceQueueItemId;
if (!queueItemToAck && authorAgentId) {
  const autoMatch = await ctx.stores.pendingAction.findOpenByNaturalKey({
    targetAgentId: authorAgentId,
    entityRef: threadId,
    dispatchType: "thread_message",
  });
  if (autoMatch) queueItemToAck = autoMatch.id;
}
if (queueItemToAck) {
  await ctx.stores.pendingAction.completionAck(queueItemToAck);
}
```

Test coverage (TDD): `hub/test/e2e/comms-reliability.test.ts > bug-19` — 3 tests covering drain-then-reply, reply-without-drain (kate repro), explicit-id-wins (no-regression guard).

---

## Consequences

### Positive

1. **Cognitive load reduction (tele-10 alignment).** Fewer fields for the LLM to track across reasoning steps. Each field-the-LLM-must-remember is a potential failure mode eliminated.
2. **Silent-failure class closed.** Forgetting plumbing fields no longer degrades silently; the Hub derives and acts.
3. **Principle clarity.** The semantic/plumbing distinction becomes a testable invariant for all future tool design. Reviewers can challenge any new LLM-facing field with "can the Hub derive this?"
4. **Ergonomic payoff compounds.** Every auto-derived field multiplies over every caller invocation. Small per-tool savings, large aggregate.

### Negative / trade-offs

1. **More Hub-side code.** Auto-derivation needs a correlation lookup, an index (like `findOpenByNaturalKey`), or ctx-resolution logic. Tests must cover both explicit-wins and auto-derive paths.
2. **Edge-case ambiguity.** When multiple plumbing candidates exist (e.g. multiple open queue items for the same thread — rare, but possible), auto-match picks one. Explicit override must remain for callers that need precise control.
3. **Hidden behaviour risk.** Plumbing is invisible to the caller by design; when it misfires, debugging is harder than an explicit-field failure. Mitigation: metrics + audit-log the auto-derivation at each instrumented site (aligned with Phase 2d CP1 observability).
4. **Retrofit effort.** Existing tools may have plumbing fields that should move to the Hub. Retrofit is additive (existing callers keep working when they supply the field; new callers can omit). But identifying them is its own audit pass — candidate for idea-121 (API v2.0) Phase B scope.

---

## Non-goals

- This ADR does NOT mandate removing explicit-override fields. `sourceQueueItemId` stays on the `create_thread_reply` schema as optional — the LLM can still pass it when needed. Auto-derivation is a default, not a restriction.
- This ADR does NOT specify how Hub-side correlation indexes are implemented — that's per-tool. The principle is the contract; the mechanism is open.
- This ADR does NOT cover label routing semantics — see idea-124 for that layer's redesign.

---

## Application to in-flight and future work

- **bug-19 fix** (`fd0710b`) — first concrete implementation. Queue-item auto-match on `create_thread_reply`. Complete.
- **idea-121 (API v2.0) Phase B** — audit all existing tools against the split. Every LLM-facing field gets a yes/no answer to "is this derivable?" Retrofit candidates become the Phase B scope.
- **idea-124 (label routing)** — the reserved-label + sender-default-inheritance + Agent-SSOT model is a deeper application of this principle: scope routing is entirely plumbing; the LLM never plumbs it.
- **Mission-19 label selectors** — existing store-level `selectAgents` API is intentionally unchanged; the split moves retrofit to the *caller* layer (thread-policy) where plumbing vs semantic intent is clearer. See bug-18 fix `ace5cbd` for this pattern.

---

## References

- Director articulation: transcript 2026-04-20 ~10:02Z during bug-18 + bug-19 triage
- idea-123 (filed 2026-04-20) — ADR's origin idea
- bug-19 (filed 2026-04-20) — first concrete gap
- bug-19 fix — commit `fd0710b`
- bug-18 fix — commit `ace5cbd` (label-gate removal on unicast — partial application of the principle at the dispatch selector layer)
- idea-121 (API v2.0 modernization) — natural container for retrofit pass
- tele-10 (Precision Context Engineering) — downstream benefit
- INV-TH19 / INV-TH23 — gate invariants that remain semantic requirements at convergence
- M-Cognitive-Hypervisor work-trace: `docs/traces/m-cognitive-hypervisor-work-trace.md`
