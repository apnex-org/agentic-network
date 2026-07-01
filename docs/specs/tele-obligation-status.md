# Tele Obligation-Status Overlay

**Status:** DRAFT — for Director ratification. **Authored:** 2026-06-20 (architect; adversarially verified — 5-agent refute + consistency pass, 60 criteria).
**Provenance:** CDACC run-1 (`run-672bd0f`) headline normative output — see [drift-map §6](../cdacc/run-672bd0f/drift-map.md).
**Companion to:** [`docs/specs/teles.md`](./teles.md) (the canonical tele specification).

---

## 1. Why this is an overlay, not a tele edit

The teles' content fields (`name`, `description`, `successCriteria`) are **immutable once filed** (`teles.md` §Tele Lifecycle). Each tele is, by its own framing, *"a declaration of perfection — a qualitative asymptote toward which the system is engineered."* That is correct and must not change: the teles are the **fixed north stars**.

But CDACC run-1 found a structural ambiguity (the root of 5 of its 6 drift cells): a tele's `successCriteria` **read as shipped-MUSTs** while being **authored as asymptote-markers**. The map (spec) read them as direction-of-travel and PASSed; the territory (code) read them literally and FAILed. The disagreement *was* the finding.

This overlay resolves it **without touching immutable content**. It is a separate, **mutable, Director-ratified** layer that classifies each successCriterion by its *current conformance bar*. The teles stay pure perfection-declarations; this overlay is the **"where are we on the climb"** ledger — and a criterion **migrates** across classes (North-Star → directional → shipped-MUST) as the system builds toward it. That migration is the whole point: the asymptote is fixed, our distance to it is not.

---

## 2. The taxonomy, the rules, and the CDACC contract

### 2.1 The three classes

| Class | Meaning | A conformance audit FAIL here means… |
|---|---|---|
| **shipped-MUST** | A ratified, currently-achievable obligation. A regression is a real bug. | **Real, material drift** → actionable drift-map. |
| **directional-target** | Actively climbing; partially built with a known achieved-bar. | Measure against the **achieved bar**: below bar = drift; remaining gap-to-asymptote = expected. |
| **North-Star-asymptote** | The perfection-ideal; not yet built or obligated (often deferred). | **Expected** (roadmap, not regression) → tele-improvement / backlog. |

### 2.2 Classification rules (so future criteria classify consistently)

- **No-code rule.** A criterion with no code mechanism is **shipped-MUST only if** (a) it is **binary** (content-presence, not a graded quality), (b) a defined **review/template step rejects** the artifact for its absence, and (c) **no open calibration** accepts a current violation. Otherwise → directional-target.
- **Measurement rule.** If the criterion's *obligation is the instrument/metric itself* ("observable metric", "measured", "<X% measured"), its absence = **North-Star**. If measurement merely *verifies* an underlying behavior that is substantively achieved → **directional**.
- **Open-calibration-gating invariant.** A criterion whose violation is accepted by an **open** calibration is held **out** of shipped-MUST (→ directional) until that calibration closes. (Verified live: `#84` silent-degrade OPEN holds tele-7 SC1 out; `#64` stale-agentId OPEN holds tele-7 SC4 out; tele-5 SC4 is admitted because its cousin bug-137/138 is closed.)

### 2.3 The audit-method annotation (what makes this a usable oracle)

Every criterion carries an **Audit** tag telling CDACC *how to test it* — verified necessary because the shipped-MUST class otherwise conflates fundamentally different audit actions:

| Audit | CDACC action | FAIL disposition |
|---|---|---|
| **substrate** | run the test / query the substrate (code-mechanical) | normal — drift per class |
| **artifact** | read the artifact/report **content** (review/template-norm) | normal — drift per class |
| **harness** | lives in the adapter/harness layer **excluded from the Hub snapshot** | **UNAUDITED-at-ceiling, NOT drift** (per the CDACC "unobservable in-window = UNAUDITED" rule) |

### 2.4 Oracle-laundering guard (load-bearing)

**tele-7 SC1 and SC2 must remain SEPARATE audit cells.** Both are served by the same try/catch family: SC2 (error-isolation) is a shipped-MUST that PASSes, while SC1 (no-silent-failure) is the directional gap that calibration `#84` holds open. A combined cell would let an SC2 PASS **launder** an SC1 silent-masking FAIL — which is exactly the seam where the bug-137/138 silently-wrong-read class lived. Keep them distinct.

---

## 3. Classification

Per tele, per `successCriteria` item, aligned to the ratified [drift-map §4](../cdacc/run-672bd0f/drift-map.md) for the six drift cells. `SC#` indexes the numbered criterion in `teles.md`.

### tele-0 — Sovereign Intelligence Engine *(umbrella)*
| SC | Class | Audit | Basis |
|---|---|---|---|
| 1 composition invariant | shipped-MUST | artifact | binary inspection-norm; review-rejectable |
| 2 traceability to a tele | directional-target | artifact | **no `teleId` field + no tele-gate exists**; unmechanized authorship discipline, no review-rejection step (verifier-corrected from shipped-MUST) |
| 3 Directors never give how-to | directional-target | artifact | largely held; Director engages at gate-points |

### tele-1 — Sovereign State Transparency
| SC | Class | Audit | Basis |
|---|---|---|---|
| 1 survive restart, identical values | shipped-MUST | substrate | restart-safety; regression mechanically detectable |
| 2 no un-queryable private state | shipped-MUST | substrate | sovereign backplane (adapter-layer context sliver = harness, out-of-floor) |
| 3 topology via formal refactor only | shipped-MUST | substrate | schema-locked topology |

### tele-2 — Isomorphic Specification  *(drift cell — split)*
| SC | Class | Audit | Basis |
|---|---|---|---|
| *(substrate schema-isomorphism)* | **shipped-MUST** | substrate | storage ↔ `entity-kinds.json`, boot-reconciled (mission-83/90). **Conforms** — the part the code-FAIL did not cover |
| 1 PolicyRouter parses spec at runtime → FSMs | North-Star-asymptote | substrate | FSMs compiled-in TS (the asymptotic half) |
| 2 zero "Unhandled event" logs | directional-target | substrate | operationally clean; not a gate |
| 3 100% FSM coverage under chaos | North-Star-asymptote | harness | no TestOrchestrator (ties tele-9) |
| 4 active-state mismatch reverted | directional-target | substrate | reconciler = shipped partial; full revert North-Star |

### tele-3 — Sovereign Composition
| SC | Class | Audit | Basis |
|---|---|---|---|
| 1 one concern per module | directional-target | artifact | graded quality property → not binary |
| 2 interaction via declared contracts | shipped-MUST **(scoped)** | substrate | **scoped to the actor-kernel air-gap + Hub-storage repo-interface**; intra-Hub direct TS imports are out-of-floor (else false-drift generator) |
| 3 new capability by composition | directional-target | artifact | aspiration |
| 4 understandable from contract alone | directional-target | artifact | discipline |
| 5 boundary violations detectable | shipped-MUST | artifact | CODEOWNERS routes review; detectable-by-human-review only (no import-lint) |

### tele-4 — Zero-Loss Knowledge  *(drift cell — reconciled PASS)*
| SC | Class | Audit | Basis |
|---|---|---|---|
| 1 Mechanics+Rationale+Consequence per artifact | shipped-MUST | artifact | template-required; binary; review-rejectable (the spec PARTIAL was a literal-checklist over-read) |
| 2 prose wraps structured only | directional-target | artifact | discipline |
| 3 handover loses zero context (cold==warm) | North-Star-asymptote | artifact | "zero loss" is the asymptote |
| 4 doc volume exceeds raw intent | directional-target | artifact | behavior achieved; "consistently" unmetered (measurement-rule) |

### tele-5 — Perceptual Parity  *(drift cell — PARTIAL)*
| SC | Class | Audit | Basis |
|---|---|---|---|
| 1 system hydrates before "what is X?" | directional-target | substrate | hydration exists; not universal |
| 2 perception delta measurably <1% | North-Star-asymptote | harness | obligation IS the metric; uninstrumented |
| 3 synthetic sensory organs | North-Star-asymptote | harness | not built |
| 4 hallucinated state = a bug | shipped-MUST | artifact | ratified binary norm; cousin bug-137/138 closed |

### tele-6 — Frictionless Agentic Collaboration
| SC | Class | Audit | Basis |
|---|---|---|---|
| 1 no transcription of approved content | shipped-MUST | substrate | cascade primitives |
| 2 ratification → execution single call/cascade | shipped-MUST | substrate | cascade |
| 3 neither role blocked on other's admin | directional-target | artifact | mostly; historical gaps (bug-34 class) |
| 4 Policy Router enforces DAG invisibly | directional-target | substrate | partial |

### tele-7 — Resilient Agentic Operations  *(SC1/SC2 = separate cells, §2.4)*
| SC | Class | Audit | Basis |
|---|---|---|---|
| 1 no silent failures; actionable feedback | directional-target | artifact | calibration `#84` OPEN holds it out of floor |
| 2 error boundaries isolate | shipped-MUST | substrate | PolicyRouter isolation (do not let PASS launder SC1) |
| 3 adapters resume after rate-limit/drop | shipped-MUST | substrate | `get_pending_actions` state-based reconnect |
| 4 restart: no duplicate/hallucinated state | directional-target | substrate | calibration `#64` OPEN holds it out |

### tele-8 — Gated Recursive Integrity
| SC | Class | Audit | Basis |
|---|---|---|---|
| 1 binary pass/fail per layer | directional-target | artifact | CI gates; not fully layer-enumerated |
| 2 N+1 gated on N certification | directional-target | artifact | partial |
| 3 failure → downward audit | directional-target | artifact | discipline |
| 4 layers explicitly enumerated | North-Star-asymptote | artifact | no layer-enumeration registry |

### tele-9 — Chaos-Validated Deployment  *(drift cell — North-Star, self-deferred)*
| SC | Class | Audit | Basis |
|---|---|---|---|
| 1 TestOrchestrator covers workflows under chaos | North-Star-asymptote | harness | not built |
| 2 merge gated on chaos resolution | North-Star-asymptote | harness | not built |
| 3 sim↔prod delta <1% | North-Star-asymptote | harness | obligation IS the metric |
| 4 prod telemetry tunes simulation | North-Star-asymptote | harness | not built |
| *(substrate-crash-recovery sliver)* | directional-target | harness | v1-scoped; **chaos-FAIL = UNAUDITED until the v1 harness reproduces it** |

### tele-10 — Autopoietic Evolution  *(drift cell — structure shipped, automation North-Star)*
| SC | Class | Audit | Basis |
|---|---|---|---|
| 1 failed task auto-spawns Bug | North-Star-asymptote | substrate | manual today |
| 2 Report includes friction-reflection sections | shipped-MUST | artifact | template-required; binary — **the shipped structure** |
| 3 self-healing chain w/ single approval | North-Star-asymptote | substrate | manual today |
| 4 Concept registry accretes w/o manual triage | North-Star-asymptote | substrate | no Concept registry |

### tele-11 — Cognitive Minimalism
| SC | Class | Audit | Basis |
|---|---|---|---|
| 1 substrate primitive per recurring op | directional-target | substrate | many shipped; not exhaustive |
| 2 token telemetry; outliers surface | North-Star-asymptote | harness | obligation IS the metric; not instrumented |
| 3 no primitive-able work in prompts | directional-target | artifact | discipline |
| 4 cognitive-boundary documented per subsystem | directional-target | artifact | partial |
| 5 tier-migration = config-only | directional-target | harness | behavior in harness layer (unobservable at Hub snapshot) |
| 6 context dominated by cognitive content | directional-target | artifact | discipline |
| 7 workaround → primitive candidate within a cycle | directional-target | artifact | practiced, not mechanized |

### tele-12 — Precision Context Engineering  *(drift cell — scope-gap: obligation in the excluded adapter layer)*
| SC | Class | Audit | Basis |
|---|---|---|---|
| 1 explicit prompt size budget; overflow→compaction | directional-target | harness | compaction in harness; unobservable at Hub snapshot |
| 2 structured where data has shape | directional-target | artifact | discipline |
| 3 "Virtual Tokens Saved" observable | North-Star-asymptote | harness | obligation IS the metric; lives in excluded adapter layer |
| 4 attention-aware ordering | directional-target | artifact | discipline |
| 5 envelopes optimized at emission source | directional-target | substrate | partial |
| 6 per-subsystem context budget documented | North-Star-asymptote | artifact | not yet |
| 7 shape-changes go through token-cost review | directional-target | artifact | discipline |
| 8 precision measured; silent degradation = drift bug | North-Star-asymptote | harness | obligation IS the metric |

---

## 4. Summary distribution (post-verification)

| Class | Count | Reading |
|---|---|---|
| **shipped-MUST** | 14 | the conformance floor — 9 **substrate** (mechanically detectable) + 5 **artifact** (content-norm) |
| **directional-target** | 29 | the active climb — measured against the achieved bar |
| **North-Star-asymptote** | 17 | the perfection-ideal — FAILs are roadmap, not regression |
| *of which* **harness-audit** | 13 | excluded-layer / unobservable at the Hub snapshot → **UNAUDITED-at-ceiling**, never auto-flagged as drift |

The conformance floor is the **14 shipped-MUSTs**: the substrate guarantees (persistence, queryability, schema-locked topology, schema-isomorphism, air-gap composition, cascade-frictionlessness, error-isolation, adapter-resilience) plus the binary content-norms (template fidelity for zero-loss + autopoietic-reflection, boundary-review-detectability, hallucination-is-a-bug, umbrella-composition). Everything CDACC marks DISAGREE that maps to a North-Star or directional criterion is **distance-to-asymptote, correctly not flagged as a bug**.

---

## 5. Maintenance

- **Mutable + Director-ratified.** Unlike the teles, this overlay evolves. A `North-Star → directional → shipped-MUST` promotion is a deliberate, recorded act that **raises the conformance floor**.
- **CDACC consumes this overlay** as the FAIL-vs-drift oracle: it reads `(class, audit)` per criterion to pick the audit method and the FAIL disposition, and may *propose* reclassifications as a normative output (e.g., "tele-9 substrate-crash-recovery shipped → promote to shipped-MUST").
- **The shipped-MUST floor is gated on calibration state** (§2.2 invariant): an open calibration accepting a violation holds its criterion out of the floor.
- **Owner:** architect drafts; Director ratifies (class assignments set the conformance bar — a Director-level normative call). The teles themselves remain untouched.

---

*Run-1 of CDACC turned its hardest finding — the aspiration/obligation conflation — into a standing instrument: a conformance floor that the teles can stay perfect above. Verified sound for CDACC to consume, conditional on the three meta-annotations now folded in (audit-method, calibration-gating, the SC1/SC2 laundering guard).*
