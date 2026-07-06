/**
 * work-162 (A1) — Task + Turn + clarification retirement CATALOG-NEGATIVE gate.
 *
 * Director-ratified 2026-07-06 (coord): "Agree on the additional cut" — the
 * 12-verb Task + Turn + clarification retirement. This test is the standing
 * proof that none of the 12 retired verbs survive on the production policy
 * surface: each resolves to unknown-tool.
 *
 * The 12 verbs (architect-enumerated):
 *   Task:          create_task, get_task, list_tasks
 *   Review:        create_review, get_review
 *   Turn:          create_turn, get_turn, list_turns, update_turn
 *   Clarification: create_clarification, resolve_clarification, get_clarification
 */

import { describe, it, expect } from "vitest";
import { PolicyRouter } from "../src/policy/router.js";
import {
  registerSystemPolicy,
  registerAuditPolicy,
  registerSessionPolicy,
  registerIdeaPolicy,
  registerMissionPolicy,
  registerProposalPolicy,
  registerThreadPolicy,
  registerMessagePolicy,
} from "../src/policy/index.js";
import { registerBugPolicy } from "../src/policy/bug-policy.js";
import { registerWorkItemPolicy } from "../src/policy/work-item-policy.js";
import { createTestContext } from "../src/policy/test-utils.js";

const RETIRED_VERBS = [
  // Task
  "create_task",
  "get_task",
  "list_tasks",
  // Review
  "create_review",
  "get_review",
  // Turn
  "create_turn",
  "get_turn",
  "list_turns",
  "update_turn",
  // Clarification
  "create_clarification",
  "resolve_clarification",
  "get_clarification",
] as const;

/**
 * Register the full production policy surface (mirrors hub/src/index.ts). The
 * 12 retired verbs could ONLY come from the deleted task/turn/clarification/
 * review policies — registered here would surface them, so their absence is
 * the whole cut.
 */
function fullProductionRouter(): PolicyRouter {
  const router = new PolicyRouter(() => {});
  registerSystemPolicy(router);
  registerAuditPolicy(router);
  registerSessionPolicy(router);
  registerIdeaPolicy(router);
  registerMissionPolicy(router);
  registerProposalPolicy(router);
  registerThreadPolicy(router);
  registerMessagePolicy(router);
  registerBugPolicy(router);
  registerWorkItemPolicy(router);
  return router;
}

describe("work-162 (A1) catalog-negative — Task+Turn+clarification retirement", () => {
  it("exactly 12 verbs are enumerated (Task 3 + Review 2 + Turn 4 + Clarification 3)", () => {
    expect(RETIRED_VERBS).toHaveLength(12);
    expect(new Set(RETIRED_VERBS).size).toBe(12); // no duplicates
  });

  it("none of the 12 retired verbs is registered on the full production surface", () => {
    const router = fullProductionRouter();
    for (const verb of RETIRED_VERBS) {
      expect(router.has(verb), `${verb} must NOT be registered`).toBe(false);
      expect(router.getAllToolNames(), `${verb} must NOT be a tool name/alias`).not.toContain(verb);
    }
  });

  it("dispatching any of the 12 retired verbs returns an Unknown tool error", async () => {
    const router = fullProductionRouter();
    const ctx = createTestContext();
    for (const verb of RETIRED_VERBS) {
      const result = await router.handle(verb, {}, ctx);
      expect(result.isError, `${verb} must error`).toBe(true);
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.error, `${verb} must be Unknown tool`).toContain("Unknown tool");
    }
  });
});
