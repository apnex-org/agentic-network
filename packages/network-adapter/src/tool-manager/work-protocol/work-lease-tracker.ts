/**
 * work-lease-tracker.ts — idea-353 W2 outbound stall-prompt state.
 *
 * The lease-escalation ladder (lease-TTL → sweeper → poison → thrash-quarantine,
 * C1-R2) has no GENTLE first rung: a held item that stalls goes straight from
 * "leased" to silently reaped. W2 adds that rung — prompt the holder to
 * renew / block / abandon BEFORE the sweeper's hard reap. It's notification-
 * shaping over the EXISTING verbs (renew_lease / block_work / abandon_work), not
 * a new verb.
 *
 * The adapter holds no work-lease state of its own (all WorkItem/lease state is
 * Hub-side, and there is no "my held work" query). Rather than add a Hub tool or
 * a second per-tick round-trip, this tracker **observes the agent's own
 * work-verb tool-call results** as they pass through the dispatcher and
 * maintains a local map of held leases + their expiry. On the heartbeat tick the
 * host asks which held leases are approaching expiry.
 *
 * Window model: each observe of a claim/renew/start result (re)opens a lease
 * window `[windowStart=observe-time, expiresAt]` and clears the per-window
 * prompt latch. A lease is "due" once the tick time crosses `thresholdFraction`
 * of that window AND is still before `expiresAt` (the whole point is *before*
 * the reap), and it has not already been prompted this window. A renew resets
 * the window + latch, so a renewing holder is never re-pestered. Completing /
 * abandoning / releasing / blocking the item drops it entirely.
 *
 * Scope (thin MVP): tracks leases this session observes. A lease claimed in a
 * prior adapter process (pre-restart) is not tracked — named as deferred; the
 * common stall (claim → heads-down → near-expiry without renew) is in-session.
 *
 * Pure: all parsing is synchronous off the already-unwrapped tool result; the
 * host owns the tick clock + the emit. Unit-testable without a live Hub (AC2).
 */

/** The work-verbs whose results open/refresh a tracked lease window. */
const LEASE_OPEN_VERBS = new Set(["claim_work", "renew_lease", "start_work"]);
/** The work-verbs whose results retire a held lease (no longer the holder's stall). */
const LEASE_CLOSE_VERBS = new Set([
  "complete_work",
  "abandon_work",
  "release_work",
  "block_work",
]);

/** A renew (or claim) reopens the window + clears the prompt latch; start_work
 *  only refreshes the known expiry without resetting the window. */
const WINDOW_RESET_VERBS = new Set(["claim_work", "renew_lease"]);

interface TrackedLease {
  workId: string;
  /** Epoch ms the current lease window opened (claim/renew observe-time). */
  windowStartMs: number;
  /** Epoch ms the lease expires (Hub-authored `lease.expiresAt`). */
  expiresAtMs: number;
  /** Per-window latch — prompt at most once until a renew reopens the window. */
  prompted: boolean;
  /** work-164 (idea-395): the Hub-authored lease token — required to auto-renew
   *  on the holder's behalf. Empty string if a result carried no token. */
  token: string;
}

export interface StallPrompt {
  workId: string;
  /** Ms remaining until the Hub sweeper may reap the lease. */
  msUntilExpiry: number;
}

/** work-164 (idea-395): a held lease due for an auto-heartbeat renew — carries the
 *  token the host needs to call `renew_lease` on the holder's behalf. */
export interface RenewDue {
  workId: string;
  token: string;
  /** Ms remaining until expiry (for the host's log). */
  msUntilExpiry: number;
}

/** Pull `{ workId, expiresAtMs, token }` out of an already-unwrapped work-verb
 *  result. Tolerant: returns null on any shape that isn't a lease-bearing workItem. */
function parseLease(
  result: unknown,
): { workId: string; expiresAtMs: number; token: string } | null {
  const wi = (result as { workItem?: unknown } | null)?.workItem as
    | { id?: unknown; lease?: { expiresAt?: unknown; token?: unknown } | null }
    | undefined;
  if (!wi || typeof wi.id !== "string") return null;
  const expiresAt = wi.lease?.expiresAt;
  if (typeof expiresAt !== "string") return null;
  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) return null;
  const token = typeof wi.lease?.token === "string" ? wi.lease.token : "";
  return { workId: wi.id, expiresAtMs, token };
}

/** Pull a workId for a CLOSE verb — prefer the result workItem, fall back to args. */
function parseWorkId(
  result: unknown,
  args: Record<string, unknown> | undefined,
): string | null {
  const id = (result as { workItem?: { id?: unknown } } | null)?.workItem?.id;
  if (typeof id === "string") return id;
  if (args && typeof args.workId === "string") return args.workId;
  return null;
}

export class WorkLeaseTracker {
  private leases = new Map<string, TrackedLease>();

  /**
   * Observe one of THIS agent's work-verb tool-call results as it passes
   * through the dispatcher. Best-effort: an unrecognized verb or an
   * unparseable result is a no-op.
   */
  observe(
    method: string,
    args: Record<string, unknown> | undefined,
    result: unknown,
    nowMs: number,
  ): void {
    // work-165 (idea-358): drop any lease whose expiry has already passed before
    // (re)observing. The Hub sweeper reaps an expired lease server-side, but if the
    // holder never issues a close verb (the exact silent-reap case this arc fixes)
    // the local entry would linger forever — so every observation self-cleans.
    this.prune(nowMs);
    if (LEASE_CLOSE_VERBS.has(method)) {
      const workId = parseWorkId(result, args);
      if (workId) this.leases.delete(workId);
      return;
    }
    if (!LEASE_OPEN_VERBS.has(method)) return;
    const parsed = parseLease(result);
    if (!parsed) return;
    const existing = this.leases.get(parsed.workId);
    const resetWindow = WINDOW_RESET_VERBS.has(method) || !existing;
    this.leases.set(parsed.workId, {
      workId: parsed.workId,
      // claim/renew reopen the window at observe-time; start_work keeps the
      // existing window start (it does not extend the lease).
      windowStartMs: resetWindow ? nowMs : existing!.windowStartMs,
      expiresAtMs: parsed.expiresAtMs,
      prompted: resetWindow ? false : existing!.prompted,
      // work-164: keep the freshest token; fall back to the prior one if a result
      // (e.g. some start_work shapes) carried none.
      token: parsed.token || existing?.token || "",
    });
  }

  /**
   * work-164 (idea-395): held leases past `thresholdFraction` of their window and
   * not yet expired, WITH a known token — candidates for an auto-heartbeat renew.
   * No prompt-latch: a successful renew resets the window via observe (so it won't
   * re-fire until the next threshold crossing), and a failed renew leaves it due so
   * the next tick retries. Only the host's ACTIVE-WORK gate decides whether to
   * actually renew — a stalled/crashed holder is left to the stall-prompt + sweeper.
   *
   * @param thresholdFraction renew once past this fraction of the window
   *   (default 0.5 — renew around the halfway mark while genuinely working).
   */
  dueForRenew(nowMs: number, thresholdFraction = 0.5): RenewDue[] {
    const due: RenewDue[] = [];
    for (const lease of this.leases.values()) {
      if (!lease.token) continue; // can't renew without a token
      const windowLen = lease.expiresAtMs - lease.windowStartMs;
      if (windowLen <= 0) continue;
      const elapsed = nowMs - lease.windowStartMs;
      if (elapsed >= thresholdFraction * windowLen && nowMs < lease.expiresAtMs) {
        due.push({ workId: lease.workId, token: lease.token, msUntilExpiry: lease.expiresAtMs - nowMs });
      }
    }
    return due;
  }

  /**
   * Held leases that have crossed `thresholdFraction` of their current window
   * but not yet expired, and have not been prompted this window. The host
   * emits a renew/block/abandon stall-prompt for each (then marks them).
   *
   * @param thresholdFraction window fraction at which to prompt (~0.5–0.75;
   *   default 0.6 = 60% of the lease life elapsed).
   */
  dueForStallPrompt(nowMs: number, thresholdFraction = 0.6): StallPrompt[] {
    const due: StallPrompt[] = [];
    for (const lease of this.leases.values()) {
      if (lease.prompted) continue;
      const windowLen = lease.expiresAtMs - lease.windowStartMs;
      if (windowLen <= 0) continue;
      const elapsed = nowMs - lease.windowStartMs;
      // Prompt window: [thresholdFraction*windowLen, windowLen) — past the
      // threshold but BEFORE expiry (the gentle rung is "before the reap").
      if (elapsed >= thresholdFraction * windowLen && nowMs < lease.expiresAtMs) {
        due.push({ workId: lease.workId, msUntilExpiry: lease.expiresAtMs - nowMs });
      }
    }
    return due;
  }

  /** Latch a lease as prompted for its current window (call after emitting). */
  markPrompted(workId: string): void {
    const lease = this.leases.get(workId);
    if (lease) lease.prompted = true;
  }

  /**
   * work-165 (idea-358): drop every lease whose expiry has passed as of `nowMs`.
   * Without this the Map only shrinks on an explicit close verb, so a lease reaped
   * server-side (holder went silent) lingers forever — `size()`/`snapshot()` then
   * mis-report a stale "holding", and long-lived processes leak the Map unbounded.
   * Called on every `observe` and on the host heartbeat tick. Returns the count
   * pruned (host may log it). Deleting the current key mid-Map-iteration is safe.
   */
  prune(nowMs: number): number {
    let pruned = 0;
    for (const [workId, lease] of this.leases) {
      if (nowMs >= lease.expiresAtMs) {
        this.leases.delete(workId);
        pruned += 1;
      }
    }
    return pruned;
  }

  /** Diagnostic/test accessor: number of currently-held tracked leases. */
  size(): number {
    return this.leases.size;
  }

  /**
   * Read-only snapshot of currently-held leases (mission-99 footer work cell).
   * Returns a fresh array of plain `{ workId, expiresAtMs }` — the footer reads
   * this locally (NO Hub poll; the agent's own lease is held client-side post-
   * claim, spec §4). Ordered most-recently-opened first so a single-cell footer
   * shows the freshest lease. Pure read — never mutates tracker state.
   */
  snapshot(): ReadonlyArray<{ workId: string; expiresAtMs: number }> {
    return [...this.leases.values()]
      .sort((a, b) => b.windowStartMs - a.windowStartMs)
      .map((l) => ({ workId: l.workId, expiresAtMs: l.expiresAtMs }));
  }
}
