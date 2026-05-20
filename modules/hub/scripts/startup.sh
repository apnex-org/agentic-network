#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
# modules/hub/scripts/startup.sh — Hub VM first-boot bootstrap (COS)
# mission-86 M-Hub-Storage-Cloud-Deploy, Design v1.5 §4.2 / §4.3 / §4.8
#
# Container-Optimized OS (Design v1.5 §4.2 — F8/B3, OQ-1 Debian→COS
# reversal): Docker is pre-installed; there is NO Docker / Ops-Agent
# install. The internal-only VM has Google-services-only egress — every
# image pulls from Artifact Registry (the Hub image, plus the Docker-Hub
# images via the AR pull-through remote).
#
# Wired in as metadata_startup_script (compute.tf); runs on every boot;
# idempotent via per-resource guards (`docker inspect`, `blkid`, ...).
#
# COS adaptation of the §4.3 docker-compose stack: COS ships no
# docker-compose, so the 3 containers run as direct `docker run`s on a
# user-defined bridge network; depends_on:service_healthy is reproduced
# by a pg_isready wait-loop before the Hub container starts.
#
# Metadata inputs (compute.tf): hub-image, postgres-image,
# watchtower-image, backup-bucket, watchtower-poll-interval, gcp-project,
# secret-{postgres-password,hub-api-token,gh-api-token}, repo-event-bridge-repos.
# ══════════════════════════════════════════════════════════════════════
set -u
exec > >(tee -a /var/log/hub-startup.log) 2>&1
echo "[hub-startup] $(date -u +%FT%TZ) begin"

md() {
  curl -s -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"
}
HUB_IMAGE="$(md hub-image)"
POSTGRES_IMAGE="$(md postgres-image)"
WATCHTOWER_IMAGE="$(md watchtower-image)"
WATCHTOWER_INTERVAL="$(md watchtower-poll-interval)"

HUB_DIR=/var/lib/hub
DATA_MNT=/mnt/disks/hub-data

# ── Artifact Registry auth ────────────────────────────────────────────
# COS's /root filesystem is read-only, so the default ~/.docker/ config is
# unwritable — point DOCKER_CONFIG at a writable path, then the
# docker-credential-gcr helper authenticates every pull from pkg.dev
# (auto-refreshing; the VM SA carries roles/artifactregistry.reader).
export DOCKER_CONFIG="$HUB_DIR/docker-config"
mkdir -p "$DOCKER_CONFIG"
docker-credential-gcr configure-docker --registries=australia-southeast1-docker.pkg.dev

# ── Attached data disk → /mnt/disks/hub-data (backs the postgres volume)
DATA_DEV=/dev/disk/by-id/google-hub-data
if ! blkid "$DATA_DEV" >/dev/null 2>&1; then
  echo "[hub-startup] formatting data disk $DATA_DEV"
  mkfs.ext4 -F "$DATA_DEV"
fi
mkdir -p "$DATA_MNT"
mountpoint -q "$DATA_MNT" || mount "$DATA_DEV" "$DATA_MNT"
mkdir -p "$DATA_MNT/postgres"

# ── Hub config + secrets — fetched from GCP Secret Manager (F13(b)) ────
# mission-86 W3 Design v2.0 §4.5.1 + §4.4: POSTGRES_PASSWORD, HUB_API_TOKEN
# and OIS_GH_API_TOKEN live in GCP Secret Manager — terraform-managed,
# off-disk, centrally rotatable. This SUPERSEDES the W2 persistent-disk
# .env (F13(a)): the secrets are fetched fresh every boot, so they survive
# any VM replacement with zero disk dependency (closes F13 structurally).
# COS has no gcloud — fetch via the Secret Manager REST API + the VM SA
# metadata token (the VM SA carries roles/secretmanager.secretAccessor on
# each of the three hub secrets).
mkdir -p "$HUB_DIR"
GCP_PROJECT="$(md gcp-project)"
SM_TOKEN="$(curl -s -H 'Metadata-Flavor: Google' \
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' \
  | tr ',' '\n' | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')"
sm_fetch() { # $1 = secret-id → plaintext secret value on stdout
  curl -s -H "Authorization: Bearer ${SM_TOKEN}" \
    "https://secretmanager.googleapis.com/v1/projects/${GCP_PROJECT}/secrets/$1/versions/latest:access" \
    | tr ',' '\n' | sed -n 's/.*"data": *"\([^"]*\)".*/\1/p' | base64 -d
}
POSTGRES_PASSWORD="$(sm_fetch "$(md secret-postgres-password)")"
HUB_API_TOKEN="$(sm_fetch "$(md secret-hub-api-token)")"
OIS_GH_API_TOKEN="$(sm_fetch "$(md secret-gh-api-token)")"
HUB_ADMIN_TOKEN="$(sm_fetch "$(md secret-hub-admin-token)")"
OIS_REPO_EVENT_BRIDGE_REPOS="$(md repo-event-bridge-repos)"
if [ -z "$POSTGRES_PASSWORD" ] || [ -z "$HUB_API_TOKEN" ] || [ -z "$OIS_GH_API_TOKEN" ] || [ -z "$HUB_ADMIN_TOKEN" ]; then
  echo "[hub-startup] FATAL: Secret Manager fetch returned an empty secret" >&2
  exit 1
fi

# ── 3-container stack — docker run (COS has no docker-compose) ─────────
docker network inspect hub-net >/dev/null 2>&1 || docker network create hub-net

if ! docker inspect ois-postgres-prod >/dev/null 2>&1; then
  echo "[hub-startup] starting postgres"
  docker run -d --name ois-postgres-prod --restart unless-stopped --network hub-net \
    -e POSTGRES_DB=hub -e POSTGRES_USER=hub -e "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}" \
    -v "$DATA_MNT/postgres:/var/lib/postgresql/data" \
    --health-cmd 'pg_isready -U hub -d hub' --health-interval 5s --health-retries 5 \
    "$POSTGRES_IMAGE"
fi

# Reproduce depends_on:service_healthy — wait for postgres before the Hub.
echo "[hub-startup] waiting for postgres health ..."
for _ in $(seq 1 60); do
  docker exec ois-postgres-prod pg_isready -U hub -d hub >/dev/null 2>&1 && break
  sleep 2
done

if ! docker inspect ois-hub-prod >/dev/null 2>&1; then
  echo "[hub-startup] starting hub"
  docker run -d --name ois-hub-prod --restart unless-stopped --network hub-net \
    -p 8080:8080 \
    -e NODE_ENV=production -e PORT=8080 \
    -e "POSTGRES_CONNECTION_STRING=postgres://hub:${POSTGRES_PASSWORD}@ois-postgres-prod:5432/hub" \
    -e "HUB_API_TOKEN=${HUB_API_TOKEN}" -e WATCHDOG_ENABLED=true \
    -e "HUB_ADMIN_TOKEN=${HUB_ADMIN_TOKEN}" \
    -e "OIS_GH_API_TOKEN=${OIS_GH_API_TOKEN}" \
    -e "OIS_REPO_EVENT_BRIDGE_REPOS=${OIS_REPO_EVENT_BRIDGE_REPOS}" \
    -l com.centurylinklabs.watchtower.enable=true \
    "$HUB_IMAGE"
fi

if ! docker inspect watchtower-prod >/dev/null 2>&1; then
  echo "[hub-startup] starting watchtower"
  docker run -d --name watchtower-prod --restart unless-stopped --network hub-net \
    -v /var/run/docker.sock:/var/run/docker.sock \
    "$WATCHTOWER_IMAGE" --interval "${WATCHTOWER_INTERVAL}" --label-enable
fi

# ── Cloud backup script + hourly systemd timer (Design §4.8) ──────────
# COS has no gcloud — the upload uses the GCS JSON API + the VM SA token.
cat > "$HUB_DIR/hub-snapshot.sh" <<'SNAP'
#!/bin/bash
# hub-snapshot.sh — hourly postgres snapshot → GCS (mission-86 §4.8)
set -eu
META='http://metadata.google.internal/computeMetadata/v1/instance'
BUCKET="$(curl -s -H 'Metadata-Flavor: Google' "$META/attributes/backup-bucket")"
TOKEN="$(curl -s -H 'Metadata-Flavor: Google' "$META/service-accounts/default/token" \
  | tr ',' '\n' | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')"
TS="$(date -u +%Y%m%d-%H%M%S)"
DUMP="/tmp/hub-${TS}.pgdump"
docker exec ois-postgres-prod pg_dump -Fc -U hub hub > "$DUMP"
curl -sf -X POST -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/octet-stream' --data-binary "@${DUMP}" \
  "https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=snapshots/hub-${TS}.pgdump"
rm -f "$DUMP"
echo "hub-snapshot: uploaded gs://${BUCKET}/snapshots/hub-${TS}.pgdump"
SNAP
chmod +x "$HUB_DIR/hub-snapshot.sh"

cat > /etc/systemd/system/hub-backup.service <<'UNIT'
[Unit]
Description=Hub postgres snapshot to GCS
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
# COS mounts the /var stateful partition `noexec` — systemd cannot execve()
# the script directly (203/EXEC) despite +x. Invoke it via /bin/bash (on the
# exec-OK / mount); bash *reads* the script as data, which noexec permits.
ExecStart=/bin/bash /var/lib/hub/hub-snapshot.sh
UNIT

cat > /etc/systemd/system/hub-backup.timer <<'UNIT'
[Unit]
Description=Run hub-backup hourly

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now hub-backup.timer

touch "$HUB_DIR/.bootstrapped"
echo "[hub-startup] $(date -u +%FT%TZ) complete"
