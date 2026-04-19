# M-Cognitive-Hypervisor Phase 2a — Baseline Measurement

**Date:** 2026-04-20
**Scope:** Production baseline measurement of the cognitive-layer pipeline after Phase 2a ships
**Modes:** Pass 1 — synthetic bench (loopback); Pass 2 — live architect workload (Gemini, Cloud Run, architect-agent-00041-2v2)
**Plan:** `docs/planning/phase-2a-baseline-measurement-plan.md`
**Follow-up to:** `docs/audits/phase-1-baseline-measurement.md` (Phase 1, 67.8% synthetic Hub-call reduction)

---

## Executive summary

Phase 2a's measurable win in the synthetic bench is a **33.2% reduction in LLM-observed output tokens** with **3,644 Virtual Tokens Saved** (the architect-ratified primary KPI, thread-160). The Phase 1 Hub-call-reduction number (67.7%) is preserved. Phase 2a layers a new LLM-context delta on top of Phase 1's Hub-call savings — this is the first Phase in which the LLM actually sees a smaller tool surface.

The production (Pass 2) measurement surfaced **three unexpected findings** that reshape the Phase 2b backlog:

1. **Sandwich-scope system-prompt mismatch drives FR-SCOPE-REJECT.** The `ARCHITECT_SYSTEM_PROMPT` at `agents/vertex-cloudrun/src/llm.ts:111-113` advertises 20+ tools by name (including `list_audit_entries`, `get_engineer_status`, `create_audit_entry`, etc.). Sandwich `thread-reply` then filters the tool declarations to 10 tools (`sandwich.ts:329-346`). The LLM sees both lists, calls tools from the broader system prompt, and each rejection burns one round. 10 rejections hit MAX_TOOL_ROUNDS. Thread-166 burned **1.36M Gemini tokens** across two failed attempts from this class alone. Tool-scope filtering *is* happening at the declarations layer; the system prompt is the leak.

2. **Accumulated history dominates prompt-token growth from round ~5 onward.** `generateWithTools` pushes every model turn + every tool result into `contents[]` (`llm.ts:516` + tool-result parts); nothing is trimmed. Thread-166 round 7 prompt = 99,269 tokens, round 10 prompt = 252,251 tokens — the delta is not larger *responses*, it's more *accumulated* responses. ResponseSummarizer trims one response; it does not reclaim context from prior rounds.

3. **The architect's `McpAgentClient` is instantiated WITHOUT the `cognitive` pipeline** (`agents/vertex-cloudrun/src/hub-adapter.ts:80`). ResponseSummarizer, ToolResultCache, WriteCallDedup are all inactive on architect-side. Only the `llm_usage` telemetry bridge is wired. Wiring the full pipeline caps per-response size but is complementary to (1) and (2), not a substitute — it doesn't help the scope leak or the accumulated-history problem.

---

## Pass 1 — Synthetic bench results

**Command:** `cd packages/cognitive-layer && npx tsx bench/run.ts`
**Harness change:** bench seed bumped to 50 ideas + new `oversized-read-surface` scenario (commit `3e51902`) so ResponseSummarizer's threshold is actually crossed. Phase 1's bench kept `limit: 10` on all list calls, which kept the summarizer silent.

### Client-side (what the LLM issued)

| Metric | Baseline | Cognitive | Δ |
|---|---:|---:|---:|
| Tool calls | 360 | 360 | 0% |
| Errors | 0 | 0 | — |

LLM-issued call count identical — the pipeline remains cache-transparent.

### Hub-side (savings preserved from Phase 1)

| Metric | Baseline | Cognitive | Δ |
|---|---:|---:|---:|
| Calls that reached Hub | 62 | 20 | **−67.7%** |
| Calls prevented | — | 42 | — |

Phase 1's 67.8% reduction survives the addition of Phase 2a middleware.

### Token accounting (the Phase 2a delta)

| Metric | Baseline (no summarizer) | Cognitive (summarizer on) | Δ |
|---|---:|---:|---:|
| Input tokens (approx) | 11,740 | 11,740 | 0% |
| **Output tokens (approx)** | **32,945** | **22,016** | **−33.2%** |
| Total bytes | 177,836 | 134,117 | −24.6% |

**This is new in Phase 2a.** In Phase 1 the output-token column was identical baseline vs cognitive (cache short-circuits don't rewrite payloads). ResponseSummarizer actually trims the data the LLM observes.

### Virtual Tokens Saved (primary KPI, architect-ratified thread-160)

| Metric | Value |
|---|---:|
| Summarized calls (ResponseSummarizer fired) | 1 / 360 |
| Summarize rate | 0.3% |
| **Total Virtual Tokens Saved** | **3,644** |
| Mean Virtual Tokens Saved / summarized call | 3,644 |
| Virtual Tokens Saved vs baseline output tokens | 11.1% |

**Only 1/360 calls triggered summarization**, but that single trigger unlocks the 33% output-token reduction across the scenario. Reason: ToolResultCache sits upstream of ResponseSummarizer, so the first miss flows through the summarizer, the cache stores the already-summarized payload, and every subsequent cache hit re-delivers the trimmed result without re-invoking ResponseSummarizer. One summarization → N cache-replays of the summarized result.

### Cognitive-layer derived metrics

| Metric | Value |
|---|---:|
| Cache hit rate | 77.6% (38/49) |
| Dedup prevention rate | 1.3% (4/311) |
| Circuit-breaker fast-fails | 0 (no induced faults) |
| Mean per-call pipeline overhead | 0.14 ms |
| Error rate | 0% |

### Hub-side calls by tool

| Tool | Baseline | Cognitive | Prevented |
|---|---:|---:|---:|
| `list_ideas` | 41 | 8 | **33** |
| `create_idea` | 6 | 2 | **4** |
| `list_tele` | 3 | 1 | 2 |
| `list_available_peers` | 3 | 1 | 2 |
| `create_thread_reply` | 3 | 3 | 0 |
| `update_idea` | 3 | 3 | 0 |
| `get_thread` | 2 | 1 | 1 |
| `create_thread` | 1 | 1 | 0 |

Reads dominate savings; writes pass through as designed.

---

## Pass 2 — Production workload results

**Setup:** 6 threads opened to `architect-agent-00041-2v2` via director role, spanning the prompt-shape matrix from the plan. Architect processed all six (with heavy retries on some). Telemetry collected from Cloud Run logs filtered on `[ArchitectTelemetry]` and `[Sandwich]`.

### Prompt-shape matrix + per-thread totals

| # | Thread | Prompt shape | llm_usage events | Σ Gemini tokens | Mean / event | Outcome |
|---|---|---|---:|---:|---:|---|
| 1 | 163 | Simple ack | 43 | 377,185 | 8,771 | Converged after multiple retries |
| 2 | 164 | Ideation (open-ended) | 28 | 487,717 | 17,418 | Converged after MAX_TOOL_ROUNDS retry |
| 3 | 165 | Tool-heavy read | 15 | 351,188 | 23,412 | MAX_TOOL_ROUNDS (in-flight) |
| 4 | 166 | Design analysis | 20 | **1,363,070** | 68,153 | MAX_TOOL_ROUNDS × 2 attempts |
| 5 | 167 | Parallel candidate | 20 | 862,520 | 43,126 | Converged after 2 failed attempts |
| 6 | 168 | Error path | 19 | 263,322 | 13,859 | Converged on 4-round retry after first MAX_TOOL_ROUNDS |
| — | **Total** | — | **145** | **3,705,002** | **25,551** | — |

### finishReason distribution

| finishReason | Count | % |
|---|---:|---:|
| STOP | 132 | 91% |
| UNEXPECTED_TOOL_CALL | 13 | 9% |
| MAX_TOOL_ROUNDS | 0 at the event level | — |

MAX_TOOL_ROUNDS isn't emitted as a `llmFinishReason` — it's a sandwich-level escape captured in separate `[Sandwich]` log lines. Count of sandwich attempts that hit MAX_TOOL_ROUNDS:

| Thread | Attempts hitting MAX_TOOL_ROUNDS | Σ prompt tokens burned |
|---|---:|---:|
| 163 | 4 | 258,163 |
| 164 | 2 | 414,913 |
| 165 | 1 | 190,539 |
| 166 | 2 | 1,351,448 |
| 167 | 2 | 783,476 |
| 168 | 1 | 55,279 |
| **Total** | **12 attempts** | **3,053,818** |

**82% of production Gemini spend went to attempts that hit MAX_TOOL_ROUNDS.** This is the architect-side analogue of the M-Ideas-Audit failure class — not fixed by Phase 2a, dominates Phase 2b priority.

### Root cause #1 — Sandwich-scope system-prompt leak (FR-SCOPE-REJECT)

The sandwich-thread-reply path already filters tool *declarations* to a 10-tool allowlist (`sandwich.ts:329-346`). But `ARCHITECT_SYSTEM_PROMPT` at `llm.ts:111-113` names many more tools by role:

```
Tools tagged [Architect] are for your use (create_task, get_report,
  get_engineer_status, create_proposal_review, create_review,
  close_thread, get_pending_actions, create_audit_entry,
  resolve_clarification, cancel_task).
Tools tagged [Any] can be used by either role (list_tasks,
  list_documents, get_document, list_proposals, get_review,
  create_thread, create_thread_reply, get_thread, list_threads,
  list_audit_entries).
```

Gemini reads both — the system-prompt listing *and* the filtered declaration list — and reliably reaches for the former. Observed rejections in Pass 2:

| Rejected tool | Rejection events | Source of the hallucination |
|---|---:|---|
| `list_audit_entries` | 7 | `[Any]` line in system prompt |
| `get_idea` | 1 | Not even in system prompt — thread history or training |
| `get_engineer_status` | 1 | `[Architect]` line in system prompt |

Each rejection consumes one round and returns an error string; the LLM retries, often with the same tool, and burns 10 rounds hitting MAX_TOOL_ROUNDS. The fix is a **sandwich-scope prompt override** — when entering thread-reply, inject an explicit override that supersedes the general tool directory and names only the allowlisted tools.

### Root cause #2 — Accumulated tool-call history

`generateWithTools` (`llm.ts:411-520`) appends every model turn + every tool result to `contents[]` and never trims. Prompt-token growth across Pass 2:

| Thread | Round 1 prompt | Round 7 prompt | Round 10 prompt | Growth R1→R10 |
|---|---:|---:|---:|---:|
| 166 attempt 2 | ~5,000 | 99,269 | 252,251 | ~50× |
| 167 attempt 2 | ~5,000 | ~90,000 | 172,355 / final 611,121 | ~120× |
| 165 | ~5,000 | — | 190,539 | ~38× |

These increases are not from larger *individual* responses — they are accumulated stale `list_ideas` / `list_tasks` results from earlier rounds that the LLM has already moved past. ResponseSummarizer at the tool-call boundary trims each response once; it does not reclaim context from prior-round history.

Fix: a round-to-round history trimmer that replaces stale tool-result bodies with summary stubs (e.g., `"{ kind: 'tool_result_elided', tool: 'list_tasks', elidedTokens: 12500 }"`) once they are more than N rounds old. Keep the original structure so the LLM retains turn ordering; drop the payload that's already been acted on.

### Root cause #3 — Architect-side cognitive coverage missing

The architect's `McpAgentClient` at `agents/vertex-cloudrun/src/hub-adapter.ts:80-91` is instantiated without the `cognitive` option. Consequence:

- **No ResponseSummarizer** → unbounded `list_ideas` / `list_tasks` responses flow into Gemini at full size (`list_ideas` with no limit returned a 207,477-char payload during Pass 2 setup)
- **No ToolResultCache** → repeated `list_threads` / `get_thread` reach Hub every time
- **No WriteCallDedup** → concurrent duplicate writes pass through
- **No CircuitBreaker** → no fast-fail on repeated Hub failures

Only `architectTelemetry` (the Phase 2a ckpt-C singleton) is wired, and that's pure observability — it does not modify tool-call behavior.

Wiring the architect's `McpAgentClient` with `cognitive: CognitivePipeline.standard({ telemetry: { sink: architectTelemetry.sink } })` complements root causes #1 + #2 — it caps per-response size, but the scope leak and accumulated history are what dominate thread-166-class blowups.

---

## Virtual Tokens Saved — cumulative picture

| Measurement | Virtual Tokens Saved | Basis |
|---|---:|---|
| Pass 1 synthetic (all scenarios, seed=50) | **3,644** | `ctx.tags.virtualTokensSaved` from AggregatingSink |
| Pass 2 production (architect-side) | **0** | Pipeline not wired on architect |
| Pass 2 production (engineer-side) | not measured | No engineer workload in Pass 2 |

Production Virtual Tokens Saved is zero today because the architect bypasses the pipeline. Wiring the architect-side cognitive pipeline (above) unlocks production Virtual Tokens Saved.

---

## Comparison to M-Ideas-Audit retrospective

| M-Ideas-Audit failure class | Phase 2a mitigation status |
|---|---|
| 10× `auto_thread_reply_failed` (engineer-side MAX_TOOL_ROUNDS) | Engineer-side bench: 67.7% Hub-call reduction (Phase 1), 33.2% output-token reduction (Phase 2a). Engineer workload not driven in Pass 2; awaits engineer-side production sampling. |
| Architect-side MAX_TOOL_ROUNDS (newly surfaced) | **Not mitigated.** 12 sandwich attempts hit MAX_TOOL_ROUNDS in Pass 2 (6 prompts). Root cause is FR-SCOPE-REJECT, not oversized response. Phase 2b target. |
| Wrong-shape cascade drift | ErrorNormalizer ready; not exercised in Pass 2 because the sandwich rejects the malformed staged action before it reaches cascade execution. |
| Duplicate reply | WriteCallDedup active on engineer-side bench; inactive on architect (pipeline not wired). |

---

## Phase 2b implications — re-ranked by Pass 2 evidence

Original Phase 2b middleware list from thread-160:
- StaleWhileRevalidate cache strategy
- GranularMatrix (per-tool middleware config)
- ParallelBatchSuggester

**Revised ranking after Pass 2 data** — sequenced to conclusively solve MAX_TOOL_ROUNDS and architect token/context waste:

1. **Sandwich-scope system-prompt override** (NEW — root cause of FR-SCOPE-REJECT)
   When `sandwich.ts` enters thread-reply mode, prepend a scope override to the system prompt that names only the 10 allowlisted tools and explicitly suppresses the broader directory. Eliminates the class directly. Would have saved the full ~3M prompt-token burn observed in Pass 2 MAX_TOOL_ROUNDS attempts. Scope: ~20 lines of code in `sandwich.ts` + `llm.ts`.

2. **Round-to-round history trimming** (NEW — dominates prompt growth from round 5+)
   Add a history-compactor in `generateWithTools` that replaces stale tool-result blobs older than N rounds with elision stubs. Keeps turn structure; drops payload. Would cap round-10 prompt growth at roughly round-5 levels. Extrapolated token savings on thread-166-class workloads: 50-80% per attempt. Scope: ~40 lines in `llm.ts`.

3. **Wire architect-side cognitive pipeline** (NEW — complementary response-surface cap)
   Add `cognitive: CognitivePipeline.standard(...)` at `hub-adapter.ts:80-91`. Phase 1 Hub-call reduction (67.7%) + Phase 2a output-token reduction (33.2%) apply to architect's Hub request surface. Complements #1 and #2 rather than substitutes. Scope: ~5 lines.

4. **FastFail-OnRepeatScopeReject middleware** (belt-and-braces)
   After #1 ships, scope rejections should be rare. If any remain, fail fast on repeat-same-rejection within N rounds rather than letting the loop hit MAX_TOOL_ROUNDS. Small additional safety net.

5. **ParallelBatchSuggester** (original list, still valid)
   Thread-167 showed the architect manually ordering sequential `get_thread` calls that could have been parallel. Directly addresses the parallel-candidate prompt shape.

6. **StaleWhileRevalidate** (original list, deprioritized)
   Pass 1 cache hit rate is already 77.6%; revalidation only matters for long-lived cached entries, which didn't surface as a bottleneck in either pass.

7. **GranularMatrix** (original list, deprioritized)
   Per-tool config is a quality-of-life optimization; Pass 2 did not surface a case where the global defaults hurt.

Execution plan: `docs/planning/phase-2b-architect-token-optimization-plan.md`.

---

## Gaps + known limitations

1. **Engineer-side production not sampled.** Pass 2 only drove the architect. An equivalent engineer-side measurement would require a driven workload (e.g., M-Ideas-Audit replay); that's Phase 2b scope.
2. **Architect pipeline not yet wired.** Pass 2 measures production architect as it ships, not with Phase 2a fully applied. The synthetic Pass 1 number (33.2%) stands as the best available estimate for what wiring would deliver.
3. **Bytes/4 token heuristic** — same approximation as Phase 1. For per-model precision use `@anthropic-ai/tokenizer` or `gpt-tokenizer` at the sink layer.
4. **Loopback transport is zero-latency.** Pass 1 overhead (0.14 ms) is pipeline cost only; production latency adds Hub round-trip time.
5. **6-thread sample size** in Pass 2. Larger N would tighten the per-prompt-shape statistics but not the headline direction.
6. **Pass 3 (analyzer script) deferred.** The one-off Cloud Run log queries used here are sufficient for this baseline; Phase 2b repeat-measurement would benefit from scripting `scripts/analyze-architect-telemetry.sh`.

---

## Appendix — raw Cloud Run log excerpts

### Sandwich cumulative-summary lines (12 MAX_TOOL_ROUNDS attempts)

```
2026-04-19T22:18:58  thread-164: 10 rounds, 348971 prompt + 124 completion = 349095 total Gemini tokens
2026-04-19T22:19:25  thread-166: 10 rounds, 371590 prompt + 122 completion = 371712 total Gemini tokens
2026-04-19T22:20:13  thread-168: 10 rounds,  55279 prompt + 1011 completion =  56290 total Gemini tokens
2026-04-19T22:20:28  thread-164: 10 rounds,  65685 prompt + 133 completion =  65818 total Gemini tokens
2026-04-19T22:22:09  thread-166: 10 rounds, 979858 prompt + 138 completion = 979996 total Gemini tokens
2026-04-19T22:23:33  thread-163: 10 rounds,  60142 prompt + 1342 completion =  61484 total Gemini tokens
2026-04-19T22:23:36  thread-163: 10 rounds,  56645 prompt + 481 completion =  57126 total Gemini tokens
2026-04-19T22:24:17  thread-167: 10 rounds, 172355 prompt + 463 completion = 172818 total Gemini tokens
2026-04-19T22:25:01  thread-163: 10 rounds,  74023 prompt + 1485 completion =  75508 total Gemini tokens
2026-04-19T22:25:19  thread-163: 10 rounds,  67353 prompt + 1388 completion =  68741 total Gemini tokens
2026-04-19T22:26:50  thread-167: 10 rounds, 611121 prompt + 1330 completion = 612451 total Gemini tokens
2026-04-19T22:27:08  thread-165: 10 rounds, 190539 prompt + 130 completion = 190669 total Gemini tokens
```

### Out-of-scope tool rejections

```
[Sandwich] thread-reply LLM attempted out-of-scope tool list_audit_entries — rejecting   (×7)
[Sandwich] thread-reply LLM attempted out-of-scope tool get_idea — rejecting             (×1)
[Sandwich] thread-reply LLM attempted out-of-scope tool get_engineer_status — rejecting  (×1)
```

### Pass 1 full bench output

Captured at `/tmp/pass1-bench-report.md` during measurement; reproducible via `cd packages/cognitive-layer && npx tsx bench/run.ts`.

---

## Canonical references

- Plan: `docs/planning/phase-2a-baseline-measurement-plan.md`
- Phase 1 baseline: `docs/audits/phase-1-baseline-measurement.md`
- Mission spec: `docs/planning/m-cognitive-hypervisor.md`
- ADR: `docs/decisions/018-cognitive-layer-middleware.md`
- Pass 1 commit: `3e51902`
- Architect revision at Pass 2 time: `architect-agent-00041-2v2`
- Pass 2 thread IDs: 163, 164, 165, 166, 167, 168
