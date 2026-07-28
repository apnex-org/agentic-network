/**
 * bug-421 — SIGTERM must TERMINATE THE PROCESS, not merely log that it did.
 *
 * THE DEFECT THIS GUARDS: the adapter logged "Clean shutdown complete" and kept
 * running, converting a retrying seat into a silently dead one the parent never
 * restarts. **THE LOG LINE IS THE THING THAT LIED**, so this test is forbidden from
 * asserting on log output. It asserts PROCESS EXIT STATUS.
 *
 * ── WHY `code === 0 && signal === null` IS THE WHOLE TEST ──────────────────────
 *
 * A process that exits "somehow" proves nothing — SIGTERM's DEFAULT disposition
 * terminates an unhandled process too. The outcomes are distinguishable only in the
 * exit descriptor. MEASURED, not assumed (the M1/M2 runs below produced these):
 *
 *   handler ran, reached process.exit(0)   ->  { code: 0,   signal: null }
 *   no handler at all (M2)                 ->  { code: 143, signal: null }   <- 128+15, OS default
 *   handler ran but never exits (M1)       ->  never exits; the wait times out
 *   handler hung past SHUTDOWN_TIMEOUT_MS  ->  { code: 1,   signal: null }   <- force-exit path
 *
 * ⚠ NOTE THE 143, AND DO NOT "TIDY" THE code ASSERTION INTO A TRUTHY EXIT CHECK.
 * Because the spawned child is the `tsx` WRAPPER rather than node-running-shim
 * directly, the wrapper absorbs the signal and re-reports it as exit code 128+15.
 * **So `signal` is null in BOTH the pass and the M2 fail case, and `code` is the only
 * field that discriminates them.** The `signal` assertion below is therefore a cheap
 * belt-and-braces for a direct (unwrapped) spawn — it is NOT what catches a missing
 * handler. I originally documented the opposite and M2 disproved it.
 *
 * ── WHY THIS SPAWNS `src/shim.ts` VIA tsx AND NOT `dist/shim.js` ───────────────
 *
 * `dist/` is a build artifact that can be arbitrarily stale. A mutation to
 * `src/shim.ts` would not appear in a stale `dist`, so the falsifier below would
 * pass against the mutated source and the test would be VACUOUS while looking green.
 * Testing the source is what makes the mutation matrix meaningful.
 *
 * ── FALSIFIER MATRIX (run manually; recorded in work-bp-gauntlet0-impl_b421) ───
 *
 *   M0  unmutated control                          -> GREEN   (required: proves not saturated)
 *   M1  delete `process.exit(0)` at shim.ts:191    -> RED     (times out; the bug-421 shape)
 *   M2  delete the SIGINT/SIGTERM handler loop     -> RED     (code 143 = 128+15, OS default)
 *
 * M0 is not optional. A test that is red for every input is not measuring anything.
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
// @ts-expect-error — .mjs fixture, no type declarations
import { startMinimalMcpHub } from "../../../scripts/test/fixtures/minimal-mcp-hub.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIM_SRC = join(HERE, "..", "src", "shim.ts");
const TSX = join(HERE, "..", "..", "..", "node_modules", ".bin", "tsx");

/** Generous vs SHUTDOWN_TIMEOUT_MS (3000) — this bound must not be the thing under test. */
const EXIT_BUDGET_MS = 15_000;
const READY_BUDGET_MS = 30_000;

interface ExitDescriptor {
  code: number | null;
  signal: NodeJS.Signals | null;
}

async function waitFor(cond: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 25));
  }
  if (!cond()) throw new Error(`waitFor: ${what} not met within ${timeoutMs}ms`);
}

let child: ChildProcess | null = null;
let hub: { url: string; calls: Array<{ name: string }>; close: () => Promise<void> } | null = null;

afterEach(async () => {
  // SIGKILL, never SIGTERM — tearing down with the signal under test would let a
  // regression clean up after itself and hide.
  if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  child = null;
  if (hub) await hub.close().catch(() => {});
  hub = null;
});

describe("bug-421: SIGTERM terminates the adapter process", () => {
  it("exits with code 0 and no signal — our handler ended it, not the kernel", async () => {
    hub = await startMinimalMcpHub();

    const workDir = mkdtempSync(join(tmpdir(), "bug421-"));
    mkdirSync(join(workDir, ".ois"), { recursive: true });

    child = spawn(TSX, [SHIM_SRC], {
      cwd: workDir,
      env: {
        ...process.env,
        WORK_DIR: workDir,
        OIS_HUB_URL: hub!.url,
        OIS_HUB_TOKEN: "fixture-token",
        OIS_HUB_ROLE: "engineer",
        OIS_AGENT_NAME: "bug421-sigterm-probe",
        OIS_COGNITIVE_BYPASS: "1",
        TRANSPORT_HEARTBEAT_ENABLED: "false",
        OIS_LIVENESS_WATCHDOG_ENABLED: "0",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let exit: ExitDescriptor | null = null;
    child.once("exit", (code, signal) => { exit = { code, signal }; });

    // ⚠ VACUITY GUARD — LOAD-BEARING, DO NOT REMOVE.
    // The signal handlers are registered at the END of main(), AFTER the hub
    // connection. A shim that dies before that point is killed by SIGTERM's default
    // disposition and would still "exit" — so without this wait, the assertions below
    // could pass on a shim that never installed a handler at all.
    await waitFor(
      () => hub!.calls.some((c) => c.name === "register_role"),
      READY_BUDGET_MS,
      "shim reached register_role (handlers installed)",
    );
    expect(exit, "shim must still be running before we signal it").toBeNull();

    child.kill("SIGTERM");

    await waitFor(() => exit !== null, EXIT_BUDGET_MS, "process exit after SIGTERM");

    // THE ASSERTION. Not a log line.
    // (Belt-and-braces; under a `tsx` wrapper this is null either way — see header.)
    expect(exit!.signal, "signal must be null — a raw signal here means the kernel killed an unhandled process").toBeNull();
    // THIS is the discriminating assertion. Read the actual value when it fails:
    //   143 (128+15) -> NO handler ran; SIGTERM's default disposition killed it.
    //     1          -> handler ran but hung past SHUTDOWN_TIMEOUT_MS (3000ms) force-exit.
    //   (no exit)    -> handler ran, logged, and never terminated. THAT IS bug-421.
    expect(
      exit!.code,
      "exit code must be 0 — see the header table; 143 means no handler ran, 1 means the force-exit fired",
    ).toBe(0);
  }, READY_BUDGET_MS + EXIT_BUDGET_MS + 10_000);
});

/**
 * ⚠ OBSERVED ONCE, NOT REPRODUCED — RECORDED RATHER THAN BURIED.
 *
 * On the FIRST full-package run this test failed at the `code` assertion (isolated
 * runs and three subsequent full-suite runs were all green: 207/207 × 3). I could not
 * reproduce it and therefore cannot characterise it. Candidate causes, unmeasured:
 * port contention on the fixture hub under parallel test-file execution, or CPU
 * pressure pushing the shim past SHUTDOWN_TIMEOUT_MS.
 *
 * **1 red in 4 full-suite runs is a flake signal, not noise.** If this test fails in
 * CI, read the actual exit code against the header table BEFORE assuming a
 * regression — and treat this note as the prior, not as reassurance.
 */
