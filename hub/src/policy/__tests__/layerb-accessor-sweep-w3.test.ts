/**
 * mission-90 W3 — Layer-B policy FieldAccessor envelope sweep wire-flow (F4).
 *
 * REAL policy path: envelope-shaped rows seeded into a real substrate
 * (testcontainers) → substrate-backed repos → PolicyRouter.handle("list_*") →
 * parsed result. Proves the Layer-B half of bug-138 is closed: the accessor
 * BODIES (status via phaseFromEntity; other moved fields via fieldFromEntity)
 * read envelope rows correctly, where pre-W3 `i.status` ({phase} object) vs the
 * scalar filter silently missed.
 *
 * Covers §2.4 per-tool matrix: list_ideas/list_tasks/list_threads (accessor
 * bodies), list_proposals (push-down → W2 translate-point), list_tele (boolean
 * include-flags guard via phaseFromEntity), get_pending_actions alignment
 * (state push-down). testcontainers postgres.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createTestPool } from "../../storage-substrate/__tests__/_pg-test-pool.js";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import {
  createPostgresStorageSubstrate,
  createSchemaReconciler,
  ALL_SCHEMAS,
  type PostgresSubstrate,
  type SchemaReconciler,
} from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import { IdeaRepositorySubstrate } from "../../entities/idea-repository-substrate.js";
import { MissionRepositorySubstrate } from "../../entities/mission-repository-substrate.js";
import { ThreadRepositorySubstrate } from "../../entities/thread-repository-substrate.js";
import { ProposalRepositorySubstrate } from "../../entities/proposal-repository-substrate.js";
import { PendingActionRepositorySubstrate } from "../../entities/pending-action-repository-substrate.js";
import { PolicyRouter } from "../router.js";
import { registerIdeaPolicy } from "../idea-policy.js";
import { registerMissionPolicy } from "../mission-policy.js";
import { registerThreadPolicy } from "../thread-policy.js";
import { registerProposalPolicy } from "../proposal-policy.js";
import type { IPolicyContext, AllStores } from "../types.js";
const MIGRATIONS_DIR = join(__dirname, "..", "..", "storage-substrate", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];

/** Insert an envelope-shaped row directly (simulates post-W6 production state). */
type Row = { kind: string; id: string; data: Record<string, unknown> };

function parse(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text);
}

describe("W3 Layer-B FieldAccessor envelope sweep (testcontainers, real policy path)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let connStr: string;
  let substrate: PostgresSubstrate;
  let reconciler: SchemaReconciler;
  let router: PolicyRouter;
  let ctx: IPolicyContext;

  async function seed(rows: Row[]): Promise<void> {
    for (const r of rows) {
      await pool.query(
        `INSERT INTO entities (kind, id, data, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
        [r.kind, r.id, r.data],
      );
    }
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = createTestPool(connStr, "layerb-accessor-sweep-w3");
    for (const f of MIGRATION_FILES) {
      await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    }

    substrate = createPostgresStorageSubstrate(connStr);
    reconciler = createSchemaReconciler(substrate, connStr, {
      initialSchemas: ALL_SCHEMAS,
      log: () => { /* silent */ },
      warn: () => { /* silent */ },
    });
    await reconciler.start();
    // W2 translate-point — needed for the push-down tools (list_proposals,
    // get_pending_actions) whose repos filter via substrate.list.
    substrate.setFieldTranslator((kind, key) => reconciler.getFieldTranslation(kind, key));

    const counter = new SubstrateCounter(substrate);
    const stores = {
      idea: new IdeaRepositorySubstrate(substrate, counter),
      mission: new MissionRepositorySubstrate(substrate, counter, new IdeaRepositorySubstrate(substrate, counter)),
      thread: new ThreadRepositorySubstrate(substrate, counter),
      proposal: new ProposalRepositorySubstrate(substrate, counter),
      pendingAction: new PendingActionRepositorySubstrate(substrate, counter),
      // RBAC stub: "unknown" role bypasses the router's role check;
      // getAgentForSession→null skips the auto-claim block.
      engineerRegistry: { getRole: () => "unknown", getAgentForSession: async () => null },
    } as unknown as AllStores;

    router = new PolicyRouter(() => { /* silent */ });
    registerIdeaPolicy(router);
    registerMissionPolicy(router);
    registerThreadPolicy(router);
    registerProposalPolicy(router);

    ctx = {
      stores,
      emit: async () => { /* noop */ },
      dispatch: async () => { /* noop */ },
      sessionId: "test-session",
      clientIp: "127.0.0.1",
      role: "architect",
      internalEvents: [],
      metrics: { increment: () => { /* noop */ }, snapshot: () => ({}), recentDetails: () => [] } as unknown as IPolicyContext["metrics"],
    } as IPolicyContext;
  }, 90_000);

  afterAll(async () => {
    if (reconciler) await reconciler.close();
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, 30_000);

  beforeEach(async () => {
    await pool.query(`DELETE FROM entities WHERE kind IN ('Idea','Mission','Thread','Proposal','PendingAction')`);
  });

  function idea(id: string, phase: string, extra: Record<string, unknown> = {}, status: Record<string, unknown> = {}): Row {
    return { kind: "Idea", id, data: { id, kind: "Idea", apiVersion: "core.ois/v1", metadata: { name: id, ...extra }, spec: { text: "x" }, status: { phase, ...status } } };
  }

  it("W3.1 list_ideas: envelope status + non-FSM missionId accessors read envelope-aware (F4)", async () => {
    await seed([
      idea("w3-i1", "triaged", { sourceThreadId: "thr-1" }, { missionId: "mission-90" }),
      idea("w3-i2", "open", {}, { missionId: "mission-91" }),
    ]);
    // status → status.phase
    expect((parse(await router.handle("list_ideas", { filter: { status: "triaged" } }, ctx)).ideas as Array<{ id: string }>).map((i) => i.id)).toEqual(["w3-i1"]);
    // missionId → status.missionId (non-FSM relocation)
    expect((parse(await router.handle("list_ideas", { filter: { missionId: "mission-90" } }, ctx)).ideas as Array<{ id: string }>).map((i) => i.id)).toEqual(["w3-i1"]);
    // sourceThreadId → metadata.sourceThreadId
    expect((parse(await router.handle("list_ideas", { filter: { sourceThreadId: "thr-1" } }, ctx)).ideas as Array<{ id: string }>).map((i) => i.id)).toEqual(["w3-i1"]);
    // combined filter (status + missionId)
    expect((parse(await router.handle("list_ideas", { filter: { status: "triaged", missionId: "mission-90" } }, ctx)).ideas as Array<{ id: string }>).map((i) => i.id)).toEqual(["w3-i1"]);
    // non-matching status → empty (and pre-W3 envelope-blind would have returned 0 for ALL of the above)
    expect((parse(await router.handle("list_ideas", { filter: { status: "dismissed" } }, ctx)).ideas as unknown[])).toHaveLength(0);
  }, 30_000);

  it("W7 (bug-158) list_missions: MISSION_ACCESSORS read envelope-aware — the W3-MISSED tool, exposed live by the strict cutover (F4)", async () => {
    // mission-90 W7: the W3 sweep converted IDEA/TASK/THREAD accessors but missed
    // MISSION_ACCESSORS (raw m.status / m.createdAt / ...). The strict all-envelope
    // cutover exposed it: list_missions({status}) returned 0 for ALL statuses on
    // prod (m.status was the {phase} OBJECT) — breaking ledger/Survey (idea-325).
    await seed([
      { kind: "Mission", id: "w7-m1", data: { id: "w7-m1", kind: "Mission", apiVersion: "core.ois/v1", metadata: { name: "w7-m1", correlationId: "corr-A", createdBy: { role: "architect", agentId: "arch-1" } }, spec: { title: "a" }, status: { phase: "active" } } },
      { kind: "Mission", id: "w7-m2", data: { id: "w7-m2", kind: "Mission", apiVersion: "core.ois/v1", metadata: { name: "w7-m2", correlationId: "corr-B" }, spec: { title: "b" }, status: { phase: "completed" } } },
    ]);
    // status → status.phase (the dispositive prod regression: pre-fix → 0 matches)
    expect((parse(await router.handle("list_missions", { filter: { status: "active" } }, ctx)).missions as Array<{ id: string }>).map((m) => m.id)).toEqual(["w7-m1"]);
    // work-171 (A2): deprecated scalar `status:` retired → filter{status} is the sole surface
    expect((parse(await router.handle("list_missions", { filter: { status: "completed" } }, ctx)).missions as Array<{ id: string }>).map((m) => m.id)).toEqual(["w7-m2"]);
    // relocated metadata.correlationId accessor
    expect((parse(await router.handle("list_missions", { filter: { correlationId: "corr-A" } }, ctx)).missions as Array<{ id: string }>).map((m) => m.id)).toEqual(["w7-m1"]);
    // work-162 (A1): the status.turnId accessor assertion is retired with Mission.turnId.
    // relocated metadata.createdBy accessor
    expect((parse(await router.handle("list_missions", { filter: { "createdBy.role": "architect" } }, ctx)).missions as Array<{ id: string }>).map((m) => m.id)).toEqual(["w7-m1"]);
    // non-matching status → empty + _ois_query_unmatched (pre-fix this was the result for EVERY status)
    const none = parse(await router.handle("list_missions", { filter: { status: "abandoned" } }, ctx));
    expect(none.missions as unknown[]).toHaveLength(0);
    expect(none._ois_query_unmatched).toBe(true);
  }, 30_000);

  // work-162 (A1): the "W3.2 list_tasks" accessor test is RETIRED — list_tasks
  // (the 9th tool) is gone with the Task subsystem.

  it("W3.3 list_threads: envelope status accessor reads envelope-aware (F4)", async () => {
    await seed([
      { kind: "Thread", id: "w3-th1", data: { id: "w3-th1", kind: "Thread", apiVersion: "core.ois/v1", metadata: { name: "w3-th1" }, spec: {}, status: { phase: "active", currentTurnAgentId: "eng-9" } } },
      { kind: "Thread", id: "w3-th2", data: { id: "w3-th2", kind: "Thread", apiVersion: "core.ois/v1", metadata: { name: "w3-th2" }, spec: {}, status: { phase: "closed" } } },
    ]);
    expect((parse(await router.handle("list_threads", { filter: { status: "active" } }, ctx)).threads as Array<{ id: string }>).map((t) => t.id)).toEqual(["w3-th1"]);
    // relocated status.currentTurnAgentId accessor
    expect((parse(await router.handle("list_threads", { filter: { currentTurnAgentId: "eng-9" } }, ctx)).threads as Array<{ id: string }>).map((t) => t.id)).toEqual(["w3-th1"]);
  }, 30_000);

  it("W3.4 list_proposals: status PUSH-DOWN → substrate translate-point (envelope path)", async () => {
    await seed([
      { kind: "Proposal", id: "w3-p1", data: { id: "w3-p1", kind: "Proposal", apiVersion: "core.ois/v1", metadata: { name: "w3-p1" }, spec: { title: "a" }, status: { phase: "approved" } } },
      { kind: "Proposal", id: "w3-p2", data: { id: "w3-p2", kind: "Proposal", apiVersion: "core.ois/v1", metadata: { name: "w3-p2" }, spec: { title: "b" }, status: { phase: "submitted" } } },
    ]);
    expect((parse(await router.handle("list_proposals", { status: "approved" }, ctx)).proposals as Array<{ id: string }>).map((p) => p.id)).toEqual(["w3-p1"]);
    const none = parse(await router.handle("list_proposals", { status: "rejected" }, ctx));
    expect(none.proposals as unknown[]).toHaveLength(0);
    expect(none._ois_query_unmatched).toBe(true); // collection non-empty, nothing matched
  }, 30_000);

  it("W3.6 get_pending_actions alignment: listForAgent state filter pushes down (envelope path)", async () => {
    // get_pending_actions is unchanged (bug-143 phaseFromEntity at FSM guards); its
    // list path is a repo push-down (listForAgent({state})) → W2 translate-point.
    // Confirm the push-down resolves state→status.phase against envelope rows.
    await seed([
      { kind: "PendingAction", id: "w3-pa1", data: { id: "w3-pa1", kind: "PendingAction", apiVersion: "core.ois/v1", metadata: { name: "w3-pa1", naturalKey: "nk1" }, spec: { targetAgentId: "eng-7", dispatchType: "task", entityRef: "task-1" }, status: { phase: "enqueued" } } },
      { kind: "PendingAction", id: "w3-pa2", data: { id: "w3-pa2", kind: "PendingAction", apiVersion: "core.ois/v1", metadata: { name: "w3-pa2", naturalKey: "nk2" }, spec: { targetAgentId: "eng-7", dispatchType: "task", entityRef: "task-2" }, status: { phase: "completion_acked" } } },
    ]);
    const enqueued = await ctx.stores.pendingAction.listForAgent("eng-7", { state: "enqueued" });
    expect(enqueued.map((p) => p.id)).toEqual(["w3-pa1"]);
  }, 30_000);
});
