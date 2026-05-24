/**
 * mission-88 W3 cluster-3 — Tele migration module unit tests.
 *
 * Per cluster-3 Design v0.3 §2.2. Asserts:
 *   - Substrate-truth FSM: 3-state enum (active/superseded/retired)
 *   - name → metadata.name + envelope.name (handle-classified per §1.5)
 *   - description/successCriteria → spec (declared substantive content; immutable per Mission-43)
 *   - supersededBy/retiredAt → status (observed lineage + FSM-transition timestamp)
 *   - NO updatedAt field (A4 architect-ratified: first kind to legitimately omit updatedAt)
 *   - Idempotency reference-equality
 */

import { describe, it, expect } from "vitest";
import { createTeleMigrationModule } from "../../kinds/Tele.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const teleSchema: SchemaDef = { kind: "Tele", version: 2, fields: [], indexes: [], watchable: true };

function legacyTele(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "tele-1",
    name: "T1-Strategic-Clarity",
    description: "Strategic clarity is the asymptote.",
    successCriteria: "All strategic decisions trace to clearly-articulated rationale.",
    status: "active",
    createdBy: { role: "architect", agentId: "agent-arch" },
    createdAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

describe("Tele migration module", () => {
  const module = createTeleMigrationModule(teleSchema);

  it("declares kind=Tele", () => {
    expect(module.kind).toBe("Tele");
  });

  it("encodes legacy Tele to envelope shape", () => {
    const env = module.migrateOne(legacyTele()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("Tele");
    expect(env.id).toBe("tele-1");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
  });

  it("name → envelope.name top-level + metadata.name (handle-classified)", () => {
    const env = module.migrateOne(legacyTele()) as EnvelopeShape;
    expect(env.name).toBe("T1-Strategic-Clarity");
    expect(env.metadata.name).toBe("T1-Strategic-Clarity");
  });

  it("NO `updatedAt` in metadata (A4 precedent: immutable-content kind)", () => {
    const env = module.migrateOne(legacyTele()) as EnvelopeShape;
    expect(env.metadata.updatedAt).toBeUndefined();
  });

  it("metadata carries provenance only (no updatedAt; no lineage in metadata)", () => {
    const env = module.migrateOne(legacyTele()) as EnvelopeShape;
    expect(env.metadata.createdAt).toBe("2026-04-01T00:00:00Z");
    expect(env.metadata.createdBy).toEqual({ role: "architect", agentId: "agent-arch" });
  });

  it("spec carries declared substantive content (description + successCriteria)", () => {
    const env = module.migrateOne(legacyTele()) as EnvelopeShape;
    expect(env.spec.description).toBe("Strategic clarity is the asymptote.");
    expect(env.spec.successCriteria).toBe("All strategic decisions trace to clearly-articulated rationale.");
  });

  it("status carries FSM phase only (active by default)", () => {
    const env = module.migrateOne(legacyTele()) as EnvelopeShape;
    expect(env.status.phase).toBe("active");
    expect(env.status.supersededBy).toBeUndefined();
    expect(env.status.retiredAt).toBeUndefined();
  });

  it("supersededBy + status.phase=superseded — observed lineage", () => {
    const env = module.migrateOne(legacyTele({ status: "superseded", supersededBy: "tele-2" })) as EnvelopeShape;
    expect(env.status.phase).toBe("superseded");
    expect(env.status.supersededBy).toBe("tele-2");
  });

  it("retiredAt + status.phase=retired — terminal lifecycle", () => {
    const env = module.migrateOne(legacyTele({ status: "retired", retiredAt: "2026-05-24T00:00:00Z" })) as EnvelopeShape;
    expect(env.status.phase).toBe("retired");
    expect(env.status.retiredAt).toBe("2026-05-24T00:00:00Z");
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacyTele()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });
});
