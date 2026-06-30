# Adapter Container — Operator Runbook (M-Adapter-Modernization P1e)

**Scope:** the claude-harness adapter container (Design §2 EMBEDDED + §5 creds + §6 runtime/update + §9 worktree). Authored in P1e-1 (work-103). The live stand-up + the docker-L2 restart e2e are P1e-2.
**Image:** the dep-pruned, reproducible P1a image (`deploy/adapter-image/Dockerfile`) with the PID-1 supervisor (`supervisor.mjs`) as entrypoint. **Always deploy the immutable `:<sha>`, never `:latest`.**

---

## §5 — Credentials (file-mounted, never baked; the cred-free image)

Two secrets, both **mounted as files** (NOT env — env leaks via `/proc`, scion avoid[10]):
- `hub_token` → consumed as `OIS_HUB_TOKEN` (read from the mounted file, not env).
- `claude_oauth_token` → `CLAUDE_CODE_OAUTH_TOKEN`.

**Construct-once-on-host (NEVER baked into the image):**
```bash
# One-time, on the host (NOT in the container):
claude setup-token              # interactive once -> a ~1-year CLAUDE_CODE_OAUTH_TOKEN
mkdir -p "$HOST_SECRETS_DIR" && chmod 700 "$HOST_SECRETS_DIR"
printf '%s' "<token>"      > "$HOST_SECRETS_DIR/claude_oauth_token" && chmod 600 "$HOST_SECRETS_DIR/claude_oauth_token"
printf '%s' "<hub-token>"  > "$HOST_SECRETS_DIR/hub_token"          && chmod 600 "$HOST_SECRETS_DIR/hub_token"
```

### Auth-expiry monitor + rotation (the 5th resilience concern — NOT covered by §4 L1/L1.5/L2/L3)
**⚠ The 1-year OAuth token does NOT self-refresh** (the earlier "harness self-refreshes" line was WRONG — that describes the `.credentials.json` OAuth path we did NOT take). A synchronized expiry keeps transport UP (so L1/L1.5 never fire), then re-handshake on the expired token **crash-loops** — it does NOT self-heal. So:
- **Monitor:** alert ahead of expiry (the token is long-lived but bounded). Track the mint date; alert at T-30d / T-7d.
- **Rotation (manual, pilot default):**
  1. `claude setup-token` on the host → a fresh token.
  2. Overwrite `$HOST_SECRETS_DIR/claude_oauth_token` (mode 600).
  3. Rolling restart: `docker compose -f deploy/adapter-image/docker-compose.yml up -d` (re-reads the secret).
- **Multi-host path (dissolves the annual cliff):** `apiKeyHelper` (broker) — deferred to Phase-2.

## §6 — Runtime + safe-update contract

- **L2 = docker restart-policy** (`restart: on-failure`): the wedged-restart **exit 75** (the supervisor consuming P1c's sentinel) RESTARTS; a clean **exit 0** (SIGTERM stop) does NOT loop.
- **Quiesce/drain:** `docker stop` / SIGTERM → the supervisor SIGTERMs the child with a bounded grace (`stop_grace_period: 15s`) → the child finishes its turn / checkpoints → clean exit 0.
- **Staggered/rolling restart:** do NOT restart all same-harness agents on one `:latest` digest at once. Update one at a time: `docker compose pull && docker compose up -d <one service>`; confirm healthy before the next.
- **Boot-smoke health-gate:** before adoption, a fresh container must pass a real liveness probe (a Hub session round-trip), not just "process up". (P1e-2 wires the real probe.)
- **Rollback = re-point to the prior immutable `:sha`** (`ADAPTER_TAG=<prior-sha>` then `up -d`). Watch `:latest` as the TRIGGER; record/deploy the `:sha` as the reference-of-record.
- **Manual-first** is the pilot default — no watchtower auto-pull dependency yet.

## §9 — Host-side worktree (FORBID in-container creation)

The agent's git worktree is **created on the HOST** and **bind-mounted in** (`HOST_WORKTREE` → `/work`). **Do NOT create the worktree inside the container** — the `git worktree --relative-paths` path-identity hazard (a worktree created with one path identity breaks when the mount path differs); isolation-by-absence (scion avoid[9]). The container only consumes a host-prepared worktree.

```bash
# On the host:
git worktree add "$HOST_WORKTREE" <branch>   # host-side creation
# then: HOST_WORKTREE=... HOST_SECRETS_DIR=... OIS_HUB_URL=... OIS_AGENT_NAME=... ADAPTER_TAG=<sha> \
#       docker compose -f deploy/adapter-image/docker-compose.yml up -d
```

---
*P1e-1 authoring. Live stand-up + the real docker-L2 restart e2e (carry-a) are validated in P1e-2 on the architect-provisioned runtime surface.*
