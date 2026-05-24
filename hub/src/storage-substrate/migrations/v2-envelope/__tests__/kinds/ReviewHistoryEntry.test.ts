/**
 * mission-88 W5 cluster-5 — ReviewHistoryEntry migration module unit tests.
 */

import { describe, it, expect } from "vitest";
import { createReviewHistoryEntryMigrationModule } from "../../kinds/ReviewHistoryEntry.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const rhSchema: SchemaDef = { kind: "ReviewHistoryEntry", version: 2, fields: [], indexes: [], watchable: true };

function legacyRH(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "rh-50",
    taskId: "task-500",
    timestamp: "2026-05-24T04:00:00Z",
    assessment: "Review approved; tests pass; ship",
    ...overrides,
  };
}

describe("ReviewHistoryEntry migration module", () => {
  const module = createReviewHistoryEntryMigrationModule(rhSchema);

  it("declares kind=ReviewHistoryEntry", () => {
    expect(module.kind).toBe("ReviewHistoryEntry");
  });

  it("encodes legacy ReviewHistoryEntry to envelope shape", () => {
    const env = module.migrateOne(legacyRH()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("ReviewHistoryEntry");
    expect(env.id).toBe("rh-50");
  });

  it("timestamp → metadata.createdAt", () => {
    const env = module.migrateOne(legacyRH()) as EnvelopeShape;
    expect(env.metadata.createdAt).toBe("2026-05-24T04:00:00Z");
  });

  it("taskId → metadata (FK pointer identity-shape per OQ11)", () => {
    const env = module.migrateOne(legacyRH()) as EnvelopeShape;
    expect(env.metadata.taskId).toBe("task-500");
  });

  it("spec carries declared assessment content", () => {
    const env = module.migrateOne(legacyRH()) as EnvelopeShape;
    expect(env.spec.assessment).toBe("Review approved; tests pass; ship");
  });

  it('status.phase: "logged" constant', () => {
    const env = module.migrateOne(legacyRH()) as EnvelopeShape;
    expect(env.status.phase).toBe("logged");
  });

  it("NO updatedAt (append-only)", () => {
    const env = module.migrateOne(legacyRH()) as EnvelopeShape;
    expect(env.metadata.updatedAt).toBeUndefined();
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacyRH()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });
});
