#!/usr/bin/env bash
# test-prompt-resolve.sh — falsifiable proof of transport-neutrality (bug-247).
#
# Drives the SAME prompt-handlers.json table through the SAME prompt_resolve() core via a
# MOCK STDOUT adapter (no tmux, no send-keys anywhere in this path). A second adapter
# consuming the same table is what makes the transport-neutral claim PROVABLE rather than
# asserted — and it is the bug247_gate's key evidence (steve: live resume-seat auto-handled
# + this test green). It also pins the FAIL-SAFE contract: a bad/absent/malformed table
# cannot brick cmd_up — it must fall through to no-auto-handling as a GREEN assertion.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$here/../prompt-resolve.sh"
TABLE="$here/../prompt-handlers.json"

pass=0; fail=0

# MOCK ADAPTER: the transport is "print", not tmux. Collect resolver output as "id|tok,tok".
mock_adapter() { # <table> <harness> <largs> <fired> <pane>
  local out id toks
  out=$(prompt_resolve "$1" "$2" "$3" "$4" "$5")
  id=$(printf '%s\n' "$out" | sed -n '1p')
  toks=$(printf '%s\n' "$out" | tail -n +2 | paste -sd, -)
  printf '%s|%s' "$id" "$toks"
}
check() { # <name> <got> <want>
  if [[ "$2" == "$3" ]]; then pass=$((pass+1)); printf 'ok   - %s\n' "$1"
  else fail=$((fail+1)); printf 'FAIL - %s\n     got  [%s]\n     want [%s]\n' "$1" "$2" "$3"; fi
}

# --- confident match ---------------------------------------------------------
check "dev-banner: claude seat + banner pane -> Enter" \
  "$(mock_adapter "$TABLE" claude '' '' 'Welcome — this build can load local development channels. Continue? [y/N]')" \
  "claude-dev-channels-banner|Enter"

# --- fail-safe: guard misses -------------------------------------------------
check "fail-safe: non-claude harness, same pane -> fall through" \
  "$(mock_adapter "$TABLE" codex '' '' 'load local development channels')" \
  "|"

check "fail-safe: already fired -> no re-fire (once)" \
  "$(mock_adapter "$TABLE" claude '' 'claude-dev-channels-banner' 'load local development channels')" \
  "|"

# --- fail-safe: detect misses (ambiguous pane) -------------------------------
check "fail-safe: no detect substring -> fall through" \
  "$(mock_adapter "$TABLE" claude '' '' 'Some unrelated startup line, no banner here')" \
  "|"

# --- fail-safe: a bad table cannot brick cmd_up ------------------------------
tmpd=$(mktemp -d)
trap 'rm -rf "$tmpd"' EXIT
printf '%s' '{ this is not valid json ][' > "$tmpd/malformed.json"
check "fail-safe: MALFORMED table -> fall through (no hard fail)" \
  "$(mock_adapter "$tmpd/malformed.json" claude '' '' 'load local development channels')" \
  "|"

printf '%s' '{}' > "$tmpd/empty.json"
check "fail-safe: EMPTY table (no handlers) -> fall through" \
  "$(mock_adapter "$tmpd/empty.json" claude '' '' 'load local development channels')" \
  "|"

printf '%s' '{"handlers":[{"id":"bad","guard":{"harness":"claude"},"detect":"not-an-array","respond":["Enter"]}]}' > "$tmpd/badhandler.json"
check "fail-safe: malformed handler (detect not array) -> skipped, fall through" \
  "$(mock_adapter "$tmpd/badhandler.json" claude '' '' 'load local development channels')" \
  "|"

check "fail-safe: ABSENT table -> fall through" \
  "$(mock_adapter "$tmpd/does-not-exist.json" claude '' '' 'load local development channels')" \
  "|"

# --- resume-mode (bug-247): the menu labels are ground-truth from the claude binary --------
# Rendered menu (Ink select, header + 3 options); we select option 2 (full session).
RESUME_PANE='Summarized conversation
> Resume from summary (recommended)
  Resume full session as-is
  Don'\''t ask me again'

check "resume-mode: claude -c + menu pane -> Down,Enter (select full session)" \
  "$(mock_adapter "$TABLE" claude '-c' '' "$RESUME_PANE")" \
  "claude-resume-mode-full|Down,Enter"

# fail-safe: the resume menu can only be answered when the seat was launched to resume.
check "fail-safe: resume menu but NO -c (fresh start) -> fall through" \
  "$(mock_adapter "$TABLE" claude '' '' "$RESUME_PANE")" \
  "|"

check "fail-safe: -c present but menu label absent -> fall through" \
  "$(mock_adapter "$TABLE" claude '-c' '' 'just some resume progress text, no menu yet')" \
  "|"

check "fail-safe: resume handler fire-once" \
  "$(mock_adapter "$TABLE" claude '-c' 'claude-resume-mode-full' "$RESUME_PANE")" \
  "|"

# guard isolation: the dev-banner must NOT also fire on the resume pane (different detect).
check "isolation: resume pane does not trigger dev-banner" \
  "$(mock_adapter "$TABLE" claude '-c' 'claude-resume-mode-full' 'Resume full session as-is (no banner text)')" \
  "|"

printf -- '---\n%d passed, %d failed\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
