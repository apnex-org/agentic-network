# P1e-2 — LIVE docker-L2 restart e2e harness

**M-Adapter-Modernization Design §4/§9.** The runtime-bound complement to P1c (which
proved the wedged-restart signal is **emitted** in-process) and P1e-1's
`supervisor-seam.test.ts` (which proved it is **consumed**, env-independent). P1e-2
proves the **whole loop runs in a real container against a real Hub, zero-manual**:

```
compose-up (watchdog ENABLED, file-mounted secrets, restart=on-failure)
  -> agent handshakes + session live
  -> INJECT the wedge SERVER-SIDE  (keepalives-flowing-but-session-dead)
  -> the REAL L1.5 session-probe fails  (the detection path P1c built)
  -> watchdog budget exhausted -> LIVENESS LOST -> /run/adapter-wedged written
  -> PID-1 supervisor consumes the sentinel -> SIGTERM child -> exit 75
  -> docker restart-policy (on-failure) fires -> RestartCount increments
  -> a FRESH container re-handshakes + re-claims  (recovery, not just a loop)
```

This is the **carry-a** (real docker-L2 restart) + **carry-b** (the watchdog *drives* the
restart) acceptance for the pilot.

## Files

| File | Role |
|------|------|
| `docker-compose.yml` | P1e-1 base — EMBEDDED topology, watchdog-on, file-mounted secrets, `restart: on-failure`, host-worktree mount, `/run` tmpfs |
| `docker-compose.e2e.yml` | e2e **override** — fast-fire watchdog/supervisor *timing only* (the condition + seam are unchanged) + a stable `container_name` |
| `p1e2-e2e.sh` | the orchestrator — `selfcheck` (in-repo, CI-runnable) + `run` (the live e2e) |

## Run it (on the VM)

```bash
OIS_HUB_URL=http://test-hub:8080/mcp \
ADAPTER_TAG=<the immutable :sha image-under-test> \
OIS_AGENT_NAME=p1e2-probe \
HOST_WORKTREE=/path/to/host-created/worktree \
HOST_SECRETS_DIR=/path/to/secrets-dir \   # holds hub_token + claude_oauth_token files
INJECT_CMD='<server-side session-evict against the TEST Hub>' \
  ./p1e2-e2e.sh run
```

The drift-proof bit: the harness reads the **exit-code + sentinel from the baked image**
(`supervisor.mjs`'s exported `SUPERVISOR_EXIT_CODE` / `SUPERVISOR_SENTINEL_DEFAULT`,
import-guarded so reading the export has no side effect) — it never re-literals `75` or
`/run/adapter-wedged`. If the kernel/supervisor contract ever changes, the harness picks
it up from the image under test, exactly like the seam-test parity assertion.

### `selfcheck` (no VM)

```bash
./p1e2-e2e.sh selfcheck
```

Validates: harness syntax, both compose files present, base+override **merge + parse**,
and that the merge did **not** weaken the seam (watchdog still ENABLED, restart still
`on-failure`, fast-fire tuning applied). Runnable in CI / off-VM.

## §Injection — the faithfulness crux (confirm together on the run session)

**The CONDITION is fixed + non-negotiable:** *keepalives-flowing-but-session-dead* — the
Hub session is dead **server-side** while the transport's SSE keepalive **still flows**
(the lived wedge; the watchdog's whole reason-for-being). The injection must drive the
watchdog's **real app-level session-validity probe** (`agent.call(get_agents, {})`) to
fail — the same detection path P1c built.

**FORBIDDEN (test-theater — the harness cannot use these):** container-kill, network-cut,
SIGKILL-the-child. They bypass the watchdog entirely (transport health looks *fine* in the
true wedge). The harness is **fail-closed**: with neither `INJECT_CMD` nor
`MANUAL_INJECT=1` it refuses to run, so it can never false-green by skipping the wedge.
And it asserts the *real probe failed* (`session probe FAILED` in the logs) before
accepting the restart — a restart from any other cause fails the run.

**Mechanism candidates (the one thing to nail at the VM, test-Hub ONLY, never prod):**
1. **Test-Hub session-evict affordance** — a test-only verb/endpoint that drops the
   agent's server-side session state while leaving the SSE stream up. *Truest wedge;
   preferred.* (Mirrors P1c's `TestHub.destroySession(sid)` + `sendKeepalive()`.)
2. **Substrate session-row delete** — if the test-Hub persists sessions, delete/expire the
   agent's session row directly (psql), transport untouched.
3. **Last resort only** (call out EXPLICITLY in the evidence if used): kernel-probe
   fault-injection. This tests the **restart leg, NOT the detection** — so we try the real
   evict first, together, and only fall back if the real evict proves intractable.

Pass the chosen mechanism as `INJECT_CMD='...'`, or use `MANUAL_INJECT=1` to pause for an
interactive evict (the harness prints the exact required condition, then waits for ENTER).

## Evidence captured (feeds `ev_containerised`)

Written to `.p1e2-e2e-results/p1e2-e2e-<stamp>.txt`: the image ref, the contract read from
the image, the **RestartCount delta** (carry-a), the injection used, and the **seam log
lines** (`probe FAILED` / `LIVENESS LOST` / `sentinel written` / supervisor child-terminate
/ re-handshake) (carry-b).

## ⚠ Scope fork to confirm with the architect before the live run

The seeded `ev_containerised` text also names the **headless-auth run-gate for the real
`claude-code` CLI** (`CLAUDE_CODE_OAUTH_TOKEN` file-mounted, no keychain/TUI prompt). The
base compose runs the **shim directly** as the supervisor's child (P1e-1), and the
architect's runtime scoping of P1e-2 has consistently been the **resilience loop** above.
Two readings:

- **(A) shim-as-child, resilience-focused** (what this harness validates): proves the
  EMBEDDED supervisor topology + L2 restart + re-claim + file-mounted **Hub** token, no
  TUI. The real-CLI headless-auth run-gate becomes a separate follow-on slice.
- **(B) real-`claude-code`-CLI child**: additionally swaps `command` to launch the real
  CLI headless with the file-mounted `CLAUDE_CODE_OAUTH_TOKEN` — a bigger lift (the CLI
  binary must be in the image; the OAuth file-mount run-gate proven).

This harness delivers (A) — the substance the architect and engineer scoped together — and
flags (B) for an explicit accept/defer decision on the run session, rather than silently
narrowing the evidence.
