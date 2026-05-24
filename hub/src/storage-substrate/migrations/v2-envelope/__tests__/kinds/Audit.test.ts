/**
 * mission-88 W4 cluster-4 — Audit migration module unit tests.
 *
 * Per cluster-4 Design v0.3 §2.2. Asserts:
 *   - timestamp → metadata.createdAt (envelope-uniformity rename)
 *   - actor → metadata (identity-shape)
 *   - action/details/relatedEntity → spec (declared content)
 *   - status.phase: "logged" constant (uniformity; no FSM)
 *   - NO `updatedAt` (append-only; immutable post-create — A4 Tele precedent)
 *   - Idempotency reference-equality
 */

import { describe, it, expect } from "vitest";
import { createAuditMigrationModule } from "../../kinds/Audit.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const auditSchema: SchemaDef = { kind: "Audit", version: 2, fields: [], indexes: [], watchable: true };

function legacyAudit(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "audit-1234",
    timestamp: "2026-05-24T04:30:00Z",
    actor: "engineer",
    action: "ship",
    details: "mission-88 W4 PR opened",
    relatedEntity: "mission-88",
    ...overrides,
  };
}

describe("Audit migration module", () => {
  const module = createAuditMigrationModule(auditSchema);

  it("declares kind=Audit", () => {
    expect(module.kind).toBe("Audit");
  });

  it("encodes legacy Audit to envelope shape", () => {
    const env = module.migrateOne(legacyAudit()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("Audit");
    expect(env.id).toBe("audit-1234");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
  });

  it("timestamp → metadata.createdAt (envelope-uniformity rename)", () => {
    const env = module.migrateOne(legacyAudit()) as EnvelopeShape;
    expect(env.metadata.createdAt).toBe("2026-05-24T04:30:00Z");
    expect((env.metadata as Record<string, unknown>).timestamp).toBeUndefined();
  });

  it("NO `updatedAt` in metadata (append-only; immutable post-create)", () => {
    const env = module.migrateOne(legacyAudit()) as EnvelopeShape;
    expect(env.metadata.updatedAt).toBeUndefined();
  });

  it("metadata carries actor (identity-shape)", () => {
    const env = module.migrateOne(legacyAudit()) as EnvelopeShape;
    expect(env.metadata.actor).toBe("engineer");
  });

  it("spec carries declared content (action + details + relatedEntity)", () => {
    const env = module.migrateOne(legacyAudit()) as EnvelopeShape;
    expect(env.spec.action).toBe("ship");
    expect(env.spec.details).toBe("mission-88 W4 PR opened");
    expect(env.spec.relatedEntity).toBe("mission-88");
  });

  it('status.phase: "logged" constant (uniformity; no FSM)', () => {
    const env = module.migrateOne(legacyAudit()) as EnvelopeShape;
    expect(env.status.phase).toBe("logged");
  });

  it("all 3 actor enums preserved", () => {
    for (const a of ["architect", "engineer", "hub"]) {
      const env = module.migrateOne(legacyAudit({ actor: a })) as EnvelopeShape;
      expect(env.metadata.actor).toBe(a);
    }
  });

  it("relatedEntity=null preserved", () => {
    const env = module.migrateOne(legacyAudit({ relatedEntity: null })) as EnvelopeShape;
    expect(env.spec.relatedEntity).toBeNull();
  });

  it("name OMITTED — content-classified §1.5; envelope.name defaults to id", () => {
    const env = module.migrateOne(legacyAudit()) as EnvelopeShape;
    expect(env.name).toBe("audit-1234");
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacyAudit()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });
});
