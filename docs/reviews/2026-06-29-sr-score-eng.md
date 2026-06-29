# Strategic Review — Engineer-lens Scorecard (SEALED) — 2026-06-29 — stint-6 (score_eng)

**Node:** `work-bp-stint6_strategic_review_20260629-score_eng` (engineer: greg / agent-0d2c690e)
**Scope:** ONLY the 3 engineer-lens dimensions (design §4.2). I did NOT score D1–D3 (architect) or D7–D9 (verifier), and have NOT read score_arch / score_ver (sealed).
**Input:** the sealed candidate slate @ git `31edcb2` (ev_seal_hash `111487fb…`), 7 summit candidates A–G.

## Dimension anchors (design §4.2) + method

| dim | name (engineer lens) | weight | 5 / 3 / 1 anchor |
|---|---|---|---|
| **D4** | readiness / concreteness | 3 | passes 5 skip-criteria + has a Design + deps landed / concrete but needs a Design / idea-only or blocked |
| **D5** | right-sizing / sliceability | 2 | fits one stint + PR-sliceable, not an empire / fits with a slice / multi-stint empire |
| **D6** | dependency-clarity | 2 | upstream deps owned + landed / identified-but-unlanded / dangling (the accessibility class) |

**D4 readiness** applies the 5 skip-criteria (`check-skip-criteria.sh`): C1 source-ratification · C2 scope-concrete · C3 no-contest · C4 tele-aligned · C5 single-mission-shape — plus "has a Design?" and "deps landed vs blocked on idea-121/151/126". Each score carries a bound rationale + a `mode:triangulate-against` ref (a concrete Design/Proposal/dependency/bug entity).

## Scores

### candidate_A — Adapter / integration surface
- **D4 = 3.** Concrete + partly shipped (shared-adapter / dogfood-3 already merged proves the surface ships), several members `ready` (idea-6/18/93/94/95/96/99/105), but the theme has **no unifying Design** and spans 35 candidates — concrete slices, no single shovel-ready object; fails C5 (cluster). *triangulate-against:* idea-355/dogfood-3 (shipped), bug-203 (upstream-blocked tail).
- **D5 = 3.** Highly PR-sliceable (each adapter change independent) but the **whole theme is an empire** — must pick a slice; not one-stint as a set. *triangulate-against:* tele-7 served-count = 35 (pack §3).
- **D6 = 4.** Adapter surface is owned in-repo; deps mostly landed. One dangler: bug-203 on upstream claude-code (NOT owned). *triangulate-against:* bug-203 (host-conformance, upstream).

### candidate_B — Task-dispatch + identity-resolution correctness
- **D4 = 2.** idea-336 (M-Task-Dispatch-Repair) is the design ROOT and the **dispatch root is still being designed** → needs a Design before it is shovel-ready; the bugs are symptoms of an unsettled model. *triangulate-against:* idea-336 (M-Task-Dispatch-Repair, design-stage).
- **D5 = 4.** A dispatch-repair is a **coherent single-mission scope** (not an empire); fits ~one stint once the design lands. *triangulate-against:* idea-336 (single-mission shape).
- **D6 = 3.** Gated on its own design (idea-336) settling; identity-resolution (bug-146/189) touches the core claim path — deps identified, not landed. *triangulate-against:* bug-146 + bug-189 (recurring identity-resolution class).

### candidate_C — Operator-DX / missioncraft CLI-UX debt
- **D4 = 4.** ~23 concrete bug-fixes, all `open`, **no Design barrier and no upstream blocker** — execution-ready today; only C5 fails (it is a cluster, not single-mission-shape). The most shovel-ready theme on the slate. *triangulate-against:* bug-64…bug-92 (concrete, self-contained).
- **D5 = 4.** Each fix is small + independently PR-sliceable; a "drain the CLI-UX cluster" rung batches cleanly into one stint (or a bounded sub-slice). High count but not an empire. *triangulate-against:* the contiguous bug-64..92 band.
- **D6 = 5.** Self-contained operator-facing fixes; **no upstream dependency** owned-elsewhere or dangling. *triangulate-against:* bug cluster (zero in-degree, no cross-entity deps in pack §2).

### candidate_D — Keystone architectural backbone
- **D4 = 2.** Highest forward-investment but **mostly `needs-proposal` / `needs-research`** — idea-only/early; no Designs; investment-now-pays-later, not shovel-ready. *triangulate-against:* idea-133 (in-degree 5, `needs-*` readiness), idea-102/364.
- **D5 = 2.** XL cost; these are broad architectural fabrics (idea-133 spans t4/t7/t8/t9/t10) — a **multi-stint empire**, not one-stint. *triangulate-against:* idea-133 + idea-102 (XL value, broad tele-spread).
- **D6 = 2.** Broad blast-radius + likely blocked on the substrate enablers (idea-121 verb-tool consolidation / idea-151 graph-relationships) the design names as gating — **dangling deps**. *triangulate-against:* idea-121 + idea-151 (the named accessibility-class deps).

### candidate_E — Self-instrumentation / agent-telemetry / observability
- **D4 = 3.** idea-343 (D-3) carries a **worked Option-B standardisation verdict + captured Director co-design** (concrete direction), but it is **Survey-DEFAULT (not a settled build) and gated on the C2-W0 execution-model spike** — needs the formal Survey→Design pass and the gate resolved. A ready slice exists (push-events idea-357, sizing-guarded as work-54). *triangulate-against:* idea-343 (Option-B verdict + C2-W0 gate), idea-357 / work-54 (scoped slice).
- **D5 = 4.** Explicitly sliced by its own design — "D-3 superset, C2-L1 the first slice"; push-events is a sizing-guarded sub-slice. Well-sized once sliced. *triangulate-against:* idea-343 ("L1 the first slice") + work-54 (sizing-guard).
- **D6 = 3.** Upstream dep is **named and owned but not landed** — "the C2-W0 spike is UPSTREAM; production-execution-model availability is UNPROVEN until the C2-W0 fork resolves; don't lock the telemetry shape first." High clarity, unlanded. *triangulate-against:* C2-W0 execution-model spike (idea-343's stated upstream gate).

### candidate_F — Hub storage-substrate maturation
- **D4 = 4.** The substrate is **LIVE in prod** (post-mission-83 W5) and the four follow-ons (idea-295/296/297/299) were **filed with explicit scope by mission-83**, with k8s-pattern precedents (ResourceVersion / FK) lowering design-risk — concrete + substrate-ready, each just needs its own (low-risk) Design pass. *triangulate-against:* idea-295/296/297/299 (mission-83 scoped follow-on filings), live HubStorageSubstrate.
- **D5 = 4.** Each follow-on is a **clean single-mission scope** (ResourceVersion, Audit-History, FK, BlobBody); pick one = right-sized; the set is sliceable into discrete missions, not one empire. *triangulate-against:* the four discrete idea-295/296/297/299 missions.
- **D6 = 4.** The hard dependency — the substrate backplane — is **landed** (W5 cutover); the follow-ons build on it. *triangulate-against:* HubStorageSubstrate (CLAUDE.md cutover note; landed).

### candidate_G — Self-determination / governance / autopoietic process-substrate
- **D4 = 4.** idea-389 has a **ratified Design and is mid-execution** — this very SR run is its first dogfood, so the mechanism is concrete and demonstrably running (has-a-Design + deps-landed both hold for the core). The surrounding governance ideas are earlier. *triangulate-against:* idea-389 + the m-autonomous-strategic-review design (this run).
- **D5 = 4.** The SR mechanism runs as one blueprint and fits; the 2nd-dogfood **skill-packaging** is a clean, bounded next slice. *triangulate-against:* design §8 step-7 (skill-packaging deferred to the 2nd dogfood).
- **D6 = 4.** Its deps — the blueprint substrate / seed_blueprint / the Hub — are **landed and in use right now** (this run exercises them). *triangulate-against:* the live blueprint substrate (seed_blueprint verbs LIVE, stint-6 Phase-B).

## Engineer-lens subtotals (my 3 cells only; informational — adjudicate computes the full composite)

`subtotal = 3·D4 + 2·D5 + 2·D6` (max 35):

| candidate | D4(w3) | D5(w2) | D6(w2) | subtotal /35 |
|---|---|---|---|---|
| A adapter | 3 | 3 | 4 | 23 |
| B dispatch | 2 | 4 | 3 | 20 |
| C operator-DX | 4 | 4 | 5 | 30 |
| D keystone-arch | 2 | 2 | 2 | 14 |
| E observability | 3 | 4 | 3 | 23 |
| F storage-substrate | 4 | 4 | 4 | 28 |
| G governance/SR | 4 | 4 | 4 | 28 |

**Engineer-lens reading (readiness/sizing/deps ONLY):** shovel-readiness favours C (self-contained, no design/dep blockers), then F + G (landed substrate / live design), then A + E (sliceable but with an unlanded upstream each), B (needs its design), D (early architectural empire). This is deliberately ONE lens of three — the architect (tele-fit/leverage/stake-clock) and verifier (reversibility/testability/risk-of-not-doing) lenses score independently; the composite balances all three 1/3 each. No cross-lens reading intended.
