#!/usr/bin/env node
/**
 * PID-1 thin supervisor — the CONSUME half of the EMBEDDED exit-propagation seam
 * (M-Adapter-Modernization P1e, Design §2 EMBEDDED + §4 L2).
 *
 * P1c's in-process L1.5 watchdog EMITS a wedged-restart sentinel (/run/adapter-wedged)
 * on an unrecoverable session wedge. This PID-1 supervisor CONSUMES it: terminate the
 * child (the CLI -> kernel-shim) and exit with code 75 so docker's restart-policy (L2)
 * fires -> a fresh container re-handshakes + re-claims. (The shim's own exit code is
 * swallowed by the CLI grandchild; the sentinel is the out-of-band signal — hence this
 * PID-1 consumer.)
 *
 * THIN by design (PID-1): no kernel import. The contract constants below MUST match
 * @apnex/network-adapter `liveness-signal.ts` (WEDGED_RESTART_EXIT_CODE + the sentinel
 * path); the P1e supervisor-seam test asserts that parity so a drift fails CI.
 *
 * §6 safe-update: a SIGTERM from `docker stop` quiesces the child (bounded grace) then
 * exits 0 — a clean stop, NOT a wedged-restart.
 */
import { spawn } from "node:child_process";
import { existsSync, watchFile, unwatchFile, rmSync } from "node:fs";

/** == @apnex/network-adapter WEDGED_RESTART_EXIT_CODE (P1c). Parity asserted in the seam test. */
export const SUPERVISOR_EXIT_CODE = 75;
/** == @apnex/network-adapter DEFAULT_LIVENESS_SENTINEL (P1c). */
export const SUPERVISOR_SENTINEL_DEFAULT = "/run/adapter-wedged";

/**
 * Run the supervisor over a child command. Returns the child handle. Options are
 * injectable for the env-independent process test (sentinel path, poll/grace ms,
 * log + exit sinks).
 */
export function runSupervisor(childArgv, opts = {}) {
  const sentinel = opts.sentinel ?? process.env.OIS_LIVENESS_SENTINEL ?? SUPERVISOR_SENTINEL_DEFAULT;
  const pollMs = opts.pollMs ?? (Number(process.env.OIS_SUPERVISOR_POLL_MS) || 1000);
  const graceMs = opts.graceMs ?? (Number(process.env.OIS_SUPERVISOR_GRACE_MS) || 3000);
  const log = opts.log ?? ((m) => process.stderr.write(`[supervisor] ${m}\n`));
  const exit = opts.exit ?? ((c) => process.exit(c));

  // A fresh container starts un-wedged: clear any stale sentinel from a prior boot.
  try { if (existsSync(sentinel)) rmSync(sentinel); } catch { /* best-effort */ }

  const child = spawn(childArgv[0], childArgv.slice(1), { stdio: opts.stdio ?? "inherit" });
  let done = false;

  function finish(code, reason) {
    if (done) return;
    done = true;
    log(`${reason} -> terminating child (pid ${child.pid}) + exit(${code})`);
    unwatchFile(sentinel);
    const hard = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } exit(code); }, graceMs);
    child.once("exit", () => { clearTimeout(hard); exit(code); });
    try { child.kill("SIGTERM"); } catch { clearTimeout(hard); exit(code); }
  }

  // L2 consume seam: the wedged-restart sentinel appears -> exit(75) -> docker restarts.
  watchFile(sentinel, { interval: pollMs }, () => {
    if (!done && existsSync(sentinel)) finish(SUPERVISOR_EXIT_CODE, `wedged-restart sentinel ${sentinel} appeared`);
  });

  // Child self-exit -> mirror its code (docker restart-policy decides on the code).
  child.once("exit", (code, signal) => {
    if (done) return;
    done = true;
    unwatchFile(sentinel);
    log(`child exited (code=${code} signal=${signal ?? ""})`);
    exit(code ?? (signal ? 1 : 0));
  });

  // §6 safe-update: docker stop sends SIGTERM -> quiesce the child, clean exit 0.
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => finish(0, `received ${sig}`));

  log(`PID-1 up; child pid=${child.pid}; watching sentinel ${sentinel}`);
  return child;
}

// PID-1 entrypoint when invoked directly: `node supervisor.mjs <child-command...>`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const childArgv = process.argv.slice(2);
  if (childArgv.length === 0) {
    process.stderr.write("[supervisor] usage: supervisor.mjs <child-command...>\n");
    process.exit(2);
  }
  runSupervisor(childArgv);
}
