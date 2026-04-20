# Phase 2d Checkpoint 3 — Lifecycle GC + Bidirectional Integrity

**Mission:** M-Cognitive-Hypervisor
**Tasks:** task-308 (C5 handshake label refresh) + task-309 (C4 Agent reaper). C1–C3 landed engineer-initiated in the prior session on the back of the CP1 audit recommendations.
**Threads:** thread-234 (architect brainstorm converged; cascade-unpin + reaper-default directions ratified)
**Date:** 2026-04-21 AEST (C1–C3 + C6 this report) + 2026-04-22 AEST (C4/C5)
**Scope of this report:** the six CP3 deliverables defined in the CP1 audit report §5.2 + architect's thread-234 direction on C4/C5:

- C1 Thread-reaper → pending-action queue bidirectional integrity
- C2 `prune_stuck_queue_items` → thread-scoped observability (forward/reverse symmetry)
- C3 Summary-only truncation on closed threads
- C4 Background Agent reaper with cascade unpin (bug-16 part 1)
- C5 Handshake label refresh on reconnect (bug-16 part 2)
- C6 This report

All code changes landed in commits `a7a74e2` (C1), `a079e50` (C2), `73b3632` (C3), `9385290` (C5), `6eacfca` (C4) on `main`. C4 shipped after C5 per architect direction (thread-234 Q3) — the sequencing lets the handshake-refresh win land before the reaper's cross-store delete semantic is introduced.

---

## 1. Deliverable scorecard

| CP3 deliverable (from CP1 §5.2 + thread-234 architect direction) | Status | Evidence |
|---|---|---|
| Thread-reaper cascades queue-abandonment for reaped thread's PendingActionItems | ✅ Complete | `hub/src/index.ts` `runThreadReaperTick`; `IPendingActionStore.listNonTerminalByEntityRef` on Memory + GCS; 3 unit tests in `gcs-pending-action.test.ts` |
| Per-item `queue_item_abandoned_via_thread_reaper` audit + error-isolated error handling | ✅ Complete | `index.ts:325-332`; try/catch at `index.ts:337-339` preserves reaper tick on queue failure |
| `prune_stuck_queue_items` writes thread-scoped audit entry on thread-bound dispatches | ✅ Complete | `pending-action-policy.ts`; 2 unit tests in `pending-action-prune.test.ts` |
| `prune_stuck_queue_items` dispatches thread-scoped SSE event (`thread_queue_item_pruned`) | ✅ Complete | Same policy-layer change; dispatch via participant engineerIds |
| Non-thread-bound dispatches exempt from the new thread-wiring path | ✅ Complete | `dispatchType` filter in `pending-action-policy.ts` |
| Closed-thread message truncation at read boundary (summary + first-3 + last-3) | ✅ Complete | `truncateClosedThreadMessages` helper + `CLOSED_THREAD_MESSAGE_KEEP` constant on `state.ts`; applied in `MemoryThreadStore.getThread` / `.listThreads` and `GcsThreadStore` equivalents; 9 tests in `thread-truncation.test.ts` |
| Handshake label refresh on reconnect (bug-16 part 2) | ✅ Complete | `registerAgent` reconnect path on both impls honors `payload.labels ?? priorLabels`; `RegisterAgentSuccess.changedFields` reports the diff; session-policy emits `agent_handshake_refreshed` audit; 4 unit tests + 1 flipped registry test |
| Background Agent reaper with 7-day default threshold | ✅ Complete | `HUB_AGENT_STALE_THRESHOLD_MS` env (default 7 days); `HUB_AGENT_REAPER_INTERVAL_MS` (default 1h); `runAgentReaperTick` + `startAgentReaper` in `index.ts` |
| Cascade unpin: `thread.currentTurnAgentId` null-ed before Agent deletion | ✅ Complete | `IThreadStore.unpinCurrentTurnAgent` on Memory + GCS (OCC-wrapped); per-thread audit `thread_currentturn_unpinned_via_agent_reaper`; 4 unit tests in `thread-unpin.test.ts` |
| Per-deletion `agent_reaper_deleted` audit | ✅ Complete | `index.ts` reaper tick emits with role + fingerprint snippet + staleMs |
| Agent reaper tests: threshold logic + idempotency + fingerprint reuse post-delete | ✅ Complete | 4 unit tests in `m18-agent.test.ts` (new `MemoryEngineerRegistry agent reaper` describe block) |
| Audit report (this document) | ✅ Complete | This file |

CP3 unblocks Mission Phase 3 (E — state hydration + reconciliation / idea-114 / ADR-020). CP4 (`retry_cascade` tool) remains independent — prerequisites closed in CP2; no new dependency introduced by CP3.

Bug-16 can now be flipped to `resolved` with `fixCommits: [9385290, 6eacfca]` once architect confirms via the C4/C5 reviews (both already approved).

---

## 2. New audit surface

CP3 introduces four new audit action names. The audit store is the canonical observability path until the module-scope MetricsCounter hoisting lands (flagged in §7.1 as a CP3 follow-up).

| Audit action | Actor | relatedEntity | Fires when |
|---|---|---|---|
| `queue_item_abandoned_via_thread_reaper` | `hub` | queue item id | Thread reaper abandoned a non-terminal queue item pinned to a reaped thread (C1) |
| `thread_queue_item_pruned` | `hub` | thread id | `prune_stuck_queue_items` abandoned a thread-bound queue item (C2) |
| `agent_handshake_refreshed` | `hub` | engineerId | Handshake payload on reconnect changed one or more stored mutable fields (C5 — today: `labels` only; `advisoryTags` + `clientMetadata` currently refresh silently) |
| `thread_currentturn_unpinned_via_agent_reaper` | `hub` | thread id | Agent reaper unpinned `currentTurnAgentId` on a thread prior to deleting the victim agent (C4) |
| `agent_reaper_deleted` | `hub` | engineerId | Agent reaper deleted a stale (offline > threshold) Agent record (C4) |

Net effect: reaper + prune + handshake-refresh are traceable end-to-end via `list_audit_entries({relatedEntity: <thread|engineerId>})` without the caller needing to query multiple entity types.

---

## 3. C1+C2 — queue/thread bidirectional integrity

### 3.1 The gap CP1 §5.2 documented

Before CP3 the thread reaper transitioned idle threads to `abandoned` but left any PendingActionItems that referenced those threads in `receipt_acked` state indefinitely. Symmetric reverse: `prune_stuck_queue_items` abandoned queue items but gave observers no thread-scoped hook to detect the failure.

### 3.2 Forward direction (C1)

New store method:
```typescript
IPendingActionStore.listNonTerminalByEntityRef(entityRef: string): Promise<PendingActionItem[]>;
```
Returns queue items in `enqueued | receipt_acked` pinned to the given entity. Memory impl scans the item Map; GCS impl list-and-filters.

Reaper integration in `runThreadReaperTick` (`index.ts:311-339`): after each reaped thread, enumerate tied items, call `pendingActionStore.abandon(item.id, reason)` per item, emit `queue_item_abandoned_via_thread_reaper` audit. The try/catch isolates per-thread queue failures so the reaper tick proceeds to the next thread (INV-TH26 recoverability).

### 3.3 Reverse direction (C2)

`prune_stuck_queue_items` already abandoned stuck queue items and emitted a queue-entity audit (`queue_item_abandoned`, relatedEntity=`item.entityRef`). CP3 C2 adds a **second** audit entry on thread-bound dispatches (`thread_message` | `thread_convergence_finalized`) keyed to the thread: `thread_queue_item_pruned` (relatedEntity=thread.id). Plus a `thread_queue_item_pruned` SSE event dispatched to thread participants with resolved agentIds.

**Why two audit entries:** the queue-entity entry stays the authority for queue-forensics (resilience reports, retry replay). The thread-scoped entry makes the prune visible to thread-centric queries without scanning queue audit entries.

Non-thread-bound dispatch types (`task_issued`, `proposal_submitted`, `report_created`, `review_requested`) are exempt — those entities own their own lifecycle and don't need thread-aware wiring.

### 3.4 Deferred observability: counter hoisting

`thread.reaped` / `thread.reap_failed` metrics counter instrumentation was deferred in C1 because the policy-layer `MetricsCounter` is scoped per `createMcpServer` invocation, not module-scope. Hoisting is one-off refactor work that CP3 chose not to bundle. The audit log is the observability surface today — both `thread_reaper_abandoned` (pre-CP3) and `queue_item_abandoned_via_thread_reaper` (new) are persisted. Agent reaper (C4) inherits the same trade-off: `agent.reaped` / `agent.reap_failed` counters will land the moment the MetricsCounter hoist does. Flagged as a CP3 follow-up (§7.1).

---

## 4. C3 — summary-only truncation on closed threads

### 4.1 Rule

```
if thread.status === "closed" AND thread.messages.length > 6
  → return a shallow-copy with messages = [...first 3, ...last 3]
else
  → return unchanged
```

### 4.2 Design boundaries

**Narrow interpretation — only `closed`.** `converged` / `cascade_failed` / `round_limit` / `abandoned` preserve full history. Rationale: `converged` can transition to `cascade_failed` and the forensic trail matters; `cascade_failed` has explicit failure-analysis value; `round_limit` + `abandoned` are transient pre-close states. Only `closed` is fully terminal + low-value-forensic for the bulk of messages.

**Read-time trim, not persistence trim.** The helper is a pure transform applied at the reader boundary. GCS per-file message entries + Memory backing both retain the full history. If forensic recovery is needed later, the raw messages are still available via direct GCS reads or a future `list_thread_messages` tool.

**Preserved fields:** `summary`, `convergenceActions`, `participants`, `labels`, `createdBy`, `roundCount`, timestamps, the first 3 + last 3 messages. **Dropped (from the read view only):** the middle message slice on eligible threads.

### 4.3 Impact snapshot

At the time of writing (2026-04-21 AEST):
- 278 threads total in GCS
- 68 `status === "closed"` (threads 1..233 cumulative across phases)
- Average trimmed thread: ~18 messages stored, 6 returned → ~66% payload reduction per read
- Cheap filter: read-path cost is one length check + one slice

---

## 5. C5 — handshake label refresh on reconnect (bug-16 part 2)

### 5.1 The gap bug-16 documented

`registerAgent` on reconnect had an explicit "Labels are immutable post-create in v1 — payload.labels is silently ignored" line (state.ts pre-CP3, gcs-state.ts pre-CP3). This was the Mission-19 v1 design decision, but it broke every cross-env reconnect where the adapter declared new labels. Thread-228 repro: kate reconnecting with `env=dev` onto a record pinned to `env=prod`; the Hub kept the prod labels; Mission-19 dispatch routed her tasks to the wrong pool silently.

### 5.2 The fix

`registerAgent` reconnect path on both Memory + GCS impls now resolves labels via:
```typescript
const priorLabels = agent.labels ?? {};
const nextLabels = payload.labels ?? priorLabels;
```
- Caller provides `payload.labels: {env: "dev"}` → overwrites stored
- Caller provides `payload.labels: {}` → explicitly clears
- Caller omits `payload.labels` (undefined) → preserves stored

The distinction required stripping the `?? {}` coercion in session-policy. New `shallowEqualLabels` helper at the state.ts module level detects refresh vs. no-op.

`RegisterAgentSuccess` gained optional `changedFields: ("labels" | "advisoryTags" | "clientMetadata")[]` + `priorLabels: AgentLabels`. Session-policy emits `agent_handshake_refreshed` audit entry when `changedFields` is non-empty, carrying the priorLabels → newLabels diff for forensic traceability.

### 5.3 Role immutability preserved

The Hub already rejected role mismatch on reconnect with `code: "role_mismatch"` as a hard security boundary. C5 does NOT relax this — role change for the same fingerprint still requires `deleteAgent` + fresh handshake. Architect confirmed this as the correct safeguard against identity spoofing in the task-308 review.

### 5.4 `advisoryTags` + `clientMetadata` — pre-existing behavior unchanged

Both already refreshed on reconnect prior to CP3 (line-level: `agent.clientMetadata = payload.clientMetadata`; `agent.advisoryTags = payload.advisoryTags ?? {}`). CP3 C5 did NOT add diff-detection for these fields today; they refresh silently. Extension point for the C6-audit-surfaced question: the `changedFields` union already supports `"advisoryTags" | "clientMetadata"` — one-line addition per field if operators want granular forensics on those too.

---

## 6. C4 — Agent reaper with cascade unpin (bug-16 part 1)

### 6.1 The gap bug-16 documented

`GcsEngineerRegistry.endSession` correctly flipped `status: offline` on disconnect, but no background mechanism ever deleted those offline records. At the kate co-location repro: 25 engineers total, 22 offline, oldest lastSeenAt 2026-04-17 — a long tail of smoke-test agents persisting indefinitely. Plus thread-228's stale-pin failure mode (`currentTurnAgentId` pointing at an agentId whose Agent record would eventually be reaped — orphaning the thread).

### 6.2 Architect direction (thread-234)

Four questions answered:
1. **Threshold default:** 7 days via `HUB_AGENT_STALE_THRESHOLD_MS` env (ms-denominated, matches existing Hub env pattern).
2. **Cascade interaction:** unpin to null (not thread-abandon). Preserves thread's other participants + their ability to pick up the next turn.
3. **Sequencing:** C5 first, C4 second. Landed in that order.
4. **Authority model:** background automatic (interval-driven). No MCP tool for v1. idea-122's operator affordance stays architect-triage-pending as a separate arc.

### 6.3 Implementation

Two-phase design keeps the registries decoupled:

**Phase A — Enumerate + Unpin (ThreadStore):**
```typescript
IEngineerRegistry.listOfflineAgentsOlderThan(staleThresholdMs): Promise<Agent[]>;
IThreadStore.unpinCurrentTurnAgent(agentId): Promise<string[]>;   // returns unpinned thread ids
```
GCS impl of `unpinCurrentTurnAgent` wraps each thread update in `updateExisting` OCC — a concurrent reply that lands between list + write is tolerated (transform re-checks the pin, throws `TransitionRejected` on mismatch, reaper tick skips that thread).

**Phase B — Delete (EngineerRegistry):**
```typescript
IEngineerRegistry.deleteAgent(engineerId): Promise<boolean>;
```
Memory impl deletes from 5 internal maps (agents, byFingerprint, displacementHistory, lastTouchAt, sessionToEngineerId). GCS impl removes both `agents/<id>.json` and `agents/by-fingerprint/<fp>.json`. Delete-order is per-engineerId-first, by-fingerprint-second: a crash between the two calls leaves a dangling fingerprint alias, which a concurrent handshake retry can safely reuse (registerAgent first-contact path treats missing agents as fresh).

**Reaper orchestration in `runAgentReaperTick`:**
1. List stale agents.
2. For each: unpin any threads → emit per-thread audit → delete agent → emit agent audit. Per-agent errors are caught + logged; the next tick retries still-stale records.

### 6.4 Cascade-unpin failure modes considered

- **Reply lands mid-unpin:** OCC catches it; thread stays replyable by the new turn-holder. The reaper's unpin-list excludes the thread; next reaper tick will reconsider if the agent is still stale after the reply resolves.
- **Agent came back online mid-tick:** `listOfflineAgentsOlderThan` re-queries on each tick; a re-online agent is not in the next tick's list. Current-tick delete happens anyway (the agent was offline at list time); if that's too aggressive, a follow-up C6-surfaced recommendation is to re-read each agent's liveness immediately before delete. Not implemented today — false-positive rate is expected to be 0 in practice because offline→online requires explicit reconnect work in the <1 second gap between list and delete.
- **Two concurrent reaper processes:** `deleteAgent` returns false on second call (file already 404'd), but both processes would emit audit entries. Idempotent for state; non-idempotent for audit. Mitigation: single-process deployment is the current assumption.

---

## 7. Findings surfaced in CP3 (closed, documented, or deferred)

### 7.1 Counter hoisting (deferred from C1; re-flagged in C4)

**Finding:** Reaper-tick metrics (`thread.reaped`, `thread.reap_failed`, `agent.reaped`, `agent.reap_failed`) can't be emitted today because the policy-layer `MetricsCounter` is per-`createMcpServer` scope, not module-scope. `index.ts` reaper ticks can't reach it.

**Why deferred:** module-scope hoist requires touching metrics-wiring across the server lifecycle. Not bundled into CP3 to keep C1/C4 scope-tight.

**Recommendation:** one-shot follow-up task hoisting the counter to module scope. Thread reaper + Agent reaper + prune handler would then emit uniformly. Audit log remains authoritative post-hoist; the counters are for live Grafana-style dashboards only. Low risk, ~1–2 hour scope.

### 7.2 `changedFields` diff-detection on `advisoryTags` + `clientMetadata` (deferred)

**Finding:** C5's `agent_handshake_refreshed` audit fires only when labels change. `advisoryTags` + `clientMetadata` refresh silently on every reconnect today (their existing behavior).

**Why deferred:** the type `changedFields: ("labels" | "advisoryTags" | "clientMetadata")[]` already supports all three. Adding diff-detection requires one shallow equality helper per field + one new branch in the diff-detail composition in session-policy. Not bundled because no operator use-case has yet surfaced requiring the additional forensic granularity.

**Recommendation:** pull the extension in if a future audit finding or operator request names the gap. Until then, the labels-only emission keeps audit-log noise proportionate to the real-world bug class (Mission-19 label routing drift).

### 7.3 `GcsThreadStore.unpinCurrentTurnAgent` scale (flagged, not fixed)

**Finding:** The GCS impl lists all threads and filters client-side because there's no secondary index on `currentTurnAgentId`. At current scale (278 threads) this is a handful of kB per reaper tick — negligible. At 10× the thread count it becomes a meaningful list operation per reaper cadence (default 1/hour).

**Why not fixed:** premature optimization. `IThreadStore.listThreads` is the only read surface today; adding a secondary index would duplicate storage + add invalidation complexity. The reaper cadence is 1h by default; even a 2800-thread listing once per hour is <1s of GCS time.

**Recommendation:** revisit if `list_threads` becomes a measured hot path (either from the reaper or from `list_threads` LLM calls). A secondary index on `currentTurnAgentId` mapped to `[threadIds]` would be additive; the Mission-19 equivalent pattern is `agents/by-fingerprint/` and works. For now, the `updateExisting` OCC wrap ensures correctness regardless of list size.

### 7.4 Reaper authority on currently-online reconnected-within-window agents

**Finding:** `listOfflineAgentsOlderThan` captures the agent as stale at list time; a reconnect at t+1ms would make them online, but the reaper tick continues on the snapshot and deletes them. In practice this is vanishingly rare because the tick runs to completion in <1s; a reconnect that just succeeded would see its Agent record disappear before the reconnect's Hub-side writes finalize.

**Why deferred:** no observed occurrence. The documented mitigation (re-fetch agent immediately before delete, bail if status=online) would add a GCS read per candidate which is not worth the cost absent repro.

**Recommendation:** if any prod log line ever shows `agent_reaper_deleted` followed by a `role_mismatch` or "agent_not_found" from the handshake inside the same second, add the bail-check. Today the log line count is expected to be zero.

### 7.5 Duplicate audits under concurrent reaper processes (acknowledged)

**Finding:** If two Hub processes both run the reaper (multi-replica deployment hypothetical), both lists contain the same stale agents. `deleteAgent` on the second process returns `false` (file already 404'd in GCS), but both processes emit `agent_reaper_deleted` audit entries.

**Why deferred:** the current deployment is single-process Cloud Run. If we migrate to multi-replica, a reaper-election mechanism (leader lock in GCS with TTL) would address this. Not CP3 scope.

**Recommendation:** treat the reaper as single-writer today. If multi-replica Hub becomes a requirement, add a TTL lock at `agents/.reaper-lock` acquired at tick start.

### 7.6 bug-16 closure path

**Finding:** Both parts of bug-16 are now closed in code (C4 + C5). Hub-state transition from `open → resolved` is the engineer's authority per the state-hygiene audit pattern that landed ideas 117/120/123 and bugs 14/15 in prior sessions.

**Recommendation (for this session):** flip bug-16 to `resolved` with `fixCommits: ["9385290", "6eacfca"]` and a resolution note once the C6 report is reviewed. Done AFTER this report's architect review to avoid pre-empting the review outcome.

---

## 8. Test coverage added

| File | Tests added | Purpose |
|---|---|---|
| `hub/test/unit/pending-action-prune.test.ts` | 2 | C2 thread-scoped audit + dispatch; non-thread-bound exemption |
| `hub/test/unit/gcs-pending-action.test.ts` | 3 | C1 `listNonTerminalByEntityRef`: matching states, terminal-state exclusion, empty-ref |
| `hub/test/unit/thread-truncation.test.ts` | 9 | C3 helper edge cases (non-closed, short, boundary, >6, field preservation) + integration (getThread + listThreads trim closed; don't trim active) |
| `hub/test/unit/m18-agent.test.ts` | 4 | C5 reconnect label refresh / omission preservation / no-op / explicit-clear |
| `hub/test/mission-19/registry.test.ts` | 1 flipped | C5: old "displacement preserves originally-persisted labels" invariant flipped to assert refresh (annotated as superseding INV-AG1) |
| `hub/test/unit/m18-agent.test.ts` | 4 | C4 `listOfflineAgentsOlderThan` / `deleteAgent` / missing-id / fingerprint-reuse |
| `hub/test/unit/thread-unpin.test.ts` (new file) | 4 | C4 `unpinCurrentTurnAgent`: match filter / empty list / idempotency / updatedAt bump |

**Total:** 580 hub tests pass, 5 skipped; `npx tsc --noEmit` clean on every commit.

---

## 9. CP4 / Phase E readiness

### 9.1 CP4 (`retry_cascade` tool)

**Independent of CP3.** CP2 closed the last prerequisite (bug-14 idempotency). CP3 adds nothing that blocks or unblocks CP4. Status unchanged: unblocked.

### 9.2 Mission Phase 3 / E (state hydration + reconciliation)

**CP3 closes one prerequisite.** Phase 3's `verify_thread_state` pre-flight check presumes thread pinning is authoritative when read. Pre-CP3 the pin could be stale (bug-16 repro); the reaper + cascade-unpin now maintain the invariant "every thread's `currentTurnAgentId` references a live Agent or is null." Phase 3 design can rely on this invariant without a separate reconciliation pass.

The re-hydration-on-drift loop that Phase 3 design (ADR-020) contemplates can skip the "agent disappeared" reconcile path specifically — the Hub side is now self-healing for that class. Phase 3 still needs hydration for the common drift cases (label mismatches, stale task counts, thread-state replay) — CP3 does not pre-empt those.

### 9.3 idea-132 (Hypervisor-adapter mitigations mission)

**Partial unblock.** Mitigation #6 (tool-error elision via structured subtype + remediation) was made mechanizable by CP2 C2's `ThreadConvergenceGateError` shape. CP3 does not directly contribute new adapter-side primitives, but the audit-surface additions (`agent_handshake_refreshed` et al.) provide forensic grounding for any future adapter-layer instrumentation on reconnect-drift events.

---

## 10. Related

- Mission spec: `docs/planning/m-cognitive-hypervisor.md`
- CP1 audit report: `docs/audits/phase-2d-cp1-observability-report.md`
- CP2 audit report: `docs/audits/phase-2d-cp2-report.md`
- Architect brainstorm thread: thread-234 (C4+C5 direction-setting, 4 rounds, bilateral convergence)
- Bug closed this phase: bug-16 (Agent lifecycle — both parts; awaiting engineer flip `open → resolved` post architect review)
- Ideas adjacent: idea-122 (`reset_agent` operator affordance — complements C4's automatic sweep), idea-124 (label routing semantics redesign — complements C5 at the principled-design layer)
- Commits: `a7a74e2` (C1) → `a079e50` (C2) → `73b3632` (C3) → `9385290` (C5) → `6eacfca` (C4) → (this report, C6)
