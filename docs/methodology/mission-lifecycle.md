# Mission Lifecycle Audit — goal-for-primitives reference

**Status:** v0.1 draft (2026-04-25, architect lily). Not a policy document — a map of today's mission lifecycle mechanics + the gaps that the workflow-primitive ideas (idea-191 repo-event-bridge, idea-192 hub-triggers-inbox) must close.

**Purpose.** Make the full multi-phasic mission collaboration workflow mechanically legible. Every state transition in a mission's lifecycle is either *driven by a Hub event* (mechanised) or *driven by a human/agent noticing something* (not mechanised). This doc enumerates every transition, classifies it, and names what primitive the Hub needs in order to mechanise each "not mechanised" step.

The Director bar this serves: *"For missions that are well shaped and planned, Lily+Greg must be able to coordinate end to end without intervention — unless that intervention warrants Director input."* This doc is the target that idea-191 + idea-192 must deliver against.

**Non-goals.** Not a workflow policy (policies live in `multi-agent-pr-workflow.md`, `mission-preflight.md`, `strategic-review.md`). Not a tool-surface redesign (tool/verb shapes defer to idea-121). Not a session-wake solution (session-wake remains deferred).

---

## 1. Entity lexicon (status fields that drive the lifecycle)

| Entity | Status field values | Notes |
|---|---|---|
| **Mission** | `proposed` → `active` → `completed` (or `abandoned`) | Architect-gated preflight gate for `proposed`→`active`; architect-gated close for `active`→`completed` |
| **Task** | `pending` → `working` → `needs_review` → `completed` (or `abandoned`, revision loop via `working`) | Per-task lifecycle; DAG cascade advances dependent tasks on completion |
| **Proposal** | `open` → `accepted` / `rejected` | |
| **Report** | attached to task; implicit submitted-on-create | Status lives on parent task (`needs_review`) |
| **Review** | instantaneous entity; `approved` / `revision_required` | Creation triggers downstream cascades (task status flip + DAG + mission advancement) |
| **Thread** | `active` → `converged` / `round_limit` / `closed` / `abandoned` / `cascade_failed` | Convergence actions fire cascade handlers (create_task, propose_mission, create_idea, update_mission_status, etc.) |
| **Turn** | `planning` → `active` → `completed` | Work-traced unit of agent activity; orthogonal to lifecycle |
| **Idea** | `open` → `triaged` / `dismissed` / `incorporated` | Backlog artifact; matures into mission via design round |
| **Bug** | `open` → `resolved` | |
| **Clarification** | `pending` → `resolved` | Engineer-raised question blocking task progress |
| **pending-action** (ADR-017) | `receipt_acked` → `completion_acked` (or `escalated`) | Queue item dispatched to an agent |
| **notification** | `new` → consumed (implicit) | Push to agent |
| **director-notification** | `new` → `acknowledged` | Push escalated to Director |

The agent-to-Hub surface today exposes three delivery primitives in parallel — `notification`, `pending-action`, `director-notification` — with overlapping semantics. See §5.

---

## 2. Lifecycle phase map

A mission moves through 7 macro-phases. Each is a cluster of transitions:

```
Phase 1 — Ideation           idea filed → triaged → design round opens
Phase 2 — Design             design thread → converged → mission proposed
Phase 3 — Activation         mission proposed → preflight → active → engineer assigned
Phase 4 — Execution          per-task cycle: dispatch → work → PR → review → merge
Phase 5 — Task completion    task completed → DAG cascade → next-task dispatch OR all-done
Phase 6 — Reporting          mission report written → architect review → retrospective
Phase 7 — Close              mission → completed → Director awareness
```

Phases 1-2 are *generative* (produce new work). Phases 3-7 are *executional* (drive work to completion). Today's friction concentrates in Phases 3, 4, and 6-7 — exactly where inbox/trigger mechanisation matters most.

---

## 3. Per-transition audit

Each row: source state → target state | today's trigger | gap | mechanised ideal | escalation policy.

Legend for "gap":
- 🟢 mechanised — Hub fires event / cascade today
- 🟡 partial — some mechanisation but requires agent-in-session
- 🔴 not mechanised — human or agent polling required

### Phase 1 — Ideation

| Transition | Today | Gap | Mechanised ideal | Escalation |
|---|---|---|---|---|
| `idea.open` → `idea.triaged` | Manual triage | 🟡 | Strategic-review cadence produces batch triage; inbox-item to architect for ideas past triage SLA | If idea open > N weeks → Director inbox |
| idea-triaged → design round | Manual thread create | 🟡 | Triage action "promote to design" fires cascade: open thread, notify architect+engineer | — |

### Phase 2 — Design

| Transition | Today | Gap | Mechanised ideal | Escalation |
|---|---|---|---|---|
| Thread opened | Cascade from idea triage | 🟢 | — | If thread opens addressed to offline agent → inbox-item drains on session-start |
| Thread reply | Turn-check + convergence staging | 🟢 | — | If other party silent >24h in-turn → architect/Director inbox |
| Thread `active` → `converged` | Bilateral convergence seal | 🟢 | — | — |
| Converged → mission proposed | `propose_mission` cascade handler | 🟢 | — | — |

*Phase 2 is well-mechanised today (Threads 2.0 / ADR-013/014).* Biggest risk is cold-thread-waiting-for-offline-participant (see Phase 4 routing-mismatch pattern — mission-47 §3.2).

### Phase 3 — Activation

| # | Transition | Today | Gap | Mechanised ideal | Escalation |
|---|---|---|---|---|---|
| 3.1 | `mission.proposed` → `mission.active` | Architect manually flips via `update_mission`; no preflight gate enforced | 🔴 | Preflight checklist encoded as cascade: status flip blocked until checklist items green (scope sealed, owner assigned, success criteria, tele alignment) | If mission sits in `proposed` > preflight-SLA → Director inbox |
| 3.2 | `mission.active` → engineer assignment | **No event. Engineer learns via out-of-band thread ping.** | 🔴 | On `mission.active`, fire inbox-item to mission.owner (engineer role) — directive: "mission active; draft task plan or claim first task" | If assignment unread > SLA → architect inbox |
| 3.3 | Task creation from mission plannedTasks | Cascade advances issued-task on mission-advancement path (ADR task-316) | 🟢 | — | — |
| 3.4 | `task.pending` → dispatched to engineer | Pending-action queue item | 🟡 (requires engineer session or drain) | Inbox-item push-immediate + queued for drain-on-session-start | If undrained > SLA → architect inbox |

### Phase 4 — Execution (per-task cycle)

The highest-friction phase. PR/review/merge events live in GitHub; Hub is blind to them today.

| # | Transition | Today | Gap | Mechanised ideal | Escalation |
|---|---|---|---|---|---|
| 4.1 | Engineer claims/starts task | Task status flips `pending` → `working` on get_task | 🟢 | — | — |
| 4.2 | Engineer opens PR | GitHub event; no Hub signal | 🔴 | **idea-191 repo-event-bridge:** GH event → Hub → inbox-item to CODEOWNER (architect) | If PR open + no review > 30min in-session or 4h out-of-session → architect/Director inbox |
| 4.3 | Architect reviews PR on GitHub | GitHub event; no Hub signal | 🔴 | **idea-191:** GH event → Hub → inbox-item to PR author | If revision_required + engineer silent > SLA → architect inbox |
| 4.4 | PR auto-merges on green + approved | GitHub auto-merge (proposed policy) | 🔴 | **idea-191:** GH merge event → Hub → task-completion trigger → DAG cascade | — |
| 4.5 | Engineer submits Hub-side task report | `create_review` path on task report entity | 🟡 (manual) | On `task.needs_review`, fire inbox-item to mission.architect | If report unread > SLA → architect inbox |
| 4.6 | Architect reviews report (`create_review`) | Cascade: task→completed; DAG advance; mission-advancement cascade | 🟢 | — | — |
| 4.7 | Review `revision_required` → engineer revises | Dispatch `address_feedback` intent; inbox-item to engineer | 🟡 (requires session or drain) | Same, with in-session push where possible | revisionCount ≥ 3 → architect pool escalation (exists today) |

**The headline gap: transitions 4.2, 4.3, 4.4 are 100% off-Hub today.** idea-191 closes all three with one primitive.

### Phase 5 — Task completion + DAG cascade

| # | Transition | Today | Gap | Mechanised ideal | Escalation |
|---|---|---|---|---|---|
| 5.1 | Task `needs_review` → `completed` on approved review | Cascade (task-316) | 🟢 | — | — |
| 5.2 | DAG unblocks dependent tasks | Cascade | 🟢 | — | — |
| 5.3 | Mission plannedTask advancement (issued → completed → next issued) | Cascade (task-316 / idea-144 Path A) | 🟢 | — | — |
| 5.4 | All tasks complete → ready-for-report | **No event.** Engineer must notice. | 🔴 | On all-tasks-complete for mission, fire inbox-item to mission.engineer: "write mission report" | If mission has zero open tasks + no report > SLA → engineer inbox |

### Phase 6 — Reporting

| # | Transition | Today | Gap | Mechanised ideal | Escalation |
|---|---|---|---|---|---|
| 6.1 | Engineer authors closing report | Manual disk write at `docs/audits/m-<slug>-closing-report.md` | 🟡 (convention, no enforcement) | Hub-side report entity with status field + inbox trigger | — |
| 6.2 | Architect authors retrospective | Manual disk write at `docs/reviews/mission-<N>-retrospective.md` | 🟡 (convention) | Hub-side retrospective entity paired with mission | — |
| 6.3 | **Report submitted → architect notified** | **No event. Architect must poll or be in session.** | 🔴 | Report-submit fires inbox-item to mission.architect | If unread > SLA → Director inbox |
| 6.4 | **Review/retrospective submitted → engineer notified** | **No event.** Greg's phrase: "goes into a black hole." | 🔴 | Review-submit fires inbox-items to author + Director | If unread > SLA → Director inbox |

### Phase 7 — Close

| # | Transition | Today | Gap | Mechanised ideal | Escalation |
|---|---|---|---|---|---|
| 7.1 | Architect approves close | Manual | 🟡 (architect-gated precedent) | Retrospective-submit can stage `update_mission_status` cascade action | — |
| 7.2 | `mission.active` → `mission.completed` | `update_mission` status flip | 🟢 | — | — |
| 7.3 | **Mission completed → Director awareness** | **No event.** Director must notice. | 🔴 | Mission-completed fires Director inbox-item | — |

---

## 4. Synthesis — transitions by mechanisation class

| Class | Count | Notes |
|---|---|---|
| 🟢 Fully mechanised | ~11 | Phase 2 design, Phase 5 cascade, review-triggered cascades — these work today |
| 🟡 Partial / session-dependent | ~8 | Requires agent-in-session or drain-on-session-start |
| 🔴 Not mechanised | ~11 | The gap. Agents or Director must notice + act. |

The 🔴 transitions cluster in Phase 3 (activation), Phase 4 (PR/review/merge), and Phases 6-7 (reporting + close) — exactly the friction the Director named.

---

## 5. Missing primitives

Four primitives, each addressing a transition cluster:

### 5.1 State-transition triggers (idea-192)

Today every entity's status field changes passively — no typed event emits. Required primitive: every declared status transition fires a typed event with `{sourceState, targetState, entityRef, routedRoles, escalationPolicy}`. The cascade system already does this for certain transitions (review→task, convergence→mission); the primitive generalises it to *every* entity status change that has a downstream actor.

Closes: 3.2, 3.4, 4.5, 5.4, 6.3, 6.4, 7.3 (7 of 11 🔴 transitions).

### 5.2 Hub-side scheduled events (idea-192)

Today agents do brittle while/wait loops in-session to poll for conditions ("has greg responded yet?"). Required primitive: Hub accepts scheduled-event declarations — "fire X at T+N if Y still true." Enables timeout-based escalations as first-class without agent token burn.

Closes: all escalation policy columns above. Without this, escalation remains notional.

### 5.3 External-event ingestion (idea-191 repo-event-bridge)

PR/review/merge events live in GitHub; Hub is blind to them today. Required primitive: a pluggable event-source contract with poller (laptop-Hub, outbound-only) + webhook (future cloud-Hub) implementations, translating external events into Hub state-transition triggers.

Closes: 4.2, 4.3, 4.4 (the Phase 4 GH-blind transitions).

### 5.4 Session-wake (deferred — idea-121 territory)

Today notifications only reach agents in active Claude Code sessions. Inbox-drain-on-session-start (D in the 2026-04-25 discussion) bridges the offline case acceptably. Full mechanisation would include Hub-triggered session spawn. Out of scope for idea-191 + idea-192; tracked separately.

---

## 6. Duplicate primitives — rationalisation

Current delivery primitives (agent-adapter MCP surface):

| Primitive | Purpose | Delivery semantics |
|---|---|---|
| `notification` | Push to specific agent | Push, in-session preferred |
| `pending-action` | Queue item a role draws from | Pull, via `drain_pending_actions` |
| `director-notification` | Escalation to Director | Push to Director role |
| `turn` | Work-traced activity unit | Not a delivery primitive (orthogonal) |
| `thread` | Conversation grouping | Not a delivery primitive (orthogonal) |
| `audit-entry` | Write-only side-effect log | Not a delivery primitive (orthogonal) |

**Rationalisation:** `notification` + `pending-action` + `director-notification` collapse into one concept — **inbox-item** — routed to a role/agent target with a delivery-policy field (`push-immediate` / `queued` / `scheduled`). Push vs pull is a delivery mechanism, not a model distinction; Director is a role target, not a special primitive. Tool-surface verbs/envelopes defer to idea-121.

`turn`, `thread`, and `audit-entry` are orthogonal layers (activity / conversation / write-only log) — keep as-is.

**Net:** 3 → 1 on the delivery surface; 3 orthogonal layers unchanged.

---

## 7. Perfection — the end-state walkthrough

A mission progresses without any agent having to *check* state. Each state transition fires a typed event; each event routes to a role's inbox; each inbox-item carries an escalation policy; agents drain inbox on session-start and react to in-session pushes. *No polling. No while/wait loops. No "did greg see my review yet?"* Director appears only where escalation policy explicitly routes to Director — by design, not by "agents don't know what to do."

Illustrative mission walkthrough with idea-191 + idea-192 delivered:

```
Director seals mission design round → thread cascade fires propose_mission
  → mission.proposed → preflight cascade checks scope/owner → mission.active
  → inbox-item to engineer ("claim first task")
Engineer drains inbox → starts T1 → opens PR
  → repo-event-bridge polls GH → inbox-item to architect ("review PR")
Architect drains inbox → reviews on GitHub → review-submit
  → repo-event-bridge polls GH → inbox-item to engineer ("revise" or "merge-ready")
Engineer sees auto-merge land → repo-event-bridge → task-completion trigger
  → DAG cascade → next plannedTask issued → inbox-item to engineer
  (...loop T2-Tn...)
All tasks complete → trigger → inbox-item to engineer ("write mission report")
Engineer submits report → trigger → inbox-item to architect ("review report")
Architect submits retrospective → trigger → inbox-items to engineer + Director
Director acks → trigger → mission.active → mission.completed
  → inbox-item to Director ("mission closed")
```

Director touchpoints: mission-active activation (preflight sign-off) + mission-completed close. Both are decision points; neither is unblocking. Everything between is mechanised.

Failure modes become visible via escalation policies: if any inbox-item sits undrained past its SLA, the escalation fires — so *silent drift* becomes *explicit Director notification*. That's the structural shift from today's "discipline drifts under cadence" pattern.

---

## 8. Delivery path

Per Director direction 2026-04-25:

1. **Next engineer mission:** idea-190 M-Local-FS-Cutover. No workflow-primitive dependency.
2. **After local-fs cutover ships:** design rounds for idea-191 (repo-event-bridge) + idea-192 (hub-triggers-inbox), informed by this audit doc. These are co-dependent: bridge fires *into* the inbox; can ship partial with stub sink, or sequence inbox primitive first.
3. **Session-wake (idea-121 territory):** remains deferred.

This doc is the sizing input for both idea-191 and idea-192 design rounds. Revise this doc as those design rounds surface refinements — treat it as the living primitive-requirement reference, not a one-shot ratified spec.

---

## 9. Open questions for next design rounds

For idea-192 (hub-triggers-inbox) design round:
- Escalation policy shape: attached to transition definition or attached to inbox-item? (Probably transition; agents shouldn't set policies.)
- Scheduled-event granularity + persistence model: per-event record or derived from entity state? (Leaning derived where possible; persist where conditional re-evaluation is non-trivial.)
- Inbox-item retention after drain: keep with acked status for audit? (Probably yes — eats existing pending-action ADR-017 `receipt_acked`/`completion_acked` pattern.)

For idea-191 (repo-event-bridge) design round:
- Polling cadence: constant vs adaptive (bursty around known activity)?
- Failure semantics: GH API rate-limit hit → queue vs drop?
- Authentication: PAT vs GitHub App — security/permissions trade-off.
- Cursor storage: per-repo or per-event-type?

For idea-197 (Hub auto-redeploy on main-merge) design round:
- Per-deployment-pattern policy: Cloud Run auto-deploys cleanly; laptop-Hub needs operator-confirmation per ADR-024 §6.1 single-writer-prod posture. Hybrid model.
- Notification path on build success/failure: Hub director-notification entity, Slack/email, or merge-PR-comment.
- Image-tagging discipline (SHA + branch + latest) for pin-to-build rollback path.
- Sequencing with bug-33 fix — auto-deploys would propagate the bug-33 trap class until that lands.

For idea-196 (Hub state backup cadence) design round:
- Source-of-truth framing: GCS as live mirror (any divergence is a problem) vs drift-tolerant archive (divergence is expected, sync is intentional). Load-bearing decision.
- Cadence model: on-mission-close, periodic, manual-only, event-driven. Each maps to different operator-experience tradeoffs.
- Retention: rolling-latest vs versioned/dated archives.
- Multi-machine coordination: state-sync.sh from a different worktree → divergence risk.

---

## 10. Mission-coordination patterns observed (mission-48 + mission-49 carry-forward)

### 10.1 Thread round-limit hits at maxRounds=10 in active per-PR coordination missions

Observed mission-48: thread-306 hit `round_limit` (auto-escalation) at PR #27 announce — mid-mission, blocking architect reply. Mission needed thread rotation (thread-306 → thread-307) to continue T3+T4 coordination.

**Heuristic for thread maxRounds at open time** (proportional to expected exchange volume):
- Design-round threads: 10 default — usually 2-4 rounds, 10 is safe
- Per-task PR-coordination threads: ~2× task count + 4 (for setup/seal); a 6-task mission needs `maxRounds=20`
- Default 10 is too low for >3-task PR-coordination missions

**Until tooling supports infinite-rounds or transparent-rotation:** set `maxRounds=20` at open-time for per-PR coordination threads in 4+ task missions, OR plan rotation at the halfway boundary explicitly.

**Idea-192 (Hub triggers + inbox) scope implication:** the workflow-primitive thread should not have a fixed round cap, OR rotation should be transparent. Capture as design-input.

### 10.2 ADR-amendment scope discipline

Mission-48 T1 amended ADR-024 with §6.1 reclassifying local-fs from dev-only to single-writer-laptop-prod-eligible. **The amendment was deployment-context reclassification, NOT a contract change.** The 6-primitive surface, capability flags, CAS semantics — all unchanged.

**Methodology rule (architect-voice clarification):** ADR amendments classified by *what they change*:
- Contract-change amendments require a new ADR (or numbered version-bump per project convention)
- Deployment-context amendments (where to use the contract, under what operational discipline) sit cleanly as in-place §Amendments sections on the existing ADR

The distinction matters because future architects auditing an ADR should be able to tell instantly: was the contract modified? Was deployment scope expanded? Both have different forward-compatibility implications.

### 10.3 Bug-31 cascade-bookkeeping bypass via skip-plannedTasks

Observed mission-49 (3 cascade duplicates fired with plannedTasks set) vs mission-48 (zero cascade duplicates with plannedTasks deliberately skipped). Demonstrated bypass technique: activate mission with no plannedTasks; manually create_task per task as prior approves. Mission entity description retains full task plan (already captured from propose_mission cascade) — plannedTasks visibility was redundant.

**Standing technique** until bug-31 lands a fix. Documented in `feedback_plannedtasks_manual_create_mismatch.md` memory.

---

## 11. Change log

| Date | Change |
|---|---|
| 2026-04-25 | v0.1 draft (architect lily). Follows Director discussion in mission-47 retrospective. Companion to ideas 190, 191, 192, 193. |
| 2026-04-25 | v0.2 amendment — added §10 mission-coordination patterns from mission-48 + mission-49 carry-forwards (thread round-limit, ADR-amendment scope, bug-31 bypass); added open-question rows for ideas 196 + 197. |
