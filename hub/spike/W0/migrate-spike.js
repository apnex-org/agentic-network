#!/usr/bin/env node
// mission-83 W0 spike — synthetic-state migration measurement script
//
// Reads <SYNTH_DIR>/<kind-dir>/<id>.json files, generates COPY-format TSV,
// pipes to psql via docker exec, measures TOTAL OBSERVED DOWNTIME wall-clock.
// Per Design v1.1 §3.5 — verifies <60s budget against ~10k-entity dataset.
//
// Pipeline phases (per Design §3.1):
//   1. Pre-cutover snapshot (skipped in spike; not load-bearing for measurement)
//   2. Source scan — walk SYNTH_DIR; build entity inventory
//   3. Schema bootstrap — CREATE TABLE entities
//   4. Bulk insert — COPY FROM STDIN
//   5. Verification — count parity check
//
// Usage:
//   node hub/spike/W0/migrate-spike.js [SYNTH_DIR] [POSTGRES_CONTAINER]
//   (defaults: SYNTH_DIR=/tmp/synth-state, POSTGRES_CONTAINER=hub-substrate-postgres)

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync, spawn } from "node:child_process";

const SYNTH_DIR = process.argv[2] || "/tmp/synth-state";
const POSTGRES_CONTAINER = process.argv[3] || "hub-substrate-postgres";

// Per entity-kinds.json v1.1 — kind → local-state-dir map for FS scan
const KIND_DIRS = [
  ["Message", "messages"], ["Thread", "threads"], ["PendingAction", "pending-actions"],
  ["Audit", "audit/v2"], ["Tele", "tele"], ["Turn", "turns"], ["Mission", "missions"],
  ["Task", "tasks"], ["Idea", "ideas"], ["Bug", "bugs"], ["Proposal", "proposals"],
  ["Agent", "engineers"], ["Counter", "meta"],
];

function pexec(args, opts = {}) {
  return spawnSync("docker", ["exec", "-i", POSTGRES_CONTAINER, ...args], { encoding: "utf-8", ...opts });
}

function psqlExec(sql) {
  const r = pexec(["psql", "-U", "hub", "-d", "hub", "-tA", "-c", sql]);
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

console.log("");
console.log("=".repeat(72));
console.log(`mission-83 W0.3 spike — synthetic-state migration <60s measurement`);
console.log("=".repeat(72));
console.log(`SYNTH_DIR:           ${SYNTH_DIR}`);
console.log(`POSTGRES_CONTAINER:  ${POSTGRES_CONTAINER}`);
console.log("");

// ═══ Phase 1: Pre-cutover snapshot (skipped in spike; not load-bearing) ═══

// ═══ Phase 0: T+00:00 — start TOTAL OBSERVED DOWNTIME timer ═══
const T0 = performance.now();

// ═══ Phase 3: Schema bootstrap (substrate-init migration) ═══
console.log("[T+0] Phase 3 — Schema bootstrap (DROP+CREATE entities table; substrate-init migration)");
const t3 = performance.now();

// Idempotent setup: drop + recreate for spike-repeatability
psqlExec(`
DROP TABLE IF EXISTS entities CASCADE;
DROP SEQUENCE IF EXISTS entities_rv_seq;
CREATE SEQUENCE entities_rv_seq;
CREATE TABLE entities (
  kind             TEXT NOT NULL,
  id               TEXT NOT NULL,
  data             JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resource_version BIGINT NOT NULL DEFAULT nextval('entities_rv_seq'),
  PRIMARY KEY (kind, id)
);
CREATE INDEX entities_rv_idx ON entities (resource_version);
CREATE INDEX entities_updated_at_idx ON entities (updated_at);
`);

const t3Elapsed = performance.now() - t3;
console.log(`     [Phase 3 done — ${(t3Elapsed/1000).toFixed(2)}s]`);

// ═══ Phase 2: Source scan + Phase 4: Bulk insert (interleaved per-kind via COPY) ═══
console.log("");
console.log("[T+" + ((performance.now()-T0)/1000).toFixed(2) + "] Phase 2+4 — Source scan + Bulk insert (per-kind COPY FROM STDIN)");

let totalEntities = 0;
const perKindMs = {};

for (const [kind, dir] of KIND_DIRS) {
  const kindDir = path.join(SYNTH_DIR, dir);
  if (!fs.existsSync(kindDir)) {
    console.log(`     [skip] ${kind}: dir not present (${kindDir})`);
    continue;
  }

  const tk = performance.now();

  // Scan kind-dir + build COPY input (one TSV row per file)
  const files = fs.readdirSync(kindDir).filter(f => f.endsWith('.json'));

  // COPY format: kind \t id \t data (JSONB) \t created_at \t updated_at
  // Escape tabs/newlines in data (JSONB single-line; postgres COPY default delimiters)
  const lines = [];
  for (const file of files) {
    const fpath = path.join(kindDir, file);
    const json = fs.readFileSync(fpath, "utf-8");
    const entity = JSON.parse(json);

    // For Counter (single-row meta entity), id is "counter"; else use entity.id
    const id = kind === "Counter" ? "counter" : (entity.id || file.replace('.json', ''));
    const createdAt = entity.createdAt || "2026-01-01T00:00:00.000Z";
    const updatedAt = entity.updatedAt || createdAt;
    // Compact JSON for COPY (no newlines in data column)
    const dataCompact = JSON.stringify(entity).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

    lines.push(`${kind}\t${id}\t${dataCompact}\t${createdAt}\t${updatedAt}`);
  }

  // Stream COPY input via docker exec stdin
  const copyInput = lines.join('\n') + '\n';
  const copyProc = spawnSync("docker", ["exec", "-i", POSTGRES_CONTAINER, "psql", "-U", "hub", "-d", "hub", "-c",
    "COPY entities (kind, id, data, created_at, updated_at) FROM STDIN"],
    { input: copyInput, encoding: "utf-8" });

  if (copyProc.status !== 0) {
    console.error(`     [error] ${kind} COPY failed: ${copyProc.stderr}`);
    throw new Error(`COPY failed for ${kind}`);
  }

  const tkElapsed = performance.now() - tk;
  perKindMs[kind] = { count: files.length, ms: tkElapsed };
  totalEntities += files.length;

  console.log(`     [done] ${kind.padEnd(15)} count=${files.length.toString().padStart(5)}  elapsed=${(tkElapsed/1000).toFixed(2)}s`);
}

const t4Elapsed = performance.now() - T0;
console.log("");
console.log(`[T+${(t4Elapsed/1000).toFixed(2)}] Phase 2+4 done — ${totalEntities} entities loaded`);

// ═══ Phase 5: Verification — count parity ═══
console.log("");
console.log(`[T+${((performance.now()-T0)/1000).toFixed(2)}] Phase 5 — Verification (count parity check)`);
const t5 = performance.now();

const verifyOutput = psqlExec(`SELECT kind, COUNT(*) AS count FROM entities GROUP BY kind ORDER BY kind`);
const t5Elapsed = performance.now() - t5;

console.log("     [postgres count by kind]");
console.log(verifyOutput.split('\n').map(l => `     ${l}`).join('\n'));

const totalDbCount = parseInt(psqlExec(`SELECT COUNT(*) FROM entities`));
const verifyPass = totalDbCount === totalEntities;
console.log("");
console.log(`     [verify] FS=${totalEntities}  DB=${totalDbCount}  parity=${verifyPass ? 'PASS' : 'FAIL'}`);
console.log(`     [Phase 5 done — ${(t5Elapsed/1000).toFixed(2)}s]`);

// ═══ Phase 6: Smoke (LISTEN/NOTIFY trigger emit on insert) ═══
// (Skipped — trigger not created in spike-shell entities table; W1+ adds NOTIFY trigger)

// ═══ TOTAL OBSERVED DOWNTIME ═══
const TOTAL_ELAPSED_MS = performance.now() - T0;

console.log("");
console.log("=".repeat(72));
console.log(`TOTAL OBSERVED DOWNTIME measurement`);
console.log("=".repeat(72));
console.log(`Phase 3 schema bootstrap:       ${(t3Elapsed/1000).toFixed(2)}s`);
console.log(`Phase 2+4 scan + COPY (10k):    ${((t4Elapsed - t3Elapsed)/1000).toFixed(2)}s`);
console.log(`Phase 5 verification:           ${(t5Elapsed/1000).toFixed(2)}s`);
console.log(`────────────────────────────────────`);
console.log(`Total wall-clock:               ${(TOTAL_ELAPSED_MS/1000).toFixed(2)}s`);
console.log("");
console.log(`Design v1.1 §3.5 budget:        <60s TOTAL OBSERVED DOWNTIME`);
console.log(`Spike measurement vs budget:    ${TOTAL_ELAPSED_MS < 60000 ? '✅ WITHIN BUDGET' : '❌ EXCEEDS BUDGET'}`);
console.log(`Headroom:                       ${((60000 - TOTAL_ELAPSED_MS)/1000).toFixed(2)}s`);
console.log(`Throughput:                     ${(totalEntities / (TOTAL_ELAPSED_MS/1000)).toFixed(0)} entities/sec`);
console.log("=".repeat(72));
console.log("");
console.log("Per-kind breakdown:");
for (const [kind, stats] of Object.entries(perKindMs)) {
  console.log(`  ${kind.padEnd(15)}  count=${stats.count.toString().padStart(5)}  elapsed=${(stats.ms/1000).toFixed(3)}s  rate=${(stats.count / (stats.ms/1000)).toFixed(0)}/s`);
}
