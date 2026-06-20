# CDACC run-2 — spec-real canary plant set (architect / spec altitude)

**Purpose:** the spec-altitude half of the run-2 joint canary. Run-1 had **n=1** spec-real plant (tele-0 umbrella staleness) → spec precision-cleanliness was unfalsifiable (calibration #87). This set widens spec-real to **n≥6** diverse drift signatures + **2 false-positive traps**, so the spec fan-out's **recall** (≥0.80) and **precision** (≥0.85, no-over-claim) are both measurable — and, in run-2, this is what calibrates **GPT-5.5's spec-altitude trustworthiness** (the spec altitude runs on Steve/GPT-5.5 per the locked shape).

**Discipline (per the CDACC design):**
- **Site-blind + non-greppable.** These are *patterns*, not pinned locations. The neutral instantiator places each into the frozen snapshot's doc corpus at a site of its choosing and **varies the surface articulation** (so neither principal can pattern-match its own wording). Do NOT name target files here.
- **Two-principal authorship.** This is the architect-authored half; pairs with Greg's `run2-code-real-plants.md` (code-real, 8 patterns) for the joint set.
- **Plant ≠ a real defect we leave in prod.** Plants live only in the frozen *snapshot*, removed from the working tree; the instantiator holds the plant-diff (the ground-truth recall key).

---

## Spec-real plants (the spec fan-out SHOULD flag each — recall)

### SR-1 · Stale bounded-enumeration drift
A doc enumerates a **bounded set** ("X-1 through X-N", "the N kinds", "all M roles") that has since grown — a member added later is silently omitted. **Real drift:** the enumeration no longer covers reality. **Audit must catch:** the set is stale vs the current ground-truth count. *(Generalizes run-1's tele-0 "tele-1 through tele-10"; the instantiator plants a DIFFERENT instance — not tele-0 — and varies the domain.)*

### SR-2 · Superseded-obligation cited as current
A methodology/spec clause cites a ratified primitive, tool, or workflow **as the current path** when a later mission retired or replaced it. **Real drift:** the cited-obligation chain resolves to a clause that no longer holds. **Audit must catch:** the authority is stale — a PASS/FAIL resting on it is unsupported. *(Tests the cited-obligation tier: does the audit verify the citation is still live, not just that it exists?)*

### SR-3 · Unreconciled cross-doc contradiction
Two ratified docs in the corpus assert **contradictory operational facts** about the same mechanism (cf. calibration #85 — watchtower functional vs not). Neither is auto-wrong; the **contradiction itself** is the drift. **Audit must catch:** the unreconciled conflict (the normative/completeness layer's job — a per-tele cell can pass both docs in isolation).

### SR-4 · Spec↔state isomorphism break
A doc asserts a **1-to-1 / "state matches this spec exactly"** invariant while a planted divergence exists between the doc's stated shape (a count, a field name, an ID-mapping) and the actual entity/state shape in the snapshot. **Real drift:** tele-2 isomorphism violated. **Audit must catch:** the doc claim ≠ the snapshot reality. *(The spec-side analogue of the code-altitude bug-138 class.)*

### SR-5 · Obligation-tier inflation (aspiration stated as shipped-MUST)
A doc states an **asymptotic / unbuilt** capability as a **current, done obligation** — "the system auto-Xs", "every Y is enforced", "Z is observable" — where reality is North-Star or directional. **Real drift:** the aspiration/obligation conflation (run-1's root finding). **Audit must catch:** consulting the obligation-status overlay, the criterion is mislabeled shipped-MUST when the audit-method/reality says North-Star. *(Tests the overlay-as-oracle consumption + the normative dimension.)*

### SR-6 · Authority/provenance overclaim
A doc claims **Director-ratification** (or seed-ratified / formally-approved authority) for a change that was actually architect-autonomous, LLM-autonomous, or never ratified. **Real drift:** an authority overclaim that, unflagged, lets an unratified change masquerade as constitutional. **Audit must catch:** the provenance claim has no backing ratification act. *(Spec-altitude integrity; orthogonal to the others.)*

---

## False-positive traps (the spec fan-out must NOT flag — precision / no-over-claim)

### FP-1 · Sanctioned-by-composition
A construct that **looks like a single-tele violation** under a strict literal read but is **explicitly sanctioned** by a cross-tele composition or a ratified exception clause (e.g., tele-11/12 added as a *documented Director-directed exception* to the review anti-goal "don't modify the ratified Tele set"). **Must NOT flag** — flagging it is the over-claim the canary measures. The audit's `overClaimCheck` must state it considered the sanctioning clause and correctly declined.

### FP-2 · Documented-deferred known-item
A staleness/gap that is **explicitly documented as deliberately deferred**, with a pointer to its tracking item (e.g., the tele-0 enumeration note pointing at idea-328). It **looks like** uncorrected drift but is a **sanctioned, tracked, deferred-by-design** item. **Must NOT flag** as a *new* finding — the audit must distinguish "documented-deferred-with-owner" from "undetected drift." *(Directly tests whether the spec model over-flags known-items — a likely GPT-5.5 calibration point.)*

---

## Recall/precision keys (held by the neutral instantiator, not here)

- **Recall:** spec fan-out should surface SR-1..SR-6 → gate ≥0.80 (find ≥5/6).
- **Precision:** spec fan-out must leave FP-1, FP-2 unflagged (and the ~17 known-clean spec cells) → gate ≥0.85.
- **Pre-flight (mirrors the code-altitude recall pre-flight):** before run-2 fires, dry-run the spec fan-out **on the assigned model (GPT-5.5)** against this set — does GPT-5.5-on-the-spec-pipeline find the planted spec-real drifts and decline the FP traps? That measures the *assigned model's* spec recall+precision, not just the pipeline logic.
