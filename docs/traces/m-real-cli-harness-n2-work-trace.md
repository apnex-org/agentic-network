# Work-trace — M-Real-CLI-Harness n2 (container-sandbox exposure)

**Node:** `work-bp-real_cli_harness_20260630-n2_sandbox_exposure` (engineer; arc idea-405). **Evidence:** `ev_sandbox` (doc). **Branch:** `agent-greg/real-cli-n2-sandbox` off main.
**Goal:** bound the unattended `--dangerously-skip-permissions` CLI by the container sandbox (the security boundary, per the Director decision) + determine the channels-flag necessity.

## The exposure model
`--dangerously-skip-permissions` makes the CLI run unbounded *inside the container*, so the SANDBOX is the boundary: the CLI can do anything the container can REACH, and n2 bounds what it can reach. n6 certifies the bound is real. The concrete surface is `deploy/adapter-image/docker-compose.sandbox.yml`:

- **Caps/privileges:** non-root (`user: 10001`, appuser), `cap_drop: [ALL]` (add none), `security_opt: no-new-privileges`, `read_only: true` root FS, `pids_limit`. **No docker socket** ever mounted; never `privileged`.
- **Mounts (the only writable surfaces):** `/work` (host worktree — the ONLY host write-surface, §9); `CLAUDE_CONFIG_DIR` (writable host DIR — see refresh-write below); `/run` + `/tmp` tmpfs(1777).
- **Network:** scoped to the test-Hub only (`real-cli-net` user-defined bridge, like the pilot's p1e2-net); no broad egress.
- **Creds:** file-mounted ONLY (nothing in env) — `hub_token` (read-only) + `.credentials.json` (read-WRITE, see below).

## Refresh-write under read-only-root (n3 carry — confirmed by design)
n3 found `.credentials.json` must be **read-WRITE** (the OAuth refresh-token rotates ~hourly; claude persists it → must survive the supervisor's restarts → resolves the pilot's auth-expiry 5th-concern). Under `read_only: true`, the cred path stays writable via the **`CLAUDE_CONFIG_DIR` host DIR mount** (not a single-file bind): claude refreshes via write-temp+ATOMIC-RENAME, which a single-file bind would break (cross-mount rename) — a writable **directory** mount lands the refresh in-place + persists it to the host. (Empirical confirm of an actual refresh under the tightened FS = n5's container run; n2 confirms the FS *design* supports it.)

## Channels-flag determination — DROP `--dangerously-load-development-channels` (resolved, not hand-waved)

> **⚠️ CORRECTED / REVERSED by the n4 render-receipt (2026-06-30) — DO NOT FOLLOW THE "DROP" CONCLUSION BELOW.**
> This determination was made from a `--debug-file` trace of a capability-LESS **stub** MCP server, which failed the FIRST gate (capability declaration) before ever exposing the SECOND gate. The n4 local render-receipt (the REAL shim, which DOES declare the capability) showed there is a **second gate**: the server must be in the session's **`--channels` list**, and a plain `.mcp.json` does NOT populate it — debug: `MCP server proxy: Channel notifications skipped: server proxy not in --channels list for this session`. **A plain `.mcp.json` does NOT render `<channel>`.** The `<channel>` render REQUIRES `--dangerously-load-development-channels` (the channels-list gate) — it is **required, not droppable**; the container therefore carries it as a second (sandbox-bounded) dangerous flag alongside `--dangerously-skip-permissions`. See `m-real-cli-harness-n4-work-trace.md` (Step 2) for the two-gate mechanism + the n5-launch determination. The "DROP" reasoning below is retained as the historical record of the n2-era (incomplete-evidence) conclusion.

The current attended launch (`start-greg.sh`) uses `claude --dangerously-load-development-channels plugin:agent-adapter@agentic-network` (no `--dangerously-skip-permissions`; it relies on the `settings.json` allowlist + interactive approval). The container is unattended → needs `--dangerously-skip-permissions` instead. Can the dev-channels/plugin flag drop?

**Resolved via a `--debug-file` trace + code:**
1. The `<channel>` render is **claude-code NATIVE**, gated on the MCP server declaring an `experimental.claude/channel` capability in its `initialize` handshake. Debug proof (a stub that omitted it): `Channel notifications skipped: server did not declare claude/channel capability`.
2. It is NOT gated on `--dangerously-load-development-channels` (the plugin-LOAD mechanism); the `agent-adapter` plugin ships **only the shim MCP server** (`.mcp.json` `proxy = node .../shim.js`) — no hooks/commands/render handler.
3. The real shim **declares** it: `agent-adapter.manifest.json` `injectionChannel: "claude/channel"` → `serverCapabilitiesFromManifest` → `{ tools, experimental: { "claude/channel": {} } }`.

**∴ DROP `--dangerously-load-development-channels plugin:agent-adapter`** → use a **plain project `.mcp.json`** registering the same shim (which declares the capability). The native, capability-gated render works regardless of the flag/plugin. **Net:** the container's only "dangerous" flag is `--dangerously-skip-permissions`, bounded by this spec — the dangerous-flag surface collapses to one, sandbox-bounded flag.

**Honest scope:** the mechanism is proven (capability-gated native render, verified in the debug trace + the shim's manifest); the **end-to-end faithful confirm** (the REAL shim via a plain `.mcp.json` + a real injected digest → claude surfaces `<channel>`) is **n4's injection-receipt** (`ev_engineer_ready`).

## Handoff
- **n4:** plain `.mcp.json` registering the real shim (declaring `claude/channel`); faithful injection-receipt confirms the native render end-to-end; the test-Hub claim.
- **n5:** the full hardened compose (`docker-compose.yml` + `docker-compose.sandbox.yml`) + the 3-level sentinel e2e; empirically confirm the cred-refresh-write under read-only-root.
- **n6:** certify the sandbox bound is real (the whole point of `--dangerously-skip-permissions` + bounded-exposure).
