import { describe, it, expect } from "vitest";
import {
  __casRetryForTest,
  GcsOccPreconditionFailed,
  GcsOccRetryExhausted,
  GcsPathNotFound,
} from "../../src/gcs-state.js";

type Obj = { value: number };

// Fixture: an in-memory GCS-like store that tracks generations and
// can be wired into __casRetryForTest as reader / writer. Concurrent
// writes bump the generation and cause subsequent writes with a stale
// generation to throw GcsOccPreconditionFailed — same contract as GCS.
function makeStore(initial: { data: Obj | null; generation: number }) {
  let data = initial.data;
  let generation = initial.generation;
  let readCount = 0;
  let writeCount = 0;
  return {
    reader: async () => {
      readCount++;
      return { data: data ? { ...data } : null, generation };
    },
    writer: async (next: Obj, gen: number) => {
      writeCount++;
      if (gen !== generation) throw new GcsOccPreconditionFailed("test");
      data = { ...next };
      generation++;
    },
    externalWrite: (next: Obj) => {
      data = { ...next };
      generation++;
    },
    get state() {
      return { data, generation, readCount, writeCount };
    },
  };
}

describe("__casRetryForTest happy path", () => {
  it("reads, transforms, writes once when no contention", async () => {
    const store = makeStore({ data: { value: 1 }, generation: 1 });
    const sleep = async () => {};
    const result = await __casRetryForTest<Obj>(
      store.reader,
      store.writer,
      (cur) => ({ value: (cur?.value ?? 0) + 1 }),
      { allowMissing: false, path: "x", sleep },
    );
    expect(result.value).toBe(2);
    expect(store.state.readCount).toBe(1);
    expect(store.state.writeCount).toBe(1);
    expect(store.state.data).toEqual({ value: 2 });
  });

  it("allowMissing=true treats null as current state", async () => {
    const store = makeStore({ data: null, generation: 0 });
    const sleep = async () => {};
    const result = await __casRetryForTest<Obj>(
      store.reader,
      store.writer,
      (cur) => ({ value: cur?.value ?? 42 }),
      { allowMissing: true, path: "x", sleep },
    );
    expect(result.value).toBe(42);
    expect(store.state.data).toEqual({ value: 42 });
  });
});

describe("__casRetryForTest precondition contention", () => {
  it("retries after GcsOccPreconditionFailed and succeeds", async () => {
    const store = makeStore({ data: { value: 1 }, generation: 1 });
    const sleepCalls: number[] = [];
    const sleep = async (ms: number) => {
      sleepCalls.push(ms);
    };
    // Concurrent writer bumps generation between our first read and write.
    let firstAttempt = true;
    const reader = async () => {
      const r = await store.reader();
      if (firstAttempt) {
        firstAttempt = false;
        store.externalWrite({ value: 99 });
      }
      return r;
    };
    const result = await __casRetryForTest<Obj>(
      reader,
      store.writer,
      (cur) => ({ value: (cur?.value ?? 0) + 10 }),
      { allowMissing: false, path: "x", sleep },
    );
    // Second attempt: reader sees value=99 (from external write), adds 10 → 109.
    expect(result.value).toBe(109);
    expect(store.state.data).toEqual({ value: 109 });
    expect(store.state.writeCount).toBe(2); // first failed, second succeeded
    expect(sleepCalls.length).toBe(1); // one backoff between attempt 0 and 1
  });

  it("throws GcsOccRetryExhausted after 5 attempts under constant contention", async () => {
    const store = makeStore({ data: { value: 1 }, generation: 1 });
    const sleepCalls: number[] = [];
    const sleep = async (ms: number) => {
      sleepCalls.push(ms);
    };
    // Every read triggers a concurrent write → every write fails precondition.
    const reader = async () => {
      const r = await store.reader();
      store.externalWrite({ value: store.state.data!.value + 1 });
      return r;
    };
    await expect(
      __casRetryForTest<Obj>(
        reader,
        store.writer,
        (cur) => ({ value: (cur?.value ?? 0) + 1 }),
        { allowMissing: false, path: "x", sleep },
      ),
    ).rejects.toBeInstanceOf(GcsOccRetryExhausted);
    // 4 sleeps between 5 attempts (retry budget = 5).
    expect(sleepCalls.length).toBe(4);
    expect(store.state.writeCount).toBe(5); // all five attempts fired a write
  });

  it("backoff grows exponentially with jitter", async () => {
    const store = makeStore({ data: { value: 1 }, generation: 1 });
    const sleepCalls: number[] = [];
    const sleep = async (ms: number) => {
      sleepCalls.push(ms);
    };
    const reader = async () => {
      const r = await store.reader();
      store.externalWrite({ value: store.state.data!.value + 1 });
      return r;
    };
    await expect(
      __casRetryForTest<Obj>(
        reader,
        store.writer,
        (cur) => ({ value: (cur?.value ?? 0) + 1 }),
        { allowMissing: false, path: "x", sleep },
      ),
    ).rejects.toBeInstanceOf(GcsOccRetryExhausted);
    // Bounds per attempt: base = 20 * 2^attempt; with jitter up to 100%, total in [base, 2*base).
    expect(sleepCalls[0]).toBeGreaterThanOrEqual(20);
    expect(sleepCalls[0]).toBeLessThan(40);
    expect(sleepCalls[1]).toBeGreaterThanOrEqual(40);
    expect(sleepCalls[1]).toBeLessThan(80);
    expect(sleepCalls[2]).toBeGreaterThanOrEqual(80);
    expect(sleepCalls[2]).toBeLessThan(160);
    expect(sleepCalls[3]).toBeGreaterThanOrEqual(160);
    expect(sleepCalls[3]).toBeLessThan(320);
  });
});

describe("__casRetryForTest missing path", () => {
  it("throws GcsPathNotFound when allowMissing=false and data is null", async () => {
    const store = makeStore({ data: null, generation: 0 });
    const sleep = async () => {};
    await expect(
      __casRetryForTest<Obj>(
        store.reader,
        store.writer,
        (cur) => ({ value: (cur as Obj).value + 1 }),
        { allowMissing: false, path: "missing/thing.json", sleep },
      ),
    ).rejects.toBeInstanceOf(GcsPathNotFound);
    expect(store.state.writeCount).toBe(0);
  });
});

describe("__casRetryForTest transform error propagation", () => {
  class BizError extends Error {}
  it("transform errors propagate without retry", async () => {
    const store = makeStore({ data: { value: 1 }, generation: 1 });
    const sleep = async () => {};
    await expect(
      __casRetryForTest<Obj>(
        store.reader,
        store.writer,
        () => {
          throw new BizError("gate failed");
        },
        { allowMissing: false, path: "x", sleep },
      ),
    ).rejects.toBeInstanceOf(BizError);
    expect(store.state.readCount).toBe(1); // no retry
    expect(store.state.writeCount).toBe(0);
  });

  it("non-precondition writer errors propagate without retry", async () => {
    const store = makeStore({ data: { value: 1 }, generation: 1 });
    const sleep = async () => {};
    const writer = async () => {
      throw new Error("disk full");
    };
    await expect(
      __casRetryForTest<Obj>(
        store.reader,
        writer,
        (cur) => ({ value: (cur?.value ?? 0) + 1 }),
        { allowMissing: false, path: "x", sleep },
      ),
    ).rejects.toThrow("disk full");
    expect(store.state.readCount).toBe(1);
  });
});
