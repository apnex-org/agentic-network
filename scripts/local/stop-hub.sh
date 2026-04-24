#!/usr/bin/env bash
#
# stop-hub.sh — Stop and remove the local Hub container (ois-hub-local).
#
# Idempotent: succeeds quietly if the container does not exist.
#
# Usage:
#   scripts/local/stop-hub.sh
#

set -euo pipefail

CONTAINER_NAME="ois-hub-local"

if ! docker ps -a -q --filter "name=^/${CONTAINER_NAME}$" | grep -q .; then
  echo "[stop-hub] No $CONTAINER_NAME container found — nothing to do."
  exit 0
fi

if docker ps -q --filter "name=^/${CONTAINER_NAME}$" | grep -q .; then
  echo "[stop-hub] Stopping $CONTAINER_NAME ..."
  docker stop "$CONTAINER_NAME" >/dev/null
fi

echo "[stop-hub] Removing $CONTAINER_NAME ..."
docker rm "$CONTAINER_NAME" >/dev/null

echo "[stop-hub] Done."
