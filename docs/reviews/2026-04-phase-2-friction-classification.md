# Phase 2 Friction Cartography — Architect Classification + Ranking

**Status:** DRAFT — awaits Director review + engineer completeness-critique per plan §Phase 2 cadence
**Author:** lily (architect, eng-40903c59d19f), 2026-04-22 AEST
**Consumes:** engineer Pass 2.A+B+C symptom collection at `agent/greg:82737b6` — `docs/reviews/2026-04-phase-2-friction-symptoms-engineer.md` + `docs/reviews/2026-04-phase-2-data/{bugs,threads,traces}-symptoms.tsv` (50 symptoms)
**Plan reference:** `docs/reviews/2026-04-architectural-review.md` §Phase 2
**Thread context:** thread-251 (backchannel, now `round_limit`); next exchange on fresh thread if needed

---

## 0. Scope + cadence position

Phase 2 Friction Cartography, architect-authored classification + ranking pass. Engineer-side symptom collection closed at `82737b6`. Per the plan's critique cadence, this artifact is the architect's primary output; Director reviews → architect revises → engineer critiques for symptom-coverage completeness → Director ratifies. Phase 3 Concept + Defect extraction opens on ratification.

**This pass does:** classifies 50 symptoms against the 11-domain taxonomy, computes frequency × cost rankings per symptom + per domain, identifies remaining-gaps (symptoms with no-idea-filed status) per domain, surfaces cross-cutting findings.

**This pass does NOT:** author mission briefs (that is Phase 4), file new ideas (anti-goal §8), file bugs (anti-goal §8), re-open tele assignments (Phase 1 closed).

---

## 1. Input summary

50 symptoms across 3 sources (engineer-provided; independently verified via TSV read):

| Source | Count | Symptom range | Coverage contribution |
|---|---|---|---|
| Pass 2.A (bug-walk) | 28 | sym-A-001..028 | system-defect surface |
| Pass 2.B (thread scan) | 12 | sym-B-001..012 | architectural-decision friction + live-evidence trail |
| Pass 2.C (work-trace harvest) | 10 | sym-C-001..010 | operational / governance / workflow friction |
| **Total** | **50** | — | — |

Schema: 8 fields per symptom (symptom_id, source, narrative, domain_candidate, tele_violations, frequency, cost, linked_ideas, fix_status). All 50 symptoms have every field populated.

Engineer-side Phase 2 scope is closed; no further symptoms expected from Pass A/B/C. If Director ratification surfaces new friction patterns, Pass 2.D would be opened.

---

## 2. Methodology

**Frequency × Cost ranking** — numeric scoring on observed symptoms:

| Frequency | Score | Cost | Score |
|---|---|---|---|
| once | 1 | trivial | 1 |
| rare-historical | 1 | minor | 2 |
| rare | 2 | moderate | 3 |
| recurring | 3 | blocking | 4 |
| frequent | 4 | cascade-blocker | 5 |
| continuous | 5 | | |

Product in [1..25]. Higher = higher-priority for mission selection in Phase 4.

**Rare-historical** scored as 1 (matching "once") — historical bugs now resolved represent closed-class friction; they inform architecture but do not compete for Phase 4 investment. Score weighting deliberately downweights them vs active symptoms.

**Classification pass** — for each symptom, architect verifies engineer's `domain_candidate`:
- Accept as primary if tightest fit per the 11-domain taxonomy definitions
- Reassign primary if another domain is tighter; note secondary to preserve context
- Flag `observability-absorbed` cases where bug origin obscures observability as the real class
- Flag `joint-attribution` cases where two domains genuinely couple (reciprocal secondaries)

**Fix-status cross-reference** — validated against engineer's `linked_ideas` assignments + Hub state for each symptom. Remaining gaps = symptoms with `no-idea-filed` (unaddressed in backlog).

---

## 3. Classification — per-domain breakdown

Cluster sizes post-architect-reclassification. 50-symptom distribution across 11 domains (§0 taxonomy):

| # | Domain | Symptoms (post-architect) | Pass A | Pass B | Pass C |
|---|---|---|---|---|---|
| 1 | tool-surface | **8** | 5 | 2 | 1 |
| 2 | coordination | 4 | 2 | 0 | 2 |
| 3 | delivery | 4 | 3 | 1 | 0 |
| 4 | role-scoping | 3 | 0 | 0 | 3 |
| 5 | entity-vocabulary | 3 | 1 | 2 | 0 |
| 6 | deployment | 2 | 0 | 0 | 2 |
| 7 | debugging-loop | 1 | 0 | 0 | 1 |
| 8 | observability | **2** | 1 | 1 | 0 |
| 9 | cognitive-layer | 4 | 3 | 1 | 0 |
| 10 | identity-layer | **7** | 5 | 2 | 0 |
| 11 | cascade-execution | **12** | 8 | 3 | 1 |
| | **Total** | **50** | 28 | 12 | 10 |

*Observability is no longer empty post-classification* — the migration is documented in §5.

### 3.1 cascade-execution (12 symptoms — largest cluster)

**Symptoms:** A-002, A-008, A-009, A-014, A-022, A-023, A-027, A-028, B-002, B-005, B-007, C-002

**Ranking (by frequency × cost):**
| Rank | Symptom | Score | Fix-status | Note |
|---|---|---|---|---|
| 1 | B-005 | 9 | idea-filed (idea-94) | Counter-increment race |
| 2 | B-002 | 6 | no-idea-filed | Mission-task linkage drift |
| 3 | C-002 | 6 | no-idea-filed | Mission-entity duplication |
| 4 | A-022 | 4 | no-idea-filed | Continuation sweep retry cap gap |
| 5 | A-023 | 4 | no-idea-filed | Thread bilateral-seal race |
| 6-12 | (others) | 2-4 | shipped / idea-triaged | Historical closures |

**Existing ratified fixes in backlog:** mission-24 (Threads 2.0 Phase 2 cascade), mission-29 (M-Cascade-Perfection), idea-94 (cascade audit replay-queue). Majority of cascade-execution historical bugs (A-001, A-007, A-008, A-009, A-014) closed via these.

**Remaining gaps:** 6 symptoms at no-idea-filed status.
- **A-027** (propose_mission documentRef drop) — drift bug; recent; architect encountered this during mission-40 filing (§A3 of Phase 1 cartography)
- **A-028** (DAG dep-eval against completed-task → blocked) — drift bug; recent; architect encountered this during mission-40 T2 issuance
- **A-022** (continuation sweep infinite retry) — hardening gap post-mission-38
- **A-023** (bilateral-seal race) — investigating
- **B-002** (mission-task linkage drift) — long-standing
- **C-002** (mission duplication during cascade) — long-standing, observable in Hub-state today (mission-31/32/33/34 quad-dup; mission-37/38 pair-dup)

**Assessment:** cascade-execution is the largest cluster but mostly historical. The 6 remaining gaps are the Phase 4 candidate set — they cluster around cascade correctness (A-022/23/27/28) and mission-cascade drift (C-002, B-002). Two missions could absorb these: "Cascade Correctness Hardening" + "Mission-Cascade Drift Audit".

### 3.2 tool-surface (8 symptoms — second-largest cluster)

**Symptoms:** A-001, A-004, A-006 (reassigned from cognitive-layer), A-012, A-013, B-001, B-003, C-007

**Ranking (by frequency × cost):**
| Rank | Symptom | Score | Fix-status | Note |
|---|---|---|---|---|
| 1 | B-001 | 9 | idea-triaged (idea-29, idea-69) | Tool Discovery Lag |
| 2 | B-003 | 8 | no-idea-filed | Typo Black Hole (assignedEngineerId) |
| 3 | C-007 | 4 | no-idea-filed | Tarball regen noise |
| 4-8 | A-001, A-004, A-006, A-012, A-013 | 2-4 | shipped / idea-triaged / no-idea-filed | Scattered contract/schema gaps |

**Existing ratified fixes in backlog:** idea-29 (schema-cache fingerprinting), idea-69 (tool-surface MCP standardization), idea-121 (API v2.0 tool-surface modernization — the umbrella for most tool-surface work).

**Remaining gaps:** 3 no-idea-filed:
- **B-003** (typo Black Hole) — no validation lifecycle for agentId-typed fields — concerns identity-layer adjacent
- **C-007** (tarball regen noise) — operational hygiene; trivial cost
- **A-012** (threads-2-smoke test helper drift) — test-infrastructure

**Assessment:** tool-surface has active triaged ideas (idea-29, idea-69, idea-121) covering most classes. Remaining gaps are narrow. B-003 (typo Black Hole) is the only blocking-cost unaddressed gap; recommend filing as Phase 4 candidate or rolling into idea-121 scope.

### 3.3 identity-layer (7 symptoms)

**Symptoms:** A-005, A-016 (reassigned from cognitive-layer), A-017, A-018, A-026, B-006, B-009

**Ranking:**
| Rank | Symptom | Score | Fix-status | Note |
|---|---|---|---|---|
| 1 | B-009 | 9 | idea-filed (idea-122) | Agent orphan lifecycle from label mutation |
| 2-7 | A-005, A-016, A-017, A-018, A-026, B-006 | 2-3 | shipped | Historical closures (mission-18/19/40, bug-16) |

**Existing ratified fixes in backlog:** mission-40 closed the core displacement bug (bug-26). bug-16 reaper partially addresses orphan accumulation. idea-122 (`reset_agent` operator affordance) covers the last open symptom (B-009).

**Remaining gaps:** zero no-idea-filed symptoms. Identity-layer is **effectively closed** — all shipped or covered by filed ideas. The Phase 1 architect observation that mission-40 structurally closes identity-layer is empirically confirmed by the bug-walk.

**Assessment:** identity-layer is the most mature domain in the backlog. Not a Phase 4 investment target — the work has landed.

### 3.4 cognitive-layer (4 symptoms, post-reclassification)

**Symptoms:** A-003, A-011, A-019, B-008

*Post-reclassification note:* Engineer's Pass 2.A had 7 cognitive-layer symptoms; architect reassignments moved 3 out (A-006 → tool-surface; A-015 → observability; A-016 → identity-layer). The 4 remaining are genuinely cognitive-layer.

**Ranking:**
| Rank | Symptom | Score | Fix-status | Note |
|---|---|---|---|---|
| 1 | A-011 | **12** | idea-triaged (idea-132) | bug-11 cognitive silence — CRITICAL severity |
| 2 | B-008 | 3 | shipped-but-leaks | Architect Amnesia + voluntary idempotency |
| 3 | A-003 | 4 | idea-triaged (idea-28) | Context Desynchronization |
| 4 | A-019 | 2 | shipped | Queue-item settlement friction (idea: sourceQueueItemId explicit) |

**Existing ratified fixes:** mission-38 shipped 5 mitigations (round-budget awareness, parallel dispatch, tool-result caching, chunked replies, graceful exhaustion); tele-11 Cognitive Minimalism filed 2026-04-22 naming the mandate. idea-132 captures the scope of bug-11 remediation.

**Remaining gaps:** zero no-idea-filed. A-011 bug-11 is captured by idea-132 (triaged, not mission-active). The Phase 4 question: does idea-132 warrant promotion to mission brief given bug-11's CRITICAL+recurring status?

**Assessment:** cognitive-layer is high-priority (contains the highest single-symptom score in the open set — A-011 = 12) but has an existing scope idea. Phase 4 investment decision is *promote idea-132 to mission* vs *status quo*.

### 3.5 coordination (4 symptoms)

**Symptoms:** A-007, A-020, C-001, C-005

**Ranking:**
| Rank | Symptom | Score | Fix-status | Note |
|---|---|---|---|---|
| 1 | C-001 | 9 | idea-triaged (idea-144) | Nudge-cycle protocol |
| 2 | C-005 | 6 | idea-triaged (idea-144) | ACK-without-state |
| 3 | A-020 | 3 | shipped | Workflow-advancement (bug-20 via task-316) |
| 4 | A-007 | 2 | shipped | convergenceAction Path A/B dual-firing (historical) |

**Existing ratified fixes:** task-316 partially addresses; idea-144 (workflow engine review→next-task advancement) is the remaining-scope vehicle.

**Remaining gaps:** zero no-idea-filed. idea-144 covers the active friction. Phase 4 question: promote idea-144?

**Assessment:** coordination has clear remediation scope (idea-144) but waiting on Director triage. Phase 4 candidate with low-moderate leverage.

### 3.6 delivery (4 symptoms)

**Symptoms:** A-010, A-021 (reassigned from tool-surface), A-025, B-012

**Ranking:**
| Rank | Symptom | Score | Fix-status | Note |
|---|---|---|---|---|
| 1 | B-012 | **12** | shipped-but-leaks | bug-25 truncation LIVE evidence |
| 2 | A-025 | 9 | no-idea-filed | bug-25 thread truncation |
| 3 | A-021 | 4 | no-idea-filed | Chunk-reply UTF-16 splitting |
| 4 | A-010 | **4** (shipped-but-leaks per §6) | shipped-but-leaks | bug-10 transport-only fix |

**Existing ratified fixes:** bug-10 shipped via ADR-017 transport-layer; bug-11 files the cognitive-layer leak scope (cross-domain); idea-152 (Smart NIC Adapter) is target-state that absorbs delivery-layer entirely.

**Remaining gaps:** A-025 + A-021 unaddressed. A-025 (bug-25) is the marquee — recurring×moderate, no short-term fix filed. Short-term mitigation (adapter size-guard) stance was ratified during tele-audit but no mission exists to implement it.

**Assessment:** delivery has a concentrated unaddressed pattern (bug-25 class). Mission-candidate material: "bug-25 Adapter Size-Guard" (quick-win) + eventual idea-152 Smart NIC (structural). High-value Phase 4 target.

### 3.7 role-scoping (3 symptoms — emergent domain)

**Symptoms:** C-006, C-009, C-010

**Ranking:**
| Rank | Symptom | Score | Fix-status | Note |
|---|---|---|---|---|
| 1 | C-009 | **10** | no-idea-filed | Architect-triage queue deferred indefinitely |
| 2 | C-006 | 6 | no-idea-filed | Late design ratification at task-issuance |
| 3 | C-010 | 6 | no-idea-filed | Scope-discovery-late (task-311 pre-satisfied) |

**Existing ratified fixes:** **zero** ideas in backlog address any of these.

**Remaining gaps:** **100% unaddressed.** All 3 symptoms no-idea-filed.

**Assessment:** This is the most-striking Phase 2 finding at the gap level. Role-scoping emerged as a domain via Pass C (work-traces); bug entities and threads don't surface it; no backlog idea captures any of the three symptoms. This is a cold-start domain — operator-level friction visible in session logs but never named as a first-class concern. Phase 4 candidate: "Role-Scoping Discipline Mission" covering architect-triage SLA + late-ratification + scope-discovery — structural work with no prior design artifacts. HIGH priority per aggregate-score density (3 symptoms averaging 7.3 score, vs 4-5 median for other domains).

### 3.8 entity-vocabulary (3 symptoms)

**Symptoms:** A-024, B-010, B-011

**Ranking:**
| Rank | Symptom | Score | Fix-status | Note |
|---|---|---|---|---|
| 1 | A-024 | **9** | no-idea-filed | bug-24 no tele retirement primitive |
| 2 | B-011 | 3 | idea-filed (implicit — bug-24 captures) | Tele-retirement blocker observed live |
| 3 | B-010 | 6 | idea-filed (idea-30) | Dormant Missions FSM-substate gap |

**Existing ratified fixes:** idea-30 (mission-FSM staged substate) covers B-010. Nothing for bug-24.

**Remaining gaps:** A-024 (bug-24) unaddressed. Blocked both this session (tele-rewrite) and ongoing tele-lifecycle work.

**Assessment:** bug-24 is the marquee entity-vocabulary gap — no retirement primitive for teles. Small, bounded, high-impact mission candidate ("Tele Retirement Primitive Implementation"). Classic quick-win per Phase 4 categorization.

### 3.9 observability (2 symptoms — migrated-in from other domains)

*This domain was empty in engineer's Pass A+B+C outputs. Post-architect reclassification, 2 symptoms migrated in — see §5 for the absorbed-and-obscured pattern.*

**Symptoms:** A-015 (reassigned from cognitive-layer), B-004 (reassigned from debugging-loop)

**Ranking:**
| Rank | Symptom | Score | Fix-status | Note |
|---|---|---|---|---|
| 1 | B-004 | **15** — HIGHEST OVERALL | no-idea-filed | No automated workflow tests — 28 INV "Tested By: NONE" |
| 2 | A-015 | 2 | shipped | INV-TH17 shadow-invariant instrumentation (bug-15 RESOLVED) |

**Existing ratified fixes:** bug-15 shipped for INV-TH17. Nothing filed for B-004.

**Remaining gaps:** B-004 (workflow-testing gap) — the single highest-scored symptom across all 50. Continuous × moderate = 15. No idea exists to address.

**Assessment:** observability is a small cluster (2 symptoms) but contains the HIGHEST-SCORED single symptom in the entire Phase 2 set. B-004 (workflow-testing gap touching 28 "Tested By: NONE" invariants) is the structural-leverage candidate for Phase 4. Mission-candidate material: "Workflow Test Harness" — addresses observability primary + unlocks tele-2 Isomorphic Specification + tele-9 Chaos-Validated Deployment success criteria.

### 3.10 deployment (2 symptoms — emergent domain)

**Symptoms:** C-003, C-004

**Ranking:**
| Rank | Symptom | Score | Fix-status | Note |
|---|---|---|---|---|
| 1 | C-003 | 9 | no-idea-filed | Deploy-gap (task-310 telemetry un-deployed ~2 days) |
| 2 | C-004 | 3 | shipped | ADC gotcha (RESOLVED via deploy/build.sh auto-export) |

**Existing ratified fixes:** idea-150 (Environment Deployer CI/CD GCP) covers structural deployment scope but specifically the deploy-gap is not linked.

**Remaining gaps:** C-003 (deploy-gap) — commits land on main but don't reach prod until manual redeploy. Recurring×moderate.

**Assessment:** deployment is small but has one active recurring symptom. idea-150 is the structural mission (Environment Deployer); C-003 is a sub-scope that idea-150 would absorb. No immediate Phase 4 candidate at this scale.

### 3.11 debugging-loop (1 symptom)

**Symptoms:** C-008

**Ranking:**
| Rank | Symptom | Score | Fix-status | Note |
|---|---|---|---|---|
| 1 | C-008 | 9 | idea-triaged (idea-120) | Director-sharpening idea-promotion-late |

**Existing ratified fixes:** idea-120 captures the provenance pattern.

**Remaining gaps:** zero no-idea-filed.

**Assessment:** debugging-loop is under-populated at 1 symptom. Not a Phase 4 concentration target; the pattern is captured.

---

## 4. Cross-source domain distribution — first-class Phase 2 finding

Engineer's Pass B observation (confirmed during thread-251 round 8): **the three evidence-sources emit three genuinely-different domain distributions.** Ranking a domain solely by one source systematically underweights cross-layer friction.

| Source | Over-represents | Under-represents |
|---|---|---|
| Bug entities (A) | tool-surface, cascade-execution, cognitive-layer, identity-layer | coordination, role-scoping, deployment, debugging-loop |
| Work-traces (C) | coordination, role-scoping, deployment, debugging-loop | tool-surface, cognitive-layer, identity-layer (defects already in bug entities) |
| Threads (B) | architectural-decision friction, entity-vocabulary, mixed | domains already captured in bug/trace; threads are live-evidence-trail more than novel-symptom-source |

**Implication for ranking:** A domain's priority is the product of (per-symptom score × symptom-density across sources). Domains with cross-source coverage are "multi-layer" and warrant higher Phase 4 scrutiny; single-source domains are narrower in scope.

| Domain | Bug source | Trace source | Thread source | Cross-source? |
|---|---|---|---|---|
| cascade-execution | ✓ | ✓ | ✓ | **YES** |
| identity-layer | ✓ | — | ✓ | PARTIAL |
| tool-surface | ✓ | ✓ | ✓ | **YES** |
| coordination | ✓ | ✓ | — | PARTIAL |
| delivery | ✓ | — | ✓ | PARTIAL |
| role-scoping | — | ✓ | — | SINGLE |
| entity-vocabulary | ✓ | — | ✓ | PARTIAL |
| deployment | — | ✓ | — | SINGLE |
| cognitive-layer | ✓ | — | ✓ | PARTIAL |
| observability | ✓ | — | ✓ | PARTIAL |
| debugging-loop | — | ✓ | — | SINGLE |

Three domains (role-scoping, deployment, debugging-loop) are single-source — all observed only via work-traces. This is NOT because they don't exist elsewhere; it's because bug entities and threads don't name the friction class. **Filing bugs against operational friction is a pattern operators don't have today.**

**Methodology-retrospective input:** Phase 2 reveals that filing-discipline drives domain visibility. Role-scoping has 3 symptoms, 0 linked ideas (100% unaddressed) — plausibly because operators don't file bugs on "my triage queue is indefinitely deferred." Addressing this requires a Phase 4 operational-hygiene mission OR a cultural change in what gets filed where.

---

## 5. Observability absorbed-and-obscured — second first-class finding

Engineer's Pass A+B+C surfaced ZERO symptoms in the observability domain. After architect reclassification, 2 symptoms migrated in (A-015, B-004). The reason: **operators file symptoms at the point-of-observation, not at the domain-of-defect.**

| Symptom | Engineer classification | Architect classification | Why reassigned |
|---|---|---|---|
| sym-A-015 (bug-15 INV-TH17 shadow-invariant instrumentation) | cognitive-layer | **observability** | Bug class is "observability-gap" (from bug entity); body is explicitly about lacking instrumentation at enforcement sites. Cognitive-layer was proximate-adjacent because the bug was found during cognitive-hypervisor work, but domain-of-defect is observability. |
| sym-B-004 (no automated workflow tests — 28 INV "Tested By: NONE") | debugging-loop | **observability** | The 28 invariant coverage gap IS an observability surface (can't measure enforcement). debugging-loop was reasonable (developer-facing friction); observability is tighter. |

**Pattern name:** **Filing-Point ≠ Fault-Domain.** Operators file against where they SEE the symptom, not against where the fault lives. A cascade handler that throws but isn't instrumented gets filed as cascade-execution (because that's where the operator saw it) even though the fault-domain is observability.

**Implication for Phase 3 Concept extraction:** this is a candidate Concept — "domain-classification requires bidirectional analysis (point-of-observation AND domain-of-defect)". Flag for Phase 3 harvesting.

**Implication for Phase 4 mission briefs:** the workflow-testing mission (addressing B-004) should be explicitly framed as observability-domain work, not debugging-UX. Naming matters: a "debugging improvements" mission would scope differently than an "observability infrastructure" mission, even with the same scope.

---

## 6. Per-symptom reclassification table

Architect-pass changes to engineer's domain_candidate:

| Symptom | Engineer | Architect | Reason |
|---|---|---|---|
| sym-A-006 (bug-6 get_task historical tasks) | cognitive-layer | **tool-surface** | Tool scope gap, not cognition (parallel with sym-A-013's engineer-reclassification) |
| sym-A-015 (bug-15 INV-TH17 instrumentation) | cognitive-layer | **observability** | Fault-domain per §5 |
| sym-A-016 (bug-16 agent lifecycle gaps) | cognitive-layer | **identity-layer** | Agent-entity concerns are identity-layer |
| sym-A-021 (task-313 chunk-reply UTF-16 splitting) | tool-surface | **delivery** | Splitting is delivery mechanism |
| sym-A-022 (continuation sweep retry cap) | entity-vocabulary | **cascade-execution** | Symptom is cascade behavior; schema-gap secondary |
| sym-B-004 (workflow tests) | debugging-loop | **observability** | Fault-domain per §5 |

Primary domain on 6 symptoms changed; 44 of 50 symptoms (88%) retained engineer's primary. Matches the ~80% agreement prediction on thread-251 round 2.

**Secondary-domain additions** (primary unchanged; architect added cross-domain context):

| Symptom | Added secondary | Reason |
|---|---|---|
| sym-A-003 (Context Desync) | observability | Operator-can't-see-architect-context angle |
| sym-A-006 | observability | Historical-task visibility |
| sym-A-011 (bug-11) | coordination | Downstream impact (nudge cycles) |
| sym-A-012 (threads-2-smoke drift) | observability | Test-coverage visibility |
| sym-A-015 | cascade-execution | Enforcement-layer manifestation |
| sym-A-019 | cascade-execution | Queue-lifecycle mechanism |
| sym-A-022 | entity-vocabulary | Schema-gap component |
| sym-A-023 | coordination | Cascade-layer convergence coupling |
| sym-B-004 | debugging-loop | Developer-facing surface |
| sym-B-005 | observability | Partial-fix-pattern visibility |
| sym-B-008 | cascade-execution | Idempotency enforcement |
| sym-C-001 | cognitive-layer | Root cause (architect event-loop gap) |
| sym-C-005 | observability | ACK-visibility gap |
| sym-C-008 | role-scoping | Triage-process framing |

---

## 7. Top symptoms by frequency × cost

**Ranking across all 50 symptoms:**

| Rank | Symptom | Score | Domain | Fix-status |
|---|---|---|---|---|
| 1 | **sym-B-004** | **15** | observability | no-idea-filed |
| 2 | **sym-A-011** | **12** | cognitive-layer | idea-triaged (idea-132) |
| 3 | **sym-B-012** | **12** | delivery | shipped-but-leaks |
| 4 | sym-C-009 | 10 | role-scoping | no-idea-filed |
| 5 | sym-A-024 | 9 | entity-vocabulary | no-idea-filed |
| 6 | sym-A-025 | 9 | delivery | no-idea-filed |
| 7 | sym-B-001 | 9 | tool-surface | idea-triaged |
| 8 | sym-B-005 | 9 | cascade-execution | idea-filed (idea-94) |
| 9 | sym-B-009 | 9 | identity-layer | idea-filed (idea-122) |
| 10 | sym-C-001 | 9 | coordination | idea-triaged (idea-144) |
| 11 | sym-C-003 | 9 | deployment | no-idea-filed |
| 12 | sym-C-008 | 9 | debugging-loop | idea-triaged (idea-120) |

**Highest-scored `no-idea-filed` symptoms (Phase 4 candidates):**
1. **sym-B-004** (observability, 15) — workflow-testing gap
2. **sym-C-009** (role-scoping, 10) — architect-triage deferred indefinitely
3. **sym-A-024** (entity-vocabulary, 9) — bug-24 tele retirement primitive
4. **sym-A-025** (delivery, 9) — bug-25 thread truncation
5. **sym-C-003** (deployment, 9) — deploy-gap

These 5 symptoms are the highest-leverage-per-unit-of-scope Phase 4 investment candidates per pure frequency × cost scoring.

---

## 8. Domain ranking

**By symptom count (cluster size):** cascade-execution (12) > tool-surface (8) > identity-layer (7) > coordination (4) = cognitive-layer (4) = delivery (4) > role-scoping (3) = entity-vocabulary (3) > observability (2) = deployment (2) > debugging-loop (1)

**By top-symptom score (max leverage):** observability (B-004, 15) > cognitive-layer (A-011, 12) = delivery (B-012, 12) > role-scoping (C-009, 10) > (7-way tie at 9): cascade-execution, tool-surface, identity-layer, coordination, entity-vocabulary, deployment, debugging-loop

**By remaining-gap density (% no-idea-filed):** role-scoping (100%) > deployment (50%) > observability (50%) > delivery (50%) > entity-vocabulary (33%) > cascade-execution (50% of OPEN, but mostly historical) > tool-surface (25% of non-shipped) > identity-layer (0% open-gap) > coordination (0%) > cognitive-layer (0%) > debugging-loop (0%)

**Composite ranking** (weighting top-score × remaining-gap density, as heuristic for Phase 4 investment priority):
1. **role-scoping** — 3 symptoms, 100% unaddressed, top-score 10 → structural gap; no prior design
2. **observability** — 2 symptoms, one at 15 (highest overall), 50% unaddressed → structural leverage
3. **delivery** — 4 symptoms, top-score 12, 50% unaddressed → concentrated pattern around bug-25
4. **entity-vocabulary** — 3 symptoms, top-score 9, 33% unaddressed → bounded gap (bug-24)
5. **cognitive-layer** — 4 symptoms, top-score 12, 0% unaddressed (idea-132 captures) → decision is *promote idea-132 to mission*
6. **cascade-execution** — 12 symptoms (largest cluster), but mostly historical; 6 open gaps cluster around cascade-correctness
7. **tool-surface** — 8 symptoms, most captured by idea-121; narrow remaining gaps
8. **deployment** — 2 symptoms, one unaddressed; idea-150 structural scope exists
9. **coordination** — 4 symptoms, all captured by idea-144 or shipped
10. **debugging-loop** — 1 symptom, captured
11. **identity-layer** — 7 symptoms, effectively closed (mission-40 + bug-16 + idea-122)

---

## 9. Phase 4 mission-candidate preview

*Scope discipline: Phase 4 authors mission briefs formally. This section previews what candidates Phase 2 surfaces; it does NOT author briefs here. Director may adjust at Phase 4 ratification.*

**Highest-leverage candidates (per §8 composite ranking):**

| # | Candidate | Addresses | Scope | Effort | Blocker/Quick-win/Structural |
|---|---|---|---|---|---|
| 1 | **Workflow Test Harness** | sym-B-004 + 28 "Tested By: NONE" invariants | Structural; tele-2 + tele-9 success criteria | L | **Structural** |
| 2 | **Role-Scoping Discipline** | sym-C-006, C-009, C-010 | Architect-triage SLA + late-ratification + scope-discovery patterns | M | **Structural** (cold-start) |
| 3 | **bug-24 Tele Retirement Primitive** | sym-A-024 | Tele lifecycle API completion | S | **Quick-win** (bounded) |
| 4 | **bug-25 Adapter Size-Guard** | sym-A-025, B-012 | Short-term delivery-truncation mitigation; idea-152 long-term | S | **Quick-win** |
| 5 | **idea-132 Promotion** (Cognitive-layer silence) | sym-A-011 | bug-11 mitigations already captured; promotion to mission | M | **Blocker** for tele-11 success |
| 6 | **Cascade Correctness Hardening** | sym-A-022, A-023, A-027, A-028 | Four cascade-execution drift bugs | M | **Blocker** (cascade reliability) |
| 7 | **idea-144 Promotion** (Workflow advancement) | sym-C-001, A-020 | Hub-side mission-advancement sequencer | M | **Velocity-multiplier** |
| 8 | **idea-150 Environment Deployer** | sym-C-003 | Deploy-gap closure | L | **Velocity-multiplier** |

**Implicit anti-goals** (Phase 4 should codify):
- idea-152 Smart NIC as target-state stays scope-reserved (too large for immediate mission)
- Identity-layer is done (no mission needed)
- Phase 3 concept/defect register harvesting per plan §Phase 3

---

## 10. Convergence-criteria self-check

Per plan §Phase 2 convergence:

| Criterion | Status |
|---|---|
| Every significant bug and every major in-thread friction report maps to a domain | ✓ PASS — 50/50 symptoms assigned; zero `new-domain-needed` flags survived classification |
| Domains are ranked with rationale | ✓ PASS — §8 composite ranking with three independent axes + rationale per domain in §3 |

Both criteria satisfied. Phase 2 convergence conditions met at architect-artifact level. Engineer completeness-critique opens next per cadence.

---

## 11. Methodology-retrospective inputs (Phase 4)

Architect-surfaced during Phase 2 (additive to engineer-flagged + Phase 1 inputs):

1. **Starting-domain list should be Hub-state-derived, not hand-authored** (already flagged; carried forward). Plan's 8 starting domains missed 3 emergent clusters = 38% undercount. Phase 4 retrospective should evaluate deriving the starting list from current Hub-state.
2. **Filing-Point ≠ Fault-Domain** (§5). Classification passes must explicitly do bidirectional domain analysis. Candidate Phase 3 Concept.
3. **Bug-filing discipline drives domain visibility** (§4). Three domains are single-source because operational friction doesn't get bug-filed. Phase 4 retrospective should evaluate a "friction-bug" or "operational-friction entity" class to give operators a filing target for non-system-defect symptoms.
4. **Cross-source coverage is an acceptance test for friction taxonomy** (§4). A domain appearing in one source is suspect; in ≥2 sources, structural. Phase 3 Concept extraction should use this as a filter.
5. **Domain absorbed-and-obscured pattern requires forensic pass** (§5). For any Phase 2 re-run: after engineer's domain_candidate pass, run an architect observability-filter AND a fault-domain filter to surface migrations.
6. **Top-score × remaining-gap density is a better Phase 4 priority than either alone** (§8). Observability's high top-score (B-004, 15) is only actionable because it's unaddressed; coordination's high top-score (C-001, 9) is idea-triaged so Phase 4 decision is different.

---

## Appendix A — Full per-symptom classification table

See companion TSV at `docs/reviews/2026-04-phase-2-data/architect-classification.tsv` (to be generated from this doc if Director requests machine-parseable format).

Summary: 50 symptoms × (engineer_primary, architect_primary, architect_secondary, score, rank, fix_status_architect, phase4_candidate_flag).

---

*End of Phase 2 architect critique, Pass 2.α. Director review + engineer completeness-critique expected next. Phase 3 Concept + Defect extraction opens on Director ratification.*
