/**
 * Liveness-lost signal-contract — the kernel->supervisor seam (Design §4 P1c,
 * the EMBEDDED exit-propagation seam).
 *
 * In the EMBEDDED topology (PID-1 supervisor -> CLI -> kernel-shim GRANDCHILD)
 * the kernel CANNOT exit the container by itself: `process.exit` kills only the
 * shim, the CLI swallows its exit code, and PID-1 (the supervisor) never sees it.
 * So liveness-loss is signalled to PID-1 DIRECTLY + OUT-OF-BAND via a SENTINEL
 * file. P1c (here) EMITS the sentinel; P1e's PID-1 supervisor CONSUMES it -> exits
 * the container with WEDGED_RESTART_EXIT_CODE -> docker-L2 restart-on-exit fires
 * -> a fresh container re-handshakes + re-claims.
 *
 * The distinct code (75 / EX_TEMPFAIL) carries "wedged — restart me" semantics
 * (vs a clean exit 0). It is the SIGNAL payload's code + the code PID-1 exits the
 * CONTAINER with — NOT the grandchild shim's exit code (which the CLI discards).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** EX_TEMPFAIL — the wedged-restart container-exit code the P1e supervisor uses. */
export const WEDGED_RESTART_EXIT_CODE = 75;

/** Default sentinel path PID-1 watches. Override via OIS_LIVENESS_SENTINEL (P1e mounts /run). */
export const DEFAULT_LIVENESS_SENTINEL = "/run/adapter-wedged";

export interface LivenessLostSignalPayload {
  reason: "session-wedged";
  consecutiveFailures: number;
  /** The code PID-1 should exit the CONTAINER with (NOT the shim's exit code). */
  exitCode: number;
  emittedAt: string; // ISO-8601
  pid: number;
  lastError?: string;
}

export interface EmitLivenessLostOptions {
  sentinelPath?: string;
  consecutiveFailures: number;
  lastError?: unknown;
  now?: () => string;
  /** Injectable writer (tests). Default writes the file, mkdir-p the parent dir. */
  writeFile?: (path: string, data: string) => void;
  log?: (msg: string) => void;
}

/**
 * Resolve the sentinel path: explicit opt > OIS_LIVENESS_SENTINEL env > default.
 */
export function resolveSentinelPath(explicit?: string): string {
  return explicit ?? process.env.OIS_LIVENESS_SENTINEL ?? DEFAULT_LIVENESS_SENTINEL;
}

/**
 * Emit the liveness-lost sentinel (the kernel->PID-1 signal). Writes the JSON
 * payload durably and returns it. Does NOT itself exit the process — the caller
 * chains the in-process self-exit AFTER this returns, so the sentinel is on disk
 * before the shim dies and the supervisor can read it. Never throws out: a write
 * failure is logged (the self-exit still proceeds; L3 lease-reclaim is the final
 * backstop) but does not mask the wedge.
 */
export function emitLivenessLostSignal(opts: EmitLivenessLostOptions): LivenessLostSignalPayload {
  const path = resolveSentinelPath(opts.sentinelPath);
  const payload: LivenessLostSignalPayload = {
    reason: "session-wedged",
    consecutiveFailures: opts.consecutiveFailures,
    exitCode: WEDGED_RESTART_EXIT_CODE,
    emittedAt: (opts.now ?? (() => new Date().toISOString()))(),
    pid: process.pid,
    ...(opts.lastError !== undefined ? { lastError: String(opts.lastError) } : {}),
  };
  const write =
    opts.writeFile ??
    ((p, d) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, d);
    });
  try {
    write(path, JSON.stringify(payload, null, 2) + "\n");
    opts.log?.(
      `[LivenessSignal] wrote wedged-restart sentinel ${path} (exitCode ${WEDGED_RESTART_EXIT_CODE}, ${opts.consecutiveFailures} failures); PID-1 supervisor consumes -> container-exit -> docker-L2 restart`,
    );
  } catch (err) {
    opts.log?.(`[LivenessSignal] FAILED to write sentinel ${path}: ${err} — self-exit proceeds; L3 lease-reclaim is the backstop`);
  }
  return payload;
}
