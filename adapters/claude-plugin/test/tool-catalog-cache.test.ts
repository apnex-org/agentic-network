/**
 * Unit tests for tool-catalog-cache (mission-40 T4; bug-114 ETag re-key).
 *
 * Pins the cache helper contracts:
 *   - readCache returns null on missing / parse-error / schema-mismatch / shape-mismatch
 *   - readCache returns null on a v1 (`hubVersion`-shape) cache — the
 *     CATALOG_SCHEMA_VERSION 1→2 bump is the bug-114 state-migration step
 *   - writeCache is atomic (tmp + rename); partial writes don't leave a corrupt cache
 *   - writeCache is best-effort (non-fatal on filesystem failure)
 *   - isCacheValid checks tool-surface-revision equality
 *   - isCacheValid trusts cache when currentRevision is null/undefined/empty (probe-friendly)
 *   - schema-version mismatch is detected on read (not deferred to runtime)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CATALOG_SCHEMA_VERSION,
  cachePathFor,
  readCache,
  writeCache,
  isCacheValid,
  type CachedCatalog,
} from "@apnex/network-adapter";

const SAMPLE_CATALOG: CachedCatalog["catalog"] = [
  { name: "get_agents", description: "[Any] List teles" },
  { name: "create_thread", description: "[Any] Open a thread" },
];

const REV_A = "a1b2c3d4e5f6a7b8";
const REV_B = "ffffffff00000000";

describe("tool-catalog-cache — readCache", () => {
  let workDir: string;
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "ois-cache-test-"));
    mkdirSync(join(workDir, ".ois"), { recursive: true });
  });
  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("returns null when cache file missing (fresh install)", () => {
    expect(readCache(workDir)).toBeNull();
  });

  it("returns null on parse error (corrupt JSON)", () => {
    const path = cachePathFor(workDir);
    writeFileSync(path, "{ not valid json", "utf8");
    const log: string[] = [];
    expect(readCache(workDir, (m) => log.push(m))).toBeNull();
    expect(log.some((m) => m.includes("parse error"))).toBe(true);
  });

  it("returns null on schema-version mismatch (forces re-bootstrap)", () => {
    const path = cachePathFor(workDir);
    const stale = {
      schemaVersion: 999,
      toolSurfaceRevision: REV_A,
      fetchedAt: new Date().toISOString(),
      catalog: SAMPLE_CATALOG,
    };
    writeFileSync(path, JSON.stringify(stale), "utf8");
    const log: string[] = [];
    expect(readCache(workDir, (m) => log.push(m))).toBeNull();
    expect(log.some((m) => m.includes("schema/shape mismatch"))).toBe(true);
  });

  it("returns null on a v1 (`hubVersion`-shape) cache — bug-114 schema-bump migration", () => {
    // The pre-bug-114 cache shape: schemaVersion 1, `hubVersion` field,
    // no `toolSurfaceRevision`. The 1→2 bump means every such on-disk
    // cache fails the read-time check and re-bootstraps. This is the
    // free retroactive cleanup of the fleet's stale caches.
    const path = cachePathFor(workDir);
    const v1Cache = {
      schemaVersion: 1,
      hubVersion: "1.0.0",
      fetchedAt: new Date().toISOString(),
      catalog: SAMPLE_CATALOG,
    };
    writeFileSync(path, JSON.stringify(v1Cache), "utf8");
    expect(readCache(workDir)).toBeNull();
  });

  it("returns null on shape mismatch (missing required fields)", () => {
    const path = cachePathFor(workDir);
    writeFileSync(path, JSON.stringify({ schemaVersion: CATALOG_SCHEMA_VERSION /* toolSurfaceRevision etc missing */ }), "utf8");
    expect(readCache(workDir)).toBeNull();
  });

  it("returns the cache on a well-formed file", () => {
    const path = cachePathFor(workDir);
    const body = {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      toolSurfaceRevision: REV_A,
      fetchedAt: "2026-04-22T05:00:00.000Z",
      catalog: SAMPLE_CATALOG,
    };
    writeFileSync(path, JSON.stringify(body), "utf8");
    const cached = readCache(workDir);
    expect(cached).toEqual(body);
  });
});

describe("tool-catalog-cache — writeCache", () => {
  let workDir: string;
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "ois-cache-test-"));
  });
  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("creates the cache directory if missing + writes a well-formed file", () => {
    expect(existsSync(join(workDir, ".ois"))).toBe(false);
    writeCache(workDir, SAMPLE_CATALOG, REV_A);
    const path = cachePathFor(workDir);
    expect(existsSync(path)).toBe(true);
    const body = JSON.parse(readFileSync(path, "utf8"));
    expect(body.schemaVersion).toBe(CATALOG_SCHEMA_VERSION);
    expect(body.toolSurfaceRevision).toBe(REV_A);
    expect(body.catalog).toEqual(SAMPLE_CATALOG);
    expect(typeof body.fetchedAt).toBe("string");
  });

  it("overwrites an existing cache atomically (no partial state visible)", () => {
    writeCache(workDir, SAMPLE_CATALOG, REV_A);
    const NEW_CATALOG: CachedCatalog["catalog"] = [{ name: "new_tool" }];
    writeCache(workDir, NEW_CATALOG, REV_B);
    const cached = readCache(workDir);
    expect(cached?.catalog).toEqual(NEW_CATALOG);
    expect(cached?.toolSurfaceRevision).toBe(REV_B);
  });

  it("is best-effort: a write to an unwritable WORK_DIR logs warning + does not throw", () => {
    // Use a path containing a NUL byte — Node.js immediately rejects with
    // ERR_INVALID_ARG_VALUE / ENOENT on first fs syscall. Avoids relying
    // on /proc, /dev, or chmod tricks that may behave differently across
    // kernels or hang in CI.
    const bogusWorkDir = "/tmp/ois-cache-test-\0-bogus";
    const log: string[] = [];
    expect(() => writeCache(bogusWorkDir, SAMPLE_CATALOG, REV_A, (m) => log.push(m))).not.toThrow();
    expect(log.some((m) => m.includes("writeCache: failed"))).toBe(true);
  });

  it("read-after-write round-trip preserves all fields exactly", () => {
    writeCache(workDir, SAMPLE_CATALOG, REV_A);
    const cached = readCache(workDir);
    expect(cached).not.toBeNull();
    expect(cached?.schemaVersion).toBe(CATALOG_SCHEMA_VERSION);
    expect(cached?.toolSurfaceRevision).toBe(REV_A);
    expect(cached?.catalog).toEqual(SAMPLE_CATALOG);
  });
});

describe("tool-catalog-cache — isCacheValid", () => {
  const cached: CachedCatalog = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    toolSurfaceRevision: REV_A,
    fetchedAt: new Date().toISOString(),
    catalog: SAMPLE_CATALOG,
  };

  it("returns true on exact tool-surface-revision match", () => {
    expect(isCacheValid(cached, REV_A)).toBe(true);
  });

  it("returns false on tool-surface-revision mismatch (forces re-bootstrap)", () => {
    expect(isCacheValid(cached, REV_B)).toBe(false);
  });

  it("returns FALSE (fail-closed) when current revision is null — mission-106 F4", () => {
    // Pre-mission-106 this returned true (probe-friendly "trust cache"), which
    // with the fire-and-forget /health warm losing the startup race rubber-stamped
    // a stale cache as valid and served it forever (the frozen-catalog defect).
    // Unknown freshness is NOT validity; the caller keeps the probe fast via a
    // LABELED-STALE serve + out-of-band repair, never a silent "valid" serve.
    expect(isCacheValid(cached, null)).toBe(false);
  });

  it("returns FALSE (fail-closed) when current revision is undefined or empty string — mission-106 F4", () => {
    expect(isCacheValid(cached, undefined)).toBe(false);
    expect(isCacheValid(cached, "")).toBe(false);
  });
});
