/**
 * mission-83 W4.x.6 — PendingActionRepositorySubstrate integration tests.
 *
 * 2 tests covering Option Y composition:
 *   1. enqueue + INV-PA2 natural-key idempotency + getById + listForAgent +
 *      findOpenByNaturalKey + receiptAck + completionAck CAS via Design v1.4
 *      getWithRevision + putIfMatch
 *   2. saveContinuation + listContinuationItems + resumeContinuation FSM +
 *      TransitionRejected gating (returns null per legacy contract) + abandon +
 *      listExpired/listStuck/listNonTerminalByEntityRef substrate-side filters
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
import { PendingActionRepositorySubstrate } from "../pending-action-repository-substrate.js";
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

  const subset = ALL_SCHEMAS.filter(s => ["SchemaDef", "PendingAction"].includes(s.kind));
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
    await pool.query(`DELETE FROM entities WHERE kind IN ($1, $2)`, ["PendingAction", "Counter"]);
  } finally {
    await pool.end();
  }
});

describe("PendingActionRepositorySubstrate (W4.x.6 Option Y sibling-pattern)", () => {
  it("enqueue + INV-PA2 idempotency + listForAgent + receiptAck + completionAck CAS via Design v1.4", async () => {
    const counter = new SubstrateCounter(substrate);
    const repo = new PendingActionRepositorySubstrate(substrate, counter);

    // First enqueue
    const item1 = await repo.enqueue({
      targetAgentId: "agent-greg",
      dispatchType: "thread_message",
      entityRef: "thread-100",
      payload: { messageId: "01ABC" },
    });
    expect(item1.id).toMatch(/^pa-\d{4}-\d{2}-\d{2}T/);
    expect(item1.state).toBe("enqueued");
    expect(item1.naturalKey).toBe("agent-greg:thread-100:thread_message");
    expect(item1.attemptCount).toBe(0);

    // INV-PA2 natural-key idempotency — re-enqueue same key returns existing
    const dup = await repo.enqueue({
      targetAgentId: "agent-greg",
      dispatchType: "thread_message",
      entityRef: "thread-100",
      payload: { messageId: "01XYZ" },  // different payload but same natural-key
    });
    expect(dup.id).toBe(item1.id);  // same item; no second enqueue

    // Different natural-key creates new
    const item2 = await repo.enqueue({
      targetAgentId: "agent-greg",
      dispatchType: "thread_message",
      entityRef: "thread-200",
      payload: { messageId: "01DEF" },
    });
    expect(item2.id).not.toBe(item1.id);

    // listForAgent — substrate-side pa_target_idx hot-path
    const grLite = await repo.listForAgent("agent-greg");
    expect(grLite).toHaveLength(2);

    const enqueuedOnly = await repo.listForAgent("agent-greg", { state: "enqueued" });
    expect(enqueuedOnly).toHaveLength(2);

    // findOpenByNaturalKey — substrate-side pa_natural_key_idx hot-path
    const open = await repo.findOpenByNaturalKey({
      targetAgentId: "agent-greg",
      entityRef: "thread-100",
      dispatchType: "thread_message",
    });
    expect(open?.id).toBe(item1.id);

    // receiptAck CAS — state enqueued → receipt_acked
    const acked1 = await repo.receiptAck(item1.id);
    expect(acked1?.state).toBe("receipt_acked");
    expect(acked1?.receiptAckedAt).toBeDefined();

    // Idempotent: re-receiptAck returns existing unchanged
    const reAcked1 = await repo.receiptAck(item1.id);
    expect(reAcked1?.state).toBe("receipt_acked");

    // completionAck CAS
    const complete1 = await repo.completionAck(item1.id);
    expect(complete1?.state).toBe("completion_acked");
    expect(complete1?.completionAckedAt).toBeDefined();

    // After completion, INV-PA2 allows re-enqueue (terminal state freed)
    const reEnqueue = await repo.enqueue({
      targetAgentId: "agent-greg",
      dispatchType: "thread_message",
      entityRef: "thread-100",
      payload: { messageId: "01NEW" },
    });
    expect(reEnqueue.id).not.toBe(item1.id);  // NEW item
    expect(reEnqueue.state).toBe("enqueued");

    // receiptAck on absent returns null
    expect(await repo.receiptAck("pa-nonexistent")).toBeNull();
  }, 60_000);

  it("saveContinuation + resumeContinuation FSM + TransitionRejected + abandon + listExpired/listStuck", async () => {
    const counter = new SubstrateCounter(substrate);
    const repo = new PendingActionRepositorySubstrate(substrate, counter);

    // Setup: 2 enqueued items + 1 receipt_acked + 1 abandoned
    const item1 = await repo.enqueue({
      targetAgentId: "agent-greg",
      dispatchType: "thread_message",
      entityRef: "thread-1",
      payload: {},
    });
    await repo.receiptAck(item1.id);  // → receipt_acked

    const item2 = await repo.enqueue({
      targetAgentId: "agent-greg",
      dispatchType: "thread_message",
      entityRef: "thread-2",
      payload: {},
    });

    const item3 = await repo.enqueue({
      targetAgentId: "agent-lily",
      dispatchType: "thread_message",
      entityRef: "thread-3",
      payload: {},
    });
    await repo.abandon(item3.id, "test-abandon");

    // saveContinuation on receipt_acked item (non-terminal, owned by caller)
    const cont = await repo.saveContinuation(item1.id, "agent-greg", { resume: "state-X" });
    expect(cont?.state).toBe("continuation_required");
    expect(cont?.continuationState).toEqual({ resume: "state-X" });

    // saveContinuation with wrong caller returns null (TransitionRejected)
    const wrongCaller = await repo.saveContinuation(item2.id, "agent-other", { resume: "x" });
    expect(wrongCaller).toBeNull();

    // saveContinuation on terminal-state item returns null (TransitionRejected)
    const terminalSave = await repo.saveContinuation(item3.id, "agent-lily", { resume: "x" });
    expect(terminalSave).toBeNull();

    // listContinuationItems — sorted by continuationSavedAt asc
    const continuations = await repo.listContinuationItems();
    expect(continuations).toHaveLength(1);
    expect(continuations[0].id).toBe(item1.id);

    // resumeContinuation: returns continuationState + flips state to enqueued
    const resumed = await repo.resumeContinuation(item1.id);
    expect(resumed?.item.state).toBe("enqueued");
    expect(resumed?.continuationState).toEqual({ resume: "state-X" });

    // resumeContinuation on non-continuation_required returns null
    const noResume = await repo.resumeContinuation(item2.id);
    expect(noResume).toBeNull();

    // listExpired — receipt_acked items past completionDeadline (use future-ms)
    // Set short deadlines via __debugSetItem to test expiry
    const farPast = new Date(Date.now() - 600_000).toISOString();
    await repo.__debugSetItem(item2.id, {
      state: "receipt_acked",
      receiptAckedAt: farPast,
      completionDeadline: farPast,
    });
    const expired = await repo.listExpired(Date.now());
    expect(expired.some(e => e.id === item2.id)).toBe(true);

    // listStuck — receipt_acked older than threshold
    await repo.__debugSetItem(item2.id, {
      state: "receipt_acked",
      enqueuedAt: farPast,
    });
    const stuck = await repo.listStuck({ olderThanMs: 60_000 });
    expect(stuck.some(s => s.id === item2.id)).toBe(true);

    // listNonTerminalByEntityRef — substrate-side filter
    const thread1Items = await repo.listNonTerminalByEntityRef("thread-1");
    expect(thread1Items).toHaveLength(1);  // item1 (now back to enqueued)
    const thread3Items = await repo.listNonTerminalByEntityRef("thread-3");
    expect(thread3Items).toHaveLength(0);  // item3 abandoned → terminal
  }, 60_000);
});
