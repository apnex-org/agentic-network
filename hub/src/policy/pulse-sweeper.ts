/**
 * PulseSweeper — mission-57 W2 (M-Mission-Pulse-Primitive).
 *
 * Per Design v1.0 §4 (with all engineer round-2 audit refinements baked in).
 *
 * Single Hub-instance recurring sweeper that iterates active missions
 * with declarative `pulses.{engineerPulse, architectPulse}` config; per-
 * pulse, evaluates fire/skip/escalation logic; emits pulse Messages via
 * the existing message store; observes pulse acks via `onPulseAcked`
 * cascade hook from `message-policy.ts:ackMessage`.
 *
 * Wire format (pulse Message; per Design v1.0 §5):
 *   - kind: "external-injection"
 *   - target: { role: <engineer|architect> } (per pulseKey)
 *   - delivery: "push-immediate"
 *   - payload: { pulseKind: "status_check", missionId, intervalSeconds, message, responseShape }
 *   - migrationSourceId: `pulse:<missionId>:<pulseKey>:<nextFireDueAt>` (Item-1
 *     deterministic key per Option A; restart-safe)
 *
 * Composition with W3.2 claim/ack FSM (Item-2 webhook path):
 *   - Adapter calls claim_message(pulseId) on render → status `new → received`
 *   - LLM acts via standard tools; adapter calls ack_message(pulseId)
 *   - message-policy.ts:ackMessage post-status-flip checks payload.pulseKind
 *     === "status_check" → invokes pulseSweeper.onPulseAcked(message)
 *   - PulseSweeper resets missedCount + updates lastResponseAt
 *
 * Mediation invariant on missed-threshold escalation (E1 fix):
 *   - emit Message with target.role="architect" (NOT director-direct)
 *   - architect LLM evaluates + decides Director-surface per categorised-
 *     concerns table; both-roles-silent degradation handled by Director
 *     operational-support pattern (mission-56 D3 precedent)
 *
 * Missed-count detection (E2 3-condition guard):
 *   - pulseFiredAtLeastOnce: lastFiredMs > 0
 *   - noAckSinceLastFire: lastResponseMs < lastFiredMs
 *   - graceWindowElapsed: now - lastFiredMs > intervalSeconds*1000 + grace
 *
 * Escalation-key handling (W2 engineer-final per thread-349 r8 + W0 D5):
 *   - Option C: NO migrationSourceId on escalation Messages (rare event;
 *     ULID-keyed Message naturally unique; sweeper-crash-mid-create
 *     duplicate acceptable)
 */

import type {
  IMessageStore,
  IMissionStore,
  Mission,
  MissionPulses,
  PulseConfig,
  PulseKey,
  Message,
} from "../entities/index.js";
import { PULSE_KEYS } from "../entities/index.js";
import type { Selector } from "../state.js";
import type { IPolicyContext } from "./types.js";
// Mission-68 W1 (Design v1.0 §4.2): precondition layer for pulses removed.
// `evaluatePrecondition` import dropped — pulses fire unconditionally on
// schedule (modulo missedThreshold pause + Step 4 missedCount-increment
// 3-condition guard preserved intact per C1 fold). The W4 registry stays
// for scheduled-message consumers (`thread-still-active`,
// `task-not-completed`).

const DEFAULT_TICK_INTERVAL_MS = 60_000;
const DEFAULT_GRACE_MS = 30_000;

/**
 * Mission-61 W1: map a pulse target-role to a dispatch Selector for SSE
 * push delivery. Symmetric with `pushSelector(target)` at
 * `message-policy.ts:456` — pulses always target a role (never an
 * agentId) so the selector is a single-role roles[] filter.
 *
 * Exported for unit testing.
 */
export function pulseSelector(targetRole: "engineer" | "architect"): Selector {
  return { roles: [targetRole] };
}

/**
 * Subset of the policy context that PulseSweeper needs at evaluation
 * time. Constructed by the wiring layer in `hub/src/index.ts` so the
 * sweeper can call `evaluatePrecondition` (which needs `ctx.stores`)
 * without depending on the full `IPolicyContext` shape (no transport
 * + no MCP-session ergonomics needed). Same pattern as
 * `ScheduledMessageSweeper`'s `SweeperContextProvider`.
 */
export interface PulseSweeperContextProvider {
  forSweeper(): IPolicyContext;
}

export interface PulseSweeperOptions {
  /** Tick interval in ms. Default 60000ms (60s). */
  intervalMs?: number;
  /** Grace window post-cadence before missed-count increments. Default 30000ms. */
  graceMs?: number;
  /** Optional metrics counter — same shape as IPolicyContext.metrics. */
  metrics?: IPolicyContext["metrics"];
  /** Optional logger. Defaults to console; tests can pass a no-op. */
  logger?: {
    log: (msg: string) => void;
    warn: (msg: string, err?: unknown) => void;
  };
  /** Optional time-source override for deterministic tests. Returns ms since epoch. */
  now?: () => number;
}

export interface PulseSweepResult {
  scanned: number;
  fired: number;
  skipped: number;
  escalated: number;
  errors: number;
}

export class PulseSweeper {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly graceMs: number;
  private readonly metrics: IPolicyContext["metrics"] | undefined;
  private readonly logger: { log: (m: string) => void; warn: (m: string, err?: unknown) => void };
  private readonly now: () => number;

  constructor(
    private readonly missionStore: IMissionStore,
    private readonly messageStore: IMessageStore,
    private readonly contextProvider: PulseSweeperContextProvider,
    options: PulseSweeperOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    this.metrics = options.metrics;
    this.logger = options.logger ?? {
      log: (m) => console.log(`[PulseSweeper] ${m}`),
      warn: (m, err) => console.warn(`[PulseSweeper] ${m}`, err ?? ""),
    };
    this.now = options.now ?? (() => Date.now());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.logger.warn(`tick error`, err));
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run one sweeper pass. Iterates active missions with `pulses.*`
   * config; per-pulse, evaluates fire-due / missed-threshold / precondition;
   * fires pulse Messages or increments missedCount + escalates.
   * Public for deterministic testing.
   */
  async tick(): Promise<PulseSweepResult> {
    const result: PulseSweepResult = { scanned: 0, fired: 0, skipped: 0, escalated: 0, errors: 0 };
    const activeMissions = await this.missionStore.listMissions("active");
    for (const mission of activeMissions) {
      if (!mission.pulses) continue;
      // (unset)/legacy missionClass = NO PULSE per Design v1.0 §6
      // backward-compat row. Skip missions that have explicit pulses
      // declared but no missionClass — they shouldn't have been able
      // to declare pulses at the MCP boundary, but be defensive.
      // Note: missions with both missionClass AND pulses fire normally.
      // Missions with missionClass but no pulses field also skip
      // (`if (!mission.pulses) continue;` above).
      for (const pulseKey of PULSE_KEYS) {
        const config = mission.pulses[pulseKey];
        if (!config) continue;
        result.scanned += 1;
        try {
          const outcome = await this.evaluatePulse(mission, pulseKey, config);
          if (outcome === "fired") result.fired += 1;
          else if (outcome === "escalated") result.escalated += 1;
          else result.skipped += 1;
        } catch (err) {
          result.errors += 1;
          this.logger.warn(
            `evaluatePulse failed for mission ${mission.id} pulse ${pulseKey}`,
            err,
          );
        }
      }
    }
    return result;
  }

  /**
   * Evaluate a single pulse on a mission. Returns:
   *   - "fired"     — pulse Message created (or short-circuited via idempotent re-fire)
   *   - "escalated" — missedThreshold breached; escalation Message emitted
   *   - "skipped"   — fire-not-due / precondition-false / paused-after-escalation
   */
  private async evaluatePulse(
    mission: Mission,
    pulseKey: PulseKey,
    config: PulseConfig,
  ): Promise<"fired" | "escalated" | "skipped"> {
    const nowMs = this.now();
    const lastFiredMs = config.lastFiredAt ? new Date(config.lastFiredAt).getTime() : 0;

    // 1. Pause: missedThreshold breached → no further fires until resumed
    if ((config.missedCount ?? 0) >= config.missedThreshold) {
      return "skipped";
    }

    // 2. Fire-due check
    const baseFireMs = this.computeNextFireDueMs(mission, config);
    if (nowMs < baseFireMs) {
      // Not yet due — check missed-response detection (E2 3-condition guard)
      // even when not firing, since the previous fire may have aged out
      // without a response.
      const escalated = await this.maybeIncrementMissedCountAndEscalate(
        mission,
        pulseKey,
        config,
        nowMs,
      );
      return escalated ? "escalated" : "skipped";
    }

    // 3. (Mission-68 W1, Design §4.2) Precondition check REMOVED — pulses
    //    fire on schedule unconditionally per Q3a Director-pick. The W4
    //    registry continues to serve scheduled-message consumers via the
    //    distinct `evaluatePrecondition` invocation in
    //    scheduled-message-sweeper.ts (NOT pulse fires).

    // 4. Detect missed response from PREVIOUS fire (E2 3-condition guard
    //    PRESERVED INTACT per C1 fold — orthogonal to precondition layer)
    //    before firing the next pulse.
    const escalated = await this.maybeIncrementMissedCountAndEscalate(
      mission,
      pulseKey,
      config,
      nowMs,
    );
    if (escalated) {
      return "escalated";
    }

    // 5. Re-read mission to check whether the previous step paused us
    //    (missedCount may have just incremented to threshold). Defensive:
    //    in-process serial execution means this re-read is mostly
    //    cosmetic, but closes the race-window for storage-CAS-retry.
    const fresh = await this.missionStore.getMission(mission.id);
    const freshConfig = fresh?.pulses?.[pulseKey];
    if (
      freshConfig &&
      (freshConfig.missedCount ?? 0) >= freshConfig.missedThreshold
    ) {
      return "skipped";
    }

    // 6. Fire pulse
    await this.firePulse(mission, pulseKey, config, baseFireMs);
    return "fired";
  }

  /**
   * Compute the deterministic `nextFireDueMs` from prior bookkeeping.
   * Per Item-1 fix (Option A): restart-safe; advances only after
   * successful bookkeeping update on previous fire.
   *
   * For first-fire (lastFiredAt undefined): base = mission.createdAt +
   * firstFireDelaySeconds (auto-injected default = intervalSeconds at
   * mission-policy.ts boundary, so this is mission.createdAt +
   * intervalSeconds for the typical case).
   */
  private computeNextFireDueMs(mission: Mission, config: PulseConfig): number {
    const lastFiredMs = config.lastFiredAt ? new Date(config.lastFiredAt).getTime() : 0;
    if (lastFiredMs > 0) {
      return lastFiredMs + config.intervalSeconds * 1000;
    }
    const firstFireDelaySeconds = config.firstFireDelaySeconds ?? config.intervalSeconds;
    return new Date(mission.createdAt).getTime() + firstFireDelaySeconds * 1000;
  }

  /**
   * Fire a pulse Message. Restart-safe via deterministic
   * `migrationSourceId`. If a Message with the same key already exists
   * (sweeper restart between createMessage + bookkeeping update), short-
   * circuit + reconcile bookkeeping.
   */
  private async firePulse(
    mission: Mission,
    pulseKey: PulseKey,
    config: PulseConfig,
    baseFireMs: number,
  ): Promise<void> {
    const fireAt = new Date(baseFireMs).toISOString();
    const migrationSourceId = `pulse:${mission.id}:${pulseKey}:${fireAt}`;

    // Idempotency check (S1) — restart-safe via deterministic key
    const existing = await this.messageStore.findByMigrationSourceId(migrationSourceId);
    if (existing) {
      // Already fired for this scheduled tick; reconcile bookkeeping if
      // sweeper crashed before the bookkeeping write landed
      if (!config.lastFiredAt || new Date(config.lastFiredAt).getTime() < baseFireMs) {
        await this.updatePulseBookkeeping(mission.id, pulseKey, { lastFiredAt: fireAt });
      }
      return;
    }

    const targetRole = pulseKey === "engineerPulse" ? "engineer" : "architect";

    const message = await this.messageStore.createMessage({
      kind: "external-injection",
      authorRole: "system",
      authorAgentId: "hub",
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

    await this.updatePulseBookkeeping(mission.id, pulseKey, { lastFiredAt: fireAt });
    this.metrics?.increment("pulse.fired", { missionId: mission.id, pulseKey });
    this.logger.log(
      `Fired ${pulseKey} for ${mission.id} at ${fireAt} (cadence ${config.intervalSeconds}s)`,
    );

    // Mission-61 W1 Fix #1: Path A SSE-push wiring. PulseSweeper bypassed
    // the MCP-tool boundary (`message-policy.ts:208-221` `ctx.dispatch
    // ("message_arrived")`) and the legacy entity-event path
    // (`hub-networking.ts:316-334` `notifyEvent`), so pulse Messages
    // persisted but never reached operator sessions (mission-60 Gap #1).
    // Fix is symmetric with the MCP-tool boundary: dispatch
    // `message_arrived` post-create. The adapter is already wired for
    // this event-kind with `payload.pulseKind` detection per mission-57
    // W3 (`adapters/claude-plugin/src/source-attribute.ts:80-141`).
    // Non-fatal on dispatch failure — Message already persisted; cold
    // reconnect-replay (W1b) or poll backstop (W3) recover.
    try {
      const ctx = this.contextProvider.forSweeper();
      await ctx.dispatch("message_arrived", { message }, pulseSelector(targetRole));
    } catch (err) {
      this.logger.warn(
        `[PulseSweeper] push-on-fire dispatch failed for ${message.id} (non-fatal)`,
        err,
      );
    }
  }

  /**
   * Mission-61 W1 Fix #2: architect-callable force-fire (Option α from
   * idea-213). Bypasses cadence + precondition checks; fires the pulse
   * NOW with operator-intent semantics (architect explicitly intervening,
   * wants fire immediately not after idle window).
   *
   * Mission-60 Gap #2: there was no MCP-tool path to force-fire because
   * sweeper-managed fields (lastFiredAt etc.) are stripped at
   * `mission-policy.ts:508` policy boundary — `update_mission` cannot
   * rewrite lastFiredAt. This method is the dedicated admin path,
   * invoked by the `force_fire_pulse` MCP tool (architect-only role-
   * gating at the tool layer).
   *
   * Semantics:
   *   - Skip computeNextFireDueMs (cadence-window irrelevant)
   *   - Skip evaluatePrecondition (idle-window override)
   *   - Direct firePulse(mission, pulseKey, config, baseFireMs=now)
   *   - lastFiredAt advances to fire time; missedCount NOT reset
   *     (separate concern; ack flow drives reset)
   *   - Idempotency: migrationSourceId uses now-timestamp (sub-second
   *     unique; collision rare and acceptable)
   *
   * Returns the fire-time ISO string on success; throws on
   * mission-not-found / pulse-not-configured / fire-error.
   */
  async forceFire(missionId: string, pulseKey: PulseKey): Promise<string> {
    const mission = await this.missionStore.getMission(missionId);
    if (!mission) {
      throw new Error(`forceFire: mission ${missionId} not found`);
    }
    const config = mission.pulses?.[pulseKey];
    if (!config) {
      throw new Error(
        `forceFire: mission ${missionId} has no ${pulseKey} configured`,
      );
    }
    const nowMs = this.now();
    await this.firePulse(mission, pulseKey, config, nowMs);
    return new Date(nowMs).toISOString();
  }

  /**
   * E2 3-condition guard: increment missedCount only when a previous
   * pulse fire happened AND no ack received in the grace window.
   * Avoids false-positive when prior tick skipped due to precondition
   * false. Returns true iff escalation was triggered (missedThreshold
   * breach).
   */
  private async maybeIncrementMissedCountAndEscalate(
    mission: Mission,
    pulseKey: PulseKey,
    config: PulseConfig,
    nowMs: number,
  ): Promise<boolean> {
    const lastFiredMs = config.lastFiredAt ? new Date(config.lastFiredAt).getTime() : 0;
    const lastResponseMs = config.lastResponseAt ? new Date(config.lastResponseAt).getTime() : 0;

    const pulseFiredAtLeastOnce = lastFiredMs > 0;
    const noAckSinceLastFire = lastResponseMs < lastFiredMs;
    const graceWindowElapsed =
      pulseFiredAtLeastOnce && nowMs - lastFiredMs > config.intervalSeconds * 1000 + this.graceMs;

    if (!(pulseFiredAtLeastOnce && noAckSinceLastFire && graceWindowElapsed)) {
      return false;
    }

    const newMissedCount = (config.missedCount ?? 0) + 1;
    await this.updatePulseBookkeeping(mission.id, pulseKey, { missedCount: newMissedCount });
    this.metrics?.increment("pulse.missed", {
      missionId: mission.id,
      pulseKey,
      missedCount: String(newMissedCount),
    });

    if (newMissedCount >= config.missedThreshold) {
      await this.escalateMissedThreshold(mission, pulseKey, config, newMissedCount);
      return true;
    }
    this.logger.log(
      `Missed ${pulseKey} on ${mission.id} (count=${newMissedCount}/${config.missedThreshold})`,
    );
    return false;
  }

  /**
   * E1 mediation-invariant fix: emit escalation Message with
   * target.role="architect" (NOT director-direct). Architect LLM
   * evaluates + decides Director-surface per categorised-concerns table.
   *
   * Escalation-key handling per thread-349 r8 + W0 D5: Option C — drop
   * migrationSourceId on escalation Messages. ULID-keyed Message
   * naturally unique; sweeper-crash-mid-create duplicate acceptable
   * (rare event; one per N years).
   */
  private async escalateMissedThreshold(
    mission: Mission,
    pulseKey: PulseKey,
    config: PulseConfig,
    missedCount: number,
  ): Promise<void> {
    const silentRole = pulseKey === "engineerPulse" ? "engineer" : "architect";

    const message = await this.messageStore.createMessage({
      kind: "external-injection",
      authorRole: "system",
      authorAgentId: "hub",
      target: { role: "architect" }, // E1: architect-routed; mediation invariant
      delivery: "push-immediate",
      payload: {
        pulseKind: "missed_threshold_escalation",
        missionId: mission.id,
        silentRole,
        missedCount,
        intervalSeconds: config.intervalSeconds,
        threshold: config.missedThreshold,
        title: `Mission ${mission.id} ${silentRole} pulse missed ${missedCount} times`,
        details:
          `Pulse cadence ${config.intervalSeconds}s; threshold ${config.missedThreshold}; ` +
          `pulse paused. Architect: evaluate + resolve OR escalate to Director per ` +
          `categorised-concerns table.`,
      },
      // No migrationSourceId per Option C (W2 engineer-final)
    });

    await this.updatePulseBookkeeping(mission.id, pulseKey, {
      lastEscalatedAt: new Date().toISOString(),
    });
    this.metrics?.increment("pulse.escalated", {
      missionId: mission.id,
      pulseKey,
      missedCount: String(missedCount),
    });
    this.logger.warn(
      `Escalated ${pulseKey} on ${mission.id} (missed ${missedCount}/${config.missedThreshold})`,
    );

    // Mission-61 W1 Fix #1: Path A SSE-push wiring also for escalation
    // Messages. mission-60 surfaced that the same Path C bypass affected
    // escalation Message creation here — architect never saw missed-
    // threshold escalations either. Same dispatch pattern as firePulse;
    // architect-routed selector matches mediation-invariant target.
    try {
      const ctx = this.contextProvider.forSweeper();
      await ctx.dispatch("message_arrived", { message }, pulseSelector("architect"));
    } catch (err) {
      this.logger.warn(
        `[PulseSweeper] push-on-escalate dispatch failed for ${message.id} (non-fatal)`,
        err,
      );
    }
  }

  /**
   * Item-2 webhook composition: invoked from
   * `message-policy.ts:ackMessage` post-status-flip-to-acked when the
   * Message's payload has `pulseKind === "status_check"`. Resets
   * missedCount + updates lastResponseAt.
   *
   * Public so the policy layer can invoke via `ctx.stores.pulseSweeper`.
   */
  async onPulseAcked(pulseMessage: Message): Promise<void> {
    const payload = pulseMessage.payload as { missionId?: unknown };
    const missionId = typeof payload.missionId === "string" ? payload.missionId : null;
    if (!missionId) {
      this.logger.warn(
        `onPulseAcked: pulse Message ${pulseMessage.id} payload missing missionId; skip`,
      );
      return;
    }
    const targetRole = pulseMessage.target?.role;
    const pulseKey: PulseKey | null =
      targetRole === "engineer"
        ? "engineerPulse"
        : targetRole === "architect"
          ? "architectPulse"
          : null;
    if (!pulseKey) {
      this.logger.warn(
        `onPulseAcked: pulse Message ${pulseMessage.id} target.role unrecognized; skip`,
      );
      return;
    }
    const responseAt = new Date().toISOString();
    await this.updatePulseBookkeeping(missionId, pulseKey, {
      lastResponseAt: responseAt,
      missedCount: 0,
    });
    this.metrics?.increment("pulse.acked", { missionId, pulseKey });
    this.logger.log(`Acked ${pulseKey} on ${missionId} at ${responseAt}`);
  }

  /**
   * Update sweeper-managed bookkeeping fields on a single pulse via
   * direct repository update. Bypasses MCP-tool boundary (which strips
   * sweeper-managed fields); only PulseSweeper writes these.
   *
   * Repository's `updateMission` uses `mergePulsesPreservingBookkeeping`
   * so missing fields in the incoming `pulses[pulseKey]` are preserved
   * from on-disk state.
   */
  private async updatePulseBookkeeping(
    missionId: string,
    pulseKey: PulseKey,
    delta: Partial<Pick<PulseConfig, "lastFiredAt" | "lastResponseAt" | "missedCount" | "lastEscalatedAt">>,
  ): Promise<void> {
    const mission = await this.missionStore.getMission(missionId);
    if (!mission || !mission.pulses?.[pulseKey]) {
      this.logger.warn(
        `updatePulseBookkeeping: mission ${missionId} pulse ${pulseKey} missing; skip`,
      );
      return;
    }
    const existing = mission.pulses[pulseKey];
    const next: PulseConfig = {
      intervalSeconds: existing.intervalSeconds,
      message: existing.message,
      responseShape: existing.responseShape,
      missedThreshold: existing.missedThreshold,
      firstFireDelaySeconds: existing.firstFireDelaySeconds,
      lastFiredAt: delta.lastFiredAt ?? existing.lastFiredAt,
      lastResponseAt:
        delta.lastResponseAt !== undefined ? delta.lastResponseAt : existing.lastResponseAt,
      missedCount: delta.missedCount !== undefined ? delta.missedCount : existing.missedCount,
      lastEscalatedAt:
        delta.lastEscalatedAt !== undefined ? delta.lastEscalatedAt : existing.lastEscalatedAt,
    };
    const otherKey: PulseKey = pulseKey === "engineerPulse" ? "architectPulse" : "engineerPulse";
    const updatedPulses: MissionPulses = {
      [pulseKey]: next,
      ...(mission.pulses[otherKey] ? { [otherKey]: mission.pulses[otherKey] } : {}),
    } as MissionPulses;
    await this.missionStore.updateMission(missionId, { pulses: updatedPulses });
  }
}
