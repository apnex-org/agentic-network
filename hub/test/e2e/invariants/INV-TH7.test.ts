/**
 * INV-TH7 — `close_thread` is architect-only administrative stewardship;
 * participants use `leave_thread`.
 *
 * workflow-registry.md §7.2. Enforced at PolicyRouter RBAC via the
 * `[Architect]` description-prefix on `close_thread` (see
 * `thread-policy.ts:1105`).
 *
 * Ratified Wave-2 subset per
 * `docs/missions/mission-41-kickoff-decisions.md` §Decision 1.
 *
 * Mission-41 Wave 2 — task-334.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "../orchestrator.js";
import { assertInvTH7 } from "../invariant-helpers.js";

describe("INV-TH7 — close_thread architect-only stewardship", () => {
  let orch: TestOrchestrator;

  beforeEach(() => {
    orch = TestOrchestrator.create();
  });

  it("helper coverage: assertInvTH7 all modes pass", async () => {
    await expect(assertInvTH7(orch, "all")).resolves.toBeUndefined();
  });

  it("architect close_thread succeeds (positive)", async () => {
    const arch = orch.asArchitect();
    await arch.createThread("TH7 positive", "init", { routingMode: "broadcast" });
    const close = await arch.call("close_thread", { threadId: "thread-1" });
    expect(close.isError).toBeFalsy();

    const stored = await orch.stores.thread.getThread("thread-1");
    expect(stored?.status).toBe("closed");
  });

  it("engineer close_thread is rejected with Authorization denied (RBAC)", async () => {
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    await arch.createThread("TH7 engineer-blocked", "init", { routingMode: "broadcast" });
    const result = await eng.call("close_thread", { threadId: "thread-1" });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toMatch(/^Authorization denied:/);
    expect(parsed.error).toMatch(/close_thread/);
    expect(parsed.error).toMatch(/architect/);
    expect(parsed.error).toMatch(/engineer/);

    // Thread still active (RBAC blocked the call; no state change).
    const stored = await orch.stores.thread.getThread("thread-1");
    expect(stored?.status).toBe("active");
  });

  it("engineer CAN call leave_thread on a thread they participate in (distinct semantic)", async () => {
    // Contrast test: participant-initiated abandonment via leave_thread
    // is permitted for engineers; only the admin close_thread is
    // architect-only. This pins the semantic separation so a future
    // RBAC-refactor that accidentally blocks leave_thread for engineers
    // surfaces here.
    const arch = orch.asArchitect();
    const eng = orch.asEngineer();

    // Engineer needs to be a participant. Use architect to open a
    // broadcast thread, then engineer replies (becomes participant via
    // reply-upsert per INV-TH14), then engineer leaves.
    await arch.createThread("TH7 leave-distinct", "init", { routingMode: "broadcast" });
    await eng.call("create_thread_reply", { threadId: "thread-1", message: "joining via reply" });

    const leaveResult = await eng.call("leave_thread", { threadId: "thread-1" });
    // leave_thread returns isError for failures; confirm no Authorization
    // denied (RBAC passed; semantic outcome is policy-specific).
    if (leaveResult.isError) {
      const parsed = JSON.parse(leaveResult.content[0].text);
      expect(parsed.error ?? "").not.toMatch(/Authorization denied/);
    }
  });

  it("close_thread fails gracefully on non-existent thread (not an RBAC issue)", async () => {
    const arch = orch.asArchitect();
    const result = await arch.call("close_thread", { threadId: "thread-nonexistent" });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).not.toMatch(/Authorization denied/);
    // Policy surfaces a "not found" shape (see thread-policy.ts:710-712).
    expect(parsed.error).toMatch(/not found/);
  });
});
