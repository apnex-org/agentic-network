/**
 * mission-88 W3 cluster-3 — SchemaDef migration module unit tests.
 *
 * Per cluster-3 Design v0.3 §2.3 (substrate-currency-ratified at thread-645 R2;
 * deliberate-extension acknowledged per OQ10). Asserts:
 *   - kind → envelope.name + metadata.name (handle-classified; K8s CRD precedent)
 *   - version/fields[]/indexes[]/watchable → spec (declared schema config)
 *   - NEW status fields injected at migration time (existing SchemaDefs marked
 *     status.phase="applied"; appliedVersion mirrors spec.version)
 *   - Idempotency reference-equality
 */

import { describe, it, expect } from "vitest";
import { createSchemaDefMigrationModule } from "../../kinds/SchemaDef.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const schemaDefSchema: SchemaDef = { kind: "SchemaDef", version: 1, fields: [], indexes: [], watchable: true };

function legacySchemaDef(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "Idea",        // PK = kind-name (substrate convention)
    kind: "Idea",      // mirrors id; cluster-3 §2.3 maps both to metadata.name
    version: 2,
    fields: [{ name: "text", type: "string", required: true }],
    indexes: [{ name: "idea_status_idx", fields: ["status"] }],
    watchable: true,
    ...overrides,
  };
}

describe("SchemaDef migration module", () => {
  const module = createSchemaDefMigrationModule(schemaDefSchema);

  it("declares kind=SchemaDef", () => {
    expect(module.kind).toBe("SchemaDef");
  });

  it("encodes legacy SchemaDef to envelope shape", () => {
    const env = module.migrateOne(legacySchemaDef()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("SchemaDef");
    expect(env.id).toBe("Idea");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
  });

  it("kind-name → envelope.name top-level + metadata.name (K8s CRD precedent)", () => {
    const env = module.migrateOne(legacySchemaDef()) as EnvelopeShape;
    expect(env.name).toBe("Idea");
    expect(env.metadata.name).toBe("Idea");
  });

  it("spec carries declared schema config (version, fields, indexes, watchable)", () => {
    const env = module.migrateOne(legacySchemaDef()) as EnvelopeShape;
    expect(env.spec.version).toBe(2);
    expect(env.spec.fields).toEqual([{ name: "text", type: "string", required: true }]);
    expect(env.spec.indexes).toEqual([{ name: "idea_status_idx", fields: ["status"] }]);
    expect(env.spec.watchable).toBe(true);
  });

  it("OQ10 deliberate-extension: status.phase='applied' injected for existing SchemaDefs", () => {
    const env = module.migrateOne(legacySchemaDef()) as EnvelopeShape;
    expect(env.status.phase).toBe("applied");
  });

  it("OQ10 deliberate-extension: status.appliedVersion mirrors spec.version", () => {
    const env = module.migrateOne(legacySchemaDef({ version: 3 })) as EnvelopeShape;
    expect(env.status.appliedVersion).toBe(3);
  });

  it("OQ10 deliberate-extension: status.lastReconciledAt is ISO timestamp", () => {
    const env = module.migrateOne(legacySchemaDef()) as EnvelopeShape;
    expect(typeof env.status.lastReconciledAt).toBe("string");
    expect((env.status.lastReconciledAt as string)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("OQ10 deliberate-extension: status.reconcileError=null at migration time", () => {
    const env = module.migrateOne(legacySchemaDef()) as EnvelopeShape;
    expect(env.status.reconcileError).toBeNull();
  });

  it("multiple SchemaDef kinds migrate independently", () => {
    const ideaEnv = module.migrateOne(legacySchemaDef({ id: "Idea", kind: "Idea", version: 2 })) as EnvelopeShape;
    const bugEnv = module.migrateOne(legacySchemaDef({ id: "Bug", kind: "Bug", version: 2 })) as EnvelopeShape;
    expect(ideaEnv.id).toBe("Idea");
    expect(ideaEnv.metadata.name).toBe("Idea");
    expect(bugEnv.id).toBe("Bug");
    expect(bugEnv.metadata.name).toBe("Bug");
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacySchemaDef()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });
});
