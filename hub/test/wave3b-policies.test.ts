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

  beforeEach(async () => {
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

  beforeEach(async () => {
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
    await router.handle("register_role", {
      role: "architect",
      globalInstanceId: `test-gid-${ctx.sessionId}`,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    }, ctx);

    const result = await router.handle("create_thread", {
      routingMode: "broadcast",title: "Design Discussion",
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
    await router.handle("register_role", {
      role: "architect",
      globalInstanceId: `test-gid-${ctx.sessionId}`,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    }, ctx);
    const createResult = await router.handle("create_thread", {
      routingMode: "broadcast",title: "Turn test",
      message: "Opening message",
    }, ctx);
    const { threadId } = JSON.parse(createResult.content[0].text);

    // Engineer replies
    const engCtx = createTestContext({ stores: ctx.stores, role: "engineer" });
    await router.handle("register_role", {
      role: "engineer",
      globalInstanceId: `test-gid-${engCtx.sessionId}`,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    }, engCtx);
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
    await router.handle("register_role", {
      role: "architect",
      globalInstanceId: `test-gid-${ctx.sessionId}`,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    }, ctx);
    const createResult = await router.handle("create_thread", {
      routingMode: "broadcast",title: "Convergence test",
      message: "I think we should do X",
    }, ctx);
    const { threadId } = JSON.parse(createResult.content[0].text);

    // Architect already sent opening — now engineer replies with convergence
    const engCtx = createTestContext({ stores: ctx.stores, role: "engineer" });
    await router.handle("register_role", {
      role: "engineer",
      globalInstanceId: `test-gid-${engCtx.sessionId}`,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    }, engCtx);
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

    // Architect converges too. ADR-016 INV-TH27: must reuse the
    // original ctx — a new architect context would have a distinct
    // M18 agentId and the thread's currentTurnAgentId pin would reject
    // it (correctly; post-Phase-2 a different agent cannot usurp a
    // pinned turn).
    const archCtx2 = ctx;
    const reply2 = await router.handle("create_thread_reply", {
      threadId,
      message: "Confirmed",
      converged: true,
    }, archCtx2);
    const r2 = JSON.parse(reply2.content[0].text);
    expect(r2.status).toBe("converged");

    // Mission-24 Phase 2 (M24-T3): merged thread_convergence_finalized
    // replaces the legacy thread_converged + thread_convergence_completed
    // split. The finalized event fires AFTER the internal cascade runs,
    // so assert on archCtx2's dispatch ledger via the orchestrator's
    // internal event drain (the handler runs inside the dispatch cycle).
    const emitted = (archCtx2 as any).dispatchedEvents.find((e: any) => e.event === "thread_convergence_finalized");
    expect(emitted).toBeDefined();
    // outstandingIntent mirrors the converging reply's intent — the
    // architect's convergence call here didn't set one, so it's null.
    // What matters is the ConvergenceReport shape is populated.
    expect(emitted.data.summary).toMatch(/Engineer agreed/i);
    expect(emitted.data.committedActionCount).toBe(1);
    expect(emitted.data.executedCount).toBe(1);
    expect(emitted.data.warning).toBe(false);
    expect(Array.isArray(emitted.data.report)).toBe(true);
  });

  it("get_thread returns full thread", async () => {
    await router.handle("register_role", {
      role: "architect",
      globalInstanceId: `test-gid-${ctx.sessionId}`,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    }, ctx);
    const createResult = await router.handle("create_thread", {
      routingMode: "broadcast",title: "Get test",
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
    await router.handle("register_role", {
      role: "architect",
      globalInstanceId: `test-gid-${ctx.sessionId}`,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    }, ctx);
    await router.handle("create_thread", { routingMode: "broadcast",title: "T1", message: "M1" }, ctx);
    await router.handle("create_thread", { routingMode: "broadcast",title: "T2", message: "M2" }, ctx);

    const result = await router.handle("list_threads", {}, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(2);
    // Summaries should not include messages array
    expect(parsed.threads[0].messages).toBeUndefined();
  });

  it("list_threads filters by status", async () => {
    await router.handle("register_role", {
      role: "architect",
      globalInstanceId: `test-gid-${ctx.sessionId}`,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    }, ctx);
    await router.handle("create_thread", { routingMode: "broadcast",title: "Active", message: "M1" }, ctx);

    const result = await router.handle("list_threads", { status: "closed" }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(0);
  });

  it("close_thread closes a thread", async () => {
    await router.handle("register_role", {
      role: "architect",
      globalInstanceId: `test-gid-${ctx.sessionId}`,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    }, ctx);
    const createResult = await router.handle("create_thread", {
      routingMode: "broadcast",title: "Close me",
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

  it("force_close_thread administratively closes and abandons queue items (Phase 2c ckpt-C, idea-117)", async () => {
    await router.handle("register_role", {
      role: "architect",
      globalInstanceId: `test-gid-${ctx.sessionId}`,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    }, ctx);
    const architectAgent = await ctx.stores.engineerRegistry.getAgentForSession(ctx.sessionId);
    expect(architectAgent).not.toBeNull();

    const createResult = await router.handle("create_thread", {
      routingMode: "broadcast", title: "Stuck thread", message: "Opening",
    }, ctx);
    const { threadId } = JSON.parse(createResult.content[0].text);

    // Simulate a stuck queue item for the architect on this thread
    const queued = await ctx.stores.pendingAction.enqueue({
      targetAgentId: architectAgent!.engineerId,
      dispatchType: "thread_message",
      entityRef: threadId,
      payload: {},
    });
    await ctx.stores.pendingAction.receiptAck(queued.id);

    const result = await router.handle("force_close_thread", { threadId, reason: "test admin close" }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe("closed");
    expect(parsed.abandonedQueueItems.length).toBeGreaterThanOrEqual(1);

    // Thread should be closed
    const thread = await ctx.stores.thread.getThread(threadId);
    expect(thread?.status).toBe("closed");

    // Queue item should be errored (abandoned)
    const item = await ctx.stores.pendingAction.getById(queued.id);
    expect(item?.state).toBe("errored");
    expect(item?.escalationReason).toBe("test admin close");

    // Audit entry + Director notification emitted
    const audits = await ctx.stores.audit.listEntries();
    expect(audits.some((a: any) => a.action === "thread_force_closed" && a.relatedEntity === threadId)).toBe(true);
    const notifs = await ctx.stores.directorNotification.list({});
    expect(notifs.some((n: any) => n.sourceRef === threadId)).toBe(true);
  });

  it("force_close_thread denies engineer role", async () => {
    const engCtx = createTestContext({ stores: ctx.stores, role: "engineer" });
    await router.handle("register_role", { role: "engineer" }, engCtx);
    const result = await router.handle("force_close_thread", { threadId: "thread-anything" }, engCtx);
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toMatch(/Authorization denied/);
  });

  it("create_thread_reply fails when not your turn", async () => {
    // Architect opens (engineer's turn)
    await router.handle("register_role", {
      role: "architect",
      globalInstanceId: `test-gid-${ctx.sessionId}`,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    }, ctx);
    const createResult = await router.handle("create_thread", {
      routingMode: "broadcast",title: "Turn enforcement",
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
    await router.handle("register_role", {
      role: "architect",
      globalInstanceId: `test-gid-${archCtx.sessionId}`,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    }, archCtx);
    await router.handle("register_role", {
      role: "engineer",
      globalInstanceId: `test-gid-${engCtx.sessionId}`,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    }, engCtx);
  });

  async function openThread(title = "T", message = "M"): Promise<string> {
    const result = await router.handle("create_thread", { routingMode: "broadcast",title, message }, archCtx);
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

  it("close_no_action happy path: converges, closes thread, emits thread_convergence_finalized", async () => {
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
    // Mission-24 Phase 2 (M24-T3): the finalized event carries the full
    // ConvergenceReport; the legacy two-event split is gone.
    const finalized = (archCtx as any).dispatchedEvents.find((e: any) => e.event === "thread_convergence_finalized");
    expect(finalized).toBeDefined();
    expect(finalized.data.committedActionCount).toBe(1);
    expect(finalized.data.executedCount).toBe(1);
    expect(finalized.data.failedCount).toBe(0);
    expect(finalized.data.warning).toBe(false);
    expect(finalized.data.report).toHaveLength(1);
    expect(finalized.data.report[0].status).toBe("executed");
    expect(finalized.data.report[0].type).toBe("close_no_action");
    // Legacy event names are no longer emitted.
    expect((archCtx as any).dispatchedEvents.find((e: any) => e.event === "thread_converged")).toBeUndefined();
    expect((archCtx as any).dispatchedEvents.find((e: any) => e.event === "thread_convergence_completed")).toBeUndefined();
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
    await router.handle("create_thread", { routingMode: "broadcast",title: "T", message: "M" }, eng1Ctx);
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

  // ADR-016 INV-TH27: deleted the "reply dispatch falls back to role
  // when no participant has a resolved agentId" test — the behavior
  // it asserted (silent role-broadcast on unresolved participants) is
  // now an invariant violation that throws loudly. See the reply-path
  // throw in thread-policy.ts createThreadReply.
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

  // ADR-016 INV-TH27 removed the pre-M18 legacy-participant test.
  // Every M-Cascade-Perfection thread has resolved agentIds; there is
  // no "null agentId participant" scenario to exclude from the reaper.

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

// ── Mission-24 Phase 2 (M24-T2, INV-TH18): routingMode enforcement ───

describe("ThreadPolicy — routingMode enforcement (M24-T2)", () => {
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
    await reg.registerAgent("s-arch", "architect", { globalInstanceId: "inst-arch", role: "architect", clientMetadata: client });
    const eng1Reg = await reg.registerAgent("s-eng-1", "engineer", { globalInstanceId: "inst-eng-1", role: "engineer", clientMetadata: client });
    const eng2Reg = await reg.registerAgent("s-eng-2", "engineer", { globalInstanceId: "inst-eng-2", role: "engineer", clientMetadata: client });
    if (eng1Reg.ok) eng1Id = eng1Reg.engineerId;
    if (eng2Reg.ok) eng2Id = eng2Reg.engineerId;
  });

  // ── Open-time validation ──────────────────────────────────────

  it("omitted routingMode defaults to unicast; requires recipientAgentId (ADR-016 INV-TH28)", async () => {
    // Without recipientAgentId → rejected by validator
    const rBad = await router.handle("create_thread", { title: "t", message: "m" }, eng1Ctx);
    expect(rBad.isError).toBe(true);
    expect(JSON.parse(rBad.content[0].text).error).toMatch(/unicast.*requires recipientAgentId/);

    // With recipientAgentId → accepted; stored routingMode is unicast
    const rOk = await router.handle("create_thread", {
      title: "t", message: "m", recipientAgentId: eng2Id,
    }, eng1Ctx);
    expect(rOk.isError).toBeUndefined();
    const threadId = JSON.parse(rOk.content[0].text).threadId;
    const t = (await router.handle("get_thread", { threadId }, eng1Ctx)).content[0].text;
    expect(JSON.parse(t).routingMode).toBe("unicast");
  });

  it("targeted with recipientAgentId stores routingMode=targeted", async () => {
    const r = await router.handle("create_thread", {
      title: "t", message: "m", routingMode: "unicast", recipientAgentId: eng2Id,
    }, eng1Ctx);
    expect(r.isError).toBeUndefined();
    const parsed = JSON.parse(r.content[0].text);
    const thread = JSON.parse((await router.handle("get_thread", { threadId: parsed.threadId }, eng1Ctx)).content[0].text);
    expect(thread.routingMode).toBe("unicast");
    expect(thread.context).toBeNull();
  });

  it("rejects unicast with context set (unicast doesn't carry multicast-only context)", async () => {
    const r = await router.handle("create_thread", {
      title: "t", message: "m", routingMode: "unicast",
      recipientAgentId: eng2Id, // needed to reach the context-check
      context: { entityType: "task", entityId: "task-1" },
    }, eng1Ctx);
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text).error).toMatch(/unicast.*must not set context/);
  });

  it("broadcast stores routingMode=broadcast without recipient pin", async () => {
    const r = await router.handle("create_thread", {
      title: "broadcast", message: "anyone in billing?",
      routingMode: "broadcast",
    }, archCtx);
    expect(r.isError).toBeUndefined();
    const thread = JSON.parse((await router.handle("get_thread", { threadId: JSON.parse(r.content[0].text).threadId }, archCtx)).content[0].text);
    expect(thread.routingMode).toBe("broadcast");
    expect(thread.recipientAgentId).toBeNull();
  });

  it("rejects broadcast with recipientAgentId (contradicts pool-discovery)", async () => {
    const r = await router.handle("create_thread", {
      title: "t", message: "m", routingMode: "broadcast", recipientAgentId: eng1Id,
    }, archCtx);
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text).error).toMatch(/broadcast.*must not set recipientAgentId/);
  });

  it("rejects broadcast with context set", async () => {
    const r = await router.handle("create_thread", {
      title: "t", message: "m", routingMode: "broadcast",
      context: { entityType: "task", entityId: "task-1" },
    }, archCtx);
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text).error).toMatch(/broadcast.*must not set context/);
  });

  it("context_bound with valid context stores mode + context", async () => {
    const r = await router.handle("create_thread", {
      title: "t", message: "m", routingMode: "multicast",
      context: { entityType: "task", entityId: "task-42" },
    }, eng1Ctx);
    expect(r.isError).toBeUndefined();
    const thread = JSON.parse((await router.handle("get_thread", { threadId: JSON.parse(r.content[0].text).threadId }, eng1Ctx)).content[0].text);
    expect(thread.routingMode).toBe("multicast");
    expect(thread.context).toEqual({ entityType: "task", entityId: "task-42" });
  });

  it("rejects context_bound without context", async () => {
    const r = await router.handle("create_thread", {
      title: "t", message: "m", routingMode: "multicast",
    }, eng1Ctx);
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text).error).toMatch(/multicast.*requires context/);
  });

  it("rejects context_bound with recipientAgentId", async () => {
    const r = await router.handle("create_thread", {
      title: "t", message: "m", routingMode: "multicast",
      context: { entityType: "task", entityId: "task-1" },
      recipientAgentId: eng2Id,
    }, eng1Ctx);
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text).error).toMatch(/multicast.*must not set recipientAgentId/);
  });

  it("rejects context_bound with empty-string entityType", async () => {
    const r = await router.handle("create_thread", {
      title: "t", message: "m", routingMode: "multicast",
      context: { entityType: "", entityId: "x" },
    }, eng1Ctx);
    expect(r.isError).toBe(true);
  });

  // ── Immutability + coercion ───────────────────────────────────

  it("broadcast coerces to targeted on first reply", async () => {
    const openResult = await router.handle("create_thread", {
      title: "broadcast", message: "anyone?",
      routingMode: "broadcast",
    }, archCtx);
    const threadId = JSON.parse(openResult.content[0].text).threadId;
    // Verify it stored as broadcast pre-reply
    const before = JSON.parse((await router.handle("get_thread", { threadId }, archCtx)).content[0].text);
    expect(before.routingMode).toBe("broadcast");

    // First reply from an engineer coerces broadcast → targeted
    await router.handle("create_thread_reply", { threadId, message: "I'll take it" }, eng1Ctx);

    const after = JSON.parse((await router.handle("get_thread", { threadId }, archCtx)).content[0].text);
    expect(after.routingMode).toBe("unicast");
    // Participants now include both parties; currentTurnAgentId pins the turn.
    expect(after.participants.length).toBe(2);
  });

  it("targeted routingMode is immutable across replies", async () => {
    const openResult = await router.handle("create_thread", {
      title: "pinned", message: "m", routingMode: "unicast", recipientAgentId: eng2Id,
    }, eng1Ctx);
    const threadId = JSON.parse(openResult.content[0].text).threadId;

    await router.handle("create_thread_reply", { threadId, message: "r1" }, eng2Ctx);
    await router.handle("create_thread_reply", { threadId, message: "r2" }, eng1Ctx);
    await router.handle("create_thread_reply", { threadId, message: "r3" }, eng2Ctx);

    const t = JSON.parse((await router.handle("get_thread", { threadId }, eng1Ctx)).content[0].text);
    expect(t.routingMode).toBe("unicast");
  });

  it("context_bound routingMode is immutable across replies", async () => {
    const openResult = await router.handle("create_thread", {
      title: "ctx", message: "m", routingMode: "multicast",
      context: { entityType: "task", entityId: "task-1" },
    }, eng1Ctx);
    const threadId = JSON.parse(openResult.content[0].text).threadId;

    await router.handle("create_thread_reply", { threadId, message: "r1" }, archCtx);

    const t = JSON.parse((await router.handle("get_thread", { threadId }, eng1Ctx)).content[0].text);
    expect(t.routingMode).toBe("multicast");
    expect(t.context).toEqual({ entityType: "task", entityId: "task-1" });
  });
});

// ── Mission-24 Phase 2 (M24-T4, INV-TH19): validate-then-execute ─────

describe("ThreadPolicy — cascade infrastructure (M24-T4)", () => {
  let router: PolicyRouter;
  let archCtx: IPolicyContext;
  let engCtx: IPolicyContext;
  let eng2Ctx: IPolicyContext;

  beforeEach(async () => {
    router = new PolicyRouter(noop);
    registerThreadPolicy(router);

    archCtx = createTestContext({ role: "architect", sessionId: "s-arch" });
    engCtx = createTestContext({ stores: archCtx.stores, role: "engineer", sessionId: "s-eng-1" });
    eng2Ctx = createTestContext({ stores: archCtx.stores, role: "engineer", sessionId: "s-eng-2" });
    archCtx.stores.engineerRegistry.setSessionRole("s-arch", "architect");
    await archCtx.stores.engineerRegistry.registerAgent("s-arch", "architect" as any, {
      globalInstanceId: `test-gid-${"s-arch"}`,
      role: "architect" as any,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    });
    archCtx.stores.engineerRegistry.setSessionRole("s-eng-1", "engineer");
    await archCtx.stores.engineerRegistry.registerAgent("s-eng-1", "engineer" as any, {
      globalInstanceId: `test-gid-${"s-eng-1"}`,
      role: "engineer" as any,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    });
    archCtx.stores.engineerRegistry.setSessionRole("s-eng-2", "engineer");
    await archCtx.stores.engineerRegistry.registerAgent("s-eng-2", "engineer" as any, {
      globalInstanceId: `test-gid-${"s-eng-2"}`,
      role: "engineer" as any,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    });
  });

  /** Open a thread, then reach the bilateral-convergence precondition
   * (engineer stages a close_no_action + authors summary, architect
   * has NOT yet converged). Caller finishes by calling architect's
   * converge on the returned threadId. */
  async function stageForConvergence(options: {
    stagedActions?: Array<Record<string, unknown>>;
    summary?: string;
  } = {}): Promise<string> {
    const r = await router.handle("create_thread", { routingMode: "broadcast",title: "t", message: "m" }, archCtx);
    const threadId = JSON.parse(r.content[0].text).threadId;
    await router.handle("create_thread_reply", {
      threadId,
      message: "agreed",
      converged: true,
      summary: options.summary ?? "Agreed.",
      stagedActions: options.stagedActions ?? [
        { kind: "stage", type: "close_no_action", payload: { reason: "done" } },
      ],
    }, engCtx);
    return threadId;
  }

  // ── Validate phase ────────────────────────────────────────────

  it("validate phase accepts well-formed close_no_action payload", async () => {
    const threadId = await stageForConvergence();
    const r = await router.handle("create_thread_reply", {
      threadId, message: "confirmed", converged: true,
    }, archCtx);
    expect(r.isError).toBeUndefined();
    const parsed = JSON.parse(r.content[0].text);
    expect(["converged", "closed"]).toContain(parsed.status);
  });

  it("validate phase rejects convergence when a staged payload is structurally invalid (direct store injection)", async () => {
    // Simulate an in-store thread whose staged payload was valid when
    // accepted by an older tool schema but is no longer well-formed
    // against the current Zod validator. The gate's
    // validateStagedActions() catches it before promoting to committed.
    const r = await router.handle("create_thread", { routingMode: "broadcast",title: "t", message: "m" }, archCtx);
    const threadId = JSON.parse(r.content[0].text).threadId;
    // Engineer stages valid close_no_action + converges (round 2)
    await router.handle("create_thread_reply", {
      threadId, message: "agreed", converged: true,
      summary: "Agreed; closing.",
      stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "ok" } }],
    }, engCtx);

    // Poison the staged payload so validate phase fires at the gate.
    const store = archCtx.stores.thread as any;
    const poisoned = store.threads.get(threadId);
    poisoned.convergenceActions[0].payload = {}; // drop `reason`

    // Architect converges (round 3) → gate runs validate → rejects.
    const badConverge = await router.handle("create_thread_reply", {
      threadId, message: "arch converge", converged: true,
    }, archCtx);
    expect(badConverge.isError).toBe(true);
    const parsed = JSON.parse(badConverge.content[0].text);
    expect(parsed.error).toMatch(/staged action validation failed/);
    expect(parsed.error).toMatch(/reason/);

    // Thread did NOT transition; staged action stays staged.
    const final = JSON.parse((await router.handle("get_thread", { threadId }, archCtx)).content[0].text);
    expect(final.status).toBe("active");
    expect(final.convergenceActions[0].status).toBe("staged");
  });

  // ── Execute phase + ConvergenceReport ────────────────────────

  it("execute phase produces a ConvergenceReport entry per committed action", async () => {
    const threadId = await stageForConvergence();
    await router.handle("create_thread_reply", {
      threadId, message: "confirmed", converged: true,
    }, archCtx);

    const finalized = (archCtx as any).dispatchedEvents.find((e: any) => e.event === "thread_convergence_finalized");
    expect(finalized).toBeDefined();
    expect(finalized.data.report).toHaveLength(1);
    expect(finalized.data.report[0].actionId).toBe("action-1");
    expect(finalized.data.report[0].type).toBe("close_no_action");
    expect(finalized.data.report[0].status).toBe("executed");
  });

  it("execute phase with all-success transitions thread to closed, not cascade_failed", async () => {
    const threadId = await stageForConvergence();
    await router.handle("create_thread_reply", {
      threadId, message: "confirmed", converged: true,
    }, archCtx);

    const final = JSON.parse((await router.handle("get_thread", { threadId }, archCtx)).content[0].text);
    expect(final.status).toBe("closed");
    expect(final.status).not.toBe("cascade_failed");

    const finalized = (archCtx as any).dispatchedEvents.find((e: any) => e.event === "thread_convergence_finalized");
    expect(finalized.data.threadTerminal).toBe("closed");
    expect(finalized.data.warning).toBe(false);
  });

  it("markCascadeFailed transitions converged → cascade_failed", async () => {
    // Open + get to converged, then directly invoke markCascadeFailed
    // and verify the FSM transition. Exercises the store primitive that
    // runCascade calls when any handler fails.
    const threadId = await stageForConvergence();
    await router.handle("create_thread_reply", {
      threadId, message: "confirmed", converged: true,
    }, archCtx);
    // The happy path closed the thread — force it back to converged
    // via direct store mutation so we can test the primitive.
    const store = archCtx.stores.thread as any;
    store.threads.get(threadId).status = "converged";
    const ok = await archCtx.stores.thread.markCascadeFailed(threadId);
    expect(ok).toBe(true);
    const final = JSON.parse((await router.handle("get_thread", { threadId }, archCtx)).content[0].text);
    expect(final.status).toBe("cascade_failed");
  });

  it("markCascadeFailed returns false for non-converged threads", async () => {
    // Open an active thread; it's not eligible for cascade_failed
    // transition from the closed-state perspective. Method accepts
    // {active, converged} to allow late failure detection.
    const r = await router.handle("create_thread", { routingMode: "broadcast",title: "t", message: "m" }, archCtx);
    const threadId = JSON.parse(r.content[0].text).threadId;
    // Active thread — allowed
    const okActive = await archCtx.stores.thread.markCascadeFailed(threadId);
    expect(okActive).toBe(true);
    // Now cascade_failed — further transitions rejected
    const rejectFromTerminal = await archCtx.stores.thread.markCascadeFailed(threadId);
    expect(rejectFromTerminal).toBe(false);
  });

  it("markCascadeFailed returns false for non-existent threadId", async () => {
    const ok = await archCtx.stores.thread.markCascadeFailed("thread-does-not-exist");
    expect(ok).toBe(false);
  });

  // ── Direct runCascade exercise (unit-test the infrastructure) ──

  it("runCascade with unknown action type yields failed report entry", async () => {
    const { runCascade } = await import("../src/policy/cascade.js");
    const threadId = await stageForConvergence();
    const thread = await archCtx.stores.thread.getThread(threadId);
    const fakeActions = [
      {
        id: "action-99", type: "imaginary_type" as any, status: "committed" as const,
        proposer: { role: "engineer" as const, agentId: null }, timestamp: "2026-04-18T00:00:00.000Z",
        payload: {},
      },
    ];
    const result = await runCascade(archCtx, thread!, fakeActions as any, "test summary");
    expect(result.report).toHaveLength(1);
    expect(result.report[0].status).toBe("failed");
    // Phase 1 of M-Cascade-Perfection renamed the registry — message
    // reflects "ActionSpec" rather than "cascade handler".
    expect(result.report[0].error).toMatch(/no ActionSpec registered/);
    expect(result.anyFailure).toBe(true);
  });

  it("runCascade mixes executed + failed entries into the same report", async () => {
    const { runCascade } = await import("../src/policy/cascade.js");
    const threadId = await stageForConvergence();
    const thread = await archCtx.stores.thread.getThread(threadId);
    const actions = [
      {
        id: "action-1", type: "close_no_action" as const, status: "committed" as const,
        proposer: { role: "engineer" as const, agentId: null }, timestamp: "2026-04-18T00:00:00.000Z",
        payload: { reason: "valid" },
      },
      {
        id: "action-2", type: "unknown" as any, status: "committed" as const,
        proposer: { role: "engineer" as const, agentId: null }, timestamp: "2026-04-18T00:00:00.000Z",
        payload: {},
      },
    ];
    const result = await runCascade(archCtx, thread!, actions as any, "s");
    expect(result.executedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.anyFailure).toBe(true);
    expect(result.report.map((r: any) => r.status)).toEqual(["executed", "failed"]);
  });

  it("registerActionSpec + getActionSpec round-trip", async () => {
    // Phase 1 of M-Cascade-Perfection: the procedural CascadeHandler
    // API was deleted in favour of the declarative ActionSpec registry.
    // This test asserts spec round-trip rather than handler round-trip.
    const { registerActionSpec, getActionSpec } = await import("../src/policy/cascade-spec.js");
    const { z } = await import("zod");
    const before = getActionSpec("create_clarification");
    const probe = {
      type: "create_clarification" as const,
      kind: "audit_only" as const,
      payloadSchema: z.object({ question: z.string(), context: z.string() }),
      auditAction: "test_audit",
      execute: async () => null,
    };
    registerActionSpec(probe);
    expect(getActionSpec("create_clarification")).toBe(probe);
    // Restore
    if (before) registerActionSpec(before);
  });

  it("cascadeIdempotencyKey returns {sourceThreadId, sourceActionId}", async () => {
    const { cascadeIdempotencyKey } = await import("../src/policy/cascade.js");
    const threadId = await stageForConvergence();
    const thread = await archCtx.stores.thread.getThread(threadId);
    const action = thread!.convergenceActions[0];
    const key = cascadeIdempotencyKey(thread!, action);
    expect(key.sourceThreadId).toBe(thread!.id);
    expect(key.sourceActionId).toBe(action.id);
  });
});

// ── Mission-24 Phase 2 (M24-T5): per-action cascade handlers ─────────

describe("ThreadPolicy — cascade handlers (M24-T5)", () => {
  let router: PolicyRouter;
  let archCtx: IPolicyContext;
  let engCtx: IPolicyContext;

  beforeEach(async () => {
    // Import registers all 3 handlers as a side effect.
    await import("../src/policy/cascade-actions/index.js");
    router = new PolicyRouter(noop);
    registerThreadPolicy(router);

    archCtx = createTestContext({ role: "architect", sessionId: "s-arch" });
    engCtx = createTestContext({ stores: archCtx.stores, role: "engineer", sessionId: "s-eng-1" });
    archCtx.stores.engineerRegistry.setSessionRole("s-arch", "architect");
    await archCtx.stores.engineerRegistry.registerAgent("s-arch", "architect" as any, {
      globalInstanceId: `test-gid-${"s-arch"}`,
      role: "architect" as any,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    });
    archCtx.stores.engineerRegistry.setSessionRole("s-eng-1", "engineer");
    await archCtx.stores.engineerRegistry.registerAgent("s-eng-1", "engineer" as any, {
      globalInstanceId: `test-gid-${"s-eng-1"}`,
      role: "engineer" as any,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    });
  });

  /** Open thread → engineer converge staging the given action → caller
   * finishes via architect converge. Returns threadId. */
  async function spawnViaConvergence(stagedAction: Record<string, unknown>, summary = "Agreed; proceed."): Promise<string> {
    const r = await router.handle("create_thread", { routingMode: "broadcast",title: "t", message: "m" }, archCtx);
    const threadId = JSON.parse(r.content[0].text).threadId;
    await router.handle("create_thread_reply", {
      threadId, message: "agree", converged: true, summary, stagedActions: [stagedAction],
    }, engCtx);
    // Poison the action.type in the gate's Zod schema? No — we run by
    // injecting the committed action post-gate via the test hook below.
    return threadId;
  }

  /** Bypass the tool-surface Zod narrow schema (Phase 1: only
   * close_no_action) by staging via direct store mutation. The gate's
   * validateStagedActions() still runs against the Phase 2 payload
   * schema registry, so payloads must be valid Phase 2 shapes. */
  function injectStagedAction(threadId: string, type: string, payload: Record<string, unknown>, ctx: IPolicyContext): void {
    const store = ctx.stores.thread as any;
    const t = store.threads.get(threadId);
    const id = `action-${t.convergenceActions.length + 1}`;
    t.convergenceActions.push({
      id, type, status: "staged",
      proposer: { role: "engineer", agentId: null },
      timestamp: new Date().toISOString(),
      payload,
    });
  }

  /** Minimal convergence flow using direct-injection for staging: arch
   * opens, eng replies (no stage, converged=true; gate needs a staged
   * action, so inject first), then arch converges. */
  async function convergeWithInjectedAction(type: string, payload: Record<string, unknown>, summary: string): Promise<string> {
    const r = await router.handle("create_thread", { routingMode: "broadcast",title: "t", message: "m" }, archCtx);
    const threadId = JSON.parse(r.content[0].text).threadId;
    // Stage via direct injection BEFORE the eng converge reply.
    await router.handle("create_thread_reply", { threadId, message: "stage" }, engCtx);
    injectStagedAction(threadId, type, payload, archCtx);
    // eng converges (round 3). Summary set via message param path.
    await router.handle("create_thread_reply", {
      threadId, message: "arch-round", summary,
    }, archCtx);
    await router.handle("create_thread_reply", {
      threadId, message: "eng-converge", converged: true,
    }, engCtx);
    // arch converges to seal.
    await router.handle("create_thread_reply", {
      threadId, message: "arch-converge", converged: true,
    }, archCtx);
    return threadId;
  }

  // ── create_task ──────────────────────────────────────────────

  it("create_task handler spawns a Task with back-link metadata", async () => {
    const threadId = await convergeWithInjectedAction(
      "create_task",
      { title: "Spawned", description: "Do the thing" },
      "Engineer and architect agreed a task is needed.",
    );

    // Find the spawned task
    const tasks = await archCtx.stores.task.listTasks();
    const spawned = tasks.find((t) => t.sourceThreadId === threadId);
    expect(spawned).toBeDefined();
    expect(spawned!.title).toBe("Spawned");
    expect(spawned!.directive).toBe("Do the thing");
    expect(spawned!.sourceActionId).toBeTruthy();
    expect(spawned!.sourceThreadSummary).toMatch(/agreed a task/i);

    // Finalized event has report entry naming the task's entityId
    const finalized = (archCtx as any).dispatchedEvents.find((e: any) => e.event === "thread_convergence_finalized");
    expect(finalized.data.report.some((r: any) => r.type === "create_task" && r.entityId === spawned!.id && r.status === "executed")).toBe(true);
  });

  it("create_task handler is idempotent on re-run (skipped_idempotent)", async () => {
    const { runCascade } = await import("../src/policy/cascade.js");
    const threadId = await convergeWithInjectedAction(
      "create_task",
      { title: "Once", description: "only once" },
      "Spawn once.",
    );

    const thread = await archCtx.stores.thread.getThread(threadId);
    const action = thread!.convergenceActions.find((a: any) => a.type === "create_task")!;
    // Re-run cascade against the same thread+action pair.
    const result = await runCascade(archCtx, thread!, [action as any], "Spawn once.");
    expect(result.report[0].status).toBe("skipped_idempotent");
    expect(result.skippedCount).toBe(1);
    expect(result.anyFailure).toBe(false);

    // Only one task spawned total
    const tasks = await archCtx.stores.task.listTasks();
    expect(tasks.filter((t) => t.sourceThreadId === threadId)).toHaveLength(1);

    // Audit trail records the idempotency skip
    const audits = await archCtx.stores.audit.listEntries(50);
    expect(audits.some((a) => a.action === "action_already_executed" && a.details.includes(thread!.id))).toBe(true);
  });

  // ── create_proposal ──────────────────────────────────────────

  it("create_proposal handler spawns a Proposal with back-link metadata", async () => {
    const threadId = await convergeWithInjectedAction(
      "create_proposal",
      { title: "Proposal title", description: "Full proposal body text" },
      "Converged on drafting a proposal.",
    );

    const proposals = await archCtx.stores.proposal.getProposals();
    const spawned = proposals.find((p) => p.sourceThreadId === threadId);
    expect(spawned).toBeDefined();
    expect(spawned!.title).toBe("Proposal title");
    expect(spawned!.summary).toBe("Full proposal body text");
    expect(spawned!.sourceThreadSummary).toMatch(/drafting a proposal/i);

    const finalized = (archCtx as any).dispatchedEvents.find((e: any) => e.event === "thread_convergence_finalized");
    expect(finalized.data.report.some((r: any) => r.type === "create_proposal" && r.entityId === spawned!.id && r.status === "executed")).toBe(true);
  });

  it("create_proposal handler is idempotent on re-run", async () => {
    const { runCascade } = await import("../src/policy/cascade.js");
    const threadId = await convergeWithInjectedAction(
      "create_proposal",
      { title: "P1", description: "body" },
      "Draft once.",
    );
    const thread = await archCtx.stores.thread.getThread(threadId);
    const action = thread!.convergenceActions.find((a: any) => a.type === "create_proposal")!;

    const result = await runCascade(archCtx, thread!, [action as any], "Draft once.");
    expect(result.report[0].status).toBe("skipped_idempotent");
    expect(result.skippedCount).toBe(1);

    const proposals = await archCtx.stores.proposal.getProposals();
    expect(proposals.filter((p) => p.sourceThreadId === threadId)).toHaveLength(1);
  });

  // ── create_idea ──────────────────────────────────────────────

  it("create_idea handler spawns an Idea with back-link metadata", async () => {
    const threadId = await convergeWithInjectedAction(
      "create_idea",
      { title: "Idea title", description: "Body of the idea", tags: ["exploration", "followup"] },
      "Captured idea for future exploration.",
    );

    const ideas = await archCtx.stores.idea.listIdeas();
    const spawned = ideas.find((i) => i.sourceThreadId === threadId);
    expect(spawned).toBeDefined();
    expect(spawned!.text).toContain("Idea title");
    expect(spawned!.text).toContain("Body of the idea");
    expect(spawned!.tags).toEqual(["exploration", "followup"]);
    expect(spawned!.sourceActionId).toBeTruthy();
    expect(spawned!.sourceThreadSummary).toMatch(/future exploration/i);

    const finalized = (archCtx as any).dispatchedEvents.find((e: any) => e.event === "thread_convergence_finalized");
    expect(finalized.data.report.some((r: any) => r.type === "create_idea" && r.entityId === spawned!.id && r.status === "executed")).toBe(true);
  });

  it("create_idea handler is idempotent on re-run", async () => {
    const { runCascade } = await import("../src/policy/cascade.js");
    const threadId = await convergeWithInjectedAction(
      "create_idea",
      { title: "IdeaX", description: "desc" },
      "Record once.",
    );
    const thread = await archCtx.stores.thread.getThread(threadId);
    const action = thread!.convergenceActions.find((a: any) => a.type === "create_idea")!;

    const result = await runCascade(archCtx, thread!, [action as any], "Record once.");
    expect(result.report[0].status).toBe("skipped_idempotent");

    const ideas = await archCtx.stores.idea.listIdeas();
    expect(ideas.filter((i) => i.sourceThreadId === threadId)).toHaveLength(1);
  });

  // ── Multi-action cascade ─────────────────────────────────────

  it("multiple committed actions of different types all spawn correctly", async () => {
    const r = await router.handle("create_thread", { routingMode: "broadcast",title: "multi", message: "m" }, archCtx);
    const threadId = JSON.parse(r.content[0].text).threadId;
    await router.handle("create_thread_reply", { threadId, message: "stage" }, engCtx);
    // Inject 2 actions of different types.
    injectStagedAction(threadId, "create_task", { title: "T1", description: "dt" }, archCtx);
    injectStagedAction(threadId, "create_idea", { title: "I1", description: "di" }, archCtx);
    await router.handle("create_thread_reply", { threadId, message: "arch", summary: "Multi-action test." }, archCtx);
    await router.handle("create_thread_reply", { threadId, message: "eng-converge", converged: true }, engCtx);
    await router.handle("create_thread_reply", { threadId, message: "arch-converge", converged: true }, archCtx);

    const finalized = (archCtx as any).dispatchedEvents.find((e: any) => e.event === "thread_convergence_finalized");
    expect(finalized.data.committedActionCount).toBe(2);
    expect(finalized.data.executedCount).toBe(2);
    expect(finalized.data.warning).toBe(false);

    const tasks = await archCtx.stores.task.listTasks();
    const ideas = await archCtx.stores.idea.listIdeas();
    expect(tasks.filter((t) => t.sourceThreadId === threadId)).toHaveLength(1);
    expect(ideas.filter((i) => i.sourceThreadId === threadId)).toHaveLength(1);
  });

  // ── Spawned-entity shape guards ──────────────────────────────

  it("spawned entities carry labels inherited from the thread", async () => {
    // Open with architect-authored labels via direct setting
    const r = await router.handle("create_thread", { routingMode: "broadcast",title: "lab", message: "m" }, archCtx);
    const threadId = JSON.parse(r.content[0].text).threadId;
    const store = archCtx.stores.thread as any;
    store.threads.get(threadId).labels = { team: "platform", env: "prod" };

    await router.handle("create_thread_reply", { threadId, message: "stage" }, engCtx);
    injectStagedAction(threadId, "create_task", { title: "T", description: "d" }, archCtx);
    await router.handle("create_thread_reply", { threadId, message: "arch", summary: "Label inheritance test." }, archCtx);
    await router.handle("create_thread_reply", { threadId, message: "e", converged: true }, engCtx);
    await router.handle("create_thread_reply", { threadId, message: "a", converged: true }, archCtx);

    const tasks = await archCtx.stores.task.listTasks();
    const spawned = tasks.find((t) => t.sourceThreadId === threadId);
    expect(spawned!.labels).toEqual({ team: "platform", env: "prod" });
  });

  // ── findByCascadeKey helpers ─────────────────────────────────

  it("findByCascadeKey returns the spawned entity for task/proposal/idea stores", async () => {
    const threadId = await convergeWithInjectedAction(
      "create_task",
      { title: "T", description: "d" },
      "s",
    );
    const thread = await archCtx.stores.thread.getThread(threadId);
    const action = thread!.convergenceActions.find((a: any) => a.type === "create_task")!;
    const key = { sourceThreadId: threadId, sourceActionId: action.id };

    const task = await archCtx.stores.task.findByCascadeKey(key);
    expect(task).toBeDefined();
    expect(task!.sourceThreadId).toBe(threadId);
    expect(task!.sourceActionId).toBe(action.id);

    // Unrelated key → null
    const missing = await archCtx.stores.task.findByCascadeKey({
      sourceThreadId: "thread-999", sourceActionId: "action-99",
    });
    expect(missing).toBeNull();
  });
});

// ── Mission-24 Phase 2 (M24-T9): update/propose/clarification handlers ──

describe("ThreadPolicy — cascade handlers part 2 (M24-T9)", () => {
  let router: PolicyRouter;
  let archCtx: IPolicyContext;
  let engCtx: IPolicyContext;

  beforeEach(async () => {
    await import("../src/policy/cascade-actions/index.js");
    router = new PolicyRouter(noop);
    registerThreadPolicy(router);

    archCtx = createTestContext({ role: "architect", sessionId: "s-arch" });
    engCtx = createTestContext({ stores: archCtx.stores, role: "engineer", sessionId: "s-eng-1" });
    archCtx.stores.engineerRegistry.setSessionRole("s-arch", "architect");
    await archCtx.stores.engineerRegistry.registerAgent("s-arch", "architect" as any, {
      globalInstanceId: `test-gid-${"s-arch"}`,
      role: "architect" as any,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    });
    archCtx.stores.engineerRegistry.setSessionRole("s-eng-1", "engineer");
    await archCtx.stores.engineerRegistry.registerAgent("s-eng-1", "engineer" as any, {
      globalInstanceId: `test-gid-${"s-eng-1"}`,
      role: "engineer" as any,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    });
  });

  function injectStagedAction(threadId: string, type: string, payload: Record<string, unknown>, ctx: IPolicyContext): void {
    const store = ctx.stores.thread as any;
    const t = store.threads.get(threadId);
    const id = `action-${t.convergenceActions.length + 1}`;
    t.convergenceActions.push({
      id, type, status: "staged",
      proposer: { role: "engineer", agentId: null },
      timestamp: new Date().toISOString(),
      payload,
    });
  }

  async function convergeWithInjectedAction(type: string, payload: Record<string, unknown>, summary: string): Promise<string> {
    const r = await router.handle("create_thread", { routingMode: "broadcast",title: "t", message: "m" }, archCtx);
    const threadId = JSON.parse(r.content[0].text).threadId;
    await router.handle("create_thread_reply", { threadId, message: "stage" }, engCtx);
    injectStagedAction(threadId, type, payload, archCtx);
    await router.handle("create_thread_reply", { threadId, message: "arch", summary }, archCtx);
    await router.handle("create_thread_reply", { threadId, message: "eng-c", converged: true }, engCtx);
    await router.handle("create_thread_reply", { threadId, message: "arch-c", converged: true }, archCtx);
    return threadId;
  }

  // ── update_idea ──────────────────────────────────────────────

  it("update_idea handler applies changes to an existing Idea", async () => {
    // Seed: create an idea first.
    const seeded = await archCtx.stores.idea.submitIdea("Seed idea", "user");
    const threadId = await convergeWithInjectedAction(
      "update_idea",
      { ideaId: seeded.id, changes: { status: "triaged", tags: ["reviewed"] } },
      "Promote the idea to triaged.",
    );

    const after = await archCtx.stores.idea.getIdea(seeded.id);
    expect(after!.status).toBe("triaged");
    expect(after!.tags).toEqual(["reviewed"]);

    const finalized = (archCtx as any).dispatchedEvents.find((e: any) => e.event === "thread_convergence_finalized");
    expect(finalized.data.report[0].status).toBe("executed");
    expect(finalized.data.report[0].entityId).toBe(seeded.id);

    const audits = await archCtx.stores.audit.listEntries(50);
    expect(audits.some((a) => a.action === "thread_update_idea" && a.relatedEntity === seeded.id)).toBe(true);
    // Thread terminal is closed (no failures).
    const final = JSON.parse((await router.handle("get_thread", { threadId }, archCtx)).content[0].text);
    expect(final.status).toBe("closed");
  });

  it("update_idea handler fails cleanly when ideaId does not exist", async () => {
    await convergeWithInjectedAction(
      "update_idea",
      { ideaId: "idea-missing", changes: { status: "dismissed" } },
      "Try to update a non-existent idea.",
    );

    const finalized = (archCtx as any).dispatchedEvents.find((e: any) => e.event === "thread_convergence_finalized");
    expect(finalized.data.report[0].status).toBe("failed");
    expect(finalized.data.report[0].error).toMatch(/not found/);
    expect(finalized.data.warning).toBe(true);
    expect(finalized.data.threadTerminal).toBe("cascade_failed");
  });

  it("update_idea handler drops unknown change keys and fails if nothing remains", async () => {
    const seeded = await archCtx.stores.idea.submitIdea("Seed", "user");
    await convergeWithInjectedAction(
      "update_idea",
      { ideaId: seeded.id, changes: { unknownField: "x" } },
      "Empty update.",
    );
    const finalized = (archCtx as any).dispatchedEvents.find((e: any) => e.event === "thread_convergence_finalized");
    expect(finalized.data.report[0].status).toBe("failed");
    expect(finalized.data.report[0].error).toMatch(/no updatable fields/);
  });

  // ── update_mission_status ────────────────────────────────────

  it("update_mission_status transitions proposed → active", async () => {
    const mission = await archCtx.stores.mission.createMission("M1", "Description");
    expect(mission.status).toBe("proposed");

    await convergeWithInjectedAction(
      "update_mission_status",
      { missionId: mission.id, status: "active" },
      "Activate mission.",
    );

    const after = await archCtx.stores.mission.getMission(mission.id);
    expect(after!.status).toBe("active");
    const finalized = (archCtx as any).dispatchedEvents.find((e: any) => e.event === "thread_convergence_finalized");
    expect(finalized.data.report[0].status).toBe("executed");
  });

  it("update_mission_status rejects an invalid transition", async () => {
    const mission = await archCtx.stores.mission.createMission("M2", "Description");
    // Already at "proposed"; cannot go directly to "completed" per FSM.
    await convergeWithInjectedAction(
      "update_mission_status",
      { missionId: mission.id, status: "completed" },
      "Invalid direct transition.",
    );

    const finalized = (archCtx as any).dispatchedEvents.find((e: any) => e.event === "thread_convergence_finalized");
    expect(finalized.data.report[0].status).toBe("failed");
    expect(finalized.data.report[0].error).toMatch(/invalid transition/);
    expect(finalized.data.threadTerminal).toBe("cascade_failed");
  });

  it("update_mission_status rejects unknown status values", async () => {
    const mission = await archCtx.stores.mission.createMission("M3", "Description");
    await convergeWithInjectedAction(
      "update_mission_status",
      { missionId: mission.id, status: "frozen" as any },
      "Bogus status.",
    );
    const finalized = (archCtx as any).dispatchedEvents.find((e: any) => e.event === "thread_convergence_finalized");
    expect(finalized.data.report[0].status).toBe("failed");
    expect(finalized.data.report[0].error).toMatch(/invalid mission status/);
  });

  it("update_mission_status is idempotent when already at target", async () => {
    const mission = await archCtx.stores.mission.createMission("M4", "Description");
    // Fast-forward to active.
    await archCtx.stores.mission.updateMission(mission.id, { status: "active" });
    // Cascade redundantly sets active.
    await convergeWithInjectedAction(
      "update_mission_status",
      { missionId: mission.id, status: "active" },
      "Redundant activate.",
    );
    const finalized = (archCtx as any).dispatchedEvents.find((e: any) => e.event === "thread_convergence_finalized");
    expect(finalized.data.report[0].status).toBe("skipped_idempotent");
    expect(finalized.data.warning).toBe(false);
    expect(finalized.data.threadTerminal).toBe("closed");
  });

  // ── propose_mission ──────────────────────────────────────────

  it("propose_mission spawns a Mission in proposed status with back-links", async () => {
    const threadId = await convergeWithInjectedAction(
      "propose_mission",
      { title: "Proposed Mission", description: "Body", goals: ["G1", "G2"] },
      "Draft a new mission.",
    );

    const missions = await archCtx.stores.mission.listMissions();
    const spawned = missions.find((m) => m.sourceThreadId === threadId);
    expect(spawned).toBeDefined();
    expect(spawned!.status).toBe("proposed");
    expect(spawned!.title).toBe("Proposed Mission");
    expect(spawned!.description).toContain("G1");
    expect(spawned!.description).toContain("G2");
    expect(spawned!.sourceActionId).toBeTruthy();
    expect(spawned!.sourceThreadSummary).toMatch(/Draft a new mission/i);
  });

  it("propose_mission is idempotent on re-run", async () => {
    const { runCascade } = await import("../src/policy/cascade.js");
    const threadId = await convergeWithInjectedAction(
      "propose_mission",
      { title: "Once", description: "D", goals: [] },
      "Propose once.",
    );
    const thread = await archCtx.stores.thread.getThread(threadId);
    const action = thread!.convergenceActions.find((a: any) => a.type === "propose_mission")!;

    const result = await runCascade(archCtx, thread!, [action as any], "Propose once.");
    expect(result.report[0].status).toBe("skipped_idempotent");
    const missions = await archCtx.stores.mission.listMissions();
    expect(missions.filter((m) => m.sourceThreadId === threadId)).toHaveLength(1);
  });

  // ── create_clarification ─────────────────────────────────────

  it("create_clarification writes an audit entry (no spawned entity)", async () => {
    const threadId = await convergeWithInjectedAction(
      "create_clarification",
      { question: "Which schema do we target?", context: "Migration alignment needed." },
      "Raise a clarification for Director review.",
    );

    const audits = await archCtx.stores.audit.listEntries(50);
    const entry = audits.find((a) => a.action === "thread_create_clarification" && a.relatedEntity === threadId);
    expect(entry).toBeDefined();
    expect(entry!.details).toContain("Which schema do we target?");
    expect(entry!.details).toContain("Migration alignment needed.");

    const finalized = (archCtx as any).dispatchedEvents.find((e: any) => e.event === "thread_convergence_finalized");
    expect(finalized.data.report[0].status).toBe("executed");
    expect(finalized.data.report[0].entityId).toBeNull();
    expect(finalized.data.threadTerminal).toBe("closed");
  });
});

// ── Mission-24 Phase 2 invariant coverage (M24-T11, ADR-014) ─────────

describe("Phase 2 invariants (M24-T11)", () => {
  let router: PolicyRouter;
  let archCtx: IPolicyContext;
  let engCtx: IPolicyContext;
  let archId: string;
  let engId: string;

  beforeEach(async () => {
    await import("../src/policy/cascade-actions/index.js");
    router = new PolicyRouter(noop);
    registerThreadPolicy(router);

    archCtx = createTestContext({ role: "architect", sessionId: "s-arch" });
    engCtx = createTestContext({ stores: archCtx.stores, role: "engineer", sessionId: "s-eng" });

    const reg = archCtx.stores.engineerRegistry;
    const client = { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" };
    const archReg = await reg.registerAgent("s-arch", "architect", { globalInstanceId: "arch-i", role: "architect", clientMetadata: client });
    const engReg = await reg.registerAgent("s-eng", "engineer", { globalInstanceId: "eng-i", role: "engineer", clientMetadata: client });
    if (archReg.ok) archId = archReg.engineerId;
    if (engReg.ok) engId = engReg.engineerId;
  });

  // ── INV-TH22: StagedAction.proposer carries {role, agentId} ──

  it("INV-TH22: staged actions record proposer as {role, agentId}, not bare role", async () => {
    const r = await router.handle("create_thread", { routingMode: "broadcast",title: "t", message: "m" }, archCtx);
    const threadId = JSON.parse(r.content[0].text).threadId;
    await router.handle("create_thread_reply", {
      threadId, message: "stage",
      stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "done" } }],
    }, engCtx);

    const t = JSON.parse((await router.handle("get_thread", { threadId }, archCtx)).content[0].text);
    const action = t.convergenceActions[0];
    expect(action.proposer).toBeDefined();
    expect(typeof action.proposer).toBe("object");
    expect(action.proposer.role).toBe("engineer");
    expect(action.proposer.agentId).toBe(engId);
    // Bare-role proposer is rejected by the schema — shape must be object.
    expect(typeof action.proposer).not.toBe("string");
  });

  it("INV-TH22: revise op carries the revising party's proposer, not the original", async () => {
    const r = await router.handle("create_thread", { routingMode: "broadcast",title: "t", message: "m" }, archCtx);
    const threadId = JSON.parse(r.content[0].text).threadId;
    // Engineer stages
    await router.handle("create_thread_reply", {
      threadId, message: "stage",
      stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "v1" } }],
    }, engCtx);
    // Architect revises
    await router.handle("create_thread_reply", {
      threadId, message: "revise",
      stagedActions: [{ kind: "revise", id: "action-1", payload: { reason: "v2" } }],
    }, archCtx);

    const t = JSON.parse((await router.handle("get_thread", { threadId }, archCtx)).content[0].text);
    const action2 = t.convergenceActions.find((a: any) => a.id === "action-2");
    expect(action2).toBeDefined();
    expect(action2.proposer.role).toBe("architect");
    expect(action2.proposer.agentId).toBe(archId);
    // Original (now revised) still pinned to engineer.
    const action1 = t.convergenceActions.find((a: any) => a.id === "action-1");
    expect(action1.proposer.role).toBe("engineer");
  });

  // ── INV-TH23: Summary-as-Living-Record ──────────────────────

  it("INV-TH23: sourceThreadSummary on spawned entities is frozen at commit (not later summary mutations)", async () => {
    const r = await router.handle("create_thread", { routingMode: "broadcast",title: "t", message: "m" }, archCtx);
    const threadId = JSON.parse(r.content[0].text).threadId;
    // Engineer stages + converges with the "commit" summary.
    await router.handle("create_thread_reply", {
      threadId, message: "s",
      converged: true,
      summary: "COMMIT-TIME SUMMARY",
      stagedActions: [{
        kind: "stage", type: "create_task",
        payload: { title: "T", description: "d" },
      }],
    }, engCtx);
    // Architect converges → gate promotes + cascade executes immediately.
    await router.handle("create_thread_reply", { threadId, message: "go", converged: true }, archCtx);

    // Find the spawned task — sourceThreadSummary should reflect what
    // the commit saw. (Thread is now closed; subsequent direct summary
    // mutation on the thread record does NOT propagate to the entity.)
    const tasks = await archCtx.stores.task.listTasks();
    const spawned = tasks.find((t) => t.sourceThreadId === threadId);
    expect(spawned).toBeDefined();
    expect(spawned!.sourceThreadSummary).toBe("COMMIT-TIME SUMMARY");

    // Mutate the thread's summary post-commit
    const store = archCtx.stores.thread as any;
    store.threads.get(threadId).summary = "POST-COMMIT MUTATION";
    // Re-read the entity — still the frozen commit-time summary.
    const after = await archCtx.stores.task.getTask(spawned!.id);
    expect(after!.sourceThreadSummary).toBe("COMMIT-TIME SUMMARY");
    expect(after!.sourceThreadSummary).not.toBe("POST-COMMIT MUTATION");
  });

  it("INV-TH23: every autonomous spawn type carries sourceThreadSummary", async () => {
    async function runConverge(type: string, payload: Record<string, unknown>, summary: string): Promise<string> {
      const r = await router.handle("create_thread", { routingMode: "broadcast",title: "t", message: "m" }, archCtx);
      const threadId = JSON.parse(r.content[0].text).threadId;
      await router.handle("create_thread_reply", {
        threadId, message: "s", converged: true, summary,
        stagedActions: [{ kind: "stage", type, payload } as any],
      }, engCtx);
      await router.handle("create_thread_reply", { threadId, message: "go", converged: true }, archCtx);
      return threadId;
    }

    // create_task
    const tid1 = await runConverge("create_task", { title: "T1", description: "d" }, "SUM-TASK");
    const t = (await archCtx.stores.task.listTasks()).find((t) => t.sourceThreadId === tid1);
    expect(t!.sourceThreadSummary).toBe("SUM-TASK");

    // create_proposal
    const tid2 = await runConverge("create_proposal", { title: "P1", description: "d" }, "SUM-PROP");
    const p = (await archCtx.stores.proposal.getProposals()).find((p) => p.sourceThreadId === tid2);
    expect(p!.sourceThreadSummary).toBe("SUM-PROP");

    // create_idea
    const tid3 = await runConverge("create_idea", { title: "I1", description: "d" }, "SUM-IDEA");
    const i = (await archCtx.stores.idea.listIdeas()).find((i) => i.sourceThreadId === tid3);
    expect(i!.sourceThreadSummary).toBe("SUM-IDEA");

    // propose_mission
    const tid4 = await runConverge("propose_mission", { title: "M1", description: "d", goals: [] }, "SUM-MISSION");
    const m = (await archCtx.stores.mission.listMissions()).find((m) => m.sourceThreadId === tid4);
    expect(m!.sourceThreadSummary).toBe("SUM-MISSION");
  });

  // ── Cascade validate-failure keeps thread active (INV-TH19) ──

  it("INV-TH19: validate-phase failure keeps thread active; staged → NOT committed", async () => {
    const r = await router.handle("create_thread", { routingMode: "broadcast",title: "t", message: "m" }, archCtx);
    const threadId = JSON.parse(r.content[0].text).threadId;

    // Engineer stages a valid close_no_action then converges (round 2).
    await router.handle("create_thread_reply", {
      threadId, message: "s", converged: true, summary: "x",
      stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "ok" } }],
    }, engCtx);

    // Poison the staged action's payload to force validate failure.
    const store = archCtx.stores.thread as any;
    store.threads.get(threadId).convergenceActions[0].payload = {}; // drop `reason`

    // Architect tries to converge → gate runs validate → rejects.
    const badConverge = await router.handle("create_thread_reply", {
      threadId, message: "c", converged: true,
    }, archCtx);
    expect(badConverge.isError).toBe(true);
    expect(JSON.parse(badConverge.content[0].text).error).toMatch(/staged action validation failed/);

    // Thread state: still active, action still staged, no finalized event
    const t = JSON.parse((await router.handle("get_thread", { threadId }, archCtx)).content[0].text);
    expect(t.status).toBe("active");
    expect(t.convergenceActions[0].status).toBe("staged");
    const finalized = (archCtx as any).dispatchedEvents.find((e: any) => e.event === "thread_convergence_finalized");
    expect(finalized).toBeUndefined();
  });

  // ── Cascade execute-failure → cascade_failed terminal (INV-TH19) ──

  it("INV-TH19: execute-phase failure transitions thread to cascade_failed (via failing spec)", async () => {
    // Phase 1 of M-Cascade-Perfection: swap the create_clarification
    // ActionSpec for a probe whose execute always throws. Restored in
    // the finally block so adjacent tests see the canonical spec.
    const { registerActionSpec, getActionSpec } = await import("../src/policy/cascade-spec.js");
    const before = getActionSpec("create_clarification");
    const { z } = await import("zod");
    registerActionSpec({
      type: "create_clarification",
      kind: "audit_only",
      payloadSchema: z.object({ question: z.string(), context: z.string() }),
      auditAction: "test_simulated_failure_no_audit",
      execute: async () => {
        throw new Error("simulated handler failure");
      },
    });

    try {
      const r = await router.handle("create_thread", { routingMode: "broadcast",title: "t", message: "m" }, archCtx);
      const threadId = JSON.parse(r.content[0].text).threadId;

      // Engineer stages a create_clarification action that the
      // replaced-failing spec will throw on during execute.
      await router.handle("create_thread_reply", {
        threadId, message: "stage", converged: true, summary: "x",
        stagedActions: [{
          kind: "stage", type: "create_clarification",
          payload: { question: "q", context: "c" },
        }],
      }, engCtx);
      // Architect converges → gate promotes → cascade runs → spec throws
      await router.handle("create_thread_reply", {
        threadId, message: "c", converged: true,
      }, archCtx);

      // Thread transitions to cascade_failed (not closed)
      const final = JSON.parse((await router.handle("get_thread", { threadId }, archCtx)).content[0].text);
      expect(final.status).toBe("cascade_failed");

      // Finalized event fires with warning + cascade_failed terminal
      const finalized = (archCtx as any).dispatchedEvents.find((e: any) => e.event === "thread_convergence_finalized");
      expect(finalized).toBeDefined();
      expect(finalized.data.warning).toBe(true);
      expect(finalized.data.threadTerminal).toBe("cascade_failed");
      expect(finalized.data.failedCount).toBe(1);
      const entry = (finalized.data.report as any[])[0];
      expect(entry.status).toBe("failed");
      expect(entry.error).toMatch(/simulated handler failure/);

      // Audit entry records cascade_failed distinct from executed-success flows
      const audits = await archCtx.stores.audit.listEntries(50);
      expect(audits.some((a) => a.action === "thread_cascade_failed" && a.relatedEntity === threadId)).toBe(true);
    } finally {
      // Restore the canonical create_clarification spec so adjacent tests
      // see a clean registry.
      if (before) registerActionSpec(before);
    }
  });

  // ── INV-TH18: routingMode immutability already covered elsewhere;
  // this round adds a focused "cannot mutate post-open via direct store mutation gate test"
  // to confirm no code path flips the mode after open (other than the
  // broadcast-coerce on first reply which is the single permitted transition).

  it("INV-TH18: targeted routingMode is NOT mutated by replyToThread turn-flip", async () => {
    const r = await router.handle("create_thread", {
      title: "t", message: "m", routingMode: "unicast", recipientAgentId: engId,
    }, archCtx);
    const threadId = JSON.parse(r.content[0].text).threadId;

    const before = JSON.parse((await router.handle("get_thread", { threadId }, archCtx)).content[0].text);
    expect(before.routingMode).toBe("unicast");

    // Two round-trips of replies
    await router.handle("create_thread_reply", { threadId, message: "r1" }, engCtx);
    await router.handle("create_thread_reply", { threadId, message: "r2" }, archCtx);
    await router.handle("create_thread_reply", { threadId, message: "r3" }, engCtx);

    const after = JSON.parse((await router.handle("get_thread", { threadId }, archCtx)).content[0].text);
    expect(after.routingMode).toBe("unicast");
  });

  // ── INV-TH20: idempotency replay-safety across multiple retries ──

  it("INV-TH20: runCascade is idempotent on repeated replays for the same committed action", async () => {
    const { runCascade } = await import("../src/policy/cascade.js");

    const r = await router.handle("create_thread", { routingMode: "broadcast",title: "t", message: "m" }, archCtx);
    const threadId = JSON.parse(r.content[0].text).threadId;
    await router.handle("create_thread_reply", {
      threadId, message: "s", converged: true, summary: "Spawn once.",
      stagedActions: [{ kind: "stage", type: "create_task", payload: { title: "T", description: "d" } }],
    }, engCtx);
    await router.handle("create_thread_reply", { threadId, message: "go", converged: true }, archCtx);

    const thread = await archCtx.stores.thread.getThread(threadId);
    const action = thread!.convergenceActions.find((a) => a.type === "create_task")!;

    // Three replay attempts — all should be skipped_idempotent
    for (let i = 0; i < 3; i++) {
      const result = await runCascade(archCtx, thread!, [action as any], "Spawn once.");
      expect(result.report[0].status).toBe("skipped_idempotent");
      expect(result.anyFailure).toBe(false);
    }

    // Still exactly one spawned task.
    const tasks = await archCtx.stores.task.listTasks();
    expect(tasks.filter((t) => t.sourceThreadId === threadId)).toHaveLength(1);

    // At least 3 action_already_executed audit entries (one per replay)
    const audits = await archCtx.stores.audit.listEntries(100);
    const skipAudits = audits.filter((a) => a.action === "action_already_executed" && a.details.includes(thread!.id));
    expect(skipAudits.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Cascade-path SSE dispatch parity (bug surfaced post-M24-T15 ITW) ─
// The Phase 2 cascade handlers persist entities correctly but, prior
// to the shared-helper refactor (dispatch-helpers.ts), silently
// skipped the ctx.dispatch() call that the direct-tool equivalents
// fire. Engineers had to poll get_task to discover cascade-spawned
// tasks. These tests pin the parity: each cascade action fires the
// same SSE event the direct tool would.

describe("Cascade-path SSE parity (dispatch-helpers)", () => {
  let router: PolicyRouter;
  let archCtx: IPolicyContext;
  let engCtx: IPolicyContext;

  beforeEach(async () => {
    await import("../src/policy/cascade-actions/index.js");
    router = new PolicyRouter(noop);
    registerThreadPolicy(router);

    archCtx = createTestContext({ role: "architect", sessionId: "s-arch" });
    engCtx = createTestContext({ stores: archCtx.stores, role: "engineer", sessionId: "s-eng" });
    archCtx.stores.engineerRegistry.setSessionRole("s-arch", "architect");
    await archCtx.stores.engineerRegistry.registerAgent("s-arch", "architect" as any, {
      globalInstanceId: `test-gid-${"s-arch"}`,
      role: "architect" as any,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    });
    archCtx.stores.engineerRegistry.setSessionRole("s-eng", "engineer");
    await archCtx.stores.engineerRegistry.registerAgent("s-eng", "engineer" as any, {
      globalInstanceId: `test-gid-${"s-eng"}`,
      role: "engineer" as any,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    });
  });

  function injectStagedAction(threadId: string, type: string, payload: Record<string, unknown>, ctx: IPolicyContext): void {
    const store = ctx.stores.thread as any;
    const t = store.threads.get(threadId);
    const id = `action-${t.convergenceActions.length + 1}`;
    t.convergenceActions.push({
      id, type, status: "staged",
      proposer: { role: "engineer", agentId: null },
      timestamp: new Date().toISOString(),
      payload,
    });
  }

  async function runConverge(type: string, payload: Record<string, unknown>, summary: string): Promise<string> {
    const r = await router.handle("create_thread", { routingMode: "broadcast",title: "t", message: "m" }, archCtx);
    const threadId = JSON.parse(r.content[0].text).threadId;
    await router.handle("create_thread_reply", { threadId, message: "stage" }, engCtx);
    injectStagedAction(threadId, type, payload, archCtx);
    await router.handle("create_thread_reply", { threadId, message: "arch", summary }, archCtx);
    await router.handle("create_thread_reply", { threadId, message: "eng-c", converged: true }, engCtx);
    await router.handle("create_thread_reply", { threadId, message: "arch-c", converged: true }, archCtx);
    return threadId;
  }

  it("create_task cascade fires task_issued to engineers (matches direct tool)", async () => {
    const threadId = await runConverge(
      "create_task",
      { title: "T", description: "d" },
      "Spawn via cascade.",
    );
    const issued = (archCtx as any).dispatchedEvents.find(
      (e: any) => e.event === "task_issued" && e.data.sourceThreadId === threadId,
    );
    expect(issued).toBeDefined();
    expect(issued.selector.roles).toEqual(["engineer"]);
    expect(issued.data.taskId).toMatch(/^task-/);
    expect(issued.data.directive).toBe("d");
  });

  it("create_proposal cascade fires proposal_submitted to architects", async () => {
    await runConverge(
      "create_proposal",
      { title: "P", description: "body" },
      "Spawn via cascade.",
    );
    const submitted = (archCtx as any).dispatchedEvents.find(
      (e: any) => e.event === "proposal_submitted",
    );
    expect(submitted).toBeDefined();
    expect(submitted.selector.roles).toEqual(["architect"]);
    expect(submitted.data.proposalId).toMatch(/^prop-/);
    expect(submitted.data.title).toBe("P");
  });

  it("create_idea cascade fires idea_submitted (emit to both roles)", async () => {
    await runConverge(
      "create_idea",
      { title: "I", description: "desc", tags: ["x"] },
      "Spawn via cascade.",
    );
    const emitted = (archCtx as any).emittedEvents.find(
      (e: any) => e.event === "idea_submitted",
    );
    expect(emitted).toBeDefined();
    expect(emitted.targetRoles).toEqual(["architect", "engineer"]);
    expect(emitted.data.ideaId).toMatch(/^idea-/);
  });

  it("propose_mission cascade fires mission_created", async () => {
    await runConverge(
      "propose_mission",
      { title: "M", description: "d", goals: [] },
      "Spawn via cascade.",
    );
    const emitted = (archCtx as any).emittedEvents.find(
      (e: any) => e.event === "mission_created",
    );
    expect(emitted).toBeDefined();
    expect(emitted.targetRoles).toEqual(["architect", "engineer"]);
    expect(emitted.data.missionId).toMatch(/^mission-/);
    expect(emitted.data.title).toBe("M");
  });

  it("update_mission_status cascade fires mission_activated on proposed → active", async () => {
    const mission = await archCtx.stores.mission.createMission("M-Act", "d");
    // Clear events captured during the direct createMission.
    (archCtx as any).emittedEvents.length = 0;
    await runConverge(
      "update_mission_status",
      { missionId: mission.id, status: "active" },
      "Activate via cascade.",
    );
    const activated = (archCtx as any).emittedEvents.find(
      (e: any) => e.event === "mission_activated",
    );
    expect(activated).toBeDefined();
    expect(activated.data.missionId).toBe(mission.id);
  });

  it("update_mission_status cascade does NOT fire mission_activated for non-active targets", async () => {
    const mission = await archCtx.stores.mission.createMission("M-Abandon", "d");
    // mission is "proposed"; transition straight to "abandoned" is FSM-legal
    (archCtx as any).emittedEvents.length = 0;
    await runConverge(
      "update_mission_status",
      { missionId: mission.id, status: "abandoned" },
      "Abandon via cascade.",
    );
    const activated = (archCtx as any).emittedEvents.find(
      (e: any) => e.event === "mission_activated",
    );
    expect(activated).toBeUndefined();
  });

  it("close_no_action cascade does NOT fire any entity-spawn event", async () => {
    await runConverge(
      "close_no_action",
      { reason: "nothing to do" },
      "Close via cascade.",
    );
    // No task/proposal/idea/mission spawn; audit-only.
    for (const event of ["task_issued", "proposal_submitted", "idea_submitted", "mission_created", "mission_activated"]) {
      expect((archCtx as any).dispatchedEvents.find((e: any) => e.event === event)).toBeUndefined();
      expect((archCtx as any).emittedEvents.find((e: any) => e.event === event)).toBeUndefined();
    }
  });

  it("idempotent re-run does NOT re-dispatch (status: skipped_idempotent → no event)", async () => {
    const { runCascade } = await import("../src/policy/cascade.js");
    const threadId = await runConverge(
      "create_task",
      { title: "Once", description: "only once" },
      "Single dispatch.",
    );
    // First dispatch count on task_issued
    const firstCount = (archCtx as any).dispatchedEvents.filter(
      (e: any) => e.event === "task_issued",
    ).length;
    expect(firstCount).toBe(1);

    // Replay cascade against the same thread+action
    const thread = await archCtx.stores.thread.getThread(threadId);
    const action = thread!.convergenceActions.find((a: any) => a.type === "create_task")!;
    const result = await runCascade(archCtx, thread!, [action as any], "Single dispatch.");
    expect(result.report[0].status).toBe("skipped_idempotent");
    // No additional task_issued dispatch
    const finalCount = (archCtx as any).dispatchedEvents.filter(
      (e: any) => e.event === "task_issued",
    ).length;
    expect(finalCount).toBe(1);
  });
});

// ── M-Cascade-Perfection Phase 1 (ADR-015): depth guard (INV-TH25) ───

describe("runCascade — depth guard (INV-TH25)", () => {
  let router: PolicyRouter;
  let archCtx: IPolicyContext;

  beforeEach(async () => {
    await import("../src/policy/cascade-actions/index.js");
    router = new PolicyRouter(noop);
    registerThreadPolicy(router);
    archCtx = createTestContext({ role: "architect", sessionId: "s-arch" });
    archCtx.stores.engineerRegistry.setSessionRole("s-arch", "architect");
    await archCtx.stores.engineerRegistry.registerAgent("s-arch", "architect" as any, {
      globalInstanceId: `test-gid-${"s-arch"}`,
      role: "architect" as any,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    });
  });

  it("depth < MAX_CASCADE_DEPTH executes normally", async () => {
    const { runCascade, MAX_CASCADE_DEPTH } = await import("../src/policy/cascade.js");
    expect(MAX_CASCADE_DEPTH).toBe(3);
    const r = await router.handle("create_thread", { routingMode: "broadcast",title: "t", message: "m" }, archCtx);
    const threadId = JSON.parse(r.content[0].text).threadId;
    const thread = await archCtx.stores.thread.getThread(threadId);
    const actions = [
      {
        id: "action-1", type: "close_no_action" as const, status: "committed" as const,
        proposer: { role: "engineer" as const, agentId: null },
        timestamp: new Date().toISOString(),
        payload: { reason: "ok" },
      },
    ];
    const result = await runCascade(archCtx, thread!, actions as any, "s", 0);
    expect(result.report[0].status).toBe("executed");
  });

  it("depth == MAX_CASCADE_DEPTH returns deferred-failed entries without executing", async () => {
    const { runCascade, MAX_CASCADE_DEPTH } = await import("../src/policy/cascade.js");
    const r = await router.handle("create_thread", { routingMode: "broadcast",title: "t", message: "m" }, archCtx);
    const threadId = JSON.parse(r.content[0].text).threadId;
    const thread = await archCtx.stores.thread.getThread(threadId);
    const actions = [
      {
        id: "action-1", type: "close_no_action" as const, status: "committed" as const,
        proposer: { role: "engineer" as const, agentId: null },
        timestamp: new Date().toISOString(),
        payload: { reason: "ok" },
      },
      {
        id: "action-2", type: "create_task" as const, status: "committed" as const,
        proposer: { role: "engineer" as const, agentId: null },
        timestamp: new Date().toISOString(),
        payload: { title: "T", description: "d" },
      },
    ];
    const result = await runCascade(archCtx, thread!, actions as any, "s", MAX_CASCADE_DEPTH);
    expect(result.anyFailure).toBe(true);
    expect(result.executedCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.failedCount).toBe(2);
    for (const entry of result.report) {
      expect(entry.status).toBe("failed");
      expect(entry.error).toMatch(/MAX_CASCADE_DEPTH/);
    }
    // No entities were actually spawned
    const tasks = await archCtx.stores.task.listTasks();
    expect(tasks.filter((t) => t.sourceThreadId === threadId)).toHaveLength(0);
  });
});

// ── M-Cascade-Perfection Phase 1: ActionSpec kind semantics ──────────

describe("ActionSpec kinds (ADR-015)", () => {
  let archCtx: IPolicyContext;

  beforeEach(async () => {
    await import("../src/policy/cascade-actions/index.js");
    archCtx = createTestContext({ role: "architect", sessionId: "s-arch" });
  });

  it("all 9 autonomous action types have registered ActionSpecs (Phase 2 add: create_bug)", async () => {
    const { listActionSpecs } = await import("../src/policy/cascade-spec.js");
    const types = new Set(listActionSpecs());
    for (const type of [
      "close_no_action", "create_task", "create_proposal", "create_idea",
      "update_idea", "update_mission_status", "propose_mission", "create_clarification",
      "create_bug",
    ]) {
      expect(types.has(type as any)).toBe(true);
    }
  });

  it("audit-only spec omits dispatch + findByCascadeKey", async () => {
    const { getActionSpec } = await import("../src/policy/cascade-spec.js");
    const spec = getActionSpec("close_no_action");
    expect(spec).toBeDefined();
    expect(spec!.kind).toBe("audit_only");
    expect(spec!.dispatch).toBeUndefined();
    expect(spec!.findByCascadeKey).toBeUndefined();
  });

  it("spawn spec declares findByCascadeKey + dispatch", async () => {
    const { getActionSpec } = await import("../src/policy/cascade-spec.js");
    const spec = getActionSpec("create_task");
    expect(spec).toBeDefined();
    expect(spec!.kind).toBe("spawn");
    expect(spec!.findByCascadeKey).toBeDefined();
    expect(spec!.dispatch).toBeDefined();
  });

  it("update spec omits findByCascadeKey (update-by-nature idempotent)", async () => {
    const { getActionSpec } = await import("../src/policy/cascade-spec.js");
    const spec = getActionSpec("update_idea");
    expect(spec).toBeDefined();
    expect(spec!.kind).toBe("update");
    expect(spec!.findByCascadeKey).toBeUndefined();
  });

  it("unregisterActionSpec removes a spec cleanly", async () => {
    const { registerActionSpec, getActionSpec, unregisterActionSpec } = await import("../src/policy/cascade-spec.js");
    const { z } = await import("zod");
    const before = getActionSpec("create_clarification");
    const probe = {
      type: "create_clarification" as const,
      kind: "audit_only" as const,
      payloadSchema: z.object({ question: z.string(), context: z.string() }),
      auditAction: "test_audit",
      execute: async () => null,
    };
    registerActionSpec(probe);
    expect(getActionSpec("create_clarification")).toBe(probe);
    unregisterActionSpec("create_clarification");
    expect(getActionSpec("create_clarification")).toBeUndefined();
    // Restore canonical
    if (before) registerActionSpec(before);
  });
});

// ── M-Cascade-Perfection Phase 2 (ADR-015): Bug entity + create_bug ─

describe("BugPolicy (ADR-015 Phase 2)", () => {
  let router: PolicyRouter;
  let ctx: IPolicyContext;

  beforeEach(async () => {
    await import("../src/policy/cascade-actions/index.js");
    const { registerBugPolicy } = await import("../src/policy/bug-policy.js");
    router = new PolicyRouter(noop);
    registerBugPolicy(router);
    ctx = createTestContext({ role: "engineer" });
    ctx.stores.engineerRegistry.setSessionRole(ctx.sessionId, "engineer");
    await ctx.stores.engineerRegistry.registerAgent(ctx.sessionId, "engineer" as any, {
      globalInstanceId: `test-gid-${ctx.sessionId}`,
      role: "engineer" as any,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    });
  });

  it("registers all 4 bug tools", () => {
    expect(router.has("create_bug")).toBe(true);
    expect(router.has("list_bugs")).toBe(true);
    expect(router.has("get_bug")).toBe(true);
    expect(router.has("update_bug")).toBe(true);
  });

  it("create_bug spawns a Bug in status=open with default severity=minor + fires bug_reported", async () => {
    const r = await router.handle("create_bug", {
      title: "Test bug",
      description: "steps to repro...",
    }, ctx);
    expect(r.isError).toBeUndefined();
    const parsed = JSON.parse(r.content[0].text);
    expect(parsed.bugId).toMatch(/^bug-/);
    expect(parsed.status).toBe("open");
    expect(parsed.severity).toBe("minor");

    const emitted = (ctx as any).emittedEvents.find((e: any) => e.event === "bug_reported");
    expect(emitted).toBeDefined();
    expect(emitted.data.bugId).toBe(parsed.bugId);
  });

  it("create_bug stores class + tags + severity + surfacedBy", async () => {
    const r = await router.handle("create_bug", {
      title: "Classified bug",
      description: "body",
      severity: "major",
      class: "drift",
      tags: ["hub", "cascade"],
      surfacedBy: "unit-test",
    }, ctx);
    const { bugId } = JSON.parse(r.content[0].text);
    const get = await router.handle("get_bug", { bugId }, ctx);
    const bug = JSON.parse(get.content[0].text);
    expect(bug.severity).toBe("major");
    expect(bug.class).toBe("drift");
    expect(bug.tags).toEqual(["hub", "cascade"]);
    expect(bug.surfacedBy).toBe("unit-test");
  });

  it("list_bugs filters by status + severity + class + tags match-any", async () => {
    await router.handle("create_bug", { title: "A", description: "a", severity: "critical", class: "drift", tags: ["hub"] }, ctx);
    await router.handle("create_bug", { title: "B", description: "b", severity: "minor", class: "race", tags: ["engineer"] }, ctx);
    await router.handle("create_bug", { title: "C", description: "c", severity: "critical", class: "drift", tags: ["architect"] }, ctx);

    const byStatus = JSON.parse((await router.handle("list_bugs", { status: "open" }, ctx)).content[0].text);
    expect(byStatus.total).toBe(3);

    const bySeverity = JSON.parse((await router.handle("list_bugs", { severity: "critical" }, ctx)).content[0].text);
    expect(bySeverity.total).toBe(2);

    const byClass = JSON.parse((await router.handle("list_bugs", { class: "drift" }, ctx)).content[0].text);
    expect(byClass.total).toBe(2);

    const byTags = JSON.parse((await router.handle("list_bugs", { tags: ["hub", "architect"] }, ctx)).content[0].text);
    expect(byTags.total).toBe(2);
  });

  it("update_bug transitions open → investigating → resolved; fires bug_status_changed", async () => {
    const r = await router.handle("create_bug", { title: "T", description: "d" }, ctx);
    const { bugId } = JSON.parse(r.content[0].text);

    // Clear events captured during create_bug
    (ctx as any).emittedEvents.length = 0;

    await router.handle("update_bug", { bugId, status: "investigating" }, ctx);
    const ev1 = (ctx as any).emittedEvents.find((e: any) => e.event === "bug_status_changed");
    expect(ev1).toBeDefined();
    expect(ev1.data.status).toBe("investigating");

    await router.handle("update_bug", { bugId, status: "resolved", fixCommits: ["abc123"] }, ctx);
    const ev2 = (ctx as any).emittedEvents.filter((e: any) => e.event === "bug_status_changed").pop();
    expect(ev2.data.status).toBe("resolved");

    const bug = JSON.parse((await router.handle("get_bug", { bugId }, ctx)).content[0].text);
    expect(bug.status).toBe("resolved");
    expect(bug.fixCommits).toEqual(["abc123"]);
  });

  it("update_bug rejects invalid FSM transitions (open → resolved is legal; resolved → open is not)", async () => {
    const r = await router.handle("create_bug", { title: "T", description: "d" }, ctx);
    const { bugId } = JSON.parse(r.content[0].text);

    // open → resolved is a legal edge
    const ok = await router.handle("update_bug", { bugId, status: "resolved" }, ctx);
    expect(ok.isError).toBeUndefined();

    // resolved → open is not
    const bad = await router.handle("update_bug", { bugId, status: "open" }, ctx);
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.content[0].text).error).toMatch(/Invalid state transition/);
  });

  it("update_bug metadata-only changes don't fire bug_status_changed", async () => {
    const r = await router.handle("create_bug", { title: "T", description: "d" }, ctx);
    const { bugId } = JSON.parse(r.content[0].text);
    (ctx as any).emittedEvents.length = 0;

    // Update tags + linkedTaskIds only — no status change
    await router.handle("update_bug", { bugId, tags: ["new-tag"], linkedTaskIds: ["task-100"] }, ctx);
    const ev = (ctx as any).emittedEvents.find((e: any) => e.event === "bug_status_changed");
    expect(ev).toBeUndefined();
  });
});

// ── Phase 2: create_bug cascade parity ──────────────────────────────

describe("Cascade: create_bug (Phase 2 validation)", () => {
  let router: PolicyRouter;
  let archCtx: IPolicyContext;
  let engCtx: IPolicyContext;

  beforeEach(async () => {
    await import("../src/policy/cascade-actions/index.js");
    router = new PolicyRouter(noop);
    registerThreadPolicy(router);
    archCtx = createTestContext({ role: "architect", sessionId: "s-arch" });
    engCtx = createTestContext({ stores: archCtx.stores, role: "engineer", sessionId: "s-eng" });
    archCtx.stores.engineerRegistry.setSessionRole("s-arch", "architect");
    await archCtx.stores.engineerRegistry.registerAgent("s-arch", "architect" as any, {
      globalInstanceId: `test-gid-${"s-arch"}`,
      role: "architect" as any,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    });
    archCtx.stores.engineerRegistry.setSessionRole("s-eng", "engineer");
    await archCtx.stores.engineerRegistry.registerAgent("s-eng", "engineer" as any, {
      globalInstanceId: `test-gid-${"s-eng"}`,
      role: "engineer" as any,
      clientMetadata: { clientName: "test", clientVersion: "0", proxyName: "test", proxyVersion: "0" },
    });
  });

  function injectStagedAction(threadId: string, type: string, payload: Record<string, unknown>, ctx: IPolicyContext): void {
    const store = ctx.stores.thread as any;
    const t = store.threads.get(threadId);
    const id = `action-${t.convergenceActions.length + 1}`;
    t.convergenceActions.push({
      id, type, status: "staged",
      proposer: { role: "engineer", agentId: null },
      timestamp: new Date().toISOString(),
      payload,
    });
  }

  async function runConverge(type: string, payload: Record<string, unknown>, summary: string): Promise<string> {
    const r = await router.handle("create_thread", { routingMode: "broadcast",title: "t", message: "m" }, archCtx);
    const threadId = JSON.parse(r.content[0].text).threadId;
    await router.handle("create_thread_reply", { threadId, message: "stage" }, engCtx);
    injectStagedAction(threadId, type, payload, archCtx);
    await router.handle("create_thread_reply", { threadId, message: "arch", summary }, archCtx);
    await router.handle("create_thread_reply", { threadId, message: "eng-c", converged: true }, engCtx);
    await router.handle("create_thread_reply", { threadId, message: "arch-c", converged: true }, archCtx);
    return threadId;
  }

  it("create_bug cascade spawns Bug with full back-link (sourceThreadId/ActionId/Summary)", async () => {
    const threadId = await runConverge(
      "create_bug",
      {
        title: "Cascade-spawned bug",
        description: "Found during thread review",
        severity: "major",
        class: "drift",
        tags: ["hub", "cascade"],
        surfacedBy: "code-review",
      },
      "Engineer + architect agreed this is a bug.",
    );

    const bugs = await archCtx.stores.bug.listBugs();
    const spawned = bugs.find((b) => b.sourceThreadId === threadId);
    expect(spawned).toBeDefined();
    expect(spawned!.title).toBe("Cascade-spawned bug");
    expect(spawned!.severity).toBe("major");
    expect(spawned!.class).toBe("drift");
    expect(spawned!.tags).toEqual(["hub", "cascade"]);
    expect(spawned!.surfacedBy).toBe("code-review");
    expect(spawned!.sourceActionId).toBeTruthy();
    expect(spawned!.sourceThreadSummary).toMatch(/agreed this is a bug/i);
    expect(spawned!.status).toBe("open");
  });

  it("create_bug cascade fires bug_reported via the shared dispatch-helper", async () => {
    await runConverge(
      "create_bug",
      { title: "T", description: "d" },
      "Spawn via cascade.",
    );
    const emitted = (archCtx as any).emittedEvents.find((e: any) => e.event === "bug_reported");
    expect(emitted).toBeDefined();
    expect(emitted.targetRoles).toEqual(["architect", "engineer"]);
  });

  it("create_bug cascade is idempotent on re-run (validates new ActionSpec pattern)", async () => {
    const { runCascade } = await import("../src/policy/cascade.js");
    const threadId = await runConverge(
      "create_bug",
      { title: "Once", description: "only once" },
      "Spawn once.",
    );
    const thread = await archCtx.stores.thread.getThread(threadId);
    const action = thread!.convergenceActions.find((a: any) => a.type === "create_bug")!;

    const result = await runCascade(archCtx, thread!, [action as any], "Spawn once.");
    expect(result.report[0].status).toBe("skipped_idempotent");
    const bugs = await archCtx.stores.bug.listBugs();
    expect(bugs.filter((b) => b.sourceThreadId === threadId)).toHaveLength(1);
  });

  it("create_bug cascade defaults severity=minor when omitted from payload", async () => {
    const threadId = await runConverge(
      "create_bug",
      { title: "No sev", description: "d" }, // severity omitted
      "Default severity test.",
    );
    const bugs = await archCtx.stores.bug.listBugs();
    const spawned = bugs.find((b) => b.sourceThreadId === threadId);
    expect(spawned!.severity).toBe("minor");
  });
});
