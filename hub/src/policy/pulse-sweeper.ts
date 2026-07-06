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
  MessageAuthorRole,
} from "../entities/index.js";
import type { WorkItem } from "../entities/work-item.js";
import { PULSE_KEYS } from "../entities/index.js";
import type { Selector, Agent, AgentPulseConfig, AgentRole } from "../state.js";
import { AGENT_PULSE_KIND } from "../state.js";
import type { IPolicyContext } from "./types.js";
// Mission-68 W1 (Design v1.0 §4.2): precondition layer for pulses removed.
// `evaluatePrecondition` import dropped — pulses fire unconditionally on
// schedule (modulo missedThreshold pause + Step 4 missedCount-increment
// 3-condition guard preserved intact per C1 fold). The W4 registry stays
// for scheduled-message consumers (`thread-still-active`,
// `task-not-completed`).

const DEFAULT_TICK_INTERVAL_MS = 60_000;
const DEFAULT_GRACE_MS = 30_000;

// S1a-(i) (idea-458): after missedThreshold breach the pulse must NOT go silent
// (a self-disabled anti-idle backstop is worse than none). It keeps firing at a
// FLOOR cadence = max(intervalSeconds, this). The floor is a hard anti-storm
// minimum between post-escalation fires; for any normally-configured pulse
// (intervalSeconds ≥ 60) it does not bind and the pulse continues at its normal
// cadence — it only caps a pathologically fast interval.
const PULSE_ESCALATION_FLOOR_SECONDS = 60;

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
    // mission-75 v1.0 §3.4 — second iteration pass for agentPulse
    // (iterate-Agents-not-missions per M1 fold; AGENT_PULSE_KIND stays
    // SEPARATE from PULSE_KEYS to preserve the `mission.pulses[pulseKey]`
    // invariant in 6-file references). STRICT suppression rule per M3
    // fold — skip if agent is on any active mission. Per Design §3.4,
    // the permissive alternative was explicitly rejected.
    try {
      await this.iterateAgentPulses(activeMissions, result);
    } catch (err) {
      result.errors += 1;
      this.logger.warn(`iterateAgentPulses pass failed`, err);
    }
    // W1 (idea-446 / work-181): the ADDITIVE node-native pulse pass — the
    // backstop, carried on the arc-node itself. Runs ALONGSIDE the Mission-pulse
    // passes (dual-run-safe per v0.3 §4); the live-cutover of an existing
    // mission's pulse is the STAGED Director-ratified procedure, not this code.
    try {
      await this.iterateNodePulses(result);
    } catch (err) {
      result.errors += 1;
      this.logger.warn(`iterateNodePulses pass failed`, err);
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

    // 1. Post-escalation FLOOR CADENCE (S1a-(i), idea-458): missedThreshold
    //    breached. Previously this returned "skipped" forever — the pulse went
    //    silent (self-disabled), the WORST failure mode (a paused backstop is
    //    worse than none: false assurance while silently off). Instead, keep
    //    firing at a floor cadence so a stalled/idle agent is still nudged.
    //    Escalation already fired exactly once (on the tick that CROSSED the
    //    threshold, via step 4 → maybeIncrementMissedCountAndEscalate); this
    //    path deliberately does NOT re-run missed-detection/crediting, so it
    //    cannot re-escalate (no storm) and does not touch the crediting logic
    //    (that is S1a-(ii)) — escalation-RESPONSE only.
    if ((config.missedCount ?? 0) >= config.missedThreshold) {
      const floorSeconds = Math.max(config.intervalSeconds, PULSE_ESCALATION_FLOOR_SECONDS);
      const floorDueMs = lastFiredMs + floorSeconds * 1000;
      if (nowMs < floorDueMs) {
        return "skipped"; // floor cadence not yet due — quiet between floor fires, not silent
      }
      await this.firePulse(mission, pulseKey, config, floorDueMs);
      return "fired";
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

    // S1a-(ii) (idea-458, S1 v0.3 §3.2): ack-only would declare a MISS here — but
    // an authored WRITE by the pulse's TARGET agent is liveness too. The lived
    // incident was a working-but-not-acking agent false-flagged idle. If the
    // target agent authored anything since the last fire, it is demonstrably
    // working → NOT missed. SCOPED to the target role's agentId(s), NEVER
    // any-agent: crediting the architectPulse off engineers' writes would
    // reproduce the incident inverted (architect idle, engineers writing →
    // falsely LIVE → never nudged). Ack remains an additional positive signal
    // (handled by noAckSinceLastFire above); authored-write is the primary one.
    if (await this.targetAuthoredWriteSince(pulseKey, lastFiredMs)) {
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
   * S1a-(ii) (idea-458 / S1 v0.3 §3.2): has the pulse's TARGET agent authored any
   * Message since `sinceMs`? Message-authorship is the do-now authored-write
   * liveness proxy — passive to the crediting logic, provably advances on real
   * work (the incident's architect authored 5+ messages while false-flagged idle).
   *
   * SCOPED to the target role's agentId(s). A stint is multi-agent; crediting a
   * pulse off a DIFFERENT agent's writes reproduces the incident inverted (target
   * idle while others write → falsely LIVE). The pulse's target role (engineer /
   * architect) resolves to its agent(s) via the registry; a Message counts only
   * if its authorAgentId is one of them.
   *
   * Fail-safe: an unresolvable registry / no target agent → false, so
   * missed-detection falls back to the ack-only signal (never a spurious
   * live-credit that would silence the backstop).
   */
  private async targetAuthoredWriteSince(pulseKey: PulseKey, sinceMs: number): Promise<boolean> {
    const targetRole = pulseKey === "engineerPulse" ? "engineer" : "architect";
    try {
      const registry = this.contextProvider.forSweeper().stores.engineerRegistry;
      if (!registry) return false;
      const agents = await registry.listAgents();
      const targetIds = agents.filter((a) => a.role === targetRole).map((a) => a.id);
      for (const agentId of targetIds) {
        // BOUNDED existence — must not fetch-all-then-index. `hasAuthoredSince`
        // resolves the newest message by this author (id-descending, limit 1);
        // a `listMessages(...).length-1` would be capped to the oldest 500 and
        // miss a prolific target's in-window write (bug-117 / idea-292 class).
        if (await this.messageStore.hasAuthoredSince(agentId, sinceMs)) return true;
      }
      return false;
    } catch {
      return false;
    }
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
          `pulse CONTINUES at a floor cadence (S1a-(i), idea-458 — no longer self-disables on ` +
          `escalation). Architect: evaluate + resolve OR escalate to Director per ` +
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
   * mission-75 v1.0 §3.4 — agentPulse second iteration pass. Iterates
   * registered agents (NOT missions) per M1 fold. Fires per-agent
   * pulses subject to STRICT suppression rule (M3 fold — permissive
   * alternative explicitly rejected): agentPulse fires for agent X
   * iff:
   *   - agent.pulseConfig?.enabled === true
   *   - AND no active mission has agent X in its pulse-binding (i.e.,
   *     agent X is NOT createdBy on any active mission AND NOT
   *     assignedAgentId on any task whose correlationId is in the
   *     active-mission set).
   *
   * Per Design §3.4 rationale: "agent on active mission is busy by
   * definition; the system already trusts mission-pulse engagement
   * (engineerPulse OR architectPulse) to monitor agent liveness during
   * mission engagement."
   *
   * Death-detection-slow-but-cheap signal between missions per
   * envelope hybrid γ pulse architecture.
   */
  private async iterateAgentPulses(
    activeMissions: Mission[],
    result: PulseSweepResult,
  ): Promise<void> {
    const ctx = this.contextProvider.forSweeper();
    // bug-176 — defense-in-depth: a context whose stores omit engineerRegistry
    // (a partial test/dev rig) would otherwise throw `Cannot read properties of
    // undefined (reading 'listAgents')` on every tick. Production always wires it
    // (index.ts); guard so a misconfigured rig degrades to a clean no-op pass.
    const registry = ctx.stores.engineerRegistry;
    if (!registry) return;
    const agents: Agent[] = await registry.listAgents();
    const eligible = agents.filter((a) => a.pulseConfig?.enabled === true);
    if (eligible.length === 0) return;

    // STRICT suppression — build engaged-agent set from active missions
    // (architect-side: createdBy.agentId). work-162 (A1): the former
    // engineer-side augmentation (assignedAgentId on tasks whose correlationId
    // is an active mission) is retired with the Task subsystem.
    const engaged = new Set<string>();
    for (const m of activeMissions) {
      if (m.createdBy?.agentId) engaged.add(m.createdBy.agentId);
    }

    const nowMs = this.now();
    for (const agent of eligible) {
      const config = agent.pulseConfig as AgentPulseConfig;
      result.scanned += 1;

      // STRICT suppression — agent on any active mission → skip.
      if (engaged.has(agent.id)) {
        result.skipped += 1;
        continue;
      }

      // Cadence check — fire if interval elapsed since last fire (or
      // since registration if never fired). agentPulse v1 ships without
      // missedCount/escalation; cadence-driven re-fire provides
      // operator visibility on persistent silence.
      const baseMs = config.lastFiredAt
        ? Date.parse(config.lastFiredAt)
        : Date.parse(agent.firstSeenAt);
      const dueAtMs = (Number.isFinite(baseMs) ? baseMs : nowMs) + config.intervalSeconds * 1000;
      if (nowMs < dueAtMs) {
        result.skipped += 1;
        continue;
      }

      try {
        await this.fireAgentPulse(agent, config, nowMs);
        result.fired += 1;
      } catch (err) {
        result.errors += 1;
        this.logger.warn(`fireAgentPulse failed for agent ${agent.id}`, err);
      }
    }
  }

  /**
   * Fire an agentPulse Message targeting a single agent (NOT role).
   * Restart-safe via deterministic migrationSourceId. Updates
   * agent.pulseConfig.lastFiredAt post-fire.
   */
  private async fireAgentPulse(
    agent: Agent,
    config: AgentPulseConfig,
    nowMs: number,
  ): Promise<void> {
    const fireAt = new Date(nowMs).toISOString();
    const migrationSourceId = `pulse:${AGENT_PULSE_KIND}:${agent.id}:${fireAt}`;

    const existing = await this.messageStore.findByMigrationSourceId(migrationSourceId);
    if (existing) return; // restart-safe; sweeper crashed mid-create on prior tick

    const message = await this.messageStore.createMessage({
      kind: "external-injection",
      authorRole: "system",
      authorAgentId: "hub",
      target: { agentId: agent.id }, // single-recipient pulse per §3.4
      delivery: "push-immediate",
      payload: {
        pulseKind: "agent_status_check",
        agentId: agent.id,
        intervalSeconds: config.intervalSeconds,
        message: config.message,
        responseShape: config.responseShape,
      },
      migrationSourceId,
    });

    await this.updateAgentPulseLastFiredAt(agent.id, fireAt);
    this.metrics?.increment("agent_pulse.fired", { agentId: agent.id });
    this.logger.log(
      `Fired ${AGENT_PULSE_KIND} for ${agent.id} at ${fireAt} (cadence ${config.intervalSeconds}s)`,
    );

    // Mirror the missionPulse fire-then-dispatch wiring so the agentPulse
    // Message reaches the operator session via SSE push immediately.
    try {
      const ctx = this.contextProvider.forSweeper();
      // Single-agent target — selector points at the specific agentId.
      await ctx.dispatch("message_arrived", { message }, { agentIds: [agent.id] } as Selector);
    } catch (err) {
      this.logger.warn(
        `[PulseSweeper] agentPulse push-on-fire dispatch failed for ${message.id} (non-fatal)`,
        err,
      );
    }
  }

  /**
   * Persist agentPulse bookkeeping (lastFiredAt) on the Agent record.
   * Uses the engineer-registry's updateAgentPulseLastFiredAt mutator
   * (added in the same commit as the schema delta).
   */
  private async updateAgentPulseLastFiredAt(agentId: string, lastFiredAt: string): Promise<void> {
    const ctx = this.contextProvider.forSweeper();
    const reg = ctx.stores.engineerRegistry as { updateAgentPulseLastFiredAt?: (agentId: string, lastFiredAt: string) => Promise<void> };
    if (typeof reg.updateAgentPulseLastFiredAt === "function") {
      await reg.updateAgentPulseLastFiredAt(agentId, lastFiredAt);
    } else {
      this.logger.warn(`updateAgentPulseLastFiredAt not implemented on engineerRegistry; bookkeeping skipped`);
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
    const payload = pulseMessage.payload as { missionId?: unknown; nodeId?: unknown };
    // W1 (idea-446): node-native pulse ACK path — a node pulse carries `nodeId` (not
    // missionId), so without this branch a node ACK never credited nodeConfig.pulse
    // bookkeeping → false misses/escalations (steve W1 gate #1).
    const nodeId = typeof payload.nodeId === "string" ? payload.nodeId : null;
    if (nodeId) return this.onNodePulseAcked(nodeId, pulseMessage);
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

  /** W1 (idea-446): node-native pulse ACK. HOLDER-SCOPED (steve W1 gate #2): a LEASED
   *  node's pulse is credited ONLY by its FRESH holder — a same-role non-holder acking
   *  must NOT credit (else it false-credits while the holder is silent — the S1a-(ii)
   *  agent-scoping, on the ACK side). Credits lastResponseAt + resets missedCount.
   *  Never throws (best-effort, like the mission ack path). */
  private async onNodePulseAcked(nodeId: string, pulseMessage: Message): Promise<void> {
    try {
      const store = this.nodeStore();
      if (!store) return;
      const node = await store.getWorkItem(nodeId);
      if (!node?.nodeConfig?.pulse) {
        this.logger.warn(`onPulseAcked: node ${nodeId} carries no node pulse; skip`);
        return;
      }
      const holder = node.lease?.holder;
      const acker = (pulseMessage as { claimedBy?: string | null }).claimedBy ?? null;
      if (holder && acker && acker !== holder) {
        this.logger.warn(`onPulseAcked: node ${nodeId} ACK by ${acker} != fresh holder ${holder}; NOT crediting`);
        return;
      }
      const responseAt = new Date().toISOString();
      await store.updateNodePulseBookkeeping(nodeId, { lastResponseAt: responseAt, missedCount: 0 });
      this.metrics?.increment("pulse.node.acked", { nodeId });
      this.logger.log(`Acked node pulse ${nodeId} at ${responseAt}`);
    } catch (err) {
      this.logger.warn(`onNodePulseAcked failed for ${nodeId} (non-fatal)`, err);
    }
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
  // ── W1 (idea-446 / work-181): the ADDITIVE node-native pulse pass ─────────────
  // The anti-idle backstop carried on the arc-node itself (nodeConfig.pulse),
  // reusing the merged S1a machinery: the no-silence floor (PULSE_ESCALATION_FLOOR_
  // SECONDS) + authored-write crediting (hasAuthoredSince), agent-scoped per fork (c).
  // Mission-pulse passes are untouched (dual-run-safe).

  private nodeStore() {
    const s = this.contextProvider.forSweeper().stores.workItem;
    if (!s) return null;
    return s;
  }

  /** Iterate pulse-carrying, non-terminal arc-nodes. nodeConfig.pulse is
   *  status-partitioned + non-filterable (no index), so scan the observability
   *  list + client-filter (bounded by the listWorkItems cap). NEVER throws
   *  per-node — one bad node cannot stall the sweep. */
  private async iterateNodePulses(result: PulseSweepResult): Promise<void> {
    const store = this.nodeStore();
    if (!store) return;
    const { items, truncated } = await store.listWorkItems();
    if (truncated) {
      // FAIL-LOUD (steve W1 gate #5): nodeConfig.pulse is status-partitioned + non-filterable
      // (no index), so the scan can't be scoped — a pulse-carrying node beyond the listWorkItems
      // cap would be SILENTLY unbacked this tick. Surface it (error + metric) rather than hide it;
      // a backstop scan that silently drops coverage is worse than none.
      result.errors += 1;
      this.metrics?.increment("pulse.node.scan_truncated", {});
      this.logger.warn(
        `iterateNodePulses: listWorkItems scan hit the cap (truncated) — a pulse-carrying node MAY be omitted this tick; node-pulse coverage is INCOMPLETE`,
      );
    }
    const terminal = new Set(["done", "abandoned"]);
    const pulseNodes = items.filter((n) => n.nodeConfig?.pulse && !terminal.has(n.status));
    for (const node of pulseNodes) {
      result.scanned += 1;
      try {
        const outcome = await this.evaluateNodePulse(node);
        if (outcome === "fired") result.fired += 1;
        else if (outcome === "escalated") result.escalated += 1;
        else result.skipped += 1;
      } catch (err) {
        result.errors += 1;
        this.logger.warn(`evaluateNodePulse failed for node ${node.id}`, err);
      }
    }
  }

  /** The node-pulse FSM — mirrors evaluatePulse (S1a): post-escalation floor,
   *  fire-due, missed-detection-with-reprieve, fire. */
  private async evaluateNodePulse(node: WorkItem): Promise<"fired" | "escalated" | "skipped"> {
    const config = node.nodeConfig!.pulse!;
    const nowMs = this.now();
    const lastFiredMs = config.lastFiredAt ? new Date(config.lastFiredAt).getTime() : 0;

    // 1. Post-escalation FLOOR CADENCE (S1a-(i) reuse): breached → keep firing at
    //    a floor, never go silent.
    if ((config.missedCount ?? 0) >= config.missedThreshold) {
      const floorSeconds = Math.max(config.intervalSeconds, PULSE_ESCALATION_FLOOR_SECONDS);
      const floorDueMs = lastFiredMs + floorSeconds * 1000;
      if (nowMs < floorDueMs) return "skipped";
      await this.fireNodePulse(node, config, floorDueMs);
      return "fired";
    }

    // 2. Fire-due (first fire off node.createdAt + firstFireDelay; then cadence).
    const baseFireMs = lastFiredMs > 0
      ? lastFiredMs + config.intervalSeconds * 1000
      : new Date(node.createdAt).getTime() + (config.firstFireDelaySeconds ?? config.intervalSeconds) * 1000;
    if (nowMs < baseFireMs) {
      return (await this.detectNodePulseMiss(node, config, nowMs)) ? "escalated" : "skipped";
    }

    // 4. Missed-detection on the PREVIOUS fire before firing the next.
    if (await this.detectNodePulseMiss(node, config, nowMs)) return "escalated";

    // 6. Fire.
    await this.fireNodePulse(node, config, baseFireMs);
    return "fired";
  }

  /** Missed-detection for a node pulse (S1a): ack OR authored-write credits
   *  liveness (reprieve); else increment + escalate at threshold. Returns true
   *  iff it escalated this pass. */
  private async detectNodePulseMiss(node: WorkItem, config: PulseConfig, nowMs: number): Promise<boolean> {
    const lastFiredMs = config.lastFiredAt ? new Date(config.lastFiredAt).getTime() : 0;
    const lastResponseMs = config.lastResponseAt ? new Date(config.lastResponseAt).getTime() : 0;
    const pulseFiredAtLeastOnce = lastFiredMs > 0;
    const noAckSinceLastFire = lastResponseMs < lastFiredMs;
    const graceElapsed = pulseFiredAtLeastOnce && nowMs - lastFiredMs > config.intervalSeconds * 1000 + this.graceMs;
    if (!(pulseFiredAtLeastOnce && noAckSinceLastFire && graceElapsed)) return false;

    // S1a-(ii) reprieve: an authored write by the node's TARGET agent credits
    // liveness — NOT missed.
    if (await this.nodeTargetAuthoredSince(node, lastFiredMs)) return false;

    const store = this.nodeStore();
    if (!store) return false;
    const newMissed = (config.missedCount ?? 0) + 1;
    await store.updateNodePulseBookkeeping(node.id, { missedCount: newMissed });
    this.metrics?.increment("pulse.node.missed", { nodeId: node.id, missedCount: String(newMissed) });
    if (newMissed >= config.missedThreshold) {
      await this.escalateNodePulse(node, config, newMissed);
      return true;
    }
    return false;
  }

  /** W1 fork (c): the node-pulse credits authored writes by the node's HOLDER if
   *  leased (single-agent, precise), else its roleEligibility-role agents; EMPTY
   *  roleEligibility (any-role) → NO reprieve (ack-only), so an any-agent write can
   *  never false-credit (the S1a-(ii) multi-agent trap). The leased→holder branch
   *  is the SAME holder-scoping W3's arc-child in-flight predicate uses — the same
   *  predicate at the two ends of the lifecycle; keep them consistent (a future
   *  refactor should share one helper so they can't drift). Fail-safe → false. */
  private async nodeTargetAuthoredSince(node: WorkItem, sinceMs: number): Promise<boolean> {
    try {
      const holder = node.lease?.holder;
      if (holder) return await this.messageStore.hasAuthoredSince(holder, sinceMs);
      const roles = node.roleEligibility ?? [];
      if (roles.length === 0) return false; // any-role → ack-only, never any-agent credit
      const registry = this.contextProvider.forSweeper().stores.engineerRegistry;
      if (!registry) return false;
      const agents = await registry.listAgents();
      for (const a of agents.filter((ag) => roles.includes(ag.role))) {
        if (await this.messageStore.hasAuthoredSince(a.id, sinceMs)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Fire a node pulse (mirrors firePulse): restart-safe migrationSourceId,
   *  role-targeted message, bookkeeping via updateNodePulseBookkeeping. */
  private async fireNodePulse(node: WorkItem, config: PulseConfig, baseFireMs: number): Promise<void> {
    const store = this.nodeStore();
    if (!store) return;
    const fireAt = new Date(baseFireMs).toISOString();
    const migrationSourceId = `pulse:node:${node.id}:${fireAt}`;
    const existing = await this.messageStore.findByMigrationSourceId(migrationSourceId);
    if (existing) {
      if (!config.lastFiredAt || new Date(config.lastFiredAt).getTime() < baseFireMs) {
        await store.updateNodePulseBookkeeping(node.id, { lastFiredAt: fireAt });
      }
      return;
    }
    // W1 gate #2 (holder-scoped delivery): deliver to the specific HOLDER when the node is
    // leased (so a same-role NON-holder can't claim/ack the pulse and false-credit it), else
    // the eligible role, else broadcast. Symmetric with the holder-scoped ack + crediting.
    const holder = node.lease?.holder ?? null;
    const targetRole = node.roleEligibility && node.roleEligibility.length > 0 ? node.roleEligibility[0] : null;
    const target = holder ? { agentId: holder } : targetRole ? { role: targetRole as MessageAuthorRole } : null;
    const message = await this.messageStore.createMessage({
      kind: "external-injection",
      authorRole: "system",
      authorAgentId: "hub",
      target,
      delivery: "push-immediate",
      payload: {
        pulseKind: "status_check",
        nodeId: node.id,
        intervalSeconds: config.intervalSeconds,
        message: config.message,
        responseShape: config.responseShape,
      },
      migrationSourceId,
    });
    await store.updateNodePulseBookkeeping(node.id, { lastFiredAt: fireAt });
    this.metrics?.increment("pulse.node.fired", { nodeId: node.id });
    this.logger.log(`Fired node pulse for ${node.id} at ${fireAt} (cadence ${config.intervalSeconds}s)`);
    // W1 gate #3 (push-on-fire wake): dispatch message_arrived non-fatally, symmetric with the
    // mission firePulse Path-A wake — else a node pulse persists but never wakes the session
    // (the persisted-but-not-woken gap). Selector matches the delivery scope.
    try {
      const ctx = this.contextProvider.forSweeper();
      const selector: Selector = holder ? { agentId: holder } : targetRole ? { roles: [targetRole as AgentRole] } : {};
      await ctx.dispatch("message_arrived", { message }, selector);
    } catch (err) {
      this.logger.warn(`[PulseSweeper] node push-on-fire dispatch failed for ${node.id} (non-fatal)`, err);
    }
  }

  /** Escalate a node pulse (E1 mediation invariant: architect-routed). */
  private async escalateNodePulse(node: WorkItem, config: PulseConfig, missedCount: number): Promise<void> {
    const store = this.nodeStore();
    if (!store) return;
    await this.messageStore.createMessage({
      kind: "external-injection",
      authorRole: "system",
      authorAgentId: "hub",
      target: { role: "architect" },
      delivery: "push-immediate",
      payload: {
        pulseKind: "missed_threshold_escalation",
        nodeId: node.id,
        missedCount,
        intervalSeconds: config.intervalSeconds,
        threshold: config.missedThreshold,
        title: `Arc-node ${node.id} pulse missed ${missedCount} times`,
        details:
          `Node-native backstop; cadence ${config.intervalSeconds}s; threshold ${config.missedThreshold}; ` +
          `pulse CONTINUES at a floor cadence (S1a-(i) — no self-disable). Architect: evaluate + resolve OR ` +
          `escalate to Director per categorised-concerns table.`,
      },
    });
    await store.updateNodePulseBookkeeping(node.id, { lastEscalatedAt: new Date().toISOString() });
    this.metrics?.increment("pulse.node.escalated", { nodeId: node.id, missedCount: String(missedCount) });
    this.logger.warn(`Escalated node pulse for ${node.id} (missed ${missedCount}/${config.missedThreshold})`);
  }

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
