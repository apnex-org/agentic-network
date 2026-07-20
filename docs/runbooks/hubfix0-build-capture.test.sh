#!/usr/bin/env bash
# hubfix0-build-capture.test.sh — semantic tests for the v7 ATTEMPT_ID fix (bug-309).
#
# Exercises the ACTUAL sibling hubfix0-build-capture.sh bytes via `bash -x` tracing.
# Every case aborts at an input/preflight guard BEFORE any GCP/docker call (a
# non-existent cred receipt => die 'cred receipt not found' at ~line 55, or a
# missing tool => die 'missing:' at ~line 52 — both strictly after the line-47
# ATTEMPT_ID regex and strictly before the AR/liveness probe), so the test never
# builds or touches a registry.
#
# Asserts:
#   T1 a VALID ATTEMPT_ID is preserved BYTE-FOR-BYTE (no v6 trailing `}`) and passes line-47
#   T2 UNSET ATTEMPT_ID fails at the line-23 `${...:?}` guard (never reaches line 47)
#   T3 EMPTY ATTEMPT_ID fails at the line-23 `${...:?}` guard
#   T4 an INVALID-shape ATTEMPT_ID fails at the (unchanged) line-47 regex
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUT="$HERE/hubfix0-build-capture.sh"
[[ -f "$SUT" ]] || { echo "SUT not found: $SUT"; exit 2; }
SELF_SHA="$(sha256sum "$SUT" | cut -d' ' -f1)"   # so the SUT's line-43 self-hash guard passes
PIN=0000000000000000000000000000000000000000     # shape-valid 40-hex; never built (every run aborts pre-build)
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
ok(){ echo "  PASS: $1"; pass=$((pass+1)); }
no(){ echo "  FAIL: $1"; fail=$((fail+1)); }

# Run the SUT under `bash -x` with a full otherwise-valid env; $1 selects the ATTEMPT_ID mode.
run(){
  local mode="$1"; local -a e=(
    HOME="$TMP" CLOUDSDK_CONFIG="$TMP"
    PINNED_SHA="$PIN" APPROVED_SELF_SHA="$SELF_SHA"
    CRED_PREFLIGHT_RECEIPT="$TMP/nonexistent-receipt.json" CRED_PREFLIGHT_SHA=deadbeef CRED_PREFLIGHT_REF=x
    RECEIPT_OUT="$TMP/receipt-$1.json" EVIDENCE_DIR="$TMP/evidence-$1" )
  case "$mode" in
    unset) : ;;
    empty) e+=(ATTEMPT_ID=) ;;
    *)     e+=(ATTEMPT_ID="$mode") ;;
  esac
  env -u ATTEMPT_ID "${e[@]}" bash -x "$SUT" 2>&1   # -u makes the unset case hermetic (drops any inherited ATTEMPT_ID; set cases re-add it)
}

echo "SUT: $SUT"
echo "SUT sha256: $SELF_SHA"
echo

# T1 — valid value uses every allowed special char (. _ -) adjacent to the old brace site.
V="a.b_c-1"
tr="$(run "$V")"
if grep -qE "^\+ ATTEMPT_ID='?a\.b_c-1'?\$" <<<"$tr" && ! grep -qF "ABORT: ATTEMPT_ID shape" <<<"$tr"; then
  ok "T1 valid ATTEMPT_ID '$V' preserved byte-for-byte (no trailing '}') + passes line-47"
else
  no "T1 valid ATTEMPT_ID '$V'"; grep -E "ATTEMPT_ID(=|:)" <<<"$tr" | head -3
fi

# T2 — unset: the line-23 :? guard must fire (and it must NOT reach the line-47 regex).
tr="$(run unset)"; rc=$?
if grep -qF "ATTEMPT_ID: unique attempt id, 1-64 chars A-Za-z0-9._-" <<<"$tr" \
   && ! grep -qF "ABORT: ATTEMPT_ID shape" <<<"$tr" && [[ $rc -ne 0 ]]; then
  ok "T2 unset ATTEMPT_ID fails at line-23 :? guard (rc=$rc, never reaches regex)"
else
  no "T2 unset ATTEMPT_ID (rc=$rc)"; grep -iE "ATTEMPT_ID" <<<"$tr" | head -3
fi

# T3 — empty: :? fires on empty too.
tr="$(run empty)"; rc=$?
if grep -qF "ATTEMPT_ID: unique attempt id, 1-64 chars A-Za-z0-9._-" <<<"$tr" && [[ $rc -ne 0 ]]; then
  ok "T3 empty ATTEMPT_ID fails at line-23 :? guard (rc=$rc)"
else
  no "T3 empty ATTEMPT_ID (rc=$rc)"; grep -iE "ATTEMPT_ID" <<<"$tr" | head -3
fi

# T4 — invalid shape: the value assigns cleanly, then the unchanged line-47 regex rejects it.
V="bad}brace"
tr="$(run "$V")"; rc=$?
if grep -qF "ABORT: ATTEMPT_ID shape" <<<"$tr" && [[ $rc -ne 0 ]]; then
  ok "T4 invalid-shape ATTEMPT_ID '$V' rejected at line-47 regex (rc=$rc)"
else
  no "T4 invalid-shape ATTEMPT_ID '$V' (rc=$rc)"; grep -iE "ATTEMPT_ID" <<<"$tr" | head -3
fi

echo
echo "RESULT: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
