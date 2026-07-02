# work-46 work-trace — Bank-the-Base R1: `list_work` verb + lease column (+ bug-181)

**Owner:** greg (engineer, agent-0d2c690e) · **Claimed:** 2026-06-28T01:31 · **Focus:** stint-4 Bank-the-Base · **Rung:** idea-357-pt3 · **Gate:** steve verifier-gate (Hub slice)

## Brief (as seeded)
Implement a `list_work` query verb (Hub MCP): filter WorkItems by status/role/holder + LEASE as a first-class column (state/expiry/holder) — the controller's ground-truth org-state snapshot (today stitched from list_ready_work × roles × get_work). ALSO fix bug-181 (list_ready_work over-reports claimable — mirror claim_work's readiness predicate). idea-357 part-3. tele-13 + tele-4. Brief mandates: claim-time path-enumeration (cal #88) before sizing.

## cal #88 claim-time path-enumeration (ground-truth pass — DONE)
Mapped every surface (Explore agent + direct reads). Files that matter:
- Tool registration + handlers: `hub/src/policy/work-item-policy.ts` (`registerWorkItemPolicy` :316-416; handlers are module-private `async fn(args, ctx)`; `register()` sig at `router.ts:91`).
- Projection + claim authority + FSM: `hub/src/entities/work-item-repository-substrate.ts` (`listReadyForRole` :349-388; `claimWorkItem` :400-444; `unmetDependencies` :688-695 = single-source deps predicate; `inFlightCount` :677-683; `listWorkItems({status?,role?})` :324-333; `listExpiredLeaseItems` :598-604).
- Entity shape + phase enum: `hub/src/entities/work-item.ts` (`WorkItemPhase` ready|claimed|in_progress|blocked|review|done|abandoned; `WorkItemLease` {holder,token,claimedAt,expiresAt,heartbeatAt}; `IWorkItemStore` :112-177).
- Envelope mapping + lease indexes: `hub/src/storage-substrate/schemas/all-schemas.ts` (:638-672; `lease: "status.lease"` :664; `workitem_status_lease_holder_idx` / `_expiresat_idx` :649-650 — lease.holder + lease.expiresAt are indexed envelope paths).
- Registration call site: `hub/src/index.ts:82` + `:278`.
- Tests: policy/registration `hub/src/policy/__tests__/work-item-policy.test.ts`; projection/deps `hub/src/entities/__tests__/work-item-repository-substrate.test.ts`.

## FINDING (reconciliation — bug-181 is ALREADY RESOLVED)
The bug-181 half of the brief is a **stale-brief / fixed-but-open** (the F2/F12 trap the stint-3 retro named):
- **Bug entity:** bug-181 status = `resolved` (updated 2026-06-27T15:56). class=projection-honesty, severity=minor. (fixCommits was empty — lily backfilled `[5c64f58]`, see sha note below.)
- **Code present:** `listReadyForRole` :379-386 applies the deps gate via `unmetDependencies` — the SAME authority `claimWorkItem` uses (:422/:427). Comment at :369-375 literally says "bug-181 (idea-353 fold)". Landed via idea-353 WI-2.1 / AC5 strict parity.
- **FIX SHA (cite in PR body):** the squash-merge sha on main is **5c64f58** (PR #363, "idea-353 … bug-181 (DF2 WI-2)") — that's the ancestor-of-main sha a reconciliation pass cross-references. The code comment's `9ec45ee` is the BRANCH commit (squashed away, NOT an ancestor of main). lily's R2 input (idea-364/work-47): reconcile fix-shas against MAIN history (`git merge-base --is-ancestor`), record the SQUASH sha (derive from `gh pr view <n> --json mergeCommit`); a resolved bug whose sha isn't an ancestor of main = a distinct 'claims-fixed-but-not-in-main' finding vs empty-fixCommits 'needs-backfill'.
- **Test present + non-vacuous:** `work-item-repository-substrate.test.ts:218-245` — "bug-181 — eligible-role item with UNMET deps is filtered (projection == claim_work's deps gate)"; asserts blocked item is filtered AND claim_work rejects the same item (parity). This already satisfies work-46's `test` evidence requirement ("test covers the readiness predicate").
- **Approach match:** the brief offered "exclude unmet-dependsOn OR tag blockedOnDeps"; the bug's own proposed-fix leaned exclude; the impl excludes. No residual on the readiness predicate. (The only `truncated`-flagged caveat is the >500-row READY_SCAN_CAP under-report-beyond-cap, which is a separate, loud, honest concern — not the bug-181 over-report.)
- **list_work does NOT inherit a bug-181 obligation:** list_work is a general observability snapshot (show ALL items incl. blocked) — it is NOT a "claimable" projection, so the readiness gate is correctly list_ready_work's job only.

**Disposition (surfaced to lily 2026-06-28):** scope work-46 to JUST the `list_work` verb; bug-181 already-resolved (cite code + test + resolved-status). Proceeding on list_work in parallel (independent, unambiguous net-new work).

## Plan (list_work verb)
1. Design: `list_work` MCP verb in `registerWorkItemPolicy` + a `listWork` handler. Filters: status (phase), role (roleEligibility $contains), holder (lease.holder). Returns flat items incl. lease (state/expiry/holder) — the org-state snapshot. Reuse `listWorkItems` substrate path; extend it for holder + (maybe) lease-expiry projection.
2. Repo: extend `listWorkItems` (or add a sibling) to accept `holder` (filter on indexed `status.lease.holder`) + return lease-decoded flat items. Truncation-honest (LIST_CAP=500).
3. Tests: policy registration + handler (work-item-policy.test.ts); repo filter-by-holder/status/role + lease column (work-item-repository-substrate.test.ts). Mutation-verify each.
4. Pre-gate path-enumeration (cal #88 / my own intake discipline): enumerate the distinct paths list_work introduces (status-only / role-only / holder-only / combined / lease-expiry state) — one test each — BEFORE steve's gate.
5. Steve verifier-gate (Hub slice). PR → joins as a mergeable-live Hub MCP read verb.

## BUILD COMPLETE (2026-06-28)
**Scope shipped:** `list_work` verb ONLY (bug-181 disposed already-resolved per lily, cite 5c64f58 + test:218-245 in PR body). list_work shows ALL matching items (lease/blocked are COLUMNS not filters — confirmed by lily).

**Files changed (5):**
- `hub/src/entities/work-item.ts` — `IWorkItemStore.listWorkItems` signature: `+holder` filter, return `{items, truncated}`.
- `hub/src/entities/work-item-repository-substrate.ts` — impl: `+holder` filter (`status.lease.holder` indexed envelope path), `truncated = items.length >= LIST_CAP` (repo owns the cap → honesty sourced here, not inferred at policy).
- `hub/src/policy/work-item-policy.ts` — new `listWork` handler (paginated, truncation-honest, lease column) + `list_work` registration + `WORK_PHASE` zod enum.
- `hub/src/entities/__tests__/work-item-repository-substrate.test.ts` — 6 callers updated to `{items}`; +1 real-pg test (holder filter + lease column + observability of non-ready items).
- `hub/src/policy/__tests__/work-item-policy.test.ts` — tool-count 11→12; +3 list_work tests (snapshot/filters, truncation-honesty, not_wired).

**Path-enumeration + mutation-verification (pre-gate, cal #88 + pre-gate-path-enumeration discipline):**
- holder filter (repo) — MUTATION: no-op the holder key → `unleased` leaks into holder results → test FAILS (verified, restored). ✓
- filter pass-through (policy) — MUTATION: drop `holder` from handler filter → pass-through assertion FAILS (verified, restored). ✓
- lease column returned — asserted holder + expiresAt present on the real-pg row (+ existing lease round-trip coverage). ✓
- observability (non-ready shown) — status:"claimed" surfaces claimed/blocked items (NOT a readiness projection). ✓
- truncation honesty — false-branch tested in repo; truncated→note path tested in policy (stub). The >500-row scan-cap path is the same READY_SCAN_CAP pattern already proven for list_ready_work; not re-manufactured (deliberate — no silent cap, `truncated` is sourced from the repo).

**Verification:** hub tsc clean; full hub suite GREEN (177 files / 2127 passed | 7 skip) on the stale base AND re-verified fresh-off-origin/main (held-time-verify). Branch `agent-greg/work-46-list-work-verb` off origin/main (the 16-ahead held batch did NOT touch any of the 5 files — verified via `git diff HEAD origin/main`).

**GATE:** steve verifier-gate (Hub backplane verb, MANDATORY-to-run). Real-pg lease-column projection test is in (the seam lily asked to exercise). PR body carries the bug-181 disposition + the list_work design-record.
