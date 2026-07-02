# work-99 work-trace — Arc-A slice 2: idea-384 Part B (recursive arc-subtree rollup)

**Owner:** greg (engineer). **Arc:** Arc-A observability. **Verify:** lily adversarial-verify sub-agent.
**Branch:** agent-greg/work-99-arc-rollup-cte (off main @ 05e5c99 = work-98). dependsOn work-98.

## Architecture FORK resolved (surfaced pre-build; lily confirmed = cal #85)
Runbook said "postgres WITH RECURSIVE / one server-side query". Ground-truth: the HubStorageSubstrate
INTERFACE has no raw-query seam (pg pool is private), ZERO `WITH RECURSIVE` in hub/src, and the
work-88 precedent (computeCompletionProgress/getStintProjection) is app-side point-gets. A raw CTE
reading status.stateDurations/spec.completionDependsOn from JSONB would BYPASS the envelope
decode-to-flat membrane = the bug-137/138 class work-98's verify just guarded. → **OPTION B**
(app-side recursive walk), envelope-safe via cloneWorkItem. Option A (a governed raw-query substrate
seam) = a deferred non-filed future idea (YAGNI + membrane risk).

## ownActiveMs derivation (surfaced pre-build; lily confirmed)
The lease (claimedAt) is CLEARED on terminal transitions → claimedAt→completedAt unreadable on a
finished arc. So derive from the arc's OWN buckets: ownActiveMs = claimed+in_progress+blocked+review
(active wall-clock, EXCLUDING ready queue-wait). parallelism = rolledUp.in_progress / ownActiveMs
(null when 0). Documented at the field + the get_current_stint tool desc (consumer must read it as
concurrency-vs-active-span, not vs total-elapsed).

## Build
- StintProjection += rolledUpDurations + ownActiveMs + parallelism (work-item.ts).
- rollupLeafDurations(arcId): memoized visited-set DFS over completionDependsOn (point-gets,
  cloneWorkItem-decoded). LEAVES-ONLY-by-construction (intermediate recurses, own span NEVER added;
  leaf contributes own). Visited-set = DAG-dedup (shared leaf once) + cycle-guard (termination via
  work-87 acyclic + the guard). Vanished node skipped. On-read, bounded (stint ~6 children).
- getStintProjection computes rollup + ownActiveMs + parallelism; get_current_stint passes through.

## Tests (full suite 2272 green)
- work-item-arc-rollup-substrate.test.ts (5, real-pg): leaves-only, DAG-dedup (diamond single-count),
  rollup==sum(unique leaves), own-span-separate+parallelism, parallelism-null-on-zero. Each compares
  the rollup to the ACTUAL summed leaf durations (exact, deterministic). Mutation-proven NON-VACUOUS
  (cp backup, NOT git checkout — [[feedback_mutation_restore_use_cp_backup]]): M1 add-intermediate-own
  → leaves-only RED; M2 disable-visited-guard → DAG-dedup RED.
- gap-1 (carried from #427): work-item-state-timers-substrate.test.ts += reviewed-node sum-identity
  (in_progress→review→done, verifier evidence — review bucket captured) + requeued-node sum-identity
  (via release→re-claim real-time; sweeper-requeue needs a future-nowISO that would inflate entity
  timestamps + break the identity — its per-bucket accrual is separately pinned).

## NOTE on the sweeper-requeue sum-identity (test-fidelity)
Not asserted via the sweeper (LEASE_TTL=15min unwaitable; future-nowISO inflates timestamps). Tested
via release (identical telescoping). The sweeper's accrual is non-vacuously pinned separately.
