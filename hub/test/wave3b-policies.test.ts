/**
 * Wave 3b Policy Tests — Proposal, Thread
 *
 * Tests the complex FSM domain policies extracted in
 * The Great Decoupling T5. These are the final two domains.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../src/policy/router.js";
import { registerProposalPolicy } from "../src/policy/proposal-policy.js";
import { registerThreadPolicy } from "../src/policy/thread-policy.js";
import { registerSessionPolicy } from "../src/policy/session-policy.js";
import { createTestContext } from "../src/policy/test-utils.js";
import type { IPolicyContext } from "../src/policy/types.js";

const noop = () => {};

// ── Proposal Policy ─────────────────────────────────────────────────

describe("ProposalPolicy", () => {
  let router: PolicyRouter;
  let ctx: IPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerProposalPolicy(router);
    ctx = createTestContext();
  });

  it("registers all proposal tools", () => {
    expect(router.has("create_proposal")).toBe(true);
    expect(router.has("list_proposals")).toBe(true);
    expect(router.has("create_proposal_review")).toBe(true);
    expect(router.has("get_proposal")).toBe(true);
    expect(router.has("close_proposal")).toBe(true);
    expect(router.size).toBe(5);
  });

  it("create_proposal creates and emits proposal_submitted", async () => {
    const result = await router.handle("create_proposal", {
      title: "Add dark mode",
      summary: "Implement dark mode toggle in settings",
      body: "# Dark Mode\n\nFull proposal text...",
    }, ctx);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.proposalId).toBeDefined();
    expect(parsed.status).toBe("submitted");

    const emitted = (ctx as any).dispatchedEvents.find((e: any) => e.event === "proposal_submitted");
    expect(emitted).toBeDefined();
    expect(emitted.selector.roles).toEqual(["architect"]);
  });

  it("list_proposals returns proposals", async () => {
    await router.handle("create_proposal", {
      title: "P1", summary: "S1", body: "B1",
    }, ctx);
    await router.handle("create_proposal", {
      title: "P2", summary: "S2", body: "B2",
    }, ctx);

    const result = await router.handle("list_proposals", {}, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(2);
  });

  it("list_proposals filters by status", async () => {
    await router.handle("create_proposal", {
      title: "P1", summary: "S1", body: "B1",
    }, ctx);

    const result = await router.handle("list_proposals", { status: "approved" }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(0);
  });

  it("full lifecycle: create → review → get → close", async () => {
    // Create
    const createResult = await router.handle("create_proposal", {
      title: "Lifecycle test",
      summary: "Test full lifecycle",
      body: "Full body",
    }, ctx);
    const { proposalId } = JSON.parse(createResult.content[0].text);

    // Review (approve)
    const reviewCtx = createTestContext({ stores: ctx.stores });
    const reviewResult = await router.handle("create_proposal_review", {
      proposalId,
      decision: "approved",
      feedback: "Looks good, proceed",
    }, reviewCtx);
    expect(reviewResult.isError).toBeUndefined();
    const reviewParsed = JSON.parse(reviewResult.content[0].text);
    expect(reviewParsed.decision).toBe("approved");

    const emitted = (reviewCtx as any).dispatchedEvents.find((e: any) => e.event === "proposal_decided");
    expect(emitted).toBeDefined();
    expect(emitted.selector.roles).toEqual(["engineer"]);

    // Get
    const getResult = await router.handle("get_proposal", { proposalId }, ctx);
    const getParsed = JSON.parse(getResult.content[0].text);
    expect(getParsed.status).toBe("approved");
    expect(getParsed.decision).toBe("approved");
    expect(getParsed.feedback).toBe("Looks good, proceed");

    // Close
    const closeResult = await router.handle("close_proposal", { proposalId }, ctx);
    const closeParsed = JSON.parse(closeResult.content[0].text);
    expect(closeParsed.success).toBe(true);
    expect(closeParsed.status).toBe("implemented");
  });

  it("create_proposal_review fails for non-existent proposal", async () => {
    const result = await router.handle("create_proposal_review", {
      proposalId: "prop-999",
      decision: "approved",
      feedback: "N/A",
    }, ctx);
    expect(result.isError).toBe(true);
  });

  it("get_proposal returns error for non-existent", async () => {
    const result = await router.handle("get_proposal", { proposalId: "prop-999" }, ctx);
    expect(result.isError).toBe(true);
  });

  it("close_proposal fails for non-existent", async () => {
    const result = await router.handle("close_proposal", { proposalId: "prop-999" }, ctx);
    expect(result.isError).toBe(true);
  });
});

// ── Thread Policy ───────────────────────────────────────────────────

describe("ThreadPolicy", () => {
  let router: PolicyRouter;
  let ctx: IPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerThreadPolicy(router);
    registerSessionPolicy(router);
    ctx = createTestContext();
  });

  it("registers all thread tools", () => {
    expect(router.has("create_thread")).toBe(true);
    expect(router.has("create_thread_reply")).toBe(true);
    expect(router.has("get_thread")).toBe(true);
    expect(router.has("list_threads")).toBe(true);
    expect(router.has("close_thread")).toBe(true);
  });

  it("create_thread opens and emits thread_message", async () => {
    // Register as architect so we know the role
    await router.handle("register_role", { role: "architect" }, ctx);

    const result = await router.handle("create_thread", {
      title: "Design Discussion",
      message: "How should we handle errors?",
    }, ctx);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.threadId).toBeDefined();
    expect(parsed.status).toBe("active");
    expect(parsed.currentTurn).toBe("engineer"); // architect opened, engineer's turn

    const emitted = (ctx as any).dispatchedEvents.find((e: any) => e.event === "thread_message");
    expect(emitted).toBeDefined();
    expect(emitted.selector.roles).toEqual(["engineer"]); // notifies the other party
  });

  it("create_thread_reply and turn alternation", async () => {
    // Architect opens thread
    await router.handle("register_role", { role: "architect" }, ctx);
    const createResult = await router.handle("create_thread", {
      title: "Turn test",
      message: "Opening message",
    }, ctx);
    const { threadId } = JSON.parse(createResult.content[0].text);

    // Engineer replies
    const engCtx = createTestContext({ stores: ctx.stores, role: "engineer" });
    await router.handle("register_role", { role: "engineer" }, engCtx);
    const replyResult = await router.handle("create_thread_reply", {
      threadId,
      message: "Engineer response",
    }, engCtx);

    const parsed = JSON.parse(replyResult.content[0].text);
    expect(parsed.status).toBe("active");
    expect(parsed.currentTurn).toBe("architect"); // back to architect
    expect(parsed.roundCount).toBe(2);
  });

  it("convergence: both parties converge → thread converges", async () => {
    // Architect opens with convergence
    await router.handle("register_role", { role: "architect" }, ctx);
    const createResult = await router.handle("create_thread", {
      title: "Convergence test",
      message: "I think we should do X",
    }, ctx);
    const { threadId } = JSON.parse(createResult.content[0].text);

    // Architect already sent opening — now engineer replies with convergence
    const engCtx = createTestContext({ stores: ctx.stores, role: "engineer" });
    await router.handle("register_role", { role: "engineer" }, engCtx);
    const reply1 = await router.handle("create_thread_reply", {
      threadId,
      message: "Agreed on X",
      converged: true,
      intent: "implementation_ready",
      // Mission-21 Phase 1: gate requires at least one committed
      // action AND non-empty summary. Engineer stages close_no_action
      // and authors the summary on the first convergence reply.
      summary: "Architect proposed X; Engineer agreed. No further action required.",
      stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "Agreement reached" } }],
    }, engCtx);
    const r1 = JSON.parse(reply1.content[0].text);

    // Architect converges too
    const archCtx2 = createTestContext({ stores: ctx.stores });
    await router.handle("register_role", { role: "architect" }, archCtx2);
    const reply2 = await router.handle("create_thread_reply", {
      threadId,
      message: "Confirmed",
      converged: true,
    }, archCtx2);
    const r2 = JSON.parse(reply2.content[0].text);
    expect(r2.status).toBe("converged");

    // Should emit thread_converged
    const emitted = (archCtx2 as any).dispatchedEvents.find((e: any) => e.event === "thread_converged");
    expect(emitted).toBeDefined();
  });

  it("get_thread returns full thread", async () => {
    await router.handle("register_role", { role: "architect" }, ctx);
    const createResult = await router.handle("create_thread", {
      title: "Get test",
      message: "Hello",
    }, ctx);
    const { threadId } = JSON.parse(createResult.content[0].text);

    const result = await router.handle("get_thread", { threadId }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.title).toBe("Get test");
    expect(parsed.messages.length).toBeGreaterThanOrEqual(1);
  });

  it("get_thread returns error for non-existent", async () => {
    const result = await router.handle("get_thread", { threadId: "thread-999" }, ctx);
    expect(result.isError).toBe(true);
  });

  it("list_threads returns summaries without messages", async () => {
    await router.handle("register_role", { role: "architect" }, ctx);
    await router.handle("create_thread", { title: "T1", message: "M1" }, ctx);
    await router.handle("create_thread", { title: "T2", message: "M2" }, ctx);

    const result = await router.handle("list_threads", {}, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(2);
    // Summaries should not include messages array
    expect(parsed.threads[0].messages).toBeUndefined();
  });

  it("list_threads filters by status", async () => {
    await router.handle("register_role", { role: "architect" }, ctx);
    await router.handle("create_thread", { title: "Active", message: "M1" }, ctx);

    const result = await router.handle("list_threads", { status: "closed" }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(0);
  });

  it("close_thread closes a thread", async () => {
    await router.handle("register_role", { role: "architect" }, ctx);
    const createResult = await router.handle("create_thread", {
      title: "Close me",
      message: "Opening",
    }, ctx);
    const { threadId } = JSON.parse(createResult.content[0].text);

    const result = await router.handle("close_thread", { threadId }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe("closed");
  });

  it("close_thread fails for non-existent", async () => {
    const result = await router.handle("close_thread", { threadId: "thread-999" }, ctx);
    expect(result.isError).toBe(true);
  });

  it("create_thread_reply fails when not your turn", async () => {
    // Architect opens (engineer's turn)
    await router.handle("register_role", { role: "architect" }, ctx);
    const createResult = await router.handle("create_thread", {
      title: "Turn enforcement",
      message: "Opening",
    }, ctx);
    const { threadId } = JSON.parse(createResult.content[0].text);

    // Architect tries to reply again (still engineer's turn)
    const result = await router.handle("create_thread_reply", {
      threadId,
      message: "Out of turn!",
    }, ctx);
    expect(result.isError).toBe(true);
  });
});

// ── Mission-21 Phase 1: Threads 2.0 ──────────────────────────────────

describe("ThreadPolicy — Threads 2.0 (Mission-21 Phase 1)", () => {
  let router: PolicyRouter;
  let archCtx: IPolicyContext;
  let engCtx: IPolicyContext;

  beforeEach(async () => {
    router = new PolicyRouter(noop);
    registerThreadPolicy(router);
    registerSessionPolicy(router);
    archCtx = createTestContext();
    engCtx = createTestContext({ stores: archCtx.stores, role: "engineer", sessionId: "eng-session-001" });
    await router.handle("register_role", { role: "architect" }, archCtx);
    await router.handle("register_role", { role: "engineer" }, engCtx);
  });

  async function openThread(title = "T", message = "M"): Promise<string> {
    const result = await router.handle("create_thread", { title, message }, archCtx);
    return JSON.parse(result.content[0].text).threadId;
  }

  // Helper — reply with a stage/summary payload commonly needed below.
  async function convergeEngReply(threadId: string) {
    return router.handle("create_thread_reply", {
      threadId,
      message: "engineer converges",
      converged: true,
      summary: "Agreed outcome.",
      stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "no further action needed" } }],
    }, engCtx);
  }

  it("rejects converged=true when convergenceActions empty (gate)", async () => {
    const threadId = await openThread();
    // Engineer converges with summary but no actions → gate rejection
    const r = await router.handle("create_thread_reply", {
      threadId,
      message: "done",
      converged: true,
      summary: "all good",
    }, engCtx);
    // Architect converges too → gate fires because no staged actions
    const r2 = await router.handle("create_thread_reply", {
      threadId,
      message: "agreed",
      converged: true,
    }, archCtx);
    expect(r2.isError).toBe(true);
    const parsed = JSON.parse(r2.content[0].text);
    expect(parsed.error).toMatch(/no convergenceActions committed/);
  });

  it("rejects converged=true when summary empty (gate)", async () => {
    const threadId = await openThread();
    // Engineer stages action but no summary
    await router.handle("create_thread_reply", {
      threadId,
      message: "done",
      converged: true,
      stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "nothing" } }],
    }, engCtx);
    // Architect converges → gate fires because summary still empty
    const r2 = await router.handle("create_thread_reply", {
      threadId,
      message: "agreed",
      converged: true,
    }, archCtx);
    expect(r2.isError).toBe(true);
    const parsed = JSON.parse(r2.content[0].text);
    expect(parsed.error).toMatch(/summary is empty/);
  });

  it("close_no_action happy path: converges, closes thread, emits thread_convergence_completed", async () => {
    const threadId = await openThread();
    await convergeEngReply(threadId);
    const r2 = await router.handle("create_thread_reply", {
      threadId,
      message: "Confirmed.",
      converged: true,
    }, archCtx);
    const parsed = JSON.parse(r2.content[0].text);
    // The cascade auto-closes the thread after successful convergence;
    // the reply response captures the moment just before close.
    expect(["converged", "closed"]).toContain(parsed.status);
    expect(parsed.convergenceActions).toHaveLength(1);
    expect(parsed.convergenceActions[0].status).toBe("committed");
    // Event fired with report
    const completedEvent = (archCtx as any).dispatchedEvents.find((e: any) => e.event === "thread_convergence_completed");
    expect(completedEvent).toBeDefined();
    expect(completedEvent.data.committedActionCount).toBe(1);
    expect(completedEvent.data.report).toHaveLength(1);
    expect(completedEvent.data.report[0].status).toBe("executed");
  });

  it("stage → revise chain preserves revisionOf lineage", async () => {
    const threadId = await openThread();
    const r1 = await router.handle("create_thread_reply", {
      threadId,
      message: "initial proposal",
      stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "first-draft reason" } }],
    }, engCtx);
    expect(r1.isError).toBeUndefined();
    const parsed1 = JSON.parse(r1.content[0].text);
    expect(parsed1.convergenceActions).toHaveLength(1);
    expect(parsed1.convergenceActions[0].id).toBe("action-1");

    // Architect revises action-1
    const r2 = await router.handle("create_thread_reply", {
      threadId,
      message: "revising the reason",
      stagedActions: [{ kind: "revise", id: "action-1", payload: { reason: "refined reason" } }],
    }, archCtx);
    const parsed2 = JSON.parse(r2.content[0].text);
    expect(parsed2.convergenceActions).toHaveLength(2);
    const revised = parsed2.convergenceActions.find((a: any) => a.id === "action-1");
    const next = parsed2.convergenceActions.find((a: any) => a.id === "action-2");
    expect(revised.status).toBe("revised");
    expect(next.status).toBe("staged");
    expect(next.revisionOf).toBe("action-1");
    expect(next.payload.reason).toBe("refined reason");
  });

  it("retract removes staged action from gate-eligible set", async () => {
    const threadId = await openThread();
    await router.handle("create_thread_reply", {
      threadId,
      message: "stage one",
      stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "maybe" } }],
    }, engCtx);
    const r2 = await router.handle("create_thread_reply", {
      threadId,
      message: "retract that",
      stagedActions: [{ kind: "retract", id: "action-1" }],
    }, archCtx);
    const parsed2 = JSON.parse(r2.content[0].text);
    expect(parsed2.convergenceActions[0].status).toBe("retracted");
    // Engineer now tries to converge with retracted-only state → gate rejects
    const r3 = await router.handle("create_thread_reply", {
      threadId,
      message: "converge",
      converged: true,
      summary: "summary",
    }, engCtx);
    // r3 is the first converged=true on this thread (scalar), so no gate yet
    expect(r3.isError).toBeUndefined();
    const r4 = await router.handle("create_thread_reply", {
      threadId,
      message: "confirm",
      converged: true,
    }, archCtx);
    expect(r4.isError).toBe(true);
    const parsed4 = JSON.parse(r4.content[0].text);
    expect(parsed4.error).toMatch(/no convergenceActions committed/);
  });

  it("participants array upserts {role, agentId} on first reply by each Agent", async () => {
    const threadId = await openThread(); // opener = architect (no agentId in test context)
    await router.handle("create_thread_reply", {
      threadId,
      message: "eng joins",
    }, engCtx);
    const getResult = await router.handle("get_thread", { threadId }, archCtx);
    const thread = JSON.parse(getResult.content[0].text);
    expect(thread.participants).toHaveLength(2);
    const roles = thread.participants.map((p: any) => p.role);
    expect(roles).toEqual(expect.arrayContaining(["architect", "engineer"]));
  });

  it("authorAgentId attached to every ThreadMessage", async () => {
    const threadId = await openThread();
    await router.handle("create_thread_reply", { threadId, message: "eng" }, engCtx);
    const getResult = await router.handle("get_thread", { threadId }, archCtx);
    const thread = JSON.parse(getResult.content[0].text);
    expect(thread.messages).toHaveLength(2);
    // In test context getAgentForSession resolves to null — expected for non-registered Agents
    for (const msg of thread.messages) {
      expect("authorAgentId" in msg).toBe(true);
    }
  });

  it("retract of non-staged (already-revised) action fails with gate error", async () => {
    const threadId = await openThread();
    await router.handle("create_thread_reply", {
      threadId,
      message: "stage",
      stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "a" } }],
    }, engCtx);
    // Architect revises action-1, then engineer tries to retract action-1
    await router.handle("create_thread_reply", {
      threadId,
      message: "revise",
      stagedActions: [{ kind: "revise", id: "action-1", payload: { reason: "b" } }],
    }, archCtx);
    const r3 = await router.handle("create_thread_reply", {
      threadId,
      message: "retract the revised one",
      stagedActions: [{ kind: "retract", id: "action-1" }],
    }, engCtx);
    expect(r3.isError).toBe(true);
    const parsed = JSON.parse(r3.content[0].text);
    expect(parsed.error).toMatch(/Cannot retract action action-1/);
  });

  it("summary persists across rounds (set by engineer, inherited by architect)", async () => {
    const threadId = await openThread();
    await router.handle("create_thread_reply", {
      threadId,
      message: "eng",
      summary: "Engineer-authored summary",
    }, engCtx);
    const getResult = await router.handle("get_thread", { threadId }, archCtx);
    const thread = JSON.parse(getResult.content[0].text);
    expect(thread.summary).toBe("Engineer-authored summary");
  });

  it("reply response echoes current convergenceActions + participants (Architect review #2)", async () => {
    const threadId = await openThread();
    const r = await router.handle("create_thread_reply", {
      threadId,
      message: "hi",
      stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "x" } }],
    }, engCtx);
    const parsed = JSON.parse(r.content[0].text);
    expect(parsed.convergenceActions).toBeDefined();
    expect(parsed.participants).toBeDefined();
    expect(parsed.summary).toBeDefined();
    expect(parsed.convergenceActions).toHaveLength(1);
    expect(parsed.participants.length).toBeGreaterThanOrEqual(1);
  });

  it("convergence commits staged actions atomically (staged → committed)", async () => {
    const threadId = await openThread();
    await convergeEngReply(threadId);
    const r2 = await router.handle("create_thread_reply", {
      threadId,
      message: "confirm",
      converged: true,
    }, archCtx);
    const parsed = JSON.parse(r2.content[0].text);
    const committed = parsed.convergenceActions.filter((a: any) => a.status === "committed");
    const stagedStill = parsed.convergenceActions.filter((a: any) => a.status === "staged");
    expect(committed.length).toBeGreaterThanOrEqual(1);
    expect(stagedStill.length).toBe(0);
  });
});

// ── Mission-21 Phase 1 (INV-TH16): participant-scoped routing ─────────

describe("ThreadPolicy — participant-scoped dispatch (INV-TH16)", () => {
  let router: PolicyRouter;
  let archCtx: IPolicyContext;
  let eng1Ctx: IPolicyContext;
  let eng2Ctx: IPolicyContext;
  let archId: string;
  let eng1Id: string;
  let eng2Id: string;

  beforeEach(async () => {
    router = new PolicyRouter(noop);
    registerThreadPolicy(router);

    // Shared store pool — one engineerRegistry with three real M18 Agents.
    archCtx = createTestContext({ role: "architect", sessionId: "s-arch" });
    eng1Ctx = createTestContext({ stores: archCtx.stores, role: "engineer", sessionId: "s-eng-1" });
    eng2Ctx = createTestContext({ stores: archCtx.stores, role: "engineer", sessionId: "s-eng-2" });

    const reg = archCtx.stores.engineerRegistry;
    const client = { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" };
    const archReg = await reg.registerAgent("s-arch", "architect", {
      globalInstanceId: "inst-arch", role: "architect", clientMetadata: client,
    });
    const eng1Reg = await reg.registerAgent("s-eng-1", "engineer", {
      globalInstanceId: "inst-eng-1", role: "engineer", clientMetadata: client,
    });
    const eng2Reg = await reg.registerAgent("s-eng-2", "engineer", {
      globalInstanceId: "inst-eng-2", role: "engineer", clientMetadata: client,
    });
    archId = archReg.engineerId;
    eng1Id = eng1Reg.engineerId;
    eng2Id = eng2Reg.engineerId;
  });

  it("open without recipientAgentId falls back to role broadcast", async () => {
    await router.handle("create_thread", { title: "T", message: "M" }, eng1Ctx);
    const openEvent = (eng1Ctx as any).dispatchedEvents.find((e: any) => e.event === "thread_message");
    expect(openEvent).toBeDefined();
    expect(openEvent.selector.roles).toEqual(["architect"]);
    expect(openEvent.selector.engineerIds).toBeUndefined();
  });

  it("open with recipientAgentId pins dispatch to that engineerId and omits role broadcast", async () => {
    await router.handle("create_thread", {
      title: "eng↔eng",
      message: "hey eng-2",
      recipientAgentId: eng2Id,
    }, eng1Ctx);
    const openEvent = (eng1Ctx as any).dispatchedEvents.find((e: any) => e.event === "thread_message");
    expect(openEvent).toBeDefined();
    expect(openEvent.selector.engineerIds).toEqual([eng2Id]);
    expect(openEvent.selector.roles).toBeUndefined();
  });

  it("reply dispatch scopes to non-author participants by engineerId", async () => {
    // eng-1 opens with recipientAgentId=eng-2 → participants now include eng-1 only.
    const openResult = await router.handle("create_thread", {
      title: "eng↔eng",
      message: "open",
      recipientAgentId: eng2Id,
    }, eng1Ctx);
    const threadId = JSON.parse(openResult.content[0].text).threadId;
    // eng-2 replies.
    (eng2Ctx as any).dispatchedEvents.length = 0;
    await router.handle("create_thread_reply", { threadId, message: "hi back" }, eng2Ctx);
    const replyEvent = (eng2Ctx as any).dispatchedEvents.find((e: any) => e.event === "thread_message");
    expect(replyEvent).toBeDefined();
    // Target is participants minus author = [eng-1].
    expect(replyEvent.selector.engineerIds).toEqual([eng1Id]);
    expect(replyEvent.selector.roles).toBeUndefined();
  });

  it("reply dispatch falls back to role when no participant has a resolved agentId", async () => {
    // Simulate legacy thread where nobody has an M18 Agent (agentId=null).
    // Use setSessionRole directly to populate the role map — this is what
    // the legacy register_role path does without creating an Agent entity.
    const legacyArch = createTestContext({ role: "architect", sessionId: "legacy-arch" });
    const legacyEng = createTestContext({ stores: legacyArch.stores, role: "engineer", sessionId: "legacy-eng" });
    legacyArch.stores.engineerRegistry.setSessionRole("legacy-arch", "architect");
    legacyArch.stores.engineerRegistry.setSessionRole("legacy-eng", "engineer");
    const openResult = await router.handle("create_thread", { title: "L", message: "M" }, legacyArch);
    const threadId = JSON.parse(openResult.content[0].text).threadId;
    (legacyEng as any).dispatchedEvents.length = 0;
    await router.handle("create_thread_reply", { threadId, message: "eng reply" }, legacyEng);
    const replyEvent = (legacyEng as any).dispatchedEvents.find((e: any) => e.event === "thread_message");
    expect(replyEvent).toBeDefined();
    // All participants have agentId=null, so fallback to role.
    expect(replyEvent.selector.roles).toEqual(["architect"]);
    expect(replyEvent.selector.engineerIds).toBeUndefined();
  });
});

// ── Mission-24 Phase 2 (M24-T6, INV-TH18): leave_thread tool ─────────

describe("ThreadPolicy — leave_thread (M24-T6)", () => {
  let router: PolicyRouter;
  let archCtx: IPolicyContext;
  let eng1Ctx: IPolicyContext;
  let eng2Ctx: IPolicyContext;
  let archId: string;
  let eng1Id: string;
  let eng2Id: string;

  beforeEach(async () => {
    router = new PolicyRouter(noop);
    registerThreadPolicy(router);

    archCtx = createTestContext({ role: "architect", sessionId: "s-arch" });
    eng1Ctx = createTestContext({ stores: archCtx.stores, role: "engineer", sessionId: "s-eng-1" });
    eng2Ctx = createTestContext({ stores: archCtx.stores, role: "engineer", sessionId: "s-eng-2" });

    const reg = archCtx.stores.engineerRegistry;
    const client = { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" };
    const archReg = await reg.registerAgent("s-arch", "architect", {
      globalInstanceId: "inst-arch", role: "architect", clientMetadata: client,
    });
    const eng1Reg = await reg.registerAgent("s-eng-1", "engineer", {
      globalInstanceId: "inst-eng-1", role: "engineer", clientMetadata: client,
    });
    const eng2Reg = await reg.registerAgent("s-eng-2", "engineer", {
      globalInstanceId: "inst-eng-2", role: "engineer", clientMetadata: client,
    });
    if (archReg.ok) archId = archReg.engineerId;
    if (eng1Reg.ok) eng1Id = eng1Reg.engineerId;
    if (eng2Reg.ok) eng2Id = eng2Reg.engineerId;
  });

  async function openEng1Eng2Thread(): Promise<string> {
    const r = await router.handle("create_thread", {
      title: "peer thread", message: "hi kate",
      recipientAgentId: eng2Id,
    }, eng1Ctx);
    return JSON.parse(r.content[0].text).threadId;
  }

  it("participant can leave an active thread → status becomes abandoned", async () => {
    const threadId = await openEng1Eng2Thread();
    const r = await router.handle("leave_thread", { threadId, reason: "scope change" }, eng1Ctx);
    const parsed = JSON.parse(r.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe("abandoned");
    expect(parsed.leaverAgentId).toBe(eng1Id);

    const getResult = await router.handle("get_thread", { threadId }, eng2Ctx);
    const thread = JSON.parse(getResult.content[0].text);
    expect(thread.status).toBe("abandoned");
  });

  it("rejects leave_thread from a non-participant", async () => {
    const threadId = await openEng1Eng2Thread();
    // archCtx is not on participants (thread is eng1↔eng2)
    const r = await router.handle("leave_thread", { threadId }, archCtx);
    expect(r.isError).toBe(true);
    const parsed = JSON.parse(r.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/not a participant/);
  });

  it("rejects leave_thread on a non-active thread", async () => {
    const threadId = await openEng1Eng2Thread();
    // Manually close first
    await router.handle("close_thread", { threadId }, archCtx);
    const r = await router.handle("leave_thread", { threadId }, eng1Ctx);
    expect(r.isError).toBe(true);
  });

  it("auto-retracts leaver's staged actions; preserves other participant's staged actions", async () => {
    const threadId = await openEng1Eng2Thread();
    // eng2 stages an action on their reply (they hold the turn first)
    await router.handle("create_thread_reply", {
      threadId,
      message: "staging close_no_action",
      stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "from eng-2" } }],
    }, eng2Ctx);
    // eng1 stages another action
    await router.handle("create_thread_reply", {
      threadId,
      message: "eng1 stages too",
      stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "from eng-1" } }],
    }, eng1Ctx);

    // eng1 leaves — their action-2 should auto-retract, eng2's action-1 survives
    await router.handle("leave_thread", { threadId, reason: "rage quit" }, eng1Ctx);

    const getResult = await router.handle("get_thread", { threadId }, eng2Ctx);
    const thread = JSON.parse(getResult.content[0].text);
    const action1 = thread.convergenceActions.find((a: any) => a.id === "action-1");
    const action2 = thread.convergenceActions.find((a: any) => a.id === "action-2");
    expect(action1.status).toBe("staged"); // eng2's, untouched
    expect(action2.status).toBe("retracted"); // eng1's, auto-retracted on leave
  });

  it("dispatches thread_abandoned only to remaining participants (INV-TH16)", async () => {
    const threadId = await openEng1Eng2Thread();
    // eng2 joins as participant on reply
    await router.handle("create_thread_reply", { threadId, message: "hi eng-1" }, eng2Ctx);

    (eng1Ctx as any).dispatchedEvents.length = 0;
    await router.handle("leave_thread", { threadId, reason: "done here" }, eng1Ctx);

    const abandonedEvents = (eng1Ctx as any).dispatchedEvents.filter((e: any) => e.event === "thread_abandoned");
    expect(abandonedEvents).toHaveLength(1);
    expect(abandonedEvents[0].selector.engineerIds).toEqual([eng2Id]);
    expect(abandonedEvents[0].selector.roles).toBeUndefined();
    expect(abandonedEvents[0].data.leaverAgentId).toBe(eng1Id);
    expect(abandonedEvents[0].data.reason).toBe("done here");
  });

  it("writes an audit entry actor=hub on successful leave", async () => {
    const threadId = await openEng1Eng2Thread();
    await router.handle("leave_thread", { threadId, reason: "need to leave" }, eng1Ctx);

    const auditEntries = await eng1Ctx.stores.audit.listEntries(10);
    const entry = auditEntries.find((e) => e.action === "thread_abandoned" && e.relatedEntity === threadId);
    expect(entry).toBeDefined();
    expect(entry!.actor).toBe("hub");
    expect(entry!.details).toContain(eng1Id);
    expect(entry!.details).toContain("need to leave");
  });
});

// ── Mission-24 Phase 2 (M24-T7, INV-TH21): thread reaper ─────────────

describe("ThreadStore — reapIdleThreads (M24-T7)", () => {
  let router: PolicyRouter;
  let archCtx: IPolicyContext;
  let eng1Ctx: IPolicyContext;
  let eng2Ctx: IPolicyContext;
  let eng1Id: string;
  let eng2Id: string;

  beforeEach(async () => {
    router = new PolicyRouter(noop);
    registerThreadPolicy(router);

    archCtx = createTestContext({ role: "architect", sessionId: "s-arch" });
    eng1Ctx = createTestContext({ stores: archCtx.stores, role: "engineer", sessionId: "s-eng-1" });
    eng2Ctx = createTestContext({ stores: archCtx.stores, role: "engineer", sessionId: "s-eng-2" });

    const reg = archCtx.stores.engineerRegistry;
    const client = { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" };
    await reg.registerAgent("s-arch", "architect", {
      globalInstanceId: "inst-arch", role: "architect", clientMetadata: client,
    });
    const eng1Reg = await reg.registerAgent("s-eng-1", "engineer", {
      globalInstanceId: "inst-eng-1", role: "engineer", clientMetadata: client,
    });
    const eng2Reg = await reg.registerAgent("s-eng-2", "engineer", {
      globalInstanceId: "inst-eng-2", role: "engineer", clientMetadata: client,
    });
    if (eng1Reg.ok) eng1Id = eng1Reg.engineerId;
    if (eng2Reg.ok) eng2Id = eng2Reg.engineerId;
  });

  async function openThread(): Promise<string> {
    const r = await router.handle("create_thread", {
      title: "reap me", message: "hi",
      recipientAgentId: eng2Id,
    }, eng1Ctx);
    return JSON.parse(r.content[0].text).threadId;
  }

  /** Force a thread's updatedAt to simulate elapsed idle time. */
  function ageThread(ctx: IPolicyContext, threadId: string, idleMs: number): void {
    const store = ctx.stores.thread as unknown as { threads: Map<string, { updatedAt: string }> };
    const t = store.threads.get(threadId);
    if (!t) throw new Error(`thread ${threadId} not found`);
    t.updatedAt = new Date(Date.now() - idleMs).toISOString();
  }

  it("reaps an active thread whose idle time exceeds the deployment default", async () => {
    const threadId = await openThread();
    ageThread(eng1Ctx, threadId, 60_000); // 1 min idle

    const reaped = await eng1Ctx.stores.thread.reapIdleThreads(30_000); // threshold 30s
    expect(reaped).toHaveLength(1);
    expect(reaped[0].threadId).toBe(threadId);

    const getResult = await router.handle("get_thread", { threadId }, eng1Ctx);
    const thread = JSON.parse(getResult.content[0].text);
    expect(thread.status).toBe("abandoned");
  });

  it("leaves not-yet-idle active threads alone", async () => {
    const threadId = await openThread();
    // Thread was just created — updatedAt is now; it's nowhere near idle.
    const reaped = await eng1Ctx.stores.thread.reapIdleThreads(7 * 24 * 60 * 60 * 1000);
    expect(reaped).toHaveLength(0);

    const getResult = await router.handle("get_thread", { threadId }, eng1Ctx);
    const thread = JSON.parse(getResult.content[0].text);
    expect(thread.status).toBe("active");
  });

  it("honours per-thread idleExpiryMs override (stricter than default)", async () => {
    const threadId = await openThread();
    // Override the thread's idleExpiryMs to 5s, age it to 10s idle,
    // keep deployment default high (7d). Override should fire.
    const store = eng1Ctx.stores.thread as unknown as {
      threads: Map<string, { updatedAt: string; idleExpiryMs: number | null }>;
    };
    const t = store.threads.get(threadId)!;
    t.idleExpiryMs = 5_000;
    t.updatedAt = new Date(Date.now() - 10_000).toISOString();

    const reaped = await eng1Ctx.stores.thread.reapIdleThreads(7 * 24 * 60 * 60 * 1000);
    expect(reaped).toHaveLength(1);
    expect(reaped[0].threadId).toBe(threadId);
  });

  it("honours per-thread idleExpiryMs override (looser than default)", async () => {
    const threadId = await openThread();
    // Override to 1h, age to only 10s idle, default 5s. Override wins → skip.
    const store = eng1Ctx.stores.thread as unknown as {
      threads: Map<string, { updatedAt: string; idleExpiryMs: number | null }>;
    };
    const t = store.threads.get(threadId)!;
    t.idleExpiryMs = 60 * 60 * 1000;
    t.updatedAt = new Date(Date.now() - 10_000).toISOString();

    const reaped = await eng1Ctx.stores.thread.reapIdleThreads(5_000);
    expect(reaped).toHaveLength(0);
  });

  it("retracts ALL staged actions on reap (no leaver; nothing commits)", async () => {
    const threadId = await openThread();
    // Both engineers stage actions before the thread goes idle.
    await router.handle("create_thread_reply", {
      threadId,
      message: "eng-2 stages",
      stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "from eng-2" } }],
    }, eng2Ctx);
    await router.handle("create_thread_reply", {
      threadId,
      message: "eng-1 stages",
      stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "from eng-1" } }],
    }, eng1Ctx);

    ageThread(eng1Ctx, threadId, 10 * 60 * 1000);
    await eng1Ctx.stores.thread.reapIdleThreads(60_000);

    const getResult = await router.handle("get_thread", { threadId }, eng1Ctx);
    const thread = JSON.parse(getResult.content[0].text);
    expect(thread.convergenceActions).toHaveLength(2);
    for (const action of thread.convergenceActions) {
      expect(action.status).toBe("retracted");
    }
  });

  it("returns ReapedThread shape with title, labels, participantAgentIds, idleMs", async () => {
    const r = await router.handle("create_thread", {
      title: "shape-test",
      message: "m",
      recipientAgentId: eng2Id,
    }, eng1Ctx);
    const threadId = JSON.parse(r.content[0].text).threadId;
    // Promote eng-2 to participant so they appear in participantAgentIds.
    await router.handle("create_thread_reply", { threadId, message: "reply" }, eng2Ctx);

    // Thread labels come from caller-agent labels, which are empty in
    // this test harness. Stamp them directly so we can assert the
    // reaper preserves the map intact in the ReapedThread envelope.
    const store = eng1Ctx.stores.thread as unknown as {
      threads: Map<string, { updatedAt: string; labels: Record<string, string> }>;
    };
    const t = store.threads.get(threadId)!;
    t.labels = { kind: "test", mission: "m24" };
    t.updatedAt = new Date(Date.now() - 90_000).toISOString();

    const reaped = await eng1Ctx.stores.thread.reapIdleThreads(30_000);
    expect(reaped).toHaveLength(1);
    const entry = reaped[0];
    expect(entry.threadId).toBe(threadId);
    expect(entry.title).toBe("shape-test");
    expect(entry.labels).toEqual({ kind: "test", mission: "m24" });
    expect(entry.participantAgentIds.sort()).toEqual([eng1Id, eng2Id].sort());
    expect(entry.idleMs).toBeGreaterThanOrEqual(90_000);
  });

  it("skips non-active threads (closed, converged, already abandoned)", async () => {
    // Active, idle → will reap
    const activeId = await openThread();
    ageThread(eng1Ctx, activeId, 90_000);

    // Closed thread, also artificially aged
    const closedId = await openThread();
    await router.handle("close_thread", { threadId: closedId }, archCtx);
    ageThread(eng1Ctx, closedId, 90_000);

    // Abandoned thread (via leave_thread), also aged
    const abandonedId = await openThread();
    await router.handle("leave_thread", { threadId: abandonedId }, eng1Ctx);
    ageThread(eng1Ctx, abandonedId, 90_000);

    const reaped = await eng1Ctx.stores.thread.reapIdleThreads(30_000);
    expect(reaped).toHaveLength(1);
    expect(reaped[0].threadId).toBe(activeId);
  });

  it("excludes null agentIds from participantAgentIds (pre-M18 legacy)", async () => {
    const legacyArch = createTestContext({ role: "architect", sessionId: "legacy-arch" });
    legacyArch.stores.engineerRegistry.setSessionRole("legacy-arch", "architect");
    legacyArch.stores.engineerRegistry.setSessionRole("legacy-eng", "engineer");
    const openResult = await router.handle("create_thread", {
      title: "legacy", message: "m",
    }, legacyArch);
    const threadId = JSON.parse(openResult.content[0].text).threadId;

    const store = legacyArch.stores.thread as unknown as {
      threads: Map<string, { updatedAt: string }>;
    };
    store.threads.get(threadId)!.updatedAt = new Date(Date.now() - 90_000).toISOString();

    const reaped = await legacyArch.stores.thread.reapIdleThreads(30_000);
    expect(reaped).toHaveLength(1);
    // Author's agentId was null (legacy path), so the set is empty.
    expect(reaped[0].participantAgentIds).toEqual([]);
  });

  it("multiple idle threads reaped in a single call", async () => {
    const a = await openThread();
    const b = await openThread();
    const c = await openThread();
    ageThread(eng1Ctx, a, 90_000);
    ageThread(eng1Ctx, b, 90_000);
    ageThread(eng1Ctx, c, 90_000);

    const reaped = await eng1Ctx.stores.thread.reapIdleThreads(30_000);
    expect(reaped).toHaveLength(3);
    const ids = reaped.map((r) => r.threadId).sort();
    expect(ids).toEqual([a, b, c].sort());
  });
});
