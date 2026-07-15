
const NO_FRICTION = { observed: false, summary: "no friction observed" } as const;

/**
 * work-99 (idea-384 Part B) — recursive arc-subtree rollup (real-pg).
 *
 * Option-B app-side walk (no raw-CTE seam exists; cal #85). The load-bearing proofs (lily's
 * adversarial-verify focus):
 *  (1) LEAVES-ONLY — an intermediate's OWN span is never added; only reachable leaves contribute.
 *  (2) DAG-DEDUP — a leaf shared across parents (diamond) is counted ONCE (visited-set).
 *  (3) OWN-SPAN-SEPARATE — rolledUpDurations excludes the arc's own; ownActiveMs is the arc's own
 *      active wall-clock (claimed+in_progress+blocked+review, EXCL ready); parallelism = rollup.in_progress/ownActiveMs.
 *  (4) PARALLELISM is null when ownActiveMs=0 (no active span — honest null, no div-by-zero).
 * Each assertion compares the rollup to the ACTUAL summed leaf durations (read back), so it's
 * exact + deterministic regardless of the planted ms.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestPool } from "../../storage-substrate/__tests__/_pg-test-pool.js";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createPostgresStorageSubstrate, createSchemaReconciler, ALL_SCHEMAS, buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";
import { DEFAULT_STATE_DURATIONS } from "../work-item.js";
import type { WorkItem, StateDurations, EvidenceItem } from "../work-item.js";

const SETUP_TIMEOUT = 90_000;
const OP_TIMEOUT = 120_000;
const MIGRATIONS_DIR = join(__dirname, "..", "..", "storage-substrate", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const GAP = 25;

const ZERO = (): StateDurations => ({ ...DEFAULT_STATE_DURATIONS });
const sumDur = (...ds: StateDurations[]): StateDurations =>
  ds.reduce((acc, d) => {
    (Object.keys(DEFAULT_STATE_DURATIONS) as (keyof StateDurations)[]).forEach((k) => { acc[k] += d[k]; });
    return acc;
  }, ZERO());

describe("WorkItem arc-rollup (real-pg: idea-384 Part B)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let substrate: ReturnType<typeof createPostgresStorageSubstrate>;
  let reconciler: ReturnType<typeof createSchemaReconciler>;
  let repo: WorkItemRepositorySubstrate;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    const connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = createTestPool(connStr, "work-item-arc-rollup");
    for (const f of MIGRATION_FILES) await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    substrate = createPostgresStorageSubstrate(connStr);
    reconciler = createSchemaReconciler(substrate, connStr, { initialSchemas: ALL_SCHEMAS });
    await reconciler.start();
    substrate.setFieldTranslator((kind, key) => reconciler.getFieldTranslation(kind, key));
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    if (reconciler) await reconciler.close();
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, OP_TIMEOUT);

  const agentOf = (id: string) => `eng-${id}`;
  const freeform = (): EvidenceItem => ({ requirementId: "none", kind: "freeform", producedAt: new Date().toISOString(), note: "done" });
  const mk = (completionDependsOn: string[] = []) =>
    repo.createWorkItem({ type: "task", roleEligibility: ["engineer"], completionDependsOn });
  /** drive a node (with already-done children, if any) to `done`, accumulating non-zero buckets. */
  async function driveToDone(id: string): Promise<WorkItem> {
    const a = agentOf(id);
    const c = await repo.claimWorkItem(id, a, "engineer");
    await sleep(GAP);
    await repo.startWork(id, a, c!.lease!.token);
    await sleep(GAP);
    return (await repo.completeWork(id, a, c!.lease!.token, [freeform()], NO_FRICTION))!;
  }

  it("LEAVES-ONLY: an intermediate's OWN span is NOT in the rollup", async () => {
    const leaf1 = await driveToDone((await mk()).id);
    const leaf2 = await driveToDone((await mk()).id);
    const inter = await driveToDone((await mk([leaf1.id])).id); // intermediate WITH its own durations
    expect(inter.stateDurations.in_progress).toBeGreaterThan(0); // it really has own span
    const arc = await mk([inter.id, leaf2.id]);
    const proj = await repo.getStintProjection(arc.id);
    // rollup = leaf1 (under inter) + leaf2 — inter's OWN span excluded
    expect(proj!.rolledUpDurations).toEqual(sumDur(leaf1.stateDurations, leaf2.stateDurations));
  }, OP_TIMEOUT);

  it("DAG-DEDUP: a leaf shared across two parents (diamond) is counted ONCE", async () => {
    const leafD = await driveToDone((await mk()).id);
    const b = await mk([leafD.id]);
    const c = await mk([leafD.id]);
    const arc = await mk([b.id, c.id]); // arc -> {B,C} -> both -> D
    const proj = await repo.getStintProjection(arc.id);
    expect(proj!.rolledUpDurations).toEqual(leafD.stateDurations); // D once, NOT 2x
  }, OP_TIMEOUT);

  it("ROLLUP == sum of the unique reachable leaves", async () => {
    const l1 = await driveToDone((await mk()).id);
    const l2 = await driveToDone((await mk()).id);
    const l3 = await driveToDone((await mk()).id);
    const arc = await mk([l1.id, l2.id, l3.id]);
    const proj = await repo.getStintProjection(arc.id);
    expect(proj!.rolledUpDurations).toEqual(sumDur(l1.stateDurations, l2.stateDurations, l3.stateDurations));
  }, OP_TIMEOUT);

  it("OWN-SPAN-SEPARATE + PARALLELISM: ownActiveMs = arc's own active span (EXCL ready); rollup excludes it", async () => {
    const leaf = await driveToDone((await mk()).id);
    const arc0 = await mk([leaf.id]);
    const arc = await driveToDone(arc0.id); // arc gets its OWN durations (gate met: leaf done)
    const proj = await repo.getStintProjection(arc.id);
    const expectedOwn = arc.stateDurations.claimed + arc.stateDurations.in_progress + arc.stateDurations.blocked + arc.stateDurations.review;
    expect(proj!.ownActiveMs).toBe(expectedOwn);
    expect(expectedOwn).toBeGreaterThan(0);
    expect(proj!.rolledUpDurations).toEqual(leaf.stateDurations);          // rollup = leaf only
    expect(proj!.rolledUpDurations).not.toEqual(arc.stateDurations);       // NOT the arc's own
    expect(proj!.parallelism).toBeCloseTo(leaf.stateDurations.in_progress / expectedOwn, 9);
  }, OP_TIMEOUT);

  it("PARALLELISM null when ownActiveMs=0 (arc never claimed — no active span, no div-by-zero)", async () => {
    const leaf = await driveToDone((await mk()).id);
    const arc = await mk([leaf.id]); // ready, never claimed
    const proj = await repo.getStintProjection(arc.id);
    expect(proj!.ownActiveMs).toBe(0);
    expect(proj!.parallelism).toBeNull();
    expect(proj!.rolledUpDurations).toEqual(leaf.stateDurations); // rollup still computed
  }, OP_TIMEOUT);
});
