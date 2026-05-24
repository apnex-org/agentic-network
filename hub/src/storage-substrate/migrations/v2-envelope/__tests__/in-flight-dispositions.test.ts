/**
 * mission-88 W2 cluster-2 — OQ11 in-flight disposition tests.
 *
 * Per thread-644 R2 architect-ratified Q4(a)/(b)/(c). Tests isolate the
 * flag-mechanism + runner-integration; runtime cutover behavior (W6 strict-flip
 * + production sweeper/writer integration) exercises beyond W2 acceptance.
 *
 * Q4(a) PendingAction-sweeper PAUSE: env-var flag mechanism;
 *   runner sets/clears at runKind boundary; consumer (sweeper) reads
 *   isMigrationInProgress("PendingAction") at tick-start to skip.
 *
 * Q4(b) Turn TOLERANT-shape on read: module's migrateOne handles dual-shape
 *   inputs via isEnvelopeShape probe (legacy → encode; envelope → return as-is);
 *   wire-flow.test.ts cluster-2 batch case exercises substrate-stored dual rows.
 *
 * Q4(c) Task WRITE-FREEZE: env-var flag mechanism + MigrationInProgressError
 *   marker class; consumers (writers) check the flag and throw the error.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  setMigrationFlag,
  clearMigrationFlag,
  isMigrationInProgress,
  MigrationInProgressError,
} from "../shared/migration-flag.js";
import { createTaskMigrationModule } from "../kinds/Task.js";
import { createPendingActionMigrationModule } from "../kinds/PendingAction.js";
import { createTurnMigrationModule } from "../kinds/Turn.js";
import { isEnvelopeShape, type EnvelopeShape } from "../shared/envelope.js";
import type { SchemaDef } from "../../../types.js";

const mkSchema = (kind: string): SchemaDef => ({ kind, version: 2, fields: [], indexes: [], watchable: true });

// Use kinds that aren't likely to collide with parallel test files
const KIND_TASK = "TaskW2Test";
const KIND_PA = "PendingActionW2Test";
const KIND_TURN = "TurnW2Test";

beforeEach(() => {
  clearMigrationFlag(KIND_TASK);
  clearMigrationFlag(KIND_PA);
  clearMigrationFlag(KIND_TURN);
});

afterEach(() => {
  clearMigrationFlag(KIND_TASK);
  clearMigrationFlag(KIND_PA);
  clearMigrationFlag(KIND_TURN);
});

describe("Q4(a)+(c) — MIGRATION_IN_PROGRESS env-var flag mechanism", () => {
  it("setMigrationFlag + isMigrationInProgress: flag set → check returns true", () => {
    expect(isMigrationInProgress(KIND_TASK)).toBe(false);
    setMigrationFlag(KIND_TASK);
    expect(isMigrationInProgress(KIND_TASK)).toBe(true);
  });

  it("clearMigrationFlag: flag cleared → check returns false", () => {
    setMigrationFlag(KIND_TASK);
    expect(isMigrationInProgress(KIND_TASK)).toBe(true);
    clearMigrationFlag(KIND_TASK);
    expect(isMigrationInProgress(KIND_TASK)).toBe(false);
  });

  it("per-kind isolation: setting flag on one kind doesn't affect another", () => {
    setMigrationFlag(KIND_TASK);
    expect(isMigrationInProgress(KIND_TASK)).toBe(true);
    expect(isMigrationInProgress(KIND_PA)).toBe(false);
    expect(isMigrationInProgress(KIND_TURN)).toBe(false);
  });

  it("idempotent: setMigrationFlag called twice; clearMigrationFlag called twice", () => {
    setMigrationFlag(KIND_TASK);
    setMigrationFlag(KIND_TASK);
    expect(isMigrationInProgress(KIND_TASK)).toBe(true);
    clearMigrationFlag(KIND_TASK);
    clearMigrationFlag(KIND_TASK);
    expect(isMigrationInProgress(KIND_TASK)).toBe(false);
  });

  it("env-var name follows MIGRATION_IN_PROGRESS_<KIND> convention", () => {
    setMigrationFlag(KIND_TASK);
    expect(process.env[`MIGRATION_IN_PROGRESS_${KIND_TASK}`]).toBe("true");
    clearMigrationFlag(KIND_TASK);
    expect(process.env[`MIGRATION_IN_PROGRESS_${KIND_TASK}`]).toBeUndefined();
  });
});

describe("Q4(c) — MigrationInProgressError marker class", () => {
  it("error has name MigrationInProgressError + kind property", () => {
    const err = new MigrationInProgressError("Task");
    expect(err.name).toBe("MigrationInProgressError");
    expect(err.kind).toBe("Task");
    expect(err.message).toContain("MIGRATION_IN_PROGRESS");
    expect(err.message).toContain("Task");
  });

  it("error is an instance of Error + MigrationInProgressError", () => {
    const err = new MigrationInProgressError("PendingAction");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MigrationInProgressError);
  });

  it("simulated writer pattern: check flag + throw marker error", () => {
    const fakeWrite = (kind: string): void => {
      if (isMigrationInProgress(kind)) {
        throw new MigrationInProgressError(kind);
      }
    };

    expect(() => fakeWrite(KIND_TASK)).not.toThrow();
    setMigrationFlag(KIND_TASK);
    expect(() => fakeWrite(KIND_TASK)).toThrow(MigrationInProgressError);
    expect(() => fakeWrite(KIND_TASK)).toThrow(/MIGRATION_IN_PROGRESS/);
  });

  it("simulated sweeper pattern: check flag + skip-tick when set", () => {
    let tickCount = 0;
    const fakeSweeperTick = (kind: string): "tick" | "skipped" => {
      if (isMigrationInProgress(kind)) return "skipped";
      tickCount++;
      return "tick";
    };

    expect(fakeSweeperTick(KIND_PA)).toBe("tick");
    expect(tickCount).toBe(1);

    setMigrationFlag(KIND_PA);
    expect(fakeSweeperTick(KIND_PA)).toBe("skipped");
    expect(tickCount).toBe(1);  // tick was skipped

    clearMigrationFlag(KIND_PA);
    expect(fakeSweeperTick(KIND_PA)).toBe("tick");
    expect(tickCount).toBe(2);
  });
});

describe("Q4(b) — Turn TOLERANT-shape on read (module dual-shape handling)", () => {
  const turnModule = createTurnMigrationModule(mkSchema("Turn"));

  function legacyTurn(): Record<string, unknown> {
    return {
      id: "turn-W2",
      title: "Dual-shape test",
      scope: "Tolerant-read verification",
      status: "active",
      missionIds: [],
      taskIds: [],
      tele: [],
      correlationId: "turn-W2",
      createdBy: { role: "engineer", agentId: "agent-greg" },
      createdAt: "2026-05-24T03:00:00Z",
      updatedAt: "2026-05-24T03:00:00Z",
    };
  }

  it("migrateOne(legacy) → envelope; migrateOne(envelope) → same envelope (idempotent dual-shape)", () => {
    const legacy = legacyTurn();
    const env1 = turnModule.migrateOne(legacy) as EnvelopeShape;
    expect(isEnvelopeShape(env1)).toBe(true);

    // Re-invoke with envelope: must return identical reference (idempotency)
    const env2 = turnModule.migrateOne(env1);
    expect(env2).toBe(env1);
  });

  it("dual-row: legacy + envelope sources both produce equivalent envelope outputs", () => {
    const legacy = legacyTurn();
    const envFromLegacy = turnModule.migrateOne(legacy) as EnvelopeShape;
    const envFromEnvelope = turnModule.migrateOne(envFromLegacy) as EnvelopeShape;

    // Both reach the same envelope-shape; envFromLegacy must equal envFromEnvelope
    expect(envFromLegacy.id).toBe(envFromEnvelope.id);
    expect(envFromLegacy.kind).toBe(envFromEnvelope.kind);
    expect(envFromLegacy.apiVersion).toBe(envFromEnvelope.apiVersion);
    expect(envFromLegacy.metadata).toEqual(envFromEnvelope.metadata);
    expect(envFromLegacy.spec).toEqual(envFromEnvelope.spec);
    expect(envFromLegacy.status).toEqual(envFromEnvelope.status);
  });

  it("all 3 cluster-2 kinds handle dual-shape uniformly (module-level tolerant-read)", () => {
    const taskModule = createTaskMigrationModule(mkSchema("Task"));
    const paModule = createPendingActionMigrationModule(mkSchema("PendingAction"));

    const taskLegacy = { id: "task-W2", directive: "test", status: "pending", createdAt: "2026-05-24T00:00:00Z", labels: {}, dependsOn: [], revisionCount: 0 };
    const paLegacy = { id: "pa-2026-05-24T00-00-00-000Z-1", targetAgentId: "agent-1", dispatchType: "thread_message", entityRef: "thread-1", naturalKey: "agent-1:thread-1:thread_message", payload: {}, enqueuedAt: "2026-05-24T00:00:00Z", receiptDeadline: "2026-05-24T00:00:30Z", completionDeadline: "2026-05-24T00:05:00Z", receiptAckedAt: null, completionAckedAt: null, attemptCount: 0, lastAttemptAt: null, state: "enqueued", escalationReason: null };

    for (const [name, module, legacy] of [
      ["Task", taskModule, taskLegacy],
      ["PendingAction", paModule, paLegacy],
      ["Turn", turnModule, legacyTurn()],
    ] as const) {
      const env1 = module.migrateOne(legacy) as EnvelopeShape;
      const env2 = module.migrateOne(env1);
      expect(isEnvelopeShape(env1), `${name} encoded`).toBe(true);
      expect(env2, `${name} idempotent`).toBe(env1);
    }
  });
});
