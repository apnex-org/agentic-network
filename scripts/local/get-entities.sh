#!/usr/bin/env bash
#
# get-entities.sh — Hub substrate daily-driver CLI
#
# mission-83 W7 deliverable per Design v1.4 §2.6 Surface 1 + N2 disposition:
# direct-psql access (no HUB_TOKEN/HUB_URL); HUB_PG_CONNECTION_STRING env-driven.
#
# Two execution modes:
#   1. Local mode (default) — `psql $HUB_PG_CONNECTION_STRING` against local
#      Hub substrate (e.g., docker-compose dev-stack at localhost:5432).
#   2. Remote mode — activates when `HUB_PG_REMOTE_VM` is set. Proxies psql
#      via `gcloud compute ssh` + `docker exec` against the production
#      substrate, authenticating as the read-only `hub_reader` role.
#      Resolves substrate-DX asymmetry per Threads v3 cartography §6.1 F-3.
#
# Usage:
#   get-entities.sh <kind> [--id=<id>] [--filter='k=v,k2=v2'] [--limit=N] [--format=table|json]
#
# Filter syntax (mission-88 W1 — envelope-shape support):
#   - Top-level key:   --filter='id=idea-1'              → data->>'id' = '...'
#   - Dotted path:     --filter='status.phase=open'      → data->'status'->>'phase' = '...'
#   - Mixed:           --filter='metadata.sourceThreadId=thread-100,status.phase=triaged'
#
# Examples (mission-88 W1+ envelope-shape kinds — Idea/Bug/Thread/Mission/Proposal):
#   get-entities.sh Bug --filter='status.phase=open' --limit=10
#   get-entities.sh Thread --id=thread-573
#   get-entities.sh Mission --filter='status.phase=active' --format=json
#   get-entities.sh Idea --filter='metadata.sourceThreadId=thread-635'
#   get-entities.sh Counter  # special-case single-row (legacy-flat shape)
#   get-entities.sh Audit --filter='actor=architect' --limit=20
#
# Env (local mode):
#   HUB_PG_CONNECTION_STRING — postgres connection string
#                              (default: postgres://hub:hub@localhost:5432/hub)
#
# Env (remote mode — all three required when HUB_PG_REMOTE_VM is set):
#   HUB_PG_REMOTE_VM           GCE VM name running the production substrate
#   HUB_PG_REMOTE_ZONE         GCE zone of the VM (e.g., australia-southeast1-a)
#   HUB_PG_READER_PASSWORD     password for the read-only `hub_reader` postgres role
#
# Notes:
#   - Remote mode requires `gcloud` CLI on PATH + active auth (`gcloud auth list`).
#   - Remote mode is read-only by substrate design (`hub_reader` role lacks
#     INSERT/UPDATE/DELETE grants).
#   - Latency: ~500-800ms per query (ssh round-trip) vs ~5ms direct. Fine for
#     interactive forensics; batch via single multi-statement `--filter` for loops.
#   - Quote-safety: the query is piped via stdin (not embedded in `--command`),
#     avoiding ssh→bash→docker-exec quote-layering hazards.

set -euo pipefail

CONN="${HUB_PG_CONNECTION_STRING:-postgres://hub:hub@localhost:5432/hub}"
KIND=""
ID=""
FILTER=""
LIMIT="20"
FORMAT="table"

usage() {
  cat >&2 <<'USAGE'
get-entities.sh — Hub substrate daily-driver CLI

Usage:
  get-entities.sh <kind> [options]

Options:
  --id=<id>              Get specific entity by id (kind, id) PK
  --filter='k=v,k2=v2'   Filter by JSONB field equality (comma-separated AND)
  --limit=N              Cap result set (default: 20)
  --format=table|json    Output format (default: table)

Env (local mode — default):
  HUB_PG_CONNECTION_STRING  postgres connection string
                            (default: postgres://hub:hub@localhost:5432/hub)

Env (remote mode — activates when HUB_PG_REMOTE_VM is set):
  HUB_PG_REMOTE_VM          GCE VM name running production substrate
  HUB_PG_REMOTE_ZONE        GCE zone (e.g., australia-southeast1-a)
  HUB_PG_READER_PASSWORD    password for read-only `hub_reader` role

Examples (legacy-flat kinds — Counter/Audit/etc.):
  get-entities.sh Audit --filter='actor=architect' --limit=10

Examples (envelope-shape kinds — Idea/Bug/Thread/Mission/Proposal post mission-88 W1):
  get-entities.sh Bug --filter='status.phase=open' --limit=10
  get-entities.sh Thread --id=thread-573
  get-entities.sh Mission --filter='status.phase=active' --format=json
  get-entities.sh Idea --filter='metadata.sourceThreadId=thread-635'
USAGE
  exit 2
}

if [ $# -eq 0 ]; then usage; fi

KIND="$1"
shift

for arg in "$@"; do
  case "$arg" in
    --id=*) ID="${arg#--id=}" ;;
    --filter=*) FILTER="${arg#--filter=}" ;;
    --limit=*) LIMIT="${arg#--limit=}" ;;
    --format=*) FORMAT="${arg#--format=}" ;;
    *) echo "[get-entities] unknown arg: $arg" >&2; usage ;;
  esac
done

# Build WHERE clause
WHERE="kind = '$KIND'"
if [ -n "$ID" ]; then
  WHERE="$WHERE AND id = '$ID'"
fi
if [ -n "$FILTER" ]; then
  IFS=',' read -ra PAIRS <<< "$FILTER"
  for pair in "${PAIRS[@]}"; do
    key="${pair%%=*}"
    val="${pair#*=}"
    # Safe-quote both key and value (basic SQL injection protection)
    key="${key//\'/\'\'}"
    val="${val//\'/\'\'}"
    # Envelope-shape support (mission-88 W1+): if key contains '.', emit JSONB
    # navigation path. e.g. 'status.phase' → data->'status'->>'phase';
    # 'metadata.sourceThreadId' → data->'metadata'->>'sourceThreadId'.
    # Top-level keys (no '.') stay legacy-flat data->>'key'.
    if [[ "$key" == *.* ]]; then
      IFS='.' read -ra SEGS <<< "$key"
      PATH_EXPR="data"
      for (( i=0; i<${#SEGS[@]}-1; i++ )); do
        PATH_EXPR="$PATH_EXPR->'${SEGS[$i]}'"
      done
      PATH_EXPR="$PATH_EXPR->>'${SEGS[${#SEGS[@]}-1]}'"
      WHERE="$WHERE AND $PATH_EXPR = '$val'"
    else
      WHERE="$WHERE AND data->>'$key' = '$val'"
    fi
  done
fi

# Build query per format
if [ "$FORMAT" = "json" ]; then
  QUERY="SELECT jsonb_pretty(data) FROM entities WHERE $WHERE ORDER BY id DESC LIMIT $LIMIT"
elif [ "$FORMAT" = "table" ]; then
  QUERY="SELECT id, jsonb_pretty(data) AS data, updated_at FROM entities WHERE $WHERE ORDER BY id DESC LIMIT $LIMIT"
else
  echo "[get-entities] unknown format: $FORMAT (use table|json)" >&2
  exit 2
fi

# Execute — remote mode (via gcloud-ssh + docker exec) if HUB_PG_REMOTE_VM is set;
# otherwise local mode (direct psql against HUB_PG_CONNECTION_STRING).
if [[ -n "${HUB_PG_REMOTE_VM:-}" ]]; then
  : "${HUB_PG_REMOTE_ZONE:?HUB_PG_REMOTE_ZONE required when HUB_PG_REMOTE_VM is set}"
  : "${HUB_PG_READER_PASSWORD:?HUB_PG_READER_PASSWORD required when HUB_PG_REMOTE_VM is set}"
  # Pipe query via stdin to avoid quote-layering through ssh → bash → docker exec.
  # `docker exec -i` connects container stdin to the ssh pipe; psql reads SQL
  # commands from stdin when no `-c` / `-f` is given.
  printf '%s\n' "$QUERY" | gcloud compute ssh "$HUB_PG_REMOTE_VM" \
    --zone="$HUB_PG_REMOTE_ZONE" \
    --command="sudo docker exec -i -e PGPASSWORD='$HUB_PG_READER_PASSWORD' ois-postgres-prod psql -U hub_reader -d hub -P pager=off"
else
  psql "$CONN" -P pager=off -c "$QUERY"
fi
