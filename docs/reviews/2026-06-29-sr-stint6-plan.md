# Strategic Review — stint-6 Plan (adjudicated, SEALED-pre-Director) — 2026-06-29 (adjudicate_eng)

**Node:** `work-bp-stint6_strategic_review_20260629-adjudicate_eng` (engineer: greg). Derived mechanically from the ranked slate (`docs/reviews/2026-06-29-sr-ranked-slate.md`, ev_recompute_hash `15dc146b…`). This is the org's self-determined stint-6 proposal — sealed before any Director sees it; the Director ratifies (or redirects) at GATE 2.

## FOCUS (rank #1) — candidate_G: Self-determination / governance / autopoietic process-substrate

**The single stake to convert:** the org's capacity to self-direct + self-record — make the strategic-review / Director-intent loop a durable, reusable capability rather than a one-off dogfood.

**⚠ Front-and-center confidence-risk (NOT buried):** the #1's top tele-fit (D1=5) is **partly self-referential** — idea-389 (the SR mechanism) is the very process that produced this ranking, so a self-determination run has ranked "more self-determination" first. The buildable core (idea-388) justifies a 4 on its own; the 5-vs-4 premium is the circular part. **Discounting it 5→4 leaves G clear #1 (76.19 vs E 65.71)** — so this is a transparency caveat, not a result that flips. The Director sees this caveat alongside the slate + the verify_ranking verdict and decides whether a self-referential #1 is the right stint-6 focus or whether to redirect to the runner-up (E) or a shovel-ready floor (C).

### Leanest slice (one stake, not the whole theme)
- **idea-388 — director-work-queue / intent-elicitation interface.** The concrete, buildable deliverable of the G cluster (deps landed; engineer D4/D5/D6 = 4/4/4). This is the part that genuinely ships and *directly* serves tele-13 (Director Intent Amplification) — independent of the circular idea-389 self-credit.
- idea-389 (the SR mechanism itself) is **already-running substrate**, not a new build — its stint-6 work is hardening/2nd-dogfood **skill-packaging** (`skills/strategic-review/`), a clean bounded follow-slice, NOT a green-field.

### Composing floor (bounded attention alongside the FOCUS — the shovel-ready + the urgent-reversible)
- **candidate_C (operator-DX, rank #3, the most shovel-ready):** drain a **bounded sub-batch** of the ~23 CLI-UX papercuts (bug-64..92). Safe (verifier D7=4), self-contained (no deps), guaranteed-shippable — the reliable progress floor under a meta-heavy FOCUS.
- **candidate_E (observability, rank #2, the honest runner-up):** a **reversible visibility slice only** — push-events (idea-357), narrow. Carries the highest risk-of-not-doing in the slate (the verifier-lost-to-quota org-blindness loss).

## Anti-goals (explicit deferrals — so the consensus isn't re-litigated next stint)
1. **Do NOT lock the D-3 central telemetry shape before the C2-W0 execution-model spike resolves** (verifier V-ARCH-E-D3 / V-ENG-E-D5). E's value is real but its shape is upstream-gated; a narrow visibility slice only.
2. **Do NOT go wide on candidate_D (keystone architectural).** Its D2=5 is **forward-investment, not actionable-this-stint** leverage — XL, no Designs, dep-blocked. Treat as a banked direction, not a build.
3. **Do NOT take candidate_F as a whole-bundle stint.** Storage maturation is per-follow-on; any slice needs a concrete Design + a faithful-harness test gate (verifier V-ENG-F-D4/D5).
4. **Do NOT let the self-referential FOCUS go unexamined** — the G-D1 circularity caveat must reach the Director labeled, and verify_ranking is the independent check on it.

## Bounded deferrals (owner · rationale · revival-trigger)
| candidate | disposition | owner | rationale | revival-trigger |
|---|---|---|---|---|
| **E** (observability) | bounded-defer (visibility slice on the floor) | architect (D-3 prior) | runner-up; lead idea-343 upstream-gated; shape must not lock early | **C2-W0 execution-model spike resolves** → full D-3 telemetry standardisation |
| **A** (adapter surface) | SR-queue (bounded slice) | engineer | tele-7 broad surface, sliceable-but-empire; bug-203 upstream-only | a high-value adapter slice is scoped; or a host-conformance fix-by-construction (idea-391/392) lands |
| **F** (storage substrate) | bounded-defer (per-follow-on) | engineer | persistent-state, high-blast, false-green-prone | **one named follow-on** (idea-295/296/297/299) gets a Design + faithful-harness plan |
| **B** (dispatch+identity) | SR-queue | engineer | highest stake-clock but design-unsettled | **idea-336 (M-Task-Dispatch-Repair) design lands** → the bugs become shovel-ready |
| **D** (keystone architectural) | defer (forward-investment) | architect | highest leverage, zero convertible this stint | **idea-121 (verb-tool consolidation) + idea-151 (graph-relationships) land** (the named enablers) |

## Survey-dogfood hook (the Phase-3 Survey entry for the stint-6 mission)
- **Names the #1 summit's lead Idea for the stint-6 Survey: `idea-388`** (director-work-queue / intent-interface — the buildable lead of candidate_G).
- **Transparency note:** the blueprint runbook pre-named `idea-343` (the D-3/observability lead) as the *candidate* Survey hook — that was the **pre-run assumption that observability would lead**. The run did NOT bear it out: candidate_G (self-determination) outranked candidate_E (observability/idea-343) on the composite, with the architect's own prior tempered down on scrutiny. The Survey hook follows the ADJUDICATED #1, not the seed assumption — which is precisely the self-determination test producing an outcome the seed did not predetermine.
- On Director ratification at GATE 2, the architect proxy-surfaces this slate + the verify_ranking verdict + the G-circularity caveat; the named Survey lead (idea-388) enters Phase-3 Survey (3+3 Director-intent pick-list) per `idea-survey.md`.

## Provenance
Composite + order reproducible via ev_recompute_hash `15dc146b4775fd9faddccb9ddeeeefc366664fc78e1b41e0f1a9dbca079d19a8`. Final scorecards: arch @ `4802ec6`, eng @ `c66ea42`, ver (Hub doc). Sealed slate @ `31edcb2`. Movement = 3 cell revisions (NOT low-contest; see ev_movement_count). Architect excluded from adjudication (B1/FM-2); independent verify_ranking by the verifier follows.
