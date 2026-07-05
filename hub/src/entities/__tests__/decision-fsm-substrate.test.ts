/**
 * mission-102 P3-B1 — Decision entity FSM tests (real-pg).
 *
 * Exercises the authority spine end-to-end through the full substrate (per-row CAS +
 * envelope encode/decode): the happy walk, every exit, terminal immutability, the
 * raiser-only withdraw identity check, the B3/B4 slice fences (self-disposal +
 * fail-closed proof gate), Hub-derived authorityMode discipline, and the two
 * G2-BINDING contract tests this slice owns:
 *   #9  no-timer-transitions — nothing in the store moves state on time;
 *   #10 exit totality — every walk of the transition table ends in a ratified terminal.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestPool } from "../../storage-substrate/__tests__/_pg-test-pool.js";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createPostgresStorageSubstrate, createSchemaReconciler, ALL_SCHEMAS, buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import {
  DecisionRepositorySubstrate,
  DecisionTransitionRejected,
  FailClosedProofGate,
  DECISION_TRANSITIONS,
  DECISION_TERMINALS,
} from "../decision-repository-substrate.js";
import type { DecisionActor, DecisionPhase, IDecisionProofGate } from "../decision.js";

const SETUP_TIMEOUT = 90_000;
const OP_TIMEOUT = 120_000;
const MIGRATIONS_DIR = join(__dirname, "..", "..", "storage-substrate", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];

const RAISER: DecisionActor = { agentId: "agent-raiser", role: "engineer", sessionId: "sess-r1" };
const ARCHITECT: DecisionActor = { agentId: "agent-arch", role: "architect", sessionId: "sess-a1" };
const DIRECTOR_PROXY: DecisionActor = { agentId: "agent-arch", role: "architect", sessionId: "sess-a1" };

/** Test-injected permissive gate — exists ONLY so tests can walk the FSM past the
 *  B4 fence; production wires FailClosedProofGate. */
const directGate: IDecisionProofGate = {
  async evaluate() { return { authorityMode: "director-direct" as const }; },
};

describe("Decision FSM (real-pg: raise / curate / route / resolve / exits)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let substrate: ReturnType<typeof createPostgresStorageSubstrate>;
  let reconciler: ReturnType<typeof createSchemaReconciler>;
  let repo: DecisionRepositorySubstrate;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    const connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = createTestPool(connStr, "decision-fsm-substrate");
    for (const f of MIGRATION_FILES) await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    substrate = createPostgresStorageSubstrate(connStr);
    reconciler = createSchemaReconciler(substrate, connStr, { initialSchemas: ALL_SCHEMAS });
    await reconciler.start();
    substrate.setFieldTranslator((kind, key) => reconciler.getFieldTranslation(kind, key));
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    repo = new DecisionRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    if (reconciler) await reconciler.close();
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, OP_TIMEOUT);

  const raise = (title = "test decision") =>
    repo.raiseDecision({
      title,
      context: "ctx",
      options: [{ id: "a", label: "A", description: "option a" }, { id: "b", label: "B", description: "option b" }],
      raisedBy: RAISER,
    });

  it("happy walk: raised→curated→routed→resolved→executed with Hub-stamped actors + dwell accrual", async () => {
    const d = await raise("walk");
    expect(d.status).toBe("raised");
    expect(d.id).toMatch(/^decision-\d+$/);
    expect(d.freeAnswerPolicy).toBe("always");
    expect(d.raisedBy).toEqual(RAISER);

    const curated = (await repo.curateDecision(d.id, ARCHITECT, { class: "ratification" }))!;
    expect(curated.status).toBe("curated");
    expect(curated.curatedBy).toEqual(ARCHITECT);
    expect(curated.class).toBe("ratification");
    expect(curated.stateDurations.raised).toBeGreaterThanOrEqual(0);

    const routed = (await repo.routeDecision(d.id, ARCHITECT, { target: "director" }, [{ action: "unblock", targetRef: "work-1" }]))!;
    expect(routed.status).toBe("routed");
    expect(routed.routedTo).toEqual({ target: "director" });
    expect(routed.routedBy).toEqual(ARCHITECT);
    expect(routed.executionPlan).toEqual([{ action: "unblock", targetRef: "work-1" }]);

    const resolved = (await repo.resolveDecision(d.id, DIRECTOR_PROXY, { chosenOptionId: "a" }, directGate, { rationale: "because" }))!;
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolution!.authorityMode).toBe("director-direct");
    expect(resolved.resolution!.answer).toEqual({ chosenOptionId: "a" });
    expect(resolved.resolution!.executor).toEqual(DIRECTOR_PROXY);

    const executed = (await repo.markExecuted(d.id, DIRECTOR_PROXY))!;
    expect(executed.status).toBe("executed");
    // dwell sum-identity over the walked states: every non-terminal bucket accrued.
    for (const k of ["raised", "curated", "routed", "resolved"] as const) {
      expect(executed.stateDurations[k]).toBeGreaterThanOrEqual(0);
    }
  }, OP_TIMEOUT);

  it("B1 PRODUCTION posture: FailClosedProofGate rejects EVERY resolve (no proof machinery → no authority)", async () => {
    const d = await raise("fail-closed");
    await repo.curateDecision(d.id, ARCHITECT);
    await repo.routeDecision(d.id, ARCHITECT, { target: "director" });
    await expect(repo.resolveDecision(d.id, DIRECTOR_PROXY, { customAnswer: "x" }, FailClosedProofGate))
      .rejects.toThrow(/proof machinery is not yet available/);
    expect((await repo.getDecision(d.id))!.status).toBe("routed"); // unchanged
  }, OP_TIMEOUT);

  it("authority discipline: verifier-mandate reserved-REJECTED regardless of gate; non-direct mode without ref rejected", async () => {
    const d = await raise("modes");
    await repo.curateDecision(d.id, ARCHITECT);
    await repo.routeDecision(d.id, ARCHITECT, { target: "director" });
    const verifierGate: IDecisionProofGate = { async evaluate() { return { authorityMode: "verifier-mandate" as const, authorityRef: "audit-1" }; } };
    await expect(repo.resolveDecision(d.id, DIRECTOR_PROXY, { customAnswer: "x" }, verifierGate))
      .rejects.toThrow(/reserved and not a sanctioned v1 mode/);
    const refless: IDecisionProofGate = { async evaluate() { return { authorityMode: "class-grant" as const }; } };
    await expect(repo.resolveDecision(d.id, DIRECTOR_PROXY, { customAnswer: "x" }, refless))
      .rejects.toThrow(/requires an authorityRef/);
    expect((await repo.getDecision(d.id))!.status).toBe("routed");
  }, OP_TIMEOUT);

  it("self-disposal routing (B3 live): a route WITHOUT a citation rejects; a classified decision citing a grant routes; unclassified fails closed to the director", async () => {
    const d = await raise("sd-route");
    await repo.curateDecision(d.id, ARCHITECT, { class: "approval-unblock" });
    await expect(repo.routeDecision(d.id, ARCHITECT, { target: "self-disposal" }))
      .rejects.toThrow(/must cite its authority/);
    const routed = (await repo.routeDecision(d.id, ARCHITECT, { target: "self-disposal", selfDisposal: { classGrantRef: "grant-1" } }))!;
    expect(routed.status).toBe("routed");
    expect(routed.routedTo).toEqual({ target: "self-disposal", selfDisposal: { classGrantRef: "grant-1" } });
    const u = await raise("sd-unclassified");
    await repo.curateDecision(u.id, ARCHITECT);
    await expect(repo.routeDecision(u.id, ARCHITECT, { target: "self-disposal", selfDisposal: { classGrantRef: "grant-1" } }))
      .rejects.toThrow(/unclassified decision fails closed/);
  }, OP_TIMEOUT);

  it("exits: merge preserves lineage + target must exist + no self-merge; dispose requires a reason; withdraw is RAISER-ONLY", async () => {
    const survivor = await raise("survivor");
    const dup = await raise("duplicate");
    await expect(repo.mergeDecision(dup.id, ARCHITECT, dup.id)).rejects.toThrow(/cannot merge into itself/);
    await expect(repo.mergeDecision(dup.id, ARCHITECT, "decision-ghost")).rejects.toThrow(/does not resolve to a Decision/);
    const merged = (await repo.mergeDecision(dup.id, ARCHITECT, survivor.id))!;
    expect(merged.status).toBe("merged");
    expect(merged.mergedInto).toBe(survivor.id);

    const junk = await raise("junk");
    await expect(repo.disposeDecision(junk.id, ARCHITECT, "  ")).rejects.toThrow(/reason is required/);
    const disposed = (await repo.disposeDecision(junk.id, ARCHITECT, "duplicate of decision-1"))!;
    expect(disposed.status).toBe("disposed");
    expect(disposed.disposedReason).toBe("duplicate of decision-1");

    const mine = await raise("mine");
    await expect(repo.withdrawDecision(mine.id, ARCHITECT)).rejects.toThrow(/only the raiser/);
    const withdrawn = (await repo.withdrawDecision(mine.id, RAISER))!;
    expect(withdrawn.status).toBe("withdrawn");
  }, OP_TIMEOUT);

  it("bug-227 (C): a MISROUTED decision disposes from routed (reason-carrying, terminal); resolved does NOT gain the exit", async () => {
    const d = await raise("misroute");
    await repo.curateDecision(d.id, ARCHITECT, { class: "approval-unblock" });
    await repo.routeDecision(d.id, ARCHITECT, { target: "director" }); // the mistake
    const disposed = (await repo.disposeDecision(d.id, ARCHITECT, "misrouted to director; superseded by decision-N"))!;
    expect(disposed.status).toBe("disposed");
    expect(disposed.disposedReason).toMatch(/misrouted/);
    // resolved decisions still cannot be disposed (no laundering a made decision away)
    expect(DECISION_TRANSITIONS.resolved).toEqual(["executed"]);
  }, OP_TIMEOUT);

  it("terminal immutability: every verb rejects from a terminal state", async () => {
    const d = await raise("terminal");
    await repo.withdrawDecision(d.id, RAISER); // → withdrawn
    await expect(repo.curateDecision(d.id, ARCHITECT)).rejects.toThrow(/terminal decision is immutable/);
    await expect(repo.routeDecision(d.id, ARCHITECT, { target: "director" })).rejects.toThrow(DecisionTransitionRejected);
    await expect(repo.resolveDecision(d.id, ARCHITECT, { customAnswer: "x" }, directGate)).rejects.toThrow(DecisionTransitionRejected);
    await expect(repo.disposeDecision(d.id, ARCHITECT, "r")).rejects.toThrow(DecisionTransitionRejected);
    await expect(repo.withdrawDecision(d.id, RAISER)).rejects.toThrow(DecisionTransitionRejected);
  }, OP_TIMEOUT);

  // ── CONTRACT TEST 9 (G2-BINDING): no-timer-transitions ────────────────────────
  it("contract #9: nothing moves state on time — listAging is READ-ONLY and the store has no time-triggered write path", async () => {
    const d = await raise("ager");
    await repo.curateDecision(d.id, ARCHITECT);
    await repo.routeDecision(d.id, ARCHITECT, { target: "director" });
    // Backdate the routed dwell far past any threshold, then run the ONLY
    // time-aware surface the store exposes.
    const farFuture = new Date(Date.now() + 365 * 24 * 3600_000).toISOString();
    const aging = await repo.listAging(farFuture, 48 * 3600_000);
    expect(aging.some((x) => x.id === d.id)).toBe(true); // visible to the emit-only sweep (B6)
    // ...and the decision is UNCHANGED: same status, same revision-relevant fields.
    const after = (await repo.getDecision(d.id))!;
    expect(after.status).toBe("routed");
    expect(after.resolution).toBeNull();
    // The interface itself carries no expire/sweep/requeue member — pinned at compile
    // time by IDecisionStore; assert the runtime object agrees (no drift via subclassing).
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(repo));
    for (const name of surface) {
      expect(name).not.toMatch(/expire|sweep|requeue/i);
    }
  }, OP_TIMEOUT);

  // ── CONTRACT TEST 10 (G2-BINDING): exit totality ─────────────────────────────
  it("contract #10: every walk of the transition table terminates in a ratified terminal; terminals have no exits", async () => {
    const states = Object.keys(DECISION_TRANSITIONS) as DecisionPhase[];
    expect(states.sort()).toEqual(["curated", "disposed", "executed", "merged", "raised", "resolved", "routed", "withdrawn"].sort());
    // terminals: exactly the ratified set, all edge-free.
    for (const t of DECISION_TERMINALS) expect(DECISION_TRANSITIONS[t]).toEqual([]);
    // every state reaches a terminal (BFS over the table) and no edge targets a
    // state outside the table — the FSM is closed and total.
    for (const start of states) {
      const seen = new Set<DecisionPhase>();
      const queue: DecisionPhase[] = [start];
      let reachesTerminal = DECISION_TERMINALS.includes(start);
      while (queue.length > 0) {
        const s = queue.shift()!;
        if (seen.has(s)) continue;
        seen.add(s);
        for (const next of DECISION_TRANSITIONS[s]) {
          expect(states).toContain(next);
          if (DECISION_TERMINALS.includes(next)) reachesTerminal = true;
          queue.push(next);
        }
      }
      expect(reachesTerminal, `state '${start}' cannot reach a terminal`).toBe(true);
    }
    // `resolved` is completion-pending-execution: its ONLY forward edge is executed
    // (async plans park here with an executorBinding — B5; never a regression edge).
    expect(DECISION_TRANSITIONS.resolved).toEqual(["executed"]);
  }, OP_TIMEOUT);
});
