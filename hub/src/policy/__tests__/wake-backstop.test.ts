/**
 * work-144 (bug-231) — the arrival-snapshot BACKSTOP for lost signal-captured
 * wakes.
 *
 * The live failure (decision-14/G0, 2026-07-05 12:12Z): a Director confirm
 * coinciding with a deploy roll PERSISTED the signal (the proof survived) but
 * the notification event died with the instance — the answered→resolved leg
 * stalled and the Director experienced "I did the ratify. It did not work."
 *
 * The contract under test:
 *   - a (re)engagement (the register_role M18 identity handshake) replays any
 *     ANSWERED-but-UNCONSUMED confirmations THAT AGENT minted whose decision
 *     is still ROUTED, as agent-targeted signal-captured events marked
 *     backstop:true, payload-parity with the live wake (the presenting proxy
 *     runs the same handler either way);
 *   - resolved legs never re-surface: neither a CONSUMED confirmation nor an
 *     answered-unconsumed residual whose decision left `routed` (the
 *     crash-between-commit-and-consume residue authorizes nothing);
 *   - unanswered confirmations are not wakes (nothing to resolve yet);
 *   - an EXPIRED answered confirmation still surfaces — the Director's answer
 *     exists — with re-render guidance instead of a dead resolve pointer;
 *   - the backstop is best-effort: its failure never breaks registration.
 *
 * Real repos on the memory substrate through the router (the lost wake is
 * simulated by binding the answer REPO-DIRECT — no capture verb, no emit —
 * which is observationally identical to an emit that died mid-roll).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerSessionPolicy } from "../session-policy.js";
import { SIGNAL_CAPTURED_EVENT } from "../director-proof-policy.js";
import { createTestContext, type TestPolicyContext } from "../test-utils.js";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import { DecisionRepositorySubstrate } from "../../entities/decision-repository-substrate.js";
import {
  DirectorProofRepositorySubstrate,
  canonicalPromptHash,
  hashProposedResolution,
} from "../../entities/director-proof-repository-substrate.js";
import type { DecisionActor, IDecisionProofGate } from "../../entities/decision.js";

const RAISER: DecisionActor = { agentId: "agent-arch", role: "architect", sessionId: "s-a" };
const META = {
  clientName: "test", clientVersion: "1", proxyName: "t", proxyVersion: "1",
  transport: "test", hostname: "test-host", platform: "linux", pid: 1,
  sdkVersion: "t", sdkCommitSha: "t", proxyCommitSha: "t", sdkDirty: false, proxyDirty: false,
};

function body(r: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(r.content[0].text);
}

describe("arrival wake backstop (work-144 / bug-231: the roll-durable answered→resolved leg)", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;
  let decisions: DecisionRepositorySubstrate;
  let proofs: DirectorProofRepositorySubstrate;
  let minterId: string;

  beforeEach(async () => {
    const substrate = createMemoryStorageSubstrate();
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    const counter = new SubstrateCounter(substrate);
    decisions = new DecisionRepositorySubstrate(substrate, counter);
    proofs = new DirectorProofRepositorySubstrate(substrate, counter);
    router = new PolicyRouter();
    registerSessionPolicy(router);
    ctx = createTestContext({ role: "architect" });
    ctx.stores.decision = decisions;
    ctx.stores.directorProof = proofs;
    // The FIRST engagement: the presenting proxy identity the wakes target.
    const reg = body(await register()) as { agent: { id: string } };
    minterId = reg.agent.id;
  });

  function register(): ReturnType<PolicyRouter["handle"]> {
    return router.handle("register_role", { role: "architect", name: "presenter", clientMetadata: META }, ctx);
  }

  async function routedDecision(title: string): Promise<string> {
    const d = await decisions.raiseDecision({
      title, context: "c", class: "approval",
      options: [{ id: "yes", label: "Yes", description: "y" }], raisedBy: RAISER,
    });
    await decisions.curateDecision(d.id, RAISER);
    await decisions.routeDecision(d.id, RAISER, { target: "director" });
    return d.id;
  }

  /** Mint a confirmation AS the registered presenter, then bind a Director
   *  answer REPO-DIRECT — the persisted state of a wake whose emit died. */
  async function strandedConfirmation(decisionId: string, opts: { ttlMs?: number } = {}) {
    const decision = (await decisions.getDecision(decisionId))!;
    const conf = await proofs.mintConfirmation({
      decisionId,
      promptHash: canonicalPromptHash(decision),
      proposedResolutionHash: hashProposedResolution({ chosenOptionId: "yes" }),
      proposedAnswer: { chosenOptionId: "yes" },
      executionPlanHash: null,
      ttlMs: opts.ttlMs ?? 60_000,
      mintedBy: { agentId: minterId, role: "architect" },
    });
    const signal = await proofs.mintSignal({
      channel: "ois-say", answer: "yes", capturedBySurface: "ois-cli",
      confidence: "authenticated", replyable: true, confirmationId: conf.id,
      capturedBy: { agentId: "agent-director", role: "director" },
    });
    return { conf, signal };
  }

  async function backstopEvents() {
    const msgs = await ctx.stores.message.listMessages({});
    return msgs.filter((m) => {
      const p = m.payload as Record<string, unknown>;
      return p?.notificationEvent === SIGNAL_CAPTURED_EVENT && p?.backstop === true;
    });
  }

  it("THE BUG-231 REPLAY: an answered-unresolved confirmation surfaces at re-engagement — agent-targeted, payload-parity with the live wake, resolve pointer intact", async () => {
    const id = await routedDecision("the lost ratify");
    const { conf, signal } = await strandedConfirmation(id);
    const r = await register(); // the re-engagement (the proxy reconnects after the roll)
    expect(r.isError).toBeFalsy();
    expect((body(r) as { recoveredWakes?: number }).recoveredWakes).toBe(1);
    const events = await backstopEvents();
    expect(events).toHaveLength(1);
    expect(events[0].target).toEqual({ agentId: minterId }); // the re-engaging minter only — never broadcast
    const p = events[0].payload as Record<string, unknown>;
    // Payload parity: the same fields the live wake carries (the proxy runs one handler).
    expect(p.signal_id).toBe(signal.id);
    expect(p.confirmation_id).toBe(conf.id);
    expect(p.decision_id).toBe(id);
    expect(p.answer).toBe("yes");
    expect(String(p.body)).toContain(`resolve_as_director proofRef=${conf.id}`);
  });

  it("resolved legs do NOT re-surface: a CONSUMED confirmation is silent at the next engagement (no duplicate wake after resolve)", async () => {
    const id = await routedDecision("already resolved");
    const { conf } = await strandedConfirmation(id);
    await proofs.consumeConfirmation(conf.id, {
      decisionId: id,
      promptHash: conf.promptHash,
      proposedResolutionHash: conf.proposedResolutionHash,
      executionPlanHash: null,
      consumedBy: minterId,
    });
    const r = await register();
    expect((body(r) as { recoveredWakes?: number }).recoveredWakes).toBeUndefined();
    expect(await backstopEvents()).toHaveLength(0);
  });

  it("the crash-residual rule: an answered-UNCONSUMED confirmation whose decision already LEFT routed is spent residue, not a lost wake — silent", async () => {
    const id = await routedDecision("resolved by another path");
    await strandedConfirmation(id);
    // The decision resolves WITHOUT consuming this confirmation (the repository
    // header's crash-between-commit-and-consume residual, or a parallel proof).
    const directGate: IDecisionProofGate = { evaluate: async () => ({ authorityMode: "director-direct" }) };
    await decisions.resolveDecision(id, RAISER, { chosenOptionId: "yes" }, directGate);
    const r = await register();
    expect((body(r) as { recoveredWakes?: number }).recoveredWakes).toBeUndefined();
    expect(await backstopEvents()).toHaveLength(0);
  });

  it("an UNANSWERED confirmation is not a wake (nothing to resolve yet) — silent", async () => {
    const id = await routedDecision("awaiting the Director");
    const decision = (await decisions.getDecision(id))!;
    await proofs.mintConfirmation({
      decisionId: id,
      promptHash: canonicalPromptHash(decision),
      proposedResolutionHash: hashProposedResolution({ chosenOptionId: "yes" }),
      proposedAnswer: { chosenOptionId: "yes" },
      executionPlanHash: null,
      ttlMs: 60_000,
      mintedBy: { agentId: minterId, role: "architect" },
    });
    await register();
    expect(await backstopEvents()).toHaveLength(0);
  });

  it("an EXPIRED answered confirmation still surfaces — the Director's answer exists — with re-render guidance instead of a dead resolve pointer", async () => {
    const id = await routedDecision("answered then expired");
    const { conf } = await strandedConfirmation(id, { ttlMs: -1000 });
    const r = await register();
    expect((body(r) as { recoveredWakes?: number }).recoveredWakes).toBe(1);
    const events = await backstopEvents();
    expect(events).toHaveLength(1);
    const p = events[0].payload as Record<string, unknown>;
    expect(String(p.body)).toContain("EXPIRED");
    expect(String(p.body)).toContain("re-render");
    expect(String(p.body)).not.toContain(`proofRef=${conf.id}`); // never point at a token the gate will reject
  });

  it("another agent's stranded wake is NOT replayed to this arrival (minter-scoped, like the live wake's targeting)", async () => {
    const id = await routedDecision("someone else's prompt");
    const decision = (await decisions.getDecision(id))!;
    const conf = await proofs.mintConfirmation({
      decisionId: id,
      promptHash: canonicalPromptHash(decision),
      proposedResolutionHash: hashProposedResolution({ chosenOptionId: "yes" }),
      proposedAnswer: { chosenOptionId: "yes" },
      executionPlanHash: null,
      ttlMs: 60_000,
      mintedBy: { agentId: "agent-other-presenter", role: "architect" },
    });
    await proofs.mintSignal({
      channel: "ois-say", answer: "yes", capturedBySurface: "cli",
      confidence: "authenticated", replyable: true, confirmationId: conf.id,
      capturedBy: { agentId: "agent-director", role: "director" },
    });
    const r = await register();
    expect((body(r) as { recoveredWakes?: number }).recoveredWakes).toBeUndefined();
    expect(await backstopEvents()).toHaveLength(0);
  });

  it("best-effort: a dead proof-store path never breaks the handshake (registration is the front door; the backstop is a passenger)", async () => {
    const id = await routedDecision("dead store");
    await strandedConfirmation(id);
    ctx.stores.directorProof = {
      findAnsweredUnconsumedForMinter: async () => { throw new Error("substrate down"); },
    } as unknown as TestPolicyContext["stores"]["directorProof"];
    const r = await register();
    expect(r.isError).toBeFalsy(); // the handshake stands
    expect((body(r) as { agent?: { id?: string } }).agent?.id).toBe(minterId);
  });

  it("convergence: the SAME stranded wake re-surfaces on EVERY engagement until resolved, then goes silent (eventually-exactly-once)", async () => {
    const id = await routedDecision("persistent until resolved");
    const { conf } = await strandedConfirmation(id);
    await register();
    await register();
    expect(await backstopEvents()).toHaveLength(2); // the loop keeps knocking...
    await proofs.consumeConfirmation(conf.id, {
      decisionId: id,
      promptHash: conf.promptHash,
      proposedResolutionHash: conf.proposedResolutionHash,
      executionPlanHash: null,
      consumedBy: minterId,
    });
    await register();
    expect(await backstopEvents()).toHaveLength(2); // ...and stops exactly at resolve
  });
});
