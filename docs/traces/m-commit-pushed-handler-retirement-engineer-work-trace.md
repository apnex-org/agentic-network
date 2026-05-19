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

PR #217 opened off `agent-greg/mission-85-commit-pushed-handler-retirement` (HEAD `09e8737`); thread-589 surfaced with 9/13 AG-N green + standby for architect cross-approval.

### 2026-05-19 11:43 AEST — mission-85 MERGED + Hub-rebuilt + 11/13 AG-N ✅

Architect cross-approved + admin-squash-merged PR #217 at `72b36c5` on main (apnex-org convention; `--merge` rejected by repo policy → fell back to `--squash`; matches mission-84 W0-W7 lineage). mergedAt 2026-05-19T01:38:04Z UTC. Branch deleted post-merge.

**CI status:** 5 required-checks SUCCESS (no-engineer-id + secret-scan + vitest hub + workflow-test-coverage + test wrap-up); 4 cross-package matrix-jobs FAILURE (pre-existing CI infra defect — `actions/setup-node` cache-path resolution on non-existent `package-lock.json` for cognitive-layer + network-adapter + claude-plugin + opencode-plugin; bug-32-class lineage; admin-merge per `feedback_hub_mcp_tool_addition_audit_pattern`; separate CI-infra cleanup candidate for strategic review).

**Hub-rebuild** (architect-side per `feedback_adapter_restart_protocol_hub_container`):
- `scripts/local/build-hub.sh` exits 0 (image `ois-hub:local` built)
- `scripts/local/start-hub.sh` succeeded (post network-connect to `w0_default`)
- Boot clean: 22/22 SchemaDefs applied; 0 failures
- PolicyRouter 71 tools registered (unchanged — MCP tool-count unaffected)
- `[repo-event-bridge] Bridge running; draining events + workflow-runs into create_message`
- NO `[repo-event-commit-pushed-handler]` log entries (handler-registration absent confirmed)

**Final AG-N: 11/13 ✅ engineer + architect verified; 2 architect-driven follow-on:**
- AG-1 through AG-11 ✅
- AG-12 ⏳ mission-85 status flip → next architect action
- AG-13 ⏳ Phase 10 calibration CROSS-LAYER IDENTITY EXTRACTION → Director-bilateral filing

### 2026-05-19 11:44 AEST — thread-589 CONVERGED + engineer standby

mission-85 Phase 8 engineer-ship complete. Mission close imminent. Engineer-side stands down on coord-thread.

**Mission outcomes:**
- bug-98 = wontfix (architectural-overreach root-cause documented)
- commit-pushed-handler Hub-side subsystem RETIRED (160 lines + 302 test lines deleted)
- 2-layer engineer-cadence-discipline mechanization preserved (Layer (a) methodology + Layer (b) adapter hook)
- Architect-side PR-review-readiness signal: engineer-thread-explicit-surface on coord-thread (operational across mission-84 + bug-99/100/101)
- Calibration pattern named: CROSS-LAYER IDENTITY EXTRACTION

**Engineer-side cycle stats:**
- Time-to-ship: ~5 min (mission ACTIVE @ 11:30 → PR opened @ 11:37)
- Time-to-merge: ~13 min (mission ACTIVE @ 11:30 → MERGED @ 11:43)
- Net diff: +280 / -703 lines (8 files changed)
- Test delta: 1483 → 1470 (-13; expected from COMMIT_PUSHED + bug-98 fix block deletions)
- Bilateral round-budget: thread-588 1-round + thread-589 2-rounds = 3 total (`feedback_bilateral_audit_round_budget_discipline` clean baseline)

— Engineer (greg) 2026-05-19 11:44 AEST (mission-85 Phase 8 ENGINEER-CLOSED; architect-side Phase 9 + Phase 10 in flight)
