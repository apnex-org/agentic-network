/**
 * mission-88 W4 cluster-4 — RepoEventBridgeDedupe migration module unit tests.
 *
 * Per cluster-4 Design v0.3 §2.4. Sibling of RepoEventBridgeCursor; same shape;
 * differing only in rename target (body → status.dedupe instead of status.cursor).
 */

import { describe, it, expect } from "vitest";
import { createRepoEventBridgeDedupeMigrationModule } from "../../kinds/RepoEventBridgeDedupe.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const dedupeSchema: SchemaDef = { kind: "RepoEventBridgeDedupe", version: 2, fields: [], indexes: [], watchable: false };

function legacyDedupe(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "apnex-org__agentic-network",
    body: { lru: ["delivery-id-1", "delivery-id-2", "delivery-id-3"], max_size: 1000 },
    ...overrides,
  };
}

describe("RepoEventBridgeDedupe migration module", () => {
  const module = createRepoEventBridgeDedupeMigrationModule(dedupeSchema);

  it("declares kind=RepoEventBridgeDedupe", () => {
    expect(module.kind).toBe("RepoEventBridgeDedupe");
  });

  it("encodes legacy Dedupe to envelope shape", () => {
    const env = module.migrateOne(legacyDedupe()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("RepoEventBridgeDedupe");
    expect(env.id).toBe("apnex-org__agentic-network");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
  });

  it("body → status.dedupe (opaque dedupe-LRU JSON preserved; differs from Cursor's status.cursor)", () => {
    const env = module.migrateOne(legacyDedupe()) as EnvelopeShape;
    expect(env.status.dedupe).toEqual({ lru: ["delivery-id-1", "delivery-id-2", "delivery-id-3"], max_size: 1000 });
    // Verify NOT status.cursor (sibling-kind separation)
    expect(env.status.cursor).toBeUndefined();
  });

  it('status.phase: "active" constant', () => {
    const env = module.migrateOne(legacyDedupe()) as EnvelopeShape;
    expect(env.status.phase).toBe("active");
  });

  it("spec is empty (uniformity)", () => {
    const env = module.migrateOne(legacyDedupe()) as EnvelopeShape;
    expect(env.spec).toEqual({});
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacyDedupe()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });
});
