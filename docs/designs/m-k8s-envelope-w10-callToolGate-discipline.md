# m-k8s-envelope-w10-callToolGate-discipline-design

**Mission:** mission-88 M-K8s-Envelope Wave W10 — substrate-hardening pre-W11-re-cutover
**Status:** v0.1 WORKING DRAFT
**Anchor:** bug-126 (Adapter shim callToolGate doesn't release on isError responses — wedges subsequent entity-tool calls; major)
**Author:** architect (lily) driving via PR-direct (thread-reply blocked per bug-126/127)
**Director-ratification:** (D) TOLERANT-bridge + W7-W10 + W11 clean re-cutover (ratified 2026-05-24)

---

## 1. Problem

During mission-88 W6 Phase B incident response (2026-05-24, ~08:47 UTC), architect attempted `get_mission(mission-88)` via the normal lily shim. The dispatcher logged:

```
[2026-05-24 08:47:21.497] [CallTool] get_mission entered
[2026-05-24 08:47:21.497] [CallTool] get_mission awaiting callToolGate
```

**No subsequent `[CallTool] get_mission gate passed (+Nms)` line ever appears.** The dispatcher appears to hang indefinitely. Subsequent entity-tool calls in the same session hang the same way.

Other tool calls in the same time window (transport_heartbeat every 30s, internal list_messages from poll-backstop) continue to succeed — so transport + Hub connectivity are healthy.

**Symptom-impact:** architect lost effective use of entity-tool surface (get_mission, get_thread, get_bug, list_*, create_thread_reply) for the duration of the incident. Compelled to bypass the shim via direct MCP curl — which then exposed the Hub-side bug-125 + bug-127.

## 2. Root cause analysis (multi-hypothesis; engineer-investigation needed)

`callToolGate` is the `sessionReady` Promise (per `apnex-claude-plugin/shim.js:518` → `dispatcher.js:313-315`):

```javascript
// dispatcher.js
if (opts.callToolGate) {
    log(`[CallTool] ${requestedTool} awaiting callToolGate`);
    await opts.callToolGate;
    log(`[CallTool] ${requestedTool} gate passed (+${Date.now() - callStartedAt}ms)`);
}
```

`sessionReady` is constructed once per shim startup (`shim.js:369-374`) and resolved/rejected via `resolveSessionReady`/`rejectSessionReady` during handshake (line 463 lazy-mode; line 454 eager-mode).

**Once resolved, the Promise stays resolved.** Subsequent `await` calls return immediately. So a healthy shim that has already served other tool calls should never hang at this gate.

### Hypotheses (in priority order for engineer investigation)

**(H1) `sessionReady` got rejected silently between successful calls**

Some flow path rejects `sessionReady` (e.g., session-invalid retry-once handler at `mcp-agent-client.js`). The dispatcher's `try { await callToolGate; ... } catch { ... }` should observe the rejection, but if the catch block isn't logging, the rejection appears as silent hang.

**Counter-evidence:** transport_heartbeat continues succeeding in same time window — heartbeats also go through dispatcher; would also be wedged if gate rejected. Unless heartbeat bypasses the gate path.

Actually — searching `TOOL_CALL_SIGNAL_SKIP` at `dispatcher.js:351` suggests there IS a skip-list for handshake/lifecycle tools. Heartbeat may be in that skip-list and bypass the gate. Verify.

**(H2) MCP host cancellation doesn't propagate through await chain**

Claude Code may cancel pending CallTool requests (user-deny dialog, host shutdown, etc.). The MCP SDK's request handler should observe cancellation but the `await opts.callToolGate` may not honor abort signals.

**Counter-evidence:** would require host-side cancellation event in the time window. Possible but not confirmed.

**(H3) Race-condition between sessionReady resolution + concurrent CallToolRequestSchema invocation**

If sessionReady was resolved but the dispatcher's request-handler captured a stale Promise reference (e.g., from a re-handshake epoch jump), the await stalls.

**Counter-evidence:** Promise references shouldn't change across invocations unless the dispatcher recreates them. Need to read `recreate`-paths in dispatcher init.

**(H4) Unhandled rejection in adjacent await-chain leaks gate-Promise observer**

`signal_working_started.catch(...)` (line 354) is a fire-and-forget that swallows errors. If a related await elsewhere rejected and wasn't caught, Node's unhandledRejection behavior could affect Promise state.

**Counter-evidence:** unhandledRejection doesn't reject pre-resolved Promises. Unlikely.

### Recommended investigation order

1. Add diagnostic logging at sessionReady resolve/reject points — capture the exact reject reason if any
2. Add diagnostic logging at all places that touch `sessionReady`/`callToolGate` references — confirm single instance throughout shim lifetime
3. Reproduce: open a fresh shim, exercise the user-deny path on a get_mission call, observe whether the gate hang reproduces
4. If repro succeeds: trace exact hang point in dispatcher

## 3. Architectural decision

### (α) Audit + harden dispatcher cancellation + error-path coverage (preferred)

Comprehensive audit of dispatcher's CallToolRequestSchema handler:
- Add abort signal observation throughout async/await chain
- Add error-path branches with structured log lines (post-condition: every dispatcher entry → exactly one of {gate-passed | gate-rejected | host-cancelled | abort})
- Add unit tests for each error/cancel path
- Add integration test for the W6 Phase B incident repro pattern

**Pros:** systemic fix — catches all hypotheses without forcing pin-down on the exact one. Repairs the broader test-coverage gap (the bug surfaced because no test exercised this path).

**Cons:** broader scope than minimal-required-fix; may surface additional latent issues during audit.

### (β) Narrow hot-fix at the identified hang point (after investigation pins it)

Once engineer investigation pins the root cause (H1/H2/H3/H4 or other), apply minimum-targeted fix.

**Pros:** minimum-risk; doesn't disturb working paths.

**Cons:** doesn't repair the broader test-coverage gap; same class of bug may recur in adjacent paths.

### Recommendation: (α)

Per memory `feedback_methodology_bypass_amplification_loop` — the cluster of W9 + W10 + W10-ext composes into "comms appears broken" architectural-pathology pattern. Repairing the test-coverage gap (α) is the strategic answer; (β) is short-term-only.

Specifically: (α) closes the meta-defect ("dispatcher cancellation + error-path not covered by tests") that allowed bug-126 to surface in the incident-response window. Without (α), the substrate is fragile to the same defect-class on the next substrate-incident.

## 4. Test coverage targets

### 4.1 Unit tests (dispatcher)

For each branch of CallToolRequestSchema handler:
- sessionReady resolved → tool call proceeds normally, gate-passed log emitted
- sessionReady rejected → handler returns isError response with reason, no hang
- sessionReady pending → host-cancellation propagates, handler returns aborted response
- agent.call() throws → caught, structured error response
- agent.call() returns isError → propagated to host correctly
- signal_working_started fire-and-forget rejection → swallowed silently, doesn't affect tool call
- TOOL_CALL_SIGNAL_SKIP coverage: each skip-listed tool name confirmed bypasses signaling

### 4.2 Integration test (full shim + Hub)

Spin up shim + mock Hub. Exercise:
- Normal tool call → success path
- Hub returns isError → shim returns isError to host (not hang)
- Hub becomes unreachable mid-call → shim returns error to host
- Host cancellation during await → shim cleans up, doesn't leak Promise observer

### 4.3 W6 Phase B incident repro

Spin up shim with real Hub. Architect-style user-deny on a get_mission call. Verify:
- Shim handler unwinds cleanly
- Subsequent calls proceed normally
- No `[CallTool] X awaiting callToolGate` line without matching `gate passed` or `gate rejected`

## 5. Composition

- **W7 (bug-123)** — orthogonal (Hub substrate index layer)
- **W8 (bug-124)** — orthogonal (Hub substrate kind layer)
- **W9 (bug-125)** — composes — W9 fixes "list crashes server-side"; W10 fixes "shim hangs on crash response". BOTH needed for end-to-end architect comms restoration.
- **W10-ext (bug-127)** — composes — W10-ext is Hub-side M18 OCC; orthogonal mechanism but joint-cause with W9 + W10 of "comms appears broken" architect experience.

The triple W9 + W10 + W10-ext is what I've called the "architect-comms-amplification-loop" instance of `feedback_methodology_bypass_amplification_loop`. Phase 10 calibration capstone material.

## 6. Repo scope (cross-repo coordination)

The fix lands in the **adapter package** repo (presumably `apnex-org/apnex-claude-plugin` or `@apnex/network-adapter` source), NOT in `apnex-org/agentic-network` (this repo). The Design lives in `agentic-network/docs/designs/` for mission-88 coordination cohesion; engineer implementation PR will land in the adapter-package repo.

**Engineer-side action:** open W10 implementation PR in the appropriate adapter repo; cross-link from `agentic-network` mission-88 narrative.

**Post-implementation:** rebuild adapter package; lily + greg shim restarts pick up new dispatcher; verify W6 Phase B incident repro no longer hangs.

## 7. Architect-asks (Design-pass round)

1. **Repo target confirmation** — is the dispatcher source in `apnex-claude-plugin` or `@apnex/network-adapter` (or both)? Engineer-side grep confirms target.

2. **(α) vs (β) preference** — recommend (α) systemic audit, but engineer judgment on whether (β) narrow-fix-then-defer-audit better fits W7-W10 timebox.

3. **Adapter rebuild + shim restart sequencing** — the fix requires adapter rebuild + lily/greg shim restart. Coordinate timing with W11 cutover (could compose: adapter rebuild lands → shims restart → then W11 cutover proceeds with fixed dispatcher).

4. **Diagnostic-logging extension confirmation** — even before pinning root cause, agree to add the post-condition logging (every CallTool entry → exactly one terminal log line) as a permanent observability improvement?

## 8. Acceptance criteria

- Multi-hypothesis investigation pins root cause + writes regression test for that specific path
- (α) systemic audit completes with unit tests for all cancellation/error branches
- W6 Phase B incident repro no longer hangs
- Architect smoke-test post-fix: user-deny on a get_mission call → handler unwinds cleanly; subsequent get_thread succeeds via shim

## 9. Out of scope (deferred)

- Adapter-level retry-with-backoff for Hub-isError responses — separate Idea (engineer-side affordance class)
- MCP-protocol-level abort handling redesign — out of scope; existing SDK behavior should be sufficient once dispatcher is hardened
- Distributed-tracing instrumentation — file as M-Adapter-Observability idea post-mission-88

## 10. Links

- **bug-126** (major; architect-comms-blocker; mission-88 W10 anchor)
- **mission-88** (active)
- Sibling waves: W7 #284, W8 #285, W9 #286, W10-ext pending
- File references: `apnex-claude-plugin/package/dist/shim.js:518`, `@apnex/network-adapter/dist/tool-manager/dispatcher.js:313-316`, `shim.js:369-374` (sessionReady construction)
- Composition: bug-125 (W9 Hub-side crash) + bug-127 (W10-ext M18 OCC) = "architect-comms-amplification-loop" Phase 10 calibration material
