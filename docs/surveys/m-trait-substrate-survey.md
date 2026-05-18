---
mission-name: M-Trait-Substrate
source-idea: idea-301
methodology-source: docs/methodology/idea-survey.md v1.0
director-picks:
  round-1:
    Q1: cab
    Q1-rationale: methodology-evolution as umbrella value (c primary) + trait→tele mapping as immediate-concrete use (a) + cold-pickup as architect workflow win (b); multi-agent-scaling (d) deferred as anticipated-benefit-not-motivating
    Q2: b
    Q2-rationale: Standard scope (reconciler + count-based confidence + per-trait TTL); mirrors mission-83 reconciler precedent
    Q3: b
    Q3-rationale: auto-bootstrap from existing 3-instance memory-file triangulation; Director ratifies at next mission-close per established mission-close-as-forward-architecture trait pattern
  round-2:
    Q4: b
    Q4-rationale: Count × time-decay confidence model; Director-explicit cache-with-TTL analogy made literal
    Q5: cd
    Q5-rationale: multi-pick on what I framed as mutually-exclusive — constraint envelope per methodology §7 — defense-in-depth persona-hydration across all coord-event types (bootstrap MCP + cognitive-cycle auto-injection + pulse-driven fallback)
    Q6: d
    Q6-rationale: auto-populate Survey envelope tele-alignment from trait-evidence + architect-side prompt for verification; PLUS Director-extension — implement Mode-A-then-Mode-B interpretation comparison mechanism (Tele-only baseline interpretation, then Tele+Trait augmented interpretation, persist both + compute Delta as calibration data)
mission-class: substrate-introduction
tele-alignment:
  primary: [tele-5, tele-4]
  secondary: [tele-1, tele-10]
  round-1:
    primary: [tele-5, tele-10]
    secondary: [tele-4, tele-1]
  round-2:
    primary: [tele-5]
    secondary: [tele-7, tele-9]
anti-goals-count: 5
architect-flags-count: 5
skill-meta:
  skill-version: survey-v1.0
  tier-1-status: implemented
  tier-2-status: stubbed
  tier-3-status: stubbed
calibration-data:
  director-time-cost-minutes: 6
  comparison-baseline: idea-300 Survey (~8min); idea-206 first-canonical (~5min); idea-301 closer to standard 5-min target with one substantial Director-extension (Q6 Delta-analysis mechanism)
  notes: Director introduced novel methodology-validation primitive via Q6 extension — request to implement Mode-A-then-Mode-B interpretation comparison (Tele-only vs Tele+Trait) + persist Delta as calibration data. This generalizes beyond Trait substrate to ANY architectural-extension empirical validation. Methodology-evolution candidate — codify "Director-requested-empirical-A/B-validation-of-substrate-extension" as positive-pattern. Q5 multi-pick (c+d on mutually-exclusive framing) is contradictory-constraint per §7 — constraint envelope = "defense-in-depth persona hydration across all coord-event types"; Design-phase satisfies via layered bootstrap + cognitive-cycle + pulse mechanisms.
contradictory-constraints:
  - round: 2
    questions: [Q5]
    picks: [c, d]
    constraint-envelope: defense-in-depth persona hydration across all coord-event types — Director wants multiple mechanisms (bootstrap MCP + cognitive-cycle auto-injection of high-confidence subset + pulse-driven fallback) layered for resilience; not contradictory, complementary integration-points across different session-startup paths
calibration-cross-refs:
  closures-applied: []
  candidates-surfaced:
    - "positive-pattern Director-requested-empirical-A/B-validation-of-substrate-extension (Q6 Delta-analysis extension generalizes beyond Trait substrate to any architectural-extension validation; methodology-evolution candidate; sibling to idea-300 Survey positive-pattern Director-Round-2-clarifying-question-as-substrate-currency-audit-surface)"
    - "Director Q5 contradictory-multi-pick-as-defense-in-depth-signal (mechanism: when Director multi-picks on mutually-exclusive question, architect should interpret as resilience-via-layering not as confusion; constraint envelope captured for Design-phase brainstorm)"
---

# M-Trait-Substrate — Phase 3 Survey envelope

**Methodology:** `docs/methodology/idea-survey.md` v1.0 (3+3 Director-intent pick-list)
**Source idea:** idea-301
**Mission-class candidate:** `substrate-introduction` (new entity-kind + reconciler + Agent extension; analogous architectural-shape to mission-83 SchemaDef + reconciler pattern at meta-layer applied to behavioral-observation domain)
**Branch:** `agent-lily/m-trait-substrate` (push pre-bilateral round-1 audit per calibration #59 closure mechanism (a))

---

## §0 Context

**Origin:** filed by architect (lily) 2026-05-18 architect-direct post mission-83 Phase 10 retrospective + idea-300 Phase 3 Survey conversation. Triggered by Director's strategic question "is profiling roles using a triangulated Trait system useful for our Agentic Coding collaboration platform?" — yes, with immediate v1 value-proposition being **Director-trait learning to assist architect in mapping observed behaviours to tele framework** during Survey interpretation step (per `idea-survey.md` §3 Step 4 + §9 anti-tele-drift discipline).

**Bootstrap content already-prepared:** 3 Director-trait memories filed 2026-05-18 (`director-strategic-maximalism-discipline-defended` + `director-clarifying-question-as-audit-surface` + `director-mission-close-as-forward-architecture`) ready to seed as trait-001/002/003 with triangulation-strength=3 + Director-ratify-state ready at mission-W0. 2 engineer-side trait candidates also identified from mission-83 W6 (surface-discipline-on-scope-overrun + bilateral-trust-on-revert-call).

**Cross-mission anchors:** mission-83 (substrate-introduction; reconciler-pattern precedent) shipped; idea-300 (FS-retirement) Phase 3 Survey complete; idea-298 (cloud-deploy) scope-pinned. idea-301 is sequence-flexible — can run parallel-with OR after idea-300; before OR after idea-298 (no hard dependency).

---

## §1 Round 1 picks

| Q | Pick | Director-intent reading (1-line summary) |
|---|---|---|
| Q1 — Primary motivation priority (WHY axis) | **c + a + b** (multi-pick orthogonal composition; d deferred) | Methodology-evolution as umbrella + trait→tele mapping as immediate-concrete use + cold-pickup as architect workflow win; multi-agent-scaling anticipated but not motivating |
| Q2 — Scope ambition (HOW axis) | **b** Standard (reconciler + count + TTL) | Mirrors mission-83 reconciler precedent; not minimal-cut nor over-engineered |
| Q3 — Bootstrap + Director-trait ratify-gate posture (HOW-cadence axis) | **b** Auto-bootstrap + after-the-fact ratify | Trust-based posture; aligns with Director's established mission-close-as-forward-architecture trait pattern |

### §1.Q1 — Per-question interpretation

Director multi-picked (c) methodology-evolution + (a) trait→tele mapping + (b) cold-pickup as primary outcomes, deferring (d) multi-agent-scaling. Reading: **3 outcomes with weighted priority, not 4 equal**. The ordering (c first, then a, then b) suggests methodology-evolution is the **umbrella value-proposition** — Trait substrate is conceived as a substrate-feature that enables the methodology itself to evolve via empirical-aggregation (trait observations across role-class → methodology-class patterns). Trait→tele mapping (a) is the **immediate-concrete use-case** that proves the value at v1 ship — without (a), the substrate-feature lacks an actionable v1 surface. Cold-pickup (b) is the **architect-workflow win** that pays off every architect-session.

Multi-agent-scaling (d) is **anticipated-benefit-not-motivating** — Director sees the value when network expands but isn't building idea-301 FOR multi-agent expansion. Significant calibration: idea-301 should be sized to deliver (c)+(a)+(b) primarily, not (d). Persona-aware task routing (Q2(d) Comprehensive scope option) is out-of-scope for v1 per this Q1 reading.

**Tele weighting (Round 1):** primary = tele-5 Perceptual Parity (architect+Director share trait→tele mapping evidence symmetrically; humans + agents perceive persona state with parity) + tele-10 Autopoietic Evolution (system self-observes its own learning patterns at meta-layer; methodology-evolution via empirical-aggregation = autopoietic mechanism). Secondary = tele-4 Zero-Loss Knowledge (persona accretes durably across architect cold-pickup; currently lost) + tele-1 Sovereign State Transparency (persona becomes sovereign-backplane state).

### §1.Q2 — Per-question interpretation

Director picked (b) Standard — middle-ground that includes the reconciler. Rejected (a) Minimal (architect-manual-state-transitions; no substrate-feature in any meaningful sense), (c) Comprehensive (multi-observer-diversity weighting + contradiction-detection + supersede-chain + observer-bias-flag — over-engineering for current 1+1+1 scale), (d) Comprehensive + persona-aware task routing (multi-agent-scaling primitives; out-of-scope per Q1(d) deferral). 

Standard scope = mirrors mission-83 SchemaDef+reconciler precedent applied to trait domain. Architectural shape is well-understood + low-risk; the reconciler implements per-trait TTL window + count-based confidence + lifecycle transitions automatically. Composes with Q1(c) methodology-evolution — reconciler IS what enables empirical-aggregation (without automatic confidence updates, methodology-aggregation queries would be unreliable).

**Tele weighting (Round 1, Q2 component):** primary = tele-3 Sovereign Composition (clean reconciler-pattern; one-concern-per-module) + tele-8 Gated Recursive Integrity (binary-certified reconciler before substrate ratification). Secondary anchors continue from Q1.

### §1.Q3 — Per-question interpretation

Director picked (b) auto-bootstrap + after-the-fact ratify — trust-based posture that defers Director-ratify time-cost to next bilateral. Rejected (a) Architect-proposes-Director-ratifies (canonical privacy posture but Director-time-cost upfront; delays v1 use-cases until first ratify-cycle), (c) Engineer-traits-first / Director-traits-deferred (conservative; loses immediate-v1 trait→tele mapping value for Director picks), (d) Defer all Director-trait codification entirely (conservative; loses v1 use-case entirely).

Director's pick aligns with **Director-trait `mission-close-as-forward-architecture` pattern** (which the bootstrap content captures!) — Director engages at mission-close, ratifies after-the-fact, doesn't gate-by-gate. The pick is META-coherent: Director chose the bootstrap mechanism that matches their own observed trait. Trust signal: Director trusts the 3-instance triangulation evidence already documented in memory files; doesn't require fresh ratify-cycle.

**Round-1 composite read:** All three picks form a coherent narrative — **Trait substrate is positioned as methodology-evolution mechanism with trait→tele mapping as immediate-concrete value; Standard scope delivers all 3 primary use-cases; auto-bootstrap aligns with Director's own observed engagement-trait pattern (META-coherent)**. No cross-question coherence tension; no contradictory multi-pick (Q1 multi-pick is orthogonal-answer composition). Round 2 strategy = refine deeper (drill HOW into the 3 primary use-cases) per `idea-survey.md` §4.

---

## §2 Round 2 picks

| Q | Pick | Director-intent reading (1-line summary) |
|---|---|---|
| Q4 — Confidence model formula (drills Q2b reconciler-scope detail) | **b** Count × time-decay | Director's cache-with-TTL analogy made literal; recency-weighted observation accumulation |
| Q5 — Cold-pickup integration mechanism (drills Q1b primary use-case) | **c + d** (multi-pick on mutually-exclusive; contradictory-constraint per §7) | Defense-in-depth persona-hydration across all coord-event types (bootstrap + cognitive-cycle + pulse) |
| Q6 — Trait→tele mapping integration with Survey Skill (drills Q1a primary use-case) | **d + Director-extension** | Auto-populate envelope + architect-side prompt PLUS empirical A/B validation via Mode-A-then-Mode-B interpretation Delta-analysis |

### §2.Q4 — Per-question interpretation

Director picked (b) Count × time-decay — matches your own cache-with-TTL analogy from the filing conversation. Rejected (a) Count-only (no recency-weighting; observations equally-valued regardless of staleness; doesn't capture "trait active during recent missions" vs "trait observed once 6mo ago"), (c) Count × diversity × time-decay (over-engineering for v1; observer-diversity weighting matters at multi-architect scale; defer per Q1(d) anticipated-not-motivating posture), (d) Configurable per-trait (premature flexibility; standard formula sufficient for v1).

Specifically: per-trait `ttl-window` field determines decay rate; observations within window count fully; observations past window decay; stale-demotion triggers when accumulated confidence falls below active-threshold. Standard formula sketch: `confidence(trait) = sum(observations_within_ttl_window) × decay_factor(time_since_last_observation)`; active when confidence ≥ 3.

Composes with Q2(b) reconciler — Count × time-decay is what the `TraitConfidenceReconciler` implements at substrate-watch event-trigger time. Lifecycle transitions (candidate→active→stale→retired) flow from confidence-threshold-crossings emitted as NOTIFY events.

**Tele weighting (Round 2, Q4):** primary = tele-7 Resilient Agentic Operations (race-correctness in confidence updates under concurrent observation-writes; substrate-currency pattern from mission-83 bug-97 applies). Secondary = tele-9 Chaos-Validated Deployment (reconciler architectural-defense via substrate-conformance suite from idea-300 W1).

### §2.Q5 — Per-question interpretation

Director multi-picked (c) Pulse-driven + (d) Combination bootstrap+cognitive-cycle. I framed Q5 as mutually-exclusive answers; Director's multi-pick is therefore a **contradictory-multi-pick signal per `idea-survey.md` §7**. Reading: NOT contradictory in intent — **constraint envelope = "defense-in-depth persona hydration across all coord-event types"**. Director wants multiple mechanisms layered for resilience, recognizing different session-startup paths trigger different mechanisms:

- **Bootstrap MCP tool** (part of d): explicit architect query at session-start (cold-start path)
- **Cognitive-cycle auto-injection** (part of d): persona-projection of `active`-state traits injected at every Hub-bound tool call (ongoing-context path; matches tele-5 Perceptual Parity "hydrate before generating a single token" mandate)
- **Pulse-driven** (c): persona-projection in pulse-fire prompt (stale-session-resume path; piggybacks on existing pulse-primitive substrate)

Each mechanism fires at different events; defense-in-depth ensures persona-hydration happens reliably regardless of which session-startup path triggers. Design-phase will satisfy the constraint envelope via layered implementation; trait-substrate API surface should support all three mechanisms uniformly (one canonical persona-projection function; multiple consumers).

**Tele weighting (Round 2, Q5):** primary = tele-5 Perceptual Parity (mandate explicitly states hydration via multiple channels; defense-in-depth IS the mandate). Composes with tele-12 Precision Context Engineering (auto-injection should filter to `active`-state high-confidence subset; respect context-window budget; persona-projection is bounded).

### §2.Q6 — Per-question interpretation

Director picked (d) Combination (auto-populate envelope + architect-side prompt) — most-comprehensive Survey Skill integration. PLUS introduced a novel **methodology-validation extension**: implement Mode-A-then-Mode-B interpretation comparison mechanism. Architect generates interpretation TWICE:
- **Mode A:** Tele-only baseline (current methodology; no Trait input)
- **Mode B:** Tele + Trait→tele compositions augmented (idea-301 augmented methodology)

Then compute + persist the **Delta** as calibration data — the empirical evidence of value-add from Trait substrate.

This is significant methodology contribution beyond Q6 scope:

1. **Validates Trait substrate's value-add empirically** — not assumed-via-architectural-reasoning; measured-via-comparison
2. **Provides calibration data for trait→tele composition link semantics refinement** — if Mode B consistently differs from Mode A in measurable ways, the composition links are pulling weight; if Modes A and B converge, the composition links may be redundant
3. **Could generalize beyond Trait substrate** — any future architectural-extension to Survey Skill (or methodology in general) could use Mode-A-baseline-vs-Mode-B-augmented validation pattern
4. **Composes with tele-10 Autopoietic Evolution at meta-meta-layer** — the system self-validates its own architectural extensions empirically; not just self-observes patterns but proves they add value

**Architectural shape (Phase 4 Design):** Survey Skill `format-pick-presentation.sh` (or successor) gains a `--mode=A|B|delta-analysis` flag. Mode-A run produces interpretation without trait-query (pure Tele framework reasoning). Mode-B run produces interpretation WITH trait-query (trait→tele compositions injected as evidence-anchors). Delta-mode runs both + computes interpretation diff + persists alongside the Survey envelope at `docs/surveys/<mission>-survey.md.delta-analysis.json` (or sub-section in envelope). Delta-analysis becomes architect-side calibration material for trait-substrate refinement.

**Tele weighting (Round 2, Q6):** primary = tele-5 Perceptual Parity (Director-architect share Delta-evidence; A/B comparison IS the perceptual-parity validation mechanism) + tele-10 Autopoietic Evolution (system self-validates extensions empirically; closes the autopoietic loop at meta-meta-layer).

**Round-2 composite read:** Director picks reinforce **rigorous-empirical-validation + defense-in-depth + cache-with-TTL** theme. Particularly: Q4(b) cache-with-TTL analogy made literal; Q5(c+d) defense-in-depth via constraint envelope; Q6(d) + Delta-analysis as Director-requested empirical evidence of substrate value-add. Cross-question coherence ✓. The Delta-analysis extension is the **standout methodology contribution** — generalizes beyond Trait substrate to any architectural-extension validation; positive-pattern calibration candidate.

---

## §3 Composite intent envelope

idea-301 is positioned as **methodology-evolution substrate with empirical A/B-validation built-in** — Trait substrate is the entity-kind that enables persona composition + methodology-aggregation + cold-pickup calibration, with the Mode-A-vs-Mode-B Delta-analysis as the architectural-defense-and-validation mechanism. Five composed pillars from Director picks across both rounds:

1. **Methodology-evolution as primary motivation** (Q1c) — Trait substrate is conceived as a methodology-evolution mechanism; trait→tele mapping is the immediate-concrete v1 use-case; cold-pickup calibration is the architect-workflow win; multi-agent-scaling is anticipated-benefit-not-motivating (out-of-scope for v1 sizing)
2. **Standard reconciler scope with cache-with-TTL confidence model** (Q2b + Q4b) — TraitConfidenceReconciler implements per-trait TTL window + count-based confidence with time-decay; mirrors mission-83 SchemaDef+reconciler precedent applied to behavioral-observation domain
3. **Auto-bootstrap with after-the-fact ratify** (Q3b) — 3 Director-traits + 2 engineer-traits seeded at mission-W0 from existing memory-file triangulation evidence; Director ratifies at next mission-close (META-coherent with Director's mission-close-as-forward-architecture trait)
4. **Defense-in-depth persona hydration** (Q5c+d constraint envelope) — bootstrap MCP + cognitive-cycle auto-injection of `active`-state subset + pulse-driven fallback; layered mechanisms across coord-event types; one canonical persona-projection function with multiple consumers
5. **Empirical A/B validation via Mode-A-vs-Mode-B Delta-analysis** (Q6d + Director-extension) — Survey Skill generates interpretation in Mode A (Tele-only baseline) AND Mode B (Tele+Trait augmented); persists Delta as calibration data; closes the autopoietic-evolution loop at meta-meta-layer; positive-pattern methodology-contribution generalizing beyond Trait substrate

**Survey-side-effect outcome:** Director-extension on Q6 (Delta-analysis mechanism) generalizes beyond this mission — any future architectural-extension to Survey Skill (or methodology in general) could use Mode-A-baseline-vs-Mode-B-augmented validation pattern. Filed as positive-pattern calibration candidate.

---

## §4 Mission scope summary

| Axis | Bound |
|---|---|
| Mission name | M-Trait-Substrate |
| Mission class | `substrate-introduction` (new entity-kind + reconciler + Agent extension; meta-layer applied to behavioral-observation domain) |
| Substrate location | `hub/src/storage-substrate/schemas/` (SchemaDef extension; trait + observation entity-kinds) + `hub/src/entities/trait-repository-substrate.ts` (new repo) + `hub/src/policy/trait-confidence-reconciler.ts` (new reconciler) + `hub/src/policy/persona-projection.ts` (cold-pickup integration; defense-in-depth fan-out) + `skills/survey/scripts/*` (Mode-A-vs-Mode-B Delta-analysis extension) + `hub/src/entities/agent-repository-substrate.ts` (Agent.traits[] extension) |
| Primary outcome | Trait substrate operational with reconciler + cache-with-TTL confidence model; 3 Director-traits + 2 engineer-traits bootstrapped; trait→tele mapping integrated into Survey Skill with Delta-analysis A/B validation; cold-pickup persona-hydration via defense-in-depth (bootstrap + cognitive-cycle + pulse) |
| Secondary outcomes | Methodology-evolution data substrate ready for future trait-aggregation queries; positive-pattern calibration entry for Mode-A-vs-Mode-B validation pattern (generalizes beyond Trait substrate) |
| Tele alignment (primary, whole-mission) | tele-5 (Perceptual Parity; persona-hydration; Delta-analysis perceptual-validation), tele-4 (Zero-Loss Knowledge; persona accretes durably across cold-pickup) |
| Tele alignment (secondary, whole-mission) | tele-1 (Sovereign State Transparency; persona is sovereign-backplane state), tele-10 (Autopoietic Evolution; system self-observes + self-validates) |
| Tele alignment (Round-1) | primary: tele-5 + tele-10; secondary: tele-4 + tele-1 |
| Tele alignment (Round-2) | primary: tele-5; secondary: tele-7 + tele-9 (reconciler architectural-defense) |

---

## §5 Anti-goals (out-of-scope; deferred)

| AG | Description | Composes-with target |
|---|---|---|
| AG-1 | AI/ML-driven behavior auto-classification | Trait observations operator-driven (architect-authored from concrete events); no auto-classification or pattern-detection ML pipeline; v1 keeps observation-write as explicit operator action |
| AG-2 | Persona-driven access control / permissions gating | Observational only; Trait substrate does NOT gate permissions/visibility/routing based on observed behavior; future-follow-on if needed |
| AG-3 | Cross-platform persona federation | Single-network for v1; federating persona across multiple agentic-network instances is separate follow-on if Director-judgment requires |
| AG-4 | Persona-aware task routing + cross-agent compatibility scoring | Q2(d) Comprehensive+routing option rejected; multi-agent-scaling primitives out-of-scope per Q1(d) deferral; v1 ships persona as observable substrate state, not as routing input |
| AG-5 | Auto-codification of Director-trait without ratify-gate (v1.x consideration) | Director-side ratify-gate required for human-Director trait promotion to active-state; Q3(b) auto-bootstrap uses existing 3-instance memory-file triangulation as ratification-proof; future Director-traits require architect-propose + Director-ratify per mission-close pattern |

---

## §6 Architect-flags / open questions for Phase 4 Design round-1 audit

Architect-flags batched for engineer's round-1 content-level audit (per mission-67 + mission-68 audit-rubric precedent: CRITICAL / MEDIUM / MINOR / PROBE classifications). Each flag carries an architect-recommendation to challenge.

| # | Flag | Architect-recommendation |
|---|---|---|
| F1 (CRITICAL) | Mode-A-vs-Mode-B Delta-analysis mechanism implementation (Director-extension on Q6); requires Survey Skill scripts to support `--mode={A,B,delta-analysis}` flag; Mode-A run must NOT query traits (pure Tele baseline); Mode-B run queries trait→tele compositions; Delta persisted at `docs/surveys/<mission>-survey.md.delta-analysis.{json,md}` or envelope sub-section | Engineer designs API contract for the Skill scripts: Mode-A function signature is `interpret(picks, tele-framework)`; Mode-B is `interpret(picks, tele-framework, agent-traits)`; Delta-comparison computes per-question interpretation diff + per-round tele-mapping diff; persists structured analysis. Bootstrap-test: run Delta-analysis against idea-301 itself (this Survey envelope) — does Mode B differ from Mode A in measurable ways given Director-trait bootstrap? Empirical-validation-of-validation |
| F2 (CRITICAL) | Defense-in-depth persona hydration (Q5 constraint envelope per §contradictory) — bootstrap MCP + cognitive-cycle auto-injection + pulse-driven mechanisms must share one canonical persona-projection function; not 3 independent implementations | Engineer designs `persona-projection.ts` module with single `projectPersona(agentId, options: { filterByConfidence?, maxTraits?, sortBy? })` function. All 3 consumers (bootstrap MCP / cognitive-cycle hydration / pulse-fire prompt) call same function; mechanism-specific filtering applied at call-site. Avoids divergent persona-projections across mechanisms |
| F3 (MEDIUM) | TraitConfidenceReconciler Count × time-decay formula (Q4b) — per-trait `ttl-window` field defaults need ratification | Engineer proposes default ttl-window values per trait-class: personality-stable (60d), mission-cadence (14d), project-bound (7d). Architect-ratifies at Phase 4 Design round-2; revisable post-mission via Director-feedback |
| F4 (MEDIUM) | Trait→tele composition link mutability (Q1a use-case; idea-301 entity schema field `composes-with-tele`) — architect-authored vs Director-ratified-and-immutable | Engineer audits trait→tele composition update-semantics: how does mutation work? Architect-authored at trait-creation; Director-ratify-gate at trait-promotion to active-state; revisable post-active via supersede-chain (creates new trait + composes-with-tele; old trait retired). Mutation-during-active disallowed to preserve Delta-analysis reproducibility |
| F5 (MINOR/PROBE) | Bootstrap content (3 Director-traits + 2 engineer-traits from memory files) — migration mechanism | Engineer designs idea-301-W0 bootstrap script: reads memory-file frontmatter + extracts observations + creates Trait entities + populates Agent.traits[] for Director (agent-id-X) + lily (agent-40903c59) + greg (agent-0d2c690e). Per-trait observation-count seeded to 3 (minimum active-threshold); first-observed + last-observed dated to memory-file authorship dates. Director-ratify-prompt surfaced at mission-close for the 3 Director-traits per Q3(b) auto-bootstrap-with-after-the-fact-ratify posture |

---

## §7 Sequencing / cross-mission considerations

### §7.1 Branch + PR strategy

**Branch:** `agent-lily/m-trait-substrate` (architect-side); `agent-greg/m-trait-substrate` (engineer-side; same handle slug).

**PR cadence:** cumulative-fold per wave (mission-83 precedent). 5 waves sketched (W0-W4):

- **W0** SchemaDef extensions (trait + observation entity-kinds) + bootstrap-script (3 Director-traits + 2 engineer-traits from memory files)
- **W1** TraitRepositorySubstrate + Count × time-decay confidence formula + per-trait TTL handling
- **W2** TraitConfidenceReconciler (substrate-watch consumer per mission-83 pattern) + lifecycle transitions automated
- **W3** persona-projection module + defense-in-depth integrations (bootstrap MCP + cognitive-cycle hydration + pulse-driven fallback per Q5 constraint envelope)
- **W4** Survey Skill Mode-A-vs-Mode-B Delta-analysis extension (per Q6 Director-extension); architect-side bootstrap-test against idea-301 itself; Phase 7 release-gate

### §7.2 Composability with concurrent / pending work

- **mission-83** (M-Hub-Storage-Substrate) — required prerequisite (substrate must exist + SchemaDef reconciler operational); ✅ shipped 2026-05-18
- **idea-300** (M-Hub-Storage-FS-Retirement) — does NOT block; composes well (idea-300's SubstrateConformanceSuite work could include Trait-substrate parity-tests as one of the conformance dimensions; small fold-in if sequenced after idea-300 Phase 7 ratify)
- **idea-298** (M-Hub-Storage-Cloud-Deploy) — independent; Trait substrate is local-substrate-only feature
- **Existing Director-trait memory files** at `~/.claude/projects/-home-apnex-taceng-agentic-network/memory/feedback_director_*.md` — primary bootstrap source for W0
- **`docs/methodology/idea-survey.md`** v1.0 §3 Step 4 + §9 anti-tele-drift discipline — direct integration target for Q6 trait→tele mapping (Mode-A-vs-Mode-B extends the Step 4 per-question interpretation step)
- **`feedback_substrate_currency_audit_rubric.md`** ARCHITECT-SIDE EXTENSION — provides discipline-pattern Trait substrate codifies

### §7.3 Same-day compressed-lifecycle candidate?

**No — compressed-lifecycle NOT recommended.** 5 waves; Mode-A-vs-Mode-B Delta-analysis is novel methodology contribution requiring Design-phase substantive thought; persona-projection defense-in-depth needs careful integration with 3 different coord-event paths. Bilateral architect+engineer cycle of ~1-2 weeks appropriate. Sub-mission scope compression possible if Director surfaces priority shift, but not single-day execution.

---

## §calibration — Calibration data point

Per `idea-survey.md` §5 (Survey output element) + §15 schema. Captures empirical baseline for methodology-evolution loop per §13 Forward Implications.

- **Director time-cost (minutes):** ~6 (Round 1 ~2min + Round 2 ~3min + Q6 Delta-analysis extension articulation ~1min)
- **Comparison baseline:** idea-300 Survey (~8min); idea-206 first-canonical (~5min); idea-301 closer to standard 5-min target with one substantial Director-extension
- **Notes:** Director introduced novel methodology-validation primitive via Q6 extension — request to implement Mode-A-then-Mode-B interpretation comparison mechanism (Tele-only vs Tele+Trait) + persist Delta as calibration data. **This generalizes beyond Trait substrate to ANY architectural-extension empirical validation.** Methodology-evolution candidate — codify **"Director-requested-empirical-A/B-validation-of-substrate-extension"** as positive-pattern (sibling to idea-300 Survey positive-pattern `Director-Round-2-clarifying-question-as-substrate-currency-audit-surface`). Q5 multi-pick on mutually-exclusive framing (c+d) treated as contradictory-constraint per §7 — constraint envelope = "defense-in-depth persona hydration across all coord-event types"; Design-phase satisfies via layered bootstrap + cognitive-cycle + pulse mechanisms.

---

## §contradictory — Contradictory multi-pick carry-forward

Per `idea-survey.md` §7 — contradictory multi-pick on mutually-exclusive question IS A SIGNAL of constraint envelope, not error. Director's intent: "there's some common satisfiable constraint I'm going for." Architect carries forward to Design phase as constraint to satisfy via brainstorm.

| Round | Question(s) | Picks | Constraint envelope description |
|---|---|---|---|
| 2 | Q5 | c, d | **Defense-in-depth persona hydration across all coord-event types.** Director wants multiple cold-pickup integration mechanisms layered for resilience: bootstrap MCP at session-start (cold-start path), cognitive-cycle auto-injection of active-state subset at every Hub-bound tool call (ongoing-context path), pulse-driven persona-projection in pulse-fire prompts (stale-session-resume path). Not contradictory in intent — complementary integration-points across different session-startup paths. Design-phase satisfies constraint via single canonical `persona-projection` function with multiple consumers (per architect-flag F2). |

---

## §8 Cross-references

- **`docs/methodology/idea-survey.md`** v1.0 — canonical Survey methodology; idea-301 Q6 extension proposes Mode-A-vs-Mode-B mechanism that could become methodology-evolution candidate at Phase 10
- **`docs/methodology/mission-lifecycle.md`** §3 — `substrate-introduction` mission-class taxonomy entry
- **`docs/calibrations.yaml`** — calibration ledger cross-refs (closures-applied: empty; candidates-surfaced: positive-pattern Director-requested-empirical-A/B-validation + Q5 contradictory-multi-pick-as-defense-in-depth-signal)
- **idea-301** — source idea (filed 2026-05-18 architect-direct post mission-83 retro)
- **idea-300** — M-Hub-Storage-FS-Retirement (Phase 3 Survey complete; sequence-flexible cousin)
- **idea-298** — M-Hub-Storage-Cloud-Deploy (independent; no sequence dependency)
- **mission-83** — M-Hub-Storage-Substrate (substrate-introduction precedent; SchemaDef + reconciler pattern this mission applies at meta-layer to behavioral-observation domain)
- **`docs/reviews/m-hub-storage-substrate-retrospective.md`** — mission-83 Phase 10 retro (Trait substrate idea originated from retro Director-engagement pattern observations)
- **`feedback_director_strategic_maximalism_discipline_defended.md`** + **`feedback_director_clarifying_question_as_audit_surface.md`** + **`feedback_director_mission_close_as_forward_architecture.md`** — the 3 Director-trait memories ready to bootstrap as trait-001/002/003 (per F5 migration mechanism)
- **`feedback_substrate_currency_audit_rubric.md`** ARCHITECT-SIDE EXTENSION — discipline-pattern Trait substrate codifies + composes with
- **`feedback_counter_collision_substrate_defect_pattern.md`** — race-correctness pattern relevant to Reconciler observation-write concurrency

---

— Architect: lily / 2026-05-18 (Phase 3 Survey envelope; Director-ratified 6 picks across 2 rounds + Director-extension on Q6 — Mode-A-vs-Mode-B Delta-analysis methodology-validation primitive; contradictory-constraint Q5 captured for defense-in-depth Design-phase brainstorm; pre-bilateral round-1 audit branch push pending per calibration #59 closure mechanism (a))
