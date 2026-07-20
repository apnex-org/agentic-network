#!/usr/bin/env bash
# hubfix0-controlled-roll-wrapper.test.sh — executable, no-GCP tests for the fail-closed wrapper (V7-1).
# Drives the wrapper with dummy ROLL scripts (exit 0/1/2/3, incoherent success, tee-failure, missing
# status) and asserts the exact wrapper exit + manifest presence. Run: bash <this> <path-to-wrapper.sh>
set -uo pipefail
WRAPPER="${1:?usage: test.sh <wrapper.sh>}"
[ -f "$WRAPPER" ] || { echo "wrapper not found: $WRAPPER"; exit 2; }
WSHA=$(sha256sum "$WRAPPER" | cut -d' ' -f1)
ROOT=$(mktemp -d); trap 'rm -rf "$ROOT"' EXIT
PASS=0; FAIL=0
DUMMYHEX=0000000000000000000000000000000000000000000000000000000000000000

run_case(){ # name exit disp ro wts wtr expect_wrapper_rc want_manifest [tee_fail]
  local name="$1" ex="$2" disp="$3" ro="$4" wts="$5" wtr="$6" expect="$7" wantman="$8" teefail="${9:-no}"
  local d; d=$(mktemp -d "$ROOT/XXXX")
  local status_json; status_json=$(jq -cn --arg dd "$disp" --argjson rr "$ro" --arg ss "$wts" --arg rn "$wtr" \
     '{node:"hubfix0-ROLL",disposition:$dd,terminal_reads_ok:$rr,watchtower_stopped:$ss,watchtower_running:$rn}')
  local dummy="$d/roll.sh"
  if [ "$disp" = "MISSING_STATUS" ]; then
    printf '#!/usr/bin/env bash\nexit %s\n' "$ex" > "$dummy"   # writes no status
  else
    printf '%s' "$status_json" > "$d/desired.json"
    printf '#!/usr/bin/env bash\ncp %q "$STATUS_OUT"\nexit %s\n' "$d/desired.json" "$ex" > "$dummy"
  fi
  local ssha; ssha=$(sha256sum "$dummy" | cut -d' ' -f1)
  local extra_path=""
  if [ "$teefail" = "tee_fail" ]; then
    mkdir -p "$d/fakebin"
    cat > "$d/fakebin/tee" <<'FAKE'
#!/usr/bin/env bash
out=""; while [ $# -gt 0 ]; do case "$1" in -a) shift;; *) out="$1"; shift;; esac; done
[ -n "$out" ] && cat >> "$out" 2>/dev/null || cat >/dev/null
exit 1
FAKE
    chmod +x "$d/fakebin/tee"; extra_path="$d/fakebin:"
  fi
  local rc
  PATH="${extra_path}$PATH" \
  ROLL_SCRIPT="$dummy" SCRIPT_SHA256="$ssha" SCRIPT_COMMIT=deadbeef SCRIPT_BLOB=beef SCRIPT_PATH=roll.sh \
  APPROVED_WRAPPER_SHA256="$WSHA" WRAPPER_COMMIT=cafe WRAPPER_BLOB=cafe WRAPPER_PATH=wrapper.sh \
  TRACE_OUT="$d/trace.log" STATUS_OUT="$d/status.json" MANIFEST_OUT="$d/manifest.json" \
  BUILD_RECEIPT_REF=br BUILD_RECEIPT_SHA256=$DUMMYHEX CRED_PROOF_REF=cr CRED_PROOF_SHA256=$DUMMYHEX DECISION_REF=dref \
  bash "$WRAPPER" >"$d/out.log" 2>&1
  rc=$?
  local ok=1
  [ "$rc" -eq "$expect" ] || { ok=0; echo "  [$name] wrapper_rc=$rc expected=$expect"; }
  if [ "$wantman" = "manifest" ]; then
    [ -s "$d/manifest.json" ] && jq -e . "$d/manifest.json" >/dev/null 2>&1 || { ok=0; echo "  [$name] manifest missing/invalid"; }
  fi
  if [ "$ok" = 1 ]; then PASS=$((PASS+1)); echo "  PASS $name (rc=$rc)"; else FAIL=$((FAIL+1)); echo "  FAIL $name"; sed 's/^/    | /' "$d/out.log"; fi
}

echo "== wrapper fail-closed tests =="
run_case exit0-success        0 roll_success      true  true  false 0  manifest
run_case exit2-rollback-ok    2 rollback_verified true  true  false 2  manifest
run_case exit3-rollback-unpr  3 rollback_unproven true  true  true  3  manifest
run_case exit1-preflight      1 preflight_or_fatal false false false 1  manifest
run_case incoherent-success   0 roll_success      false true  false 42 manifest
run_case wt-still-running     0 roll_success      true  true  true  42 manifest
run_case tee-failure          0 roll_success      true  true  false 40 manifest tee_fail
run_case missing-status       0 MISSING_STATUS    true  true  false 40 manifest

echo "== RESULT: PASS=$PASS FAIL=$FAIL =="
[ "$FAIL" -eq 0 ]
