# P1e-2 — LIVE docker-L2 restart e2e harness

**M-Adapter-Modernization Design §4/§9.** The runtime-bound complement to P1c (signal
**emitted**, in-process chaos test) and P1e-1's `supervisor-seam.test.ts` (signal **consumed**,
env-independent). P1e-2 proves the **whole loop runs in a real container against a real Hub,
zero-manual**:

```
compose-up (watchdog ENABLED, restart=on-failure)
  -> adapter handshakes + session live  (probe = get_task)
  -> INJECT the silent wedge  (evict the session from transports; SSE stays up)
  -> the REAL L1.5 session-probe 400s/rejects  (the detection path P1c built)
  -> watchdog budget exhausts -> LIVENESS LOST -> /run/adapter-wedged written
  -> PID-1 supervisor consumes the sentinel -> SIGTERM child -> exit 75
  -> docker restart-policy (on-failure) fires -> RestartCount increments
  -> a FRESH container re-handshakes  (recovery, not a loop)
```

= **carry-a** (real docker-L2 restart) + **carry-b** (the watchdog *drives* the restart).

## Why a standalone test-Hub (PATH 2-prime)

The wedge needs a REAL Hub session to kill server-side — but we will **not** add a destructive
session-evict capability to the prod Hub binary for a test (safety-before-leverage). So the e2e
runs the **standalone test-Hub**: `TestHub` (which wraps the **real** `HubNetworking` over memory
stores) bundled to a self-contained `.mjs` and run as its own container. The destructive
evict route lives in **TEST code**, never prod. Zero prod-Hub change.

### The wedge is the SILENT one — and that took two corrections

| Mechanism | Result | Verdict |
|-----------|--------|---------|
| `destroySession` | `cleanupSession` does `transport.close()` -> SSE drops -> adapter's **L1** transport-watchdog reconnects | ✗ tests L1, not L1.5 |
| tool-handler `throw` (injectToolError) | comes back as an MCP **isError result** -> `call()` RESOLVES -> probe returns `true` | ✗ never fires |
| **`evictAllTransports`** (clear the `transports` map only) | next POST 400s (`transports.has` false) -> probe **rejects**; SSE + `sendKeepalive` untouched | ✓ silent wedge, L1.5 fires |

Proven by `packages/network-adapter/test/integration/p1e2-wedge-inject.test.ts` (mutation-proof:
skip the `clear()` and `sessionCount.toBe(0)` goes RED).

## Files

| File | Role |
|------|------|
| `docker-compose.yml` | P1e-1 base — EMBEDDED topology, watchdog-on, `restart: on-failure`, host-worktree mount, `/run` tmpfs |
| `docker-compose.e2e.yml` | e2e **override** — joins external `p1e2-net`, points `OIS_HUB_URL` at the test-Hub, `OIS_LIVENESS_PROBE_METHOD=get_task`, fast-fire timing |
| `p1e2-e2e.sh` | orchestrator — `selfcheck` (in-repo) + `run` (live). Default inject = `POST $CONTROL_URL/wedge` |
| `build-p1e2-test-hub.sh` | esbuild the standalone test-Hub -> a self-contained `.mjs` (runs on plain node:22) |
| `packages/network-adapter/test/p1e2-standalone-hub.mts` | the standalone entrypoint (TestHub + control server: `POST /wedge`, `GET /health`) |
| `packages/network-adapter/test/helpers/wedge-inject.ts` | `sustainedWedge` — evict every 50ms for a TTL (race-free vs reconnect) |

## Run it (on the VM)

The VM has docker + git but NO node/npm/tsx and NO repo. So:

1. **Build + deliver the bundle** (off-VM, where node + repo exist):
   ```bash
   deploy/adapter-image/build-p1e2-test-hub.sh   # -> deploy/adapter-image/p1e2-test-hub.mjs
   ```
   Deliver it to the VM (e.g. `gsutil cp` to a bucket, then `gsutil cp` down on the VM).
2. **Network + test-Hub** (on the VM):
   ```bash
   docker network create p1e2-net
   docker run -d --name p1e2-test-hub --network p1e2-net -p 8090:8090 \
     -e BIND=0.0.0.0 -e MCP_PORT=8080 -e CONTROL_PORT=8090 \
     -v $PWD/p1e2-test-hub.mjs:/app/th.mjs node:22-alpine node /app/th.mjs
   curl -s localhost:8090/health   # {"ok":true,...}
   ```
   (MCP 8080 stays on the network for the adapter; control 8090 is published to the host.)
3. **Adapter config** — the shim reads `hubToken` + `hubUrl` from `$HOST_WORKTREE/.ois/adapter-config.json`
   (the §5 carry — see below). The test-Hub ignores the token (`apiToken=""`), so any non-empty
   value works:
   ```json
   { "hubToken": "test", "hubUrl": "http://p1e2-test-hub:8080/mcp" }
   ```
   `HOST_SECRETS_DIR` still needs `hub_token` + `claude_oauth_token` files (the base compose mounts
   them); dummy files are fine — they are unused this run.
4. **Run the e2e**:
   ```bash
   ADAPTER_TAG=p1e-prune-b057685-a OIS_AGENT_NAME=p1e2-probe \
   HOST_WORKTREE=<dir> HOST_SECRETS_DIR=<dir> CONTROL_URL=http://localhost:8090 \
     ./p1e2-e2e.sh run
   ```

### `selfcheck` (no VM)

```bash
./p1e2-e2e.sh selfcheck
```
Validates harness syntax, both compose files, and (with compose v2) that the merge keeps the seam
(watchdog enabled, `on-failure`, fast-fire). Off-VM it falls back to file-direct checks.

## §Injection (the silent wedge)

The default inject is `POST $CONTROL_URL/wedge` -> the standalone runs `sustainedWedge`: evict the
session from the real `transports` map every 50ms for `WEDGE_TTL_MS` (default 10s) WITHOUT closing
the SSE. So each get_task probe 400s/rejects -> the L1.5 budget exhausts -> sentinel -> exit 75 ->
restart; the TTL then lifts so the post-restart fresh container re-handshakes. The harness's
`M_PROBE_FAIL` assertion is the **fail-closed guard**: if the wedge never produced a probe failure,
the run dies — it can't false-green. (Naive inducers — container-kill / network-cut / SIGKILL — are
test-theater: they bypass the watchdog's reason-for-being and are not used.)

## Evidence captured (feeds `ev_containerised`)

`.p1e2-e2e-results/p1e2-e2e-<stamp>.txt`: the image ref, the contract read from the image, the
**RestartCount delta** (carry-a), and the **seam log lines** (`probe FAILED` / `LIVENESS LOST` /
sentinel-write / supervisor child-terminate / re-handshake) (carry-b).

## ⚠ Scope carries (explicit, not silently narrowed) — `pilot_accept` certifies (A) with these called out

- **(B) real-`claude-code`-CLI headless-auth run-gate** — the base compose runs the **shim** as the
  supervisor's child; the real-CLI headless boot (`CLAUDE_CODE_OAUTH_TOKEN` file-mounted, no TUI) is
  a separate slice. This harness validates **(A) shim-as-child resilience**. The architect probes
  (B)'s real cost on the VM (close-divergence): small -> close here; bigger -> explicit follow-on.
- **§5 file-mounted secret -> shim bridge** — `loadConfig` (adapter-config.ts:89/105) reads
  `.ois` + `OIS_HUB_TOKEN` env only, NOT `/run/secrets`. This run uses `.ois`-config token-delivery
  (step 3); it does NOT validate the `/run/secrets`->shim bridge. That bridge (loadConfig reads
  `OIS_HUB_TOKEN_FILE` / `/run/secrets`, file-over-env) is a named production-boot follow-on.
