# Mission: M-Trunk-Migration-Infrastructure *(draft)*

**Status:** Draft — ready to file as `proposed` per ADR-023 ratification 2026-04-23. Awaits Director release-gate signal for `update_mission(status="active")` following Hub-filing.
**Type:** Mission brief draft.
**Mission class:** Infrastructure scaffolding for ADR-023 Phase 1. Last mission on current sovereign-branch workflow; subsequent missions execute on new PR workflow per ADR-023.

---

## Name

**M-Trunk-Migration-Infrastructure** (ADR-023 Phase 1 scaffolding)

---

## Tele served

| Tele | Role | Why |
|---|---|---|
| tele-3 Sovereign Composition | primary | Every module (Hub, adapters, agents) gains standardized PR-gated integration contract; boundary discipline goes from methodology-enforced to tooling-enforced |
| tele-6 Frictionless Agentic Collaboration | primary | Eliminates the per-task-nudge + per-merge-coordination overhead; agents coordinate via main, not via bilateral threads |
| tele-2 Isomorphic Specification | secondary | CODEOWNERS mechanizes directory-ownership spec; runtime-reality parity on ownership enforcement |
| tele-7 Resilient Agentic Operations | secondary | Branch protection + CI gates prevent merge-time class of errors (subdirectory gitignore bypass from mission-41 is canonical example) |

**Tele-leverage score: 4.**

---

## Concept-grounding (Phase 3 register)

- **Sovereign Composition (§2.3)** — primary. Current sovereign-branch model optimizes Sovereign Composition at git-branch layer but pays coordination cost. PR workflow pushes sovereign-composition into commit-level granularity; reinforces concept without requiring long-lived branches.
- **Layered Certification (§2.7)** — primary. Adds an additional certification layer: CI gate + CODEOWNERS gate + branch protection. Complements existing per-task review + merge-artifact gate.
- **Manifest-as-Master (§2.4)** — secondary. CODEOWNERS file is the manifest that makes directory ownership mechanically enforceable; before it, ownership was methodology-text-only.

---

## Goal

Ship **6 infrastructure artifacts** that enable the migration from sovereign-branch-per-agent to trunk-based-with-PR workflow per ADR-023. Mission is **infrastructure-only**; no agent-adapter changes; no existing mission migration. Subsequent missions (starting with mission-43 as Phase 2 validator) execute on the new shape.

**Pool-enabling rationale:** infrastructure investment; subsequent missions 43/42/44 + invariant-coverage follow-ups all ship faster + cleaner on the new workflow. Mission-41's 57-commit merge pain doesn't recur.

---

## Scope

Mission ships in **single batch of 6 tasks** (flat structure; all share infrastructure-scaffolding shape; no cross-task DAG dependency):

### Task 1 — `.github/CODEOWNERS` file

File encoding the directory-ownership + veto-authority table from multi-branch-merge.md §Roles. Primary vs shared surfaces named. PR merges require appropriate approvals.

Success:
- File exists at `.github/CODEOWNERS`
- All directory patterns from multi-branch-merge.md §Roles represented
- Test-PR verifies auto-assignment works

### Task 2 — Branch protection rules on `main`

Configure via GitHub repository settings (or `.github/settings.yml` if using `probot/settings` app):
- Require PR before merge
- Require CODEOWNERS approval
- Require CI status checks
- Require linear history
- Disable force push / deletion

Success:
- Rules active on GitHub
- Direct push to main fails (verified via deliberate-fail attempt)
- PR-to-main works with correct gates

### Task 3 — Merge queue enablement

Enable GitHub-native merge queue on main branch:
- Queue PRs post-approval + CI-green
- Rebase + re-test before landing
- Serialize land order

Success:
- Merge queue active
- Test-PR lands via queue (not direct merge)

### Task 4 — Secret-scan CI workflow

Author `.github/workflows/secret-scan.yml`:
- Runs on PR push + push to main
- Pattern-check for dangerous filenames (`*.tfvars`, `*.tfstate*`, `*.env*`, `*.pem`, `*.key`, `credentials.*`, `*.private.*`)
- Optional: integrate `gitleaks` or similar for content-level scanning (v1.1 consideration; v1.0 filename-check suffices)
- Fails PR if matched

Success:
- Workflow exists + runs on PR
- Deliberate-fail test (add sensitive filename to PR) blocks merge
- Clean PR passes

### Task 5 — `.husky/pre-commit` hook

Pre-commit hook enforcing:
- Filename pattern check (same list as secret-scan CI for consistency)
- Fail commit with clear message if matched

Install via `.husky/` convention so it ships in-repo:
- `.husky/pre-commit` script file
- `.husky/_/husky.sh` helper (if husky-native install used)
- OR simpler: `.git/hooks/pre-commit` stub + `scripts/setup-hooks.sh` that copies

Engineer judgment on shape at implementation.

Success:
- Hook active for agents after one-time `scripts/setup-hooks.sh` or `npm run prepare`
- Deliberate-fail test (stage sensitive filename) blocks commit
- `--no-verify` bypass still possible (but audit-visible)

### Task 7 — Environmental prerequisites documentation

New doc at `docs/setup/architect-engineer-git-env.md` covering agent-local environment setup for new workflow.

Content:
- **gh CLI install + auth** — per-environment install path (`brew install gh`, `apt install gh`, etc.); `gh auth login` one-time authentication; verification step (`gh auth status`)
- **PR review flow (Option A v1.0 MVP)** — engineer opens PR via `gh pr create`; sends Hub thread_message with PR URL + CI status; architect reads via `gh pr view` + leaves review via `gh pr review --approve|--request-changes --body "..."`; replies to Hub thread when done
- **Web UI fallback** — when `gh` unavailable (ephemeral environments, etc.); URL-based flow
- **PR artifact conventions** — PR title format including mission-ID + task-ID reference; PR body template; branch naming convention (`agent-<name>/<scope>`)
- **Troubleshooting** — common gh auth errors; permission issues; token rotation

Engineer-authored; architect reviews for workflow-alignment. Lives in new `docs/setup/` directory (may be repo's first such directory — confirm convention at implementation time).

Success:
- `docs/setup/architect-engineer-git-env.md` committed
- Both architect + engineer environments have gh CLI installed + authenticated
- Verified via deliberate-test (architect opens a no-op PR; engineer reviews it; lands via queue)

### Task 6 — Methodology v1.0 + multi-branch-merge v2.0

Two related docs:

**6a. `docs/methodology/multi-agent-pr-workflow.md` v1.0**
- Authored architect-drafted skeleton (similar shape to multi-branch-merge.md v1.0 authorship)
- Engineer co-authors execution-side sections per Phase 4 co-authoring pattern
- Covers: PR workflow, CODEOWNERS map, branch protection, merge queue discipline, per-PR review cadence, PR artifact templates, failure modes

**6b. `docs/methodology/multi-branch-merge.md` v1.1 → v2.0 retirement**
- Add header: **Status: v1.0 worked-example complete; Superseded by `docs/methodology/multi-agent-pr-workflow.md` per ADR-023 Phase 3 completion**
- Retain v1.0 content as historical reference
- Edit queue from 2026-04 retrospective (10 v1.1 deltas) absorbed into the new workflow doc rather than v1.1 of the old one
- Per ADR-023 Phase 3: deprecation formalized when 2-3 missions ship on new workflow

Success:
- Both docs committed
- Cross-references in the old doc point to the new
- Engineer co-authorship on new methodology completes

### Out of scope

- **GitHub-webhook → Hub bridge for autonomous PR-review triggering** (Option B per ADR-023 §PR-review-triggering-model) — filed as follow-up idea during ADR ratification; activates when Option A manual-notification friction reaches signal threshold. NOT in this mission.
- **Agent-adapter PR integration** (agents communicating via GitHub API internally) — separate follow-up mission if/when it becomes the bottleneck; v1.0 workflow allows agents to execute via standard `git` + `gh` CLI + Hub thread for PR-review triggering (Option A MVP)
- **Mission-43 Phase 2 validation** — different mission; happens after this one
- **Sovereign branch deprecation** — ADR-023 Phase 3; formalized after validator mission confirms workflow
- **Third-party merge queue tooling** (`mergify`/`bors`/`Kodiak`) — GitHub-native queue suffices for v1.0 scale
- **gitleaks or content-level secret scanning** — v1.1 consideration; filename-check is primary for mission-41's observed failure class
- **Branch protection on agent-feature-branches** — only `main` protected; feature branches stay flexible

---

## Success criteria

1. `.github/CODEOWNERS` committed + verified via test-PR auto-assignment
2. `main` branch protection active + verified via direct-push-blocked test
3. Merge queue enabled + verified via queued-PR landing test
4. `secret-scan.yml` CI job runs + verified via deliberate-fail blocked PR
5. `.husky/pre-commit` hook blocks sensitive filenames + verified via deliberate-fail commit
6. `multi-agent-pr-workflow.md` v1.0 committed + engineer co-authored + cross-referenced from (now-Superseded) multi-branch-merge.md
7. **End-to-end validation:** a canonical test-PR exercises the full workflow (branch → PR → CODEOWNERS assignment → CI → approval → queue → land → branch-delete)
8. Hub suite regression-clean (should be: no code changes; infrastructure-only)
9. ADR-023 status flipped Draft → Accepted post-mission-close (Director signal)

---

## Dependencies

| Prerequisite | Relationship | Notes |
|---|---|---|
| ADR-023 ratified | hard prereq | Director must ratify before mission activates |
| mission-41 shipped to main | done 2026-04-23 | Current CI workflow on main is the base for Task 4 extension |
| GitHub repo admin access | operational | Branch protection + merge queue + settings require repo-admin; Director or delegate |
| Node/npm environment (for husky) | operational | Standard dev environment |

### Enables (downstream)

| Post-mission work | How |
|---|---|
| mission-43 as Phase 2 validator | First mission on new workflow; tests the scaffolding |
| mission-42 + mission-44 on new workflow | Benefit from CI gates + merge queue + CODEOWNERS |
| Invariant-Coverage v2/v3 + Agent-Behavior follow-up missions | All execute on new shape from day 1 |
| Scale-out to N>2 agents | Zero-cost under new workflow; scaffolding handles it |

---

## Engineer-flagged scope decisions (for Director)

1. **Branch-protection configuration mechanism** — GitHub UI configuration (manual, requires admin access) vs `probot/settings` app (`.github/settings.yml` declarative). Engineer-recommendation: GitHub UI for v1.0 (simpler; settings app adds dependency). Defer to engineer judgment.

2. **Merge queue selection** — GitHub-native (simpler) vs external tool (`mergify`/`bors`/`Kodiak` — more features). Engineer-recommendation: GitHub-native for v1.0; revisit if specific limitations surface.

3. **`.husky/pre-commit` installation model** — husky-managed (requires `npm install` + `prepare` script to activate) vs scripts/setup-hooks.sh (manual copy). Engineer-recommendation: husky-managed if existing dev environment has npm flow; otherwise scripts/setup-hooks.sh. Defer to engineer judgment at implementation.

4. **Secret-scan pattern list** — minimum filename patterns from mission-41 observation (`*.tfvars`, `*.tfstate.backup`) vs comprehensive list (extend with `*.env*`, `*.pem`, `*.key`, `credentials.*`, `secrets.*`, `*private*`). Engineer-recommendation: comprehensive list v1.0; can subtract if false-positive noise emerges.

5. **Co-authorship cadence for `multi-agent-pr-workflow.md`** — mirror mission-preflight.md and multi-branch-merge.md precedent (architect drafts + engineer fills TODO sections). Same shape as mission-41 Wave-1 T5 final CI-gate.

---

## Effort class

**S** (engineer-authoritative per Phase 4 §10.1).

Rationale:
- Task 1 (CODEOWNERS): ~2 hours engineer + architect review
- Task 2 (branch protection): ~1 hour engineer + Director admin access
- Task 3 (merge queue): ~1 hour engineer + Director admin access
- Task 4 (secret-scan CI): ~4 hours engineer; ~150 LOC workflow + test PR
- Task 5 (pre-commit hook): ~3 hours engineer; hook script + install path
- Task 6 (methodology docs): ~4 hours architect draft + ~3 hours engineer fills

Total: ~2-3 engineer-days + ~1 architect-day. S-class fits.

**Could expand to M** if:
- Branch protection requires non-trivial CI extension (unlikely; existing `test.yml` already comprehensive)
- Merge queue reveals policy-configuration complexity at scale
- Engineer discovers agent-adapter changes are unavoidable (e.g., PR workflow breaks current Hub-mediated task flow)

Re-classify if scope grows. Most likely stays S.

---

## Related Concepts / Defects

### Concepts advanced

- §2.3 Sovereign Composition (primary — PR-gated integration is composition-at-scale)
- §2.7 Layered Certification (primary — CI + CODEOWNERS + merge queue = three layers)
- §2.4 Manifest-as-Master (CODEOWNERS is the manifest)

### Defects resolved

- **Subdirectory gitignore bypass** class (mission-41 security near-miss) — prevented structurally at pre-commit + CI gate layers
- **Multi-agent coordination overhead** (mission-41 ~15 coordination threads) — replaced by PR-as-coordination-surface
- **Long-divergence-merge pain** — prevented by trunk-based frequent-small-merge cadence
- **Main-state-surprise** — prevented by branch protection (direct push disallowed; main reflects only-approved-merges)

### Ideas absorbed / related

- Relates to **idea-108** (Hub-as-Conductor) — PR workflow is partial mitigation for the workflow-gap; drain-queue issue partially disappears when agents coordinate via PR review instead of per-task threads
- Relates to **idea-102** (Universal Port) — both are "standardize the contract" shapes; different layer
- Relates to **idea-50** (Great-Normalization) — CODEOWNERS formalizes naming + ownership; aligned spirit

---

## Filing metadata

- **Status at draft:** not filed to Hub
- **Prerequisite completion:** ADR-023 ratification by Director
- **Graduation trigger:** Director release-gate signal post-ADR-023-ratification
- **Brief location:** `docs/planning/m-trunk-migration-infrastructure-brief-draft.md`
- **Phase 2 mission:** mission-43 (subsequent; first mission on new workflow)

---

*Draft brief v0.1 authored 2026-04-23. Follows ADR-023 Phase 1 scope exactly. S-class infrastructure investment; benefits compound across all subsequent missions. Last mission on current sovereign-branch workflow.*
