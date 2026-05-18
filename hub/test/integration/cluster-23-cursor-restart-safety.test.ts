/**
 * mission-84 W3 — cluster #23 closure integration test.
 *
 * Per Design v1.0 §2.4 + §5 F1 disposition (greg round-1 CONCUR + REFINE = BOTH
 * in-process + docker-restart smoke). Dispositive evidence that repo-event-bridge
 * cursor + dedupe state PERSISTS across Hub restart in substrate-mode (was
 * ephemeral via the cluster #23 `MemoryStorageProvider` sentinel pre-W3).
 *
 * ─── Test architecture ─────────────────────────────────────────────────────
 *
 * (a) PRIMARY: in-process Hub-restart-simulation (sub-second; CI-deterministic):
 *   - boot a PostgresHubStorageSubstrate against testcontainers postgres
 *   - construct RepoEventBridgeSubstrateAdapter over substrate
 *   - construct CursorStore over adapter
 *   - write cursor + dedupe state via CursorStore
 *   - simulate Hub restart: close substrate (substrate.close()) — discards in-process state
 *   - re-construct substrate + adapter + CursorStore against SAME postgres connection
 *   - read cursor + dedupe; verify restored from postgres
 *
 * (b) SMOKE at PR ship-gate: docker-restart smoke (ground-truth dispositive;
 *   would require docker-restart of an ois-hub-local-prod container; preserved
 *   as an out-of-suite operator-side script rather than embedded test per
 *   testcontainers-amplification discipline — adding docker-restart-class tests
 *   to the suite per `feedback_orphan_daemon_accumulation_from_vitest_test_aborts`
 *   risks resource pressure that triggered the substrate-counter.race.test.ts
 *   57P01 flake during W0+W1 PR #209 CI. Smoke test runnable via the existing
 *   `hub-storage-cutover-runbook.md` operator playbook).
 *
 * ─── Cluster #23 ratify-criterion ─────────────────────────────────────────
 *
 * This test GREEN = cluster #23 status flips `open → closed-structurally` in
 * the calibration ledger at PR #211 ship. Architect-Director-bilateral filing
 * per `feedback_calibration_ledger_discipline` (NOT LLM-autonomous).
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createPostgresStorageSubstrate, createSchemaReconciler, ALL_SCHEMAS } from "../../src/storage-substrate/index.js";
import { RepoEventBridgeSubstrateAdapter } from "../../src/storage-substrate/repo-event-bridge-adapter.js";
import type { HubStorageSubstrate } from "../../src/storage-substrate/types.js";
import { CursorStore, type RepoCursor } from "@apnex/repo-event-bridge";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "src", "storage-substrate", "migrations");
const MIGRATION_FILES = [
  "001-entities-table.sql",
  "002-notify-trigger.sql",
  "003-jsonb-size-check.sql",
];

let container: StartedPostgreSqlContainer;
let connStr: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:15-alpine")
    .withUsername("hub")
    .withPassword("hub")
    .withDatabase("hub")
    .start();
  connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;

  const { Pool } = (await import("pg")).default;
  const pool = new Pool({ connectionString: connStr });
  for (const f of MIGRATION_FILES) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf-8");
    await pool.query(sql);
  }
  await pool.end();
}, 60_000);

afterAll(async () => {
  if (container) await container.stop();
}, 30_000);

async function bootSubstrateStack(): Promise<{
  substrate: HubStorageSubstrate;
  cursorStore: CursorStore;
  close: () => Promise<void>;
}> {
  const substrate = createPostgresStorageSubstrate(connStr);
  // Reconciler bootstraps SchemaDefs (including RepoEventBridgeCursor +
  // RepoEventBridgeDedupe at v1.2) — required so substrate.put accepts those kinds.
  const reconciler = createSchemaReconciler(substrate, connStr, {
    initialSchemas: ALL_SCHEMAS,
    log: () => { /* silent */ },
    warn: () => { /* silent */ },
  });
  await reconciler.start();

  const adapter = new RepoEventBridgeSubstrateAdapter({ substrate });
  const cursorStore = new CursorStore({ storage: adapter });

  return {
    substrate,
    cursorStore,
    close: async () => {
      await reconciler.close();
      await (substrate as unknown as { close: () => Promise<void> }).close();
    },
  };
}

describe("cluster #23 closure — cursor + dedupe survive Hub restart in substrate-mode", () => {
  // Unique repoId per test prevents cross-test interference against the shared
  // postgres container (substrate state accumulates across tests in this file).
  let testCounter = 0;
  const uniqueRepo = () => `cluster23-test__repo-${++testCounter}`;

  it("cursor persists across substrate teardown + recreate", async () => {
    const repoId = uniqueRepo();
    const cursor1: RepoCursor = {
      etag: "etag-v1",
      lastEventId: "evt-1234",
      updatedAt: new Date().toISOString(),
    };

    // Instance A: write cursor via CursorStore → adapter → substrate → postgres
    const a = await bootSubstrateStack();
    const tokenA = await a.cursorStore.writeCursor(repoId, cursor1, null);
    expect(tokenA).not.toBeNull();
    await a.close();

    // Instance B: fresh substrate + adapter + CursorStore against SAME postgres
    const b = await bootSubstrateStack();
    const readB = await b.cursorStore.readCursor(repoId);
    expect(readB.value).toEqual(cursor1);
    expect(readB.token).not.toBeNull();
    await b.close();
  }, 30_000);

  it("cursor update via putIfMatch survives restart with current token", async () => {
    const repoId = uniqueRepo();
    const cursor1: RepoCursor = { etag: "v1", lastEventId: "evt-A", updatedAt: new Date().toISOString() };

    const a = await bootSubstrateStack();
    await a.cursorStore.writeCursor(repoId, cursor1, null);
    const readA = await a.cursorStore.readCursor(repoId);
    expect(readA.value).toEqual(cursor1);
    await a.close();

    // Instance B: update via putIfMatch using the token from pre-restart read
    const b = await bootSubstrateStack();
    const readB = await b.cursorStore.readCursor(repoId);
    expect(readB.value).toEqual(cursor1);
    const cursor2: RepoCursor = { etag: "v2", lastEventId: "evt-B", updatedAt: new Date().toISOString() };
    const tokenB = await b.cursorStore.writeCursor(repoId, cursor2, readB.token);
    expect(tokenB).not.toBeNull();
    const readB2 = await b.cursorStore.readCursor(repoId);
    expect(readB2.value).toEqual(cursor2);
    await b.close();
  }, 30_000);

  it("dedupe LRU survives substrate teardown + recreate", async () => {
    const repoId = uniqueRepo();
    const seedIds = ["evt-1", "evt-2", "evt-3"];

    // Instance A: filterUnseen seeds the dedupe via markSeen
    const a = await bootSubstrateStack();
    const { unseen: unseenA, token: tokenA } = await a.cursorStore.filterUnseen(repoId, seedIds);
    expect(unseenA).toEqual(seedIds);
    await a.cursorStore.markSeen(repoId, seedIds, tokenA);
    await a.close();

    // Instance B: same ids should be deduped (no unseen)
    const b = await bootSubstrateStack();
    const { unseen: unseenB } = await b.cursorStore.filterUnseen(repoId, seedIds);
    expect(unseenB).toEqual([]);
    await b.close();
  }, 30_000);

  it("dedupe + cursor jointly persist for the same repoId", async () => {
    const repoId = uniqueRepo();
    const cursor: RepoCursor = { etag: "joint-v1", lastEventId: "evt-X", updatedAt: new Date().toISOString() };
    const seenIds = ["evt-X", "evt-Y"];

    const a = await bootSubstrateStack();
    await a.cursorStore.writeCursor(repoId, cursor, null);
    const { token: dedupeToken } = await a.cursorStore.filterUnseen(repoId, seenIds);
    await a.cursorStore.markSeen(repoId, seenIds, dedupeToken);
    await a.close();

    const b = await bootSubstrateStack();
    const cursorRead = await b.cursorStore.readCursor(repoId);
    const dedupeProbe = await b.cursorStore.filterUnseen(repoId, seenIds);
    expect(cursorRead.value).toEqual(cursor);
    expect(dedupeProbe.unseen).toEqual([]);
    await b.close();
  }, 30_000);
});
