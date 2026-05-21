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
# Auth: sources ~/.config/apnex-agents/<role>.env for HUB_API_TOKEN; sets
# Authorization: Bearer ${HUB_API_TOKEN} header on curl.
#
# Usage:
#   get-agents.sh                           # default: --role director, table render
#   get-agents.sh --role architect          # use architect creds
#   get-agents.sh --json                    # raw JSON-RPC response (jq .)
#   get-agents.sh --lean                    # terse table (id + role + status only)
#   get-agents.sh --host https://my-hub     # override the resolved Hub URL
#
# bug-111 — the local Hub (localhost:8080) was decommissioned at mission-86
# W5.4. The Hub URL is now resolved at runtime: --host flag > HUB_URL env >
# .ois/adapter-config.json `hubUrl`. There is no hardcoded localhost default.

set -euo pipefail

# --- DEFAULTS ---
DEFAULT_ROLE="director"
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
TPL_DIR="${SCRIPT_DIR}/tpl"
# bug-111 — operator config for runtime Hub-URL resolution. `.ois/` lives at the
# repo root (the adapter's WORK_DIR); the script is at scripts/local/.
ADAPTER_CONFIG="$(readlink -f "${SCRIPT_DIR}/../../.ois/adapter-config.json")"

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
  --role <r>     Source ~/.config/apnex-agents/<r>.env for HUB_API_TOKEN (default: director)
  --host <url>   Hub base URL override; /mcp appended automatically. Default:
                 resolved from HUB_URL env or .ois/adapter-config.json 'hubUrl'.
  --json         Bypass table render; print raw JSON-RPC response via jq .
  --lean         Use terse template (id + role + status); default uses verbose template
  --help / -h    Show this help

Exit codes:
  0  success
  1  Hub API error or curl failure
  2  setup error — auth env file/token missing, or Hub URL unresolved
  3  invalid args

Reference: /home/apnex/taceng/table/prism.sh (table-rendering pattern).
USAGE
}

# --- ARG PARSE ---
# (engineer commit 7b: hoisted usage() above arg-parse block to fix pre-7b
# forward-reference error — `usage: command not found` on `--help` flag.)
HOST=""               # empty until --host flag or runtime resolution sets it
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
    echo "        Expected format: HUB_API_TOKEN=<bearer-token>" >&2
    exit 2
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
if [[ -z "${HUB_API_TOKEN:-}" ]]; then
    echo -e "${RED}[ERROR]${NC} HUB_API_TOKEN unset in $ENV_FILE" >&2
    exit 2
fi

# --- HUB URL RESOLUTION (bug-111) ---
# Precedence: --host flag > HUB_URL env (set in the environment or the sourced
# env file) > .ois/adapter-config.json `hubUrl`. The decommissioned
# localhost:8080 default is gone — an unresolved Hub URL is a hard error.
if [[ -z "$HOST" ]]; then
    if [[ -n "${HUB_URL:-}" ]]; then
        HOST="$HUB_URL"
    elif [[ -f "$ADAPTER_CONFIG" ]]; then
        HOST="$(jq -r '.hubUrl // empty' "$ADAPTER_CONFIG" 2>/dev/null || echo "")"
    fi
fi
# adapter-config.json's `hubUrl` carries the /mcp suffix; call_get_agents
# appends /mcp itself, so normalise HOST to a bare base URL.
HOST="${HOST%/}"
HOST="${HOST%/mcp}"
HOST="${HOST%/}"
if [[ -z "$HOST" ]]; then
    echo -e "${RED}[ERROR]${NC} Could not resolve a Hub URL." >&2
    echo "        Tried: --host flag, \$HUB_URL, ${ADAPTER_CONFIG} ('hubUrl')." >&2
    echo "        Pass --host <url>, export HUB_URL, or populate .ois/adapter-config.json." >&2
    exit 2
fi

# --- buildTable() — extracted to mod.core (mission-75 v1.0) ------------------
#
# `buildTable()` is now hosted in `scripts/local/mod.core` per Director CLI
# consolidation ask (Design v1.0 §3.6 v1.0 fold; first canonical instance
# of the lib-extraction discipline pattern per
# `feedback_design_phase_lib_extraction_for_substrate_bash.md`). idea-243
# captures the systemic follow-on (migrate all operator CLIs to source
# mod.core).
# shellcheck source=./mod.core
source "${SCRIPT_DIR}/mod.core"

# --- call_get_agents() — engineer commit 7b + post-mission-66 fix-forward ---
#
# 2-step MCP-over-HTTP handshake against ${HOST}/mcp with Bearer auth:
#   (1) POST `initialize` → captures Mcp-Session-Id from response headers
#   (2) POST `tools/call get_agents` with Mcp-Session-Id header → projection
#
# Reference: hub/src/hub-networking.ts:702-776 — Hub /mcp POST is a stateful
# StreamableHTTPServerTransport per @modelcontextprotocol/sdk; requires
# session-init handshake before tool-calls. Single-step POST returns 400
# "Bad Request: No valid session ID provided" (case 3 in handler).
#
# Hub responses are SSE-style framed (`event: message\ndata: <JSON>`); helper
# strips the SSE wrapper to extract the JSON-RPC envelope.
#
# Returns: JSON-RPC envelope (post-SSE-strip) on stdout. Caller (main flow)
# checks `.error` then unwraps `.result.content[0].text` for projection.
# On curl failure: emits a synthetic JSON-RPC error envelope so caller's
# `.error` check fires uniformly.

# strip_sse_event: extract JSON-RPC body from SSE-framed response.
# Input format: "event: message\r\ndata: <JSON>\r\n\r\n..."
# Output: <JSON> on stdout (or input unchanged if no SSE framing).
strip_sse_event() {
    local INPUT="$1"
    if echo "$INPUT" | head -1 | grep -q "^event:"; then
        echo "$INPUT" | grep "^data:" | head -1 | sed 's/^data: //'
    else
        echo "$INPUT"
    fi
}

call_get_agents() {
    local URL="${HOST}/mcp"
    local AUTH="Authorization: Bearer ${HUB_API_TOKEN}"
    local ACCEPT="Accept: application/json, text/event-stream"
    local CT="Content-Type: application/json"

    # ── Step 1: initialize handshake ─────────────────────────────────
    local INIT_BODY='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"get-agents-cli","version":"1.0.0"}}}'
    local INIT_RESPONSE INIT_HEADERS_FILE
    INIT_HEADERS_FILE=$(mktemp)
    if ! INIT_RESPONSE=$(curl -sS -D "$INIT_HEADERS_FILE" -X POST "$URL" \
        -H "$AUTH" -H "$ACCEPT" -H "$CT" \
        -d "$INIT_BODY" 2>&1); then
        rm -f "$INIT_HEADERS_FILE"
        printf '{"jsonrpc":"2.0","error":{"code":-32603,"message":"curl init failure: %s"}}\n' \
            "$(echo "$INIT_RESPONSE" | head -1 | sed 's/"/\\"/g')"
        return 0
    fi

    # Extract session-id from response headers (case-insensitive header lookup)
    local SESSION_ID
    SESSION_ID=$(grep -i "^mcp-session-id:" "$INIT_HEADERS_FILE" | sed 's/^[Mm][Cc][Pp]-[Ss]ession-[Ii][Dd]: *//' | tr -d '\r\n')
    rm -f "$INIT_HEADERS_FILE"

    if [[ -z "$SESSION_ID" ]]; then
        printf '{"jsonrpc":"2.0","error":{"code":-32603,"message":"Hub did not return Mcp-Session-Id header on initialize"}}\n'
        return 0
    fi

    # ── Step 2: tools/call get_agents with session ──────────────────
    local CALL_BODY='{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_agents","arguments":{}}}'
    local CALL_RESPONSE
    if ! CALL_RESPONSE=$(curl -sS -X POST "$URL" \
        -H "$AUTH" -H "$ACCEPT" -H "$CT" \
        -H "Mcp-Session-Id: ${SESSION_ID}" \
        -d "$CALL_BODY" 2>&1); then
        printf '{"jsonrpc":"2.0","error":{"code":-32603,"message":"curl call failure: %s"}}\n' \
            "$(echo "$CALL_RESPONSE" | head -1 | sed 's/"/\\"/g')"
        return 0
    fi

    # Strip SSE framing → emit JSON-RPC envelope.
    strip_sse_event "$CALL_RESPONSE"
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
