# Mission: M-Hypervisor-Adapter-Mitigations

> **Live state tracked in `docs/traces/m-cognitive-hypervisor-work-trace.md`** — read that first for the up-to-date in-flight / queued / done picture across sessions. This brief documents the mission's scope, sequencing rationale, and the three architect refinements absorbed on thread-235 convergence.

**Hub mission id:** mission-38 (with mission-37 as an apparent duplicate-on-creation; see §7 for the drift note).
**Proposed:** 2026-04-20 (thread-233 + thread-235 ratification)
**Proposed by:** Architect
**Owner:** Engineer (implementation); Architect (directive issuance + task-level review)
**Governance:** Director approves mission kickoff; Architect issues per-task directives; Engineer implements + reports.
**Peer of:** M-Cognitive-Hypervisor (the Hub-side stability arc). This mission is the adapter-side arc targeting bug-11.

---

## 1. Goal

Close the **cognitive-layer silence class** of bug-11 — specifically, the `auto_thread_reply_failed` ("exceeded tool-call rounds without converging") class that fired 10× during M-Ideas-Audit (2026-04-19). bug-10's fix was transport-only; bug-11 is the sibling class at the cognitive layer.

**Success criteria:**
- Every one of the 10 observed failure modes in the bug-11 body is either (a) prevented by one of the landed mitigations or (b) gracefully handled without the LLM's user-visible context being disturbed.
- tele-2 ("Frictionless Agentic Collaboration") becomes achievable — tool-round exhaustion ceases to be the dominant false-positive class on the Director-notification surface.

---

## 2. Scope

The six mitigations in scope (mitigation #7 is out of scope for this mission — it lands under Phase E / idea-114 / ADR-020):

1. **Round-budget awareness** — adapter injects `[Budget: N/M]` tag per LLM turn; LLM self-paces.
2. **Parallel tool calls** — adapter batches independent calls into a single Gemini parallel-call turn.
3. **Tool-result caching** — short-TTL cache on read-only tools (`get_thread`, `list_*`) to reduce round burn from exploratory reads.
4. **Chunked reply composition** — detect response-scope; split complex replies across turns when exceeding safe output bounds.
5. **Budget-exhaustion grace** — emit `[SAVE_STATE]` synthetic + flag queue item `continuation_required` so exhausted sessions can resume without losing progress.
6. **Tool-error elision** — adapter catches schema-rejection + gate-rejection, corrects + retries without surfacing to the LLM. Mechanized by CP2 C2's `ThreadConvergenceGateError` structured format (subtype + remediation + metadata).

Mitigation #7 (pre-hydration) is already scoped under Phase E / idea-114 / ADR-020 — not duplicated here.

---

## 3. Tasks + sequencing

Locked on thread-233 with three refinements absorbed on thread-235. Sequencing prioritizes Error Elision first (highest stability impact; CP2 C2 made it mechanizable); ends with Hub-side continuation primitives (1b — smallest-blast-radius change left).

### Task 0/3 — Measurement + Error Elision (task-310)

Combined deliverable — the measurement primitive is a prerequisite for quantifying every other mitigation's impact.

**Measurement scope:**
- Adapter-side `tool_rounds_exhausted` telemetry counter.
- Longitudinal metadata per event: timestamp, threadId, correlationId, role, final round count at exhaustion, last-attempted tool name. Allows frequency analysis over time + correlation with specific threads / tool patterns.
- Wired at `agents/vertex-cloudrun/src/sandwich.ts` where `MAX_TOOL_ROUNDS_SENTINEL` is currently only audit-logged to the Hub.

**Error Elision scope:**
- Parse structured JSON returned by `create_thread_reply` rejection (CP2 C2 format: `{success:false, error, subtype, remediation, metadata?}`).
- Emit a new `thread_reply_rejected_by_gate` telemetry event with the subtype + remediation for forensic correlation.
- **v1:** do not yet auto-correct — measurement + structured surfacing only.
- **v2 (Task-310 follow-up or separate task):** per-subtype auto-correct rules (e.g., `summary_missing` → synthesize from message history; `stage_missing` → auto-stage `close_no_action`). Deferred because the auto-correct rules need per-subtype design discussion + tests.

### Task 2 — Parallel Dispatch + Caching (task-311)

**Pre-existing scaffold:** on claim, the entire caching contract was already implemented. `packages/cognitive-layer/src/middlewares/tool-result-cache.ts` provides `ToolResultCache` with 30s default TTL, LRU eviction, per-session scope (INV-COG-7). `FlushAllOnWriteStrategy` detects writes via the `create_*`/`update_*`/`close_*`/… prefix heuristic and clears the entire session cache before the write's own execution — exactly the architect's "dual-trigger invalidation" direction. `CognitivePipeline.standard()` wires this middleware in position 4 of the pipeline and `agents/vertex-cloudrun/src/hub-adapter.ts` uses the standard pipeline. So Task 2's core requirement was satisfied by Phase 1 ckpt-4 (task-287) and has been shipping in prod since then.

**Parallel dispatch (pre-existing):** `agents/vertex-cloudrun/src/sandwich.ts` line 526 sets `parallelToolCalls: true` on the thread-reply allow-list; `agents/vertex-cloudrun/src/director-chat.ts` line 356 keeps `parallelToolCalls: false` because ordering matters for director↔architect synchronous chat. That split is the correct "where safe" split — no further work needed.

**task-311 value-add (what shipped under this task):**
1. **Observability promotion.** `TelemetryEvent` gained first-class `cacheHit?: boolean` + `cacheFlushed?: boolean` fields (previously only in `tags`). Cache hit/miss/flush rates can now be aggregated without string-parsing `tags`. `CognitiveTelemetry.onToolCall` populates the fields at emit time from `ctx.tags`.
2. **`cacheFlushed` semantic tightened.** `applyInvalidation` now returns a boolean indicating whether the flush actually removed anything; `ctx.tags.cacheFlushed` is only set when a real flush happened (not on every write call). Measures real invalidation frequency, not write-call frequency.
3. **TTL env var.** `HUB_ADAPTER_CACHE_TTL_MS` (default 30_000 ms) tunes the cache TTL without a redeploy-with-code-change cycle in vertex-cloudrun's hub-adapter.
4. **End-to-end integration test.** `packages/cognitive-layer/test/cache-telemetry-integration.test.ts` pins the observable contract: get_thread cache, TTL expiry, create_thread_reply invalidation, per-session isolation, non-cacheable non-write events.

**Architect-refined cache-invalidation rule (thread-235):** dual-trigger (30s TTL + write-action detection) is satisfied by the existing FlushAllOnWriteStrategy default. Cross-agent write outside one's own history: bounded by the 30s TTL (per INV-COG-7 per-session scope, one agent's writes can't invalidate another agent's cache — TTL is the only safety net for that case). No change to the strategy required.

### Task 1a — Budget Awareness (task-312, adapter-side)

**Status:** ✅ shipped. Dynamic `[Thread Budget: round X/Y …]` injection on the per-turn system instruction; orthogonal to the pre-existing `[Cognitive Budget: …]` LLM-tool-round injection.

**Architect refinements absorbed (thread-237):**
1. Round counting pulled from `thread.roundCount` (committed-reply count maintained by the Hub) — numerator displayed as `currentRound + 1` to show the turn the LLM is about to take once this reply commits.
2. Prominent placement: trailing line on the system instruction (same surface as `injectRoundBudget`'s existing cognitive-budget line) — not buried in the user prompt.
3. `maxRounds` pulled fresh from `thread.maxRounds` at each `generateWithTools` invocation so mid-thread limit adjustments propagate without caller state change.

**Implementation surface:**
- `CognitiveOptions.threadBudget?: { currentRound, maxRounds }` in `agents/vertex-cloudrun/src/llm.ts`.
- `formatThreadBudget()` exported helper emits the trailing line; conservative fallback to `""` on invalid / missing / non-positive inputs.
- `sandwich.ts` call site passes `threadBudget: { currentRound: thread.roundCount, maxRounds: thread.maxRounds }` (defaults `0` / `10` when thread fields are absent).
- `director-chat.ts` intentionally NOT wired — director↔architect chat has no thread convergence semantics; adding it there would inject a meaningless budget. Thread-budget is a thread-reply-path concern.
- 8 new unit tests in `agents/vertex-cloudrun/test/thread-budget.test.ts` pinning the string-shape contract (turnAboutToTake = `currentRound + 1`; leading `\n\n`; conservative fallback on invalid input; stable across different limits).

### Task 4 — Chunked Reply Composition

Detect when the LLM's generated `create_thread_reply` args exceed safe output bounds; split into chunks that post across consecutive turns while preserving the original convergence intent. Ensures full-context replies can land even when individual chunks would otherwise exceed limits.

### Task 1b — Graceful Exhaustion (Hub-side)

Hub-side continuation primitives:
- New queue-item state transition: `continuation_required` (budget exhausted mid-turn).
- Resumption payload format that captures LLM state snapshot for restart.
- Adapter emits `[SAVE_STATE]` synthetic marker when round-budget hits a critical threshold (e.g., 2 rounds remaining) so the continuation point is graceful.

Landed last because it introduces new queue-item semantics that Tasks 0–4 don't require.

---

## 4. Integration with M-Cognitive-Hypervisor

- **CP2 C2 (shipped):** `ThreadConvergenceGateError` structured subtype + remediation + metadata. This mission's Task 0/3 (Error Elision half) consumes that surface directly.
- **CP1 (shipped):** metrics primitive + shadow-invariant logger. Task 0/3's `tool_rounds_exhausted` counter lives in `CognitiveTelemetry` (adapter-side); cross-correlation with Hub `inv_th19.shadow_breach` + `convergence_gate.*` buckets is via the shared `threadId` in the telemetry event metadata.
- **Phase E / idea-114 / ADR-020:** pre-hydration (mitigation #7) lives under that Phase, not here.

---

## 5. Test strategy

- **Adapter-layer unit tests:** Each task lands with unit tests in `packages/network-adapter/test/` (for adapter-layer work) or `packages/cognitive-layer/test/` (for telemetry additions).
- **Integration tests:** vertex-cloudrun shim has end-to-end tests in `agents/vertex-cloudrun/test/` that exercise the LLM loop against a fake Gemini client.
- **Hub-side Task 1b tests:** land in `hub/test/` alongside the continuation-primitive unit tests for the state FSM.
- **Fault-injection for Error Elision (Task 0/3 v2):** introduce a subtype-specific fault injector that can force each `ThreadConvergenceGateError` subtype to trigger in tests, so the auto-correct rules have coverage before shipping.

---

## 6. Bug / idea / ADR linkage

- **bug-11** — the critical-severity parent bug; resolution gated on this mission landing.
- **idea-132** — the triaged proposal this mission formalizes. Expected Hub transition `triaged → incorporated` with `missionId: mission-38` at architect discretion (tool ACL is architect-only for that flip).
- **ADR-017** — persist-first comms queue; Task 1b's `continuation_required` state extends the queue FSM and should land with an ADR addendum.
- **ADR-018** — cognitive layer middleware; every middleware change in this mission conforms to ADR-018 invariants (non-blocking emission, queueMicrotask sinks, etc.).

---

## 7. Drift note — duplicate missions

During the 2026-04-20 23:30Z formalization flow, two missions with the same title (`M-Hypervisor-Adapter-Mitigations`) landed 2 minutes apart:

- **mission-37** — created 23:30:16Z. Has `documentRef: "documents/missions/m-hypervisor-adapter-mitigations.md"` (this file). No tasks attached.
- **mission-38** — created 23:32:17Z. Has `task-310` attached. `documentRef: null`.

The engineer is proceeding against **mission-38** (the one carrying `task-310`) and referencing this brief from the filesystem path. Architect should: (a) attach `documentRef` to mission-38, (b) mark mission-37 as `archived` or reuse it, and (c) perform the `update_idea` transition on `idea-132` (`triaged → incorporated` with `missionId: mission-38`). All three transitions are architect-only per the current Hub ACL. Not a blocker for task-310 implementation.
