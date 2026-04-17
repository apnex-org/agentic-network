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
