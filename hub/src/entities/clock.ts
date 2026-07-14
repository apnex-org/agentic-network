/**
 * clock.ts — the injectable time source (idea-449 VirtualClock sub-slice + idea-525).
 *
 * The substrate repositories and the `get_now` read-verb read the current instant
 * through a `Clock` instead of calling `new Date()` inline, so a simulation (or a
 * test) can drive DETERMINISTIC time: two identical runs produce byte-identical
 * timestamps, which is what the 449-A-gate `delta=0` determinism assertion stands on.
 *
 * Production wires {@link systemClock} (real wall time); the sim wires a
 * {@link VirtualClock}. The hub assembles ONE clock and hands the SAME instance to
 * both the repository constructors and `ctx.clock`, so `get_now` reports the exact
 * source the substrate stamps its timestamps with (idea-525: "the same clock source").
 *
 * The interface names zero domain vocabulary — it is a neutral primitive (the PRISM
 * semantic-neutrality stance), so it can be shared by every repository without
 * coupling any of them to a clock implementation.
 */

/** An injectable source of "now". Every time read in the substrate routes through this. */
export interface Clock {
  /** The current instant as a `Date`. Callers derive `.toISOString()` / `.getTime()` from it. */
  now(): Date;
}

/**
 * Real wall-clock time — the production default. Constructing a repository with no
 * clock argument yields exactly the pre-existing `new Date()` behaviour.
 */
export const systemClock: Clock = {
  now: (): Date => new Date(),
};

/**
 * A controllable clock for deterministic simulation and tests. Time advances ONLY when
 * {@link set} / {@link advance} is called — it never moves on its own, so a run driven
 * by a `VirtualClock` is fully reproducible.
 */
export class VirtualClock implements Clock {
  private ms: number;

  /** @param startMs the initial instant, in epoch milliseconds (default 0 = 1970-01-01T00:00:00Z). */
  constructor(startMs = 0) {
    this.ms = startMs;
  }

  now(): Date {
    return new Date(this.ms);
  }

  /** Advance the clock forward by `deltaMs` milliseconds. */
  advance(deltaMs: number): void {
    this.ms += deltaMs;
  }

  /** Set the clock to an absolute instant, in epoch milliseconds. */
  set(ms: number): void {
    this.ms = ms;
  }

  /** The current instant as epoch milliseconds (for callers that want a number). */
  nowMs(): number {
    return this.ms;
  }
}
