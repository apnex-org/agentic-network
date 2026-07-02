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
- **Q1/Q2 steer received + folded.** Q1 SHARPENED by lily (load-bearing): the shim's exit-code is swallowed by the CLI (grandchild), so the kernel→supervisor signal must be DIRECT + out-of-band — a SENTINEL file PID-1 watches, distinct code 75 on the SIGNAL + the container-exit (NOT the shim's exit). Q2: integration-level confirmed.
- **23:11Z** — built the signal-contract `kernel/liveness-signal.ts` (`emitLivenessLostSignal` writes the wedged-restart sentinel {reason, exitCode:75, failures, pid}; `resolveSentinelPath` explicit>env>default `/run/adapter-wedged`; never throws-out). Unit test 3/3 green.
- **23:15Z** — integration chaos test `test/integration/liveness-chaos.test.ts` GREEN (2/2, real TestHub over HTTP, 13s):
  - **Arm A (lived incident, recoverable):** destroySession + keepalive flows → proactive probe surfaces it → L1 session_invalid→reconnect heals (fresh sessionId, streaming); watchdog did NOT self-exit. The exact wedge I hit, now auto-detected + auto-healed, ZERO manual intervention.
  - **Arm B (unrecoverable → self-exit → recovery):** persistent wire-fail → probe fails budget → onLivenessLost → sentinel written (code 75) → fresh McpAgentClient re-handshakes + re-registers (the L2-restarted container). Restart-mid-long-cognitive-node: self-exit is state-agnostic; in-flight durability rides L3 (Design §4 demotion), fully validated at P1e's container e2e.
- **23:18Z** — wired into the shim (`adapters/claude-plugin/src/shim.ts`) + exported from kernel `index.ts`. **DEFAULT-OFF** (opt-in `OIS_LIVENESS_WATCHDOG_ENABLED=1`) — fail-safe: a self-exit WITHOUT P1e's supervisor kills the adapter with NO restart (worse than the wedge). Enable once P1e lands.
- **23:20Z** — FULL suites green: network-adapter 255/255, claude-plugin 180/180 (no regressions). Build + shim typecheck clean.

## P1c outcome (COMPLETE)
- **ev_chaos_passed:** 3 suites / 11 tests green (watchdog 6, signal 3, chaos 2). Named edge + restart-mid-cognitive-node + incident-tied criterion, faithful against real TestHub.
- **Scope (per lily Q1/Q2):** P1c owns the watchdog + the kernel→supervisor SIGNAL-CONTRACT (sentinel + code-75 semantics) + the integration-chaos-proof with the supervisor STUBBED (sentinel-written = "supervisor saw the signal"). Default-off shim wiring present + ready.
- **⚠ P1c→P1e HANDOFF (carry forward — hold P1e's acceptance to these):**
  1. **Real docker-L2 e2e** MUST be in P1e's acceptance: kernel-signal (sentinel) → PID-1 supervisor consumes → container-exit(75) → docker restart-on-exit → fresh container re-handshake/re-claim. P1c proves EMITTED; P1e proves CONSUMED — the conformance-flagged seam must not go unproven.
  2. **Enable the watchdog** (`OIS_LIVENESS_WATCHDOG_ENABLED=1`) only once the supervisor is in place.
  3. **Dep-prune (bloat):** the §9 amendment @2e6cee2 (the seeded P1e node pins pre-amendment 66a8f72) requires pruning the runtime image to the @apnex kernel + claude-shim dep-closure.
