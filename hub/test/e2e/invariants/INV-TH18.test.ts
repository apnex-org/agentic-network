/**
 * INV-TH18 — Thread routing mode is declared at `create_thread` and
 * immutable for the thread's lifetime. The single permitted transition
 * is `broadcast → unicast` on first reply (pool-discovery closes).
 *
 * workflow-registry.md §7.2 (ratified thread-125). Current vocabulary
 * per ADR-016:
 *   - `unicast`   (was "targeted")       — one-to-one pinned; requires recipientAgentId
 *   - `broadcast`                          — pool-discovery by role+labels
 *   - `multicast` (was "context_bound")  — dynamic membership from bound-entity assignee
 *
 * Mission-41 Wave 2 — task-337. Graduated from T2 stub.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "../orchestrator.js";
import { assertInvTH18 } from "../invariant-helpers.js";

/**
 * Resolve engineer-role agentId via the registry after first-tool-call
 * registration. ActorFacade doesn't expose agentId directly; the
 * sessionId is deterministic (`session-engineer-<name>`) so we look up
 * the Agent record post-ensureRegistered.
 */
async function agentIdFor(orch: TestOrchestrator, name: string = "default"): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reg = orch.stores.engineerRegistry as any;
  const agent = await reg.getAgentForSession(`session-engineer-${name}`);
  if (!agent?.agentId) throw new Error(`engineer '${name}' not registered — call a tool first via the engineer facade`);
  return agent.agentId as string;
}

describe("INV-TH18 — thread routing mode immutability + field consistency", () => {
  let orch: TestOrchestrator;

  beforeEach(() => {
    orch = TestOrchestrator.create();
  });

  it("helper coverage: assertInvTH18 all modes pass", async () => {
    await expect(assertInvTH18(orch, "all")).resolves.toBeUndefined();
  });

  describe("positive — routing mode persists per ADR-016 vocabulary", () => {
    it("unicast thread records routingMode='unicast' at open", async () => {
      const arch = orch.asArchitect();
      const eng = orch.asEngineer();
      await eng.listTasks();
      const engId = await agentIdFor(orch);
      await arch.createThread("TH18 unicast", "open", {
        routingMode: "unicast",
        recipientAgentId: engId,
      });
      const stored = await orch.stores.thread.getThread("thread-1");
      expect(stored?.routingMode).toBe("unicast");
      expect(stored?.recipientAgentId).toBe(engId);
    });

    it("broadcast thread records routingMode='broadcast' at open (pre-coerce)", async () => {
      const arch = orch.asArchitect();
      await arch.createThread("TH18 broadcast open", "open", { routingMode: "broadcast" });
      const stored = await orch.stores.thread.getThread("thread-1");
      expect(stored?.routingMode).toBe("broadcast");
      expect(stored?.recipientAgentId).toBeNull();
    });

    it("multicast thread records routingMode='multicast' + context at open", async () => {
      const arch = orch.asArchitect();
      await arch.createThread("TH18 multicast", "open", {
        routingMode: "multicast",
        context: { entityType: "task", entityId: "task-1" },
      });
      const stored = await orch.stores.thread.getThread("thread-1");
      expect(stored?.routingMode).toBe("multicast");
      expect(stored?.context).toEqual({ entityType: "task", entityId: "task-1" });
    });
  });

  describe("negativeReject — field-consistency guards at create_thread", () => {
    it("unicast without recipientAgentId is rejected", async () => {
      const arch = orch.asArchitect();
      const result = await arch.call("create_thread", {
        title: "bad unicast", message: "no pin", routingMode: "unicast",
      });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toMatch(/unicast/);
      expect(parsed.error).toMatch(/recipientAgentId/);
    });

    it("broadcast with recipientAgentId is rejected", async () => {
      const arch = orch.asArchitect();
      const result = await arch.call("create_thread", {
        title: "bad broadcast", message: "over-pinned",
        routingMode: "broadcast", recipientAgentId: "eng-whatever",
      });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toMatch(/broadcast/);
      expect(parsed.error).toMatch(/recipientAgentId/);
    });

    it("multicast without context is rejected", async () => {
      const arch = orch.asArchitect();
      const result = await arch.call("create_thread", {
        title: "bad multicast", message: "no context", routingMode: "multicast",
      });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toMatch(/multicast/);
      expect(parsed.error).toMatch(/context/);
    });

    it("multicast with recipientAgentId is rejected", async () => {
      const arch = orch.asArchitect();
      const result = await arch.call("create_thread", {
        title: "bad multicast 2", message: "over-pinned",
        routingMode: "multicast",
        context: { entityType: "task", entityId: "task-1" },
        recipientAgentId: "eng-whatever",
      });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toMatch(/multicast/);
      expect(parsed.error).toMatch(/recipientAgentId/);
    });
  });

  describe("edge — broadcast coerces to unicast on first reply (the single permitted transition)", () => {
    it("broadcast thread.routingMode flips to 'unicast' after first reply", async () => {
      const arch = orch.asArchitect();
      const eng = orch.asEngineer();
      await arch.createThread("TH18 coerce", "open", { routingMode: "broadcast" });

      // Pre-reply: broadcast.
      const pre = await orch.stores.thread.getThread("thread-1");
      expect(pre?.routingMode).toBe("broadcast");

      await eng.call("create_thread_reply", { threadId: "thread-1", message: "first reply" });

      // Post-reply: coerced to unicast.
      const post = await orch.stores.thread.getThread("thread-1");
      expect(post?.routingMode).toBe("unicast");
    });

    it("unicast thread.routingMode does NOT change across replies (immutability)", async () => {
      // Contrast test — unicast is IMMUTABLE; only broadcast coerces.
      const arch = orch.asArchitect();
      const eng = orch.asEngineer();
      await eng.listTasks();
      const engId = await agentIdFor(orch);
      await arch.createThread("TH18 unicast immutable", "open", {
        routingMode: "unicast",
        recipientAgentId: engId,
      });

      const pre = await orch.stores.thread.getThread("thread-1");
      expect(pre?.routingMode).toBe("unicast");

      await eng.call("create_thread_reply", { threadId: "thread-1", message: "reply 1" });
      const mid = await orch.stores.thread.getThread("thread-1");
      expect(mid?.routingMode).toBe("unicast");

      await arch.call("create_thread_reply", { threadId: "thread-1", message: "reply 2" });
      const post = await orch.stores.thread.getThread("thread-1");
      expect(post?.routingMode).toBe("unicast");
    });

    it("multicast thread.routingMode is immutable across replies", async () => {
      const arch = orch.asArchitect();
      const eng = orch.asEngineer();
      await arch.createThread("TH18 multicast immutable", "open", {
        routingMode: "multicast",
        context: { entityType: "task", entityId: "task-1" },
      });

      const pre = await orch.stores.thread.getThread("thread-1");
      expect(pre?.routingMode).toBe("multicast");

      // Multicast thread replies may succeed or fail depending on
      // participant-resolution rules (no task-1 exists in this test).
      // Key assertion: routingMode doesn't change regardless.
      await eng.call("create_thread_reply", { threadId: "thread-1", message: "probe" }).catch(() => undefined);
      const post = await orch.stores.thread.getThread("thread-1");
      expect(post?.routingMode).toBe("multicast");
    });
  });
});
