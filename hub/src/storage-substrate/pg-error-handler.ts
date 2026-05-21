/**
 * bug-110 — canonical pg idle-connection error handler.
 *
 * pg's documented contract: a `Pool` or `Client` with NO `'error'` listener
 * lets a backend error on an *idle* connection surface as an UNCAUGHT exception
 * that crashes the process. The substrate `Pool`, the SchemaReconciler /
 * TokenStore pools, and the `watch()` LISTEN `Client` were all constructed
 * without one — so a transient backend error crashed the process with an
 * unhandled `57P01` ("terminating connection due to administrator command"):
 *
 *   - In CI: a postgres testcontainer's `container.stop()` racing the pool's
 *     own teardown terminates a still-idle connection → `vitest (hub)` flaked
 *     (bug-110; tripped #236 + #237 — all tests pass, but the job exits 1 on
 *     the uncaught exception).
 *   - In production: a postgres failover / restart / idle-connection drop
 *     would crash the Hub process for the same reason.
 *
 * This attaches the required handler: an idle-connection error is logged as
 * non-fatal and the process survives — pg discards the dead connection and
 * reconnects lazily on next use.
 */

/** Structural type satisfied by both `pg.Pool` and `pg.Client`. */
export interface PgErrorEmitter {
  on(event: "error", listener: (err: Error) => void): unknown;
}

/**
 * Attach the canonical `'error'` handler to a pg `Pool` / `Client`.
 *
 * `label` identifies the resource in the log line (e.g. which pool errored).
 */
export function attachPgErrorHandler(emitter: PgErrorEmitter, label: string): void {
  emitter.on("error", (err: Error) => {
    console.error(
      `[Hub:substrate] ${label} — idle pg connection error (handled, non-fatal): ${err.message}`,
    );
  });
}
