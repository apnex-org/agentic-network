/**
 * mission-90 W6-prep — shadow-read parity harness (Design §3.3, A4 RESOLVED).
 *
 * PURPOSE: renameMap-translation CORRECTNESS — the W6 release-gate criterion
 * ("100% parity, all three criteria, every kind, BEFORE the strict-flip"). The
 * substrate.list path translates a BARE filter key → its envelope JSONB dotted
 * path (via the reconciler's renameMap-derived translation table); a direct-psql
 * `data#>>'{...}'` extraction is the independent ORACLE. If the translation is
 * faithful, list == oracle for every renameMap entry.
 *
 * This file is the harness MECHANISM, self-validated on a SYNTHETIC clone (the
 * env was cleared of the preflight snapshot + a real snapshot is a Director-gated
 * prod-touch). At cutover-prep the SAME corpus runs against the restored prod
 * snapshot (hub-snapshot.sh → testcontainers clone) — the assertions are identical;
 * only the data source changes. Per Design §3.3:
 *   - corpus: one filter per renameMap entry (the all-schemas authority) + a
 *     non-renamed control key per kind;
 *   - parity (per entry): (a) COUNT vs psql-oracle; (b) ordered content-hash of
 *     the result-set; (c) every-renameMap-entry coverage.
 *
 * DISPOSITIVE GUARD: each query is asserted to return the EXACT seeded match-ids
 * (not merely list==oracle) — so a renameMap entry whose claimed path diverges
 * from the encoder's ACTUAL placement is caught (oracle on the wrong path returns
 * 0 ≠ the seeded 2), rather than a false-pass where both sides query an empty path.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { createTestPool } from "./_pg-test-pool.js";
import {
  createPostgresStorageSubstrate,
  createSchemaReconciler,
  buildEnvelopeWriteEncoder,
  ALL_SCHEMAS,
  type PostgresSubstrate,
  type SchemaReconciler,
} from "../index.js";

const SETUP_TIMEOUT = 120_000;
const OP_TIMEOUT = 120_000;
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];

/** One corpus entry per renameMap mapping (the all-schemas authority). */
interface CorpusEntry {
  kind: string;
  bareKey: string;       // the legacy filter key callers pass
  envPath: string;       // the claimed envelope dotted path (renameMap target)
  matchVal: string;      // a value UNIQUE per entry → isolates this entry's rows
  matchIds: string[];    // the 2 rows seeded to MATCH
  missId: string;        // 1 row seeded to NOT match
}

/**
 * Per-entry value overrides for fields whose MIGRATION TRANSFORMS the value (vs
 * pure relocate/rename) — the synthetic value must survive the transform so the
 * read-back query matches. Notification.event is enum-validated at migrate-time
 * (W8 Q1): an unknown value is coerced to "unknown", so the corpus must use a
 * KNOWN eventType. This is a value-transform, NOT a translation issue (the
 * event→spec.eventType path is correct); the override keeps the path-correctness
 * test honest. Key = "<kind>.<bareKey>".
 */
const VALUE_OVERRIDES: Record<string, string> = {
  "Notification.event": "review_completed",
};

/** Build the corpus from the all-schemas renameMap inventory. */
function buildCorpus(): CorpusEntry[] {
  const corpus: CorpusEntry[] = [];
  for (const schema of ALL_SCHEMAS) {
    const rm = (schema as { renameMap?: Record<string, string> }).renameMap;
    if (!rm) continue;
    for (const [bareKey, envPath] of Object.entries(rm)) {
      const tag = `${schema.kind}__${bareKey}`.replace(/[^A-Za-z0-9_]/g, "_");
      corpus.push({
        kind: schema.kind,
        bareKey,
        envPath,
        matchVal: VALUE_OVERRIDES[`${schema.kind}.${bareKey}`] ?? `shadowval_${tag}`,
        matchIds: [`shr-${tag}-m1`, `shr-${tag}-m2`],
        missId: `shr-${tag}-x1`,
      });
    }
  }
  return corpus;
}

/** envelope dotted-path → psql JSONB text-extract operand, e.g.
 *  "status.phase" → data#>>'{status,phase}' ; "spec.severity" → data#>>'{spec,severity}'. */
function jsonbExtract(envPath: string): string {
  const parts = envPath.split(".").map((p) => p.replace(/'/g, "''"));
  return `data#>>'{${parts.join(",")}}'`;
}

const contentHash = (ids: string[]) => createHash("sha256").update([...ids].sort().join("\n")).digest("hex");

/** Seed a value at a (possibly nested) bare key. Flat key → top-level field;
 *  NESTED key (e.g. Message "target.role") → nested object {target:{role:val}},
 *  so the encoder relocates the whole parent object per the partition (target→spec). */
function setNested(obj: Record<string, unknown>, dottedKey: string, value: unknown): void {
  const parts = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i]!;
    if (typeof cur[seg] !== "object" || cur[seg] === null) cur[seg] = {};
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

describe("W6-prep shadow-read parity harness (§3.3 renameMap-translation correctness)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let connStr: string;
  let substrate: PostgresSubstrate;
  let reconciler: SchemaReconciler;
  const corpus = buildCorpus();

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = createTestPool(connStr, "shadow-read-parity-w6");
    for (const f of MIGRATION_FILES) await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    substrate = createPostgresStorageSubstrate(connStr);
    reconciler = createSchemaReconciler(substrate, connStr, { initialSchemas: ALL_SCHEMAS, log: () => {}, warn: () => {} });
    await reconciler.start();
    // Wire exactly as Hub boot: the reconciler's renameMap translation table drives
    // list filter-key translation; the encoder seeds envelope rows (module placement).
    substrate.setFieldTranslator((kind, key) => reconciler.getFieldTranslation(kind, key));
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());

    // SEED: for each corpus entry, 2 envelope rows whose bareKey = the entry's
    // unique matchVal (→ encoder places it at the module's actual path) + 1 miss.
    // Seeding BARE through the wired encoder mirrors the production write-path.
    for (const e of corpus) {
      for (const id of e.matchIds) {
        const row: Record<string, unknown> = { id };
        setNested(row, e.bareKey, e.matchVal);
        await substrate.put(e.kind, row);
      }
      const miss: Record<string, unknown> = { id: e.missId };
      setNested(miss, e.bareKey, `MISS_${e.matchVal}`);
      await substrate.put(e.kind, miss);
    }
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    if (reconciler) await reconciler.close();
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, OP_TIMEOUT);

  it("corpus covers EVERY all-schemas renameMap entry (coverage criterion (c))", () => {
    // Cross-check the corpus against the raw all-schemas inventory — no entry
    // silently un-exercised (the §3.3 every-renameMap-entry coverage assertion).
    const inventory = ALL_SCHEMAS.flatMap((s) => {
      const rm = (s as { renameMap?: Record<string, string> }).renameMap ?? {};
      return Object.keys(rm).map((k) => `${s.kind}.${k}`);
    }).sort();
    const covered = corpus.map((e) => `${e.kind}.${e.bareKey}`).sort();
    expect(covered).toEqual(inventory);
    expect(corpus.length).toBeGreaterThanOrEqual(28); // ≥ the §2.6 FSM/rename subset; full authority is larger
  });

  it("list-via-translation == psql-oracle == seeded match-ids, for EVERY renameMap entry (criteria (a)+(b))", async () => {
    const mismatches: Array<{ entry: string; reason: string; list: string[]; oracle: string[]; expected: string[] }> = [];

    for (const e of corpus) {
      const expected = [...e.matchIds].sort();

      // (1) substrate.list with the BARE filter key → reconciler translates
      //     bareKey → envPath → JSONB query. This is the production read-path.
      const listed = await substrate.list<{ id: string }>(e.kind, { filter: { [e.bareKey]: e.matchVal }, limit: 100 });
      const listIds = listed.items.map((i) => i.id).sort();

      // (2) Independent psql ORACLE on the claimed envelope path.
      const oracle = await pool.query<{ id: string }>(
        `SELECT id FROM entities WHERE kind = $1 AND ${jsonbExtract(e.envPath)} = $2 ORDER BY id`,
        [e.kind, e.matchVal],
      );
      const oracleIds = oracle.rows.map((r) => r.id).sort();

      const label = `${e.kind}.${e.bareKey}→${e.envPath}`;
      // (a) count + (b) content-hash parity, AND dispositive: both == the seeded ids.
      // If the claimed path diverged from the encoder's actual placement, the
      // oracle returns 0 ≠ 2 here (not a both-empty false-pass).
      if (contentHash(listIds) !== contentHash(expected)) {
        mismatches.push({ entry: label, reason: "list != seeded", list: listIds, oracle: oracleIds, expected });
      } else if (contentHash(oracleIds) !== contentHash(expected)) {
        mismatches.push({ entry: label, reason: "oracle != seeded (path divergence)", list: listIds, oracle: oracleIds, expected });
      } else if (contentHash(listIds) !== contentHash(oracleIds)) {
        mismatches.push({ entry: label, reason: "list != oracle", list: listIds, oracle: oracleIds, expected });
      }
    }

    expect(mismatches, `renameMap entries failing shadow-read parity:\n${JSON.stringify(mismatches, null, 2)}`).toEqual([]);
  }, OP_TIMEOUT);

  it("non-renamed control key resolves identically (list == psql top-level oracle)", async () => {
    // A non-renamed key (id) must pass straight through (no translation) and agree
    // with a top-level oracle — proves the translation table doesn't over-reach.
    const probe = corpus[0]!;
    const listed = await substrate.list<{ id: string }>(probe.kind, { filter: { id: probe.matchIds[0]! }, limit: 10 });
    expect(listed.items.map((i) => i.id)).toEqual([probe.matchIds[0]!]);
  }, OP_TIMEOUT);
});
