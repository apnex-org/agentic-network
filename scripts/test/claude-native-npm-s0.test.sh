#!/usr/bin/env bash
# Mission-125 Phase-A committed S0 harness test. Disposable loopback registries
# and isolated Claude/npm roots only; never npmjs or live Claude state.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
HARNESS="$ROOT/scripts/phase-a/claude-native-npm-s0.mjs"
RUN_DIR=$(mktemp -d /tmp/claude-native-npm-s0-test.XXXXXX)
trap 'rm -rf "$RUN_DIR"' EXIT
[[ -x /home/apnex/.local/share/claude/versions/2.1.216 ]] || { echo "exact Claude tuple unavailable" >&2; exit 1; }
[[ -f "$HARNESS" ]]
node "$HARNESS" "--run-dir=$RUN_DIR"
RESULT="$RUN_DIR/result/phase-a-result.json"
[[ -f "$RESULT" ]]
# Exact current tuple result is binary and intentionally preserved: direct npm's
# R2 arm re-resolves ^1.0.0 to 1.0.1 even though the published outer package
# carries shrinkwrap, while both Claude-native cache-local npm-ci arms consume it.
jq -e '
  .verdict == "FAIL" and
  ([.results[] | .rootId] == ["r1-npm","r2-npm","r1-claude","r2-claude"]) and
  (.results[0].pass == true) and (.results[1].pass == false) and
  (.results[2].pass == true) and (.results[3].pass == true) and
  (.killedMutations | length >= 27) and
  (.killedMutations | index("registry-retarget-unbound-mutant") != null) and
  (.killedMutations | index("same-version-wrong-acquisition-cache") != null) and
  (.killedMutations | index("ambient-global-resolution") != null)
' "$RESULT" >/dev/null
# The source slice may add only its disposable harness/test fixture.
bad=$(git -C "$ROOT" diff --name-only 1055d80161df4d36e6a1876676a822e7fe99b029 -- \
  ':(exclude)scripts/phase-a/**' ':(exclude)scripts/test/claude-native-npm-s0.test.sh')
[[ -z "$bad" ]] || { printf 'Phase-A anti-scope violation:\n%s\n' "$bad" >&2; exit 1; }
