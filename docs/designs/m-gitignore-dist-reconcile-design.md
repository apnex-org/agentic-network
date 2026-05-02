# M-Gitignore-Dist-Reconcile — Design v1.0

**Status:** v1.0 RATIFIED (architect-authored 2026-05-02; Director-direct ratify-direct compression — no engineer audit cycle per Director directive 2026-05-02 "Approved for b" / option-(b) Ratify-direct)
**Methodology:** Phase 4 Design per `mission-lifecycle.md` v1.2 §1 (RACI: C=Director / R=Architect+Engineer)
**Source idea:** idea-232 M-Gitignore-Dist-Reconcile (status `triaged` via route-(a) skip-direct)
**Survey:** WAIVED per Director-direct 2026-05-02 ("No need for a survey for Investigate+Reconcile, move straight to design") — compressed-lifecycle pattern for mechanical small-scope investigations
**Engineer audit cycle:** WAIVED per Director-direct 2026-05-02 — investigation procedure (§2) is self-validating (CI/local-dev tests either pass or fail; bad design surfaces as failed test, not latent risk)
**Composes calibration:** #20 (cross-package `file:` ref install-order-dependence) — Outcome A → closure-folded
**Branch:** `agent-lily/m-gitignore-dist-reconcile` (Design + investigation + reconcile PR cumulative)

---

## §0 Document orientation

Single-file mission. Investigation-then-reconcile shape: ~30-60min architect-side, deliverable = one `.gitignore` edit OR no-op-plus-clarifying-comment.

Reading order:
- §1 Mission scope (what we're verifying)
- §2 Investigation procedure (steps + commands)
- §3 Decision tree (Outcome A / B / C)
- §4 Reconciliation rules per outcome
- §5 Verification strategy
- §6 Anti-goals
- §7 Cross-references

---

## §1 Mission scope

Verify whether the three `dist/` negation rules in `.gitignore` are still load-bearing, then reconcile the doc to match actual workflow state.

**Current state (observed at idea-232 filing, commit `93264e6`):**

`.gitignore` lines 9-36 carry three explicit negation rules with detailed mission/calibration commit-intent commentary:
- `!packages/storage-provider/dist/**` (mission-47 W1; line 17-18)
- `!packages/repo-event-bridge/dist/**` (mission-52 T3 + calibration #20; line 28-29)
- `!packages/message-router/dist/**` (mission-56 W2.1 + #20; line 35-36)

`git ls-tree origin/main packages/{storage-provider,repo-event-bridge,message-router}/dist/` returns empty across all three. None tracked.

**Hypothesis (architect-authored):** PR #150 (`bug-43 followup-2`; pre-install + build sovereign packages before hub install in CI + `build-hub.sh`) plus the prepack→prepare rename (PR #149) restructured the build flow so committed `dist/` is no longer required. The negation rules + multi-paragraph comments are stale governance-doc residue.

**Counter-hypothesis (engineer round-1 audit candidate-finding):** Local-dev path (`cd hub && npm install`) may still resolve `file:../packages/X` refs in a way that requires committed `dist/` if the prepare-hook tsc cascade doesn't reliably run. Per calibration #20, the prepare-hook approach was tried (revision v2) and failed — but PR #149/#150 explicitly fixed the prepack→prepare rename + pre-install ordering, possibly closing #20.

---

## §2 Investigation procedure

Run from clean checkout. Commands target `agent-lily/m-gitignore-dist-reconcile` branch; reproducible from any worktree.

### §2.1 — Pre-investigation snapshot

```sh
git -C <worktree> rev-parse HEAD                    # confirm at 93264e6 or descendant
git ls-tree origin/main packages/storage-provider/dist 2>&1
git ls-tree origin/main packages/repo-event-bridge/dist 2>&1
git ls-tree origin/main packages/message-router/dist 2>&1
# All three should return empty (state at filing time)
```

### §2.2 — Cloud Build / CI path test

Reproduce the CI build flow without committed `dist/`:

```sh
# From clean worktree — no node_modules anywhere
find packages -name node_modules -type d -prune -exec rm -rf {} \;
find packages -name dist -type d -prune -exec rm -rf {} \;
rm -rf hub/node_modules

# Run build-hub.sh (pre-install + npm pack flow)
OIS_ENV=local-fs scripts/local/build-hub.sh

# Verify Hub built successfully
test -f hub/node_modules/@ois/storage-provider/dist/contract.js && echo "✓ storage-provider dist present"
test -f hub/node_modules/@ois/repo-event-bridge/dist/cursor-store.js && echo "✓ repo-event-bridge dist present"
test -f hub/node_modules/@ois/message-router/dist/index.js && echo "✓ message-router dist present"
```

Expected (Outcome A): all three checks pass — `build-hub.sh` produces dist/ at install-time; commit-intent superseded.
Failure (Outcome B): one or more dist/ missing — build-hub.sh insufficient; commit-intent still load-bearing for some path.

### §2.3 — Local-dev path test

Reproduce the developer-workstation install flow:

```sh
# Same clean state as §2.2
find packages -name node_modules -type d -prune -exec rm -rf {} \;
find packages -name dist -type d -prune -exec rm -rf {} \;
rm -rf hub/node_modules

# Local install (no build-hub.sh; just npm install in hub)
( cd hub && npm install )

# Same dist/ presence checks as §2.2
test -f hub/node_modules/@ois/storage-provider/dist/contract.js && echo "✓ storage-provider dist present"
test -f hub/node_modules/@ois/repo-event-bridge/dist/cursor-store.js && echo "✓ repo-event-bridge dist present"
test -f hub/node_modules/@ois/message-router/dist/index.js && echo "✓ message-router dist present"
```

Expected (Outcome A): all three checks pass — `prepare: tsc` hook runs reliably during `npm install` in monorepo `file:` resolution. Confirms calibration #20 closed by PR #149/#150.
Failure (Outcome B): one or more missing — local-dev path still requires committed `dist/` OR a manual pre-install per-package step.

### §2.4 — Smoke-run Hub

Both paths must produce a runnable Hub:

```sh
( cd hub && npm test )                       # Hub test suite passes
OIS_ENV=local-fs scripts/local/start-hub.sh   # starts without import errors
```

### §2.5 — Survey downstream consumers

Grep for references to the negation-rule paths to ensure no other tooling depends on committed `dist/`:

```sh
git grep -n "packages/storage-provider/dist" -- ':!.gitignore' ':!*.lock'
git grep -n "packages/repo-event-bridge/dist" -- ':!.gitignore' ':!*.lock'
git grep -n "packages/message-router/dist" -- ':!.gitignore' ':!*.lock'
```

Expected (Outcome A): zero hits OR only documentation references. Anything else (CI workflow ref, install script ref, test fixture ref) is a load-bearing dependency that must be addressed before dropping the negation rules.

---

## §3 Decision tree

| §2.2 CI | §2.3 local | §2.5 grep | Outcome | Rule |
|---|---|---|---|---|
| ✓ pass | ✓ pass | clean | **A** | drop negation rules + comments |
| ✓ pass | ✗ fail | clean | **B-local** | keep rules; update comments to clarify local-dev-only load-bearing |
| ✓ pass | ✓ pass | dirty | **B-tooling** | keep rules; document referencing tool(s) in comment |
| ✗ fail | * | * | **B-CI** | keep rules; investigate why `build-hub.sh` doesn't produce dist/ |
| Mixed | Mixed | Mixed | **C** | partial reconcile per investigation findings |

---

## §4 Reconciliation rules per outcome

### §4.1 — Outcome A (clean)

`.gitignore` edit: remove lines 9-36 (the three negation blocks + their comment paragraphs). Replace with a single line note if any future reader needs context:

```gitignore
# Sovereign packages' dist/ are not committed; build-hub.sh + npm prepare hooks
# regenerate them at install time. Calibration #20 closed by PR #149 + #150.
```

Side-effects:
- Calibration #20 flips to `closed-folded` with closure mechanism = "PR #149 prepack→prepare rename + PR #150 pre-install ordering rendered the cross-package `file:` install-order workaround unnecessary". Architect-authored ledger entry per `CLAUDE.md` calibration ledger discipline.
- idea-186 (npm workspaces migration) decoupled — was framed as "long-term structural fix"; with #20 closed via different mechanism, idea-186's motivation narrows to other workspaces benefits.

### §4.2 — Outcome B-local (local-dev still load-bearing)

`.gitignore` edit: keep negation rules. Replace the multi-paragraph mission/calibration commentary with a tightened comment:

```gitignore
# Sovereign packages ship their built dist/ committed to the repo because
# local-dev `cd hub && npm install` doesn't reliably trigger the prepare:tsc
# cascade for file: refs. CI uses build-hub.sh's pre-install hook instead and
# doesn't depend on committed dist/. Calibration #20 partially closed (CI path);
# idea-186 (npm workspaces) remains the structural fix.
!packages/storage-provider/dist/
!packages/storage-provider/dist/**
!packages/repo-event-bridge/dist/
!packages/repo-event-bridge/dist/**
!packages/message-router/dist/
!packages/message-router/dist/**
```

Plus: file a follow-on Idea for "M-Sovereign-Dist-Commit-Hook" — pre-commit hook to enforce dist/ stays in sync with src/ (since current state has uncommitted dist/ on dev workstations means the rules are aspirational not enforced).

### §4.3 — Outcome B-CI / B-tooling

Document the load-bearing consumer in a tightened comment. Don't drop rules. File specific follow-on Idea per consumer.

### §4.4 — Outcome C (mixed)

Per-package reconciliation. Each of the three negation blocks evaluated independently. Possible state: drop storage-provider's block but keep repo-event-bridge's, etc. Document the per-package rationale.

---

## §5 Verification strategy

Two verification gates:

### §5.1 — Pre-merge gate (PR review)

- §2.2 + §2.3 + §2.4 all pass on the PR's branch
- §2.5 grep confirms no missed consumers
- Diff inspection: `.gitignore` edit matches the chosen Outcome's rule
- If Outcome A: calibration #20 ledger flip staged in same PR (single-commit-or-bilateral split per architect discretion)

### §5.2 — Post-merge soak

- Two-day soak: monitor any local-dev CI failures or developer-workstation breakage reports
- If breakage: revert + re-investigate (Outcome was wrong; redo from §2 with new hypothesis)

---

## §6 Anti-goals

- **AG-1:** Don't migrate to npm workspaces in this mission. idea-186 owns that scope; this mission is purely doc-vs-state reconcile.
- **AG-2:** Don't add new dist/ commit-enforcement tooling unless Outcome B-local explicitly demands it.
- **AG-3:** Don't touch `package.json` `prepare`/`prepack` hooks. PR #149 shipped that fix; if Outcome B reveals it's still broken, file separate bug — don't expand this mission's scope.
- **AG-4:** Don't add a calibration filing for the doc-vs-state divergence pattern as a class. Single-instance; doesn't yet warrant pathology codification.
- **AG-5:** Don't refactor `build-hub.sh` even if §2.2 reveals tweakable bits. Out of scope; file separate Idea if needed.

---

## §7 Cross-references

- **Source idea:** idea-232 (status=triaged; route-(a) skip-direct)
- **Surfacing thread:** thread-463 (post-mission-69 cleanup; converged 2026-05-02)
- **Composes calibration:** #20 (Outcome A closes; Outcome B partial-closes)
- **Likely-superseding work:** PR #149 (prepack→prepare rename) + PR #150 (pre-install + build sovereign packages)
- **Long-term structural:** idea-186 (npm workspaces migration)
- **Origin-of-exception missions:** mission-47 W1 (storage-provider) + mission-52 T3 (repo-event-bridge) + mission-56 W2.1 (message-router)
- **Methodology:** `mission-lifecycle.md` v1.2 §1 (Phase 4) + Director-direct survey-waiver precedent (2026-05-02)
