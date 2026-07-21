#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROTOCOL="$REPO/scripts/release/publish-exact-frozen-tgzs.mjs"
REAL_NPM="$(command -v npm)"
REAL_PATH="$PATH"
TDIR="$(mktemp -d)"
trap 'rm -rf "$TDIR"' EXIT
mkdir -p "$TDIR/bin" "$TDIR/frozen" "$TDIR/build/package"

cat > "$TDIR/bin/npm" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$NPM_MOCK_LOG"

replace_path_once() {
  local target="$1" replacement="$2" marker="$3"
  if [[ ! -e "$marker" ]]; then
    cp "$replacement" "$target.swap.$$"
    mv -f "$target.swap.$$" "$target"
    : > "$marker"
  fi
}

case "${1:-}" in
  --version) printf '%s\n' '11.6.2' ;;
  whoami) printf '%s\n' 'apnex-lily' ;;
  view)
    if [[ -n "${SWAP_ON_VIEW_TARGET:-}" ]]; then
      replace_path_once "$SWAP_ON_VIEW_TARGET" "$SWAP_REPLACEMENT" "$SWAP_MARKER"
    fi
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
  publish)
    if [[ -n "${SWAP_ON_FIRST_PUBLISH_TARGET:-}" ]]; then
      replace_path_once "$SWAP_ON_FIRST_PUBLISH_TARGET" "$SWAP_REPLACEMENT" "$SWAP_MARKER"
    fi
    artifact_path="${2:-}"
    published_name="$(tar -xOf "$artifact_path" package/package.json | jq -r .name)"
    published_sha="$(sha256sum "$artifact_path" | awk '{print $1}')"
    printf '%s %s\n' "$published_name" "$published_sha" >> "$NPM_MOCK_PUBLISH_BYTES_LOG"
    ;;
  *) printf 'unexpected npm command: %s\n' "$*" >&2; exit 9 ;;
esac
MOCK
chmod +x "$TDIR/bin/npm"

make_tgz() {
  local output="$1" name="$2" version="$3" git_head="$4" dependencies="$5" extra="${6:-}"
  rm -rf "$TDIR/build/package"
  mkdir -p "$TDIR/build/package"
  jq -n --arg name "$name" --arg version "$version" --arg gitHead "$git_head" --argjson dependencies "$dependencies" \
    '{name:$name,version:$version,gitHead:$gitHead,dependencies:$dependencies}' > "$TDIR/build/package/package.json"
  if [[ -n "$extra" ]]; then printf '%s\n' "$extra" > "$TDIR/build/package/extra-payload.txt"; fi
  tar -C "$TDIR/build" -czf "$output" package
}

GIT_HEAD="0123456789abcdef0123456789abcdef01234567"
TREE="fedcba9876543210fedcba9876543210fedcba98"
COGNITIVE="$TDIR/frozen/cognitive-layer-0.1.4.tgz"
NETWORK="$TDIR/frozen/network-adapter-0.1.14.tgz"
CLAUDE="$TDIR/frozen/claude-plugin-0.1.16.tgz"
NETWORK_ALT="$TDIR/network-adapter-valid-replacement.tgz"
NETWORK_ORIGINAL="$TDIR/network-adapter-original.tgz"
make_tgz "$COGNITIVE" @apnex/cognitive-layer 0.1.4 "$GIT_HEAD" '{}'
make_tgz "$NETWORK" @apnex/network-adapter 0.1.14 "$GIT_HEAD" '{"@apnex/cognitive-layer":"0.1.4","@apnex/message-router":"0.1.3"}'
make_tgz "$CLAUDE" @apnex/claude-plugin 0.1.16 "$GIT_HEAD" '{"@apnex/network-adapter":"0.1.14"}'
cp "$NETWORK" "$NETWORK_ORIGINAL"
make_tgz "$NETWORK_ALT" @apnex/network-adapter 0.1.14 "$GIT_HEAD" '{"@apnex/cognitive-layer":"0.1.4","@apnex/message-router":"0.1.3"}' 'valid-but-different-bytes'
ORIGINAL_NETWORK_SHA="$(sha256sum "$NETWORK_ORIGINAL" | awk '{print $1}')"
ALTERNATE_NETWORK_SHA="$(sha256sum "$NETWORK_ALT" | awk '{print $1}')"
[[ "$ORIGINAL_NETWORK_SHA" != "$ALTERNATE_NETWORK_SHA" ]]

artifact_json() {
  local path="$1" name="$2" version="$3"
  local sha256 integrity
  sha256="$(sha256sum "$path" | awk '{print $1}')"
  integrity="sha512-$(openssl dgst -sha512 -binary "$path" | openssl base64 -A)"
  jq -n --arg name "$name" --arg version "$version" --arg path "$path" \
    --arg sha256 "$sha256" --arg integrity "$integrity" --arg gitHead "$GIT_HEAD" \
    '{name:$name,version:$version,path:$path,sha256:$sha256,integrity:$integrity,gitHead:$gitHead}'
}

A1="$(artifact_json "$COGNITIVE" @apnex/cognitive-layer 0.1.4)"
A2="$(artifact_json "$NETWORK" @apnex/network-adapter 0.1.14)"
A3="$(artifact_json "$CLAUDE" @apnex/claude-plugin 0.1.16)"
jq -n --arg statePath "$TDIR/state.json" --arg commit "$GIT_HEAD" --arg tree "$TREE" \
  --argjson a1 "$A1" --argjson a2 "$A2" --argjson a3 "$A3" \
  '{protocolVersion:1,npmCliVersion:"11.6.2",executor:{agentName:"lily",role:"architect",npmIdentity:"apnex-lily"},statePath:$statePath,source:{commit:$commit,tree:$tree},artifacts:[$a1,$a2,$a3]}' \
  > "$TDIR/manifest.json"

export PATH="$TDIR/bin:$PATH" NPM_MOCK_LOG="$TDIR/npm.log" NPM_MOCK_PUBLISH_BYTES_LOG="$TDIR/published-bytes.log"
export OIS_AGENT_NAME=lily OIS_HUB_ROLE=architect MOCK_GIT_HEAD="$GIT_HEAD" A1_INTEGRITY A2_INTEGRITY A3_INTEGRITY
A1_INTEGRITY="$(jq -r .integrity <<<"$A1")"
A2_INTEGRITY="$(jq -r .integrity <<<"$A2")"
A3_INTEGRITY="$(jq -r .integrity <<<"$A3")"
: > "$TDIR/npm.log"
: > "$TDIR/published-bytes.log"
node "$PROTOCOL" "$TDIR/manifest.json" --dry-run

[[ "$(jq -r .status "$TDIR/state.json")" == "dry-run-complete" ]]
mapfile -t publishes < <(grep '^publish ' "$TDIR/npm.log")
[[ ${#publishes[@]} -eq 3 ]]
for publish in "${publishes[@]}"; do
  [[ "$publish" =~ ^publish\ /tmp/ois-held-inode-[^/]+/[123]-[^\ ]+\.tgz\ --access\ public\ --tag\ latest\ --dry-run$ ]]
  [[ "$publish" != *"$TDIR/frozen/"* ]]
done
mapfile -t published_bytes < "$TDIR/published-bytes.log"
[[ "${published_bytes[0]}" == "@apnex/cognitive-layer $(jq -r .sha256 <<<"$A1")" ]]
[[ "${published_bytes[1]}" == "@apnex/network-adapter $ORIGINAL_NETWORK_SHA" ]]
[[ "${published_bytes[2]}" == "@apnex/claude-plugin $(jq -r .sha256 <<<"$A3")" ]]
! grep -Eq 'unpublish|deprecate|dist-tag' "$TDIR/npm.log"

# Recovery accepts only an exact already-published prefix and resumes at the first vacancy.
: > "$TDIR/npm.log"
: > "$TDIR/published-bytes.log"
MOCK_PREFIX=1 node "$PROTOCOL" "$TDIR/manifest.json" --dry-run --recover
mapfile -t recovery_bytes < "$TDIR/published-bytes.log"
[[ ${#recovery_bytes[@]} -eq 2 ]]
[[ "${recovery_bytes[0]}" == "@apnex/network-adapter $ORIGINAL_NETWORK_SHA" ]]
[[ "${recovery_bytes[1]}" == "@apnex/claude-plugin $(jq -r .sha256 <<<"$A3")" ]]

# Recovery refuses a published prefix whose integrity differs from the frozen manifest.
: > "$TDIR/npm.log"
: > "$TDIR/published-bytes.log"
if MOCK_PREFIX=1 A1_INTEGRITY=sha512-wrong node "$PROTOCOL" "$TDIR/manifest.json" --dry-run --recover >"$TDIR/recover-mismatch.out" 2>&1; then
  echo "FAIL: mismatched recovery prefix passed" >&2
  exit 1
fi
grep -q 'registry integrity' "$TDIR/recover-mismatch.out"
! grep -Eq '^publish ' "$TDIR/npm.log"

# Steve's falsifier: a valid pathname replacement after initial audit must be
# detected by the final held-inode identification before any publish begins.
: > "$TDIR/npm.log"
: > "$TDIR/published-bytes.log"
rm -f "$TDIR/swap-on-view.marker"
if SWAP_ON_VIEW_TARGET="$NETWORK" SWAP_REPLACEMENT="$NETWORK_ALT" SWAP_MARKER="$TDIR/swap-on-view.marker" \
  node "$PROTOCOL" "$TDIR/manifest.json" --dry-run >"$TDIR/post-audit-swap.out" 2>&1; then
  echo "FAIL: valid post-audit pathname swap passed" >&2
  exit 1
fi
grep -q 'final held-inode use boundary SHA-256' "$TDIR/post-audit-swap.out"
! grep -Eq '^publish ' "$TDIR/npm.log"
[[ "$(sha256sum "$NETWORK" | awk '{print $1}')" == "$ALTERNATE_NETWORK_SHA" ]]
cp "$NETWORK_ORIGINAL" "$NETWORK"

# A pathname replacement after every pending artifact has been finally opened
# cannot redirect npm: npm consumes fd 3, which still names the verified inode.
: > "$TDIR/npm.log"
: > "$TDIR/published-bytes.log"
rm -f "$TDIR/swap-on-publish.marker"
SWAP_ON_FIRST_PUBLISH_TARGET="$NETWORK" SWAP_REPLACEMENT="$NETWORK_ALT" SWAP_MARKER="$TDIR/swap-on-publish.marker" \
  node "$PROTOCOL" "$TDIR/manifest.json" --dry-run
[[ "$(jq -r .status "$TDIR/state.json")" == "dry-run-complete" ]]
[[ "$(sha256sum "$NETWORK" | awk '{print $1}')" == "$ALTERNATE_NETWORK_SHA" ]]
mapfile -t held_bytes < "$TDIR/published-bytes.log"
[[ "${held_bytes[1]}" == "@apnex/network-adapter $ORIGINAL_NETWORK_SHA" ]]
[[ "${held_bytes[1]}" != "@apnex/network-adapter $ALTERNATE_NETWORK_SHA" ]]
cp "$NETWORK_ORIGINAL" "$NETWORK"

# A byte mismatch must fail before any registry probe or publish.
: > "$TDIR/npm.log"
: > "$TDIR/published-bytes.log"
printf 'tamper' >> "$NETWORK"
if node "$PROTOCOL" "$TDIR/manifest.json" --dry-run >"$TDIR/tamper.out" 2>&1; then
  echo "FAIL: tampered tarball passed" >&2
  exit 1
fi
grep -q 'initial preflight SHA-256' "$TDIR/tamper.out"
! grep -Eq '^view |^publish ' "$TDIR/npm.log"
cp "$NETWORK_ORIGINAL" "$NETWORK"

# Wrong executor identity must stop before npm whoami or mutation.
: > "$TDIR/npm.log"
: > "$TDIR/published-bytes.log"
if OIS_AGENT_NAME=greg node "$PROTOCOL" "$TDIR/manifest.json" --dry-run >"$TDIR/seat.out" 2>&1; then
  echo "FAIL: wrong executor seat passed" >&2
  exit 1
fi
grep -q 'runtime executor agentName' "$TDIR/seat.out"
! grep -Eq '^whoami|^view |^publish ' "$TDIR/npm.log"

# Real npm (not the mock) must classify and consume a private `.tgz` alias to
# an inherited descriptor. Bare /proc/self/fd/3 is classified as a directory;
# the suffix-bearing private alias is the proven CLI adapter.
mkdir -p "$TDIR/real-pkg" "$TDIR/real-alias"
chmod 700 "$TDIR/real-alias"
printf '%s\n' '{"name":"ois-held-inode-smoke","version":"0.0.0-corrective2"}' > "$TDIR/real-pkg/package.json"
(
  cd "$TDIR/real-pkg"
  PATH="$REAL_PATH" "$REAL_NPM" pack --ignore-scripts --pack-destination "$TDIR" >/dev/null 2>&1
)
exec 3<"$TDIR/ois-held-inode-smoke-0.0.0-corrective2.tgz"
ln -s /proc/self/fd/3 "$TDIR/real-alias/artifact.tgz"
PATH="$REAL_PATH" "$REAL_NPM" publish "$TDIR/real-alias/artifact.tgz" --dry-run --ignore-scripts --tag latest \
  >"$TDIR/real-npm.out" 2>&1
exec 3<&-
grep -q 'ois-held-inode-smoke@0.0.0-corrective2' "$TDIR/real-npm.out"
grep -q 'dry-run' "$TDIR/real-npm.out"

echo "PASS: exact frozen-tgz protocol binds real npm to final verified held inodes"
