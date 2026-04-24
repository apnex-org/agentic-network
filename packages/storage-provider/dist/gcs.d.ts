/**
 * GCS-backed StorageProvider — mission-47 T1.
 *
 * Wraps the `@google-cloud/storage` SDK directly at the blob level.
 * Preserves the generation-based CAS semantics the hub already relies
 * on (`ifGenerationMatch=0` for first-write; numeric generation for
 * read-modify-write).
 *
 * Capabilities: {cas:true, durable:true, concurrent:true}.
 *
 * Token representation: GCS object generation number, stringified.
 * Callers treat tokens as opaque; internally we parse the string
 * back to a number for the SDK's `ifGenerationMatch` parameter.
 *
 * Behavioral parity with hub/src/gcs-state.ts: this provider does NOT
 * include the retry-with-backoff that `updateExisting` in gcs-state.ts
 * wraps around the CAS primitive. Retry policy belongs at the
 * repository layer (one layer up) where the transform function lives.
 * The provider exposes the atomic CAS primitive; the repository
 * orchestrates the retry loop.
 */
import type { ProviderCapabilities, StorageProviderWithTokenRead, CreateOnlyResult, PutIfMatchResult } from "./contract.js";
export declare class GcsStorageProvider implements StorageProviderWithTokenRead {
    readonly capabilities: ProviderCapabilities;
    private readonly bucket;
    constructor(bucketName: string);
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
