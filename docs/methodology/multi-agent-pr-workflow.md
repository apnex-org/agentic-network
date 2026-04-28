# Multi-Agent PR Workflow — Methodology

**Status:** v1.0 RATIFIED (2026-04-25). Engineer co-authorship complete (2026-04-23). Architect spec-alignment review + worked-example validation across 5 missions on new workflow (mission-43, 46, 47, 49, 48 in chronological completion order). Calibrations from missions 47/48/49 captured in §v1.0 ratified-with calibrations. Supersedes `docs/methodology/superseded/multi-branch-merge.md` per ADR-023 Phase 3.
**Scope:** reusable procedure for agents collaborating via trunk-based development with PR-gated integration. Replaces the sovereign-branch-per-agent + periodic-merge model.
**Supersedes:** `docs/methodology/superseded/multi-branch-merge.md` v1.0 (retained as historical reference; see its Superseded header).

---

## Purpose

A **multi-agent PR workflow** is the codified procedure for agents (architect + engineer + future pool members) integrating their work continuously into `main` via pull requests. It exists because multi-agent collaboration produces parallel development streams that must converge safely, and trunk-based-with-PR integration converges them at **commit-level granularity** rather than branch-level-periodic-merge granularity.

This methodology is the **third pillar** in the mission lifecycle, alongside:
- `docs/methodology/strategic-review.md` — backlog triage + mission prioritization (pre-mission)
- `docs/methodology/mission-preflight.md` — activation gate (proposed → active)
- **This doc** — per-PR integration gate (active → main, continuously, not only at mission close)

### Why trunk-based-with-PR instead of sovereign-branch?

Sovereign-branch-per-agent (mission-41 shape) paid three ongoing costs:
- **Coordination overhead** — ~15 bilateral threads per mission for cross-branch awareness
- **Long-divergence merge pain** — mission-41 ran 57 commits of merge reconciliation
- **Main-state surprise** — main drifted from day-to-day agent reality; "what's on main?" was a periodic investigation, not a live observable

Trunk-based-with-PR resolves these structurally:
- **Coordination via PR** — the PR itself is the coordination surface; review happens in the PR, not in a thread about the PR
- **Short-lived branches** — each agent's branch lives for one PR's scope (hours to ~2 days), not for a full mission
- **Main is live** — main reflects only-approved-merges and runs CI on every landed commit; "what's on main" = `git log main`

Plus one additional gain:
- **Mechanized directory ownership** — `.github/CODEOWNERS` turns the ownership table from methodology-text-enforcement to tooling-enforcement

---

## When to use this methodology

- **Any agent commit destined for main** — every commit lands via PR; there are no direct-pushes
- **Multi-agent concurrent work** — two+ agents working in parallel (architect + engineer; future: N-agent pool)
- **Cross-mission work** — docs refactors, env/scripts changes, tooling upgrades
- **Solo-agent work** — even single-agent changes use PRs (for CI gate + review discipline + audit trail)

## When NOT to use

- **Single-agent repos** — if the repo has exactly one agent with direct-write, PRs add friction without the multi-agent benefit (doesn't apply here; this repo is ≥2 agents)
- **Prod-outage response** — Option C Director-override still applies (see §Director-override); emergency fixes may bypass the queue but require post-incident PR-reconstruction
- **Hotfixes during a main-freeze** — if main is frozen for release cut, coordinate with Director before queueing

---

## Roles

| Role | Responsibility | Default loading |
|---|---|---|
| **Architect** | Owns methodology field-ownership (this doc); authors PR reviews; drives shared-surface design decisions; drafts ADRs + methodology deltas | Claude Code session as architect |
| **Engineer** | Owns execution-side sections (co-authored per Phase 4 pattern; originally marked `TODO(engineer)` in the v1.0 skeleton); authors code PRs; implements per-task work; runs local pre-commit gates | Claude Code session as engineer |
| **Director** | Admin access (branch protection, merge queue config, CODEOWNERS overrides); ratifies strategic-scope PRs; Option C escape hatch | Human |

### Directory ownership — mechanized via CODEOWNERS

The core conflict-resolution primitive is **`.github/CODEOWNERS`** — the manifest that mechanizes directory ownership. When a PR touches a file, GitHub auto-assigns the primary owner as a required reviewer. Merge requires the CODEOWNER's approval (enforced by branch protection).

**Authoritative ownership table lives in `.github/CODEOWNERS`.** This doc describes the *semantics*; the file enforces them. Inconsistency between this doc and CODEOWNERS → update both in the same PR.

Baseline ownership (copied from `multi-branch-merge.md` v1.0; CODEOWNERS encodes this):

| Directory / pattern | Primary owner | Notes |
|---|---|---|
| `docs/methodology/*` | Architect | Methodology-text-ownership |
| `docs/traces/*` | Engineer | Work-trace ownership |
| `docs/reviews/*` | Architect | Architect-authored |
| `docs/planning/*` | Architect | Mission-brief drafts |
| `docs/decisions/*` (ADRs) | Architect | ADR authorship |
| `docs/audits/*` | Shared | Co-author sign-off (requires both) |
| `docs/specs/*` | Shared | Sovereign system truth |
| `docs/missions/*` | Mixed by file | Per-file ownership preserved via glob patterns |
| `hub/src/*`, `adapters/*/src`, `packages/*/src` | Engineer | Code surface |
| `hub/test/*`, `adapters/*/test`, `packages/*/test` | Engineer | Test surface |
| `hub/scripts/*`, `adapters/*/scripts` | Engineer | Operational scripts |
| `.github/workflows/*` | Shared | CI gate; both sides |
| Root configs (`package.json`, `tsconfig.json`, `vitest.config.ts`, lockfiles) | Shared | Cross-package effects |
| `start-*.sh`, session-local scripts | N/A | Must not be committed to main (husky + secret-scan gate) |

**Resolution escalation on shared-ownership PRs:**
1. Both CODEOWNERS approve → PR eligible for merge queue
2. On disagreement, open a thread with `semanticIntent: collaborative_brainstorm` to reach bilateral agreement; amend PR; re-review
3. If still ambiguous, Director ratifies via comment on the PR (Option C)

---

## Procedure — per-PR lifecycle

### Step 0 — Load context

Before starting work:
- Read this methodology doc
- Confirm you're on latest `main` (`git fetch origin && git status` shows `up to date with origin/main`)
- Confirm Hub task is in scope (`get_task` or confirm via mission-active state)
- Confirm pre-commit hook is installed (`ls .husky/_/husky.sh` or equivalent; see `docs/setup/architect-engineer-git-env.md`)

### Step 1 — Branch + commit discipline

#### 1a. Create feature branch

Convention: `agent-<name>/<scope>` — e.g., `agent-greg/t4-secret-scan`, `agent-lily/methodology-v1`.

**Always branch from the `origin/main` tip** — never from a stale local main, never from another agent's branch unless explicitly stacking (below):

```bash
git fetch origin
git checkout main
git merge --ff-only origin/main            # refuse if local main diverged — investigate
git checkout -b agent-<name>/<scope>
```

The `--ff-only` is the safety: if local `main` has drifted (e.g., experimental commits), the merge refuses rather than silently rebasing. Fix the drift before branching.

**Worktree vs single-clone.** Either works; pick based on concurrency needs:

- **Single clone** — simplest; each branch-switch is a `git checkout`. Fine when one agent works at a time on one branch.
- **Multi-worktree** (`git worktree add ../<name>-worktree agent-<name>/<scope>`) — parallel work on multiple branches without `git stash` or branch-switch overhead; each worktree has its own working tree + HEAD but shares `.git/`. Required when multiple agents share a host.

If using worktrees, configure per-worktree identity (`extensions.worktreeConfig` + `git config --worktree`) per `docs/setup/architect-engineer-git-env.md` §2 — otherwise commits can author as the wrong agent and remote URLs can cross-contaminate.

**Stacked branches** (PR-B depends on PR-A still-in-review):

- **Preferred: avoid stacking** — wait for PR-A to land + rebase before opening PR-B. Adds latency but keeps review linear.
- **When stacking is necessary** (blocking work is a large refactor; decoupling would double the work):
  1. Create PR-B's branch from PR-A's branch head, not main: `git checkout agent-<name>/<pr-a> && git checkout -b agent-<name>/<pr-b>`
  2. Open PR-B targeting `agent-<name>/<pr-a>`, **not main**. GitHub renders the incremental diff; reviewer sees only PR-B's additions.
  3. State the dependency in PR-B's body: `Depends on #<PR-A>`.
  4. When PR-A lands (via queue-squash), rebase PR-B onto the new main: `git fetch origin && git rebase origin/main && git push --force-with-lease`. Change PR-B's base to `main`.
  5. If PR-A's squash changes its content meaningfully (fixup commits land), re-review PR-B's diff against main before re-queuing.

#### 1b. Commit locally

- Commit messages follow existing convention (`[mission-id] <subject>` for mission work; `[type] <subject>` otherwise where type ∈ `env`, `scripts`, `docs`, `chore`, `fix`, `feat`)
- Each commit passes the `.husky/pre-commit` gate (filename pattern check per T5)
- `--no-verify` bypass is permitted but **audit-visible** — if you use it, say so in the PR body and explain why

#### 1c. Pre-push self-check

Before pushing:
- `git diff --name-only origin/main` — confirm the file list matches scope
- `git log origin/main..HEAD --oneline` — confirm commit count + messages make sense
- No `start-*.sh` or session-local scripts accidentally staged

### Step 2 — Open the PR

#### 2a. Push the branch

First push sets upstream tracking:

```bash
git push -u origin agent-<name>/<scope>
```

Subsequent pushes (new commits during review iteration):

```bash
git push
```

**Force-push policy** — `--force-with-lease` is permitted for same-author rebase-updates mid-review:

```bash
git push --force-with-lease
```

Use `--force-with-lease` (never bare `--force`). The `-with-lease` refuses if the remote has commits you haven't seen locally — catches the "someone committed to my branch while I was rebasing" case before it silently overwrites their work. Bare `--force` skips this check and will overwrite remote commits without warning; it's banned on agent branches.

When force-push is appropriate:

- **Rebase onto updated main** after another PR lands (queue-reject recovery, stacked-PR rebase)
- **Squash fixup commits** before requesting review (clean history for reviewer)
- **Amend the tip commit** to fix a bad commit message or add a missed file (pre-review; post-review amendments should prefer a new commit for audit trail)

When force-push is NOT appropriate:

- **Post-review-approval** without re-notifying the reviewer — if the content changes, re-request review
- **On `main`** — ever (see §Failure modes §CI regression)
- **When someone else has committed to your branch** — `--force-with-lease` will refuse; investigate before attempting

#### 2b. Create the PR via `gh pr create`

PR artifact conventions:

**Title format:** `[<mission-id-or-type>] <task-id-or-scope>: <imperative summary>`

Examples:
- `[mission-45] T4: secret-scan CI workflow`
- `[env] bump husky to 9.1.5`
- `[docs] methodology v1.0 co-author fills`

**Body template:**

```markdown
## Summary
<1-3 bullets — what this PR does and why>

## Task / Mission ref
- Mission: `mission-XX` (`get_mission` for context)
- Task: `task-YYY` (if applicable)

## Scope
- Files touched: <summary>
- CODEOWNERS triggered: <who's required to review>

## Test plan
- [ ] Local CI green (`vitest run` / `tsc --noEmit` / etc.)
- [ ] Deliberate-fail test where applicable (e.g., T4: add sensitive filename, confirm PR blocks)
- [ ] <task-specific checks>

## Notes for reviewer
<optional — non-obvious decisions, tradeoffs, or context>

## Out of scope
<optional — deliberately-deferred items>

🤖 Generated with Claude Code
```

#### 2c. Notify architect via Hub thread (Option A v1.0 MVP)

**Option A manual-notification protocol** (until Option B webhook→Hub bridge ships):

Engineer, after `gh pr create` returns a URL:

1. Open a Hub thread (`create_thread`):
   - `routingMode: "unicast"`
   - `recipientAgentId`: architect's agentId (`list_available_peers(role="architect")` to confirm)
   - `correlationId`: mission-ID
   - `title`: `PR-review: <PR-title>`
   - `message`: PR URL + 1-line summary + CI status (running / green / red)
   - `semanticIntent`: `seek_approval`
2. Architect reads thread; uses `gh pr view <url>` + `gh pr diff <url>` to review
3. Architect leaves review via `gh pr review <url> --approve|--request-changes --body "..."`
4. Architect replies on the Hub thread when review lands: `approved` / `changes requested` + brief rationale; sets `converged: true` with `close_thread` action when review cycle completes
5. Engineer iterates on change-requests by pushing new commits (no new PR); re-notifies on thread if scope changes materially

**Option B deferred** — webhook → Hub bridge for autonomous PR-review triggering activates when Option A manual-notification friction reaches signal threshold (idea filed during ADR-023 ratification).

#### 2c.X — Anti-pattern: `kind=note` shortcut for architect→engineer actionable content

**Always use Option A thread protocol for architect→engineer actionable PR notifications.** Even for "small" or "doc-only" PR-review-requests, `kind=note` bypasses:

- (a) The render-template surface that knows how to format PR-review notifications. Mission-64 W4-followon Calibration #41 NEW: `kind=note` payload-rendering expects flat-body shape; structured payload silently degrades to "(empty note body)" with no caller-side feedback. Architect-side `create_message` returns clean `messageId`; engineer sees empty.
- (b) The dialogic thread-state that lets the recipient reply with concur/changes. Engineer-side `create_message` is intentionally absent from the tool surface (authority-boundary role-filter; broadcast notes are an architect/director surface, engineers operate dialogically via `create_thread_reply` + `create_thread`). Recipient has no return-path even when content renders cleanly.
- (c) The audit trail. A thread is more durable + reviewable than a one-shot note; per-PR coordination history lands in the thread record with `roundCount` + `convergenceActions` + `summary` provenance.

Mission-64 mission-day 2 (2026-04-29) surfaced the **methodology-bypass-becomes-substrate-defect amplification loop** as a named architectural-pathology pattern: `kind=note` shortcut + render-gap + no-engineer-return-path = silent actionable-content drop with bilateral blind-spot. Architect believes notification delivered (callback receives `messageId` successfully); engineer sees empty body; no round-trip detection. Captured as Calibration #41 NEW (substrate-class; tele-3 fidelity gap + tele-2 frictionless-collaboration gap; structurally closed via option (b) entry-point schema-validation at `create_message` so caller gets immediate feedback on render-incompatible payload — fold to idea-220 Phase 2).

**Discipline:** route all architect→engineer actionable content (PR-review-requests, decision-asks, blocker escalations) through Option A threads. Reserve `kind=note` for architect-broadcast-style content where (a) rendering is plain-text-body OR (b) bilateral round-trip is not required.

### Step 3 — CI + review gates

#### 3a. CI status checks

All PRs must pass the following checks before merge:
- `test.yml` — vitest + tsc on affected packages (existing gate from mission-41 T5)
- `secret-scan.yml` — filename-pattern check (T4 gate)
- Additional check suites as they land

#### 3b. CODEOWNERS approval

Branch protection requires CODEOWNERS approval. A PR touching `docs/methodology/*` requires architect-approval; `hub/src/*` requires engineer-approval; shared-surface files require both.

#### 3c. Review discipline

- **Review within 1 working day** of notification for non-urgent PRs; faster for blocking ones
- **Reviewer states explicit position**: `--approve`, `--request-changes`, or `--comment` (the last is not a gate-pass)
- **Author addresses every request-change comment** — either by code change or by thread-discussion reaching explicit agreement to defer
- **No rubber-stamp approvals on shared-surface files** — if a reviewer has no opinion on a shared-surface file, that's signal the PR needs a different reviewer, not a quick LGTM

### Step 4 — Merge via queue

Once all gates are green:

1. Author or reviewer adds PR to merge queue via `gh pr merge --auto --squash` (default strategy; see below)
2. Queue serializes landings; rebases + re-tests each PR against the previous queue head
3. On successful land: PR auto-closes; branch auto-deletes (or manual cleanup per engineer convention)
4. On queue-failure (CI regression after rebase): PR kicked back to author; investigate root cause

#### Default merge strategy: `--squash`

Rationale — prefer squash over merge or rebase for the v1.0 workflow:

- **Cleaner `main` history** — one commit per PR; `git log main --oneline` becomes a readable list of landed work rather than a soup of in-progress fixup commits
- **Commit-message = PR title + body** — GitHub fills the squash commit from PR metadata, which means the commit message is already reviewed + refined. The reviewer's approval signs off on the commit message too.
- **Per-PR `git bisect`** — a failing commit on main corresponds to exactly one PR, not half one. Regression triage is faster.
- **Fixup commits don't pollute main** — "oops typo", "address review comments", etc. disappear at squash time. They stay in the PR branch's reflog if history archaeology is ever needed.

Exceptions — consider `--merge` (preserve commits) only when:

- The PR contains logically distinct commits that each deserve independent bisectable landing. (Rare; usually means the PR should have been split.)
- The PR is genuine co-authored work where individual per-commit attribution matters for a retrospective audit.

Never use `--rebase`:

- GitHub's rebase-merge re-authors each commit (new timestamps, no merge record), losing the PR-as-audit-unit property
- Co-authors get lost in the rebase
- Branch-protection's required status checks show stale per-merged-rebased-commit, not the pre-merge PR tip — confusing for later debugging

#### Merge-queue failure recovery

When queue rebase surfaces a conflict or test regression:

1. Queue removes the PR automatically; PR state flips back to approval-pending with a "merge conflict" or "failing checks" banner
2. Engineer diagnoses:
   - **Transient flake** (e.g., a known-flaky test): wait a few minutes, then re-queue (`gh pr merge --auto --squash`)
   - **Rebase conflict**: pull current main, rebase locally, resolve, `git push --force-with-lease`, re-queue
   - **Real regression** (a test now legitimately fails because of interaction with PR-that-landed-ahead-of-you): fix the regression; push new commits; re-queue
3. **Scope-changed during conflict resolution**: re-notify the reviewer on the Hub thread. If the resolution required non-trivial work, consider whether approval is still valid — the reviewer may want to re-review.
4. **Open a fresh PR only if**: the conflict fundamentally changes the PR's intent, or the history got so tangled that a clean replay is easier than resolving. Add a `Replaces #<old-PR>` reference for audit trail.

Never: disable the failing test, add `--no-verify` to the merge, or direct-push to main to bypass the queue. Option C (§Director override) exists for legitimate queue-bypass; use that path if genuinely warranted.

### Step 5 — Post-land verification

#### 5a. CI green on main

The merge queue re-tests before landing, so post-land CI-red is rare. If it happens, treat it as a regression-incident:
- Identify root cause
- Revert via fresh PR (`gh pr create` on a revert branch; same workflow) — do **not** `git push --force` to main
- File a bug + follow-up fix PR

#### 5b. Branch cleanup

- Local: `git branch -D agent-<name>/<scope>` after confirming remote-delete landed
- Remote: auto-deleted by GitHub post-merge (configurable per-repo; v1.0 enables auto-delete)

#### 5c. Hub-state coherence

PR-land doesn't automatically advance Hub task state. The transition sequence is:

1. **PR lands on main** (via merge queue) — GitHub side is done; Hub is still showing the task as `working` or `in_review`
2. **Engineer files `create_report(taskId, report, verification)`** — body references the landed commit SHA + summarizes what shipped + includes verification output (test runs, smoke tests, CI screenshot). This flips Hub task state: `working → in_review`.
3. **Architect files `create_review(taskId, assessment, approved=true)`** — ratifies the engineering report against the brief's success criteria. This flips Hub task state: `in_review → approved`.
4. **Cascade auto-advances** (if the mission has more `plannedTasks`): Hub issues the next directive as a new `taskId` in sequence order. Engineer picks it up via `get_task`.
5. **Mission-close** (when the last `plannedTask` lands its approval): architect + engineer coordinate the end-of-mission merge-artifact (on sovereign-branch workflow) or the final PR-land (on trunk workflow); Director signals mission completion via `update_mission_status(active → completed)`.

**Who drives each step:**

| Step | Agent | Action |
|---|---|---|
| 1 | Merge queue | Land the PR on main |
| 2 | Engineer | `create_report` |
| 3 | Architect | `create_review(approved=true)` — or `approved=false` with request-changes |
| 4 | Hub cascade | Auto-issue next directive |
| 5 | Director | `update_mission_status` |

**Interaction with `plannedTasks` cascade:**

- Each `plannedTask` entry on the mission corresponds to one Hub task directive
- Directives are issued in `sequence` order; the cascade advances on `create_review(approved=true)`, not on PR-land
- **Known state-machine gaps** (observed during mission-45):
  - `plannedTasks` do not auto-spawn task directives on `update_mission_status(active)` — architect must issue the first directive explicitly
  - Duplicate directives can be issued if cascade advance state glitches — file a report on the duplicate pointing to the already-landed deliverable + let architect disposition via cancel-or-approve
  - File a bug if either gap recurs on subsequent missions

**Review-gate discipline:** every landed PR gets a `create_review` — even for trivial chore/docs commits. The review gate is the ratification surface, not the landing surface; skipping it erodes the per-task audit trail + leaves cascade advance in an ambiguous state.

---

## Adapter-restart rebuild protocol (Pass 10)

When a PR lands on main that touches Hub source, SDK source, or persisted-state schema, the running adapter+Hub installation does NOT auto-pick-up the change. A coordinated rebuild + restart sequence is required before any agent process resumes work post-merge. This protocol is the codification of the **Pass 10 rebuild sequence** referenced in mission-62 PRs #112 + #114 and mission-63 PRs #118 + #119.

The protocol is **adapter-restart-gating**: the next adapter restart after a covered PR merge MUST execute the steps below in order, OR the restart will fail (parse_failed, `agent_thrashing_detected`, or stalled CallTool gate).

### When this protocol applies

A PR triggers Pass 10 if **any** of the following are true:

| PR touches | Pass 10 step required | Mission-of-record |
|---|---|---|
| `hub/src/**` (Hub source) | **§A — Hub container rebuild** (calibration #17) | mission-62 W4 P0 |
| `packages/*/src/**` (SDK source — `@apnex/network-adapter`, `@apnex/cognitive-layer`, `@apnex/message-router`) | **§B — npm package republish + consumer `./scripts/local/update-adapter.sh`** (mission-64 W4 deprecation: manual recipe removed; npm package + script is canonical; closes calibration #25) | mission-63 W3 P0 (origin); mission-64 W4 (closed) |
| Persisted Agent / Mission / Thread schema (code-only renames) | **§C — State-migration script run** (calibration #19) | mission-62 W4 P0 |
| `adapters/*/src/**` (claude-plugin / vertex-cloudrun) | **§D — bundled in npm package `install.sh` path; consumer runs `./scripts/local/update-adapter.sh`** (mission-64 W4 deprecation: bundled in §B flow) | mission-61 Layer-3 (origin); mission-64 W4 (closed) |

PRs that touch ONLY documentation, methodology, audits, ADRs, or non-code surfaces do NOT need Pass 10.

**Forward-pointer — idea-221 (Pass 10 cross-§ orchestration runner; OPEN):** mission-64 mechanises §B + §D consumer-side. §A + §C remain operator-side (Hub rebuild + state-migration). idea-221 is the companion future mission scope: an operator-side runner that auto-detects affected §s + sequences §A→§B→§C→§D in a single call, consuming mission-64's CLI contract (`./scripts/local/update-adapter.sh` exit codes 0/1/2/3 + structured stdout final-line + `--pin <version>` + `--dry-run` flags). Until idea-221 ships, §A + §C remain manual operator steps.

**Out of scope for Pass 10:** PR-rebase hygiene (stale-branch-against-current-main) is a separate concern not covered by §A–§D. Pass 10 protocol assumes the merging branch is rebased onto current `origin/main` (mergeStateStatus=CLEAN); a DIRTY/CONFLICTING merge state is a per-PR pre-merge concern handled by the standard rebase + force-push-with-lease sequence (Step 4 merge-queue failure recovery above), not by Pass 10's adapter-restart sequencing.

### §A — Hub container rebuild (calibration #17)

```bash
scripts/local/build-hub.sh        # Cloud Build; ~1m26s typical
scripts/local/start-hub.sh         # restart container on freshly-built image
```

**Verification:** `docker ps | grep ois-hub-local-prod` shows the new image SHA256. Hub log first line confirms boot timestamp post-rebuild. `curl -s localhost:8080/mcp` returns the canonical envelope shape (or expected error envelope).

**Why required:** Hub container does NOT auto-rebuild on Hub-source PR merge. A restart on the stale image preserves pre-merge Hub code regardless of how many times the container restarts. Mission-62 W4 P0 (smoking gun layer 1) is the canonical incident — image built ~8h before PR #112 merged; restart on stale image surfaced as `engineerId`-not-`agentId` deployment skew.

### §B — SDK package update (mission-64 W4: **Removed; npm package + script is canonical**)

**Manual recipe removed.** `mission-64` (M-Adapter-Streamline) ships the canonical mechanism: published `@apnex/claude-plugin` npm package family + `scripts/local/update-adapter.sh` ergonomic frontend. Calibration #25 (mission-63 W4 origin; manual-recipe step-skip-class regression) closed structurally via `workspace:*` placeholder + version-rewrite-at-publish-time + version visibility surfaces (handshake `agent.advisoryTags.adapterVersion`; npm-installed; runtime-stamped; update-script self-report). See ADR-029 (Adapter update is consumer-self-serve via npm-published packages + script-driven local install).

**Canonical consumer-side flow:**
```bash
./scripts/local/update-adapter.sh
# OR (manual / external consumers without local checkout):
npm install -g @apnex/claude-plugin@latest
"$(npm prefix -g)/lib/node_modules/@apnex/claude-plugin/install.sh"
# Then full adapter restart
```

**Verification:** `npm ls -g @apnex/claude-plugin --depth=0` reports installed version; adapter restart shows `agent.advisoryTags.adapterVersion = "<expected>"` in handshake response (no `parse_failed` events in `.ois/shim-events.ndjson`).

**Calibration #29 NEW (mission-64 W0 spike) — npm 11.6.2 EUNSUPPORTEDPROTOCOL on `workspace:^/*`:** npm does NOT support yarn-invented `workspace:` semver-protocol. Use placeholder `"<sibling-pkg>": "workspace:*"` in source-tree `package.json` files + explicit `version-rewrite.js` script that rewrites `workspace:*` → `^<sibling-published-version>` pre-publish. Do NOT assume `workspace:^` works on npm.

**Calibration #35 NEW (mission-64 W1+W2-fix-2; PR #124) — version-rewrite hoist into orchestration script:** `npm publish --workspace=X` uses workspace's OWN lifecycle hooks, NOT root's `prepublishOnly`. Hoist the rewrite call into `scripts/publish-packages.sh` orchestration directly with trap-based revert; do NOT rely on root lifecycle to run rewrites. See `feedback_npm_workspace_lifecycle_quirk.md`.

**Repo-side discipline (workspace authoring):** PRs touching `packages/network-adapter/src/**` (or any other SDK workspace) ship version bumps + republish via `scripts/publish-packages.sh` (topological dep-walk: leaves first; dependents second). `scripts/test/full-end-to-end-install.test.sh` exercises actual `claude plugin install` end-to-end and is required CI for substrate PRs (calibration #37 close). For first-canonical-publish to a fresh registry namespace, expect ~3 publish iterations to resolve packaging defects (file presence, source-format compat, version-pinning mechanism); see `feedback_substrate_introduction_publish_iteration.md`.

**Adjacency to mission-61 Layer-2/Layer-3 lesson + mission-63 calibration #25:** SDK-tgz-stale (mission-63 W3 P0) and `file:` refs not surviving `npm pack` (mission-61 Layer-3) are both closed structurally by the npm-publish channel — `file:` refs eliminated from publish chain; manual SDK rebuild eliminated by registry-pinned semver resolution at install-time.

### §C — State-migration script run (calibration #19)

When a PR renames or restructures persisted entity fields (Agent, Mission, Thread, Task, etc.), the persisted state on local-fs (or GCS in cloud deployments) does NOT auto-migrate. The PR MUST ship a one-shot idempotent migration script under `scripts/migrate-*.ts` and the operator MUST run it Hub-stopped before adapter restart.

**Required script invariants:**
1. **Hub-stopped self-check** — script verifies `curl localhost:8080/mcp` returns ECONNREFUSED before mutating state (prevents concurrent-write race).
2. **Backup-before-mutation** — tarball snapshot of current state at `/tmp/<entity>-pre-<migration-name>-<ts>.tar.gz`.
3. **Idempotent** — re-running on already-migrated state is a no-op; per-record migration logic checks for new-shape fields before writing.
4. **Fallback discipline** — for fields renamed-and-restructured (mission-63's `name = id` fallback for legacy records lacking the new field), script applies the fallback explicitly rather than leaving fields undefined.
5. **PR description includes operator-runbook section** — `## Operator runbook` block with stop-Hub command, run-migration command, restart-Hub command, verification steps, and rollback path.

**Why required:** Code-only renames (TS-LSP-equivalent rename in source + tests) leave persisted state with old field names. New code reads `agent.id` (= undefined when state has legacy `engineerId`); response builders drop the field via JSON.stringify undefined-omission; downstream parsers return null; CallTool gate stalls. Mission-62 W4 P0 (smoking gun layer 2) is the canonical incident.

**Reference implementations:**
- `scripts/migrate-canonical-envelope-state.ts` (mission-63 W3) — Agent record `name = id` fallback + clientMetadata/advisoryTags default
- `scripts/migrate-engineerId-to-id.ts` (mission-62 W4 ad-hoc; not committed; superseded by canonical-envelope script) — primary key + by-fingerprint index files migration

### §D — claude-plugin reinstall (mission-64 W4: **Removed; bundled in npm package install.sh path**)

**Manual recipe removed.** `mission-64` ships `install.sh` as a bundled file inside `@apnex/claude-plugin` (path: `$(npm prefix -g)/lib/node_modules/@apnex/claude-plugin/install.sh`); `scripts/local/update-adapter.sh` invokes it after `npm install`. Two-step separation: npm = artifact distribution; script = system-side install action. **NOT** postinstall-driven (security/idempotency/scope-coupling concerns; ADR-029 anti-goal §4.2 #7).

**Canonical consumer-side flow:** identical to §B above — `./scripts/local/update-adapter.sh` drives both npm fetch + install.sh invocation in one command.

Mission-61 Layer-3 lesson (canonical-tree shim binary stale; `file:` refs don't survive `npm pack`) is closed structurally — the published tarball ships pre-built `dist/` + bundled `install.sh` + `marketplace.json` (calibration #36 NEW: source format requires `"./"` trailing-slash, NOT `"."` or `".."` — see `feedback_marketplace_source_format.md`).

### Coordination — who runs Pass 10

| Pass 10 step | Driven by | When |
|---|---|---|
| §A Hub rebuild | Whoever merged the Hub-source PR (architect or engineer) | Immediately after merge; before notifying peer agents to restart |
| §B SDK rebuild + tgz repack | Whoever merged the SDK-source PR | Immediately after merge; before notifying peer agents to restart |
| §C State-migration | Operator (Director typically) | Hub-stopped between rebuild + adapter restart |
| §D claude-plugin reinstall | Each agent in their own session, OR operator coordinating restart | After §A/§B/§C complete |

**Bilateral coordination pattern:** for missions where both agents need to restart (substrate-affecting PRs), open a coordination thread with sub-status updates per Pass 10 step (`§A complete; §B complete; §C complete; safe to restart`). Director-coordinated full-restart cycle is the typical recovery posture.

### Verification post-Pass 10

After all applicable steps complete + adapter restart:
1. **Handshake parses cleanly** — no `agent.handshake.parse_failed` events in `.ois/shim-events.ndjson`
2. **`claim_session` returns in normal time** — typical <100ms; stalls or timeouts indicate residual gap
3. **First LLM-driven tool call lands** — typical Hub-side log shows `[Dispatch]` event for the call response
4. **Self-dogfood test** — for substrate-affecting PRs, run a substrate-self-dogfood verification thread (mission-lifecycle.md §6.1; mission-63 W4 thread-403 is the canonical second-execution example)

If any step fails, do NOT proceed with mission work. Hold-on-failure is the discipline; investigate via shim observability (`.ois/shim.log` + `.ois/shim-events.ndjson`); fix-forward; re-run Pass 10 from the failed step.

### Forward-pointer: thread_message truncation marker (calibration #26 NEW from mission-63 W4)

Mission-63 W4 substrate-self-dogfood surfaced a Hub-side gap: `thread_message` event envelopes are silently truncated at ~250 chars with no marker. Other event types (`message_arrived` pulse + `thread_convergence_finalized`) render full body verbatim — the truncation is `thread_message`-event-type-specific.

This is **not a Pass 10 step** (it's not a deployment-skew or rebuild concern); it's a low-priority Hub-side envelope-builder design gap. **Future fix surface:** Hub-side `thread_message` envelope-builder either (a) embeds marker token at truncation boundary OR (b) adds `<channel>` attribute `truncated="true" fullBytes="<n>"`. Design + implementation deferred to **idea-220 Phase 2**; tracking via `docs/audits/m-wire-entity-convergence-w4-validation.md` calibration #26 narrative.

Pass 10 protocol does NOT require operator action for this gap; it's documented here as a forward-pointer so future PR work touching `thread_message` envelope generation knows to address marker-spec design.

---

## Review discipline — deeper

### Review scope by CODEOWNER

| If the reviewer is… | Focus the review on… |
|---|---|
| Architect (docs/methodology, ADRs, shared specs) | Semantic alignment with concepts + tele; spec-level correctness; no code-diving unless a spec claim can't be validated otherwise |
| Engineer (code, tests, scripts) | Implementation correctness; test coverage; regression risk; local invariants |
| Shared-surface reviewer | Both angles — the file's code-level correctness AND its cross-system implications |

### Review vs self-merge

- **Never merge your own PR** — the queue enforces this via CODEOWNERS approval
- Exception: Director on Option C override (commit message `[override]` prefix; post-mortem thread within 48h)

### Stale PRs

Baseline review SLA (refine after mission-43 retrospective):

| PR urgency | Review SLA | Nudge cadence | Escalation |
|---|---|---|---|
| **Non-urgent** (default) | 1 working day | +2 days idle → thread-nudge (`intent: decision_needed`) | +5 days idle → Director via thread |
| **Urgent** (explicitly marked; typically gated on mission-active state) | 4 working hours | +1 working day idle → thread-nudge | +2 working days idle → Director |
| **Blocking queue of other PRs** | Same as urgent | Additional `queue:block` signal via thread | Same as urgent |

Nudges on the Hub thread are low-overhead — use them freely; the reviewer may be heads-down on other work and simply lost track. A nudge is not an accusation; it's a re-surfacing of the signal.

Close-vs-nudge decision:

- **PRs idle >7 working days without activity** get closed (author reopens if work resumes). Closing is not a rejection; it's housekeeping.
- Exception: PRs blocked on external infrastructure (upstream dep, merge-queue failure, CI regression) stay open until the external block clears.

Expect to revisit after first dozen real PRs. Likely pressure points:

- Cross-time-zone agent teams (not an issue at N=2 colocated agents; becomes one at Phase 4 scale-out)
- PRs blocked on external CI/infra — treat as Director escalation surface, not a reviewer-nudge surface

---

## PR artifact conventions (canonical)

### Branch naming

- `agent-<name>/<scope>` — per-task work
- `env/<scope>`, `scripts/<scope>`, `docs/<scope>` — type-prefixed for non-agent-specific maintenance
- `director/<scope>` — Director-authored PRs

### Commit message prefixes (same vocabulary as mission-41)

- `[mission-XX]` — work tied to a specific mission
- `[env]` — environment/dependency changes
- `[scripts]` — local tooling + helper scripts
- `[docs]` — doc-only changes
- `[fix]` — bug fixes (standalone; mission-scoped fixes use `[mission-XX]`)
- `[chore]` — maintenance (lint, rename, etc.)
- `[override]` — Director-override commits (Option C)
- `[merge]` — merge-commit messages (rare under trunk-based; used only when a genuine merge-commit lands via queue)

### PR labels (optional; v1.0 doesn't mandate)

v1.0 ships without labels — at N=2 agents + mission-45 scale, labels add noise if under-used. Proposed taxonomy for v1.1 activation **if PR-volume growth reveals triage pain**:

**Auto-applied (via a `.github/workflows/labels.yml` that parses PR title on open/edit):**

- `mission:XX` — parsed from `[mission-XX]` prefix
- `type:env` / `type:scripts` / `type:docs` / `type:fix` / `type:chore` / `type:override` — parsed from type-prefix
- `merge-commit` — for rare `[merge]` prefix (direct-merge landing, used only during methodology migration bridges)

**Author-applied (via PR body or `gh pr edit --add-label`):**

- `priority:urgent` — explicitly-urgent PRs (drops review SLA to 4 working hours per §Stale PRs)
- `queue:block` — PR is gating other work; reviewer nudged faster

**Reviewer-applied as review signals:**

- `needs-director` — escalation out of normal review cadence

Implementation estimate: ~40 LOC of workflow YAML if activated. Not a v1.0 priority because:

- Zero labels > low-signal labels
- v1.1 can fold in after 1–2 missions show whether triage pain is real
- The Hub thread-notification surface already carries the urgency signal on a per-PR basis — labels duplicate that at a lower fidelity

---

## Option C (Director override) — escape hatch

Named explicitly so operators know when it's appropriate vs when it's a shortcut.

### Criteria — Director-override IS appropriate when

- **Prod-outage response** requires immediate main-branch fix (bypass queue; fix lands; post-mortem PR reconstructs review within 48h)
- **Queue infrastructure failure** — merge queue itself broken (fallback: direct-push by Director only, pending infrastructure repair)
- **Methodology bootstrap** — the first use of a new workflow methodology may itself require override (the doc doesn't yet enforce itself)
- **Sovereign-branch mission completion** — missions started before trunk-migration may complete on old workflow (see §Migration, below)

### Director-override is NOT appropriate when

- "We didn't want to follow the process" (use the process)
- "The CODEOWNERS check blocked us" (get the CODEOWNER's review)
- "We were in a hurry" (PR workflow adds ~10 minutes, not days)
- Recurring bypass pattern (if Option C becomes frequent, re-author the methodology)

### Director-override commit format

- `[override]` prefix in commit subject
- `Reason: <rationale>` in commit body
- `Post-mortem: <link-to-thread-or-TBD>` reference
- Post-mortem thread within 48 hours of the override

---

## Migration from sovereign-branch-per-agent (ADR-023 phase map)

Four-phase migration per ADR-023:

- **Phase 1** — Infrastructure ship (mission-45). CODEOWNERS + branch protection + merge queue + secret-scan + pre-commit + this doc + env-setup doc. **Phase 1 executes on the old sovereign-branch workflow** (bootstrap paradox — the new workflow isn't in effect yet when the scaffolding ships).
- **Phase 2** — First validator mission on new workflow (mission-43). Real-use test of the scaffolding.
- **Phase 3** — Formal deprecation of sovereign-branch. Add Superseded header to `multi-branch-merge.md` (landed as part of mission-45 T6b). This doc becomes sole source of truth.
- **Phase 4** — Scale-out to N>2 agents. Zero-cost under new workflow; scaffolding handles it.

### Missions started pre-migration

If a mission was mid-flight when the migration landed:
- **Finish on the old workflow** if it's within one mission-close of complete (don't re-start the work)
- **Re-route to new workflow** if it's multi-week + multi-task; cut a new branch from current main; re-base as PRs

---

## Failure modes + recovery

### PR stuck waiting for review

- First: confirm reviewer has been notified via Hub thread (Option A MVP) and hasn't responded
- Second: thread-ping the reviewer with explicit escalation cue (`decision_needed` intent)
- Third: if still stuck >2 working days, Director ratifies via PR comment (not Option C override — just direct escalation)

### Merge conflict with main during queue

- Queue auto-rebases; if rebase fails, PR returns to author
- Author resolves conflict locally, force-pushes-with-lease to the PR branch
- Re-notifies reviewer on thread if conflict resolution changed scope meaningfully
- Re-queues

### CI regression on main (post-land)

- Revert PR immediately (fresh `[fix]` or `[revert]` PR; same workflow)
- File a bug
- Follow-up fix PR addresses root cause
- Never `git push --force` to main (even post-revert, use a revert-commit)

### CODEOWNERS gate-failure (no primary owner available)

- If the CODEOWNER is offline/disconnected for >1 working day, escalate to Director via thread
- Director can add themselves as temporary reviewer for critical PRs
- Don't try to reassign CODEOWNERS mid-PR; amend CODEOWNERS in a separate PR

### Agent departure — CODEOWNERS lapse

When an agent leaves the pool permanently (role retires, personnel change, Phase 4 scale-out redistribution):

1. **Director signals the departure explicitly** — a thread or update_mission note stating which agent is being retired + when + whether the role itself continues
2. **Open a coordination thread** (`title: "CODEOWNERS reassignment — <agent> departure"`, `intent: decision_needed`, `semanticIntent: seek_consensus`)
3. **Decide reassignment strategy:**
   - **Simple case** (role continues, new agent takes over): CODEOWNERS file unchanged — team-level ownership (`@<org>/<role>`) insulates the file from single-agent churn; Director updates GitHub team membership to swap the retiring agent for the new one
   - **Split case** (role retires; surfaces distributed to other roles): architect PR amending CODEOWNERS; shared-surface rows absorb previous-role's directories; review follows normal workflow
   - **Sunset case** (role retires + surfaces become shared): architect PR amending CODEOWNERS to remove the team references; affected directories fall back to the `*` catch-all (co-author sign-off) or get named-to a remaining role
4. **Chicken-and-egg**: if the departing agent's role was the CODEOWNER for `docs/methodology/*` (the file being amended), the amendment can't be self-approved. Director ratifies via **Option C override** (§Director override) with a post-mortem thread.
5. **Prevention**: keep CODEOWNERS at team-level granularity, never per-user. Single-agent churn is absorbed by team-membership swap; only role-level retirement requires file edits.

---

## Anti-patterns (do not do)

- **Direct push to main** — blocked by branch protection; if you find yourself wanting to, ask why; if legitimate, Option C with post-mortem
- **Rubber-stamp approvals on shared-surface files** — shared-surface review requires engagement
- **Stacked PRs without declaring the dependency** — if PR-B depends on PR-A, say so in PR-B's body + target PR-B at PR-A's branch, not main (until PR-A lands)
- **Bypass husky with `--no-verify` without explanation** — bypass is permitted; silent bypass is not
- **Merge own PR** — queue enforces; don't try to work around CODEOWNERS
- **Landing a PR that doesn't match its stated scope** — PRs should do what they say; scope creep → split into multiple PRs
- **Force-push to main** — ever (see §Recovery §CI regression)
- **Long-lived PR branches** — branches should live ~hours to ~2 days; longer means the PR is too big (split it)

---

## Relationship to other methodology documents

- **`strategic-review.md`** — triages backlog + ratifies mission priorities; operates pre-mission-activation
- **`mission-preflight.md`** — activation gate between proposed → active; per-mission audit
- **This doc** — per-PR integration gate; operates continuously through a mission's active phase, not only at mission-close
- **`multi-branch-merge.md` (Superseded)** — historical reference for the sovereign-branch-per-agent model; see its header for the Superseded-by pointer

Together, these cover the full mission lifecycle — backlog triage → mission activation → per-PR integration → mission close — on the new workflow.

---

## v1.0 ratified-with calibrations (2026-04-25)

The DRAFT → RATIFIED transition is informed by 5 missions of worked-example evidence (mission-43 validator + mission-46 multi-env + mission-47 sovereign-storage + mission-49 audit/notification migration + mission-48 local-fs cutover). The following calibrations are bedded in and ratified into v1.0.

### Auto-merge as default-on (calibration A)

Mission-47 retrospective §3.1 committed to per-PR auto-merge (`gh pr merge --auto`) as the mechanical fix for stacked-PR-cadence drift. Mission-49 + Mission-48 attempted `gh api -X PATCH ... allow_auto_merge=true` and it 403'd against the repo (current gh tokens lack repo-admin scope). Manual `gh pr merge --squash --delete-branch` per-PR worked at ~3-min wall-clock per turnaround under direct architect-engineer thread coordination. **v1.0 ratifies:** prefer auto-merge when repo settings permit; fall back to manual squash-merge with `--delete-branch` flag without further consultation. Architect targets <5min approve+merge from CI-green per PR.

### Fresh-off-main per task (calibration B)

Mission-49 and Mission-48 explicitly avoided stacked-PR cadence via fresh-off-main per task. **v1.0 ratifies:** stacked-PR is an explicit exception requiring scope justification in the PR body; default is fresh-off-main per task with cherry-picked trace + task commits in a 2-commit PR.

### Director-input filter (calibration E)

Coordination thread engagement defaults to architect-engineer pair-resolution; escalation to Director only for: scope decisions, methodology choices, budget/priority calls, genuine ambiguity. **v1.0 ratifies:** thread `intent: director_input` is the explicit escalation surface; routine coordination stays bilateral. Director ownership of operational coordination (per Director direction 2026-04-25 — "I need you to coordinate all outstanding PR and closure activities directly with greg") is now the default cadence pattern, not the exception.

### Bug-31 bypass technique — skip-plannedTasks

Mission-49 fired bug-31 variant-1 twice (cascade-duplicate plannedTask) + variant-2 once (timeout-disrupts-atomicity). Mission-48 ran without `plannedTasks` deliberately, manually issuing each task — zero cascade duplicates over 6 tasks. **v1.0 ratifies:** missions activate without `plannedTasks` field until bug-31 is structurally fixed; architect manually issues each task as the prior approves. Mission entity description retains the full task plan from `propose_mission` cascade. Memory: `feedback_plannedtasks_manual_create_mismatch.md`. Sunset clause: bypass deprecates when bug-31 fix lands (idea-192 absorbs the cascade-bookkeeping work).

### Thread maxRounds=20 for ≥4-task PR-coordination missions

Mission-48 needed mid-mission thread rotation (thread-306 → thread-307) because default `maxRounds=10` was hit at PR #5/6 of 6. **v1.0 ratifies:** at coordination-thread open-time, set `maxRounds` proportional to expected exchange volume (~2× task count + 4); default 10 remains fine for design-round threads (3-5 rounds typical) but is too low for per-PR coordination in 4+ task missions. Sunset clause: rotation discipline becomes obsolete when idea-192's inbox primitive removes the round-cap class entirely.

**Mission-64 reinforcement (calibration #31 NEW):** thread-407 (W1+W2 atomic dispatch) hit `maxRounds=10` mid-cycle; superseded by thread-408. Two complementary disciplines surfaced:
- **Pre-push artifact discipline:** for Design v0.1+ round-1 audit threads, push the design artifact to remote BEFORE opening the audit thread — engineer's round-1 review otherwise reads stale local content. Mission-64 surfaced this when the round-1 audit thread referenced design v0.1 sections that hadn't been pushed yet.
- **maxRounds budgeting for substrate-introduction missions:** active-session 6-step coordination (mission-64 §3 sub-protocol) compounds round usage when N substrate-defect cycles surface during ship — set `maxRounds` proportional to (~3× expected fix-PR count + 4). Mission-64 thread-409 ran 9/10 rounds across 3 publish iterations (0.1.0 → 0.1.1 → 0.1.2).

### W3 dogfood collapse pattern (substrate-introduction mission-class signature)

**Mission-64 calibration #34 NEW — mission-lifecycle integration note:** for substrate-introduction missions where W3 is observation-only AND the substrate IS the consumer-facing surface itself, W3 collapse-into-W1+W2-fix is the canonical pattern when active-session 6-step protocol surfaces a substrate defect during Step 5 install. The retry IS the dogfood gate; a separate W3 thread would re-run the same active-session 6-step against the same substrate without distinct architectural value.

Distinct from missions where W3 verifies a different surface than W1+W2 ships (e.g., mission-63 substrate-self-dogfood with separate W4 verification thread because the wire-shape contract could be observed post-rebuild without consumer install). Mission-class signature: substrate-introduction whose dogfood IS the install path → W3 collapse default; structural-inflection on internal substrate where dogfood is observational → separate W4 verification thread default.

### Methodology-bypass-becomes-substrate-defect amplification loop (architectural-pathology pattern)

**Mission-64 W4-followon (post-mission thread-412 post-mortem) — named pattern.** When a methodology-prescribed protocol (here: Option A thread for architect→engineer PR-review-request) is bypassed in favor of a "lighter-weight" alternative (here: `kind=note`), the bypass path can compose with substrate-level rendering + tool-surface gaps to produce **silent actionable-content drop with bilateral blind-spot**. Diagnostic signature:

1. **Architect-side believes the action succeeded** — `create_message` returns clean `messageId`; no error feedback
2. **Engineer-side sees content degrade silently** — render-template doesn't know the payload shape; "(empty note body)" rendered
3. **No return-path** — engineer-side `create_message` is intentionally absent (authority-boundary role-filter); recipient cannot reciprocate even if rendering had succeeded
4. **No round-trip detection mechanism** — no Hub-side ack-or-nack signaling that lets architect-side discover the failure

The amplification: **methodology-bypass + render-gap + no-return-path = silent actionable-content drop**. None of the three components alone is a defect (each has legitimate non-bypass uses); their composition is the architectural pathology.

**Forward-discipline:** when surfacing future calibrations in this class, test for the three-component composition:
- (1) Was a methodology-prescribed protocol bypassed?
- (2) Does the bypass path interact with a render-template-registry incompleteness or schema-validation gap?
- (3) Does the bypass path cross a tool-surface authority boundary that breaks return-path?

If yes to all three → file as **architectural-pathology** class (worth a named calibration) rather than three independent methodology/substrate/tool-filter calibrations.

Mission-64 calibration #41 NEW (kind=note rendering bilateral-blind defect) is the canonical example. Structurally closes via option (b) schema-validation at `create_message` entry-point — fold to idea-220 Phase 2 (architect-lean closure path; closes the bilateral-blind class at the input boundary by surfacing render-incompatible payloads to the architect-side caller via Hub error response, which breaks the amplification loop's component (4)).

### Post-event narration AEST/UTC date conflation discipline (calibration #42 NEW)

**Mission-64 W4-followon (post-mission thread-414 round 2 surface).** Authoring docs in AEST timezone (UTC+10) leads to timeline entries that mix AEST date with UTC `Z` suffix, producing dates ~1 day forward of actual UTC event time. Diagnostic signature: events that occurred 2026-04-28T22:13Z UTC (= 2026-04-29T08:13 AEST) get authored as "2026-04-29 ~22:13Z" in retrospective doc — wrong UTC date with right Z-suffix discipline.

**Discipline:** for post-event narration in `docs/audits/`, `docs/reviews/`, `docs/decisions/`:
- **Timeline tables use UTC consistently** — Z-suffix attached only to UTC timestamps
- **Never mix** AEST calendar date with UTC time-of-day-suffix
- **Acceptable alternatives** when UTC-only is awkward: (a) explicit AEST qualifier with no Z (e.g., "2026-04-29 ~08:13 AEST"); (b) parenthetical conversion ("2026-04-28T22:13Z UTC = 2026-04-29T08:13 AEST"); (c) authoring-meta + event-meta separation (header "authored 2026-04-29 AEST"; body "events 2026-04-28 UTC")

Lineage: pre-existing project memory `project_session_log_timezone.md` notes the same skew applies to work-trace entries (~10h forward AEST vs UTC). Calibration #42 surfaces the discipline applies broadly to post-event docs, not just work-traces.

Mission-64 retrospective `docs/reviews/m-adapter-streamline-retrospective.md` (PR #129; greg-flagged via thread-414 round 2) is the canonical fixup example: UTC-consistency restored across §2 timeline + §3 commitments + Closing § via fixup commit pre-merge. Forward-discipline: future retrospectives + audits use UTC-throughout in timeline tables.

### ADR-amendment scope discipline

Mission-48 T1 amended ADR-024 with §6.1 reclassifying local-fs from dev-only to single-writer-laptop-prod-eligible. The amendment was deployment-context reclassification, NOT a contract change. **v1.0 ratifies:** ADR amendments classify by *what they change*. Contract-change amendments require a new ADR (or numbered version-bump per project convention). Deployment-context amendments (where to use the contract, under what operational discipline) sit cleanly as in-place §Amendments sections on the existing ADR. The distinction matters for forward-compatibility audits.

### β-split methodology — split-when-scope-creeps

Mission-48 design-round Flag #1 surfaced material hidden scope (Audit/Notification migration prerequisite) that would have bundled poorly into the cutover mission's tele framing. Director ratified β-split: spawn mission-49 as prerequisite, sequence both. Both shipped clean in single ~13-hour session. **v1.0 ratifies:** when design-round surfaces material hidden scope, default is split-into-sequential-missions (β) over bundle-into-one (α). Bundling is the explicit exception requiring justification (typically: scope coupling is so tight that splitting would re-do work). Tele cleanliness, narrow debug surface, and pattern-preservation are the load-bearing arguments for β.

### Pattern-replication sizing calibration

Three worked-example data points:
- Mission-47 W1-W7: 4-5 eng-days estimated; ~1 day actual
- Mission-49 W8-W9 + closing: M-low (1-1.25 eng-days) estimated; ~5.5h actual
- Mission-48 6 tasks: M estimated; ~6h actual

**v1.0 ratifies:** when sizing a mission whose primary character is "apply established pattern X to N entities/configurations," size at S not M; budget design-round cost separately as fixed up-front cost. Pattern-replication missions trend to the lower edge of the sizing band — sometimes substantially below it.

### Pre-classified CI debt accelerates PR cadence

Mission-49 PR #21 triaged cross-package adapter CI failures + filed as bug-32 same-day. All subsequent PRs (mission-49 + mission-48 = 9 total) rode the pre-classification — no fresh triage required. Per-PR turnaround dropped from ~5min (PR #21 with triage) to ~3min (PRs #22-#29 without). **v1.0 ratifies:** CI debt should be classified as a bug the moment it's triaged; subsequent PRs ride pre-classification for free. The architect's first-occurrence triage cost (~5min) amortizes across the whole mission flow at zero ongoing cost.

### Cross-package Cloud Build context (bug-33 carry-forward)

Mission-48 redeploy attempt 2026-04-25 surfaced bug-33 (cross-package Cloud Build context excludes sovereign-package deps). Mission-47 retrospective §3.3 documented the trap class but the comprehensive fix never landed because Cloud Build wasn't actually exercised. **v1.0 acknowledges:** Cloud Build is a separate test surface from GitHub Actions CI; redeploy gating on actual Cloud Build execution is required per code-shipping mission. idea-198 (M-Cloud-Build-Tarball-Codification) is the Tier 0 fix; idea-186 (npm workspaces) is the structural fix.

---

## Methodology evolution

Treat as engineered component — version, critique, evolve.

### v1.1 pending deltas

To be captured post-Tier-1 workflow-primitives missions (idea-191 + idea-192) and post-CD-pipeline mission (idea-197):
- Bug-31 bypass deprecation timing (post-idea-192 fix)
- Thread maxRounds discipline deprecation (post-idea-192 inbox primitive)
- Auto-merge re-attempt (post-repo-admin-grant or post-idea-197)
- Cross-package CI architecture rationalization (post-idea-186 workspaces)
- Hub-redeploy-on-merge integration (post-idea-197)

### Retrospective cadence

Follow the retrospective-lite pattern from `strategic-review.md` §Retrospective-of-the-Review:
- **Retrospective-lite** (same-PR-session, optional): methodology deltas while context is fresh
- **Formal retrospective** (mission-outcome-triggered): fold into this doc's next version

5 missions on the new workflow have produced retrospectives at `docs/reviews/mission-{43,46,47,49,48}-retrospective.md` (or equivalents). Calibrations above were synthesized from missions 47/48/49 retrospectives + this session's strategic discussion.

---

## Success criteria for a PR

A PR is successful if:

1. All CI gates pass (test + secret-scan + any others)
2. CODEOWNERS approvals acquired (primary + shared-surface if applicable)
3. Merge queue land is clean (no rebase conflicts surfaced)
4. Post-land CI on main stays green
5. Hub-state updated to reflect landed work (task transition, review creation, etc.)
6. Branch cleanup complete (local + remote)
7. Any scope-drift or follow-up items filed as ideas / bugs, not dropped

A PR review is successful if:

1. Review left within review-cadence SLA (1 working day non-urgent)
2. Explicit position stated (`--approve` or `--request-changes`)
3. Shared-surface review engages with cross-system implications, not just the diff
4. Request-changes items are actionable (author knows what to change)

---

## Engineer co-authorship — complete (2026-04-23)

All previously-marked `TODO(engineer)` sections have been filled:

| Section | Content filled | Status |
|---|---|---|
| §Step 1a branch creation | git command sequence with `--ff-only` safety; worktree-vs-single-clone guidance; stacked-branch handling | ✅ |
| §Step 2a push command | `-u` upstream tracking; `--force-with-lease` policy with when-and-when-not discipline | ✅ |
| §Step 4 merge strategy | `--squash` default + rationale + exceptions; explicit ban on `--rebase` | ✅ |
| §Step 4 queue-failure recovery | transient/rebase/regression paths; scope-change re-notification; fresh-PR-vs-same-PR call | ✅ |
| §Step 5c Hub-state transition | 5-step post-land sequence, driver-per-step table, cascade/`plannedTasks` interaction, observed state-machine gaps | ✅ |
| §Stale-PR nudge cadence | SLA table (urgent / non-urgent / blocking-queue), nudge cadence, close-vs-nudge decision, pressure-points to watch | ✅ |
| §PR labels | v1.1 taxonomy proposal (auto / author / reviewer tiers), implementation estimate, explicit v1.0 skip rationale | ✅ |
| §CODEOWNERS-gap escalation | agent-departure process (simple / split / sunset cases), chicken-and-egg Option-C escape, team-level granularity prevention | ✅ |

v1.0 DRAFT → v1.0 RATIFIED transition completed 2026-04-25:
- ✅ Architect reviewed engineer fills for spec-alignment
- ✅ Mission-43 (first worked example on new workflow) shipped + retrospective-lite landed
- ✅ Mission-46 / 47 / 49 / 48 produced four additional worked examples
- ✅ Calibrations from missions 47/48/49 captured in §v1.0 ratified-with calibrations
- v1.1 deltas tracked via §Methodology evolution

---

*Methodology v1.0 RATIFIED 2026-04-25. Authored 2026-04-23 per ADR-023 Phase 3 direction. Mission-45 T6a artifact. Engineer co-authorship completed 2026-04-23. Architect spec-alignment review + worked-example validation across 5 missions completed 2026-04-25. Calibrations from missions 47/48/49 captured in §v1.0 ratified-with calibrations.*
