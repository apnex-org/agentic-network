# M-Substrate-OCC-Primitive — Work Trace (live state)

**Mission scope.** Tracks in-flight, queued, and recently-completed work under mission-89 (M-Substrate-OCC-Primitive; idea-322 anchor). Goal: close bug-127 (M18 assertIdentity OCC contention) + bug-97 (Counter-collision retroactively-systemic) + bug-137 (Hub update_* envelope-aware status comparison) via substrate-level advisory-lock primitive + Hub-policy envelope-aware audit. Scope-expanded to fold bug-138 (substrate.list filter envelope-blind class) into Phase 4 systemic refactor.

**Design doc:** `docs/designs/m-substrate-occ-primitive-design.md` (v1.0 RATIFIED at PR #299 commit 5b5efa7).
**Architect:** lily (driving).
**How to read + update this file:** `docs/traces/trace-management.md`.

**Status legend:** ▶ in-flight · ✅ done this session · ○ queued / filed · ⏸ deferred

---

## Resumption pointer (cold-session brief)

If you're picking up cold:

1. **Read this file first**, then the Design doc.
2. **Hub mission id:** mission-89 (status=active as of 2026-05-26 AEST per architect note + create_mission via psql workaround; correlationId="mission-89").
3. **Currently in-flight:** PR #301 (A3) hot-fix CI re-running post-flake fix; awaiting architect Hub-rebuild + bypass-tool M18 dispositive verify.
4. **Director-ratified skip-direct-to-Design:** Survey skipped 2026-05-25 ("essentially to address a bug and a defect"). Lean-defaults applied for Q1 (pg_advisory_lock delegation), Q2 (assertIdentity + Counter scope), Q3 (phaseFromEntity helper at update_* tools).
5. **Engineer round-1 audit absorbed (Design v0.1 → v1.0):** namespace-split via `pg_advisory_lock(int4 class, int4 key)` 2-arg form (replaces CRC32-int32 plan); timeoutMs + LockAcquisitionTimeoutError + latency-warn observability; PR cadence Phase 1+2 bundled then 3/4/5 separate; Phase 4 scope expanded to include cascade-actions/preconditions/system-policy/review-policy.
6. **Anti-goals (hold firm):** substrate-layer TOLERANT-mode read-normalization (idea-320); repository envelope-native rewrite (idea-318); per-callsite-retry-loop audit outside Counter/assertIdentity; Notification-Audit consolidation (idea-321); Hub-API v2.0 (idea-121).

---

## In-flight

▶ **PR #302** (agent-greg/m-occ-primitive-pr2-counter) — Phase 3 Counter primitive migration
- Status: pushed; CI just-kicked-off
- Diff: 2 files; +63 / -24
- Awaiting: CI green → architect admin-merge → Hub-rebuild → 2-concurrent-Counter.issue same-kind serialize dispositive
- Lock-granularity: per-domain `withAdvisoryLock(LOCK_CLASS.Counter, domain, ...)` per architect dispatch ("per-kind lockKey isolation")
- W5.5 retry-loop RETAINED (cross-domain races on shared single-row Counter still possible; lock only serializes intra-domain)

---

## Done this session

✅ **PR #301** (agent-greg/m-occ-primitive-pr1.1-bug-138) — (A3) envelope-aware Agent r/w + bug-138 (Agent slice) close
- MERGED 2026-05-26 08:08 UTC; Hub-rebuild + dispositive verify CONFIRMED
- 6 files; +614 / -46
- bypass-tool M18 enriched register_role for fingerprint=lily succeeded against pre-existing-envelope-shape Agent row → **bug-127 PRODUCTION-VERIFIED-CLOSED** + **bug-138 (Agent slice) CLOSED**
- bug-138 substrate-systemic class STAYS FILED for Phase 4 (cross-cutting substrate.list-filter shape-aware refactor for all entity kinds)
- Pre-flake CI surfaced ordering-flake in `serializes concurrent calls` test (CI saw B-first vs local A-first); fix-up commit 7337a6e assert-invariant (no-interleaving) instead of specific order

✅ **PR #300** (agent-greg/m-substrate-occ-primitive-pr1) — Phase 1+2 bundled: substrate primitive + assertIdentity migration
- Merged to main as commit cf7d2db
- 10 files; +1147 / -295
- Phase 1: `HubStorageSubstrate.withAdvisoryLock(class, key, fn, opts?)` interface method; postgres impl uses 2-arg `pg_try_advisory_lock(int4, int4)` namespace-split on PINNED pool-connection; poll-waiters release conn between failed polls (caught during 10-concurrent storm test; first impl deadlocked the 10-slot pool)
- Phase 2: assertIdentity W10-ext retry-budget retired; single-attempt lookup+mutate under `withAdvisoryLock(LOCK_CLASS.assertIdentity, fingerprint, ...)`
- 30 new tests passing (20 primitive + 7 mock + 3 integration); full hub 1886/1886 green
- Dispositive verify post-deploy FAILED → surfaced bug-138 → triggered PR #301

✅ **PR #299** (agent-lily/idea-322-design) — Design v0.1 → v1.0 RATIFIED
- Merged to main as commit 0341229
- Engineer round-1 audit (issuecomment-4540712481) filed substantive sub-dispositions on 3 of 4 architect-asks + additive Phase 4 scope-finding
- Architect round-2 absorbed all sub-dispositions into v1.0

✅ **bug-138 surfaced via PR #300 dispositive verify** (architect-side at PR #300 issuecomment-4541418699)
- Root cause traced: substrate.list({filter:{fingerprint}}) is envelope-blind for indexed fields; post-W11-cutover Agent rows have fingerprint at metadata.fingerprint (NULL at top-level); lookup → empty → createOnly → conflict → defensive occ_contention_exhausted
- Engineer scope-depth audit on PR #300 (issuecomment-4541494939) identified deeper layer: normalizeAgentShape on envelope input → agent.role===undefined → role_mismatch FATAL halt downstream; lookup-only fix insufficient
- 3 disposition options proposed (A1 lookup-only, A2 lookup+read-coerce, A3 full envelope-aware)
- Architect ratified (A3) at issuecomment-4541511547 per perfection-pattern (declining workaround-class A1/A2)

---

## Queued / filed

○ **PR 3** — Phase 4 Hub-policy envelope-aware audit (closes bug-137 + folds bug-138 systemic)
- File: extend `hub/src/entities/shape-helpers.ts` with `phaseFromEntity(entity)`
- Patch ~13 policy files per Design §3 Phase 4 file-list (grep-walk at impl-time to verify completeness)
- ALSO: systemic substrate.list shape-aware refactor for all entity kinds (folds bug-138 beyond Agent-specific PR #301 tactical fix)
- bug-139 (Agent write-shape preservation) FOLDED into Phase 4 substrate.list refactor scope per architect (A3) ratify

○ **PR 4** — Phase 5 dispositive verify + cleanup + methodology #25 capture
- Retire W10-ext per-callsite 8-attempt budget code (already retired in PR #300; Phase 5 confirms removal)
- Retire emit-site of `occ_contention_exhausted` per Observation 4 (KEEP enum value with @deprecated JSDoc; retain test-coverage)
- File methodology calibration #25 candidate: substrate-primitive-extraction-pattern

---

## Deferred

⏸ **Test fixture envelope-awareness grep-walk** — identified at PR #301 surface: `mutateAgentBlob` (wave1-policies.test.ts) + `offlineAgentSeenAt` (m18-agent.test.ts) wrote mixed-shape data via `{...envelope, ...legacy-flat-patch}` pattern that broke envelope roundtrip. Both fixed in PR #301. Methodology refinement candidate: other entity-kinds' test fixtures may carry the same pattern pre-W11-cutover; flag for Phase 4 grep-walk scope (`grep -rn "substrate\.put.*\.\.\..*entity" hub/test/`).

---

## Closing audit (engineer-side)

To file at Phase 10 retrospective:

1. **Pool-connection pinning + poll-waiter release** — first postgres impl pinned conn across ENTIRE poll loop; caught at 10-concurrent storm test (pool-deadlock at K-concurrent with K-sized pool). Fix: holders pin, poll-waiters release between iterations. Architectural calibration: substrate connection-pool semantics interact with session-scoped locks in non-obvious ways; testcontainer 10+-concurrent test is the catch-net (smaller-K tests don't surface).

2. **CI-vs-local ordering flake** — advisory-lock serialization assertion was strict A-first; local always saw A-first due to Promise.all event-loop ordering; CI saw B-first under different timing. Fix: assert invariant (no-interleaving) not specific ordering. Inverse-shape of `feedback_test_assertion_too_permissive_regex` (which over-permits) — this was OVER-strict.

3. **Test-fixture pre-cutover write-pattern decay** — `{...envelope, ...legacy-flat-patch}` produces mixed-shape data that breaks envelope roundtrip. Both `mutateAgentBlob` + `offlineAgentSeenAt` pre-dated W11 cutover; envelope-shape decoding tolerance hid the regression initially. Fix: round-trip envelope→legacy→patch→envelope at fixture layer. Methodology candidate: grep `substrate.put.*\.\.\..*entity` across all test fixtures for similar drift.

4. **Lookup-only fix insufficient when downstream code reads legacy-flat top-level fields** — engineer scope-depth audit caught this BEFORE shipping PR #301-with-lookup-only-fix-only. Methodology: when a fix touches an envelope-shape-aware boundary, audit downstream code-paths that consume the returned data; spreading the encode/decode across the full substrate-boundary surface (not just the failing site) is the dispositive close.

5. **bug-138 framing: Agent-specific tactical vs substrate-systemic** — architect could have dispatched (A3) as substrate.list shape-aware refactor (bug-138 root); instead dispatched as Agent-repository-tactical (preserves bug-138 for Phase 4 systemic). Trade-off: Agent-specific PR is smaller diff + clearer scope; Phase 4 absorbs the systemic refactor with all entity-kinds in scope. Architectural pattern: "tactical fix per entity + systemic refactor at the cross-cutting boundary" is sound vs "expand THIS PR to systemic" which would inflate scope.

---

## Session log

(AEST timestamps per `project_session_log_timezone`)

**2026-05-26 (Tue) 14:32-18:00 AEST:**
- Phase 4 Design v0.1 dispatch on PR #299; engineer round-1 audit filed (issuecomment-4540712481); architect round-2 ratify → v1.0
- Mission-89 spawned; engineer dispatched to PR 1 (Phase 1+2 bundled)
- PR #300 shipped: 10 files, 30 new tests, full hub 1886/1886 green, merged cf7d2db
- bug-138 surfaced via architect dispositive verify; engineer scope-depth audit on PR #300 issuecomment-4541494939
- Architect (A3) ratified
- PR #301 shipped: agent-envelope-shape module + 5 substrate-boundary wrappers + envelope-aware Agent r/w + 12 unit tests + new testcontainer regression + 2 test-fixture envelope-aware updates; full hub 1899/1899 green
- CI flake on advisory-lock serialization assertion; flake-fix committed (7337a6e)
- Work-trace authored (this file) — late per `feedback_per_mission_work_trace_obligation` (should have been at mission-spawn)
