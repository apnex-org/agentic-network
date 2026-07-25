/**
 * Bounded FIFO admission gate for storage work.
 *
 * The pg Pool limits open connections but its waiter queue is intentionally
 * unbounded. During a fleet reconnect that means every client can enqueue a
 * state-sync list at once, retaining request/session state while PostgreSQL is
 * already saturated. This gate adds the missing admission boundary in front of
 * list queries: bounded active work, bounded queued work, and a loud timeout.
 */

export class StorageAdmissionError extends Error {
  readonly code = "storage_admission_backpressure";

  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = "StorageAdmissionError";
  }
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (error: StorageAdmissionError) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface AdmissionGateSnapshot {
  active: number;
  queued: number;
  maxActive: number;
  maxQueued: number;
  /** Phase-resettable observed high-water marks (not configuration claims). */
  highWaterActive: number;
  highWaterQueued: number;
  admitted: number;
  rejectedQueueFull: number;
  rejectedTimeout: number;
}

export class AdmissionGate {
  private active = 0;
  private readonly queue: Waiter[] = [];
  private highWaterActive = 0;
  private highWaterQueued = 0;
  private admitted = 0;
  private rejectedQueueFull = 0;
  private rejectedTimeout = 0;

  constructor(
    private readonly maxActive: number,
    private readonly maxQueued: number,
    private readonly timeoutMs: number,
  ) {
    if (!Number.isInteger(maxActive) || maxActive < 1) {
      throw new Error(`AdmissionGate maxActive must be a positive integer (got ${maxActive})`);
    }
    if (!Number.isInteger(maxQueued) || maxQueued < 0) {
      throw new Error(`AdmissionGate maxQueued must be a non-negative integer (got ${maxQueued})`);
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
      throw new Error(`AdmissionGate timeoutMs must be positive (got ${timeoutMs})`);
    }
  }

  snapshot(): AdmissionGateSnapshot {
    return {
      active: this.active,
      queued: this.queue.length,
      maxActive: this.maxActive,
      maxQueued: this.maxQueued,
      highWaterActive: this.highWaterActive,
      highWaterQueued: this.highWaterQueued,
      admitted: this.admitted,
      rejectedQueueFull: this.rejectedQueueFull,
      rejectedTimeout: this.rejectedTimeout,
    };
  }

  /** Begin a distinct measurement phase without disturbing active/queued work. */
  resetObservations(): void {
    this.highWaterActive = this.active;
    this.highWaterQueued = this.queue.length;
    this.admitted = 0;
    this.rejectedQueueFull = 0;
    this.rejectedTimeout = 0;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    this.admitted++;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private acquire(): Promise<() => void> {
    if (this.active < this.maxActive) {
      this.active++;
      this.highWaterActive = Math.max(this.highWaterActive, this.active);
      return Promise.resolve(this.makeRelease());
    }

    if (this.queue.length >= this.maxQueued) {
      this.rejectedQueueFull++;
      return Promise.reject(new StorageAdmissionError(
        `storage list admission queue full (${this.active} active, ${this.queue.length} queued)`,
        this.timeoutMs,
      ));
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          this.rejectedTimeout++;
          reject(new StorageAdmissionError(
            `storage list admission timed out after ${this.timeoutMs}ms`,
            this.timeoutMs,
          ));
        }, this.timeoutMs),
      };
      this.queue.push(waiter);
      this.highWaterQueued = Math.max(this.highWaterQueued, this.queue.length);
    });
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      const next = this.queue.shift();
      if (next) {
        clearTimeout(next.timer);
        // Direct hand-off: the active count stays constant and there is no
        // transient free-slot window in which a later caller can jump the FIFO.
        next.resolve(this.makeRelease());
        return;
      }

      this.active--;
    };
  }
}
