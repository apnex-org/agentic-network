/**
 * mission-86 W2 — bug-101 fix: Hub bootstrap migration-apply.
 *
 * The Hub applies its substrate migrations (`migrations/*.sql`) at bootstrap,
 * BEFORE the SchemaReconciler runs — so it boots cleanly against a fresh empty
 * postgres with no manual SQL. (bug-101: the reconciler INSERTs SchemaDef rows
 * into `entities`, which must already exist; without this step the Hub
 * crash-loops on `relation "entities" does not exist`.)
 *
 * The migration .sql files are authored idempotent — `IF NOT EXISTS` /
 * `CREATE OR REPLACE` / `DROP ... IF EXISTS` (mission-83 §2.3 restart-safety) —
 * so re-running every migration is a no-op. No migration-tracking table is
 * needed; 2nd-boot / restart is safe (AG-W2.2.b).
 *
 * The .sql files are copied into dist/ by the `build` script
 * (hub/package.json: `tsc && cp -r src/storage-substrate/migrations dist/...`).
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Apply every storage-substrate migration, in filename order, against the
 * target postgres. Throws on the first failure — the Hub bootstrap then
 * fatal-exits, so the operator sees fail-to-start + the error (mirrors the
 * SchemaReconciler's STRICT fail-loud discipline; no silent degradation).
 */
export async function applyMigrations(
  connectionString: string,
  log: (msg: string) => void = (m) => console.log(`[Hub:migrations] ${m}`),
): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    throw new Error(`[migration-runner] no .sql migrations found in ${MIGRATIONS_DIR}`);
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
      await client.query(sql);
      log(`applied ${file}`);
    }
    log(`bootstrap migrations complete (${files.length} applied)`);
  } finally {
    await client.end();
  }
}
