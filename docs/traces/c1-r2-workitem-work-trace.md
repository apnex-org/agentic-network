# C1-R2 M-Work-Queue-Substrate (mission-94) — Work Trace (live state)

**Mission scope.** C1-R2 — the keystone of the C1 Sovereign Work-Control Plane arc (design-of-record PR #355). Build the reference-only `WorkItem` work-queue kind + its claim/lease/FSM verbs + `complete_work` evidence predicate + the general `$contains` JSONB operator, the MCP verb surface, the lease-expiry sweeper, and the per-agent thrash-quarantine (the C1→C2 supervisor seam). Built under the LIVE C3-R4 governor (renameMap-governor: call-site scanner + drift-gate + value-round-trip oracle) + the R4b fail-loud belts (cal-84).

**Design round:** thread-692 (C1 Phase-4 Design review of #355) + thread-694 (R2 construction-design). Engineer build-blueprint: `docs/designs/c1-r2-workitem-construction-design.md`.
**Integration branch:** `agent-greg/c1-r2-workitem` (PR #356). Cadence (architect call): build ALL sub-PRs on the one branch, incremental delta-review per push, ONE merge+deploy at assembly (dormant-until-assembled keystone — zero prod exposure until the gate).
**How to read + update this file:** `docs/methodology/trace-management.md`.

**Status legend:** ▶ in-flight · ✅ done this session · ○ queued / filed · ⏸ blocked

---

## Resumption pointer (cold-session brief)

1. **Read this file**, then `docs/designs/c1-r2-workitem-construction-design.md` (the build blueprint), then thread-694 (R2 design) + Steve's threat-models (audit-4082 verbs, audit-4085 eligibility-bypass) which doubled as the test-plan.
2. **Current state: CONSTRUCTION COMPLETE.** The full keystone (kind → store → verbs → complete_work → claim-authority → MCP policy surface → lease-sweeper → thrash-quarantine) is built + green on #356 across 14 commits. Full suite: **2078 passed / 7 skipped / 0 fail.**
3. **What's left is NOT engineer-autonomous:** the assembly-gate (merge #356 + deploy) is gated on Steve back from quota OR a Director relaxed-gate; prod-deploy needs explicit Director auth. Steve's per-sub-PR adversarial verify is deferred to his return (thread-700 3a-ii advisory mid-flight).
4. **The renameMap dual-source discipline** (idea-346): a new relocated field needs the write-ENCODE (per-kind migration module) AND the read/filter renameMap (all-schemas.ts) hand-mirrored. WorkItem's sub-PR-2a seeding-bug (read-declared, write-missing) was caught pre-ship by the W1 governor. The Agent thrash fields (4b-i) repeat the discipline.
5. **Born-under-governor:** every schema touch (WorkItem kind, Agent extension) ran W1/W4/W6 + the R4a drift-gate/oracle green before ship. The governor IS the schema-migration backstop — run it after any schema change.

---

## In-flight

- ▶ This work-trace (engineer closing artifact) for the assembly-gate + retro.

## Queued / filed (NOT engineer-autonomous)

- ⏸ **Assembly-gate** — merge #356 + deploy. Gated: Steve back OR Director relaxed-gate; prod-deploy needs Director auth.
- ⏸ **Steve retroactive verify** — per-sub-PR adversarial reads + the DR-002 assembly verifier-gate, deferred to Steve's quota recovery. thread-700 (3a-ii advisory) sits until then.
- ○ **idea-121** — exact MCP tool STRINGS + the precise per-verb RBAC tags (working names + [Any]/[Architect|Director] tags used here).
- ○ **C2 follow-on** — supervisor-restart auto-recovery of a quarantined agent (R2 ships detection + signal + manual escape; auto-recovery chartered to C2).
- ○ **list_ready_work server-side role projection** — the empty-role OR-in is in-memory (the substrate can't express "$contains OR is-empty"); a role-index / is-empty operator is a later optimization (truncated-flag keeps v1 honest).

---

## Done this session — the C1-R2 arc on #356 (14 commits)

### Foundation — the `$contains` operator
- ✅ **8d7435e — `$contains` general JSONB array-membership** (inverse of `$in`), 6 surfaces: FilterValue type, SQL `translateFilterClause` (`data#>'{path}' @> $n::jsonb`), the postgres + memory watch `matchesFilter`, policy list-filters (zod "array" type + applyQueryFilter/matchField), the R4a round-trip oracle, + GIN index DDL (`IndexDef.type:"gin"`, `jsonb_path_ops`). GIN planner-usage proven at 2000-row volume.
- ✅ **40267a1 — audit-4054 (Steve):** 3 cross-surface parity bugs fixed — postgres watch had its OWN `matchesFilter` (no `$contains` → watch-noop), policy `matchField` silent-true, memory String-coercion. Typed `$contains` in all matchers + shared `assertKnownFilterOps` fail-loud guard.
- ✅ **b5c43d6 — audit-4064 (Steve):** 3-class operator taxonomy (IMPLEMENTED / FORBIDDEN / UNKNOWN); `assertKnownFilterOps` throws ONLY for UNKNOWN (forbidden = Zod-layer rejection).
- ✅ **46005af — audit-4070 #1:** matchers fail-CLOSED on an unevaluable predicate (a forbidden-only/empty op that bypassed Zod → match-NOTHING, never match-everything). New `hasImplementedFilterOp` SSOT helper across all 3 in-memory matchers; SQL path already fail-closed-by-throw. Fully closes audit-4064.
- ✅ **20cd7ae — audit-4070 #2:** WorkItem decode/round-trip edge coverage (7 real-pg cases).

### sub-PR-2 — the WorkItem kind (storage)
- ✅ **989540d — sub-PR-2a:** WorkItem SchemaDef + the write-encode migration module (kinds/WorkItem.ts) — the root-cause fix for the read-declared/write-missing seeding-bug; renameMap (status→status.phase + lease/evidence/blockedOn/leaseExpiryCount→status.*, priority/type/roleEligibility→spec.*); GIN index on spec.roleEligibility. Born under the governor (W1 inventory bumped).
- ✅ **1ad1fc8 — sub-PR-2b:** WorkItemRepositorySubstrate (create/get/list; decode-to-flat via cloneWorkItem). The lease nested-filter resolved via option (c) — bucket-prefixed dotted path `status.lease.holder` (governor-sanctioned, no renameMap alias).

### sub-PR-3 — verbs + evidence + claim-authority + MCP surface
- ✅ **e9002bf — sub-PR-3a verbs** (born under Steve's threat-model audit-4082): claim_work (per-agent advisory-lock WIP cap + ready→claimed CAS; two-agent race → per-row CAS one-winner) + start/block/resume/renew/release/abandon. Folded PRE-commit: #1 lease.token zombie-fence, #2 WIP counts all held leases, #4 holder+token auth, #5 terminal immutability, #6 structured blockedOn.
- ✅ **893cf98 — sub-PR-3a-ii complete_work + evidence predicate** (audit-4082 contract): coverage-by-binding + kind-match + freshness(±allowPreClaim) + refResolvable (audit→Audit, review→verifier-gate WorkItem) + no-double-count + empty-req floor; in_progress→review PARK FSM (done on review-evidence EXISTS, never a passing verdict); atomic (evidence stored only on pass) + dedup idempotency.
- ✅ **8d2baca — audit-4085 (Steve) claim authority:** claim_work re-enforces role-eligibility (empty=any) + dependency-readiness (all dependsOn done; absent=unmet) fail-CLOSED under the claim envelope — a direct claim-by-ID can't bypass the projection. New ClaimRejected. + atomic unchanged-row + claim lock-timeout tests.
- ✅ **8bf97e4 — sub-PR-3b MCP verb surface:** 9 PolicyRouter tools; spoof-proof caller identity (resolveCreatedBy — agentId+role from the session, args ignored); errorKind taxonomy; list_ready_work truncation-HONEST + empty-role OR-in. Wired into index.ts/AllStores.

### sub-PR-4 — resilience (sweeper + quarantine)
- ✅ **6673463 — sub-PR-4a lease-expiry sweeper + per-ITEM poison-guard:** expireLease CAS re-checks expiry (renew-vs-sweeper one-winner) → re-queue + leaseExpiryCount++, or POISON-ABANDON at N=3 (queryable audit). 60s tick << 15min TTL.
- ✅ **01261ed — sub-PR-4b-i Agent thrash schema** (born-under-governor): Agent.status += thrashCount + quarantined; dual-source encode/decode (kinds/Agent.ts + agent-envelope-shape.ts byte-for-byte + bespoke envelopeToAgent hoist + all-schemas renameMap + W1 inventory); recordWorkItemThrash/reset/clear on IEngineerRegistry (CAS-retry). 41 governor tests green.
- ✅ **958df36 — sub-PR-4b-ii thrash-quarantine wiring (C1→C2 seam):** sweeper increments the holder on claim→expire-without-evidence; claim_work locks out a quarantined agent; complete_work resets on success; clear_work_quarantine ([Architect|Director]) = the R2 manual escape.

---

## Decisions / knobs (architect-confirmed)

| Knob | Value | Note |
|---|---|---|
| per-role WIP cap | mechanism-present, **default-off** | per-agent cap (3) is the active backpressure at NARROW |
| LEASE_TTL_MS | 15 min | sweeper cadence (60s) << TTL |
| CLAIM_LOCK_TIMEOUT_MS | 5 s | acquire-timeout → fail-CLOSED reject |
| item-poison cap | N=3 | re-queue cycles → terminal abandon |
| agent-thrash cap | N=3 | claim→expire-without-evidence → quarantine |
| review-kind refResolvable | → verifier-gate WorkItem | no standalone Review entity (design §3.4 linkage) |
| un-quarantine | **manual** (R2) | C2 supervisor auto-recovery deferred |

---

## Test posture

- Full hub suite green at every push: final **2078 passed / 7 skipped / 0 fail** (173 files).
- Every sub-PR shipped with its own real-pg (testcontainers) matrix: $contains parity + GIN; WorkItem envelope round-trip + edge cases; the verb FSM + concurrency (same-item race, WIP-under-parallel, stale-token fence, counts-blocked); the evidence predicate (all 6 conditions + review-park); claim eligibility + deps + lock-timeout; the lease-sweeper (requeue/poison/renew-race); the agent thrash store + the cross-store wiring.
- Governor (W1/W4/W6 + R4a drift-gate/oracle) green after each schema touch — the born-under-governor backstop.

**Calibration note (for retro):** Steve's threat-models (audit-4082, audit-4085) landed mid-build and folded PRE-commit — born-under-review, zero rework, zero shipped-then-patched. The per-sub-PR delta-review cadence + the governor caught the seeding-bug, the fail-open hole, and the eligibility-bypass before any of them could ship.
