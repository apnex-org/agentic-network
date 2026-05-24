/**
 * mission-88 W5 cluster-5 — Document migration module unit tests.
 *
 * Per cluster-5 Design v0.3 §2.1. Asserts:
 *   - name = legacy.id (file-stem convention per A2)
 *   - category → metadata.labels.category CONTENT-classification axis first-use per Q3
 *   - content → spec
 *   - status.phase: "active" constant (mostly-static; uniformity)
 *   - Idempotency reference-equality
 */

import { describe, it, expect } from "vitest";
import { createDocumentMigrationModule } from "../../kinds/Document.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const docSchema: SchemaDef = { kind: "Document", version: 2, fields: [], indexes: [], watchable: true };

function legacyDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "policy-network-v1-draft",
    category: "architecture",
    content: "# Policy Network v1 Draft\n\nMarkdown content body.",
    ...overrides,
  };
}

describe("Document migration module", () => {
  const module = createDocumentMigrationModule(docSchema);

  it("declares kind=Document", () => {
    expect(module.kind).toBe("Document");
  });

  it("encodes legacy Document to envelope shape", () => {
    const env = module.migrateOne(legacyDocument()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("Document");
    expect(env.id).toBe("policy-network-v1-draft");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
  });

  it("A2: name = legacy.id (file-stem convention per handle-classified §1.5)", () => {
    const env = module.migrateOne(legacyDocument()) as EnvelopeShape;
    expect(env.name).toBe("policy-network-v1-draft");
  });

  it("Q3 CONTENT-classification: category → metadata.labels.category (cluster-3 §5 6th cumulative-pattern first-instance)", () => {
    const env = module.migrateOne(legacyDocument()) as EnvelopeShape;
    expect(env.metadata.labels).toEqual({ category: "architecture" });
    // category top-level removed (renamed via pre-transform)
    expect(env.metadata.category).toBeUndefined();
    expect(env.spec.category).toBeUndefined();
  });

  it("spec carries declared substantive markdown content", () => {
    const env = module.migrateOne(legacyDocument()) as EnvelopeShape;
    expect(env.spec.content).toBe("# Policy Network v1 Draft\n\nMarkdown content body.");
  });

  it('status.phase: "active" constant (mostly-static; no real FSM; Q4 disposition)', () => {
    const env = module.migrateOne(legacyDocument()) as EnvelopeShape;
    expect(env.status.phase).toBe("active");
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacyDocument()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });

  it("preserves all 3 well-known category enums (architecture/planning/specs)", () => {
    for (const c of ["architecture", "planning", "specs"]) {
      const env = module.migrateOne(legacyDocument({ category: c })) as EnvelopeShape;
      expect((env.metadata.labels as Record<string, string>).category).toBe(c);
    }
  });

  it("omits labels when category is absent (no labels-injection on null)", () => {
    const legacy = { id: "no-category-doc", content: "body" } as Record<string, unknown>;
    const env = module.migrateOne(legacy) as EnvelopeShape;
    expect(env.metadata.labels).toBeUndefined();
  });
});
