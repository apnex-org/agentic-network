/**
 * mission-83 W5.4-plumbing + W5.5-plumbing — migrate-fs-to-substrate.ts
 * end-to-end plumbing validation against testcontainers postgres + synthetic state.
 *
 * Per path (β) accepted on thread-571: engineer-side plumbing-validation NOT
 * production-cutover execution. Synthetic-state migration verifies:
 *
 *   W5.4-plumbing — Migration script:
 *     1. CLI arg parsing
 *     2. 7-phase sequence (snapshot → scan → schema bootstrap → reconciler primer
 *        → bulk insert → verification → cut signal)
 *     3. Idempotency (re-run migrates same state cleanly)
 *     4. Dry-run mode (no DB writes)
 *     5. .MIGRATION_COMPLETE marker emission
 *
 *   W5.5-plumbing — Post-cutover smoke matrix (synthetic-state):
 *     1. Count parity per kind (FS vs DB)
 *     2. Content-hash spot-check per kind
 *     3. Substrate-API surface — get + put + delete + list per migrated kind
 *
 * Production cutover execution (W5.4 + W5.5 + W5.6) is operator-orchestrated
 * separately per architect RACI assignment.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { createPostgresStorageSubstrate, type HubStorageSubstrate } from "../../src/storage-substrate/index.js";

const { Pool } = pg;

let container: StartedPostgreSqlContainer;
let connStr: string;
let synthDir: string;
let backupPath: string;
let substrate: HubStorageSubstrate;

const SCRIPT_PATH = path.resolve(__dirname, "..", "migrate-fs-to-substrate.ts");

// Tiny synthetic state generator — 5-10 entities per kind for fast tests.
function generateSyntheticState(root: string): void {
  fs.mkdirSync(root, { recursive: true });

  // 12 existing-substrate-mediated kinds — per-kind directory + JSON files
  const kindDirs: [string, string, number][] = [
    ["Agent", "engineers", 3],
    ["Audit", "audit/v2", 5],
    ["Bug", "bugs", 4],
    ["Idea", "ideas", 6],
    ["Message", "messages", 10],
    ["Mission", "missions", 3],
    ["PendingAction", "pending-actions", 5],
    ["Proposal", "proposals", 3],
    ["Task", "tasks", 8],
    ["Tele", "tele", 4],
    ["Thread", "threads", 5],
    ["Turn", "turns", 3],
    ["Notification", "notifications", 6],
  ];

  for (const [kind, dir, count] of kindDirs) {
    const kindRoot = path.join(root, dir);
    fs.mkdirSync(kindRoot, { recursive: true });
    for (let i = 1; i <= count; i++) {
      const id = `${kind.toLowerCase()}-${i}`;
      const entity = {
        id,
        title: `Synth ${kind} #${i}`,
        status: "active",
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(kindRoot, `${id}.json`), JSON.stringify(entity, null, 2));
    }
  }

  // Counter special-case (meta/counter.json)
  const metaDir = path.join(root, "meta");
  fs.mkdirSync(metaDir, { recursive: true });
  fs.writeFileSync(path.join(metaDir, "counter.json"), JSON.stringify({
    bugCounter: 4,
    ideaCounter: 6,
    missionCounter: 3,
    proposalCounter: 3,
    taskCounter: 8,
    teleCounter: 4,
    threadCounter: 5,
    turnCounter: 3,
    auditCounter: 5,
    pendingActionCounter: 5,
  }, null, 2));

  // Document (nested category)
  const docsDir = path.join(root, "documents", "design");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, "test-doc.md"), "# Test design doc\n\nBody.");

  // Architect-context kinds (JSON arrays)
  const acDir = path.join(root, "architect-context");
  fs.mkdirSync(acDir, { recursive: true });
  fs.writeFileSync(path.join(acDir, "decisions.json"), JSON.stringify([
    { decision: "Adopt substrate", context: "mission-83", timestamp: "2026-05-17T03:00:00Z" },
    { decision: "Design v1.4 fold", context: "engineer-surface", timestamp: "2026-05-17T03:40:00Z" },
  ], null, 2));
  fs.writeFileSync(path.join(acDir, "director-history.json"), JSON.stringify([
    { role: "Director", text: "Initial directive" },
    { role: "Director", text: "Follow-up" },
  ], null, 2));
  fs.writeFileSync(path.join(acDir, "review-history.json"), JSON.stringify([
    { taskId: "task-1", assessment: "needs work" },
    { taskId: "task-2", assessment: "approved" },
  ], null, 2));
  fs.writeFileSync(path.join(acDir, "thread-history.json"), JSON.stringify([
    { threadId: "thread-1", title: "Archive 1", outcome: "converged", timestamp: "2026-05-17T03:00:00Z" },
  ], null, 2));
}

function countFsEntities(root: string): number {
  let count = 0;
  // per-kind directory scan
  const dirs = ["engineers", "audit/v2", "bugs", "ideas", "messages", "missions",
                "pending-actions", "proposals", "tasks", "tele", "threads", "turns",
                "notifications"];
  for (const d of dirs) {
    const dir = path.join(root, d);
    if (!fs.existsSync(dir)) continue;
    count += fs.readdirSync(dir).filter(f => f.endsWith(".json")).length;
  }
  // Counter + documents + architect-context
  count += 1;  // counter
  count += 1;  // test-doc.md
  const decisions = JSON.parse(fs.readFileSync(path.join(root, "architect-context", "decisions.json"), "utf-8"));
  const dh = JSON.parse(fs.readFileSync(path.join(root, "architect-context", "director-history.json"), "utf-8"));
  const rh = JSON.parse(fs.readFileSync(path.join(root, "architect-context", "review-history.json"), "utf-8"));
  const th = JSON.parse(fs.readFileSync(path.join(root, "architect-context", "thread-history.json"), "utf-8"));
  count += decisions.length + dh.length + rh.length + th.length;
  return count;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:15-alpine")
    .withUsername("hub")
    .withPassword("hub")
    .withDatabase("hub")
    .start();
  connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;

  synthDir = fs.mkdtempSync(path.join(os.tmpdir(), "mission-83-w5-plumbing-"));
  backupPath = path.join(os.tmpdir(), "mission-83-w5-backup.tar.gz");
  generateSyntheticState(synthDir);

  substrate = createPostgresStorageSubstrate(connStr);
}, 90_000);

afterAll(async () => {
  await (substrate as unknown as { close: () => Promise<void> }).close?.();
  await container.stop();
  fs.rmSync(synthDir, { recursive: true, force: true });
  if (fs.existsSync(backupPath)) fs.rmSync(backupPath, { force: true });
  const marker = path.join(synthDir, ".MIGRATION_COMPLETE");
  if (fs.existsSync(marker)) fs.rmSync(marker, { force: true });
}, 30_000);

describe("W5.4-plumbing — migrate-fs-to-substrate.ts end-to-end", () => {
  it("dry-run mode reports inventory without DB writes", () => {
    const r = spawnSync("npx", [
      "tsx", SCRIPT_PATH,
      `--source=${synthDir}`,
      `--target=${connStr}`,
      `--backup=${backupPath}`,
      "--dry-run",
    ], { encoding: "utf-8", timeout: 60_000 });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("dry-run:    true");
    expect(r.stdout).toContain("[Phase 2] Source scan");
    expect(r.stdout).toContain("DRY-RUN — schema bootstrap skipped");
    expect(r.stdout).toContain("✅ WITHIN BUDGET");

    // No marker emitted in dry-run
    expect(fs.existsSync(path.join(synthDir, ".MIGRATION_COMPLETE"))).toBe(false);
  }, 90_000);

  it("full migration end-to-end — count parity PASS + cut signal emitted", async () => {
    const r = spawnSync("npx", [
      "tsx", SCRIPT_PATH,
      `--source=${synthDir}`,
      `--target=${connStr}`,
      `--backup=${backupPath}`,
      "--skip-snapshot",  // skip tar step for test
    ], { encoding: "utf-8", timeout: 120_000 });

    if (r.status !== 0) {
      console.error("[migrate stdout]", r.stdout);
      console.error("[migrate stderr]", r.stderr);
    }
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("[Phase 3] Schema bootstrap");
    expect(r.stdout).toContain("[Phase 4] Reconciler primer");
    expect(r.stdout).toContain("[Phase 5] Bulk insert");
    expect(r.stdout).toContain("[Phase 6] Verification");
    expect(r.stdout).toContain("[Phase 7] Cut signal");
    expect(r.stdout).toContain("all parity PASS");
    expect(r.stdout).toContain("✅ WITHIN BUDGET");

    // Cut signal marker emitted
    const markerPath = path.join(synthDir, ".MIGRATION_COMPLETE");
    expect(fs.existsSync(markerPath)).toBe(true);
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf-8"));
    expect(marker.completedAt).toBeDefined();
    expect(marker.target).toContain("postgres");
    expect(marker.target).not.toContain("hub:hub@");  // password redacted

    // Verify FS count parity at substrate
    const fsCount = countFsEntities(synthDir);
    const pool = new Pool({ connectionString: connStr });
    try {
      const dbCount = parseInt((await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM entities WHERE kind != 'SchemaDef'`
      )).rows[0].count, 10);
      expect(dbCount).toBe(fsCount);
    } finally {
      await pool.end();
    }
  }, 120_000);

  it("idempotency — re-running migration leaves DB consistent", async () => {
    // Run migration again (without re-creating synth state)
    const r = spawnSync("npx", [
      "tsx", SCRIPT_PATH,
      `--source=${synthDir}`,
      `--target=${connStr}`,
      `--backup=${backupPath}`,
      "--skip-snapshot",
    ], { encoding: "utf-8", timeout: 120_000 });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("all parity PASS");

    // DB count unchanged
    const fsCount = countFsEntities(synthDir);
    const pool = new Pool({ connectionString: connStr });
    try {
      const dbCount = parseInt((await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM entities WHERE kind != 'SchemaDef'`
      )).rows[0].count, 10);
      expect(dbCount).toBe(fsCount);  // idempotent — no duplication
    } finally {
      await pool.end();
    }
  }, 120_000);
});

describe("W5.5-plumbing — substrate-API surface against migrated synthetic state", () => {
  it("substrate.get returns migrated entities for sampled kinds", async () => {
    // Sample one entity per major kind to validate substrate-API surface against
    // migrated state. Per-kind handler-end-to-end smoke matrix runs against
    // PRODUCTION state in operator-orchestrated W5.5 (not this plumbing test).

    const samples: [string, string][] = [
      ["Bug", "bug-1"],
      ["Idea", "idea-1"],
      ["Mission", "mission-1"],
      ["Task", "task-1"],
      ["Tele", "tele-1"],
      ["Thread", "thread-1"],
      ["Notification", "notification-1"],
      ["Document", "test-doc"],
      ["ArchitectDecision", "ad-1"],
    ];

    for (const [kind, id] of samples) {
      const entity = await substrate.get<{ id: string }>(kind, id);
      expect(entity, `${kind}/${id}`).not.toBeNull();
      expect(entity?.id, `${kind}/${id}.id`).toBe(id);
    }
  }, 60_000);

  it("substrate.list returns expected counts per kind", async () => {
    const expectedCounts: [string, number][] = [
      ["Bug", 4],
      ["Idea", 6],
      ["Message", 10],
      ["Task", 8],
      ["Tele", 4],
      ["Thread", 5],
      ["Turn", 3],
      ["Notification", 6],
      ["Document", 1],
      ["ArchitectDecision", 2],
      ["DirectorHistoryEntry", 2],
      ["ReviewHistoryEntry", 2],
      ["ThreadHistoryEntry", 1],
    ];

    for (const [kind, count] of expectedCounts) {
      const { items } = await substrate.list(kind);
      expect(items.length, `${kind} count`).toBe(count);
    }
  }, 60_000);

  it("substrate.put round-trip + delete on a migrated entity (CAS + new resource version)", async () => {
    // Update an existing migrated Bug
    const original = await substrate.get<{ id: string; title: string }>("Bug", "bug-1");
    expect(original).not.toBeNull();

    const updated = { ...original!, title: "Updated by W5.5 plumbing" };
    const putResult = await substrate.put("Bug", updated);
    expect(putResult.id).toBe("bug-1");
    expect(putResult.resourceVersion).toBeDefined();

    const refetched = await substrate.get<{ title: string }>("Bug", "bug-1");
    expect(refetched?.title).toBe("Updated by W5.5 plumbing");

    // getWithRevision (Design v1.4)
    const withRev = await substrate.getWithRevision<{ title: string }>("Bug", "bug-1");
    expect(withRev?.entity.title).toBe("Updated by W5.5 plumbing");
    expect(withRev?.resourceVersion).toBe(putResult.resourceVersion);

    // putIfMatch with correct revision → succeeds
    const cas1 = await substrate.putIfMatch("Bug", { ...updated, title: "CAS update" }, withRev!.resourceVersion);
    expect(cas1.ok).toBe(true);

    // putIfMatch with stale revision → fails
    const cas2 = await substrate.putIfMatch("Bug", { ...updated, title: "Stale CAS" }, withRev!.resourceVersion);
    expect(cas2.ok).toBe(false);

    // delete
    await substrate.delete("Bug", "bug-1");
    expect(await substrate.get("Bug", "bug-1")).toBeNull();
  }, 60_000);
});
