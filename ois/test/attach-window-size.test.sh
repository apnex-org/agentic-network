#!/usr/bin/env bash
# attach-window-size.test.sh — bug-259: PROVE `ois attach` no longer resizes the seat window.
#
# Root cause: `ois up` creates the seat's detached tmux session at a fixed size; tmux's default
# `window-size latest` then resizes the window to whatever terminal ATTACHES. When the operator's
# terminal != that size, attach fires SIGWINCH -> the claude-code (Ink) TUI full-repaints,
# replaying the whole conversation = the "attach scrollback flood". The fix pins `window-size
# manual` at session creation (real code path: `_seat_new_session`) so raw tmux attach never
# resizes -> no implicit SIGWINCH -> the operator sees the CURRENT pane, not a re-scroll.
#
# bug-273: OIS_TMUX_ROWS is CLIENT rows; with tmux status on, _seat_new_session creates
# a 220x49 pane by default (50 client rows - 1 status row) to avoid tmux viewport `[0,0]`.
#
# This test attaches a deliberately-mismatched (100x30) client through a pty and asserts the
# seat window keeps its created 220x49 size. A CONTROL session (plain new-session, default
# window-size) is attached the same way to confirm the attach path really does resize — so the
# fix assertion cannot false-PASS in an environment where the pty attach is inert.
#
# Sources ois (dispatch source-guarded) to exercise the REAL `stmux` + `_seat_new_session`.
# Self-cleaning; uses $$-unique sockets (no overlap with real seats).
#
# Run:  bash ois/test/attach-window-size.test.sh   → PASS / SKIP / FAIL, exit 0 / 0 / 1.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/../bin/ois"   # loads stmux + _seat_new_session; source-guard skips the CLI dispatch
set +e

command -v tmux    >/dev/null 2>&1 || { echo "SKIP: tmux not available";    exit 0; }
command -v python3 >/dev/null 2>&1 || { echo "SKIP: python3 not available"; exit 0; }

SFIX="ois-testFIX-$$"; SCTL="ois-testCTL-$$"
cleanup() { tmux -L "$SFIX" kill-server 2>/dev/null; tmux -L "$SCTL" kill-server 2>/dev/null; }
trap cleanup EXIT

# Attach to <socket>/<session> through a pty sized <cols>x<rows>, hold briefly, then detach.
# This is exactly the resize path `ois attach` triggers when the operator terminal mismatches.
pty_attach() { # <socket> <session> <cols> <rows>
  python3 - "$1" "$2" "$3" "$4" <<'PY'
import os, pty, sys, struct, fcntl, termios, time, signal
sock, sess, cols, rows = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
pid, fd = pty.fork()
if pid == 0:
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    os.execvp("tmux", ["tmux", "-L", sock, "attach", "-t", sess])
    os._exit(127)
deadline = time.time() + 1.5
while time.time() < deadline:
    try: os.read(fd, 4096)
    except OSError: break
    time.sleep(0.05)
os.system("tmux -L %s detach-client -s %s 2>/dev/null" % (sock, sess))
time.sleep(0.2)
try: os.kill(pid, signal.SIGKILL)
except OSError: pass
os.waitpid(pid, 0)
PY
}

winw() { tmux -L "$1" display-message -p -t "$2" '#{window_width}' 2>/dev/null; }

fail=0

echo "== CONTROL: plain new-session (tmux default window-size) — attach MUST resize =="
tmux -L "$SCTL" new-session -d -s "$SCTL" -x 220 -y 50 'sleep 120' 2>/dev/null
ctl_before=$(winw "$SCTL" "$SCTL")
pty_attach "$SCTL" "$SCTL" 100 30
ctl_after=$(winw "$SCTL" "$SCTL")
echo "  control window width: ${ctl_before} -> ${ctl_after} (attach @100 cols)"

if [[ "$ctl_after" != "100" ]]; then
  # The attach path did not resize the control window (pty attach inert in this env) — we
  # cannot meaningfully prove the fix. Don't false-PASS; report SKIP.
  echo "SKIP: pty attach did not resize the control window (got '$ctl_after', expected 100) — attach path inert here"
  exit 0
fi
echo "  ok: attach resizes an unpinned window (bug mechanism reproduced)"

echo "== FIX: _seat_new_session (window-size manual) — attach must NOT resize =="
_seat_new_session "$SFIX" 'sleep 120'
fix_before=$(winw "$SFIX" "$SFIX")
fix_before_h=$(tmux -L "$SFIX" display-message -p -t "$SFIX" '#{window_height}' 2>/dev/null)
pty_attach "$SFIX" "$SFIX" 100 30
fix_after=$(winw "$SFIX" "$SFIX")
fix_after_h=$(tmux -L "$SFIX" display-message -p -t "$SFIX" '#{window_height}' 2>/dev/null)
echo "  fixed window size: ${fix_before}x${fix_before_h} -> ${fix_after}x${fix_after_h} (attach @100 cols)"

if [[ "$fix_before" == "220" && "$fix_after" == "220" && "$fix_before_h" == "49" && "$fix_after_h" == "49" ]]; then
  echo "  ok: window held 220x49 across a 100-col attach — no resize, no repaint flood, status-row space preserved"
else
  echo "  FAIL: window changed on attach (${fix_before}x${fix_before_h} -> ${fix_after}x${fix_after_h}) — resize-on-attach not eliminated"
  fail=1
fi

echo
if [[ $fail -eq 0 ]]; then
  echo "PASS: bug-259 — ois seat window is size-pinned; attach shows current state, not a re-scroll"
  exit 0
else
  echo "FAIL: bug-259 — attach still resizes the seat window"
  exit 1
fi
