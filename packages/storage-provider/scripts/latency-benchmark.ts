/**
 * latency-benchmark.ts — Mission-47 T4 comparative latency measurement.
 *
 * Measures per-operation p50/p95/p99 latency of each StorageProvider
 * backend. Per-operation decomposition (not aggregate) is the primary
 * output: feeds idea-188 strategic-review input about where the cost
 * lives (reads vs writes vs list vs CAS contention).
 *
 * Usage:
 *   npx tsx scripts/latency-benchmark.ts memory           [default: 1000 iters]
 *   npx tsx scripts/latency-benchmark.ts local-fs         [uses /tmp/ois-latency-bench/]
 *   npx tsx scripts/latency-benchmark.ts gcs <bucket>     [requires credentials]
 *   npx tsx scripts/latency-benchmark.ts memory 200       [custom iters]
 *
 * Workload mix (per architect guidance, thread-302):
 *   - createOnly    N iters  (write-heavy; exercises atomic-create path)
 *   - get           N iters  (read-heavy)
 *   - put           N iters  (write-heavy; unconditional overwrite)
 *   - putIfMatch    N iters  (CAS happy path)
 *   - putIfMatch (contention)  N/4 iters (CAS token-stale retry path)
 *   - list (small)  N/10 iters (prefix with ~20 entries)
 *   - list (large)  N/10 iters (prefix with ~200 entries — bug-29 surface)
 *
 * Output: markdown table + raw JSON dump. Pipe through `tee` to save.
 */

import type { StorageProvider, StorageProviderWithTokenRead } from "../src/contract.js";
import { MemoryStorageProvider } from "../src/memory.js";
import { LocalFsStorageProvider } from "../src/local-fs.js";
import { GcsStorageProvider } from "../src/gcs.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Timings = number[];
type OpName =
  | "createOnly"
  | "get"
  | "put"
  | "putIfMatch"
  | "putIfMatch-contention"
  | "list-small"
  | "list-large";

function percentile(sorted: Timings, p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function fmtMicros(ms: number): string {
  return `${(ms * 1000).toFixed(1)}µs`;
}

interface Stats {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  max: number;
}

function computeStats(timings: Timings): Stats {
  const sorted = [...timings].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    mean: sum / Math.max(1, sorted.length),
    max: sorted.at(-1) ?? 0,
  };
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const result = await fn();
  const elapsed = performance.now() - start;
  return [result, elapsed];
}

async function runBenchmark(
  provider: StorageProvider,
  backendLabel: string,
  iters: number,
): Promise<Record<OpName, Stats>> {
  const getWithToken = (provider as unknown as StorageProviderWithTokenRead).getWithToken.bind(
    provider,
  );

  const payload = new TextEncoder().encode(
    JSON.stringify({
      benchmark: true,
      label: backendLabel,
      padding: "x".repeat(200), // ~250 bytes — representative small entity
    }),
  );

  const results: Record<OpName, Timings> = {
    createOnly: [],
    get: [],
    put: [],
    putIfMatch: [],
    "putIfMatch-contention": [],
    "list-small": [],
    "list-large": [],
  };

  // ── Phase 1: createOnly (new path per iter) ──
  console.log(`[${backendLabel}] Phase 1: createOnly ×${iters}`);
  for (let i = 0; i < iters; i++) {
    const [, ms] = await timed(() =>
      provider.createOnly(`bench/co/${i}.json`, payload),
    );
    results.createOnly.push(ms);
  }

  // ── Phase 2: get (reads from the createOnly-populated path) ──
  console.log(`[${backendLabel}] Phase 2: get ×${iters}`);
  for (let i = 0; i < iters; i++) {
    const [, ms] = await timed(() =>
      provider.get(`bench/co/${i % iters}.json`),
    );
    results.get.push(ms);
  }

  // ── Phase 3: put (unconditional overwrite on existing keys) ──
  console.log(`[${backendLabel}] Phase 3: put ×${iters}`);
  for (let i = 0; i < iters; i++) {
    const [, ms] = await timed(() =>
      provider.put(`bench/co/${i}.json`, payload),
    );
    results.put.push(ms);
  }

  // ── Phase 4: putIfMatch (happy path — current token, clean write) ──
  console.log(`[${backendLabel}] Phase 4: putIfMatch happy ×${iters}`);
  for (let i = 0; i < iters; i++) {
    const read = await getWithToken(`bench/co/${i}.json`);
    if (!read) throw new Error(`missing bench/co/${i}.json`);
    const [, ms] = await timed(() =>
      provider.putIfMatch(`bench/co/${i}.json`, payload, read.token),
    );
    results.putIfMatch.push(ms);
  }

  // ── Phase 5: putIfMatch (contention — stale token, expect ok:false) ──
  console.log(`[${backendLabel}] Phase 5: putIfMatch contention ×${Math.ceil(iters / 4)}`);
  for (let i = 0; i < Math.ceil(iters / 4); i++) {
    // Capture stale token, mutate between read and write.
    const stale = await getWithToken(`bench/co/${i}.json`);
    if (!stale) throw new Error(`missing bench/co/${i}.json`);
    await provider.put(`bench/co/${i}.json`, payload); // Invalidate token
    const [, ms] = await timed(() =>
      provider.putIfMatch(`bench/co/${i}.json`, payload, stale.token),
    );
    results["putIfMatch-contention"].push(ms);
  }

  // ── Phase 6: list (small prefix — ~20 entries) ──
  // First seed a small prefix.
  for (let i = 0; i < 20; i++) {
    await provider.createOnly(`bench/small/${i}.json`, payload);
  }
  console.log(`[${backendLabel}] Phase 6: list (small, 20 entries) ×${Math.ceil(iters / 10)}`);
  for (let i = 0; i < Math.ceil(iters / 10); i++) {
    const [, ms] = await timed(() => provider.list("bench/small/"));
    results["list-small"].push(ms);
  }

  // ── Phase 7: list (large prefix — ~200 entries, bug-29 surface) ──
  for (let i = 0; i < 200; i++) {
    await provider.createOnly(`bench/large/${i}.json`, payload);
  }
  console.log(`[${backendLabel}] Phase 7: list (large, 200 entries) ×${Math.ceil(iters / 10)}`);
  for (let i = 0; i < Math.ceil(iters / 10); i++) {
    const [, ms] = await timed(() => provider.list("bench/large/"));
    results["list-large"].push(ms);
  }

  // Cleanup
  console.log(`[${backendLabel}] Cleaning up benchmark data...`);
  const all = [
    ...(await provider.list("bench/co/")),
    ...(await provider.list("bench/small/")),
    ...(await provider.list("bench/large/")),
  ];
  for (const key of all) {
    await provider.delete(key);
  }

  return {
    createOnly: computeStats(results.createOnly),
    get: computeStats(results.get),
    put: computeStats(results.put),
    putIfMatch: computeStats(results.putIfMatch),
    "putIfMatch-contention": computeStats(results["putIfMatch-contention"]),
    "list-small": computeStats(results["list-small"]),
    "list-large": computeStats(results["list-large"]),
  };
}

function renderStatsTable(
  label: string,
  stats: Record<OpName, Stats>,
): string {
  const lines = [
    ``,
    `## ${label}`,
    ``,
    `| Operation | n | p50 | p95 | p99 | mean | max |`,
    `|---|---|---|---|---|---|---|`,
  ];
  for (const op of Object.keys(stats) as OpName[]) {
    const s = stats[op];
    lines.push(
      `| ${op} | ${s.n} | ${fmtMicros(s.p50)} | ${fmtMicros(s.p95)} | ${fmtMicros(s.p99)} | ${fmtMicros(s.mean)} | ${fmtMicros(s.max)} |`,
    );
  }
  return lines.join("\n");
}

async function main() {
  const [, , backend = "memory", arg1, arg2] = process.argv;
  const iters = Number(
    backend === "gcs" ? arg2 ?? "1000" : arg1 ?? "1000",
  );

  console.log(`=== StorageProvider Latency Benchmark ===`);
  console.log(`Backend: ${backend}`);
  console.log(`Iterations: ${iters}`);
  console.log(``);

  let provider: StorageProvider;
  let cleanup: (() => void) | null = null;

  if (backend === "memory") {
    provider = new MemoryStorageProvider();
  } else if (backend === "local-fs") {
    const root = mkdtempSync(join(tmpdir(), "ois-latency-bench-"));
    provider = new LocalFsStorageProvider(root);
    cleanup = () => rmSync(root, { recursive: true, force: true });
    console.log(`[local-fs] root: ${root}`);
  } else if (backend === "gcs") {
    const bucket = arg1;
    if (!bucket) {
      console.error("gcs backend requires bucket name: `npx tsx … gcs <bucket> [iters]`");
      process.exit(1);
    }
    provider = new GcsStorageProvider(bucket);
    console.log(`[gcs] bucket: gs://${bucket}`);
  } else {
    console.error(`Unknown backend: ${backend}. Use: memory | local-fs | gcs`);
    process.exit(1);
  }

  const start = performance.now();
  const stats = await runBenchmark(provider, backend, iters);
  const wallMs = performance.now() - start;

  console.log(renderStatsTable(`${backend} (${iters} iters, wall=${(wallMs / 1000).toFixed(1)}s)`, stats));
  console.log(``);
  console.log(`### Raw JSON`);
  console.log("```json");
  console.log(JSON.stringify({ backend, iters, wallMs, stats }, null, 2));
  console.log("```");

  cleanup?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
