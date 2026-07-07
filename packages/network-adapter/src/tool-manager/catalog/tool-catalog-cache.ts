/**
 * tool-catalog-cache.ts — per-WORK_DIR Hub tool catalog cache.
 *
 * Probe-safe ListTools support: when the host calls tools/list before
 * the adapter's identityReady has resolved (e.g. `claude mcp list`
 * spawning the adapter just to enumerate available tools), the
 * dispatcher serves the catalog from a persisted cache without
 * touching the Hub. Together with the lazy session-claim path this
 * makes probes fully Hub-free against a warm cache.
 *
 * Storage: $WORK_DIR/.ois/tool-catalog.json
 *   {
 *     schemaVersion: 2,
 *     toolSurfaceRevision: "a1b2c3d4e5f6a7b8",
 *     fetchedAt: "2026-04-22T...Z",
 *     catalog: [...]
 *   }
 *
 * Invalidation: tool-surface-revision mismatch (bug-114). The cache is
 * keyed off a Hub-owned ETag (`/health` `toolSurfaceRevision`) that
 * tracks the actual tool surface — added/removed tools, description or
 * schema changes — rather than `hubVersion`, which was a hardcoded
 * `"1.0.0"` literal that never changed (so the cache never invalidated).
 * No TTL — the revision detects drift directly. Schema-version mismatch
 * on read returns null (cache treated as invalid; schema evolution bumps
 * CATALOG_SCHEMA_VERSION).
 *
 * Atomicity: writeCache uses tmp-file + rename so partial writes on
 * crash don't corrupt the cache. Parse errors on read also return
 * null — the cache self-heals on next bootstrap.
 *
 * Failure modes (best-effort; readCache + writeCache never throw on
 * the primary flow):
 *   - missing file:           readCache returns null
 *   - parse error:            readCache returns null + logs
 *   - schema-version mismatch: readCache returns null + logs +
 *                              unlinks the stale file (bug-114
 *                              fallback-gap hardening — forces clean
 *                              rebuild on next bootstrap)
 *   - $WORK_DIR readonly:     writeCache logs + no-ops
 *   - disk full:              writeCache logs + no-ops
 */

import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";

/**
 * Bumping CATALOG_SCHEMA_VERSION forces all existing cache files to
 * be treated as invalid + re-bootstrapped. Use when changing the
 * cache file shape.
 *
 * 1 → 2 (bug-114): `hubVersion` field replaced by `toolSurfaceRevision`.
 * The bump is the state-migration step — every on-disk cache written in
 * the v1 (`hubVersion`) shape fails the read-time schema check, returns
 * null, and re-bootstraps. Free retroactive cleanup of the whole fleet's
 * stale caches.
 */
export const CATALOG_SCHEMA_VERSION = 2;

/**
 * MCP tool catalog entry shape. Kept loose (`unknown[]`) since the
 * cache is opaque storage; the dispatcher hands the catalog back to
 * the host without re-shaping.
 */
export type ToolCatalog = unknown[];

export interface CachedCatalog {
  schemaVersion: number;
  /**
   * bug-114 — the Hub-owned tool-surface ETag seen at fetch-time
   * (`/health` `toolSurfaceRevision`). The cache is valid while this
   * matches the live revision; treated as opaque (record-then-compare).
   */
  toolSurfaceRevision: string;
  fetchedAt: string;
  catalog: ToolCatalog;
}

/** Compute the canonical cache path for a given WORK_DIR. */
export function cachePathFor(workDir: string): string {
  return join(workDir, ".ois", "tool-catalog.json");
}

/**
 * Read the cache file. Returns null on missing file, parse error,
 * schema-version mismatch, or shape mismatch. Never throws — the
 * primary ListTools flow always falls through to a live Hub fetch
 * when readCache returns null.
 */
export function readCache(
  workDir: string,
  log?: (msg: string) => void,
): CachedCatalog | null {
  const path = cachePathFor(workDir);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<CachedCatalog>;
    if (
      typeof parsed.schemaVersion !== "number" ||
      parsed.schemaVersion !== CATALOG_SCHEMA_VERSION ||
      typeof parsed.toolSurfaceRevision !== "string" ||
      typeof parsed.fetchedAt !== "string" ||
      !Array.isArray(parsed.catalog)
    ) {
      log?.(
        `[tool-catalog-cache] readCache: cache invalid (schema/shape mismatch) at ${path} — unlinking to force clean rebuild`,
      );
      // bug-114 fallback-gap hardening (2026-05-26): unlink the stale
      // file so the next bootstrap doesn't repeatedly read-then-discard
      // it. Without this, every cold-start after a
      // CATALOG_SCHEMA_VERSION bump re-encounters the same stale file
      // until operator intervention. Best-effort; primary flow tolerates
      // unlink failures.
      try {
        unlinkSync(path);
      } catch (unlinkErr) {
        log?.(
          `[tool-catalog-cache] readCache: unlink failed (non-fatal): ${(unlinkErr as Error).message ?? unlinkErr}`,
        );
      }
      return null;
    }
    return {
      schemaVersion: parsed.schemaVersion,
      toolSurfaceRevision: parsed.toolSurfaceRevision,
      fetchedAt: parsed.fetchedAt,
      catalog: parsed.catalog,
    };
  } catch (err) {
    log?.(
      `[tool-catalog-cache] readCache: parse error at ${path}: ${(err as Error).message ?? err}`,
    );
    return null;
  }
}

/**
 * Persist the catalog atomically. Writes a sibling tmp file then
 * renames — so a crash mid-write leaves either the previous cache
 * intact OR the new cache fully landed. Best-effort on the primary
 * ListTools flow (never throws), but mission-106 (F5) needs the
 * outcome: returns `true` iff the atomic rename landed, `false` on any
 * failure (dir/write/rename). The reconciler's disk-repair path uses
 * this to decide convergence — a failed write must NOT be counted as
 * repaired (the stale disk stays visible for the next reconcile tick).
 */
export function writeCache(
  workDir: string,
  catalog: ToolCatalog,
  toolSurfaceRevision: string,
  log?: (msg: string) => void,
): boolean {
  const path = cachePathFor(workDir);
  const tmpPath = `${path}.tmp.${process.pid}`;
  const body: CachedCatalog = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    toolSurfaceRevision,
    fetchedAt: new Date().toISOString(),
    catalog,
  };
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(tmpPath, JSON.stringify(body), { encoding: "utf8" });
    renameSync(tmpPath, path);
    return true;
  } catch (err) {
    log?.(
      `[tool-catalog-cache] writeCache: failed at ${path}: ${(err as Error).message ?? err} — cache will not populate this run`,
    );
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    return false;
  }
}

/**
 * Check cache validity against the current Hub tool-surface revision.
 *
 * mission-106 (F4 — fail CLOSED on unknown revision): validity means a
 * DEFINITIVE equal revision, nothing else.
 *   - currentRevision is a non-empty string: strict equality vs
 *     cached.toolSurfaceRevision. Mismatch → NOT valid.
 *   - currentRevision is null/undefined/empty: the caller does not yet know
 *     the live revision (the /health warm is fire-and-forget — shim.ts — and
 *     loses the race to the host's startup tools/list). Unknown freshness is
 *     NOT validity → return false. Pre-mission-106 this returned `true`
 *     (probe-friendly "trust the cache"), which rubber-stamped a stale cache
 *     as valid and served it FOREVER (the frozen-catalog defect). The caller
 *     (dispatcher) still keeps the probe path fast, but treats a false result
 *     as a LABELED-STALE serve (serve warm cache + log STALE + schedule an
 *     out-of-band repair), never a silent "valid" serve — correctness comes
 *     from the reconciler's disk repair, not from trusting an unknown revision.
 *
 * Schema-version check is enforced inside readCache, so isCacheValid
 * never sees a wrong-schema cached object.
 */
export function isCacheValid(
  cached: CachedCatalog,
  currentRevision: string | null | undefined,
): boolean {
  if (
    currentRevision === null ||
    currentRevision === undefined ||
    currentRevision === ""
  ) {
    return false;
  }
  return cached.toolSurfaceRevision === currentRevision;
}
