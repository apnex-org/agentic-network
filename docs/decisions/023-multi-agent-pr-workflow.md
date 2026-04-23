# ADR-023: Multi-Agent PR Workflow — Trunk-Based Development with PR Gates

**Date:** 2026-04-23
**Status:** **Accepted** (ratified 2026-04-23 by Director; implementation proceeds via M-Trunk-Migration-Infrastructure mission + Phase 2 validator mission-43)
**Complements:** multi-branch-merge.md v1.0 (will be deprecated upon migration completion per Phase 3); mission-preflight.md (unchanged); strategic-review.md (unchanged)
**Supersedes (upon execution):** sovereign-branch-per-agent model currently encoded in multi-branch-merge.md §Roles
**Source:** 2026-04 retrospective §Item-5 multi-agent git workflow design discussion

---

## Decision

**Ratified 2026-04-23 by Director.** This ADR ratifies migration from sovereign-branch-per-agent topology to **trunk-based development with PR-gated integration**, plus the infrastructure + convention stack required to make it safe + scalable.

Specifically the ADR ratifies:

1. **Feature-branch-per-work** replaces sovereign agent branches (agents work on ephemeral branches; deleted post-merge). Per-mission branching is the initial scope; wave-scale branching reserved as engineer-judgment refinement when applicable.
2. **PR-based integration** via GitHub-native PR workflow
3. **CODEOWNERS** codifies directory-ownership + veto authority mechanically
4. **Branch protection on main** requires PR + CI green + CODEOWNERS approval
5. **Merge queue** serializes landing; parallelizes CI
6. **4-phase migration path** (infrastructure → validator → deprecation → scale-out-ready)

### PR-review triggering model

**v1.0 (Option A — thread-notification MVP):** engineer opens PR via `gh` CLI, then sends a Hub thread_message to architect containing the PR URL + CI status. Architect's existing drain loop picks up; architect reads/comments on PR via Bash-tool + `gh` CLI; replies in Hub thread when review posted. Zero new infrastructure; leverages existing Hub primitives + new `gh` environmental dependency.

**Medium-term (Option B — GitHub webhook → Hub bridge):** GitHub sends webhook on PR events; Hub endpoint translates to dispatch events; architect drain-loop fires autonomously. Filed as follow-up idea (see §Related ideas + backlog below); activates when Option A's manual-notification friction reaches signal-to-file threshold.

### gh CLI as the agent-local GitHub client

Both engineer + architect agents use `gh` CLI for all PR operations (open, view, comment, approve, merge). Install + auth is per-environment (one-time `gh auth login`). Environmental prerequisite captured in M-Trunk-Migration-Infrastructure mission T7 (docs/setup/ documentation).

### Related ideas + backlog

A follow-up idea is filed during ADR ratification: **"GitHub-webhook → Hub bridge for autonomous PR-review triggering"** (Option B per above). Activates when mission-43 Phase 2 validator + subsequent missions surface manual-notification friction as meaningful. No immediate commit; stays in backlog until signal.

---

## Context

### What prompted the decision

Mission-41 merge execution (first worked example of multi-branch-merge.md v1.0) surfaced coordination overhead + divergence-reconciliation costs that don't scale with agent count. At N=2 agents (architect + engineer), the sovereign-branch model is workable-with-pain. At N>2, it breaks predictably along 3 dimensions captured in retrospective §Item-5:

- **O(N²) pair-coordination** for cross-branch merges vs **O(N)** for agent-to-main
- **Divergence debt** accumulates per-branch-lifetime vs **minimized** per-PR
- **Conflict surface** proportional to pairs × shared surfaces vs **one PR at a time**

Director explicitly flagged scale-out readiness: *"How do 5 agents work together on the same repo?"* The sovereign-branch model doesn't answer that; trunk-based + PR does.

### What sovereign-branches was optimizing for

- **Isolation** — agents can work without blocking each other
- **Identity persistence** — `agent/lily` / `agent/greg` as stable long-lived contexts
- **Mission-semantic boundaries** — merge-at-mission-close maps to business workflow

These are real benefits. But they cost:

- Long-divergence merges (57-commit scale observed; worse at scale)
- Extensive pre-merge reconciliation (mission-41 required 4 drift commits + state-sync-check escalation)
- Methodology overhead (multi-branch-merge.md v1.0 is 354 lines; first worked example generated 10 retrospective-lite deltas)
- Coordination thread overhead (mission-41 used ~15 coordination threads; most would be eliminated under PR workflow)

### What trunk-based + PR optimizes for

- **Throughput** — small, frequent, low-cost merges instead of large, rare, expensive ones
- **Scale** — linear cost with agent count instead of quadratic
- **Safety** — every change passes the same CI + review gates; less reliance on agent discipline
- **Automation** — CODEOWNERS + merge queue + CI replace per-merge methodology ceremony

The tradeoff (honest): lose sovereign-branch identity persistence; agent identity moves to commit authors + PR metadata.

---

## What changes concretely

### 1. Branch topology

| Before | After |
|---|---|
| `agent/lily` (long-lived architect branch) | Ephemeral: `agent-lily/<mission-or-task-scope>` |
| `agent/greg` (long-lived engineer branch) | Ephemeral: `agent-greg/<mission-or-task-scope>` |
| `main` (pristine; merge-target) | `main` (trunk; authoritative; always deployable) |

Agent identity lives in:
- Git commit author (`Andrew Obersnel <aobersnel@apnex.com.au>` today; per-agent identities later)
- Co-Authored-By trailer (e.g., `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`)
- PR metadata (branch name prefix, PR author, labels)

### 2. Work cycle (per mission / per task)

```
1. Agent claims a task (via Hub get_task OR PR auto-assign)
2. Agent creates feature branch from origin/main:
   git switch -c agent-greg/mission-42-task-2-bug-27
3. Agent works on their branch (commits, pushes)
4. When ready, agent opens PR:
   title: "[mission-42 T2] bug-27 documentRef propagation fix"
   body: references Hub task-id; summarizes change
5. CI runs automatically on PR (tests + tsc + secret-scan)
6. CODEOWNERS auto-assigns reviewers based on changed files
7. Reviewers approve (or request changes) via PR comments
8. On approved + CI green: merge queue auto-merges
9. Branch deleted automatically post-merge
10. Hub task flips to completed (via Hub call from agent post-merge)
```

### 3. Branch protection configuration on main

```
Settings required on GitHub main branch:
- Require pull request before merging
- Require approvals: 1 (minimum; CODEOWNERS may add more)
- Require review from CODEOWNERS: enabled
- Dismiss stale approvals on new commits: enabled
- Require status checks to pass: enabled
  - vitest (hub)
  - vitest (adapters/claude-plugin)
  - vitest (adapters/opencode-plugin)
  - vitest (packages/network-adapter)
  - vitest (packages/cognitive-layer)
  - tsc --noEmit (all packages)
  - workflow-test-coverage in-sync
  - secret-scan
- Require branches to be up to date before merging: enabled
- Require linear history: enabled (rebase-merge or squash; no merge commits)
- Require merge queue: enabled
- Allow force pushes: disabled
- Allow deletions: disabled
```

### 4. CODEOWNERS content

```
# .github/CODEOWNERS
# Mechanizes the directory-ownership table from multi-branch-merge.md §Roles

# Architect-owned surface
docs/methodology/*         @architect-primary
docs/reviews/*             @architect-primary
docs/decisions/*           @architect-primary
docs/planning/*            @architect-primary

# Engineer-owned surface
docs/traces/*              @engineer-primary
hub/src/*                  @engineer-primary
hub/test/*                 @engineer-primary
hub/scripts/*              @engineer-primary
adapters/*                 @engineer-primary
packages/*/src/*           @engineer-primary
packages/*/test/*          @engineer-primary

# Shared (co-sign required — CODEOWNERS enforces dual-review)
docs/specs/*               @architect-primary @engineer-primary
docs/audits/*              @architect-primary @engineer-primary
.github/workflows/*        @architect-primary @engineer-primary
.github/CODEOWNERS         @architect-primary @engineer-primary

# Root configs — shared (co-sign)
/package.json              @architect-primary @engineer-primary
/tsconfig.json             @architect-primary @engineer-primary
**/package-lock.json       @engineer-primary

# Mission artifacts — per-file (engineer owns merge artifacts; architect owns preflights + kickoff)
docs/missions/*-preflight.md          @architect-primary
docs/missions/*-kickoff-decisions.md  @architect-primary
docs/missions/*-merge.md              @engineer-primary
```

### 5. Merge queue

GitHub-native merge queue (the simpler option; no third-party tooling):
- Queue PRs after approval + green CI
- Rebase against latest main; re-run CI
- Land sequentially; fail-forward if rebase-CI fails (author fixes; re-queues)

External options (`mergify`, `Kodiak`, `bors`) available but overkill for current scale.

### 6. Automation stack

| Component | Purpose | Location |
|---|---|---|
| `.github/workflows/ci.yml` (extends existing `test.yml`) | Run tests + tsc on PR | `.github/workflows/` |
| `.github/workflows/secret-scan.yml` | Pattern-check for dangerous file types (`*.tfvars`, `*.tfstate*`, `*.env*`) | `.github/workflows/` |
| `.github/CODEOWNERS` | Reviewer auto-assignment + review-requirement enforcement | `.github/` |
| `.github/auto-assign.yml` (optional) | Auto-assign PR authors / labels | `.github/` |
| `.husky/pre-commit` (from Item-4 agreement) | Local gitignore-bypass + secret-filename check | `.husky/` |
| Branch protection rules | Configured via GitHub UI or `.github/settings.yml` | GitHub settings |
| Stale-branch reaper | Auto-delete merged branches after 24h | Built into merge queue |

---

## Migration path — 4 phases

### Phase 1 — Infrastructure scaffolding (this ADR's immediate output)

Ship the scaffolding without moving any mission work yet:

- `.github/CODEOWNERS` added
- Branch protection rules configured on `main`
- Merge queue enabled
- `.github/workflows/secret-scan.yml` added
- `.husky/pre-commit` hook added
- Documentation committed: `docs/methodology/multi-agent-pr-workflow.md` v1.0

Current sovereign-branch workflow remains operational during Phase 1 (e.g., if mission-42 activates here, it can use either workflow).

**Owner:** new mission — `M-Trunk-Migration-Infrastructure` (brief at `docs/planning/m-trunk-migration-infrastructure-brief-draft.md`)
**Effort:** S-class (~2-3 engineer-days + architect review)
**Deliverable:** all 6 scaffolding items landed on `main` via final sovereign-branch merge (eats its own dogfood: the last multi-branch-merge.md v1.0 application before migration)

### Phase 2 — One mission validates the new workflow

Pick next-up mission; execute end-to-end under new PR workflow. Capture observations (analogous to mission-41 retrospective-lite → v1.0 methodology deltas).

**Candidate:** mission-43 (M-Tele-Retirement-Primitive) — S-class, standalone, zero cross-mission dependencies, fully pre-ratified. Smallest meaningful scope for a workflow validator.

**Deliverable:** mission-43 shipped via PR workflow; `docs/methodology/multi-agent-pr-workflow.md` v1.0 updated with observations (analogous to multi-branch-merge.md after mission-41).

### Phase 3 — Deprecate sovereign-branch model

After Phase 2 validates the shape:

- All future missions use PR workflow by default
- `agent/lily` + `agent/greg` branches archived on origin (kept as historical tags; no new commits)
- `docs/methodology/multi-branch-merge.md` v1.0 marked **Superseded** — retained for historical-merge understanding but not for new work
- CODEOWNERS enforcement becomes authoritative; multi-branch-merge.md §Roles table deprecated

**Timing:** after 2-3 missions confirm Phase 2 validator's observations generalize.

### Phase 4 — Scale-out readiness verification

When N>2 agents (third agent joins), verify:

- CODEOWNERS correctly routes PRs to new agent's surface
- Merge queue handles 3+ simultaneous PRs without degradation
- No bilateral coordination thread needed between peer agents (only with main)
- Per-agent identity preserved via commit author + PR metadata

**Timing:** agent-count event-driven; not scheduled.

---

## What stays unchanged

- Hub threads for mission-level coordination, reviews, ADRs, retrospectives
- `mission-preflight.md` methodology (still gates activation)
- `strategic-review.md` methodology (still runs for backlog triage)
- Director-in-the-loop for strategic decisions (activation, release-gate, ADR ratification)
- Review cadence model (per-task or per-wave — engineer's judgment; PR becomes the surface, threads the exception)
- Commit-message conventions (`[prefix]` + body + Co-Authored-By trailer)
- Mission closing audit patterns

---

## Specific re-priorization of current mission backlog

Per Director direction "re-evaluate against current missions and prioritise order accordingly":

### Current state (pre-ADR-023)

| Mission | Status | Priority signal |
|---|---|---|
| mission-41 | SHIPPED | — |
| mission-42 | proposed; pre-ratified (ADR-022 + kickoff-decisions) | Medium; bug-28 empirical elevation documented |
| mission-43 | proposed; pre-ratified | Low; quick-win |
| mission-44 | proposed; preflight YELLOW (Decision 3 pending) | High (bug-11 CRITICAL); but telemetry-threshold decision pending |
| 3 planning drafts (Invariant-Coverage-v2/v3 + Agent-Behavior) | Drafts in `docs/planning/` | Follow-up; post-mission-41 |

### Proposed state (post-ADR-023)

| Rank | Mission | Rationale for position |
|---|---|---|
| **1** | **M-Trunk-Migration-Infrastructure** (NEW) | Phase 1 of ADR-023; infrastructure investment benefits all subsequent missions; small scope (S-class); last mission on current workflow |
| **2** | **mission-43** (M-Tele-Retirement-Primitive) | Phase 2 validator per ADR-023; small + standalone + pre-ratified = ideal first PR-workflow mission |
| **3** | **mission-42** (M-Cascade-Correctness-Hardening) | Bug-28 fix elevated by mission-41 empirical signal; PR workflow cleaner for 4-task decomposition + ADR-022 bilateral-seal implementation |
| **4** | **mission-44** (M-Cognitive-Layer-Silence-Closure) | CRITICAL bug-11; deploy-gated + 7-day observation window; PR workflow benefit on verdict-flip review cycle |
| **5** | M-Invariant-Coverage-v2 | Follow-up after three Phase-4 winners ship |
| **6** | M-Invariant-Coverage-v3 | Follow-up |
| **7** | M-Agent-Behavior-Invariants | LLM-integration distinct-shape; lowest urgency |

### Rationale for re-ordering

**Mission-43 vs M-Trunk-Migration-Infrastructure first** — infrastructure-first (option A) rather than ship-fix-first (option B) because:
- The infrastructure is small (~S-class; ~2-3 days) — doesn't delay much
- Mission-43 itself benefits from the new workflow (Phase 2 validator) — pays dividends immediately
- Missions 42 + 44 (which are the "real work") execute cleaner post-infrastructure
- Repeat-the-mission-41-merge-pain for 3 more missions before migrating would be a clear mistake

**Mission-42 vs Mission-43 order (post-infrastructure)** — Mission-43 is the Phase 2 validator because:
- Smaller scope (S vs M) — less risk during validation
- Zero cross-mission dependencies — pure workflow test
- Pre-ratified — no scope decisions mid-validation
- Quick-win delivery signals migration success

Mission-42 follows because its bug-28 fix unlocks real DAG primitive usage (relevant to future missions and workflow-gap mitigation).

**Mission-44 position** — CRITICAL severity argues for earlier, but:
- Preflight Decision 3 not ratified yet (blocker)
- 7-day observation window consumes calendar time
- Deploy-gate dependency adds complexity
- Not a clean workflow-validator (too big + too many moving parts)

Better to activate after 42 confirms both infrastructure + bug-28 fix are good.

---

## Success criteria for ADR-023 execution

Ratification of this ADR enables:

1. **M-Trunk-Migration-Infrastructure mission** authored + Director-ratified + activated
2. **Phase 1 scaffolding** landed on main (CODEOWNERS, branch protection, merge queue, secret-scan CI, pre-commit hook)
3. **Phase 2 validator (mission-43)** executes end-to-end under new workflow without needing Option C Director-override escalation
4. **Sovereign branches deprecated** after 2-3 successful missions on new workflow (Phase 3)
5. **No merge-at-mission-close pain** equivalent to mission-41's 57-commit divergence reconciliation for any subsequent mission

---

## Tradeoffs + risks

### Loss
- Sovereign-branch persistence (`agent/lily` / `agent/greg` no longer permanent)
- Mission-41-style deep bilateral coordination at merge (that shape becomes PR review, not thread)
- multi-branch-merge.md v1.0 methodology becomes partly-obsolete (Phase 3 formalizes)

### Gain
- Linear scale with agent count
- Per-PR safety gates (CI + CODEOWNERS + review)
- Industry-standard tooling (GitHub-native; no exotic config)
- Methodology simplification (PR workflow is globally understood)
- Automation (merge queue + CODEOWNERS + auto-delete)

### Risks
- **Migration period duality** — Phase 1 ships infrastructure while existing workflow still operational; could create confusion. Mitigation: clear communication via thread signals; mission-43 explicitly named as "first mission on new workflow."
- **Agent adapter integration** — agents currently coordinate via Hub threads. PR workflow means reading/writing via GitHub API. Mission-M-Trunk-Migration-Infrastructure must include adapter updates OR declare adapter changes as Phase 2+ scope.
- **CODEOWNERS misalignment** — if agent identities don't map cleanly to CODEOWNERS (e.g., multi-architect scenarios), enforcement may confuse. Mitigation: start with simple `@architect-primary` + `@engineer-primary` mapping; refine over time.

### Acceptable given benefits
- The loss items are soft losses (identity continuity preserved via commit metadata; coordination patterns shift but don't disappear)
- The risk items are manageable with Phase 1 + Phase 2 gated validation

---

## Director ratification questions — historical (answered 2026-04-23)

| # | Question | Ratified answer |
|---|---|---|
| 1 | Ratify target state (trunk-based + PR + CODEOWNERS + merge queue)? | **Yes** |
| 2 | Ratify 4-phase migration path? | **Yes** |
| 3 | Ratify re-prioritized mission order? | **Yes** |
| 4 | Ratify mission-43 as Phase 2 validator (vs mission-42)? | **Yes** — smaller + standalone + zero-dependency |
| 5 | M-Trunk-Migration-Infrastructure scope (scaffolding only vs scaffolding + adapter integration)? | **Yes — scaffolding only**; adapter-PR-integration deferred to Option-B-triggered follow-up |
| 6 | Ship `.husky/pre-commit` as part of infrastructure mission? | **Yes** |
| 7 (surfaced during ratification discussion) | PR-review triggering model? | **Option A (thread-notification MVP) for v1.0; Option B (GitHub-webhook → Hub bridge) filed as follow-up idea for medium-term** |
| 8 (surfaced during ratification discussion) | Per-mission branching initial scope? | **Yes — per-mission feature branches for initial scope; wave-scale at engineer judgment** |
| 9 (surfaced during ratification discussion) | gh CLI as agent-local GitHub client? | **Yes — standard tool; per-environment install; documented in mission T7** |

Preserved for historical record; canonical ratified decisions live in §Decision above.

---

## Filing metadata

- **Status at draft:** Draft — awaiting Director ratification
- **Ratification protocol:** Director explicit signal; ADR flipped Draft → Accepted; architect files M-Trunk-Migration-Infrastructure brief as next-up mission
- **Post-ratification:** architect files infrastructure mission; Director release-gate signals activation; engineer executes Phase 1
- **Deprecation cascade:** multi-branch-merge.md v1.0 flipped Superseded on Phase 3 completion; new methodology `multi-agent-pr-workflow.md` v1.0 authored during Phase 2 validator mission

---

*ADR v1.0 drafted 2026-04-23 from 2026-04 retrospective §Item-5 discussion. Target-state ratification enables migration; infrastructure mission follows. First worked example (Phase 2 validator) scheduled as mission-43.*
