/**
 * C1-R2 (mission-94) sub-PR-3a-ii — complete_work + the anti-gameability evidence
 * predicate (real-pg). Covers Lily's evidence contract (audit-4082) end-to-end:
 *   #1 coverage-by-BINDING  #2 kind-match  #3 freshness (+ allowPreClaim)
 *   #4 refResolvable (OIS-internal existence-check vs external format-only)
 *   #5 no-double-count (structural)  #6 empty-req floor
 * + the in_progress→review→done FSM (a review requirement parks the item until the
 * verifier's evidence EXISTS — never requiring a passing verdict) + the holder/token
 * guard + idempotency (post-done re-complete rejects; evidence dedups).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createPostgresStorageSubstrate, createSchemaReconciler, ALL_SCHEMAS, buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate, TransitionRejected, EvidencePredicateFailed } from "../work-item-repository-substrate.js";
import type { EvidenceRequirement, EvidenceItem } from "../work-item.js";

const SETUP_TIMEOUT = 90_000;
const OP_TIMEOUT = 120_000;
const MIGRATIONS_DIR = join(__dirname, "..", "..", "storage-substrate", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];
const STALE = "2000-01-01T00:00:00.000Z";

describe("WorkItem complete_work + evidence predicate (real-pg)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let substrate: ReturnType<typeof createPostgresStorageSubstrate>;
  let reconciler: ReturnType<typeof createSchemaReconciler>;
  let repo: WorkItemRepositorySubstrate;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    const connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = new Pool({ connectionString: connStr });
    for (const f of MIGRATION_FILES) await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    substrate = createPostgresStorageSubstrate(connStr);
    reconciler = createSchemaReconciler(substrate, connStr, { initialSchemas: ALL_SCHEMAS });
    await reconciler.start();
    substrate.setFieldTranslator((kind, key) => reconciler.getFieldTranslation(kind, key));
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    if (reconciler) await reconciler.close();
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, OP_TIMEOUT);

  /** create → claim → start; returns ids + token + the lease claimedAt. */
  async function started(reqs: EvidenceRequirement[], agent: string) {
    const w = await repo.createWorkItem({ type: "task", roleEligibility: ["engineer"], evidenceRequirements: reqs });
    const claimed = await repo.claimWorkItem(w.id, agent);
    const token = claimed!.lease!.token;
    await repo.startWork(w.id, agent, token);
    return { id: w.id, token, claimedAt: claimed!.lease!.claimedAt };
  }
  const ev = (e: Partial<EvidenceItem> & Pick<EvidenceItem, "requirementId" | "kind">): EvidenceItem =>
    ({ producedAt: new Date().toISOString(), ...e });

  it("#6 floor: no requirements + a freeform evidence → done", async () => {
    const { id, token } = await started([], "agent-c1");
    const done = await repo.completeWork(id, "agent-c1", token, [ev({ requirementId: "x", kind: "freeform" })]);
    expect(done!.status).toBe("done");
  }, OP_TIMEOUT);

  it("#6 floor VIOLATION: no requirements + no freeform evidence → EvidencePredicateFailed", async () => {
    const { id, token } = await started([], "agent-c2");
    await expect(repo.completeWork(id, "agent-c2", token, [])).rejects.toThrow(/>=1 freeform evidence/);
  }, OP_TIMEOUT);

  it("#1 coverage-by-binding: wrong requirementId → uncovered fail; correct binding → done", async () => {
    const reqs: EvidenceRequirement[] = [{ id: "r1", kind: "commit" }];
    const a = await started(reqs, "agent-c3a");
    await expect(repo.completeWork(a.id, "agent-c3a", a.token, [ev({ requirementId: "WRONG", kind: "commit", ref: "abc" })]))
      .rejects.toThrow(/requirement 'r1'.*no bound evidence/);
    const b = await started(reqs, "agent-c3b");
    const done = await repo.completeWork(b.id, "agent-c3b", b.token, [ev({ requirementId: "r1", kind: "commit", ref: "abc" })]);
    expect(done!.status).toBe("done");
  }, OP_TIMEOUT);

  it("#2 kind-match: bound by id but wrong kind → fail", async () => {
    const { id, token } = await started([{ id: "r1", kind: "commit" }], "agent-c4");
    await expect(repo.completeWork(id, "agent-c4", token, [ev({ requirementId: "r1", kind: "pr", ref: "x" })]))
      .rejects.toThrow(/requirement 'r1' evidence kind mismatch/);
  }, OP_TIMEOUT);

  it("#3 freshness: stale producedAt → fail; allowPreClaim permits; fresh passes", async () => {
    const stale = await started([{ id: "r1", kind: "commit" }], "agent-c5a");
    await expect(repo.completeWork(stale.id, "agent-c5a", stale.token, [{ requirementId: "r1", kind: "commit", ref: "x", producedAt: STALE }]))
      .rejects.toThrow(/failed freshness/);

    const pre = await started([{ id: "r1", kind: "commit", allowPreClaim: true }], "agent-c5b");
    const okPre = await repo.completeWork(pre.id, "agent-c5b", pre.token, [{ requirementId: "r1", kind: "commit", ref: "x", producedAt: STALE }]);
    expect(okPre!.status).toBe("done"); // allowPreClaim waives freshness

    const fresh = await started([{ id: "r1", kind: "commit" }], "agent-c5c");
    const okFresh = await repo.completeWork(fresh.id, "agent-c5c", fresh.token, [ev({ requirementId: "r1", kind: "commit", ref: "x" })]);
    expect(okFresh!.status).toBe("done");
  }, OP_TIMEOUT);

  it("#4 refResolvable OIS-internal (review→WorkItem): nonexistent ref → fail; existing ref → done", async () => {
    const reqs: EvidenceRequirement[] = [{ id: "r1", kind: "review", refResolvable: true }];
    const bad = await started(reqs, "agent-c6a");
    await expect(repo.completeWork(bad.id, "agent-c6a", bad.token, [ev({ requirementId: "r1", kind: "review", ref: "work-nonexistent" })]))
      .rejects.toThrow(/does not resolve/);

    // a real verifier-gate WorkItem exists → its id resolves.
    const vg = await repo.createWorkItem({ type: "verifier-gate", roleEligibility: ["verifier"] });
    const good = await started(reqs, "agent-c6b");
    const done = await repo.completeWork(good.id, "agent-c6b", good.token, [ev({ requirementId: "r1", kind: "review", ref: vg.id })]);
    expect(done!.status).toBe("done");
  }, OP_TIMEOUT);

  it("#4 refResolvable external (commit): malformed (empty) ref → fail; well-formed nonexistent ref → pass (format-only)", async () => {
    const reqs: EvidenceRequirement[] = [{ id: "r1", kind: "commit", refResolvable: true }];
    const bad = await started(reqs, "agent-c7a");
    await expect(repo.completeWork(bad.id, "agent-c7a", bad.token, [ev({ requirementId: "r1", kind: "commit", ref: "  " })]))
      .rejects.toThrow(/malformed .* ref/);
    const ok = await started(reqs, "agent-c7b");
    const done = await repo.completeWork(ok.id, "agent-c7b", ok.token, [ev({ requirementId: "r1", kind: "commit", ref: "deadbeef" })]);
    expect(done!.status).toBe("done"); // external refs are NOT existence-checked
  }, OP_TIMEOUT);

  it("FSM: a review requirement parks in_progress→review, then review→done when review evidence arrives", async () => {
    const reqs: EvidenceRequirement[] = [{ id: "code", kind: "commit" }, { id: "rev", kind: "review" }];
    const { id, token } = await started(reqs, "agent-c8");
    // first complete: code covered, review unmet → parks in review (no fail).
    const parked = await repo.completeWork(id, "agent-c8", token, [ev({ requirementId: "code", kind: "commit", ref: "abc" })]);
    expect(parked!.status).toBe("review");
    // verifier looked → review evidence; review→done (no passing verdict required).
    const done = await repo.completeWork(id, "agent-c8", token, [ev({ requirementId: "rev", kind: "review", ref: "verdict-note" })]);
    expect(done!.status).toBe("done");
  }, OP_TIMEOUT);

  it("complete from claimed (not started) → TransitionRejected", async () => {
    const w = await repo.createWorkItem({ type: "task", roleEligibility: ["engineer"] });
    const claimed = await repo.claimWorkItem(w.id, "agent-c9");
    await expect(repo.completeWork(w.id, "agent-c9", claimed!.lease!.token, [ev({ requirementId: "x", kind: "freeform" })]))
      .rejects.toThrow(/complete requires in_progress or review/);
  }, OP_TIMEOUT);

  it("holder/token guard: non-holder + stale-token complete reject", async () => {
    const { id, token } = await started([], "agent-c10");
    await expect(repo.completeWork(id, "agent-intruder", token, [ev({ requirementId: "x", kind: "freeform" })]))
      .rejects.toThrow(/requires the lease-holder/);
    await expect(repo.completeWork(id, "agent-c10", "stale-token", [ev({ requirementId: "x", kind: "freeform" })]))
      .rejects.toThrow(/stale lease token/);
  }, OP_TIMEOUT);

  it("idempotency: post-done re-complete rejects; duplicate evidence dedups (no double-append)", async () => {
    const { id, token } = await started([], "agent-c11");
    const dup = ev({ requirementId: "x", kind: "freeform", ref: "same" });
    const done = await repo.completeWork(id, "agent-c11", token, [dup, { ...dup }]); // identical pair
    expect(done!.status).toBe("done");
    expect(done!.evidence.length).toBe(1); // deduped
    // re-complete on a done item → terminal, rejects
    await expect(repo.completeWork(id, "agent-c11", token, [ev({ requirementId: "x", kind: "freeform" })]))
      .rejects.toThrow(/complete requires in_progress or review/);
  }, OP_TIMEOUT);

  it("multi-requirement: all covered → done; one uncovered → fail (row unchanged, atomic)", async () => {
    const reqs: EvidenceRequirement[] = [{ id: "r1", kind: "commit" }, { id: "r2", kind: "pr" }];
    const miss = await started(reqs, "agent-c12a");
    await expect(repo.completeWork(miss.id, "agent-c12a", miss.token, [ev({ requirementId: "r1", kind: "commit", ref: "a" })]))
      .rejects.toThrow(/requirement 'r2'.*no bound evidence/);
    // atomic: the failed complete left the item in_progress with NO evidence stored.
    const after = await repo.getWorkItem(miss.id);
    expect(after!.status).toBe("in_progress");
    expect(after!.evidence).toEqual([]);

    const all = await started(reqs, "agent-c12b");
    const done = await repo.completeWork(all.id, "agent-c12b", all.token, [
      ev({ requirementId: "r1", kind: "commit", ref: "a" }),
      ev({ requirementId: "r2", kind: "pr", ref: "b" }),
    ]);
    expect(done!.status).toBe("done");
  }, OP_TIMEOUT);
});
