# M-Substrate-OCC-Primitive — Mission Closing Audit (FINAL)

**Mission:** mission-89 (M-Substrate-OCC-Primitive; idea-322 anchor)
**Phase:** 9 Close — COMPLETE via 4-PR primitive-extraction + envelope-aware audit arc
**Status:** FINAL — bug-127 PRODUCTION-VERIFIED 2026-05-26 08:08 UTC; bug-137 PRODUCTION-VERIFIED 2026-05-26 ~09:50 UTC; all 4 PRs MERGED
**Author:** engineer (greg) — draft 2026-05-26; architect ratify at PR-review
**Date:** 2026-05-26 (FINAL post-PR #303 dispositive)

## Mission outcome metrics

| Metric | Value |
|---|---|
| PRs shipped | 4 (#300, #301, #302, #303 — Phase 1+2 / (A3) hot-fix / Phase 3 / Phase 4) |
| LOC delta | +2161 / -439 across 4 PRs |
| New tests | 49 (20 advisory-lock primitive + 7 OCC mock + 3 OCC integration + 12 envelope-shape unit + 7 bug-137 dispositive) |
| Full hub suite at close | 1909/1909 passing |
| Bugs closed | bug-127 (production-verified) + bug-137 (production-verified) + bug-138 Agent-slice + entity-repo cascade-key class |
| Architectural-improvement | bug-97 retroactively-systemic (Counter primitive-serialized) |
| Mission duration | ~6h (Design v0.1 dispatch 2026-05-26 ~05:32 → Phase 5 close ~11:30 AEST) |

---

## §1 Per-PR scope summary

| PR | Phase | Scope | Diff | Commit |
|---|---|---|---|---|
| **#300** | Phase 1+2 bundled | `withAdvisoryLock` substrate primitive + assertIdentity migration off W10-ext retry-budget | +1147/-295; 10 files | cf7d2db |
| **#301** | (A3) hot-fix | Envelope-aware Agent read+write + bug-138 (Agent slice) close — `agent-envelope-shape.ts` module + 5 substrate-boundary wrappers + envelope-shape preservation on disk | +614/-46; 6 files | e20d410 |
| **#302** | Phase 3 | Counter migration to `withAdvisoryLock(LOCK_CLASS.Counter, domain, ...)` — bug-97 retroactively-systemic close; W5.5 retry-loop retained for cross-domain races | +63/-24; 2 files | 237786d |
| **#303** | Phase 4 | Hub-policy envelope-aware audit — `phaseFromEntity()` helper + 22 status-compare sites + 5 entity-repo cascade-key filter dual-lookups | +400/-45; 14 files | deb6e57 |
| **#304** | Phase 5 (this PR) | W10-ext OCC retry-budget code retirement + `occ_contention_exhausted` emit-site retirement + methodology #25 capture + closing audit + follow-on idea filings + mission close | TBD | TBD |

---

## §2 Bugs closed

### bug-127 — M18 assertIdentity OCC contention (PRODUCTION-VERIFIED-CLOSED)

- **Origin:** mission-88 W10-ext (architecturally-closed via 8-attempt retry-budget; persisted at production-rate contention)
- **Fix-pattern (PR #300 + #301):** advisory-lock primitive serializes same-fingerprint concurrent callers at the substrate layer; envelope-aware Agent read+write closes the downstream defect that blocked the dispositive
- **Production dispositive (2026-05-26 08:08 UTC):** bypass-tool M18 enriched `register_role(fingerprint=lily)` succeeded against pre-existing-envelope-shape Agent row → `{ok:true, agentId:'agent-40903c59'}`
- **Methodology lesson:** primitive-extraction alone is necessary-but-not-sufficient (see §3)

### bug-137 — Hub update_* envelope-blind status comparison (PRODUCTION-VERIFIED-CLOSED)

- **Origin:** mission-88 W11 close surface (Hub `update_*` policy handlers compared `current.status === input.status` where `current.status` was an envelope `{phase, ...}` object → always-true mismatch → "Invalid state transition" errors blocked legitimate updates; required psql workaround at mission-88 close)
- **Fix-pattern (PR #303):** `phaseFromEntity()` helper extracts envelope `status.phase` or legacy top-level `status` uniformly; applied at 22 status-comparison sites in policy/* (FSM transition guards + read-side aggregations + cascade dispatch)
- **Production dispositive (2026-05-26 ~09:50 UTC):** `update_bug(bug-137, status='resolved')` succeeded via MCP on envelope-shape Bug entity — no psql workaround. **The closure call IS the verify.**

### bug-138 — substrate.list filter envelope-blind (PARTIAL CLOSE — Agent slice + entity-repo cascade-key class)

- **Origin:** PR #300 dispositive surfaced this; engineer scope-depth audit identified deeper layer
- **Fix-pattern (PR #301 + #303):** Agent-specific envelope-aware repository wrapper pattern (PR #301) + entity-repo cascade-key dual-lookup pattern across Bug/Idea/Mission/Proposal/Task (PR #303); defense-in-depth envelope-first + legacy-fallback per W9 Q4 keep-legacy-branch refinement
- **Remaining systemic scope:** filed as follow-on **idea-323** (substrate.list query-builder reads SchemaDef renameMap + translates filter keys for envelope-shape rows; closes bug-138 systemically across all 21 kinds)

### bug-97 — Counter-collision (ARCHITECTURAL-IMPROVEMENT — stays `resolved` per mission-83 W5.5)

- **mission-83 W5.5 ORIGINAL CLOSE:** CAS retry-loop closed the production race surface
- **mission-89 Phase 3 REINFORCEMENT:** Counter migrated to `withAdvisoryLock(LOCK_CLASS.Counter, domain, ...)` — same primitive that closed bug-127's sibling; intra-domain races now lock-serialized (no retry-loop iterations); cross-domain races handled by retained W5.5 CAS retry-loop (architect-disposed; lock granularity is per-domain not per-row)
- **Production dispositive (2026-05-26 08:23 UTC):** 20 concurrent same-architect notes (each exercises Counter.next) → 20 unique ULIDs, 0 errors, 2.8s elapsed → lock-serialized Counter path PRODUCTION-VERIFIED

---

## §3 Methodology #25 + sub-disciplines

### Methodology #25 (capstone)

**Substrate-primitive-extraction is necessary-but-not-sufficient — per-callsite envelope-aware-audit must companion-ship.**

See work-trace `docs/traces/m-substrate-occ-primitive-work-trace.md` §Methodology #25 capstone for the load-bearing narrative.

### Sub-disciplines surfaced

1. **Concurrency-test invariant discipline** — advisory-lock concurrency tests pin to INVARIANTS (set-membership / monotonicity / no-interleaving / timeout-fired) NOT exact-timing or exact-ordering. 2 CI flakes this mission confirmed the pattern (PR #301 serialization-order strictness; PR #303 timing-floor strictness). Both fix-ups assert invariant correctness without over-specifying timing or which-goes-first.

2. **Dual-lookup pattern at filter-layer** — companion to W9 Q4 keep-legacy-branch refinement (which was about READ-side defensive coerce). Substrate-aware repository methods should ALSO do dual-shape filter lookups (envelope-first + legacy-fallback), not just dual-shape READS. Defense-in-depth for the dual-shape data window.

3. **Engineer-side mid-impl scope-cut as load-bearing authority** — PR #303 expanded mid-impl to 22 status-compare sites + 5 entity-repo filter dual-lookups, but engineer cut at deferring per-entity envelope-aware wrappers, task-repo internal reads, sweepers, and PendingAction/Message/Thread filters. Posted scope-cut explicitly in PR description + comment for architect ratify. Pattern: engineer-side scope-cut decisions are load-bearing when the load-bearing test target (bug-137 closure) is achieved while remaining work is non-blocking; surface explicitly so architect can ratify or expand.

4. **Test-fixture pre-cutover landmines** — PR #301 surfaced `mutateAgentBlob` + `offlineAgentSeenAt` fixtures producing mixed-shape data via `{...envelope, ...legacy-flat-patch}` spread. PR #303 surfaced cascade-idempotency + pulse-sweeper tests seeding legacy-shape rows. Methodology candidate: prescribe an envelope-aware test-fixture helper pattern OR force fixtures through the migration pipeline (creates SchemaDef-reconciler path for the kind, then writes via repo APIs) — tests that bypass the migration pipeline are perpetually drift-prone post-cutover.

5. **Pool-connection pinning + poll-waiter release** — first postgres `withAdvisoryLock` impl pinned conn across ENTIRE poll loop; caught at 10-concurrent storm test (pool-deadlock at K-concurrent with K-sized pool). Fix: holders pin, poll-waiters release between iterations. Architectural calibration: substrate connection-pool semantics interact with session-scoped locks in non-obvious ways; testcontainer 10+-concurrent test is the catch-net (smaller-K tests don't surface).

6. **Dispositive-call-IS-the-verify** — when a fix targets a Hub policy code path, run the policy operation against a production entity that exercises that code path; success of the operation IS the closure proof (no separate verify-suite needed). bug-137 closure was verified via `update_bug(bug-137, status='resolved')` succeeding cleanly via MCP — the operation that USES the bug-137 fix IS the proof.

---

## §4 Follow-on idea filings

Both filed via Hub `create_idea` at Phase 5 close; `sourceMissionId=mission-89`; status `open` for architect+Director Survey-disposition.

### idea-323 — M-Substrate-List-Filter-Envelope-Translation

**Scope:** substrate.list query-builder reads SchemaDef renameMap + translates filter keys for envelope-shape rows. Closes bug-138 systemically across all 21 entity kinds (not just Agent slice + 5 cascade-key callsites from PR #301 + #303 partial close).

**Architectural intent:** option (b) systemic substrate.list refactor that PR #303 deferred per scope-cut. Adds renameMap to SchemaDef OR loads from migration modules; substrate.list intercepts filter keys and translates to envelope JSONB sub-paths.

**Estimated mission-size:** medium (substrate-extension class).

### idea-324 — M-Repository-Envelope-Native

**Scope:** per-kind envelope-aware repository wrappers (the `agent-envelope-shape.ts` pattern from PR #301 × ~12 remaining kinds). Removes the dual-lookup pattern from PR #303 in favor of cleaner repository-layer encapsulation. Also closes the task-repository internal status-read defect class (unblockDependents/cancelDependents/getNextDirective/getNextReport/submitReport) and the sweeper substrate.list filter audit class (pulse-sweeper/cascade-replay-sweeper/message-projection-sweeper/scheduled-message-sweeper).

**Architectural intent:** brings all 11 remaining entity kinds to the Agent-pattern parity. Sweeper filter callsites + Task internal reads either fold into per-repo wrappers or are addressed as separate companion-ship per the methodology #25 pattern.

**Estimated mission-size:** large (12 entity kinds × ~600 LOC each in PR #301 reference scale).

---

## §5 Production verification evidence

### bug-127 dispositive (2026-05-26 08:08 UTC)

- Hub container rebuild + deploy-hub SUCCESS (post-PR #301 merge)
- Architect bypass-tool: `register_role(fingerprint=lily, role=architect)` against pre-existing envelope-shape Agent row at `id=agent-40903c59`
- Result: `{ok:true, agentId:'agent-40903c59'}` — first-attempt success; no occ_contention_exhausted; no role_mismatch
- Architect note (PR #303 issuecomment-4543227290): "bug-137 DISPOSITIVE PASSED via MCP on envelope-shape Bug entity — no psql workaround"

### Counter dispositive (2026-05-26 08:23 UTC)

- Hub container rebuild + deploy-hub SUCCESS (post-PR #302 merge)
- Production smoke: 20 concurrent architect notes (each triggers Counter.next("notificationCounter"))
- Result: 20 unique ULIDs; 0 errors; 2.8s total elapsed
- Lock-serialized Counter path PRODUCTION-VERIFIED for intra-domain concurrent calls

### bug-137 dispositive (2026-05-26 ~09:50 UTC)

- Hub container rebuild + deploy-hub SUCCESS (post-PR #303 merge)
- Architect operation: `update_bug(bug-137, status='resolved')` via MCP on envelope-shape Bug entity (the prior mission-88 W11 close-blocker)
- Result: succeeded cleanly — no "Invalid state transition" error; no psql workaround; first-attempt success
- **The closure call IS the verify** — `update_bug(bug-137, status='resolved')` proves bug-137 is closed by USING the bug-137 fix path successfully

---

## §6 Anti-goals (post-mission ratification)

These were OUT-OF-SCOPE per Design v1.0 §7 and remain out-of-scope at mission close:

1. Substrate-layer TOLERANT-mode read-normalization (idea-320) — separate substrate-extension; not addressed by mission-89
2. Repository envelope-native rewrite (idea-318) — full repository-layer rewrite; mission-89 scaled it tactically per the Agent-pattern + extracted the systemic version as idea-324
3. Per-callsite-retry-loop audit OUTSIDE Counter + assertIdentity — out of scope; only the two known callsites migrated
4. Notification-Audit consolidation (idea-321) — separate cluster
5. Hub-API v2.0 envelope-shape exposure (idea-121) — wire-level API surface; mission-89 was substrate-internal

## §7 References

- Design v1.0: `docs/designs/m-substrate-occ-primitive-design.md`
- Work-trace: `docs/traces/m-substrate-occ-primitive-work-trace.md`
- Anchor bugs: bug-127, bug-137, bug-138, bug-97 (sibling)
- Sibling-pattern precedent: mission-88 W9 PR #289 (tagsFromEntity), W9.1 PR #290 (arrayFieldFromEntity)
- Mission-88 closing audit: `docs/audits/m-k8s-envelope-closing-audit.md` (Phase 10 retrospective banks #15 OCC-class pattern + #24 envelope-aware-Hub-consumer-gap as motivating refinements that became mission-89's scope)
- Methodology #25 capstone (narrative): work-trace §Methodology #25
- Follow-on missions: idea-323 (substrate.list filter envelope-translation), idea-324 (repository envelope-native sweep)
