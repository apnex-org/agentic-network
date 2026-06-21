# R3 Cross-Lineage Runtime Harness — Construction scope (v0.1)

**Status:** v0.1 DRAFT (scope) · **Author:** greg (engineer) · **Date:** 2026-06-21
**Contract:** `docs/specs/cross-lineage-runtime-acceptance-gate.md` (R3 v0.2, #345 — RATIFIED invariants A–H). That doc owns the CONTRACT (what must be proven); this doc owns the CONSTRUCTION (how the harness proves it) — engineer-sovereign per #345 §6, §3.
**Origin:** mission-92 audit §6 (wrong-success-metric) + the verifier-cutover bug cluster (161/164/165/168/170 + Rung-0). idea-333 is the durable follow-on.

---

## 1. The gap (precisely, against what exists)

The opencode-plugin already has a strong suite — `test/shim.e2e.test.ts` + `test/mocks/MockOpenCodeClient.ts`: the REAL dispatcher + REAL Hub (PolicyRouter + 13 policies + ADR-017 stores) over InMemoryTransport/LoopbackTransport. But by its own header it runs **"no Bun, no OpenCode runtime"** with a **mock MCP client standing in for OpenCode**. So it proves *handler-logic + Hub-policy* fidelity — it canNOT prove that an inbound actionable event RENDERS on the real OpenCode/Bun runtime, nor catch egress shape-skew against the real SDK client (the mock accepts any shape). That is exactly the blind spot bug-161 (queue-gate dead ~2mo, never render-tested) and the cutover cluster fell into. Per #345 §4, this existing suite is **necessary-but-NOT-sufficient**; it gates regressions, it does not satisfy the gate.

**R3 = prove A–H against a REAL non-Claude runtime** (v1: Steve's live OpenCode/Bun host as the cross-lineage leg; durable: OpenCode/Bun-in-CI).

## 2. Architecture — two legs, one verdict

Each invariant's evidence comes from whichever leg can see it; an invariant is **dispositive** only when its real-runtime-observable part is confirmed on a real host.

- **Leg A — Hub-side substrate observer (I build + run; fully automatable NOW).** A read-only checker (direct substrate psql per `reference_substrate_forensics`, + Hub-API reads) that asserts the *Hub-side half* of each invariant against ground truth: did register_role BIND the role (A1)? did the directed dispatch resolve + enqueue (B/C)? is the verifier's audit/idea/message attributed + readable-back (C1/E1)? does discovery surface the directed thread (F1)? is the deny-surface closed (C3)? This needs no restart and runs against the live Hub today.
- **Leg B — real-runtime render leg (Steve, v1; CI, durable).** The part only a real OpenCode/Bun host can show: did the actionable inbound actually inject/toast/render (B1/B2/B3/B4)? did the handshake HALT-loud vs degrade (A3)? did the egress call shapes (showToast `{body}`, promptAsync) actually succeed against the real SDK (the R2 shape-skew class)? v1 = Steve runs a structured checklist on his host + reports; durable = automated.

**Verdict rule:** a cutover/republish is gated GREEN only when every in-scope invariant has BOTH its Leg-A (substrate) AND, where applicable, its Leg-B (real-render) evidence confirmed. Leg-A alone (or the existing loopback suite) is necessary-not-sufficient.

## 3. Invariant → check → leg → fixture (the build matrix)

| Inv (#345) | Concrete check | Leg | Regression fixture |
|---|---|---|---|
| A1 register binds role | substrate: persisted role == configured; session getRole == role (not unknown) | A | cutover role_mismatch |
| A2 role threads to backstop | shim log/telemetry: poll-backstop role == registered role | B | bug-164 |
| A3 failed register HALTS loud | seed a rejected register → shim halts, does NOT degrade to engineer/offline | B | the bun-serve envelope-unwrap silent-degrade |
| A4 sanctioned role-change → online | change_agent_role (1b) → re-register matches → online | A+B | cutover hand-SQL |
| B1 actionable RENDERS | directed inbound → inject/toast fires on the real host | B | (no same-lineage test) |
| B2 informational log-only | agent_state_changed burst → NO inject | B | the presence flood |
| B3 coalescing holds | N actionable during active session → buffered, flushed-on-idle (deterministic drive) | B | bug-161 |
| B4 no stuck queue | session.error/deleted/hang → buffer still flushes (FLUSH_CAP) | A+B | bug-161 / R1 |
| C1 finding-surface readable-back | verifier create_audit_entry → list_audit_entries returns it | A | bug-165 |
| C2 turn/participation | verifier replies to a directed thread (turn-role) | A | Rung-0/bug-166 |
| C3 deny-surface closed | verifier denied the whole produce/gating set, fail-CLOSED | A | bug-163 |
| C4 pulse ack/drain | verifier ack/drain works | A | — |
| D1 broad read works | each granted get_*/list_* returns (no 403/false-empty) | A | bug-167 |
| E1 attribution-on-write | createdBy/authorRole == caller role (not coerced) | A | bug-168/169 |
| F1 directed discovery | list_threads by recipientAgentId surfaces the directed thread | A | bug-170 |
| G1 read backpressure | broad read applies bounded per-call limits; transport survives | A+B | bug-171 |
| H1 write-scope determinism | every mutation surface deterministically allowed/denied for the role | A | bug-172 |

## 4. Regression fixtures (the "can never silently regress" set, #345 harness-req)

Each cutover-surfaced bug becomes a FIXTURE the harness re-runs: bug-161 (queue-gate/coalescing — B3/B4), bug-168 (provenance — E1), bug-170 (discovery — F1) at minimum (Steve's explicit ask). Leg-A fixtures are automatable now (substrate assertions); Leg-B fixtures (render) ride Steve v1 → CI durable. A fixture's presence means a *verified close* is re-checked on every gate run.

## 5. Self-test (#345 §5 — the gate must prove it can fail)

Per invariant GROUP, seed a KNOWN break and assert the harness FLAGS it:
- A: force persisted role != configured → A1 must fail.
- B: force `sessionActive` permanently true → B3 must fail (no flush).
- C: revoke verifier's create_audit_entry tag → C1 must fail.
- D: deny an in-contract read → D1 must fail.
A gate that never fails proves nothing (mirrors the CDACC holder self-test). The self-test runs Leg-A automatable seeds at minimum; Leg-B self-tests are part of the durable harness.

## 6. Gate wiring

R3 runs as a CHECKLIST/gate BEFORE: (a) a cross-lineage onboarding, (b) a role cutover, (c) a republish whose diff touches handshake/identity, the surfacing path, or role participation (per #345 §2). v1: I run Leg-A + Steve runs Leg-B from this doc's matrix; GREEN = both confirmed. The gate result is recorded (audit entry / a gate-run doc) so a close is traceable.

## 7. v1 build plan (engineer)

1. **Leg-A observer** — a runnable script/test module (`scripts/r3/leg-a-substrate-observer.*` or a vitest suite parameterised by agentId) that asserts the Leg-A column of §3 against the live Hub (substrate reads + Hub-API). Includes the §5 Leg-A self-test seeds. Automatable now; no restart, no 1.3.x toolchain.
2. **Leg-B checklist** — a structured, copy-runnable checklist doc (the §3 Leg-B rows) Steve executes on his host + reports; results folded into the gate record.
3. **Fixtures** — encode bug-161/168/170 as named §4 fixtures in Leg-A (substrate) + the Leg-B checklist.
4. **Durable hand-off** — the OpenCode/Bun-in-CI automation (Leg-B automated) is idea-333 → its own Design; this scope sketches it but does not build it.

**Open for architect (lily) confirm:** (i) Leg-A as a vitest-against-live-Hub vs a standalone script — engineer lean: standalone script (no test-runner coupling to prod reads); (ii) where the gate-run record lives (audit entry vs a docs/gate-runs/ artifact); (iii) whether v1 Leg-A should run against prod substrate (read-only) or a testcontainer Hub seeded to mirror — lean: both (testcontainer for the self-test/fixtures determinism, prod-read for the live cutover gate).
