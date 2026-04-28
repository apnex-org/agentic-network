/**
 * Mission-19 — Task claim enforcement via labels.
 *
 * Covers: taskClaimableBy truth table, get_task rejects mismatched claimants,
 * unlabeled Task is open to anyone, unlabeled Agent blocked from labeled Tasks,
 * assignedEngineerId persisted on claim.
 *
 * Registry invariants: INV-T14, INV-T15, INV-SYS-L07.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { taskClaimableBy } from "../../src/state.js";
import { TaskRepository } from "../../src/entities/task-repository.js";
import { StorageBackedCounter } from "../../src/entities/counter.js";
import { MemoryStorageProvider } from "@apnex/storage-provider";

describe("Mission-19 Claim — taskClaimableBy helper", () => {
  it("unlabeled task is claimable by anyone (even unlabeled claimant)", () => {
    expect(taskClaimableBy({})).toBe(true);
    expect(taskClaimableBy({}, undefined)).toBe(true);
    expect(taskClaimableBy({}, {})).toBe(true);
    expect(taskClaimableBy({}, { team: "platform" })).toBe(true);
  });

  it("labeled task is NOT claimable by an unlabeled claimant (INV-SYS-L07)", () => {
    expect(taskClaimableBy({ team: "platform" }, undefined)).toBe(false);
    expect(taskClaimableBy({ team: "platform" }, {})).toBe(false);
  });

  it("claimant labels must be a superset of task labels", () => {
    // Exact match
    expect(taskClaimableBy({ team: "platform" }, { team: "platform" })).toBe(true);
    // Superset
    expect(taskClaimableBy({ team: "platform" }, { team: "platform", env: "prod" })).toBe(true);
    // Missing a key
    expect(taskClaimableBy({ team: "platform", env: "prod" }, { team: "platform" })).toBe(false);
    // Value mismatch
    expect(taskClaimableBy({ team: "platform" }, { team: "network" })).toBe(false);
  });
});

describe("Mission-19 Claim — getNextDirective enforces labels", () => {
  let store: TaskRepository;

  beforeEach(() => {
    const provider = new MemoryStorageProvider();
    const counter = new StorageBackedCounter(provider);
    store = new TaskRepository(provider, counter);
  });

  it("claim records assignedEngineerId (INV-T15)", async () => {
    const taskId = await store.submitDirective(
      "Do thing",
      undefined, undefined, "T", "D", undefined,
      { team: "platform" },
    );

    const claimed = await store.getNextDirective({
      agentId: "eng-abc",
      labels: { team: "platform" },
    });

    expect(claimed?.id).toBe(taskId);
    expect(claimed?.assignedEngineerId).toBe("eng-abc");

    const persisted = await store.getTask(taskId);
    expect(persisted?.assignedEngineerId).toBe("eng-abc");
    expect(persisted?.status).toBe("working");
  });

  it("claimant without required labels skips the task (INV-T14)", async () => {
    await store.submitDirective(
      "Platform-only task",
      undefined, undefined, "T", "D", undefined,
      { team: "platform" },
    );

    const miss = await store.getNextDirective({
      agentId: "eng-xyz",
      labels: { team: "network" },
    });
    expect(miss).toBeNull();

    const hit = await store.getNextDirective({
      agentId: "eng-abc",
      labels: { team: "platform" },
    });
    expect(hit).not.toBeNull();
  });

  it("unlabeled claimant cannot claim a labeled task but can claim an unlabeled one", async () => {
    const labeled = await store.submitDirective(
      "Labeled",
      undefined, undefined, "T1", "D", undefined,
      { team: "platform" },
    );
    const unlabeled = await store.submitDirective(
      "Unlabeled",
      undefined, undefined, "T2", "D", undefined,
      undefined,
    );

    // Unlabeled claimant (no labels provided).
    const claim = await store.getNextDirective({ agentId: "eng-legacy" });
    // It must skip the labeled task and return the unlabeled one.
    expect(claim?.id).toBe(unlabeled);

    // The labeled task is still pending.
    const stillPending = await store.getTask(labeled);
    expect(stillPending?.status).toBe("pending");
  });

  it("queue order is preserved — first claimable task wins", async () => {
    const t1 = await store.submitDirective("T1", undefined, undefined, "T1", "D", undefined, { team: "a" });
    const t2 = await store.submitDirective("T2", undefined, undefined, "T2", "D", undefined, { team: "b" });
    const t3 = await store.submitDirective("T3", undefined, undefined, "T3", "D", undefined, { team: "a" });

    // Claimant can claim team:a tasks — should get t1 first.
    const first = await store.getNextDirective({
      agentId: "eng-a1",
      labels: { team: "a" },
    });
    expect(first?.id).toBe(t1);

    // Next call, claimant can claim team:b — should get t2.
    const second = await store.getNextDirective({
      agentId: "eng-b1",
      labels: { team: "b" },
    });
    expect(second?.id).toBe(t2);

    // Another team:a claimant gets t3.
    const third = await store.getNextDirective({
      agentId: "eng-a2",
      labels: { team: "a" },
    });
    expect(third?.id).toBe(t3);
  });

  it("already-working tasks are never re-claimed", async () => {
    const taskId = await store.submitDirective("One", undefined, undefined, "T", "D", undefined, {});

    const first = await store.getNextDirective({ agentId: "eng-a" });
    expect(first?.id).toBe(taskId);
    expect(first?.assignedEngineerId).toBe("eng-a");

    const second = await store.getNextDirective({ agentId: "eng-b" });
    expect(second).toBeNull();
  });

  it("legacy (unlabeled) tasks are claimable by labeled agents", async () => {
    const taskId = await store.submitDirective("Legacy", undefined, undefined, "T", "D", undefined, undefined);

    const claimed = await store.getNextDirective({
      agentId: "eng-abc",
      labels: { team: "platform", env: "prod" },
    });

    expect(claimed?.id).toBe(taskId);
    expect(claimed?.assignedEngineerId).toBe("eng-abc");
  });
});
