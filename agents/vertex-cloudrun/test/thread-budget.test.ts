/**
 * M-Hypervisor-Adapter-Mitigations Task 1a (task-312) — thread-level
 * budget awareness via prompt injection.
 *
 * Pins `formatThreadBudget`'s string-shape contract so future refactors
 * can't silently break the signal the LLM has learned to recognize.
 * The injection is a trailing line on the system instruction; its
 * stable format is load-bearing for architect budget-awareness.
 */

import { describe, it, expect } from "vitest";
import { formatThreadBudget } from "../src/llm.js";

describe("formatThreadBudget — Task 1a", () => {
  it("injects the [Thread Budget: …] line with turnAboutToTake = currentRound + 1", () => {
    const out = formatThreadBudget({ currentRound: 3, maxRounds: 10 });
    expect(out).toContain("[Thread Budget: round 4/10");
    expect(out).toContain("respect the thread-level round cap");
    // Leading blank lines ensure the injection doesn't run into the
    // preceding system-instruction content.
    expect(out.startsWith("\n\n")).toBe(true);
  });

  it("returns the empty string when budget is undefined (no injection)", () => {
    expect(formatThreadBudget(undefined)).toBe("");
  });

  it("round 0 (opener) shows turn 1 as about-to-take", () => {
    const out = formatThreadBudget({ currentRound: 0, maxRounds: 10 });
    expect(out).toContain("[Thread Budget: round 1/10");
  });

  it("at the cap (currentRound === maxRounds - 1) shows final-turn warning", () => {
    const out = formatThreadBudget({ currentRound: 9, maxRounds: 10 });
    expect(out).toContain("[Thread Budget: round 10/10");
  });

  it("conservatively returns empty on non-finite or non-positive maxRounds", () => {
    expect(formatThreadBudget({ currentRound: 3, maxRounds: 0 })).toBe("");
    expect(formatThreadBudget({ currentRound: 3, maxRounds: -1 })).toBe("");
    expect(formatThreadBudget({ currentRound: 3, maxRounds: NaN })).toBe("");
    expect(formatThreadBudget({ currentRound: 3, maxRounds: Infinity })).toBe("");
  });

  it("conservatively returns empty on negative or non-finite currentRound", () => {
    expect(formatThreadBudget({ currentRound: -1, maxRounds: 10 })).toBe("");
    expect(formatThreadBudget({ currentRound: NaN, maxRounds: 10 })).toBe("");
  });

  it("string shape is stable across different limits (3/30, 5/5)", () => {
    expect(formatThreadBudget({ currentRound: 2, maxRounds: 30 })).toContain("round 3/30");
    expect(formatThreadBudget({ currentRound: 4, maxRounds: 5 })).toContain("round 5/5");
  });

  it("injection is a single atomic trailing line (no embedded newlines mid-sentence)", () => {
    // The format is `\n\n[Thread Budget: ...]` — exactly two leading
    // newlines, exactly one closing bracket, no internal linebreaks.
    const out = formatThreadBudget({ currentRound: 2, maxRounds: 10 });
    expect(out.split("\n").length).toBe(3); // "" + "" + "[Thread Budget: ...]"
    expect(out.trim()).toMatch(/^\[Thread Budget:.*\]$/);
  });
});
