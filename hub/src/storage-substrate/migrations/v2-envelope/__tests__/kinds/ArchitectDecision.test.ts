/**
 * mission-88 W5 cluster-5 — ArchitectDecision migration module unit tests.
 */

import { describe, it, expect } from "vitest";
import { createArchitectDecisionMigrationModule } from "../../kinds/ArchitectDecision.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const adSchema: SchemaDef = { kind: "ArchitectDecision", version: 2, fields: [], indexes: [], watchable: true };

function legacyAD(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "ad-28",
    context: "mission-88 envelope migration cluster-5 ship",
    decision: "Apply 7th cumulative pattern atomic primitive-rewrite-with-wave-migration as documentation note",
    timestamp: "2026-05-24T04:00:00Z",
    ...overrides,
  };
}

describe("ArchitectDecision migration module", () => {
  const module = createArchitectDecisionMigrationModule(adSchema);

  it("declares kind=ArchitectDecision", () => {
    expect(module.kind).toBe("ArchitectDecision");
  });

  it("encodes legacy ArchitectDecision to envelope shape", () => {
    const env = module.migrateOne(legacyAD()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("ArchitectDecision");
    expect(env.id).toBe("ad-28");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
  });

  it("timestamp → metadata.createdAt (uniformity rename)", () => {
    const env = module.migrateOne(legacyAD()) as EnvelopeShape;
    expect(env.metadata.createdAt).toBe("2026-05-24T04:00:00Z");
    expect((env.metadata as Record<string, unknown>).timestamp).toBeUndefined();
  });

  it("NO updatedAt (append-only immutable-content; A4 W3 Tele precedent)", () => {
    const env = module.migrateOne(legacyAD()) as EnvelopeShape;
    expect(env.metadata.updatedAt).toBeUndefined();
  });

  it("spec carries declared substantive content (decision + context)", () => {
    const env = module.migrateOne(legacyAD()) as EnvelopeShape;
    expect(env.spec.decision).toBe("Apply 7th cumulative pattern atomic primitive-rewrite-with-wave-migration as documentation note");
    expect(env.spec.context).toBe("mission-88 envelope migration cluster-5 ship");
  });

  it('status.phase: "logged" constant (append-only-log uniformity)', () => {
    const env = module.migrateOne(legacyAD()) as EnvelopeShape;
    expect(env.status.phase).toBe("logged");
  });

  it("name OMITTED — content-classified; defaults to id", () => {
    const env = module.migrateOne(legacyAD()) as EnvelopeShape;
    expect(env.name).toBe("ad-28");
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacyAD()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });
});
