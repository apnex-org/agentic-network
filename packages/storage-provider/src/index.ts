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
// mission-83 W6-narrowed: GcsStorageProvider DELETED (substrate replaces GCS
// at production-prod).
// mission-84 W4: LocalFsStorageProvider DELETED — production-Hub locked to
// substrate per mission-83 W5.4 cutover; this package SHRUNK to test-only
// affordances (MemoryStorageProvider + contract.ts + conformance.ts) used by
// the published @apnex/repo-event-bridge package (cursor-store.ts + tests).
