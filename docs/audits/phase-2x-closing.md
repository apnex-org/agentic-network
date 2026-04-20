# M-Cognitive-Hypervisor Phase 2x — Closing Audit

**Date:** 2026-04-20
**Scope:** Close Phase 2x — stability/resilience/robustness consolidation between Phase 2c and original mission Phase 3
**Predecessors:** `docs/audits/phase-2c-closing.md` (failure-amplification class squashed)
**Successor:** Original mission Phase 3 (state hydration + reconciliation, idea-114)

---

## Executive summary

Phase 2x was proposed post-Phase-2c as a consolidation phase: ship infrastructure hardening and measurement discipline before starting the original mission Phase 3. Seven items across three priorities (P0 resilience, P1 robustness, P2 technical-debt reduction), all shipped.

One material finding surfaced during P1-4 (N=20 measurement): **Phase 2b's 83% token-reduction headline was conditional on the dataset size at time of measurement**. The Hub has grown since ckpt-C (294 tasks, 118 ideas, 200+ threads vs ~150/80/~thread-163 then). Complex prompts (tool-heavy, parallel, design) regressed to 40% MAX_TOOL_ROUNDS rate. Root cause: tool-surface query shape mismatch — when the LLM needs a sorted/filtered subset of a large collection (e.g., "oldest 3 tasks"), paginated random-sample responses don't serve the query. Filed as idea-119 with a full design surface (filter + sort + projection across list_* tools) for dedicated architect brainstorm.

Phase 2x itself is successful. The regression surfaced is a legitimate discovery, not a ship-blocker — Virtual Tokens Saved reached 7.2M (12× higher than ckpt-C), MAX_TOOL_ROUNDS remained bounded (not runaway) by the Phase 2c watchdog policy, and the architect now operates on a fully-hardened stack with GCS-persistent state, a ratified regression gate, Director-first-class RBAC, and a deploy-script that actually deploys.

---

## Shipped (7 items)

### P0 — Resilience (locking in what's shipped)

**P0-1: GCS persistence for pending-action queue + director-notification store** (commit `e592ff9`)
ADR-017 follow-up that became load-bearing after Phase 2b-B's Hub restarts wiped the memory-only queue twice. New `GcsPendingActionStore` + `GcsDirectorNotificationStore` mirror the existing entity-store pattern. Counters extended (`pendingActionCounter`, `directorNotificationCounter`). 8 new unit tests cover round-trip persistence across fresh store instances, natural-key idempotency, terminal-state idempotence, listStuck + listExpired + incrementAttempt persistence. Live on `hub-00031-sjc`.

**P0-2: Automated regression gate wrapper** (commit `6722959`)
`scripts/architect-telemetry/check-health.sh` auto-discovers the latest architect revision + runs `aggregate.py` against the ratified targets. Emits single-line `HEALTHY` / `REGRESSION` / `INFRA_ERROR` markers suitable for Cloud Scheduler + Cloud Monitoring log-based alerts. README documents the full scheduling recipe (Dockerfile + gcloud commands + IAM roles + alert filter). One `gcloud scheduler jobs create` away from hourly automated regression detection.

### P1 — Robustness (closing observed behavioural gaps)

**P1-3: Pagination-hint-following nudge** (commit `9de0231`)
Added `_ois_pagination` protocol teaching to `ARCHITECT_SYSTEM_PROMPT`. LLM learns: when `_ois_pagination.next_offset: N` appears in a response, either re-call with `offset: N` OR proceed with the first page; never re-call with identical args. `test/system-prompt.test.ts` regression-pins the three load-bearing prompt sections (Threads-2.0 gate, role tags, pagination protocol). Live on `architect-agent-00048-hxs`.

**P1-4: Phase 2b-B N=20 measurement** (commit `9de0231` artefact set, no code)
20 threads driven across the 5-prompt matrix against the fully-hardened stack. Results documented in-audit below. **Surfaced idea-119** (query-shape engineering as a distinct Precision Context Engineering axis from response-shape engineering).

**P1-5: Engineer-side cognitive pipeline wiring** (commit `a6153a7`)
Mirrors Phase 2b ckpt-C's architect-side change across both engineer shims. `adapters/claude-plugin/src/shim.ts` and `adapters/opencode-plugin/src/shim.ts` now pass `cognitive: CognitivePipeline.standard(...)` into their `McpAgentClient` constructor. Telemetry flows via `[ClaudePluginTelemetry]` / `[OpencodePluginTelemetry]` log prefixes for observability parity with the architect. Full grid now runs the same middleware stack. 54/54 plugin tests pass.

### P2 — Technical debt

**P2-6: First-class Director role in RBAC** (commit `f934aea`)
`RoleTag` (single-value union) → `RoleSet` (`ReadonlySet<Role>`). Composite tags: `[Architect|Director]` parsed as `{"architect", "director"}` and enforced at the router. Two inline role checks in Phase 2c admin tools (`prune_stuck_queue_items`, `force_close_thread`) removed; declared declaratively via the composite tag. RBAC error message now lists the full permitted role set. 4 new tests pin the new parsing + enforcement semantics.

**P2-7: Deploy-script hardening** (commit `3ea2a1b`)
Terraform was silently leaving the current Cloud Run revision in place when the image tag resolved to the same digest — biting ~6 times during Phase 2b/2c/2x development (every deploy required a manual `gcloud run services update --update-labels=deploy-ts=...` after). Baked that into `deploy/build.sh` via a post-`terraform apply` revision-force step. New Terraform outputs (`region`, `hub_service_name`, `architect_service_name`) feed the script without hardcoded values. Smoke-tested end-to-end.

---

## Phase 2b-B N=20 measurement — results + finding

Driven against `architect-agent-00048-hxs` (scope override + history trim + cognitive pipeline + pagination nudge all active; GCS-persistent queue via Hub `hub-00031-sjc` behind it). 20 threads across 5 prompt shapes (4 each: simple-ack, ideation, tool-heavy, design-analysis, parallel-candidate).

| Metric | Baseline (2a) | Phase 2c (N=6) | **Phase 2x (N=20)** | Note |
|---|---:|---:|---:|---|
| Virtual Tokens Saved | 0 | 620k | **7,204,727** | 12× ckpt-C — ResponseSummarizer firing 35.9% of tool calls against the grown dataset |
| tool_call telemetry events | 0 | 74 | 393 | Full architect-side pipeline firing |
| Cache hits | 0 | 2 | 16 | Architect-side ToolResultCache engaged |
| Summarize rate | 0% | 20% | 35.9% | More oversized responses against larger dataset |
| MAX_TOOL_ROUNDS rate | 33% (2/6) | 17% (1/6) | **40% (8/20)** | Regression |
| p50 tokens / thread | ~617k | 106k | 111k | ~Same p50 |
| p95 tokens / thread | — | — | 776k | New tail risk |
| Out-of-scope rejections | 9 | 0 | 1 | One self-test artefact from prompt matrix |

**Per-prompt breakdown (N=4 each):**
- `simple-ack` — 4/4 clean, 13-24k each ✅
- `ideation` — 4/4 clean, 13-14k each ✅
- `tool-heavy` — 1/4 clean, 3/4 MTR (up to 1.55M tokens) ✗
- `design-analysis` — 2/4 clean, 2/4 MTR ✗
- `parallel-candidate` — 1/4 clean, 3/4 MTR ✗

**Root cause — from thread-210 transcript (tool-heavy-3, "find the 3 oldest tasks using list_tasks"):** per-round prompts stayed flat at ~20-50k (history trim working correctly). The LLM did NOT hit a context explosion. It exhausted all 10 rounds making tool calls without converging. `list_tasks` returned 294 items; ResponseSummarizer truncated to 10 + `_ois_pagination`; the LLM saw 10 RECENT tasks (Hub's default ordering) rather than oldest-3, then pursued the pagination cursor or abandoned.

The underlying mismatch: **the LLM needed a sorted/filtered subset ("oldest 3 tagged audit"), not a paginated random sample**. Pagination cursor-following is a workaround, not a solution for queries that are filter/sort-shaped.

**This is a new class distinct from the four Phase 2b/2c squashed classes**:
- FR-SCOPE-REJECT (Phase 2b ckpt-A): squashed
- Accumulated-history growth (ckpt-B): squashed
- Architect pipeline unwired (ckpt-C): squashed
- Failure-amplification via unbounded retry (Phase 2c): squashed
- **Query-shape engineering** (Phase 2x discovery): OPEN — filed as idea-119

Idea-119 proposes filter + sort + field-projection on all `list_*` tools plus a query-cookbook prompt-side complement. Architect brainstorm thread to be driven next.

**Honest framing of the N=20 headline:** the dataset got harder. Phase 2b's 83% was real but conditional. Fix path is well-understood (idea-119). System remains stable in the sense that MAX_TOOL_ROUNDS is bounded (not runaway — Phase 2c's retry policy holds), and production Virtual Tokens Saved is 12× higher. The observed regression is legitimate tail-risk on complex prompts, not a class that produces unbounded cost.

---

## Open ideas surfaced during Phase 2x (architect triage pending)

- **idea-119** — Smarter search/filter for entities — query-shape engineering as a distinct Precision Context Engineering axis. Filter + sort + projection across `list_*` tools; query-cookbook prompt-side complement. 5 architect-triage scope questions.
- **idea-118** — Cross-item circuit breaker (Phase 2c criterion #4 deferred) — still valid, still pending
- **idea-116** — Tele-10 "Precision Context Engineering" proposal — still pending
- **idea-115** — Dynamic tool scope management — still pending

Phase 3 sequencing after architect triage: idea-119 is the most directly actionable follow-up, with clear empirical backing from this measurement. The other three ideas remain valid but less production-urgent.

---

## Cumulative M-Cognitive-Hypervisor scorecard

| Phase | Headline | Status |
|---|---|---|
| 1 | 67.8% Hub-call reduction (synthetic) | CLOSED |
| 2a | ResponseSummarizer + PartialFailure + llm_usage bridge shipped live | CLOSED |
| 2b | 83% Gemini-token reduction (N=6 matrix) | CLOSED |
| 2c | Failure-amplification class squashed | CLOSED |
| 2x | Stability + resilience + robustness consolidation | **CLOSED (this audit)** |

Mission still open. Phase 3 (state hydration + reconciliation, idea-114, ADR-020) and Phase 4 (quota integration, idea-109) remain canonical per `docs/planning/m-cognitive-hypervisor.md`. Neither has been pulled forward during Phase 2x — Phase 2x was explicitly consolidation, not displacement.

---

## Operator runbook additions from Phase 2x

### Run the regression gate

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
  scripts/architect-telemetry/check-health.sh --freshness 1h
```

Exit 0 = healthy; 1 = regression (alert Director); 2 = infra error.

### Force-close a stuck thread (Phase 2c tool, now Director-role-accessible)

```
force_close_thread({
  threadId: "thread-XXX",
  reason: "short rationale"
})
```

Called by Architect or Director. Atomically closes the thread + abandons any non-terminal queue items.

### Prune stuck queue items (Phase 2c tool, now Director-role-accessible)

```
prune_stuck_queue_items({
  olderThanMinutes: 15,
  dryRun: true   // preview first
})
```

### Deploy

```bash
./deploy/build.sh hub       # Hub only
./deploy/build.sh architect # Architect only
./deploy/build.sh           # both
```

Each deploy now automatically forces a new Cloud Run revision — no more manual `gcloud run services update --update-labels=...` follow-up.

---

## Declarations

Phase 2x closes with all seven items shipped + regression-guarded. Production Hub now:
- Persists pending-action queue across restarts (no more wipe-on-restart)
- Has a documented + ratified regression gate (one gcloud-scheduler command from hourly automation)
- Teaches the LLM about `_ois_pagination` protocol
- Runs the cognitive pipeline on architect + both engineer shims
- Treats Director as a first-class RBAC role
- Deploys reliably via a single `./deploy/build.sh` invocation

The N=20 measurement surfaced a valid tail-risk regression (query-shape mismatch on complex prompts against grown dataset). That is a Phase 3-adjacent concern filed as idea-119 for dedicated architect brainstorm, not a Phase 2x ship-blocker.

---

## Canonical references

- Predecessor: `docs/audits/phase-2c-closing.md`
- Telemetry harness: `scripts/architect-telemetry/`
- Regression gate: `scripts/architect-telemetry/check-health.sh`
- Follow-up idea: idea-119 (query-shape engineering)
- Shipped commits:
  - `e592ff9` — P0-1: GCS persistence for pending-action queue
  - `6722959` — P0-2: health-check wrapper + Cloud Scheduler recipe
  - `9de0231` — P1-3: pagination-hint-following nudge
  - `a6153a7` — P1-5: engineer-side cognitive pipeline wiring
  - `f934aea` — P2-6: first-class Director role in RBAC
  - `3ea2a1b` — P2-7: deploy-script hardening
