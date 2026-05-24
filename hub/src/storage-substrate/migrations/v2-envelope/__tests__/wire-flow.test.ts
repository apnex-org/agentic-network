/**
 * mission-88 W0 — wire-flow end-to-end integration test.
 *
 * Per `feedback_substrate_extension_wire_flow_integration_test` discipline:
 * substrate-extension missions MUST include end-to-end wire-flow test before
 * mission-completion gate. For W0, wire-flow = full path through W0 primitives:
 *
 *   1. Reconciler seeds MigrationCursor SchemaDef (real substrate; real DDL)
 *   2. Per-kind migration module is registered with runner
 *   3. Runner iterates substrate rows + invokes module.migrateOne + writes back
 *   4. MigrationCursorRepository checkpoint advances per row
 *   5. Idempotent re-run skips already-migrated rows (cursor + isEnvelopeShape)
 *   6. Resume-from-checkpoint after partial run picks up where it left off
 *
 * Uses a synthetic test-kind (TestKindXyz) — does NOT migrate any real
 * production entities. W1+ exercises real per-kind modules.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MigrationRunner } from "../migration-runner.js";
import { MigrationCursorRepository } from "../../../../entities/migration-cursor-repository.js";
import { encodeEnvelope, isEnvelopeShape } from "../shared/envelope.js";
import { createSchemaReconciler } from "../../../schema-reconciler.js";
import { ALL_SCHEMAS } from "../../../schemas/all-schemas.js";
import type { KindMigrationModule, MigrationSchemaRef } from "../kinds/_contract.js";
import type { SchemaDef } from "../../../types.js";
import { createIdeaMigrationModule } from "../kinds/Idea.js";
import { createBugMigrationModule } from "../kinds/Bug.js";
import { createThreadMigrationModule } from "../kinds/Thread.js";
import { createMissionMigrationModule } from "../kinds/Mission.js";
import { createProposalMigrationModule } from "../kinds/Proposal.js";
import { setupSubstrate, teardownSubstrate, cleanKind, type SubstrateFixture } from "./harness/fixtures.js";

// Use an existing watchable kind (Idea) as the wire-flow synthetic target —
// avoids needing to register a new SchemaDef just for this test.
const TEST_KIND = "Idea";

function ideaSchemaRef(): MigrationSchemaRef {
  const ideaSchema = ALL_SCHEMAS.find(s => s.kind === TEST_KIND);
  if (!ideaSchema) throw new Error(`Test setup error: no SchemaDef for ${TEST_KIND}`);
  return {
    schema: ideaSchema,
    partition: {
      metadata: ["createdAt", "createdBy", "sourceThreadId"],
      spec: ["title", "description"],
      status: ["status", "missionId"],
    },
  };
}

function testIdeaMigrationModule(): KindMigrationModule {
  const schemaRef = ideaSchemaRef();
  return {
    kind: TEST_KIND,
    schemaRef,
    migrateOne(legacy: unknown): unknown {
      if (isEnvelopeShape(legacy)) return legacy;  // idempotency
      return encodeEnvelope(legacy, schemaRef);
    },
  };
}

let fixture: SubstrateFixture;

beforeAll(async () => {
  fixture = await setupSubstrate();
  // Reconciler seeds all SchemaDefs (real DDL run; index emission)
  const reconciler = createSchemaReconciler(fixture.substrate, fixture.connStr, {
    initialSchemas: ALL_SCHEMAS,
  });
  await reconciler.start();
}, 60_000);

afterAll(async () => {
  await teardownSubstrate(fixture);
}, 30_000);

beforeEach(async () => {
  await cleanKind(fixture.connStr, TEST_KIND);
  await cleanKind(fixture.connStr, "MigrationCursor");
});

describe("W0 wire-flow — runner + module + cursor + envelope", () => {
  it("migrates legacy-shape rows to envelope-shape end-to-end", async () => {
    // Seed legacy-shape rows
    const legacyRows = [
      { id: "idea-1", title: "First", description: "desc1", status: "open", createdAt: "2026-01-01T00:00:00Z" },
      { id: "idea-2", title: "Second", description: "desc2", status: "triaged", createdAt: "2026-01-02T00:00:00Z" },
      { id: "idea-3", title: "Third", description: "desc3", status: "incorporated", createdAt: "2026-01-03T00:00:00Z" },
    ];
    for (const row of legacyRows) {
      await fixture.substrate.put(TEST_KIND, row);
    }

    const runner = new MigrationRunner(fixture.substrate);
    runner.register(testIdeaMigrationModule());

    const result = await runner.runKind(TEST_KIND, { waveId: "W0-wireflow" });

    expect(result.kind).toBe(TEST_KIND);
    expect(result.rowsMigrated).toBe(3);
    expect(result.rowsErrored).toBe(0);
    expect(result.errors).toEqual([]);

    // Verify substrate now has envelope-shape rows
    const post = await fixture.substrate.list<unknown>(TEST_KIND, { limit: 10 });
    expect(post.items.length).toBe(3);
    for (const row of post.items) {
      expect(isEnvelopeShape(row)).toBe(true);
    }

    // Verify cursor advanced to highest id
    const cursorRepo = new MigrationCursorRepository(fixture.substrate);
    const checkpoint = await cursorRepo.getCheckpoint(TEST_KIND);
    expect(checkpoint?.lastMigratedId).toBe("idea-3");
    expect(checkpoint?.waveId).toBe("W0-wireflow");
  });

  it("idempotent re-run skips already-migrated rows", async () => {
    const legacyRows = [
      { id: "idea-1", title: "First", description: "d1", status: "open", createdAt: "2026-01-01T00:00:00Z" },
      { id: "idea-2", title: "Second", description: "d2", status: "triaged", createdAt: "2026-01-02T00:00:00Z" },
    ];
    for (const row of legacyRows) {
      await fixture.substrate.put(TEST_KIND, row);
    }

    const runner = new MigrationRunner(fixture.substrate);
    runner.register(testIdeaMigrationModule());

    const first = await runner.runKind(TEST_KIND);
    expect(first.rowsMigrated).toBe(2);

    // Reset cursor to force re-iteration (forensic-replay case); rows are
    // envelope-shape now, so module returns them unchanged → rowsSkipped
    const cursorRepo = new MigrationCursorRepository(fixture.substrate);
    await cursorRepo.resetCheckpoint(TEST_KIND);

    const second = await runner.runKind(TEST_KIND);
    expect(second.rowsSkipped).toBe(2);
    expect(second.rowsMigrated).toBe(0);
  });

  it("resume-from-checkpoint picks up where prior run stopped", async () => {
    // Seed 5 rows
    for (let i = 1; i <= 5; i++) {
      await fixture.substrate.put(TEST_KIND, {
        id: `idea-${i}`,
        title: `Idea ${i}`,
        description: `d${i}`,
        status: "open",
        createdAt: `2026-01-0${i}T00:00:00Z`,
      });
    }

    const runner = new MigrationRunner(fixture.substrate);
    runner.register(testIdeaMigrationModule());

    // First run: stop after 2 rows
    const first = await runner.runKind(TEST_KIND, { maxRows: 2 });
    expect(first.rowsMigrated).toBe(2);

    // Cursor reflects partial progress
    const cursorRepo = new MigrationCursorRepository(fixture.substrate);
    const cp1 = await cursorRepo.getCheckpoint(TEST_KIND);
    expect(cp1).not.toBeNull();
    expect(["idea-1", "idea-2"]).toContain(cp1!.lastMigratedId);

    // Second run: should resume + finish the remaining 3
    const second = await runner.runKind(TEST_KIND);
    expect(second.rowsMigrated + second.rowsSkipped).toBeGreaterThanOrEqual(3);
  });

  it("dry-run does NOT write envelope back to substrate", async () => {
    await fixture.substrate.put(TEST_KIND, {
      id: "idea-1", title: "First", description: "d1", status: "open", createdAt: "2026-01-01T00:00:00Z",
    });

    const runner = new MigrationRunner(fixture.substrate);
    runner.register(testIdeaMigrationModule());

    const result = await runner.runKind(TEST_KIND, { dryRun: true });
    expect(result.rowsMigrated).toBe(1);

    // Row in substrate must still be legacy-shape (dry-run = no write)
    const row = await fixture.substrate.get<unknown>(TEST_KIND, "idea-1");
    expect(isEnvelopeShape(row)).toBe(false);

    // Cursor must NOT have advanced (dry-run = no checkpoint update)
    const cursorRepo = new MigrationCursorRepository(fixture.substrate);
    expect(await cursorRepo.getCheckpoint(TEST_KIND)).toBeNull();
  });

  it("registered kinds list reports per-kind module registrations", () => {
    const runner = new MigrationRunner(fixture.substrate);
    runner.register(testIdeaMigrationModule());
    expect(runner.registeredKinds()).toEqual([TEST_KIND]);
  });

  it("duplicate registration throws", () => {
    const runner = new MigrationRunner(fixture.substrate);
    runner.register(testIdeaMigrationModule());
    expect(() => runner.register(testIdeaMigrationModule())).toThrow(/duplicate registration/);
  });
});

// ───────────────────────────────────────────────────────────────────────
// W1 cluster-1 batch-migration wire-flow (Q4 disposition)
// ───────────────────────────────────────────────────────────────────────

const CLUSTER_1_KINDS = ["Idea", "Bug", "Thread", "Mission", "Proposal"] as const;

function schemaFor(kind: string): SchemaDef {
  const s = ALL_SCHEMAS.find(x => x.kind === kind);
  if (!s) throw new Error(`No SchemaDef for ${kind}`);
  return s;
}

function seedRow(kind: typeof CLUSTER_1_KINDS[number], n: number): { id: string } & Record<string, unknown> {
  const idPrefix = kind === "Proposal" ? "prop" : kind.toLowerCase();
  const id = `${idPrefix}-${n}`;
  const common = {
    id,
    createdBy: { role: "engineer" as const, agentId: "agent-greg" },
    createdAt: `2026-05-2${n}T00:00:00Z`,
    updatedAt: `2026-05-2${n}T01:00:00Z`,
    sourceThreadId: `thread-${100 + n}`,
    sourceActionId: `action-${n}`,
  };
  switch (kind) {
    case "Idea":
      return { ...common, text: `Idea ${n}`, status: "open", missionId: null,
        sourceThreadSummary: `Summary ${n}`, tags: [`tag${n}`] };
    case "Bug":
      return { ...common, title: `Bug ${n}`, description: `desc ${n}`, status: "open",
        severity: "minor", class: null, tags: [`bugtag${n}`], sourceIdeaId: null,
        sourceThreadSummary: `Summary ${n}`, linkedTaskIds: [], linkedMissionId: null,
        fixCommits: [], fixRevision: null, surfacedBy: "prod-audit" };
    case "Thread":
      return { ...common, title: `Thread ${n}`, status: "active", routingMode: "unicast",
        context: null, idleExpiryMs: null, currentTurn: "engineer", currentTurnAgentId: null,
        roundCount: 1, maxRounds: 10, outstandingIntent: null, currentSemanticIntent: null,
        correlationId: null, convergenceActions: [], summary: "", participants: [],
        recipientAgentId: null, messages: [], labels: {}, lastMessageConverged: false };
    case "Mission":
      return { ...common, title: `Mission ${n}`, description: `desc ${n}`, documentRef: null,
        status: "proposed", tasks: [], ideas: [], correlationId: id, turnId: null,
        sourceThreadSummary: `Summary ${n}`, plannedTasks: [], missionClass: "spike",
        pulses: undefined };
    case "Proposal":
      return { ...common, title: `Proposal ${n}`, summary: `summary ${n}`,
        proposalRef: `proposals/${id}.md`, status: "submitted", decision: null,
        feedback: null, correlationId: null, executionPlan: null, scaffoldResult: null,
        labels: { class: "design" }, sourceThreadSummary: `Summary ${n}` };
  }
}

describe("W1 cluster-1 batch wire-flow — 5-kind migration + per-kind cursor isolation", () => {
  beforeEach(async () => {
    for (const k of CLUSTER_1_KINDS) await cleanKind(fixture.connStr, k);
    await cleanKind(fixture.connStr, "MigrationCursor");
  });

  it("migrates all 5 cluster-1 kinds end-to-end + cursors isolate per-kind", async () => {
    // Seed 2 legacy rows per kind across all 5 kinds (10 total)
    for (const kind of CLUSTER_1_KINDS) {
      for (const n of [1, 2]) {
        await fixture.substrate.put(kind, seedRow(kind, n));
      }
    }

    // Register all 5 cluster-1 modules
    const runner = new MigrationRunner(fixture.substrate);
    runner.register(createIdeaMigrationModule(schemaFor("Idea")));
    runner.register(createBugMigrationModule(schemaFor("Bug")));
    runner.register(createThreadMigrationModule(schemaFor("Thread")));
    runner.register(createMissionMigrationModule(schemaFor("Mission")));
    runner.register(createProposalMigrationModule(schemaFor("Proposal")));

    expect(runner.registeredKinds()).toEqual([...CLUSTER_1_KINDS].sort());

    // Run migration per kind; collect results
    const results = new Map<string, Awaited<ReturnType<MigrationRunner["runKind"]>>>();
    for (const kind of CLUSTER_1_KINDS) {
      results.set(kind, await runner.runKind(kind, { waveId: "W1" }));
    }

    // Per-kind acceptance: 2 rows migrated, 0 errors
    for (const kind of CLUSTER_1_KINDS) {
      const r = results.get(kind)!;
      expect(r.kind).toBe(kind);
      expect(r.rowsMigrated).toBe(2);
      expect(r.rowsErrored).toBe(0);
      expect(r.errors).toEqual([]);
    }

    // Verify all rows in substrate are envelope-shape
    for (const kind of CLUSTER_1_KINDS) {
      const post = await fixture.substrate.list<unknown>(kind, { limit: 10 });
      expect(post.items.length).toBe(2);
      for (const row of post.items) {
        expect(isEnvelopeShape(row)).toBe(true);
        expect((row as { kind: string }).kind).toBe(kind);
        expect((row as { apiVersion: string }).apiVersion).toBe("core.ois/v1");
      }
    }

    // Per-kind cursor isolation: each kind's checkpoint reflects only its rows
    const cursorRepo = new MigrationCursorRepository(fixture.substrate);
    for (const kind of CLUSTER_1_KINDS) {
      const cp = await cursorRepo.getCheckpoint(kind);
      expect(cp).not.toBeNull();
      expect(cp!.id).toBe(`cursor-${kind}`);
      expect(cp!.waveId).toBe("W1");
      // lastMigratedId matches the highest seeded ID for that kind
      const idPrefix = kind === "Proposal" ? "prop" : kind.toLowerCase();
      expect(cp!.lastMigratedId).toBe(`${idPrefix}-2`);
    }
  });

  it("idempotent re-run across cluster-1: all rows skip on second pass", async () => {
    for (const kind of CLUSTER_1_KINDS) {
      await fixture.substrate.put(kind, seedRow(kind, 1));
    }

    const runner = new MigrationRunner(fixture.substrate);
    runner.register(createIdeaMigrationModule(schemaFor("Idea")));
    runner.register(createBugMigrationModule(schemaFor("Bug")));
    runner.register(createThreadMigrationModule(schemaFor("Thread")));
    runner.register(createMissionMigrationModule(schemaFor("Mission")));
    runner.register(createProposalMigrationModule(schemaFor("Proposal")));

    // First pass: 5 rows migrated
    for (const kind of CLUSTER_1_KINDS) {
      const r = await runner.runKind(kind);
      expect(r.rowsMigrated).toBe(1);
    }

    // Reset cursors to force re-iteration (forensic-replay case)
    const cursorRepo = new MigrationCursorRepository(fixture.substrate);
    for (const kind of CLUSTER_1_KINDS) {
      await cursorRepo.resetCheckpoint(kind);
    }

    // Second pass: rows are envelope-shape → skipped per isEnvelopeShape
    for (const kind of CLUSTER_1_KINDS) {
      const r = await runner.runKind(kind);
      expect(r.rowsSkipped).toBe(1);
      expect(r.rowsMigrated).toBe(0);
    }
  });

  it("partition assertions per kind: id, name, kind, apiVersion preserved + FSM rename applied", async () => {
    for (const kind of CLUSTER_1_KINDS) {
      await fixture.substrate.put(kind, seedRow(kind, 1));
    }
    const runner = new MigrationRunner(fixture.substrate);
    runner.register(createIdeaMigrationModule(schemaFor("Idea")));
    runner.register(createBugMigrationModule(schemaFor("Bug")));
    runner.register(createThreadMigrationModule(schemaFor("Thread")));
    runner.register(createMissionMigrationModule(schemaFor("Mission")));
    runner.register(createProposalMigrationModule(schemaFor("Proposal")));
    for (const kind of CLUSTER_1_KINDS) await runner.runKind(kind);

    // Per-kind read-after-migrate; assert envelope structure + FSM rename
    for (const kind of CLUSTER_1_KINDS) {
      const idPrefix = kind === "Proposal" ? "prop" : kind.toLowerCase();
      const id = `${idPrefix}-1`;
      const row = await fixture.substrate.get<EnvelopeRow>(kind, id);
      expect(row).not.toBeNull();
      expect(row!.kind).toBe(kind);
      expect(row!.apiVersion).toBe("core.ois/v1");
      expect(row!.id).toBe(id);
      expect(row!.name).toBe(id);
      // FSM rename: status field is now nested as status.phase
      const phase = (row!.status as Record<string, unknown>).phase;
      // Per-kind expected phase from seed
      const expectedPhase = kind === "Proposal" ? "submitted" : kind === "Mission" ? "proposed" : kind === "Thread" ? "active" : "open";
      expect(phase).toBe(expectedPhase);
    }
  });
});

interface EnvelopeRow {
  id: string;
  name: string;
  kind: string;
  apiVersion: string;
  metadata: Record<string, unknown>;
  spec: Record<string, unknown>;
  status: Record<string, unknown>;
}
