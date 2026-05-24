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
