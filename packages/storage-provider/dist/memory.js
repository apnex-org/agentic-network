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
import { StoragePathNotFoundError } from "./contract.js";
export class MemoryStorageProvider {
    capabilities = {
        cas: true,
        durable: false,
        concurrent: false,
    };
    entries = new Map();
    counter = 0;
    nextToken() {
        this.counter += 1;
        return String(this.counter);
    }
    async get(path) {
        const entry = this.entries.get(path);
        if (!entry)
            return null;
        return new Uint8Array(entry.data); // defensive copy
    }
    async getWithToken(path) {
        const entry = this.entries.get(path);
        if (!entry)
            return null;
        return { data: new Uint8Array(entry.data), token: entry.token };
    }
    async list(prefix) {
        const out = [];
        for (const key of this.entries.keys()) {
            if (key.startsWith(prefix))
                out.push(key);
        }
        return out;
    }
    async delete(path) {
        this.entries.delete(path);
    }
    async put(path, data) {
        this.entries.set(path, {
            data: new Uint8Array(data),
            token: this.nextToken(),
        });
    }
    async createOnly(path, data) {
        if (this.entries.has(path))
            return { ok: false };
        this.entries.set(path, {
            data: new Uint8Array(data),
            token: this.nextToken(),
        });
        return { ok: true };
    }
    async putIfMatch(path, data, ifMatchToken) {
        const entry = this.entries.get(path);
        if (!entry)
            throw new StoragePathNotFoundError(path);
        if (entry.token !== ifMatchToken) {
            return { ok: false, currentToken: entry.token };
        }
        const newToken = this.nextToken();
        this.entries.set(path, { data: new Uint8Array(data), token: newToken });
        return { ok: true, newToken };
    }
}
// Satisfy structural-subtype compatibility with the narrow interface.
const _satisfiesBase = new MemoryStorageProvider();
void _satisfiesBase;
//# sourceMappingURL=memory.js.map