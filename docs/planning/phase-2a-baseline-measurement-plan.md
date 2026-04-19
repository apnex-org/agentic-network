# Phase 2a Baseline Measurement — Plan

**Status:** Approved plan; execution not yet started
**Proposed:** 2026-04-19 (session-end, pre-compaction handoff)
**Scope:** M-Cognitive-Hypervisor Phase 2a production baseline
**Authority:** Director-approved via conversation on 2026-04-19

---

## Context

Phase 1 + Phase 2a of M-Cognitive-Hypervisor are complete, deployed, and verified live on architect revision `00040-m8b` (commit `f87f552`). The synthetic Phase 1 baseline measurement (`docs/audits/phase-1-baseline-measurement.md`) captured a **67.8% Hub-side call reduction** but was a bench-only result and predates Phase 2a's ResponseSummarizer.

The architect-ratified **Virtual Tokens Saved** KPI (thread-160 round 2) is now instrumented but has not yet been measured end-to-end under production workload. This plan closes that gap.

## Goal

Produce `docs/audits/phase-2a-baseline-measurement.md` — a canonical production measurement report that answers:

1. How much does ResponseSummarizer reduce token pressure on read-heavy tools? (synthetic delta)
2. What is the production Gemini-token cost distribution per architect sandwich? (aggregate from live logs)
3. Did `MAX_TOOL_ROUNDS` failures (the original M-Ideas-Audit failure class) actually go to zero? (finishReason distribution)
4. What is the cumulative Virtual Tokens Saved rate on a realistic architect workload?
5. Which Phase 2b middleware (StaleWhileRevalidate, GranularMatrix, ParallelBatchSuggester) does the data suggest matters most?

## Three-pass design

### Pass 1 — Synthetic bench re-run (~30 min, clean numbers)

Re-run `packages/cognitive-layer/bench/run.ts` unchanged — its `.standard()` pipeline now includes ResponseSummarizer, so the numbers reflect Phase 2a by construction.

**Baseline mode:** CognitiveTelemetry only (same as Phase 1 baseline).
**Cognitive mode:** full `.standard()` — Telemetry + CircuitBreaker + WriteCallDedup + ToolResultCache + **ResponseSummarizer (new)** + ToolDescriptionEnricher + ErrorNormalizer.

Scenarios already shipped in `packages/cognitive-layer/bench/scenarios.ts`:
- `audit-workflow` — read-heavy passes
- `duplicate-write-storm` — dedup target
- `read-cache` — 20× identical `list_ideas`
- `thread-convergence` — full workflow
- `schema-drift` — error rewriter

**New metrics to highlight vs Phase 1 baseline:**
- **Virtual Tokens Saved** — aggregated from `ctx.tags.virtualTokensSaved` via AggregatingTelemetrySink
- `summarizedCallCount` / `toolCalls` ratio
- Before/after delta on `list_ideas` output token volume (expected ~10× reduction)

**Execution:** from `packages/cognitive-layer/`, `npx tsx bench/run.ts 2>/dev/null | tail -80` — same pattern as Phase 1.

---

### Pass 2 — Driven architect workload (~1 hour, real Gemini numbers)

Open 5-8 threads to the live architect with varied prompt shapes covering common patterns:

| # | Prompt shape | Target failure mode |
|---|---|---|
| 1 | Simple ack — "Please acknowledge with one line." | Baseline 1-2 round case |
| 2 | Ideation / open-ended — "What's your view on X?" | Moderate 2-3 round case |
| 3 | Tool-heavy read — "Review the open threads and summarize." | Exercise list_* calls → ResponseSummarizer |
| 4 | Design analysis — "Analyse idea-107 and propose refinements." | Exercise get_idea pipeline |
| 5 | Parallel-candidate — "Fetch idea-107, idea-104, idea-108 and compare." | Exercise parallel tool execution |
| 6 (optional) | Error path — intentionally-mistyped tool name | Exercise ErrorNormalizer in production |

For each thread, after architect converges, collect from Cloud Run logs:
- All `[Sandwich] thread-reply ...` cumulative summaries
- All `[ArchitectTelemetry] llm_usage` JSON events
- Hub-side call counts (via `list_audit_entries` filtered by thread or via direct Hub log query)

**Aggregate into tables:**
- Per-thread: rounds, prompt+completion tokens, parallel-call count, finish-reason distribution
- Summary: p50/p95/max round count, p50/p95 tokens per reply, virtualTokensSaved total, parallel-call rate
- Distribution of finish reasons (STOP vs UNEXPECTED_TOOL_CALL vs MAX_TOOL_ROUNDS — this last one is the M-Ideas-Audit failure class)

---

### Pass 3 — Repeatable aggregation tooling (~30 min)

Ship a small script: `scripts/analyze-architect-telemetry.sh`.

**Input:** time window (e.g., `--freshness=2h`) or explicit thread-ID filter.

**Output:** aggregated table of the Pass-2 metrics above.

**Implementation:**
- `gcloud logging read` queries for `[ArchitectTelemetry]` + `[Sandwich]` lines
- `jq`-based JSON extraction for the llm_usage events
- Summary stats via simple awk / Node inline

Makes future measurement cycles a one-command job.

---

## Output artifact

`docs/audits/phase-2a-baseline-measurement.md` with sections:

1. **Executive summary** — one paragraph + key numbers
2. **Pass 1 — synthetic bench results** — before/after tables; ResponseSummarizer impact featured
3. **Pass 2 — production workload results** — per-thread + aggregate; finishReason distribution
4. **Virtual Tokens Saved** — architect-named Phase 2 primary KPI, featured section
5. **Comparison to M-Ideas-Audit retrospective** — did the 10× `auto_thread_reply_failed` class actually reduce?
6. **Gaps + known limitations** — small sample size for Pass 2; synthetic ≠ production; bytes/4 approximation
7. **Phase 2b implications** — which of StaleWhileRevalidate, GranularMatrix, ParallelBatchSuggester the data suggests to prioritize
8. **Appendix** — raw Cloud Run log excerpts for the 5-8 driven threads

---

## Scope bounds (explicitly NOT in this work)

- No new middleware code — measurement only
- No model-specific tokenizer — keeping `bytes/4` approximation consistent with Phase 1 baseline for apples-to-apples comparison
- No Hub-side deploy changes
- No architect code changes beyond what's already shipped in `f87f552`

---

## Total time estimate

~2-3 hours active work. Pass 2 latency dominated by architect response time (~2-15s per round).

---

## Two open questions before starting

1. **Prompt source for Pass 2** — pull real-world prompts from recent Cloud Run logs (production-faithful) OR construct synthetic prompts (reproducible)?
2. **Framing** — compare Phase 2a directly against Phase 1's 67.8% (cumulative mission impact) OR frame Phase 2a as a separate delta (additional-impact-over-Phase-1)?

*(Both questions can be answered when execution begins; non-blocking.)*

---

## Resumption pointer

**This document contains everything needed for the next session to execute this plan.**

Immediate next step on resume:
1. Read this doc
2. Confirm architect is online (`list_available_peers role="architect"`)
3. Start with Pass 1 — `cd packages/cognitive-layer && npx tsx bench/run.ts 2>/dev/null | tail -80`
4. Then Pass 2 — drive 5-8 architect threads per the prompt-shape matrix above
5. Aggregate results, write the report, commit as `docs/audits/phase-2a-baseline-measurement.md`

## Canonical references

- Mission spec: `docs/planning/m-cognitive-hypervisor.md` (Phase 1 + Phase 2a status reflected in execution table)
- ADR: `docs/decisions/018-cognitive-layer-middleware.md` (Accepted)
- Phase 1 baseline report: `docs/audits/phase-1-baseline-measurement.md` (67.8% synthetic)
- Phase 2a design thread: thread-160 (converged, in Hub state)
- Phase 2a ckpt-C verification thread: thread-162 (converged, 11 llm_usage events captured in logs)
- Architect live revision: `architect-agent-00040-m8b`
- Last committed state: `f87f552` [M-Cognitive-Hypervisor Phase 2a CLOSED]
