#!/usr/bin/env tsx
/**
 * mission-83 W5.1 — migrate-fs-to-substrate (production-class)
 *
 * State-migration script: FS Hub state → postgres HubStorageSubstrate.
 *
 * Promoted from W0.3 spike `hub/spike/W0/migrate-spike.js` (10k synthetic entities
 * in 1.83s validated; 58.17s headroom vs 60s budget per Design §3.5).
 *
 * 7-phase sequence per Design §3.1:
 *   1. Pre-cutover snapshot — `tar -czf <backup> <source>` of source state-tree
 *   2. Source scan — walk source/ + auxiliary files; build per-kind entity inventory
 *   3. Schema bootstrap — create entities table + sequence + base indexes
 *   4. Reconciler primer — apply all SchemaDefs; ensure per-kind expression indexes
 *      exist (CREATE INDEX CONCURRENTLY IF NOT EXISTS)
 *   5. Bulk insert per-kind via batched INSERT with ON CONFLICT DO UPDATE (idempotent
 *      per Design §3.3 entity-id last-write-wins; supports --resume-from)
 *   6. Verification — count parity (FS vs DB) + content-hash spot-check on random
 *      sample per kind
 *   7. Cut signal — emit `.MIGRATION_COMPLETE` marker file at source
 *
 * Usage:
 *   npm run migrate-fs-to-substrate -- \
 *     --source=<fs-path>           (required; FS state-tree root, e.g., local-state/)
 *     --target=<postgres-conn>     (required; e.g., postgres://hub:hub@localhost:5432/hub)
 *     --backup=<snapshot-path>     (required; tarball output path)
 *     [--dry-run]                  (skip phases 1, 5, 7; report what WOULD be migrated)
 *     [--resume-from=<kind>]       (skip phases 1-4; resume bulk-insert at given kind)
 *     [--skip-snapshot]            (skip phase 1; for cases where snapshot already exists)
 *     [--verbose]                  (per-entity logging)
 *
 * Idempotency per Design §3.3: ON CONFLICT (kind, id) DO UPDATE preserves
 * resource_version bumps; re-running mid-migration safe.
 *
 * 20-kind coverage per entity-kinds.json v1.1 (LOCKED):
 *   - 12 existing substrate-mediated (Agent/Audit/Bug/Idea/Message/Mission/
 *     PendingAction/Proposal/Task/Tele/Thread/Turn) — per-kind directory scan
 *   - Counter (special-case single-file at meta/counter.json)
 *   - SchemaDef (substrate-native — NOT migrated from FS)
 *   - Notification (re-introduced per OQ8; notifications/notif-*.json)
 *   - Document (nested documents/<category>/*.md)
 *   - 4 architect-context decomposition kinds (ArchitectDecision/DirectorHistoryEntry/
 *     ReviewHistoryEntry/ThreadHistoryEntry) — single-file array decomposition
 */

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import pg from "pg";
import {
  createPostgresStorageSubstrate,
  createSchemaReconciler,
  ALL_SCHEMAS,
  type HubStorageSubstrate,
  type SchemaReconciler,
} from "../src/storage-substrate/index.js";

const { Pool } = pg;

// ── CLI parsing ──────────────────────────────────────────────────────────────

interface CliArgs {
  source: string;
  target: string;
  backup: string;
  dryRun: boolean;
  resumeFrom?: string;
  skipSnapshot: boolean;
  verbose: boolean;
}

function parseCli(): CliArgs {
  const argv = process.argv.slice(2);
  const args: Partial<CliArgs> = { dryRun: false, skipSnapshot: false, verbose: false };

  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--skip-snapshot") args.skipSnapshot = true;
    else if (arg === "--verbose") args.verbose = true;
    else if (arg.startsWith("--source=")) args.source = arg.slice("--source=".length);
    else if (arg.startsWith("--target=")) args.target = arg.slice("--target=".length);
    else if (arg.startsWith("--backup=")) args.backup = arg.slice("--backup=".length);
    else if (arg.startsWith("--resume-from=")) args.resumeFrom = arg.slice("--resume-from=".length);
    else {
      console.error(`[migrate] unknown arg: ${arg}`);
      printUsage();
      process.exit(2);
    }
  }

  if (!args.source || !args.target || !args.backup) {
    console.error("[migrate] missing required args");
    printUsage();
    process.exit(2);
  }

  return args as CliArgs;
}

function printUsage(): void {
  console.error(`
Usage: tsx hub/scripts/migrate-fs-to-substrate.ts \\
  --source=<fs-path>           FS state-tree root (e.g., local-state)
  --target=<postgres-conn>     postgres://user:pass@host:port/db
  --backup=<snapshot-path>     tarball output path
  [--dry-run]                  report what WOULD be migrated; no writes
  [--resume-from=<kind>]       resume bulk-insert at given kind
  [--skip-snapshot]            skip phase 1 (snapshot already exists)
  [--verbose]                  per-entity logging
`);
}

// ── Per-kind FS-scan dispatch ────────────────────────────────────────────────

interface KindEntry {
  kind: string;
  id: string;
  data: unknown;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Per-kind FS-layout mapping per entity-kinds.json v1.1.
 * Each entry is a function that walks the source-relative path + emits KindEntry[].
 */
type KindScanner = (sourceRoot: string) => Promise<KindEntry[]>;

const KIND_SCANNERS: Record<string, KindScanner> = {
  // ── Per-kind directory scan (12 existing-substrate-mediated) ────────────
  Agent: dirScanner("Agent", "engineers"),
  Audit: dirScanner("Audit", "audit/v2"),
  Bug: dirScanner("Bug", "bugs"),
  Idea: dirScanner("Idea", "ideas"),
  Message: dirScanner("Message", "messages"),
  Mission: dirScanner("Mission", "missions"),
  PendingAction: dirScanner("PendingAction", "pending-actions"),
  Proposal: dirScanner("Proposal", "proposals"),
  Task: dirScanner("Task", "tasks"),
  Tele: dirScanner("Tele", "tele"),
  Thread: dirScanner("Thread", "threads"),
  Turn: dirScanner("Turn", "turns"),

  // ── Counter (special-case single-file) ────────────────────────────────
  Counter: async (sourceRoot) => {
    const counterPath = path.join(sourceRoot, "meta", "counter.json");
    if (!fs.existsSync(counterPath)) return [];
    const data = JSON.parse(fs.readFileSync(counterPath, "utf-8"));
    return [{
      kind: "Counter",
      id: "counter",
      data: { id: "counter", ...data },
    }];
  },

  // ── Notification (re-introduced per OQ8) ──────────────────────────────
  Notification: dirScanner("Notification", "notifications"),

  // ── Document (nested by category) ─────────────────────────────────────
  Document: async (sourceRoot) => {
    const docsRoot = path.join(sourceRoot, "documents");
    if (!fs.existsSync(docsRoot)) return [];
    const out: KindEntry[] = [];
    const categories = fs.readdirSync(docsRoot, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    for (const category of categories) {
      const catDir = path.join(docsRoot, category);
      const files = fs.readdirSync(catDir).filter(f => f.endsWith(".md"));
      for (const file of files) {
        const id = file.replace(/\.md$/, "");
        const content = fs.readFileSync(path.join(catDir, file), "utf-8");
        out.push({
          kind: "Document",
          id,
          data: { id, category, content },
        });
      }
    }
    return out;
  },

  // ── Architect-context decomposition (4 kinds; JSON-array source) ──────
  ArchitectDecision: arrayDecompositionScanner(
    "ArchitectDecision",
    "architect-context/decisions.json",
    (entry, idx) => `ad-${idx + 1}`,
  ),
  DirectorHistoryEntry: arrayDecompositionScanner(
    "DirectorHistoryEntry",
    "architect-context/director-history.json",
    (entry, idx) => `dh-${idx + 1}`,
  ),
  ReviewHistoryEntry: arrayDecompositionScanner(
    "ReviewHistoryEntry",
    "architect-context/review-history.json",
    (entry, idx) => `rh-${idx + 1}`,
  ),
  ThreadHistoryEntry: arrayDecompositionScanner(
    "ThreadHistoryEntry",
    "architect-context/thread-history.json",
    (entry, idx) => `th-${idx + 1}`,
  ),
};

// SchemaDef is substrate-native (reconciler bootstraps); NOT in scanners.

// Migration order per Design §3.4 — Counter first (so SubstrateCounter has
// values to allocate from), then leaf-entities, then graph-entities last.
const KIND_ORDER = [
  "Counter",
  "Agent", "Tele",
  "Audit", "Notification",
  "Bug", "Idea", "Mission", "Task", "Proposal", "Turn",
  "PendingAction",
  "Thread", "Message",
  "Document",
  "ArchitectDecision", "DirectorHistoryEntry", "ReviewHistoryEntry", "ThreadHistoryEntry",
];

// ── Scanner helpers ──────────────────────────────────────────────────────────

function dirScanner(kind: string, dirSuffix: string): KindScanner {
  return async (sourceRoot) => {
    const kindDir = path.join(sourceRoot, dirSuffix);
    if (!fs.existsSync(kindDir)) return [];
    const out: KindEntry[] = [];
    walkJsonFiles(kindDir).forEach((fpath) => {
      try {
        const json = fs.readFileSync(fpath, "utf-8");
        const entity = JSON.parse(json);
        const id = entity.id || path.basename(fpath, ".json");
        out.push({
          kind,
          id,
          data: entity,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt,
        });
      } catch (err) {
        console.warn(`[scan] ${kind}: skipped malformed ${fpath}: ${(err as Error).message}`);
      }
    });
    return out;
  };
}

function arrayDecompositionScanner(
  kind: string,
  relativePath: string,
  idFn: (entry: Record<string, unknown>, idx: number) => string,
): KindScanner {
  return async (sourceRoot) => {
    const filePath = path.join(sourceRoot, relativePath);
    if (!fs.existsSync(filePath)) return [];
    const arr = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!Array.isArray(arr)) {
      console.warn(`[scan] ${kind}: ${relativePath} not an array; skipping`);
      return [];
    }
    return arr.map((entry, idx) => {
      const id = idFn(entry, idx);
      return {
        kind,
        id,
        data: { id, ...entry },
        createdAt: entry.timestamp as string | undefined,
      };
    });
  };
}

function walkJsonFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith(".json")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

// ── Phase implementations ────────────────────────────────────────────────────

async function phase1_snapshot(args: CliArgs): Promise<void> {
  if (args.dryRun || args.skipSnapshot) {
    console.log("[Phase 1] snapshot SKIPPED (--dry-run or --skip-snapshot)");
    return;
  }
  console.log(`[Phase 1] Pre-cutover snapshot: tar -czf ${args.backup} ${args.source}`);
  const t0 = performance.now();
  const r = spawnSync("tar", ["-czf", args.backup, args.source], { encoding: "utf-8" });
  if (r.status !== 0) {
    throw new Error(`tar failed: ${r.stderr || r.stdout}`);
  }
  const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
  const sizeMB = (fs.statSync(args.backup).size / (1024 * 1024)).toFixed(2);
  console.log(`     [done] snapshot=${args.backup} size=${sizeMB}MB elapsed=${elapsed}s`);
}

async function phase2_scan(args: CliArgs): Promise<Map<string, KindEntry[]>> {
  console.log(`[Phase 2] Source scan: ${args.source}`);
  const t0 = performance.now();
  const inventory = new Map<string, KindEntry[]>();
  for (const kind of KIND_ORDER) {
    const scanner = KIND_SCANNERS[kind];
    if (!scanner) {
      console.warn(`     [warn] no scanner registered for kind=${kind}`);
      continue;
    }
    const entries = await scanner(args.source);
    inventory.set(kind, entries);
    console.log(`     ${kind.padEnd(22)} count=${entries.length.toString().padStart(6)}`);
  }
  const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
  const total = Array.from(inventory.values()).reduce((s, a) => s + a.length, 0);
  console.log(`     [done] total entities=${total} elapsed=${elapsed}s`);
  return inventory;
}

async function phase3_schemaBootstrap(args: CliArgs): Promise<void> {
  console.log("[Phase 3] Schema bootstrap (entities table + sequence + base indexes)");
  const t0 = performance.now();
  if (args.dryRun) {
    console.log("     [Phase 3] DRY-RUN — schema bootstrap skipped");
    return;
  }
  const pool = new Pool({ connectionString: args.target });
  try {
    // Idempotent — only create if not exists; do NOT drop existing data
    await pool.query(`
      CREATE SEQUENCE IF NOT EXISTS entities_rv_seq;
      CREATE TABLE IF NOT EXISTS entities (
        kind             TEXT NOT NULL,
        id               TEXT NOT NULL,
        data             JSONB NOT NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resource_version BIGINT NOT NULL DEFAULT nextval('entities_rv_seq'),
        PRIMARY KEY (kind, id)
      );
      CREATE INDEX IF NOT EXISTS entities_rv_idx ON entities (resource_version);
      CREATE INDEX IF NOT EXISTS entities_updated_at_idx ON entities (updated_at);
    `);
  } finally {
    await pool.end();
  }
  console.log(`     [done] elapsed=${((performance.now() - t0) / 1000).toFixed(2)}s`);
}

async function phase4_reconcilerPrimer(args: CliArgs): Promise<void> {
  console.log("[Phase 4] Reconciler primer (apply ALL_SCHEMAS; per-kind indexes)");
  const t0 = performance.now();
  if (args.dryRun) {
    console.log("     [Phase 4] DRY-RUN — reconciler primer skipped");
    return;
  }
  const substrate: HubStorageSubstrate = createPostgresStorageSubstrate(args.target);
  const reconciler: SchemaReconciler = createSchemaReconciler(substrate, args.target, {
    initialSchemas: ALL_SCHEMAS,
    log: (msg: string) => args.verbose && console.log(`     [reconciler] ${msg}`),
    warn: (msg: string) => console.warn(`     [reconciler-warn] ${msg}`),
  });
  try {
    await reconciler.start();
    console.log(`     [done] ${ALL_SCHEMAS.length} SchemaDefs applied; elapsed=${((performance.now() - t0) / 1000).toFixed(2)}s`);
  } finally {
    await reconciler.close();
    await (substrate as unknown as { close: () => Promise<void> }).close?.();
  }
}

async function phase5_bulkInsert(
  args: CliArgs,
  inventory: Map<string, KindEntry[]>,
): Promise<{ perKind: Record<string, { count: number; ms: number }>; total: number }> {
  console.log("[Phase 5] Bulk insert (per-kind batched INSERT with ON CONFLICT DO UPDATE)");
  const t0 = performance.now();
  if (args.dryRun) {
    console.log("     [Phase 5] DRY-RUN — bulk insert skipped");
    const perKind: Record<string, { count: number; ms: number }> = {};
    let total = 0;
    for (const [kind, entries] of inventory.entries()) {
      perKind[kind] = { count: entries.length, ms: 0 };
      total += entries.length;
    }
    return { perKind, total };
  }

  const pool = new Pool({ connectionString: args.target });
  const perKind: Record<string, { count: number; ms: number }> = {};
  let total = 0;
  let skipUntil = args.resumeFrom;

  try {
    for (const kind of KIND_ORDER) {
      const entries = inventory.get(kind) ?? [];
      if (entries.length === 0) {
        if (args.verbose) console.log(`     [skip] ${kind}: empty`);
        continue;
      }
      if (skipUntil && kind !== skipUntil) {
        console.log(`     [resume-skip] ${kind}: skipped per --resume-from=${skipUntil}`);
        continue;
      }
      skipUntil = undefined;  // resume-point reached; continue normally

      const tk = performance.now();
      // Batched INSERT with ON CONFLICT DO UPDATE for idempotency.
      // pg-pool max query size is configurable; use 100-entity batches.
      const BATCH = 100;
      for (let i = 0; i < entries.length; i += BATCH) {
        const batch = entries.slice(i, i + BATCH);
        const values: string[] = [];
        const params: unknown[] = [];
        let p = 1;
        for (const entry of batch) {
          values.push(`($${p++}, $${p++}, $${p++}::jsonb, $${p++}::timestamptz, $${p++}::timestamptz)`);
          params.push(
            entry.kind,
            entry.id,
            JSON.stringify(entry.data),
            entry.createdAt ?? new Date().toISOString(),
            entry.updatedAt ?? entry.createdAt ?? new Date().toISOString(),
          );
        }
        await pool.query(
          `INSERT INTO entities (kind, id, data, created_at, updated_at) VALUES ${values.join(",")}
           ON CONFLICT (kind, id) DO UPDATE
             SET data = EXCLUDED.data,
                 updated_at = EXCLUDED.updated_at,
                 resource_version = nextval('entities_rv_seq')`,
          params,
        );
      }
      const ms = performance.now() - tk;
      perKind[kind] = { count: entries.length, ms };
      total += entries.length;
      console.log(`     ${kind.padEnd(22)} count=${entries.length.toString().padStart(6)}  elapsed=${(ms / 1000).toFixed(2)}s  rate=${Math.round(entries.length / (ms / 1000))}/s`);
    }
  } finally {
    await pool.end();
  }
  const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
  console.log(`     [done] total=${total} elapsed=${elapsed}s`);
  return { perKind, total };
}

async function phase6_verification(
  args: CliArgs,
  inventory: Map<string, KindEntry[]>,
): Promise<{ ok: boolean; details: string }> {
  console.log("[Phase 6] Verification (count parity + content-hash spot-check)");
  const t0 = performance.now();
  if (args.dryRun) {
    console.log("     [Phase 6] DRY-RUN — verification skipped");
    return { ok: true, details: "dry-run" };
  }

  const pool = new Pool({ connectionString: args.target });
  let allOk = true;
  const failures: string[] = [];
  try {
    for (const kind of KIND_ORDER) {
      const fsEntries = inventory.get(kind) ?? [];
      const r = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM entities WHERE kind = $1`,
        [kind],
      );
      const dbCount = parseInt(r.rows[0]?.count ?? "0", 10);
      const fsCount = fsEntries.length;
      const parity = dbCount === fsCount;
      if (!parity) {
        allOk = false;
        failures.push(`${kind}: FS=${fsCount} DB=${dbCount}`);
      }
      console.log(`     ${kind.padEnd(22)} FS=${fsCount.toString().padStart(6)} DB=${dbCount.toString().padStart(6)} ${parity ? "✓" : "✗"}`);

      // Content-hash spot-check on up to 3 random entities per kind
      if (parity && fsCount > 0) {
        const sampleSize = Math.min(3, fsCount);
        const samples = pickRandom(fsEntries, sampleSize);
        for (const sample of samples) {
          const dbR = await pool.query<{ data: unknown }>(
            `SELECT data FROM entities WHERE kind = $1 AND id = $2`,
            [sample.kind, sample.id],
          );
          const dbData = dbR.rows[0]?.data;
          const fsHash = hashContent(sample.data);
          const dbHash = hashContent(dbData);
          if (fsHash !== dbHash) {
            allOk = false;
            failures.push(`${kind}/${sample.id}: content-hash mismatch (FS=${fsHash.slice(0, 8)} DB=${dbHash.slice(0, 8)})`);
          }
        }
      }
    }
  } finally {
    await pool.end();
  }
  const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
  const details = allOk ? "all parity PASS" : `${failures.length} failures: ${failures.slice(0, 5).join("; ")}`;
  console.log(`     [done] ${details}  elapsed=${elapsed}s`);
  return { ok: allOk, details };
}

async function phase7_cutSignal(args: CliArgs): Promise<void> {
  console.log("[Phase 7] Cut signal (.MIGRATION_COMPLETE marker)");
  if (args.dryRun) {
    console.log("     [Phase 7] DRY-RUN — cut signal skipped");
    return;
  }
  const markerPath = path.join(args.source, ".MIGRATION_COMPLETE");
  fs.writeFileSync(markerPath, JSON.stringify({
    completedAt: new Date().toISOString(),
    target: args.target.replace(/:[^:@]+@/, ":***@"),  // redact password
    backup: args.backup,
  }, null, 2));
  console.log(`     [done] marker=${markerPath}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pickRandom<T>(arr: T[], n: number): T[] {
  const indices = new Set<number>();
  while (indices.size < Math.min(n, arr.length)) {
    indices.add(Math.floor(Math.random() * arr.length));
  }
  return Array.from(indices).map((i) => arr[i]);
}

function hashContent(data: unknown): string {
  const canonical = JSON.stringify(data, Object.keys(data as object).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseCli();

  console.log("");
  console.log("=".repeat(78));
  console.log("mission-83 W5 — migrate-fs-to-substrate (production)");
  console.log("=".repeat(78));
  console.log(`source:     ${args.source}`);
  console.log(`target:     ${args.target.replace(/:[^:@]+@/, ":***@")}`);
  console.log(`backup:     ${args.backup}`);
  console.log(`dry-run:    ${args.dryRun}`);
  console.log(`resume-from: ${args.resumeFrom ?? "(none)"}`);
  console.log("");

  const TOTAL_T0 = performance.now();

  if (!args.resumeFrom) {
    await phase1_snapshot(args);
    console.log("");
  }

  const inventory = await phase2_scan(args);
  console.log("");

  if (!args.resumeFrom) {
    await phase3_schemaBootstrap(args);
    console.log("");

    await phase4_reconcilerPrimer(args);
    console.log("");
  } else {
    console.log("[Phase 3+4] SKIPPED per --resume-from");
    console.log("");
  }

  const insertResult = await phase5_bulkInsert(args, inventory);
  console.log("");

  const verifyResult = await phase6_verification(args, inventory);
  console.log("");

  if (verifyResult.ok) {
    await phase7_cutSignal(args);
    console.log("");
  } else {
    console.error("[Phase 7] SKIPPED — verification FAILED; cut signal not emitted");
    console.error(`           ${verifyResult.details}`);
  }

  const TOTAL_ELAPSED_S = (performance.now() - TOTAL_T0) / 1000;

  console.log("=".repeat(78));
  console.log("TOTAL OBSERVED DOWNTIME measurement");
  console.log("=".repeat(78));
  console.log(`Total wall-clock:               ${TOTAL_ELAPSED_S.toFixed(2)}s`);
  console.log(`Design v1.x §3.5 budget:        <60s TOTAL OBSERVED DOWNTIME`);
  console.log(`Result:                         ${TOTAL_ELAPSED_S < 60 ? "✅ WITHIN BUDGET" : "❌ EXCEEDS BUDGET"}`);
  console.log(`Headroom:                       ${(60 - TOTAL_ELAPSED_S).toFixed(2)}s`);
  console.log(`Verification:                   ${verifyResult.ok ? "PASS" : "FAIL — " + verifyResult.details}`);
  console.log(`Total entities migrated:        ${insertResult.total}`);
  console.log("");
  console.log("Per-kind breakdown:");
  for (const kind of KIND_ORDER) {
    const stats = insertResult.perKind[kind];
    if (!stats) continue;
    console.log(`  ${kind.padEnd(22)}  count=${stats.count.toString().padStart(6)}  elapsed=${(stats.ms / 1000).toFixed(3)}s`);
  }
  console.log("");

  process.exit(verifyResult.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`[migrate] FATAL: ${(err as Error).message}`);
  console.error((err as Error).stack);
  process.exit(1);
});
