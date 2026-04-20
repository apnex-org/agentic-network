import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../../src/policy/router.js";
import { registerThreadPolicy } from "../../src/policy/thread-policy.js";
import { createTestContext, type TestPolicyContext } from "../../src/policy/test-utils.js";

/**
 * bug-18 — thread-policy unicast dispatch must not gate on labels.
 *
 * When a unicast thread pins `recipientAgentId`, the dispatch selector
 * used for SSE delivery must be pinpoint (engineerIds only) — NO
 * matchLabels filter. Without this, thread.labels inherited from the
 * opener (e.g. architect env=prod) gate delivery to a differently-
 * labelled target (e.g. kate env=dev), silently dropping the dispatch.
 *
 * The store-layer selectAgents intentionally retains the
 * Mission-19 `engineerId + matchLabels → must-match` contract (it's a
 * legitimate safety-check semantic). The fix is in the caller — policy
 * layer stops including matchLabels for explicit-recipient dispatches.
 */

const CLIENT = {
  clientName: "claude-code",
  clientVersion: "0.1.0",
  proxyName: "@ois/claude-plugin",
  proxyVersion: "1.0.0",
};

describe("bug-18 — unicast thread dispatch is not label-gated", () => {
  let archCtx: TestPolicyContext;
  let archRouter: PolicyRouter;

  beforeEach(async () => {
    archCtx = createTestContext();
    archRouter = new PolicyRouter(() => {});
    registerThreadPolicy(archRouter);

    // Architect registers with env=prod — typical "greg" / main session.
    await archCtx.stores.engineerRegistry.registerAgent(
      archCtx.sessionId,
      "architect",
      {
        globalInstanceId: `inst-arch-${archCtx.sessionId}`,
        role: "architect",
        clientMetadata: CLIENT,
        labels: { env: "prod" },
      } as any,
    );
  });

  it("create_thread unicast: selector has engineerIds but NO matchLabels (kate cross-env fix)", async () => {
    // Kate-style dev engineer — env=dev.
    const kateResult = await archCtx.stores.engineerRegistry.registerAgent(
      "session-kate",
      "engineer",
      {
        globalInstanceId: "inst-kate",
        role: "engineer",
        clientMetadata: CLIENT,
        labels: { env: "dev" },
      } as any,
    );
    if (!kateResult.ok) throw new Error("kate register failed");
    const kateId = kateResult.engineerId;

    await archRouter.handle(
      "create_thread",
      {
        title: "cross-env test",
        message: "ping",
        routingMode: "unicast",
        recipientAgentId: kateId,
      },
      archCtx,
    );

    const msg = archCtx.dispatchedEvents.find((e) => e.event === "thread_message");
    expect(msg).toBeDefined();
    const selector = msg!.selector as Record<string, unknown>;
    expect(selector.engineerIds).toEqual([kateId]);
    // The specific assertion: no matchLabels on pinpoint unicast dispatch.
    expect(selector.matchLabels).toBeUndefined();
  });

  it("create_thread broadcast: selector DOES include matchLabels (pool filtering preserved)", async () => {
    // Regression guard: broadcast dispatches should still pool-filter by
    // labels. Only unicast-with-recipient loses the label gate.
    await archRouter.handle(
      "create_thread",
      {
        title: "broadcast test",
        message: "hi pool",
        routingMode: "broadcast",
      },
      archCtx,
    );

    const msg = archCtx.dispatchedEvents.find((e) => e.event === "thread_message");
    expect(msg).toBeDefined();
    const selector = msg!.selector as Record<string, unknown>;
    expect(selector.roles).toEqual(["engineer"]);
    // Broadcast retains matchLabels for pool filtering.
    expect(selector.matchLabels).toBeDefined();
  });
});
