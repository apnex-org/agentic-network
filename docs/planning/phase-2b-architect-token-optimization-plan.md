# Phase 2b — Architect Token / Context Waste Optimization Plan

**Status:** Proposed plan; execution not yet started
**Proposed:** 2026-04-20
**Scope:** M-Cognitive-Hypervisor Phase 2b — conclusively solve MAX_TOOL_ROUNDS on the architect and reduce per-sandwich Gemini token spend
**Authority:** Director-approved via conversation on 2026-04-20
**Predecessor:** `docs/audits/phase-2a-baseline-measurement.md` (Pass 2 surfaced the three root causes this plan addresses)

---

## Context

Phase 2a's baseline measurement (Pass 2) observed 3.7M Gemini tokens burned across 6 driven architect threads, with **82% of spend going to sandwich attempts that hit MAX_TOOL_ROUNDS**. Root-cause analysis identified three distinct drivers — none of which Phase 2a's shipped middleware addresses:

1. **Sandwich-scope prompt leak** — `ARCHITECT_SYSTEM_PROMPT` advertises 20+ tool names; sandwich-thread-reply only declares 10; Gemini calls from the bigger set, each rejection burns a round.
2. **Accumulated history** — `generateWithTools` never trims prior-round tool-result blobs from `contents[]`; prompt tokens grow 50-120× between round 1 and round 10.
3. **Architect-side cognitive pipeline missing** — `hub-adapter.ts:80` instantiates `McpAgentClient` without `cognitive`, so ResponseSummarizer / cache / dedup never run on the architect's Hub request surface.

Phase 2b closes all three, in priority order.

## Goal

Reduce architect Gemini token spend on thread-166-class workloads by **≥80%** and eliminate MAX_TOOL_ROUNDS exhaustion as a production-visible failure class.

## Success criteria (measurable)

Re-run Pass 2 (6 threads, same prompt-shape matrix) after each checkpoint and compare to the 2026-04-19 baseline (3.7M tokens, 12 MAX_TOOL_ROUNDS attempts):

| Milestone | Token-spend target | MAX_TOOL_ROUNDS target |
|---|---|---|
| ckpt-A (scope override) | ≤ 1.5M | ≤ 3 attempts |
| ckpt-B (history trim) | ≤ 750k | 0 attempts |
| ckpt-C (pipeline wired) | ≤ 500k | 0 attempts |

Also, Virtual Tokens Saved emitted by architect-side `[ArchitectTelemetry]` events after ckpt-C: **non-zero** (currently 0).

---

## Three-checkpoint design

### ckpt-A — Sandwich-scope system-prompt override

**Root cause:** `ARCHITECT_SYSTEM_PROMPT` (`agents/vertex-cloudrun/src/llm.ts:94-137`) names tools the sandwich rejects.

**Change:** Don't modify `ARCHITECT_SYSTEM_PROMPT` (it's used by multiple call paths — director-chat, sandwich, etc.). Instead, when `sandwich.ts` enters thread-reply mode, inject a **scope-override preamble** that Gemini reads first:

```
SANDWICH SCOPE OVERRIDE — THREAD-REPLY CONTEXT
This reply operates under a restricted tool scope. In this context,
you may ONLY call these tools:
  - create_thread_reply (MANDATORY — post your reply)
  - get_thread, list_threads, close_thread
  - get_document, list_documents
  - list_tasks, get_task, cancel_task
  - get_pending_actions

ALL OTHER TOOLS mentioned in the general system prompt are
OUT-OF-SCOPE for this sandwich. Calling them will fail the round
without advancing. Specifically:
  - list_audit_entries, create_audit_entry — NOT AVAILABLE here
  - get_idea, list_ideas, update_idea      — NOT AVAILABLE here
  - get_engineer_status                    — NOT AVAILABLE here
  - create_task, create_proposal_review    — NOT AVAILABLE here

Post your reply via create_thread_reply in a single round.
```

The list is derived from `THREAD_REPLY_TOOLS` (`sandwich.ts:329-346`), so it stays synchronized — add an exported const + a small helper that builds both the override text and the allowlist from the same source.

**Files touched:**
- `agents/vertex-cloudrun/src/sandwich.ts` (build + prepend override)
- `agents/vertex-cloudrun/src/llm.ts` (accept preamble-override parameter on `generateWithTools`)

**Tests:**
- Unit test: `buildSandwichScopeOverride(allowlist)` produces text naming exactly those tools as ALLOWED and at least 3 common leaked tools as NOT AVAILABLE.
- Integration test (loopback): invoke sandwich thread-reply with a stub LLM that tries `list_audit_entries`; assert it receives the structured rejection + never calls it again within the same sandwich.

**Exit criteria:** Re-run Pass 2 thread-166 prompt-shape; observe ≤ 1 `[Sandwich] thread-reply LLM attempted out-of-scope tool` per sandwich vs. Pass 2's typical 3-10.

**Estimated diff:** ~30-40 lines.

---

### ckpt-B — Round-to-round history trimming

**Root cause:** `generateWithTools` (`llm.ts:411-520`) accumulates every tool result in `contents[]` without trimming.

**Change:** Before each LLM call in the round loop, walk `contents[]` from the end backwards; for any tool-result part older than `historyWindow` rounds (default 3), replace its payload with a stub:

```ts
// Keep turn structure — Gemini requires alternating role + tool turns.
// Replace payload only.
contents[i].parts = contents[i].parts.map(part => {
  if (part.functionResponse && /* older than window */) {
    const elidedTokens = Math.ceil(JSON.stringify(part.functionResponse.response).length / 4);
    return {
      functionResponse: {
        name: part.functionResponse.name,
        response: {
          _ois_elided: true,
          note: `Result from round ${originalRound} elided; ${elidedTokens} tokens reclaimed. Re-call the tool if you need the data.`,
        },
      },
    };
  }
  return part;
});
```

Config knobs on `CognitiveOptions` (`llm.ts` — already imports this type):

```ts
interface CognitiveOptions {
  // ... existing fields
  historyTrimWindow?: number;     // rounds before elision; default 3
  historyTrimMinTokens?: number;  // only elide results larger than this; default 500
}
```

Elide only large results (default > 500 tokens) — small results are cheap to keep and preserve context; the big ones are what swamp the window.

**Files touched:**
- `agents/vertex-cloudrun/src/llm.ts` (add `trimStaleToolResults` helper + per-round call into the existing while loop)

**Tests:**
- Unit test: `trimStaleToolResults([round-1 big result, round-2 small result, round-6 big result], currentRound=6, window=3)` → round-1 elided, round-2 kept (small), round-6 kept (fresh).
- Round-budget test: simulate 10-round loop with a 50kB tool result at round 1; verify round-10 prompt tokens stay within ~2× round-5 prompt tokens (vs. baseline linear growth).

**Exit criteria:** Re-run Pass 2 thread-166; round-10 prompt ≤ 2× round-5 prompt (today's ratio is ~2.5×, but baseline starts at 99k at round 7 — after trim, expect round-10 ≤ ~50k).

**Estimated diff:** ~40-60 lines.

---

### ckpt-C — Wire architect-side cognitive pipeline

**Root cause:** `agents/vertex-cloudrun/src/hub-adapter.ts:80-91` does not pass `cognitive` to `McpAgentClient`.

**Change:**

```ts
// At top of file:
import { CognitivePipeline } from "@ois/cognitive-layer";
import { architectTelemetry } from "./telemetry.js";

// In the McpAgentClient instantiation:
this.agent = new McpAgentClient(
  { role, labels, logger, handshake },
  {
    transportConfig: { url: hubUrl, token: hubToken },
    manualSync: true,
    cognitive: CognitivePipeline.standard({
      telemetry: { sink: architectTelemetry.sink },
    }),
  }
);
```

**Design note:** the sandwich already wires `architectTelemetry.emitLlmUsage` for per-round Gemini accounting. Wiring `.standard()` here adds `kind: "tool_call"` events to the same sink, so the existing `[ArchitectTelemetry]` log stream will include Hub-call telemetry (inputBytes, outputBytes, cacheHit, summarized, virtualTokensSaved) automatically.

**Files touched:**
- `agents/vertex-cloudrun/src/hub-adapter.ts` (2 new imports + 1 new option on instantiation)

**Tests:**
- The existing `packages/cognitive-layer` test suite exercises the pipeline components. This checkpoint is a wiring change, covered by the Pass-3 re-run.

**Exit criteria:** Run one architect thread; observe `[ArchitectTelemetry] {"kind":"tool_call", ...}` events in Cloud Run logs with non-zero `summarized` / `cacheHit` tags.

**Deploy dance:** same as Phase 2a ckpt-C — rebuild cognitive-layer + network-adapter tarballs, copy to `agents/vertex-cloudrun`, Docker build, `deploy/build.sh architect`, force revision label if digest stays pinned.

**Estimated diff:** ~5-10 lines (wiring only).

---

## Sequencing + dependencies

```
ckpt-A (scope override)
    │
    └──► measure Pass 2 baseline #2
            │
            ├─ if FR-SCOPE-REJECT eliminated: proceed to ckpt-B
            └─ if rejections persist: diagnose system-prompt leak source
                  (thread-history? Gemini training? add to override text)

ckpt-B (history trim)
    │
    └──► measure Pass 2 baseline #3
            │
            ├─ if round-10 prompt ≤ 2× round-5: proceed to ckpt-C
            └─ if still linear: tune historyTrimWindow / historyTrimMinTokens

ckpt-C (pipeline wire)
    │
    └──► measure Pass 2 baseline #4 (final)
            │
            └─ compare vs. 2026-04-19 baseline; write Phase 2b closing audit
```

Each checkpoint measurable in isolation — supports incremental deploy + rollback if any step regresses.

## Scope bounds (explicitly NOT in this phase)

- **No changes to Hub-side policy, scope rules, or tool contracts** — this is architect-side optimization only
- **No director-chat sandwich changes** — thread-reply is the Pass-2-surfaced hot path; director-chat is separate and awaits the universal-adapter/ACP redesign
- **No engineer-side cognitive work** — Phase 2b engineer-side measurement is its own future plan
- **No tokenizer upgrade** — keeping `bytes/4` heuristic for apples-to-apples comparison with Phase 1 + Phase 2a baselines

## Total time estimate

~4-6 hours active work across 3 checkpoints. Plus one Pass-2 re-measurement after each (~30 min each) = ~1.5 hours measurement overhead.

## Resumption pointer

On resume, immediate next step:
1. Read this plan + `docs/audits/phase-2a-baseline-measurement.md`
2. Begin ckpt-A — sandwich-scope system-prompt override
3. Unit tests first, then integration test against loopback hub, then Pass-2 re-measurement
4. Commit per checkpoint; ship per checkpoint; measure per checkpoint

## Canonical references

- Baseline measurement: `docs/audits/phase-2a-baseline-measurement.md`
- Phase 1 baseline: `docs/audits/phase-1-baseline-measurement.md`
- Mission spec: `docs/planning/m-cognitive-hypervisor.md`
- ADR: `docs/decisions/018-cognitive-layer-middleware.md`
- Affected code:
  - `agents/vertex-cloudrun/src/sandwich.ts:329-346` (THREAD_REPLY_TOOLS allowlist)
  - `agents/vertex-cloudrun/src/llm.ts:94-137` (ARCHITECT_SYSTEM_PROMPT)
  - `agents/vertex-cloudrun/src/llm.ts:411-520` (generateWithTools round loop)
  - `agents/vertex-cloudrun/src/hub-adapter.ts:80-91` (McpAgentClient instantiation)
