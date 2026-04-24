/**
 * In-memory StorageProvider — mission-47 T1.
 *
 * Single-process, non-durable, single-threaded. Used for tests + dev.
 * Not a deployment target (cas:true but durable:false → data vanishes
 * on process exit). Pairs with the conformance suite to validate that
 * the contract itself is correct: memory is the simplest possible
 * reference implementation; bugs here = contract bugs.
 *
 * Capabilities: {cas:true, durable:false, concurrent:false}.
 */

import type {
  ProviderCapabilities,
  StorageProvider,
  StorageProviderWithTokenRead,
  CreateOnlyResult,
  PutIfMatchResult,
} from "./contract.js";
import { StoragePathNotFoundError } from "./contract.js";

interface MemoryEntry {
  readonly data: Uint8Array;
  readonly token: string;
}

export class MemoryStorageProvider implements StorageProviderWithTokenRead {
  readonly capabilities: ProviderCapabilities = {
    cas: true,
    durable: false,
    concurrent: false,
  };

  private readonly entries = new Map<string, MemoryEntry>();
  private counter = 0;

  private nextToken(): string {
    this.counter += 1;
    return String(this.counter);
  }

  async get(path: string): Promise<Uint8Array | null> {
    const entry = this.entries.get(path);
    if (!entry) return null;
    return new Uint8Array(entry.data); // defensive copy
  }

  async getWithToken(path: string): Promise<{ data: Uint8Array; token: string } | null> {
    const entry = this.entries.get(path);
    if (!entry) return null;
    return { data: new Uint8Array(entry.data), token: entry.token };
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) out.push(key);
    }
    return out;
  }

  async delete(path: string): Promise<void> {
    this.entries.delete(path);
  }

  async put(path: string, data: Uint8Array): Promise<void> {
    this.entries.set(path, {
      data: new Uint8Array(data),
      token: this.nextToken(),
    });
  }

  async createOnly(path: string, data: Uint8Array): Promise<CreateOnlyResult> {
    if (this.entries.has(path)) return { ok: false };
    this.entries.set(path, {
      data: new Uint8Array(data),
      token: this.nextToken(),
    });
    return { ok: true };
  }

  async putIfMatch(
    path: string,
    data: Uint8Array,
    ifMatchToken: string,
  ): Promise<PutIfMatchResult> {
    const entry = this.entries.get(path);
    if (!entry) throw new StoragePathNotFoundError(path);
    if (entry.token !== ifMatchToken) {
      return { ok: false, currentToken: entry.token };
    }
    const newToken = this.nextToken();
    this.entries.set(path, { data: new Uint8Array(data), token: newToken });
    return { ok: true, newToken };
  }
}

// Satisfy structural-subtype compatibility with the narrow interface.
const _satisfiesBase: StorageProvider = new MemoryStorageProvider();
void _satisfiesBase;
