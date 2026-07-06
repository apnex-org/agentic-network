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
import { createPendingActionMigrationModule } from "../kinds/PendingAction.js";
import { createAgentMigrationModule } from "../kinds/Agent.js";
import { createSchemaDefMigrationModule } from "../kinds/SchemaDef.js";
import { createCounterMigrationModule } from "../kinds/Counter.js";
import { createMessageMigrationModule } from "../kinds/Message.js";
import { createAuditMigrationModule } from "../kinds/Audit.js";
import { createRepoEventBridgeCursorMigrationModule } from "../kinds/RepoEventBridgeCursor.js";
import { createRepoEventBridgeDedupeMigrationModule } from "../kinds/RepoEventBridgeDedupe.js";
import { createDocumentMigrationModule } from "../kinds/Document.js";
import { createArchitectDecisionMigrationModule } from "../kinds/ArchitectDecision.js";
import { createDirectorHistoryEntryMigrationModule } from "../kinds/DirectorHistoryEntry.js";
import { createReviewHistoryEntryMigrationModule } from "../kinds/ReviewHistoryEntry.js";
import { createThreadHistoryEntryMigrationModule } from "../kinds/ThreadHistoryEntry.js";
import { isMigrationInProgress } from "../shared/migration-flag.js";
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
      // work-162 (A1): turnId + plannedTasks removed from the Mission schema.
      return { ...common, title: `Mission ${n}`, description: `desc ${n}`, documentRef: null,
        status: "proposed", tasks: [], ideas: [], correlationId: id,
        sourceThreadSummary: `Summary ${n}`, missionClass: "spike",
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

// ───────────────────────────────────────────────────────────────────────
// W2 cluster-2 batch-migration wire-flow (Q6 disposition; per thread-644 R2)
// ───────────────────────────────────────────────────────────────────────

// work-162 (A1): Task + Turn retired — PendingAction is the sole surviving
// cluster-2 kind. The 3-kind batch collapses to a single-kind wire-flow +
// cursor-isolation smoke (still exercises the runner/cursor/flag integration).
const CLUSTER_2_KINDS = ["PendingAction"] as const;

function seedCluster2Row(kind: typeof CLUSTER_2_KINDS[number], n: number): { id: string } & Record<string, unknown> {
  const id = `pa-2026-05-24T03-00-00-000Z-${n}`;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void kind;
  return {
    id, targetAgentId: `agent-${n}`, dispatchType: "thread_message",
    entityRef: `thread-${100 + n}`,
    naturalKey: `agent-${n}:thread-${100 + n}:thread_message`,
    payload: { messageId: `msg-${n}` },
    enqueuedAt: `2026-05-2${n}T00:00:00Z`,
    receiptDeadline: `2026-05-2${n}T00:00:30Z`,
    completionDeadline: `2026-05-2${n}T00:05:00Z`,
    receiptAckedAt: null, completionAckedAt: null,
    attemptCount: 0, lastAttemptAt: null,
    state: "enqueued", escalationReason: null,
    createdBy: { role: "architect", agentId: "agent-arch" },
  };
}

function registerCluster2(runner: MigrationRunner): void {
  runner.register(createPendingActionMigrationModule(ALL_SCHEMAS.find(s => s.kind === "PendingAction")!));
}

describe("W2 cluster-2 batch wire-flow — PendingAction migration + per-kind cursor isolation", () => {
  beforeEach(async () => {
    for (const k of CLUSTER_2_KINDS) await cleanKind(fixture.connStr, k);
    await cleanKind(fixture.connStr, "MigrationCursor");
  });

  it("migrates all 3 cluster-2 kinds end-to-end + cursors isolate per-kind", async () => {
    for (const kind of CLUSTER_2_KINDS) {
      for (const n of [1, 2]) {
        await fixture.substrate.put(kind, seedCluster2Row(kind, n));
      }
    }

    const runner = new MigrationRunner(fixture.substrate);
    registerCluster2(runner);

    expect(runner.registeredKinds()).toEqual([...CLUSTER_2_KINDS].sort());

    const results = new Map<string, Awaited<ReturnType<MigrationRunner["runKind"]>>>();
    for (const kind of CLUSTER_2_KINDS) {
      results.set(kind, await runner.runKind(kind, { waveId: "W2" }));
    }

    for (const kind of CLUSTER_2_KINDS) {
      const r = results.get(kind)!;
      expect(r.kind).toBe(kind);
      expect(r.rowsMigrated).toBe(2);
      expect(r.rowsErrored).toBe(0);
      expect(r.errors).toEqual([]);
    }

    for (const kind of CLUSTER_2_KINDS) {
      const post = await fixture.substrate.list<unknown>(kind, { limit: 10 });
      expect(post.items.length).toBe(2);
      for (const row of post.items) {
        expect(isEnvelopeShape(row)).toBe(true);
        expect((row as { kind: string }).kind).toBe(kind);
        expect((row as { apiVersion: string }).apiVersion).toBe("core.ois/v1");
      }
    }

    const cursorRepo = new MigrationCursorRepository(fixture.substrate);
    for (const kind of CLUSTER_2_KINDS) {
      const cp = await cursorRepo.getCheckpoint(kind);
      expect(cp).not.toBeNull();
      expect(cp!.id).toBe(`cursor-${kind}`);
      expect(cp!.waveId).toBe("W2");
    }
  });

  it("idempotent re-run across cluster-2: all rows skip on second pass", async () => {
    for (const kind of CLUSTER_2_KINDS) {
      await fixture.substrate.put(kind, seedCluster2Row(kind, 1));
    }

    const runner = new MigrationRunner(fixture.substrate);
    registerCluster2(runner);

    for (const kind of CLUSTER_2_KINDS) {
      const r = await runner.runKind(kind);
      expect(r.rowsMigrated).toBe(1);
    }

    const cursorRepo = new MigrationCursorRepository(fixture.substrate);
    for (const kind of CLUSTER_2_KINDS) {
      await cursorRepo.resetCheckpoint(kind);
    }

    for (const kind of CLUSTER_2_KINDS) {
      const r = await runner.runKind(kind);
      expect(r.rowsSkipped).toBe(1);
      expect(r.rowsMigrated).toBe(0);
    }
  });

  it("cluster-2 envelope-shape: PendingAction queue-state classification", async () => {
    for (const kind of CLUSTER_2_KINDS) {
      await fixture.substrate.put(kind, seedCluster2Row(kind, 1));
    }
    const runner = new MigrationRunner(fixture.substrate);
    registerCluster2(runner);
    for (const kind of CLUSTER_2_KINDS) await runner.runKind(kind);

    // PendingAction: queue-state; enqueuedAt → metadata.createdAt rename verified
    const pa = await fixture.substrate.get<EnvelopeRow>("PendingAction", "pa-2026-05-24T03-00-00-000Z-1");
    expect(pa!.status.phase).toBe("enqueued");
    expect(pa!.spec.targetAgentId).toBe("agent-1");
    expect(pa!.metadata.createdAt).toBe("2026-05-21T00:00:00Z");  // from legacy enqueuedAt
    expect((pa! as unknown as Record<string, unknown>).enqueuedAt).toBeUndefined();
    expect(pa!.metadata.naturalKey).toBe("agent-1:thread-101:thread_message");
  });

  it("Q4(a)+(c) in-flight migration flag: runner sets/clears at runKind boundary", async () => {
    await fixture.substrate.put("PendingAction", seedCluster2Row("PendingAction", 1));
    const runner = new MigrationRunner(fixture.substrate);
    registerCluster2(runner);

    expect(isMigrationInProgress("PendingAction")).toBe(false);
    await runner.runKind("PendingAction");
    // Flag cleared on completion (finally block per runner.ts integration)
    expect(isMigrationInProgress("PendingAction")).toBe(false);
  });

  it("Q4(a)+(c) in-flight migration flag: runner clears flag even when per-row migrateOne throws", async () => {
    // Seed a valid row + register a module whose migrateOne throws
    await fixture.substrate.put("PendingAction", seedCluster2Row("PendingAction", 1));
    const throwingRunner = new MigrationRunner(fixture.substrate);
    throwingRunner.register({
      kind: "PendingAction",
      schemaRef: { schema: ALL_SCHEMAS.find(s => s.kind === "PendingAction")! },
      migrateOne(): never { throw new Error("test-induced module failure"); },
    });

    expect(isMigrationInProgress("PendingAction")).toBe(false);
    const r = await throwingRunner.runKind("PendingAction");
    // Inner try/catch absorbs the throw into result.errors
    expect(r.rowsErrored).toBe(1);
    expect(r.errors[0].message).toMatch(/test-induced module failure/);
    // Critical: finally block clears the flag even when rows error
    expect(isMigrationInProgress("PendingAction")).toBe(false);
  });

  it("Q4(a)+(c) in-flight migration flag: runner clears flag on empty-result run (no rows)", async () => {
    // No rows seeded; runner iterates nothing but still passes through try/finally
    const runner = new MigrationRunner(fixture.substrate);
    registerCluster2(runner);

    expect(isMigrationInProgress("PendingAction")).toBe(false);
    const r = await runner.runKind("PendingAction");
    expect(r.rowsMigrated).toBe(0);
    expect(r.rowsErrored).toBe(0);
    // Critical: flag cleared even when no rows were processed
    expect(isMigrationInProgress("PendingAction")).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────
// W3 cluster-3 batch-migration wire-flow (Q7 disposition; per thread-645 R2)
// ───────────────────────────────────────────────────────────────────────

const CLUSTER_3_KINDS = ["Agent", "SchemaDef", "Counter"] as const;

function seedCluster3Row(kind: typeof CLUSTER_3_KINDS[number], n: number): { id: string } & Record<string, unknown> {
  switch (kind) {
    case "Agent":
      return {
        id: `agent-${n.toString().padStart(8, "0")}`,
        fingerprint: "f".repeat(64),
        role: "engineer", status: "online", archived: false,
        sessionEpoch: 1, currentSessionId: null,
        clientMetadata: {}, advisoryTags: {}, labels: {},
        firstSeenAt: `2026-05-2${n}T00:00:00Z`,
        lastSeenAt: `2026-05-2${n}T00:00:00Z`,
        livenessState: "online", lastHeartbeatAt: `2026-05-2${n}T00:00:00Z`,
        receiptSla: 30000, wakeEndpoint: null,
        name: `agent-name-${n}`, activityState: "online_idle",
        sessionStartedAt: null, lastToolCallAt: null, lastToolCallName: null,
        idleSince: null, workingSince: null, quotaBlockedUntil: null,
        cognitiveTTL: 300, transportTTL: 60,
        cognitiveState: "alive", transportState: "alive",
        adapterVersion: "test", ipAddress: null,
        restartCount: 0, recentErrors: [], restartHistoryMs: [],
      };
    case "SchemaDef":
      return {
        id: `TestKind${n}`,
        kind: `TestKind${n}`,
        version: 1,
        fields: [],
        indexes: [],
        watchable: true,
      };
    case "Counter":
      return {
        id: "counter",  // single-row constraint
        [`testCounter${n}`]: n * 10,
      };
  }
}

function registerCluster3(runner: MigrationRunner): void {
  runner.register(createAgentMigrationModule(ALL_SCHEMAS.find(s => s.kind === "Agent")!));
  runner.register(createSchemaDefMigrationModule(ALL_SCHEMAS.find(s => s.kind === "SchemaDef")!));
  runner.register(createCounterMigrationModule(ALL_SCHEMAS.find(s => s.kind === "Counter")!));
}

describe("W3 cluster-3 batch wire-flow — 3-kind migration + Counter structural transform", () => {
  beforeEach(async () => {
    for (const k of CLUSTER_3_KINDS) await cleanKind(fixture.connStr, k);
    await cleanKind(fixture.connStr, "MigrationCursor");
  });

  it("migrates all 3 cluster-3 kinds end-to-end + cursors isolate per-kind", async () => {
    // Counter is single-row; seed once. Others 2 rows each.
    for (const n of [1, 2]) {
      await fixture.substrate.put("Agent", seedCluster3Row("Agent", n));
      await fixture.substrate.put("SchemaDef", seedCluster3Row("SchemaDef", n));
    }
    await fixture.substrate.put("Counter", seedCluster3Row("Counter", 1));

    const runner = new MigrationRunner(fixture.substrate);
    registerCluster3(runner);

    expect(runner.registeredKinds()).toEqual([...CLUSTER_3_KINDS].sort());

    const results = new Map<string, Awaited<ReturnType<MigrationRunner["runKind"]>>>();
    for (const kind of CLUSTER_3_KINDS) {
      results.set(kind, await runner.runKind(kind, { waveId: "W3" }));
    }

    // Per-kind acceptance: 2 rows for non-Counter; 1 for Counter
    expect(results.get("Agent")!.rowsMigrated).toBe(2);
    expect(results.get("SchemaDef")!.rowsMigrated).toBe(2);
    expect(results.get("Counter")!.rowsMigrated).toBe(1);

    // Verify envelope-shape per kind
    for (const kind of CLUSTER_3_KINDS) {
      const post = await fixture.substrate.list<unknown>(kind, { limit: 10 });
      for (const row of post.items) {
        expect(isEnvelopeShape(row)).toBe(true);
        expect((row as { kind: string }).kind).toBe(kind);
        expect((row as { apiVersion: string }).apiVersion).toBe("core.ois/v1");
      }
    }

    // Counter STRUCTURAL TRANSFORMATION: top-level *Counter → status.counters
    const counterRow = await fixture.substrate.get<EnvelopeRow>("Counter", "counter");
    expect(counterRow!.status.counters).toEqual({ testCounter1: 10 });
    expect(counterRow!.status.phase).toBe("active");
    expect(counterRow!.spec).toEqual({});
  });

  it("Agent: 5 distinct status fields per Q3 per-FSM-as-top-level (canonical multi-FSM)", async () => {
    await fixture.substrate.put("Agent", seedCluster3Row("Agent", 1));
    const runner = new MigrationRunner(fixture.substrate);
    registerCluster3(runner);
    await runner.runKind("Agent");

    const agent = await fixture.substrate.get<EnvelopeRow>("Agent", "agent-00000001");
    expect(agent!.status.phase).toBe("online");           // primary FSM
    expect(agent!.status.livenessState).toBe("online");   // ADR-017 composite
    expect(agent!.status.activityState).toBe("online_idle"); // Mission-62
    expect(agent!.status.cognitiveState).toBe("alive");   // Mission-75 component
    expect(agent!.status.transportState).toBe("alive");   // Mission-75 component
    expect(agent!.metadata.createdAt).toBe("2026-05-21T00:00:00Z");  // firstSeenAt rename
    expect(agent!.name).toBe("agent-name-1");
  });

  it("SchemaDef: OQ10 deliberate-extension — status.phase='applied' injected", async () => {
    await fixture.substrate.put("SchemaDef", seedCluster3Row("SchemaDef", 1));
    const runner = new MigrationRunner(fixture.substrate);
    registerCluster3(runner);
    await runner.runKind("SchemaDef");

    const sd = await fixture.substrate.get<EnvelopeRow>("SchemaDef", "TestKind1");
    expect(sd!.name).toBe("TestKind1");
    expect(sd!.status.phase).toBe("applied");
    expect(sd!.status.appliedVersion).toBe(1);
    expect(sd!.status.reconcileError).toBeNull();
  });

  it("idempotent re-run across cluster-3: all rows skip on second pass", async () => {
    await fixture.substrate.put("Agent", seedCluster3Row("Agent", 1));
    await fixture.substrate.put("SchemaDef", seedCluster3Row("SchemaDef", 1));
    await fixture.substrate.put("Counter", seedCluster3Row("Counter", 1));

    const runner = new MigrationRunner(fixture.substrate);
    registerCluster3(runner);

    for (const kind of CLUSTER_3_KINDS) {
      const r = await runner.runKind(kind);
      expect(r.rowsMigrated).toBe(1);
    }

    const cursorRepo = new MigrationCursorRepository(fixture.substrate);
    for (const kind of CLUSTER_3_KINDS) {
      await cursorRepo.resetCheckpoint(kind);
    }

    for (const kind of CLUSTER_3_KINDS) {
      const r = await runner.runKind(kind);
      expect(r.rowsSkipped).toBe(1);
      expect(r.rowsMigrated).toBe(0);
    }
  });

  it("Q4 SchemaDef kill-9-simulated restart-safety: substrate state recoverable after mid-migration error", async () => {
    // Seed 3 SchemaDef rows; module throws on ALL invocations (simulates 'crash before any row commits')
    for (const n of [1, 2, 3]) {
      await fixture.substrate.put("SchemaDef", seedCluster3Row("SchemaDef", n));
    }

    const alwaysThrowingRunner = new MigrationRunner(fixture.substrate);
    alwaysThrowingRunner.register({
      kind: "SchemaDef",
      schemaRef: { schema: ALL_SCHEMAS.find(s => s.kind === "SchemaDef")! },
      migrateOne(): never { throw new Error("simulated kill-9 mid-SchemaDef-migration"); },
    });

    // First runKind: ALL rows error; no rows successfully migrated; flag cleared in finally
    const r1 = await alwaysThrowingRunner.runKind("SchemaDef", { waveId: "W3-kill9-sim" });
    expect(r1.rowsErrored).toBe(3);
    expect(r1.errors[0].message).toMatch(/simulated kill-9/);
    expect(r1.rowsMigrated).toBe(0);
    expect(isMigrationInProgress("SchemaDef")).toBe(false);

    // Substrate-state integrity: ALL 3 SchemaDef rows still readable post-crash (legacy shape preserved)
    const postCrash = await fixture.substrate.list<unknown>("SchemaDef", { limit: 10 });
    expect(postCrash.items.length).toBe(3);
    for (const row of postCrash.items) {
      expect(isEnvelopeShape(row)).toBe(false);  // legacy-shape preserved (no partial-state)
    }

    // Cursor MAY exist (if any prior advanceCheckpoint happened before throws — unlikely but possible);
    // either way, the invariant is that re-running with a CLEAN module + reset cursor produces clean migration
    const cursorRepo = new MigrationCursorRepository(fixture.substrate);
    await cursorRepo.resetCheckpoint("SchemaDef");

    // 2nd runKind with a fresh non-throwing module: completes ALL rows from scratch
    const freshRunner = new MigrationRunner(fixture.substrate);
    registerCluster3(freshRunner);
    const r2 = await freshRunner.runKind("SchemaDef", { waveId: "W3-kill9-recover" });
    expect(r2.rowsMigrated).toBe(3);
    expect(r2.rowsErrored).toBe(0);

    // SchemaDef-for-SchemaDef integrity preserved: all 3 rows envelope-shape post-recovery
    const final = await fixture.substrate.list<unknown>("SchemaDef", { limit: 10 });
    expect(final.items.length).toBe(3);
    for (const row of final.items) {
      expect(isEnvelopeShape(row)).toBe(true);
      expect((row as { status: { phase: string } }).status.phase).toBe("applied");
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
// W4 cluster-4 batch-migration wire-flow (Q7 disposition; per thread-646 R2)
// Message.kind → metadata.messageKind CANONICAL field-name-collision renameMap
// FIRST cross-cluster use of envelope library renameMap for true collision.
// ───────────────────────────────────────────────────────────────────────

const CLUSTER_4_KINDS = ["Message", "Audit", "RepoEventBridgeCursor", "RepoEventBridgeDedupe"] as const;

function seedCluster4Row(kind: typeof CLUSTER_4_KINDS[number], n: number): { id: string } & Record<string, unknown> {
  switch (kind) {
    case "Message":
      return {
        id: `01HMESSAGE${n.toString().padStart(16, "0")}`,
        kind: "reply",  // LEGACY discriminator — collision target; will rename to metadata.messageKind
        authorRole: "engineer", authorAgentId: `agent-${n}`,
        target: { role: "architect" },
        threadId: `thread-${600 + n}`, sequenceInThread: n,
        delivery: "push-immediate", status: "new",
        payload: { body: `msg ${n}` },
        intent: null, semanticIntent: null, converged: false,
        migrationSourceId: null,
        createdAt: `2026-05-2${n}T00:00:00Z`,
        updatedAt: `2026-05-2${n}T00:00:00Z`,
      };
    case "Audit":
      return {
        id: `audit-${n}`,
        timestamp: `2026-05-2${n}T00:00:00Z`,
        actor: "engineer", action: `action${n}`, details: `details ${n}`,
        relatedEntity: `mission-${n}`,
      };
    case "RepoEventBridgeCursor":
      return {
        id: `apnex-org__repo-${n}`,
        body: { last_event_id: `${n * 100}`, last_etag: `etag-${n}` },
      };
    case "RepoEventBridgeDedupe":
      return {
        id: `apnex-org__repo-${n}`,
        body: { lru: [`dlv-${n}`, `dlv-${n + 1}`], max_size: 1000 },
      };
  }
}

function registerCluster4(runner: MigrationRunner): void {
  runner.register(createMessageMigrationModule(ALL_SCHEMAS.find(s => s.kind === "Message")!));
  runner.register(createAuditMigrationModule(ALL_SCHEMAS.find(s => s.kind === "Audit")!));
  runner.register(createRepoEventBridgeCursorMigrationModule(ALL_SCHEMAS.find(s => s.kind === "RepoEventBridgeCursor")!));
  runner.register(createRepoEventBridgeDedupeMigrationModule(ALL_SCHEMAS.find(s => s.kind === "RepoEventBridgeDedupe")!));
}

describe("W4 cluster-4 batch wire-flow — 3-kind migration + Message renameMap CANONICAL", () => {
  beforeEach(async () => {
    for (const k of CLUSTER_4_KINDS) await cleanKind(fixture.connStr, k);
    await cleanKind(fixture.connStr, "MigrationCursor");
  });

  it("migrates all 4 cluster-4 kinds end-to-end + cursors isolate per-kind", async () => {
    for (const kind of CLUSTER_4_KINDS) {
      for (const n of [1, 2]) {
        await fixture.substrate.put(kind, seedCluster4Row(kind, n));
      }
    }

    const runner = new MigrationRunner(fixture.substrate);
    registerCluster4(runner);
    expect(runner.registeredKinds()).toEqual([...CLUSTER_4_KINDS].sort());

    const results = new Map<string, Awaited<ReturnType<MigrationRunner["runKind"]>>>();
    for (const kind of CLUSTER_4_KINDS) {
      results.set(kind, await runner.runKind(kind, { waveId: "W4" }));
    }

    for (const kind of CLUSTER_4_KINDS) {
      const r = results.get(kind)!;
      expect(r.rowsMigrated).toBe(2);
      expect(r.rowsErrored).toBe(0);
    }

    for (const kind of CLUSTER_4_KINDS) {
      const post = await fixture.substrate.list<unknown>(kind, { limit: 10 });
      expect(post.items.length).toBe(2);
      for (const row of post.items) {
        expect(isEnvelopeShape(row)).toBe(true);
        expect((row as { kind: string }).kind).toBe(kind);
        expect((row as { apiVersion: string }).apiVersion).toBe("core.ois/v1");
      }
    }
  });

  it("Q3 CANONICAL renameMap: Message.kind → metadata.messageKind; envelope.kind='Message' preserved (no collision)", async () => {
    await fixture.substrate.put("Message", seedCluster4Row("Message", 1));
    const runner = new MigrationRunner(fixture.substrate);
    registerCluster4(runner);
    await runner.runKind("Message");

    const msg = await fixture.substrate.get<EnvelopeRow>("Message", "01HMESSAGE0000000000000001");
    expect(msg!.kind).toBe("Message");                       // entity-kind discriminator
    expect(msg!.metadata.messageKind).toBe("reply");         // legacy Message.kind renamed
    expect(msg!.status.phase).toBe("new");                   // FSM rename
    expect(msg!.metadata.authorRole).toBe("engineer");
    expect(msg!.metadata.threadId).toBe("thread-601");
    expect(msg!.spec.delivery).toBe("push-immediate");
    expect(msg!.spec.payload).toEqual({ body: "msg 1" });
    expect(msg!.metadata.kind).toBeUndefined();              // CRITICAL: no double-write of legacy.kind
  });

  it("Q4 Audit append-only 'logged' constant + timestamp→metadata.createdAt rename", async () => {
    await fixture.substrate.put("Audit", seedCluster4Row("Audit", 1));
    const runner = new MigrationRunner(fixture.substrate);
    registerCluster4(runner);
    await runner.runKind("Audit");

    const audit = await fixture.substrate.get<EnvelopeRow>("Audit", "audit-1");
    expect(audit!.status.phase).toBe("logged");              // constant injection
    expect(audit!.metadata.createdAt).toBe("2026-05-21T00:00:00Z"); // from legacy.timestamp
    expect(audit!.metadata.actor).toBe("engineer");
    expect(audit!.spec.action).toBe("action1");
    expect(audit!.metadata.updatedAt).toBeUndefined();       // append-only; no updatedAt
  });

  it("Q5 RepoEventBridgeCursor opaque body → status.cursor (cursor-store JSON preserved)", async () => {
    await fixture.substrate.put("RepoEventBridgeCursor", seedCluster4Row("RepoEventBridgeCursor", 1));
    const runner = new MigrationRunner(fixture.substrate);
    registerCluster4(runner);
    await runner.runKind("RepoEventBridgeCursor");

    const cursor = await fixture.substrate.get<EnvelopeRow>("RepoEventBridgeCursor", "apnex-org__repo-1");
    expect(cursor!.status.phase).toBe("active");
    expect(cursor!.status.cursor).toEqual({ last_event_id: "100", last_etag: "etag-1" });
    expect(cursor!.spec).toEqual({});
  });

  it("Q5 RepoEventBridgeDedupe opaque body → status.dedupe (sibling-kind separation)", async () => {
    await fixture.substrate.put("RepoEventBridgeDedupe", seedCluster4Row("RepoEventBridgeDedupe", 1));
    const runner = new MigrationRunner(fixture.substrate);
    registerCluster4(runner);
    await runner.runKind("RepoEventBridgeDedupe");

    const dedupe = await fixture.substrate.get<EnvelopeRow>("RepoEventBridgeDedupe", "apnex-org__repo-1");
    expect(dedupe!.status.phase).toBe("active");
    expect(dedupe!.status.dedupe).toEqual({ lru: ["dlv-1", "dlv-2"], max_size: 1000 });
    expect(dedupe!.status.cursor).toBeUndefined();  // sibling-kind separation
  });

  it("idempotent re-run across cluster-4: all rows skip on second pass", async () => {
    for (const kind of CLUSTER_4_KINDS) {
      await fixture.substrate.put(kind, seedCluster4Row(kind, 1));
    }

    const runner = new MigrationRunner(fixture.substrate);
    registerCluster4(runner);

    for (const kind of CLUSTER_4_KINDS) {
      const r = await runner.runKind(kind);
      expect(r.rowsMigrated).toBe(1);
    }

    const cursorRepo = new MigrationCursorRepository(fixture.substrate);
    for (const kind of CLUSTER_4_KINDS) {
      await cursorRepo.resetCheckpoint(kind);
    }

    for (const kind of CLUSTER_4_KINDS) {
      const r = await runner.runKind(kind);
      expect(r.rowsSkipped).toBe(1);
      expect(r.rowsMigrated).toBe(0);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
// W5 cluster-5 batch-migration wire-flow (Q7 disposition; per thread-647 R2)
// FINAL cluster wave — Document.category → metadata.labels CONTENT-classification
// axis first-instance + 4-kind "logged" constant verification.
// ───────────────────────────────────────────────────────────────────────

const CLUSTER_5_KINDS = ["Document", "ArchitectDecision", "DirectorHistoryEntry", "ReviewHistoryEntry", "ThreadHistoryEntry"] as const;

function seedCluster5Row(kind: typeof CLUSTER_5_KINDS[number], n: number): { id: string } & Record<string, unknown> {
  switch (kind) {
    case "Document":
      return {
        id: `policy-doc-v${n}`,
        category: n % 2 === 0 ? "planning" : "architecture",
        content: `# Document ${n}\n\nbody ${n}`,
      };
    case "ArchitectDecision":
      return {
        id: `ad-${n}`,
        context: `context ${n}`,
        decision: `decision ${n}`,
        timestamp: `2026-05-2${n}T00:00:00Z`,
      };
    case "DirectorHistoryEntry":
      return {
        id: `dh-${n}`,
        role: n % 2 === 0 ? "model" : "user",
        text: `chat ${n}`,
        timestamp: `2026-05-2${n}T00:00:00Z`,
      };
    case "ReviewHistoryEntry":
      return {
        id: `rh-${n}`,
        taskId: `task-${500 + n}`,
        timestamp: `2026-05-2${n}T00:00:00Z`,
        assessment: `assessment ${n}`,
      };
    case "ThreadHistoryEntry":
      return {
        id: `th-${n}`,
        threadId: `thread-${640 + n}`,
        title: `thread title ${n}`,
        outcome: `outcome ${n}`,
        timestamp: `2026-05-2${n}T00:00:00Z`,
      };
  }
}

function registerCluster5(runner: MigrationRunner): void {
  runner.register(createDocumentMigrationModule(ALL_SCHEMAS.find(s => s.kind === "Document")!));
  runner.register(createArchitectDecisionMigrationModule(ALL_SCHEMAS.find(s => s.kind === "ArchitectDecision")!));
  runner.register(createDirectorHistoryEntryMigrationModule(ALL_SCHEMAS.find(s => s.kind === "DirectorHistoryEntry")!));
  runner.register(createReviewHistoryEntryMigrationModule(ALL_SCHEMAS.find(s => s.kind === "ReviewHistoryEntry")!));
  runner.register(createThreadHistoryEntryMigrationModule(ALL_SCHEMAS.find(s => s.kind === "ThreadHistoryEntry")!));
}

describe("W5 cluster-5 batch wire-flow — 5-kind migration + Document content-classification axis (FINAL cluster)", () => {
  beforeEach(async () => {
    for (const k of CLUSTER_5_KINDS) await cleanKind(fixture.connStr, k);
    await cleanKind(fixture.connStr, "MigrationCursor");
  });

  it("migrates all 5 cluster-5 kinds end-to-end + cursors isolate per-kind", async () => {
    for (const kind of CLUSTER_5_KINDS) {
      for (const n of [1, 2]) {
        await fixture.substrate.put(kind, seedCluster5Row(kind, n));
      }
    }

    const runner = new MigrationRunner(fixture.substrate);
    registerCluster5(runner);
    expect(runner.registeredKinds()).toEqual([...CLUSTER_5_KINDS].sort());

    const results = new Map<string, Awaited<ReturnType<MigrationRunner["runKind"]>>>();
    for (const kind of CLUSTER_5_KINDS) {
      results.set(kind, await runner.runKind(kind, { waveId: "W5" }));
    }

    for (const kind of CLUSTER_5_KINDS) {
      const r = results.get(kind)!;
      expect(r.rowsMigrated).toBe(2);
      expect(r.rowsErrored).toBe(0);
    }

    for (const kind of CLUSTER_5_KINDS) {
      const post = await fixture.substrate.list<unknown>(kind, { limit: 10 });
      expect(post.items.length).toBe(2);
      for (const row of post.items) {
        expect(isEnvelopeShape(row)).toBe(true);
        expect((row as { kind: string }).kind).toBe(kind);
        expect((row as { apiVersion: string }).apiVersion).toBe("core.ois/v1");
      }
    }
  });

  it("Q3 Document.category → metadata.labels.category (CONTENT-classification axis FIRST-instance per cluster-3 §5)", async () => {
    await fixture.substrate.put("Document", seedCluster5Row("Document", 1));
    const runner = new MigrationRunner(fixture.substrate);
    registerCluster5(runner);
    await runner.runKind("Document");

    const doc = await fixture.substrate.get<EnvelopeRow>("Document", "policy-doc-v1");
    expect(doc!.metadata.labels).toEqual({ category: "architecture" });  // CONTENT-classification first-instance
    expect(doc!.name).toBe("policy-doc-v1");                              // A2: name = legacy.id (file-stem)
    expect(doc!.status.phase).toBe("active");                             // Q4: mostly-static; no real FSM
    expect(doc!.spec.content).toBe("# Document 1\n\nbody 1");
  });

  it('Q4 4-kind "logged" constant verification (ArchitectDecision + 3 HistoryEntry kinds)', async () => {
    for (const kind of ["ArchitectDecision", "DirectorHistoryEntry", "ReviewHistoryEntry", "ThreadHistoryEntry"] as const) {
      await fixture.substrate.put(kind, seedCluster5Row(kind, 1));
    }
    const runner = new MigrationRunner(fixture.substrate);
    registerCluster5(runner);
    for (const kind of ["ArchitectDecision", "DirectorHistoryEntry", "ReviewHistoryEntry", "ThreadHistoryEntry"] as const) {
      await runner.runKind(kind);
    }

    const ad = await fixture.substrate.get<EnvelopeRow>("ArchitectDecision", "ad-1");
    const dh = await fixture.substrate.get<EnvelopeRow>("DirectorHistoryEntry", "dh-1");
    const rh = await fixture.substrate.get<EnvelopeRow>("ReviewHistoryEntry", "rh-1");
    const th = await fixture.substrate.get<EnvelopeRow>("ThreadHistoryEntry", "th-1");

    expect(ad!.status.phase).toBe("logged");
    expect(dh!.status.phase).toBe("logged");
    expect(rh!.status.phase).toBe("logged");
    expect(th!.status.phase).toBe("logged");

    // Q5 updatedAt-omission for 4 append-only kinds
    expect(ad!.metadata.updatedAt).toBeUndefined();
    expect(dh!.metadata.updatedAt).toBeUndefined();
    expect(rh!.metadata.updatedAt).toBeUndefined();
    expect(th!.metadata.updatedAt).toBeUndefined();

    // timestamp → metadata.createdAt uniformity
    expect(ad!.metadata.createdAt).toBe("2026-05-21T00:00:00Z");
    expect(dh!.metadata.createdAt).toBe("2026-05-21T00:00:00Z");

    // FK pointers in metadata (forensic-pointers; Q9 framing)
    expect(rh!.metadata.taskId).toBe("task-501");
    expect(th!.metadata.threadId).toBe("thread-641");
    expect(th!.metadata.sourceThreadId).toBeUndefined();  // Q9 distinction
  });

  it("idempotent re-run across cluster-5: all rows skip on second pass", async () => {
    for (const kind of CLUSTER_5_KINDS) {
      await fixture.substrate.put(kind, seedCluster5Row(kind, 1));
    }

    const runner = new MigrationRunner(fixture.substrate);
    registerCluster5(runner);

    for (const kind of CLUSTER_5_KINDS) {
      const r = await runner.runKind(kind);
      expect(r.rowsMigrated).toBe(1);
    }

    const cursorRepo = new MigrationCursorRepository(fixture.substrate);
    for (const kind of CLUSTER_5_KINDS) {
      await cursorRepo.resetCheckpoint(kind);
    }

    for (const kind of CLUSTER_5_KINDS) {
      const r = await runner.runKind(kind);
      expect(r.rowsSkipped).toBe(1);
      expect(r.rowsMigrated).toBe(0);
    }
  });
});
