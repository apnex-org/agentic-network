#!/usr/bin/env bash
# hubfix0-controlled-roll-wrapper.sh — FAIL-CLOSED execution wrapper for the ROLL script (V6-1/2/3).
# Owns the raw trace (create-once), captures script+tee PIPESTATUS, and emits a post-close THIRD
# manifest binding trace/status hashes. Exit preserves the roll disposition (0/2/3) and fails closed
# on any evidence gap. Run as terraform@ (operator). The caller exports the ROLL params (NEW_DIGEST,
# EXPECTED_SHA, EXPECTED_BUILT_AT, EXPECTED_BUILD_INFO_SHA256, BUILD_RECEIPT_*, CRED_PROOF_*, DECISION_REF)
# into the environment; they are inherited by the roll script.
set -uo pipefail
umask 077

ROLL_SCRIPT="${ROLL_SCRIPT:?path to the materialized roll script (git show <commit>:<path> > tmp)}"
SCRIPT_SHA256="${SCRIPT_SHA256:?approved content sha256 of ROLL_SCRIPT}"
SCRIPT_COMMIT="${SCRIPT_COMMIT:?git commit of the approved roll script}"
SCRIPT_BLOB="${SCRIPT_BLOB:?git blob sha of the approved roll script}"
SCRIPT_PATH="${SCRIPT_PATH:?repo path of the approved roll script}"
TRACE_OUT="${TRACE_OUT:?create-once raw trace path}"
STATUS_OUT="${STATUS_OUT:?create-once terminal-status path (written by the roll script)}"
MANIFEST_OUT="${MANIFEST_OUT:?create-once wrapper manifest path}"
BUILD_RECEIPT_REF="${BUILD_RECEIPT_REF:?}"; BUILD_RECEIPT_SHA256="${BUILD_RECEIPT_SHA256:?}"
CRED_PROOF_REF="${CRED_PROOF_REF:?}"; CRED_PROOF_SHA256="${CRED_PROOF_SHA256:?}"
DECISION_REF="${DECISION_REF:?}"

h(){ sha256sum "$1" | cut -d' ' -f1; }
die(){ echo "[wrapper] ABORT: $*" >&2; exit 1; }
command -v jq >/dev/null || die "jq missing"

# ── distinct + create-once outputs (V6-2) ──
[ "$TRACE_OUT" != "$STATUS_OUT" ] && [ "$TRACE_OUT" != "$MANIFEST_OUT" ] && [ "$STATUS_OUT" != "$MANIFEST_OUT" ] || die "TRACE/STATUS/MANIFEST paths must differ"
[ ! -e "$TRACE_OUT" ]    || die "TRACE_OUT exists (not create-once): $TRACE_OUT"
[ ! -e "$STATUS_OUT" ]   || die "STATUS_OUT exists (not create-once): $STATUS_OUT"
[ ! -e "$MANIFEST_OUT" ] || die "MANIFEST_OUT exists (not create-once): $MANIFEST_OUT"
( set -o noclobber; : > "$TRACE_OUT" ) 2>/dev/null || die "TRACE_OUT create-once failed"

# ── verify the roll script bytes before running (durable-exec; roll also self-hashes) ──
[ -f "$ROLL_SCRIPT" ] || die "ROLL_SCRIPT not found: $ROLL_SCRIPT"
GOT=$(h "$ROLL_SCRIPT"); [ "$GOT" = "$SCRIPT_SHA256" ] || die "ROLL_SCRIPT sha256 $GOT != approved $SCRIPT_SHA256"

# ── run with pipefail; capture PIPESTATUS immediately (V6-1) ──
set -o pipefail
APPROVED_SELF_SHA256="$SCRIPT_SHA256" STATUS_OUT="$STATUS_OUT" bash "$ROLL_SCRIPT" 2>&1 | tee -a "$TRACE_OUT"
SCRIPT_RC=${PIPESTATUS[0]}; TEE_RC=${PIPESTATUS[1]}

# ── post-close hashes (files complete; hashed OUTSIDE themselves) ──
TRACE_SHA=$(h "$TRACE_OUT")
STATUS_SHA=""; DISPOSITION="missing"; TERMINAL_READS_OK="unknown"
if [ -s "$STATUS_OUT" ]; then
  STATUS_SHA=$(h "$STATUS_OUT")
  DISPOSITION=$(jq -r '.disposition // "invalid"' "$STATUS_OUT" 2>/dev/null || echo invalid)
  TERMINAL_READS_OK=$(jq -r '.terminal_reads_ok // "unknown"' "$STATUS_OUT" 2>/dev/null || echo unknown)
fi

# ── evidence gate ──
EVIDENCE_OK=true
[ "$TEE_RC" -eq 0 ] || { EVIDENCE_OK=false; echo "[wrapper] tee_rc=$TEE_RC -- trace capture failed" >&2; }
[ -n "$STATUS_SHA" ] || { EVIDENCE_OK=false; echo "[wrapper] terminal status missing/empty" >&2; }

# ── THIRD manifest (create-once, out-of-band; V6-3) ──
( set -o noclobber
  jq -n \
    --arg commit "$SCRIPT_COMMIT" --arg path "$SCRIPT_PATH" --arg blob "$SCRIPT_BLOB" --arg ssha "$SCRIPT_SHA256" \
    --argjson src "$SCRIPT_RC" --argjson tec "$TEE_RC" \
    --arg disp "$DISPOSITION" --arg tro "$TERMINAL_READS_OK" --argjson evok "$EVIDENCE_OK" \
    --arg tp "$TRACE_OUT" --arg tsha "$TRACE_SHA" --arg sp "$STATUS_OUT" --arg ssha2 "$STATUS_SHA" \
    --arg brr "$BUILD_RECEIPT_REF" --arg brs "$BUILD_RECEIPT_SHA256" \
    --arg cpr "$CRED_PROOF_REF" --arg cps "$CRED_PROOF_SHA256" --arg dr "$DECISION_REF" \
    '{node:"hubfix0-ROLL-wrapper",
      script:{commit:$commit, path:$path, blob:$blob, sha256:$ssha},
      script_exit:$src, tee_exit:$tec, disposition:$disp, terminal_reads_ok:$tro, evidence_ok:$evok,
      trace:{path:$tp, sha256:$tsha}, status:{path:$sp, sha256:$ssha2},
      build_receipt:{ref:$brr, sha256:$brs}, cred_proof:{ref:$cpr, sha256:$cps}, decision_ref:$dr}' \
    > "$MANIFEST_OUT"
) 2>/dev/null || die "MANIFEST_OUT create-once/write failed -- EVIDENCE INCOMPLETE"
MANIFEST_SHA=$(h "$MANIFEST_OUT")
echo "[wrapper] manifest=$MANIFEST_OUT sha256=$MANIFEST_SHA script_rc=$SCRIPT_RC tee_rc=$TEE_RC disposition=$DISPOSITION evidence_ok=$EVIDENCE_OK"
echo "[wrapper] PUBLISH as Hub completion evidence: trace=$TRACE_OUT($TRACE_SHA) status=$STATUS_OUT($STATUS_SHA) manifest=$MANIFEST_OUT($MANIFEST_SHA)"

# ── fail-closed exit (V6-1): preserve roll semantics; force nonzero on any evidence gap or incoherence ──
$EVIDENCE_OK || exit 40
case "${SCRIPT_RC}:${DISPOSITION}" in
  0:roll_success)      exit 0 ;;
  2:rollback_verified) exit 2 ;;
  3:rollback_unproven) exit 3 ;;
  *) echo "[wrapper] non-success/incoherent rc=$SCRIPT_RC disp=$DISPOSITION" >&2; [ "$SCRIPT_RC" -ne 0 ] && exit "$SCRIPT_RC" || exit 41 ;;
esac
