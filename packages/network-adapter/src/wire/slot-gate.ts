/**
 * SlotGate — a minimal FIFO counting semaphore (bug-171).
 *
 * Bounds the number of concurrent in-flight `request()` calls over the single
 * shared MCP wire. A broad parallel read burst (e.g. a verifier conformance
 * sweep firing dozens of read-only Hub calls at once) could otherwise overwhelm
 * the one connection and drop the whole transport (`-32000 Connection closed`),
 * stranding the session behind reconnect backoff. The gate paces the burst:
 * excess callers queue for a slot rather than all firing at once. Queued calls
 * still complete — only their START is paced.
 *
 * Invariants:
 *   - The held count NEVER exceeds `max` (a parked caller is handed the
 *     releaser's slot directly — no decrement/re-increment window that could
 *     momentarily admit one over the cap).
 *   - Hand-off is FIFO (first parked, first resumed).
 *   - `max` is floored at 1 by the caller (a cap of 0 would deadlock).
 */
export class SlotGate {
  private held = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  /**
   * Acquire a slot. Resolves immediately (incrementing the held count) while
   * below `max`; otherwise parks until a holder {@link release}s a slot to it.
   * Always pair with exactly one `release()` in a `finally`.
   */
  async acquire(): Promise<void> {
    if (this.held < this.max) {
      this.held++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  /**
   * Release a slot. If a caller is parked, hand the slot directly to the next
   * (FIFO) — the held count stays the same, so the cap is never momentarily
   * exceeded. Otherwise decrement.
   */
  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else if (this.held > 0) {
      this.held--;
    }
  }

  /** Slots currently held (in-flight). Never exceeds `max`. */
  get inFlight(): number {
    return this.held;
  }

  /** Callers currently parked waiting for a slot. */
  get queued(): number {
    return this.waiters.length;
  }
}
