#!/usr/bin/env bash
# Single reproducible Cloud Build of the P1a adapter image from a CLEAN git-archive
# of <sha> (tracked files only -> dirty-free AND cred-free context). Prints the pushed
# manifest digest read from Artifact Registry. Used by repro-build-test.sh.
#
#   usage: p1a-build.sh <sha> <tag> <controls:on|off>
set -euo pipefail
SHA="${1:?sha required}"; TAG="${2:?tag required}"; CONTROLS="${3:-on}"
PROJECT="${PROJECT:-labops-389703}"
IMAGE="${IMAGE:-australia-southeast1-docker.pkg.dev/labops-389703/cloud-run-source-deploy/claude-adapter}"
ROOT="$(git rev-parse --show-toplevel)"
TOOLDIR="$ROOT/deploy/adapter-image"
SHORT="$(git rev-parse --short "$SHA")"
FULL="$(git rev-parse "$SHA")"
EPOCH="$(git log -1 --format=%ct "$SHA")"   # deterministic: the commit time of the SHA

CTX="$(mktemp -d)"; trap 'rm -rf "$CTX"' EXIT
git archive "$FULL" | tar -x -C "$CTX"      # clean source-bake @ SHA (no .git, no untracked creds)
cp "$TOOLDIR/Dockerfile"                          "$CTX/Dockerfile"
cp "$TOOLDIR/dockerignore.template"               "$CTX/.dockerignore"
cp "$TOOLDIR/dockerignore.template"               "$CTX/.gcloudignore"
cp "$TOOLDIR/write-build-info-deterministic.cjs"  "$CTX/_p1a-stamp.cjs"
cp "$TOOLDIR/prune-node-modules.cjs"              "$CTX/_p1a-prune.cjs"
cp "$TOOLDIR/supervisor.mjs"                       "$CTX/_p1a-supervisor.mjs"
cp "$TOOLDIR/cloudbuild.yaml"                      "$CTX/cloudbuild.yaml"

echo "[p1a-build] SHA=$SHORT ($FULL) EPOCH=$EPOCH TAG=$TAG CONTROLS=$CONTROLS" >&2
( cd "$CTX" && gcloud builds submit . \
    --project "$PROJECT" \
    --config cloudbuild.yaml \
    --substitutions "_SHA=$SHORT,_EPOCH=$EPOCH,_BRANCH=main,_CONTROLS=$CONTROLS,_IMAGE=$IMAGE,_TAG=$TAG" \
    --quiet >&2 )

gcloud artifacts docker images describe "$IMAGE:$TAG" --project "$PROJECT" \
  --format='value(image_summary.digest)'
