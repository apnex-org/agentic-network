# Strategic Architectural Review — Methodology

**Status:** v1.0 (2026-04-21). Treat as engineered component — version, critique, evolve.
**Scope:** reusable template for high-level architectural reviews on the Agentic Network.

**Pending v1.1 deltas** (captured in 2026-04 retrospective-lite at `docs/reviews/2026-04-retrospective-lite.md`; fold at formal retrospective when first 2026-04 mission ships):
Convergence Bounds (80-90% healthy ceiling) · Phase 2 Filing-Point ≠ Fault-Domain sub-step · Amendment Protocol 3-condition fold heuristic · Phase 4 Co-authoring composition pattern · Parallel-Pass vs Sequential phase-capability · Mission Filing Protocol proposed-default release-gate · Review-Thread Cadence maxRounds:20 · Anti-Goal Growth ~2× execution pattern.

**Companion methodology:** `docs/methodology/mission-preflight.md` — activation gate between review Phase 4 filing (`proposed`) and Director release-gate signal (`active`). Every Phase-4-filed mission requires a preflight artifact at `docs/missions/<mission-id>-preflight.md` before Director issues `update_mission(status="active")`.

**Peer methodology:** `docs/methodology/ledger-reconciliation.md` — the factual counterpart to this evaluative review. Reconcile the ledger (true-up entity status) *before* a strategic review — a review run over a rotted backlog evaluates noise.

## Purpose

A strategic architectural review is a **deliberate, time-boxed pass over the system's current state to re-align trajectory with Tele**. It produces a prioritized investment plan, a ratified set of anti-goals, and a cleaned-up backlog — not code changes. It is the "run slow to run fast" counterweight to mission execution.

## When to use this methodology

- Accumulated backlog of ideas + bugs has outpaced coherent prioritization
- Architectural direction feels ambiguous across the team
- Tele set has recently changed (ratified audit, new concepts)
- Multiple competing target-state architectures are in play
- Velocity of evolution is slowing relative to backlog growth
- Before committing to a large structural mission, to validate it's the right one

## When NOT to use

- For tactical bug triage (use per-bug update flow)
- For single-mission planning (use per-mission Design + Manifest)
- When there are <5 open ideas or <3 active friction domains (insufficient surface for review overhead)
- Mid-mission — do not pause execution for a review; review between missions

## Roles

| Role | Responsibility | Default loading |
|---|---|---|
| **Director** | Ratifies each phase output. Provides strategic judgment. Owns anti-goal list. Owns final mission prioritization. | Human |
| **Engineer agent** | Inventory legwork. Data collection from Hub state. Symptom cataloguing. Cost estimation. | Claude Code session registered as engineer |
| **Architect agent** | Tele-alignment scoring. Naming (Concept / Defect extraction). Dependency mapping. Mission brief structure. | Claude Code session registered as architect |

Director-first critique protocol per phase:
1. Author agent drafts phase artifact
2. Director reviews + annotates
3. Author revises against Director annotations
4. Other agent critiques for logic, completeness, Tele alignment
5. Author integrates critique
6. Director ratifies → phase closes

## Review Scope — Full vs Partial

Reviews can run at two scopes:

### Full review (default)

All 4 phases sequentially, per the structure below. Recommended when:
- Multiple friction domains are acute simultaneously
- Backlog scope has shifted meaningfully since last review
- Tele set has changed
- Direction ambiguity spans >1 friction cluster

### Partial-scope review

A subset of phases, with explicit scope declaration. The 4 phases have different dependency properties:

| Phase | Standalone-capable? | Inherits from | Use cases |
|---|---|---|---|
| Phase 1 Cartography | ✓ yes | Hub state + Tele spec | Backlog-refresh after a mission lands that resolves 10+ ideas; post-Tele-audit resync; post-methodology-change |
| Phase 2 Friction | partial | full prior Phase 1 **OR** explicit scope-limit | Narrow friction audit on specific domain (e.g., cascade-layer only, adapter-layer only) when a single cluster is acute enough for focused attention |
| Phase 3 Concepts/Defects | ✗ no | requires Phase 2 (full or scoped) | Not standalone-runnable; would re-invent friction taxonomy implicitly |
| Phase 4 Prioritization | partial | requires Phase 3 **OR** prior-review's Phase 3 if recent (≤60 days) | Mission-rebalance after a mission completes or fails; candidate re-scoring on existing concept/defect register |

### Partial-scope guardrails

Partial reviews MUST:
1. **Declare scope explicitly** at plan-authoring time (`docs/reviews/<date>-phase-N-scoped.md`). Scope statement names which phases will run + which are inherited from prior reviews.
2. **Cite inheriting artifacts** — every claim that depends on an unrun phase must reference the prior artifact it inherits (e.g., "Phase 3 concept register at `agent/lily:ced70b8` current; not re-authored").
3. **Narrow convergence criteria** to the scoped phase's convergence rule only — do not assert "2 mission briefs" if only Phase 1 runs.
4. **Flag scope creep explicitly** — if mid-execution work surfaces that the scope was wrong (e.g., Phase 2 narrow on cascade-layer reveals the friction is upstream in adapter-layer), halt + re-scope rather than silently expand.

### When to avoid partial-scope

- Backlog inventory stale (>90 days since full cartography) — run Phase 1 first even if the apparent trigger is Phase 4-shaped
- Tele set changed since last full review — concept-defect grounding needs re-examination
- Multiple friction clusters surfaced simultaneously — partial-scope forces arbitrary choice between them; full review is honest

Partial-scope reviews are optimization for single-domain work. Full reviews are still the default when re-alignment across the full system is warranted.

## Four-Phase Structure

Each phase produces exactly one durable artifact. Phases are sequential within the scope of the current review; partial-scope reviews run a subset per the rules above.

### Phase 1 — Inventory & Cartography

**Goal:** honest flat map of current state. No prioritization, no interpretation — facts only.

**Inputs:** Hub state (all entity types), spec docs, recent work-traces.

**Sub-outputs bundled into one document:**
- Ideas clustered by Tele alignment (and orphans: ideas with no Tele anchor)
- Built / Ratified-but-unshipped / Open-idea split (reality check on the backlog)
- Bugs clustered by severity + domain
- Missions (active, completed, cancelled)
- Concepts (proto-documented from already-ratified architectural ideas — Smart NIC, vocabulary chain, etc.)
- Tele with zero inbound ideas or zero forward motion (reverse gaps)

**Artifact:** `docs/reviews/<date>-phase-1-cartography.md`

**Convergence:** every open idea appears in at least one cluster; every Tele is either populated or flagged as reverse-gap.

### Phase 2 — Friction Cartography

**Goal:** ranked map of where the system hurts in use.

**Inputs:** Phase 1 artifact, bug log, thread summaries, commit history if relevant.

**Sub-outputs:**
- Friction domains enumeration (tool-surface, coordination, delivery, role-scoping, deployment, etc.)
- For each domain: symptoms (cite specific bugs/threads), existing ratified fixes in backlog, remaining gaps
- Ranking by (exercise frequency × cost per exercise)

**Artifact:** `docs/reviews/<date>-phase-2-friction.md`

**Convergence:** every significant bug and every major in-thread friction report maps to a domain; domains are ranked with rationale.

### Phase 3 — Concept Extraction + Defect Classes

**Goal:** pull implicit patterns out of the backlog into **named Concepts** and **named Defect classes**. Cross-reference which concepts resolve which defect classes.

**Approach:** use lightweight Document-form proxies (`docs/concepts/*.md`, `docs/defects/*.md`) rather than first-class Hub entities. Minimal shape:
- Concept: name, mandate, mechanics, rationale, resolves-defects, instances-in-backlog
- Defect: name, symptom, mechanics, example-instances, resolved-by-concepts

**Inputs:** Phases 1 + 2 artifacts, current Tele set.

**Artifact:** `docs/reviews/<date>-phase-3-concepts-and-defects.md` (or split across `docs/concepts/` + `docs/defects/` directory structures).

**Convergence:** every Tele fault (from the 4-section template) maps to at least one defect class; every velocity-multiplier idea maps to at least one concept. Orphans are either named as new concepts/defects or explicitly deferred.

### Phase 4 — Investment Prioritization

**Goal:** ratified small set of mission briefs + explicit anti-goals.

**Inputs:** Phases 1–3 artifacts.

**Sub-outputs:**
- Mission candidates grouped into: blockers / quick-wins / structural / velocity-multipliers
- Ranking: Tele leverage (how many Teles advanced) × execution cost × unblocking power (how many downstream candidates enabled)
- 3–5 ratified mission briefs, each with: name, Tele served, scope, success criteria, dependencies, estimated effort class (S/M/L/XL)
- Explicit anti-goals: what this review *deliberately did not* commit to, with rationale

**Artifact:** `docs/reviews/<date>-phase-4-investment-plan.md`

**Convergence:** ratified mission set is achievable within the next mission cycle; anti-goals list is non-empty and specific.

## Idea Triage Protocol

Strategic Review is the heavy-event for collection-reasoning over the backlog. Between events, individual ideas are filed continuously. The Idea Triage Protocol routes each newly-filed idea to one of three paths based on triage characteristics; the protocol applies to all `create_idea` activations regardless of source role.

### Three routing paths

| Route | When | Mechanism |
|---|---|---|
| **(a) Skip-direct-to-Survey** | All 5 skip-criteria met | `update_idea(status="triaged")` directly; proceed to `mission-lifecycle.md` Phase 3 Survey |
| **(b) Triage thread** | Bilateral negotiation needed | Open thread; bilateral converge; `close_no_action` + summary; status flip via `update_idea` or cascade staged action |
| **(c) Queue-for-next-Strategic-Review** | Collection-reasoning warranted | Status remains `open`; idea surfaces in next Strategic Review Phase 1 Cartography |

### (a) Skip-criteria

ALL 5 must hold:

1. **Source ratification** — Director-originated OR Director-ratified-to-proceed (architect-relayed Director directive counts per `mission-lifecycle.md` §1.5.1)
2. **Scope concrete** — idea text declares in-scope, out-of-scope, anti-goals; not a vague concept-stub
3. **No contest** — no engineer/peer pushback; not under-specified at scope boundaries
4. **Tele-aligned** — Tele alignment self-evident OR explicitly stated in idea text
5. **Single-mission-shape** — not part of an idea-cluster requiring cross-idea consolidation

When all 5 hold: architect calls `update_idea(status="triaged")` directly; capture skip-rationale in the update commit message OR architect-session note. Forward-mechanise: `idea.triageBypassReason` field captures rationale at status-flip time.

### (b) Triage thread (bilateral negotiation needed)

When any skip-criterion fails:
- Engineer-surfaced idea needing architect ratification (criterion 1 fails)
- Under-specified scope (criterion 2 fails)
- Engineer/peer contesting or pushback (criterion 3 fails)
- Tele alignment ambiguous (criterion 4 fails)

Mechanism:
- Open thread with `correlationId=idea-XX`, `semanticIntent=seek_approval` or `collaborative_brainstorm`
- Bilateral converge → `close_no_action` staged action + non-empty `summary`
- Cascade flips `idea.status` OR architect calls `update_idea` post-seal

### (c) Queue-for-next-Strategic-Review

When collection-reasoning warranted (criterion 5 fails or signals cluster):
- **Idea-cluster** — overlapping scope with N other ideas (consolidation candidate)
- **Cross-mission scope-flex** — could fold into multiple existing missions; warrants prioritization-pass
- **Stale** — idea open >90 days without disposition
- **Multi-architecture** — references multiple competing target-state architectures

Architect leaves `status=open`; idea surfaces in next Strategic Review Phase 1 Cartography clustering. Architect captures queue-rationale via tag (e.g., `pending-strategic-review`) or thread on the idea.

### Anti-patterns

- **Architect-unilateral skip on engineer-surfaced idea** — engineer-source defaults to (b) triage thread for bilateral ratification; architect-judgment-bypass is constrained to architect-originated OR Director-originated ideas
- **Triage thread on Director-ratified well-scoped idea** — adds bookkeeping overhead with zero bilateral-negotiation value; route via (a) skip-direct
- **Indefinite queue-for-Strategic-Review** — ideas queued >90 days without surfacing in actual Strategic Review event accumulate as backlog rot; trigger Strategic Review when (c)-queue exceeds N=10 OR oldest queued idea exceeds 90 days

### Forward-mechanise hooks

This protocol is documented + codified at v1.x. Future ideas/missions can mechanise the runtime layer:

- **`idea.triageBypassReason` field** — captures (a)-route skip-rationale at status-flip time; idea-129/130/131 vocabulary-chain composes
- **Cascade trigger on Strategic Review thread convergence** — bulk-status-flip across queued (c)-route ideas
- **Stale-idea trigger** — periodic check; >90 days open → architect inbox-item per `mission-lifecycle.md` §A row 1.1
- **Idea-cluster detection** — Hub-side similarity heuristic flags new (c)-route candidates at filing time

## Cold-Start Handover Pattern

Review spans sessions. New sessions must pick up cold. Every review instance document includes a **Cold-Start Checklist** at the top: the exact list of Hub entities + documents + local files the incoming agent must load before any phase work.

Minimum checklist includes:
- Methodology document (this file)
- Instance document
- Current canonical Tele spec
- Entity vocabulary spec
- Workflow-registry spec
- Latest work-trace
- Hub state queries: `list_ideas`, `list_bugs`, `list_missions`, `list_tele`, `list_threads` (recent)

Agent identity loads via `register_role` at session start.

## Artifact Conventions

- All review artifacts authored in 4-section shape where applicable (Mandate / Mechanics / Rationale / Faults) — this IS the Zero-Loss Knowledge Tele applied to its own artifacts
- Document-form concepts and defects are forward-compatible with eventual first-class Hub entities (idea-133 Concept, class-of-Bug Defect) — file structure should mirror expected entity schema
- Each phase artifact cross-links its inputs (phase N-1) and outputs (phase N+1 inputs)

## Success Criteria for a Review

A review is successful if:

1. 3–5 mission briefs produced, each concrete enough to start execution without additional design
2. Concept register + Defect register documents exist, each entry cross-referenced
3. Friction cartography with ranked domains exists
4. Anti-goals list has ≥5 items with rationale
5. All findings tie back to specific Hub state (idea/bug/thread/tele citations)
6. Methodology gaps (places this template failed) captured in retrospective

## Review-of-the-Review (Retrospective)

A review is not complete until it has a retrospective. Two variants:

### Retrospective-lite (optional; methodology-only; early-trigger)

**Purpose:** capture methodology-level observations while session context is fresh. Input to the formal retrospective; does not supersede it.
**When:** after mission filing but before first mission ships. Typically same-session as Phase 4 closure.
**Scope:** methodology deltas only — observations about the review process, not about mission outcomes.
**Artifact:** `docs/reviews/<date>-retrospective-lite.md`.
**Authority:** architect-authored; Director-ratifiable independently of mission shipment.

### Formal retrospective (required; mission-outcome-triggered)

**Trigger:** when the first ratified mission output ships (or blocks on something non-trivial).

**Questions the retrospective answers:**
- Did the prioritization hold up once we started executing?
- What did we miss in friction cartography?
- What was easier than predicted? Harder?
- Did Concept + Defect proxies earn their keep?
- What should change in the methodology for next time?

**Artifact:** `docs/reviews/<date>-retrospective.md`. Feed any methodology edits back into this document (versioned).

## Anti-patterns (do not do)

- **Review as backlog dump** — listing every idea with no clustering or ranking
- **Review as design session** — drafting implementations mid-review rather than producing briefs
- **Skipping Phase 2** — jumping from inventory to prioritization without friction analysis loses the reality-check step
- **Unbounded phases** — no convergence criteria means phases never close; agent time compounds into ceremony
- **Concept proliferation** — naming every bug cluster as a "concept" dilutes the vocabulary; Concepts are structural, not symptomatic (symptoms are Defects)
- **Missing anti-goals** — without explicit deferrals, the review's consensus gets re-litigated by the next session
