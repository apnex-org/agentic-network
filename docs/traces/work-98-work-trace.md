# work-98 work-trace — Arc-A slice 1: idea-384 Part A (per-FSM-state wall-clock timers)

**Owner:** greg (engineer). **Arc:** Arc-A observability (Director #1). **Verify:** lily adversarial-verify sub-agent.
**Branch:** agent-greg/work-98-fsm-state-timers (off main @ ab1ff79).

## Scope
Per-node per-state wall-clock accumulation on the WorkItem FSM. PART A only (per-node); PART B (recursive arc-rollup CTE) = slice 2. idea-343 telemetry = separate survey track.

## Path-enum (cal #88 — the all-sites audit; lily's verify focal point)
10 state-mutation sites, ALL in `hub/src/entities/work-item-repository-substrate.ts` (SINGLE FSM impl — no memory-mode mirror; task-repository = different entity, out of scope):
- BIRTH (stamp enteredCurrentStateAt=createdAt + init zero buckets): createWorkItem(336), createBlueprintNode(382)
- TRANSITIONS (accrue exiting bucket + re-stamp via shared helper): claim ready→claimed(726); start claimed→in_progress(737); block in_progress→blocked(745); resume blocked→in_progress(753); release →ready(883); abandon →abandoned(900); complete in_progress→{review|done} & review→done(991); sweeper expireLease {claimed|in_progress|blocked|review}→ready|abandoned(1036-37, putIfMatch — the one non-tryCasUpdate site, easiest to miss).
- renewLease(760): heartbeat only — NOT a transition; must NOT touch enteredCurrentStateAt/stateDurations.

## FORK resolved (surfaced pre-build; lily confirmed)
Runbook's stateDurations {ready,claimed,in_progress,blocked} OMITTED `review` (a 5th dwell state: LEASE_HELD; completeWork parks there; sweeper requeues review→ready). Without it the sum-identity breaks for reviewed nodes + complete(review→done)/sweep have no bucket. → **5 buckets {ready,claimed,in_progress,blocked,review}** (review = verifier-wait latency, a high-value Arc-A signal). cal #101 (parity-field-set completeness). Terminal (done/abandoned) = no bucket.

## Build plan (membrane = 4 sites, mirrors leaseExpiryCount)
1. work-item.ts: StateDurations iface + DEFAULT_STATE_DURATIONS + WorkItem.{enteredCurrentStateAt, stateDurations}.
2. all-schemas.ts renameMap: +enteredCurrentStateAt→status.enteredCurrentStateAt, stateDurations→status.stateDurations (non-filterable → no index).
3. v2-envelope/kinds/WorkItem.ts partition.status: +both.
4. renamemap-contract-w1 golden: +both.
5. substrate repo: accrueExitingState(w, nowISO) SHARED helper (elapsed-in-old-status → bucket, re-stamp); apply at all 8 transitions + the sweeper; init at 2 births; cloneWorkItem defaults (enteredCurrentStateAt ?? updatedAt migration-default; stateDurations ?? zeros); getStintProjection child surfaces stateDurations.
6. Tests: per-transition accrual mutation-pin (drop stamp on ONE site → that bucket reds) ×10; requeue re-accumulation; sum-identity (sum(5 buckets)=createdAt→completedAt for a full lifecycle).

## Migration honesty
Pre-existing items: enteredCurrentStateAt defaults to updatedAt (best proxy), buckets start zero — historical dwell is NOT retro-captured; sum-identity asserted only on items born under the timer.
