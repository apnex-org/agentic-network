/**
 * C1-R2 (mission-94) sub-PR-4a — WorkItem lease-expiry sweeper (real-pg).
 *
 * Injected `nowISO` is the testable clock (no 15-min waits): a claim sets
 * expiresAt = claimedAt + LEASE_TTL; sweeping with a future nowISO makes the lease
 * lapsed. Covers: expired → re-queue + leaseExpiryCount++; a valid lease left
 * untouched; POISON-ABANDON at the cap; and the renew-vs-sweeper CAS one-winner
 * (expireLease re-checks expiry on the fresh row → a lease pushed past nowISO is
 * skipped, never double-swept).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestPool } from "../../storage-substrate/__tests__/_pg-test-pool.js";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createPostgresStorageSubstrate, createSchemaReconciler, ALL_SCHEMAS, buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import { AuditRepositorySubstrate } from "../../entities/audit-repository-substrate.js";
import { WorkItemRepositorySubstrate } from "../../entities/work-item-repository-substrate.js";
import { WorkItemLeaseSweeper } from "../work-item-lease-sweeper.js";
import { createMetricsCounter } from "../../observability/metrics.js";
import type { IPolicyContext } from "../types.js";

const SETUP_TIMEOUT = 90_000;
const OP_TIMEOUT = 120_000;
const MIGRATIONS_DIR = join(__dirname, "..", "..", "storage-substrate", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];
const FUTURE = "2099-01-01T00:00:00.000Z"; // past any real claim's expiresAt → lease lapsed

const ctxProvider = {
  forSweeper: (): IPolicyContext => ({
    stores: {} as never, metrics: createMetricsCounter(),
    emit: async () => {}, dispatch: async () => {},
    sessionId: "test-lease-sweeper", clientIp: "127.0.0.1", role: "system", internalEvents: [],
  } as unknown as IPolicyContext),
};

describe("WorkItemLeaseSweeper (real-pg)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let substrate: ReturnType<typeof createPostgresStorageSubstrate>;
  let reconciler: ReturnType<typeof createSchemaReconciler>;
  let repo: WorkItemRepositorySubstrate;
  let audit: AuditRepositorySubstrate;
  let sweeper: WorkItemLeaseSweeper;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    const connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = createTestPool(connStr, "work-item-lease-sweeper-substrate");
    for (const f of MIGRATION_FILES) await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    substrate = createPostgresStorageSubstrate(connStr);
    reconciler = createSchemaReconciler(substrate, connStr, { initialSchemas: ALL_SCHEMAS });
    await reconciler.start();
    substrate.setFieldTranslator((kind, key) => reconciler.getFieldTranslation(kind, key));
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    const counter = new SubstrateCounter(substrate);
    repo = new WorkItemRepositorySubstrate(substrate, counter);
    audit = new AuditRepositorySubstrate(substrate, counter);
    sweeper = new WorkItemLeaseSweeper(repo, ctxProvider, { audit });
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    sweeper?.stop();
    if (reconciler) await reconciler.close();
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, OP_TIMEOUT);

  const ready = () => repo.createWorkItem({ type: "task", roleEligibility: [] });

  it("sweeps an expired lease back to ready + increments leaseExpiryCount", async () => {
    const w = await ready();
    await repo.claimWorkItem(w.id, "agent-1");
    const res = await sweeper.fullSweep(FUTURE);
    expect(res.requeued).toBeGreaterThanOrEqual(1);
    const after = await repo.getWorkItem(w.id);
    expect(after!.status).toBe("ready");
    expect(after!.lease).toBeNull();
    expect(after!.leaseExpiryCount).toBe(1);
  }, OP_TIMEOUT);

  it("leaves a STILL-VALID lease untouched (nowISO before expiresAt)", async () => {
    const w = await ready();
    const c = await repo.claimWorkItem(w.id, "agent-2");
    // sweep at claimedAt (== now < expiresAt) — the item is not expired.
    await sweeper.fullSweep(c!.lease!.claimedAt);
    const after = await repo.getWorkItem(w.id);
    expect(after!.status).toBe("claimed");
    expect(after!.leaseExpiryCount).toBe(0);
  }, OP_TIMEOUT);

  it("POISON-ABANDONS an item after poisonCap lease-expiry cycles", async () => {
    const sweeper2 = new WorkItemLeaseSweeper(repo, ctxProvider, { audit, poisonCap: 2 });
    const w = await ready();
    await repo.claimWorkItem(w.id, "agent-p1");
    expect((await sweeper2.fullSweep(FUTURE)).abandoned).toBe(0); // count 1 (< 2) → requeue
    expect((await repo.getWorkItem(w.id))!.status).toBe("ready");
    expect((await repo.getWorkItem(w.id))!.leaseExpiryCount).toBe(1);

    await repo.claimWorkItem(w.id, "agent-p2"); // re-claim (poison counter persists at 1)
    const res = await sweeper2.fullSweep(FUTURE);                 // count 2 (>= 2) → abandon
    expect(res.abandoned).toBeGreaterThanOrEqual(1);
    const after = await repo.getWorkItem(w.id);
    expect(after!.status).toBe("abandoned");
    expect(after!.leaseExpiryCount).toBe(2);
    expect(after!.lease).toBeNull();
  }, OP_TIMEOUT);

  it("renew-vs-sweeper CAS one-winner: expireLease re-checks expiry on the fresh row", async () => {
    const w = await ready();
    const c = await repo.claimWorkItem(w.id, "agent-race");
    const expiresAt = c!.lease!.expiresAt;
    // a sweep whose nowISO is BEFORE the (renewed-out) expiry → SKIP, item untouched.
    const before = new Date(Date.parse(expiresAt) - 1000).toISOString();
    expect(await repo.expireLease(w.id, before, 3)).toBe("skipped");
    expect((await repo.getWorkItem(w.id))!.status).toBe("claimed");
    // a sweep whose nowISO is AFTER the expiry → re-queue.
    const after = new Date(Date.parse(expiresAt) + 1000).toISOString();
    expect(await repo.expireLease(w.id, after, 3)).toBe("requeued");
    expect((await repo.getWorkItem(w.id))!.status).toBe("ready");
  }, OP_TIMEOUT);

  it("expireLease on an absent item → skipped (no throw)", async () => {
    expect(await repo.expireLease("work-ghost", FUTURE, 3)).toBe("skipped");
  }, OP_TIMEOUT);

  // ── 4b-ii / work-593: per-AGENT thrash COUNTER wiring (stub AgentThrashStore) ─
  function agentStub(ret: { thrashCount: number } = { thrashCount: 1 }) {
    const calls: Array<{ agentId: string }> = [];
    return { calls, recordWorkItemThrash: async (agentId: string) => { calls.push({ agentId }); return ret; } };
  }

  it("a claim→expire-WITHOUT-evidence increments the holder's thrash counter", async () => {
    const stub = agentStub();
    const sw = new WorkItemLeaseSweeper(repo, ctxProvider, { agentStore: stub });
    const w = await ready();
    await repo.claimWorkItem(w.id, "agent-thrash-x");
    const res = await sw.fullSweep(FUTURE);
    // 🔴 work-593: THE COUNTER MUST STILL WRITE. The Director kept it as a metric, so its
    // removal alongside the lockout would be a silent scope overrun — and idea-675's
    // successor design would inherit an empty series.
    expect(stub.calls).toContainEqual({ agentId: "agent-thrash-x" });
    expect(res.agentsThrashed).toBeGreaterThanOrEqual(1);
  }, OP_TIMEOUT);

  it("a lapse WITH evidence (review-phase item) does NOT thrash the holder", async () => {
    const stub = agentStub();
    const sw = new WorkItemLeaseSweeper(repo, ctxProvider, { agentStore: stub });
    // a review-phase item that HAS evidence + an already-expired lease (verb-reached state → direct put).
    await substrate.put("WorkItem", {
      id: "work-rev-ev", type: "task", priority: "normal", roleEligibility: [], dependsOn: [],
      evidenceRequirements: [], targetRef: null, status: "review",
      lease: { holder: "agent-rev-ev", token: "t", claimedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2020-01-01T00:05:00.000Z", heartbeatAt: "2020-01-01T00:00:00.000Z" },
      evidence: [{ requirementId: "r", kind: "freeform", producedAt: "2020-01-01T00:01:00.000Z" }],
      blockedOn: null, leaseExpiryCount: 0, createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z",
    });
    await sw.fullSweep(FUTURE); // requeues the review item (review is lease-held) but hadEvidence → no thrash
    expect(stub.calls.find((c) => c.agentId === "agent-rev-ev")).toBeUndefined();
  }, OP_TIMEOUT);

  it("🔴 work-593: a HIGH thrash count NO LONGER quarantines — it only counts, and emits no lockout audit", async () => {
    // Was: "an agent newly hitting the thrash cap → result.agentsQuarantined + LOUD audit".
    // The count is now unbounded and consequence-free. Asserting the ABSENCE of the audit
    // action is the load-bearing half: a sweeper that still quarantined would satisfy the
    // counter assertion and fail here.
    const stub = agentStub({ thrashCount: 99 }); // far past the old cap of 3
    const sw = new WorkItemLeaseSweeper(repo, ctxProvider, { agentStore: stub, audit });
    const w = await ready();
    await repo.claimWorkItem(w.id, "agent-quar-y");
    const res = await sw.fullSweep(FUTURE);
    expect(res.agentsThrashed).toBeGreaterThanOrEqual(1);
    expect(res).not.toHaveProperty("agentsQuarantined");
    const actions = (await audit.listEntries()).map((e) => e.action);
    expect(actions).not.toContain("agent_workitem_quarantined");
  }, OP_TIMEOUT);

  // ── audit-4103 #3: review/blocked lapse re-queues WITHOUT poison ─────────────
  it("review/blocked lease-expiry re-queues WITHOUT poison-increment; claimed still abandons at cap", async () => {
    const expiredLease = { holder: "a", token: "t", claimedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2020-01-01T00:05:00.000Z", heartbeatAt: "2020-01-01T00:00:00.000Z" };
    const mk = (id: string, status: string, extra: Record<string, unknown> = {}) => substrate.put("WorkItem", {
      id, type: "task", priority: "normal", roleEligibility: [], dependsOn: [], evidenceRequirements: [],
      targetRef: null, status, lease: expiredLease, evidence: [], frictionReflections: [], blockedOn: null,
      leaseExpiryCount: 3, createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z", ...extra,
    });
    await mk("work-h3-review", "review", { evidence: [{ requirementId: "r", kind: "freeform", producedAt: "2020-01-01T00:01:00.000Z" }] });
    await mk("work-h3-blocked", "blocked", { blockedOn: { blockerKind: "WorkItem", reason: "dep" } });
    // work-594: the claimed row now carries DATED lapses inside its poison window. The
    // fixture previously relied on a bare `leaseExpiryCount: 3` with no recallHistory —
    // which is precisely the contract this node replaced, and (swept at 2099) would now be
    // 79 years outside any window. THE ASSERTION'S PURPOSE IS PRESERVED, NOT WEAKENED: it
    // still proves a claimed row at the cap terminally abandons; it just has to reach the
    // cap the way the code now counts. Swept at a controlled `now` rather than FUTURE so the
    // lapses can be dated relative to it.
    await mk("work-h3-claimed", "claimed", {
      leaseWindowMs: 3_600_000, // 1h lease -> 3h poison window
      recallHistory: [
        { operationId: "lease-expiry:work-h3-claimed:t1", recalledAt: "2020-01-01T03:00:00.000Z",
          actor: { role: "system", agentId: "lease-expiry-sweeper" }, reason: "prior lapse", before: { phase: "claimed" } },
        { operationId: "lease-expiry:work-h3-claimed:t2", recalledAt: "2020-01-01T04:00:00.000Z",
          actor: { role: "system", agentId: "lease-expiry-sweeper" }, reason: "prior lapse", before: { phase: "claimed" } },
      ],
    });
    const CLAIMED_NOW = "2020-01-01T05:00:00.000Z"; // both priors within the 3h window

    // review + blocked at cap(3): re-queue, count UNCHANGED, NOT abandoned
    expect(await repo.expireLease("work-h3-review", FUTURE, 3)).toBe("requeued");
    const rev = await repo.getWorkItem("work-h3-review");
    expect(rev!.status).toBe("ready");
    expect(rev!.leaseExpiryCount).toBe(3); // unchanged — never accrues poison
    expect(rev!.evidence.length).toBe(1);  // evidence preserved on re-queue (recoverable)

    expect(await repo.expireLease("work-h3-blocked", FUTURE, 3)).toBe("requeued");
    expect((await repo.getWorkItem("work-h3-blocked"))!.leaseExpiryCount).toBe(3);

    // claimed at cap(3): poison STILL applies → terminal abandon
    expect(await repo.expireLease("work-h3-claimed", CLAIMED_NOW, 3)).toBe("abandoned");
    expect((await repo.getWorkItem("work-h3-claimed"))!.status).toBe("abandoned");
  }, OP_TIMEOUT);

  // ══ work-594 / bug-406 — THE POISON CAP IS A WINDOW, NOT A LIFETIME BUDGET ══════
  //
  // 🔴 WHAT WENT WRONG. `leaseExpiryCount` is cumulative over the row's ENTIRE LIFETIME and
  // shared across every holder it has ever had, with no reset path anywhere in hub/src. A row
  // that lapsed twice weeks ago sat permanently one lapse from irreversible abandon, and
  // whoever drew it next inherited that invisibly. `work-bp-seatrec0-arc_driver` — the previous
  // planning arc's CONTROLLER NODE — died exactly that way, to a holder that had RENEWED ON
  // SCHEDULE and then lost the ability to prove who it was (bug-398, closed by this same arc).
  //
  // ─── TWO FALSIFIERS DOING DIFFERENT WORK (idea-677) ──────────────────────────
  //   1 NEGATIVE  the SPREAD row must go RED against today's code: today `abandoned`,
  //               after `requeued`. A test that merely exercises the counter passes both.
  //   2 POSITIVE  🔴 the CONSECUTIVE row MUST STILL DIE. Without it, DELETING THE CAP
  //               ENTIRELY passes falsifier 1 — and since B5 removed quarantine (the REACH
  //               half) hours ago, that would mean this arc deleted BOTH HALVES of the
  //               protection pair. This assertion is the proof it did not.
  //
  // The two rows differ ONLY in the timestamps of their prior lapses. Same phase, same
  // leaseExpiryCount, same cap, same lease window — so the outcome cannot be attributed to
  // anything but the window.
  describe("work-594: poison is evaluated over a window derived from the lease", () => {
    // A literal replay of the live instance. NOW is its third lapse; the two priors are its
    // real recorded times. Window = poisonCap(3) x leaseWindowMs(1h) = 3h.
    const NOW = "2026-07-27T00:30:39.000Z";
    const SPREAD = ["2026-07-26T21:21:37.000Z", "2026-07-26T22:31:54.000Z"]; // -3h09m (OUT), -1h58m (in)
    const BURST = ["2026-07-26T22:30:39.000Z", "2026-07-26T23:30:39.000Z"];  // -2h,     -1h    (both in)

    async function rowWithLapses(id: string, lapses: string[]) {
      await substrate.put("WorkItem", {
        id, type: "task", priority: "normal", roleEligibility: [], dependsOn: [],
        evidenceRequirements: [], targetRef: null, status: "in_progress",
        leaseWindowMs: 3_600_000, // 1h -> a 3h poison window; also exercises the self-scaling
        lease: { holder: "agent-w594", token: `tok-${id}`, claimedAt: "2026-07-26T23:30:39.000Z",
                 expiresAt: "2026-07-27T00:30:00.000Z", heartbeatAt: "2026-07-27T00:15:39.000Z" },
        evidence: [], frictionReflections: [], blockedOn: null,
        // Both rows carry the SAME lifetime count. Under today's code that alone decides.
        leaseExpiryCount: lapses.length,
        recallHistory: lapses.map((at, i) => ({
          operationId: `lease-expiry:${id}:tok-prior-${i}`,
          recalledAt: at, actor: { role: "system", agentId: "lease-expiry-sweeper" },
          reason: "prior lapse", before: { phase: "in_progress" },
        })),
        createdAt: "2026-07-26T20:00:00.000Z", updatedAt: "2026-07-26T20:00:00.000Z",
      });
    }

    it("🔴 FALSIFIER 1 — SPREAD lapses (the live instance) REQUEUE; today's code abandons them", async () => {
      await rowWithLapses("work-w594-spread", SPREAD);
      const outcome = await repo.expireLease("work-w594-spread", NOW, 3);
      // The oldest lapse is 3h09m back — OUTSIDE the 3h window — so only 1 prior counts,
      // plus this one = 2 < 3. Today: lifetime 2 + 1 = 3 >= 3 -> "abandoned".
      expect(outcome).toBe("requeued");
      const w = await repo.getWorkItem("work-w594-spread");
      expect(w!.status).toBe("ready");                 // recoverable, not terminally consumed
      expect(w!.leaseExpiryCount).toBe(3);             // the LIFETIME counter still advances
    }, OP_TIMEOUT);

    it("🔴 FALSIFIER 2 — CONSECUTIVE lapses STILL POISON-ABANDON (the cap remains reachable)", async () => {
      await rowWithLapses("work-w594-burst", BURST);
      const outcome = await repo.expireLease("work-w594-burst", NOW, 3);
      // Both priors are inside the 3h window -> 2 + 1 = 3 >= 3. A genuinely poisonous row,
      // one that consumes seat after seat without progressing, still dies.
      expect(outcome).toBe("abandoned");
      expect((await repo.getWorkItem("work-w594-burst"))!.status).toBe("abandoned");
    }, OP_TIMEOUT);

    it("the two rows are distinguished ONLY by lapse timing — same lifetime count, same cap", async () => {
      // Pins the attribution. If someone later "simplifies" the window away, this is the test
      // that says the difference was never supposed to come from the counter.
      const spread = await repo.getWorkItem("work-w594-spread");
      const burst = await repo.getWorkItem("work-w594-burst");
      expect(spread!.leaseExpiryCount).toBe(burst!.leaseExpiryCount); // identical counters...
      expect(spread!.status).not.toBe(burst!.status);                 // ...opposite outcomes
    }, OP_TIMEOUT);

    it("a row with NO lapse history is never poisoned on its first lapse (the amnesty case)", async () => {
      // Rows whose lapses predate bug-384 carry a lifetime count with NO recallHistory to date
      // it. They count 0 and get a clean budget. Erring toward NOT terminating rows is the
      // safe direction, and the live census found zero non-terminal rows at lec>=2.
      await substrate.put("WorkItem", {
        id: "work-w594-legacy", type: "task", priority: "normal", roleEligibility: [], dependsOn: [],
        evidenceRequirements: [], targetRef: null, status: "in_progress", leaseWindowMs: 3_600_000,
        lease: { holder: "a", token: "t-legacy", claimedAt: "2026-07-26T23:30:39.000Z",
                 expiresAt: "2026-07-27T00:30:00.000Z", heartbeatAt: "2026-07-26T23:30:39.000Z" },
        evidence: [], frictionReflections: [], blockedOn: null,
        leaseExpiryCount: 7,           // a large LIFETIME debt with no dated record behind it
        recallHistory: [],
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
      });
      expect(await repo.expireLease("work-w594-legacy", NOW, 3)).toBe("requeued");
    }, OP_TIMEOUT);
  });

});
