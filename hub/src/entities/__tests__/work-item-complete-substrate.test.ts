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
import { createTestPool } from "../../storage-substrate/__tests__/_pg-test-pool.js";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createPostgresStorageSubstrate, createSchemaReconciler, ALL_SCHEMAS, buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate, TransitionRejected, EvidencePredicateFailed, CompletionGateRejected } from "../work-item-repository-substrate.js";
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
    pool = createTestPool(connStr, "work-item-complete-substrate");
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
    const w = await repo.createWorkItem({ type: "task", roleEligibility: [], evidenceRequirements: reqs });
    const claimed = await repo.claimWorkItem(w.id, agent);
    const token = claimed!.lease!.token;
    await repo.startWork(w.id, agent, token);
    return { id: w.id, token, claimedAt: claimed!.lease!.claimedAt };
  }
  const ev = (e: Partial<EvidenceItem> & Pick<EvidenceItem, "requirementId" | "kind">): EvidenceItem =>
    ({ producedAt: new Date().toISOString(), ...e });

  // ── audit-4103 #1/#2 helpers ────────────────────────────────────────────────
  /** Insert a raw envelope Agent with a given role (resolveAgentRole reads spec.role). */
  async function mkAgent(id: string, role: string): Promise<void> {
    await pool.query("INSERT INTO entities(kind,id,data) VALUES('Agent',$1,$2) ON CONFLICT (kind,id) DO NOTHING",
      [id, JSON.stringify({ apiVersion: "core.ois/v1", kind: "Agent", id, metadata: {}, spec: { role }, status: { phase: "online" } })]);
  }
  /** Insert a raw envelope Audit with a given relatedEntity (Audit.relatedEntity → spec.relatedEntity). */
  async function mkAudit(id: string, relatedEntity: string): Promise<void> {
    await pool.query("INSERT INTO entities(kind,id,data) VALUES('Audit',$1,$2) ON CONFLICT (kind,id) DO NOTHING",
      [id, JSON.stringify({ apiVersion: "core.ois/v1", kind: "Audit", id, metadata: {}, spec: { action: "x", details: "y", relatedEntity }, status: {} })]);
  }
  /** Drive an any-role WorkItem to phase=done (for verifier-gate fixtures). */
  async function driveDone(id: string, agent: string): Promise<void> {
    const c = await repo.claimWorkItem(id, agent);
    await repo.startWork(id, agent, c!.lease!.token);
    await repo.completeWork(id, agent, c!.lease!.token, [{ requirementId: "x", kind: "freeform", producedAt: new Date().toISOString() }]);
  }

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

  it("#1/#2 review→WorkItem (audit-4120 non-spoofable): nonexistent → fail; unrelated → fail; WORKER-created gate → fail; verifier-created done gate targeting THIS item → done", async () => {
    const reqs: EvidenceRequirement[] = [{ id: "r1", kind: "review", refResolvable: true }];
    const good = await started(reqs, "agent-c6b");
    const reviewEv = (ref: string) => ev({ requirementId: "r1", kind: "review", ref });
    const mkGate = (targetId: string, creatorRole: string) =>
      repo.createWorkItem({ type: "verifier-gate", roleEligibility: [], targetRef: { kind: "WorkItem", id: targetId }, createdBy: { role: creatorRole, agentId: `${creatorRole}-1` } });
    // nonexistent ref → fail (existence)
    await expect(repo.completeWork(good.id, "agent-c6b", good.token, [reviewEv("work-nonexistent")]))
      .rejects.toThrow(/does not resolve/);
    // a verifier-created, DONE gate that targets a DIFFERENT item → fail (#1 relevance; the
    // gate's Hub-stamped targetRef — not a caller payload — is checked)
    const unrelated = await mkGate("work-elsewhere", "verifier");
    await driveDone(unrelated.id, "agent-vg-u");
    await expect(repo.completeWork(good.id, "agent-c6b", good.token, [reviewEv(unrelated.id)]))
      .rejects.toThrow(/does not RELATE/);
    // a WORKER-created gate targeting THIS item + done → fail (#2 non-spoofable: the gate's
    // Hub-stamped createdBy is checked, not the caller's producedBy claim)
    const workerGate = await mkGate(good.id, "engineer");
    await driveDone(workerGate.id, "agent-vg-w");
    await expect(repo.completeWork(good.id, "agent-c6b", good.token, [reviewEv(workerGate.id)]))
      .rejects.toThrow(/not created by a verifier/);
    // a VERIFIER-created gate targeting THIS item + phase=done → done
    const gate = await mkGate(good.id, "verifier");
    await driveDone(gate.id, "agent-vg-g");
    expect((await repo.completeWork(good.id, "agent-c6b", good.token, [reviewEv(gate.id)]))!.status).toBe("done");
  }, OP_TIMEOUT);

  it("#1 audit relevance: an unrelated Audit → fail; an Audit about THIS item → pass", async () => {
    await mkAudit("audit-unrel", "work-elsewhere");
    await mkAudit("audit-rel", "PLACEHOLDER"); // relatedEntity patched below to the real id
    const reqs: EvidenceRequirement[] = [{ id: "a1", kind: "audit", refResolvable: true }];
    const w = await started(reqs, "agent-au");
    // unrelated audit (exists, but relatedEntity points elsewhere) → relevance fail
    await expect(repo.completeWork(w.id, "agent-au", w.token, [ev({ requirementId: "a1", kind: "audit", ref: "audit-unrel" })]))
      .rejects.toThrow(/does not RELATE/);
    // an audit whose relatedEntity IS this work-item → pass
    await pool.query("UPDATE entities SET data = jsonb_set(data, '{spec,relatedEntity}', to_jsonb($2::text)) WHERE kind='Audit' AND id=$1", ["audit-rel", w.id]);
    const done = await repo.completeWork(w.id, "agent-au", w.token, [ev({ requirementId: "a1", kind: "audit", ref: "audit-rel" })]);
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

  it("FSM: a review requirement parks in_progress→review, then review→done when VERIFIER-authored review evidence arrives", async () => {
    await mkAgent("verifier-c8", "verifier");
    await mkAgent("eng-c8", "engineer");
    const reqs: EvidenceRequirement[] = [{ id: "code", kind: "commit" }, { id: "rev", kind: "review" }];
    const { id, token } = await started(reqs, "agent-c8");
    // first complete: code covered, review unmet → parks in review (no fail).
    const parked = await repo.completeWork(id, "agent-c8", token, [ev({ requirementId: "code", kind: "commit", ref: "abc" })]);
    expect(parked!.status).toBe("review");
    // a SELF-authored (non-verifier) review evidence → rejected (audit-4103 #2)
    await expect(repo.completeWork(id, "agent-c8", token, [ev({ requirementId: "rev", kind: "review", ref: "note", producedBy: "eng-c8" })]))
      .rejects.toThrow(/is not a verifier/);
    expect((await repo.getWorkItem(id))!.status).toBe("review"); // unchanged — still parked
    // a verifier genuinely looked → review→done (no passing verdict required, just provenance).
    const done = await repo.completeWork(id, "agent-c8", token, [ev({ requirementId: "rev", kind: "review", ref: "verdict-note", producedBy: "verifier-c8" })]);
    expect(done!.status).toBe("done");
  }, OP_TIMEOUT);

  it("complete from claimed (not started) → TransitionRejected", async () => {
    const w = await repo.createWorkItem({ type: "task", roleEligibility: [] });
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

  // ── work-88 (arc-node): the complete_work COMPLETION-gate ───────────────────────
  // An arc/umbrella node (completionDependsOn non-empty) is claimable immediately
  // (dependsOn:[]) but completable only once EVERY downstream child is `done`. GATE
  // ONLY — the arc-holder still submits the close-out; never an auto-complete.
  describe("completionDependsOn gate (arc-node)", () => {
    /** create → claim → start → complete-to-done a leaf child; returns its id. */
    async function doneChild(agent: string): Promise<string> {
      const w = await repo.createWorkItem({ type: "task", roleEligibility: [] });
      const c = await repo.claimWorkItem(w.id, agent);
      await repo.startWork(w.id, agent, c!.lease!.token);
      await repo.completeWork(w.id, agent, c!.lease!.token, [ev({ requirementId: "x", kind: "freeform" })]);
      return w.id;
    }
    /** create an arc (completionDependsOn) → claim → start; returns id + token. */
    async function startedArc(completionDependsOn: string[], agent: string) {
      const w = await repo.createWorkItem({ type: "task", roleEligibility: [], completionDependsOn });
      const c = await repo.claimWorkItem(w.id, agent);
      await repo.startWork(w.id, agent, c!.lease!.token);
      return { id: w.id, token: c!.lease!.token };
    }

    it("unmet gate: a not-yet-done child → CompletionGateRejected (0/1); row unchanged (atomic)", async () => {
      const notDone = (await repo.createWorkItem({ type: "task", roleEligibility: [] })).id;
      const arc = await startedArc([notDone], "agent-arc-a");
      let caught: unknown;
      try { await repo.completeWork(arc.id, "agent-arc-a", arc.token, [ev({ requirementId: "x", kind: "freeform" })]); }
      catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CompletionGateRejected);
      expect(caught).toMatchObject({ done: 0, total: 1, pending: [notDone] });
      // atomic: the arc is still in_progress with NO evidence stored.
      const after = await repo.getWorkItem(arc.id);
      expect(after!.status).toBe("in_progress");
      expect(after!.evidence).toEqual([]);
    }, OP_TIMEOUT);

    it("partial k/N: 2 children, 1 done → reject carrying done=1/total=2 + the pending child", async () => {
      const done1 = await doneChild("agent-arc-b1");
      const notDone = (await repo.createWorkItem({ type: "task", roleEligibility: [] })).id;
      const arc = await startedArc([done1, notDone], "agent-arc-b2");
      let caught: unknown;
      try { await repo.completeWork(arc.id, "agent-arc-b2", arc.token, [ev({ requirementId: "x", kind: "freeform" })]); }
      catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CompletionGateRejected);
      expect(caught).toMatchObject({ done: 1, total: 2, pending: [notDone] });
    }, OP_TIMEOUT);

    it("gate met: ALL children done → the arc completes (the gate opens; holder completes, never auto)", async () => {
      const c1 = await doneChild("agent-arc-c1");
      const c2 = await doneChild("agent-arc-c2");
      const arc = await startedArc([c1, c2], "agent-arc-c3");
      const done = await repo.completeWork(arc.id, "agent-arc-c3", arc.token, [ev({ requirementId: "x", kind: "freeform" })]);
      expect(done!.status).toBe("done");
    }, OP_TIMEOUT);

    it("ordering (F6): an unmet gate rejects BEFORE the evidence predicate — pass NO evidence, error is the GATE", async () => {
      const notDone = (await repo.createWorkItem({ type: "task", roleEligibility: [] })).id;
      const w = await repo.createWorkItem({ type: "task", roleEligibility: [], completionDependsOn: [notDone], evidenceRequirements: [{ id: "r1", kind: "commit" }] });
      const c = await repo.claimWorkItem(w.id, "agent-arc-d");
      await repo.startWork(w.id, "agent-arc-d", c!.lease!.token);
      // Both the gate AND the (unsatisfied) evidence predicate would fail — assert it's the GATE.
      await expect(repo.completeWork(w.id, "agent-arc-d", c!.lease!.token, []))
        .rejects.toThrow(/completion gate.*0\/1 downstream done/);
    }, OP_TIMEOUT);

    it("fail-closed: a VANISHED (never-existent) child blocks — it can never reach done", async () => {
      const arc = await startedArc(["work-ghost-99999"], "agent-arc-e");
      await expect(repo.completeWork(arc.id, "agent-arc-e", arc.token, [ev({ requirementId: "x", kind: "freeform" })]))
        .rejects.toThrow(/completion gate.*work-ghost-99999/);
    }, OP_TIMEOUT);

    it("fail-closed: an ABANDONED child blocks (abandoned ≠ done — an arc must not close over unfinished work)", async () => {
      const w = await repo.createWorkItem({ type: "task", roleEligibility: [] });
      const c = await repo.claimWorkItem(w.id, "agent-arc-f");
      await repo.abandonWork(w.id, "agent-arc-f", { leaseToken: c!.lease!.token });
      expect((await repo.getWorkItem(w.id))!.status).toBe("abandoned");
      const arc = await startedArc([w.id], "agent-arc-f2");
      await expect(repo.completeWork(arc.id, "agent-arc-f2", arc.token, [ev({ requirementId: "x", kind: "freeform" })]))
        .rejects.toThrow(/completion gate/);
    }, OP_TIMEOUT);

    it("leaf regression: an empty completionDependsOn node is unaffected — the gate is a no-op", async () => {
      const arc = await startedArc([], "agent-arc-g");
      const done = await repo.completeWork(arc.id, "agent-arc-g", arc.token, [ev({ requirementId: "x", kind: "freeform" })]);
      expect(done!.status).toBe("done");
    }, OP_TIMEOUT);

    // ── the k/N progress PROJECTION (get_work feed; the same per-child read the gate uses) ──
    it("getCompletionProgress: a half-done arc → {done:1,total:2,pending:[notDone]}", async () => {
      const done1 = await doneChild("agent-prog-a1");
      const notDone = (await repo.createWorkItem({ type: "task", roleEligibility: [] })).id;
      const arc = await repo.createWorkItem({ type: "task", roleEligibility: [], completionDependsOn: [done1, notDone] });
      expect(await repo.getCompletionProgress(arc.id)).toEqual({ done: 1, total: 2, pending: [notDone] });
    }, OP_TIMEOUT);

    it("getCompletionProgress: all children done → {done:2,total:2,pending:[]}", async () => {
      const c1 = await doneChild("agent-prog-b1");
      const c2 = await doneChild("agent-prog-b2");
      const arc = await repo.createWorkItem({ type: "task", roleEligibility: [], completionDependsOn: [c1, c2] });
      expect(await repo.getCompletionProgress(arc.id)).toEqual({ done: 2, total: 2, pending: [] });
    }, OP_TIMEOUT);

    it("getCompletionProgress: a leaf (no completionDependsOn) → {done:0,total:0,pending:[]}", async () => {
      const leaf = await repo.createWorkItem({ type: "task", roleEligibility: [] });
      expect(await repo.getCompletionProgress(leaf.id)).toEqual({ done: 0, total: 0, pending: [] });
    }, OP_TIMEOUT);

    it("getCompletionProgress: a non-existent work-item → null", async () => {
      expect(await repo.getCompletionProgress("work-ghost-00000")).toBeNull();
    }, OP_TIMEOUT);
  });
});
