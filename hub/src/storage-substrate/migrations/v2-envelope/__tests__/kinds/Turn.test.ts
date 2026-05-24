/**
 * mission-88 W2 cluster-2 — Turn migration module unit tests.
 *
 * Per cluster-2 Design v0.3 §2.3. Asserts:
 *   - Substrate-truth FSM: 3-state enum (planning/active/completed)
 *   - title → metadata.name (FIRST cluster-2 kind to use handle-classified pattern
 *     per §1.5; also sets envelope.name top-level for substrate-API ergonomic)
 *   - scope → spec (substantive markdown content; Mission.goal precedent)
 *   - tele[] → spec (declared teleological references)
 *   - missionIds/taskIds → DROPPED (virtual-hydrated per Mission precedent)
 *   - Idempotency reference-equality
 */

import { describe, it, expect } from "vitest";
import { createTurnMigrationModule } from "../../kinds/Turn.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const turnSchema: SchemaDef = { kind: "Turn", version: 2, fields: [], indexes: [], watchable: true };

function legacyTurn(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "turn-1",
    title: "Mission-88 W2 cluster-2",
    scope: "Migrate Task/PendingAction/Turn to envelope shape per cluster-2 Design v0.3",
    status: "active",
    missionIds: [],  // virtual-hydrated at read-time; envelope must OMIT
    taskIds: [],     // virtual-hydrated; envelope must OMIT
    tele: ["tele-1", "tele-2"],
    correlationId: "turn-1",
    createdBy: { role: "engineer", agentId: "agent-greg" },
    createdAt: "2026-05-24T03:00:00Z",
    updatedAt: "2026-05-24T03:30:00Z",
    ...overrides,
  };
}

describe("Turn migration module", () => {
  const module = createTurnMigrationModule(turnSchema);

  it("declares kind=Turn", () => {
    expect(module.kind).toBe("Turn");
  });

  it("encodes legacy Turn to envelope shape", () => {
    const env = module.migrateOne(legacyTurn()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("Turn");
    expect(env.id).toBe("turn-1");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
  });

  it("title → envelope.name top-level AND metadata.name (handle-classified §1.5)", () => {
    const env = module.migrateOne(legacyTurn()) as EnvelopeShape;
    expect(env.name).toBe("Mission-88 W2 cluster-2");          // top-level ergonomic
    expect(env.metadata.name).toBe("Mission-88 W2 cluster-2"); // K8s-canonical handle
  });

  it("DROPS missionIds + taskIds (virtual-hydrated; envelope omits)", () => {
    const env = module.migrateOne(legacyTurn({ missionIds: ["mission-88"], taskIds: ["task-1", "task-2"] })) as EnvelopeShape;
    expect(env.metadata.missionIds).toBeUndefined();
    expect(env.spec.missionIds).toBeUndefined();
    expect(env.status.missionIds).toBeUndefined();
    expect(env.metadata.taskIds).toBeUndefined();
    expect(env.spec.taskIds).toBeUndefined();
    expect(env.status.taskIds).toBeUndefined();
  });

  it("metadata carries identity + provenance + correlationId", () => {
    const env = module.migrateOne(legacyTurn()) as EnvelopeShape;
    expect(env.metadata.createdAt).toBe("2026-05-24T03:00:00Z");
    expect(env.metadata.updatedAt).toBe("2026-05-24T03:30:00Z");
    expect(env.metadata.correlationId).toBe("turn-1");
    expect(env.metadata.createdBy).toEqual({ role: "engineer", agentId: "agent-greg" });
  });

  it("spec carries declared scope + tele references", () => {
    const env = module.migrateOne(legacyTurn()) as EnvelopeShape;
    expect(env.spec.scope).toBe("Migrate Task/PendingAction/Turn to envelope shape per cluster-2 Design v0.3");
    expect(env.spec.tele).toEqual(["tele-1", "tele-2"]);
  });

  it("status carries FSM phase only (single-FSM monolithic per Q3)", () => {
    const env = module.migrateOne(legacyTurn({ status: "planning" })) as EnvelopeShape;
    expect(env.status.phase).toBe("planning");
  });

  it("FSM substrate-truth: all 3 states map to status.phase", () => {
    for (const s of ["planning", "active", "completed"]) {
      const env = module.migrateOne(legacyTurn({ status: s })) as EnvelopeShape;
      expect(env.status.phase).toBe(s);
    }
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacyTurn()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });
});
