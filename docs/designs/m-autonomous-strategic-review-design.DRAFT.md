# M-Autonomous-Strategic-Review — Integrated Design (v2)

**Idea:** idea-389 — Autonomous System-Driven Strategic/Roadmap Review
**Directive:** Director, 2026-06-29 — *agent-self-determined next-stint priority ranking, ZERO Director steer; dogfoods `seed_blueprint` + the survey system.*
**Author:** lily (architect)
**Status:** v2 (GATE-1 fold, 2026-06-29) — working-tree integration of 4 component designs (EVIDENCE / RANKING / BLUEPRINT / INTEGRITY), with the 4 GATE-1 gating corrections + the Director's open-Q resolutions folded into the body. The v1 adversarial Critique is preserved verbatim as **Appendix B** (the record of what v2 fixed).
**Seed-time HEAD sha (git-pin anchor):** `00f97c6ab36757a921055fa206bed1de6a4212f1`
**Grounded against:** `hub/src/entities/work-item.ts` (node contract), `hub/src/policy/work-item-policy.ts` (`seedBlueprint` + `validateNodeIntrinsics`), `docs/methodology/strategic-review.md` v2.0, `docs/methodology/ledger-reconciliation.md` v1.1, `docs/designs/m-stint-lifecycle-design.md` §0.5/§0.6 (council pattern), `docs/methodology/cdacc-dual-altitude-conformance-council.md` (seal-reveal), `skills/survey/` (skill template).

---

## v2 fold (GATE-1, 2026-06-29)

v2 folds the **4 GATE-1 gating corrections** (from the v1 adversarial Critique, now **Appendix B**) + the **Director's 7 open-Q resolutions** (now §9) into the body. The v1 Critique is preserved verbatim as the record of what was fixed.

**4 gating corrections:**
- **G1 — multi-agent = multi-NODE.** POSITION = 3 per-agent nodes (`score_arch`/`score_eng`/`score_ver`); ADJUDICATE split into `adjudicate_eng` + `adjudicate_ver`. The integrity floor is restated as **"≥2 producing NODES across the engineer+verifier seats"**; every "solo-completion physically impossible / mechanically enforced" claim that wasn't node-structural is removed (the shipped `complete_work` is single-lease-holder and checks `producedBy` only for review-kind evidence).
- **G2 — live-verifier precondition + roster cardinality.** New **Phase 0** precondition: greg (engineer) + steve (verifier) online **and registered as role-Agents** before seeding — verifier-gates need a registered `role=verifier` Agent; architect-spawned verify sub-agents do NOT qualify.
- **G3 — seed-path / bug-203 named + resolved.** claude-code does not re-enumerate tools on `notifications/tools/list_changed`; the unblock = a rebuilt-adapter swap (root cause CONFIRMED = the deployed build was 11 commits behind, missing the tool-surface reconciler #375; greg rebuilt + staged it) + a **coordinated client restart** (takes lily + greg down together) → lily seeds. `get_next` is removed (not a registered Hub verb); the three real blueprint verbs are `seed_blueprint` / `get_current_stint` / `legal_moves`.
- **G4 — Director-dark honestly scoped.** Scan window starts at run-seed/`reconcile_anchor` (catches pre-seal candidate-set contamination); the claim is scoped to **Hub-channel** darkness with the out-of-band gap acknowledged; director-chat's deprecation means there is no live Director side-channel to contaminate (a point in the design's favor).

**Director resolutions (§9):** R-D1 director-queue node (idea-388) + architect-proxy-for-now · R-D2 non-architect packages the artifact · R-D3 minimal-valid first (now 15 nodes) · R-D4 Director gates the #1 FOCUS, reviews the whole slate · R-D5 blind ALL known priors · R-D6 override allowed-but-logged · R-D7 skill packaging deferred to dogfood #2.

**Non-gating folds:** N1 (blinding is soft, not a Hub mechanism) · N2 (`storage:git` refs are format-validated only) · N3 (the total order is reproducible, not objective; ε near-tie non-transitivity) · N4 (Threads + Clarifications added as friction families) · N5 (the minimal-valid trades the clash↔rescore ordering, not the scoring split).

---

## 0. What this document is

Four component designs each solved one face of the autonomous SR:

| Component | Solves | Core contribution kept |
|---|---|---|
| **EVIDENCE** | the input/hydration layer | the neutral, exhaustive, provenance-stamped **evidence pack** + the 6 mechanical signals + signal≠judgement |
| **RANKING** | the deliberation engine | the **defensible total order**: 9 dimensions partitioned 3/3/3, scored 1–5, recomputable composite + tie-break ladder |
| **BLUEPRINT** | the runnable substrate | the **`seed_blueprint` node-contract realisation** + the load-bearing `required:false`-for-siblings rule + git-pinned refs |
| **INTEGRITY** | the validity guards | the **VALID / OUTCOME / ACCEPTED separation** + blinding + seal-before-clash + Hub-channel Director-dark + the FM→defense table |

This document fuses them into **one buildable graph** and resolves every conflict between them explicitly (§1). It is self-contained: a process-naive agent can build and run the SR from this doc + the cited substrate.

The whole system is **one `seed_blueprint` run** that carries a strategic-review from a reconciled ledger to a Director-ratifiable, three-way co-authored, defensible stint-6 priority slate — **with the Director out of the synchronous loop and the architect's standing prior structurally prevented from re-emerging as "the org's choice."**

---

## 1. Conflicts between the four components — resolved explicitly

The components were authored in parallel and disagree in places. Each resolution below is a design decision, not a hedge.

**C1 — Inter-node references: `required:true` vs `required:false`.**
EVIDENCE and RANKING both attach `required:true` references from a downstream node to the upstream *evidence pack / sibling output*, claiming this makes a partial-pack council "un-seedable." **This is wrong against the shipped contract.** `seedBlueprint` runs whole-graph validation (`work-item-policy.ts` step 4, line 522) **before** it creates any node (step 6, line 544); a `storage:entity` `required:true` ref is existence-checked via `entityExists`, so a required ref to a *sibling that does not yet exist at seed-time fails the seed*. **Resolution (BLUEPRINT's rule wins, universally):** every inter-node (sibling) reference is `storage:entity, required:false` (advisory — surfaces in `get_work`/`list_ready_work` as the cold-start read-set) and ordering+freshness is carried by `dependsOn` (the START-gate) / `completionDependsOn` (the arc-gate). Only **pre-existing external artifacts** are `required:true`. The "council can't run on a missing pack" guarantee is provided by **`dependsOn` (can't claim until the pack node is `done`)**, not by a required sibling ref.

**C2 — Methodology-doc references: `storage:hub-doc` vs `storage:git`.**
EVIDENCE used `storage:hub-doc` for the methodology docs. But those are repo files, not Hub Documents; `hub-doc` is existence-checked via the Document store and would fail. **Resolution:** all static doc references are `storage:git` with a **pinned 40-hex sha[:path]** (the Hub is git-less; `PINNED_GIT_REF`, line 270, only validates the pin format and *rejects a mutable branch/tag* — FR-36). All static refs pin `00f97c6…`.

**C3 — Scoring lens: native-lens (RANKING) vs cross-assigned-lens (BLUEPRINT).**
RANKING scores each dimension with its **native** owning role (architect scores tele-fit; engineer scores buildability; verifier scores risk). BLUEPRINT assigns each seat a **cross** lens (architect argues the verifier-risk lens). These are not rivals — they belong to different *phases*. **Resolution:** **native lens at POSITION** (best-informed scoring + the 3/3/3 composite math), **cross-assigned adversarial lens at CLASH** (manufactured contradiction + the architect briefed to red-team their own prior). BLUEPRINT's "architect on the verifier-risk lens" is folded into the **clash layer**, not the scoring layer. You want the architect's expertise *producing* the tele-fit score and the architect's fresh-eyes/self-skepticism *attacking* the slate.

**C4 — Who adjudicates: architect-led (BLUEPRINT) vs architect-excluded (INTEGRITY).**
BLUEPRINT has `[architect]` produce `rank`. INTEGRITY forbids the architect from adjudication (the confirmation-laundering hole that silently invalidates the self-determination test). **Resolution (INTEGRITY wins — it is load-bearing for the test; G1-corrected to multi-NODE):** adjudication is **two separate non-architect nodes** — `adjudicate_eng` (`roleEligibility:[engineer]`) + `adjudicate_ver` (`roleEligibility:[verifier]`) — NOT one `[engineer, verifier]` node asserting "≥2 distinct `producedBy`" (the shipped `complete_work` is single-lease-holder and checks `producedBy` only for review-kind evidence, never a distinct-count — so that assertion is paper; G1). Adjudication is *mechanical* (recompute the composite from sealed scores; the verifier node independently re-derives and co-signs), so excluding the architect costs nothing and closes FM-2 **structurally at the node level**. The architect's only roles are: authoring the blueprint (meta-guard, §6.1 A4), scoring native dimensions D1–D3, being briefed to red-team `candidate_K` at clash, and **proxy-surfacing the Director-queue item** (R-D1 — note `surface` itself moves off the architect, R-D2).

**C5 — Candidate space: full universe (EVIDENCE) vs 5–8 summits (RANKING).**
No real conflict — they are different layers. **Resolution:** the **evidence pack is the full, id-sorted, unclustered universe** (clustering IS interpretation → reserved for the council, per EVIDENCE). The **`seal_candidates` node clusters** the full universe into **5–8 summit candidates** (RANKING's SR sub-step-4 FOLD/COMPOSES/DEFER/EXCLUDE) — that clustering is the council's first judgement act and is itself sealed.

**C6 — Hydration shape: single `gather` node (BLUEPRINT) vs 7-node sub-graph (EVIDENCE).**
**Resolution:** the **canonical** graph uses EVIDENCE's rigorous hydration sub-graph (reconcile + 4 parallel gathers + assemble + gate) because the formal coverage-manifest + neutrality-attestation is the whole neutrality story. BLUEPRINT's single `gather` is accepted only as a **compression of the hydration sub-graph** in the leaner first-dogfood realisation (§4.3).

**C7 — Graph size: BLUEPRINT's 8-node shape.**
BLUEPRINT's clean 8-node JSON is fully validated and runnable — but it **sacrifices integrity splits** (no separate seal/blind node; architect produces `rank`; one combined clash). For *this* directive — a *self-determination validity test* — those splits are load-bearing, not optional. **Resolution:** BLUEPRINT's 8-node shape is **NOT a valid realisation of idea-389** (it cannot pass the §5 validity verdict). The runnable graph is the **minimal-valid** shape (§4.3 — **15 nodes after the v2 folds**, up from the v1 13-node sketch), which compresses only the integrity-*neutral* parts (hydration fan-out, clash/rescore merge) and keeps the integrity-*critical* scoring + adjudicate + verify splits (it does trade the clash↔rescore *ordering* — N5). BLUEPRINT's node-contract mechanics (ids, pins, runbook-required, verifier-gate, dryRun) are reused verbatim.

**C8 — Reconcile role.** EVIDENCE leaves it architect-adjacent; BLUEPRINT puts reconcile inside an `[architect]` gather; INTEGRITY makes it `[engineer]`. **Resolution:** reconcile + all gathers are mechanical and must be **architect-free** (intake neutrality) → `[engineer]`. The architect first appears at `score_arch`.

**C9 — Output filenames + skill packaging.** **Resolution:** evidence pack = `docs/reviews/<YYYY-MM-DD>-sr-evidence-pack.md`(+`.json`); final artifact = `docs/reviews/<YYYY-MM-DD>-sr-stint6.md` (the `<scope>` convention, scope=`stint6`). Skill = `skills/strategic-review/` (sr-init + sr-validate, Survey-template); ratified fixed rubric = `docs/methodology/priority-ranking-council.md`. Both the skill and the rubric doc are **2nd-dogfood packaging** ("no public contract until 2 dogfoods", stint-lifecycle T1) — this run ships the blueprint-as-data first.

**C10 — Dimension granularity: 6 mechanical signals (EVIDENCE) vs 9 scored dimensions (RANKING).** No conflict — they are the two halves of signal≠judgement. **Resolution:** EVIDENCE's 6 mechanical signals are the **neutral inputs** computed in the pack; RANKING's 9 dimensions are the **judgement scores** the council assigns 1–5. The mapping is fixed (§3.2).

---

## 2. Intent + tele-fit

### 2.1 Intent

Produce a **defensible, three-way co-authored, reproducible total order** over next-stint summit candidates that the Director can ratify in one read — generated by lily/greg/steve from a neutral evidence base, **with zero Director steer in the synchronous loop**, and with a machine-checkable attestation that the run was a *valid* self-determination test (the architect's standing D-3/observability-PUSH prior did not launder itself into "the org's choice").

The deliverable is **not just a ranking** — it is a ranking plus a **VALID/INVALID verdict** that certifies the ranking *is* the org's determination. A ranking without that verdict does not answer the directive.

### 2.2 The three things kept mechanically separate (INTEGRITY frame)

1. **VALID** — was the run admissible as a test? (the integrity invariants held) → emitted by `verify_ranking`.
2. **OUTCOME** — what the org actually ranked → sealed at `adjudicate_eng` (+ `adjudicate_ver` co-sign).
3. **ACCEPTED** — what the Director did with it (ratify / reject / override) → recorded at `director_ratify`.
A run that conflates these is invalid. The whole graph is the machinery that keeps them apart and auditable.

### 2.3 Tele-fit

| Property | Serves | Defends against |
|---|---|---|
| No Director input by construction (single terminal Director gate) | **tele-13** (Director-attention amplification — the org self-determines its own priorities) | attention leak / Director-as-bottleneck |
| Neutral exhaustive evidence pack + reconciliation precondition | tele-4 (load-bearing context), tele-5 (perceptual parity) | ranking-the-noise / cherry-pick |
| Partitioned 3/3/3 rubric + recomputable composite + verifier re-derive | tele-1 (one recomputable truth, not a vote), tele-2 (the rubric IS the ranking), tele-9 (gated integrity) | architect-domination / loudest-voice / hidden-preference injection |
| Adversarial cross-clash + seal-before-reveal + movement-flag | tele-6 (frictionless genuine collaboration), tele-10 (the org self-evaluates) | rubber-stamp / convergence-theater / seat-capture |
| Whole run is a `seed_blueprint` + survey-routed output | tele-0/process-mechanisation (declarative coordination) | imperative drift; un-dogfooded primitive |

**Net:** tele-13 made mechanical — the org self-determines a defensible slate with the Director out of the loop, and the run *proves* it did so cleanly.

---

## 3. The evidence layer (from EVIDENCE — adopted, with C1/C2/C6 corrections)

### 3.1 The neutrality invariant

> The evidence pack is a **pure, reproducible function of substrate-state at the reconciliation anchor.** Re-running the same `status:any` queries at the same anchor yields a byte-stable pack (modulo the provenance timestamp). Because assembly is mechanical and exhaustive, no agent and no Director selected what went in — neutrality is a property of construction.

Two hard corollaries:
- **NO Director steer = FULL coverage.** The manual SR "since last SR + open Initiatives" scope-filter is **rejected** — scope-narrowing is itself a steer. The pack gathers the complete live universe; "since last SR" survives only as a per-item *annotation*, never a filter.
- **Signal ≠ judgement.** The pack computes mechanical, objective signals for every dimension and presents the universe **id-sorted, unclustered, with zero ranking**. Weighting, clustering and "top candidates" are reserved for the council.

### 3.2 What the pack gathers (exhaustive-by-construction; never sampled)

14 source families, each pulled `status:any` with an independent `COUNT(*)` cross-check (catches silent MCP pagination-truncation → forces psql fallback). Candidate kinds (get per-candidate analysis): live Ideas, Bugs, umbrella-Ideas (Initiative proxies), and **reverse-gap Teles** (teles with zero live serving candidate, synthesised as "propose-an-Initiative" rows). Everything else is **signal context**.

**Coverage contract (two-tier; run-finding 2026-06-29, audit-5088).** Fail-closed / zero-shortfall applies to **CANDIDATE families only** — {Ideas, Bugs, reverse-gap Teles} — the complete missed-candidate surface; bounded + psql-cheap, so exhaustive-by-construction stays hard here. **CONTEXT families** (documents, audit_entries history-slice, missions, proposals, work, metrics, agents, threads, clarifications, calibrations, friction-backlog, roadmap, reviews) are **exhaustive-best-effort with retrieval-method + any limit explicitly documented in the manifest; non-fatal** — they inform scoring but *cannot hide a candidate*. Strict-all-family fail-closed was un-satisfiable by design (audit_entries is a ~5000-entry backbone the SR only slices; documents is a moving target the run itself grows) — a gate that can never pass is a deadlock, not a firewall. Capture is pinned at the reconcile anchor so the run's own added docs are excluded.

| Family | Sources | Role |
|---|---|---|
| **Entities** | `list_ideas`, `list_bugs`, `list_missions` (terminal-ledger = ground truth), `list_tele`, `list_proposals`, `list_documents` + `docs/reviews/` | candidates + readiness + prior-run continuity |
| **Work/metrics** | `list_work`/`list_ready_work`/`get_current_stint`, `get_metrics` (volatile) **reconstructed from `list_audit_entries`** (durable, survives a watchtower roll), `get_agents` (NOT `get_engineer_status`, bug-184) | live-state + Arc-A signal + agent-health |
| **Friction/pathology** | `scripts/calibrations/calibrations.py list/status` (30 open), `docs/methodology/autonomous-stint-friction-backlog.md` (FR-N + dispositions), **`list_threads`** (thread-density + round-count-near-limit, per strategic-review.md sub-step 5), **open `Clarification`s** (first-class kind — N4) | friction/pathology signal |
| **Roadmap/history** | `docs/roadmap.md` (arcs C1–C4, D-1/2/3, banked vs staked), per-rung stake timestamps (DR-ledger / banking-PR sha), `list_audit_entries` (THE history backbone), prior SR/recon docs | summit candidate space + staking-decay clock + de-dup of prior decisions |

**Three durable history anchors:** audit-derived FSM timers (survive a roll), terminal-ledger **backward** cross-ref (walk *completed* missions for incorporated-not-flipped, never scan the open ledger), prior-run continuity (load every prior deferral + anti-goal to prevent re-litigation).

### 3.3 The 6 mechanical signals → the 9 judgement dimensions (the C10 map)

The pack carries **only the left column** (neutral); the council assigns the right column (1–5):

| EVIDENCE mechanical signal (in the pack) | feeds → RANKING judgement dimension(s) | lens |
|---|---|---|
| tele-fit (declared alignment, count served, reverse-gap flag, north-star touch) | **D1 tele-fit** | architect |
| forward-investment / in-degree (M-N parentage, keystone flag, arc-rung membership) | **D2 strategic leverage / composition** | architect |
| staking-decay pressure (`elapsed/half-life`, queued-idea rot >90d) | **D3 stake-clock pressure** | architect |
| readiness (Design/Proposal exists?, 5-skip-criteria, unresolved `dependsOn`) | **D4 readiness** · **D5 right-sizing** · **D6 dependency-clarity** | engineer |
| risk (substrate-dep count, blast-radius proxy, reversibility flag, named-pathology membership) | **D7 reversibility/blast-radius** · **D8 verification cost** | verifier |
| value / pain (bug severity×recurrence×density×age; idea in-degree + calibration/friction cross-refs) | strategic worth (D1/D2) **and** **D9 risk-of-NOT-doing** (the defect mirror) | architect + verifier |

### 3.4 The pack artifact + the 7 neutrality guarantees

Output: `docs/reviews/<date>-sr-evidence-pack.md` (human) + `.json` (machine sidecar; **`storage:entity` advisory ref** to downstream nodes per C1). Structure §0 provenance header · §1 coverage manifest (per-source expected `COUNT(*)` vs captured vs method; **ANY CANDIDATE-family shortfall → FAIL CLOSED**; CONTEXT families exhaustive-best-effort + documented per the §3.2 two-tier contract) · §2 candidate universe (id-sorted, signals only, no rank) · §3 signal context · §4 history slice · §5 neutrality attestation.

The 7 guarantees, each mechanically checked at `pack_gate`: (1) deterministic assembly, (2) exhaustive-by-construction (manifest fails closed on any CANDIDATE-family shortfall; CONTEXT families best-effort + documented per §3.2), (3) provenance per item (`source_verb`/`query_params`/`captured_at`/`retrieval_method`/`result_count`/`expected_count`/`version_anchor`), (4) stable value-blind `(kind,id)` ordering, (5) signal/judgement separation (no rank), (6) transparent inclusion predicate, (7) reconciliation-gated (stamps the recon anchor).

**Substrate-gap honesty:** lineage/in-degree use a **fixed, versioned tag+body parser** today (deterministic ⇒ still neutral), interface-compatible with idea-151's future `lineage()` verb; §0 stamps the derivation method+version.

---

## 4. The deliberation / ranking mechanism (from RANKING — adopted as the core engine)

### 4.1 Why a quantitative rubric (not BLUEPRINT's qualitative positions)

idea-389 demands a **defensible** ranking. A recomputable composite from published, adversarially-tested, role-partitioned scores is defensible in a way that a qualitative "argued position → adjudicated" slate is not: anyone can re-derive the order from the scorecard, so the pen-holder cannot inject preference. The quantitative rubric is the core; BLUEPRINT's seat-positions are subsumed as the per-lens scorecards, and BLUEPRINT's cross-lens is relocated to clash (C3).

### 4.2 The rubric — 9 dimensions, partitioned 3/3/3 (the anti-domination keystone)

Each dimension is scored **1–5** by its **sole owning role** (native lens). Non-owning roles cannot score it — only challenge it in clash.

| # | Dimension | Owning lens | Weight | Anchor (5 / 3 / 1) |
|---|---|---|---|---|
| **D1** | tele-fit — directness/strength of north-star service (tele-13/tele-4) net across 14 teles | Architect | **3** | serves a north-star + ≥2 teles, net-positive / serves 1, neutral / tangential or contradicts |
| **D2** | strategic leverage / composition — unblocks others, composes cleanly (tele-3), advances a banked rung | Architect | 2 | — |
| **D3** | stake-clock pressure — decay cost of *deferring*; converts-a-stake vs banks-a-stake | Architect | 2 | — |
| **D4** | readiness / concreteness — scope-concrete, has a Design, substrate-ready vs blocked on idea-121/151/126 | Engineer | **3** | passes 5 skip-criteria + Design + deps landed / concrete but needs a Design / idea-only or blocked |
| **D5** | right-sizing / sliceability — fits one stint, PR-sliceable, not an empire | Engineer | 2 | — |
| **D6** | dependency-clarity — upstream deps owned + landed vs dangling (the accessibility class) | Engineer | 2 | — |
| **D7** | reversibility / blast-radius | Verifier | **3** | config-only/flagged/instant-revert / moderate / irreversible migration or wide blast |
| **D8** | verification cost / testability | Verifier | 2 | — |
| **D9** | risk-of-NOT-doing — does absence keep a fault-class live (defect mirror of D1) | Verifier | 2 | — |

**Weight balance:** total = 21; **each lens sums to 7 → each contributes exactly 1/3 (35/105) of max.** The composite cannot be tilted by one lens.

**Composite (the defensible total order):**
```
Composite(c) = ( Σ_d  weight_d · score_{c,d} ) / 105 × 100        # 0–100, descending = rank
```

Every score carries a **bound rationale + a `mode:triangulate-against` reference** (a score is invalid unless it cites the tele/axiom/fault/entity it is grounded in — mechanises the §0.6 triangulation discipline + cal #85 ground-truth).

### 4.3 The graph shape (canonical 22-node; minimal-valid 15-node runnable — v2 recount)

The deliberation runs **native scoring → cross-assigned clash → rescore → mechanical adjudication → independent verify**, sealed CDACC-style so seat 2 can't echo seat 1.

**Canonical graph (22 nodes, full rigor):** see §5.1 node table below. Hydration fan-out (7) + seal (1) + 3 score + 3 clash + 3 rescore + **2 adjudicate (`adjudicate_eng`+`adjudicate_ver`, G1)** + verify + surface + director_ratify.

**Minimal-valid first-dogfood graph (15 nodes after the v2 folds — runnable now; the v1 sketch was 13):** compresses only the integrity-*neutral* parts:
- hydration fan-out A2–A6 → a single `assemble_pack` (one engineer runs the gathers sequentially) — keeps `reconcile_anchor` + `pack_gate`;
- the 3 `clash_*` + 3 `rescore_*` → 3 `deliberate_*` (each role reads the revealed sealed scores, red-teams its cross-target, and revises its own cells in one node).
The **integrity-critical splits are retained**: `seal_candidates`, the native 3/3/3 scoring split (`score_arch`/`score_eng`/`score_ver`), the **two non-architect adjudicate nodes** (`adjudicate_eng`+`adjudicate_ver`, G1), the independent `verify_ranking`, and the **discrete `director_ratify` director-queue node** (R-D1 — no longer folded into `surface`; `surface` is its own non-architect node, R-D2).
**N5 honesty — what the fold DOES trade:** collapsing `clash_*`+`rescore_*` into one `deliberate_*` puts the cross-assigned adversary attack AND the rescore in the **same single lease-holder's node**, so the clash↔rescore *ordering* separation (B4) is partly traded — seal-before-*reveal* is preserved (each `score_*` seals before any `deliberate_*` reads it), but clash-then-rescore is not a separate transition. The minimal-valid keeps the **scoring** split and the **adjudicate/verify** splits, NOT the clash↔rescore separation. This is why BLUEPRINT's 8-node shape is still rejected for idea-389 (C7) — it compresses *through* the scoring + adjudicate splits too.

### 4.4 Clash → convergence (manufactured, not hoped-for)

Clash is **assigned** via the participant-brief mechanism (`payload:{participant, assigned_position, assigned_lens, rationale}`): each clash node is briefed to argue against another seat's bias. The binding rule for *this* test: **the architect is briefed to RED-TEAM `candidate_K` (their own D-3 prior); a non-architect is briefed to STEELMAN it.** If D-3 survives the architect attacking it and a peer defending it → strong validity signal; if it wins because the architect championed it → the matrix forbade that configuration.

Convergence is **on the per-cell scores, not on "what's #1"**: in rescore each challenged cell is either **revised** (movement) or **defended with new evidence** (reinforcement); the total order falls out mechanically. **Rubber-stamp detector:** `adjudicate_eng` emits a **clash-movement-count**; zero movement across all clashes ⇒ flag `LOW-CONTEST` (re-run or carry a noted confidence-risk).

### 4.5 Tie-break ladder (ε = 3 points on the 0–100 scale; first three are one-per-lens)

1. **D3 stake-clock pressure** (architect) — higher decay-cost first.
2. **D4 readiness** (engineer) — more shovel-ready first.
3. **D7 reversibility** (verifier) — safer-to-ship first.
4. **Lowest cross-lens score-variance** — a candidate all three find decent beats a polarised gamble at equal mean.
5. **Lower candidate-id** — deterministic final break (the order is total + reproducible, never a coin-flip).
`adjudicate_eng` logs which rung resolved each near-tie.

**N3 honesty — "defensible" = reproducible, not objective.** The composite (`Σ weight·score /105`) is a weighted sum of **single-seat ordinal 1–5 judgements** treated as cardinal; the order is recomputable-from-scorecard (so the pen-holder can't inject preference), but the inputs are one-seat opinions (the doc's own signal≠judgement). Also the ε=3 "near-tie" test applied *pairwise* can be **non-transitive** across a 3-candidate chain — the `lower-id` final rung still guarantees a well-defined total order, but this is determinism, not metric objectivity. State the convention rather than claim objectivity.

### 4.6 Output — the ranked slate + stint-6 plan

`docs/reviews/<date>-sr-stint6.md`, one row per candidate (descending Composite): rank# · Composite · the 9 sub-scores · rationale (synthesised from bound score-rationales + clash-resolutions) · tele-fit/readiness/risk narratives with cited teles/deps/rollback · clash-movement note · disposition hint (skip-to-Survey / triage-thread / queue / dismiss via `check-skip-criteria.sh` exit-code route). Plus the **stint-6 plan**: rank-#1 = single FOCUS (one stake to convert) + a leanest-slice + a composing floor + anti-goals + bounded commitments/deferrals (`owner+rationale+revivalTrigger`) + the **Survey-dogfood hook** (names the summit's lead Idea for the stint-6 Survey exercise — the standing Director priority; candidate idea-343).

---

## 5. The seed_blueprint graph (BLUEPRINT contract + INTEGRITY guard graph, fused)

`runId: sr_run_2026_06_29` (alphanumeric/underscore only — no dash, so `work-bp-{runId}-{localId}` keeps dash as its sole separator; `BLUEPRINT_ID_TOKEN` satisfied). **Canonical = 22 nodes; minimal-valid = 15 nodes; both ≤ `MAX_BLUEPRINT_NODES=100`.**

**Precondition (live roster — G2):** greg (engineer) + steve (verifier) MUST be online and **registered as their role-Agents** before seeding — the verifier-gates (`pack_gate`, `verify_ranking`) and the per-seat nodes resolve to *registered* role-Agents; architect-spawned verify sub-agents are NOT registered `role=verifier` Agents and cannot complete verifier-gates, so a missing/offline verifier **stalls the graph at `pack_gate`** (the first verifier-gate). See §7 Phase 0 + the §5.1.1 roster caveat.

### 5.1 Canonical node table

Static refs are all `storage:git`, sha `00f97c6…`, `required:true` (seed-time `PINNED_GIT_REF`-validated). Inter-node refs are all `storage:entity, required:false` (advisory; ordering via `dependsOn`). Every node carries a `runbook` (mandatory — each carries `references[]`; `nodeRequiresRunbook`).

| localId | type | roleEligibility | dependsOn | completionDependsOn | produces (evidenceRequirements) |
|---|---|---|---|---|---|
| `reconcile_anchor` | task | **engineer** | — | — | `ev_recon_ledger`·doc (clean live backlog, 5-step, terminal-backward) |
| `gather_entities` | task | engineer | reconcile_anchor | — | `ev_entities`·doc |
| `gather_workmetrics` | task | engineer | reconcile_anchor | — | `ev_workmetrics`·doc (audit-reconstructed FSM timers) |
| `gather_cals_friction` | task | engineer | reconcile_anchor | — | `ev_cals_friction`·doc |
| `gather_roadmap_history` | task | engineer | reconcile_anchor | — | `ev_roadmap_history`·doc (+ staking-decay clocks) |
| `assemble_pack` | task | engineer | — | **[gather_entities, gather_workmetrics, gather_cals_friction, gather_roadmap_history]** | `ev_evidence_pack`·doc, `ev_coverage_manifest`·doc, `ev_neutrality_attest`·freeform |
| `pack_gate` | **verifier-gate** | verifier | assemble_pack | — | `ev_pack_verified`·**audit** (refResolvable, producedBy=verifier; bug-204 fold — was ·review) |
| `seal_candidates` | task | **engineer** | pack_gate | — | `ev_candidate_slate`·doc (5–8 summits, symmetric records, no anchor slot), `ev_provenance_sidecar`·doc (sealed de-blinding key), `ev_seal_hash`·freeform (frozen-set hash = the reveal line) |
| `score_arch` | task | **architect** | seal_candidates | — | `ev_score_arch`·doc (D1/D2/D3 {score, rationale, triangulate-ref}; SEALED) |
| `score_eng` | task | **engineer** | seal_candidates | — | `ev_score_eng`·doc (D4/D5/D6) |
| `score_ver` | task | **verifier** | seal_candidates | — | `ev_score_ver`·doc (D7/D8/D9) |
| `clash_arch` | task | architect | [score_arch, score_eng, score_ver] | — | `ev_clash_arch`·doc (red-team verifier D7–D9 **+ red-team candidate_K**; ≥1 cell-bound challenge) |
| `clash_eng` | task | engineer | [score_arch, score_eng, score_ver] | — | `ev_clash_eng`·doc (scope-realism red-team of architect D1–D3 **+ steelman candidate_K**) |
| `clash_ver` | task | verifier | [score_arch, score_eng, score_ver] | — | `ev_clash_ver`·doc (risk red-team of engineer D4–D6 + architect D3) |
| `rescore_arch` | task | architect | [clash_eng, clash_ver] | — | `ev_rescore_arch`·doc (final D1–D3, each challenged cell held(+defense) \| revised(+delta)) |
| `rescore_eng` | task | engineer | [clash_ver] | — | `ev_rescore_eng`·doc (final D4–D6) |
| `rescore_ver` | task | verifier | [clash_arch] | — | `ev_rescore_ver`·doc (final D7–D9) |
| `adjudicate_eng` | task | **engineer** (NOT architect) | — | **[rescore_arch, rescore_eng, rescore_ver]** | `ev_ranked_slate`·doc, `ev_stint6_plan`·doc, `ev_recompute_hash`·freeform, `ev_movement_count`·freeform (mechanical recompute of the composite from sealed scores) |
| `adjudicate_ver` | task | **verifier** (NOT architect) | — | **[rescore_arch, rescore_eng, rescore_ver]** | `ev_recompute_hash_ver`·freeform (**independent** re-derivation; MUST match `ev_recompute_hash`), `ev_adjudicate_cosign`·doc — the verifier-seat's structural contribution to OUTCOME (the 2nd producing NODE, G1) |
| `verify_ranking` | **verifier-gate** | verifier (**≠ adjudicator** — single-verifier caveat §5.1.1) | [adjudicate_eng, adjudicate_ver] | — | `ev_verify_verdict`·**audit** (refResolvable, producedBy=verifier; bug-204 fold — was ·review; VALID/INVALID + checklist; pinned head-SHA) |
| `surface` | task | **[engineer, verifier]** (non-architect — R-D2) | verify_ranking | — | `ev_sr_artifact`·doc (§0–§11 incl. integrity attestation + rationale table), `ev_sr_pr`·pr (lands artifact + applies triage routes) |
| `director_ratify` | task | **[director]** (director-queue node, idea-388; architect proxy-surfaces for now — R-D1) | surface | **[all 21 upstream]** (ARC-ROOT) | `ev_director_ratify`·audit (refResolvable; three dispositions) |

**Arc-root = `director_ratify`** (`completionDependsOn` the whole graph) → `get_current_stint(work-bp-sr_run_2026_06_29-director_ratify)` projects whole-run k/N.

### 5.1.1 Roster-cardinality caveat (G2)
The standing roster is **one agent per role** — lily (architect) / greg (engineer) / steve (verifier). Two consequences the run must own honestly:
- **`verify_ranking` ≠ adjudicator (FM-11) holds across the engineer-vs-verifier *seat* split, not within the verifier seat.** With a single verifier, steve holds **both** `adjudicate_ver` and `verify_ranking`. The structural **≥2-producing-nodes** floor is still met (`adjudicate_eng` [greg, the primary adjudicator that produces the slate] + `adjudicate_ver` [steve]); standing up a **2nd registered `role=verifier` Agent** fully separates `adjudicate_ver` from `verify_ranking` — noted as the structural-strengthening follow-on.
- **Verifier-gates require a LIVE, registered verifier.** `pack_gate` + `verify_ranking` resolve their `review` evidence to a registered `role=verifier` Agent (the predicate reads the registry role); architect-spawned verify sub-agents are NOT registered and **cannot** complete them. steve MUST be online for the whole run (Phase 0). The stint-5 retro recorded steve offline for that whole stint with architect-spawned sub-agents covering verification — that exact condition must NOT hold at seed-time, or the graph stalls at `pack_gate`.

### 5.2 The load-bearing resolvability rule (why it validates at seed-time)

`seedBlueprint` validates the whole graph **before** creating any node. Therefore:
- **Static external artifacts** (methodology docs, calibrations, friction-backlog, roadmap, the council design, tele-glossary, check-skip-criteria.sh) → `storage:git`, `required:true`, pinned `00f97c6…`. **Caveat (N2):** a `storage:git` ref is **format-validated only** (`PINNED_GIT_REF` regex) — the Hub is git-less and **cannot confirm the path exists at that sha**, so a wrong `00f97c6…:docs/wrong/path.md` would still pass the seed. (`entity`/`hub-doc`/`inline` refs ARE existence-checked; `git` refs are not — so "fail-closed resolvable at seed-time" is true only for those, not for git.) Path-correctness is a build-time author responsibility, re-checked at `verify_ranking`.
- **Sibling outputs** (pack→seal, seal→scores, scores→clash, …) → `storage:entity`, **`required:false`** (advisory) — they don't exist at validation time, so a `required:true` entity ref would fail the seed. Freshness+existence is carried by `dependsOn`/`completionDependsOn`. *This is C1, applied to every edge.*
- `mode:triangulate-against` on the council/tele/calibration refs = the rigor contract (each decision maps to a tele-N + the named fault it defends).

### 5.3 Seed-time conformance (all guardrails satisfied — canonical 22-node)
- runId + all 22 localIds are alphanumeric/underscore (`BLUEPRINT_ID_TOKEN`); no dash.
- localId uniqueness; node-cap 22 ≤ 100.
- Dangling-edge check spans the `dependsOn`+`completionDependsOn` union — every target is a declared localId.
- Cycle-free: union topo-sort yields `reconcile_anchor → gather_* → assemble_pack → pack_gate → seal_candidates → score_* → clash_* → rescore_* → {adjudicate_eng, adjudicate_ver} → verify_ranking → surface → director_ratify`; nothing depends on `director_ratify` ⇒ acyclic.
- `runbook` present on every node (all carry `references[]`; `pack_gate`/`verify_ranking` are verifier-gates) → `nodeRequiresRunbook` satisfied.
- Every `required:true` ref is a 40-hex `sha:path` to a confirmed-present repo file; every inter-node ref is `required:false`.
- Evidence-requirement ids unique within each node.
- Static-only (no conditionals/loops/dynamic expansion).

---

## 6. The integrity guards (from INTEGRITY — adopted as the validity layer)

### 6.1 Neutral prep — the architect's prior is ONE input, not privileged
- **A1 Symmetric candidate schema** — every candidate (incl. D-3) is `{candidate_id, value_evidence[], readiness_evidence[], tele_alignment[], cost_estimate, source_class}`. **No `recommended`/`default`/`baseline` field** → anchoring (FM-1) has no slot to live in.
- **A2 Provenance blinding (load-bearing; R-D5 = blind ALL known priors, not just D-3)** — **every known standing prior** enters as a neutral `candidate_*`: the architect's D-3/observability-PUSH (`candidate_K`) **and any Director-held lean or other seat's standing prior**. The "this is X's standing recommendation" mapping goes **only to a sealed provenance sidecar** (`ev_provenance_sidecar`), invisible during deliberation, recoverable at audit. Seats rank each candidate on its evidence, not its authorship. **Honesty (N1): blinding is SOFT** — there is no Hub primitive that hides authorship; it relies on agents not reading the sealed sidecar, and an LLM architect who authored the enumeration can infer `candidate_K` and then scores exactly D1–D3 (where the prior lives). Mitigation: a **non-architect re-scores tele-fit (D1) blind** as a cross-check; state plainly that blinding is a discipline, not a construction-guarantee.
- **A3 ≥4 independent ground-truth sources** — roadmap arcs, the 30 open calibrations, the FR-N friction backlog, reverse-gap teles, open ideas/bugs (exhaustive). The architect cannot quietly narrow the field to where their prior wins — the field is mechanically enumerated from sources the architect doesn't own.
- **A4 Meta-guard (the experiment designer cannot rig the experiment)** — `seedBlueprint` is architect-only, so the architect authors the graph (a contamination vector). Two defenses: (a) seed with `dryRun:true` first (validate + planned creation-order + would-be ids, **zero creates**), and (b) a **non-architect peer certifies the dryRun structure** before the real seed (symmetric schema present, blinding present, ≥4 sources, ≥1 adversary/candidate, architect on red-team). `verify_ranking` re-checks these structurally post-hoc as a backstop.

### 6.2 Genuine multi-agent contribution (not architect rubber-stamp)
- **B1** architect excluded from **both** adjudicate nodes (`adjudicate_eng`/`adjudicate_ver` roleEligibility allow-lists; omission excludes).
- **B2 (≥2 producing NODES, not ≥2 producers-on-one-node — G1 fix)** — genuine multi-agent contribution is enforced **structurally at the node/role-eligibility level**, never asserted inside one node's evidence array. The shipped `complete_work` is **single-lease-holder** and checks `producedBy` **only for `review`-kind evidence** (never a distinct-count, never a non-architect constraint) — so the v1 claim that "≥2 distinct `producedBy` on one `adjudicate` node makes solo-completion physically impossible" is **FALSE against the contract** and is deleted (the "G3 tri-seat kill" had no enforcing mechanism in the repo). Instead: POSITION = **3 separate per-agent nodes** (`score_arch`/`score_eng`/`score_ver`) and ADJUDICATE = **2 separate non-architect nodes** (`adjudicate_eng` [engineer] + `adjudicate_ver` [verifier]). The integrity floor is **"≥2 producing NODES across the engineer+verifier seats"** — met by `adjudicate_eng`+`adjudicate_ver` (and reinforced by `score_eng`/`score_ver`, `clash_eng`/`clash_ver`). No "mechanically/structurally enforced" claim survives that isn't node-structural.
- **B3** assigned-position briefs manufacture clash (§4.4): architect red-teams `candidate_K`, a non-architect steelmans it.
- **B4** seal-before-clash — each `score_*` seals before any `clash_*` reveals others (CDACC fan-out-seal-then-reveal); convergence-by-anchoring (FM-8) structurally prevented.
- **B5** clash must record motion — `clash_*` require a convergence record (≥1 move OR explicit `adversary_attempted + rebuttal`); "converged with zero clash" is flagged by `verify_ranking` as convergence theater.

### 6.3 Adversarial verification of the ranking (`verify_ranking`, verifier-gate, ≠ adjudicator, pinned head-SHA)
The verifier **independently re-derives — does not review-approve** (FM-11):
- **C1** top pick + runner-up: re-resolve every cited `value_evidence` ref from ground truth (`get_idea`/`get_bug`/`get_tele`/`get_metrics`/psql — never narrative recall, per the CLAUDE.md ledger mandate); a value claim whose evidence doesn't re-resolve fails the gate.
- **C2** readiness is a **separate axis from value** (FM-7): deps resolved, scope concrete, `check-skip-criteria.sh` exit-route; the reported "top actionable" = max-value among the *ready* set.
- **C3** every rank binds ≥1 *resolved* ref + every `triangulate-against` ref is *addressed* (FM-6).
- **C4 integrity backstop** — re-check the run-validity invariants (blinding; ≥4 sources; **≥2 producing nodes across the engineer+verifier seats**; ≥1 adversary + clash recorded; **Hub-channel** Director-dark held over [run-seed, verdict]) → a single **VALID/INVALID** verdict alongside the value/readiness/completeness verdict.

### 6.4 Director reviews without contaminating
- **D1** one Director node, **terminal only** (`director_ratify`, a `roleEligibility:[director]` director-queue node — idea-388, R-D1 — completionDependsOn the whole graph) — structurally absent from intake, council, verify.
- **D2** sealed output, post-seal review — the ranking is committed/timestamped (`ev_seal_hash` chains to `adjudicate_eng`) before the Director sees it; the Director cannot retro-edit the org's determination (FM-10/12).
- **D3 Hub-channel Director-dark mechanically verified (honestly scoped — G4 fix)** — `verify_ranking` scans `list_messages`/`list_threads` over the run window **starting at `reconcile_anchor`/run-seed** (NOT seal-ts — the highest-leverage contamination is *pre-seal*: *which* candidates survive into the 5–8-summit cut at `seal_candidates` is set before the seal) through verdict-ts, for any Director message into the run; a mid-run Hub-channel Director steer flips the verdict to **INVALID** (re-run). **Honest scope:** this verifies *Hub-channel* darkness only. The Director historically steered via **director-chat**, which is **now DEPRECATED/unavailable** — so (a) there is no active Director side-channel to contaminate the run (a point in the design's favor), but (b) the scan cannot prove out-of-band darkness; the claim is scoped to "no Hub-channel Director steer detected over [run-seed, verdict]" with the out-of-band gap acknowledged. Re-wire a chat/ACP transcript into the scan if/when a Director interface returns (idea-390).
- **D4 three discrete dispositions** (preserves Director authority + audit honesty). **Scope (R-D4):** the Director reviews the **WHOLE ranked slate** (so deferrals/queue routes are seen in context) and **gates the #1 FOCUS** (the binding decision):
  - **ratify-as-is** → OUTCOME = ACCEPTED (org determined direction).
  - **reject-with-recorded-reason** → re-run (reason logged as input to the next run, not an edit of this one).
  - **accept-with-Director-amendment (R-D6: allowed-but-logged, never forbidden)** → recorded as a **distinct DIRECTOR-OVERRIDE layer** ("org determined X; Director overrode to Y") — the test stays clean (we measured what the org chose *and* what the Director changed, separably). The guard is honest labeling, never forbidding override.

### 6.5 Auditability (ground-truth, no prose memory)
- **E1** the run graph IS the provenance — every node records `references` consumed + `evidenceRequirements` produced (by `requirementId`, `producedBy`, timestamp, lease); `dependsOn`/`completionDependsOn` make the order immutable + replayable (idempotent createOnly).
- **E2** the per-run artifact (`<date>-sr-stint6.md`) adds **§0 Integrity Attestation** (the `verify_ranking` checklist + VALID/INVALID) and a **Ranking-rationale table** (rank → candidate → value-evidence refs → readiness verdict → served tele/axiom → adversarial-verify verdict; each cell links a *resolved* entity).
- **E3** sealed sidecars (git refs) — the candidate-provenance de-blinding key + each `score_*` sealed evaluation — let an auditor answer "did the winner win on merit or on authorship?" (CDACC reveal-branch pattern).

### 6.6 Failure-mode → defense (the validity matrix)

| # | Invalidating failure | Defense |
|---|---|---|
| FM-1 | architect-prior anchoring | A1 symmetric schema (no anchor slot) + A2 blinding |
| FM-2 | architect rubber-stamp / seat-capture | B1 architect excluded from BOTH adjudicate nodes + B2 **≥2 producing NODES across the engineer+verifier seats** (`adjudicate_eng`+`adjudicate_ver`; node-structural, not ≥2-producers-on-one-node — G1) |
| FM-3 | Director steer leak | D1 single terminal Director-queue node + D3 **Hub-channel** Director-dark scan over **[run-seed, verdict]** → INVALID (out-of-band gap acknowledged; director-chat deprecated ⇒ no live side-channel — G4) |
| FM-4 | evidence fabrication / hallucinated cross-ref | seed-time `required`-ref resolvability + C1 verifier re-resolves from ground truth |
| FM-5 | stale/noisy backlog | `reconcile_anchor` precedes intake; clean backlog is the only valid SR input |
| FM-6 | untraceable ranking | C3 every rank binds a resolved ref + addresses triangulate-against + E2 rationale table |
| FM-7 | readiness overclaim | C2 value/readiness separate axes + skip-criteria; "top actionable" = max-value among ready |
| FM-8 | convergence theater | B3 ≥1 adversary/candidate + B4 seal-before-clash + B5 must record a move-or-attempt |
| FM-9 | single-input candidate collapse | A3 ≥4 independent exhaustive sources; prior is one row in the union |
| FM-10 | post-hoc rationalization | `seal_candidates` freezes+hashes the set before ranking; ordering enforced by dependsOn |
| FM-11 | adversary = author | `verify_ranking` ≠ adjudicator + re-derive (not approve) + pinned head-SHA — *strict* verify≠adjudicator needs a 2nd registered verifier-Agent; under the 1-verifier roster steve holds both `adjudicate_ver` + `verify_ranking` (acknowledged roster caveat, §5.1.1) |
| FM-12 | Director-ratify becomes Director-author | D2 sealed output + D4 override = distinct layer |
| FM-13 | architect rigs the experiment design | A4 dryRun preview + non-architect peer-cert + C4 post-hoc structural re-check |

### 6.7 The validity verdict (acceptance)
The run is **VALID** (test-admissible) iff `verify_ranking` PASSes ALL of: provenance blinded; ≥4 independent sources; **≥2 producing NODES across the engineer+verifier seats** (`adjudicate_eng`+`adjudicate_ver`); ≥1 adversary assigned **and** a clash move-or-attempt recorded; **Hub-channel** Director-dark held over **[run-seed, verdict]** (out-of-band gap acknowledged); every rank binds a resolved ref with its triangulate-against addressed; top-actionable = max-value among the ready set; recompute-hash matches the published order (and `ev_recompute_hash_ver` matches `ev_recompute_hash`). Any miss → **INVALID** (the artifact still ships, marked INVALID with the failing invariant named). A **VALID + ratify-as-is** outcome = *the org determined direction without Director steer*; a **VALID + override** outcome = honestly logged as *org-determined-then-Director-amended*.

---

## 7. Lifecycle (precondition → prep → seed-channel-unblock → run → Director-gate)

**Phase 0 — PRECONDITION (live roster + seed channel — G2/G3).**
0a. **Live roster:** `get_agents` confirms **greg (engineer) + steve (verifier) online AND registered as their role-Agents**. The verifier-gates (`pack_gate`, `verify_ranking`) and the per-seat score/clash/rescore/adjudicate nodes resolve to *registered* role-Agents; architect-spawned verify sub-agents are NOT registered `role=verifier` Agents and cannot complete verifier-gates → a missing/offline verifier **stalls the graph at `pack_gate`**. The stint-5 retro recorded steve offline for that whole stint — that exact condition must NOT hold at seed-time.
0b. **Seed channel unblocked** per Phase 2 (bug-203 restart) — without it, lily cannot reach `seed_blueprint`.

**Phase 1 — PREP (architect).**
1. Confirm a **fresh ledger reconciliation** exists (or schedule `reconcile_anchor` as the graph's first node).
2. Author the blueprint spec (the §5 node table → the `seed_blueprint(runId, nodes[])` payload).
3. `seed_blueprint(dryRun:true)` → validate the whole graph; returns `creationOrder` + the `localIdToWorkId` map; **zero creates**.
4. **Hand the dryRun output + spec to a non-architect peer for structural certification** (A4): symmetric schema, blinding present, ≥4 sources, ≥1 adversary/candidate, architect-on-red-team, native 3/3/3 split, non-architect adjudicate. *No real seed until this signs off.*

**Phase 2 — SEED-CHANNEL UNBLOCK (adapter-swap + coordinated client restart — G3).**
Two real, independent faults gate seeding — name **both**:
- **Adapter (RESOLVED operationally):** the deployed `@apnex/network-adapter` build was **11 commits behind** and missing the **tool-surface reconciler (#375)** — so `seed_blueprint` / `get_current_stint` / `legal_moves` were not in the adapter's exposed surface. Root cause CONFIRMED; greg **rebuilt** the adapter and **staged it adjacent** for a turnkey swap.
- **Host (bug-203):** the **claude-code** host (which lily runs — and `seed_blueprint` is **[Architect]-only**, so only lily can seed) does **NOT** re-enumerate tools on `notifications/tools/list_changed`. So even after the adapter is swapped, a *running* claude-code session stays stale on the new verbs — hot-reload is insufficient. **bug-203 is why a full client RESTART (not hot-reload) is required.**
- **Correction of the v1 framing:** v1 said "the rebuild misattributes a host bug to the adapter." That is wrong — **both were real**: the adapter genuinely lacked the reconciler #375 AND bug-203 (host) is the reason a full restart is mandatory.
- **The unblock = a turnkey adapter-swap + a COORDINATED CLIENT RESTART** — the only reliable path. It takes **lily + greg down together** (a deliberate, announced window; it collides with the never-idle mandate, so it is a *planned interrupt*, not drift). **After the restart, lily (architect) re-confirms `seed_blueprint`/`get_current_stint`/`legal_moves` are enumerable, then seeds the blueprint.**
- **Cold-start re-engagement** after the restart uses the **claimable-digest (idea-353) + `list_ready_work`/`get_work`** — NOT `get_next` (not a registered Hub verb; removed from this design). The three confirmed-registered blueprint verbs are **`seed_blueprint` / `get_current_stint` / `legal_moves`**.

**Phase 3 — RUN (autonomous, Director-dark).**
5. `seed_blueprint(dryRun:false)` → materialises the WorkItems at `work-bp-sr_run_2026_06_29-*`; any validation failure creates ZERO; a mid-create infra fault compensating-deletes this run's creates with a loud id-trail; re-running the same runId is idempotent (createOnly).
6. The org self-hydrates: engineer claims the hydration chain; the three role-pinned scorers self-claim via `list_ready_work` → `get_work` → `claim_work`/`complete_work`; clash/rescore/**adjudicate_eng+adjudicate_ver**/verify follow the DAG. `get_current_stint(work-bp-sr_run_2026_06_29-director_ratify)` is the live whole-run k/N. **No Director, no architect-adjudication, in this phase.** The Hub-channel Director-dark scan (D3) covers **[run-seed, verdict]**; director-chat's deprecation means there is no live Director side-channel to contaminate this phase (out-of-band gap acknowledged).

**Phase 4 — DIRECTOR-GATE (terminal).**
7. `surface` (**NON-architect** — R-D2) commits the §0–§11 artifact + opens the PR + routes triage. `verify_ranking` has already emitted VALID/INVALID.
8. `director_ratify` is a **Director-eligible WorkItem** (`roleEligibility:[director]`) = the **director-work-queue (idea-388) in its FIRST live use** (R-D1). **BUT** director-chat is deprecated ⇒ the Director has **no direct interface yet** ⇒ **for now the architect PROXY-surfaces** the queue item and walks the Director through it (the durable director-queue node is spec'd; a real Director interface is future work — idea-390 / ACP rework). The Director reviews the **WHOLE ranked slate** and **gates the #1 FOCUS** (R-D4), recording one of the three dispositions (D4). On ratify-as-is the run closes as *org-self-determined*; override is logged as a distinct DIRECTOR-OVERRIDE layer (R-D6); reject re-runs with the reason as next-run input.

---

## 8. Build / run steps (concrete)

1. **Verify the contract** (done in this design): `seed_blueprint` validates-whole-graph-before-create (`work-item-policy.ts` step 4 < step 6); `nodeRequiresRunbook` = verifier-gate ∨ references>0; `PINNED_GIT_REF` = 40-hex `sha[:path]`; `MAX_BLUEPRINT_NODES=100`; `BLUEPRINT_ID_TOKEN=/^[A-Za-z0-9_]+$/`; review-evidence `producedBy` must resolve to a `role=verifier` Agent.
2. **Pin static refs** to the seed-time HEAD `00f97c6…` — `SR=…:docs/methodology/strategic-review.md`, `RECON=…:docs/methodology/ledger-reconciliation.md`, `SURVEY=…:docs/methodology/idea-survey.md`, `CALIB=…:docs/calibrations.yaml`, `FRICTION=…:docs/methodology/autonomous-stint-friction-backlog.md`, `ROADMAP=…:docs/roadmap.md`, `COUNCIL=…:docs/designs/m-stint-lifecycle-design.md`, `TELE=…:docs/methodology/tele-glossary.md`, `SKIPCRIT=…:skills/survey/scripts/check-skip-criteria.sh`.
3. **Assemble the payload** from the §5.1 table (canonical 22-node, or the **15-node minimal-valid** per §4.3 — R-D3 runs minimal-valid first). All sibling refs `storage:entity, required:false`; all static refs `storage:git, required:true`; `runbook` on every node.
4. **`seed_blueprint(dryRun:true)`** → confirm `creationOrder` + ids; **peer-certify** (A4).
5. **Seed-channel unblock** (Phase 2, G3): swap the rebuilt adapter (+#375 reconciler) + a **coordinated client restart** (bug-203 — lily+greg down together) → lily re-confirms `seed_blueprint`/`get_current_stint`/`legal_moves` are enumerable → seed. (Re-engage via claimable-digest + `list_ready_work`/`get_work`; no `get_next`.)
6. **`seed_blueprint(dryRun:false)`** → run; monitor via `get_current_stint(...-director_ratify)`.
7. **Skill packaging is deferred** to the 2nd dogfood (C9, R-D7): `skills/strategic-review/sr-init.sh` (assert reconcile, run ≥4-source enumeration, blind+seal, emit+`dryRun`-validate the spec) + `skills/strategic-review/sr-validate.sh` (schema-validate the artifact §0 + §1–§11 and mechanically check the §6.6 invariants → VALID/INVALID), modeled on `skills/survey/`. Reused as-is: `check-skip-criteria.sh`, `calibrations.py`, `get-entities.sh` + psql-cookbook.

---

## 9. Resolutions (Director-decided 2026-06-29)

All v1 open questions are resolved; the decisions are folded into §5.1, §6, §7.

- **R-D1 — Director-gate mechanism (was Q-D1).** The verdict + ranked slate land as a **Director-eligible WorkItem** (`roleEligibility:[director]`) — the **director-work-queue (idea-388), in its FIRST live use**. BUT director-chat is **deprecated** ⇒ the Director has **no direct interface yet** ⇒ **for now the architect PROXY-surfaces** the queue item and walks the Director through it. BOTH are spec'd: the **durable director-queue node** (`director_ratify`) AND **architect-proxy-surfacing-for-now**. New director-interface tools are future work (idea-390 / ACP rework).
- **R-D2 — Final-artifact packaging (was Q-D2).** A **NON-architect** packages the final artifact: `surface` → `roleEligibility:[engineer, verifier]` (removes any packaging-spin vector).
- **R-D3 — Graph shape for the first run (was Q-D3).** Run the **minimal-valid** graph first, then graduate to canonical. After the v2 folds the minimal-valid is **15 nodes** (up from the v1 13-node sketch: `adjudicate` split into `adjudicate_eng`+`adjudicate_ver` per G1, and `director_ratify` restored as a discrete director-queue node per R-D1).
- **R-D4 — Ratify scope (was Q-D4).** The Director reviews the **WHOLE ranked slate** and **gates the #1 FOCUS** (deferrals/queue routes seen in context; the binding decision is the FOCUS).
- **R-D5 — Blinding scope (was Q-D5).** Blind **ALL known standing priors**, not just the architect's D-3 — any Director-held lean or other seat's prior also enters as a neutral `candidate_*` (§6.1 A2).
- **R-D6 — Override semantics (was Q-D6).** Override is **allowed-but-logged** as a distinct **DIRECTOR-OVERRIDE** layer (the test stays VALID; "org determined X; Director overrode to Y" recorded separably) — recorded-and-honoured, never forbidden.
- **R-D7 — Skill packaging (was Q-D7).** The `skills/strategic-review/` public skill is **DEFERRED to the 2nd dogfood** (T1 "no public contract until 2 dogfoods"); this run ships the blueprint-as-data only.

### 9.1 The 4 GATE-1 gating corrections folded (from Appendix B)
- **G1 — multi-agent = multi-NODE.** POSITION = 3 per-agent nodes (`score_arch`/`score_eng`/`score_ver`); ADJUDICATE = 2 non-architect nodes (`adjudicate_eng`+`adjudicate_ver`). Floor restated as **≥2 producing NODES across the engineer+verifier seats**; every non-node-structural "solo-completion impossible / mechanically enforced" claim deleted (§1 C4, §6.2 B2, §6.6 FM-2, §6.7).
- **G2 — live-verifier precondition + roster cardinality.** Explicit Phase 0 precondition: greg + steve online **and registered** before seeding; verifier-gates need a registered `role=verifier` Agent (architect-spawned verify sub-agents do NOT qualify). Floor redefined per G1 (§5, §5.1.1, §7 Phase 0).
- **G3 — seed-path / bug-203.** Named: claude-code does not re-enumerate tools on `notifications/tools/list_changed`. Seed channel RESOLVED operationally — rebuilt adapter (root cause: deployed build 11 commits behind, missing reconciler #375; greg staged it) + **coordinated client restart** (the only reliable unblock; lily+greg down together) → lily seeds. `get_next` removed (not a registered verb); the three real blueprint verbs are `seed_blueprint`/`get_current_stint`/`legal_moves` (§7 Phase 2).
- **G4 — Director-dark honestly scoped.** Scan window starts at run-seed/`reconcile_anchor` (catches pre-seal candidate-set contamination); claim scoped to **Hub-channel** darkness with the out-of-band gap acknowledged; director-chat deprecation ⇒ no live side-channel to contaminate (a point in the design's favor) (§6.4 D3, §6.6 FM-3, §6.7).

---

## Appendix A — provenance of each section

| Section | Primary source component | Key adaptations |
|---|---|---|
| §3 evidence layer | EVIDENCE | C1 (sibling refs→required:false), C2 (git not hub-doc), C5/C6 (full universe; council clusters) |
| §4 ranking engine | RANKING | C3 (cross-lens→clash), C4 (2 non-architect adjudicate nodes — G1), C7 (15-node minimal-valid) |
| §5 graph + contract | BLUEPRINT | extended with seal/blind/verify/ratify nodes; `required:false` rule applied universally |
| §6 integrity guards | INTEGRITY | mapped onto the fused graph; axes (value/ready/risk) reconciled to the native 3/3/3 lenses |
| §1 conflict resolution, §2 intent, §7–§9 lifecycle/build/resolutions | this integration | — |

---

## Appendix B — v1 Critique (adversarial, ground-truthed 2026-06-29 — lily) — the record of what v2 fixed

> **PRESERVED VERBATIM as the v2 audit trail.** All four gating items (G1–G4) and all five non-gating items (N1–N5) below are folded into the v2 body (see the §"v2 fold" changelog near the top + §9.1). This appendix is retained unedited as the ground-truthed record of the v1 state.

**Verdict: NEEDS WORK.** The contract reading is unusually accurate and the integrity *intent* is the strongest part of the doc — but four of its load-bearing integrity guarantees are asserted as **mechanically enforced** when the shipped `complete_work` / lease / agent-registry contract does **not** enforce them, and the run-path is **not real** for the seeding agent. These are gating because idea-389's whole deliverable is a *VALID/INVALID self-determination verdict* — a guard that is documentary-only invalidates the very thing the run is supposed to certify.

### What is solid (credit)
- The `seed_blueprint` contract reading is correct and verifiable: validate-whole-graph **before** any create (`work-item-policy.ts` steps 0–4 at L485–524, dryRun L533, expand L544–569); `required:false` for sibling/forward refs is the right call (C1) — a `required:true` `storage:entity` ref to a not-yet-created sibling **does** fail the seed (`validateRequiredReference` → `entityExists`, L299–304). `PINNED_GIT_REF=/^[0-9a-f]{40}(:.+)?$/` (L270), `MAX_BLUEPRINT_NODES=100` (L413), `BLUEPRINT_ID_TOKEN=/^[A-Za-z0-9_]+$/` (L417), union topo-sort cycle-check (L448–472) — all cited accurately. C2 (git not hub-doc) is correct: `hub-doc` is existence-checked against the Document store (L294–298), repo files are not Documents.
- The verifier-gate path **is** buildable: a `review`-kind requirement with `refResolvable` resolves the gate WorkItem and checks its Hub-stamped `createdBy.role === "verifier"` (non-spoofable; repo-substrate L962–971), and a non-refResolvable review falls back to a `producedBy`→`role=verifier` registry check (L973–981). `pack_gate` / `verify_ranking` as verifier-gates with review evidence is real. **[bug-204 FALSIFIED 2026-06-29 — dogfood]:** the live run proved this claim INCOMPLETE. A `refResolvable` requirement ALSO demands the bound ref RELATE to the WorkItem via `targetRef`, but verifier-gates have `targetRef:null` (and `dependsOn` isn't counted) — so the verdict can't bind. AND `review`-kind is unsatisfiable: there is no verifier-mintable Review entity (`create_review` is architect-only + task-report-bound; the verifier's durable verdict surface is `create_audit_entry`/audit). FIX: evidence → `kind:audit` (template folded) + a narrow Hub predicate change (verifier-gate pass-evidence = registered-verifier audit; targetRef-relation waived for self-anchored gates). Lesson: a code-cited critique still missed a runtime predicate — the dogfood is the real test.

### GATING corrections

**G1 — The "two-producer floor" (B2/FM-2) is NOT mechanically enforced; "solo-completion physically impossible" is false against the contract.**
`complete_work` is a **single-lease-holder** verb (`completeWork`, policy L198–221; the holder+token fence is the whole `#355` design). **One** agent claims a node and supplies the **entire** evidence array. The evidence predicate (repo-substrate L228–281, L955–987) checks coverage-by-binding, kind-match, freshness, refResolvable, no-double-count, empty-req floor — and `producedBy` **only** for `review`-kind evidence (and only that it resolves to *a* `role=verifier`, never a **distinct-count** or **non-architect** constraint). `adjudicate` as specified produces `ev_ranked_slate`·**doc** — and `doc`-kind evidence has **no `producedBy` check at all** (it is optional, L668; unused by the predicate). So a single engineer holding the `adjudicate` lease can complete it alone, self-attesting `producedBy` to anyone (or no one). "≥2 evidence bindings with distinct `producedBy`, neither the architect … makes solo-completion physically impossible" is contradicted by the shipped predicate; the "G3 tri-seat kill reused" citation has no enforcing mechanism in the repo (grep: no distinct/count/≥2 producer logic exists). **Fix:** either (a) re-shape `adjudicate` into ≥2 *separate* verifier-gate/review nodes each completed by a *different* registered agent (genuine multi-agent is multi-**node**, never multi-producer-on-one-node), or (b) demote B2 to a **post-hoc `verify_ranking` re-check** (which §6.3 C4 already half-does) and **delete every "mechanically/structurally enforced" claim** about it. FM-2's defense is currently paper.

**G2 — Roster cardinality (1 architect / 1 engineer / 1 verifier) defeats the integrity splits — and the verifier was *offline* the entire prior stint.**
The standing roster is lily(architect)/greg(engineer)/steve(verifier) — one agent per role. (i) `adjudicate` `roleEligibility:[engineer,verifier]` is claimed by **one** of greg-or-steve (single lease) — it can never carry "≥2 distinct non-architect producers." (ii) `verify_ranking` `roleEligibility:[verifier]` resolves to **steve**, who is also the only eligible verifier on `adjudicate` — so "verifier ≠ adjudicator" (FM-11) is **unenforceable** with one verifier. (iii) Worse for the run-path: the stint-5 retro records *"the verifier (steve) was offline for the stint,"* with verification done by **architect-spawned adversarial-verify sub-agents** — those sub-agents are **not registered `role=verifier` Agents**, so they **cannot** satisfy the `review`→`role=verifier` check on `pack_gate` / `verify_ranking` (the predicate resolves the *registry* role, L979–981). If steve is offline, the graph **stalls at `pack_gate`** (the first verifier-gate) and the architect's workaround is contract-rejected. **Fix:** state the live-roster precondition explicitly (steve MUST be online for the whole run), and redefine the multi-agent floor as "≥2 distinct producing **nodes** across the engineer+verifier seats" (which `score_*`/`clash_*`/`rescore_*` already give) rather than ≥2 producers on `adjudicate`; or stand up a second verifier-role agent.

**G3 — bug-203 is never named; the run-path is not real for the seeder.**
`seed_blueprint` is **[Architect]-only** (policy L726/L744) → only lily can seed, and lily runs **claude-code**, which per bug-203 does **not** re-enumerate tools on `notifications/tools/list_changed` — the stint-5 retro states lily's + greg's sessions are *currently stale on `seed_blueprint` itself*. Phase 2 ("ADAPTER-REALISE … rebuild + redeploy the adapter so the verbs are callable") is **wrong about the failure layer**: bug-203 is **host-side**, not adapter-side; redeploying `@apnex/network-adapter` does **not** make the verb reachable to the *running* claude-code session. The only known break-glass is `rm tool-catalog.json` + **full client restart** — which kills the live autonomous session and collides head-on with the extended-run "never idle / never stop until Director returns" mandate (and with any held-heartbeat). The sibling DRAFT (`m-director-reacquaintance-journey-design`) already flagged this exact trap; this doc inherits it and **does not mention bug-203 once**. **Fix:** name bug-203 and commit Phase 2 to a concrete seed channel — either an explicit "lily restarts claude-code after the redeploy, re-confirms `seed_blueprint` is enumerable, then seeds" step (accepting session-loss), or a `/mcp-direct` / CLI seed path. As written the run cannot start.

**G4 — "Director-dark mechanically verified" (D3/FM-3) scans the wrong channel and the wrong window.**
(i) **Channel:** the scan reads `list_messages`/`list_threads` (the Hub channel). The Director steers via the **director-chat / ACP** surface, *not* Hub `create_message` — so a real out-of-band steer is **invisible** to the scan. The invariant verifies *Hub-channel* darkness, not darkness. (ii) **Window:** the scan runs `seal-ts → verdict-ts`, but the **highest-leverage contamination is pre-seal** — *which* candidates survive into the 5–8-summit cut at `seal_candidates` is set **before** the seal. A Director (or architect) nudge to the candidate set is outside the window. **Fix:** start the window at `reconcile_anchor`/run-seed (cover the whole intake+cluster), and explicitly **scope** the claim to "no Hub-channel steer detected" with a stated, acknowledged gap on out-of-band channels (or wire the chat-surface transcript into the scan).

### NON-GATING (should-fix)
- **N1 — blinding (A2/`candidate_K`) is a documentary convention, not a Hub mechanism.** There is no substrate primitive that hides authorship; it relies on agents not reading the sealed sidecar. The architect *authored the whole evidence enumeration + candidate schema* and then **scores exactly D1/D2/D3** — the three dimensions where the D-3/observability PUSH prior lives. An LLM architect can infer `candidate_K`. State plainly that blinding is soft, and consider cross-checking D1–D3 (e.g. a non-architect re-scores tele-fit blind) rather than relying on a sidecar discipline.
- **N2 — §5.2 overstates git-ref resolvability.** A `storage:git, required:true` ref is **format-validated only** (`PINNED_GIT_REF` regex) — the Hub is git-less and **cannot confirm the path exists** at that sha (L292–293). "fail-closed resolvable at seed-time" is true for `entity`/`hub-doc`/`inline` but **not** for `git`: a hallucinated `00f97c6…:docs/wrong/path.md` passes the seed. Soften the claim.
- **N3 — total-order defensibility is "reproducible," not "objective."** The composite (`Σ weight·score /105`) is a weighted sum of **single-agent ordinal 1–5 judgements** treated as cardinal; the order is recomputable but the inputs are one-seat opinions (the doc's own signal≠judgement). Also the ε=3 "near-tie" ladder applied pairwise can be **non-transitive** across a 3-candidate chain; the `lower-id` final rung saves well-definedness but state the convention. Point (4) passes on *total-order existence + determinism*, not on objectivity.
- **N4 — input completeness gap: Threads/Clarifications.** `strategic-review.md` sub-step 5 names *thread-roundCount-near-limit* as a core friction signal, but §3.2's 14 families use threads **only** for the D3 Director-dark scan, not as a friction source; `Clarification` (a first-class kind) is absent entirely. Add thread-density + open-clarification as friction-context families or justify the omission.
- **N5 — the 13-node "minimal-valid" compresses more integrity than claimed.** Folding `clash_*`+`rescore_*` into one `deliberate_*` means the cross-assigned adversary attack **and** the rescore are produced by the **same single lease-holder in one node** — the seal-before-reveal *ordering* (B4, called load-bearing) is partly traded, as the doc admits, but the doc still lists the 13-node as retaining "every integrity-critical split." Be precise: it keeps the *scoring* split, not the clash↔rescore separation.

### Hammer scorecard
1. **Self-determining + neutral?** *Partially.* Architect excluded from `adjudicate` (good intent) but the exclusion + two-producer floor are **not contract-enforced** (G1/G2); blinding is soft (N1); architect still scores the prior-laden D1–D3 and authors the enumeration. Neutral *by discipline*, not *by construction* as claimed.
2. **Buildable on the REAL node-contract?** *Structurally yes (graph validates), but the integrity invariants are not buildable as stated* — G1 (no distinct-producer enforcement), G2 (roster + offline-verifier blocks verifier-gates).
3. **Input-gathering complete?** *Nearly* — strong exhaustive-by-construction pack; missing Threads-as-friction + Clarifications (N4).
4. **Defensible total order?** *Yes, well-defined + deterministic* (tie-break ladder → lower-id); but "defensible" = reproducible-from-scorecard, not objective; ε near-tie non-transitivity nit (N3).
5. **Adapter / bug-203 run-path real?** *No* — G3: seeder session is host-stale on `seed_blueprint`; Phase 2 misattributes the fix to the adapter; no restart/CLI seed path committed.
6. **Invalidating failure modes?** G1 (paper two-producer floor), G2 (offline/single verifier stalls the gate + collapses verify≠adjudicator), G3 (cannot seed), G4 (Director-dark scans wrong channel+window). Each can flip the run's VALID verdict to a false-positive.

**Gating set to clear before build: G1, G2, G3, G4.** Recommend folding N1–N5 in the same pass.
