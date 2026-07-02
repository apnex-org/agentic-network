/**
 * C1-R2 (mission-94) — WorkItemRepositorySubstrate integration tests (real-pg).
 *
 * Exercises the storage CRUD through the FULL envelope path (reconciler +
 * write-encoder wired exactly as Hub boot): create → envelope-encode (kinds/
 * WorkItem.ts module) → decode-to-flat (cloneWorkItem) round-trip, + the
 * list_ready_work-shaped reads (status equality + role $contains array-membership
 * over spec.roleEligibility, the C1-R2 operator + GIN). The claim/lease/FSM verbs
 * are sub-PR-3; this proves the kind is storable + queryable end-to-end.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestPool } from "../../storage-substrate/__tests__/_pg-test-pool.js";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createPostgresStorageSubstrate, createSchemaReconciler, ALL_SCHEMAS, buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";
import type { EvidenceRequirement, EvidenceItem, WorkItemLease } from "../work-item.js";

const SETUP_TIMEOUT = 90_000;
const OP_TIMEOUT = 120_000;
const MIGRATIONS_DIR = join(__dirname, "..", "..", "storage-substrate", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];

describe("WorkItemRepositorySubstrate (real-pg, full envelope path)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let substrate: ReturnType<typeof createPostgresStorageSubstrate>;
  let reconciler: ReturnType<typeof createSchemaReconciler>;
  let repo: WorkItemRepositorySubstrate;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    const connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = createTestPool(connStr, "work-item-repository-substrate");
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

  it("createWorkItem + getWorkItem round-trips the flat shape through envelope encode/decode", async () => {
    const created = await repo.createWorkItem({ type: "task", priority: "high", roleEligibility: ["engineer"], dependsOn: ["work-0"] });
    expect(created.id).toMatch(/^work-\d+$/);
    expect(created.status).toBe("ready");
    expect(created.lease).toBeNull();

    const got = await repo.getWorkItem(created.id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(created.id);
    expect(got!.type).toBe("task");
    expect(got!.priority).toBe("high");
    expect(got!.roleEligibility).toEqual(["engineer"]);
    expect(got!.dependsOn).toEqual(["work-0"]);
    expect(got!.status).toBe("ready");
    expect(got!.lease).toBeNull();
    expect(got!.evidence).toEqual([]);
    expect(got!.leaseExpiryCount).toBe(0);

    // Prove the row is ENVELOPED (not flat) — the module did its job.
    const raw = await pool.query<{ data: Record<string, unknown> }>(`SELECT data FROM entities WHERE kind = 'WorkItem' AND id = $1`, [created.id]);
    const d = raw.rows[0].data as { status?: { phase?: string }; spec?: { roleEligibility?: string[] } };
    expect(d.status?.phase).toBe("ready");
    expect(d.spec?.roleEligibility).toEqual(["engineer"]);
  }, OP_TIMEOUT);

  it("listWorkItems filters by status (equality) and role ($contains array-membership)", async () => {
    const eng = await repo.createWorkItem({ type: "bug", roleEligibility: ["engineer", "verifier"] });
    const arch = await repo.createWorkItem({ type: "review", roleEligibility: ["architect"] });

    const { items: ready } = await repo.listWorkItems({ status: "ready" });
    const readyIds = new Set(ready.map((w) => w.id));
    expect(readyIds.has(eng.id)).toBe(true);
    expect(readyIds.has(arch.id)).toBe(true);

    const { items: forEngineer } = await repo.listWorkItems({ role: "engineer" });
    const engIds = new Set(forEngineer.map((w) => w.id));
    expect(engIds.has(eng.id)).toBe(true);   // roleEligibility CONTAINS "engineer"
    expect(engIds.has(arch.id)).toBe(false); // architect-only — excluded

    const { items: forArchitect } = await repo.listWorkItems({ role: "architect" });
    expect(new Set(forArchitect.map((w) => w.id)).has(arch.id)).toBe(true);
  }, OP_TIMEOUT);

  // ── audit-4070 #2: edge coverage (Steve's sub-PR-2b read) ───────────────────
  // Lock the decode + envelope round-trip at the boundaries: empty/absent
  // collections, verb-populated status fields (lease/evidence — written through the
  // same encoder a sub-PR-3 verb will use), deeply-nested payload, targetRef vs
  // free-standing, and a combined status+role AND with a negative result.

  it("EDGE: empty roleEligibility=[] round-trips as [] and is excluded by every role filter", async () => {
    const w = await repo.createWorkItem({ type: "freeform", roleEligibility: [] });
    const got = await repo.getWorkItem(w.id);
    expect(got!.roleEligibility).toEqual([]);
    // $contains over an empty array never matches → never surfaces in a role projection.
    const { items: forEng } = await repo.listWorkItems({ role: "engineer" });
    expect(new Set(forEng.map((x) => x.id)).has(w.id)).toBe(false);
  }, OP_TIMEOUT);

  it("EDGE: a freshly-created lease/blockedOn is null and round-trips null through the envelope", async () => {
    const w = await repo.createWorkItem({ type: "task", roleEligibility: ["engineer"] });
    const got = await repo.getWorkItem(w.id);
    expect(got!.lease).toBeNull();
    expect(got!.blockedOn).toBeNull();
    // createWorkItem sets these explicitly → the encoder stores status.lease as
    // JSON null (faithfully, not omitted), and decode yields null (not "null"/undefined).
    const raw = await pool.query<{ data: { status?: { lease?: unknown; blockedOn?: unknown } } }>(`SELECT data FROM entities WHERE kind='WorkItem' AND id=$1`, [w.id]);
    expect(raw.rows[0].data.status?.lease).toBeNull();
    expect(raw.rows[0].data.status?.blockedOn).toBeNull();
  }, OP_TIMEOUT);

  it("EDGE: a populated multi-field lease round-trips through encode→decode (the sub-PR-3 verb write-shape)", async () => {
    // lease is verb-populated (sub-PR-3 claim); prove the STORAGE decode contract now
    // by writing the flat shape a claim verb will, through the very same encoder.
    const lease: WorkItemLease = {
      holder: "agent-x", token: "tok-x", claimedAt: "2026-06-22T00:00:00.000Z",
      expiresAt: "2026-06-22T00:05:00.000Z", heartbeatAt: "2026-06-22T00:00:00.000Z",
    };
    await substrate.put("WorkItem", {
      id: "work-edge-lease", type: "task", priority: "normal", roleEligibility: ["engineer"],
      dependsOn: [], evidenceRequirements: [], targetRef: null, status: "claimed",
      lease, evidence: [], blockedOn: null, leaseExpiryCount: 2,
      createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:00:00.000Z",
    });
    const got = await repo.getWorkItem("work-edge-lease");
    expect(got!.lease).toEqual(lease);
    expect(got!.status).toBe("claimed");
    expect(got!.leaseExpiryCount).toBe(2);
    const raw = await pool.query<{ data: { status?: { lease?: { holder?: string } } } }>(`SELECT data FROM entities WHERE kind='WorkItem' AND id='work-edge-lease'`);
    expect(raw.rows[0].data.status?.lease?.holder).toBe("agent-x");
  }, OP_TIMEOUT);

  it("EDGE: multi-element evidenceRequirements (spec) + evidence (status) round-trip verbatim", async () => {
    const evidenceRequirements: EvidenceRequirement[] = [
      { id: "r1", kind: "commit", refResolvable: false },
      { id: "r2", kind: "pr", refResolvable: false },
      { id: "r3", kind: "audit", refResolvable: true },
    ];
    const evidence: EvidenceItem[] = [
      { requirementId: "r1", kind: "commit", ref: "abc123", producedAt: "2026-06-22T00:00:00.000Z" },
      { requirementId: "r2", kind: "pr", ref: "#999", producedAt: "2026-06-22T00:01:00.000Z", note: "secondary" },
    ];
    await substrate.put("WorkItem", {
      id: "work-edge-ev", type: "review", priority: "normal", roleEligibility: ["verifier"],
      dependsOn: [], evidenceRequirements, targetRef: null, status: "review",
      lease: null, evidence, blockedOn: null, leaseExpiryCount: 0,
      createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:00:00.000Z",
    });
    const got = await repo.getWorkItem("work-edge-ev");
    expect(got!.evidenceRequirements).toEqual(evidenceRequirements);
    expect(got!.evidence).toEqual(evidence);
  }, OP_TIMEOUT);

  it("EDGE: a deeply-nested payload survives the envelope round-trip verbatim", async () => {
    const payload = { a: { b: { c: [1, 2, { d: "deep", e: [true, null, "x"] }] } }, list: [{ k: "v" }, { k: "w" }] };
    const w = await repo.createWorkItem({ type: "freeform", roleEligibility: ["engineer"], payload });
    const got = await repo.getWorkItem(w.id);
    expect(got!.payload).toEqual(payload);
  }, OP_TIMEOUT);

  it("EDGE: targetRef-bearing vs free-standing (payload-only) both round-trip", async () => {
    const ref = await repo.createWorkItem({ type: "task", roleEligibility: ["engineer"], targetRef: { kind: "Task", id: "task-7" } });
    const free = await repo.createWorkItem({ type: "freeform", roleEligibility: ["engineer"], payload: { note: "standalone" } });
    expect((await repo.getWorkItem(ref.id))!.targetRef).toEqual({ kind: "Task", id: "task-7" });
    const gotFree = await repo.getWorkItem(free.id);
    expect(gotFree!.targetRef).toBeNull();
    expect(gotFree!.payload).toEqual({ note: "standalone" });
  }, OP_TIMEOUT);

  it("EDGE: combined status+role filter ANDs — role-match but status-mismatch is EXCLUDED", async () => {
    // engineer-eligible but DONE (status is verb-controlled → put directly).
    await substrate.put("WorkItem", {
      id: "work-edge-done", type: "task", priority: "normal", roleEligibility: ["engineer"],
      dependsOn: [], evidenceRequirements: [], targetRef: null, status: "done",
      lease: null, evidence: [], blockedOn: null, leaseExpiryCount: 0,
      createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:00:00.000Z",
    });
    const readyEng = await repo.createWorkItem({ type: "task", roleEligibility: ["engineer"] });
    const { items: readyEngineers } = await repo.listWorkItems({ status: "ready", role: "engineer" });
    const ids = new Set(readyEngineers.map((x) => x.id));
    expect(ids.has(readyEng.id)).toBe(true);        // ready AND engineer → included
    expect(ids.has("work-edge-done")).toBe(false);  // engineer but DONE → AND excludes
    // and it DOES surface when the status leg matches:
    const { items: doneEng } = await repo.listWorkItems({ status: "done", role: "engineer" });
    expect(new Set(doneEng.map((x) => x.id)).has("work-edge-done")).toBe(true);
  }, OP_TIMEOUT);

  it("listReadyForRole: role-eligible + empty(any-role) OR'd in; other-role excluded (sub-PR-3b)", async () => {
    const eng = await repo.createWorkItem({ type: "task", roleEligibility: ["engineer"] });
    const arch = await repo.createWorkItem({ type: "task", roleEligibility: ["architect"] });
    const any = await repo.createWorkItem({ type: "task", roleEligibility: [] });
    const { items, truncated } = await repo.listReadyForRole("engineer", 500);
    const ids = new Set(items.map((w) => w.id));
    expect(ids.has(eng.id)).toBe(true);    // engineer-eligible
    expect(ids.has(any.id)).toBe(true);    // empty roleEligibility = any-role → OR'd in
    expect(ids.has(arch.id)).toBe(false);  // architect-only → excluded for engineer
    expect(truncated).toBe(false);         // well under the scan cap
    // role undefined → all ready (no role filter), so the architect-only item appears
    const all = new Set((await repo.listReadyForRole(undefined, 500)).items.map((w) => w.id));
    expect(all.has(arch.id)).toBe(true);
    // limit slices the projection
    expect((await repo.listReadyForRole("engineer", 1)).items.length).toBe(1);
  }, OP_TIMEOUT);

  it("listReadyForRole: bug-181 — eligible-role item with UNMET deps is filtered (projection == claim_work's deps gate)", async () => {
    // A DONE dependency (status is verb-controlled → put directly, mirroring the EDGE test).
    await substrate.put("WorkItem", {
      id: "work-181-dep-done", type: "task", priority: "normal", roleEligibility: ["engineer"],
      dependsOn: [], evidenceRequirements: [], targetRef: null, status: "done",
      lease: null, evidence: [], blockedOn: null, leaseExpiryCount: 0,
      createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:00:00.000Z",
    });
    // A NOT-done dependency (stays `ready`) — its dependents are not yet claimable.
    const depPending = await repo.createWorkItem({ type: "task", roleEligibility: ["engineer"] });

    // The bug-181 repro: VERIFIER-eligible, deps UNMET. Pre-fix this passed the role
    // filter and listed as `ready`, then a claim hit ClaimRejected (eligible-role-deps-unmet leak).
    const blocked = await repo.createWorkItem({ type: "task", roleEligibility: ["verifier"], dependsOn: [depPending.id] });
    // VERIFIER-eligible, deps MET (dep is done) → must list ready.
    const claimable = await repo.createWorkItem({ type: "task", roleEligibility: ["verifier"], dependsOn: ["work-181-dep-done"] });
    // Absent dep → fail-CLOSED unmet → excluded (parity with unmetDependencies).
    const absentDep = await repo.createWorkItem({ type: "task", roleEligibility: ["verifier"], dependsOn: ["work-181-ghost"] });

    const ids = new Set((await repo.listReadyForRole("verifier", 500)).items.map((w) => w.id));
    expect(ids.has(claimable.id)).toBe(true);   // deps done → claimable → listed
    expect(ids.has(blocked.id)).toBe(false);    // dep not done → NOT claimable → filtered (bug-181)
    expect(ids.has(absentDep.id)).toBe(false);  // absent dep → fail-closed unmet → filtered

    // Parity with the AUTHORITY: claim_work rejects the same filtered item, proving the
    // projection now matches the claim predicate (no eligible-role-deps-unmet divergence).
    await expect(repo.claimWorkItem(blocked.id, "agent-verifier-x", "verifier")).rejects.toThrow(/dependencies not done/);
  }, OP_TIMEOUT);

  it("listReadyForRole agent-scoped: a WIP-capped caller's projection is EMPTY (AC5 parity / idea-353 WI-2.1)", async () => {
    const MAXED = "agent-wip-maxed";
    const FRESH = "agent-wip-fresh";
    const ROLE = "engineer";
    // Default WIP cap is 3 — claim 3 ready items to max MAXED out.
    for (let i = 0; i < 3; i++) {
      const w = await repo.createWorkItem({ type: "task", roleEligibility: [ROLE] });
      expect((await repo.claimWorkItem(w.id, MAXED, ROLE))?.status).toBe("claimed");
    }
    // A fresh claimable item for the same role (no deps, role-eligible).
    const target = await repo.createWorkItem({ type: "task", roleEligibility: [ROLE] });

    // Non-agent-scoped projection (the role view / D-1 R1 seam) STILL lists it — unchanged.
    expect(new Set((await repo.listReadyForRole(ROLE, 500)).items.map((w) => w.id)).has(target.id)).toBe(true);

    // Agent-scoped projection for the MAXED caller → empty (can't claim anything).
    expect((await repo.listReadyForRole(ROLE, 500, MAXED)).items).toEqual([]);
    // Parity with the AUTHORITY: claim_work rejects the maxed caller with the same predicate.
    await expect(repo.claimWorkItem(target.id, MAXED, ROLE)).rejects.toThrow(/WIP cap exceeded/);

    // A DIFFERENT, under-cap caller → the agent-scoped projection DOES include it.
    expect(new Set((await repo.listReadyForRole(ROLE, 500, FRESH)).items.map((w) => w.id)).has(target.id)).toBe(true);
  }, OP_TIMEOUT);

  it("list_work backing: listWorkItems filters by holder + returns the lease COLUMN; observability surfaces NON-ready items (stint-4 R1 / idea-357-pt3)", async () => {
    const ROLE = "engineer";
    const HOLDER = "agent-listwork-holder";
    // A leased item: claim it so it carries a real lease {holder, expiresAt, ...} on a real-pg row.
    const leased = await repo.createWorkItem({ type: "task", roleEligibility: [ROLE] });
    expect((await repo.claimWorkItem(leased.id, HOLDER, ROLE))?.status).toBe("claimed");
    // An unleased ready item for the same role (lease === null).
    const unleased = await repo.createWorkItem({ type: "task", roleEligibility: [ROLE] });
    // A DIFFERENT holder's item — must NOT match the holder filter.
    const otherHeld = await repo.createWorkItem({ type: "task", roleEligibility: [ROLE] });
    expect((await repo.claimWorkItem(otherHeld.id, "agent-other", ROLE))?.status).toBe("claimed");

    // HOLDER filter → ONLY the item HOLDER leases (equality on the indexed status.lease.holder path).
    const byHolder = await repo.listWorkItems({ holder: HOLDER });
    const holderIds = new Set(byHolder.items.map((w) => w.id));
    expect(holderIds.has(leased.id)).toBe(true);     // held by HOLDER → matched
    expect(holderIds.has(unleased.id)).toBe(false);  // no lease → not matched
    expect(holderIds.has(otherHeld.id)).toBe(false); // different holder → not matched
    expect(byHolder.truncated).toBe(false);

    // The lease is a first-class COLUMN on the returned flat item (real-pg envelope decode):
    // holder + expiry are visible so the controller sees lease state at a glance (tele-4).
    const leasedRow = byHolder.items.find((w) => w.id === leased.id)!;
    expect(leasedRow.lease).not.toBeNull();
    expect(leasedRow.lease!.holder).toBe(HOLDER);
    expect(typeof leasedRow.lease!.expiresAt).toBe("string"); // lease expiry/state visible
    expect(leasedRow.status).toBe("claimed");

    // Observability (UNFILTERED by claim-readiness): a status filter surfaces NON-ready
    // items (claimed) — list_work shows ALL matching items, unlike list_ready_work.
    const claimed = await repo.listWorkItems({ status: "claimed" });
    const claimedIds = new Set(claimed.items.map((w) => w.id));
    expect(claimedIds.has(leased.id)).toBe(true);
    expect(claimedIds.has(otherHeld.id)).toBe(true);
    expect(claimedIds.has(unleased.id)).toBe(false); // still `ready`, not `claimed`
    // An unleased item carries a null lease column (round-trips through the envelope).
    const stillReady = await repo.listWorkItems({ status: "ready" });
    expect(stillReady.items.find((w) => w.id === unleased.id)!.lease).toBeNull();
  }, OP_TIMEOUT);
});
