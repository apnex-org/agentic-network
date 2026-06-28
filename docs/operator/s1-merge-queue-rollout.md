# S1 Merge-Queue Rollout (idea-380 / stint-5 velocity floor)

**Owner:** greg (engineer) · **Slice:** S1-MERGEQ · **Gates on:** work-78 (CI-reliability floor — DONE).
**Goal:** relieve the merge-leg bottleneck. work-80 baseline: the **merge-leg (approved→merged) is the larger leg** — median **8.9m** / mean 15.7m, with a rebase-cascade tail (#402 62.9m) — vs cross-agent approval-wait (median 3.8m). The merge-queue's auto-rebase-in-queue targets exactly this leg.

**Orthogonality (lily's lifecycle finding):** the merge-queue gates on the **CI-reliability floor (work-78)**, NOT the deploy/infra floor (work-79/bug-107). Deploy-reliability is post-merge and orthogonal to merge throughput. Future seed_blueprint graphs wire the merge-queue's `dependsOn` to the CI floor only.

---

## 1. What ships in CODE (this branch)

- **`merge_group:` trigger** added to the three REQUIRED CI workflows (`test.yml`, `no-engineer-id.yml`, `secret-scan.yml`). A required status check that does NOT run on `merge_group` stalls the queue forever (it waits for a check that never reports). These now run on both the PR and the queued group.
- **`concurrency: cancel-in-progress`** on `deploy-hub.yml` already landed (#413) — so a queue-merged batch produces ONE VM roll, not per-merge churn.
- **CODEOWNERS** (`.github/CODEOWNERS`) — the per-path ownership/cross-approve matrix is already comprehensive (architect-owned / engineer-owned / shared-co-author). No change needed; it becomes load-bearing once "require review from Code Owners" is enabled (admin, below).

## 2. Cross-approve matrix (the FR-31 gate-vs-merge split)

Ground-truth from #413 (architect-approve qualified the merge) vs #412 (verifier-approve did not):

- **Merge-qualifying REVIEW = architect approve** — branch-protection "require review from Code Owners" + the CODEOWNERS matrix routes which role's approve is required per path. The architect approve is what flips a PR mergeable.
- **Verifier gate = a required STATUS CHECK** — steve's PASS gates as a *check* (can block the merge), NOT as a merge-qualifying review-approval. (Today the verifier PASS is posted as a PR review; for the queue it should be wired as a required check/status so it blocks without being miscounted as the merge-approval.)
- **Per-path routing:** `/hub/src/**` etc. → engineer owner; `/docs/methodology/**` etc. → architect owner; `/hub/src/storage-substrate/`, `/docs/audits/`, `/docs/specs/` → both (shared co-author).

## 3. What needs ADMIN / repo-settings (Director/lily — NOT a code change)

These are GitHub repo settings (UI or `gh api` with admin scope); the engineer branch cannot set them:

1. **Teams:** ensure `@apnex-org/architect` + `@apnex-org/engineer` exist (CODEOWNERS handles refs once they do — per the CODEOWNERS header, created in the admin window).
2. **Branch protection on `main`:**
   - Enable **"Require merge queue"**.
   - **Required status checks** (must pass on the merge group): `test`, `no-engineer-id`, `secret-scan`.
   - **Require review from Code Owners** = on (activates the CODEOWNERS matrix → architect-approve as the merge-gate).
   - Keep **require-branches-up-to-date** (the merge-queue auto-rebases to satisfy it — that's the whole point).
3. **Enable auto-merge** (repo setting) — so an approved + checks-green PR merges via the queue without a manual click.
4. **Merge-queue settings:** build concurrency (start with a small batch size, e.g. 5), and "only merge if the combined check is green".

## 4. Pilot plan (de-risk before defaulting — per work-80 baseline)

- **Do NOT validate on a single green PR** — that exercises none of the auto-rebase-in-queue path that is the entire point. Pilot on a **2–3 PR stacked/concurrent batch** of low-stakes PRs (e.g. a few S0 hygiene PRs) so the queue's rebase-and-recheck-in-order path is actually tested under contention.
- **Measure the delta:** re-capture the work-80 merge-leg breakdown over the post-enable cohort (the `docs/audits/stint-4-merge-leg-baseline.md` AFTER section). Report: merge-leg median delta, rebase-churn-count delta, CI-rerun count, and crucially whether the queue's per-PR CI-rerun cost ATE the rebase time saved (the T8 risk — if CI is slow, the rerun-per-queued-PR can negate the win; work-78's reliable+fast CI is the hedge).
- **Success criterion:** merge-leg median measurably down + no queue stalls + throughput up toward the +1.5–2 PRs/hr hypothesis. If the CI-rerun cost dominates, narrow the required-check set or raise batch size.

## 5. Escape hatch (queue stall → don't wedge the org)

- **Manual merge:** an admin can merge a PR directly (bypass the queue) or **disable "Require merge queue"** in branch protection to fall back to the prior one-at-a-time regime. Documented so a stalled queue never wedges delivery (the FR-27/FR-38 lease-wedge class, applied to merges).
- **A stuck check** (a required check not reporting on `merge_group`) is the likely first failure mode — this branch's `merge_group` triggers prevent it; if a NEW required check is added later, it MUST also list `merge_group` or it will stall the queue.

## 6. Sequence

work-78 (CI floor, DONE) → enable per §3 (admin) → pilot per §4 (multi-PR batch) → measure → default-on or adjust. work-79 (bug-107 VM deploy-reliability) runs in parallel and does NOT gate this.
