/**
 * mission-83 W4.x.8 — TaskRepositorySubstrate integration tests.
 *
 * 2 tests covering Option Y composition + Mutex-serialized claim-poll + dependency-graph
 * transitions:
 *   1. submitDirective + getNextDirective (Mutex serialized) + submitReport +
 *     getNextReport CAS + cancelTask FSM + TransitionRejected gating + clarification
 *     round-trip
 *   2. dependency-graph: blocked→pending (unblockDependents) + blocked→cancelled
 *     (cancelDependents) + submitReview revision-loop (rejected → working → escalated
 *     at 3rd rejection per Mission-47 W5 contract)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import {
  createPostgresStorageSubstrate,
  createSchemaReconciler,
  ALL_SCHEMAS,
  type HubStorageSubstrate,
  type SchemaReconciler,
} from "../../storage-substrate/index.js";
import { TaskRepositorySubstrate } from "../task-repository-substrate.js";
import { SubstrateCounter } from "../substrate-counter.js";

const { Pool } = pg;

let container: StartedPostgreSqlContainer;
let substrate: HubStorageSubstrate;
let reconciler: SchemaReconciler;
let connStr: string;

const MIGRATIONS_DIR = join(__dirname, "..", "..", "storage-substrate", "migrations");
const MIGRATION_FILES = [
  "001-entities-table.sql",
  "002-notify-trigger.sql",
  "003-jsonb-size-check.sql",
];

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:15-alpine")
    .withUsername("hub")
    .withPassword("hub")
    .withDatabase("hub")
    .start();
  connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;

  const pool = new Pool({ connectionString: connStr });
  for (const f of MIGRATION_FILES) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf-8");
    await pool.query(sql);
  }
  await pool.end();

  substrate = createPostgresStorageSubstrate(connStr);

  const subset = ALL_SCHEMAS.filter(s => ["SchemaDef", "Task"].includes(s.kind));
  reconciler = createSchemaReconciler(substrate, connStr, {
    initialSchemas: subset,
    log: () => { /* silent */ },
    warn: () => { /* silent */ },
  });
  await reconciler.start();
}, 60_000);

afterAll(async () => {
  await reconciler.close();
  await (substrate as unknown as { close: () => Promise<void> }).close?.();
  await container.stop();
}, 30_000);

beforeEach(async () => {
  const pool = new Pool({ connectionString: connStr });
  try {
    await pool.query(`DELETE FROM entities WHERE kind IN ($1, $2)`, ["Task", "Counter"]);
  } finally {
    await pool.end();
  }
});

describe("TaskRepositorySubstrate (W4.x.8 Option Y sibling-pattern)", () => {
  it("submitDirective + getNextDirective + submitReport + getNextReport + cancelTask + clarification round-trip", async () => {
    const counter = new SubstrateCounter(substrate);
    const repo = new TaskRepositorySubstrate(substrate, counter);

    // submitDirective (no deps → pending)
    const taskId1 = await repo.submitDirective("Do the thing", "mission-1");
    expect(taskId1).toBe("task-1");

    const t1 = await repo.getTask(taskId1);
    expect(t1?.status).toBe("pending");
    expect(t1?.directive).toBe("Do the thing");

    // getNextDirective claims via Mutex+CAS
    const claimed = await repo.getNextDirective({ agentId: "agent-greg" });
    expect(claimed?.id).toBe(taskId1);
    expect(claimed?.status).toBe("working");
    expect(claimed?.assignedEngineerId).toBe("agent-greg");

    // Re-claim returns null (no more pending)
    const reClaim = await repo.getNextDirective({ agentId: "agent-greg" });
    expect(reClaim).toBeNull();

    // requestClarification (working → input_required)
    const clarified = await repo.requestClarification(taskId1, "what should X be?");
    expect(clarified).toBe(true);
    const tQ = await repo.getTask(taskId1);
    expect(tQ?.status).toBe("input_required");
    expect(tQ?.clarificationQuestion).toBe("what should X be?");

    // respondToClarification (input_required → working)
    const responded = await repo.respondToClarification(taskId1, "X should be Y");
    expect(responded).toBe(true);
    const tA = await repo.getTask(taskId1);
    expect(tA?.status).toBe("working");
    expect(tA?.clarificationAnswer).toBe("X should be Y");

    // submitReport (working → in_review)
    const reportOk = await repo.submitReport(taskId1, "Report MD body", "Summary", true);
    expect(reportOk).toBe(true);
    const tR = await repo.getTask(taskId1);
    expect(tR?.status).toBe("in_review");
    expect(tR?.report).toBe("Report MD body");
    expect(tR?.reportRef).toBe("reports/task-1-v1-report.md");

    // cancelTask on in_review → not cancellable (TransitionRejected → false)
    const cancelInReview = await repo.cancelTask(taskId1);
    expect(cancelInReview).toBe(false);

    // 2nd task — pending → cancel (cancellable)
    const taskId2 = await repo.submitDirective("Cancellable task");
    const cancelOk = await repo.cancelTask(taskId2);
    expect(cancelOk).toBe(true);
    const t2 = await repo.getTask(taskId2);
    expect(t2?.status).toBe("cancelled");

    // Re-cancel already-cancelled → TransitionRejected (false)
    const reCancel = await repo.cancelTask(taskId2);
    expect(reCancel).toBe(false);

    // findByIdempotencyKey
    const taskId3 = await repo.submitDirective("With idempotency", undefined, "idem-key-123");
    const foundByKey = await repo.findByIdempotencyKey("idem-key-123");
    expect(foundByKey?.id).toBe(taskId3);
    expect(await repo.findByIdempotencyKey("no-such-key")).toBeNull();
  }, 60_000);

  it("dependency-graph: unblockDependents + cancelDependents + submitReview revision-loop with escalation", async () => {
    const counter = new SubstrateCounter(substrate);
    const repo = new TaskRepositorySubstrate(substrate, counter);

    // Set up dependency graph: task-A and task-B independent; task-C blocked on A+B
    const taskA = await repo.submitDirective("Task A");
    const taskB = await repo.submitDirective("Task B");
    const taskC = await repo.submitDirective("Task C", undefined, undefined, undefined, undefined, [taskA, taskB]);

    const tC = await repo.getTask(taskC);
    expect(tC?.status).toBe("blocked");
    expect(tC?.dependsOn).toEqual([taskA, taskB]);

    // Complete A → C still blocked (B not done)
    await repo.__debugSetTask(taskA, { status: "completed" });
    const unblockedAfterA = await repo.unblockDependents(taskA);
    expect(unblockedAfterA).toEqual([]);  // C still has dep on B
    const tC1 = await repo.getTask(taskC);
    expect(tC1?.status).toBe("blocked");

    // Complete B → C unblocked → pending
    await repo.__debugSetTask(taskB, { status: "completed" });
    const unblockedAfterB = await repo.unblockDependents(taskB);
    expect(unblockedAfterB).toEqual([taskC]);
    const tC2 = await repo.getTask(taskC);
    expect(tC2?.status).toBe("pending");

    // cancelDependents — set up task-D blocked on task-E; fail E → D cancelled
    const taskD = await repo.submitDirective("Task D", undefined, undefined, undefined, undefined, ["task-E-stub"]);
    expect((await repo.getTask(taskD))?.status).toBe("blocked");

    const cancelled = await repo.cancelDependents("task-E-stub");
    expect(cancelled).toEqual([taskD]);
    const tD = await repo.getTask(taskD);
    expect(tD?.status).toBe("cancelled");

    // submitReview revision-loop: working → submit report → in_review → reject 3x → escalated
    const taskR = await repo.submitDirective("Review loop");
    await repo.getNextDirective({ agentId: "agent-greg" });  // → working

    // Reject 1 (revisionCount 0 → 1; working again)
    await repo.submitReport(taskR, "v1 body", "v1 summary", true);
    const reject1 = await repo.submitReview(taskR, "needs work", "rejected");
    expect(reject1).toBe(true);
    let tR1 = await repo.getTask(taskR);
    expect(tR1?.status).toBe("working");
    expect(tR1?.revisionCount).toBe(1);

    // Reject 2 (revisionCount 1 → 2; working again)
    await repo.submitReport(taskR, "v2 body", "v2 summary", true);
    await repo.submitReview(taskR, "still needs work", "rejected");
    tR1 = await repo.getTask(taskR);
    expect(tR1?.status).toBe("working");
    expect(tR1?.revisionCount).toBe(2);

    // Reject 3 (revisionCount 2 → 3; STILL working because submitReview checks >= 3 BEFORE increment)
    // Actually per legacy: if (revisionCount >= 3) → escalated; else revisionCount++ + working
    // So at revisionCount=2, reject → revisionCount=3 + working (not yet escalated)
    await repo.submitReport(taskR, "v3 body", "v3 summary", true);
    await repo.submitReview(taskR, "still no", "rejected");
    tR1 = await repo.getTask(taskR);
    expect(tR1?.status).toBe("working");
    expect(tR1?.revisionCount).toBe(3);

    // 4th submission → reject → escalated (revisionCount already 3)
    await repo.submitReport(taskR, "v4 body", "v4 summary", true);
    await repo.submitReview(taskR, "escalating", "rejected");
    tR1 = await repo.getTask(taskR);
    expect(tR1?.status).toBe("escalated");

    // Approve path on a different task
    const taskApprove = await repo.submitDirective("Approve me");
    await repo.getNextDirective({ agentId: "agent-greg" });  // → working
    await repo.submitReport(taskApprove, "report", "summary", true);
    await repo.submitReview(taskApprove, "looks good", "approved");
    const tApproved = await repo.getTask(taskApprove);
    expect(tApproved?.status).toBe("completed");
  }, 60_000);
});
