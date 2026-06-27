# idea-353 — Queue Wake/Stall Reconciliation (thin MVP) — design-of-record

**Status:** DESIGN-OF-RECORD · **Author:** lily (architect) · **Date:** 2026-06-27
**Idea:** idea-353 · **Folds:** bug-181 (correctness precondition) · **Related:** DR-S2-027, DR-S2-023, FR-22
**Role in C1 dogfood:** WI-1 (Design) of **dogfood-2** — coordinated end-to-end through the sovereign work-queue.

> Council-scoped THIN MVP (DR-S2-027): greg build-lens + Steve risk/integrity-lens both converged. The deliberate posture is **evidence-driven, not architecture-driven** — build only what dogfood-1 surfaced 2–3×; name (don't silently drop) what we defer.

---

## 1. Problem

The C1 work-queue is a **pull model with no wake-on-ready signal.** Confirmed in code (DR-S2-027): zero notification is emitted when a WorkItem becomes claimable; the dependency check runs only at `claim_work` time; the queue is not wired to the one agent-wake path that exists (`pending_action`/`thread_message` dispatch). Proven **3×** in dogfood-1 — every handoff (work-1→2, 2→3, 3→4) required a manual thread-nudge.

Two consequences this primitive must close:
- **Inbound (opportunity):** an idle eligible agent never learns that newly-claimable work appeared → it sits unclaimed until someone nudges. Widening the queue to be the default coordination substrate without this makes the architect the **hidden scheduler** — a direct hit on tele-6 (frictionless), tele-13 (org self-drives), tele-7 (a claimable item nobody is woken to **is** a silent stall).
- **Outbound (obligation):** a held item that stalls goes straight from "leased" to **silently reaped** by the lease-expiry sweeper. The escalation ladder (lease-TTL → sweeper → poison → thrash-quarantine) has no **gentle first rung** — no prompt to the holder before the hard reap.

**This is the prerequisite for meaningful C1 widening** (DR-S2-027), not a follow-on.

## 2. Scope (THIN MVP — council-decided)

**IN:**
1. Inbound idle-gated, level-triggered, **idempotent** claimable-digest.
2. Outbound held-work **approaching-lease-expiry** stall-prompt (renew/block/abandon before the silent reap).
3. **bug-181 fix in tandem** — the digest must count only *truly-claimable* work (correctness precondition; §3.4).
4. Explicit **no-storm** + **no-mid-task-interrupt** acceptance tests.

**DEFER (named, evidence-driven — not now):** adaptive/variable cadence; rich `Agent.status` taxonomy; top-N work-summaries (count only for MVP); multi-queue generalization; C2 supervisor semantics. The Agent.status telemetry seam is W3 (emit-only; D-3/C2 bind later) and **must not gate widening**.

## 3. Design

### 3.1 Carrier — the existing PollBackstop heartbeat tick (no new timer)
Both directions ride the existing adapter heartbeat (`onHeartbeatTick`, added for bug-180 L2). Each tick: resolve state → conditionally emit upward. No new adapter timer; no new lifecycle.

### 3.2 Inbound — claimable digest (level-triggered, idle-gated)
On the tick, resolve the caller's **claimable count** and surface a digest ("N items claimable for your role") **only** when:
- the agent is **idle** (no active task) — never mid-task; AND
- the count crossed an **upward edge** (0→N, or a *new* claimable item appeared) since the last surfaced digest — **not** every tick.

The **one genuinely-new substrate** is this **level-trigger / de-dup state**: persist the last-surfaced claimable set/count so a steady N>0, a re-tick, or a Hub restart does **not** re-emit. This is the **FR-22 storm-risk locus** — WI-2 must nail it (level-triggered = idempotent = storm-proof).

**Seam (D-1 R1 orthogonality):** the digest reads claimable-count via the **stable `list_ready_work` contract**, never internals → if D-1 R1 later rebinds reads to REST it is a no-touch swap.

### 3.3 Outbound — stall-prompt (the gentle first rung)
On the tick, for each item the agent **holds** whose lease is **approaching TTL** (≈50–75% of lease life) **without** a recent renew/progress signal: surface a prompt to **renew / block / abandon** *before* the sweeper's hard reap. Uses the existing `renew_lease` / `block_work` / `abandon_work` verbs — this is **notification-shaping, not new verbs**. It slots **below** the existing lease-TTL → sweeper → poison → thrash ladder (C1-R2) as its gentle first rung. Also idle-gated; never pesters a visibly-progressing holder.

### 3.4 bug-181 fix — true-claimable counts (correctness precondition)
The digest's value is "N **claimable** for your role"; if N includes deps-blocked or ineligible items the digest **lies** and the woken agent hits a claim-rejection — manufacturing the exact silent-friction the primitive exists to kill (tele-7). Fix: the claimable projection (`list_ready_work`) and the digest count MUST use **claim_work's full eligibility predicate** — deps-readiness **+** role-eligibility **+** WIP-cap — as the single source of truth. **Repro to pin:** an *eligible-role* item with deps-unmet showing `ready` (observed for the verifier on work-3; the "engineer saw only work-2" observation was role-filtering, not the deps-filter working).

## 4. Acceptance criteria (evidence-shaped — drive WI-3 verify)

- **AC1 (inbound proof):** newly-claimable, dependency-cleared work wakes an **idle eligible** agent **within one heartbeat, with no thread/manual nudge.** Evidence: integration test — complete a blocking dep → assert the eligible idle agent receives the digest wake.
- **AC2 (outbound proof):** a held item nearing lease-expiry prompts the holder to renew/block/abandon **before** the silent sweeper reap. Evidence: integration test across the TTL threshold.
- **AC3 (no-storm / idempotent):** level-triggered — a steady N>0, a re-tick, and a **Hub restart** do **not** replay/repeat wakes; only an upward edge (0→N or a new item) fires. Evidence: unit test on the de-dup state + a restart-replay test (FR-22 class).
- **AC4 (no-mid-task-interrupt):** the wake surfaces only when the agent is idle; an actively-tasked agent is never interrupted. Evidence: unit test on the idle-gate.
- **AC5 (true-claimable / bug-181):** the digest count equals `claim_work`'s eligibility predicate; a deps-blocked or ineligible item is **not** counted; the eligible-role-deps-unmet leak no longer reproduces. Evidence: the pinned bug-181 repro flips green.

## 5. Phasing (within dogfood-2)
- **W1 — inbound digest** (§3.2 + §3.4). The **widening-unblocker**; this alone clears the tele-6/13 friction blocking widening.
- **W2 — outbound stall-prompt** (§3.3). The gentle sweeper-rung.
- **W3 — Agent.status telemetry seam** — emit a minimal stall/idle signal; D-3 gauge + C2 supervisor bind later. **Additive; must not gate widening.**

## 6. Out of scope / follow-ons
- Adaptive cadence, rich Agent.status taxonomy, top-N summaries, multi-queue, C2 supervisor semantics (DEFER per §2; revisit only on fresh dogfood evidence).
- D-1 R1 (REST read-binding) stays orthogonal (dogfood-3/parallel); the §3.2 stable-contract seam keeps it no-touch.
- The opencode adapter already wakes correctly on its own loop; confirm it shares the claimable-count contract, no parity work expected.
