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
import { Storage } from "@google-cloud/storage";
import { StoragePathNotFoundError, StorageProviderError, } from "./contract.js";
// Shared Storage client. Constructed lazily on first use so that
// unit tests which never instantiate a GcsStorageProvider don't pay
// the SDK-initialization cost.
let sharedStorage = null;
function getStorage() {
    if (!sharedStorage)
        sharedStorage = new Storage();
    return sharedStorage;
}
function isNotFound(err) {
    const code = err.code;
    return code === 404;
}
function isPreconditionFailed(err) {
    const code = err.code;
    return code === 412;
}
export class GcsStorageProvider {
    capabilities = {
        cas: true,
        durable: true,
        concurrent: true,
    };
    bucket;
    constructor(bucketName) {
        if (!bucketName || bucketName.trim() === "") {
            throw new StorageProviderError("[gcs] bucket name is required");
        }
        this.bucket = getStorage().bucket(bucketName);
    }
    async get(path) {
        try {
            const [buf] = await this.bucket.file(path).download();
            return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        }
        catch (err) {
            if (isNotFound(err))
                return null;
            throw new StorageProviderError(`[gcs] get failed for ${path}`, err);
        }
    }
    async getWithToken(path) {
        const file = this.bucket.file(path);
        try {
            const [buf] = await file.download();
            const [meta] = await file.getMetadata();
            const generation = meta.generation;
            if (generation === undefined || generation === null) {
                throw new StorageProviderError(`[gcs] getWithToken missing generation metadata for ${path}`);
            }
            return {
                data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
                token: String(generation),
            };
        }
        catch (err) {
            if (isNotFound(err))
                return null;
            throw new StorageProviderError(`[gcs] getWithToken failed for ${path}`, err);
        }
    }
    async list(prefix) {
        try {
            const [files] = await this.bucket.getFiles({ prefix });
            return files.map((f) => f.name);
        }
        catch (err) {
            throw new StorageProviderError(`[gcs] list failed for prefix ${prefix}`, err);
        }
    }
    async delete(path) {
        try {
            await this.bucket.file(path).delete();
        }
        catch (err) {
            if (isNotFound(err))
                return; // idempotent
            throw new StorageProviderError(`[gcs] delete failed for ${path}`, err);
        }
    }
    async put(path, data) {
        try {
            await this.bucket.file(path).save(Buffer.from(data));
        }
        catch (err) {
            throw new StorageProviderError(`[gcs] put failed for ${path}`, err);
        }
    }
    async createOnly(path, data) {
        try {
            await this.bucket.file(path).save(Buffer.from(data), {
                preconditionOpts: { ifGenerationMatch: 0 },
            });
            return { ok: true };
        }
        catch (err) {
            if (isPreconditionFailed(err))
                return { ok: false };
            throw new StorageProviderError(`[gcs] createOnly failed for ${path}`, err);
        }
    }
    async putIfMatch(path, data, ifMatchToken) {
        const generation = Number(ifMatchToken);
        if (!Number.isFinite(generation) || generation <= 0) {
            throw new StorageProviderError(`[gcs] putIfMatch received invalid token '${ifMatchToken}' — expected stringified GCS generation`);
        }
        const file = this.bucket.file(path);
        try {
            await file.save(Buffer.from(data), {
                preconditionOpts: { ifGenerationMatch: generation },
            });
        }
        catch (err) {
            if (isPreconditionFailed(err)) {
                // Fetch current generation so the caller can retry without a
                // separate `get` round-trip. If the object disappeared between
                // our read and now (rare — suggests concurrent delete), surface
                // NotFound rather than pretending to have a valid currentToken.
                try {
                    const [meta] = await file.getMetadata();
                    const current = meta.generation;
                    if (current === undefined || current === null) {
                        throw new StoragePathNotFoundError(path);
                    }
                    return { ok: false, currentToken: String(current) };
                }
                catch (metaErr) {
                    if (isNotFound(metaErr))
                        throw new StoragePathNotFoundError(path);
                    throw new StorageProviderError(`[gcs] putIfMatch precondition-failure recovery failed for ${path}`, metaErr);
                }
            }
            if (isNotFound(err)) {
                throw new StoragePathNotFoundError(path);
            }
            throw new StorageProviderError(`[gcs] putIfMatch failed for ${path}`, err);
        }
        // Successful write — read back the new generation to return as
        // the next token. GCS's save() response includes it but the
        // SDK abstraction doesn't surface it cleanly, so metadata fetch.
        try {
            const [meta] = await file.getMetadata();
            const newGen = meta.generation;
            if (newGen === undefined || newGen === null) {
                throw new StorageProviderError(`[gcs] putIfMatch post-write generation missing for ${path}`);
            }
            return { ok: true, newToken: String(newGen) };
        }
        catch (err) {
            throw new StorageProviderError(`[gcs] putIfMatch post-write metadata fetch failed for ${path}`, err);
        }
    }
}
void 0;
//# sourceMappingURL=gcs.js.map