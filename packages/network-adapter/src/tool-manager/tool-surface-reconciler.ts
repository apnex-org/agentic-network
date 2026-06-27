/**
 * tool-surface-reconciler.ts — declared-vs-applied reconcile for the Hub
 * MCP tool surface (bug-180 / FR-21).
 *
 * Problem this closes: the host (e.g. Claude Code) enumerates `tools/list`
 * ONCE at startup. On the pre-identity probe path the dispatcher serves the
 * persisted on-disk catalog (tool-catalog-cache). When a Hub redeploy changes
 * the tool surface, the in-memory catalog the host holds goes stale and
 * nothing re-enumerates it — neither a client hard-reset nor /reload-plugins,
 * because the long-lived proxy process never re-fetches and the redeploy emits
 * no in-life `notifications/tools/list_changed` to already-connected hosts.
 *
 * The fix treats tool-surface delivery as a reconcile, mirroring the storage
 * substrate's SchemaDef-reconciler:
 *   - desired-state  = the Hub's tool surface, versioned by `toolSurfaceRevision`
 *                      (a deterministic hash of the registered tool set, served
 *                      on /health; Hub-side since bug-114).
 *   - applied-state  = the revision the host most recently enumerated.
 *   - watch/notify   = MCP `notifications/tools/list_changed` (the Hub already
 *                      advertises `tools.listChanged: true`).
 *
 * On drift between applied and desired, emit `list_changed`; the host re-calls
 * `tools/list` and — identity now resolved — the dispatcher serves the live
 * surface (it skips the probe-cache path once identityReady is true).
 *
 * This class owns ONLY the reconcile decision + the applied-revision marker.
 * All I/O is injected so it is unit-testable without a live Hub:
 *   - fetchLiveRevision: resolve the Hub's current /health `toolSurfaceRevision`
 *     (null on fetch failure / a Hub that doesn't return the field).
 *   - readServedRevision: the revision the host's startup enumeration was
 *     served from — the on-disk cache's `toolSurfaceRevision` (null when no
 *     cache exists, i.e. a fresh install that bootstrapped live).
 *   - emitListChanged: emit `notifications/tools/list_changed` to the host.
 *
 * Two trigger points share one `reconcile()`:
 *   - L1 (primary): on the shim's `identityReady` event — catches the
 *     redeploy-then-reconnect case that caused bug-180.
 *   - L2 (backstop): on the existing PollBackstop heartbeat cadence — catches
 *     a redeploy WHILE a session stays connected (no reconnect, so no fresh
 *     identityReady).
 *
 * The applied-revision baseline is established on the first successful
 * reconcile (whichever trigger fires first), seeded from the on-disk cache so
 * a stale-cache-vs-live delta is detected even if L2 races ahead of L1.
 */

export interface ToolSurfaceReconcilerDeps {
  /**
   * Resolve the Hub's live tool-surface revision (the /health
   * `toolSurfaceRevision` ETag). Returns null when the fetch fails or the Hub
   * doesn't return the field — the reconcile then no-ops (fail-safe: never
   * emit a spurious `list_changed` on an unknown live state).
   */
  fetchLiveRevision: () => Promise<string | null>;

  /**
   * The revision the host's current tool view was enumerated from — the
   * on-disk cache's `toolSurfaceRevision`. Used to seed the applied-state
   * baseline on the first reconcile (the pre-identity probe served this).
   * null when no cache exists (fresh install bootstrapped live → no drift).
   */
  readServedRevision: () => string | null;

  /** Emit `notifications/tools/list_changed` to the host. */
  emitListChanged: () => void;

  /** Diagnostic logger. No-op default. */
  log?: (msg: string) => void;
}

export interface ReconcileOutcome {
  /** True iff a drift was detected and `list_changed` was emitted this pass. */
  emitted: boolean;
  /** The live revision resolved this pass (null on fetch failure). */
  live: string | null;
}

export class ToolSurfaceReconciler {
  /**
   * The revision the host is believed to currently have applied. null until
   * the first successful reconcile establishes the baseline.
   */
  private appliedRevision: string | null = null;
  private readonly log: (msg: string) => void;

  constructor(private readonly deps: ToolSurfaceReconcilerDeps) {
    this.log = deps.log ?? (() => {});
  }

  /** Test/diagnostic accessor for the current applied-state marker. */
  getAppliedRevision(): string | null {
    return this.appliedRevision;
  }

  /**
   * One reconcile pass. Idempotent and safe to call from either trigger:
   *   1. Resolve the live revision; no-op on unknown (fetch failed).
   *   2. On first pass, seed the applied baseline from the on-disk cache
   *      (what the host's startup probe served) — or from live if no cache.
   *   3. On applied-vs-live drift, emit `list_changed` + advance the baseline.
   *
   * @param reason short label for logs (e.g. "identityReady", "heartbeat").
   */
  async reconcile(reason = "reconcile"): Promise<ReconcileOutcome> {
    const live = await this.deps.fetchLiveRevision();
    if (live === null) {
      this.log(
        `[tool-surface-reconcile] ${reason}: live revision unknown — skipping (cache trusted)`,
      );
      return { emitted: false, live: null };
    }

    // Establish the applied-state baseline on the first successful pass. Prefer
    // the on-disk cache revision (the surface the pre-identity probe served);
    // fall back to live when no cache exists (fresh install already enumerated
    // live, so there is nothing to reconcile against).
    if (this.appliedRevision === null) {
      const served = this.deps.readServedRevision();
      this.appliedRevision = served ?? live;
      this.log(
        `[tool-surface-reconcile] ${reason}: baseline applied=${this.appliedRevision} (served=${served ?? "none"}, live=${live})`,
      );
    }

    if (live !== this.appliedRevision) {
      this.log(
        `[tool-surface-reconcile] ${reason}: drift applied=${this.appliedRevision} → live=${live} — emitting tools/list_changed`,
      );
      try {
        this.deps.emitListChanged();
      } catch (err) {
        // Never let a host-emit failure escape the reconcile loop.
        this.log(
          `[tool-surface-reconcile] ${reason}: emitListChanged threw (non-fatal): ${(err as Error)?.message ?? String(err)}`,
        );
      }
      this.appliedRevision = live;
      return { emitted: true, live };
    }

    return { emitted: false, live };
  }
}
