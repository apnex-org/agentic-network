/**
 * tool-surface-reconciler.ts — declared-vs-applied reconcile for the Hub
 * MCP tool surface (bug-180 / FR-21; mission-106 hardening).
 *
 * Problem this closes: the host (e.g. Claude Code) enumerates `tools/list`
 * ONCE at startup. On the pre-identity probe path the dispatcher serves the
 * persisted on-disk catalog (tool-catalog-cache). When a Hub redeploy changes
 * the tool surface, the on-disk catalog goes stale and — pre-mission-106 —
 * NOTHING rewrote it: the reconciler only EMITTED `tools/list_changed` and bet
 * on the host re-enumerating. A host that ignores the notification (observed:
 * 33 emits, disk frozen for days) never refreshes, and a RESTART cannot help
 * because the fresh process reads the same frozen disk on its own pre-identity
 * probe. Disk-self-heal is therefore MANDATORY.
 *
 * The mission-106 invariant (level-triggered, NOT edge-triggered — idea-451):
 *   > A running harness's reachable tool surface CONVERGES to the hub's
 *   > advertised surface within bounded latency of any change, and a
 *   > revision-mismatched cache is NEVER served without a repair action.
 *
 * Correctness rests on comparing the LEVEL (the disk-served revision vs the
 * live revision) and REPAIRING the disk, never on catching an EDGE (a
 * `list_changed` broadcast the host may miss). Contract clauses:
 *   1. Repair authority belongs to drift-detection — on drift the reconciler
 *      re-fetches the catalog and atomically REWRITES the on-disk cache.
 *   2. Validation fails CLOSED on an unknown revision (see isCacheValid).
 *   3. `list_changed` is BEST-EFFORT acceleration of the live host surface, NOT
 *      the correctness mechanism (host re-enumeration is unverified — F2).
 *   4. No silent stale serve (the dispatcher logs it; see serve path).
 *
 * F1 (deepest): the LEVEL is the DISK-served revision — `readServedRevision()`
 * read fresh EVERY pass — never an optimistic in-memory `appliedRevision`
 * latch. An in-memory advance after emit could mask a stale disk forever (next
 * tick believes applied==live while the disk is still old). Convergence is
 * marked ONLY after the atomic repair write succeeds; a failed/racing repair
 * keeps the mismatch visible for the next tick.
 *
 * All I/O is injected so the class is unit-testable without a live Hub. The
 * repair deps (fetchLiveCatalog / writeServedCatalog / onRepairOutcome) are
 * OPTIONAL: a host that wires them gets full disk-repair authority; a host that
 * does not falls back to emit-only (the pre-mission-106 degraded behavior,
 * throttled so it does not spam).
 *
 * Two trigger points share one `reconcile()`:
 *   - L1 (primary): the shim's `identityReady` event.
 *   - L2 (backstop): the PollBackstop heartbeat cadence (~30s) — the
 *     level-triggered floor that catches a redeploy while a session stays up.
 *   - L3 (serve-kick): the dispatcher's stale-serve path fire-and-forgets a
 *     `reconcile()` when it serves a labeled-stale cache (D3).
 */

/** MCP tool catalog entry shape — opaque, mirrors tool-catalog-cache.ToolCatalog. */
export type ReconcilerCatalog = unknown[];

/** Failure taxonomy for a repair attempt (F5 — each class logged + metriced). */
export type RepairFailureClass =
  | "fetch-failed"
  | "zero-tool"
  | "revision-moved"
  | "write-failed"
  | "write-threw";

export interface RepairOutcome {
  /** True iff the on-disk cache was atomically rewritten to the live revision. */
  ok: boolean;
  /** Present on failure — which class (F5). */
  klass?: RepairFailureClass;
  /** Optional human detail for logs. */
  detail?: string;
  /** Consecutive repair failures INCLUDING this attempt (0 on success). */
  consecutiveFailures: number;
}

export interface ToolSurfaceReconcilerDeps {
  /**
   * Resolve the Hub's live tool-surface revision (the /health
   * `toolSurfaceRevision` ETag). Returns null when the fetch fails or the Hub
   * doesn't return the field — the reconcile then no-ops (fail-safe: never
   * repair or emit against an unknown live state).
   */
  fetchLiveRevision: () => Promise<string | null>;

  /**
   * The revision the on-disk cache currently serves — read FRESH every pass
   * (this IS the level; F1). null when no cache file exists.
   */
  readServedRevision: () => string | null;

  /** Emit `notifications/tools/list_changed` to the host (BEST-EFFORT; clause 3). */
  emitListChanged: () => void;

  /**
   * mission-106 repair deps (OPTIONAL). Present ⇒ this host has disk-repair
   * authority (clause 1). Absent ⇒ emit-only fallback (degraded; no disk repair).
   */
  /** Re-fetch the live tool catalog for a repair write. */
  fetchLiveCatalog?: () => Promise<ReconcilerCatalog>;
  /** Atomically persist the catalog@revision to disk; returns write success (F5/D1). */
  writeServedCatalog?: (catalog: ReconcilerCatalog, revision: string) => boolean;
  /** Observe every repair attempt (metrics/escalation; F5). */
  onRepairOutcome?: (outcome: RepairOutcome) => void;
  /** Consecutive repair failures before an escalation log fires (F5). Default 3. */
  repairFailureBound?: number;

  /** Diagnostic logger. No-op default. */
  log?: (msg: string) => void;
}

export interface ReconcileOutcome {
  /** True iff `list_changed` was emitted this pass. */
  emitted: boolean;
  /** The live revision resolved this pass (null on fetch failure). */
  live: string | null;
  /** True iff the on-disk cache was repaired (rewritten to live) this pass. */
  repaired: boolean;
  /** True iff the disk already serves (or was repaired to) the live revision. */
  converged: boolean;
}

export class ToolSurfaceReconciler {
  /**
   * The emit baseline/marker: the revision we last emitted `list_changed` for
   * (repair path) OR the seeded baseline (emit-only path). mission-106 (F1): in
   * the REPAIR path this is ONLY emit-dedup and is NEVER the convergence
   * decision — convergence there is `readServedRevision() === live` (a real disk
   * read, every pass). In the emit-only fallback (a host with no on-disk cache /
   * no repair authority — e.g. pi/opencode) it is the pre-mission-106
   * baseline+latch, which is safe there precisely because there is no disk for it
   * to mask.
   */
  private appliedRevision: string | null = null;
  private consecutiveRepairFailures = 0;
  private readonly log: (msg: string) => void;
  private readonly repairFailureBound: number;

  constructor(private readonly deps: ToolSurfaceReconcilerDeps) {
    this.log = deps.log ?? (() => {});
    this.repairFailureBound = deps.repairFailureBound ?? 3;
  }

  /** Test/diagnostic accessor — consecutive repair failures (F5 observability). */
  getConsecutiveRepairFailures(): number {
    return this.consecutiveRepairFailures;
  }

  /**
   * Diagnostic accessor — the revision we last EMITTED `list_changed` for (the
   * emit-throttle marker). mission-106 (F1): this is NOT the convergence level
   * and MUST NOT be read as "the disk is fresh" — convergence is decided solely
   * by `readServedRevision() === live` on each pass. Retained for observability
   * + existing emit-cadence assertions.
   */
  getAppliedRevision(): string | null {
    return this.appliedRevision;
  }

  /**
   * One reconcile pass. Idempotent and safe from any trigger:
   *   1. Resolve live; no-op on unknown (fetch failed — fail-safe).
   *   2. Read the DISK-served revision (the level; F1). If served === live →
   *      converged, no-op.
   *   3. On drift: REPAIR the disk (refetch + coherent + atomic rewrite) when
   *      repair deps are wired; else emit-only fallback. Converge ONLY on a
   *      successful atomic write; a failed repair stays visible (retry next tick)
   *      and escalates after `repairFailureBound` consecutive failures.
   */
  async reconcile(reason = "reconcile"): Promise<ReconcileOutcome> {
    const live = await this.deps.fetchLiveRevision();
    if (live === null) {
      this.log(
        `[tool-surface-reconcile] ${reason}: live revision unknown — skipping (no repair/emit against unknown live)`,
      );
      return { emitted: false, live: null, repaired: false, converged: false };
    }

    const served = this.deps.readServedRevision();
    const repairCapable = Boolean(
      this.deps.fetchLiveCatalog && this.deps.writeServedCatalog,
    );

    // ── REPAIR path (clause 1 / D1 / F3 / F5). F1: the level is the DISK-served
    // revision, read fresh every pass; convergence is a real disk read, never an
    // in-memory latch. ──
    if (repairCapable) {
      if (served === live) {
        this.consecutiveRepairFailures = 0;
        return { emitted: false, live, repaired: false, converged: true };
      }
      this.log(
        `[tool-surface-reconcile] ${reason}: DRIFT served=${served ?? "none"} → live=${live} — repairing disk`,
      );
      const outcome = await this.repair(live);
      this.deps.onRepairOutcome?.(outcome);
      if (outcome.ok) {
        this.consecutiveRepairFailures = 0;
        // Disk now serves `live` (correctness holds). Emit is best-effort
        // acceleration of the LIVE in-memory host surface only (clause 3 / F2).
        const emitted = this.maybeEmit(reason, live);
        return { emitted, live, repaired: true, converged: true };
      }
      // F5: repair failed — LOUD, keep the mismatch visible, retry next tick.
      this.consecutiveRepairFailures = outcome.consecutiveFailures;
      this.log(
        `[tool-surface-reconcile] ${reason}: REPAIR FAILED (${outcome.klass}${outcome.detail ? `: ${outcome.detail}` : ""}) — consecutive=${this.consecutiveRepairFailures}; disk stays stale, retry next tick`,
      );
      if (this.consecutiveRepairFailures >= this.repairFailureBound) {
        this.log(
          `[tool-surface-reconcile] ${reason}: ESCALATION — ${this.consecutiveRepairFailures} consecutive repair failures (>= ${this.repairFailureBound}); tool surface cannot converge (served=${served ?? "none"}, live=${live}) — operator/architect intervention required`,
        );
      }
      return { emitted: false, live, repaired: false, converged: false };
    }

    // ── EMIT-ONLY fallback (no repair authority / no on-disk cache — the
    // pre-mission-106 behavior, retained for hosts like pi/opencode). Seed the
    // baseline on the first pass WITHOUT emitting (the host already enumerated
    // live at bootstrap — a fresh install has nothing stale to signal); emit +
    // advance only on a genuine change. F1-safe: with no disk to repair, this
    // latch masks nothing. ──
    if (this.appliedRevision === null) {
      this.appliedRevision = served ?? live;
      this.log(
        `[tool-surface-reconcile] ${reason}: baseline applied=${this.appliedRevision} (served=${served ?? "none"}, live=${live})`,
      );
    }
    if (live !== this.appliedRevision) {
      this.log(
        `[tool-surface-reconcile] ${reason}: drift applied=${this.appliedRevision} → live=${live} — emitting tools/list_changed`,
      );
      this.safeEmit(reason);
      this.appliedRevision = live;
      return { emitted: true, live, repaired: false, converged: false };
    }
    return { emitted: false, live, repaired: false, converged: false };
  }

  /**
   * Refetch + coherent + atomic rewrite (D1 tmp+rename via writeServedCatalog).
   * F3: bind catalog + revision COHERENTLY — re-confirm the live revision AFTER
   * fetching the catalog; if it moved mid-fetch, skip (retry next tick with the
   * new live) rather than persist catalog@oldRevision. Never persist a zero-tool
   * catalog (would poison the disk).
   */
  private async repair(live: string): Promise<RepairOutcome> {
    const nextFail = (
      klass: RepairFailureClass,
      detail?: string,
    ): RepairOutcome => ({
      ok: false,
      klass,
      detail,
      consecutiveFailures: this.consecutiveRepairFailures + 1,
    });

    let catalog: ReconcilerCatalog;
    try {
      catalog = await this.deps.fetchLiveCatalog!();
    } catch (err) {
      return nextFail("fetch-failed", (err as Error)?.message ?? String(err));
    }
    if (!Array.isArray(catalog) || catalog.length === 0) {
      return nextFail("zero-tool");
    }
    // F3 coherence gate: confirm the revision the catalog belongs to is still live.
    const revAfter = await this.deps.fetchLiveRevision();
    if (revAfter !== live) {
      return nextFail(
        "revision-moved",
        `live moved ${live} → ${revAfter ?? "unknown"} mid-fetch`,
      );
    }
    let wrote: boolean;
    try {
      wrote = this.deps.writeServedCatalog!(catalog, live);
    } catch (err) {
      return nextFail("write-threw", (err as Error)?.message ?? String(err));
    }
    if (!wrote) return nextFail("write-failed");
    return { ok: true, consecutiveFailures: 0 };
  }

  /**
   * Operator escape-hatch (S2b / idea-456) — UNCONDITIONALLY emit
   * `notifications/tools/list_changed`, bypassing the drift check, to hand an
   * already-stale live host a fresh re-enumeration trigger on demand. With
   * mission-106 disk-repair this is rarely needed (a reconcile pass repairs the
   * disk), but retained as the manual host-kick + a deterministic test trigger.
   */
  async forceEmit(reason = "force-emit"): Promise<ReconcileOutcome> {
    const live = await this.deps.fetchLiveRevision();
    this.log(
      `[tool-surface-reconcile] ${reason}: FORCE emit tools/list_changed (unconditional; live=${live ?? "unknown"})`,
    );
    this.safeEmit(reason);
    if (live !== null) this.appliedRevision = live;
    return { emitted: true, live, repaired: false, converged: false };
  }

  /** Emit once per live revision (repair-path emit-dedup ONLY — never a
   *  convergence marker; convergence is the disk read). */
  private maybeEmit(reason: string, live: string): boolean {
    if (this.appliedRevision === live) return false;
    this.safeEmit(reason);
    this.appliedRevision = live;
    return true;
  }

  /** Emit to the host, never letting a host-emit failure escape the loop. */
  private safeEmit(reason: string): void {
    try {
      this.deps.emitListChanged();
    } catch (err) {
      this.log(
        `[tool-surface-reconcile] ${reason}: emitListChanged threw (non-fatal): ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }
}
