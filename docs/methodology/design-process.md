# Design Process — Phase 4 as a work-graph blueprint (3-agent)

**Status:** v1.0 **RATIFIED** (Director, 2026-06-29) — folded its own adversarial review (`w2v97jvwm`, 16 findings; all 3 must-fixes accepted+folded, §13). Bootstrap note: v1.0's own `verify_reconcile` is trivially VALID — every must-fix was *accepted* (zero rejects), so there is no contested disposition for the floor to catch.
**Position in lifecycle:** Phase 4 (Design), between Idea/Survey (Phase 3) and Manifest (Phase 5).
**Supersedes/upgrades (EXECUTED at v1.0 — see §13):** `mission-lifecycle.md` §1 Phase 4 (the bilateral thread+doc Design), §1.5 RACI row (Phase-4), §1.5.1, §1.5.2 (verifier Phase-4 engagement), and `docs/specs/verifier-role.md` §1 (the "gate" language).
**Companions:** `idea-survey.md` (Phase 3, unchanged + bypassable), `mission-preflight.md` (Phase 6), `blueprints/autonomous-strategic-review.blueprint.json` (the template this clones).

---

## §0 Why this exists — what changed
The Design methodology in `mission-lifecycle.md` §1 Phase 4 is **thread/pulse-era and 2-agent**: architect drafts → engineer bilateral audit → bilateral ratify, as ad-hoc thread+doc artifacts, verifier bolted on as an advisory footnote. Two changes this doc re-casts Design onto:
1. **The graph-based work-queue** (`seed_blueprint` + work-graph nodes + `roleEligibility` + leases + gates) — the substrate the ASR proved can carry a sophisticated multi-agent process. Design is a blueprint, not a runbook.
2. **The third agent (verifier).** A 3-agent Design has the verifier as a **first-class red-team NODE** (mandatory, consumed — not advisory-on-request) **and** as a **process-integrity gate** (`verify_reconcile`) that certifies the reconcile honestly dispositioned the findings. (See §12 for the precise "node vs gate vs decision" semantics and the tele-13 reading.)

**Naming:** this doc uses **axiom** (the project-agnostic, evolved form of tele) as the canonical principle-vocabulary. `list_tele` is the interim access path until the tele→axiom retirement (idea-396) lands.

---

## §1 The node graph (6 nodes)
```
intent envelope  (Survey output, OR — bypassed — a Director-anchored brainstorm + decision-log; attested at node 1)
        │
        ▼
 1. design_draft       (task, [architect])     Design v0.1 + the proposed mission work-graph + reference-set
        │
        ├──────────── parallel, INDEPENDENT (blind to each other; §7) ────────────┐
 2. feasibility_audit  (task, [engineer])                 3. design_redteam (task, [verifier])
    scope-realism / build-feasibility /                      adversarial refute + CONFORMANCE MATRIX (§4)
    hidden-coupling / ground-truth                           + verdict (ready/ready-with-fixes/not-ready) — §12
        └──────────────────────────────────┬───────────────────────────────────────┘
        ▼
 4. reconcile          (task, [architect])    → Design v1.0 + DISPOSITION LEDGER (§5)
        │
        ▼
 5. verify_reconcile   (verifier-gate, [verifier])   the INDEPENDENCE FLOOR — certifies every violate/critical/major
        │                                            was accepted-and-folded OR rejected with a rationale the verifier
        │                                            accepts; emits an audit VALID/INVALID verdict → travels to ratify (§5/§12)
        ▼
 6. ratify             (task, [director], roleEligibility:[director])   the only DECISION gate (§6)
        │                                            interim: delegated-disposition audit-ratify · mechanised by idea-388
        ▼
   Manifest (create_mission) → the mission work-graph
```

## §2 Roles — the legs (orthogonal to INTEND)
| Leg | Role | Owns | Node(s) |
|---|---|---|---|
| SPECIFY | architect | the design + work-graph; reconcile + dispositions | design_draft, reconcile |
| BUILD-feasibility | engineer | scope-realism, build-feasibility, ground-truth | feasibility_audit |
| REFUTE | verifier | adversarial refutation + conformance (node) + disposition-integrity certification (gate) | design_redteam, verify_reconcile |
| INTEND | Director | ratify / redirect (the decision) | ratify |

feasibility_audit and design_redteam run **in parallel, blind to each other** (§7). The verifier appears twice — as a **producing node** (design_redteam, verdict = an *input*, non-vetoing) and as a **process gate** (verify_reconcile, fail-closed on dishonest disposition). Neither holds the *design decision* — that is the Director's at ratify (§12 tele-13 reading).

## §3 Per-node spec
- **1. design_draft** `(task, [architect])` — from the attested intent envelope, author Design v0.1 + the proposed mission work-graph + declare the per-design **reference-set** (§4). **Entry-input contract:** a required INPUT evidence-requirement naming the intent-envelope artifact (validated survey doc on the Survey path, OR brainstorm+decision-log on bypass) + a one-line architect attestation that `idea-survey.md` §8 bypass criteria held (clear/complete scope · Director-anchored · no major ambiguity). Evidence: Design v0.1 + the input attestation.
- **2. feasibility_audit** `(task, [engineer])` — scope-realism, build-feasibility, hidden-coupling, **ground-truth** (does it match the code? — the shim-audit pattern). Evidence: findings + a scope-realism verdict. *Blind to node 3 (§7).*
- **3. design_redteam** `(task, [verifier])` — independent adversarial refutation (contradictions / assumptions / gaps / risks / scope) **plus** the **conformance matrix** (§4) with a **frame-coverage attestation** (one row per declared frame incl. explicit "checked/no-violation" rows; "fanned out across all N frames; calibration-ledger checked at `<sha>`"). Emits a **verdict** (`ready` / `ready-with-fixes` / `not-ready`) — semantics in §12. Refute-not-produce; the verdict is an **input**, non-vetoing. Evidence: an **audit-kind** verdict (`producedBy` MUST resolve to a registered `role=verifier` Agent — bug-204 fold). *Blind to node 2 (§7).*
- **4. reconcile** `(task, [architect])` — fold feasibility + red-team into Design v1.0; produce the **disposition ledger** (§5). **Re-resolve every cited conformance ref from ground truth (FM-6)** so a `violate` can't be dispositioned away against an unresolvable citation. Apply the §5 conflict rule. Evidence: Design v1.0 + the disposition ledger.
- **5. verify_reconcile** `(verifier-gate, [verifier])` — **the independence floor.** Confirm every `violate`/`critical`/`major` feasibility+redteam finding was *accepted-and-folded* OR *rejected/deferred with a rationale the verifier accepts*. Fail-closed (INVALID) if a finding was silently dropped or rejected on a rationale the verifier rejects → bounce to reconcile. Emits an audit-kind VALID/INVALID verdict that travels to the Director with v1.0. (This is a **process** gate, not a design veto — §12.)
- **6. ratify** `(task, [director])` — the Director ratifies or redirects the *design* (§6). On ratify → Manifest.

## §4 Reference-set + conformance matrix (the principled layer)
The adversarial red-team answers *"is this design sound / self-consistent?"* The **reference-set** answers *"is this design conformant to what we believe?"* A design can pass every generic dimension and still violate an axiom or repeat a known pathology.

**Frames** (two tiers):
- **STANDING** (every design; blueprint default): **axioms** (foundational principles; canonical wording in mission-kit, 1:1 with live teles — *"does it violate a principle?"*) · **calibration-ledger** (named architectural-pathology patterns, `docs/calibrations.yaml` via the Skill — *"have we made this mistake before?"*).
- **PER-DESIGN** (declared in node 1): **north-star pillars** (the design's own goals) · **prior-art comparables** (when a comparison sharpens it).

**References are DATA, not topology** — a declared manifest the `design_redteam` node consumes and **fans out per-frame internally** (one check per frame). Blueprint topology is fixed regardless of frame count; a new frame is a manifest line, not a node. **Integrity protection** (since conformance is single-seat, like ASR `score_ver`): NOT a second producer, but **(a)** the §3 frame-coverage attestation (one row per declared frame, so a frame can't be silently skipped) **+ (b)** reconcile's FM-6 ref re-resolution **+ (c)** the verify_reconcile gate + Director ratify downstream.

**Output:** a conformance matrix (`design × frame → pass / flag / violate + evidence`). A `violate` becomes a must-fix disposition (§5). A compressed CDACC folded in as a declared data input. **Reference access (transitional, idea-397):** prose-pointers + manual-fetch now → normalised, **pinnable** refs later (`axioms@<sha>`); the axiom-frame: mission-kit / 1:1 teles now → imported-local after idea-396.

## §5 Disposition ledger + the independence floor
At `reconcile`, **every** feasibility/red-team finding gets an explicit disposition — `accept` (fold into v1.0) / `reject` (rationale) / `defer` (file follow-on) — plus, for any `violate`/`critical`/`major`, the rationale the **verify_reconcile** gate must accept. This is the **anti-silent-drop** mechanism (not "anti-rubber-stamp" — the *honesty* guard is the verify_reconcile gate at §3 node 5 + ratify, NOT presence-of-disposition alone). The originating auditor's finding and its disposition both travel to verify_reconcile, which is the **non-producer re-check** that closes the producer-self-adjudication gap (the architect drafts AND reconciles; the verifier — who never produced the design — certifies the reconcile's integrity).

**Conflict rule (feasibility vs red-team):** if a feasibility finding conflicts with a red-team finding, the architect states which lens precedes and why in the ledger; if unresolved, it escalates to **ratify** as an explicit Director decision item (never silently picked).

## §6 The ratify gate (Director-decision-node)
`ratify` is a `roleEligibility:[director]` node — the only **decision** gate. It unifies the Director-decision surface with **idea-388** (Director-work-queue) and holds tele/axiom authority-non-delegation (the Director is Accountable for the design decision).
- **Tooling gap (bug-205):** a `[director]` node cannot be *closed* today. **idea-388 mechanises the close**; ratify is its first consumer.
- **Interim (until idea-388):** delegated-disposition — the Director ratifies out-of-band, and the disposition is recorded via an Audit entry. **In Director-dark autonomous runs the ratify-disposition Audit is authored by the VERIFIER, not the architect**, so the loop never closes on the producer (the §5 independence floor extends into dark-mode ratify).

## §7 Independence mechanism (light, but CONSTRUCTED)
feasibility_audit and design_redteam run **in parallel, each blind to the other's output**, revealed at reconcile — decorrelating the two lenses (lineage-diverse verifier) without the ASR's seal-hash machinery. **Blinding is soft (no Hub primitive enforces it), so the blueprint MUST carry a runbook-level clause on BOTH parallel nodes: "read ONLY Design v0.1; do NOT read the other leg's output; reveal at reconcile"** (mirrors the ASR `score_*` "do NOT read" clauses). This makes §7 constructed, not aspirational.

## §8 Relationship to Survey (Phase 3)
Survey (`idea-survey.md`) is **unchanged and bypassable** (its §8). When bypassed, the **brainstorm + decision-log is the intent envelope** feeding design_draft — and node 1's entry-input attestation (§3) makes that bypass auditable. The adapter Design is the canonical bypass instance.

## §9 Output artifacts
Design v1.0 (`docs/designs/<mission>-design.md`) · the conformance matrix (design_redteam) · the disposition ledger (reconcile) · the verify_reconcile VALID/INVALID audit · the proposed mission work-graph (→ Manifest) · the ratify Audit (interim) or closed `[director]` node (post-idea-388).

## §10 First canonical execution — the adapter Design (dogfood)
The **M-Adapter-Modernization Design** is the first execution; nodes 1–3 already ran manually:
- **design_draft** = the brainstorm + decision-log; **feasibility_audit** = the shim-audit; **design_redteam** = the adversarial review (`w6e5e0dqp`, `ready-with-fixes`, 3 must-fix); **reconcile** = NEXT; **verify_reconcile / ratify** = then.
- **Independence caveat (one-time deviation):** the adapter `design_redteam` ran only the 6 generic dimensions, NOT the §4 conformance matrix. The conformance pass should be added — and to preserve §4 independence it must be **re-engaged with the verifier** (a design_redteam conformance-only addendum that reconcile *dispositions*), **NOT** scored by the architect at reconcile. This is a one-time dogfood deviation; future runs do not copy architect-scored-conformance-at-reconcile.

## §11 Open items + forward
- **The `seed_blueprint` JSON** (`blueprints/design-process.blueprint.json`) is authored from this verified spec. **Encoding fixes to fold at JSON-authoring:** node 6 = `type:"task"` + `roleEligibility:["director"]` (mirroring ASR `director_ratify`) — **DROP the prose token "director-decision-node"** (not a valid WORK_TYPE; a literal encoding fails the atomic seed → zero nodes); node 3 = `type:"task"` + `roleEligibility:["verifier"]` (a producing node, like ASR `score_ver`); node 5 = `type:"verifier-gate"`; carry the §7 "do-not-read" runbook clause on nodes 2+3.
- **Verifier availability (symmetric with bug-205):** design_redteam + verify_reconcile are `[verifier]`-only on the critical path → a quota-blocked/unavailable verifier stalls Design. Degraded path: pause → resume on `signal_quota_recovered` → Director-waiver/escalation after a stated timeout. Do NOT add an architect-fallback red-team (defeats §7). General 3-agent single-holder assumption (the [engineer]/[architect] legs too).
- **idea-388** mechanises the §6 ratify close (bug-205). **idea-397** makes the §4 reference-set machine-resolvable + pinnable. **idea-396** makes the §4 axiom-frame imported-local.

## §12 Verdict semantics + the tele-13 reading (the headline mechanism)
**Resolution of "gate":** `design_redteam` is a **first-class red-team NODE/leg**, NOT a blocking gate — the upgrade over the old advisory-`C` footnote is *advisory-on-request → mandatory, consumed, structural node feeding reconcile*. Its **verdict is an INPUT** (binding-to-disposition, non-vetoing). The **only DECISION gate is ratify** (Director). The **only verifier-owned GATE is verify_reconcile** — and it gates **process integrity** (were findings honestly dispositioned?), **not the design decision**.
- **tele-13 (authority-non-delegation) holds:** the verifier holds no design veto; the architect dispositions (§5); the Director decides (§6). `verifier-role.md` §1's "a verifier verdict is an input to a gate, never the gate itself" reads as **never the *decision* gate** — the verifier MAY own a *process-certification* gate (as the ASR already does: `pack_gate`, `verify_ranking`), which fail-closes on integrity, not on the design choice.
- **Verdict handling:** `ready` / `ready-with-fixes` → reconcile dispositions every finding (must-fixes folded) → verify_reconcile → ratify. `not-ready` (or a `ready-with-fixes` whose must-fixes the architect will NOT accept) → reconcile records the rejected-must-fix rationale → **verify_reconcile is the test**: if the verifier rejects the rationale (INVALID), **bounce to design_draft** for a revised v0.x. **Revision bound:** at most **2 bounce cycles**; a 3rd unresolved → escalate to **ratify** as an explicit Director decision item (don't spin). The verdict never silently no-ops.

## §13 Review disposition ledger (v0.1 → v1.0 — dogfooding §5 on this doc's own review `w2v97jvwm`)
| Finding | Disposition |
|---|---|
| MF1 — design_redteam verdict semantics undefined / "gate" vs tele-13 | **ACCEPT + folded** — §12 (demote to NODE/leg; verify_reconcile is the only verifier gate, process-not-decision; not-ready handling + 2-bounce bound) |
| MF2 — reconcile producer-judges-own-design, no independence floor | **ACCEPT + folded** — §5 + new node 5 `verify_reconcile` + §6 dark-mode-ratify-via-verifier + §5 conflict rule + "anti-silent-drop" rewording |
| MF3 — supersede asserted not executed (#58) | **ACCEPT + folded** — §13b supersede notes added to `mission-lifecycle.md` + `verifier-role.md`; header §-list enumerated; tracked here |
| SA — blueprint-encoding (director node type, label drift, do-not-read) | **ACCEPT + deferred to JSON-authoring**, tracked §11 |
| SA — §7 independence not constructed | **ACCEPT + folded** — §7 do-not-read clause |
| SA — §10 conformance-at-reconcile collapses independence | **ACCEPT + folded** — §10 one-time-deviation caveat |
| SA — single-verifier availability | **ACCEPT + folded** — §11 degraded path |
| SA — no entry-input attestation | **ACCEPT + folded** — §3 node 1 entry-input contract |
| SA — conformance frame-coverage attestation | **ACCEPT + folded** — §3 node 3 + §4 integrity protection |

**§13b — supersede executed:** forward-pointer/deprecation notes added to `mission-lifecycle.md` §1 (phase list), §1.5 (RACI Phase-4 row + the "verifier never holds R/A" line), §1.5.2 (Phase-4 verifier engagement), and `verifier-role.md` §1 ("gate" = decision-gate clarification). All point here as canonical for Phase 4.

---
*v1.0 — author: lily, 2026-06-29. Folded the `w2v97jvwm` review (its own design_redteam gate). Pending Director ratify.*
