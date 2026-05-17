/**
 * mission-83 W3.x.2 — PulseSweeperSubstrate (minimal substrate-API integration)
 *
 * Substrate-API version of `PulseSweeper` (mission-57 W2; per Design v1.3 §4
 * W3 row).
 *
 * SCOPE NOTE — Minimal substrate-API skeleton: PulseSweeper has ~543 LOC of
 * complex business logic (evaluatePulse + iterateAgentPulses + onPulseAcked +
 * missed-count 3-condition guard + escalation handling + mediation invariants).
 * This W3.x.2 substrate-version validates the substrate-API integration pattern
 * (listMissions equivalent via substrate.list('Mission', { filter: { status:
 * 'active' } })) but defers full business-logic port to W3.x.2-extended OR
 * W4-Option-Y-repository-composition (where MissionRepository internally
 * composes substrate and the existing PulseSweeper-via-IMissionStore facade
 * works as-is). Surface for architect decision.
 *
 * Per α-reading: pure-additive at W3.x; production wire-up at hub/src/index.ts
 * UNCHANGED (still instantiates FS-version PulseSweeper); W5 cutover swaps.
 *
 * What's substrate-versioned:
 *   - tick() entry point + listMissions equivalent via substrate.list
 *   - Per-mission iteration loop preserving pulses[pulseKey] invariant
 *   - Stub evaluatePulse + iterateAgentPulses for spike-quality
 *
 * What's deferred:
 *   - Full evaluatePulse logic (fire/skip/missed-threshold; needs messageStore
 *     substrate-version)
 *   - iterateAgentPulses (needs engineerRegistry substrate-version)
 *   - onPulseAcked cascade hook (called from message-policy.ts; needs PolicyContext
 *     integration)
 */

import type { HubStorageSubstrate, Filter } from "../storage-substrate/index.js";
import type { IPolicyContext } from "./types.js";
import type { Mission } from "../entities/index.js";

const DEFAULT_TICK_INTERVAL_MS = 30_000;
const MISSION_KIND = "Mission";
const PULSE_KEYS = ["engineerPulse", "architectPulse"] as const;
type PulseKey = typeof PULSE_KEYS[number];

export interface PulseSweeperSubstrateOptions {
  intervalMs?: number;
  graceMs?: number;
  metrics?: IPolicyContext["metrics"];
  logger?: {
    log: (msg: string) => void;
    warn: (msg: string, err?: unknown) => void;
  };
  now?: () => number;
}

export interface PulseSweepResult {
  scanned: number;
  fired: number;
  skipped: number;
  escalated: number;
  errors: number;
}

export interface PulseSweeperContextProvider {
  forSweeper(): IPolicyContext;
}

export class PulseSweeperSubstrate {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly metrics: IPolicyContext["metrics"] | undefined;
  private readonly logger: { log: (m: string) => void; warn: (m: string, err?: unknown) => void };
  private readonly now: () => number;

  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly contextProvider: PulseSweeperContextProvider,
    options: PulseSweeperSubstrateOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.metrics = options.metrics;
    this.logger = options.logger ?? {
      log: (m) => console.log(`[PulseSweeperSubstrate] ${m}`),
      warn: (m, err) => console.warn(`[PulseSweeperSubstrate] ${m}`, err ?? ""),
    };
    this.now = options.now ?? (() => Date.now());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.logger.warn(`tick error`, err));
    }, this.intervalMs);
    if (typeof (this.timer as { unref?: () => void }).unref === "function") {
      (this.timer as { unref: () => void }).unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run one sweeper pass. Substrate-API integration: substrate.list('Mission',
   * { filter: { status: 'active' } }) replaces missionStore.listMissions('active').
   *
   * Per-mission iteration preserves the `mission.pulses[pulseKey]` invariant
   * + iteration loop shape from FS-version. evaluatePulse logic stubbed at
   * spike-quality; full port deferred per scope-note.
   */
  async tick(): Promise<PulseSweepResult> {
    const result: PulseSweepResult = { scanned: 0, fired: 0, skipped: 0, escalated: 0, errors: 0 };

    // Substrate-API listMissions("active") equivalent
    const filter: Filter = { status: "active" };
    const { items: activeMissions } = await this.substrate.list<Mission>(MISSION_KIND, { filter });

    for (const mission of activeMissions) {
      if (!mission.pulses) continue;
      for (const pulseKey of PULSE_KEYS) {
        const config = mission.pulses[pulseKey];
        if (!config) continue;
        result.scanned += 1;
        try {
          // SPIKE-quality stub: count as skipped (no fire); full evaluatePulse
          // logic deferred per scope-note above
          const outcome = await this.evaluatePulseStub(mission, pulseKey, config);
          if (outcome === "fired") result.fired += 1;
          else if (outcome === "escalated") result.escalated += 1;
          else result.skipped += 1;
        } catch (err) {
          result.errors += 1;
          this.logger.warn(`evaluatePulse failed for mission ${mission.id} pulse ${pulseKey}`, err);
        }
      }
    }

    // agentPulse second-pass iteration deferred per scope-note (needs engineerRegistry
    // substrate-version which becomes available at W4 repository-composition)

    return result;
  }

  /**
   * Spike-quality evaluatePulse stub. Returns "skipped" for all pulses to
   * exercise the iteration loop without firing.
   *
   * Full implementation deferred per scope-note. See PulseSweeper (FS-version)
   * for the full 3-condition guard + escalation logic.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async evaluatePulseStub(_mission: Mission, _pulseKey: PulseKey, _config: unknown): Promise<"fired" | "skipped" | "escalated"> {
    return "skipped";
  }
}
