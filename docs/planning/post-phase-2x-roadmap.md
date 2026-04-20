# Post-Phase-2x Execution Roadmap

**Status:** Director-ratified plan, execution pending
**Proposed:** 2026-04-20
**Context:** Phase 2x closed (7 items shipped, cumulative 83% baseline token reduction + production VTS at 7.2M on N=20 run); five concurrent work streams now competing for priority.

---

## Context

Phase 2b/2c/2x have closed a hardened architect + engineer grid. Five distinct work items are in-flight or queued:

1. **idea-119 (M-QueryShape Phase 1)** — task-302 already issued by architect; smarter search/filter for entity list tools; directly targets the query-shape regression surfaced in Phase 2x P1-4 (N=20 MAX_TOOL_ROUNDS 40% → ≤10%).
2. **Threads 2.0 Phase 2** — intent→execution linkage gap (`stage_task` / `stage_proposal` / `stage_mission` cascade-stageable action types); referenced as "not yet deployed" in the architect system prompt; current workaround is out-of-band task issuance after `close_no_action` convergence.
3. **Threads 2.0 robustness audit** — breadth pass over Threads 2.0 failure modes (error handling, routing-mode edge cases, reaper semantics, convergence-gate recovery paths) — scope not yet defined, needs a brainstorm.
4. **Mission Phase 3 — State hydration + reconciliation** (idea-114, ADR-020) — canonical next mission per `docs/planning/m-cognitive-hypervisor.md`; adapter preloads authoritative Hub state into prompt preamble; `verify_thread_state` on mutating calls; re-hydrate on drift.
5. **Mission Phase 4 — Quota integration** (idea-109) — 429 backpressure signal; PendingActionItem FSM extended with `quota_blocked`; adapter detects Gemini 429s; Director notification distinguishes unresponsive vs quota-blocked.

The question: what order do we execute these in so the system stays stable while moving forward?

---

## Proposed priority order (A → I)

### P0 — Immediate execution (pre-requisite for everything downstream)

**A. idea-119 M-QueryShape Phase 1 (task-302)** — pick up + execute
**B. Threads 2.0 Phase 2 design brainstorm + ratification** — architect thread, parallel to A

### P1 — Next (structural linkage + robustness)

**C. Threads 2.0 Phase 2 implementation** (depends on B converging)
**D. Threads 2.0 robustness audit** — scope + brainstorm + mission brief

### P2 — Cognitive hardening continuation

**E. Mission Phase 3 — State hydration + reconciliation** (idea-114)
**F. idea-119 Phase 2 (list_ideas + list_threads)** — logical extension once pattern is proven in A
**G. idea-119 Phase 3 (projection + lazy indexing)** — scale-out after F lands

### P3 — Lower urgency

**H. Mission Phase 4 — Quota integration** (idea-109)
**I. Architect triage of remaining open ideas** — idea-115 (dynamic tool scope), idea-116 (tele-10), idea-118 (cross-item circuit breaker)

---

## Rationale for ordering

### Why A first

`task-302` is already issued by the architect. Leaving it un-claimed violates the task execution discipline documented in the system prompt ("ADR-017: drain the caller's pending-actions queue ... each settling action should carry the returned item's id as `sourceQueueItemId` so the Hub can completion-ack"). It's production-assigned work; the engineer role is expected to pick it up. Also: Phase 1 targets the highest-impact failure mode from the N=20 measurement, so shipping it unblocks the success criterion for the whole Phase 2x measurement cycle.

### Why B in parallel with A

B is pure design work (architect brainstorm thread), doesn't compete with A for engineer-session tool surface. Completing B's brainstorm during A's implementation gives us a ratified Threads 2.0 Phase 2 design ready for implementation the moment A ships. Serial order (A → B → C) would add ~1 brainstorm cycle of dead time between A and C.

### Why C before E (Phase 3)

Phase 3 (state hydration) is a **content** problem — what state to pre-load into the prompt. Threads 2.0 Phase 2 is a **machinery** problem — how thread convergence spawns downstream work. The machinery change is smaller (~days) than the content change (~week). Shipping C first means any Phase 3 design sessions can USE the stage_task/stage_proposal primitive from day one, tightening the design→implementation cycle for Phase 3 itself.

### Why D after C

Threads 2.0 robustness audit requires a stable Threads 2.0 feature surface. Scoping robustness work while Phase 2 is mid-flight would churn. Audit once Phase 2 has landed and the feature set is stable.

### Why F/G after E not before

idea-119 Phase 1 (A) proves the pattern on `list_tasks`. F extends it to `list_ideas` + `list_threads`; G adds projection + indexing. These are mechanical replications of the pattern, lower design risk, can defer. Phase 3 (E) is a higher-risk design step that deserves fresh attention.

### Why H last

Mission doc itself states: "Phase 4 deferred — no observed 429s to justify pull-forward." Nothing has changed to invalidate that. Ship when 429s actually appear in production telemetry.

### Why I lowest urgency

Architect-triage-pending ideas (115/116/118) are all valid but none are load-bearing for current production stability. Triage them when Phase 3 + 4 complete OR when one of them surfaces as a prerequisite for an in-flight mission.

---

## Dependency graph

```
A (task-302 Phase 1)  ──────┬─────► F (Phase 2) ─► G (Phase 3)
                            │
B (Threads 2.0 Ph2 design)  ┴─► C (Threads 2.0 Ph2 impl) ─► D (robustness audit)
                                                           │
                                                           ▼
                                                    E (Mission Phase 3)
                                                           │
                                                           ▼
                                                    H (Mission Phase 4)
                                                           │
                                                           ▼
                                                    I (triage remaining ideas)
```

A and B run in parallel. C gates D gates E gates H gates I. F and G are branch items off A, deferrable.

---

## Success criteria per item

### A. idea-119 M-QueryShape Phase 1

- `list_tasks` accepts `filter` + `sort` + existing `limit`/`offset`
- Zod-enforced operator subset: implicit eq, `$in`, `$gt`, `$lt`, `$gte`, `$lte` (dates + numbers only)
- Reject-with-hint on forbidden operators (`$regex`/`$where`/`$expr`/`$or`/`$and`/`$not`)
- `_ois_query_unmatched: true` sentinel for empty-result-but-nonempty-collection
- `ctx.tags.queryShape` telemetry tag populated
- ResponseSummarizer respects caller's `limit: N`
- Backwards-compat preserves existing scalar `status:` arg
- **Validation:** re-run N=20 harness; MAX_TOOL_ROUNDS rate drops below 10% on tool-heavy/parallel/design prompts

### B. Threads 2.0 Phase 2 design

- Architect brainstorm thread converged with ratified spec for `stage_task` / `stage_proposal` / `stage_mission` action types
- Open questions resolved (at minimum): action payload schemas, cascade execution semantics, rollback-on-cascade-failure, backwards compatibility with existing `close_no_action` pattern
- Produces a mission brief ready for C

### C. Threads 2.0 Phase 2 implementation

- New staged action types available in `create_thread_reply`
- Cascade execution binds thread → spawned entity via machine-readable linkage
- Existing `close_no_action` semantics unchanged
- Regression tests cover all new action types
- **Validation:** next M-* brainstorm thread converges WITH `stage_task` instead of out-of-band task issuance

### D. Threads 2.0 robustness audit

- Scoped deliverable list (TBD in brainstorm — likely covers: convergence-gate recovery, cascade-failure handling, reaper semantics for closed threads, empty-result semantics universally)
- Each gap has a mitigation plan OR an explicit "accept as limitation" decision
- Produces one or more mission briefs for items requiring implementation

### E. Mission Phase 3

- Adapter preloads authoritative Hub state into prompt preamble (current thread state, active tool surface filtered to role + mission, recent relevant events)
- `verify_thread_state(threadId, expectedVersion)` pre-flight on mutating tool calls
- On mismatch: adapter re-hydrates + re-drives LLM transparently
- Zero stale-state actions in observability logs
- **Deliverable:** ADR-020 (cognitive state-hydration protocol)

### F. idea-119 Phase 2

- `list_ideas` + `list_threads` gain parity with A (same filter/sort shape, same allowlist, same sentinel, same telemetry)
- Measurement: repeat Phase 2x prompt matrix; MAX_TOOL_ROUNDS rate at ≤5% across all entity-query prompts

### G. idea-119 Phase 3

- `fields:` projection supported across all list_* tools
- Range queries (`$gt`/`$lt` on strings, not just numbers + dates — if triaged relevant)
- Lazy indexing in memory store (build Map/Set on first query, not on cold start)
- **Validation:** sub-100ms p95 on list_* queries at 1000+ entity cardinality

### H. Mission Phase 4

- PendingActionItem FSM: new `quota_blocked` state
- Adapter → `signal_quota_blocked(sourceQueueItemId, retryAfterSeconds)` on 429
- Hub pauses watchdog ladder during backoff window
- Director notification severity: `quota_blocked` is "warning", `unresponsive` is "critical"
- Zero `queue_item_escalated` where root cause is 429

### I. Architect triage

- One brainstorm thread per idea (115, 116, 118), same pattern as thread-222
- Each produces either a mission brief or explicit deferral decision

---

## Risks + mitigations

### R1. A and B compete for architect attention

Architect is a single serialized session for brainstorm threads. If we open B while architect is also fielding engineer questions on A's implementation, thread-222 pattern (five rounds to ratification) could stretch. **Mitigation:** open B only after A's implementation is in progress (engineer has read task-302 and started building), so architect's questions from A are already in the backlog when B's brainstorm starts.

### R2. C introduces new cascade semantics that break existing thread flows

Adding `stage_task` / `stage_proposal` / `stage_mission` means new cascade paths. If a cascade fails mid-execution, does the thread un-converge? Stay converged but audit the failure? **Mitigation:** this is explicitly a scope question in B's brainstorm — don't ship C without it answered.

### R3. F/G drift from A's conventions

Once A ships, the filter/sort shape becomes load-bearing. If F/G implementers don't reference A's exact schemas, we get 3 similar-but-different query surfaces. **Mitigation:** A exports the shared `QueryShape` Zod schema; F/G import rather than re-declare. Architect flagged this explicitly in thread-222 ("MCP Schema Explosion").

### R4. E (Mission Phase 3) discovers state reconciliation concerns that idea-119 missed

Phase 3 adds authoritative state to the prompt preamble. If that state grows unboundedly (thread histories, tool surfaces, etc.) it could re-introduce the context-bloat problem Phase 2b ckpt-B already solved via history trim. **Mitigation:** Phase 3 brainstorm should explicitly include a size-bound discipline; measure pre-hydration prompt tokens before and after.

### R5. GCS 429 rate limit on `meta/counter.json` (observed in Phase 2x N=20)

During the N=20 bulk-create burst, 4 of 20 `create_thread` calls failed with 429 on the shared counter file. Under normal architect cadence this doesn't trigger (calls are naturally spaced), but any future burst workflow will. **Mitigation:** not in this roadmap; separate infra-hardening item. File as follow-up if it recurs.

---

## Observed gaps NOT in this roadmap (acknowledged, deferred)

- **P1-3 pagination nudge mixed result** — may have contributed to N=20 regression; re-examine after A ships (A makes pagination cursor-following mostly unnecessary because filter+sort surfaces the intended subset directly)
- **Engineer-side cognitive pipeline measurement** — wired in P1-5, no measurement harness yet; engineer-side `aggregate.py` analog is a Phase 2y infrastructure item
- **Closed-thread GC** — closed threads accumulate in the list store; noted as a scale issue in Phase 2x closing audit; will be covered by D (robustness audit) if triaged relevant
- **Idempotent counter at GCS boundary** — as above, N=20 bulk-burst issue

---

## Execution cadence

Proposed rhythm: **ship one P0/P1 item, measure with the harness, write a micro-audit, pull the next item**. Matches the Phase 2b/2c/2x cadence that produced clean per-checkpoint attribution. Contrast: batching multiple items per deploy reduces cycle count but makes regression attribution harder.

For each item:
1. Architect brainstorm (if design-heavy) → converge with ratified spec
2. Mission brief → task issuance
3. Engineer implementation + unit tests
4. Deploy with `./deploy/build.sh`
5. Measurement via `scripts/architect-telemetry/check-health.sh` (for items with measurable impact)
6. Micro-audit doc in `docs/audits/` with verdict + evidence

---

## Next actions (proposed)

1. **Engineer claims task-302** (role-registered; `get_task` → read Phase 1 spec → implement)
2. **Director opens architect brainstorm thread for Threads 2.0 Phase 2** (action-type vocabulary, cascade semantics, backwards compat) — runs in parallel
3. On A complete: measurement via harness; report; file follow-up items
4. On B converged: mission brief for C
5. Execute C
6. Scope D (robustness audit brainstorm)
7. Execute D output
8. Move to Mission Phase 3 (E)
9. Extend idea-119 (F, then G) in parallel with Phase 3 if bandwidth allows
10. Phase 4 (H) when 429s appear
11. Triage I when the queue is clear

---

## Canonical references

- Phase 2x closing: `docs/audits/phase-2x-closing.md`
- Phase 2c closing: `docs/audits/phase-2c-closing.md`
- Mission spec: `docs/planning/m-cognitive-hypervisor.md`
- Thread brainstorm ratified spec: thread-222 (summary field)
- Measurement harness: `scripts/architect-telemetry/`
- Open ideas: 115, 116, 117 (closed), 118, 119
- Task issued by architect: task-302 (M-QueryShape Phase 1 implementation)
