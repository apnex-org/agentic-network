/**
 * RepoEventBridgeSubstrateAdapter — mission-84 W0.4 spike (architecturally ratified at W3).
 *
 * Per Design v1.0 §2.3 (Variant ii minimal-SchemaDef Variant) + primitive-mapping table:
 *
 *   StorageProvider primitive        HubStorageSubstrate primitive   Adapter shape
 *   get(path)               →        get(kind, id)                   path → (kind, id); Uint8Array ← JSON.stringify(entity.body)
 *   getWithToken(path)      →        getWithRevision(kind, id)       token ↔ resourceVersion
 *   createOnly(path, data)  →        createOnly(kind, entity)        data: Uint8Array → entity: {id, body: JSON.parse(data)}
 *   putIfMatch(path, ...)   →        putIfMatch(kind, entity, exp)   ditto + expectedRevision = ifMatchToken
 *
 * Path shape mapping (per Design v1.0 §2.3):
 *   <pathPrefix>/cursor/<repoId> → kind=RepoEventBridgeCursor, id=<repoId>
 *   <pathPrefix>/dedupe/<repoId> → kind=RepoEventBridgeDedupe, id=<repoId>
 *
 * Entity body shape: substrate stores `{id: <repoId>, body: <cursor-store-encoded-data>}`
 * — the `id` field satisfies substrate's extractId requirement; `body` carries the
 * cursor-store opaque JSON shape unchanged.
 *
 * cursor-store.ts internal data is Uint8Array via TextEncoder; substrate body is JSONB.
 * Adapter handles JSON.parse↔stringify at the seam (Uint8Array → string via TextDecoder
 * → JSON.parse → entity wrap; on read, entity unwrap → JSON.stringify → TextEncoder → Uint8Array).
 *
 * ─── W0.4 spike-finding ──────────────────────────────────────────────────────
 *
 * Primitive-mapping IS 1:1 + zero-blocker for W3 commitment. Per-method parity
 * verified via cursor-store.ts integration smoke test (see adapter test file).
 *
 * Architectural-decision surface for W3 — adapter LOCATION:
 *
 * - Design v1.0 §2.3 prescribed `packages/repo-event-bridge/src/substrate-adapter.ts`
 * - W0.4 spike places it at `hub/src/storage-substrate/repo-event-bridge-adapter.ts`
 *
 * REASON: hub-substrate types live in hub package (NOT a published workspace);
 * repo-event-bridge package can't cleanly import HubStorageSubstrate without
 * either (a) publishing hub-substrate-types as a separate workspace package,
 * (b) duplicating types in repo-event-bridge, or (c) cross-package relative
 * imports (violates tsconfig rootDir).
 *
 * Engineer-recommendation for W3: keep adapter at hub-side location (cleaner
 * typing; matches hub→repo-event-bridge dependency already in hub/src/index.ts;
 * adapter is hub-internal-glue not a repo-event-bridge concern). Surface to
 * architect at W3 dispatch for ratify-or-refine.
 *
 * Production-grade adapter (W3 ship) will add: error-mapping (StoragePathNotFoundError
 * on putIfMatch absent); production logging; metric hooks; full StorageProvider
 * primitive coverage if external consumers emerge (currently Variant ii scope =
 * cursor-store.ts primitives only).
 */

import type {
  StorageProvider,
  StorageProviderWithTokenRead,
  ProviderCapabilities,
  CreateOnlyResult,
  PutIfMatchResult,
} from "@apnex/storage-provider";
import { StoragePathNotFoundError } from "@apnex/storage-provider";
import type { HubStorageSubstrate } from "./types.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

export interface RepoEventBridgeSubstrateAdapterOptions {
  readonly substrate: HubStorageSubstrate;
  /**
   * Path-prefixes that cursor-store.ts uses. The `repo-event-bridge` package has
   * TWO known prefixes by design per idea-255 (M-Workflow-Run-Events-Hub-Integration):
   *   - `repo-event-bridge` — main GitHub-events-poll-source (default CursorStore pathPrefix)
   *   - `repo-event-bridge-workflow-runs` — workflow-run-poll-source (explicit override)
   *
   * bug-99 fix (mission-84 post-mortem): W3 ship initially only accepted single
   * `repo-event-bridge` prefix; workflow-run-poll-source halted bridge at startup.
   * Multi-prefix accept-list closes the scope-gap.
   *
   * Backward-compat: `pathPrefix: string` single-form still accepted (auto-wrapped
   * to [pathPrefix]). Default if neither set: ["repo-event-bridge"].
   */
  readonly pathPrefixes?: readonly string[];
  /** @deprecated Use pathPrefixes (array). Single-string form preserved for compat. */
  readonly pathPrefix?: string;
}

/**
 * Adapter shape per W0.4 spike + bug-99 multi-prefix extension. Implements
 * StorageProviderWithTokenRead so cursor-store.ts consumes unchanged
 * (narrow-typed via hasGetWithToken probe).
 *
 * Operations outside cursor-store's used primitive set (list / put-unconditional /
 * delete) are stub-throw — Variant ii scope doesn't need them. Production adapter
 * would extend to full StorageProvider contract if external consumers emerge.
 */
export class RepoEventBridgeSubstrateAdapter implements StorageProviderWithTokenRead {
  readonly capabilities: ProviderCapabilities = {
    cas: true,
    durable: true,
    concurrent: true,
  };

  private readonly substrate: HubStorageSubstrate;
  private readonly pathPrefixes: readonly string[];

  constructor(opts: RepoEventBridgeSubstrateAdapterOptions) {
    this.substrate = opts.substrate;
    // Resolution order: pathPrefixes (array) > pathPrefix (single string compat) > default.
    if (opts.pathPrefixes && opts.pathPrefixes.length > 0) {
      this.pathPrefixes = opts.pathPrefixes;
    } else if (opts.pathPrefix) {
      this.pathPrefixes = [opts.pathPrefix];
    } else {
      this.pathPrefixes = ["repo-event-bridge"];
    }
  }

  // ── Path → (kind, id) mapping ────────────────────────────────────────────

  private parsePath(path: string): { kind: string; id: string } {
    // Find FIRST matching prefix from accept-list (path.startsWith); reject if none.
    let matchedPrefix: string | undefined;
    for (const candidate of this.pathPrefixes) {
      if (path.startsWith(`${candidate}/`)) {
        matchedPrefix = candidate;
        break;
      }
    }
    if (matchedPrefix === undefined) {
      throw new Error(
        `RepoEventBridgeSubstrateAdapter: path '${path}' outside accept-list ${JSON.stringify(this.pathPrefixes)}`,
      );
    }
    const remainder = path.slice(matchedPrefix.length + 1);
    const slash = remainder.indexOf("/");
    if (slash < 0) {
      throw new Error(`RepoEventBridgeSubstrateAdapter: path '${path}' has no namespace segment`);
    }
    const namespace = remainder.slice(0, slash);
    const repoId = remainder.slice(slash + 1);

    let kind: string;
    switch (namespace) {
      case "cursor":
        kind = "RepoEventBridgeCursor";
        break;
      case "dedupe":
        kind = "RepoEventBridgeDedupe";
        break;
      default:
        throw new Error(`RepoEventBridgeSubstrateAdapter: unknown namespace '${namespace}' in path '${path}'`);
    }

    return { kind, id: repoId };
  }

  // ── StorageProvider primitives consumed by cursor-store.ts ──────────────

  async get(path: string): Promise<Uint8Array | null> {
    const { kind, id } = this.parsePath(path);
    const entity = await this.substrate.get<{ id: string; body: unknown }>(kind, id);
    if (!entity) return null;
    return enc.encode(JSON.stringify(entity.body));
  }

  async getWithToken(path: string): Promise<{ data: Uint8Array; token: string } | null> {
    const { kind, id } = this.parsePath(path);
    const result = await this.substrate.getWithRevision<{ id: string; body: unknown }>(kind, id);
    if (!result) return null;
    return {
      data: enc.encode(JSON.stringify(result.entity.body)),
      token: result.resourceVersion,
    };
  }

  async createOnly(path: string, data: Uint8Array): Promise<CreateOnlyResult> {
    const { kind, id } = this.parsePath(path);
    const body = JSON.parse(dec.decode(data));
    const result = await this.substrate.createOnly(kind, { id, body });
    if (result.ok) return { ok: true };
    return { ok: false };
  }

  async putIfMatch(path: string, data: Uint8Array, ifMatchToken: string): Promise<PutIfMatchResult> {
    const { kind, id } = this.parsePath(path);
    const body = JSON.parse(dec.decode(data));
    try {
      const result = await this.substrate.putIfMatch(kind, { id, body }, ifMatchToken);
      if (result.ok) return { ok: true, newToken: result.resourceVersion };
      return { ok: false, currentToken: result.actualRevision };
    } catch (err) {
      // substrate.putIfMatch throws on absent entity; map to StoragePathNotFoundError
      // for cursor-store compatibility
      if (err instanceof Error && /putIfMatch on absent entity/.test(err.message)) {
        throw new StoragePathNotFoundError(path);
      }
      throw err;
    }
  }

  // ── Unused-by-cursor-store primitives (stub-throw; Variant ii scope) ────

  async put(_path: string, _data: Uint8Array): Promise<void> {
    throw new Error("RepoEventBridgeSubstrateAdapter: unconditional put not implemented (Variant ii scope; use createOnly + putIfMatch)");
  }

  async delete(_path: string): Promise<void> {
    throw new Error("RepoEventBridgeSubstrateAdapter: delete not implemented (Variant ii scope; cursor-store does not delete)");
  }

  async list(_prefix: string): Promise<string[]> {
    throw new Error("RepoEventBridgeSubstrateAdapter: list not implemented (Variant ii scope; cursor-store does not list)");
  }
}

// Suppress unused-import warning; StorageProvider imported for type-import discipline
export type _SuppressedStorageProviderImport = StorageProvider;
