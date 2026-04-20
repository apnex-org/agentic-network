# Phase 2d Checkpoint 2 — Protocol Standardization + Convergence Hardening

**Mission:** M-Cognitive-Hypervisor
**Task:** task-307 (Phase 2d CP2)
**Thread:** thread-232 (architect brainstorm + design convergence)
**Date:** 2026-04-20
**Scope of this report:** the CP2 deliverables defined in the CP1 audit report §5.1 + the refinements architect issued via task-307 directive + thread-232 mid-flight design guidance:

- Observability read surface for the CP1 counters (`get_metrics` MCP tool)
- Instructional format for `ThreadConvergenceGateError` (structured subtype + remediation + metadata)
- INV-TH17 policy-layer shadow instrumentation (absorbs bug-15)
- Stale-staged-action revalidation at the convergence gate (new registry-based pattern)
- Bug-14 absorption (update-handler idempotency via no-op detection)
- `_ois_query_unmatched` sentinel sweep on the filtered list_* tools task-306 didn't touch

All code changes landed in commits `761bd39` (C1), `da405ce` (C2), `c3bb864` (C3), `9a63303` (C4), `3ec03df` (C5) on `main`.

---

## 1. Deliverable scorecard

| CP2 deliverable (from CP1 §5.1 + task-307 directive + thread-232) | Status | Evidence |
|---|---|---|
| `get_metrics` read-only MCP tool (architect-only) | ✅ Complete | `hub/src/policy/system-policy.ts`; 5 integration tests in `policy-router.test.ts` |
| `ThreadConvergenceGateError` → instructional format with subtype + remediation | ✅ Complete | `hub/src/state.ts` (class + `CONVERGENCE_GATE_REMEDIATION` table); 6 subtype tests in `wave3b-policies.test.ts` |
| Subtype + remediation populated at throw sites (no message-string parsing) | ✅ Complete | All 8 throw sites across `state.ts` + `gcs-state.ts` updated; policy-layer catch simplified |
| Optional `metadata` field for stale_reference + invalid_transition | ✅ Complete | Added in C4; carries `{entityType, entityId, currentStatus?, attemptedStatus?}` |
| Authority-rejection path returns same structured JSON shape | ✅ Complete | `thread-policy.ts` converger-authority block; test at `wave3b-policies.test.ts` |
| INV-TH17 policy-layer shadow instrumentation (bug-15 absorbed) | ✅ Complete | Post-diagnostic on null-reply path in `thread-policy.ts`; 2 tests covering breach + no-breach |
| Stale-staged-action revalidation at convergence gate | ✅ Complete | Registry-based pattern in `hub/src/policy/action-validators/`; integration at `thread-policy.ts` bilateral-commit site |
| Bug-14: update-handler idempotency (no-op detection) | ✅ Complete | `cascade-actions/update-idea.ts` now returns null on no-op; runner's existing `cascade.idempotent_update_skip` path fires |
| New `stale_reference` + `invalid_transition` subtypes | ✅ Complete | Added to `ConvergenceGateSubtype` union + `CONVERGENCE_GATE_REMEDIATION` table |
| `_ois_query_unmatched` sentinel on list_proposals, list_audit_entries, list_bugs | ✅ Complete | Added in C5; 6 new tests |
| Audit report (this document) | ✅ Complete | This file |

CP2 unblocks CP3 (reaper + lifecycle GC — no hard dependency, independent) and CP4 (`retry_cascade` — bug-14 is now closed; update handlers are idempotent).

---

## 2. New observability surface

### 2.1 `get_metrics` MCP tool

Two invocation shapes:

**Compact snapshot (default):**
```
get_metrics({})
→ {snapshot: {"inv_th19.shadow_breach": 3, "cascade_fail.execute_threw": 1, ...}}
```

**Bucket drill-down:**
```
get_metrics({bucket: "inv_th19.shadow_breach", limit: 32})
→ {bucket: "inv_th19.shadow_breach",
   count: 3,
   recentDetails: [{at: "2026-04-20T...", details: {...}}, ...]}
```

Counter state is per-process; Hub restart resets all counts. For a persisted observability path the audit log (`list_audit_entries`) remains authoritative — every shadow breach + failure type also writes an audit entry via `logShadowInvariantBreach`.

### 2.2 New counters introduced in CP2

| Bucket | Fires when | Added by |
|---|---|---|
| `convergence_gate.rejected` with subtype tag | Every gate rejection (includes new subtypes) | CP2 C2 (reuse + new subtypes) |
| `inv_th17.shadow_breach` | Agent-pinning turn violation detected at policy layer | CP2 C3 |
| `convergence_gate.noop_detected` | At least one validator returned `isNoOp=true` | CP2 C4 |
| `cascade.idempotent_update_skip` (pre-existing, now fires for update_idea) | update handler returns null on re-application | CP2 C4 bug-14 fix |

### 2.3 Counter taxonomy after CP2 (full inventory)

Shadow-breach buckets:
```
inv_th17.shadow_breach   — [CP2 C3] agent-pinning turn violation
inv_th18.shadow_breach   — [CP1] routing mode/field consistency
inv_th19.shadow_breach   — [CP1] convergence gate rejection (now carries subtype via CP2 C2)
inv_th25.shadow_breach   — [CP1] cascade depth MAX reached
inv_th25.near_miss       — [CP1] cascade depth = MAX-1
```

Convergence-gate buckets:
```
convergence_gate.rejected              — umbrella, subtype tag in detail payload
                                          subtypes: stage_missing, summary_missing,
                                          payload_validation, revise_invalid, retract_invalid,
                                          authority, stale_reference, invalid_transition
convergence_gate.authority_rejected    — per-action commit authority denial
convergence_gate.noop_detected         — [CP2 C4] ≥1 validator returned isNoOp=true
create_thread.routing_mode_rejected    — INV-TH18 rejection at create_thread
```

Cascade-failure / idempotency buckets (unchanged from CP1):
```
cascade_fail.depth_exhausted
cascade_fail.unknown_spec
cascade_fail.execute_threw
cascade_fail.dispatch_failed
cascade_fail.audit_failed
cascade.idempotent_skip
cascade.idempotent_update_skip   — [CP2 C4 bug-14] now fires for update_idea on no-op
```

---

## 3. ThreadConvergenceGateError structured error format

### 3.1 JSON shape returned to callers

```jsonc
{
  "success": false,
  "error": "...human-readable message...",
  "subtype": "stale_reference | invalid_transition | stage_missing | ...",
  "remediation": "...actionable instruction for the caller...",
  "metadata": { "entityType": "mission", "entityId": "mission-42", ... }   // optional
}
```

### 3.2 Subtype enumeration (complete)

| Subtype | Raised by | Metadata shape | Introduced |
|---|---|---|---|
| `stage_missing` | `state.ts` / `gcs-state.ts` bilateral-convergence gate | n/a | CP2 C2 |
| `summary_missing` | Same | n/a | CP2 C2 |
| `payload_validation` | Same (via validateStagedActions) | n/a | CP2 C2 |
| `revise_invalid` | `applyStagedActionOps` | n/a | CP2 C2 |
| `retract_invalid` | Same | n/a | CP2 C2 |
| `authority` | `thread-policy.ts` converger-authority block | n/a | CP2 C2 |
| `stale_reference` | Registry validator (update_mission_status, update_idea) | `{entityType, entityId}` | CP2 C4 |
| `invalid_transition` | Registry validator (update_mission_status, create_task parent check) | `{entityType, entityId, currentStatus, attemptedStatus?}` | CP2 C4 |

### 3.3 Caller self-correction workflow

The `remediation` field is written for the LLM caller's benefit:
- Short, actionable
- References the exact field or shape to populate (e.g. `"populate stagedActions with at least one stage action..."`)
- For stale_reference / invalid_transition, names the exact entity + state transition that failed

Makes mitigation #6 (tool-error elision) from bug-11 / idea-132 *mechanizable* — the adapter can key off `subtype` to decide whether to correct-and-retry silently vs. surface the error to the LLM.

---

## 4. Action-validator registry (C4)

### 4.1 Architecture

```
hub/src/policy/action-validators/
├── types.ts                                      IActionValidator, ValidationContext, ValidationResult
├── registry.ts                                   registerActionValidator, validateActionsWithRegistry
├── index.ts                                      Side-effect registrations
├── update-mission-status-validator.ts            FSM + existence + no-op
├── update-idea-validator.ts                      Existence + diff-based no-op
└── create-task-validator.ts                      Parent-mission terminal-state check
```

Mirrors the `cascade-actions/` structure: one file per action type + a side-effect-import `index.ts` that bootstraps the registry on module load.

### 4.2 Design boundaries (architect-ratified thread-232)

**ValidationContext is read-only.** Exposes `I*Store` interfaces only — no IPolicyContext, no dispatch/emit/metrics, no mutation paths. Enforced by the type:

```typescript
export interface ValidationContext {
  task: ITaskStore;
  idea: IIdeaStore;
  mission: IMissionStore;
  thread: IThreadStore;
  proposal: IProposalStore;
  turn: ITurnStore;
  bug: IBugStore;
}
```

**Fail-fast, not second-enforcement.** The gate revalidation is an optimization: it catches stale references 20–50ms earlier than the cascade handler would. The cascade handler remains the final transactional arbiter — handler integrity checks are preserved.

**Null validator for unchecked types.** Action types without a state-reality concern (close_no_action, create_proposal, create_idea, create_bug, propose_mission, create_clarification) register `NULL_VALIDATOR` — always returns `{ok: true}`.

### 4.3 Per-action validator semantics

**`update_mission_status`:**
- Missing mission → `stale_reference` + metadata `{entityType: "mission", entityId}`
- Already at target status → `{ok: true, isNoOp: true}` (bug-14 absorbed here too)
- Not a permitted `MISSION_FSM` edge → `invalid_transition` + metadata with currentStatus + attemptedStatus
- Reuses `MISSION_FSM` + `isValidTransition` — no re-implementation of the FSM

**`update_idea`:**
- Missing idea → `stale_reference` + metadata `{entityType: "idea", entityId}`
- `changes` contains no updatable fields (allowed: status, missionId, tags, text) → `payload_validation`
- Shallow diff of filtered changes vs current state is empty → `{ok: true, isNoOp: true}` (bug-14 absorbed)

**`create_task`:**
- `correlationId` starts with `mission-` AND the mission exists AND `!isMissionCommittable(mission)` (completed or abandoned) → `invalid_transition` + metadata `{entityType: "mission", entityId, currentStatus, attemptedAction: "spawn_child_task"}`
- Free-form `correlationId` (not a Mission id) → pass through
- `isMissionCommittable` lives on `entities/mission.ts` as a centralized convention; reusable by future container-relationship checks

### 4.4 Gate integration

Runs at the bilateral-convergence trigger only (mirrors the authority-check scope). The policy layer:
1. Projects existing staged actions from `thread.convergenceActions`
2. Applies the caller's incoming stage/revise/retract ops to produce the "about-to-commit" set
3. Validates each action via `validateActionsWithRegistry`
4. On failure: raises the structured JSON error, fires metrics, emits INV-TH19 shadow breach
5. On success: fires `convergence_gate.noop_detected` metric when any validator returned `isNoOp`

Cost on the happy path: one `await` per staged action. All per-action validators perform a single store read.

---

## 5. Bug-14 absorption (update-handler idempotency)

### 5.1 The gap CP1 documented

From CP1 audit §4.1: `update_idea.execute()` applied `changes` unconditionally and wrote an audit entry on every run, even when the target was already at the desired state.

### 5.2 CP2 fix

`cascade-actions/update-idea.ts` now:
1. Reads the existing idea (unchanged).
2. Filters `changes` to updatable fields (unchanged).
3. **NEW:** Computes a shallow equality check between filtered changes and existing state.
4. **NEW:** Returns `null` when all filtered fields already match — triggers the runner's existing `cascade.idempotent_update_skip` path.
5. Otherwise applies the update (unchanged).

`update_mission_status` already had this pattern (`if (mission.status === p.status) return null`) — no handler change needed; CP1 flagged this inconsistency in §4.2.

### 5.3 Contract test flip

`hub/test/unit/contract-idempotency.test.ts`: the "known gap" test that documented the broken behavior now asserts the CORRECT idempotent behavior:

```typescript
// Before CP2: expect(second.report[0].status).toBe("executed");  // gap
// After CP2:  expect(second.report[0].status).toBe("skipped_idempotent");  // idempotent
```

### 5.4 Double-defense: gate + handler

The validator ALSO detects the no-op at the gate layer (via `ValidationResult.isNoOp`) and fires `convergence_gate.noop_detected` telemetry. Committed actions are not yet tagged with `isNoOp=true` in this commit (StagedAction has the field but `replyToThread` options don't plumb it through the commit path — architect's C4 recommendation #3 was to also tag the committed action; deferring that plumbing to a follow-up to avoid a cross-cutting signature change in C4). The handler-side detection is sufficient for the current bug-14 fix; the gate telemetry gives us observability into how often this fires.

---

## 6. `_ois_query_unmatched` sentinel (C5)

Coverage map:

| Tool | Pre-CP2 | Post-CP2 (C5) | Notes |
|---|---|---|---|
| list_tasks | ✅ (task-302) | ✅ | Phase 1 |
| list_ideas | task-306 | ✅ | Shipped in task-306 C2 |
| list_threads | task-306 | ✅ | Shipped in task-306 C3 |
| list_missions | task-306 | ✅ | Shipped in task-306 C4 |
| list_proposals | ❌ | ✅ | **Added in CP2 C5** |
| list_audit_entries | ❌ | ✅ | **Added in CP2 C5** |
| list_bugs | ❌ | ✅ | **Added in CP2 C5** |
| list_turns | ❌ | ❌ | No filter today; skipped per empirical rule |
| list_tele | ❌ | ❌ | No filter today; skipped |
| list_director_notifications | ❌ | ❌ | No filter today; skipped |

Implementation pattern: detect `hasFilter` from args; on the empty-result path only, probe the unfiltered collection count to distinguish "filter valid, nothing matched" from "collection empty". Zero cost on the happy path.

---

## 7. Findings surfaced in CP2 (closed, documented, or deferred)

### 7.1 `StagedAction.isNoOp` plumbing not wired to replyToThread (deferred)

**Finding:** Architect's C4 recommendation #3 (thread-232) proposed tagging the committed action with `isNoOp=true` so the cascade runner could short-circuit before calling the handler. The validator already detects the no-op; the `StagedAction` type has the optional `isNoOp` field; but `replyToThread` doesn't yet accept a `validatedNoOpActionIds` option to propagate through the commit path.

**Why deferred:** plumbing a new option through MemoryThreadStore.replyToThread + GcsThreadStore.replyToThread (two implementations, both CAS-transactional) is a cross-cutting change that would bloat C4. The handler-side fix (§5.2) closes bug-14 without it; gate telemetry (§5.3) provides observability.

**Recommendation:** follow-up task (CP3-adjacent or post-CP3) to complete the plumbing. Low risk, ~1-hour scope.

### 7.2 `create_clarification` validator is NULL (deferred pending idea-125)

**Finding:** `create_clarification` currently registers `NULL_VALIDATOR`. When the primitive is unified into threads (idea-125), a validator would check that the target thread isn't closed/converged.

**Why deferred:** the primitive is slated for deletion per idea-125; writing a validator for its current shape would be throwaway work.

**Recommendation:** implement alongside idea-125 resolution.

### 7.3 Parent-entity checks on create_proposal, create_idea, create_bug

**Finding:** CP2 C4 implemented the parent-mission terminal-state check for `create_task` only. Other spawn actions could benefit from similar checks (e.g., `create_proposal` against a terminal mission; `create_bug` against a closed thread).

**Why deferred:** the concrete container-relationship rules for those entities aren't architect-ratified yet. Adding them now would be speculative. The `isMissionCommittable` helper lives on `entities/mission.ts` and can be reused the moment those rules land.

**Recommendation:** revisit when the idea-121 (API v2.0 modernization) or idea-126 (K8s-style envelope) work lands — either may formalize the container-relationship vocabulary.

### 7.4 Race between gate check and cascade execution

**Finding:** The gate validates state at convergence time. The cascade executes asynchronously after commit. An entity could theoretically change between the two — e.g., an architect marks a mission as completed between the gate check and the update_mission_status cascade running.

**Why not fixed:** This is an accepted limitation; the cascade handler remains the transactional arbiter. The handler will fail the update at execute time if the state changed. Making the gate transactional with the cascade would require a wider locking mechanism that CP2 is not scoped for.

**Recommendation:** monitor via the new `cascade_fail.execute_threw` + `cascade_fail.unknown_spec` counters. If the race becomes observable at scale, consider a Phase 3+ lock-or-optimistic-retry design.

---

## 8. Test coverage added

| File | New tests | Purpose |
|---|---|---|
| `hub/test/policy-router.test.ts` | 5 | `get_metrics` tool (empty snapshot, populated snapshot, bucket drill-down, unknown bucket, limit paging) |
| `hub/test/wave3b-policies.test.ts` | 3 | CP2 C2 subtype coverage (revise_invalid, retract_invalid, payload_validation) — + 2 existing tests extended |
| `hub/test/wave3b-policies.test.ts` | 2 | CP2 C3 INV-TH17 shadow breach (imposter rejected + pinned-agent passes) |
| `hub/test/wave3b-policies.test.ts` | 4 | CP2 C4 gate rejections (stale_reference for update_idea, invalid_transition for update_mission_status, etc.) — restructured from cascade-level tests |
| `hub/test/unit/contract-idempotency.test.ts` | 0 | Bug-14 test flipped from documenting-gap to asserting-idempotent |
| `hub/test/wave3b-policies.test.ts` | 5 | CP2 C5 sentinel (list_proposals × 3, list_bugs × 2) |
| `hub/test/wave1-policies.test.ts` | 1 | CP2 C5 sentinel (list_audit_entries) |

**Total:** 554 hub tests pass, 5 skipped; `npx tsc --noEmit` clean across all 5 commits.

---

## 9. CP3 / CP4 readiness

### 9.1 CP3 (Reaper + Lifecycle GC)

**No hard dependency on CP2.** CP3 is the Phase 2d item with the widest independent scope: Thread reaper, lifecycle GC, queue/thread bidirectional integrity, summary-only truncation on close. Can start immediately.

**CP2 contribution:** observability primitives are in place — reaper runs can emit `thread.reaped` / `thread.reap_failed` counters consumable via `get_metrics`. bug-16 (Agent entity lifecycle — no reaper + labels/role not refreshed on reconnect) is an absorbable scope item.

### 9.2 CP4 (`retry_cascade` tool)

**CP2 closes the last prerequisite.** bug-14 is fixed in CP2 C4 — `update_idea` + `update_mission_status` are now idempotent per the architect-ratified contract. All handlers are CP4-ready:

- All 5 spawn handlers: CERTIFIED (CP1 §2)
- `update_mission_status`: CP1 had `if mission.status === p.status return null` (bug-14 was never on this handler)
- `update_idea`: **CP2 C4 closes the gap** — now returns null on no-op

**Recommendation:** CP4 can start without update-handler hardening being a sub-scope; the hardening is already done.

---

## 10. Related

- CP1 audit report: `docs/audits/phase-2d-cp1-observability-report.md`
- Architect brainstorm thread (design convergence): thread-232
- Ideas: idea-125 (clarification → thread unification), idea-126 (K8s-style envelope), idea-132 (bug-11 Hypervisor-layer mitigations)
- Bugs resolved in CP2: bug-14 (update-handler idempotency absorbed into C4), bug-15 (INV-TH17 policy-layer instrumentation absorbed into C3)
- Commits: `761bd39` (C1) → `da405ce` (C2) → `c3bb864` (C3) → `9a63303` (C4) → `3ec03df` (C5) → (this report, C6)
