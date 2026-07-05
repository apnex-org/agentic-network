/**
 * work-133 (bug-229) — the signal-captured wake: the decision rail's last
 * unautomated leg. capture_director_signal emitted NO event, so the
 * answered→resolved transition depended on polling or human relay ("I have
 * ratified" / "recheck the queue" — both observed live 2026-07-05).
 *
 * The contract:
 *   - a successful capture emits signal-captured-notification TARGETED (never
 *     broadcast) at the confirmation's Hub-stamped MINTER (the presenting
 *     proxy), plus the architect role when the minter isn't an architect;
 *   - MOOT captures are SILENT BY DESIGN (documented choice): a second answer
 *     rejects at first-answer-wins BEFORE the emit point, and the rejection
 *     already surfaces at the caller's own seat — no event, no double-notify;
 *   - the emit is best-effort observability: a dead message path never fails
 *     the capture (the signal is the PROOF; the event is the wake);
 *   - legacy confirmations without mintedBy degrade to the architect-role
 *     copy (the audit-10076 legacy-tolerance rule).
 *
 * Real repos on the memory substrate through the router.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerDecisionPolicy } from "../decision-policy.js";
import { registerDirectorProofPolicy, SIGNAL_CAPTURED_EVENT } from "../director-proof-policy.js";
import { createTestContext, type TestPolicyContext } from "../test-utils.js";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import { DecisionRepositorySubstrate } from "../../entities/decision-repository-substrate.js";
import { DirectorProofRepositorySubstrate } from "../../entities/director-proof-repository-substrate.js";
import type { DecisionActor } from "../../entities/decision.js";

const RAISER: DecisionActor = { agentId: "agent-arch", role: "architect", sessionId: "s-a" };

function body(r: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(r.content[0].text);
}

describe("signal-captured wake (work-133 / bug-229: the answered→resolved leg)", () => {
  let router: PolicyRouter;
  let archCtx: TestPolicyContext;   // the presenting proxy (mints confirmations)
  let dirCtx: TestPolicyContext;    // the Director ingress (captures)
  let decisions: DecisionRepositorySubstrate;
  let proofs: DirectorProofRepositorySubstrate;

  beforeEach(async () => {
    const substrate = createMemoryStorageSubstrate();
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    const counter = new SubstrateCounter(substrate);
    decisions = new DecisionRepositorySubstrate(substrate, counter);
    proofs = new DirectorProofRepositorySubstrate(substrate, counter);
    router = new PolicyRouter();
    registerDecisionPolicy(router);
    registerDirectorProofPolicy(router);
    archCtx = createTestContext({ role: "architect" });
    dirCtx = createTestContext({ role: "director" });
    // SHARED domain + message stores (each ctx keeps its OWN registry so the
    // RBAC sees each seat's role) — the cross-seat wake under test.
    for (const c of [archCtx, dirCtx]) {
      c.stores.decision = decisions;
      c.stores.directorProof = proofs;
    }
    dirCtx.stores.message = archCtx.stores.message;
  });

  async function routedDecision(title: string): Promise<string> {
    const d = await decisions.raiseDecision({
      title, context: "c", class: "approval",
      options: [{ id: "yes", label: "Yes", description: "y" }], raisedBy: RAISER,
    });
    await decisions.curateDecision(d.id, RAISER);
    await decisions.routeDecision(d.id, RAISER, { target: "director" });
    return d.id;
  }

  async function capturedEvents() {
    const msgs = await archCtx.stores.message.listMessages({});
    return msgs.filter((m) => (m.payload as Record<string, unknown>)?.notificationEvent === SIGNAL_CAPTURED_EVENT);
  }

  it("the wake: a Director capture answering an architect-minted confirmation emits ONE agent-targeted event at the MINTER, payload carries the resolve pointer", async () => {
    const id = await routedDecision("wake me");
    const minted = body(await router.handle("mint_director_confirmation", { decisionId: id, chosenOptionId: "yes" }, archCtx)) as { confirmation: { id: string; mintedBy: { agentId: string; role: string } } };
    expect(minted.confirmation.mintedBy.role).toBe("architect"); // Hub-stamped at mint
    const r = await router.handle("capture_director_signal", {
      channel: "ois-say", answer: "yes", capturedBySurface: "ois-cli", confidence: "authenticated", decisionId: id,
    }, dirCtx);
    expect(r.isError).toBeFalsy();
    const events = await capturedEvents();
    // Minter IS an architect → exactly ONE copy, agent-pinpointed (no role dup).
    expect(events).toHaveLength(1);
    expect(events[0].target).toEqual({ agentId: minted.confirmation.mintedBy.agentId }); // NEVER broadcast
    const p = events[0].payload as Record<string, unknown>;
    expect(p.decision_id).toBe(id);
    expect(p.confirmation_id).toBe(minted.confirmation.id);
    expect(p.signal_id).toMatch(/^dsig-/);
    expect(p.answer).toBe("yes");
    expect(String(p.body)).toContain(`resolve_as_director proofRef=${minted.confirmation.id}`); // the wake tells the proxy its next verb
  });

  it("director-minted confirmation: the capture event reaches the minter AND the architect role (two copies, identical payloads)", async () => {
    const id = await routedDecision("self-minted");
    const minted = body(await router.handle("mint_director_confirmation", { decisionId: id, chosenOptionId: "yes" }, dirCtx)) as { confirmation: { id: string; mintedBy: { agentId: string } } };
    await router.handle("capture_director_signal", {
      channel: "ois-say", answer: "yes", capturedBySurface: "ois-cli", confidence: "authenticated", decisionId: id,
    }, dirCtx);
    const events = await capturedEvents();
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.target)).toEqual([
      { agentId: minted.confirmation.mintedBy.agentId },
      { role: "architect" },
    ]);
    expect(JSON.stringify(events[0].payload)).toBe(JSON.stringify(events[1].payload));
  });

  it("MOOT IS SILENT (the documented choice): a second answer rejects at first-answer-wins and emits NOTHING new", async () => {
    const id = await routedDecision("first answer wins");
    const minted = body(await router.handle("mint_director_confirmation", { decisionId: id, chosenOptionId: "yes" }, archCtx)) as { confirmation: { id: string } };
    await router.handle("capture_director_signal", { channel: "ois-say", answer: "yes", capturedBySurface: "cli", confidence: "authenticated", decisionId: id }, dirCtx);
    const before = (await capturedEvents()).length;
    // The moot re-answer: explicit confirmationId to the already-answered token.
    const r2 = await router.handle("capture_director_signal", {
      channel: "ois-say", answer: "changed my mind", capturedBySurface: "cli", confidence: "authenticated", confirmationId: minted.confirmation.id,
    }, dirCtx);
    expect(r2.isError).toBe(true); // the REJECTION is the caller's notification
    expect(String(body(r2).error)).toMatch(/first answer wins|already answered/);
    expect((await capturedEvents()).length).toBe(before); // no event — silent by design
  });

  it("unbound capture (no decision/confirmation): one architect-role copy, null refs", async () => {
    await router.handle("capture_director_signal", { channel: "ois-say", answer: "general note", capturedBySurface: "cli", confidence: "authenticated" }, dirCtx);
    const events = await capturedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].target).toEqual({ role: "architect" });
    const p = events[0].payload as Record<string, unknown>;
    expect(p.decision_id).toBeNull();
    expect(p.confirmation_id).toBeNull();
  });

  it("legacy confirmation without mintedBy: the wake degrades to the architect-role copy (never crashes)", async () => {
    const id = await routedDecision("legacy row");
    // Repo-direct mint WITHOUT mintedBy = the pre-work-133 row shape.
    const conf = await proofs.mintConfirmation({
      decisionId: id, promptHash: "h", proposedResolutionHash: "h2",
      proposedAnswer: { chosenOptionId: "yes" }, executionPlanHash: null, ttlMs: 60_000,
    });
    const r = await router.handle("capture_director_signal", {
      channel: "ois-say", answer: "yes", capturedBySurface: "cli", confidence: "authenticated", confirmationId: conf.id,
    }, dirCtx);
    expect(r.isError).toBeFalsy();
    const events = await capturedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].target).toEqual({ role: "architect" });
  });

  it("best-effort: a dead message path never fails the capture (the signal is the proof; the event is only the wake)", async () => {
    const id = await routedDecision("dead path");
    await router.handle("mint_director_confirmation", { decisionId: id, chosenOptionId: "yes" }, archCtx);
    const deadCtx = createTestContext({ role: "director" });
    deadCtx.stores.decision = decisions;
    deadCtx.stores.directorProof = proofs;
    deadCtx.stores.message = undefined as unknown as TestPolicyContext["stores"]["message"];
    const r = await router.handle("capture_director_signal", {
      channel: "ois-say", answer: "yes", capturedBySurface: "cli", confidence: "authenticated", decisionId: id,
    }, deadCtx);
    expect(r.isError).toBeFalsy(); // captured despite the dead emit path
    expect((body(r) as { signal: { id: string } }).signal.id).toMatch(/^dsig-/);
  });
});
