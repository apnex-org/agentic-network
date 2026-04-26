# Methodology Calibration #23 — Formal Design Phase per Idea + Tele Pre-Check

**Status:** v1.0 (architect-authored 2026-04-26 lily; ratified by Director at autonomous-arc retrospective). Treat as engineered methodology component — version, critique, evolve.
**Scope:** reusable discipline for promoting an Idea into a Mission. Defines what makes a Design "formal" + when tele pre-check fires + how it composes with strategic-review + preflight + multi-agent-pr-workflow.

## Purpose

Calibration #23 establishes that **substantive missions warrant a formal Design artifact + an explicit tele pre-check before propose_mission cascade fires**. It promotes the Concept→Idea→Design→Manifest→Mission chain from an aspirational target lineage (per `reference_idea_to_mission_workflow.md`) into a binding pre-mission discipline for any Idea whose execution scope is M-class or larger, or whose architectural impact crosses sovereign-package boundaries.

Calibration #23 does NOT replace `mission-preflight.md` (which gates `proposed → active`); it sits **earlier** in the lifecycle — gating `idea → mission proposal`. Together with `strategic-review.md` (backlog triage) and `multi-agent-pr-workflow.md` (per-PR integration), it covers the full pre-execution discipline.

## When to apply

Apply calibration #23 when ANY of:

- The Idea's execution scope is M-class or larger (per Hub mission sizing taxonomy)
- Architectural impact crosses sovereign-package boundaries (introduces or reshapes packages)
- The Idea proposes new workflow primitives (Hub entities, cascades, MCP verbs)
- The Idea's tele alignment is non-obvious or competing teles tension at the design level
- Director or architect flags the Idea as "needs explicit Design discipline"

When NOT to apply:

- S-class single-deliverable missions where scope is well-bounded by precedent (e.g., bug fix; targeted refactor)
- Tactical missions wholly inside an existing mission's scope (use mission design iteration, not new Design)
- Maintenance work with no architectural surface (dependency upgrades; doc fixes)

## Roles

| Role | Responsibility |
|---|---|
| **Architect** | Authors the Design artifact. Runs tele pre-check (per commitment + per anti-goal). Files propose_mission cascade once Design ratified. |
| **Engineer** | Audits the Design for engineer-spec coherence. Surfaces sizing-triggers, structural concerns, alternative shapes. Blocks at design-level if tele-misalignment surfaces. |
| **Director** | Ratifies architectural commitments + anti-goals at design-level. Sets HOLD points + retrospective gates. Does NOT typically draft Design content (architect-owned). |

## Procedure

### Step 1 — Idea triage

Idea reaches `triaged` status with sufficient framing to make calibration #23 applicability decision (per applicability checklist above). If applicability YES, proceed to Step 2. If NO, route via standard lightweight idea-to-mission path (per `reference_idea_to_mission_workflow.md`).

### Step 2 — Architect drafts formal Design artifact

Authored at `docs/designs/<mission-name-or-idea-name>-design.md`. Required sections:

1. **Decisions log** — every architectural commitment + source + ratified-by/yes-no status
2. **Goal** — what the mission delivers; success bar
3. **Tele alignment** — explicit per-commitment tele-leverage (primary / secondary / tertiary); explicit per-anti-goal tele-protection
4. **Architectural commitments (BINDING)** — numbered; each cross-references which tele it serves; layer impact + sovereign-package impact stated
5. **Anti-goals (BINDING)** — numbered; each maps to the tele it protects + what it explicitly rules out
6. **Out of scope** — neighboring concerns explicitly NOT in this mission
7. **Wave decomposition** — engineer-spec-level work breakdown (if not yet authored, mark "engineer-decision pending audit-round-2")
8. **Sizing** — baseline + escalation triggers (e.g., XL escalation conditions)
9. **Cross-references** — sister missions; absorbed ideas; bug links; ADRs
10. **Provenance** — Director directives + ratifications + design-round outcomes

### Step 3 — Tele pre-check (architect-owned; runs DURING drafting, not after)

Per `feedback_tele_pre_check_per_design.md`: architect runs tele evaluation BEFORE sending the Design artifact for engineer audit. Each architectural commitment maps to which tele it serves. Each anti-goal maps to which tele it protects.

**Tele pre-check is a pass/fail gate** — if any commitment cannot be tele-justified, OR if competing teles tension without resolution, the Design is NOT ready. Iterate within the Design before propose_mission fires.

**Reject "convenient interim shapes"** — tele alignment must hold END-TO-END, not "we'll align this later".

### Step 4 — Engineer audit (round 1)

Engineer reads the Design artifact. Surfaces:
- Sizing-triggers (concrete signals that L→XL escalation is realistic)
- Structural concerns (engineer-spec-level architectural pushback)
- Wave decomposition refinement
- Cross-package failure-mode analysis
- Test surface implications

Engineer audit happens on a thread linked to the mission Idea (per `reference_idea_to_mission_workflow.md`). Architect ratifies + iterates Design v1.x as needed.

### Step 5 — Architect proposes mission

After Design v1.x ratification (architect + engineer convergence), architect fires propose_mission cascade. Mission entity references the Design artifact as `documentRef` (or in-entity-brief pattern if compact-enough).

### Step 6 — (Optional) Recon-as-Design-spike

If the mission needs structural input that's expensive to derive at design-time (e.g., spec-level audit of foreign code; deep codebase cross-grep), architect can scaffold a **predecessor recon mission** (S-class; engineer-side execution) whose output is a Recon Report folded back into the Design.

This is the **calibration #23 + recon-as-design-input** composition. Used in mission-54 (recon for M-Push-Foundation).

### Step 7 — Round-2 audit (post-recon or post-cleanup)

If a predecessor mission shipped (recon, cleanup, or other Design-input-class), engineer runs a round-2 audit of the Design against the new baseline. Architect ratifies. Mission propose_mission fires (or HOLD per Director directive for retrospective).

## Canonical execution examples

Three canonical executions ratified in this network's history:

### Execution 1 — mission-54 (M-Push-Foundational-Adapter-Recon)

- **Idea source:** Director-disclosed foreign-engineer adapter cleanup work (out-of-band)
- **Calibration #23 invocation:** architect proposed recon-as-Design-spike per Step 6
- **Design artifact:** mission-54 mission entity + 8-section Recon Report template (greg-authored)
- **Tele pre-check:** primary tele-3 (Sovereign Composition) + secondary tele-7 (Confidence-Coverage) + tele-4 (Zero-Loss Knowledge) + tertiary tele-2 (Isomorphic Specification)
- **Engineer audit:** spec-level discipline; 8-section Recon Report PR #61; foreign work IS 2-layer (corrected pre-look) + 5 reusable patterns + 10 architect-tele-evaluation questions
- **Outcome:** Q1 (3-layer kept) + Q2 (rename Message-router) + Q10 (separate cleanup mission) folded into Design v1.2
- **Velocity:** ~10 min T1-dispatch-to-PR-open (pattern-replication-sizing calibration validated)

### Execution 2 — mission-55 (M-Pre-Push-Adapter-Cleanup)

- **Idea source:** Q10 outcome from execution 1 (separate cleanup mission per Director's adapter-layer-clean-FIRST sequencing)
- **Calibration #23 invocation:** Design v1.2 (architect-authored revision of v1.1) ratified at PR #62
- **Design artifact:** `docs/designs/m-push-foundation-design.md` v1.2 §"M-Pre-Push-Adapter-Cleanup" (compact in-Design subsection; not standalone mission Design)
- **Tele pre-check:** primary tele-3 + secondary tele-9 + tele-2 + tertiary tele-7
- **Engineer audit:** 3-PR plan ratified; Universal Adapter notification contract spec PR #64; 70/70 new unit tests + Hub vitest baseline preserved
- **Outcome:** 10 deliverables shipped across PR #63/#64/#65; foreign tree deletable post-merge
- **Velocity:** ~3 hours engineer-time end-to-end (S lower edge realized; pattern-replication-sizing calibration validated)

### Execution 3 — M-Push-Foundation (PENDING)

- **Idea source:** mission-51 W6 explicit deferral + idea-204 workflow-gap inventory + bug-34 (mission-53 absorbed)
- **Calibration #23 invocation:** Design v1.1 (pre-recon) → Design v1.2 (post-recon, post-cleanup); first formal Design artifact under calibration #23 in this network's history
- **Design artifact:** `docs/designs/m-push-foundation-design.md` v1.2 (architect-authored; greg engineer-pool ✓; round-2 audit ratified at thread-325)
- **Tele pre-check:** primary tele-3 + tele-9 + secondary tele-7 + tele-10 + tele-4 + tertiary tele-2
- **Engineer audit:** rounds 1 + 2 (round-1 thread-317; round-2 thread-325); all 10 round-2 asks ratified
- **Outcome:** 6-bundled wave decomposition (W0-W5); L-firm sizing with (a)+(b) XL gate ~9% combined; pending Director release-gate post-retrospective
- **Status:** propose_mission cascade ratified; activation pending preflight + Director release-gate

## Composition with other methodology docs

| Doc | Lifecycle stage | Calibration #23 relationship |
|---|---|---|
| `reference_idea_to_mission_workflow.md` (target lineage) | Concept → Idea → Design → Manifest → Mission | Calibration #23 IS the discipline of the Design step |
| `strategic-review.md` | Backlog triage + mission prioritization | Identifies which Ideas warrant calibration #23 vs lightweight path |
| `mission-preflight.md` | proposed → active gate | Gates AFTER calibration #23; consumes the ratified Design |
| `multi-agent-pr-workflow.md` | Per-PR integration during execution | Cross-approval pattern formalized in v1.1 (post-M-Push-Foundation) |
| `mission-lifecycle.md` | Whole-mission state machine map | v1.0 RATIFIED bakes in calibration #23 + autonomous-arc-driving + mediation invariant |

## Anti-patterns (do not do)

- **Skipping tele pre-check** — proceeding to engineer audit without explicit per-commitment + per-anti-goal tele mapping. Surfaces tele-misalignment too late; wasted engineer audit cycles.
- **"Convenient interim shapes"** — accepting commitments that align tele "for now" but require future re-litigation. Tele alignment must hold end-to-end; rejected by `feedback_tele_pre_check_per_design.md`.
- **Design-by-thread** — replacing the formal Design artifact with thread-message-density. Threads are for rounds of audit + ratification; the Design ARTIFACT is the source of truth that survives threads.
- **Architect drafts ALL Design content alone** — engineer audit (Step 4) is load-bearing; architect-only Design without engineer audit misses sizing-triggers + structural concerns engineer surfaces.
- **Skipping recon-as-Design-spike when applicable** — when a Design needs structural input that's only obtainable from spec-level code/system audit, attempting to derive it at design-time wastes design rounds. Use Step 6 composition.
- **Design-without-Director-ratification of architectural commitments** — Director ratifies architectural commitments at design-level (mediated invariant: Director ↔ Engineer through Architect, but Director ratifies Design directly with architect). Bypassing Director for architectural commitments creates re-litigation risk.

## Success criteria for the calibration itself

A calibration #23 execution is successful if:

1. The Design artifact is committed + reviewable independent of mission execution
2. Tele pre-check holds end-to-end (no "convenient interim shapes")
3. Engineer audit surfaces sizing-triggers + structural concerns BEFORE mission activation
4. Director ratifies architectural commitments + anti-goals before propose_mission cascade fires
5. The mission ships against the ratified Design without re-litigating architectural commitments mid-flight
6. Retrospective (post-mission) confirms Design held under execution scrutiny — or surfaces specific Design defects that feed the next calibration update

## Methodology evolution

As with `strategic-review.md` and `mission-preflight.md`, treat this procedure as an engineered component. Retrospectives feed deltas back into this document (versioned).

Candidate v1.1 additions on observed execution:

- Automated tele pre-check tooling (template-driven validation that every commitment has a tele anchor)
- Design artifact templates per mission class (S/M/L/XL weight Design depth differently)
- Cross-mission Design coordination when multiple Ideas tension at sovereign-package boundary
- Recon-as-Design-spike playbook (Step 6) — when applicable; how to scope; how to bound recon mission

## Cross-references

- `feedback_tele_pre_check_per_design.md` (lily memory) — tele pre-check is binding
- `feedback_pattern_replication_sizing.md` (lily memory) — sizing calibration validated in calibration #23 executions 1 + 2
- `docs/methodology/mission-preflight.md` v1.0 — downstream gate (proposed → active)
- `docs/methodology/strategic-review.md` — upstream gate (Idea triage → calibration #23 applicability)
- `docs/methodology/mission-lifecycle.md` v0.1 → v1.0 (post-M-Push-Foundation) — full lifecycle map; bakes in calibration #23
- `docs/methodology/multi-agent-pr-workflow.md` v1.0 → v1.1 (post-M-Push-Foundation) — execution-phase discipline
- `docs/reviews/m-push-foundation-pre-mission-arc-retrospective.md` — collaborative retrospective ratifying this calibration; first canonical execution of autonomous-arc-driving pattern alongside calibration #23

---

*Calibration #23 v1.0 authored 2026-04-26 alongside M-Push-Foundation pre-mission autonomous arc retrospective. Three canonical execution examples ratified: mission-54 (recon-as-spike), mission-55 (cleanup-against-Design), M-Push-Foundation (pending; substantive feature mission). Director-ratified at autonomous-arc retrospective same date.*
