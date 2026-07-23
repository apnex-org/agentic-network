#!/usr/bin/env tsx
/**
 * bug-343 real-PostgreSQL reconnect scale trace.
 *
 * Required environment:
 *   BUG343_DATABASE_URL  PostgreSQL 15+ URL (ephemeral test database only)
 * Optional:
 *   BUG343_SEED=0        reuse an already-seeded corpus (default: reset+seed)
 *   BUG343_PROFILE       evidence label (default: local)
 *   BUG343_CLIENTS       concurrent reconnects (default: 12)
 *   BUG343_TRACE_OUT     write full JSON trace to this path
 *
 * The seed is exactly 210,781 workload entities before six SchemaDef rows and
 * exceeds 310 MiB in both logical JSON text and pg_column_size(JSONB). No test
 * phase deletes, compacts, or rewrites Audit/history rows. The setup TRUNCATE is
 * allowed only in the explicitly ephemeral database named by this script.
 */

import { writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  ALL_SCHEMAS,
  createPostgresStorageSubstrate,
  createSchemaReconciler,
  type HubStorageSubstrate,
  type PostgresSubstrate,
  type SchemaReconciler,
} from "../src/storage-substrate/index.js";
import { AgentRepositorySubstrate } from "../src/entities/agent-repository-substrate.js";

const { Pool } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "src", "storage-substrate", "migrations");
const connectionString = process.env.BUG343_DATABASE_URL;
if (!connectionString) throw new Error("BUG343_DATABASE_URL is required");
const shouldSeed = process.env.BUG343_SEED !== "0";
const profile = process.env.BUG343_PROFILE ?? "local";
const clients = Math.max(1, Number.parseInt(process.env.BUG343_CLIENTS ?? "12", 10));
const traceOut = process.env.BUG343_TRACE_OUT;
const MIN_ENTITIES = 210_781;
const MIN_JSON_BYTES = 310 * 1024 * 1024;

const pool = new Pool({ connectionString, max: 32 });
let substrate: HubStorageSubstrate | undefined;
let reconciler: SchemaReconciler | undefined;

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))]!;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

interface RunSample { latencyMs: number; error?: string }

async function measured(fn: () => Promise<void>): Promise<RunSample> {
  const start = performance.now();
  try {
    await fn();
    return { latencyMs: performance.now() - start };
  } catch (error) {
    return { latencyMs: performance.now() - start, error: String(error) };
  }
}

function summarize(samples: RunSample[]) {
  const latencies = samples.map((s) => s.latencyMs);
  return {
    count: samples.length,
    errors: samples.filter((s) => s.error).length,
    p50Ms: round(quantile(latencies, 0.50)),
    p95Ms: round(quantile(latencies, 0.95)),
    maxMs: round(Math.max(...latencies)),
    errorMessages: [...new Set(samples.flatMap((s) => s.error ? [s.error] : []))],
  };
}

async function seedCorpus(): Promise<void> {
  await pool.query("TRUNCATE TABLE entities");

  // 209,981 immutable history rows. Each padding value is 52 independent MD5
  // blocks (1,664 bytes) rather than a repeated/compressible token, producing a
  // real >310MiB JSONB corpus instead of a nominal unmaterialized size claim.
  await pool.query(`
    INSERT INTO entities(kind, id, data)
    SELECT 'Audit',
           'audit-scale-' || lpad(g::text, 6, '0'),
           jsonb_build_object(
             'apiVersion', 'core.ois/v1',
             'kind', 'Audit',
             'id', 'audit-scale-' || lpad(g::text, 6, '0'),
             'name', 'audit-scale-' || g,
             'metadata', jsonb_build_object(
               'createdAt', '2026-07-23T00:00:00.000Z',
               'actor', CASE WHEN g % 2 = 0 THEN 'hub' ELSE 'engineer' END
             ),
             'spec', jsonb_build_object(
               'action', 'scale_history',
               'details', 'immutable bug-343 history row',
               'relatedEntity', 'work-' || (g % 1000),
               'padding', (
                 SELECT string_agg(md5(g::text || ':' || s::text), '' ORDER BY s)
                 FROM generate_series(1, 52) AS s
               )
             ),
             'status', '{}'::jsonb
           )
    FROM generate_series(1, 209981) AS g
  `);

  await pool.query(`
    INSERT INTO entities(kind, id, data)
    SELECT 'Mission', 'mission-scale-' || g,
      jsonb_build_object(
        'apiVersion','core.ois/v1','kind','Mission','id','mission-scale-' || g,'name','mission-scale-' || g,
        'metadata',jsonb_build_object('createdAt','2026-07-23T00:00:00.000Z','updatedAt','2026-07-23T00:00:00.000Z','correlationId','mission-scale-' || g,'createdBy',jsonb_build_object('role','architect','agentId','agent-scale-1')),
        'spec',jsonb_build_object('title','Scale mission ' || g,'description','bug-343 reconnect parity fixture'),
        'status',jsonb_build_object('phase',CASE WHEN g % 2 = 0 THEN 'active' ELSE 'completed' END)
      )
    FROM generate_series(1, 200) AS g;

    INSERT INTO entities(kind, id, data)
    SELECT 'Proposal', 'prop-scale-' || g,
      jsonb_build_object(
        'apiVersion','core.ois/v1','kind','Proposal','id','prop-scale-' || g,'name','prop-scale-' || g,
        'metadata',jsonb_build_object('createdAt','2026-07-23T00:00:00.000Z','updatedAt','2026-07-23T00:00:00.000Z'),
        'spec',jsonb_build_object('title','Scale proposal ' || g,'summary','summary','executionPlan',CASE WHEN g % 3 = 0 THEN jsonb_build_object('steps',jsonb_build_array('x')) ELSE 'null'::jsonb END),
        'status',jsonb_build_object('phase',CASE WHEN g <= 75 THEN 'submitted' ELSE 'approved' END,'scaffoldResult',NULL)
      )
    FROM generate_series(1, 150) AS g;

    INSERT INTO entities(kind, id, data)
    SELECT 'Thread', 'thread-scale-' || g,
      jsonb_build_object(
        'apiVersion','core.ois/v1','kind','Thread','id','thread-scale-' || g,'name','thread-scale-' || g,
        'metadata',jsonb_build_object('createdAt','2026-07-23T00:00:00.000Z','updatedAt','2026-07-23T00:00:00.000Z','labels','{}'::jsonb),
        'spec',jsonb_build_object('title','Scale thread ' || g,'routingMode','unicast','maxRounds',10),
        'status',jsonb_build_object('phase',CASE WHEN g <= 100 THEN 'active' ELSE 'converged' END,'currentTurn',CASE WHEN g % 2 = 0 THEN 'architect' ELSE 'engineer' END,'currentTurnAgentId',NULL,'roundCount',2,'participants','[]'::jsonb,'messages','[]'::jsonb,'convergenceActions','[]'::jsonb)
      )
    FROM generate_series(1, 200) AS g;

    INSERT INTO entities(kind, id, data)
    SELECT 'PendingAction', 'pa-scale-' || g,
      jsonb_build_object(
        'apiVersion','core.ois/v1','kind','PendingAction','id','pa-scale-' || g,'name','pa-scale-' || g,
        'metadata',jsonb_build_object('createdAt','2026-07-23T00:00:00.000Z','naturalKey','agent-scale-1:thread-scale-' || g || ':thread_message'),
        'spec',jsonb_build_object('targetAgentId',CASE WHEN g <= 100 THEN 'agent-scale-1' ELSE 'agent-scale-2' END,'dispatchType','thread_message','entityRef','thread-scale-' || g,'payload','{}'::jsonb),
        'status',jsonb_build_object('phase',CASE WHEN g <= 10 THEN 'enqueued' WHEN g <= 20 THEN 'receipt_acked' ELSE 'completion_acked' END,'attemptCount',0)
      )
    FROM generate_series(1, 200) AS g;

    INSERT INTO entities(kind, id, data)
    SELECT 'Agent', 'agent-scale-' || g,
      jsonb_build_object(
        'apiVersion','core.ois/v1','kind','Agent','id','agent-scale-' || g,'name','scale-agent-' || g,
        'metadata',jsonb_build_object('createdAt','2026-07-23T00:00:00.000Z','updatedAt','2026-07-23T00:00:00.000Z','fingerprint','fp-scale-' || g,'archived',false),
        'spec',jsonb_build_object('role',CASE WHEN g = 1 THEN 'architect' ELSE 'engineer' END,'labels','{}'::jsonb),
        'status',jsonb_build_object('phase','online','currentSessionId',CASE WHEN g = 1 THEN 'session-scale-current' ELSE 'session-decoy-' || g END,'registeredSessions',jsonb_build_array(CASE WHEN g = 1 THEN 'session-scale-current' ELSE 'session-decoy-' || g END),'sessionEpoch',1,'livenessState','online','lastHeartbeatAt','2099-01-01T00:00:00.000Z')
      )
    FROM generate_series(1, 50) AS g;
  `);
  await pool.query("ANALYZE entities");
}

async function corpusStats() {
  const r = await pool.query<{
    workload_count: string; total_count: string; logical_bytes: string; physical_bytes: string;
  }>(`
    SELECT
      COUNT(*) FILTER (WHERE kind <> 'SchemaDef') AS workload_count,
      COUNT(*) AS total_count,
      COALESCE(SUM(octet_length(data::text)) FILTER (WHERE kind <> 'SchemaDef'),0) AS logical_bytes,
      COALESCE(SUM(pg_column_size(data)) FILTER (WHERE kind <> 'SchemaDef'),0) AS physical_bytes
    FROM entities
  `);
  const row = r.rows[0]!;
  return {
    workloadEntities: Number(row.workload_count),
    totalEntities: Number(row.total_count),
    logicalJsonBytes: Number(row.logical_bytes),
    physicalJsonbBytes: Number(row.physical_bytes),
  };
}

async function immutableReceipt() {
  const r = await pool.query<{ count: string; digest: string }>(`
    SELECT COUNT(*) AS count,
           md5(string_agg(id || ':' || resource_version || ':' || md5(data::text), '' ORDER BY id)) AS digest
    FROM entities WHERE kind = 'Audit'
  `);
  return { count: Number(r.rows[0]!.count), digest: r.rows[0]!.digest };
}

const OLD_LIST_SQL = `
  WITH snapshot AS (SELECT COALESCE(MAX(resource_version), 0) AS rv FROM entities),
       items AS (
         SELECT data, resource_version FROM entities
         WHERE kind = $1
           AND ($2::text IS NULL OR data#>>$3::text[] = $2)
           AND ($4::text IS NULL OR data#>>$5::text[] = $4)
         LIMIT 500
       )
  SELECT (SELECT rv FROM snapshot) AS snapshot_rv,
         (SELECT json_agg(items.data) FROM items) AS items_json
`;

async function oldList(kind: string, value1?: string, path1: string[] = ["status","phase"], value2?: string, path2: string[] = ["status","currentTurn"]): Promise<void> {
  await pool.query(OLD_LIST_SQL, [kind, value1 ?? null, path1, value2 ?? null, path2]);
}

async function oldReconnect(): Promise<void> {
  // Reproduce the pre-fix fan-out: six scan-shaped reads launch together for one
  // reconnect (Mission liveness, proposal/thread aggregate, queue summary+drain,
  // and restart-time Agent/session lookup).
  await Promise.all([
    oldList("Mission"),
    oldList("Proposal"),
    oldList("Thread"),
    oldList("PendingAction", "agent-scale-1", ["spec","targetAgentId"]),
    oldList("PendingAction", "agent-scale-1", ["spec","targetAgentId"], "enqueued", ["status","phase"]),
    oldList("Agent"),
  ]);
}

async function newReconnect(): Promise<void> {
  // get_now is store-free. Remaining reads mirror bug-343's role-aware,
  // sequential, substrate-filtered architect reconnect path.
  await substrate!.list("PendingAction", { filter: { "spec.targetAgentId": "agent-scale-1", "status.phase": { $in: ["enqueued", "receipt_acked"] } }, limit: 500 });
  await substrate!.list("Proposal", { filter: { "status.phase": "submitted" }, limit: 500 });
  await substrate!.list("Proposal", { filter: { "status.phase": "approved" }, limit: 500 });
  await substrate!.list("Thread", { filter: { "status.phase": "active", "status.currentTurn": "architect" }, limit: 500 });
  await substrate!.list("Thread", { filter: { "status.phase": "converged" }, limit: 500 });
  await substrate!.list("PendingAction", { filter: { "spec.targetAgentId": "agent-scale-1", "status.phase": "enqueued" }, limit: 500 });
  const restartedRegistry = new AgentRepositorySubstrate(substrate!);
  const agent = await restartedRegistry.getAgentForSession("session-scale-current");
  if (agent?.id !== "agent-scale-1") throw new Error(`session parity failure: ${agent?.id}`);
}

async function ids(kind: string): Promise<Record<string, unknown>[]> {
  const r = await pool.query<{ data: Record<string, unknown> }>(
    "SELECT data FROM entities WHERE kind = $1 ORDER BY id LIMIT 500",
    [kind],
  );
  return r.rows.map((x) => x.data);
}

function path(v: Record<string, unknown>, ...parts: string[]): unknown {
  let cur: unknown = v;
  for (const part of parts) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[part] : undefined;
  return cur;
}

function sortedIds(rows: Array<Record<string, unknown>>): string[] {
  return rows.map((r) => String(r.id)).sort();
}

async function semanticParity() {
  const [proposalRows, threadRows, pendingRows] = await Promise.all([
    ids("Proposal"), ids("Thread"), ids("PendingAction"),
  ]);
  const checks: Record<string, boolean> = {};
  const compare = async (name: string, oldRows: Record<string, unknown>[], kind: string, filter: Record<string, unknown>) => {
    const next = await substrate!.list<Record<string, unknown>>(kind, { filter, limit: 500 });
    checks[name] = JSON.stringify(sortedIds(oldRows)) === JSON.stringify(sortedIds(next.items));
  };
  await compare("submittedProposals",
    proposalRows.filter((r) => path(r, "status", "phase") === "submitted"),
    "Proposal", { "status.phase": "submitted" });
  await compare("approvedProposals",
    proposalRows.filter((r) => path(r, "status", "phase") === "approved"),
    "Proposal", { "status.phase": "approved" });
  await compare("activeArchitectThreads",
    threadRows.filter((r) => path(r, "status", "phase") === "active" && path(r, "status", "currentTurn") === "architect"),
    "Thread", { "status.phase": "active", "status.currentTurn": "architect" });
  await compare("convergedThreads",
    threadRows.filter((r) => path(r, "status", "phase") === "converged"),
    "Thread", { "status.phase": "converged" });
  await compare("inFlightQueue",
    pendingRows.filter((r) => path(r, "spec", "targetAgentId") === "agent-scale-1" && ["enqueued","receipt_acked"].includes(String(path(r,"status","phase")))),
    "PendingAction", { "spec.targetAgentId": "agent-scale-1", "status.phase": { $in: ["enqueued","receipt_acked"] } });
  await compare("drainQueue",
    pendingRows.filter((r) => path(r, "spec", "targetAgentId") === "agent-scale-1" && path(r,"status","phase") === "enqueued"),
    "PendingAction", { "spec.targetAgentId": "agent-scale-1", "status.phase": "enqueued" });
  return { checks, all: Object.values(checks).every(Boolean) };
}

async function explain(sql: string): Promise<unknown> {
  const r = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`);
  return r.rows[0]!["QUERY PLAN"][0];
}

function planNodes(plan: unknown) {
  const out: Array<Record<string, unknown>> = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node["Node Type"]) {
      out.push({
        nodeType: node["Node Type"],
        relation: node["Relation Name"] ?? null,
        index: node["Index Name"] ?? null,
        actualRows: node["Actual Rows"] ?? null,
        sharedReadBlocks: node["Shared Read Blocks"] ?? null,
        sharedHitBlocks: node["Shared Hit Blocks"] ?? null,
      });
    }
    for (const child of node.Plans ?? []) walk(child);
  };
  walk((plan as any)?.Plan);
  return out;
}

async function main() {
  for (const file of ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"]) {
    await pool.query(readFileSync(join(migrationsDir, file), "utf8"));
  }
  if (shouldSeed) await seedCorpus();

  substrate = createPostgresStorageSubstrate(connectionString, {
    max: 25,
    listMaxConcurrency: 4,
    listMaxQueued: Math.max(32, clients * 8),
    listAdmissionTimeoutMs: 60_000,
  });
  const subset = ALL_SCHEMAS.filter((s) => ["SchemaDef", "Agent", "Mission", "PendingAction", "Proposal", "Thread"].includes(s.kind));
  reconciler = createSchemaReconciler(substrate, connectionString, {
    initialSchemas: subset,
    log: () => {},
    warn: (message, error) => console.error(message, error ?? ""),
  });
  await reconciler.start();
  (substrate as PostgresSubstrate).setFieldTranslator((kind, key) => reconciler!.getFieldTranslation(kind, key));
  await pool.query("ANALYZE entities");

  const stats = await corpusStats();
  if (stats.workloadEntities < MIN_ENTITIES) throw new Error(`entity floor failed: ${stats.workloadEntities}`);
  if (stats.logicalJsonBytes < MIN_JSON_BYTES) throw new Error(`logical JSON floor failed: ${stats.logicalJsonBytes}`);
  if (stats.physicalJsonbBytes < MIN_JSON_BYTES) throw new Error(`physical JSONB floor failed: ${stats.physicalJsonbBytes}`);

  const beforeHistory = await immutableReceipt();
  const beforeTotal = stats.totalEntities;
  const parity = await semanticParity();
  if (!parity.all) throw new Error(`semantic parity failed: ${JSON.stringify(parity.checks)}`);

  // Warm both paths, then measure the same concurrent reconnect count.
  await oldReconnect();
  await newReconnect();
  const oldSamples = await Promise.all(Array.from({ length: clients }, () => measured(oldReconnect)));
  const newSamples = await Promise.all(Array.from({ length: clients }, () => measured(newReconnect)));

  const afterHistory = await immutableReceipt();
  const afterStats = await corpusStats();
  const historyPreserved = beforeHistory.count === afterHistory.count && beforeHistory.digest === afterHistory.digest;
  const noRowsDeleted = beforeTotal === afterStats.totalEntities;
  if (!historyPreserved || !noRowsDeleted) throw new Error("history/entity preservation invariant failed");

  const oldPlan = await explain(`
    WITH snapshot AS (SELECT COALESCE(MAX(resource_version),0) AS rv FROM entities),
         items AS (SELECT data, resource_version FROM entities WHERE kind='Mission' LIMIT 500)
    SELECT (SELECT rv FROM snapshot), (SELECT json_agg(data) FROM items)
  `);
  const newPlan = await explain(`
    WITH snapshot AS (
      SELECT COALESCE((SELECT resource_version FROM entities ORDER BY resource_version DESC LIMIT 1),0) AS rv
    ), items AS (
      SELECT data, resource_version FROM entities
      WHERE kind='PendingAction'
        AND data#>>'{spec,targetAgentId}'='agent-scale-1'
        AND data#>>'{status,phase}'='enqueued'
      LIMIT 500
    )
    SELECT (SELECT rv FROM snapshot), (SELECT json_agg(data) FROM items)
  `);

  const trace = {
    bug: "bug-343",
    workItem: "work-468",
    profile,
    measuredAt: new Date().toISOString(),
    clients,
    corpus: stats,
    preFixReconnect: summarize(oldSamples),
    postFixReconnect: summarize(newSamples),
    semanticParity: parity,
    preservation: { beforeHistory, afterHistory, historyPreserved, beforeTotal, afterTotal: afterStats.totalEntities, noRowsDeleted },
    plans: { preFix: planNodes(oldPlan), postFix: planNodes(newPlan) },
    notes: [
      "pre-fix launches six scan-shaped calls concurrently per reconnect",
      "post-fix is sequential, list-admission capped at 4, get_now is store-free",
      "history digest covers every Audit id/resourceVersion/data byte before and after",
      "setup TRUNCATE is confined to the explicitly ephemeral scale database",
    ],
  };

  const rendered = JSON.stringify(trace, null, 2) + "\n";
  if (traceOut) await writeFile(traceOut, rendered, "utf8");
  process.stdout.write(rendered);
}

try {
  await main();
} finally {
  await reconciler?.close().catch(() => {});
  await substrate?.close().catch(() => {});
  await pool.end().catch(() => {});
}
