/**
 * mission-88 W5 cluster-5 — ThreadHistoryEntry migration module unit tests.
 *
 * Note Q9 framing-distinction: threadId is forensic-pointer-to-source-Thread
 * (substrate-pointer for cross-entity lookup), NOT cascade-spawn-provenance
 * (sourceThreadId). bug-118 IN-clause stays at 8 kinds; cluster-5 contributes
 * ZERO new kinds.
 */

import { describe, it, expect } from "vitest";
import { createThreadHistoryEntryMigrationModule } from "../../kinds/ThreadHistoryEntry.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const thSchema: SchemaDef = { kind: "ThreadHistoryEntry", version: 2, fields: [], indexes: [], watchable: true };

function legacyTH(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "th-50",
    threadId: "thread-647",
    title: "mission-88 W5 cluster-5 content-archive Design-pass — Q-bilateral (FINAL cluster)",
    outcome: "FINAL cluster Design-pass converged; all Q1-Q10 + A1+A2+A3 CONCUR",
    timestamp: "2026-05-24T04:41:00Z",
    ...overrides,
  };
}

describe("ThreadHistoryEntry migration module", () => {
  const module = createThreadHistoryEntryMigrationModule(thSchema);

  it("declares kind=ThreadHistoryEntry", () => {
    expect(module.kind).toBe("ThreadHistoryEntry");
  });

  it("encodes legacy ThreadHistoryEntry to envelope shape", () => {
    const env = module.migrateOne(legacyTH()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("ThreadHistoryEntry");
    expect(env.id).toBe("th-50");
  });

  it("timestamp → metadata.createdAt", () => {
    const env = module.migrateOne(legacyTH()) as EnvelopeShape;
    expect(env.metadata.createdAt).toBe("2026-05-24T04:41:00Z");
  });

  it("threadId → metadata (forensic-pointer per Q9 framing — NOT cascade-provenance)", () => {
    const env = module.migrateOne(legacyTH()) as EnvelopeShape;
    expect(env.metadata.threadId).toBe("thread-647");
    // Critical: not stored as sourceThreadId (which would be cascade-provenance shape)
    expect(env.metadata.sourceThreadId).toBeUndefined();
  });

  it("spec carries declared title (frozen at archive) + outcome", () => {
    const env = module.migrateOne(legacyTH()) as EnvelopeShape;
    expect(env.spec.title).toBe("mission-88 W5 cluster-5 content-archive Design-pass — Q-bilateral (FINAL cluster)");
    expect(env.spec.outcome).toBe("FINAL cluster Design-pass converged; all Q1-Q10 + A1+A2+A3 CONCUR");
  });

  it('status.phase: "logged" constant', () => {
    const env = module.migrateOne(legacyTH()) as EnvelopeShape;
    expect(env.status.phase).toBe("logged");
  });

  it("NO updatedAt (append-only)", () => {
    const env = module.migrateOne(legacyTH()) as EnvelopeShape;
    expect(env.metadata.updatedAt).toBeUndefined();
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacyTH()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });
});
