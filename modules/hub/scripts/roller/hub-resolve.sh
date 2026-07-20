#!/usr/bin/env bash
# hub-resolve.sh — SHARED gcloud-free resolver (design 9548d827 §1.3, R1/R4).
#
# Wraps greg's hub-detect (SEAM: hub-detect runs the FROZEN detect method —
#   `docker pull "$REG:latest"` via the gcr-helper -> `docker image inspect` ->
#   require EXACTLY ONE canonical $REG@sha256 member of .RepoDigests (never index-0) —
#   and emits that raw ref on stdout + exit 0 on a clean single resolution, nonzero +
#   no stdout on ambiguity/failure/no-auth).
#
# Returns a TYPED outcome (R1): `fresh_candidate <ref>` | `boot_fallback <ref>` |
# `quarantined` | `error`, on stdout. NEVER emits a mutable tag. The CALLER's policy
# (§1.3 caller policy / §9.1 boot FSM) decides what each outcome permits — a periodic
# tick advances ONLY on fresh_candidate; boot/recovery may launch boot_fallback.
#
# Usage: source it and call `hub_resolve`, or exec it directly (prints the outcome line).
set -euo pipefail
_RES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$_RES_DIR/hub-common.sh"
HUB_DETECT="${HUB_DETECT:-$_RES_DIR/hub-detect}"     # greg's §2 detect (co-located; bind 09162239/020bafd4)

hub_resolve(){
  local cand rc=0 dbad
  # 1. run greg's frozen detector (SEAM: env HUB_DETECT_REG=<repo,no tag>; bash-invoked,
  #    noexec-safe; ONE raw $REG@sha256 line on stdout + exit 0 on a clean single
  #    resolution, else nonzero + NO stdout). new-vs-running/typing/roll are ours (§1).
  cand="$(tmo "$TMO_PULL" env HUB_DETECT_REG="$REG" bash "$HUB_DETECT" 2>/dev/null)" || rc=$?

  if [ "$rc" -eq 0 ] && is_canonical_ref "$cand"; then
    # 2. quarantine check: resolved == persisted D_bad AND still-current => quarantined.
    if dbad="$(state_get_dbad 2>/dev/null)" && [ "$dbad" = "$cand" ]; then
      echo "quarantined"; return 0
    fi
    echo "fresh_candidate $cand"; return 0
  fi

  # 3. detect failed/ambiguous/no-auth => boot_fallback(lastGoodDigest) if valid, else error.
  local lg
  if lg="$(state_get_lastgood 2>/dev/null)" && is_canonical_ref "$lg"; then
    echo "boot_fallback $lg"; return 0
  fi
  echo "error"; return 0
}

# direct-exec form (also used by the §9.1 boot controller and the detect-only canary)
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  hub_resolve
fi
