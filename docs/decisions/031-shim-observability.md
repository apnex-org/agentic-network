# ADR-031 — Shim observability is a formal versioned event taxonomy with canonical naming + stability commitments + deprecation policy

**Status:** **RATIFIED** — bilateral architect+engineer ratification at mission-66 W4 closing wave 2026-04-29T~09:10Z UTC (post-PR #135 admin-merge; thread-430 round-2 converged; thread-431 round-2 W3 dogfood option-(a) ratified).
**Mission:** mission-66 (M-Shim-Observability-Phase-2; idea-220 Phase 2)
**Date drafted:** 2026-04-29T06:25Z UTC (SCAFFOLD)
**Date ratified:** 2026-04-29T~09:10Z UTC (RATIFIED at W4 closing)
**Authors:** lily / architect (drafted + ratified); greg / engineer (round-1 audit thread-422; W1+W2 PR audit thread-430; W3 dogfood thread-431; bilateral ratify)

---

## Status flow

| Phase | State | PR | Notes |
|---|---|---|---|
| Scaffold | SCAFFOLD | #134 (W0 bundle) | ADR number assignment + initial decision framing |
| W1+W2 atomic | (no change; ADR text stable) | #135 | 16 commits per R8 mitigation; bilateral co-execution per Q5/RACI; coordinated-upgrade anchor per-commit per anti-goal #8; admin-merged at `2f66da5` |
| W3 dogfood gate | (no change; verification-only) | — | Option-(a) lightweight verification ratified at thread-431; engineer-W3 fills 7 gate STUBs in `scripts/test/m-shim-observability-phase-2-w3-dogfood-gates.sh`; folds into W4 closing PR |
| W4 closing | **RATIFIED** | TBD this PR | idea-survey.md fixup-N/A + #48 + #49 + #57 methodology-doc folds + #21/#26/#40/#41 status flips + Phase 10 retrospective + closing audit + W4-origin filings via `docs/calibrations.yaml` |

---

## Context

Phase 1 shim observability landed tactically architect-direct during mission-62-W4-followon P0 triage 2026-04-28: FileBackedLogger + structured NDJSON events + dispatcher CallTool instrumentation + handshake parse-failure diagnostic + cognitive bypass knob + redaction discipline + naive timestamp-suffix rotation. Surface immediately surfaced calibration #19 (P0 root cause; schema-rename without state migration) as proof-of-value — 17min recovery vs mission-62's 17h pre-substrate P0.

Phase 1 was tactical (architect-direct; no ADR; ad-hoc event names; no formal namespace; no log-level filter; no canonical event-taxonomy doc). Phase 2 (this ADR) formalizes:
- Canonical event-taxonomy doc + namespace + stability commitments + deprecation policy
- Log-level filter as standard observability hygiene
- Redaction + rotation tests
- Pass 10 §F protocol inclusion (substrate doesn't regress)
- Consumer-binding contract (vertex-cloudrun engineer-side parity in Phase 3 mission inherits v1 namespace unchanged)

Plus carryover scope (4 calibration closures #21 + #26 + #40 + #41) + Director's CLI script (`scripts/local/get-agents.sh` over `/mcp` JSON-RPC).

---

## Decision

### 1. Canonical event taxonomy doc + namespace convention

**Path:** `docs/specs/shim-observability-events.md` (NEW; W1+W2 atomic ships)

**Namespace convention:** `shim.<domain>.<event>` (e.g., `shim.handshake.parse_failure`, `shim.dispatcher.call_tool`, `shim.cognitive.bypass`).

**v1 namespace** ships this mission. Future namespaces (v2+) require new ADR or amendment per `multi-agent-pr-workflow.md` ADR-amendment scope discipline.

### 2. Event field schema per event

Each canonical event documented with:
- Required fields (always present; e.g., `timestamp`, `agentId`, `eventName`)
- Optional fields (per-event metadata)
- Redaction rules per field (e.g., `tokens` redacted; `secrets` redacted; structured payloads redacted at FileBackedLogger emit boundary)

### 3. Log-level filter

`OIS_SHIM_LOG_LEVEL` env var introduces standard observability hygiene:
- `DEBUG` < `INFO` < `WARN` < `ERROR`
- Default `INFO`
- Filter applied at FileBackedLogger emit boundary; below-level events suppressed (no-op)

### 4. Stability commitments

- **Backward-incompat event-name changes** require bumped namespace
- **In-namespace field additions** are permissive (consumers ignore unknown fields per JSON object semantics)
- **Deprecation policy:** `_deprecated: true` field flag for one minor cycle; deprecation announced via event-name suffix (e.g., `shim.handshake.parse_failure_v0_deprecated` → consumers migrate to `shim.handshake.parse_failure`)

### 5. Redaction discipline

Phase 1 redaction discipline preserved + formalized:
- Token + secret fields redacted at FileBackedLogger emit boundary (`***REDACTED***` markers)
- Structured payload bodies hashed-but-not-stored (correlation-id only)
- Per-field redaction rules documented in event-taxonomy doc

### 6. Pass 10 §F protocol inclusion

`docs/methodology/multi-agent-pr-workflow.md` Pass 10 protocol gets new §F:

> **§F Shim observability dirty-state regeneration** — when adapter-source PRs touch `packages/network-adapter/src/observability/**` OR `adapters/claude-plugin/src/shim.ts` event-emit paths, run `npm test --workspace=packages/network-adapter -- observability/` to regenerate redaction/rotation test fixtures + commit fixture diffs alongside PR.

### 7. Coordinated upgrade discipline (substrate-introduction class default)

**Per anti-goal #8 (Director-ratified 2026-04-29) + Design v0.2 STRUCTURAL ANCHOR fold (greg round-1 thread-422 Q8 fold):** 

- W1+W2 atomic ships ALL consumer upgrades alongside Hub-side substrate changes; backward-compat is upgrade-discipline at W1+W2, not Design-time architectural commitment
- Schema-validate substrate gates land at the canonical write-path (e.g., `messageRepository.create()`), NOT only at the public-API entry-point — Hub-internal emit paths bypass MCP-entry validation; only repository-write-path anchor closes bilateral-blind class for ALL emitters under coordinated-upgrade discipline
- Phase 3 mission (vertex-cloudrun engineer-side observability parity) adopts v1 namespace + marker-protocol contracts unchanged at the consumer-binding boundary

These two disciplines compose: **coordinated-upgrade-discipline** (when to ship — atomic across consumers) + **structural-anchor-discipline** (where to ship — canonical substrate gate, not surface entry-point). They are sister disciplines surfaced via this mission; planned-filings as calibrations #48 + #49 at W4 closing audit.

---

## Consequences

### Positive

- Future-P0 diagnostic surface formalized (defeat-recurrence-class for diagnostic-blackhole-at-P0)
- Vertex-cloudrun engineer-side observability parity (Phase 3 mission) inherits stable v1 namespace + marker-protocol contracts (forward-compat preserved at Hub-side; consumers bind to v1)
- Operator surfaces (Director's CLI script + future operator tooling) bind to the same canonical Hub MCP-over-HTTP path adapters use (anti-goal #2 strengthened — no new HTTP REST endpoints + no new MCP tool-surface verbs)
- Bilateral-blind class structurally closed at canonical substrate gate (write-path anchor) for ALL emitters (LLM-callers + Hub-internal emitters)
- Multi-role read-surface symmetry restored (#21 closure: engineer + architect both have `get_agents` access)
- Render-fidelity at thread_message truncation boundary (#26 closure: marker-protocol + consumer-aware rendering)

### Negative / trade-offs

- W1+W2 atomic execution scope is substantial (7 commits + bilateral co-execution + coordinated-upgrade discipline anchor per-commit); substrate-introduction-class signature with potential 5-cycle iteration similar to mission-64 W1+W2-fix-N pattern (R5 risk register)
- Coordinated-upgrade discipline requires comprehensive consumer enumeration; partial-upgrade is anti-goal #8 (load-bearing under structural-anchor-discipline; engineer round-1 audit Q8 surfaces caller-pool enumeration)
- Schema-validate at canonical write-path is invincibility-class behavior (Hub-internal defective emitter throws/log-and-skips); requires adequate test surface for canonical-payload integration tests at all 4 enumerated Hub-internal emit sites

### Forward consequences

- **Phase 3 mission (vertex-cloudrun engineer-side observability parity)** inherits v1 namespace + marker-protocol contracts unchanged
- **Future Hub MCP HTTP read endpoints** (CLI script consumer + future operator surfaces) bind to the same projection canonical values landed by #40 closure
- **Calibration #48 (coordinated-upgrade-discipline)** filed at W4 closing audit; methodology-doc fold to `mission-lifecycle.md` substrate-introduction-class default; tele-3 + tele-7
- **Calibration #49 (structural-anchor-discipline; sister to #48)** filed at W4 closing audit; methodology-doc fold to `mission-lifecycle.md` substrate-introduction-class subsection OR dedicated structural-anchor-discipline doc; tele-3 + tele-6 + tele-7 (invincibility-anchor)
- **Future substrate-introduction missions** inherit both disciplines by default (when to ship + where to anchor)
- **Mission-lifecycle.md context-budget governance** (per ADR-030 §6.2 forward consequence + mission-65 retrospective §7.4): future behavioral-discipline directives in CLAUDE.md or methodology docs should compete for budget; consolidation pass at line ~150-200 mark recurring discipline

---

## Sealed companions

- `docs/methodology/idea-survey.md` v1.0 (Survey methodology; canonical input)
- `docs/methodology/multi-agent-pr-workflow.md` v1.0 ratified-with calibrations (W1+W2 ships Pass 10 §F update)
- `docs/methodology/mission-lifecycle.md` (Phase 4 Design + Phase 9+10 retrospective + standing RACI per Q5; W4 fold target for #48 + #49)
- `docs/specs/shim-observability-events.md` (NEW; W1+W2 atomic ships event taxonomy doc)
- ADR-028 (canonical wire envelope; mission-63 RATIFIED; #26 marker-protocol extends `<channel>` envelope element)
- ADR-029 (npm-publish channel; mission-64 RATIFIED; Pass 10 §B/§D deprecation precedent for §F addition pattern)
- ADR-030 (calibration ledger; mission-65 RATIFIED; M6 calibrations file directly into `docs/calibrations.yaml` from outset)
- idea-220 Phase 2 (source idea; this mission's substrate-fix + formalization scope)
- idea-121 (API v2.0 tool-surface; future ratification of `/calibration-*` Skill verb names + verb-namespace conventions; also ratifies operator-CLI verb-namespace conventions if Phase 3 surfaces them)
- idea-219 (Wire-Entity Envelope Convergence; mission-63 closed via canonical envelope; #26 marker-protocol is downstream extension)

---

## Schema evolution discipline

`v1` namespace shipped this mission. Future schema changes:
- **Backward-incompat event-name changes** (e.g., `shim.handshake.parse_failure` → `shim.protocol.handshake.parse_failure`) bump namespace + ship migration tooling at the upgrading mission
- **In-namespace field additions** are permissive; consumers ignore unknown fields
- **Deprecation policy:** `_deprecated: true` field flag for one minor cycle; deprecation announced via event-name suffix
- **Coordinated upgrade discipline (anti-goal #8)** applies to all schema changes — partial-upgrade is anti-goal; W1+W2 atomic ships ALL consumer upgrades alongside Hub-side schema changes

---

*ADR-031 SCAFFOLD authored 2026-04-29T06:25Z UTC. lily / architect; bilateral ratify pending W4 with greg / engineer per mission-65 ADR-030 + mission-64 ADR-029 + mission-63 ADR-028 RATIFIED precedent.*
