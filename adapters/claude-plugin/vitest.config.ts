import { defineConfig } from "vitest/config";

/**
 * bug-421 follow-up — FILE PARALLELISM DISABLED FOR THIS PACKAGE.
 *
 * WHY: `test/bug-421-sigterm-exit.test.ts` SPAWNS A REAL PROCESS (the shim, via tsx)
 * against a real fixture hub, sends it SIGTERM, and asserts its EXIT CODE. The shim's
 * own `SHUTDOWN_TIMEOUT_MS` is 3000ms — if the spawned process is starved of CPU while
 * 17 other test files run concurrently, that internal timeout fires and the shim
 * force-exits with code 1 instead of the clean 0. The test then goes red for a reason
 * that has NOTHING TO DO WITH THE DEFECT IT GUARDS.
 *
 * OBSERVED: 1 red in 4 full-package runs, at the `code` assertion, not reproducible in
 * isolation (isolated + 3 subsequent full runs all green, 207/207).
 *
 * ⚠️ THE ROOT CAUSE IS UNMEASURED. Two candidates were named — CPU starvation past the
 * 3s internal timeout (favoured: the failure was at the `code` assertion, and code 1 is
 * exactly that path) and fixture-hub port contention (less likely: the fixture binds
 * port 0 and takes an ephemeral port). **Serialising removes both without needing to
 * prove either**, which is why it is the fix rather than a diagnosis.
 *
 * ⚠️ AND THE EVIDENCE THAT IT WORKED IS WEAK BY CONSTRUCTION: the flake was 1-in-4, so
 * three green serialised runs is NOT proof. What justifies this change is that it
 * removes the MECHANISM, not that the reruns were green.
 *
 * ── WHY SERIALISE RATHER THAN SKIP, RETRY, OR LOOSEN THE ASSERTION ────────────
 *
 * A guard that is red 1-in-4 for unrelated reasons TRAINS EVERY FUTURE READER TO
 * DISCOUNT ITS RED — and this one sits on the fleet-upgrade path, so the one time it
 * tells the truth is the time it gets waved through. That is bug-437's shape exactly:
 * five individually-correct dismissals of a watchdog, where the habit was the harm.
 * `retry` would hide it. Loosening the `code` assertion would delete the discrimination
 * that makes the test worth having (see the M2 row in the test's own header).
 *
 * COST, MEASURED: package suite 207/207 in ~12-13s serial vs ~4s parallel (+8-9s).
 * If that cost becomes unacceptable, the correct next step is to isolate ONLY this file
 * into its own vitest project, NOT to re-enable parallelism and re-accept the flake.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
