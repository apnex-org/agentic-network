/**
 * filter-translation-gap.test.ts — C3-R4b (M-Shape-Conformance), piece 1.
 *
 * Unit + integration coverage for FilterTranslationGapError: the runtime
 * fail-loud at the filter-translate path when a known envelope-partitioned kind
 * is filtered/sorted by a domain key with NO renameMap entry (the silent-miss
 * gap, bug-138/bug-170). The R4a drift-gate is the STATIC defense; this is the
 * runtime belt-and-suspenders. The throw arms only when BOTH the field-translator
 * AND the partitioned-kind oracle are wired (production / index.ts) — inert
 * otherwise, so it can never false-positive on an ad-hoc kind.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createPostgresStorageSubstrate, createSchemaReconciler, ALL_SCHEMAS } from "../index.js";
import {
  translateKeyOrThrow,
  isReservedOrBucketKey,
  FilterTranslationGapError,
} from "../filter-translation-error.js";

// ─── Unit: the pure translate-or-throw logic ────────────────────────────────

describe("C3-R4b translateKeyOrThrow — gap detection (unit)", () => {
  const RENAME: Record<string, Record<string, string>> = {
    Bug: { status: "status.phase", sourceThreadId: "metadata.sourceThreadId" },
  };
  const lookup = (kind: string, key: string): string | null => RENAME[kind]?.[key] ?? null;
  const isPartitioned = (kind: string): boolean => kind in RENAME;

  it("translates a covered key to its envelope path", () => {
    expect(translateKeyOrThrow("Bug", "status", lookup, isPartitioned)).toBe("status.phase");
    expect(translateKeyOrThrow("Bug", "sourceThreadId", lookup, isPartitioned)).toBe("metadata.sourceThreadId");
  });

  it("THROWS on a partitioned kind's uncovered domain key (the silent-miss gap)", () => {
    expect(() => translateKeyOrThrow("Bug", "severity", lookup, isPartitioned)).toThrow(FilterTranslationGapError);
    expect(() => translateKeyOrThrow("Bug", "newField", lookup, isPartitioned)).toThrow(/filter-translation gap/);
  });

  it("does NOT throw for envelope top-level reserved keys", () => {
    for (const k of ["id", "name", "kind", "apiVersion"]) {
      expect(translateKeyOrThrow("Bug", k, lookup, isPartitioned)).toBe(k);
    }
  });

  it("does NOT throw for an already-translated bucket-prefixed path", () => {
    expect(translateKeyOrThrow("Bug", "metadata.sourceThreadId", lookup, isPartitioned)).toBe("metadata.sourceThreadId");
    expect(translateKeyOrThrow("Bug", "spec.severity", lookup, isPartitioned)).toBe("spec.severity");
  });

  it("does NOT throw for an unknown / ad-hoc kind (inert — bare key passes through)", () => {
    expect(translateKeyOrThrow("AdHocKind", "whatever", lookup, isPartitioned)).toBe("whatever");
  });

  it("isReservedOrBucketKey classifies reserved/bucket vs domain keys", () => {
    expect(isReservedOrBucketKey("id")).toBe(true);
    expect(isReservedOrBucketKey("metadata.x")).toBe(true);
    expect(isReservedOrBucketKey("status.phase")).toBe(true);
    expect(isReservedOrBucketKey("severity")).toBe(false);
    expect(isReservedOrBucketKey("sourceThreadId")).toBe(false);
  });
});

// ─── Integration: the real postgres substrate, both hooks wired (production shape) ─

describe("C3-R4b FilterTranslationGapError — real postgres substrate (integration)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let substrate: ReturnType<typeof createPostgresStorageSubstrate>;
  let reconciler: ReturnType<typeof createSchemaReconciler>;

  const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
  const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    const connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = new Pool({ connectionString: connStr });
    for (const f of MIGRATION_FILES) await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    substrate = createPostgresStorageSubstrate(connStr);
    reconciler = createSchemaReconciler(substrate, connStr, { initialSchemas: ALL_SCHEMAS });
    await reconciler.start();
    // Production wiring (index.ts): both the translator AND the partitioned-kind oracle.
    substrate.setFieldTranslator((kind, bareKey) => reconciler.getFieldTranslation(kind, bareKey));
    substrate.setPartitionedKindCheck((kind) => reconciler.hasTranslations(kind));
  }, 90_000);

  afterAll(async () => {
    if (reconciler) await reconciler.close();
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, 120_000);

  it("list THROWS on a partitioned kind filtered by an uncovered domain key (gap)", async () => {
    // 'description' is a real Bug field (encoder → spec) but NOT in Bug's renameMap →
    // a bare-path query would silently miss → fail loud.
    await expect(substrate.list("Bug", { filter: { description: "x" } })).rejects.toThrow(FilterTranslationGapError);
  }, 60_000);

  it("list does NOT throw for a renameMap-covered key", async () => {
    await expect(substrate.list("Bug", { filter: { status: "open" } })).resolves.toBeDefined();
  }, 60_000);

  it("list does NOT throw for a now-covered cascade key (R4b collapse)", async () => {
    await expect(substrate.list("Bug", { filter: { sourceThreadId: "thread-x" } })).resolves.toBeDefined();
  }, 60_000);

  it("list does NOT throw for an unknown / ad-hoc kind (inert)", async () => {
    await expect(substrate.list("AdHocKind", { filter: { whatever: "x" } })).resolves.toBeDefined();
  }, 60_000);
});
