import { describe, it, expect } from "vitest";
import { harnessConfigDir } from "../src/bin/seed-skills.js";

/**
 * piuplift0 p1 — the harness-neutral config-dir selector that generalized the HCAP seed bin
 * off its CLAUDE_CONFIG_DIR coupling. The claude path MUST stay byte-identical (OIS_HARNESS
 * unset → CLAUDE_CONFIG_DIR); pi's OIS_HARNESS=pi selects PI_CODING_AGENT_DIR.
 */
describe("harnessConfigDir (piuplift0 p1 — harness-neutral config-dir selector)", () => {
  it("claude path byte-unchanged: OIS_HARNESS unset → CLAUDE_CONFIG_DIR", () => {
    expect(harnessConfigDir({ CLAUDE_CONFIG_DIR: "/c" } as NodeJS.ProcessEnv)).toBe("/c");
  });
  it("pi: OIS_HARNESS=pi selects PI_CODING_AGENT_DIR (not the wrong PI_CONFIG_DIR convention)", () => {
    expect(harnessConfigDir({ OIS_HARNESS: "pi", PI_CODING_AGENT_DIR: "/pi" } as NodeJS.ProcessEnv)).toBe("/pi");
  });
  it("the mapped harness dir wins over a present CLAUDE_CONFIG_DIR", () => {
    expect(
      harnessConfigDir({ OIS_HARNESS: "pi", PI_CODING_AGENT_DIR: "/pi", CLAUDE_CONFIG_DIR: "/c" } as NodeJS.ProcessEnv),
    ).toBe("/pi");
  });
  it("an UNMAPPED harness falls back to CLAUDE_CONFIG_DIR (no invented convention)", () => {
    expect(harnessConfigDir({ OIS_HARNESS: "codex", CLAUDE_CONFIG_DIR: "/c" } as NodeJS.ProcessEnv)).toBe("/c");
  });
  it("falls back to CLAUDE_CONFIG_DIR when the mapped harness dir is absent (back-compat)", () => {
    expect(harnessConfigDir({ OIS_HARNESS: "pi", CLAUDE_CONFIG_DIR: "/c" } as NodeJS.ProcessEnv)).toBe("/c");
  });
  it("undefined when nothing is set", () => {
    expect(harnessConfigDir({} as NodeJS.ProcessEnv)).toBeUndefined();
  });
});
