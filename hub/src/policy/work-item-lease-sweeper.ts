/**
 * work-item-lease-sweeper.ts — C1-R2 (mission-94) sub-PR-4a.
 *
 * The lease-expiry sweeper for the WorkItem work-queue. Periodically scans for
 * lease-held items whose lease has lapsed (a crashed/wedged holder that stopped
 * heartbeating) and CAS-re-queues them to `ready` (leaseExpiryCount++), OR
 * POISON-ABANDONS an item that has lapsed `poisonCap` times (a structurally-poison
 * item that repeatedly gets claimed then abandoned — LOUD + queryable, tele-4).
 *
 * The renew-vs-sweeper race is a CAS one-winner (handled in repo.expireLease: the
 * fresh-row re-check skips an item a concurrent renew bumped). A bare-envelope row
 * (cal-84, R4b) is escalated LOUD + queryable + quarantined out of the cycle — never
 * a silent swallow. Per-item failures are isolated (one bad item never aborts the sweep).
 *
 * Cadence is the caller's (index.ts) — keep it WELL under LEASE_TTL_MS so a dead
 * holder's work re-queues within ~TTL + one sweep interval.
 */
import type { IPolicyContext } from "./types.js";
import type { IAuditStore } from "../state.js";
import type { WorkItemRepositorySubstrate } from "../entities/work-item-repository-substrate.js";
import { escalateBareEnvelope } from "./bare-envelope-escalation.js";
// work-54 (idea-357 pt-2): lease-expiry transitions are FSM transitions too —
// emit them push-native (requeue = "claimable again"; poison-abandon = terminal).
import { emitWorkTransition } from "./work-item-events.js";

/** Default per-ITEM poison cap (architect-confirmed N=3; configurable). After this many
 *  lease-expiry re-queue cycles the item is terminally abandoned. */
export const DEFAULT_POISON_CAP = 3;
/** Default per-AGENT thrash cap (architect-confirmed N=3; configurable). After this many
 *  consecutive claim→lease-expire-WITHOUT-evidence cycles the agent is quarantined. */
export const DEFAULT_THRASH_CAP = 3;
const DEFAULT_SCAN_LIMIT = 500;

/** The narrow Agent-store dependency the sweeper needs (AgentRepositorySubstrate
 *  satisfies it structurally). Keeps the sweeper off the full IEngineerRegistry. */
export interface AgentThrashStore {
  recordWorkItemThrash(agentId: string, quarantineCap: number): Promise<{ thrashCount: number; quarantined: boolean } | null>;
}

export interface WorkItemLeaseSweeperOptions {
  metrics?: IPolicyContext["metrics"];
  /** Durable queryable sink for poison-abandon + agent-quarantine + bare-envelope audits. */
  audit?: IAuditStore;
  /** Per-ITEM poison cap (default DEFAULT_POISON_CAP). */
  poisonCap?: number;
  /** Per-AGENT thrash cap (default DEFAULT_THRASH_CAP). */
  thrashCap?: number;
  /** Agent store for the per-AGENT thrash-quarantine (4b-ii). When absent, the sweeper
   *  still re-queues/poisons items but does NOT track agent thrash (e.g. test rigs). */
  agentStore?: AgentThrashStore;
  scanLimit?: number;
  logger?: {
    log: (msg: string) => void;
    warn: (msg: string, err?: unknown) => void;
    error?: (msg: string, err?: unknown) => void;
  };
}

export interface WorkItemLeaseSweepResult {
  scanned: number;
  requeued: number;
  abandoned: number;
  /** Items a concurrent renew/release/complete made not-expired between list + CAS. */
  skipped: number;
  errors: number;
  /** Items terminal-quarantined on a structural bare-envelope defect (cal-84). */
  quarantined: number;
  /** Agents newly quarantined this sweep on claim-thrash (4b-ii). */
  agentsQuarantined: number;
}

/** Provides a per-sweep IPolicyContext (for the metrics sink the escalation reads). */
export interface WorkItemLeaseSweeperContextProvider {
  forSweeper(): IPolicyContext;
}

export class WorkItemLeaseSweeper {
  private readonly metrics: IPolicyContext["metrics"] | undefined;
  private readonly audit: IAuditStore | undefined;
  private readonly poisonCap: number;
  private readonly thrashCap: number;
  private readonly agentStore: AgentThrashStore | undefined;
  private readonly scanLimit: number;
  private readonly logger: {
    log: (m: string) => void;
    warn: (m: string, err?: unknown) => void;
    error: (m: string, err?: unknown) => void;
  };

  constructor(
    private readonly store: WorkItemRepositorySubstrate,
    private readonly contextProvider: WorkItemLeaseSweeperContextProvider,
    options: WorkItemLeaseSweeperOptions = {},
  ) {
    this.metrics = options.metrics;
    this.audit = options.audit;
    this.poisonCap = options.poisonCap ?? DEFAULT_POISON_CAP;
    this.thrashCap = options.thrashCap ?? DEFAULT_THRASH_CAP;
    this.agentStore = options.agentStore;
    this.scanLimit = options.scanLimit ?? DEFAULT_SCAN_LIMIT;
    this.logger = {
      log: options.logger?.log ?? ((m) => console.log(`[WorkItemLeaseSweeper] ${m}`)),
      warn: options.logger?.warn ?? ((m, err) => console.warn(`[WorkItemLeaseSweeper] ${m}`, err ?? "")),
      error: options.logger?.error ?? ((m, err) => console.error(`[WorkItemLeaseSweeper] ${m}`, err ?? "")),
    };
  }

  private escalationDeps(ctx: IPolicyContext) {
    return { audit: this.audit, metrics: ctx.metrics, logger: this.logger };
  }

  private handle: ReturnType<typeof setInterval> | undefined;

  /** Start the periodic tick. `intervalMs` MUST be well under LEASE_TTL_MS so a dead
   *  holder's work re-queues within ~TTL + one interval. Idempotent. */
  start(intervalMs: number): void {
    if (this.handle) return;
    // audit-4103 (LOW): in-flight mutex — a sweep slower than the tick must NOT overlap
    // itself (the scheduled-message-sweeper idiom). `if(this.handle)return` is double-START
    // only; this skips a tick while the prior sweep is still running.
    let inFlight = false;
    this.handle = setInterval(() => {
      if (inFlight) { this.logger.warn("skipping tick — previous lease sweep still in flight"); return; }
      inFlight = true;
      this.fullSweep(new Date().toISOString())
        .catch((err) => this.logger.error("periodic lease sweep failed:", err))
        .finally(() => { inFlight = false; });
    }, intervalMs);
    if (typeof this.handle.unref === "function") this.handle.unref(); // don't keep the process alive
    this.logger.log(`started (interval=${intervalMs}ms, poisonCap=${this.poisonCap})`);
  }

  stop(): void {
    if (this.handle) { clearInterval(this.handle); this.handle = undefined; }
  }

  /**
   * Run one sweep pass. `nowISO` is injected (testable clock; production passes
   * new Date().toISOString()). Per-item errors isolated; a bare-envelope defect is
   * escalated + quarantined out of the cycle.
   */
  async fullSweep(nowISO: string): Promise<WorkItemLeaseSweepResult> {
    const result: WorkItemLeaseSweepResult = { scanned: 0, requeued: 0, abandoned: 0, skipped: 0, errors: 0, quarantined: 0, agentsQuarantined: 0 };
    const ctx = this.contextProvider.forSweeper();

    let expired;
    try {
      expired = await this.store.listExpiredLeaseItems(nowISO, this.scanLimit);
    } catch (listErr) {
      // a structural bare-envelope mid list-decode → escalate LOUD + skip this cycle.
      if (await escalateBareEnvelope(listErr, { sweeper: "workitem-lease (expired list)", entityRef: "(workitem list)" }, this.escalationDeps(ctx))) {
        result.quarantined += 1;
        return result;
      }
      throw listErr;
    }
    result.scanned = expired.length;
    if (result.scanned === 0) return result;

    for (const w of expired) {
      try {
        const outcome = await this.store.expireLease(w.id, nowISO, this.poisonCap);
        if (outcome === "requeued") {
          result.requeued += 1;
          this.metrics?.increment("workitem_lease.requeued", { workId: w.id });
          // push-native "claimable again" wake. `w` is the pre-expiry row the scan
          // listed (its status + lapsed holder are exactly the event's from-side);
          // the explicit toStatus avoids a re-read race. Never-throws.
          await emitWorkTransition(ctx, { item: w, verb: "lease_expired", fromStatus: w.status, toStatus: "ready" });
        } else if (outcome === "abandoned") {
          result.abandoned += 1;
          this.metrics?.increment("workitem_lease.poison_abandoned", { workId: w.id });
          this.logger.warn(`WorkItem ${w.id} POISON-ABANDONED after ${this.poisonCap} lease-expiry cycles (tele-4)`);
          // LOUD + queryable: a durable audit entry for the terminal abandon.
          try {
            await this.audit?.logEntry("hub", "workitem_poison_abandoned",
              `WorkItem ${w.id} terminal-abandoned by the lease-sweeper after ${this.poisonCap} lease-expiry re-queue cycles (poison signal)`, w.id);
          } catch (auditErr) {
            this.logger.warn(`poison-abandon audit write failed for ${w.id}:`, auditErr);
          }
          await emitWorkTransition(ctx, { item: w, verb: "lease_expired", fromStatus: w.status, toStatus: "abandoned" });
        } else {
          result.skipped += 1; // renewed/released/completed between list + CAS (race-safe)
        }
        // 4b-ii per-AGENT thrash-quarantine: a claim that lapsed WITHOUT evidence is a
        // thrash signal for the holder. The listed `w` carries the holder + evidence at
        // expiry (expireLease only acts on that same expired lease, so it's race-safe).
        // Evidence attached (a parked review item) = progress → NOT a thrash.
        if ((outcome === "requeued" || outcome === "abandoned") && this.agentStore && w.lease?.holder && w.evidence.length === 0) {
          const holder = w.lease.holder;
          const thrash = await this.agentStore.recordWorkItemThrash(holder, this.thrashCap);
          if (thrash && thrash.thrashCount === this.thrashCap && thrash.quarantined) {
            // newly quarantined this cycle — LOUD + queryable (the C2 supervisor signal).
            result.agentsQuarantined += 1;
            this.metrics?.increment("workitem_thrash.agent_quarantined", { agentId: holder });
            this.logger.warn(`agent ${holder} QUARANTINED after ${this.thrashCap} consecutive claim-thrash cycles (tele-4; C2 supervisor signal)`);
            try {
              await this.audit?.logEntry("hub", "agent_workitem_quarantined",
                `Agent ${holder} quarantined by the lease-sweeper after ${this.thrashCap} consecutive claim→lease-expire-without-evidence cycles`, holder);
            } catch (auditErr) {
              this.logger.warn(`agent-quarantine audit write failed for ${holder}:`, auditErr);
            }
          }
        }
      } catch (err) {
        // a STRUCTURAL bare-envelope on a single item → escalate + quarantine, continue.
        if (await escalateBareEnvelope(err, { sweeper: "workitem-lease", entityRef: w.id }, this.escalationDeps(ctx))) {
          result.quarantined += 1;
          continue;
        }
        result.errors += 1;
        this.metrics?.increment("workitem_lease.sweep_error", { workId: w.id, error: (err as Error)?.message ?? String(err) });
        this.logger.warn(`lease-expiry sweep failed for ${w.id}:`, err);
      }
    }

    this.logger.log(`lease sweep: scanned=${result.scanned} requeued=${result.requeued} abandoned=${result.abandoned} skipped=${result.skipped} errors=${result.errors} quarantined=${result.quarantined} agentsQuarantined=${result.agentsQuarantined}`);
    return result;
  }
}
