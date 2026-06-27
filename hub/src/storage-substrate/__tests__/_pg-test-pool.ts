/**
 * bug-178 — shared substrate-test pg `Pool` factory with the canonical bug-110
 * error handler attached.
 *
 * Every PRODUCTION `Pool`/`Client` routes through `attachPgErrorHandler` so a
 * backend error on an idle connection is logged non-fatal instead of crashing
 * the process (pg's documented contract). The substrate TEST pools were the
 * gap: each test created a raw `new Pool(connStr)` with NO `'error'` handler, so
 * a testcontainer `container.stop()` admin-shutdown (`57P01`, "terminating
 * connection due to administrator command") racing the pool's own teardown
 * surfaced as an UNHANDLED uncaught exception — which vitest counts as a job
 * failure even though every assertion passes (pure teardown noise). Because
 * vitest shares workers across files, that escape was mis-attributed to whatever
 * file happened to be running, intermittently failing `vitest (hub)` and
 * blocking merges (bug-178; manifested live blocking PR #379).
 *
 * Route every substrate-test pool through here so the `57P01` is non-fatal
 * regardless of teardown ordering — the bug-110 pattern, extended to the test
 * harness. This is the mirror of the production wiring (substrate pool,
 * reconciler pool, token-store pool, and the watch LISTEN client all already
 * call `attachPgErrorHandler`).
 */
import { Pool, type PoolConfig } from "pg";
import { attachPgErrorHandler } from "../pg-error-handler.js";

/**
 * Create a pg `Pool` for substrate tests with the canonical error handler
 * attached. Accepts a connection string or a full `PoolConfig`.
 */
export function createTestPool(
  config: string | PoolConfig,
  label = "substrate test pool",
): Pool {
  const pool = new Pool(typeof config === "string" ? { connectionString: config } : config);
  attachPgErrorHandler(pool, label);
  return pool;
}
