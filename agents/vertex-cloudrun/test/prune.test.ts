/**
 * Prune harness tests (M25-SH-T2 → SH-T3).
 *
 * Covers the pure pruneThreadMessages(messages, options) function that
 * the sandwich thread-reply path uses to stay within token budget.
 */

import { describe, it, expect } from "vitest";
import { pruneThreadMessages } from "../src/prune.js";

describe("pruneThreadMessages", () => {
  it("empty input produces empty output with zero counts", () => {
    const r = pruneThreadMessages([]);
    expect(r.text).toBe("");
    expect(r.retainedCount).toBe(0);
    expect(r.omittedCount).toBe(0);
    expect(r.anyTruncated).toBe(false);
  });

  it("under-budget input is passed through verbatim in format", () => {
    const msgs = [
      { author: "architect", text: "hi" },
      { author: "engineer", text: "hello back" },
    ];
    const r = pruneThreadMessages(msgs, { budgetChars: 10_000 });
    expect(r.retainedCount).toBe(2);
    expect(r.omittedCount).toBe(0);
    expect(r.text).toBe("\n[architect]: hi\n\n[engineer]: hello back\n");
  });

  it("over-budget input retains opener + recent tail with omitted-marker", () => {
    const msgs = Array.from({ length: 20 }, (_, i) => ({
      author: i % 2 === 0 ? "architect" : "engineer",
      text: "x".repeat(500),
    }));
    const r = pruneThreadMessages(msgs, { budgetChars: 3_000 });

    expect(r.omittedCount).toBeGreaterThan(0);
    expect(r.retainedCount + r.omittedCount).toBe(20);
    expect(r.text.length).toBeLessThanOrEqual(3_000);
    expect(r.text).toContain("earlier message(s) omitted for context budget");
    // Opener is always first, so the very first message's author (architect)
    // appears at the start of the text.
    expect(r.text).toMatch(/^\n\[architect\]: xxxx/);
  });

  it("preserves message order: opener first, retained tail strictly increasing", () => {
    const msgs = Array.from({ length: 10 }, (_, i) => ({
      author: "a",
      text: String(i),
    }));
    const r = pruneThreadMessages(msgs, { budgetChars: 80 });
    const nums = [...r.text.matchAll(/\[a\]: (\d+)/g)].map((m) => Number(m[1]));
    expect(nums[0]).toBe(0); // opener
    for (let i = 1; i < nums.length; i++) {
      expect(nums[i]).toBeGreaterThan(nums[i - 1]);
    }
  });

  it("per-message cap truncates huge single messages with marker", () => {
    const fat = [{ author: "arch", text: "y".repeat(20_000) }];
    const r = pruneThreadMessages(fat, { budgetChars: 100_000, perMessageCapChars: 1_000 });
    expect(r.anyTruncated).toBe(true);
    expect(r.text).toContain("… [truncated]");
    expect(r.text.length).toBeLessThan(1_100); // cap + format + marker
  });

  it("per-message cap + budget prune compose: huge msg truncated then included", () => {
    // One huge opener, many small recent messages; opener should be
    // truncated to fit, recent messages should still appear.
    const msgs = [
      { author: "architect", text: "O".repeat(20_000) },
      ...Array.from({ length: 5 }, (_, i) => ({ author: "engineer", text: `r${i}` })),
    ];
    const r = pruneThreadMessages(msgs, { budgetChars: 2_000, perMessageCapChars: 500 });
    expect(r.anyTruncated).toBe(true);
    // All 5 recent messages fit after opener truncation.
    expect(r.retainedCount).toBe(6);
    expect(r.omittedCount).toBe(0);
    // Opener truncation marker appears and so do each recent index.
    expect(r.text).toContain("… [truncated]");
    for (let i = 0; i < 5; i++) {
      expect(r.text).toContain(`[engineer]: r${i}`);
    }
  });

  it("omitted-count matches the exact number of dropped middle messages", () => {
    const msgs = Array.from({ length: 6 }, (_, i) => ({ author: "a", text: "y".repeat(100) }));
    // Budget tight enough that only opener + 1 recent fits.
    const r = pruneThreadMessages(msgs, { budgetChars: 300 });
    expect(r.retainedCount).toBe(2);
    expect(r.omittedCount).toBe(4);
    expect(r.text).toMatch(/\[4 earlier message\(s\) omitted/);
  });

  it("defaults are sensible for a typical thread-reply prompt", () => {
    // 10 messages of 2_000 chars each = 20_000 chars → well under 40k default.
    const msgs = Array.from({ length: 10 }, (_, i) => ({
      author: i % 2 ? "engineer" : "architect",
      text: "a".repeat(2_000),
    }));
    const r = pruneThreadMessages(msgs);
    expect(r.retainedCount).toBe(10);
    expect(r.omittedCount).toBe(0);
    expect(r.anyTruncated).toBe(false);
  });

  it("opener alone exceeding budget still retains opener (never drops it)", () => {
    // Opener is small but per-msg cap allows it. Budget is too small for
    // anything — opener should still be emitted (graceful degradation
    // rather than returning empty).
    const msgs = [
      { author: "architect", text: "opener-text" },
      { author: "engineer", text: "x".repeat(1_000) },
    ];
    const r = pruneThreadMessages(msgs, { budgetChars: 50 });
    expect(r.text).toContain("[architect]: opener-text");
    // The 1 recent should be dropped because it's bigger than remaining budget.
    expect(r.omittedCount).toBe(1);
  });
});
