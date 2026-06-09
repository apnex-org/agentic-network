---
mission-name: M-Substrate-List-Filter-Envelope-Translation
source-idea: idea-323
methodology-source: docs/methodology/idea-survey.md v1.0
director-picks:
  round-1:
    Q1: a
    Q1-rationale: Maximal scope — fold idea-324 (+likely idea-318); own bug-138's entire systemic surface in one closure
    Q2: a
    Q2-rationale: Promote renameMap to first-class runtime SchemaDef field; generic field-translation for any key/any kind
    Q3: a
    Q3-rationale: Re-migrate residual legacy rows then envelope-only filter; eliminate dual-shape window structurally
  round-2:
    Q4: a
    Q4-rationale: One mission identity, internally multi-wave with per-wave release-gates (not split-program, not big-bang)
    Q5: a
    Q5-rationale: Absorb idea-318 + idea-320 + idea-324 — close the entire envelope-substrate-maturity surface in one program
    Q6: a
    Q6-rationale: Reversible re-migration + shadow-read parity on prod snapshot before strict-flip + rehearsed rollback
mission-class: saga-substrate-completion
tele-alignment:
  primary: [tele-N, tele-M]
  secondary: [tele-X, tele-Y]
  round-1:
    primary: [structural-elimination, substrate-fidelity]
    secondary: [anti-silent-failure]
  round-2:
    primary: [structural-elimination, substrate-fidelity]
    secondary: [anti-silent-failure]
  # NOTE: tele short-names are placeholders pending docs/methodology/tele-glossary.md
  # resolution at Design (tele-alignment research bundle returned null). Pin exact
  # tele-N IDs in §4 before finalize-gate.
anti-goals-count: 6
architect-flags-count: 8
skill-meta:
  skill-version: survey-v1.0
  tier-1-status: implemented
  tier-2-status: stubbed
  tier-3-status: stubbed
calibration-data:
  director-time-cost-minutes: 15
  comparison-baseline: idea-206 first-canonical Survey + mission-69 §15-schema Survey
  notes: >-
    Architect-estimate (2 structured pick-rounds, rapid Director picks). NOVEL: this Survey
    was preceded by a 6-agent research-fan-out Workflow (ultracode) that built a code-verified
    technical envelope BEFORE question-design — producing sharper, ground-truth-anchored
    questions (e.g. the renameMap-not-at-runtime finding that became Q2) vs spec-recall.
    Methodology-evolution candidate: fold an optional "research-prep pre-step" into
    idea-survey.md for substrate-class missions where the question-quality depends on
    code-truth. Also NOVEL: maximal scope-EXPANSION at Survey (idea-323 medium →
    saga-substrate-completion absorbing idea-318+320+324) — Survey functioned as a
    scope-discovery instrument, not just intent-capture. 3 of 5 research agents failed
    structured-output (StructuredOutput-not-called); synthesis agent compensated via own
    verification — calibration candidate for workflow schema-compliance robustness.
contradictory-constraints:
  # Optional; required when contradictory multi-pick detected per idea-survey.md §7
  # - round: 1
  #   questions: [Q-2]
  #   picks: [a, c]
  #   constraint-envelope: <description of common-satisfiable constraint Director is signaling>
calibration-cross-refs:
  closures-applied: []
  candidates-surfaced: []
---

# M-Substrate-List-Filter-Envelope-Translation — Phase 3 Survey envelope

**Methodology:** `docs/methodology/idea-survey.md` v1.0 (3+3 Director-intent pick-list)
**Source idea:** idea-323
**Mission-class candidate:** saga-substrate-completion (scope-expanded at Survey from idea-323's medium substrate-introduction)
**Branch:** `agent-lily/m-envelope-substrate-completion` (push pre-bilateral round-1 audit per calibration #59 closure mechanism (a))

---

## §0 Context

idea-323 (M-Substrate-List-Filter-Envelope-Translation) is the systemic closure of the substrate filter-translation defect class: `substrate.list` filter-keys are not translated to envelope JSONB sub-paths, so list/filter queries silently miss envelope-shape rows. Filed at mission-89 Phase 5 close (`sourceMissionId=mission-89`) as the option-(b) systemic refactor that PR #303's engineer-side scope-cut deferred (lineage: `docs/audits/m-substrate-occ-primitive-closing-audit.md` §4). The defect is the worst substrate class — silent, not loud: consumers (including the Survey + ledger-reconciliation flows' own list tools) trust corrupted results with no error surfaced.

**Verified impact surface (code-confirmed during Survey prep):** 8 MCP list tools affected across two independent root-cause layers — (1) substrate layer `postgres-substrate.ts::jsonbField:482` maps bare `"status"` → `data->>'status'` (NULL for envelope `{phase:...}` rows; hits `list_bugs` 1-of-52, `list_turns`); (2) policy layer `list-filters.ts::matchField:217` FieldAccessors return the raw object, `{phase:"open"}==="open"`→false (hits `list_ideas` 2-of-217, `list_threads`, `list_proposals`, `list_tele`). `list_missions` mitigated (repo UNION fix); `list_tasks` safe; `get_pending_actions` mis-count = bug-143 defect-3. The proven fix-pattern already ships in `mission-repository::findByCascadeKey` (dual-lookup) + `system-policy::getPendingActions` (`phaseFromEntity()`) — this mission generalizes a proven pattern.

**Load-bearing finding:** the per-kind `status→status.phase` translation table exists ONLY inside the one-time v2-envelope MIGRATION modules' `renameMap`; the runtime `SchemaDef` interface (`storage-substrate/types.ts:14`) does NOT carry it and the reconciler never reads it. So the idea's literal premise ("substrate.list reads SchemaDef renameMap") requires promoting a migration-only artifact to a runtime contract. The `SchemaReconciler` already has a runtime watch-loop on `SchemaDef` — so the promotion extends an existing runtime path, not net-new infra.

**Composable ideas:** idea-324 (M-Repository-Envelope-Native; the explicit companion) + idea-318 (M-SchemaDef-Reconciler-Status-Write-Patch; same reconciler surface) + idea-320 (substrate read-normalization) — all in the orbit; Round-1 Q1 pick determines which fold in. Methodology anchor: `docs/methodology/idea-survey.md` v1.0.

---

## §1 Round 1 picks

| Q | Pick | Director-intent reading (1-line summary) |
|---|---|---|
| Q1 — Scope cut-line | **a** Maximal — fold 323+324 | Own bug-138's entire systemic surface in one mission; idea-324 (and likely idea-318) absorbed |
| Q2 — Translation source-of-truth | **a** Promote renameMap to runtime | renameMap becomes a first-class runtime SchemaDef field; generic field-translation for any key/any kind |
| Q3 — Dual-shape durability | **a** Re-migrate + envelope-only | Sweep residual legacy rows to envelope, then filter envelope-only; eliminate the dual-shape window structurally |

**Questions as presented (Round 1):**

**Q1 — Scope cut-line:** idea-323's defect lives in TWO independent layers — the substrate translate-point (jsonbField; hits list_bugs/list_turns) AND the policy-layer FieldAccessors (matchField object≠string; hits list_ideas/list_threads/list_proposals/list_tele). How wide is THIS mission's owned surface? (a) Maximal — fold 323+324; (b) Both layers, 324 separate; (c) Substrate chokepoint only. → **picked (a)**

**Q2 — Translation source-of-truth:** The status→status.phase translation exists only inside the one-time v2-envelope migration modules' renameMap; the runtime SchemaDef does NOT carry it (code-verified). Where should substrate.list's runtime translation table come from? (a) Promote renameMap to runtime SchemaDef field; (b) Read from migration modules at runtime; (c) Hardcode envelope convention. → **picked (a)**

**Q3 — Dual-shape durability:** Production cutover is COMPLETE (22 kinds @100% envelope, 2026-05-25). What posture toward the legacy-shape branch? (a) Re-migrate residual rows + envelope-only filter; (b) Envelope-only now, no data change; (c) Permanent dual-lookup defense-in-depth. → **picked (a)**

### §1.Q1 — Per-question interpretation

The Director chose the maximal cut-line: idea-323 owns the *entire* bug-138 systemic surface — both root-cause layers (substrate `jsonbField` + the 4 policy-layer FieldAccessors) AND idea-324's per-kind repository-wrapper + sweeper-filter + task-internal-read classes — collapsing the 323/324 pair into one closure. Read against the Original-Idea (filed as the option-(b) systemic refactor deferred at PR #303) this is a deliberate escalation from "ship the substrate translate-point, leave 324 as companion" to "close the class, no partial-close residue." Tele-mapping: leans hardest on **structural-elimination** (a single mission structurally eliminates the whole silent-failure class vs leaving a known-broken companion-shaped gap) + **substrate-fidelity**. Aggregate-surface coherence: this pick is the one that most reshapes mission size — it is the dominant size driver and the trigger for the mission-class reclassification flagged below.

### §1.Q2 — Per-question interpretation

The Director chose to promote `renameMap` to a first-class runtime `SchemaDef` field so `substrate.list` reads it generically and translates *any* filter key (status, sourceThreadId, field-collision renames like Message.kind→metadata.messageKind) for *any* kind — the idea's literal architectural intent + the most general option. Read against the load-bearing finding (renameMap currently migration-only; reconciler has an existing runtime watch-loop on SchemaDef), this is the maximally-declarative posture: one runtime contract closes the entire field-translation class, not just status, and composes naturally onto the reconciler's existing runtime path. Tele-mapping: **substrate-fidelity** (the translation must be true for all envelope fields, not just status) + **structural-elimination** (declarative contract vs per-callsite whack-a-mole). Aggregate-surface: this pick + Q1(a) together mean the mission delivers a *new runtime declarative primitive* (renameMap-at-SchemaDef) consumed by the full swept surface — a substrate-capability addition, which is why mission-class likely shifts off pure "introduction."

### §1.Q3 — Per-question interpretation

The Director chose to actively re-migrate residual legacy-shape rows to envelope-shape (driven through the SchemaDef-reconciler / migration pipeline) and then make `substrate.list` filter envelope-only — eliminating the dual-shape window structurally rather than carrying a permanent legacy-fallback branch. Read against the verified cutover-complete state (22 kinds at 100% envelope as of 2026-05-25 strict-flip), this bets on cutover-completeness AND hardens it: rather than trust-the-cutover-passively (option b) or carry-forever-debt (option c), it drives residual stragglers to convergence + then drops the legacy branch. This is the "redesign over perpetual-accommodation" disposition (methodology #25 / Director-progressive-question lineage). Tele-mapping: **structural-elimination** + **substrate-fidelity**. Aggregate-surface: this is the pick that makes the mission touch *persisted data* (not pure read-path), raising the validation + rollback bar — a primary Round-2 axis.

**Round-1 composite read:** Three maximalist picks that compound coherently — fold-the-class (Q1a) + most-general-runtime-contract (Q2a) + structurally-eliminate-the-dual-shape-window (Q3a) — converging on a single ambitious mission that adds a runtime declarative primitive, sweeps the full consumer surface, and re-migrates data. No contradictory multi-picks. The aggregate is materially larger than idea-323-as-filed (medium substrate-introduction): it reads as a **structural-inflection / saga-substrate-completion-scale** multi-wave mission. Round-2 must pin (a) mission-class + wave-decomposition, (b) the runtime-contract reach, and (c) validation/rollback rigor for the data-touching re-migration.

---

## §2 Round 2 picks

| Q | Pick | Director-intent reading (1-line summary) |
|---|---|---|
| Q4 — Delivery structure | **a** One mission, gated waves | Single structural mission, internally multi-wave with per-wave release-gates |
| Q5 — Fold boundary | **a** Absorb 318+320+324 | Close the entire envelope-substrate-maturity surface in one program |
| Q6 — Re-migration safety | **a** Reversible + shadow-validated | Shadow-read parity on prod snapshot before strict-flip + rehearsed rollback |

**Questions as presented (Round 2):**

**Q4 — Delivery structure:** The three Round-1 maximalist picks compound into a structural-inflection-scale mission. How should the work be structured and released? (a) One mission, internally gated waves; (b) Split: foundation-mission → sweep-mission; (c) Single big-bang wave. → **picked (a)**

**Q5 — Fold boundary:** Q1(a) folds idea-324; two adjacent ideas touch the same reconciler/envelope surface — idea-318 (reconciler write-patch) + idea-320 (read-normalization). What is the exact fold boundary? (a) Absorb 318+320+324; (b) 324 only; (c) Reconsider the fold. → **picked (a)**

**Q6 — Re-migration safety:** Q3(a) re-migrates persisted production data. What safety/validation bar? (a) Reversible + shadow-validated (parity on prod snapshot + rehearsed rollback); (b) Reversible + dry-run; (c) Forward-only. → **picked (a)**

### §2.Q4 — Per-question interpretation

Against the Round-1 maximalist scope (fold-the-class) the Director chose to keep it ONE mission identity but internally decompose into gated waves — not a split program (option b) nor a big-bang (option c). Read against the aggregate Round-1 surface (a mission that adds a runtime contract + sweeps both layers + re-migrates data), this is the discipline-defended-maximalism signature: maximal scope held in a single mission, but de-risked through per-wave release-gates rather than mechanical scope-reduction. The natural wave-spine the gates imply: (W1) renameMap-runtime-SchemaDef contract + reconciler translation primitive → (W2) substrate translate-point consumes it → (W3) policy FieldAccessor sweep → (W4) repo-wrapper + sweeper sweep (idea-324 surface) → (W5) reversible re-migration + shadow-validation + envelope-only strict-flip. Round-2 tele: **structural-elimination** (one mission closes the class) held with **substrate-fidelity** discipline (gates prove each wave before the next). Aggregate-surface: confirms mission-class as a single multi-wave structural mission, not a program-of-missions.

### §2.Q5 — Per-question interpretation

The Director widened the fold boundary to absorb ALL adjacent envelope/reconciler-surface ideas — idea-318 (SchemaDef-reconciler-status-write-patch), idea-320 (substrate read-normalization), idea-324 (repository-envelope-native) — into one grand unification, beyond the Q1(a) "323+324 (+likely 318)" gesture. Read against the load-bearing finding (renameMap promoted to a runtime SchemaDef contract consumed by the reconciler's existing watch-loop), this is coherent: once the reconciler carries a runtime field-translation contract, the write-validation patch (318), the read-normalization (320), and the repo-wrapper encapsulation (324) all become consumers of the SAME contract — folding them avoids shipping three missions that each re-touch the reconciler/envelope surface. This is the structural-elimination tele at program scale: retire the maximum follow-on debt in one arc. Aggregate-surface: this is the pick that definitively reclassifies the mission as a **saga-substrate-completion** — it completes the envelope-substrate maturity arc (begun mission-88 K8s-envelope, continued mission-89 OCC) by closing every remaining envelope-shape consumer-code seam network-wide.

### §2.Q6 — Per-question interpretation

For the only data-touching part of the mission (the W5 re-migration), the Director chose the highest safety bar: reversible reconciler-driven re-migration + shadow-read parity-check (old-path vs new-path on a prod snapshot) before the envelope-only strict-flip, with a rehearsed rollback path. Read against the verified cutover-complete state (22 kinds @100% envelope), the straggler set is likely near-empty — yet the Director still chose shadow-validation over the proportionate dry-run (option b) or forward-only (option c). This is the discipline-defended posture applied to data-risk: the maximalist scope earns a maximalist safety bar, paid in process (shadow-read + rollback rehearsal) not in scope-reduction. It also sets the validation contract for the whole mission: the W5 gate cannot pass without old-vs-new parity evidence. Round-2 tele: **anti-silent-failure** (shadow-read makes any re-migration drift loud before strict-flip) + **substrate-fidelity**.

**Round-2 composite read:** Three picks that hold maximal scope inside disciplined containment — one gated-wave mission (Q4a) absorbing the full envelope-substrate-maturity surface (Q5a: 318+320+324) with shadow-validated reversible re-migration (Q6a). The envelope is internally consistent end-to-end: maximal ambition, defended by per-wave gates + shadow-validation rather than by cutting scope. No contradictory multi-picks across either round.

---

## §3 Composite intent envelope

**The solved matrix.** idea-323 is ratified not as the medium substrate-introduction it was filed as, but as the **completion of the envelope-substrate maturity saga** — a single, internally-gated, multi-wave mission that closes every remaining envelope-shape consumer-code seam network-wide. The six picks resolve to one coherent shape: *deliver a new runtime declarative primitive (renameMap promoted to a first-class `SchemaDef` field, consumed by the reconciler's existing watch-loop), make it the universal field-name-resolution authority across the full substrate read/write surface, sweep every consumer to it, then reversibly re-migrate residual legacy-shape rows and drop the dual-shape branch — all held in one mission identity, de-risked by per-wave release-gates and a shadow-validated re-migration rather than by scope-reduction.*

**Primary outcome:** the substrate filter-translation silent-failure class (bug-138) is structurally eliminated network-wide — all 8 envelope-blind list tools + `get_pending_actions` + the sweeper/repo/task-internal-read surfaces become envelope-correct by consuming one declarative runtime contract, and the legacy-shape branch is retired (no perpetual dual-lookup debt).

**Secondary outcomes:** (1) a reusable runtime field-translation primitive that serves all future schema-evolution renames, not just the envelope migration; (2) absorption of idea-318 (reconciler write-patch), idea-320 (read-normalization), idea-324 (repository-envelope-native) — retiring three follow-on missions; (3) the Survey + ledger-reconciliation flows regain trustworthy list-tool results (substrate-self-dogfood).

**Key design constraints surfaced (carry into Phase 4 Design v0.1):**
- **Runtime-contract promotion is the load-bearing wave-1 primitive** — renameMap must move from migration-only (`MigrationSchemaRef.renameMap`) to the runtime `SchemaDef` interface + be built into a query-time translation table the reconciler maintains. Everything downstream consumes it; it gates all other waves.
- **Two independent root-cause layers** (substrate `jsonbField` + policy `FieldAccessor`) must BOTH be swept; fixing only the substrate chokepoint leaves the in-memory-filter tools (list_ideas/list_threads) broken.
- **Per-wave release-gates** are a hard requirement (Q4a) — each wave ships + proves before the next; the W5 re-migration gate cannot pass without shadow-read old-vs-new parity evidence (Q6a).
- **Reversible + shadow-validated re-migration** (Q6a) — the only data-touching wave carries a rehearsed rollback + prod-snapshot shadow-read before the envelope-only strict-flip.
- **Field-collision renames** (e.g. Message.kind→metadata.messageKind) must be covered by the generic contract, not just status→status.phase (Q2a generality).

---

## §4 Mission scope summary

| Axis | Bound |
|---|---|
| Mission name | M-Substrate-List-Filter-Envelope-Translation (scope-expanded at Survey; rename candidate at Design — e.g. M-Envelope-Substrate-Completion — to reflect the 318+320+324 fold) |
| Mission class | **saga-substrate-completion** (completes the envelope-substrate maturity arc begun mission-88 K8s-envelope + mission-89 OCC; adds a runtime field-translation primitive of structural-inflection character) |
| Substrate location | `hub/src/storage-substrate/` (postgres-substrate.ts jsonbField/translateFilterClause, types.ts SchemaDef, schema-reconciler.ts) + `hub/src/policy/` (list-filters.ts + per-policy FieldAccessors) + `hub/src/entities/` (repo-wrappers, sweepers) |
| Primary outcome | bug-138 substrate filter-translation silent-failure class structurally eliminated network-wide; legacy-shape branch retired |
| Secondary outcomes | reusable runtime field-translation primitive; absorbs idea-318 + idea-320 + idea-324; restores trustworthy list-tools for Survey/ledger-reconciliation |
| Tele alignment (primary, whole-mission) | structural-elimination, substrate-fidelity *(placeholder short-names; pin tele-N at Design)* |
| Tele alignment (secondary, whole-mission) | anti-silent-failure, operator-DX/trust, substrate-self-dogfood *(placeholder)* |
| Tele alignment (Round-1) | primary: structural-elimination, substrate-fidelity; secondary: anti-silent-failure |
| Tele alignment (Round-2) | primary: structural-elimination, substrate-fidelity; secondary: anti-silent-failure |
| Estimated size | Large multi-wave (≈5 waves: runtime-contract → substrate-translate → policy-sweep → repo/sweeper-sweep → reversible-re-migration+strict-flip); scope-expanded from the medium idea-323-as-filed by the 318/320/324 fold |

---

## §5 Anti-goals (out-of-scope; deferred)

(NOTE: idea-318, idea-320, idea-324 were anti-goal candidates in the research bundle but are now IN-SCOPE per Round-2 Q5(a) fold. The anti-goals below are what remains genuinely out.)

| AG | Description | Composes-with target |
|---|---|---|
| AG-1 | Hub-API v2.0 wire-level envelope-shape exposure — this mission is substrate-INTERNAL filter-translation, not the wire-API/tool-surface verbs+envelopes | idea-121 (API v2.0); standing defer-tool-surface guidance |
| AG-2 | Diagnosing/fixing the `list_missions` -32000 error — origin is downstream of substrate.list (mission-repo already has the UNION fix); a separate defect, not this translate-point | separate Bug filing if it recurs post-mission |
| AG-3 | Notification↔Audit consolidation | idea-321 (unrelated cluster) |
| AG-4 | Re-opening mission-89 OCC primitive / advisory-lock / counter work — settled | n/a (mission-89 closed) |
| AG-5 | Adding new entity KINDS — this mission operates on the existing 22-kind locked inventory | `hub/scripts/entity-kinds.json` v1.1 |
| AG-6 | Methodology-doc rewrites beyond the §15 AG-9 spec-enrichment carve-out (e.g. the Task-FSM 3-vocabulary alignment) | idea-326 (M-Task-FSM-Vocabulary-Alignment) |

---

## §6 Architect-flags / open questions for Phase 4 Design round-1 audit

Architect-flags batched for engineer's round-1 content-level audit (per mission-67 + mission-68 audit-rubric precedent: CRITICAL / MEDIUM / MINOR / PROBE classifications). Each flag carries an architect-recommendation to challenge.

| # | Flag | Architect-recommendation |
|---|---|---|
| F1 [CRITICAL] | **Two-layer fix is NOT one fix.** The substrate-layer tools (list_bugs/list_turns) delegate filters to `substrate.list`, but the policy-layer tools (list_ideas/list_threads/list_proposals/list_tele) LOAD ALL then filter in-memory via `list-filters.ts::matchField` + per-policy FieldAccessors — they never pass the filter to substrate.list. So the renameMap-at-substrate.list primitive does NOT auto-fix them. | Design must decide per-tool: push filters down to substrate.list (preferred — single translate-point), OR make matchField/FieldAccessors envelope-aware via phaseFromEntity. Engineer code-verify each of the 8 tools' filter path in round-1. |
| F2 [CRITICAL] | **renameMap→runtime-SchemaDef promotion interacts with the live reconciler.** The `SchemaReconciler` already has a runtime watch-loop (`substrate.watch('SchemaDef')` → re-reconcile → applySchemaIndexes). Adding renameMap to the contract must build/cache a translation table without triggering a reconcile-storm or index-churn. | Engineer verify the reconciler can carry the translation table as a pure additive field; confirm no interaction with the existing index-reconcile path; this is wave-1 and gates everything. |
| F3 [MEDIUM] | **Field-collision renames beyond status→status.phase.** The generic contract (Q2a) must cover ALL renames (e.g. Message.kind→metadata.messageKind, body→status.cursor per RepoEventBridgeCursor) — not just FSM-phase. | Engineer enumerate ALL renameMap entries across the 22 kinds' v2-envelope migration modules; the runtime contract + tests must cover the full set, not a status-only subset. |
| F4 [CRITICAL] | **Wire-flow integration test must use REAL envelope payloads through REAL substrate.list per-kind** (per calibration: substrate-extension-needs-end-to-end-wire-flow-integration-test). Synthetic/per-layer unit tests miss schema-strip + projection-skip. | Each wave's release-gate exercises an actual wire payload through the actual substrate path for representative kinds; W5 gate additionally requires shadow-read old-vs-new parity (Q6a). |
| F5 [MEDIUM] | **Shadow-read parity mechanism for the re-migration (Q6a).** How is old-path-vs-new-path parity checked on a prod snapshot, and how is rollback rehearsed? | Design the shadow-read harness (e.g. run both filter-paths against a pg_dump-restored snapshot, diff result-sets per kind) + a reversible-migration + documented rollback before the envelope-only strict-flip. |
| F6 [PROBE] | **Mission-class: saga-substrate-completion vs structural-inflection.** Architect reads it as saga-completion (closes the envelope arc); the renameMap-runtime-contract has structural-inflection character. | Engineer concur on class; it drives pulse-cadence template per mission-lifecycle.md §3. |
| F7 [PROBE] | **Wave-spine: is the 5-wave decomposition right?** (contract → substrate-translate → policy-sweep → repo/sweeper-sweep → re-migration+strict-flip) | Engineer propose the wave decomposition at Design v0.1; the 5-wave spine is the architect's straw-man, not a commitment. |
| F8 [MEDIUM] | **Fold-boundary execution risk.** Absorbing idea-318 (reconciler write-patch) + idea-320 (read-normalization) + idea-324 (repo-wrappers) into one mission is large; confirm the gated-wave structure (Q4a) keeps each fold independently shippable/revertible. | Each absorbed idea maps to its own wave or sub-wave with an independent release-gate; no wave should require a later wave to be correct. |

---

## §7 Sequencing / cross-mission considerations

### §7.1 Branch + PR strategy

Per-wave PR cadence (the mission is Hub-source — `hub/src/` — so each wave's PR REQUIRES build-hub.sh + start-hub.sh + the Adapter-Restart-Protocol-includes-Hub-container discipline). Branch handle `agent-lily/m-envelope-substrate-completion-wN` per wave. Per-wave release-gate = CI green + wire-flow integration evidence + (W5) shadow-read parity. Watchtower auto-deploy (bug-140) picks up each merged Hub image within ~5min — so post-merge production dispositive is available per wave.

### §7.2 Composability with concurrent / pending work

- **Absorbs** idea-318 (SchemaDef-reconciler-status-write-patch), idea-320 (substrate read-normalization), idea-324 (M-Repository-Envelope-Native) — these transition to `incorporated` against this mission at Manifest-bind. Architect to update their status + link missionId once the Mission entity exists.
- **Closes** bug-138 (substrate.list filter envelope-blind) systemically; supersedes the targeted bug-143 patch (PR #309) with the systemic version (bug-143 stays resolved; this generalizes it).
- **Composes-after** mission-88 (K8s-envelope) + mission-89 (OCC) — this is the third + completing arc of the envelope-substrate saga.
- **Restores** the list-tool substrate for the Survey + ledger-reconciliation methodologies (substrate-self-dogfood) — unblocks idea-325 (M-Ledger-Reconciliation-Idea+Bug) which needs trustworthy list_ideas/list_bugs.
- **Defers-to** idea-121 (Hub-API v2.0) for any wire-surface verb/envelope changes (AG-1).

### §7.3 Same-day compressed-lifecycle candidate?

**NO.** This is a large multi-wave saga-substrate-completion touching a runtime contract + persisted data across the full substrate surface. It warrants the full mission lifecycle with per-wave gates + Director Phase-7 release-gate + Phase-10 retrospective. The shadow-validated re-migration (Q6a) alone disqualifies compression. Flag for Director awareness at Phase 7: scope expanded materially at Survey (idea-323 medium → saga-completion absorbing 4 ideas) — the expansion was Director-ratified across both Survey rounds, so this is a documented intent, not drift.

---

## §calibration — Calibration data point

Per `idea-survey.md` §5 (Survey output element) + §15 schema. Captures empirical baseline for methodology-evolution loop per §13 Forward Implications.

- **Director time-cost (minutes):** 15 (architect-estimate; 2 structured pick-rounds, rapid picks)
- **Comparison baseline:** idea-206 (first-canonical Survey) + mission-69 (§15-schema-enriched Survey)
- **Notes:** Survey preceded by a 6-agent research-fan-out Workflow (ultracode) that built a **code-verified** technical envelope before question-design — questions were ground-truth-anchored (the renameMap-not-at-runtime finding → Q2; the two-layer root-cause → Q1) rather than spec-recall. **Methodology-evolution candidate:** an optional "research-prep pre-step" for substrate-class Surveys where question-quality depends on code-truth. **Novel:** this Survey functioned as a *scope-discovery instrument* — Director expanded idea-323 (medium) → saga-substrate-completion absorbing idea-318+320+324, a 4-idea unification, fully ratified across both rounds (documented intent, not drift). **Workflow robustness candidate:** 3 of 5 research agents failed StructuredOutput-call; synthesis compensated via own verification, but worth hardening schema-compliance.

---

## §contradictory — Contradictory multi-pick carry-forward

(Required per `idea-survey.md` §7 + §15 schema **only when contradictory multi-pick detected during architect interpretation**. Otherwise omit this section entirely.)

| Round | Question(s) | Picks | Constraint envelope description |
|---|---|---|---|
| <1\|2> | <Q-N, Q-M> | <letter, letter> | <description of common-satisfiable constraint Director is signaling per §7> |

---

## §8 Cross-references

- **`docs/methodology/idea-survey.md`** v1.0 — canonical Survey methodology (NOT modified by this mission per AG-9 IF applicable; spec-enrichment additions IS in-scope per AG-9 carve-out from mission-69)
- **`docs/methodology/strategic-review.md`** — Idea Triage Protocol (route-(a) skip-direct rationale if applicable)
- **`docs/calibrations.yaml`** — calibration ledger cross-refs (closures-applied + candidates-surfaced)
- **idea-323** — source idea (M-Substrate-List-Filter-Envelope-Translation)
- **idea-318 / idea-320 / idea-324** — absorbed into scope per Round-2 Q5(a) fold
- **idea-325** — M-Ledger-Reconciliation-Idea+Bug (unblocked by this mission's list-tool restoration)
- **idea-121** — Hub-API v2.0 (AG-1 defer-target)
- **bug-138** — substrate.list filter envelope-blind (systemically closed by this mission)
- **bug-143** — Task FSM read-side envelope-blind (PR #309; this mission generalizes the targeted patch)
- **mission-88 / mission-89** — envelope-substrate saga predecessors (K8s-envelope + OCC)
- **docs/audits/m-substrate-occ-primitive-closing-audit.md** §4 — idea-323/324 lineage source

---

— Architect: lily / 2026-05-29 (Phase 3 Survey envelope; Director-ratified 6 picks across 2 rounds; branch `agent-lily/m-envelope-substrate-completion` to be pushed pre-bilateral round-1 audit per calibration #59 closure mechanism (a))
