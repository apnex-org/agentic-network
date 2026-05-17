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
import { ThreadRepositorySubstrate } from "../thread-repository-substrate.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { ThreadConvergenceGateError } from "../../state.js";

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
  const pool = new Pool({ connectionString: connStr });
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
