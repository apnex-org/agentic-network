#!/usr/bin/env bash
# prompt-resolve.sh — transport-neutral resolver for ois interactive-prompt handling (bug-247).
#
# PURE resolver: given the handler table + launch context + captured pane text, emit the
# ordered ABSTRACT respond tokens for the FIRST handler whose guard AND detect fully match
# and which has not already fired. Contains ZERO transport verbs (no tmux, no capture-pane,
# no send-keys). A transport ADAPTER maps the emitted tokens to real keystrokes:
#   - ois/bin/ois wraps it with a tmux adapter (capture-pane -> resolve -> send-keys);
#   - test/test-prompt-resolve.sh drives it with a MOCK stdout adapter (no tmux) — the
#     falsifiable proof that the same table is transport-neutral;
#   - a future in-container prompt-supervisor can consume the same table over another transport.
# This separation is the D5 transport-neutrality contract.
#
# Usage (source, then call):
#   source prompt-resolve.sh
#   out=$(prompt_resolve "$table" "$harness" "$launch_args" "$fired_csv" "$pane_text")
#   # stdout: line 1 = matched handler id (empty => no confident match); lines 2.. = respond tokens.
#
# FAIL-SAFE by construction — every degenerate input falls through to EMPTY output (the
# caller then sends no keystroke and proceeds unaffected), NEVER a hard fail that could
# brick seat-launch: absent/unreadable table, missing jq, MALFORMED/partial/empty table
# (unparseable JSON, missing keys, non-array detect), or any partial detect match. The
# function always returns 0.

prompt_resolve() {
  local table="$1" harness="$2" largs="$3" fired="$4" pane="$5"
  [[ -r "$table" ]] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  jq empty "$table" 2>/dev/null || return 0            # malformed/unparseable table -> fall through
  # Walk handlers in declared order; the first not-yet-fired handler whose guard AND all
  # detect substrings match wins. Emit its id (line 1) then its respond tokens (lines 2..).
  # Individual malformed handlers (missing/non-array detect, etc.) are SKIPPED, not fatal;
  # `|| true` keeps any residual jq error from propagating a non-zero exit.
  jq -r \
    --arg harness "$harness" \
    --arg largs "$largs" \
    --arg fired "$fired" \
    --arg pane "$pane" '
      ($fired | split(",") | map(select(length > 0))) as $firedset
      | (.handlers // [])
      | map(select(
          ((.id) as $id | ($firedset | index($id)) | not)                    # not already fired
          and ((.guard.harness // $harness) == $harness)                      # harness guard (absent = any)
          and ((.guard.launchArgsContains // "") as $need                     # launch-args guard (absent = unconditional)
               | ($need == "") or ($largs | contains($need)))
          and ((.detect | type) == "array" and (.detect | length) > 0         # detect present + non-empty array
               and (.detect | all(.[]; . as $d | ($pane | contains($d)))))    # ALL detect substrings in the pane
        ))
      | (.[0] // empty)                                                        # first confident match, or nothing
      | (.id), (.respond[]?)
    ' "$table" 2>/dev/null || true
  return 0
}
