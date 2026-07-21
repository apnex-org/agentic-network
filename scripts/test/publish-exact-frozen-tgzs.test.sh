#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROTOCOL="$REPO/scripts/release/publish-exact-frozen-tgzs.mjs"
REAL_NPM="$(command -v npm)"
REAL_NPM_ROOT="$(npm root --global)"
REAL_NPM_VERSION="$($REAL_NPM --version)"
REAL_LIBNPMPUBLISH_VERSION="$(node -p "require('$REAL_NPM_ROOT/npm/node_modules/libnpmpublish/package.json').version")"
REAL_PATH="$PATH"
TDIR="$(mktemp -d)"
REGISTRY_PID=""
cleanup() {
  if [[ -n "$REGISTRY_PID" ]]; then kill "$REGISTRY_PID" 2>/dev/null || true; fi
  rm -rf "$TDIR"
}
trap cleanup EXIT
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
  --version) printf '%s\n' "$REAL_NPM_VERSION" ;;
  whoami) printf '%s\n' 'apnex-lily' ;;
  root)
    [[ "${2:-}" == "--global" ]]
    if [[ -n "${SWAP_ON_ROOT_TARGET:-}" ]]; then
      replace_path_once "$SWAP_ON_ROOT_TARGET" "$SWAP_REPLACEMENT" "$SWAP_MARKER"
    fi
    printf '%s\n' "$REAL_NPM_ROOT"
    ;;
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
  --arg npmCliVersion "$REAL_NPM_VERSION" --arg libnpmpublishVersion "$REAL_LIBNPMPUBLISH_VERSION" \
  --argjson a1 "$A1" --argjson a2 "$A2" --argjson a3 "$A3" \
  '{protocolVersion:2,npmCliVersion:$npmCliVersion,libnpmpublishVersion:$libnpmpublishVersion,executor:{agentName:"lily",role:"architect",npmIdentity:"apnex-lily"},statePath:$statePath,source:{commit:$commit,tree:$tree},artifacts:[$a1,$a2,$a3]}' \
  > "$TDIR/manifest.json"

export PATH="$TDIR/bin:$PATH" NPM_MOCK_LOG="$TDIR/npm.log" NPM_MOCK_PUBLISH_BYTES_LOG="$TDIR/published-bytes.log"
export OIS_AGENT_NAME=lily OIS_HUB_ROLE=architect MOCK_GIT_HEAD="$GIT_HEAD" REAL_NPM_ROOT REAL_NPM_VERSION A1_INTEGRITY A2_INTEGRITY A3_INTEGRITY
A1_INTEGRITY="$(jq -r .integrity <<<"$A1")"
A2_INTEGRITY="$(jq -r .integrity <<<"$A2")"
A3_INTEGRITY="$(jq -r .integrity <<<"$A3")"

# Corrective2 protocol-v1 manifests cannot be replayed through the alias-free
# successor, even in dry-run mode.
jq --arg statePath "$TDIR/v1-state.json" '.protocolVersion=1 | .statePath=$statePath' \
  "$TDIR/manifest.json" > "$TDIR/v1-manifest.json"
: > "$TDIR/npm.log"
if node "$PROTOCOL" "$TDIR/v1-manifest.json" --dry-run >"$TDIR/v1.out" 2>&1; then
  echo "FAIL: corrective2 protocol-v1 manifest passed corrective3" >&2
  exit 1
fi
grep -q 'manifest protocolVersion: expected 2, got 1' "$TDIR/v1.out"
[[ ! -s "$TDIR/npm.log" ]]

: > "$TDIR/npm.log"
: > "$TDIR/published-bytes.log"
node "$PROTOCOL" "$TDIR/manifest.json" --dry-run

[[ "$(jq -r .status "$TDIR/state.json")" == "dry-run-complete" ]]
[[ "$(jq -r .npmConsumer.transport "$TDIR/state.json")" == "npm-programmatic-tarball-buffer" ]]
[[ "$(jq -r .npmConsumer.npmVersion "$TDIR/state.json")" == "$REAL_NPM_VERSION" ]]
[[ "$(jq -r .npmConsumer.libnpmpublishVersion "$TDIR/state.json")" == "$REAL_LIBNPMPUBLISH_VERSION" ]]
[[ "$(jq -r '.steps[0].consumerSha256' "$TDIR/state.json")" == "$(jq -r .sha256 <<<"$A1")" ]]
[[ "$(jq -r '.steps[1].consumerSha256' "$TDIR/state.json")" == "$ORIGINAL_NETWORK_SHA" ]]
[[ "$(jq -r '.steps[2].consumerSha256' "$TDIR/state.json")" == "$(jq -r .sha256 <<<"$A3")" ]]
! grep -Eq '^publish |unpublish|deprecate|dist-tag' "$TDIR/npm.log"
! grep -Eq 'symlinkSync|/proc/self/fd|npmPath|inheritedFd' "$PROTOCOL"

# Recovery accepts only an exact already-published prefix and resumes at the first vacancy.
: > "$TDIR/npm.log"
: > "$TDIR/published-bytes.log"
MOCK_PREFIX=1 node "$PROTOCOL" "$TDIR/manifest.json" --dry-run --recover
[[ "$(jq -r '.steps[0].status' "$TDIR/state.json")" == "verified-existing" ]]
[[ "$(jq -r '.steps[1].consumerSha256' "$TDIR/state.json")" == "$ORIGINAL_NETWORK_SHA" ]]
[[ "$(jq -r '.steps[2].consumerSha256' "$TDIR/state.json")" == "$(jq -r .sha256 <<<"$A3")" ]]
! grep -Eq '^publish ' "$TDIR/npm.log"

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

# Greg's exact remaining falsifier is now structurally absent: after every
# artifact has been finally opened and copied, an attacker replaces the source
# pathname at the old pre-spawn boundary. The consumer receives no path at all;
# its programmatic npm Buffer remains the original verified bytes.
: > "$TDIR/npm.log"
: > "$TDIR/published-bytes.log"
rm -f "$TDIR/swap-on-root.marker"
SWAP_ON_ROOT_TARGET="$NETWORK" SWAP_REPLACEMENT="$NETWORK_ALT" SWAP_MARKER="$TDIR/swap-on-root.marker" \
  node "$PROTOCOL" "$TDIR/manifest.json" --dry-run
[[ "$(jq -r .status "$TDIR/state.json")" == "dry-run-complete" ]]
[[ "$(sha256sum "$NETWORK" | awk '{print $1}')" == "$ALTERNATE_NETWORK_SHA" ]]
[[ "$(jq -r '.steps[1].consumerSha256' "$TDIR/state.json")" == "$ORIGINAL_NETWORK_SHA" ]]
[[ "$(jq -r '.steps[1].consumerTransport' "$TDIR/state.json")" == "npm-programmatic-tarball-buffer" ]]
! grep -Eq '^publish |ois-held-inode|/proc/self/fd' "$TDIR/npm.log"
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

# Real npm's bundled libnpmpublish must receive the exact verified Buffers.
# A disposable loopback registry captures each PUT attachment. On the first
# PUT it also replaces the next artifact's manifest pathname, reproducing the
# same-UID attacker during the mutation window without touching npmjs.org.
cat > "$TDIR/local-registry.cjs" <<'SERVER'
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const [readyPath, capturePath, swapTarget, swapReplacement] = process.argv.slice(2)
let swapped = false
const captures = []
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/-/whoami') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ username: 'apnex-lily' }))
  }
  if (req.method === 'GET') {
    res.writeHead(404, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ error: 'not_found', reason: 'document not found' }))
  }
  if (req.method !== 'PUT') {
    res.writeHead(405)
    return res.end()
  }
  if (!swapped) {
    fs.copyFileSync(swapReplacement, `${swapTarget}.swap`)
    fs.renameSync(`${swapTarget}.swap`, swapTarget)
    swapped = true
  }
  const chunks = []
  req.on('data', chunk => chunks.push(chunk))
  req.on('end', () => {
    const metadata = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const attachment = Object.values(metadata._attachments)[0]
    const bytes = Buffer.from(attachment.data, 'base64')
    captures.push({
      name: metadata.name,
      version: Object.keys(metadata.versions)[0],
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      authorization: req.headers.authorization,
    })
    fs.writeFileSync(capturePath, `${JSON.stringify(captures, null, 2)}\n`)
    res.writeHead(201, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })
})
server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(readyPath, String(server.address().port))
})
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
SERVER

rm -f "$TDIR/registry.port" "$TDIR/registry-captures.json"
PATH="$REAL_PATH" node "$TDIR/local-registry.cjs" \
  "$TDIR/registry.port" "$TDIR/registry-captures.json" "$NETWORK" "$NETWORK_ALT" &
REGISTRY_PID=$!
for _ in $(seq 1 100); do
  [[ -s "$TDIR/registry.port" ]] && break
  sleep 0.05
done
[[ -s "$TDIR/registry.port" ]]
REGISTRY_PORT="$(cat "$TDIR/registry.port")"
cat > "$TDIR/local.npmrc" <<NPMRC
registry=http://127.0.0.1:$REGISTRY_PORT/
//127.0.0.1:$REGISTRY_PORT/:_authToken=test-token
audit=false
fund=false
update-notifier=false
NPMRC
jq --arg statePath "$TDIR/real-state.json" '.statePath=$statePath' "$TDIR/manifest.json" > "$TDIR/real-manifest.json"
cp "$NETWORK_ORIGINAL" "$NETWORK"
PATH="$REAL_PATH" NPM_CONFIG_USERCONFIG="$TDIR/local.npmrc" \
  node "$PROTOCOL" "$TDIR/real-manifest.json" >"$TDIR/real-programmatic.out" 2>&1
kill "$REGISTRY_PID"
wait "$REGISTRY_PID" || true
REGISTRY_PID=""
[[ "$(jq -r .status "$TDIR/real-state.json")" == "published-complete" ]]
[[ "$(sha256sum "$NETWORK" | awk '{print $1}')" == "$ALTERNATE_NETWORK_SHA" ]]
[[ "$(jq -r '.[0].name' "$TDIR/registry-captures.json")" == "@apnex/cognitive-layer" ]]
[[ "$(jq -r '.[1].name' "$TDIR/registry-captures.json")" == "@apnex/network-adapter" ]]
[[ "$(jq -r '.[2].name' "$TDIR/registry-captures.json")" == "@apnex/claude-plugin" ]]
[[ "$(jq -r '.[0].sha256' "$TDIR/registry-captures.json")" == "$(jq -r .sha256 <<<"$A1")" ]]
[[ "$(jq -r '.[1].sha256' "$TDIR/registry-captures.json")" == "$ORIGINAL_NETWORK_SHA" ]]
[[ "$(jq -r '.[1].sha256' "$TDIR/registry-captures.json")" != "$ALTERNATE_NETWORK_SHA" ]]
[[ "$(jq -r '.[2].sha256' "$TDIR/registry-captures.json")" == "$(jq -r .sha256 <<<"$A3")" ]]
[[ "$(jq -r 'all(.authorization == "Bearer test-token")' "$TDIR/registry-captures.json")" == "true" ]]

echo "PASS: exact frozen-tgz protocol binds real npm to verified in-memory bytes without a consumer pathname"
