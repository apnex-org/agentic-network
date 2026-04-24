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

// ── Capabilities ─────────────────────────────────────────────────────

export interface ProviderCapabilities {
  /** True iff createOnly + putIfMatch return correct CAS semantics. */
  readonly cas: boolean;
  /** True iff `put` completion means the blob survives process exit. */
  readonly durable: boolean;
  /** True iff the provider is safe under multiple concurrent writers. */
  readonly concurrent: boolean;
}

// ── Result types ─────────────────────────────────────────────────────

/**
 * Outcome of `createOnly`. `{ok:true}` means the path did not exist
 * and the blob was written. `{ok:false}` means the path already
 * existed — caller can choose to `get` the existing blob if needed.
 */
export type CreateOnlyResult = { ok: true } | { ok: false };

/**
 * Outcome of `putIfMatch`. `{ok:true, newToken}` means the token
 * matched and the blob was updated; `newToken` is the handle for
 * the next update. `{ok:false, currentToken}` means the token was
 * stale — caller can retry with the current token.
 */
export type PutIfMatchResult =
  | { ok: true; newToken: string }
  | { ok: false; currentToken: string };

// ── Errors ───────────────────────────────────────────────────────────

/**
 * Thrown by `putIfMatch` when the target path does not exist. Callers
 * should use `createOnly` for first-write semantics; hitting this
 * error indicates a logic bug in the repository layer (attempting
 * read-modify-write on an absent blob).
 */
export class StoragePathNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`Storage path not found: ${path}`);
    this.name = "StoragePathNotFoundError";
  }
}

/**
 * Thrown when a provider-level error is not otherwise classified.
 * Wraps the underlying cause. Repositories should treat this as
 * fatal — the storage layer is in an unknown state.
 */
export class StorageProviderError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "StorageProviderError";
  }
}

// ── Contract ─────────────────────────────────────────────────────────

/**
 * The sovereign six-primitive contract. Every provider (memory,
 * local-fs, gcs, ...) implements this identically — repositories
 * compose over the contract without backend-specific branches.
 *
 * See the success anti-criterion from mission-47: if a repository
 * ever has `if (provider instanceof GcsStorageProvider)`, the
 * abstraction has leaked. Contract + capability flags are the
 * only caller-visible surface.
 */
export interface StorageProvider {
  /** Capability flags declared at construction; immutable for the provider lifetime. */
  readonly capabilities: ProviderCapabilities;

  /**
   * Read a blob. Returns `null` if the path does not exist; a zero-
   * length Uint8Array means the path exists with no content (distinct
   * semantic from absent; repositories rarely need this distinction
   * since JSON-encoded blobs are never empty, but the contract
   * preserves it).
   */
  get(path: string): Promise<Uint8Array | null>;

  /**
   * List all paths under a prefix. Order is unspecified; callers
   * must not rely on alphabetical or insertion order. Empty prefix
   * lists the entire keyspace (use sparingly on large stores).
   */
  list(prefix: string): Promise<string[]>;

  /**
   * Delete a blob. No-op if the path does not exist (idempotent).
   * Does not cascade; parent-prefix blobs remain if they exist.
   */
  delete(path: string): Promise<void>;

  /**
   * Unconditional write. Clobbers any existing blob at the path.
   * Use when overwrite is genuinely intended; otherwise prefer
   * `createOnly` (first-write) or `putIfMatch` (update-with-check).
   */
  put(path: string, data: Uint8Array): Promise<void>;

  /**
   * Atomic create-if-absent. Writes the blob iff the path does not
   * already exist. Requires `capabilities.cas:true`. Returns
   * `{ok:false}` without reading the existing blob on conflict —
   * if the caller needs the existing data, a separate `get` call
   * follows.
   *
   * Implementations:
   *   - Memory: map-set-if-absent (single-threaded safe).
   *   - Local-fs: `open(path, O_WRONLY | O_CREAT | O_EXCL)` + atomic
   *     rename from a tmp file.
   *   - GCS: `writeJsonWithPrecondition` with `ifGenerationMatch=0`.
   */
  createOnly(path: string, data: Uint8Array): Promise<CreateOnlyResult>;

  /**
   * Read-modify-write compare-and-swap. Writes the blob iff the
   * current content's token matches `ifMatchToken`. Requires
   * `capabilities.cas:true`. Returns the new token on success or
   * the current token on conflict (so the caller can retry with
   * the fresh token without a separate `get`).
   *
   * Throws `StoragePathNotFoundError` if the path does not exist —
   * callers should use `createOnly` for first-write semantics.
   *
   * Token opacity: callers compare equality only. GCS providers use
   * the generation number; local-fs providers use a content-hash;
   * memory providers use a monotonic counter. Tokens from one
   * provider are not portable to another — this is a single-
   * provider-lifetime handle.
   */
  putIfMatch(
    path: string,
    data: Uint8Array,
    ifMatchToken: string,
  ): Promise<PutIfMatchResult>;
}

// ── Utilities ────────────────────────────────────────────────────────

/**
 * Read a blob with its CAS token in a single atomic operation.
 * Convenience extension over `get` for repositories that intend to
 * chain into `putIfMatch`. Returns `null` if the path does not exist.
 *
 * Optional capability — not every provider implements this natively.
 * Composition fallback: `get(path)` then derive token via a per-
 * provider token function. The GCS native-API happens to support
 * read-with-generation in a single round-trip; the memory + local-fs
 * providers can emulate trivially.
 *
 * Included as an interface augmentation to keep the core contract
 * minimal. Repositories that need read-then-update should branch
 * on `"getWithToken" in provider` to opt in.
 */
export interface StorageProviderWithTokenRead extends StorageProvider {
  getWithToken(path: string): Promise<{ data: Uint8Array; token: string } | null>;
}

export function hasGetWithToken(
  provider: StorageProvider,
): provider is StorageProviderWithTokenRead {
  return typeof (provider as StorageProviderWithTokenRead).getWithToken === "function";
}
