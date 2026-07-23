import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import {
  ALL_SCHEMAS,
  buildEnvelopeWriteEncoder,
  createPostgresStorageSubstrate,
  createSchemaReconciler,
  type PostgresSubstrate,
  type SchemaReconciler,
} from "../index.js";
import { createTestPool } from "./_pg-test-pool.js";
import { decodeEnvelopeToFlat } from "../../entities/shape-helpers.js";
import {
  WORK_REVISION_KINDS,
  WorkRevisionStorageRepositoryV4,
  buildWorkRevisionStorageV4,
  type WorkGraphTopologyEdgeV4,
} from "../../entities/work-revision-storage-v4.js";
import type { WorkItem } from "../../entities/work-item.js";

const SETUP_TIMEOUT = 120_000;
const OP_TIMEOUT = 120_000;
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];
const NOW = "2026-07-23T16:00:00.000Z";

function work(id: string): WorkItem {
  return {
    id,
    type: "task",
    priority: "normal",
    roleEligibility: ["engineer"],
    dependsOn: [],
    completionDependsOn: [],
    evidenceRequirements: [],
    references: [],
    targetRef: { kind: "mission", id: "mission-140" },
    status: "ready",
    lease: null,
    evidence: [],
    frictionReflections: [],
    blockedOn: null,
    leaseExpiryCount: 0,
    enteredCurrentStateAt: NOW,
    stateDurations: { ready: 0, claimed: 0, in_progress: 0, blocked: 0, paused: 0, review: 0 },
    attestationHistory: [],
    attestations: {},
    executorHistory: [],
    createdBy: { role: "architect", agentId: "architect-1" },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("Mission-140 revision storage real PostgreSQL", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let substrate: PostgresSubstrate;
  let reconciler: SchemaReconciler;
  let repo: WorkRevisionStorageRepositoryV4;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    const conn = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = createTestPool(conn, "work-revision-storage-pg");
    for (const file of MIGRATION_FILES) await pool.query(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    substrate = createPostgresStorageSubstrate(conn);
    const kinds = new Set(["SchemaDef", "WorkItem", ...Object.values(WORK_REVISION_KINDS)]);
    reconciler = createSchemaReconciler(substrate, conn, {
      initialSchemas: ALL_SCHEMAS.filter((schema) => kinds.has(schema.kind)),
      log: () => {},
      warn: () => {},
    });
    await reconciler.start();
    substrate.setFieldTranslator((kind, key) => reconciler.getFieldTranslation(kind, key));
    substrate.setPartitionedKindCheck((kind) => reconciler.hasTranslations(kind));
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    repo = new WorkRevisionStorageRepositoryV4(substrate);
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    if (reconciler) await reconciler.close();
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, OP_TIMEOUT);

  it("round-trips revision identity in spec and recall/outbox authority in status (preserve-not-inject)", async () => {
    const item = work("physical-1");
    Object.assign(item, {
      logicalId: "logical-1",
      revision: 2,
      predecessorPhysicalId: "physical-0",
      revisionGeneration: 7,
      nodeContractHashVersion: "node-contract-v4",
      nodeContractHash: "1".repeat(64),
      nodeTopologyHashVersion: "node-topology-v4",
      nodeTopologyHash: "2".repeat(64),
      boundReferences: [],
      localExecutionIdentity: "3".repeat(64),
      topologyGeneration: 7,
      recallHistory: [{
        operationId: "pause-1", requestHash: "5".repeat(64), actor: { role: "architect", agentId: "architect-1" },
        reason: "revision", recalledAt: NOW, beforeStateHash: "4".repeat(64), holderNoticeIntentId: "intent-1",
        before: {
          physicalId: "physical-1", logicalId: "logical-1", revision: 2, topologyGeneration: 7,
          phase: "claimed", resourceVersion: "rv-before", stateHash: "4".repeat(64), blockedOn: null,
          lease: { holder: "agent-1", claimedAt: NOW, expiresAt: NOW, heartbeatAt: NOW, tokenFingerprint: "6".repeat(64) },
        },
      }],
      pendingRecallIntents: [{
        intentId: "intent-1", operationId: "pause-1", exactHolderAgentId: "agent-1",
        beforeStateHash: "4".repeat(64), createdAt: NOW, projectedMessageId: null, projectedAt: null,
      }],
      recallNoticePending: true,
    });
    await substrate.put("WorkItem", item);
    const raw = await substrate.get<Record<string, unknown>>("WorkItem", item.id);
    expect((raw!.spec as Record<string, unknown>).logicalId).toBe("logical-1");
    expect((raw!.spec as Record<string, unknown>).boundReferences).toEqual([]);
    expect((raw!.status as Record<string, unknown>).recallHistory).toHaveLength(1);
    expect((raw!.status as Record<string, unknown>).pendingRecallIntents).toHaveLength(1);
    const flat = decodeEnvelopeToFlat(raw!, "WorkItem") as unknown as WorkItem;
    expect(flat).toMatchObject({ logicalId: "logical-1", revision: 2, topologyGeneration: 7 });
    expect(flat.recallHistory).toHaveLength(1);
  }, OP_TIMEOUT);

  it("uses complete indexed reverse-edge traversal beyond the 500-row substrate page cap", async () => {
    const edges: WorkGraphTopologyEdgeV4[] = Array.from({ length: 611 }, (_, index) => ({
      id: `edge-${String(index).padStart(4, "0")}`,
      generation: 7,
      edgeClass: "dependsOn",
      sourceLogicalId: `source-${String(index).padStart(4, "0")}`,
      targetLogicalId: "target",
    }));
    for (let offset = 0; offset < edges.length; offset += 25) {
      await Promise.all(edges.slice(offset, offset + 25).map((edge) => substrate.createOnly(WORK_REVISION_KINDS.edge, edge)));
    }
    const sources = await repo.listReverseSources(7, "target", "dependsOn");
    expect(sources).toHaveLength(611);
    expect(sources[0]).toBe("source-0000");
    expect(sources.at(-1)).toBe("source-0610");
  }, OP_TIMEOUT);

  it("serializes concurrent physical revision allocation monotonically under real PostgreSQL advisory lock", async () => {
    const identity = {
      logicalId: "pg-family-concurrent",
      originPhysicalId: "pg-family-concurrent-rev-1",
      originalCreatedBy: { role: "architect", agentId: "architect-1" },
      familyScope: { kind: "mission" as const, id: "mission-140" },
      createdAt: NOW,
    };
    const allocated = await Promise.all(Array.from({ length: 16 }, () => repo.allocateNextRevision(identity)));
    expect(allocated.map((entry) => entry.revision).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, index) => index + 1),
    );
    expect((await repo.getFamily(identity.logicalId))!.latestAllocatedRevision).toBe(16);
  }, OP_TIMEOUT);

  it("publishes a prepared generation by one global head CAS and reads an integrity-guarded snapshot", async () => {
    const item = work("one");
    const built = buildWorkRevisionStorageV4({
      workItems: [item],
      boundReferencesByPhysicalId: { one: [] },
      familyScopesByPhysicalId: { one: { kind: "mission", id: "mission-140" } },
      generation: 1,
      previousGeneration: 0,
      operationId: "pg-bootstrap-1",
      createdAt: NOW,
    });
    await repo.persistPrepared(built);
    await repo.persistProjectedWorkItems(built);
    const head = await repo.activateGeneration(1, "pg-bootstrap-1", NOW);
    expect(head).toMatchObject({ generation: 1, operationId: "pg-bootstrap-1" });
    const snapshot = await repo.readSnapshot(1);
    expect(snapshot.generation.topologyHash).toBe(head.topologyHash);
    expect(snapshot.operation.state).toBe("committed");
    expect(snapshot.families).toHaveLength(1);
  }, OP_TIMEOUT);

  it("real-PG EXPLAIN uses reverse, family-scope, operation, notice, and recall indexes", async () => {
    // Give the planner a realistic selective distribution: one embedded recall
    // among many WorkItems, rather than an empty/two-row table where any partial
    // WorkItem index is cost-equivalent.
    const decoys = Array.from({ length: 300 }, (_, index) => work(`plan-decoy-${index}`));
    for (let offset = 0; offset < decoys.length; offset += 25) {
      await Promise.all(decoys.slice(offset, offset + 25).map((item) => substrate.createOnly("WorkItem", item)));
    }
    await pool.query(`ANALYZE entities`);
    await pool.query(`SET enable_seqscan = off`);
    const plans: Array<[string, string]> = [
      ["worktopoedge_reverse_idx", `SELECT id FROM entities WHERE kind='WorkGraphTopologyEdge' AND data#>>'{spec,generation}'='7' AND data#>>'{spec,targetLogicalId}'='target' AND data#>>'{spec,edgeClass}'='dependsOn'`],
      ["workrevfamily_spec_scope_idx", `SELECT id FROM entities WHERE kind='WorkRevisionFamily' AND data#>>'{spec,familyScope,kind}'='mission' AND data#>>'{spec,familyScope,id}'='mission-140'`],
      ["workrevop_spec_generation_idx", `SELECT id FROM entities WHERE kind='WorkGraphRevisionOperation' AND data#>>'{spec,generation}'='1'`],
      ["workrevnotice_status_projected_idx", `SELECT id FROM entities WHERE kind='WorkGraphRevisionNotice' AND data#>>'{status,projected}'='false'`],
      ["workitem_status_recallhistory_gin_idx", `SELECT id FROM entities WHERE kind='WorkItem' AND data#>'{status,recallHistory}' @> '[{"operationId":"pause-1"}]'::jsonb`],
      ["workitem_status_pendingrecallintents_gin_idx", `SELECT id FROM entities WHERE kind='WorkItem' AND data#>'{status,pendingRecallIntents}' @> '[{"intentId":"intent-1"}]'::jsonb`],
      ["workitem_status_recallnoticepending_idx", `SELECT id FROM entities WHERE kind='WorkItem' AND data#>>'{status,recallNoticePending}'='true'`],
    ];
    for (const [indexName, sql] of plans) {
      const result = await pool.query<{ "QUERY PLAN": string }>(`EXPLAIN (COSTS OFF) ${sql}`);
      expect(result.rows.map((row) => row["QUERY PLAN"]).join("\n"), `${indexName} not used`).toContain(indexName);
    }
    await pool.query(`RESET enable_seqscan`);
  }, OP_TIMEOUT);
});
