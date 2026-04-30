# M-Mission-Pulse-Primitive — Design v1.0

**Status:** Ratified v1.0 (architect-authored 2026-04-26; bilateral Design phase per new Survey-then-Design methodology; v0.1→v1.0 incorporates engineer round-2 audit refinements per thread-349 round 6)
**Source idea:** idea-206 M-Mission-Pulse-Primitive (Hub-stored)
**Pre-Design input:** `docs/surveys/m-mission-pulse-primitive-survey.md` (6-anchor Director-intent envelope)
**Mission class:** Coordination-primitive shipment (per mission-56 retrospective §5.4.1 taxonomy)
**Sizing:** L lower edge (~6-8 eng-days; W0-W4 decomposition; sub-2-week)

## Version delta — v0.1 → v1.0 (engineer round-2 audit refinements)

Per thread-349 round 6 engineer round-2 audit (commit `a234ba8` → this commit):

| Refinement | Class | Section affected | Fix shape |
|---|---|---|---|
| **Item 1** — migrationSourceId idempotency | BLOCKING | §4 firePulse | Deterministic key based on `nextFireDueAt` computed from prior bookkeeping (Option A); restart-safe; double-fire prevented |
| **E1** — Mediation invariant on escalation | BLOCKING | §4 escalateMissedThreshold | Route to `target.role: "architect"` (NOT director); architect LLM evaluates + decides Director-surface per categorised-concerns table |
| **Item 2** — Webhook vs poll for ack detection | engineer-final | §4 composition + §5 response detection | Webhook from `ack_message` cascade handler (Path 2); aligns with mechanise+declare doctrine; eliminates race conditions; existing W3+W4.1 precedent |
| **E2** — Missed-count false-positive fix | engineer-final | §4 evaluatePulse step 4 | 3-condition guard: pulseFiredAtLeastOnce + noAckSinceLastFire + graceWindowElapsed |
| **Item 3a** — (unset)/legacy missionClass row | engineer-final | §6 cadence table | NO PULSE for missions without explicit missionClass; backward-compat for existing missions post-W1 schema migration |
| **Item 3b** — architectPulse responseShape default | engineer-final | §6 cadence defaults | `short_status` (was `ack`); matches concept memo intent + Survey Q1A coordination-latency outcome |
| **E3** — Default-injection semantics | engineer-final | §3 new "Default-injection semantics" subsection | `precondition` + `firstFireDelaySeconds` + `missedThreshold` auto-inject at validation; persisted on mission entity; explicit `null` to disable |

All refinements preserve Survey envelope intent. No Director re-engagement required (refinements are inside Survey-anchored design-mechanics scope per autonomous-arc-driving pattern).

---

## §1 Mission overview + tele alignment

### Goal

Ship the **declarative per-mission pulse primitive** that mechanises recurring agent coordination as Hub-driven scheduled-Messages, replacing the residual architect proactive ping discipline + filling the post-mission-56 ergonomic gap on tele-9 (Frictionless Director Coordination).

### Scope

Per the Survey envelope (`m-mission-pulse-primitive-survey.md`):

- **Mission entity gains `pulses.{engineerPulse, architectPulse}`** declarative config — targets, cadence, response shape, missed-response thresholds, optional precondition
- **PulseSweeper** (Hub-side) — 60s tick; iterates active missions with pulse config; fires pulse Messages via existing message-store; updates sweeper-managed bookkeeping; triggers architect-side escalation on missed-threshold breach
- **Adapter consumption** — pulse fires as Message kind `external-injection` with new source-attribute `plugin:agent-adapter:pulse`; consumed via existing W2.x notificationHooks contract; LLM responds via standard tool-calls (claim_message + ack_message FSM)
- **mission-lifecycle.md v1.0 co-ship** — codifies pulse semantics, per-class default cadences (sane defaults, NOT Hub primitives per Survey Q3+Q6), `missionClass` field, override semantics, when-to-disable-pulses

### Non-scope (binding anti-goals; see §8)

- Director-watchdog pulse OUT (Survey Q2)
- Hub-baked cadence defaults OUT (Survey Q3+Q4+Q6 — defaults emerge as mission-lifecycle.md conventions)
- Design-doc-prescriptive runtime config OUT (Survey Q6 — mission entity is canonical)
- Direct Director observability optimization OUT (Survey Q1)
- New MCP verbs OUT (existing surfaces sufficient)

### Tele alignment

| Tele | Role | Realization |
|---|---|---|
| **Primary tele-9 Frictionless Director Coordination** | Replace architect proactive ping with declarative pulse config; Director sees mission-state-as-Hub-state; coord overhead drops |
| **Primary tele-3 Sovereign Composition** | Single coordination mechanism (PulseSweeper + mission entity declaration) replaces ad-hoc per-mission ping rituals |
| **Secondary tele-10 Hub-as-Single-Source-of-Truth** | Pulse cadence + last-fired + missed-count + escalation-state lives on mission entity; no out-of-band coordination state |
| **Secondary tele-2 Isomorphic Specification** | PulseConfig schema-driven; pulse declarative; replaces imperative `ScheduleWakeup` calls (recurring case) |
| **Tertiary tele-7 Confidence-Through-Coverage** | Missed-pulse detection + architect-escalation provides watchdog signal; comprehensive test rebuild around sweeper FSM |

Pulse primitive realizes the **mechanise+declare doctrine** (`feedback_mechanise_declare_all_coordination`) at architectural scale for recurring coordination — direct application of the binding tele principle ratified during mission-56.

---

## §2 Architectural commitments

7 binding commitments per bilateral Design exchange thread-349:

| # | Commitment | Survey anchor |
|---|---|---|
| 1 | **Dedicated `PulseSweeper` class** (NOT scheduled-message-sweeper composition) — 60s tick; iterates active missions; per-pulse fire-decision; sweeper-managed bookkeeping | bilateral Q1 (engineer-led; concur) |
| 2 | **Mission entity schema extension** with `pulses.{engineerPulse, architectPulse}` PulseConfig + sweeper-managed bookkeeping fields; precondition shape via existing W4 `{fn, args}` registry | bilateral Q2 (engineer-led; concur; calibration #20 fix on precondition) |
| 3 | **4-condition stop-condition table** (mission-status pause + precondition skip + missed-threshold pause + resume on resolve); orthogonal-not-fold for engineer-pool-empty / RED-preflight / stuck-task-escalation | bilateral Q3 (engineer-led; concur) |
| 4 | **Pulse fires as Message** with `kind: "external-injection"` + new `plugin:agent-adapter:pulse` source-attribute + `<channel level="informational">` for reduced render prominence | bilateral Q4 + S3 (engineer-led; concur) |
| 5 | **Cron-style 60s tick single sweeper** — sub-minute cadences anti-pattern; 60s sufficient resolution for ≥5min cadences | bilateral Q5 (engineer-led; concur) |
| 6 | **mission-lifecycle.md v1.0 co-ship** — per-class default cadences, `missionClass` field, override semantics, when-to-disable-pulses; mission entity always-canonical for runtime config | bilateral Q6 (concur+amplify) |
| 7 | **L lower edge sizing (~6-8 eng-days; W0-W4 decomposition)** — pattern-replication factor (mission-56 W4 helper-pattern + W2.x adapter integration) supports lower-edge | bilateral Q7 (engineer-led; concur) |

### Adopted engineer surfaces (S1-S6)

| S | Surface | Adoption shape |
|---|---|---|
| S1 | **migrationSourceId idempotency** on sweeper restart | Pulse Messages carry `migrationSourceId: "pulse:<missionId>:<pulseKey>:<lastFiredAt>"` for `findByMigrationSourceId` short-circuit; reuses W2 async-shadow-projector idempotency hook |
| S2 | **First-pulse-after-intervalSeconds + `mission_idle_for_at_least` default precondition** | Reduces pulse-noise during high-activity sub-PR cascades; per-mission overridable via `firstFireDelaySeconds` |
| S3 | **Render-noise mitigation** | New source-attribute + `<channel level="informational">`; W2.3 taxonomy extension |
| S4 | **Composition with task-316 plannedTasks cascade** | W0 spike grep verifies; explicit deliverable; CAS via `putIfMatch` serializes concurrent updates; mission-blob-size growth manageable |
| S5 | **Pulse vs ScheduleWakeup boundary** | mission-lifecycle.md v1.0 codifies; recurring → pulse; one-off → local ScheduleWakeup retained; `feedback_wakeup_cadence_15min_max` 15min cap retired by pulse adoption (cap holds until pulse ships) |
| S6 | **Pulse fairness across multiple active missions** | Defer; mission-lifecycle.md caps active-missions-per-engineer at small N (~3); aggregate pulse-storm acceptable for first ship |

---

## §3 Mission entity schema extension

### PulseConfig shape

```typescript
// hub/src/entities/mission.ts (extension)

interface PulseConfig {
  // Engineer-authored config
  intervalSeconds: number;          // pulse cadence (≥300s recommended; ≥60s enforced)
  message: string;                   // payload prompt rendered at adapter
  responseShape: "ack" | "short_status" | "full_status";
  missedThreshold: number;           // architect-escalates after N consecutive misses (default 3)
  precondition?: { fn: string; args: Record<string, unknown> };  // existing W4 registry form
  firstFireDelaySeconds?: number;    // optional override; default = intervalSeconds (S2)

  // Sweeper-managed bookkeeping (read-only via tools; only PulseSweeper writes via direct repository)
  lastFiredAt?: string;              // ISO-8601
  lastResponseAt?: string | null;    // ISO-8601 of last `ack_message` on a pulse Message
  missedCount?: number;              // increments on `now - lastResponseAt > intervalSeconds + grace`
  lastEscalatedAt?: string | null;   // suppresses escalation storm
}

interface MissionEntity {
  // ... existing fields ...
  missionClass?: "spike" | "substrate-introduction" | "structural-inflection"
              | "coordination-primitive-shipment" | "saga-substrate-completion"
              | "substrate-cleanup-wave" | "distribution-packaging";
  pulses?: {
    engineerPulse?: PulseConfig;
    architectPulse?: PulseConfig;
  };
}
```

### Validation

- **Hub-boundary validation** at `mission-policy.ts` (`update_mission` + `create_mission` cascade handlers); zod schema with sweeper-managed fields read-only at MCP-tool layer
- **Sweeper-managed fields** (`lastFiredAt`, `lastResponseAt`, `missedCount`, `lastEscalatedAt`) writeable only by PulseSweeper via direct `MissionRepository` updates; MCP-tool surfaces strip these before update
- **`intervalSeconds` floor** at 60s (sub-minute cadences anti-pattern); recommended ≥300s
- **`missedThreshold` default** 3 (matches W3.2 ADR-017 receipt-deadline-missed-3x precedent for COMMS escalation; reduces false-positive rate vs 2; per-mission overridable via Survey Q5 envelope interpretation — see §6 mission-lifecycle.md content)

### Default-injection semantics (E3 fix)

Engineer round-2 audit surfaced ambiguity on optional-field default behavior. v1.0 explicit policy:

| Field | Behavior when undefined |
|---|---|
| `precondition` | **Auto-injected** at `mission-policy.ts` validation: `{fn: "mission_idle_for_at_least", args: {seconds: <intervalSeconds>}}`. Reduces noise per S2; engineers can explicitly disable by declaring `precondition: null` (zod schema accepts null vs undefined distinction). |
| `firstFireDelaySeconds` | **Auto-injected** at validation: equals `intervalSeconds`. First pulse fires after one cadence-interval, not immediately on activate. Per-mission override allowed for "5min initial verify-onboarded" use case. |
| `missedThreshold` | **Auto-injected** at validation: `3`. Matches W3.2 ADR-017 precedent. Per-mission overridable. |
| `responseShape` | **Required field; no default.** Engineer must declare per pulse (e.g., `short_status` for engineerPulse, `short_status` for architectPulse per §6 conventions). |

Auto-injection happens once at write-time, persisted on the mission entity. Reading the entity returns the injected values explicitly; no implicit defaults at read-time.

### Backward compatibility

- `pulses?` is optional; existing missions without `pulses` field parse unchanged against extended zod schema
- W0 spike grep verifies `mission-policy.ts` cascade-handlers + `MissionRepository.updateMission` signature don't require schema-shape adjustments (per S4 amplification + greg's amplification on bilateral round-2)
- Storage migration: zero-downtime; additive field; no read-path changes for existing missions

### Schema location

Single source-of-truth: `hub/src/entities/mission.ts` (existing entity definition file). Helper validators in `hub/src/policy/mission-policy.ts`. Test-utils + e2e orchestrator wire updated mission-shape.

---

## §4 PulseSweeper architecture

### Class shape

```typescript
// hub/src/policy/pulse-sweeper.ts (NEW)

export class PulseSweeper {
  constructor(
    private missionStore: IMissionStore,
    private messageStore: IMessageStore,
    private directorNotificationHelper: DirectorNotificationHelper,  // W4.1
    private preconditionRegistry: PreconditionRegistry,  // existing W4
  ) {}

  start(): void {
    setInterval(() => this.tick().catch(logTickError), 60_000);
  }

  async tick(): Promise<void> {
    const activeMissions = await this.missionStore.listByStatus("active");
    for (const mission of activeMissions) {
      if (!mission.pulses) continue;
      for (const [pulseKey, pulseConfig] of Object.entries(mission.pulses)) {
        if (!pulseConfig) continue;
        await this.evaluatePulse(mission, pulseKey as PulseKey, pulseConfig);
      }
    }
  }

  private async evaluatePulse(
    mission: MissionEntity,
    pulseKey: PulseKey,
    config: PulseConfig,
  ): Promise<void> {
    // 1. Check fire-due
    const now = Date.now();
    const lastFiredMs = config.lastFiredAt ? new Date(config.lastFiredAt).getTime() : 0;
    const fireDueMs = lastFiredMs + (config.intervalSeconds * 1000);
    if (now < fireDueMs) return;  // not yet due

    // 2. Check missed-threshold pause
    if ((config.missedCount ?? 0) >= config.missedThreshold) {
      // Pulse paused; escalation already triggered or in-flight
      return;
    }

    // 3. Check precondition (existing W4 registry)
    if (config.precondition) {
      const preconditionResult = await this.preconditionRegistry.evaluate(
        config.precondition.fn,
        config.precondition.args,
        { mission },
      );
      if (!preconditionResult) {
        // Skip fire; don't increment missedCount; pulse still active
        return;
      }
    }

    // 4. Detect missed response — 3-condition guard (E2 fix)
    //    Avoids false-positive when prior tick skipped fire due to precondition false
    const lastResponseMs = config.lastResponseAt ? new Date(config.lastResponseAt).getTime() : 0;
    const grace = 30_000; // 30s grace post-cadence
    const pulseFiredAtLeastOnce = lastFiredMs > 0;
    const noAckSinceLastFire = lastResponseMs < lastFiredMs;
    const graceWindowElapsed = pulseFiredAtLeastOnce && (now - lastFiredMs > config.intervalSeconds * 1000 + grace);

    if (pulseFiredAtLeastOnce && noAckSinceLastFire && graceWindowElapsed) {
      // Missed; increment count
      const newMissedCount = (config.missedCount ?? 0) + 1;
      await this.updatePulseBookkeeping(mission, pulseKey, { missedCount: newMissedCount });

      // Escalate if threshold breached
      if (newMissedCount >= config.missedThreshold) {
        await this.escalateMissedThreshold(mission, pulseKey, config, newMissedCount);
        return; // Pause pulse
      }
    }

    // 5. Fire pulse Message
    await this.firePulse(mission, pulseKey, config);
  }

  private async firePulse(
    mission: MissionEntity,
    pulseKey: PulseKey,
    config: PulseConfig,
  ): Promise<void> {
    // Item-1 fix (engineer round-2): migrationSourceId must be DETERMINISTIC across sweeper restarts.
    // v0.1 used `new Date().toISOString()` which advanced on each restart → double-fire risk if
    // sweeper crashed between createMessage and updatePulseBookkeeping. v1.0: key on next-fire-due
    // time computed from prior bookkeeping (Option A from round-2 audit).
    const lastFiredMs = config.lastFiredAt ? new Date(config.lastFiredAt).getTime() : 0;
    const baseFireMs = lastFiredMs > 0
      ? lastFiredMs + (config.intervalSeconds * 1000)
      : new Date(mission.createdAt).getTime() + ((config.firstFireDelaySeconds ?? config.intervalSeconds) * 1000);
    const fireAt = new Date(baseFireMs).toISOString();
    const migrationSourceId = `pulse:${mission.id}:${pulseKey}:${fireAt}`;

    // Idempotency check (S1) — restart-safe via deterministic key
    const existing = await this.messageStore.findByMigrationSourceId(migrationSourceId);
    if (existing) {
      // Already fired this scheduled tick; sweeper restart short-circuit
      // Reconcile bookkeeping if needed (lastFiredAt may not have been written before crash)
      if (!config.lastFiredAt || new Date(config.lastFiredAt).getTime() < baseFireMs) {
        await this.updatePulseBookkeeping(mission, pulseKey, { lastFiredAt: fireAt });
      }
      return;
    }

    const targetRole = pulseKey === "engineerPulse" ? "engineer" : "architect";

    await this.messageStore.createMessage({
      kind: "external-injection",
      target: { role: targetRole },
      delivery: "push-immediate",
      payload: {
        pulseKind: "status_check",
        missionId: mission.id,
        intervalSeconds: config.intervalSeconds,
        message: config.message,
        responseShape: config.responseShape,
      },
      migrationSourceId,
    });

    await this.updatePulseBookkeeping(mission, pulseKey, { lastFiredAt: fireAt });
  }

  // Called by ack_message webhook / cascade handler (W3.2 integration)
  async onPulseAcked(pulseMessage: Message): Promise<void> {
    const { missionId } = pulseMessage.payload;
    const pulseKey = inferPulseKeyFromTarget(pulseMessage.target);
    const responseAt = new Date().toISOString();

    await this.updatePulseBookkeeping(missionId, pulseKey, {
      lastResponseAt: responseAt,
      missedCount: 0,  // reset on ack
    });
  }

  private async escalateMissedThreshold(
    mission: MissionEntity,
    pulseKey: PulseKey,
    config: PulseConfig,
    missedCount: number,
  ): Promise<void> {
    // E1 fix (engineer round-2): preserve mediation invariant.
    // v0.1 emitted directly to target.role=director — violates Director↔Engineer-via-Architect.
    // v1.0: emit to architect adapter; architect LLM evaluates + decides Director-surface (per
    // categorised-concerns table). If both engineer + architect pulses miss simultaneously,
    // mediation naturally degrades; Director observes via Hub-state query (operational-support
    // pattern engages — mission-56 D3 precedent).
    const silentRole = pulseKey === "engineerPulse" ? "engineer" : "architect";
    await this.messageStore.createMessage({
      kind: "external-injection",
      target: { role: "architect" },  // Architect-routed; architect LLM decides Director-surface
      delivery: "push-immediate",
      payload: {
        pulseKind: "missed_threshold_escalation",
        missionId: mission.id,
        silentRole,
        missedCount,
        intervalSeconds: config.intervalSeconds,
        threshold: config.missedThreshold,
        title: `Mission ${mission.id} ${silentRole} pulse missed ${missedCount} times`,
        details: `Pulse cadence ${config.intervalSeconds}s; threshold ${config.missedThreshold}; pulse paused. Architect: evaluate + resolve OR escalate to Director per categorised-concerns table.`,
      },
      migrationSourceId: `pulse-escalation:${mission.id}:${pulseKey}:${missedCount}`,  // deterministic; idempotent
    });

    await this.updatePulseBookkeeping(mission, pulseKey, {
      lastEscalatedAt: new Date().toISOString(),
    });
  }

  // ... helper methods ...
}
```

### Composition with W3.2 claim/ack FSM (webhook path; engineer round-2 final)

**Item-2 verdict (engineer round-2 audit):** webhook from `ack_message` cascade handler. NOT list-by-status polling. Reasons:

| Dimension | Poll path (rejected) | Webhook path (adopted) |
|---|---|---|
| Mechanise+declare doctrine | Polls every 60s for events that should be cascade-driven | Declarative cascade handler — exact match for the doctrine |
| Latency | Up to 60s lag before sweeper sees ack | Real-time |
| Query overhead | O(N) per tick × per active mission with pulses | Zero |
| Race conditions | Edge case: pulse fired + acked + status-flipped within single 60s window → next tick may miscount | None; cascade handler invoked atomically post-status-transition |
| Existing precedent | None; new pattern | mission-51 W3 trigger mechanism + W4.1 cascade handlers — exact precedent |

**Specific implementation:**

In `hub/src/policy/message-policy.ts` `ack_message` handler (W3.2 surface): post-status-flip-to-acked, check `payload.pulseKind === "status_check"`. If yes, invoke registered `pulseSweeper.onPulseAcked(message)` hook.

```typescript
// hub/src/policy/message-policy.ts (W3.2 ack_message handler — extend)
async function ackMessage(args: ..., ctx: ...): Promise<...> {
  const result = await ctx.stores.message.ackMessage(args.id);
  if (result.status === "acked" && (result.payload as any)?.pulseKind === "status_check") {
    // Pulse-specific cascade
    await ctx.stores.pulseSweeper?.onPulseAcked(result);
  }
  return result;
}
```

PulseSweeper registers via DI (constructor in `hub/src/index.ts`); message-policy looks up via `ctx.stores.pulseSweeper` (similar to W4.1 `directorNotificationHelper` plumbing).

**Side benefit:** removes the ambiguity of "soft-ack on `received` status" — webhook fires only on `acked`. `received` status is unambiguously "claimed but not yet acted." Clean missedCount tracking.

**Status semantics summary:**
- `acked` Message → response received; webhook invokes `onPulseAcked` → reset missedCount + update lastResponseAt
- `received` Message → claimed but not yet acted; no special handling (treated same as `new` for missedCount purposes)
- `new` Message (never claimed) → missed; increment missedCount on next sweeper tick (per E2 3-condition guard above)

### Construction in `hub/src/index.ts`

```typescript
const pulseSweeper = new PulseSweeper(
  missionStore,
  messageStore,
  directorNotificationHelper,
  preconditionRegistry,
);
pulseSweeper.start();
```

Single instance; constructed once at Hub init; `setInterval(60_000)` lifecycle managed by Node runtime.

---

## §5 Adapter integration

### Message shape (Hub-side)

```json
{
  "kind": "external-injection",
  "target": { "role": "engineer" },
  "delivery": "push-immediate",
  "payload": {
    "pulseKind": "status_check",
    "missionId": "mission-N",
    "intervalSeconds": 1800,
    "message": "Status? Active PR? Blockers? Sub-deliverable progress?",
    "responseShape": "short_status"
  }
}
```

### Adapter consumption (W2.x notificationHooks contract)

Existing `notificationHooks.onActionableEvent` (mission-55 + mission-56 W2.2) receives via push pipeline + Layer-2 router. No new MCP verb; no new contract surface.

### Source-attribute taxonomy extension (claude-plugin shim)

W2.3 taxonomy gains:

```
plugin:agent-adapter:pulse  // pulse-driven status_check (informational)
```

`<channel>` rendering uses `level="informational"` for reduced prominence vs `actionable` thread_messages — preserves cognitive context during high-activity sub-PR cascades.

### Response detection (webhook path per §4)

Adapter calls `claim_message(pulseId)` on render → Message status `new → received`. LLM acts via standard tool-calls (any tool call is the LLM's response). Adapter-side cascade calls `ack_message(pulseId)` post-LLM-response → Message status `received → acked`. PulseSweeper observes status transition via cascade handler `onPulseAcked` invoked from `message-policy.ts` ack_message handler (Item-2 verdict; webhook path; see §4 composition section for code).

### opencode-plugin parity

opencode-plugin shim mirrors source-attribute taxonomy + render shape. W3 sub-wave deliverable.

---

## §6 mission-lifecycle.md v1.0 co-ship content

Per Survey Q3+Q4+Q6 anti-goal: **per-class default cadences emerge as conventions in mission-lifecycle.md, NOT as Hub primitives.** Mission entity always-canonical for runtime config.

### Per-class default cadence template

| missionClass | engineerPulse default | architectPulse default | Notes |
|---|---|---|---|
| **(unset / legacy)** | **NO PULSE** | **NO PULSE** | Backward-compat: legacy missions without `missionClass` declaration get no auto-pulses. Explicit opt-in via `pulses.*` declaration only. (Item-3a fix per engineer round-2.) |
| `spike` | 30min | 60min | Short missions; quick check-ins suffice; firstFireDelay protects against low-utility fires |
| `substrate-introduction` | 30min | 60min | Standard cadence; substrate work has natural sub-PR rhythm |
| `pre-substrate-cleanup` | 30min | 60min | Standard cadence |
| **`structural-inflection`** | **60min** | **60min** | Longer pulses; high cognitive load per sub-PR; reduce noise; mission-56 evidence ~10-15min sub-PRs → 60min pulse fires every ~5 PRs (cognitive-load-friendly) |
| `coordination-primitive-shipment` | 30min | 60min | Standard cadence (this mission's class) |
| `saga-substrate-completion` | 30min | 60min | Standard cadence |
| `substrate-cleanup-wave` | 60min | 120min | Less interactive; longer cadence acceptable |
| `distribution-packaging` | 60min | 120min | Async work; longer cadence |

**Default `missedThreshold`**: 3 across all classes (W3.2 ADR-017 precedent).
**Default `responseShape`**: `short_status` for **both** engineerPulse + architectPulse (Item-3b fix per engineer round-2 — architectPulse intent per concept memo is "Pending engineer signals? Director-surface needed? Mid-wave handoff status?" which is a status-elicitor, not pure ack).
**Default `firstFireDelaySeconds`**: equal to `intervalSeconds` (per S2; first pulse fires after one cadence; not immediately on activate).
**Default `precondition`**: `{fn: "mission_idle_for_at_least", args: {seconds: <intervalSeconds>}}` (per S2 + E3 auto-injection; reduces noise during high-activity sub-PR cascades).

### Override semantics

Mission `pulses.<role>Pulse.*` field declarations OVERRIDE per-class defaults. Architect declares at Design time; bilateral with engineer; engineer-final on cadence specifics.

### When to disable pulses

| Situation | Action |
|---|---|
| Architect retrospective HOLD post-mission-close | Set `pulses: {}` on mission entity OR mission.status = `completed` (pulse auto-suspends) |
| idea-208 CI-dogfood verification windows | Mission can declare `pulses.engineerPulse: null` to suppress |
| Active sub-PR cascade with high natural coord cadence | `precondition: { fn: "mission_idle_for_at_least", args: { seconds: <intervalSeconds> } }` skips fires when activity recent |
| Mission stuck in escalation | Pulse auto-pauses (missedThreshold breached); no manual disable needed |

### Pulse vs ScheduleWakeup boundary (S5)

| Use case | Mechanism |
|---|---|
| Recurring agent coordination during active mission | idea-206 pulse primitive (this mission) |
| One-off "wake at X to check Y" outside active mission | Local `ScheduleWakeup` (architect-side; retained) |
| Recurring architect proactive ping (calibration #4 retire) | idea-206 pulse primitive (architectPulse) |
| Mission-status escalation watchdog | Pulse `missedThreshold` + architect-side `emitDirectorNotification` (NOT direct Director-pulse per Survey Q2) |

`feedback_wakeup_cadence_15min_max` 15min cap retired by pulse adoption for recurring case; cap holds until pulse ships for ALL recurring uses.

### Active-missions cap (S6 deferred mitigation)

Recommended cap: **3 active missions per engineer** at any time. Aggregate pulse-storm at this cap is acceptable (3 pulses per cadence per role); exceeds → consider coalesce primitive in future mission.

---

## §7 Wave decomposition (W0-W4; ~6-8 eng-days L lower edge)

Per engineer round-1 sizing (bilateral Q7 concur):

### W0 — Spike + read-path grep audit (~½d)

- **D1:** Mission entity schema grep — verify `mission.tasks` virtual-view + cascade-handlers don't trip on new `pulses` + `missionClass` fields
- **D2:** `mission-policy.ts` cascade-handlers + `MissionRepository.updateMission` signature check (per S4 amplification) — confirm zod schema additive, no shape adjustments
- **D3:** task-316 plannedTasks cascade interaction — verify CAS via `putIfMatch` serializes concurrent updates cleanly
- **D4:** Pulse-adjacent surface inventory — list all touch-points for W1-W4 sub-PR planning
- **D5:** Spike report doc; risks identified for W1-W4 mitigation

### W1 — Mission entity schema extension (~1d)

- **D1:** zod schema extension (`pulses` + `missionClass`); backward-compat verified
- **D2:** Storage migration (additive; zero-downtime)
- **D3:** `mission-policy.ts` validators (sweeper-managed fields stripped at MCP-tool boundary; engineer-authored fields validated)
- **D4:** test-utils + e2e orchestrator updated; existing missions parse unchanged

### W2 — PulseSweeper implementation (~2d; load-bearing)

- **D1:** `PulseSweeper` class scaffold + `setInterval(60_000)` lifecycle in `hub/src/index.ts`
- **D2:** `evaluatePulse` logic — fire-due check + missed-threshold pause + precondition skip + missed-response detection + bookkeeping update
- **D3:** `firePulse` — Message creation with idempotency guard (migrationSourceId); push-immediate delivery
- **D4:** `escalateMissedThreshold` — director-notification emit via W4.1 helper; lastEscalatedAt suppression
- **D5:** `onPulseAcked` cascade handler — Message status FSM observation (W3.2 composition); missedCount reset
- **D6:** Unit tests (sweeper FSM + escalation + idempotency); integration test against in-memory mission store

### W3 — Adapter render integration (~1d)

- **D1:** claude-plugin shim source-attribute taxonomy extension (`plugin:agent-adapter:pulse`)
- **D2:** opencode-plugin shim parity
- **D3:** `<channel level="informational">` rendering for pulse Messages
- **D4:** Adapter unit tests (notificationHooks dispatch + render-surface taxonomy)

### W4 — Tests + observability + ADR-027 + closing audit + mission-lifecycle.md v1.0 (~1.5-2d)

- **D1:** Hub vitest baseline + sweeper FSM coverage + escalation-FSM coverage
- **D2:** Adapter integration tests
- **D3:** Observability — pulse-fire rate / missed-pulse rate / escalation rate metrics; queryable for Director observability (Survey Q1B derivative outcome)
- **D4:** ADR-027 — Pulse primitive + PulseSweeper architecture
- **D5:** mission-lifecycle.md v1.0 co-ship — per-class default cadences + missionClass field + override semantics + when-to-disable + ScheduleWakeup boundary
- **D6:** Closing audit doc (engineer-authored; mission-55/56 closing audit shape)

### Sizing variance signals

- **Lower edge (~5d total):** if mission-56 W4 helper-pattern + W2.x adapter integration shapes replicate cleanly; W2 PulseSweeper composes against existing primitives without surprise; mission-lifecycle.md v1.0 work parallelized with Design phase
- **Upper edge (~8d total):** if W2 sweeper FSM has edge cases (missed-pulse + escalation + concurrent-mission scenarios) requiring extra test rebuild; ADR-027 takes longer than typical
- **L-firm escalation (XL):** if W3 adapter integration surfaces unexpected breaking changes for downstream consumers; or if mission-lifecycle.md v1.0 ratification surfaces methodology-doc-discipline gaps requiring extra work

---

## §8 Anti-goals (binding from Survey envelope + bilateral exchange)

| # | Anti-goal | Reason |
|---|---|---|
| 1 | NO Director-watchdog pulse in scope | Survey Q2: Director-watchdog OUT for this mission |
| 2 | NO Hub-baked cadence defaults | Survey Q3+Q4+Q6: per-mission declared; defaults emerge in mission-lifecycle.md as conventions, NOT Hub primitives |
| 3 | NO Design-doc-prescriptive runtime config | Survey Q6: mission entity is canonical declarative surface; Design doc descriptive |
| 4 | NO direct Director observability optimization | Survey Q1: derivative outcome; not primary; pulse not routed to Director |
| 5 | NO new MCP verbs | Existing surfaces sufficient (claim_message, ack_message, list_messages, update_mission, create_message); no contract extension |
| 6 | NO scheduled-message-sweeper composition for pulses | bilateral Q1: scheduled-message-sweeper is fire-once; concerns mix avoided |
| 7 | NO runtime-string-expression preconditions | bilateral Q2 + calibration #20: existing `{fn, args}` registry form preserves PR-reviewability + security boundary |
| 8 | NO sub-minute pulse cadences | bilateral Q5: pulse-storm anti-pattern; missedThreshold semantics break down; 60s sweeper tick is sufficient resolution for ≥5min cadences (≥300s recommended) |
| 9 | NO breaking changes to existing mission entity surface | W1: schema additive; backward-compat for missions without `pulses` field |
| 10 | NO breaking changes to W2.x notificationHooks contract | W3: new source-attribute is additive; existing contract unchanged |
| 11 | NO regression on bug-32 cross-package vitest baseline | Per mission-56 lineage; admin-merge baseline preserved |
| 12 | NO direct Director↔engineer surfaces (mediation invariant) | Pulse missed-threshold escalates via architect (architect-side `emitDirectorNotification`); preserves mediation invariant |

---

## §9 Sequencing + cross-references

### Sequencing

```
[idea-206 status: triaged]
    │
    ▼
[Survey ratified ← THIS DESIGN PHASE]
    │
    ▼
[Design v0.1 (this doc) → bilateral round-2 audit → Design v1.0]
    │
    ▼
[Manifest cascade: propose_mission(M-Mission-Pulse-Primitive)]
    │
    ▼
[Preflight artifact authored per docs/methodology/mission-preflight.md]
    │
    ▼
[Director release-gate signal: update_mission(status=active)]
    │
    ▼
[W0 spike → W1 schema → W2 sweeper → W3 adapter → W4 tests+ADR+lifecycle.md+closing audit]
    │
    ▼
[Mission status=completed → architect retrospective draft → HOLD per autonomous-arc-driving pattern]
    │
    ▼
[Tier 2 follow-ons remaining: idea-207 PAI-saga; idea-208 CI-dogfood; M-Adapter-Distribution]
```

### Cross-references

- **Survey artifact:** `docs/surveys/m-mission-pulse-primitive-survey.md` (ships in same PR as this Design doc)
- **idea-206 entity:** Hub-stored; concept-level scope this Design realizes
- **`project_mission_pulse_primitive.md`** (architect concept memo): pre-Survey concept memo; superseded by Survey + this Design (memory should be updated to reference this Design as canonical)
- **`feedback_director_intent_survey_process.md`**: methodology doctrine; first-class binding; this is the first canonical execution
- **`feedback_mechanise_declare_all_coordination`**: binding tele principle this realizes
- **mission-56 retrospective §7.5:** forward tele-9 advance; this mission realizes
- **mission-56 retrospective §5.4.1:** mission-class taxonomy; mission entity gains `missionClass` field per W6
- **mission-56 W2.x:** adapter SSE handler integration (consumed by §5)
- **mission-56 W3.2:** Message status FSM `new → received → acked` (consumed by §4 PulseSweeper response detection)
- **mission-56 W4.1:** director-notification-helpers.ts (consumed by §4 escalateMissedThreshold)
- **mission-51 W4:** Scheduled-Message primitive (NOT consumed; PulseSweeper is dedicated; bilateral Q1 verdict)
- **W4 precondition registry:** existing `{fn, args}` shape (consumed by §3 PulseConfig; bilateral Q2 verdict; calibration #20 preserved)
- **ADR-024:** StorageProvider boundary (consumed; no new contract)
- **ADR-025:** Message primitive (consumed by §5 pulse-as-Message)
- **ADR-026:** Universal Adapter Phase 1 push pipeline (consumed by §5 push-immediate delivery)
- **ADR-027 (this mission):** Pulse primitive + PulseSweeper architecture (W4 deliverable)
- **`docs/methodology/mission-preflight.md`:** consumed at preflight phase post Design v1.0
- **`docs/methodology/idea-survey.md`:** to be authored post-this-mission-ship as canonical execution example reference
- **`mission-lifecycle.md` v1.0:** co-ship at W4 D5 with per-class default cadence templates + override semantics + when-to-disable + ScheduleWakeup boundary

### Sister Tier 2 follow-ons

- **idea-207 M-PAI-Saga-On-Messages:** orthogonal; closes mission-56 W4.3 deferred work; saga-substrate-completion class
- **idea-208 M-Dogfood-CI-Automation:** orthogonal; tele-7 maturity; substrate-cleanup-wave / distribution-packaging hybrid; could ship before OR after idea-206
- **M-Adapter-Distribution:** orthogonal; npm publish under @apnex/* namespace; distribution-packaging class

— Architect: lily / 2026-04-26 (Design v0.1; bilateral exchange thread-349)
