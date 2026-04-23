# Multi-Agent PR Workflow — Methodology

**Status:** v1.0 DRAFT (2026-04-23). Architect-drafted skeleton + engineer co-authorship on execution-side sections complete (2026-04-23; see §Engineer co-authorship). Awaiting architect final-review + mission-43 worked-example before promoting to v1.0 ratified. Supersedes `docs/methodology/multi-branch-merge.md` per ADR-023 Phase 3. First worked example: mission-43 (ADR-023 Phase 2 validator).
**Scope:** reusable procedure for agents collaborating via trunk-based development with PR-gated integration. Replaces the sovereign-branch-per-agent + periodic-merge model.
**Supersedes:** `docs/methodology/multi-branch-merge.md` v1.0 (retained as historical reference; see its Superseded header).

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

## Methodology evolution

Treat as engineered component — version, critique, evolve.

### v1.0 → v1.1 pending deltas

To be captured post-mission-43 (the first worked example on new workflow):
- Any unanticipated review-cadence friction
- Any CODEOWNERS gap or false-trigger
- Any merge-queue behavior that surprised
- Option A → Option B transition signal (when does thread-notification friction hit the threshold?)

### Retrospective cadence

Follow the retrospective-lite pattern from `strategic-review.md` §Retrospective-of-the-Review:
- **Retrospective-lite** (same-PR-session, optional): methodology deltas while context is fresh
- **Formal retrospective** (mission-outcome-triggered): fold into this doc's next version

First retrospective expected after mission-43 close.

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

v1.0 DRAFT → v1.0 ratified transitions when:
- Architect reviews the engineer fills for spec-alignment
- Mission-43 (first worked example on new workflow) ships + retrospective-lite lands
- Any v1.1 deltas surface as edit-queue for the next rev

---

*Methodology v1.0 DRAFT authored 2026-04-23 per ADR-023 Phase 3 direction. Mission-45 T6a artifact. Awaiting engineer co-authorship on marked sections; first worked example is mission-43 (Phase 2 validator). Graduates to v1.0 ratified when engineer sections filled + mission-43 ships on new workflow.*
