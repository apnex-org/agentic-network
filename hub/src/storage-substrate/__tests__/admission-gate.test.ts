import { describe, expect, it } from "vitest";
import { AdmissionGate, StorageAdmissionError } from "../admission-gate.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("bug-343 storage admission gate", () => {
  it("bounds active work and hands queued callers off FIFO", async () => {
    const gate = new AdmissionGate(2, 3, 1000);
    const holds = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()];
    const starts: number[] = [];
    let active = 0;
    let maxActive = 0;

    const runs = holds.map((hold, i) => gate.run(async () => {
      starts.push(i);
      active++;
      maxActive = Math.max(maxActive, active);
      await hold.promise;
      active--;
      return i;
    }));

    await Promise.resolve();
    expect(starts).toEqual([0, 1]);
    expect(gate.snapshot()).toMatchObject({ active: 2, queued: 2 });

    holds[0]!.resolve();
    await runs[0];
    await Promise.resolve();
    expect(starts).toEqual([0, 1, 2]);

    holds[1]!.resolve();
    await runs[1];
    await Promise.resolve();
    expect(starts).toEqual([0, 1, 2, 3]);

    holds[2]!.resolve();
    holds[3]!.resolve();
    await Promise.all(runs);
    expect(maxActive).toBe(2);
    expect(gate.snapshot()).toMatchObject({
      active: 0,
      queued: 0,
      highWaterActive: 2,
      highWaterQueued: 2,
      admitted: 4,
      rejectedQueueFull: 0,
      rejectedTimeout: 0,
    });
    gate.resetObservations();
    expect(gate.snapshot()).toMatchObject({
      highWaterActive: 0,
      highWaterQueued: 0,
      admitted: 0,
    });
  });

  it("rejects loudly when the bounded queue is full", async () => {
    const gate = new AdmissionGate(1, 1, 1000);
    const hold = deferred<void>();
    const first = gate.run(async () => hold.promise);
    await Promise.resolve();
    const second = gate.run(async () => undefined);
    await Promise.resolve();

    await expect(gate.run(async () => undefined)).rejects.toMatchObject({
      name: "StorageAdmissionError",
      code: "storage_admission_backpressure",
    } satisfies Partial<StorageAdmissionError>);
    expect(gate.snapshot()).toMatchObject({
      highWaterActive: 1,
      highWaterQueued: 1,
      rejectedQueueFull: 1,
    });

    hold.resolve();
    await first;
    await second;
  });
});
