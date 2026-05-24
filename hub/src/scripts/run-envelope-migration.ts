#!/usr/bin/env node
/**
 * mission-88 W6.1 — MigrationRunner CLI entry-point (bug-119 hotfix).
 *
 * Per thread-649 R2 architect-ratified disposition: standalone CLI driver for
 * MigrationRunner. Separates production-runtime invocation path from Hub bootstrap
 * hot-path (Hub-restart doesn't trigger migration; operator-invokes this CLI
 * explicitly at cutover).
 *
 * Invoked by `scripts/operator/m-k8s-envelope-cutover.sh` Step 2 via
 * `cd hub && npm run envelope-migrate [-- --dry-run] [-- --json]`.
 *
 * ─── Behavior per architect R2 disposition ────────────────────────────────
 *
 * - Imports + registers all 21 KindMigrationModule (cluster-1+2+3+4+5)
 * - Invokes runKind per-kind concurrently (per W0 MigrationRunner design;
 *   per-kind cursor isolation proven W1-W5)
 * - Reports per-kind state to stdout (structured-text default; --json opt-in)
 * - Per-kind line shape:
 *     [envelope-migrate] kind=<K> rowsMigrated=<N> rowsErrored=<E> rowsSkipped=<S> waveId=<W> elapsedMs=<ms>
 * - Summary footer:
 *     [envelope-migrate] SUMMARY: <K> kinds; <T> total rowsMigrated; <T> total rowsErrored; <T> elapsed-ms; exit-code=<E>
 * - JSON mode (--json): structured JSON per-kind + summary array (machine-grep-able)
 * - Exit codes:
 *     0 — all kinds rowsErrored=0; success
 *     1 — any kind rowsErrored > 0 (substrate-write-fail; cutover rollback-trigger 1)
 *     2 — DB connection failure (pre-flight or mid-run; transient; halt-not-rollback)
 *     3 — module-registration-failure (CLI-internal; bug-class)
 *     4 — unhandled exception (defensive; bug-class)
 * - --dry-run flag: inventory-mode; reports what WOULD migrate; no writes;
 *   MigrationCursor cursor advancement NOT applied (per migration-runner.ts:118 contract)
 *
 * Per Q5 disposition: re-uses no new test fixtures; integration test invokes this
 * CLI as subprocess against testcontainer-postgres (per harness/fixtures.ts pattern).
 */

import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { createPostgresStorageSubstrate, type HubStorageSubstrate } from "../storage-substrate/index.js";
import { MigrationRunner, type MigrationRunOptions, type MigrationRunResult } from "../storage-substrate/migrations/v2-envelope/migration-runner.js";
import { ALL_SCHEMAS } from "../storage-substrate/schemas/all-schemas.js";

// ─── Module imports (all 21 KindMigrationModule per W1-W5 ship) ──────────────

import { createIdeaMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/Idea.js";
import { createBugMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/Bug.js";
import { createThreadMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/Thread.js";
import { createMissionMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/Mission.js";
import { createProposalMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/Proposal.js";
import { createTaskMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/Task.js";
import { createPendingActionMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/PendingAction.js";
import { createTurnMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/Turn.js";
import { createAgentMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/Agent.js";
import { createTeleMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/Tele.js";
import { createSchemaDefMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/SchemaDef.js";
import { createCounterMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/Counter.js";
import { createMessageMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/Message.js";
import { createAuditMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/Audit.js";
import { createRepoEventBridgeCursorMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/RepoEventBridgeCursor.js";
import { createRepoEventBridgeDedupeMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/RepoEventBridgeDedupe.js";
import { createDocumentMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/Document.js";
import { createArchitectDecisionMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/ArchitectDecision.js";
import { createDirectorHistoryEntryMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/DirectorHistoryEntry.js";
import { createReviewHistoryEntryMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/ReviewHistoryEntry.js";
import { createThreadHistoryEntryMigrationModule } from "../storage-substrate/migrations/v2-envelope/kinds/ThreadHistoryEntry.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const WAVE_ID = "W6.1";

const EXIT_SUCCESS = 0;
const EXIT_ROWS_ERRORED = 1;
const EXIT_DB_CONNECTION = 2;
const EXIT_MODULE_REGISTRATION = 3;
const EXIT_UNHANDLED = 4;

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface CliOpts {
  dryRun: boolean;
  json: boolean;
}

function parseArgs(argv: readonly string[]): CliOpts {
  const opts: CliOpts = { dryRun: false, json: false };
  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(EXIT_SUCCESS);
    } else if (arg.startsWith("--")) {
      console.error(`[envelope-migrate] unknown flag: ${arg}`);
      printUsage();
      process.exit(EXIT_MODULE_REGISTRATION);
    }
  }
  return opts;
}

function printUsage(): void {
  process.stderr.write(`Usage: node hub/dist/scripts/run-envelope-migration.js [--dry-run] [--json]

Options:
  --dry-run   Inventory mode; report what would migrate; no writes
  --json      Emit structured JSON output (default: human-readable text)
  -h, --help  Show this help

Env:
  POSTGRES_CONNECTION_STRING  Required; postgres connection string for the Hub substrate

Exit codes:
  0 — all kinds rowsErrored=0; success
  1 — any kind rowsErrored > 0 (substrate-write-fail; cutover rollback-trigger)
  2 — DB connection failure
  3 — CLI usage / module-registration failure
  4 — unhandled exception
`);
}

function registerAllModules(runner: MigrationRunner): void {
  const findSchema = (kind: string) => {
    const schema = ALL_SCHEMAS.find(s => s.kind === kind);
    if (!schema) {
      throw new Error(`SchemaDef not found for kind=${kind}`);
    }
    return schema;
  };

  // cluster-1 (5): substantive-content
  runner.register(createIdeaMigrationModule(findSchema("Idea")));
  runner.register(createBugMigrationModule(findSchema("Bug")));
  runner.register(createThreadMigrationModule(findSchema("Thread")));
  runner.register(createMissionMigrationModule(findSchema("Mission")));
  runner.register(createProposalMigrationModule(findSchema("Proposal")));

  // cluster-2 (3): queue/FSM-active
  runner.register(createTaskMigrationModule(findSchema("Task")));
  runner.register(createPendingActionMigrationModule(findSchema("PendingAction")));
  runner.register(createTurnMigrationModule(findSchema("Turn")));

  // cluster-3 (4): metadata/config/projection
  runner.register(createAgentMigrationModule(findSchema("Agent")));
  runner.register(createTeleMigrationModule(findSchema("Tele")));
  runner.register(createSchemaDefMigrationModule(findSchema("SchemaDef")));
  runner.register(createCounterMigrationModule(findSchema("Counter")));

  // cluster-4 (4): system-emit/bookkeeping
  runner.register(createMessageMigrationModule(findSchema("Message")));
  runner.register(createAuditMigrationModule(findSchema("Audit")));
  runner.register(createRepoEventBridgeCursorMigrationModule(findSchema("RepoEventBridgeCursor")));
  runner.register(createRepoEventBridgeDedupeMigrationModule(findSchema("RepoEventBridgeDedupe")));

  // cluster-5 (5): content-archive
  runner.register(createDocumentMigrationModule(findSchema("Document")));
  runner.register(createArchitectDecisionMigrationModule(findSchema("ArchitectDecision")));
  runner.register(createDirectorHistoryEntryMigrationModule(findSchema("DirectorHistoryEntry")));
  runner.register(createReviewHistoryEntryMigrationModule(findSchema("ReviewHistoryEntry")));
  runner.register(createThreadHistoryEntryMigrationModule(findSchema("ThreadHistoryEntry")));
}

interface PerKindReport {
  kind: string;
  rowsMigrated: number;
  rowsErrored: number;
  rowsSkipped: number;
  waveId: string;
  elapsedMs: number;
  errors: Array<{ id: string; message: string }>;
}

function formatPerKindText(report: PerKindReport): string {
  return `[envelope-migrate] kind=${report.kind} rowsMigrated=${report.rowsMigrated} rowsErrored=${report.rowsErrored} rowsSkipped=${report.rowsSkipped} waveId=${report.waveId} elapsedMs=${report.elapsedMs}`;
}

function formatSummaryText(reports: PerKindReport[], exitCode: number): string {
  const totalMigrated = reports.reduce((acc, r) => acc + r.rowsMigrated, 0);
  const totalErrored = reports.reduce((acc, r) => acc + r.rowsErrored, 0);
  const totalElapsed = reports.reduce((acc, r) => acc + r.elapsedMs, 0);
  return `[envelope-migrate] SUMMARY: ${reports.length} kinds; ${totalMigrated} total rowsMigrated; ${totalErrored} total rowsErrored; ${totalElapsed} elapsed-ms; exit-code=${exitCode}`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));

  const connStr = process.env.POSTGRES_CONNECTION_STRING;
  if (!connStr) {
    console.error("[envelope-migrate] FATAL: POSTGRES_CONNECTION_STRING env-var is required");
    return EXIT_DB_CONNECTION;
  }

  let substrate: HubStorageSubstrate;
  try {
    substrate = createPostgresStorageSubstrate(connStr);
  } catch (err) {
    console.error(`[envelope-migrate] FATAL: substrate connection failed — ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_DB_CONNECTION;
  }

  const runner = new MigrationRunner(substrate);
  try {
    registerAllModules(runner);
  } catch (err) {
    console.error(`[envelope-migrate] FATAL: module registration failed — ${err instanceof Error ? err.message : String(err)}`);
    await substrate.close();
    return EXIT_MODULE_REGISTRATION;
  }

  const kinds = runner.registeredKinds();
  if (!opts.json) {
    console.log(`[envelope-migrate] starting wave=${WAVE_ID} kinds=${kinds.length} dryRun=${opts.dryRun}`);
  }

  const runOpts: MigrationRunOptions = {
    waveId: WAVE_ID,
    ...(opts.dryRun ? { dryRun: true } : {}),
  };

  const reports: PerKindReport[] = [];
  // Per Q2 disposition: all-kinds-fully-concurrent per W0 MigrationRunner design
  // (per-kind cursor isolation proven W1-W5; production has 22,557 entities bounded;
  // concurrent migration <60s per A1 W6 estimate).
  const promises = kinds.map(async (kind): Promise<PerKindReport> => {
    const t0 = Date.now();
    let result: MigrationRunResult;
    try {
      result = await runner.runKind(kind, runOpts);
    } catch (err) {
      const elapsedMs = Date.now() - t0;
      return {
        kind,
        rowsMigrated: 0,
        rowsErrored: 1,
        rowsSkipped: 0,
        waveId: WAVE_ID,
        elapsedMs,
        errors: [{ id: "<runner>", message: err instanceof Error ? err.message : String(err) }],
      };
    }
    const elapsedMs = Date.now() - t0;
    return {
      kind: result.kind,
      rowsMigrated: result.rowsMigrated,
      rowsErrored: result.rowsErrored,
      rowsSkipped: result.rowsSkipped,
      waveId: WAVE_ID,
      elapsedMs,
      errors: result.errors,
    };
  });

  const settled = await Promise.all(promises);
  reports.push(...settled);

  const totalErrored = reports.reduce((acc, r) => acc + r.rowsErrored, 0);
  const exitCode = totalErrored > 0 ? EXIT_ROWS_ERRORED : EXIT_SUCCESS;

  if (opts.json) {
    console.log(JSON.stringify({ wave: WAVE_ID, dryRun: opts.dryRun, exitCode, perKind: reports }, null, 2));
  } else {
    for (const report of reports) {
      console.log(formatPerKindText(report));
    }
    console.log(formatSummaryText(reports, exitCode));
    if (totalErrored > 0) {
      console.error("[envelope-migrate] errors (per-kind id + message):");
      for (const report of reports) {
        for (const err of report.errors) {
          console.error(`[envelope-migrate]   kind=${report.kind} id=${err.id} msg=${err.message}`);
        }
      }
    }
  }

  await substrate.close();
  return exitCode;
}

// isMainModule guard (mission-88 W6.2 follow-on; thread-651 R2 architect-noted
// defense-in-depth): only fire main() when this module is invoked as the
// entry-point (e.g. `node dist/scripts/run-envelope-migration.js`). Per memory
// feedback_isMainModule_guard_symlink_safety — symlink-safe via realpathSync
// of process.argv[1]. Prevents main() from firing if any sibling test or
// internal-fn unit test ever imports this module into its graph.
const isEntryPoint = (() => {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isEntryPoint) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("[envelope-migrate] FATAL: unhandled exception");
      console.error(err);
      process.exit(EXIT_UNHANDLED);
    });
}
