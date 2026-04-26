# Mission-57 (M-Mission-Pulse-Primitive) W0 Spike Report

**Mission:** M-Mission-Pulse-Primitive (mission-57)
**Wave:** W0 — Spike + read-path grep audit
**Author:** greg / engineer
**Date:** 2026-04-26
**Source-of-truth:** Design v1.0 (`docs/designs/m-mission-pulse-primitive-design.md` commit `a8e9aca` on main) §7 W0
**Pre-Design input:** Survey artifact (`docs/designs/m-mission-pulse-primitive-survey.md` commit `a8e9aca`)
**Sizing realized:** ~½d per estimate

---

## §1 Spike scope + verdict

Five D-deliverables per Design v1.0 §7 W0:

| D# | Deliverable | Verdict |
|---|---|---|
| D1 | Mission entity schema grep — verify `mission.tasks` virtual-view + cascade-handlers don't trip on new `pulses` + `missionClass` fields | **GREEN** — additive zod schema; existing virtual-view computation unaffected |
| D2 | `mission-policy.ts` cascade-handlers + `MissionRepository.updateMission` signature check | **YELLOW** — schema additive but signature requires extension at W1 (engineer-noted; non-blocking) |
| D3 | task-316 plannedTasks cascade interaction — CAS via `putIfMatch`; mission-blob-size growth | **GREEN** — `casUpdate` pattern serializes concurrent updates cleanly; pulses field adds ~few hundred bytes |
| D4 | Pulse-adjacent surface inventory — touch-points for W1-W4 sub-PR planning | **GREEN** — 8 touch-points enumerated (3 per W1 + 2 per W2 + 1 per W3 + 2 per W4) |
| D5 | Spike report doc with W2 escalation-key engineer-final note | **THIS DOC** |

**Composite verdict: GREEN with one engineer-noted W1 signature extension** (D2 yellow). No upstream blockers; W1 schema work proceeds as Design v1.0 §3 specifies.

**W2 escalation-key engineer-final lean: Option C** (drop migrationSourceId on escalation Messages; ULID-keyed Message naturally unique; rare-duplicate operationally fine; upgrade to Option A if frequency concern post-ship). Per thread-349 round 8 bilateral; W2 implementer makes the final code-time call.

---

## §2 D1 — Mission entity schema grep

### Schema location

Single source-of-truth: `hub/src/entities/mission.ts` (`interface Mission` at line 71-105). Existing fields:

```typescript
interface Mission {
  id: string;
  title: string;
  description: string;
  documentRef: string | null;
  status: MissionStatus;
  tasks: string[];          // Virtual view — computed from ITaskStore
  ideas: string[];           // Virtual view — computed from IIdeaStore
  correlationId: string | null;
  turnId: string | null;
  sourceThreadId: string | null;
  sourceActionId: string | null;
  sourceThreadSummary: string | null;
  createdBy?: EntityProvenance;
  plannedTasks?: PlannedTask[];  // task-316 / idea-144 Path A (additive)
  createdAt: string;
  updatedAt: string;
}
```

### Virtual-view interaction analysis

`mission.tasks[]` + `mission.ideas[]` are computed at hydrate-time by `MissionRepository.hydrate()` from `ITaskStore` (by `correlationId`) and `IIdeaStore` (by `missionId`). They do not live in the persisted blob.

**Adding `pulses?: { engineerPulse?: PulseConfig; architectPulse?: PulseConfig }` + `missionClass?: MissionClass`:**

- ✅ Both fields are **persisted blob fields**, NOT virtual-view computations
- ✅ `hydrate()` is called after `decode()` reads the persisted JSON; new fields parse cleanly against extended zod schema
- ✅ No interaction with `tasks[]` / `ideas[]` virtual-view code paths (they read from separate stores)
- ✅ Backward compat: existing missions without `pulses` / `missionClass` parse unchanged (zod additive; both optional)

### Cascade-handler interaction analysis

Cascade-handlers in `hub/src/policy/cascade-actions/*.ts` operate on Mission via `MissionRepository.createMission` / `updateMission` / `markPlannedTaskIssued` / `markPlannedTaskCompleted`. None of these touch `pulses` or `missionClass` semantics.

**Conclusion (D1 GREEN):** schema extension is fully additive; no virtual-view or cascade-handler code touches `pulses` or `missionClass` directly. W1 schema work proceeds as specified in Design v1.0 §3.

---

## §3 D2 — mission-policy.ts cascade-handlers + updateMission signature

### Current `update_mission` MCP tool surface

`hub/src/policy/mission-policy.ts:71-150` (`updateMission` policy handler):

```typescript
const updates: {
  status?: MissionStatus;
  description?: string;
  documentRef?: string;
  plannedTasks?: PlannedTask[];
} = {};
```

The handler accepts **4 fields** today: `status`, `description`, `documentRef`, `plannedTasks`. **`pulses` + `missionClass` are NOT accepted via update_mission.**

### Current `MissionRepository.updateMission` signature

`hub/src/entities/mission-repository.ts:138-169`:

```typescript
async updateMission(
  missionId: string,
  updates: {
    status?: MissionStatus;
    description?: string;
    documentRef?: string;
    plannedTasks?: PlannedTask[];
  },
): Promise<Mission | null>
```

Same 4 fields. Schema additive at the entity level (D1 GREEN), but **the policy + repository signatures need extension at W1** to:

1. Accept `pulses?` and `missionClass?` in the `updates` parameter
2. Accept `pulses?` and `missionClass?` in the MCP tool's args validation
3. Strip sweeper-managed bookkeeping fields (`lastFiredAt`, `lastResponseAt`, `missedCount`, `lastEscalatedAt`) at MCP-tool boundary so external callers cannot write them via `update_mission` (only PulseSweeper writes via direct repository update)

### W1 deliverable extension (engineer-noted)

W1 schema work needs:

```typescript
// mission-policy.ts updateMission handler
const updates: {
  status?: MissionStatus;
  description?: string;
  documentRef?: string;
  plannedTasks?: PlannedTask[];
  pulses?: { engineerPulse?: PulseConfig; architectPulse?: PulseConfig };  // NEW
  missionClass?: MissionClass;  // NEW
} = {};
```

```typescript
// mission-repository.ts updateMission signature
async updateMission(
  missionId: string,
  updates: {
    status?: MissionStatus;
    description?: string;
    documentRef?: string;
    plannedTasks?: PlannedTask[];
    pulses?: { engineerPulse?: PulseConfig; architectPulse?: PulseConfig };  // NEW
    missionClass?: MissionClass;  // NEW
  },
): Promise<Mission | null>
```

**Sweeper-managed fields** (`lastFiredAt`, `lastResponseAt`, `missedCount`, `lastEscalatedAt`) are stripped at the MCP-tool boundary in `mission-policy.ts:updateMission` before forwarding to the repository. Per Design v1.0 §3 "Default-injection semantics" + boundary-validation policy.

### Verdict (D2 YELLOW)

**Non-blocking caveat:** the mission-policy + repository signatures need the 2-field extension at W1. This was implicit in Design v1.0 §3 schema spec but worth surfacing explicitly here so W1 implementer doesn't miss the policy + repository signatures alongside the entity-blob zod schema.

`create_mission` policy handler additionally needs to accept `pulses` + `missionClass` at the create-time path; per Design v1.0 §3, missions can declare pulse config at create-time.

---

## §4 D3 — task-316 plannedTasks cascade interaction

### CAS pattern verification

`MissionRepository.casUpdate(missionId, mutator)` (line ~250+) uses `putIfMatch(path, encode(next), read.token)` — the standard ADR-024 single-entity atomic CAS primitive. All Mission entity mutations (status, description, plannedTasks, future pulses bookkeeping) go through `casUpdate`.

**Concurrent-update scenario (PulseSweeper bookkeeping vs review approval cascade):**

1. PulseSweeper updates `mission.pulses.engineerPulse.lastFiredAt` via `casUpdate`
2. Concurrently, review approval cascade updates `mission.plannedTasks[3].status` via `casUpdate` (different `casUpdate` invocation)

Both invocations:
- `getWithToken` to read current state + token
- Mutate in-memory copy
- `putIfMatch(path, next, token)` — wins iff token matches
- Loser retries on token mismatch; reads fresh state; re-applies mutator on top of winner's writes

**Result:** clean serialization. Pulse bookkeeping + plannedTasks advancement do not collide; both updates land. No corruption; no lost updates. Standard CAS retry semantics.

### Mission-blob-size growth

Existing typical Mission entity blob: ~2-4 KB (task ids, ideas ids, plannedTasks at ~100 bytes each × 5-10 tasks, description, etc.).

Pulses field shape (`engineerPulse` + `architectPulse` PulseConfig × ~10 fields each): adds ~400-600 bytes to the blob. Acceptable; well within storage primitive limits (mission-48 ADR-024 single-entity blobs are bounded by GCS / local-fs object size limits at ~MB scale; KB-scale blobs unaffected).

**Verdict (D3 GREEN):** CAS via `putIfMatch` serializes concurrent updates cleanly; mission-blob-size growth manageable.

---

## §5 D4 — Pulse-adjacent surface inventory (touch-points for W1-W4 sub-PR planning)

### W1 — Mission entity schema extension (3 touch-points)

| File | Change |
|---|---|
| `hub/src/entities/mission.ts` | Add `pulses?` + `missionClass?` to `Mission` interface; add `MissionClass` enum + `PulseConfig` interface |
| `hub/src/entities/mission-repository.ts` | Extend `updateMission` signature; extend `createMission` to accept `pulses` + `missionClass`; extend zod schema if validators move into repository |
| `hub/src/policy/mission-policy.ts` | Extend `update_mission` + `create_mission` MCP tool handlers (args parsing + validation + auto-inject defaults per Design v1.0 §3 "Default-injection semantics") |

**Test surface:** `hub/src/policy/test-utils.ts` + `hub/test/e2e/orchestrator.ts` create test missions; need to support optional pulses + missionClass for tests verifying pulse semantics.

### W2 — PulseSweeper implementation (2 touch-points; load-bearing wave)

| File | Change |
|---|---|
| `hub/src/policy/pulse-sweeper.ts` (NEW) | `PulseSweeper` class per Design v1.0 §4; constructor takes `IMissionStore`, `IMessageStore`, `DirectorNotificationHelper` (from W4.1), `evaluatePrecondition` (from W4 registry); `start()` / `tick()` / `evaluatePulse()` / `firePulse()` / `escalateMissedThreshold()` / `onPulseAcked()` / `updatePulseBookkeeping()` |
| `hub/src/policy/message-policy.ts` | Extend `ackMessage` handler (line 351-372) to invoke `pulseSweeper.onPulseAcked(message)` when `payload.pulseKind === "status_check"` (Design v1.0 §4 webhook composition) |
| `hub/src/index.ts` | Construct `PulseSweeper` instance + `pulseSweeper.start()` at Hub init; wire into `AllStores` for DI access from message-policy |
| `hub/src/policy/types.ts` | Extend `AllStores` interface with `pulseSweeper?: PulseSweeper` for DI access |

**Note:** the message-policy.ts extension is small (~5 lines around `ackMessage`); preserves backward-compat (non-pulse Messages don't trigger the cascade). PulseSweeper is fire-and-forget; ack handler doesn't await sweeper hook.

### W3 — Adapter render integration (1 touch-point + 1 source-attribute extension)

| File | Change |
|---|---|
| `adapters/claude-plugin/src/source-attribute.ts` | Add `plugin:agent-adapter:pulse` source-attribute entry (W2.3 taxonomy extension); `<channel level="informational">` for reduced render prominence |
| `adapters/opencode-plugin/src/...` | Mirror source-attribute taxonomy + render logic (parity per Design v1.0 §5) |

No new MCP verbs; existing `notificationHooks.onActionableEvent` (mission-55 + mission-56 W2.2) consumes pulse Messages via push pipeline + Layer-2 router. LLM acks via standard `ack_message` tool.

### W4 — Tests + observability + ADR-027 + closing audit + mission-lifecycle.md v1.0 (2 touch-points)

| File | Change |
|---|---|
| `hub/test/unit/pulse-sweeper.test.ts` (NEW) | Unit tests for `PulseSweeper` FSM (fire-due check + missed-threshold pause + precondition skip + missed-response detection 3-condition guard + escalation idempotency + onPulseAcked reset) |
| `hub/test/unit/mission-policy.test.ts` | Extend existing tests for new pulses + missionClass fields on update_mission + create_mission |
| `adapters/claude-plugin/test/source-attribute.test.ts` | Extend with pulse-source attribute case |
| `docs/decisions/027-pulse-primitive-and-pulse-sweeper.md` (NEW) | ADR-027 per Design v1.0 §7 W4 D4 |
| `docs/audits/m-mission-pulse-primitive-closing-audit.md` (NEW) | Closing audit per W4 D6 |
| `docs/methodology/mission-lifecycle.md` (UPDATE v0.1 → v1.0) | Per-class default cadence table + missionClass field codification + override semantics + when-to-disable + ScheduleWakeup boundary (per Design v1.0 §6) |

**Observability metrics (W4 D3):** new Hub metrics `pulse_fired_total{missionId, pulseKey}`, `pulse_missed_total{missionId, pulseKey}`, `pulse_escalated_total{missionId, pulseKey}` for Director observability via metrics queries.

---

## §6 D5 — W2 escalation-key engineer-final note

Per thread-349 round 8 bilateral; W2 implementer makes the final code-time call on the escalation-key migrationSourceId shape:

**Engineer-final lean: Option C** — drop `migrationSourceId` on escalation Messages.

```typescript
// hub/src/policy/pulse-sweeper.ts:escalateMissedThreshold (W2)
await this.messageStore.createMessage({
  kind: "external-injection",
  target: { role: "architect" },  // E1 mediation-invariant fix per Design v1.0 §4
  delivery: "push-immediate",
  payload: {
    pulseKind: "missed_threshold_escalation",
    missionId: mission.id,
    silentRole,
    missedCount,
    intervalSeconds: config.intervalSeconds,
    threshold: config.missedThreshold,
    title: `...`,
    details: `...`,
  },
  // NO migrationSourceId — ULID-keyed Message naturally unique;
  // escalation events are rare; sweeper-crash-mid-create acceptable
});
```

**Reasoning:**

1. **Escalation is rare.** missedThreshold default = 3; pulse pauses at breach + architect resolution + missedCount reset is the only path to re-breach. Realistic frequency: <1 per mission lifetime under normal operation.
2. **ULID-keyed Message naturally unique.** Even without migrationSourceId, each escalation Message gets a fresh ULID — duplicates would only arise from sweeper crash between `createMessage` and `updatePulseBookkeeping(lastEscalatedAt)`, which is a microsecond window.
3. **Acceptable consequence on duplicate.** If a duplicate escalation Message lands, architect adapter receives 2 escalation events for the same threshold breach; architect LLM sees both and resolves both (no functional harm, just minor duplication).
4. **Avoids the corner-case migrationSourceId collision** (engineer round-2 audit at thread-349 r8 noted: deterministic key like `pulse-escalation:${missionId}:${pulseKey}:${missedCount}` collides on second-breach-after-resolution because `missedCount` resets to 0 then re-reaches 3 with same key).

**Upgrade path if frequency becomes a concern post-ship:** **Option A** — include `lastEscalatedAt` + `missedCount` in deterministic key:

```typescript
migrationSourceId: `pulse-escalation:${mission.id}:${pulseKey}:${config.lastEscalatedAt ?? "first"}:${missedCount}`
```

This is a one-line change at W2 implementation time if Option C surfaces operational issues. Filed as W2-implementation-time engineer-final per Design v1.0 ratification at thread-349 round 8.

---

## §7 Risks identified for W1-W4 mitigation

### R1 — W1 schema migration backward-compat

**Risk:** existing missions on disk lack `pulses` + `missionClass` fields. zod schema additive (both optional) protects against parse failures, but downstream code (e.g., per-class default cadence lookups) needs to handle `missionClass === undefined` gracefully.

**Mitigation:** Design v1.0 §6 already includes (unset)/legacy row at top of cadence table — NO PULSE for missions without explicit `missionClass`. W1 + W2 implementer carries this forward in PulseSweeper (skip mission entirely if `missionClass === undefined` AND no explicit `pulses` declaration).

### R2 — `mission.createdAt` vs activatedAt semantics for first-fire

**Risk:** Design v1.0 §4 `firePulse` uses `mission.createdAt` as the base for the first-fire `nextFireDueAt` computation:

```typescript
const baseFireMs = lastFiredMs > 0
  ? lastFiredMs + (config.intervalSeconds * 1000)
  : new Date(mission.createdAt).getTime() + ((config.firstFireDelaySeconds ?? config.intervalSeconds) * 1000);
```

For missions in `proposed` state for a long time before activation, `createdAt + firstFireDelaySeconds` may have already passed by activation; first sweeper tick post-activation fires immediately, regardless of `firstFireDelaySeconds` intent.

**Mitigation:** auto-injected `mission_idle_for_at_least` precondition (Design v1.0 §3 default-injection) skips fires when mission has recent activity. Activation typically follows from architect activity; first-tick-post-activation precondition will return false; subsequent ticks fire when actually idle.

**Engineer-noted potential refinement (W1+W2 implementer's call):** mission entity could gain `activatedAt?: string` field (set when status transitions proposed → active); `firePulse` uses `MAX(activatedAt ?? createdAt, createdAt)`. Adds 1 schema field + small policy hook. Defer if precondition mitigation is sufficient at W2 testing.

### R3 — PulseSweeper Hub-redeploy gate (substrate-self-dogfood applicability)

**Risk:** PulseSweeper construction in `hub/src/index.ts` requires Hub redeploy at W2 sub-PR merge. Per `feedback_substrate_self_dogfood_discipline.md` (mission-56 §6.4 codification): substrate missions where the mission's own coordination consumes its shipped artifact need explicit dogfood gate.

**Mitigation:** **W2 IS the dogfood gate** for mission-57. After W2 sub-PR merge:
1. Hub redeploy (architect-side; per `feedback_architect_owns_hub_lifecycle.md`)
2. Architect + engineer adapter restart (loads new pulse-message-handler if applicable; for mission-57, adapter changes are at W3 not W2 so adapter restart not strictly required at W2 — only Hub redeploy)
3. Verification protocol: architect declares pulse config on a test mission entity; sweeper tick fires pulse Message; engineer's adapter receives via push pipeline; LLM acks; sweeper observes ack via webhook
4. Hold-on-failure: if verification fails, W3+W4 waves resume in poll-mode (engineers + architects don't consume pulse during their own mission execution); sweeper logic investigated

If W2 verification succeeds: subsequent W3+W4 waves can dogfood pulse-driven coord during mission-57's own execution. Architect declares `pulses.architectPulse` + `pulses.engineerPulse` on mission-57 entity; pulses fire at appropriate cadence; coord-overhead drops further.

### R4 — Cross-package vitest baseline (bug-32; established pattern)

**Risk:** mission-57 PRs land with bug-32 cross-package vitest failures (PolicyLoopbackHub depends on un-exported MemoryStores from hub/src). Same pattern as mission-54/55/56 lineage (24-PR consecutive admin-merge at this point, with mission-57 W0+W1+W2+W3+W4 likely extending to ~30+ consecutive).

**Mitigation:** admin-merge per established pattern. Not gating mission-57. Filed as future substrate-cleanup-wave concern (potentially folded into idea-198 Cognitive-Layer extraction or idea-186 npm workspaces migration; explicit out-of-scope for delivery-class missions).

---

## §8 Cross-references

- **Design v1.0:** `docs/designs/m-mission-pulse-primitive-design.md` (commit `a8e9aca`) — §3 schema + §4 PulseSweeper + §6 cadence table + §7 wave decomposition + §8 anti-goals
- **Survey artifact:** `docs/designs/m-mission-pulse-primitive-survey.md` (commit `a8e9aca`) — 6-anchor Director-intent envelope
- **Design phase thread:** thread-349 (8 rounds; bilateral; converged with `close_no_action`)
- **PR-review thread:** thread-350 (PR #84 cross-approval; sealed)
- **Preflight:** `docs/missions/mission-57-preflight.md` (PR #85; in flight at spike-time)
- **Mission-56 retrospective:** `docs/reviews/m-push-foundation-retrospective.md` — §5.4.1 mission-class taxonomy this mission consumes; §6.4 substrate-self-dogfood discipline this mission applies; §7.5 forward tele-9 advance this mission realizes
- **mission-56 W4.1 helper-pattern:** `hub/src/policy/director-notification-helpers.ts` — replicable shape for the (would-be-but-engineer-revised-to-architect-routed) escalation Message emission
- **mission-56 W4.2 no-double-send analysis:** `hub/src/policy/notification-helpers.ts` — replicable architectural-correctness analysis pattern for W2 PulseSweeper-firePulse-vs-W1a-push-on-create
- **mission-51 W4 Scheduled-Message primitive:** `hub/src/entities/message.ts` (`fireAt` + `precondition` + `scheduledState`) — NOT consumed by PulseSweeper per Design v1.0 §2 commitment 1; referenced for context
- **W4 precondition registry:** `hub/src/policy/preconditions.ts` (`{fn, args}` shape; PR-locked registry) — consumed by PulseSweeper for `mission_idle_for_at_least` default precondition
- **W3.2 Message status FSM:** `new → received → acked` — consumed by PulseSweeper webhook composition via `ack_message` cascade hook
- **ADR-024:** StorageProvider primitives (consumed; CAS via `putIfMatch`)
- **ADR-025:** Message primitive (consumed; pulse-as-Message)
- **ADR-026:** Universal Adapter Phase 1 push pipeline (consumed; push-immediate delivery)
- **ADR-027 (W4 deliverable):** Pulse primitive + PulseSweeper architecture
- **`feedback_w4_subpr_regrep`:** discipline applied this spike (re-grep at start of each sub-PR)
- **`feedback_proactive_context_budget_surface`:** discipline applied — engineer round-1 + round-2 audits at thread-349 surfaced refinements before code landed
- **`feedback_director_intent_survey_process`:** first canonical execution example (this mission)
- **`feedback_mechanise_declare_all_coordination`:** binding tele principle this mission realizes

---

## §9 W0 verdict + W1 dispatch readiness

**W0 GREEN** with explicit D2 yellow note (W1 implementer extends mission-policy + repository signatures + zod). All other deliverables (D1 schema interaction + D3 CAS pattern + D4 surface inventory + D5 this report + W2 escalation-key engineer-final) verified clean.

**W1 dispatch readiness:** ready. Schema work proceeds as Design v1.0 §3 specifies; touch-points enumerated above; backward-compat verified; W1 implementer can scaffold day-1.

**Sub-PR cascade per established mission-56 W2.1-W4.3 pattern:** one sub-PR per sub-deliverable when sub-deliverables are structurally separable. W1 schema work is a single sub-PR (mission entity + policy + repository + tests bundled). W2 PulseSweeper is a single sub-PR (load-bearing; ~2 eng-days). W3 adapter integration single sub-PR. W4 tests + ADR + lifecycle.md + closing audit may bundle or split per fresh-budget assessment.

**Standing by for W1 dispatch trigger** — cascade auto-issues plannedTasks[1] on W0 advancement (advancement triggered by W0 PR merge per mission-57's plannedTasks cascade), OR architect direct dispatch on PR-review thread.

— greg / engineer / 2026-04-26
