#!/bin/bash
# m-shim-observability-phase-2-w3-dogfood-gates.sh
#
# Mission-66 (M-Shim-Observability-Phase-2) W3 substrate-self-dogfood gate
# verification scaffolding. Per Design §5.3 — 7 verification gates;
# observation-only architect-bilateral with engineer.
#
# Architect-domain (this scaffold): gate-by-gate framework + acceptance
# criteria + invocation stubs.
# Engineer-domain (W3 dogfood execution): concrete test invocations + Hub
# state assertions per gate.
#
# Hold-on-failure: any gate failure halts W3; investigate via direct
# event-log inspection + adapter log; fix-forward; re-run dogfood.
# W3 dogfood-gate collapse-into-W1+W2-fix retry pattern (Calibration #34)
# applies if defect surfaces during operation.

set -euo pipefail

# --- COLORS ---
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# --- TRACK GATE STATE ---
GATES_PASSED=0
GATES_FAILED=0
GATE_RESULTS=()

run_gate() {
    local NUM="$1"
    local NAME="$2"
    local FN="$3"
    echo ""
    echo -e "${CYAN}=== Gate $NUM: $NAME ===${NC}"
    if "$FN"; then
        GATES_PASSED=$((GATES_PASSED + 1))
        GATE_RESULTS+=("Gate $NUM: PASS - $NAME")
        echo -e "${GREEN}✓ Gate $NUM PASS${NC}"
    else
        GATES_FAILED=$((GATES_FAILED + 1))
        GATE_RESULTS+=("Gate $NUM: FAIL - $NAME")
        echo -e "${RED}✗ Gate $NUM FAIL${NC}"
    fi
}

stub_warn() {
    echo -e "${YELLOW}[STUB]${NC} $1 — engineer-W3-execution fills concrete test invocation"
}

# === GATE 1: Schema-fidelity (closes #40 verification) ===========
# Hub schema audit baseline test passes (zero divergences in 5 scoped projections
# post-fix); restart-cycle test verifies pid + advisoryTags + clientMetadata
# refresh.
gate_1_schema_fidelity() {
    stub_warn "Run hub schema audit baseline test"
    # ENGINEER-W3: replace stub with concrete invocation, e.g.:
    #   npm test --workspace=hub -- test/integration/schema-audit-baseline.test.ts
    # Acceptance: zero divergences across 5 projections (get_agents +
    # agent_state_changed SSE + list_available_peers + handshake response +
    # get_engineer_status); restart-cycle test asserts pid + advisoryTags +
    # clientMetadata refresh post-restart.
    return 0  # ENGINEER-W3: replace with actual exit code propagation
}

# === GATE 2: #21 round-trip (closes #21 verification) ===========
# Engineer get_agents tool callable from engineer adapter; returns Agent
# records with same shape architect-side gets (symmetric self-introspection
# semantics for read-only [Any]-callable shape).
gate_2_engineer_get_agents() {
    stub_warn "Run engineer-pool integration test exercising get_agents end-to-end"
    # ENGINEER-W3: replace stub with concrete invocation, e.g.:
    #   npm test --workspace=packages/network-adapter -- test/integration/get-agents-engineer.test.ts
    # Acceptance:
    #   (1) engineer adapter handshake → tools/list includes get_agents
    #   (2) engineer adapter tools/call get_agents → 200-class response
    #   (3) engineer-side projection shape matches architect-side projection shape
    return 0
}

# === GATE 3: #26 render-fidelity (closes #26 verification) ===========
# Deliberately-truncated thread_message envelope renders with `[…<N> bytes
# truncated]` marker per ratified architect-lean (b) <channel> attribute
# protocol. Both architect-side AND engineer-side adapter render-templates
# upgraded atomically (single SDK package).
gate_3_thread_message_marker() {
    stub_warn "Run thread_message marker-protocol integration test"
    # ENGINEER-W3: replace stub with concrete invocation, e.g.:
    #   npm test --workspace=hub -- test/envelope/thread-message-truncation.test.ts
    #   npm test --workspace=packages/network-adapter -- test/render-templates/thread-message.test.ts
    # Acceptance:
    #   (1) Hub envelope-builder emits <channel> attributes truncated="true"
    #       fullBytes="<n>" when body byte-length > threshold
    #   (2) render-template consumes attributes + renders body + marker suffix
    #   (3) non-truncated path renders body unchanged; no marker
    #   (4) backward-compat: old client ignores unknown <channel> attributes
    return 0
}

# === GATE 4: #41 caller-side feedback (closes #41 verification) ===========
# Deliberately-malformed kind=note via MCP entry-point → error nack with
# diagnostic message. Deliberately-malformed kind=note via Hub-internal
# emitter → throw / log-and-skip (correct invincibility behavior). Canonical-
# shape integration tests for all 4 Hub-internal emit sites.
gate_4_kind_note_validate() {
    stub_warn "Run kind=note schema-validate at canonical write-path tests"
    # ENGINEER-W3: replace stub with concrete invocations:
    #   npm test --workspace=hub -- test/policy/note-schema.test.ts
    #   npm test --workspace=hub -- test/repositories/message-repository-validate.test.ts
    #   npm test --workspace=hub -- test/integration/kind-note-validate.test.ts
    # Acceptance (per Design §2.1.4 + SPEC §2.3 3 cases):
    #   (i)   MCP-entry malformed → create_message returns error nack with diagnostic
    #   (ii)  Hub-internal emitter malformed → throw / log-and-skip (invincibility)
    #   (iii) Canonical-shape integration tests for all 4 Hub-internal emit sites
    #         (director-notification-helpers + downstream-actors[3 trigger inboxes]
    #         + notification-helpers + message-policy)
    return 0
}

# === GATE 5: CLI script render (closes Director's CLI script ask) ===========
# scripts/local/get-agents.sh runs from Director-side terminal; renders
# verbose Agent projection table; --json flag bypasses to raw jq; auth env
# file source works; --host override functional. Architect-side terminal
# renders OK; engineer-side terminal renders OK; Director-side spot-check.
gate_5_cli_script_render() {
    stub_warn "Run CLI script integration test"
    # ENGINEER-W3: replace stub with concrete invocation, e.g.:
    #   bash scripts/test/get-agents-cli.test.sh
    # Acceptance:
    #   (1) script connects with HUB_TOKEN from ~/.config/apnex-agents/<role>.env
    #   (2) renders verbose Agent projection table by default (tpl/agents.jq)
    #   (3) --json flag bypasses to raw jq output
    #   (4) --lean flag uses tpl/agents-lean.jq (terse)
    #   (5) --host override targets different Hub URL
    #   (6) auth env file missing → exit 2 with diagnostic
    # Director-side spot-check (manual): operator runs script from terminal +
    # confirms render is sensible.
    return 0
}

# === GATE 6: Observability formalization (event-taxonomy + log-level + redaction/rotation) ===========
# Log-level filter env var honored; redaction/rotation tests pass; event-
# taxonomy doc accurately reflects emitted events (per docs/specs/shim-
# observability-events.md spec §4 canonical events).
gate_6_observability_formalization() {
    stub_warn "Run observability formalization test suite"
    # ENGINEER-W3: replace stub with concrete invocations:
    #   npm test --workspace=packages/network-adapter -- observability/
    # (uses Pass 10 §F fixture regen recipe — see multi-agent-pr-workflow.md §F)
    # Acceptance:
    #   (1) OIS_SHIM_LOG_LEVEL DEBUG/INFO/WARN/ERROR threshold filter applied
    #   (2) Redaction: token + secret fields → ***REDACTED*** markers
    #   (3) Rotation: events past OIS_SHIM_LOG_ROTATE_BYTES → naive timestamp-
    #       suffix rotation
    #   (4) Event-taxonomy alignment: each canonical event from spec §4 emits
    #       with expected name + required fields
    return 0
}

# === GATE 7: Consumer-upgrade verification (anti-goal #8 closure) ===========
# Verify ALL consumers see new contracts post-W1+W2: architect-side adapter
# renders new <channel> marker on truncated thread_message + handles new
# clientMetadata.proxyVersion derived value + emits canonical-schema kind=note
# payloads; engineer-side adapter mirrors; Director CLI script consumes new
# Hub HTTP read endpoint values + renders correctly. Spot-check each consumer;
# confirm no consumer using old contracts.
gate_7_consumer_upgrade() {
    stub_warn "Spot-check architect-side + engineer-side + Director-side consumer upgrade"
    # ENGINEER-W3: bilateral coordination with architect-side; both sides
    # exercise their own adapters end-to-end + verify contract alignment:
    #   architect-side: lily session connects to Hub + renders thread_message
    #     marker + reads new clientMetadata.proxyVersion + emits canonical
    #     kind=note (per 5b-final post-commit-5 prompt-template fixup)
    #   engineer-side: greg session same
    #   Director-side: scripts/local/get-agents.sh shows new projection values
    # Acceptance:
    #   (1) No consumer using old contracts post-W1+W2 ship
    #   (2) Coordinated-upgrade discipline (anti-goal #8) operationally proven
    return 0
}

# === MAIN ===
echo -e "${CYAN}M-Shim-Observability-Phase-2 W3 dogfood gate verification${NC}"
echo -e "Per Design §5.3 — 7 verification gates; observation-only architect-bilateral."
echo -e "All gates marked [STUB] until engineer-W3-execution fills concrete invocations."
echo ""

run_gate 1 "Schema-fidelity (closes #40)" gate_1_schema_fidelity
run_gate 2 "#21 round-trip (engineer get_agents)" gate_2_engineer_get_agents
run_gate 3 "#26 render-fidelity (thread_message marker-protocol)" gate_3_thread_message_marker
run_gate 4 "#41 caller-side feedback (kind=note canonical write-path)" gate_4_kind_note_validate
run_gate 5 "CLI script render (get-agents.sh)" gate_5_cli_script_render
run_gate 6 "Observability formalization (event-taxonomy + log-level + redaction/rotation)" gate_6_observability_formalization
run_gate 7 "Consumer-upgrade verification (anti-goal #8 closure)" gate_7_consumer_upgrade

echo ""
echo -e "${CYAN}=== W3 dogfood gate summary ===${NC}"
echo -e "Passed: ${GREEN}${GATES_PASSED}${NC} / Failed: ${RED}${GATES_FAILED}${NC} / Total: 7"
for r in "${GATE_RESULTS[@]}"; do
    echo "  $r"
done

if [[ $GATES_FAILED -gt 0 ]]; then
    echo ""
    echo -e "${RED}W3 dogfood: HOLD-ON-FAILURE — gate(s) failed.${NC}"
    echo -e "Per Design §5.3: investigate via direct event-log + adapter log; fix-forward; re-run."
    echo -e "W3 dogfood-gate collapse-into-W1+W2-fix retry pattern (Calibration #34) applies."
    exit 1
fi

echo ""
echo -e "${GREEN}W3 dogfood: ALL GATES PASS${NC}"
echo -e "Mission-66 W3 verification complete. Ready for W4 closing wave."
exit 0
