#!/usr/bin/env npx tsx
/**
 * mission-63 W3 — canonical envelope state migration script.
 *
 * One-shot, idempotent migration that brings persisted Agent records
 * into the shape required by mission-63's canonical wire envelope:
 *
 *   - Verify `id` field present (post-PR-#113 rename Agent.agentId →
 *     Agent.id; mission-62 P0 manual recovery already did most of these
 *     records — this script verifies + completes).
 *   - Verify `name` field present + non-null. If missing/null, set
 *     `name = id` (round-1 audit ask 3 — `globalInstanceId`-recovery is
 *     NOT viable for legacy records; verified empirically on prod state
 *     showing 4/4 records have globalInstanceId=null).
 *   - Default `clientMetadata` to {} when missing or null (legacy records
 *     pre-PR-#114 may have it null; round-1 audit observation).
 *   - Default `advisoryTags` to {} when missing or null.
 *
 * Hub-stopped self-check (round-1 audit ask 8): aborts with a clear
 * operator message if the Hub is still serving on http://localhost:8080/mcp.
 * Migration mutates state files; live Hub writes would race.
 *
 * Idempotent: re-running with already-migrated state is a no-op (each
 * operation checks present-shape before mutating).
 *
 * Backup: writes a backup tarball to /tmp before any mutation.
 *
 * Usage:
 *   OIS_ENV=prod npx tsx scripts/migrate-canonical-envelope-state.ts
 *
 * Per Design v1.0 §5.1 + §6.3 step 5 of the W3 merge sequence.
 */

import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = dirname(__dirname);
const STATE_ROOT = join(REPO_ROOT, "local-state", "agents");
const BY_FINGERPRINT_DIR = join(STATE_ROOT, "by-fingerprint");

interface AgentRecord {
  id?: string;
  name?: string | null;
  clientMetadata?: unknown;
  advisoryTags?: unknown;
  [key: string]: unknown;
}

interface MigrationStats {
  filesScanned: number;
  filesMutated: number;
  nameSet: number;
  clientMetadataDefaulted: number;
  advisoryTagsDefaulted: number;
  missingId: number;
}

async function checkHubStopped(): Promise<void> {
  // Hub-stopped guard per round-1 audit ask 8. Migration MUST NOT run
  // while the Hub is live — it would race state-file writes. Use curl
  // because spawnSync is portable and we already depend on it for
  // operator runbooks.
  const result = spawnSync(
    "curl",
    ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "2", "http://localhost:8080/mcp"],
    { encoding: "utf8" },
  );
  // curl exits non-zero on connection-refused. status is empty string OR "000".
  // 200/4xx/5xx all indicate the Hub is serving — abort.
  const httpStatus = result.stdout?.trim() ?? "";
  const exit = result.status ?? -1;
  const hubServing = exit === 0 && httpStatus !== "" && httpStatus !== "000";
  if (hubServing) {
    console.error(
      "[migrate-canonical-envelope-state] ABORT: Hub is still serving on http://localhost:8080/mcp " +
      `(HTTP ${httpStatus}). Stop the Hub first via \`OIS_ENV=prod scripts/local/stop-hub.sh\` ` +
      "before running this migration. Migration mutates persisted state files; live Hub writes would race.",
    );
    process.exit(1);
  }
  console.log("[migrate-canonical-envelope-state] Hub-stopped check passed (curl localhost:8080/mcp connection-refused).");
}

async function backupState(): Promise<string> {
  // Best-effort tarball backup; if tar fails, abort rather than risk
  // an unrecoverable mutation.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `/tmp/agents-pre-canonical-envelope-migration-${ts}.tar.gz`;
  const result = spawnSync(
    "tar",
    ["-czf", backupPath, "-C", REPO_ROOT, "local-state/agents"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    console.error(
      `[migrate-canonical-envelope-state] ABORT: backup failed (tar exit=${result.status}). stderr: ${result.stderr}`,
    );
    process.exit(1);
  }
  console.log(`[migrate-canonical-envelope-state] Backup written: ${backupPath}`);
  return backupPath;
}

async function* iterAgentFiles(): AsyncGenerator<string> {
  // Top-level agent records (eng-*.json, director-*.json)
  try {
    for (const entry of await fs.readdir(STATE_ROOT, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".json")) continue;
      // Skip orphan / preserved-old-schema sentinels
      if (entry.name.includes(".preserved-") || entry.name.includes(".orphan-")) continue;
      yield join(STATE_ROOT, entry.name);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  // Fingerprint-keyed records
  try {
    for (const entry of await fs.readdir(BY_FINGERPRINT_DIR, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".json")) continue;
      yield join(BY_FINGERPRINT_DIR, entry.name);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function migrateRecord(filePath: string, stats: MigrationStats): Promise<void> {
  stats.filesScanned += 1;
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    console.warn(`[migrate-canonical-envelope-state] WARN: read failed for ${filePath}: ${(err as Error).message}`);
    return;
  }
  let record: AgentRecord;
  try {
    record = JSON.parse(raw) as AgentRecord;
  } catch (err) {
    console.warn(`[migrate-canonical-envelope-state] WARN: parse failed for ${filePath}: ${(err as Error).message}`);
    return;
  }

  let mutated = false;

  // Verify `id` field. mission-62 P0 manual migration set this; if absent,
  // the record is irrecoverable through this script (legacy id-field aliases
  // cannot be reliably mapped without context). Surface for operator
  // attention but don't mutate.
  if (typeof record.id !== "string" || record.id === "") {
    console.warn(
      `[migrate-canonical-envelope-state] WARN: record at ${filePath} has no \`id\` field; ` +
      "skipping name/clientMetadata defaults. Operator must reconcile manually " +
      "(this should never happen post-mission-62 P0 recovery).",
    );
    stats.missingId += 1;
    return;
  }

  // `name` field provenance per round-1 audit ask 3.
  if (record.name === undefined || record.name === null || record.name === "") {
    record.name = record.id;
    stats.nameSet += 1;
    mutated = true;
  }

  // `clientMetadata` defaulting per round-1 audit observation.
  if (record.clientMetadata === undefined || record.clientMetadata === null) {
    record.clientMetadata = {};
    stats.clientMetadataDefaulted += 1;
    mutated = true;
  } else if (!isPlainObject(record.clientMetadata)) {
    // Defensive: malformed (e.g. string, number). Default to {} to match
    // the canonical envelope contract; new handshakes overwrite.
    record.clientMetadata = {};
    stats.clientMetadataDefaulted += 1;
    mutated = true;
  }

  // `advisoryTags` defaulting per round-1 audit observation.
  if (record.advisoryTags === undefined || record.advisoryTags === null) {
    record.advisoryTags = {};
    stats.advisoryTagsDefaulted += 1;
    mutated = true;
  } else if (!isPlainObject(record.advisoryTags)) {
    record.advisoryTags = {};
    stats.advisoryTagsDefaulted += 1;
    mutated = true;
  }

  if (mutated) {
    await fs.writeFile(filePath, JSON.stringify(record, null, 2) + "\n", "utf8");
    stats.filesMutated += 1;
    console.log(`[migrate-canonical-envelope-state] mutated ${filePath}`);
  }
}

async function main(): Promise<void> {
  console.log("[migrate-canonical-envelope-state] mission-63 W3 canonical envelope state migration");
  console.log(`[migrate-canonical-envelope-state] STATE_ROOT=${STATE_ROOT}`);

  await checkHubStopped();
  await backupState();

  const stats: MigrationStats = {
    filesScanned: 0,
    filesMutated: 0,
    nameSet: 0,
    clientMetadataDefaulted: 0,
    advisoryTagsDefaulted: 0,
    missingId: 0,
  };

  for await (const filePath of iterAgentFiles()) {
    await migrateRecord(filePath, stats);
  }

  console.log("[migrate-canonical-envelope-state] DONE");
  console.log(`[migrate-canonical-envelope-state]   filesScanned=${stats.filesScanned}`);
  console.log(`[migrate-canonical-envelope-state]   filesMutated=${stats.filesMutated}`);
  console.log(`[migrate-canonical-envelope-state]   nameSet=${stats.nameSet}`);
  console.log(`[migrate-canonical-envelope-state]   clientMetadataDefaulted=${stats.clientMetadataDefaulted}`);
  console.log(`[migrate-canonical-envelope-state]   advisoryTagsDefaulted=${stats.advisoryTagsDefaulted}`);
  console.log(`[migrate-canonical-envelope-state]   missingId=${stats.missingId}`);

  if (stats.missingId > 0) {
    console.warn(
      `[migrate-canonical-envelope-state] WARNING: ${stats.missingId} record(s) had no \`id\` field; ` +
      "operator must reconcile before starting Hub.",
    );
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(`[migrate-canonical-envelope-state] FATAL: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
