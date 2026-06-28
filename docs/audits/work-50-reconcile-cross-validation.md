# work-50 — reconcile.py × hand-audit cross-validation (R2 end-to-end)

**Author:** greg (engineer) · **Date:** 2026-06-28 · **Stint:** stint-4 Bank-the-Base (R2 reconciliation)
**Instrument:** `scripts/reconciliation/reconcile.py` (PR #403, merged d8dcee78)
**Inputs:** full prod bug-ledger (198 Bug entities, exported via `hub_reader` psql `jsonb_agg`) vs `origin/main` @ a60c5d9
**Peer audit:** steve, work-50 hand-audit (`docs/audits/work-50-bug-ledger-fixcommits-hygiene.md`, audit-4744)

## Verdict — CROSS-CHECK PASSES

The git-aware reconcile CLI's classification **logic agrees** with steve's independent hand-method. This is the R2 payoff validated end-to-end: the instrument reproduces a careful human audit *and* covers more ground.

The marquee proof: **fixed-but-still-open = exactly 1 (bug-180) in BOTH methods, independently** (its fix `ade10cf` IS an ancestor of main, but the bug is legitimately still open pending the AC1 live smoke — work-5). The F2/F12 thesis — "a recorded fix-sha that is genuinely in main while the bug stays open is a distinct, detectable state" — is demonstrated.

## Bucket comparison

| bucket | greg (reconcile.py, full 198) | steve (hand-audit) |
|---|---|---|
| clean / confirmed-resolved | 70 | 62 |
| needs-backfill | 50 | 27 |
| claims-fixed-but-not-in-main | 14 | 11 |
| fixed-but-still-open | **1 (bug-180)** | **1 (bug-180)** |
| actionable-open | 40 | — |
| closed-wontfix | 23 | — |
| external (cross-repo) | 0 (repo unset) | — |
| **resolved-total covered** | **134** | **100** |

## The divergence is sample-completeness — and itself a finding

greg's resolved-total (134) = the prod ledger's actual resolved count. steve's (100) = **capped by the live `list_bugs` ≤100 page** — the *same* bulk-list cap that bug-196/#406 (compact projection) + bug-198/#407 (filter-optionality) + the limit-not-honored issue were filed to fix. The +34 distributes +8 clean / +23 needs-backfill / +3 claims-fixed; the *classification logic agrees* on every bug both methods saw — the gap is purely which bugs each method could enumerate.

**Conclusion:** reconcile.py-via-psql is **more complete** than a by-hand `list_bugs` survey. The hand-audit under-counted through no fault of method — it hit the platform cap R2 was built to route around. This validates banking the instrument (zero-cost, complete, repeatable at every stint-open) over re-running the audit by hand.

## Curation output

### Applied — 18 safe-additive backfills (single-candidate, merge-base-verified)

Event-silent `update_bug fixCommits=[sha]` (no status change → no `dispatchBugStatusChanged`). Each bug was resolved with empty fixCommits; reconcile.py found exactly one main commit referencing the bug-id (exact-token grep). **Applied + verified landed in prod substrate 2026-06-28:**

```
bug-4   db8248f   bug-41  a3c25bf   bug-61  ac539e5   bug-105 417f668
bug-124 b00f708   bug-134 30486f0   bug-135 0ba442d   bug-142 2f073f0
bug-157 cd89a23   bug-160 5a36207   bug-165 ebcb3db   bug-171 1108dd2
bug-176 edd4373   bug-177 1ff5d81   bug-187 dd5dd99   bug-191 c2d8d7b
bug-192 7ce7d82   bug-193 584de05
```

### claims-fixed-but-not-in-main (14) — SCRUTINIZED, conflates two classes (cal #85)

The recorded fixCommit is not an ancestor of main. Per-bug determination (NOT blanket-classified — discriminator: does the recorded orphan-sha exist as an object in *this* repo, and does main reference the bug-id?):

- **branch-sha-trap → BACKFILL the squash sha** (main references the bug-id; the recorded sha is a squashed-away branch sha): **bug-24, bug-93, bug-167, bug-168, bug-169, bug-170** (in-repo Hub/verifier bugs; multiple main refs → pick the merge-commit).
- **genuine cross-repo → repo=apnex/missioncraft (→ external)** (orphan-sha foreign to this repo + `msn`/v1.0.6 mission-control titles): **bug-68, bug-69, bug-70, bug-71, bug-72, bug-73**.
- **needs-human (uncertain)**: **bug-166** (in-repo — orphan-sha exists — branch-sha-trap, but no grep-findable squash) · **bug-139** ("Hub assertIdentity" title reads in-repo, but recorded sha is foreign + no main ref).

### Report-only — needs-backfill with no single safe candidate (32)

- **zero-candidate (genuine needs-human-backfill)** — 9: bug-5, bug-42, bug-48, bug-95, bug-121, bug-140, bug-149, bug-163, bug-186
- **multi-candidate (ambiguous — >1 main commit references the id, needs a human pick)** — 23: bug-2, bug-22, bug-27, bug-30, bug-32, bug-34, bug-39, bug-43, bug-57, bug-94, bug-99, bug-100, bug-103, bug-117, bug-118, bug-123, bug-125, bug-126, bug-133, bug-158, bug-173, bug-178, bug-182

### fixed-but-still-open (1)

- **bug-180** — fix `ade10cf` in main; legitimately open pending the AC1 live smoke (work-5). No action; tracked.

## Method notes

- Envelope decode: reconcile.py `_flatten()` reads `status.phase` / `status.fixCommits` / `spec.repo` off the K8s-envelope rows (the bug-137 class — flat top-level reads return undefined).
- Ancestry: `git merge-base --is-ancestor <sha> main`, never bare `cat-file` existence (the squash-merge trap — a discarded branch sha still resolves via cat-file → false "fixed").
- Fix-sha discovery: `git log main -E --grep "(^|[^0-9A-Za-z])<bug_id>([^0-9]|$)"` — exact-token, so bug-18 does not match bug-180.

## Follow-up (banked)

`reconcile.py --apply` mechanization — wire the safe-additive single-candidate backfill bucket to auto-apply (with a confirm gate), so future stint-open reconciliation is zero-touch on the safe bucket and surfaces only the human-disposition buckets.
