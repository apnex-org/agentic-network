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

### Task 4 — Chunked Reply Composition (task-313, adapter-side)

**Status:** ✅ shipped. Oversized `create_thread_reply.message` values split into chunks of at most `ARCHITECT_MAX_REPLY_CHUNK_SIZE` chars (default 100,000) and delivered across consecutive architect turns. Telemetry covers both the split event (`thread_reply_chunked`) and the LLM-side truncation class (`llm_output_truncated`).

**Architect refinements absorbed (thread-238):**
1. Conservative 100,000 char threshold (env-configurable for tunability without redeploy).
2. State management via in-adapter `pendingChunksByThread` module-level map. First chunk emitted synchronously from the split point; remaining chunks buffered. Pre-invoke drain at the top of `attemptThreadReply` consumes one chunk per subsequent sandwich invocation; final chunk restores the original `converged`/`stagedActions`/`summary` payload.
3. `thread_reply_chunked` telemetry carries `threadId`, `totalChunks`, `totalSize`, `chunkRound` so analytics can measure oversize-reply frequency over time + correlate with bug-11 exhaustion events. `llm_output_truncated` fires when Gemini finishReason is `MAX_TOKENS` — distinct from `tool_rounds_exhausted` (single-turn output cut vs loop exhaustion).

**Implementation surface:**
- `chunkReplyMessage(message, maxChunkSize)` exported helper on `agents/vertex-cloudrun/src/sandwich.ts` — pure slice-based split, single-element return when input fits threshold. Reserves room for the continuation suffix in non-final chunks.
- Module-level `pendingChunksByThread: Map<threadId, {remainingChunks, finalArgs, createdAt}>`. 30 min TTL defense against stale buffers. Test-only accessors `__resetChunkBufferForTests` + `__peekChunkBufferForTests`.
- `attemptThreadReply` pre-invoke drain: consumes one chunk per invocation before the LLM call; final chunk restores original metadata + clears the buffer entry. On drain failure the buffer is cleared + outcome is `transient_failure` so the sandwich retry engine picks up.
- `executeToolCall` wraps the Gemini-emitted `create_thread_reply` call: when `args.message.length > MAX_REPLY_CHUNK_SIZE`, splits, buffers, rewrites args for chunk[0] (suffix appended, `converged=false`, stagedActions/summary stripped), emits `thread_reply_chunked` telemetry.
- sandwich `onUsage` callback: when `u.finishReason === "MAX_TOKENS"`, emits `emitLlmOutputTruncated` with threadId + round.

**Known v1 limitations (documented in source + report):**
- **Cloud Run restart = buffer loss.** Module-level Map not persisted. If the architect instance restarts mid-chunk, subsequent chunks are dropped. Full durability requires Hub-side continuation semantics (Task 1b scope).
- **Raw slice, no word/sentence boundary preservation.** v1 cuts at arbitrary character positions. Surrogate-pair splits are possible. Semantic-boundary-aware splitting is a v2 refinement.
- **Chunk-order dispatching relies on architect-regains-turn.** Each chunk requires the thread's turn to flip back to architect (engineer responds, or Hub re-dispatches). For long chunks on idle threads, this can stretch delivery across hours. Not a correctness issue — just throughput.

**Testing:** 8 new in `agents/vertex-cloudrun/test/chunk-reply.test.ts` pinning the chunker's slice contract + buffer-state test hooks. 3 new in `packages/cognitive-layer/test/telemetry.test.ts` pinning `emitThreadReplyChunked` + `emitLlmOutputTruncated` shapes. 172 cognitive-layer + 62 vertex-cloudrun tests pass.

### Task 1b — Graceful Exhaustion (task-314, Hub-side + adapter integration)

**Status:** ✅ shipped. Hub-side continuation primitive + adapter-side `[SAVE_STATE]` marker detection + Hub-driven re-dispatch sweep. Unifies task-313 chunk-buffer durability per architect direction on thread-239 (idea-145 Path 2 absorbable into `continuationState`'s flexible payload).

**Architect refinements absorbed (thread-239):**
1. **Continuation entity shape:** extend `PendingActionItem` with `continuationState?: Record<string, unknown>` + `continuationSavedAt?: string | null` — NOT a new entity. Colocates state with the original action; lineage of intent unbroken.
2. **Adapter→Hub signaling:** new MCP tool `save_continuation(queueItemId, payload)` — NOT overload of existing tools. Semantically precise "pause due to resource exhaustion" surface.
3. **Resumption trigger:** Hub-driven re-dispatch on the next sweep tick, re-emits the original `dispatchType` with `continuationState` embedded in the payload. Adapter stays reactive.
4. **idea-145 Path 2 unification:** `continuationState` payload is caller-opaque JSON; v1 conventions `{kind: "llm_state", snapshot, currentRound}` (graceful-exhaustion) and `{kind: "chunk_buffer", remainingChunks, finalArgs}` (task-313 durability) both land natively. Future kinds compose.

**Implementation surface:**

*Hub-side:*
- `PendingActionItem` gains `continuationState?: Record<string, unknown>` + `continuationSavedAt?: string | null`; state enum extends with `continuation_required` alongside existing `enqueued | receipt_acked | completion_acked | escalated | errored`.
- `IPendingActionStore.saveContinuation(id, callerAgentId, continuationState)` — auth-guarded (targetAgentId-only); rejects on terminal states; idempotent on `continuation_required` (last-save-wins). Memory + GCS impls.
- `IPendingActionStore.listContinuationItems()` — oldest-first by `continuationSavedAt`. Memory + GCS impls.
- `IPendingActionStore.resumeContinuation(id)` — FSM transition `continuation_required → enqueued`; returns `{item, continuationState}`; refreshes `enqueuedAt` + deadlines so watchdog treats it as a fresh dispatch; clears the saved snapshot.
- New `[Any]` MCP tool `save_continuation(queueItemId, payload)` in `hub/src/policy/pending-action-policy.ts` — auth via session→agent resolution; emits `queue_item_continuation_saved` audit entry.
- New `runContinuationSweepTick()` in `hub/src/index.ts` at 15s interval (env-configurable via `HUB_CONTINUATION_SWEEP_INTERVAL_MS`): drains continuation_required items + re-dispatches via `hub.dispatchEvent(dispatchType, {...payload, sourceQueueItemId, continuationState}, {engineerIds: [targetAgentId]})`; emits `queue_item_continuation_resumed` audit entry per re-dispatch. Wired into startup + SIGINT teardown alongside the thread + agent reapers.

*Adapter-side (`agents/vertex-cloudrun/src/sandwich.ts`):*
- Exported constant `SAVE_STATE_MARKER = "[SAVE_STATE]"`.
- Detection point: after `generateWithTools` returns, before the MAX_TOOL_ROUNDS / missing-reply-args branches. If the LLM's final `result` text OR the composed `replyArgs.message` contains the marker, save a continuation snapshot to the Hub and terminate with `{kind: "success"}`. The Hub's sweep re-dispatches on the next tick.
- Emits audit action `auto_thread_reply_save_state` so the forensic trail is self-contained.

**Known v1 limitations (documented in source + mission brief):**
- **Reactive-only marker detection.** v1 doesn't actively prompt the LLM to emit `[SAVE_STATE]` when budget is critical. Task 1a's thread-budget injection could later be extended to nudge the LLM toward the marker at budget ≤ 2. Currently the adapter is ready to handle the marker the moment the LLM learns the convention.
- **In-memory chunk buffer (task-313) not yet migrated.** task-313's `pendingChunksByThread` Map still lives in adapter memory. idea-145 Path 2 (chunk_buffer continuationState) is now unblocked by task-314's primitive; migration is a future follow-up (additive-first, remove-in-memory-later).
- **Simple snapshot format.** v1 `{kind: "llm_state", snapshot: string, currentRound: number, threadId}`. Snapshot is the LLM's emitted text, truncated to 10k chars. Richer formats (tool-call history, pending staged actions, prompt delta) are refinements as real continuation failures surface.
- **Simple re-dispatch semantics.** 15s sweep tick; no exponential backoff; no retry cap on re-dispatch failures. If the adapter repeatedly fails to handle a resumed item, it will cycle. Follow-up: add retry-count + eventual escalation to `errored` after N failed resumptions.

**Testing:** 6 new in `hub/test/unit/gcs-pending-action.test.ts` pinning the FSM transitions (save_continuation persists + authorization guard + terminal-state guard; listContinuationItems oldest-first; resumeContinuation resets state + returns snapshot; resume no-op on non-continuation items). 586 hub tests + 62 vertex-cloudrun tests pass.

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
