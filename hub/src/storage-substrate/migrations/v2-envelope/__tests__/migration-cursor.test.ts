/**
 * mission-88 W0 — MigrationCursorRepository integration tests.
 *
 * Per thread-639 Q3 disposition. Verifies per-kind cursor primitive:
 *   - getCheckpoint returns null on first call (no cursor yet)
 *   - advanceCheckpoint creates cursor on first-write
 *   - advanceCheckpoint updates existing cursor
 *   - resetCheckpoint deletes cursor row
 *   - per-kind isolation (Idea cursor independent of Bug cursor)
 *   - concurrent advanceCheckpoint preserves consistency (CAS retry)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MigrationCursorRepository } from "../../../../entities/migration-cursor-repository.js";
import { ALL_SCHEMAS } from "../../../schemas/all-schemas.js";
import { createSchemaReconciler } from "../../../schema-reconciler.js";
import { setupSubstrate, teardownSubstrate, cleanKind, type SubstrateFixture } from "./harness/fixtures.js";

let fixture: SubstrateFixture;

beforeAll(async () => {
  fixture = await setupSubstrate();
  // Reconciler seeds SchemaDef rows (including MigrationCursor); required for
  // per-kind put/get to succeed under SchemaDef validation.
  const reconciler = createSchemaReconciler(fixture.substrate, fixture.connStr, {
    initialSchemas: ALL_SCHEMAS,
  });
  await reconciler.start();
}, 60_000);

afterAll(async () => {
  await teardownSubstrate(fixture);
}, 30_000);

beforeEach(async () => {
  await cleanKind(fixture.connStr, "MigrationCursor");
});

describe("MigrationCursorRepository", () => {
  it("getCheckpoint returns null when no cursor row exists", async () => {
    const repo = new MigrationCursorRepository(fixture.substrate);
    const checkpoint = await repo.getCheckpoint("Idea");
    expect(checkpoint).toBeNull();
  });

  it("advanceCheckpoint creates cursor row on first write", async () => {
    const repo = new MigrationCursorRepository(fixture.substrate);
    await repo.advanceCheckpoint("Idea", "idea-42", "W1");
    const checkpoint = await repo.getCheckpoint("Idea");
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.id).toBe("cursor-Idea");
    expect(checkpoint?.lastMigratedId).toBe("idea-42");
    expect(checkpoint?.waveId).toBe("W1");
    expect(checkpoint?.lastMigratedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("advanceCheckpoint updates existing cursor (CAS retry preserves monotonic)", async () => {
    const repo = new MigrationCursorRepository(fixture.substrate);
    await repo.advanceCheckpoint("Idea", "idea-1");
    await repo.advanceCheckpoint("Idea", "idea-2");
    await repo.advanceCheckpoint("Idea", "idea-3");
    const checkpoint = await repo.getCheckpoint("Idea");
    expect(checkpoint?.lastMigratedId).toBe("idea-3");
  });

  it("resetCheckpoint deletes cursor row", async () => {
    const repo = new MigrationCursorRepository(fixture.substrate);
    await repo.advanceCheckpoint("Idea", "idea-1");
    expect(await repo.getCheckpoint("Idea")).not.toBeNull();
    await repo.resetCheckpoint("Idea");
    expect(await repo.getCheckpoint("Idea")).toBeNull();
  });

  it("per-kind cursors are independent (no CAS contention across kinds)", async () => {
    const repo = new MigrationCursorRepository(fixture.substrate);
    await repo.advanceCheckpoint("Idea", "idea-1");
    await repo.advanceCheckpoint("Bug", "bug-1");
    await repo.advanceCheckpoint("Task", "task-1");

    expect((await repo.getCheckpoint("Idea"))?.lastMigratedId).toBe("idea-1");
    expect((await repo.getCheckpoint("Bug"))?.lastMigratedId).toBe("bug-1");
    expect((await repo.getCheckpoint("Task"))?.lastMigratedId).toBe("task-1");
  });

  it("CONCURRENT advanceCheckpoint calls preserve consistency via CAS retry", async () => {
    const repo = new MigrationCursorRepository(fixture.substrate);
    // 10 concurrent advances of the same kind; all should succeed; final state
    // is one of the issued lastMigratedIds (last-writer-wins on CAS).
    const N = 10;
    const ids = Array.from({ length: N }, (_, i) => `idea-${i + 1}`);
    await Promise.all(ids.map(id => repo.advanceCheckpoint("Idea", id, "W1")));
    const checkpoint = await repo.getCheckpoint("Idea");
    expect(checkpoint).not.toBeNull();
    expect(ids).toContain(checkpoint!.lastMigratedId);
  });
});
