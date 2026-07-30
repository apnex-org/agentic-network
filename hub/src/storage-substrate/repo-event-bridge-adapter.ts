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
 * Path shape mapping (per Design v1.0 §2.3, id scheme amended by bug-471):
 *   <pathPrefix>/cursor/<repoId> → kind=RepoEventBridgeCursor, id=<pathPrefix>:<repoId>
 *   <pathPrefix>/dedupe/<repoId> → kind=RepoEventBridgeDedupe, id=<pathPrefix>:<repoId>
 *
 * 🔴 bug-471 — THE PREFIX IS PART OF THE ID AND THAT IS LOAD-BEARING. It previously was
 * NOT: `matchedPrefix` was computed, used only for the slice offset, and DISCARDED, so
 * `id` was the bare `<repoId>`. Paths were namespaced; ids were not. One adapter serves
 * BOTH `repo-event-bridge` and `repo-event-bridge-workflow-runs` (hub/src/index.ts), and
 * both poll sources receive the SAME repo list — so the two collapsed onto ONE substrate
 * row per kind. Verified in production: one `RepoEventBridgeCursor` row where there must
 * be two, holding a single `{etag, lastEventId}` slot. Those values are ENDPOINT-SPECIFIC:
 * an etag minted by `/events` is meaningless to `/actions/runs`, and an events `lastEventId`
 * is a nonsense high-water for workflow runs — so the sources were not merely overwriting
 * each other's position but storing type-incompatible values in one slot. The shared dedupe
 * row is worse: one source marking events seen makes the other skip them, which is SILENT
 * EVENT LOSS rather than churn.
 *
 * Entity body shape: substrate stores `{id: <pathPrefix>:<repoId>, body: <cursor-store-encoded-data>}`
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

/**
 * 🔴 bug-471 — A BRANDED SUBSTRATE ID THAT CANNOT BE BUILT WITHOUT ITS PATH PREFIX.
 *
 * The brand exists for exactly one reason: to make the defect unwritable rather than
 * merely discouraged. A plain `string` is NOT assignable here, so the pre-bug-471 line
 * `return { kind, id: repoId }` no longer compiles. The prefix is not optional context a
 * future reader can decide is redundant — it is a required argument of the only function
 * that can mint the type.
 *
 * This is the same move as `Pick<WorkItem, "suspended">` on the disposal predicate
 * (nodestate0/impl_seal_mint): narrow the type until the wrong call is a COMPILE ERROR
 * instead of a test failure. That precedent exists because knowing the rule demonstrably
 * did not stop me writing six hand-maintained copies of one three days later — a pattern
 * you can recite is not a pattern you have, so it belongs in the signature.
 */
export type RepoEventBridgeEntityId = string & { readonly __repoEventBridgeIdWithPrefix: unique symbol };

/**
 * The ONLY constructor for a RepoEventBridgeEntityId. Both parameters are required, so
 * the prefix cannot be dropped, defaulted, or passed as `undefined`.
 *
 * `:` is a safe separator: path prefixes are fixed internal literals
 * (`repo-event-bridge`, `repo-event-bridge-workflow-runs`) that contain no colon, and the
 * repoId segment is whatever followed the first `/` after the namespace. A colon appearing
 * inside a repoId is therefore unambiguous — only the FIRST colon separates.
 */
export function composeEntityId(pathPrefix: string, repoId: string): RepoEventBridgeEntityId {
  return `${pathPrefix}:${repoId}` as RepoEventBridgeEntityId;
}

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

  private parsePath(path: string): { kind: string; id: RepoEventBridgeEntityId } {
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

    // 🔴 bug-471: `composeEntityId` is the ONLY way to produce a RepoEventBridgeEntityId, and it
    // REQUIRES the prefix. `return { kind, id: repoId }` — the original line — is now a COMPILE
    // ERROR, because a bare string is not assignable to the branded return type. That is
    // deliberate: this defect will be reintroduced by a reader who sees the prefix used only for
    // a slice offset and concludes it is not needed downstream. A comment saying "keep the
    // prefix" is advice; a type that refuses the wrong call is enforcement.
    return { kind, id: composeEntityId(matchedPrefix, repoId) };
  }

  // ── StorageProvider primitives consumed by cursor-store.ts ──────────────
  //
  // mission-88 W4 cluster-4 envelope-shape atomic-ship per A1 (parallels W3
  // SubstrateCounter pattern):
  //
  //   Pre-W4: substrate stored flat `{id, body: <cursor-store-encoded-JSON>}`
  //   Post-W4: substrate stores envelope-shape per cluster-4 Design v0.3 §2.3-§2.4:
  //     RepoEventBridgeCursor: status.cursor carries opaque body (was top-level body)
  //     RepoEventBridgeDedupe: status.dedupe carries opaque body (was top-level body)
  //
  // Read: tolerant-dual-shape (envelope-shape if present, legacy-flat backward-compat).
  // Write: ALWAYS envelope-shape post-W4 atomic ship.
  //
  // Substrate-correctness rationale (A1 thread-646 R2): adapter writes must match
  // envelope shape or post-cluster-4 substrate state desynchronizes (Counter race-
  // clobber analog). Atomic ship eliminates the desync window.

  /** Per-kind status field name carrying the opaque cursor-store body. */
  private bodyStatusField(kind: string): "cursor" | "dedupe" {
    return kind === "RepoEventBridgeDedupe" ? "dedupe" : "cursor";
  }

  /**
   * Read the opaque body from either envelope-shape (post-W4) or legacy-flat
   * (pre-W4 backward-compat during dual-shape window). Returns null if entity
   * has no readable body shape.
   */
  private readBody(entity: unknown, kind: string): unknown | null {
    if (typeof entity !== "object" || entity === null) return null;
    const rec = entity as Record<string, unknown>;
    // Envelope-shape probe: has status.{cursor|dedupe}
    const status = rec.status as Record<string, unknown> | undefined;
    if (status && typeof status === "object") {
      const field = this.bodyStatusField(kind);
      if (field in status) return status[field];
    }
    // Legacy-flat backward-compat: top-level body field
    if ("body" in rec) return rec.body;
    return null;
  }

  /**
   * Construct envelope-shape entity for write. Preserves existing envelope fields
   * (metadata, spec, status.phase) when entity already envelope-shaped; otherwise
   * emits fresh envelope skeleton.
   */
  private buildEnvelopeWrite(
    existing: unknown,
    kind: string,
    id: string,
    body: unknown,
  ): { id: string; name: string; kind: string; apiVersion: string;
       metadata: Record<string, unknown>; spec: Record<string, unknown>;
       status: Record<string, unknown> } {
    const existingRec = (typeof existing === "object" && existing !== null
      ? existing as Record<string, unknown>
      : {}) as Record<string, unknown>;
    const existingStatus = (existingRec.status as Record<string, unknown> | undefined) ?? {};
    const field = this.bodyStatusField(kind);
    return {
      id,
      name: id,
      kind,
      apiVersion: "core.ois/v1",
      metadata: (existingRec.metadata as Record<string, unknown>) ?? {},
      spec: (existingRec.spec as Record<string, unknown>) ?? {},
      status: {
        ...existingStatus,
        phase: (existingStatus.phase as string | undefined) ?? "active",
        [field]: body,
      },
    };
  }

  async get(path: string): Promise<Uint8Array | null> {
    const { kind, id } = this.parsePath(path);
    const entity = await this.substrate.get<unknown>(kind, id);
    if (!entity) return null;
    const body = this.readBody(entity, kind);
    if (body === null) return null;
    return enc.encode(JSON.stringify(body));
  }

  async getWithToken(path: string): Promise<{ data: Uint8Array; token: string } | null> {
    const { kind, id } = this.parsePath(path);
    const result = await this.substrate.getWithRevision<unknown>(kind, id);
    if (!result) return null;
    const body = this.readBody(result.entity, kind);
    if (body === null) return null;
    return {
      data: enc.encode(JSON.stringify(body)),
      token: result.resourceVersion,
    };
  }

  async createOnly(path: string, data: Uint8Array): Promise<CreateOnlyResult> {
    const { kind, id } = this.parsePath(path);
    const body = JSON.parse(dec.decode(data));
    const envelope = this.buildEnvelopeWrite(undefined, kind, id, body);
    const result = await this.substrate.createOnly(kind, envelope);
    if (result.ok) return { ok: true };
    return { ok: false };
  }

  async putIfMatch(path: string, data: Uint8Array, ifMatchToken: string): Promise<PutIfMatchResult> {
    const { kind, id } = this.parsePath(path);
    const body = JSON.parse(dec.decode(data));
    // Read existing entity (any shape) to preserve envelope fields if present
    const existing = await this.substrate.get<unknown>(kind, id);
    const envelope = this.buildEnvelopeWrite(existing, kind, id, body);
    try {
      const result = await this.substrate.putIfMatch(kind, envelope, ifMatchToken);
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
