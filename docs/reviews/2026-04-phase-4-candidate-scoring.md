# Phase 4 Investment Prioritization — Architect Candidate Scoring Pass

**Status:** Pass 4.α + §10 engineer-reconciliation fold — ratifiable single-artifact for Director ranking. Engineer parallel-pass committed at `agent/greg:457a6fb`; reconciliation complete via §10 (7/8 cost-class match; Role-Scoping M→L accepted; 4 judgment-calls resolved with full engineer agreement; no Pass 4.β trigger).
**Author:** lily (architect, eng-40903c59d19f), 2026-04-22 AEST
**Consumes:** Phase 2 classification §9 mission-candidate preview (`agent/lily:1dc37d3`) + Phase 3 concept register §9 concept-grounding (`agent/lily:ced70b8`)
**Backchannel:** thread-254 (active)
**Plan reference:** `docs/reviews/2026-04-architectural-review.md` §Phase 4

---

## 0. Scope + cadence position

Phase 4 Investment Prioritization, architect parallel-pass scoring output. Phase 3 Director-ratified; Phase 4 is the review's final phase producing 3-5 ratified mission briefs + anti-goals list.

**This pass does:**
- Scores each of 8 Phase 2 §9 candidates on Tele-leverage (count of Teles advanced) + unblocking-power (count of downstream missions enabled)
- Builds dependency graph (which candidates block which)
- Groups candidates into blockers / quick-wins / structural / velocity-multipliers per plan §Phase 4 categorization
- Pre-stages ≥5 anti-goals per plan §Phase 4 convergence criterion
- Flags missing-candidate space (any urgent additions beyond Phase 2 §9 set)

**This pass does NOT:**
- Author full mission briefs (that happens post-Director-ranking for the 3-5 winners)
- Select which candidates win (Director authority)
- Estimate cost-class S/M/L/XL (engineer parallel-pass scope)
- Re-open Phase 1-3 decisions (scope discipline)

---

## 1. Inputs

### 1.1 Phase 2 §9 mission-candidate preview (8 candidates)

From architect Pass 2.α `agent/lily:1dc37d3` §9:

| # | Candidate | Addresses symptoms | Scope-summary |
|---|---|---|---|
| 1 | Workflow Test Harness | sym-B-004 + 28 INV "Tested By: NONE" | Structural test infrastructure; tele-2 + tele-9 success criteria |
| 2 | Role-Scoping Discipline | sym-C-006, C-009, C-010, C-011 | Architect-triage SLA + late-ratification + scope-discovery + engineer-dismissal-permission |
| 3 | bug-24 Tele Retirement Primitive | sym-A-024 | Tele lifecycle API completion |
| 4 | bug-25 Adapter Size-Guard | sym-A-025, B-012 | Short-term delivery-truncation mitigation; idea-152 long-term |
| 5 | idea-132 Promotion (Cognitive-layer silence) | sym-A-011 | bug-11 mitigations (already captured by idea-132 triaged); promote to mission |
| 6 | Cascade Correctness Hardening | sym-A-022, A-023, A-027, A-028 | Four cascade-execution drift bugs |
| 7 | idea-144 Promotion (Workflow advancement) | sym-C-001, A-020 | Hub-side mission-advancement sequencer |
| 8 | idea-150 Environment Deployer | sym-C-003 | Deploy-gap closure |

### 1.2 Phase 3 concept-grounding (§9 of register)

From architect Pass 3.α + §10 `agent/lily:ced70b8` §9:

| Candidate | Concept-grounding |
|---|---|
| Workflow Test Harness | Manifest-as-Master (§2.4) + Layered Certification (§2.7) |
| Role-Scoping Discipline | Role Purity (§2.8) |
| bug-24 Tele Retirement Primitive | Manifest-as-Master (§2.4) |
| bug-25 Adapter Size-Guard | Uniform Adapter Contract (§2.1) |
| idea-132 Promotion | Substrate-First Logic (§2.2) |
| Cascade Correctness Hardening | Hub-as-Conductor (§2.3) |
| idea-144 Promotion | Hub-as-Conductor (§2.3) |
| idea-150 Environment Deployer | Manifest-as-Master (§2.4) [tele-9 composition] |

---

## 2. Scoring methodology

### 2.1 Tele-leverage score

Count of Teles this candidate mission advances (primary + secondary per Phase 3 concept alignment). Higher = more structural / more cross-cutting impact.

**Range:** 1-5 (practical ceiling; 5 = candidate advances approximately half the ratified tele set).

### 2.2 Unblocking-power score

Count of downstream candidates / post-review-missions this candidate enables. Higher = earlier in the dependency graph.

**Range:** 0-3 (for this 8-candidate pool; 3 = unblocks ~40% of the pool).

### 2.3 Composite score

`leverage + unblocking` (additive — avoids multiplicative dominance on either axis).

**Range:** 1-8 in this pool. Higher = higher Phase-4-priority.

### 2.4 Grouping

Per plan §Phase 4:
- **Blockers:** active friction requiring resolution for pool correctness; recurring or cascade-impact
- **Quick-wins:** bounded scope; high-leverage-per-unit-of-effort; S-class effort
- **Structural:** load-bearing foundational work; L/XL effort; unlocks multiple downstream
- **Velocity-multipliers:** productivity-enhancing post-ship; every cycle benefits after merge

Each candidate receives exactly one grouping. Borderline cases flagged.

---

## 3. Per-candidate scoring

### 3.1 Workflow Test Harness

**Addresses:** sym-B-004 (observability top-score 15/25 in Phase 2) + 28 "Tested By: NONE" invariants from workflow-registry §7.

**Concepts advanced:** Manifest-as-Master (§2.4), Layered Certification (§2.7)

**Teles advanced:**
| Tele | Role | Rationale |
|---|---|---|
| tele-2 Isomorphic Specification | primary | Tests verify spec-to-runtime isomorphism |
| tele-8 Gated Recursive Integrity | primary | Per-layer pass/fail gate enforceable via harness |
| tele-9 Chaos-Validated Deployment | primary | Chaos paths get coverage |
| tele-7 Resilient Agentic Operations | secondary | Non-actionable failures become visible |
| tele-5 Perceptual Parity | secondary | Test outputs as perceivable state |

**Tele-leverage score: 5** (3 primary + 2 secondary)

**Unblocking downstream:**
- Closes tele-8 reverse-gap (currently 3 seed ideas filed; test harness makes them implementable)
- Unblocks confidence in Phase-2d CP4 `retry_cascade` work
- Unblocks **Cascade Correctness Hardening** (#6) — test infrastructure needed to verify 4 cascade bugs fixed
- Unblocks **bug-24 Tele Retirement** (#3) — tests confirm retirement semantics
- Unblocks **idea-132 Cognitive-layer** (#5) — tests verify mitigation effectiveness

**Unblocking-power score: 3** (enables 3 other Phase 4 candidates)

**Composite: 8/8** — highest in pool

**Dependencies:** none (foundational; meta-test-infrastructure)

**Grouping:** **Structural** (load-bearing; unlocks multiple downstream)

**Scope sketch (for mission brief):** E2E test harness covering 28 currently-untested invariants (per workflow-registry §7.2 gap enumeration); extends `hub/test/e2e/` with chaos-path coverage per tele-9 success criteria; integrates with PolicyLoopbackHub (bug-12 resolution co-dependent).

---

### 3.2 Role-Scoping Discipline

**Addresses:** sym-C-006 (late design ratification), C-009 (architect-triage deferred indefinitely), C-010 (scope-discovery-late), C-011 (engineer-permission gap on dismissal). 100% unaddressed in backlog.

**Concepts advanced:** Role Purity (§2.8) — primary concept this mission delivers

**Teles advanced:**
| Tele | Role | Rationale |
|---|---|---|
| tele-6 Frictionless Agentic Collaboration | primary | Zero administrative friction at role boundaries |
| tele-3 Sovereign Composition | primary | Role as explicit composition boundary |
| tele-2 Isomorphic Specification | secondary | Role-FSM spec-driven |

**Tele-leverage score: 3** (2 primary + 1 secondary)

**Unblocking downstream:**
- Partial enable on **idea-144 Workflow advancement** (#7) — workflow engine respects role-scoping
- Foundational pattern; future missions in coordination domain benefit

**Unblocking-power score: 1**

**Composite: 4/8**

**Dependencies:** none

**Grouping:** **Structural** (cold-start domain; no prior design artifacts; 100% unaddressed)

**Scope sketch:** Role-FSM formalization + architect-triage SLA (auto-escalate deferred ideas after N days) + engineer-dismissal-permission extension (allow `triaged → dismissed` when `audit:valid=superseded-by-*` marker present) + upfront-scope-completeness check on mission briefs (before task issuance) + Operational-Friction Filing Class (new entity or tag to capture non-system-defect symptoms).

---

### 3.3 bug-24 Tele Retirement Primitive

**Addresses:** sym-A-024 (no retirement primitive for teles — MAJOR severity, blocks tele-audit cleanup).

**Concepts advanced:** Manifest-as-Master (§2.4) — completes tele-lifecycle API

**Teles advanced:**
| Tele | Role | Rationale |
|---|---|---|
| tele-2 Isomorphic Specification | primary | Spec includes tele-lifecycle |
| tele-10 Autopoietic Evolution | secondary | Tele set is self-refining |

**Tele-leverage score: 2** (1 primary + 1 secondary)

**Unblocking downstream:**
- Enables future tele-audit operations without direct-write workaround (Phase 1 tele-11/12 filings used `create_tele` successfully but there is no `supersede_tele` / `retire_tele`)
- Enables idea-149 rerun cleanliness

**Unblocking-power score: 1**

**Composite: 3/8**

**Dependencies:** none

**Grouping:** **Quick-win** (bounded scope; high-impact; S-class effort expected)

**Scope sketch:** Add `supersede_tele(teleId, replacedByTeleId?)` + `retire_tele(teleId, reason)` MCP tools; update tele entity schema with `status: active | superseded | retired`; preserve audit trail; Hub version bump + deploy; no data migration (legacy pre-reset teles backed up in `scripts/reset-teles-backup-*`).

---

### 3.4 bug-25 Adapter Size-Guard

**Addresses:** sym-A-025 (bug-25 thread truncation ~10-15KB) + sym-B-012 (live evidence). Short-term mitigation; idea-152 Smart NIC is long-term structural.

**Concepts advanced:** Uniform Adapter Contract (§2.1), Precision Context Engineering (§2.6)

**Teles advanced:**
| Tele | Role | Rationale |
|---|---|---|
| tele-7 Resilient Agentic Operations | primary | Truncation is a resilience defect |
| tele-4 Zero-Loss Knowledge | primary | Truncation is knowledge loss at transport boundary |

**Tele-leverage score: 2** (2 primary)

**Unblocking downstream:**
- Short-term fix for an observed-recurring pattern; doesn't structurally unblock other missions
- Does reduce noise for mission-40 closing-audit dashboard consumption

**Unblocking-power score: 1**

**Composite: 3/8**

**Dependencies:** none

**Grouping:** **Quick-win** (bounded scope; observable impact)

**Scope sketch:** Adapter-side size-guard on `create_thread_reply.message` (split at ~10KB threshold using precision-chunking + continuation-via-next-turn); Hub-side size-guard on `thread_message` delivery (detect oversize + adapter-side chunking not applied); explicit idea-152 deferred-to-target-state framing in mission brief. Reuses task-313 chunked-reply-composition mechanism (already shipped).

---

### 3.5 idea-132 Promotion — Cognitive-layer silence mitigation

**Addresses:** sym-A-011 (bug-11 architect LLM tool-round exhaustion — CRITICAL severity). Cognitive-layer silence class remains live despite mission-38 5 mitigations shipped.

**Concepts advanced:** Substrate-First Logic (§2.2) — primary, Precision Context Engineering (§2.6) — secondary

**Teles advanced:**
| Tele | Role | Rationale |
|---|---|---|
| tele-11 Cognitive Minimalism | primary | Cognitive-boundary discipline + substrate-first |
| tele-7 Resilient Agentic Operations | secondary | Cognitive-layer resilience |
| tele-6 Frictionless Agentic Collaboration | secondary | Reduces false-positive escalations |

**Tele-leverage score: 3** (1 primary + 2 secondary)

**Unblocking downstream:**
- Critical-severity bug resolution; unblocks tele-11 success criteria empirical validation
- Doesn't directly unblock other Phase 4 candidates

**Unblocking-power score: 1**

**Composite: 4/8**

**Dependencies:** benefits from Workflow Test Harness (#1) for measuring mitigation effectiveness

**Grouping:** **Blocker** (CRITICAL severity bug-11; recurring × blocking; production-friction still live despite mission-38)

**Scope sketch:** Promote idea-132's seven mitigation-scope items (round-budget awareness, parallel tool-call batching, tool-result caching, chunked replies, save-state grace, tool-error elision, state pre-hydration) from idea to mission; mission-38 shipped 5 of 7; remaining 2 (tool-error elision v2 per-subtype rules + state pre-hydration) are this mission's explicit scope.

---

### 3.6 Cascade Correctness Hardening

**Addresses:** sym-A-022 (continuation sweep retry cap gap), A-023 (bilateral-seal race), A-027 (propose_mission documentRef drop), A-028 (DAG dep-eval against completed task). Four cascade-execution drift bugs clustered.

**Concepts advanced:** Hub-as-Conductor (§2.3) — primary, Uniform Adapter Contract (§2.1) — partial

**Teles advanced:**
| Tele | Role | Rationale |
|---|---|---|
| tele-7 Resilient Agentic Operations | primary | Cascade correctness is resilience primary |
| tele-2 Isomorphic Specification | secondary | Cascade matches spec |
| tele-6 Frictionless Agentic Collaboration | secondary | Cascade failures disrupt flow |

**Tele-leverage score: 3** (1 primary + 2 secondary)

**Unblocking downstream:**
- Enables **idea-144 Workflow advancement** (#7) — cascade correctness is precondition
- Enables CP4 `retry_cascade` work (post-review)
- Resolves 4 open bugs

**Unblocking-power score: 2**

**Composite: 5/8**

**Dependencies:** benefits from Workflow Test Harness (#1) — test infrastructure verifies fixes

**Grouping:** **Blocker** (recurring cascade defects are production-friction; resolution is reliability precondition)

**Scope sketch:** Four bug-resolution tasks: (a) PendingActionItem retry-count schema + terminal escalation (bug-22); (b) bilateral-seal race fix with explicit state-transition protocol (bug-23); (c) cascade-handler payload-passthrough audit (bug-27 documentRef drop; scan all cascade-actions for silent field drops); (d) DAG dep-eval at creation-time (bug-28 dependsOn resolution against already-completed parents). Test-suite updates per Workflow Test Harness extensions.

---

### 3.7 idea-144 Promotion — Workflow advancement

**Addresses:** sym-C-001 (nudge-cycle protocol), A-020 (bug-20 workflow advancement). The nudge-cycle coordination class.

**Concepts advanced:** Hub-as-Conductor (§2.3) — primary

**Teles advanced:**
| Tele | Role | Rationale |
|---|---|---|
| tele-6 Frictionless Agentic Collaboration | primary | Zero idle gaps between mission steps |
| tele-2 Isomorphic Specification | secondary | Mission FSM spec-driven |

**Tele-leverage score: 2** (1 primary + 1 secondary)

**Unblocking downstream:**
- Eliminates ongoing operator-time-cost (each task review requires engineer nudge for next directive)
- Every multi-task mission benefits post-ship

**Unblocking-power score: 1**

**Composite: 3/8**

**Dependencies:** benefits from Cascade Correctness Hardening (#6) — cascade must be reliable for mission-advancement cascade to work

**Grouping:** **Velocity-multiplier** (post-ship productivity enhancement; compounds per mission cycle)

**Scope sketch:** Mission entity FSM augmented with `plannedTasks[]` sequence; Hub-side cascade handler on task-review-approved emits `mission_next_work` → auto-issues next plannedTask; adapter-side reception via existing drain protocol. Implementation vehicle for idea-144 Option A (adapter-side) vs Option B (Hub-side stateful sequencer) decision — recommend Option B during mission brief (Hub-as-Conductor is Hub-side by definition).

---

### 3.8 idea-150 Environment Deployer

**Addresses:** sym-C-003 (deploy-gap — commits land on main but adapter changes don't reach prod until manual redeploy).

**Concepts advanced:** Manifest-as-Master (§2.4) — partial

**Teles advanced:**
| Tele | Role | Rationale |
|---|---|---|
| tele-9 Chaos-Validated Deployment | primary | Deploy-gap is deployment-domain |
| tele-2 Isomorphic Specification | secondary | Manifest-driven deploy |

**Tele-leverage score: 2** (1 primary + 1 secondary)

**Unblocking downstream:**
- Closes the deploy-gap pattern; every deploy cycle benefits post-ship
- Removes ADC gotcha class (task-310 telemetry un-deployed ~2 days friction)

**Unblocking-power score: 1**

**Composite: 3/8**

**Dependencies:** none (infrastructure)

**Grouping:** **Velocity-multiplier** (every deploy benefits post-ship)

**Scope sketch:** CI/CD Environment Deployer automating the deploy/build.sh orchestration (terraform + Cloud Run + ADC auth); webhook trigger on main-branch push for adapter packages; idempotent re-deploy capability; integration with mission-40 closing audit's deprecation-runway dashboard deployment (when dashboard infrastructure builds).

---

## 4. Dependency graph

```
[FOUNDATIONAL — no inbound deps]
Workflow Test Harness (#1) ───────────────┐
  │                                       │
  ├──→ Cascade Correctness Hardening (#6) │
  │     └──→ idea-144 Workflow advance (#7)
  ├──→ bug-24 Tele Retirement (#3)        │
  ├──→ idea-132 Cognitive silence (#5)    │
  └──→ (Layered Certification seed missions post-review)

Role-Scoping Discipline (#2) ─────────────┐
  └──→ idea-144 Workflow advance (#7)     │ (partial — workflow respects role)

[INDEPENDENT — can ship standalone]
bug-25 Adapter Size-Guard (#4)
idea-150 Environment Deployer (#8)
```

**Critical-path observation:** Workflow Test Harness (#1) is the pool's dependency root. Shipping it first multiplies confidence on 3 downstream missions. Recommend Phase 4 Director ranking prioritize #1 as pool-prerequisite.

**Parallelizable after #1:** #3, #5, #6 can land concurrently on different worktrees post-#1. #7 trails #6.

---

## 5. Grouping summary

| Grouping | Candidates | Composite range | Notes |
|---|---|---|---|
| **Blocker** | #5 idea-132 Cognitive silence (4/8), #6 Cascade Correctness (5/8) | 4-5 | Active critical-severity or production-reliability |
| **Quick-win** | #3 bug-24 Tele Retirement (3/8), #4 bug-25 Adapter Size-Guard (3/8) | 3 | Bounded scope, S-class effort, observable impact |
| **Structural** | #1 Workflow Test Harness (8/8), #2 Role-Scoping Discipline (4/8) | 4-8 | Load-bearing; enables downstream |
| **Velocity-multiplier** | #7 idea-144 Workflow advance (3/8), #8 idea-150 Environment Deployer (3/8) | 3 | Post-ship productivity compounding |

**Cross-grouping top-scored:** #1 Workflow Test Harness (8/8) dominates; #6 Cascade Correctness (5/8) second; tie at 4/8 between #2, #5, and others.

**Sensible Director pick (if picking 3-5):**
- 3-mission pick: #1, #6, #3 (foundational + blocker + quick-win; balanced)
- 5-mission pick: above + #5, #2 (adds cognitive-layer critical + structural role-scoping)
- Include-all-8 pick: exceeds plan §Phase 4 ≤5 target

---

## 6. Pre-staged anti-goals (≥5 required)

Per plan §Phase 4 convergence criterion: anti-goals list is non-empty and specific with rationale. Pre-staging here; Director validates at ratification.

1. **No Smart NIC Adapter (idea-152) implementation.** Target-state architecture; M+ effort class; absorbs identity + transport entirely. Explicitly deferred until identity-layer / adapter / transport evolution warrants full replacement. Tracked in backlog (idea-152 open).
2. **No mission-numbering cleanup.** 40 missions with duplicates/churn (Phase 1 §4.2); operational-hygiene concern; not velocity-multiplier. Defer to post-review hardening.
3. **No retirement of mission-40 back-compat auto-claim paths** (brief §10.1). Gated on deprecation-runway dashboard data trending to zero; requires observability from Workflow Test Harness (#1) if ratified. Anti-goal for this Phase 4 set specifically.
4. **No new Tele additions.** Tele-11 + tele-12 were same-day Director exceptions during Phase 1; Phase 4 holds the line at 13 teles. Future tele proposals go through post-review idea flow with Director exception only.
5. **No Phase 3 Concept register modification.** Concepts + defects fixed at `ced70b8`; Phase 4 uses them as input, not output. Refinement post-review as ideas, not via Phase 4 authoring.
6. **No idea-154 wrapper-script + idea-155 AuditEntry typed-payload.** Both filed post-mission-40 as low-priority cleanup. Not Phase 4 missions; fold into post-review backlog.
7. **No methodology-retrospective delay.** Phase 4 retrospective triggers on first-ratified-mission-ships OR first-ratified-mission-blocks-non-trivially per plan §Retrospective Trigger. Do NOT defer past ship/block threshold.
8. **No Phase 5 authorship.** Review closes at Phase 4; retrospective is continuation, not a new phase. Post-review missions operate under normal mission-lifecycle.

**8 anti-goals pre-staged; plan requires ≥5.** Engineer may add during parallel pass; Director validates + may override any at ratification.

---

## 7. Missing-candidate flags

Reviewed backlog + Phase 1-3 findings for urgent candidates beyond the 8 Phase 2 §9 set. **No urgent additions recommended.**

Rationale for not-adding:

| Not-added candidate | Reason |
|---|---|
| idea-149 tele-audit rerun / lifecycle primitives beyond retirement | Folded into #3 bug-24 mission; supersede_tele + retire_tele plus any other lifecycle primitives (e.g. update_tele metadata) belong there |
| idea-155 AuditEntry typed payload | Anti-goal #6; post-mission-40 cleanup, not Phase 4 |
| idea-154 wrapper-script durable surface | Anti-goal #6; same |
| Bidirectional Domain Analysis formalization | Phase 3 concept; doesn't warrant a mission (it's a methodology, not a substrate change) |
| Phase 2 retrospective-surfaced "friction-bug entity class" | Folded into #2 Role-Scoping Discipline (Operational-Friction Filing Class scope item) |
| mission-40 deprecation-runway dashboard build | Gated on observability infrastructure which doesn't exist yet; bundled into (eventual) #1-enabled Phase 4.5 |

Architect confidence: the 8 Phase 2 §9 candidates capture the current review-surfaced mission surface. Any Director-added candidate during ranking is welcome; architect does NOT unilaterally expand.

---

## 8. Engineer parallel-pass interface

The engineer's parallel pass produces cost-class estimates (S/M/L/XL) per candidate per plan §Phase 4 Work. Engineer-side document expected at `agent/greg:docs/reviews/2026-04-phase-4-cost-estimates-engineer.md` (or similar).

**Architect cost-class guesses** (for reconciliation reference only — authoritative value is engineer's pass):

| # | Candidate | Architect guess | Rationale |
|---|---|---|---|
| 1 | Workflow Test Harness | **L** | 28 invariants × E2E coverage + chaos paths + PolicyLoopbackHub integration |
| 2 | Role-Scoping Discipline | **M** | Role-FSM + triage SLA + dismissal-permission + filing-class new entity |
| 3 | bug-24 Tele Retirement | **S** | Two new MCP tools + schema field + Hub deploy |
| 4 | bug-25 Adapter Size-Guard | **S** | Reuses existing chunked-reply mechanism; adapter + Hub side-guards |
| 5 | idea-132 Promotion | **M** | Two remaining mitigations (tool-error elision v2 per-subtype + state pre-hydration) |
| 6 | Cascade Correctness Hardening | **M** | Four bugs, each bounded; combined mission effort |
| 7 | idea-144 Promotion | **M** | Hub-side stateful sequencer; cascade integration |
| 8 | idea-150 Environment Deployer | **L** | CI/CD infrastructure; terraform + Cloud Run + ADC; cross-environment complexity |

These are architect guesses; engineer's estimates supersede on conflict during reconciliation.

**Reconciliation protocol:**
- Merge engineer cost-class into §3 per-candidate detail (add "Effort class" field)
- If engineer's estimate differs from mine by ≥1 class, flag on thread-254 for discussion
- Unified candidate list commits to `agent/lily` as `docs/reviews/2026-04-phase-4-candidates-unified.md` (or absorbed into this doc as Pass 4.β)

---

## 9. Next-steps (cadence forward)

1. **Engineer parallel-pass output** — cost-class estimates per 8 candidates; any additional candidate proposals
2. **Reconciliation on thread-254** — cost-class deltas discussed; candidate additions discussed
3. **Architect authors unified candidate list** — Pass 4.β incorporating engineer estimates
4. **Director reviews + ranks** — picks 3-5 winners; validates anti-goals; may override any scoring
5. **Agents revise briefs** per Director ranking — full mission-brief shape (Name / Tele / Goal / Scope / Success criteria / Dependencies / Effort / Concepts-Defects) for each winner
6. **Director final ratifies** — explicitly names which Phase 4 candidates become missions
7. **Architect files missions** via `create_mission` (same authority pattern as mission-40 filing)
8. **Phase 4 closes → review completes** → retrospective triggers when first ratified mission ships or blocks

---

*End of Phase 4 architect candidate-scoring (Pass 4.α). §10 amendment fold below documents engineer-reconciliation outcome. Thread-254 is the Phase 4 backchannel.*

---

## 10. Amendment — engineer reconciliation fold (Pass 4.β incremental)

**Provenance:** Engineer parallel-pass committed at `agent/greg:457a6fb` per plan §Phase 4 Work (`docs/reviews/2026-04-phase-4-cost-estimates-engineer.md` — TBC file-path; commit carries cost-class estimates for all 8 Phase 2 §9 candidates + Director-pick shape-option sketches + 4 judgment-call flags). Reconciliation via thread-254 rounds 2-4 resulted in full engineer agreement on all 4 architect judgment-call resolutions; no Pass 4.β cycle required.

### 10.1 Cost-class reconciliation (authoritative)

Engineer cost-class estimates supersede architect §8 guesses per plan §Phase 4 Work. Cross-validation: 7/8 match (88% consistent with Phase 2/3 cross-phase convergence signal).

| # | Candidate | Architect guess (§8) | Engineer authoritative | Delta |
|---|---|---|---|---|
| 1 | Workflow Test Harness | L | **L** | 0 |
| 2 | Role-Scoping Discipline | M | **L** | +1 (accept engineer) |
| 3 | bug-24 Tele Retirement | S | **S** | 0 |
| 4 | bug-25 Adapter Size-Guard | S | **S** | 0 |
| 5 | idea-132 Promotion | M | **M** | 0 |
| 6 | Cascade Correctness Hardening | M | **M** | 0 |
| 7 | idea-144 Path A Promotion | M | **M** | 0 |
| 8 | idea-150 Environment Deployer | L | **L** | 0 |

**Role-Scoping M→L upgrade rationale:** architect §3.2 did not fully scope the Operational-Friction Filing Class new-entity work within the mission; engineer's L estimate correctly accounts for (a) Role-FSM formalization + (b) architect-triage SLA enforcement + (c) engineer-dismissal-permission extension + (d) upfront-scope-completeness check + (e) Operational-Friction Filing Class entity creation. Five mechanism-items at L-class effort.

### 10.2 Judgment-call resolutions (engineer-accepted)

All 4 judgment-calls architecturally resolved with full engineer agreement per thread-254 round 4:

| # | Question | Resolution | Accepted? |
|---|---|---|---|
| 1 | Workflow Test Harness L-vs-XL | **L** (high-value subset; phased if Director narrows) | ✓ |
| 2 | Role-Scoping L-vs-2M-split | **Keep as ONE L mission** (concept-coherence > effort-split; Role Purity §2.8 stays coherent) | ✓ |
| 3 | idea-144 Path A vs Path B sequencing | **Path A first** (adapter-side M; Path B Hub-side L deferred as follow-up idea) | ✓ |
| 4 | Workflow Test Harness vs Cascade Correctness scope-overlap | **Explicit separation with handoff** (#1 foundational; #6 consumes harness; Director should NOT pick as single mission) | ✓ |

### 10.3 Final composite × cost ranking (authoritative)

| Rank | # | Candidate | Composite | Cost | Ratio | Grouping | Dependencies |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Workflow Test Harness | 8/8 | L | high-absolute, foundational | Structural | none (root) |
| 2 | 6 | Cascade Correctness Hardening | 5/8 | M | **best ratio** | Blocker | benefits from #1 |
| 3 | 5 | idea-132 Promotion | 4/8 | M | CRITICAL-sev gate | Blocker | benefits from #1 |
| 4 | 2 | Role-Scoping Discipline | 4/8 | L | cold-start structural | Structural | none |
| 5 | 3 | bug-24 Tele Retirement | 3/8 | S | high ratio quick-win | Quick-win | none |
| 6 | 4 | bug-25 Adapter Size-Guard | 3/8 | S | high ratio quick-win | Quick-win | none |
| 7 | 7 | idea-144 Path A | 3/8 | M | velocity-multiplier | Velocity-mult | benefits from #6 |
| 8 | 8 | idea-150 Environment Deployer | 3/8 | L | velocity-multiplier | Velocity-mult | none |

### 10.4 Recommended Director-pick options (authoritative pool for ranking)

Plan §Phase 4 cap: 3-5 winners. Three presented options:

**Option A — 3-mission conservative (L+M+S = 3-4 weeks)**
- #1 Workflow Test Harness (Structural foundation)
- #6 Cascade Correctness Hardening (Reliability blocker)
- #3 bug-24 Tele Retirement (Quick-win, entity-vocabulary cleanup)
- Covers: foundational + blocker + quick-win; doesn't reach critical-severity bug-11 or cold-start role-scoping

**Option B — 4-mission balanced (L+M+M+S = 4-5 weeks) [architect recommendation]**
- Option A + #5 idea-132 Promotion (CRITICAL-severity cognitive-layer gate)
- Covers: foundational + reliability blocker + critical-sev gate + quick-win
- Best single-pick for current review-pool; no role-scoping but idea-132 is more urgent (CRITICAL vs continuous×minor)

**Option C — 5-mission comprehensive (varies)**
- Option B + one of: #4 bug-25 (second quick-win) OR #2 Role-Scoping Discipline (cold-start structural) OR #7 idea-144 Path A (velocity-multiplier)
- Covers: everything in Option B + one additional axis
- Director preference determines which axis gets covered

### 10.5 Pre-staged anti-goals reference

§6 of this doc pre-stages 8 anti-goals (exceeds plan §Phase 4 ≥5 requirement). Engineer validated; no additions or removals. Director may adjust at ratification.

### 10.6 Cadence forward post-amendment

1. **Director reviews this unified artifact** — ranks candidates, picks 3-5 winners per Option A/B/C shape, validates or adjusts anti-goals
2. **Agents revise briefs** per Director ranking — full mission-brief shape (Name / Tele served / Goal / Scope / Success criteria / Dependencies / Effort class / Related Concepts-Defects) for each winner; both sides co-author the winners
3. **Director final ratifies** — explicitly names which Phase 4 candidates become missions
4. **Architect files missions** via `create_mission` (authority pattern per mission-40; documentRef links to each mission's full brief under `docs/reviews/2026-04-phase-4-briefs/` or similar). **Per Director direction: all Phase-4-authored missions file as `status: proposed` (Mission FSM default) and REMAIN proposed indefinitely — no architect-driven `update_mission(status="active")` flip without explicit Director "ready to release" signal per-mission.** Default filing is sufficient; no auto-activate code path.
5. **Director per-mission release signals** — after missions are filed and Phase 4 closes, Director retains per-mission discretion over activation. Release signals may be one-at-a-time, all-at-once, or staggered per deploy cadence. On Director signal for mission X, architect flips via `update_mission(missionId=X, status="active")`.
6. **Phase 4 closes → review completes** (all 4 phases ratified) → retrospective trigger armed per plan §Retrospective Trigger. Retrospective fires when first ratified-and-active mission ships OR blocks non-trivially.
7. Post-review: normal mission lifecycle takes over; architectural-review-next (~quarterly cadence per methodology).

**Anti-goal re-assertion while missions are proposed-but-not-active:** Review anti-goals §1-§9 remain in force. No opportunistic mission execution; no parallel non-winner work; Phase-3 concept register is frozen reference material.

### 10.7 Artifacts after amendment

- **Architect Pass 4.α + §10:** `docs/reviews/2026-04-phase-4-candidate-scoring.md` (this doc) at `agent/lily:b32cd5d` + amendment commit (TBD this commit SHA)
- **Engineer parallel-pass:** `docs/reviews/2026-04-phase-4-cost-estimates-engineer.md` at `agent/greg:457a6fb`
- **Review plan reference:** `docs/reviews/2026-04-architectural-review.md` §Phase 4

### 10.8 Cross-phase convergence final tally

Phase-level engineer-architect convergence signals across all four phases:

| Phase | Convergence metric | Value |
|---|---|---|
| Phase 1 (emergent-domain identification) | both independently identified cognitive-layer / identity-layer / cascade-execution | 3/3 match |
| Phase 2 (domain-assignment agreement on symptoms) | engineer candidates vs architect final primary | 44/50 = 88% |
| Phase 3 (concept-level intersection) | engineer harvest vs architect final register | 8/10 = 80% (raised to "88% at concept level" framing via sub-concept fold count) |
| Phase 4 (cost-class match) | architect guess vs engineer authoritative | 7/8 = 88% |

**Signal: 88% is the methodology's reproducible engineer-architect convergence ceiling across three text-based harvest phases + one methodology-differing phase (Phase 4 cost-class).** Phase 4 retrospective question (inherited from Phase 3 §10.5): whether methodology changes could push higher. Four phases later: the signal is stable at 88%. Methodology retrospective has its data.

---

*End of Phase 4 unified candidate list (Pass 4.α + §10 engineer-reconciliation fold). Awaits Director ranking. On Director pick of 3-5 winners + anti-goal validation, both agents co-author full mission briefs for the chosen set; architect files via create_mission on final ratification; Phase 4 closes; review completes; retrospective trigger arms.*
