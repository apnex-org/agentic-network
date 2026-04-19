# Mission: Ideas Audit v1 (M-Ideas-Audit)

**Status:** Proposed
**Proposed:** 2026-04-19
**Owner:** Engineer (autonomous lead)
**Collaborator:** Architect (per-idea review + buy-in)
**Governance:** Director approves mission kickoff; reviews final synthesis. No Director intervention between.

---

## Motivation

The Ideas backlog has grown to ~30 open items across multiple mission arcs (ADR-017 follow-ups, Universal Port, Director integration, test infrastructure, etc.). Individual ideas vary widely in description quality, concept clarity, duplication status, and strategic alignment. Without a structured audit pass, the backlog degrades toward an unreviewed heap and execution-planning becomes guesswork.

This mission also serves as a **high-value autonomous-collaboration stress test** of the Threads 2.0 discipline + the architect as a reviewing peer. Every idea audit goes through a thread with the architect; every cluster decision goes through a thread. The mission's own completion is a proof-point for architect-autonomy as a working pattern.

---

## Goals

1. **Rubric-audit every open Idea** (≥ 1 per thread, architect-reviewed) against a consistent 8-field rubric.
2. **Improve description quality** in place where the rubric demands it.
3. **Detect + record duplicates, deprecations, and necessary splits**.
4. **Classify** each idea against a shared taxonomy.
5. **Validate each against current Tele** (primary/secondary/orthogonal alignment).
6. **Estimate effort + value** (T-shirt) per idea to enable value/effort ranking.
7. **Cluster into execution waves** with architect on the final synthesis pass.
8. **Produce a canonical audit document** (`docs/audits/ideas-audit-v1.md`) as the mission's terminal artifact.

## Non-goals

- Not implementing any idea — this is scoping, not execution.
- Not closing/deleting ideas — auditing preserves history; `deprecated_for:X` / `duplicate_of:X` tags supersede without data loss.
- Not reorganizing the Idea schema. Tags are the persistence v1; schema extension is a separate follow-up if patterns emerge.
- Not auditing closed or archived ideas. Scope = `status: open` only.

---

## Rubric (per-idea)

Every idea passes through an 11-field rubric (final, architect-ratified in thread-140):

| # | Field | Values | Persisted-as tag |
|---|-------|--------|------------------|
| 1 | **Valid** | `valid` / `stale` / `superseded_by:X` | `audit:status=<value>` |
| 2 | **Concept** | ≤1 sentence canonical restatement | description (rewritten if needed) |
| 3 | **Description quality** | `keep` / `rewritten` | `audit:desc=<value>` |
| 4 | **Class** | from taxonomy below | `audit:class=<value>` |
| 5 | **Scope** | `local` / `package` / `systemic` | `audit:scope=<value>` |
| 6 | **Duplicate/deprecation** | `none` / `duplicate_of:X` / `deprecates:Y` | `audit:dup=<value>` |
| 7 | **Split** | `no` / `split_into:[ids]` | `audit:split=<value>` |
| 8 | **Tele alignment** | `primary:X` / `secondary:X` / `orthogonal` / `conflicts_with:X` | `audit:tele_primary=<id>`, `audit:tele_secondary=<id>`, `audit:tele_orthogonal=true`, `audit:tele_conflicts=<id>` |
| 9 | **Effort** | S / M / L / XL | `audit:effort=<size>` |
| 10 | **Value** | S / M / L / XL | `audit:value=<size>` |
| 11 | **Urgency** | low / med / high / critical | `audit:urgency=<value>` |
| 12 | **Actionability** | ready / needs-proposal / needs-research / backlog | `audit:action=<value>` |

Plus the final state marker: `audited:v1` — signals "this idea has been through the rubric pass".

**Structured Tagging Protocol (architect-ratified)**: All audit tags use the form `audit:<field>=<value>`. This keeps the rubric machine-queryable via `list_ideas(labels: "audit:class=infra-reliability")` without schema changes — Phase 3 synthesis becomes a simple aggregation of tag queries.

## Class taxonomy (architect-ratified in thread-140)

8 classes. Subject to revision only if a tangible miss surfaces during audit.

1. **infra-reliability** — watchdogs, persistence, queue correctness (e.g., idea-97 GCS persistence).
2. **dev-ergonomics** — tooling, CLI UX, test harness, debug flows (e.g., idea-104 mock clients).
3. **feature-unlock** — new capability, e.g., new tool types or entity types (e.g., idea-86 Director integration).
4. **tech-debt** — cleanup, rename, refactor without user-visible behavior change (e.g., idea-103 Zod-strict flip).
5. **performance-optimization** — latency, throughput, resource efficiency (e.g., SSE reconnect efficiency, GCS throughput).
6. **observability** — audit, metrics, visibility, Director-surfaced signals (e.g., idea-94 audit replay queue).
7. **migration** — one-shot data/state transformations (e.g., idea-95 cross-action dependencies).
8. **governance-policy** — invariant / gate / guardrail enforcing FSM correctness (e.g., idea-98 broadcast/multicast enqueue).

**Scope is a separate field** (not a class), per architect correction in thread-140: `cross-cutting-refactor` was conflating two orthogonal attributes. A refactor can be for reliability OR ergonomics OR debt; its spread across packages is a Scope dimension (local/package/systemic).

---

## Phases

### Phase 1 — Prep + architect buy-in (one-off)
- Open kickoff thread to architect: present this spec + rubric + taxonomy.
- Seek consensus via `seek_rigorous_critique` semantic intent.
- Converge with `update_idea` or `create_idea` if taxonomy/rubric shifts warrant.
- Finalize + commit rubric here (this doc updated to match converged state).

### Phase 2 — Audit loop (one-at-a-time, resumable)

**Governance checkpoint (architect-ratified in thread-140):** After the **first 20 ideas audited** (~25% mark), pause and produce a **Calibration Report** for architect. Architect reviews Value/Class interpretation alignment; on blessing, green-light to the remaining ~60. This is the only Phase 2 gate; no per-idea consensus required.

For each open idea (oldest-first by id):

1. `get_idea(id)` + `list_audit_entries(relatedEntity: id)` for history context.
2. Draft the rubric locally.
3. Open thread to architect (unicast). Attach:
   - Current description
   - Rubric draft
   - Cross-references to related ideas (duplicate candidates)
   - Tele `list_tele` snapshot for alignment check
4. Architect validates/refines; I defend or update.
5. Converge with staged actions:
   - `update_idea` to apply tags + (optionally) rewrite description
   - `create_idea` if split is warranted
   - `close_no_action` if the audit outcome is "stale, deprecate in place"
6. Add `audited:v1` tag. Idea moves out of the queue.

**Resume rule:** next session, `list_ideas(tag: "!audited:v1", status: "open")` is the remaining queue.

**Expected per-idea time:** 15–25 min. Total for ~30 ideas: 10–12 hours across multiple sessions.

### Phase 3 — Cluster + prioritize (one-off)

- Open a meta-synthesis thread to architect.
- Input: all `audited:v1` ideas with their rubric tags.
- Cluster by `class` + tele alignment + dependencies.
- Rank clusters by aggregate value/effort.
- Converge with staged `propose_mission` actions for the top clusters.
- Produce final audit document (`docs/audits/ideas-audit-v1.md`) — the terminal artifact.

---

## Persistence / audit trail

All durable state lives in the Hub (survives session compaction):
- **Mission entity** — this plan.
- **Thread per idea** — converged summary is the decision record (INV-TH23 frozen).
- **Idea tags** — machine-readable state.
- **`docs/audits/ideas-audit-v1.md`** — Phase 3 synthesis; cross-referenced to ideas + threads.
- **Git history** — this doc + the final audit doc.

In-session working memory is NOT persistent — the mission is designed to resume fully from Hub state alone.

---

## Autonomous-operation rules

Explicit directives this mission operates under:

1. **No Director pings** between milestone boundaries. Progress visible via Hub state (ideas, threads, mission).
2. **Milestone reports only**: Phase 1 complete, Phase 2 halfway, Phase 2 complete, Phase 3 complete.
3. **Architect is the peer review** — when ambiguity arises, open a thread. Do NOT fall back to Director.
4. **Director-gated actions are thread-mediated**. No direct `create_mission` / `propose_mission` tool calls; all go through thread convergence with the committed action firing cascade.
5. **Fail-loud on invariant violations** — if the audit process itself reveals a Hub bug or architect unresponsiveness class, STOP and escalate via Director notification per ADR-017. Don't paper over.

---

## Success criteria

- Every open idea tagged `audited:v1`.
- Zero duplicates remaining active (all flagged `duplicate_of:X` and `audit_status:superseded_by:X`).
- Class taxonomy stable + architect-endorsed.
- Every `class:feature-unlock` or `class:cross-cutting-refactor` idea has explicit `tele_primary` alignment.
- At least 3 coherent execution waves proposed via `propose_mission` actions with aggregate value/effort justification.
- `docs/audits/ideas-audit-v1.md` committed with full cross-references.

---

## Architect-ratified refinements (thread-140 2026-04-19)

1. ✅ **Rubric +2 fields**: Urgency (low/med/high/critical) + Actionability (ready/needs-proposal/needs-research/backlog).
2. ✅ **Taxonomy**: added `performance-optimization`; renamed `policy` → `governance-policy`; removed `cross-cutting-refactor` (split to Scope field).
3. ✅ **Scope** as separate field (local/package/systemic) — orthogonal to class.
4. ✅ **Tele alignment** adds `conflicts_with:X` — for ideas that actively contradict a Tele.
5. ✅ **Structured Tagging Protocol**: `audit:<field>=<value>` format for all rubric tags.
6. ✅ **Calibration gate** tightened to 5 ideas audited (from 20).

## Mid-mission addenda (thread-145 calibration-gate 2026-04-19)

7. ✅ **Rubric 13th field** — `audit:implemented=true|partial|core|false` sub-classifier for stale-but-shipped ideas. Distinguishes fully-shipped from core-mechanism-only in Phase 3 synthesis.
8. ✅ **Audit-thread action invariant**: allowed stagedActions strictly = `{update_idea, create_idea, close_no_action}`. `create_task`, `propose_mission`, `create_bug`, etc. are **out-of-bounds during audit threads** — those decisions belong to Phase 3 synthesis. (Addresses scope drift observed during idea-101 audit where architect created task-282/283.)
9. ✅ **Staged-action convention**: Engineer pre-stages `update_idea` actions with pre-computed rubric tags. Architect ratifies content but does NOT stage parallel `close_no_action` unless no entity update is needed. Reduces retract/re-stage round-trips.
10. ✅ **Batched auditing (post-calibration)**: after gate-5, switch from thread-per-idea to 5-10 ideas per thread grouped by functional area (e.g., "ADR-017 follow-ups", "shipped/retired", "strategic architecture"). Maintains context, accelerates throughput.

---

## Appendix: scope snapshot at mission start

To be populated in Phase 1 after `list_ideas(status: open)` query — the canonical snapshot of what's in-scope.
