import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../../src/policy/router.js";
import { registerThreadPolicy } from "../../src/policy/thread-policy.js";
import { registerPendingActionPolicy } from "../../src/policy/pending-action-policy.js";
import { createTestContext, type TestPolicyContext } from "../../src/policy/test-utils.js";
import type { PendingActionRepository } from "../../src/state.js";

/**
 * bug-61 — pinpoint participant dispatches must not gate on labels.
 *
 * Three dispatches target EXPLICIT participant agentIds yet still carried
 * `matchLabels: <thread.labels>` alongside them (thread_abandoned,
 * thread_convergence_finalized, thread_queue_item_pruned). The store-layer
 * `selectAgents` contract is `agentId + matchLabels → MUST-match`, so a
 * participant whose labels don't satisfy the thread's inherited env label
 * (a cross-tenant participant, e.g. env=dev on an env=prod thread) is
 * silently dropped from the dispatch — a named recipient losing delivery.
 *
 * Fix (mirrors the bug-18 unicast precedent): drop matchLabels from these
 * pinpoint selectors — the agentId IS the addressing; labels must not gate
 * delivery to a named target. These tests assert the dispatched selector
 * is pinpoint (agentIds present, matchLabels undefined), so a cross-env
 * participant still receives.
 */

const CLIENT = {
  clientName: "claude-code",
  clientVersion: "0.1.0",
  proxyName: "@apnex/claude-plugin",
  proxyVersion: "1.0.0",
};

describe("bug-61 — pinpoint participant dispatches are not label-gated", () => {
  let archCtx: TestPolicyContext;
  let kateCtx: TestPolicyContext;
  let router: PolicyRouter;
  let kateId: string;

  beforeEach(async () => {
    archCtx = createTestContext({ role: "architect", sessionId: "s-arch" });
    // Kate — a cross-tenant engineer (env=dev) sharing the same stores.
    kateCtx = createTestContext({ stores: archCtx.stores, role: "engineer", sessionId: "s-kate" });
    router = new PolicyRouter(() => {});
    registerThreadPolicy(router);
    registerPendingActionPolicy(router);

    const reg = archCtx.stores.engineerRegistry;
    await reg.registerAgent("s-arch", "architect", {
      name: "inst-arch", role: "architect", clientMetadata: CLIENT, labels: { env: "prod" },
    } as never);
    const kateReg = await reg.registerAgent("s-kate", "engineer", {
      name: "inst-kate", role: "engineer", clientMetadata: CLIENT, labels: { env: "dev" },
    } as never);
    if (!kateReg.ok) throw new Error("kate register failed");
    kateId = kateReg.agentId;
  });

  it("thread_abandoned dispatch: pinpoint to the remaining (cross-env) participant — NO matchLabels", async () => {
    // arch (env=prod) opens a unicast thread to kate (env=dev); kate replies
    // to become a participant; arch leaves → thread_abandoned must still reach
    // kate even though her env label differs from the thread's inherited env.
    const open = await router.handle(
      "create_thread",
      { title: "cross-env leave", message: "ping", routingMode: "unicast", recipientAgentId: kateId },
      archCtx,
    );
    const threadId = JSON.parse(open.content[0].text).threadId as string;
    await router.handle("create_thread_reply", { threadId, message: "kate here" }, kateCtx);

    archCtx.dispatchedEvents.length = 0; // ignore open/reply dispatches
    await router.handle("leave_thread", { threadId, reason: "done" }, archCtx);

    const abandoned = archCtx.dispatchedEvents.find((e) => e.event === "thread_abandoned");
    expect(abandoned).toBeDefined();
    const selector = abandoned!.selector as Record<string, unknown>;
    expect(selector.agentIds).toContain(kateId); // the named cross-env recipient
    expect(selector.matchLabels).toBeUndefined(); // bug-61: no label gate
  });

  it("thread_queue_item_pruned dispatch: pinpoint to participants — NO matchLabels", async () => {
    // Seed an env=prod thread + a stuck thread_message item; prune it.
    const thread = await archCtx.stores.thread.openThread("stuck", "M", "architect", {
      authorAgentId: "s-arch",
    } as never);
    // Stamp the thread's env label — pre-fix this would have gated the prune
    // dispatch to participants whose labels don't match env=prod.
    await (archCtx.stores.thread as { __debugSetThread: (id: string, patch: unknown) => Promise<unknown> })
      .__debugSetThread(thread.id, { labels: { env: "prod" } });

    const item = await archCtx.stores.pendingAction.enqueue({
      targetAgentId: "eng-target", dispatchType: "thread_message", entityRef: thread.id, payload: {},
    });
    await (archCtx.stores.pendingAction as PendingActionRepository).__debugSetItem(item.id, {
      enqueuedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    });
    await archCtx.stores.pendingAction.receiptAck(item.id);

    archCtx.dispatchedEvents.length = 0;
    await router.handle("prune_stuck_queue_items", { olderThanMinutes: 10 }, archCtx);

    const pruned = archCtx.dispatchedEvents.find((e) => e.event === "thread_queue_item_pruned");
    expect(pruned).toBeDefined();
    const selector = pruned!.selector as Record<string, unknown>;
    expect(Array.isArray(selector.agentIds)).toBe(true);
    expect((selector.agentIds as string[]).length).toBeGreaterThan(0);
    expect(selector.matchLabels).toBeUndefined(); // bug-61: no label gate
  });
});
