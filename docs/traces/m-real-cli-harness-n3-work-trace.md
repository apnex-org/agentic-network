# Work-trace — M-Real-CLI-Harness n3 (dialog-free headless boot)

**Node:** `work-bp-real_cli_harness_20260630-n3_startup_automation` (engineer; arc idea-405). **Evidence:** `ev_dialogfree_boot` (test-run). **Branch:** `agent-greg/real-cli-n3-dialogfree` off `origin/main` @989de34 (n1 #441 merged).
**Goal:** a clean, repeatable headless boot of the real `claude` CLI to a live injectable session with ZERO human keystroke (trust-folder/onboarding/theme pre-seeded, OAuth file-mounted, no keychain/TUI). Productionizes n1's recipe.

## Method — isolated local-confirm (architect-sanctioned)
Same hard isolation as n1: separate tmux socket + `HOME` + `CLAUDE_CONFIG_DIR` + scratch project, **no Hub**. For the login confirm, `~/.claude/.credentials.json` was copied into the isolated config (architect-approved, n3's §5-contract territory), **removed immediately after**; host `~/.claude` untouched; prod Hub never contacted.

## Findings (empirical, claude 2.1.196)
1. **Pre-seed skips theme + onboarding + trust.** A baked `.claude.json` with `hasCompletedOnboarding:true` + per-folder `projects["/work"].hasTrustDialogAccepted:true` (+ the established-state flags) skips THEME, ONBOARDING, and the TRUST-THIS-FOLDER dialog.
2. **Residual: the one-time Bypass-Permissions acceptance.** Even `--dangerously-skip-permissions` shows a one-time "Bypass Permissions mode" acceptance — **default-highlighted on "1. No, exit"** (a blind Enter KILLS the boot). It is the n3 residual-dialog case.
3. **The bypass-acceptance PERSISTS via config state — no keystroke-fallback needed.** After it is accepted once, a re-launch with the same (now-established) config boots **"Welcome back!" straight to the prompt** — no bypass warning, no dialogs. There is no explicit `bypass*` key; the established-config state suppresses it. So **baking a fully-initialized `.claude.json` = a true ZERO-keystroke dialog-free boot.** (Backup if a residual ever remains in n5's container: keystroke-fallback = **Down+Enter**, never Enter.)
4. **`.credentials.json` file-mount → logged-in; `oauthAccount` NOT needed.** With the post-accept config (no creds) the session boots to the prompt but shows "Not logged in · Run /login". Adding the file-mounted `.credentials.json` ALONE → logged-in (the "Not logged in" status clears) — no `oauthAccount` bake required.
5. **Mount mode = read-WRITE (resolves the auth-expiry carry).** `.credentials.json` carries `accessToken` + `refreshToken` + `expiresAt` (~1h out) + `scopes`. A long-lived engineer's access token expires mid-run → claude refreshes via the refresh-token → it WRITES the new token back. (Boot-write was unchanged only because no refresh fires in a 12s boot; the ~1h expiry + standard OAuth confirm the refresh-write.) So the `.credentials.json` host-mount must be **read-WRITE** (still §5/file-mounted, just writable; bounded by n2's sandbox) so the refresh/rotation **persists across container restarts** (the supervisor restarts on a wedge → a read-only/stale-token re-read would auth-fail). **This RESOLVES the pilot's auth-expiry 5th-concern:** the refresh-token auto-refreshes, unlike a static `CLAUDE_CODE_OAUTH_TOKEN` env (which can't refresh → a long-lived engineer would auth-expire). **§5 cred-handling for the real CLI = `.credentials.json` read-write file-mount, NOT the static env token** (updates the Design §5 note; architect folds at arc-close).

## The dialog-free-boot recipe (the n3 deliverable)
- **Bake (NON-secret, image):** `deploy/adapter-image/claude-cli-preseed.claude.json` → the container's `CLAUDE_CONFIG_DIR/.claude.json` (onboarding/theme/trust-for-/work/first-run-state). Identity bits (userID/machineID) omitted — derived from the creds on first boot.
- **File-mount (SECRET, §5, runtime, read-WRITE):** `.credentials.json` → `CLAUDE_CONFIG_DIR/.credentials.json` (the OAuth + refresh; never baked). `/work` via the compose worktree-mount. (Same §5 contract n2 bounds — two angles of one posture.)
- **Dockerfile delta (n5 bakes):** `npm i -g @anthropic-ai/claude-code@2.1.196` (PINNED; **maintenance: bump as claude-code updates**) + `COPY claude-cli-preseed.claude.json $CLAUDE_CONFIG_DIR/.claude.json` + set `CLAUDE_CONFIG_DIR`.
- **Launch (n1's child-command):** the supervisor's tmux session runs `claude --dangerously-skip-permissions` in `/work` + the project `.mcp.json` shim-grandchild → boots dialog-free to a logged-in, injectable prompt.

## n2-posture note (the two halves of one contract)
Accepting the Bypass-Permissions warning is SAFE precisely BECAUSE of n2 — the container sandbox bounds the blast radius (host-worktree the only write-surface, no docker socket, test-Hub-scoped network, dropped caps, non-root, file-mounted creds). The n3 bypass-accept + the n2 bounded-exposure are the two halves of the same "container-is-the-security-boundary" posture (the Director decision); **n6 certifies the bound is real.**

## Handoff
- **n2 (sandbox-exposure):** the compose security surface — keep the creds-mount **read-write** (this node's finding) within the §5 "creds file-mounted only" bound.
- **n4 (connect+ready):** the FAITHFUL headless injection-receipt + the real test-Hub claim (n1's carry) against this dialog-free, logged-in session.
- **n5 (container integration):** bake the image-delta + confirm the dialog-free boot IN the container (the keystroke-fallback only if a residual bypass prompt survives the baked config); the 3-level sentinel→exit-75 grandchild e2e.
