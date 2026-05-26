# m-substrate-occ-primitive-design

**Mission:** M-Substrate-OCC-Primitive (idea-322 anchor)
**Class:** substrate-extension (compound: substrate primitive + Hub-consumer audit)
**Status:** v1.0 RATIFIED — engineer Design-pass round-1 audit 2026-05-26 05:49 (sub-dispositions concurred); architect round-2 ratify with v1.0 updates applied
**Author:** architect (lily) — direct-to-Design dispatch per Director ratification 2026-05-25 (skip-direct-to-Design route-a per Idea Triage Protocol skip-criteria; lean-defaults applied for Q1/Q2/Q3)
**Anchor bugs:** bug-127 (M18 assertIdentity OCC contention; major), bug-137 (Hub update_* envelope-aware status comparison; minor; 3+ confirmed callsites), bug-97 (mission-83 W5.4 Counter-collision; sibling-pattern resolved-but-not-systemic)

---

## §0 Mission framing (per Director)

"Essentially to address a bug and a defect." (Director 2026-05-25)

- **bug** = bug-127 OCC contention surface (architecturally-closed in mission-88 W10-ext but production-rate contention persists); root pattern shared with bug-97 (Counter-collision; mission-83 W5.4)
- **defect** = bug-137 Hub-side `update_*` tools not envelope-aware on status-field comparison; surfaced at mission-88 Stage 4 close; confirmed 3+ instances (update_mission/update_idea/update_bug)

Both stem from substrate-engineering pattern-classes. This mission closes both classes systemically rather than per-instance.

## §1 Problem statement

### 1.1 OCC-class substrate-defect (bug + bug-97 sibling)

`hub/src/entities/agent-repository-substrate.ts` `assertIdentity` (line 341) and `Counter` callsites (bug-97 W5.4 era) implement OCC-race recovery via per-callsite retry loops:

```typescript
for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
  // ... lookup → mutate → putIfMatch → on-conflict retry ...
}
return { ok: false, code: "occ_contention_exhausted", ... };
```

The retry-loop pattern treats the SYMPTOM (lost race) but not the CLASS (no exclusive access primitive). Under production-rate concurrent contention (e.g., bypass-tool + active shim both binding fingerprint=lily), even widened budgets (W10-ext 8 attempts × 2s budget) fail consistently.

Symptom impact: M18 enriched handshake doesn't reliably succeed → adapter falls through to bare `register_role` → no Agent-entity binding → Mission-19 label-routing degraded → displacement-safe semantics degraded.

### 1.2 Hub-consumer envelope-aware audit gap (defect)

Mission-88 W7-W10 hardened the substrate read-path defensively (W9 `tagsFromEntity`, W9.1 `arrayFieldFromEntity`) but the Hub-policy update_* tools (`idea-policy.ts`, `mission-policy.ts`, `bug-policy.ts`, etc.) still compare `current.status === inputString`. With envelope-shape entities, `current.status` is `{phase, ...}` object, not string. Result: `"[object Object]" === "completed"` → false → "Invalid state transition" error.

Confirmed callsites (rapid audit 2026-05-25): update_mission, update_idea, update_bug. Likely scope: update_proposal, update_thread, update_turn, close_thread, force_close_thread, close_proposal — all entities with envelope-shape status FSM.

## §2 Architectural decision (lean-defaults per Director skip-Survey ratification)

### Q1 — withAdvisoryLock primitive: architecture + location (v1.0 — namespace-split form per engineer Q2)

**Decision: (c) Postgres pg_advisory_lock delegation primitive** — thin wrapper at substrate layer + namespace-split keyspace via 2-arg form per engineer Q2 sub-disposition (b) + timeout-via-poll-loop per engineer Q1 sub-disposition.

```typescript
// hub/src/storage-substrate/advisory-lock.ts (NEW)

export const LOCK_CLASS = {
  assertIdentity: 1,
  Counter: 2,
  // Add new classes here; reserve up to int32 max
} as const;
export type LockClass = typeof LOCK_CLASS[keyof typeof LOCK_CLASS];

export class LockAcquisitionTimeoutError extends Error {
  constructor(public lockClass: LockClass, public lockKey: string, public elapsedMs: number) {
    super(`pg_advisory_lock acquisition timeout after ${elapsedMs}ms (class=${lockClass}, key=${lockKey})`);
  }
}

export async function withAdvisoryLock<T>(
  substrate: HubStorageSubstrate,
  lockClass: LockClass,
  lockKey: string,
  fn: () => Promise<T>,
  opts?: { timeoutMs?: number; latencyWarnMs?: number },
): Promise<T> {
  const numericKey = hashToInt32(lockKey);  // 2-arg form: int4 class + int4 key
  const startedAt = Date.now();
  const timeoutMs = opts?.timeoutMs;
  const latencyWarnMs = opts?.latencyWarnMs ?? 100;

  // Acquire via pg_try_advisory_lock poll-loop (NOT SET lock_timeout — session-scoped + needs RESET in pooled-conn contexts)
  while (true) {
    const { rows } = await substrate.query(
      "SELECT pg_try_advisory_lock($1, $2) AS acquired",
      [lockClass, numericKey],
    );
    if (rows[0].acquired) break;
    const elapsed = Date.now() - startedAt;
    if (timeoutMs !== undefined && elapsed >= timeoutMs) {
      throw new LockAcquisitionTimeoutError(lockClass, lockKey, elapsed);
    }
    await sleep(10);  // 10ms poll cadence
  }

  const acquiredAt = Date.now();
  const acquireLatencyMs = acquiredAt - startedAt;
  if (acquireLatencyMs > latencyWarnMs) {
    console.warn(`[advisory-lock] acquire latency ${acquireLatencyMs}ms exceeded ${latencyWarnMs}ms (class=${lockClass}, key=${lockKey})`);
  }

  try {
    return await fn();
  } finally {
    await substrate.query("SELECT pg_advisory_unlock($1, $2)", [lockClass, numericKey]);
  }
}
```

Rationale (v1.0 refinements):
- **Namespace-split via 2-arg form** — `pg_advisory_lock(int4 class, int4 key)` gives isolated keyspaces per class. assertIdentity:fingerprint-A can NEVER collide with Counter:Idea structurally. Per engineer Q2 disposition: CRC32 (int32; ~100% collision @ 100k keys) was wrong choice; 2-arg form eliminates cross-class collisions; intra-class collisions remain at ~3e-10 per xxhash64 OR int32 hash (acceptable for sparse keyspace).
- **Timeout via `pg_try_advisory_lock` poll-loop** (NOT `SET lock_timeout` which is session-scoped + needs RESET in pooled-conn contexts) — engineer Q1 sub-disposition; correct architectural choice.
- **Distinct `LockAcquisitionTimeoutError`** — caller can distinguish lock-timeout from fn-throws-in-callback (different recovery semantics). Tests assert this discriminability.
- **Observability via latency-warn log** (default 100ms threshold; per-callsite opt-out via `latencyWarnMs: Infinity`) — replaces W10-ext retry-budget-counter observability that's retired in Phase 5.
- Other rationale unchanged: minimal surface; native mechanism; session-scoped auto-release; composable try/finally; no new tables/state.

### Q2 — Consumer migration scope: how aggressive

**Decision: (b) assertIdentity + Counter** — closes bug-127 + retroactively-systemic-fixes bug-97 sibling.

Rationale:
- Two known callsites with OCC-race history; both upgrade in same mission
- Closes the substrate-defect-pattern at all known instances (not just bug-127)
- Defers (c) full audit to follow-on idea if more callsites surface
- Limits regression-risk vs full-substrate-audit scope

Migration pattern (per callsite; v1.0 namespace-split form):
```typescript
// Before
for (let attempt = 0; attempt < 8; attempt++) { /* OCC race + retry */ }

// After (v1.0 — namespace-split per engineer Q2 disposition)
return await withAdvisoryLock(substrate, LOCK_CLASS.assertIdentity, fingerprint, async () => {
  /* single-attempt lookup + putIfMatch */
});
```

### Q3 — Hub-consumer envelope-aware audit (bug-137 fold) approach

**Decision: (a) `phaseFromEntity(entity)` helper at each update_* tool** — sibling pattern of W9 `tagsFromEntity` + W9.1 `arrayFieldFromEntity`.

```typescript
// hub/src/entities/shape-helpers.ts (EXTEND existing file)
export function phaseFromEntity(entity: unknown): string | null {
  if (entity === null || typeof entity !== "object") return null;
  const e = entity as Record<string, unknown>;
  // Legacy-flat: status is string
  if (typeof e.status === "string") return e.status;
  // Envelope: status is object with phase field
  if (e.status && typeof e.status === "object") {
    const s = e.status as Record<string, unknown>;
    if (typeof s.phase === "string") return s.phase;
  }
  return null;
}
```

Apply at every `current.status === inputString` comparison site in policy files. Mechanical migration; locked by unit tests asserting both legacy-flat + envelope shapes.

Rationale:
- Mirrors proven pattern (W9 + W9.1 deployed in production; bug-125 + bug-134 closed)
- Surgical per-callsite; bounded blast-radius
- Lossy round-trip discipline already established (per W9 keep-legacy-branch refinement)
- Doesn't require substrate-layer changes
- Future-compatible with (b) substrate-layer normalization OR (c) repository envelope-native rewrite if those land later

## §3 Implementation phases

### Phase 1 — Substrate primitive

- `hub/src/storage-substrate/advisory-lock.ts` (NEW; ~30 lines + 1 hashToInt64 helper)
- `hub/src/storage-substrate/__tests__/advisory-lock.test.ts` (NEW; testcontainer postgres; mock for memory-substrate)
- Memory-substrate variant for testability (in-process mutex map; no real lock semantics; OK for unit tests)
- Tests: concurrent withAdvisoryLock for same key serialize; different keys parallelize; finally-release on fn-throw; pg disconnect releases

### Phase 2 — Migrate assertIdentity (closes bug-127 production-verified)

- `hub/src/entities/agent-repository-substrate.ts` — replace retry loop with `withAdvisoryLock(substrate, 'assertIdentity:'+fingerprint, async () => ...)`
- Update tests: existing W10-ext mock-substrate tests + new integration test (testcontainer; 2 concurrent assertIdentity for same fingerprint; both succeed in serial)
- Architect-side dispositive verification post-merge + Hub rebuild: bypass-tool M18 enriched register_role succeeds even with active lily shim concurrently registered

### Phase 3 — Migrate Counter (closes bug-97 retroactively-systemic)

- `hub/src/entities/substrate-counter.ts` (per mission-83 W5.4 fix-site) — wrap counter-issue + createOnly inside `withAdvisoryLock(substrate, 'Counter:'+kind, ...)`
- Update tests: counter-collision concurrent-call test (testcontainer; multiple concurrent counter-issue calls serialize)

### Phase 4 — Hub-consumer envelope-aware audit (bug-137 fold; v1.0 file-list expanded per engineer Q4 scope-finding)

- `hub/src/entities/shape-helpers.ts` — add `phaseFromEntity(entity)` per Q3 (extend existing file from W9 + W9.1) + null-guard error message clarity per engineer Observation 3
- **Audit + patch — file-list expanded per engineer Q4 grep-walk** (originally 9 files; expanded to 13+ confirmed; impl-time grep-walk replaces this list with actual count, both pre/post documented in commit):
  - `hub/src/policy/idea-policy.ts` (update_idea)
  - `hub/src/policy/mission-policy.ts` (update_mission)
  - `hub/src/policy/bug-policy.ts` (update_bug)
  - `hub/src/policy/proposal-policy.ts` (update_proposal + close_proposal + line 355 sub-entity task.status check)
  - `hub/src/policy/turn-policy.ts` (update_turn)
  - `hub/src/policy/task-policy.ts` (update_task)
  - `hub/src/policy/review-policy.ts` (review state transitions + line 43 task.status === "completed")
  - `hub/src/policy/thread-policy.ts` (close_thread / force_close_thread / leave_thread state checks; lines 537/634/643 explicit confirmation)
  - **NEW (engineer Q4 grep)**: `hub/src/policy/cascade-actions/update-mission-status.ts:65` (`mission.status === "active"`)
  - **NEW**: `hub/src/policy/preconditions.ts:70` (`thread?.status === "active"`)
  - **NEW**: `hub/src/policy/system-policy.ts:51,59,71` (Task status compares: in_review/completed/failed/active)
- **Phase 4 impl protocol:** grep-walk ALL of `hub/src/policy/*.ts` (and any `*-policy.ts` outside policy/) for `\.status === "[a-z_]+"` patterns; replace listed file-list with grep-derived list at impl-time; commit message documents both pre-grep + post-grep counts (closing-audit pattern)
- Tests: per-callsite unit test asserting both legacy-flat string + envelope-object status comparison works; regression-guard ensures `phaseFromEntity` never throws
- **Null-status guard** (engineer Observation 3): at every update_* callsite, if `phaseFromEntity(current) === null`, return clearer error `"Entity has no readable status; envelope shape may be malformed"` rather than the FSM-rejection error path's null/object stringification

### Phase 5 — Dispositive verification + cleanup (v1.0 — engineer Observations 2 + 4 absorbed)

- Architect dispositive tests post-rebuild:
  - `update_mission(mission-89, status='completed')` via shim → succeeds (was the bug-137 mission-88 close blocker)
  - `update_idea + update_bug` via shim → succeeds
  - 2 concurrent `assertIdentity` (architect bypass + shim) → both succeed within wall-time
  - **Observation 2 fold:** post-deploy, restart greg-shim 5x with active lily shim; grep `~/work-dir/.ois/shim.log` for `parse_failed`; **zero occurrences = pass** (adapter handshake parse_failed eliminated)
- Retire W10-ext per-callsite 8-attempt budget code (was the symptomatic fix; now obviated by primitive)
- **Observation 4 fold:** retire code-emission of `"occ_contention_exhausted"` AssertIdentityFailure code (primitive replaces emit-site); KEEP enum-value with `@deprecated` JSDoc + retain test-coverage for the enum-discriminator path (callers may have logged; future regression-grep value). Formal enum-removal deferred to follow-on idea.
- File post-mission methodology calibration #25 candidate: substrate-primitive-extraction-pattern (when 2+ callsites share a defect-class, extract primitive vs fix per-callsite)

## §4 Test plan

### 4.1 Unit tests
- `advisory-lock.test.ts` — primitive correctness (acquire/release/serialize/parallelize/exception-safe)
- `phaseFromEntity` tests in `shape-helpers.test.ts` extension — legacy-flat / envelope / missing / null / non-string / non-object

### 4.2 Integration tests (testcontainer postgres — REQUIRED per engineer Observation 1)

**Engineer Observation 1 fold:** memory-substrate variant is contention-mute (in-process mutex map doesn't reflect real-pg lock semantics; mission-83 W5.4 Counter-collision was real-pg-only). **Tests verifying contention-serialization MUST hit testcontainer postgres**; tests where lock-presence is incidental may use memory variant.

- assertIdentity concurrent-binding (2 callers; both succeed; serialized via lock) — **testcontainer pg required**
- Counter concurrent-issue (3 callers; sequential int allocation; no duplicates) — **testcontainer pg required**
- Hub policy update_* — legacy-shape row + envelope-shape row both accept status='completed' — memory variant OK
- LockAcquisitionTimeoutError discriminability test (per engineer Q1 sub-disposition; assert distinct from holder-throws-in-fn errors) — testcontainer pg required

### 4.3 Regression tests
- W10-ext per-callsite retry-budget tests deleted (replaced by primitive-locking; no retry needed)
- bug-127 production repro: 2 sessions binding same fingerprint succeed without OCC error
- bug-137 production repro: update_mission via shim returns OK (not "Invalid state transition")

### 4.4 Architect dispositive (post-deploy)
- Bypass-tool M18 enriched register_role with active lily shim → succeeds
- `update_mission(mission-89, status='completed')` via shim → succeeds
- Shim's parse_failed pattern post-restart no longer fires (M18 reliably succeeds)

## §5 Acceptance criteria

1. `withAdvisoryLock` primitive exists at substrate layer + tested
2. assertIdentity uses primitive (bug-127 production-verified-closed via concurrent-fingerprint test)
3. Counter uses primitive (bug-97 retroactively-systemic-fixed)
4. All Hub update_* tools envelope-aware via `phaseFromEntity` (bug-137 production-verified-closed via shim update_mission test)
5. W10-ext retry-budget code retired (symptom-fix obviated by primitive)
6. Adapter handshake parse_failed pattern eliminated (M18 reliably succeeds)
7. Closing-audit + Phase 10 retrospective bank methodology calibration #25

## §6 Architect-asks (engineer Design-pass round-1)

1. **pg_advisory_lock vs pg_try_advisory_lock_timeout** — should withAdvisoryLock have a timeout? If lock-holder hangs forever, caller waits forever. Lean: yes, accept `timeoutMs?: number` param; default no-timeout for backwards-compatibility with retry-loop replacement semantics.

2. **hashToInt64 collision** — postgres advisory locks take int64; string keys hash to int64 may collide. Lean: use stable CRC32 or similar deterministic hash; document collision risk (~1e-10 for sparse keys); cite in JSDoc.

3. **Counter Phase 3 separate PR or fold into Phase 2?** — assertIdentity (bug-127) is the critical path; Counter (bug-97 retroactively) is nice-to-have. Lean: separate PR per phase for clean review; engineer-judgment if you prefer bundled.

4. **Hub-policy audit completeness — should we also audit non-status comparisons?** — bug-137 surfaced status-string-comparison; are there other envelope-aware-required compares (e.g., enum fields, nested-config fields)? Lean: scope Phase 4 to status-comparison only; file follow-on idea if other classes surface during impl.

## §7 Out of scope

- Substrate-layer TOLERANT-mode read-normalization (idea-320; alternative to per-callsite phaseFromEntity)
- Repository envelope-native rewrite (idea-318; deeper rewrite)
- Per-callsite-retry-loop audit in OTHER files (not Counter or assertIdentity)
- Notification-Audit consolidation (idea-321)
- Hub-API v2.0 envelope-shape exposure (idea-121)

## §8 References

- **Anchor bugs:** bug-127, bug-137, bug-97 sibling
- **Origin:** mission-88 W10-ext A5 engineer-observation + mission-88 Stage 4 close bug-137 surface
- **Sibling pattern proven:** mission-88 W9 PR #289 (tagsFromEntity), W9.1 PR #290 (arrayFieldFromEntity)
- **Mission-88 closing audit:** docs/audits/m-k8s-envelope-closing-audit.md (Phase 10 retrospective banks #15 OCC-class pattern + #24 envelope-aware-Hub-consumer-gap as motivating refinements)
- **methodology refinement #25 candidate:** substrate-primitive-extraction (2+ callsites share defect-class → extract primitive)
