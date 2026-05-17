/**
 * @apnex/storage-provider — sovereign StorageProvider contract package.
 *
 * Mission-47 T1. CSI-inspired pluggable storage abstraction for the
 * OIS agentic network. See contract.ts for the six-primitive surface
 * + capability-flag semantics.
 */

export type {
  ProviderCapabilities,
  StorageProvider,
  StorageProviderWithTokenRead,
  CreateOnlyResult,
  PutIfMatchResult,
} from "./contract.js";

export {
  StoragePathNotFoundError,
  StorageProviderError,
  hasGetWithToken,
} from "./contract.js";

export { MemoryStorageProvider } from "./memory.js";
export { LocalFsStorageProvider } from "./local-fs.js";
// mission-83 W6-narrowed: GcsStorageProvider DELETED (substrate replaces GCS
// at production-prod; local-fs/memory preserved as test/dev affordances).
