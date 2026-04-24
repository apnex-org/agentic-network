/**
 * @ois/storage-provider — sovereign StorageProvider contract package.
 *
 * Mission-47 T1. CSI-inspired pluggable storage abstraction for the
 * OIS agentic network. See contract.ts for the six-primitive surface
 * + capability-flag semantics.
 */
export { StoragePathNotFoundError, StorageProviderError, hasGetWithToken, } from "./contract.js";
export { MemoryStorageProvider } from "./memory.js";
export { LocalFsStorageProvider } from "./local-fs.js";
export { GcsStorageProvider } from "./gcs.js";
//# sourceMappingURL=index.js.map