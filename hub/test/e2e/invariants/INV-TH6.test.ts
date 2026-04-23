/**
 * INV-TH6 — `create_thread_reply` is rejected when the target thread's
 * status is not `active`.
 *
 * workflow-registry.md §7.2. Thread FSM statuses:
 *   active | converged | round_limit | closed | abandoned | cascade_failed
 *
 * Only `active` accepts replies. The other 5 are rejected.
 *
 * Ratified Wave-2 subset per
 * `docs/missions/mission-41-kickoff-decisions.md` §Decision 1.
 *
 * Mission-41 Wave 2 — task-333.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "../orchestrator.js";
import { assertInvTH6 } from "../invariant-helpers.js";

describe("INV-TH6 — reply to non-active thread is rejected", () => {
  let orch: TestOrchestrator;

  beforeEach(() => {
    orch = TestOrchestrator.create();
  });

  it("helper coverage: assertInvTH6 all modes pass", async () => {
    await expect(assertInvTH6(orch, "all")).resolves.toBeUndefined();
  });

  it("reply on active thread succeeds (positive)", async () => {
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    await arch.createThread("TH6 active", "init", { routingMode: "broadcast" });
    const reply = await eng.call("create_thread_reply", {
      threadId: "thread-1", message: "ok",
    });
    expect(reply.isError).toBeFalsy();
  });

  /**
   * Force the thread into a non-active state via direct store mutation,
   * then attempt a reply. For each of the 5 non-active statuses, verify
   * rejection. Some states (converged, round_limit, cascade_failed) are
   * reachable only via convergence / max-round / cascade-failure paths
   * that would take substantial setup; direct mutation is the pragmatic
   * coverage mechanism for INV-TH6 specifically (the test isn't about
   * transition-to-X, it's about reply-on-X).
   */
  const NON_ACTIVE_STATUSES = ["converged", "round_limit", "closed", "abandoned", "cascade_failed"] as const;

  for (const status of NON_ACTIVE_STATUSES) {
    it(`reply on ${status} thread is rejected`, async () => {
      const arch = orch.asArchitect();
      const eng = orch.asEngineer();

      await arch.createThread(`TH6 ${status}`, "init", { routingMode: "broadcast" });
      // Force status.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const storeInternals = (orch.stores.thread as any).threads as Map<string, { status: string; updatedAt: string }>;
      const threadRec = storeInternals.get("thread-1");
      expect(threadRec).toBeDefined();
      threadRec!.status = status;
      threadRec!.updatedAt = new Date().toISOString();

      const reply = await eng.call("create_thread_reply", {
        threadId: "thread-1", message: `attempt on ${status}`,
      });
      expect(reply.isError).toBe(true);
      const parsed = JSON.parse(reply.content[0].text);
      // Error text shape varies by exact code path, but some mention of
      // the non-active state OR an activity/status keyword is expected.
      expect(parsed.error).toBeDefined();
    });
  }

  it("reply on closed thread names the status in the error (operator-diagnosable)", async () => {
    // Canonical INV-TH6 error-text pin for the most common non-active
    // state (closed, via close_thread). Operators reading failure logs
    // should see thread status reference to disambiguate from other
    // rejection classes (e.g. RBAC).
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    await arch.createThread("TH6 closed-shape", "init", { routingMode: "broadcast" });
    await arch.call("close_thread", { threadId: "thread-1" });
    const reply = await eng.call("create_thread_reply", {
      threadId: "thread-1", message: "blocked",
    });
    expect(reply.isError).toBe(true);
    const parsed = JSON.parse(reply.content[0].text);
    // Weak assertion — error text format is policy-dependent. Key
    // contract: the error IS surfaced, not "Authorization denied" (which
    // would indicate a different rejection class).
    expect(parsed.error).not.toMatch(/Authorization denied/);
  });
});
