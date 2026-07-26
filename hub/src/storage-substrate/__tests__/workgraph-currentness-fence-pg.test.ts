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
  type BuiltWorkRevisionStorageV4,
  type WorkRevisionFamilyRowV4,
} from "../../entities/work-revision-storage-v4.js";
import { WorkGraphCurrentnessFenceV4 } from "../../entities/workgraph-currentness-fence-v4.js";

const NOW = "2026-07-23T17:00:00.000Z";
const SETUP_TIMEOUT = 120_000;
const OP_TIMEOUT = 120_000;
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

function work(id: string): WorkItem {
  return {
    id, type: "task", priority: "normal", roleEligibility: ["engineer"],
    dependsOn: [], completionDependsOn: [], evidenceRequirements: [], references: [],
    targetRef: { kind: "mission", id: "mission-140" }, status: "ready", lease: null,
    evidence: [], frictionReflections: [], blockedOn: null, leaseExpiryCount: 0,
    enteredCurrentStateAt: NOW,
    stateDurations: { ready: 0, claimed: 0, in_progress: 0, blocked: 0, paused: 0, review: 0 },
    attestationHistory: [], attestations: {}, executorHistory: [],
    createdBy: { role: "architect", agentId: "architect-1" }, createdAt: NOW, updatedAt: NOW,
  };
}

function build(items: WorkItem[], generation: number, previousGeneration: number, operationId: string, families?: Record<string, WorkRevisionFamilyRowV4>): BuiltWorkRevisionStorageV4 {
  return buildWorkRevisionStorageV4({
    workItems: items,
    boundReferencesByPhysicalId: Object.fromEntries(items.map((item) => [item.id, item.boundReferences ?? []])),
    familyScopesByPhysicalId: Object.fromEntries(items.map((item) => [item.id, { kind: "mission", id: "mission-140" }])),
    existingFamiliesByLogicalId: families,
    generation, previousGeneration, operationId, createdAt: NOW,
  });
}

describe("Mission-140 WorkGraph writer/read fence real PostgreSQL", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let substrate: PostgresSubstrate;
  let reconciler: SchemaReconciler;
  let storage: WorkRevisionStorageRepositoryV4;
  let workItems: WorkItemRepositorySubstrate;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    const conn = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = createTestPool(conn, "workgraph-currentness-fence-pg");
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
    workItems = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    if (reconciler) await reconciler.close();
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, OP_TIMEOUT);

  it("serializes head publication behind a pinned writer and reports a read/head race", async () => {
    const first = build([work("a")], 1, 0, "pg-fence-1");
    await storage.persistPrepared(first);
    await storage.persistProjectedWorkItems(first);
    await storage.activateGeneration(1, "pg-fence-1", NOW);

    await expect(workItems.createWorkItem({ type: "task", roleEligibility: ["engineer"] }))
      .rejects.toMatchObject({ code: "workgraph.currentness.revision_required" });

    const beforeA = (await workItems.getWorkItem("a"))!;
    await expect(substrate.put("WorkItem", { ...beforeA, priority: "critical" }))
      .rejects.toThrow(/writer_protocol_required/); // simulates an old binary with no V4 global lock
    await workItems.claimWorkItem("a", "engineer-1", "engineer"); // current binary owns the lock; DB accepts
    const currentA = (await workItems.getWorkItem("a"))!;
    expect(currentA.status).toBe("claimed");
    const familyA = (await storage.getFamily("a"))!;
    const second = build([currentA, work("b")], 2, 1, "pg-fence-2", { a: familyA });
    await storage.persistPrepared(second);
    await storage.persistProjectedWorkItems(second);

    const fence = new WorkGraphCurrentnessFenceV4(substrate);
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    const heldWriter = fence.withWriterFence(async (pin) => {
      expect(pin.mode).toBe("generation");
      if (pin.mode === "generation") expect(pin.head.generation).toBe(1);
      entered();
      await releasePromise;
    });
    await enteredPromise;
    let published = false;
    const publish = storage.activateGeneration(2, "pg-fence-2", NOW).then(() => { published = true; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(published).toBe(false);
    release();
    await heldWriter;
    await publish;
    expect((await workItems.listWorkItems()).items.every((item) => item.observedTopologyGeneration === 2)).toBe(true);

    const currentB = (await workItems.getWorkItem("b"))!;
    const families = { a: (await storage.getFamily("a"))!, b: (await storage.getFamily("b"))! };
    const third = build([currentA, currentB, work("c")], 3, 2, "pg-fence-3", families);
    await storage.persistPrepared(third);
    await storage.persistProjectedWorkItems(third);
    await expect(fence.withReadPin(async (pin) => {
      expect(pin.mode).toBe("generation");
      await storage.activateGeneration(3, "pg-fence-3", NOW);
      return "mixed-read-must-not-escape";
    })).rejects.toMatchObject({ code: "workgraph.currentness.head_changed" });

    // Active recall and a holder heartbeat serialize through the SAME PostgreSQL
    // advisory-lock session. Either the heartbeat linearizes first and is captured,
    // or pause linearizes first and rejects the obsolete token; no zombie survives.
    const token = (await workItems.getWorkItem("a"))!.lease!.token;
    const [pauseRace, renewRace] = await Promise.allSettled([
      workItems.pauseWork({
        logicalId: "a", operationId: "pg-pause-renew-race", reason: "real-PG race proof",
        expectedRevision: 1, expectedGeneration: 3,
      }, { role: "architect", agentId: "architect-1" }),
      workItems.renewLease("a", "engineer-1", token),
    ]);
    expect(pauseRace.status).toBe("fulfilled");
    expect(["fulfilled", "rejected"]).toContain(renewRace.status);
    const recalled = (await workItems.getWorkItem("a"))!;
    // idea-640 (A): pause RETAINS the lease, so `lease: null` no longer holds. This test is about the
    // writer/read FENCE, not about lease clearing — the fence properties (paused status, recall notice)
    // are what it exists to assert, and both are unchanged.
    expect(recalled).toMatchObject({ status: "paused", recallNoticePending: true });
    expect(recalled.recallHistory).toHaveLength(1);
    expect(recalled.recallHistory![0].before.phase).toBe("claimed");
    expect(recalled.pendingRecallIntents![0].exactHolderAgentId).toBe("engineer-1");
    // idea-640 (A): scoped from the WHOLE ROW to RECALLHISTORY, matching pause-recall-v4. The history's
    // fingerprint-not-token discipline is a real designed control and stays; the row-level scrub was a
    // side effect of `lease: null` and protected nothing, since get_work returns lease.token in plaintext
    // to any reader of any live row. Filed separately, out of this arc's bound.
    expect(JSON.stringify(recalled.recallHistory)).not.toContain(token);
    await expect(workItems.renewLease("a", "engineer-1", token)).rejects.toThrow();
    const raw = await substrate.get<Record<string, unknown>>("WorkItem", "a");
    expect((raw!.status as Record<string, unknown>).recallNoticePending).toBe(true);
  }, OP_TIMEOUT);
});
