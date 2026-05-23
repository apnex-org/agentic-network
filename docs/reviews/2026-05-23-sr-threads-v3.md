# Strategic Review — 2026-05-23 — Threads v3

**Status:** v1.1 (2026-05-23) — engineer critique integration. v1.0 → v1.1 changelog in Provenance.
**Mode:** Standard
**Scope:** `{ kind: [Idea, Bug], theme: idea-312 (M-Threads-v3 umbrella), status: open }`
**Methodology:** `docs/methodology/strategic-review.md` v2.0 (first Standard-mode run of v2.0)
**Inputs:**
- Tele set (canonical 11 Teles)
- Cartography v1.1 — `docs/reviews/2026-05-23-threads-v3-cartography.md`
- Companion v1.1 — `docs/reviews/2026-05-23-threads-v3-cartography-engineer-enrichment.md`
- In-scope subset post-clustering: **14 of 47 bugs** (11 FOLD + 3 COMPOSES) + **46 of 214 ideas** (31 FOLD + 15 COMPOSES) + 4 already-shipped building blocks
**Prior SR run (v1.0 Deep-mode analog):** the cartography arc itself — `docs/reviews/2026-04-retrospective-lite.md` is the closest v1.0 precedent
**Anchor:** idea-312 (M-Threads-v3)

---

## How sub-steps 1–5 are covered

The two cartography inputs are the v2.0 sub-step 1–5 work for this run:

| Sub-step | Source |
|---|---|
| 1 Scope resolve | this artifact's `Scope` line above; theme=idea-312 |
| 2 Inventory | cartography v1.1 §1–§3 (bugs + ideas + already-shipped) |
| 3 Lineage walk | companion v1.1 §1 (substrate-wide cross-ref via psql) |
| 4 Cluster | cartography v1.1 §1–§2 + §6 wave-decomposition (FOLD/COMPOSES/DEFER/EXCLUDE) |
| 5 Friction surface | companion v1.1 §6 (11 F-N + 6 DSV + 6 RB + 5 AE = 28 surfaces) |

Sub-steps **6–12 are this run's distinctive work**. Sub-step 13 is Director ratification.

---

## §1 · Inventory + lineage (sub-steps 1–3, by reference)

Highlights from inputs worth carrying into §4–§7:

- **Lineage substrate-gap is empirical and substrate-wide:** 0/118 bugs have `sourceThreadId`; 63/312 ideas (20%) do — and the 20% rate matches the cascade-action-path filing era (older entities pre-date the path). v3 W4 absorbs this via bug-118 fix-shape; SR sub-step 3 autonomy depends on the same fix.
- **Title-grep underspecifies the cross-leverage signal:** companion v1.1 §2.X surfaced 4 COMPOSES (idea-69, idea-240, idea-241, idea-304) via lineage cluster co-occurrence that title-grep missed. The cross-leverage signal is load-bearing.
- **4 already-shipped v3 building blocks** (bug-115, bug-106, mission-83, idea-66) — v3 is not greenfield.
- **mission-41 W3 invariant-coverage cluster** is empirically cohesive (all 23 entities trace to thread-266); the 6-FOLD partition is code-trace-substantiated.

---

## §2 · Cluster + cross-leverage (sub-step 4)

The W1–W5 wave decomposition (cartography v1.1 §6) is the load-bearing clustering. Cross-leverage observations the SR carries forward:

| Entity | Composes under (Initiatives) | Cross-leverage signal |
|---|---|---|
| **idea-121** (API v2.0) | M-Threads-v3 W1 · M-Class-Tier-Promotion | **dual-Initiative** — verb-tool consolidation; precondition for wire-contract + Class-Tier-Promotion verb-uniformity. (NB: idea-121 IS the M-API-v2.0 Initiative-shape — not a child of itself.) |
| **idea-126** (k8s envelope) | M-Threads-v3 W1 · M-Class-Tier-Promotion | **dual-Initiative** + general-purpose substrate. Wire-substrate for verb-tool; entity-envelope for Class-Tier kinds. The "general-purpose substrate" property is honest but not itself a cross-leverage signal — substrate-generality is a Concept-level attribute, not Initiative parentage. |
| **idea-151** (graph relationships) | M-Threads-v3 W4 · M-Class-Tier-Promotion | **dual-Initiative** + methodology-side benefit (SR sub-steps 3/4/7/9 autonomy). SR-autonomy is not itself a filed Initiative — it's a downstream methodology beneficiary; surfaced as future Initiative candidate `M-SR-Autonomy` in §8. |
| **bug-118** (bug-lineage substrate-wide) | M-Threads-v3 W1 | **single-Initiative (W1) + methodology-side benefit.** Lineage capture lands at the wire/envelope boundary (cartography v1.1 §6 W1 source-of-record: "closes the 'gate-permissiveness' and 'lineage-capture' DSV classes structurally"). SR sub-step 3 substrate-walkability for bugs is the downstream beneficiary, not a separate Initiative parent. |
| **idea-69** (MCP proxy list/get standardisation) | M-Threads-v3 W1 · M-API-v2.0 (idea-121) | **dual-Initiative** — list/get-surface standardisation is verb-uniformity at the tool layer + envelope-discipline at the wire layer. |
| **idea-240** (M-Agnostic-Transport-Adapter-Hub umbrella) | M-Threads-v3 W1 · M-Agnostic-Transport (itself's umbrella) | **dual-Initiative** — transport substrate is wire-substrate for v3 W1 + the umbrella's own program. |
| **idea-241** (M-Transport-WebSocket-Adapter-Hub) | M-Threads-v3 W1 · M-Agnostic-Transport (idea-240) | **dual-Initiative** — concrete-impl candidate for transport substrate; rides under both its umbrella and v3 W1. |
| **idea-152** (Smart NIC) | M-Threads-v3 W5 · M-Agnostic-Transport (idea-240) | **dual-Initiative** — target-state composes across wire + transport substrate. |
| **idea-292** (thread-design review) | M-Threads-v3 W2 · M-Threads-v3 W5 | **dual-wave (intra-umbrella)** — 4 residual dimensions split W2/W5. |

The multi-Initiative parentage is the SR's primary prioritisation signal. Self-referential entities (an Idea that IS an Initiative shape, e.g., idea-121 IS M-API-v2.0) don't compose under themselves — they're the same entity at different tiers. Substrate-generality (idea-126's "wire substrate for any entity kind") is a Concept-level attribute, not an Initiative cross-leverage signal.

---

## §3 · Friction surface (sub-step 5, by reference)

Companion v1.1 §6 is canonical. Key surfacings for prioritisation:

- **DSV-1..6** is the structural footprint of tele-6 violations — substrate silently accepts the failure modes that discipline catches. Six instances make the pattern named. v3 W1 (wire-contract) retires DSV instances structurally; this is the load-bearing tele-6 play.
- **F-1 (`list_*` first-N cap)** is the predicted second victim of bug-115's latent design smell; bug-117 anchors W5.
- **F-2 (bug-lineage substrate-wide gap)** is the dual-Initiative substrate work (bug-118 fix) — composes with cascade FSM AND SR-autonomy.
- **Round-budget pressure (RB-1..6)** is mostly methodology-side (already filed via idea-248 + idea-222); residual substrate gap = mid-cycle `maxRounds` bump primitive (small but worth naming in W4).

---

## §4 · Per-Initiative analysis (sub-step 6)

No first-class Initiative entities exist yet (Class-Tier promotion is itself a candidate Initiative). Analysis applies to **transitional Initiatives** (Idea with `umbrella` tag) + Initiative-shaped Ideas the cartography surfaced.

### Pre-existing Initiative-shaped Ideas

| Initiative | Status | Advancing? | Blocker / observation |
|---|---|---|---|
| **idea-312 — M-Threads-v3** (umbrella; this run's anchor) | open · `kind: umbrella` | yes — cartography v1.1 + companion v1.1 are Phase-1-equivalent; ready for per-wave Survey scheduling | none structural — waves can sequence per §7 critical-path |
| **idea-121 — M-API-v2.0** (tool-surface modernization) | open | yes — Director-flagged this session as the verb-tool consolidation target; precondition for W1 + Class-Tier | none — ready for Survey |
| **idea-126 — M-K8s-Envelope** | open | yes — verb-tool's wire substrate | none — ready for Survey (sequence vs idea-121 a Design-phase question) |
| **idea-151 — M-Graph-Relationships** | open | yes — substrate-extension Initiative; SR-autonomy precondition | none — ready for Survey |
| **idea-152 — M-Smart-NIC-Adapter** | open | partially — longer-horizon target-state | composes with W5 + idea-240 (transport adapter); intentionally not next-up |

### New Initiative candidate (this run)

| Initiative | Type | Composes-under | Tele alignment | Anti-goals | Notes |
|---|---|---|---|---|---|
| **M-Class-Tier-Promotion** | substrate-extension umbrella | (top-level; not under M-Threads-v3) | tele-3 (Sovereign Composition) · tele-6 (Deterministic Invincibility) | (a) does NOT subsume Idea/Bug instance entities; (b) does NOT include scheduled-SR-runner machinery; (c) ships Initiative + Concept + Defect entities together (no partial-ship) | Blocked-on idea-121 + idea-126; surfaced by v2.0 methodology §Tier-2 + §Substrate-dependencies |

### Wave-Initiatives (under M-Threads-v3 umbrella)

Each is an Initiative-shape decomposed from cartography v1.1 §6. Each generates 1–N Survey-phase missions downstream.

| Wave | Scope (anchor entities) | Tele primary | Anti-goals |
|---|---|---|---|
| **W1 — Wire contract + envelope + transport** | idea-126, idea-113, idea-69, idea-240, idea-241, bug-27, bug-96, bug-118, idea-214 | tele-3, tele-6 | does NOT subsume idea-152 Smart NIC; does NOT replace ResponseSummarizer (W5 scope) |
| **W2 — Substrate carve-out** | idea-200, idea-201, idea-207, idea-292 dims #1/#2/#4/#5 | tele-3, tele-7 | does NOT touch FS-mode legacy (mission-83 absorbed); does NOT introduce new entity kinds (defer to Class-Tier) |
| **W3 — Routing modes** | idea-90/91/92, bug-57, bug-60, bug-61, idea-98/99, idea-124, idea-304 | tele-2 | does NOT include Director-SSE-channel (idea-84/86 composes, not folds); does NOT couple to multicast membership rewrite (W4) |
| **W4 — Cascade FSM** | idea-93/94/95/96, idea-110, idea-111, idea-159, idea-169, idea-170, idea-172, idea-173, idea-174, idea-313, bug-23, bug-48 | tele-3, tele-6 | does NOT subsume Mission lifecycle FSM (mission-41 W3 owns); does NOT redesign cascade-action vocabulary wholesale |
| **W5 — Size / response-shape** | bug-117, idea-145, bug-25, idea-152 | tele-4 | does NOT replace ResponseSummarizer wholesale — extends machinery-vs-LLM split pattern; does NOT subsume Smart NIC (composes as longer-horizon) |

### Advancing vs blocking summary

- **Ready to Survey now:** idea-121, idea-126, idea-151, M-Class-Tier-Promotion, bug-117 (focused fix)
- **Sequenced behind preconditions:** all W1–W5 waves (W1 depends on idea-121 + idea-126; W4 depends on idea-151 + bug-118 fix; rest cascade)
- **Longer-horizon (intentional):** idea-152 (target-state); M-Class-Tier-Promotion (ships post-idea-121 + idea-126)

---

## §5 · Reverse-gaps (sub-step 7)

**Scoped reverse-gap** (against Teles touched by in-scope subset — tele-2/3/4/6/7):

| Tele | Initiative coverage | Reverse-gap? |
|---|---|---|
| tele-2 Frictionless Agentic Collaboration | M-Threads-v3 (W1, W3 primarily) | served |
| tele-3 Sovereign Composition | M-Threads-v3 + M-Class-Tier-Promotion + idea-121 + idea-126 + idea-151 | well-served (the v3 architectural play) |
| tele-4 Zero-Loss Knowledge | M-Threads-v3 W5 + idea-152 (longer horizon) | served |
| tele-6 Deterministic Invincibility | M-Threads-v3 W1 (DSV retirement) | well-served |
| tele-7 Resilient Operations | M-Threads-v3 W2 + W4 partially | served (some friction surfaces are methodology-side) |

**Full-scope cross-Tele reverse-gap deferred** to a non-themed SR run. This run is theme-scoped to threads/agentic-comms; the 6 remaining Teles (tele-1, tele-5, tele-8, tele-9, tele-10, tele-11 — exact set per `tele-glossary.md`) are out of scope for the gap check.

**Orphan Ideas check:**
- 16 §2.8 residual (idea-160..168, 171, 175..181) — not orphan; mission-41 W3 owns the coverage program
- mission-77 follow-on residue (idea-211, idea-149 verify) — flagged for next SR (handover §Deferred)
- ~18 missioncraft DEFER bucket — cross-project; not orphan in this repo's scope
- **No true v3-scope orphans** — every in-scope entity has a wave or composing-Initiative assignment

---

## §6 · Class-layer surfacings (sub-step 8)

Surfacing only; formal extraction is a separate (rarer) activity.

### Concept candidates (emergent across Ideas)

| Candidate | Instances |
|---|---|
| **Sovereign Composition substrate-class promotion** | mission-83 (Hub substrate); idea-152 (Smart NIC); idea-240/241 (transport adapter); idea-126 (envelope); W1 wire-contract |
| **Cognitive-substrate-boundary-respect** (umbrella) | Two named sub-Concepts cluster instances of the ResponseSummarizer-class Defect — see pair-detection below. |
|     ↳ Sub-Concept A: **Caller-intent-honored** (newest-N pagination; caller `limit` respected) | bug-115 fix (`get_thread` honours offset/limit; default newest-5); bug-117 fix-shape candidate |
|     ↳ Sub-Concept B: **Machinery-vs-LLM split** (internal-machinery bypass via `isInternalCall(ctx.tags)`) | bug-106 fix (one shipped site); bug-117 fix-shape candidate |
| **Architect-autonomy substrate dependencies** | idea-121 + idea-126 + idea-151 + bug-118 form a cluster of preconditions for downstream SR-autonomy; named in v2.0 methodology §Substrate-dependencies |

### Defect candidates (emergent across Bugs)

| Candidate | Instances |
|---|---|
| **DSV-class methodology-bypass** (named in v2.0) | DSV-1 antml-prefix; DSV-2 list_* cap; DSV-3 bug-lineage substrate-wide; DSV-4 thread-vs-GitHub-approval; DSV-5 schema-rename-without-migration; DSV-6 adapter-restart-doesn't-rebuild-Hub-container |
| **ResponseSummarizer-class instance progression** | bug-115 → bug-106 → bug-117 — three instances retired by **two distinct Concepts**: bug-115 cluster under sub-Concept A (caller-intent-honored); bug-106 clusters under sub-Concept B (machinery-vs-LLM split); bug-117's fix-shape (Design-phase pick: caller-intent extension OR machinery-vs-LLM extension OR new substrate primitive) determines which sub-Concept catches it. |
| **Lineage-substrate gap (bug-form)** | bug-118 (substrate-wide); bug-27 (cascade-handler-specific narrow instance); idea-side analog: 80% of ideas missing sourceThreadId |

**Cross-tier pair-detection** (Concept ↔ Defect symmetric view): the Defect class "ResponseSummarizer-class instance progression" requires **two distinct Concepts applied** (sub-Concept A *or* sub-Concept B, per instance) to retire — not a single Concept. The umbrella Concept "Cognitive-substrate-boundary-respect" captures the shared higher-order intent (the cognitive substrate must respect both caller-intent AND internal-machinery boundaries); the two sub-Concepts are the discrete shipped/shippable patterns. This pair-detection refines v2.0 §Tier-2's orthogonal-peers framing: Defect classes can require N-Concepts-applied to fully retire.

**No formal extraction this run.** Class-Tier promotion (idea M-Class-Tier-Promotion) ships entity kinds; doc-form proxies remain transitional today.

---

## §7 · Critical-path mapping (sub-step 9)

Initiative-to-Initiative dependency graph (precondition-or-composition; not all hard sequencing):

```
                            ┌─── M-K8s-Envelope (idea-126) ◄════╗
                            │                                    ║  composes-at-Design
                            │                                    ║  (parallel-trackable)
                            └──────────► M-API-v2.0 (idea-121) ──╣
                                                │                ║
                                                ▼                ▼
                                          M-Threads-v3 W1     M-Class-Tier-Promotion (NEW)
                                                │                          │
                                                ▼                          ▼
                                          M-Threads-v3 W2..W5     (Initiative + Concept + Defect entities)
                                                ▲                          │
                                                │                          ▼
                                                │                    SR-autonomy lift (downstream beneficiary)
M-Graph-Relationships (idea-151) ──► M-Threads-v3 W4
                                  (cascade FSM)

bug-118 fix (substrate-wide bug-lineage) — IN W1 (wire/envelope layer captures lineage uniformly)
```

**Sequencing recommendation (for downstream Survey ordering):**

1. **idea-126 (k8s-envelope) ‖ idea-121 (M-API-v2.0)** — parallel-trackable; the relationship is composes-at-Design-checkpoint, not hard sequencing. Envelope-first vs verb-first is a Design-phase choice; the two can Survey concurrently with explicit composition checkpoints.
2. **idea-151 (M-Graph-Relationships)** — parallel-trackable with (1); unblocks W4.
3. **M-Threads-v3 W1** — wire contract + envelope + transport. Composes (1) + bug-118 lineage capture at wire boundary. Survey-schedulable once (1) Design checkpoint clears.
4. **M-Class-Tier-Promotion** — composes (1); enables native Initiative output. Survey-schedulable post-(1) Design.
5. **M-Threads-v3 W4** — cascade FSM. Depends on (2) idea-151 + W1 substrate.
6. **M-Threads-v3 W2 / W3 / W5** — sequenced per cartography v1.1 §6.
7. **idea-152 (Smart NIC)** — longer-horizon; rides alongside W5.

Items 1–2 are the "ready to schedule" set; 3–6 sequence behind them per Design-phase composition checkpoints; 7 is intentionally longer-horizon.

---

## §8 · Initiative output (sub-step 10)

### New umbrella Initiative to file

| Action | Entity | Form |
|---|---|---|
| **CREATE** | M-Class-Tier-Promotion | Idea with `umbrella` tag (transitional vehicle per v2.0 §Promotion status) |

Body summary: *Promote `Initiative`, `Concept`, and `Defect` to first-class Hub entities, shipping all three together. Initiative ships with completion semantics (peer of Tele on Tier 1); Concept + Defect ship as emergent class-layer peers on Tier 2. Blocked-on idea-121 (verb-tool consolidation) and idea-126 (k8s-style envelope) as wire-substrate preconditions. Composes with SR methodology v2.0 §Tier-1 + §Tier-2 + §Promotion-status.*

### Pre-existing Initiative-shaped Ideas (no new entities; metadata-only refresh suggested)

These already exist; the SR recognises them as Initiative-shaped and suggests `kind: umbrella` tag refresh if not already applied:

- idea-312 (M-Threads-v3) — already `umbrella`-tagged ✓
- idea-121 (M-API-v2.0) — Initiative-shaped; tag refresh candidate
- idea-126 (M-K8s-Envelope) — Initiative-shaped; tag refresh candidate
- idea-151 (M-Graph-Relationships) — Initiative-shaped; tag refresh candidate
- idea-152 (M-Smart-NIC-Adapter) — Initiative-shaped; tag refresh candidate

### Wave-Initiatives under M-Threads-v3 umbrella

W1–W5 do not need separate Hub-entity filings at this stage — they're decomposed within idea-312's body + cartography v1.1 §6. They'll surface as Mission entities at Survey-scheduling time.

**Anti-pattern guard (per v2.0 §Anti-patterns):** no per-entity tool surface sketched; CREATE action above uses the existing `create_idea` verb with `kind: umbrella` tag, deferring per-kind tools to idea-121.

---

## §9 · Triage routing (sub-step 11)

Per v2.0 §Triage routing + Skip-criteria. Strict application of all-5-criteria for (a).

### (a) Skip-direct-to-Survey — 1 entity

| Entity | Skip-criteria check | Survey scope |
|---|---|---|
| **M-Class-Tier-Promotion** (NEW) | (1) Director-ratified VIA this SR (source-ratification IS the SR ratify action) ✓ (2) scope concrete (Initiative + Concept + Defect entities; ship-all-together; anti-goals per §10) ✓ (3) no contest expected (substrate-extension; surfaced naturally by v2.0 methodology) ✓ (4) tele-aligned (tele-3 + tele-6) ✓ (5) ships-together-as-one-shape ✓ — passes all 5 post-ratify | Class-Tier promotion (post idea-121 + idea-126 Design composition checkpoint) |

### (b) Triage thread — 6 entities

| Entity | Reason for triage |
|---|---|
| **idea-121 (M-API-v2.0)** | Source-ratification trail not strictly clean — "Director-flagged this session" ≠ "Director-ratified-scope-as-Survey-ready." Triage thread to confirm scope-pin + Survey readiness, then promote. Methodology integrity > round-trip cost. |
| **idea-126 (M-K8s-Envelope)** | Same source-ratification concern; older idea referenced this session without dedicated ratify thread. Triage to confirm scope + Tele alignment + composition with idea-121. |
| **idea-151 (M-Graph-Relationships)** | Same source-ratification concern. Triage to confirm scope + Tele alignment + W4 precondition framing. |
| **idea-292** | 4 of 5 dimensions still live; W2 vs W5 split needs bilateral architect+engineer scope-flex. |
| **bug-117** | Fails criterion (5) single-mission-shape — three fix-shape options named (caller-`limit` upward respect / per-call `unsummarized` opt-out / Hub-side substrate primitive). Triage to converge on one fix-shape before Survey. |
| **bug-118 fix-shape** | Multi-path fix (MCP-tool surface extension + Hub-system-emit audit + defensive contract test) needs bilateral Design pre-Survey; landed-wave = W1 per cartography v1.1. |

### (c) Queue for next SR — 43+ entities

- **All FOLD bugs not separately routed** (8 of 11: bug-23, bug-25, bug-27, bug-48, bug-57, bug-60, bug-94, bug-96) — surface in wave-specific Surveys when respective wave-Survey scheduled
- **All FOLD ideas not separately routed** (29 of 31) — surface in wave-specific Surveys
- **COMPOSES bugs** (bug-40, bug-41, bug-42) — bound to W1/W3 Surveys; queue
- **COMPOSES ideas** (12 of 15 not separately routed) — queue with wave bindings
- **mission-41 W3 follow-on residual** (16 entities) — mission-41 owns; surface at mission-41 retrospective (not v3 SR)

### (d) Dismiss — 0 entities

No dismissals this run. The cartography's DEFER/EXCLUDE buckets are tracking dispositions (not v3 scope), not dismissals — they remain valid as their own programs (missioncraft; task/DAG/FSM; substrate-concurrency).

---

## §10 · Anti-goals (sub-step 12)

### Per-Initiative anti-goals (M-Threads-v3 umbrella)

- v3 does NOT subsume task/DAG/missioncraft surfaces (cross-project; tracked DEFER)
- v3 does NOT include presence/identity surfaces (bug-40/41/42 COMPOSES, not FOLD)
- v3 does NOT do its own concurrency model — composes with mission-83 substrate backplane
- v3 W5 does NOT replace ResponseSummarizer wholesale — extends `Cognitive-substrate-boundary-respect` sub-Concept pattern (per §6)
- v3 W1 does NOT require Class-Tier promotion as a precondition — designs around umbrella-Idea-proxy initially; ships Initiative-as-entity in parallel via M-Class-Tier-Promotion
- v3 does NOT do its own observability layer — composes with idea-114 (architect local-state vs Hub-state reconciliation); does not replace
- v3 does NOT migrate existing thread/message data — mission-83 substrate cutover already completed the migration; v3 builds on the substrate as-is

### Per-Initiative anti-goals (M-Class-Tier-Promotion)

- does NOT subsume Idea/Bug instance entities (Tier-3 stays as-is)
- does NOT include scheduled-SR-runner machinery (separate skill-mechanisation Initiative, future)
- does NOT auto-extract Concepts/Defects (extraction is emergent + occasional + Director-gated)
- does NOT auto-promote existing umbrella-tagged Ideas to Initiative entities — promotion is explicit + Director-gated, not automatic; backfill is a separate mission-shaped activity
- does NOT rename or remove any current first-class entity kinds — additive only (existing Idea/Bug/Mission/Tele/Design entities remain as-is)

### Per-run accumulated anti-goals

- This SR does NOT produce Mission briefs — Designs are downstream (Survey + Design phase per `mission-lifecycle.md`)
- This SR does NOT do per-Idea individual triage for FOLD bucket — wave-Surveys consume them
- This SR does NOT formalise Class-Tier extractions — surfaces candidates only; extraction is a separate (rarer) activity
- This SR does NOT execute cross-Tele reverse-gap — theme-scoped (Threads v3); full-scope reverse-gap deferred to a non-themed SR run
- This SR does NOT autonomously file calibrations — calibration ledger is architect-Director-bilateral (per CLAUDE.md §Calibration ledger discipline)
- This SR does NOT modify v2.0 methodology mid-execution — methodology-side observations surfaced during execution park to §12 as v2.1 candidates for a separate retrospective
- This SR does NOT close DEFER-bucket entities — cartography DEFER/EXCLUDE buckets stay valid as their own programs (missioncraft; task/DAG/FSM; substrate-concurrency)

---

## §11 · Director ratification log

Awaiting Director ratification.

**Ratification asks (single-gate per Standard-mode):**

1. **Initiative set** — accept the umbrella (M-Threads-v3) + 5 wave-Initiatives + 4 pre-existing Initiative-shaped Ideas (idea-121, idea-126, idea-151, idea-152) + 1 new (M-Class-Tier-Promotion)?
2. **Critical-path sequencing** (§7) — accept the parallel-trackable precondition shape (idea-126 ‖ idea-121 at Design-checkpoint; idea-151 parallel; bug-118 IN W1; W4 depends on idea-151 + W1; rest sequences per cartography v1.1 §6)?
3. **Triage routing** (§9) — accept the stricter 1 skip-to-Survey (M-Class-Tier-Promotion only) + 6 triage-thread (idea-121, idea-126, idea-151, idea-292, bug-117, bug-118-fix-shape) + 43+ queue + 0 dismiss split?
4. **Anti-goals** (§10) — accept the expanded per-Initiative (M-Threads-v3 7 items + M-Class-Tier-Promotion 5 items) + per-run (7 items) set?

Post-ratification execution actions (architect to execute):

- `create_idea` for M-Class-Tier-Promotion with `umbrella` tag + body per §8
- `update_idea` (status=triaged) for M-Class-Tier-Promotion (the single (a) entity)
- Open triage threads (6) for idea-121, idea-126, idea-151, idea-292 W2/W5 split, bug-117 fix-shape, bug-118 fix-shape
- File this artifact as `docs/reviews/2026-05-23-sr-threads-v3.md` (this file) via PR #262

---

## §12 · Methodology observations for v2.1 (parked; per per-run anti-goal "does NOT modify v2.0 mid-execution")

Surfaced during this run's draft + engineer critique pass; captured here for a separate v2.1 retrospective, not modified into v2.0 mid-execution.

| # | Candidate refinement | Source |
|---|---|---|
| **A** | **Multi-Initiative parentage scoring rubric** — §2 cross-leverage is hand-rolled; formal scoring (M-N count + Concept-coverage + Defect-coverage signal) would remove author-judgment dependency. | engineer critique |
| **B** | **Self-referential Initiative claims convention** — when an Idea promotes to an Initiative, the cross-leverage table needs an explicit convention for "this entity IS the Initiative, not under it." | engineer critique; this run's §2 idea-121/126 self-reference catch |
| **C** | **Transitional-Initiative metadata shape** — §4's per-Initiative analysis for umbrella-tagged Ideas lacks the formal `(Tele alignment, scope, anti-goals)` declared fields that first-class Initiatives would carry. Specify the transitional-vehicle metadata shape. | engineer critique |
| **D** | **Elevate bidirectional-cluster-check to its own sub-step or named sub-step under sub-step 4** — companion v1.1 §2.X "current FOLDs that lineage suggests reclassifying" is in v2.0 sub-step 4 implicitly but not explicit. | engineer critique |
| **E** | **Theme-scoped vs full-scope reverse-gap composition + rotation cadence** — this run defers full-scope reverse-gap (§5). v2.1 could specify rotation (themed runs rotate through Teles; non-themed full-scope reverse-gap at lower cadence). | this run's §5 |
| **F** | **Concept ↔ Defect pair-detection sub-step output** — the symmetric-view shape isn't an explicit output. v2.1 could add "pair-detection" with N-Concepts-to-retire-a-Defect framing (per §6 refinement). | engineer critique; this run's §6 refinement |
| **G** | **Idea Triage Protocol peer-doc promotion threshold** — v2.0 flagged this as future. After this run, 2 data points (methodology doc + this SR); three runs likely earns the promotion. | this run's first-execution counter |
| **H** | **Inline consistency validation (draft self-validation sub-step)** — this run's draft had an internal inconsistency at §2 + §7 bug-118 wave placement (W1 in §4; W4 in §2 + §7). Critique caught it as expected, but a methodology-side preflight check would catch it earlier. | engineer critique; load-bearing — most actionable v2.1 refinement |

**Disposition:** all eight park for a v2.1 retrospective; none modify v2.0 mid-execution. The retrospective should fire after this SR's downstream first-mission ships, per v2.0 §Provenance §Next.

---

## Provenance

- **First Standard-mode run of strategic-review.md v2.0** (2026-05-23 AEST).
- **Architect:** lily.
- **Cadence:** architect drafts → engineer critique → architect integrates → Director ratifies.
- **Inputs:** cartography v1.1 (`29f1316`) + companion v1.1 (`ae44ba3`).
- **Methodology spec:** `docs/methodology/strategic-review.md` v2.0 (commit `368d2de`, PR #261).
- **Anchor:** idea-312 (M-Threads-v3).
- **v1.0 / 2026-05-23**: Initial draft (PR #262; commit `c1d4890`).
- **v1.1 / 2026-05-23**: Engineer critique integration (thread-626). Substantive integrations:
  - §2 cross-leverage table — self-reference dropped (idea-121, idea-126); SR-autonomy demoted to methodology-side benefit (idea-151, bug-118); idea-69, idea-240, idea-241 added.
  - §4 + §7: bug-118 wave placement reconciled to W1 (cartography v1.1 source-of-record); §2 + §7 internal inconsistency fixed.
  - §6: umbrella Concept "Cognitive-substrate-boundary-respect" with two sub-Concepts (caller-intent-honored / machinery-vs-LLM-split); pair-detection framing refined.
  - §7: idea-126 → idea-121 softened to parallel Design-phase composition checkpoint.
  - §9: stricter (a) skip set — only M-Class-Tier-Promotion; (b) triage-thread expanded to 6 (idea-121, idea-126, idea-151, idea-292, bug-117, bug-118 fix-shape).
  - §10: 4 anti-goal additions (observability + migration anti-goals on M-Threads-v3; auto-promote + rename anti-goals on M-Class-Tier-Promotion; v2.0-modification + DEFER-close anti-goals per-run).
  - §12 (NEW): 8 v2.1 candidate refinements parked (A–H).
- **Next:** Director ratification on this v1.1; post-ratification execution (entity filings + 6 triage thread opens).
