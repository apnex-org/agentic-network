/**
 * mission-88 W1 cluster-1 — Mission migration module unit tests.
 *
 * Per Q3 + cluster-1 Design v0.3 §3.4. Asserts:
 *   - Substrate-truth FSM: proposed/active/completed/abandoned (NOT cancelled)
 *   - Mission.tasks + Mission.ideas virtual-hydrated → envelope OMITS them
 *   - Mission.pulses MONOLITHIC in status (architect-ratified disposition)
 *   - sourceThreadSummary → metadata.annotations
 *   - Idempotency reference-equality
 */

import { describe, it, expect } from "vitest";
import { createMissionMigrationModule } from "../../kinds/Mission.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const missionSchema: SchemaDef = {
  kind: "Mission",
  version: 2,
  fields: [],
  indexes: [],
  watchable: true,
};

function legacyMission(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "mission-88",
    title: "M-K8s-Envelope",
    description: "Substrate-wide K8s envelope upgrade",
    documentRef: "docs/missions/m-k8s-envelope.md",
    status: "active",
    tasks: [],   // virtual-hydrated at read-time; envelope must OMIT
    ideas: [],   // virtual-hydrated; envelope must OMIT
    correlationId: "mission-88",
    turnId: null,
    sourceThreadId: "thread-635",
    sourceActionId: "action-1",
    sourceThreadSummary: "Phase 5 Manifest bilateral converged",
    createdBy: { role: "architect", agentId: "agent-lily" },
    plannedTasks: [
      { sequence: 1, title: "W0 substrate-prep", description: "...", status: "completed", issuedTaskId: "task-500" },
      { sequence: 2, title: "W1 cluster-1", description: "...", status: "issued", issuedTaskId: "task-501" },
    ],
    missionClass: "substrate-introduction",
    pulses: {
      engineerPulse: { intervalSeconds: 1800, message: "...", responseShape: "short_status", missedThreshold: 2, firstFireDelaySeconds: 1800, lastFiredAt: "2026-05-24T00:00:00Z" },
      architectPulse: { intervalSeconds: 1800, message: "...", responseShape: "short_status", missedThreshold: 2, firstFireDelaySeconds: 1800 },
    },
    createdAt: "2026-05-24T00:06:19Z",
    updatedAt: "2026-05-24T01:02:45Z",
    ...overrides,
  };
}

describe("Mission migration module", () => {
  const module = createMissionMigrationModule(missionSchema);

  it("declares kind=Mission", () => {
    expect(module.kind).toBe("Mission");
  });

  it("encodes legacy Mission to envelope shape", () => {
    const env = module.migrateOne(legacyMission()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("Mission");
    expect(env.id).toBe("mission-88");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
  });

  it("DROPS tasks (virtual-hydrated; not persisted in envelope)", () => {
    const env = module.migrateOne(legacyMission()) as EnvelopeShape;
    expect(env.metadata.tasks).toBeUndefined();
    expect(env.spec.tasks).toBeUndefined();
    expect(env.status.tasks).toBeUndefined();
  });

  it("DROPS ideas (virtual-hydrated; not persisted in envelope)", () => {
    const env = module.migrateOne(legacyMission()) as EnvelopeShape;
    expect(env.metadata.ideas).toBeUndefined();
    expect(env.spec.ideas).toBeUndefined();
    expect(env.status.ideas).toBeUndefined();
  });

  it("metadata carries provenance + correlationId + annotations", () => {
    const env = module.migrateOne(legacyMission()) as EnvelopeShape;
    expect(env.metadata.sourceThreadId).toBe("thread-635");
    expect(env.metadata.sourceActionId).toBe("action-1");
    expect(env.metadata.correlationId).toBe("mission-88");
    expect(env.metadata.annotations).toEqual({
      "ois.io/sourceThreadSummary": "Phase 5 Manifest bilateral converged",
    });
  });

  it("spec carries title + description + documentRef + missionClass + plannedTasks", () => {
    const env = module.migrateOne(legacyMission()) as EnvelopeShape;
    expect(env.spec.title).toBe("M-K8s-Envelope");
    expect(env.spec.description).toBe("Substrate-wide K8s envelope upgrade");
    expect(env.spec.documentRef).toBe("docs/missions/m-k8s-envelope.md");
    expect(env.spec.missionClass).toBe("substrate-introduction");
    expect(env.spec.plannedTasks).toBeInstanceOf(Array);
    expect((env.spec.plannedTasks as unknown[]).length).toBe(2);
  });

  it("status carries FSM phase + turnId + monolithic pulses", () => {
    const env = module.migrateOne(legacyMission()) as EnvelopeShape;
    expect(env.status.phase).toBe("active");
    expect(env.status.turnId).toBe(null);
    expect(env.status.pulses).toBeDefined();
    const pulses = env.status.pulses as Record<string, unknown>;
    expect(pulses.engineerPulse).toBeDefined();
    expect(pulses.architectPulse).toBeDefined();
  });

  it("FSM substrate-truth: abandoned (not 'cancelled' per Design v0.2)", () => {
    const env = module.migrateOne(legacyMission({ status: "abandoned" })) as EnvelopeShape;
    expect(env.status.phase).toBe("abandoned");
  });

  it("plannedTasks[].issuedTaskId IS intrinsic per-slot (no synthetic issuedTaskIds[] envelope field)", () => {
    const env = module.migrateOne(legacyMission()) as EnvelopeShape;
    const tasks = env.spec.plannedTasks as Array<{ issuedTaskId?: string }>;
    expect(tasks[0].issuedTaskId).toBe("task-500");
    expect(tasks[1].issuedTaskId).toBe("task-501");
    // No synthetic envelope-level issuedTaskIds array
    expect(env.status.issuedTaskIds).toBeUndefined();
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacyMission()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });
});
