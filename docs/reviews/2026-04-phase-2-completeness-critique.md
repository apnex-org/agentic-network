# Phase 2 Friction Cartography — Engineer Completeness-Critique

**Status:** ENGINEER COMPLETENESS-CRITIQUE COMPLETE — overall verdict **PASS** with one (1) minor coverage gap surfaced (sym-C-011 added).
**Author:** greg (engineer, eng-0d2c690e7dd5), 2026-04-22 AEST.
**Reviews:** `docs/reviews/2026-04-phase-2-friction-classification.md` at commit `f290723` on agent/lily (architect classification + ranking, Pass 2.α).
**Cadence position:** Per plan §Phase 2 cadence — engineer's completeness-critique step. Architect's draft was Director-approved-as-is (revision step skipped). My PASS verdict + the one gap-fix below clears the way for Director's final ratification.
**Source:** thread-252 (architect's critique-ready ping).

---

## 1. Verdict

**PASS** with one minor coverage gap fixed.

| Critique scope | Result |
|---|---|
| Symptom coverage (50/50 mapped to a domain) | ✓ PASS — verified per-symptom-id across §3.1–§3.11 |
| Per-source attribution counts (A=28, B=12, C=10) | ✓ PASS — matches engineer TSV row counts exactly |
| 6 architect reassignments validated against body-evidence | ✓ PASS — all 6 well-justified |
| Missed symptoms | **1 minor gap surfaced** — see §4 |
| no-idea-filed counts cross-check | ✓ PASS — all counts cross-checked against engineer linked_ideas data |

Phase 2 convergence-criteria satisfied. Pass 2.α stands; no Pass 2.β revision needed beyond folding sym-C-011 in.

---

## 2. Coverage check (50/50)

Verified by enumerating every symptom-id from `docs/reviews/2026-04-phase-2-data/{bugs,threads,traces}-symptoms.tsv` against the per-domain assignments in classification §3.1–§3.11:

- All 28 sym-A-* (A-001 through A-028) appear in exactly one domain ✓
- All 12 sym-B-* (B-001 through B-012) appear in exactly one domain ✓
- All 10 sym-C-* (C-001 through C-010) appear in exactly one domain ✓
- Domain totals sum: 12 + 8 + 7 + 4 + 4 + 4 + 3 + 3 + 2 + 2 + 1 = 50 ✓

Zero double-counts, zero missing assignments, zero `new-domain-needed` flags survived. Convergence-criterion #1 satisfied.

---

## 3. Reassignments validated (6/6)

All 6 architect-pass reassignments are well-justified against the body-evidence in the source bug/thread/trace:

| Symptom | Engineer→Architect change | Justification verified |
|---|---|---|
| sym-A-006 (bug-6 get_task) | cognitive-layer → **tool-surface** | bug-6 IS a tool-surface API gap (lacks taskId param); LLM is downstream consumer not the bug-site. Symmetric with sym-A-013 reasoning. ✓ |
| sym-A-015 (bug-15 INV-TH17) | cognitive-layer → **observability** | bug-15 class is literally "observability-gap"; body explicitly about lacking shadow-invariant instrumentation. Engineer heuristic missed because bug-15 was filed during cognitive-hypervisor work. ✓ |
| sym-A-016 (bug-16 lifecycle gaps) | cognitive-layer → **identity-layer** | Agent entity lifecycle IS identity-layer; my heuristic didn't trigger because bug-16's class is `missing-feature` not `identity-management`. ✓ |
| sym-A-021 (chunk-reply UTF-16) | tool-surface → **delivery** | Chunk-reply IS the message delivery mechanism; tool-surface was my heuristic catch-all. ✓ |
| sym-A-022 (continuation sweep retry) | entity-vocabulary → **cascade-execution** | Symptom is the SWEEP behavior continuing forever; that's cascade-execution by definition. Schema-gap is downstream symptom only. ✓ |
| sym-B-004 (workflow tests) | debugging-loop → **observability** | Architect framing in §5 (Filing-Point ≠ Fault-Domain) is sound; can't measure invariant enforcement IS an observability surface. ✓ |

88% engineer-architect agreement (44/50 retained). All 6 disagreements move to demonstrably better-fitting domains.

---

## 4. ONE coverage gap surfaced — sym-C-011 (engineer-permission gap on dismissal)

While verifying the no-idea-filed cross-check against my Pass 1.1 cartography artifact (§3.2 of `docs/reviews/2026-04-phase-1-cartography.md` documents 9 bug-migration legacy ideas marked `audit:valid=superseded-by-bug:bug-N` but **status flip from triaged → dismissed deferred to architect** per Hub `update_idea` schema), I noticed this is itself a friction symptom that none of my Passes A/B/C captured.

**Symptom narrative:** Engineer cannot transition idea status from `triaged → dismissed` (or `incorporated`); only architect can per Hub `update_idea` schema. Forces round-trip: engineer applies marker tags (e.g. `audit:valid=superseded-by-bug:bug-N`) but architect must complete the lifecycle. Surfaced during Pass 1.1 revision when 9 bug-migration legacy ideas needed dismissal after marker-tag application. Not blocking but adds engineer-architect handoff cost.

**Filed as:** `sym-C-011` in `docs/reviews/2026-04-phase-2-data/traces-symptoms.tsv`.

**Suggested architect classification:**
- domain: **role-scoping** (engineer-architect permission boundary; classic role-scoping concern)
- secondary: **tool-surface** (the schema-shape is the proximate cause)
- tele violations: tele-2 (Isomorphic Spec — declared marker-tag should authorize dismissal), tele-6 (Frictionless Collaboration — round-trip handoff)
- frequency: once-per-bug-migration (rare)
- cost: minor
- linked_ideas: (none) — not currently in backlog; this critique is the first-class artifact
- fix_status: no-idea-filed

**Impact on classification §3.7 role-scoping cluster:** grows from 3 → **4 symptoms**. C-011's score (1×2=2 — once-per-bug-migration × minor) is low, so it doesn't shift the role-scoping ranking. But it strengthens the §4 cross-source observation: role-scoping was 3-trace-only; C-011 keeps it trace-only AND adds one more 100%-unaddressed symptom in the cluster.

**Architect can:**
- (a) Fold sym-C-011 into existing role-scoping cluster (no Pass 2.β needed; just amend §3.7 + Appendix A counts)
- (b) Treat as Pass 2.β-trigger (heavier; not warranted given the gap is minor)

Recommend (a). Fix is a 2-line edit to her §3.7 + the corresponding count fields.

---

## 5. Sanity-checks for the architect-pass observations

Spot-checked architect's high-confidence observations against engineer source data:

- **§5 Filing-Point ≠ Fault-Domain pattern** — confirmed against my data. sym-A-015 was filed during cognitive-layer work but is observably an observability concern (lily right). My heuristic had no fault-domain inference logic; only filing-point classification.
- **§4 Cross-source distribution** — single-source domains (role-scoping, deployment, debugging-loop) are all trace-only. Confirmed via my engineer source TSVs. The hypothesis "filing-discipline drives domain visibility" is sound — operators don't file bugs against operational friction.
- **§3.7 role-scoping 100% unaddressed** — confirmed: 3/3 (now 4/4 with sym-C-011) symptoms have no linked_ideas + no mission. Strongest gap in the corpus.
- **§7 sym-B-004 highest-overall (15) among 50** — confirmed by computing freq×cost on every symptom; B-004 is the unique top-scorer.

No spot-check failures. Architect's analysis is internally consistent + matches engineer source data.

---

## 6. Out-of-scope items NOT critiqued (per architect's brief)

Per lily's thread-252 brief, the following are explicitly NOT in engineer-critique scope and have not been touched:

- Domain definitions (Phase 1 + classification-pass fixed)
- Ranking weights / methodology choice (architect-authored per §2)
- Phase 4 mission-candidate preview content (§9 — Phase 4 author-authority)
- Methodology-retrospective inputs (§11 — harvest for Phase 4, not litigated here)

Engineer-side observations on the §9 candidates and §11 retrospective items are filed only as "observations for Phase 4 / retrospective consumption" — not as critique:
- §9 #1 (Workflow Test Harness) and §9 #2 (Role-Scoping Discipline) align with the highest-leverage `no-idea-filed` symptoms (B-004, C-009 + now C-011). Strong Phase 4 candidates from engineer perspective too.
- §11 #3 (operational-friction entity class) is a structural answer to the gap pattern — would benefit from Phase 3 Concept extraction explicitly naming "operational-friction" as a class.

---

## 7. Convergence

Per plan §Phase 2 convergence:

| Criterion | Verdict |
|---|---|
| Every significant bug + every major in-thread friction report maps to a domain | ✓ PASS — 51/51 with sym-C-011 added |
| Domains are ranked with rationale | ✓ PASS — architect §3 + §8 hold; sym-C-011 fold-in is amend-only |

**Phase 2 convergence achieved.** Pass 2.α + sym-C-011 amend = ratification-ready.

Cadence forward (per plan §Phase 2):
1. ✓ Architect drafts (f290723)
2. ✓ Director reviews (approved-as-is per architect on thread-252)
3. ⤬ Architect revises (skipped per Director)
4. ✓ **Engineer completeness-critique** (this artifact at commit-ETA-imminent)
5. → Director ratifies → Phase 2 closes
6. → Phase 3 Concept + Defect extraction opens (architect-led)

---

*End of engineer completeness-critique. Awaiting Director final ratification. No Pass 2.β triggered.*
