# Work-Trace — Adapter-Modernization Pilot P1c (L1.5 liveness watchdog + chaos-validate)

**Task:** `work-bp-m_adapter_modernization_pilot_20260629-p1c_liveness_chaos` (engineer: greg / `agent-0d2c690e`)
**Provenance pin:** **idea-398** → ratified **Design v1.0** (`66a8f721:docs/designs/m-adapter-modernization-design.md`) §4/§9 — Director-direct. NOT GATE-2.
**Branch:** `agent-greg/adapter-p1c-liveness-watchdog` (off `origin/main`).
**Sequencing:** lily redirected P1b→P1c (keystone first — closes the keepalives-dead residual I held open at P1a). Sequence: P1c → P1d → P1b → P1e.

## The node (Design §4/§9 P1c)
GOAL: the L1.5 liveness self-watchdog (app-level session-validity probe INDEPENDENT of transport keepalive → on fail, self-exit PID-1 so docker-L2 restarts) + chaos-validate it. ev_chaos_passed: the named keepalives-flowing-but-session-dead edge + restart-mid-long-cognitive-node; assert auto-recovery (probe-fail → PID-1 self-exit → L2 restart → re-handshake → re-claim) ZERO manual intervention; one criterion tied to the lived incident.

## Claim-time path-enumeration (sizing = L)
- **Exit seam EXISTS:** `onFatalHalt` (handshake.ts) → `makeStdioFatalHalt` → `process.exit`; McpAgentClient uses `handshake.onFatalHalt`. The watchdog wires onLivenessLost → onFatalHalt.
- **Transport liveness EXISTS** (mcp-transport.ts: heartbeat POST + SSE watchdog, 30s) but is GREEN-while-session-dead — the gap L1.5 closes. L1 reconnect only fires on a DETECTED drop; a server-side session death surfaces only as `session_invalid` on the next `call()`, which never fires when idle/mid-cognitive-node.
- **Chaos infra EXISTS:** `test/helpers/test-hub.ts` (real HubNetworking + memory substrate) exposes `destroySession(sessionId)` (kill session server-side), `sendKeepalive`/`startKeepalive` (keep SSE flowing), `injectToolError('Session not found')` (force session_invalid), `closeSseStream`. → the named edge is provable at INTEGRATION level, no docker.

## Log
- **23:01Z** — claimed + started P1c (off P1b release). Path-enumeration above.
- **23:05Z** — built the watchdog CORE: `packages/network-adapter/src/kernel/liveness-watchdog.ts` — proactive periodic session-validity probe (INDEPENDENT of transport keepalive), bounded consecutive-failure budget (sized > L1's self-heal window so it doesn't fight L1's forever-backoff), reset-on-success, fire-once `onLivenessLost`, non-overlapping ticks.
- **23:06Z** — unit test `test/unit/liveness-watchdog.test.ts` GREEN (6/6), incl. the non-vacuous budget-boundary (no fire at budget-1, fires at budget) + reset-on-recovery + reject-as-failure + no-double-fire.
- **surfaced to lily (Q1/Q2):** Q1 the EMBEDDED exit-propagation seam (shim process.exit kills the shim not PID-1 in EMBEDDED topology → seam splits P1c/P1e; rec: P1c owns watchdog + in-process self-exit w/ a distinct exit code, P1e owns the supervisor that turns it into a container exit). Q2 chaos-test level (rec: integration-level via TestHub is the honest+sufficient bar for P1c; real docker-L2 at P1e compose). HOLDING the integration-chaos-test shape + the onLivenessLost→exit wiring until her steer (don't build the wrong seam).
- **next** — on Q1/Q2 steer: wire onLivenessLost → onFatalHalt(+distinct code) + the session-validity probe into McpAgentClient/shim; build the integration chaos test (keepalive-flowing + destroySession → watchdog fires → fresh client re-handshakes/re-claims) + restart-mid-cognitive-node; complete_work ev_chaos_passed.
