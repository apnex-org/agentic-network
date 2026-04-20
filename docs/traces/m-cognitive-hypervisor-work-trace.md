# M-Cognitive-Hypervisor — Work Trace (live state)

**Mission scope.** Tracks all in-flight, queued, and recently-completed work under the M-Cognitive-Hypervisor mission (spec: `docs/planning/m-cognitive-hypervisor.md`). Work-traces live in `docs/traces/` (separate from `docs/planning/` design artifacts). Naming: `<mission-slug>-work-trace.md`, one per overall mission. When a new overall mission is adopted, drop a new trace file into `docs/traces/`; archive a closed trace by renaming to `<mission-slug>-work-trace.closed.md`.

**What this is.** Living document. Tracks every in-flight item, its dependencies, and recent session history. Updated whenever an item changes state. Single source of truth for "what's happening right now" across sessions.

**How to read.** Skim the **resumption pointer** first; then the three status sections (In-flight / Queued / Done this session); then the edges if you need dependency context. Use the session log at the bottom to reconstruct history across restarts.

**Update discipline.**
- Flip a status prefix when state changes (▶/✅/○/⏸)
- Add new items under the right section — never create a parallel list
- Append to session log; don't edit prior entries
- Update resumption pointer when the "current in-flight" changes

**Status legend.**
- ▶ in-flight (currently working or next-up)
- ✅ done (this session; moves to closing audit on phase close)
- ○ queued / filed (waiting on dependency or triage)
- ⏸ deferred (explicit decision to not pursue now)

---

## Resumption pointer (cold-session brief)

If you're picking up cold, read in this order:

1. **This file, then** `docs/audits/phase-2x-closing.md` (most recent closed phase) and `docs/audits/phase-2c-closing.md` (preceding).
2. **Current in-flight:** D-CP1 (task-304) — Phase 2d CP1 observability + invariant audit. Architect pre-assigned to engineer `eng-0d2c690e7dd5` on creation; Hub status = `working`. No engineer output yet — awaiting director go-ahead to begin implementation.
3. **Awaiting architect triage:** idea-115 (dynamic tool scope), idea-116 (tele-10 Precision Context Engineering), idea-118 (cross-item circuit breaker), **idea-120 (entity-provenance unification — blocks F)**.
4. **Deferred:** H (Phase 4 quota — no 429s observed), bug-13 (id-sort lexicographic tail refinement).
5. **Role & session plumbing.** Role is set by the adapter at startup (plugin config / `hub-config.json`) — not by the LLM. `McpAgentClient.runHandshake` auto-calls `register_role` on connect; do not re-register. MCP tool-discovery is per-session — if Hub shipped new tools since last connect, restart the session. If role uncertain, confirm via `get_engineer_status`.
6. **Recent commits:** `git log --grep='M-Cognitive-Hypervisor\|task-30' --oneline -20` for code trail.

---

## In-flight

- ▶ **D-CP1 (task-304)** — Phase 2d Checkpoint 1: Observability + Invariant Audit. Shadow INV-TH* near-breach logging, cascade-failure-type metrics, idempotency-contract audit of `*ActionSpec` handlers + contract tests, baseline measurement of gap surface. Pre-assigned on creation to `eng-0d2c690e7dd5`; Hub status = `working`; no output yet. Awaiting director go-ahead to begin implementation.
- ▶ **idea-120** — Entity-provenance unification brainstorm open as **thread-225** (unicast, architect's turn). **Blocks F (idea-119 Phase 2).** Proposal text updated with `createdBy: {role, agentId, at}` design + 6 triage questions + migration plan.

---

## Queued / filed

- ○ **D-CP2** — Phase 2d Checkpoint 2: Protocol standardization + messaging. `ThreadConvergenceGateError` → instructional format; universal `_ois_query_unmatched`; stale-staged-action revalidation. Gated on D-CP1.
- ○ **D-CP3** — Phase 2d Checkpoint 3: Reaper + lifecycle GC + queue/thread bidirectional integrity. Summary-only truncation on close; `pending_action.abandon` on thread GC; thread-side event on `prune_stuck_queue_items`. Gated on D-CP2.
- ○ **D-CP4** — Phase 2d Checkpoint 4: `retry_cascade` tool. Gated on D-CP1's handler-idempotency-contract certification.
- ○ **E** — Mission Phase 3 (state hydration + reconciliation, idea-114, ADR-020). Adapter preloads authoritative Hub state into prompt preamble; `verify_thread_state` pre-flight on mutating calls; re-hydrate on drift. Original canonical mission Phase 3. Gated on Phase 2d completion.
- ○ **F** — idea-119 Phase 2. Extend filter+sort to `list_ideas` + `list_threads` + other list_* tools. Gated on **idea-120** triage (entity-provenance unification is a prerequisite to avoid per-entity naming drift).
- ○ **G** — idea-119 Phase 3. Projection (`fields:`) + lazy indexing. Gated on F.
- ○ **idea-115** — Dynamic tool scope management. Architect-triage-pending.
- ○ **idea-116** — Tele-10 "Precision Context Engineering" proposal. Architect-triage-pending.
- ○ **idea-118** — Cross-item circuit breaker (idea-117 criterion #4 deferred). Architect-triage-pending.
- ⏸ **H** — Mission Phase 4 (quota integration, idea-109). Deferred per mission doc — no observed 429s to justify pull-forward.
- ⏸ **bug-13** — `list_tasks` sort on `id` is lexicographic, not numeric. Minor severity; workaround = sort by `createdAt`. Absorbs into idea-119 Phase 2 scope (new `entity-id` typed field comparator).

---

## Done this session

- ✅ **Phase 2x CLOSED** — 7 items shipped: GCS persistence (P0-1), health-check wrapper (P0-2), pagination nudge (P1-3), engineer-side pipeline (P1-5), first-class Director RBAC (P2-6), deploy-script hardening (P2-7). Closing audit `docs/audits/phase-2x-closing.md`. Commit `7c83faa`.
- ✅ **A (task-302)** — M-QueryShape Phase 1: `list_tasks` filter + sort + `_ois_query_unmatched` + queryShape telemetry + Summarizer-respects-limit. Brainstorm: thread-222. Commit `177fb84`. Architect-reviewed ✓.
- ✅ **B (thread-223)** — Threads 2.0 Phase 2 design brainstorm. 5 rounds, bilateral convergence. Ratified Phase 2a scope.
- ✅ **C (task-303)** — Threads 2.0 Phase 2a: per-action commit authority (`REQUIRED_CONVERGER_ROLE` + max-privilege rule) + Director notification on `cascade_failed`. Commit `9a5e7d0`. Architect-reviewed ✓.
- ✅ **D-brainstorm (thread-224)** — Phase 2d Robustness Audit scope. 5 rounds, bilateral convergence. Ratified 4-checkpoint path (CP1 observability → CP4 protocol → CP2 reaper → CP3 retry_cascade), idempotency-first over Hub atomicity, staging role-unrestricted, authority at convergence.
- ✅ **Ideas filed:** idea-119 (query-shape engineering), idea-120 (entity-provenance unification, updated with `createdBy` proposal).
- ✅ **Bugs filed:** bug-13 (id-sort lexicographic).

---

## Edges (dependency chains)

```
Phase 2x CLOSED → A (task-302) ✅
Phase 2x CLOSED → B (thread-223) → C (task-303) ✅
C → D-brainstorm (thread-224) → D-CP1 (task-304) ▶
D-CP1 → D-CP2 → D-CP3 → D-CP4 → E (Mission Phase 3)
E → H (Phase 4 quota) ⏸

idea-120 ○ (blocks F) → F (idea-119 Phase 2) → G (idea-119 Phase 3)
bug-13 ⏸ -.-> F  (absorbable refinement)

idea-115 ○ independent
idea-116 ○ independent
idea-118 ○ independent
```

---

## Session log (append-only)

- **2026-04-20 late** — shipped task-302 (A) + task-303 (C); opened + converged thread-223 (B) + thread-224 (D-brainstorm); filed idea-120 (provenance unification) + bug-13 (id-sort); this work-trace doc stood up (supersedes post-phase-2x-roadmap.md). Architect reviewed task-302 + task-303 as fully completed. task-304 (D-CP1) issued by architect, pre-assigned to `eng-0d2c690e7dd5`, awaiting director go-ahead to begin implementation.
- **2026-04-20 evening** — opened **thread-225** for idea-120 architect triage (entity-provenance unification / `createdBy` ratification). Unicast to architect, currentTurn=architect. Trace hygiene correction: task-304 is pre-assigned + status=`working` (not "not yet claimed" as prior entry said). Diagnostic: Hub revision `hub-00037-h9t` deployed 2026-04-20T06:40:53 is current (past commits 177fb84 + 9a5e7d0); MCP plugin-proxy in this session still serves pre-Phase-1 `list_tasks` schema (no filter/sort) — schema cached in proxy, resolved by session restart. Flagged, not blocking.
- **2026-04-20 mid** — Phase 2x shipped all 7 items (P0-1 through P2-7); closing audit committed.
- **2026-04-20 early** — Phase 2c CLOSED (failure-amplification class squashed per idea-117).
- **2026-04-19** — Phase 2b CLOSED (83% Gemini-token reduction; three classes squashed).
- (prior phase history in `docs/audits/phase-*.md`)

---

## Why this shape (rationale kept from prior roadmap doc)

Preserved for cross-session context on the A-I ordering decisions.

### Why A first (shipped)

task-302 was architect-issued production work; leaving it un-claimed violated the task execution discipline. It also targeted the highest-impact failure mode from the Phase 2x N=20 measurement (query-shape regression on tool-heavy/parallel/design prompts).

### Why B parallel with A (shipped)

Pure design work (architect brainstorm), no conflict with engineer-session tool surface. Completing B's brainstorm during A's implementation gave us a ratified Phase 2a design ready for implementation the moment A shipped.

### Why C before E (shipped; E pending)

Phase 3 is a content problem (what state to pre-load into prompts). Threads 2.0 Phase 2 was a machinery problem (how thread convergence spawns downstream work). Machinery smaller than content; shipping C first meant Phase 3 design sessions could USE `stage_task` primitive from day one.

### Why D-brainstorm before D-impl (both shipped)

Robustness audit scope wasn't pre-defined. Brainstorm produced 4-checkpoint ratified path + architect-ratified scope decisions (idempotency-first, no Hub atomicity, collaborative drafting preserved). Without that step, implementation would have been scattered.

### Why idea-120 was promoted to a blocker on F (this session's finding)

Filed during A (task-302) when `author` was listed as filterable but Task had no author field. During the work-trace write-up, director sharpened the unification question into a concrete `createdBy: {role, agentId, at}` proposal. F's value (filter by "who made this") is materially diminished without this unification.

### Why H (Phase 4 quota) stays deferred

Mission doc's own deferral decision — no observed 429s to justify pull-forward. Remains valid.

### Why I (remaining architect-triage ideas) stays lowest

None of idea-115, 116, 118 is load-bearing for current production stability. Triage them when Phase 3 + 4 complete OR when one surfaces as a prerequisite for an in-flight mission.

---

## Canonical references

- Phase closing audits: `docs/audits/phase-2x-closing.md`, `phase-2c-closing.md`, `phase-2b-closing.md`, `phase-2a-baseline-measurement.md`, `phase-1-baseline-measurement.md`
- Mission spec: `docs/planning/m-cognitive-hypervisor.md`
- Telemetry harness: `scripts/architect-telemetry/`
- Open ideas (Hub): 115, 116, 117 (shipped), 118, 119 (Phase 1 shipped), 120
- Open bugs (Hub): bug-13
