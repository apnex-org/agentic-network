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
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createTestPool } from "./_pg-test-pool.js";
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
import { writeEncoderRegisteredKinds } from "../migrations/v2-envelope/write-encoder.js";
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

  describe("0. registry completeness (BACKSTOP — converts 'complete by construction' to test-enforced)", () => {
    it("write-encoder registry is BIDIRECTIONALLY complete vs the kinds/*.ts migration modules", () => {
      // Enumerate the per-kind migration-module files (the single kind authority).
      const kindsDir = join(MIGRATIONS_DIR, "v2-envelope", "kinds");
      const moduleKinds = readdirSync(kindsDir)
        .filter((f) => f.endsWith(".ts") && f !== "_contract.ts")
        .map((f) => f.replace(/\.ts$/, ""))
        .sort();
      const registry = writeEncoderRegisteredKinds();
      // (a) every module file is registered — a future kind that adds a module but
      // forgets the registry entry FAILS here (the Turn-class omission, structurally).
      const missingFromRegistry = moduleKinds.filter((k) => !registry.includes(k));
      expect(missingFromRegistry, `kinds with a migration module but NOT in the write-encoder registry`).toEqual([]);
      // (b) no stale registry entry pointing at a non-existent module file.
      const staleInRegistry = registry.filter((k) => !moduleKinds.includes(k));
      expect(staleInRegistry, `write-encoder registry entries with no migration-module file`).toEqual([]);
    });
  });

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
      pool = createTestPool(connStr, "write-encoder-and-watch-w4");
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

    it("bug-187: a write committed in the LISTEN→replay window is delivered EXACTLY once (gap-free + dedup)", async () => {
      // Seed a baseline so the watch has a sinceRevision floor; its NOTIFY fires
      // BEFORE the watch's LISTEN, so the baseline is itself never replayed.
      const base = await substrate.put("Bug", { id: "b187-base", title: "t", severity: "minor", class: "c", status: "open" });

      // Plant a racing write INSIDE the (now-closed) LISTEN→replay window via the
      // test seam: it commits AFTER LISTEN (its NOTIFY is buffered live) AND
      // BEFORE the replay SELECT (the SELECT also sees it) → the overlap. The fix
      // must surface it EXACTLY once — not zero (the old SELECT-before-LISTEN
      // order would miss it: the lost-NOTIFY gap, bug-187) and not twice
      // (subscribe-before-replay WITHOUT the resource_version dedup would dupe it).
      (substrate as unknown as { _watchTestHookAfterListen?: () => Promise<void> })._watchTestHookAfterListen =
        async () => {
          await substrate.put("Bug", { id: "b187-race", title: "r", severity: "minor", class: "c", status: "open" });
        };

      const ac = new AbortController();
      const seen: Array<{ id: string; op: string }> = [];
      const done = (async () => {
        for await (const ev of substrate.watch<{ id: string }>("Bug", { sinceRevision: base.resourceVersion, signal: ac.signal })) {
          seen.push({ id: ev.id, op: ev.op });
        }
      })();

      // Allow the watch to start, fire the seam (race write), run replay + the
      // live drain — plus slack for a (wrong) duplicate to surface before assert.
      await new Promise((r) => setTimeout(r, 800));
      ac.abort();
      await done.catch(() => {});

      const raceDeliveries = seen.filter((e) => e.id === "b187-race");
      expect(raceDeliveries).toHaveLength(1); // exactly once: gap-free AND no dupe
    }, OP_TIMEOUT);

    it("work-41: two writes to the SAME row in the LISTEN→replay overlap deliver ONCE at the latest rv, monotonic (no [4,2] regression)", async () => {
      // steve audit-4533 finding 1: the exact-rv-Set dedup leaked the STALE older
      // NOTIFY AFTER the replay yielded the latest → out-of-order + cursor
      // regression (his [4,2] probe). The monotonic cursor must skip the stale rv.
      // Seed a baseline floor, then write the SAME id TWICE inside the overlap (rv
      // R2 then R3). Replay sees only the latest existing state (R3); both NOTIFYs
      // buffer. Assert: id delivered EXACTLY once, AT R3 (not the stale R2), and the
      // full delivered rv sequence is strictly increasing (never regresses).
      const base = await substrate.put("Bug", { id: "w41-base", title: "t", severity: "minor", class: "c", status: "open" });
      let r2 = "";
      let r3 = "";
      (substrate as unknown as { _watchTestHookAfterListen?: () => Promise<void> })._watchTestHookAfterListen =
        async () => {
          r2 = (await substrate.put("Bug", { id: "w41-multi", title: "v2", severity: "minor", class: "c", status: "open" })).resourceVersion;
          r3 = (await substrate.put("Bug", { id: "w41-multi", title: "v3", severity: "minor", class: "c", status: "open" })).resourceVersion;
        };

      const ac = new AbortController();
      const seen: Array<{ id: string; rv: string }> = [];
      const done = (async () => {
        for await (const ev of substrate.watch<{ id: string }>("Bug", { sinceRevision: base.resourceVersion, signal: ac.signal })) {
          seen.push({ id: ev.id, rv: ev.resourceVersion });
        }
      })();
      await new Promise((r) => setTimeout(r, 800));
      ac.abort();
      await done.catch(() => {});

      const multi = seen.filter((e) => e.id === "w41-multi");
      expect(multi).toHaveLength(1);                       // exactly once (no stale dup)
      expect(multi[0]!.rv).toBe(r3);                       // at the LATEST rv...
      expect(seen.some((e) => e.rv === r2)).toBe(false);   // ...the stale R2 NEVER delivered
      // Monotonic: the delivered rv sequence strictly increases — no regression.
      const rvs = seen.map((e) => BigInt(e.rv));
      for (let i = 1; i < rvs.length; i++) expect(rvs[i]! > rvs[i - 1]!).toBe(true);
    }, OP_TIMEOUT);

    it("work-41 (#4b): a server-terminated LISTEN backend SETTLES the watch — the generator TERMINATES (→ reconnect), not hangs (real-pg)", async () => {
      // steve audit-4533 finding 2 — the faithful-harness fix: the MOCK modeled a
      // generator that ends/throws on termination; real pg does NOT (the SDK only
      // fires 'end'/'error'). Kill the watch's LISTEN backend from another
      // connection; the 'end'/'error' handler must SETTLE the iterator so the
      // for-await ENDS (→ runtimeWatchSession returns "reconnect"). Pre-fix the
      // loop re-parks on ready() forever → the generator hangs → the race below
      // times out to false. We target ONLY this watch's backend (pid-diff) so the
      // beforeAll reconciler's own SchemaDef LISTEN is spared.
      const listenPids = async (): Promise<number[]> => {
        const r = await pool.query<{ pid: number }>(
          `SELECT pid FROM pg_stat_activity WHERE query = 'LISTEN entities_change' AND pid <> pg_backend_pid()`,
        );
        return r.rows.map((row) => row.pid);
      };
      const before = new Set(await listenPids());

      const ac = new AbortController();
      let terminated = false;
      const loop = (async () => {
        for await (const _ev of substrate.watch<{ id: string }>("Bug", { signal: ac.signal })) {
          /* drain */
        }
        terminated = true; // the for-await ENDED (generator returned) — not hung
      })();

      // Let this watch's LISTEN establish, then terminate ONLY its backend.
      await new Promise((r) => setTimeout(r, 600));
      const mine = (await listenPids()).filter((pid) => !before.has(pid));
      expect(mine.length).toBeGreaterThanOrEqual(1); // sanity: this watch's LISTEN is up
      for (const pid of mine) {
        await pool.query(`SELECT pg_terminate_backend($1)`, [pid]);
      }

      // The generator must terminate within a bounded window (pre-fix: hangs).
      const settled = await Promise.race([
        loop.then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 6000)),
      ]);
      expect(settled).toBe(true);
      expect(terminated).toBe(true);
      ac.abort(); // no-op cleanup (already terminated)
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

    it("bug-152: thread reply + 2-round convergence FSM runs end-to-end on ENVELOPE-backed storage", async () => {
      // With the encoder wired (beforeAll), openThread STORES an envelope row, so
      // the whole FSM below reads it back through normalizeThreadShape (which must
      // FULL-DECODE status/currentTurn/roundCount to legacy-flat) and re-encodes on
      // every CAS write. Pre-bug-152-fix the decode was partial → current.status was
      // the envelope OBJECT → `current.status !== "active"` always threw
      // TransitionRejected → replyToThread returned null (reply/convergence broken
      // universally once W4's writer-closure makes ALL new threads envelope).
      const repo = new ThreadRepositorySubstrate(substrate, new SubstrateCounter(substrate));
      const t1 = await repo.openThread("envelope FSM", "init", "engineer", {
        authorAgentId: "agent-greg-152",
        recipientAgentId: "agent-lily-152",
      });
      const stored1 = await pool.query<{ data: Record<string, unknown> }>(
        `SELECT data FROM entities WHERE kind='Thread' AND id=$1`, [t1.id]);
      expect(isEnvelopeShape(stored1.rows[0]?.data), "openThread stored envelope (writer-closure)").toBe(true);

      // architect replies — reads decoded status==="active" + currentTurn==="architect"
      const t2 = await repo.replyToThread(t1.id, "arch response", "architect", { authorAgentId: "agent-lily-152" });
      expect(t2, "reply on an envelope thread must NOT be turn-rejected (bug-152)").not.toBeNull();
      expect(t2?.status).toBe("active");
      expect(t2?.roundCount).toBe(2);
      expect(t2?.messages).toHaveLength(2);
      expect(t2?.currentTurn).toBe("engineer");

      // engineer converges (round 1 — lastMessageConverged not yet true)
      const t3 = await repo.replyToThread(t1.id, "eng converge", "engineer", {
        authorAgentId: "agent-greg-152",
        converged: true,
        stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "done" } }],
        summary: "converged",
      });
      expect(t3?.status).toBe("active");
      expect(t3?.convergenceActions).toHaveLength(1);
      expect(t3?.convergenceActions[0]?.status).toBe("staged");

      // architect converges (round 2 → willConverge: status mutates to converged, actions commit)
      const t4 = await repo.replyToThread(t1.id, "arch converge", "architect", {
        authorAgentId: "agent-lily-152",
        converged: true,
        summary: "converged-confirmed",
      });
      expect(t4?.status).toBe("converged");
      expect(t4?.convergenceActions[0]?.status).toBe("committed");
      expect(t4?.messages).toHaveLength(4);

      // FSM mutation round-trips back to a CLEAN envelope (status.phase reflects it).
      const stored4 = await pool.query<{ data: Record<string, unknown> }>(
        `SELECT data FROM entities WHERE kind='Thread' AND id=$1`, [t1.id]);
      expect(isEnvelopeShape(stored4.rows[0]?.data)).toBe(true);
      expect((stored4.rows[0]?.data.status as Record<string, unknown>).phase).toBe("converged");
      // no re-partition garbage from the decode/encode cycle (spec must not carry a nested bucket)
      expect((stored4.rows[0]?.data.spec as Record<string, unknown>).metadata).toBeUndefined();
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
