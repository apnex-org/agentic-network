/**
 * mission-88 W2 cluster-2 — Task migration module unit tests.
 *
 * Per cluster-2 Design v0.3 §2.1. Asserts:
 *   - Substrate-truth FSM: 9-state enum (pending/working/blocked/input_required/
 *     in_review/completed/failed/escalated/cancelled)
 *   - labels:Record<string,string> already-shaped (no tags-array transform)
 *   - sourceThreadSummary → metadata.annotations
 *   - directive immutability via spec partition (declared-immutable class)
 *   - assignedAgentId in spec (declared-with-controlled-mutation per PodSpec.nodeName)
 *   - report/review/clarification fields in status (observed-FSM-mutated)
 *   - Idempotency reference-equality
 */

import { describe, it, expect } from "vitest";
import { createTaskMigrationModule } from "../../kinds/Task.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const taskSchema: SchemaDef = { kind: "Task", version: 2, fields: [], indexes: [], watchable: true };

function legacyTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "task-1",
    directive: "Implement W2 cluster-2 envelope migration",
    report: null,
    reportSummary: null,
    reportRef: null,
    verification: null,
    reviewAssessment: null,
    reviewRef: null,
    assignedAgentId: "agent-greg",
    clarificationQuestion: null,
    clarificationAnswer: null,
    correlationId: "mission-88",
    idempotencyKey: null,
    title: "W2 cluster-2",
    description: "Task/PendingAction/Turn KindMigrationModule",
    dependsOn: [],
    revisionCount: 0,
    status: "working",
    labels: { class: "implementation" },
    turnId: "turn-1",
    sourceThreadId: "thread-644",
    sourceActionId: "action-1",
    sourceThreadSummary: "W2 Design-pass converged",
    createdBy: { role: "engineer", agentId: "agent-greg" },
    createdAt: "2026-05-24T03:30:00Z",
    updatedAt: "2026-05-24T03:35:00Z",
    ...overrides,
  };
}

describe("Task migration module", () => {
  const module = createTaskMigrationModule(taskSchema);

  it("declares kind=Task", () => {
    expect(module.kind).toBe("Task");
  });

  it("encodes legacy Task to envelope shape", () => {
    const env = module.migrateOne(legacyTask()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("Task");
    expect(env.id).toBe("task-1");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
  });

  it("name OMITTED — content-classified; envelope.name defaults to id", () => {
    const env = module.migrateOne(legacyTask()) as EnvelopeShape;
    expect(env.name).toBe("task-1");  // default to id (content-classified per §1.5)
  });

  it("sourceThreadSummary → metadata.annotations", () => {
    const env = module.migrateOne(legacyTask()) as EnvelopeShape;
    expect(env.metadata.annotations).toEqual({
      "ois.io/sourceThreadSummary": "W2 Design-pass converged",
    });
  });

  it("metadata carries identity + provenance + labels + turnId", () => {
    const env = module.migrateOne(legacyTask()) as EnvelopeShape;
    expect(env.metadata.createdAt).toBe("2026-05-24T03:30:00Z");
    expect(env.metadata.updatedAt).toBe("2026-05-24T03:35:00Z");
    expect(env.metadata.sourceThreadId).toBe("thread-644");
    expect(env.metadata.sourceActionId).toBe("action-1");
    expect(env.metadata.correlationId).toBe("mission-88");
    expect(env.metadata.turnId).toBe("turn-1");
    expect(env.metadata.labels).toEqual({ class: "implementation" });
    expect(env.metadata.revisionCount).toBe(0);
  });

  it("spec carries declared content + declared-with-controlled-mutation fields", () => {
    const env = module.migrateOne(legacyTask()) as EnvelopeShape;
    expect(env.spec.directive).toBe("Implement W2 cluster-2 envelope migration");
    expect(env.spec.title).toBe("W2 cluster-2");
    expect(env.spec.description).toBe("Task/PendingAction/Turn KindMigrationModule");
    expect(env.spec.dependsOn).toEqual([]);
    expect(env.spec.assignedAgentId).toBe("agent-greg");
  });

  it("status carries FSM phase + observed report/review/clarification fields", () => {
    const env = module.migrateOne(legacyTask({
      status: "in_review",
      report: "Done; tests pass",
      reportSummary: "Tests pass",
      verification: "tsc-strict + vitest 78 tests",
      reviewAssessment: "approved",
    })) as EnvelopeShape;
    expect(env.status.phase).toBe("in_review");
    expect(env.status.report).toBe("Done; tests pass");
    expect(env.status.reportSummary).toBe("Tests pass");
    expect(env.status.verification).toBe("tsc-strict + vitest 78 tests");
    expect(env.status.reviewAssessment).toBe("approved");
  });

  it("FSM substrate-truth: all 9 states map to status.phase", () => {
    const states = ["pending", "working", "blocked", "input_required", "in_review", "completed", "failed", "escalated", "cancelled"];
    for (const s of states) {
      const env = module.migrateOne(legacyTask({ status: s })) as EnvelopeShape;
      expect(env.status.phase).toBe(s);
    }
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacyTask()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });
});
