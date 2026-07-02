/**
 * LivenessWatchdog — the L1.5 application-level session-validity watchdog
 * (M-Adapter-Modernization Design §4, P1c).
 *
 * THE GAP IT CLOSES (the lived "wedge"): transport-level liveness (SSE
 * watchdog + heartbeat POST in `wire/mcp-transport.ts`) can stay GREEN while
 * the Hub SESSION is dead server-side — the `keepalives-flowing-but-session-dead`
 * edge. L1 reconnect only fires on a DETECTED transport drop; a server-side
 * session death surfaces only as `session_invalid` on the next `call()`, which
 * never happens while the agent is idle / mid-long-cognitive-node. So the dead
 * session sits undetected: L1 believes connected, L2 (process-supervisor) sees a
 * live process, and the OAuth-token-holding zombie wedges silently.
 *
 * L1.5 = a PROACTIVE, periodic session-validity probe INDEPENDENT of the
 * transport keepalive (a real session-requiring Hub round-trip, injected by the
 * caller). On a BOUNDED budget of consecutive probe failures — long enough to
 * give L1's forever-backoff a chance to self-heal a recoverable drop — the
 * watchdog declares the session UNRECOVERABLY wedged and fires `onLivenessLost`
 * exactly once. The caller wires that to the EMBEDDED exit-propagation seam
 * (in-process self-exit -> container/PID-1 exit so docker-L2 restarts -> fresh
 * process re-handshakes + re-claims). The watchdog itself is seam-agnostic: it
 * only decides "this session is wedged" and signals once.
 *
 * Design points:
 *   - INDEPENDENT of transport keepalive: the probe must exercise the server-side
 *     session (fail when the session is dead even though SSE flows). The caller
 *     supplies it; a transport-keepalive check would NOT close the edge.
 *   - BOUNDED budget, reset-on-success: a single failed probe during a normal
 *     reconnect must NOT self-exit (would fight L1). Only SUSTAINED failure
 *     (>= failureBudget consecutive) escalates — i.e. L1 could not recover.
 *   - FIRE-ONCE + stop: once liveness is declared lost the process is on its way
 *     out; never double-fire, never keep probing.
 *   - Non-overlapping ticks: a slow probe must not stack; the next tick waits.
 */

export interface LivenessWatchdogOptions {
  /**
   * Session-validity probe. Resolves `true` when a live server-side session is
   * CONFIRMED; resolves `false` or REJECTS when it cannot be confirmed (treated
   * identically as one failure). MUST be a real session-requiring round-trip,
   * not a transport-keepalive check.
   */
  probe: () => Promise<boolean>;
  /** Probe cadence in ms. Independent of (and typically slower than) the 30s transport heartbeat. */
  probeIntervalMs: number;
  /**
   * Consecutive-failure budget before declaring liveness lost. Sized so
   * `failureBudget * probeIntervalMs` exceeds L1's realistic self-heal window,
   * so a recoverable drop reconnects (probe succeeds -> counter resets) before
   * the watchdog escalates.
   */
  failureBudget: number;
  /** Fired exactly once when the budget is exhausted. Wire to the self-exit seam. */
  onLivenessLost: (info: { consecutiveFailures: number; lastError?: unknown }) => void;
  log?: (msg: string) => void;
  /** Injectable timer (tests). Defaults to setInterval/clearInterval. */
  setIntervalFn?: (cb: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void;
}

export class LivenessWatchdog {
  private readonly opts: Required<Pick<LivenessWatchdogOptions, "probe" | "probeIntervalMs" | "failureBudget" | "onLivenessLost">> &
    Pick<LivenessWatchdogOptions, "log"> & {
      setIntervalFn: (cb: () => void, ms: number) => ReturnType<typeof setInterval>;
      clearIntervalFn: (handle: ReturnType<typeof setInterval>) => void;
    };
  private timer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private ticking = false;
  private fired = false;

  constructor(options: LivenessWatchdogOptions) {
    if (options.probeIntervalMs <= 0) throw new Error("LivenessWatchdog: probeIntervalMs must be > 0");
    if (options.failureBudget < 1) throw new Error("LivenessWatchdog: failureBudget must be >= 1");
    this.opts = {
      probe: options.probe,
      probeIntervalMs: options.probeIntervalMs,
      failureBudget: options.failureBudget,
      onLivenessLost: options.onLivenessLost,
      log: options.log,
      setIntervalFn: options.setIntervalFn ?? ((cb, ms) => setInterval(cb, ms)),
      clearIntervalFn: options.clearIntervalFn ?? ((h) => clearInterval(h)),
    };
  }

  /** Begin periodic probing. Idempotent: a second start() is a no-op. */
  start(): void {
    if (this.timer !== null || this.fired) return;
    this.opts.log?.(
      `[LivenessWatchdog] started — probe every ${this.opts.probeIntervalMs}ms, budget ${this.opts.failureBudget} consecutive failures`,
    );
    this.timer = this.opts.setIntervalFn(() => {
      void this.tick();
    }, this.opts.probeIntervalMs);
  }

  /** Stop probing + release the timer. Idempotent. */
  stop(): void {
    if (this.timer !== null) {
      this.opts.clearIntervalFn(this.timer);
      this.timer = null;
    }
  }

  /** Exposed for deterministic tests: run exactly one probe cycle. */
  async tick(): Promise<void> {
    if (this.fired || this.ticking) return; // never overlap; never probe after firing
    this.ticking = true;
    try {
      let live = false;
      let lastError: unknown;
      try {
        live = await this.opts.probe();
      } catch (err) {
        live = false;
        lastError = err;
      }
      if (live) {
        if (this.consecutiveFailures > 0) {
          this.opts.log?.(`[LivenessWatchdog] session re-confirmed live; failure counter reset (was ${this.consecutiveFailures})`);
        }
        this.consecutiveFailures = 0;
        return;
      }
      this.consecutiveFailures += 1;
      this.opts.log?.(
        `[LivenessWatchdog] session probe FAILED (${this.consecutiveFailures}/${this.opts.failureBudget})${lastError ? ` — ${lastError}` : ""}`,
      );
      if (this.consecutiveFailures >= this.opts.failureBudget) {
        this.fired = true;
        this.stop();
        this.opts.log?.(
          `[LivenessWatchdog] LIVENESS LOST — ${this.consecutiveFailures} consecutive session-probe failures; signalling self-exit (EMBEDDED exit-propagation seam)`,
        );
        this.opts.onLivenessLost({ consecutiveFailures: this.consecutiveFailures, lastError });
      }
    } finally {
      this.ticking = false;
    }
  }

  /** Test/observability introspection. */
  get failures(): number {
    return this.consecutiveFailures;
  }
  get hasFired(): boolean {
    return this.fired;
  }
}
