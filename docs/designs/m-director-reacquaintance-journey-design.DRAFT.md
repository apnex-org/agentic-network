# Design — The Director-Reacquaintance Journey (DRJ)

**Author:** lily (architect) · **Status:** v1.0 integrated design (council pre-read → Director ratify)
**Mission home:** mission-96 (M-Stint-Lifecycle, stint-5) · **Class:** coordination-primitive / observability surface
**Evolves:** idea-368 (M-Stint-Close-Packet) + idea-369 (M-Stint-Report-Schema) — both OPEN
**Lifecycle slot:** the close-out protocol **gate G6** (Director walkthrough; RACI = Lily-guides / Director-ratifies)
**Honors:** the three ratified Director intents (HYBRID mechanization · altitude-DESCENDING spine · tight-exec-top that EXPANDS) + the stint-5 ratified forks **T1** (non-platform blueprint) and **T2** (no new entity kind)

> **Integration note.** This document grafts three component designs into one buildable spec.
> Component 1 contributes the mechanized **fact backbone** (the arc spine, the NEW-vs-PROJECTION ledger, the JSONB queries). Component 2 contributes the **anti-drift fact-binding contract**, the uniform `JourneyNode` model, and the three-medium delivery surface. Component 3 contributes the **close-out `seed_blueprint` gate-DAG**, the assemble-dark/deliver-on-return lifecycle, and the value-not-activity lens. Conflicts (verb names, altitude count) are resolved explicitly in §2 and §3.

---

## 1. Intent + tele-fit

### 1.1 What this is, in one paragraph

idea-368 today emits a **flat** close-packet — literally the stint-5 retro §5 "Decision-queue for the Director's return." That list answers *"what must the Director decide"* but not *"where is the org, why did it move there, and what is each decision for."* The Director's revealed mode is **active-delegator-who-invests-in-the-machine**: they want the **gestalt + the one honest asymmetry** at the top, and the ability to **drill any layer on demand** — not a permission crawl, not a verb-dump. The Director-Reacquaintance Journey is the **evolution of idea-368 from a flat decision-packet into a guided, altitude-descending walkthrough**, with idea-369 absorbed as its value-classifying fact-source. It is delivered as the **G6** gate of the close-out protocol, **pre-assembled in the dark run and delivered on Director-return**, and its terminal tier **is** the autonomy-charter batch-ratify surface.

### 1.2 The single design move

**Separate the FACTS (Hub-generated, ground-truthed, re-runnable) from the MEANING (architect-narrated judgment), and bind them at every tier with a fail-closed contract.** Neither alone satisfies the Director: fully-auto is cold and value-blind; hand-curated drifts and doesn't scale. The hybrid is the structural defense against the two failure modes the Director named — **drift** (facts regenerated from the ledger each close, never recalled — the same defeat-LLM-state-fidelity rationale CLAUDE.md applies to the calibration ledger) and **cold** (the architect supplies the verdict/why/recommendation a generator cannot).

### 1.3 The three ratified constraints → mechanism

| Constraint | How this design honors it |
|---|---|
| **1. HYBRID** (Hub self-generates facts; architect narrates) | Two read-projection verbs emit a provenance-stamped **Stint Fact Bundle (SFB)**; the architect authors a thin **narration overlay** that *references facts by id, never copies their values*. The hybrid line is drawn **at the field level** (§4.2 per-tier split) and enforced by the **fact-binding validator** (§4.3). |
| **2. SPINE = altitude-descending** | A `JourneyNode` tree: **L0 roadmap-position → L1 arcs → L2 missions/outcomes/value → L3 decisions**, with **Evidence** as a universal drill-to-ground-truth anchor under any node. Drilling = one altitude step (§2). |
| **3. DEPTH = tight top, expands on pick** | L0 is one scannable screen (verdict + one asymmetry over four generated lines); everything below L1 is collapsed; full depth is exactly one expand away, rendered on demand never pre-rendered to every leaf (§3). |

### 1.4 Tele-fit

- **tele-13 (amplify Director attention):** facts computed not archaeologized; one-screen L0; depth on demand. The whole point.
- **tele-0 / A0 (Director terminal understanding + intent):** the narrated verdict + per-aspect "so what" + recommendation is what a generator can't supply; the journey carries *understanding*, not a dump.
- **tele-1 / A1 (one source of truth, transparency):** facts regenerated from the ledger + roadmap each close; narration holds *no free-standing values* (only `{{fact-id}}` substitutions); a stale claim **fails the render** rather than shipping.
- **tele-4 / A4 / tele-7 / A7 (nothing silent):** director-gate items missing `{context, recommendation, priority}` fail loud; deferrals surfaced with owner + revivalTrigger; the asymmetry stated, never hidden.
- **tele-2 / A2 (spec-as-substrate):** the report schema + arc registry **are** the spec (declarative data, not prose).
- **tele-10 / A10 (autopoietic):** calibrations surfaced as value; the close-out blueprint mechanizes its own G6.
- **No tele contradicted.** Net-positive on tele-13 / tele-0 / tele-4.

### 1.5 Evolution of the prior art (what each idea BECOMES)

| Prior art | Becomes |
|---|---|
| **idea-368** (M-Stint-Close-Packet — flat decision-surface) | The **L3 terminal tier** + the `assemble_close_packet` verb. Two evolutions: (a) "the whole artifact" → "the terminal tier of a four-altitude journey"; (b) "read-only packet" → **actionable batch-ratify surface** (§4.4). |
| **idea-369** (M-Stint-Report-Schema) | The `emit_stint_report` **value-classifier cross-cut** feeding the L1 generative-health rollup *and* the L2 per-item value lens (the schema deliberately spans two altitudes). Hybrid emit: Hub auto-populates derived cells + emits a shell; architect fills judgment cells. **Absorbs idea-367** (generative-health-telemetry). |
| **idea-367** (generative-health-telemetry) | Subsumed into the `emit_stint_report` per-stint rollup. |
| **close-out protocol G6** (Director walkthrough) | The **narration layer + delivery surface**, now standing on mechanized facts instead of hand-archaeology; a Director-steered descent rather than a linear crawl. |
| **autonomy-charter §4 Director-return** | Projected into L3 as the `drBatch` ratify queue; the journey **is** the return-ratification mechanism, not a precursor to it. |
| **work-94 cold-start spine** (`get_current_stint` / `legal_moves` / non-dark digest) | **Reused wholesale**; the DRJ is its Director-altitude generalization — `get_current_stint` projected up the org-tree to the Director's seat. |

---

## 2. The journey shape — altitude-descending spine

### 2.1 The spine (resolving the layer-count conflict)

Component 2 proposed six strata (L0–L5); Components 1 & 3 proposed four (L0–L3). **Resolution: four primary altitudes as the executive default, with Evidence as a universal cross-cut.** Component 2's separate "L3 outcomes" collapses into L2 (Components 1 & 3 both put value/outcomes at L2); Component 2's "L5 evidence" becomes the **Evidence anchor** reachable from *any* node via fact-provenance pointers (which makes evidence free — a fact *is* its own drill-to-evidence handle).

```
L0  ROADMAP POSITION  — "where are we, what's the headline?"   verdict + the one honest asymmetry      [1 screen]
L1  ARCS              — "which arcs moved, and how?"           per-arc through-line + summit-stake read
L2  MISSIONS/OUTCOMES — "what VALUE shipped (not activity)?"   four value lenses + per-item "so what"
L3  DECISIONS         — "what must you decide?"                idea-368 surface + recommendation/sequencing
 └─ EVIDENCE (from any node) — PR+SHA · audit-id · entity · test result · calibration   (pure ground-truth)
```

The Director enters at L0 and drills any node one altitude down, or jumps to Evidence from anywhere. The drill path `roadmap → arc → mission → outcome → evidence` is constraint 2 exactly.

### 2.2 The uniform node model (Component 2, grafted)

Every node — at any altitude — is the same shape, so **one composer and three renderers handle the whole tree**:

```
JourneyNode {
  address       // stable, deep-linkable: e.g. "C1.mission-96.O-S2" or "D2"
  altitude      // L0..L3
  title         // executive one-liner (the scannable top)
  narrationRef  // -> Layer-B narration-node (gestalt / why / judgment / connective tissue)
  factRefs[]    // -> Layer-A SFB facts (values + provenance)
  children[]    // next-altitude-down nodes (the "expand" target)
  evidence[]    // ground-truth facts reachable directly (the "drill to evidence" target)
  action?       // for L3 nodes: { verb, target } (ratify / authorize / disposition)
}
```

`expand(node)` returns `node.children` (descend one altitude). `evidence(node)` returns `node.evidence` (jump to ground truth). One tree, no content forks, no inter-medium drift.

### 2.3 Verb → tier mapping (resolved naming)

Conflicting names across components resolved to one descriptive, posture-clear set (`emit_*`/`assemble_*` for the fact verbs; a `journey_*` family for delivery):

| Tier | FACT source (Hub-generated) | NARRATION adds (architect) | Drill-into |
|---|---|---|---|
| **L0** roadmap-position | `get_org_state` (roadmap header + arc-row deltas + `emit_stint_report.rollup` top-line) | the **verdict** + the **one honest asymmetry** | → L1 |
| **L1** arcs | `get_arc <arcId>` (registry row ⋈ missions ⋈ WorkItem rollup ⋈ per-arc `get_current_stint`) | per-arc "so what" + the **summit-stake / staking-decay read** | → L2 |
| **L2** missions/outcomes/value | `emit_stint_report.perItem` grouped by nature/payoff (idea-369) + `get_mission_outcomes` projection | "why it matters" — turns a primitive into a *capability* | → entity reads / Evidence |
| **L3** decisions | `assemble_close_packet` (idea-368: director-WorkItems + DR-batch + curation set + next-FOCUS + Survey shortlist) | the **recommendation + sequencing** on each | → ratify / `get_work` |
| **Evidence** | fact-provenance pointers (PR/audit/entity/git/test/calibration) | (none — pure ground-truth) | (anchor) |

`get_org_state` (L0) and `get_arc` (L1) are the **fact-producers** the journey composer calls; the **delivery API** is the `journey_*` family (§4.5). Both are pure read-projections — no new state, no write-cascade (the bug-31/137 class).

### 2.4 Worked stint-5 example walkthrough

**Trigger:** the dark run reaches close-out; `seed_blueprint({runId:"closeout-stint-5"})` expands the §5 DAG; `emit_stint_report` + `assemble_close_packet` run; the `walkthrough` node goes ready-**held** on the stint anchor (work-72 class); the Director returns and signals.

**L0 (the one screen, delivered):**
```
STINT-5 CLOSE — Director Reacquaintance                       [prod 5c64f58 · adapter@0.1.4]
──────────────────────────────────────────────────────────────────────────────────────────
VERDICT:   STAKE CONVERTED — after two banked stints, the autonomous-stint lifecycle is now   ← narrated
           SUBSTRATE, not prose: dogfooded + live on main.
ASYMMETRY: live-surface close-out dogfood bounded by bug-203 (host non-re-enumeration) —       ← narrated
           lifecycle self-hosts for AUTHORING; asterisked for the live host hop.
BALANCE:   1 stake + 2 sub-stakes converted (FOCUS, velocity, FR-34); 0 NEW summits staked     ← generated
           → staking-decay clock STILL RUNS into stint-6.
GEN:INCORP <n>:<m>   TELE-GAPS <teles with zero forward generation>                             ← generated
──────────────────────────────────────────────────────────────────────────────────────────
DRILL: [1] arcs   [2] value   [3] decisions       or name any aspect ("expand C2")
```
Two narrated lines over four generated lines — the hybrid in miniature.

**Director: "[1] arcs"** → **L1** (generated deltas + narrated read):
- **M-Stint-Lifecycle (mission-96) FOCUS arc — DONE.** S0/S1/S2/S3 shipped (#416–#424).
- **C1 work-control-plane** — gained `seed_blueprint` + node-contract (`references`/`runbook`/`completionDependsOn`) + cold-start spine; banked, highest in-degree.
- **Arc-A observability (dark)** — minimal-cut PUSH hints staged; full idea-357 → stint-6, gated on bug-190 (deferred, owned).
- **Arc-B PR/event/orchestration (dark)** — merge-queue regime processed the #416–#424 train.
- **Arc-C cleanup (dark, continuous)** — reconcile → bug-202; bug-180 resolved + bug-203 filed.
- *Narrated:* "the FOCUS arc reset the decay clock for one stint; **C2 / D-1 summits remain un-staked** — stint-6 must stake a summit."

**Director: "[2] value"** → **L2** (classified by the four value lenses, §4.2):
- **PRIMITIVES (banked):** `seed_blueprint`, the `references` first-class field, `get_current_stint`, `get_next`-enriched non-dark digest, `legal_moves`, the arc-node `completionDependsOn` gate, `calibrations.py add/validate`. *(tele-2, tele-5, tele-13)*
- **OUTCOMES (staked→converted):** FOCUS done; **FR-34 mechanically killed** (G4 + write-verb); velocity floor live. *(tele-13, tele-9)*
- **CALIBRATIONS:** #95–#103 (cross-lineage-cutover · mutation-pin · stale-main-reconcile · verifier-offline contract · …). *(tele-10)*
- **DEFERRALS (parked-with-trigger):** idea-356 pt2 · idea-357 full PUSH→stint-6 (bug-190) · idea-381 429-backoff→stint-6 · heavy Stint FSM. *(tele-7 — no silent failure)*

**Director: "why deferred idea-357?"** → drill to entity + design §0.5: *minimal-cut PUSH ships as non-authoritative hints over an always-correct pull; full PUSH gated on bug-190 cursor-safety, owned not silently named.* (Live `get_idea` — full depth, one step away.)

**Director: "[3] decisions"** → **L3** (close-packet + DR-batch, narrated recommendations):
1. **RATIFY the stint-5 close** (work-72 "Director-signalled" gate). *Rec: ratify — all slices complete + verified.*
2. **AUTHORIZE bulk-close** of 8 superseded PRs (permission classifier correctly blocked autonomous bulk-close). *Rec: 1-line authorize.*
3. **HOLD-cluster:** #327 vision-synth · #328–331 CDACC P10 · #332 tele-13 constitution · #344 Task-Dispatch charter · #393 C2 Survey. *Rec: split ratify-now vs charter-as-mission.*
4. **CURATE** calibrations #95–#103 (architect already filed per relaxed gate; Director curates).
5. **CONFIRM** next-FOCUS — *Rec: stake a summit (C2 Survey / D-1 R1 / Arc-A full PUSH); the decay clock demands it.*
+ **batch-ratify** the `proposed` DR-ledger.

Director ratifies the small set → the walkthrough's evidence resolves → **G7 `anchor_close`** completes work-72 → stint-5 closed → `roadmap.md` refreshed by the same blueprint's `route_homes` node.

---

## 3. The DEPTH affordance — tight top that expands

### 3.1 What the Director sees first

The top is **L0 + a one-line-per-arc L1 + the small ratification set** (close-out protocol §4: a SMALL explicit decision set, ~2–3, never a step-by-step crawl). Everything below L1 is collapsed; full depth is **rendered on demand**, never pre-rendered to every leaf. Each drill is served by a live read-verb (`get_arc`, `get_mission_outcomes`, `get_idea/bug/work`, `legal_moves`, `assemble_close_packet`).

### 3.2 The three media (one tree, three renderers)

- **Live guided session (PRIMARY — the G6 walkthrough).** The architect holds the map and IS the expand engine; the Director converses (*"expand C1" / "drill mission-96 outcomes" / "show evidence for the velocity claim"*) and the architect narrates the Layer-B gestalt/why on the way down. Converts the linear crawl into a Director-steered descent.
- **Rendered doc (durable / async).** Collapsible markdown (`<details>` per node, or a stable drill-index where each node prints its `address` + an `expand: §C1.mission-96` pointer). Deep-linkable; survives the session (peer to the retro doc).
- **Hub-queryable surface (re-queryable any time).** The `journey_*` verb family (§4.5) — each call is exactly one altitude step.

All three are renderers over one `JourneyNode` tree — no content forks, no drift.

---

## 4. Mechanized backbone + narration (the buildable substrate spec)

### 4.1 The fact substrate — two read-projection verbs → one SFB

Both verbs are **non-mutating projections** over the ledger (consistent with the shipped `get_current_stint` / `legal_moves` posture), emitting into one **Stint Fact Bundle (SFB)** — an on-demand projection optionally frozen as a Hub **Document** at a **watermark** (so the walkthrough node consumes it via `references: {storage: "hub-doc"}` — cold-start-safe, re-runnable, never a dangling path). **No new entity kind** (honors T2).

**Every fact carries a provenance pointer** — `{factId, value, source: {kind: pr|audit|entity|git|calibration|test, ref}}`. This is what makes the Evidence anchor free.

#### 4.1.1 `assemble_close_packet` (idea-368) — the DECISION-surface assembler

```
assemble_close_packet({ anchorWorkId }) -> ClosePacket
{
  decisions: [{ workId, context, recommendation, priority }],   // list_work(role=director, phase!=done)
                                                                //   VALIDATED — fail-loud if any field missing
  drBatch:            [ ...proposed DRs ],                       // autonomy-charter §4 in-flight, status=proposed
  calibrationCuration:[ { id:"#95", class, suggestedAction } ],  // filed this stint; Director CURATES (≠ gates filing)
  nextFocus:          { candidate, rationale, summitsStaked },   // ranked from emit_stint_report.rollup + decay clock
  surveyShortlist:    [ top-ranked next-arc Survey picks ],
  hygieneCluster:     [ ... ]
}
```
Director-gate gather (the JSONB query — `roleEligibility ∋ 'director'` is GIN-indexed):
```sql
SELECT id, data FROM entities
WHERE kind='WorkItem'
  AND data->'spec'->'roleEligibility' ? 'director'
  AND data->'status'->>'phase' <> 'done';
```
**Validation step (idea-368 core):** each director-gate item must carry `{context, recommendation, priority}`; a missing field **fails loud**, never silently drops (tele-4).

#### 4.1.2 `emit_stint_report` (idea-369) — the VALUE-classifier

Reads every item *generated* in the stint window (Ideas / Bugs / Frictions / Calibrations since the anchor's `createdAt`, plus shipped WorkItems + merged PRs), classifies each, rolls up:
```
emit_stint_report({ anchorWorkId }) -> StintReport
perItem: [{
  ref, type,                       // DERIVED (entity kind)
  originMechanism,                 // ANNOTATED (seed from tags): reconcile | autopoietic-audit |
                                   //   verifier-finding | friction | execution-followon | brainstorm | survey | director-lodged
  teleVector: { primary, secondary, strength },  // HYBRID (tele-N tags DERIVED; strength ANNOTATED)
  nature,                          // ANNOTATED: corrective | inward-engine | observability-control-plane | forward-feature
  arcRung: { arc, rung } | "UNMAPPED",           // DERIVED via arcId (§4.6)
  forwardInvestment: { edges[], score },         // ANNOTATED (in-degree × summit-value)
  disposition,                     // HYBRID: staked | banked | incorporated(⇐missionId) | parked-with-trigger | dropped(⇐abandoned)
  valueEffortLeverage              // ANNOTATED
}]
rollup: {                          // ALL auto-computed from the per-item table
  genIncorpRatio,                  // count(generated) : count(incorporated)
  teleDistribution, teleCoverageGaps,  // teles with ZERO forward generation — a headline finding
  natureSplitPct, arcCoverage, bankedRungInventory,
  stakedVsBankedBalance            // the staking-decay read
}
```
The schema is a checked-in JSON-schema (classification is **data, not prose** — the calibration-ledger precedent). Persisted as a generated VIEW (`docs/reports/stint-N-report.yaml` or a Hub Document) — **not** a new kind.

### 4.2 The hybrid split, per tier (generated ⊕ narrated)

| Tier | GENERATED (Hub self-emits, ground-truthed) | NARRATED (architect judgment, non-fabricable) |
|---|---|---|
| **L0** | prod SHA, arc-row deltas, staked/banked balance, gen:incorp, tele-gaps | the **verdict**, the **one honest asymmetry** |
| **L1** | per-arc status delta, banked-rung inventory, completion projections | per-arc "so what", the **summit-stake / decay read** |
| **L2** | every item classified by nature/payoff/tele/disposition (four value lenses) | "why it matters" — the framing that turns a primitive into a *capability* |
| **L3** | director-WorkItem gather, DR-batch, next-arc Survey shortlist | the **recommendation + sequencing** on each decision |
| **Evidence** | PR/audit/entity/git/test/calibration provenance | (none) |

**The four L2 value lenses (value, not activity — the DRJ never shows "9 PRs merged"):**
1. **PRIMITIVES shipped** (`nature: inward-engine | observability-control-plane`) — the substrate the org gained; reframed as what it now makes *possible*.
2. **OUTCOMES / stakes converted** (`payoff: staked → converted`) — the bets that cashed; the headline value.
3. **CALIBRATIONS** — the org's distilled pathology-defenses; value because they are how the org *doesn't repeat itself* (tele-10).
4. **DEFERRALS** (`disposition: parked-with-trigger`) — honest banking, each with `owner + revivalTrigger` (tele-7).

### 4.3 The fact-binding contract (the no-drift mechanism — Component 2, grafted)

This is the load-bearing anti-drift mechanism. It reuses the **references-resolvability** discipline shipped in `seed_blueprint` (every reference must resolve, fail-closed at seed-time), applied to the journey:

- **Facts are ground-truth + immutable within a watermark.** Re-running a verb produces a new snapshot, never mutates the old.
- **Narration holds no free-standing values** — only prose + `{{factId}}` substitutions + a `factRefs[]` list. Where a sentence must quote a number, it quotes `{{factId}}` and the renderer substitutes the live value. The narration owns *prose + pointers*; the SFB owns *values*. One datum, one source.
- **Compose-time validator (fail-closed):** for every narration-node, every `factRef` and `{{factId}}` MUST resolve in the current SFB snapshot; an unresolved reference **fails the render loud** (tele-4) rather than shipping a stale narrative. A narration written against last stint's facts cannot silently survive into this stint's journey. The validator also **diffs**: any value the narration asserts must equal its source fact, so drift becomes a build error, not a Director-facing lie.

Net: every claim in the guide is anchored to a ground-truth fact one click away, because the substrate refuses to render otherwise.

### 4.4 Actionable L3 — the ratification loop (closes idea-368's purpose)

idea-368's point was a *decision-surface*, not a read-only report. L3 nodes carry an `action`, so ratifying **inside** the journey closes the loop to the Hub — the autonomy-charter §4 Director-return made first-class:
- `journey_ratify D1` → `complete_work(work-72)` with evidence "Director-signalled" (the held close-gate).
- `journey_ratify D2 authorize` → unblocks the classifier-blocked bulk-close.
- `journey_ratify D3.<item> <disposition>` → batch-acks/dispositions the HOLD-cluster.
- **Batch mode** `journey_ratify --all-recommended` accepts the architect's recommended set for genuinely-indifferent items in one stroke, surfacing only the reserved hard-lines individually (minimize operator touches; surface-don't-pre-empt reserved gates).

The journey thus **is** the return-ratification mechanism.

### 4.5 The delivery API

```
get_journey <stintId>            -> L0 + L1 executive top (the one screen)
journey_expand <address>         -> that node's children (one altitude down; dispatches to get_arc /
                                    get_mission_outcomes / assemble_close_packet by address altitude)
journey_evidence <address>       -> that node's ground-truth provenance facts
journey_ratify <address> [decision]  -> executes the L3 node's action (§4.4)
```

### 4.6 The arc spine — the one genuinely-new durable artifact (Component 1, grafted)

L0/L1 must be **computed facts**, not narrated-from-memory, or roadmap prose silently drifts from ground truth. Today arcs (C1–C4, D-1/2/3) live ONLY in `roadmap.md` prose + `docs/designs/<arc>-arc-design.md`, are **not queryable**, and **Mission has no `arcId`**. So the spine needs exactly two cheap additions:

1. **Arc registry — thin declarative YAML** `docs/arcs/registry.yaml` (peer to `calibrations.yaml` + `entity-kinds.json`; parsed by an `arcs.py` projector cloned from `calibrations.py`). ~7 rows. **NOT a 25th Hub kind** (refusing a second state machine is the T2/bug-137 discipline this mission ratified):
   ```yaml
   arcs:
     - id: C1
       title: Sovereign Work-Control Plane
       status: green            # green|yellow|red — curated; cross-checked vs projected progress, divergence surfaced
       summit: S-Org-Observability
       teles: [tele-13, tele-1]
       designRef: docs/designs/c1-*-arc-design.md
   ```
2. **`arcId` label on Mission / Idea / Bug spec** — the rollup FK; a single nullable top-level spec string, **default-partitioned (no renameMap entry)** → a cheap additive envelope migration. WorkItem already has `arcId` (GIN-indexed). Set at `create_mission` (new optional arg) going forward; a one-time reconcile pass infers arcId from existing description prose (the live "FOCUS C2 / D-1" convention) for legacy rows.

`get_arc` then projects (registry row) ⋈ (Missions WHERE `arcId=$1`) ⋈ (WorkItem completion rollup) ⋈ (decisions tagged to the arc); `get_org_state` rolls all arcs into the L0 screen. Per-arc rollup query:
```sql
SELECT count(*) FILTER (WHERE data->'status'->>'phase'='done') AS done, count(*) AS total
FROM entities WHERE kind='WorkItem' AND data->'spec'->>'arcId' = $1;
```
**Revival trigger** to promote the registry to a Hub `ArcManifest` kind: an arc needs an FSM or cross-cutting writes not derivable from its missions (today it does not).

### 4.7 NEW vs PROJECTION — the decisive ledger

| Element | NEW or PROJECTION | Justification |
|---|---|---|
| Arc registry (`docs/arcs/registry.yaml` + `arcs.py`) | **NEW — thin declarative, NOT a Hub kind** | Arc identity is durable cross-cutting state not derivable from missions; checked-in YAML avoids a 25th kind / 2nd FSM (T2). |
| `arcId` on Mission/Idea/Bug | **NEW — one nullable spec field** | Cheap additive envelope migration (default-partitioned, no renameMap); WorkItem already has it. |
| `assemble_close_packet` (idea-368) | **NEW verb, projection-backed** | Gathers director-gates + DR-ledger + curation set; no new state. |
| `emit_stint_report` + schema (idea-369) | **NEW verb + codified schema; emits a VIEW** | Schema is data; shell auto-generated, judgment cells annotated. |
| `get_org_state` (L0), `get_arc` (L1) | **NEW verbs, PURE projection** | Rollups over registry ⋈ Mission ⋈ WorkItem. |
| `get_mission_outcomes` (L2) | **PROJECTION — reuse `StintProjection`** | Re-point the live work-94 projection at a mission's work subtree. |
| Director-gate gather, completion rollups, legal-moves, non-dark empties | **PROJECTION — already built (work-94)** | `StintProjection` / `LegalMoves` / `ReadyEmptyReason` ship today. |
| `journey_*` delivery family + JourneyNode composer + fact-binding validator | **NEW — composition layer** | One composer + three renderers; validator reuses references-resolvability. |
| DR-ledger, calibrations.yaml, roadmap.md | **PROJECTION over existing markdown ledgers** | Parsers read them; markdown stays source-of-truth (the hybrid line). |

**Net new substrate:** one thin YAML registry + one label field + two analytic/decision verbs + two pure-projection rollup verbs + one composition layer (composer + validator + renderers). **No new Hub kind, no second state machine, nothing un-buildable on postgres/JSONB/work-queue today.**

---

## 5. Lifecycle — how it's produced / triggered

The DRJ is the **realization of close-out gate G6**, produced by the **close-out blueprint** — the *second* instance of the stint-5 `seed_blueprint` primitive (the council blueprint was the first).

### 5.1 The close-out blueprint as a `seed_blueprint` gate-DAG (Component 3, grafted)

`seed_blueprint({ runId:"closeout-stint-5", nodes:[...] })` — validated whole-graph fail-closed, idempotent (`work-bp-closeout-stint-5-{localId}`). Nodes map G1→G7 onto the shipped node-contract (`dependsOn` START-gate · `completionDependsOn` COMPLETION-gate / arc-node · `references` consume-set · `evidenceRequirements` anti-gameability · `runbook` cold-start):

```
localId          type       gate   dependsOn                       runbook / evidence
─────────────────────────────────────────────────────────────────────────────────────────────
harvest          freeform   —      —                               fan-out readers → findings doc
report_emit      freeform   G1*    harvest                         runbook: emit_stint_report → Doc   (idea-369)
synthesize       task       G1     harvest, report_emit            retro doc
critic           freeform   G2     synthesize                      adversarial gap-list doc
verify_persist   task       G1/G2  critic                          ground-truth-before-persist → Verification Log
intake_eng       review     G3     synthesize                      engineer first-person intake (review-kind ev.)
intake_ver       review     G3     synthesize                      verifier intake (review-kind ev.)
calib_file       task       G4     verify_persist                  calibrations.py add+validate → filing PR merged
route_homes      task       G5     verify_persist                  roadmap/director-profile/friction routing
packet_assemble  freeform   —      report_emit                     runbook: assemble_close_packet → Doc (idea-368)
walkthrough      freeform   G6     [synthesize,critic,verify_      THE JOURNEY. references: report Doc + packet
                                    persist,intake_eng,intake_ver,   Doc + roadmap (storage:hub-doc/git).
                                    calib_file,route_homes,          HELD for Director-return (§5.2).
                                    packet_assemble]                 evidence: ratification verdicts.
anchor_close     task       G7     completionDependsOn:            complete_work the stint anchor (work-72 class)
                                    [walkthrough]                    — arc-node gate; the self-drive heartbeat ends here.
```

The DRJ **is** the `walkthrough` (G6) node's deliverable: its `references` are the two generated Documents (report + packet) plus the roadmap — all resolvable, cold-start-safe; its `evidenceRequirements` are the Director ratification verdicts. `anchor_close` (G7) uses the shipped arc-node `completionDependsOn` gate so the stint **cannot close until the walkthrough completes** — one enforced close path, no parallel prose close. This makes G6 a *mechanized, dogfooded* gate and proves `seed_blueprint` on its second close-out instance.

### 5.2 Trigger-on-return (assemble-dark, deliver-on-return)

The dark run drives `harvest → … → packet_assemble` **autonomously** — every fact is ground-truthable without the Director (this is *why* the verbs are read-projections). The `walkthrough` node then becomes claimable (all `dependsOn` met) but its **completion is HELD** for the Director-return signal: the architect holds it claimed and **lease-renews it as the work-72 heartbeat** (the operating-model anchor pattern) — exactly the stint-5 retro's live state ("work-72 carries the 'Director-signalled' close-gate; held pending your signal"). On return: deliver L0, drill on demand, ratify → the walkthrough's evidence resolves → `anchor_close` (G7) fires. **No idle:** the dark run continues to the next arc behind the held gate (NO-AGENT-IDLE); the journey is **pre-built, not built-on-arrival** — the Director waits on nothing.

### 5.3 Composition with autonomy-charter batch-ratify

**L3 IS the batch-ratify surface.** The charter (§4) authors DRs autonomously in-flight (`status: proposed`) and gates only the `ratified` status on Director-return. `assemble_close_packet.drBatch` gathers exactly those `proposed` DRs. At the walkthrough, L3 presents **one unified ratification set** = `{ DR-batch + calibration-curation + next-FOCUS confirm + director-gate WorkItems }`, delivered as the G6 small explicit decision-set:
- **(a) curate** the filed calibration set (retire/downgrade/reclass — architect already filed per the relaxed gate; Director curates, does not gate filing);
- **(b) confirm** the next-stint FOCUS (ranked from the decay clock + Survey shortlist);
- **batch-ratify** the `proposed` DRs (flip → `ratified`);
- **clear** the director-gate WorkItems.

### 5.4 Roadmap-anchoring + refresh coupling

L0/L1 are a **diff view**: `roadmap.md` (committed arcs, current-state, the standing dashboard) **vs** the generated this-stint movement (`emit_stint_report.rollup` + per-arc `get_current_stint`). The roadmap is the *standing* answer; the report is the *delta* over it. Because the DRJ's G6 delivery **is** a gate-point, the same close-out blueprint that produces the journey also **refreshes `roadmap.md`** (the `route_homes`/G5 node) — journey and dashboard stay isomorphic.

---

## 6. Build plan

All buildable now (no new kind; the only migration is one additive default-partitioned field). Slices ordered by dependency then value; the fact substrate is the load-bearing dependency.

| Slice | Scope | Evolves | Effort | Dogfood / value |
|---|---|---|---|---|
| **S0 — Arc spine** | `docs/arcs/registry.yaml` + `arcs.py` projector; add `arcId` to Mission/Idea/Bug spec; reconcile-backfill from description prose | (new — enables computed L0/L1) | **S** | Unblocks L0/L1 rollups; cheapest, independent |
| **S1 — Fact substrate** | `emit_stint_report` (idea-369) + `assemble_close_packet` (idea-368) as read-projections → Hub Documents; provenance-stamped SFB + watermark; director-gate validation fail-loud | **idea-368 → L3 verb; idea-369 → value-classifier** | **M** | THE load-bearing dependency; nothing renders without it. Produces the stint-5 retro §4 + decision-queue |
| **S2 — Journey tree + doc renderer + validator** | `JourneyNode` composer joining SFB + hand-authored narration overlay; collapsible-doc renderer; **fail-closed fact-binding validator** | (new composition layer) | **M** | First medium = durable doc (lowest-risk); delivers the executive-top-that-expands |
| **S3 — Live-session + CLI renderers + L0/L1 producers** | `get_org_state`/`get_arc` (L0/L1 fact-producers); `journey_{get,expand,evidence}` CLI; the live G6 navigable descent | (new) | **S–M** | Dogfood on the live stint-5 G6 walkthrough |
| **S4 — Actionable ratify loop + close-out blueprint** | wire L3 `action` → Hub verbs + `journey_ratify --all-recommended`; seed the §5.1 close-out `seed_blueprint` gate-DAG | **idea-368 → actionable surface** | **M** | Second blueprint instance; dogfoods itself at stint-5 close; closes idea-368's decision-loop |

**Minimal first cut that delivers value:** S0 + S1 + S2 — the Director gets the executive-top-that-expands as a deep-linkable doc backed by ground-truth verbs. The live + actionable layer (S3/S4) follows once the fact/narration split is proven.

**Dogfood gate (substrate-self-dogfood discipline):** the journey is first consumed by **its own stint-5 close-out** — the architect runs S1+S2 (then S3/S4) to guide the Director's actual return, proving the backbone before it becomes a standing G6 surface.

**Discipline guards:** projections are READ-ONLY (no write-cascade — the bug-31/137 class); director-gate items lacking `{context, recommendation, priority}` **fail loud**, never silently drop (tele-4); empties are non-dark (reuse `ReadyEmptyReason`); the arc registry's curated `status` is cross-checked against projected `progress` and divergence is surfaced not hidden (tele-1); narration that references a non-resolving fact **fails the render** (§4.3).

**Explicitly NOT built (honors T2 + ratified deferrals):** no Journey/Stint entity (thin projections + Documents only); no auto-generated prose narration (the meaning stays architect-narrated — the hybrid line); the heavy report *engine* (idea-371) stays banked.

**Key files for the builder:** `hub/src/entities/work-item.ts` (StintProjection/LegalMoves — the projection precedent), `hub/src/entities/mission.ts` (add `arcId`), `hub/src/policy/work-item-policy.ts` (seed_blueprint + completion-gate), `scripts/calibrations/calibrations.py` (projector pattern to clone for `arcs.py`), `scripts/local/get-entities.sh` (JSONB dotted-path queries), `docs/methodology/autonomy-charter.md` §4 (DR-ledger fields), `docs/methodology/autonomous-stint-close-out-protocol.md` §4 (G6 narration format), `docs/designs/m-stint-lifecycle-design.md` (§0.5/§2.2/§2.3 seed_blueprint + references + watermark).

---

## 7. Open questions for the Director

1. **SFB persistence** — pure on-demand projection vs. cached Document snapshot at the watermark. *Recommend:* on-demand projection with an **optional Document freeze** for the durable-doc renderer (no new kind — consistent with the T2 thin-projection ruling).
2. **Narration authoring** — fully architect-hand-authored vs. harvest-sub-agent-drafts-then-architect-owns-judgment. *Recommend:* a sub-agent drafts the connective tissue from the SFB; the architect owns the **gestalt + the one-honest-asymmetry + all judgment** (the irreducibly-architect layer).
3. **Canonical G6 vehicle** — live session vs. doc. *Recommend:* live session **primary** (the conversational descent); the doc is its durable snapshot + async fallback; both from one tree.
4. **Batch-ratify aggressiveness** — how wide should `--all-recommended` reach? *Recommend:* `--all-recommended` for genuinely-indifferent items; hard-lines always surfaced individually.
5. **Arc registry promotion threshold** — confirm the revival trigger (an arc needs an FSM / cross-cutting writes un-derivable from its missions) before any arc becomes a Hub `ArcManifest` kind; YAML now.
6. **arcId legacy backfill** — accept prose-inference reconcile for legacy missions (then enforce at `create_mission`), or backfill manually? *Recommend:* prose-inference reconcile with an architect spot-check pass.

---

## Critique (adversarial feasibility + completeness pass — lily, 2026-06-29)

Ground-truthed against the shipped Hub (`hub/src/entities/work-item.ts`, `hub/src/policy/work-item-policy.ts`, `hub/src/storage-substrate/schemas/all-schemas.ts`), idea-368/369/367, bug-203, work-72, and the close-out protocol. Verdict at the end.

### (a) Honors the 3 ratified picks — YES (all three, cleanly)
- **Altitude-descending:** L0→L1→L2→L3 spine, drill = one altitude, Evidence as a cross-cut anchor. Honored.
- **Hybrid facts+narration:** the FACT/MEANING split is the spine of the design (per-tier §4.2 table + the fail-closed fact-binding validator §4.3). The strongest part of the design.
- **Executive-expandable:** L0 = one screen, everything below collapsed, render-on-demand. Honored.
No pick is gamed or quietly narrowed.

### (b) Buildable on the current Hub — MOSTLY, with one concrete error
**Verified SHIPPED + correctly leveraged:** `seed_blueprint` (work-item-policy.ts), the node-contract (`dependsOn`/`completionDependsOn`/`evidenceRequirements`/`references` with a `storage` discriminator — so `references:{storage:"hub-doc"}` is real), `StintProjection`/`LegalMoves`/`ReadyEmptyReason` (the cold-start spine), the `Document` kind, and — critically — the director-gate query path: `workitem_spec_roleeligibility_gin_idx` is a real GIN index on `spec.roleEligibility`, and the WorkItem renameMap routes `roleEligibility → spec.roleEligibility`, so `assemble_close_packet`'s JSONB gather is buildable and on the correct envelope path (the bug-137 class is avoided here).

**CONCRETE ERROR — the `arcId` claim is false (§4.6 + §4.7 ledger).** The design states "WorkItem already has `arcId` (GIN-indexed)" and bases the L0/L1 **per-arc completion rollup** on `... WHERE kind='WorkItem' AND data->'spec'->>'arcId'=$1`. Ground truth: **WorkItem has NO `spec.arcId` field and no arcId index.** The only `arcId` in the codebase is `StintProjection.arcId` (work-item.ts:39) — a *transient projection field* holding a **blueprint arc-NODE work-id** (e.g. `work-bp-…-arc`), NOT a roadmap arc label (C1/C2/D-1). The L1 rollup is therefore **not buildable as written**. Worse, the design's S0 migration adds arcId only to **Mission/Idea/Bug**, explicitly *omitting WorkItem* on the false premise. Fixing this needs one of: (i) add `arcId` to WorkItem spec too (a 4th-kind migration + a GIN/btree index the plan doesn't budget); or (ii) derive arc-membership **transitively** — but WorkItem has **no `missionId`** (linkage is `targetRef{kind,id}` or a free-floating `payload`; e.g. work-72 itself is freeform → idea-380), so transitive WorkItem→Mission→arc derivation is non-trivial and under-specified. This is the single most load-bearing buildability gap (L0/L1 are the executive top).

### (c) Evolves idea-368/369 cleanly — YES (faithful; watch scope)
`assemble_close_packet` matches idea-368's named fields (director-WorkItems with `{context,recommendation,priority}` validation + next-focus + hygiene + next-arc Survey). `emit_stint_report` matches idea-369's per-item schema + rollup with high fidelity, and the idea-367 absorption restates idea-369's own "ABSORBS idea-367" — consistent, no contradiction. **Scope-watch:** the DRJ adds substantial NEW scope *above* the two ideas (arc registry + arcId migration + JourneyNode composer + 3 renderers + fact-binding validator + a 2nd close-out blueprint). "Evolution" is fair framing, but it is a >2× expansion of idea-368+369; the minimal-cut S0+S1+S2 carve correctly lets the two ideas land first.

### (d) Stint-5 example works end-to-end — PLAUSIBLE, two wiring gaps
Concrete and honest (the L0 ASYMMETRY line itself names bug-203 — good). But:
- **L1 depends on arcId-tagged stint-5 work that does not exist yet** → the first run is gated on the S0 prose-inference backfill having already run over legacy stint-5 work (and per (b), backfilled onto a field WorkItem doesn't have).
- **work-72 ⟷ `anchor_close` wiring is muddy.** §5.2 says the *walkthrough node* is "held + lease-renewed as the work-72 heartbeat"; §5.1 says `anchor_close` (G7) "complete_work the stint anchor (work-72)" via `completionDependsOn:[walkthrough]`. But work-72 is the **pre-existing live anchor** (verified `completionDependsOn:[]`) and is **not a node in the `closeout-stint-5` blueprint** — so `anchor_close` cannot gate-complete it via its own `completionDependsOn`. Closing work-72 requires either *mutating the live anchor* to add `completionDependsOn:[walkthrough]`, or an imperative `complete_work(work-72)` in the runbook (an MCP call → see (g)). The design conflates two distinct items (the new walkthrough node vs work-72) and never disambiguates which one is held and which one closes.

### (e) Build plan realism + slicing — DIRECTION RIGHT, sizing optimistic
Dependency order is correct (fact substrate is load-bearing first; minimal cut = doc). Concerns:
- **S0 is mis-sized "S".** It is a 3–4-kind additive migration + a new `arcs.py` projector + a **prose-inference backfill** (fuzzy/error-prone — inferring C1/C2/D-1 from description text). Realistically **M**.
- **`emit_stint_report` is "mechanized" only at the rollup; the per-item table is half hand-annotated** each close (originMechanism, nature, tele-strength, forwardInvestment, disposition are ANNOTATED, per §4.1.2). This shifts archaeology onto the architect — partially in tension with the tele-13 "compute, don't archaeologize" goal. The rollup is auto; its inputs are not.
- **`emit_stint_report` mixes ledger facts with git facts.** It claims to read "merged PRs" + "shipped WorkItems" — but merged-PR data is **not in postgres**; a JSONB projection can't reach it. The git portion must come from the close-out DAG's `harvest` node, so the verb is **harvest+projection, not the pure read-projection** the design repeatedly asserts. State this honestly or the re-runnable/ground-truth claim over-reaches.
- **MCP-verb vs CLI delivery is unstated** and it materially changes both S3/S4 effort and the bug-203 exposure (see (g)).

### (f) Missing / over-scoped
**Missing:** (1) WorkItem→arc linkage (the (b) gap); (2) the *surface* the verbs ship on (MCP tool vs Bash/psql CLI) — the bug-203-determining decision; (3) git-fact sourcing for `emit_stint_report`; (4) the work-72/`anchor_close` disambiguation; (5) any restart-interposition for the dogfood.
**Over-scoped:** bundling all 5 slices into **mission-96/stint-5 while also dogfooding at stint-5's own close** compresses the schedule to near-impossible — you must build the mechanized G6 surface *during* stint-5 and then *use it to close stint-5*. mission-96/work-72 already carries its own S0–S3 lifecycle slices; DRJ S0–S4 is additive load on the same stint. The live + actionable layers (S3/S4) read as a natural **follow-on mission** (stint-6), with only the CLI/doc authoring path (S0–S2) dogfooded at stint-5 close.

### (g) bug-203 trap — AWARE, but DEPENDS ON THE BLOCKED PATH (unresolved)
The design earns credit for naming bug-203 as the headline L0 asymmetry. **But it does not resolve the dependency, and as written it walks into the trap:**
- The close-out runs **through `seed_blueprint`**, an **MCP verb**. Per bug-203 the running **claude-code architect session cannot re-enumerate tools** on `notifications/tools/list_changed` — this is not hypothetical: bug-203's live evidence is that lily's + greg's sessions are *currently stale on `seed_blueprint` itself* (pre-#417 surface). So the architect cannot drive the close-out blueprint from the live session **without a full restart**.
- The new fact/journey verbs (`emit_stint_report`, `assemble_close_packet`, `get_org_state`, `get_arc`, `journey_*`), **if shipped as MCP verbs**, are equally unreachable to the live G6 consumer until restart. `journey_ratify`→`complete_work` is an MCP call → same block.
- §5.2's **held-heartbeat / never-restart** model *actively preserves* the stale condition — it is in direct tension with the only known bug-203 break-glass (full client restart).

So S4's "dogfoods itself at stint-5 close" is **host-restart-gated**. Two clean resolutions, neither chosen in the doc:
  1. **Ship the fact-producers + journey delivery as Bash/psql CLI** (the *existing* operator-DX precedent: `scripts/local/get-entities.sh`, `scripts/calibrations/calibrations.py`, `scripts/reconciliation/reconcile.py`) so they bypass the MCP tool surface entirely and are reachable from Bash regardless of host enumeration. This is the structurally clean fix and aligns with the "facts are re-runnable projections" framing. **The arc projector (`arcs.py`) is already CLI — extend that posture to the whole fact/delivery layer.**
  2. **Interpose a deliberate cold-start restart** before close-out (natural given the cold-start spine) — but this contradicts the no-restart heartbeat language and must be written in.
The **authoring path** (python projectors emitting markdown Docs) is *unblocked*, so the S0–S2 doc-renderer MVP can genuinely dogfood; the **live G6 + `journey_ratify`** (MCP) cannot until this is resolved. Pick CLI-first delivery and the trap closes.

### Minor / factual
- §5 asserts "the council blueprint was the first [`seed_blueprint`] instance." Per work-72's `councilRef`, the stint-5 council was **hand-seeded** (work-65..71); the `seed_blueprint` council dogfood is a *planned* S2 deliverable that may not have executed. Verify before citing it as precedent.
- §4.1.1 uses the JSONB `?` operator while the shipped index comment backs `@>` containment; both are served by the same default GIN, so this is fine — but state `@>` to match the shipped contract.

### Verdict: **NEEDS WORK** (sound core; three corrections gate the build)
The hybrid spine, the altitude model, the fact-binding validator, and the idea-368/369 evolution are sound and honor every ratified pick. Three things must be fixed before build: **(1)** the false WorkItem-`arcId` premise — specify how arc-membership is actually computed (add the field to WorkItem + index it, or define the transitive derivation); **(2)** the bug-203 dependency — commit to **CLI/psql delivery** for the fact + journey layer (or an explicit restart step) so the close-out dogfood isn't host-restart-gated; **(3)** the work-72/`anchor_close` wiring — say which item is held and how work-72 actually closes. Recommend also **de-scoping S3/S4 to a stint-6 follow-on** and shipping S0–S2 (CLI doc-renderer) as the stint-5 dogfood. Fix these and it is buildable.
