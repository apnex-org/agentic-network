# Work-trace — M-Real-CLI-Harness n1 (headless-boot spike)

**Node:** `work-bp-real_cli_harness_20260630-n1_headless_boot_spike` (engineer; arc idea-405, runId `real_cli_harness_20260630`).
**Evidence:** `ev_boot_mode` (test-run). **Branch:** `agent-greg/real-cli-n1-boot-spike` off `origin/main` @7911399 (inherits the merged adapter-pilot artifacts: `deploy/adapter-image/*`, supervisor.mjs, compose, L1.5 watchdog, sentinel contract).
**Goal:** DECIDE the long-lived headless launch mode for the REAL `claude` CLI as an unattended engineer + capture the headless-boot recipe. (The faithful headless injection-receipt + Hub-connect is n4; n1 decides the mode + recipe.)

## Method — isolated local-spike (architect-sanctioned, hard isolation)
Spiked the real `claude` 2.1.196 (`/home/apnex/.local/bin/claude`) on this host under a SAFETY CONTRACT: a separate tmux socket (`-L n1spike`) + separate `HOME` + separate `CLAUDE_CONFIG_DIR` + an empty scratch project dir, with **NO creds and NO Hub**. Verified post-spike: no lingering tmux server, host `~/.claude` untouched, prod Hub never contacted. (Isolation IS the contract for spiking a second claude on the host.)

## Decision: boot mode = A (interactive `claude` under tmux/PTY)
- **A = interactive `claude` under a PTY (tmux).** MCP server-notifications (the shim's `notifications/claude/channel`) surface as `<channel>` turns in the interactive session, driving the idea-353 self-wake loop. **Mechanism PROVEN:** this very engineer session runs on exactly that (the architect↔engineer `<channel>` notes ARE the shim's channel injection into an interactive claude). tmux is the PTY host (node-pty is absent on host; matches Design §2 "start tmux").
- **B = `claude -p --input-format stream-json --output-format stream-json` — REFUTED.** Empirically (`claude --help`, 2.1.196): `--input-format`/`--output-format` work ONLY with `-p`/`--print`, and `--print` is request-driven (a stdin message produces a turn). An UNSOLICITED MCP server-notification spontaneously creating a turn is out of that protocol model → B cannot host the ongoing notification-injection self-wake loop.
- **`claude -p` one-shot + the Agent SDK — REJECTED** (per runbook): `-p <prompt>` exits (one-shot, no ongoing injection); the SDK is a different harness, not the real CLI.

## Headless boot: WORKS (transcript)
`claude --dangerously-skip-permissions` launched under tmux in the isolated env rendered its TUI no-human. The first-run flow (no creds) is, in order:
1. **THEME-select** (1–7; default "Dark mode")
2. **LOGIN-METHOD select** (1 Claude-subscription / 2 Anthropic Console / 3 3rd-party)
3. **OAUTH** ("Browser didn't open? Use the url below to sign in … Paste code here") — the auth step.
The CLI persists config to `CLAUDE_CONFIG_DIR/.claude.json` + `settings.json` (+ `backups/`, `cache/`).

## Dialog-free-boot recipe (the n3 deliverable)
Pre-seed `CLAUDE_CONFIG_DIR` with:
- **(a) `.claude.json`** — theme set + onboarding/first-run-complete flags → skips THEME + LOGIN-METHOD dialogs.
- **(b) the file-mounted `.credentials.json`** — the OAuth creds (§5 file-mounted, NEVER baked) → skips the OAUTH flow.
Then `claude --dangerously-skip-permissions` boots straight to the prompt, no-human. (n3 productionizes this: file-mount the creds per §5; pre-seed the config; never bake.)

## OUTPUT — the supervisor's new child command (the structural delta from the pilot)
The PID-1 supervisor's child flips `node shim.js` → a **tmux session running `claude --dangerously-skip-permissions`** (with the pre-seeded config+creds + a project `.mcp.json` that registers the shim as the MCP **grandchild**: `proxy = node ${CLAUDE_PLUGIN_ROOT}/dist/shim.js`). This finally exercises the sentinel→exit-75 GRANDCHILD seam the pilot carried (the CLI swallows the kernel-shim's exit; the sentinel is the only exit-propagation path — n5's 3-level chaos e2e). **tmux/PTY = the long-lived host; the MCP channel = the inject path (NOT tmux send-keys).**

## Image-delta (n3/n5 bakes)
`npm i -g @anthropic-ai/claude-code@2.1.196` (PINNED) in the Dockerfile — reproducible, aligns with the pilot's repro discipline (prefer over COPY-host-binary). **Maintenance point:** bump the pin as claude-code updates.

## Injection-receipt — HONEST split (architect discipline)
The injection **MECHANISM** is ESTABLISHED here: (1) the live-interactive proof (this session receives the shim's MCP-channel notifications), and (2) the MCP-protocol argument (server-initiated notifications surface as `<channel>` turns, independent of a human/TTY). **The FAITHFUL HEADLESS injection-receipt** — headless claude + the real shim grandchild + the standalone test-Hub + a real injected `work_claimable_digest` → a real claim — is **CARRIED to n4 (`ev_engineer_ready`)**, NOT run here. n1 did not run a fresh headless injection; it decided the mode + captured the recipe, mechanism-proven.

## Handoff
- **n2 (sandbox-exposure):** bounds the container's exposure (host-worktree only write-surface, no docker socket, test-Hub-scoped network, dropped caps, file-mounted creds) — the security model since `--dangerously-skip-permissions` makes the sandbox the boundary.
- **n3 (dialog-free-boot):** productionize the recipe above (pre-seed config + file-mount `.credentials.json` §5) + bake the image-delta.
- **n4 (connect+ready-for-work):** the FAITHFUL headless injection-receipt + the real test-Hub claim.
- **n5 (container + 3-level sentinel e2e):** the grandchild sentinel→exit-75 seam end-to-end.
