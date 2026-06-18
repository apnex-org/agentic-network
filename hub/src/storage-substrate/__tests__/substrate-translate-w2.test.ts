/**
 * mission-90 W2 — substrate.list filter+sort key-translation wire-flow gate
 * (Design §4 W2 row; calibration #62 end-to-end-wire-flow discipline).
 *
 * White-box: real envelope payloads through the REAL postgres substrate.list,
 * with the reconciler's getFieldTranslation wired in (as Hub boot does). Each
 * case asserts BOTH:
 *   (a) the RESULT-SET — the bare filter/sort key resolves to the envelope
 *       JSONB path so the right rows come back (the bug-138 fix), and
 *   (b) the GENERATED SQL path (`data#>>'{...}'`) — proving the translation
 *       happened at the SQL layer, not by accident.
 *
 * Kinds exercise the three rename shapes called out in the gate:
 *   - Message  kind → metadata.messageKind   (field-name COLLISION, cluster-4)
 *   - Idea     missionId → status.missionId   (non-FSM mutable link)
 *   - PendingAction state → status.phase      (FSM)
 * plus a no-regression passthrough (untranslated key → bare `data->>'...'`)
 * and a SORT-key translation case.
 *
 * A negative control (unwired substrate, same data + same filter → empty)
 * pins that bug-138 is genuinely reproduced and that the wiring is load-bearing.
 *
 * testcontainers postgres (NOT memory backend) per thread-658 N2 + the W2 gate.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import {
  createPostgresStorageSubstrate,
  createSchemaReconciler,
  ALL_SCHEMAS,
  type PostgresSubstrate,
  type SchemaReconciler,
} from "../index.js";

const TEST_SETUP_TIMEOUT = 90_000;
const TEST_OP_TIMEOUT = 60_000;

const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];

/** Envelope-shaped fixtures — only the partitions list() must traverse matter. */
const FIXTURES: Array<{ kind: string; id: string; data: Record<string, unknown> }> = [
  // Message: bare filter key `kind` collides with the entity-kind column; must
  // resolve to metadata.messageKind (NOT data->>'kind', which is "Message").
  { kind: "Message", id: "w2-m1", data: { id: "w2-m1", name: "w2-m1", kind: "Message", apiVersion: "core.ois/v1", metadata: { name: "w2-m1", messageKind: "note" }, spec: { body: "hi" }, status: { phase: "new" }, threadId: "w2-t1" } },
  { kind: "Message", id: "w2-m2", data: { id: "w2-m2", name: "w2-m2", kind: "Message", apiVersion: "core.ois/v1", metadata: { name: "w2-m2", messageKind: "status_check" }, spec: { body: "yo" }, status: { phase: "acked" }, threadId: "w2-t2" } },
  // Idea: non-FSM mutable link missionId → status.missionId.
  { kind: "Idea", id: "w2-i1", data: { id: "w2-i1", kind: "Idea", apiVersion: "core.ois/v1", metadata: { name: "w2-i1" }, spec: { title: "a" }, status: { phase: "triaged", missionId: "mission-90" } } },
  { kind: "Idea", id: "w2-i2", data: { id: "w2-i2", kind: "Idea", apiVersion: "core.ois/v1", metadata: { name: "w2-i2" }, spec: { title: "b" }, status: { phase: "proposed", missionId: "mission-91" } } },
  // PendingAction: FSM state → status.phase.
  { kind: "PendingAction", id: "w2-p1", data: { id: "w2-p1", kind: "PendingAction", apiVersion: "core.ois/v1", metadata: { name: "w2-p1" }, spec: {}, status: { phase: "working" } } },
  { kind: "PendingAction", id: "w2-p2", data: { id: "w2-p2", kind: "PendingAction", apiVersion: "core.ois/v1", metadata: { name: "w2-p2" }, spec: {}, status: { phase: "done" } } },
];

describe("W2 substrate.list translate-point (testcontainers postgres)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let connStr: string;
  let substrate: PostgresSubstrate;
  let reconciler: SchemaReconciler;

  /** Capture the SQL text(s) the substrate's OWN pool issues during `fn`. */
  async function captureSql(fn: () => Promise<unknown>): Promise<string[]> {
    const internalPool = (substrate as unknown as { pool: { query: (...a: unknown[]) => unknown } }).pool;
    const spy = vi.spyOn(internalPool, "query");
    try {
      await fn();
      return spy.mock.calls.map((c) => String((c as unknown[])[0]));
    } finally {
      spy.mockRestore();
    }
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = new Pool({ connectionString: connStr });
    for (const f of MIGRATION_FILES) {
      await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    }

    // Wire the substrate exactly as Hub boot does: reconciler.start() builds the
    // translation map, then setFieldTranslator injects getFieldTranslation.
    substrate = createPostgresStorageSubstrate(connStr);
    reconciler = createSchemaReconciler(substrate, connStr, { initialSchemas: ALL_SCHEMAS });
    await reconciler.start();
    substrate.setFieldTranslator((kind, bareKey) => reconciler.getFieldTranslation(kind, bareKey));

    for (const f of FIXTURES) {
      await pool.query(
        `INSERT INTO entities (kind, id, data, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
        [f.kind, f.id, f.data],
      );
    }
  }, TEST_SETUP_TIMEOUT);

  afterAll(async () => {
    if (reconciler) await reconciler.close();
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, TEST_OP_TIMEOUT);

  it(
    "W2.1 Message kind-collision: filter {kind} → metadata.messageKind (result-set + SQL path); unwired = bug-138 empty",
    async () => {
      let res!: { items: Array<{ id: string }> };
      const sqls = await captureSql(async () => {
        res = await substrate.list<{ id: string }>("Message", { filter: { kind: "note" } });
      });
      // (a) result-set: only the metadata.messageKind="note" row
      expect(res.items.map((i) => i.id)).toEqual(["w2-m1"]);
      // (b) SQL path: bare `kind` rewritten to the envelope JSONB path, NOT data->>'kind'
      expect(sqls.some((s) => s.includes("data#>>'{metadata,messageKind}'"))).toBe(true);
      expect(sqls.some((s) => s.includes("data->>'kind'"))).toBe(false);

      // Negative control: an UNWIRED substrate (no translator) is envelope-blind —
      // filter {kind:"note"} hits data->>'kind' (= "Message") → zero rows = bug-138.
      const blind = createPostgresStorageSubstrate(connStr);
      try {
        const blindRes = await blind.list<{ id: string }>("Message", { filter: { kind: "note" } });
        expect(blindRes.items).toHaveLength(0);
      } finally {
        await blind.close();
      }
    },
    TEST_OP_TIMEOUT,
  );

  it(
    "W2.2 Idea non-FSM link: filter {missionId} → status.missionId (result-set + SQL path)",
    async () => {
      let res!: { items: Array<{ id: string }> };
      const sqls = await captureSql(async () => {
        res = await substrate.list<{ id: string }>("Idea", { filter: { missionId: "mission-90" } });
      });
      expect(res.items.map((i) => i.id)).toEqual(["w2-i1"]);
      expect(sqls.some((s) => s.includes("data#>>'{status,missionId}'"))).toBe(true);
    },
    TEST_OP_TIMEOUT,
  );

  it(
    "W2.3 PendingAction FSM: filter {state} → status.phase (result-set + SQL path)",
    async () => {
      let res!: { items: Array<{ id: string }> };
      const sqls = await captureSql(async () => {
        res = await substrate.list<{ id: string }>("PendingAction", { filter: { state: "working" } });
      });
      expect(res.items.map((i) => i.id)).toEqual(["w2-p1"]);
      expect(sqls.some((s) => s.includes("data#>>'{status,phase}'"))).toBe(true);
    },
    TEST_OP_TIMEOUT,
  );

  it(
    "W2.4 no-regression: an untranslated key passes through to the bare data->>'...' path",
    async () => {
      let res!: { items: Array<{ id: string }> };
      const sqls = await captureSql(async () => {
        // `threadId` carries no renameMap entry → pure passthrough.
        res = await substrate.list<{ id: string }>("Message", { filter: { threadId: "w2-t1" } });
      });
      expect(res.items.map((i) => i.id)).toEqual(["w2-m1"]);
      expect(sqls.some((s) => s.includes("data->>'threadId'"))).toBe(true);
      // Passthrough must NOT fabricate an envelope path for a non-renamed key.
      expect(sqls.some((s) => s.includes("data#>>'{") && s.includes("threadId"))).toBe(false);
    },
    TEST_OP_TIMEOUT,
  );

  it(
    "W2.5 SORT key translation: sort {field: state} → ORDER BY status.phase (result order + SQL path)",
    async () => {
      let res!: { items: Array<{ id: string }> };
      const sqls = await captureSql(async () => {
        res = await substrate.list<{ id: string }>("PendingAction", { sort: [{ field: "state", order: "asc" }] });
      });
      // phase asc → "done" (w2-p2) before "working" (w2-p1)
      expect(res.items.map((i) => i.id)).toEqual(["w2-p2", "w2-p1"]);
      expect(sqls.some((s) => s.includes("ORDER BY") && s.includes("data#>>'{status,phase}'"))).toBe(true);
    },
    TEST_OP_TIMEOUT,
  );
});
