/**
 * filter-roundtrip-oracle.test.ts — C3-R4a (M-Shape-Conformance), the
 * renameMap-governor's BEHAVIORAL half (the backstop for the static drift-gate).
 *
 * For every substrate-FILTERABLE flat key (conformance/filterable-keys.ts), on a
 * FAITHFUL real-Postgres harness (testcontainers, per cal-79/82 — NOT memory),
 * prove the END-TO-END filter-translate path: put an envelope row carrying the
 * key's value at its renameMap-translated JSONB path, then `substrate.list` with
 * the FLAT filter key and assert the row comes back — AND a decoy row with a
 * different value does NOT (VALUE round-trip + discrimination, NOT count-parity,
 * per cal-80: a count-parity check passes while rows are raw/unmatched).
 *
 * This is the behavioral backstop the design names for keys the static scanner
 * cannot reach (helper-built / parametric — Agent.fingerprint, the Message helper
 * keys, etc.): even those are exercised here against real JSONB filtering. A
 * missing/mis-targeted renameMap entry → the translated query hits the wrong path
 * → the row is not returned → this test FAILS loud (the bug-138/bug-170 class).
 *
 * Cascade-dual-path / phantom keys (EXCLUDED_FILTERABLE_KEYS) are out of scope
 * here: they bypass renameMap translation (envelope-first dotted query) and are
 * R4b's collapse target.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createPostgresStorageSubstrate, createSchemaReconciler, ALL_SCHEMAS } from "../index.js";
import { SUBSTRATE_FILTERABLE_KEYS, EXCLUDED_FILTERABLE_KEYS } from "../conformance/filterable-keys.js";

const TEST_SETUP_TIMEOUT = 90_000;
const TEST_OP_TIMEOUT = 120_000;

const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];

/** Keys not exercised by the flat-translate oracle: cascade-dual-path/phantom
 *  (excluded; R4b) + `id` (the primary key, not a renameMap-translated field). */
function oracleKeysFor(kind: string): string[] {
  const excluded = EXCLUDED_FILTERABLE_KEYS[kind] ?? {};
  return (SUBSTRATE_FILTERABLE_KEYS[kind] ?? []).filter((k) => !(k in excluded) && k !== "id");
}

/** Set `val` at a (possibly dotted) JSONB path in a fresh row object. */
function setNested(obj: Record<string, unknown>, dottedKey: string, val: unknown): void {
  const parts = dottedKey.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i]!;
    if (typeof cur[seg] !== "object" || cur[seg] === null) cur[seg] = {};
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = val;
}

describe("C3-R4a renameMap-governor — filter value-round-trip oracle (real-pg, all filterable keys)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  // Concrete types (createPostgresStorageSubstrate exposes setFieldTranslator,
  // which the HubStorageSubstrate interface does not declare — index.ts wires it
  // the same way on the concrete substrate).
  let substrate: ReturnType<typeof createPostgresStorageSubstrate>;
  let reconciler: ReturnType<typeof createSchemaReconciler>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub")
      .withPassword("hub")
      .withDatabase("hub")
      .start();
    const connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = new Pool({ connectionString: connStr });
    for (const f of MIGRATION_FILES) {
      await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    }
    substrate = createPostgresStorageSubstrate(connStr);
    reconciler = createSchemaReconciler(substrate, connStr, { initialSchemas: ALL_SCHEMAS });
    await reconciler.start();
    // Wire the renameMap field-translator exactly as the production Hub does
    // (index.ts) so substrate.list({filter:{flatKey}}) translates to the JSONB path.
    substrate.setFieldTranslator((kind, bareKey) => reconciler.getFieldTranslation(kind, bareKey));
  }, TEST_SETUP_TIMEOUT);

  afterAll(async () => {
    if (reconciler) await reconciler.close();
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, TEST_OP_TIMEOUT);

  it(
    "every filterable flat key round-trips by VALUE through real-pg filter-translate (match returned, decoy excluded)",
    async () => {
      const failures: string[] = [];
      let exercised = 0;

      for (const kind of Object.keys(SUBSTRATE_FILTERABLE_KEYS)) {
        for (const flatKey of oracleKeysFor(kind)) {
          // Translated JSONB path (renameMap), or the bare key if unmoved.
          const envPath = reconciler.getFieldTranslation(kind, flatKey) ?? flatKey;
          const sentinel = `__RT_${kind}_${flatKey.replace(/\W/g, "_")}__`;
          const decoy = `${sentinel}_DECOY`;
          const matchId = `rt-${kind}-${flatKey.replace(/\W/g, "_")}-match`;
          const decoyId = `rt-${kind}-${flatKey.replace(/\W/g, "_")}-decoy`;

          const matchRow: Record<string, unknown> = { id: matchId };
          setNested(matchRow, envPath, sentinel);
          const decoyRow: Record<string, unknown> = { id: decoyId };
          setNested(decoyRow, envPath, decoy);

          await substrate.put(kind, matchRow);
          await substrate.put(kind, decoyRow);

          const { items } = await substrate.list<{ id: string }>(kind, { filter: { [flatKey]: sentinel }, limit: 500 });
          const ids = new Set(items.map((r) => r.id));
          exercised++;

          if (!ids.has(matchId)) {
            failures.push(`${kind}.${flatKey}: match row NOT returned (filter translated '${flatKey}'→'${envPath}' missed the value — renameMap gap?)`);
          }
          if (ids.has(decoyId)) {
            failures.push(`${kind}.${flatKey}: decoy row WAS returned (filter did not discriminate by value — count-parity false-pass, cal-80)`);
          }
        }
      }

      expect(exercised, "oracle exercised zero keys — wiring broken").toBeGreaterThan(10);
      expect(failures, `filter value-round-trip failures:\n  ${failures.join("\n  ")}`).toEqual([]);
    },
    TEST_OP_TIMEOUT,
  );
});
