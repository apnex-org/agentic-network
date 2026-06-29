#!/usr/bin/env bash
# ev_repro_digest — the falsifiable digest-equality TEST for P1a (Design §8/§9).
#
#   1. build the adapter image from the SAME clean on-main SHA TWICE (controls ON)
#      -> assert IDENTICAL pushed image digests (reproducibility holds).
#   2. build ONCE with controls OFF (the SOURCE_DATE_EPOCH/buildTime control removed)
#      -> assert the digest DIVERGES (the test is NON-VACUOUS: it goes RED if the
#      reproducibility control is removed — not a vacuous green).
#   3. scan the built image's filesystem for baked secrets (cred-free pillar-2 line).
#
#   usage: repro-build-test.sh [sha]   (default: clean on-main SHA b057685)
set -euo pipefail
SHA="${1:-b057685}"
ROOT="$(git rev-parse --show-toplevel)"; BIN="$ROOT/deploy/adapter-image/p1a-build.sh"
SHORT="$(git rev-parse --short "$SHA")"
PROJECT="${PROJECT:-labops-389703}"
IMAGE="${IMAGE:-australia-southeast1-docker.pkg.dev/labops-389703/cloud-run-source-deploy/claude-adapter}"

echo "=== P1a digest-equality test @ $SHORT ==="
DA="$(bash "$BIN" "$SHA" "p1a-$SHORT-a"   on)"
DB="$(bash "$BIN" "$SHA" "p1a-$SHORT-b"   on)"
DC="$(bash "$BIN" "$SHA" "p1a-$SHORT-mut" off)"
echo "digest_A  (controls on)  = $DA"
echo "digest_B  (controls on)  = $DB"
echo "digest_mut(controls off) = $DC"

fail=0
if [ -n "$DA" ] && [ "$DA" = "$DB" ]; then echo "PASS reproducible: same-SHA A == B"
else echo "FAIL: A != B (NOT reproducible)"; fail=1; fi
if [ -n "$DA" ] && [ "$DA" != "$DC" ]; then echo "PASS non-vacuous: controls-off mutation diverges (A != mut)"
else echo "FAIL: VACUOUS (mutation did not diverge)"; fail=1; fi

# cred-free image-layer scan (pillar-2). Runs on Cloud Build — its build status IS
# the verdict (SUCCESS = clean; FAILURE = baked secret path). Done on Cloud Build
# rather than a local `docker run` because some dev boxes' old docker core-dumps
# running modern node images; the scan must run where docker is healthy.
echo "=== cred-free image-layer scan (pillar-2) ==="
if gcloud builds submit --no-source --config "$ROOT/deploy/adapter-image/cloudbuild.credscan.yaml" \
     --substitutions "_IMAGE=$IMAGE,_TAG=p1a-$SHORT-a" --project "$PROJECT" >/dev/null 2>&1; then
  echo "PASS cred-free: image-layer scan clean"
else
  echo "FAIL cred-free: image-layer scan found baked secret paths"; fail=1
fi

[ "$fail" = 0 ] && echo "=== P1a ev_repro_digest: PASS ===" || { echo "=== P1a ev_repro_digest: FAIL ==="; }
exit $fail
