/**
 * mission-88 W4 cluster-4 — RepoEventBridgeCursor migration module unit tests.
 *
 * Per cluster-4 Design v0.3 §2.3. Asserts:
 *   - id = `<owner>__<repo>` natural-key preserved
 *   - body → status.cursor renameMap (opaque cursor-store JSON preserved)
 *   - spec: {} (uniformity; no declared-intent)
 *   - status.phase: "active" constant (uniformity; bookkeeping kind; no FSM)
 *   - name OMITTED (per-repo plural meta-entity)
 *   - Idempotency reference-equality
 */

import { describe, it, expect } from "vitest";
import { createRepoEventBridgeCursorMigrationModule } from "../../kinds/RepoEventBridgeCursor.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const cursorSchema: SchemaDef = { kind: "RepoEventBridgeCursor", version: 2, fields: [], indexes: [], watchable: false };

function legacyCursor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "apnex-org__agentic-network",
    body: { last_etag: "abc123", last_event_id: "12345", seen: ["evt-1", "evt-2"] },
    ...overrides,
  };
}

describe("RepoEventBridgeCursor migration module", () => {
  const module = createRepoEventBridgeCursorMigrationModule(cursorSchema);

  it("declares kind=RepoEventBridgeCursor", () => {
    expect(module.kind).toBe("RepoEventBridgeCursor");
  });

  it("encodes legacy Cursor to envelope shape", () => {
    const env = module.migrateOne(legacyCursor()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("RepoEventBridgeCursor");
    expect(env.id).toBe("apnex-org__agentic-network");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
  });

  it("body → status.cursor (opaque cursor-store JSON preserved)", () => {
    const env = module.migrateOne(legacyCursor()) as EnvelopeShape;
    expect(env.status.cursor).toEqual({ last_etag: "abc123", last_event_id: "12345", seen: ["evt-1", "evt-2"] });
  });

  it('status.phase: "active" constant', () => {
    const env = module.migrateOne(legacyCursor()) as EnvelopeShape;
    expect(env.status.phase).toBe("active");
  });

  it("spec is empty (uniformity)", () => {
    const env = module.migrateOne(legacyCursor()) as EnvelopeShape;
    expect(env.spec).toEqual({});
  });

  it("metadata is empty (no createdAt/createdBy on legacy Cursor)", () => {
    const env = module.migrateOne(legacyCursor()) as EnvelopeShape;
    expect(env.metadata).toEqual({});
  });

  it("name defaults to id (per-repo plural meta-entity; no explicit handle)", () => {
    const env = module.migrateOne(legacyCursor()) as EnvelopeShape;
    expect(env.name).toBe("apnex-org__agentic-network");
  });

  it("opaque body preservation: arbitrary cursor-store JSON shape through migration", () => {
    const arbitrary = { foo: "bar", nested: { x: 1, y: [1, 2, 3] }, list: ["a", "b"] };
    const env = module.migrateOne(legacyCursor({ body: arbitrary })) as EnvelopeShape;
    expect(env.status.cursor).toEqual(arbitrary);
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacyCursor()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });
});
