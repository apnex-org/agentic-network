/**
 * mission-83 W5.4-Hub-bootstrap-flip — integration test for STORAGE_BACKEND=substrate.
 *
 * Spawns Hub via tsx subprocess with STORAGE_BACKEND=substrate + POSTGRES_CONNECTION_STRING
 * against testcontainers postgres + verifies:
 *   1. substrate-mode boot log surfaces ("[Hub] substrate-mode active")
 *   2. reconciler settles ("substrate reconciler settled (N SchemaDefs applied)")
 *   3. substrate-versioned repositories instantiated log
 *   4. Hub HTTP server listens on PORT
 *   5. Hub fails fast if POSTGRES_CONNECTION_STRING missing
 *
 * Per W5 RACI: engineer-side ships bootstrap-flip code + bootstrap integration test;
 * production cutover (W5.4 execution) operator-orchestrated separately.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { spawn, type ChildProcess } from "node:child_process";

const { Pool } = pg;

let container: StartedPostgreSqlContainer;
let connStr: string;

const HUB_INDEX = join(__dirname, "..", "index.ts");
const MIGRATIONS_DIR = join(__dirname, "..", "storage-substrate", "migrations");
const MIGRATION_FILES = [
  "001-entities-table.sql",
  "002-notify-trigger.sql",
  "003-jsonb-size-check.sql",
];

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:15-alpine")
    .withUsername("hub")
    .withPassword("hub")
    .withDatabase("hub")
    .start();
  connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;

  // Pre-apply migrations so Hub reconciler has table to work with
  const pool = new Pool({ connectionString: connStr });
  for (const f of MIGRATION_FILES) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf-8");
    await pool.query(sql);
  }
  await pool.end();
}, 90_000);

afterAll(async () => {
  await container.stop();
}, 30_000);

interface HubProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawn Hub as subprocess; capture stdout/stderr; kill after timeoutMs or when
 * matchLog regex is seen in stdout (whichever first).
 */
async function spawnHub(
  env: Record<string, string>,
  opts: { matchLog?: RegExp; timeoutMs: number },
): Promise<HubProcessResult> {
  return new Promise((resolve) => {
    const proc: ChildProcess = spawn("npx", ["tsx", HUB_INDEX], {
      env: { ...process.env, ...env, PORT: "0" },  // PORT=0 → kernel-assigned random port
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;

    const finish = (exitCode: number | null) => {
      if (resolved) return;
      resolved = true;
      try { proc.kill("SIGTERM"); } catch { /* already exited */ }
      setTimeout(() => resolve({ exitCode, stdout, stderr }), 100);
    };

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (opts.matchLog && opts.matchLog.test(stdout)) {
        finish(null);  // matched; resolve early
      }
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("exit", (code) => finish(code));
    proc.on("error", () => finish(null));

    setTimeout(() => finish(null), opts.timeoutMs);
  });
}

describe("Hub bootstrap with STORAGE_BACKEND=substrate (W5.4-bootstrap-flip)", () => {
  it("fails fast when POSTGRES_CONNECTION_STRING is missing", async () => {
    const r = await spawnHub(
      { STORAGE_BACKEND: "substrate" },
      { timeoutMs: 15_000 },
    );
    // Hub should exit non-zero with clear error
    const combined = r.stdout + r.stderr;
    expect(combined).toContain("POSTGRES_CONNECTION_STRING");
    expect(combined).toContain("substrate");
  }, 30_000);

  it("substrate-mode boots: reconciler settles + substrate-versioned repositories instantiated + Hub listens", async () => {
    const r = await spawnHub(
      {
        STORAGE_BACKEND: "substrate",
        POSTGRES_CONNECTION_STRING: connStr,
      },
      {
        matchLog: /MCP Relay Hub listening on port/,
        timeoutMs: 60_000,
      },
    );

    // Verify substrate-mode boot path executed
    expect(r.stdout, "substrate-mode active log").toContain("[Hub] substrate-mode active");
    expect(r.stdout, "postgres conn redacted").toContain("postgres=postgres://hub:***@");
    expect(r.stdout, "reconciler settled log").toMatch(/substrate reconciler settled \(\d+ SchemaDefs applied\)/);
    expect(r.stdout, "repositories instantiated log").toContain("[Hub] substrate-mode repositories instantiated");
    expect(r.stdout, "Hub listening").toMatch(/MCP Relay Hub listening on port/);

    // No FS-mode log paths
    expect(r.stdout, "no FS-mode log").not.toContain("Using GCS storage backend");
    expect(r.stdout, "no FS-mode log").not.toContain("Using local-fs storage backend");
    expect(r.stdout, "no memory-mode log").not.toContain("Using in-memory storage backend");
  }, 90_000);
});
