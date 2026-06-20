# CDACC — Calibrated Dual-Altitude Conformance Council

**Version:** v1.1 (DRAFT — co-design CONVERGED; pre-P0-ratification)
**Status:** DESIGNED + co-design converged (thread-660, Lily+Greg, rounds 1-6, 2026-06-20). Pre-execution. Awaiting P0 ratification (Director + Lily + Greg).
**Authors:** lily (architect) — draft basis + spec-altitude design. Greg (engineer) — co-owner of the engineer-altitude half + co-ratifier (accepted thread-660).
**Class:** repeatable multi-agent audit exercise. This is a methodology doc — peer to `mission-lifecycle.md`, `strategic-review.md`, etc.
**Origin:** Director ask (2026-06-20) — "design a collaborative exercise where the two principals, each running expansive ultracode workflows, then convening as a council, produce an aggregate that exceeds either alone." First intended instantiation: a comprehensive joint audit of the whole system against each Tele + a Tele-improvement audit.

---

## 0. What this document is

Two parts, deliberately separated so the *method* outlives the *first exercise*:

- **Part A — the meta-design method.** How we design a collaborative multi-agent exercise whose aggregate exceeds either principal alone. Reusable independent of CDACC.
- **Part B — CDACC v1.** The first exercise that method produced: a dual-altitude conformance council that audits the whole system against each Tele and yields a spec↔reality **drift-map** plus a **tele-improvement** output. Part B is the thing we ratify and run.

The meta-meta-meta framing: we are designing the exercise *before* performing it, and we designed it by *dogfooding the very property the exercise is meant to exploit* (aggregate > individual). The co-design itself demonstrated the thesis — see A.6.

---

# PART A — The Meta-Design Method

## A.1 The problem class

We have two high-reasoning principals — **Lily** (architect; spec/intent altitude) and **Greg** (engineer; code/reality altitude) — plus dynamic Workflow orchestration that can fan out 100+ sub-agents in parallel/pipeline with schema-validated output, adversarial-verify, and loop-until-dry. The standing question: **how do we maximally stress our aggregate system to our own strategic advantage — such that the sum of the two principals (each amplified by its own sub-agent fleet) exceeds the value of either alone?**

This is not "run two audits and union the results." Union is additive. We want **super-additive**: findings that exist *only in the combination* and could not be minted by either principal working alone.

## A.2 The aggregation principle (the thing every design must satisfy)

Aggregate > individual requires two properties simultaneously:

1. **Decorrelated error.** Two minds that fail the same way add nothing — their agreement is a *hedge*, not corroboration. Decorrelation is the scarce resource. (Same base model is a hard correlation floor we cannot design away from inside one model family — see A.3 and B.7 decision 1.)
2. **Super-additive combination.** The convergence step must *produce*, not *average*. If the output is "the opinion both agreed on," we built a consensus machine, not an aggregator. The output must include findings that live in the **cross** of the two perspectives.

A compact selector falls out of this:

> **seam-value = decorrelation × relevance-to-target.**

The "seam" is the axis along which we split the two principals' work. Pick the seam that maximizes the *product*, **and is native** — a specialization the principals already embody, so the decorrelation is real, not assigned.

## A.3 The method: multi-agent design-panel

To *design* such an exercise we dogfood the aggregation principle itself:

1. **Diverge** — generate N independent design archetypes via parallel sub-agents, each a *different collaboration shape*.
2. **Critique (adversarial)** — score each archetype against the aggregation principle: decorrelation, relevance, super-additivity, anti-stall, cost. Adversarial, not charitable.
3. **Synthesize** — take the highest-scoring *partition* as the spine, graft the best defenses from the runners-up, and **add the defense every archetype missed.** The synthesis is where the real design value is created.

## A.4 Provenance of the CDACC run

- **Run:** `wf_f1927941-397` (multi-agent design-panel Workflow).
- **Archetypes (5)** + adversarial-critique scores: orthogonal-partition **4**, divergence-mining **4**, steelman/dialectic **4**, tribunal/role-swap **3**, blind-replication **3**.
- **Why the low scorers lost:** role-swap and identical-replication both *destroy* the native specialization — they fight the real seam.
- **What the synthesis ADDED that no archetype had:** the recognition that **same-model agreement amplifies a confident shared error**, and the two instruments that turn "we agreed" into a *measured* claim — a **ground-truth canary** and a **common-mode critic**.

## A.5 Generalizable recipe (run this to design the *next* such exercise)

1. **State the target** precisely. The target determines relevance.
2. **Enumerate candidate seams**, score each by decorrelation × relevance, prefer native over assigned.
3. **Run the design-panel** (A.3).
4. **Stress the synthesis for common-mode failure** — ask "how do both principals fail *together*?" and add an instrument that *measures* the residual correlation (canary/ground-truth).
5. **Ratify before executing** — Director-ratified P0 gate; principals draft, Director ratifies.
6. **Make it re-runnable** — design the output as a *delta-able artifact* (the drift-map vs a frozen snapshot) so runs track change.

## A.6 Worked example — the council caught a drift in its own design doc

The strongest validation of the method arrived during the co-design itself. The v1.0 draft specified the verdict-seal primitive as `create_document(kind=report)`. From the **code altitude**, Greg found that primitive does not exist as written — `create_document` takes no `kind` param, and `create_report` is a *separate* primitive that (fatally) dispatches a `report_submitted` notification to architects on submit, breaking blind-seal. **A spec↔reality drift, inside the design doc of the drift-mapping exercise, caught by the cross-altitude read** before a line of it ran. This is not an embarrassment; it is the thesis demonstrated on the instrument before first use. The whole co-design (thread-660) ran this way in both directions — see B.3.

---

# PART B — CDACC v1 (the exercise to ratify and run)

## B.1 Thesis

> Two principals audit **one frozen snapshot** against **each Tele** from orthogonal **native altitudes** — **Lily = spec/intent (the MAP)**, **Greg = code/reality (the TERRITORY)** — **seal** their verdicts blind, then converge in a Hub-thread **council** whose product is the **spec↔reality drift-map**, hardened so two same-model minds cannot amplify a confident error.

The headline value is the **drift-map**: a finding of the shape *spec says PASS / code says FAIL* (or the reverse) exists **only in the cross** of the two altitudes. This is the bug-137/bug-138 class. CDACC is the instrument that would have caught that class structurally, before live.

## B.2 The principals and their altitudes

| | Lily (architect) | Greg (engineer) |
|---|---|---|
| **Altitude** | spec / intent — the MAP | code / runtime — the TERRITORY |
| **Native question** | *should* X happen? what does the tele oblige? | *does* X happen? what does the code do? |
| **Native stance** | builder of obligations | falsifier / breaker |
| **Fan-out shape** | doc-corpus, designs, methodology, tele-defs, ledger | source, tests, runtime behavior, reproduction |

The builder/breaker adversarial axis is **already composed in** by the altitude seam — not assigned. Adversarial *pressure* is applied at convergence (common-mode critic + tie-break probe + steelman), never as a role costume.

## B.3 The value engine — why aggregate > individual

1. **Cross-validation, hardened.** AGREE cells earn "cross-validated-high" ONLY if they survive the common-mode critic.
2. **Drift-mining (the headline).** spec-PASS / code-FAIL exists only in the cross — the bug-138 class. Neither altitude produces it alone.
3. **Gap-detection.** Union of both completeness-critics, reconciled against an explicit UNAUDITED ledger.
4. **Path-synthesis.** Remediation hybridizes spec-root + code-symptom, causally sequenced.
5. **Instrument-calibration.** Canary recall + precision are *measured* accuracy numbers no single audit can state.

**Demonstrated in the design itself** (thread-660): from the code altitude Greg found a PEEK hole in the seal, the `create_document` primitive-drift (A.6), and the reproduction-precondition the headline yield depends on; from the spec altitude Lily forced the symmetric spec-side proof-bar, the drift-latent class, and the materiality dial; Greg then caught that the materiality dial could itself become a re-suppression vector for the silent-degradation class. **Neither principal would have produced this design alone.**

## B.4 Protocol (P0–P10)

- **P0 — Charter & Calibration.** Lily + Greg draft; Director ratifies (Phase-3-survey style; **verdict-neutral**). Establishes: the **frozen snapshot 4-tuple** (B.5); the **live tele-set** dumped to a held artifact (NOT re-queried — `list_tele` is mutable); the per-cell **verdict schema** `{tele, PASS|PARTIAL|FAIL, evidence[], evidence-tier, severity, remediation, self-confidence}`; the **dual proof-bar + per-tele harness table** (B.6); the **severity rubric** anchored to Director-impact-on-blast-radius (B.6).
- **P1 — Canary injection** (neutral-held ground truth). **Two-sided traps** (B.6): real-bug plants (reproduced-tier signatures — relocated-field-read-off-raw-envelope in a fresh consumer; missing renameMap filter-translate entry; CAS re-envelopes a stale field) AND **false-positive traps both altitudes** (code: reads-broken / runs-correct; spec: looks-violated-strict / satisfied-operationally). Yields **recall + precision for BOTH principals**. **Two-principal plant-authorship** (architect authors the spec-trap intent; engineer establishes operational ground-truth via reproduction). Plants enter as an **opaque/squashed snapshot** so they're not `git diff`-fingerprintable; plant-diff held by the holder.
- **P2 — Blind dual-altitude fan-out** (PARALLEL, orchestrator-isolated). Per altitude: **P2a** classify (1 cheap agent/tele → class + required-tier + candidate surfaces); **P2b** per-tele pipeline [locate surfaces → escalate the tier ladder until bar-hit or exhausted → adversarial-verify by a breaker sub-agent prompted default-to-refuted]; **P2c** completeness-critic + loop-until-dry (K=2, max-4-rounds/tele); **P2d** seal. **Severity assigned by a SEPARATE rater** from the finder (the finder over-claims by nature — de-bias structurally). Tiered evidence per B.6.
- **P3 — Seal + symmetric unseal.** Seal primitive = **`create_document`** (silent `[Any]`; returns `resourceVersion`; NOT `create_report` — it dispatches a notification that breaks blind-seal). **Independence by construction:** content-free **commit-reveal** — each principal first registers ONLY `sha256(verdict-vector)+nonce` (leaks nothing); full content revealed ONLY after BOTH commitments exist. **Integrity:** the holder pins `(hash, resourceVersion, updatedAt)` at the commitment gate; at unseal, re-read — any rv/updatedAt bump = overwrite, hash-mismatch = tamper. Confirm BOTH commitments registered before ANY reveal. Independence ends here, never reopens.
- **P4 — Diff & classify** (cheap classifier). Every tele×component cell → AGREE-PASS / AGREE-FAIL / DISAGREE / GAP / **UNAUDITED** (any cell neither reached is explicit, never blank). Same verdict via *contradictory evidence* → DISAGREE.
- **P5 — Common-mode critic + canary scoring.** Attack a SAMPLE of AGREE cells for a shared blind spot both inherited. AGREE-PASS earns "cross-validated-high" only if it survives. Score canary **recall + precision (both sides)** — a run below the quality floors (B.7) is flagged LOW-TRUST before any verdict ships.
- **P6 — Mutual steelman** (commit-then-simultaneous-reveal — mirrors the P3 seal).
- **P7 — Mining + DECISION LADDER** (per contested cell, ≤4 turns):
  - **RECONCILED** — evidence-precedence (code-reproduction wins "does X happen"; cited-spec wins "should X happen").
  - **DUAL-TRUTH / DRIFT** — both true at different altitudes = the spec↔reality drift finding (auto-`create_bug` when material — B.6).
  - **TIE-BREAK PROBE** — a **deterministic Workflow sub-agent** (fixed prompt + frozen SHA + schema'd verdict + `effort:high`), NOT `create_task` (bug-159-immune; carries the **reproduced tier** = dispositive). Both principals pre-commit to its output. `create_audit_entry` preserves the chain.
  - **ESCALATE** — `create_clarification`, **batched to the single P10 Director gate** (not a mid-run stream), capped at **≤20% of CONTESTED cells** (>20% ⇒ run flagged low-autonomous-resolution). default-verdict-on-timeout is **orchestration-owned** (a Workflow that waits N then proceeds — the Hub has no such timer).
- **P8 — Cross-tele correlation + off-grid.** Cluster PARTIAL/FAIL across cells → root-causes spanning teles = calibration-pathology candidates. OFF-GRID channel for findings mapping to no single tele (feeds B.8 tele-improvement).
- **P9 — Converge & materialize.** `close_thread` converged=true, summary = the ratified drift-matrix; cascade `create_audit_entry` (per verdict + surviving evidence + dissent), `create_bug` (per material DUAL-TRUTH/FAIL), `create_idea` (remediation / UNAUDITED-waiver / tele-mis-spec). **Tele-mutations (`retire_tele`/`supersede_tele`/`create_tele`) are `[Architect]`-gated → the architect executes any close whose cascade mutates a tele.** Emit convergence-quality metrics (resolved/forwarded, canary recall+precision, drift-rate).
- **P10 — Director gate.** Scorecard → explicit go / no-go / prioritized-backlog. Re-runnable against the next snapshot for drift tracking.

## B.5 The frozen snapshot — a 4-tuple

Reproduction is dispositive only against a pinned world. The snapshot is **four pinned artifacts**, not just a git SHA:

1. **code-SHA** — one commit for source AND doc-corpus.
2. **tele-data-dump** — `list_tele` is a mutable Hub read; dump it to a held artifact at P0 so both principals audit the *same* set.
3. **canary-plant-diff** — held by the holder (P1).
4. **holder-gate-logic** — the holder's exact gate script, pinned so a later run can diff it and confirm the instrument didn't change ("determinism you can't inspect is trust with extra steps").

**Reproduced-tier = testcontainer-from-SHA is dispositive; read-only live-prod is secondary corroboration, valid only under an explicit deploy-freeze** (watchtower auto-deploys any `:latest` push, so live prod is a moving target — the mission-90 lesson: testcontainers is the boot-proof, not live).

## B.6 The proof-bar system (the discipline that makes the drift-map real)

The headline yield (spec-PASS × code-FAIL) is trustworthy **only if BOTH legs clear their bar.** An unreproduced code-FAIL crossed with an uncited spec-PASS is two opinions, not a drift.

**Code-side bar (engineer) — reproduction-required.** Tier ladder per tele-class: `asserted (static read) < traced (call-path + data-flow) < tested (test green at SHA) < reproduced (probe vs the tele's harness)`. A behavioral verdict cannot exceed traced-confidence without reproduction: a behavioral PASS at asserted/traced → **PARTIAL(tier-flagged)**; a behavioral FAIL at asserted → **hypothesis** → routes to the tie-break probe, never a sealed FAIL. **A verdict that can't reach its required tier is UNAUDITED-at-bar, NOT FAIL** (conflating "couldn't reproduce" with "fails" poisons canary precision).

**Spec-side bar (architect) — cited-obligation.** Chain: `tele → ratified design/methodology clause → checkable assertion` (not tele-text-only — that keeps the bar satisfiable). A spec verdict that can't cite past the author's own reading is **interpretation-tier**. The spec leg owes good-faith intent-traceability (cite the tele + why its intent implies the claim); the spec-FP-trap + common-mode critic police it so interpretation isn't a license for spec-noise.

**The drift-latent class (the founding-example fix).** Teles are *aspirational asymptotes*, not specs — at the moment a drift exists, the obligation is usually not-yet-operationalized (bug-138 had no ratified "consumers read flat" clause until mission-90 wrote it, *after*). A strict spec-gate would have routed bug-138 OUT of the drift-map into tele-language — suppressing CDACC's founding example. So: **interpretation-spec × reproduced-code-FAIL is NOT gated out.** It is tagged **drift-latent (obligation-unspecified)** and dual-routed to the drift-map (confidence-labeled) AND the tele-improvement output (this obligation needs operationalizing). Confidence *labels*; it does not *gate*.

**The materiality dial (keeps drift-latent from flooding — without re-suppressing).** Ungated, interpretation × reproduced floods (the code "falls short of perfection" per some tele-intent almost everywhere). Materiality is an **impact axis, orthogonal to confidence**: MATERIAL → actionable drift-map; IMMATERIAL → tele-improvement-backlog only. Two teeth so "immaterial" can't become the new silent-drop of the silent-degradation class:
- **(a) scored on BLAST-RADIUS** (reachability / consumer-count / entity-kinds-touched), NOT the local symptom — bug-138 was "one field returns undefined" locally (immaterial-by-glance) but catastrophic by reach. A reproduced drift gets a reachability trace before its materiality verdict.
- **(b) default-to-MATERIAL on uncertainty** (mirrors the falsifier's default-to-refuted) — when reach is unclear, it stays in the drift-map.

Materiality is therefore itself a **two-altitude product**: the architect's Director-impact rubric × the engineer's blast-radius/reachability trace. It cannot be pulled from one altitude.

**Per-tele required-harness table.** The proof-bar ceiling is a property of the *tele*, not harness brokenness — and it is set per-tele with a stated reason, **never blanket-by-domain** (ceiling-by-domain hands the highest-Director-impact teles the weakest bar — backwards). Harness ∈ `{schema-decode | chaos-injection | incident-replay | metric-observation}`. Two-altitude: the **architect specifies what evidence the tele's intent demands**; the **engineer specifies the reproducing harness + whether it's reachable in-window**. Genuine traced/metric-ceilings are reserved for time/scale/real-incident-only teles (e.g. "no poll-pressure CPU regression over weeks" = metric-observation-tier; UNAUDITED-at-ceiling if unobservable in-window, not FAIL).

*Worked example — tele-7/9 (resilience) SPLIT for v1:*
| slice | harness | window | v1 disposition |
|---|---|---|---|
| substrate-crash-recovery (kill `ois-postgres` mid-write → assert reconnect + LISTEN/NOTIFY re-subscribe + zero committed-write loss) | chaos-injection (testcontainers exist; thin add) | in-window | **build v1 → reproduced** |
| deploy-self-heal (watchtower/registry recreate) | incident-replay | out-of-window | spec + **defer v2** (UNAUDITED-at-reproduced, harness-specified) |
| network-partition (Hub↔PG, latency) | chaos-injection (toxiproxy-style) | out-of-window | spec + **defer v2** |

## B.7 Decisions (Director-confirmed 2026-06-20; co-design converged thread-660)

1. **Model diversity — DEFERRED** until the network spans other models. Same base model ⇒ "agreement" is a hedge; the canary + common-mode-critic are mitigation, not cure. Headline argument FOR the eventual multi-model extension.
2. **Role seam — architect/engineer altitude as the PRIMARY conformance axis** (native, highest decorrelation × relevance; role-swap/equal scored worst). Adversarial pressure at convergence, not as a role.
3. **Tele-improvement — emerges from conformance friction (first-class 2nd output) + a normative pass** (the descriptive-vs-normative second seam, applied as a derived pass). Drift-latent findings (B.6) feed it directly.
4. **Seal primitive — `create_document`** (B.6/A.6): silent + returns rv; `create_report` rejected (notification breaks blind-seal; no rv to pin; task-coupled).

### B.7-knobs (engineer-drafted, converged)
- **K (loop-until-dry):** 2 consecutive empty rounds + hard **max-4-rounds/tele**.
- **Dispute budget:** ≤4 council turns/cell + **~24 global**; past the cap, force-resolve via the reproduced-tier probe (dispositive) or batch-default.
- **Escalate cap:** ≤20% of CONTESTED cells, **batched to the single P10 gate** (honors gate-points-only RACI).
- **Per-tier budget ladder:** asserted ≈1 agent, +traced ≈2, +tested ≈2, +reproduced ≈3 → reproduced-tele ≈8 agents, traced-ceiling-tele ≈5. ~20 teles ⇒ ~100-160 agents. Plus a fixed **~5-agent harness pre-flight** (self-seeded probes) BEFORE the blind sweep — fail-fast if the fan-out can't reach reproduced-tier.
- **Convergence-quality floors:** canary recall ≥0.80, precision ≥0.85 (both sides), resolved/forwarded ≥0.80. **DIAGNOSTIC on run-1** (run 1 is itself instrument-calibration — we don't know our own achievable precision until the canary measures it; a run-1-below-floor still ships flagged LOW-TRUST and RESETS the floors to empirically-achievable), **GATING from run-2**.

## B.8 The tele-improvement output (the normative second seam)

The conformance audit's *friction* is the primary signal for improving the Tele set — a first-class second output:
- **Interpretive** (not factual) disagreement on a tele → tele-**LANGUAGE** ambiguity → refine wording.
- **drift-latent (obligation-unspecified)** finding (B.6) → the tele needs **operationalizing** into a checkable clause.
- **Off-grid** finding (P8) → **COVERAGE** gap → new/extended tele.
- **Contradictory / obsolete / un-auditable** tele → refine / supersede / retire.

Plus a dedicated **NORMATIVE pass** — first-principles + external-comparison ("how do K8s / mature frameworks frame this concern — what are we missing from *outside* our paradigm?"). Architect-altitude leads language/coverage; engineer-altitude contributes "the tele misses this operational reality."

## B.9 The holder

A real **stateful component**, not a role. It pins the commitments (P3), holds the canary plant-diff (P1), authors the canary's expected verdicts (reproduction-capable), and runs the unseal gate. Its neutrality = **determinism** (fixed logic, authors no *audit* verdict) + **inspectability** (gate-logic pinned in the snapshot, B.5). For v1 the holder IS the council Workflow orchestrator; it is **reproduction-capable-but-verdict-neutral**. Flagged v1 residual: *who audits the holder?* — nobody; trust rests on determinism + inspectability, not verification. Acceptable at v1.

## B.10 Cost / scale

~100-160 sub-agent invocations (the two fan-outs run in PARALLEL = max, not sum) + a ~5-agent pre-flight + ~24 council dispute-turns. A **one-off mission-wave instrument**, NOT a recurring CI gate — the tele-11 (cognitive-minimalism) tension is explicit and bounded by ratified cadence (B.11).

## B.11 P0 ratification checklist (what remains for the Director gate)

The co-design (thread-660) RESOLVED most of v1.0's open questions (seal primitive, snapshot mechanics, proof-bars, knobs, holder). What remains for Director ratification:
- **Charter sign-off:** the verdict-schema + severity rubric (Director-impact-on-blast-radius) + the per-tele harness table (verdict-neutral).
- **Canary sign-off:** plant count + the real/false-positive mix + holder/authorship (architect spec-traps, engineer code ground-truth) + who-may-see (holder only).
- **Snapshot logistics:** can we pin a code-SHA + deploy-freeze window if any live-prod secondary corroboration is wanted, or testcontainer-only for v1?
- **Director SLA** at the single P10 gate + the default-verdict-on-timeout policy (reconciled with gate-points-only RACI).
- **Run cadence:** one-off mission-wave vs periodic (the ~100-160-agent sweep vs tele-11).
- **v1 scope confirm:** tele-7/9 substrate-crash slice built for v1; deploy-self-heal + network-chaos deferred to v2 (B.6 table).
- **Quality-floor policy:** diagnostic-on-run-1 / gating-from-run-2 (B.7-knobs).

---

## Appendix — provenance / coordination

- **Design-panel run:** `wf_f1927941-397`.
- **Co-design + co-ratification thread:** `thread-660` (Lily+Greg, converged 2026-06-20; full hardened design in the thread summary).
- **Draft basis:** `docs/handoffs/m90-close-and-cdacc-design-handoff.md` (superseded for CDACC content by this doc).
- **Seed discipline:** the mission-90 deep-adversarial-audit (calibration #83) — CDACC generalizes it from one-shot to a calibrated dual-altitude instrument.
