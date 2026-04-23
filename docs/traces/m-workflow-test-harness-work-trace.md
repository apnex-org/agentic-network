# M-Workflow-Test-Harness — Work Trace (live state)

**Mission scope.** Tracks all in-flight, queued, and recently-completed work under mission-41 (M-Workflow-Test-Harness). Goal: close the workflow-registry §7.2 test-coverage gap — bring ≥10 of 28 `Tested By: NONE` invariants under automated coverage so spec↔runtime divergence becomes mechanically detectable. Pool-foundational; downstream Phase 4 winners (#3/#5/#6) consume this harness.

**Mission brief:** `docs/reviews/2026-04-phase-4-briefs/m-workflow-test-harness.md` (on agent/lily; read via `git show agent/lily:<path>`).
**Kickoff decisions (ratified 2026-04-23):** `docs/missions/mission-41-kickoff-decisions.md` (agent/lily).
**Preflight (GREEN):** `docs/missions/mission-41-preflight.md` (agent/lily).
**Activation thread:** thread-255 (converged 2026-04-23 AEST, 6 actions cascade-executed).
**How to read + update this file:** `docs/traces/trace-management.md`.

**Status legend:** ▶ in-flight · ✅ done this session · ○ queued / filed · ⏸ deferred

---

## Resumption pointer (cold-session brief)

If you're picking up cold:

1. **Read this file first**, then the brief (`git show agent/lily:docs/reviews/2026-04-phase-4-briefs/m-workflow-test-harness.md`) and kickoff decisions (`git show agent/lily:docs/missions/mission-41-kickoff-decisions.md`). Briefs + kickoff live on agent/lily — do not merge; read via `git show`.
2. **Hub mission id:** mission-41 (status=active, correlationId="mission-41").
3. **Current in-flight:** task-324 (T1 — PolicyLoopbackHub parity + bug-12 fix) claimed at 2026-04-23 AEST mid. Next engineer action: fix `packages/network-adapter/test/helpers/policy-loopback.ts` (wire `MemoryPendingActionStore` + `MemoryDirectorNotificationStore`), restore `threads-2-smoke.test.ts` to GREEN, close bug-12.
4. **Ratified scope inputs (do NOT re-litigate):**
   - Wave 2 invariant subset (10 exactly): INV-TH18, INV-TH19, INV-T4, INV-P1, INV-P2, INV-P4, INV-TH6, INV-TH7, INV-I2, INV-M4
   - Wave 1 adapter scope: shim-side IN (absorbs idea-104 partial)
   - vertex-cloudrun: OUT
5. **Anti-goals (hold firm):** no touch on missions 42/43/44; no cross-mission coupling; no brief-scope re-litigation; tool-surface scope belongs in idea-121, not this mission.
6. **Deploy gate:** Wave 1 = Hub-test-infra only; no Hub redeploy, no architect Cloud Run redeploy required. Re-flag at Wave 3 if coverage-report tool grows a Hub-side audit-entry type.

---

## In-flight

- ▶ **task-324 (T1 — PolicyLoopbackHub parity + bug-12 fix)** — claimed 2026-04-23 AEST mid. Scope: wire ADR-017 stores into cross-package loopback helper; diff store-surface vs hub testbed; restore `threads-2-smoke.test.ts` 11/11 GREEN; close bug-12 with fixCommits. Est. ~0.5 day.

---

## Queued / filed

- ○ **task-325 (T2 — Hub testbed FSM-invariant assertion helpers)** — pending. Extend `hub/test/e2e/orchestrator.ts` with 10 `assertInv*` helpers (one per ratified invariant). Unblocks Wave 2 parallel-start on 8 entity-invariant NONEs. Depends on T1 complete.
- ○ **task-326 (T3 — MockClaudeClient scaffold)** — pending. Deterministic test driver over real `adapters/claude-plugin/src/proxy.ts` via loopback. Absorbs idea-104 partial. Depends on T1; weak-couples to T2.
- ○ **task-327 (T4 — MockOpenCodeClient scaffold)** — pending. Mirror of T3 for `adapters/opencode-plugin/hub-notifications.ts`. Parallelizable with T3.
- ○ **task-328 (T5 — Coverage-report tooling + CI merge-gate)** — pending. Machine-readable `docs/audits/workflow-test-coverage.md` + vitest→GitHub Actions merge-gate + deliberate-fail PR verification. Depends on T2; decouples from T3/T4.
- ○ **Wave 2 task filings** — DEFERRED until T2 merges. 8 entity-invariant tests become claim-eligible on T2 land; 2 workflow tests (TH18/TH19) wait for T3+T4. Wave 2 tasks will be filed as a separate round.
- ○ **Wave 3 scope** — `workflow-registry.md §7 Tested By` column updates + remaining-gap follow-up-idea filings. Post-Wave-2.

---

## Done this session

- ✅ **thread-255 convergence (mission-41 activation scaffolding)** — architect briefed activation 2026-04-23 01:36:23Z; engineer replied 2026-04-23 01:41:28Z with 5-task Wave 1 decomposition + 5 `create_task` staged actions + non-empty summary; bilateral convergence at 2026-04-23 01:48:26Z; cascade committed 6 actions (executed=6, failed=0) spawning tasks 324-328. Thread closed.
- ✅ **Task filings — tasks 324 → 328 cascade-spawned under mission-41 correlationId** — 5 tasks with engineer-authored dependency ordering: T1 (bug-12 + parity) → T2 (FSM-invariant helpers) → {T3 MockClaude | T4 MockOpenCode parallel} → T5 (coverage-report + CI gate). All 5 carry sourceThreadId=thread-255 + sourceActionId=action-1..5 for back-link provenance.
- ✅ **task-324 claimed** — `get_task` assigned T1 to eng-0d2c690e7dd5; status flipped pending → working at 2026-04-23 01:47:48Z.

---

## Edges (dependency chains)

```
thread-255 (activation scaffolding) ✅ → mission-41 tasks 324-328 cascade-created
task-324 ▶ (T1: bug-12 + parity) → task-325 ○ (T2: assertion helpers)
task-325 ○ → task-326 ○ (T3: MockClaudeClient)  ┐
task-325 ○ → task-327 ○ (T4: MockOpenCodeClient) ├ parallel
task-325 ○ → task-328 ○ (T5: coverage + CI gate)

task-325 ○ (T2 merge) → Wave 2 partial-start unblock (8 entity-invariant tests claim-eligible)
{task-326, task-327} ○ (T3+T4 merge) → INV-TH18/TH19 test graduation (Wave 2 workflow tests)
T5 ○ → Wave 3 coverage-report fold + §7 spec-column updates (post-Wave-2)
```

---

## Session log (append-only)

- **2026-04-23 mid** — Mission-41 activated. Architect (eng-40903c59d19f) briefed scaffolding kickoff on thread-255 at 2026-04-23 01:36:23Z with pointers to brief + kickoff + preflight + methodology (all on agent/lily; read via `git show` — no merge per worktree-isolation discipline). Loaded all four docs; confirmed `get_mission(mission-41)` → status=active. Replied to thread with 5-task Wave 1 decomposition (T1 bug-12+parity → T2 assertion helpers → T3/T4 parallel mock clients → T5 coverage+CI) + 5 staged `create_task` actions + summary; converged=true. Architect converged back at 01:48:26Z; cascade executed 6 actions spawning tasks 324-328. Claimed T1 via `get_task` (task-324 pending → working). Bug-12 scope (RCA verified via `get_bug`): ~10 LOC wiring two ADR-017 stores into `packages/network-adapter/test/helpers/policy-loopback.ts`. All 3 ratified kickoff decisions held as non-negotiable inputs — not re-litigated. Trace file filed per user instruction (durable trace-maintenance obligation acknowledged).

---

## Canonical references

- **Brief** — `docs/reviews/2026-04-phase-4-briefs/m-workflow-test-harness.md` on agent/lily (`6625c24` architect draft, `732b6b5` engineer fold, `4ff0f6b` engineer-side on agent/greg's parallel path).
- **Kickoff decisions (ratified 2026-04-23)** — `docs/missions/mission-41-kickoff-decisions.md` on agent/lily (`e359b2d`).
- **Preflight GREEN** — `docs/missions/mission-41-preflight.md` on agent/lily (`e359b2d`).
- **Preflight methodology v1.0** — `docs/methodology/mission-preflight.md` on agent/lily (`136e8bc`).
- **Parent spec** — `docs/specs/workflow-registry.md` §7.2 (28 NONE invariants) + §7.3 (immediate-coverage recommendation).
- **Activation thread** — thread-255 (correlationId=mission-41; closed 2026-04-23 01:48:26Z; 6 actions executed).
- **Bug closed-by T1** — bug-12 (`packages/network-adapter/test/helpers/policy-loopback.ts` ADR-017 store drift).
- **Idea partially-absorbed** — idea-104 (Mock Harness; shim-side portion folded into Wave 1 per kickoff-decision #2).
- **Trace management guide** — `docs/traces/trace-management.md`.
- **Peer traces** — `docs/traces/m-cognitive-hypervisor-work-trace.md`, `docs/traces/m-hypervisor-adapter-mitigations-work-trace.md`.
