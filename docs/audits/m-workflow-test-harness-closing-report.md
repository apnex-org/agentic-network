# Mission M-Workflow-Test-Harness — Wave 1 Closing Report

**Hub mission id:** mission-41
**Mission brief:** `docs/reviews/2026-04-phase-4-briefs/m-workflow-test-harness.md` (Phase 4 architect-engineer sealed; Director-ratified 2026-04-22; activated 2026-04-23).
**Kickoff decisions (ratified 2026-04-23):** `docs/missions/mission-41-kickoff-decisions.md`.
**Preflight:** `docs/missions/mission-41-preflight.md` (GREEN).
**Scope of this report:** Wave 1 only. Mission has 3 waves; Wave 2 and Wave 3 will be audited separately (or amend this doc on mission close).
**Dates:** activated 2026-04-23 AEST mid; Wave 1 closed same-day; ~3 hours wall-clock engineer time.
**Wave 1 scope:** 5-task test-infrastructure build — PolicyLoopbackHub parity + bug-12 fix → FSM-invariant assertion helpers → Mock*Client scaffolds (both adapters) → coverage-report tool + CI merge-gate.

Closes the shim-side portion of idea-104 ("Mock Harness") across both adapters. Resolves bug-12. Ships the first CI workflow in the repo.

---

## 1. Deliverable scorecard

| Task | Source directive | Status | Commit | Effort estimate vs actual | Test count delta |
|---|---|---|---|---|---|
| **T1** — PolicyLoopbackHub parity audit + bug-12 fix | task-324 | ✅ Approved | (pre-existing `635a58e` + state-flip; no new commit) | 0.5d est / ~10 min actual | +0 (fix pre-existed; re-verified 11/11 threads-2-smoke pass) |
| **T2** — Hub testbed FSM-invariant assertion helpers | task-325 | ✅ Approved | `b0208d3` | 2d est / ~1h actual | +10 hub tests (invariant-helpers self-tests) |
| **T3** — MockClaudeClient scaffold | task-326 | ✅ Approved | `590e969` | 2d est / ~1h actual | +4 claude-plugin tests (mock smoke) |
| **T4** — MockOpenCodeClient scaffold | task-327 | ✅ Approved | `294d599` | 1.5d est / ~45m actual | +4 opencode-plugin tests (mock smoke) |
| **T5** — Coverage-report tool + CI merge-gate | task-328 | ✅ Approved | `1793a62` | 1d est / ~45m actual | +0 (infrastructure only; gate-verified via local deliberate-fail reproduction) |

**Aggregate:** 5 tasks, 4 commits (T1 was state-flip only), ~7 engineer-days estimated vs ~3 hours actual — **~12× faster than briefed.** Both estimates + actuals documented in individual task reports.

**Test counts at Wave 1 close:**
- hub: 649 passing + 5 skipped — was 639 at Wave 1 start; +10 mission-introduced (all in `hub/test/e2e/invariant-helpers.test.ts`).
- claude-plugin: 71 passing — was 67 at Wave 1 start; +4 mission-introduced (all in `adapters/claude-plugin/test/mocks/MockClaudeClient.test.ts`).
- opencode-plugin: 32 passing — was 28 at Wave 1 start; +4 mission-introduced (all in `adapters/opencode-plugin/test/mocks/MockOpenCodeClient.test.ts`).

**Sync state at Wave 1 close:** all commits on `agent/greg` ahead of `agent/lily` and `main`. Wave 1 commits (`b0208d3`, `590e969`, `294d599`, `1793a62`) plus trace patches (`30388b5`, `c870852`, `5de2290`, `b93f8a0`, `9812126`, `6c5044c`) + this closing audit. bug-12 flipped `open → resolved` with `fixCommits=["635a58e"]` at T1 ship.

---

## 2. Mission goal + success framing

**Parent problem (brief §Goal):** 28 workflow invariants in `workflow-registry.md` §7.2 carry `Tested By: NONE` — spec↔runtime divergence is only detectable by manual observation, not mechanically. sym-B-004 (Phase 2 top-score 15/25). Foundation-of-Sand cluster; Debugging Quicksand; Happy-Path Brittleness; Regression Leakage; Hope-Based Engineering — all partially resolved by mechanizing invariant coverage.

**Mission-41 Goal:** bring ≥10 of 28 invariants under automated coverage so divergence becomes **mechanically detectable** rather than observation-dependent. Pool-foundational: downstream Phase 4 winners #3/#5/#6 consume this harness.

**Wave 1 scope (of 3 total waves):** build the test infrastructure — mock harness + assertion helpers + coverage report + CI gate. Leaves Wave 2 (actual invariant tests using the helpers) and Wave 3 (spec-column updates + remaining-gap follow-ups) to subsequent waves.

### Success criteria (brief §Success criteria — per-criterion status at Wave 1 close)

| # | Criterion | Status at Wave 1 close | Note |
|---|---|---|---|
| 1 | **Coverage: ≥10 of 28 INV-* invariants** have ≥1 automated test in the Hub test suite | 🟡 partial — helpers exist for all 10 ratified invariants; self-tests are the only current consumer; Wave 2 authors target tests | 10 helpers in `hub/test/e2e/invariant-helpers.ts`; 10 self-tests; spec↔runtime bridge in place |
| 2 | **Mock-harness packages exist** + drive real shim code; idea-104 partially absorbed | ✅ met | MockClaudeClient (T3) + MockOpenCodeClient (T4); idea-104 shim-side closed |
| 3 | **CI gate verified** — merge fails on invariant-test regression (verified via deliberate-fail PR) | 🟡 substitute — local-reproduction done (exit code 1 captured, vitest output names failing INV); real PR deferred to post-merge per worktree-authority boundary | `.github/workflows/test.yml` shipped; architect or Director can author a post-merge PR for CI-history if desired |
| 4 | **Coverage report** at `docs/audits/workflow-test-coverage.md` | ✅ met | Scanner at `hub/scripts/invariant-coverage.ts`; report checked in; CI drift-check job enforces sync |
| 5 | **workflow-registry.md §7** updated with `Tested By:` column | ⏸ deferred to Wave 3 per brief | Not in Wave 1 scope |
| 6 | **Chaos paths**: WF-001 + WF-005 chaos-path covered with ≥1 test case each | ⏸ deferred to Wave 2 | Helpers + mocks now exist to author these |
| 7 | **Suite health**: workflow-test-harness runs at ≥90% pass rate on `main` over 7-day observation window | ⏳ baseline begins on first post-merge PR | Measurable via GitHub Actions history |

**Wave 1 delivers the infrastructure; Waves 2 + 3 convert infrastructure to coverage.** Per kickoff-decisions §Decision 1 boundary, Wave 2 task filings become appropriate post-Wave-1-merge.

---

## 3. Per-task architecture recap

### T1 — PolicyLoopbackHub parity audit + bug-12 fix

Task-324 closed as verify + audit rather than code-change: bug-12 was already fixed at commit `635a58e [bug-12] Wire ADR-017 stores into PolicyLoopbackHub`, landed pre-mission-41. Verified fix live via `threads-2-smoke.test.ts` 11/11 pass (890ms). Parity audit between `packages/network-adapter/test/helpers/policy-loopback.ts` and `hub/test/e2e/orchestrator.ts` TestOrchestrator came back CLEAN on all three surfaces: 12 `AllStores` entries, 13 policy registrations, 9 `IPolicyContext` fields. Two semantic differences in `dispatch`/`emit` noted but documented as by-design distinct test affordances (TestOrchestrator does ADR-014 engineer→role resolution; PolicyLoopbackHub broadcasts to LoopbackTransport sessions). bug-12 flipped `open → resolved` with `fixCommits=["635a58e"]`.

Value: confirmed no hidden drift between the two test harnesses that Wave 2 authors would need to navigate.

### T2 — FSM-invariant assertion helpers

Task-325 shipped `b0208d3`. New module `hub/test/e2e/invariant-helpers.ts` (~370 LOC) + self-test suite (`invariant-helpers.test.ts`, 10 tests). 10 `assertInv*` helpers — one per ratified Wave-2 invariant (kickoff-decisions §Decision 1): T4/P1/P2/P4/TH6/TH7/I2/M4/TH18/TH19.

Each helper signature: `(TestOrchestrator, mode?: InvariantMode) => Promise<void>`. `InvariantMode = "all" | "positive" | "negativeReject" | "edge"`. Helpers throw on invariant violation. Helper names match INV-id exactly so T5's coverage-scanner can statically auto-map call sites → INV coverage.

**Gap-surfacing ratchets:**
- INV-P2 `negativeReject` mode intentionally throws today — proposal-policy has no status guard on `create_proposal_review`; helper encodes the spec-correct behavior. Flips green when the guard lands.
- INV-TH18 / INV-TH19 stubbed via `InvariantNotYetTestable` throw pending T3+T4 mock-harness. Wave 2 graduates.

3 implementation discoveries documented in task-325 report (not filed as bugs — all docs-fidelity corrections): `create_proposal` is Engineer-initiated (not Architect); proposal ID prefix is `prop-N` (not `proposal-N`); `create_mission` returns `missionId` field (not `id`).

Value: spec-to-runtime isomorphism becomes executable. Helper names are the T5 scanner's input surface.

### T3 — MockClaudeClient scaffold

Task-326 shipped `590e969`. New module `adapters/claude-plugin/test/mocks/MockClaudeClient.ts` (~275 LOC) + 4 smoke tests + 1-page README. `createMockClaudeClient()` factory builds `PolicyLoopbackHub` + architect `McpAgentClient` + engineer `McpAgentClient` + real `createDispatcher` + MCP `InMemoryTransport` pair (simulates Claude Code). No network, no subprocesses, deterministic.

Extracted the harness pattern from the existing `shim.e2e.test.ts` (internal helpers `createArchitect` + `createEngineerWithShim`) into a public reusable API. Adds `playTape(steps)` declarative scripted-scenario runner with `${capture.path}` interpolation; step kinds: `architect` | `claude` | `waitFor` | `assert`.

Finding (docs-drift): brief references `adapters/claude-plugin/src/proxy.ts` but actual files are `shim.ts` (platform wiring: stdio transport, config, process lifecycle) + `dispatcher.ts` (testable core: MCP tool-dispatch, queueMap, SSE→pendingActionMap). Mock drives `dispatcher.ts`. See §5.1 for the compiled docs-drift list.

Value: idea-104 claude-shim-side scope absorbed; Wave 2 workflow-invariant tests (TH18/TH19) have their claude-side harness.

### T4 — MockOpenCodeClient scaffold

Task-327 shipped `294d599`. New module `adapters/opencode-plugin/test/mocks/MockOpenCodeClient.ts` (~290 LOC) + 4 smoke tests + 1-page README. Mirror of T3 for opencode backend with opencode-specific wiring:
- `dispatcher.createMcpServer()` factory (vs claude's `.server` property)
- Late-binding `getAgent()` callback (vs claude's forward-reference pattern)
- `queueMapCallbacks` composition (matches production shim.ts ADR-017 SSE-path subset; OpenCode-runtime toast/prompt callbacks excluded as runtime-dependent)

**Tape spec intentionally aligned with T3** — same `architect`/`waitFor`/`assert` step kinds; same `${capture.path}` interpolation; host step is `opencode` (mirrors T3's `claude`). **Tape runner per-backend** (~80 LOC duplicated) — scope-preserving judgment to keep T3 untouched. Future consolidation to `packages/network-adapter/test/helpers/mock-tape.ts` is a Rule-of-Three candidate when a third backend appears; documented in both READMEs.

Finding (docs-drift, same class as T3): brief references `adapters/opencode-plugin/hub-notifications.ts` but actual files are `shim.ts` + `dispatcher.ts`. Mock drives dispatcher.

Onboarding note: `adapters/opencode-plugin/node_modules` was empty in this worktree; `npm install` (150 packages) required once. Not bug-worthy; worktree-setup concern.

Value: idea-104 opencode-shim-side scope absorbed; Wave 2 cross-shim-parity tests now authorable.

### T5 — Coverage-report tool + CI merge-gate

Task-328 shipped `1793a62`. Four sub-scopes:

**Scanner** (`hub/scripts/invariant-coverage.ts`, ~200 LOC): walks 5 test roots for `assertInv<ID>(` call-sites (regex tightened during dev to exclude description-string false-positives — `it("assertInvT4 (task ...)")` no longer matches). Ratified 10-INV subset hard-coded from kickoff-decisions §Decision 1; workflow-registry §7.2 spec-parser is a Wave-3 enhancement candidate. Emits `docs/audits/workflow-test-coverage.md`. Status vocabulary: `Tested` | `Stub` | `Out-of-Scope`. Re-runnable via `cd hub && npm run coverage:invariants` (new npm script; 1-line package.json addition).

**Generated coverage report** (`docs/audits/workflow-test-coverage.md`): baseline at Wave 1 close — 8 Tested + 2 Stub + 10 Out-of-Scope rows. Densifies as Wave 2 tests cite the helpers.

**CI workflow** (`.github/workflows/test.yml`): **first CI workflow in the repo.** Two jobs:
- `vitest (${{ matrix.package }})` — 5-package matrix (hub + cognitive-layer + network-adapter + claude-plugin + opencode-plugin); each runs `npm ci && npm test` with Node 22. Any vitest non-zero exit blocks the PR.
- `workflow-test-coverage in-sync` — regenerates the audit report and fails on git-diff. Catches "added an `assertInv*` call-site but forgot to regen the report" drift.

**Deliberate-fail gate verification**: real PR deferred to post-merge per worktree-engineer authority. Local reproduction: seeded `fail("T4", "positive", "DELIBERATE-FAIL GATE VERIFICATION — revert before commit")` in `assertInvT4`, ran `vitest run test/e2e/invariant-helpers.test.ts`, captured **exit code 1** with clearly-named failing INV line in output (`[INV-T4/positive] invariant violated: DELIBERATE-FAIL GATE VERIFICATION`), reverted. Full suite back to 649/649 pass post-revert.

Value: tele-8 Gated Recursive Integrity mechanical closure — the Phase 1 reverse-gap. Merge-gate discipline becomes a first-class CI feature rather than convention.

---

## 4. Observability surface inventory (new)

| Surface | Kind | Source | Consumer |
|---|---|---|---|
| `hub/test/e2e/invariant-helpers.ts` | Test-authoring vocabulary (10 `assertInv*` helpers) | T2 / `b0208d3` | Wave 2 test authors; T5 scanner |
| `InvariantMode` type + `InvariantNotYetTestable` class | Test-authoring API | T2 / `b0208d3` | Wave 2 test authors |
| `adapters/claude-plugin/test/mocks/MockClaudeClient.ts` | Multi-agent test harness (claude-shim-side) | T3 / `590e969` | Wave 2 workflow-invariant tests |
| `adapters/opencode-plugin/test/mocks/MockOpenCodeClient.ts` | Multi-agent test harness (opencode-shim-side) | T4 / `294d599` | Wave 2 workflow-invariant + cross-shim-parity tests |
| `playTape(steps)` declarative runner | Test-authoring API | T3 + T4 (per-backend runners; shared spec) | Wave 2 authors + future mock consumers |
| `hub/scripts/invariant-coverage.ts` + `npm run coverage:invariants` | Operational scanner | T5 / `1793a62` | Engineers (local) + CI `coverage-report-sync` job |
| `docs/audits/workflow-test-coverage.md` | Generated report | T5 / `1793a62` | Closing audit readers + Wave 3 spec-fold |
| `.github/workflows/test.yml` | CI merge-gate | T5 / `1793a62` | Every future PR in the repo |

Two entirely-new artifact classes introduced: per-INV-id helper-assertion + scripted-tape scenario runner. The helper-assertion class is what Wave 2 will densify; the tape class is what workflow-invariant graduation (TH18/TH19) will consume.

---

## 5. Findings

### 5.1 Docs-drift compilation (brief-vs-actual)

Five brief-level citations pointed at files that don't exist or have different names. All surfaced during task execution; none are bugs (all docs-fidelity issues). Compiled for Wave 1 record:

| # | Brief citation | Actual file(s) | Surfaced in |
|---|---|---|---|
| 1 | `adapters/claude-plugin/src/proxy.ts` (brief Wave 1 bullet 1) | `adapters/claude-plugin/src/shim.ts` (platform wiring) + `adapters/claude-plugin/src/dispatcher.ts` (testable core) | T3 (task-326 report) |
| 2 | `adapters/opencode-plugin/hub-notifications.ts` (brief Wave 1 bullet 1) | `adapters/opencode-plugin/src/shim.ts` + `adapters/opencode-plugin/src/dispatcher.ts` | T4 (task-327 report) |
| 3 | "exercising real shim code" implied one-file target per adapter | Each adapter has 2 files: shim (platform) + dispatcher (testable core); mock drives dispatcher | T3 + T4 |
| 4 | "No regression in hub-side test suite" (T1 exit criterion) assumes a code-change delivery | T1 delivered as verify+audit+status-flip (bug-12 pre-fixed); criterion still met via parity-audit verification | T1 (task-324 report) |
| 5 | "Scripted notification contract: notification kind + payload → expected ack semantics" (T4 brief) implied opencode-specific notification vocabulary | Unified tape spec with T3 serves both; host step-kind names differ (`claude` vs `opencode`) but everything else is shared | T4 (task-327 report) |

**Disposition:** Not filed as bugs (all cosmetic/docs-fidelity). Recommended follow-up: amend the Phase 4 brief template to require a pre-kickoff "source file audit" so future missions catch these during preflight rather than at execution.

### 5.2 Implementation findings handled inline

| Finding | Handled by |
|---|---|
| `create_proposal` is Engineer-only; `create_proposal_review` is Architect-only | T2 helpers (P1/P2/P4) wired with correct actor roles after first test-run failure |
| Proposal ID prefix is `prop-N`, not `proposal-N` | T2 helpers fixed; all P* positive/negative modes updated |
| `create_mission` returns `missionId` field, not `id` | T2 assertInvM4 setup helper uses `missionId` key |
| Scanner regex initial `\s*\(` matched `it("assertInvT4 (task ...)")` description strings | T5 regex tightened to disallow whitespace before `(` (immediate-paren pattern) |
| No prior `.github/workflows/` in repo | T5 ships the first CI workflow — formalizes merge-gate discipline |
| No prior `hub/scripts/` directory | T5 creates it; matches obvious pattern |
| `adapters/opencode-plugin/node_modules` empty in this worktree | T4 ran `npm install` once; worktree-setup concern (not bug) |

### 5.3 Scope-deviation judgments — all accepted in review

| Deviation | Task | Rationale | Review disposition |
|---|---|---|---|
| No new commit for bug-12 fix (pre-existed at `635a58e`) | T1 | Never amend published commits | Accepted (reviews/task-324) |
| No separate audit doc for T1 parity finding (inline in report) | T1 | All-clear findings fit inline per mission-40 precedent | Accepted |
| Sibling-module (`invariant-helpers.ts`) rather than inline-extension of `orchestrator.ts` | T2 | Keeps orchestrator.ts focused on the ActorFacade; cleaner import surface for Wave 2 | Accepted (reviews/task-325) |
| Extracted pattern from `shim.e2e.test.ts` rather than hand-rolling | T3 | Proven pattern; existing test continues to pass unchanged | Accepted (reviews/task-326) |
| Shared spec, per-backend tape runner (~80 LOC duplicated between T3 + T4) | T4 | Rule of Three: don't abstract prematurely; keeps T3 untouched | Accepted (reviews/task-327) — architect specifically praised the judgment |
| Hard-coded ratified subset vs spec-parser in scanner | T5 | Wave-1 scope preservation; spec-parser is Wave-3 enhancement | Accepted (reviews/task-328) |
| Local deliberate-fail reproduction substituted for real post-merge PR | T5 | Worktree engineer lacks push/PR authority; architect/Director can author a post-merge PR for CI-history if desired | Accepted; ratified in thread-259 |

---

## 6. Mission timeline

| Time (AEST) | Event |
|---|---|
| 2026-04-22 | Phase 4 architect-engineer-sealed brief filed (`732b6b5`) |
| 2026-04-22 | Director ratification of Phase 4 winner #1 |
| 2026-04-23 01:31Z | Mission flipped `proposed → active` (architect) |
| 2026-04-23 01:36Z | Architect opens thread-255 with activation scaffolding direction |
| 2026-04-23 01:41Z | Engineer replies with 5-task Wave 1 decomposition + 5 `create_task` staged actions |
| 2026-04-23 01:48Z | Thread-255 bilateral convergence; cascade committed 6 actions spawning tasks 324-328 |
| 2026-04-23 — T1 | bug-12 verified pre-fixed; parity audit CLEAN; bug-12 flipped `open → resolved`; T1 in_review |
| 2026-04-23 — T2 | `invariant-helpers.ts` shipped `b0208d3`; 10 helpers; hub 639 → 649 tests |
| 2026-04-23 — T3 | `MockClaudeClient.ts` shipped `590e969`; claude-plugin 67 → 71 tests |
| 2026-04-23 — T4 | `MockOpenCodeClient.ts` shipped `294d599`; opencode-plugin 28 → 32 tests |
| 2026-04-23 — T5 | Scanner + CI workflow shipped `1793a62`; coverage report generated; deliberate-fail reproduction captured |
| 2026-04-23 | Wave 1 closes on T5 approval (`reviews/task-328-v1-review.md`) |

Mini-thread-per-completion cadence (thread-256 → thread-257 → thread-258 → thread-259 → thread-260) used throughout — architect-initiated pattern to compensate for empty `dependsOn` on the filed tasks (Hub DAG cascade doesn't auto-flip downstream without explicit deps). Known workflow gap; idea-108 Hub-as-Conductor territory for a future mission.

---

## 7. Downstream prereqs cleared

### Wave 2 (now authorable)

Per kickoff-decisions §Decision 1 boundary, Wave 2 task filings become appropriate post-Wave-1-merge. Ready surfaces:

- **8 entity-invariant tests** — `assertInvT4` / `assertInvP1` / `assertInvP2` / `assertInvP4` / `assertInvTH6` / `assertInvTH7` / `assertInvI2` / `assertInvM4` all have positive + (where meaningful) negative + edge modes. INV-P2 `negativeReject` is the intentional gap-surfacing ratchet; flips green when proposal-policy adds the status guard.
- **INV-TH18 / INV-TH19 graduation** — replace `InvariantNotYetTestable` stub bodies with real assertions driven by `MockClaudeClient` + `MockOpenCodeClient`. Wave 2 graduation PR is straightforward now.
- **Cross-shim parity tests** — tape vocabulary shared between Mock*Client; the same tape runs against both with only the host-step-kind name varying.

### Wave 3 (post-Wave-2)

- Precise enumeration of `INV-S*-unlisted` / `INV-XD*-unlisted` placeholders in the coverage report (resolve via `workflow-registry.md §7.2` parse).
- `workflow-registry.md §7 Tested By:` column updates for the 10 ratified invariants (originally Wave-3 scope per brief).
- Follow-up-idea filings for the 18 uncovered §7.2 NONE invariants.
- Scanner v2: parse workflow-registry directly so subset drift auto-surfaces.

### Pre-merge action items

- Architect or Director authors a real deliberate-fail PR post-merge (for CI-history record) if desired. Local reproduction already captured in T5 report.

### Mission-wide (post-Wave-3)

- Amend this closing report with Wave 2 + Wave 3 outcomes (or file separate `-wave-2-closing-report.md` / `-wave-3-closing-report.md` artifacts).
- Mission-41 brief-template feedback (§5.1 docs-drift) folded into Phase 4 template amendment.

---

## 8. Tele-alignment retrospective

| Tele | Role | Wave 1 outcome |
|---|---|---|
| tele-2 Isomorphic Specification | primary | Spec↔runtime bridge is executable: each `assertInv<ID>` encodes one workflow-registry §7 invariant as runnable code. Mock*Client ensures shim-side isomorphism verifiable for both adapters. |
| tele-8 Gated Recursive Integrity | primary | First CI workflow in the repo ships (`.github/workflows/test.yml`); vitest non-zero blocks merge. Phase 1 reverse-gap mechanically closed. Deliberate-fail reproduction confirms gate forensics-ready. |
| tele-9 Chaos-Validated Deployment | primary | Mock-driven chaos paths enumerable: deterministic, reproducible, no Bun / no Cloud Run dependency. WF-001 / WF-005 chaos paths authorable in Wave 2. |
| tele-7 Resilient Agentic Operations | secondary | Non-actionable failures gain test output visibility (Wave 2 will exercise this). |
| tele-5 Perceptual Parity | secondary | Coverage report = perceivable gate state; re-runnable + CI-drift-checked. |

**tele-leverage score at Wave 1 close: 5/5 maintained** (all brief-cited tele pairings exercised by the Wave 1 deliverables, even if Wave 2/3 complete the story).

---

## 9. Key references

### Ship commits (Wave 1)

- `b0208d3` — T2 FSM-invariant assertion helpers
- `590e969` — T3 MockClaudeClient scaffold
- `294d599` — T4 MockOpenCodeClient scaffold
- `1793a62` — T5 Coverage-report tool + CI merge-gate
- `635a58e` — (pre-mission) bug-12 fix absorbed by T1

### Trace commits (Wave 1)

- `30388b5` — trace initialization
- `c870852` — T1 shipped
- `5de2290` — T2 shipped
- `b93f8a0` — T3 shipped
- `9812126` — T4 shipped
- `6c5044c` — T5 shipped / Wave-1 closure narrative

### Hub entities

- `mission-41` (status: active; flipped by architect on 2026-04-23)
- `bug-12` (status: resolved via T1)
- Tasks: `task-324` / `task-325` / `task-326` / `task-327` / `task-328` (all `completed` at Wave 1 close, except T5 which is `in_review` at this audit's commit and flips to `completed` on approval)

### Reviews

- `reviews/task-324-v1-review.md`
- `reviews/task-325-v1-review.md`
- `reviews/task-326-v1-review.md`
- `reviews/task-327-v1-review.md`
- `reviews/task-328-v1-review.md`

### Threads

- `thread-255` — activation scaffolding (architect-initiated; 6-action cascade spawned tasks 324-328)
- `thread-256` through `thread-260` — mini-thread-per-completion approval cadence (all bilaterally converged, 2 actions each)

### Related Hub artifacts

- `idea-104` (Mock Harness) — shim-side portion fully absorbed via T3 + T4
- `idea-108` (Hub-as-Conductor) — cited by architect in thread-256 as future-mission territory for the `dependsOn`-empty workflow gap observed here

### Specs + planning docs

- `docs/specs/workflow-registry.md` §7 (parent spec; 28 NONE invariants + Tested By column)
- `docs/reviews/2026-04-phase-4-briefs/m-workflow-test-harness.md` (mission brief)
- `docs/missions/mission-41-kickoff-decisions.md` (ratified scope decisions)
- `docs/missions/mission-41-preflight.md` (GREEN verdict)
- `docs/methodology/mission-preflight.md` v1.0 (methodology applied first time to this mission)
- `docs/traces/m-workflow-test-harness-work-trace.md` (live state)
- `docs/traces/trace-management.md` (trace-discipline guide)

### Mission-41-generated artifacts

- `hub/test/e2e/invariant-helpers.ts` + `invariant-helpers.test.ts`
- `adapters/claude-plugin/test/mocks/MockClaudeClient.ts` + test + README
- `adapters/opencode-plugin/test/mocks/MockOpenCodeClient.ts` + test + README
- `hub/scripts/invariant-coverage.ts`
- `docs/audits/workflow-test-coverage.md` (generated)
- `.github/workflows/test.yml`
- `reports/task-324-v1-report.md` through `reports/task-328-v1-report.md`

---

## 10. Recommendations for Wave 2

1. **File Wave 2 tasks in two batches** — entity-invariant batch (8 tests, claim via positive + negativeReject + edge modes) first; TH18/TH19 graduation (2 tests + stub-strip) second. Batches are semantically distinct and can ship on different cadence.
2. **INV-P2 ratchet** — Wave 2's entity-invariant test file will immediately fail on INV-P2 `negativeReject` mode until proposal-policy adds the status guard. Either the test author also patches proposal-policy (preferred — land both together) or files a separate blocking bug. Recommend the former: the gap is small (~10 LOC guard in `createProposalReview`).
3. **INV-TH18/TH19 graduation** — strip `InvariantNotYetTestable` throw from both helpers; inline-import `createMockClaudeClient` + `createMockOpenCodeClient` for multi-agent scenarios. Tape-driven test bodies should be readable.
4. **Cross-shim parity tests** — a bonus Wave 2 deliverable: run the same tape against both Mock*Client instances; assert identical Hub-observable outcomes. Surfaces any shim divergence that the individual mocks don't catch.
5. **Scanner v2 (defer to Wave 3)** — parse workflow-registry §7.2 directly instead of hard-coding the ratified subset. Lets the scanner auto-surface spec drift as new invariants are documented.

---

*End of Wave 1 closing report. Wave 2 addendum follows (single-artifact-per-mission per thread-265 architect recommendation).*

---

# Wave 2 Addendum

**Wave 2 dates:** 2026-04-23 AEST mid (activated via thread-261; closed on task-338 approval via thread-265 ratification of Option 1).
**Wave 2 scope:** 10 ratified invariant tests (per kickoff-decisions §Decision 1) — 8 entity-invariant tests (Batch 1) + 2 workflow-invariant graduations (Batch 2). Consumes the Wave 1 test-infrastructure scaffolding: T2 `assertInv*` helpers + T3/T4 Mock*Client harnesses (available; consumption decided per-task) + T5 coverage scanner.

---

## 11. Wave 2 Deliverable Scorecard

### Batch 1 — Entity invariant tests

| Task | INV | Commit | Tests | Notable |
|---|---|---|---|---|
| 329 | INV-T4 | `b21ae23` | 5 | All 4 terminal states (completed via approval, escalated via 4-cycle revision, failed via direct-mutation fallback, cancelled shape-pinned) |
| 330 | INV-P1 | `b41e8e0` | 3 | Authorization-denied shape pin + unknown-role RBAC-bypass pin |
| 331 | INV-P2 | `1019b4f` | 6 | **Ratchet CLOSED** — proposal-policy status guard at policy-layer entry + 4 non-submitted states rejected + `assertInvP2("negativeReject")` flips GREEN |
| 332 | INV-P4 | `e0cc8ec` | 4 | Layered with INV-P2 (review-on-implemented double-protected) |
| 333 | INV-TH6 | `11f0714` | 8 | 5 non-active thread statuses covered via direct-store mutation |
| 334 | INV-TH7 | `015ec94` | 5 | `leave_thread` semantic-separation contrast |
| 335 | INV-I2 | `a79de1d` | 5 | Graceful-degradation across bad `sourceThreadId` + bad `missionId` |
| 336 | INV-M4 | `2b9518e` | 9 | Parametrized 2×3 rejection matrix (completed × {proposed/active/abandoned}; abandoned × {proposed/active/completed}) |

**Batch 1 aggregate:** 45 new hub tests + 1 Hub policy change (INV-P2 guard). Engineer-completion ~1.5 hours after Wave 1 closure.

### Batch 2 — Workflow-invariant graduations

| Task | INV | Commit | Tests | Notable |
|---|---|---|---|---|
| 337 | INV-TH18 | `e1a8ff2` | 11 (10 + 1 self-test delta) | Routing-mode immutability (ADR-016 vocabulary); broadcast→unicast coercion edge |
| 338 | INV-TH19 | `db1cae0` | 9 (8 + 1 self-test delta) | **Cascade atomicity critical path** — "mixed valid+invalid rejected with VALID action NOT partially spawned" pins the all-or-nothing gate semantic |

**Batch 2 aggregate:** 20 new hub tests (including self-test flips) + scanner `STUBBED` set emptied (`hub/scripts/invariant-coverage.ts`) + 1 stub-then-graduate pattern proven end-to-end. Engineer-completion ~1 hour after Batch 1.

### Wave 2 combined

- **10 new test files** under `hub/test/e2e/invariants/`
- **58 new hub tests** (45 Batch 1 + 13 net new in Batch 2 after self-test deltas)
- **1 Hub policy change** (INV-P2 proposal-policy status guard at `hub/src/policy/proposal-policy.ts:createProposalReview`)
- **2 helper graduations** (`assertInvTH18` + `assertInvTH19` stripped of `InvariantNotYetTestable`)
- **Hub suite:** 654 → 712 pass (+58 over Wave 1 baseline; +75 over pre-mission baseline of 637)
- **Coverage report:** all 10 ratified INVs at `Tested` status with 3 call-sites each (helper def + helper self-test + Wave 2 test); scanner STUBBED set `{}`
- **tsc clean** across all 10 commits

---

## 12. Mission-41 Brief Success Criteria — Post-Wave-2 Status

| # | Criterion | Status at Wave-2 close | Note |
|---|---|---|---|
| 1 | **Coverage: ≥10 of 28 INV-* invariants tested** | ✅ **MET** | Exactly 10 — all ratified subset covered |
| 2 | Mock-harness packages exist; idea-104 shim-side absorbed | ✅ met (Wave 1) | Confirmed usable post-graduation decisions |
| 3 | CI gate verified via deliberate-fail PR | 🟡 substitute (Wave 1) | Local reproduction; real PR deferred to post-merge |
| 4 | Coverage report at `docs/audits/workflow-test-coverage.md` | ✅ met (Wave 1) | Regenerated per-ship; all 10 INVs Tested |
| 5 | `workflow-registry.md §7 Tested By:` column updated | ⏸ Wave 3 | Per brief decomposition |
| 6 | WF-001 + WF-005 chaos-path covered with ≥1 test case each | ⏸ Wave 3 (per task-338 architect review) | Not in kickoff-decisions Wave-2 subset; Wave 3 picks up |
| 7 | 7-day pass-rate ≥90% on main | ⏳ measurable post-merge | Baseline begins on first post-merge PR |

**Wave 2 advances criterion #1 to met; criteria #5 + #6 explicitly handed to Wave 3.**

---

## 13. INV-P2 Ratchet Closure

The most load-bearing outcome of Wave 2 Batch 1. Pre-mission, `workflow-registry.md §7.2` flagged INV-P2 as `NONE (no status guard on reviewProposal)` — spec and runtime were out of sync; any proposal could be re-reviewed at any time, regardless of its FSM state.

**What shipped (commit `1019b4f`):**
- Policy-layer entry guard at `hub/src/policy/proposal-policy.ts:createProposalReview` rejects reviews when `proposal.status !== "submitted"`. Error text matches the existing `task-policy.ts` FSM-rejection shape (`Invalid state transition`).
- Placement rationale: policy-layer NOT store-layer — `ctx.stores.proposal.reviewProposal` is also used by the scaffolding-failure recovery path (line 315) as a rollback primitive; a store-layer guard would break recovery. Policy-entry guard runs once per public `create_proposal_review` invocation; internal rollback at the store layer remains legitimate.
- Test surface (`INV-P2.test.ts` + helper `negativeReject` mode) pins all 4 non-submitted states as rejected.

**Architectural significance:** this is the **concrete demonstration of tele-2 (Isomorphic Specification) as a functional mechanism** — the gap-surfacing ratchet (T2 helper throwing until the guard lands) forced the spec-runtime sync to complete before Wave 2 could close. The guard + test shipped in one commit; the ratchet flipped from red to green atomically. If a future refactor accidentally removes the guard, the test breaks; spec remains the source of truth.

---

## 14. Boundary-Pin Pattern — Catalog

Several Wave 2 tests go beyond "assertion-passes" and pin the specific error-text shape or policy-behavior boundary so future refactors surface through the invariant test rather than through downstream diagnosis confusion. Enumeration:

| Test | Boundary pinned | Why it matters |
|---|---|---|
| INV-T4 (cancelled shape) | "Invalid state transition" + "cancelled" error text | Operator log-diagnosability — operators read the FSM-rejection text to triage; future error-message refactors surface here |
| INV-P1 (Authorization-denied shape) | "Authorization denied" prefix + caller role + permitted role | Future structured-error refactors surface here; RBAC contract is the boundary |
| INV-P1 (unknown-role bypass) | `router.ts:120` back-compat carve-out for `callerRole === "unknown"` | Future "tighten RBAC" refactor must intentionally update |
| INV-P4 (layered with INV-P2) | "Invalid state transition" + "implemented" + "submitted" in error | Layered protection — INV-P2 guard catches `review-on-implemented`; if guard ever narrows, this test surfaces |
| INV-TH6 (cascade-only states) | Non-RBAC rejection class for non-active replies | Operators disambiguate thread-status from RBAC failures |
| INV-TH7 (leave_thread contrast) | Participant-initiated abandonment permitted for engineers | Future RBAC refactor accidentally blocking `leave_thread` surfaces here |
| INV-I2 (trust-caller semantic) | Dangling-pointer persistence on bad linkage | Invariant is graceful degradation; test confirms system intentionally accepts caller input |
| INV-M4 (non-status-field passthrough) | Description/documentRef updates permitted on terminal missions | Documents that INV-M4 is status-transition-specific, not "terminals frozen entirely" — future over-reach surfaces |
| INV-TH18 (multicast immutability) | routingMode unchanged across replies | Contrast with broadcast coercion — the one permitted transition is broadcast→unicast only |
| INV-TH19 (atomicity critical path) | Mixed valid+invalid convergence — valid action NOT partially spawned | Distinguishes atomic-gate from best-effort-commit semantics; load-bearing for the invariant |

10 boundary-pin cases (one per test file). This is a proto-pattern: future invariant-test authors should look for the "what would silently break if this refactored without surfacing" question and encode that as a boundary pin alongside the canonical assertion.

---

## 15. Mock*Client Consumption Pattern

Wave 1 T3/T4 shipped `MockClaudeClient` + `MockOpenCodeClient` with the expectation that Wave-2 workflow-invariant graduations (TH18/TH19) would consume them. Neither graduation did. The emergent pattern:

> **Consume Mock*Client when the invariant is shim-side or transport-dependent. Stay with TestOrchestrator when the invariant is policy-layer.**

Applied in both TH18 + TH19:
- **TH18** — routing-mode immutability is enforced in `validateRoutingModeArgs` + `MemoryThreadStore` + the `broadcast→unicast` coercion logic in state.ts:1587-1589. Purely policy-layer. TestOrchestrator's `asArchitect()` + `asEngineer()` exercise exactly the same handlers the Mock*Client harnesses route through — adding mock-layer ceremony would not expand coverage.
- **TH19** — cascade atomicity is enforced at `validateStagedActions` + the state.ts gate + the cascade.ts execute path. Same analysis.

Mock*Client usage awaits future invariants that genuinely depend on shim-side behavior (e.g. cross-shim parity tests, dispatcher-routing regressions, SSE→pendingActionMap timing). They exist, they're ready, they wait.

---

## 16. Bug-28 DAG-Collision — Empirical Priority Signal

Wave 2 Batch 2 attempted **3 consecutive DAG-primitive exercises** via `dependsOn` to demonstrate the Hub's auto-unblock cascade. All 3 collided with bug-28 (stale-completed-dep race):

| Attempt | Intended DAG link | Collision mechanism | Disposition |
|---|---|---|---|
| 1 | Original Batch 1 — file all 8 entity tests with `dependsOn: [task-329]` (mechanical cascade proof) | task-329 would be `completed` by the time task-335 was filed → task-335 lands blocked-forever | Abandoned at kickoff-decision discussion; filed all with `dependsOn: []` |
| 2 | Refined Batch 2 initial — TH18 `dependsOn: [task-329]` | task-329 was `completed` before TH18 filing → TH18 would land blocked-forever | Architect refined to TH18 `dependsOn: []`; TH19 `dependsOn: [<TH18-id>]` |
| 3 | Batch 2 post-refinement — TH19 `dependsOn: [task-337]` | task-337 was `completed` before TH19 filing → TH19 would land blocked-forever | Architect Option 1 accepted; TH19 `dependsOn: []` |

**Observation (compiled from thread-264):** *"Three bug-28 collisions in one batch is a strong empirical signal for mission-42 Task 2 (bug-28 fix) priority. The workflow-gap mitigation we attempted mechanically collides with the very bug mission-42 is scoped to fix. Worth noting for Director when mission-42 release-gate is considered."*

**Practical outcome:** the DAG-primitive demonstration is **deferred to post-mission-42** (once bug-28 is fixed, any future mission with legitimate DAG deps can demonstrate the cascade cleanly). Wave 2 functional scope was entirely achievable with `dependsOn: []` throughout, so the blocker didn't impede deliverables — just the didactic "DAG works" artifact.

**Cross-mission hand-off:** Architect is authoring the bug-28 fix under mission-42; the preflight YELLOW state flagged earlier on thread-259 is directly downstream of this pattern. Mission-41 and mission-42 are in a natural load-balancing relationship at the workflow-infrastructure layer.

---

## 17. Spec-Clarification Findings — For Wave 3 / Follow-up Ideas

Wave 2 surfaced 4 spec-clarification findings worth filing as follow-up ideas during Wave 3's idea-filing sweep:

1. **INV-T4 `failed` state has no router-FSM path.** `TaskStatus` enum includes `failed`; the `TASK_FSM` transition table in `hub/src/policy/task-policy.ts:35-48` has no entry naming it. `failed` is only reachable via cascade failure (see `hub/src/policy/cascade.ts:98`). Test uses direct-store mutation to force the state. **Spec-wording candidate:** the invariant should probably say "`failed` is a cascade-only terminal reachable exclusively through cascade-handler exception" so future FSM readers understand why there's no transition-to-failed.

2. **`read_completed` / `reported_completed` task-status enum values** exist in `TaskStatus` (`hub/src/state.ts:8`) + in `task-policy.ts:296` enum list but have NO transitions in the FSM table. Unclear whether these are deprecated, reserved for future use, or implicitly terminal. **Wave-3 enumeration candidate** — may warrant a dedicated INV entry if they're intentionally terminal.

3. **INV-I2 wording overstates the invariant.** Spec says "auto-linkage failure is non-fatal — idea still updates." On inspection (see Wave 2 INV-I2 test findings), the system intentionally doesn't validate caller-supplied linkage IDs (`missionId` in `updateIdea`, `sourceThreadId` in `createIdea`) — so there's no *attempted* lookup to fail. The observable behavior is "the idea store trusts caller input for linkage fields; dangling pointers persist rather than being rejected." **Spec-wording candidate:** rewrite as "linkage IDs are caller-trusted; no validation attempt means no failure semantic." Same observable behavior; sharper invariant description.

4. **`ActorFacade` lacks `engineerId` accessor.** Wave 2 tests needing `recipientAgentId` (for `unicast` thread creation) couldn't read the engineer's agentId directly from the ActorFacade; resolved via registry lookup (`engineerIdFor(orch)` helper). Minor ergonomics gap. **Test-infrastructure enhancement candidate:** expose `engineerId` as a property on `ActorFacade` after first-call registration, matching `MockClaudeClient`'s `EngineerActorHandle` shape.

All 4 findings are **observation-only** — none justified a Hub code fix within Wave 2 scope. Wave 3 or a separate follow-up mission can triage and file ideas/bugs as appropriate.

---

## 18. Mission Timeline — Wave 2

| Time (AEST) | Event |
|---|---|
| 2026-04-23 mid | Wave 1 closure artifact committed (`68843de`); thread-260 bilateral converged |
| 2026-04-23 mid | Director greenlits Wave 2 via thread-261; engineer stages 8 entity-test `create_task` actions |
| 2026-04-23 mid | Thread-261 bilateral convergence; cascade spawns tasks 329-336 |
| 2026-04-23 mid | task-329 (INV-T4) shipped `b21ae23`; architect opens thread-262 with nudge-model correction (batch-continue cadence) |
| 2026-04-23 mid | Thread-262 bilateral convergence; engineer works through remaining 7 entity tests serially in ID order |
| 2026-04-23 mid | Batch 1 complete — tasks 330-336 shipped across commits `b41e8e0` → `2b9518e` |
| 2026-04-23 mid | Thread-263 opened for Batch 2 (TH18 graduation); engineer stages TH18 with `dependsOn: []` per architect's bug-28 refinement |
| 2026-04-23 mid | task-337 shipped `e1a8ff2`; stub-then-graduate pattern proven end-to-end |
| 2026-04-23 mid | Thread-264 opened for Batch 2 T2 (TH19); bug-28 collision #3 flagged; architect Option 1 accepted; engineer stages TH19 with `dependsOn: []` |
| 2026-04-23 mid | task-338 shipped `db1cae0`; **WAVE 2 COMPLETE** |
| 2026-04-23 mid | Thread-265 opened for audit-format ratification + Wave 3 direction; engineer authors this addendum per Option 1 |

---

## 19. Wave 2 vs Original Budget

Wave 2 brief estimate: **~2 engineer-weeks** (engineer-M per brief §Scope Wave 2).
Wave 2 actual: **~2.5 hours** engineer-claimable time (same-day as Wave 1 activation).

Ratio: **~60× ahead of budget.** Combined with Wave 1's 12× ratio, total mission-41 Wave-1+Wave-2 engineer time is on the order of ~5-6 hours against a ~3-engineer-week budget. The harness's purpose (making invariant-coverage mechanizable) is itself the compression mechanism — once the helpers + scanner exist, per-INV test authoring is minutes not days.

**Caveat:** the 10 ratified INVs were the *well-scoped* subset. Wave 3's `workflow-registry.md §7 Tested By:` column update + WF-001/005 chaos-path coverage + 18-invariant follow-up-idea filings will take longer proportionally, since they include spec-reading work + judgment calls on each uncovered INV's scoping.

---

## 20. Recommendations for Wave 3

1. **Spec column fold first.** `workflow-registry.md §7 Tested By:` updates for the 10 covered INVs should land as one atomic commit — reading the generated `docs/audits/workflow-test-coverage.md` gives the test file:line mapping directly.
2. **WF-001 + WF-005 chaos-path coverage** (brief success criterion #6) — these are workflow-chaos tests, not invariant-coverage tests. Different scope shape. Review `hub/test/e2e/e2e-chaos.test.ts` for existing patterns. May require new test files under `hub/test/e2e/workflows/` or similar.
3. **18 uncovered §7.2 NONE invariants** — file as follow-up ideas (engineer-callable via `create_idea`), not Wave 3 tasks. Distinguish by: idea = "invariant deserves future coverage consideration"; task = "invariant will be covered by this specific engineer scope." Wave 3 budget probably can't absorb 18 more test files; idea-filing preserves the surface for future missions.
4. **Scanner v2** — parse `workflow-registry.md §7.2` directly instead of hard-coding the ratified subset. Lets the scanner auto-surface spec drift as new invariants are documented. Small tsx refactor (~30-50 LOC).
5. **4 spec-clarification findings** (§17 above) — triage during Wave 3 idea-filing; each becomes an `idea-*` entry with `sourceThreadSummary` pointing at this section.
6. **Final mission closing audit** — amend this doc with a Wave 3 tail (or a mission-wrap section that composes Wave 1 + 2 + 3 into a clean closure). Single-artifact-per-mission preserved.

---

*End of Wave 2 addendum. Wave 3 scope opens on Director/architect direction; Wave 3 addendum will append here.*
