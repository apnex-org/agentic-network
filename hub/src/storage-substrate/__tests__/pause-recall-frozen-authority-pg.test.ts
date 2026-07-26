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
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import type { WorkItem } from "../../entities/work-item.js";
import { WorkItemRepositorySubstrate } from "../../entities/work-item-repository-substrate.js";
import {
  WORK_REVISION_KINDS,
  WorkRevisionStorageRepositoryV4,
  buildWorkRevisionStorageV4,
} from "../../entities/work-revision-storage-v4.js";
import { WorkGraphCurrentnessFenceV4 } from "../../entities/workgraph-currentness-fence-v4.js";

const NOW = "2026-07-23T19:20:00.000Z";
const CREATOR = { role: "engineer", agentId: "engineer-creator" };
const SETUP_TIMEOUT = 120_000;
const OP_TIMEOUT = 120_000;
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

function work(id: string, actor = CREATOR): WorkItem {
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
    createdBy: actor,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("Mission-140 frozen pause authority real PostgreSQL", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let substrate: PostgresSubstrate;
  let reconciler: SchemaReconciler;
  let storage: WorkRevisionStorageRepositoryV4;
  let repo: WorkItemRepositorySubstrate;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    const conn = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = createTestPool(conn, "pause-recall-frozen-authority-pg");
    for (const file of ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql", "005-workgraph-writer-fence.sql"]) {
      await pool.query(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }
    substrate = createPostgresStorageSubstrate(conn);
    const kinds = new Set(["SchemaDef", "Counter", "WorkItem", ...Object.values(WORK_REVISION_KINDS)]);
    reconciler = createSchemaReconciler(substrate, conn, {
      initialSchemas: ALL_SCHEMAS.filter((schema) => kinds.has(schema.kind)),
      log: () => {}, warn: () => {},
    });
    await reconciler.start();
    substrate.setFieldTranslator((kind, key) => reconciler.getFieldTranslation(kind, key));
    substrate.setPartitionedKindCheck((kind) => reconciler.hasTranslations(kind));
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    storage = new WorkRevisionStorageRepositoryV4(substrate);
    repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    if (reconciler) await reconciler.close();
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, OP_TIMEOUT);

  it("rejects public aliases and a persisted targetRef+completion-edge falsifier across CAS/restart", async () => {
    const parent = work("parent");
    const stable = work("stable");
    const race = work("race");
    const child = work("child", { role: "architect", agentId: "architect-1" });
    const items = [parent, stable, race, child];
    const built = buildWorkRevisionStorageV4({
      workItems: items,
      boundReferencesByPhysicalId: Object.fromEntries(items.map((item) => [item.id, []])),
      familyScopesByPhysicalId: Object.fromEntries(items.map((item) => [item.id, { kind: "mission" as const, id: "mission-140" }])),
      generation: 1,
      previousGeneration: 0,
      operationId: "pause-frozen-pg-generation-1",
      createdAt: NOW,
    });
    await storage.persistPrepared(built);
    await storage.persistProjectedWorkItems(built);
    await storage.activateGeneration(1, built.operation.operationId, NOW);

    const paused = (await repo.pauseWork({
      workId: parent.id,
      operationId: "pg-steve-falsifier",
      reason: "real PostgreSQL frozen authority proof",
      expectedRevision: 1,
      expectedGeneration: 1,
    }, CREATOR))!;
    const history = structuredClone(paused.recallHistory);

    await expect(repo.updateWorkItem(parent.id, CREATOR, {
      set: { targetRef: { kind: "mission", id: "mission-other" } },
    })).rejects.toMatchObject({ code: "workgraph.currentness.revision_required" });
    await expect(repo.updateWorkItem(parent.id, CREATOR, {
      appendCompletionDependsOn: [child.id],
    })).rejects.toMatchObject({ code: "workgraph.currentness.revision_required" });

    // Simulate the exact old-binary corrupt end-state under the DB's legitimate
    // writer lock: row fields move while persisted identity hashes remain stale.
    const fence = new WorkGraphCurrentnessFenceV4(substrate);
    await fence.withWriterFence(async () => {
      await substrate.put("WorkItem", {
        ...paused,
        targetRef: { kind: "mission", id: "mission-other" },
        completionDependsOn: [child.id],
      } as WorkItem);
    });

    const restarted = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
    await expect(restarted.unpauseWork({
      workId: parent.id,
      expectedRevision: 1,
      expectedGeneration: 1,
    }, CREATOR)).rejects.toMatchObject({ code: "workgraph.currentness.revision_required" });
    const retained = (await restarted.getWorkItem(parent.id))!;
    expect(retained).toMatchObject({
      suspended: true,
      targetRef: { kind: "mission", id: "mission-other" },
      completionDependsOn: [child.id],
      lease: null,
    });
    expect(retained.recallHistory).toEqual(history);
    expect(retained.recallHistory).toHaveLength(1);

    // An unchanged scalar recommit remains lawful and survives a repository restart.
    await repo.pauseWork({
      workId: stable.id,
      operationId: "pg-unchanged",
      reason: "unchanged scalar",
      expectedRevision: 1,
      expectedGeneration: 1,
    }, CREATOR);
    await repo.updateWorkItem(stable.id, CREATOR, { set: { priority: "high" } });
    const stableRestart = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
    expect((await stableRestart.unpauseWork({
      workId: stable.id,
      expectedRevision: 1,
      expectedGeneration: 1,
    }, CREATOR))!).toMatchObject({ status: "ready", priority: "high" });

    // The PostgreSQL advisory-lock/CAS path makes ordering irrelevant: semantic
    // mutation rejects both while paused and after unpause under an active head.
    await repo.pauseWork({
      workId: race.id,
      operationId: "pg-race",
      reason: "unpause/update race",
      expectedRevision: 1,
      expectedGeneration: 1,
    }, CREATOR);
    const [unpauseResult, updateResult] = await Promise.allSettled([
      repo.unpauseWork({ workId: race.id, expectedRevision: 1, expectedGeneration: 1 }, CREATOR),
      repo.updateWorkItem(race.id, CREATOR, {
        set: { targetRef: { kind: "mission", id: "mission-race" } },
        appendCompletionDependsOn: [child.id],
      }),
    ]);
    expect(unpauseResult.status).toBe("fulfilled");
    expect(updateResult.status).toBe("rejected");
    if (updateResult.status === "rejected") {
      expect(updateResult.reason).toMatchObject({ code: "workgraph.currentness.revision_required" });
    }
    expect((await repo.getWorkItem(race.id))!).toMatchObject({
      status: "ready",
      targetRef: { kind: "mission", id: "mission-140" },
      completionDependsOn: [],
    });
  }, OP_TIMEOUT);
});
