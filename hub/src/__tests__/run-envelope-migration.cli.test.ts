/**
 * mission-88 W6.1 — MigrationRunner CLI integration + unit tests (bug-119 hotfix).
 *
 * Per thread-649 R2 Q6 disposition: 1 integration test (subprocess-invoke CLI;
 * testcontainer-postgres seeded with synthetic legacy-shape entities; assert
 * post-state envelope-shape + exit-code + structured-text output) + targeted
 * unit tests (exit-code behavior on simulated failures; --dry-run no-write;
 * --json output format; missing-env-var error path).
 *
 * Re-uses existing harness fixtures from migrations/v2-envelope/__tests__/harness/fixtures.ts
 * per Q5 (no fixture duplication).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  setupSubstrate,
  teardownSubstrate,
  cleanKind,
  type SubstrateFixture,
} from "../storage-substrate/migrations/v2-envelope/__tests__/harness/fixtures.js";

// mission-88 W6.2 (bug-120 hotfix): tests invoke the COMPILED CLI at
// dist/scripts/run-envelope-migration.js — matches production-runtime path
// per npm-script `node dist/scripts/run-envelope-migration.js`. Build must
// have run (`npm run build`) before this test suite; see top-level guard below.
const CLI_JS_PATH = join(__dirname, "..", "..", "dist", "scripts", "run-envelope-migration.js");

if (!existsSync(CLI_JS_PATH)) {
  throw new Error(
    `[W6.2 CLI tests] compiled CLI missing at ${CLI_JS_PATH}; run \`npm run build\` first ` +
      `(mission-88 W6.2 / bug-120: CLI tests verify production-runtime compiled-path, not source-path).`,
  );
}

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(env: Record<string, string>, args: string[] = []): Promise<CliResult> {
  return new Promise((resolve) => {
    const proc = spawn("node", [CLI_JS_PATH, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}

describe("run-envelope-migration CLI — sanity", () => {
  it("compiled CLI file exists at expected path", () => {
    expect(existsSync(CLI_JS_PATH)).toBe(true);
  });
});

describe("run-envelope-migration CLI — exit-code error paths", () => {
  it("exits 2 when POSTGRES_CONNECTION_STRING is missing", async () => {
    const env: Record<string, string> = {};
    // Force-unset by re-spawning with sanitized env
    delete env.POSTGRES_CONNECTION_STRING;
    const result = await new Promise<CliResult>((resolve) => {
      // Build a minimal env that excludes POSTGRES_CONNECTION_STRING
      const cleanEnv: Record<string, string> = { PATH: process.env.PATH ?? "" };
      const proc = spawn("node", [CLI_JS_PATH], {
        env: cleanEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "", stderr = "";
      proc.stdout?.on("data", (d) => { stdout += d.toString(); });
      proc.stderr?.on("data", (d) => { stderr += d.toString(); });
      proc.on("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/POSTGRES_CONNECTION_STRING/);
  }, 30_000);

  it("exits 4 on unknown flag (mission-88 bug-133: was 3 pre-fix; exit=3 reserved for time-budget)", async () => {
    const result = await runCli({ POSTGRES_CONNECTION_STRING: "postgres://invalid:invalid@localhost:1/invalid" }, ["--unknown-flag"]);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toMatch(/unknown flag/);
  }, 30_000);

  it("--help prints usage and exits 0", async () => {
    const result = await runCli({ POSTGRES_CONNECTION_STRING: "postgres://invalid:invalid@localhost:1/invalid" }, ["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toMatch(/Usage:/);
  }, 30_000);
});

describe("run-envelope-migration CLI — integration against testcontainer postgres", () => {
  let fixture: SubstrateFixture;

  beforeAll(async () => {
    fixture = await setupSubstrate();
  }, 90_000);

  afterAll(async () => {
    await teardownSubstrate(fixture);
  }, 30_000);

  beforeEach(async () => {
    // Clean only kinds we touch; MigrationRunner may write to MigrationCursor too
    for (const k of ["Idea", "Bug", "Task", "Tele", "Audit", "Document", "MigrationCursor"]) {
      await cleanKind(fixture.connStr, k);
    }
  });

  it("full-sweep over empty substrate: exit 0; structured-text output; 22 kinds reported", async () => {
    const result = await runCli({ POSTGRES_CONNECTION_STRING: fixture.connStr });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\[envelope-migrate\] starting wave=W6\.1 kinds=22/);
    // SUMMARY footer carries the per-kind count + totals
    expect(result.stdout).toMatch(/\[envelope-migrate\] SUMMARY: 22 kinds; 0 total rowsMigrated; 0 total rowsErrored/);
  }, 120_000);

  it("--dry-run flag: legacy-shape rows are NOT mutated", async () => {
    // Seed one legacy-shape Idea
    await fixture.substrate.put("Idea", {
      id: "idea-9999",
      text: "dry-run-test",
      status: "open",
      missionId: null,
      createdBy: { role: "engineer", agentId: "agent-x" },
      sourceThreadId: null,
      sourceActionId: null,
      sourceThreadSummary: null,
      tags: [],
      createdAt: "2026-05-24T00:00:00Z",
      updatedAt: "2026-05-24T00:00:00Z",
    });

    const result = await runCli({ POSTGRES_CONNECTION_STRING: fixture.connStr }, ["--dry-run"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/dryRun=true/);

    // Verify row is still legacy-flat
    const post = await fixture.substrate.get<Record<string, unknown>>("Idea", "idea-9999");
    expect(post).not.toBeNull();
    expect(post!.text).toBe("dry-run-test");
    expect(post!.apiVersion).toBeUndefined();  // envelope key absent — legacy preserved
    expect(post!.metadata).toBeUndefined();
  }, 120_000);

  it("--json flag: emits structured JSON output", async () => {
    const result = await runCli({ POSTGRES_CONNECTION_STRING: fixture.connStr }, ["--json"]);
    expect(result.exitCode).toBe(0);
    // stdout is parseable JSON (single object containing wave + perKind array)
    const parsed = JSON.parse(result.stdout);
    expect(parsed.wave).toBe("W6.1");
    expect(parsed.exitCode).toBe(0);
    expect(parsed.dryRun).toBe(false);
    expect(Array.isArray(parsed.perKind)).toBe(true);
    expect(parsed.perKind.length).toBe(22);
    for (const kind of parsed.perKind) {
      expect(typeof kind.kind).toBe("string");
      expect(typeof kind.rowsMigrated).toBe("number");
      expect(typeof kind.rowsErrored).toBe("number");
      expect(kind.waveId).toBe("W6.1");
    }
  }, 120_000);

  it("seeded legacy-shape across 5 cluster-classes: full-sweep migrates all to envelope shape; exit 0", async () => {
    // Seed minimal legacy-shape across 5 cluster-classes (one per cluster)
    await fixture.substrate.put("Idea", {
      id: "idea-1001", text: "c1", status: "open", missionId: null,
      createdBy: { role: "engineer", agentId: "agent-greg" },
      sourceThreadId: null, sourceActionId: null, sourceThreadSummary: null,
      tags: [], createdAt: "2026-05-24T00:00:00Z", updatedAt: "2026-05-24T00:00:00Z",
    });
    await fixture.substrate.put("Task", {
      id: "task-1001", directive: "c2",
      report: null, reportSummary: null, reportRef: null,
      verification: null, reviewAssessment: null, reviewRef: null,
      assignedAgentId: null, clarificationQuestion: null, clarificationAnswer: null,
      correlationId: null, idempotencyKey: null, title: null, description: null,
      dependsOn: [], revisionCount: 0, status: "pending",
      labels: {}, turnId: null,
      sourceThreadId: null, sourceActionId: null, sourceThreadSummary: null,
      createdBy: { role: "engineer", agentId: "agent-greg" },
      createdAt: "2026-05-24T00:00:00Z", updatedAt: "2026-05-24T00:00:00Z",
    });
    await fixture.substrate.put("Tele", {
      id: "tele-1001", name: "T1-Test", description: "c3", successCriteria: "criteria",
      status: "active", createdBy: { role: "architect", agentId: "agent-arch" },
      createdAt: "2026-05-24T00:00:00Z",
    });
    await fixture.substrate.put("Audit", {
      id: "audit-1001", timestamp: "2026-05-24T00:00:00Z",
      actor: "engineer", action: "test", details: "c4", relatedEntity: null,
    });
    await fixture.substrate.put("Document", {
      id: "test-doc-c5", category: "architecture", content: "# c5\n",
    });

    const result = await runCli({ POSTGRES_CONNECTION_STRING: fixture.connStr });
    expect(result.exitCode).toBe(0);
    // 5 rows migrated; remaining 16 kinds empty
    expect(result.stdout).toMatch(/SUMMARY: 22 kinds; 5 total rowsMigrated; 0 total rowsErrored/);

    // Verify per-cluster envelope-shape
    const ideaPost = await fixture.substrate.get<Record<string, unknown>>("Idea", "idea-1001");
    expect(ideaPost!.apiVersion).toBe("core.ois/v1");
    expect((ideaPost!.metadata as Record<string, unknown>).createdAt).toBe("2026-05-24T00:00:00Z");
    expect((ideaPost!.spec as Record<string, unknown>).text).toBe("c1");
    expect((ideaPost!.status as Record<string, unknown>).phase).toBe("open");

    const taskPost = await fixture.substrate.get<Record<string, unknown>>("Task", "task-1001");
    expect(taskPost!.apiVersion).toBe("core.ois/v1");
    expect((taskPost!.spec as Record<string, unknown>).directive).toBe("c2");

    const telePost = await fixture.substrate.get<Record<string, unknown>>("Tele", "tele-1001");
    expect(telePost!.apiVersion).toBe("core.ois/v1");
    expect((telePost!.metadata as Record<string, unknown>).name).toBe("T1-Test");

    const auditPost = await fixture.substrate.get<Record<string, unknown>>("Audit", "audit-1001");
    expect(auditPost!.apiVersion).toBe("core.ois/v1");
    expect((auditPost!.status as Record<string, unknown>).phase).toBe("logged");

    const docPost = await fixture.substrate.get<Record<string, unknown>>("Document", "test-doc-c5");
    expect(docPost!.apiVersion).toBe("core.ois/v1");
    expect(((docPost!.metadata as Record<string, unknown>).labels as Record<string, string>).category).toBe("architecture");
  }, 180_000);
});
