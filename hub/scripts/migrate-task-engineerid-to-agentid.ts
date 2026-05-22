#!/usr/bin/env tsx
/**
 * mission-87 W3 (idea-302) — migrate-task-engineerid-to-agentid
 *
 * State-migration: renames the Task entity's `assignedEngineerId` JSONB
 * key → `assignedAgentId` for every substrate Task row, completing the
 * mission-62 engineerId→agentId rename.
 *
 * Why (feedback_schema_rename_requires_state_migration): the W3
 * code-rename makes the Hub read/write `assignedAgentId`. Existing
 * substrate Task rows still carry the old `assignedEngineerId` key — the
 * renamed Hub would read null from them. This script renames the key in
 * place so persisted state matches the renamed code.
 *
 * Deploy-time step: run this AT the deploy that ships the W3-renamed Hub
 * code. Once the renamed code is live it expects `assignedAgentId`, so an
 * un-migrated DB strands every claimed Task's assignment. Tracked for the
 * Director alongside the mission-87 W1 hub.env operator step.
 *
 * Idempotent: the UPDATE's `WHERE data ? 'assignedEngineerId'` matches
 * zero rows after the first run; `DROP INDEX … IF EXISTS` is a no-op on
 * re-run. Safe to re-run.
 *
 * Also drops the orphaned `task_assigned_agent_idx` index — the W3
 * SchemaDef v2 renames it to `task_agent_idx`; the reconciler creates the
 * new index but cannot drop the old one (its `CREATE INDEX IF NOT EXISTS`
 * keys on name — it never ALTERs or drops an index in place).
 *
 * Usage:
 *   npm run migrate-task-engineerid-to-agentid -- [--target=<conn>] [--dry-run] [--verbose]
 *   (target defaults to $POSTGRES_CONNECTION_STRING)
 */

import pg from "pg";

const { Pool } = pg;

const OLD_KEY = "assignedEngineerId";
const NEW_KEY = "assignedAgentId";
const ORPHAN_INDEX = "task_assigned_agent_idx";

interface CliArgs {
  target: string;
  dryRun: boolean;
  verbose: boolean;
}

function parseCli(): CliArgs {
  const args: Partial<CliArgs> = { dryRun: false, verbose: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--verbose") args.verbose = true;
    else if (arg.startsWith("--target=")) args.target = arg.slice("--target=".length);
    else {
      console.error(`[migrate-task-agentid] unknown arg: ${arg}`);
      process.exit(2);
    }
  }
  args.target ??= process.env.POSTGRES_CONNECTION_STRING;
  if (!args.target) {
    console.error(
      "[migrate-task-agentid] no target — pass --target=<postgres-conn> or set POSTGRES_CONNECTION_STRING",
    );
    process.exit(2);
  }
  return args as CliArgs;
}

/**
 * Run the migration against an already-open pool. Exported so the test
 * can drive it against a testcontainer substrate without a subprocess.
 * Returns the number of Task rows renamed.
 */
export async function migrateTaskAgentId(
  pool: pg.Pool,
  opts: { dryRun?: boolean; log?: (msg: string) => void } = {},
): Promise<number> {
  const log = opts.log ?? (() => {});

  const pre = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM entities WHERE kind = 'Task' AND data ? $1`,
    [OLD_KEY],
  );
  const pending = parseInt(pre.rows[0]?.count ?? "0", 10);
  log(`Task rows carrying '${OLD_KEY}': ${pending}`);

  if (opts.dryRun) {
    log(`DRY-RUN — would rename ${pending} row(s) + drop index ${ORPHAN_INDEX}; no writes.`);
    return pending;
  }

  // Rename the JSONB key in place. `data - OLD_KEY` strips the old key;
  // `|| jsonb_build_object(NEW_KEY, data->OLD_KEY)` re-adds the value
  // under the new key. Both sub-expressions evaluate against the row's
  // original `data`, so a null-valued old key migrates to a null-valued
  // new key. `data ? OLD_KEY` is key-EXISTENCE, so explicit-null
  // assignments migrate too.
  const upd = await pool.query(
    `UPDATE entities
        SET data = (data - $1) || jsonb_build_object($2::text, data->$1),
            updated_at = NOW(),
            resource_version = nextval('entities_rv_seq')
      WHERE kind = 'Task' AND data ? $1`,
    [OLD_KEY, NEW_KEY],
  );
  const renamed = upd.rowCount ?? 0;
  log(`renamed '${OLD_KEY}' → '${NEW_KEY}' on ${renamed} Task row(s).`);

  // Drop the orphaned pre-rename index. CONCURRENTLY cannot run inside a
  // transaction block — pool.query() is auto-commit per statement, so
  // this is fine.
  await pool.query(`DROP INDEX CONCURRENTLY IF EXISTS ${ORPHAN_INDEX}`);
  log(`dropped orphaned index ${ORPHAN_INDEX} (if it existed).`);

  // Verify: zero Task rows should still carry the old key.
  const post = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM entities WHERE kind = 'Task' AND data ? $1`,
    [OLD_KEY],
  );
  const residual = parseInt(post.rows[0]?.count ?? "0", 10);
  if (residual !== 0) {
    throw new Error(`verification FAILED — ${residual} Task row(s) still carry '${OLD_KEY}'`);
  }
  log(`verified — 0 Task rows carry '${OLD_KEY}'.`);
  return renamed;
}

async function main(): Promise<void> {
  const args = parseCli();
  const redacted = args.target.replace(/:[^:@]+@/, ":***@");
  console.log(`[migrate-task-agentid] target=${redacted} dry-run=${args.dryRun}`);

  const pool = new Pool({ connectionString: args.target });
  try {
    await migrateTaskAgentId(pool, {
      dryRun: args.dryRun,
      log: (msg) => console.log(`[migrate-task-agentid] ${msg}`),
    });
    console.log("[migrate-task-agentid] migration complete.");
  } finally {
    await pool.end();
  }
}

// Run as a script only when invoked directly (not when imported by the test).
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[migrate-task-agentid] FATAL: ${(err as Error).message}`);
    process.exit(1);
  });
}
