#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# deploy/hub/scripts/startup.sh — Hub VM first-boot bootstrap
# mission-86 M-Hub-Storage-Cloud-Deploy, Design §4.2 / §4.3 / §4.8
#
# Wired into the GCE instance as metadata_startup_script (compute.tf).
# Runs on every boot; idempotent via the /opt/hub/.bootstrapped sentinel.
#
# First boot:  install Docker + Cloud Ops Agent, format/mount the data
#              disk, write the docker-compose stack + backup timer, and
#              bring the 3-container stack up.
# Later boots: just `docker compose up -d` the existing stack.
#
# Dynamic config is read from instance metadata (set by compute.tf):
#   hub-image      — full Artifact Registry ref for the Hub container
#   backup-bucket  — GCS bucket for hourly postgres snapshots
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail

exec > >(tee -a /var/log/hub-startup.log) 2>&1
echo "[hub-startup] $(date -u +%FT%TZ) begin"

md() {
  curl -s -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"
}
HUB_IMAGE="$(md hub-image)"
BACKUP_BUCKET="$(md backup-bucket)"

# ── Idempotency — startup-script re-runs on every boot ────────────────
if [ -f /opt/hub/.bootstrapped ]; then
  echo "[hub-startup] already bootstrapped — (re)starting stack"
  cd /opt/hub && docker compose up -d
  echo "[hub-startup] $(date -u +%FT%TZ) done (restart path)"
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive

# ── Docker ────────────────────────────────────────────────────────────
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# ── Cloud Ops Agent (logs + metrics → Cloud Logging/Monitoring) ───────
curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
bash add-google-cloud-ops-agent-repo.sh --also-install

# ── Attached data disk → /mnt/hub-data (backs the postgres volume) ────
DATA_DEV=/dev/disk/by-id/google-hub-data
DATA_MNT=/mnt/hub-data
if ! blkid "$DATA_DEV" >/dev/null 2>&1; then
  echo "[hub-startup] formatting data disk $DATA_DEV"
  mkfs.ext4 -F "$DATA_DEV"
fi
mkdir -p "$DATA_MNT"
grep -q "$DATA_MNT" /etc/fstab || \
  echo "$DATA_DEV $DATA_MNT ext4 defaults,nofail 0 2" >> /etc/fstab
mount -a
mkdir -p "$DATA_MNT/postgres"

# ── Hub config + secrets (generate-once) ──────────────────────────────
mkdir -p /opt/hub /etc/hub
if [ ! -f /opt/hub/.env ]; then
  echo "[hub-startup] generating /opt/hub/.env"
  {
    echo "HUB_IMAGE=${HUB_IMAGE}"
    echo "POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 32)"
    echo "HUB_API_TOKEN=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 32)"
  } > /opt/hub/.env
  chmod 600 /opt/hub/.env
fi

# ── docker-compose stack (Design §4.3 — 3 containers post-pivot) ──────
# Authored .env-based (engineer disposition of Design §4.3's structural
# YAML): compose resolves ${...} from /opt/hub/.env — simpler than the
# illustrative Docker-secrets block, and the password never leaves the VM.
cat > /opt/hub/docker-compose.yml <<'COMPOSE'
services:
  hub:
    image: ${HUB_IMAGE}
    container_name: ois-hub-prod
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=8080
      - POSTGRES_CONNECTION_STRING=postgres://hub:${POSTGRES_PASSWORD}@postgres:5432/hub
      - HUB_API_TOKEN=${HUB_API_TOKEN}
      - WATCHDOG_ENABLED=true
    ports:
      - "8080:8080"
    labels:
      - com.centurylinklabs.watchtower.enable=true
    depends_on:
      postgres:
        condition: service_healthy
    networks: [internal]

  postgres:
    image: postgres:15-alpine
    container_name: ois-postgres-prod
    restart: unless-stopped
    environment:
      - POSTGRES_DB=hub
      - POSTGRES_USER=hub
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U hub -d hub"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 10s
    networks: [internal]

  watchtower:
    image: containrrr/watchtower:latest
    container_name: watchtower-prod
    restart: unless-stopped
    command: --interval 300 --label-enable
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    networks: [internal]

volumes:
  postgres-data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /mnt/hub-data/postgres

networks:
  internal:
    driver: bridge
COMPOSE

# ── Cloud backup script (Design §4.8; cloud-adapted hub-snapshot.sh) ──
cat > /opt/hub/hub-snapshot.sh <<'SNAP'
#!/usr/bin/env bash
# /opt/hub/hub-snapshot.sh — hourly postgres snapshot → GCS (mission-86 §4.8)
set -euo pipefail
BUCKET="$(curl -s -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/instance/attributes/backup-bucket)"
TS="$(date -u +%Y%m%d-%H%M%S)"
DUMP="/tmp/hub-${TS}.pgdump"
docker exec ois-postgres-prod pg_dump -Fc -U hub hub > "$DUMP"
gcloud storage cp "$DUMP" "gs://${BUCKET}/snapshots/hub-${TS}.pgdump"
rm -f "$DUMP"
echo "hub-snapshot: uploaded gs://${BUCKET}/snapshots/hub-${TS}.pgdump"
SNAP
chmod +x /opt/hub/hub-snapshot.sh

# Dedicated least-privilege backup user (Design §4.8); needs docker-socket
# access to exec pg_dump in the postgres container.
id hub-backup >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin hub-backup
usermod -aG docker hub-backup

# ── systemd backup timer (Layer B; outside compose — Design §4.8) ─────
cat > /etc/systemd/system/hub-backup.service <<'UNIT'
[Unit]
Description=Hub postgres snapshot to GCS
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
ExecStart=/opt/hub/hub-snapshot.sh
User=hub-backup
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

# ── Bring the stack up ────────────────────────────────────────────────
cd /opt/hub
docker compose pull
docker compose up -d

touch /opt/hub/.bootstrapped
echo "[hub-startup] $(date -u +%FT%TZ) complete"
