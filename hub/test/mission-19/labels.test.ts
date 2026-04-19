/**
 * Mission-19 — Label inheritance on entity creation and scaffolding.
 *
 * Covers: caller labels → task/proposal/thread on submit, proposal scaffold
 * inherits proposal labels (not approver's), thread-spawn inherits thread
 * labels (not converger's). Entity labels immutable post-create.
 *
 * Registry invariants: INV-T13, INV-T16, INV-T17, INV-P5, INV-P6,
 *                      INV-TH9, INV-TH10, INV-SYS-L06, INV-SYS-L08.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { RegisterAgentPayload, AgentClientMetadata, AgentRole, AgentLabels } from "../../src/state.js";
import { PolicyRouter } from "../../src/policy/router.js";
import { registerTaskPolicy } from "../../src/policy/task-policy.js";
import { registerProposalPolicy } from "../../src/policy/proposal-policy.js";
import { registerThreadPolicy } from "../../src/policy/thread-policy.js";
import { registerSessionPolicy } from "../../src/policy/session-policy.js";
import { createTestContext, type TestPolicyContext } from "../../src/policy/test-utils.js";

const noop = () => {};

const CLIENT: AgentClientMetadata = {
  clientName: "claude-code",
  clientVersion: "0.1.0",
  proxyName: "@ois/claude-plugin",
  proxyVersion: "1.0.0",
};

function payload(instanceId: string, role: AgentRole, labels?: AgentLabels): RegisterAgentPayload {
  return { globalInstanceId: instanceId, role, clientMetadata: CLIENT, labels };
}

async function registerCallerAgent(
  ctx: TestPolicyContext,
  role: AgentRole,
  labels: AgentLabels,
) {
  await ctx.stores.engineerRegistry.registerAgent(
    ctx.sessionId,
    role,
    payload(`inst-${ctx.sessionId}`, role, labels),
  );
}

describe("Mission-19 Labels — Task inherits caller labels (INV-T13)", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerTaskPolicy(router);
    registerSessionPolicy(router);
    ctx = createTestContext({
      sessionId: "sess-arch-platform",
      role: "architect",
    });
  });

  it("task.labels are set from the caller Agent's labels at submit-time", async () => {
    await registerCallerAgent(ctx, "architect", { team: "platform", env: "prod" });

    const result = await router.handle("create_task", {
      title: "Do thing",
      description: "Implement X",
    }, ctx);
    expect(result.isError).toBeUndefined();
    const { taskId } = JSON.parse(result.content[0].text);

    const task = await ctx.stores.task.getTask(taskId);
    expect(task?.labels).toEqual({ team: "platform", env: "prod" });
  });

  it("unregistered caller → task.labels = {}", async () => {
    // No registerCallerAgent call.
    const result = await router.handle("create_task", {
      title: "Do thing",
      description: "Implement X",
    }, ctx);
    const { taskId } = JSON.parse(result.content[0].text);

    const task = await ctx.stores.task.getTask(taskId);
    expect(task?.labels).toEqual({});
  });

  it("dispatch selector uses task.labels (INV-SYS-L02, INV-SYS-L03)", async () => {
    await registerCallerAgent(ctx, "architect", { team: "platform" });

    await router.handle("create_task", {
      title: "Do thing",
      description: "Implement X",
    }, ctx);

    const dispatched = ctx.dispatchedEvents.find((e) => e.event === "task_issued");
    expect(dispatched).toBeDefined();
    expect(dispatched!.selector.roles).toEqual(["engineer"]);
    expect(dispatched!.selector.matchLabels).toEqual({ team: "platform" });
  });

  it("task.labels are IMMUTABLE post-create (INV-SYS-L06)", async () => {
    await registerCallerAgent(ctx, "architect", { team: "platform" });

    const createResult = await router.handle("create_task", {
      title: "T",
      description: "D",
    }, ctx);
    const { taskId } = JSON.parse(createResult.content[0].text);

    const initial = await ctx.stores.task.getTask(taskId);
    expect(initial?.labels).toEqual({ team: "platform" });

    // Engineer picks up the task from a different label scope.
    const engCtx = createTestContext({
      sessionId: "sess-eng",
      role: "engineer",
      stores: ctx.stores,
    });
    await registerCallerAgent(engCtx, "engineer", { team: "platform", env: "prod" });
    await router.handle("get_task", {}, engCtx);

    const afterClaim = await ctx.stores.task.getTask(taskId);
    // Labels unchanged by claim.
    expect(afterClaim?.labels).toEqual({ team: "platform" });

    // Report doesn't mutate labels either.
    await router.handle("create_report", {
      taskId,
      report: "Done",
      summary: "Ok",
    }, engCtx);
    const afterReport = await ctx.stores.task.getTask(taskId);
    expect(afterReport?.labels).toEqual({ team: "platform" });
  });
});

describe("Mission-19 Labels — Proposal inherits caller labels (INV-P5)", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerProposalPolicy(router);
    registerSessionPolicy(router);
    ctx = createTestContext({
      sessionId: "sess-eng",
      role: "engineer",
    });
  });

  it("proposal.labels are set from the caller Agent's labels", async () => {
    await registerCallerAgent(ctx, "engineer", { team: "network" });

    const result = await router.handle("create_proposal", {
      title: "P",
      summary: "S",
      body: "B",
    }, ctx);
    const { proposalId } = JSON.parse(result.content[0].text);

    const proposal = await ctx.stores.proposal.getProposal(proposalId);
    expect(proposal?.labels).toEqual({ team: "network" });
  });

  it("proposal_submitted dispatch carries proposal.labels as matchLabels", async () => {
    await registerCallerAgent(ctx, "engineer", { team: "network" });

    await router.handle("create_proposal", {
      title: "P",
      summary: "S",
      body: "B",
    }, ctx);

    const dispatched = ctx.dispatchedEvents.find((e) => e.event === "proposal_submitted");
    expect(dispatched).toBeDefined();
    expect(dispatched!.selector.matchLabels).toEqual({ team: "network" });
    expect(dispatched!.selector.roles).toEqual(["architect"]);
  });
});

describe("Mission-19 Labels — Thread inherits opener labels (INV-TH9)", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(() => {
    router = new PolicyRouter(noop);
    registerThreadPolicy(router);
    registerSessionPolicy(router);
    ctx = createTestContext({
      sessionId: "sess-arch",
      role: "architect",
    });
  });

  it("thread.labels come from the opener", async () => {
    await registerCallerAgent(ctx, "architect", { team: "platform" });
    await router.handle("register_role", { role: "architect" }, ctx);

    // ADR-016 INV-TH28: unicast (default) requires recipientAgentId;
    // this test just needs the thread to persist with labels, so
    // broadcast mode is the cleanest fit (no counterparty yet known).
    const result = await router.handle("create_thread", {
      title: "T",
      message: "M",
      routingMode: "broadcast",
    }, ctx);
    const { threadId } = JSON.parse(result.content[0].text);

    const thread = await ctx.stores.thread.getThread(threadId);
    expect(thread?.labels).toEqual({ team: "platform" });
  });

  it("thread_message dispatch carries thread.labels", async () => {
    await registerCallerAgent(ctx, "architect", { team: "platform" });
    await router.handle("register_role", { role: "architect" }, ctx);

    await router.handle("create_thread", {
      title: "T",
      message: "M",
      routingMode: "broadcast",
    }, ctx);

    const dispatched = ctx.dispatchedEvents.find((e) => e.event === "thread_message");
    expect(dispatched).toBeDefined();
    expect(dispatched!.selector.matchLabels).toEqual({ team: "platform" });
  });
});

// MISSION-21 PHASE 1 STATUS: this block exercises the singular
// convergenceAction shape with create_task vocabulary, deleted in the
// Threads 2.0 clean cutover. Phase 2 re-introduces create_task as a
// stagedAction.type; rewrite each scenario to
// stagedActions:[{kind:"stage", type:"create_task", payload:{...}}]
// when Phase 2 lands. Skipped for Phase 1 tree-green.
describe.skip("Mission-19 Labels — Thread-spawn inherits thread labels (INV-T17, INV-TH10) [PHASE 2 REWRITE PENDING]", () => {
  let router: PolicyRouter;
  let archCtx: TestPolicyContext;
  let engCtx: TestPolicyContext;

  beforeEach(async () => {
    router = new PolicyRouter(noop);
    registerThreadPolicy(router);
    registerTaskPolicy(router);
    registerProposalPolicy(router);
    registerSessionPolicy(router);

    archCtx = createTestContext({ sessionId: "sess-arch", role: "architect" });
    await registerCallerAgent(archCtx, "architect", { team: "platform" });
    await router.handle("register_role", { role: "architect" }, archCtx);

    engCtx = createTestContext({
      stores: archCtx.stores,
      sessionId: "sess-eng",
      role: "engineer",
    });
    await registerCallerAgent(engCtx, "engineer", { team: "platform" });
    await router.handle("register_role", { role: "engineer" }, engCtx);
  });

  it("convergenceAction: create_task inherits thread.labels, not converger's labels", async () => {
    // Architect (team=platform) opens a thread.
    const opened = await router.handle("create_thread", {
      title: "Spec X",
      message: "What do you think?",
    }, archCtx);
    const { threadId } = JSON.parse(opened.content[0].text);

    // Engineer (team=platform) replies + converges. The converger IS in the same
    // scope here — but we'll test a DIFFERENT-scope converger in the next test.
    await router.handle("create_thread_reply", {
      threadId,
      message: "Agreed",
      converged: true,
    }, engCtx);

    // Architect converges with a convergenceAction.
    await router.handle("create_thread_reply", {
      threadId,
      message: "Let's build it",
      converged: true,
      convergenceAction: {
        type: "create_task",
        templateData: { title: "Build X", description: "Per thread discussion" },
      },
    }, archCtx);

    // The spawned task should carry the thread's labels.
    const tasks = await archCtx.stores.task.listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].labels).toEqual({ team: "platform" });
  });

  it("convergenceAction: cross-scope converger cannot redirect downstream routing", async () => {
    // Thread opened in the platform scope.
    const opened = await router.handle("create_thread", {
      title: "Spec X",
      message: "Thoughts?",
    }, archCtx);
    const { threadId } = JSON.parse(opened.content[0].text);

    // A network-scoped engineer replies + converges with a convergenceAction.
    // (In practice a cross-scope reply would be unusual — but the guarantee is
    // that the spawned entity uses THE THREAD'S labels, not the converger's.)
    const engNetworkCtx = createTestContext({
      stores: archCtx.stores,
      sessionId: "sess-eng-network",
      role: "engineer",
    });
    await registerCallerAgent(engNetworkCtx, "engineer", { team: "network" });
    await router.handle("register_role", { role: "engineer" }, engNetworkCtx);

    await router.handle("create_thread_reply", {
      threadId,
      message: "Works for us",
      converged: true,
    }, engNetworkCtx);

    await router.handle("create_thread_reply", {
      threadId,
      message: "Ship it",
      converged: true,
      convergenceAction: {
        type: "create_proposal",
        templateData: { title: "Build X", description: "Plan and execute" },
      },
    }, archCtx);

    const proposals = await archCtx.stores.proposal.getProposals();
    expect(proposals).toHaveLength(1);
    // The spawned proposal carries the THREAD'S labels (platform), not the
    // converger's labels (the architect is also platform in this test, so we
    // assert against thread.labels specifically).
    const thread = await archCtx.stores.thread.getThread(threadId);
    expect(proposals[0].labels).toEqual(thread!.labels);
    expect(proposals[0].labels).toEqual({ team: "platform" });
  });
});
