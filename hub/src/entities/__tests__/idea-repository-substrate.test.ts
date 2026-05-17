/**
 * mission-83 W4.x.3 — IdeaRepositorySubstrate integration tests.
 *
 * 2 tests covering Option Y composition pattern:
 *   1. submitIdea + getIdea + listIdeas + updateIdea round-trip via substrate-API
 *      + SubstrateCounter ID allocation; Design v1.4 getWithRevision + putIfMatch
 *      CAS retry loop verified
 *   2. findByCascadeKey via idea_cascade_idx (Idea SchemaDef v2 shape-correction);
 *      INV-TH20 idempotency-key semantics preserved
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
import { IdeaRepositorySubstrate } from "../idea-repository-substrate.js";
import { SubstrateCounter } from "../substrate-counter.js";

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

  const subset = ALL_SCHEMAS.filter(s => ["SchemaDef", "Idea"].includes(s.kind));
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
    await pool.query(`DELETE FROM entities WHERE kind IN ($1, $2)`, ["Idea", "Counter"]);
  } finally {
    await pool.end();
  }
});

const dummyProvenance = { role: "engineer" as const, agentId: "agent-test", id: "engineer:agent-test" };

describe("IdeaRepositorySubstrate (W4.x.3 Option Y sibling-pattern)", () => {
  it("submitIdea + getIdea + listIdeas + updateIdea via substrate-API + getWithRevision CAS retry", async () => {
    const counter = new SubstrateCounter(substrate);
    const repo = new IdeaRepositorySubstrate(substrate, counter);

    const idea1 = await repo.submitIdea("First idea text", dummyProvenance, undefined, ["tag-a"]);
    expect(idea1.id).toBe("idea-1");
    expect(idea1.text).toBe("First idea text");
    expect(idea1.status).toBe("open");
    expect(idea1.tags).toEqual(["tag-a"]);
    expect(idea1.missionId).toBeNull();

    const idea2 = await repo.submitIdea("Second idea", dummyProvenance, "thread-123");
    expect(idea2.id).toBe("idea-2");
    expect(idea2.sourceThreadId).toBe("thread-123");

    // Round-trip via getIdea
    const fetched = await repo.getIdea("idea-1");
    expect(fetched?.text).toBe("First idea text");
    expect(fetched?.tags).toEqual(["tag-a"]);

    // updateIdea uses Design v1.4 getWithRevision + putIfMatch CAS retry loop
    const updated = await repo.updateIdea("idea-1", { status: "triaged", missionId: "mission-99" });
    expect(updated?.status).toBe("triaged");
    expect(updated?.missionId).toBe("mission-99");

    const refetched = await repo.getIdea("idea-1");
    expect(refetched?.status).toBe("triaged");
    expect(refetched?.missionId).toBe("mission-99");

    // listIdeas with status filter
    const open = await repo.listIdeas("open");
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe("idea-2");

    const triaged = await repo.listIdeas("triaged");
    expect(triaged).toHaveLength(1);
    expect(triaged[0].id).toBe("idea-1");

    // listIdeas (no filter)
    const all = await repo.listIdeas();
    expect(all).toHaveLength(2);

    // updateIdea on absent returns null
    const noIdea = await repo.updateIdea("idea-99", { status: "dismissed" });
    expect(noIdea).toBeNull();
  }, 60_000);

  it("findByCascadeKey via idea_cascade_idx (INV-TH20 idempotency-key)", async () => {
    const counter = new SubstrateCounter(substrate);
    const repo = new IdeaRepositorySubstrate(substrate, counter);

    // Hand-submitted idea (no cascade)
    await repo.submitIdea("Hand-submitted", dummyProvenance);

    // Cascade-spawned idea with backlink
    const backlink = {
      sourceThreadId: "thread-563",
      sourceActionId: "action-1",
      sourceThreadSummary: "Mission-83 Design v1.0 ratified",
    };
    const cascaded = await repo.submitIdea("Cascade-spawned", dummyProvenance, undefined, ["cascade"], backlink);
    expect(cascaded.sourceThreadId).toBe("thread-563");
    expect(cascaded.sourceActionId).toBe("action-1");
    expect(cascaded.sourceThreadSummary).toBe("Mission-83 Design v1.0 ratified");

    // Another cascaded idea with different key
    await repo.submitIdea("Other cascade", dummyProvenance, undefined, [], {
      sourceThreadId: "thread-563",
      sourceActionId: "action-2",
      sourceThreadSummary: "different action",
    });

    // findByCascadeKey on the specific (thread, action) pair
    const found = await repo.findByCascadeKey({ sourceThreadId: "thread-563", sourceActionId: "action-1" });
    expect(found?.id).toBe(cascaded.id);
    expect(found?.text).toBe("Cascade-spawned");

    // Non-existent cascade-key returns null
    const notFound = await repo.findByCascadeKey({ sourceThreadId: "thread-563", sourceActionId: "action-99" });
    expect(notFound).toBeNull();
  }, 60_000);
});
