#!/usr/bin/env bash
# M-Real-CLI-Harness n5 — the supervisor's CHILD: the REAL claude-code CLI under tmux (the PTY
# host, n1 mode A), on the PROVEN plugin path. claude spawns the @apnex/claude-plugin shim as its
# MCP GRANDCHILD — finally exercising the supervisor->CLI->shim-grandchild sentinel seam (the
# net-new vs the pilot, where the shim WAS the child).
#
# TWO sandbox-bounded dangerous flags (n2 spec bounds both; n6 certs):
#   --dangerously-skip-permissions            (unattended; the container sandbox is the boundary)
#   --dangerously-load-development-channels    (REQUIRED for the <channel> render — n4 reversal;
#       plugin:agent-adapter@agentic-network = the in-repo directory-marketplace baked at /app/adapters/claude-plugin)
#
# FOREGROUND by design: the PID-1 supervisor watches THIS process's exit. tmux new-session -d
# returns immediately, so we keep-alive while the session (claude) lives; on claude-exit OR a
# SIGTERM from the supervisor (sentinel-driven exit-75 / docker stop) we tear tmux down + exit so
# the supervisor mirrors it.
set -uo pipefail
WORK_DIR="${WORK_DIR:-/work}"
SESS="cli"
SOCK="n5"

cleanup() { echo "[real-cli-launch] signal -> killing tmux"; tmux -L "$SOCK" kill-server 2>/dev/null || true; exit 0; }
trap cleanup TERM INT

echo "[real-cli-launch] launching real claude under tmux -L $SOCK (plugin path); WORK_DIR=$WORK_DIR"
tmux -L "$SOCK" new-session -d -s "$SESS" -c "$WORK_DIR" -x 220 -y 50 \
  "claude --dangerously-skip-permissions --dangerously-load-development-channels plugin:agent-adapter@agentic-network ${CLAUDE_EXTRA_ARGS:-}"

# Auto-accept the dev-channels confirmation dialog (gate-3.5: non-persisting, appears POST-LOGIN —
# distinct from the bypass dialog [settings.json] + the plugin-MCP config). Without this, every boot
# AND every L2-restart re-boot hangs on the dialog, breaking ZERO-human recovery. Poll the pane; when
# the dialog shows, send Enter (cursor defaults to "1. I am using this for local development"). This
# is THE property that makes the harness self-RECOVER unattended (not just self-drive once) — n6-defining.
(
  for _ in $(seq 1 60); do
    if tmux -L "$SOCK" capture-pane -t "$SESS" -p 2>/dev/null | grep -q "using this for local development"; then
      tmux -L "$SOCK" send-keys -t "$SESS" Enter
      echo "[real-cli-launch] auto-accepted dev-channels dialog (gate-3.5) -> shim spawn proceeds"
      break
    fi
    sleep 2
  done
) &

# Foreground keep-alive: live while the tmux session (claude) exists. (sleep is fine in-container;
# only the harness's TOP-LEVEL sleep is gated.)
while tmux -L "$SOCK" has-session -t "$SESS" 2>/dev/null; do sleep 2; done
echo "[real-cli-launch] tmux session ended -> exiting (supervisor mirrors the exit)"
