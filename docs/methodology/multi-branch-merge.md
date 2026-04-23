# Multi-Branch Merge — Methodology

> ⚠ **Superseded** (per ADR-023 Phase 1, 2026-04-23) by [`docs/methodology/multi-agent-pr-workflow.md`](./multi-agent-pr-workflow.md). Retained as historical reference + procedural guide for any mission that *began* on the sovereign-branch-per-agent workflow and must complete on it (e.g., mission-45 itself, per the ADR-023 bootstrap-paradox). All new missions starting post-mission-43 (ADR-023 Phase 2 validator) execute on the trunk-based PR workflow. Phase 3 formalizes full deprecation once 2-3 missions ship on the new workflow.

**Status:** v1.0 worked-example complete (2026-04-23). **Superseded by [`multi-agent-pr-workflow.md`](./multi-agent-pr-workflow.md)** per ADR-023. Architect-drafted; engineer co-authored `TODO(engineer)` execution sections. First (and final representative) worked example: mission-41 merge (see `docs/missions/mission-41-merge.md`).
**Scope:** reusable procedure for unifying divergent sovereign-branch work into main. Applies only to in-flight missions that began on this workflow; no new missions adopt this pattern.

## Purpose

A **multi-branch merge** is the codified procedure for unifying work from sovereign agent-branches (e.g. `agent/greg`, `agent/lily`) into `main`. It exists because multi-agent collaboration produces parallel development streams that must periodically converge. Without methodology, each merge becomes a Director-override event; with methodology, merges are predictable + safe + auditable.

This methodology is the **third pillar** in the mission lifecycle, alongside:
- `docs/methodology/strategic-review.md` — backlog triage + mission prioritization (pre-mission)
- `docs/methodology/mission-preflight.md` — activation gate (proposed → active)
- **This doc** — merge-to-main gate (active → merged)

## When to use this methodology

- **Mission completion** requires unifying agent-branches into main
- **Multi-mission batch close** (more than one completed mission accumulated on agent branches)
- **Periodic housekeeping merge** (preventing branch-divergence from accumulating beyond reasonable reconciliation)
- **First merge after CI-gate ship** (debut-run event; this methodology applies)

## When NOT to use

- Single-branch work (no divergence = no methodology)
- Mid-mission (branches stay sovereign until mission close; merge comes at completion)
- Prod-outage response (Option C Director-override explicitly applies; see §Director-override)
- Trivial single-commit hotfixes to main (conventional git-commit suffices)

## Roles

| Role | Responsibility | Default loading |
|---|---|---|
| **Architect** | Owns methodology field-ownership (this doc); drives pre-merge conflict analysis; architect-side branch merge execution; drafts merge-artifact | Claude Code session as architect |
| **Engineer** | Owns execution-side sections (marked `TODO(engineer)` in this doc); engineer-side branch merge execution; post-merge verification (hub-side test runs + regression check) | Claude Code session as engineer |
| **Director** | Ratifies strategic merge timing; watches Option C escape-hatch authority; post-merge review (not per-merge; retrospective-triggered) | Human |

### Directory ownership — veto authority

The core conflict-resolution primitive. Each directory (or file pattern) has a **primary owner** + **veto authority**.

| Directory / pattern | Primary owner | Veto authority | Conflict resolution |
|---|---|---|---|
| `docs/methodology/*` | Architect | **Architect** | Architect's version wins unless engineer flags for co-review |
| `docs/traces/*` | Engineer | **Engineer** | Engineer's version wins unless architect flags for co-review |
| `docs/reviews/*` | Architect | **Architect** | Architect-authored; engineer proposals only via thread |
| `docs/planning/*` | Architect | **Architect** | Mission-brief drafts live here |
| `docs/decisions/*` (ADRs) | Architect | **Architect** | ADRs are architect-led |
| `docs/audits/*` | Shared | **Co-author sign-off** | Cannot unilaterally merge; requires thread-ratification if conflict. Closing audits often have mixed ownership (engineer-drafted content + architect observations) |
| `docs/specs/*` | Shared | **Co-author sign-off** | Sovereign system truth; neither party unilaterally modifies |
| `docs/missions/*` | Mixed by file | **Per-file** | `*-preflight.md` architect; `*-kickoff-decisions.md` architect; `*-merge.md` engineer; preserve file-author intent |
| `hub/src/*`, `adapters/*/src`, `packages/*/src` | Engineer | **Engineer** | Code surface |
| `hub/test/*`, `adapters/*/test`, `packages/*/test` | Engineer | **Engineer** | Test surface (including invariant tests) |
| `hub/scripts/*`, `adapters/*/scripts` | Engineer | **Engineer** | Operational scripts |
| `.github/workflows/*` | Shared | **Co-author sign-off** | CI gate; affects both sides |
| Root configs (`package.json`, `tsconfig.json`, `vitest.config.ts`, lockfiles) | Shared | **Co-author sign-off** | Cross-package effects |
| `start-*.sh`, session-local scripts | Local (per-session) | **Owner-of-session** | Must not be committed to shared branches; treated as [env]/[scripts] pre-merge drift |

**Resolution escalation:**
1. Author(s) resolve per veto authority
2. On ambiguity, open a thread with `semanticIntent: collaborative_brainstorm` to reach bilateral agreement
3. If still ambiguous, Director ratifies (Option C escape hatch)

## Procedure

### Step 0 — Load context

- Read this methodology document
- Read the relevant mission closing audits (e.g. `docs/audits/m-*-closing-report.md`) for the missions being merged
- Review `git log merge-base..HEAD` on each branch to understand divergence scope
- Identify shared-surface files via `git diff --name-only merge-base` + directory-ownership map

### Step 1 — Pre-merge checklist (6 categories)

Execute each category. Record PASS / FAIL / N/A per item in the merge artifact (`docs/missions/<mission-id>-merge.md` or `docs/history/<date>-merge.md` for multi-mission batches).

#### A. Review completeness

| # | Check | Fail mode |
|---|---|---|
| A1 | All mission tasks have `status=completed` | Active tasks → merge premature |
| A2 | All tasks have architect-side `create_review(decision=approved)` landed | Unreviewed work → review gate not cleared |
| A3 | No `in_review` or `revision_required` tasks linger on the mission | Mid-review state = not mergeable |
| A4 | Mission entity itself has `status=completed` | Mission-state inconsistent with task-state |

#### B. Branch hygiene

| # | Check | Fail mode |
|---|---|---|
| B1 | `git diff --quiet` on each branch (clean working tree) | Uncommitted drift would contaminate merge |
| B2 | Local `HEAD` in sync with `origin/<branch>` for pushed branches | Unpushed work loses peer visibility |
| B3 | No uncommitted env/scripts drift (lockfiles, local scripts, `start-*.sh`) | Must commit separately with `[env]`/`[scripts]` prefix BEFORE merge, OR stash, OR exclude |
| B4 | Pre-merge tags created on each branch (`<branch>-pre-merge-<YYYY-MM-DD>`) | Rollback path must exist |
| B5 | Pre-merge tag created on main (`main-pre-<mission-or-batch>-merge`) | Main rollback path |

#### C. CI status per branch

Execute on **every sovereign branch** being merged (not just the merge target):

| # | Check | Method | Fail mode |
|---|---|---|---|
| C1 | Per-package vitest clean on each branch | `cd <pkg> && npm test` in each of: `hub`, `packages/cognitive-layer`, `packages/network-adapter`, `adapters/claude-plugin`, `adapters/opencode-plugin`. Record pass counts + skipped counts | Any FAIL: merge is not eligible; fix on branch first |
| C2 | Per-package `tsc --noEmit` clean | `cd <pkg> && npx tsc --noEmit` in each package (or `npm run build` if that's the typecheck route) | TypeScript errors: merge is not eligible |
| C3 | No test-count regression vs branch pre-commit state | Compare current pass-count to the pre-merge-baseline recorded in the mission's closing audit (if applicable); regression = PR-blocker equivalent | Regression: investigate; regression-fix commit before merge |
| C4 | Post-first-merge: GitHub Actions gate is active on `origin/main` | Verify `.github/workflows/test.yml` runs the 5-package matrix + the `coverage-report-sync` job on the merge commit. First post-CI-ship merge is the debut-run event (see §CI-gate debut protocol) | Workflow not triggered: check workflow-file presence on main |

**Pre-first-CI-ship exception:** before `.github/workflows/test.yml` has landed on main, C1–C3 run locally only (no GitHub Actions infrastructure to exercise). This exception expires on first post-gate merge.

#### D. Scope analysis (directory ownership + conflict surface)

| # | Check | Method |
|---|---|---|
| D1 | Directory ownership map generated | `git diff --name-only <merge-base>..<branch>` per branch; categorize by the §Directory ownership table above |
| D2 | Shared-surface conflicts identified | Cross-reference both branches' file lists; surfaces appearing in both are conflict candidates |
| D3 | Per-conflict resolution approach pre-decided | For each conflicting shared-surface file: (a) veto-authority resolution path OR (b) thread-ratification required |

**Conflict-resolution artifact:** merge-artifact includes a table per conflicting file with columns: *File / Primary-owner / Resolution approach / Rationale*.

#### E. Merge-path choice

| # | Option | When appropriate |
|---|---|---|
| E1 | **Option A** — per-task review → direct merge (default) | All tasks per-task-reviewed; review gate cleared; proceed to mechanical merge |
| E2 | **Option B** — integration branch + single-diff review | Batch-review shape: many small approved tasks where architect wants single-diff-against-main visibility; engineer merges to `integration` branch; architect reviews the integration-vs-main diff; approval triggers squash/fast-forward to main |
| E3 | **Option C** — Director override (escape hatch, see §Director-override for criteria) | Explicit; not the default |

Choice + rationale documented in the merge artifact.

#### F. Rollback preparation

Pre-merge tags (B4 + B5) define the rollback targets. Exact sequence:

```bash
# ── LOCAL ROLLBACK (before push) ──
git checkout main
git reset --hard main-pre-<mission-or-batch>-merge
# Working tree returns to pre-merge main exactly.

# ── POST-PUSH ROLLBACK (destructive; Director-override territory) ──
# Only if main has already been pushed and the breakage is severe.
# Requires explicit Director ratification + [override] commit per §Director-override.
git push --force-with-lease origin main
# Post-mortem thread required within 48h of the force-push.
```

**Hub-state implications** — git rollback does NOT automatically reverse Hub state:

| Rollback effect on git | Hub state remains | Reconciliation action |
|---|---|---|
| Commits removed from main | Task `status=completed` persists | If rollback undoes shipped task work: manual review; possibly `update_turn` or `create_bug` to capture divergence |
| Mission-status flip commit removed | `mission.status=completed` persists | Architect re-evaluates; either re-merge with the fix or file a bug + `update_mission` back to active (Director ratification) |
| Bug-fix commit removed | `bug.status=resolved` + `fixCommits=[<now-orphaned-SHA>]` persists | `update_bug` to clear `fixCommits` + flip `status=open` (engineer authority) |
| Audit/idea/spec commits removed | Ideas + audit entities persist in Hub storage | No Hub action needed; re-merge recovers the docs |

**"What gets lost" analysis:** rollback is work-destructive for any post-tag commits. Always enumerate the specific commits being discarded in the rollback decision — log them in the merge artifact under Category F before force-pushing.

### Step 2 — Execute merge

#### Option A path (per-task review → direct merge, default)

1. **Merge order** — **fewer-shared-surface-conflicts-first heuristic:**

   ```bash
   # Enumerate shared-surface files per branch:
   git diff --name-only <merge-base>..agent/greg > /tmp/greg-files
   git diff --name-only <merge-base>..agent/lily > /tmp/lily-files
   comm -12 <(sort /tmp/greg-files) <(sort /tmp/lily-files) > /tmp/shared
   # Categorize /tmp/shared per §Directory ownership table.
   # Count shared-surface entries per branch.
   ```

   **Rule:** the branch with fewer shared-surface files merges FIRST. Rationale: the second-branch author inherits the resolution burden for shared-surface conflicts involving first-branch's just-merged work; fewer-first minimizes total conflict surface on the second merge.

   **Tie-breaker:** if shared-surface counts are equal or ambiguous, architect branch merges first (methodology + brief + decision files typically change less per commit than code surfaces).

   **Document choice + rationale** in merge artifact Category E with the actual file-counts.

2. **First branch → main**:
   - Checkout main; pull latest
   - `git merge --no-ff <first-branch>` with explicit merge commit message `[merge] <branch> into main (<mission-or-batch-ref>)`
   - Resolve any main-vs-branch conflicts per directory-ownership rules
   - Push main
3. **Second branch → main**:
   - `git merge --no-ff <second-branch>`
   - Resolve conflicts per directory-ownership rules (second-branch conflicts typically involve first-branch's just-merged work on shared surfaces)
   - **Conflict-resolution rule**: second-branch's author is responsible for resolving + committing with `[merge]` commit message naming both parties
   - Push main
4. **Post-merge verification** per Step 3 below

#### Option B path (integration branch + single-diff review)

Integration-branch workflow for bulk-review-shape missions:

1. **Engineer creates integration branch** from latest main:
   ```bash
   git checkout main && git pull
   git checkout -b integration/<mission-or-batch-ref>
   ```
2. **Engineer merges sovereign branches onto integration** (in fewer-conflicts-first order per Option A heuristic):
   ```bash
   git merge --no-ff <first-branch>       # conflicts resolved per directory ownership
   git merge --no-ff <second-branch>      # conflicts resolved per directory ownership
   ```
   Commits accumulate on integration; sovereign branches remain untouched.
3. **Engineer opens a thread titled** `"Integration branch ready for review: <mission-or-batch-ref>"` unicast to architect with `semanticIntent: seek_approval`. Thread body includes:
   - Link to integration branch (`origin/integration/<mission-or-batch-ref>`)
   - `git diff main..integration/<mission-or-batch-ref>` summary (files changed; lines added/removed; directory-ownership breakdown)
   - Conflict-resolution log (which files conflicted; resolution applied)
4. **Architect reviews** the single unified diff against main:
   ```bash
   git diff main..integration/<mission-or-batch-ref>
   # or via GitHub PR equivalent if remote-reviewing
   ```
5. **On architect approval** (via thread bilateral convergence):
   ```bash
   git checkout main
   git merge --ff-only integration/<mission-or-batch-ref>
   git push origin main
   ```
   Fast-forward-only enforces a linear history from main's tip; if ff-only rejects, integration diverged from main since step 1 and needs rebasing.
6. **Post-merge cleanup:**
   ```bash
   git branch -d integration/<mission-or-batch-ref>            # local
   git push origin --delete integration/<mission-or-batch-ref> # remote
   ```
   Sovereign branches (`agent/greg`, `agent/lily`) preserved per Category I.

**Use Option B when:**
- Architect prefers single-diff review over N-per-task reports (cognitive-load reduction for large missions)
- Many small approved tasks where per-task merge-commit noise > integration-diff clarity
- Mission close has cross-cutting changes that benefit from unified review before merge
- Multi-mission batch closes (e.g. mission-41 + mission-42 together)

**Do NOT use Option B when:**
- Tasks shipped asynchronously over a long period (bulk-diff loses temporal context of per-task review decisions)
- Merge urgency is low and the per-task cadence is fine (integration adds ceremony without value)
- Architect review of each task's report has already surfaced all the decisions that would happen in a bulk diff (re-review is redundant)

#### Option C path (Director override — escape hatch)

See §Director-override.

### Step 3 — Post-merge verification

#### G. Merge correctness

| # | Check | Fail mode |
|---|---|---|
| G1 | CI green on `origin/main` (debut-run for first merge post-CI-gate) | CI regression indicates merge introduced a break |
| G2 | All mission tasks remain `status=completed` in Hub | Merge shouldn't change Hub state; if it does, investigate |
| G3 | Audit cross-refs in merged artifacts resolve (all referenced commit SHAs exist on `main`) | Orphaned SHAs mean rebase-lost commits |
| G4 | `docs/audits/*` closing audit references match merged commit SHAs | Audit-vs-git drift |

#### H. Pre-merge drift resolution

Verify that any `[env]` / `[scripts]` pre-merge drift commits (per Category B3) landed correctly and did not contaminate the mission merge:

| # | Check | Method | Fail mode |
|---|---|---|---|
| H1 | `[env]` / `[scripts]` commits present in the merged branch | `git log origin/main --grep='\[env\]\|\[scripts\]' --since=<pre-merge-tag-date>` lists them | Drift commits missing: drift came in through the merge commit itself (anti-pattern violated) |
| H2 | Drift commits are SEPARATE from merge commits | `git log --merges origin/main` cross-ref against drift commit SHAs; drift SHAs should NOT appear under merge parents | Drift bundled into merge commit: retrospective log-only; acceptable once, fix methodology adherence next time |
| H3 | Working tree clean post-merge | `git diff --quiet` on main post-push (and on sovereign branches post-rebase) | Drift reappeared: a file the pre-merge drift commits thought they'd captured is still drifting. Investigate (usually indicates lockfile regen at build time) |
| H4 | Lockfile changes match `package.json` intent | Inspect `git diff <merge-base>..main -- '**/package-lock.json'` against `package.json` diffs. Unchanged `package.json` + changed lockfile = drift-induced regen (investigate) | Arbitrary lockfile regen: file as follow-up idea; recommend `npm ci` vs `npm install` discipline in the merge-performer's environment |

**Drift reappearance is the subtle failure mode** — the pre-merge drift commit captures the lockfile state at that moment, but running `npm install` or package rebuilds after the pre-merge-drift commit can silently re-drift the lockfile before the actual merge. H3 + H4 catch this.

#### I. Branch preservation

Post-merge, sovereign branches are preserved to origin for provenance + re-baselined at next-mission cadence:

**Sequence:**

```bash
# 1. Push each sovereign branch to origin (preserves provenance)
git push -u origin agent/greg           # creates origin/agent/greg if it doesn't exist
git push origin agent/lily              # updates existing origin/agent/lily

# 2. Tag pre-merge branch heads for historical reference
git tag agent/greg-pre-merge-<mission-id> agent/greg
git tag agent/lily-pre-merge-<mission-id> agent/lily
git push origin --tags

# 3. Re-baseline sovereign branches at next mission activation (RECOMMENDED)
#    — discards merged commits; next mission's commits start from current main baseline
git checkout agent/greg
git fetch origin main
git reset --hard origin/main
git push --force-with-lease origin agent/greg
# Repeat for agent/lily

# 4. Worktree adjustments (if using git worktrees per the standard setup):
#    — verify the worktree's branch pointer matches the intended baseline
#    — specifically for the greg + lily worktrees at separate directories,
#      run the reset INSIDE the relevant worktree, not from the main repo
```

**Re-baseline timing:** ideally at next mission activation. Keep-alive (Option b) is permissible for short gaps (≤ 1 week between missions); after that, divergence grows and accumulates conflicts for the next merge.

**Force-with-lease vs force:** prefer `--force-with-lease` — refuses to overwrite remote if someone else pushed in the interim, whereas `--force` is unconditional.

**Local branch housekeeping after re-baseline:**
- Local branch HEAD matches main post-reset; no deletion needed
- Optionally clean up local tags older than N mission cycles: `git tag --list '*-pre-merge-*' | xargs git tag -d` (keep the most recent; older tags preserved on remote via step 2)

**DO NOT:**
- Delete sovereign branches from origin post-merge (loses provenance; cold-engineer readers can't reconstruct which commits came from which branch)
- Force-push without `--force-with-lease` (race condition with any concurrent push)
- Leave branches >1 mission-cycle without re-baseline (divergence grows; next merge becomes harder)

#### J. Follow-up ideas from debut-run CI issues

If the CI gate's debut-run (first real post-merge run) surfaces issues, file follow-up ideas via `create_idea` tagged `ci-debut-issue` + the mission-ref. Do not block subsequent merges on these unless they're regression-critical.

### Step 4 — File the merge artifact

Commit the merge artifact to `docs/missions/<mission-id>-merge.md` (or `docs/history/<date>-multi-mission-merge.md` for batch merges). Architect + engineer co-sign in the artifact header (both agentIds + timestamps).

Artifact shape:

```markdown
# <Mission-ID> Merge Artifact

**Date:** YYYY-MM-DD
**Mission(s) merged:** mission-41 (+ mission-42 if batch, etc.)
**Option chosen:** A | B | C
**Rationale:** <why>
**Architect:** <agentId>  **Engineer:** <agentId>
**Pre-merge tags:** <list>
**Merge commits:** <SHAs>
**Post-merge main SHA:** <SHA>

## Category A — Review completeness
- A1..A4 per-check outcome

## Category B — Branch hygiene
...

## Category C — CI status

## Category D — Scope analysis
### Shared-surface conflicts
| File | Primary owner | Resolution | Rationale |
|---|---|---|---|
| ... | ... | ... | ... |

## Category E — Merge-path choice
<Option chosen + rationale>

## Category F — Rollback preparation
<Tags + commands>

## Merge execution log
<Commands run; conflicts encountered; resolutions applied>

## Category G — Merge correctness
- G1..G4 per-check outcome

## Category H — Pre-merge drift
<if any>

## Category I — Branch preservation
<post-merge state>

## Category J — CI debut + follow-up ideas
<list>

## Director ratification
<if applicable; Director signature + date>
```

## Director-override (Option C) escape hatch

Named explicitly so operators know when it's appropriate vs when it's a shortcut.

### Criteria

Director-override IS appropriate when:
- **Prod-outage response** requires immediate main-branch fix
- **Review cadence broken** by external factor (engineer disconnected mid-cadence; architect unavailable)
- **Emergency rollback** of recent main changes (via revert + push)
- **First-run bootstrap** where the methodology itself doesn't yet exist (e.g., this doc's own first application)

Director-override is NOT appropriate when:
- "We didn't want to follow the process" (use the process)
- "The conflicts looked hard" (resolve per directory ownership; escalate via thread)
- "We were in a hurry" (methodology adds ~1-2h, not days)
- Recurring bypass pattern (if Option C becomes a default, re-author the methodology)

### Director-override commit format

Director-override commit messages must include:
- `[override]` prefix in commit subject
- `Reason: <rationale>` in commit body
- `Post-mortem: <link-to-thread-or-TBD>` reference

Subsequent post-mortem thread is required within 48 hours of the override; captures what forced the override + whether the methodology needs a delta.

## CI-gate debut protocol

The **first merge** to main after `.github/workflows/test.yml` ships triggers the first real CI-gate run. This is a debut event.

**Debut-run responsibilities:**
- The merger (architect or engineer, per Option A/B) watches the first CI-gate run on `origin/main`
- Any failure surfaced on debut-run produces a follow-up idea (per Category J)
- If the failure is regression-critical (breaks an existing test that was passing pre-merge), merger authors a fix before the next merge proceeds
- If the failure is merely debut-surfaced (a test that was never running in CI before, now failing), follow-up idea suffices; merge stands

**Debut-run is a one-time event** per CI surface. After the first run, subsequent merges operate under a fully-active CI gate.

## Failure modes + recovery

### Merge conflict escalation (can't resolve at directory-ownership level)

- Open a thread with `semanticIntent: collaborative_brainstorm`, title `Merge conflict: <file>`
- Both branch authors co-propose resolution
- If consensus not reached within reasonable bounds (~2 rounds), Director ratifies (Option C-adjacent, but scoped to the specific conflict)

### CI fails on post-merge main

- If failure is pre-existing + debut-surfaced: per §CI-gate debut
- If failure is merge-introduced: roll back via pre-merge main tag (Category F); investigate; re-merge with fix

### Task state inconsistency (Hub says completed but code disagrees)

- Trust Hub as source of truth; investigate whether merge lost commits
- If commits lost: rollback + re-merge with commit-preservation
- If code doesn't match mission scope: file a bug; do not retroactively adjust Hub state

### Branch divergence beyond reasonable merge scope

- If branches have diverged so much that conflict resolution would take >1 day: **merge sooner next time**
- Current-situation recovery: break the merge into sub-merges (per-directory or per-file); each sub-merge follows the methodology; re-baseline between sub-merges

## Anti-patterns (do not do)

- **Merge before reviews approved** — skips the gate; task-state inconsistency risk
- **Option C as default path** — Director-override is the escape hatch, not the norm. If it's becoming frequent, re-examine why and update methodology
- **Unilateral merge on shared-surface file** — bypasses veto authority; requires re-merge with co-author
- **Pre-merge drift committed into merge commit** — env/scripts drift must be separate [env]/[scripts] commits BEFORE merge
- **Deleting sovereign branches post-merge without push-to-origin** — loses provenance; cold-readers can't reconstruct history
- **Cherry-pick as primary merge strategy** — commits should merge with history intact; cherry-pick loses SHA-continuity and complicates audit cross-refs
- **Force-push to main** — ever, without Director-override + rollback-prep; main history is shared

## Relationship to other methodology documents

- **`strategic-review.md`** — triages backlog + ratifies mission priorities; operates pre-mission-activation
- **`mission-preflight.md`** — activation gate between proposed → active; per-mission audit
- **This doc** — merge-to-main gate between active-completion → merged; per-merge-event audit
- Together: these three cover the full mission lifecycle from backlog-to-main-branch

## Methodology evolution

Treat as engineered component — version, critique, evolve.

### v1.0 pending deltas

To be captured post-mission-41-merge (the first worked example):
- Any unanticipated conflict-resolution needs
- Any Category check that proved insufficient or excessive
- Any directory-ownership ambiguity that surfaced
- Debut-CI-run learnings

### Retrospective cadence

Follow the retrospective-lite pattern from `strategic-review.md` §Retrospective-of-the-Review:
- **Retrospective-lite** (same-merge-session, optional): methodology deltas while context is fresh
- **Formal retrospective** (mission-outcome-triggered): fold into this doc's next version

First retrospective expected after mission-41 merge.

## Success criteria for a merge

A merge is successful if:

1. Main passes CI post-merge (including debut-run for first post-gate merge)
2. All pre-merge task states survive (Hub state unchanged by the merge)
3. Audit cross-refs resolve (commit SHAs valid on main)
4. No follow-up rollback required (no regression introduced)
5. Merge artifact filed at `docs/missions/<mission-id>-merge.md`
6. Sovereign branches preserved to origin (provenance intact)
7. Any debut-surfaced CI issues captured as follow-up ideas

## Co-authorship status

v1.0 sections filled:
- §Step 1 Category C (CI status per branch) — engineer-filled (2026-04-23)
- §Step 1 Category F (Rollback preparation) — engineer-filled (2026-04-23)
- §Step 2 Option A path item 1 (Merge order heuristic) — engineer-filled (2026-04-23)
- §Step 2 Option B path (integration branch cadence) — engineer-filled (2026-04-23)
- §Step 3 Category H (Pre-merge drift resolution verification) — engineer-filled (2026-04-23)
- §Step 3 Category I (Branch preservation post-merge) — engineer-filled (2026-04-23)

Architect-drafted core + engineer-co-authored execution sections. First worked example: mission-41 merge (see `docs/missions/mission-41-merge.md`).

---

*Methodology v1.0 authored 2026-04-23 per Director direction via thread-268 ratification; architect-drafted structure + engineer co-authored execution sections via thread-269. First worked example is mission-41 merge. Graduates to v1.1 on post-merge retrospective if methodology deltas surface.*
