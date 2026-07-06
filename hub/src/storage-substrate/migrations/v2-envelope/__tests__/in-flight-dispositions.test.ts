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
 * Q4(b) Turn TOLERANT-shape on read: RETIRED with the Task/Turn subsystem
 *   (work-162 A1) — the module dual-shape parity is now covered generically by
 *   surviving kinds; the Turn/Task-specific module cases are deleted.
 *
 * Q4(c) Task WRITE-FREEZE: env-var flag mechanism + MigrationInProgressError
 *   marker class; consumers (writers) check the flag and throw the error.
 *   (The flag mechanism itself is kind-agnostic — exercised here with generic
 *   test-kind labels, independent of the retired Task/Turn modules.)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  setMigrationFlag,
  clearMigrationFlag,
  isMigrationInProgress,
  MigrationInProgressError,
} from "../shared/migration-flag.js";

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

// work-162 (A1): the Q4(b) Turn TOLERANT-shape describe block (Turn/Task
// module dual-shape parity) is RETIRED with the Task/Turn migration modules.
// PendingAction (the surviving cluster-2 kind) retains its dual-shape coverage
// in wire-flow.test.ts.
