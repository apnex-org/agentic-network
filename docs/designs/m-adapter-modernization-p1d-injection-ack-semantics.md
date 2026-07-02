# P1d — Injection Consumption-ACK Semantics + the Two-ACKs Disambiguation

**Pilot node:** `work-bp-m_adapter_modernization_pilot_20260629-p1d_injection_ack` (engineer: greg).
**Provenance:** idea-398 → ratified Design v1.0 (`66a8f721`) §9 P1d — Director-direct.
**Status:** the Hub-leg exactly-once-across-drop machinery is **already built**; P1d **tests + disambiguates** it (no rebuild) and formalizes the per-harness consumption-ack capability-matrix cell. The ordered injection queue was **NOT built** — test (c) proved order is already held (cal #81).

---

## 1. The TWO ACKs (do not conflate — the over-promise risk)

| | **Hub-leg ack** (kernel ↔ Hub) | **Last-hop consumption-ack** (adapter → LLM) |
|---|---|---|
| Scope | UNIFORM (every harness) | PER-HARNESS (NOT uniform) |
| Guarantee | **exactly-once-by-construction** | claude = **at-least-once + dedup** (best-effort); opencode = **exactly-once** |
| Mechanism | Last-Event-ID replay + PollBackstop `list_messages(since)` catch-up + `SeenIdCache`/`createDedupFilter` dedup + `claim_message`/`ack_message` + bug-108 reconnect-drain | claude = one-way `notifications/claude/channel` (no native confirm) + the backstop chain; opencode = awaitable `session.promptAsync` |
| "survive blips by construction" | YES — this is the layer that delivers it | rides on the Hub-leg; the last hop only changes the FINAL native landing |

**The honesty bar:** "exactly-once" is a HUB-LEG property. It must **not** be claimed for claude's one-way last hop — claude is best-effort-render + the backstop chain (at-least-once-with-dedup at the channel; the LLM consuming it is not natively confirmable).

## 2. The 3-valued capability-matrix cell (feeds P1b's manifest)

```
capability: consumption-ack
  claude:   partial
    reason: one-way MCP notification (notifications/claude/channel) has NO native
            consumption confirm. Backstop chain = PollBackstop dedup-aware re-delivery
            (catch-up routes through the same MessageRouter -> seen-id dedup) +
            claim_message (fired on every delivered message, incl. polled) +
            ack_message (on consumer-action) + L3 lease-reclaim. => at-least-once +
            dedup at the channel; NOT exactly-once at the LLM.
  opencode: yes
    reason: awaitable session.promptAsync resolves on delivery => exactly-once at the
            last hop. (out of scope for the claude pilot; recorded for Phase-2 parity.)
```

This is the per-capability unevenness the scion-steelman 3-valued matrix (yes/partial/no + REASON) exists to capture; P1b lifts it into the harness manifest.

## 3. What the faithful tests prove (ev_injection_ack)

`packages/network-adapter/test/integration/injection-ack.test.ts` — run against `PolicyLoopbackHub` with the **real** PolicyRouter + **real** message policy (`create_message`/`list_messages`/`claim_message`/`ack_message`) over the **real** `MessageRepositorySubstrate`, via the **real** `PollBackstop` catch-up (cal #82 — not a mock).

- **(a) Hub-leg exactly-once-across-drop:** a note injected (by the architect, targeted at the engineer role) while the receiver missed it inline is caught up via the real `list_messages(since=cursor)` exactly once, claim/ack'd, and a re-poll (cursor advanced) does NOT re-deliver. ✅
- **(c) ordering-under-burst (the no-queue evidence, cal #81):** a 5-message burst is caught up **in order** (ULID ids == monotonic sort) → the Hub-leg already holds order → **no ordered injection queue built**. (Order-holders: SyncBuffer in-order buffering + Last-Event-ID replay + the bug-171 slot-gate + the ULID-ordered catch-up.) ✅
- **push+poll dedup (real `SeenIdCache`):** a message seen via BOTH the catch-up and the inline path is delivered exactly-once (markSeen → true then false). ✅

## 4. Gap-check (the claude best-effort ack path) — VERIFIED, no gap

The dispatcher wires the catch-up path identically to inline (`tool-manager/dispatcher.ts:619-622`):
```ts
onPolledMessage: (event) => {
  router.route({ kind: "notification.actionable", event }); // same MessageRouter -> seen-id dedup
  fireClaimMessage(event);                                   // claim_message on the polled message
}
```
plus `ackMessage()` (ack_message on consumer-action). So a catch-up-delivered message on the claude harness IS claim'd + deduped + ack-on-action — the backstop chain is wired end-to-end. **No code gap to close**; P1d is test + disambiguation + the capability cell.

## 5. Conclusions
- Hub-leg exactly-once-across-drop: **proven faithful**, already built.
- Ordered injection queue: **not needed** — order proven held (cal #81). Revival trigger: if a future burst test ever shows reordering.
- Last-hop consumption-ack: claude **partial** (best-effort + backstop), opencode **yes** — the honest 3-valued cell for P1b's manifest.
