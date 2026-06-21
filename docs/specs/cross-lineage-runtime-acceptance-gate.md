# Cross-Lineage Runtime Acceptance Gate (R3 contract)

**Status:** v0.1 DRAFT · **Author:** lily (architect) · **Date:** 2026-06-21
**Origin:** mission-92 dedup optimality audit §6 (the wrong-success-metric finding) + R3 (idea-333). The companion calibration (R5) is the *methodology*; this doc is the *mechanism* — the contract a harness proves.
**Relationship to construction:** this spec defines the CONTRACT (the invariants that must be proven). It does NOT prescribe the harness CONSTRUCTION — fan-out shape, fixtures, runtime-driver are the engineer's sovereign design (tele-3). The self-test (§5) measures construction quality so that sovereignty is safe.
**Tele anchor:** tele-8/tele-9 (gated recursive integrity + chaos/deployment-validated integrity) extended across a lineage boundary; tele-4 (zero-loss / no silent failure — a silent-degrade is a tele-4 breach); tele-2 (isomorphic spec — contract must equal lived reality); tele-6 (frictionless cross-lineage collaboration).

---

## 1. The gap this closes

A same-lineage unit suite being green is **not** a completeness signal for a deliverable a *cross-lineage* consumer runs. mission-92 proved this twice: "172/172 green" was the Claude suite; the OpenCode runtime was never exercised, so bug-161 (queue gate dead ~2 months) shipped, and the verifier cutover surfaced a cluster of behavioural/participation defects no same-lineage test could reach.

**The gate:** before a cross-lineage consumer cuts over — or before a bundle republish that touches the handshake / surfacing / participation paths ships — the relevant invariants below MUST be proven against the **real consumer runtime**. Same-lineage green alone does not satisfy the gate.

## 2. Scope (when the gate applies)

Any adapter/shim mission shipping a **distribution bundle a cross-lineage peer consumes** (today: the `@apnex/opencode-hub-plugin` bundle Steve runs on OpenCode/Bun). Triggered by: initial cross-lineage onboarding, a role cutover, OR a republish whose diff touches handshake/identity, the surfacing path, or role participation. A pure-internal refactor with no behavioural-contract change does not trigger it (but "behaviour-preserving" is a claim the gate exists to check).

## 3. The acceptance invariants (the contract)

Each invariant is anchored to a real defect it would have caught — the gate is not abstract.

### A — Handshake & identity fidelity
- **A1** `register_role` lands the *configured* role; the *persisted* role matches; the session binds as that role (not `unknown`). *(cutover role_mismatch; bug-163)*
- **A2** Every role-derived runtime path carries the SAME role — including the poll-backstop. *(bug-164: backstop started `role=engineer` for a verifier.)*
- **A3** A failed or mismatched registration **HALTS loudly** — never silently degrades to a default role / offline. The error must survive the transport's envelope handling. *(the cutover silent-degrade: bun-serve-proxy unwrapped `{content,isError}` to the body, dropping `isError`, so the fatal code was never seen.)*
- **A4** A *sanctioned* persisted-role change → re-register matches → online (the durable path, 1b — not hand-SQL).

### B — Surfacing fidelity
- **B1** An inbound **actionable** event actually RENDERS on the real runtime (inject and/or toast fires) — proven at the render call, not at "the dispatcher returned". *(no same-lineage test covers the shim's toast/inject layer.)*
- **B2** **Informational** events are log-only — they do NOT flood the interactive surface. *(Steve observed AGENT_STATE_CHANGED log bursts; post-Step-1 these must stay off the inject path.)*
- **B3** **Coalescing holds:** N actionable events arriving during an ACTIVE session are buffered and flushed as a coalesced surface on idle — not surfaced mid-stream one-per. The harness must DRIVE this deterministically; passive observation could not prove it. *(bug-161: the queue gate was inert → no coalescing.)*
- **B4** **No stuck queue:** a session that terminates without a clean idle (e.g. `session.error`, host disconnect) still flushes the buffer. *(R1: `session.error` unhandled + no session-state watchdog.)*

### C — Participation fidelity
- **C1** The peer's role can author its contracted finding-surface AND that output is **readable back** by the org. *(bug-165: verifier `create_audit_entry` writes invisible to `list_audit_entries` → write-only.)*
- **C2** Turn/participation gates honour the role: the role can reply / take turns where its contract permits. *(Rung-0: verifier `create_thread_reply` rejected — thread `currentTurn=engineer` vs verifier.)*
- **C3** The **DENY surface holds** (security): the role is cleanly denied every tool outside its contract (for a verifier: the whole produce/gating surface), failing CLOSED. *(bug-163 RBAC fail-open-on-unknown.)*
- **C4** Pulse ack / drain / claim work for the role where needed.

### D — Read fidelity
- **D1** The role's contracted READ surface works across every entity kind it is granted (for a verifier: broad read). Flag any kind that errors / 403s / returns falsely-empty.

## 4. Evidence tiers

- **Dispositive:** the relevant invariant reproduced against the **real consumer runtime** — the live cross-lineage host (v1) or a containerised equivalent of it (durable). For B/C invariants this means the actual OpenCode/Bun render + the live Hub policy path, not in-process mocks.
- **Necessary but NOT sufficient:** the same-lineage unit suite + the consumer's handler-logic-in-isolation suite. These gate regressions; they do not satisfy this gate. (Codifies the §6 lesson.)

## 5. Self-test (the gate must prove it can fail)

The harness MUST include a self-test: seed a KNOWN break for at least one invariant per group (e.g. force `sessionActive` permanently false for B3; deny an in-contract read for D1) and confirm the harness FLAGS it. A gate that never fails proves nothing. (Mirrors the CDACC holder self-test.)

## 6. Division of labour

- **Architect (lily):** owns this contract — the invariant set + evidence-tier standard + the gate rule. Maintains it as new cross-lineage classes appear.
- **Engineer (greg):** sovereign construction of the harness (runtime driver, fixtures, fan-out) that proves the invariants + the self-test. Wires it to the republish/cutover flow.
- **Verifier (Steve):** the **live cross-lineage leg** for v1 (runs the invariants on the real host, surfaces gaps), AND verifies the harness itself — does it actually catch the seeded breaks?

## 7. v1 vs durable

- **v1 (now):** Steve-as-live-leg + this contract run as a cutover/republish checklist. Every current invariant maps to a filed bug (161/163/164/165 + Rung-0 + R1), so v1 is "prove each of these against Steve's host before the next cutover".
- **Durable:** an automated runtime harness (OpenCode/Bun in CI) that proves A–D + self-test on every bundle republish — so the gate runs without a human in the loop. Likely its own mission (idea-333 → Design).

---

**One-line contract:** *a bundle a cross-lineage peer runs is not "done" when the same-lineage suite is green — it is done when its handshake, surfacing, participation, and read invariants are proven against the peer's real runtime, and the gate can demonstrate it would catch a seeded break.*
