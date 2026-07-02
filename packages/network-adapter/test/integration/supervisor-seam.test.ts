/**
 * P1e-1 ev_seam_consume — the PID-1 supervisor CONSUMES P1c's wedged-restart sentinel
 * (M-Adapter-Modernization Design §2/§4 P1e). ENV-INDEPENDENT: runs the supervisor as a
 * real process and drives the sentinel on disk — NO docker daemon (the real docker-L2
 * restart e2e is P1e-2). Proves the env-independent HALF of the exit-propagation seam:
 * P1c EMITS the sentinel; this asserts the supervisor exits 75 on it (the docker-L2
 * trigger) + a clean SIGTERM exits 0 (§6 safe-update, NOT a wedged-restart).
 */
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { WEDGED_RESTART_EXIT_CODE, DEFAULT_LIVENESS_SENTINEL } from "../../src/index.js";
// @ts-expect-error — the supervisor is a plain .mjs deploy artifact (no .d.ts); we only
// import its two contract constants for the parity assertion.
import { SUPERVISOR_EXIT_CODE, SUPERVISOR_SENTINEL_DEFAULT } from "../../../../deploy/adapter-image/supervisor.mjs";

const SUPERVISOR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../deploy/adapter-image/supervisor.mjs");

function runUntilExit(sentinel: string, drive: (sup: ReturnType<typeof spawn>) => void): Promise<number | null> {
  return new Promise((resolveP) => {
    const sup = spawn("node", [SUPERVISOR, "node", "-e", "setInterval(()=>{},1e9)"], {
      env: { ...process.env, OIS_LIVENESS_SENTINEL: sentinel, OIS_SUPERVISOR_POLL_MS: "50", OIS_SUPERVISOR_GRACE_MS: "1000" },
      stdio: "ignore",
    });
    setTimeout(() => drive(sup), 300); // let the supervisor start watching first
    sup.on("exit", (code) => resolveP(code));
  });
}

describe("P1e-1 ev_seam_consume — PID-1 supervisor consumes the wedged-restart sentinel (env-independent)", () => {
  it("PARITY: the supervisor's exit code + sentinel default match P1c's contract (drift fails CI)", () => {
    expect(SUPERVISOR_EXIT_CODE).toBe(WEDGED_RESTART_EXIT_CODE); // 75
    expect(SUPERVISOR_SENTINEL_DEFAULT).toBe(DEFAULT_LIVENESS_SENTINEL); // /run/adapter-wedged
  });

  it("sentinel appears -> terminates the child + exits 75 (the docker-L2 restart trigger)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p1e-sup-"));
    const sentinel = join(dir, "adapter-wedged");
    try {
      const code = await runUntilExit(sentinel, () =>
        writeFileSync(sentinel, JSON.stringify({ reason: "session-wedged", exitCode: 75 })),
      );
      expect(code).toBe(75);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clean SIGTERM (docker stop / §6 safe-update) -> exits 0, NOT a wedged-restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p1e-sup-"));
    const sentinel = join(dir, "adapter-wedged");
    try {
      const code = await runUntilExit(sentinel, (sup) => sup.kill("SIGTERM"));
      expect(code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
