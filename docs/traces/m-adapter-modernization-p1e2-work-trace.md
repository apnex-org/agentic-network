# Work-trace — M-Adapter-Modernization P1e-2 (`p1e_containerise`)

**Node:** `work-bp-m_adapter_modernization_pilot_20260629-p1e_containerise` (engineer-eligible).
**Evidence:** `ev_containerised` (test-run). **Branch:** `agent-greg/adapter-p1e2-e2e` off `origin/main` @023c231 (P1e-1 merged via #439).
**Provenance:** idea-398 → Design v1.0 (seeded node pins @66a8f721; build to the @36fd8a2 amendment). Stacked semantics: the final pilot node; `pilot_accept` (steve) depends on it.

## What P1e-2 is (vs the env-independent halves already merged)
P1c proved the wedged-restart signal is **emitted** (in-process chaos test). P1e-1's `supervisor-seam.test.ts` proved it is **consumed** (env-independent process test). **P1e-2 = the runtime-bound complement:** the WHOLE loop in a real container against a real Hub, zero-manual — carry-a (real docker-L2 restart) + carry-b (the watchdog *drives* the restart).

## Authoring model (architect-refined)
Authored **OFF-VM** (the harness is VM-portable by construction — every host/Hub specific is an env param); the architect runs it **ON the VM** (boot → run → capture → stop/delete) only for the run session, so no idle-VM cost. Gate-1 (#439 merge) verified independently (mergeCommit 023c231, supervisor.mjs + prune-node-modules.cjs on origin/main); gate-2 (runtime) architect-confirmed GO (VM proven + parked).

## Deliverables
- `deploy/adapter-image/docker-compose.e2e.yml` — e2e **override** (layered over the P1e-1 base). Fast-fires ONLY the timing: `OIS_LIVENESS_PROBE_INTERVAL_MS=2000` × `OIS_LIVENESS_FAILURE_BUDGET=2` (~4s wedge→sentinel) + supervisor `POLL_MS=250`/`GRACE_MS=1500` + a stable `container_name`. The CONDITION + the seam are unchanged; `OIS_LIVENESS_PROBE_METHOD` stays the real `get_agents` round-trip.
- `deploy/adapter-image/p1e2-e2e.sh` — the orchestrator. `selfcheck` (in-repo/CI-runnable, no live Hub) + `run` (the live e2e). Key properties:
  - **Drift-proof contract:** reads exit-code + sentinel from the BAKED image (`supervisor.mjs`'s exported `SUPERVISOR_EXIT_CODE`/`SUPERVISOR_SENTINEL_DEFAULT`, import-guarded) — never re-literals `75`/`/run/adapter-wedged` (the seam-test-parity analog).
  - **Fail-closed injection:** refuses to run without `INJECT_CMD` or `MANUAL_INJECT=1` — can never false-green by skipping the wedge.
  - **Faithful-detection assertion:** requires `session probe FAILED` in the logs BEFORE accepting the restart — a restart from any non-wedge cause fails the run.
  - **Non-vacuous recovery guard:** asserts RestartCount STRICTLY increments (restart fired) AND a fresh re-handshake AFTER the restart (recovery, not a crash-loop) — both, or RED.
  - Evidence capture: RestartCount delta + the seam log lines.
- `deploy/adapter-image/p1e2-e2e.README.md` — how the architect runs it on the VM, the injection candidates + faithfulness bar, the evidence model, and the scope fork (below).

## Faithfulness bar (architect-set, non-negotiable; cal #81 / cal #82)
The injection's CONDITION is fixed: **keepalives-flowing-but-session-dead** — session dead server-side, SSE keepalive still flowing — driving the watchdog's REAL app-level session-validity probe to fail (the detection path P1c built). FORBIDDEN (test-theater): container-kill / network-cut / SIGKILL-child — they bypass the watchdog's reason-for-being. **The one item to confirm together at the VM:** the exact server-side session-evict mechanism (test-Hub session-evict-keeping-transport-up = preferred; substrate session-row delete = candidate; kernel-probe fault-injection = last-resort, tests the restart-leg not the detection, call out explicitly). Kept pluggable as `INJECT_CMD` so the harness shape is stable regardless of which we land on.

## ⚠ Scope fork surfaced to the architect (pre-live-run)
The seeded `ev_containerised` text also names the real-`claude-code`-CLI headless-auth run-gate (`CLAUDE_CODE_OAUTH_TOKEN` file-mounted, no TUI). The base compose runs the **shim** as the supervisor's child, and the architect's runtime scoping has been the resilience loop. This harness delivers **(A) shim-as-child, resilience-focused**; flagged **(B) real-CLI child** for an explicit accept/defer decision on the run session, rather than silently narrowing the evidence.

## State
- selfcheck GREEN locally (YAML valid; seam preserved; fast-fire applied; watchdog not re-disabled). Deep `docker compose config` merge-check defers to the VM (this host = docker 20.10.3, no compose v2; VM = 29.6.1).
- **PENDING the live run (architect-on-VM):** ping "ready to run" → architect boots VM + runs `p1e2-e2e.sh run` (iterate the real-evict together) → captures evidence → on green I `complete_work` P1e-2 with `ev_containerised` → steve's `pilot_accept`.
