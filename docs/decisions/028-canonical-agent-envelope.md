# ADR-028 — Canonical Agent Envelope: Wire = Projection of Entity

**Status:** SCAFFOLD — drafted at mission-63 Phase 5 Manifest; final ratification at mission-63 W5 closing wave (bilateral architect+engineer ratify).
**Mission:** mission-63 M-Wire-Entity-Convergence
**Date drafted:** 2026-04-28
**Authors:** lily / architect (scaffold); bilateral ratify pending W5

---

## Status flow

| Phase | State | Target |
|---|---|---|
| Scaffold | SCAFFOLD (this commit; W0 bundle PR) | Provides ADR number assignment + initial decision framing |
| W1+W2 | (no change; Hub-side response builders ship; ADR text stable) | — |
| W3 | (no change; adapter-side parsers + render registry ship; ADR text stable) | — |
| W4 | (no change; substrate-self-dogfood verifies; ADR text stable) | — |
| W5 | RATIFIED (bilateral architect+engineer at W5 closing) | Final text incorporates W4 evidence + any in-flight refinements |

---

## Context

mission-62 W4 dogfood + post-P0 substrate recovery cycle 2026-04-28 surfaced 5 calibrations rooted in a single architectural pattern:

- **#17** Hub-rebuild gap in Pass 10 protocol — recovery action smoking gun layer 1 (deployment-skew between Hub source and Hub container)
- **#18** Wire-shape vs entity-shape divergence — Director-prompted framing: *"Agent{} is now first-class managed state object — shouldn't message structure reflect this?"*
- **#19** Schema-rename PRs without state-migration script — smoking gun layer 2 (persisted state schema-drift from PRs #112+#113 code-only renames)
- **#20** Thread-message envelope render-layer gap — `buildPromptText` per-event-type if-ladder; PR #112 fix landed for pulses but not thread_message; symmetric reproduction in mission-62 W4 thread-395
- **#22** Pulse-template stale-content — pulse-template body statically configured per mission rather than synthesized from current phase/state

All 5 trace to one shared root architectural pattern: **per-type case dispatch instead of canonical envelope.** Hub returns flat-field response shapes (`agentId`, `sessionEpoch`, ...); adapter parses by reaching into specific fields; render-layer dispatches on event-type via if-ladder; pulse-template stores body string instead of deriving from state. Each is one variant of the same pattern.

Survey envelope (Director-ratified Phase 3 of mission-63): Q1=A+B (calibration retire + substrate fidelity); Q4=A (both Hub-output + adapter-render layers ship together); Q5=E (clean cutover, no legacy co-existence); Q6=A (substrate, full 5-requirement self-dogfood).

---

## Decision

**All Agent-state-bearing wire surfaces conform to a canonical envelope shape that mirrors the Agent entity contract.**

### Wire shape

```typescript
interface CanonicalAgentEnvelope {
  ok: boolean;                        // Operation outcome (root-level)
  agent: AgentProjection;             // Entity projection (canonical)
  session?: SessionBindingState;      // Present on handshake-bearing responses
  wasCreated?: boolean;               // Operation outcome (register_role only)
  // Error-shape (when ok=false): { ok: false, code, message }
}

interface AgentProjection {
  id: string;                          // Canonical entity ID (post-PR-#113 rename Agent.id)
  name: string;                        // Display name from globalInstanceId; `name = id` fallback for legacy records
  role: "engineer" | "architect" | "director";
  livenessState: "online" | "degraded" | "unresponsive" | "offline";
  activityState: "online_idle" | "online_working" | "online_quota_blocked" | "online_paused" | "offline";
  labels: Record<string, string>;
  clientMetadata?: AgentClientMetadata;     // Optional (legacy records may lack)
  advisoryTags?: AgentAdvisoryTags;          // Optional (legacy records may lack)
  // Internal/operational fields stay OFF wire: fingerprint, currentSessionId, lastSeenAt, archived, recentErrors, restartHistoryMs
}

interface SessionBindingState {
  epoch: number;
  claimed: boolean;
  trigger?: "explicit_claim" | "sse_subscribe" | "first_tool_call";
  displacedPriorSession?: { sessionId: string; epoch: number };
}
```

### Adapter render contract

Adapter consumes via single canonical pipeline:

```typescript
function buildPromptText(envelope: CanonicalEventEnvelope): string {
  return registry.get(envelope.event)(envelope);
}
```

`buildPromptText` discriminates on `envelope.event` via a registry of templates (one per event-type). Adding a new event-type = registering a template; no if-ladder branch addition (O(1) instead of O(N)).

### State migration discipline (companion)

Schema-rename PRs that touch persisted entity fields MUST include a migration script under `scripts/migrate-*.ts` (one-shot; idempotent; Hub-stopped self-check). PR description includes operator-runbook section. Pass 10 protocol extension codifies the requirement.

---

## Consequences

**Positive:**
- Renames at Hub-side propagate through wire by construction (TS-LSP-equivalent rename + tests catch breakage)
- Adding new event-types is O(1) — register a render-template; no if-ladder branch addition cost
- Internal fields stay OFF wire (operational/administrative); selective surfacing via separate idea-220 Phase 2 (engineer-side parity gap)
- Schema-rename PRs with migration-script discipline retire the recovery-via-P0 pattern (mission-62 P0 root-cause class)
- Pulse-template stale-content gap retires via "template = derived view of state" principle (calibration #22)

**Negative / trade-offs:**
- Clean cutover (no co-existence period) breaks legacy callers at migration time — acceptable in single-tenant deployment per anti-goal §8.1
- Engineer-side adapter (vertex-cloudrun) is stub-only this mission; full parity in idea-220 Phase 2 (anti-goal §8.2)
- Migration script + Pass 10 protocol extension are NEW deliverables (sizing pressure: L on paper / M+ in flight)

**Forward consequences:**
- Future Agent fields (livenessState, activityState, name) ride the same envelope without parser updates
- API v2.0 (idea-121) absorbs canonical envelope shape naturally if it ships
- Pulse-template synthesis (calibration #22) becomes natural extension of envelope-state-projection principle

---

## Sealed companions

- **ADR-013 + ADR-014** (Threads 2.0 stagedActions) — architectural-precedent: Threads 2.0 already adopts canonical envelope `{kind, type, payload}` at the thread-action surface; this ADR generalizes the same pattern to Agent-state-bearing wire surfaces. Round-1 audit confirmed pattern-precedent.
- **ADR-017 INV-AG6** — 4-state liveness FSM preserved; this ADR doesn't change FSM
- **ADR-018** — cognitive pipeline modular contract; orthogonal to canonical envelope (cognitive intercepts at CallTool/response boundary; canonical envelope governs SSE/notification → buildPromptText boundary; round-1 audit confirmed no conflict)

---

## Cross-references

- **Mission:** mission-63 M-Wire-Entity-Convergence (this ADR ratifies at W5)
- **Source idea:** idea-219 (Wire-Entity Envelope Convergence + Schema-Migration Discipline; incorporated → mission-63)
- **Design v1.0:** `docs/designs/m-wire-entity-convergence-design.md` (canonical envelope + render registry + migration script + Pass 10 ext detail)
- **Survey envelope:** `docs/designs/m-wire-entity-convergence-survey.md` (Director-ratified composite intent)
- **Preflight:** `docs/missions/m-wire-entity-convergence-preflight.md` (verdict GREEN; activation pending Director)
- **Architectural precedents:** mission-62 (P0 surfaced 5 calibrations covered by this ADR); mission-61 (Layer-3 SDK-tgz-stale lesson + Path A SSE-push); mission-56 (substrate-self-dogfood substrate canonical execution)
- **Calibrations retired by this ADR:** #17, #18, #19, #20, #22 (per mission-62 W5 closing audit)
- **Calibrations NOT retired (idea-220 Phase 2 territory):** #15, #16, #21, #23

---

## Status flow at W5

At W5 closing, this ADR scaffold is bilaterally ratified by architect+engineer:
1. W4 dogfood evidence captured in `docs/audits/m-wire-entity-convergence-w4-validation.md` is referenced
2. Implementation refinements surfaced during W1-W3 are folded into the ADR text
3. Status flips from SCAFFOLD → RATIFIED
4. Ratification thread (similar to mission-62's thread-393 pattern) bilateral seal

---

*Scaffold drafted at mission-63 Phase 5 Manifest 2026-04-28; final ratification pending W5 closing wave.*
