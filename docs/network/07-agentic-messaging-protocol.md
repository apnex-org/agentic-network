# Agentic Messaging Protocol (AMP)

**Status:** Proposed
**Date:** 2026-04-13
**Authors:** Architect + Engineer (converged in thread-61)
**Supersedes:** ADR-005 (Persist-First Notification Pipeline), ADR-009 (SSE Liveness Monitoring)
**Correlation:** Mission-2 (Agentic Application Layer)

---

## 1. Context & Motivation

The OIS Agentic Network consists of three actors:

| Actor            | Runtime           | Persistence                    | Failure Mode                     |
| ---------------- | ----------------- | ------------------------------ | -------------------------------- |
| **Hub**          | Cloud Run         | GCS bucket                     | Redeploy, cold start, preemption |
| **Architect**    | Cloud Run         | GCS context store              | Redeploy, cold start, preemption |
| **Engineer Plugin** | Local (OpenCode/Bun) | Local filesystem          | OpenCode restart, process kill   |

**All three actors are transient.** Any actor can fail at any time. The worst case — all three restart simultaneously — must be handled gracefully with zero message loss and zero duplicate processing.

The current messaging system was built incrementally through debugging:
- SSE notifications with integer-based replay
- Client-side cursor persistence (file and GCS)
- Application-level dedup filters
- Processed event tracking

These mechanisms work but are fragile, undocumented, and rely on implicit assumptions. This specification replaces them with a formal, testable protocol.

---

## 2. Core Guarantees

### 2.1 Delivery Semantics: At-Least-Once + Idempotent Processing

**Exactly-once delivery over a network is impossible** (Two Generals Problem). AMP provides:

- **Hub guarantee:** "I will deliver this message at least once, and I will retain it in the Append-Only Log until garbage collected via ACK."
- **Client guarantee:** "I will use the message's ULID to ensure I only process it once, even if delivered multiple times."

### 2.2 Consistency Model: CP over AP

**Architectural Decision:** When GCS is unavailable, the Hub's messaging subsystem enters a `Failing` state and **rejects all state-mutating requests with `503 Service Unavailable`**.

**Rationale:** If the Hub accepts messages but cannot persist them to the Append-Only Log, a subsequent Hub crash causes permanent, silent message loss. An explicit 503 allows the caller to retry. Silent loss is unrecoverable.

**Consequences:**
- The Hub does NOT fall back to in-memory notification storage when GCS is unavailable
- Read-only operations (list_tasks, get_thread, etc.) MAY continue if cached state is available
- The Hub's `/health` endpoint reports `{"status":"degraded","gcs":"unavailable"}` in this state
- Clients receiving 503 MUST back off exponentially

### 2.3 Ordering Guarantee

Messages within the Append-Only Log are ordered by ULID, which is monotonically increasing within a single Hub instance and naturally ordered across Hub restarts (because time progresses). Clients receive messages in ULID order during both live streaming and replay.

---

## 3. The AMP Envelope

Every message in the Agentic Network is wrapped in a standard envelope:

```typescript
interface AmpEnvelope {
  /** Globally unique, lexicographically sortable identifier (ULID) */
  id: string;

  /** Event type (e.g., "task_issued", "report_submitted") */
  type: string;

  /** Links related events across the system (e.g., "mission-2") */
  correlationId: string | null;

  /** Who emitted this event */
  sourceRole: "hub" | "architect" | "engineer";

  /** Unix milliseconds — strictly decoded from the ULID via decodeTime(id) */
  timestamp: number;

  /** Target roles for delivery filtering */
  targetRoles: string[];

  /** Event-specific data */
  payload: Record<string, unknown>;
}
```

### 3.1 ULID Generation

**Mandate:** Use the `ulidx` library for ULID generation. No inline/custom implementations.

```typescript
import { ulid, decodeTime } from "ulidx";

function createEnvelope(type: string, payload: Record<string, unknown>, opts: {
  correlationId?: string;
  sourceRole: string;
  targetRoles?: string[];
}): AmpEnvelope {
  const id = ulid();
  return {
    id,
    type,
    correlationId: opts.correlationId ?? null,
    sourceRole: opts.sourceRole as AmpEnvelope["sourceRole"],
    timestamp: decodeTime(id),  // Strict parity — no separate Date.now()
    targetRoles: opts.targetRoles ?? [],
    payload,
  };
}
```

### 3.2 Event Types

| Event                    | Source    | Target     | Trigger                                  |
| ------------------------ | -------- | ---------- | ---------------------------------------- |
| `task_issued`       | hub      | engineer   | Architect creates a task                 |
| `directive_acknowledged` | hub      | architect  | Engineer picks up a task                 |
| `report_submitted`       | hub      | architect  | Engineer submits work report             |
| `review_completed`       | hub      | engineer   | Architect reviews a report               |
| `proposal_submitted`     | hub      | architect  | Engineer submits a proposal              |
| `proposal_decided`       | hub      | engineer   | Architect reviews a proposal             |
| `thread_message`         | hub      | both       | Thread reply posted                      |
| `thread_converged`       | hub      | both       | Both parties converged on a thread       |
| `clarification_requested`| hub      | architect  | Engineer asks for clarification          |
| `clarification_answered` | hub      | engineer   | Architect answers clarification          |
| `task_blocked`           | hub      | architect  | Task created with unmet dependencies     |
| `task_unblocked`         | hub      | engineer   | Dependencies met, task moved to pending  |
| `task_cancelled`         | hub      | both       | Task cancelled (includes cascade)        |
| `cascade_failure`        | hub      | architect  | Internal event cascade failed            |
| `idea_submitted`         | hub      | architect  | New idea logged                          |
| `mission_created`        | hub      | engineer   | New mission created                      |
| `mission_activated`      | hub      | engineer   | Mission moved to active status           |
| `system.protocol_upgrade`| hub      | both       | Hub upgraded to AMP v2 (migration event) |

---

## 4. Transport & Client State Machine

### 4.1 Transport Mode

| Mode         | Mechanism                                          | When Used                                  |
| ------------ | -------------------------------------------------- | ------------------------------------------ |
| **Streaming** | SSE (Server-Sent Events) via MCP transport         | Primary — real-time push delivery          |

There is no event replay. When a client reconnects, it performs a **state-based sync** — querying the Hub's current state via `get_pending_actions()` rather than replaying historical events. This eliminates the duplicate notification storms caused by event replay.

### 4.2 Client Connection State Machine

```
                    ┌──────────────┐
                    │ Disconnected │
                    └──────┬───────┘
                           │ connect()
                    ┌──────▼───────┐
                    │  Connecting  │ (MCP handshake + register_role)
                    └──────┬───────┘
                           │ handshake complete
                    ┌──────▼───────┐
                    │ Synchronizing│ (state sync in progress)
                    └──────┬───────┘
                           │ completeSync()
                    ┌──────▼───────┐
                    │  Streaming   │◄────── SSE recovered
                    └──────┬───────┘
                           │ SSE death detected
                    ┌──────▼───────┐
                    │ Reconnecting │
                    └──────┬───────┘
                           │
                           ▼ (back to Connecting)
```

### 4.3 Synchronizing Phase Protocol

When a connection is established (initial or reconnect):

1. **SDK transitions to `synchronizing`** and begins buffering all incoming SSE hub-events
2. **SDK emits `sync_required`** via `onStateChange` callback to the application
3. **Application performs state sync:**
   - Engineer Plugin: calls `get_directive` + `get_pending_actions` via Hub tools
   - Architect Agent: calls `get_pending_actions`, processes results via sandwich handlers, resets 300s event loop timer
4. **Application calls `completeSync()`** on the adapter/manager
5. **SDK transitions to `streaming`**, flushes all buffered events to handlers, resumes normal real-time delivery

**Key invariant:** Tool calls (`executeTool`) are permitted during `synchronizing` — this is how the application performs its state sync. Only SSE event delivery to handlers is paused (buffered).

### 4.4 Reconnect Backoff

When reconnection fails, the client uses exponential backoff:

```
delay = min(60s, 5s × 2^consecutiveFailures)
```

The `consecutiveSseFailures` counter resets when a keepalive is successfully received.

---

## 5. GCS Append-Only Audit Log (AOAL)

### 5.1 Write-First, Read-Never (for Operations)

All AMP messages are persisted to GCS **before** SSE delivery (Persist-First):

```
gs://<bucket>/notifications/v2/<ULID>.json
```

The GCS store is an **Append-Only Audit Log (AOAL)**. It serves two purposes:
1. **Compliance:** Every event is durably recorded for audit trail
2. **Debugging:** Historical events can be inspected for post-incident analysis

**The AOAL is never read for operational event delivery.** There is no `listSince()` replay, no cursor-based filtering, no ACK-based garbage collection. Clients discover missed work via `get_pending_actions()`, which queries the Hub's live state (tasks, proposals, threads) rather than replaying historical events.

### 5.2 Cleanup

The Hub runs a periodic cleanup that removes notifications older than `notificationMaxAge` (default: 24 hours). This is purely for storage management — it has no operational impact since the AOAL is never read for delivery.

---

## 7. Failure Mode Analysis

### 7.1 Hub Crashes During Message Persist

**Scenario:** Hub crashes after accepting a tool call but before writing to the AOL.
**Result:** The tool call's side effects (store mutation) may have completed, but no notification was emitted.
**Mitigation:** The Architect's `getPendingActions()` polling loop catches orphaned state changes (e.g., a completed task with no corresponding `report_submitted` notification).

### 7.2 Hub Crashes After Persist, Before SSE Delivery

**Scenario:** Hub writes to AOAL but crashes before SSE delivery.
**Result:** Message is durable in AOAL. On client reconnect, the `synchronizing` phase calls `get_pending_actions()` which queries live Hub state — any pending work is discovered and acted upon.
**Mitigation:** None needed — state-based sync handles this correctly.

### 7.3 Client Crashes After Receiving, Before Processing

**Scenario:** Client receives SSE event but crashes before acting on it.
**Result:** On restart, the client enters `synchronizing` and calls `get_pending_actions()`. If the event's side-effect is still pending (e.g., unreviewed task, unanswered clarification), it will be discovered and processed. If it was already handled, `get_pending_actions()` won't return it.
**Mitigation:** State-based sync is naturally idempotent — it queries current state, not event history.

### 7.4 All Three Actors Restart Simultaneously

**Scenario:** Hub, Architect, and Plugin all crash and restart.
**Result:**
1. Hub boots, connects to GCS, starts with empty in-memory state
2. Architect boots, connects, enters `synchronizing`, calls `get_pending_actions()`, processes pending items, calls `completeSync()`
3. Plugin boots, connects, enters `synchronizing`, calls `get_directive` + `get_pending_actions`, calls `completeSync()`
4. Both clients are now `streaming` with full awareness of current Hub state

**Mitigation:** None needed — the protocol handles this by design.

### 7.5 GCS Unavailable

**Scenario:** GCS bucket returns errors.
**Result:** Hub enters `Failing` state, returns 503 on all mutations.
**Mitigation:** Clients back off exponentially. When GCS recovers, Hub exits `Failing` state and resumes normal operation. No messages were lost because none were accepted during the outage.

### 7.6 Network Partition (Client ↔ Hub)

**Scenario:** SSE stream dies due to network issues.
**Result:** Client detects via SSE watchdog (no keepalive within threshold), transitions to `Reconnecting`. On reconnect, enters `Synchronizing` and performs state sync via `get_pending_actions()`.
**Mitigation:** State-based sync ensures all pending work is discovered on reconnect. Exponential backoff prevents reconnect storms.

---

## 8. Test Specification

### 8.1 Unit Tests (Pure, no network)

| ID    | Test                                                     | Validates                                    |
| ----- | -------------------------------------------------------- | -------------------------------------------- |
| AMP.1 | ULID generation is monotonically increasing              | Ordering guarantee                           |
| AMP.2 | Envelope timestamp equals decodeTime(id)                 | Timestamp parity                             |
| AMP.3 | isLegacyCursor detects integer vs ULID                   | Migration detection                          |
| AMP.4 | Polling backoff formula produces correct delays           | Jitter + exponential backoff                 |
| AMP.5 | Ring buffer evicts oldest when capacity exceeded          | In-memory cache bounds                       |

### 8.2 Integration Tests (TestHub, real MCP transport)

| ID     | Test                                                     | Validates                                    |
| ------ | -------------------------------------------------------- | -------------------------------------------- |
| AMP.10 | Connect transitions: disconnected → connecting → synchronizing → streaming | State machine correctness |
| AMP.11 | Events buffered during synchronizing are flushed on completeSync() | Sync buffer mechanism |
| AMP.12 | completeSync() ignored when not in synchronizing state   | Guard correctness                            |
| AMP.13 | Tool calls permitted during synchronizing state          | State sync enablement                        |
| AMP.14 | SSE death during synchronizing triggers reconnect        | Resilience during sync                       |
| AMP.15 | Reconnect enters synchronizing (not streaming)           | Correct reconnect flow                       |
| AMP.16 | Hub returns 503 when GCS is unavailable                  | CP guarantee                                 |
| AMP.17 | Client backs off on consecutive SSE failures             | Backoff behavior                             |
| AMP.18 | No Last-Event-ID header sent on reconnect                | Replay elimination verified                  |
| AMP.19 | All three actors restart — state sync discovers work     | Worst-case scenario                          |
| AMP.20 | Heartbeat works during synchronizing state               | Liveness monitoring                          |

### 8.3 Chaos Tests

| ID     | Test                                                     | Validates                                    |
| ------ | -------------------------------------------------------- | -------------------------------------------- |
| AMP.30 | Hub crash during persist — state sync discovers work     | Persist-first + state sync                   |
| AMP.31 | Client crash after receive, before process — state sync  | State-based recovery                         |
| AMP.32 | Rapid Hub redeploy — state sync on each reconnect        | Cross-restart resilience                     |
| AMP.33 | 50 rapid SSE drops — settles into 1 session, sync works  | Stability under chaos                        |
| AMP.34 | Concurrent reconnect from Architect + Plugin             | No interference between clients              |

---

## 9. Implementation Status

| Phase | Scope                                    | Status                                               |
| ----- | ---------------------------------------- | ---------------------------------------------------- |
| **1** | ULID Migration                           | Completed — ULIDs used for all notification IDs      |
| **2** | AMP Envelope                             | Completed — standard envelope, spec document         |
| **3** | State-Based Reconnect                    | **Completed (task-91)** — replaces event replay with state sync. `Synchronizing` state, `completeSync()`, event buffer. Legacy replay/cursor/dedup code removed. |
| **4** | AMP Envelope (deferred)                  | Future — full envelope schema wrapping               |

### Phase 3 Changes (task-91)

**Added:**
- `Synchronizing` connection state (SDK state machine)
- `completeSync()` method on `McpAgentClient` (opt-in via `manualSync: true`, used by the Architect shim)
- Event buffering during synchronization phase
- State sync on reconnect: Plugin calls `get_directive` + `get_pending_actions`, Architect calls `get_pending_actions` + resets timer
- GCS notification store operates as Append-Only Audit Log (AOAL) — write-only, never read for delivery

**Removed:**
- `Last-Event-ID` header injection (SDK) and parsing (Hub)
- `replayWithRoleWait()` and `pruneZombieSessions()` (Hub)
- `lastNotificationId` field and `getLastNotificationId()` method (SDK)
- `initialLastEventId` config option (SDK)
- Cursor persistence: `loadCursor()`, `saveCursor()`, `startCursorPersistence()`, `hub-cursor.json` (Plugin)
- Persistent state tracking: `hub-plugin-state.json` functions (Plugin)
- GCS-persisted dedup: `processedEventIds`, `loadProcessedEvents()`, `isEventProcessed()`, `markEventProcessed()`, `processed-events.json` (Architect)
- `replayDelay` config option (Hub)

---

## 10. Dependencies

| Dependency | Version | Purpose                           |
| ---------- | ------- | --------------------------------- |
| `ulidx`    | latest  | ULID generation and time decoding |

No new infrastructure dependencies (no Redis, Pub/Sub, etc.). The protocol runs entirely on the existing Hub + GCS stack.
