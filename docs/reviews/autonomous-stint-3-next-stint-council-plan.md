# Autonomous Stint-3 — Next-Stint Prep Council Plan

**Status:** RATIFIED (next-stint-prep council output, convened at stint-3 close).
**FOCUS RATIFIED:** **Bank-the-Base** — observability + selection substrate. No outward-feature arc yet, per Director.
**Discharges:** the deferred-adversarial-council obligation (Open-Director-Decision #6; the standing "convene at a build-lull" action carried since the friction-trace).

This document persists the ratified council output durably. It contains the JUDGE's definitive plan verbatim, followed by the (B)-framework triangulation that fed it (Appendix). The council weighed four adversarial seats, the (B)-framework triangulation, and the stint-3 retrospective; the FOCUS ratified by the Director is the Seat-1 ∩ Seat-3 fusion (Bank-the-Base), with C2 named as the +1 summit and D-1 as the +2 summit, protected by the staking-decay term so the base is provably banked *toward* a stake rather than indefinitely.

Companion artifacts: `docs/reviews/autonomous-stint-3-retrospective.md`, `docs/reviews/autonomous-stint-arc-shortlist.md`.

---

# Stint-3 Next-Stint Council — JUDGE'S DEFINITIVE OUTPUT

*Council convened at stint-3 close (deferred-adversarial-council disposition per Open-Director-Decision #6, multi-seat intake discharged). Four adversarial seats, the (B)-framework triangulation, the stint-3 retrospective, and the (B) framing weighed. This is the ratification-ready output.*

**Verdict in one line:** Bank the observability + selection BASE this stint (the intersection of Seat-1 and Seat-3, with bug-195 as a cheap co-shipped ship-integrity rung); stake the outward control-plane (Seat-4 D-1) and unattended-runtime (Seat-2 C2) summits NEXT, in that order, on top of the now-banked base. The forward-investment score and SubstrateBanked rule do not merely *permit* this ordering — they *dictate* it.

---

## 1. ADVERSARIAL CROSS-EXAMINATION

The four seats are not four answers to one question. Under the (B) lens they resolve into a **base-vs-summit ordering dispute**, and the framework's own invariant (SubstrateBanked) settles it. I weigh each on three axes: forward-investment score (§3 of the triangulation), tele-alignment, and stint-3 fit.

### Seat-3 (Meta-Engine / Incorporation) — STRONGEST on the named constraint; partially WINS

**What it got right (decisive):** It correctly identifies the retro's own headline — *the binding constraint is incorporation, not generation* (14:1 gen:incorp, 248 open ideas, zero triage tags). It correctly names the **dominant friction CLASS** (acting on stale-or-assumed state) and attacks it at the substrate (reconciliation makes ground-truth standing) rather than incident-by-incident. Its DAG is clean under SubstrateBanked: banked base (364/C1/363/369) under a staked summit (370). idea-364 is the literal root of the enablement graph (score ~20, every selection edge rests on it).

**Where it is weak (refuted):** Its conceded weakness #4 is fatal *as a standalone pick* — "leaves the fire." F1 (CRITICAL, the single biggest drain) lives in the deploy spine; C1-widen only *reads* state, it does not *fix* the spine. A pure meta-engine stint reorders the menu while the kitchen burns. Its weakness #7 (thin deliverable — "a stint of docs + field-adds") is also real: bounded to concepts + entity-fields per idea-371, the *incorporation-tooling* half does not fill a stint on its own. **Refutation via the score:** the meta-engine's summit (idea-370) is circular (it ranks on the yardstick it builds) and its validation is slow (multi-stint, weak dogfood) — so the *summit* of Seat-3 cannot anchor the stint. But its *base* (idea-364 reconciliation, idea-363 triage, idea-369 report) carries the highest realizable forward scores in the set. **Resolution: adopt Seat-3's base, demote its summit to a banked-minimal field-set.**

### Seat-1 (C3 Ship-Integrity + Observability) — STRONGEST on the biggest drain; partially WINS

**What it got right (decisive):** The SubstrateBanked argument is the single most important structural claim in the council, and it is **correct**: every code-shipping forward edge currently rests on TWO bets — a churny/unconfirmable deploy spine and a controller blind to CI/deploy/WI state. idea-357 is the **keystone** — the highest in-degree node in the entire next-stint DAG (score ~30, tagged C1+C3+D-1 by its filer, plus D-3, idea-353, C4). Its bug-195 self-labels "the roll-signal rung" — the Bug→rung bridge already encoded in the org's own entities, which makes C3 the canonical *first customer* to calibrate the bridge against (genuine open addition #2). It directly kills F1 (CRITICAL) + drains D1/D2/D3.

**Where it is weak (refuted):** Its own conceded weaknesses #1 and #3 are honest and correct — C3 does *nothing* for incorporation (the co-equal binding constraint), and its marquee bug (bug-195, MINOR severity) plus the cognitive cost (cal #85, already filed zero-build) could be cleared in an afternoon. Weakness #5 is live: part of its own bundle (bug-107) may be a phantom that folds into bug-195 (Open-Director-Decision #5). Weakness #6 (idea-357 sizing balloon — the tele-7 emitAndPush sweep class warns this under-counts) is the genuine stint-sizing risk. **Refutation:** C3-as-the-whole-stint over-rotates on the *bugs* (cheap) and under-delivers on incorporation. **Resolution: adopt C3's idea-357 (keystone) + bug-195 (SubstrateBanked rung) + cal #85 — but FUSED with Seat-3's selection base, not as a standalone deploy-plumbing stint.**

**The Seat-1 ∩ Seat-3 fusion is the answer.** Both attack the same two named binding constraints (incorporation AND observability) at the **same DAG layer**: reconciliation (364) makes ground-truth *standing*, idea-357 makes the controller *see* it. They are not competitors — they are the two halves of the base.

### Seat-2 (C2 Agent-Lifecycle) — RIGHT summit, WRONG stint; CORRECTLY STAKED NEXT

**What it got right:** The compounding argument is genuine — C2 raises the autonomy *ceiling* (duration × agents × lineages), and every other arc's value is multiplied by that ceiling. It honestly distinguishes friction-rank from forward-rank (its weakness #1). FR-23 is the Director-emphasized headline friction, and #365 (shipped) already demonstrates the friction→rung bridge in anger.

**Where it is weak (refuted):** Its weakness #3 is disqualifying *for this stint*: the irreducible restart is a stdio code-swap that **cannot self-restart** — it needs an external, out-of-LLM supervisor that is partly infra/Director-gated. So C2's headline payoff is **MIXED, not banked** (FSM banked; supervisor staked + exogenous). Its weakness #2 is also correct: C2 adds runtime *capacity*, which can *widen* the incorporation funnel — amplifying the binding constraint, not relieving it. And it is build-heavy (L/XL vs the MEDIUM the org executes cleanly in ~9h). **Refutation:** C2 is a summit, not a base. Staking it before observability is banked means its lifecycle FSM telemetry would emit into a substrate the controller can't observe. **Resolution: C2 Survey/Design (work-37/#393, already prepped, banked) is grafted into this stint as the on-ramp; C2 *execution* is the immediate NEXT stint, on the banked base.**

### Seat-4 (Forward-Outward Vision Stake) — RIGHT diagnosis of the skew, WRONG remedy NOW; SubstrateBanked VIOLATED

**What it got right (and it is the most important thing any seat said):** The **dead-capital** argument. "The whole point of banking substrate is to enable a stake; refusing to ever stake makes the banked substrate dead capital." This is the true residual after the reframe (§3.1 below), and it is the one critique the other three seats cannot answer from inside their own theses. Seat-4 correctly identifies the topological trap: base-of-DAG work *always* out-scores leaves on in-degree, so a naive score tells the org to bank forever. It also correctly absorbs frictions via the bridge (FR-23→C2, idea-357→D-1, bug-195→ship-integrity).

**Where it is weak (refuted decisively by the framework's own rule):** Seat-4's weakness #2 is **self-refuting for this stint**: it stakes an outward, user-facing surface (D-1) onto a deploy substrate that *just bit the stint as the #1 CRITICAL friction*, banking only bug-195's minimal slice. **SubstrateBanked is VIOLATED** — a forward edge would rest on a known-cracked, unobservable base. The triangulation makes this concrete (§3.2): the outward stake draws forward edges on TWO un-banked substrates (deploy spine + observability). Seat-4's own weakness #4 concedes the "outward" stint can really only land *early rungs* (D-1 read, C2 L1/L2) — most of which is *itself more substrate*. So even the outward stake is mostly base-building, just on a cracked foundation. **Refutation:** the remedy for dead capital is not "stake outward onto a cracked base now" — it is the **staking-obligation decay term** (§4.3), which forces the stake NEXT stint, *after* the base is banked THIS stint. **Resolution: reject the outward stake this stint; ADOPT Seat-4's dead-capital insight as the framework's decay term + commit D-1 as the named next-after-base summit.**

### Cross-examination summary

| Seat | Forward-score verdict | tele fit | stint-3 fit | Disposition |
|---|---|---|---|---|
| **Seat-3 base** (364/C1/363/369) | HIGHEST realizable (root + selection) | tele-3/tele-13 | hits F2/F10/F8 | **WIN — base, this stint** |
| **Seat-1 keystone** (357/bug-195/cal#85) | HIGHEST single node (357 ~30) | tele-7/tele-13 | hits F1/D1-3 | **WIN — base, this stint (fused)** |
| **Seat-2** (C2) | high but MIXED+exogenous | tele-13 north-star | hits F11 | **Summit — Survey now, execute NEXT** |
| **Seat-4** (D-1/C4 outward) | high potential, **SubstrateBanked violated** | tele-0 (the gap) | corrects skew | **Summit — staked NEXT-after-C2; decay term adopted** |

---

## 2. THE FORWARD-INVESTMENT-RANKED NEXT-STINT PLAN

### 2.1 Recommended FOCUS: **"Bank the Base" — Ground-Truth Observability + Selection Substrate**

The next-stint FOCUS is the **Seat-1 ∩ Seat-3 fusion**: convert the org's two named binding constraints — incorporation and observability — from un-banked bets into shipped+banked substrate, in ONE DAG layer, with the cheap ship-integrity rung co-shipped to satisfy SubstrateBanked.

- **Recommended FOCUS:** Bank-the-Base (observability + selection substrate).
- **Runner-up:** Seat-1 standalone (C3 ship-integrity spine) — but it leaves incorporation untouched, so it is grafted-in, not chosen alone.
- **Grafted from other seats:** Seat-2's C2 Survey/Design on-ramp (banked, already Director-ready); Seat-4's dead-capital → staking-decay term (adopted into the framework, §3); Seat-4's D-1 commitment as the *named* next-after-base summit (so the base is provably being banked *for* a stake, not indefinitely).

### 2.2 The plan as STAKED-vs-BANKED rungs

**BANKED base rungs (this stint — no-regret, cash on their own):**

| Rung | Source seat | Score | Why it banks |
|---|---|---|---|
| **idea-364 reconciliation-verb** | Seat-3 | ~20 (ROOT) | deletes ~52% stale-candidates *before* waste (F2); doubles as seed-gen; every selection edge rests on it |
| **idea-357 list_work + push-events (parts 1–3)** | Seat-1 | ~30 (KEYSTONE) | controller reads ground-truth CI/deploy/WI state; kills F1 root + D3; closes bug-181 (F12) |
| **bug-195 deploy roll-confirm + concurrency-cancel** | Seat-1 | ~12 | SubstrateBanked enforcement — the ship-integrity rung every code arc rests on; kills D1 |
| **idea-363 funnel-triage + backlog-health metric** | Seat-3 | ~8 | triage tags + keep-vs-CUT partition over 248 (F10); precondition for the score |
| **idea-369 stint-report-schema (+368 close-packet)** | Seat-3 | ~12 | mechanizes *this very artifact*; the persistence home for score+deferrals (anti-amnesia, F8) |
| **cal #85 generalize (ground-truth-over-assumption, 4-surface)** | Seat-1 | (discipline) | zero-build cognitive guard that makes the ground-truth signals get *used* |
| **bug-185 durable park-state** | Seat-1/Seat-2 | (D2) | the built-but-blocked phase; ends lease-churn; completes the ship-integrity loop |

**MIXED rung (banked half this stint, staked half carried):**

| Rung | Banked half (now) | Staked half (carried) |
|---|---|---|
| **idea-370 forward-investment framework** | payoff/cashesInto/enables fields + hand-computed score-tag + revivalTrigger discipline (§3) | the score's *ranking value* stakes on future stints selecting against it |
| **idea-367 generative-telemetry** | instrumentation over the 14 loops, gen:incorp dashboard | the tele-RANKING half stakes on triaged backlog + score |

**STAKED summits (NOT this stint — named, sequenced, decay-protected):**

| Summit | When | Gate |
|---|---|---|
| **C2 Survey/Design** (work-37/#393) | grafted INTO this stint (banked artifact) | Director picks (6) already prepped |
| **C2 execution** (lifecycle FSM → supervisor) | **NEXT stint (+1)** | on the banked observability base |
| **D-1 R1 REST read-binding** (the outward "k8s" half) | **NEXT-after-C2 (+2)** | SubstrateBanked now satisfied (357 banked, deploy spine confirmable) |
| **C4 governed-autonomy / idea-371 engine** | banked-with-trigger | revivalTrigger: concepts proven over ≥3 stints |

### 2.3 WHY — by forward-investment, tele-alignment, stint-3 fit

- **Forward-investment (the scaffolding/option value):** The base rungs carry the *highest realizable* scores (§3 table) precisely because base-of-DAG nodes have the highest in-degree — idea-357 (~30) and idea-364 (~20) are the two highest-scoring *buildable* nodes in the set. SubstrateBanked (§3.2) makes this not a preference but a **rule**: D-1/C2 may not legally stake forward edges until observability + ship-integrity are shipped+banked. The plan banks exactly those, then immediately stakes the summits they unblock — converting banked capital into summit value within two stints (answering Seat-4's dead-capital warning).
- **tele-alignment:** hits tele-13 (kills the moot-CRITICAL-gate class via push-events; relieves Director-attention tax), tele-7/tele-8 (idea-357 push-events close the silent-failure observability surface; reconciliation is fix-the-class), tele-3 (reconciliation closes ledger drift). It also *opens* the tele-0 gap deliberately: by naming D-1 as the +2 summit, the base is banked *toward* the vision, not as inward dead-end.
- **stint-3 fit:** directly kills F1 (CRITICAL), F2 (HIGH, cheapest), F10 (incorporation namesake), F8 (highest loss-risk), F12, and drains D1/D2/D3 — the highest-ranked frictions of the stint, at their *substrate* not incident-by-incident.

### 2.4 The generation-skew — addressed explicitly

The plan **deliberately does NOT fully correct the inward/self-maintenance bias this stint — and that is the correct call, with one structural commitment to guarantee correction next.**

Two parts, both load-bearing (per triangulation §4.3):

1. **The skew is partly a MEASUREMENT ARTIFACT, now dissolved.** The reframe (§3.1) shows that scoring by in-degree × downstream value reveals that *corrective/structural base work carries the HIGHEST forward-investment scores*. The skew critique conflated "corrective" with "low forward value." bug-195 ("the roll-signal rung"), FR-23→#365, and idea-364 are not low-value hardening — they are the base the summits rest on. Re-stated honestly: it was never "too much corrective work," it was "corrective work was invisible to ranking because no bridge existed." Build the bridge (§3) → much of the apparent skew evaporates.

2. **The TRUE residual skew (~zero summits *staked*) is corrected by COMMITMENT, not by staking onto a cracked base now.** Seat-4 is right that banking forever = dead capital. The cure is the **staking-obligation / summit-liveness decay term** (§3, addition #4): a banked rung whose intended summit stays dormant for N stints has its forward-investment score *decay* — forcing the stake. We bank the base THIS stint and **name D-1 (the literal outward "k8s" half) as the +2 summit and C2 as the +1 summit**, so the base is provably being banked *for* a stake within two stints. This corrects the skew structurally (the decay term makes indefinite banking impossible) while honoring SubstrateBanked (no forward edge on a bet) — rather than rushing an outward surface onto the exact deploy spine that just produced the stint's #1 CRITICAL friction.

---

## 3. THE GROUNDED (B) FRAMEWORK — adopt NOW

**Resolve the semantic clash FIRST (highest-value, zero-cost correction).** idea-370 currently reads `staked/banked` as a *commitment* axis (resourced vs option-held). The Director's shipped arc-core reads `payoff` as a *value-contingency* axis (no-regret vs bet). These are different axes, and the graph calculations (SubstrateBanked, park/cut cascade) key off value-contingency. **Adopt arc's semantics:** `banked = no-regret (cashes regardless)`, `staked = bet (only cashes via a summit)`, `mixed = both`. idea-370's "option-held / not-yet-built" maps onto the **lifecycle axis** (`candidate`), NOT the payoff axis. The field doc pins this.

### 3.1 The reframe (the council's design energy, addition #2 realized)

When you score by in-degree × downstream-summit-value, **corrective/structural base rungs out-score outward feature leaves** — because base-of-DAG nodes have higher in-degree by topology. This is the Bug/Idea/Friction→rung **bridge** in action: a friction (FR-23→#365), a corrective bug (bug-195, self-labeled "the roll-signal rung"), and a reconciliation verb earn forward scores by *being* base rungs. The skew critique is therefore partly **dissolved** by the score itself.

### 3.2 The SubstrateBanked finding (the decisive structural result)

*A forward/buildsOn edge may rest ONLY on shipped+banked substrate, never a bet.* Today the outward stake (D-1/C4) would rest on two un-banked substrates: the deploy spine (F1, just bit us) and observability (idea-357 unbuilt). **SubstrateBanked is therefore VIOLATED by staking outward now.** The rule — already shipped in arc-core — *orders the program*: bank observability + ship-integrity this stint, stake outward next. This is not a judgment call; it is the invariant the Director already owns.

### 3.3 BUILD NOW — minimal native expression on existing Hub entities (NO engine)

1. **Two fields on Idea/Mission/Bug:** `payoff` (banked/staked/mixed, value-contingency reading) + `cashesInto` (summit/arc tag). Field doc pins arc's semantics (resolves §0 clash).
2. **`enables` / `forwardEdges`** (list-of-IDs) — the Bug/Idea/Friction→rung **bridge**; the minimal expression that lets corrective work accrue in-degree.
3. **`revivalTrigger` + `rationale` REQUIRED on every deferral** — anti-amnesia as physics, enforced as a filing discipline now (matches arc's schema `allOf`).
4. **Forward-investment SCORE as a hand-computed tag** at stint-open, recorded in the stint-report — architect-computed in-degree × summit-value, *not* auto-derived. **Keep the rank a gated judgment — the score informs, never auto-ranks** (arc's "judgment the model can't encode" boundary; bounds the circularity all four seats flagged).
5. **Stint-report schema (idea-369)** carries: MIX-by-nature, gen:incorp, tele-coverage gaps, banked-rung inventory, staked/banked balance, the score-ranked next-stint menu — reusing arc's delta-ledger `kind` vocab `[create/ship/park/revive/retire/...]` for per-item disposition.

### 3.4 The two open additions — RESOLVED

**Addition #1 — the numeric forward-investment SCORE + its place in tele-ranking.** RESOLVED: `score = in-degree over enablement edges (dependsOn/cashesInto/buildsOn/reCashes) × downstream-summit-value (1–5)`, hand-computed at stint-open, recorded as a field, **advisory to a gated rank** (never auto-ranks). Place in tele-ranking: the score is a *tie-breaker and a base-surfacer* — it surfaces SubstrateBanked base fixes that feature-shaped ideas would otherwise out-rank; the tele-mapping remains the primary axis, the score the second.

**Addition #2 — the Bug/Idea/Friction→rung enablement BRIDGE.** RESOLVED: the `enables`/`cashesInto` fields let a Bug/Friction draw a forward edge into an arc rung, so corrective/structural work earns a forward score. bug-195, FR-23, idea-357 are the first-customers. This is what dissolves the skew-as-measurement-artifact (§3.1) and partially relieves the F10 funnel (structural fixes stop losing to cheap corrective work in the ranking).

### 3.5 Four autonomous-stint-native refinements the application surfaced (adopt)

1. **`dogfoodProves` / `validatedBy` edge** — the org is its own first customer (work-19 validated live at leaseExpiryCount=2). An edge from a shipped rung to the stint that exercised it *upgrades confidence in its banked status*. arc has no analog (drawv2 isn't self-dogfooding).
2. **Observability multiplier on summit-value** — a banked rung you cannot *observe* is effectively a bet. Rungs converting assumed-state→ground-truth (357, C1-widen, 364, telemetry) get a multiplier: they raise the reliability of *every other rung's* banked status. This is why idea-357 tops the table and why observability is co-equal with incorporation.
3. **Director-attention term (tele-13, negative-edge)** — items that *reduce Director-gating in-degree* (C2/FR-23, governance relaxation) earn forward-investment via attention-saved. arc has no human-attention budget; the autonomous org does.
4. **Staking-obligation / summit-liveness decay** (Seat-4's dead-capital insight, made physics) — banked base substrate that no summit stakes within N stints is dead capital; its score must **decay**. The dual of SubstrateBanked: bank the base, but re-price it down when its intended summit stays dormant. This is the structural cure for the generation-skew.

### 3.6 The now-vs-banked line (per idea-371)

- **BANK (do NOT build — idea-371):** the mechanized arc-engine — auto-`traverse`/score computation, automated park/cut cascade, generated `project/hydrate` rollups, `@apnex/arc-core` as an org tenant. **revivalTrigger:** "forward-investment concepts proven over ≥3 stints" OR "a stint demonstrably mis-ranked despite the manual score."
- **BUILD NOW:** §3.3 items 1–5 only — concepts + native fields + hand-computed score + stint-report schema. No new engine.

---

## 4. STINT-3 STINT-REPORT (first instance of the idea-369 schema)

*Hand-assembled from the retro corpus; this IS the schema's first population.*

### 4.1 Generation MIX by nature

| Nature | Ideas | Bugs | Cal | Share |
|---|---|---|---|---|
| **CORRECTIVE** | 359, 360, 362 | 187–195, 107, 180–184/186 (~18) | #85,#87,#88 | **~40%** |
| **INWARD-ENGINE** | 353,354,355,356,358,361,363,364,365,366,368,369,370,371 | 185 | #86,#89 | **~45%** |
| **OBSERVABILITY** | 349, 357, 367, 353(partial) | 190, 195 | — | **~13%** |
| **FORWARD-FEATURE (outward)** | **0** | 0 | 0 | **~0–2%** |

**Headline:** ~85% corrective+inward-engine, ~13% observability, **~0% outward-feature.** The one incorporated idea (355→mission-95) was itself inward.

### 4.2 Tele-coverage + GAPS

| Tele cluster | Density | Evidence |
|---|---|---|
| tele-7 (silent-failure) | HIGH | idea-362; bug-190/191/192/193/194 |
| tele-8 (fix-the-class) | HIGH | cal #88; bug-194 sweep |
| tele-13 (amplify Director attention) | HIGH | moot CRITICAL gate (F1); G11; FR-23 (F11) |
| tele-3 (close divergence) | MEDIUM | idea-355 misframe; reconciliation (F2) |
| **tele-0 (vision/summit-progress)** | **GAP — flagged stale** | no outward-summit progress |
| **outward/product teles** | **GAP — ~zero** | no net-new outward arc |

*The coverage gap IS the generation skew read through teles: densely instrumenting the engine, structurally silent on the destination. (Exact tele-N labels to confirm against `docs/methodology/tele-glossary.md`.)*

### 4.3 Generation : incorporation

- **14 in-window : 1 incorporated = 14:1**; with the 9 close-distilled engine-v2 ideas, **23 : 1**.
- 248 open ideas; oldest "ready" ~2.5 months; zero triage tags on the cohort.
- **Binding constraint, co-equal with observability.**

### 4.4 Banked-rung inventory + staked/banked balance

- **Shipped+banked this stint:** ~35 PRs, ~20 bugs (0 regressions), mission-95, #365 (FR-23 partial), work-19 backstop (validated live, leaseExpiryCount=2). Pure no-regret hardening.
- **Banked-not-filed (loss-risk):** cal #89, #80-sort, #79/#82-recurrence (F8 — file now).
- **Staked summits advanced:** ~0 (the skew, restated as balance).
- **Balance verdict:** textbook BANKED stint — high no-regret cash, near-zero forward-summit in-degree created. Per §3.5(4) the staking-decay clock now starts: the next stint must bank-the-base, the +1/+2 must stake.

### 4.5 dogfood-proves edges (autonomous-native)

- work-19 driver-anchor ← `dogfoodProves` ← stint-3 (leaseExpiryCount=2, live).
- idea-353 claimable-digest ← `dogfoodProves` ← stint-3 (queue self-woke both lineages, 0 pings).
- C1-widen ← stint-3 build-loop = the 3rd dogfood (Open-Director-Decision #1 now satisfiable).

---

## 5. SEED RECOMMENDATIONS

### 5.1 Operating-model-v2 deltas to bake in

1. **Reconciliation = MANDATORY stint-open pre-flight gate** (before strategic-review/seeding) — op-model §7. Zero-build; deleted ~52% wasted seed-candidates this stint *after* the fact (F2).
2. **NO-MANUAL-PINGS + NO-AGENT-IDLE invariants** — codify (P1/P3); queue self-wake is the substrate.
3. **work-19 driver-anchor + lease-expiry backstop = §0 keystone**; pulse-free default (P12 — lease-expiry IS the stall-detector).
4. **Verifier-gate MANDATORY + generative** on every Hub/backplane/deploy-gating slice + mutation-verify the critical invariant's own test (P4/P11).
5. **CI-gated merge-train / Vehicle-C / pivot-not-pause / held-time-verify** as reusable primitives (P6/P8/P9/P10).
6. **Standing post-stint Idea Triage + backlog-health metric** (F10) — close the funnel.
7. **The (B) framework §3.3 fields + score-tag + stint-report schema** — bake the forward-investment discipline into stint-open and stint-close.
8. **Ground-truth-over-assumption as a hard axiom** across sizing/seeding/audit-promotion/deploy-diagnosis (cal #85 generalize, 4-surface) + **fix-the-class-not-the-instance** (tele-8, cal #88 corollary).
9. **Mid-stint-pivot discipline:** surface + disposition ALL in-flight work at any new-focus framing (F5) → mission-lifecycle.md.

### 5.2 Next work-19 anchor's engine config

- **FOCUS payload:** "Bank-the-Base — observability + selection substrate" (§2.1).
- **Banked rungs seeded ready:** idea-364, idea-357 (sequence list_work part-3 FIRST as the cheap MCP cash, then push-events parts 1–2), bug-195, idea-363, idea-369/368, bug-185; cal #85-generalize as a discipline overlay.
- **Sizing guard:** idea-357 is the sizing risk (tele-7 emitAndPush sweep class under-counts via symbol-scoped grep). Apply greg's claim-time path-enumeration + blast-radius grep (cal #88 corollary) BEFORE committing the slice estimate. Target MEDIUM (the ~9h sweet spot); if idea-357 push-events balloon to L, ship list_work + bug-195 + reconciliation as the banked core and carry push-events to a clean slice.
- **Dogfood:** the stint itself is the 4th dogfood; wire `dogfoodProves` edges as rungs ship.
- **Verifier:** front-load FR-32 (real-substrate testcontainer image: copy-from-template `write-encoder-and-watch-w4.test.ts`; pre-warn 57P01 teardown flake; confirm docker on steve's seat) so the observability slices get fast+faithful adversarial rounds.
- **Graft:** C2 Survey/Design (work-37/#393) runs in build-slack as the +1 on-ramp.

### 5.3 Staged Director-decisions (for ratification)

1. **Ratify the FOCUS:** Bank-the-Base (Seat-1 ∩ Seat-3 fusion), with D-1 named as the +2 summit and C2 as the +1 summit (corrects the skew structurally via the decay term).
2. **Ratify the (B) semantic resolution:** payoff = value-contingency (arc-core), lifecycle = commitment; idea-370 field doc to pin it.
3. **Ratify BUILD-NOW vs BANK line** (§3.6): fields + score-tag + report-schema now; idea-371 engine banked with revivalTrigger.
4. **Resolve Open-Director-Decision #5 (bug-107):** confirm whether it folds into bug-195 (collapses one C3 rung) or stands as a latent reliability fix. *Council recommendation: fold-pending-evidence — treat bug-195 gate-widening as primary; keep bug-107 as a banked-conditional reliability floor, file its revivalTrigger.*
5. **C1-widen go/no-go (Open-Decision #1):** 3 dogfoods now proven (incl. this stint's build-loop) — *council recommendation: GO; it is a banked base rung.*
6. **C2 Survey (Open-Decision #2):** proceed with the 6-pick survey in build-slack (+1 on-ramp).
7. **Calibration loss-obligation (F8 / FR-34):** file the 3 banked-not-filed cals (#89/#80/#79) + normalize #60/#62 before stint-open (highest loss-risk surface).
8. **Standing obligations to clear:** CDACC run-672bd0f drift-map + the owed PING-DIRECTOR (Open-Decision #8); tele-0 staleness (still says 1-10) into vision-synthesis.

---

*JUDGE's bottom line: the framework the Director already shipped (arc-core's SubstrateBanked + payoff axis) settles the council from inside. Bank observability + ship-integrity + selection THIS stint (the highest-scoring base rungs, killing the #1 CRITICAL friction and the co-equal incorporation constraint together); stake unattended-runtime (C2, +1) then the sovereign control-plane (D-1, +2) onto the now-banked base — with the staking-decay term making indefinite banking impossible, which is the real, structural cure for the generation-skew Seat-4 correctly diagnosed.*

---

## Appendix: (B)-framework triangulation

*The forward-investment triangulation that fed the JUDGE plan above — the (B)-framework applied to the actual stint-3 corpus, with the framework refined by fit.*

# (B)-Framework Triangulation — Stint-3 Next-Stint Council

**Method note.** I applied the (B) forward-investment framework to the actual stint-3 corpus (retro §By-the-numbers, F1–F12, the 14 generative loops, the 23 generated ideas, ~20 bugs) and to the candidate set, then let the *fit* refine the framework. One thing must be settled before any score is trusted, so I state it up front.

**The one semantic clash (resolve before adopting, per the arc synthesis).** idea-370 currently reads `staked = committed/resourced`, `banked = specified, option-held, low-carrying-cost` — a **commitment axis**. The Director's own shipped arc-core reads `payoff` as a **value-contingency axis**: `banked = no-regret (value cashes regardless)`, `staked = a bet (only cashes via a dependent/summit)`. These are **not the same axis**, and the graph calculations (SubstrateBanked, the park/cut cascade) key off the *value-contingency* reading. **My triangulation adopts arc's semantics** — banked = no-regret, staked = bet — and maps idea-370's "option-held / not-yet-built" onto the **lifecycle axis** (`candidate`), not the payoff axis. Every score below uses that resolved reading. (This is the highest-value correction the council can carry in; it costs nothing and prevents the cascade logic from breaking.)

---

## 1. STINT-REPORT (idea-369) — the measured generation mix

This is stint-3's first stint-report, hand-assembled from the retro corpus.

### 1.1 Generation MIX by nature

Classifying the generated cohort (23 ideas: 349–362 filed in-window + 363–371 distilled at close; ~10 bugs filed 185/187–195; ~20 bugs resolved; 4+3 calibrations) by the four natures:

| Nature | Ideas | Bugs | Cal | Approx share of generation |
|---|---|---|---|---|
| **CORRECTIVE** (fix/harden existing) | 359, 360, 362 | 187–195, 107, 180–184/186 (~18) | #85,#87,#88 | **~40%** |
| **INWARD-ENGINE** (self-improvement / coordination / incorporation machinery) | 353, 354, 355, 356, 358, 361, **363, 364, 365, 366, 368, 369, 370, 371** | 185 (queue-semantics) | #86,#89 | **~45%** |
| **OBSERVABILITY** (ground-truth surfacing / instrumentation) | 349, 357, **367**, 353(partial) | 190, 195 (observability tinge) | — | **~13%** |
| **FORWARD-FEATURE** (net-new OUTWARD / user-facing) | **0** (C4/D-1 are *carried* candidates, not generated this stint) | 0 | 0 | **~0–2%** |

**Headline reading:** generation is **~85% corrective + inward-engine, ~13% observability, ~0% outward-feature.** Every architect/engineer/verifier seat agrees on this skew; the only disagreement is whether it is a deficiency (seat-4) or correct safety-before-leverage sequencing (seat-4's own conceded weakness #5). The *one* incorporated idea of the window (idea-355 → mission-95) was itself **inward** (adapter-substrate consolidation).

### 1.2 Tele-distribution + COVERAGE GAPS

The generation concentrates on the **engine-integrity / coordination teles** and is **structurally absent on the outward-destination teles**:

| Tele cluster | Density this stint | Evidence |
|---|---|---|
| **tele-7** (silent-failure class) | HIGH | F4 whole class; idea-362, bug-190/191/192/193/194 |
| **tele-8** (fix-the-class-not-the-instance) | HIGH | cal #88 corollary; bug-194 emitAndPush sweep; the re-emergence finding |
| **tele-13** (amplify, don't gate, Director attention) | HIGH | moot CRITICAL gate (F1); governance relaxation (G11); FR-23 operator-bottleneck (F11) |
| **tele-3** (close divergence / drift) | MEDIUM | idea-355 fork-misframe; ledger reconciliation (F2) |
| **tele-0** (vision / progress-toward-summit) | **GAP — flagged stale (still says 1–10)** | no outward-summit progress; vision-synthesis tele-0 staleness open |
| **outward / product-value teles** | **GAP — ~zero coverage** | no net-new outward arc generated |

**The coverage gap IS the generation skew, read through teles:** the org is densely instrumenting its own engine (tele-7/8/13) and structurally silent on its destination (tele-0 + outward teles). (Exact tele-N labels should be confirmed against `docs/methodology/tele-glossary.md` — I anchored only the teles the retro itself names.)

### 1.3 Generation : incorporation ratio

- **14 ideas generated in-window : 1 incorporated (idea-355)** = **14:1** (retro headline).
- Counting the 9 close-distilled engine-v2 ideas, **23 generated : 1 incorporated** = **~23:1** for the full window.
- **248 open ideas**; oldest "ready" ~2.5 months; **zero triage tags** on the stint cohort.
- **This is the binding constraint, co-equal with observability** (retro: "the bottleneck is INCORPORATION, not generation"). The org can find, build, and ship; it cannot reliably **select**.

---

## 2. ENABLEMENT-DAG — banked/staked rungs + edges

Built over the candidate set + engine-v2 ideas + the load-bearing bugs/frictions. Payoff per the resolved (value-contingency) semantics.

### 2.1 Summits (downstream value sinks)

- **S-Selection-Quality** — every future stint's menu (engine-v2). *Value: compounds across all stints.*
- **S-Org-Observability** — controller reads ground truth (C1-widen + D-3 + idea-357). *Value: de-risks the whole DAG.*
- **S-Ship-Integrity** — reliable, confirmable, observable deploy (C3). *Value: base under every code-shipping arc.*
- **S-Unattended-Runtime / Cognitive-Continuity** — autonomy ceiling (C2). *Value: multiplies every arc's reach by duration×agents×lineages.*
- **S-Sovereign-Control-Plane** — Hub=apiserver / oisctl=kubectl (D-1). *Value: the "k8s" half of the vision; maximal in-degree among outward arcs.*
- **S-Governed-Autonomy** (C4). *Value: the largest outward summit; staked on all of the above.*

### 2.2 Base-of-DAG BANKED rungs (shipped or cheap, no-regret) — the scaffolding

| Rung | Payoff | Why base | Cashes into |
|---|---|---|---|
| **idea-364 reconciliation-verb** | banked | deletes ~52% stale-candidates *before* waste; doubles as seed-gen | every triage/score/telemetry/seeding edge |
| **C1-widen / org-state-read** | banked | honest claimable/org-state read; controller ground-truth | telemetry, score, D-1 read-binding, dogfood |
| **idea-357 part-3 list_work** | banked | ships early via MCP; org-state snapshot now | D-1 read-binding, C1 dogfood |
| **idea-363 funnel-triage** | banked | triage tags + backlog-health; keep-vs-cut partition over 248 | precondition for the score |
| **idea-369 stint-report + 368 close-packet** | banked | mechanizes *this very artifact*; persistence home | anti-amnesia for score + deferrals |
| **bug-195 deploy roll-confirm + concurrency-cancel** | banked | removes per-PR roll churn + false roll-confirm | merge-train P6, C2 deploy, all code-shipping arcs |
| **cal #85 ground-truth-the-deploy-state** | banked | zero-build cognitive guard; makes signals get *used* | every generative loop |
| **bug-185 durable park-state** | banked | built-but-blocked phase; ends lease-churn | C1 queue-semantics; ship-integrity loop |
| **#365 update-claude-plugin.sh** | **shipped/banked** | partial FR-23 fix — *the Bug→rung bridge already in anger* | C2 lifecycle scaffolding |

### 2.3 MIXED rungs (banked base + staked summit)

- **idea-357 parts 1–2 push-events** — *banked half:* kills the controller blind-spot now; *staked half:* the event vocabulary D-1/D-3/C4 cash into.
- **idea-367 generative-telemetry** — instrument banked; tele-RANKING staked on triaged backlog + score.
- **C2 lifecycle FSM** — FSM banked (legibility); external supervisor staked + **exogenous** (stdio code-swap can't self-restart; needs an out-of-LLM supervisor — seat-2 conceded #3).
- **idea-370 forward-investment framework** — concepts + native fields bank now; the score's *ranking value* stakes on future stints selecting against it.

### 2.4 STAKED rungs (bets — only cash via a summit)

- **D-1 R1 REST read-binding** — maximal outward in-degree, but a pure bet on the org continuing outward.
- **C2 supervisor / self-restart** — cashes per-restart but carries the infra/Director-gate dependency.
- **C4 governed-autonomy** — top outward summit; stakes on C1+C2+C3+D-1.
- **idea-371 arc-mechanization** — **banked-with-trigger; deliberately OUT of scope** (boundary marker).

### 2.5 The DAG (forward edges flow upward)

```
        S-Governed-Autonomy (C4)              ← staked on everything
                  │
     ┌────────────┼─────────────┐
 S-Control-Plane  S-Unattended  S-Selection-Quality
   (D-1) staked    (C2) mixed     (engine-v2) ── idea-370 [SUMMIT, mixed]
     │               │                  │
  idea-357 push ─────┤            idea-367 telemetry [mixed]
   [MIXED, keystone] │                  │
     │               │            idea-363 triage · 369 report  [banked]
  ┌──┴───────────────┴──────────────────┴──┐
  │  S-Org-Observability    S-Ship-Integrity │
  │   C1-widen [banked]      bug-195 [banked] │
  │   357 list_work [banked] bug-107/185 [bk] │
  │   idea-364 reconciliation [banked, ROOT]  │  ← cal #85 discipline overlays all
  └───────────────────────────────────────────┘
              BASE-OF-DAG (banked substrate)
```

**idea-364 is the literal root** (every selection edge rests on accurate ledger state). **idea-357 is the keystone** (highest in-degree node: tagged C1+C3+D-1 by its filer, plus D-3, idea-353, C4).

---

## 3. FORWARD-INVESTMENT SCORES — and the reframe

Score = **in-degree over enablement edges (dependsOn/cashesInto/buildsOn/reCashes) × downstream summit value.** Hand-computed (in-degree = distinct downstream rungs/arcs drawing a forward edge; summit-value 1–5).

| Item | payoff | in-deg | summit-val | **score** | nature |
|---|---|---|---|---|---|
| **idea-357 (push-events + list_work)** | mixed | **6** (C1,C3,D-1,D-3,353,C4) | 5 | **~30 — HIGHEST** | OBSERVABILITY |
| **idea-364 reconciliation-verb** | banked | 5 (363,370,367,seed,strat-review) | 4 | **~20** | INWARD/corrective |
| **C2 lifecycle FSM** | mixed | 5 (D-1,D-3,self-restart,self-heal,FR-cluster) | 5 | **~25** | INWARD-ENGINE |
| **C1-widen / org-state-read** | banked | 4 (367,370,D-1,dogfood) | 4 | **~16** | OBSERVABILITY |
| **bug-195 deploy roll-confirm** | banked | 4 (P6,C2-deploy,C3,all-ship) | 3 | **~12** | CORRECTIVE |
| **idea-369 stint-report** | banked | 3 (score-persist,deferral,anti-amnesia) | 4 | **~12** | INWARD-ENGINE |
| **idea-363 funnel-triage** | banked | 2 (370,backlog-health) | 4 | **~8** | INWARD-ENGINE |
| **D-1 R1 REST read-binding** | **staked** | 4 (C1,C2,C3,C4 expose-through) | 5 | **~20 (potential)** | FORWARD/outward |
| **idea-370 score framework** | mixed | low (it *is* the yardstick) | 5 | **circular — see §4** | INWARD-ENGINE |

### 3.1 THE REFRAME (the council's design energy, genuine open addition #2)

**When you score by in-degree × downstream value, the CORRECTIVE/structural base rungs outscore the outward feature leaves.** idea-357 (observability), idea-364 (reconciliation), C1-widen, bug-195 (a **MINOR-severity** bug) all carry higher *realizable* forward-investment than D-1's outward summit — **because base-of-DAG nodes have higher in-degree by topology.** This is the Bug/Idea/Friction→rung **bridge** in action: a friction (FR-23→#365), a corrective bug (bug-195 — *its own title labels it "the roll-signal rung"*), and a reconciliation verb earn forward scores precisely by being base rungs. **The skew critique ("we only do corrective/inward work") is therefore partly DISSOLVED by the score: the corrective base IS the forward investment** — exactly what idea-370's bridge exists to make legible.

### 3.2 The SubstrateBanked finding (decisive against staking outward now)

SubstrateBanked: *a forward/buildsOn edge may rest ONLY on shipped+banked substrate, never a bet.* Today the outward stake (seat-4: D-1 + C4) would draw forward edges on **two un-banked substrates**:
1. the **deploy spine** — which *just bit the stint as the #1 CRITICAL friction* (F1 phantom; bug-195 unfixed) — a known-cracked base;
2. the **observability substrate** — idea-357 unbuilt, so the controller is still blind.

**So SubstrateBanked is VIOLATED by staking D-1/C4 this stint** (seat-4 honestly concedes this, weakness #2). The framework's own invariant orders the work: **bank observability + ship-integrity first, then stake outward.** This is the single most decisive structural result of the application — it is not a preference, it is the rule the Director already shipped in arc-core.

---

## 4. REFINING (B) BY FIT — autonomous-stint specifics

### 4.1 Does the payoff axis hold for autonomous stints?

**Yes — once the semantic clash (§0) is resolved to value-contingency.** The autonomous stint actually *stress-tests* the axis well: stint-3's banked rungs (the ~20 bug-fixes, 0 regressions) cashed on their own (textbook no-regret); the staked rungs (D-1/C4) are inert until a summit arrives. The axis holds. But the application surfaces **a structural bias the arc model doesn't warn about**: because base nodes have higher in-degree, **the score systematically favors banked base over staked summits** — left unchecked it would tell the org to *bank forever and never stake*, producing exactly stint-3's ~0% outward generation. The payoff axis needs a counter-term (§4.3).

### 4.2 Autonomous-stint-specific edge-types + scoring factors

Three additions the autonomous context demands beyond arc's edge set:

1. **`dogfoodProves` / `validatedBy` edge (autonomous-stint-native).** The org is its own first customer (loop G5; stint-as-3rd-dogfood; work-19 backstop validated *live* at leaseExpiryCount=2). An edge from a shipped rung to the stint that exercised it **upgrades confidence in its banked status**. arc has no such edge because drawv2 isn't self-dogfooding. This is a genuine new edge-type for the org's tenant.

2. **Observability multiplier on summit-value.** The dominant friction class is *acting on stale/assumed state* (52% stale ledger, phantom watchtower, design-from-assumption). **A banked rung you cannot observe is effectively a bet** — its "no-regret" claim is unverifiable. So rungs that convert assumed-state→ground-truth (idea-357, C1-widen, idea-364, telemetry) deserve a **multiplier**: they raise the *reliability of every other rung's banked status*. Observability is meta-substrate. This is why idea-357 tops the table and why "observability" is co-equal with "incorporation" as the binding constraint.

3. **Director-attention term (tele-13 keyed, negative-edge).** The scarcest resource is Director attention; the stint burned a **moot CRITICAL gate**. Items that *reduce Director-gating in-degree* (C2 operator-bottleneck/FR-23, governance relaxation) earn forward-investment via attention-saved. arc has no analog because it has no human-attention budget; the autonomous org does.

### 4.3 Handling the corrective-vs-forward skew

Two parts, both load-bearing:

- **Part dissolved (the reframe, §3.1):** the skew critique conflates "corrective" with "low forward value." The bridge + score fix that: corrective base work earns a real forward score. **Re-state the skew honestly: it is not "too much corrective work," it is "corrective work was invisible to ranking because no bridge existed."** Build the bridge → much of the skew was a measurement artifact.

- **Part residual + the NEW counter-term:** there is a *true* residual skew — ~zero summits being *staked*. The score's topological base-bias (§4.1) will perpetuate it. **Add a STAKING-OBLIGATION / summit-liveness decay term:** banked base substrate that no summit stakes within N stints is **dead capital** (seat-4's sharpest point) — its forward-investment score must **decay**, because the summit it was forward-investment *for* never arrived. This is the dual of SubstrateBanked: *bank the base, but re-price a banked rung downward when its intended summit stays dormant* (arc-review's "re-price the value, not only the seam," applied to banked rungs). This forces the org to eventually stake outward instead of banking base indefinitely — the structural cure for the skew.

### 4.4 The now-vs-banked line (resolved per idea-371)

**BANK (idea-371 — do NOT build now), trigger:** the mechanized arc-engine — auto-`traverse`/score computation, automated park/cut cascade, generated `project/hydrate` rollups, `@apnex/arc-core` as an org tenant. **Quality-gated revivalTrigger:** "forward-investment concepts proven over ≥3 stints" OR "a stint demonstrably mis-ranked despite the manual score."

**BUILD NOW (minimal native expression on existing Hub entities — concepts only, no engine):**
1. Two fields on Idea/Mission/Bug: **`payoff`** (banked/staked/mixed, value-contingency reading) + **`cashesInto`** (summit/arc tag). The field doc resolves the §0 clash by pinning arc's semantics.
2. An **`enables` / `forwardEdges`** list-of-IDs field — the Bug/Idea/Friction→rung **bridge**, the minimal expression that lets corrective work accrue in-degree.
3. **`revivalTrigger` + `rationale` required on every deferral** — anti-amnesia as physics, enforced as a filing discipline now (matches arc's schema allOf).
4. The **forward-investment SCORE as a hand-computed tag** at stint-open, recorded in the stint-report — *architect-computed in-degree × summit value*, not auto-derived (genuine open addition #1, expressed as a number in a field, not an engine). Keep the **rank a gated judgment** — score informs, never auto-ranks (arc's "judgment the model can't encode" boundary).
5. The **stint-report schema (idea-369)** carries: MIX-by-nature, gen:incorp, tele-coverage gaps, banked-rung inventory, staked/banked balance, the score-ranked next-stint menu — reusing arc's delta-ledger `kind` vocabulary `[create/ship/park/revive/retire/...]` for per-item disposition.

---

## 5. Triangulated verdict — what the application implies

Applying (B) to the real corpus, the four seats are **not equally supported by the score**:

- **The base-of-DAG observability + selection cluster wins on the score** — idea-357 (keystone, ~30), idea-364 (root, ~20), C1-widen, idea-363/369, with **bug-195 as a cheap co-shipped SubstrateBanked rung**. This is the **intersection of seat-1 (C3/observability) and seat-3 (incorporation/meta-engine)** — and it attacks **both** named binding constraints (incorporation AND observability) and kills the **dominant friction class** (stale-state) at its substrate, not incident-by-incident. The two halves are the same DAG layer: reconciliation makes ground-truth *standing*, idea-357 makes the controller *see* it.

- **Seat-2 (C2) and seat-4 (D-1/C4 outward) are the next-stint SUMMITS this base enables — correctly staked, not now.** C2 scores high (~25) but its supervisor half is exogenous + Director-gated (not pure-banked); D-1 scores high *potential* (~20) but **SubstrateBanked is violated by staking it onto today's blind, churny deploy spine.** Seat-4's own dead-capital warning is real and is answered by the §4.3 staking-decay term — *not* by staking outward before the base is banked.

- **idea-370 itself banks minimally NOW** (the fields + score-tag + bridge), with the engine banked behind idea-371. The circularity seats flag (ranking on a yardstick you're building) is bounded by keeping the score *advisory to a gated rank*, never auto-ranking.

**Net framework refinement:** the payoff axis holds under the value-contingency reading; add the **`dogfoodProves` edge, the observability multiplier, the Director-attention term, and the staking-obligation decay**; build the bridge + payoff/cashesInto/enables fields + hand-computed score NOW; bank the engine per idea-371. The decisive evidence-anchored result is that **corrective/structural base work carries the highest forward-investment scores (the reframe is real), and SubstrateBanked orders the program: bank observability + ship-integrity this stint, stake the outward control-plane/autonomy summits next.**
