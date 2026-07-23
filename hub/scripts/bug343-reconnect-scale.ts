#!/usr/bin/env tsx
/**
 * bug-343/work-472 real-PostgreSQL aggregate-snapshot coherence trace.
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
 * PendingAction. It repeatedly recreates the verifier's exact rv 212212→212213
 * thread-scale-0601 insertion, then proves whole-aggregate retry success and
 * bounded actionless exhaustion. Total workload remains above 210,781 rows and
 * physical JSONB remains above 310 MiB.
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
import { PolicyRouter } from "../src/policy/router.js";
import { registerSystemPolicy } from "../src/policy/system-policy.js";
import type { AllStores, IPolicyContext } from "../src/policy/types.js";

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
const COHERENCE_BASE_REVISION = 212_212;
const COHERENCE_MUTATION_REVISION = 212_213;
const FALSIFIER_REPETITIONS = 6;
const RETRY_SUCCESS_REPETITIONS = 10;
const RETRY_EXHAUSTION_REPETITIONS = 6;

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
  // Ephemeral fixture reset must also reset the global RV sequence; otherwise a
  // second profile's deterministic 212212→212213 falsifier inherits the prior
  // run's consumed revisions even though every entity row was removed.
  await pool.query("TRUNCATE TABLE entities RESTART IDENTITY");
  await pool.query("SELECT setval('entities_rv_seq',1,false)");

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

async function unfencedReconnect(): Promise<void> {
  const agent = await agentRepo.getAgentForSession("session-scale-current");
  if (agent?.id !== "agent-scale-1") throw new Error(`session parity failure: ${agent?.id}`);
  const queue = await pendingRepo.listForAgentComplete("agent-scale-1", { states: ["enqueued","receipt_acked"] });
  const proposals = await proposalRepo.getProposalsComplete("submitted");
  const approved = await proposalRepo.getProposalsComplete("approved");
  const threads = await threadRepo.listThreadsComplete("active", { currentTurn: "architect" });
  const converged = await threadRepo.listThreadsComplete("converged");
  const results = [queue.pageInfo, proposals.pageInfo, approved.pageInfo, threads.pageInfo, converged.pageInfo];
  if (results.some((result) => !result.complete)) throw new Error(`unexpected unfenced truncation: ${JSON.stringify(results)}`);
  await pendingRepo.listForAgent("agent-scale-1", { state: "enqueued" });
}

async function coherentReconnect(): Promise<void> {
  const agent = await agentRepo.getAgentForSession("session-scale-current");
  if (agent?.id !== "agent-scale-1") throw new Error(`session parity failure: ${agent?.id}`);
  const queue = await pendingRepo.listForAgentComplete("agent-scale-1", { states: ["enqueued","receipt_acked"] });
  const expectedRevision = queue.pageInfo.snapshotRevision;
  const proposals = await proposalRepo.getProposalsComplete("submitted", expectedRevision);
  const approved = await proposalRepo.getProposalsComplete("approved", expectedRevision);
  const threads = await threadRepo.listThreadsComplete("active", { currentTurn: "architect" }, expectedRevision);
  const converged = await threadRepo.listThreadsComplete("converged", undefined, expectedRevision);
  const results = [queue.pageInfo, proposals.pageInfo, approved.pageInfo, threads.pageInfo, converged.pageInfo];
  if (results.some((result) => !result.complete || result.snapshotRevision !== expectedRevision)) {
    throw new Error(`unexpected coherent truncation: ${JSON.stringify(results)}`);
  }
  // drain_pending_actions remains a separate target+enqueued operation and is
  // not one of get_pending_actions' action-derivation dimensions.
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
  const inFlight = await pendingRepo.listForAgentComplete("agent-scale-1", { states: ["enqueued","receipt_acked"] });
  const expectedRevision = inFlight.pageInfo.snapshotRevision;
  const submitted = await proposalRepo.getProposalsComplete("submitted", expectedRevision);
  const active = await threadRepo.listThreadsComplete("active", { currentTurn: "architect" }, expectedRevision);
  const drain = await pendingRepo.listForAgentComplete("agent-scale-1", { state: "enqueued" }, expectedRevision);
  const approved = await proposalRepo.getProposalsComplete("approved", expectedRevision);
  const converged = await threadRepo.listThreadsComplete("converged", undefined, expectedRevision);
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

async function prepareCoherenceBaseline(): Promise<void> {
  await pool.query("DELETE FROM entities WHERE kind='PendingAction' AND id LIKE 'pa-coherence-mutation-%'");
  const existing = await pool.query<{ resource_version: string }>(
    "SELECT resource_version FROM entities WHERE kind='PendingAction' AND id='pa-coherence-sentinel'",
  );
  if (existing.rowCount === 0) {
    const max = await pool.query<{ rv: string }>("SELECT COALESCE(MAX(resource_version),0) AS rv FROM entities");
    if (Number(max.rows[0]!.rv) >= COHERENCE_BASE_REVISION) {
      throw new Error(`cannot establish exact rv baseline: existing max=${max.rows[0]!.rv}`);
    }
    await pool.query("SELECT setval('entities_rv_seq',$1,true)", [COHERENCE_BASE_REVISION - 1]);
    const inserted = await pool.query<{ resource_version: string }>(`
      INSERT INTO entities(kind,id,data) VALUES(
        'PendingAction','pa-coherence-sentinel',
        jsonb_build_object(
          'apiVersion','core.ois/v1','kind','PendingAction','id','pa-coherence-sentinel','name','pa-coherence-sentinel',
          'metadata',jsonb_build_object('createdAt','2026-07-23T00:00:00.000Z','naturalKey','coherence-control:sentinel:thread_message'),
          'spec',jsonb_build_object('targetAgentId','coherence-control','dispatchType','thread_message','entityRef','thread-scale-control','payload','{}'::jsonb),
          'status',jsonb_build_object('phase','completion_acked','attemptCount',0)
        )
      ) RETURNING resource_version
    `);
    if (Number(inserted.rows[0]!.resource_version) !== COHERENCE_BASE_REVISION) {
      throw new Error(`sentinel revision mismatch: ${inserted.rows[0]!.resource_version}`);
    }
  }
  await resetCoherenceBaseline();
}

async function resetCoherenceBaseline(): Promise<void> {
  await pool.query("DELETE FROM entities WHERE kind='PendingAction' AND id LIKE 'pa-coherence-mutation-%'");
  await pool.query("SELECT setval('entities_rv_seq',$1,true)", [COHERENCE_BASE_REVISION]);
  const state = await pool.query<{ rv: string; markers: string }>(`
    SELECT COALESCE(MAX(resource_version),0) AS rv,
           COUNT(*) FILTER (WHERE kind='PendingAction' AND id LIKE 'pa-coherence-mutation-%') AS markers
    FROM entities
  `);
  if (Number(state.rows[0]!.rv) !== COHERENCE_BASE_REVISION || Number(state.rows[0]!.markers) !== 0) {
    throw new Error(`coherence reset failed: ${JSON.stringify(state.rows[0])}`);
  }
}

async function insertRelevantMutation(tag: string, threadNumber: number): Promise<number> {
  const threadId = `thread-scale-${String(threadNumber).padStart(4,"0")}`;
  const id = `pa-coherence-mutation-${tag}`;
  const inserted = await pool.query<{ resource_version: string }>(`
    INSERT INTO entities(kind,id,data) VALUES(
      'PendingAction',$1,
      jsonb_build_object(
        'apiVersion','core.ois/v1','kind','PendingAction','id',$1::text,'name',$1::text,
        'metadata',jsonb_build_object('createdAt','2026-07-23T00:00:00.000Z','naturalKey','agent-scale-1:' || $2::text || ':thread_message'),
        'spec',jsonb_build_object('targetAgentId','agent-scale-1','dispatchType','thread_message','entityRef',$2::text,'payload','{}'::jsonb),
        'status',jsonb_build_object('phase','receipt_acked','attemptCount',0)
      )
    ) RETURNING resource_version
  `, [id, threadId]);
  return Number(inserted.rows[0]!.resource_version);
}

async function authoritativeAggregate() {
  const counts = await pool.query<{ proposals: string; threads: string; in_flight: string; awaiting: string; total: string }>(`
    WITH proposals AS (
      SELECT id FROM entities WHERE kind='Proposal' AND data#>>'{status,phase}'='submitted'
    ), threads AS (
      SELECT id FROM entities WHERE kind='Thread' AND data#>>'{status,phase}'='active' AND data#>>'{status,currentTurn}'='architect'
    ), in_flight AS (
      SELECT data#>>'{spec,entityRef}' AS thread_id FROM entities
      WHERE kind='PendingAction' AND data#>>'{spec,targetAgentId}'='agent-scale-1'
        AND data#>>'{status,phase}' IN ('enqueued','receipt_acked')
    ), awaiting AS (
      SELECT id FROM threads WHERE id NOT IN (SELECT thread_id FROM in_flight)
    )
    SELECT (SELECT COUNT(*) FROM proposals) AS proposals,
           (SELECT COUNT(*) FROM threads) AS threads,
           (SELECT COUNT(*) FROM in_flight) AS in_flight,
           (SELECT COUNT(*) FROM awaiting) AS awaiting,
           (SELECT COUNT(*) FROM proposals) + (SELECT COUNT(*) FROM awaiting) AS total
  `);
  const ids = await pool.query<{ kind: string; id: string }>(`
    WITH in_flight AS (
      SELECT data#>>'{spec,entityRef}' AS thread_id FROM entities
      WHERE kind='PendingAction' AND data#>>'{spec,targetAgentId}'='agent-scale-1'
        AND data#>>'{status,phase}' IN ('enqueued','receipt_acked')
    )
    SELECT 'proposal' AS kind,id FROM entities
      WHERE kind='Proposal' AND data#>>'{status,phase}'='submitted'
    UNION ALL
    SELECT 'thread' AS kind,id FROM entities
      WHERE kind='Thread' AND data#>>'{status,phase}'='active' AND data#>>'{status,currentTurn}'='architect'
        AND id NOT IN (SELECT thread_id FROM in_flight)
    ORDER BY kind,id
  `);
  const row = counts.rows[0]!;
  return {
    proposals: Number(row.proposals),
    threads: Number(row.threads),
    inFlight: Number(row.in_flight),
    awaiting: Number(row.awaiting),
    total: Number(row.total),
    proposalIds: ids.rows.filter((value) => value.kind === "proposal").map((value) => value.id),
    threadIds: ids.rows.filter((value) => value.kind === "thread").map((value) => value.id),
  };
}

async function invokeAggregate(
  afterQueueRead?: (call: number, snapshotRevision: string) => Promise<void>,
): Promise<Record<string, any>> {
  let queueCalls = 0;
  const pendingAction = {
    listForAgentComplete: async (...args: Parameters<PendingActionRepositorySubstrate["listForAgentComplete"]>) => {
      const value = await pendingRepo.listForAgentComplete(...args);
      queueCalls++;
      await afterQueueRead?.(queueCalls, value.pageInfo.snapshotRevision);
      return value;
    },
  };
  const stores = {
    engineerRegistry: {
      getRole: () => "architect",
      getAgentForSession: async () => ({ id: "agent-scale-1", currentSessionId: "session-scale-current" }),
    },
    pendingAction,
    proposal: proposalRepo,
    thread: threadRepo,
  } as unknown as AllStores;
  const ctx = {
    stores, emit: async () => {}, dispatch: async () => {},
    sessionId: "session-scale-current", clientIp: "127.0.0.1", role: "architect",
    internalEvents: [], metrics: { increment: () => {}, snapshot: () => ({}), recentDetails: () => [] },
  } as unknown as IPolicyContext;
  const router = new PolicyRouter(() => {});
  registerSystemPolicy(router);
  const response = await router.handle("get_pending_actions", {}, ctx);
  return JSON.parse(response.content[0]!.text) as Record<string, any>;
}

async function runCoherenceProbes() {
  const predecessorFalsifier: Array<Record<string, unknown>> = [];
  for (let iteration = 1; iteration <= FALSIFIER_REPETITIONS; iteration++) {
    await resetCoherenceBaseline();
    const queue = await pendingRepo.listForAgentComplete("agent-scale-1", { states: ["enqueued","receipt_acked"] });
    const mutationRevision = await insertRelevantMutation(`falsifier-${iteration}`, 601);
    const proposals = await proposalRepo.getProposalsComplete("submitted");
    const threads = await threadRepo.listThreadsComplete("active", { currentTurn: "architect" });
    const inFlightIds = new Set(queue.items.map((item) => item.entityRef));
    const mixedTotal = proposals.items.length + threads.items.filter((thread) => !inFlightIds.has(thread.id)).length;
    const authoritative = await authoritativeAggregate();
    const row = {
      iteration,
      queueRevision: Number(queue.pageInfo.snapshotRevision),
      proposalRevision: Number(proposals.pageInfo.snapshotRevision),
      threadRevision: Number(threads.pageInfo.snapshotRevision),
      mutationRevision,
      insertedEntityRef: "thread-scale-0601",
      queueCountBeforeWrite: queue.items.length,
      mixedTotal,
      authoritative,
      falseExactDelta: mixedTotal - authoritative.total,
      defectReproduced: mixedTotal === 725 && authoritative.total === 724,
    };
    predecessorFalsifier.push(row);
    if (
      row.queueRevision !== COHERENCE_BASE_REVISION
      || mutationRevision !== COHERENCE_MUTATION_REVISION
      || !row.defectReproduced
    ) throw new Error(`predecessor falsifier failed: ${JSON.stringify(row)}`);
  }

  const retrySuccess: Array<Record<string, unknown>> = [];
  for (let iteration = 1; iteration <= RETRY_SUCCESS_REPETITIONS; iteration++) {
    await resetCoherenceBaseline();
    const body = await invokeAggregate(async (call, revision) => {
      if (call !== 1) return;
      if (Number(revision) !== COHERENCE_BASE_REVISION) throw new Error(`retry anchor mismatch: ${revision}`);
      const inserted = await insertRelevantMutation(`retry-success-${iteration}`, 601);
      if (inserted !== COHERENCE_MUTATION_REVISION) throw new Error(`retry mutation mismatch: ${inserted}`);
    });
    const authoritative = await authoritativeAggregate();
    const outwardProposalIds = (body.pendingProposals as Array<{ proposalId: string }>).map((value) => value.proposalId).sort();
    const outwardThreadIds = (body.threadsAwaitingReply as Array<{ threadId: string }>).map((value) => value.threadId).sort();
    const attempts = body.retrieval.aggregateSnapshot.attempts as Array<Record<string, any>>;
    const membershipExact = JSON.stringify(outwardProposalIds) === JSON.stringify(authoritative.proposalIds)
      && JSON.stringify(outwardThreadIds) === JSON.stringify(authoritative.threadIds);
    const row = {
      iteration,
      complete: body.complete,
      totalPending: body.totalPending,
      snapshotRevision: Number(body.snapshotRevision),
      attemptsUsed: body.retrieval.aggregateSnapshot.attemptsUsed,
      firstTransition: {
        anchor: Number(attempts[0]!.anchorRevision),
        proposalObserved: Number(attempts[0]!.observedRevisions.pendingProposals),
      },
      authoritative,
      membershipExact,
    };
    retrySuccess.push(row);
    if (
      body.complete !== true
      || body.totalPending !== 724
      || Number(body.snapshotRevision) !== COHERENCE_MUTATION_REVISION
      || row.attemptsUsed !== 2
      || row.firstTransition.anchor !== COHERENCE_BASE_REVISION
      || row.firstTransition.proposalObserved !== COHERENCE_MUTATION_REVISION
      || !membershipExact
    ) throw new Error(`coherent retry failed: ${JSON.stringify(row)}`);
  }

  const retryExhaustion: Array<Record<string, unknown>> = [];
  for (let iteration = 1; iteration <= RETRY_EXHAUSTION_REPETITIONS; iteration++) {
    await resetCoherenceBaseline();
    const body = await invokeAggregate(async (call, revision) => {
      const expectedAnchor = COHERENCE_BASE_REVISION + call - 1;
      if (Number(revision) !== expectedAnchor) throw new Error(`exhaustion anchor mismatch: ${revision} != ${expectedAnchor}`);
      const inserted = await insertRelevantMutation(`retry-exhaust-${iteration}-${call}`, 600 + call);
      if (inserted !== expectedAnchor + 1) throw new Error(`exhaustion mutation mismatch: ${inserted}`);
    });
    const authoritative = await authoritativeAggregate();
    const attempts = body.retrieval.aggregateSnapshot.attempts as Array<Record<string, any>>;
    const actionless = body.pendingProposals.length === 0
      && body.threadsAwaitingReply.length === 0
      && body.convergedThreads.length === 0;
    const row = {
      iteration,
      complete: body.complete,
      totalPending: body.totalPending,
      visiblePending: body.visiblePending,
      reason: body.retrieval.reason,
      attemptsUsed: body.retrieval.aggregateSnapshot.attemptsUsed,
      anchors: attempts.map((attempt) => Number(attempt.anchorRevision)),
      firstObservedProposalRevision: Number(attempts[0]!.observedRevisions.pendingProposals),
      authoritative,
      actionless,
    };
    retryExhaustion.push(row);
    if (
      body.complete !== false
      || body.totalPending !== null
      || body.visiblePending !== null
      || row.reason !== "aggregate_snapshot_retry_exhausted"
      || row.attemptsUsed !== 3
      || JSON.stringify(row.anchors) !== JSON.stringify([212212,212213,212214])
      || row.firstObservedProposalRevision !== COHERENCE_MUTATION_REVISION
      || !actionless
    ) throw new Error(`retry exhaustion contract failed: ${JSON.stringify(row)}`);
  }
  await resetCoherenceBaseline();
  return {
    predecessorFalsifier: {
      repetitions: FALSIFIER_REPETITIONS,
      allReproduced: predecessorFalsifier.every((row) => row.defectReproduced === true),
      runs: predecessorFalsifier,
    },
    retrySuccess: {
      repetitions: RETRY_SUCCESS_REPETITIONS,
      allExact: retrySuccess.every((row) => row.complete === true && row.membershipExact === true),
      runs: retrySuccess,
    },
    retryExhaustion: {
      repetitions: RETRY_EXHAUSTION_REPETITIONS,
      allLoudAndActionless: retryExhaustion.every((row) => row.reason === "aggregate_snapshot_retry_exhausted" && row.actionless === true),
      runs: retryExhaustion,
    },
  };
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
  await prepareCoherenceBaseline();
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
  const aggregateCoherence = await runCoherenceProbes();

  await unfencedReconnect();
  await coherentReconnect();
  // Both quiescent phases execute the same complete >500 pages. This isolates
  // the aggregate high-water fence itself rather than hiding CPU behind fewer
  // queries or serialized phase differences.
  const preFix = await measurePhase("predecessor-unfenced-complete-paging", unfencedReconnect, clients * 9);
  const postFix = await measurePhase("successor-coherent-complete-paging", coherentReconnect, clients * 9);
  if (preFix.reconnects.errors || postFix.reconnects.errors) throw new Error("measured reconnect phase contained errors");
  if (postFix.listAdmission.highWaterActive > postFix.listAdmission.maxActive) throw new Error("admission active high-water exceeded bound");
  if (requireCpu && (!preFix.databaseCpu.available || !postFix.databaseCpu.available)) throw new Error("phase CPU evidence unavailable");

  const [afterHistory,afterData,afterStats] = await Promise.all([receipt("kind='Audit'"),receipt(),corpusStats()]);
  const historyPreserved = beforeHistory.count === afterHistory.count && beforeHistory.digest === afterHistory.digest;
  const dataPreserved = beforeData.count === afterData.count && beforeData.digest === afterData.digest;
  if (!historyPreserved || !dataPreserved) throw new Error("data/history preservation invariant failed");

  const [highWaterPlan,proposalPlan,threadPlan,pendingPlan] = await Promise.all([
    explain(`SELECT resource_version FROM entities ORDER BY resource_version DESC LIMIT 1`),
    filteredPagePlan("Proposal"), filteredPagePlan("Thread"), filteredPagePlan("PendingAction"),
  ]);
  const plans = {
    highWater: planNodes(highWaterPlan),
    completePaging: {
      Proposal: planNodes(proposalPlan), Thread: planNodes(threadPlan), PendingAction: planNodes(pendingPlan),
    },
  };
  const postPlanNodes = Object.values(plans.completePaging).flat();
  if (postPlanNodes.some((node) => node.nodeType === "Seq Scan")) throw new Error("post-fix complete paging plan contains Seq Scan");

  const trace = {
    bug: "bug-343", workItem: "work-472", predecessorCommit: "21a42ad0363454d7f794c28837e50bab0f8a9883",
    profile, measuredAt: new Date().toISOString(), clients,
    corpus: stats,
    overCap: parity,
    aggregateCoherence,
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
      "all accepted pages and all get_pending_actions dimensions share one queue-anchored substrate high-water",
      "the exact rv212212→212213 thread-scale-0601 predecessor falsifier is repeated, then successor retry and exhaustion are repeated independently",
      "675/650/600 dimensions reconstruct in two pages; exact counts are emitted only when the whole aggregate is coherent",
      "pre/post CPU and list-admission observations are reset, phase-separated, and execute identical quiescent query counts",
      "history and whole-dataset digests cover id/resourceVersion/data before and after all mutation probes; marker rows are confined to the ephemeral database and absent from both final receipts",
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
      bug: "bug-343", workItem: "work-472", profile, failedAt: new Date().toISOString(),
      error: String(error), stack: error instanceof Error ? error.stack : null,
    }, null, 2) + "\n", "utf8");
  }
} finally {
  await reconciler?.close().catch(() => {});
  await substrate?.close().catch(() => {});
  await pool.end().catch(() => {});
}
if (failure) throw failure;
