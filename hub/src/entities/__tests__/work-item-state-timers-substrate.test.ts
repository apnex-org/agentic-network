
const NO_FRICTION = { observed: false, summary: "no friction observed" } as const;

/**
 * work-98 (idea-384 Part A) — per-FSM-state wall-clock timers (real-pg + pure-unit).
 *
 * The load-bearing proofs (lily's adversarial-verify focus):
 *  (1) ALL-SITES non-vacuity — each FSM transition accrues the EXITING state's bucket; dropping
 *      the shared accrueExitingState() from ANY one of the 10 sites reds that bucket's test.
 *  (2) requeue RE-ACCUMULATION — a node that re-enters `ready` ADDS the new dwell onto the prior.
 *  (3) the SUM-IDENTITY — sum(5 buckets) === createdAt→completedAt for a node born under the timer.
 *  (4) the `review` bucket (the surfaced fork) — verifier-wait dwell is accrued, not lost.
 *
 * Timing is made deterministic two ways: pure accrueExitingState() with literal ISO inputs (exact
 * math), and real-method gaps via small sleeps asserted against a FLOOR well above CI jitter and
 * well below the planted GAP (drop the accrual → bucket 0 → 0 < FLOOR → reds = non-vacuous). The
 * sweeper is driven by passing a FUTURE nowISO into expireLease (its own param), so the planted
 * dwell is large + exact without a real wait.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestPool } from "../../storage-substrate/__tests__/_pg-test-pool.js";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createPostgresStorageSubstrate, createSchemaReconciler, ALL_SCHEMAS, buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate, accrueExitingState } from "../work-item-repository-substrate.js";
import { DEFAULT_STATE_DURATIONS } from "../work-item.js";
import type { WorkItemBlockedOn, EvidenceItem, EvidenceRequirement } from "../work-item.js";

const SETUP_TIMEOUT = 90_000;
const OP_TIMEOUT = 120_000;
const MIGRATIONS_DIR = join(__dirname, "..", "..", "storage-substrate", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const GAP = 35;    // ms of planted dwell per measured state
const FLOOR = 12;  // assertion floor — comfortably under GAP, comfortably over jitter
const BLOCK: WorkItemBlockedOn = { blockerKind: "WorkItem", blockerIds: ["work-dep"], reason: "dep" };

// ── Pure accrual math (no substrate) ────────────────────────────────────────
describe("accrueExitingState (pure)", () => {
  const base = { stateDurations: { ...DEFAULT_STATE_DURATIONS }, updatedAt: "x" };
  it("accrues elapsed into the EXITING bucket only + re-stamps enteredCurrentStateAt", () => {
    const out = accrueExitingState({ ...base, status: "ready", enteredCurrentStateAt: "2026-01-01T00:00:00.000Z" }, "2026-01-01T00:00:05.000Z");
    expect(out.stateDurations.ready).toBe(5000);
    expect(out.stateDurations.claimed).toBe(0);
    expect(out.enteredCurrentStateAt).toBe("2026-01-01T00:00:05.000Z");
  });
  it("clamps negative elapsed (clock skew) to 0", () => {
    const out = accrueExitingState({ ...base, status: "in_progress", enteredCurrentStateAt: "2026-01-01T00:00:05.000Z" }, "2026-01-01T00:00:00.000Z");
    expect(out.stateDurations.in_progress).toBe(0);
  });
  it("RE-ACCUMULATES additively onto a prior bucket total", () => {
    const out = accrueExitingState({ status: "ready", enteredCurrentStateAt: "2026-01-01T00:00:00.000Z", stateDurations: { ...DEFAULT_STATE_DURATIONS, ready: 3000 }, updatedAt: "x" }, "2026-01-01T00:00:02.000Z");
    expect(out.stateDurations.ready).toBe(5000);
  });
  it("is a no-op for a terminal/non-bucket status (defensive, never throws mid-CAS)", () => {
    const out = accrueExitingState({ ...base, status: "done", enteredCurrentStateAt: "2026-01-01T00:00:00.000Z" } as Parameters<typeof accrueExitingState>[0], "2026-01-01T00:00:05.000Z");
    expect(out.stateDurations).toEqual(DEFAULT_STATE_DURATIONS);
  });
});

// ── Real-pg per-transition accrual ──────────────────────────────────────────
describe("WorkItem state-timers (real-pg)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let substrate: ReturnType<typeof createPostgresStorageSubstrate>;
  let reconciler: ReturnType<typeof createSchemaReconciler>;
  let repo: WorkItemRepositorySubstrate;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    const connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = createTestPool(connStr, "work-item-state-timers");
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

  const mk = (over: Partial<Parameters<WorkItemRepositorySubstrate["createWorkItem"]>[0]> = {}) =>
    repo.createWorkItem({ type: "task", roleEligibility: ["engineer"], ...over });
  // unique agent per item → no cross-test WIP-cap accumulation (the cap is per-agent).
  const agentOf = (id: string) => `eng-${id}`;
  const claimStart = async (id: string) => {
    const a = agentOf(id);
    const c = await repo.claimWorkItem(id, a, "engineer");
    const s = await repo.startWork(id, a, c!.lease!.token);
    return s!.lease!.token;
  };
  const farFuture = (item: { lease: { expiresAt: string } | null }, addMs: number) =>
    new Date(Date.parse(item.lease!.expiresAt) + addMs).toISOString();

  it("BIRTH: createWorkItem stamps enteredCurrentStateAt≈createdAt + zero buckets", async () => {
    const w = await mk();
    expect(w.stateDurations).toEqual(DEFAULT_STATE_DURATIONS);
    expect(w.enteredCurrentStateAt).toBe(w.createdAt);
  }, OP_TIMEOUT);

  it("BIRTH: createBlueprintNode stamps the timer too", async () => {
    const { item } = await repo.createBlueprintNode({ id: "work-bptimer1", blueprintRunId: "run1", type: "task", roleEligibility: ["engineer"] });
    expect(item.stateDurations).toEqual(DEFAULT_STATE_DURATIONS);
    expect(item.enteredCurrentStateAt).toBe(item.createdAt);
  }, OP_TIMEOUT);

  it("claim accrues READY (queue-wait)", async () => {
    const w = await mk();
    await sleep(GAP);
    const c = await repo.claimWorkItem(w.id, agentOf(w.id), "engineer");
    expect(c!.status).toBe("claimed");
    expect(c!.stateDurations.ready).toBeGreaterThanOrEqual(FLOOR);
  }, OP_TIMEOUT);

  it("start accrues CLAIMED (the claim→start limbo)", async () => {
    const w = await mk();
    const c = await repo.claimWorkItem(w.id, agentOf(w.id), "engineer");
    await sleep(GAP);
    const s = await repo.startWork(w.id, agentOf(w.id), c!.lease!.token);
    expect(s!.stateDurations.claimed).toBeGreaterThanOrEqual(FLOOR);
  }, OP_TIMEOUT);

  it("block accrues IN_PROGRESS (active work)", async () => {
    const w = await mk();
    const tok = await claimStart(w.id);
    await sleep(GAP);
    const b = await repo.blockWork(w.id, agentOf(w.id), tok, BLOCK);
    expect(b!.stateDurations.in_progress).toBeGreaterThanOrEqual(FLOOR);
  }, OP_TIMEOUT);

  it("resume accrues BLOCKED (block→resume idle)", async () => {
    const w = await mk();
    const tok = await claimStart(w.id);
    await repo.blockWork(w.id, agentOf(w.id), tok, BLOCK);
    await sleep(GAP);
    const r = await repo.resumeWork(w.id, agentOf(w.id), tok);
    expect(r!.stateDurations.blocked).toBeGreaterThanOrEqual(FLOOR);
  }, OP_TIMEOUT);

  it("complete (in_progress→review) accrues IN_PROGRESS", async () => {
    const reqs: EvidenceRequirement[] = [{ id: "code", kind: "commit" }, { id: "rev", kind: "review" }];
    const w = await mk({ evidenceRequirements: reqs });
    const tok = await claimStart(w.id);
    await sleep(GAP);
    const code: EvidenceItem = { requirementId: "code", kind: "commit", ref: "abc123", producedAt: new Date().toISOString() };
    const parked = await repo.completeWork(w.id, agentOf(w.id), tok, [code], NO_FRICTION);
    expect(parked!.status).toBe("review");
    expect(parked!.stateDurations.in_progress).toBeGreaterThanOrEqual(FLOOR);
  }, OP_TIMEOUT);

  it("release accrues the EXITING state then returns to ready", async () => {
    const w = await mk();
    const tok = await claimStart(w.id);
    await sleep(GAP);
    const r = await repo.releaseWork(w.id, agentOf(w.id), tok);
    expect(r!.status).toBe("ready");
    expect(r!.stateDurations.in_progress).toBeGreaterThanOrEqual(FLOOR);
  }, OP_TIMEOUT);

  it("abandon accrues the EXITING state (terminal)", async () => {
    const w = await mk();
    const tok = await claimStart(w.id);
    await sleep(GAP);
    const a = await repo.abandonWork(w.id, agentOf(w.id), { leaseToken: tok });
    expect(a!.status).toBe("abandoned");
    expect(a!.stateDurations.in_progress).toBeGreaterThanOrEqual(FLOOR);
  }, OP_TIMEOUT);

  it("SWEEPER requeue accrues the exiting IN_PROGRESS (large planted dwell via future nowISO)", async () => {
    const w = await mk();
    const tok = await claimStart(w.id);
    void tok;
    const started = await repo.getWorkItem(w.id);
    const nowISO = farFuture(started!, 3_600_000); // 1h past lease expiry
    expect(await repo.expireLease(w.id, nowISO, 5)).toBe("requeued");
    const swept = await repo.getWorkItem(w.id);
    expect(swept!.status).toBe("ready");
    expect(swept!.stateDurations.in_progress).toBeGreaterThanOrEqual(3_600_000);
  }, OP_TIMEOUT);

  it("SWEEPER accrues the REVIEW bucket (the surfaced fork: review→ready requeue, verifier-wait)", async () => {
    const reqs: EvidenceRequirement[] = [{ id: "code", kind: "commit" }, { id: "rev", kind: "review" }];
    const w = await mk({ evidenceRequirements: reqs });
    const tok = await claimStart(w.id);
    const code: EvidenceItem = { requirementId: "code", kind: "commit", ref: "abc123", producedAt: new Date().toISOString() };
    const parked = await repo.completeWork(w.id, agentOf(w.id), tok, [code], NO_FRICTION);
    expect(parked!.status).toBe("review");
    const nowISO = farFuture(parked!, 1_800_000); // 30m past expiry
    expect(await repo.expireLease(w.id, nowISO, 5)).toBe("requeued"); // review re-queues, no poison
    const swept = await repo.getWorkItem(w.id);
    expect(swept!.status).toBe("ready");
    expect(swept!.stateDurations.review).toBeGreaterThanOrEqual(1_800_000);
  }, OP_TIMEOUT);

  it("RE-ACCUMULATION: ready accrues ACROSS a release→re-claim (additive, two stints)", async () => {
    const w = await mk();
    await sleep(GAP);
    const c1 = await repo.claimWorkItem(w.id, agentOf(w.id), "engineer"); // ready stint 1
    const readyAfter1 = c1!.stateDurations.ready;
    expect(readyAfter1).toBeGreaterThanOrEqual(FLOOR);
    await repo.releaseWork(w.id, agentOf(w.id), c1!.lease!.token); // back to ready
    await sleep(GAP);
    const c2 = await repo.claimWorkItem(w.id, agentOf(w.id), "engineer"); // ready stint 2 ADDS
    expect(c2!.stateDurations.ready).toBeGreaterThanOrEqual(readyAfter1 + FLOOR);
  }, OP_TIMEOUT);

  it("SUM-IDENTITY: sum(buckets) === createdAt→completedAt for a full lifecycle (born under the timer)", async () => {
    const w = await mk(); // created
    await sleep(GAP);
    const c = await repo.claimWorkItem(w.id, agentOf(w.id), "engineer");
    await sleep(GAP);
    await repo.startWork(w.id, agentOf(w.id), c!.lease!.token);
    await sleep(GAP);
    const freeform: EvidenceItem = { requirementId: "none", kind: "freeform", producedAt: new Date().toISOString(), note: "lifecycle done" };
    const done = await repo.completeWork(w.id, agentOf(w.id), c!.lease!.token, [freeform], NO_FRICTION); // no reqs → straight to done (empty-req floor needs 1 freeform)
    expect(done!.status).toBe("done");
    const sum = done!.stateDurations.ready + done!.stateDurations.claimed + done!.stateDurations.in_progress + done!.stateDurations.blocked + done!.stateDurations.review;
    const wallClock = Date.parse(done!.updatedAt) - Date.parse(done!.createdAt);
    // exact identity: the only timestamps used are the transition stamps, so sum === span (ms).
    expect(sum).toBe(wallClock);
  }, OP_TIMEOUT);

  // gap-1 (carried from #427 verify): the sum-identity beyond the straight ready→in_progress→done.
  const sumB = (d: { ready: number; claimed: number; in_progress: number; blocked: number; review: number }) =>
    d.ready + d.claimed + d.in_progress + d.blocked + d.review;

  it("SUM-IDENTITY (gap-1): holds for a REVIEWED node (in_progress→review→done)", async () => {
    // a verifier Agent so the review evidence resolves to verifier-role (audit-4103 #2)
    await pool.query("INSERT INTO entities(kind,id,data) VALUES('Agent',$1,$2) ON CONFLICT (kind,id) DO NOTHING",
      ["verifier-gap1", JSON.stringify({ apiVersion: "core.ois/v1", kind: "Agent", id: "verifier-gap1", metadata: {}, spec: { role: "verifier" }, status: { phase: "online" } })]);
    const reqs: EvidenceRequirement[] = [{ id: "code", kind: "commit" }, { id: "rev", kind: "review" }];
    const w = await mk({ evidenceRequirements: reqs });
    const a = agentOf(w.id);
    const c = await repo.claimWorkItem(w.id, a, "engineer");
    await sleep(GAP);
    await repo.startWork(w.id, a, c!.lease!.token);
    await sleep(GAP);
    const parked = await repo.completeWork(w.id, a, c!.lease!.token,
      [{ requirementId: "code", kind: "commit", ref: "abc", producedAt: new Date().toISOString() }], NO_FRICTION); // → review (in_progress accrues)
    expect(parked!.status).toBe("review");
    await sleep(GAP);
    const done = await repo.completeWork(w.id, a, c!.lease!.token,
      [{ requirementId: "rev", kind: "review", ref: "note", producedBy: "verifier-gap1", producedAt: new Date().toISOString() }], NO_FRICTION); // review→done (review accrues)
    expect(done!.status).toBe("done");
    expect(done!.stateDurations.review).toBeGreaterThan(0); // the verifier-wait dwell was captured
    expect(sumB(done!.stateDurations)).toBe(Date.parse(done!.updatedAt) - Date.parse(done!.createdAt));
  }, OP_TIMEOUT);

  it("SUM-IDENTITY (gap-1): holds for a REQUEUED node (ready re-entry via release→re-claim)", async () => {
    // Requeue tested via RELEASE (a real-time ready re-entry). The sweeper requeue needs a FUTURE
    // nowISO (lease TTL = 15min, unwaitable in-test) which would inflate the entity timestamps + break
    // the entity-timestamp identity; the sweeper's per-bucket accrual is separately pinned ("SWEEPER
    // requeue accrues"). The telescoping across a ready re-entry is identical either way.
    const w = await mk();
    const a = agentOf(w.id);
    await sleep(GAP);
    const c1 = await repo.claimWorkItem(w.id, a, "engineer"); // ready stint 1
    await sleep(GAP);
    await repo.startWork(w.id, a, c1!.lease!.token);
    await sleep(GAP);
    await repo.releaseWork(w.id, a, c1!.lease!.token); // → ready (requeue)
    await sleep(GAP);
    const c2 = await repo.claimWorkItem(w.id, a, "engineer"); // ready stint 2 (re-accumulates)
    await sleep(GAP);
    await repo.startWork(w.id, a, c2!.lease!.token);
    await sleep(GAP);
    const done = await repo.completeWork(w.id, a, c2!.lease!.token,
      [{ requirementId: "none", kind: "freeform", producedAt: new Date().toISOString(), note: "done" }], NO_FRICTION);
    expect(done!.status).toBe("done");
    expect(done!.stateDurations.ready).toBeGreaterThanOrEqual(2 * FLOOR); // two ready stints summed
    expect(sumB(done!.stateDurations)).toBe(Date.parse(done!.updatedAt) - Date.parse(done!.createdAt));
  }, OP_TIMEOUT);
});
