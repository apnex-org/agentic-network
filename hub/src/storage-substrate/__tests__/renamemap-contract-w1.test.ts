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
import { createTestPool } from "./_pg-test-pool.js";
import { createPostgresStorageSubstrate, createSchemaReconciler, ALL_SCHEMAS } from "../index.js";
import type { SchemaDef, RenameMap } from "../types.js";
import { isEnvelopeShape } from "../migrations/v2-envelope/shared/envelope.js";
// C3-R4a: the substrate-filterable map + exclusions are now the shared reviewed
// source-of-truth in conformance/filterable-keys.ts (drift-gated against the live
// call-site scanner in filterable-keys-drift-gate.test.ts). W1.1c consumes them.
import { SUBSTRATE_FILTERABLE_KEYS, EXCLUDED_FILTERABLE_KEYS } from "../conformance/filterable-keys.js";

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
import { createDocumentMigrationModule } from "../migrations/v2-envelope/kinds/Document.js";
import { createWorkItemMigrationModule } from "../migrations/v2-envelope/kinds/WorkItem.js";
import { createDecisionMigrationModule } from "../migrations/v2-envelope/kinds/Decision.js";
import { createClassGrantMigrationModule } from "../migrations/v2-envelope/kinds/ClassGrant.js";
import type { KindMigrationModule } from "../migrations/v2-envelope/kinds/_contract.js";
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
  // mission-90 W2 finding-A expansion: renameMap is the COMPLETE read-side
  // bare→envelope movement authority for substrate-side FILTERABLE keys (renames
  // AND partition-relocations), per the call-site sweep. C3-R4b COLLAPSED the
  // cascade-keys (sourceThreadId/sourceActionId/sourceIdeaId) onto renameMap —
  // they are now INCLUDED (→ metadata.*), no longer the W1 dual-path null-pin.
  // Every entry below is validated against the encoder's ACTUAL placement by the
  // sentinel-probe (W1.1b).
  Agent: { status: "status.phase", firstSeenAt: "metadata.createdAt", lastSeenAt: "metadata.updatedAt", fingerprint: "metadata.fingerprint", thrashCount: "status.thrashCount", quarantined: "status.quarantined" },
  Audit: { timestamp: "metadata.createdAt", actor: "metadata.actor" },
  Bug: { status: "status.phase", severity: "spec.severity", class: "spec.class", repo: "spec.repo", sourceThreadId: "metadata.sourceThreadId", sourceActionId: "metadata.sourceActionId", sourceIdeaId: "metadata.sourceIdeaId" },
  Idea: { status: "status.phase", missionId: "status.missionId", sourceThreadId: "metadata.sourceThreadId", sourceActionId: "metadata.sourceActionId" },
  // C1-R2 (mission-94): the first kind with OBJECT/ARRAY renameMap entries
  // (lease/evidence objects, roleEligibility array). The W1.1b sentinel-probe is
  // placement-based (value-type-agnostic) so all entries validate here; only the
  // W6 equality-shadow step carves out the object/array entries (see that test).
  WorkItem: { status: "status.phase", lease: "status.lease", evidence: "status.evidence", blockedOn: "status.blockedOn", leaseExpiryCount: "status.leaseExpiryCount", enteredCurrentStateAt: "status.enteredCurrentStateAt", stateDurations: "status.stateDurations", priority: "spec.priority", type: "spec.type", roleEligibility: "spec.roleEligibility", completionDependsOn: "spec.completionDependsOn" },
  // mission-102 P3-B1: the Decision authority-resolution spine (no lease anywhere —
  // the entity has no liveness by design).
  Decision: { status: "status.phase", class: "spec.class", curatedBy: "status.curatedBy", curationRecordRef: "status.curationRecordRef", routedTo: "status.routedTo", routedBy: "status.routedBy", resolution: "status.resolution", mergedInto: "status.mergedInto", disposedReason: "status.disposedReason", enteredCurrentStateAt: "status.enteredCurrentStateAt", stateDurations: "status.stateDurations" },
  // mission-102 P3-B3: row-per-version delegation; state relocates to status.state
  // (NOT status.phase — grants have no FSM phase), class to spec.class.
  ClassGrant: { state: "status.state", class: "spec.class", supersededBy: "status.supersededBy" },
  Message: {
    kind: "metadata.messageKind",
    status: "status.phase",
    threadId: "metadata.threadId",
    migrationSourceId: "metadata.migrationSourceId",
    authorAgentId: "metadata.authorAgentId",
    delivery: "spec.delivery",
    scheduledState: "status.scheduledState",
    "target.role": "spec.target.role",
    "target.agentId": "spec.target.agentId",
  },
  Mission: { status: "status.phase", sourceThreadId: "metadata.sourceThreadId", sourceActionId: "metadata.sourceActionId" },
  PendingAction: {
    state: "status.phase",
    enqueuedAt: "metadata.createdAt",
    naturalKey: "metadata.naturalKey",
    targetAgentId: "spec.targetAgentId",
    dispatchType: "spec.dispatchType",
    entityRef: "spec.entityRef",
  },
  Proposal: { status: "status.phase", sourceThreadId: "metadata.sourceThreadId", sourceActionId: "metadata.sourceActionId" },
  Task: { status: "status.phase", idempotencyKey: "metadata.idempotencyKey", createdAt: "metadata.createdAt", createdBy: "metadata.createdBy", updatedAt: "metadata.updatedAt", sourceThreadId: "metadata.sourceThreadId", sourceActionId: "metadata.sourceActionId" },
  Tele: { status: "status.phase", name: "metadata.name" },
  Thread: { status: "status.phase", cascadePending: "status.cascadePending", currentTurnAgentId: "status.currentTurnAgentId", recipientAgentId: "spec.recipientAgentId" },
  Turn: { status: "status.phase", title: "metadata.name" },
  SchemaDef: { kind: "metadata.name" },
  Notification: { event: "spec.eventType", timestamp: "metadata.createdAt" },
  ArchitectDecision: { timestamp: "metadata.createdAt" },
  DirectorHistoryEntry: { timestamp: "metadata.createdAt" },
  ReviewHistoryEntry: { timestamp: "metadata.createdAt", taskId: "metadata.taskId" },
  ThreadHistoryEntry: { timestamp: "metadata.createdAt", threadId: "metadata.threadId" },
  RepoEventBridgeCursor: { body: "status.cursor" },
  RepoEventBridgeDedupe: { body: "status.dedupe" },
  Document: { category: "metadata.labels.category" },
};

/** Runtime kinds that deliberately carry NO renameMap (Design §2.6). Document
 * LEFT this set at W2 (category→metadata.labels.category added). */
const EXPECTED_RENAME_FREE_KINDS = ["Counter", "MigrationCursor"];

function findSchema(kind: string): SchemaDef {
  const def = ALL_SCHEMAS.find((s) => s.kind === kind);
  if (!def) throw new Error(`ALL_SCHEMAS missing kind=${kind}`);
  return def;
}

// ─── mission-90 W2: per-kind migration-module factories (encoder placement
//     authority for the sentinel-probe + classification oracle) ───────────────
const MODULE_FACTORIES: Record<string, (s: SchemaDef) => KindMigrationModule> = {
  Agent: createAgentMigrationModule,
  Audit: createAuditMigrationModule,
  Bug: createBugMigrationModule,
  Idea: createIdeaMigrationModule,
  Message: createMessageMigrationModule,
  Mission: createMissionMigrationModule,
  PendingAction: createPendingActionMigrationModule,
  Proposal: createProposalMigrationModule,
  Task: createTaskMigrationModule,
  Tele: createTeleMigrationModule,
  Thread: createThreadMigrationModule,
  Turn: createTurnMigrationModule,
  SchemaDef: createSchemaDefMigrationModule,
  Notification: createNotificationMigrationModule,
  ArchitectDecision: createArchitectDecisionMigrationModule,
  DirectorHistoryEntry: createDirectorHistoryEntryMigrationModule,
  ReviewHistoryEntry: createReviewHistoryEntryMigrationModule,
  ThreadHistoryEntry: createThreadHistoryEntryMigrationModule,
  RepoEventBridgeCursor: createRepoEventBridgeCursorMigrationModule,
  RepoEventBridgeDedupe: createRepoEventBridgeDedupeMigrationModule,
  Document: createDocumentMigrationModule,
  WorkItem: createWorkItemMigrationModule,  // C1-R2 mission-94
  Decision: createDecisionMigrationModule,  // mission-102 P3-B1
  ClassGrant: createClassGrantMigrationModule,  // mission-102 P3-B3
};

function moduleFor(kind: string): KindMigrationModule {
  const factory = MODULE_FACTORIES[kind];
  if (!factory) throw new Error(`no migration-module factory for kind=${kind}`);
  return factory(findSchema(kind));
}

const PROBE_SENTINEL = "__W2_PROBE_SENTINEL__";

/**
 * Per-kind/per-key probe-value overrides for fields whose preTransform VALIDATES
 * or COERCES the value (so the generic sentinel would be rewritten and the probe
 * couldn't locate it). The override supplies a value that survives preTransform;
 * the placement PATH is what's asserted, not the value. Notification.event is
 * enum-coerced ("unknown" fallback for un-cataloged values) → use a known event.
 */
const PROBE_VALUE_OVERRIDES: Record<string, Record<string, string>> = {
  Notification: { event: "thread_message" },
};

/** Place `val` at a (possibly dotted) key in a fresh legacy entity. */
function setNested(obj: Record<string, unknown>, dottedKey: string, val: unknown): void {
  const parts = dottedKey.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i]!;
    if (typeof cur[seg] !== "object" || cur[seg] === null) cur[seg] = {};
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = val;
}

/** Deep-walk a bucket sub-tree for `needle`; return its dotted path (bucket-rooted). */
function walkFor(node: unknown, prefix: string, needle: string): string | null {
  if (node === needle) return prefix;
  if (node && typeof node === "object" && !Array.isArray(node)) {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const found = walkFor(v, `${prefix}.${k}`, needle);
      if (found) return found;
    }
  }
  return null;
}

/**
 * mission-90 W2 (architect-blessed): probe the encoder's ACTUAL placement of a
 * bare filter key by feeding a sentinel-valued legacy entity through the kind's
 * migrateOne (= preTransform + encodeEnvelope, the real write path) and locating
 * the sentinel within metadata/spec/status. Returns the envelope JSONB dotted
 * path, or null if the key is unmoved / shape-transformed (needle not scalar-
 * findable in any bucket). Buckets-only search ignores envelope-reserved
 * top-level fields (id/name/kind/apiVersion) that some renames also populate.
 */
function probePlacement(kind: string, filterKey: string): string | null {
  const needle = PROBE_VALUE_OVERRIDES[kind]?.[filterKey] ?? PROBE_SENTINEL;
  const legacy: Record<string, unknown> = { id: "w2probe" };
  setNested(legacy, filterKey, needle);
  const env = moduleFor(kind).migrateOne(legacy) as Record<string, unknown>;
  for (const bucket of ["metadata", "spec", "status"]) {
    const found = walkFor(env[bucket], bucket, needle);
    if (found) return found;
  }
  return null;
}

// SUBSTRATE_FILTERABLE_KEYS + EXCLUDED_FILTERABLE_KEYS moved to
// conformance/filterable-keys.ts (imported above) — C3-R4a made them the shared
// reviewed artifact drift-gated against the live call-site scanner.

describe("W1.1 renameMap inventory + faithfulness — complete field-movement authority (W2 finding-A)", () => {
  it("ALL_SCHEMAS carries exactly the expected renameMap per kind (no missing / no extra / no drift)", () => {
    for (const [kind, expected] of Object.entries(EXPECTED_RENAME_INVENTORY)) {
      expect(findSchema(kind).renameMap, `kind=${kind}`).toEqual(expected);
    }
  });

  it("rename-free kinds carry NO renameMap (Counter / MigrationCursor)", () => {
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
    // 27 runtime consts total; exactly 23 carry renameMap (mission-102 P3-B1 added
    // Decision with one; P3-B4 added DirectorSignal + DirectorConfirmation WITHOUT —
    // no `status` field, get-by-id only).
    expect(ALL_SCHEMAS.filter((s) => s.renameMap !== undefined)).toHaveLength(24);
    expect(ALL_SCHEMAS).toHaveLength(32);
  });

  it("W1.1b every renameMap entry resolves to the encoder's ACTUAL placement (sentinel-probe vs migrateOne)", () => {
    // The architect-blessed faithfulness oracle: assert ACTUAL placement (not a
    // model of it). A wrong/typo'd target fails here with the real path. Covers
    // renames, relocations, collisions (kind→metadata.messageKind), nested
    // (target.role→spec.target.role), and scalar→map-entry (category).
    for (const [kind, map] of Object.entries(EXPECTED_RENAME_INVENTORY)) {
      for (const [key, target] of Object.entries(map)) {
        expect(probePlacement(kind, key), `${kind}.${key} → encoder places it at`).toBe(target);
      }
    }
  });

  it("W1.1c completeness: every substrate-FILTERABLE key is renameMap-covered OR documented-excluded OR unmoved (self-policing @ W3+)", () => {
    const unclassified: string[] = [];
    for (const [kind, keys] of Object.entries(SUBSTRATE_FILTERABLE_KEYS)) {
      const covered = findSchema(kind).renameMap ?? {};
      const excluded = EXCLUDED_FILTERABLE_KEYS[kind] ?? {};
      for (const key of keys) {
        const isCovered = key in covered;
        const isExcluded = key in excluded;
        const isUnmoved = probePlacement(kind, key) === null; // stays top-level (e.g. id) → bare path works
        if (!isCovered && !isExcluded && !isUnmoved) {
          unclassified.push(`${kind}.${key}`);
        }
      }
    }
    expect(
      unclassified,
      `substrate-filterable keys that are MOVED but neither renameMap-covered nor documented-excluded (envelope-blind risk — cover in renameMap or document): ${unclassified.join(", ")}`,
    ).toEqual([]);
  });

  it("W1.1d cascade-keys are now renameMap-COVERED at metadata.* (C3-R4b dual-path collapse)", () => {
    // C3-R4b collapsed the former cascade-dual-path: the cascade keys now carry
    // renameMap entries (→ metadata.*) and the repos filter by the FLAT key, so
    // renameMap is their single field-path authority. Assert each is covered AND
    // the encoder actually places it where renameMap says (faithfulness) — the
    // positive successor to the old "deliberately untranslated" dual-path contract.
    const CASCADE_KEYS: Record<string, string[]> = {
      Bug: ["sourceThreadId", "sourceActionId", "sourceIdeaId"],
      Idea: ["sourceThreadId", "sourceActionId"],
      Mission: ["sourceThreadId", "sourceActionId"],
      Proposal: ["sourceThreadId", "sourceActionId"],
      Task: ["sourceThreadId", "sourceActionId"],
    };
    for (const [kind, keys] of Object.entries(CASCADE_KEYS)) {
      for (const key of keys) {
        const target = `metadata.${key}`;
        expect(findSchema(kind).renameMap?.[key], `${kind}.${key} must be renameMap-covered (R4b)`).toBe(target);
        expect(probePlacement(kind, key), `${kind}.${key} encoder placement`).toBe(target);
      }
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
    pool = createTestPool(connStr, "renamemap-contract-w1");
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
        // C3-R4b: cascade key now renamed → metadata.* (was the dual-path null-pin)
        expect(reconciler.getFieldTranslation("Bug", "sourceThreadId")).toBe("metadata.sourceThreadId");
        // Non-renamed key → null (caller passes bare key through)
        expect(reconciler.getFieldTranslation("Bug", "nonRenamedField")).toBeNull();
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
    "W1.3b empty-segment / trailing-dot renameMap target → start() FAILS (regex rejects empty JSONB path segments)",
    async () => {
      // The dotted-path separator '.' must NOT be admitted as a segment char —
      // 'status..phase' and 'metadata.createdAt.' are well-rooted but split into
      // empty JSONB path components downstream. STRICT boot must reject them.
      for (const badTarget of ["status..phase", "metadata.createdAt.", "spec."]) {
        const substrate = createPostgresStorageSubstrate(connStr);
        const bad: SchemaDef = {
          kind: "W1EmptySeg",
          version: 1,
          fields: [],
          indexes: [],
          watchable: true,
          renameMap: { status: badTarget },
        };
        const reconciler = createSchemaReconciler(substrate, connStr, { initialSchemas: [bad] });
        try {
          await expect(reconciler.start(), `target='${badTarget}'`).rejects.toThrow(
            /invalid renameMap for kind=W1EmptySeg/,
          );
        } finally {
          await pool.query(`DELETE FROM entities WHERE kind = 'SchemaDef' AND id = 'W1EmptySeg'`);
          await reconciler.close();
          await substrate.close();
        }
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
        // mission-90 W2 (architect regression-guard): the 3 NET-NEW hot-path
        // indexes (bug-149 W6-gate) are created on first boot AND, via the
        // oid-stability + count checks below, proven to no-op (zero churn) on
        // restarts — same discipline as W1's existing indexes.
        for (const newIdx of [
          "message_spec_delivery_idx",
          "message_status_scheduledstate_idx",
          "thread_status_cascadepending_idx",
        ]) {
          expect(oids.has(newIdx), `cycle ${cycle}: W2 net-new index ${newIdx} not created`).toBe(true);
        }
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
