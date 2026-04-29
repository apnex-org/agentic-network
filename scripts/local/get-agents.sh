#!/bin/bash
# get-agents.sh — operator-facing CLI surface for Hub Agent state inspection
#
# Mission-66 W1+W2 commit 7a (architect-portion). Engineer-portion (7b) fills
# the buildTable() + curl-binding + integration-test STUBs marked below.
#
# Pattern reference: /home/apnex/taceng/table/prism.sh (memory:
# reference_prism_table_pattern.md).
#
# API target: Hub MCP-over-HTTP JSON-RPC envelope at /mcp endpoint
# (greg-lean (ii) per thread-422 round-1 audit; anti-goal #2 strengthened —
# no new HTTP REST endpoint; CLI dogfoods existing /mcp path).
#
# Auth: sources ~/.config/apnex-agents/<role>.env for HUB_TOKEN; sets
# Authorization: Bearer ${HUB_TOKEN} header on curl.
#
# Usage:
#   get-agents.sh                           # default: --role director, table render
#   get-agents.sh --role architect          # use architect creds
#   get-agents.sh --json                    # raw JSON-RPC response (jq .)
#   get-agents.sh --lean                    # terse table (id + role + status only)
#   get-agents.sh --host https://prod-hub   # override default localhost:8080

set -euo pipefail

# --- DEFAULTS ---
DEFAULT_HOST="http://localhost:8080"
DEFAULT_ROLE="director"
TPL_DIR="$(dirname "$(readlink -f "$0")")/tpl"

# --- COLORS (per prism.sh pattern) ---
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# --- ARG PARSE ---
HOST="$DEFAULT_HOST"
ROLE="$DEFAULT_ROLE"
OUTPUT_JSON=""
OUTPUT_LEAN=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --host) HOST="$2"; shift 2 ;;
        --role) ROLE="$2"; shift 2 ;;
        --json) OUTPUT_JSON="1"; shift ;;
        --lean) OUTPUT_LEAN="1"; shift ;;
        --help|-h) usage; exit 0 ;;
        *) echo -e "${RED}[ERROR]${NC} Unknown arg: $1" >&2; exit 3 ;;
    esac
done

# --- USAGE ---
usage() {
    cat <<USAGE
get-agents.sh — operator-facing CLI for Hub Agent state inspection

Usage: get-agents.sh [--role architect|engineer|director] [--host <url>] [--json] [--lean]

Flags:
  --role <r>     Source ~/.config/apnex-agents/<r>.env for HUB_TOKEN (default: director)
  --host <url>   Hub HTTP base URL (default: http://localhost:8080); /mcp appended automatically
  --json         Bypass table render; print raw JSON-RPC response via jq .
  --lean         Use terse template (id + role + status); default uses verbose template
  --help / -h    Show this help

Exit codes:
  0  success
  1  Hub API error or curl failure
  2  auth env file missing or HUB_TOKEN unset
  3  invalid args

Reference: /home/apnex/taceng/table/prism.sh (table-rendering pattern).
USAGE
}

# --- AUTH ---
ENV_FILE="${HOME}/.config/apnex-agents/${ROLE}.env"
if [[ ! -f "$ENV_FILE" ]]; then
    echo -e "${RED}[ERROR]${NC} Auth env file missing: $ENV_FILE" >&2
    echo "        Expected format: HUB_TOKEN=<bearer-token>" >&2
    exit 2
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
if [[ -z "${HUB_TOKEN:-}" ]]; then
    echo -e "${RED}[ERROR]${NC} HUB_TOKEN unset in $ENV_FILE" >&2
    exit 2
fi

# --- buildTable() — STUB; engineer commit 7b fills per prism.sh pattern ---
# Reference: /home/apnex/taceng/table/prism.sh:74-99
# Expected behavior:
#   1. Heredoc'd jq filter: array-of-objects → headers (uppercased keys) + rows
#   2. Pipe through `jq -r '.[] | @tsv' | column -t -s $'\t'`
#   3. Cyan-color first line (header); plain rest
buildTable() {
    local INPUT="${1:-}"
    if [[ -z "$INPUT" || "$INPUT" == "[]" || "$INPUT" == "null" ]]; then return; fi
    # ENGINEER-7b: implement per prism.sh:74-99 (heredoc'd JQTABLE filter +
    # column -t pipe + cyan-header coloring loop). Marked STUB until 7b lands.
    echo -e "${YELLOW}[STUB]${NC} buildTable() not yet implemented (engineer commit 7b)" >&2
    echo "$INPUT"
}

# --- API call — STUB; engineer commit 7b fills /mcp JSON-RPC envelope binding ---
# Reference: hub/src/hub-networking.ts:681-905 per greg thread-422 round-1 audit
# Expected envelope:
#   POST ${HOST}/mcp
#   Authorization: Bearer ${HUB_TOKEN}
#   Content-Type: application/json
#   Body: {"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_agents","arguments":{}}}
# Response unwraps via jq: .result.content[0].text → JSON-stringified Agent projection
call_get_agents() {
    # ENGINEER-7b: replace with curl + /mcp JSON-RPC POST + auth header.
    # Marked STUB until 7b lands.
    echo -e "${YELLOW}[STUB]${NC} call_get_agents() not yet implemented (engineer commit 7b)" >&2
    echo "[]"
}

# --- MAIN ---
RAW_RESPONSE=$(call_get_agents)

# Check for API errors
ERROR=$(echo "$RAW_RESPONSE" | jq -r '.error // empty' 2>/dev/null || echo "")
if [[ -n "$ERROR" && "$ERROR" != "null" ]]; then
    echo -e "${RED}[ERROR]${NC} Hub API: $ERROR" >&2
    exit 1
fi

if [[ -n "$OUTPUT_JSON" ]]; then
    echo "$RAW_RESPONSE" | jq .
    exit 0
fi

# Pick template
if [[ -n "$OUTPUT_LEAN" ]]; then
    TPL_FILE="${TPL_DIR}/agents-lean.jq"
else
    TPL_FILE="${TPL_DIR}/agents.jq"
fi

if [[ ! -f "$TPL_FILE" ]]; then
    echo -e "${RED}[ERROR]${NC} Template not found: $TPL_FILE" >&2
    exit 1
fi

# Apply template + render table
TABLE_DATA=$(echo "$RAW_RESPONSE" | jq -f "$TPL_FILE")
buildTable "$TABLE_DATA"
