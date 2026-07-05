/**
 * mission-102 P3-B4 — Director proof-path tests (real-pg).
 *
 * Covers the proof objects (Hub-side hashing, mint/consume mechanics, expiry,
 * exact-binding) and CONTRACT TEST 7 (G2-BINDING) through the real
 * DecisionRepositorySubstrate + DirectorProofGate:
 *   proxy-without-proof · assertion-ref · double-consume ·
 *   irreversible-sans-confirmation — ALL REJECT, plus the two happy paths
 *   (Signal → director-via-proxy; hash-bound Confirmation → director-direct)
 *   and the B3 grant fence.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestPool } from "../../storage-substrate/__tests__/_pg-test-pool.js";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createHash } from "node:crypto";
import { createPostgresStorageSubstrate, createSchemaReconciler, ALL_SCHEMAS, buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { DecisionRepositorySubstrate, DecisionTransitionRejected } from "../decision-repository-substrate.js";
import {
  DirectorProofRepositorySubstrate,
  DirectorProofGate,
  canonicalPromptHash,
  hashProposedResolution,
  hashExecutionPlan,
  planRequiresConfirmation,
} from "../director-proof-repository-substrate.js";
import type { DecisionActor, DecisionPlanAction } from "../decision.js";

const SETUP_TIMEOUT = 90_000;
const OP_TIMEOUT = 120_000;
const MIGRATIONS_DIR = join(__dirname, "..", "..", "storage-substrate", "migrations");
const MIGRATION_FILES = ["001-entities-table.sql", "002-notify-trigger.sql", "003-jsonb-size-check.sql"];

const DIRECTOR: DecisionActor = { agentId: "agent-director-msg", role: "director", sessionId: "sess-d1" };
const ARCHITECT: DecisionActor = { agentId: "agent-arch", role: "architect", sessionId: "sess-a1" };

describe("Director proof path (real-pg: signals / confirmations / the gate)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let substrate: ReturnType<typeof createPostgresStorageSubstrate>;
  let reconciler: ReturnType<typeof createSchemaReconciler>;
  let decisions: DecisionRepositorySubstrate;
  let proofs: DirectorProofRepositorySubstrate;
  let gate: DirectorProofGate;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub").start();
    const connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    pool = createTestPool(connStr, "director-proof-substrate");
    for (const f of MIGRATION_FILES) await pool.query(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));
    substrate = createPostgresStorageSubstrate(connStr);
    reconciler = createSchemaReconciler(substrate, connStr, { initialSchemas: ALL_SCHEMAS });
    await reconciler.start();
    substrate.setFieldTranslator((kind, key) => reconciler.getFieldTranslation(kind, key));
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    const counter = new SubstrateCounter(substrate);
    decisions = new DecisionRepositorySubstrate(substrate, counter);
    proofs = new DirectorProofRepositorySubstrate(substrate, counter);
    gate = new DirectorProofGate(proofs);
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    if (reconciler) await reconciler.close();
    if (substrate) await substrate.close();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, OP_TIMEOUT);

  /** raise→curate→route a decision to `routed` (director target). */
  async function routed(plan?: DecisionPlanAction[]) {
    const d = await decisions.raiseDecision({
      title: "proof-path decision",
      context: "ctx",
      options: [{ id: "a", label: "A", description: "a" }, { id: "b", label: "B", description: "b" }],
      raisedBy: ARCHITECT,
    });
    await decisions.curateDecision(d.id, ARCHITECT);
    return (await decisions.routeDecision(d.id, ARCHITECT, { target: "director" }, plan))!;
  }

  const mintSignal = () => proofs.mintSignal({
    channel: "ois-say", answer: "approved — option a", capturedBySurface: "cli",
    confidence: "session-bound", replyable: true, capturedBy: DIRECTOR,
  });

  it("mintSignal: Hub-side sha256 content hash + immutable capture fields", async () => {
    const s = await mintSignal();
    expect(s.id).toMatch(/^dsig-\d+$/);
    expect(s.rawContentHash).toBe(createHash("sha256").update("approved — option a", "utf8").digest("hex"));
    expect(s.capturedBy).toEqual(DIRECTOR);
    expect(s.confidence).toBe("session-bound"); // stored as enum; NO tier logic in v1
  }, OP_TIMEOUT);

  it("confirmation mint/consume mechanics: happy consume; double-consume REJECTS; expired REJECTS; hash/decision mismatch REJECTS", async () => {
    const d = await routed();
    const answer = { chosenOptionId: "a" as const };
    const mint = () => proofs.mintConfirmation({
      decisionId: d.id,
      promptHash: canonicalPromptHash(d),
      proposedResolutionHash: hashProposedResolution(answer),
      executionPlanHash: hashExecutionPlan(d.executionPlan),
      ttlMs: 60_000,
    });
    const expect1 = {
      decisionId: d.id, promptHash: canonicalPromptHash(d),
      proposedResolutionHash: hashProposedResolution(answer),
      executionPlanHash: hashExecutionPlan(d.executionPlan), consumedBy: "agent-arch",
    };
    const c1 = await mint();
    expect(c1.nonce).toMatch(/[0-9a-f-]{36}/);
    const consumed = await proofs.consumeConfirmation(c1.id, expect1);
    expect(consumed.consumedAt).not.toBeNull();
    expect(consumed.consumedBy).toBe("agent-arch");
    // double-consume
    await expect(proofs.consumeConfirmation(c1.id, expect1)).rejects.toThrow(/already consumed/);
    // expired
    const cExp = await proofs.mintConfirmation({ ...expect1, promptHash: canonicalPromptHash(d), proposedResolutionHash: hashProposedResolution(answer), executionPlanHash: null, decisionId: d.id, ttlMs: -1 });
    await expect(proofs.consumeConfirmation(cExp.id, { ...expect1, executionPlanHash: null })).rejects.toThrow(/expired/);
    // decision mismatch
    const c2 = await mint();
    await expect(proofs.consumeConfirmation(c2.id, { ...expect1, decisionId: "decision-other" })).rejects.toThrow(/bound to/);
    // hash mismatch (different proposed answer)
    await expect(proofs.consumeConfirmation(c2.id, { ...expect1, proposedResolutionHash: hashProposedResolution({ customAnswer: "swapped" }) })).rejects.toThrow(/hash mismatch/);
  }, OP_TIMEOUT);

  // ── CONTRACT TEST 7 (G2-BINDING): all four rejection paths + happy paths ─────
  it("contract #7a proxy-without-proof: resolve with NO proofRef → REJECT (assertion is not proof)", async () => {
    const d = await routed();
    await expect(decisions.resolveDecision(d.id, ARCHITECT, { chosenOptionId: "a" }, gate))
      .rejects.toThrow(/no proof ref supplied/);
    expect((await decisions.getDecision(d.id))!.status).toBe("routed");
  }, OP_TIMEOUT);

  it("contract #7b assertion-ref: an audit/message/doc ref is NOT proof → REJECT; grant refs fence to B3", async () => {
    const d = await routed();
    for (const ref of ["audit-9999", "01KWMESSAGE", "docs/x.md"]) {
      await expect(decisions.resolveDecision(d.id, ARCHITECT, { chosenOptionId: "a" }, gate, { claimedAuthorityRef: ref }))
        .rejects.toThrow(/not a proof object/);
    }
    // B3 wired the real grant path into the gate: a DANGLING grant ref now rejects
    // on resolution (the evaluator's own rejections are pinned in the B3 suite);
    // this gate instance has no grants store → the fail-closed not-wired fence.
    await expect(decisions.resolveDecision(d.id, ARCHITECT, { chosenOptionId: "a" }, gate, { claimedAuthorityRef: "grant-99999" }))
      .rejects.toThrow(/not wired in this context|does not resolve/);
    // dangling proof-shaped refs also reject
    await expect(decisions.resolveDecision(d.id, ARCHITECT, { chosenOptionId: "a" }, gate, { claimedAuthorityRef: "dsig-99999" }))
      .rejects.toThrow(/does not resolve/);
  }, OP_TIMEOUT);

  /** Bind a Director-origin answer to a confirmation (the capture-with-confirmationId path). */
  const answerConfirmation = (confirmationId: string) => proofs.mintSignal({
    channel: "ois-say", answer: "confirmed", capturedBySurface: "cli",
    confidence: "session-bound", replyable: true, capturedBy: DIRECTOR, confirmationId,
  });

  it("contract #7e SELF-ISSUED-TOKEN exploit (audit-9821 regression): an architect-minted confirmation with NO Director-origin answer is NOT proof → REJECT", async () => {
    const d = await routed();
    const answer = { chosenOptionId: "a" as const };
    // the exact exploit from the PR #486 review: mint + immediately resolve, no Director anywhere.
    const c = await proofs.mintConfirmation({
      decisionId: d.id, promptHash: canonicalPromptHash(d),
      proposedResolutionHash: hashProposedResolution(answer),
      executionPlanHash: hashExecutionPlan(d.executionPlan), ttlMs: 60_000,
    });
    await expect(decisions.resolveDecision(d.id, ARCHITECT, answer, gate, { claimedAuthorityRef: c.id }))
      .rejects.toThrow(/has not been answered by a Director-origin capture/);
    expect((await decisions.getDecision(d.id))!.status).toBe("routed");
    // first answer wins: a second capture cannot re-point an answered confirmation.
    await answerConfirmation(c.id);
    await expect(answerConfirmation(c.id)).rejects.toThrow(/already answered/);
  }, OP_TIMEOUT);

  it("contract #7c double-consume: an already-consumed (Director-answered) confirmation cannot authorize a resolve → REJECT", async () => {
    const d = await routed();
    const answer = { chosenOptionId: "b" as const };
    const c = await proofs.mintConfirmation({
      decisionId: d.id, promptHash: canonicalPromptHash(d),
      proposedResolutionHash: hashProposedResolution(answer),
      executionPlanHash: hashExecutionPlan(d.executionPlan), ttlMs: 60_000,
    });
    await answerConfirmation(c.id);
    await proofs.consumeConfirmation(c.id, {
      decisionId: d.id, promptHash: canonicalPromptHash(d),
      proposedResolutionHash: hashProposedResolution(answer),
      executionPlanHash: hashExecutionPlan(d.executionPlan), consumedBy: "elsewhere",
    });
    await expect(decisions.resolveDecision(d.id, ARCHITECT, answer, gate, { claimedAuthorityRef: c.id }))
      .rejects.toThrow(/already consumed/);
    expect((await decisions.getDecision(d.id))!.status).toBe("routed");
  }, OP_TIMEOUT);

  it("contract #7d irreversible-sans-confirmation: a plan with an action outside the v1 reversible registry does NOT flow on Signal proof → REJECT (fail-closed)", async () => {
    // Simulate a future/unknown action reaching the plan (the zod boundary blocks it
    // at route today; the gate must STILL fail closed — defense in depth).
    const irreversible = [{ action: "retire" as unknown as DecisionPlanAction["action"], targetRef: "work-1" }];
    expect(planRequiresConfirmation(irreversible)).toBe(true);
    expect(planRequiresConfirmation([{ action: "unblock", targetRef: "w" }, { action: "approve", targetRef: "p" }])).toBe(false);
    const d = await routed(irreversible);
    const s = await mintSignal();
    await expect(decisions.resolveDecision(d.id, ARCHITECT, { chosenOptionId: "a" }, gate, { claimedAuthorityRef: s.id }))
      .rejects.toThrow(/requires a consumed DirectorConfirmation/);
  }, OP_TIMEOUT);

  it("happy path: Signal proof → resolved with Hub-derived director-via-proxy + authorityRef", async () => {
    const d = await routed([{ action: "unblock", targetRef: "work-1" }]);
    const s = await mintSignal();
    const resolved = (await decisions.resolveDecision(d.id, ARCHITECT, { chosenOptionId: "a" }, gate, { claimedAuthorityRef: s.id, rationale: "per Director signal" }))!;
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolution!.authorityMode).toBe("director-via-proxy");
    expect(resolved.resolution!.authorityRef).toBe(s.id);
    expect(resolved.resolution!.executor).toEqual(ARCHITECT); // dual identity: authority ≠ executor
  }, OP_TIMEOUT);

  it("happy path: Director-ANSWERED hash-bound Confirmation → director-direct; a MUTATED answer diverges the hash → REJECT (exact-binding)", async () => {
    const d = await routed();
    const confirmedAnswer = { chosenOptionId: "a" as const };
    const c = await proofs.mintConfirmation({
      decisionId: d.id, promptHash: canonicalPromptHash(d),
      proposedResolutionHash: hashProposedResolution(confirmedAnswer),
      executionPlanHash: hashExecutionPlan(d.executionPlan), ttlMs: 60_000,
    });
    await answerConfirmation(c.id); // the Director's capture makes the token proof
    // resolver swaps the answer after confirmation → hash mismatch → reject
    await expect(decisions.resolveDecision(d.id, ARCHITECT, { customAnswer: "something else" }, gate, { claimedAuthorityRef: c.id }))
      .rejects.toThrow(/hash mismatch/);
    // the exact confirmed answer flows as director-direct
    const resolved = (await decisions.resolveDecision(d.id, ARCHITECT, confirmedAnswer, gate, { claimedAuthorityRef: c.id }))!;
    expect(resolved.resolution!.authorityMode).toBe("director-direct");
    expect(resolved.resolution!.authorityRef).toBe(c.id);
  }, OP_TIMEOUT);
});
