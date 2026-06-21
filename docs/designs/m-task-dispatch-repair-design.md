# M-Task-Dispatch-Repair — Design (v0.1 DRAFT)

**Status:** DRAFT — design queued for execution after the verifier-hardening + shim batch · **Author:** lily (architect) · **Date:** 2026-06-21 (autonomous stint)
**Origin:** bug-triage DR-005 cluster C1 (top structural leverage). Idea: idea-336. Bugs: **bug-146** (root) + **bug-159** (create_task dispatch-surface gap) + **bug-94** (dispatch/notification gap).
**Class:** coordination-primitive repair / pre-substrate cleanup.

---

## 1. Problem — identity is being used as routing

`create_task` stamps the **caller's** `ois.io/github/login` onto the task as its claim-routing label (Mission-19 entity-label inheritance) and exposes **no assignee parameter**. So an architect-created task (login A) lands `assignedAgentId: null`, `labels.ois.io/github/login: A`. The label-scoped claim path (`get_task` / `getNextDirective`) then correctly excludes any engineer whose login differs (login B) — and since no engineer carries the architect's login, the task is **un-claimable by anyone** → stranded `pending` → `pending→working` never fires → `create_report` rejects ("must be working").

**The result:** the formal Task FSM (claim → working → report → review → completed) is broken for **every** architect-driven dispatch where the architect and the executing engineer have different github logins — i.e. the normal case. It is currently masked only by the thread-dispatch completion-equivalence workaround (entity-mechanics §3.4): PR review+merge stands in for the task record, and the engineer folds the report into the work-trace. The *deliverable* (the PR) is unaffected; the *Hub task ledger* is left littered with stuck `pending` tasks.

**Root, stated precisely:** a **login-label (identity / provenance)** is being conflated with a **claim-selector (routing)**. These are different concerns and must be separated.

**Evidence:** task-415 + task-416 (mission-90 W1/W2, cascade AND direct create_task paths) + task-422 (W8 live audit) all stranded un-claimable. Confirmed on both cascade and direct `create_task`. (bug-146's earlier `.substring` crash + the label-decode are already fixed; the remaining live gap is the caller-login-as-selector + the missing assignee surface — bug-159.)

## 2. Tele-alignment

- **tele-6** (frictionless agentic collaboration) — the canonical architect→engineer dispatch path is broken; this restores it.
- **tele-13** (Director-intent amplification) — the workaround is more manual coordination; formal dispatch reduces it.
- **tele-4** (no silent failure) — a stranded un-claimable task is a silent dispatch failure with no operator signal.
- **tele-3** (sovereign composition) — identity/provenance vs claim-routing are distinct concerns currently tangled; separating them is clean composition.
- **tele-2** (isomorphic spec) — the documented Task FSM diverges from runtime reality; this realigns them.

## 3. Fix (spec-level; construction is the engineer's sovereign call)

1. **First-class assignee on `create_task`.** Add an explicit `assignee` / `targetAgentId` (and/or `claimPool`) parameter. The router labels/routes to the **EXECUTOR**, never the caller. (bug-146 fix-shape (a) — the root fix.)
2. **Stop using the creator's login-label as a claim-selector.** A login-label is identity/provenance; it must not scope claimability. Claim-routing keys on `assignedAgentId` and/or an explicit claim-pool selector. (bug-159 fix-shape (b).)
3. **Unassigned-task fallback (optional, recommended).** An unassigned `create_task` defaults to the global engineer claim-pool — claimable winner-take-all by any `role=engineer` — rather than stranding. (bug-146 (b) / bug-159 (c).)
4. **Re-dispatch surface (optional).** `update_task` can set assignee/claim-pool to re-route a mislabeled task. (bug-146 (c).)

## 4. Success criteria

- An architect-created task (login A) with an explicit assignee (engineer login B) is claimable by B; `claim → working → report → review → completed` completes end-to-end.
- An unassigned `create_task` is claimable by any engineer (global pool), not stranded.
- A cross-login dispatch **e2e** asserts the full FSM (the regression guard).
- The thread-dispatch workaround becomes optional, not load-bearing.

## 5. Scope guard

Hub-side task **dispatch + claim-routing** + the `create_task`/`update_task` surface only. NOT a broader identity/label-system rework, and NOT the Mission-19 label-inheritance mechanism in general (only its misuse as a claim-selector). YAGNI a full claim-pool/RBAC-on-tasks system unless a concrete need appears.

## 6. Risk

Changing claim-routing risks the existing **assigned-task** path (the normal `assignedAgentId=agent-…` greg tasks dispatch correctly today — task-415..421 etc.). The e2e must regression-cover the assigned path alongside the new cross-login + global-pool paths. Fail-safe: prefer explicit-assignee routing; the global-pool fallback only triggers when no assignee is set.

## 7. Sequencing

Execute **after** the verifier-hardening cluster (mission-93) + the OpenCode shim batch (mission-92 R1/R2/R4) land — engineer bandwidth is committed there. Charter as a mission (idea-336 → mission) when the engineer is free; this design is the brief. Survey skipped — the fix space is narrow and the root is confirmed (architect-Director-bilateral norm; recorded in the autonomous-stint decision log).
