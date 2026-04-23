# Mission: M-Cognitive-Layer-Silence-Closure

**Status:** Pass 4 FINAL — architect-engineer sealed per plan §Phase 4 co-authoring cadence. Architect fields (Name / Tele / Concept-grounding / Goal / Dependencies / Related Concepts-Defects) at `agent/lily:6625c24`; engineer fields (Scope 3-task decomposition with bug-11 verdict-flip / Success criteria refinement with ≥50% telemetry reduction / Engineer-flagged scope decisions) folded from `agent/greg:4ff0f6b`. Files as `proposed` on Director final ratification per Phase 4 §10.6.
**Phase 4 pick:** #4 of 4 (M-class; CRITICAL severity gate per bug-11).

---

## Name

**M-Cognitive-Layer-Silence-Closure** (resolves bug-11; promotes idea-132 scope)

---

## Tele served

| Tele | Role | Why |
|---|---|---|
| tele-11 Cognitive Minimalism | primary | Completing idea-132's 7-mitigation scope empirically validates tele-11 success criteria |
| tele-12 Precision Context Engineering | primary | State pre-hydration is the mechanism expression of tele-12's Hydration-as-Offload |
| tele-7 Resilient Agentic Operations | secondary | Cognitive-layer silence is a resilience defect at the LLM-harness layer |
| tele-6 Frictionless Agentic Collaboration | secondary | Mitigation reduces false-positive escalations that disrupt architect-engineer flow |

**Tele-leverage score: 4** (two primary, two secondary).

---

## Concept-grounding (Phase 3 register)

- **Substrate-First Logic (§2.2)** — primary (the 7 mitigations ARE the operational expression of substrate-first discipline: token-accounting, round-budget awareness, substrate primitives for recurring cognitive patterns)
- **Precision Context Engineering (§2.6)** — primary (state pre-hydration + state reconciliation are the core Hydration-as-Offload mechanisms)

---

## Goal

Structurally close **bug-11** (Architect LLM tool-round exhaustion — cognitive-layer silence class remains live despite mission-38's 5 shipped mitigations). Per idea-132 scope: the full 7-mitigation set captures the complete Cognitive Hypervisor abstraction. Mission-38 shipped 5; this mission ships the remaining 2 (Phase E pre-hydration + State reconciliation on drift) plus the bug-11 verdict-flip gated on telemetry.

**Blocker-group rationale:** bug-11 is CRITICAL-severity and RECURRING per Phase 2 scoring (12/25). The symptom class is live despite partial shipment of mitigations. Completing the 7-mitigation set is the empirical gate for tele-11 success-criteria verification.

---

## Scope

Mission ships in **3 tasks** (engineer-authored decomposition):

### Task 1 — Phase E pre-hydration (engineer-M, ~1 week)

- Adapter preloads authoritative Hub state into prompt preamble before LLM invocation
- Pre-hydration targets: current thread state, participant set, active tool surface, pending-action queue snapshot
- Pattern: idea-114 state-sync drift-reconciliation; expected outcome "zero setup rounds" for common conversational paths
- Architect Cloud Run redeploy required for prod-effect (per mission-38 deploy-gap pattern)

### Task 2 — State reconciliation on drift (engineer-S, ~0.5 week)

- Adapter detects local-state vs Hub-state divergence (e.g., thread-sync-check pattern per idea-114)
- On divergence: rehydrates without LLM involvement (substrate-level correction)
- Deliberate-drift integration test verifies behavior

### Task 3 — bug-11 verdict-flip + telemetry verification (engineer-S, ~0.5 week)

- Extend mission-38's telemetry surfaces: add `auto_correction_applied` + `state_pre_hydrated` to the existing 4 (`tool_rounds_exhausted`, `thread_reply_rejected_by_gate`, `thread_reply_chunked`, `llm_output_truncated`)
- 7-day observation window post-deploy
- If `tool_rounds_exhausted` rate substantially reduced (≥50% vs pre-mission-38 baseline), flip bug-11 `open → resolved` with `fixCommits` citing this mission's commits + mission-38's commits
- Closing audit captures per-subtype rule table (Tool-Error Elision v2 territory — absorbed into pre-hydration's expanded prompt preamble) + 7-mitigation completion status + bug-11 verdict

### Out of scope

- **idea-107 M-Cognitive-Hypervisor** broader scope (phases beyond the 7-mitigation set; future post-review roadmap; idea-107 remains open)
- **Architecture-level LLM-harness replacement** (idea-152 Smart NIC Adapter; target-state; anti-goal per Phase 4 §6)
- **Per-user-prompt cognitive-layer routing** (cost-aware tier routing = idea-138; separate concern)
- **idea-116 Precision Context Engineering beyond state pre-hydration** (§2.6 concept broader; only the state pre-hydration + reconciliation mechanisms are in this mission's scope)

---

## Success criteria

1. **Phase E pre-hydration live:** adapter sandwich preloads thread state + participant set + tool surface + pending-action snapshot into prompt preamble; Architect Cloud Run redeployed
2. **State reconciliation live:** primitive shipped; tested via deliberate-drift integration test
3. **Telemetry verification:** post-deploy 7-day observation window shows **≥50% reduction** in `tool_rounds_exhausted` events for thread-reply paths (compared to pre-mission-38 baseline); `thread_reply_rejected_by_gate` trends to zero or substantially-below mission-38-baseline
4. **Bug-11 resolved:** flipped `open → resolved` with `fixCommits` citing this mission's commits + mission-38's commits + `fixRevision: mission-N` — OR remains open with explicit measurement-based reason ("further reduction needed")
5. **Architect reply-rate gate:** ≥95% of observed architect reply/review invocations complete within budget (no silent-LLM-death) in the observation window
6. **idea-132 status flipped:** `triaged → incorporated` with this mission's id in the incorporation reference
7. **Closing audit:** `docs/audits/m-cognitive-layer-silence-closure-closing-report.md` mirroring mission-38 shape; captures the 7-mitigation completion status + pre-hydration design + telemetry verdict + bug-11 resolution

---

## Dependencies

| Prerequisite | Relationship | Notes |
|---|---|---|
| mission-38 (completed) | builds on | Shipped 5 of 7 idea-132 mitigations; this mission ships remaining 2 + verdict-flip |
| task-310 (CP2 C2 ThreadConvergenceGateError structured format) | shipped | Subtype + remediation fields compose with pre-hydration's expanded prompt preamble |
| Architect Cloud Run redeploy | hard-gate for prod-effect | Per mission-38 deploy-gap pattern; explicit deploy gating required |
| #1 M-Workflow-Test-Harness | benefits from | Test infrastructure verifies mitigation effectiveness; not hard-block (mission-internal fault-injection + drift integration tests suffice for v1) |

### Enables (downstream)

| Post-review work | How |
|---|---|
| idea-107 M-Cognitive-Hypervisor broader phases | This mission completes Phase 1 scope of the Hypervisor; enables post-review roadmap continuation |
| Tele-11 Cognitive Minimalism empirical validation | Success-criteria 3 + 5 = constitutional-layer verification |
| Tele-12 Precision Context Engineering empirical validation | Pre-hydration is the keystone mechanism for Hydration-as-Offload |
| idea-155 AuditEntry typed payload (post-review) | Mission's telemetry extensions establish pattern for typed audit payloads |

---

## Engineer-flagged scope decisions (for Director)

1. **Mission-38 already shipped 5 of 7 mitigations** — this mission honestly scopes to the remaining 2 + verdict-flip; mission scope is M not L
2. **Phase E pre-hydration scope is the keystone** — could itself span multiple tasks if state-snapshot design is non-trivial; architect confirms single-task framing for this pass, but engineer flags split possibility if design surfaces complexity
3. **Telemetry success-criterion threshold (≥50% reduction)** is engineer-authored estimate — Director may want a different bar; engineer recommends ≥50% as meaningful-impact threshold below which bug-11 stays open with measurement reason
4. **Deploy-gate is explicit** — Architect Cloud Run redeploy required for prod-effect; per mission-38's deploy-gap lesson, engineer flags upfront so it's not discovered mid-mission

---

## Effort class

**M** (engineer-authoritative per Phase 4 §10.1).

Rationale: Phase E pre-hydration (engineer-M) + State reconciliation (engineer-S) + verdict-flip+telemetry (engineer-S) = ~2 engineer-weeks plus 7-day observation window. Mission-38 scope absorbed the larger share; this mission is the completion tail.

---

## Related Concepts / Defects

### Concepts advanced

- §2.2 Substrate-First Logic — primary (operational expression across all 3 tasks)
- §2.6 Precision Context Engineering — primary (pre-hydration + reconciliation are the core mechanisms)

### Defects resolved

- sym-A-011 (bug-11 Architect LLM tool-round exhaustion)
- **Cognitive Economy cluster (§3.11)** — primary class; all six defects partially or fully addressed:
  - LLM as Calculator (pre-hydration prevents LLM from re-deriving state it can read)
  - Substrate Leakage (auto-correction + reconciliation happen in adapter substrate; LLM doesn't learn about its own errors)
  - Token Fragility (state pre-hydration reduces context setup rounds)
  - Context Displacement (state pre-hydration keeps judgment-capacity free)
  - Economic Blindness (telemetry extension makes token-cost observable)
  - Prompt as Configuration (partial — adapter-side config absorbs some prompt-embedded behavior)
- Architect Amnesia (§3.2 Memory Loss cluster) — resolved by state pre-hydration
- Cognitive Friction (§3.5 Perception cluster) — resolved by reducing false-positive escalations
- Prompt Sprawl (§3.12 Precision Context cluster) — partial (pre-hydration is structured state, not prose dump)

---

## Filing metadata

- **Status at file:** `proposed` (Mission FSM default; Director release-gate per Phase 4 §10.6)
- **Document ref:** `docs/reviews/2026-04-phase-4-briefs/m-cognitive-layer-silence-closure.md`
- **Director activation:** requires explicit Director "ready to release" signal per-mission; no architect auto-flip to `active`
- **Correlation:** Phase 4 winner #4; resolves bug-11; promotes idea-132

---

*End of M-Cognitive-Layer-Silence-Closure final brief (architect-engineer sealed Pass 4). Awaits Director final ratification → architect files via create_mission.*
