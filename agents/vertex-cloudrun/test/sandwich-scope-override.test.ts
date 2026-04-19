/**
 * Phase 2b ckpt-A — Sandwich scope-override builder tests.
 *
 * Pins the contract between the scope-override text and the sandwich
 * allowlist so refactors can't silently break the MAX_TOOL_ROUNDS fix.
 */

import { describe, it, expect } from "vitest";
import { buildSandwichScopeOverride } from "../src/sandwich.js";

describe("buildSandwichScopeOverride", () => {
  const allowlist = [
    "create_thread_reply",
    "get_document",
    "create_task",
    "create_audit_entry",
    "list_tasks",
    "get_task",
    "get_thread",
    "list_threads",
    "close_thread",
  ];

  it("lists every allowlisted tool under the ALLOWED section", () => {
    const text = buildSandwichScopeOverride(allowlist);
    for (const tool of allowlist) {
      expect(text).toMatch(new RegExp(`- ${tool}\\b`));
    }
  });

  it("flags commonly-leaked tools as OUT-OF-SCOPE when absent from the allowlist", () => {
    const text = buildSandwichScopeOverride(allowlist);
    expect(text).toContain("list_audit_entries");
    expect(text).toContain("get_idea");
    expect(text).toContain("get_engineer_status");
  });

  it("does NOT mark a leak-candidate as out-of-scope when it is in the allowlist", () => {
    // If a future allowlist adds get_idea, the override must not still
    // declare it OUT-OF-SCOPE — that would defeat the purpose.
    const withIdeaRead = [...allowlist, "get_idea"];
    const text = buildSandwichScopeOverride(withIdeaRead);
    // get_idea should still appear (once, under ALLOWED), but not in the
    // OUT-OF-SCOPE block. The OUT-OF-SCOPE block is a bullet list; the
    // exact line "  - get_idea" should appear only once, and that once
    // is under ALLOWED.
    const occurrences = text.match(/- get_idea\b/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it("has a clear header and directive footer", () => {
    const text = buildSandwichScopeOverride(allowlist);
    expect(text).toMatch(/SANDWICH SCOPE OVERRIDE/);
    expect(text).toMatch(/You may ONLY call these tools/);
    expect(text).toMatch(/OUT-OF-SCOPE here/);
    expect(text).toMatch(/create_thread_reply in as few rounds as possible/);
  });

  it("empty allowlist still produces coherent text (defensive — should not crash)", () => {
    const text = buildSandwichScopeOverride([]);
    expect(text).toContain("SANDWICH SCOPE OVERRIDE");
    // Every common leak is considered out-of-scope when nothing is
    // allowed — covers the case where a future caller misconfigures.
    expect(text).toContain("list_audit_entries");
  });
});
