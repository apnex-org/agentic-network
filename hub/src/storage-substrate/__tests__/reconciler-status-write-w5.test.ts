/**
 * mission-90 W5 — reconciler status-WRITE loop (idea-318 §2.8; Director scope-in).
 *
 * The reconciler now writes the REAL reconcile outcome (status.phase /
 * appliedVersion / reconcileError) back onto each SchemaDef row. The load-bearing
 * risk is self-trigger: the status-write put fires the reconciler's OWN watch-loop
 * (NOTIFY has no OLD-vs-NEW guard; substrate.put bumps resource_version
 * unconditionally) — a literal per-cycle write infinite-loops. W5 ships BOTH:
 *   (i)  converge-then-stop write semantics — put ONLY on a MATERIAL status change
 *        (NO lastReconciledAt refresh on no-op cycles);
 *   (ii) a runtimeLoop spec-equality guard — skip re-reconcile when the spec is
 *        unchanged (the status-write echo changes ONLY status → skipped).
 *
 * Gate (Design §4 W5 row):
 *   - status observably written on success (appliedVersion) + failure (reconcileError);
 *   - BOUNDED-STORM — one materially-changing event yields EXACTLY 1 reconcile +
 *     1 status-write + a guard-skipped echo, NOT unbounded;
 *   - restart-survival — status re-converges across restarts (not lost to the
 *     boot provisional clobber).
 *
 * Zero index-DDL churn WITH the write active (oid-stability across 3 restarts) is
 * covered by the existing W1.4 3×-restart test (renamemap-contract-w1.test.ts),
 * which now exercises this W5 reconciler with the status-write live.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import {
  createPostgresStorageSubstrate,
  createSchemaReconciler,
  buildEnvelopeWriteEncoder,
  type PostgresSubstrate,
  type SchemaReconciler,
  type SchemaDef,
} from "../index.js";

const SETUP_TIMEOUT = 90_000;
const OP_TIMEOUT = 60_000;
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Poll a predicate until true or timeout — robust to NOTIFY-propagation jitter
 *  under CI parallel-pg load (vs a bare fixed sleep that can under-wait). */
async function pollUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 8000, stepMs = 50): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(stepMs);
  }
  return false;
}
const FIELDS = [{ name: "id", type: "string", required: true }];

/** A bare runtime SchemaDef for boot. */
function defOf(kind: string, version: number, extra: Partial<SchemaDef> = {}): SchemaDef {
  return { kind, version, fields: FIELDS, indexes: [], watchable: true, ...extra } as SchemaDef;
}

/** A hand-crafted ENVELOPE SchemaDef row with an explicit (possibly stale) status,
 *  so we can drive the runtime path with a status that mismatches the real outcome. */
function envRow(kind: string, spec: Record<string, unknown>, status: Record<string, unknown>): Record<string, unknown> {
  return {
    id: kind, name: kind, kind: "SchemaDef", apiVersion: "core.ois/v1",
    metadata: { name: kind }, spec, status,
  };
}

type Row = { status: Record<string, unknown> } & Record<string, unknown>;

describe("W5 reconciler status-write (converge-then-stop + spec-equality guard)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let connStr: string;
  let substrate: PostgresSubstrate;
  const live: SchemaReconciler[] = [];

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = new Pool({ connectionString: connStr });
    for (const f of MIGRATION_FILES) await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    substrate = createPostgresStorageSubstrate(connStr);
    // Wire the W4 write-encoder exactly as Hub boot does — the status-write put is an
    // already-envelope row, so the encoder passes it through byte-identical; that
    // passthrough is what lets W5's status survive the encoder.
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    for (const r of live) await r.close().catch(() => {});
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, OP_TIMEOUT);

  beforeEach(async () => {
    await pool.query(`DELETE FROM entities WHERE kind='SchemaDef'`);
  });

  afterEach(async () => {
    for (const r of live) await r.close().catch(() => {});
    live.length = 0;
  });

  function reconciler(initialSchemas: SchemaDef[], logs: string[]): SchemaReconciler {
    const r = createSchemaReconciler(substrate, connStr, {
      initialSchemas,
      log: (m) => logs.push(m),
      warn: (m) => logs.push(`WARN ${m}`),
    });
    live.push(r);
    return r;
  }

  it("BOUNDED-STORM: a material status-write echoes exactly once and the spec-guard skips it", async () => {
    const logs: string[] = [];
    const r = reconciler([defOf("W5Storm", 1)], logs);
    await r.start();
    await sleep(300); // LISTEN active

    // A genuine spec-change (v2) whose status is STALE (appliedVersion=1) → the real
    // outcome (appliedVersion=2) differs → forces a MATERIAL status-write.
    await substrate.put("SchemaDef", envRow("W5Storm",
      { version: 2, fields: FIELDS, indexes: [], watchable: true },
      { phase: "applied", appliedVersion: 1, reconcileError: null, lastReconciledAt: "2026-01-01T00:00:00Z" }));
    // Wait for the reconcile to land (poll, not a fixed gamble), THEN give the
    // self-echo a settle window so an unbounded loop would reveal itself here.
    await pollUntil(() => logs.some((l) => /status-write kind=W5Storm/.test(l)));
    await sleep(500);

    const reReconciles = logs.filter((l) => /re-reconciling kind=W5Storm/.test(l)).length;
    const statusWrites = logs.filter((l) => /status-write kind=W5Storm/.test(l)).length;
    const skips = logs.filter((l) => /skip re-reconcile kind=W5Storm/.test(l)).length;

    expect(reReconciles, "exactly one real reconcile (the v2 change), not unbounded").toBe(1);
    expect(statusWrites, "exactly one status-write (the echo must NOT re-write)").toBe(1);
    expect(skips, "the status-write echo was skipped by the spec-equality guard").toBeGreaterThanOrEqual(1);

    const row = await substrate.get<Row>("SchemaDef", "W5Storm");
    expect(row?.status.appliedVersion, "appliedVersion converged 1 → 2").toBe(2);
    expect(row?.status.phase).toBe("applied");
  }, OP_TIMEOUT);

  it("spec-equality guard: a status-only re-put (spec unchanged) is skipped — no re-reconcile, no status-write", async () => {
    const logs: string[] = [];
    const r = reconciler([defOf("W5Guard", 1)], logs);
    await r.start();
    await sleep(300);
    const mark = logs.length;

    // Re-put the SAME spec (v1) with only the status differing (a new lastReconciledAt).
    // Spec-relevant signature is unchanged → the guard must skip it.
    await substrate.put("SchemaDef", envRow("W5Guard",
      { version: 1, fields: FIELDS, indexes: [], watchable: true },
      { phase: "applied", appliedVersion: 1, reconcileError: null, lastReconciledAt: "2099-12-31T00:00:00Z" }));
    await sleep(700);

    const after = logs.slice(mark);
    expect(after.filter((l) => /re-reconciling kind=W5Guard/.test(l)), "NOT re-reconciled").toHaveLength(0);
    expect(after.filter((l) => /status-write kind=W5Guard/.test(l)), "NOT re-written").toHaveLength(0);
    expect(after.filter((l) => /skip re-reconcile kind=W5Guard/.test(l)).length, "skipped by the guard").toBeGreaterThanOrEqual(1);
  }, OP_TIMEOUT);

  it("status-write on FAILURE: a runtime reconcile error surfaces phase='failed' + reconcileError", async () => {
    const logs: string[] = [];
    const r = reconciler([defOf("W5Fail", 1)], logs);
    await r.start();
    await sleep(300);

    // A spec-change (so the guard doesn't skip) carrying a MALFORMED renameMap →
    // applySchemaIndexes (buildFieldTranslationMap) throws → status-write 'failed'.
    await substrate.put("SchemaDef", envRow("W5Fail",
      { version: 2, fields: FIELDS, indexes: [], watchable: true, renameMap: { status: "not_a_valid_path" } },
      { phase: "applied", appliedVersion: 1, reconcileError: null, lastReconciledAt: "2026-01-01T00:00:00Z" }));
    await pollUntil(async () => {
      const r = await substrate.get<Row>("SchemaDef", "W5Fail");
      return r?.status.phase === "failed";
    });

    const row = await substrate.get<Row>("SchemaDef", "W5Fail");
    expect(row?.status.phase, "failure surfaced on the row").toBe("failed");
    expect(typeof row?.status.reconcileError).toBe("string");
    expect(String(row?.status.reconcileError)).toMatch(/renameMap/i);
    expect(row?.status.appliedVersion, "appliedVersion unchanged — a failed attempt is not 'applied'").toBe(1);
    // Boot-failure posture WARN: the runtime apply failure is WARNed, the loop survives.
    expect(logs.some((l) => /WARN .*runtime apply failed for kind=W5Fail/.test(l))).toBe(true);
  }, OP_TIMEOUT);

  it("restart-survival: status re-converges across 3 restart cycles (not lost to the boot provisional clobber)", async () => {
    const kind = "W5Restart";

    for (let cycle = 0; cycle <= 3; cycle++) {
      const logs: string[] = [];
      const r = reconciler([defOf(kind, 1)], logs);
      await r.start();
      await sleep(250);

      if (cycle === 0) {
        // Inject drift: a stale 'failed' status (as if a prior transient failure),
        // same spec (v1) → the running reconciler's guard skips it (spec unchanged),
        // so the drift persists until the next boot re-converges it.
        await substrate.put("SchemaDef", envRow(kind,
          { version: 1, fields: FIELDS, indexes: [], watchable: true },
          { phase: "failed", appliedVersion: 0, reconcileError: "stale failure", lastReconciledAt: "2026-01-01T00:00:00Z" }));
        await sleep(300);
      } else {
        // Every restart: the boot re-put + reconcile must re-converge the status to
        // the real outcome (applied/v1), NOT leave it at the injected 'failed'.
        const row = await substrate.get<Row>("SchemaDef", kind);
        expect(row?.status.phase, `cycle ${cycle} phase`).toBe("applied");
        expect(row?.status.appliedVersion, `cycle ${cycle} appliedVersion`).toBe(1);
        expect(row?.status.reconcileError, `cycle ${cycle} reconcileError`).toBeNull();
      }

      // Bounded: boot must NOT trigger runaway runtime reconciles/status-writes
      // (the spec is unchanged across restarts → no runtime reconcile at all).
      expect(logs.filter((l) => /re-reconciling kind=W5Restart/.test(l)).length, `cycle ${cycle} runtime reconciles`)
        .toBeLessThanOrEqual(1);
      expect(logs.filter((l) => /status-write kind=W5Restart/.test(l)).length, `cycle ${cycle} status-writes`)
        .toBeLessThanOrEqual(1);

      await r.close();
      await sleep(100);
    }

    // No spurious index DDL for the no-index test kind across the restarts.
    const idx = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename='entities' AND indexname LIKE 'w5restart%'`);
    expect(idx.rows, "no spurious index created for an index-less kind").toHaveLength(0);
  }, OP_TIMEOUT * 2);
});
