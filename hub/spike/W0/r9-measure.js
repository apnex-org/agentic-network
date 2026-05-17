#!/usr/bin/env node
// mission-83 W1.5 — R9 LISTEN/NOTIFY write-amplification measurement
//
// Per Design v1.1 §7.1 R9 (B2 fold-in from round-1 audit):
//   LISTEN/NOTIFY per-write tax at scale (write-amplification on every entity-write)
//   Mitigation: measure write-amplification at W1 substrate-shell load-test;
//   if measurable degradation at ≥10k writes/sec, switch to logical-replication;
//   current scale (~10k entities, ~10s of writes/sec) is well under threshold.
//
// Pre-staged W1.5 spec: 1k entity-writes/sec sustained 60s + measure postgres CPU +
// Hub-side NOTIFY-handler latency + dropped-event rate.
//
// Usage:
//   node hub/spike/W0/r9-measure.js [TARGET_RATE=1000] [DURATION_SECS=60] [PARALLELISM=20]

import pg from "pg";
import { performance } from "node:perf_hooks";
import { spawn, spawnSync } from "node:child_process";

const { Pool, Client } = pg;

const TARGET_RATE = parseInt(process.argv[2] || "1000", 10);
const DURATION_SECS = parseInt(process.argv[3] || "60", 10);
const PARALLELISM = parseInt(process.argv[4] || "20", 10);

const CONN = "postgres://hub:hub@localhost:5432/hub";
const KIND = "R9LoadTest";

console.log("");
console.log("=".repeat(72));
console.log(`mission-83 W1.5 — R9 LISTEN/NOTIFY write-amplification measurement`);
console.log("=".repeat(72));
console.log(`Target rate:    ${TARGET_RATE} writes/sec`);
console.log(`Duration:       ${DURATION_SECS}s`);
console.log(`Parallelism:    ${PARALLELISM} concurrent INSERT workers`);
console.log(`Total writes:   ${TARGET_RATE * DURATION_SECS}`);
console.log("");

// ── Phase 1: Clean previous state ──────────────────────────────────────────
console.log("[Phase 1] Clean previous R9 state");
const cleanPool = new Pool({ connectionString: CONN });
await cleanPool.query(`DELETE FROM entities WHERE kind = $1`, [KIND]);
await cleanPool.end();

// ── Phase 2: Start LISTEN subscriber on dedicated client ───────────────────
console.log("[Phase 2] Start LISTEN subscriber (dedicated pg.Client)");
const subscriber = new Client({ connectionString: CONN });
await subscriber.connect();
await subscriber.query(`LISTEN entities_change`);

let notificationCount = 0;
const notificationLatenciesMs = [];
const seqToEmitTs = new Map();  // writer-side map: seq → emitTs (set on INSERT begin)
let firstNotificationAt = null;
let lastNotificationAt = null;

subscriber.on("notification", (n) => {
  const receivedAt = performance.now();
  notificationCount++;
  if (!firstNotificationAt) firstNotificationAt = receivedAt;
  lastNotificationAt = receivedAt;

  if (n.payload) {
    try {
      const payload = JSON.parse(n.payload);
      if (payload.kind === KIND && payload.id) {
        // Parse seq from id "r9-<seq>"
        const m = /^r9-(\d+)$/.exec(payload.id);
        if (m) {
          const seq = parseInt(m[1], 10);
          const emitTs = seqToEmitTs.get(seq);
          if (emitTs !== undefined) {
            notificationLatenciesMs.push(receivedAt - emitTs);
            seqToEmitTs.delete(seq);  // free memory
          }
        }
      }
    } catch { /* ignore */ }
  }
});

// ── Phase 3: Sustained-load INSERT ─────────────────────────────────────────
console.log(`[Phase 3] Sustained INSERT load — ${TARGET_RATE}/s × ${DURATION_SECS}s = ${TARGET_RATE * DURATION_SECS} writes`);

// Use a connection-pool sized for PARALLELISM
const writerPool = new Pool({ connectionString: CONN, max: PARALLELISM });
const targetWrites = TARGET_RATE * DURATION_SECS;

const cpuSamples = [];  // {timestamp, cpu_percent}
const cpuSampler = setInterval(() => {
  const r = spawnSync("docker", ["stats", "--no-stream", "--format", "{{.CPUPerc}}", "hub-substrate-postgres"], { encoding: "utf-8" });
  if (r.status === 0) {
    const cpu = parseFloat(r.stdout.replace("%", "").trim());
    cpuSamples.push({ t: performance.now(), cpu });
  }
}, 5000);  // every 5s

const T0 = performance.now();
const intervalMs = 1000 / TARGET_RATE * PARALLELISM;  // batch every intervalMs, PARALLELISM writes per batch
const batches = Math.ceil(targetWrites / PARALLELISM);

let writesAttempted = 0;
let writesSucceeded = 0;
const writeErrors = new Map();

for (let b = 0; b < batches; b++) {
  const batchT = performance.now();
  const promises = [];

  for (let i = 0; i < PARALLELISM && writesAttempted < targetWrites; i++) {
    const seq = writesAttempted++;
    const writeStartT = performance.now();
    seqToEmitTs.set(seq, writeStartT);  // record emit-ts for latency capture
    promises.push(
      writerPool.query(
        `INSERT INTO entities (kind, id, data) VALUES ($1, $2, $3)`,
        [KIND, `r9-${seq}`, JSON.stringify({ id: `r9-${seq}`, seq })]
      ).then(() => { writesSucceeded++; })
        .catch((err) => {
          const k = err.code || "unknown";
          writeErrors.set(k, (writeErrors.get(k) || 0) + 1);
        })
    );
  }
  await Promise.all(promises);

  // Pace to TARGET_RATE
  const batchElapsed = performance.now() - batchT;
  if (batchElapsed < intervalMs) {
    await new Promise(r => setTimeout(r, intervalMs - batchElapsed));
  }

  // Progress: every ~10s
  const elapsed = (performance.now() - T0) / 1000;
  if (b % Math.max(1, Math.floor(batches / 10)) === 0) {
    console.log(`  [T+${elapsed.toFixed(1)}s] writes: ${writesSucceeded}/${writesAttempted} (${(writesSucceeded/elapsed).toFixed(0)}/s); notifications: ${notificationCount}; errors: ${[...writeErrors.entries()].map(([k,v])=>`${k}=${v}`).join(",") || "none"}`);
  }
}

const T_writeDone = performance.now();
const writeWallClock = (T_writeDone - T0) / 1000;

console.log("");
console.log(`[Phase 3 done — ${writeWallClock.toFixed(2)}s; ${(writesSucceeded/writeWallClock).toFixed(0)} writes/s achieved]`);

// ── Phase 4: Drain remaining notifications ─────────────────────────────────
console.log("[Phase 4] Drain remaining notifications (10s settle)");
await new Promise(r => setTimeout(r, 10000));
clearInterval(cpuSampler);

await writerPool.end();
await subscriber.end();

const T_drainDone = performance.now();

// ── Phase 5: Report ────────────────────────────────────────────────────────
console.log("");
console.log("=".repeat(72));
console.log(`R9 measurement report`);
console.log("=".repeat(72));

const droppedRate = writesSucceeded > 0 ? (1 - notificationCount / writesSucceeded) * 100 : 0;

console.log(`Writes attempted:           ${writesAttempted}`);
console.log(`Writes succeeded:           ${writesSucceeded}`);
console.log(`Writes failed:              ${writesAttempted - writesSucceeded}`);
console.log(`Errors by code:             ${[...writeErrors.entries()].map(([k,v])=>`${k}=${v}`).join(", ") || "none"}`);
console.log(`Notifications received:     ${notificationCount}`);
console.log(`Dropped-event rate:         ${droppedRate.toFixed(2)}%`);
console.log("");

if (notificationLatenciesMs.length > 0) {
  notificationLatenciesMs.sort((a,b) => a - b);
  const avg = notificationLatenciesMs.reduce((a,b)=>a+b,0) / notificationLatenciesMs.length;
  const p50 = notificationLatenciesMs[Math.floor(notificationLatenciesMs.length * 0.5)];
  const p95 = notificationLatenciesMs[Math.floor(notificationLatenciesMs.length * 0.95)];
  const p99 = notificationLatenciesMs[Math.floor(notificationLatenciesMs.length * 0.99)];
  const max = notificationLatenciesMs[notificationLatenciesMs.length - 1];

  console.log(`NOTIFY emit-to-receive latency (ms):`);
  console.log(`  avg:                       ${avg.toFixed(2)} ms`);
  console.log(`  p50:                       ${p50.toFixed(2)} ms`);
  console.log(`  p95:                       ${p95.toFixed(2)} ms`);
  console.log(`  p99:                       ${p99.toFixed(2)} ms`);
  console.log(`  max:                       ${max.toFixed(2)} ms`);
}

console.log("");
console.log(`Write throughput:           ${(writesSucceeded/writeWallClock).toFixed(0)} writes/sec (achieved)`);
console.log(`Target throughput:          ${TARGET_RATE} writes/sec`);
console.log(`Achievement ratio:          ${((writesSucceeded/writeWallClock) / TARGET_RATE * 100).toFixed(1)}%`);

if (cpuSamples.length > 0) {
  const avgCpu = cpuSamples.reduce((a,b) => a + b.cpu, 0) / cpuSamples.length;
  const maxCpu = Math.max(...cpuSamples.map(s => s.cpu));
  console.log("");
  console.log(`Postgres CPU samples (${cpuSamples.length} samples @ 5s interval):`);
  console.log(`  avg:                       ${avgCpu.toFixed(2)}%`);
  console.log(`  max:                       ${maxCpu.toFixed(2)}%`);
}

console.log("");
console.log(`R9 disposition (per Design v1.1 §7.1):`);
const isAcceptable = droppedRate < 1.0 && (notificationLatenciesMs.length > 0 ? notificationLatenciesMs.sort((a,b)=>a-b)[Math.floor(notificationLatenciesMs.length * 0.99)] < 1000 : true);
console.log(`  current scale (~10k entities, ~10s of writes/sec)`);
console.log(`  W1.5 measured rate: ${(writesSucceeded/writeWallClock).toFixed(0)} writes/sec`);
console.log(`  Mitigation threshold: ≥10k writes/sec (switch to logical-replication)`);
console.log(`  Disposition: ${isAcceptable ? '✅ LISTEN/NOTIFY adequate at this scale; R9 closed for current Hub-scale' : '⚠ degradation observed; surface to architect for review'}`);

// Cleanup
const cleanupPool = new Pool({ connectionString: CONN });
await cleanupPool.query(`DELETE FROM entities WHERE kind = $1`, [KIND]);
await cleanupPool.end();
console.log("");
console.log(`Cleanup: R9 entities deleted`);
console.log("=".repeat(72));
