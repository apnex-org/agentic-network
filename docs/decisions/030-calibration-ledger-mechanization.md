# ADR-030 — Calibration ledger is first-class versioned repo data; audits + retrospectives + methodology become views over the canonical ledger

**Status:** RATIFIED — bilateral architect+engineer ratification at mission-65 W4 closing wave 2026-04-29T04:00Z UTC (post-PR #132 admin-merge; thread-420 round-4 converged).
**Mission:** mission-65 (M-Calibration-Codification; idea-223)
**Date drafted:** 2026-04-29T02:55Z UTC (SCAFFOLD)
**Date ratified:** 2026-04-29T04:00Z UTC (RATIFIED at W4 closing)
**Authors:** lily / architect (drafted + ratified); greg / engineer (round-1 audit thread-417 + round-1 audit thread-420; bilateral ratify)

---

## Status flow

| Phase | State | PR | Notes |
|---|---|---|---|
| Scaffold | SCAFFOLD | #131 (W0 bundle) | ADR number assignment + initial decision framing |
| W1+W2 atomic | (no change) | #132 | Schema authoring + seed migration (M62/M63/M64/M65 batches) + Skill scaffolding + CLAUDE.md directive shipped; ADR text stable |
| W3 dogfood gate | (no change; verification only) | — | 5 verification gates pre-empted via thread-417 round-1 audit + thread-420 round-1 audit + post-merge sanity confirmation |
| W4 closing | **RATIFIED** | #133 (this PR) | idea-survey.md §5 fixup (R5 closure / calibration #45) + #47 NEW (greg-surfaced W3 nugget) + ADR ratification + closing audit + Phase 10 retrospective |

---

## Context

Pre-mission-65 calibration-state lives as **narrative-doc-state scattered across three surfaces:**
- `docs/audits/m-*-closing-audit.md` — per-mission closing audits with calibration ledger sections
- `docs/reviews/m-*-retrospective.md` — Phase 10 retrospectives with calibration analysis
- `docs/methodology/multi-agent-pr-workflow.md` v1.0 ratified-with calibrations subsection — folded methodology-class calibrations + named architectural-pathology patterns

This narrative-doc-state form is **vulnerable to LLM-hallucination drift**. Mission-64 close arc demonstrated the class concretely:
- 5 stale-number nits in PR #127 (W4 audit) — bilateral review-loop fixup cycles
- 2 nits in PR #129 (retrospective; UTC date conflation = Calibration #42 self-referential)
- 1 nit in PR #128 (mission-63 retrospective; UTC date conflation again)
- Calibration-count drift "9 → 11 → 12 → 13 → 14" across multiple authoring passes
- Class-count drift "7 substrate + 5 methodology" mis-attribution vs actual "6 + 6"
- Section-numbering carry-forward between retrospectives (mission-64 §6/§10/§11 vs mission-63 §4/§8)

Each drift = bilateral review round burned on number-fidelity instead of architectural commitments. **Review-loop-as-calibration-surface is real but expensive when the surface is narrative-doc-state.** The 5-publish iteration of mission-64 surfaced the "Review-loop-as-calibration-surface" pattern itself — the pattern operates because the underlying state isn't queryable.

idea-223 (filed 2026-04-29; Director-prompted post-mission-64-close discussion): codify calibration metadata as canonical schema-versioned ledger + Skill access surface + CLAUDE.md behavioral-discipline directive. Defeats LLM-state-fidelity drift class structurally.

Survey envelope (Director-ratified Phase 3 of mission-65; 2026-04-29):
- Round 1: Q1=A,B,C,D (all 4 tele primaries) / Q2=A,B,C (3 internal roles; D excluded) / Q3=B (phased delivery)
- Round 2: Q4=B (calibrations + named patterns first-class) / Q5=C (full M62-M64 corpus seed) / Q6=C (read-only Skill: list / show / status)

Composite intent envelope (Survey §14): Phase 1 ships substrate + seed + read-only multi-role Skill scaffolding + CLAUDE.md behavioral-discipline directive; Phase 2+ deferred (write authority + PR-diff validate Skill + pre-commit hook + CI workflow + methodology-doc auto-derivation).

---

## Decision

**Calibration ledger is first-class versioned repo data; audits + retrospectives + methodology become views over the canonical ledger.**

Architectural commitments at Phase 1:

### 1. Canonical YAML ledger location

`docs/calibrations.yaml` — single file at `docs/` root (no separate `calibrations/` directory at Phase 1; promotes to `docs/calibrations/ledger.yaml` only if Phase 2+ adds auxiliary files).

### 2. Two first-class entity types

```yaml
schema_version: 1
calibrations:
  - id: <integer>
    class: substrate | methodology
    title: <string>
    origin: mission-X-WN
    surfaced_at: thread-NNN-roundN  # optional
    status: open | closed-structurally | closed-folded | retired | superseded
    closure_mechanism: |  # required if status≠open
      <multiline string>
    closure_pr: <integer>  # optional; scalar field NOT first-class entity
    pattern_membership: [<pattern-id>, ...]  # optional
    cross_refs: [<doc-path>, ...]  # optional
    tele_alignment: [<tele-id>, ...]  # optional; engineer round-1 audit Q1 fold

patterns:
  - id: <kebab-case-slug>
    title: <string>
    origin: mission-X-WN
    description: |  # multiline; Phase 1 prose-only; Phase 2+ may extract structured diagnostic_signature field
      <multiline string>
    surfaced_by_calibrations: [<calibration-id>, ...]  # non-empty
    methodology_doc_subsection: <path#anchor>  # optional
```

**Origin field convention (bilaterally ratified mission-65 thread-420 Flag #2 architect-call):** `origin` captures **where surfaced** (temporal-fidelity), NOT where formalized. Calibrations surfaced during W3 dogfood get `origin: mission-X-W3` even if formally numbered at W4 audit; calibrations surfaced post-mission-close get `origin: mission-X-W4-followon`. This convention has higher informational value for ledger queries — reading "this calibration originated in W3" tells future readers what discipline-gap-state existed at that mission-lifecycle phase.

### 3. Cross-link discipline

- Every calibration's `pattern_membership` references existing pattern id
- Every pattern's `surfaced_by_calibrations` references existing calibration id
- Phase 1: manual at edit-time (architect hand-authors; lints via W3 Gate-2)
- Phase 2+: mechanized validate operation enforces structurally

### 4. Read-only Skill scaffolding (Phase 1 multi-role; tool-surface verb names defer to idea-121)

3 verb-classes:
- **`list [filters]`** — browse + filter by class/status/mission/origin; multi-role
- **`show <id-or-slug>`** — polymorphic (engineer round-1 audit Q3 fold): accepts integer (calibrations[].id) OR kebab-case slug (patterns[].id); resolves cross-refs at retrieval time; multi-role
- **`status`** — cross-mission aggregate + status table + tele-aligned slices (per Q1 fold); Director governance + retrospective-authoring surface

NOT included at Phase 1 (defer to Phase 2+):
- Skill write-authoring
- PR-diff validate operation
- Dedicated patterns-browser surface
- Pre-commit hook
- CI workflow
- Methodology-doc auto-derivation

### 5. CLAUDE.md behavioral-discipline directive (NOT bare path-pointer)

Per Director Phase 4 review 2026-04-29: the CLAUDE.md addition is **behavioral-discipline directive** instructing agents to query the ledger via Skill rather than recall from narrative-doc memory at citation contexts.

Sample text (~5 lines; W1+W2 final wording):

```markdown
## Calibration ledger discipline

Calibration metadata (id + status + closure-PR + cross-refs) + named architectural-pathology patterns live at `docs/calibrations.yaml` (canonical schema-versioned source-of-truth; ADR-030).

When authoring audits / retrospectives / methodology references that cite calibrations: **query the ledger via the calibration Skill rather than recalling from narrative-doc memory.** Defeats the LLM-state-fidelity drift class (calibration #42 origin; idea-223 ratified mechanization). Skill verb names follow `/calibration-*` convention (placeholders pending idea-121 final ratification).
```

### 6. Methodology-doc rebinding (Phase 1 status quo)

`multi-agent-pr-workflow.md` v1.0 ratified-with calibrations subsection **stays prose** at this mission. Auto-derive (Phase 2+ option) defers. Irreducible methodology content (Pass 10 protocol body, §2c.X anti-pattern, named-pattern explanations) is human-authored prose; ledger captures the **state metadata** that's currently drift-vulnerable. Hybrid prose + ledger-view rebinding is the long-term target but requires ledger maturity first.

### 7. Schema evolution discipline

`schema_version` field at ledger root. Phase 1 ships v1. Future schema changes (e.g., upgrading closure-PR to first-class entity per Q4=C; adding mission/wave indexed entities per Q4=D; extracting `diagnostic_signature` from pattern description per Q2 follow-on) bump schema_version + ship migration tooling at the upgrading mission.

Schema-version bumps require ADR amendment OR new ADR per `multi-agent-pr-workflow.md` ADR-amendment scope discipline (contract-change schema bumps = new ADR; deployment-context-only changes = in-place ADR §Amendments).

---

## Consequences

### Positive

- LLM-hallucination drift class on calibration metadata (calibration #42 origin) closed structurally — schema validation enforces correctness; Skill aggregates defeat memory-recall vulnerability
- Single source-of-truth for calibration state; views derive from it; no drift across audit/retrospective/methodology surfaces
- Cross-agent coherence via Skill multi-role accessibility (architect + engineer + Director see same fidelity)
- Bilateral review cycles stop burning rounds on number-drift fixes; reviewers focus on architectural commitments
- Calibration density-by-tele queryable (e.g., "5 calibrations addressing tele-3 fidelity"); makes tele alignment a queryable governance dimension matching Survey Q1=A,B,C,D ratification weight
- Methodology-state mechanization establishes pattern that future mechanizations (idea-220 Phase 2; future Survey-Skill mechanization at later mission) can ride
- Phase 1 / Phase 2+ split enables incremental mechanization without disrupting existing methodology-prose surfaces (Pass 10 protocol body + named-pattern explanations stay prose)

### Negative / trade-offs

- W1+W2 seed migration is effort-heavy (~30-40% baseline; ~40-50% upper bound at ~10h of ~20h W1+W2 effort); 50-60 entries from narrative-doc-state require extraction + transformation + cross-link tagging
- YAML parse fragility on edge cases (R7) — whitespace-sensitivity + multi-line string indentation can introduce silent-failure bugs; mitigated via strict yaml.safe_load + W3 Gate-5 round-trip + Phase 2+ pre-commit hook
- Bulk seed migration produces large git diff (~1500-2400 lines) hard to spot-check at PR-time (R8); mitigated via 3 ordered commits per mission batch (M62 / M63 / M64)
- Skill verb names placeholder pending idea-121 ratification — Phase 1 deliverable surfaces architectural shape, not canonical verb namespace
- Methodology-vs-practice gap on Survey persist-path (R5; resolved by Director Phase 4 review ratifying `docs/surveys/<mission>-survey.md` as canonical) — `docs/methodology/idea-survey.md` §5 needs methodology-doc fixup; bundles into W4 closing as part of methodology-class calibration filing

### Forward consequences

- Future missions ratify calibration entries via the ledger surface (read at Phase 1; write at Phase 2+)
- Phase 2+ mechanization (write authority + PR-diff validate + pre-commit hook + CI workflow + methodology-doc auto-derivation) composes cleanly without disrupting Phase 1 substrate
- Methodology-doc rebinding (auto-derive "what" sections from ledger views; retain "why" as prose) becomes possible post-Phase-2 once write authority + validation settle
- **CLAUDE.md context-budget governance** (engineer round-1 audit structural concern 2 fold): future behavioral-discipline directives compete for the ~5-line average budget per discipline; consolidation pass at line ~150-200 mark is recurring methodology-discipline checkpoint as more substrate areas earn behavioral-discipline-directive surfaces (idea-220 Phase 2 + future missions may add directives too)
- Survey-Skill mechanization at later mission closes the M65 architect-Round-1-aggregation-only drift class structurally (closure path = ledger-mechanization-as-substrate-foundation-for-future-Survey-mechanization; truthful but indirect; full closure requires Survey-Skill mission)
- 4 named architectural-pathology patterns from M64 + future patterns get queryable index at Phase 1; Phase 2+ may extract structured `diagnostic_signature` field once 5-10 patterns crystallize structural commonalities (Q2 fold)

---

## Sealed companions

- **`docs/methodology/idea-survey.md` v1.0** — Survey methodology IS canonical input; Mission #5 ran strict process (Round 1 + Round 2; per-question interpretation loop)
- **`docs/methodology/multi-agent-pr-workflow.md` v1.0 ratified-with calibrations subsection** — will reference ledger entries by id post-merge; methodology-doc fixup of `idea-survey.md` §5 (R5 closure) bundles into W4 closing
- **`docs/methodology/mission-lifecycle.md`** — Phase 4 Design + Phase 9+10 retrospective close-out reference ledger
- **ADR-023 (multi-agent-pr-workflow underlying ADR)** — W4 closing wave references ADR-030
- **idea-121 (API v2.0 tool-surface)** — future ratification of Skill verb names + ledger-write authority boundaries
- **idea-220 Phase 2 (Mission #6)** — inherits mechanized ledger surface; calibration outputs ride structured surface from outset (no scope expansion to idea-220)
- **idea-222 (relax thread turn-taking)** — weakly-related composability candidate; both methodology-mechanization but different surfaces
- **mission-64 ADR-029 RATIFIED** — npm-publish channel precedent for tooling-introduction class ADR pattern
- **mission-63 ADR-028 RATIFIED** — canonical envelope precedent for ADR-RATIFIED protocol

---

## Cross-references

- **Mission:** mission-65 candidate M-Calibration-Codification (this ADR ratifies at W4)
- **Source idea:** idea-223 (Mechanize calibration ledger; Director-prompted 2026-04-29 post-mission-64-close discussion)
- **Companion idea:** idea-220 Phase 2 (Mission #6 successor; inherits mechanized ledger)
- **Brief (Design v1.0):** `docs/designs/m-calibration-codification-design.md` (bilateral ratified thread-417 round 4)
- **Survey envelope:** `docs/surveys/m-calibration-codification-survey.md` (Director Round 1 + Round 2 ratified 2026-04-29)
- **Preflight:** `docs/missions/m-calibration-codification-preflight.md` (verdict GREEN; Director Phase 7 Release-gate pending)
- **Architectural-precedents:**
  - mission-64 (M-Adapter-Streamline; ADR-029 RATIFIED; tooling-introduction-class precedent for npm-publish channel)
  - mission-63 (M-Wire-Entity-Convergence; ADR-028 RATIFIED; structural-inflection M-class precedent + clean-cutover discipline)
  - mission-57 (M-Mission-Pulse-Primitive; first canonical Survey-anchored Phase 4 Design execution)
- **Calibrations addressed:**
  - **#42** (mission-64 W4-followon) — post-event narration AEST/UTC date conflation discipline; this ledger ratifies the discipline structurally (mechanized state defeats narrative-doc-state drift)
  - **NEW (TBD-NEXT)** — LLM drift from documented multi-round Survey methodology (architect Round-1-aggregation-only anti-pattern); architect-self-corrected this Survey; closure-path = ledger-mechanization-as-substrate-foundation-for-future-Survey-mechanization (truthful but indirect; full closure requires Survey-Skill mission)
  - **NEW (TBD-NEXT)** — methodology-vs-practice gap on Survey persist-path (`docs/designs/<mission>-survey.md` per methodology vs `docs/surveys/` per established practice); RESOLVED by Director Phase 4 review 2026-04-29 ratifying `docs/surveys/`; closure mechanism = methodology-doc fixup of `idea-survey.md` §5 bundled into W4 closing
  - Calibration #34 (mission-64; W3 dogfood-gate collapse-into-W1+W2-fix retry pattern) — applies if defect surfaces during Skill operation in W3 dogfood gate

---

## Status flow at W4 — RATIFIED protocol (bilateral architect+engineer; mission-63 ADR-028 + mission-64 ADR-029 precedent)

At W4 closing, this ADR scaffold becomes bilaterally ratified:
1. W3 dogfood-gate evidence captured in `docs/audits/m-calibration-codification-closing-audit.md` referenced
2. Implementation refinements surfaced during W1+W2 + W3 folded into the ADR text
3. Status flips from SCAFFOLD → RATIFIED
4. Ratification thread (similar to mission-64 thread-411 + thread-415 pattern) bilateral seal — calibration #24 dual-surface (gh pr review + thread converged=true)

---

*ADR-030 SCAFFOLD drafted at mission-65-candidate Phase 5+6 Manifest+Preflight 2026-04-29 ~02:55Z UTC; final ratification pending W4 closing wave per mission-63 ADR-028 + mission-64 ADR-029 precedent.*
