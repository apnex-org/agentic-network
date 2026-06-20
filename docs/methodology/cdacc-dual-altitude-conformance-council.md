# CDACC — Calibrated Dual-Altitude Conformance Council

**Version:** v1.0 (DRAFT — pre-ratification)
**Status:** DESIGNED, pre-execution. Awaiting (a) Greg loop-in + co-ownership of the engineer-altitude half, (b) P0 ratification (Director + Lily + Greg).
**Authors:** lily (architect) — draft basis. Greg (engineer) — co-owner of the engineer-altitude half + co-ratifier (pending loop-in).
**Class:** repeatable multi-agent audit exercise. This is a methodology doc — peer to `mission-lifecycle.md`, `strategic-review.md`, etc.
**Origin:** Director ask (2026-06-20) — "design a collaborative exercise where the two principals, each running expansive ultracode workflows, then convening as a council, produce an aggregate that exceeds either alone." First intended instantiation: a comprehensive joint audit of the whole system against each Tele + a Tele-improvement audit.

---

## 0. What this document is

Two parts, deliberately separated so the *method* outlives the *first exercise*:

- **Part A — the meta-design method.** How we design a collaborative multi-agent exercise whose aggregate exceeds either principal alone. This is reusable independent of CDACC — the next "how do two agents + N sub-agents maximally stress the system to our advantage" question reuses Part A.
- **Part B — CDACC v1.** The first exercise that method produced: a dual-altitude conformance council that audits the whole system against each Tele and yields a spec↔reality **drift-map** plus a **tele-improvement** output. Part B is the thing we ratify and run.

The meta-meta-meta framing: we are designing the exercise *before* performing it, and we designed it by *dogfooding the very property the exercise is meant to exploit* (aggregate > individual). Part A records that so it is repeatable, not a one-off.

---

# PART A — The Meta-Design Method

## A.1 The problem class

We have two high-reasoning principals — **Lily** (architect; spec/intent altitude) and **Greg** (engineer; code/reality altitude) — plus dynamic Workflow orchestration that can fan out 100+ sub-agents in parallel/pipeline with schema-validated output, adversarial-verify, and loop-until-dry. The standing question: **how do we maximally stress our aggregate system to our own strategic advantage — such that the sum of the two principals (each amplified by its own sub-agent fleet) exceeds the value of either alone?**

This is not "run two audits and union the results." Union is additive. We want **super-additive**: findings that exist *only in the combination* and could not be minted by either principal working alone.

## A.2 The aggregation principle (the thing every design must satisfy)

Aggregate > individual requires two properties simultaneously:

1. **Decorrelated error.** Two minds that fail the same way add nothing — their agreement is a *hedge*, not corroboration. Decorrelation is the scarce resource. (Same base model is a hard correlation floor we cannot design away from inside one model family — see A.3 and Part B §B.6 decision 1.)
2. **Super-additive combination.** The convergence step must *produce*, not *average*. If the output is "the opinion both agreed on," we built a consensus machine, not an aggregator. The output must include findings that live in the **cross** of the two perspectives.

A compact selector falls out of this:

> **seam-value = decorrelation × relevance-to-target.**

The "seam" is the axis along which we split the two principals' work. Pick the seam that maximizes the *product*. A seam with huge decorrelation but no relevance (two unrelated tasks) yields independent-but-useless work. A seam with high relevance but no decorrelation (two identical audits) yields correlated redundancy. The best seam is high on both **and is native** — a specialization the principals already embody, so the decorrelation is real, not assigned. (Assigned/role-swapped decorrelation fights the genuine specialization that IS the value — see Part B §B.6 decision 2.)

## A.3 The method: multi-agent design-panel

To *design* such an exercise we dogfood the aggregation principle itself:

1. **Diverge** — generate N independent design archetypes via parallel sub-agents, each a *different collaboration shape* (different seam, different convergence mechanism). Force genuine divergence by prompting each archetype from a distinct frame.
2. **Critique (adversarial)** — score each archetype against the aggregation principle: decorrelation, relevance, super-additivity, anti-stall (can it converge without faking it?), and cost. Adversarial, not charitable — each archetype is attacked for its failure mode.
3. **Synthesize** — take the highest-scoring *partition* as the spine, graft the best defenses from the runners-up, and **add the defense every archetype missed.** The synthesis is where the real design value is created — the panel surfaces the option space; the synthesis closes the gaps none of them saw.

The third step is load-bearing. A panel that only *picks a winner* is a vote. A panel whose synthesis *adds what no member proposed* is itself super-additive — the method demonstrates the property it is designing for.

## A.4 Provenance of the CDACC run

- **Run:** `wf_f1927941-397` (multi-agent design-panel Workflow).
- **Archetypes (5)** and adversarial-critique scores:
  - orthogonal-partition — **4**
  - divergence-mining — **4**
  - steelman/dialectic — **4**
  - tribunal/role-swap — **3**
  - blind-replication (identical-replication) — **3**
- **Why the low scorers lost:** role-swap and identical-replication both *destroy* the native specialization. Role-swap trades relevance for a shallow, assigned decorrelation; identical-replication has near-zero decorrelation (same model, same task) so its "agreement" is pure hedge. Both fight the real seam.
- **What the synthesis ADDED that no archetype had:** the recognition that **same-model agreement amplifies a confident shared error**. None of the five archetypes defended against common-mode failure. The synthesis added the two instruments that turn "we agreed" into a *measured* claim — a **ground-truth canary** (seeded known findings → recall + false-positive numbers) and a **common-mode critic** (attack the cells where both agreed, looking for the shared blind spot). These are the difference between a council that *feels* trustworthy and one whose trust is *instrumented*.

## A.5 Generalizable recipe (run this to design the *next* such exercise)

1. **State the target** precisely (here: conformance of the system to each Tele + tele-improvement). The target determines relevance.
2. **Enumerate candidate seams** and score each by decorrelation × relevance. Prefer native specialization over assigned roles.
3. **Run the design-panel** (A.3) — diverge into archetypes, adversarially critique, synthesize.
4. **Stress the synthesis for common-mode failure** — explicitly ask "how do both principals fail *together*?" and add an instrument that *measures* the residual correlation (canary/ground-truth), not just a process that hopes to avoid it.
5. **Ratify before executing** — the protocol's tunable knobs and verdict-neutral scaffolding are Director-ratified at a P0 gate; principals draft, Director ratifies (Phase-3-survey style).
6. **Make it re-runnable** — design the output as a *delta-able artifact* (here: the drift-map vs a frozen snapshot) so successive runs track change, not just restate state.

---

# PART B — CDACC v1 (the exercise to ratify and run)

## B.1 Thesis

> Two principals audit **one frozen snapshot** against **each Tele** from orthogonal **native altitudes** — **Lily = spec/intent (the MAP)**, **Greg = code/reality (the TERRITORY)** — **seal** their verdicts blind, then converge in a Hub-thread **council** whose product is the **spec↔reality drift-map**, hardened so two same-model minds cannot amplify a confident error.

The headline value is not "two audits." It is the **drift-map**: a finding of the shape *spec says PASS / code says FAIL* (or the reverse) exists **only in the cross** of the two altitudes. Neither principal mints it alone. This is precisely the bug-137/bug-138 class — the relocated-field reads that the spec blessed and the runtime silently broke. CDACC is the instrument that would have caught that class structurally, before live.

## B.2 The principals and their altitudes

| | Lily (architect) | Greg (engineer) |
|---|---|---|
| **Altitude** | spec / intent — the MAP | code / runtime — the TERRITORY |
| **Native question** | *should* X happen? what does the tele oblige? | *does* X happen? what does the code do? |
| **Native stance** | builder of obligations | falsifier / breaker |
| **Fan-out shape** | doc-corpus, designs, methodology, tele-defs, ledger | source, tests, runtime behavior, reproduction |

The builder/breaker adversarial axis is **already composed in** by the altitude seam — we do not assign it. Lily naturally states obligations; Greg naturally tries to falsify. Adversarial *pressure* is applied at convergence (common-mode critic + tie-break probe + steelman), never as a role costume.

## B.3 The value engine — five super-additive yields

Why the aggregate exceeds either principal:

1. **Cross-validation, hardened.** AGREE cells are not trusted on agreement alone — they must survive the common-mode critic to earn "cross-validated-high." Agreement becomes evidence only after it survives an attack on the shared blind spot.
2. **Drift-mining (the headline).** spec-PASS / code-FAIL (or reverse) exists only in the cross. This is the bug-137/138 class. Neither altitude produces it alone.
3. **Gap-detection.** The union of both completeness-critics, reconciled against an explicit UNAUDITED ledger — every tele×component cell neither principal reached is named, never silently blank.
4. **Path-synthesis.** Remediation hybridizes spec-root (Lily) + code-symptom (Greg), causally sequenced — a better fix than either altitude writes alone.
5. **Instrument-calibration.** Canary recall is a *measured* accuracy number. No single audit can state how much to trust itself; the council can.

## B.4 Protocol (P0–P10)

- **P0 — Charter & Calibration.** Lily + Greg draft; Director ratifies (Phase-3-survey style; **verdict-neutral** — the scaffolding must not pre-bias any verdict). Establishes: the **live tele-set** from `list_tele` (never from memory — memory drift is exactly what we audit); the **frozen snapshot** (pin one SHA for code AND the doc-corpus); the per-cell **verdict schema** `{tele, PASS|PARTIAL|FAIL, evidence[], evidence-tier, severity, remediation, self-confidence}`; a per-tele **PROOF-BAR** (behavioral teles → strict reproduction; methodology teles → evidence-of-practice); a per-tele **AUDITABILITY class** `{both-altitude | spec-dominant | code-dominant}`; a **severity rubric** anchored to Director-impact.
- **P1 — Canary injection** (neutral-held ground truth). Seed KNOWN closed findings (bug-137/138/156/157 shapes) + 2–3 freshly-planted spec/code discrepancies. Expected verdicts are held by the neutral holder, NOT shown to principals → yields **recall + false-positive** numbers. This is the instrument no archetype proposed.
- **P2 — Blind dual-altitude fan-out** (PARALLEL, orchestrator-isolated — NOT honor-system, because the Hub is a shared backplane and either principal could see the other's writes). Tiered evidence (**reproduced > tested > traced > asserted**) with per-tier budget; internal adversarial-verify + completeness-critic, loop-until-dry capped at **K**. Each verdict-vector is SEALED via content-hashed `create_document(kind=report)`.
- **P3 — Symmetric unseal.** Confirm BOTH sealed documentIds are registered before ANY content is revealed; explicit hash recompute-compare (`create_document` is silently overwritable → verification mandatory). Independence ends here and never reopens.
- **P4 — Diff & classify** (cheap classifier). Every tele×component cell → AGREE-PASS / AGREE-FAIL / DISAGREE / GAP / **UNAUDITED** (any cell neither reached is explicit, never a silent blank). Same verdict reached via *contradictory evidence* → DISAGREE, not AGREE.
- **P5 — Common-mode critic + canary scoring.** Attack a SAMPLE of AGREE cells for a shared blind spot both inherited (same base model + same ledger + same tele-defs = correlated error surface). AGREE-PASS earns "cross-validated-high" ONLY if it survives. Score **canary recall** — a run that missed seeded findings is flagged LOW-TRUST *before any verdict ships*.
- **P6 — Mutual steelman** (commit-then-simultaneous-reveal — mirrors the P2 seal so neither steelman absorbs the other's frame).
- **P7 — Mining + DECISION LADDER** (per contested cell, turn-boxed ≤ 4):
  - **RECONCILED** — evidence-precedence resolves it (code-reproduction wins "does X happen"; spec wins "should X happen").
  - **DUAL-TRUTH** — both true at different altitudes = the spec↔reality drift finding (highest value, auto-`create_bug`).
  - **TIE-BREAK PROBE** — spawn a deterministic fact-finder via `stagedActions=[create_task]` against the frozen snapshot; **both principals pre-commit to its verdict** (the anti-stall keystone: converts rhetoric → evidence).
  - **ESCALATE** — `create_clarification` to Director, default-verdict-on-timeout, with a **CAPPED escalate-fraction** so the council can't fake convergence by punting. (Two principals = no majority; genuine value-ties go to Director tie-break.)
- **P8 — Cross-tele correlation + off-grid.** Cluster PARTIAL/FAIL across cells → single root-causes spanning multiple teles = **calibration-pathology candidates**. Plus an **OFF-GRID channel** for findings that map to no single tele (these feed the tele-improvement output — see B.5).
- **P9 — Converge & materialize.** `close_thread` converged=true, summary = the ratified drift-matrix; cascade `create_audit_entry` (per verdict + surviving evidence + recorded dissent), `create_bug` (per DUAL-TRUTH / FAIL), `create_idea` (remediation / UNAUDITED-waiver / tele-mis-spec), `retire_tele` / `supersede_tele` where a tele is mis-specified. Emit **convergence-quality metrics** (resolved/forwarded ratio, canary-recall, drift-rate).
- **P10 — Director gate.** Scorecard → explicit go / no-go / prioritized-backlog (the "path forward" the matrix exists to feed). The run is re-runnable against the next snapshot for **drift tracking**.

## B.5 The tele-improvement output (the normative second seam)

The conformance audit's *friction* is itself the primary signal for improving the Tele set — this is a **first-class second output**, not a side-channel:

- **Interpretive** (not factual) disagreement on a tele → tele-**LANGUAGE** ambiguity → refine wording.
- **Off-grid** finding (P8) → **COVERAGE** gap → new or extended tele.
- **Contradictory / obsolete / un-auditable** tele → refine / supersede / retire.
- **Drift clustering** at an un-named boundary → strengthen the tele.

Plus a dedicated **NORMATIVE pass** — first-principles + external-comparison ("how do K8s / mature frameworks frame this concern — what are we missing from *outside* our paradigm?"). An inside-the-system audit structurally cannot see what the system never named; the normative pass is the only thing that can. This is the **descriptive-vs-normative second seam**, applied as a *derived pass*, not a competing role. Architect-altitude leads language/coverage; engineer-altitude contributes "the tele misses this operational reality."

## B.6 Decisions (2026-06-20; Director-confirmed)

1. **Model diversity — DEFERRED** until the network spans other models/harnesses. Same base model ⇒ "agreement" is a hedge, not independent corroboration; the canary + common-mode-critic are mitigation, not cure. This is the headline argument FOR the eventual multi-model extension.
2. **Role seam — KEEP architect/engineer altitude as the PRIMARY conformance axis.** seam-value = decorrelation × relevance; altitude is highest on both AND native (role-swap/equal scored worst — they fight the real specialization). NOT equal (zero seam, common-mode), NOT competing-role-swap (destroys relevance). Adversarial pressure stays at convergence. **Director-confirmed.**
3. **Tele-improvement — EMERGES FROM conformance friction (first-class 2nd output) + a small normative pass.** The descriptive-vs-normative second seam, applied as a derived pass not a competing role. **Director-confirmed.**

## B.7 P0 ratification checklist (the open questions — ratify before running)

- **Neutral holder** — Director vs a deterministic orchestrator-check; the unseal gate mechanics.
- **Knob values** — K (loop-until-dry cap), dispute budget, escalate-fraction cap, per-evidence-tier token budgets.
- **Canary design** — count; mix (closed-bug shapes vs freshly-planted); injection method (no contamination, not trivially pattern-matched); authorship (architect) + who-may-see (only the holder).
- **Frozen-snapshot mechanics** — can prod be pinned to one SHA for the window, or do we audit a tagged release artifact off the live path?
- **Per-tele PROOF-BAR + AUDITABILITY table** — Director-ratified, kept verdict-neutral.
- **Director adjudication SLA** + default-verdict-on-timeout (reconcile with the Director-at-gate-points-only RACI).
- **Run cadence** — one-off mission-wave vs periodic (the ~100–150-sub-agent sweep is itself in tension with tele-11 / resource-restraint).
- **Tele-mis-specification route** — retire/supersede vs filed Idea; block vs defer the verdict for that tele.
- **Convergence-quality thresholds** — resolved/forwarded ratio + canary-recall floor that make a run trustworthy enough to feed the gate.

## B.8 Cost / scale

~100–150 sub-agent invocations (the two fan-outs run in PARALLEL = **max, not sum**) + ~20–35 high-reasoning council turns. A **one-off mission-wave instrument**, NOT a recurring CI gate — the tele-11 tension is explicit and bounded by ratified cadence (B.7).

---

## Appendix — resume / coordination state

- **Greg loop-in:** pending. He co-owns the engineer-altitude half (the code/runtime fan-out shape + the falsifier discipline) and co-ratifies P0 — he is a principal in whatever we run. Loop-in via a Hub thread, *after* this draft (Director's sequencing, 2026-06-20).
- **Then:** P0 ratification (Director + Lily + Greg) → run the first per-tele instantiation (which also calibrates the instrument via canary recall).
- **Draft basis:** `docs/handoffs/m90-close-and-cdacc-design-handoff.md` (the pre-doc handoff; superseded by this doc for the CDACC content).
- **Provenance run:** `wf_f1927941-397`.
