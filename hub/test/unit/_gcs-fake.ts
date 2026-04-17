/**
 * In-memory fake for `@google-cloud/storage`. Tracks a GCS `generation`
 * per path so OCC preconditions (`ifGenerationMatch`) fail exactly as
 * they would in prod. Used by Mission-20 Phase 3 concurrency tests to
 * drive Gcs*Store code paths through the CAS retry loop without a live
 * bucket.
 *
 * Covers only the surface `hub/src/gcs-state.ts` actually calls:
 *   bucket(n).file(p).{download, save, getMetadata, delete}
 *   bucket(n).getFiles({ prefix })
 *
 * Wire it into a test with:
 *
 *   import { GcsFakeStorage, installGcsFake } from "./_gcs-fake.js";
 *   vi.mock("@google-cloud/storage", () => ({ Storage: GcsFakeStorage }));
 *   beforeEach(() => installGcsFake());
 *
 * Tests mutate the shared store via `gcsFake()` — `.put()`, `.raceWrite()`
 * etc. — to script concurrent contention.
 */

interface FakeEntry {
  data: Buffer;
  generation: number;
}

class FakeStore {
  private entries = new Map<string, FakeEntry>();
  private nextGeneration = 1;
  private preconditionFailures = 0;

  reset(): void {
    this.entries.clear();
    this.nextGeneration = 1;
    this.preconditionFailures = 0;
  }

  /** How many `save(..., ifGenerationMatch=N)` calls have thrown 412 since reset. */
  get preconditionFailureCount(): number {
    return this.preconditionFailures;
  }

  keys(): string[] {
    return Array.from(this.entries.keys()).sort();
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): FakeEntry | undefined {
    return this.entries.get(key);
  }

  /**
   * Direct write that bumps generation — used by tests to simulate a
   * concurrent writer beating the store under test to the punch.
   */
  raceWrite(key: string, data: unknown): void {
    const buf = Buffer.from(
      typeof data === "string" ? data : JSON.stringify(data, null, 2),
      "utf-8",
    );
    this.entries.set(key, { data: buf, generation: this.nextGeneration++ });
  }

  /** Seed a path without exercising OCC — for fixture setup. */
  put(key: string, data: unknown): void {
    this.raceWrite(key, data);
  }

  save(key: string, content: Buffer, ifGenerationMatch?: number): void {
    const existing = this.entries.get(key);
    if (ifGenerationMatch !== undefined) {
      const currentGen = existing?.generation ?? 0;
      if (ifGenerationMatch !== currentGen) {
        this.preconditionFailures++;
        const err: any = new Error(
          `Precondition Failed: expected ${ifGenerationMatch}, got ${currentGen}`,
        );
        err.code = 412;
        throw err;
      }
    }
    this.entries.set(key, { data: content, generation: this.nextGeneration++ });
  }

  download(key: string): Buffer {
    const existing = this.entries.get(key);
    if (!existing) {
      const err: any = new Error(`Not Found: ${key}`);
      err.code = 404;
      throw err;
    }
    return existing.data;
  }

  getMetadata(key: string): { generation: string } {
    const existing = this.entries.get(key);
    if (!existing) {
      const err: any = new Error(`Not Found: ${key}`);
      err.code = 404;
      throw err;
    }
    // Real GCS returns generation as a string — preserve that shape so
    // `Number(metadata.generation)` on the caller side exercises the
    // same coercion path as prod.
    return { generation: String(existing.generation) };
  }

  delete(key: string): void {
    if (!this.entries.has(key)) {
      const err: any = new Error(`Not Found: ${key}`);
      err.code = 404;
      throw err;
    }
    this.entries.delete(key);
  }

  listByPrefix(prefix: string): { name: string }[] {
    return this.keys()
      .filter((k) => k.startsWith(prefix))
      .map((name) => ({ name }));
  }
}

let sharedStore: FakeStore | null = null;

function requireStore(): FakeStore {
  if (!sharedStore) {
    throw new Error(
      "[gcs-fake] sharedStore not initialised — call installGcsFake() in beforeEach",
    );
  }
  return sharedStore;
}

/**
 * Call in `beforeEach` to wipe state between tests. `vi.mock` is hoisted
 * to module-init time, so the Storage stub itself is already wired;
 * this only resets the backing Map.
 */
export function installGcsFake(): FakeStore {
  if (!sharedStore) sharedStore = new FakeStore();
  sharedStore.reset();
  return sharedStore;
}

/** Accessor used from inside a test to script concurrent writes. */
export function gcsFake(): FakeStore {
  return requireStore();
}

class FakeFile {
  constructor(private readonly key: string) {}

  async download(): Promise<[Buffer]> {
    return [requireStore().download(this.key)];
  }

  async save(
    content: Buffer | string,
    opts?: {
      contentType?: string;
      preconditionOpts?: { ifGenerationMatch?: number };
    },
  ): Promise<void> {
    const buf =
      typeof content === "string" ? Buffer.from(content, "utf-8") : content;
    const ifGen = opts?.preconditionOpts?.ifGenerationMatch;
    requireStore().save(this.key, buf, ifGen);
  }

  async getMetadata(): Promise<[{ generation: string }]> {
    return [requireStore().getMetadata(this.key)];
  }

  async delete(): Promise<void> {
    requireStore().delete(this.key);
  }
}

class FakeBucket {
  constructor(public readonly name: string) {}

  file(path: string): FakeFile {
    return new FakeFile(path);
  }

  async getFiles(opts: { prefix: string }): Promise<[{ name: string }[]]> {
    return [requireStore().listByPrefix(opts.prefix)];
  }
}

/**
 * Stand-in for the `Storage` class exported by `@google-cloud/storage`.
 * `new Storage()` in prod code resolves to this under `vi.mock`.
 */
export class GcsFakeStorage {
  bucket(name: string): FakeBucket {
    return new FakeBucket(name);
  }
}
