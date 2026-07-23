#!/usr/bin/env tsx
/**
 * bug-343/work-470 real-PostgreSQL reconnect scale + over-cap trace.
 *
 * Required:
 *   BUG343_DATABASE_URL  ephemeral PostgreSQL 15+ database
 * Optional:
 *   BUG343_SEED=0                 reuse the already-seeded corpus
 *   BUG343_PROFILE                evidence label
 *   BUG343_CLIENTS                concurrent reconnects (default 12)
 *   BUG343_TRACE_OUT              successful JSON trace path
 *   BUG343_FAILED_OUT             failure JSON receipt path
 *   BUG343_DOCKER_CONTAINER       container whose cgroup CPU is measured
 *   BUG343_REQUIRE_CPU=1          fail if cgroup CPU cannot be measured
 *
 * The fixture retains all 209,981 predecessor Audit rows and raises the three
 * truncation-sensitive dimensions to 675 Proposal / 650 Thread / 600
 * PendingAction. Total workload therefore exceeds (rather than weakens) the
 * predecessor's 210,781-row floor, while physical JSONB remains >310 MiB.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  ALL_SCHEMAS,
  createPostgresStorageSubstrate,
  createSchemaReconciler,
  type PostgresSubstrate,
  type SchemaReconciler,
} from "../src/storage-substrate/index.js";
import { AgentRepositorySubstrate } from "../src/entities/agent-repository-substrate.js";
import { PendingActionRepositorySubstrate } from "../src/entities/pending-action-repository-substrate.js";
import { ProposalRepositorySubstrate } from "../src/entities/proposal-repository-substrate.js";
import { ThreadRepositorySubstrate } from "../src/entities/thread-repository-substrate.js";
import { SubstrateCounter } from "../src/entities/substrate-counter.js";

const { Pool } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "src", "storage-substrate", "migrations");
const connectionString = process.env.BUG343_DATABASE_URL;
if (!connectionString) throw new Error("BUG343_DATABASE_URL is required");
const shouldSeed = process.env.BUG343_SEED !== "0";
const profile = process.env.BUG343_PROFILE ?? "local";
const clients = Math.max(1, Number.parseInt(process.env.BUG343_CLIENTS ?? "12", 10));
const traceOut = process.env.BUG343_TRACE_OUT;
const failedOut = process.env.BUG343_FAILED_OUT;
const requireCpu = process.env.BUG343_REQUIRE_CPU === "1";
const dockerContainer = process.env.BUG343_DOCKER_CONTAINER;
const MIN_ENTITIES = 210_781;
const MIN_JSON_BYTES = 310 * 1024 * 1024;
const EXPECTED = { submittedProposals: 675, activeArchitectThreads: 650, inFlightPendingActions: 600 };

const pool = new Pool({ connectionString, max: 32 });
let substrate: PostgresSubstrate | undefined;
let reconciler: SchemaReconciler | undefined;
let proposalRepo: ProposalRepositorySubstrate;
let threadRepo: ThreadRepositorySubstrate;
let pendingRepo: PendingActionRepositorySubstrate;
let agentRepo: AgentRepositorySubstrate;
let cpuStatPath: string | null = null;
let cpuStatFormat: "cgroup-v2-usec" | "cgroup-v1-nsec" | null = null;

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
  const latencies = samples.map((sample) => sample.latencyMs);
  return {
    count: samples.length,
    errors: samples.filter((sample) => sample.error).length,
    p50Ms: round(quantile(latencies, 0.50)),
    p95Ms: round(quantile(latencies, 0.95)),
    maxMs: round(Math.max(...latencies)),
    errorMessages: [...new Set(samples.flatMap((sample) => sample.error ? [sample.error] : []))],
  };
}

function resolveContainerCpuStatPath(): string | null {
  if (!dockerContainer) return null;
  try {
    const pid = execFileSync("docker", ["inspect", "--format", "{{.State.Pid}}", dockerContainer], { encoding: "utf8" }).trim();
    const lines = readFileSync(`/proc/${pid}/cgroup`, "utf8").split("\n");
    // This host uses hybrid cgroup v1 for container CPU accounting.
    const v1 = lines.find((line) => line.split(":")[1]?.split(",").includes("cpuacct"));
    if (v1) {
      const relative = v1.split(":")[2]!.replace(/^\//, "");
      const path = join("/sys/fs/cgroup/cpu,cpuacct", relative, "cpuacct.usage");
      readFileSync(path, "utf8");
      cpuStatFormat = "cgroup-v1-nsec";
      return path;
    }
    const v2 = lines.find((line) => line.startsWith("0::"));
    if (!v2) return null;
    const relative = v2.slice(3).replace(/^\//, "");
    const path = join("/sys/fs/cgroup", relative, "cpu.stat");
    readFileSync(path, "utf8");
    cpuStatFormat = "cgroup-v2-usec";
    return path;
  } catch {
    cpuStatFormat = null;
    return null;
  }
}

function readContainerCpuUsec(): number | null {
  if (!cpuStatPath || !cpuStatFormat) return null;
  const raw = readFileSync(cpuStatPath, "utf8").trim();
  if (cpuStatFormat === "cgroup-v1-nsec") return Number(raw) / 1000;
  const match = /^usage_usec\s+(\d+)$/m.exec(raw);
  return match ? Number(match[1]) : null;
}

async function measurePhase(name: string, fn: () => Promise<void>, issuedQueries: number) {
  substrate!.resetListAdmissionObservations();
  const dbCpuBefore = readContainerCpuUsec();
  const processCpuBefore = process.cpuUsage();
  const start = performance.now();
  const samples = await Promise.all(Array.from({ length: clients }, () => measured(fn)));
  const wallMs = performance.now() - start;
  const processCpu = process.cpuUsage(processCpuBefore);
  const dbCpuAfter = readContainerCpuUsec();
  const databaseCpuUsec = dbCpuBefore !== null && dbCpuAfter !== null ? dbCpuAfter - dbCpuBefore : null;
  return {
    name,
    reconnects: summarize(samples),
    wallMs: round(wallMs),
    issuedQueries,
    processCpuMs: round((processCpu.user + processCpu.system) / 1000),
    databaseCpu: databaseCpuUsec === null ? {
      available: false,
      usageUsec: null,
      utilizationPct: null,
    } : {
      available: true,
      usageUsec: databaseCpuUsec,
      // Aggregate cgroup CPU: 100% = one fully utilized vCPU; 4 cores can report 400%.
      utilizationPct: round((databaseCpuUsec / (wallMs * 1000)) * 100),
    },
    listAdmission: substrate!.getListAdmissionSnapshot(),
  };
}

async function seedCorpus(): Promise<void> {
  await pool.query("TRUNCATE TABLE entities");

  await pool.query(`
    INSERT INTO entities(kind, id, data)
    SELECT 'Audit',
           'audit-scale-' || lpad(g::text, 6, '0'),
           jsonb_build_object(
             'apiVersion', 'core.ois/v1', 'kind', 'Audit',
             'id', 'audit-scale-' || lpad(g::text, 6, '0'), 'name', 'audit-scale-' || g,
             'metadata', jsonb_build_object('createdAt','2026-07-23T00:00:00.000Z','actor',CASE WHEN g % 2 = 0 THEN 'hub' ELSE 'engineer' END),
             'spec', jsonb_build_object(
               'action','scale_history','details','immutable bug-343 history row','relatedEntity','work-' || (g % 1000),
               'padding',(SELECT string_agg(md5(g::text || ':' || s::text), '' ORDER BY s) FROM generate_series(1,52) AS s)
             ),
             'status','{}'::jsonb
           )
    FROM generate_series(1,209981) AS g
  `);

  await pool.query(`
    INSERT INTO entities(kind,id,data)
    SELECT 'Mission','mission-scale-' || g,
      jsonb_build_object(
        'apiVersion','core.ois/v1','kind','Mission','id','mission-scale-' || g,'name','mission-scale-' || g,
        'metadata',jsonb_build_object('createdAt','2026-07-23T00:00:00.000Z','updatedAt','2026-07-23T00:00:00.000Z','correlationId','mission-scale-' || g,'createdBy',jsonb_build_object('role','architect','agentId','agent-scale-1')),
        'spec',jsonb_build_object('title','Scale mission ' || g,'description','bug-343 reconnect fixture'),
        'status',jsonb_build_object('phase',CASE WHEN g % 2 = 0 THEN 'active' ELSE 'completed' END)
      ) FROM generate_series(1,200) AS g;

    INSERT INTO entities(kind,id,data)
    SELECT 'Proposal','prop-scale-' || lpad(g::text,4,'0'),
      jsonb_build_object(
        'apiVersion','core.ois/v1','kind','Proposal','id','prop-scale-' || lpad(g::text,4,'0'),'name','prop-scale-' || g,
        'metadata',jsonb_build_object('createdAt','2026-07-23T00:00:00.000Z','updatedAt','2026-07-23T00:00:00.000Z'),
        'spec',jsonb_build_object('title','Scale proposal ' || g,'summary','summary','proposalRef','proposals/' || g || '.md','executionPlan','null'::jsonb),
        'status',jsonb_build_object('phase','submitted','scaffoldResult',NULL)
      ) FROM generate_series(1,675) AS g;

    INSERT INTO entities(kind,id,data)
    SELECT 'Thread','thread-scale-' || lpad(g::text,4,'0'),
      jsonb_build_object(
        'apiVersion','core.ois/v1','kind','Thread','id','thread-scale-' || lpad(g::text,4,'0'),'name','thread-scale-' || g,
        'metadata',jsonb_build_object('createdAt','2026-07-23T00:00:00.000Z','updatedAt','2026-07-23T00:00:00.000Z','labels','{}'::jsonb),
        'spec',jsonb_build_object('title','Scale thread ' || g,'routingMode','unicast','maxRounds',10),
        'status',jsonb_build_object('phase','active','currentTurn','architect','currentTurnAgentId',NULL,'roundCount',2,'participants','[]'::jsonb,'messages','[]'::jsonb,'convergenceActions','[]'::jsonb)
      ) FROM generate_series(1,650) AS g;

    INSERT INTO entities(kind,id,data)
    SELECT 'PendingAction','pa-scale-' || lpad(g::text,4,'0'),
      jsonb_build_object(
        'apiVersion','core.ois/v1','kind','PendingAction','id','pa-scale-' || lpad(g::text,4,'0'),'name','pa-scale-' || g,
        'metadata',jsonb_build_object('createdAt','2026-07-23T00:00:00.000Z','naturalKey','agent-scale-1:thread-scale-' || lpad(g::text,4,'0') || ':thread_message'),
        'spec',jsonb_build_object('targetAgentId','agent-scale-1','dispatchType','thread_message','entityRef','thread-scale-' || lpad(g::text,4,'0'),'payload','{}'::jsonb),
        'status',jsonb_build_object('phase',CASE WHEN g <= 300 THEN 'enqueued' ELSE 'receipt_acked' END,'attemptCount',0)
      ) FROM generate_series(1,600) AS g;

    INSERT INTO entities(kind,id,data)
    SELECT 'Agent','agent-scale-' || g,
      jsonb_build_object(
        'apiVersion','core.ois/v1','kind','Agent','id','agent-scale-' || g,'name','scale-agent-' || g,
        'metadata',jsonb_build_object('createdAt','2026-07-23T00:00:00.000Z','updatedAt','2026-07-23T00:00:00.000Z','fingerprint','fp-scale-' || g,'archived',false),
        'spec',jsonb_build_object('role',CASE WHEN g=1 THEN 'architect' ELSE 'engineer' END,'labels','{}'::jsonb),
        'status',jsonb_build_object('phase','online','currentSessionId',CASE WHEN g=1 THEN 'session-scale-current' ELSE 'session-decoy-' || g END,'registeredSessions',jsonb_build_array(CASE WHEN g=1 THEN 'session-scale-current' ELSE 'session-decoy-' || g END),'sessionEpoch',1,'livenessState','online','lastHeartbeatAt','2099-01-01T00:00:00.000Z')
      ) FROM generate_series(1,50) AS g;
  `);
  await pool.query("ANALYZE entities");
}

async function corpusStats() {
  const r = await pool.query<{ workload_count: string; total_count: string; logical_bytes: string; physical_bytes: string }>(`
    SELECT COUNT(*) FILTER (WHERE kind <> 'SchemaDef') AS workload_count,
           COUNT(*) AS total_count,
           COALESCE(SUM(octet_length(data::text)) FILTER (WHERE kind <> 'SchemaDef'),0) AS logical_bytes,
           COALESCE(SUM(pg_column_size(data)) FILTER (WHERE kind <> 'SchemaDef'),0) AS physical_bytes
    FROM entities
  `);
  const row = r.rows[0]!;
  return {
    workloadEntities: Number(row.workload_count), totalEntities: Number(row.total_count),
    logicalJsonBytes: Number(row.logical_bytes), physicalJsonbBytes: Number(row.physical_bytes),
  };
}

async function receipt(whereSql = "TRUE") {
  const r = await pool.query<{ count: string; digest: string }>(`
    SELECT COUNT(*) AS count,
           md5(string_agg(kind || ':' || id || ':' || resource_version || ':' || md5(data::text), '' ORDER BY kind,id)) AS digest
    FROM entities WHERE ${whereSql}
  `);
  return { count: Number(r.rows[0]!.count), digest: r.rows[0]!.digest };
}

const OLD_LIST_SQL = `
  WITH snapshot AS (SELECT COALESCE(MAX(resource_version),0) AS rv FROM entities),
       items AS (
         SELECT data,resource_version FROM entities
         WHERE kind=$1
           AND ($2::text IS NULL OR data#>>$3::text[]=$2)
           AND ($4::text IS NULL OR data#>>$5::text[]=$4)
         LIMIT 500
       )
  SELECT (SELECT rv FROM snapshot), (SELECT json_agg(data) FROM items)
`;

async function oldList(kind: string, value1?: string, path1: string[] = ["status","phase"], value2?: string, path2: string[] = ["status","currentTurn"]): Promise<void> {
  await pool.query(OLD_LIST_SQL, [kind, value1 ?? null, path1, value2 ?? null, path2]);
}

async function oldReconnect(): Promise<void> {
  await Promise.all([
    oldList("Mission"), oldList("Proposal"), oldList("Thread"),
    oldList("PendingAction", "agent-scale-1", ["spec","targetAgentId"]),
    oldList("PendingAction", "agent-scale-1", ["spec","targetAgentId"], "enqueued", ["status","phase"]),
    oldList("Agent"),
  ]);
}

async function newReconnect(): Promise<void> {
  const agent = await agentRepo.getAgentForSession("session-scale-current");
  if (agent?.id !== "agent-scale-1") throw new Error(`session parity failure: ${agent?.id}`);
  const queue = await pendingRepo.listForAgentComplete("agent-scale-1", { states: ["enqueued","receipt_acked"] });
  const proposals = await proposalRepo.getProposalsComplete("submitted");
  const approved = await proposalRepo.getProposalsComplete("approved");
  const threads = await threadRepo.listThreadsComplete("active", { currentTurn: "architect" });
  const converged = await threadRepo.listThreadsComplete("converged");
  const results = [queue.pageInfo, proposals.pageInfo, approved.pageInfo, threads.pageInfo, converged.pageInfo];
  if (results.some((result) => !result.complete)) throw new Error(`unexpected truncation: ${JSON.stringify(results)}`);
  // drain_pending_actions remains a separate target+enqueued query; this fixture
  // has 300 drain candidates, below one substrate page.
  await pendingRepo.listForAgent("agent-scale-1", { state: "enqueued" });
}

async function rows(kind: string): Promise<Record<string, unknown>[]> {
  const r = await pool.query<{ data: Record<string, unknown> }>("SELECT data FROM entities WHERE kind=$1 ORDER BY id", [kind]);
  return r.rows.map((row) => row.data);
}

function valueAt(value: Record<string, unknown>, ...parts: string[]): unknown {
  let current: unknown = value;
  for (const part of parts) current = current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined;
  return current;
}

function sortedIds(values: Array<{ id: string } | Record<string, unknown>>): string[] {
  return values.map((value) => String(value.id)).sort();
}

async function semanticParity() {
  const [proposalRows, threadRows, pendingRows] = await Promise.all([rows("Proposal"), rows("Thread"), rows("PendingAction")]);
  const submitted = await proposalRepo.getProposalsComplete("submitted");
  const active = await threadRepo.listThreadsComplete("active", { currentTurn: "architect" });
  const inFlight = await pendingRepo.listForAgentComplete("agent-scale-1", { states: ["enqueued","receipt_acked"] });
  const drain = await pendingRepo.listForAgentComplete("agent-scale-1", { state: "enqueued" });
  const approved = await proposalRepo.getProposalsComplete("approved");
  const converged = await threadRepo.listThreadsComplete("converged");
  const checks = {
    submittedProposals: JSON.stringify(sortedIds(proposalRows.filter((row) => valueAt(row,"status","phase") === "submitted"))) === JSON.stringify(sortedIds(submitted.items)),
    approvedProposals: JSON.stringify(sortedIds(proposalRows.filter((row) => valueAt(row,"status","phase") === "approved"))) === JSON.stringify(sortedIds(approved.items)),
    activeArchitectThreads: JSON.stringify(sortedIds(threadRows.filter((row) => valueAt(row,"status","phase") === "active" && valueAt(row,"status","currentTurn") === "architect"))) === JSON.stringify(sortedIds(active.items)),
    convergedThreads: JSON.stringify(sortedIds(threadRows.filter((row) => valueAt(row,"status","phase") === "converged"))) === JSON.stringify(sortedIds(converged.items)),
    inFlightQueue: JSON.stringify(sortedIds(pendingRows.filter((row) => valueAt(row,"spec","targetAgentId") === "agent-scale-1" && ["enqueued","receipt_acked"].includes(String(valueAt(row,"status","phase")))))) === JSON.stringify(sortedIds(inFlight.items)),
    drainQueue: JSON.stringify(sortedIds(pendingRows.filter((row) => valueAt(row,"spec","targetAgentId") === "agent-scale-1" && valueAt(row,"status","phase") === "enqueued"))) === JSON.stringify(sortedIds(drain.items)),
  };
  const dimensions = {
    submittedProposals: submitted.pageInfo,
    activeArchitectThreads: active.pageInfo,
    inFlightPendingActions: inFlight.pageInfo,
    approvedProposals: approved.pageInfo,
    convergedThreads: converged.pageInfo,
    drainQueue: drain.pageInfo,
  };
  const authoritative = {
    submittedProposals: proposalRows.filter((row) => valueAt(row,"status","phase") === "submitted").length,
    activeArchitectThreads: threadRows.filter((row) => valueAt(row,"status","phase") === "active" && valueAt(row,"status","currentTurn") === "architect").length,
    inFlightPendingActions: pendingRows.filter((row) => valueAt(row,"spec","targetAgentId") === "agent-scale-1" && ["enqueued","receipt_acked"].includes(String(valueAt(row,"status","phase")))).length,
  };
  const thresholdsMet = Object.entries(EXPECTED).every(([key, expected]) => authoritative[key as keyof typeof authoritative] >= expected);
  return { checks, all: Object.values(checks).every(Boolean), authoritative, thresholdsMet, dimensions };
}

async function explain(sql: string): Promise<unknown> {
  const result = await pool.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${sql}`);
  return result.rows[0]!["QUERY PLAN"][0];
}

function planNodes(plan: unknown) {
  const out: Array<Record<string, unknown>> = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node["Node Type"]) out.push({
      nodeType: node["Node Type"], relation: node["Relation Name"] ?? null,
      index: node["Index Name"] ?? null, actualRows: node["Actual Rows"] ?? null,
      sharedReadBlocks: node["Shared Read Blocks"] ?? null, sharedHitBlocks: node["Shared Hit Blocks"] ?? null,
    });
    for (const child of node.Plans ?? []) walk(child);
  };
  walk((plan as any)?.Plan);
  return out;
}

async function filteredPagePlan(kind: "Proposal" | "Thread" | "PendingAction") {
  const predicate = kind === "Proposal"
    ? `data#>>'{status,phase}'='submitted'`
    : kind === "Thread"
      ? `data#>>'{status,phase}'='active' AND data#>>'{status,currentTurn}'='architect'`
      : `data#>>'{spec,targetAgentId}'='agent-scale-1' AND data#>>'{status,phase}' IN ('enqueued','receipt_acked')`;
  return explain(`
    WITH snapshot AS (SELECT COALESCE((SELECT resource_version FROM entities ORDER BY resource_version DESC LIMIT 1),0) AS rv),
         items AS (SELECT data,resource_version FROM entities WHERE kind='${kind}' AND ${predicate} ORDER BY id ASC LIMIT 500 OFFSET 500)
    SELECT (SELECT rv FROM snapshot),(SELECT json_agg(data) FROM items)
  `);
}

async function main() {
  for (const file of ["001-entities-table.sql","002-notify-trigger.sql","003-jsonb-size-check.sql"]) {
    await pool.query(readFileSync(join(migrationsDir,file), "utf8"));
  }
  if (shouldSeed) await seedCorpus();

  substrate = createPostgresStorageSubstrate(connectionString, {
    max: 25, listMaxConcurrency: 4, listMaxQueued: Math.max(32, clients * 8), listAdmissionTimeoutMs: 60_000,
  });
  const subset = ALL_SCHEMAS.filter((schema) => ["SchemaDef","Agent","Mission","PendingAction","Proposal","Thread"].includes(schema.kind));
  reconciler = createSchemaReconciler(substrate, connectionString, {
    initialSchemas: subset, log: () => {}, warn: (message,error) => console.error(message,error ?? ""),
  });
  await reconciler.start();
  substrate.setFieldTranslator((kind,key) => reconciler!.getFieldTranslation(kind,key));
  const counter = new SubstrateCounter(substrate);
  proposalRepo = new ProposalRepositorySubstrate(substrate,counter);
  threadRepo = new ThreadRepositorySubstrate(substrate,counter);
  pendingRepo = new PendingActionRepositorySubstrate(substrate,counter);
  agentRepo = new AgentRepositorySubstrate(substrate);
  await pool.query("ANALYZE entities");

  cpuStatPath = resolveContainerCpuStatPath();
  if (requireCpu && !cpuStatPath) throw new Error(`required container CPU cgroup unavailable for ${dockerContainer ?? "(unset)"}`);

  const stats = await corpusStats();
  if (stats.workloadEntities < MIN_ENTITIES) throw new Error(`entity floor failed: ${stats.workloadEntities}`);
  if (stats.logicalJsonBytes < MIN_JSON_BYTES) throw new Error(`logical JSON floor failed: ${stats.logicalJsonBytes}`);
  if (stats.physicalJsonbBytes < MIN_JSON_BYTES) throw new Error(`physical JSONB floor failed: ${stats.physicalJsonbBytes}`);

  const [beforeHistory,beforeData] = await Promise.all([receipt("kind='Audit'"),receipt()]);
  const parity = await semanticParity();
  if (!parity.all || !parity.thresholdsMet) throw new Error(`over-cap parity failed: ${JSON.stringify(parity)}`);

  await oldReconnect();
  await newReconnect();
  const preFix = await measurePhase("pre-fix-capped-fanout", oldReconnect, clients * 6);
  // Warmup rehydrates the process-local session map, so the measured post phase
  // issues nine admitted list queries per reconnect (2+2+1+2+1 paged aggregate,
  // plus one drain page). The store-free clock and cached session add zero SQL.
  const postFix = await measurePhase("post-fix-complete-paging", newReconnect, clients * 9);
  if (preFix.reconnects.errors || postFix.reconnects.errors) throw new Error("measured reconnect phase contained errors");
  if (postFix.listAdmission.highWaterActive > postFix.listAdmission.maxActive) throw new Error("admission active high-water exceeded bound");
  if (requireCpu && (!preFix.databaseCpu.available || !postFix.databaseCpu.available)) throw new Error("phase CPU evidence unavailable");

  const [afterHistory,afterData,afterStats] = await Promise.all([receipt("kind='Audit'"),receipt(),corpusStats()]);
  const historyPreserved = beforeHistory.count === afterHistory.count && beforeHistory.digest === afterHistory.digest;
  const dataPreserved = beforeData.count === afterData.count && beforeData.digest === afterData.digest;
  if (!historyPreserved || !dataPreserved) throw new Error("data/history preservation invariant failed");

  const [prePlan,proposalPlan,threadPlan,pendingPlan] = await Promise.all([
    explain(`WITH snapshot AS (SELECT COALESCE(MAX(resource_version),0) AS rv FROM entities), items AS (SELECT data,resource_version FROM entities WHERE kind='Mission' LIMIT 500) SELECT (SELECT rv FROM snapshot),(SELECT json_agg(data) FROM items)`),
    filteredPagePlan("Proposal"), filteredPagePlan("Thread"), filteredPagePlan("PendingAction"),
  ]);
  const plans = {
    preFix: planNodes(prePlan),
    completePaging: {
      Proposal: planNodes(proposalPlan), Thread: planNodes(threadPlan), PendingAction: planNodes(pendingPlan),
    },
  };
  const postPlanNodes = Object.values(plans.completePaging).flat();
  if (postPlanNodes.some((node) => node.nodeType === "Seq Scan")) throw new Error("post-fix complete paging plan contains Seq Scan");

  const trace = {
    bug: "bug-343", workItem: "work-470", predecessorCommit: "be7272dd7e19fd9e91c351d7f9905e834b1d8772",
    profile, measuredAt: new Date().toISOString(), clients,
    corpus: stats,
    overCap: parity,
    phases: { preFix, postFix },
    preservation: {
      beforeHistory, afterHistory, historyPreserved,
      beforeData, afterData, dataPreserved,
      beforeTotal: stats.totalEntities, afterTotal: afterStats.totalEntities,
      noRowsDeleted: stats.totalEntities === afterStats.totalEntities,
    },
    plans,
    cpuEvidence: { container: dockerContainer ?? null, cgroupCpuStatPath: cpuStatPath, cgroupFormat: cpuStatFormat, required: requireCpu },
    notes: [
      "all accepted pages in a dimension share one substrate high-water revision and immutable id order",
      "675/650/600 dimensions reconstruct in two pages; exact counts are emitted only when complete",
      "pre/post CPU and list-admission observations are reset and measured in distinct phases",
      "history and whole-dataset digests cover id/resourceVersion/data before and after",
      "setup TRUNCATE is confined to the explicitly ephemeral scale database",
    ],
  };
  const rendered = JSON.stringify(trace,null,2) + "\n";
  if (traceOut) await writeFile(traceOut,rendered,"utf8");
  process.stdout.write(rendered);
}

let failure: unknown;
try {
  await main();
} catch (error) {
  failure = error;
  if (failedOut) {
    await writeFile(failedOut, JSON.stringify({
      bug: "bug-343", workItem: "work-470", profile, failedAt: new Date().toISOString(),
      error: String(error), stack: error instanceof Error ? error.stack : null,
    }, null, 2) + "\n", "utf8");
  }
} finally {
  await reconciler?.close().catch(() => {});
  await substrate?.close().catch(() => {});
  await pool.end().catch(() => {});
}
if (failure) throw failure;
