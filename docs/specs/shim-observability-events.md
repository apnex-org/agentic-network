# Shim observability — canonical event taxonomy (v1)

**Status:** v1 namespace (mission-66 = M-Shim-Observability-Phase-2 W1+W2 atomic ships; ADR-031 §1)
**Schema version:** 1
**Authors:** lily / architect (W1+W2 commit 1 — architect-domain docs); ratified bilaterally with greg / engineer at W4 closing
**ADR:** [`docs/decisions/031-shim-observability.md`](../decisions/031-shim-observability.md)
**Methodology:** [`docs/methodology/multi-agent-pr-workflow.md`](../methodology/multi-agent-pr-workflow.md) §F (shim observability dirty-state regeneration)

---

## §1 Purpose

Canonical specification for shim observability events emitted by the network-adapter SDK + claude-plugin adapter shim. Events flow through `FileBackedLogger` to `WORK_DIR/.ois/shim-events.ndjson` (per `OIS_SHIM_EVENTS_FILE` env var; see `reference_shim_observability.md`).

This doc defines:
- Event namespace convention
- Per-event field schema with redaction rules
- Stability commitments + deprecation policy
- Process for adding new events

**Out of scope (this doc):** adapter log file format (free-form text; `OIS_SHIM_LOG_FILE`); structured event consumers (vertex-cloudrun engineer-side parity is Phase 3 mission scope).

---

## §2 Namespace convention

Event names follow `shim.<domain>.<event>` pattern:

- `shim.` — fixed prefix indicating origin from network-adapter / claude-plugin shim
- `<domain>` — coarse-grained category (`handshake` | `dispatcher` | `cognitive` | `kernel` | `lifecycle`)
- `<event>` — specific event (e.g., `parse_failure`, `call_tool`, `bypass`)

**v1 namespace** is implicit (no version suffix in event name); future namespace bumps use suffix (e.g., `shim.v2.handshake.parse_failure`).

---

## §3 Common fields (all events)

Every emitted event includes:

| Field | Type | Notes |
|---|---|---|
| `eventName` | string | required; matches `shim.<domain>.<event>` pattern |
| `timestamp` | string (ISO-8601 UTC) | required; emit-time |
| `agentId` | string \| null | required; resolved from session-claim if available; `null` pre-handshake |
| `_deprecated` | boolean (optional) | when present + true, event is deprecated; consumers should migrate |

**Common-field redaction:** none of the common fields contain sensitive data; not redacted.

---

## §4 Canonical events (v1)

### §4.1 `shim.handshake.parse_failure`

Emitted when handshake response from Hub fails to parse against expected SDK contract.

| Field | Type | Required | Redaction | Notes |
|---|---|---|---|---|
| `errorMessage` | string | yes | none | parser error message |
| `errorPath` | string | optional | none | JSON path within response where parse failed |
| `responseFingerprint` | string (16-char hex) | yes | none | SHA-256 prefix of response body; correlation aid |
| `responseBytes` | integer | yes | none | response body byte length |
| `attemptCount` | integer | optional | none | retry attempt # within handshake cycle |

**Diagnostic value:** surfaced calibration #19 root cause (mission-62 P0 schema-rename without state migration); retained as canonical Phase 1 event.

### §4.2 `shim.dispatcher.call_tool`

Emitted when adapter dispatches an MCP tool call.

| Field | Type | Required | Redaction | Notes |
|---|---|---|---|---|
| `toolName` | string | yes | none | MCP tool method name |
| `argsHash` | string (16-char hex) | yes | bodies hashed-not-stored | SHA-256 prefix of args object; correlation only |
| `argsBytes` | integer | yes | none | args body byte length |
| `correlationId` | string | yes | none | request correlation ID |

**Diagnostic value:** trace tool-dispatch volume + correlation; useful for #40 projection-fidelity audits.

### §4.3 `shim.dispatcher.call_tool_result`

Emitted when MCP tool call returns (success or error).

| Field | Type | Required | Redaction | Notes |
|---|---|---|---|---|
| `toolName` | string | yes | none | matches preceding call_tool event |
| `correlationId` | string | yes | none | matches preceding call_tool event |
| `outcome` | enum | yes | none | `ok` \| `error` |
| `errorClass` | string | optional | none | when outcome=error |
| `durationMs` | integer | yes | none | call-to-result duration |

### §4.4 `shim.cognitive.bypass`

Emitted when cognitive pipeline is bypassed (e.g., `OIS_COGNITIVE_BYPASS=1` env var or per-stage skip).

| Field | Type | Required | Redaction | Notes |
|---|---|---|---|---|
| `reason` | enum | yes | none | `env_var` \| `per_stage_skip` \| `init_failure` |
| `stage` | string | optional | none | which cognitive stage was bypassed (when `per_stage_skip`) |

### §4.5 `shim.kernel.handshake_started`

Emitted at handshake initiation.

| Field | Type | Required | Redaction | Notes |
|---|---|---|---|---|
| `targetUrl` | string | yes | none | Hub MCP endpoint |
| `clientMetadataHash` | string (16-char hex) | yes | bodies hashed-not-stored | SHA-256 prefix of clientMetadata; correlation only |

### §4.6 `shim.lifecycle.shim_started`

Emitted at shim process startup.

| Field | Type | Required | Redaction | Notes |
|---|---|---|---|---|
| `pid` | integer | yes | none | shim process pid |
| `proxyVersion` | string | yes | none | per #40 closure: derived from package.json (no longer hardcoded) |
| `nodeVersion` | string | yes | none | runtime Node.js version |

### §4.7 `shim.lifecycle.shim_stopping`

Emitted at shim process graceful shutdown.

| Field | Type | Required | Redaction | Notes |
|---|---|---|---|---|
| `pid` | integer | yes | none | shim process pid |
| `reason` | enum | optional | none | `signal_term` \| `signal_int` \| `internal_error` |

---

## §5 Redaction discipline

Per ADR-031 §5 + Phase 1 lineage (`reference_shim_observability.md`):

- **Token + secret fields** redacted at FileBackedLogger emit boundary; markers like `***REDACTED***` if logged inadvertently
- **Structured payload bodies** are hashed-not-stored (use `argsHash` + `argsBytes` correlation pair, NOT raw `args` field)
- **HUB_TOKEN** and equivalent auth credentials never emitted in event fields
- **Per-field redaction rules** documented in this spec (§4 tables)

---

## §6 Stability commitments

### §6.1 v1 namespace stability

For the v1 namespace (this spec):
- **Event names** in §4 are stable; backward-incompat changes require namespace bump (v2)
- **Required fields** are stable; new required fields require namespace bump
- **Optional fields** may be added permissively (consumers ignore unknown fields)
- **Field types** are stable (no string→integer or vice versa)
- **Field semantics** are stable (a field's meaning doesn't shift)

### §6.2 Deprecation policy

When a v1 event is to be retired in v2:
- Emit with `_deprecated: true` field flag for ≥1 minor cycle before removal
- Emit migration guidance via deprecation announcement event (e.g., `shim.deprecated.parse_failure_v1` with `migrateTo` field pointing to new event name)
- Consumers should log deprecation + plan migration

### §6.3 Coordinated upgrade discipline (per ADR-031 §7 + anti-goal #8)

When event-taxonomy changes ship:
- W1+W2 atomic ships ALL consumer upgrades alongside producer changes
- Backward-compat is upgrade-discipline at W1+W2, not Design-time architectural commitment
- Phase 3 mission (vertex-cloudrun engineer-side observability parity) inherits stable v1 contract; consumers binding to v1 don't break across producer evolutions

---

## §7 Process for adding new events

1. **File PR with new event spec** in this doc (§4 addition)
2. **Bilateral architect+engineer review** (calibration #24 dual-surface)
3. **Hub OR adapter team implements** the emitter (mission-class L+ scope; substrate-introduction class signature for events that change consumer contracts)
4. **One-cycle dogfood** (W3 dogfood gate exercise) before consumer-broadcast

**Anti-goal:** NO LLM-side autonomous event spec authoring (architect-authored; LLMs read-only at observability layer per ADR-031 anti-goal preserved).

---

## §8 References

- ADR-031 (`docs/decisions/031-shim-observability.md`) — architectural commitments
- `docs/methodology/multi-agent-pr-workflow.md` Pass 10 §F — dirty-state regeneration discipline
- `reference_shim_observability.md` memory — Phase 1 paths + env vars (`OIS_SHIM_LOG_FILE`, `OIS_SHIM_EVENTS_FILE`, `OIS_SHIM_LOG_ROTATE_BYTES`, `OIS_SHIM_LOG_LEVEL` NEW M6)
- ADR-028 — canonical wire envelope (related: `<channel>` envelope element host for #26 marker-protocol)

---

*v1 namespace shipped 2026-04-29 at mission-66 W1+W2 atomic commit 1 (architect-domain docs); RATIFIED at W4 closing wave per ADR-031 status flow.*
