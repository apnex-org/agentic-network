/**
 * mission-102 P3-B3 — ClassGrant tests (real-pg): mint/revoke/supersede
 * mechanics, the pure evaluator, and the two G2-BINDING contract tests this
 * slice owns, exercised through the REAL DecisionRepositorySubstrate +
 * DirectorProofGate grant path:
 *   #1 class-spoof — a decision whose class the grant does not cover REJECTS
 *      (classification is never authority);
 *   #3 grant-drift — a revoked grant authorizes nothing new; historical
 *      resolutions retain the exact id@version they rode.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestPool } from "../../storage-substrate/__tests__/_pg-test-pool.js";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createPostgresStorageSubstrate, createSchemaReconciler, ALL_SCHEMAS, buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { DecisionRepositorySubstrate } from "../decision-repository-substrate.js";
import { DirectorProofRepositorySubstrate, DirectorProofGate } from "../director-proof-repository-substrate.js";
import { ClassGrantRepositorySubstrate, evaluateGrant, GRANT_REVERSIBLE_ACTIONS } from "../class-grant-repository-substrate.js";
import type { DecisionActor, DecisionPlanAction } from "../decision.js";

const SETUP_TIMEOUT = 90_000;
const OP_TIMEOUT = 120_000;
const MIGRATIONS_DIR = join(__dirname, "..", "..", "storage-substrate", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];

const ARCHITECT: DecisionActor = { agentId: "agent-arch", role: "architect", sessionId: "sess-a1" };

describe("ClassGrant (real-pg: mint / revoke / evaluate / the gate's grant path)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let substrate: ReturnType<typeof createPostgresStorageSubstrate>;
  let reconciler: ReturnType<typeof createSchemaReconciler>;
  let decisions: DecisionRepositorySubstrate;
  let grants: ClassGrantRepositorySubstrate;
  let gate: DirectorProofGate;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    const connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = createTestPool(connStr, "class-grant-substrate");
    for (const f of MIGRATION_FILES) await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    substrate = createPostgresStorageSubstrate(connStr);
    reconciler = createSchemaReconciler(substrate, connStr, { initialSchemas: ALL_SCHEMAS });
    await reconciler.start();
    substrate.setFieldTranslator((kind, key) => reconciler.getFieldTranslation(kind, key));
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    const counter = new SubstrateCounter(substrate);
    decisions = new DecisionRepositorySubstrate(substrate, counter);
    grants = new ClassGrantRepositorySubstrate(substrate, counter);
    gate = new DirectorProofGate(new DirectorProofRepositorySubstrate(substrate, counter), grants);
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    if (reconciler) await reconciler.close();
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, OP_TIMEOUT);

  let ratifySeq = 0;
  const RATIFIED_AT = "2026-07-05T04:00:00.000Z";
  const mintApprovalUnblock = (over: Partial<Parameters<typeof grants.mintGrant>[0]> = {}) =>
    grants.mintGrant({
      class: "approval-unblock",
      allowedActions: ["unblock", "approve"],
      reversibleOnly: true,
      excludedClasses: ["scope-change", "deprecation", "preference-probe"],
      ratificationRef: `decision-ratify-${++ratifySeq}`, // single-use: each mint needs a fresh ratification
      representationDays: 90,
      ...over,
    }, { resolved: true, resolvedAt: RATIFIED_AT });

  async function routedDecision(cls: string | null, plan?: DecisionPlanAction[], citeGrant?: string) {
    const d = await decisions.raiseDecision({
      title: "grant-path decision", context: "ctx", class: cls,
      options: [{ id: "a", label: "A", description: "a" }],
      raisedBy: ARCHITECT,
    });
    await decisions.curateDecision(d.id, ARCHITECT);
    const route = citeGrant
      ? { target: "self-disposal" as const, selfDisposal: { classGrantRef: citeGrant } }
      : { target: "director" as const };
    return (await decisions.routeDecision(d.id, ARCHITECT, route, plan))!;
  }

  it("mint mechanics: ratification fail-closed; reversibleOnly self-contradiction rejects; version chain via supersede", async () => {
    await expect(grants.mintGrant({ class: "x", allowedActions: ["unblock"], reversibleOnly: true, ratificationRef: "decision-ghost", representationDays: 90 }, { resolved: false, resolvedAt: null }))
      .rejects.toThrow(/does not resolve to a resolved\/executed Decision/);
    const g1 = await mintApprovalUnblock();
    expect(g1.version).toBe(1);
    expect(g1.state).toBe("active");
    expect(g1.issuer).toBe("director");
    const g2 = await mintApprovalUnblock({ supersedes: g1.id });
    expect(g2.version).toBe(2);
    const g1After = (await grants.getGrant(g1.id))!;
    expect(g1After.state).toBe("superseded");
    expect(g1After.supersededBy).toBe(g2.id);
    // constraint content of the superseded row is UNTOUCHED (row-per-version immutability)
    expect(g1After.allowedActions).toEqual(["unblock", "approve"]);
  }, OP_TIMEOUT);

  it("audit-9886 regressions: ratification is SINGLE-USE (replay rejects) and representationDue anchors to the RATIFICATION instant, not mint time", async () => {
    const g = await mintApprovalUnblock({ ratificationRef: "decision-ratify-once" });
    // replay: same ratification cannot mint a second row (same or different fields)
    await expect(mintApprovalUnblock({ ratificationRef: "decision-ratify-once" }))
      .rejects.toThrow(/already consumed by/);
    // anchored due: minted NOW but ratified at RATIFIED_AT → due = RATIFIED_AT + 90d,
    // NOT now + 90d (a delayed mint does not extend the window).
    expect(g.representationDue).toBe(new Date(Date.parse(RATIFIED_AT) + 90 * 24 * 3600_000).toISOString());
  }, OP_TIMEOUT);

  it("evaluator field checks: past-due re-presentation, parent-kind allowlist, excluded refs, action allowlist — all loud", async () => {
    const g = await mintApprovalUnblock({ parentKinds: ["mission"], excludedRefs: ["work-forbidden"] });
    const base = await routedDecision("approval-unblock", [{ action: "unblock", targetRef: "work-9" }]);
    // parentKinds: decision has no parentRef → reject
    expect(() => evaluateGrant(g, base, new Date().toISOString())).toThrow(/parent kinds/);
    const withParent = { ...base, parentRef: { kind: "mission", id: "mission-1" } };
    expect(() => evaluateGrant(g, withParent, new Date().toISOString())).not.toThrow();
    // excludedRefs: plan touching the forbidden row → reject
    expect(() => evaluateGrant(g, { ...withParent, executionPlan: [{ action: "unblock", targetRef: "work-forbidden" }] }, new Date().toISOString()))
      .toThrow(/forbidden boundary row/);
    // past-due re-presentation → reject (pure-evaluator check: construct the row
    // directly — mint can only produce future dates by construction)
    const overdue = { ...g, representationDue: new Date(Date.now() - 1000).toISOString() };
    expect(() => evaluateGrant(overdue, withParent, new Date().toISOString())).toThrow(/re-presentation due date/);
    // reversibility constant agrees with the proof-path registry (cross-layer pin)
    expect([...GRANT_REVERSIBLE_ACTIONS].sort()).toEqual(["approve", "unblock"]);
  }, OP_TIMEOUT);

  // ── CONTRACT TEST 1 (G2-BINDING): class-spoof ────────────────────────────────
  it("contract #1: a decision OUTSIDE the grant's class rejects — exact-match, excluded-class belt, and unclassified all fail closed", async () => {
    const g = await mintApprovalUnblock();
    // the verifier's lean-laundering scenario: a scope-change routed under the
    // grant's citation still cannot ride — class exact-match fails at the evaluator.
    const spoofed = await routedDecision("scope-change", [{ action: "approve", targetRef: "prop-1" }], g.id);
    await expect(decisions.resolveDecision(spoofed.id, ARCHITECT, { chosenOptionId: "a" }, gate, { claimedAuthorityRef: g.id }))
      .rejects.toThrow(/covers class 'approval-unblock', not 'scope-change'/);
    // route↔proof tie (audit-9886 finding 2): a DIRECTOR-routed decision cannot be
    // resolved under a grant at all — grant authority exists only on the cited
    // self-disposal path (the mismatch regression).
    const directorRouted = await routedDecision("approval-unblock", [{ action: "unblock", targetRef: "work-1" }]);
    await expect(decisions.resolveDecision(directorRouted.id, ARCHITECT, { chosenOptionId: "a" }, gate, { claimedAuthorityRef: g.id }))
      .rejects.toThrow(/self-disposal citing this grant/);
    // …and citing grant A while proving with grant B also rejects.
    const g2 = await mintApprovalUnblock();
    const citedOther = await routedDecision("approval-unblock", [{ action: "unblock", targetRef: "work-3" }], g2.id);
    await expect(decisions.resolveDecision(citedOther.id, ARCHITECT, { chosenOptionId: "a" }, gate, { claimedAuthorityRef: g.id }))
      .rejects.toThrow(/self-disposal citing this grant/);
    // …a re-classed decision is caught by exact-match at the evaluator level:
    const excluded = { ...(await routedDecision("approval-unblock", undefined, g.id)), class: "scope-change" };
    expect(() => evaluateGrant(g, excluded, new Date().toISOString())).toThrow(/not 'scope-change'/);
    // unclassified NEVER self-disposes: the route itself fails closed to the director.
    const u = await decisions.raiseDecision({ title: "u", context: "c", options: [], raisedBy: ARCHITECT });
    await decisions.curateDecision(u.id, ARCHITECT);
    await expect(decisions.routeDecision(u.id, ARCHITECT, { target: "self-disposal", selfDisposal: { classGrantRef: g.id } }))
      .rejects.toThrow(/unclassified decision fails closed to the director/);
  }, OP_TIMEOUT);

  // ── CONTRACT TEST 3 (G2-BINDING): grant-drift ────────────────────────────────
  it("contract #3: a REVOKED grant authorizes nothing new; a prior resolution retains its exact id@version; revoked rows keep full content", async () => {
    const g = await mintApprovalUnblock();
    const d1 = await routedDecision("approval-unblock", [{ action: "unblock", targetRef: "work-1" }], g.id);
    const resolved = (await decisions.resolveDecision(d1.id, ARCHITECT, { chosenOptionId: "a" }, gate, { claimedAuthorityRef: g.id }))!;
    expect(resolved.resolution!.authorityMode).toBe("class-grant");
    expect(resolved.resolution!.authorityRef).toBe(`${g.id}@v1`);
    // revoke
    const revoked = (await grants.revokeGrant(g.id, "Director pulled the delegation"))!;
    expect(revoked.state).toBe("revoked");
    await expect(grants.revokeGrant(g.id, "again")).rejects.toThrow(/not active/);
    // nothing NEW flows
    const d2 = await routedDecision("approval-unblock", [{ action: "unblock", targetRef: "work-2" }], g.id);
    await expect(decisions.resolveDecision(d2.id, ARCHITECT, { chosenOptionId: "a" }, gate, { claimedAuthorityRef: g.id }))
      .rejects.toThrow(/is revoked/);
    // history intact: the prior resolution still names id@v1 and the revoked row's
    // constraint content is fully readable (never deleted, never mutated).
    expect((await decisions.getDecision(d1.id))!.resolution!.authorityRef).toBe(`${g.id}@v1`);
    const historical = (await grants.getGrant(g.id))!;
    expect(historical.allowedActions).toEqual(["unblock", "approve"]);
    expect(historical.class).toBe("approval-unblock");
  }, OP_TIMEOUT);
});
