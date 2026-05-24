/**
 * mission-88 W5 cluster-5 — DirectorHistoryEntry migration module unit tests.
 */

import { describe, it, expect } from "vitest";
import { createDirectorHistoryEntryMigrationModule } from "../../kinds/DirectorHistoryEntry.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const dhSchema: SchemaDef = { kind: "DirectorHistoryEntry", version: 2, fields: [], indexes: [], watchable: true };

function legacyDH(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "dh-200",
    role: "user",
    text: "Director chat message body",
    timestamp: "2026-05-24T04:30:00Z",
    ...overrides,
  };
}

describe("DirectorHistoryEntry migration module", () => {
  const module = createDirectorHistoryEntryMigrationModule(dhSchema);

  it("declares kind=DirectorHistoryEntry", () => {
    expect(module.kind).toBe("DirectorHistoryEntry");
  });

  it("encodes legacy DirectorHistoryEntry to envelope shape", () => {
    const env = module.migrateOne(legacyDH()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("DirectorHistoryEntry");
    expect(env.id).toBe("dh-200");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
  });

  it("timestamp → metadata.createdAt", () => {
    const env = module.migrateOne(legacyDH()) as EnvelopeShape;
    expect(env.metadata.createdAt).toBe("2026-05-24T04:30:00Z");
  });

  it("NO updatedAt (append-only immutable-content)", () => {
    const env = module.migrateOne(legacyDH()) as EnvelopeShape;
    expect(env.metadata.updatedAt).toBeUndefined();
  });

  it("spec carries declared LLM-conversation role + text body (OQ8 distinction)", () => {
    const env = module.migrateOne(legacyDH()) as EnvelopeShape;
    expect(env.spec.role).toBe("user");
    expect(env.spec.text).toBe("Director chat message body");
  });

  it("preserves both role enums (user / model)", () => {
    expect((module.migrateOne(legacyDH({ role: "user" })) as EnvelopeShape).spec.role).toBe("user");
    expect((module.migrateOne(legacyDH({ role: "model" })) as EnvelopeShape).spec.role).toBe("model");
  });

  it('status.phase: "logged" constant', () => {
    const env = module.migrateOne(legacyDH()) as EnvelopeShape;
    expect(env.status.phase).toBe("logged");
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacyDH()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });
});
