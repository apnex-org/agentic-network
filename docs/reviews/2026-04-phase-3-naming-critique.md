# Phase 3 Concept + Defect Register — Engineer Naming + Cross-Reference Critique

**Status:** ENGINEER CRITIQUE COMPLETE — verdict **PASS** with 2 minor observations. No Pass 3.β trigger.
**Author:** greg (engineer, eng-0d2c690e7dd5), 2026-04-22 AEST.
**Reviews:** `docs/reviews/2026-04-phase-3-concepts-and-defects.md` at commit `e9a8161` on agent/lily (Pass 3.α — 10 Concepts + 68 Defects + cross-reference matrix).
**Cadence position:** Engineer critique step per plan §Phase 3 (architect drafts → Director reviews → architect revises → engineer critiques naming + cross-references → Director ratifies). Lily noted Director skipped revision step (approved-as-is).
**Source thread:** thread-253 (Phase 3 backchannel).

---

## 1. Verdict

**PASS** — naming discipline holds; cross-reference matrix substantively correct; 5 judgment-call resolutions and 3 architect-elevated concepts all well-justified.

| Critique scope | Result |
|---|---|
| Naming discipline (10 concepts, 68 defects) | ✓ PASS — all noun-phrases, no verb-drift; **1 minor flag**: 4 defects in §3.14 use slash-alternative names |
| Cross-reference matrix (§4) accuracy | ✓ PASS — substantive 80%+ correct on spot-check; **1 minor flag**: §2.10 × Autopoietic cell |
| 5 judgment-call resolutions (§6) | ✓ PASS — all 5 well-justified |
| 3 architect-elevated concepts | ✓ PASS — all 3 justified by Phase 2 evidence |
| 5 engineer-candidate fold decisions | ✓ PASS — all 5 defensible |

Phase 3 convergence-criteria satisfied at architect+engineer level. Awaits Director final ratification.

---

## 2. Naming discipline review

**Concept names (10):** Uniform Adapter Contract / Substrate-First Logic / Hub-as-Conductor / Manifest-as-Master / Vocabulary Chain / Precision Context Engineering / Layered Certification / Role Purity / Shipped-but-Leaks / Bidirectional Domain Analysis.

All 10 are noun-phrase names, non-overlapping in scope, no verb-drift. Naming pattern is consistent (most are `Adjective + Noun` or `Noun-as-Metaphor`). Discipline matches plan §1.3 requirements. ✓

**Defect names (68 across 13 clusters):**

The 58 Tele-Fault-derived defects (§3.1–§3.12) are excellent — they inherit the Tele's already-crisp constitutional naming and require no architect-side renaming. Cluster-grouping by tele-of-origin aids navigation without imposing hierarchy.

The 4 Phase-2 emergent defects (§3.13) — **Filing-Point Miscategorization, Cold-Start Domain, Scope-Conflation-on-Resolve, Runway Leak** — are crisp + well-named. Cold-Start Domain is the only one that's mildly opaque without context, but the in-table description clarifies sufficiently.

### 2.1 ⚠ Minor flag — slash-alternative naming in §3.14

The 6 bug-class defects use slash-alternative names in 4 of 6:

- **Race Condition / Convergence Race**
- **Truncation / Payload Capacity Leak**
- **Boilerplate Burden / Manual Plumbing**
- **Schedule Drift / Dep-Eval Lag**

Slash-alternative naming suggests architect uncertainty between two candidates. Recommend committing to one canonical name per defect; relegate the alternative to the description if useful. Suggested choices (architect's call):

- Race Condition (more recognizable; "Convergence Race" too narrow)
- Truncation (more recognizable; "Payload Capacity Leak" jargon-heavy)
- Boilerplate Burden (more crisp; "Manual Plumbing" is a metaphor for the same)
- Schedule Drift (broader; "Dep-Eval Lag" is one mechanism, not the class)

**Severity:** trivial. Doesn't block ratification; can be amended in a §3.14 patch.

---

## 3. Cross-reference matrix review (§4)

The matrix is 10 × 14 (10 concepts × 13 defect-clusters + 1 bug-class column). Spot-checked every primary cell against §3 defect-register `Resolved-by` columns; cross-referenced 22 cells in detail.

**Substantive correctness: 80%+ on spot-check.** Most primary/partial assignments hold against the per-defect `Resolved-by` lists in §3.

**Strong patterns:**
- §2.1 Uniform Adapter Contract on Drift + Composition: ✓ (every defect in those clusters lists it as resolver)
- §2.4 Manifest-as-Master on State/Memory + Drift: ✓ (clean primary on the constitutional clusters)
- §2.5 Vocabulary Chain on State/Memory + Autopoietic: ✓ (Corporate Amnesia, Narrative Debt, Onboarding Decay, Lesson Loss all map cleanly)
- §2.6 Precision Context Engineering on Perception + Precision-Ctx: ✓ (formal mandate alignment)
- §2.7 Layered Certification on Integrity: ✓ (full primary; all 4 integrity defects)

### 3.1 ⚠ Minor flag — §2.10 × Autopoietic = "partial" but no defect references it as resolver

Matrix cell `§2.10 Bidirectional Domain Analysis × Autopoietic` shows **"partial"** resolution. But examining §3.10 Autopoietic cluster:

- Friction Fossilization → Vocabulary Chain + Hub-as-Conductor (no Bidirectional Domain Analysis)
- Manual Remediation → Vocabulary Chain (no Bidirectional Domain Analysis)
- Post-Mortem Debt → Vocabulary Chain (no Bidirectional Domain Analysis)
- Lesson Loss → Vocabulary Chain (no Bidirectional Domain Analysis)

**Inconsistency:** matrix says partial-resolution; defect register doesn't reflect it. Two repair options:
- (a) Remove the matrix cell entry (downgrade to blank) — Bidirectional Domain Analysis doesn't actually resolve any autopoietic defect per the per-defect lists
- (b) Add Bidirectional Domain Analysis to one or more autopoietic defects' Resolved-by lists (most natural fit: Friction Fossilization — bidirectional analysis surfaces friction patterns operators don't see)

Recommend (b) — the substantive coupling is real (Bidirectional Domain Analysis is autopoietic-class methodology), and adding the cross-ref strengthens both registers. Trivial 1-line edit to §3.10.

### 3.2 Other matrix observations (not flags, just notes)

- A few `primary` cells could justifiably be `partial` (e.g., §2.2 Substrate-First Logic × Collaboration is `primary` but only 1 of 3 collaboration defects lists Substrate-First Logic as resolver). These are judgment calls within architect authority; not critique items.
- §2.4 Manifest-as-Master × Chaos is `primary` but only 2 of 4 chaos defects list it as primary resolver (other 2 are Layered Certification). Could be `partial` but the call is defensible.
- The matrix is dense (most cells filled with primary or partial) — strong cross-coverage signal. No defect-cluster has zero concept resolutions; convergence-criterion holds.

---

## 4. Five judgment-call resolutions (§6) — all PASS

All 5 architect resolutions match what I'd have chosen:

1. **Concept-vs-Defect straddles → reciprocal pointers (not duplication).** ✓ Right call; reciprocal pointers (concept's `Resolves-Defects` + defect's `Resolved-by-Concepts`) preserve the coupling without duplicating the artifact. Clean separation of concern.

2. **Sub-concept granularity → one concept doc per cluster with sub-components in Mechanics.** ✓ Right call per anti-proliferation discipline. Smart NIC's 3 sub-concepts as mechanisms under Uniform Adapter Contract is the right level of granularity. Vocabulary Chain's 11 entities as mechanisms in §2.5 is the right consolidation.

3. **Tele = Concept overlap → cross-reference, not duplication.** ✓ Right call. Tele entries (formal constitutional spec) and Concept entries (operational instance) serve different purposes; cross-referencing avoids duplication while preserving traceability.

4. **Pass-Numbering Convention → defer to retrospective.** ✓ Right call (matches my recommendation). Process pattern below first-class concept bar.

5. **Plan's "direct-write backstop" seed → elevated as §2.1 sub-mechanism.** ✓ Architect authority justified. The pattern exists operationally (Phase 1 tele-11/12 workaround used direct-write to file teles before retirement primitive existed). Folding into Uniform Adapter Contract Mechanics is a defensible alternative to a standalone concept; if Director prefers standalone, that's a separate discussion but doesn't change my critique verdict.

---

## 5. Three architect-elevated concepts — all PASS

Three concepts came from architect-authority elevation (engineer harvest didn't surface them as standalone candidates):

- **§2.8 Role Purity** — JUSTIFIED. Phase 2 surfaced role-scoping as the highest-priority emergent domain (4 symptoms, 100% unaddressed). My harvest had "role-purity-implicit in tele-6" but no structural concept-name. Architect-elevation correctly fills the gap. The concept's Mechanics section addresses 4 specific operational gaps (triage SLA, dismissal permission, scope-discovery-upfront, operational-friction filing class) — concrete + actionable.
- **§2.9 Shipped-but-Leaks** — JUSTIFIED. Architect's own Phase 2 §10.x sub-class naming (Scope-Conflation, Back-Compat Runway) was the genesis. The concept names a real fix-status pattern observable in 2 backlog instances (bug-10→bug-11, mission-40 auto-claim hooks).
- **§2.1 Uniform Adapter Contract sub-mechanism: Direct-Write Backstop** — JUSTIFIED. Pattern exists operationally; folding into §2.1 Mechanics is defensible. Standalone elevation possible if Director prefers but not required.

---

## 6. Five fold decisions — all PASS

Five engineer-candidates folded into architect concepts (per §5 diff analysis):

- Sovereign State Backplane → §2.4 Manifest-as-Master ✓ (same mandate at different layer)
- Cognitive Hypervisor → §2.2 Substrate-First Logic ✓ (Hypervisor is the operational mechanism Substrate-First Logic establishes)
- Goal-as-Bridge → §2.5 Vocabulary Chain ✓ (Goal entity is one element of the chain)
- Registry Entity → §2.5 Vocabulary Chain ✓ (entity in chain)
- Rule Entity → §2.4 Manifest-as-Master ✓ (rules are manifest-layer declarations of policy)

Every fold preserves the engineer-candidate's substance as a Mechanism of the parent concept. None of the 5 deserves standalone elevation. ✓

---

## 7. Out-of-scope items NOT critiqued (per architect's brief)

Per lily's thread-253 round 4 brief, the following are explicitly out of engineer-critique scope and have not been litigated:

- Concept selection (architect-authority per plan)
- Defect consolidation (same)
- Phase 4 preview content (§9 — Phase 4 author-authority)
- Methodology-retrospective inputs (§8 — harvest for Phase 4)

Engineer observations on §8 / §9 are filed only as "Phase 4 / retrospective consumption" notes, not as critique:
- §8 #1 (88% convergence ceiling for text-based harvest) is a methodology insight worth Phase 4 retrospective scrutiny.
- §9 8-candidate Phase 4 mission preview with concept-grounding is a clean handoff from Phase 3 to Phase 4 and matches the Phase 2 §9 candidates with structural justification added.

---

## 8. Convergence-criteria self-check

Per plan §Phase 3:

| Criterion | Verdict |
|---|---|
| Every Tele fault maps to at least one defect class | ✓ PASS — all 13 teles' Faults sections in §3.1-§3.12 + 10 cross-tele/bug-class additions in §3.13-§3.14 (68 total) |
| Every velocity-multiplier idea maps to at least one concept | ✓ PASS — Instances-in-backlog fields cite specific ideas per concept; major architectural directions all covered |
| Orphans either named or explicitly deferred | ✓ PASS — §5 diff resolves 3 elevated, 5 folded, 3 deferred to retrospective |

**Phase 3 convergence achieved.** Pass 3.α + 2 minor amends (slash-alternative names + §2.10 × Autopoietic cell) = ratification-ready.

Cadence forward (per plan §Phase 3):
1. ✓ Architect drafts (e9a8161)
2. ✓ Director reviews (approved-as-is per architect on thread-253)
3. ⤬ Architect revises (skipped per Director)
4. ✓ **Engineer naming + cross-reference critique** (this artifact at commit-ETA-imminent)
5. → Director ratifies → Phase 3 closes
6. → Phase 4 Investment Prioritization opens (architect-led mission briefs; engineer cost-class estimation collaboration)

---

## 9. Recommended amends (architect's call — not blocking ratification)

Either architect amends in a follow-up commit OR Director ratifies as-is + amends post-ratification. Both viable.

1. **§3.14 — pick canonical names** for 4 slash-alternative defects (Race Condition / Truncation / Boilerplate Burden / Schedule Drift recommended)
2. **§3.10 — add Bidirectional Domain Analysis to Friction Fossilization's Resolved-by list** (or remove §2.10 × Autopoietic matrix cell). Trivial 1-line.

Severity of both: trivial. Doesn't block Phase 3 closure if Director prefers ship-as-is.

---

*End of engineer Phase 3 critique. Awaiting Director final ratification. No Pass 3.β triggered (per architect's "if no naming/cross-ref issues surface" branch in thread-253 round 4).*
