#!/usr/bin/env bash
# hubfix0-controlled-roll-wrapper.sh (v8) — FAIL-CLOSED execution wrapper for the ROLL script.
# Owns the raw trace (create-once), captures script+tee PIPESTATUS in ONE array read (V7-1),
# self-hashes itself (V7-2), gates evidence on valid hashes/JSON/terminal-reads (V7-3), and
# requires fresh watchtower-stopped coherence for success (V7-4). Run as terraform@ (operator).
set -uo pipefail
umask 077

ROLL_SCRIPT="${ROLL_SCRIPT:?path to the materialized roll script}"
SCRIPT_SHA256="${SCRIPT_SHA256:?approved content sha256 of ROLL_SCRIPT}"
SCRIPT_COMMIT="${SCRIPT_COMMIT:?git commit of the approved roll script}"
SCRIPT_BLOB="${SCRIPT_BLOB:?git blob sha of the approved roll script}"
SCRIPT_PATH="${SCRIPT_PATH:?repo path of the approved roll script}"
APPROVED_WRAPPER_SHA256="${APPROVED_WRAPPER_SHA256:?approved sha256 of THIS wrapper}"
WRAPPER_COMMIT="${WRAPPER_COMMIT:?git commit of THIS wrapper}"
WRAPPER_BLOB="${WRAPPER_BLOB:?git blob sha of THIS wrapper}"
WRAPPER_PATH="${WRAPPER_PATH:?repo path of THIS wrapper}"
TRACE_OUT="${TRACE_OUT:?create-once raw trace path}"
STATUS_OUT="${STATUS_OUT:?create-once terminal-status path (written by the roll script)}"
MANIFEST_OUT="${MANIFEST_OUT:?create-once wrapper manifest path}"
BUILD_RECEIPT_REF="${BUILD_RECEIPT_REF:?}"; BUILD_RECEIPT_SHA256="${BUILD_RECEIPT_SHA256:?}"
CRED_PROOF_REF="${CRED_PROOF_REF:?}"; CRED_PROOF_SHA256="${CRED_PROOF_SHA256:?}"
DECISION_REF="${DECISION_REF:?}"

h(){ sha256sum "$1" | cut -d' ' -f1; }
die(){ echo "[wrapper] ABORT: $*" >&2; exit 1; }
is_hex64(){ [[ "$1" =~ ^[0-9a-f]{64}$ ]]; }
command -v jq >/dev/null || die "jq missing"

# ── V7-2: wrapper self-hash BEFORE anything else ──
WSELF=$(h "${BASH_SOURCE[0]}"); [ "$WSELF" = "$APPROVED_WRAPPER_SHA256" ] || die "wrapper self-hash $WSELF != APPROVED_WRAPPER_SHA256 $APPROVED_WRAPPER_SHA256"

# ── distinct + create-once outputs ──
[ "$TRACE_OUT" != "$STATUS_OUT" ] && [ "$TRACE_OUT" != "$MANIFEST_OUT" ] && [ "$STATUS_OUT" != "$MANIFEST_OUT" ] || die "TRACE/STATUS/MANIFEST paths must differ"
[ ! -e "$TRACE_OUT" ]    || die "TRACE_OUT exists (not create-once): $TRACE_OUT"
[ ! -e "$STATUS_OUT" ]   || die "STATUS_OUT exists (not create-once): $STATUS_OUT"
[ ! -e "$MANIFEST_OUT" ] || die "MANIFEST_OUT exists (not create-once): $MANIFEST_OUT"
( set -o noclobber; : > "$TRACE_OUT" ) 2>/dev/null || die "TRACE_OUT create-once failed"

# ── verify roll bytes before running (roll also self-hashes) ──
[ -f "$ROLL_SCRIPT" ] || die "ROLL_SCRIPT not found: $ROLL_SCRIPT"
is_hex64 "$SCRIPT_SHA256" || die "SCRIPT_SHA256 not 64-hex"
GOT=$(h "$ROLL_SCRIPT"); [ "$GOT" = "$SCRIPT_SHA256" ] || die "ROLL_SCRIPT sha256 $GOT != approved $SCRIPT_SHA256"

# ── run with pipefail; capture the WHOLE PIPESTATUS in ONE assignment (V7-1) ──
set -o pipefail
APPROVED_SELF_SHA256="$SCRIPT_SHA256" STATUS_OUT="$STATUS_OUT" bash "$ROLL_SCRIPT" 2>&1 | tee -a "$TRACE_OUT"
pipeline_status=("${PIPESTATUS[@]}")
SCRIPT_RC=${pipeline_status[0]}; TEE_RC=${pipeline_status[1]}

# ── post-close hashes + status parse ──
TRACE_SHA=$(h "$TRACE_OUT")
STATUS_SHA=""; DISPOSITION="missing"; TERMINAL_READS_OK="unknown"; WT_STOPPED="unknown"; WT_RUNNING="unknown"; STATUS_JSON_OK=false
if [ -s "$STATUS_OUT" ] && jq -e . "$STATUS_OUT" >/dev/null 2>&1; then
  STATUS_JSON_OK=true
  STATUS_SHA=$(h "$STATUS_OUT")
  DISPOSITION=$(jq -r '.disposition // "invalid"' "$STATUS_OUT")
  TERMINAL_READS_OK=$(jq -r '.terminal_reads_ok // "unknown" | tostring' "$STATUS_OUT")
  WT_STOPPED=$(jq -r '.watchtower_stopped // "unknown"' "$STATUS_OUT")
  WT_RUNNING=$(jq -r '.watchtower_running // "unknown"' "$STATUS_OUT")
fi

# ── V7-3 evidence gate: valid 64-hex hashes + valid status JSON ──
EVIDENCE_OK=true
[ "$TEE_RC" -eq 0 ]    || { EVIDENCE_OK=false; echo "[wrapper] tee_rc=$TEE_RC -- trace capture failed" >&2; }
is_hex64 "$TRACE_SHA"  || { EVIDENCE_OK=false; echo "[wrapper] TRACE_SHA not 64-hex" >&2; }
$STATUS_JSON_OK        || { EVIDENCE_OK=false; echo "[wrapper] status missing/invalid-JSON" >&2; }
is_hex64 "$STATUS_SHA" || { EVIDENCE_OK=false; echo "[wrapper] STATUS_SHA not 64-hex" >&2; }

# ── V7-3/V7-4 success coherence: terminal reads ok + watchtower stopped AND not running ──
SUCCESS_COHERENT=false
[ "$TERMINAL_READS_OK" = "true" ] && [ "$WT_STOPPED" = "true" ] && [ "$WT_RUNNING" = "false" ] && SUCCESS_COHERENT=true

# ── THIRD manifest (create-once, out-of-band; binds BOTH artifacts — V7-2) ──
( set -o noclobber
  jq -n \
    --arg scommit "$SCRIPT_COMMIT" --arg spath "$SCRIPT_PATH" --arg sblob "$SCRIPT_BLOB" --arg ssha "$SCRIPT_SHA256" \
    --arg wcommit "$WRAPPER_COMMIT" --arg wpath "$WRAPPER_PATH" --arg wblob "$WRAPPER_BLOB" --arg wsha "$WSELF" \
    --argjson src "$SCRIPT_RC" --argjson tec "$TEE_RC" \
    --arg disp "$DISPOSITION" --arg tro "$TERMINAL_READS_OK" --arg wts "$WT_STOPPED" --arg wtr "$WT_RUNNING" \
    --argjson evok "$EVIDENCE_OK" --argjson scoh "$SUCCESS_COHERENT" \
    --arg tp "$TRACE_OUT" --arg tsha "$TRACE_SHA" --arg sp "$STATUS_OUT" --arg ssha2 "$STATUS_SHA" \
    --arg brr "$BUILD_RECEIPT_REF" --arg brs "$BUILD_RECEIPT_SHA256" \
    --arg cpr "$CRED_PROOF_REF" --arg cps "$CRED_PROOF_SHA256" --arg dr "$DECISION_REF" \
    '{node:"hubfix0-ROLL-wrapper",
      roll_script:{commit:$scommit,path:$spath,blob:$sblob,sha256:$ssha},
      wrapper:{commit:$wcommit,path:$wpath,blob:$wblob,sha256:$wsha},
      script_exit:$src, tee_exit:$tec, disposition:$disp, terminal_reads_ok:$tro,
      watchtower_stopped:$wts, watchtower_running:$wtr, evidence_ok:$evok, success_coherent:$scoh,
      trace:{path:$tp,sha256:$tsha}, status:{path:$sp,sha256:$ssha2},
      build_receipt:{ref:$brr,sha256:$brs}, cred_proof:{ref:$cpr,sha256:$cps}, decision_ref:$dr}' \
    > "$MANIFEST_OUT"
) 2>/dev/null || die "MANIFEST_OUT create-once/write failed -- EVIDENCE INCOMPLETE"
MANIFEST_SHA=$(h "$MANIFEST_OUT")
echo "[wrapper] manifest=$MANIFEST_OUT sha256=$MANIFEST_SHA script_rc=$SCRIPT_RC tee_rc=$TEE_RC disposition=$DISPOSITION evidence_ok=$EVIDENCE_OK success_coherent=$SUCCESS_COHERENT"
echo "[wrapper] PUBLISH as Hub completion evidence: trace=$TRACE_OUT($TRACE_SHA) status=$STATUS_OUT($STATUS_SHA) manifest=$MANIFEST_OUT($MANIFEST_SHA)"

# ── fail-closed exit: preserve roll semantics; force nonzero on any evidence/coherence gap ──
$EVIDENCE_OK || exit 40
case "${SCRIPT_RC}:${DISPOSITION}" in
  0:roll_success)      $SUCCESS_COHERENT && exit 0 || { echo "[wrapper] roll_success but incoherent (reads/watchtower)" >&2; exit 42; } ;;
  2:rollback_verified) $SUCCESS_COHERENT && exit 2 || { echo "[wrapper] rollback_verified but incoherent" >&2; exit 42; } ;;
  3:rollback_unproven) exit 3 ;;
  *) echo "[wrapper] non-success/incoherent rc=$SCRIPT_RC disp=$DISPOSITION" >&2; [ "$SCRIPT_RC" -ne 0 ] && exit "$SCRIPT_RC" || exit 41 ;;
esac
