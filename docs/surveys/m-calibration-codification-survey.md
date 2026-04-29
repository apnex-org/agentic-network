# M-Calibration-Codification — Survey envelope

**Mission name:** M-Calibration-Codification (mission-65 candidate; idea-223)
**Mission-class hint (pre-Survey; subject to revision per Director picks):** structural-inflection + tooling-introduction sub-class
**Source idea:** idea-223 (Mechanize calibration ledger as first-class repo data + Skill access surface + CLAUDE.md pointer)
**Director-engagement state:** **Phase 2 Survey — Round 1 + Round 2 complete; composite intent envelope ratified; Phase 4 Design v0.1 authoring opens**
**Author:** lily / architect 2026-04-29
**Methodology:** `docs/methodology/idea-survey.md` v1.0 (strict process — 2 rounds × 3 orthogonal questions each)

---

## §0 Original Idea description (anchor)

idea-223: replace narrative-doc-state form of calibration metadata (scattered across `docs/audits/m-*-closing-audit.md`, `docs/reviews/m-*-retrospective.md`, `docs/methodology/multi-agent-pr-workflow.md` v1.0 ratified-with calibrations) with a canonical schema-versioned ledger + mechanized access surface — defeats LLM-state-fidelity drift. Tele-6 Deterministic Invincibility + tele-3 Absolute State Fidelity primaries.

Surface that prompted: mission-64 close arc demonstrated repeated LLM hallucination of calibration metadata (count drift "9 → 11 → 12 → 13 → 14"; class-count mis-attribution; date-conflation Calibration #42 self-referentially). Bilateral review cycles burned rounds on number-drift fixes when tooling could.

Architect-lean closure-shape (3 options enumerated in idea-223): just-data-file / data-file+Skill (architect-lean) / full-stack-with-validation. Tool-surface specifics defer to idea-121.

---

## §1 Round 1 — 3 orthogonal questions (WHY/WHO/HOW-cadence anchors)

### Q1 — WHY (motivation-primary)

**What's the primary driver for this mechanization?**

| Option | Driver |
|---|---|
| **A** | Defeat LLM-hallucination at calibration-state — tele-6 Deterministic Invincibility primary |
| **B** | Reduce bilateral review-cycle cost spent on number-drift fixup commits — tele-7 Resilient Operations primary |
| **C** | Enable cross-agent calibration-discipline coherence — tele-2 Frictionless Agentic Collaboration primary |
| **D** | Establish methodology-state as a first-class queryable substrate for future tooling/missions — tele-3 Absolute State Fidelity primary |

### Q2 — WHO (user-surface-primary)

**Who's the primary user of the mechanization at first-publish?**

| Option | User |
|---|---|
| **A** | Architect (calibration-filing + cross-ref management + retrospective-authoring) |
| **B** | Engineer (review-cycle validation + ledger-look-up during PR review) |
| **C** | Director (status-overview + governance + calibration-discipline ratification at mode-pick gates) |
| **D** | Future agent-pool / external operators (CLI ergonomics; same-fidelity onboarding) |

### Q3 — HOW-cadence (delivery-shape-primary)

**What's the delivery cadence pattern for this mission?**

| Option | Cadence |
|---|---|
| **A** | Single-mission big-bang (full schema + Skill + seed + CLAUDE.md in one mission) |
| **B** | Phased — data-file (schema + seed) ships in Mission #5; Skill + validation surface defer to follow-on missions |
| **C** | Substrate-introduction-class with W3 dogfood gate (substrate-self-dogfood the mechanization on existing M62/M63/M64 calibrations) |
| **D** | Tooling-layer-only — no substrate change to calibrations themselves; structuring + access surface only |

---

## §2 Multi-pick semantics

Per `idea-survey.md` §6: multi-pick supported. Q1 + Q2 answers orthogonal (multi-pick natural). Q3 contains mutually-exclusive elements (per §7 contradictory multi-pick = constraint signal, NOT error).

---

## §3 Round 1 — Director picks (received 2026-04-29)

| Question | Director pick(s) |
|---|---|
| **Q1 — WHY** | **A, B, C, D** (all four motivations load-bearing) |
| **Q2 — WHO** | **A, B, C** (architect + engineer + Director; **explicitly NOT D** future agent-pool / external) |
| **Q3 — HOW-cadence** | **B** (phased — data-file first; Skill + validation surface follow-on) |

Rationale: none provided (architect interprets via Step 4 below).

---

## §4 Round 1 Step 3 — Aggregate response surface (1-2 sentence composite read)

Director ratifies **comprehensive multi-tele-primary mechanization** (Q1 = ALL four tele primaries — tele-6 + tele-7 + tele-2 + tele-3 — load-bearing simultaneously) targeting **internal-pool 3-role users at first-publish** (Q2 = architect + engineer + Director; explicit exclusion of future agent-pool/external delivers a scope-conservation signal) delivered via **phased cadence** (Q3 = data-file ships Phase 1; Skill + validation surface defer to Phase 2+ follow-on missions).

**Composite stance:** broad ambition + broad internal reach + cost-conservative phased delivery. *"We want all of this, and we want to deliver it carefully, not all at once."*

---

## §5 Round 1 Step 4 — Per-question interpretation loop

Per `idea-survey.md` §3 step 4 + §9 architect-side discipline: each Q individually with multi-dim context (Original Idea + Tele-mapping + Aggregate-Surface).

### Q1 interpretation (A, B, C, D — all 4 tele primaries)

**Multi-dim context:**
- *Original Idea:* idea-223 frames tele-6 + tele-3 as primaries; tele-7 + tele-2 as secondaries
- *Tele-mapping (this round):* Director ratifies ALL FOUR as primary (not just primary/secondary split)
- *Aggregate-Surface:* phased delivery (Q3=B) means Phase 1 doesn't have to satisfy all 4 motivations equally; can sequence by tele-priority

**Interpretation:** Director's all-4-tele-primary pick signals *"no single tele dominates; multi-tele integration is the architectural intent."* The mechanization is not framed as a single-tele-improvement but as a **multi-tele-integrated capability shift** establishing methodology-state as a first-class queryable substrate (Q1=D framing) that downstream consumers (Q1=A defensive against hallucination + Q1=B operational efficiency + Q1=C collaboration coherence) all draw on.

This maps cleanly to phased delivery (Q3=B) tele-priority sequencing: **Phase 1 data-file delivers tele-6 (defeat hallucination via schema validation) + tele-3 (single source-of-truth substrate) — defensive + foundational primaries first**; Phase 2 Skill + validation surface delivers tele-2 (cross-agent coherence via mechanized access) + tele-7 (operational efficiency via validation automation) — collaborative + operational primaries on top of the substrate. The phasing mirrors a tele-priority gradient.

**Architectural implication:** Phase 1 substrate must be schema-validated (tele-6) + canonical-source-of-truth (tele-3). Phase 1 minimum-viable Skill must surface read-access for collaborative coherence (tele-2 partial); Phase 2 Skill+validation completes operational efficiency (tele-7).

### Q2 interpretation (A, B, C — architect + engineer + Director; explicit exclusion of D)

**Multi-dim context:**
- *Original Idea:* idea-223 §"Surface composition" lists architect + engineer + future-agent-pool; future-pool was an architect-lean inclusion (matching Q1=C tele-2 cross-pool framing)
- *Tele-mapping (this round):* tele-2 Frictionless Agentic Collaboration elevated as primary specifically for **cross-internal-role coherence** (the exclusion of D narrows tele-2 scope)
- *Aggregate-Surface:* Director ratifies all 3 internal roles as load-bearing first-publish users; future-pool deferred

**Interpretation:** the explicit exclusion of D (future agent-pool / external operators) carries scope-discipline weight equivalent to the inclusion of A/B/C. Director scopes the mechanization to **currently-active internal pool only at first-publish**; CLI ergonomics for external operators (e.g., the `get_agents` CLI script ask in idea-220 Phase 2 carryover) are deferred to a separate scope at later mission.

Two reading-axes for the exclusion:
1. **Phased scope discipline** (aligns with Q3=B): future-pool integration adds auth posture + no-MCP-required surfaces + idempotency-for-external-invocations; deferring matches phased-delivery cadence — these costs better belong in a follow-on mission post-internal-pool-coherence-validation
2. **Internal-pool-coherence priority** (aligns with Q1=C tele-2): establishing calibration-discipline coherence among architect+engineer+Director FIRST ensures the discipline is **well-exercised** before opening the surface to external pool

The 3-role inclusion (not just architect lily-side) carries another implication: **Phase 1 mechanization must be multi-role-accessible from the outset.** This isn't a lily-only authoring tool; engineer reviewing PRs uses it; Director governance uses it. Architectural implication for Phase 1:
- Read-access Skill must work for all 3 roles (multi-role tool-surface authority; defer specifics to idea-121)
- Auth posture must accommodate role differences (Director may need write authority for governance overrides; engineer may need read+validate for PR review; architect-only write authority at Phase 1 is the architect-lean closure shape carried from idea-223)

**Anti-tele drift check (Q2):** tele-2 elevated as primary (cross-internal-role coherence) + Q1=C ratifies the same direction. ✓ Aligned. No drift; the multi-role first-publish reach is exactly what tele-2 means in this context.

### Q3 interpretation (B — phased delivery)

**Multi-dim context:**
- *Original Idea:* idea-223 architect-lean closure shape (data-file + Skill; option 2 of 3) intentionally pre-anchored phased delivery
- *Tele-mapping (this round):* tele-7 Resilient Operations primary (phased delivery limits change-risk per phase) + tele-2 secondary (multi-role-Skill-access from Phase 1 sustains collaboration coherence under phasing)
- *Aggregate-Surface:* Q1 (all 4 tele primaries) means Phase 1 must deliver SOMETHING for all 4 tele directions; Q2 (3 internal roles) means Phase 1 Skill must be multi-role-accessible

**Interpretation:** phased delivery means **Phase 1 = minimum-viable substrate first** (data-file ledger schema + seed + canonical location + read-only Skill + CLAUDE.md pointer). Phase 2+ = write authority + validation surface (Skill ops for filing + Skill ops for PR-diff validation + pre-commit hook + CI workflow).

**Constraint-envelope analysis:** Q1 (all-4-tele-primary) + Q3 (phased) creates a constraint where Phase 1 must deliver:
- **Schema validation surface** (tele-6 + tele-3) — non-negotiable for Phase 1; the canonical YAML ledger ships with schema discipline from day-1
- **Multi-role read access** (tele-2 partial) — Phase 1 read-only Skill scaffolding satisfies the "all 3 roles see same fidelity" requirement
- **Manual write workflow** (tele-7 partial) — architect hand-authors YAML entries during Phase 1; mechanization of write surface defers to Phase 2

The architect-lean Q3=B pick + multi-role first-publish (Q2=A,B,C) implies Phase 1 Skill must include read-access from day-1 (NOT defer Skill to Phase 2 entirely). Otherwise Phase 1's "multi-role first-publish" claim degenerates to "engineer + Director cat the YAML file directly" which weakly satisfies tele-2.

**Architectural implication:** Phase 1 ships:
1. Canonical YAML ledger (schema + seed)
2. CLAUDE.md pointer
3. **Read-only Skill scaffolding** for all 3 roles (browse + show + cross-ref resolve)
4. Manual write workflow (architect hand-authors entries; schema-validated by linter or `--check` pass at PR review)

Phase 2+ ships:
5. Skill write authority (architect-only or role-differentiated; defer to idea-121 + sub-mission-survey)
6. PR-diff validation surface (Skill on-demand + optional pre-commit hook)
7. Methodology-doc cross-reference validator
8. Optional CI workflow (non-blocking warnings)

**Tele-mapping for Q3:** tele-7 primary (phased delivery operational discipline) + tele-2 secondary (multi-role-Skill-access from Phase 1 sustains collaboration coherence). Slight tension: Q1 picked tele-7 as a co-primary, but the bulk of tele-7 ROI (review-cycle-cost reduction via validation automation) lands in Phase 2. Phase 1 only delivers MINIMAL tele-7 (scope-discipline via phasing + schema-discipline at YAML edit). This is a trade-off Director's pick implies they accept — tele-7 ROI is gradient over phases vs single-mission big-bang.

---

## §6 Round 1 — Anti-tele drift check + cross-question coherence check

### Anti-tele drift check (per `idea-survey.md` §3 + §9)

| Q | Interpretation tele-mapping | Aligned with Round 1 picks? |
|---|---|---|
| Q1 | tele-6 + tele-3 + tele-7 + tele-2 all primary | ✓ direct match (Q1 picked all 4) |
| Q2 | tele-2 elevated as primary (cross-internal-role coherence) | ✓ aligned with Q1=C inclusion |
| Q3 | tele-7 primary + tele-2 secondary (phased delivery + multi-role Phase 1 access) | ✓ aligned with Q1=B + Q1=C; tension on tele-7 ROI gradient acknowledged but accepted |

**No drift detected.** Interpretations align with Round 1 tele-priority signal.

### Cross-question coherence check (per `idea-survey.md` §3 step 4)

| Pair | Coherence |
|---|---|
| Q1+Q2 | ✓ comprehensive tele scope + multi-role internal users naturally pair (cross-role coherence requires multi-tele-primary thinking) |
| Q2+Q3 | ✓ phased delivery + multi-role first-publish is a constraint envelope (Phase 1 must deliver minimum read-access for all 3 roles) |
| Q1+Q3 | ⚠ TENSION (acknowledged): comprehensive tele scope vs phased delivery means tele-7 + tele-2 ROI is gradient over phases. Director's intent envelope: ratify ALL tele primaries as load-bearing while accepting phased delivery's gradient ROI realization. Constraint envelope navigated by Phase 1 scope shape (per Q3 interpretation above) |

**No internal contradictions; Q1+Q3 tension is a constraint envelope to navigate in Round 2 + Design phase, not a drift.** Round 2 should refine: what's IN-scope for Phase 1 vs DEFERRED to Phase 2+? (per `idea-survey.md` §4: cleanly-confirmed-all-3-dimensions outcome → Round 2 strategy: refine deeper / drill into HOW)

---

## §7 Round 1 — Composite intent envelope

**Director ratifies (Round 1):** comprehensive multi-tele-primary mechanization (all 4 drivers load-bearing) targeting internal-pool 3-role users at first-publish (architect + engineer + Director; future-pool/external excluded for now) delivered via phased cadence (Phase 1 = data-file + minimum-viable read-only Skill multi-role-accessible + CLAUDE.md pointer; Phase 2+ = write authority + validation surface in follow-on missions).

**Phase 1 architectural shape (interpretation envelope; subject to Round 2 refinement):**
1. Canonical YAML ledger (schema + seed of M62/M63/M64 corpus — scope refined in Round 2)
2. CLAUDE.md pointer (2-3 line addition)
3. Read-only Skill scaffolding (browse + show + cross-ref resolve — scope refined in Round 2)
4. Manual write workflow (architect hand-authors; schema-validated at edit time)

**Phase 2+ deferred:** Skill write authority + PR-diff validation + methodology-doc cross-reference validator + optional pre-commit hook + optional CI workflow.

---

## §8 Round 2 — 3 orthogonal questions (refine-deeper strategy per `idea-survey.md` §4)

Round 1 outcome: cleanly confirmed all 3 dimensions; no ambiguous picks; tension between Q1 (all-tele-primary) + Q3 (phased) is a constraint envelope for Phase 1 scope shape, not a methodology ambiguity.

**Round 2 strategy: refine deeper — drill into HOW (the WHAT-shape dimensions of Phase 1).** 3 orthogonal questions partitioning Phase 1 substrate scope × seed migration × Skill access surface.

### Q4 — Phase 1 ledger schema fidelity (substrate-shape primary)

**What does Phase 1 ledger physically contain at first-publish?**

| Option | Schema fidelity |
|---|---|
| **A** | Calibration entries only (id + class + title + origin + status + closure-mech + closure-pr + cross-refs) — minimum viable schema |
| **B** | A + named architectural-pathology patterns as separate first-class index (referenced by calibrations; e.g., methodology-bypass-amplification-loop, review-loop-as-calibration-surface, two-sided-convergence-accounting, post-event-narration-aest-utc-discipline) |
| **C** | A + B + closure-PR cross-references hyperlinked (every closed-structurally calibration cites mergecommit + PR # + cross-doc references like W4-audit + retrospective + methodology-doc subsection paths) |
| **D** | A + B + C + mission/wave sourceRefs + thread-NNN-roundN if applicable (full schema fidelity from outset; every calibration cross-references mission-X-WN origin + thread-NNN-roundN where surfaced) |

### Q5 — Phase 1 migration scope (seed-corpus primary)

**How much of the existing calibration corpus seeds the ledger at first-publish?**

| Option | Migration scope |
|---|---|
| **A** | Empty seed (ledger grows from this mission forward; no historical migration; lowest scope) |
| **B** | Active calibrations only — open + closed-structurally + recently-folded (~30 entries from M62/M63/M64 close-arcs) |
| **C** | Full M62/M63/M64 corpus including bonus-retires + carryovers + earlier-mission folded calibrations referenced by M62-M64 retrospectives (~50-60 entries) |
| **D** | Comprehensive — A,B,C + earlier M56/M57/M58/M61 calibrations retroactive (full historical reconstruction; mission-by-mission audit pass) |

### Q6 — Phase 1 Skill read-access surface (access-surface primary)

**What read-only Skill access ships at Phase 1?**

| Option | Skill scope |
|---|---|
| **A** | List/browse only (`/calibration list [--class] [--status] [--mission]`) — minimum surface |
| **B** | A + show-detail with cross-ref resolve (`/calibration show <id>` enriches with closure-PR-diff link + methodology-doc subsection + retrospective citation; multi-role accessible) |
| **C** | A + B + count-aggregates / status-overview surface (`/calibration status` cross-mission aggregate + status table; useful for Director governance + retrospective authoring) |
| **D** | A + B + C + named-pattern index browsing (`/calibration patterns` lists named architectural-pathology patterns with cross-ref to calibrations citing them) |

---

## §9 Round 2 — Director picks (received 2026-04-29)

| Question | Director pick(s) |
|---|---|
| **Q4 — Phase 1 ledger schema fidelity** | **B** (calibrations + named architectural-pathology patterns as separate first-class index) |
| **Q5 — Phase 1 migration scope** | **C** (full M62/M63/M64 corpus seed; ~50-60 entries) |
| **Q6 — Phase 1 Skill read-access surface** | **C** (browse + show-detail with cross-ref resolve + count-aggregates / status-overview) |

Single-pick on each (Round 2 tight-scope vs Round 1 multi-pick broad-scope).

---

## §10 Round 2 Step 3 — Aggregate response surface

Director ratifies **mid-scope Phase 1 substrate** (Q4=B: two first-class entity types — calibrations + named patterns; closure-PR cross-references + sourceRefs scalar fields, NOT separately-indexed first-class entities) seeded with **full M62/M63/M64 historical corpus** (Q5=C; ~50-60 entries; substrate-self-dogfood input) accessed via **read-centric multi-role Skill scaffolding with governance-overview surface** (Q6=C: browse + show-detail with cross-ref + status-aggregate; explicit exclusion of D = no dedicated patterns-browser at Phase 1).

**Composite stance Round 2:** scope-conservation aligned with Q3=B phased cadence. All three Round 2 picks (Q4=B, Q5=C, Q6=C) stop short of D; deferred items (closure-PR hyperlink resolution, retroactive earlier-mission migration, named-pattern-browser surface) compose into Phase 2+. **Phase 1 = substrate + seed + read-centric multi-role access; Phase 2+ = write authority + validation surface + browser-extension surfaces.**

---

## §11 Round 2 Step 4 — Per-question interpretation loop

### Q4 interpretation (B = entries + named patterns as separate first-class index)

**Multi-dim context:**
- *Original Idea:* idea-223 §"3 architectural-direction shapes" frames named-pattern indexing as architect-lean (option B in idea-223; aligned with Round 2 Q4=B)
- *Round 1 responses:* Q1=A,B,C,D (all-tele-primary) — schema fidelity supports tele-3 (foundational substrate); Q2=A,B,C (multi-role) — schema must surface BOTH calibrations AND patterns to all 3 roles
- *Round 2 tele-mapping:* tele-3 Absolute State Fidelity primary (single source-of-truth for calibrations + named patterns); tele-6 Deterministic Invincibility primary (named-pattern indexing enables schema-validated cross-references)
- *Aggregate-surface (Round 1 + Round 2):* phased delivery (Q3=B) means Phase 1 schema can stop at calibrations + patterns; closure-PR + sourceRefs sit as scalar fields, NOT separately-indexed first-class entities

**Interpretation:** Director scopes Phase 1 schema to **two first-class entity types**: calibrations AND named architectural-pathology patterns. Patterns require first-class status because they're **referenced BY MULTIPLE calibrations + BY METHODOLOGY DOC SUBSECTIONS** — pattern is substrate-of-cross-reference, not just a calibration property. A calibration's `pattern_membership` field references pattern ids; a pattern's `surfaced_by_calibrations` field references calibration ids; cross-link discipline enforced at edit-time (manual at Phase 1; mechanized validate operation in Phase 2+).

Closure-PR (`closure_pr: 130`) and origin (`origin: mission-64-W4-followon`) and thread-round (`surfaced_at: thread-414-round-2`) sit as **scalar fields on calibration entries**, NOT separately-indexed first-class entities. Phase 1 minimum-viable schema; if usage patterns later justify upgrading these to indexed entities (e.g., querying "all calibrations closed by mergecommit X"), Phase 2+ schema-version bump.

**Architectural implication:** schema YAML root contains `calibrations:` + `patterns:` sections; Phase 1 ADR ratifies the schema; schema-version field at root supports forward evolution.

**Anti-tele drift check Q4:** tele-3 + tele-6 primary; aligned with Round 1 Q1=A + Q1=D. ✓ No drift.

### Q5 interpretation (C = full M62/M63/M64 corpus seed)

**Multi-dim context:**
- *Original Idea:* idea-223 architect-lean seed scope was full M62-M64 corpus
- *Round 1 responses:* Q1=A,B,C,D — full seed maximizes tele-3 (foundational substrate density) + tele-6 (defeats hallucination by giving complete reference); Q2=A,B,C — full seed sustains tele-2 (multi-role coherence requires complete reference set)
- *Round 2 tele-mapping:* tele-3 Absolute State Fidelity primary (foundational substrate density); tele-2 Frictionless Agentic Collaboration secondary (multi-role coherence requires complete reference set at first-publish)
- *Aggregate-surface:* Q4=B (entries + patterns first-class) means seed includes BOTH calibrations AND named patterns — so seed scope expands to "M62-M64 calibrations + M64 named architectural-pathology patterns"

**Interpretation:** **non-empty foundational ledger from day-1.** ~50-60 entries:
- M62: 23 calibrations from W5 closing audit
- M63: calibration delta from M62 (5 retired: #17/#18/#19/#20main/#22; 2 NEW: #25/#26)
- M64: 14 NEW calibrations (#29/#30/#31/#32/#33/#34/#35/#36/#37/#38/#39/#40/#41/#42) + 1 bonus retire (#6 mission-62 full) + 1 carryover closed (#25 mission-63)
- Named architectural-pathology patterns from M64: methodology-bypass-becomes-substrate-defect-amplification-loop; two-sided-convergence-accounting; review-loop-as-calibration-surface; post-event-narration-aest-utc-discipline (4 patterns)

Q5 explicit exclusion of D (retroactive M56-M61) is scope-conservation: earlier-mission calibrations get retroactively migrated as opportunity arises (e.g., next time architect cites M56's substrate-self-dogfood-pattern origin in a new calibration's lineage field, that prompts retroactive migration). Not blocking on Mission #5.

**Why full M62-M64 seed at Phase 1 (not just active calibrations):** the seed IS the test-case for the schema. Substrate-self-dogfood at W3 dogfood gate: if schema/Skill works for the M62-M64 seed corpus (~50-60 entries; 4 named patterns; cross-link discipline enforced), it'll work for M65+ entries written against the schema going forward.

**Architectural implication for Phase 1 execution waves:** seed migration is a substantial chunk of W1+W2 work (~20-30% of mission-effort estimate). Each entry needs: extracting from narrative-doc-state (closing audits + retrospectives + methodology-doc subsections) + transforming to schema entry + cross-ref discipline + named-pattern membership tagging.

**Anti-tele drift check Q5:** tele-3 + tele-2 primary; aligned with Round 1 Q1=C + Q1=D. ✓ No drift.

### Q6 interpretation (C = browse + show-detail with cross-ref + count-aggregates / status-overview)

**Multi-dim context:**
- *Original Idea:* idea-223 architect-lean Skill scope (data-file + Skill option 2 of 3) anchored read-only Skill at Phase 1
- *Round 1 responses:* Q1=A,B,C,D — count-aggregates surface delivers tele-7 partial (operational efficiency in retrospective-authoring; "show me current calibration count") + tele-2 (cross-role coherence — Director governance surface); Q2=A,B,C — Skill multi-role
- *Round 2 tele-mapping:* tele-2 Frictionless Agentic Collaboration + tele-7 Resilient Operations primary for Skill access (multi-role + operational); tele-3 + tele-6 substrate-level (already covered by ledger schema)
- *Aggregate-surface:* Q4=B (calibrations + patterns first-class) means Skill must surface both via cross-ref resolve; Q5=C (full corpus seed) means Skill must handle ~50-60 entries efficiently; Q6=C (count-aggregates) addresses Director governance use case

**Interpretation:** Phase 1 Skill ships **3 verb-classes** (defer specific tool-surface verbs to idea-121):
1. **Browse/list** — list operation: filter by class/status/mission/origin; returns calibration ids + titles + status (multi-role)
2. **Show-detail with cross-ref resolve** — show operation: full calibration entry + named-pattern membership + closure-PR link + cross-doc references resolved (multi-role; pull-through for retrospective authoring + PR review)
3. **Count-aggregates / status-overview** — status operation: cross-mission aggregate (e.g., "M62: 23 calibrations / 5 retired by M63 / 1 retired by M64") + status table for Director governance + retrospective authoring

**Q6 explicit exclusion of D (named-pattern index browsing):** consistent with Q4=B (named patterns in schema but Skill doesn't have dedicated patterns-browser surface). Phase 1 patterns are accessible THROUGH show-detail cross-ref resolve (which surfaces pattern_membership → resolves to pattern definition); a dedicated patterns-browser defers to Phase 2+.

**The status-overview surface is particularly valuable for retrospective authoring:** architect calls Skill to get accurate counts for closing audit + retrospective; defeats the mission-64 LLM-hallucination drift class structurally (count drift "9 → 11 → 12 → 13 → 14" was the canonical surface that motivated idea-223; Q6=C inclusion of count-aggregates surface IS the operational-side closure for that drift class).

**Architectural implication:** Phase 1 Skill scaffolding is read-centric + cross-ref-rich + governance-friendly. NOT pattern-centric (deferred). NOT write-authoring (deferred). NOT validation (deferred). Scope-conservation aligned with Q3=B phased cadence.

**Anti-tele drift check Q6:** tele-2 + tele-7 primary; aligned with Round 1 Q1=B + Q1=C + Q2=A,B,C. ✓ No drift; count-aggregates surface explicitly closes the retrospective-authoring drift class (mission-64 origin).

---

## §12 Round 2 — Anti-tele drift check + cross-question coherence check

### Anti-tele drift check (Round 2)

| Q | Interpretation tele-mapping | Aligned with Round 1 picks? |
|---|---|---|
| Q4 | tele-3 + tele-6 primary | ✓ direct match (Q1=A + Q1=D from Round 1) |
| Q5 | tele-3 primary + tele-2 secondary | ✓ aligned with Q1=C + Q1=D inclusion |
| Q6 | tele-2 + tele-7 primary | ✓ aligned with Q1=B + Q1=C inclusion + Q2=A,B,C multi-role |

**No drift detected.** Round 2 interpretations align with Round 1 tele-priority signal.

### Cross-question coherence check (Round 2)

| Pair | Coherence |
|---|---|
| Q4+Q5 | ✓ schema (entries + patterns) + full M62-M64 seed = substrate-self-dogfood on historical corpus; schema validates at scale via seed migration |
| Q5+Q6 | ✓ full M62-M64 seed + count-aggregates surface = Director governance can audit historical calibration density immediately at Phase 1 |
| Q4+Q6 | ✓ entries+patterns schema + show-detail cross-ref resolve = Skill surfaces both first-class entity types via cross-ref mechanism (no separate patterns-browser needed at Phase 1) |
| Q4+Q5+Q6 | ✓ all aligned: entries+patterns first-class in schema + full historical seed + read-centric multi-role Skill with governance-overview surface |

**No internal contradictions.** Round 2 picks form a coherent Phase 1 substrate scope.

---

## §13 Cross-round coherence check (Round 1 + Round 2)

| Round 1 pick | Round 2 alignment |
|---|---|
| Q1=A,B,C,D (all 4 tele primaries) | Q4=B + Q5=C + Q6=C all hit at least one tele primary; aggregate covers all 4 — tele-3 via Q4+Q5; tele-6 via Q4 schema validation; tele-2 via Q6 multi-role + Q5 full seed; tele-7 via Q6 status-overview operational |
| Q2=A,B,C (3 internal roles; D excluded) | Q4 + Q5 + Q6 all support multi-role (schema is shared; seed is shared; Skill reads multi-role); Q6=C status-overview specifically supports Director governance use case |
| Q3=B (phased) | Q4 stops at B (not C/D); Q5 stops at C (not D); Q6 stops at C (not D) — all three Round 2 picks signal scope-conservation aligned with phased cadence; deferred items (closure-PR hyperlink + retroactive earlier missions + named-pattern browser + write surface + validation) compose into Phase 2+ |

**Round 1 + Round 2 coherence: excellent.** Round 2 picks tighten Phase 1 scope precisely without violating any Round 1 envelope constraint. Q1+Q3 Round-1 tension (comprehensive tele scope vs phased delivery) navigated by Round 2 picks delivering minimum-viable substrate for all 4 tele primaries while staying within phased cadence (no expansion to D-options).

---

## §14 Composite intent envelope (the "solved matrix"; pre-Design input artifact per `idea-survey.md` §5)

**Phase 1 (Mission #5) ratified scope:**

### Substrate (data-file)

- **Canonical YAML ledger** at `docs/calibrations/ledger.yaml` (single-file; YAML format; schema-versioned root field)
- **Two first-class entity types:**
  - `calibrations:` — id (numeric) + class (substrate / methodology) + title + origin (mission-X-WN) + status (open / closed-structurally / closed-folded / retired / superseded) + closure_mechanism (free-text) + closure_pr (scalar PR #) + pattern_membership (list of pattern ids) + cross_refs (list of doc paths)
  - `patterns:` — id (slug) + title + origin (mission-X-WN) + description (free-text) + surfaced_by_calibrations (list of calibration ids) + methodology_doc_subsection (file path + anchor)
- **Cross-link discipline:** every `pattern_membership` references existing pattern id; every `surfaced_by_calibrations` references existing calibration id; manual at edit-time (Phase 1); mechanized validate operation in Phase 2+
- **Schema documented in ADR (TBD ADR-NNN; SCAFFOLD ships in W0; RATIFIED at W4)**

### Seed (full M62/M63/M64 corpus)

- ~50-60 entries seeded at W1+W2 atomic execution:
  - M62: 23 calibrations from W5 closing audit
  - M63: 5 retired (#17/#18/#19/#20main/#22) + 2 NEW (#25/#26)
  - M64: 14 NEW (#29/#30/#31/#32/#33/#34/#35/#36/#37/#38/#39/#40/#41/#42) + 1 bonus retire (#6 from mission-62 full) + 1 carryover closed (#25 from mission-63)
- 4 named architectural-pathology patterns from M64 (methodology-bypass-becomes-substrate-defect-amplification-loop; two-sided-convergence-accounting; review-loop-as-calibration-surface; post-event-narration-aest-utc-discipline)
- W3 dogfood gate validates schema/Skill against seed corpus (substrate-self-dogfood input)
- Earlier-mission calibrations (M56/M57/M58/M61) retroactively migrated as opportunity arises (NOT blocking on Mission #5)

### Access surface (read-only Skill scaffolding; multi-role)

- Skill operation 1 (browse): `list [filters]` — multi-role
- Skill operation 2 (show-detail with cross-ref resolve): `show <id>` — multi-role; pull-through for retrospective authoring + PR review
- Skill operation 3 (count-aggregates / status-overview): `status` — multi-role; Director governance surface; closes mission-64 retrospective-authoring drift class structurally
- Tool-surface verb names defer to idea-121
- All 3 operations multi-role accessible at Phase 1; write authority + validate operations defer to Phase 2+
- NOT included at Phase 1: dedicated patterns-browser surface; Skill write-authoring; PR-diff validate operation

### CLAUDE.md integration

- Pointer paragraph (architect-lean default carried from idea-223; no specific Round 1/Round 2 question; not contradicted by any pick): 2-3 line addition referencing canonical ledger location + Skill verb category + named-pattern reference
- Specific wording authored at Phase 4 Design v1.0

### Methodology-doc rebinding (deferred)

- `multi-agent-pr-workflow.md` v1.0 ratified-with calibrations subsection stays prose at this mission (architect-lean default carried from idea-223; not contradicted by Round 1/Round 2)
- Auto-derive (option C in idea-223) defers to follow-on mission

### Phase composition

- **Phase 1 (Mission #5; this mission):** substrate + seed + read-only Skill scaffolding (3 verbs: list / show / status) + CLAUDE.md pointer + ADR
- **Phase 2 (follow-on mission):** Skill write-authority + PR-diff validate Skill + (optional) pre-commit hook + (optional) CI workflow + (optional) methodology-doc auto-derivation

### Sizing

- **Mission-class:** structural-inflection + tooling-introduction sub-class
- **M sizing** (~2-3 engineer-days)
- **Phase 7 Release-gate dependencies:** none (no new credentials / external posture); Director Survey-ratification + Phase 7 ratification only

### Constraint-envelope tensions navigated

1. **Q1+Q3 Round-1 tension** (all-tele-primary + phased) — navigated: Phase 1 prioritizes tele-6 + tele-3 (defensive + foundational substrate); tele-2 + tele-7 partial in Phase 1 (multi-role read-Skill + status-overview); tele-2 + tele-7 full closure in Phase 2+ (write authority + validation surface)
2. **Q4 entries+patterns first-class + Q6 no-patterns-browser** — navigated: patterns accessible via show-detail cross-ref resolve at Phase 1; dedicated patterns-browser defers to Phase 2+

---

## §15 Carry-forward to Design phase (per `idea-survey.md` §5)

Pre-Design input artifact = this Survey doc (persisted at `docs/surveys/m-calibration-codification-survey.md` — NB: methodology doc says `docs/designs/<mission>-survey.md` but mission-63/64 established `docs/surveys/` as canonical practice; minor methodology-vs-practice gap noted as **NEW calibration candidate** for filing during this mission's execution).

**Output ratified for Design phase ingestion:**
- All 6 Director picks (Round 1: Q1=A,B,C,D / Q2=A,B,C / Q3=B; Round 2: Q4=B / Q5=C / Q6=C)
- All 6 architect interpretations (per-question with multi-dim context citations; §5-§7 + §11)
- Composite intent envelope (the "solved matrix" — §14)
- 2 constraint-envelope tensions navigated (§14)
- 2 calibration-candidate observations:
  - Round 1 architect drift to multi-question-aggregation-only (will be filed as methodology-class calibration)
  - methodology vs practice gap on Survey persist-path (architect-judgment whether to file as calibration or just memory note)

**Phase 4 Design v0.1 authoring opens architect-led against this anchor.** Design v0.1 ships:
- §1 Goal + intent (echo Survey envelope)
- §2 Architecture (Phase 1 substrate + seed + Skill)
- §3 Wave plan (W0 + W1+W2 atomic + W3 dogfood gate + W4 closing)
- §4 Anti-goals (locked from Survey — NO scope creep into Phase 2+ items; NO LLM-side autonomous filing; NO replacement of irreducible methodology prose; NO new tool-surface verbs without idea-121)
- §5 Risks + open questions
- §6 Mission-class declaration + ADR-NNN SCAFFOLD
- §7 Engineer audit ask (round-1 questions for greg)

Director re-engages at Phase 7 Release-gate + Phase 9+10 retrospective per autonomous-arc-driving pattern.

---

## §10 Methodology drift acknowledgment (architect-self-correction; preserved from earlier draft)

Earlier draft of this Survey envelope (commit-staged then revised) violated `idea-survey.md` §11 anti-patterns:
1. Authoring 7 questions in a single round (methodology says Round 1 = 3 orthogonal; Round 2 = 3 more after picks)
2. Providing architect-lean recommendations for all 7 BEFORE Director picks (jumps past Step 4 per-question interpretation loop)
3. Conflating scope-decisions (output-shape, format, Skill ops, migration scope, CLAUDE.md, validation, methodology-doc rebinding) with Round 1 high-level intent anchoring (WHY/WHO/HOW-cadence)
4. Anti-pattern §11: "architect aggregate-only interpretation jumping straight to composite read without per-question loop"

**Self-corrected to strict methodology this revision.** Round 1 Steps 1-2 + Director picks captured. Round 1 Steps 3-4 (aggregate-surface + per-question interpretation loop) executed in §4-§7. Round 2 Step 1 (architect proposes 3 orthogonal questions) in §8.

This drift is **meta-evidence supporting idea-223 mechanization** (the very idea this Survey envelope is for): if Survey methodology were a `/survey new <idea-id>` Skill, the Round 1 / Director-picks / Step 4 interpretation / Round 2 structure would be enforced procedurally; LLM-side methodology drift would be defeated structurally. Same tele-6 + tele-3 argument idea-223 captures, applied to Survey methodology itself.

This drift will be captured as a NEW calibration during this mission's execution OR retrospective phase (architect-judgment at the time):
- **Class:** methodology
- **Title:** "LLM drift from documented multi-round Survey methodology — Round-1-aggregation-only anti-pattern"
- **Status:** OPEN at filing; closure path = idea-223 mechanization itself (when Survey is mechanized via Skill, the drift class closes structurally)

---

## §11 Cross-references

- **Source idea:** idea-223
- **Methodology:** `docs/methodology/idea-survey.md` v1.0 (strict process)
- **Lineage:** mission-64 close arc + Calibration #42 NEW + Review-loop-as-calibration-surface pattern
- **Mission sequencing:** Mission #5 = idea-223 (this); Mission #6 = idea-220 Phase 2 (per `reference_idea_219_220_post_mission_62.md`)

---

*Survey envelope authored 2026-04-29 lily / architect post-mission-64-close + post-methodology-drift-self-correction. Round 1 Steps 1-4 complete; Round 2 questions (Q4/Q5/Q6) authored; awaiting Director Round 2 picks. After Round 2 + Step 4 interpretation: composite intent envelope + Phase 4 Design v0.1 authoring opens.*
