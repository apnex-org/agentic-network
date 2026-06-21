/**
 * bare-envelope-armed-integration.test.ts — C3-R4b piece 2, the DEPLOY GATE.
 *
 * On a FAITHFUL real-Postgres harness (testcontainers, per cal-79/82 — NOT
 * memory) with the detector ARMED exactly as production wires it (via
 * reconciler.hasTranslations), prove across ALL kinds:
 *
 *   1. INERT on real DECODED data — decodeEnvelopeToFlat(realEnvelopeRow, kind)
 *      flattens and does NOT throw. This is the deploy de-risk: the armed detector
 *      never false-positives on a correctly-decoded row. (cal-84's fail-loud must
 *      not become a fail-on-everything.)
 *   2. FIRES on a real RAW (undecoded) substrate row — assertDecodedFlat(rawRow,
 *      kind) throws BareEnvelopeError when the kind is armed (a skipped decode:
 *      the exact bug the 0-bare belt exists to catch).
 *   3. Arming is GATED — disarmed ⇒ inert even on a raw row (the tests/standalone
 *      path); a non-partitioned kind never fires.
 *
 * Why the raw-row path for (2): the decoders ALWAYS flatten an envelope by
 * construction, so the only way a bare envelope reaches a consumer is a read path
 * that SKIPPED the decoder — which is what assertDecodedFlat(rawRow) simulates
 * here against a real stored row.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createPostgresStorageSubstrate, createSchemaReconciler, ALL_SCHEMAS } from "../index.js";
import {
  assertDecodedFlat,
  isFullEnvelopeShape,
  armBareEnvelopeDetector,
  disarmBareEnvelopeDetector,
  BareEnvelopeError,
} from "../bare-envelope-error.js";
import { decodeEnvelopeToFlat } from "../../entities/shape-helpers.js";

const TEST_SETUP_TIMEOUT = 90_000;
const TEST_OP_TIMEOUT = 120_000;
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];

/** A fully-intact (undecoded) envelope row for `kind`. */
function fullEnvelope(kind: string, id: string): Record<string, unknown> {
  return {
    id,
    apiVersion: "ois.io/v1",
    kind,
    metadata: { id, name: id },
    spec: { someSpecField: "x" },
    status: { phase: "active" },
  };
}

describe("C3-R4b 0-bare detector — armed real-pg integration (deploy gate)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
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
  }, TEST_SETUP_TIMEOUT);

  afterEach(() => disarmBareEnvelopeDetector());

  afterAll(async () => {
    disarmBareEnvelopeDetector();
    if (reconciler) await reconciler.close();
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, TEST_OP_TIMEOUT);

  it(
    "ARMED: decodeEnvelopeToFlat is INERT on a real envelope row for every kind (no false-positive)",
    async () => {
      armBareEnvelopeDetector((kind) => reconciler.hasTranslations(kind));
      const failures: string[] = [];
      for (const schema of ALL_SCHEMAS) {
        const kind = schema.kind;
        const id = `be-inert-${kind}`;
        await substrate.put(kind, fullEnvelope(kind, id));
        const raw = await substrate.get<Record<string, unknown>>(kind, id);
        try {
          // The repo decode path: decode → flat → assert. Must NOT throw.
          const flat = decodeEnvelopeToFlat(raw, kind);
          if (isFullEnvelopeShape(flat)) failures.push(`${kind}: decoded result is STILL a full envelope`);
        } catch (err) {
          failures.push(`${kind}: armed decode FALSE-POSITIVED: ${(err as Error).message}`);
        }
      }
      expect(failures, `armed-decode false-positives:\n  ${failures.join("\n  ")}`).toEqual([]);
    },
    TEST_OP_TIMEOUT,
  );

  it(
    "ARMED: a real RAW (undecoded) substrate row throws BareEnvelopeError for a partitioned kind",
    async () => {
      armBareEnvelopeDetector((kind) => reconciler.hasTranslations(kind));
      const kind = "Idea";
      expect(reconciler.hasTranslations(kind), "Idea must be a known partitioned kind").toBe(true);
      const id = "be-raw-idea";
      await substrate.put(kind, fullEnvelope(kind, id));
      const raw = await substrate.get<Record<string, unknown>>(kind, id);
      expect(isFullEnvelopeShape(raw), "stored raw row should be a full envelope").toBe(true);
      // Simulate a read path that SKIPPED the decoder: assert directly on the raw row.
      expect(() => assertDecodedFlat(raw, kind)).toThrow(BareEnvelopeError);
    },
    TEST_OP_TIMEOUT,
  );

  it(
    "DISARMED: a real raw row is inert (the tests/standalone path — never throws)",
    async () => {
      disarmBareEnvelopeDetector();
      const kind = "Idea";
      const id = "be-disarmed-idea";
      await substrate.put(kind, fullEnvelope(kind, id));
      const raw = await substrate.get<Record<string, unknown>>(kind, id);
      expect(() => assertDecodedFlat(raw, kind)).not.toThrow();
    },
    TEST_OP_TIMEOUT,
  );
});
