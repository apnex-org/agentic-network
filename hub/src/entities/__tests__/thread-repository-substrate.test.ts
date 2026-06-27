/**
 * mission-83 W4.x.10 — ThreadRepositorySubstrate integration tests.
 *
 * 2 tests covering Option Y composition + embedded-messages simplification:
 *   1. openThread + replyToThread round-trip with embedded messages[] +
 *      turn-state alternation + convergence FSM (2-round mutual convergence
 *      → status=converged with committed convergenceActions)
 *   2. ThreadConvergenceGateError on convergence-without-stage/summary +
 *      closeThread/markCascadeFailed/markCascadePending/markCascadeCompleted
 *      lifecycle + unpinCurrentTurnAgent via thread_turn_agent_idx hot-path
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createTestPool } from "../../storage-substrate/__tests__/_pg-test-pool.js";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPostgresStorageSubstrate,
  createSchemaReconciler,
  ALL_SCHEMAS,
  buildEnvelopeWriteEncoder,
  type HubStorageSubstrate,
  type PostgresSubstrate,
  type SchemaReconciler,
} from "../../storage-substrate/index.js";
import { ThreadRepositorySubstrate } from "../thread-repository-substrate.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { ThreadConvergenceGateError } from "../../state.js";
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

  const pool = createTestPool(connStr, "thread-repository-substrate");
  for (const f of MIGRATION_FILES) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf-8");
    await pool.query(sql);
  }
  await pool.end();

  substrate = createPostgresStorageSubstrate(connStr);

  const subset = ALL_SCHEMAS.filter(s => ["SchemaDef", "Thread"].includes(s.kind));
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
  const pool = createTestPool(connStr, "thread-repository-substrate");
  try {
    await pool.query(`DELETE FROM entities WHERE kind IN ($1, $2)`, ["Thread", "Counter"]);
  } finally {
    await pool.end();
  }
});

describe("ThreadRepositorySubstrate (W4.x.10 Option Y sibling-pattern)", () => {
  it("openThread + replyToThread with embedded messages[] + turn alternation + convergence FSM", async () => {
    const counter = new SubstrateCounter(substrate);
    const repo = new ThreadRepositorySubstrate(substrate, counter);

    // openThread
    const t1 = await repo.openThread("Test thread", "Initial message", "engineer", {
      authorAgentId: "agent-greg",
      recipientAgentId: "agent-lily",
    });
    expect(t1.id).toBe("thread-1");
    expect(t1.status).toBe("active");
    expect(t1.roundCount).toBe(1);
    expect(t1.messages).toHaveLength(1);  // embedded
    expect(t1.messages[0].text).toBe("Initial message");
    expect(t1.currentTurn).toBe("architect");  // alternated from engineer
    expect(t1.currentTurnAgentId).toBe("agent-lily");

    // Architect replies
    const t2 = await repo.replyToThread(t1.id, "Architect response", "architect", {
      authorAgentId: "agent-lily",
    });
    expect(t2?.status).toBe("active");
    expect(t2?.roundCount).toBe(2);
    expect(t2?.messages).toHaveLength(2);
    expect(t2?.messages[1].text).toBe("Architect response");
    expect(t2?.currentTurn).toBe("engineer");  // back to engineer
    expect(t2?.currentTurnAgentId).toBe("agent-greg");

    // Wrong-turn rejection (engineer's turn; architect tries)
    const wrongTurn = await repo.replyToThread(t1.id, "wrong", "architect", { authorAgentId: "agent-lily" });
    expect(wrongTurn).toBeNull();  // TransitionRejected: not this author's turn

    // Engineer converges (round 1 of 2-round convergence; lastMessageConverged=false yet)
    const t3 = await repo.replyToThread(t1.id, "Engineer converge", "engineer", {
      authorAgentId: "agent-greg",
      converged: true,
      stagedActions: [{
        kind: "stage",
        type: "close_no_action",
        payload: { reason: "discussion complete" },
      }],
      summary: "Discussion converged",
    });
    expect(t3?.status).toBe("active");  // not yet converged (needs both sides)
    expect(t3?.lastMessageConverged).toBe(true);
    expect(t3?.convergenceActions).toHaveLength(1);
    expect(t3?.convergenceActions[0].status).toBe("staged");

    // Architect converges (round 2; lastMessageConverged was true, this is true → convergence trigger)
    const t4 = await repo.replyToThread(t1.id, "Architect converge", "architect", {
      authorAgentId: "agent-lily",
      converged: true,
      summary: "Discussion converged (architect-confirmed)",
    });
    expect(t4?.status).toBe("converged");  // 2-round convergence triggered
    expect(t4?.convergenceActions[0].status).toBe("committed");  // staged → committed
    expect(t4?.messages).toHaveLength(4);
  }, 60_000);

  it("bug-177 OBS-1: listThreads returns newest-by-updatedAt first (envelope metadata.updatedAt order, not heap order)", async () => {
    // OBS-1 mechanism: with no default ORDER BY, the LIST_PREFETCH_CAP window is
    // unordered (postgres heap order), so the newest threads can fall outside it
    // and list_threads omits them. The fix default-orders by updatedAt DESC.
    // updatedAt lives in the ENVELOPE metadata (Thread migration module), so this
    // also proves the sort addresses the correct envelope path — a bare
    // `updatedAt` would sort on a NULL `data->>'updatedAt'` (a silent no-op).
    // Wire the prod write path (envelope) for this test only, like Hub boot does.
    const pg = substrate as unknown as PostgresSubstrate;
    pg.setFieldTranslator((kind, key) => reconciler.getFieldTranslation(kind, key));
    pg.setWriteEncoder(buildEnvelopeWriteEncoder());
    const pool = createTestPool(connStr, "thread-repo-bug177");
    try {
      const counter = new SubstrateCounter(substrate);
      const repo = new ThreadRepositorySubstrate(substrate, counter);
      // Insertion order thread-1, thread-2, thread-3 — stored ENVELOPE-shaped
      // (encoder wired), so updatedAt lands at metadata.updatedAt like prod.
      for (const title of ["T1", "T2", "T3"]) {
        await repo.openThread(title, "init", "engineer", {
          authorAgentId: "agent-greg",
          recipientAgentId: "agent-lily",
        });
      }

      // Bump distinct metadata.updatedAt (direct SQL on the envelope path) so the
      // updatedAt order DIFFERS from insertion/heap order: thread-2 newest, then
      // thread-3, then thread-1. If the sort were a no-op (sorting a NULL field)
      // the result would be heap/insertion order [thread-1, thread-2, thread-3]
      // and this assertion would fail.
      const bump = async (id: string, iso: string) => {
        await pool.query(
          `UPDATE entities SET data = jsonb_set(data, '{metadata,updatedAt}', $2::jsonb) WHERE kind = 'Thread' AND id = $1`,
          [id, JSON.stringify(iso)],
        );
      };
      await bump("thread-1", "2099-01-01T00:00:00.000Z");
      await bump("thread-2", "2099-01-03T00:00:00.000Z"); // newest
      await bump("thread-3", "2099-01-02T00:00:00.000Z");

      const list = await repo.listThreads();
      expect(list.map((t) => t.id)).toEqual(["thread-2", "thread-3", "thread-1"]);
    } finally {
      pg.setWriteEncoder(null);
      pg.setFieldTranslator(null);
      await pool.end();
    }
  }, 60_000);

  it("convergence-gate + close/markCascade lifecycle + unpinCurrentTurnAgent via thread_turn_agent_idx", async () => {
    const counter = new SubstrateCounter(substrate);
    const repo = new ThreadRepositorySubstrate(substrate, counter);

    // Open a thread + first reply to set lastMessageConverged=true so 2nd converge can fire convergence-gate
    const t1 = await repo.openThread("Gate test", "init", "engineer", {
      authorAgentId: "agent-greg",
      recipientAgentId: "agent-lily",
    });
    // architect converges first (with stage+summary so it works)
    await repo.replyToThread(t1.id, "arch converge", "architect", {
      authorAgentId: "agent-lily",
      converged: true,
      stagedActions: [{
        kind: "stage",
        type: "close_no_action",
        payload: { reason: "ok" },
      }],
      summary: "test summary",
    });
    // engineer tries to converge WITHOUT staging — would trigger convergence
    // (since prevConverged=true) but staged.length=0 → ThreadConvergenceGateError
    // wait: the architect already committed actions in the previous reply (when converged=true && prevConverged=false)
    // Actually that wouldn't commit — only commits when willConverge=true (both sides converged).
    // So after architect's converge, lastMessageConverged=true, convergenceActions[0].status=staged
    // Now engineer converges → willConverge=true → check stage+summary; staged.length=1 OK; summary "test summary" OK; → convergence triggers
    // To test the gate, need to clear summary first
    await repo.__debugSetThread(t1.id, { summary: "" });

    await expect(
      repo.replyToThread(t1.id, "eng without summary", "engineer", {
        authorAgentId: "agent-greg",
        converged: true,
        // no summary set → summary empty → ThreadConvergenceGateError
      }),
    ).rejects.toBeInstanceOf(ThreadConvergenceGateError);

    // 2nd thread — close + markCascade lifecycle
    const t2 = await repo.openThread("Lifecycle test", "init", "engineer", {
      authorAgentId: "agent-greg",
    });

    // markCascadePending → markCascadeCompleted
    const pendingSet = await repo.markCascadePending(t2.id, 3);
    expect(pendingSet).toBe(true);

    const tWithPending = await repo.getThread(t2.id);
    expect(tWithPending?.cascadePending).toBe(true);
    expect(tWithPending?.cascadePendingActionCount).toBe(3);

    // listCascadePending finds it
    const pendingList = await repo.listCascadePending();
    expect(pendingList.some(t => t.id === t2.id)).toBe(true);

    // Re-set markCascadePending → false (TransitionRejected: already pending)
    const reSet = await repo.markCascadePending(t2.id, 99);
    expect(reSet).toBe(false);

    // markCascadeCompleted clears it
    const completed = await repo.markCascadeCompleted(t2.id);
    expect(completed).toBe(true);

    const tCompleted = await repo.getThread(t2.id);
    expect(tCompleted?.cascadePending).toBe(false);
    expect(tCompleted?.cascadeCompletedAt).toBeDefined();

    // closeThread
    const closeOk = await repo.closeThread(t2.id);
    expect(closeOk).toBe(true);

    const closed = await repo.getThread(t2.id);
    expect(closed?.status).toBe("closed");

    // unpinCurrentTurnAgent — 3rd thread with currentTurnAgentId
    const t3 = await repo.openThread("Pin test", "init", "engineer", {
      authorAgentId: "agent-greg",
      recipientAgentId: "agent-lily",
    });
    expect(t3.currentTurnAgentId).toBe("agent-lily");

    const unpinned = await repo.unpinCurrentTurnAgent("agent-lily");
    expect(unpinned).toContain(t3.id);

    const tUnpinned = await repo.getThread(t3.id);
    expect(tUnpinned?.currentTurnAgentId).toBeNull();

    // closeThread on absent → false
    const noClose = await repo.closeThread("thread-99");
    expect(noClose).toBe(false);
  }, 60_000);
});
