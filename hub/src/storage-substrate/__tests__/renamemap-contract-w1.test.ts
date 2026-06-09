/**
 * mission-90 W1 — renameMap runtime-contract gate tests (Design §4 W1 row).
 *
 * Covers:
 *   1. Per-kind-EXACT inventory: all 28 renameMap entries across 20 kinds in
 *      ALL_SCHEMAS, pinned entry-by-entry (NEVER count-based — Design §2.6
 *      pinning rule) + parity with the per-kind v2-envelope migration modules
 *      (source-of-truth for entry content; Design §2.7 dual-source discipline).
 *   2. getFieldTranslation: renamed FSM key / field-collision key /
 *      opaque-state key / non-renamed key (null) / unknown kind (null).
 *   3. Malformed-renameMap → start() FAILS (STRICT failure-collector
 *      propagation; the throw must NOT be swallowed like per-index errors).
 *   4. 3× restart-cycle regression (testcontainers postgres — NOT memory
 *      backend, per thread-658 N2): zero index-DDL churn (pg_class oid
 *      stability), SchemaDef rows envelope-correct across restarts (boot-put
 *      fix dispositive), translation cache live each cycle.
 *   5. Watch-path decode: a runtime SchemaDef put in ENVELOPE shape reconciles
 *      the DESCRIBED kind (metadata.name), not the entity kind "SchemaDef".
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createPostgresStorageSubstrate, createSchemaReconciler, ALL_SCHEMAS } from "../index.js";
import type { SchemaDef, RenameMap } from "../types.js";
import { isEnvelopeShape } from "../migrations/v2-envelope/shared/envelope.js";

// Per-kind migration modules — parity oracle for entry content (§2.7).
import { createAgentMigrationModule } from "../migrations/v2-envelope/kinds/Agent.js";
import { createAuditMigrationModule } from "../migrations/v2-envelope/kinds/Audit.js";
import { createBugMigrationModule } from "../migrations/v2-envelope/kinds/Bug.js";
import { createIdeaMigrationModule } from "../migrations/v2-envelope/kinds/Idea.js";
import { createMessageMigrationModule } from "../migrations/v2-envelope/kinds/Message.js";
import { createMissionMigrationModule } from "../migrations/v2-envelope/kinds/Mission.js";
import { createPendingActionMigrationModule } from "../migrations/v2-envelope/kinds/PendingAction.js";
import { createProposalMigrationModule } from "../migrations/v2-envelope/kinds/Proposal.js";
import { createTaskMigrationModule } from "../migrations/v2-envelope/kinds/Task.js";
import { createTeleMigrationModule } from "../migrations/v2-envelope/kinds/Tele.js";
import { createThreadMigrationModule } from "../migrations/v2-envelope/kinds/Thread.js";
import { createTurnMigrationModule } from "../migrations/v2-envelope/kinds/Turn.js";
import { createSchemaDefMigrationModule } from "../migrations/v2-envelope/kinds/SchemaDef.js";
import { createNotificationMigrationModule } from "../migrations/v2-envelope/kinds/Notification.js";
import { createArchitectDecisionMigrationModule } from "../migrations/v2-envelope/kinds/ArchitectDecision.js";
import { createDirectorHistoryEntryMigrationModule } from "../migrations/v2-envelope/kinds/DirectorHistoryEntry.js";
import { createReviewHistoryEntryMigrationModule } from "../migrations/v2-envelope/kinds/ReviewHistoryEntry.js";
import { createThreadHistoryEntryMigrationModule } from "../migrations/v2-envelope/kinds/ThreadHistoryEntry.js";
import { createRepoEventBridgeCursorMigrationModule } from "../migrations/v2-envelope/kinds/RepoEventBridgeCursor.js";
import { createRepoEventBridgeDedupeMigrationModule } from "../migrations/v2-envelope/kinds/RepoEventBridgeDedupe.js";

const TEST_SETUP_TIMEOUT = 90_000;
const TEST_OP_TIMEOUT = 60_000;

const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
const MIGRATION_FILES = [
  "001-entities-table.sql",
  "002-notify-trigger.sql",
  "003-jsonb-size-check.sql",
];

/**
 * The EXACT 28-entry / 20-kind inventory (Design §2.6, thread-657 A3
 * ground-truth). Entry-by-entry pin: a drift in EITHER all-schemas.ts OR
 * this table fails the test — never a bare count.
 */
const EXPECTED_RENAME_INVENTORY: Record<string, RenameMap> = {
  Agent: { status: "status.phase", firstSeenAt: "metadata.createdAt", lastSeenAt: "metadata.updatedAt" },
  Audit: { timestamp: "metadata.createdAt" },
  Bug: { status: "status.phase" },
  Idea: { status: "status.phase", missionId: "status.missionId" },
  Message: { kind: "metadata.messageKind", status: "status.phase" },
  Mission: { status: "status.phase" },
  PendingAction: { state: "status.phase", enqueuedAt: "metadata.createdAt" },
  Proposal: { status: "status.phase" },
  Task: { status: "status.phase" },
  Tele: { status: "status.phase", name: "metadata.name" },
  Thread: { status: "status.phase" },
  Turn: { status: "status.phase", title: "metadata.name" },
  SchemaDef: { kind: "metadata.name" },
  Notification: { event: "spec.eventType", timestamp: "metadata.createdAt" },
  ArchitectDecision: { timestamp: "metadata.createdAt" },
  DirectorHistoryEntry: { timestamp: "metadata.createdAt" },
  ReviewHistoryEntry: { timestamp: "metadata.createdAt" },
  ThreadHistoryEntry: { timestamp: "metadata.createdAt" },
  RepoEventBridgeCursor: { body: "status.cursor" },
  RepoEventBridgeDedupe: { body: "status.dedupe" },
};

/** Runtime kinds that deliberately carry NO renameMap (Design §2.6). */
const EXPECTED_RENAME_FREE_KINDS = ["Counter", "Document", "MigrationCursor"];

function findSchema(kind: string): SchemaDef {
  const def = ALL_SCHEMAS.find((s) => s.kind === kind);
  if (!def) throw new Error(`ALL_SCHEMAS missing kind=${kind}`);
  return def;
}

describe("W1.1 renameMap inventory — per-kind-EXACT (28 entries / 20 kinds)", () => {
  it("ALL_SCHEMAS carries exactly the expected renameMap per kind (no missing / no extra / no drift)", () => {
    for (const [kind, expected] of Object.entries(EXPECTED_RENAME_INVENTORY)) {
      expect(findSchema(kind).renameMap, `kind=${kind}`).toEqual(expected);
    }
  });

  it("rename-free kinds carry NO renameMap (Counter / Document / MigrationCursor)", () => {
    for (const kind of EXPECTED_RENAME_FREE_KINDS) {
      expect(findSchema(kind).renameMap, `kind=${kind}`).toBeUndefined();
    }
  });

  it("no UNEXPECTED kind carries a renameMap (inventory is closed)", () => {
    const expectedKinds = new Set(Object.keys(EXPECTED_RENAME_INVENTORY));
    for (const def of ALL_SCHEMAS) {
      if (def.renameMap !== undefined) {
        expect(expectedKinds.has(def.kind), `unexpected renameMap on kind=${def.kind}`).toBe(true);
      }
    }
    // 23 runtime consts total; exactly 20 carry renameMap.
    expect(ALL_SCHEMAS.filter((s) => s.renameMap !== undefined)).toHaveLength(20);
    expect(ALL_SCHEMAS).toHaveLength(23);
  });

  it("runtime entries are in PARITY with the migration modules (source-of-truth, §2.7)", () => {
    const modules = [
      createAgentMigrationModule(findSchema("Agent")),
      createAuditMigrationModule(findSchema("Audit")),
      createBugMigrationModule(findSchema("Bug")),
      createIdeaMigrationModule(findSchema("Idea")),
      createMessageMigrationModule(findSchema("Message")),
      createMissionMigrationModule(findSchema("Mission")),
      createPendingActionMigrationModule(findSchema("PendingAction")),
      createProposalMigrationModule(findSchema("Proposal")),
      createTaskMigrationModule(findSchema("Task")),
      createTeleMigrationModule(findSchema("Tele")),
      createThreadMigrationModule(findSchema("Thread")),
      createTurnMigrationModule(findSchema("Turn")),
      createSchemaDefMigrationModule(findSchema("SchemaDef")),
      createNotificationMigrationModule(findSchema("Notification")),
      createArchitectDecisionMigrationModule(findSchema("ArchitectDecision")),
      createDirectorHistoryEntryMigrationModule(findSchema("DirectorHistoryEntry")),
      createReviewHistoryEntryMigrationModule(findSchema("ReviewHistoryEntry")),
      createThreadHistoryEntryMigrationModule(findSchema("ThreadHistoryEntry")),
      createRepoEventBridgeCursorMigrationModule(findSchema("RepoEventBridgeCursor")),
      createRepoEventBridgeDedupeMigrationModule(findSchema("RepoEventBridgeDedupe")),
    ];
    for (const mod of modules) {
      const runtime = findSchema(mod.kind).renameMap ?? {};
      const migration = mod.schemaRef.renameMap ?? {};
      expect(runtime, `parity drift for kind=${mod.kind}`).toEqual(migration);
    }
  });
});

describe("W1.2-W1.5 reconciler contract (testcontainers postgres)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let connStr: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub")
      .withPassword("hub")
      .withDatabase("hub")
      .start();
    connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = new Pool({ connectionString: connStr });
    for (const f of MIGRATION_FILES) {
      await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    }
  }, TEST_SETUP_TIMEOUT);

  afterAll(async () => {
    if (pool) await pool.end();
    if (container) await container.stop();
  }, TEST_OP_TIMEOUT);

  it(
    "W1.2 getFieldTranslation: FSM / collision / opaque / non-renamed / unknown-kind",
    async () => {
      const substrate = createPostgresStorageSubstrate(connStr);
      const reconciler = createSchemaReconciler(substrate, connStr, { initialSchemas: ALL_SCHEMAS });
      await reconciler.start();
      try {
        // Renamed FSM key
        expect(reconciler.getFieldTranslation("Bug", "status")).toBe("status.phase");
        // Field-collision key (cluster-4 canonical)
        expect(reconciler.getFieldTranslation("Message", "kind")).toBe("metadata.messageKind");
        // Opaque-state key
        expect(reconciler.getFieldTranslation("RepoEventBridgeCursor", "body")).toBe("status.cursor");
        // Non-FSM mutable-link (the A7 matrix non-status case)
        expect(reconciler.getFieldTranslation("Idea", "missionId")).toBe("status.missionId");
        // Non-renamed key → null (caller passes bare key through)
        expect(reconciler.getFieldTranslation("Bug", "sourceThreadId")).toBeNull();
        // Unknown kind → null
        expect(reconciler.getFieldTranslation("NoSuchKind", "status")).toBeNull();
      } finally {
        await reconciler.close();
        await substrate.close();
      }
    },
    TEST_OP_TIMEOUT,
  );

  it(
    "W1.3 malformed renameMap → start() FAILS (STRICT propagation, not swallowed)",
    async () => {
      const substrate = createPostgresStorageSubstrate(connStr);
      const bad: SchemaDef = {
        kind: "W1Malformed",
        version: 1,
        fields: [],
        indexes: [],
        watchable: true,
        // Target not rooted at metadata/spec/status → buildFieldTranslationMap throws
        renameMap: { status: "phase" },
      };
      const reconciler = createSchemaReconciler(substrate, connStr, { initialSchemas: [bad] });
      try {
        await expect(reconciler.start()).rejects.toThrow(/invalid renameMap for kind=W1Malformed/);
      } finally {
        // The boot loop puts the row BEFORE applySchemaIndexes throws — clean
        // it up so later tests' SchemaDef row-set stays exact to ALL_SCHEMAS.
        await pool.query(`DELETE FROM entities WHERE kind = 'SchemaDef' AND id = 'W1Malformed'`);
        await reconciler.close();
        await substrate.close();
      }
    },
    TEST_OP_TIMEOUT,
  );

  it(
    "W1.4 3× restart-cycle: zero index-DDL churn (oid-stable), SchemaDef rows envelope-correct each boot",
    async () => {
      let firstCycleOids: Map<string, string> | null = null;

      for (let cycle = 1; cycle <= 3; cycle++) {
        const substrate = createPostgresStorageSubstrate(connStr);
        const reconciler = createSchemaReconciler(substrate, connStr, { initialSchemas: ALL_SCHEMAS });
        await reconciler.start();

        // Cache live this cycle
        expect(reconciler.getFieldTranslation("Task", "status")).toBe("status.phase");

        // SchemaDef rows envelope-correct (boot-put fix dispositive): every row
        // carries the envelope partitions + metadata.name == described kind.
        const knownIds = ALL_SCHEMAS.map((s) => s.kind);
        const rows = await pool.query<{ id: string; data: Record<string, unknown> }>(
          `SELECT id, data FROM entities WHERE kind = 'SchemaDef' AND id = ANY($1)`,
          [knownIds],
        );
        expect(rows.rows.length).toBe(ALL_SCHEMAS.length);
        for (const row of rows.rows) {
          expect(isEnvelopeShape(row.data), `cycle ${cycle}: row ${row.id} not envelope`).toBe(true);
          const md = row.data.metadata as Record<string, unknown>;
          expect(md.name, `cycle ${cycle}: row ${row.id} metadata.name`).toBe(row.id);
          const spec = row.data.spec as Record<string, unknown>;
          const declared = ALL_SCHEMAS.find((s) => s.kind === row.id)!;
          // renameMap rides in spec for the kinds that declare it
          if (declared.renameMap) {
            expect(spec.renameMap, `cycle ${cycle}: row ${row.id} spec.renameMap`).toEqual(declared.renameMap);
          }
        }

        // Index-oid stability: IF NOT EXISTS must no-op — same oid across cycles
        // means the index was never dropped/recreated (zero DDL churn).
        const idx = await pool.query<{ indexname: string; oid: string }>(
          `SELECT c.relname AS indexname, c.oid::text AS oid
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'i' AND n.nspname = 'public'`,
        );
        const oids = new Map(idx.rows.map((r) => [r.indexname, r.oid]));
        if (firstCycleOids === null) {
          firstCycleOids = oids;
        } else {
          for (const [name, oid] of firstCycleOids) {
            expect(oids.get(name), `index ${name} oid drift at cycle ${cycle} (churn!)`).toBe(oid);
          }
          expect(oids.size, `index count drift at cycle ${cycle}`).toBe(firstCycleOids.size);
        }

        await reconciler.close();
        await substrate.close();
      }
    },
    TEST_OP_TIMEOUT * 3,
  );

  it(
    "W1.5 watch-path decode: envelope-shaped runtime SchemaDef put reconciles the DESCRIBED kind",
    async () => {
      const substrate = createPostgresStorageSubstrate(connStr);
      const reconciler = createSchemaReconciler(substrate, connStr, { initialSchemas: ALL_SCHEMAS });
      await reconciler.start();
      try {
        // Simulate a future runtime version-bump arriving in ENVELOPE shape
        // (what the boot-put now writes): described kind W1WatchKind with a
        // new index + a renameMap. Without schemaDefFromRow, the reconciler
        // would read def.kind === "SchemaDef" and mis-reconcile.
        const envelopeRow = {
          id: "W1WatchKind",
          name: "W1WatchKind",
          kind: "SchemaDef",
          apiVersion: "core.ois/v1",
          metadata: { name: "W1WatchKind" },
          spec: {
            version: 1,
            fields: [],
            indexes: [{ name: "w1watchkind_status_phase_idx", fields: ["status.phase"] }],
            watchable: true,
            renameMap: { status: "status.phase" },
          },
          status: { phase: "applied", appliedVersion: 1 },
        };
        // The runtimeLoop's LISTEN client connects asynchronously after
        // start() returns — a put fired before LISTEN is active is lost (no
        // replay without sinceRevision). RE-PUT periodically (idempotent;
        // each put fires a fresh NOTIFY) until the loop catches one.
        const deadline = Date.now() + 45_000;
        let found = false;
        let lastPut = 0;
        while (Date.now() < deadline && !found) {
          if (Date.now() - lastPut > 2_000) {
            await substrate.put("SchemaDef", envelopeRow);
            lastPut = Date.now();
          }
          const r = await pool.query(
            `SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='w1watchkind_status_phase_idx'`,
          );
          found = (r.rowCount ?? 0) > 0;
          if (!found) await new Promise((res) => setTimeout(res, 250));
        }
        expect(found, "watch-path did not create the described kind's index").toBe(true);

        // Decode also populated the translation cache for the DESCRIBED kind.
        expect(reconciler.getFieldTranslation("W1WatchKind", "status")).toBe("status.phase");
      } finally {
        await reconciler.close();
        await substrate.close();
      }
    },
    TEST_OP_TIMEOUT,
  );
});
