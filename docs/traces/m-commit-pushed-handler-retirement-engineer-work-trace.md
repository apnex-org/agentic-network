---
mission: mission-85 M-Commit-Pushed-Handler-Retirement
mission-anchor: idea-303
companion-trace: (architect-side trace, if any)
upstream-mission: mission-84 (M-Hub-Storage-FS-Retirement; bug-98 post-mortem)
engineer-branch: agent-greg/mission-85-commit-pushed-handler-retirement (off origin/main @ 0ce7cf0)
architect-branch: agent-lily/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate (carries Design v1.0 + Preflight)
phase: Phase 8 Execution — single-PR ship
---

# mission-85 — engineer-side work-trace

## §1 Mission context

Retire `commit-pushed-handler` Hub-side subsystem (CLAUDE.md §1.5.1.1 Layer (c); mission-68 W1 origin). Bug-98 = architectural-overreach not fixable at handler layer (CROSS-LAYER IDENTITY EXTRACTION pattern). Design v1.0 RATIFIED at 83cd7dd via thread-588 single-round bilateral audit.

**Scope:** 5 code edits + 2 doc revisions + Hub-rebuild + 13 AG-N verify + single-PR.

## §2 Session log

### 2026-05-19 11:30 AEST — mission-85 ACTIVE pickup

- Director Release-gate ratify at 11:30 AEST → mission-85 status `proposed → active`
- Architect dispatched thread-589 Phase 8 ship coordination
- Engineer branched `agent-greg/mission-85-commit-pushed-handler-retirement` off `origin/main @ 0ce7cf0` (post-PR-#216 merge; includes bug-99+100 fixes)
- Work-trace initialized; task list created (D1-D7 + Hub-rebuild + PR)

### 2026-05-19 11:32 AEST — D1-D7 file edits in flight

### 2026-05-19 11:35 AEST — D1-D7 COMPLETE + tests green

| Deliverable | Status | File | Detail |
|---|---|---|---|
| D1 | ✅ | `hub/src/policy/repo-event-commit-pushed-handler.ts` | DELETED (whole file; was 160 lines) |
| D2 | ✅ | `hub/src/policy/repo-event-handlers.ts` | Removed import (line 48) + removed registry entry (line 116); updated docstring with mission-85 retirement note |
| D3 | ✅ | `hub/test/unit/repo-event-handlers.test.ts` | Net delete ~302 of 496 lines (final 194 lines); removed 2 describe blocks (COMMIT_PUSHED_HANDLER + bug-98 fix nested); KEPT registry-seed + lookupRoleByGhLogin + ADD AG-4 negative-assertion test + ADD commit-pushed to retired-subkinds null-check; cleaned orphaned imports (translateGhEvent + Message + makeRepoEventMessage helper) |
| D4 | ✅ | `hub/src/policy/repo-event-workflow-run-handler.ts` | Rewrote stale commit-pushed-handler cross-references (lines 11+24) to self-contained shape-description |
| D5 | ✅ | `adapters/claude-plugin/src/commit-push-hook.ts` | Revised docstring: removed 4 Layer (c) references; added post-mission-85 2-layer note + retirement-link |
| D6 | ✅ | `docs/methodology/mission-lifecycle.md §1.5.1.1` | Retracted Layer (c) row; preserved Layer (a)+(b); revised Failure-resilience hierarchy + Cross-party authorship resolution paragraphs; updated section title |
| D7 | ✅ | `docs/methodology/engineer-runtime.md:22` | Revised commit-push thread-heartbeat row: removed (c) Hub-side handler reference; preserved (a)+(b); updated link anchor for renamed section |

**Local-verify:**
- `npx tsc --noEmit` (hub) → clean ✅
- `npx vitest run test/unit/repo-event-handlers.test.ts` → 11/11 pass ✅ (AG-4 negative-assertion test included)
- `npx vitest run` (full hub) → 1470/1470 pass / 7 skipped (decrease of 13 vs pre-mission-85 reflects COMMIT_PUSHED_HANDLER + bug-98 fix test deletions) ✅ AG-5

**Pre-PR ship-verify** (per `feedback_ship_verify_3_layer_discipline`):
- Layer 1 (tsc strict) ✅
- Layer 2 (npm test full suite) ✅
- Layer 3 (commit-message-claims) ✅ all changes match Design §3.1 + §3.2 scope

**Container build deferred to post-merge** per standard cutover sequence: `scripts/local/build-hub.sh` is gcloud Cloud Build (remote, expensive, deploys to shared artifact registry); architect runs post-merge per `feedback_adapter_restart_protocol_hub_container`.

### 2026-05-19 11:37 AEST — PR open + thread-surface
