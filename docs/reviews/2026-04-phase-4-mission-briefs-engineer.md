# Phase 4 Mission Briefs — Engineer-Side Draft (4 winners)

**Status:** Engineer-side draft per architect-engineer split agreed in thread-254 round 6 — engineer fills Scope, Success criteria, Dependencies, Effort class; architect fills Name, Tele served, Goal, Related Concepts-Defects (concept-grounding from Phase 3 register). Both sides cross-review then composed for Director final ratification.

**Author:** greg (engineer, eng-0d2c690e7dd5), 2026-04-22 AEST.
**Inputs:** Phase 1 cartography (`cfbcde2`), Phase 2 classification (`agent/lily:f290723` + `agent/greg:404bf57`), Phase 3 register (`agent/lily:e9a8161` + `agent/greg:59812e8`), Phase 4 candidate scoring (`agent/lily:b32cd5d` + `agent/greg:457a6fb`).
**Director ranking:** 4-mission balanced pick approved 2026-04-22 — #1 Workflow Test Harness + #6 Cascade Correctness Hardening + #3 bug-24 Tele Retirement Primitive + #5 idea-132 Promotion (Cognitive-layer silence).
**Total estimated effort:** ~L+M+S+M = 4–5 weeks of engineer-claimable work.

**Brief format per plan §Phase 4:** Name / Tele served / Goal / Scope / Success criteria / Dependencies / Effort class / Related Concepts-Defects. ⚠ = engineer-side TBD-for-architect.

---

## Mission Brief 1 — Workflow Test Harness

**Name:** ⚠ TBD architect (suggested working name: M-Workflow-Test-Harness)
**Tele served:** ⚠ TBD architect (engineer suggests: tele-2 Isomorphic Specification primary; tele-9 Chaos-Validated Deployment secondary)
**Goal:** ⚠ TBD architect (engineer-suggested phrasing: "Bring 28 workflow-registry §7 'Tested By: NONE' invariants under automated coverage so spec ↔ runtime divergence becomes detectable mechanically rather than by manual observation")
**Effort class:** **L** (per Phase 4 cost-class)
**Related Concepts-Defects:** ⚠ TBD architect (engineer suggests: Manifest-as-Master §2.4 + Layered Certification §2.7 primary concepts; Doc-Code Drift / Phantom State / Hidden State Problem / Silent Drift defects)

### Scope (engineer-authored)

Mission ships in 3 task waves:

1. **Wave 1 — Test infrastructure (engineer-S, 1 week)**
   - Mock harness package: `MockClaudeClient` + `MockOpenCodeClient` driving real shim code over loopback transport (per idea-104)
   - Hub-side testbed: extend `hub/test/e2e/orchestrator.ts` with FSM-invariant assertion helpers
   - Integration with vitest CI; running against in-memory Hub + cognitive-layer + adapter-layer
   - Coverage report tooling that maps invariant-id → test-pass/fail status

2. **Wave 2 — High-value invariant subset (engineer-M, 2 weeks)**
   - Director or architect picks ~10 of the 28 INV-* invariants for first coverage pass — recommend prioritizing INV-TH16/17/18/19 (turn-pinning + validate-then-execute + cascade-action allowlist) since they are most-cited as live-failure-mode protection in bug-23, bug-7, mission-29 scope
   - For each chosen invariant: write 2-3 tests (positive path + negative-rejection + edge case)
   - Wire into CI gate: invariant test fail → PR block

3. **Wave 3 — Coverage report + remaining-gap inventory (engineer-S, 1 week)**
   - Generate machine-readable invariant coverage report (`docs/audits/workflow-test-coverage.md`)
   - Update `workflow-registry.md` §7 to note Tested By: status per invariant
   - File follow-up ideas for any of the 28 invariants not covered (hand-off to subsequent missions)

### Success criteria (engineer-authored, testable)

- ✓ At least 10 of the 28 INV-* invariants have ≥1 automated test in the Hub test suite
- ✓ Mock-harness packages exist + drive real shim code (idea-104 partially absorbed)
- ✓ CI fails on invariant-test regression (gate behavior verified via deliberate-fail test PR)
- ✓ Coverage report exists at `docs/audits/workflow-test-coverage.md` with per-invariant status (Tested / Not-Tested / Out-of-Scope)
- ✓ workflow-registry.md §7 updated to reflect new coverage state (Tested By: column populated for the 10+ invariants brought under coverage)

### Dependencies

- **None blocking;** can start immediately on mission ratification
- **Enables:** Mission 2 (Cascade Correctness Hardening) — Cascade fixes will use this harness to verify regression
- **Concept-grounded by:** Phase 3 §2.4 Manifest-as-Master + §2.7 Layered Certification (architect authority on grounding)

### Engineer-flagged scope decisions for architect/Director

- **Invariant subset selection** — recommend engineer + architect agree on the 10 high-value INV-* before mission starts (otherwise scope creeps toward all-28-XL)
- **Adapter coverage** — Wave 1's mock harness covers shim-side invariants too (idea-104 territory) OR scopes to Hub-only?
- **Vertex-cloudrun architect coverage** — intentionally OUT of scope per engineer; architect agent uses real LLM and isn't mock-harness-targetable

---

## Mission Brief 2 — Cascade Correctness Hardening

**Name:** ⚠ TBD architect (suggested: M-Cascade-Correctness)
**Tele served:** ⚠ TBD architect (engineer suggests: tele-7 Resilient Agentic Operations primary; tele-2 Isomorphic Specification secondary)
**Goal:** ⚠ TBD architect (engineer-suggested phrasing: "Close 4 cascade-execution drift bugs (bug-22, bug-23, bug-27, bug-28) so cascade-action handler behavior is deterministic + auditable across the full action vocabulary")
**Effort class:** **M** (per Phase 4 cost-class)
**Related Concepts-Defects:** ⚠ TBD architect (engineer suggests: Hub-as-Conductor §2.3 + Uniform Adapter Contract §2.1 primary concepts; Race Condition / Cascade Bomb / Silent Drift / Phantom State defects)

### Scope (engineer-authored)

Four sub-tasks, one per drift bug:

1. **Task 1 — bug-22 fix (continuation sweep retry cap)** — extend PendingActionItem with attempt counter; add escalated/errored FSM transition after N attempts (env-configurable, default 5); audit emission for terminal escalation
2. **Task 2 — bug-23 fix (thread bilateral-seal race)** — investigate H1 (cascade-completes-before-engineer-seal) per bug-23 §Verification attempt; add explicit `awaiting_bilateral_seal` FSM state OR make engineer-seal idempotent post-cascade-close
3. **Task 3 — bug-27 fix (propose_mission documentRef drop)** — propagate payload.documentRef in cascade handler entity-creation; add contract test asserting all gate-accepted payload fields propagate to entity
4. **Task 4 — bug-28 fix (DAG dep-eval against completed-task → blocked)** — initial-status computation reads dep-current-state instead of assuming not-yet-completed; existing test suite extended with completed-dep test case

### Success criteria (engineer-authored, testable)

- ✓ All 4 bugs flipped `open → resolved` with `fixCommits` populated
- ✓ Each fix has ≥1 regression test (verified via failing-then-passing test commits)
- ✓ Hub deployed with all 4 fixes; production-traffic confirms zero recurrence over 7-day observation window
- ✓ Workflow Test Harness (Mission 1) used for at least 2 of the 4 fixes (validates cross-mission integration)

### Dependencies

- **Dependent on Mission 1 (Workflow Test Harness)** for ideal regression-test coverage — but NOT blocking; Cascade Correctness can ship its own narrow tests if Mission 1 isn't complete first
- **Blocks idea-144 Promotion** (workflow advancement Path A depends on cascade reliability) — non-Phase-4 follow-up

### Engineer-flagged scope decisions

- **Sequencing within mission:** recommend bug-27 + bug-28 first (smallest scope, both involve drift in single cascade-handler functions); then bug-22 (FSM extension); then bug-23 (race investigation may surface architectural decisions)
- **bug-23 H1 verification needs Hub-side investigation** — architect may want to scope as separate ADR if Hub FSM extension required

---

## Mission Brief 3 — bug-24 Tele Retirement Primitive

**Name:** ⚠ TBD architect (suggested: M-Tele-Retirement-Primitive)
**Tele served:** ⚠ TBD architect (engineer suggests: tele-2 Isomorphic Specification primary)
**Goal:** ⚠ TBD architect (engineer-suggested phrasing: "Add tele lifecycle primitive (`supersede_tele` MCP tool + Hub support) so the 5 zombie pre-rewrite teles can be formally retired and idea-149's tele-audit can fully close")
**Effort class:** **S** (per Phase 4 cost-class)
**Related Concepts-Defects:** ⚠ TBD architect (engineer suggests: Manifest-as-Master §2.4 primary concept; bug-24 missing-feature defect)

### Scope (engineer-authored)

Single-task mission:

- New MCP tool: `supersede_tele(superseded_id, successor_id, reason)` — records the supersession + flips superseded-tele's status to `superseded`
- Hub-side implementation: `ITeleStore.supersede(payload)` on Memory + GCS impls
- `list_tele` filter extension: `{includeSuperseded: false}` default + opt-in include
- Audit emission: `tele_superseded` action
- 5-tele cleanup: apply `supersede_tele` to the 5 pre-rewrite zombies (architect identifies which old-tele → which new-tele; engineer applies)
- `docs/specs/teles.md` §Provenance updated with formal supersession map

### Success criteria (engineer-authored, testable)

- ✓ `supersede_tele` MCP tool exists; tested via unit tests + integration test against in-memory Hub
- ✓ All 5 pre-rewrite teles in `gs://ois-relay-hub-state/tele/` carry `status: superseded` + reference their successor
- ✓ `list_tele()` default returns 13 (current set including tele-11/12); `list_tele({includeSuperseded: true})` returns 18 (includes 5 zombies)
- ✓ bug-24 flipped `open → resolved` with `fixCommits` populated
- ✓ idea-149 tele-audit cartography reference updated to confirm zombie cleanup landed

### Dependencies

- **None;** smallest-scope mission of the 4 — could ship in 2-3 days
- **Unblocks:** any future tele-audit / methodology refactor work

### Engineer-flagged scope decisions

- **Successor-mapping authority:** architect identifies the 5 supersession pairs (architectural call); engineer applies mechanically
- **Status enum extension:** Tele entity gains a `status` field — minor entity-shape change; architect should approve via Manifest-as-Master concept-grounding
- **Backward-compat:** existing `list_tele()` callers expect 11-tele set; default-filter-out zombies preserves current behavior + opt-in change

---

## Mission Brief 4 — idea-132 Promotion (Cognitive-layer silence mitigation)

**Name:** ⚠ TBD architect (suggested: M-Cognitive-Silence-Mitigation, OR M-Idea-132-Promotion preserving the idea-→-mission lineage signal)
**Tele served:** ⚠ TBD architect (engineer suggests: tele-11 Cognitive Minimalism primary; tele-7 Resilient Agentic Operations secondary; tele-12 Precision Context Engineering tertiary if 3-tele alignment supported)
**Goal:** ⚠ TBD architect (engineer-suggested phrasing: "Close bug-11 (Architect LLM tool-round exhaustion / cognitive-layer silence) by promoting idea-132's 7 captured mitigations into ratified mission scope; Phase E pre-hydration is the keystone")
**Effort class:** **M** (per Phase 4 cost-class)
**Related Concepts-Defects:** ⚠ TBD architect (engineer suggests: Substrate-First Logic §2.2 + Precision Context Engineering §2.6 primary concepts; LLM as Calculator / Substrate Leakage / Token Fragility / Context Displacement defects)

### Scope (engineer-authored)

Per idea-132 body, 7 captured mitigations form the mission scope. Mission-38 already shipped 5 of 7; this mission ships the remaining 2 + adds bug-11 verdict-flip:

1. **Task 1 — Phase E pre-hydration** (engineer-M, 1 week) — adapter pre-loads authoritative Hub state (current thread state, participant set, active tool surface) into prompt preamble before LLM invocation; idea-114 state-sync drift-reconciliation pattern; expected outcome: "zero setup rounds"
2. **Task 2 — State reconciliation on drift** (engineer-S, 0.5 week) — adapter detects local-state vs Hub-state divergence (e.g., thread-sync-check pattern per idea-114) and rehydrates without LLM involvement
3. **Task 3 — bug-11 verdict-flip** (engineer-S, 0.5 week) — telemetry analysis post-deploy; if `tool_rounds_exhausted` rate substantially reduced vs pre-mission-38 baseline, flip bug-11 `open → resolved` with `fixCommits` referencing this mission's commits + mission-38's commits

### Success criteria (engineer-authored, testable)

- ✓ Phase E pre-hydration shipped + Architect Cloud Run redeployed
- ✓ State reconciliation primitive shipped; tested via deliberate-drift integration test
- ✓ Telemetry post-deploy shows ≥50% reduction in `tool_rounds_exhausted` events for thread-reply paths (compared to pre-mission-38 baseline)
- ✓ bug-11 flipped `open → resolved` OR remains open with explicit measurement-based reason ("further reduction needed")
- ✓ idea-132 status flipped `triaged → incorporated` with this mission's id

### Dependencies

- **Architect Cloud Run redeploy required** for prod-effect (per mission-38 deploy-gap pattern) — engineer flags upfront so deploy gating is explicit
- **No blocking dependencies on other Phase 4 missions** — runs in parallel
- **bug-11 verdict-flip depends on observation window** (~7 days post-deploy with traffic)

### Engineer-flagged scope decisions

- **Mission-38 already shipped 5 of 7 mitigations** — this mission narrows to the remaining 2 + verdict-flip; mission scope is HONESTLY M not L
- **Phase E pre-hydration scope is the keystone** — could itself span multiple tasks if state-snapshot design is non-trivial; architect should confirm the single-task framing or split
- **Telemetry success-criterion threshold (≥50% reduction)** is engineer-authored estimate — architect/Director may want a different bar

---

## Cross-mission observations

### Total effort + sequencing

| Mission | Effort | Independence | Suggested sequencing |
|---|---|---|---|
| 3 (bug-24 Tele Retirement) | S (~3 days) | Independent | **Ship first** — quick, unblocks tele cleanup |
| 1 (Workflow Test Harness) | L (~4 weeks) | Foundational | Parallel start with #3; foundational for #2 |
| 2 (Cascade Correctness) | M (~2 weeks) | Depends-loosely on #1 | After #1 Wave 1 (test infrastructure) lands |
| 4 (idea-132 Promotion) | M (~2 weeks) | Independent | Parallel start; deploy-gated |

**Concurrent-engineer plan (if 1 engineer):** #3 → #1 (Wave 1) → in parallel { #2, #4 } using #1 Wave 1 infrastructure. Total: ~5-6 weeks linear.
**Concurrent-engineer plan (if 2 engineers):** Eng A: #1 (full); Eng B: #3 → #2 → #4. Total: ~4-5 weeks parallel.

### Anti-goals (Phase 4-scope, ≥5 per plan; ratify with architect's pre-staged list)

Engineer-side anti-goals (additive to architect's pre-staged 8):

- **Mission scope creep** — none of the 4 missions should grow beyond their cost-class during execution; if scope grows, file follow-up ideas + retract scope
- **Cross-mission coupling** — do NOT refactor across mission boundaries (e.g., Mission 1 should not touch cascade code; Mission 2 should not touch test-infra)
- **Re-litigating Phase 1-3 decisions** — domain assignments, concept naming, defect taxonomy are ratified; mission briefs reference but don't reopen
- **Architect filing missions outside this set** — Phase 4 selection is the 4 winners; architect-filed missions outside this set (other than via standard idea triage) violate Phase 4 scope discipline

### Engineer-side cross-review request

Once architect commits her side (Name/Tele/Goal/Concept-grounding for each), I'll cross-review:
- Goal phrasing matches engineer scope (no ambition mismatch)
- Tele alignment aligns with engineer's success criteria
- Concept-grounding traces to defects engineer is actually fixing

Then unified mission briefs assembled + presented to Director for final ratification.

---

*End of engineer-side draft. Awaiting architect-side fields for cross-review + Director final ratification + filing via `create_mission`.*
