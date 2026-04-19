# ADR-016: Thread routing — IP routing terminology + role-fallback hard removal

**Date:** 2026-04-19
**Status:** Accepted
**Complements:** ADR-014 (Phase 2 cascade + routingMode shapes), ADR-015 (ActionSpec registry)
**Supersedes:** ADR-014 §115 / §56 (role+label dispatch fallback — completes the removal started as a soft-cutover in the same commit series)

---

## Decision

Thread routing modes are renamed from the ADR-014 names (`targeted` / `broadcast` / `context_bound`) to IP-routing-terminology equivalents (`unicast` / `broadcast` / `multicast`). In the same cutover, three changes land together:

1. **`unicast` requires `recipientAgentId` at open (INV-TH28).** No more "opens with default routingMode and no pinned recipient implicitly pool-broadcasts". Callers who genuinely want pool discovery must set `routingMode: "broadcast"` explicitly.
2. **Thread-layer role+label dispatch fallback is removed (INV-TH27).** The reply + convergence-finalized dispatch paths previously fell back to role broadcast when participants lacked resolved agentIds. Fallback is replaced with a hard throw: any thread reaching reply/finalize without resolved agentIds violates a Phase-1 invariant; the bug is in the participant-upsert chain, not this dispatch.
3. **Legacy values normalize on GCS read.** Threads stored with `"targeted"`/`"context_bound"` translate to `"unicast"`/`"multicast"` in `normalizeThreadShape`. No GCS rewrite required.

---

## Context

### Why IP-routing terminology

ADR-014's names evolved piecemeal — `targeted` matched the initial engineer↔engineer pinning use case; `broadcast` matched the pool-discovery case; `context_bound` was descriptive-but-wordy for dynamically-resolved-membership threads. A year of usage made the vocabulary strain:

- `targeted` was ambiguous with `recipient` pinning vs "any member of a role pool". In practice most threads are pinned → `unicast` captures the one-to-one semantic exactly.
- `context_bound` required explaining what context-binding meant. `multicast` gives a decades-old shorthand for "one sender, group receivers, membership dynamic".
- `broadcast` is already IP-terminology; keep.

This ADR also **notes** that the current `broadcast` implementation has anycast-like semantics — it coerces to unicast on the first reply, rather than continuing to fan every subsequent message out to the pool. If true 1-to-all-every-message semantics are ever needed, a future mode (`anycast` for pick-one-and-pin; `broadcast` for stay-fanned-out) can split them. Not in scope today.

### Why `unicast` must require `recipientAgentId` — the kate↔greg leakage class

The ADR-014 default was `routingMode: "targeted"` with `recipientAgentId` optional. Without a pin, the open-time `thread_message` dispatched to `{roles: [counterparty-role], matchLabels}` — i.e., **every agent matching the counterparty's role+labels** saw the opener. In single-engineer deployments this was invisible (one match). In the kate↔greg two-engineer session, it became a leakage: the architect opened a thread intending one recipient, and both engineers' sessions received the opener.

The rename to `unicast` is the opportunity to repair the contract. `unicast` is a one-to-one mode; "one-to-pool" cannot be a valid realization of it. Making `recipientAgentId` required eliminates the leakage path **at the validator** — the error surface is the Zod layer, not silent multi-agent notification.

Callers who genuinely want pool discovery (the "any engineer matching labels, whoever replies first takes it" pattern) must explicitly declare `routingMode: "broadcast"`. Intentional, auditable, single authoritative path.

### Why the fallback hard-remove

ADR-014 §115 mandated removing the role+label dispatch fallback. A soft-cutover (commit 0ace6b0) landed first: kept the fallback dispatching but added a `console.warn` each time it fired. The intent was to watch prod logs for a week, confirm zero firings, then hard-remove.

Skipping the watch window because:
- The fallback has three independent sites (open / reply / finalized). Each keeps a role-broadcast path alive — any one of them firing unexpectedly reproduces the kate↔greg leakage.
- Every post-M18 thread has resolved agentIds by round 2 — the fallback is dead code in every prod thread we've observed.
- The soft-cutover already did the risk-mitigation work (tests migrated to M18, orchestrator wired to pass M18 handshake). Hard-removal is the completion.

Replacing the fallback with a hard throw (rather than silent skip) is INV-TH27's commitment: an unresolved-participants condition is a bug to surface, not to tolerate.

---

## Schema changes

### `ThreadRoutingMode` type

```ts
// Before (ADR-014):
export type ThreadRoutingMode = "targeted" | "broadcast" | "context_bound";

// After (ADR-016):
export type ThreadRoutingMode = "unicast" | "broadcast" | "multicast";
```

### Validator rules (ADR-016 INV-TH28)

| Mode | `recipientAgentId` | `context` |
|------|-------------------|-----------|
| `unicast` | **required** | must be null |
| `broadcast` | must be null | must be null |
| `multicast` | must be null | required (`{entityType, entityId}`) |

### Default routingMode when omitted at `create_thread`

Stays `"unicast"`. Combined with the new required-recipientAgentId rule, this means bare `create_thread({title, message})` now rejects instead of silently pool-broadcasting. Callers must consciously choose.

---

## Dispatch changes

### Open-time (`createThread`)

Three code paths based on `routingMode`:
- `unicast` → `{engineerIds: [recipientAgentId], matchLabels}` (pinned)
- `broadcast` → `{roles: [counterparty-role], matchLabels}` (explicit pool)
- `multicast` → no open-time dispatch (participants resolve on first reply from bound entity; ADR-014 §189 dynamic-membership work still deferred)

### Reply-time (`createThreadReply`)

`{engineerIds: otherParticipantIds, matchLabels}` unconditionally. If `otherParticipantIds` is empty, **throw** `INV-TH27 violation` error. No role fallback.

### Finalized-time (`handleThreadConvergedWithAction`)

Same as reply-time. If cascade-participant set has no resolved agentIds, **throw**. No role fallback.

### Leaked-fallback recovery

If a future bug causes an unresolved-participant thread to exist (e.g., pre-M18 data restored from backup into a post-M18 Hub), the thread stops progressing at first reply (invariant throw). That's visible, loud, and immediately diagnostic — better than silent wrong-routing.

---

## Migration

### GCS reads — legacy value normalization

`normalizeThreadShape` in `gcs-state.ts` translates:
- `routingMode: "targeted"` → `"unicast"` on read
- `routingMode: "context_bound"` → `"multicast"` on read
- missing field → `"unicast"` (Phase-1 default)

No GCS rewrite. Threads written pre-cutover remain as-is in storage; readers see the new names.

### Test surface

- `createTestContext` default sessionId changed from the shared `"test-session-001"` to per-call `test-session-${uuid.slice(0,8)}` to prevent M18 fingerprint collisions in multi-actor tests.
- 33 `create_thread` test call sites auto-injected `routingMode: "broadcast"` where no `recipientAgentId` was passed (preserves the implicit-pool-discovery intent the old test relied on).
- Bare `register_role` calls (≈16) migrated to M18 enriched handshake via bulk regex.
- `setSessionRole` direct calls (≈18) migrated to paired `setSessionRole + registerAgent` so both the role map AND the Agent registry are populated.
- E2E orchestrator's `ensureRegistered` uses M18 handshake.
- E2E orchestrator's event capture resolves `engineerIds` (plural) + `engineerId` (singular) → role via the registry so role-targeted assertions still work.
- Tests asserting the removed fallback behavior are **deleted**:
  - `"reply dispatch falls back to role when no participant has a resolved agentId"`
  - `"excludes null agentIds from participantAgentIds (pre-M18 legacy)"`
- Tests asserting the old default behavior are **rewritten** to assert the new default:
  - `"omitted routingMode defaults to targeted"` → `"omitted routingMode defaults to unicast; requires recipientAgentId"`
  - `"rejects targeted with context set"` → `"rejects unicast with context set"` (adds a `recipientAgentId` so validator reaches the context check)

### Prod callers

No code changes required. Thread opens in prod happen via LLM tool calls; the Zod schema update + tool description refresh on next MCP `list_tools` propagates the new contract automatically. LLMs adapt via the updated description which specifies the unicast-requires-recipientAgentId contract and the three-mode vocabulary.

---

## Invariants added to workflow-registry.md §1.3

- **INV-TH27** — thread-layer dispatches (reply, convergence-finalized) target resolved `agentId`s only. Empty-participant-id set at dispatch time is an invariant violation and throws. No role+label fallback.
- **INV-TH28** — `routingMode: "unicast"` requires `recipientAgentId`. Pool-discovery is opt-in via `routingMode: "broadcast"`. The default `unicast` behavior is never silently broadened.

---

## Consequences

### Positive

- **Kate↔greg leakage class eliminated.** Architect cannot accidentally open a unicast thread without pinning a recipient. The error surface is the Zod validator; the failure is visible, not silent.
- **Single authoritative dispatch descriptor.** `routingMode` alone determines where a thread's SSE fans. No "depends on whether participants happened to register with M18" dual path.
- **Terminology is industry-standard.** IP routing vocabulary is unambiguous, decades-old, and directly maps to the semantics we wanted to describe.
- **Legacy data compatible.** `normalizeThreadShape` translates on read; no migration downtime.

### Negative

- **Breaking change for bare `create_thread({title, message})` callers.** Any caller that omitted `routingMode` AND `recipientAgentId` previously got implicit pool-broadcast; now they get an error. Mitigation: tool description is explicit; LLMs adapt on next ListTools refresh; the error message names the two valid remediations ("set recipientAgentId, or explicitly set routingMode: broadcast").
- **Test migration required.** 33 `create_thread` call sites + 16 bare `register_role` sites + 18 `setSessionRole` sites touched. Mechanical; bulk-applied via regex; 408/408 tests green post-migration.
- **Unresolved-participant throws are not retryable.** A thread in this broken state (hypothetical — shouldn't happen post-M18) cannot progress; manual intervention required. Same disposition as `cascade_failed`.

### Neutral

- **`broadcast` semantics are really anycast-ish.** Coerces to unicast on first reply. Documented in the `ThreadRoutingMode` docstring. If use case ever emerges for true 1-to-all-every-message, add `anycast` as a distinct mode (`anycast` = current coerce-to-unicast behavior, `broadcast` = strict fan-out). Not urgent.
- **Audit trail name drift avoided.** No audit actions or SSE event names carry routing-mode strings, so the rename is internal-only.

---

## Implementation

- **`hub/src/state.ts`**: type rename + docstring + `idleExpiryMs` default for legacy paths.
- **`hub/src/gcs-state.ts`**: `normalizeRoutingMode` function; normalize-on-read.
- **`hub/src/policy/thread-policy.ts`**: validator rewrite (unicast-requires-recipientAgentId), open-dispatch three-way split (unicast/broadcast/multicast), reply-dispatch hard throw, finalized-dispatch hard throw, Zod enum rename, tool description rewrite.
- **`hub/src/policy/test-utils.ts`**: unique default sessionId per call.
- **`hub/test/e2e/orchestrator.ts`**: M18 handshake on ensureRegistered; createThread auto-defaults to broadcast when opts missing; event capture resolves engineerIds→role.
- **`hub/test/wave3b-policies.test.ts`**: bulk migration via Python+sed.
- **`hub/test/mission-19/labels.test.ts`**: add `routingMode: "broadcast"` to the two label-inheritance tests.
