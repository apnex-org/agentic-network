---
mission-name: M-Ship-Integrity-Spine
source-idea: idea-340
methodology-source: docs/methodology/idea-survey.md v1.0
director-picks:
  round-1:
    Q1: a
    Q1-rationale: Deploy-truth first — the live, twice-recurring, attention-consuming class (bug-107/DR-008/DR-011) as the spearhead (single-pick, deliberately NOT a+b)
    Q2: ac
    Q2-rationale: Architect+greg autonomous → release-gate AND Ultracode-orchestrated where it fits; NOT a mid-arc checkpoint, NOT gate-behind-D-1 (ois-deploy ships as the facet-shim now)
    Q3: c
    Q3-rationale: Ratify FULL prod-mutation automation (event-roll, freshness-nudge, auto-rollback, auto-cross-approval)
  round-2:
    Q4: a
    Q4-rationale: All mandatory rails — circuit-breaker + reversibility-proof + verifier-audit every transition (generalizes DR-002 + DR-010)
    Q5: a
    Q5-rationale: External (Hub-surviving) prober watches; auto-revert to last-good digest on probe-fail within SLA — closes the Hub-self-observer gap
    Q6: a
    Q6-rationale: Verifier (Steve) audits every auto-transition async, reopen-via-finding if wrong — full coverage, non-gating
mission-class: structural-inflection
tele-alignment:
  primary: [tele-4, tele-8, tele-9]
  secondary: [tele-10, tele-13, tele-3, tele-12, tele-6]
  round-1:
    primary: [tele-4, tele-13]
    secondary: [tele-8, tele-9]
  round-2:
    primary: [tele-4, tele-8, tele-9]
    secondary: [tele-13, tele-10]
anti-goals-count: 6
architect-flags-count: 6
skill-meta:
  skill-version: architect-direct (methodology run inline, not Skill-mediated)
  tier-1-status: n/a
  tier-2-status: n/a
  tier-3-status: n/a
calibration-data:
  director-time-cost-minutes: 4
  comparison-baseline: idea-206 first-canonical Survey + idea-323 research-prepped Survey
  notes: >-
    NOVEL: this Survey was preceded by a full 5-agent Ultracode arc-design-panel
    (adversarially verified, wf_d2f7bf06) that built the technical envelope BEFORE
    question-design — so the questions were ground-truth-anchored and the central tension
    (full-automation-appetite vs tele-4/8 integrity) was pre-identified from the adversarial
    verdict and posed directly. Round-1 ratified the POSTURE (full automation); Round-2
    resolved the tension by constraint-satisfaction (full automation BEHIND a maximal safety
    envelope) rather than carrying a contradiction forward. Picks delivered via the
    AskUserQuestion structured-UI with multi-select on composable questions (Q2) — a tooling
    refinement over prose pick-lists. Methodology-evolution candidate: fold an optional
    "arc-design-panel pre-step" into idea-survey.md for arc-class missions, mirroring the
    idea-323 "research-prep pre-step" precedent.
calibration-cross-refs:
  closures-applied: []
  candidates-surfaced:
    - partition-renameMap calibration (R4/R6 — architect-Director filing, never LLM-autonomous)
    - arc-design-panel-precedes-Survey as a methodology-evolution candidate for arc-class missions
---

## §0 Context

C3 (idea-340) is the **Wave-0 OPENER** of the stint-2 arc roadmap — the Ship-Integrity Spine that closes the silent-failure-on-the-ship-path defect class the autonomous stint hit three times (silent deploy-stall bug-107/DR-008; silent renameMap filter-miss bug-138/bug-170-layer2; squash-staleness near-delete DR-011). The arc design (`docs/designs/c3-ship-integrity-spine-arc-design.md`, adversarially verified — `holds:False`→honest-scope) defines six rungs across three parallel banks under one **No-Silent-Completion charter**. This Survey anchors the C3 program's *execution intent* before Design opens; it was preceded by the arc-design-panel, so the questions are code-truth-anchored rather than spec-recall.

## §1 Round 1 picks

- **Q1 (Outcome priority):** `a` — Deploy-truth first.
- **Q2 (Execution drive):** `a+c` — Architect+greg autonomous → release-gate **and** Ultracode-orchestrated where it fits.
- **Q3 (Autonomy posture):** `c` — Ratify full automation.

**Aggregate response surface (Round 1):** Drive the deploy-truth bank (R1→R2→R3) to done — architect+greg autonomous, Ultracode-orchestrated where it parallelizes, gating only at release — with full prod-mutation automation ratified. Shape-conformance (R4) and merge-train (R5) stay in the arc but follow the spearhead.

### §1.Q1 — Per-question interpretation

The single-pick (deliberately NOT `a+b`) is a prioritization signal: the **live, twice-recurring, Director-attention-consuming** deploy-stall/false-signal class (bug-107, DR-008, DR-011) is the spearhead, ahead of the higher-recurrence-but-currently-quiet shape-conformance class. This sequences C3 as deploy-bank-first (R1 M-Roll-Signal same-day → R2 M-Watchtower-Liveness → R3 M-Deploy-State), with R4/R5/R6 following. Tele-4 (no-silent-failure on the deploy step) + tele-13 (stop consuming Director attention on deploy-watching) lead this round. **Anti-drift caveat carried to Design:** "deploy-truth first" does NOT demote R4's renameMap-governor out of the program — R4 still runs as a parallel bank and MUST gate R3's new DeployState kind (the R4→R3 self-coupling the arc design flagged). "First" = spearhead priority, not exclusivity.

### §1.Q2 — Per-question interpretation

`a+c` is composable (the methodology's natural multi-pick). The **absence of "mid-arc checkpoint"** (option b) reads as trust in the autonomous drive end-to-end — Director engagement concentrates at the release-gate, consistent with the autonomous-arc pattern (tele-13). **`c` (Ultracode-where-it-fits)** targets the parallelizable/auditable rungs — the all-kinds encode→filter→decode round-trip oracle (R4), conformance sweeps, and any fan-out-shaped verification — for throughput (tele-6). The **absence of "gate plane-touching rung behind D-1"** (option d) confirms `ois-deploy` (R3) ships now as the **facet-shim** over the `get_deploy_status` MCP verb, born inside the plane's resource(DeployState)/verb model so it slots into D-1 when that REST plane lands (design wf_514a4e05 in flight) — keeping the opener buildable-now rather than blocking on the spine.

### §1.Q3 — Per-question interpretation

`c` (full automation) is the maximal tele-13 "remove the human from the loop" appetite — auto-rollback + auto-cross-approval + event-triggered-roll + standing-freshness-nudge all ratified, not held as alarm+one-click. Per the architect anti-tele-drift discipline (§9 step 6), full-automation must be reconciled with **tele-4 (no-silent-failure)** and **tele-8/9 (gated + deployment-validated integrity)** — the adversarial verdict flagged auto-rollback as *unsupervised prod-mutation* with the *Hub-watches-its-own-roll* observer problem, and DR-008 preserved prod-infra ops as per-occasion judgment. This is NOT a reason to override the Director's pick; it is the **Round-2 clarification candidate** (capture the safety envelope, not re-litigate the posture).

**Cross-question coherence (Round 1):** `a` + `(a,c)` + `c` cohere into a single intent — *drive deploy-truth to done, autonomously and orchestrated, with full automation*. The lone tension (full-automation vs the integrity envelope) is the explicit Round-2 target.

## §2 Round 2 picks

- **Q4 (Safety envelope):** `a` — All: circuit-breaker + reversibility-proof + verifier-audit every transition.
- **Q5 (Auto-rollback trigger):** `a` — External (Hub-surviving) prober watches; auto-revert to last-good digest on probe-fail within SLA.
- **Q6 (Verifier role):** `a` — Verifier audits every auto-transition async; reopen-via-finding if wrong.

**Aggregate response surface (Round 2):** full automation, fully reversible, externally observed, fully audited — the integrity envelope that makes the Round-1 full-automation posture tele-4/8-safe.

### §2.Q4 — Per-question interpretation

The mandatory rails before ANY auto-path goes live: a **rate-cap circuit-breaker** (stops a rollback/approve storm — the documented pulse catch-up-storm lesson), a **reversibility proof** (every auto-action is undoable), and **verifier-audit on every transition**. This generalizes the just-proven DR-002 (tested + reversible + verifier-gated) + DR-010 (verifier integrity-audit) model from the 2026-06-21 stint. It RESOLVES Q3: automation is ratified, but no auto-path arms without these three — full-automation appetite reconciled with tele-8/9. (Constraint-satisfaction outcome, not a carried contradiction.)

### §2.Q5 — Per-question interpretation

Closes the **Hub-self-observer problem** the arc design named (INVARIANT A): because the Hub IS the artifact being rolled, the roll-confirm/health-probe writer must SURVIVE the Hub restart — so an **external prober** (CI-side and/or VM-side) is the observer, and it triggers auto-revert to the last-good image digest on a probe-fail within an SLA. The probe must be **behavioral**, not a shallow `/health`-200 (#346 proved a surface-level signal lies). The prober's own liveness becomes a charter line-item (who-watches-the-watcher). Tele-4.

### §2.Q6 — Per-question interpretation

The verifier (Steve) **audits every auto-transition asynchronously** and reopens via a finding (create_bug / create_audit_entry) if an auto-action was wrong. This is how Q4's "verifier-audit every transition" is realized **without** making the verifier a gate — the automation acts immediately (advisory-not-gating preserved per verifier-role.md §1/§2.3), and the verdict attaches after as a non-blocking finding. Full coverage, zero gating-contract violation. Tele-9 (chaos/deployment-validated via an independent cross-lineage check).

**Cross-question coherence (Round 2):** all three reinforce — automation that is rate-capped, reversible, externally observed, and fully (non-gatingly) audited. No residual contradiction; nothing carried to Design as an unresolved constraint.

## §3 Composite intent envelope (the solved matrix)

**Drive C3 deploy-truth (R1 M-Roll-Signal → R2 M-Watchtower-Liveness → R3 M-Deploy-State) to release as the Wave-1 spearhead — architect+greg autonomous, Ultracode-orchestrated where it parallelizes, gating only at the release-gate. Ratify FULL prod-mutation automation (event-roll, standing freshness-nudge, auto-rollback, auto-cross-approval), but no auto-path arms until it ships behind the full safety envelope: a rate-cap circuit-breaker, a reversibility/last-good-digest guarantee, an external (Hub-surviving) behavioral prober as the observer+trigger, and a verifier (Steve) async-audit on every auto-transition with reopen-via-finding. Run R4 M-Shape-Conformance (the renameMap-governor) as a parallel bank that gates R3's new DeployState kind; merge-train (R5) and the release-verification-lifecycle capstone (R6) follow.**

## §4 Mission scope summary

| Element | Scope | Tele (round) |
|---|---|---|
| Deploy-truth bank (R1→R2→R3) | **Wave-1 spearhead** — in scope, lead | tele-4, tele-13 (R1) |
| Full automation + safety envelope | In scope — ratified posture + R2 mandatory rails | tele-4, tele-8, tele-9 (R2) |
| R4 Shape-Conformance (renameMap-governor) | Parallel bank; gates R3's DeployState kind | tele-10, tele-12 |
| R5 Merge-Train | Follows the spearhead | tele-6 |
| R6 Release-Verification-Lifecycle | Capstone (CDACC-cadence gated on run-672bd0f) | tele-8, tele-9 |
| Mission class | structural-inflection (→ walkthrough retrospective) | — |

## §5 Anti-goals (out-of-scope; deferred)

1. **Whole-CLASS silent-failure elimination** — honest-scope (cal-81): C3 closes 3 observed instances + stands up 2 governors; it does NOT claim the entire silent-failure-on-the-path-to-prod class is universally closed (above-membrane mis-reads, shallow-/health-on-broken-runtime, non-delete corruptions remain named-uncovered).
2. **Any auto-path without its envelope** — no auto-rollback/auto-approve arms before the circuit-breaker + reversibility + external-prober + verifier-audit are in place.
3. **A serial L-spine** — execute as parallel banks with named owners, not one bottlenecked program.
4. **CDACC as a standing per-substrate cadence NOW** — gated on run-672bd0f completing + a retrospective proving super-additive value + bounded cost; R6 ships its CDACC-independent parts (Phase 7.5 manual interim + Phase-6 preflight) first.
5. **`ois-deploy` as a greenfield root binary now** — facet-shim over the MCP verb, designed to slot into the D-1 REST plane (design wf_514a4e05).
6. **Reopening the verifier advisory-not-gating contract** — verifier-role.md §1/§2.3 untouched; Steve's every-transition audit is non-gating.

## §6 Architect-flags / open questions for Phase 4 Design round-1 audit

1. **Roll-confirm SLA value** — the actual watchtower poll interval + acceptable max roll time, to anchor the SLA so a slow-but-healthy roll isn't false-alarmed (arc-design C3-Q3).
2. **R4 is an INCREMENT, not a from-scratch oracle** — `renamemap-contract-w1.test.ts` already has the W1.1c completeness gate + the W1.1b sentinel-probe; the residual gap is the hand-curated `SUBSTRATE_FILTERABLE_KEYS` bound → derive it from a static call-site scan. Put fail-loud at the **filter-translate** path (not decode — flat-spread recovers same-name relocations).
3. **DeployState (R3) sequenced UNDER R4's governor** — the new kind is the first dogfood of the code-derived renameMap oracle.
4. **partition-renameMap calibration filing** — architect↔Director bilateral (R4/R6); never LLM-autonomous per CLAUDE.md ledger discipline.
5. **The four automation surfaces → ONE batched governance proposal** for the Director's formal mechanism-ratification. This Survey ratified the *posture* (full automation + envelope); the per-surface proposals get a formal proposal artifact before each auto-path arms.
6. **cal-84 mechanism** — replace the degrade-then-poll-recover catch with fail-loud, OR add the 0-bare/anomaly monitor cal-84 recommends; specify inside R4.

## §7 Sequencing / cross-mission considerations

### §7.1 Branch + PR strategy
Per-rung PRs off main (the deploy bank R1→R2→R3 serial within-bank; R4 parallel). R5 merge-train itself retires the require-up-to-date treadmill + keyring approve dance, so it improves the very flow C3 ships through.

### §7.2 Composability with concurrent / pending work
- **D-1 REST control-plane** (design wf_514a4e05 in flight): `ois-deploy` (R3) is designed to slot into it as a resource/verb facet — soft-gate, not hard.
- **C1 work-control-plane** (keystone): verifier-gates + the every-transition audits become queued work-items in C1's loop.
- **R4 renameMap-governor** is cross-cutting: it gates EVERY new kind across the roadmap (C1 work-item, C2 lifecycle-state, C3 DeployState).
- **idea-306 (Rocky re-platform)**: R2 makes the bug-107 silent class LOUD ahead of that root fix (soft-dependency, not a prerequisite).

### §7.3 Same-day compressed-lifecycle candidate?
**Yes — R1 M-Roll-Signal** is the same-day bank (deploy-hub.yml already computes the digest; add gitSha/builtAt to /health + a CI roll-confirm step + the external prober interim). No autonomy surface → no governance gate → compressed-lifecycle eligible as the first concrete deliverable.

## §calibration — Calibration data point

Director time-cost ~4 minutes (6 picks across 2 AskUserQuestion rounds, rapid). Baseline: idea-206 first-canonical (~5 min) + idea-323 research-prepped Survey. Notes: the arc-design-panel-precedes-Survey pattern (the questions came from an adversarially-verified technical envelope, not spec-recall) is a methodology-evolution candidate for arc-class missions; the central full-automation-vs-integrity tension was resolved IN-Survey by constraint-satisfaction (Round-2 captured the envelope) rather than carried to Design.

## §8 Cross-references

- **idea-340** — C3 source idea (this Survey's `source-idea`)
- `docs/designs/c3-ship-integrity-spine-arc-design.md` — the arc design (Ultracode wf_d2f7bf06)
- `docs/reviews/autonomous-stint-arc-shortlist.md` — the 4-arc roadmap + council synthesis + D-1 directives
- `docs/methodology/idea-survey.md` v1.0 — the Survey methodology
- **D-1 REST control-plane design** — Ultracode wf_514a4e05 (in flight); `ois-deploy` slots into it
- `docs/specs/verifier-role.md` §1/§2.3 — advisory-not-gating contract (Q6 honors it)
- DR-002 / DR-008 / DR-010 / DR-011 (autonomous-stint decision log) — the proven gated-deploy + verifier-audit model R2's envelope generalizes
- bug-107 (CD token-race) · bug-138 / bug-170-layer2 (renameMap filter-miss) · cal-81 (no-subset-extrapolation) · cal-84 (degrade-then-poll-recover) · idea-306 (Rocky re-platform)
