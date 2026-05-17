/**
 * mission-83 W4.x.1 — AgentRepositorySubstrate integration tests.
 *
 * 2 tests covering Option Y composition pattern:
 *   1. assertIdentity (create + refresh) + claimSession + listAgents round-trip
 *      via substrate-API; fingerprint-indexed lookup (Agent SchemaDef v2)
 *      replaces FS-version agents/by-fingerprint/<fp>.json mirror
 *   2. Session-claim displacement semantics (per-entity logic preservation):
 *      claim session A → claim session B with same agentId → second claim returns
 *      displacedPriorSession; sessionEpoch monotonically increases
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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

let container: StartedPostgreSqlContainer;
let substrate: HubStorageSubstrate;
let reconciler: SchemaReconciler;
let connStr: string;

const MIGRATIONS_DIR = join(__dirname, "..", "..", "storage-substrate", "migrations");
const MIGRATION_FILES = [
  "001-entities-table.sql",
  "002-notify-trigger.sql",
  "003-jsonb-size-check.sql",
];

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:15-alpine")
    .withUsername("hub")
    .withPassword("hub")
    .withDatabase("hub")
    .start();
  connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;

  const pool = new Pool({ connectionString: connStr });
  for (const f of MIGRATION_FILES) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf-8");
    await pool.query(sql);
  }
  await pool.end();

  substrate = createPostgresStorageSubstrate(connStr);

  // Apply Agent SchemaDef (v2 with fingerprint field+index) via reconciler
  const subset = ALL_SCHEMAS.filter(s => ["SchemaDef", "Agent"].includes(s.kind));
  reconciler = createSchemaReconciler(substrate, connStr, {
    initialSchemas: subset,
    log: () => { /* silent */ },
    warn: () => { /* silent */ },
  });
  await reconciler.start();
}, 60_000);

afterAll(async () => {
  await reconciler.close();
  await (substrate as unknown as { close: () => Promise<void> }).close?.();
  await container.stop();
}, 30_000);

beforeEach(async () => {
  const pool = new Pool({ connectionString: connStr });
  try {
    await pool.query(`DELETE FROM entities WHERE kind = $1`, ["Agent"]);
  } finally {
    await pool.end();
  }
});

describe("AgentRepositorySubstrate (W4.x.1 Option Y sibling-pattern)", () => {
  it("assertIdentity + claimSession + listAgents round-trip via substrate-API + fingerprint-indexed lookup", async () => {
    const repo = new AgentRepositorySubstrate(substrate);

    // First-contact assertIdentity create
    const identity1 = await repo.assertIdentity({
      name: "test-engineer-alice",
      role: "engineer",
      clientMetadata: { clientName: "test", clientVersion: "1.0", proxyName: "test", proxyVersion: "1.0", hostname: "alice-host", sdkVersion: "1.0.0" },
      advisoryTags: {},
      labels: { env: "test" },
    }, "session-1");
    expect(identity1.ok).toBe(true);
    if (!identity1.ok) throw new Error("identity1 failed");
    expect(identity1.wasCreated).toBe(true);
    expect(identity1.agentId).toMatch(/^agent-[0-9a-f]{8}$/);
    expect(identity1.labels).toEqual({ env: "test" });

    const agentId = identity1.agentId;

    // Re-assert identity (refresh path) — same fingerprint via name; should NOT create new
    const identity2 = await repo.assertIdentity({
      name: "test-engineer-alice",
      role: "engineer",
      clientMetadata: { clientName: "test", clientVersion: "1.0", proxyName: "test", proxyVersion: "1.0", hostname: "alice-host", sdkVersion: "1.0.1" },  // sdkVersion bumped
      advisoryTags: {},
      labels: { env: "test", added: "label" },  // labels-changed
    }, "session-1");
    expect(identity2.ok).toBe(true);
    if (!identity2.ok) throw new Error("identity2 failed");
    expect(identity2.wasCreated).toBe(false);
    expect(identity2.agentId).toBe(agentId);  // same id
    expect(identity2.labels).toEqual({ env: "test", added: "label" });
    expect(identity2.changedFields).toEqual(["labels"]);
    expect(identity2.priorLabels).toEqual({ env: "test" });

    // claimSession on the asserted identity
    const claim = await repo.claimSession(agentId, "session-1", "sse_subscribe");
    expect(claim.ok).toBe(true);
    if (!claim.ok) throw new Error("claim failed");
    expect(claim.agentId).toBe(agentId);
    expect(claim.sessionEpoch).toBe(1);
    expect(claim.trigger).toBe("sse_subscribe");

    // getAgent round-trip — read-time normalize + liveness recompute
    const fetched = await repo.getAgent(agentId);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(agentId);
    expect(fetched?.fingerprint).toBeDefined();
    expect(fetched?.currentSessionId).toBe("session-1");
    expect(fetched?.sessionEpoch).toBe(1);
    expect(fetched?.status).toBe("online");
    expect(fetched?.livenessState).toBe("online");

    // Second engineer — distinct fingerprint
    const identity3 = await repo.assertIdentity({
      name: "test-engineer-bob",
      role: "engineer",
      clientMetadata: { clientName: "test", clientVersion: "1.0", proxyName: "test", proxyVersion: "1.0", hostname: "bob-host", sdkVersion: "1.0.0" },
      advisoryTags: {},
      labels: {},
    }, "session-2");
    expect(identity3.ok).toBe(true);
    if (!identity3.ok) throw new Error("identity3 failed");
    expect(identity3.wasCreated).toBe(true);
    expect(identity3.agentId).not.toBe(agentId);

    // listAgents returns both
    const agents = await repo.listAgents();
    expect(agents).toHaveLength(2);
    const ids = agents.map(a => a.id).sort();
    expect(ids).toEqual([agentId, identity3.agentId].sort());

    // getAgent on absent
    expect(await repo.getAgent("agent-nonexistent")).toBeNull();
  }, 60_000);

  it("session-claim displacement: second claim on same agentId with different sessionId returns displacedPriorSession + bumps sessionEpoch", async () => {
    const repo = new AgentRepositorySubstrate(substrate);

    // Create + claim session A
    const identity = await repo.assertIdentity({
      name: "test-engineer-displaced",
      role: "engineer",
      clientMetadata: { clientName: "test", clientVersion: "1.0", proxyName: "test", proxyVersion: "1.0", hostname: "host-1", sdkVersion: "1.0.0" },
      advisoryTags: {},
      labels: {},
    }, "session-A");
    expect(identity.ok).toBe(true);
    if (!identity.ok) throw new Error("identity failed");
    const agentId = identity.agentId;

    const claimA = await repo.claimSession(agentId, "session-A", "sse_subscribe");
    expect(claimA.ok).toBe(true);
    if (!claimA.ok) throw new Error("claimA failed");
    expect(claimA.sessionEpoch).toBe(1);
    expect(claimA.displacedPriorSession).toBeUndefined();  // first claim: nothing to displace

    // Claim session B (different sessionId, same agentId) — should displace session A
    const claimB = await repo.claimSession(agentId, "session-B", "explicit");
    expect(claimB.ok).toBe(true);
    if (!claimB.ok) throw new Error("claimB failed");
    expect(claimB.agentId).toBe(agentId);
    expect(claimB.sessionEpoch).toBe(2);  // monotonically increased
    expect(claimB.displacedPriorSession).toEqual({
      sessionId: "session-A",
      epoch: 1,
    });

    // Persisted state reflects session B as current
    const fetched = await repo.getAgent(agentId);
    expect(fetched?.currentSessionId).toBe("session-B");
    expect(fetched?.sessionEpoch).toBe(2);

    // sessionToEngineerId in-memory bookkeeping: getAgentForSession(B) resolves;
    // getAgentForSession(A) is still mapped (legacy behavior — only markAgentOffline
    // explicitly unmaps); the CAS-protected markAgentOffline(A) would no-op since
    // currentSessionId is now session-B (per-entity logic: "newer sessions must not be clobbered").
    const fetchedB = await repo.getAgentForSession("session-B");
    expect(fetchedB?.id).toBe(agentId);

    // markAgentOffline(A) — session A no longer owns the agent (session B does);
    // expect no-op (no status flip)
    await repo.markAgentOffline("session-A");
    const stillOnline = await repo.getAgent(agentId);
    expect(stillOnline?.currentSessionId).toBe("session-B");
    expect(stillOnline?.status).toBe("online");  // not flipped offline
  }, 60_000);
});
