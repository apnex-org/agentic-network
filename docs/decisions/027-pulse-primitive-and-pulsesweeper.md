# ADR-027 — Pulse Primitive + PulseSweeper (Mission-Coordination Enrichment Layer)

**Status:** Accepted — 2026-04-26. Ratified via mission-57 (M-Mission-Pulse-Primitive); landed across PRs #86 (W0 spike) / #87 (W1 schema) / #88 (W2 PulseSweeper) / #90 (W3 adapter render integration) / [W4 closing wave — this PR]. Authored during bilateral Design phase thread-349 (architect lily + engineer greg) under the Survey-then-Design methodology (`docs/methodology/idea-survey.md` v1.0; first canonical execution).

**Context window:** mission-57 — the fourth sovereign-architectural-surface ADR in the substrate→primitive→delivery→enrichment lineage:
- **ADR-024** ratified the storage substrate (single-entity atomic CAS).
- **ADR-025** ratified the workflow primitive (Message + saga + triggers + scheduled-message).
- **ADR-026** ratified the canonical event-delivery layer (push pipeline + Layer-2 MessageRouter + 3-layer adapter).
- **ADR-027** ratifies the **mission-coordination enrichment layer** that drives declarative per-mission recurring coordination on top of the existing substrate stack.

---

## 1. Context

Pre-mission-57, recurring agent coordination during active mission execution was driven by **architect proactive ping discipline** (calibration #4 from mission-55 retrospective; manual coord ping post-PR-merge to avoid coord-handoff gap). Mission-56's W2.x dogfood gate closed bug-34 *structurally* (push pipeline → SSE event handling on architect adapter), retiring the manual ping pattern at the substrate level.

But the *declarative coordination state* — a mission entity's "what cadence does this mission want to be checked in on?" — was not captured. Architect was still using local `ScheduleWakeup` calls (with a 15min cap per `feedback_wakeup_cadence_15min_max`) to pace check-ins; engineer side relied on push-driven SSE notifications + ad-hoc threading.

mission-56 retrospective §7.5 named this gap as a forward tele-9 (Frictionless Director Coordination) advance. Director ratified the concept as **idea-206 M-Mission-Pulse-Primitive** (Tier 2 follow-on). Strategic-review post-mission-56 selected idea-206 as mission #2.

The Director-intent envelope was captured via the new **Survey-then-Design methodology** (`docs/methodology/idea-survey.md` v1.0; first canonical execution at idea-206 Design phase): 6 picks across orthogonal questions anchoring outcome (latency reduction + stuck-mission prevention; Director observability derivative), targets (engineer + architect; Director-watchdog OUT), cadence (per-mission declared), response shape (per-pulse declared), missed-pulse handling (architect-side escalation), config location (mission entity ONLY).

This ADR captures the Design v1.0 that mission-57 implements across W0–W4.

---

## 2. Decision

### 2.1 Single declarative coordination surface — mission entity

The **mission entity gains `pulses.{engineerPulse, architectPulse}` + `missionClass`** as the canonical declarative surface for recurring coordination configuration (per Survey Q6: mission entity ONLY; Design doc descriptive, not prescriptive). Hub honours; engineer + architect adapters consume; methodology doc (mission-lifecycle.md v1.0) carries per-class default cadence templates as conventions, NOT Hub primitives.

```typescript
interface MissionEntity {
  // ... existing fields ...
  missionClass?: MissionClass;
  pulses?: {
    engineerPulse?: PulseConfig;
    architectPulse?: PulseConfig;
  };
}

interface PulseConfig {
  // Engineer-authored (validated at MCP boundary; persisted on entity)
  intervalSeconds: number;          // ≥60s enforced; ≥300s recommended
  message: string;                   // payload prompt rendered at adapter
  responseShape: PulseResponseShape; // "ack" | "short_status" | "full_status"
  missedThreshold: number;           // architect-escalation threshold (auto-injected default 2 per mission-68 §8 reduce-to-2 fold; was 3 pre-mission-68)
  firstFireDelaySeconds?: number;    // auto-injected to intervalSeconds when undefined
  // (mission-68 §4.2 fold) precondition field REMOVED — pulses fire
  // unconditionally on schedule; W4 registry continues to serve scheduled-
  // message consumers via distinct entry points (`thread-still-active`,
  // `task-not-completed`).

  // Sweeper-managed bookkeeping (read-only via MCP tools; only PulseSweeper writes via direct repo)
  lastFiredAt?: string;
  lastResponseAt?: string | null;
  missedCount?: number;
  lastEscalatedAt?: string | null;
}
```

**Default-injection semantics** (per Design v1.0 §3 + mission-68 W1 §5 unified-default fold): missing optional fields auto-injected at `mission-policy.ts:create_mission` / `update_mission` validation; persisted on entity; reading returns injected values explicitly (no implicit defaults at read-time). **Mission-68 unified default**: when `pulses` is omitted entirely on `create_mission` OR at `update_mission` proposed→active flip, the Hub injects unified per-role defaults (engineerPulse 600s/missedThreshold=2 + architectPulse 1200s/missedThreshold=2; sync-active-arc class cluster default).

**Legacy `missionClass` = NO PULSE backward-compat — superseded by mission-68 W1 §7 NEW-missions-only fold:**
- Pre-mission-57 missions in `active` status without `pulses` config: UNCHANGED (preserved at-flip-time; no retroactive injection)
- NEW missions (created or flipped proposed→active post-mission-68): unified 10/20/2 defaults applied (P8 ratification: NOT gated behind `missionClass !== undefined` — accept post-v1.0 unified-semantics override for legacy `proposed` missions)
- Distribution-packaging class missions (async work; 30/60 baseline): SHOULD declare `pulses` explicitly to longer cadence per `mission-lifecycle.md` §4.x (C5 fold; methodology-layer carve-out)

### 2.2 PulseSweeper — single-instance recurring sweeper

**Dedicated `PulseSweeper` class** (NOT scheduled-message-sweeper composition per bilateral Q1 verdict at thread-349 r2). `setInterval(60_000)` tick; iterates active missions with `pulses.*` config; per-pulse evaluates fire/skip/escalation; emits pulse Messages via the existing `messageStore.createMessage`.

**60s tick is sufficient resolution for ≥5min cadences.** Sub-minute cadences are anti-pattern (pulse-storm; missedThreshold semantics break down) and rejected at the schema level by `PULSE_INTERVAL_FLOOR_SECONDS = 60` validation.

**Composition with W3.2 Message status FSM** via webhook (Item-2 verdict at thread-349 r6 audit; NOT polling): `message-policy.ts:ackMessage` post-status-flip-to-acked checks `payload.pulseKind === "status_check"` → invokes `pulseSweeper.onPulseAcked(message)` → resets missedCount + updates lastResponseAt. Fire-and-forget; hook errors non-fatal.

### 2.3 Pulse Message wire format

```json
{
  "kind": "external-injection",
  "authorRole": "system",
  "authorAgentId": "hub",
  "target": { "role": "engineer" },
  "delivery": "push-immediate",
  "payload": {
    "pulseKind": "status_check",
    "missionId": "mission-N",
    "intervalSeconds": 1800,
    "message": "Status? Active PR? Blockers?",
    "responseShape": "short_status"
  },
  "migrationSourceId": "pulse:mission-N:engineerPulse:<nextFireDueAt>"
}
```

`kind: "external-injection"` reuses ADR-025's existing kind taxonomy (no new top-level Message kinds; `external-injection` is the existing semantic match for "Hub-emitted system event injected into agent context"). `target.role` per pulse-key (engineerPulse → engineer; architectPulse → architect). `delivery: "push-immediate"` consumes ADR-026's push pipeline.

**Subkind discriminator inside `payload.pulseKind`** (Universal Adapter notification contract pattern; matches W4.1 DirectorNotification helper's `payload.source` discriminator + W4.2 Notification helper's `payload.event` discriminator). No new top-level Message kind; pulse semantics distinguished via payload introspection.

### 2.4 Item-1 deterministic migrationSourceId (sweeper restart safety)

**Format:** `pulse:<missionId>:<pulseKey>:<nextFireDueAt>` where `nextFireDueAt = lastFiredAt + intervalSeconds * 1000` (or `mission.createdAt + firstFireDelaySeconds * 1000` for first-fire). Restart-safe: sweeper crash between `createMessage` + `updatePulseBookkeeping(lastFiredAt)` results in next-tick computing the same `nextFireDueAt` → `findByMigrationSourceId` short-circuit + reconciliation logic → no double-fire.

Per Option A from thread-349 r6 round-2 audit.

### 2.5 E1 mediation-invariant escalation routing

Missed-threshold escalation emits a Message with `target.role: "architect"` (NOT director-direct). Architect LLM evaluates + decides Director-surface per categorised-concerns table. Both-roles-silent degradation handled by Director operational-support pattern (mission-56 D3 precedent: "I will restart greg" — Director observes via Hub-state query).

Faithful to Survey Q5B intent ("Architect-side escalation after 2-3 missed pulses"). Escalation Message payload `{ pulseKind: "missed_threshold_escalation", missionId, silentRole, missedCount, intervalSeconds, threshold, title, details }`.

**Option C escalation-key handling** (thread-349 r8 + W0 D5): NO migrationSourceId on escalation Messages. ULID-keyed Message naturally unique; sweeper-crash-mid-create duplicate acceptable (rare event; one per N years operationally fine). Upgrade to Option A if frequency concern post-ship.

### 2.6 E2 3-condition missed-count guard

**PRESERVED INTACT per mission-68 W1 CRITICAL C1 fold** — engineer round-1 audit (thread-445) verified that the 3-condition guard is ORTHOGONAL to the precondition layer (Step 4 in `pulse-sweeper.ts`, distinct from the now-removed Step 3 precondition check). Removing this guard would break the missed-count semantics: escalation would fire after `missedThreshold` cadences regardless of acks. The guard stays even though Q3a removed the precondition layer.

Missed-count increments only when ALL three conditions hold:

1. `pulseFiredAtLeastOnce`: `lastFiredAt > 0`
2. `noAckSinceLastFire`: `lastResponseMs < lastFiredMs`
3. `graceWindowElapsed`: `now - lastFiredMs > intervalSeconds*1000 + graceMs` (default `graceMs = 30000`)

Historical rationale: avoided false-positive when prior tick skipped fire due to `precondition === false` (precondition-skipped pulses were intentional; no real missed response). Post-mission-68: pulses fire unconditionally; the `noAckSinceLastFire` condition continues to gate the increment on whether the agent responded since the last fire (the load-bearing semantics).

### 2.7 Layer-3 adapter render integration

claude-plugin shim adds `plugin:agent-adapter:pulse` source-attribute family (5th ratified family; W2.3 taxonomy extension). Pulse Messages render via `<channel meta.source="plugin:agent-adapter:pulse" meta.level="informational">` — informational level (not actionable) downgrades cognitive load during high-activity sub-PR cascades (S3 mitigation per Design v1.0 §4).

opencode-plugin shim mirrors level-downgrade via inlined `isPulseEvent` helper (no shared dep with claude-plugin); pulse notifications enqueued with `level="informational"` + action-log tagged `[PULSE]` prefix.

**Detection:** `event.event === "message_arrived"` + `event.data.message.payload.pulseKind ∈ {status_check, missed_threshold_escalation}`. Backward-compat preserved for callers that omit `eventData` (falls through to existing 4-family taxonomy).

### 2.8 mission_idle_for_at_least precondition (W4 registry extension) — REMOVED per mission-68 W1

**Section retired per mission-68 W1 (Design v1.0 §4.2 + Q3a Director-pick).** The `mission_idle_for_at_least` predicate + auto-injection branch were removed per engineer-audit C2 fold; pulses now fire unconditionally on schedule. The W4 precondition registry itself is PRESERVED for scheduled-message-sweeper consumers (`thread-still-active`, `task-not-completed`); only this entry was deleted from `hub/src/policy/preconditions.ts`.

Sequencing rationale (Director Q3a + tele-8 Gated Recursive Integrity): per-agent-idle predicate work composes via idea-225 M-TTL-Liveliness-Design AFTER substrate-grade TTL liveliness signals exist (Layer N substrate before Layer N+1 features). Pre-substrate, removing the precondition layer is cleaner than tweaking it.

Historical content for archive context: the predicate checked `now - mission.updatedAt >= seconds*1000` to filter high-activity sub-PR-cascade bursts. Self-referential consideration: pulse bookkeeping updates bumped `mission.updatedAt`, so the predicate filtered only when mission entity touches outpaced the cadence. Trade-off accepted at mission-57; reframed as unnecessary substrate complexity at mission-68 (10/20 cadence + reduced threshold + per-agent-idle deferred to idea-225 makes precondition layer redundant).

### 2.9 Observability — pulse rate metrics

PulseSweeper emits four metric counters:

| Metric | Tags | Increment on |
|---|---|---|
| `pulse.fired` | `{missionId, pulseKey}` | Successful pulse Message creation |
| `pulse.missed` | `{missionId, pulseKey, missedCount}` | E2-guard increment |
| `pulse.escalated` | `{missionId, pulseKey, missedCount}` | E1-routed escalation Message creation |
| `pulse.acked` | `{missionId, pulseKey}` | onPulseAcked webhook invocation |

Director observability (Survey Q1 derivative outcome — not primary) queryable via metrics interface or via mission entity state inspection (`mission.pulses.*.lastFiredAt` / `lastResponseAt` / `missedCount` / `lastEscalatedAt`).

---

## 3. Companion to ADR-024 + ADR-025 + ADR-026

The four ADRs compose into the full sovereign-architectural-surface stack: substrate → primitive → delivery → coordination-enrichment.

| ADR | Surface | Single-source-of-truth |
|---|---|---|
| ADR-024 | StorageProvider 6-primitive contract | `packages/storage-provider/src/contract.ts` |
| ADR-025 | Message + workflow primitives + registries | `hub/src/entities/message.ts` + `hub/src/policy/{triggers, downstream-actors, preconditions, scheduled-message-sweeper, cascade-replay-sweeper, message-helpers, message-policy}.ts` |
| ADR-026 | Push pipeline + Layer-2 MessageRouter + adapter render surface | `hub/src/policy/message-policy.ts:188-221` (push-on-create) + `hub/src/hub-networking.ts` (SSE wrapper) + `packages/message-router/` (Layer-2) + `packages/network-adapter/src/{wire,session,mcp-boundary}/` (Layer-1) + `adapters/<host>-plugin/src/shim.ts` (Layer-3) |
| **ADR-027** | **Pulse primitive + PulseSweeper + adapter pulse render integration** | `hub/src/entities/mission.ts` (pulses + missionClass schema) + `hub/src/policy/pulse-sweeper.ts` (PulseSweeper class) + `hub/src/policy/preconditions.ts` (`mission_idle_for_at_least`) + `hub/src/policy/message-policy.ts:ackMessage` (Item-2 webhook) + `adapters/claude-plugin/src/source-attribute.ts` (PULSE family) + `adapters/{claude,opencode}-plugin/src/shim.ts` (level-downgrade) |

ADR-027 consumes ADR-024 + ADR-025 + ADR-026; does NOT extend their contracts.

---

## 4. Consequences

### 4.1 Mechanise+declare doctrine — concrete operationalization

mission-56 retrospective §7.4 framed "mechanise + declare all coordination, low-value logic, execution" as binding doctrine layer between tele and design. ADR-027 is the **first canonical operationalization at architectural scale** for recurring coordination — pulse cadence + missed-threshold semantics + escalation routing all declarative on the mission entity; PulseSweeper drives mechanically from declared state.

Architect proactive ping discipline (calibration #4 interim post-mission-55) retired by ADR-027 + mission-lifecycle.md v1.0 ratification (mission-57 W4 D5).

### 4.2 Survey-then-Design methodology operationalized at scale

idea-206 → mission-57 lifecycle was the **first canonical execution** of the Survey-then-Design methodology codified at `docs/methodology/idea-survey.md` v1.0 (PR #89 merged 2026-04-26). 6-axis Director-intent envelope captured ~5min Director-time; bilateral architect+engineer Design phase (~92min combined; 8 thread rounds) iterated v0.1 → v1.0; mission-57 W0-W4 executed against the ratified intent envelope without Director re-engagement on Design-mechanics. ~36-50× Director-engagement compression vs mission-56 lineage at the Idea→Manifest transition.

Carries forward as canonical execution example for future Idea→Design transitions.

### 4.3 Substrate-vs-enrichment distinction (methodology refinement)

ADR-027 is the **first canonical example** of an "enrichment" mission (vs mission-56's "substrate" missions). Per `feedback_substrate_self_dogfood_discipline.md` 5-requirement pattern + thread-355 r3 dogfood-defer ratification:

- **Substrate missions** (mission-56 W2.2 push pipeline): substrate the mission's own coordination consumes; live dogfood high-leverage; closes architectural gaps structurally
- **Enrichment missions** (mission-57 pulse primitive): substrate that enriches future missions' coordination; live dogfood lower-pressure; verification via tests + integration sufficient pre-ship

The distinction codifies in mission-lifecycle.md v1.0 + the closing audit. Future substrate-self-dogfood-applicable missions evaluate the substrate-vs-enrichment axis at dispatch time; defer is engineering call when reasoned.

### 4.4 Future workflow primitives consume the pulse primitive

idea-194 (mid-thread-amend), idea-199 (FSM-completeness), idea-197 (auto-redeploy), and other future declarative-coordination missions inherit the pulse primitive's shape: declarative-on-mission-entity + sweeper-driven + W3.2-FSM-composing. Pattern reusable.

### 4.5 mission-lifecycle.md v1.0 — formal lifecycle phase additions

Co-shipping at mission-57 W4 D5:

- **Survey** as formal Idea→Design transition phase (references `docs/methodology/idea-survey.md` v1.0 as canonical)
- **`missionClass`** field codified per mission-56 retrospective §5.4.1 taxonomy
- **Per-class default pulse cadence** template (NOT Hub primitives — Survey Q3+Q4+Q6 anti-goal preserved)
- **Override semantics** + when-to-disable-pulses + ScheduleWakeup boundary (S5)
- **Autonomous-arc-driving pattern** + **substrate-self-dogfood discipline** (with substrate-vs-enrichment refinement)

**Mission-68 W1 co-shipping note (Design v1.0 §9 MIN1 fold):** mission-68 ships co-shipping methodology-doc updates per Design §4.3 + §6.1.1:
- §4.1 per-class default cadence table replaced by unified 10/20 default with distribution-packaging carve-out (sync-active-arc class cluster gets unified injection; distribution-packaging declares `pulses` explicitly to 30/60 baseline)
- §4.2 override semantics simplified (no per-class taxonomy; just per-mission `pulses.*` declaration + missionClass-absent-no-blocking-effect)
- §4.3 when-to-disable row drops precondition reference (precondition layer removed)
- §1.5.1 expansion: NEW §1.5.1.1 commit-push thread-heartbeat mechanization (3-layer engineer-cadence-discipline stack — methodology-doc fold + adapter Bash-tool-result post-process hook + Hub-side commit-pushed handler routing substrate)

### 4.6 Test surface

mission-57 lands +24 net hub vitest cases (W1 +12 schema/auto-injection + W2 +12 PulseSweeper FSM/idempotency/E1+E2/webhook) + 13 net adapter tests (W3 source-attribute + isPulseEvent). Per-FSM coverage: fire-due / missed-threshold pause / precondition skip / E2 3-condition guard / escalation routing / pause-after-escalation / onPulseAcked webhook / idempotency on sweeper restart / multi-pulse iteration / backward-compat (non-active / no-pulses / class-only-no-pulses).

ADR-027 is empirically grounded.

---

## 5. Provenance

- **Director ratification:** Survey envelope at idea-206 (6 picks; 2026-04-26 ~10:00Z); release-gate at mission-57 preflight (~10:50Z); mission status flip post-W4 (TBD).
- **Survey methodology codification:** `docs/methodology/idea-survey.md` v1.0 (PR #89 merged `04b7544`).
- **Bilateral Design phase:** thread-349 (8 rounds); Design v0.1 → v1.0 (commit `2db84ef`).
- **Manifest cascade:** PR #84 merged `a8e9aca`; mission-57 created at status=proposed with 5 plannedTasks bound.
- **Preflight artifact:** PR #85 merged `cd163e3` (verdict GREEN; cleanest preflight in lineage).
- **W0 spike:** PR #86 / `b3f073d` — read-path grep audit + 4 risks identified for W1-W4 mitigation + 8 touch-points enumerated.
- **W1 schema:** PR #87 / `72f77ab` — Mission entity schema extension.
- **W2 PulseSweeper:** PR #88 / `4f4b76f` — load-bearing wave; PulseSweeper class + Item-1/E1/Item-2/E2 fixes.
- **W3 adapter render:** PR #90 / `d943ecf` — pulse source-attribute family + level-downgrade.
- **W4 (this ADR + closing audit + mission-lifecycle.md v1.0):** [W4 PR — this PR].
- **Companion ADRs:** ADR-024 (StorageProvider) + ADR-025 (Message primitive) + ADR-026 (push pipeline).
- **Companion docs:** `docs/methodology/idea-survey.md` v1.0; `docs/methodology/mission-lifecycle.md` v1.0 (this PR's D5 deliverable); `docs/audits/m-mission-pulse-primitive-closing-audit.md` (this PR's D6 deliverable).
- **Predecessor missions:** mission-50/51 (substrate); mission-54/55 (recon + cleanup); mission-56 (push pipeline).
- **Tier 2 deferred:** idea-207 (M-PAI-Saga-On-Messages); idea-208 (M-Dogfood-CI-Automation); M-Adapter-Distribution.

---

## 6. Decision authors

- **Architect:** lily (eng-40903c59d19f) — Survey design (3+3 questions); Design v0.1 author; thread-349 bilateral rounds (8); ratification + admin-merge of W0-W3 + this W4 closer.
- **Engineer:** greg (eng-0d2c690e7dd5) — round-1 audit (7 questions + 6 surfaces flagged); round-2 audit (3 enumerated + 3 emergent surfaces; Item-1 + E1 + E2 corrections); W0-W4 implementation; this ADR draft + closing audit.
- **Director:** ratified Survey 6 picks (Q1 A+C / Q2 B+D / Q3 C / Q4 D / Q5 B / Q6 D); ratified preflight verdict GREEN at release-gate; ratified codification of Survey methodology as `docs/methodology/idea-survey.md` v1.0; ratified dogfood-defer for mission-57 W3+W4 own-execution (substrate-vs-enrichment distinction).
