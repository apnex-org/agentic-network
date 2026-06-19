/**
 * mission-90 W4 — write-encoder (close-all-bare-writers) + watch matchesFilter
 * envelope-awareness gate (Design §4 W4 row; idea-324 / N1).
 *
 * Three pins:
 *  1. PASSTHROUGH (architect-pinned, load-bearing): the encoder is byte-identical
 *     for already-envelope rows, put-then-put is stable, and an envelope row
 *     carrying status (the W1→W5 SchemaDef status-stamp seam) keeps its status.
 *  2. NO-NEW-BARE CANARY: with setWriteEncoder wired, a BARE entity written via
 *     substrate.put/createOnly for each live-bare-writer kind lands ENVELOPE-shape
 *     (the chokepoint every repo write path funnels through). dispositive close-all.
 *  3. WATCH matchesFilter envelope-aware (N1) — a renamed/relocated-key watch
 *     filter matches envelope rows, in BOTH substrates (postgres + memory).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import {
  createPostgresStorageSubstrate,
  createMemoryStorageSubstrate,
  createSchemaReconciler,
  buildEnvelopeWriteEncoder,
  ALL_SCHEMAS,
  type PostgresSubstrate,
  type SchemaReconciler,
  type HubStorageSubstrate,
} from "../index.js";
import { isEnvelopeShape } from "../migrations/v2-envelope/shared/envelope.js";
import { ThreadRepositorySubstrate } from "../../entities/thread-repository-substrate.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";

const SETUP_TIMEOUT = 90_000;
const OP_TIMEOUT = 60_000;
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];

// One representative BARE (legacy-flat) entity per live-bare-writer kind (idea-324
// preflight c1). The encoder must turn each into an envelope row.
const BARE_FIXTURES: Array<{ kind: string; entity: Record<string, unknown> }> = [
  { kind: "Message", entity: { id: "w4-m1", kind: "note", authorRole: "engineer", authorAgentId: "eng-1", threadId: "t1", status: "new" } },
  { kind: "Audit", entity: { id: "w4-a1", timestamp: "2026-01-01T00:00:00Z", actor: "hub", action: "x", details: "d" } },
  { kind: "Bug", entity: { id: "w4-b1", title: "t", severity: "minor", class: "c", status: "open" } },
  { kind: "PendingAction", entity: { id: "w4-pa1", targetAgentId: "eng-1", dispatchType: "task", state: "enqueued", entityRef: "task-1", naturalKey: "nk1" } },
  { kind: "Thread", entity: { id: "w4-th1", title: "t", status: "active", routingMode: "broadcast" } },
  { kind: "Idea", entity: { id: "w4-i1", text: "x", status: "open" } },
  { kind: "Mission", entity: { id: "w4-mi1", title: "t", status: "active" } },
  { kind: "Task", entity: { id: "w4-t1", directive: "d", status: "pending" } },
  { kind: "Turn", entity: { id: "w4-tn1", title: "t", status: "planning", correlationId: "c1" } },
];

describe("W4 write-encoder + watch envelope-awareness", () => {
  const encoder = buildEnvelopeWriteEncoder();

  describe("1. passthrough invariants (architect-pinned)", () => {
    it("already-envelope row → encoder → byte-identical (no double-encode)", () => {
      const env = encoder("Bug", BARE_FIXTURES[2]!.entity);
      expect(isEnvelopeShape(env)).toBe(true);
      const again = encoder("Bug", env);
      expect(again).toEqual(env); // stable; re-encode is a no-op
    });

    it("envelope row carrying status SURVIVES the encoder (W1→W5 status-stamp seam)", () => {
      // A SchemaDef-shaped envelope with a status.phase/appliedVersion stamp (what
      // the W1 boot-put + W5 status-write produce) must pass through unchanged.
      const enveloped = encoder("SchemaDef", { id: "Bug", kind: "Bug", version: 1, fields: [], indexes: [], watchable: true }) as Record<string, unknown>;
      const status = enveloped.status as Record<string, unknown>;
      expect(status.phase).toBe("applied");
      const reencoded = encoder("SchemaDef", { ...enveloped, status: { ...status, phase: "failed", reconcileError: "boom" } }) as Record<string, unknown>;
      // re-encoding an already-envelope row preserves its (caller-set) status — no reset.
      expect((reencoded.status as Record<string, unknown>).phase).toBe("failed");
      expect((reencoded.status as Record<string, unknown>).reconcileError).toBe("boom");
    });

    it("kind with NO migration module (MigrationCursor) passes through unchanged", () => {
      const bare = { id: "cursor-Bug", lastMigratedId: "bug-9", lastMigratedAt: "2026-01-01T00:00:00Z" };
      expect(encoder("MigrationCursor", bare)).toBe(bare); // same ref — no module, passthrough
    });
  });

  describe("2 + 3. canary + watch (testcontainers postgres)", () => {
    let container: StartedPostgreSqlContainer;
    let pool: Pool;
    let connStr: string;
    let substrate: PostgresSubstrate;
    let reconciler: SchemaReconciler;

    beforeAll(async () => {
      container = await new PostgreSqlContainer("postgres:15-alpine")
        .withUsername("hub").withPassword("hub").withDatabase("hub").start();
      connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
      pool = new Pool({ connectionString: connStr });
      for (const f of MIGRATION_FILES) await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
      substrate = createPostgresStorageSubstrate(connStr);
      reconciler = createSchemaReconciler(substrate, connStr, { initialSchemas: ALL_SCHEMAS, log: () => {}, warn: () => {} });
      await reconciler.start();
      // Wire BOTH hooks exactly as Hub boot does.
      substrate.setFieldTranslator((kind, key) => reconciler.getFieldTranslation(kind, key));
      substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    }, SETUP_TIMEOUT);

    afterAll(async () => {
      if (reconciler) await reconciler.close();
      if (substrate) await substrate.close();
      if (pool) await pool.end();
      if (container) await container.stop();
    }, OP_TIMEOUT);

    it("NO-NEW-BARE CANARY: every live-bare-writer kind lands ENVELOPE-shape via the substrate chokepoint", async () => {
      for (const f of BARE_FIXTURES) {
        await substrate.put(f.kind, f.entity); // the path every repo write funnels through
        const r = await pool.query<{ data: Record<string, unknown> }>(
          `SELECT data FROM entities WHERE kind = $1 AND id = $2`, [f.kind, f.entity.id],
        );
        expect(isEnvelopeShape(r.rows[0]?.data), `${f.kind} row not envelope-shape after encoded put`).toBe(true);
      }
      // createOnly path too (the conflict-on-existing write path).
      await substrate.createOnly("Bug", { id: "w4-b2", title: "t2", severity: "major", class: "c", status: "open" });
      const r2 = await pool.query<{ data: Record<string, unknown> }>(`SELECT data FROM entities WHERE kind='Bug' AND id='w4-b2'`);
      expect(isEnvelopeShape(r2.rows[0]?.data)).toBe(true);
    }, OP_TIMEOUT);

    it("WATCH matchesFilter envelope-aware (N1): a relocated-key filter matches envelope rows (postgres)", async () => {
      // The scheduled-message-sweeper's live filter (bug-151): delivery→spec.delivery,
      // scheduledState→status.scheduledState. Seed via the encoder, then watch.
      const ac = new AbortController();
      const seen: string[] = [];
      const done = (async () => {
        for await (const ev of substrate.watch<{ id: string }>("Message", {
          filter: { delivery: "scheduled", scheduledState: "pending" },
          signal: ac.signal,
        })) {
          if (ev.op === "put" && ev.entity) seen.push(ev.entity.id);
        }
      })();
      // small delay to establish LISTEN, then write a matching + a non-matching Message.
      await new Promise((r) => setTimeout(r, 300));
      await substrate.put("Message", { id: "w4-sched-match", kind: "note", authorRole: "hub", authorAgentId: "hub", delivery: "scheduled", scheduledState: "pending", status: "new" });
      await substrate.put("Message", { id: "w4-sched-miss", kind: "note", authorRole: "hub", authorAgentId: "hub", delivery: "scheduled", scheduledState: "delivered", status: "new" });
      await new Promise((r) => setTimeout(r, 600));
      ac.abort();
      await done.catch(() => {});
      expect(seen).toContain("w4-sched-match");
      expect(seen).not.toContain("w4-sched-miss");
    }, OP_TIMEOUT);

    it("bug-150+W4: normalizeThreadShape reads relocated fields envelope-native (messages/participants/routingMode survive)", async () => {
      // W4 closes the Thread writer → all new threads are envelope (status.messages/
      // participants/summary/currentTurnAgentId, spec.routingMode). The repo
      // normalizer MUST read them envelope-aware or get_thread/reply-routing/
      // convergence break (force-defaulted []/""/"unicast"). Seed an envelope thread
      // + read through the repo (applies normalizeThreadShape).
      await pool.query(
        `INSERT INTO entities (kind, id, data, created_at, updated_at) VALUES ('Thread',$1,$2,NOW(),NOW())`,
        ["w4-thr-env", {
          id: "w4-thr-env", name: "w4-thr-env", kind: "Thread", apiVersion: "core.ois/v1",
          metadata: { name: "w4-thr-env" },
          spec: { routingMode: "broadcast" },
          status: { phase: "active", summary: "s1", currentTurnAgentId: "eng-1", messages: [{ id: "m1", body: "hi" }], participants: [{ agentId: "eng-1" }], convergenceActions: [] },
        }],
      );
      const repo = new ThreadRepositorySubstrate(substrate, new SubstrateCounter(substrate));
      const threads = await repo.listThreads();
      const t = threads.find((x) => x.id === "w4-thr-env")!;
      expect(t, "envelope thread loaded").toBeDefined();
      expect(t.messages).toHaveLength(1);           // was force-defaulted [] pre-fix
      expect(t.participants).toHaveLength(1);        // was force-defaulted [] pre-fix
      expect(t.routingMode).toBe("broadcast");       // was force-defaulted "unicast" pre-fix (bug-150)
      expect(t.summary).toBe("s1");
      expect(t.currentTurnAgentId).toBe("eng-1");
    }, OP_TIMEOUT);
  });

  describe("3b. memory substrate watch/list matchesFilter envelope-aware (N2)", () => {
    it("memory list with a relocated-key filter matches envelope rows (reconciler-less static authority)", async () => {
      const mem: HubStorageSubstrate = createMemoryStorageSubstrate();
      // Seed envelope-shaped Messages directly (memory stores what it's given).
      await mem.put("Message", { id: "mem-1", name: "mem-1", kind: "Message", apiVersion: "core.ois/v1", metadata: { name: "mem-1" }, spec: { delivery: "scheduled" }, status: { phase: "new", scheduledState: "pending" } });
      await mem.put("Message", { id: "mem-2", name: "mem-2", kind: "Message", apiVersion: "core.ois/v1", metadata: { name: "mem-2" }, spec: { delivery: "scheduled" }, status: { phase: "acked", scheduledState: "delivered" } });
      // bare straggler — dual-shape fallback must still match it.
      await mem.put("Message", { id: "mem-3", kind: "note", delivery: "scheduled", scheduledState: "pending", status: "new" });
      const { items } = await mem.list<{ id: string }>("Message", { filter: { delivery: "scheduled", scheduledState: "pending" } });
      expect(items.map((i) => i.id).sort()).toEqual(["mem-1", "mem-3"]); // envelope (mem-1) + bare straggler (mem-3); mem-2 excluded
    }, OP_TIMEOUT);
  });
});
