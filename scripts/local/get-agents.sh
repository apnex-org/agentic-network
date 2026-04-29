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

# --- ARG PARSE ---
# (engineer commit 7b: hoisted usage() above arg-parse block to fix pre-7b
# forward-reference error — `usage: command not found` on `--help` flag.)
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

# --- buildTable() — engineer commit 7b ---
#
# Reference: /home/apnex/taceng/table/prism.sh:74-99 (memory:
# reference_prism_table_pattern.md). Heredoc'd jq filter projects an
# array-of-objects to a header row (uppercased keys) + value rows;
# `column -t` aligns the TSV; cyan-color highlights the header line.
buildTable() {
    local INPUT="${1:-}"
    if [[ -z "$INPUT" || "$INPUT" == "[]" || "$INPUT" == "null" ]]; then return; fi

    read -r -d '' JQTABLE <<-'CONFIG' || true
        if type == "array" and (.[0]?) then
            [(
                [.[0] | to_entries[] | .key | ascii_upcase]
            ),(
                .[] | [to_entries[] | .value]
            )]
        elif type == "object" then
            [[ "KEY", "VALUE" ], (. | to_entries[] | [ .key, .value ])]
        else . end
CONFIG

    local HEADER="1"
    echo "$INPUT" | jq -r "$JQTABLE | .[] | @tsv" 2>/dev/null | column -t -s $'\t' | while read -r LINE; do
        if [[ -n $HEADER ]]; then
            echo -e "${CYAN}${LINE}${NC}"
            HEADER=""
        else
            echo "$LINE"
        fi
    done
}

# --- call_get_agents() — engineer commit 7b ---
#
# POSTs JSON-RPC `tools/call get_agents` to ${HOST}/mcp with Bearer auth.
# Reference: hub/src/hub-networking.ts:681-905 (Hub MCP-over-HTTP path;
# requireAuth Bearer-token gate per thread-422 round-1 audit Q5 finding).
#
# Returns: full JSON-RPC envelope on stdout. Caller (main flow) checks
# `.error` then unwraps `.result.content[0].text` for projection extraction.
# On curl failure: emits a synthetic JSON-RPC error envelope so caller's
# `.error` check fires uniformly.
call_get_agents() {
    local URL="${HOST}/mcp"
    local BODY='{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_agents","arguments":{}}}'
    local RESPONSE
    if ! RESPONSE=$(curl -sS -X POST "$URL" \
        -H "Authorization: Bearer ${HUB_TOKEN}" \
        -H "Accept: application/json, text/event-stream" \
        -H "Content-Type: application/json" \
        -d "$BODY" 2>&1); then
        # Curl-level failure (network / auth / refused). Wrap as JSON-RPC
        # error envelope so main flow's `.error` check fires uniformly.
        printf '{"jsonrpc":"2.0","error":{"code":-32603,"message":"curl failure: %s"}}\n' "$(echo "$RESPONSE" | head -1 | sed 's/"/\\"/g')"
        return 0
    fi
    echo "$RESPONSE"
}

# --- MAIN ---
RAW_RESPONSE=$(call_get_agents)

# Check for JSON-RPC errors (envelope-level)
ERROR=$(echo "$RAW_RESPONSE" | jq -r '.error // empty' 2>/dev/null || echo "")
if [[ -n "$ERROR" && "$ERROR" != "null" ]]; then
    ERR_MSG=$(echo "$RAW_RESPONSE" | jq -r '.error.message // .error' 2>/dev/null || echo "$ERROR")
    echo -e "${RED}[ERROR]${NC} Hub API: ${ERR_MSG}" >&2
    exit 1
fi

if [[ -n "$OUTPUT_JSON" ]]; then
    # Raw JSON-RPC envelope output (operator-debug surface).
    echo "$RAW_RESPONSE" | jq .
    exit 0
fi

# Unwrap JSON-RPC envelope → Agent projection array.
# Hub get_agents returns: {result:{content:[{type:"text",text:"<JSON-stringified {agents: [...]}>"}]}}
# Engineer commit 7b unwrap step: .result.content[0].text | fromjson | .agents
UNWRAPPED=$(echo "$RAW_RESPONSE" | jq -r '.result.content[0].text // "{}"' | jq '.agents // []' 2>/dev/null)
if [[ -z "$UNWRAPPED" || "$UNWRAPPED" == "null" ]]; then
    echo -e "${RED}[ERROR]${NC} Failed to unwrap Agent projection from response" >&2
    echo "Response was: $RAW_RESPONSE" >&2
    exit 1
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
TABLE_DATA=$(echo "$UNWRAPPED" | jq -f "$TPL_FILE")
buildTable "$TABLE_DATA"
