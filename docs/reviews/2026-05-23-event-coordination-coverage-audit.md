# Event-Coordination Coverage Audit

**Date:** 2026-05-23 AEST
**Author:** lily (architect)
**Trigger:** Director surface during cluster-2 v0.2 merge (idea-126 Phase 4 Design) — *"review the event surface, and map them to our coordination workflows to concretely identify coverage"*
**Status:** v1.0 — analysis artifact; informs follow-on Idea/Bug/methodology filings

---

## §1 Goal

The intent behind `feedback_pr_opened_notification_is_review_signal` (memory captured this session) was: **use native events where possible; reach for threads only when events don't cover.** During cluster-2 v0.2 push, a coordination gap surfaced — architect's v0.2 fold-in commit didn't trigger any signal to engineer; both sides idle until manual ping.

This audit:
1. Enumerates the **full event surface** (4 categories: repo-events, Hub-dispatches, cascade-actions, pulse-system)
2. Enumerates **coordination workflows** observed in actual practice
3. Maps workflow → event coverage; identifies **gaps**
4. Disposes each gap: (a) substrate fix, (b) methodology discipline, (c) hybrid

---

## §2 Event surface inventory

### §2.1 Repo-events (GitHub → Hub via `packages/repo-event-bridge`)

Bridge translates GitHub events to Hub events. Translator subkinds (per `packages/repo-event-bridge/src/translator.ts`):

| GitHub subkind | Hub handler | Status |
|---|---|---|
| `pr-opened` | `pr_opened_bilateral` (`hub/src/policy/repo-event-pr-opened-handler.ts`) | ✓ wired |
| `pr-merged` | `pr_merged_bilateral` (`repo-event-pr-merged-handler.ts`) | ✓ wired |
| `pr-review-submitted` | `pr_review_submitted_bilateral` (`repo-event-pr-review-submitted-handler.ts`) | ✓ wired |
| `pr-review-approved` | `pr_review_approved_bilateral` (`repo-event-pr-review-approved-handler.ts`) | ✓ wired |
| `pr-closed` | **NO HANDLER** | translator-ingested; Hub-side drops |
| `pr-review-comment` | **NO HANDLER** | translator-ingested; Hub-side drops |
| `commit-pushed` | **NO HANDLER** (retired mission-85; `72b36c5`) | translator-ingested; Hub-side drops |
| `workflow-run-completed` | `workflow_run_completed_system_notification` | ✓ wired |
| `workflow-run-dispatched` | `workflow_run_dispatched_system_notification` | ✓ wired |
| `workflow-run-in-progress` | `workflow_run_in_progress_system_notification` | ✓ wired |

**Not in translator at all** (GitHub fires these; we don't ingest):
- `pull_request.synchronize` — fires on every push to a PR branch (post-open)
- `pull_request.ready_for_review` — draft → ready transition
- `pull_request.converted_to_draft`
- `pull_request.assigned` / `unassigned`
- `pull_request.labeled` / `unlabeled`
- `pull_request.review_requested` / `review_request_removed`
- `issue_comment.*` (general PR/issue comments, distinct from review comments)
- `pull_request.edited` (title/body edits)

**The `pr-synchronize` absence is the load-bearing gap surfaced this session.**

### §2.2 Hub dispatch events (Hub → agent pending-action queues + SSE)

`ctx.dispatch(eventName, payload, target)` fires from policy code; lands in target agents' PendingAction queue + emits SSE.

| Event | Source | Recipient | Notes |
|---|---|---|---|
| `task_issued` | task-policy | engineer (claimant) | Mission-19 routing labels |
| `task_blocked` | task-policy | architect | clarification surface |
| `task_cancelled` | task-policy / cascade | engineer | upstream cancel |
| `report_submitted` | task-policy | architect | review surface |
| `review_completed` / `review_submitted` | task-policy | engineer (assigned) | post-review settle |
| `revision_required` | task-policy | engineer | rework signal |
| `clarification_requested` | clarification-policy | architect | task → input_required |
| `clarification_answered` | clarification-policy | engineer | task → working resume |
| `directive_acknowledged` | task-policy | architect | claim signal |
| `proposal_submitted` | proposal-policy | architect | proposal-review surface |
| `proposal_decided` | proposal-policy | engineer | proposal-fate signal |
| `idea_submitted` | idea-policy / cascade | architect | triage queue surface |
| `bug_reported` | bug-policy / cascade | architect (+ engineer for high-severity?) | triage queue surface |
| `bug_status_changed` | bug-policy | architect | FSM signal |
| `mission_created` | mission-policy | (varies) | mission-graph signal |
| `mission_activated` | dispatch-helpers (proposed → active) | engineer | start-work signal |
| `mission_completed` | triggers / mission-policy | (varies) | mission-close signal |
| `mission_activation_inbox` | triggers.ts | Director | mission-engagement surface |
| `mission_completion_director_inbox` | downstream-actors | Director | mission-close inbox |
| `thread_message` | thread-policy | thread recipient | round-trip turn signal |
| `thread_convergence_finalized` | thread-policy | cascade handlers | post-convergence spawn |
| `thread_abandoned` | thread-policy | participants | mid-flight close |
| `message_arrived` | message-policy | target (role/agent) | direct-message landing |
| `agent_state_changed` | agent-policy | (system) | online/offline transitions |
| `directorAttentionRequired` | (various) | Director | escalation surface |
| `tele_defined` / `tele_retired` / `tele_superseded` | tele-policy | architect | tele-graph signal |
| `turn_created` / `turn_updated` | turn-policy | (varies) | turn-lifecycle signal |
| `cascade_failure` | cascade-spec | architect | cascade-handler exception |
| `review_submitted_inbox` | review-policy | architect | review-store landing |

### §2.3 Cascade actions (thread-convergence → entity-spawn)

When a thread converges with staged actions, registered cascade handlers fire. Per `hub/src/policy/cascade-actions/`:

| Cascade type | Spawns | Notes |
|---|---|---|
| `create_idea` | Idea entity | + `idea_submitted` dispatch |
| `update_idea` | Idea mutation | status FSM transition |
| `create_task` | Task entity | + `task_issued` dispatch (if labeled) |
| `create_bug` | Bug entity | + `bug_reported` dispatch |
| `create_clarification` | Audit-only entry | no separate Clarification entity (per cluster-2 §0) |
| `create_proposal` | Proposal entity | + `proposal_submitted` dispatch |
| `close_no_action` | (no entity) | thread-close marker only |
| `update_mission_status` | Mission FSM transition | + `mission_activated`/`mission_completed` conditional dispatch |
| `propose_mission` | Mission entity (proposed) | + `mission_created` dispatch |

**Coverage:** cascade-actions compose well with downstream dispatch — every spawn fires a follow-on event. Cascade-spawn IS event-coupled.

### §2.4 Pulse / scheduled-message system

Per `hub/src/policy/triggers.ts` + `scheduled-message-*` sweepers:

| Event | Cadence | Recipient | Notes |
|---|---|---|---|
| `status_check` | per-mission pulse interval (config) | architect / engineer | mission cadence ping |
| `missed_threshold_escalation` | 3× missed | Director | escalation surface |
| `agent_status_check` | (per-agent watchdog) | system | liveness ping |

**Coverage:** pulse handles ongoing cadence; not workflow-event-shaped.

---

## §3 Coordination workflows (observed in practice)

Enumeration based on this session's experience + cluster-1/cluster-2 cycles + historical session memory.

### §3.1 Workflow taxonomy

| # | Workflow | Trigger | Primary recipient |
|---|---|---|---|
| W1 | **PR open → other-party review** | architect opens PR | engineer reviews |
| W2 | **PR push (v0.2 fold-in) → re-review** | architect pushes new commit to existing PR | engineer re-reviews |
| W3 | **PR review submitted → original author** | engineer submits review | architect sees |
| W4 | **PR review approved → original author** | engineer approves | architect merges |
| W5 | **PR merged → other party (close-loop)** | architect merges | engineer sees close |
| W6 | **PR closed (not merged) → other party** | architect closes without merge | engineer sees |
| W7 | **PR review comment** | line-level comment | original author sees |
| W8 | **Commit push (non-PR branch)** | engineer pushes WIP | architect sees (historical context) |
| W9 | **Task issued → engineer** | architect creates task | engineer claims |
| W10 | **Task report → architect** | engineer submits report | architect reviews |
| W11 | **Task review completed → engineer** | architect submits review | engineer sees outcome |
| W12 | **Task clarification cycle** | engineer requests / architect answers | other-party |
| W13 | **Thread message → recipient (turn-shifting)** | reply with intent | thread's recipient |
| W14 | **Thread converged → both parties + cascade** | convergence + staged actions | both + spawned entities |
| W15 | **Proposal submitted → architect** | engineer creates proposal | architect reviews |
| W16 | **Bug filed → architect (+ Director if critical)** | any-role surface | architect triage |
| W17 | **Idea filed → architect (triage queue)** | any-role surface | architect triage |
| W18 | **Mission lifecycle (created → activated → completed)** | mission-policy transitions | role per FSM |
| W19 | **Mission pulse cadence** | scheduled interval | architect/engineer |
| W20 | **CI failure / success surface** | CI workflow completes | both per PR context |
| W21 | **Director-direct UI engagement** | Director uses Hub API directly | system |
| W22 | **Cross-mission dependency surface** | architect-side mission-graph analysis | downstream-blocked agent |
| W23 | **Tele lifecycle (define/retire/supersede)** | tele-policy | architect (graph maintainer) |
| W24 | **Cascade-failure surface** | cascade handler exception | architect (recovery) |

### §3.2 Coverage matrix

| Workflow | Best-fit event(s) | Coverage | Disposition if gap |
|---|---|---|---|
| W1 (PR open → review) | `pr_opened_bilateral` | ✓ wired | N/A |
| **W2 (PR push → re-review)** | (none — `pr-synchronize` not ingested) | **✗ GAP** | needs disposition |
| W3 (PR review submitted) | `pr_review_submitted_bilateral` | ✓ wired | N/A |
| W4 (PR review approved) | `pr_review_approved_bilateral` | ✓ wired | N/A |
| W5 (PR merged) | `pr_merged_bilateral` | ✓ wired | N/A |
| **W6 (PR closed, not merged)** | `pr-closed` translator-ingested, NO HANDLER | **✗ GAP** | likely needs handler |
| **W7 (PR review comment)** | `pr-review-comment` translator-ingested, NO HANDLER | **✗ GAP** | needs disposition (low-priority?) |
| W8 (commit push non-PR) | (retired mission-85) | ✗ by-design | architectural-correctness preserved |
| W9 (task issued) | `task_issued` | ✓ wired | N/A |
| W10 (task report) | `report_submitted` | ✓ wired | N/A |
| W11 (review completed) | `review_completed` / `review_submitted` | ✓ wired | N/A |
| W12 (clarification cycle) | `clarification_requested` / `clarification_answered` | ✓ wired | N/A |
| W13 (thread message) | `thread_message` | ✓ wired | N/A |
| W14 (thread converged + cascade) | `thread_convergence_finalized` + per-action cascade | ✓ wired | N/A |
| W15 (proposal submitted) | `proposal_submitted` | ✓ wired | N/A |
| W16 (bug filed) | `bug_reported` | ✓ wired | N/A |
| W17 (idea filed) | `idea_submitted` | ✓ wired | N/A |
| W18 (mission lifecycle) | `mission_created` / `mission_activated` / `mission_completed` | ✓ wired | N/A |
| W19 (pulse cadence) | `status_check` / `missed_threshold_escalation` | ✓ wired | N/A |
| W20 (CI fail/success) | `workflow_run_*` handlers | ✓ wired | N/A |
| W21 (Director-direct UI) | direct Hub API | N/A | not event-shaped |
| **W22 (cross-mission dependency)** | (none) | **✗ GAP** | architect-discipline workflow |
| W23 (tele lifecycle) | `tele_defined` / `tele_retired` / `tele_superseded` | ✓ wired | N/A |
| W24 (cascade-failure) | `cascade_failure` | ✓ wired | N/A |

**Coverage summary: 21/24 = 87.5% of coordination workflows have native-event coverage.** Remaining gaps: W2, W6, W7, W22.

---

## §4 Gap analysis + dispositions

### §4.1 W2 — PR push (v0.2 fold-in) → re-review **(LOAD-BEARING; surfaced this session)**

**Substance:** post-PR-open commits don't fire any Hub-side notification. After architect pushes v0.2 fold-in to an existing PR, engineer has no event-driven signal to re-review. Branch-protection dismisses the prior approval; PR sits `REVIEW_REQUIRED`; both sides idle.

**Root cause:** `pull_request.synchronize` webhook isn't ingested by the bridge translator. mission-85 retired the commit-pushed handler for unrelated layer-attribution reasons (`PushEvent.actor.login` → role-mapping was structurally unresolvable; layer-inverted). `pr_synchronize_bilateral` was never built.

**Disposition options:**

| Option | Substance | Pros | Cons |
|---|---|---|---|
| **(a) Build `pr_synchronize_bilateral` handler** | Symmetric pair to `pr_opened_bilateral`; fires on every PR-update push; routes "PR #N updated to commit SHA" to non-pusher party | Clean substrate fix; closes gap structurally; preserves "events first" intent | Substrate-build cost; one new handler + translator-subkind addition |
| **(b) Adapt `feedback_pr_opened_notification_is_review_signal` memory rule** | Refine: PR-opened IS the review signal for INITIAL review only; v0.2 fold-in re-review requires explicit ping (coord-thread reply OR direct `create_message`) | Zero substrate change; immediate methodology fix | Process-discipline solution; relies on every architect remembering to ping; ergonomic regression vs (a) |
| **(c) Hybrid** | Adopt (b) immediately; pursue (a) as a M-PR-Synchronize-Handler Idea/Mission | Defensive + offensive | Tracks both surfaces |

**Architect recommendation:** **(c) — hybrid.** (b) closes the gap now; (a) closes it structurally so future sessions don't depend on memory-discipline. Per `feedback_director_strategic_maximalism_discipline_defended`, the structural fix is the architecturally-correct lean.

**Filing shape:** Idea **M-PR-Synchronize-Handler** (substrate-build); v2.1 methodology candidate **P** (memory refinement).

### §4.2 W6 — PR closed (not merged)

**Substance:** when architect closes a PR without merging (e.g., superseded approach), engineer gets no signal. Less common than W2 but still a coordination dead-spot.

**Root cause:** translator ingests `pr-closed` subkind (line 135 in `translator.ts`) but Hub has no handler.

**Disposition options:**

| Option | Substance |
|---|---|
| (a) Build `pr_closed_bilateral` handler | Symmetric pattern; routes "PR #N closed without merge" to non-closer party + close-reason payload |
| (b) Accept gap (low-frequency workflow) | Most closures ARE merges; non-merge close is rare |

**Architect recommendation:** **(a) — build the handler.** Same substrate-build cost as W2; could bundle into M-PR-Synchronize-Handler as a 2-handler mission (`pr-closed-bilateral` + `pr-synchronize-bilateral`) since they share the translator-subkind pattern.

### §4.3 W7 — PR review comment

**Substance:** GitHub fires `pull_request_review_comment` for line-level diff comments (distinct from full PR-review submission). Translator ingests `pr-review-comment` (line 141); Hub has no handler.

**Root cause:** same as W6.

**Disposition:** **lower priority.** Line-comment workflow is largely engineer-pulled (architect leaves comment in GitHub UI; engineer reads when reviewing). The `pr-review-submitted` event already signals "review is done"; line comments are detail-within-review. **Recommend: defer.** Could bundle into the M-PR-Event-Coverage-Completion mission if substantive demand emerges.

### §4.4 W22 — Cross-mission dependency surface

**Substance:** when Mission-A depends on Mission-B's completion, downstream-blocked agents have no event-driven mechanism to know when Mission-B unblocks them. Currently architect-side discipline (manual "Mission-A can start now" signal).

**Root cause:** no native event for cross-mission dependency state. `mission_completed` fires, but routing it to dependent-mission's agents requires graph-aware dispatch (not currently built).

**Disposition options:**

| Option | Substance |
|---|---|
| (a) Build `mission_dependency_unblocked` event | mission-policy emits when `dependsOnMissionId` resolves; routes to dependent-mission's assigned agents |
| (b) Architect-discipline (current state) | Manual surface at mission-graph review |
| (c) Compose with idea-151 Relationship-kind | Once relationships are first-class, dependency edges drive automatic unblock dispatch |

**Architect recommendation:** **(c) — compose with idea-151.** Building dependency-event before Relationship-kind lands would create substrate-debt; idea-151's Relationship-kind (edge: `depends_on`) is the natural composition surface. Until then, accept architect-discipline.

---

## §5 Bridge-translator subkinds NOT yet ingested (lower-priority gaps)

GitHub webhook events the bridge doesn't translate at all:

| GitHub event | Workflow served |
|---|---|
| `pull_request.synchronize` | W2 (covered above) |
| `pull_request.ready_for_review` | draft → ready transition; minor |
| `pull_request.converted_to_draft` | ready → draft; minor |
| `pull_request.review_requested` | explicit reviewer assignment; minor |
| `issue_comment` (on PR) | PR-level discussion outside review; could matter for substantive PR conversation |
| `pull_request.edited` | title/body edits; minor |

**Disposition:** defer all except `synchronize` (W2). Re-evaluate at M-PR-Event-Coverage-Completion Mission scoping.

---

## §6 Follow-on filings recommended

### §6.1 Substrate-build (Idea-class)

**Idea: M-PR-Synchronize-Handler** (proposed)
- Add `pr_synchronize_bilateral` handler (W2 fix)
- Add `pr_closed_bilateral` handler (W6 fix)
- (Optionally) add `pr_review_comment_bilateral` handler (W7; lower-priority)
- Pre-condition: extend translator to ingest `pull_request.synchronize` webhook subkind
- Acceptance: full bidirectional bilateral PR-lifecycle event coverage (open / push / review-comment / review-submit / review-approve / closed / merged)

### §6.2 Memory refinement (methodology candidate)

**v2.1 candidate P** — refine `feedback_pr_opened_notification_is_review_signal`:
- Original rule: "PR-opened notification IS the review signal; don't open coord-thread"
- Refined rule: "PR-event handlers (open / review-submit / review-approve / merged) ARE the native signals. **Post-open fold-in commits (v0.2+) currently have NO native signal** (W2 gap); use explicit ping (`create_message` direct, OR coord-thread reply if one exists) until M-PR-Synchronize-Handler lands"

### §6.3 Composition surface (already-known follow-on)

**idea-151 Relationship-kind** composes with W22 cross-mission-dependency event story; flag for idea-151 Design phase.

---

## §7 Summary

**Coverage:** 21/24 coordination workflows have native-event coverage = **87.5%**.

**Gaps:**
- **W2 PR-push-re-review (LOAD-BEARING)** — surfaced this session; immediate methodology fix + substrate-build Idea
- **W6 PR-closed-not-merged** — bundle into substrate-build Idea
- **W7 PR-review-comment** — defer
- **W22 cross-mission-dependency** — compose with idea-151

**Underlying principle preserved:** "Use native events where possible." Memory rule `feedback_pr_opened_notification_is_review_signal` was correct in intent; needs refinement in scope to acknowledge the W2 gap until substrate-build closes it.

**Filing decision (architect lean):**
- **File Idea M-PR-Synchronize-Handler** (substrate-build for W2 + W6 + optionally W7)
- **Update memory** `feedback_pr_opened_notification_is_review_signal` to refine the rule (v2.1 candidate P captured)
- **Skip Bug filing** — gap is missing-feature shape, not regression-defect shape
- **W22 → idea-151 Design** composition flag (no separate filing)

**Director engagement needed for:**
- Approve filing decision (Idea + memory; skip Bug)
- (If approved) authorize architect-side Idea creation
