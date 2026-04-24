/**
 * Sovereign StorageProvider contract — mission-47 T1.
 *
 * CSI-inspired pluggable storage abstraction. Providers expose a
 * minimal six-primitive surface; entity repositories compose the
 * provider with per-entity serialization + ID generation logic. The
 * contract is deliberately storage-only — no entity semantics, no
 * ID-generation helpers, no counter management (those live in the
 * repository layer per thread-290 design convergence).
 *
 * Contract v1.0 (six primitives):
 *   - get(path)                       — read a blob or null if absent
 *   - list(prefix)                    — list paths under a prefix
 *   - delete(path)                    — remove a blob (no-op if absent)
 *   - put(path, data)                 — unconditional write; clobbers
 *   - createOnly(path, data)          — atomic create; {ok:false} on conflict
 *   - putIfMatch(path, data, token)   — read-modify-write CAS
 *
 * Capabilities declared per-provider: {cas, durable, concurrent}.
 * `cas:false` is dev-only, not a supported deployment target — prod
 * providers MUST implement the CAS family. The capability-gate stays
 * in the type system as design discipline + dev-backend support.
 *
 * Token semantics: opaque string. Provider-internal representation
 * (GCS generation / content-hash / monotonic counter) is not exposed
 * to callers. Repositories treat tokens as handles for read-modify-
 * write chains; equality-compare only, no parsing.
 */
// ── Errors ───────────────────────────────────────────────────────────
/**
 * Thrown by `putIfMatch` when the target path does not exist. Callers
 * should use `createOnly` for first-write semantics; hitting this
 * error indicates a logic bug in the repository layer (attempting
 * read-modify-write on an absent blob).
 */
export class StoragePathNotFoundError extends Error {
    path;
    constructor(path) {
        super(`Storage path not found: ${path}`);
        this.path = path;
        this.name = "StoragePathNotFoundError";
    }
}
/**
 * Thrown when a provider-level error is not otherwise classified.
 * Wraps the underlying cause. Repositories should treat this as
 * fatal — the storage layer is in an unknown state.
 */
export class StorageProviderError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = "StorageProviderError";
    }
}
export function hasGetWithToken(provider) {
    return typeof provider.getWithToken === "function";
}
//# sourceMappingURL=contract.js.map