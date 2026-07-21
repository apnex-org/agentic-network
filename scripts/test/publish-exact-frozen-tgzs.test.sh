#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROTOCOL="$REPO/scripts/release/publish-exact-frozen-tgzs.mjs"
TDIR="$(mktemp -d)"
trap 'rm -rf "$TDIR"' EXIT
mkdir -p "$TDIR/bin" "$TDIR/frozen" "$TDIR/build/package"

cat > "$TDIR/bin/npm" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$NPM_MOCK_LOG"
case "${1:-}" in
  --version) printf '%s\n' '11.6.2' ;;
  whoami) printf '%s\n' 'apnex-lily' ;;
  view)
    spec="${2:-}" field="${3:-}"
    case "$spec" in
      @apnex/cognitive-layer@0.1.4) idx=1; version=0.1.4; integrity="${A1_INTEGRITY:-}" ;;
      @apnex/network-adapter@0.1.14) idx=2; version=0.1.14; integrity="${A2_INTEGRITY:-}" ;;
      @apnex/claude-plugin@0.1.16) idx=3; version=0.1.16; integrity="${A3_INTEGRITY:-}" ;;
      *) printf '%s\n' 'npm error code E404' >&2; exit 1 ;;
    esac
    if (( idx > ${MOCK_PREFIX:-0} )); then printf '%s\n' 'npm error code E404' >&2; exit 1; fi
    case "$field" in
      version) printf '"%s"\n' "$version" ;;
      dist.integrity) printf '"%s"\n' "$integrity" ;;
      gitHead) printf '"%s"\n' "$MOCK_GIT_HEAD" ;;
      *) printf 'unexpected view field: %s\n' "$field" >&2; exit 9 ;;
    esac
    ;;
  publish) exit 0 ;;
  *) printf 'unexpected npm command: %s\n' "$*" >&2; exit 9 ;;
esac
MOCK
chmod +x "$TDIR/bin/npm"

make_tgz() {
  local slug="$1" name="$2" version="$3" git_head="$4" dependencies="$5"
  rm -rf "$TDIR/build/package"
  mkdir -p "$TDIR/build/package"
  jq -n --arg name "$name" --arg version "$version" --arg gitHead "$git_head" --argjson dependencies "$dependencies" \
    '{name:$name,version:$version,gitHead:$gitHead,dependencies:$dependencies}' > "$TDIR/build/package/package.json"
  tar -C "$TDIR/build" -czf "$TDIR/frozen/$slug-$version.tgz" package
}

GIT_HEAD="0123456789abcdef0123456789abcdef01234567"
TREE="fedcba9876543210fedcba9876543210fedcba98"
make_tgz cognitive-layer @apnex/cognitive-layer 0.1.4 "$GIT_HEAD" '{}'
make_tgz network-adapter @apnex/network-adapter 0.1.14 "$GIT_HEAD" '{"@apnex/cognitive-layer":"0.1.4","@apnex/message-router":"0.1.3"}'
make_tgz claude-plugin @apnex/claude-plugin 0.1.16 "$GIT_HEAD" '{"@apnex/network-adapter":"0.1.14"}'

artifact_json() {
  local path="$1" name="$2" version="$3"
  local sha256 integrity
  sha256="$(sha256sum "$path" | awk '{print $1}')"
  integrity="sha512-$(openssl dgst -sha512 -binary "$path" | openssl base64 -A)"
  jq -n --arg name "$name" --arg version "$version" --arg path "$path" \
    --arg sha256 "$sha256" --arg integrity "$integrity" --arg gitHead "$GIT_HEAD" \
    '{name:$name,version:$version,path:$path,sha256:$sha256,integrity:$integrity,gitHead:$gitHead}'
}

A1="$(artifact_json "$TDIR/frozen/cognitive-layer-0.1.4.tgz" @apnex/cognitive-layer 0.1.4)"
A2="$(artifact_json "$TDIR/frozen/network-adapter-0.1.14.tgz" @apnex/network-adapter 0.1.14)"
A3="$(artifact_json "$TDIR/frozen/claude-plugin-0.1.16.tgz" @apnex/claude-plugin 0.1.16)"
jq -n --arg statePath "$TDIR/state.json" --arg commit "$GIT_HEAD" --arg tree "$TREE" \
  --argjson a1 "$A1" --argjson a2 "$A2" --argjson a3 "$A3" \
  '{protocolVersion:1,npmCliVersion:"11.6.2",executor:{agentName:"lily",role:"architect",npmIdentity:"apnex-lily"},statePath:$statePath,source:{commit:$commit,tree:$tree},artifacts:[$a1,$a2,$a3]}' \
  > "$TDIR/manifest.json"

export PATH="$TDIR/bin:$PATH" NPM_MOCK_LOG="$TDIR/npm.log" OIS_AGENT_NAME=lily OIS_HUB_ROLE=architect
export MOCK_GIT_HEAD="$GIT_HEAD" A1_INTEGRITY A2_INTEGRITY A3_INTEGRITY
A1_INTEGRITY="$(jq -r .integrity <<<"$A1")"
A2_INTEGRITY="$(jq -r .integrity <<<"$A2")"
A3_INTEGRITY="$(jq -r .integrity <<<"$A3")"
node "$PROTOCOL" "$TDIR/manifest.json" --dry-run

[[ "$(jq -r .status "$TDIR/state.json")" == "dry-run-complete" ]]
mapfile -t publishes < <(grep '^publish ' "$TDIR/npm.log")
[[ ${#publishes[@]} -eq 3 ]]
[[ "${publishes[0]}" == "publish $TDIR/frozen/cognitive-layer-0.1.4.tgz --access public --tag latest --dry-run" ]]
[[ "${publishes[1]}" == "publish $TDIR/frozen/network-adapter-0.1.14.tgz --access public --tag latest --dry-run" ]]
[[ "${publishes[2]}" == "publish $TDIR/frozen/claude-plugin-0.1.16.tgz --access public --tag latest --dry-run" ]]
! grep -Eq 'unpublish|deprecate|dist-tag' "$TDIR/npm.log"

# Recovery accepts only an exact already-published prefix and resumes at the first vacancy.
: > "$TDIR/npm.log"
MOCK_PREFIX=1 node "$PROTOCOL" "$TDIR/manifest.json" --dry-run --recover
mapfile -t recovery_publishes < <(grep '^publish ' "$TDIR/npm.log")
[[ ${#recovery_publishes[@]} -eq 2 ]]
[[ "${recovery_publishes[0]}" == "publish $TDIR/frozen/network-adapter-0.1.14.tgz --access public --tag latest --dry-run" ]]
[[ "${recovery_publishes[1]}" == "publish $TDIR/frozen/claude-plugin-0.1.16.tgz --access public --tag latest --dry-run" ]]

# Recovery refuses a published prefix whose integrity differs from the frozen manifest.
: > "$TDIR/npm.log"
if MOCK_PREFIX=1 A1_INTEGRITY=sha512-wrong node "$PROTOCOL" "$TDIR/manifest.json" --dry-run --recover >"$TDIR/recover-mismatch.out" 2>&1; then
  echo "FAIL: mismatched recovery prefix passed" >&2
  exit 1
fi
grep -q 'registry integrity' "$TDIR/recover-mismatch.out"
! grep -Eq '^publish ' "$TDIR/npm.log"

# A byte mismatch must fail before any registry probe or publish.
: > "$TDIR/npm.log"
printf 'tamper' >> "$TDIR/frozen/network-adapter-0.1.14.tgz"
if node "$PROTOCOL" "$TDIR/manifest.json" --dry-run >"$TDIR/tamper.out" 2>&1; then
  echo "FAIL: tampered tarball passed" >&2
  exit 1
fi
grep -q 'SHA-256' "$TDIR/tamper.out"
! grep -Eq '^view |^publish ' "$TDIR/npm.log"

# Wrong executor identity must stop before npm whoami or mutation.
: > "$TDIR/npm.log"
if OIS_AGENT_NAME=greg node "$PROTOCOL" "$TDIR/manifest.json" --dry-run >"$TDIR/seat.out" 2>&1; then
  echo "FAIL: wrong executor seat passed" >&2
  exit 1
fi
grep -q 'runtime executor agentName' "$TDIR/seat.out"
! grep -Eq '^whoami|^view |^publish ' "$TDIR/npm.log"

echo "PASS: exact frozen-tgz publication protocol is fail-closed and dry-run only"
