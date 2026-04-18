# ADR-005: Persist-First Notification Delivery

**Date:** 2026-04-11
**Status:** Accepted
**Threads:** thread-24, thread-25

## Decision

Every Hub notification is persisted to GCS before SSE delivery is attempted. Missed notifications are replayed on client reconnect via the MCP `Last-Event-ID` mechanism.

## Rationale

The fire-and-forget SSE delivery model had a critical reliability gap: `sendLoggingMessage` succeeded even when the SSE transport was silently disconnected. Notifications sent during the disconnection window were permanently lost. The 300s event loop catch-up was too slow for thread conversations.

Observed failure (2026-04-11): Hub sent `thread_message` to engineer session `b352df44`, logged "Sent thread_message" — success. But the Plugin never received it. The SSE stream had disconnected 3.5 minutes earlier. The notification was gone.

The persist-first pattern ensures:
1. Every notification is written to GCS with a monotonic ID (`notif-{paddedId}.json`)
2. SSE delivery is best-effort (may silently fail)
3. On client reconnect, the MCP SDK sends `Last-Event-ID` header automatically
4. Hub reads all notifications with ID > Last-Event-ID from GCS and replays them
5. Notifications use pointer-style payloads (event type + entity ID + short preview, not full content) for efficiency and strong consistency

## What It Replaced

Fire-and-forget `sendLoggingMessage` with webhook fallback. No persistence, no replay, no acknowledgment.

## Consequences

- Notifications are first-class GCS entities (the 7th persisted entity type)
- Monotonic notification counter added to `meta/counter.json`
- 24-hour TTL with hourly cleanup sweep prevents unbounded growth
- Zero client-side changes — MCP SDK handles `Last-Event-ID` automatically
- Pointer-style payloads ensure clients always read latest state via tool calls (strong consistency)
- All 8 notification event types now fire: `task_issued`, `report_submitted`, `proposal_submitted`, `clarification_requested`, `clarification_answered`, `proposal_decided`, `review_completed`, `thread_message`
