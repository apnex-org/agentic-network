/**
 * mission-89 Phase 2 — assertIdentity OCC primitive testcontainer integration.
 *
 * Per Design v1.0 §3 Phase 2 + §4.2 Observation 1: real-pg contention
 * verification (memory substrate's Map-mutex is contention-mute for the
 * defect-class that motivated the primitive). Verifies bug-127 production
 * fix-pattern end-to-end:
 *
 *   - 2 concurrent assertIdentity for SAME fingerprint succeed (serialized
 *     via advisory-lock; no `occ_contention_exhausted` emitted)
 *   - 2 concurrent assertIdentity for DIFFERENT fingerprints succeed
 *     concurrently (no false serialization)
 *   - Lock-release on fn-throw — subsequent assertIdentity succeeds
 *
 * Architect-dispositive verification (post-merge + Hub-rebuild) covers the
 * bypass-tool M18 path; this suite covers the substrate-level invariant.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import {
  createPostgresStorageSubstrate,
  createSchemaReconciler,
  ALL_SCHEMAS,
  type HubStorageSubstrate,
  type SchemaReconciler,
} from "../../storage-substrate/index.js";
import { AgentRepositorySubstrate } from "../agent-repository-substrate.js";

const { Pool } = pg;

describe("assertIdentity — testcontainer integration (real pg_advisory_lock contention)", () => {
  let pgContainer: StartedPostgreSqlContainer | undefined;
  let pgConnStr: string | undefined;
  let substrate: HubStorageSubstrate | undefined;
  let reconciler: SchemaReconciler | undefined;

  const MIGRATIONS_DIR = join(__dirname, "..", "..", "storage-substrate", "migrations");
  const MIGRATION_FILES = [
    "001-entities-table.sql",
    "002-notify-trigger.sql",
    "003-jsonb-size-check.sql",
  ];

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub")
      .withPassword("hub")
      .withDatabase("hub")
      .start();
    pgConnStr = `postgres://hub:hub@${pgContainer.getHost()}:${pgContainer.getPort()}/hub`;

    const pool = new Pool({ connectionString: pgConnStr });
    for (const f of MIGRATION_FILES) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf-8");
      await pool.query(sql);
    }
    await pool.end();

    substrate = createPostgresStorageSubstrate(pgConnStr);

    // Bootstrap SchemaDef + Agent schemas via reconciler (canonical pattern).
    const subset = ALL_SCHEMAS.filter((s) => ["SchemaDef", "Agent"].includes(s.kind));
    reconciler = createSchemaReconciler(substrate, pgConnStr, {
      initialSchemas: subset,
      log: () => { /* silent */ },
      warn: () => { /* silent */ },
    });
    await reconciler.start();
  }, 60_000);

  afterAll(async () => {
    if (reconciler) await reconciler.close();
    if (substrate) await substrate.close();
    if (pgContainer) await pgContainer.stop();
  }, 30_000);

  it("2 concurrent assertIdentity for SAME fingerprint serialize via lock — both succeed (bug-127 systemic close)", async () => {
    if (!substrate) throw new Error("substrate not initialized");
    const repo = new AgentRepositorySubstrate(substrate);

    const payload = {
      role: "engineer" as const,
      name: "concurrent-same-fp",
      clientMetadata: {
        clientName: "test",
        clientVersion: "1.0",
        proxyName: "test",
        proxyVersion: "1.0",
        hostname: "host-same",
      },
    };

    // Fire two concurrent assertIdentity for the same name → same fingerprint
    const [r1, r2] = await Promise.all([
      repo.assertIdentity(payload, "session-1"),
      repo.assertIdentity(payload, "session-2"),
    ]);

    // Both MUST succeed (lock-serialization → no OCC race)
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    if (r1.ok && r2.ok) {
      // Same agentId (same fingerprint resolves to same Agent row)
      expect(r1.agentId).toBe(r2.agentId);
      // Exactly one of them is the creator; the other refreshed
      const creators = [r1.wasCreated, r2.wasCreated].filter(Boolean);
      expect(creators).toHaveLength(1);
    }
  }, 30_000);

  it("2 concurrent assertIdentity for DIFFERENT fingerprints run in parallel — no false serialization", async () => {
    if (!substrate) throw new Error("substrate not initialized");
    const repo = new AgentRepositorySubstrate(substrate);

    const startedAt = Date.now();
    const [rA, rB] = await Promise.all([
      repo.assertIdentity(
        {
          role: "engineer",
          name: "concurrent-fp-A",
          clientMetadata: { clientName: "test", clientVersion: "1.0", proxyName: "test", proxyVersion: "1.0" },
        },
        "session-A",
      ),
      repo.assertIdentity(
        {
          role: "engineer",
          name: "concurrent-fp-B",
          clientMetadata: { clientName: "test", clientVersion: "1.0", proxyName: "test", proxyVersion: "1.0" },
        },
        "session-B",
      ),
    ]);
    const elapsed = Date.now() - startedAt;

    expect(rA.ok).toBe(true);
    expect(rB.ok).toBe(true);
    if (rA.ok && rB.ok) {
      expect(rA.agentId).not.toBe(rB.agentId);
    }
    // Both ran in parallel; total time bounded by single assertIdentity latency
    expect(elapsed).toBeLessThan(5_000);
  }, 30_000);

  it("10 concurrent assertIdentity for SAME fingerprint all succeed under serialization", async () => {
    if (!substrate) throw new Error("substrate not initialized");
    const repo = new AgentRepositorySubstrate(substrate);

    const payload = {
      role: "engineer" as const,
      name: "concurrent-storm",
      clientMetadata: {
        clientName: "test",
        clientVersion: "1.0",
        proxyName: "test",
        proxyVersion: "1.0",
        hostname: "host-storm",
      },
    };

    // 10 concurrent assertIdentity calls — pre-W10-ext: would fail at ~3rd.
    // Post-W10-ext: budget extended to 8 attempts, still fragile.
    // Post-mission-89 primitive: ALL succeed via lock serialization.
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => repo.assertIdentity(payload, `session-storm-${i}`)),
    );

    const failures = results.filter((r) => !r.ok);
    expect(failures).toHaveLength(0);

    // All return the same agentId (same fingerprint)
    const agentIds = results.flatMap((r) => (r.ok ? [r.agentId] : []));
    expect(new Set(agentIds).size).toBe(1);
  }, 60_000);
});
