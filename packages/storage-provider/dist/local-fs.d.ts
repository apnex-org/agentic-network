/**
 * Local-filesystem StorageProvider — mission-47 T1.
 *
 * Persistent, single-writer. Root directory corresponds to the bucket;
 * blob paths become relative filesystem paths under that root.
 * Matches the GCS layout 1:1 so scripts/state-backup.sh's rsync output
 * is directly consumable.
 *
 * Capabilities: {cas:true, durable:true, concurrent:false}.
 *
 * CAS implementation:
 *   - createOnly: O_WRONLY | O_CREAT | O_EXCL on a tmp file, then
 *     atomic rename into place. If the destination already exists,
 *     O_EXCL fails → {ok:false}.
 *   - putIfMatch: read current content, compute content-hash as token,
 *     compare against caller's token, write-via-tmp-rename on match.
 *     Single-writer assumption: no other process is racing; the
 *     read-check-write sequence is atomic from this process's view.
 *
 * Token derivation: SHA-256 content hash encoded as lowercase hex.
 * Deterministic, sidecar-free. Two writers producing identical data
 * produce identical tokens — which is semantically correct (same
 * content = same version from a client's perspective).
 *
 * Why not flock? Portability varies across platforms + bind mounts;
 * mission-46 local-Docker-testing memory confirms local-fs is only
 * expected to host a single writer (one hub container at a time).
 * Adding flock would be over-engineering for the current deployment
 * profile. If multi-writer local-fs ever becomes a real case, add
 * `concurrent:true` gate + flock in a follow-on mission.
 */
import type { ProviderCapabilities, StorageProviderWithTokenRead, CreateOnlyResult, PutIfMatchResult } from "./contract.js";
export declare class LocalFsStorageProvider implements StorageProviderWithTokenRead {
    private readonly root;
    readonly capabilities: ProviderCapabilities;
    constructor(root: string);
    private resolve;
    private ensureParentDir;
    get(blobPath: string): Promise<Uint8Array | null>;
    getWithToken(blobPath: string): Promise<{
        data: Uint8Array;
        token: string;
    } | null>;
    list(prefix: string): Promise<string[]>;
    delete(blobPath: string): Promise<void>;
    put(blobPath: string, data: Uint8Array): Promise<void>;
    createOnly(blobPath: string, data: Uint8Array): Promise<CreateOnlyResult>;
    putIfMatch(blobPath: string, data: Uint8Array, ifMatchToken: string): Promise<PutIfMatchResult>;
}
