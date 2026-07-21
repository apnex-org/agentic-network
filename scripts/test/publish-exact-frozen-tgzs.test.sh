#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROTOCOL="$REPO/scripts/release/publish-exact-frozen-tgzs.mjs"
REAL_NPM="$(command -v npm)"
REAL_NPM_ROOT="$(npm root --global)"
REAL_NPM_VERSION="$($REAL_NPM --version)"
REAL_LIBNPMPUBLISH_VERSION="$(node -p "require('$REAL_NPM_ROOT/npm/node_modules/libnpmpublish/package.json').version")"
TDIR="$(mktemp -d)"
PIDS=()
cleanup() {
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$TDIR"
}
trap cleanup EXIT
mkdir -p "$TDIR/bin" "$TDIR/frozen" "$TDIR/build/package/dist"

cat > "$TDIR/bin/npm" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$NPM_MOCK_LOG"
replace_once() {
  local target="$1" replacement="$2" marker="$3"
  if [[ ! -e "$marker" ]]; then
    cp "$replacement" "$target.swap.$$"
    mv -f "$target.swap.$$" "$target"
    : > "$marker"
  fi
}
case "${1:-}" in
  --version) printf '%s\n' "$REAL_NPM_VERSION" ;;
  root)
    [[ "${2:-}" == "--global" ]]
    if [[ -n "${SWAP_ON_ROOT_TARGET:-}" ]]; then
      replace_once "$SWAP_ON_ROOT_TARGET" "$SWAP_REPLACEMENT" "$SWAP_MARKER"
    fi
    printf '%s\n' "$REAL_NPM_ROOT"
    ;;
  *) printf 'unexpected npm command: %s\n' "$*" >&2; exit 9 ;;
esac
MOCK
chmod +x "$TDIR/bin/npm"

make_tgz() {
  local output="$1" name="$2" version="$3" git_head="$4" dependencies="$5" extra="${6:-}"
  rm -rf "$TDIR/build/package"
  mkdir -p "$TDIR/build/package/dist"
  jq -n --arg name "$name" --arg version "$version" --arg gitHead "$git_head" --argjson dependencies "$dependencies" \
    '{name:$name,version:$version,gitHead:$gitHead,dependencies:$dependencies}' > "$TDIR/build/package/package.json"
  jq -n --arg commitSha "$git_head" '{commitSha:$commitSha,dirty:false,buildTime:"2026-07-21T00:00:00.000Z",branch:"detached"}' \
    > "$TDIR/build/package/dist/build-info.json"
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
make_tgz "$NETWORK_ALT" @apnex/network-adapter 0.1.14 "$GIT_HEAD" '{"@apnex/cognitive-layer":"0.1.4","@apnex/message-router":"0.1.3"}' different
ORIGINAL_NETWORK_SHA="$(sha256sum "$NETWORK_ORIGINAL" | awk '{print $1}')"
ALTERNATE_NETWORK_SHA="$(sha256sum "$NETWORK_ALT" | awk '{print $1}')"
[[ "$ORIGINAL_NETWORK_SHA" != "$ALTERNATE_NETWORK_SHA" ]]

artifact_json() {
  local path="$1" name="$2" version="$3"
  jq -n --arg name "$name" --arg version "$version" --arg path "$path" \
    --arg sha256 "$(sha256sum "$path" | awk '{print $1}')" \
    --arg integrity "sha512-$(openssl dgst -sha512 -binary "$path" | openssl base64 -A)" \
    --arg gitHead "$GIT_HEAD" \
    '{name:$name,version:$version,path:$path,sha256:$sha256,integrity:$integrity,gitHead:$gitHead}'
}
A1="$(artifact_json "$COGNITIVE" @apnex/cognitive-layer 0.1.4)"
A2="$(artifact_json "$NETWORK" @apnex/network-adapter 0.1.14)"
A3="$(artifact_json "$CLAUDE" @apnex/claude-plugin 0.1.16)"

cat > "$TDIR/registry.cjs" <<'SERVER'
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const [readyPath, capturePath, controlPath] = process.argv.slice(2)
let swappedGet = false
let swappedPut = false
const captures = []
const write = () => fs.writeFileSync(capturePath, `${JSON.stringify(captures, null, 2)}\n`)
const control = () => JSON.parse(fs.readFileSync(controlPath, 'utf8'))
const swap = (cfg) => {
  fs.copyFileSync(cfg.swapReplacement, `${cfg.swapTarget}.swap`)
  fs.renameSync(`${cfg.swapTarget}.swap`, cfg.swapTarget)
}
const server = http.createServer((req, res) => {
  const cfg = control()
  if (req.method === 'GET' && req.url === '/-/whoami') {
    res.writeHead(200, {'content-type':'application/json'})
    return res.end(JSON.stringify({username:'apnex-lily'}))
  }
  if (req.method === 'GET') {
    if (cfg.swapOnPackageGet && !swappedGet) { swap(cfg); swappedGet = true }
    const decoded = decodeURIComponent(req.url.slice(1)).replace(/%2f/ig, '/')
    const index = cfg.artifacts.findIndex(a => a.name === decoded)
    if (index < 0 || index >= (cfg.prefix || 0)) {
      res.writeHead(404, {'content-type':'application/json'})
      return res.end(JSON.stringify({error:'not_found'}))
    }
    const a = cfg.artifacts[index]
    const body = {name:a.name,'dist-tags':{latest:a.version},versions:{}}
    body.versions[a.version] = {name:a.name,version:a.version,gitHead:a.gitHead,dist:{integrity:a.integrity,tarball:`http://127.0.0.1:${server.address().port}/unused.tgz`}}
    res.writeHead(200, {'content-type':'application/json'})
    return res.end(JSON.stringify(body))
  }
  if (req.method !== 'PUT') { res.writeHead(405); return res.end() }
  if (cfg.swapOnFirstPut && !swappedPut) { swap(cfg); swappedPut = true }
  const chunks=[]
  req.on('data', c => chunks.push(c))
  req.on('end', () => {
    const metadata=JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const attachment=Object.values(metadata._attachments)[0]
    const bytes=Buffer.from(attachment.data,'base64')
    captures.push({name:metadata.name,version:Object.keys(metadata.versions)[0],sha256:crypto.createHash('sha256').update(bytes).digest('hex'),authorization:req.headers.authorization})
    write()
    res.writeHead(201, {'content-type':'application/json'})
    res.end(JSON.stringify({ok:true}))
  })
})
server.listen(0,'127.0.0.1',()=>{ fs.writeFileSync(readyPath,String(server.address().port)); write() })
for (const sig of ['SIGTERM','SIGINT']) process.on(sig,()=>server.close(()=>process.exit(0)))
SERVER

BASE_CONTROL="$(jq -n --argjson a1 "$A1" --argjson a2 "$A2" --argjson a3 "$A3" '{prefix:0,artifacts:[$a1,$a2,$a3]}')"
start_registry() {
  local id="$1"
  printf '%s\n' "$BASE_CONTROL" > "$TDIR/$id-control.json"
  node "$TDIR/registry.cjs" "$TDIR/$id.port" "$TDIR/$id-captures.json" "$TDIR/$id-control.json" &
  PIDS+=("$!")
  for _ in $(seq 1 100); do [[ -s "$TDIR/$id.port" ]] && break; sleep 0.05; done
  [[ -s "$TDIR/$id.port" ]]
}
start_registry r1
start_registry r2
R1="http://127.0.0.1:$(cat "$TDIR/r1.port")/"
R2="http://127.0.0.1:$(cat "$TDIR/r2.port")/"
write_npmrc() {
  local path="$1" registry="$2" token="$3" host
  host="${registry#http://}"; host="${host%/}"
  cat > "$path" <<NPMRC
registry=$registry
//$host/:_authToken=$token
audit=false
fund=false
update-notifier=false
NPMRC
}
write_npmrc "$TDIR/r1.npmrc" "$R1" r1-token
write_npmrc "$TDIR/r2.npmrc" "$R2" r2-token
cp "$TDIR/r1.npmrc" "$TDIR/active.npmrc"

jq -n --arg statePath "$TDIR/state.json" --arg commit "$GIT_HEAD" --arg tree "$TREE" --arg registry "$R1" \
  --arg npmCliVersion "$REAL_NPM_VERSION" --arg libnpmpublishVersion "$REAL_LIBNPMPUBLISH_VERSION" \
  --argjson a1 "$A1" --argjson a2 "$A2" --argjson a3 "$A3" \
  '{protocolVersion:3,registry:$registry,npmCliVersion:$npmCliVersion,libnpmpublishVersion:$libnpmpublishVersion,executor:{agentName:"lily",role:"architect",npmIdentity:"apnex-lily"},statePath:$statePath,source:{commit:$commit,tree:$tree},artifacts:[$a1,$a2,$a3]}' > "$TDIR/manifest.json"

export PATH="$TDIR/bin:$PATH" NPM_MOCK_LOG="$TDIR/npm.log" OIS_AGENT_NAME=lily OIS_HUB_ROLE=architect
export REAL_NPM_ROOT REAL_NPM_VERSION NPM_CONFIG_USERCONFIG="$TDIR/active.npmrc"

# Older manifests cannot cross the registry-snapshot successor boundary.
jq --arg statePath "$TDIR/v2-state.json" '.protocolVersion=2 | .statePath=$statePath' "$TDIR/manifest.json" > "$TDIR/v2.json"
: > "$TDIR/npm.log"
if node "$PROTOCOL" "$TDIR/v2.json" --dry-run >"$TDIR/v2.out" 2>&1; then echo 'FAIL: v2 passed' >&2; exit 1; fi
grep -q 'manifest protocolVersion: expected 3, got 2' "$TDIR/v2.out"
[[ ! -s "$TDIR/npm.log" ]]

# Packed runtime provenance is load-bearing: dirty build-info fails before the
# first identity/vacancy read even when tgz hashes and full gitHead agree.
mkdir -p "$TDIR/dirty-unpack"
tar -C "$TDIR/dirty-unpack" -xzf "$NETWORK_ORIGINAL"
jq '.dirty=true' "$TDIR/dirty-unpack/package/dist/build-info.json" > "$TDIR/dirty-unpack/build-info.tmp"
mv "$TDIR/dirty-unpack/build-info.tmp" "$TDIR/dirty-unpack/package/dist/build-info.json"
tar -C "$TDIR/dirty-unpack" -czf "$TDIR/network-dirty.tgz" package
DIRTY_A2="$(artifact_json "$TDIR/network-dirty.tgz" @apnex/network-adapter 0.1.14)"
jq --arg statePath "$TDIR/dirty-state.json" --argjson a2 "$DIRTY_A2" '.statePath=$statePath | .artifacts[1]=$a2' "$TDIR/manifest.json" > "$TDIR/dirty-manifest.json"
if node "$PROTOCOL" "$TDIR/dirty-manifest.json" --dry-run >"$TDIR/dirty.out" 2>&1; then echo 'FAIL: dirty runtime provenance passed' >&2; exit 1; fi
grep -q 'initial preflight build-info dirty: expected false, got true' "$TDIR/dirty.out"
[[ "$(jq length "$TDIR/r1-captures.json")" == 0 ]]

# Full dry run binds one registry/config snapshot and clean full-SHA build-info.
printf '%s\n' "$BASE_CONTROL" > "$TDIR/r1-control.json"
node "$PROTOCOL" "$TDIR/manifest.json" --dry-run
[[ "$(jq -r .status "$TDIR/state.json")" == dry-run-complete ]]
[[ "$(jq -r .registry "$TDIR/state.json")" == "$R1" ]]
[[ "$(jq -r .npmConsumer.registry "$TDIR/state.json")" == "$R1" ]]
[[ "$(jq -r .npmConsumer.configSnapshot "$TDIR/state.json")" == single-frozen-flat-options ]]
[[ "$(jq -r '.steps[1].consumerSha256' "$TDIR/state.json")" == "$ORIGINAL_NETWORK_SHA" ]]
[[ "$(jq length "$TDIR/r1-captures.json")" == 0 ]]
! grep -Eq 'symlinkSync|/proc/self/fd|npmPath|inheritedFd|npm publish' "$PROTOCOL"

# Recovery accepts only an exact prefix, then rejects an integrity mismatch.
jq '.prefix=1' <<<"$BASE_CONTROL" > "$TDIR/r1-control.json"
node "$PROTOCOL" "$TDIR/manifest.json" --dry-run --recover
[[ "$(jq -r '.steps[0].status' "$TDIR/state.json")" == verified-existing ]]
jq '.prefix=1 | .artifacts[0].integrity="sha512-wrong"' <<<"$BASE_CONTROL" > "$TDIR/r1-control.json"
if node "$PROTOCOL" "$TDIR/manifest.json" --dry-run --recover >"$TDIR/recover.out" 2>&1; then echo 'FAIL: bad recovery passed' >&2; exit 1; fi
grep -q 'registry integrity' "$TDIR/recover.out"

# A valid replacement after initial artifact audit is caught at final open.
cp "$NETWORK_ORIGINAL" "$NETWORK"
jq --arg target "$NETWORK" --arg replacement "$NETWORK_ALT" '.prefix=0|.swapOnPackageGet=true|.swapTarget=$target|.swapReplacement=$replacement' <<<"$BASE_CONTROL" > "$TDIR/r1-control.json"
if node "$PROTOCOL" "$TDIR/manifest.json" --dry-run >"$TDIR/post-audit.out" 2>&1; then echo 'FAIL: post-audit swap passed' >&2; exit 1; fi
grep -q 'final held-inode use boundary SHA-256' "$TDIR/post-audit.out"
cp "$NETWORK_ORIGINAL" "$NETWORK"
# Restart behavior is per server process; clear swap field and use R2 for remaining vacancy tests.
jq '.registry=$registry' --arg registry "$R2" "$TDIR/manifest.json" > "$TDIR/r2-manifest.json"
cp "$TDIR/r2.npmrc" "$TDIR/active.npmrc"

# Tamper and wrong seat fail before identity/vacancy/publication.
printf 'tamper' >> "$NETWORK"
if node "$PROTOCOL" "$TDIR/r2-manifest.json" --dry-run >"$TDIR/tamper.out" 2>&1; then echo 'FAIL: tamper passed' >&2; exit 1; fi
grep -q 'initial preflight SHA-256' "$TDIR/tamper.out"
cp "$NETWORK_ORIGINAL" "$NETWORK"
if OIS_AGENT_NAME=greg node "$PROTOCOL" "$TDIR/r2-manifest.json" --dry-run >"$TDIR/seat.out" 2>&1; then echo 'FAIL: wrong seat passed' >&2; exit 1; fi
grep -q 'runtime executor agentName' "$TDIR/seat.out"

# R1→R2 config replacement at npm-root/load cannot redirect mutation: manifest
# binds R1, loaded snapshot sees R2, protocol fails before any PUT; R2 gets zero.
cp "$TDIR/r1.npmrc" "$TDIR/active.npmrc"
rm -f "$TDIR/config-swap.marker"
if SWAP_ON_ROOT_TARGET="$TDIR/active.npmrc" SWAP_REPLACEMENT="$TDIR/r2.npmrc" SWAP_MARKER="$TDIR/config-swap.marker" \
  node "$PROTOCOL" "$TDIR/manifest.json" >"$TDIR/config-swap.out" 2>&1; then echo 'FAIL: registry drift published' >&2; exit 1; fi
grep -q 'loaded npm config target registry' "$TDIR/config-swap.out"
[[ "$(jq length "$TDIR/r2-captures.json")" == 0 ]]

# Real npm/libnpmpublish receives exact held Buffers. R2 swaps the network source
# pathname during the first PUT; captured network bytes remain the original.
cp "$TDIR/r2.npmrc" "$TDIR/active.npmrc"
cp "$NETWORK_ORIGINAL" "$NETWORK"
jq --arg target "$NETWORK" --arg replacement "$NETWORK_ALT" '.prefix=0|.swapOnFirstPut=true|.swapTarget=$target|.swapReplacement=$replacement' <<<"$BASE_CONTROL" > "$TDIR/r2-control.json"
jq --arg statePath "$TDIR/live-state.json" '.statePath=$statePath' "$TDIR/r2-manifest.json" > "$TDIR/live-manifest.json"
node "$PROTOCOL" "$TDIR/live-manifest.json"
[[ "$(jq -r .status "$TDIR/live-state.json")" == published-complete ]]
[[ "$(sha256sum "$NETWORK" | awk '{print $1}')" == "$ALTERNATE_NETWORK_SHA" ]]
[[ "$(jq length "$TDIR/r2-captures.json")" == 3 ]]
[[ "$(jq -r '.[0].name' "$TDIR/r2-captures.json")" == @apnex/cognitive-layer ]]
[[ "$(jq -r '.[1].sha256' "$TDIR/r2-captures.json")" == "$ORIGINAL_NETWORK_SHA" ]]
[[ "$(jq -r '.[1].sha256' "$TDIR/r2-captures.json")" != "$ALTERNATE_NETWORK_SHA" ]]
[[ "$(jq -r 'all(.authorization == "Bearer r2-token")' "$TDIR/r2-captures.json")" == true ]]

echo 'PASS: exact frozen-tgz protocol binds one registry/config snapshot, clean full-SHA provenance, and alias-free Buffers'
