# Design Process — Phase 4 as a work-graph blueprint (3-agent)

**Status:** v0.1 DRAFT (2026-06-29, architect lily) — pending its own adversarial review + Director ratify.
**Position in lifecycle:** Phase 4 (Design), between Idea/Survey (Phase 3) and Manifest (Phase 5).
**Supersedes/upgrades:** `mission-lifecycle.md` §1 Phase 4 (the bilateral thread+doc Design) + upgrades the verifier RACI `mission-lifecycle.md` §1.5.2 (advisory-`C` → a first-class red-team **gate**).
**Companions:** `idea-survey.md` (Phase 3, unchanged + bypassable), `mission-preflight.md` (Phase 6), `strategic-review.md` / `ledger-reconciliation.md` (the ASR shares this blueprint substrate), `blueprints/autonomous-strategic-review.blueprint.json` (the template this clones).

---

## §0 Why this exists — what changed
The Design methodology in `mission-lifecycle.md` §1 Phase 4 is **thread/pulse-era and 2-agent**: architect drafts Design v0.1 → engineer bilateral audit → bilateral ratify v1.0, as ad-hoc thread+doc artifacts, with the verifier bolted on as an advisory footnote. Two things have since changed that this doc re-cast Design onto:
1. **The graph-based work-queue** (`seed_blueprint` + work-graph nodes + `roleEligibility` + leases + gates) — the substrate the ASR proved can carry a sophisticated multi-agent process. Design should be a blueprint, not a runbook.
2. **The third agent (verifier).** A 3-agent Design has the verifier as a **first-class red-team gate** (independent refutation before ratification), not an advisory-`C`.

**Naming:** this doc uses **axiom** (the project-agnostic, evolved form of tele) as the canonical principle-vocabulary. `list_tele` is the interim access path until the tele→axiom retirement (idea-396) lands; the canonical agnostic wording lives in mission-kit and will be imported local.

---

## §1 The node graph (5 nodes)
```
intent envelope  (Survey output, OR — bypassed — a Director-anchored brainstorm + decision-log)
        │
        ▼
 1. design_draft       [architect]   Design v0.1 + the proposed mission work-graph
        │
        ├──────────── parallel, INDEPENDENT (decorrelated lenses; §7) ────────────┐
 2. feasibility_audit  [engineer]                     3. design_redteam [verifier]
    scope-realism / build-feasibility /                  adversarial refute  +
    hidden-coupling / ground-truth                       CONFORMANCE MATRIX (§4)
        └──────────────────────────────────┬───────────────────────────────────────┘
        ▼
 4. reconcile          [architect]   → Design v1.0  +  DISPOSITION LEDGER (§5)
        │
        ▼
 5. ratify             [director-decision-node, roleEligibility:[director]]  (§6)
        │                            interim: delegated-disposition audit-ratify · mechanised by idea-388
        ▼
   Manifest (create_mission) → the mission work-graph
```

## §2 Roles — the three legs (orthogonal to INTEND)
| Leg | Role | Owns | Node |
|---|---|---|---|
| SPECIFY | architect | the design + its work-graph; reconcile + dispositions | design_draft, reconcile |
| BUILD-feasibility | engineer | scope-realism, build-feasibility, ground-truth (does it match the code?) | feasibility_audit |
| REFUTE | verifier | independent adversarial refutation + conformance scoring | design_redteam |
| INTEND | Director | ratify / redirect | ratify |

feasibility_audit (engineer) and design_redteam (verifier) run **in parallel and independent** — the two lenses must decorrelate (the verifier is cross-lineage, so its blind spots differ from the engineer's). See §7.

## §3 Per-node spec
- **1. design_draft** `[architect]` — from the intent envelope, author Design v0.1 + the proposed mission work-graph (the wave plan as a graph). Declare the per-design **reference-set** (§4: the conformance frames). Evidence: the Design v0.1 doc.
- **2. feasibility_audit** `[engineer]` — scope-realism, build-feasibility, hidden-coupling, and **ground-truth** (does the design match what's actually in the code? — the shim-audit pattern). Evidence: a structured findings doc + a scope-realism verdict.
- **3. design_redteam** `[verifier-gate]` — independent adversarial refutation (contradictions / unstated assumptions / gaps / risks / scope) **plus** the **conformance matrix** (§4: design × frames → pass/flag/violate + evidence). Refute-not-produce. Evidence: an **audit-kind** verdict (the verifier's durable surface; `producedBy` MUST resolve to a registered `role=verifier` Agent — bug-204 fold) carrying findings + the conformance matrix + a readiness verdict (`ready` / `ready-with-fixes` / `not-ready`).
- **4. reconcile** `[architect]` — fold feasibility + red-team into Design v1.0; produce the **disposition ledger** (§5: accept/reject/defer per finding, with rationale). Evidence: Design v1.0 + the disposition ledger.
- **5. ratify** `[director-decision-node]` — Director ratifies or redirects (§6). On ratify → Manifest.

## §4 Reference-set + conformance matrix (the principled layer)
The adversarial red-team answers *"is this design sound / self-consistent?"* The **reference-set** answers a different question — *"is this design **conformant to what we believe**?"* A design can pass every generic dimension and still violate an axiom or quietly repeat a known pathology. The reference-set is the org's accumulated wisdom applied as a checklist.

**Frames** (two tiers):
- **STANDING** (apply to every design; blueprint default):
  - **axioms** — the foundational principles (canonical wording in mission-kit; 1:1 with the live teles). *"Does the design violate a principle?"*
  - **calibration-ledger** — the named architectural-pathology patterns (`docs/calibrations.yaml`, queried via the Skill). *"Have we made this mistake before?"* — highest-value, because it's hard-won and already codified.
- **PER-DESIGN** (declared in the blueprint args):
  - **north-star pillars** — this design's own stated goals.
  - **prior-art comparables** — when a comparison sharpens the design (scion was this for the adapter).

**Implementation discipline — references are DATA, not topology.** The reference-set is a declared manifest the `design_redteam` node consumes and **fans out per-frame *internally*** (one check per frame, as the manual review fanned out 6 dimensions). The blueprint topology stays **fixed at 5 nodes** regardless of how many frames are declared — a new axiom or pathology to check against is **a manifest line, not a node.** (Same data-vs-topology discipline as the adapter shim-manifest decision — the methodology obeying its own architecture rule.)

**Output:** a **conformance matrix** (`design × frame → pass / flag / violate + evidence`), emitted alongside the red-team findings. A `violate` row becomes a must-fix disposition in §5. This is a compressed CDACC (conformance-against-frames) folded into the Design blueprint as a declared data input rather than a separate council.

**Reference access (transitional; see idea-397 normalised-reference-syntax):** until the reference-resolver lands, frames are **prose-pointers + manual-fetch** (proven: the adapter Design fetched scion + read `docs/calibrations.yaml` this way). End-state = normalised, **pinnable** refs (`axioms@<sha>`, `scion@<sha>`) so a conformance-check is reproducible. The axiom-frame's access path is itself transitional: mission-kit / 1:1 live teles now → imported-local axioms after idea-396.

## §5 Disposition ledger
At `reconcile`, **every** feasibility/red-team finding gets an explicit disposition — `accept` (fold the fix into v1.0) / `reject` (with rationale) / `defer` (file as a follow-on). This is the auditable reconcile artifact and the anti-rubber-stamp: a design cannot graduate with un-dispositioned `violate`/`critical`/`major` findings. (The adapter Design's "graduation checklist" — 3 must-fix + 6 should-address with dispositions — is the canonical first instance.)

## §6 The ratify gate (Director-decision-node)
`ratify` is a `roleEligibility:[director]` node — it unifies the Director-decision surface with **idea-388** (Director-work-queue) and respects tele/axiom authority-non-delegation (the Director stays Accountable at the gate).
- **Tooling gap (bug-205):** a `[director]`-only node cannot be *closed* today (no Director agent + the architect can't claim a `[director]` node). **idea-388 mechanises the close** (claim → decide → close + a director interface); the ratify gate is its first concrete consumer.
- **Interim (until idea-388 ships):** the **delegated-disposition path** — the Director ratifies out-of-band (verbal/thread), the architect records the disposition via an Audit entry, as in the ASR. Director-dark autonomous runs use the same recorded-disposition path.

## §7 Independence mechanism (light)
`feasibility_audit` and `design_redteam` run **in parallel, each blind to the other's output**, revealed at `reconcile`. This decorrelates the two lenses (lineage-diverse verifier) without the ASR's full seal-hash machinery — that existed to stop *score-anchoring*; here we only need the two lenses not to anchor on each other. No sealing of the draft is required (both legs read the same Design v0.1).

## §8 Relationship to Survey (Phase 3)
Survey (`idea-survey.md`) is **unchanged and still bypassable** (§8 of that doc). When bypassed — Director-anchored, sufficiently-scoped intent — the **brainstorm + decision-log serves as the intent envelope** (the "solved matrix") feeding `design_draft`. The adapter Design is the canonical bypass instance (multi-turn Director-anchored walkthrough = the envelope; no survey doc).

## §9 Output artifacts
- **Design v1.0** doc at `docs/designs/<mission>-design.md`
- **Conformance matrix** (design × frames) — from `design_redteam`
- **Disposition ledger** (accept/reject/defer per finding) — from `reconcile`
- **The proposed mission work-graph** — fed to Manifest (Phase 5 `create_mission`)
- A ratify Audit entry (interim) or a closed `[director]` ratify node (post-idea-388)

## §10 First canonical execution — the adapter Design (dogfood)
The **M-Adapter-Modernization Design** is the first execution, and it has already run nodes 1–3 manually:
- **design_draft** = the brainstorm + decision-log (`docs/designs/m-adapter-modernization-brainstorm.DRAFT.md`)
- **feasibility_audit** = the shim-audit (`m-adapter-modernization-shim-audit.md`) — engineer-leg ground-truth
- **design_redteam** = the adversarial review (runId `w6e5e0dqp`) — verifier-leg; verdict `ready-with-fixes`, 15/32 confirmed, 3 must-fix
- **reconcile** = NEXT (fold the 3 must-fixes → Design v1.0 + the disposition ledger; the graduation checklist is the ledger's seed)
- **ratify** = the Director gate (interim delegated-disposition)

This is the substrate-self-dogfood pattern applied to the methodology: we define the Design-process, then run the adapter Design through it. (Note: the adapter Design's `design_redteam` did NOT yet run the §4 conformance-matrix against axioms/calibration-ledger — only the 6 generic dimensions; the reconcile/v1.0 step should add that conformance pass.)

## §11 Open items + forward
- **The `seed_blueprint` JSON** (`blueprints/design-process.blueprint.json`) is authored AFTER this spec passes its own adversarial review (spec → review → blueprint, so review fixes don't force a JSON rewrite). Clones `autonomous-strategic-review.blueprint.json`.
- **idea-388** (Director-work-queue) — mechanises the §6 ratify-gate close; bug-205 is the concrete gap.
- **idea-397** (normalised reference syntax) — makes the §4 reference-set machine-resolvable + pinnable; interim = prose-pointers.
- **idea-396** (tele→axiom retirement) — the §4 axiom-frame becomes imported-local; interim = mission-kit / 1:1 teles.
- **mission-kit axiom access** — TODO at blueprint-build: the access path from a `design_redteam` node to the mission-kit axiom set (resolved by idea-397 / idea-396).

---
*v0.1 DRAFT — author: lily, 2026-06-29. Pending its own adversarial review (dogfooding the §3 design_redteam gate) + Director ratify.*
