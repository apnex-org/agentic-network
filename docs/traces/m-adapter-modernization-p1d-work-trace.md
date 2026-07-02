# Work-Trace — Adapter-Modernization Pilot P1d (injection consumption-ACK + the two-acks)

**Task:** `work-bp-m_adapter_modernization_pilot_20260629-p1d_injection_ack` (engineer: greg / `agent-0d2c690e`)
**Provenance pin:** **idea-398** → ratified **Design v1.0** (`66a8f721`) §9 — Director-direct. NOT GATE-2.
**Branch:** `agent-greg/adapter-p1d-injection-ack` (off `origin/main`).
**Sequencing:** P1c → **P1d** → P1b → P1e.

## Scope (lily-confirmed, claim-time-sized M)
The "riskiest net-new" label overstated it: the Hub-leg exactly-once-across-drop machinery is **already built** (SeenIdCache + PollBackstop+since-cursor + createDedupFilter + bug-108 reconnect-drain + claim_message/ack_message). So P1d = a **FAITHFUL TEST** of the Hub-leg + the **two-acks disambiguation doc** + the per-harness consumption-ack **capability-matrix cell** — NOT a rebuild. The ordered injection queue is built ONLY IF test (c) shows reorder (test-first, cal #81).

## Findings
- **(a) Hub-leg exactly-once-across-drop — PROVEN faithful.** Real PolicyRouter + real message policy + real MessageRepositorySubstrate + real PollBackstop catch-up (cal #82). Inject (architect→engineer-role) → catch-up delivers once → claim/ack → re-poll (cursor advanced) no re-deliver.
- **(c) ordering-under-burst — order HELD → NO queue built (cal #81 proven, not assumed).** 5-burst caught up in ULID-monotonic order. Order-holders: SyncBuffer + Last-Event-ID + bug-171 slot-gate + ULID-ordered catch-up.
- **dedup — real SeenIdCache:** a message seen via inline + catch-up = exactly-once.
- **Gap-check (claude best-effort ack) — VERIFIED, NO gap.** dispatcher.ts:619-622 `onPolledMessage` routes the catch-up message through the same MessageRouter (seen-id dedup) + fires `claim_message`; `ackMessage` fires `ack_message` on consumer-action. The backstop chain is wired end-to-end.
- **Two-acks held honest:** Hub-leg = uniform exactly-once; claude last-hop = at-least-once-with-dedup-and-backstop (NOT exactly-once-at-the-LLM); opencode = awaitable exactly-once. 3-valued cell (claude=partial / opencode=yes) → feeds P1b's manifest.

## Harness note
`PolicyLoopbackHub` routes EVERY tool through the real PolicyRouter over the real substrate, but its policy list omitted `registerMessagePolicy` (TestHub's createMcpServer only exposes register_role + 4 stubs, so it can't surface message tools). Added `registerMessagePolicy(router)` to PolicyLoopbackHub.createRouter() (additive; the message store was already wired) — the faithful path that actually exercises real list_messages/claim/ack.

## Log
- **23:24Z** — claimed + started; path-enumeration (Hub-leg largely built). Surfaced sizing/plan; lily confirmed scope across several refinements (two-acks-honest, integration-real-list_messages cal #82, test-first-decides-queue cal #81, no-exactly-once-for-claude).
- **23:35–23:42Z** — built the faithful test (PolicyLoopbackHub + message policy); 3/3 green; full network-adapter suite 247/247 no regression. Authored the two-acks semantics doc (`docs/designs/m-adapter-modernization-p1d-injection-ack-semantics.md`).
- **next** — PR + complete_work ev_injection_ack; surface the (c) ordering-held / no-queue result + the capability cell in the PR.

## Deliverables
- `docs/designs/m-adapter-modernization-p1d-injection-ack-semantics.md` (two-acks + 3-valued capability cell).
- `packages/network-adapter/test/integration/injection-ack.test.ts` (a/c/dedup, faithful).
- `packages/network-adapter/test/helpers/policy-loopback.ts` (+registerMessagePolicy).
