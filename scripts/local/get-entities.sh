#!/usr/bin/env bash
#
# get-entities.sh — Hub substrate daily-driver CLI
#
# mission-83 W7 deliverable per Design v1.4 §2.6 Surface 1 + N2 disposition:
# direct-psql access (no HUB_TOKEN/HUB_URL); HUB_PG_CONNECTION_STRING env-driven.
#
# Usage:
#   get-entities.sh <kind> [--id=<id>] [--filter='k=v,k2=v2'] [--limit=N] [--format=table|json]
#
# Examples:
#   get-entities.sh Bug --filter='status=open' --limit=10
#   get-entities.sh Thread --id=thread-573
#   get-entities.sh Mission --filter='status=active' --format=json
#   get-entities.sh Counter  # special-case single-row
#   get-entities.sh Audit --filter='actor=architect' --limit=20
#
# Env:
#   HUB_PG_CONNECTION_STRING — defaults to postgres://hub:hub@localhost:5432/hub

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

Env:
  HUB_PG_CONNECTION_STRING  postgres connection string
                            (default: postgres://hub:hub@localhost:5432/hub)

Examples:
  get-entities.sh Bug --filter='status=open' --limit=10
  get-entities.sh Thread --id=thread-573
  get-entities.sh Mission --filter='status=active' --format=json
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
    WHERE="$WHERE AND data->>'$key' = '$val'"
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

# Execute
psql "$CONN" -P pager=off -c "$QUERY"
