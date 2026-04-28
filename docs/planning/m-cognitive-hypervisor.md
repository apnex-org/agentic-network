# Mission: M-Cognitive-Hypervisor

> **Current live state is tracked in `docs/traces/m-cognitive-hypervisor-work-trace.md`** — read that first for the up-to-date in-flight / queued / done picture across sessions. This spec documents the originally-proposed mission scope and remains the canonical per-phase brief for Phases 1, 2a, 2b, 2c, 3, 4. Phase 2d (Threads 2.0 Robustness Audit — CP1-CP4) was added in a later session and is documented in §"Phase 2d Extensions" below + the checkpoint audit reports in `docs/audits/`.

**Status snapshot (updated 2026-04-21 AEST — spec-level; see work-trace for live):**
- Phases 1 + 2a + 2b + 2c + 2x: ✅ CLOSED
- Phase 2d: ✅ CP1 + CP2 shipped (audits in `docs/audits/phase-2d-cp1-observability-report.md`, `phase-2d-cp2-report.md`); CP3 + CP4 unblocked
- Mission-24 Phase A (entity provenance, task-305) + Phase C (list_* filter/sort on createdBy, task-306): ✅ shipped
- Phase 3 (state hydration / idea-114 / ADR-020): deferred, absorbs bug-11 mitigation #7
- Phase 4 (quota / idea-109): deferred — no observed 429s to justify pull-forward

**Proposed:** 2026-04-19
**Owner:** Engineer (autonomous lead)
**Collaborator:** Architect (per-phase ADR review + buy-in)
**Governance:** Director approves mission kickoff + each phase cutover; Architect reviews ADRs between.

---

## Execution status (updated 2026-04-19, session-end)

| Phase | Status | Commits |
|---|---|---|
| **Phase 1** — 6 middlewares + adapter integration + shim E2E | ✅ complete | `c01997b` → `e0721d8` |
| **Phase 1.1** — bytes + tokens on TelemetryEvent | ✅ complete | `826fcff` |
| **Phase 1 baseline measurement** — 67.8% Hub-call reduction | ✅ complete | `1453ab7` |
| **Phase 1.1a** — envelope-aware ErrorNormalizer | ✅ complete | `70136fd` |
| **Phase 1 ckpt-3** — vertex-cloudrun shim adds (round-budget + parallel + usage emit) | ✅ complete, deployed (revision `00036-qfs`), measured live (17,150 Gemini tokens observed on thread-159) | `9196361` |
| **Phase 2a design kickoff** (thread-160) | ✅ converged — Tier-A scope ratified | thread-160 |
| **Phase 2a ckpt-A** — ResponseSummarizer + `_ois_pagination` + Virtual Tokens Saved | ✅ complete | `b375000` |
| **Phase 2a ckpt-B** — PartialFailureSemantics (positional `{status, data\|error}` on parallel batches) | ✅ complete | `8ea92aa` |
| **Phase 2a ckpt-C** — LLM-usage → CognitiveTelemetry bridge | ✅ complete, deployed (revision `00038-86s`), verified live (11 `llm_usage` events captured for thread-162) | `8118212` (primitives) + `5627e08` (wiring) |

### Phase 2a — closed

All three Tier-A items shipped and verified in production:
- `ResponseSummarizer` with architect-ratified `_ois_pagination` hint
- `PartialFailureSemantics` positional preservation on parallel batches
- `LLM-usage → CognitiveTelemetry` bridge via `architectTelemetry` singleton in vertex-cloudrun

Phase 2b (StaleWhileRevalidateStrategy, GranularMatrixStrategy, ParallelBatchSuggester) scoped for a separate cycle.
Phase 3 (ThreadSyncCheck / idea-114) deferred.
Phase 4 (quota / idea-109) deferred — no observed 429s to justify pull-forward.

### Previous Phase 2a ckpt-C resumption pointer (historical)

**What's landed in `8118212`:** cognitive-layer primitives:
- `TelemetryEvent.kind` union extended with `"llm_usage"`
- `TelemetryEvent` gains `llmRound / llmPromptTokens / llmCompletionTokens / llmTotalTokens / llmFinishReason / llmParallelToolCalls` optional fields
- `CognitiveTelemetry.emitLlmUsage(usage, ctx?)` public method
- `AggregatingTelemetrySink` extended with `llmUsageEvents` + `totalLlmPromptTokens/CompletionTokens/TotalTokens` + `totalVirtualTokensSaved / summarizedCallCount` counters

**What's NOT yet landed — next-session immediate step:**

Edit `agents/vertex-cloudrun/src/sandwich.ts` and `agents/vertex-cloudrun/src/director-chat.ts`. Both currently have an `onUsage` callback that only `console.log`s cumulative tokens. Replace with a call through `CognitiveTelemetry.emitLlmUsage` so the same sink consumes Gemini usage events alongside tool-surface events:

```ts
// At module scope in sandwich.ts (or pass in via DI)
import { CognitiveTelemetry } from "@apnex/network-adapter";
const architectTelemetry = new CognitiveTelemetry({
  sink: (event) => console.log(`[Telemetry] ${JSON.stringify(event)}`),
});

// Inside the generateWithTools cognitive options:
onUsage: (u) => {
  architectTelemetry.emitLlmUsage(u, { sessionId: threadId, agentId: archEngineerId });
  // ... existing cumPromptTokens/cumCompletionTokens accounting ...
},
```

After wiring:
1. Unit tests for `emitLlmUsage` + aggregator `llm_usage` counter path
2. Rebuild `ois-cognitive-layer-0.1.0.tgz` + `ois-network-adapter-2.0.0.tgz` + redistribute to `adapters/`
3. Test sweep (cognitive-layer + network-adapter + vertex-cloudrun)
4. Deploy to Cloud Run via `deploy/build.sh architect`
5. Smoke-test via a thread to architect + grep Cloud Run logs for `"llm_usage"` events
6. Close Phase 2a by updating this doc (status → complete) and updating ADR-018

### What's in this session's memory that won't carry over

Hub tasks #141/#142/#143 were in-session tracking only (task IDs local to this CLI session, NOT persisted in Hub entities). Ignore them on resume; the source of truth is this doc + commits.

### Canonical references

- **Spec:** `docs/decisions/018-cognitive-layer-middleware.md` (ADR-018, Accepted; Phase 2a not yet reflected — can be updated when 2a is complete)
- **Phase 1 baseline measurement:** `docs/audits/phase-1-baseline-measurement.md`
- **Phase 2a design thread:** thread-160 (converged; in Hub state)
- **Phase 1 design thread:** thread-158 (converged; in Hub state)
- **Smoke test thread:** thread-159 (converged; in Hub state)

---

## The framing

The Universal Adapter + vertex-cloudrun harness should function as a **Hypervisor** for cognitive agents — abstracting LLM-harness primitives so agent code never hits `exceeded tool-call rounds`, schema hallucinations, state drift, or quota exhaustion. Agents write bare-code against cognitive primitives; the adapter transparently manages budget, caching, chunking, retries, state sync.

Where bare-metal VMs shield applications from physical hardware faults, the cognitive hypervisor shields agent responses from LLM-infrastructure faults.

This mission is the implementation arc that turns that framing into running code.

---

## Motivation

M-Ideas-Audit (2026-04-19) surfaced multiple cognitive-layer failure classes in a single 90-minute autonomous mission:

- **10× `auto_thread_reply_failed`** with reason "exceeded tool-call rounds without converging" — architect LLM hit its max-rounds ceiling while composing substantive replies.
- **11+ wrong-shape cascade staging events** — LLM conflated direct-tool schema with cascade-action schema.
- **1× duplicate reply** (thread-156) — LLM-harness retry after transient tool error caused a double-send.
- **4× unauthorized task creation** (task-282/283/284/285) despite ratified invariant — LLM scope drift.
- **1× false-positive watchdog escalation** (dn-003) — compose-time exceeded receiptSla.

Each of these is a **leak of the underlying LLM harness into agent-observable behavior**. Agent code shouldn't know rounds exist, caches exist, or quotas exist — the adapter should abstract them.

Director framing (2026-04-19):
> "LLMs/Agents should never hit this message if our Agentic Network code is doing its job. The Universal Adapter + vertex harness is like a Hypervisor — abstracting infra primitives so that our code never hits this issue."

---

## Goals

1. **Zero `auto_thread_reply_failed` with reason "exceeded tool-call rounds"** under normal production load.
2. **Zero wrong-shape cascade staging** events — adapter auto-corrects or self-validates before submit.
3. **Zero duplicate replies** reaching the Hub from adapter-originated LLM retries.
4. **Zero false-positive watchdog escalations** attributable to LLM compose-time.
5. **Agent code remains bare** — no `if (budget < 2) save state` logic in sandwich handlers; the adapter owns that.
6. **Regression-protected** — `adapters/*/test/` suites cover each mitigation (companion to idea-104).

## Non-goals

- Not re-implementing the LLM provider SDKs (Gemini / Anthropic) — thin wrappers only.
- Not building an agent-agnostic framework — scope is the OIS adapter layer (vertex-cloudrun, claude-plugin, opencode-plugin).
- Not chat / ACP redesign — orthogonal; piggybacks later.
- Not Hub-side changes except where they form the adapter-Hub contract (Phase 4).

---

## Phases

### Phase 1 — Round-budget resilience (~1 engineer week)

**Goal:** Eliminate tool-round exhaustion as a class.

Delivers ~70% of observed failure mitigation. Ships standalone.

1. **Round-budget awareness injection.**
   - Adapter injects `[Budget: N/15 rounds used]` synthetic system tag on each LLM turn.
   - LLM self-paces; can split work across turns if budget tight.
   - Measurable: median turns-per-convergence, max-rounds-per-turn.

2. **Parallel tool-call batching.**
   - Adapter detects independent tool calls in a single LLM turn (no shared state).
   - Batches into single Gemini parallel-function-call turn (Anthropic: parallel tool_use).
   - Multi-round sequential fetches → single-round parallel fetch.
   - Target: 40-60% round-count reduction on read-heavy turns.

3. **Tool-result caching.**
   - 30s per-session cache on idempotent reads: `get_thread`, `list_tele`, `list_available_peers`, `list_ideas`, `get_mission`, `list_threads`.
   - Cache key: `tool-name + arg-hash`. Invalidated on any write-tool call.
   - Target: zero duplicate fetches within a session.

**Phase 1 success criteria:**
- `auto_thread_reply_failed` rate < 0.1% of replies (observed baseline: ~12% during M-Ideas-Audit).
- Median tool-rounds-per-reply drops by 40%+.
- E2E test: "architect composes 2000-word reply referencing 8 entities" converges under budget.

**Phase 1 deliverable:** merged + deployed + companion ADR-018 (cognitive round-budget protocol).

---

### Phase 2 — Chunking + graceful degradation (~1 week)

**Goal:** When Phase 1 isn't enough, fail gracefully with full state preservation.

1. **Chunked reply composition.**
   - Adapter detects response-scope (multi-part decisions, large rubric applications, bulk idea creation).
   - Splits across explicit LLM turns; each within budget.
   - Example: audit-wave reply with 10 idea-updates → 3 turns of 3-4 updates each, rolled into single thread reply on finalization.

2. **Budget-exhaustion grace.**
   - When <2 rounds remain + work incomplete, adapter emits `[SAVE_STATE]` synthetic.
   - Queue item flagged `continuation_required`.
   - Hub resumes work via mission-conductor (see M-Mission-Conductor) after idle.
   - Work not lost; no watchdog escalation.

3. **Tool-error elision.**
   - Adapter catches cascade schema validation errors from Hub.
   - Auto-corrects payload shape using known transform rules (flat → wrapped, `text` → `description`, etc.).
   - Retries silently. LLM never sees its own mistake.
   - Direct consumer of idea-113 (cascade schema docs) + idea-111 (Hub idempotency).

**Phase 2 success criteria:**
- Zero wrong-shape cascade staging leaking to LLM context.
- Zero duplicate replies (combined with Hub-side idea-111).
- E2E test: adapter-initiated 429 retry produces exactly one Hub-visible action.

**Phase 2 deliverable:** ADR-019 (cognitive failure-grace protocol) + test coverage.

---

### Phase 3 — State hydration + reconciliation (~3-5 days)

**Goal:** LLM prompts always see fresh, authoritative Hub state.

1. **Pre-hydration.**
   - Adapter preloads authoritative Hub state into prompt preamble:
     - Current thread state (participants, round count, convergence status).
     - Active tool surface (filtered to role + current mission).
     - Recent relevant events (last N SSE events scoped to agent).
   - Zero setup rounds — LLM starts with everything it needs.

2. **State reconciliation on drift.**
   - Direct consumer of idea-114 (thread_sync_check pattern).
   - Adapter wraps mutating tool calls with pre-flight `verify_thread_state(threadId, expectedVersion)`.
   - On mismatch: adapter re-hydrates + re-drives LLM with updated context. Transparent to LLM.

**Phase 3 success criteria:**
- Zero stale-state actions in observability logs.
- E2E test: concurrent thread updates don't produce double-replies or stale-round responses.

**Phase 3 deliverable:** ADR-020 (cognitive state-hydration protocol).

---

### Phase 4 — Quota integration (~2-3 days)

**Goal:** Adapter-Hub contract for LLM quota state.

Direct implementation of idea-109 (429 backpressure signal).

1. PendingActionItem FSM extended: `quota_blocked` state.
2. Adapter detects LLM 429s; calls `signal_quota_blocked(sourceQueueItemId, retryAfterSeconds)`.
3. Hub pauses watchdog ladder during backoff window.
4. Director notifications distinguish "agent unresponsive" (critical) from "agent quota-blocked" (warning).

**Phase 4 success criteria:**
- Zero `queue_item_escalated` where root cause is 429.
- Director receives explicit "quota-blocked" signals instead of inferring from escalations.

**Phase 4 deliverable:** ADR-017 addendum — quota_blocked state + tool vocabulary.

---

## Consolidated ideas

This mission consumes + potentially closes the following backlog ideas:

| Idea | Phase | Role |
|------|-------|------|
| **idea-107** | Umbrella | This mission |
| idea-109 (429 backpressure) | Phase 4 | Direct implementation |
| idea-111 (reply idempotency) | Phase 2 | Hub-side companion; adapter also dedups |
| idea-113 (cascade schema docs) | Phase 2 | Tool-error elision rules |
| idea-114 (state reconciliation) | Phase 3 | Direct implementation |
| idea-105 (watchdog SLA retune) | Pre-mission | Ships as 15-min patch; this mission fixes root cause |
| idea-104 (mock harness) | Enabler | Required for regression test coverage |

## Related but orthogonal

- **idea-102 (Universal Port)** — complementary. Port = shared type/schema contracts. Hypervisor = runtime execution layer. Could ship in parallel; integration point is Phase 2's tool-error elision rules referencing Port-defined schemas.
- **idea-108 (Hub-as-conductor)** — complementary. See M-Mission-Conductor. Phase 2 budget-exhaustion grace depends on conductor being able to resume work.
- **idea-112 (engineer protocol doctrine)** — codifies what the Hypervisor mechanically enforces.

---

## Tele alignment

**Primary:** tele-2 (Frictionless Agentic Collaboration) — this IS the tele the retrospective indicted.
**Secondary:** tele-4 (Resilient Operations), tele-6 (Deterministic Invincibility — bounded failure modes).

## Effort / Value

- **Effort:** L-XL (~3-4 engineer weeks across all 4 phases). Phase 1 alone delivers ~70% of value.
- **Value:** XL. Unlocks tele-2 at the agent-infrastructure layer. Compounds on every future agent type.
- **Urgency:** high. Currently blocking Director's stated tele-2 goal.

## Success criteria (mission-level)

- Re-run of M-Ideas-Audit pattern converges without any tool-round failures.
- Zero Director interventions required to unstick LLM-paced agents during autonomous missions.
- `adapters/*/test/` suites red-light any regression of Phase 1-3 behaviors.
- Each phase produces one ADR; all four ADRs architect-ratified.

## Dependencies

- **idea-104 (mock harness)** is a prerequisite for Phase 1 test coverage. Ship idea-104 first OR in parallel with Phase 1.
- **M-Mission-Conductor** is a prerequisite for Phase 2 budget-exhaustion grace (needs conductor to resume saved state). Can be sequenced.

## Autonomous-operation rules

Inherits M-Ideas-Audit discipline:

1. No Director pings between phase boundaries.
2. Milestone reports only: Phase 1 complete, Phase 2 complete, Phase 3 complete, Phase 4 complete.
3. Architect is the peer review (ADR-level); no Director fallback.
4. Fail-loud on invariant violations.

**Addendum:** this mission is itself a validation of Phase 1 — if Phase 1 lands correctly, the mission's own operation should exhibit zero tool-round failures. Use that as live regression.

---

## Appendix: observed baseline (2026-04-19)

From M-Ideas-Audit 90-minute window:

| Failure class | Count | Phase that addresses |
|---------------|-------|----------------------|
| `auto_thread_reply_failed` (rounds) | 10 | Phase 1 |
| Wrong-shape cascade | 11 | Phase 2 |
| Duplicate reply | 1 | Phase 2 |
| False-positive watchdog | 1 | Phase 1 (indirect) + idea-105 patch |
| Stale-state action | ~3 | Phase 3 |
| 429 rate-limit | 0 observed (small sample) | Phase 4 |
| Unauthorized task creation | 4 | Orthogonal — idea-110 (Hub-side enforcement) |

Total observable cognitive-layer incidents: **~26 in 90 minutes**. Post-mission target: **0**.

---

## Phase 2d Extensions (added 2026-04-20, task-304/307)

Phase 2d was added as the **Threads 2.0 Robustness Audit** after Phase 2x closed. Scope ratified on thread-224. Four checkpoints — CP1 and CP2 have shipped; CP3 and CP4 are unblocked and queued.

| Checkpoint | Scope | Task | Status | Commits |
|---|---|---|---|---|
| **CP1** — Observability + Invariant Audit | Metrics primitive; shadow-invariant logger at INV-TH18/19/25; cascade-failure-type buckets; idempotency contract certification (5/5 spawn handlers) | task-304 | ✅ shipped + architect-reviewed | `eab52be` → `a6d5bb0` |
| **CP2** — Protocol Standardization + Convergence Hardening | `get_metrics` MCP tool; `ThreadConvergenceGateError` structured format (subtype + remediation + metadata); INV-TH17 policy-layer shadow (absorbs bug-15); action-validator registry at convergence gate with `stale_reference` + `invalid_transition` subtypes (absorbs bug-14 via handler-side no-op detection); `_ois_query_unmatched` sentinel sweep on list_proposals/audit_entries/bugs | task-307 | ✅ shipped, awaiting review | `761bd39` → `ea8384b` |
| **CP3** — Reaper + Lifecycle GC | Thread reaper (INV-TH21); pending_action.abandon on thread GC; summary-only truncation on close; queue/thread bidirectional integrity. Absorbs bug-16 (Agent reaper + labels/role not refreshed on reconnect). | pending | ○ queued (no hard dependency) | — |
| **CP4** — `retry_cascade` tool | MCP tool to re-run a failed cascade against certified-idempotent handlers. CP1 produced the certification; CP2 closed the update-handler hardening (bug-14). Scope simplified — pure tool implementation. | pending | ○ queued (prereqs met) | — |

**Related audit reports:** `docs/audits/phase-2d-cp1-observability-report.md`, `docs/audits/phase-2d-cp2-report.md`.

**Related threads:** thread-224 (Phase 2d scope brainstorm), thread-232 (CP2 design convergence).

**New surface introduced by Phase 2d (caller-visible):**
- `get_metrics` MCP tool (CP2 C1) — `{bucket?, limit?}` → counter snapshot + per-bucket recent-details ring buffer.
- `ThreadConvergenceGateError` response JSON gains `subtype`, `remediation`, optional `metadata` fields (CP2 C2). Subtype enumeration: `stage_missing`, `summary_missing`, `payload_validation`, `revise_invalid`, `retract_invalid`, `authority`, `stale_reference`, `invalid_transition`.
- Six new metrics counter buckets (CP1 + CP2). Full taxonomy in `docs/audits/phase-2d-cp2-report.md` §2.3.
- Action-validator registry (`hub/src/policy/action-validators/`) at the convergence gate. Adding a per-entity validator is a small-scope operation going forward — see `update-mission-status-validator.ts` for the reference template.

**Bugs resolved by Phase 2d:**
- bug-14 (update-handler no-op detection) — CP2 C4 handler-side diff check
- bug-15 (INV-TH17 shadow instrumentation gap) — CP2 C3 policy-layer post-diagnostic

---

## Pointers to related work (outside this mission's Phases)

- **Mission-24 Phase A (entity provenance)** — `docs/traces/m-cognitive-hypervisor-work-trace.md` §done-this-session (task-305 shipped, backfill executed). Companion work to this mission via idea-120.
- **Mission-24 Phase C (list_* filter/sort on createdBy)** — task-306 shipped; extends `list_tasks` + `list_ideas` + `list_threads` + `list_missions` with nested `createdBy.{role, agentId, id}` filter + sort.
- **bug-11 Universal Adapter cognitive mitigations** — idea-132 filed; captures 7 adapter-layer mitigations (round-budget awareness, parallel tool calls, tool-result caching, chunked reply composition, budget-exhaustion grace, tool-error elision, pre-hydration). **Not squashed by any Phase 2d CP** — belongs in a companion adapter-layer mission (e.g., `M-Hypervisor-Adapter-Mitigations`). Mitigation #7 (pre-hydration) overlaps with Phase 3 / idea-114 / ADR-020.
- **Strategic long-term direction** — idea-126 proposes K8s-style entity envelope (`{id, kind, apiVersion, metadata{}, spec{}, status{}}`). Not scoped under this mission; explicitly post-task-305's flat cutover.
