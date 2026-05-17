/**
 * mission-83 W4.x.7 — ProposalRepositorySubstrate integration tests.
 *
 * 2 tests covering Option Y composition + body-storage carve-out:
 *   1. submitProposal + getProposal/getProposals(status filter) + reviewProposal
 *      CAS via Design v1.4 getWithRevision + putIfMatch + findByCascadeKey via
 *      proposal_cascade_idx
 *   2. closeProposal FSM + TransitionRejected gating (not-in-closeable-state →
 *      returns false; matches legacy) + setScaffoldResult CAS
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
import { ProposalRepositorySubstrate } from "../proposal-repository-substrate.js";
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

  const subset = ALL_SCHEMAS.filter(s => ["SchemaDef", "Proposal"].includes(s.kind));
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
    await pool.query(`DELETE FROM entities WHERE kind IN ($1, $2)`, ["Proposal", "Counter"]);
  } finally {
    await pool.end();
  }
});

describe("ProposalRepositorySubstrate (W4.x.7 Option Y sibling-pattern)", () => {
  it("submitProposal + getProposal(s) + reviewProposal CAS + findByCascadeKey", async () => {
    const counter = new SubstrateCounter(substrate);
    const repo = new ProposalRepositorySubstrate(substrate, counter);

    const p1 = await repo.submitProposal(
      "First proposal",
      "Summary text",
      "# Body\nMD body content",
      "mission-83",
    );
    expect(p1.id).toBe("prop-1");
    expect(p1.status).toBe("submitted");
    expect(p1.correlationId).toBe("mission-83");
    expect(p1.proposalRef).toBe("proposals/prop-1.md");  // vestigial; body not actually written

    const p2 = await repo.submitProposal(
      "Cascade proposal",
      "from thread",
      "body",
      undefined,
      undefined,
      { env: "prod" },
      { sourceThreadId: "thread-X", sourceActionId: "act-1", sourceThreadSummary: "summary" },
    );
    expect(p2.id).toBe("prop-2");
    expect(p2.sourceThreadId).toBe("thread-X");
    expect(p2.labels).toEqual({ env: "prod" });

    // getProposal round-trip
    const fetched = await repo.getProposal("prop-1");
    expect(fetched?.title).toBe("First proposal");

    // getProposals (no filter)
    const all = await repo.getProposals();
    expect(all).toHaveLength(2);

    // getProposals(status filter)
    const submittedOnly = await repo.getProposals("submitted");
    expect(submittedOnly).toHaveLength(2);

    // findByCascadeKey via proposal_cascade_idx
    const found = await repo.findByCascadeKey({ sourceThreadId: "thread-X", sourceActionId: "act-1" });
    expect(found?.id).toBe("prop-2");

    const notFound = await repo.findByCascadeKey({ sourceThreadId: "thread-X", sourceActionId: "act-99" });
    expect(notFound).toBeNull();

    // reviewProposal CAS
    const reviewed = await repo.reviewProposal("prop-1", "approved", "looks good");
    expect(reviewed).toBe(true);

    const reviewedFetch = await repo.getProposal("prop-1");
    expect(reviewedFetch?.status).toBe("approved");
    expect(reviewedFetch?.decision).toBe("approved");
    expect(reviewedFetch?.feedback).toBe("looks good");

    // reviewProposal on absent returns false
    const noProp = await repo.reviewProposal("prop-99", "approved", "x");
    expect(noProp).toBe(false);
  }, 60_000);

  it("closeProposal FSM + TransitionRejected gating + setScaffoldResult CAS", async () => {
    const counter = new SubstrateCounter(substrate);
    const repo = new ProposalRepositorySubstrate(substrate, counter);

    // submitted → cannot close (TransitionRejected)
    const p1 = await repo.submitProposal("Test", "Summary", "body");
    const closeSubmitted = await repo.closeProposal(p1.id);
    expect(closeSubmitted).toBe(false);  // TransitionRejected: not-in-closeable-state

    // review → approved
    await repo.reviewProposal(p1.id, "approved", "approved-feedback");

    // approved → can close
    const closeApproved = await repo.closeProposal(p1.id);
    expect(closeApproved).toBe(true);

    const closed = await repo.getProposal(p1.id);
    expect(closed?.status).toBe("implemented");

    // Re-close already-implemented → TransitionRejected (false)
    const reClose = await repo.closeProposal(p1.id);
    expect(reClose).toBe(false);

    // closeProposal on absent → false
    const noProp = await repo.closeProposal("prop-99");
    expect(noProp).toBe(false);

    // setScaffoldResult CAS
    const p2 = await repo.submitProposal("Scaffold test", "x", "y");
    const scaffold = {
      missions: [{ idRef: "mref-1", generatedId: "mission-99" }],
      tasks: [{ idRef: "tref-1", generatedId: "task-1" }, { idRef: "tref-2", generatedId: "task-2" }],
    };
    const setOk = await repo.setScaffoldResult(p2.id, scaffold);
    expect(setOk).toBe(true);

    const withScaffold = await repo.getProposal(p2.id);
    expect(withScaffold?.scaffoldResult).toEqual(scaffold);

    // setScaffoldResult on absent → false
    const noScaff = await repo.setScaffoldResult("prop-99", scaffold);
    expect(noScaff).toBe(false);
  }, 60_000);
});
