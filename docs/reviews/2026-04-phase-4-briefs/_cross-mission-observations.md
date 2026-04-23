# Phase 4 Cross-Mission Observations

**Status:** Final — architect-engineer sealed per plan §Phase 4 co-authoring cadence. Content synthesized from architect Pass 4 scoring (`agent/lily:b32cd5d`) + engineer cost-estimates (`agent/greg:457a6fb`) + engineer brief-level sequencing (`agent/greg:4ff0f6b`). Files alongside the 4 per-mission briefs for Director final ratification.

**Correlation:** Phase 4 winners — #1 M-Workflow-Test-Harness / #2 M-Cascade-Correctness-Hardening / #3 M-Tele-Retirement-Primitive / #4 M-Cognitive-Layer-Silence-Closure.

---

## Mission-set totals

| Mission | Effort class | Est. weeks | Independence | Notes |
|---|---|---|---|---|
| #1 Workflow Test Harness | L | ~4 weeks | Foundational | Pool root; no upstream dependency |
| #2 Cascade Correctness Hardening | M | ~2 weeks | Depends-loosely on #1 | Best composite × cost ratio in pool |
| #3 Tele Retirement Primitive | S | ~2-3 days | Independent | Smallest; quick-win; zero dependency |
| #4 Cognitive-Layer Silence Closure | M | ~2 weeks | Independent | Deploy-gated; 7-day observation window |

**Pool total effort:** ~L+M+S+M = 4–5 weeks engineer-claimable (parallel) / 5–6 weeks (serialized).

---

## Sequencing recommendations

### Single-engineer plan (~5-6 weeks linear)

```
#3 Tele Retirement (2-3 days)
    ↓
#1 Wave 1 test infrastructure (1 week)
    ↓
parallel { #2 Cascade Correctness | #4 Cognitive Silence } (2 weeks each, deploy-gated)
    ↓
#1 Wave 2 + Wave 3 (3 weeks: invariant coverage + report)
```

**Rationale:** #3 ships first as the quick-win tele-hygiene pass. #1 Wave 1 lays test infrastructure that #2 leverages. #2 and #4 can run in parallel in a single engineer's attention because #4 has deploy-gate idle time during the 7-day observation window. #1 Wave 2+3 completes the foundational mission.

### Two-engineer plan (~4-5 weeks parallel)

```
Engineer A: #1 (full L) — 4 weeks continuous
Engineer B: #3 (2-3 days) → #2 (2 weeks) → #4 (2 weeks)
```

**Rationale:** Engineer A focuses on the L-foundational mission without context-switch. Engineer B sequences the three smaller missions, using #1's Wave 1 infrastructure as it lands for #2's cross-test coverage.

### Parallelization constraints

- **#2 depends loosely on #1 Wave 1** — not hard-block; #2 can ship with mission-internal tests if #1 lags, but ideal is #2 uses #1 Wave 1 infrastructure for ≥2 of 4 bug regression tests
- **#4 requires Architect Cloud Run redeploy** — explicit deploy gate flagged by engineer per mission-38 deploy-gap lesson; schedule deploy early in #4 Task 1 (Phase E pre-hydration)
- **#3 has zero blocking dependencies** — can ship at any point; quick-win candidate for earliest mission flip

---

## Phase 4-specific anti-goals (additive to review plan §6's pre-staged 8)

Engineer-side additions ratified in this cross-mission scope:

1. **Mission scope creep** — none of the 4 missions should grow beyond their cost-class during execution; if scope grows, file follow-up ideas + retract scope
2. **Cross-mission coupling** — do NOT refactor across mission boundaries (e.g., #1 should not touch cascade code; #2 should not touch test-infrastructure scaffolding)
3. **Re-litigating Phase 1-3 decisions** — domain assignments, concept naming, defect taxonomy are ratified; mission briefs reference but don't reopen
4. **Architect filing missions outside this set** — Phase 4 selection is the 4 winners; architect-filed missions outside this set (other than via standard idea triage) violate Phase 4 scope discipline

Reinforced from review plan §6:
- No architecture-level rewrites (idea-152 Smart NIC Adapter out)
- No governance rework (Director-in-the-loop cadence stable)
- No vertex-cloudrun architect behavior changes (real LLM — not mock-targetable)

---

## Inter-mission dependencies (directed graph)

```
#3 Tele Retirement ─────────────────┐
                                    │
#1 Workflow Test Harness ──┬────────┤
                           │        │
                           ├──► #2 Cascade Correctness (benefits-from #1 Wave 1)
                           │
                           └──► #4 Cognitive Silence (benefits-from #1; mission-internal tests suffice)
```

- Solid: benefits-from (soft dependency; not hard-block)
- No hard-blocks between missions — all 4 could theoretically ship independently

---

## Success across the set (pool-level verification)

**Phase 4 pool succeeds when:**
1. All 4 missions flip `proposed → completed` (or explicit-abandoned with Director sign-off)
2. bug-11, bug-22, bug-23, bug-24, bug-27, bug-28 all flipped `open → resolved`
3. idea-104 (mock-harness) partially absorbed via #1 Wave 1; idea-132 status flipped `triaged → incorporated` via #4
4. ≥10 of 28 workflow-registry INV-* invariants under automated coverage (#1 success-gate)
5. 7-day post-deploy observation windows across #2 and #4 show trend-to-zero on each target bug class
6. Closing audit artifacts at `docs/audits/` for #1 (coverage report), #2 (payload-passthrough matrix), #3 (zombie cleanup log), #4 (7-mitigation completion status)

---

## Convergence signal

**Architect-engineer convergence:** 88% stable across Phase 1-4 (measured per-phase against independent drafts). This brief-set is the composed product of both sides — Phase 4 §Co-authoring cadence delivered unified briefs without further cross-review rounds.

**Director handoff:** unified brief-set ratifiable in a single pass; architect files 4 missions via `create_mission` upon Director "ready to release" signal per §10.6 protocol.

---

## Filing metadata

- **Document ref:** `docs/reviews/2026-04-phase-4-briefs/_cross-mission-observations.md`
- **Companions:** `m-workflow-test-harness.md` / `m-cascade-correctness-hardening.md` / `m-tele-retirement-primitive.md` / `m-cognitive-layer-silence-closure.md`
- **Director activation:** per-mission; mission filings are gated on explicit Director "ready to release" signal

---

*End of cross-mission observations. Awaits Director final ratification → architect files 4 missions as `proposed` per §10.6 protocol.*
