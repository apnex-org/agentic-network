#!/usr/bin/env bash
# Stage + Cloud-Build the M-Real-CLI-Harness n5 real-CLI EMBEDDED harness image from a CLEAN
# `git archive <SHA>` (tracked-files-only -> dirty-free + cred-free context). The n5-specific files
# (Dockerfile.real-cli / real-cli-launch.sh / real-cli-bootstrap.cjs / claude-cli-preseed.claude.json
# / supervisor.mjs) must be COMMITTED at <SHA> so the archive carries them. Build via Cloud Build
# because local docker-run core-dumps node images (the whole reason the VM exists).
#
#   usage: build-real-cli-image.sh [SHA=HEAD] [TAG=n5-<short>]
set -euo pipefail
SHA="${1:-HEAD}"
PROJECT="${PROJECT:-labops-389703}"
IMAGE="${IMAGE:-australia-southeast1-docker.pkg.dev/labops-389703/cloud-run-source-deploy/claude-adapter-realcli}"
ROOT="$(git rev-parse --show-toplevel)"
TOOLDIR="$ROOT/deploy/adapter-image"
FULL="$(git rev-parse "$SHA")"
SHORT="$(git rev-parse --short "$SHA")"
TAG="${2:-n5-$SHORT}"

CTX="$(mktemp -d)"; trap 'rm -rf "$CTX"' EXIT
git archive "$FULL" | tar -x -C "$CTX"          # clean source-bake @ SHA
cp "$TOOLDIR/Dockerfile.real-cli"      "$CTX/Dockerfile"
cp "$TOOLDIR/dockerignore.template"    "$CTX/.dockerignore"
cp "$TOOLDIR/dockerignore.template"    "$CTX/.gcloudignore"
cp "$TOOLDIR/cloudbuild.real-cli.yaml" "$CTX/cloudbuild.yaml"
# Stage the n5 runtime files at the CONTEXT ROOT — dockerignore.template excludes the whole
# `deploy/` subtree, so the Dockerfile COPYs these by simple root name (pilot convention).
cp "$TOOLDIR/supervisor.mjs"                  "$CTX/supervisor.mjs"
cp "$TOOLDIR/real-cli-launch.sh"             "$CTX/real-cli-launch.sh"
cp "$TOOLDIR/real-cli-bootstrap.cjs"         "$CTX/real-cli-bootstrap.cjs"
cp "$TOOLDIR/claude-cli-preseed.claude.json" "$CTX/claude-cli-preseed.claude.json"

echo "[n5-build] SHA=$SHORT TAG=$TAG IMAGE=$IMAGE" >&2
( cd "$CTX" && gcloud builds submit . \
    --project "$PROJECT" \
    --config cloudbuild.yaml \
    --substitutions "_IMAGE=$IMAGE,_TAG=$TAG" \
    --quiet >&2 )
echo "[n5-build] pushed $IMAGE:$TAG" >&2
echo "$IMAGE:$TAG"
