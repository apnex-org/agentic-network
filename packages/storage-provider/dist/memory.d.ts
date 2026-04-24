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
import type { ProviderCapabilities, StorageProviderWithTokenRead, CreateOnlyResult, PutIfMatchResult } from "./contract.js";
export declare class MemoryStorageProvider implements StorageProviderWithTokenRead {
    readonly capabilities: ProviderCapabilities;
    private readonly entries;
    private counter;
    private nextToken;
    get(path: string): Promise<Uint8Array | null>;
    getWithToken(path: string): Promise<{
        data: Uint8Array;
        token: string;
    } | null>;
    list(prefix: string): Promise<string[]>;
    delete(path: string): Promise<void>;
    put(path: string, data: Uint8Array): Promise<void>;
    createOnly(path: string, data: Uint8Array): Promise<CreateOnlyResult>;
    putIfMatch(path: string, data: Uint8Array, ifMatchToken: string): Promise<PutIfMatchResult>;
}
