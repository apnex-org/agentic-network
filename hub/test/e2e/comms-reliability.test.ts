/**
 * Comms Reliability — ADR-017 spec tests.
 *
 * These tests pin the behavioral contract of the persist-first pending-actions
 * queue + liveness FSM + Director-notification escalation ladder. They REPLACE
 * the silent-drop class documented in bug-10.
 *
 * STATUS: RED (pre-implementation). Tests are expected to fail until ADR-017
 * Phase 1 lands. Each failure mode below maps to a distinct INV-COMMS-L*
 * invariant — these are the forcing-function that makes bug-10's class
 * impossible by design.
 *
 * Run with: `npm test -- comms-reliability`
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PolicyRouter } from "../../src/policy/router.js";
import { registerThreadPolicy } from "../../src/policy/thread-policy.js";
import { registerSessionPolicy } from "../../src/policy/session-policy.js";
import { createTestContext, type TestPolicyContext } from "../../src/policy/test-utils.js";
import type { AgentClientMetadata } from "../../src/state.js";

const noop = () => {};

const CLIENT: AgentClientMetadata = {
  clientName: "claude-code",
  clientVersion: "0.1.0",
  proxyName: "@ois/claude-plugin",
  proxyVersion: "1.0.0",
};

// Test-side helper — registers an agent whose wake-endpoint is a fake that
// NEVER returns (simulates Cloud Run deploy absent / scale-to-zero failure).
async function registerUnresponsiveArchitect(ctx: TestPolicyContext) {
  await ctx.stores.engineerRegistry.registerAgent(
    ctx.sessionId,
    "architect",
    {
      globalInstanceId: `inst-arch-${ctx.sessionId}`,
      role: "architect",
      clientMetadata: CLIENT,
      labels: { env: "test" },
      // ADR-017: wakeEndpoint is the durable-wake URL. A black-hole endpoint
      // simulates an architect that is fully unresponsive (no receipt ACK, no
      // completion ACK, no cold-start success).
      wakeEndpoint: "http://localhost:0/wake-blackhole",
    } as any,
  );
  return `eng-arch-mock`;
}

async function registerEngineer(ctx: TestPolicyContext) {
  await ctx.stores.engineerRegistry.registerAgent(
    ctx.sessionId,
    "engineer",
    {
      globalInstanceId: `inst-eng-${ctx.sessionId}`,
      role: "engineer",
      clientMetadata: CLIENT,
      labels: { env: "test" },
    },
  );
}

describe("ADR-017 — persist-first comms queue + liveness FSM", () => {
  let engRouter: PolicyRouter;
  let archRouter: PolicyRouter;
  let engCtx: TestPolicyContext;
  let archCtx: TestPolicyContext;

  beforeEach(() => {
    vi.useFakeTimers();
    engRouter = new PolicyRouter(noop);
    archRouter = new PolicyRouter(noop);
    registerThreadPolicy(engRouter);
    registerThreadPolicy(archRouter);
    registerSessionPolicy(engRouter);
    registerSessionPolicy(archRouter);

    engCtx = createTestContext({ sessionId: "sess-eng", role: "engineer" });
    archCtx = createTestContext({
      sessionId: "sess-arch",
      role: "architect",
      stores: engCtx.stores, // share the store layer
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // INV-COMMS-L01 — enqueue precedes SSE dispatch
  // ═════════════════════════════════════════════════════════════════

  describe("INV-COMMS-L01 — enqueue precedes SSE", () => {
    it("create_thread durably enqueues a PendingActionItem BEFORE SSE fires", async () => {
      await registerEngineer(engCtx);
      const archAgentId = await registerUnresponsiveArchitect(archCtx);

      await engRouter.handle(
        "create_thread",
        {
          title: "Review spec",
          message: "Please review",
          routingMode: "unicast",
          recipientAgentId: archAgentId,
        },
        engCtx,
      );

      // Expect: a PendingActionItem exists on the architect's queue with
      // dispatchType=thread_message, entityRef=threadId, state=enqueued.
      const pendingStore = (engCtx.stores as any).pendingAction;
      expect(pendingStore).toBeDefined();
      const items = await pendingStore.listForAgent(archAgentId);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        targetAgentId: archAgentId,
        dispatchType: "thread_message",
        state: "enqueued",
      });
    });

    it("duplicate enqueue via natural key returns existing item (INV-PA2)", async () => {
      await registerEngineer(engCtx);
      const archAgentId = await registerUnresponsiveArchitect(archCtx);

      const pendingStore = (engCtx.stores as any).pendingAction;
      const first = await pendingStore.enqueue({
        targetAgentId: archAgentId,
        dispatchType: "thread_message",
        entityRef: "thread-1",
        payload: {},
      });
      const second = await pendingStore.enqueue({
        targetAgentId: archAgentId,
        dispatchType: "thread_message",
        entityRef: "thread-1",
        payload: {},
      });
      expect(first.id).toBe(second.id);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // INV-COMMS-L04 — no silent drops; every item reaches terminal state
  // (This is the direct bug-10 reproduction case.)
  // ═════════════════════════════════════════════════════════════════

  describe("INV-COMMS-L04 — no silent drops (bug-10 class)", () => {
    it("thread_message to unresponsive architect escalates within SLA", async () => {
      await registerEngineer(engCtx);
      const archAgentId = await registerUnresponsiveArchitect(archCtx);

      await engRouter.handle(
        "create_thread",
        {
          title: "Review spec",
          message: "Please review",
          routingMode: "unicast",
          recipientAgentId: archAgentId,
        },
        engCtx,
      );

      // Architect never calls drain_pending_actions. Watchdog should fire
      // through its three stages: re-dispatch → demote → escalate.
      // receiptSla default 30s; watchdog tolerance 3x + slack.
      await vi.advanceTimersByTimeAsync(180_000); // 3 minutes

      // INV-COMMS-L05 — escalation ladder auditable.
      const audit = await engCtx.stores.audit.listEntries();
      const ladder = audit.filter((a) =>
        ["comms_redispatch", "agent_demoted", "queue_item_escalated"].includes(a.action),
      );
      expect(ladder.map((a) => a.action)).toEqual([
        "comms_redispatch",
        "agent_demoted",
        "queue_item_escalated",
      ]);

      // INV-PA5 — escalated items surface to Director.
      const dnStore = (engCtx.stores as any).directorNotification;
      const notifications = await dnStore.list();
      expect(notifications.filter((n: any) => n.source === "queue_item_escalated")).toHaveLength(1);

      // INV-AG6 — agent livenessState demoted.
      const arch = await engCtx.stores.engineerRegistry.getAgentById(archAgentId);
      expect((arch as any).livenessState).toBe("unresponsive");

      // INV-COMMS-L04 — queue item is terminal (escalated), NOT eternally enqueued.
      const pendingStore = (engCtx.stores as any).pendingAction;
      const items = await pendingStore.listForAgent(archAgentId);
      expect(items).toHaveLength(1);
      expect(items[0].state).toBe("escalated");
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // INV-COMMS-L03 — liveness FSM reflects heartbeat reality
  // (This pins the observed "online + 3h-stale lastSeenAt" lie.)
  // ═════════════════════════════════════════════════════════════════

  describe("INV-COMMS-L03 — honest liveness", () => {
    it("agent status auto-demotes online → degraded when heartbeat stale", async () => {
      await registerEngineer(engCtx);
      const archAgentId = await registerUnresponsiveArchitect(archCtx);

      // Register establishes heartbeat; advance past 2x receiptSla.
      await vi.advanceTimersByTimeAsync(70_000); // 70s > 2 * 30s

      const arch = await engCtx.stores.engineerRegistry.getAgentById(archAgentId);
      expect((arch as any).livenessState).toBe("degraded");
      // Legacy boolean status stays consistent with FSM during Phase 1–2.
      expect(arch?.status).not.toBe("online");
    });

    it("drain_pending_actions call refreshes heartbeat → online", async () => {
      await registerEngineer(engCtx);
      const archAgentId = await registerUnresponsiveArchitect(archCtx);
      await vi.advanceTimersByTimeAsync(70_000);

      // Architect recovers: calls drain.
      await archRouter.handle("drain_pending_actions", {}, archCtx);

      const arch = await engCtx.stores.engineerRegistry.getAgentById(archAgentId);
      expect((arch as any).livenessState).toBe("online");
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // Happy path — architect drains, replies, completion-acks the queue
  // ═════════════════════════════════════════════════════════════════

  describe("Happy path — drain + settle", () => {
    it("architect drains queue, replies, queue item terminates as completion_acked", async () => {
      await registerEngineer(engCtx);
      const archAgentId = await registerUnresponsiveArchitect(archCtx);

      const openResult = await engRouter.handle(
        "create_thread",
        {
          title: "T",
          message: "M",
          routingMode: "unicast",
          recipientAgentId: archAgentId,
        },
        engCtx,
      );
      const { threadId } = JSON.parse(openResult.content[0].text);

      // Architect drains queue → receives the pending thread_message.
      const drainResult = await archRouter.handle("drain_pending_actions", {}, archCtx);
      const drained = JSON.parse(drainResult.content[0].text);
      expect(drained.items).toHaveLength(1);
      const queueItemId = drained.items[0].id;

      // Queue item flipped to receipt_acked.
      const pendingStore = (engCtx.stores as any).pendingAction;
      let item = await pendingStore.getById(queueItemId);
      expect(item.state).toBe("receipt_acked");

      // Architect replies, referencing the queue item → triggers completion ACK.
      await archRouter.handle(
        "create_thread_reply",
        {
          threadId,
          message: "Reviewed, looks good",
          converged: false,
          sourceQueueItemId: queueItemId,
        },
        archCtx,
      );

      item = await pendingStore.getById(queueItemId);
      expect(item.state).toBe("completion_acked");
      expect(item.completionAckedAt).toBeDefined();
    });
  });
});
